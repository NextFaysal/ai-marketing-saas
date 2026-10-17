import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AdminService } from "./admin.service";
import { AdminController } from "./admin.controller";
import { OrganizationsService } from "../organizations/organizations.service";
import { SuperAdminGuard, ADMIN_TIER_KEY } from "../common/super-admin.guard";
import { slugAvailability, SLUG_TOMBSTONE_COOLDOWN_DAYS } from "../common/slug-availability";

/**
 * TD11 (Tenant Domain, Batch TB5) — slug cooldown tombstones:
 * a permanently deleted org's slug stays parked for 180 days in
 * the SINGLE availability decision (slugAvailability — shared by
 * create() and GET /organizations/slug-available), and a SUPER
 * admin can release it early with a mandatory, audited note.
 * Hand-rolled fakes, following the m40/td1 spec pattern.
 */
function match(row: any, where: any = {}): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (v && typeof v === "object" && !(v instanceof Date)) return false; // flat equality only in this spec
    if (row[k] !== v) return false;
  }
  return true;
}
let seq = 0;
function table(seed: any[] = []) {
  const rows = [...seed];
  return {
    rows,
    findMany: async (args: any = {}) => {
      let out = rows.filter((r) => match(r, args.where ?? {}));
      if (args.orderBy?.deletedAt === "desc") out = [...out].sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());
      if (args.take) out = out.slice(0, args.take);
      return out;
    },
    findFirst: async (args: any = {}) => rows.filter((r) => match(r, args.where ?? {}))[0] ?? null,
    findUnique: async ({ where }: any) => rows.find((r) => match(r, where)) ?? null,
    count: async (args: any = {}) => rows.filter((r) => match(r, args.where ?? {})).length,
    create: async ({ data }: any) => {
      const row = { id: `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => match(r, where));
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    },
    upsert: async ({ where, create, update }: any) => {
      const row = rows.find((r) => match(r, where));
      if (row) { Object.assign(row, update); return row; }
      const created = { id: `row-${++seq}`, createdAt: new Date(), ...create };
      rows.push(created);
      return created;
    },
    delete: async ({ where }: any) => {
      const i = rows.findIndex((r) => match(r, where));
      if (i < 0) throw new Error("not found");
      return rows.splice(i, 1)[0];
    },
    deleteMany: async ({ where }: any) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], where ?? {})) { rows.splice(i, 1); count++; }
      return { count };
    },
  };
}

const SUPER: any = { id: "admin-1", email: "root@platform.local", isSuperAdmin: true, adminTier: "SUPER" };
function recordingAudit() {
  const calls: any[] = [];
  return { calls, log: jest.fn(async (entry: any) => { calls.push(entry); }) };
}

const DAY = 86400000;
function activeTombstone(slug = "acme-shop") {
  const now = Date.now();
  return { id: "t-1", slug, deletedOrgName: "Acme", deletedAt: new Date(now - DAY), expiresAt: new Date(now + (SLUG_TOMBSTONE_COOLDOWN_DAYS - 1) * DAY), releasedAt: null, releasedById: null, createdAt: new Date(now - DAY) };
}

function adminSetup(opts: { orgStatus?: string; slugTombstone?: any } = {}) {
  const p: any = {
    organization: table([{ id: "org-1", name: "Acme", slug: "acme-shop", status: opts.orgStatus ?? "DELETED", creditMinor: 0n }]),
    businessProfile: table([{ organizationId: "org-1", description: "shop" }]),
    membership: table([{ id: "m-1", userId: "u-1", organizationId: "org-1", role: "OWNER" }]),
    user: table([{ id: "u-1", email: "owner@acme.test", name: "Owner", status: "ACTIVE" }]),
    auditLog: table([]),
    slugTombstone: opts.slugTombstone ?? table([]),
  };
  const audit = recordingAudit();
  return { p, svc: new AdminService(p as any, audit as any), audit };
}

function orgSetup(tombstones: any[] = []) {
  const p: any = {
    organization: table([]),
    membership: table(),
    businessProfile: table(),
    subscription: table(),
    systemSetting: table([]),
    slugTombstone: table(tombstones),
  };
  p.$transaction = async (fn: any) => fn(p);
  const svc = new OrganizationsService(p, recordingAudit() as any);
  return { svc, p };
}

describe("TD11 — permanent deletion parks the slug", () => {
  it("writes a tombstone expiring 180 days out, and says so in the return + audit", async () => {
    const { p, svc, audit } = adminSetup();
    const before = Date.now();
    const out: any = await svc.deleteOrgPermanent(SUPER, "org-1", "Acme", "gdpr request");
    expect(out.deleted).toBe(true);
    expect(out.slugTombstoneWritten).toBe(true);
    expect(p.organization.rows).toHaveLength(0);
    expect(p.slugTombstone.rows).toHaveLength(1);
    const row = p.slugTombstone.rows[0];
    expect(row.slug).toBe("acme-shop");
    expect(row.deletedOrgName).toBe("Acme");
    expect(row.releasedAt ?? null).toBeNull();
    const spanDays = (new Date(row.expiresAt).getTime() - new Date(row.deletedAt).getTime()) / DAY;
    expect(spanDays).toBeGreaterThan(179.9);
    expect(spanDays).toBeLessThan(180.1);
    expect(new Date(row.deletedAt).getTime()).toBeGreaterThanOrEqual(before);
    const cert = audit.calls.find((c: any) => c.action === "admin.org_deleted_permanently");
    expect(cert?.metadata?.slugTombstoneWritten).toBe(true);
  });

  it("a soft status change to DELETED writes NO tombstone (only the final hard delete does)", async () => {
    const { p, svc } = adminSetup({ orgStatus: "ACTIVE" });
    await svc.setOrgStatus(SUPER, "org-1", "DELETED", "owner asked to close");
    expect(p.organization.rows[0].status).toBe("DELETED");
    expect(p.slugTombstone.rows).toHaveLength(0);
  });

  it("a tombstone write failure is reported honestly — the deletion stands, the flag says false", async () => {
    const broken: any = table([]);
    broken.upsert = async () => { throw new Error("db down"); };
    const { p, svc } = adminSetup({ slugTombstone: broken });
    const out: any = await svc.deleteOrgPermanent(SUPER, "org-1", "Acme", "gdpr request");
    expect(out.deleted).toBe(true);
    expect(out.slugTombstoneWritten).toBe(false);
    expect(p.organization.rows).toHaveLength(0);
  });
});

describe("TD11 — cooldown inside the single availability decision", () => {
  it("an active tombstone answers reason cooldown with the freeing date in the message", async () => {
    const t = activeTombstone();
    const { svc } = orgSetup([t]);
    const out = await svc.checkSlugAvailability("acme-shop");
    expect(out.available).toBe(false);
    expect(out.reason).toBe("cooldown");
    expect(out.reason).not.toBe("reserved");
    expect(out.message).toContain("মুছে ফেলা");
    expect(out.message).toContain(new Date(t.expiresAt).toLocaleDateString("bn-BD"));
  });

  it("create() refuses a cooldown slug with the same Bengali message (BadRequest, not Conflict)", async () => {
    const { svc } = orgSetup([activeTombstone()]);
    const err: any = await svc.create("u-9", { name: "New Shop", slug: "acme-shop" } as any).catch((e: any) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toContain("মুছে ফেলা");
  });

  it("an expired tombstone no longer blocks — the leftover row is history", async () => {
    const now = Date.now();
    const expired = { ...activeTombstone(), id: "t-old", deletedAt: new Date(now - 200 * DAY), expiresAt: new Date(now - 20 * DAY) };
    const { svc, p } = orgSetup([expired]);
    const out = await svc.checkSlugAvailability("acme-shop");
    expect(out).toMatchObject({ available: true, reason: "ok" });
    // …and the raw decision function agrees (same function, no fork).
    const direct = await slugAvailability(p, "acme-shop");
    expect(direct).toMatchObject({ available: true, reason: "ok" });
  });

  it("a released tombstone no longer blocks", async () => {
    const released = { ...activeTombstone(), releasedAt: new Date(), releasedById: "admin-1" };
    const { svc } = orgSetup([released]);
    const out = await svc.checkSlugAvailability("acme-shop");
    expect(out).toMatchObject({ available: true, reason: "ok" });
  });
});

describe("TD11 — SUPER release", () => {
  it("refuses without a note", async () => {
    const { svc } = adminSetup({ slugTombstone: table([activeTombstone()]) });
    await expect(svc.releaseSlugTombstone(SUPER, "acme-shop", "")).rejects.toThrow(/reason is required/i);
    await expect(svc.releaseSlugTombstone(SUPER, "acme-shop", "   ")).rejects.toThrow(/reason is required/i);
  });

  it("releases with a note: row updated, audit written, and the name frees up", async () => {
    const { p, svc, audit } = adminSetup({ slugTombstone: table([activeTombstone()]) });
    const out: any = await svc.releaseSlugTombstone(SUPER, "acme-shop", "নতুন মালিক একই ব্র্যান্ড কিনেছেন — যাচাই করা হয়েছে", "127.0.0.1");
    expect(out.released).toBe(true);
    expect(out.tombstone.active).toBe(false);
    const row = p.slugTombstone.rows[0];
    expect(row.releasedAt).toBeInstanceOf(Date);
    expect(row.releasedById).toBe("admin-1");
    const call = audit.calls.find((c: any) => c.action === "admin.slug_tombstone_released");
    expect(call).toBeTruthy();
    expect(call.metadata.note).toContain("যাচাই করা হয়েছে");
    expect(call.metadata.slug).toBe("acme-shop");
    // After release, the availability decision frees the name.
    const orgP: any = { organization: table([]), systemSetting: table([]), slugTombstone: p.slugTombstone };
    const avail = await slugAvailability(orgP, "acme-shop");
    expect(avail).toMatchObject({ available: true, reason: "ok" });
  });

  it("unknown slug → 404; already-released and already-expired → BadRequest", async () => {
    const { svc } = adminSetup({ slugTombstone: table([activeTombstone()]) });
    await expect(svc.releaseSlugTombstone(SUPER, "no-such-name", "some note")).rejects.toBeInstanceOf(NotFoundException);
    await svc.releaseSlugTombstone(SUPER, "acme-shop", "first release");
    await expect(svc.releaseSlugTombstone(SUPER, "acme-shop", "second release")).rejects.toBeInstanceOf(BadRequestException);

    const expiredSetup = adminSetup({ slugTombstone: table([{ ...activeTombstone(), expiresAt: new Date(Date.now() - DAY) }]) });
    await expect(expiredSetup.svc.releaseSlugTombstone(SUPER, "acme-shop", "too late")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("list shows active vs history rows honestly", async () => {
    const released = { ...activeTombstone("old-shop"), id: "t-2", releasedAt: new Date(), releasedById: "admin-1" };
    const { svc } = adminSetup({ slugTombstone: table([activeTombstone(), released]) });
    const out: any = await svc.listSlugTombstones();
    expect(out.tombstones).toHaveLength(2);
    expect(out.tombstones.find((t: any) => t.slug === "acme-shop")?.active).toBe(true);
    expect(out.tombstones.find((t: any) => t.slug === "old-shop")?.active).toBe(false);
  });

  it("the release route carries @AdminTier(SUPER)", () => {
    const reflector = new Reflector();
    expect(reflector.get(ADMIN_TIER_KEY, (AdminController.prototype as any).releaseSlugTombstone)).toEqual(["SUPER"]);
  });

  it("the guard refuses a non-SUPER admin (403) and admits SUPER", async () => {
    const supportRow = { id: "a-2", isSuperAdmin: true, status: "ACTIVE", adminTier: "SUPPORT", totpEnabled: true, tokenVersion: 0 };
    const superRow = { id: "a-1", isSuperAdmin: true, status: "ACTIVE", adminTier: "SUPER", totpEnabled: true, tokenVersion: 0 };
    const guardFor = (row: any) => {
      const prisma: any = {
        user: { findUnique: async () => row },
        systemSetting: { findUnique: async () => null },
      };
      const guard = new SuperAdminGuard(prisma, new Reflector());
      const req: any = { user: { userId: row.id, tv: 0 }, method: "POST", originalUrl: "/admin/slug-tombstones/acme-shop/release", headers: {}, ip: "127.0.0.1" };
      const ctx: any = {
        switchToHttp: () => ({ getRequest: () => req }),
        getHandler: () => (AdminController.prototype as any).releaseSlugTombstone,
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
