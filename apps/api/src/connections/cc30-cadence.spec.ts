process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "unit";

import { ConnectionsService } from "./connections.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { ShopifyService } from "../integrations/shopify/shopify.service";
import { cadenceSkip } from "../integrations/sync-cadence";

/**
 * CC30(a) — per-connection sync cadence (the CC18 leftover).
 * Pinned rules:
 * - a SCHEDULED sync inside the cadence window is skipped with
 *   reason "sync_interval" and creates NO SyncJob row (the skip
 *   is the automation job's run result, not a fake job);
 * - a scheduled sync after the window proceeds (a real RUNNING
 *   SyncJob row appears);
 * - a MANUAL sync (no { scheduled: true }) inside the window
 *   proceeds untouched — a human asking now means now;
 * - CC18's pause still wins over cadence (the recorded
 *   "sync_paused" skip is what a paused+cadenced connection
 *   returns), and "sync_paused" marker rows never count as the
 *   "last sync" for the window;
 * - the window is per (integration, kind): a recent ORDERS sync
 *   does not throttle a PRODUCTS sync of the same store;
 * - setSyncInterval validates 5..10080, null clears, audits.
 */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in v) return v.in.includes(row[k]);
      if ("gte" in v || "lt" in v) {
        const t = row[k] instanceof Date ? row[k].getTime() : new Date(row[k]).getTime();
        if ("gte" in v && !(t >= new Date(v.gte).getTime())) return false;
        if ("lt" in v && !(t < new Date(v.lt).getTime())) return false;
        return true;
      }
      return true;
    }
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    return row[k] === v;
  });
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  const sortBy = (out: any[], orderBy: any) => {
    if (!orderBy) return out;
    const [key, dir] = Object.entries(orderBy)[0] as [string, string];
    return [...out].sort((a, b) => {
      const av = a[key] instanceof Date ? a[key].getTime() : new Date(a[key]).getTime();
      const bv = b[key] instanceof Date ? b[key].getTime() : new Date(b[key]).getTime();
      return dir === "desc" ? bv - av : av - bv;
    });
  };
  return {
    rows,
    findFirst: async ({ where, orderBy }: any = {}) => sortBy(rows.filter((r) => matches(r, where ?? {})), orderBy)[0] ?? null,
    findMany: async ({ where, orderBy, take }: any = {}) => {
      const out = sortBy(rows.filter((r) => matches(r, where ?? {})), orderBy);
      return take ? out.slice(0, take) : out;
    },
    findUnique: async ({ where }: any) => rows.filter((r) => matches(r, where ?? {}))[0] ?? null,
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), startedAt: new Date(), ...data };
      rows.push(row); return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (row) Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const row of rows) if (matches(row, where)) { Object.assign(row, data); count++; }
      return { count };
    },
  };
}

const auditStub = () => {
  const logs: any[] = [];
  return { logs, log: async (e: any) => { logs.push(e); } } as any;
};

const MIN = 60_000;
const ago = (minutes: number) => new Date(Date.now() - minutes * MIN);

function wooTables() {
  const tables: any = { integration: makeTable("int"), syncJob: makeTable("job") };
  tables.integration.rows.push({
    id: "int-woo", organizationId: "org-1", provider: "woocommerce", status: "CONNECTED",
    syncPaused: false, syncIntervalMinutes: 60, storeId: "store-1",
  });
  return tables;
}

describe("CC30 cadence — the gate (unit)", () => {
  it("no cadence set ⇒ never skips, even with a sync 1 minute ago", async () => {
    const tables = wooTables();
    tables.integration.rows[0].syncIntervalMinutes = null;
    tables.syncJob.rows.push({ id: "j-1", integrationId: "int-woo", kind: "products", status: "COMPLETED", startedAt: ago(1), error: null });
    await expect(cadenceSkip(tables, tables.integration.rows[0], "products")).resolves.toBeNull();
  });

  it("a 'sync_paused' marker row is NOT the last sync — the window reads the last REAL sync", async () => {
    const tables = wooTables();
    tables.syncJob.rows.push({ id: "j-real", integrationId: "int-woo", kind: "products", status: "COMPLETED", startedAt: ago(120), error: null });
    tables.syncJob.rows.push({ id: "j-paused", integrationId: "int-woo", kind: "products", status: "COMPLETED", startedAt: ago(1), error: "sync_paused" });
    // The real sync was 120 minutes ago (> 60) ⇒ no skip, even
    // though a paused marker landed a minute ago.
    await expect(cadenceSkip(tables, tables.integration.rows[0], "products")).resolves.toBeNull();
  });

  it("the window is per kind: a recent orders sync does not throttle products", async () => {
    const tables = wooTables();
    tables.syncJob.rows.push({ id: "j-ord", integrationId: "int-woo", kind: "orders", status: "COMPLETED", startedAt: ago(2), error: null });
    await expect(cadenceSkip(tables, tables.integration.rows[0], "products")).resolves.toBeNull();
    const skip = await cadenceSkip(tables, tables.integration.rows[0], "orders");
    expect(skip).toMatchObject({ skipped: true, reason: "sync_interval", kind: "orders", syncIntervalMinutes: 60 });
  });
});

