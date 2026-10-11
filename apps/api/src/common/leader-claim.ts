import { randomUUID } from "node:crypto";

/**
 * Milestone 62 — cross-instance leader claim for periodic work.
 *
 * Several API-process timers do platform-wide periodic work
 * (hourly automation-rule evaluation, the 5-minute workflow
 * scan). With more than one API replica, every replica's timer
 * fires and the work runs N times — duplicate campaign actions,
 * duplicate workflow sends. This helper lets exactly one
 * instance claim each round:
 *
 * - REDIS_URL set: Redis `SET key holder NX EX ttl` — the
 *   atomic test-and-set IS the claim. A configured-but-down
 *   Redis returns NO claim (skipping one round is safer than
 *   double-firing side effects; the next round retries).
 * - REDIS_URL unset: single-instance deployment by definition
 *   (the documented posture for realtime/queues/throttling
 *   too) — the claim always succeeds locally.
 */
export class LeaderClaim {
  private readonly instanceId = randomUUID();
  private redis: any = null;
  private redisFailed = false;

  constructor(private readonly redisFactory?: () => Promise<any>) {}

  private async client(): Promise<any> {
    if (this.redisFactory) return this.redisFactory();
    if (this.redis) return this.redis;
    const { default: Redis } = await import("ioredis");
    this.redis = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: 1, lazyConnect: true });
    await this.redis.connect();
    return this.redis;
  }

  /** True when THIS instance should perform the round. */
  async tryClaim(key: string, ttlSeconds: number): Promise<boolean> {
    if (!process.env.REDIS_URL && !this.redisFactory) return true;
    if (this.redisFailed) return false;
    try {
      const redis = await this.client();
      const out = await redis.set(`leader:${key}`, this.instanceId, "EX", ttlSeconds, "NX");
      return out === "OK";
    } catch {
      this.redisFailed = true;
      return false;
    }
  }
}

/** Shared instance for API-process periodic work. */
export const leaderClaim = new LeaderClaim();
