process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "test-secret";
process.env.WEB_URL = "https://app.example.com";
process.env.API_PUBLIC_URL = "https://api.example.com";

import { MessagingService } from "./messaging.service";
import { InboxService } from "../inbox/inbox.service";
import { encryptJson } from "../integrations/crypto";
import { senderConfigSafeView } from "./sender-config";
import {
  buildCarouselComponent, qualityGuardDecision, resolveWhatsAppRateMinor, templateKindFromComponents,
} from "./whatsapp-rich";

/**
 * MX9 — WhatsApp Commerce & Rich v2: pure helpers (template kind
 * from REAL stored components, per-category rate resolution from
 * org-entered rates only, the quality guard decision on real
 * synced RED/REJECTED data only, the carousel create-format
 * builder), the InboxService carousel submit (payload pinned at
 * the mocked global-fetch seam — the same boundary MS6 specs use),
 * and the MessagingService wiring (guard at create + send build,
 * settings roundtrip, per-category rates, category-aware cost
 * estimate). Fake prisma + fake fetch, like MS6/MX3.
 */

// ---------- shared fake-prisma helpers ----------
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
      if ("not" in v) return row[k] !== v.not;
      return true;
    }
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
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
    findUnique: async ({ where }: any) => rows.find((r) => matches(r, where ?? {})) ?? null,
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    upsert: async ({ where, update, create }: any) => {
      const row = rows.find((r) => matches(r, where ?? {}));
      if (row) { Object.assign(row, update); return row; }
      const created = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create }; rows.push(created); return created;
    },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); if (i >= 0) rows.splice(i, 1); return {}; },
  };
}

// ---------- pure: template kind ----------
describe("MX9 templateKindFromComponents (stored components only)", () => {
  it("classifies carousel from BOTH the sync format and the create format", () => {
    expect(templateKindFromComponents([{ type: "BODY", text: "x" }, { type: "CAROUSEL", cards: [] }])).toBe("carousel");
    expect(templateKindFromComponents([{ type: "body" }, { type: "carousel", cards: [] }])).toBe("carousel");
  });
  it("classifies catalog + flow buttons, else standard", () => {
    expect(templateKindFromComponents([{ type: "BUTTONS", buttons: [{ type: "CATALOG", text: "দেখুন" }] }])).toBe("catalog");
    expect(templateKindFromComponents([{ type: "buttons", buttons: [{ type: "flow", text: "ফর্ম" }] }])).toBe("flow");
    expect(templateKindFromComponents([{ type: "BUTTONS", buttons: [{ type: "URL", text: "x", url: "https://a.b", flow_id: "123" }] }])).toBe("flow");
    expect(templateKindFromComponents([{ type: "BODY", text: "x" }, { type: "BUTTONS", buttons: [{ type: "URL", text: "x", url: "https://a.b" }] }])).toBe("standard");
    expect(templateKindFromComponents(null)).toBe("standard");
    expect(templateKindFromComponents(undefined)).toBe("standard");
  });
});

// ---------- pure: rates ----------
describe("MX9 resolveWhatsAppRateMinor (org-entered rates only)", () => {
  const rates = { whatsappCostPerMessageMinor: 50, whatsappMarketingCostPerMessageMinor: 80, whatsappUtilityCostPerMessageMinor: null, whatsappAuthenticationCostPerMessageMinor: 30 };
  it("category rate wins when set for the template's real category", () => {
    expect(resolveWhatsAppRateMinor(rates, "MARKETING")).toEqual({ rateMinor: 80, basis: "category", category: "MARKETING" });
    expect(resolveWhatsAppRateMinor(rates, "AUTHENTICATION")).toEqual({ rateMinor: 30, basis: "category", category: "AUTHENTICATION" });
  });
  it("falls back to the flat rate when the category rate is unset", () => {
    expect(resolveWhatsAppRateMinor(rates, "UTILITY")).toEqual({ rateMinor: 50, basis: "flat", category: "UTILITY" });
  });
  it("unknown/missing category uses the flat rate; nothing set → null (no figure)", () => {
    expect(resolveWhatsAppRateMinor(rates, null)).toEqual({ rateMinor: 50, basis: "flat", category: null });
    expect(resolveWhatsAppRateMinor({}, "MARKETING")).toEqual({ rateMinor: null, basis: null, category: "MARKETING" });
    expect(resolveWhatsAppRateMinor(null, "MARKETING").rateMinor).toBeNull();
  });
});

