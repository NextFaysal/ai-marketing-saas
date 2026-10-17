process.env.JWT_SECRET = "test-secret-g2";
process.env.WEB_URL = "https://app.example.com";
process.env.API_PUBLIC_URL = "https://api.example.com";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { MessagingService } from "./messaging.service";
import {
  BROADCAST_TIER2_MAX_RECIPIENTS,
  BroadcastPersonalizationService,
  normalizePersonalizationConfig,
  renderPersonalizedBody,
} from "./broadcast-personalization.service";
import { renderTemplate } from "./render";

/**
 * SA-B20 (G2) — Broadcast Personalised. Pins:
 *  - the privacy wall: a recipient's variant carries ONLY
 *    their own memory/order facts (cross-recipient sentinel
 *    scan over vars, rendered bodies AND the LLM prompts);
 *  - a no-memory recipient's vars are byte-identical to the
 *    legacy pipeline's (tier "base");
 *  - Tier 1 merges memory facts (last product / categories /
 *    observed language) into the snapshot vars;
 *  - Tier 2 recommends ONLY a live product in a bought
 *    category (an out-of-category temptation is refused),
 *    the shared number guard drops invented numbers to a
 *    counted fallback, and the recipient cap refuses honestly;
 *  - suppressed recipients are excluded BEFORE personalisation
 *    (zero LLM calls spent on them);
 *  - preview == send: the preview sample body equals the body
 *    the prepared snapshot renders for the same recipient;
 *  - cross-org isolation on every fact query.
 * Fake-prisma style like the MS specs.
 */
const cmp = (a: any, b: any) => {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  return av < bv ? -1 : av > bv ? 1 : 0;
};
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (k === "OR" && Array.isArray(v)) return v.some((sub: any) => matches(row, sub));
    if (k === "AND" && Array.isArray(v)) return v.every((sub: any) => matches(row, sub));
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
    findFirst: async ({ where, orderBy }: any = {}) => applyOrder(rows.filter((r) => matches(r, where ?? {})), orderBy)[0] ?? null,
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
  "channelConversation", "customerMemory", "orderItem",
];

function build(llmFactory: any) {
  const tables: Record<string, any> = {};
  for (const n of TABLE_NAMES) tables[n] = makeTable(n);
  const settingValues: Record<string, unknown> = {};
  tables.systemSetting = {
    findUnique: async ({ where }: any) => (where.key in settingValues ? { key: where.key, value: settingValues[where.key] } : null),
  };
  const orgRow: any = { aiDailyLimitOverride: null, broadcastCapOverride: null, seatLimit: null };
  tables.organization = { findUnique: async () => orgRow };
  tables.subscription = { findFirst: async () => null };
  // Order table: real findMany/findFirst + the groupBy shape
  // computeOrderAggregates partitions on.
  const orderTable = makeTable("order");
  (orderTable as any).groupBy = async ({ by, where }: any) => {
    const filtered = orderTable.rows.filter((r: any) => matches(r, where ?? {}));
    const groups = new Map<string, any>();
    for (const r of filtered) {
      const key = r[by[0]];
      const g = groups.get(key) ?? { [by[0]]: key, _count: { _all: 0 }, _sum: { totalMinor: 0 }, _max: { placedAt: null, createdAt: null } };
      g._count._all += 1;
      g._sum.totalMinor += Number(r.totalMinor ?? 0);
      if (r.placedAt && (!g._max.placedAt || cmp(r.placedAt, g._max.placedAt) > 0)) g._max.placedAt = r.placedAt;
      if (r.createdAt && (!g._max.createdAt || cmp(r.createdAt, g._max.createdAt) > 0)) g._max.createdAt = r.createdAt;
      groups.set(key, g);
    }
    return [...groups.values()];
  };
  tables.order = orderTable;

  const audit = { log: async () => undefined };
  const svc = new MessagingService(tables as any, audit as any, {} as any, {} as any, llmFactory);
  const personalization = new BroadcastPersonalizationService(tables as any, llmFactory);
  return { tables, svc, personalization, settingValues };
}

