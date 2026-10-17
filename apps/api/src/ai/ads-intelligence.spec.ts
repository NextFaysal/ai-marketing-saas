import { AdsIntelligenceService, ADS_CAMPAIGN_RANK_MIN_SPEND_MINOR } from "./ads-intelligence.service";
import { AdsIntelligenceController } from "./ads-intelligence.controller";
import { PerformanceLearningService } from "./performance-learning.service";
import { LearningService } from "./learning.service";
import { OrgBrainService } from "./org-brain.service";

/**
 * SA-B14 (Smart AI Phase 3, A1) — Ads Report Intelligence guarantees:
 *  - the digest's numbers equal hand-computed fixtures (totals,
 *    per-platform split, period-over-period deltas) and AGREE
 *    with SA-B5's PerformanceSnapshot ads section on the same
 *    rows (single computation rule: campaign-level rows,
 *    calendar-aligned UTC windows);
 *  - the ROAS ranking floor keeps a tiny-spend/high-ROAS campaign
 *    out of the top list (counted, never hidden), and the bottom
 *    list is empty when three or fewer campaigns qualify;
 *  - budget pacing exists ONLY when a BusinessProfile budget is
 *    set — absent budget = the section says so, never a target;
 *  - anomaly flags fire on crafted deltas at their NAMED
 *    thresholds and stay silent on thin data / missing prior;
 *  - guarded narration: a mocked LLM that invents a number gets
 *    its narration dropped WHOLE (facts intact, usage recorded);
 *    a faithful narration passes verbatim; no provider = an
 *    honest null + note;
 *  - the Brain: ads digest reaches INTERNAL contexts only —
 *    customer and own_customer contexts contain no ads sentinel;
 *  - ads LearnedItems are SUGGESTED-only and approval forces
 *    INTERNAL even when "public" is requested (law L3, SA-B5 rule);
 *  - cross-org isolation on the digest, the findings sweep and
 *    the API controller.
 * All doubles below are TEST doubles; production code contains
 * no fabricated data paths.
 */

