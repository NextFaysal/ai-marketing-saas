import { CreativeLearningService, creativeFeatures } from "./creative-learning.service";
import { CreativeIntelligenceController } from "./creative-intelligence.controller";
import { LearningService } from "./learning.service";
import { OrgBrainService } from "./org-brain.service";

/**
 * SA-B16 (Smart AI Phase 3, A3) — Creative Intelligence guarantees:
 *  - pattern math equals hand-computed pooled CTR / lift on
 *    fixtures (baseline, a winning headline-question pattern,
 *    a losing headline-length pattern);
 *  - floors: a 50-impression creative is not evidence (the
 *    baseline is computed WITHOUT it), and a 2-creative pattern
 *    is never reported however strong its lift;
 *  - a no-lift dataset produces ZERO patterns and ZERO
 *    suggestions (silence over noise);
 *  - patterns are filed SUGGESTED-only, and approval forces
 *    INTERNAL even when "public" is requested (law L3);
 *  - exemplars rank by real CTR with the floor applied, and
 *    their text is read through from the CampaignAd rows;
 *  - cross-org isolation on the report, the sweep and the
 *    Brain (org B never sees org A's creatives or learnings);
 *  - the Brain: approved creative learnings reach INTERNAL
 *    contexts only — customer and own_customer contexts carry
 *    no creative sentinel, and SUGGESTED items never appear.
 * All doubles below are TEST doubles; production code contains
 * no fabricated data paths.
 */

// ---------- in-memory fake prisma (SA-B5/B14 pattern, full operators) ----------
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
  "learningState", "dailyAdMetric", "adCampaign", "campaignPlan", "campaignAdSet",
  "campaignAd", "product", "aIUsageRecord",
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

function profileRow(org: string): any {
  return {
    organizationId: org, industry: "Fashion", description: "A clothing shop", brandVoice: null,
    websiteUrl: null, goals: null, monthlyBudgetMinor: null, budgetCurrency: null,
    targetCustomers: null, businessModel: null, uniqueSellingPoints: null, tradeLicenseNo: null,
    billingEmails: null, deliveryChargeInsideMinor: BigInt(6000), deliveryChargeOutsideMinor: BigInt(12000),
    codAvailable: true, bkashNumber: "01700000000", contactPhone: "01700000000", contactEmail: "a@example.test",
    aiInstructions: null, aiReplyLanguage: null,
    conversationLearningEnabled: false, websiteLearningEnabled: true, answerStoreEnabled: true,
  };
}

const PLAIN_TEXT =
  "Soft cotton comfort for everyday wear, made with care and finished by hand for a lasting, gentle feel all day.";
const URGENCY_TEXT =
  "আজই অর্ডার করুন! সীমিত স্টক — প্রিমিয়াম মানের এই কালেকশনটি শেষ হওয়ার আগেই সংগ্রহ করুন আপনার পছন্দেরটি।";

function seedCreativeOrg(
  prisma: any,
  org: string,
  creatives: Array<{ ext: string; headline: string | null; text?: string; imp: number; clicks: number }>,
) {
  const t = prisma.__tables;
  t.organization.push({ id: org, name: `Shop ${org}` });
  t.businessProfile.push(profileRow(org));
  const planId = `plan-${org}`;
  t.campaignPlan.push({ id: planId, organizationId: org, name: `Plan ${org}` });
  const setId = `set-${org}`;
  t.campaignAdSet.push({ id: setId, planId });
  creatives.forEach((c, i) => {
    t.campaignAd.push({
      id: `ad-${org}-${i + 1}`, adSetId: setId, name: `Ad ${i + 1}`, externalAdId: c.ext,
      primaryText: c.text ?? PLAIN_TEXT, headline: c.headline, description: null,
      linkUrl: "https://example.test", callToAction: "SHOP_NOW", format: "link",
      createdAt: D(`2026-09-0${(i % 9) + 1}T00:00:00.000Z`),
    });
    t.dailyAdMetric.push({
      id: `m-${org}-${i + 1}`, organizationId: org, adAccountId: "acc1", adCampaignId: null,
      platform: "meta", source: "api", campaignExternalId: `camp-${org}`, campaignName: `Plan ${org}`,
      adSetExternalId: `setext-${org}`, adExternalId: c.ext, adName: `Ad ${i + 1}`,
      date: D("2026-10-10T00:00:00.000Z"), currency: "BDT",
      spendMinor: BigInt(100000), impressions: c.imp, clicks: c.clicks, reach: 0, videoViews: 0,
      platformConversions: 5, platformConversionValueMinor: BigInt(200000),
    });
  });
}

