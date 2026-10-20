import { MessagingService, MESSAGING_AI_FEATURE } from "./messaging.service";
import {
  computeEngagementScore, predictiveSegmentsFor, isHeldOut, recipientHash,
  DEFAULT_ENGAGEMENT_THRESHOLDS,
} from "./engagement";
import { validateAudienceDefinition } from "./audience-rules";

/**
 * MX11 — predictive audiences & engagement score: the documented
 * deterministic formula on fixed fixtures (same inputs → same
 * score; zero history → the floor 0), the three rule-based
 * segments at their exact boundaries, the MS3 evaluator wiring
 * (engagement_score / predictive_segment conditions over REAL
 * delivery/click/order rows), the NL segment draft through the
 * MS9 guard path (kill switch / cap / invalid output → draft +
 * errors, NOTHING ever created), suppression suggestions
 * (viewing writes NOTHING; applying is a human action through
 * the real preference store + consent event), and the holdout
 * group (same hash bucket as A/B, held-out receive nothing,
 * resume never re-rolls, the report shows the held-out count).
 * Fake-prisma style like MX1/MS9.
 */
process.env.JWT_SECRET = ["mx11","test","secret"].join("-");
process.env.WEB_URL = "https://app.example.com";
process.env.API_PUBLIC_URL = "https://api.example.com";

const DAY = 86400000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

/** The A/B split's hash, re-implemented INLINE here so the
 * holdout expectations are computed independently of the code
 * under test (which must agree with this discipline). */