// ---------- in-memory fake prisma (SA-B5 pattern, full operators) ----------
function cmpVal(v: any): any {
  return v instanceof Date ? v.getTime() : v;
}
function condMatch(val: any, cond: any): boolean {
  if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
    for (const [op, operand] of Object.entries(cond)) {
      if (op === "gt" && !(cmpVal(val) > cmpVal(operand))) return false;
      if (op === "gte" && !(cmpVal(val) >= cmpVal(operand))) return false;
      if (op === "lt" && !(cmpVal(val) < cmpVal(operand))) return false;
      if (op === "lte" && !(cmpVal(val) <= cmpVal(operand))) return false;
      if (op === "in" && !(operand as any[]).some((x) => cmpVal(x) === cmpVal(val))) return false;
      if (op === "notIn" && (operand as any[]).some((x) => cmpVal(x) === cmpVal(val))) return false;
      if (op === "not") {
        if (operand !== null && typeof operand === "object") {
          if (condMatch(val, operand)) return false;
        } else if (cmpVal(val) === cmpVal(operand)) return false;
      }
    }
    return true;
  }
  return cmpVal(val) === cmpVal(cond);
}
function matchesWhere(row: any, where: any): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === "OR") {
      if (!(cond as any[]).some((c) => matchesWhere(row, c))) return false;
      continue;
    }
    if (key === "AND") {
      if (!(cond as any[]).every((c) => matchesWhere(row, c))) return false;
      continue;
    }
    if (key.includes("_")) {
      const c = cond as any;
      let ok = true;
      for (const part of key.split("_")) {
        if (cmpVal(row[part]) !== cmpVal(c?.[part])) ok = false;
      }
      if (!ok) return false;
      continue;
    }
    if (!condMatch(row[key], cond)) return false;
  }
  return true;
}
function applyOrder(rows: any[], orderBy: any): any[] {
  const specs = (Array.isArray(orderBy) ? orderBy : [orderBy]).filter(Boolean);
  const out = [...rows];
  for (let i = specs.length - 1; i >= 0; i--) {
    const [field, dir] = Object.entries(specs[i])[0] as [string, string];
    out.sort((a, b) => {
      const av = cmpVal(a[field]) ?? 0;
      const bv = cmpVal(b[field]) ?? 0;
      return dir === "desc" ? (bv > av ? 1 : bv < av ? -1 : 0) : av > bv ? 1 : av < bv ? -1 : 0;
    });
  }
  return out;
}
const TABLE_NAMES = [
  "businessProfile", "organization", "businessPolicy", "knowledgeDocument",
  "performanceSnapshot", "aiBrandVoiceProfile", "customerMemory", "learnedItem",
  "learningState", "channelConversation", "channelMessage", "order", "orderItem",
  "dailyAdMetric", "adCampaign", "broadcast", "messageDelivery", "socialPost",
  "returnRequest", "orderReview", "product", "aIUsageRecord", "aiStoredAnswer",
  "orgLlmConfig", "auditLog", "systemSetting",
] as const;
function makeFakePrisma() {
  let seq = 0;
  const nid = () => `fake-${++seq}`;
  const tables: Record<string, any[]> = {};
  for (const n of TABLE_NAMES) tables[n] = [];
  const defaults: Record<string, any> = {
    learnedItem: { status: "suggested" },
    aiBrandVoiceProfile: { status: "suggested" },
    customerMemory: { orderCount: 0, topics: [], notes: [] },
  };
  const model = (name: string) => ({
    findMany: async (args: any = {}) => {
      let rows = tables[name].filter((r) => matchesWhere(r, args.where));
      if (args.orderBy) rows = applyOrder(rows, args.orderBy);
      if (args.skip) rows = rows.slice(args.skip);
      if (args.take) rows = rows.slice(0, args.take);
      return rows;
    },
    findFirst: async (args: any = {}) => {
      let rows = tables[name].filter((r) => matchesWhere(r, args.where));
      if (args.orderBy) rows = applyOrder(rows, args.orderBy);
      return rows[0] ?? null;
    },
    findUnique: async (args: any = {}) => {
      const rows = tables[name].filter((r) => matchesWhere(r, args.where));
      return rows[0] ?? null;
    },
    count: async (args: any = {}) => tables[name].filter((r) => matchesWhere(r, args.where)).length,
    create: async (args: any) => {
      const row = { id: nid(), createdAt: new Date(), updatedAt: new Date(), ...(defaults[name] ?? {}), ...args.data };
      tables[name].push(row);
      return row;
    },
    update: async (args: any) => {
      const row = tables[name].find((r) => r.id === args.where.id);
      if (!row) throw new Error("record not found");
      Object.assign(row, args.data, { updatedAt: new Date() });
      return row;
    },
    upsert: async (args: any) => {
      const existing = tables[name].find((r) => matchesWhere(r, args.where));
      if (existing) {
        Object.assign(existing, args.update, { updatedAt: new Date() });
        return existing;
      }
      const row = { id: nid(), createdAt: new Date(), updatedAt: new Date(), ...(defaults[name] ?? {}), ...args.create };
      tables[name].push(row);
      return row;
    },
    delete: async (args: any) => {
      const idx = tables[name].findIndex((r) => r.id === args.where.id);
      if (idx < 0) throw new Error("record not found");
      return tables[name].splice(idx, 1)[0];
    },
  });
  const prisma: any = { $queryRaw: async () => [] };
  for (const n of TABLE_NAMES) prisma[n] = model(n);
  prisma.__tables = tables;
  return prisma;
}

const NOW = new Date("2026-10-17T12:00:00.000Z");
const D = (iso: string) => new Date(iso);
const A = "org-a";
const B = "org-b";
const C = "org-c";
const DD = "org-d";
const E = "org-e";
const F = "org-f";
const G = "org-g";

