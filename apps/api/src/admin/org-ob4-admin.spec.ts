import "reflect-metadata";
import { Reflector } from "@nestjs/core";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { AdminService } from "./admin.service";
import { AdminController } from "./admin.controller";
import { ADMIN_TIER_KEY, SuperAdminGuard } from "../common/super-admin.guard";

/**
 * Organization Next OB4 (admin side) — ORG12 platform setting
 * "maxOrgsPerUser" + ORG13 SUPER org tags. Rules under test:
 *  - the setting reads back null (no cap) until an operator sets
 *    it; only null or an integer >= 1 may be written (0 and
 *    fractions are refused, so "unlimited" has one spelling);
 *  - tags replace as a whole list: trim, empties dropped, exact
 *    duplicates dropped, case preserved as typed; at most 20
 *    tags of at most 40 characters; every write is audited;
 *  - the admin org list filters by an exact tag (array `has`);
 *  - the tags route is SUPER-tier only — route metadata and the
 *    SuperAdminGuard both refuse a SUPPORT admin.
 */
function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (k === "OR") { if (!(v as any[]).some((w) => matchWhere(row, w))) return false; continue; }
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const cond = v as any;
      const rv = row[k];
      if ("has" in cond) { if (!Array.isArray(rv) || !rv.includes(cond.has)) return false; continue; }
      if ("contains" in cond) { if (typeof rv !== "string" || !rv.toLowerCase().includes(String(cond.contains).toLowerCase())) return false; continue; }
      if ("in" in cond && !cond.in.includes(rv)) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

