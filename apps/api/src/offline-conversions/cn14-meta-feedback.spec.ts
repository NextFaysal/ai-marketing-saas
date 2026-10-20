process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
import { OfflineConversionsService } from "./offline-conversions.service";
import { EventsService } from "../common/events.service";
import { OrdersService } from "../orders/orders.service";
import { encryptJson } from "../integrations/crypto";

/**
 * Campaign Builder Frontier CN14 (NB6): Meta joins the
 * offline-conversions surface. Spike basis (see
 * docs/campaign-builder-nb6-acceptance.md): the legacy
 * Offline Conversions API / offline event sets were
 * DISCONTINUED by Meta (event-set creation ended May 2024,
 * the API itself May 2025); the current documented path is
 * the Conversions API to a dataset (POST /{dataset_id}/
 * events, action_source "system_generated") — the endpoint
 * the existing MetaCapiClient already speaks — and CRM
 * outcomes travel as Conversion Leads payloads on the same
 * endpoint (event_name = CRM stage, user_data.lead_id,
 * custom_data lead_event_source + event_source "crm").
 *
 * Proven here: a meta upload sends only on Meta's
 * confirmation (events_received >= 1) and is recorded in
 * the shared OfflineConversionLog; the event_id is the
 * deterministic `purchase-{orderKey}` the Conversions API
 * uses, and when that service already delivered the same
 * event_id to the same dataset the upload records a skip —
 * never a second send; the order lifecycle fires uploads
 * automatically through the event bus (order.created /
 * order.cod_confirmed / order.delivered), gated by the
 * per-org setting, and an upload failure can NEVER break
 * an order update; lead feedback fires only for Meta
 * lead-ads leads on qualified/won, only when the setting
 * opts in, and never throws back into the CRM.
 */
const audit = { log: async () => undefined } as any;

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("gte" in v) return new Date(row[k]) >= new Date((v as any).gte);
      if (k.endsWith("_key") || (v.organizationId !== undefined && v.key !== undefined)) return row.organizationId === v.organizationId && row.key === v.key;
      return true;
    }
    return row[k] === v;
  });
}
function table(name: string, rows: any[] = []) {
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
  };
}

function basePrisma() {
  const t: any = {
    offlineConversionSetting: table("ocset"), offlineConversionLog: table("oclog"),
    order: table("order"), orderItem: table("oitem"), customer: table("cust"),
    adAccount: table("account"), integration: table("integration"), integrationCredential: table("cred"),
    conversionApiSetting: table("capiset"), conversionEventLog: table("capilog"),
    lead: table("lead"),
  };
  t.integration.rows.push({ id: "int-m", organizationId: "org-1", provider: "meta", status: "CONNECTED" });
  t.integrationCredential.rows.push({ id: "cred-m", integrationId: "int-m", encryptedData: encryptJson({ accessToken: "meta-tok" }) });
  const attach = (orig: any) => async (args: any) => {
    const row = await orig(args);
    if (row && args?.include?.credential) return { ...row, credential: t.integrationCredential.rows.find((c: any) => c.integrationId === row.id) ?? null };
    return row;
  };
  t.integration.findFirst = attach(t.integration.findFirst);
  t.adAccount.rows.push({ id: "macc-1", organizationId: "org-1", platform: "meta", sourceType: "api", externalId: "act_555", integrationId: "int-m", name: "Meta Main", currency: "BDT" });
  return t;
}

function seedOrder(t: any, over: any = {}) {
  t.customer.rows.push({ id: "cust-1", organizationId: "org-1", email: "buyer@example.com", phone: "+8801712345678" });
  t.order.rows.push({ id: "ord-1", organizationId: "org-1", externalNumber: "1001", status: "processing", totalMinor: 150000n, currency: "BDT", customerId: "cust-1", createdAt: new Date(), placedAt: new Date(), ...over });
  t.orderItem.rows.push({ id: "oi-1", orderId: "ord-1", name: "Panjabi", sku: "PNJ-1", quantity: 2 });
}

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 10)); };
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

/** Graph stub: records calls; `mode` decides Meta's answer. */
function graphFetch(mode: "ok" | "zero" | "boom" = "ok") {
  const calls: { url: string; body: any }[] = [];
  const fn = async (url: string, init: any) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (mode === "boom") throw new Error("network down");
    if (mode === "zero") return { ok: true, status: 200, json: async () => ({ events_received: 0, messages: [] }) };
    return { ok: true, status: 200, json: async () => ({ events_received: 1, fbtrace_id: "FB-TRACE-1" }) };
  };
  return { fn, calls };
}