function profileRow(org: string, over: any = {}): any {
  return {
    organizationId: org, industry: "Fashion", description: "A clothing shop", brandVoice: null,
    websiteUrl: null, goals: null, monthlyBudgetMinor: null, budgetCurrency: null,
    targetCustomers: null, businessModel: null, uniqueSellingPoints: null, tradeLicenseNo: null,
    billingEmails: null, deliveryChargeInsideMinor: BigInt(6000), deliveryChargeOutsideMinor: BigInt(12000),
    codAvailable: true, bkashNumber: "01700000000", contactPhone: "01700000000", contactEmail: "a@example.test",
    aiInstructions: null, aiReplyLanguage: null,
    conversationLearningEnabled: false, websiteLearningEnabled: true, answerStoreEnabled: true, ...over,
  };
}

function metricRow(over: any): any {
  return {
    adAccountId: "acc1", adCampaignId: null, campaignExternalId: "", campaignName: "",
    adSetExternalId: "", adExternalId: "", platform: "meta", source: "api",
    impressions: 0, clicks: 0, reach: 0, videoViews: 0,
    platformConversions: 0, platformConversionValueMinor: BigInt(0), currency: "BDT",
    spendMinor: BigInt(0), ...over,
  };
}

/**
 * Org A fixture — hand-computed expectations (7d window
 * [2026-10-11, 2026-10-18); prior [2026-10-04, 2026-10-11)):
 *  current: spend 370000, imp 18400, clicks 830, CTR 4.51,
 *           conv 35, value 1120000, ROAS 3.03
 *  prior:   spend 200000, imp 11500, clicks 525, CTR 4.57,
 *           conv 17, value 550000, ROAS 2.75
 *  deltas:  spend +85%, conv +105.88%, ROAS +10.18%, CTR -1.31%
 *  meta:    spend 310000, ROAS 3.23, conv 32 · google: 60000, 2, 3
 *  ranking: M1 (spend 300000, ROAS 3) > G1 (60000, 2); TINY
 *           (10000 spend, ROAS 10) is below the floor → counted.
 *  pacing:  budget 1000000; MTD (all fixture rows are October)
 *           570000; expected by day 17/31 = 548387; pace 104%;
 *           projected 1039412.
 *  anomaly: spend_spike only (+85% ≥ 50% and ≥ ৳1,000 floor).
 */
function seedOrgA(prisma: any) {
  const t = prisma.__tables;
  t.organization.push({ id: A, name: "Shop A" });
  t.businessProfile.push(profileRow(A, { monthlyBudgetMinor: BigInt(1000000), budgetCurrency: "BDT" }));
  t.dailyAdMetric.push(
    metricRow({ id: "a1", organizationId: A, campaignExternalId: "camp-M1", campaignName: "Winter Sale SENTINELWINTER", date: D("2026-10-12T00:00:00Z"), spendMinor: BigInt(200000), impressions: 10000, clicks: 500, platformConversions: 20, platformConversionValueMinor: BigInt(600000) }),
    metricRow({ id: "a2", organizationId: A, campaignExternalId: "camp-M1", campaignName: "Winter Sale SENTINELWINTER", date: D("2026-10-15T00:00:00Z"), spendMinor: BigInt(100000), impressions: 5000, clicks: 200, platformConversions: 10, platformConversionValueMinor: BigInt(300000) }),
    metricRow({ id: "a3", organizationId: A, platform: "google", campaignExternalId: "camp-G1", campaignName: "Search Push", date: D("2026-10-13T00:00:00Z"), spendMinor: BigInt(60000), impressions: 3000, clicks: 90, platformConversions: 3, platformConversionValueMinor: BigInt(120000) }),
    metricRow({ id: "a4", organizationId: A, campaignExternalId: "camp-TINY", campaignName: "Tiny Test", date: D("2026-10-14T00:00:00Z"), spendMinor: BigInt(10000), impressions: 400, clicks: 40, platformConversions: 2, platformConversionValueMinor: BigInt(100000) }),
    // ad-level + ad-set rows — excluded from EVERY campaign sum.
    metricRow({ id: "a5", organizationId: A, campaignExternalId: "camp-M1", campaignName: "Winter Sale SENTINELWINTER", adExternalId: "ad-1", date: D("2026-10-12T00:00:00Z"), spendMinor: BigInt(999999), impressions: 99999, clicks: 9999, platformConversions: 99, platformConversionValueMinor: BigInt(999999) }),
    metricRow({ id: "a6", organizationId: A, campaignExternalId: "camp-M1", campaignName: "Winter Sale SENTINELWINTER", adSetExternalId: "set-1", date: D("2026-10-12T00:00:00Z"), spendMinor: BigInt(888888), impressions: 88888, clicks: 8888, platformConversions: 88, platformConversionValueMinor: BigInt(888888) }),
    metricRow({ id: "a7", organizationId: A, campaignExternalId: "camp-M1", campaignName: "Winter Sale SENTINELWINTER", date: D("2026-10-05T00:00:00Z"), spendMinor: BigInt(150000), impressions: 9000, clicks: 450, platformConversions: 15, platformConversionValueMinor: BigInt(450000) }),
    metricRow({ id: "a8", organizationId: A, platform: "google", campaignExternalId: "camp-G1", campaignName: "Search Push", date: D("2026-10-08T00:00:00Z"), spendMinor: BigInt(50000), impressions: 2500, clicks: 75, platformConversions: 2, platformConversionValueMinor: BigInt(100000) }),
  );
}