/** A recording fake provider: `handler` maps the user-message
 *  facts text to the completion text. */
function recordingProvider(handler: (userText: string) => string) {
  const calls: { system: string; user: string }[] = [];
  const provider = {
    name: "openai", isRealLlm: true,
    complete: async (messages: any[]) => {
      const user = String(messages.find((m: any) => m.role === "user")?.content ?? "");
      const system = String(messages.find((m: any) => m.role === "system")?.content ?? "");
      calls.push({ system, user });
      return { text: handler(user), model: "gpt-test", inputTokens: 11, outputTokens: 22, tokensEstimated: false };
    },
  };
  return { provider, calls };
}
const factoryOf = (provider: any) => ({ getProvider: () => provider });
const devFactory = () => factoryOf({ name: "dev", isRealLlm: false, complete: async () => { throw new Error("dev provider must not be called"); } });

/** The honest model: recommend the FIRST candidate it was
 *  actually offered, by exact name. */
const goodHandler = (user: string): string => {
  const m = user.match(/- id=(\S+) \| ([^|]+) \| category:/);
  if (!m) return JSON.stringify({ hook: "আপনার জন্য নতুন collection এসেছে!", productId: null });
  return JSON.stringify({ hook: `${m[2].trim()} — আপনার জন্য নতুন এসেছে!`, productId: m[1] });
};

const BODY = "{{aiHook}}\nপ্রিয় {{name}}, আপনার পছন্দের {{favoriteCategory}} category-তে নতুন collection এসেছে। শেষ কেনা: {{lastProductName}}।";

function seedOrgA(tables: Record<string, any>) {
  const P = (row: any) => tables.product.rows.push({ currency: "BDT", ...row });
  P({ id: "p-alpha", organizationId: "org-a", name: "AlphaSentinel Shoe", category: "Footwear", status: "ACTIVE", priceMinor: 150000 });
  P({ id: "p-beta", organizationId: "org-a", name: "BetaSentinel Bag", category: "Bags", status: "ACTIVE", priceMinor: 250000 });
  P({ id: "p-gamma", organizationId: "org-a", name: "GammaSentinel Shoes Pro", category: "Footwear", status: "ACTIVE", priceMinor: 180000 });
  P({ id: "p-epsilon", organizationId: "org-a", name: "EpsilonSentinel Bag", category: "Bags", status: "ACTIVE", priceMinor: 220000 });
  P({ id: "p-delta", organizationId: "org-a", name: "DeltaSentinel Watch", category: "Watches", status: "ACTIVE", priceMinor: 990000 });
  P({ id: "p-arch", organizationId: "org-a", name: "ArchivedSentinel Shoe", category: "Footwear", status: "ARCHIVED", priceMinor: 100000 });

  const C = (row: any) => tables.customer.rows.push(row);
  C({ id: "cust-a", organizationId: "org-a", firstName: "Ayesha", lastName: "Rahman", email: "ayesha@example.com", phone: "01711000001" });
  C({ id: "cust-b", organizationId: "org-a", firstName: "Babul", lastName: "Hossain", email: "babul@example.com", phone: "01711000002" });
  C({ id: "cust-c", organizationId: "org-a", firstName: "Chitra", lastName: "Das", email: "chitra@example.com", phone: "01711000003" });
  C({ id: "cust-sup", organizationId: "org-a", firstName: "Suppressed", lastName: "Person", email: "suppressed@example.com", phone: "01711000004" });

  tables.channelConversation.rows.push(
    { id: "conv-a", organizationId: "org-a", channel: "whatsapp", externalContactId: "8801711000001", customerId: "cust-a" },
    { id: "conv-b", organizationId: "org-a", channel: "whatsapp", externalContactId: "8801711000002", customerId: "cust-b" },
  );
  tables.customerMemory.rows.push(
    {
      id: "mem-a", organizationId: "org-a", customerKey: "whatsapp:8801711000001", displayName: "Ayesha",
      languagePref: "bn", orderCount: 3, updatedAt: new Date("2026-10-10T00:00:00Z"),
      topics: [
        { productId: "p-alpha", name: "AlphaSentinel Shoe", via: "ordered" },
        { productId: null, name: "AskedSentinel Cream", via: "asked" },
      ],
      notes: [],
    },
    {
      id: "mem-b", organizationId: "org-a", customerKey: "whatsapp:8801711000002", displayName: "Babul",
      languagePref: "en", orderCount: 1, updatedAt: new Date("2026-10-09T00:00:00Z"),
      topics: [{ productId: "p-beta", name: "BetaSentinel Bag", via: "ordered" }],
      notes: [],
    },
  );
  tables.order.rows.push(
    { id: "ord-a1", organizationId: "org-a", customerId: "cust-a", status: "delivered", externalNumber: "ORD-A1", totalMinor: 150000, placedAt: new Date("2026-10-01T00:00:00Z"), createdAt: new Date("2026-10-01T00:00:00Z") },
    { id: "ord-b1", organizationId: "org-a", customerId: "cust-b", status: "delivered", externalNumber: "ORD-B1", totalMinor: 250000, placedAt: new Date("2026-09-28T00:00:00Z"), createdAt: new Date("2026-09-28T00:00:00Z") },
  );
  tables.orderItem.rows.push(
    { id: "oi-a1", orderId: "ord-a1", productId: "p-alpha", name: "AlphaSentinel Shoe", quantity: 1, priceMinor: 150000, totalMinor: 150000 },
    { id: "oi-b1", orderId: "ord-b1", productId: "p-beta", name: "BetaSentinel Bag", quantity: 1, priceMinor: 250000, totalMinor: 250000 },
  );
  tables.messagePreference.rows.push(
    { id: "pref-sup", organizationId: "org-a", channel: "email", status: "opted_out", address: "suppressed@example.com" },
  );
  tables.businessProfile.rows.push({ organizationId: "org-a", description: "Sentinel fashion store", industry: "Fashion", brandVoice: "বন্ধুসুলভ" });
}

