import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { RolesGuard } from "../common/roles.guard";
import { PERMISSION_AREA_KEY, ROLES_KEY } from "../common/decorators";
import { PRESET_ROLE_PROFILES, effectiveAccess, presetProfile } from "../common/permission-catalog";
import { OrganizationsService } from "./organizations.service";

/**
 * GB6 (GC16): custom roles.
 * Guard matrix: a member's CustomRole areas are the baseline on
 * area-tagged endpoints; without a custom role the preset role
 * decides exactly as before; owner-only gates never open via a
 * custom role; denies still win; the OWNER is never gated.
 */
function guardWith(meta: { roles?: string[]; area?: string }) {
  const reflector = {
    getAllAndOverride: (key: string) => (key === ROLES_KEY ? meta.roles : key === PERMISSION_AREA_KEY ? meta.area : undefined),
  } as any;
  return new RolesGuard(reflector);
}
function ctx(req: any) {
  return { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => req }) } as any;
}
const member = (role: string, extra: any = {}) => ({
  user: { userId: "u1", isSuperAdmin: false },
  membership: { role, permissionOverrides: null, ...extra },
});

describe("GB6 RolesGuard custom-role branch", () => {
  it("a custom role admits its own area below the preset role's rank", () => {
    const g = guardWith({ roles: ["SUPPORT_AGENT"], area: "orders" });
    expect(g.canActivate(ctx(member("VIEWER", { customRoleAreas: ["orders"] })))).toBe(true);
  });

  it("a custom role refuses areas it does not list, even ones the endpoint would allow lower roles", () => {
    const g = guardWith({ roles: ["ADMIN"], area: "settings" });
    expect(() => g.canActivate(ctx(member("VIEWER", { customRoleAreas: ["orders"] })))).toThrow(ForbiddenException);
    expect(() => g.canActivate(ctx(member("VIEWER", { customRoleAreas: ["orders"] })))).toThrow(/custom role does not include/);
  });

  it("without customRoleAreas the preset role decides exactly as before", () => {
    const g = guardWith({ roles: ["SUPPORT_AGENT"], area: "orders" });
    expect(() => g.canActivate(ctx(member("VIEWER")))).toThrow(ForbiddenException);
    expect(g.canActivate(ctx(member("SUPPORT_AGENT")))).toBe(true);
  });

  it("owner-only gates are never opened by a custom role, even when the area is in the role", () => {
    const g = guardWith({ roles: ["OWNER"], area: "orders" });
    expect(() => g.canActivate(ctx(member("VIEWER", { customRoleAreas: ["orders"] })))).toThrow(ForbiddenException);
  });

  it("a deny override wins over a custom role containing the area", () => {
    const g = guardWith({ roles: ["SUPPORT_AGENT"], area: "orders" });
    const req = member("VIEWER", { customRoleAreas: ["orders"], permissionOverrides: { denies: ["orders"] } });
    expect(() => g.canActivate(ctx(req))).toThrow(ForbiddenException);
  });

  it("a per-member grant still adds an area on top of a custom role", () => {
    const g = guardWith({ roles: ["ADMIN"], area: "billing" });
    const req = member("VIEWER", { customRoleAreas: ["orders"], permissionOverrides: { grants: ["billing"] } });
    expect(g.canActivate(ctx(req))).toBe(true);
  });

  it("the OWNER's membership is unaffected by customRoleAreas", () => {
    const g = guardWith({ roles: ["ADMIN"], area: "settings" });
    expect(g.canActivate(ctx(member("OWNER", { customRoleAreas: ["orders"] })))).toBe(true);
  });
});

describe("GB6 effectiveAccess with custom areas", () => {
  it("custom areas become the baseline with source 'custom'; grants add, denies close", () => {
    const eff = effectiveAccess("VIEWER" as any, { grants: ["billing"], denies: ["orders"] }, ["orders", "inbox"]);
    const by = new Map(eff.map((e) => [e.key, e]));
    expect(by.get("inbox")).toMatchObject({ allowed: true, source: "custom" });
    expect(by.get("orders")).toMatchObject({ allowed: false, source: "deny" });
    expect(by.get("billing")).toMatchObject({ allowed: true, source: "grant" });
    // role rank no longer leaks through: VIEWER has no analytics by
    // role, and the custom role does not list it either
    expect(by.get("analytics")).toMatchObject({ allowed: false, source: "none" });
  });

  it("preset profiles carry exactly the audited area bundles", () => {
    expect(presetProfile("ORDER_MANAGER")?.areas).toEqual(["inbox", "orders", "customers", "courier", "analytics"]);
    expect(presetProfile("INVENTORY_MANAGER")?.areas).toEqual(["orders", "analytics"]);
    expect(presetProfile("FINANCE")?.areas).toEqual(["billing", "analytics", "orders", "customers"]);
    expect(presetProfile("NOPE")).toBeUndefined();
    expect(PRESET_ROLE_PROFILES).toHaveLength(3);
  });
});

