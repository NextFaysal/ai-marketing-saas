process.env.JWT_SECRET = "test-secret";
process.env.WEB_URL = "https://app.example.com";
process.env.API_PUBLIC_URL = "https://api.example.com";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { MessagingService, MESSAGING_AI_FEATURE } from "./messaging.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";
import { dhakaHour, summarizeSendTimeEvents, segmentSuggestionsFromCounts } from "./messaging-ai";

/**
 * MS9 — AI for messaging: copy/subject drafts under the
 * VisionService discipline (kill switch 403 → daily cap 429 →
 * ONE usage record per completed call, shared feature
 * "messaging_copy"), drafts RETURNED ONLY (no broadcast /
 * template / delivery rows ever), foreign product 404,
 * unparseable provider output ⇒ 502 with nothing stored, the
 * dev provider labelled and never presented as a model, and
 * the two DETERMINISTIC suggestions (send-time with its
 * 100-event threshold + Asia/Dhaka bucketing; segment rules
 * from real RFM counts + the WhatsApp opt-in advisory).
 * Fake-prisma style like the MS1–MS8 specs.
 */
const cmp = (a: any, b: any) => {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  return av < bv ? -1 : av > bv ? 1 : 0;
};
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("not" in v) {
        if (v.not === null) { if (row[k] === null || row[k] === undefined) return false; }
        else if (row[k] === v.not) return false;
      }
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("contains" in v && !String(row[k] ?? "").includes(String(v.contains))) return false;
      if ("gt" in v && !(cmp(row[k], v.gt) > 0)) return false;
      if ("gte" in v && !(cmp(row[k], v.gte) >= 0)) return false;
      if ("lt" in v && !(cmp(row[k], v.lt) < 0)) return false;
      if ("lte" in v && !(cmp(row[k], v.lte) <= 0)) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v instanceof Date) return cmp(row[k], v) === 0;
    return row[k] === v;
  });
}
function applyOrder(list: any[], orderBy: any): any[] {
  if (!orderBy) return list;
  const keys = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...list];
  for (let i = keys.length - 1; i >= 0; i--) {
    const [key, dir] = Object.entries(keys[i])[0] as [string, string];
    out.sort((a, b) => (dir === "desc" ? cmp(b[key], a[key]) : cmp(a[key], b[key])));
  }
  return out;
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where, take, orderBy }: any = {}) => {
      const f = applyOrder(rows.filter((r) => matches(r, where ?? {})), orderBy);
      return take ? f.slice(0, take) : f;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (row) { Object.assign(row, data); row.updatedAt = new Date(); }
      return row;
    },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); if (i >= 0) rows.splice(i, 1); return {}; },
  };
}

const TABLE_NAMES = [
  "messageTemplate", "broadcast", "messageDelivery", "customer", "lead", "whatsAppTemplate",
  "messagePreference", "messagingSetting", "messagingSavedAudience", "messagingSenderConfig",
  "messageLinkClick", "product", "integration", "businessProfile", "aIUsageRecord",
];

function build(llmFactory: any) {
  const tables: Record<string, any> = {};
  for (const n of TABLE_NAMES) tables[n] = makeTable(n);
  // Platform settings: systemSetting is keyed (platformSetting
  // reads findUnique({ where: { key } }) → row.value).
  const settingValues: Record<string, unknown> = {};
  tables.systemSetting = {
    findUnique: async ({ where }: any) => (where.key in settingValues ? { key: where.key, value: settingValues[where.key] } : null),
  };
  const orgRow: any = { aiDailyLimitOverride: null, broadcastCapOverride: null, seatLimit: null };
  tables.organization = { findUnique: async () => orgRow };
  tables.subscription = { findFirst: async () => null };
  // Orders get a real groupBy (computeRfm's two placedAt
  // partitions, count/sum/max — the SC1 shape).
  const orderRows: any[] = [];
  tables.order = {
    rows: orderRows,
    groupBy: async ({ by, where }: any) => {
      const filtered = orderRows.filter((r) => matches(r, where ?? {}));
      const groups = new Map<string, any>();
      for (const r of filtered) {
        const key = r[by[0]];
        const g = groups.get(key) ?? { [by[0]]: key, _count: { _all: 0 }, _sum: { totalMinor: 0n }, _max: { placedAt: null, createdAt: null } };
        g._count._all += 1;
        g._sum.totalMinor += BigInt(r.totalMinor ?? 0);
        if (r.placedAt && (!g._max.placedAt || new Date(r.placedAt) > new Date(g._max.placedAt))) g._max.placedAt = r.placedAt;
        if (r.createdAt && (!g._max.createdAt || new Date(r.createdAt) > new Date(g._max.createdAt))) g._max.createdAt = r.createdAt;
        groups.set(key, g);
      }
      return [...groups.values()];
    },
    findFirst: async () => null,
    findMany: async () => [],
  };
  const audit = { log: async () => undefined } as any;
  const email = { isConfigured: () => true, send: async () => ({ providerMessageId: "x" }) } as any;
  const sms = { isConfigured: () => true, send: async () => ({ providerMessageId: "y" }) } as any;
  const svc = new MessagingService(tables as any, audit, email, sms, llmFactory);
  return { svc, tables, settingValues, orgRow };
}

