import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Optional, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { createHash } from "node:crypto";
import { IS_PUBLIC_KEY } from "./decorators";
import { PrismaService } from "../prisma/prisma.service";
import { hasScope, requiredGrant } from "./api-key-scopes";
import { readEmailVerificationGate, verificationRequiredFor } from "../auth/verification.service";
import { forbidden, unauthorized } from "../i18n";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    // Milestone 40: admin API keys authenticate /admin/* without a
    // browser session. Prisma is global; optional so unit tests
    // that construct the guard with two args keep working.
    @Optional() private readonly prisma?: PrismaService,
  ) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (!header?.startsWith("Bearer ")) {
      // Admin API key path (Milestone 40): only for /admin routes.
      const apiKey = req.headers?.["x-admin-api-key"];
      const url = String(req.originalUrl ?? req.url ?? "");
      if (apiKey && url.includes("/admin/") && this.prisma) {
        const keyHash = createHash("sha256").update(String(apiKey)).digest("hex");
        const row = await (this.prisma as any).adminApiKey?.findUnique({ where: { keyHash } }).catch(() => null);
        if (row && !row.revokedAt) {
          const creator = await (this.prisma as any).user.findUnique({ where: { id: row.createdById } }).catch(() => null);
          if (creator) {
            // Admin Polish AP3: enforce the key's scopes for this
            // route. Legacy keys (empty list) keep full access.
            const grant = requiredGrant(String((req as any).method ?? "GET"), url);
            if (!hasScope((row as any).scopes, grant)) {
              throw forbidden("common.apiKeyLacksScope", { grant: grant });
            }
            req.user = {
              userId: creator.id, email: creator.email, isSuperAdmin: !!creator.isSuperAdmin,
              tv: creator.tokenVersion ?? 0, viaApiKey: true, apiKeyId: row.id,
            };
            // Throttled last-used stamp.
            if (!row.lastUsedAt || Date.now() - new Date(row.lastUsedAt).getTime() > 60000) {
              void (this.prisma as any).adminApiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
            }
            return true;
          }
        }
      }
      throw unauthorized("common.missingAuthHeader");
    }
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(header.slice(7));
      req.user = {
        userId: payload.sub, email: payload.email, isSuperAdmin: !!payload.isSuperAdmin,
        // Token version must reach SuperAdminGuard — without it a
        // revoked-then-relogged admin could never match again.
        tv: payload.tv ?? 0,
        // Milestone 38: admin view-as sessions carry this claim;
        // TenantGuard enforces its org binding + read-only mode.
        viewAs: payload.viewAs ?? undefined,
      };
    } catch {
      throw unauthorized("common.invalidToken");
    }
    // GB6 (GC16): server-side session check for tokens carrying
    // a `sid` claim. A session row that is GONE (null) or revoked
    // rejects the token; a lookup ERROR (undefined — table
    // missing, DB hiccup) allows it, so an infra failure can
    // never lock every user out. Tokens without sid (minted
    // before GB6) are untouched, as is the API-key path above.
    (req.user as any).sid = payload.sid ?? undefined;
    if (payload.sid && this.prisma) {
      let row: any = undefined;
      try {
        row = await (this.prisma as any).userSession?.findUnique({ where: { id: payload.sid } });
      } catch { row = undefined; }
      if (row === null || row?.revokedAt) {
        throw unauthorized("common.sessionRevoked");
      }
      if (row && (!row.lastSeenAt || Date.now() - new Date(row.lastSeenAt).getTime() > 60000)) {
        void (this.prisma as any).userSession.update({
          where: { id: row.id }, data: { lastSeenAt: new Date() },
        }).catch(() => undefined);
      }
    }
    // GC21 (GB9): email-verification enforcement gate. The
    // platform setting "emailVerificationGate" = { enforced,
    // since } turns it on; absent/off = everyone passes. A user
    // created at/after `since` with no emailVerifiedAt is blocked
    // from every non-/auth route (they must still be able to call
    // /auth/me, resend the link, verify, and log out). Users
    // created BEFORE `since` are grandfathered — never blocked.
    // FAIL OPEN on any lookup/settings error: an infra hiccup
    // must not lock every tenant out.
    if (this.prisma) {
      const rawUrl = String(req.originalUrl ?? req.url ?? "");
      const path = rawUrl.split("?")[0];
      if (!path.startsWith("/auth/") && path !== "/auth") {
        try {
          const gate = await readEmailVerificationGate(this.prisma as any);
          if (gate.enforced) {
            const gateUser = await (this.prisma as any).user?.findUnique?.({
              where: { id: payload.sub },
              select: { emailVerifiedAt: true, createdAt: true },
            }).catch(() => undefined);
            if (gateUser && verificationRequiredFor(gateUser, gate)) {
              throw new ForbiddenException({
                statusCode: 403,
                code: "EMAIL_VERIFICATION_REQUIRED",
                message: "আপনার ইমেইল এখনো যাচাই করা হয়নি — ড্যাশবোর্ড ব্যবহারের আগে ইমেইলে পাঠানো লিংক থেকে যাচাই করুন।",
                error: "Forbidden",
              });
            }
          }
        } catch (e) {
          if (e instanceof ForbiddenException) throw e;
          // Any other failure (settings row shape, DB error)
          // fails OPEN by design.
        }
      }
    }
    return true;
  }
}
