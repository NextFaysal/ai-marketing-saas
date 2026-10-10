import { ForbiddenException } from "@nestjs/common";
import { AdminService } from "./admin.service";
import { SuperAdminGuard } from "../common/super-admin.guard";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { ipAllowed, ipMatchesEntry } from "../common/ip-allowlist";
import { orgFlagEnabled } from "../common/feature-flags";
import { AutomationService } from "../automation/automation.service";

/** Milestone 40 (Admin Phase A4): self-contained fakes (m37/m38 pattern). */
function match(row: any, where: any = {}): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === "OR") { if (!(v as any[]).some((w: any) => match(row, w))) return false; continue; }
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("gte" in (v as any)) { if (!(new Date(row[k]).getTime() >= new Date((v as any).gte).getTime())) return false; }
      else if ("lt" in (v as any)) { if (!(new Date(row[k]).getTime() < new Date((v as any).lt).getTime())) return false; }
      else if ("in" in (v as any)) { if (!(v as any).in.includes(row[k])) return false; }
      else return false;
    } else if (row[k] !== v) return false;
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
      if (args.take) out = out.slice(0, args.take);
      return out;
    },
    findFirst: async (args: any = {}) => rows.filter((r) => match(r, args.where ?? {}))[0] ?? null,
    findUnique: async ({ where }: any) => rows.find((r) =>
      (where.id !== undefined && r.id === where.id) ||
      (where.key !== undefined && r.key === where.key) ||
      (where.keyHash !== undefined && r.keyHash === where.keyHash) ||
      (where.email !== undefined && r.email === where.email) ||
      (where.organizationId !== undefined && r.organizationId === where.organizationId) ||
      (where.organizationId_key !== undefined && r.organizationId === where.organizationId_key.organizationId && r.key === where.organizationId_key.key)) ?? null,
    count: async (args: any = {}) => rows.filter((r) => match(r, args.where ?? {})).length,
    create: async ({ data }: any) => {
      const row = { id: `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    },
    upsert: async ({ where, create, update }: any) => {
      const row = rows.find((r) => r.key === where.key);
      if (row) { Object.assign(row, update); return row; }
      const created = { id: `row-${++seq}`, createdAt: new Date(), ...create };
      rows.push(created);
      return created;
    },
    delete: async ({ where }: any) => {
      const i = rows.findIndex((r) => r.id === where.id);
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

const ADMIN: any = { id: "admin-1", email: "root@platform.local", isSuperAdmin: true, adminTier: "SUPER" };
function recordingAudit() {
  const calls: any[] = [];
  return { calls, log: jest.fn(async (entry: any) => { calls.push(entry); }) };
}

describe("Milestone 40 — IP allowlist matching", () => {
  it("matches exact IPs and IPv4 CIDR ranges; empty list allows everything", () => {
    expect(ipMatchesEntry("203.0.113.10", "203.0.113.10")).toBe(true);
    expect(ipMatchesEntry("203.0.113.99", "203.0.113.0/24")).toBe(true);
    expect(ipMatchesEntry("203.0.114.1", "203.0.113.0/24")).toBe(false);
    expect(ipMatchesEntry("10.0.0.5", "10.0.0.0/8")).toBe(true);
    expect(ipMatchesEntry("1.2.3.4", "0.0.0.0/0")).toBe(true);
    expect(ipMatchesEntry("::1", "::1")).toBe(true);
    expect(ipAllowed("8.8.8.8", [])).toBe(true);
    expect(ipAllowed("8.8.8.8", ["9.9.9.9"])).toBe(false);
  });
});

describe("Milestone 40 — feature flag helper semantics", () => {
  it("no row = enabled; enabled=false row = disabled; lookup failure = enabled", async () => {
    const p: any = { orgFeatureFlag: table([]) };
    await expect(orgFlagEnabled(p, "org-1", "dayparting")).resolves.toBe(true);
    p.orgFeatureFlag.rows.push({ organizationId: "org-1", key: "dayparting", enabled: false });
    await expect(orgFlagEnabled(p, "org-1", "dayparting")).resolves.toBe(false);
    await expect(orgFlagEnabled(p, "org-1", "order_bot")).resolves.toBe(true);
    await expect(orgFlagEnabled({}, "org-1", "dayparting")).resolves.toBe(true);
  });
});

describe("Milestone 40 — SuperAdminGuard token-version pass-through (regression)", () => {
  function guardFor(userRow: any, tv: number) {
    const prisma: any = {
      user: { findUnique: async () => userRow },
      systemSetting: { findUnique: async () => null },
    };
    const reflector: any = { getAllAndOverride: () => undefined };
    const guard = new SuperAdminGuard(prisma, reflector);
    const req: any = { user: { userId: userRow.id, tv }, method: "GET", originalUrl: "/admin/orgs", headers: {}, ip: "127.0.0.1" };
    const ctx: any = { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => null, getClass: () => null };
    return { guard, ctx, req };
  }
  it("a re-logged admin whose tokenVersion was bumped still passes with the matching tv", async () => {
    const { guard, ctx } = guardFor({ id: "a-1", isSuperAdmin: true, status: "ACTIVE", adminTier: "SUPER", totpEnabled: true, tokenVersion: 3 }, 3);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
  it("a stale token (old tv) is still refused", async () => {
    const { guard, ctx } = guardFor({ id: "a-1", isSuperAdmin: true, status: "ACTIVE", adminTier: "SUPER", totpEnabled: true, tokenVersion: 3 }, 2);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("Milestone 40 — admin API keys", () => {
  function setup() {
    const p: any = {
      adminApiKey: table([]),
      user: table([{ id: "admin-1", email: "root@platform.local", isSuperAdmin: true, status: "ACTIVE", adminTier: "SUPER", tokenVersion: 0 }]),
      auditLog: table([]),
      systemSetting: table([]),
    };
    const audit = recordingAudit();
    const svc = new AdminService(p as any, audit as any);
    return { p, svc, audit };
  }

  it("create returns the key once; only its hash is stored; the key then authenticates /admin via JwtAuthGuard", async () => {
    const { p, svc } = setup();
    const created: any = await svc.createApiKey(ADMIN, "Uptime monitor");
    expect(created.key).toMatch(/^qosa_[0-9a-f]{64}$/);
    const stored = p.adminApiKey.rows[0];
    expect(stored.keyHash).not.toBe(created.key);
    expect(stored.keyHash).toHaveLength(64);
    expect(JSON.stringify(await svc.listApiKeys())).not.toContain(created.key);

    const reflector: any = { getAllAndOverride: () => false };
    const guard = new JwtAuthGuard({} as any, reflector, p as any);
    const req: any = { headers: { "x-admin-api-key": created.key }, originalUrl: "/admin/orgs", url: "/admin/orgs" };
    const ctx: any = { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => null, getClass: () => null };
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user.viaApiKey).toBe(true);
    expect(req.user.userId).toBe("admin-1");

    // Revoked keys die immediately.
    await svc.revokeApiKey(ADMIN, created.id, "no longer needed");
    const req2: any = { headers: { "x-admin-api-key": created.key }, originalUrl: "/admin/orgs", url: "/admin/orgs" };
    const ctx2: any = { switchToHttp: () => ({ getRequest: () => req2 }), getHandler: () => null, getClass: () => null };
    await expect(guard.canActivate(ctx2)).rejects.toThrow();
  });
});

describe("Milestone 40 — maintenance window, bulk, anomalies", () => {
  function setup() {
    const p: any = {
      systemSetting: table([]),
      announcement: table([]),
      organization: table([
        { id: "org-1", name: "Acme", status: "ACTIVE", creditMinor: 0n },
        { id: "org-2", name: "Beta", status: "ACTIVE", creditMinor: 0n },
      ]),
      auditLog: table([]),
    };
    const audit = recordingAudit();
    return { p, svc: new AdminService(p as any, audit as any), audit };
  }

  it("validates maintenance windows and reports an active window in the public status", async () => {
    const { svc } = setup();
    await expect(svc.updateSettings(ADMIN, { maintenanceWindow: { startsAt: "2026-01-02", endsAt: "2026-01-01" } })).rejects.toThrow(/after startsAt/i);
    const now = Date.now();
    await svc.updateSettings(ADMIN, {
      maintenanceWindow: { startsAt: new Date(now - 3600000).toISOString(), endsAt: new Date(now + 3600000).toISOString(), message: "আপগ্রেড", hardLockout: true },
    });
    const status: any = await svc.publicStatus();
    expect(status.maintenanceMode).toBe(true);
    expect(status.maintenanceWindow.active).toBe(true);
    expect(status.maintenanceWindow.hardLockout).toBe(true);
  });

  it("bulk status applies per-org and reports failures individually", async () => {
    const { svc, p } = setup();
    const out: any = await svc.bulkOrgStatus(ADMIN, ["org-1", "org-missing"], "SUSPENDED", "bulk cleanup");
    expect(out.succeeded).toBe(1);
    expect(out.results.find((r: any) => r.organizationId === "org-missing").ok).toBe(false);
    expect(p.organization.rows.find((o: any) => o.id === "org-1").status).toBe("SUSPENDED");
  });

  it("login anomalies only flag emails with 5+ failures in the window", async () => {
    const { svc, p } = setup();
    for (let i = 0; i < 6; i++) p.auditLog.rows.push({ id: `f-${i}`, action: "auth.login_failed", metadata: { email: "victim@x.test" }, createdAt: new Date() });
    for (let i = 0; i < 3; i++) p.auditLog.rows.push({ id: `g-${i}`, action: "auth.login_failed", metadata: { email: "typo@x.test" }, createdAt: new Date() });
    const anomalies: any[] = await svc.loginAnomalies(24);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].email).toBe("victim@x.test");
    expect(anomalies[0].failures).toBe(6);
  });
});

describe("Milestone 40 — export & verified permanent deletion", () => {
  function setup() {
    const p: any = {
      organization: table([{ id: "org-1", name: "Acme", slug: "acme", status: "DELETED", creditMinor: 0n }]),
      businessProfile: table([{ organizationId: "org-1", description: "shop" }]),
      membership: table([{ id: "m-1", userId: "u-1", organizationId: "org-1", role: "OWNER" }]),
      user: table([{ id: "u-1", email: "owner@acme.test", name: "Owner", status: "ACTIVE" }]),
      integration: table([{ id: "i-1", organizationId: "org-1", provider: "woocommerce", status: "CONNECTED" }]),
      product: table([{ id: "p-1", organizationId: "org-1", name: "Shirt" }]),
      order: table([{ id: "o-1", organizationId: "org-1", totalMinor: 100n }]),
      orderItem: table([{ id: "oi-1", orderId: "o-1" }]),
      supportTicket: table([{ id: "t-1", organizationId: "org-1", subject: "help" }]),
      supportTicketMessage: table([{ id: "tm-1", ticketId: "t-1", body: "hi" }]),
      auditLog: table([{ id: "a-1", organizationId: "org-1", action: "org.create" }]),
      subscription: table([]), saasPayment: table([]), customer: table([]), lead: table([]),
      channelConversation: table([]), campaignPlan: table([]),
    };
    const audit = recordingAudit();
    return { p, svc: new AdminService(p as any, audit as any), audit };
  }

  it("export never includes credential material and reports counts via audit", async () => {
    const { svc, audit } = setup();
    const bundle: any = await svc.exportOrgData(ADMIN, "org-1");
    expect(bundle.organization.name).toBe("Acme");
    expect(bundle.integrations[0]).toEqual(expect.objectContaining({ provider: "woocommerce" }));
    expect(JSON.stringify(bundle)).not.toContain("credential");
    expect(audit.calls.some((c: any) => c.action === "admin.data_exported")).toBe(true);
  });

  it("permanent deletion demands DELETED status + the exact name, then certifies what it removed", async () => {
    const { svc, p, audit } = setup();
    await expect(svc.deleteOrgPermanent(ADMIN, "org-1", "Wrong Name", "gdpr request")).rejects.toThrow(/exact name/i);
    const out: any = await svc.deleteOrgPermanent(ADMIN, "org-1", "Acme", "gdpr request");
    expect(out.deleted).toBe(true);
    expect(out.certificate.product).toBe(1);
    expect(out.certificate.supportTicketMessage).toBe(1);
    expect(out.certificate.orderItem).toBe(1);
    expect(out.certificate.organization).toBe(1);
    expect(p.organization.rows).toHaveLength(0);
    expect(p.product.rows).toHaveLength(0);
    expect(p.auditLog.rows).toHaveLength(0); // org-scoped audit rows went with the org
    expect(audit.calls.some((c: any) => c.action === "admin.org_deleted_permanently")).toBe(true);
  });

  it("an ACTIVE org cannot be permanently deleted", async () => {
    const { svc, p } = setup();
    p.organization.rows[0].status = "ACTIVE";
    await expect(svc.deleteOrgPermanent(ADMIN, "org-1", "Acme", "gdpr request")).rejects.toThrow(/DELETED status first/i);
  });
});

describe("Milestone 40 — audit retention job", () => {
  it("deletes old tenant audit rows but preserves admin.* actions", async () => {
    const old = new Date(Date.now() - 400 * 86400000);
    const p: any = {
      auditLog: table([
        { id: "old-tenant", action: "order.created", createdAt: old },
        { id: "old-admin", action: "admin.payment_refunded", createdAt: old },
        { id: "fresh", action: "order.created", createdAt: new Date() },
      ]),
      systemSetting: table([]),
    };
    const svc = new AutomationService(p as any, recordingAudit() as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const out: any = await svc.runAuditRetention();
    expect(out.deleted).toBe(1);
    expect(out.preservedAdminActions).toBe(1);
    expect(p.auditLog.rows.map((r: any) => r.id).sort()).toEqual(["fresh", "old-admin"]);
  });
});