// ---------- pure: quality guard ----------
describe("MX9 qualityGuardDecision (real synced data only)", () => {
  it("blocks RED quality and REJECTED status when enabled, with the template named", () => {
    expect(qualityGuardDecision(true, { name: "promo", qualityRating: "RED", status: "APPROVED" }).blocked).toBe(true);
    expect(qualityGuardDecision(true, { name: "promo", qualityRating: "RED" }).reason).toContain("promo");
    expect(qualityGuardDecision(true, { name: "otp", qualityRating: null, status: "REJECTED" }).blocked).toBe(true);
  });
  it("is INERT when disabled, when the rating is null (never synced), and for GREEN/YELLOW/UNKNOWN", () => {
    expect(qualityGuardDecision(false, { name: "p", qualityRating: "RED", status: "REJECTED" }).blocked).toBe(false);
    expect(qualityGuardDecision(true, { name: "p", qualityRating: null, status: "APPROVED" }).blocked).toBe(false);
    expect(qualityGuardDecision(true, { name: "p", qualityRating: null, status: null }).blocked).toBe(false);
    for (const q of ["GREEN", "YELLOW", "UNKNOWN"]) {
      expect(qualityGuardDecision(true, { name: "p", qualityRating: q, status: "APPROVED" }).blocked).toBe(false);
    }
  });
});

// ---------- pure: carousel builder ----------
describe("MX9 buildCarouselComponent", () => {
  const card = (over: any = {}) => ({
    headerFormat: "image" as const, headerHandle: "handle-1",
    bodyText: "শাড়ি {{1}} টাকা", exampleValues: ["৫০০"],
    buttons: [{ type: "url" as const, text: "কিনুন", url: "https://shop.example/saree" }],
    ...over,
  });
  it("builds the documented CAROUSEL create-format component", () => {
    const out = buildCarouselComponent([card(), card({ headerFormat: "video", bodyText: "ভিডিও কার্ড", exampleValues: undefined, buttons: undefined })]);
    expect(out.type).toBe("CAROUSEL");
    const cards = (out as any).cards;
    expect(cards).toHaveLength(2);
    expect(cards[0].components[0]).toEqual({ type: "HEADER", format: "IMAGE", example: { header_handle: ["handle-1"] } });
    expect(cards[0].components[1]).toEqual({ type: "BODY", text: "শাড়ি {{1}} টাকা", example: { body_text: [["৫০০"]] } });
    expect(cards[0].components[2]).toEqual({ type: "BUTTONS", buttons: [{ type: "URL", text: "কিনুন", url: "https://shop.example/saree" }] });
    expect(cards[1].components).toHaveLength(2); // no BUTTONS component when no buttons
  });
  it("refuses honestly: <2 or >10 cards, missing handle, missing examples, >2 buttons per card", () => {
    expect(() => buildCarouselComponent([card()])).toThrow(/২ থেকে ১০টি কার্ড/);
    expect(() => buildCarouselComponent(Array.from({ length: 11 }, () => card()))).toThrow(/২ থেকে ১০টি কার্ড/);
    expect(() => buildCarouselComponent([card(), card({ headerHandle: " " })])).toThrow(/headerHandle/);
    expect(() => buildCarouselComponent([card(), card({ exampleValues: [] })])).toThrow(/exampleValues/);
    expect(() => buildCarouselComponent([card(), card({ buttons: [
      { type: "quick_reply", text: "a" }, { type: "quick_reply", text: "b" }, { type: "quick_reply", text: "c" },
    ] })])).toThrow(/সর্বোচ্চ ২টি বাটন/);
  });
});