const hashOf = (key: string) => {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h;
};

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("not" in v) { const ok = v.not === null ? row[k] !== null && row[k] !== undefined : row[k] !== v.not; if (!ok) return false; }
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("gte" in v && !(new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      if ("lte" in v && !(new Date(row[k]).getTime() <= new Date(v.lte).getTime())) return false;
      if ("gt" in v && !(row[k] > v.gt)) return false;
      if ("lt" in v && !(row[k] < v.lt)) return false;
      if ("contains" in v && !String(row[k] ?? "").includes(v.contains)) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    return row[k] === v;
  });
}
function sortRows(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...rows];
  out.sort((a, b) => {
    for (const spec of specs) {
      for (const [key, dir] of Object.entries(spec)) {
        const av = a[key]; const bv = b[key];
        if (av === bv) continue;
        const cmp = av < bv ? -1 : 1;
        return dir === "desc" ? -cmp : cmp;
      }
    }
    return 0;
  });
  return out;
}
function project(row: any, select: any): any {
  if (!select) return row;
  const out: any = {};
  for (const k of Object.keys(select)) if (select[k]) out[k] = row[k];
  return out;
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where, select }: any = {}) => {
      const row = rows.find((r) => matches(r, where ?? {})) ?? null;
      return row ? project(row, select) : null;
    },
    findUnique: async ({ where, select }: any = {}) => {
      const row = rows.find((r) => matches(r, where ?? {})) ?? null;
      return row ? project(row, select) : null;
    },
    findMany: async ({ where, take, orderBy, cursor, skip, select }: any = {}) => {
      let out = sortRows(rows.filter((r) => matches(r, where ?? {})), orderBy);
      if (cursor?.id) {
        const pos = out.findIndex((r) => r.id === cursor.id);
        if (pos >= 0) out = out.slice(pos + (skip ?? 0));
      } else if (skip) out = out.slice(skip);
      if (take) out = out.slice(0, take);
      return out.map((r) => project(r, select));
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) { Object.assign(row, data); row.updatedAt = new Date(); } return row; },
    updateMany: async ({ where, data }: any) => { let n = 0; for (const row of rows) if (matches(row, where ?? {})) { Object.assign(row, data); n++; } return { count: n }; },
    deleteMany: async ({ where }: any) => { let n = 0; for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where ?? {})) { rows.splice(i, 1); n++; } return { count: n }; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); if (i >= 0) rows.splice(i, 1); return {}; },
  };
}
function makeRecipientTable() {
  const table: any = makeTable("bcr");
  table.createManyCalls = [];
  table.createMany = async ({ data, skipDuplicates }: any) => {
    table.createManyCalls.push(data.length);
    let count = 0;
    for (const d of data) {
      const dupe = table.rows.some((r: any) => r.broadcastId === d.broadcastId && r.dedupeKey === d.dedupeKey);
      if (dupe) { if (skipDuplicates) continue; throw new Error("Unique constraint failed"); }
      table.rows.push({ id: `bcr-${table.rows.length + 1}-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date(), updatedAt: new Date(), ...d });
      count++;
    }
    return { count };
  };
  return table;
}

function build(opts?: { llmFactory?: any; onSend?: (to: string, tables: any) => void; customerCount?: number }) {
  const tables: any = {
    messageTemplate: makeTable("tpl"), broadcast: makeTable("bc"), messageDelivery: makeTable("dlv"),
    customer: makeTable("cust"), lead: makeTable("lead"), whatsAppTemplate: makeTable("wa"),
    messagePreference: makeTable("pref"), messagingSetting: makeTable("mset"),
    messageConsentEvent: makeTable("cev"), messagingSavedAudience: makeTable("aud"),
    messageLinkClick: makeTable("clk"), broadcastRecipient: makeRecipientTable(),
    aIUsageRecord: makeTable("aiu"), messagingSenderConfig: makeTable("scfg"),
    businessProfile: makeTable("bp"), product: makeTable("prod"), integration: makeTable("int"),
  };
  const n = opts?.customerCount ?? 6;
  for (let i = 1; i <= n; i++) {
    tables.customer.rows.push({
      id: `c${i}`, organizationId: "org-1", firstName: `User${i}`, lastName: null,
      email: `user${i}@example.com`, phone: `017123456${String(i).padStart(2, "0")}`, createdAt: daysAgo(200),
    });
  }
  const settingValues: Record<string, unknown> = {};
  tables.systemSetting = {
    findUnique: async ({ where }: any) => (where.key in settingValues ? { key: where.key, value: settingValues[where.key] } : null),
  };
  const orgRow: any = { name: "Test Shop", timezone: "Asia/Dhaka", aiDailyLimitOverride: null, broadcastCapOverride: null, seatLimit: null };
  tables.organization = { findUnique: async () => orgRow };
  tables.subscription = { findFirst: async () => null };
  // Orders with the SC1 groupBy fake (computeOrderAggregates).
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
    findMany: async ({ where }: any = {}) => orderRows.filter((r) => matches(r, where ?? {})),
  };
  const calls: { to: string }[] = [];
  const email = {
    isConfigured: () => true,
    send: async ({ to }: any) => { calls.push({ to }); opts?.onSend?.(to, tables); return { providerMessageId: `<id-${to}>` }; },
  } as any;
  const sms = { isConfigured: () => true, send: async ({ to }: any) => ({ providerMessageId: `sms-${to}` }) } as any;
  const svc = new MessagingService(tables as any, { log: async () => undefined } as any, email, sms, opts?.llmFactory);
  return { svc, tables, calls, settingValues, orgRow };
}

const sentDelivery = (over: any) => ({
  organizationId: "org-1", broadcastId: "b-old", channel: "email", status: "sent",
  deliveryStatus: null, deliveredAt: null, readAt: null, openedAt: null, ...over,
});
const statusOf = (e: any) => (typeof e?.getStatus === "function" ? e.getStatus() : e?.status);

// ---------------------------------------------------------------- formula
describe("MX11 engagement formula (pure, fixed fixtures)", () => {
  const now = Date.now();
  const base = { sentCount: 0, deliveredOnlyCount: 0, openCount: 0, clickCount: 0, orderFrequency: 0, lastEngagementAt: null as number | null };

  it("zero history scores exactly the floor 0", () => {
    expect(computeEngagementScore(base, now)).toBe(0);
    expect(computeEngagementScore({ ...base, sentCount: 50 }, now)).toBe(0); // sends alone earn nothing
  });

  it("weights and caps are exactly as documented", () => {
    // 2 clicks (30) + 3 opens (24) + 3 delivered-only (12) + 3 orders (18) + recency 3d (16) = 100
    expect(computeEngagementScore({ ...base, clickCount: 2, openCount: 3, deliveredOnlyCount: 3, orderFrequency: 3, lastEngagementAt: now - 3 * DAY }, now)).toBe(100);
    // 1 of each + recency 20d (10) = 15+8+4+6+10 = 43
    expect(computeEngagementScore({ ...base, clickCount: 1, openCount: 1, deliveredOnlyCount: 1, orderFrequency: 1, lastEngagementAt: now - 20 * DAY }, now)).toBe(43);
    // caps: excess clicks/opens never exceed their maxima
    expect(computeEngagementScore({ ...base, clickCount: 99, openCount: 99, deliveredOnlyCount: 99, orderFrequency: 99 }, now)).toBe(30 + 24 + 12 + 18);
  });

  it("recency tiers are exact at the boundaries", () => {
    const at = (d: number) => computeEngagementScore({ ...base, clickCount: 1, lastEngagementAt: now - d * DAY }, now);
    expect(at(7)).toBe(15 + 16);
    expect(at(8)).toBe(15 + 10);
    expect(at(30)).toBe(15 + 10);
    expect(at(31)).toBe(15 + 5);
    expect(at(90)).toBe(15 + 5);
    expect(at(91)).toBe(15 + 0);
  });

  it("is deterministic: same inputs → same score", () => {
    const facts = { ...base, clickCount: 1, openCount: 2, orderFrequency: 2, lastEngagementAt: now - 5 * DAY };
    expect(computeEngagementScore(facts, now)).toBe(computeEngagementScore({ ...facts }, now));
  });
});

// ---------------------------------------------------------------- segments (pure)
describe("MX11 predictive segments (pure, boundary cases)", () => {
  const t = DEFAULT_ENGAGEMENT_THRESHOLDS;
  const segBase = {
    sentCount: 5, deliveredOnlyCount: 0, openCount: 0, clickCount: 0, orderFrequency: 0,
    lastEngagementAt: null as number | null, score: 0, totalSpentMinor: 0, isCustomer: true,
    daysSinceLastEngagement: null as number | null,
  };

  it("churn_risk: previously engaged + silent exactly at the threshold is IN, one day less is OUT", () => {
    const engaged = { ...segBase, openCount: 1, lastEngagementAt: 1 };
    expect(predictiveSegmentsFor({ ...engaged, daysSinceLastEngagement: t.churnRiskSilentDays }, t)).toContain("churn_risk");
    expect(predictiveSegmentsFor({ ...engaged, daysSinceLastEngagement: t.churnRiskSilentDays - 1 }, t)).not.toContain("churn_risk");
  });

  it("churn_risk: never engaged is OUT however long the silence", () => {
    expect(predictiveSegmentsFor({ ...segBase, daysSinceLastEngagement: null }, t)).not.toContain("churn_risk");
    expect(predictiveSegmentsFor({ ...segBase, daysSinceLastEngagement: 9999 }, t)).not.toContain("churn_risk");
  });

  it("likely_to_buy: score exactly at the threshold + recent engagement is IN; below score or stale is OUT", () => {
    const hot = { ...segBase, clickCount: 2, score: t.likelyToBuyMinScore, daysSinceLastEngagement: 30 };
    expect(predictiveSegmentsFor(hot, t)).toContain("likely_to_buy");
    expect(predictiveSegmentsFor({ ...hot, score: t.likelyToBuyMinScore - 1 }, t)).not.toContain("likely_to_buy");
    expect(predictiveSegmentsFor({ ...hot, daysSinceLastEngagement: 31 }, t)).not.toContain("likely_to_buy");
  });

  it("high_ltv: exact threshold spend + 2 orders is IN; one minor less, one order, or a lead is OUT", () => {
    const rich = { ...segBase, orderFrequency: 2, totalSpentMinor: t.highLtvMinSpentMinor };
    expect(predictiveSegmentsFor(rich, t)).toContain("high_ltv");
    expect(predictiveSegmentsFor({ ...rich, totalSpentMinor: t.highLtvMinSpentMinor - 1 }, t)).not.toContain("high_ltv");
    expect(predictiveSegmentsFor({ ...rich, orderFrequency: 1 }, t)).not.toContain("high_ltv");
    expect(predictiveSegmentsFor({ ...rich, isCustomer: false }, t)).not.toContain("high_ltv");
  });

  it("evaluator validation accepts the new fields and rejects an unknown predictive segment", () => {
    expect(validateAudienceDefinition({ entity: "customers", match: "all", conditions: [{ field: "engagement_score", op: "gte", value: 40 }] }).conditions).toHaveLength(1);
    expect(validateAudienceDefinition({ entity: "leads", match: "all", conditions: [{ field: "predictive_segment", op: "eq", value: "churn_risk" }] }).conditions).toHaveLength(1);
    expect(() => validateAudienceDefinition({ entity: "customers", match: "all", conditions: [{ field: "predictive_segment", op: "eq", value: "banana" }] })).toThrow(/predictive_segment must be one of/);
  });
});

// ---------------------------------------------------------------- evaluator wiring
describe("MX11 evaluator wiring over real rows", () => {
  function seedEngagement(tables: any) {
    // c1: strongly engaged — 2 opens + 2 clicks, recent.
    tables.messageDelivery.rows.push(
      sentDelivery({ recipientType: "customer", recipientId: "c1", createdAt: daysAgo(2), openedAt: daysAgo(2) }),
      sentDelivery({ recipientType: "customer", recipientId: "c1", createdAt: daysAgo(1), openedAt: daysAgo(1) }),
    );
    tables.messageLinkClick.rows.push(
      { id: "k1", organizationId: "org-1", broadcastId: "b-old", recipientKey: "customer:c1", url: "https://x", createdAt: daysAgo(1) },
      { id: "k2", organizationId: "org-1", broadcastId: "b-old", recipientKey: "customer:c1", url: "https://x", createdAt: daysAgo(1) },
    );
    // c2: engaged once, 120 days ago → churn risk; nothing since.
    tables.messageDelivery.rows.push(
      sentDelivery({ recipientType: "customer", recipientId: "c2", createdAt: daysAgo(120), openedAt: daysAgo(120) }),
    );
    // c3: orders only — 2 orders totalling exactly the LTV threshold, last one 100 days ago.
    tables.order.rows.push(
      { id: "o1", organizationId: "org-1", customerId: "c3", status: "delivered", totalMinor: 300000, placedAt: daysAgo(110), createdAt: daysAgo(110) },
      { id: "o2", organizationId: "org-1", customerId: "c3", status: "delivered", totalMinor: 200000, placedAt: daysAgo(100), createdAt: daysAgo(100) },
    );
    // c4..c6: no history at all.
  }

  it("engagement_score condition resolves from delivery/click rows; zero history is a real 0", async () => {
    const { svc, tables } = build();
    seedEngagement(tables);
    const hot = await svc.resolveBroadcastRecipients("org-1", {
      channel: "email", audienceType: "custom",
      audienceDefinition: { entity: "customers", match: "all", conditions: [{ field: "engagement_score", op: "gte", value: 40 }] },
    } as any);
    expect(hot.recipients.map((r) => r.id)).toEqual(["c1"]); // 30 clicks + 16 opens + 16 recency = 62
    const floor = await svc.resolveBroadcastRecipients("org-1", {
      channel: "email", audienceType: "custom",
      audienceDefinition: { entity: "customers", match: "all", conditions: [{ field: "engagement_score", op: "eq", value: 0 }] },
    } as any);
    expect(floor.recipients.map((r) => r.id).sort()).toEqual(["c4", "c5", "c6"]);
  });

  it("predictive_segment conditions resolve churn_risk and high_ltv from real records", async () => {
    const { svc, tables } = build();
    seedEngagement(tables);
    const churn = await svc.resolveBroadcastRecipients("org-1", {
      channel: "email", audienceType: "custom",
      audienceDefinition: { entity: "customers", match: "all", conditions: [{ field: "predictive_segment", op: "eq", value: "churn_risk" }] },
    } as any);
    expect(churn.recipients.map((r) => r.id).sort()).toEqual(["c2", "c3"]); // c3's last order was 100 days ago
    const ltv = await svc.resolveBroadcastRecipients("org-1", {
      channel: "email", audienceType: "custom",
      audienceDefinition: { entity: "customers", match: "all", conditions: [{ field: "predictive_segment", op: "eq", value: "high_ltv" }] },
    } as any);
    expect(ltv.recipients.map((r) => r.id)).toEqual(["c3"]);
  });

  it("the engagement report shows the formula, the rule-based label and per-contact evidence", async () => {
    const { svc, tables } = build();
    seedEngagement(tables);
    const report: any = await svc.getEngagementReport("org-1");
    expect(report.label).toBe("rule-based estimate");
    expect(report.formula).toContain("15 points each");
    expect(report.segmentCounts).toMatchObject({ churn_risk: 2, high_ltv: 1 });
    const c1 = report.rows.find((r: any) => r.id === "c1");
    expect(c1.score).toBe(62);
    expect(c1.clickCount).toBe(2);
    expect(report.zeroHistoryContacts).toBe(3);
  });

  it("thresholds are org-configurable through the MessagingSetting pattern", async () => {
    const { svc } = build();
    expect((await svc.getEngagementThresholds("org-1")).churnRiskSilentDays).toBe(60);
    const updated: any = await svc.updateMessagingSetting("org-1", "u1", { churnRiskSilentDays: 30, likelyToBuyMinScore: 45 });
    expect(updated.churnRiskSilentDays).toBe(30);
    expect((await svc.getEngagementThresholds("org-1")).likelyToBuyMinScore).toBe(45);
    await expect(svc.updateMessagingSetting("org-1", "u1", { churnRiskSilentDays: 0 })).rejects.toThrow(/churnRiskSilentDays/);
  });
});

// ---------------------------------------------------------------- NL draft
describe("MX11 NL segment draft (MS9 guard path, returned-only)", () => {
  const providerOf = (text: string, counter?: { calls: number }) => ({
    name: "openai", isRealLlm: true,
    complete: async () => { if (counter) counter.calls++; return { text, model: "gpt-test", inputTokens: 11, outputTokens: 22, tokensEstimated: false }; },
  });
  const factoryOf = (provider: any) => ({ getProvider: () => provider });

  it("kill switch ⇒ 403, provider never called, no audience created", async () => {
    const counter = { calls: 0 };
    const { svc, tables, settingValues } = build({ llmFactory: factoryOf(providerOf("{}", counter)) });
    settingValues.killSwitches = { aiDisabledOrgIds: ["org-1"], broadcastsPaused: false };
    await expect(svc.draftSegmentFromDescription("org-1", "u1", { description: "যারা ৩ বার কিনেছে" })).rejects.toMatchObject({});
    try { await svc.draftSegmentFromDescription("org-1", "u1", { description: "x" }); } catch (e: any) { expect(statusOf(e)).toBe(403); }
    expect(counter.calls).toBe(0);
    expect(tables.messagingSavedAudience.rows).toHaveLength(0);
  });

  it("daily cap reached ⇒ 429 before any provider call", async () => {
    const counter = { calls: 0 };
    const { svc, tables, orgRow } = build({ llmFactory: factoryOf(providerOf("{}", counter)) });
    orgRow.aiDailyLimitOverride = 1; // the MS9 spec's cap discipline
    tables.aIUsageRecord.rows.push({ id: "u-0", organizationId: "org-1", feature: MESSAGING_AI_FEATURE, createdAt: new Date() });
    const err = await svc.draftSegmentFromDescription("org-1", "u1", { description: "x" }).catch((e) => e);
    expect(statusOf(err)).toBe(429);
    expect(counter.calls).toBe(0);
    expect(tables.messagingSavedAudience.rows).toHaveLength(0);
  });

  it("a valid AI rule returns as a draft — nothing is saved until a human uses the saved-audience path", async () => {
    const aiJson = JSON.stringify({ entity: "customers", match: "all", conditions: [{ field: "orders_count", op: "gte", value: 3 }] });
    const { svc, tables } = build({ llmFactory: factoryOf(providerOf(aiJson)) });
    const res: any = await svc.draftSegmentFromDescription("org-1", "u1", { description: "কমপক্ষে ৩ বার অর্ডার করেছে এমন কাস্টমার" });
    expect(res.valid).toBe(true);
    expect(res.draft).toEqual({ entity: "customers", match: "all", conditions: [{ field: "orders_count", op: "gte", value: 3 }] });
    expect(tables.messagingSavedAudience.rows).toHaveLength(0);
    expect(tables.aIUsageRecord.rows).toHaveLength(1);
    // The human confirm path is the EXISTING saved-audience create:
    const saved = await svc.createSavedAudience("org-1", "u1", { name: "3+ orders", definition: res.draft });
    expect(saved.name).toBe("3+ orders");
    expect(tables.messagingSavedAudience.rows).toHaveLength(1);
  });

  it("an invalid AI rule surfaces as an editable draft WITH errors — never corrected, never applied", async () => {
    const aiJson = JSON.stringify({ entity: "customers", match: "all", conditions: [{ field: "favorite_color", op: "eq", value: "red" }] });
    const { svc, tables } = build({ llmFactory: factoryOf(providerOf(aiJson)) });
    const res: any = await svc.draftSegmentFromDescription("org-1", "u1", { description: "লাল রং পছন্দ করে" });
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toContain("favorite_color");
    expect(res.draft.conditions[0].field).toBe("favorite_color"); // verbatim, not silently fixed
    expect(tables.messagingSavedAudience.rows).toHaveLength(0);
  });

  it("unparseable AI output ⇒ draft null + raw text + errors, nothing created", async () => {
    const { svc, tables } = build({ llmFactory: factoryOf(providerOf("sure, here is your segment!")) });
    const res: any = await svc.draftSegmentFromDescription("org-1", "u1", { description: "ভালো কাস্টমার" });
    expect(res.valid).toBe(false);
    expect(res.draft).toBeNull();
    expect(res.rawText).toContain("sure");
    expect(res.errors.length).toBeGreaterThan(0);
    expect(tables.messagingSavedAudience.rows).toHaveLength(0);
  });

  it("no real LLM configured ⇒ honest 502, no audience created", async () => {
    const dev = { name: "dev-template", isRealLlm: false, complete: async () => { throw new Error("must not be called for output"); } };
    const { svc, tables } = build({ llmFactory: factoryOf(dev) });
    try {
      await svc.draftSegmentFromDescription("org-1", "u1", { description: "x" });
      throw new Error("should have thrown");
    } catch (e: any) { expect(statusOf(e)).toBe(502); }
    expect(tables.messagingSavedAudience.rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- suppression suggestions
describe("MX11 suppression suggestions (never auto-applied)", () => {
  function seed(tables: any) {
    // c1: 4 sends, last engagement (open) 120 days ago, 3 sends since.
    tables.messageDelivery.rows.push(
      sentDelivery({ recipientType: "customer", recipientId: "c1", createdAt: daysAgo(120), openedAt: daysAgo(120) }),
      sentDelivery({ recipientType: "customer", recipientId: "c1", createdAt: daysAgo(100) }),
      sentDelivery({ recipientType: "customer", recipientId: "c1", createdAt: daysAgo(50) }),
      sentDelivery({ recipientType: "customer", recipientId: "c1", createdAt: daysAgo(10) }),
    );
    // c2: 4 sends but engaged 5 days ago → not suggested.
    tables.messageDelivery.rows.push(
      sentDelivery({ recipientType: "customer", recipientId: "c2", createdAt: daysAgo(40) }),
      sentDelivery({ recipientType: "customer", recipientId: "c2", createdAt: daysAgo(30) }),
      sentDelivery({ recipientType: "customer", recipientId: "c2", createdAt: daysAgo(20) }),
      sentDelivery({ recipientType: "customer", recipientId: "c2", createdAt: daysAgo(5), openedAt: daysAgo(5) }),
    );
    // c3: never engaged, only 2 sends → below min sends, not suggested.
    tables.messageDelivery.rows.push(
      sentDelivery({ recipientType: "customer", recipientId: "c3", createdAt: daysAgo(100) }),
      sentDelivery({ recipientType: "customer", recipientId: "c3", createdAt: daysAgo(95) }),
    );
    // lead l1: never engaged, 3 sends long ago → suggested with lastEngagementAt null.
    tables.lead.rows.push({ id: "l1", organizationId: "org-1", name: "Dormant Lead", email: "dormant@example.com", phone: "01799999999", createdAt: daysAgo(200), stage: "new", tags: [] });
    tables.messageDelivery.rows.push(
      sentDelivery({ recipientType: "lead", recipientId: "l1", createdAt: daysAgo(100) }),
      sentDelivery({ recipientType: "lead", recipientId: "l1", createdAt: daysAgo(95) }),
      sentDelivery({ recipientType: "lead", recipientId: "l1", createdAt: daysAgo(92) }),
    );
  }

  it("lists long-unengaged contacts with evidence — and viewing writes NOTHING", async () => {
    const { svc, tables } = build();
    seed(tables);
    const res: any = await svc.listSuppressionSuggestions("org-1");
    const byId = new Map<string, any>(res.suggestions.map((s: any) => [s.id, s]));
    expect([...byId.keys()].sort()).toEqual(["c1", "l1"]);
    expect(byId.get("c1")).toMatchObject({ totalSends: 4, sendsSinceLastEngagement: 3, daysSinceLastEngagement: 120 });
    expect(byId.get("l1").lastEngagementAt).toBeNull();
    expect(byId.get("l1").sendsSinceLastEngagement).toBe(3);
    expect(res.label).toBe("rule-based estimate");
    // The read was a pure read: no preference, no consent event.
    expect(tables.messagePreference.rows).toHaveLength(0);
    expect(tables.messageConsentEvent.rows).toHaveLength(0);
  });

  it("applying is a human action through the real preference store (+ consent event), enforced at resolve", async () => {
    const { svc, tables } = build();
    seed(tables);
    const out: any = await svc.applySuppressionSuggestions("org-1", "u1", { channel: "email", items: [{ type: "customer", id: "c1" }] });
    expect(out.applied).toBe(1);
    const pref = tables.messagePreference.rows.find((r: any) => r.address === "user1@example.com");
    expect(pref).toMatchObject({ status: "opted_out", source: "manual", channel: "email" });
    expect(tables.messageConsentEvent.rows.some((e: any) => e.toStatus === "opted_out" && e.actor === "user:u1")).toBe(true);
    const resolved = await svc.resolveBroadcastRecipients("org-1", { channel: "email", audienceType: "customers" });
    expect(resolved.recipients.map((r) => r.id)).not.toContain("c1");
    expect(resolved.excludedSuppressedCount).toBe(1);
    // Re-applying reports a skip, never a fake success.
    const again: any = await svc.applySuppressionSuggestions("org-1", "u1", { channel: "email", items: [{ type: "customer", id: "c1" }] });
    expect(again.applied).toBe(0);
    expect(again.skipped[0].reason).toContain("Already opted out");
  });
});

// ---------------------------------------------------------------- holdout
describe("MX11 holdout (same hash bucket as A/B)", () => {
  const IDS = Array.from({ length: 20 }, (_, i) => `c${i + 1}`);
  const heldIds = (pct: number) => IDS.filter((id) => hashOf(`customer:${id}`) % 100 < pct);

  it("isHeldOut agrees with the inline A/B hash discipline and is deterministic", () => {
    for (const pct of [10, 25, 50]) {
      for (const id of IDS) {
        const key = `customer:${id}`;
        expect(isHeldOut(key, pct)).toBe(hashOf(key) % 100 < pct);
        expect(isHeldOut(key, pct)).toBe(isHeldOut(key, pct));
        expect(recipientHash(key)).toBe(hashOf(key));
      }
    }
    expect(IDS.every((id) => !isHeldOut(`customer:${id}`, 0))).toBe(true);
    expect(IDS.every((id) => !isHeldOut(`customer:${id}`, null))).toBe(true);
  });

  it("create validates the percentage strictly", async () => {
    const { svc } = build();
    for (const bad of [0, 51, 10.5]) {
      await expect(svc.createBroadcast("org-1", "u1", { name: "X", channel: "email", subject: "s", body: "b", audienceType: "customers", holdoutPercent: bad } as any))
        .rejects.toThrow(/holdoutPercent/);
    }
  });

  it("prepare holds out exactly the hash bucket; held-out receive nothing; the report shows the count", async () => {
    const { svc, tables, calls } = build({ customerCount: 20 });
    const held = heldIds(50);
    const kept = IDS.filter((id) => !held.includes(id));
    expect(held.length).toBeGreaterThan(0);
    expect(kept.length).toBeGreaterThan(0);
    const bc = await svc.createBroadcast("org-1", "u1", { name: "Holdout mail", channel: "email", subject: "Hi", body: "Hello {{name}}", audienceType: "customers", holdoutPercent: 50 } as any);
    const prepared: any = await svc.prepareBroadcast("org-1", bc.id);
    expect(prepared.holdoutCount).toBe(held.length);
    expect(prepared.totalRecipients).toBe(kept.length);
    const rowIds = tables.broadcastRecipient.rows.filter((r: any) => r.broadcastId === bc.id).map((r: any) => r.recipientId).sort();
    expect(rowIds).toEqual([...kept].sort());
    // Preview agrees with prepare (same bucket).
    const preview: any = await svc.previewBroadcast("org-1", { channel: "email", audienceType: "customers", holdoutPercent: 50 } as any);
    expect(preview.excludedHoldoutCount).toBe(held.length);
    expect(preview.total).toBe(kept.length);
    // Send: the provider only ever sees kept addresses.
    await svc.sendBroadcast("org-1", "u1", bc.id);
    const emailed = new Set(calls.map((c) => c.to));
    for (const id of held) expect(emailed.has(`user${id.slice(1)}@example.com`)).toBe(false);
    expect(calls).toHaveLength(kept.length);
    expect(tables.messageDelivery.rows.filter((d: any) => held.includes(d.recipientId))).toHaveLength(0);
    // Report carries the held-out count.
    const report: any = await svc.getBroadcastReport("org-1", bc.id);
    expect(report.holdout).toMatchObject({ percent: 50, heldOutCount: held.length });
  });

  it("a paused + resumed send does NOT re-roll the holdout (frozen recipient rows)", async () => {
    let sent = 0;
    const { svc, tables, calls } = build({
      customerCount: 20,
      onSend: (_to, t) => { sent++; if (sent === 2) t.broadcast.rows[0].status = "paused"; },
    });
    const held = new Set(heldIds(50));
    const bc = await svc.createBroadcast("org-1", "u1", { name: "Resume mail", channel: "email", subject: "Hi", body: "Hello {{name}}", audienceType: "customers", holdoutPercent: 50 } as any);
    await svc.prepareBroadcast("org-1", bc.id);
    const rowsBefore = tables.broadcastRecipient.rows.filter((r: any) => r.broadcastId === bc.id).map((r: any) => r.recipientId).sort();
    const partial = await svc.processBroadcast("org-1", bc.id, { chunkSize: 2 });
    expect(partial.stopped).toBe("paused");
    // Re-preparing is refused outright — the set is frozen.
    await expect(svc.prepareBroadcast("org-1", bc.id)).rejects.toMatchObject({ code: "messaging.thisBroadcastWasAlreadySentOr" });
    const resumed: any = await svc.resumeBroadcast("org-1", "u1", bc.id);
    expect(resumed.status).toBe("sent");
    const rowsAfter = tables.broadcastRecipient.rows.filter((r: any) => r.broadcastId === bc.id).map((r: any) => r.recipientId).sort();
    expect(rowsAfter).toEqual(rowsBefore);
    expect(rowsAfter.some((id: string) => held.has(id))).toBe(false);
    // Every kept contact got exactly one send across pause+resume; held-out got none.
    expect(calls).toHaveLength(rowsBefore.length);
    expect(tables.messageDelivery.rows.filter((d: any) => held.has(d.recipientId))).toHaveLength(0);
  });

  it("A/B + holdout compose: variants are disjoint, cover the non-held-out set, and share the one holdout bucket", async () => {
    const { svc, tables } = build({ customerCount: 20 });
    const held = new Set(heldIds(50));
    const res: any = await svc.createBroadcast("org-1", "u1", {
      name: "AB holdout", channel: "email", subject: "A subject", body: "A body",
      audienceType: "customers", abTest: true, abSubject: "B subject", abBody: "B body", holdoutPercent: 50,
    } as any);
    const [a, b] = res.variants;
    expect(a.holdoutPercent).toBe(50);
    await svc.prepareBroadcast("org-1", a.id);
    await svc.prepareBroadcast("org-1", b.id);
    const aIds = new Set(tables.broadcastRecipient.rows.filter((r: any) => r.broadcastId === a.id).map((r: any) => r.recipientId));
    const bIds = new Set(tables.broadcastRecipient.rows.filter((r: any) => r.broadcastId === b.id).map((r: any) => r.recipientId));
    // Disjoint variants…
    expect([...aIds].filter((id) => bIds.has(id))).toHaveLength(0);
    // …covering exactly the non-held-out audience…
    const union = new Set([...aIds, ...bIds]);
    expect([...union].sort()).toEqual(IDS.filter((id) => !held.has(id)).sort());
    // …split by the same hash parity the pre-MX11 A/B code uses…
    for (const id of aIds) expect(hashOf(`customer:${id}`) % 2).toBe(0);
    for (const id of bIds) expect(hashOf(`customer:${id}`) % 2).toBe(1);
    // …and both variant rows record the pair's shared held-out count.
    expect(tables.broadcast.rows.find((r: any) => r.id === a.id).holdoutCount).toBe(held.size);
    expect(tables.broadcast.rows.find((r: any) => r.id === b.id).holdoutCount).toBe(held.size);
  });
});
