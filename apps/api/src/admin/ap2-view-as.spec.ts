import { TenantGuard } from "../common/tenant.guard";
import { AdminService } from "./admin.service";
import { ForbiddenException } from "@nestjs/common";

/**
 * Admin Polish AP2: a view-as token is only as good as
 * its server-side session row. Revoke the row and the
 * token dies immediately, long before its 30 minutes.
 */
function guardCtx(session: any, viewAsExtra: any = {}) {
  const req: any = {
    params: { organizationId: "org-1" }, headers: {}, method: "GET",
    user: { userId: "target-1", isSuperAdmin: false, viewAs: { adminId: "admin-1", orgId: "org-1", mode: "read", sessionId: "sess-1", ...viewAsExtra } },
  };
  const prisma: any = {
    membership: { findUnique: async () => ({ status: "ACTIVE", role: "OWNER", userId: "target-1", organizationId: "org-1" }) },
    organization: { findUnique: async () => ({ id: "org-1", status: "ACTIVE" }) },
    viewAsSession: { findUnique: async ({ where }: any) => (where.id === "sess-1" ? session : null) },
  };
  return { ctx: { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => null, getClass: () => null } as any, prisma };
}
const live = { id: "sess-1", organizationId: "org-1", revokedAt: null, expiresAt: new Date(Date.now() + 10 * 60000) };

describe("AP2 TenantGuard view-as registry check", () => {
  it("a live session passes", async () => {
    const { ctx, prisma } = guardCtx({ ...live });
    await expect(new TenantGuard(prisma).canActivate(ctx)).resolves.toBe(true);
  });
  it("a revoked session is refused", async () => {
    const { ctx, prisma } = guardCtx({ ...live, revokedAt: new Date() });
    await expect(new TenantGuard(prisma).canActivate(ctx)).rejects.toMatchObject({ code: "common.viewAsRevoked" });
  });
  it("an expired session is refused", async () => {
    const { ctx, prisma } = guardCtx({ ...live, expiresAt: new Date(Date.now() - 1000) });
    await expect(new TenantGuard(prisma).canActivate(ctx)).rejects.toMatchObject({ code: "common.viewAsRevoked" });
  });
  it("a legacy token without a session id is refused", async () => {
    const { ctx, prisma } = guardCtx({ ...live }, { sessionId: undefined });
    await expect(new TenantGuard(prisma).canActivate(ctx)).rejects.toMatchObject({ code: "common.viewAsRevoked" });
  });
});

describe("AP2 AdminService session registry", () => {
  function setup() {
    const rows: any[] = [{ id: "sess-1", adminId: "admin-1", adminEmail: "a@x", targetUserId: "target-1", organizationId: "org-1", mode: "read", reason: "help", expiresAt: new Date(Date.now() + 10 * 60000), revokedAt: null, createdAt: new Date() }];
    const prisma: any = {
      viewAsSession: {
        findMany: async () => rows,
        findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
        update: async ({ where, data }: any) => { const r = rows.find((x) => x.id === where.id); Object.assign(r, data); return r; },
      },
    };
    const svc = new AdminService(prisma, { log: async () => undefined } as any);
    return { svc, rows };
  }
  it("list flags active sessions", async () => {
    const { svc } = setup();
    const out = await svc.listViewAsSessions({ id: "admin-1" });
    expect(out[0].active).toBe(true);
  });
  it("the owning admin can revoke; afterwards the row is inactive", async () => {
    const { svc, rows } = setup();
    const out = await svc.revokeViewAsSession({ id: "admin-1" }, "sess-1");
    expect(out.active).toBe(false);
    expect(rows[0].revokedAt).toBeInstanceOf(Date);
    expect(rows[0].revokedById).toBe("admin-1");
  });
  it("another non-super admin cannot revoke someone else's session", async () => {
    const { svc } = setup();
    await expect(svc.revokeViewAsSession({ id: "admin-2" }, "sess-1")).rejects.toMatchObject({ code: "admin.onlyTheSessionSAdminOr" });
  });
  it("a SUPER admin can revoke any session", async () => {
    const { svc } = setup();
    const out = await svc.revokeViewAsSession({ id: "admin-9", adminTier: "SUPER" }, "sess-1");
    expect(out.active).toBe(false);
  });
});
