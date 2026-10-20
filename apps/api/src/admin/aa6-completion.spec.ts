process.env.ENCRYPTION_KEY = Buffer.alloc(32, 17).toString("base64");
import { AdminService } from "./admin.service";
import { AdminController } from "./admin.controller";
import { Reflector } from "@nestjs/core";
import { ADMIN_TIER_KEY } from "../common/super-admin.guard";

/**
 * Admin Advanced AA6 — Console Completion Pack.
 * announcement window validation, audit depth + CSV export,
 * dunning reminder-job coverage, per-tenant storage,
 * webhook explorer (list without payload, detail with
 * 20k truncation).
 */

const audit = { log: async () => undefined } as any;
const SUPER = { id: "admin-1", email: "root@x.com" } as any;

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (k === "OR") return (v as any[]).some((w) => matches(row, w));
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("not" in v) {
        if ((v as any).not === null) return row[k] !== null && row[k] !== undefined;
        return row[k] !== (v as any).not;
      }
      if ("gte" in v) return new Date(row[k]).getTime() >= new Date((v as any).gte).getTime();
      if ("lte" in v) return new Date(row[k]).getTime() <= new Date((v as any).lte).getTime();
      if ("lt" in v) return new Date(row[k]).getTime() < new Date((v as any).lt).getTime();
      if ("startsWith" in v) return String(row[k] ?? "").startsWith((v as any).startsWith);
      if ("contains" in v) return String(row[k] ?? "").includes(String((v as any).contains));
      return true;
    }
    return row[k] === v;
  });
}
function applySelect(row: any, select: any) {
  if (!select) return { ...row };
  const out: any = {};
  for (const k of Object.keys(select)) if (select[k]) out[k] = row[k];
  return out;
}
function table(rows: any[] = []) {
  const t: any = {
    rows,
    calls: [] as any[],
    findMany: async (args: any = {}) => {
      t.calls.push({ method: "findMany", args });
      let out = rows.filter((r) => matches(r, args.where));
      const ob = args.orderBy ?? {};
      const key = ob.createdAt ? "createdAt" : ob.receivedAt ? "receivedAt" : ob.updatedAt ? "updatedAt" : null;
      const dir = key ? ob[key] : null;
      if (key && dir === "desc") out = [...out].sort((a, b) => +new Date(b[key]) - +new Date(a[key]));
      if (key && dir === "asc") out = [...out].sort((a, b) => +new Date(a[key]) - +new Date(b[key]));
      if (args.take != null) out = out.slice(0, args.take);
      if (args.skip) out = out.slice(args.skip);
      return out.map((r) => applySelect(r, args.select));
    },
    findUnique: async (args: any = {}) => {
      t.calls.push({ method: "findUnique", args });
      const row = rows.find((r) => r.id === args.where?.id || (args.where?.key && r.key === args.where.key));
      return row ? applySelect(row, args.select) : null;
    },
    findFirst: async (args: any = {}) => {
      const out = rows.filter((r) => matches(r, args.where));
      return out[0] ?? null;
    },
    count: async (args: any = {}) => rows.filter((r) => matches(r, args.where)).length,
    create: async ({ data }: any) => {
      const row = { id: `row-${rows.length + 1}`, createdAt: new Date(), ...data };
      rows.push(row);
      t.calls.push({ method: "create", args: { data } });
      return row;
    },
  };
  return t;
}
function svc(prisma: any) { return new AdminService(prisma, audit); }

