import { CanActivate, ExecutionContext, ForbiddenException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { PERMISSION_AREA_KEYS } from "./permission-catalog";

// Milestone 40: scheduled maintenance windows live in
// SystemSetting; the guard caches the row briefly.
let maintenanceCache: { at: number; window: any } = { at: 0, window: null };

/**
 * Tenant isolation guard.
 * Reads organization id from route param :organizationId or header x-organization-id,
 * then verifies the authenticated user has an ACTIVE membership in that org.
 * No membership = 403, regardless of what data the client asks for.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const organizationId: string | undefined =
      req.params?.organizationId ?? req.params?.id ?? req.headers?.["x-organization-id"];
    if (!organizationId) return true; // route is not org-scoped
    if (!req.user?.userId) throw new ForbiddenException("Authentication required");
    if (req.user.isSuperAdmin) { req.organizationId = organizationId; return true; }
    const membership = await (this.prisma as any).membership.findUnique({
      where: { userId_organizationId: { userId: req.user.userId, organizationId } },
    });
    if (!membership || membership.status !== "ACTIVE") {
      throw new ForbiddenException("You do not have access to this organization");
    }
    // A platform-suspended (or deleted) organization locks its
    // members out; super admins keep access for support/recovery.
    try {
      const org = await (this.prisma as any).organization?.findUnique({ where: { id: organizationId }, select: { status: true } });
      if (org?.status && org.status !== "ACTIVE") {
        throw new ForbiddenException(`This organization is ${org.status.toLowerCase()} by the platform team`);
      }
    } catch (e) {
      if (e instanceof ForbiddenException) throw e;
      // organization lookup unavailable (older fakes) — do not block
    }
    // Milestone 40 (Admin Phase A4): a scheduled maintenance
    // window with hardLockout refuses tenant WRITES while it is
    // active (reads keep working so teams can see the banner and
    // their data). Admin routes never pass through this guard.
    try {
      const method = (req.method ?? "GET").toUpperCase();
      if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
        if (Date.now() - maintenanceCache.at > 30000) {
          const row = await (this.prisma as any).systemSetting?.findUnique({ where: { key: "maintenanceWindow" } });
          maintenanceCache = { at: Date.now(), window: row?.value ?? null };
        }
        const w = maintenanceCache.window;
        if (w?.hardLockout && w.startsAt && w.endsAt) {
          const now = Date.now();
          if (new Date(w.startsAt).getTime() <= now && now <= new Date(w.endsAt).getTime()) {
            throw new ServiceUnavailableException(w.message || "রক্ষণাবেক্ষণ চলছে — সাময়িকভাবে পরিবর্তন বন্ধ আছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।");
          }
        }
      }
    } catch (e) {
      if (e instanceof ServiceUnavailableException) throw e;
      // settings lookup unavailable — do not block
    }
    // Milestone 35 (Phase N1): a PAST_DUE organization is
    // read-only. Reads keep working (the team can see everything
    // and visit Billing), writes are refused until the platform
    // team records payment / renews the subscription. Billing
    // routes stay writable so a plan change can still be
    // requested. Defensive like the org-status check above:
    // a missing subscription table/row never blocks.
    try {
      const method = (req.method ?? "GET").toUpperCase();
      const path: string = req.originalUrl ?? req.url ?? "";
      if (!["GET", "HEAD", "OPTIONS"].includes(method) && !path.includes("/billing/")) {
        const sub = await (this.prisma as any).subscription?.findFirst({
          where: { organizationId }, orderBy: { createdAt: "desc" }, select: { status: true },
        });
        if (sub?.status === "PAST_DUE") {
          throw new ForbiddenException("This organization's subscription is past due — the workspace is read-only until payment is recorded. You can still view everything and request a plan change from Billing.");
        }
      }
    } catch (e) {
      if (e instanceof ForbiddenException) throw e;
      // subscription lookup unavailable (older fakes) — do not block
    }
    // Milestone 38 (Admin Phase A2): view-as sessions are bound
    // to ONE organization and, in read mode, cannot write at
    // all. The claim comes from the signed token (JwtAuthGuard);
    // the admin who started the session is in the audit trail.
    const viewAs = (req.user as any)?.viewAs;
    if (viewAs) {
      if (viewAs.orgId !== organizationId) {
        throw new ForbiddenException("This view-as session is limited to a single organization");
      }
      // Admin Polish AP2: the token alone is no longer enough —
      // its server-side session must exist and be live (not
      // revoked, not expired). Tokens minted before AP2 carry
      // no sessionId and are rejected here. A missing table
      // (older unit fakes) throws synchronously — caught.
      let session: any = null;
      if (viewAs.sessionId) {
        try {
          session = await (this.prisma as any).viewAsSession.findUnique({ where: { id: viewAs.sessionId } });
        } catch { session = null; }
      }
      if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now() || session.organizationId !== organizationId) {
        throw new ForbiddenException("This view-as session has been revoked or has expired. The admin can start a new session.");
      }
      const method = (req.method ?? "GET").toUpperCase();
      if (viewAs.mode !== "write" && !["GET", "HEAD", "OPTIONS"].includes(method)) {
        throw new ForbiddenException("This is a read-only view-as session — changes are disabled. The admin can start a write session if a fix is needed.");
      }
    }
    // GB6 (GC16): attach the member's CustomRole areas (if any)
    // so RolesGuard can gate area-tagged endpoints by the
    // custom role. Fully defensive: any lookup failure leaves
    // customRoleAreas undefined and access falls back to the
    // ordinary role/override behaviour — never blocks.
    if ((membership as any).customRoleId) {
      try {
        if (typeof (this.prisma as any).customRole?.findUnique === "function") {
          const row = await (this.prisma as any).customRole.findUnique({ where: { id: (membership as any).customRoleId } });
          const areas = Array.isArray(row?.areas) ? row.areas : [];
          (membership as any).customRoleAreas = areas.filter(
            (k: unknown): k is string => typeof k === "string" && PERMISSION_AREA_KEYS.includes(k),
          );
        }
      } catch { /* custom-role lookup unavailable — do not block */ }
    }
    req.membership = membership;
    req.organizationId = organizationId;
    return true;
  }
}
