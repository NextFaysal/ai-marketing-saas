import { TenantGuard, isArchivedOwnerPath, isOrgSecurityBypassPath } from "./tenant.guard";
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

describe("TenantGuard — ORG3 archived organizations", () => {
  function archivedCtx(membership: any, org: any, url: string, method = "GET") {
    const req: any = {
      params: { organizationId: "org-1" }, headers: {},
      user: { userId: "user-1", isSuperAdmin: false },
      method, originalUrl: url, url,
    };
    const prisma: any = {
      membership: { findUnique: async () => membership },
      organization: { findUnique: async () => org },
    };
    return {
      req, prisma,
      ctx: { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => null, getClass: () => null } as any,
    };
  }
  const ARCHIVED = { status: "ACTIVE", archivedAt: new Date("2026-10-16T00:00:00Z") };
  const owner = { status: "ACTIVE", role: "OWNER" };
  const admin = { status: "ACTIVE", role: "ADMIN" };

  it("blocks a non-owner member entirely while archived", async () => {
    const { ctx, prisma } = archivedCtx(admin, ARCHIVED, "/organizations/org-1/members");
    await expect(new TenantGuard(prisma).canActivate(ctx)).rejects.toThrow(/archived by its owner/);
  });

  it("blocks the owner outside the lifecycle/export allowlist", async () => {
    const { ctx, prisma } = archivedCtx(owner, ARCHIVED, "/organizations/org-1/products", "POST");
    await expect(new TenantGuard(prisma).canActivate(ctx)).rejects.toThrow(/restore it to continue/);
  });

  it("lets the owner restore", async () => {
    const { ctx, prisma } = archivedCtx(owner, ARCHIVED, "/organizations/org-1/restore", "POST");
    await expect(new TenantGuard(prisma).canActivate(ctx)).resolves.toBe(true);
  });

  it("lets the owner use the data-export surface", async () => {
    const post = archivedCtx(owner, ARCHIVED, "/organizations/org-1/data-exports", "POST");
    await expect(new TenantGuard(post.prisma).canActivate(post.ctx)).resolves.toBe(true);
    const dl = archivedCtx(owner, ARCHIVED, "/organizations/org-1/data-exports/exp-1/download", "GET");
    await expect(new TenantGuard(dl.prisma).canActivate(dl.ctx)).resolves.toBe(true);
  });

  it("lets the owner read the org itself (the limited screen's data)", async () => {
    const { ctx, prisma } = archivedCtx(owner, ARCHIVED, "/organizations/org-1", "GET");
    await expect(new TenantGuard(prisma).canActivate(ctx)).resolves.toBe(true);
  });

  it("does not block anyone when the org is not archived", async () => {
    const { ctx, prisma } = archivedCtx(admin, { status: "ACTIVE", archivedAt: null }, "/organizations/org-1/members");
    await expect(new TenantGuard(prisma).canActivate(ctx)).resolves.toBe(true);
  });

  it("platform suspension still wins over the archived branch", async () => {
    const { ctx, prisma } = archivedCtx(owner, { status: "SUSPENDED", archivedAt: new Date() }, "/organizations/org-1/restore", "POST");
    await expect(new TenantGuard(prisma).canActivate(ctx)).rejects.toThrow(/suspended by the platform team/);
  });

  it("isArchivedOwnerPath: allowlist shape", () => {
    expect(isArchivedOwnerPath("/organizations/o/restore", "POST", "o")).toBe(true);
    expect(isArchivedOwnerPath("/organizations/o/restore", "GET", "o")).toBe(false);
    expect(isArchivedOwnerPath("/organizations/o/transfer-ownership", "POST", "o")).toBe(true);
    expect(isArchivedOwnerPath("/organizations/o/leave", "POST", "o")).toBe(true);
    expect(isArchivedOwnerPath("/organizations/o/data-exports/x/download", "GET", "o")).toBe(true);
    expect(isArchivedOwnerPath("/organizations/o/data-exports/backup-preference", "PUT", "o")).toBe(true);
    expect(isArchivedOwnerPath("/organizations/o/members", "GET", "o")).toBe(false);
    expect(isArchivedOwnerPath("/organizations/o", "GET", "o")).toBe(true);
    expect(isArchivedOwnerPath("/organizations/o", "DELETE", "o")).toBe(false);
    expect(isArchivedOwnerPath("/organizations/other/restore", "POST", "o")).toBe(false);
  });
});