const statusOf = (e: any) => (typeof e?.getStatus === "function" ? e.getStatus() : e?.status);

describe("G2 Tier 1 — memory merge + privacy wall", () => {
  it("merges each recipient's OWN memory facts; a no-memory recipient's vars stay byte-identical", async () => {
    const { provider, calls } = recordingProvider(goodHandler);
    const { tables, personalization } = build(factoryOf(provider));
    seedOrgA(tables);
    const recipients = [
      { type: "customer" as const, id: "cust-a", name: "Ayesha Rahman", email: "ayesha@example.com" },
      { type: "customer" as const, id: "cust-b", name: "Babul Hossain", email: "babul@example.com" },
      { type: "customer" as const, id: "cust-c", name: "Chitra Das", email: "chitra@example.com" },
    ];
    const baseVarsList = recipients.map((r) => ({ name: r.name, ordersCount: 0 }));
    const out = await personalization.personaliseRecipients({
      organizationId: "org-a", channel: "email", body: BODY,
      recipients, baseVarsList, config: { enabled: true, tier2AiHook: false }, actorId: "user-1",
    });
    expect(calls.length).toBe(0); // Tier 1 never calls an LLM
    expect(out.tiers).toEqual(["memory", "memory", "base"]);
    const [va, vb, vc] = out.varsList;
    expect(va.lastProductName).toBe("AlphaSentinel Shoe");
    expect(va.lastCategory).toBe("Footwear");
    expect(va.favoriteCategory).toBe("Footwear");
    expect(va.languagePref).toBe("bn");
    expect(vb.lastProductName).toBe("BetaSentinel Bag");
    expect(vb.favoriteCategory).toBe("Bags");
    expect(vb.languagePref).toBe("en");
    // No facts ⇒ vars EXACTLY the legacy ones, and the rendered
    // body equals the legacy render byte-for-byte.
    expect(vc).toEqual(baseVarsList[2]);
    expect(renderPersonalizedBody(BODY, recipients[2], vc)).toBe(renderTemplate(BODY, baseVarsList[2]));
    // Privacy wall over the rendered variants.
    const bodyA = renderPersonalizedBody(BODY, recipients[0], va);
    const bodyB = renderPersonalizedBody(BODY, recipients[1], vb);
    expect(bodyA).toContain("AlphaSentinel Shoe");
    expect(bodyA).not.toContain("BetaSentinel");
    expect(bodyB).toContain("BetaSentinel Bag");
    expect(bodyB).not.toContain("AlphaSentinel");
    expect(JSON.stringify(va)).not.toContain("BetaSentinel");
    expect(JSON.stringify(vb)).not.toContain("AlphaSentinel");
  });

  it("cross-org isolation: org B rows with identical keys/ids never enter org A's facts", async () => {
    const { provider, calls } = recordingProvider(goodHandler);
    const { tables, personalization } = build(factoryOf(provider));
    seedOrgA(tables);
    // Org B: same conversation key shape, a product in the
    // SAME category org A buys — a leak would surface either
    // as a fact or as a Tier 2 candidate.
    tables.product.rows.push({ id: "p-b1", organizationId: "org-b", name: "CrossOrgSentinel Soap", category: "Footwear", status: "ACTIVE", priceMinor: 5000, currency: "BDT" });
    tables.channelConversation.rows.push({ id: "conv-b-evil", organizationId: "org-b", channel: "whatsapp", externalContactId: "8801711000001", customerId: "cust-a" });
    tables.customerMemory.rows.push({
      id: "mem-b-evil", organizationId: "org-b", customerKey: "whatsapp:8801711000001", displayName: "Evil",
      languagePref: "en", orderCount: 9, updatedAt: new Date("2026-10-15T00:00:00Z"),
      topics: [{ productId: "p-b1", name: "CrossOrgSentinel Soap", via: "ordered" }], notes: [],
    });
    const recipients = [{ type: "customer" as const, id: "cust-a", name: "Ayesha Rahman", email: "ayesha@example.com" }];
    const out = await personalization.personaliseRecipients({
      organizationId: "org-a", channel: "email", body: BODY,
      recipients, baseVarsList: [{ name: "Ayesha Rahman" }],
      config: { enabled: true, tier2AiHook: true }, actorId: "user-1",
    });
    expect(JSON.stringify(out.varsList)).not.toContain("CrossOrgSentinel");
    expect(calls.length).toBe(1);
    expect(calls[0].user).not.toContain("CrossOrgSentinel");
    expect(out.varsList[0].aiHook).toContain("GammaSentinel Shoes Pro");
  });
});

