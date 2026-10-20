import {
  CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, Logger, SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ApiException } from "../i18n";

/**
 * Milestone 61 — public-surface rate limiting ("abuse shield").
 *
 * Hand-rolled fixed-window limiter (the codebase's style: TOTP
 * and SigV4 are hand-rolled too). Registered as an APP_GUARD
 * BEFORE the JWT guard so brute force is stopped before any
 * password work happens.
 *
 * Classes (per IP, fixed window; override per class with
 * RATE_LIMIT_<CLASS>=<count>/<windowSeconds>, or per route
 * with @RateLimit(count, windowSeconds)):
 *   auth         login/register/password reset — strict
 *   public-write public chat start/message
 *   ingest       tracking event ingest
 *   callback     webhooks + payment callbacks — generous on
 *                purpose: provider retries must never be
 *                throttled into data loss
 *   default      everything else authenticated — loose ceiling
 *
 * Store: Redis (INCR + EXPIRE) when REDIS_URL is set so every
 * API replica shares one count; in-memory otherwise. Any store
 * failure falls back to the in-memory path — the limiter must
 * never take the API down with it.
 *
 * Skipped entirely: /health, /internal/* (shared-secret
 * surface), /admin/* (SuperAdminGuard + IP allowlist govern
 * it), and SSE streams (long-lived by design).
 */

export const RATE_LIMIT_KEY = "rateLimit";
export const RateLimit = (limit: number, windowSeconds: number) =>
  SetMetadata(RATE_LIMIT_KEY, { limit, windowSeconds });

type LimitSpec = { limit: number; windowSeconds: number };

const DEFAULTS: Record<string, LimitSpec> = {
  auth: { limit: 10, windowSeconds: 60 },
  "public-write": { limit: 30, windowSeconds: 60 },
  ingest: { limit: 300, windowSeconds: 60 },
  callback: { limit: 900, windowSeconds: 60 },
  default: { limit: 900, windowSeconds: 60 },
};

function specFor(cls: string): LimitSpec {
  const raw = process.env[`RATE_LIMIT_${cls.replace("-", "_").toUpperCase()}`];
  if (raw) {
    const [limit, windowSeconds] = raw.split("/").map((n) => Number(n));
    if (Number.isFinite(limit) && limit > 0 && Number.isFinite(windowSeconds) && windowSeconds > 0) {
      return { limit, windowSeconds };
    }
  }
  return DEFAULTS[cls] ?? DEFAULTS.default;
}

function classForPath(path: string, method: string): string | null {
  if (path === "/health" || path.startsWith("/internal/") || path.startsWith("/admin/")) return null;
  if (path.endsWith("/stream")) return null; // SSE (agent inbox + M66 visitor stream)
  if (/^\/(auth)\/(login|register|forgot|reset|totp)/.test(path)) return "auth";
  if (path.startsWith("/public/chat")) return method === "GET" ? null : "public-write";
  if (path.startsWith("/tracking") || path.startsWith("/public/ingest")) return "ingest";
  if (path.startsWith("/webhooks/") || path.startsWith("/public/payments/")) return "callback";
  return "default";
}

/** In-memory fixed-window counters (also the Redis fallback). */
export class MemoryWindowStore {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  hit(key: string, windowSeconds: number): { count: number; retryAfterSeconds: number } {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return { count: 1, retryAfterSeconds: windowSeconds };
    }
    bucket.count += 1;
    return { count: bucket.count, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  /** Opportunistic cleanup so a long-lived process does not grow forever. */
  sweep() {
    const now = Date.now();
    if (this.buckets.size < 5000) return;
    for (const [k, v] of this.buckets) if (v.resetAt <= now) this.buckets.delete(k);
  }
}

/** Blocked-hit statistics for the Admin System panel. */
export const rateLimitStats = {
  blockedTotal: 0,
  byIp: new Map<string, number>(),
  noteBlocked(ip: string) {
    this.blockedTotal += 1;
    this.byIp.set(ip, (this.byIp.get(ip) ?? 0) + 1);
  },
  snapshot() {
    const topIps = [...this.byIp.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([ip, blocked]) => ({ ip, blocked }));
    return { blockedTotal: this.blockedTotal, topIps, store: "process memory (resets on restart)" };
  },
};

@Injectable()
export class ThrottlerGuard implements CanActivate {
  private readonly logger = new Logger(ThrottlerGuard.name);
  private readonly memory = new MemoryWindowStore();
  private redis: any = null;
  private redisFailed = false;

  constructor(private readonly reflector: Reflector) {}

  private async hit(key: string, spec: LimitSpec): Promise<{ count: number; retryAfterSeconds: number }> {
    if (process.env.REDIS_URL && !this.redisFailed) {
      try {
        if (!this.redis) {
          const { default: Redis } = await import("ioredis");
          this.redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
          await this.redis.connect();
        }
        const redisKey = `rl:${key}`;
        const count = await this.redis.incr(redisKey);
        if (count === 1) await this.redis.expire(redisKey, spec.windowSeconds);
        const ttl = await this.redis.ttl(redisKey);
        return { count, retryAfterSeconds: ttl > 0 ? ttl : spec.windowSeconds };
      } catch (e) {
        this.redisFailed = true;
        this.logger.warn(`Rate-limit Redis store failed, using memory: ${e instanceof Error ? e.message : e}`);
      }
    }
    return this.memory.hit(key, spec.windowSeconds);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (process.env.RATE_LIMIT_DISABLED === "true") return true;
    const req = context.switchToHttp().getRequest<any>();
    const res = context.switchToHttp().getResponse<any>();
    const path = (req.path ?? req.url ?? "").split("?")[0];
    const cls = classForPath(path, req.method);
    if (!cls) return true;

    const override = this.reflector.getAllAndOverride<LimitSpec | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(), context.getClass(),
    ]);
    const spec = override ?? specFor(cls);
    const ip = String(
      (req.headers?.["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
      || req.ip || req.socket?.remoteAddress || "unknown",
    );
    const userPart = req.user?.userId ? `:u:${req.user.userId}` : "";
    const key = `${cls}:${ip}${cls === "default" ? userPart : ""}:${path}`;

    const { count, retryAfterSeconds } = await this.hit(key, spec);
    this.memory.sweep();
    if (count > spec.limit) {
      rateLimitStats.noteBlocked(ip);
      res.setHeader?.("Retry-After", String(retryAfterSeconds));
      res.setHeader?.("X-RateLimit-Limit", String(spec.limit));
      const tooMany = new ApiException("common.tooManyRequests", { seconds: retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS);
      tooMany.extra = { retryAfterSeconds };
      throw tooMany;
    }
    res.setHeader?.("X-RateLimit-Limit", String(spec.limit));
    res.setHeader?.("X-RateLimit-Remaining", String(Math.max(0, spec.limit - count)));
    return true;
  }
}
