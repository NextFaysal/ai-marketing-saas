import { GoneException, NotFoundException } from "@nestjs/common";
import { buildOrgDataBundle, ORG_EXPORT_MAX_ROWS_PER_TABLE } from "../organizations/org-data-export";
import { DataExportsService } from "./data-exports.service";
import { AutomationService, JOB_TEMPLATES, JOB_TYPES } from "../automation/automation.service";

/**
 * AB8 (AX25) — Merchant Data Tools. Self-contained fakes
 * (m40 pattern) extended with cursor/orderBy/skip/select support
 * so the builder's id-cursor pagination is exercised for real.
 */

let seq = 0;
function match(row: any, where: any = {}): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (v === null || v === undefined) { if (row[k] !== v && row[k] !== undefined) return false; continue; }
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in (v as any)) { if (!(v as any).in.includes(row[k])) return false; }
      else if ("gte" in (v as any) || "lte" in (v as any) || "gt" in (v as any) || "lt" in (v as any)) {
        const t = new Date(row[k]).getTime();
        if ("gte" in (v as any) && !(t >= new Date((v as any).gte).getTime())) return false;
        if ("lte" in (v as any) && !(t <= new Date((v as any).lte).getTime())) return false;
        if ("gt" in (v as any) && !(t > new Date((v as any).gt).getTime())) return false;
        if ("lt" in (v as any) && !(t < new Date((v as any).lt).getTime())) return false;
      }
      else return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