describe("SA-B14 A1: deterministic digest", () => {
  const prisma = makeFakePrisma();
  seedOrgA(prisma);
  prisma.__tables.organization.push({ id: B, name: "Shop B" });
  prisma.__tables.businessProfile.push(profileRow(B));
  const svc = new AdsIntelligenceService(prisma as any);

  it("computes hand-verified totals, platform split and deltas", async () => {
    const d = await svc.computeDigest(A, { days: 7, now: NOW });
    expect(d.hasData).toBe(true);
    expect(d.period).toEqual({ start: "2026-10-11T00:00:00.000Z", end: "2026-10-18T00:00:00.000Z" });
    expect(d.totals).toMatchObject({
      spendMinor: "370000", impressions: 18400, clicks: 830, ctrPercent: 4.51,
      conversions: 35, conversionValueMinor: "1120000", roas: 3.03,
    });
    expect(d.priorTotals).toMatchObject({ spendMinor: "200000", ctrPercent: 4.57, conversions: 17, roas: 2.75 });
    expect(d.deltas).toEqual({ spendPercent: 85, conversionsPercent: 105.88, roasPercent: 10.18, ctrPercent: -1.31 });
    expect(d.platforms.map((p) => p.platform)).toEqual(["meta", "google"]);
    expect(d.platforms[0]).toMatchObject({ spendMinor: "310000", conversions: 32, roas: 3.23, ctrPercent: 4.81 });
    expect(d.platforms[1]).toMatchObject({ spendMinor: "60000", conversions: 3, roas: 2, ctrPercent: 3 });
  });

  it("agrees with SA-B5's PerformanceSnapshot ads section on the same rows", async () => {
    const learning = new LearningService(prisma as any);
    const perf = new PerformanceLearningService(prisma as any, learning as any);
    const r = await perf.computeOrg(A, NOW);
    expect(r.status).toBe("ok");
    const snap = prisma.__tables.performanceSnapshot.find((s: any) => s.organizationId === A && s.metrics.windowDays === 7);
    const d = await svc.computeDigest(A, { days: 7, now: NOW });
    expect(snap.metrics.ads.spendMinor).toBe(d.totals.spendMinor);
    expect(snap.metrics.ads.conversions).toBe(d.totals.conversions);
    expect(snap.metrics.ads.conversionValueMinor).toBe(d.totals.conversionValueMinor);
    expect(snap.metrics.ads.roas).toBe(d.totals.roas);
  });

  it("enforces the ROAS ranking floor: tiny spend is counted, never ranked", async () => {
    const d = await svc.computeDigest(A, { days: 7, now: NOW });
    expect(ADS_CAMPAIGN_RANK_MIN_SPEND_MINOR).toBe(50000);
    expect(d.topCampaigns.map((c) => c.campaignExternalId)).toEqual(["camp-M1", "camp-G1"]);
    expect(d.topCampaigns[0]).toMatchObject({ name: "Winter Sale SENTINELWINTER", spendMinor: "300000", roas: 3 });
    expect(d.campaignsBelowFloor).toBe(1);
    expect([...d.topCampaigns, ...d.bottomCampaigns].some((c) => c.campaignExternalId === "camp-TINY")).toBe(false);
    // Two qualifying campaigns → no bottom list (never padded).
    expect(d.bottomCampaigns).toEqual([]);
  });

  it("computes budget pacing from BusinessProfile — and the projection is labelled an estimate", async () => {
    const d = await svc.computeDigest(A, { days: 7, now: NOW });
    expect(d.pacing).toMatchObject({
      budgetSet: true, monthlyBudgetMinor: "1000000", budgetCurrency: "BDT",
      monthToDateSpendMinor: "570000", expectedSpendByNowMinor: "548387",
      pacePercent: 104, projectedMonthSpendMinor: "1039412", projectedIsEstimate: true,
    });
    expect(d.factLines.join("\n")).toContain("আনুমানিক ব্যয়");
  });

  it("fires ONLY the spend spike on this fixture, with its tripping numbers", async () => {
    const d = await svc.computeDigest(A, { days: 7, now: NOW });
    expect(d.anomalies.map((a) => a.type)).toEqual(["spend_spike"]);
    expect(d.anomalies[0].evidence).toMatchObject({ changePercent: 85, currentSpendMinor: "370000", priorSpendMinor: "200000" });
  });

  it("supports the 30-day window: prior-window rows join the current totals", async () => {
    const d = await svc.computeDigest(A, { days: 30, now: NOW });
    expect(d.windowDays).toBe(30);
    expect(d.period.start).toBe("2026-09-18T00:00:00.000Z");
    expect(d.totals.spendMinor).toBe("570000");
    expect(d.priorTotals).toBeNull();
  });

  it("an org with no ad rows gets an honest empty digest (and no pacing invention)", async () => {
    const d = await svc.computeDigest(B, { days: 7, now: NOW });
    expect(d.hasData).toBe(false);
    expect(d.totals.spendMinor).toBe("0");
    expect(d.anomalies).toEqual([]);
    expect(d.factLines.join("\n")).toContain("কোনো campaign-স্তরের বিজ্ঞাপন ডেটা পাওয়া যায়নি");
    expect(d.factLines.join("\n")).not.toContain("ROAS");
  });
});

