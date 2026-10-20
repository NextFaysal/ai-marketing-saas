import { CanActivate, ExecutionContext, ForbiddenException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { PERMISSION_AREA_KEYS } from "./permission-catalog";
import { ApiException, forbidden, renderMessage, withCatalogCode } from "../i18n";

// Milestone 40: scheduled maintenance windows live in
// SystemSetting; the guard caches the row briefly.
let maintenanceCache: { at: number; window: any } = { at: 0, window: null };

/**
 * ORG3 (Organization Next OB1): while an organization is archived
 * (Organization.archivedAt set by its OWNER), the only org-scoped
 * paths that stay open are the OWNER's own lifecycle + data paths:
 * reading the org itself, restore/archive, ownership transfer,
 * leave, and the data-tools export surface (create/list/download
 * + backup preference + the audit-log viewer). Everything else —
 * for every member, the owner included — is refused until the
 * org is restored. Platform suspension (org.status) is a separate
 * check and still wins first.
 */
export function isArchivedOwnerPath(url: string, method: string, organizationId: string): boolean {
  const path = (url || "").split("?")[0].replace(/\/+$/, "");
  const base = `/organizations/${organizationId}`;
  if (!path.startsWith(base)) return false;
  const rest = path.slice(base.length);
  if (rest === "") return method === "GET"; // getOne — the limited screen's own data
  if (rest === "/restore" || rest === "/archive" || rest === "/transfer-ownership" || rest === "/leave") {
    return method === "POST";
  }
  if (rest === "/data-exports" || rest.startsWith("/data-exports/")) return true;
  // ORG16: bundle restore sits beside export — an owner restoring
  // a backup into an archived (still empty) org, then un-archiving,
  // is the recovery flow the export allowlist already exists for.
  if (rest === "/data-imports" || rest.startsWith("/data-imports/")) return true;
  if (rest === "/audit-logs") return method === "GET";
  return false;
}

/**
 * ORG11 (Organization Next OB4): while an org's security policy
 * blocks a member (MFA required but not enabled on their account,
 * or their session is older than the org's cap), these paths stay
 * open so the member is never trapped: reading the org itself
 * (the dashboard identifies the workspace from it), reading the
 * policy (the dashboard gate probes exactly this to render its
 * explanation screen), and leaving the organization. Everything
 * the member needs to FIX the state — MFA setup (/auth/totp/*),
 * logout/login, the org list — is not org-scoped at all and never
 * reaches this guard. PATCH security-policy is deliberately NOT
 * here: a password-compromised OWNER account must not be able to
 * switch the org's MFA requirement off to walk in.
 */
export function isOrgSecurityBypassPath(url: string, method: string, organizationId: string): boolean {
  const path = (url || "").split("?")[0].replace(/\/+$/, "");
  const base = `/organizations/${organizationId}`;
  if (!path.startsWith(base)) return false;
  const rest = path.slice(base.length);
  if (rest === "") return method === "GET";
  if (rest === "/security-policy") return method === "GET";
  if (rest === "/leave") return method === "POST";
  return false;
}

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
    if (!req.user?.userId) throw forbidden("common.authRequired");
    if (req.user.isSuperAdmin) { req.organizationId = organizationId; return true; }
    const membership = await (this.prisma as any).membership.findUnique({
      where: { userId_organizationId: { userId: req.user.userId, organizationId } },
    });
    if (!membership || membership.status !== "ACTIVE") {
      throw forbidden("common.noOrgAccess");
    }
    // A platform-suspended (or deleted) organization locks its
    // members out; super admins keep access for support/recovery.
    try {
      const org = await (this.prisma as any).organization?.findUnique({ where: { id: organizationId }, select: { status: true, archivedAt: true } });
      if (org?.status && org.status !== "ACTIVE") {
        throw forbidden("common.orgStatusBlocked", { status: org.status.toLowerCase() });
      }
      // ORG3: a tenant-archived organization is closed for work
      // until the OWNER restores it. Only the owner's lifecycle /
      // export paths (isArchivedOwnerPath) stay open; members are
      // fully blocked, the owner included outside those paths.
      if (org?.archivedAt) {
        const method = (req.method ?? "GET").toUpperCase();
        const url: string = req.originalUrl ?? req.url ?? "";
        const isOwner = membership.role === "OWNER";
        if (!isOwner || !isArchivedOwnerPath(url, method, organizationId)) {
          throw withCatalogCode(
            new ForbiddenException(renderMessage("bn", isOwner ? "common.orgArchivedOwner" : "common.orgArchivedMember")),
            isOwner ? "common.orgArchivedOwner" : "common.orgArchivedMember",
          );
        }
      }
    } catch (e) {
      // Deliberate blocks (typed ForbiddenException and coded
      // ApiException) always propagate; only lookup failures
      // fall through open.
      if (e instanceof ForbiddenException || e instanceof ApiException) throw e;
      // organization lookup unavailable (older fakes) — do not block
    }
    // ORG11 (Organization Next OB4): org security policy — MFA
    // requirement + session-age cap. Enforced HERE, per request,
    // because the policy is per-org while sessions are global: the
    // same member may be blocked in one org and fine in another.
    // Session age is measured from the server-side UserSession row
    // (GB6); a token without a sid cannot be aged, so a capped org
    // refuses it (the remedy — a fresh login — is always open).
    // Defensive like the blocks above: any lookup failure fails
    // OPEN, so an infra hiccup cannot lock a whole org out; only a
    // positively-read policy + positively-read member state blocks.
    try {
      const org = await (this.prisma as any).organization?.findUnique({
        where: { id: organizationId },
        select: { requireMfa: true, sessionMaxAgeHours: true },
      });
      const cap = typeof org?.sessionMaxAgeHours === "number" && Number.isInteger(org.sessionMaxAgeHours) && org.sessionMaxAgeHours > 0
        ? org.sessionMaxAgeHours : null;
      if (org && (org.requireMfa === true || cap !== null)) {
        const method = (req.method ?? "GET").toUpperCase();
        const url: string = req.originalUrl ?? req.url ?? "";
        if (!isOrgSecurityBypassPath(url, method, organizationId)) {
          if (org.requireMfa === true) {
            const me = await (this.prisma as any).user?.findUnique({
              where: { id: req.user.userId }, select: { totpEnabled: true },
            });
            if (me && me.totpEnabled !== true) {
              throw new ForbiddenException({
                statusCode: 403,
                code: "ORG_MFA_REQUIRED",
                message: "এই Organization-এ MFA (2FA) বাধ্যতামূলক — আগে Settings → নিরাপত্তা (2FA) থেকে নিজের অ্যাকাউন্টে MFA চালু করুন, তারপর আবার চেষ্টা করুন।",
                error: "Forbidden",
              });
            }
          }
          if (cap !== null) {
            const sid = (req.user as any)?.sid as string | undefined;
            let tooOld = !sid; // un-ageable legacy token — a capped org requires a fresh login
            if (sid) {
              const session = await (this.prisma as any).userSession?.findUnique({
                where: { id: sid }, select: { createdAt: true },
              });
              if (session?.createdAt) {
                tooOld = Date.now() - new Date(session.createdAt).getTime() > cap * 3_600_000;
              } else {
                tooOld = false; // session row unreadable — fail open (JwtAuthGuard owns revocation)
              }
            }
            if (tooOld) {
              throw new ForbiddenException({
                statusCode: 403,
                code: "ORG_SESSION_EXPIRED",
                message: `এই Organization-এ সেশনের সর্বোচ্চ বয়স ${cap} ঘণ্টা — আপনার সেশন তার চেয়ে পুরনো। আবার লগইন করে চেষ্টা করুন।`,
                params: { hours: cap },
                error: "Forbidden",
              });
            }
          }
        }
      }
    } catch (e) {
      if (e instanceof ForbiddenException) throw e;
      // policy/session lookup unavailable — do not block
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
            throw w.message
              ? new ServiceUnavailableException(w.message)
              : withCatalogCode(new ServiceUnavailableException(renderMessage("bn", "common.maintenanceLockout")), "common.maintenanceLockout");
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
          throw forbidden("common.orgSubscriptionPastDue");
        }
      }
    } catch (e) {
      if (e instanceof ForbiddenException || e instanceof ApiException) throw e;
      // subscription lookup unavailable (older fakes) — do not block
    }
    // Milestone 38 (Admin Phase A2): view-as sessions are bound
    // to ONE organization and, in read mode, cannot write at
    // all. The claim comes from the signed token (JwtAuthGuard);
    // the admin who started the session is in the audit trail.
    const viewAs = (req.user as any)?.viewAs;
    if (viewAs) {
      if (viewAs.orgId !== organizationId) {
        throw forbidden("common.viewAsSingleOrg");
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
        throw forbidden("common.viewAsRevoked");
      }
      const method = (req.method ?? "GET").toUpperCase();
      if (viewAs.mode !== "write" && !["GET", "HEAD", "OPTIONS"].includes(method)) {
        throw forbidden("common.viewAsReadOnly");
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
