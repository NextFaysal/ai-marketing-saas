import { JwtAuthGuard } from "./jwt-auth.guard";
import { hasScope, requiredGrant, validateScopes } from "./api-key-scopes";
import { ForbiddenException } from "@nestjs/common";
import { createHash } from "node:crypto";

/**
 * Admin Polish AP3: an admin API key only opens the
 * areas it was granted. Legacy keys (no scopes) keep
 * full access; everything else is enforced per route.
 */
describe("AP3 scope helpers", () => {
  it("maps routes to grants", () => {
    expect(requiredGrant("GET", "/admin/orgs")).toBe("tenants:read");
    expect(requiredGrant("POST", "/admin/orgs/abc/suspend")).toBe("tenants:write");
    expect(requiredGrant("GET", "/admin/billing/invoices")).toBe("billing:read");
    expect(requiredGrant("PATCH", "/admin/platform-config/llm")).toBe("system:write");
    expect(requiredGrant("GET", "/admin/referrals")).toBe("growth:read");
    expect(requiredGrant("GET", "/admin/security/api-keys")).toBe("admins:read");
    expect(requiredGrant("GET", "/admin/alerts")).toBe("system:read");
  });
  it("hasScope honours exact, area-wildcard, full and legacy", () => {
    expect(hasScope(["tenants:read"], "tenants:read")).toBe(true);
    expect(hasScope(["tenants:read"], "tenants:write")).toBe(false);
    expect(hasScope(["tenants:*"], "tenants:write")).toBe(true);
    expect(hasScope(["*"], "billing:write")).toBe(true);
    expect(hasScope([], "billing:write")).toBe(true); // legacy
    expect(hasScope(["billing:read"], "tenants:read")).toBe(false);
  });
  it("validateScopes rejects junk and accepts the catalog", () => {
    expect(validateScopes(undefined)).toEqual(["*"]);
    expect(validateScopes(["tenants:read", "billing:*"])).toEqual(["tenants:read", "billing:*"]);
    const codeOf = (fn: () => unknown) => { try { fn(); return null; } catch (e: any) { return e?.code ?? null; } };
    expect(codeOf(() => validateScopes(["nope:read"]))).toBe("common.apiKeyScopeAreaUnknown");
    expect(codeOf(() => validateScopes(["tenants:fly"]))).toBe("common.apiKeyScopeGrantUnknown");
    expect(codeOf(() => validateScopes([]))).toBe("common.apiKeyScopesChooseAtLeastOne");
  });
});

describe("AP3 JwtAuthGuard enforcement", () => {
  const RAW = "qosa_testkey123";
  const hash = createHash("sha256").update(RAW).digest("hex");
  function guardWith(scopes: string[]) {
    const prisma: any = {
      adminApiKey: {
        findUnique: async ({ where }: any) => (where.keyHash === hash ? { id: "k1", keyHash: hash, createdById: "admin-1", revokedAt: null, scopes, lastUsedAt: new Date() } : null),
        update: async () => ({}),
      },
      user: { findUnique: async () => ({ id: "admin-1", email: "a@x", isSuperAdmin: true, tokenVersion: 0 }) },
    };
    const reflector: any = { getAllAndOverride: () => false };
    return new JwtAuthGuard({} as any, reflector, prisma);
  }
  function ctxFor(method: string, url: string) {
    const req: any = { headers: { "x-admin-api-key": RAW }, originalUrl: url, url, method };
    return { ctx: { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => null, getClass: () => null } as any, req };
  }
  it("a tenants:read key can read orgs but not write them", async () => {
    const g = guardWith(["tenants:read"]);
    await expect(g.canActivate(ctxFor("GET", "/admin/orgs").ctx)).resolves.toBe(true);
    await expect(g.canActivate(ctxFor("POST", "/admin/orgs/x/suspend").ctx)).rejects.toMatchObject({ code: "common.apiKeyLacksScope", status: 403 });
  });
  it("a billing key is refused on tenants routes, with the grant named", async () => {
    const g = guardWith(["billing:*"]);
    await expect(g.canActivate(ctxFor("GET", "/admin/orgs").ctx)).rejects.toThrow(/tenants:read/);
  });
  it("legacy (empty) and full (*) keys pass everywhere", async () => {
    await expect(guardWith([]).canActivate(ctxFor("POST", "/admin/orgs/x/suspend").ctx)).resolves.toBe(true);
    await expect(guardWith(["*"]).canActivate(ctxFor("DELETE", "/admin/orgs/x").ctx)).resolves.toBe(true);
  });
});