// ---------- 1. Announcement window validation ----------
describe("AA6.1 — announcement scheduling validation", () => {
  function annPrisma() {
    return { announcement: table([]) } as any;
  }
  it("endsAt <= startsAt → 400", async () => {
    const s = svc(annPrisma());
    await expect(s.createAnnouncement(SUPER, {
      title: "T", body: "B",
      startsAt: "2026-11-02T00:00:00.000Z", endsAt: "2026-11-01T00:00:00.000Z",
    })).rejects.toMatchObject({ code: "admin.endsatMustBeAfterStartsat" });
    await expect(s.createAnnouncement(SUPER, {
      title: "T", body: "B",
      startsAt: "2026-11-01T00:00:00.000Z", endsAt: "2026-11-01T00:00:00.000Z",
    })).rejects.toMatchObject({ code: "admin.endsatMustBeAfterStartsat" });
  });
  it("invalid startsAt → 400; invalid endsAt → 400", async () => {
    const s = svc(annPrisma());
    await expect(s.createAnnouncement(SUPER, { title: "T", body: "B", startsAt: "not-a-date" }))
      .rejects.toMatchObject({ code: "admin.startsatMustBeAValidIso" });
    await expect(s.createAnnouncement(SUPER, { title: "T", body: "B", endsAt: "also-not-a-date" }))
      .rejects.toMatchObject({ code: "admin.endsatMustBeAValidIso" });
  });
  it("valid window persists Dates", async () => {
    const p = annPrisma();
    const s = svc(p);
    const row: any = await s.createAnnouncement(SUPER, {
      title: "Sale", body: "Big sale",
      startsAt: "2026-11-01T00:00:00.000Z", endsAt: "2026-11-03T00:00:00.000Z",
    });
    expect(row.startsAt).toBeInstanceOf(Date);
    expect(row.endsAt).toBeInstanceOf(Date);
    expect(new Date(row.startsAt).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(new Date(row.endsAt).toISOString()).toBe("2026-11-03T00:00:00.000Z");
    const created = p.announcement.calls.find((c: any) => c.method === "create");
    expect(created.args.data.startsAt).toBeInstanceOf(Date);
  });
  it("no window still works (null dates)", async () => {
    const s = svc(annPrisma());
    const row: any = await s.createAnnouncement(SUPER, { title: "Hi", body: "Hello" });
    expect(row.startsAt).toBeNull();
    expect(row.endsAt).toBeNull();
  });
});

// ---------- 3. Audit depth + export ----------
describe("AA6.3 — auditTrail filters + exportAuditCsv", () => {
  it("filters land in the where (organizationId, entityType, createdAt gte/lte)", async () => {
    const p: any = { auditLog: table([]) };
    const s = svc(p);
    await s.auditTrail({
      action: "admin.", userId: "u-1", organizationId: "org-9", entityType: "Organization",
      dateFrom: "2026-10-01", dateTo: "2026-10-31", take: 10,
    });
    const call = p.auditLog.calls.find((c: any) => c.method === "findMany");
    expect(call.args.where).toMatchObject({
      userId: "u-1", organizationId: "org-9", entityType: "Organization",
    });
    expect(call.args.where.action).toEqual({ startsWith: "admin." });
    expect(call.args.where.createdAt.gte).toBeInstanceOf(Date);
    expect(new Date(call.args.where.createdAt.gte).toISOString()).toBe(new Date("2026-10-01").toISOString());
    expect(call.args.where.createdAt.lte).toBeInstanceOf(Date);
    expect(new Date(call.args.where.createdAt.lte).toISOString()).toBe(new Date("2026-10-31").toISOString());
    expect(call.args.take).toBe(10);
  });
  it("defaults unchanged when no filters", async () => {
    const p: any = { auditLog: table([]) };
    const s = svc(p);
    await s.auditTrail({});
    const call = p.auditLog.calls.find((c: any) => c.method === "findMany");
    expect(call.args.where).toEqual({});
    expect(call.args.take).toBe(50);
  });
  it("only provided date bound is included; unparseable dates are ignored", async () => {
    const p: any = { auditLog: table([]) };
    const s = svc(p);
    await s.auditTrail({ dateFrom: "2026-10-01", dateTo: "garbage" });
    const call = p.auditLog.calls.find((c: any) => c.method === "findMany");
    expect(call.args.where.createdAt.gte).toBeInstanceOf(Date);
    expect(call.args.where.createdAt.lte).toBeUndefined();
  });
  it("exportAuditCsv: header, row, quote-escaping of metadata with a double-quote", async () => {
    const rows = [{
      id: "a-1", createdAt: new Date("2026-10-11T10:00:00.000Z"),
      action: "admin.test", entityType: "Organization", entityId: "org-1",
      organizationId: "org-1", userId: "admin-1", ipAddress: "1.2.3.4",
      metadata: { note: 'say "hi" now' },
    }];
    const p: any = { auditLog: table(rows) };
    const csv = await svc(p).exportAuditCsv({});
    const lines = csv.split("\n");
    expect(lines[0]).toBe("createdAt,action,entityType,entityId,organizationId,userId,ipAddress,metadata");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("admin.test");
    expect(lines[1]).toContain("Organization");
    // esc() doubles every double-quote; the metadata JSON contains
    // quotes, so the CSV field must contain doubled quotes.
    expect(lines[1]).toContain('""');
    expect(lines[1]).toContain("hi");
    // take capped at 1000 for export
    const call = p.auditLog.calls.find((c: any) => c.method === "findMany");
    expect(call.args.take).toBe(1000);
  });
});

// ---------- 4. Dunning coverage ----------
describe("AA6.4 — dunningBoard reminderJobConfigured", () => {
  function dunningPrisma() {
    const past = new Date(Date.now() - 5 * 86400000);
    const p: any = {
      subscription: table([
        { id: "sub-1", organizationId: "org-1", plan: "GROWTH", status: "PAST_DUE", currentPeriodEnd: past, createdAt: new Date() },
        { id: "sub-2", organizationId: "org-2", plan: "STARTER", status: "PAST_DUE", currentPeriodEnd: past, createdAt: new Date() },
        { id: "sub-3", organizationId: "org-3", plan: "FREE", status: "PAST_DUE", currentPeriodEnd: past, createdAt: new Date() },
      ]),
      organization: table([
        { id: "org-1", name: "One" }, { id: "org-2", name: "Two" }, { id: "org-3", name: "Three" },
      ]),
      auditLog: table([]),
      scheduledJob: table([
        { id: "job-1", organizationId: "org-1", type: "dunning_reminders", enabled: true },
        { id: "job-2", organizationId: "org-2", type: "dunning_reminders", enabled: false },
        { id: "job-3", organizationId: "org-3", type: "other_type", enabled: true },
      ]),
    };
    return p;
  }
  it("enabled job → true; only disabled → false; none → false", async () => {
    const board: any[] = await svc(dunningPrisma()).dunningBoard();
    const byOrg = new Map(board.map((r) => [r.organizationId, r]));
    expect(byOrg.get("org-1").reminderJobConfigured).toBe(true);
    expect(byOrg.get("org-2").reminderJobConfigured).toBe(false);
    expect(byOrg.get("org-3").reminderJobConfigured).toBe(false);
  });
});

// ---------- 5. Storage per tenant ----------
describe("AA6.5 — usageBoard storage", () => {
  function baseUsagePrisma(mediaAsset: any) {
    return {
      organization: table([
        { id: "org-1", name: "One", status: "ACTIVE", createdAt: new Date() },
        { id: "org-2", name: "Two", status: "ACTIVE", createdAt: new Date() },
      ]),
      aIUsageRecord: table([]),
      messageDelivery: table([]),
      broadcast: table([]),
      workflowRun: table([]),
      courierShipment: table([]),
      order: table([]),
      mediaAsset,
    } as any;
  }
  it("fake WITHOUT groupBy exercises the fallback (sum + count correct)", async () => {
    // Deliberately no groupBy property at all.
    const mediaAsset: any = {
      rows: [
        { id: "m1", organizationId: "org-1", sizeBytes: 100 },
        { id: "m2", organizationId: "org-1", sizeBytes: 250 },
        { id: "m3", organizationId: "org-2", sizeBytes: 1000 },
      ],
      findMany: async ({ where, select }: any) => {
        const out = mediaAsset.rows.filter((r: any) => !where?.organizationId || r.organizationId === where.organizationId);
        return out.map((r: any) => applySelect(r, select));
      },
    };
    expect(typeof mediaAsset.groupBy).toBe("undefined");
    const board: any[] = await svc(baseUsagePrisma(mediaAsset)).usageBoard();
    const byOrg = new Map(board.map((r) => [r.organizationId, r]));
    expect(byOrg.get("org-1").storageBytes).toBe(350);
    expect(byOrg.get("org-1").mediaAssets).toBe(2);
    expect(byOrg.get("org-2").storageBytes).toBe(1000);
    expect(byOrg.get("org-2").mediaAssets).toBe(1);
  });
  it("groupBy path is used when available", async () => {
    let findManyCalled = false;
    const mediaAsset: any = {
      groupBy: async () => [
        { organizationId: "org-1", _sum: { sizeBytes: 999 }, _count: { _all: 3 } },
        { organizationId: "org-2", _sum: { sizeBytes: 0 }, _count: { _all: 0 } },
      ],
      findMany: async () => { findManyCalled = true; return []; },
    };
    const board: any[] = await svc(baseUsagePrisma(mediaAsset)).usageBoard();
    const byOrg = new Map(board.map((r) => [r.organizationId, r]));
    expect(byOrg.get("org-1").storageBytes).toBe(999);
    expect(byOrg.get("org-1").mediaAssets).toBe(3);
    expect(byOrg.get("org-2").storageBytes).toBe(0);
    expect(findManyCalled).toBe(false);
  });
});

// ---------- 6. Webhook explorer ----------
describe("AA6.6 — systemWebhooks + systemWebhookEvent", () => {
  const t0 = new Date("2026-10-11T09:00:00.000Z");
  const t1 = new Date("2026-10-11T10:00:00.000Z");
  const t2 = new Date("2026-10-11T11:00:00.000Z");
  function whPrisma(extraEvents: any[] = []) {
    const p: any = {
      organization: table([{ id: "org-1", name: "Demo Store" }, { id: "org-2", name: "Second Shop" }]),
      integration: table([
        { id: "int-1", organizationId: "org-1", provider: "woocommerce" },
        { id: "int-2", organizationId: "org-2", provider: "meta" },
      ]),
      webhookEvent: table([
        { id: "wh-1", integrationId: "int-1", provider: "woocommerce", topic: "order.created", deliveryId: "d-1", payload: { hello: "world" }, signatureValid: true, processedAt: t0, error: null, receivedAt: t0 },
        { id: "wh-2", integrationId: "int-1", provider: "woocommerce", topic: "order.updated", deliveryId: "d-2", payload: { x: 1 }, signatureValid: false, processedAt: null, error: "bad signature", receivedAt: t1 },
        { id: "wh-3", integrationId: "int-2", provider: "meta", topic: "page.post", deliveryId: "d-3", payload: { y: 2 }, signatureValid: true, processedAt: null, error: "meta oops", receivedAt: t2 },
        ...extraEvents,
      ]),
    };
    return p;
  }
  it("provider filter + hasError filter land in results; list items have NO payload key", async () => {
    const p = whPrisma();
    const s = svc(p);
    const byProvider: any[] = await s.systemWebhooks({ provider: "woocommerce" });
    expect(byProvider.map((r) => r.id).sort()).toEqual(["wh-1", "wh-2"]);
    for (const r of byProvider) {
      expect(r).not.toHaveProperty("payload");
      expect(r.organizationName).toBe("Demo Store");
      expect(r.organizationId).toBe("org-1");
    }
    const withErrors: any[] = await s.systemWebhooks({ hasError: true });
    expect(withErrors.map((r) => r.id).sort()).toEqual(["wh-2", "wh-3"]);
    const call = [...p.webhookEvent.calls].reverse().find((c: any) => c.method === "findMany");
    expect(call.args.where).toMatchObject({ error: { not: null } });
    const all: any[] = await s.systemWebhooks({});
    expect(all.map((r) => r.id)).toEqual(["wh-3", "wh-2", "wh-1"]); // receivedAt desc
  });
  it("org filter scopes via integrations; org with no integrations → []", async () => {
    const s = svc(whPrisma());
    const scoped: any[] = await s.systemWebhooks({ organizationId: "org-2" });
    expect(scoped.map((r) => r.id)).toEqual(["wh-3"]);
    expect(scoped[0].organizationName).toBe("Second Shop");
    const empty: any[] = await s.systemWebhooks({ organizationId: "org-ghost" });
    expect(empty).toEqual([]);
  });
  it("systemWebhookEvent: small payload returned parsed with payloadTruncated false", async () => {
    const s = svc(whPrisma());
    const ev: any = await s.systemWebhookEvent("wh-1");
    expect(ev.payload).toEqual({ hello: "world" });
    expect(ev.payloadTruncated).toBe(false);
    expect(ev.organizationId).toBe("org-1");
    expect(ev.organizationName).toBe("Demo Store");
  });
  it("systemWebhookEvent: >20000-char payload returns truncated string + payloadTruncated true", async () => {
    const big = { data: "x".repeat(25000) };
    const s = svc(whPrisma([{
      id: "wh-big", integrationId: "int-1", provider: "woocommerce", topic: "big",
      deliveryId: "d-big", payload: big, signatureValid: true, processedAt: null, error: null, receivedAt: t2,
    }]));
    const ev: any = await s.systemWebhookEvent("wh-big");
    expect(ev.payloadTruncated).toBe(true);
    expect(typeof ev.payload).toBe("string");
    expect(ev.payload).toHaveLength(20000);
    expect(ev.payload).toBe(JSON.stringify(big).slice(0, 20000));
  });
  it("systemWebhookEvent: unknown id → 404", async () => {
    const s = svc(whPrisma());
    await expect(s.systemWebhookEvent("nope")).rejects.toMatchObject({ code: "admin.webhookEventNotFound" });
    try {
      await s.systemWebhookEvent("nope");
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(e.getStatus?.() ?? e.status).toBe(404);
    }
  });
  it("webhook routes have no @AdminTier restriction (read-only system GETs)", () => {
    const reflector = new Reflector();
    expect(reflector.get(ADMIN_TIER_KEY, AdminController.prototype.systemWebhooks)).toBeUndefined();
    expect(reflector.get(ADMIN_TIER_KEY, AdminController.prototype.systemWebhookEvent)).toBeUndefined();
    expect(reflector.get(ADMIN_TIER_KEY, AdminController.prototype.exportAuditCsv)).toBeUndefined();
  });
});