// ---------- InboxService: carousel submit ----------
function buildInbox() {
  const tables: any = {
    integration: makeTable("int"),
    integrationCredential: makeTable("cred"),
    whatsAppTemplate: makeTable("wa"),
  };
  const baseInt = tables.integration;
  const attach = (row: any, args: any) => {
    if (!row) return row;
    if (args?.include?.credential) {
      const cred = tables.integrationCredential.rows.find((c: any) => c.integrationId === row.id) ?? null;
      return { ...row, credential: cred };
    }
    return row;
  };
  tables.integration = {
    ...baseInt,
    findFirst: async (args: any) => attach(await baseInt.findFirst(args), args),
  };
  tables.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: "whatsapp", status: "CONNECTED", createdAt: new Date() });
  tables.integrationCredential.rows.push({ id: "cred-1", integrationId: "int-1", encryptedData: encryptJson({ accessToken: "tok-secret", phoneNumberId: "999", wabaId: "WABA123" }) });
  const auditLogs: any[] = [];
  const svc = new InboxService(tables as any, { log: async (e: any) => { auditLogs.push(e); } } as any, {} as any);
  return { svc, tables, auditLogs };
}
const realFetch = global.fetch;
afterEach(() => { (global as any).fetch = realFetch; });
function stubFetch(handler: (url: string, init: any) => any) {
  const calls: any[] = [];
  (global as any).fetch = async (url: string, init: any) => { calls.push({ url, init }); return handler(url, init); };
  return calls;
}
const okJson = (body: any) => ({ ok: true, status: 200, json: async () => body });
const errJson = (message: string) => ({ ok: false, status: 400, json: async () => ({ error: { message } }) });

describe("MX9 carousel submit (InboxService, mocked Meta seam)", () => {
  const cards = [
    { headerFormat: "image" as const, headerHandle: "h-1", bodyText: "কার্ড এক", buttons: [{ type: "quick_reply" as const, text: "চাই" }] },
    { headerFormat: "image" as const, headerHandle: "h-2", bodyText: "কার্ড দুই {{1}}", exampleValues: ["x"] },
  ];
  it("appends the CAROUSEL component after the BODY and stores the row on Meta success", async () => {
    const { svc, tables } = buildInbox();
    const calls = stubFetch(async () => okJson({ id: "mt-c1", status: "PENDING", category: "MARKETING" }));
    const row = await svc.submitWhatsAppTemplate("org-1", "owner", {
      name: "eid_carousel", category: "MARKETING", bodyText: "ঈদের কালেকশন দেখুন", carouselCards: cards,
    });
    const payload = JSON.parse(calls[0].init.body);
    expect(payload.components[0]).toEqual({ type: "BODY", text: "ঈদের কালেকশন দেখুন" });
    expect(payload.components[1].type).toBe("CAROUSEL");
    expect(payload.components[1].cards).toHaveLength(2);
    expect(payload.components[1].cards[0].components[0]).toEqual({ type: "HEADER", format: "IMAGE", example: { header_handle: ["h-1"] } });
    expect(row.status).toBe("PENDING");
    expect(tables.whatsAppTemplate.rows).toHaveLength(1);
    // The stored components classify back as a carousel template.
    expect(templateKindFromComponents(row.components)).toBe("carousel");
  });
  it("invalid cards refuse BEFORE any Meta call; a header on a carousel template refuses too", async () => {
    const { svc, tables } = buildInbox();
    const calls = stubFetch(async () => okJson({ id: "x" }));
    await expect(svc.submitWhatsAppTemplate("org-1", "owner", {
      name: "bad_carousel", category: "MARKETING", bodyText: "x", carouselCards: [cards[0]],
    })).rejects.toThrow(/২ থেকে ১০টি কার্ড/);
    await expect(svc.submitWhatsAppTemplate("org-1", "owner", {
      name: "bad_carousel2", category: "MARKETING", bodyText: "x", headerType: "text", headerText: "h", carouselCards: cards,
    })).rejects.toThrow(/আলাদা Header থাকে না/);
    expect(calls).toHaveLength(0);
    expect(tables.whatsAppTemplate.rows).toHaveLength(0);
  });
  it("a Meta rejection on a carousel submit is verbatim and stores nothing", async () => {
    const { svc, tables } = buildInbox();
    stubFetch(async () => errJson("Invalid carousel card count"));
    await expect(svc.submitWhatsAppTemplate("org-1", "owner", {
      name: "eid_carousel", category: "MARKETING", bodyText: "x", carouselCards: cards,
    })).rejects.toThrow("Invalid carousel card count");
    expect(tables.whatsAppTemplate.rows).toHaveLength(0);
  });
});

