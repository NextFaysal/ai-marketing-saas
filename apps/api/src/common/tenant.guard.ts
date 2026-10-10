import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

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
    req.membership = membership;
    req.organizationId = organizationId;
    return true;
  }
}