describe("CN14 meta setting validation", () => {
  it("meta requires a datasetId; the account must be a meta account; the trigger vocabulary is enforced", async () => {
    const t = basePrisma();
    const svc = new OfflineConversionsService(t as any, audit);
    await expect(svc.saveSetting("org-1", "u", "meta", { adAccountId: "macc-1" })).rejects.toThrow(/dataset \(pixel\) id/);
    await expect(svc.saveSetting("org-1", "u", "meta", { adAccountId: "macc-1", datasetId: "DS-9", trigger: "bogus" })).rejects.toMatchObject({ code: "offlineConversions.invalidTrigger" });
    await expect(svc.saveSetting("org-1", "u", "google", { adAccountId: "macc-1", conversionAction: "1" })).rejects.toMatchObject({ code: "offlineConversions.thatAdAccountIsAAccount" });
    const saved = await svc.saveSetting("org-1", "u", "meta", { adAccountId: "macc-1", datasetId: "DS-9", trigger: "delivered", leadFeedbackEnabled: true });
    expect(saved.datasetId).toBe("DS-9");
    expect(saved.leadFeedbackEnabled).toBe(true);
    expect(saved.trigger).toBe("delivered");
  });
});

describe("CN14 meta order upload (dataset CAPI)", () => {
  it("sends a system_generated Purchase with hashed user_data and the deterministic event_id; counts only on Meta confirmation", async () => {
    const t = basePrisma(); seedOrder(t);
    const svc = new OfflineConversionsService(t as any, audit);
    await svc.saveSetting("org-1", "u", "meta", { adAccountId: "macc-1", datasetId: "DS-9", trigger: "delivered" });
    const { fn, calls } = graphFetch(); global.fetch = fn as any;
    const log: any = await svc.uploadForOrder("org-1", "ord-1", "meta");
    expect(log.status).toBe("sent");
    expect(log.detail).toContain("meta confirmed events_received 1");
    expect(log.detail).toContain("deterministic order-derived id");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/DS-9/events");
    const ev = calls[0].body.data[0];
    expect(ev.event_name).toBe("Purchase");
    expect(ev.action_source).toBe("system_generated");
    expect(ev.event_id).toBe("purchase-1001");
    expect(ev.user_data.em[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(ev.user_data.ph[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(ev)).not.toContain("buyer@example.com");
    expect(ev.custom_data).toMatchObject({ currency: "BDT", value: 1500, order_id: "1001", num_items: 2, content_type: "product" });
    // Second upload: the surface's own log dedupes — no new send.
    const again: any = await svc.uploadForOrder("org-1", "ord-1", "meta");
    expect(again.alreadySent).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("dedup vs the Conversions API: same dataset + same event_id already sent = recorded skip, zero network calls", async () => {
    const t = basePrisma(); seedOrder(t);
    t.conversionApiSetting.rows.push({ id: "cs-1", organizationId: "org-1", pixelId: "DS-9" });
    t.conversionEventLog.rows.push({ id: "cl-1", organizationId: "org-1", eventId: "purchase-1001", status: "sent" });
    const svc = new OfflineConversionsService(t as any, audit);
    await svc.saveSetting("org-1", "u", "meta", { adAccountId: "macc-1", datasetId: "DS-9", trigger: "delivered" });
    const { fn, calls } = graphFetch(); global.fetch = fn as any;
    const log: any = await svc.uploadForOrder("org-1", "ord-1", "meta");
    expect(log.status).toBe("skipped");
    expect(log.detail).toContain("already delivered to dataset DS-9 by the Conversions API under the same event_id");
    expect(calls).toHaveLength(0);
  });

  it("a DIFFERENT dataset than the CAPI pixel is not deduped — the upload sends", async () => {
    const t = basePrisma(); seedOrder(t);
    t.conversionApiSetting.rows.push({ id: "cs-1", organizationId: "org-1", pixelId: "OTHER-DS" });
    t.conversionEventLog.rows.push({ id: "cl-1", organizationId: "org-1", eventId: "purchase-1001", status: "sent" });
    const svc = new OfflineConversionsService(t as any, audit);
    await svc.saveSetting("org-1", "u", "meta", { adAccountId: "macc-1", datasetId: "DS-9", trigger: "delivered" });
    const { fn, calls } = graphFetch(); global.fetch = fn as any;
    const log: any = await svc.uploadForOrder("org-1", "ord-1", "meta");
    expect(log.status).toBe("sent");
    expect(calls).toHaveLength(1);
  });

  it("honest skips: no customer match data, no datasetId on the row, cancelled order — nothing sent in any of them", async () => {
    const t = basePrisma(); seedOrder(t, { customerId: null });
    const svc = new OfflineConversionsService(t as any, audit);
    await svc.saveSetting("org-1", "u", "meta", { adAccountId: "macc-1", datasetId: "DS-9", trigger: "delivered" });
    const { fn, calls } = graphFetch(); global.fetch = fn as any;
    const noMatch: any = await svc.uploadForOrder("org-1", "ord-1", "meta");
    expect(noMatch.status).toBe("skipped");
    expect(noMatch.detail).toContain("nothing to match");
    // A legacy row without datasetId (saved before CN14): skip, named.
    t.offlineConversionSetting.rows[0].datasetId = null;
    t.order.rows[0].customerId = "cust-1";
    const noDs: any = await svc.uploadForOrder("org-1", "ord-1", "meta");
    expect(noDs.status).toBe("skipped");
    expect(noDs.detail).toContain("no datasetId");
    t.offlineConversionSetting.rows[0].datasetId = "DS-9";
    t.order.rows[0].status = "cancelled";
    const cancelled: any = await svc.uploadForOrder("org-1", "ord-1", "meta");
    expect(cancelled.status).toBe("skipped");
    expect(cancelled.detail).toContain("order status is cancelled");
    expect(calls).toHaveLength(0);
  });

  it("Meta accepting 0 events is a failure, not a send: rejects and the log records failed", async () => {
    const t = basePrisma(); seedOrder(t);
    const svc = new OfflineConversionsService(t as any, audit);
    await svc.saveSetting("org-1", "u", "meta", { adAccountId: "macc-1", datasetId: "DS-9", trigger: "delivered" });
    global.fetch = graphFetch("zero").fn as any;
    await expect(svc.uploadForOrder("org-1", "ord-1", "meta")).rejects.toMatchObject({ code: "offlineConversions.metaUploadDidNotConfirm" });
    expect(t.offlineConversionLog.rows.find((r: any) => r.platform === "meta")?.status).toBe("failed");
  });
});

describe("CN14 order-lifecycle auto-trigger (event bus wiring)", () => {
  it("order.delivered fires the meta upload; a different trigger or a disabled setting fires nothing", async () => {
    const t = basePrisma(); seedOrder(t);
    const bus = new EventsService();
    const svc = new OfflineConversionsService(t as any, audit, bus);
    await svc.saveSetting("org-1", "u", "meta", { adAccountId: "macc-1", datasetId: "DS-9", trigger: "delivered" });
    const { fn, calls } = graphFetch(); global.fetch = fn as any;
    bus.emit("order.cod_confirmed", { organizationId: "org-1", context: { orderId: "ord-1" } });
    await flush();
    expect(calls).toHaveLength(0);
    expect(t.offlineConversionLog.rows).toHaveLength(0);
    bus.emit("order.delivered", { organizationId: "org-1", context: { orderId: "ord-1" } });
    await flush();
    expect(calls).toHaveLength(1);
    expect(t.offlineConversionLog.rows.find((r: any) => r.platform === "meta")?.status).toBe("sent");
    // Disabled setting = nothing sent, ever — a second order stays untouched.
    t.offlineConversionSetting.rows[0].enabled = false;
    seedOrder(t, {}); t.order.rows[1].id = "ord-2"; t.order.rows[1].externalNumber = "1002";
    bus.emit("order.delivered", { organizationId: "org-1", context: { orderId: "ord-2" } });
    await flush();
    expect(calls).toHaveLength(1);
  });

  it("FAILURE ISOLATION: the order-status write succeeds and stands even when the upload throws", async () => {
    const t = basePrisma(); seedOrder(t);
    const bus = new EventsService();
    const oc = new OfflineConversionsService(t as any, audit, bus);
    await oc.saveSetting("org-1", "u", "meta", { adAccountId: "macc-1", datasetId: "DS-9", trigger: "delivered" });
    global.fetch = graphFetch("boom").fn as any;
    const orders = new OrdersService(t as any, undefined, undefined, audit, undefined, bus);
    const updated: any = await orders.updateOrder("org-1", "actor-1", "ord-1", { status: "completed" });
    expect(updated ?? t.order.rows[0].status).toBeTruthy();
    expect(t.order.rows[0].status).toBe("completed");
    await flush();
    // The upload was attempted, failed, and the failure is on
    // the record — the order never knew.
    expect(t.offlineConversionLog.rows.find((r: any) => r.platform === "meta")?.status).toBe("failed");
  });

  it("an org with NO offline settings emits lifecycle events without errors or logs", async () => {
    const t = basePrisma(); seedOrder(t);
    const bus = new EventsService();
    new OfflineConversionsService(t as any, audit, bus);
    const { fn, calls } = graphFetch(); global.fetch = fn as any;
    bus.emit("order.created", { organizationId: "org-1", context: { orderId: "ord-1" } });
    bus.emit("order.cod_confirmed", { organizationId: "org-1", context: { orderId: "ord-1" } });
    bus.emit("order.delivered", { organizationId: "org-1", context: { orderId: "ord-1" } });
    await flush();
    expect(calls).toHaveLength(0);
    expect(t.offlineConversionLog.rows).toHaveLength(0);
  });
});

describe("CN14 lead quality feedback (Conversion Leads payload)", () => {
  function seedLead(t: any, over: any = {}) {
    t.lead.rows.push({ id: "lead-1", organizationId: "org-1", source: "facebook_lead_ads", externalId: "1234567890123", email: "lead@example.com", phone: "+8801812345678", stage: "won", ...over });
  }
  async function setupSvc(t: any, bus?: EventsService, over: any = {}) {
    const svc = new OfflineConversionsService(t as any, audit, bus);
    await svc.saveSetting("org-1", "u", "meta", { adAccountId: "macc-1", datasetId: "DS-9", trigger: "delivered", leadFeedbackEnabled: true, ...over });
    return svc;
  }

  it("a won Meta lead-ads lead sends the CRM event: stage as event_name, numeric lead_id, crm custom_data; logged + deduped", async () => {
    const t = basePrisma(); seedLead(t);
    const bus = new EventsService();
    await setupSvc(t, bus);
    const { fn, calls } = graphFetch(); global.fetch = fn as any;
    bus.emit("lead.stage_changed", { organizationId: "org-1", context: { leadId: "lead-1", stage: "won" } });
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/DS-9/events");
    const ev = calls[0].body.data[0];
    expect(ev.event_name).toBe("won");
    expect(ev.action_source).toBe("system_generated");
    expect(ev.user_data.lead_id).toBe(1234567890123);
    expect(ev.user_data.em[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(ev.custom_data).toMatchObject({ event_source: "crm", lead_stage: "won" });
    expect(ev.custom_data.lead_event_source).toBeTruthy();
    const log = t.offlineConversionLog.rows.find((r: any) => r.eventId === "lead-feedback-lead-1-won");
    expect(log?.status).toBe("sent");
    // Same stage again: already sent — no duplicate.
    bus.emit("lead.stage_changed", { organizationId: "org-1", context: { leadId: "lead-1", stage: "won" } });
    await flush();
    expect(calls).toHaveLength(1);
  });

  it("no-send gates: feedback toggle off, non-Meta lead, non-outcome stage — zero calls, zero fake logs", async () => {
    const t = basePrisma(); seedLead(t);
    const { fn, calls } = graphFetch(); global.fetch = fn as any;
    const off = await setupSvc(t, undefined, { leadFeedbackEnabled: false });
    await off.sendLeadFeedback("org-1", "lead-1", "won");
    const on = await setupSvc(t);
    t.lead.rows[0].source = "manual";
    await on.sendLeadFeedback("org-1", "lead-1", "won");
    t.lead.rows[0].source = "facebook_lead_ads";
    await on.sendLeadFeedback("org-1", "lead-1", "contacted");
    expect(calls).toHaveLength(0);
    expect(t.offlineConversionLog.rows).toHaveLength(0);
  });

  it("a failed send never throws back into the CRM path and is recorded as failed", async () => {
    const t = basePrisma(); seedLead(t);
    const svc = await setupSvc(t);
    global.fetch = graphFetch("boom").fn as any;
    await expect(svc.sendLeadFeedback("org-1", "lead-1", "qualified")).resolves.toBeUndefined();
    expect(t.offlineConversionLog.rows.find((r: any) => r.eventId === "lead-feedback-lead-1-qualified")?.status).toBe("failed");
  });
});