function table(seed: any[] = []) {
  const rows = [...seed];
  const api: any = {
    rows,
    findMany: async (args: any = {}) => {
      let out = rows.filter((r) => match(r, args.where ?? {}));
      const orderBy = args.orderBy ?? {};
      if (orderBy.id) out = [...out].sort((a, b) => String(a.id).localeCompare(String(b.id)) * (orderBy.id === "desc" ? -1 : 1));
      if (orderBy.createdAt) out = [...out].sort((a, b) => (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * (orderBy.createdAt === "desc" ? -1 : 1));
      if (args.cursor?.id !== undefined) {
        const idx = out.findIndex((r) => r.id === args.cursor.id);
        if (idx < 0) out = [];
        else out = out.slice(idx + (args.skip ? 1 : 0));
      } else if (args.skip) out = out.slice(args.skip);
      if (args.take) out = out.slice(0, args.take);
      if (args.select) {
        const keys = Object.keys(args.select);
        out = out.map((r) => Object.fromEntries(keys.filter((k) => args.select[k]).map((k) => [k, r[k]])));
      }
      return out;
    },
    findFirst: async (args: any = {}) => {
      const out = await api.findMany({ ...args, take: 1 });
      return out[0] ?? null;
    },
    findUnique: async ({ where }: any) => rows.find((r) => match(r, where)) ?? null,
    count: async (args: any = {}) => rows.filter((r) => match(r, args.where ?? {})).length,
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
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
      const created = { id: `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create };
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
  return api;
}

function recordingAudit() {
  const calls: any[] = [];
  return { calls, log: jest.fn(async (entry: any) => { calls.push(entry); }) };
}

class MemoryStore {
  files = new Map<string, Buffer>();
  deleted: string[] = [];
  async put(key: string, bytes: Buffer) { this.files.set(key, Buffer.from(bytes)); }
  async get(key: string) { return this.files.get(key) ?? null; }
  async delete(key: string) { this.deleted.push(key); this.files.delete(key); }
}

const ORG_ID = "org-1";

function builderPrisma(overrides: Record<string, any> = {}) {
  const orderRows = overrides.order?.rows ?? [{ id: "o-1", organizationId: ORG_ID, totalMinor: 500n }, { id: "o-2", organizationId: ORG_ID, totalMinor: 700n }];
  const p: any = {
    organization: table([{ id: ORG_ID, name: "Acme", slug: "acme", status: "ACTIVE", creditMinor: 123n }]),
    businessProfile: table([{ id: "bp-1", organizationId: ORG_ID, description: "shop" }]),
    membership: table([{ id: "m-1", organizationId: ORG_ID, userId: "u-1", role: "OWNER" }]),
    user: table([
      { id: "u-1", email: "owner@acme.test", name: "Owner One", status: "ACTIVE" },
      { id: "u-2", email: "admin@acme.test", name: "Admin Two", status: "ACTIVE" },
    ]),
    product: table([
      { id: "p-1", organizationId: ORG_ID, name: "Shirt" },
      { id: "p-2", organizationId: ORG_ID, name: "Hat" },
      { id: "p-3", organizationId: ORG_ID, name: "Shoes" },
    ]),
    order: table(orderRows),
    orderItem: table([
      { id: "oi-1", orderId: "o-1", name: "Shirt", quantity: 1, priceMinor: 500n, totalMinor: 500n },
      { id: "oi-2", orderId: "o-1", name: "Hat", quantity: 2, priceMinor: 100n, totalMinor: 200n },
      { id: "oi-3", orderId: "o-2", name: "Shoes", quantity: 1, priceMinor: 700n, totalMinor: 700n },
      { id: "oi-foreign", orderId: "o-foreign", name: "Nope", quantity: 1, priceMinor: 1n, totalMinor: 1n },
    ]),
    customer: table([{ id: "c-1", organizationId: ORG_ID, name: "Customer" }]),
    lead: table([]),
    channelConversation: table([]),
    campaignPlan: table([]),
    integration: table([{ id: "i-1", organizationId: ORG_ID, provider: "woocommerce", status: "CONNECTED", externalAccountId: "store-9", lastSyncAt: null, createdAt: new Date(), credentialSecret: "must-never-leak" }]),
    subscription: table([]),
    saasPayment: table([{ id: "pay-1", organizationId: ORG_ID, amountMinor: 1000n, refundedMinor: 0n }]),
    supportTicket: table([{ id: "t-1", organizationId: ORG_ID, subject: "help" }]),
    mediaAsset: table([{
      id: "ma-1", organizationId: ORG_ID, kind: "image", name: "hero.png", contentType: "image/png",
      sizeBytes: 4242, storageKey: "org-1/2026-10/hero.png", origin: "upload", createdAt: new Date(),
      publicToken: "tok-secret-ish", prompt: "internal prompt", createdById: "u-1", sourceUrl: "https://x.test/a.png",
    }]),
    ...overrides,
  };
  // Relation-style count for orderItem (estimate path).
  const orderIds = new Set(orderRows.map((o: any) => o.id));
  p.orderItem.count = async () => p.orderItem.rows.filter((r: any) => orderIds.has(r.orderId)).length;
  return p;
}

describe("AB8 builder — manifest, legacy shape, extensions", () => {
  it("builds the historical legacy bundle plus orderItems/mediaAssets, with a full manifest", async () => {
    const p = builderPrisma();
    const out = await buildOrgDataBundle(p, ORG_ID, { exportedBy: "owner@acme.test" });

    // Legacy shape: exactly the historical keys, in order.
    expect(Object.keys(out.legacyBundle)).toEqual([
      "exportedAt", "exportedBy", "organization", "businessProfile", "members", "products",
      "orders", "customers", "leads", "conversations", "campaignPlans", "integrations",
      "subscription", "payments", "supportTickets",
    ]);
    expect(out.legacyBundle).not.toHaveProperty("orderItems");
    expect(out.legacyBundle.organization.creditMinor).toBe("123");
    expect(out.legacyBundle.members[0].user).toEqual(expect.objectContaining({ email: "owner@acme.test" }));
    expect(out.legacyBundle.payments[0].amountMinor).toBe("1000");
    // Integrations: safe subset only — the seeded secret never leaves.
    expect(out.legacyBundle.integrations[0]).toEqual({
      id: "i-1", provider: "woocommerce", status: "CONNECTED", externalAccountId: "store-9", lastSyncAt: null, createdAt: expect.anything(),
    });
    expect(JSON.stringify(out.legacyBundle)).not.toContain("must-never-leak");

    // Extensions ride in `data`, not in the legacy bundle.
    expect(out.data.orderItems.map((i: any) => i.id)).toEqual(["oi-1", "oi-2", "oi-3"]);
    expect(out.data.orderItems[0].priceMinor).toBe("500"); // BigInt jsonSafe pass
    expect(out.data.mediaAssets).toHaveLength(1);
    expect(Object.keys(out.data.mediaAssets[0]).sort()).toEqual(
      ["contentType", "createdAt", "id", "kind", "name", "origin", "sizeBytes", "storageKey"].sort(),
    );

    // Manifest lists every table with real counts, nothing truncated.
    expect(Object.keys(out.manifest.tables).sort()).toEqual([
      "businessProfile", "campaignPlans", "conversations", "customers", "integrations", "leads",
      "mediaAssets", "members", "orderItems", "orders", "organization", "payments", "products",
      "subscription", "supportTickets",
    ].sort());
    expect(out.manifest.exportedBy).toBe("owner@acme.test");
    expect(out.manifest.tables.products).toEqual({ rows: 3, truncated: false });
    expect(out.manifest.tables.orderItems).toEqual({ rows: 3, truncated: false });
    expect(out.manifest.tables.mediaAssets).toEqual({ rows: 1, truncated: false });
    expect(out.manifest.tables.organization).toEqual({ rows: 1, truncated: false });
    expect(out.manifest.tables.subscription).toEqual({ rows: 0, truncated: false });
    expect(out.counts.products).toBe(3);
  });

  it("throws NotFound for a missing org (admin semantics preserved)", async () => {
    const p = builderPrisma();
    await expect(buildOrgDataBundle(p, "org-nope", { exportedBy: "x@y.test" })).rejects.toMatchObject({ code: "common.orgNotFound" });
  });

  it("pages a table by id cursor in 1000-row chunks", async () => {
    const many = Array.from({ length: 2500 }, (_, i) => ({
      id: `p-${String(i).padStart(5, "0")}`, organizationId: ORG_ID, name: `Product ${i}`,
    }));
    const p = builderPrisma({ product: table(many) });
    const calls: any[] = [];
    const orig = p.product.findMany;
    p.product.findMany = async (args: any) => { calls.push(args); return orig(args); };
    const out = await buildOrgDataBundle(p, ORG_ID, { exportedBy: "x@y.test" });
    expect(out.legacyBundle.products).toHaveLength(2500);
    expect(out.legacyBundle.products[2499].id).toBe("p-02499");
    expect(out.manifest.tables.products).toEqual({ rows: 2500, truncated: false });
    expect(calls).toHaveLength(3);
    expect(calls[0].take).toBe(1000);
    expect(calls[1].cursor).toEqual({ id: "p-00999" });
    expect(calls[1].skip).toBe(1);
  });

  it("flags truncated=true only when rows exist past the 200,000 ceiling (probe-proven)", async () => {
    // Virtual table: synthesizes pages without storing 200k rows.
    const virtual = (total: number) => ({
      findMany: async (args: any = {}) => {
        let start = 0;
        if (args.cursor?.id) start = Number(String(args.cursor.id).split("-")[1]) + (args.skip ? 1 : 0);
        else if (args.skip) start = args.skip;
        const take = args.take ?? total;
        const out = [];
        for (let i = start; i < Math.min(start + take, total); i++) {
          out.push({ id: `v-${String(i).padStart(7, "0")}`, organizationId: ORG_ID, name: `V${i}` });
        }
        return out;
      },
    });
    const over = builderPrisma({ product: virtual(ORG_EXPORT_MAX_ROWS_PER_TABLE + 1) });
    const outOver = await buildOrgDataBundle(over, ORG_ID, { exportedBy: "x@y.test" });
    expect(outOver.legacyBundle.products).toHaveLength(ORG_EXPORT_MAX_ROWS_PER_TABLE);
    expect(outOver.manifest.tables.products).toEqual({ rows: ORG_EXPORT_MAX_ROWS_PER_TABLE, truncated: true });

    const exact = builderPrisma({ product: virtual(ORG_EXPORT_MAX_ROWS_PER_TABLE) });
    const outExact = await buildOrgDataBundle(exact, ORG_ID, { exportedBy: "x@y.test" });
    expect(outExact.manifest.tables.products).toEqual({ rows: ORG_EXPORT_MAX_ROWS_PER_TABLE, truncated: false });
  }, 120_000);
});

function servicePrisma(overrides: Record<string, any> = {}) {
  const p = builderPrisma(overrides.builder ?? {});
  p.dataExport = table(overrides.dataExport ?? []);
  p.orgBackupPreference = table(overrides.orgBackupPreference ?? []);
  p.auditLog = table(overrides.auditLog ?? []);
  return p;
}

function makeService(p: any) {
  const audit = recordingAudit();
  const svc = new DataExportsService(p as any, audit as any);
  const store = new MemoryStore();
  svc.storeFactory = () => store;
  return { svc, audit, store };
}

describe("AB8 DataExportsService — create / generate / download", () => {
  it("small orgs generate INLINE: row ready, file stored with manifest+data, create audited", async () => {
    const p = servicePrisma();
    const { svc, audit, store } = makeService(p);
    const row: any = await svc.createExport(ORG_ID, "u-1", "manual");
    expect(row.status).toBe("ready");
    expect(row.fileRef).toBe(`data-exports/${ORG_ID}/${row.id}.json`);
    expect(row.expiresAt.getTime() - row.completedAt.getTime()).toBe(7 * 86_400_000);
    const bytes = store.files.get(row.fileRef);
    expect(bytes).toBeDefined();
    expect(row.sizeBytes).toBe(bytes!.length);
    const parsed = JSON.parse(bytes!.toString("utf8"));
    expect(parsed.manifest.tables.products.rows).toBe(3);
    expect(parsed.data.organization.name).toBe("Acme");
    expect(parsed.data.orderItems).toHaveLength(3);
    expect(parsed.data.mediaAssets).toHaveLength(1);
    const createAudit = audit.calls.find((c: any) => c.action === "data_export.create");
    expect(createAudit).toBeDefined();
    expect(createAudit.organizationId).toBe(ORG_ID);
    expect(createAudit.metadata).toEqual(expect.objectContaining({ kind: "manual", mode: "inline" }));
  });

  it("large orgs stay pending (queued) past the 25,000-row estimate threshold", async () => {
    const manyProducts = table(Array.from({ length: 25_001 }, (_, i) => ({ id: `p-${i}`, organizationId: ORG_ID })));
    const p = servicePrisma({ builder: { product: manyProducts } });
    const { svc, audit, store } = makeService(p);
    const row: any = await svc.createExport(ORG_ID, "u-1", "manual");
    expect(row.status).toBe("pending");
    expect(store.files.size).toBe(0);
    const createAudit = audit.calls.find((c: any) => c.action === "data_export.create");
    expect(createAudit.metadata.mode).toBe("queued");
    expect(createAudit.metadata.estimatedRows).toBeGreaterThan(25_000);
  });

  it("runPendingForOrg generates queued rows (the data_export_generate job body)", async () => {
    const p = servicePrisma({
      dataExport: [{ id: "exp-pending-1", organizationId: ORG_ID, requestedById: "u-1", kind: "manual", status: "pending", createdAt: new Date() }],
    });
    const { svc, store } = makeService(p);
    const out: any = await svc.runPendingForOrg(ORG_ID);
    expect(out).toEqual({ total: 1, ready: 1, failed: 0 });
    expect(p.dataExport.rows[0].status).toBe("ready");
    expect(store.files.has("data-exports/org-1/exp-pending-1.json")).toBe(true);
  });

  it("generate never throws: a missing org lands as a failed row with the real error (≤500 chars)", async () => {
    const p = servicePrisma({
      dataExport: [{ id: "exp-bad", organizationId: "org-missing", requestedById: "u-1", kind: "manual", status: "pending", createdAt: new Date() }],
    });
    const { svc } = makeService(p);
    const out: any = await svc.generate("exp-bad");
    expect(out.status).toBe("failed");
    expect(out.error).toContain("অর্গানাইজেশনটি পাওয়া যায়নি");
    expect(out.error.length).toBeLessThanOrEqual(500);
    await expect(svc.generate("exp-ghost")).resolves.toBeNull();
  });

  it("download returns the stored bytes with the export filename", async () => {
    const p = servicePrisma();
    const { svc } = makeService(p);
    const row: any = await svc.createExport(ORG_ID, "u-1", "manual");
    const out = await svc.download(ORG_ID, row.id);
    expect(out.filename).toBe(`qosprey-data-export-${ORG_ID}-${row.id}.json`);
    expect(out.sizeBytes).toBe(row.sizeBytes);
    expect(JSON.parse(out.bytes.toString("utf8")).data.organization.id).toBe(ORG_ID);
  });

  it("download of a foreign org's export is a 404", async () => {
    const p = servicePrisma();
    const { svc } = makeService(p);
    const row: any = await svc.createExport(ORG_ID, "u-1", "manual");
    await expect(svc.download("org-2", row.id)).rejects.toMatchObject({ code: "dataTools.exportNotFound" });
    await expect(svc.download(ORG_ID, "exp-nope")).rejects.toMatchObject({ code: "dataTools.exportNotFound" });
  });

  it("an export past its expiry is marked expired and answers 410", async () => {
    const past = new Date(Date.now() - 60_000);
    const p = servicePrisma({
      dataExport: [{ id: "exp-old", organizationId: ORG_ID, requestedById: "u-1", kind: "manual", status: "ready", fileRef: "data-exports/org-1/exp-old.json", sizeBytes: 10, expiresAt: past, createdAt: past }],
    });
    const { svc, store } = makeService(p);
    store.files.set("data-exports/org-1/exp-old.json", Buffer.from("{}"));
    await expect(svc.download(ORG_ID, "exp-old")).rejects.toMatchObject({ code: "dataTools.thisExportHasExpired" });
    expect(p.dataExport.rows[0].status).toBe("expired");
  });

  it("a ready row whose stored bytes are missing is marked expired (error noted) and answers 410", async () => {
    const future = new Date(Date.now() + 86_400_000);
    const p = servicePrisma({
      dataExport: [{ id: "exp-lost", organizationId: ORG_ID, requestedById: "u-1", kind: "manual", status: "ready", fileRef: "data-exports/org-1/exp-lost.json", sizeBytes: 10, expiresAt: future, createdAt: new Date() }],
    });
    const { svc } = makeService(p);
    await expect(svc.download(ORG_ID, "exp-lost")).rejects.toMatchObject({ code: "dataTools.theStoredExportFileIsMissing" });
    expect(p.dataExport.rows[0].status).toBe("expired");
    expect(p.dataExport.rows[0].error).toContain("missing");
  });
});

describe("AB8 DataExportsService — backup preference + sweep", () => {
  it("setBackupPreference upserts and audits the change", async () => {
    const p = servicePrisma();
    const { svc, audit } = makeService(p);
    const pref: any = await svc.setBackupPreference(ORG_ID, "u-1", true);
    expect(pref.enabled).toBe(true);
    const call = audit.calls.find((c: any) => c.action === "data_export.backup_preference");
    expect(call.organizationId).toBe(ORG_ID);
    expect(call.metadata).toEqual({ enabled: true });
    const off: any = await svc.setBackupPreference(ORG_ID, "u-1", false);
    expect(off.enabled).toBe(false);
    expect(p.orgBackupPreference.rows).toHaveLength(1);
  });

  it("listExports returns own rows desc plus the backup preference summary", async () => {
    const p = servicePrisma({
      dataExport: [
        { id: "e-old", organizationId: ORG_ID, kind: "manual", status: "ready", createdAt: new Date("2026-10-01") },
        { id: "e-new", organizationId: ORG_ID, kind: "backup", status: "ready", createdAt: new Date("2026-10-10") },
        { id: "e-foreign", organizationId: "org-2", kind: "manual", status: "ready", createdAt: new Date("2026-10-12") },
      ],
      orgBackupPreference: [{ id: "pref-1", organizationId: ORG_ID, enabled: true, lastBackupAt: new Date("2026-10-09") }],
    });
    const { svc } = makeService(p);
    const out: any = await svc.listExports(ORG_ID);
    expect(out.exports.map((e: any) => e.id)).toEqual(["e-new", "e-old"]);
    expect(out.backupPreference).toEqual({ enabled: true, lastBackupAt: new Date("2026-10-09") });
  });

  it("sweep does nothing when the preference is disabled or absent", async () => {
    const p = servicePrisma();
    const { svc } = makeService(p);
    await expect(svc.runBackupSweepForOrg(ORG_ID)).resolves.toEqual({ skipped: "backup_disabled" });
    await svc.setBackupPreference(ORG_ID, "u-1", false);
    await expect(svc.runBackupSweepForOrg(ORG_ID)).resolves.toEqual({ skipped: "backup_disabled" });
    expect(p.dataExport.rows).toHaveLength(0);
  });

  it("sweep skips when the last backup is under 7 days old", async () => {
    const p = servicePrisma({
      orgBackupPreference: [{ id: "pref-1", organizationId: ORG_ID, enabled: true, lastBackupAt: new Date(Date.now() - 2 * 86_400_000) }],
    });
    const { svc } = makeService(p);
    const out: any = await svc.runBackupSweepForOrg(ORG_ID);
    expect(out.skipped).toBe("not_due");
    expect(p.dataExport.rows).toHaveLength(0);
  });

  it("due sweep creates a backup, stamps lastBackupAt, and retention expires the oldest beyond 4 ready", async () => {
    const day = 86_400_000;
    const seeded = [1, 2, 3, 4].map((n) => ({
      id: `bak-${n}`, organizationId: ORG_ID, requestedById: "u-1", kind: "backup", status: "ready",
      fileRef: `data-exports/org-1/bak-${n}.json`, sizeBytes: 5,
      createdAt: new Date(Date.now() - (10 - n) * day), expiresAt: new Date(Date.now() + 7 * day),
    }));
    const p = servicePrisma({
      dataExport: seeded,
      orgBackupPreference: [{ id: "pref-1", organizationId: ORG_ID, enabled: true, lastBackupAt: new Date(Date.now() - 8 * day) }],
    });
    const { svc, store } = makeService(p);
    for (const b of seeded) store.files.set(b.fileRef, Buffer.from("{}"));

    const out: any = await svc.runBackupSweepForOrg(ORG_ID);
    expect(out.ready).toBe(true);
    expect(out.expiredOld).toBe(1); // 4 seeded + 1 new = 5 ready → newest 4 kept
    const created = p.dataExport.rows.find((r: any) => r.id === out.created);
    expect(created.kind).toBe("backup");
    expect(created.status).toBe("ready");
    // The oldest seeded backup (bak-1) lost its file and was expired.
    expect(store.deleted).toContain("data-exports/org-1/bak-1.json");
    expect(store.files.has("data-exports/org-1/bak-1.json")).toBe(false);
    expect(p.dataExport.rows.find((r: any) => r.id === "bak-1").status).toBe("expired");
    expect(p.dataExport.rows.find((r: any) => r.id === "bak-2").status).toBe("ready");
    // lastBackupAt stamped fresh.
    const pref = p.orgBackupPreference.rows[0];
    expect(Date.now() - new Date(pref.lastBackupAt).getTime()).toBeLessThan(60_000);
  });
});

describe("AB8 audit viewer — org-stamped rows only", () => {
  function viewerPrisma() {
    return servicePrisma({
      auditLog: [
        { id: "a-1", organizationId: ORG_ID, userId: "u-1", action: "order.created", entityType: "Order", entityId: "o-1", metadata: { via: "test" }, createdAt: new Date("2026-10-10T10:00:00Z") },
        { id: "a-2", organizationId: ORG_ID, userId: "u-2", action: "order.paid", entityType: "Order", entityId: "o-2", metadata: null, createdAt: new Date("2026-10-12T10:00:00Z") },
        { id: "a-3", organizationId: ORG_ID, userId: null, action: "data_export.create", entityType: "DataExport", entityId: "e-1", metadata: { kind: "manual" }, createdAt: new Date("2026-10-11T10:00:00Z") },
        { id: "a-foreign", organizationId: "org-2", userId: "u-1", action: "order.created", entityType: "Order", entityId: "o-9", metadata: null, createdAt: new Date("2026-10-13T10:00:00Z") },
        { id: "a-platform", organizationId: null, userId: "u-1", action: "auth.login", entityType: "User", entityId: "u-1", metadata: null, createdAt: new Date("2026-10-13T11:00:00Z") },
      ],
    });
  }

  it("returns only this org's stamped rows, newest first, with actors resolved and the coverage note", async () => {
    const { svc } = makeService(viewerPrisma());
    const out: any = await svc.listAuditLogs(ORG_ID, {});
    expect(out.scopeNote).toBe("org_stamped_only");
    expect(out.total).toBe(3);
    expect(out.items.map((i: any) => i.id)).toEqual(["a-2", "a-3", "a-1"]);
    expect(out.items[0].actor).toEqual({ id: "u-2", email: "admin@acme.test", name: "Admin Two" });
    expect(out.items[1].actor).toBeNull(); // system row: userId null → actor null, not invented
    expect(out.items[2]).toEqual(expect.objectContaining({ action: "order.created", entityType: "Order", entityId: "o-1" }));
  });

  it("filters by entity, actor and date range, and paginates", async () => {
    const { svc } = makeService(viewerPrisma());
    const byEntity: any = await svc.listAuditLogs(ORG_ID, { entity: "Order" });
    expect(byEntity.total).toBe(2);
    const byActor: any = await svc.listAuditLogs(ORG_ID, { actorId: "u-1" });
    expect(byActor.items.map((i: any) => i.id)).toEqual(["a-1"]);
    const byRange: any = await svc.listAuditLogs(ORG_ID, { from: "2026-10-11", to: "2026-10-13" });
    expect(byRange.items.map((i: any) => i.id)).toEqual(["a-2", "a-3"]);
    const page2: any = await svc.listAuditLogs(ORG_ID, { page: 2, pageSize: 2 });
    expect(page2.total).toBe(3);
    expect(page2.items.map((i: any) => i.id)).toEqual(["a-1"]);
    const capped: any = await svc.listAuditLogs(ORG_ID, { pageSize: 500 });
    expect(capped.pageSize).toBe(100);
  });
});

describe("AB8 job wiring", () => {
  it("registers both job types with org templates (15 / 60 minutes)", () => {
    expect(JOB_TYPES as readonly string[]).toContain("data_export_generate");
    expect(JOB_TYPES as readonly string[]).toContain("org_backup_sweep");
    const gen = JOB_TEMPLATES.find((t) => t.type === "data_export_generate");
    const sweep = JOB_TEMPLATES.find((t) => t.type === "org_backup_sweep");
    expect(gen).toMatchObject({ targetKind: "org", intervalMinutes: 15 });
    expect(sweep).toMatchObject({ targetKind: "org", intervalMinutes: 60 });
    expect(gen!.descriptionBn.length).toBeGreaterThan(10);
    expect(sweep!.descriptionBn.length).toBeGreaterThan(10);
  });

  it("executeJob dispatches both types to DataExportsService, and honestly skips when absent", async () => {
    const fake: any = {
      runPendingForOrg: jest.fn(async () => ({ total: 2, ready: 2, failed: 0 })),
      runBackupSweepForOrg: jest.fn(async () => ({ ready: true })),
    };
    const svc: any = Object.create(AutomationService.prototype);
    svc.dataExports = fake;
    await expect(svc.executeJob({ type: "data_export_generate", organizationId: ORG_ID, createdById: "u-1" })).resolves.toEqual({ total: 2, ready: 2, failed: 0 });
    expect(fake.runPendingForOrg).toHaveBeenCalledWith(ORG_ID);
    await expect(svc.executeJob({ type: "org_backup_sweep", organizationId: ORG_ID, createdById: "u-1" })).resolves.toEqual({ ready: true });
    expect(fake.runBackupSweepForOrg).toHaveBeenCalledWith(ORG_ID);

    const bare: any = Object.create(AutomationService.prototype);
    await expect(bare.executeJob({ type: "data_export_generate", organizationId: ORG_ID, createdById: "u-1" })).resolves.toEqual({ skipped: "data exports unavailable" });
  });
});
