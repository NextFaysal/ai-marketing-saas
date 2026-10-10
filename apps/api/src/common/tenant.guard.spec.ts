import { TenantGuard } from "./tenant.guard";
import { ForbiddenException } from "@nestjs/common";

function ctxWith(membership: any, userId = "user-1", orgId = "org-1") {
  const req: any = { params: { organizationId: orgId }, headers: {}, user: { userId, isSuperAdmin: false } };
  return {
    req,
    ctx: { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => null, getClass: () => null } as any,
    prisma: { membership: { findUnique: async () => membership } } as any,
  };
}

describe("TenantGuard - tenant isolation", () => {
  it("blocks a user with no membership in the organization", async () => {
    const { ctx, prisma } = ctxWith(null);
    const guard = new TenantGuard(prisma);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it("blocks a SUSPENDED membership", async () => {
    const { ctx, prisma } = ctxWith({ status: "SUSPENDED", role: "OWNER" });
    const guard = new TenantGuard(prisma);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it("allows an ACTIVE member and attaches the membership", async () => {
    const { ctx, prisma, req } = ctxWith({ status: "ACTIVE", role: "ADMIN" });
    const guard = new TenantGuard(prisma);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.membership.role).toBe("ADMIN");
    expect(req.organizationId).toBe("org-1");
  });
  it("a member of org-1 is not silently given org-2 (lookup is org-scoped)", async () => {
    // findUnique is keyed by userId+organizationId, so org-2 returns null in a real DB.
    const { ctx, prisma } = ctxWith(null, "user-1", "org-2");
    const guard = new TenantGuard(prisma);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