function realProvider(text: string | (() => string), counter?: { calls: number }) {
  return {
    name: "openai", isRealLlm: true,
    complete: async () => {
      if (counter) counter.calls++;
      return { text: typeof text === "function" ? text() : text, model: "gpt-test", inputTokens: 11, outputTokens: 22, tokensEstimated: false };
    },
  };
}
const factoryOf = (provider: any) => ({ getProvider: () => provider });
const statusOf = (e: any) => (typeof e?.getStatus === "function" ? e.getStatus() : e?.status);

const EMAIL_VARIANTS = JSON.stringify({
  variants: [
    { subject: "ঈদ অফার শুরু হয়েছে", body: "হ্যালো {{name}}, আমাদের নতুন কালেকশন দেখুন।" },
    { subject: "বিশেষ সংগ্রহ আপনার জন্য", body: "হ্যালো {{name}}, সীমিত সময়ের সংগ্রহ এখন লাইভ।" },
  ],
});

describe("MS9 draft: discipline (kill switch / cap / usage)", () => {
  it("kill switch ⇒ 403 and the provider is never called", async () => {
    const counter = { calls: 0 };
    const { svc, settingValues } = build(factoryOf(realProvider(EMAIL_VARIANTS, counter)));
    settingValues.killSwitches = { aiDisabledOrgIds: ["org-1"], broadcastsPaused: false };
    const err = await svc.draftMessagingCopy("org-1", "user-1", { channel: "email", goal: "ঈদ বিক্রি বাড়ানো" }).catch((e) => e);
    expect(statusOf(err)).toBe(403);
    expect(counter.calls).toBe(0);
  });

  it("daily cap reached ⇒ 429 and the provider is never called", async () => {
    const counter = { calls: 0 };
    const { svc, tables, orgRow } = build(factoryOf(realProvider(EMAIL_VARIANTS, counter)));
    orgRow.aiDailyLimitOverride = 2;
    for (let i = 0; i < 2; i++) {
      tables.aIUsageRecord.rows.push({ id: `u-${i}`, organizationId: "org-1", feature: MESSAGING_AI_FEATURE, createdAt: new Date() });
    }
    const err = await svc.draftMessagingCopy("org-1", "user-1", { channel: "email", goal: "বিক্রি" }).catch((e) => e);
    expect(statusOf(err)).toBe(429);
    expect(counter.calls).toBe(0);
  });

  it("a successful draft writes exactly ONE usage record with feature messaging_copy", async () => {
    const { svc, tables } = build(factoryOf(realProvider(EMAIL_VARIANTS)));
    await svc.draftMessagingCopy("org-1", "user-1", { channel: "email", goal: "বিক্রি" });
    expect(tables.aIUsageRecord.rows).toHaveLength(1);
    const rec = tables.aIUsageRecord.rows[0];
    expect(rec.feature).toBe("messaging_copy");
    expect(rec.provider).toBe("openai");
    expect(rec.model).toBe("gpt-test");
    expect(rec.estimated).toBe(false);
  });

  it("subjects on the same service append to the same feature ledger", async () => {
    let mode = "copy";
    const provider = {
      name: "openai", isRealLlm: true,
      complete: async () => ({
        text: mode === "copy" ? EMAIL_VARIANTS : JSON.stringify({ variants: ["এক", "দুই", "তিন"] }),
        model: "gpt-test", inputTokens: 5, outputTokens: 6, tokensEstimated: false,
      }),
    };
    const { svc, tables } = build(factoryOf(provider));
    await svc.draftMessagingCopy("org-1", "user-1", { channel: "email", goal: "বিক্রি" });
    mode = "subjects";
    const res = await svc.draftMessagingSubjects("org-1", "user-1", { subject: "আসল Subject", goal: "ক্লিক বাড়ানো" });
    expect(res.variants).toEqual(["এক", "দুই", "তিন"]);
    expect(res.providerLabel).toBe("openai");
    expect(tables.aIUsageRecord.rows).toHaveLength(2);
    expect(tables.aIUsageRecord.rows.every((r: any) => r.feature === "messaging_copy")).toBe(true);
  });
});

