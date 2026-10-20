import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { buildOrgDataBundle } from "../organizations/org-data-export";
import { DataImportsService } from "./data-imports.service";
import { DataExportsController } from "./data-exports.controller";
import { checkBundle } from "./org-data-import";
import { ROLES_KEY } from "../common/decorators";
import { RolesGuard } from "../common/roles.guard";
import { TenantGuard } from "../common/tenant.guard";

/**
 * ORG16 (Organization Next OB5) — bundle import/restore specs.
 *
 * The centrepiece is a TRUE round-trip: org A's data goes through
 * the REAL export builder (buildOrgDataBundle), the file body is
 * JSON-serialized exactly as the download pipeline stores it, and
 * the import service restores it into a fresh org B against the
 * same fake database — ids, relationships, money types and the
 * skip/strip rules are then asserted on B's actual rows.
 */

let seq = 0;
function match(row: any, where: any = {}): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (v === null || v === undefined) { if (row[k] !== v && row[k] !== undefined) return false; continue; }
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in (v as any)) { if (!(v as any).in.includes(row[k])) return false; }
      else if ("gte" in (v as any) || "lte" in (v as any)) {
        const t = new Date(row[k]).getTime();
        if ("gte" in (v as any) && !(t >= new Date((v as any).gte).getTime())) return false;
        if ("lte" in (v as any) && !(t <= new Date((v as any).lte).getTime())) return false;
      } else return false;
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
    createMany: async ({ data }: any) => {
      for (const d of data) {
        rows.push({ id: d.id ?? `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...d });
      }
      return { count: data.length };
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => match(r, where));
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    },
  };
  return api;
}

const TABLE_NAMES = [
  "organization", "businessProfile", "membership", "user", "product", "order",
  "orderItem", "customer", "lead", "channelConversation", "campaignPlan",
  "integration", "subscription", "saasPayment", "supportTicket", "mediaAsset",
  "dataImport",
] as const;

function makeDb(seed: Partial<Record<(typeof TABLE_NAMES)[number], any[]>> = {}) {
  const db: any = {};
  for (const name of TABLE_NAMES) db[name] = table(seed[name] ?? []);
  db.$transaction = async (cb: (tx: any) => Promise<any>) => {
    const snapshot = new Map<string, any[]>();
    for (const name of TABLE_NAMES) snapshot.set(name, structuredClone(db[name].rows));
    try {
      return await cb(db);
    } catch (e) {
      for (const name of TABLE_NAMES) {
        const copy = snapshot.get(name)!;
        db[name].rows.splice(0, db[name].rows.length, ...copy);
      }
      throw e;
    }
  };
  return db;
}

function makeAudit() {
  const logs: any[] = [];
  return { logs, log: async (input: any) => { logs.push(input); } };
}

const D = (s: string) => new Date(s);

function seedOrgA() {
  return {
    organization: [
      { id: "org-a", name: "Dhaka Fashion", slug: "dhaka-fashion", creditMinor: 0n, currency: "BDT", timezone: "Asia/Dhaka", country: "BD", createdAt: D("2026-01-01"), updatedAt: D("2026-01-02") },
      { id: "org-b", name: "New Shop", slug: "new-shop", creditMinor: 0n, currency: "BDT", timezone: "Asia/Dhaka", country: "BD", createdAt: D("2026-10-01"), updatedAt: D("2026-10-01") },
    ],
    businessProfile: [
      {
        id: "prof-a", organizationId: "org-a", description: "ঢাকার ফ্যাশন হাউস", industry: "fashion",
        contactEmail: "hello@dhaka-fashion.example", contactPhone: "01711000000",
        bkashNumber: "01711000000", nagadNumber: "01711000001", monthlyBudgetMinor: 500000n,
        metaCapiToken: "SECRET-CAPI-TOKEN", customDomain: "legacy.example.com",
        createdAt: D("2026-01-01"), updatedAt: D("2026-01-03"),
      },
      { id: "prof-b", organizationId: "org-b", description: null, industry: null, contactEmail: null, createdAt: D("2026-10-01"), updatedAt: D("2026-10-01") },
    ],
    user: [{ id: "user-owner-a", email: "owner-a@example.com", name: "Owner A", status: "ACTIVE" }],
    membership: [
      { id: "mem-1", userId: "user-owner-a", organizationId: "org-a", role: "OWNER", status: "ACTIVE", createdAt: D("2026-01-01"), updatedAt: D("2026-01-01") },
    ],
    product: [
      { id: "prod-1", organizationId: "org-a", name: "পাঞ্জাবি", slug: "panjabi", sku: "PNJ-1", status: "ACTIVE", priceMinor: 150000n, compareAtMinor: null, currency: "BDT", categoryId: "cat-9", brandId: null, digitalStorageKey: "r2/prod-1/file.pdf", source: "manual", createdAt: D("2026-02-01"), updatedAt: D("2026-02-02") },
      { id: "prod-2", organizationId: "org-a", name: "শাড়ি", slug: "saree", sku: null, status: "ACTIVE", priceMinor: 320000n, currency: "BDT", source: "manual", createdAt: D("2026-02-03"), updatedAt: D("2026-02-03") },
    ],
    customer: [
      { id: "cust-1", organizationId: "org-a", firstName: "Rahim", lastName: "Uddin", phone: "01710000001", email: "rahim@example.com", referralCode: "REF-1", groupId: "grp-1", loyaltyBalanceCache: 250, creditTermsDays: 0, createdAt: D("2026-03-01"), updatedAt: D("2026-03-01") },
      { id: "cust-2", organizationId: "org-a", firstName: "Karim", phone: "01710000002", mergedIntoId: "cust-1", creditTermsDays: 0, createdAt: D("2026-03-02"), updatedAt: D("2026-03-02") },
    ],
    order: [
      { id: "ord-1", organizationId: "org-a", customerId: "cust-1", storeId: "store-1", assigneeId: "user-9", externalId: "WC-1001", source: "woocommerce", status: "completed", invoiceNumber: "INV-2026-1", subtotalMinor: 150000n, shippingMinor: 0n, discountMinor: 0n, taxMinor: 0n, totalMinor: 150000n, refundedMinor: 0n, commissionMinor: 0n, currency: "BDT", isCod: true, createdAt: D("2026-04-01"), updatedAt: D("2026-04-01") },
      { id: "ord-2", organizationId: "org-a", customerId: "cust-2", referrerCustomerId: "cust-1", splitFromId: "ord-1", externalId: "WC-1002", source: "woocommerce", status: "processing", subtotalMinor: 320000n, shippingMinor: 0n, discountMinor: 0n, taxMinor: 0n, totalMinor: 320000n, refundedMinor: 0n, commissionMinor: 0n, currency: "BDT", isCod: false, createdAt: D("2026-04-02"), updatedAt: D("2026-04-02") },
    ],
    orderItem: [
      { id: "item-1", orderId: "ord-1", productId: "prod-1", name: "পাঞ্জাবি", quantity: 1, priceMinor: 150000n, totalMinor: 150000n },
      { id: "item-2", orderId: "ord-2", productId: "prod-2", name: "শাড়ি", quantity: 1, priceMinor: 320000n, totalMinor: 320000n },
      { id: "item-3", orderId: "ord-2", productId: null, name: "অন্য পণ্য", quantity: 2, priceMinor: 0n, totalMinor: 0n },
    ],
    lead: [
      { id: "lead-1", organizationId: "org-a", customerId: "cust-1", ownerUserId: "user-7", name: "সম্ভাব্য ক্রেতা", phone: "01710000009", stage: "new", source: "manual", valueMinor: 5000n, currency: "BDT", tags: [], createdAt: D("2026-05-01"), updatedAt: D("2026-05-01") },
    ],
    integration: [
      { id: "int-1", organizationId: "org-a", provider: "meta", status: "CONNECTED", externalAccountId: "act_123", lastSyncAt: D("2026-06-01"), createdAt: D("2026-01-05"), updatedAt: D("2026-06-01"), credentialBlob: "builder-must-drop-this" },
    ],
    subscription: [
      { id: "sub-a", organizationId: "org-a", plan: "GROWTH", status: "ACTIVE", createdAt: D("2026-01-01"), updatedAt: D("2026-01-01") },
      { id: "sub-b", organizationId: "org-b", plan: "FREE", status: "TRIALING", createdAt: D("2026-10-01"), updatedAt: D("2026-10-01") },
    ],
    saasPayment: [
      { id: "pay-1", organizationId: "org-a", amountMinor: 5000n, refundedMinor: 0n, currency: "BDT", method: "bkash", recordedById: "user-admin", createdAt: D("2026-06-15") },
    ],
    channelConversation: [
      { id: "conv-1", organizationId: "org-a", channel: "whatsapp", externalContactId: "8801710000001", status: "open", createdAt: D("2026-07-01"), updatedAt: D("2026-07-01") },
    ],
    campaignPlan: [
      { id: "plan-1", organizationId: "org-a", adAccountId: "adacc-1", name: "Eid Campaign", objective: "OUTCOME_SALES", status: "draft", createdById: "user-owner-a", createdAt: D("2026-07-02"), updatedAt: D("2026-07-02") },
    ],
    supportTicket: [
      { id: "tick-1", organizationId: "org-a", createdById: "user-owner-a", subject: "সাহায্য দরকার", status: "open", createdAt: D("2026-07-03"), updatedAt: D("2026-07-03") },
    ],
    mediaAsset: [
      { id: "asset-1", organizationId: "org-a", kind: "image", name: "hero.jpg", contentType: "image/jpeg", sizeBytes: 12345, storageKey: "org-a/hero.jpg", origin: "upload", createdById: "user-owner-a", createdAt: D("2026-07-04"), updatedAt: D("2026-07-04") },
    ],
  };
}

async function buildBundleJson(db: any): Promise<string> {
  const bundle = await buildOrgDataBundle(db, "org-a", { exportedBy: "owner-a@example.com" });
  return JSON.stringify({ manifest: bundle.manifest, data: bundle.data });
}

function rowsOf(db: any, tableName: string, orgId: string) {
  return db[tableName].rows.filter((r: any) => r.organizationId === orgId);
}

describe("ORG16 bundle import — round-trip through the real export builder", () => {
  it("restores products/orders/customers into a fresh org with remapped ids and intact relationships", async () => {
    const db = makeDb(seedOrgA());
    const audit = makeAudit();
    const svc = new DataImportsService(db as any, audit as any);
    let refreshCalls = 0;
    svc.searchVectorRefresher = async () => { refreshCalls++; return 2; };

    const bundleJson = await buildBundleJson(db);

    // ---- validate: full report, and NOTHING is written ----
    const countsBefore = Object.fromEntries(TABLE_NAMES.map((n) => [n, db[n].rows.length]));
    const report = await svc.validateImport("org-b", bundleJson);
    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.source?.organizationName).toBe("Dhaka Fashion");
    expect(report.totalImportRows).toBe(11); // profile 1 + customers 2 + products 2 + leads 1 + orders 2 + items 3
    expect(report.strippedSensitiveFields).toEqual(
      expect.arrayContaining(["businessProfile.metaCapiToken", "businessProfile.customDomain"]),
    );
    const byTable = Object.fromEntries(report.tables.map((t: any) => [t.table, t]));
    expect(report.tables).toHaveLength(15);
    expect(byTable.members).toMatchObject({ action: "skip", reason: "people_not_restored" });
    expect(byTable.subscription).toMatchObject({ action: "skip", reason: "billing_state_not_transferred" });
    expect(byTable.payments).toMatchObject({ action: "skip", reason: "billing_ledger_not_transferred" });
    expect(byTable.integrations).toMatchObject({ action: "skip", reason: "connections_not_restored" });
    expect(byTable.conversations).toMatchObject({ action: "skip", reason: "transcripts_not_in_bundle" });
    expect(byTable.mediaAssets).toMatchObject({ action: "skip", reason: "bytes_not_in_bundle" });
    expect(byTable.products).toMatchObject({ action: "import", rows: 2 });
    expect(report.nulledReferenceCounts).toMatchObject({
      "products.categoryId": 1, "products.digitalStorageKey": 1,
      "customers.groupId": 1, "customers.loyaltyBalanceCache": 1,
      "orders.storeId": 1, "orders.assigneeId": 1, "leads.ownerUserId": 1,
    });
    expect(report.targetEmpty).toBe(true);
    // validate wrote nothing: no rows anywhere, no job, no audit.
    expect(Object.fromEntries(TABLE_NAMES.map((n) => [n, db[n].rows.length]))).toEqual(countsBefore);
    expect(db.dataImport.rows).toHaveLength(0);
    expect(audit.logs).toHaveLength(0);

    // ---- import ----
    const job = await svc.createImport("org-b", "user-owner-b", "qosprey-data-export.json", bundleJson);
    expect(job.status).toBe("completed");
    expect(job.sourceOrgName).toBe("Dhaka Fashion");
    expect(refreshCalls).toBe(1);
    expect(job.report.searchVectorRefreshed).toBe(true);

    // Products: new ids, money back as BigInt, outside refs nulled.
    const products = rowsOf(db, "product", "org-b");
    expect(products).toHaveLength(2);
    const panjabi = products.find((r: any) => r.sku === "PNJ-1");
    expect(panjabi).toBeTruthy();
    expect(panjabi.id).not.toBe("prod-1");
    expect(panjabi.name).toBe("পাঞ্জাবি");
    expect(panjabi.priceMinor).toBe(150000n);
    expect(panjabi.categoryId).toBeNull();
    expect(panjabi.digitalStorageKey).toBeNull();

    // Customers: referral preserved, group nulled, loyalty cache
    // reset (the ledger is NOT in the bundle), merge remapped.
    const customers = rowsOf(db, "customer", "org-b");
    expect(customers).toHaveLength(2);
    const rahim = customers.find((r: any) => r.referralCode === "REF-1");
    expect(rahim.groupId).toBeNull();
    expect(rahim.loyaltyBalanceCache).toBe(0);
    const karim = customers.find((r: any) => r.phone === "01710000002");
    expect(karim.mergedIntoId).toBe(rahim.id);

    // Orders: customer links + self-links remapped, people/store
    // scalars nulled, invoice + totals intact.
    const orders = rowsOf(db, "order", "org-b");
    expect(orders).toHaveLength(2);
    const wc1001 = orders.find((r: any) => r.externalId === "WC-1001");
    const wc1002 = orders.find((r: any) => r.externalId === "WC-1002");
    expect(wc1001.customerId).toBe(rahim.id);
    expect(wc1001.storeId).toBeNull();
    expect(wc1001.assigneeId).toBeNull();
    expect(wc1001.totalMinor).toBe(150000n);
    expect(wc1001.invoiceNumber).toBe("INV-2026-1");
    expect(wc1002.customerId).toBe(karim.id);
    expect(wc1002.referrerCustomerId).toBe(rahim.id);
    expect(wc1002.splitFromId).toBe(wc1001.id);

    // Order items: chained through the NEW order/product ids.
    const items = db.orderItem.rows.filter((r: any) => [wc1001.id, wc1002.id].includes(r.orderId));
    expect(items).toHaveLength(3);
    const panjabiItem = items.find((r: any) => r.name === "পাঞ্জাবি");
    expect(panjabiItem.orderId).toBe(wc1001.id);
    expect(panjabiItem.productId).toBe(panjabi.id);
    expect(panjabiItem.priceMinor).toBe(150000n);

    // Leads: customer remapped, owner (a person) nulled.
    const leads = rowsOf(db, "lead", "org-b");
    expect(leads).toHaveLength(1);
    expect(leads[0].customerId).toBe(rahim.id);
    expect(leads[0].ownerUserId).toBeNull();
    expect(leads[0].valueMinor).toBe(5000n);

    // Profile: updated in place on B's own row; the secret and
    // the deprecated domain field never arrive.
    const profB = db.businessProfile.rows.find((r: any) => r.organizationId === "org-b");
    expect(profB.id).toBe("prof-b");
    expect(profB.description).toBe("ঢাকার ফ্যাশন হাউস");
    expect(profB.bkashNumber).toBe("01711000000");
    expect(profB.monthlyBudgetMinor).toBe(500000n);
    expect(profB.metaCapiToken ?? null).toBeNull();
    expect(profB.customDomain ?? null).toBeNull();

    // Skipped tables: B gained nothing; B's own subscription is
    // untouched (still FREE/TRIALING), A is untouched too.
    expect(rowsOf(db, "membership", "org-b")).toHaveLength(0);
    expect(rowsOf(db, "saasPayment", "org-b")).toHaveLength(0);
    expect(rowsOf(db, "integration", "org-b")).toHaveLength(0);
    expect(rowsOf(db, "channelConversation", "org-b")).toHaveLength(0);
    expect(rowsOf(db, "campaignPlan", "org-b")).toHaveLength(0);
    expect(rowsOf(db, "supportTicket", "org-b")).toHaveLength(0);
    expect(rowsOf(db, "mediaAsset", "org-b")).toHaveLength(0);
    const subB = db.subscription.rows.find((r: any) => r.organizationId === "org-b");
    expect(subB).toMatchObject({ id: "sub-b", plan: "FREE", status: "TRIALING" });
    expect(rowsOf(db, "product", "org-a")).toHaveLength(2);

    // Audit: exactly one org.data_imported, brief-shaped metadata.
    expect(audit.logs).toHaveLength(1);
    expect(audit.logs[0]).toMatchObject({
      organizationId: "org-b",
      action: "org.data_imported",
      entityType: "DataImport",
      entityId: job.id,
    });
    expect(audit.logs[0].metadata).toMatchObject({ jobId: job.id, rows: 11 });
    expect(audit.logs[0].metadata.tables).toMatchObject({ products: 2, orders: 2, customers: 2, orderItems: 3 });

    // Job read: own org sees it, the source org does not.
    await expect(svc.getImport("org-b", job.id)).resolves.toMatchObject({ id: job.id, status: "completed" });
    await expect(svc.getImport("org-a", job.id)).rejects.toMatchObject({ code: "dataTools.importNotFound" });

    // The org is no longer empty: a second restore is refused
    // BEFORE any job row is created.
    await expect(svc.createImport("org-b", "user-owner-b", "again.json", bundleJson))
      .rejects.toMatchObject({ code: "dataTools.targetOrganizationIsNotEmptyBundle" });
    expect(db.dataImport.rows).toHaveLength(1);
    const report2 = await svc.validateImport("org-b", bundleJson);
    expect(report2.valid).toBe(false);
    expect(report2.errors).toContain("target_org_not_empty");
    expect(report2.targetCounts).toMatchObject({ products: 2, orders: 2, customers: 2, leads: 1 });
  });

  it("a transaction failure marks the job failed and leaves the target org exactly as empty", async () => {
    const db = makeDb(seedOrgA());
    const audit = makeAudit();
    const svc = new DataImportsService(db as any, audit as any);
    svc.searchVectorRefresher = async () => 0;
    const bundleJson = await buildBundleJson(db);
    const realCreateMany = db.order.createMany;
    db.order.createMany = async () => { throw new Error("simulated write failure"); };
    const job = await svc.createImport("org-b", "user-owner-b", "x.json", bundleJson);
    db.order.createMany = realCreateMany;
    expect(job.status).toBe("failed");
    expect(job.error).toContain("simulated write failure");
    // Rollback: the profile update + customers + products that
    // ran BEFORE the failing orders write are gone too.
    expect(rowsOf(db, "product", "org-b")).toHaveLength(0);
    expect(rowsOf(db, "customer", "org-b")).toHaveLength(0);
    const profB = db.businessProfile.rows.find((r: any) => r.organizationId === "org-b");
    expect(profB.description).toBeNull();
    expect(audit.logs).toHaveLength(0);
  });
});

describe("ORG16 bundle validation — rejections", () => {
  async function validBundleObject(db: any) {
    const json = await buildBundleJson(db);
    return JSON.parse(json);
  }

  it("rejects non-JSON and foreign shapes before anything else", async () => {
    const db = makeDb(seedOrgA());
    const svc = new DataImportsService(db as any, makeAudit() as any);
    const report = await svc.validateImport("org-b", "this is not json");
    expect(report.valid).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
    await expect(svc.createImport("org-b", "u", "x.json", "not json")).rejects.toMatchObject({ code: "dataTools.bundlejsonIsNotValidJson" });
    expect(checkBundle({ hello: 1 }).ok).toBe(false);
    expect(checkBundle(null).ok).toBe(false);
    expect(checkBundle([1, 2, 3]).ok).toBe(false);
  });

  it("rejects a bundle with an unknown table or a row-count lie", async () => {
    const db = makeDb(seedOrgA());
    const bundle = await validBundleObject(db);
    bundle.data.evilTable = [];
    bundle.manifest.tables.evilTable = { rows: 0, truncated: false };
    const check = checkBundle(bundle);
    expect(check.ok).toBe(false);

    const bundle2 = await validBundleObject(db);
    bundle2.manifest.tables.products.rows = 99;
    const check2 = checkBundle(bundle2);
    expect(check2.ok).toBe(false);
    if (!check2.ok) expect(check2.errors).toContain("row_count_mismatch:products");
  });

  it("rejects a truncated source (incomplete export) honestly", async () => {
    const db = makeDb(seedOrgA());
    const bundle = await validBundleObject(db);
    bundle.manifest.tables.orders.truncated = true;
    const check = checkBundle(bundle);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.errors).toContain("source_table_truncated:orders");
  });

  it("rejects credential material outside its one legitimate position", async () => {
    const db = makeDb(seedOrgA());
    // A token smuggled into a product row.
    const b1 = await validBundleObject(db);
    b1.data.products[0].accessToken = "leaked";
    const c1 = checkBundle(b1);
    expect(c1.ok).toBe(false);
    if (!c1.ok) expect(c1.errors).toContain("credential_field_present:products.accessToken");
    // An extra key on an integrations row breaks the exported shape.
    const b2 = await validBundleObject(db);
    b2.data.integrations[0].refreshToken = "leaked";
    expect(checkBundle(b2).ok).toBe(false);
    // A credential table added beside the known ones.
    const b3 = await validBundleObject(db);
    b3.data.integrationCredentials = [{ id: "x", secret: "y" }];
    expect(checkBundle(b3).ok).toBe(false);
    // And the legitimate position does NOT reject the bundle —
    // it is stripped (proven in the round-trip spec above).
    const b4 = await validBundleObject(db);
    expect(b4.data.businessProfile.metaCapiToken).toBe("SECRET-CAPI-TOKEN");
    expect(checkBundle(b4).ok).toBe(true);
  });

  it("rejects duplicates the target schema would refuse, and dangling references", async () => {
    const db = makeDb(seedOrgA());
    const b1 = await validBundleObject(db);
    b1.data.products[1].sku = "PNJ-1";
    const c1 = checkBundle(b1);
    expect(c1.ok).toBe(false);
    if (!c1.ok) expect(c1.errors).toContain("duplicate_product_sku");

    const b2 = await validBundleObject(db);
    b2.data.orderItems[0].productId = "prod-missing";
    const c2 = checkBundle(b2);
    expect(c2.ok).toBe(false);
    if (!c2.ok) expect(c2.errors).toContain("dangling_reference:orderItems.productId");

    const b3 = await validBundleObject(db);
    b3.data.orders[1].externalId = "WC-1001"; // same (source, externalId) pair
    const c3 = checkBundle(b3);
    expect(c3.ok).toBe(false);
    if (!c3.ok) expect(c3.errors).toContain("duplicate_order_source_external_id");
  });

  it("refuses a non-empty target on validate AND create, before any job exists", async () => {
    const seed = seedOrgA();
    seed.product.push({ id: "prod-b1", organizationId: "org-b", name: "আগের পণ্য", status: "ACTIVE", priceMinor: 100n, currency: "BDT", source: "manual", createdAt: D("2026-10-02"), updatedAt: D("2026-10-02") } as any);
    const db = makeDb(seed);
    const svc = new DataImportsService(db as any, makeAudit() as any);
    const bundleJson = await buildBundleJson(db);
    const report = await svc.validateImport("org-b", bundleJson);
    expect(report.valid).toBe(false);
    expect(report.targetEmpty).toBe(false);
    expect(report.errors).toContain("target_org_not_empty");
    await expect(svc.createImport("org-b", "u", "x.json", bundleJson)).rejects.toMatchObject({ code: "dataTools.targetOrganizationIsNotEmptyBundle" });
    expect(db.dataImport.rows).toHaveLength(0);
  });

  it("treats a filled business profile as a non-empty org", async () => {
    const seed = seedOrgA();
    (seed.businessProfile[1] as any).description = "ইতিমধ্যে সাজানো দোকান";
    const db = makeDb(seed);
    const svc = new DataImportsService(db as any, makeAudit() as any);
    const emptiness = await svc.targetEmptiness("org-b");
    expect(emptiness.profileFilled).toBe(true);
    expect(emptiness.empty).toBe(false);
  });
});

describe("ORG16 route wiring — OWNER-only", () => {
  it("the three data-imports routes exist on the data-tools controller with OWNER as the only role", () => {
    expect(Reflect.getMetadata(PATH_METADATA, DataExportsController)).toBe("organizations/:organizationId");
    const proto = DataExportsController.prototype as any;
    for (const [method, path] of [
      ["validateImport", "data-imports/validate"],
      ["createImport", "data-imports"],
      ["getImport", "data-imports/:importId"],
    ] as const) {
      expect(Reflect.getMetadata(PATH_METADATA, proto[method])).toBe(path);
      expect(Reflect.getMetadata(ROLES_KEY, proto[method])).toEqual(["OWNER"]);
    }
    const guards = Reflect.getMetadata(GUARDS_METADATA, DataExportsController) ?? [];
    expect(guards).toEqual(expect.arrayContaining([TenantGuard, RolesGuard]));
    // The export routes keep their wider OWNER/ADMIN gate.
    expect(Reflect.getMetadata(ROLES_KEY, proto.create)).toEqual(["OWNER", "ADMIN"]);
  });

  it("RolesGuard refuses an ADMIN (and any non-owner) on the import handlers, admits the OWNER", () => {
    const guard = new RolesGuard(new Reflector());
    const ctxFor = (handler: any, role: string) => ({
      getHandler: () => handler,
      getClass: () => DataExportsController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId: "u-1" }, membership: { role } }),
      }),
    }) as any;
    const proto = DataExportsController.prototype as any;
    expect(() => guard.canActivate(ctxFor(proto.createImport, "ADMIN"))).toThrow(expect.objectContaining({ code: "common.insufficientRole" }));
    expect(() => guard.canActivate(ctxFor(proto.validateImport, "ANALYST"))).toThrow(expect.objectContaining({ code: "common.insufficientRole" }));
    expect(guard.canActivate(ctxFor(proto.createImport, "OWNER"))).toBe(true);
    expect(guard.canActivate(ctxFor(proto.getImport, "OWNER"))).toBe(true);
  });

  it("the archived-owner allowlist covers data-imports like data-exports", async () => {
    const { isArchivedOwnerPath } = await import("../common/tenant.guard");
    expect(isArchivedOwnerPath("/organizations/org-9/data-imports", "POST", "org-9")).toBe(true);
    expect(isArchivedOwnerPath("/organizations/org-9/data-imports/validate", "POST", "org-9")).toBe(true);
    expect(isArchivedOwnerPath("/organizations/org-9/data-imports/job-1", "GET", "org-9")).toBe(true);
    expect(isArchivedOwnerPath("/organizations/org-9/products", "GET", "org-9")).toBe(false);
  });
});
