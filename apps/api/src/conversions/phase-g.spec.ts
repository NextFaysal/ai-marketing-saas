import { ConversionsService, hashEmail, hashPhone } from "./conversions.service";
import { MetaClient } from "../ads/meta/meta.client";
import { normalizeMetaAdInsight } from "../ads/meta/normalize";
import { AdsService } from "../ads/ads.service";
import { AttributionService } from "../attribution/attribution.service";
import { createHash } from "crypto";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");

// ---------------- CAPI service fakes ----------------
function makeConversions(overrides: any = {}) {
  const db: any = {
    settings: [] as any[], logs: [] as any[], orders: [] as any[], customers: [] as any[], leads: [] as any[], items: [] as any[],
    integrations: [] as any[], tracking: [] as any[], touchpoints: [] as any[], ...overrides,
  };
  const prisma: any = {
    conversionApiSetting: {
      findUnique: async ({ where }: any) => db.settings.find((s: any) => s.organizationId === where.organizationId) ?? null,
      create: async ({ data }: any) => { const r = { id: "set-1", ...data }; db.settings.push(r); return r; },
      update: async ({ where, data }: any) => { const r = db.settings.find((s: any) => s.organizationId === where.organizationId); Object.assign(r, data); return r; },
    },
    conversionEventLog: {
      findFirst: async ({ where }: any) => db.logs.find((l: any) => l.organizationId === where.organizationId && l.eventId === where.eventId) ?? null,
      create: async ({ data }: any) => { const r = { id: `log-${db.logs.length + 1}`, createdAt: new Date(), ...data }; db.logs.push(r); return r; },
      findMany: async ({ where }: any) => db.logs.filter((l: any) => l.organizationId === where.organizationId),
    },
    order: { findFirst: async ({ where }: any) => db.orders.find((o: any) => o.id === where.id && o.organizationId === where.organizationId) ?? null },
    customer: { findFirst: async ({ where }: any) => db.customers.find((c: any) => c.id === where.id) ?? null },
    lead: { findFirst: async ({ where }: any) => db.leads.find((l: any) => l.id === where.id) ?? null },
    orderItem: { findMany: async () => db.items },
    integration: { findFirst: async () => db.integrations[0] ?? null },
    trackingEvent: { findMany: async () => db.tracking },
    touchpoint: { findFirst: async () => db.touchpoints[0] ?? null },
  };
  const svc = new ConversionsService(prisma, { log: async () => {} } as any, undefined);
  return { svc, db };
}

let capiCalls: any[] = [];
const okFetch = async (url: string, init: any) => {
  capiCalls.push({ url, body: JSON.parse(init.body) });
  return { ok: true, status: 200, json: async () => ({ events_received: capiCalls[0]?.__receive ?? 1, fbtrace_id: "trace-1" }), statusText: "OK" } as any;
};

describe("Phase G - hashing", () => {
  it("hashes email lowercase-trimmed and BD phones to intl digits", () => {
    expect(hashEmail("  User@Example.COM ")).toBe(sha("user@example.com"));
    expect(hashEmail("not-an-email")).toBeNull();
    expect(hashPhone("01712345678")).toBe(sha("8801712345678"));
    expect(hashPhone("+880 1712-345678")).toBe(sha("8801712345678"));
    expect(hashPhone(null)).toBeNull();
  });
});