describe("SA-B14 A1: pacing honesty + anomaly thresholds", () => {
  const prisma = makeFakePrisma();
  const t = prisma.__tables;
  for (const org of [C, DD, E, F, G]) {
    t.organization.push({ id: org, name: `Shop ${org}` });
    t.businessProfile.push(profileRow(org));
  }
  // Org C: data, NO budget, no prior rows.
  t.dailyAdMetric.push(
    metricRow({ id: "c1", organizationId: C, campaignExternalId: "camp-C1", campaignName: "C One", date: D("2026-10-13T00:00:00Z"), spendMinor: BigInt(120000), impressions: 6000, clicks: 300, platformConversions: 6, platformConversionValueMinor: BigInt(360000) }),
  );
  // Org D: ROAS collapse (3.0 → 1.0), spend flat, CTR nearly flat.
  t.dailyAdMetric.push(
    metricRow({ id: "d1", organizationId: DD, campaignExternalId: "camp-D1", campaignName: "D One", date: D("2026-10-06T00:00:00Z"), spendMinor: BigInt(200000), impressions: 10000, clicks: 500, platformConversions: 20, platformConversionValueMinor: BigInt(600000) }),
    metricRow({ id: "d2", organizationId: DD, campaignExternalId: "camp-D1", campaignName: "D One", date: D("2026-10-13T00:00:00Z"), spendMinor: BigInt(200000), impressions: 10000, clicks: 480, platformConversions: 10, platformConversionValueMinor: BigInt(200000) }),
  );
  // Org E: heavy spend, zero conversions, no prior rows.
  t.dailyAdMetric.push(
    metricRow({ id: "e1", organizationId: E, campaignExternalId: "camp-E1", campaignName: "E One", date: D("2026-10-13T00:00:00Z"), spendMinor: BigInt(600000), impressions: 8000, clicks: 200, platformConversions: 0, platformConversionValueMinor: BigInt(0) }),
  );
  // Org F: CTR fatigue (5.0 → 3.0 = −40%), ROAS dip only −20%.
  t.dailyAdMetric.push(
    metricRow({ id: "f1", organizationId: F, campaignExternalId: "camp-F1", campaignName: "F One", date: D("2026-10-06T00:00:00Z"), spendMinor: BigInt(100000), impressions: 20000, clicks: 1000, platformConversions: 10, platformConversionValueMinor: BigInt(300000) }),
    metricRow({ id: "f2", organizationId: F, campaignExternalId: "camp-F1", campaignName: "F One", date: D("2026-10-13T00:00:00Z"), spendMinor: BigInt(100000), impressions: 20000, clicks: 600, platformConversions: 8, platformConversionValueMinor: BigInt(240000) }),
  );
  // Org G: thin data — +80% spend but below every absolute floor.
  t.dailyAdMetric.push(
    metricRow({ id: "g1", organizationId: G, campaignExternalId: "camp-G1", campaignName: "G One", date: D("2026-10-06T00:00:00Z"), spendMinor: BigInt(5000), impressions: 100, clicks: 2, platformConversions: 0, platformConversionValueMinor: BigInt(0) }),
    metricRow({ id: "g2", organizationId: G, campaignExternalId: "camp-G1", campaignName: "G One", date: D("2026-10-13T00:00:00Z"), spendMinor: BigInt(9000), impressions: 100, clicks: 2, platformConversions: 0, platformConversionValueMinor: BigInt(0) }),
  );
  const svc = new AdsIntelligenceService(prisma as any);

  it("no budget set: pacing says so and invents no target, MTD spend still real", async () => {
    const d = await svc.computeDigest(C, { days: 7, now: NOW });
    expect(d.pacing.budgetSet).toBe(false);
    expect(d.pacing.monthlyBudgetMinor).toBeNull();
    expect(d.pacing.expectedSpendByNowMinor).toBeNull();
    expect(d.pacing.pacePercent).toBeNull();
    expect(d.pacing.monthToDateSpendMinor).toBe("120000");
    const lines = d.factLines.join("\n");
    expect(lines).toContain("মাসিক বিজ্ঞাপন বাজেট সেট করা নেই");
    expect(lines).not.toContain("মাস শেষে");
  });

  it("ROAS collapse fires alone, carrying prior/current ROAS", async () => {
    const d = await svc.computeDigest(DD, { days: 7, now: NOW });
    expect(d.anomalies.map((a) => a.type)).toEqual(["roas_collapse"]);
    expect(d.anomalies[0].evidence).toMatchObject({ priorRoas: 3, currentRoas: 1, changePercent: -66.67 });
  });

  it("zero-conversion spend fires (critical at 5x the floor) without any prior period", async () => {
    const d = await svc.computeDigest(E, { days: 7, now: NOW });
    expect(d.priorTotals).toBeNull();
    expect(d.anomalies.map((a) => a.type)).toEqual(["zero_conversion_spend"]);
    expect(d.anomalies[0].severity).toBe("critical");
    expect(d.anomalies[0].evidence).toMatchObject({ currentSpendMinor: "600000", conversions: 0 });
  });

  it("CTR drop fires alone at the fatigue threshold", async () => {
    const d = await svc.computeDigest(F, { days: 7, now: NOW });
    expect(d.anomalies.map((a) => a.type)).toEqual(["ctr_drop"]);
    expect(d.anomalies[0].evidence).toMatchObject({ priorCtrPercent: 5, currentCtrPercent: 3, changePercent: -40 });
  });

  it("thin data stays silent: relative moves below the absolute floors flag nothing", async () => {
    const d = await svc.computeDigest(G, { days: 7, now: NOW });
    expect(d.hasData).toBe(true);
    expect(d.anomalies).toEqual([]);
  });
});

