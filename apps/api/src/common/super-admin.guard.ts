import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../prisma/prisma.service";
import { ipAllowed } from "./ip-allowlist";
import { forbidden } from "../i18n";

// Milestone 40: the console-managed allowlist (SystemSetting
// "adminIpAllowlist") is cached briefly so the guard does not
// add a settings read to every admin call.
let allowlistCache: { at: number; entries: string[] } = { at: 0, entries: [] };

export const ADMIN_TIER_KEY = "adminTier";
export const AdminTier = (...tiers: string[]) => {
  // local SetMetadata to avoid a decorators import cycle
  const { SetMetadata } = require("@nestjs/common");
  return SetMetadata(ADMIN_TIER_KEY, tiers);
};

/**
 * Platform-admin gate for /admin/* routes. The JWT claim alone is
 * NOT enough: the LIVE user row must still be an active super
 * admin, so a revoked or suspended admin's existing token dies at
 * the next admin call. Tier rules: SUPER can do everything; other
 * tiers only what @AdminTier lists; routes without @AdminTier are
 * readable by any admin tier. An IP allowlist (env
 * ADMIN_IP_ALLOWLIST, comma-separated exact IPs) applies when set.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService, private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    if (!req.user?.userId) throw forbidden("common.authRequired");
    // Allowlist = env entries + console-managed entries (either
    // may hold exact IPs or IPv4 CIDR ranges, Milestone 40).
    const envEntries = (process.env.ADMIN_IP_ALLOWLIST ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    let dbEntries: string[] = [];
    try {
      if (Date.now() - allowlistCache.at > 30000) {
        const row = await (this.prisma as any).systemSetting?.findUnique({ where: { key: "adminIpAllowlist" } });
        const value = row?.value;
        allowlistCache = { at: Date.now(), entries: Array.isArray(value) ? value.filter((v: unknown) => typeof v === "string") : [] };
      }
      dbEntries = allowlistCache.entries;
    } catch { /* settings unavailable — env list alone applies */ }
    const allowlist = [...envEntries, ...dbEntries];
    if (allowlist.length > 0) {
      const ip = String(req.headers?.["x-forwarded-for"] ?? req.ip ?? "").split(",")[0].trim();
      if (!ipAllowed(ip, allowlist)) throw forbidden("common.adminNetworkNotAllowed");
    }
    const user = await (this.prisma as any).user.findUnique({ where: { id: req.user.userId } });
    if (!user?.isSuperAdmin || user.status !== "ACTIVE") {
      throw forbidden("common.platformAdminRequired");
    }
    // Admin token revocation: token version must match the live row.
    if ((req.user.tv ?? 0) !== (user.tokenVersion ?? 0)) {
      throw forbidden("common.adminSessionRevoked");
    }
    req.adminUser = user;
    req.adminTier = user.adminTier ?? "SUPER";
    // Hardening: a SUPER admin without TOTP may read and may use the
    // TOTP enrollment endpoints, but cannot mutate anything until
    // two-factor is on. (Break-glass recovery = the CLI grant,
    // which resets TOTP.)
    const method = String(req.method ?? "GET").toUpperCase();
    const url = String(req.originalUrl ?? req.url ?? "");
    // API-key requests (Milestone 40) are exempt from the TOTP
    // session gate: the key itself is a revocable, hashed,
    // SUPER-issued credential, not a browser session.
    if (!req.user.viaApiKey && req.adminTier === "SUPER" && !user.totpEnabled && method !== "GET" && !url.includes("/admin/totp/")) {
      throw forbidden("common.superAdminTotpRequired");
    }
    const required = this.reflector.getAllAndOverride<string[]>(ADMIN_TIER_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (required?.length && req.adminTier !== "SUPER" && !required.includes(req.adminTier)) {
      throw forbidden("common.adminTierRequired", { required: required.join(" or ") });
    }
    return true;
  }
}
