import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { OrganizationsService } from "./organizations.service";
import { TenantGuard } from "../common/tenant.guard";

/** Milestone 35 (Phase N1): onboarding state, OWNER member-TOTP
 * reset, and the PAST_DUE read-only gate in TenantGuard. */
function table(seed: any[] = []) {
  const rows = [...seed];
  return {
    rows,
    findUnique: async ({ where }: any) => {
      if (where.userId_organizationId) return rows.find((r) => r.userId === where.userId_organizationId.userId && r.organizationId === where.userId_organizationId.organizationId) ?? null;
      return rows.find((r) => r.id === where.id || r.email === where.email) ?? null;
    },
    findFirst: async () => rows[0] ?? null,
    count: async ({ where }: any = {}) => rows.filter((r) => !where.organizationId || r.organizationId === where.organizationId).length,
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      Object.assign(row, data);
      return row;
    },
  };
}

function makeOrgs() {
  const p: any = {
    organization: table([{ id: "org-1", name: "Shop" }]),
    businessProfile: { findUnique: async () => ({ organizationId: "org-1", description: "", websiteUrl: null, industry: null }) },
    store: table([{ id: "st-1", organizationId: "org-1" }]),
    integration: table([]),
    product: table([{ id: "p-1", organizationId: "org-1" }, { id: "p-2", organizationId: "org-1" }]),
    adAccount: table([]),
    campaignPlan: table([]),
    membership: table([
      { id: "m-1", userId: "u-owner", organizationId: "org-1", role: "OWNER", status: "ACTIVE" },
      { id: "m-2", userId: "u-member", organizationId: "org-1", role: "VIEWER", status: "ACTIVE" },
    ]),
    user: table([{ id: "u-member", email: "member@x.com", totpEnabled: true, totpSecretEncrypted: "enc" }]),
  };
  const auditEntries: any[] = [];
  const audit: any = { log: async (e: any) => { auditEntries.push(e); } };
  return { svc: new OrganizationsService(p, audit), p, auditEntries };
}

describe("M35 onboarding + member TOTP reset", () => {
  it("computes onboarding steps from real rows only", async () => {
    const { svc } = makeOrgs();
    const state = await svc.getOnboarding("org-1");
    const byKey = Object.fromEntries(state.steps.map((s: any) => [s.key, s.done]));
    expect(byKey).toEqual({ profile: false, store: true, products: true, integration: false, meta: false, team: true, campaign: false });
    expect(state.completed).toBe(3);
    expect(state.total).toBe(7);
    expect(state.allDone).toBe(false);
  });

  it("OWNER reset clears a member's TOTP and audits; non-members 404; members without TOTP 400", async () => {
    const { svc, p, auditEntries } = makeOrgs();
    const out = await svc.resetMemberTotp("org-1", "u-owner", "u-member");
    expect(out.totpEnabled).toBe(false);
    expect(p.user.rows[0].totpEnabled).toBe(false);
    expect(p.user.rows[0].totpSecretEncrypted).toBeNull();
    expect(auditEntries.some((e: any) => e.action === "org.member_totp_reset")).toBe(true);
    await expect(svc.resetMemberTotp("org-1", "u-owner", "u-member")).rejects.toBeInstanceOf(ApiException);
    await expect(svc.resetMemberTotp("org-1", "u-owner", "u-stranger")).rejects.toBeInstanceOf(ApiException);
  });
});

describe("M35 PAST_DUE read-only gate (TenantGuard)", () => {
  function guardWith(subStatus: string | null) {
    const p: any = {
      membership: { findUnique: async () => ({ userId: "u-1", organizationId: "org-1", role: "OWNER", status: "ACTIVE" }) },
      organization: { findUnique: async () => ({ status: "ACTIVE" }) },
      subscription: { findFirst: async () => (subStatus ? { status: subStatus } : null) },
    };
    return new TenantGuard(p);
  }
  function ctx(method: string, url: string) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ params: { organizationId: "org-1" }, headers: {}, user: { userId: "u-1", isSuperAdmin: false }, method, originalUrl: url }),
      }),
    } as any;
  }

  it("blocks writes for PAST_DUE orgs but allows reads and billing requests", async () => {
    const guard = guardWith("PAST_DUE");
    await expect(guard.canActivate(ctx("POST", "/organizations/org-1/products"))).rejects.toBeInstanceOf(ApiException);
    await expect(guard.canActivate(ctx("GET", "/organizations/org-1/products"))).resolves.toBe(true);
    await expect(guard.canActivate(ctx("POST", "/organizations/org-1/billing/plan-request"))).resolves.toBe(true);
  });

  it("does not block ACTIVE or TRIALING orgs", async () => {
    await expect(guardWith("ACTIVE").canActivate(ctx("POST", "/organizations/org-1/products"))).resolves.toBe(true);
    await expect(guardWith("TRIALING").canActivate(ctx("POST", "/organizations/org-1/products"))).resolves.toBe(true);
    await expect(guardWith(null).canActivate(ctx("POST", "/organizations/org-1/products"))).resolves.toBe(true);
  });
});
