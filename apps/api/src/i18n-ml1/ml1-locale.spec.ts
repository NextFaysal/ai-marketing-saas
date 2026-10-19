import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * ML1 (Multi-Language MB1) — locale fields:
 * PATCH /auth/me/preferences service semantics (undefined = no
 * change, null = clear to the org default, "bn"/"en" = set,
 * anything else refused) and OrganizationsService
 * .updateDashboardLocale (OWNER/ADMIN via assertOrgAdmin only,
 * audited, returns the getOne tenant view carrying
 * dashboardLocale). Hand-rolled fake Prisma in the codebase's
 * spec pattern (see organizations/org-ob2-identity.spec.ts).
 */
type Row = Record<string, any>;
function match(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (k === "userId_organizationId" && v && typeof v === "object") {
      return row.userId === (v as any).userId && row.organizationId === (v as any).organizationId;
    }
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return ((v as any).in as any[]).includes(row[k]);
      return true;
    }
    return row[k] === v;
  });
}
function table(rows: Row[]) {
  return {
    rows,
    findUnique: jest.fn(async ({ where }: any) => {
      if (where.id) return rows.find((r) => r.id === where.id) ?? null;
      return rows.find((r) => match(r, where)) ?? null;
    }),
    findMany: jest.fn(async ({ where }: any = {}) => rows.filter((r) => match(r, where))),
    update: jest.fn(async ({ where, data }: any) => {
      const r = rows.find((x) => (where.id ? x.id === where.id : match(x, where)));
      if (r) Object.assign(r, data);
      return r;
    }),
  };
}

function makeAuth(initialLocale: string | null = null) {
  const users: Row[] = [
    { id: "u-1", email: "tenant@x.com", name: "Tenant", isSuperAdmin: false, status: "ACTIVE", preferredLocale: initialLocale },
  ];
  const db: any = { user: table(users) };
  const jwt: any = { signAsync: async () => "signed-token" };
  const audit: any = { log: jest.fn(async () => undefined) };
  return { svc: new AuthService(db, jwt, audit), db, users };
}

function makeOrgs() {
  const org: Row = {
    id: "org-1", name: "Acme Trading", slug: "acme", creditMinor: 0n, dashboardLocale: "bn",
  };
  const memberships: Row[] = [
    { id: "m-owner", userId: "owner-1", organizationId: "org-1", role: "OWNER", status: "ACTIVE", user: { id: "owner-1", name: "Owner", email: "o@x.com" } },
    { id: "m-agent", userId: "agent-1", organizationId: "org-1", role: "SUPPORT_AGENT", status: "ACTIVE", user: { id: "agent-1", name: "Agent", email: "s@x.com" } },
  ];
  const db: any = {
    membership: table(memberships),
    organization: table([org]),
  };
  const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
  const svc = new OrganizationsService(db, audit as any);
  return { svc, db, audit, org };
}

describe("ML1 — AuthService.updateMyPreferences", () => {
  it("sets bn", async () => {
    const { svc, users } = makeAuth();
    const out = await svc.updateMyPreferences("u-1", "bn");
    expect(out).toEqual({ preferredLocale: "bn" });
    expect(users[0].preferredLocale).toBe("bn");
  });

  it("clears the preference on null (back to the org default)", async () => {
    const { svc, users } = makeAuth("en");
    const out = await svc.updateMyPreferences("u-1", null);
    expect(out).toEqual({ preferredLocale: null });
    expect(users[0].preferredLocale).toBeNull();
  });

  it('rejects "fr" with BadRequest and writes nothing', async () => {
    const { svc, db, users } = makeAuth();
    await expect(svc.updateMyPreferences("u-1", "fr")).rejects.toBeInstanceOf(BadRequestException);
    expect(users[0].preferredLocale).toBeNull();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("no-ops on undefined and returns the current value", async () => {
    const { svc, db, users } = makeAuth("en");
    const out = await svc.updateMyPreferences("u-1", undefined);
    expect(out).toEqual({ preferredLocale: "en" });
    expect(users[0].preferredLocale).toBe("en");
    expect(db.user.update).not.toHaveBeenCalled();
  });
});

describe("ML1 — OrganizationsService.updateDashboardLocale", () => {
  it("rejects a non-admin member (Forbidden) and changes nothing", async () => {
    const { svc, audit, org } = makeOrgs();
    await expect(
      svc.updateDashboardLocale("org-1", "agent-1", { dashboardLocale: "en" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(org.dashboardLocale).toBe("bn");
    expect(audit.calls).toHaveLength(0);
  });

  it("updates for OWNER, audits, and returns the view containing dashboardLocale", async () => {
    const { svc, audit, org } = makeOrgs();
    const out: any = await svc.updateDashboardLocale("org-1", "owner-1", { dashboardLocale: "en" }, "1.2.3.4");
    expect(out.dashboardLocale).toBe("en");
    expect(org.dashboardLocale).toBe("en");
    const entry = audit.calls.find((c) => c.action === "org.dashboard_locale_updated");
    expect(entry).toBeTruthy();
    expect(entry.organizationId).toBe("org-1");
    expect(entry.userId).toBe("owner-1");
    expect(entry.entityType).toBe("Organization");
    expect(entry.entityId).toBe("org-1");
    expect(entry.metadata).toEqual({ dashboardLocale: "en" });
    expect(entry.ipAddress).toBe("1.2.3.4");
  });
});