describe("SA-B14 A1: findings → LearnedItem (ads, INTERNAL at approval)", () => {
  const prisma = makeFakePrisma();
  seedOrgA(prisma);
  prisma.__tables.organization.push({ id: B, name: "Shop B" });
  prisma.__tables.businessProfile.push(profileRow(B));
  const learning = new LearningService(prisma as any);
  const svc = new AdsIntelligenceService(prisma as any, learning as any);

  it("files ≤3 findings as SUGGESTED ads facts, anomaly first", async () => {
    const r = await svc.suggestFindings(A, { days: 7, now: NOW });
    expect(r.created).toBe(2); // spend_spike anomaly + top campaign
    const items = prisma.__tables.learnedItem.filter((i: any) => i.organizationId === A && i.sourceType === "ads");
    expect(items.length).toBe(2);
    expect(items.every((i: any) => i.status === "suggested" && i.kind === "fact")).toBe(true);
    expect(items[0].title).toContain("spend_spike");
  });

  it("dedupes on re-run (dedupe wall) and skips a data-less org honestly", async () => {
    const again = await svc.suggestFindings(A, { days: 7, now: NOW });
    expect(again.created).toBe(0);
    const empty = await svc.suggestFindings(B, { days: 7, now: NOW });
    expect(empty.created).toBe(0);
    expect(empty.reason).toBe("no_ads_data");
    expect(prisma.__tables.learnedItem.filter((i: any) => i.organizationId === B).length).toBe(0);
  });

  it("approval of an ads fact lands INTERNAL even when public is requested", async () => {
    const item = prisma.__tables.learnedItem.find((i: any) => i.organizationId === A && i.sourceType === "ads");
    const updated = await learning.approve(A, "owner-1", item.id, { visibility: "public" });
    expect(updated.status).toBe("approved");
    const doc = prisma.__tables.knowledgeDocument.find((d: any) => d.id === String(updated.appliedRef).replace("knowledge:", ""));
    expect(doc).toBeTruthy();
    expect(doc.visibility).toBe("internal");
  });
});