describe("MS9 draft: content rules", () => {
  it("returns 2 variants grounded in the REAL product row; creates NO broadcast/template/delivery rows", async () => {
    let seenUserText = "";
    const provider = {
      name: "openai", isRealLlm: true,
      complete: async (messages: any[]) => {
        seenUserText = messages.map((m) => m.content).join("\n");
        return { text: EMAIL_VARIANTS, model: "gpt-test", inputTokens: 11, outputTokens: 22, tokensEstimated: false };
      },
    };
    const { svc, tables } = build(factoryOf(provider));
    tables.product.rows.push({
      id: "p-1", organizationId: "org-1", name: "রানিং জুতা X", priceMinor: 150000n, compareAtMinor: null,
      currency: "BDT", category: "জুতা", description: "হালকা ও আরামদায়ক",
    });
    tables.businessProfile.rows.push({ id: "bp-1", organizationId: "org-1", brandVoice: "বন্ধুসুলভ", uniqueSellingPoints: "সারা দেশে হোম ডেলিভারি" });
    const res = await svc.draftMessagingCopy("org-1", "user-1", { channel: "email", goal: "ঈদ বিক্রি", productId: "p-1" });
    expect(res.variants).toHaveLength(2);
    expect(res.variants[0].subject).toBeTruthy();
    expect(res.variants[0].body).toContain("{{name}}");
    expect(res.providerLabel).toBe("openai");
    expect(res.isRealLlm).toBe(true);
    // The prompt carried the REAL facts (product + profile), not inventions.
    expect(seenUserText).toContain("রানিং জুতা X");
    expect(seenUserText).toContain("বন্ধুসুলভ");
    expect(seenUserText).toContain("ঈদ বিক্রি");
    // Returned ONLY: the messaging tables are untouched.
    expect(tables.broadcast.rows).toHaveLength(0);
    expect(tables.messageTemplate.rows).toHaveLength(0);
    expect(tables.messageDelivery.rows).toHaveLength(0);
  });

  it("SMS drafts carry the segment helper's part count on the result", async () => {
    const provider = realProvider(JSON.stringify({ variants: [{ body: "অফার চলছে" }, { body: "নতুন কালেকশন এসেছে" }] }));
    const { svc } = build(factoryOf(provider));
    const res = await svc.draftMessagingCopy("org-1", "user-1", { channel: "sms", goal: "অফার জানানো" });
    expect(res.variants).toHaveLength(2);
    expect((res.variants[0] as any).smsParts).toBe(1);
    expect((res.variants[0] as any).subject).toBeUndefined();
  });

  it("foreign or missing product ⇒ 404, never invented facts", async () => {
    const { svc, tables } = build(factoryOf(realProvider(EMAIL_VARIANTS)));
    tables.product.rows.push({ id: "p-foreign", organizationId: "org-2", name: "অন্যের পণ্য", priceMinor: 100n, currency: "BDT" });
    const e1 = await svc.draftMessagingCopy("org-1", "user-1", { channel: "email", goal: "বিক্রি", productId: "p-foreign" }).catch((e) => e);
    expect(statusOf(e1)).toBe(404);
    const e2 = await svc.draftMessagingCopy("org-1", "user-1", { channel: "email", goal: "বিক্রি", productId: "p-missing" }).catch((e) => e);
    expect(statusOf(e2)).toBe(404);
  });

  it("unparseable provider output ⇒ 502 and NOTHING is stored (no usage record either)", async () => {
    const { svc, tables } = build(factoryOf(realProvider("this is not json at all")));
    const err = await svc.draftMessagingCopy("org-1", "user-1", { channel: "email", goal: "বিক্রি" }).catch((e) => e);
    expect(statusOf(err)).toBe(502);
    expect(String(err.message)).toContain("AI উত্তর বোঝা যায়নি");
    expect(tables.aIUsageRecord.rows).toHaveLength(0);
    expect(tables.broadcast.rows).toHaveLength(0);
    expect(tables.messageTemplate.rows).toHaveLength(0);
    expect(tables.messageDelivery.rows).toHaveLength(0);
  });

  it("whatsapp channel ⇒ 400 (drafts are email/sms only)", async () => {
    const { svc } = build(factoryOf(realProvider(EMAIL_VARIANTS)));
    const err = await svc.draftMessagingCopy("org-1", "user-1", { channel: "whatsapp", goal: "বিক্রি" }).catch((e) => e);
    expect(statusOf(err)).toBe(400);
  });

  it("dev provider: labelled template variants from real facts only, usage recorded as dev-template", async () => {
    const { svc, tables } = build(factoryOf(new DevTemplateProvider()));
    tables.product.rows.push({
      id: "p-1", organizationId: "org-1", name: "রানিং জুতা X", priceMinor: 150000n, compareAtMinor: 200000n,
      currency: "BDT", category: "জুতা", description: "হালকা",
    });
    const res = await svc.draftMessagingCopy("org-1", "user-1", { channel: "email", goal: "ঈদ বিক্রি", productId: "p-1" });
    expect(res.providerLabel).toBe("dev-template");
    expect(res.isRealLlm).toBe(false);
    expect(res.notice).toContain("Dev Template");
    expect(res.variants).toHaveLength(2);
    expect(res.variants[0].body).toContain("রানিং জুতা X");
    expect(tables.aIUsageRecord.rows).toHaveLength(1);
    expect(tables.aIUsageRecord.rows[0].provider).toBe("dev-template");
    expect(tables.aIUsageRecord.rows[0].estimated).toBe(true);
    expect(tables.broadcast.rows).toHaveLength(0);
  });

  it("dev subjects: the plain variants are labelled too", async () => {
    const { svc } = build(factoryOf(new DevTemplateProvider()));
    const res = await svc.draftMessagingSubjects("org-1", "user-1", { subject: "ঈদ অফার" });
    expect(res.isRealLlm).toBe(false);
    expect(res.providerLabel).toBe("dev-template");
    expect(res.variants[0]).toBe("ঈদ অফার");
    expect(res.notice).toBeTruthy();
  });
});

