import { ForbiddenException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { RolesGuard } from "../common/roles.guard";
import { PERMISSION_AREA_KEY, ROLES_KEY } from "../common/decorators";
import { effectiveAccess, normalizeOverrides } from "../common/permission-catalog";
import { OrganizationsService } from "./organizations.service";

/**
 * Milestone 72 (Team W3): custom access.
 * Guard matrix: deny beats role; grant admits below-role;
 * owner-only gates are never grantable; the OWNER is immune;
 * untagged endpoints behave exactly as before.
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
const member = (role: string, overrides?: any) => ({ user: { userId: "u1", isSuperAdmin: false }, membership: { role, permissionOverrides: overrides ?? null } });

describe("M72 RolesGuard custom access", () => {
  it("untagged endpoints keep pure role behavior", () => {
    const g = guardWith({ roles: ["OWNER", "ADMIN"] });
    expect(g.canActivate(ctx(member("ADMIN")))).toBe(true);
    expect(() => g.canActivate(ctx(member("VIEWER", { grants: ["team"] })))).toThrow(ApiException);
  });

  it("a grant admits below-role on a tagged endpoint", () => {
    const g = guardWith({ roles: ["OWNER", "ADMIN"], area: "billing" });
    expect(g.canActivate(ctx(member("VIEWER", { grants: ["billing"] })))).toBe(true);
    expect(() => g.canActivate(ctx(member("VIEWER")))).toThrow(ApiException);
    expect(() => g.canActivate(ctx(member("VIEWER", { grants: ["inbox"] })))).toThrow(ApiException);
  });

  it("a deny blocks even when the role passes", () => {
    const g = guardWith({ roles: ["OWNER", "ADMIN", "MARKETING_MANAGER", "SUPPORT_AGENT"], area: "inbox" });
    expect(g.canActivate(ctx(member("SUPPORT_AGENT")))).toBe(true);
    expect(() => g.canActivate(ctx(member("SUPPORT_AGENT", { denies: ["inbox"] })))).toThrow(expect.objectContaining({ code: "common.areaClosedByCustomRule", status: 403 }));
    // deny wins over a simultaneous grant too
    expect(() => g.canActivate(ctx(member("SUPPORT_AGENT", { grants: ["inbox"], denies: ["inbox"] })))).toThrow(expect.objectContaining({ code: "common.areaClosedByCustomRule", status: 403 }));
  });

  it("owner-only gates are never grantable, and the OWNER is immune to denies", () => {
    const g = guardWith({ roles: ["OWNER"], area: "team" });
    expect(() => g.canActivate(ctx(member("ADMIN", { grants: ["team"] })))).toThrow(ApiException);
    expect(g.canActivate(ctx(member("OWNER", { denies: ["team"] })))).toBe(true);
  });

  it("a deny closes a tagged endpoint even when it has no @Roles (inbox list case)", () => {
    const g = guardWith({ area: "inbox" });
    expect(g.canActivate(ctx(member("SUPPORT_AGENT")))).toBe(true);
    expect(() => g.canActivate(ctx(member("SUPPORT_AGENT", { denies: ["inbox"] })))).toThrow(expect.objectContaining({ code: "common.areaClosedByCustomRule", status: 403 }));
    // ...but a grant alone cannot conjure access where membership is absent
    expect(g.canActivate(ctx(member("VIEWER", { grants: ["inbox"] })))).toBe(true); // no @Roles: open to members by default
  });

  it("super admins bypass everything, as before", () => {
    const g = guardWith({ roles: ["OWNER"], area: "billing" });
    expect(g.canActivate(ctx({ user: { userId: "root", isSuperAdmin: true }, membership: null }))).toBe(true);
  });
});

describe("M72 catalog math", () => {
  it("normalizeOverrides drops unknown keys, dedupes, and deny wins", () => {
    expect(normalizeOverrides({ grants: ["inbox", "inbox", "nope"], denies: ["billing", "inbox"] }))
      .toEqual({ grants: [], denies: ["billing", "inbox"] });
    expect(normalizeOverrides(null)).toEqual({ grants: [], denies: [] });
    expect(normalizeOverrides("junk")).toEqual({ grants: [], denies: [] });
  });

  it("effectiveAccess reports role / grant / deny / none per area", () => {
    const eff = effectiveAccess("SUPPORT_AGENT" as any, { grants: ["billing"], denies: ["courier"] });
    const by = new Map(eff.map((e) => [e.key, e]));
    expect(by.get("inbox")).toMatchObject({ allowed: true, source: "role" });
    expect(by.get("billing")).toMatchObject({ allowed: true, source: "grant" });
    expect(by.get("courier")).toMatchObject({ allowed: false, source: "deny" });
    expect(by.get("team")).toMatchObject({ allowed: false, source: "none" });
    const ownerEff = effectiveAccess("OWNER" as any, { denies: ["inbox"] });
    expect(ownerEff.every((e) => e.allowed && e.source === "owner")).toBe(true);
  });
});

describe("M72 member access service", () => {
  function db() {
    const memberships = [
      { id: "m-boss", userId: "boss", organizationId: "org", role: "OWNER", status: "ACTIVE", permissionOverrides: null },
      { id: "m-agent", userId: "agent", organizationId: "org", role: "SUPPORT_AGENT", status: "ACTIVE", permissionOverrides: null },
    ];
    const fake: any = {
      membership: {
        findUnique: jest.fn(async ({ where }: any) => memberships.find((m) => m.userId === where.userId_organizationId.userId) ?? null),
        update: jest.fn(async ({ where, data }: any) => {
          const row = memberships.find((m) => m.id === where.id); Object.assign(row!, data); return row;
        }),
      },
    };
    const audit = { calls: [] as any[], log: jest.fn(async (e: any) => { audit.calls.push(e); }) };
    return { svc: new OrganizationsService(fake, audit as any), audit, memberships };
  }

  it("updates overrides with an audited diff; the owner's access is untouchable", async () => {
    const { svc, audit } = db();
    const out: any = await svc.updateMemberAccess("org", "boss", "agent", { grants: ["billing"], denies: ["courier"] });
    expect(out.overrides).toEqual({ grants: ["billing"], denies: ["courier"] });
    expect(out.effective.find((e: any) => e.key === "billing").source).toBe("grant");
    expect(audit.calls[0].action).toBe("org.member_access_updated");
    expect(audit.calls[0].metadata.grantsAdded).toEqual(["billing"]);
    await expect(svc.updateMemberAccess("org", "boss", "boss", { grants: ["inbox"] })).rejects.toMatchObject({ code: "organizations.ownerAccessNotCustomizable", status: 400 });
    await expect(svc.updateMemberAccess("org", "boss", "agent", { grants: ["mars"] })).rejects.toMatchObject({ code: "organizations.unknownPermissionAreas", status: 400 });
  });

  it("a member can view their own access but not someone else's", async () => {
    const { svc } = db();
    const own: any = await svc.getMemberAccess("org", "agent", "agent");
    expect(own.role).toBe("SUPPORT_AGENT");
    await expect(svc.getMemberAccess("org", "agent", "boss")).rejects.toMatchObject({ code: "organizations.viewOwnAccessOnly", status: 403 });
  });
});