describe("SA-B14 A1: Brain audience wall (law L3)", () => {
  const prisma = makeFakePrisma();
  seedOrgA(prisma);
  prisma.__tables.organization.push({ id: B, name: "Shop B" });
  prisma.__tables.businessProfile.push(profileRow(B));
  const brain = new OrgBrainService(prisma as any);

  it("internal context carries the digest; customer + own_customer contain no ads sentinel", async () => {
    const internal = await brain.getContext(A, { audience: "internal" });
    expect(internal.adsDigest).not.toBeNull();
    expect(internal.adsDigest?.totals.spendMinor).toBe("370000");
    expect(internal.adsFacts.join("\n")).toContain("SENTINELWINTER");
    expect(internal.adsFacts.join("\n")).toContain("বিজ্ঞাপন বিশ্লেষণ");

    for (const audience of ["customer", "own_customer"] as const) {
      const ctx = await brain.getContext(A, { audience, customerKey: audience === "own_customer" ? "whatsapp:x1" : undefined });
      expect(ctx.adsDigest).toBeNull();
      expect(ctx.adsFacts).toEqual([]);
      const serialized = JSON.stringify(ctx);
      expect(serialized).not.toContain("SENTINELWINTER");
      expect(serialized).not.toContain("বিজ্ঞাপন বিশ্লেষণ");
    }
  });

  it("another org's internal context never contains org A's ads data", async () => {
    const other = await brain.getContext(B, { audience: "internal" });
    expect(other.adsDigest).toBeNull();
    expect(JSON.stringify(other)).not.toContain("SENTINELWINTER");
  });
});