describe("CC30 cadence — Woo sync entry points", () => {
  it("a SCHEDULED sync inside the window skips with NO new SyncJob row", async () => {
    const tables = wooTables();
    tables.syncJob.rows.push({ id: "j-1", integrationId: "int-woo", kind: "products", status: "COMPLETED", startedAt: ago(30), error: null });
    const svc = new IntegrationsService(tables as any, auditStub());
    const result: any = await svc.syncProducts("org-1", "u-1", "int-woo", { scheduled: true });
    expect(result).toMatchObject({ skipped: true, reason: "sync_interval", integrationId: "int-woo", kind: "products" });
    expect(result.nextEligibleAt.getTime()).toBeGreaterThan(Date.now());
    // The skip is the job result only — no fake SyncJob exists.
    expect(tables.syncJob.rows).toHaveLength(1);
  });

  it("a SCHEDULED sync after the window proceeds (a real job row is created)", async () => {
    const tables = wooTables();
    tables.syncJob.rows.push({ id: "j-1", integrationId: "int-woo", kind: "products", status: "COMPLETED", startedAt: ago(61), error: null });
    const svc = new IntegrationsService(tables as any, auditStub());
    // No store/credential in the fake: proceeding past the gate
    // means the sync actually starts (job row created) and then
    // fails on the missing store — the gate is not what stops it.
    await expect(svc.syncProducts("org-1", "u-1", "int-woo", { scheduled: true })).rejects.toThrow();
    expect(tables.syncJob.rows.length).toBeGreaterThan(1);
    expect(tables.syncJob.rows.some((j: any) => j.kind === "products" && j.id !== "j-1")).toBe(true);
  });

  it("a MANUAL sync inside the window ignores the cadence and proceeds", async () => {
    const tables = wooTables();
    tables.syncJob.rows.push({ id: "j-1", integrationId: "int-woo", kind: "products", status: "COMPLETED", startedAt: ago(5), error: null });
    const svc = new IntegrationsService(tables as any, auditStub());
    await expect(svc.syncProducts("org-1", "u-1", "int-woo")).rejects.toThrow();
    expect(tables.syncJob.rows.length).toBeGreaterThan(1);
  });

  it("pause wins over cadence: paused + cadenced + scheduled ⇒ the recorded sync_paused skip", async () => {
    const tables = wooTables();
    tables.integration.rows[0].syncPaused = true;
    tables.syncJob.rows.push({ id: "j-1", integrationId: "int-woo", kind: "products", status: "COMPLETED", startedAt: ago(5), error: null });
    const svc = new IntegrationsService(tables as any, auditStub());
    const result: any = await svc.syncProducts("org-1", "u-1", "int-woo", { scheduled: true });
    expect(result).toMatchObject({ skipped: true, reason: "sync_paused" });
    // CC18's recorded skip exists (a real row), unlike cadence.
    expect(tables.syncJob.rows.some((j: any) => j.error === "sync_paused")).toBe(true);
  });
});

describe("CC30 cadence — Shopify sync entry points", () => {
  it("a SCHEDULED Shopify orders sync inside the window skips with no new job row", async () => {
    const tables: any = { integration: makeTable("int"), syncJob: makeTable("job") };
    tables.integration.rows.push({
      id: "int-shop", organizationId: "org-1", provider: "shopify", status: "CONNECTED",
      syncPaused: false, syncIntervalMinutes: 360, storeId: "store-2",
    });
    tables.syncJob.rows.push({ id: "j-1", integrationId: "int-shop", kind: "orders", status: "COMPLETED", startedAt: ago(60), error: null });
    const svc = new ShopifyService(tables as any, auditStub(), {} as any);
    const result: any = await svc.syncOrders("org-1", "u-1", "int-shop", { scheduled: true });
    expect(result).toMatchObject({ skipped: true, reason: "sync_interval", kind: "orders", syncIntervalMinutes: 360 });
    expect(tables.syncJob.rows).toHaveLength(1);
  });
});

describe("CC30 cadence — setSyncInterval (ConnectionsService)", () => {
  function build() {
    const tables: any = { integration: makeTable("int") };
    tables.integration.rows.push({ id: "int-woo", organizationId: "org-1", provider: "woocommerce", syncIntervalMinutes: null });
    const audit = auditStub();
    const svc = new ConnectionsService(tables as any, audit);
    return { svc, tables, audit };
  }

  it("sets a valid cadence and audits it", async () => {
    const { svc, tables, audit } = build();
    const res: any = await svc.setSyncInterval("org-1", "u-owner", "int-woo", 120);
    expect(res).toMatchObject({ id: "int-woo", syncIntervalMinutes: 120 });
    expect(tables.integration.rows[0].syncIntervalMinutes).toBe(120);
    expect(audit.logs.some((l: any) => l.action === "integration.sync_interval_set")).toBe(true);
  });

  it("null clears the cadence", async () => {
    const { svc, tables } = build();
    tables.integration.rows[0].syncIntervalMinutes = 120;
    const res: any = await svc.setSyncInterval("org-1", "u-owner", "int-woo", null);
    expect(res.syncIntervalMinutes).toBeNull();
    expect(tables.integration.rows[0].syncIntervalMinutes).toBeNull();
  });

  it("rejects out-of-range values and writes nothing", async () => {
    const { svc, tables } = build();
    await expect(svc.setSyncInterval("org-1", "u-owner", "int-woo", 4)).rejects.toThrow(/৫ থেকে ১০০৮০/);
    await expect(svc.setSyncInterval("org-1", "u-owner", "int-woo", 10081)).rejects.toThrow(/৫ থেকে ১০০৮০/);
    await expect(svc.setSyncInterval("org-1", "u-owner", "int-woo", 30.5)).rejects.toThrow(/৫ থেকে ১০০৮০/);
    expect(tables.integration.rows[0].syncIntervalMinutes).toBeNull();
  });

  it("404s for another org's integration", async () => {
    const { svc } = build();
    await expect(svc.setSyncInterval("org-2", "u-owner", "int-woo", 60)).rejects.toMatchObject({ code: "connections.integrationNotFound" });
  });
});