describe("MS9 send-time suggestion (deterministic)", () => {
  // 20:15 UTC = 02:15 Asia/Dhaka (UTC+6, no DST).
  const dhaka0215 = () => { const d = new Date(); d.setUTCHours(20, 15, 0, 0); return d; };

  it("dhakaHour pins the UTC→Dhaka conversion", () => {
    expect(dhakaHour(new Date("2026-01-15T20:15:00.000Z"))).toBe(2);
    expect(dhakaHour(new Date("2026-01-15T18:30:00.000Z"))).toBe(0);
    expect(dhakaHour(new Date("2026-06-15T00:00:00.000Z"))).toBe(6);
    const s = summarizeSendTimeEvents([new Date("2026-01-15T20:15:00.000Z"), new Date("2026-01-15T20:45:00.000Z")]);
    expect(s.totalEvents).toBe(2);
    expect(s.bestHours[0]).toEqual({ hour: 2, events: 2 });
  });

  it("99 events ⇒ unavailable WITH the real count; the 100th event unlocks it", async () => {
    const { svc, tables } = build(factoryOf(realProvider(EMAIL_VARIANTS)));
    for (let i = 0; i < 99; i++) {
      tables.messageLinkClick.rows.push({ id: `clk-${i}`, organizationId: "org-1", broadcastId: "bc-1", recipientKey: "customer:c1", url: "https://x", createdAt: dhaka0215() });
    }
    const before = await svc.sendTimeSuggestion("org-1") as any;
    expect(before.available).toBe(false);
    expect(before.totalEvents).toBe(99);
    expect(before.reason).toContain("99");
    // An openedAt event is the 100th — all three sources count.
    tables.messageDelivery.rows.push({ id: "d-1", organizationId: "org-1", openedAt: dhaka0215(), readAt: null, createdAt: new Date() });
    const after = await svc.sendTimeSuggestion("org-1") as any;
    expect(after.available).toBe(true);
    expect(after.totalEvents).toBe(100);
    expect(after.bestHours[0]).toEqual({ hour: 2, events: 100 });
    expect(after.method).toContain("ঐতিহাসিক সম্পর্ক");
  });

  it("events older than 90 days do not count", async () => {
    const { svc, tables } = build(factoryOf(realProvider(EMAIL_VARIANTS)));
    const old = new Date(Date.now() - 100 * 24 * 3600 * 1000);
    for (let i = 0; i < 150; i++) {
      tables.messageLinkClick.rows.push({ id: `old-${i}`, organizationId: "org-1", broadcastId: "bc-1", recipientKey: "customer:c1", url: "https://x", createdAt: old });
    }
    const res = await svc.sendTimeSuggestion("org-1");
    expect(res.available).toBe(false);
    expect(res.totalEvents).toBe(0);
  });
});