describe("GB6 custom roles service", () => {
  function db() {
    const roles: any[] = [];
    const memberships: any[] = [
      { id: "m-boss", userId: "boss", organizationId: "org", role: "OWNER", status: "ACTIVE", permissionOverrides: null, customRoleId: null, user: { id: "boss", name: "Boss", email: "boss@x.com" } },
      { id: "m-agent", userId: "agent", organizationId: "org", role: "VIEWER", status: "ACTIVE", permissionOverrides: null, customRoleId: null, user: { id: "agent", name: "Agent", email: "agent@x.com" } },
    ];
    let seq = 0;
    const fake: any = {
      customRole: {
        findMany: jest.fn(async ({ where }: any) => roles.filter((r) => r.organizationId === where.organizationId)),
        findFirst: jest.fn(async ({ where }: any) => roles.find((r) =>
          (where.id === undefined || r.id === where.id) &&
          r.organizationId === where.organizationId &&
          (where.name === undefined || r.name === where.name)) ?? null),
        findUnique: jest.fn(async ({ where }: any) => roles.find((r) => r.id === where.id) ?? null),
        create: jest.fn(async ({ data }: any) => { const row = { id: `cr-${++seq}`, createdAt: new Date(), ...data }; roles.push(row); return row; }),
        update: jest.fn(async ({ where, data }: any) => { const row = roles.find((r) => r.id === where.id); Object.assign(row, data); return row; }),
        delete: jest.fn(async ({ where }: any) => { const i = roles.findIndex((r) => r.id === where.id); return roles.splice(i, 1)[0]; }),
      },
      membership: {
        findUnique: jest.fn(async ({ where }: any) => memberships.find((m) =>
          m.userId === where.userId_organizationId.userId && m.organizationId === where.userId_organizationId.organizationId) ?? null),
        update: jest.fn(async ({ where, data }: any) => { const row = memberships.find((m) => m.id === where.id); Object.assign(row!, data); return row; }),
        count: jest.fn(async ({ where }: any) => memberships.filter((m) =>
          m.organizationId === where.organizationId &&
          (where.customRoleId === undefined || m.customRoleId === where.customRoleId)).length),
      },
    };
    const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
    return { svc: new OrganizationsService(fake, audit as any), audit, roles, memberships };
  }

  it("a presetKey expands from the profile (name + areas), and list reports memberCount + profiles", async () => {
    const { svc, audit } = db();
    const created: any = await svc.createCustomRole("org", "boss", { presetKey: "ORDER_MANAGER" });
    expect(created.name).toBe("Order Manager");
    expect(created.presetKey).toBe("ORDER_MANAGER");
    expect(created.areas).toEqual(["inbox", "orders", "customers", "courier", "analytics"]);
    expect(created.memberCount).toBe(0);
    expect(audit.calls[0].action).toBe("org.custom_role_created");

    const list: any = await svc.listCustomRoles("org");
    expect(list.roles).toHaveLength(1);
    expect(list.roles[0].memberCount).toBe(0);
    expect(list.presetProfiles).toHaveLength(3);
  });

  it("presetKey with an explicit name or areas is rejected as ambiguous", async () => {
    const { svc } = db();
    await expect(svc.createCustomRole("org", "boss", { presetKey: "FINANCE", name: "Money" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.createCustomRole("org", "boss", { presetKey: "FINANCE", areas: ["billing"] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.createCustomRole("org", "boss", { presetKey: "WIZARD" })).rejects.toThrow(/Unknown preset/);
  });

  it("unknown areas are named in the 400; empty areas and bad names are refused", async () => {
    const { svc } = db();
    await expect(svc.createCustomRole("org", "boss", { name: "X", areas: ["orders", "mars"] })).rejects.toThrow(/Unknown permission areas: mars/);
    await expect(svc.createCustomRole("org", "boss", { name: "X", areas: [] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.createCustomRole("org", "boss", { name: "  ", areas: ["orders"] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("duplicate names are refused per org", async () => {
    const { svc } = db();
    await svc.createCustomRole("org", "boss", { name: "Desk", areas: ["orders"] });
    await expect(svc.createCustomRole("org", "boss", { name: "Desk", areas: ["inbox"] })).rejects.toThrow(/already exists/);
    // the same name in ANOTHER org is fine
    await expect(svc.createCustomRole("org2", "boss", { name: "Desk", areas: ["inbox"] })).resolves.toMatchObject({ name: "Desk" });
  });

  it("assign: happy path returns the access picture; clearing works; delete of an assigned role is refused", async () => {
    const { svc, audit } = db();
    const role: any = await svc.createCustomRole("org", "boss", { presetKey: "FINANCE" });
    const picture: any = await svc.assignMemberCustomRole("org", "boss", "agent", { customRoleId: role.id });
    expect(picture.customRole).toMatchObject({ id: role.id, name: "Finance", presetKey: "FINANCE" });
    expect(picture.effective.find((e: any) => e.key === "billing")).toMatchObject({ allowed: true, source: "custom" });
    expect(picture.effective.find((e: any) => e.key === "team")).toMatchObject({ allowed: false, source: "none" });
    expect(audit.calls.some((c: any) => c.action === "org.member_custom_role_updated" && c.metadata.customRoleName === "Finance")).toBe(true);

    const list: any = await svc.listCustomRoles("org");
    expect(list.roles[0].memberCount).toBe(1);
    await expect(svc.deleteCustomRole("org", "boss", role.id)).rejects.toThrow(/assigned to 1 member/);

    const cleared: any = await svc.assignMemberCustomRole("org", "boss", "agent", { customRoleId: null });
    expect(cleared.customRole).toBeNull();
    await expect(svc.deleteCustomRole("org", "boss", role.id)).resolves.toMatchObject({ ok: true });
  });

  it("assign: a role from another org is a 404, and the OWNER cannot be customized", async () => {
    const { svc } = db();
    const foreign: any = await svc.createCustomRole("org2", "boss", { name: "Foreign", areas: ["orders"] });
    await expect(svc.assignMemberCustomRole("org", "boss", "agent", { customRoleId: foreign.id })).rejects.toBeInstanceOf(NotFoundException);
    const own: any = await svc.createCustomRole("org", "boss", { name: "Local", areas: ["orders"] });
    await expect(svc.assignMemberCustomRole("org", "boss", "boss", { customRoleId: own.id })).rejects.toThrow(/owner's access cannot/);
    await expect(svc.assignMemberCustomRole("org", "boss", "ghost", { customRoleId: own.id })).rejects.toBeInstanceOf(NotFoundException);
  });

  it("patch renames/re-scopes, ignores presetKey, and 404s outside the org", async () => {
    const { svc } = db();
    const role: any = await svc.createCustomRole("org", "boss", { presetKey: "FINANCE" });
    const updated: any = await svc.updateCustomRole("org", "boss", role.id, { name: "Money Team", areas: ["billing"], presetKey: "ORDER_MANAGER" } as any);
    expect(updated.name).toBe("Money Team");
    expect(updated.areas).toEqual(["billing"]);
    expect(updated.presetKey).toBe("FINANCE"); // immutable
    await expect(svc.updateCustomRole("org2", "boss", role.id, { name: "Nope" })).rejects.toBeInstanceOf(NotFoundException);
  });

  it("member login history + sessions require membership; revoke-all reports the count", async () => {
    const { svc, memberships } = db();
    void memberships;
    await expect(svc.getMemberLoginHistory("org", "ghost")).rejects.toBeInstanceOf(NotFoundException);
    // tables absent on this fake — defensive reads answer empty
    await expect(svc.getMemberLoginHistory("org", "agent")).resolves.toEqual([]);
    await expect(svc.getMemberSessions("org", "agent")).resolves.toEqual([]);
    await expect(svc.revokeAllMemberSessions("org", "boss", "agent")).resolves.toMatchObject({ ok: true, revokedCount: 0 });
  });
});