describe("TenantGuard — ORG11 org security policy (MFA + session age)", () => {
  const HOUR = 3_600_000;
  function policyCtx(opts: {
    org: any; totpEnabled?: boolean; sid?: string; session?: any; url?: string; method?: string;
  }) {
    const req: any = {
      params: { organizationId: "org-1" }, headers: {},
      user: { userId: "user-1", isSuperAdmin: false, ...(opts.sid ? { sid: opts.sid } : {}) },
      method: opts.method ?? "GET",
      originalUrl: opts.url ?? "/organizations/org-1/members",
      url: opts.url ?? "/organizations/org-1/members",
    };
    const prisma: any = {
      membership: { findUnique: async () => ({ status: "ACTIVE", role: "ADMIN" }) },
      organization: { findUnique: async () => opts.org },
      user: { findUnique: async () => ({ totpEnabled: opts.totpEnabled === true }) },
      userSession: { findUnique: async () => opts.session ?? null },
    };
    return {
      req, prisma,
      ctx: { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => null, getClass: () => null } as any,
    };
  }
  const MFA_ORG = { status: "ACTIVE", archivedAt: null, requireMfa: true, sessionMaxAgeHours: null };
  const CAP_ORG = { status: "ACTIVE", archivedAt: null, requireMfa: false, sessionMaxAgeHours: 24 };
  const OPEN_ORG = { status: "ACTIVE", archivedAt: null, requireMfa: false, sessionMaxAgeHours: null };

  async function codeOf(promise: Promise<unknown>): Promise<string | null> {
    try { await promise; return null; } catch (e: any) { return e?.getResponse?.()?.code ?? null; }
  }

  it("blocks an MFA-less member with the stable ORG_MFA_REQUIRED code", async () => {
    const { ctx, prisma } = policyCtx({ org: MFA_ORG, totpEnabled: false });
    await expect(new TenantGuard(prisma).canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    const again = policyCtx({ org: MFA_ORG, totpEnabled: false });
    expect(await codeOf(new TenantGuard(again.prisma).canActivate(again.ctx))).toBe("ORG_MFA_REQUIRED");
  });

  it("admits a member whose MFA is enabled", async () => {
    const { ctx, prisma } = policyCtx({ org: MFA_ORG, totpEnabled: true });
    await expect(new TenantGuard(prisma).canActivate(ctx)).resolves.toBe(true);
  });

  it("the bypass paths stay open while MFA-blocked (org read, policy read, leave)", async () => {
    for (const [url, method] of [
      ["/organizations/org-1", "GET"],
      ["/organizations/org-1/security-policy", "GET"],
      ["/organizations/org-1/leave", "POST"],
    ] as const) {
      const { ctx, prisma } = policyCtx({ org: MFA_ORG, totpEnabled: false, url, method });
      await expect(new TenantGuard(prisma).canActivate(ctx)).resolves.toBe(true);
    }
  });

  it("PATCH security-policy is NOT a bypass — a blocked member cannot reach other writes either", async () => {
    const { ctx, prisma } = policyCtx({ org: MFA_ORG, totpEnabled: false, url: "/organizations/org-1/security-policy", method: "PATCH" });
    expect(await codeOf(new TenantGuard(prisma).canActivate(ctx))).toBe("ORG_MFA_REQUIRED");
  });

  it("blocks a session older than the org cap with ORG_SESSION_EXPIRED", async () => {
    const session = { createdAt: new Date(Date.now() - 72 * HOUR) };
    const { ctx, prisma } = policyCtx({ org: CAP_ORG, sid: "sess-1", session });
    expect(await codeOf(new TenantGuard(prisma).canActivate(ctx))).toBe("ORG_SESSION_EXPIRED");
  });

  it("admits a session younger than the cap", async () => {
    const session = { createdAt: new Date(Date.now() - 2 * HOUR) };
    const { ctx, prisma } = policyCtx({ org: CAP_ORG, sid: "sess-1", session });
    await expect(new TenantGuard(prisma).canActivate(ctx)).resolves.toBe(true);
  });

  it("a sid-less legacy token is refused by a capped org (it cannot be aged)", async () => {
    const { ctx, prisma } = policyCtx({ org: CAP_ORG });
    expect(await codeOf(new TenantGuard(prisma).canActivate(ctx))).toBe("ORG_SESSION_EXPIRED");
  });

  it("no policy = no new blocks; a policy-less legacy org row shape also passes (fail-open)", async () => {
    const open = policyCtx({ org: OPEN_ORG, totpEnabled: false });
    await expect(new TenantGuard(open.prisma).canActivate(open.ctx)).resolves.toBe(true);
    const legacy = policyCtx({ org: { status: "ACTIVE", archivedAt: null }, totpEnabled: false });
    await expect(new TenantGuard(legacy.prisma).canActivate(legacy.ctx)).resolves.toBe(true);
  });

  it("isOrgSecurityBypassPath: allowlist shape", () => {
    expect(isOrgSecurityBypassPath("/organizations/o", "GET", "o")).toBe(true);
    expect(isOrgSecurityBypassPath("/organizations/o", "PATCH", "o")).toBe(false);
    expect(isOrgSecurityBypassPath("/organizations/o/security-policy", "GET", "o")).toBe(true);
    expect(isOrgSecurityBypassPath("/organizations/o/security-policy", "PATCH", "o")).toBe(false);
    expect(isOrgSecurityBypassPath("/organizations/o/leave", "POST", "o")).toBe(true);
    expect(isOrgSecurityBypassPath("/organizations/o/leave", "GET", "o")).toBe(false);
    expect(isOrgSecurityBypassPath("/organizations/o/members", "GET", "o")).toBe(false);
    expect(isOrgSecurityBypassPath("/organizations/other", "GET", "o")).toBe(false);
  });
});