function table(seed: any[] = []) {
  const rows = [...seed];
  let seq = 0;
  return {
    rows,
    findUnique: async ({ where }: any) => rows.find((r) => matchWhere(r, where)) ?? null,
    findFirst: async ({ where, orderBy }: any) => {
      const found = rows.filter((r) => matchWhere(r, where));
      if (orderBy?.createdAt === "desc") found.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      return found[0] ?? null;
    },
    findMany: async ({ where, orderBy, skip, take }: any = {}) => {
      let found = rows.filter((r) => matchWhere(r, where));
      if (orderBy?.createdAt === "desc") found.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
      if (skip) found = found.slice(skip);
      if (take) found = found.slice(0, take);
      return found;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)).length,
    create: async ({ data }: any) => {
      const row = { id: data.id ?? data.key ?? `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("row not found");
      Object.assign(row, data);
      return row;
    },
    upsert: async ({ where, create, update }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (row) { Object.assign(row, update); return row; }
      const created = { createdAt: new Date(), updatedAt: new Date(), ...create };
      rows.push(created);
      return created;
    },
  };
}

const SUPER: any = { id: "admin-1", email: "root@platform.local", isSuperAdmin: true, adminTier: "SUPER" };

function makeAdmin(opts: { orgs?: any[]; settings?: any[] } = {}) {
  const p: any = {
    organization: table(opts.orgs ?? [
      { id: "org-1", name: "Acme", slug: "acme", status: "ACTIVE", country: "BD", tags: ["VIP", "dhaka"], creditMinor: 0n, createdAt: new Date("2026-10-01") },
      { id: "org-2", name: "Beta", slug: "beta", status: "ACTIVE", country: "BD", tags: ["wholesale"], creditMinor: 0n, createdAt: new Date("2026-10-02") },
      { id: "org-3", name: "Gamma", slug: "gamma", status: "ACTIVE", country: "BD", tags: [], creditMinor: 0n, createdAt: new Date("2026-10-03") },
    ]),
    membership: table(),
    order: table(),
    subscription: table(),
    systemSetting: table(opts.settings ?? []),
  };
  const auditCalls: any[] = [];
  const audit: any = { log: async (e: any) => { auditCalls.push(e); } };
  return { svc: new AdminService(p, audit), p, auditCalls };
}

describe("ORG12 — maxOrgsPerUser platform setting", () => {
  it("defaults to null (no cap) and round-trips an operator-set value", async () => {
    const { svc } = makeAdmin();
    expect((await svc.getSettings()).maxOrgsPerUser).toBeNull();
    await svc.updateSettings(SUPER, { maxOrgsPerUser: 3 });
    expect((await svc.getSettings()).maxOrgsPerUser).toBe(3);
    await svc.updateSettings(SUPER, { maxOrgsPerUser: null });
    expect((await svc.getSettings()).maxOrgsPerUser).toBeNull();
  });

  it("refuses 0, fractions, negatives and non-numbers", async () => {
    const { svc } = makeAdmin();
    await expect(svc.updateSettings(SUPER, { maxOrgsPerUser: 0 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.updateSettings(SUPER, { maxOrgsPerUser: 2.5 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.updateSettings(SUPER, { maxOrgsPerUser: -1 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.updateSettings(SUPER, { maxOrgsPerUser: "3" as any })).rejects.toBeInstanceOf(BadRequestException);
    expect((await svc.getSettings()).maxOrgsPerUser).toBeNull();
  });

  it("an invalid stored value reads back as no cap", async () => {
    const { svc } = makeAdmin({ settings: [{ key: "maxOrgsPerUser", value: "abc" }] });
    expect((await svc.getSettings()).maxOrgsPerUser).toBeNull();
  });
});

describe("ORG13 — org tags write path", () => {
  it("replaces the whole list with normalize: trim, drop empties, dedupe, keep case", async () => {
    const { svc, p, auditCalls } = makeAdmin();
    const out = await svc.updateOrgTags(SUPER, "org-1", ["  VIP ", "", "New Tag", "VIP", "wholesale  "]);
    expect(out.tags).toEqual(["VIP", "New Tag", "wholesale"]);
    expect(p.organization.rows.find((o: any) => o.id === "org-1").tags).toEqual(["VIP", "New Tag", "wholesale"]);
    expect(auditCalls.some((c: any) => c.action === "admin.org_tags_updated")).toBe(true);
  });

  it("an empty list clears all tags", async () => {
    const { svc, p } = makeAdmin();
    const out = await svc.updateOrgTags(SUPER, "org-1", []);
    expect(out.tags).toEqual([]);
    expect(p.organization.rows.find((o: any) => o.id === "org-1").tags).toEqual([]);
  });

  it("refuses more than 20 tags and tags over 40 characters", async () => {
    const { svc } = makeAdmin();
    const many = Array.from({ length: 21 }, (_, i) => `t${i}`);
    await expect(svc.updateOrgTags(SUPER, "org-1", many)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.updateOrgTags(SUPER, "org-1", ["x".repeat(41)])).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.updateOrgTags(SUPER, "org-1", "vip" as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.updateOrgTags(SUPER, "org-1", [42] as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("unknown org → 404", async () => {
    const { svc } = makeAdmin();
    await expect(svc.updateOrgTags(SUPER, "org-nope", ["a"])).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("ORG13 — org list tag filter", () => {
  it("filters by exact tag; no tag returns everything", async () => {
    const { svc } = makeAdmin();
    const vip = await svc.listOrgs(undefined, 1, 25, "VIP");
    expect(vip.map((o: any) => o.id)).toEqual(["org-1"]);
    expect(vip[0].tags).toEqual(["VIP", "dhaka"]);
    const all = await svc.listOrgs(undefined, 1, 25);
    expect(all.length).toBe(3);
    const none = await svc.listOrgs(undefined, 1, 25, "no-such-tag");
    expect(none.length).toBe(0);
  });
});

describe("ORG13 — SUPER-only route protection", () => {
  it("the tags route carries @AdminTier(SUPER)", () => {
    const reflector = new Reflector();
    expect(reflector.get(ADMIN_TIER_KEY, (AdminController.prototype as any).orgTags)).toEqual(["SUPER"]);
  });

  it("the guard refuses a SUPPORT admin (403) and admits SUPER", async () => {
    const supportRow = { id: "a-2", isSuperAdmin: true, status: "ACTIVE", adminTier: "SUPPORT", totpEnabled: true, tokenVersion: 0 };
    const superRow = { id: "a-1", isSuperAdmin: true, status: "ACTIVE", adminTier: "SUPER", totpEnabled: true, tokenVersion: 0 };
    const guardFor = (row: any) => {
      const prisma: any = {
        user: { findUnique: async () => row },
        systemSetting: { findUnique: async () => null },
      };
      const guard = new SuperAdminGuard(prisma, new Reflector());
      const req: any = { user: { userId: row.id, tv: 0 }, method: "PATCH", originalUrl: "/admin/orgs/org-1/tags", headers: {}, ip: "127.0.0.1" };
      const ctx: any = {
        switchToHttp: () => ({ getRequest: () => req }),
        getHandler: () => (AdminController.prototype as any).orgTags,
        getClass: () => AdminController,
      };
      return { guard, ctx };
    };
    const support = guardFor(supportRow);
    await expect(support.guard.canActivate(support.ctx)).rejects.toBeInstanceOf(ForbiddenException);
    const sup = guardFor(superRow);
    await expect(sup.guard.canActivate(sup.ctx)).resolves.toBe(true);
  });
});