/**
 * Org A — hand-computed (window [2026-09-18, 2026-10-18)):
 *  qualifying C1..C8: imp 14000, clicks 680 -> baseline CTR 4.86,
 *  spend 800000, value 1600000 -> baseline ROAS 2.
 *  headline question group (C1,C3,C5): imp 5000, clicks 400 ->
 *  CTR 8, lift +64.61 (winning, 3 creatives).
 *  headline long group (C2,C7,C8): imp 6000, clicks 160 ->
 *  CTR 2.67, lift -45.06 (losing, 3 creatives).
 *  C9 (imp 50, CTR 50%) is below the floor: excluded from the
 *  baseline AND the exemplars; the ghost metric row (no local
 *  CampaignAd) counts as adsWithoutLocalText = 1.
 */
function seedOrgA(prisma: any) {
  seedCreativeOrg(prisma, A, [
    { ext: "ext-a1", headline: "আপনার পছন্দ কোনটি?", imp: 2000, clicks: 160 },
    { ext: "ext-a2", headline: "Discover our brand new festive collection with amazing styles for everyone today", imp: 2000, clicks: 80 },
    { ext: "ext-a3", headline: "কোন রঙটা চাই?", imp: 2000, clicks: 160 },
    { ext: "ext-a4", headline: "নতুন কালেকশন এসেছে", imp: 2000, clicks: 80 },
    { ext: "ext-a5", headline: "আপনি কি জানেন?", imp: 1000, clicks: 80 },
    { ext: "ext-a6", headline: "দারুণ ডিজাইন সবার জন্য", imp: 1000, clicks: 40 },
    { ext: "ext-a7", headline: "Limited period festive offer on selected items across all categories this week only", text: URGENCY_TEXT, imp: 2000, clicks: 40 },
    { ext: "ext-a8", headline: "Explore the latest arrivals and timeless essentials crafted for every occasion", imp: 2000, clicks: 40 },
    { ext: "ext-a9", headline: "ছোট বিজ্ঞাপন?", imp: 50, clicks: 25 },
  ]);
  prisma.__tables.dailyAdMetric.push({
    id: "m-a-ghost", organizationId: A, adAccountId: "acc1", adCampaignId: null,
    platform: "meta", source: "api", campaignExternalId: "camp-a", campaignName: "Plan org-a",
    adSetExternalId: "setext-a", adExternalId: "ext-ghost", adName: "Ghost Ad",
    date: D("2026-10-10T00:00:00.000Z"), currency: "BDT",
    spendMinor: BigInt(100000), impressions: 5000, clicks: 500, reach: 0, videoViews: 0,
    platformConversions: 5, platformConversionValueMinor: BigInt(200000),
  });
}

/** Org B — isolation sentinel org: uniform CTR 5%. */
function seedOrgB(prisma: any) {
  seedCreativeOrg(prisma, B, [
    { ext: "ext-b1", headline: "B-SENTINEL কোনটি?", imp: 2000, clicks: 100 },
    { ext: "ext-b2", headline: "B-SENTINEL অফার", imp: 2000, clicks: 100 },
    { ext: "ext-b3", headline: "B-SENTINEL নতুন", imp: 2000, clicks: 100 },
  ]);
}

/** Org C — varied features, identical CTR 5% everywhere: no lift. */
function seedOrgC(prisma: any) {
  seedCreativeOrg(prisma, C, [
    { ext: "ext-c1", headline: "কোনটি চাই?", imp: 2000, clicks: 100 },
    { ext: "ext-c2", headline: "কেনাকাটা শুরু?", imp: 2000, clicks: 100 },
    { ext: "ext-c3", headline: "Plain English headline here", imp: 2000, clicks: 100 },
    { ext: "ext-c4", headline: "Another plain headline", imp: 2000, clicks: 100 },
  ]);
}

/** Org D — a 2-creative question group at CTR 10% vs baseline 6%:
 * lift would be +66.67 but the group is below the creatives floor. */
function seedOrgD(prisma: any) {
  seedCreativeOrg(prisma, DD, [
    { ext: "ext-d1", headline: "কোনটি পছন্দ?", imp: 2000, clicks: 200 },
    { ext: "ext-d2", headline: "আপনি কি জানেন?", imp: 2000, clicks: 200 },
    { ext: "ext-d3", headline: "সাধারণ headline এক", imp: 2000, clicks: 40 },
    { ext: "ext-d4", headline: "সাধারণ headline দুই", imp: 2000, clicks: 40 },
  ]);
}