describe("SA-B14 A1: API controller isolation", () => {
  const prisma = makeFakePrisma();
  seedOrgA(prisma);
  prisma.__tables.organization.push({ id: B, name: "Shop B" });
  prisma.__tables.businessProfile.push(profileRow(B));
  const controller = new AdsIntelligenceController(new AdsIntelligenceService(prisma as any));

  it("serves org A's digest and an honest empty digest for org B", async () => {
    const a = await controller.digest(A, undefined);
    expect(a.hasData).toBe(true);
    expect(a.totals.spendMinor).toBe("370000");
    const b = await controller.digest(B, undefined);
    expect(b.hasData).toBe(false);
    expect(JSON.stringify(b)).not.toContain("SENTINELWINTER");
  });
});

describe("SA-B14 Item 2: guarded narration", () => {
  function narrSvc(prisma: any, provider: any, spy?: { calls: number }) {
    return new AdsIntelligenceService(prisma as any, undefined, {
      providerResolver: async () => {
        if (spy) spy.calls++;
        return provider;
      },
    });
  }
  const providerWith = (text: string): any => ({
    name: "fake-llm", isRealLlm: true,
    complete: async () => ({ text, model: "fake-model", inputTokens: 42, outputTokens: 17, tokensEstimated: false }),
  });

  it("a faithful narration passes verbatim and records usage", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    const svc = narrSvc(prisma, providerWith("গত 7 দিনে মোট conversion হয়েছে 35টি এবং ROAS দাঁড়িয়েছে 3.03।"));
    const r = await svc.narrate(A, "owner-1", { days: 7, now: NOW });
    expect(r.narration).toBe("গত 7 দিনে মোট conversion হয়েছে 35টি এবং ROAS দাঁড়িয়েছে 3.03।");
    expect(r.narrationNote).toBeNull();
    const usage = prisma.__tables.aIUsageRecord.filter((u: any) => u.organizationId === A);
    expect(usage.length).toBe(1);
    expect(usage[0]).toMatchObject({ feature: "ads_intelligence", userId: "owner-1", provider: "fake-llm", model: "fake-model" });
  });

  it("an invented number drops the WHOLE narration; facts stay intact; usage still recorded", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    const svc = narrSvc(prisma, providerWith("ROAS বেড়ে 9.99 হয়েছে এবং নতুন অর্ডার এসেছে 12345টি।"));
    const before = await svc.computeDigest(A, { days: 7, now: NOW });
    const r = await svc.narrate(A, "owner-1", { days: 7, now: NOW });
    expect(r.narration).toBeNull();
    expect(r.narrationNote).toBe("dropped_unsupported_numbers");
    expect(r.droppedNumbers).toContain("9.99");
    expect(r.droppedNumbers).toContain("12345");
    expect(r.digest.factLines).toEqual(before.factLines);
    expect(prisma.__tables.aIUsageRecord.filter((u: any) => u.organizationId === A).length).toBe(1);
  });

  it("no real provider: narration null with its honest label, digest complete", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    const svc = narrSvc(prisma, null);
    const r = await svc.narrate(A, "owner-1", { days: 7, now: NOW });
    expect(r.narration).toBeNull();
    expect(r.narrationNote).toBe("no_real_llm_provider");
    expect(r.digest.hasData).toBe(true);
    expect(prisma.__tables.aIUsageRecord.length).toBe(0);
  });

  it("no ads data: the provider is never resolved and the note says why", async () => {
    const prisma = makeFakePrisma();
    prisma.__tables.organization.push({ id: B, name: "Shop B" });
    prisma.__tables.businessProfile.push(profileRow(B));
    const spy = { calls: 0 };
    const svc = narrSvc(prisma, providerWith("anything"), spy);
    const r = await svc.narrate(B, "owner-1", { days: 7, now: NOW });
    expect(r.narration).toBeNull();
    expect(r.narrationNote).toBe("no_ads_data");
    expect(spy.calls).toBe(0);
  });
});
