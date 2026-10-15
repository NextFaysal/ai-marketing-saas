process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "unit";

import { ConnectionUsageService } from "./connection-usage.service";
import { ProviderHealthService } from "./provider-health.service";
import { encryptJson } from "../integrations/crypto";

/**
 * CC30(b)/(c) — usage insights + deliverability. Pinned rules:
 * - every count comes from REAL rows in the window; the
 *   unattributable is reported as null / bucketed, NEVER split
 *   by guessing (unbound conversations, legacy courier rows);
 * - cost exists ONLY as org-rate × attributed sent count;
 * - verified volume counts ONLY verified_paid + live rows;
 * - deliverability reads STORED state only: MS4 persists no
 *   SPF/DKIM result, so both read "not_recorded" (no selector ⇒
 *   DKIM "not_checked"); Meta business verification comes from
 *   the CC15 snapshot's `business` entry, fetched by CC30 from
 *   the account's OWN Graph node — absent answer ⇒ absent key.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-14T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY);

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
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {}))[0] ?? null,
    findMany: async ({ where, take }: any = {}) => {
      const out = rows.filter((r) => matches(r, where ?? {}));
      return take ? out.slice(0, take) : out;
    },
    findUnique: async ({ where }: any) => rows.filter((r) => matches(r, where ?? {}))[0] ?? null,
    create: async ({ data }: any) => { const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (row) Object.assign(row, data);
      return row;
    },
  };
}

function usageTables() {
  return {
    integration: makeTable("int"), messagingSenderConfig: makeTable("sender"),
    channelConversation: makeTable("conv"), channelMessage: makeTable("msg"),
    socialPost: makeTable("post"), order: makeTable("order"),
    courierShipment: makeTable("ship"), tenantPaymentTransaction: makeTable("txn"),
    socialAccount: makeTable("soc"), adAccount: makeTable("ad"),
  } as any;
}

function buildUsage(tables: any, accounts: any[]) {
  const connections: any = {
    getOverview: async () => ({ categories: [{ key: "all", accounts }] }),
  };
  return new ConnectionUsageService(tables as any, connections);
}

const acct = (id: string, source: string, category: string, provider: string, displayName = id) =>
  ({ id, source, category, provider, displayName });

describe("CC30 usage — messaging attribution + org-rate cost", () => {
  function seed(tables: any, withRate: boolean) {
    tables.integration.rows.push({ id: "int-wa", organizationId: "org-1", provider: "whatsapp", storeId: null });
    if (withRate) {
      tables.messagingSenderConfig.rows.push({ id: "sc-1", organizationId: "org-1", whatsappCostPerMessageMinor: 50, emailCostPerMessageMinor: null, fromAddress: null, dkimSelector: null });
    }
    tables.channelConversation.rows.push(
      { id: "c-1", organizationId: "org-1", integrationId: "int-wa", channel: "whatsapp", isPractice: false },
      { id: "c-2", organizationId: "org-1", integrationId: "int-wa", channel: "whatsapp", isPractice: false },
    );
    tables.channelMessage.rows.push(
      { id: "m-1", conversationId: "c-1", direction: "in", createdAt: daysAgo(2) },
      { id: "m-2", conversationId: "c-1", direction: "in", createdAt: daysAgo(3) },
      { id: "m-3", conversationId: "c-2", direction: "in", createdAt: daysAgo(1) },
      { id: "m-4", conversationId: "c-1", direction: "out", createdAt: daysAgo(2) },
      { id: "m-5", conversationId: "c-2", direction: "out", createdAt: daysAgo(2) },
      { id: "m-6", conversationId: "c-2", direction: "out", createdAt: daysAgo(4) },
      { id: "m-7", conversationId: "c-2", direction: "out", createdAt: daysAgo(5) },
      { id: "m-8", conversationId: "c-2", direction: "out", createdAt: daysAgo(6) },
      // Outside the 30-day window — never counted.
      { id: "m-9", conversationId: "c-1", direction: "out", createdAt: daysAgo(45) },
    );
  }

  it("counts bound conversations only, splits direction, cost = sent × the org's own rate", async () => {
    const tables = usageTables();
    seed(tables, true);
    const svc = buildUsage(tables, [acct("int-wa", "integration", "messaging", "whatsapp")]);
    const res: any = await svc.getUsage("org-1", 30, NOW);
    const entry = res.accounts.find((a: any) => a.targetId === "int-wa");
    expect(entry.metrics).toEqual({ messagesReceived: 3, messagesSent: 5 });
    expect(entry.attribution).toBe("integration");
    expect(entry.costRateMinor).toBe(50);
    expect(entry.estimatedCostMinor).toBe("250");
    expect(res.unattributed).toEqual([]);
  });

  it("no org rate ⇒ cost is null, counts unchanged (never an invented price)", async () => {
    const tables = usageTables();
    seed(tables, false);
    const svc = buildUsage(tables, [acct("int-wa", "integration", "messaging", "whatsapp")]);
    const res: any = await svc.getUsage("org-1", 30, NOW);
    const entry = res.accounts.find((a: any) => a.targetId === "int-wa");
    expect(entry.metrics).toEqual({ messagesReceived: 3, messagesSent: 5 });
    expect(entry.estimatedCostMinor).toBeNull();
    expect(entry.costRateMinor).toBeNull();
  });

  it("an invalid days value falls back to 30; days=7 narrows the window", async () => {
    const tables = usageTables();
    seed(tables, false);
    const svc = buildUsage(tables, [acct("int-wa", "integration", "messaging", "whatsapp")]);
    const res45: any = await svc.getUsage("org-1", 45, NOW);
    expect(res45.days).toBe(30);
    const res7: any = await svc.getUsage("org-1", 7, NOW);
    expect(res7.days).toBe(7);
    // m-9 (45d) still out; all seeded in-window messages are ≤6d.
    expect(res7.accounts.find((a: any) => a.targetId === "int-wa").metrics).toEqual({ messagesReceived: 3, messagesSent: 5 });
  });
});

describe("CC30 usage — the unattributable stays unattributed", () => {
  it("an integration with NO bound conversations while unbound ones exist on its channel ⇒ null + unavailable; the pool is bucketed once, practice excluded", async () => {
    const tables = usageTables();
    tables.integration.rows.push({ id: "int-msgr", organizationId: "org-1", provider: "messenger", storeId: null });
    tables.channelConversation.rows.push(
      { id: "c-u1", organizationId: "org-1", integrationId: null, channel: "messenger", isPractice: false },
      { id: "c-u2", organizationId: "org-1", integrationId: null, channel: "messenger", isPractice: true },
    );
    tables.channelMessage.rows.push(
      { id: "m-1", conversationId: "c-u1", direction: "in", createdAt: daysAgo(1) },
      { id: "m-2", conversationId: "c-u1", direction: "out", createdAt: daysAgo(1) },
      { id: "m-3", conversationId: "c-u1", direction: "out", createdAt: daysAgo(2) },
      { id: "m-4", conversationId: "c-u2", direction: "out", createdAt: daysAgo(1) },
    );
    const svc = buildUsage(tables, [acct("int-msgr", "integration", "messaging", "messenger")]);
    const res: any = await svc.getUsage("org-1", 30, NOW);
    const entry = res.accounts.find((a: any) => a.targetId === "int-msgr");
    expect(entry.metrics).toEqual({ messagesReceived: null, messagesSent: null });
    expect(entry.attribution).toBe("unavailable");
    expect(entry.estimatedCostMinor).toBeNull();
    expect(res.unattributed).toEqual([{ kind: "messaging", channel: "messenger", messagesReceived: 1, messagesSent: 2 }]);
  });

  it("legacy courier shipments (integrationId NULL) form a per-provider bucket, never assigned to an account", async () => {
    const tables = usageTables();
    tables.integration.rows.push({ id: "int-sf", organizationId: "org-1", provider: "steadfast", storeId: null });
    tables.courierShipment.rows.push(
      { id: "s-1", organizationId: "org-1", integrationId: "int-sf", provider: "steadfast", createdAt: daysAgo(2) },
      { id: "s-2", organizationId: "org-1", integrationId: "int-sf", provider: "steadfast", createdAt: daysAgo(3) },
      { id: "s-3", organizationId: "org-1", integrationId: null, provider: "steadfast", createdAt: daysAgo(2) },
      { id: "s-4", organizationId: "org-1", integrationId: null, provider: "steadfast", createdAt: daysAgo(2) },
      { id: "s-5", organizationId: "org-1", integrationId: null, provider: "steadfast", createdAt: daysAgo(2) },
      { id: "s-6", organizationId: "org-1", integrationId: null, provider: "pathao", createdAt: daysAgo(2) },
    );
    const svc = buildUsage(tables, [acct("int-sf", "integration", "courier", "steadfast")]);
    const res: any = await svc.getUsage("org-1", 30, NOW);
    expect(res.accounts.find((a: any) => a.targetId === "int-sf").metrics).toEqual({ shipmentsBooked: 2 });
    expect(res.unattributed).toEqual(expect.arrayContaining([
      { kind: "courier", provider: "steadfast", shipmentsBooked: 3 },
      { kind: "courier", provider: "pathao", shipmentsBooked: 1 },
    ]));
  });
});

describe("CC30 usage — social, stores, gateways", () => {
  it("social posts: only status=published with publishedAt in the window", async () => {
    const tables = usageTables();
    tables.socialPost.rows.push(
      { id: "p-1", organizationId: "org-1", socialAccountId: "soc-1", status: "published", publishedAt: daysAgo(2) },
      { id: "p-2", organizationId: "org-1", socialAccountId: "soc-1", status: "published", publishedAt: daysAgo(9) },
      { id: "p-3", organizationId: "org-1", socialAccountId: "soc-1", status: "published", publishedAt: daysAgo(40) },
      { id: "p-4", organizationId: "org-1", socialAccountId: "soc-1", status: "draft", publishedAt: null },
      { id: "p-5", organizationId: "org-1", socialAccountId: "soc-2", status: "published", publishedAt: daysAgo(1) },
    );
    const svc = buildUsage(tables, [acct("soc-1", "social_account", "social", "meta_page")]);
    const res: any = await svc.getUsage("org-1", 30, NOW);
    expect(res.accounts.find((a: any) => a.targetId === "soc-1").metrics).toEqual({ postsPublished: 2 });
  });

  it("store orders ride the store linkage (storeId + source); a store-less integration is unavailable", async () => {
    const tables = usageTables();
    tables.integration.rows.push(
      { id: "int-woo", organizationId: "org-1", provider: "woocommerce", storeId: "store-1" },
      { id: "int-woo2", organizationId: "org-1", provider: "woocommerce", storeId: null },
    );
    tables.order.rows.push(
      { id: "o-1", organizationId: "org-1", storeId: "store-1", source: "woocommerce", createdAt: daysAgo(1) },
      { id: "o-2", organizationId: "org-1", storeId: "store-1", source: "woocommerce", createdAt: daysAgo(2) },
      { id: "o-3", organizationId: "org-1", storeId: "store-1", source: "woocommerce", createdAt: daysAgo(3) },
      { id: "o-4", organizationId: "org-1", storeId: "store-1", source: "shopify", createdAt: daysAgo(1) },
      { id: "o-5", organizationId: "org-1", storeId: "store-2", source: "woocommerce", createdAt: daysAgo(1) },
      { id: "o-6", organizationId: "org-1", storeId: "store-1", source: "woocommerce", createdAt: daysAgo(60) },
    );
    const svc = buildUsage(tables, [
      acct("int-woo", "integration", "commerce", "woocommerce"),
      acct("int-woo2", "integration", "commerce", "woocommerce"),
    ]);
    const res: any = await svc.getUsage("org-1", 30, NOW);
    const e1 = res.accounts.find((a: any) => a.targetId === "int-woo");
    expect(e1.metrics).toEqual({ ordersInWindow: 3 });
    expect(e1.attribution).toBe("store");
    const e2 = res.accounts.find((a: any) => a.targetId === "int-woo2");
    expect(e2.metrics).toEqual({ ordersInWindow: null });
    expect(e2.attribution).toBe("unavailable");
  });

  it("gateways: ONLY verified_paid + live rows count toward volume; platform groups by provider", async () => {
    const tables = usageTables();
    tables.tenantPaymentTransaction.rows.push(
      { id: "t-1", organizationId: "org-1", gatewayId: "gw-1", source: "own", provider: "sslcommerz", status: "verified_paid", environment: "live", amountMinor: 10000n, currency: "BDT", createdAt: daysAgo(1) },
      { id: "t-2", organizationId: "org-1", gatewayId: "gw-1", source: "own", provider: "sslcommerz", status: "verified_paid", environment: "live", amountMinor: 25050n, currency: "BDT", createdAt: daysAgo(2) },
      { id: "t-3", organizationId: "org-1", gatewayId: "gw-1", source: "own", provider: "sslcommerz", status: "initiated", environment: "live", amountMinor: 99900n, currency: "BDT", createdAt: daysAgo(1) },
      { id: "t-4", organizationId: "org-1", gatewayId: "gw-1", source: "own", provider: "sslcommerz", status: "verified_paid", environment: "sandbox", amountMinor: 77700n, currency: "BDT", createdAt: daysAgo(1) },
      { id: "t-5", organizationId: "org-1", gatewayId: null, source: "platform", provider: "bkash", status: "verified_paid", environment: "live", amountMinor: 5000n, currency: "BDT", createdAt: daysAgo(1) },
    );
    const svc = buildUsage(tables, [
      acct("gw-1", "tenant_payment_gateway", "payment", "sslcommerz"),
      acct("en-1", "platform_payment_enablement", "payment", "bkash"),
    ]);
    const res: any = await svc.getUsage("org-1", 30, NOW);
    const own = res.accounts.find((a: any) => a.targetId === "gw-1");
    expect(own.metrics).toEqual({ verifiedPayments: 2, verifiedVolumeMinor: "35050", currency: "BDT" });
    const platform = res.accounts.find((a: any) => a.targetId === "en-1");
    expect(platform.metrics).toEqual({ verifiedPayments: 1, verifiedVolumeMinor: "5000", currency: "BDT" });
    expect(platform.attribution).toBe("platform");
  });
});

describe("CC30 deliverability — stored state only", () => {
  it("no sender config ⇒ not configured; SPF not_recorded; DKIM not_checked (MS4's own word)", async () => {
    const tables = usageTables();
    const svc = buildUsage(tables, []);
    const res: any = await svc.getDeliverability("org-1");
    expect(res.email).toMatchObject({ configured: false, domain: null, source: "none", dkimSelectorSet: false });
    expect(res.email.spf.status).toBe("not_recorded");
    expect(res.email.dkim.status).toBe("not_checked");
    expect(res.metaBusiness).toEqual([]);
  });

  it("a tenant From domain + selector are reported as stored; SPF/DKIM stay not_recorded (nothing is persisted by MS4)", async () => {
    const tables = usageTables();
    tables.messagingSenderConfig.rows.push({ id: "sc-1", organizationId: "org-1", fromAddress: "Shop@Example.com", dkimSelector: "s1" });
    const svc = buildUsage(tables, []);
    const res: any = await svc.getDeliverability("org-1");
    expect(res.email).toMatchObject({ configured: true, domain: "example.com", source: "tenant", dkimSelectorSet: true });
    expect(res.email.spf.status).toBe("not_recorded");
    expect(res.email.dkim.status).toBe("not_recorded");
  });

  it("meta business entries come from stored snapshots; no business in the snapshot ⇒ status null; no snapshot ⇒ no entry", async () => {
    const tables = usageTables();
    tables.socialAccount.rows.push(
      { id: "soc-1", organizationId: "org-1", platform: "meta_page", name: "Page One", label: null, providerHealth: { kind: "meta_page", business: { id: "biz-1", verificationStatus: "verified" } }, providerHealthAt: daysAgo(1) },
      { id: "soc-2", organizationId: "org-1", platform: "meta_page", name: "Page Two", label: null, providerHealth: { kind: "meta_page" }, providerHealthAt: daysAgo(1) },
      { id: "soc-3", organizationId: "org-1", platform: "meta_page", name: "Page Three", label: null, providerHealth: null, providerHealthAt: null },
    );
    const svc = buildUsage(tables, []);
    const res: any = await svc.getDeliverability("org-1");
    expect(res.metaBusiness).toHaveLength(2);
    expect(res.metaBusiness.find((b: any) => b.targetId === "soc-1")).toMatchObject({ businessId: "biz-1", verificationStatus: "verified" });
    expect(res.metaBusiness.find((b: any) => b.targetId === "soc-2")).toMatchObject({ businessId: null, verificationStatus: null });
  });
});

describe("CC30 — Meta business verification fetch (ProviderHealthService)", () => {
  function healthTables() {
    return {
      integration: makeTable("int"), integrationCredential: makeTable("cred"),
      socialAccount: makeTable("soc"), adAccount: makeTable("ad"),
    } as any;
  }
  const audit = { log: async () => undefined } as any;

  async function seedPage(tables: any) {
    const integration = await tables.integration.create({
      data: { organizationId: "org-1", provider: "meta_social", status: "CONNECTED", externalAccountId: "page-1", providerHealth: null, providerHealthAt: null, providerHealthError: null },
    });
    await tables.integrationCredential.create({
      data: { integrationId: integration.id, encryptedData: encryptJson({ accessToken: "page-token", pageId: "page-1" }) },
    });
    return tables.socialAccount.create({
      data: { organizationId: "org-1", integrationId: integration.id, platform: "meta_page", externalId: "page-1", name: "My Page", status: "connected", providerHealth: null, providerHealthAt: null, providerHealthError: null },
    });
  }

  it("a Page whose own node reports a business stores it verbatim (id + verification_status)", async () => {
    const tables = healthTables();
    const probes = {
      graphGet: async (_t: string, path: string) => {
        if (path.includes("fields=business")) return { business: { id: "biz-9", verification_status: "verified" } };
        if (path.includes("instagram_business_account")) return { instagram_business_account: { id: "ig-1" } };
        throw new Error(`unexpected path ${path}`);
      },
      shopifyAccessScopes: async () => { throw new Error("n/a"); },
    };
    const health = new ProviderHealthService(tables as any, audit, probes);
    const account = await seedPage(tables);
    const res: any = await health.refreshMetaPageHealth("org-1", account.id);
    expect(res.ok).toBe(true);
    expect(res.providerHealth.business).toEqual({ id: "biz-9", verificationStatus: "verified" });
    expect(res.businessError).toBeUndefined();
  });

  it("a failed business call stores NOTHING about the business and rides the result — the rest of the snapshot is intact", async () => {
    const tables = healthTables();
    const probes = {
      graphGet: async (_t: string, path: string) => {
        if (path.includes("fields=business")) throw new Error("(#100) field business not supported");
        if (path.includes("instagram_business_account")) return { instagram_business_account: { id: "ig-1" } };
        throw new Error(`unexpected path ${path}`);
      },
      shopifyAccessScopes: async () => { throw new Error("n/a"); },
    };
    const health = new ProviderHealthService(tables as any, audit, probes);
    const account = await seedPage(tables);
    const res: any = await health.refreshMetaPageHealth("org-1", account.id);
    expect(res.ok).toBe(true);
    expect(res.providerHealth.instagram).toEqual({ linked: true, id: "ig-1" });
    expect("business" in res.providerHealth).toBe(false);
    expect(res.businessError).toContain("not supported");
    expect(res.providerHealthError).toBeNull();
  });

  it("an ad account stores its owning business beside the funding boolean; no business answer ⇒ no business key", async () => {
    const tables = healthTables();
    const integration = await tables.integration.create({
      data: { organizationId: "org-1", provider: "meta", status: "CONNECTED", appSource: "platform" },
    });
    integration.credential = { encryptedData: encryptJson({ accessToken: "ad-token" }) };
    const ad = await tables.adAccount.create({
      data: { organizationId: "org-1", integrationId: integration.id, platform: "meta", sourceType: "api", externalId: "999", name: "Ads", status: "ACTIVE", providerHealth: null, providerHealthAt: null, providerHealthError: null },
    });
    let businessAnswer: any = { business: { id: "biz-2", verification_status: "not_verified" } };
    const probes = {
      graphGet: async (_t: string, path: string) => {
        if (path.includes("fields=business")) return businessAnswer;
        if (path.includes("funding_source_details")) return { funding_source_details: { id: "fs-1" } };
        throw new Error(`unexpected path ${path}`);
      },
      shopifyAccessScopes: async () => { throw new Error("n/a"); },
    };
    const health = new ProviderHealthService(tables as any, audit, probes);
    const r1: any = await health.refreshAdAccountHealth("org-1", ad.id);
    expect(r1.ok).toBe(true);
    expect(r1.providerHealth).toEqual({ kind: "ad_account", paymentMethodOnFile: true, business: { id: "biz-2", verificationStatus: "not_verified" } });
    businessAnswer = {};
    const r2: any = await health.refreshAdAccountHealth("org-1", ad.id);
    expect(r2.ok).toBe(true);
    expect("business" in r2.providerHealth).toBe(false);
  });
});