// ---------- MessagingService: guard + rates + settings ----------
function buildMessaging(opts: { guard?: boolean } = {}) {
  const tables: any = {
    messageTemplate: makeTable("tpl"), broadcast: makeTable("bc"), messageDelivery: makeTable("dlv"),
    customer: makeTable("cust"), lead: makeTable("lead"), whatsAppTemplate: makeTable("wa"),
    messagePreference: makeTable("pref"), messagingSetting: makeTable("mset"),
    broadcastRecipient: makeTable("bcr"), order: makeTable("ord"),
    messageLinkClick: makeTable("click"), messagingSenderConfig: makeTable("scfg"),
    messagingSmsGatewayConfig: makeTable("gw"), integration: makeTable("int"),
    integrationCredential: makeTable("cred"), organization: makeTable("org"),
  };
  tables.systemSetting = { findUnique: async () => null };
  tables.organization.rows.push({ id: "org-1", name: "Test Shop", timezone: "Asia/Dhaka" });
  tables.messagingSetting.rows.push({
    id: "mset-1", organizationId: "org-1", frequencyCapPerDay: 0, whatsappOptInRequired: false,
    linkTrackingEnabled: true, whatsappQualityGuardEnabled: opts.guard === true,
  });
  tables.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: "whatsapp", status: "CONNECTED", createdAt: new Date() });
  tables.integrationCredential.rows.push({ id: "cred-1", integrationId: "int-1", encryptedData: encryptJson({ accessToken: "tok", phoneNumberId: "999" }) });
  // createWhatsAppSender reads integration with include credential:
  const baseInt = tables.integration;
  tables.integration = {
    ...baseInt,
    findFirst: async (args: any) => {
      const row = await baseInt.findFirst(args);
      if (!row) return row;
      if (args?.include?.credential) {
        const cred = tables.integrationCredential.rows.find((c: any) => c.integrationId === row.id) ?? null;
        return { ...row, credential: cred };
      }
      return row;
    },
  };
  const email = { isConfigured: () => true, send: async () => ({ providerMessageId: "e-1" }) } as any;
  const sms = { isConfigured: () => true, send: async () => ({ providerMessageId: "s-1" }) } as any;
  const svc = new MessagingService(tables as any, { log: async () => undefined } as any, email, sms);
  return { svc, tables };
}
const waTpl = (over: any = {}) => ({
  id: "wa-1", organizationId: "org-1", name: "promo", language: "bn", category: "MARKETING",
  bodyText: "অফার", status: "APPROVED", qualityRating: "GREEN", components: null, lastSyncedAt: new Date(),
  createdAt: new Date(), updatedAt: new Date(), ...over,
});