describe("creativeFeatures (deterministic feature extraction)", () => {
  it("detects question form, language, price, discount, urgency, CTA, emoji", () => {
    const q = creativeFeatures("headline", "আপনার পছন্দ কোনটি?");
    expect(q.question).toBe("yes");
    expect(q.language).toBe("bn");
    const t = creativeFeatures("text", "মাত্র ৫০০ টাকায় ২০% ছাড়! আজই অর্ডার করুন 🎉 সীমিত স্টক");
    expect(t.price).toBe("yes");
    expect(t.discount).toBe("yes");
    expect(t.urgency).toBe("yes");
    expect(t.cta).toBe("yes");
    expect(t.emoji).toBe("yes");
    const plain = creativeFeatures("text", PLAIN_TEXT);
    expect(plain.question).toBeUndefined();
    expect(plain.price).toBeUndefined();
    expect(plain.urgency).toBeUndefined();
    expect(plain.language).toBe("en");
  });
});

describe("CreativeLearningService — pattern math", () => {
  it("computes the pooled baseline and the winning/losing patterns exactly as hand-computed", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    const svc = new CreativeLearningService(prisma);
    const report = await svc.computeReport(A, { now: NOW });

    expect(report.creativesWithText).toBe(9);
    expect(report.creativesQualifying).toBe(8);
    expect(report.creativesBelowFloor).toBe(1);
    expect(report.adsWithoutLocalText).toBe(1);
    expect(report.baseline).toEqual({ impressions: 14000, clicks: 680, ctrPercent: 4.86, roas: 2 });

    const q = report.patterns.find((p) => p.key === "headline:question=yes");
    expect(q).toBeDefined();
    expect(q!.direction).toBe("winning");
    expect(q!.creatives).toBe(3);
    expect(q!.impressions).toBe(5000);
    expect(q!.clicks).toBe(400);
    expect(q!.ctrPercent).toBe(8);
    expect(q!.baselineCtrPercent).toBe(4.86);
    expect(q!.liftPercent).toBe(64.61);
    expect(q!.statement).toContain("CTR 8%");
    expect(q!.statement).toContain("গড় 4.86%");
    expect(q!.statement).toContain("3টি creative");

    const long = report.patterns.find((p) => p.key === "headline:length=long");
    expect(long).toBeDefined();
    expect(long!.direction).toBe("losing");
    expect(long!.ctrPercent).toBe(2.67);
    expect(long!.liftPercent).toBe(-45.06);
  });

  it("excludes the below-floor creative from exemplars and ranks by real CTR", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    const svc = new CreativeLearningService(prisma);
    const report = await svc.computeReport(A, { now: NOW });
    expect(report.exemplars).toHaveLength(5);
    expect(report.exemplars[0].ctrPercent).toBe(8);
    expect(report.exemplars.every((e) => e.impressions >= 1000)).toBe(true);
    expect(report.exemplars.map((e) => e.externalAdId)).not.toContain("ext-a9");
    expect(report.exemplars.map((e) => e.externalAdId)).not.toContain("ext-ghost");
    // Read-through: the exemplar text IS the CampaignAd row's text.
    const row = prisma.__tables.campaignAd.find((r: any) => r.externalAdId === report.exemplars[0].externalAdId);
    expect(report.exemplars[0].primaryText).toBe(row.primaryText);
    expect(report.exemplars[0].headline).toBe(row.headline);
  });

  it("never reports a pattern built on fewer than 3 creatives", async () => {
    const prisma = makeFakePrisma();
    seedOrgD(prisma);
    const svc = new CreativeLearningService(prisma);
    const report = await svc.computeReport(DD, { now: NOW });
    expect(report.creativesQualifying).toBe(4);
    expect(report.patterns.find((p) => p.key === "headline:question=yes")).toBeUndefined();
    expect(report.patterns).toHaveLength(0);
  });

  it("produces zero patterns and zero suggestions on a no-lift dataset", async () => {
    const prisma = makeFakePrisma();
    seedOrgC(prisma);
    const svc = new CreativeLearningService(prisma);
    const report = await svc.computeReport(C, { now: NOW });
    expect(report.baseline.ctrPercent).toBe(5);
    expect(report.patterns).toHaveLength(0);
    const r = await svc.suggestPatterns(C, { now: NOW });
    expect(r.created).toBe(0);
    expect(r.reason).toBe("no_pattern_cleared_thresholds");
    expect(prisma.__tables.learnedItem.filter((i: any) => i.organizationId === C)).toHaveLength(0);
  });
});