describe("G2 Tier 2 — grounded hook, guard, cap", () => {
  const tier2Input = (personalization: BroadcastPersonalizationService, extra: any = {}) => ({
    organizationId: "org-a", channel: "email", body: BODY,
    recipients: [
      { type: "customer" as const, id: "cust-a", name: "Ayesha Rahman", email: "ayesha@example.com" },
      { type: "customer" as const, id: "cust-b", name: "Babul Hossain", email: "babul@example.com" },
    ],
    baseVarsList: [{ name: "Ayesha Rahman" }, { name: "Babul Hossain" }],
    config: { enabled: true as const, tier2AiHook: true },
    actorId: "user-1",
    ...extra,
  });

  it("generates a hook recommending a LIVE product in a bought category, per recipient", async () => {
    const { provider, calls } = recordingProvider(goodHandler);
    const { tables, personalization } = build(factoryOf(provider));
    seedOrgA(tables);
    const out = await personalization.personaliseRecipients(tier2Input(personalization));
    expect(out.tiers).toEqual(["ai", "ai"]);
    expect(String(out.varsList[0].aiHook)).toContain("GammaSentinel Shoes Pro");
    expect(String(out.varsList[1].aiHook)).toContain("EpsilonSentinel Bag");
    expect(out.counts.tier2Eligible).toBe(2);
    expect(out.llmCallsMade).toBe(2);
    expect(out.llmCallsProjected).toBe(2);
    // Each prompt carried ONLY that recipient's facts.
    expect(calls[0].user).toContain("AlphaSentinel Shoe");
    expect(calls[0].user).not.toContain("BetaSentinel");
    expect(calls[1].user).toContain("BetaSentinel Bag");
    expect(calls[1].user).not.toContain("AlphaSentinel");
    // The archived in-category product is never a candidate.
    expect(calls[0].user).not.toContain("ArchivedSentinel");
    // Usage was recorded in this service's own bucket.
    expect(tables.aIUsageRecord.rows.length).toBe(2);
    expect(tables.aIUsageRecord.rows[0].feature).toBe("broadcast_personalization");
  });

  it("an out-of-category recommendation is refused: fallback to Tier 1, counted", async () => {
    const tempted = recordingProvider(() => JSON.stringify({ hook: "DeltaSentinel Watch — দারুণ অফার!", productId: "p-delta" }));
    const { tables, personalization } = build(factoryOf(tempted.provider));
    seedOrgA(tables);
    const out = await personalization.personaliseRecipients(tier2Input(personalization));
    expect(out.tiers).toEqual(["memory", "memory"]);
    expect(out.varsList[0].aiHook).toBeUndefined();
    expect(out.counts.tier2Fallbacks).toBe(2);
    expect(out.tier2FallbackReasons.product).toBe(2);
  });

  it("an invented number in the hook trips the shared guard: fallback, counted, nothing broken", async () => {
    const inventor = recordingProvider((user: string) => {
      const m = user.match(/- id=(\S+) \| ([^|]+) \| category:/);
      return JSON.stringify({ hook: `${m![2].trim()} মাত্র ৭৭৭ টাকায়!`, productId: m![1] });
    });
    const { tables, personalization } = build(factoryOf(inventor.provider));
    seedOrgA(tables);
    const out = await personalization.personaliseRecipients(tier2Input(personalization));
    expect(out.tiers).toEqual(["memory", "memory"]);
    expect(out.varsList[0].aiHook).toBeUndefined();
    expect(out.tier2FallbackReasons.guard).toBe(2);
    // Tier 1 facts still merged — the fallback is the
    // recipient's own personalised variant, not a failure.
    expect(out.varsList[0].lastProductName).toBe("AlphaSentinel Shoe");
  });

  it("recipient count above the Tier 2 cap refuses honestly — no silent downgrade, no calls", async () => {
    const { provider, calls } = recordingProvider(goodHandler);
    const { personalization } = build(factoryOf(provider));
    const recipients = Array.from({ length: BROADCAST_TIER2_MAX_RECIPIENTS + 1 }, (_, i) => ({
      type: "customer" as const, id: `cap-${i}`, name: `Cap ${i}`, email: `cap${i}@example.com`,
    }));
    const err = await personalization.personaliseRecipients({
      organizationId: "org-a", channel: "email", body: BODY,
      recipients, baseVarsList: recipients.map(() => ({})),
      config: { enabled: true, tier2AiHook: true }, actorId: "user-1",
    }).catch((e) => e);
    expect(statusOf(err)).toBe(400);
    expect(String(err.message)).toContain(String(BROADCAST_TIER2_MAX_RECIPIENTS));
    expect(String(err.message)).toContain(String(BROADCAST_TIER2_MAX_RECIPIENTS + 1));
    expect(calls.length).toBe(0);
  });

  it("no real LLM + Tier 2 ⇒ typed 503 (LLM_NOT_CONFIGURED); Tier 1 alone needs no LLM at all", async () => {
    const { tables, personalization } = build(devFactory());
    seedOrgA(tables);
    const err = await personalization.personaliseRecipients(tier2Input(personalization)).catch((e) => e);
    expect(statusOf(err)).toBe(503);
    expect(err.response?.code ?? err.code).toBe("LLM_NOT_CONFIGURED");
    const out = await personalization.personaliseRecipients({
      ...tier2Input(personalization),
      config: { enabled: true, tier2AiHook: false },
    });
    expect(out.tiers).toEqual(["memory", "memory"]);
  });

  it("Tier 2 without the {{aiHook}} placeholder refuses before any call", async () => {
    const { provider, calls } = recordingProvider(goodHandler);
    const { tables, personalization } = build(factoryOf(provider));
    seedOrgA(tables);
    const err = await personalization.personaliseRecipients({
      ...tier2Input(personalization),
      body: "প্রিয় {{name}}, নতুন collection এসেছে।",
    }).catch((e) => e);
    expect(statusOf(err)).toBe(400);
    expect(String(err.message)).toContain("aiHook");
    expect(calls.length).toBe(0);
  });
});