describe("Phase G - CAPI purchase flow", () => {
  const order = { id: "o1", organizationId: "org1", externalNumber: "1001", externalId: "1001", customerId: "cu1", status: "processing", totalMinor: 125000n, currency: "BDT", placedAt: new Date() };
  function setup(trigger = "placed") {
    capiCalls = [];
    const { svc, db } = makeConversions();
    db.settings.push({ organizationId: "org1", pixelId: "px1", purchaseTrigger: trigger, enabled: true, sendLeadEvents: true, accessTokenEncrypted: null });
    db.orders.push(order);
    db.customers.push({ id: "cu1", email: "buyer@example.com", phone: "01712345678" });
    db.items.push({ sku: "SKU-1", name: "Shirt", quantity: 2 });
    // Point the client at the stub by replacing fetch through a fresh client injection:
    // ConversionsService constructs MetaCapiClient with global fetch; swap global.
    (global as any).fetch = okFetch;
    // dedicated token path: store an integration with an encrypted credential
    const { encryptJson } = require("../integrations/crypto");
    db.integrations.push({ credential: { encryptedData: encryptJson({ accessToken: "ads-token" }) } });
    return { svc, db };
  }

  it("sends a Purchase only on events_received and logs it, with dedupe id purchase-<order number>", async () => {
    const { svc, db } = setup();
    await svc.handleOrderTrigger("org1", "o1", "placed");
    expect(db.logs.length).toBe(1);
    expect(db.logs[0].status).toBe("sent");
    expect(db.logs[0].eventId).toBe("purchase-1001");
    expect(db.logs[0].eventsReceived).toBe(1);
    const sent = capiCalls[0].body.data[0];
    expect(sent.event_name).toBe("Purchase");
    expect(sent.custom_data.value).toBe(1250);
    expect(sent.user_data.em[0]).toBe(sha("buyer@example.com"));
    expect(sent.user_data.ph[0]).toBe(sha("8801712345678"));
    // Repeat trigger is deduped by the log.
    await svc.handleOrderTrigger("org1", "o1", "placed");
    expect(db.logs.length).toBe(1);
    expect(capiCalls.length).toBe(1);
  });

  it("does not send when the trigger does not match the setting", async () => {
    const { svc, db } = setup("cod_confirmed");
    await svc.handleOrderTrigger("org1", "o1", "placed");
    expect(db.logs.length).toBe(0);
    expect(capiCalls.length).toBe(0);
  });

  it("logs failed when Meta receives 0 events", async () => {
    const { svc, db } = setup();
    (global as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({ events_received: 0 }), statusText: "OK" } as any);
    await svc.handleOrderTrigger("org1", "o1", "placed");
    expect(db.logs.length).toBe(1);
    expect(db.logs[0].status).toBe("failed");
  });

  it("test event requires a test code and a configured setting", async () => {
    const { svc } = setup();
    await expect(svc.sendTestEvent("org1", "u1")).rejects.toThrow(/testEventCode/);
  });

  it("never sends for cancelled orders", async () => {
    const { svc, db } = setup();
    db.orders[0] = { ...order, status: "cancelled" };
    await svc.handleOrderTrigger("org1", "o1", "placed");
    expect(db.logs.length).toBe(0);
  });
});

// ---------------- Ad-level normalize + Meta client ----------------
describe("Phase G - ad insight normalize", () => {
  it("maps ad/adset ids, reach and video views", () => {
    const n = normalizeMetaAdInsight({
      date_start: "2026-10-01", campaign_id: "c1", campaign_name: "Camp", adset_id: "as1", adset_name: "Set",
      ad_id: "ad1", ad_name: "Hero", spend: "10.50", impressions: "1000", clicks: "50", reach: "800",
      actions: [{ action_type: "purchase", value: "3" }, { action_type: "video_view", value: "250" }],
      action_values: [{ action_type: "purchase", value: "99.00" }],
    });
    expect(n.adExternalId).toBe("ad1");
    expect(n.reach).toBe(800);
    expect(n.videoViews).toBe(250);
    expect(n.spendMinor).toBe(1050n);
  });

  it("ad-insights client requests level=ad", async () => {
    const urls: string[] = [];
    const client = new MetaClient("tok", (async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => ({ data: [] }), statusText: "OK" } as any;
    }) as any);
    await client.getAdInsights("act_1", "2026-10-01", "2026-10-02");
    expect(urls[0]).toContain("level=ad");
    expect(urls[0]).toContain("ad_id");
  });
});

// ---------------- Attribution window ----------------
describe("Phase G - attribution window setting", () => {
  it("validates the allowed values and reads the org setting", async () => {
    const org = { id: "org1", attributionWindowDays: 30 };
    const prisma: any = { organization: {
      findUnique: async () => org,
      update: async ({ data }: any) => { Object.assign(org, data); return org; },
    } };
    const svc = new AttributionService(prisma);
    expect(await svc.windowFor("org1")).toBe(30);
    await expect(svc.updateSettings("org1", 45)).rejects.toThrow(/7, 14, 30, 60, 90/);
    await svc.updateSettings("org1", 14);
    expect(await svc.windowFor("org1")).toBe(14);
  });
});