describe("MX9 quality guard enforcement (MessagingService)", () => {
  it("create: a RED template is refused when the guard is ON — nothing is created", async () => {
    const { svc, tables } = buildMessaging({ guard: true });
    tables.whatsAppTemplate.rows.push(waTpl({ qualityRating: "RED" }));
    await expect(svc.createBroadcast("org-1", "owner", {
      name: "B1", channel: "whatsapp", audienceType: "customers", whatsappTemplateId: "wa-1",
    } as any)).rejects.toThrow(/Quality Guard/);
    expect(tables.broadcast.rows).toHaveLength(0);
  });
  it("create: the same RED template is allowed when the guard is OFF (pre-MX9 behaviour)", async () => {
    const { svc, tables } = buildMessaging({ guard: false });
    tables.whatsAppTemplate.rows.push(waTpl({ qualityRating: "RED" }));
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "B1", channel: "whatsapp", audienceType: "customers", whatsappTemplateId: "wa-1",
    } as any);
    expect(bc.id).toBeTruthy();
    expect(tables.broadcast.rows).toHaveLength(1);
  });
  it("create: guard ON + rating null (never synced) does NOT block; REJECTED status does", async () => {
    const { svc, tables } = buildMessaging({ guard: true });
    tables.whatsAppTemplate.rows.push(waTpl({ id: "wa-null", qualityRating: null, status: null }));
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "B-ok", channel: "whatsapp", audienceType: "customers", whatsappTemplateId: "wa-null",
    } as any);
    expect(bc.id).toBeTruthy();
    tables.whatsAppTemplate.rows.push(waTpl({ id: "wa-rej", name: "rej", qualityRating: "GREEN", status: "REJECTED" }));
    await expect(svc.createBroadcast("org-1", "owner", {
      name: "B-rej", channel: "whatsapp", audienceType: "customers", whatsappTemplateId: "wa-rej",
    } as any)).rejects.toThrow(/REJECTED/);
  });
  it("send-time: the sender build refuses a template that turned RED after create", async () => {
    const { svc, tables } = buildMessaging({ guard: true });
    tables.whatsAppTemplate.rows.push(waTpl({ qualityRating: "RED" }));
    await expect((svc as any).createWhatsAppSender("org-1", { id: "bc-1", whatsappTemplateId: "wa-1" }, "bc-1"))
      .rejects.toThrow(/Quality Guard/);
  });
  it("send-time: guard ON + GREEN template builds the sender without throwing", async () => {
    const { svc, tables } = buildMessaging({ guard: true });
    tables.whatsAppTemplate.rows.push(waTpl({ qualityRating: "GREEN" }));
    const sender = await (svc as any).createWhatsAppSender("org-1", { id: "bc-1", whatsappTemplateId: "wa-1" }, "bc-1");
    expect(typeof sender).toBe("function");
  });
  it("settings roundtrip: the guard flag persists through updateMessagingSetting + the view", async () => {
    const { svc } = buildMessaging({ guard: false });
    const out = await svc.updateMessagingSetting("org-1", "owner", { whatsappQualityGuardEnabled: true });
    expect(out.whatsappQualityGuardEnabled).toBe(true);
    const view = await svc.getMessagingSettingsView("org-1");
    expect(view.whatsappQualityGuardEnabled).toBe(true);
    await expect(svc.updateMessagingSetting("org-1", "owner", { whatsappQualityGuardEnabled: "yes" as any }))
      .rejects.toThrow(/must be a boolean/);
  });
});

describe("MX9 per-category rates (MessagingService)", () => {
  it("updateSenderRates stores category rates; the safe view returns them; invalid values refuse", async () => {
    const { svc, tables } = buildMessaging();
    const view = await svc.updateSenderRates("org-1", "owner", {
      whatsappCostPerMessageMinor: 50, whatsappMarketingCostPerMessageMinor: 80, whatsappUtilityCostPerMessageMinor: 40,
    });
    expect(view.rates).toMatchObject({
      whatsappCostPerMessageMinor: 50, whatsappMarketingCostPerMessageMinor: 80,
      whatsappUtilityCostPerMessageMinor: 40, whatsappAuthenticationCostPerMessageMinor: null,
    });
    expect(tables.messagingSenderConfig.rows[0].whatsappMarketingCostPerMessageMinor).toBe(80);
    await expect(svc.updateSenderRates("org-1", "owner", { whatsappMarketingCostPerMessageMinor: -5 }))
      .rejects.toThrow(/non-negative integer/);
    expect(senderConfigSafeView(null, { emailConfigured: false, smsConfigured: false }).rates.whatsappMarketingCostPerMessageMinor).toBeNull();
  });
  it("cost estimate: a MARKETING template uses the category rate; no rates at all → null estimate", async () => {
    const { svc, tables } = buildMessaging();
    tables.messagingSenderConfig.rows.push({
      id: "scfg-1", organizationId: "org-1", whatsappCostPerMessageMinor: 50,
      whatsappMarketingCostPerMessageMinor: 80, whatsappUtilityCostPerMessageMinor: null, whatsappAuthenticationCostPerMessageMinor: null,
    });
    const est = await (svc as any).buildCostEstimate("org-1", "whatsapp", 10, undefined, "MARKETING");
    expect(est.totalMinor).toBe(800);
    expect(est.basis).toContain("per-category rate");
    const flat = await (svc as any).buildCostEstimate("org-1", "whatsapp", 10, undefined, "UTILITY");
    expect(flat.totalMinor).toBe(500);
    tables.messagingSenderConfig.rows.length = 0;
    tables.messagingSenderConfig.rows.push({ id: "scfg-2", organizationId: "org-1" });
    await expect((svc as any).buildCostEstimate("org-1", "whatsapp", 10, undefined, "MARKETING")).resolves.toBeNull();
  });
});
