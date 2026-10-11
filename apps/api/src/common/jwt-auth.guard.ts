import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Optional, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { createHash } from "node:crypto";
import { IS_PUBLIC_KEY } from "./decorators";
import { PrismaService } from "../prisma/prisma.service";
import { hasScope, requiredGrant } from "./api-key-scopes";

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
              throw new ForbiddenException(`This API key lacks the required scope: ${grant}`);
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
      throw new UnauthorizedException("Missing or invalid Authorization header");
    }
    try {
      const payload = await this.jwt.verifyAsync(header.slice(7));
      req.user = {
        userId: payload.sub, email: payload.email, isSuperAdmin: !!payload.isSuperAdmin,
        // Token version must reach SuperAdminGuard — without it a
        // revoked-then-relogged admin could never match again.
        tv: payload.tv ?? 0,
        // Milestone 38: admin view-as sessions carry this claim;
        // TenantGuard enforces its org binding + read-only mode.
        viewAs: payload.viewAs ?? undefined,
      };
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
  }
}