describe("G2 config validation", () => {
  it("normalize: absent/disabled ⇒ null; Tier 2 + WhatsApp ⇒ 400; malformed ⇒ 400", () => {
    expect(normalizePersonalizationConfig(undefined, "email")).toBeNull();
    expect(normalizePersonalizationConfig({ enabled: false }, "email")).toBeNull();
    expect(normalizePersonalizationConfig({ enabled: true }, "whatsapp")).toEqual({ enabled: true, tier2AiHook: false });
    expect(() => normalizePersonalizationConfig({ enabled: true, tier2AiHook: true }, "whatsapp")).toThrow(/WhatsApp/);
    expect(() => normalizePersonalizationConfig("yes", "email")).toThrow();
  });

  it("createBroadcast refuses Tier 2 + WhatsApp and Tier 2 without the placeholder", async () => {
    const { provider } = recordingProvider(goodHandler);
    const { tables, svc } = build(factoryOf(provider));
    seedOrgA(tables);
    tables.whatsAppTemplate.rows.push({ id: "tpl-1", organizationId: "org-a", name: "promo", bodyText: "Hello {name}" });
    const waErr = await svc.createBroadcast("org-a", "user-1", {
      name: "WA", channel: "whatsapp", whatsappTemplateId: "tpl-1", audienceType: "customers",
      personalization: { enabled: true, tier2AiHook: true },
    }).catch((e) => e);
    expect(statusOf(waErr)).toBe(400);
    const phErr = await svc.createBroadcast("org-a", "user-1", {
      name: "EM", channel: "email", subject: "S", body: "প্রিয় {{name}}", audienceType: "customers",
      personalization: { enabled: true, tier2AiHook: true },
    }).catch((e) => e);
    expect(statusOf(phErr)).toBe(400);
    expect(String(phErr.message)).toContain("aiHook");
  });
});