describe("MS9 segment suggestions (deterministic)", () => {
  it("pure rules: fire only at >= 20, map to selectable segment audiences, sorted by size", () => {
    expect(segmentSuggestionsFromCounts({ at_risk: 19 })).toEqual([]);
    const out = segmentSuggestionsFromCounts({ at_risk: 20, champions: 35, new: 20, lost: 0, regular: 500 });
    expect(out.map((s) => s.kind)).toEqual(["early_access_champions", "winback_at_risk", "welcome_new"]);
    for (const s of out) {
      expect(s.audienceType).toBe("segment");
      expect(["at_risk", "champions", "new"]).toContain(s.audienceSegment);
      expect(s.size).toBeGreaterThanOrEqual(20);
    }
  });

  /** 50 customers: recencyDays = index (distinct, so the RFM
   * quintiles are unambiguous). The oldest 20 have frequency 5
   * with small orders (monetary equal to everyone else's single
   * order) ⇒ at_risk exactly 20; the newest 20 have frequency 1
   * ⇒ new exactly 20; the middle 10 are regular. */
  function seedRfm(tables: any) {
    const now = Date.now();
    for (let i = 1; i <= 50; i++) {
      const cid = `c-${i}`;
      tables.customer.rows.push({ id: cid, organizationId: "org-1", firstName: `C${i}`, lastName: "", phone: null, email: null, mergedIntoId: null });
      const freq = i >= 31 ? 5 : 1;
      const eachMinor = i >= 31 ? 2000 : 10000;
      for (let j = 0; j < freq; j++) {
        const placedAt = new Date(now - i * 24 * 3600 * 1000 - j * 3600 * 1000);
        tables.order.rows.push({
          id: `o-${i}-${j}`, organizationId: "org-1", customerId: cid, status: "confirmed",
          totalMinor: eachMinor, placedAt, createdAt: placedAt,
        });
      }
    }
  }

  it("service: real RFM counts drive the suggestions (at_risk 20, new 20)", async () => {
    const { svc, tables } = build(factoryOf(realProvider(EMAIL_VARIANTS)));
    seedRfm(tables);
    const out = await svc.segmentSuggestion("org-1");
    const byKind = Object.fromEntries(out.map((s: any) => [s.kind, s]));
    expect(byKind.winback_at_risk).toMatchObject({ audienceType: "segment", audienceSegment: "at_risk", size: 20 });
    expect(byKind.welcome_new).toMatchObject({ audienceType: "segment", audienceSegment: "new", size: 20 });
    expect(byKind.early_access_champions).toBeUndefined();
  });

  it("WhatsApp opt-in required + nobody opted in ⇒ the advisory fires (no audience attached)", async () => {
    const { svc, tables } = build(factoryOf(realProvider(EMAIL_VARIANTS)));
    tables.messagingSetting.rows.push({ id: "ms-1", organizationId: "org-1", frequencyCapPerDay: 1, whatsappOptInRequired: true, linkTrackingEnabled: true });
    const out = await svc.segmentSuggestion("org-1");
    const advisory = out.find((s: any) => s.kind === "whatsapp_optin_empty") as any;
    expect(advisory).toBeTruthy();
    expect(advisory.size).toBe(0);
    expect((advisory as any).audienceType).toBeUndefined();
    // Once someone has opted in, the advisory is gone.
    tables.messagePreference.rows.push({ id: "mp-1", organizationId: "org-1", channel: "whatsapp", address: "8801712345678", status: "opted_in", source: "manual" });
    const out2 = await svc.segmentSuggestion("org-1");
    expect(out2.find((s: any) => s.kind === "whatsapp_optin_empty")).toBeUndefined();
  });

  it("no data at all ⇒ an empty list, never invented suggestions", async () => {
    const { svc } = build(factoryOf(realProvider(EMAIL_VARIANTS)));
    expect(await svc.segmentSuggestion("org-1")).toEqual([]);
  });
});