describe("CreativeLearningService — suggestions, approval, isolation", () => {
  it("files patterns SUGGESTED-only with sourceType creative, dedupes on re-run", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    const svc = new CreativeLearningService(prisma);
    const first = await svc.suggestPatterns(A, { now: NOW });
    expect(first.created).toBeGreaterThan(0);
    const items = prisma.__tables.learnedItem.filter((i: any) => i.organizationId === A);
    expect(items).toHaveLength(first.created);
    expect(items.every((i: any) => i.status === "suggested" && i.sourceType === "creative" && i.kind === "fact")).toBe(true);
    const second = await svc.suggestPatterns(A, { now: NOW });
    expect(second.created).toBe(0);
    expect(prisma.__tables.learnedItem.filter((i: any) => i.organizationId === A)).toHaveLength(first.created);
  });

  it("approval forces INTERNAL even when public is requested (law L3)", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    const svc = new CreativeLearningService(prisma);
    await svc.suggestPatterns(A, { now: NOW });
    const item = prisma.__tables.learnedItem.find(
      (i: any) => i.organizationId === A && String(i.title).includes("headline:question=yes"),
    );
    expect(item).toBeDefined();
    const learning = new LearningService(prisma);
    const updated = await learning.approve(A, "owner-1", item.id, { visibility: "public" });
    expect(updated.status).toBe("approved");
    const doc = prisma.__tables.knowledgeDocument.find((d: any) => d.id === String(updated.appliedRef).replace("knowledge:", ""));
    expect(doc).toBeDefined();
    expect(doc.visibility).toBe("internal");
    expect(doc.source).toBe("learned:creative");
  });

  it("keeps orgs isolated: reports, sweep and controller never cross orgs", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    seedOrgB(prisma);
    const svc = new CreativeLearningService(prisma);
    const reportA = await svc.computeReport(A, { now: NOW });
    expect(reportA.exemplars.every((e) => !e.externalAdId.startsWith("ext-b"))).toBe(true);
    expect(JSON.stringify(reportA.patterns)).not.toContain("B-SENTINEL");
    const reportB = await svc.computeReport(B, { now: NOW });
    expect(reportB.baseline.ctrPercent).toBe(5);
    expect(reportB.creativesWithText).toBe(3);

    const sweep = await svc.runSweep(NOW);
    expect(sweep.suggestions).toBeGreaterThan(0);
    const itemsB = prisma.__tables.learnedItem.filter((i: any) => i.organizationId === B);
    expect(itemsB).toHaveLength(0); // org B has no clearing pattern (uniform CTR)

    const controller = new CreativeIntelligenceController(svc);
    const viaApi = await controller.report(A);
    expect(viaApi.organizationId).toBe(A);
    expect(viaApi.exemplars.every((e) => e.externalAdId.startsWith("ext-a"))).toBe(true);
  });
});

describe("OrgBrain creative section (INTERNAL only)", () => {
  it("serves approved creative learnings to internal contexts and nothing to customers", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    seedOrgB(prisma);
    const svc = new CreativeLearningService(prisma);
    await svc.suggestPatterns(A, { now: NOW });
    const learning = new LearningService(prisma);
    const item = prisma.__tables.learnedItem.find(
      (i: any) => i.organizationId === A && String(i.title).includes("headline:question=yes"),
    );

    const brain = new OrgBrainService(prisma);
    // Before approval: even internal sees nothing (D3).
    const before = await brain.getContext(A, { audience: "internal" });
    expect(before.creativeFacts).toEqual([]);

    await learning.approve(A, "owner-1", item.id, {});
    const internal = await brain.getContext(A, { audience: "internal" });
    expect(internal.creativeFacts.length).toBeGreaterThan(1);
    expect(internal.creativeFacts.join("\n")).toContain("CTR 8%");

    const customer = await brain.getContext(A, { audience: "customer", query: "creative pattern" });
    expect(customer.creativeFacts).toEqual([]);
    expect(JSON.stringify(customer)).not.toContain("Creative pattern");
    const ownCustomer = await brain.getContext(A, { audience: "own_customer", customerKey: "messenger:u1" });
    expect(ownCustomer.creativeFacts).toEqual([]);
    expect(JSON.stringify(ownCustomer)).not.toContain("Creative pattern");

    // Org B internal: org A's approved learning never leaks.
    const internalB = await brain.getContext(B, { audience: "internal" });
    expect(internalB.creativeFacts).toEqual([]);
  });
});
