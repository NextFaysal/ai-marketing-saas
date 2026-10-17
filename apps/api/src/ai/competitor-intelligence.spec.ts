import { CompetitorIntelligenceService } from "./competitor-intelligence.service";
import { CompetitorIntelligenceController } from "./competitor-intelligence.controller";
import { LearningService, defaultApprovalVisibility } from "./learning.service";
import { OrgBrainService } from "./org-brain.service";

/**
 * SA-B17 (Smart AI Phase 4, C1) — Competitor Brain guarantees:
 *  - digest math on fixtures: new-ad counts at the exact
 *    window edges (firstSeenAt), active/ended split, weekly
 *    cadence, price delta from two snapshots;
 *  - single-observation honesty: deltaPercent stays null —
 *    a lone price point is "no movement data", never 0%;
 *  - creative themes are deterministic COUNTS over
 *    creativeText (no performance claims exist to make);
 *  - findings fire at their named thresholds and stay
 *    silent below them; the findings list is capped at 3;
 *  - an org tracking nobody gets an honest empty digest;
 *  - findings are filed SUGGESTED-only (sourceType
 *    "competitor") and approval forces INTERNAL even when
 *    "public" is requested (law L3);
 *  - cross-org isolation on digest, controller and sweep;
 *  - the Brain wall: competitor names/prices reach INTERNAL
 *    contexts only — customer and own_customer contexts are
 *    byte-clean, and org B's internal context never contains
 *    org A's rivals.
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
  "learningState", "dailyAdMetric",
  "competitor", "competitorAd", "competitorPriceObservation",
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

let adSeq = 0;
function adRow(competitorId: string, firstSeenIso: string, opts: { active?: boolean; text?: string | null } = {}): any {
  adSeq++;
  return {
    id: `cad-${adSeq}`, competitorId, externalAdId: `ext-${adSeq}`,
    pageId: "pg1", pageName: "Page", startedAt: D(firstSeenIso), stoppedAt: opts.active === false ? D("2026-10-01T00:00:00.000Z") : null,
    isActive: opts.active !== false, platforms: ["facebook"],
    creativeText: opts.text ?? null, linkUrl: null, snapshotUrl: null,
    firstSeenAt: D(firstSeenIso), lastSeenAt: D(firstSeenIso), raw: null,
  };
}
function obsRow(competitorId: string, productName: string, priceMinor: bigint, iso: string): any {
  return {
    id: `obs-${competitorId}-${productName}-${iso}`, competitorId, productName,
    priceMinor, currency: "BDT", sourceUrl: "https://rival.example/p", sourceType: "website_scan",
    observedAt: D(iso),
  };
}

function seedOrgA(prisma: any) {
  const t = prisma.__tables;
  t.organization.push({ id: A, name: "Shop A" });
  t.businessProfile.push(profileRow(A));
  t.competitor.push(
    { id: "comp-a1", organizationId: A, name: "Rival Fashion", facebookPageId: "fb-rival", facebookPageUrl: null, websiteUrl: "https://rival.example", notes: null, createdAt: D("2026-08-01T00:00:00.000Z"), updatedAt: D("2026-08-01T00:00:00.000Z") },
    { id: "comp-a2", organizationId: A, name: "Quiet Store", facebookPageId: null, facebookPageUrl: null, websiteUrl: null, notes: null, createdAt: D("2026-08-01T00:00:00.000Z"), updatedAt: D("2026-08-01T00:00:00.000Z") },
  );
  // Rival Fashion: 6 new ads in 7d (burst), 2 more in 30d, 1 ancient.
  t.competitorAd.push(
    adRow("comp-a1", "2026-10-12T10:00:00.000Z", { text: "সেরা মানের পাঞ্জাবি এখন মাত্র ১২৫০ টাকা! আজই অর্ডার করুন" }),
    adRow("comp-a1", "2026-10-13T10:00:00.000Z", { text: "Premium quality shirt — 20% discount this week! Order now" }),
    adRow("comp-a1", "2026-10-14T10:00:00.000Z", { text: "আপনার পছন্দের শাড়ি কোনটি? 🌸" }),
    adRow("comp-a1", "2026-10-15T10:00:00.000Z", { text: "Best fabric collection, limited stock, hurry!" }),
    adRow("comp-a1", "2026-10-16T10:00:00.000Z", { text: "নতুন কালেকশন এসেছে — দেখুন এখনই" }),
    adRow("comp-a1", "2026-10-16T11:00:00.000Z", { text: "" }),
    adRow("comp-a1", "2026-09-25T10:00:00.000Z", { text: "Eid collection sale — up to 30% off" }),
    adRow("comp-a1", "2026-09-20T10:00:00.000Z", { active: false, text: null }),
    adRow("comp-a1", "2026-08-01T10:00:00.000Z", { active: false, text: null }),
  );
  // Quiet Store: ads in August only — silent for 58 days.
  t.competitorAd.push(
    adRow("comp-a2", "2026-08-05T10:00:00.000Z", {}),
    adRow("comp-a2", "2026-08-10T10:00:00.000Z", {}),
    adRow("comp-a2", "2026-08-20T10:00:00.000Z", { active: false }),
  );
  // Prices: Panjabi dropped 1500 -> 1250 (-16.67%); Shirt has ONE point.
  t.competitorPriceObservation.push(
    obsRow("comp-a1", "Panjabi Premium", 150000n, "2026-09-20T09:00:00.000Z"),
    obsRow("comp-a1", "Panjabi Premium", 125000n, "2026-10-15T09:00:00.000Z"),
    obsRow("comp-a1", "Shirt Classic", 90000n, "2026-10-10T09:00:00.000Z"),
  );
}

function seedOrgB(prisma: any) {
  const t = prisma.__tables;
  t.organization.push({ id: B, name: "Shop B" });
  t.businessProfile.push(profileRow(B));
  t.competitor.push(
    { id: "comp-b1", organizationId: B, name: "SENTINEL-BEE Shop", facebookPageId: null, facebookPageUrl: null, websiteUrl: null, notes: null, createdAt: D("2026-09-01T00:00:00.000Z"), updatedAt: D("2026-09-01T00:00:00.000Z") },
  );
  t.competitorAd.push(adRow("comp-b1", "2026-10-15T10:00:00.000Z", { text: "Bee SENTINEL copy" }));
  t.competitorPriceObservation.push(obsRow("comp-b1", "Bee Product SENTINEL", 424242n, "2026-10-15T09:00:00.000Z"));
}

describe("CompetitorIntelligenceService — digest math", () => {
  it("computes activity, cadence and totals exactly from the rows", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    const svc = new CompetitorIntelligenceService(prisma);
    const d = await svc.computeDigest(A, { now: NOW });

    expect(d.hasData).toBe(true);
    expect(d.tracked).toBe(2);
    expect(d.totals).toEqual({
      adsSeen: 12, activeAds: 9, endedAds: 3,
      newAds7d: 6, newAds30d: 8, priceSeries: 2, priceMovements: 1,
    });
    const rival = d.competitors.find((c) => c.name === "Rival Fashion")!;
    expect(rival.totalAds).toBe(9);
    expect(rival.activeAds).toBe(7);
    expect(rival.endedAds).toBe(2);
    expect(rival.newAds7d).toBe(6);
    expect(rival.newAds30d).toBe(8);
    expect(rival.adsPerWeek7d).toBe(6);
    expect(rival.adsPerWeek30d).toBe(1.87);
    const quiet = d.competitors.find((c) => c.name === "Quiet Store")!;
    expect(quiet.newAds7d).toBe(0);
    expect(quiet.daysSinceLastNewAd).toBe(58);
    expect(quiet.lastNewAdAt).toBe("2026-08-20T10:00:00.000Z");
  });

  it("counts an ad first seen exactly at the window start, and not one just before", async () => {
    const prisma = makeFakePrisma();
    const t = prisma.__tables;
    t.organization.push({ id: C, name: "Shop C" });
    t.competitor.push({ id: "comp-c1", organizationId: C, name: "Edge Store", facebookPageId: null, facebookPageUrl: null, websiteUrl: null, notes: null, createdAt: D("2026-09-01T00:00:00.000Z"), updatedAt: D("2026-09-01T00:00:00.000Z") });
    // 7d window starts 2026-10-11T00:00:00Z (performancePeriod).
    t.competitorAd.push(adRow("comp-c1", "2026-10-11T00:00:00.000Z", {}));
    t.competitorAd.push(adRow("comp-c1", "2026-10-10T23:59:59.000Z", {}));
    const svc = new CompetitorIntelligenceService(prisma);
    const d = await svc.computeDigest(C, { now: NOW });
    expect(d.competitors[0].newAds7d).toBe(1);
    expect(d.competitors[0].newAds30d).toBe(2);
  });

  it("computes the price delta from two snapshots — and stays null on a single one", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    const svc = new CompetitorIntelligenceService(prisma);
    const d = await svc.computeDigest(A, { now: NOW });
    const rival = d.competitors.find((c) => c.name === "Rival Fashion")!;
    const panjabi = rival.prices.find((p) => p.productName === "Panjabi Premium")!;
    expect(panjabi.latestPriceMinor).toBe("125000");
    expect(panjabi.priorPriceMinor).toBe("150000");
    expect(panjabi.deltaPercent).toBe(-16.67);
    expect(panjabi.observations).toBe(2);
    const shirt = rival.prices.find((p) => p.productName === "Shirt Classic")!;
    // Single observation: NO delta is claimed (null, never 0).
    expect(shirt.deltaPercent).toBeNull();
    expect(shirt.priorPriceMinor).toBeNull();
    expect(shirt.observations).toBe(1);
    // The org-level movement list carries only the honest series.
    expect(d.priceMovements).toHaveLength(1);
    expect(d.priceMovements[0].competitorName).toBe("Rival Fashion");
  });

  it("counts creative themes deterministically over the window copy (counts only)", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    const svc = new CompetitorIntelligenceService(prisma);
    const d1 = await svc.computeDigest(A, { now: NOW });
    const d2 = await svc.computeDigest(A, { now: NOW });
    expect(d1.themes).toEqual(d2.themes);
    expect(d1.themes.adsWithText).toBe(6);
    expect(d1.themes.byLanguage).toEqual({ bn: 3, en: 3, mixed: 0 });
    expect(d1.themes.priceMention).toBe(1);
    expect(d1.themes.discountMention).toBe(2);
    expect(d1.themes.urgency).toBe(3);
    expect(d1.themes.questionForm).toBe(1);
    expect(d1.themes.emoji).toBe(1);
    expect(d1.themes.cta).toBe(2);
  });

  it("an org tracking nobody gets an honest empty digest, not an error", async () => {
    const prisma = makeFakePrisma();
    prisma.__tables.organization.push({ id: E, name: "Shop E" });
    const svc = new CompetitorIntelligenceService(prisma);
    const d = await svc.computeDigest(E, { now: NOW });
    expect(d.hasData).toBe(false);
    expect(d.tracked).toBe(0);
    expect(d.findings).toEqual([]);
    expect(d.factLines).toEqual([]);
    const r = await svc.suggestFindings(E, { now: NOW });
    expect(r.created).toBe(0);
    expect(r.reason).toBe("no_competitors_tracked");
  });
});

describe("CompetitorIntelligenceService — findings thresholds", () => {
  it("fires burst, price-drop and silence findings at threshold, capped at 3", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    const svc = new CompetitorIntelligenceService(prisma);
    const d = await svc.computeDigest(A, { now: NOW });
    expect(d.findings).toHaveLength(3);
    // Priority: price drop, then burst, then silence.
    expect(d.findings[0]).toContain("Rival Fashion");
    expect(d.findings[0]).toContain("Panjabi Premium");
    expect(d.findings[0]).toContain("-16.67%");
    expect(d.findings[1]).toContain("6টি নতুন ad");
    expect(d.findings[2]).toContain("Quiet Store");
    expect(d.findings[2]).toContain("58 দিনে কোনো নতুন ad দেয়নি");
  });

  it("stays silent below every threshold", async () => {
    const prisma = makeFakePrisma();
    const t = prisma.__tables;
    t.organization.push({ id: DD, name: "Shop D" });
    t.competitor.push({ id: "comp-d1", organizationId: DD, name: "Calm Rival", facebookPageId: null, facebookPageUrl: null, websiteUrl: null, notes: null, createdAt: D("2026-09-01T00:00:00.000Z"), updatedAt: D("2026-09-01T00:00:00.000Z") });
    // 4 new ads in 7d (burst needs 5); last new ad 10 days ago (silence needs 14).
    for (let i = 0; i < 4; i++) t.competitorAd.push(adRow("comp-d1", `2026-10-${13 + i}T10:00:00.000Z`, {}));
    t.competitorAd.push(adRow("comp-d1", "2026-10-07T10:00:00.000Z", {}));
    // A -4% drop (finding needs -5%).
    t.competitorPriceObservation.push(
      obsRow("comp-d1", "Calm Product", 100000n, "2026-09-25T09:00:00.000Z"),
      obsRow("comp-d1", "Calm Product", 96000n, "2026-10-12T09:00:00.000Z"),
    );
    const svc = new CompetitorIntelligenceService(prisma);
    const d = await svc.computeDigest(DD, { now: NOW });
    expect(d.competitors[0].prices[0].deltaPercent).toBe(-4);
    expect(d.findings).toEqual([]);
    const r = await svc.suggestFindings(DD, { now: NOW });
    expect(r.created).toBe(0);
    expect(r.reason).toBe("no_findings");
  });

  it("never reports silence for a competitor that has never had an ad", async () => {
    const prisma = makeFakePrisma();
    const t = prisma.__tables;
    t.organization.push({ id: DD, name: "Shop D" });
    t.competitor.push({ id: "comp-d2", organizationId: DD, name: "Never Active", facebookPageId: null, facebookPageUrl: null, websiteUrl: null, notes: null, createdAt: D("2026-01-01T00:00:00.000Z"), updatedAt: D("2026-01-01T00:00:00.000Z") });
    const svc = new CompetitorIntelligenceService(prisma);
    const d = await svc.computeDigest(DD, { now: NOW });
    expect(d.competitors[0].daysSinceLastNewAd).toBeNull();
    expect(d.findings).toEqual([]);
  });
});

describe("CompetitorIntelligenceService — suggestions, approval, isolation", () => {
  it("files findings SUGGESTED-only as sourceType competitor, deduped on re-run", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    seedOrgB(prisma);
    const svc = new CompetitorIntelligenceService(prisma);
    const r1 = await svc.suggestFindings(A, { now: NOW });
    expect(r1.created).toBe(3);
    const items = prisma.__tables.learnedItem.filter((i: any) => i.organizationId === A);
    expect(items).toHaveLength(3);
    for (const it of items) {
      expect(it.status).toBe("suggested");
      expect(it.kind).toBe("fact");
      expect(it.sourceType).toBe("competitor");
    }
    const r2 = await svc.suggestFindings(A, { now: NOW });
    expect(r2.created).toBe(0);
    expect(prisma.__tables.learnedItem.filter((i: any) => i.organizationId === A)).toHaveLength(3);
  });

  it("approval forces INTERNAL even when public is requested (law L3)", async () => {
    expect(defaultApprovalVisibility({ kind: "fact", sourceType: "competitor" })).toBe("internal");
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    const svc = new CompetitorIntelligenceService(prisma);
    await svc.suggestFindings(A, { now: NOW });
    const item = prisma.__tables.learnedItem.find((i: any) => i.organizationId === A);
    const learning = new LearningService(prisma);
    const updated = await learning.approve(A, "owner-1", item.id, { visibility: "public" });
    expect(updated.status).toBe("approved");
    const doc = prisma.__tables.knowledgeDocument.find((d2: any) => d2.organizationId === A);
    expect(doc).toBeTruthy();
    expect(doc.visibility).toBe("internal");
    expect(doc.source).toBe("learned:competitor");
  });

  it("keeps orgs isolated across digest, controller and sweep", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    seedOrgB(prisma);
    const svc = new CompetitorIntelligenceService(prisma);
    const controller = new CompetitorIntelligenceController(svc);
    const dA = await controller.digest(A);
    expect(JSON.stringify(dA)).not.toContain("SENTINEL-BEE");
    expect(JSON.stringify(dA)).not.toContain("424242");
    const dB = await controller.digest(B);
    expect(JSON.stringify(dB)).toContain("SENTINEL-BEE Shop");
    expect(JSON.stringify(dB)).not.toContain("Rival Fashion");
    const sweep = await svc.runSweep(NOW);
    expect(sweep.orgs).toBe(2);
    const itemsA = prisma.__tables.learnedItem.filter((i: any) => i.organizationId === A);
    const itemsB = prisma.__tables.learnedItem.filter((i: any) => i.organizationId === B);
    expect(itemsA.length).toBe(3);
    expect(JSON.stringify(itemsB)).not.toContain("Rival Fashion");
  });
});

describe("OrgBrain competitor section (INTERNAL only)", () => {
  it("serves the digest + approved facts internally and nothing to customers", async () => {
    const prisma = makeFakePrisma();
    seedOrgA(prisma);
    seedOrgB(prisma);
    const brain = new OrgBrainService(prisma);

    const internal = await brain.getContext(A, { audience: "internal" });
    expect(internal.competitorDigest).not.toBeNull();
    expect(internal.competitorDigest!.tracked).toBe(2);
    const internalText = internal.competitorFacts.join("\n");
    expect(internalText).toContain("Rival Fashion");
    expect(internalText).toContain("Panjabi Premium");
    // The SUGGESTED finding is not yet in the approved-facts block.
    expect(internalText).not.toContain("শেখা competitor তথ্য (অনুমোদিত):");

    // Approve one finding -> it joins the section as learned fact.
    const svc = new CompetitorIntelligenceService(prisma);
    await svc.suggestFindings(A, { now: NOW });
    const learning = new LearningService(prisma);
    const item = prisma.__tables.learnedItem.find((i: any) => i.organizationId === A);
    await learning.approve(A, "owner-1", item.id, {});
    const internal2 = await brain.getContext(A, { audience: "internal" });
    expect(internal2.competitorFacts.join("\n")).toContain("শেখা competitor তথ্য (অনুমোদিত):");

    // Customer-class contexts: byte-clean of every sentinel.
    for (const audience of ["customer", "own_customer"] as const) {
      const ctx = await brain.getContext(A, { audience, ...(audience === "own_customer" ? { customerKey: "messenger:u1" } : {}) });
      expect(ctx.competitorDigest).toBeNull();
      expect(ctx.competitorFacts).toEqual([]);
      const serialized = JSON.stringify(ctx);
      expect(serialized).not.toContain("Rival Fashion");
      expect(serialized).not.toContain("Quiet Store");
      expect(serialized).not.toContain("Panjabi Premium");
    }

    // Org B internal: org A's rivals never leak across.
    const internalB = await brain.getContext(B, { audience: "internal" });
    expect(JSON.stringify(internalB)).not.toContain("Rival Fashion");
    expect(JSON.stringify(internalB)).not.toContain("Panjabi Premium");
    expect(internalB.competitorDigest!.tracked).toBe(1);
  });
});