describe("G2 MessagingService — preview == send, suppression first", () => {
  const PERSONALIZED = { enabled: true, tier2AiHook: true };

  it("the preview sample is byte-identical to what the prepared snapshot renders; suppressed recipients are never personalised", async () => {
    const { provider, calls } = recordingProvider(goodHandler);
    const { tables, svc } = build(factoryOf(provider));
    seedOrgA(tables);

    const broadcast = await svc.createBroadcast("org-a", "user-1", {
      name: "G2 launch", channel: "email", subject: "নতুন collection", body: BODY,
      audienceType: "customers", personalization: PERSONALIZED,
    });
    expect(broadcast.personalization).toEqual(PERSONALIZED);

    const preview = await svc.previewBroadcastPersonalisation("org-a", "user-1", {
      channel: "email", subject: "নতুন collection", body: BODY,
      audienceType: "customers", personalization: PERSONALIZED, sampleSize: 5,
    });
    // Suppression ran inside the shared resolver, BEFORE any
    // personalisation: the opted-out customer is excluded and
    // counted, and appears in no sample.
    expect(preview.excludedSuppressedCount).toBe(1);
    expect(preview.counts.total).toBe(3);
    expect(preview.counts.tier2Ai).toBe(2);
    expect(preview.counts.base).toBe(1);
    expect(preview.tier2LlmCallsProjected).toBe(2);
    expect(preview.tier2LlmCallsMadeForPreview).toBe(2);
    expect(preview.samples.map((s: any) => s.name)).not.toContain("Suppressed Person");
    // Zero LLM spend on the suppressed recipient: exactly the
    // two eligible included recipients were generated, and no
    // prompt ever carried the suppressed customer's identity.
    expect(calls.length).toBe(2);
    expect(JSON.stringify(calls)).not.toContain("Suppressed");
    expect(JSON.stringify(preview.samples)).not.toContain("suppressed@example.com");
    const sampleA = preview.samples.find((s: any) => s.name === "Ayesha Rahman")!;
    expect(sampleA.tier).toBe("ai");
    expect(sampleA.body).toContain("GammaSentinel Shoes Pro");
    expect(sampleA.body).not.toContain("BetaSentinel");
    // Sample addresses are masked (CX10 precedent).
    expect(sampleA.address).not.toContain("ayesha@example.com");

    const prepared = await svc.prepareBroadcast("org-a", broadcast.id);
    const snapshot = prepared.recipientSnapshot as any[];
    expect(snapshot.length).toBe(3);
    expect(snapshot.map((e) => e.id)).not.toContain("cust-sup");
    const entryA = snapshot.find((e) => e.id === "cust-a");
    const entryC = snapshot.find((e) => e.id === "cust-c");
    expect(entryA.personalTier).toBe("ai");
    expect(entryC.personalTier).toBe("base");
    // THE pin: preview body == the body this snapshot entry
    // renders through the pipeline's own merge.
    expect(renderPersonalizedBody(BODY, entryA, entryA.vars)).toBe(sampleA.body);
    expect(entryA.vars.aiHook).toBe(sampleA.body.split("\n")[0]);
    // Preview + prepare each generated the two eligible hooks.
    expect(calls.length).toBe(4);
  });

  it("a broadcast without personalisation prepares byte-identical legacy snapshots (no tier stamps)", async () => {
    const { provider, calls } = recordingProvider(goodHandler);
    const { tables, svc } = build(factoryOf(provider));
    seedOrgA(tables);
    const broadcast = await svc.createBroadcast("org-a", "user-1", {
      name: "Legacy", channel: "email", subject: "S", body: "প্রিয় {{name}}, শেষ কেনা: {{lastOrderNumber}}",
      audienceType: "customers",
    });
    const prepared = await svc.prepareBroadcast("org-a", broadcast.id);
    const snapshot = prepared.recipientSnapshot as any[];
    expect(snapshot.length).toBe(3); // suppressed still excluded by the legacy stages
    for (const e of snapshot) {
      expect(e.personalTier).toBeUndefined();
      expect(e.vars.lastProductName).toBeUndefined();
      expect(e.vars.aiHook).toBeUndefined();
    }
    expect(calls.length).toBe(0);
  });

  it("updateBroadcast validates the config against the MERGED body", async () => {
    const { provider } = recordingProvider(goodHandler);
    const { tables, svc } = build(factoryOf(provider));
    seedOrgA(tables);
    const broadcast = await svc.createBroadcast("org-a", "user-1", {
      name: "Edit me", channel: "email", subject: "S", body: "প্রিয় {{name}}",
      audienceType: "customers", personalization: { enabled: true },
    });
    const err = await svc.updateBroadcast("org-a", "user-1", broadcast.id, {
      personalization: { enabled: true, tier2AiHook: true },
    }).catch((e) => e);
    expect(statusOf(err)).toBe(400);
    const ok = await svc.updateBroadcast("org-a", "user-1", broadcast.id, {
      body: BODY, personalization: { enabled: true, tier2AiHook: true },
    });
    expect(ok.personalization).toEqual({ enabled: true, tier2AiHook: true });
    const off = await svc.updateBroadcast("org-a", "user-1", broadcast.id, { personalization: null });
    expect(off.personalization).toBeNull();
  });
});
