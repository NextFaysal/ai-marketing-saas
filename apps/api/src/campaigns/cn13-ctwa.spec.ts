import { CampaignsService } from "./campaigns.service";
import { MetaPublishClient } from "./meta-publish.client";
import { encryptJson } from "../integrations/crypto";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

/**
 * Campaign Builder Frontier CN13 (NB6): real Click-to-WhatsApp
 * ads. Spike basis — Meta's "Ads that Click to WhatsApp"
 * guide (developers.facebook.com, updated 2026-05-21):
 * destination_type "WHATSAPP" (not ON_WHATSAPP), ad-set
 * promoted_object { page_id (required), whatsapp_phone_number
 * (optional) }, per-objective optimization goals, creative
 * link_data { link: https://api.whatsapp.com/send, CTA
 * WHATSAPP_MESSAGE / app_destination WHATSAPP } and the
 * optional page_welcome_message (VISUAL_EDITOR v2).
 *
 * The number is NEVER client-supplied: the ad set binds to
 * one of the org's CONNECTED WhatsApp Integrations and the
 * digits are read back from Meta at save time.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if (k === "adSet") return matches(row.__adSet ?? {}, v);
      return true;
    }
    return row[k] === v;
  });
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findUnique: async ({ where }: any = {}) => rows.find((r) => r.id === where.id) ?? null,
    findMany: async ({ where, take }: any = {}) => { const f = rows.filter((r) => matches(r, where ?? {})); return take ? f.slice(0, take) : f; },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    updateMany: async ({ where, data }: any) => { let n = 0; for (const r of rows) if (matches(r, where)) { Object.assign(r, data); n++; } return { count: n }; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); rows.splice(i, 1); return {}; },
  };
}
function setup(opts: { waStatus?: string; waDigits?: boolean } = {}) {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "integration", "product", "dailyAdMetric", "conversionApiSetting", "conversionEventLog", "channelConversation", "leadForm"]) tables[n] = makeTable(n);
  tables.leadForm.rows.push({ id: "form-1", organizationId: "org", pageId: "pg-1", name: "F", privacyPolicyUrl: "https://x.example/p", questions: [{ type: "FULL_NAME", key: "full_name" }] });
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", sourceType: "api", externalId: "act_777", name: "Main", currency: "BDT", platformStatusBucket: "active", integrationId: "int-meta" });
  tables.integration.rows.push(
    { id: "int-meta", organizationId: "org", provider: "meta", status: "CONNECTED", credential: { encryptedData: encryptJson({ accessToken: "tok-ads" }) } },
    {
      id: "int-wa", organizationId: "org", provider: "whatsapp", status: opts.waStatus ?? "CONNECTED",
      externalAccountId: "PNID-1", isDefault: true, appSource: "platform",
      credential: { encryptedData: encryptJson({ accessToken: "tok-wa", phoneNumberId: "PNID-1", wabaId: "WABA-1" }) },
    },
  );
  const svc = new CampaignsService(tables as any, { log: async () => undefined } as any, { getProvider: () => new DevTemplateProvider() } as any);
  return { tables, svc };
}
/** Graph stub: phone-number read-back + generic 200s. */
function graphFetch(opts: { digits?: string | null } = {}) {
  const calls: { url: string; params: URLSearchParams }[] = [];
  const fetchFn = async (url: string, init: any) => {
    calls.push({ url, params: new URLSearchParams(String(init?.body ?? "")) });
    if (url.includes("PNID-1")) {
      if (opts.digits === null) return { ok: false, status: 400, json: async () => ({ error: { message: "no access to phone number" } }) };
      return { ok: true, status: 200, json: async () => ({ display_phone_number: opts.digits ?? "+880 1712-345678", verified_name: "Shop BD" }) };
    }
    if (url.includes("/campaigns")) return { ok: true, status: 200, json: async () => ({ id: "camp-100" }) };
    if (url.includes("/adsets")) return { ok: true, status: 200, json: async () => ({ id: "adset-100" }) };
    if (url.includes("/ads")) return { ok: true, status: 200, json: async () => ({ id: "ad-100" }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return { fetchFn, calls };
}
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

function seedPlan(tables: any, objective = "OUTCOME_ENGAGEMENT", status = "draft") {
  tables.campaignPlan.rows.push({ id: "plan-1", organizationId: "org", name: "WA Plan", objective, adAccountId: "acc-1", status, budgetMode: "abo" });
  return "plan-1";
}
const WA_SET = {
  name: "WA Set", dailyBudget: "300", optimizationGoal: "CONVERSATIONS",
  pageId: "pg-1", countries: ["BD"], destinationType: "WHATSAPP", whatsappIntegrationId: "int-wa",
};

describe("CN13 ad-set destination validation + save", () => {
  it("binds a CONNECTED WhatsApp integration and stores Meta's read-back digits", async () => {
    const { tables, svc } = setup();
    global.fetch = graphFetch().fetchFn as any;
    seedPlan(tables);
    const set: any = await svc.addAdSet("org", "plan-1", WA_SET);
    expect(set.destinationType).toBe("WHATSAPP");
    expect(set.whatsappIntegrationId).toBe("int-wa");
    expect(set.whatsappPhoneNumberId).toBe("PNID-1");
    expect(set.whatsappPhoneNumber).toBe("+880 1712-345678");
  });

  it("digits that Meta will not read back store null — never invented", async () => {
    const { tables, svc } = setup();
    global.fetch = graphFetch({ digits: null }).fetchFn as any;
    seedPlan(tables);
    const set: any = await svc.addAdSet("org", "plan-1", WA_SET);
    expect(set.destinationType).toBe("WHATSAPP");
    expect(set.whatsappPhoneNumber).toBeNull();
    expect(set.whatsappPhoneNumberId).toBe("PNID-1");
  });

  it("refuses: destination without a picked connection, unknown connection, disconnected connection", async () => {
    const { tables, svc } = setup();
    global.fetch = graphFetch().fetchFn as any;
    seedPlan(tables);
    await expect(svc.addAdSet("org", "plan-1", { ...WA_SET, whatsappIntegrationId: undefined })).rejects.toThrow(/never typed in free-hand/);
    await expect(svc.addAdSet("org", "plan-1", { ...WA_SET, whatsappIntegrationId: "int-nope" })).rejects.toMatchObject({ code: "campaigns.thatWhatsappConnectionWasNotFound" });
    const off = setup({ waStatus: "DISCONNECTED" });
    global.fetch = graphFetch().fetchFn as any;
    seedPlan(off.tables);
    await expect(off.svc.addAdSet("org", "plan-1", WA_SET)).rejects.toMatchObject({ code: "campaigns.thatWhatsappConnectionIsReconnectIt" });
  });

  it("refuses: number attached without the destination, wrong objective, wrong goal, catalog/lead-form conflicts", async () => {
    const { tables, svc } = setup();
    global.fetch = graphFetch().fetchFn as any;
    seedPlan(tables);
    await expect(svc.addAdSet("org", "plan-1", { ...WA_SET, destinationType: undefined })).rejects.toThrow(/destinationType is not "WHATSAPP"/);
    seedPlan(tables, "OUTCOME_AWARENESS");
    tables.campaignPlan.rows[1].id = "plan-2";
    await expect(svc.addAdSet("org", "plan-2", WA_SET)).rejects.toThrow(/WhatsApp destination needs/);
    seedPlan(tables);
    tables.campaignPlan.rows[2].id = "plan-3";
    await expect(svc.addAdSet("org", "plan-3", { ...WA_SET, optimizationGoal: "VALUE" })).rejects.toThrow(/optimizes on CONVERSATIONS, LINK_CLICKS/);
    await expect(svc.addAdSet("org", "plan-1", { ...WA_SET, leadFormId: "form-1" })).rejects.toThrow(/cannot also carry a lead form/);
    await expect(svc.addAdSet("org", "plan-1", { ...WA_SET, conversionEvent: "PURCHASE" })).rejects.toThrow(/conversionEvent applies to pixel conversion goals/);
  });

  it("update: switching the destination on resolves the connection; clearing removes every WhatsApp field; a goal edit breaking the matrix is refused", async () => {
    const { tables, svc } = setup();
    global.fetch = graphFetch().fetchFn as any;
    seedPlan(tables);
    const plain: any = await svc.addAdSet("org", "plan-1", { name: "Plain", dailyBudget: "300", optimizationGoal: "CONVERSATIONS", pageId: "pg-1", countries: ["BD"] });
    const on: any = await svc.updateAdSet("org", "plan-1", plain.id, "u", { destinationType: "WHATSAPP", whatsappIntegrationId: "int-wa" });
    expect(on.destinationType).toBe("WHATSAPP");
    expect(on.whatsappPhoneNumber).toBe("+880 1712-345678");
    await expect(svc.updateAdSet("org", "plan-1", plain.id, "u", { optimizationGoal: "VALUE" })).rejects.toThrow(/optimizes on/);
    const off: any = await svc.updateAdSet("org", "plan-1", plain.id, "u", { destinationType: "" });
    expect(off.destinationType).toBeNull();
    expect(off.whatsappIntegrationId).toBeNull();
    expect(off.whatsappPhoneNumberId).toBeNull();
    expect(off.whatsappPhoneNumber).toBeNull();
  });

  it("validatePlan: a video ad on a WhatsApp set is an error; a link ad passes", async () => {
    const { tables, svc } = setup();
    global.fetch = graphFetch().fetchFn as any;
    seedPlan(tables);
    const set: any = await svc.addAdSet("org", "plan-1", WA_SET);
    tables.campaignAd.rows.push({ id: "ad-v", adSetId: set.id, name: "V", primaryText: "hi", linkUrl: "https://x.example", format: "video", videoAssetId: "va-1", callToAction: "SHOP_NOW" });
    const full = await svc.getPlan("org", "plan-1");
    expect(svc.validatePlan(full).errors.join(" ")).toMatch(/link creative/);
    tables.campaignAd.rows[0].format = "link";
    tables.campaignAd.rows[0].videoAssetId = null;
    const full2 = await svc.getPlan("org", "plan-1");
    expect(svc.validatePlan(full2).valid).toBe(true);
  });
});

describe("CN13 welcome message builder (publish client)", () => {
  it("autofill shape carries greeting + prefill; ice-breaker shape carries titles and drops prefill; empty is undefined", () => {
    const auto = MetaPublishClient.buildPageWelcomeMessage({ greetingText: "স্বাগতম!", prefillMessage: "আমি এই পণ্যটি কিনতে চাই" }) as any;
    expect(auto.text_format.customer_action_type).toBe("autofill_message");
    expect(auto.text_format.message.text).toBe("স্বাগতম!");
    expect(auto.text_format.message.autofill_message.content).toBe("আমি এই পণ্যটি কিনতে চাই");
    const ice = MetaPublishClient.buildPageWelcomeMessage({ greetingText: "হ্যালো", prefillMessage: "prefill", iceBreakers: ["দাম কত?", "ডেলিভারি কবে?", "সাইজ আছে?", "চতুর্থটি বাদ"] }) as any;
    expect(ice.text_format.customer_action_type).toBe("ice_breakers");
    expect(ice.text_format.message.ice_breakers).toHaveLength(3);
    expect(ice.text_format.message.autofill_message).toBeUndefined();
    expect(MetaPublishClient.buildPageWelcomeMessage({})).toBeUndefined();
    expect(MetaPublishClient.buildPageWelcomeMessage(null)).toBeUndefined();
  });

  it("ad-level welcome input is normalized (trimmed, capped) and clears with null", async () => {
    const { tables, svc } = setup();
    global.fetch = graphFetch().fetchFn as any;
    seedPlan(tables);
    const set: any = await svc.addAdSet("org", "plan-1", WA_SET);
    const ad: any = await svc.addAd("org", "plan-1", set.id, {
      name: "WA Ad", primaryText: "মেসেজ করুন", linkUrl: "https://x.example",
      whatsappWelcome: { greetingText: "  স্বাগতম  ", iceBreakers: [" দাম? ", "", "ডেলিভারি?"] },
    });
    expect(ad.whatsappWelcome).toEqual({ greetingText: "স্বাগতম", iceBreakers: ["দাম?", "ডেলিভারি?"] });
    // The fake resolves an ad's plan through __adSet (the
    // cn4 fake convention for the nested adSet filter).
    (tables.campaignAd.rows.find((r: any) => r.id === ad.id) as any).__adSet = { planId: "plan-1" };
    const cleared: any = await svc.updateAd("org", "plan-1", ad.id, "u", { whatsappWelcome: null });
    expect(cleared.whatsappWelcome).toBeNull();
  });
});

describe("CN13 publish payload", () => {
  it("sends destination_type WHATSAPP + promoted_object with digits, and the CTWA creative with welcome block; everything PAUSED", async () => {
    const { tables, svc } = setup();
    const { fetchFn, calls } = graphFetch();
    global.fetch = fetchFn as any;
    seedPlan(tables);
    const set: any = await svc.addAdSet("org", "plan-1", WA_SET);
    await svc.addAd("org", "plan-1", set.id, {
      name: "WA Ad", primaryText: "মেসেজ করুন", headline: "অর্ডার করুন", linkUrl: "https://shop.example/p",
      whatsappWelcome: { greetingText: "স্বাগতম!", prefillMessage: "আমি অর্ডার করতে চাই" },
    });
    tables.campaignPlan.rows[0].status = "approved";
    await svc.publish("org", "owner", "plan-1");
    const adsetCall = calls.find((c) => c.url.includes("/adsets"))!;
    expect(adsetCall.params.get("destination_type")).toBe("WHATSAPP");
    expect(JSON.parse(adsetCall.params.get("promoted_object")!)).toEqual({ page_id: "pg-1", whatsapp_phone_number: "8801712345678" });
    expect(adsetCall.params.get("status")).toBe("PAUSED");
    const adCall = calls.find((c) => c.url.includes("/ads") && !c.url.includes("/adsets"))!;
    const creative = JSON.parse(adCall.params.get("creative")!);
    expect(creative.link_data.link).toBe("https://api.whatsapp.com/send");
    expect(creative.link_data.call_to_action).toEqual({ type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } });
    expect(creative.link_data.page_welcome_message.text_format.customer_action_type).toBe("autofill_message");
    const log = tables.campaignPublishLog.rows.find((r: any) => r.step === "whatsapp_destination");
    expect(log).toBeTruthy();
    expect(log.externalId).toBe("PNID-1");
    expect(log.error).toContain("whatsapp_phone_number পাঠানো হয়েছে");
  });

  it("without resolved digits the promoted_object carries page_id only, and the log says the Page-linked number will be used", async () => {
    const { tables, svc } = setup();
    const { fetchFn, calls } = graphFetch({ digits: null });
    global.fetch = fetchFn as any;
    seedPlan(tables);
    const set: any = await svc.addAdSet("org", "plan-1", WA_SET);
    await svc.addAd("org", "plan-1", set.id, { name: "WA Ad", primaryText: "মেসেজ করুন", linkUrl: "https://shop.example/p" });
    tables.campaignPlan.rows[0].status = "approved";
    await svc.publish("org", "owner", "plan-1");
    const adsetCall = calls.find((c) => c.url.includes("/adsets"))!;
    expect(JSON.parse(adsetCall.params.get("promoted_object")!)).toEqual({ page_id: "pg-1" });
    const log = tables.campaignPublishLog.rows.find((r: any) => r.step === "whatsapp_destination");
    expect(log.error).toContain("Page-এর সাথে Linked");
  });
});

describe("CN13 readiness + destinations + conversation reporting", () => {
  it("readiness: connected number is ok; disconnected and removed connections are errors; a welcome on a website set warns", async () => {
    const { tables, svc } = setup();
    global.fetch = graphFetch().fetchFn as any;
    seedPlan(tables);
    const set: any = await svc.addAdSet("org", "plan-1", WA_SET);
    await svc.addAd("org", "plan-1", set.id, { name: "WA Ad", primaryText: "মেসেজ করুন", linkUrl: "https://shop.example/p" });
    const ready = await svc.readiness("org", "plan-1");
    expect(ready.checks.some((c: any) => c.key === "whatsapp" && c.level === "ok")).toBe(true);
    tables.integration.rows.find((r: any) => r.id === "int-wa").status = "DISCONNECTED";
    const ready2 = await svc.readiness("org", "plan-1");
    expect(ready2.checks.some((c: any) => c.key === "whatsapp" && c.level === "error")).toBe(true);
    expect(ready2.ready).toBe(false);
  });

  it("destinations list real connection rows without secrets", async () => {
    const { svc } = setup();
    const out: any = await svc.whatsappDestinations("org");
    expect(out.available).toBe(true);
    expect(out.destinations).toHaveLength(1);
    expect(out.destinations[0]).toMatchObject({ integrationId: "int-wa", phoneNumberId: "PNID-1", connected: true, wabaId: "WABA-1" });
    expect(JSON.stringify(out)).not.toContain("tok-wa");
  });

  it("conversations are counted per ad by ctwaSourceId and labelled conversations-started, not messages", async () => {
    const { tables, svc } = setup();
    global.fetch = graphFetch().fetchFn as any;
    seedPlan(tables, "OUTCOME_ENGAGEMENT", "published");
    tables.campaignPlan.rows[0].externalCampaignId = "camp-100";
    const set: any = await svc.addAdSet("org", "plan-1", WA_SET).catch(() => null);
    // plan is published (not editable) in this seed — build rows directly instead.
    void set;
    tables.campaignAdSet.rows.push({ id: "set-x", planId: "plan-1", name: "WA Set", externalAdSetId: "adset-100", destinationType: "WHATSAPP" });
    tables.campaignAd.rows.push(
      { id: "ad-x", adSetId: "set-x", name: "WA Ad", externalAdId: "ad-100", primaryText: "t", linkUrl: "https://x.example" },
      { id: "ad-y", adSetId: "set-x", name: "Other Ad", externalAdId: "ad-200", primaryText: "t", linkUrl: "https://x.example" },
    );
    tables.channelConversation.rows.push(
      { id: "c1", organizationId: "org", channel: "whatsapp", ctwaSourceId: "ad-100" },
      { id: "c2", organizationId: "org", channel: "whatsapp", ctwaSourceId: "ad-100" },
      { id: "c3", organizationId: "org", channel: "whatsapp", ctwaSourceId: "ad-999" },
      { id: "c4", organizationId: "org", channel: "messenger", ctwaSourceId: "ad-100" },
      { id: "c5", organizationId: "other-org", channel: "whatsapp", ctwaSourceId: "ad-100" },
    );
    const out: any = await svc.planWhatsAppConversations("org", "plan-1");
    expect(out.totalConversations).toBe(2);
    expect(out.perAd.find((a: any) => a.adId === "ad-x").conversationsStarted).toBe(2);
    expect(out.perAd.find((a: any) => a.adId === "ad-y").conversationsStarted).toBe(0);
    expect(out.label).toContain("conversations STARTED");
    expect(out.label).toContain("not messages");
  });
});
