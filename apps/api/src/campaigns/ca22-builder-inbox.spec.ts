import { CampaignsService } from "./campaigns.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * Campaign Builder Advanced CA22 (CB5): builder inbox +
 * counter-drafts. Sources are REAL stored rows only:
 * manual entry, or a merchant-triggered import of an
 * existing CompetitorInsight / CompetitorPriceObservation
 * / long-running CompetitorAd. The import composes OUR
 * summary text from stored metadata — CompetitorAd
 * creative text is NEVER copied (the CN18 leak-proof
 * rule, pinned by the test below). One click on a signal
 * runs suggestPlan — which only ever creates DRAFTS —
 * and the created plan's status is asserted "draft".
 * The AUTOMATED competitor feed is NOT BUILT (Smart AI
 * C1–C2 sequence); the inbox note says so verbatim.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("gte" in v) return new Date(row[k]).getTime() >= new Date((v as any).gte).getTime();
      if ("lte" in v) return row[k] != null && new Date(row[k]).getTime() <= new Date((v as any).lte).getTime();
      if ("not" in v) return row[k] !== (v as any).not;
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
    findUnique: async ({ where }: any = {}) => rows.find((r) => r.organizationId === where.organizationId || r.id === where.id) ?? null,
    findMany: async ({ where, take }: any = {}) => { const f = rows.filter((r) => matches(r, where ?? {})); return take ? f.slice(0, take) : f; },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(Date.now() + seq * 10), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) Object.assign(row, data); return row; },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
  };
}
const DAY = 86_400_000;

function setup() {
  const tables: any = {};
  for (const n of ["campaignPlan", "campaignAdSet", "campaignAd", "campaignPublishLog", "adAccount", "integration", "product", "aIUsageRecord", "businessProfile", "dailyAdMetric", "dailyAdBreakdown", "savedTargeting", "audiencePerformanceRollup", "attributionCredit", "touchpoint", "builderInboxSignal", "competitor", "competitorAd", "competitorInsight", "competitorPriceObservation"]) tables[n] = makeTable(n);
  const planFind = tables.campaignPlan.findFirst;
  tables.campaignPlan.findFirst = async (args: any) => {
    const row = await planFind(args);
    if (row && args?.include) {
      const adSets = tables.campaignAdSet.rows.filter((s: any) => s.planId === row.id)
        .map((s: any) => ({ ...s, ads: tables.campaignAd.rows.filter((a: any) => a.adSetId === s.id) }));
      return { ...row, adSets, publishLogs: [] };
    }
    return row;
  };
  tables.businessProfile.findUnique = async () => ({ organizationId: "org", industry: "fashion retail", brandVoice: "friendly", websiteUrl: "https://shop.example" });
  tables.adAccount.rows.push({ id: "acc-1", organizationId: "org", platform: "meta", sourceType: "api", externalId: "act_1", name: "Main", currency: "BDT" });
  tables.product.rows.push({ id: "prod-1", organizationId: "org", status: "ACTIVE", name: "Cotton Panjabi", priceMinor: 150000n, currency: "BDT", category: "clothing", description: "Comfortable" });
  tables.product.rows.push({ id: "prod-2", organizationId: "org", status: "ACTIVE", name: "Leather Wallet", priceMinor: 90000n, currency: "BDT", category: "accessories", description: "Slim" });
  const svc: any = new CampaignsService(tables as any, { log: async () => undefined } as any, { getProvider: () => new DevTemplateProvider() } as any);
  return { tables, svc };
}

function seedCompetitors(tables: any) {
  tables.competitor.rows.push({ id: "comp-1", organizationId: "org", name: "Rival Fashion", createdAt: new Date() });
  tables.competitorInsight.rows.push({ id: "ins-1", organizationId: "org", competitorId: "comp-1", kind: "pricing", title: "ঈদ ছাড় ঘোষণা", detail: "সব পণ্যে ৩০% পর্যন্ত ছাড় দিচ্ছে", createdAt: new Date() });
  tables.competitorPriceObservation.rows.push({ id: "price-1", organizationId: "org", competitorId: "comp-1", productName: "Panjabi Eid Collection", priceMinor: 120000n, sourceUrl: "https://rival.example/p", createdAt: new Date() });
  tables.competitorAd.rows.push({ id: "ad-old", organizationId: undefined, competitorId: "comp-1", creativeText: "SECRET CREATIVE TEXT — কখনো কপি হবে না", linkUrl: "https://rival.example/ad", startedAt: new Date(Date.now() - 20 * DAY), isActive: true, createdAt: new Date() });
  tables.competitorAd.rows.push({ id: "ad-new", competitorId: "comp-1", creativeText: "তরুণ বিজ্ঞাপন", startedAt: new Date(Date.now() - 3 * DAY), isActive: true, createdAt: new Date() });
  tables.competitorAd.rows.push({ id: "ad-dead", competitorId: "comp-1", creativeText: "বন্ধ বিজ্ঞাপন", startedAt: new Date(Date.now() - 30 * DAY), isActive: false, createdAt: new Date() });
}

describe("CA22 builder inbox", () => {
  it("manual signal CRUD: create validates length + product, list orders newest first, dismiss only from new", async () => {
    const { svc } = setup();
    await expect(svc.createBuilderSignal("org", "u1", { text: "ab" })).rejects.toThrow();
    await expect(svc.createBuilderSignal("org", "u1", { text: "x".repeat(501) })).rejects.toThrow();
    await expect(svc.createBuilderSignal("org", "u1", { text: "ঠিকঠাক সিগন্যাল", productId: "nope" })).rejects.toThrow();
    const a = await svc.createBuilderSignal("org", "u1", { text: "প্রতিযোগী X এই অফার দিচ্ছে" });
    const b = await svc.createBuilderSignal("org", "u1", { text: "আরেকটি পর্যবেক্ষণ", productId: "prod-2" });
    const inbox = await svc.listBuilderInbox("org");
    expect(inbox.note).toContain("NOT BUILT");
    expect(inbox.signals.map((s: any) => s.id)).toEqual([b.signal.id, a.signal.id]); // newest first (b created later)
    const dismissed = await svc.dismissBuilderSignal("org", "u1", a.signal.id);
    expect(dismissed.signal.status).toBe("dismissed");
    const again = await svc.dismissBuilderSignal("org", "u1", a.signal.id);
    expect(again.signal.status).toBe("dismissed"); // idempotent
    await expect(svc.draftFromSignal("org", "u1", a.signal.id, { adAccountId: "acc-1", totalDailyBudget: "1000" })).rejects.toThrow();
  });

  it("import composes metadata-only text, dedupes, and NEVER copies competitor creative text (leak-proof pin)", async () => {
    const { tables, svc } = setup();
    seedCompetitors(tables);
    const inbox = await svc.listBuilderInbox("org");
    expect(inbox.importable.insights).toHaveLength(1);
    expect(inbox.importable.prices).toHaveLength(1);
    expect(inbox.importable.ads.map((a: any) => a.sourceRefId)).toEqual(["ad-old"]); // 20d active only; 3d too young, inactive excluded

    const ins = await svc.importCompetitorSignal("org", "u1", { source: "competitor_insight", sourceRefId: "ins-1" });
    expect(ins.signal.text).toContain("ঈদ ছাড় ঘোষণা");
    const dup = await svc.importCompetitorSignal("org", "u1", { source: "competitor_insight", sourceRefId: "ins-1" });
    expect(dup.alreadyImported).toBe(true);
    expect(tables.builderInboxSignal.rows.filter((s: any) => s.sourceRefId === "ins-1")).toHaveLength(1);

    const price = await svc.importCompetitorSignal("org", "u1", { source: "competitor_price", sourceRefId: "price-1" });
    expect(price.signal.text).toContain("Rival Fashion");
    expect(price.signal.text).toContain("৳1,200");
    expect(price.signal.productId).toBe("prod-1"); // "Panjabi" token matched Cotton Panjabi

    const ad = await svc.importCompetitorSignal("org", "u1", { source: "competitor_ad", sourceRefId: "ad-old" });
    expect(ad.signal.text).toContain("20 দিন ধরে Active");
    expect(ad.signal.text).not.toContain("SECRET CREATIVE TEXT");
    expect(JSON.stringify(tables.builderInboxSignal.rows)).not.toContain("SECRET CREATIVE TEXT");
    await expect(svc.importCompetitorSignal("org", "u1", { source: "competitor_ad", sourceRefId: "missing" })).rejects.toThrow();
  });

  it("draft from signal WITH a product token match: plan is a DRAFT, signal becomes drafted, no second draft", async () => {
    const { tables, svc } = setup();
    const created = await svc.createBuilderSignal("org", "u1", { text: "প্রতিযোগী Panjabi-তে বড় ছাড় দিচ্ছে — জবাবি অফার চাই" });
    const out = await svc.draftFromSignal("org", "u1", created.signal.id, { adAccountId: "acc-1", totalDailyBudget: "1500" });
    expect(out.productMatched).toBe(true);
    expect(out.plan.status).toBe("draft");
    expect(out.plan.externalCampaignId ?? null).toBeNull();
    expect(out.signal.status).toBe("drafted");
    expect(out.signal.draftPlanId).toBe(out.plan.id);
    const planRow = tables.campaignPlan.rows.find((r: any) => r.id === out.plan.id);
    expect(planRow.status).toBe("draft");
    expect(out.note).toContain("শুধু একটি DRAFT");
    await expect(svc.draftFromSignal("org", "u1", created.signal.id, { adAccountId: "acc-1", totalDailyBudget: "1500" })).rejects.toThrow();
    await expect(svc.dismissBuilderSignal("org", "u1", created.signal.id)).rejects.toThrow(); // drafted history is kept
  });

  it("draft from a MANUAL signal with an explicit product skips matching; without any match the draft is product-less but still a draft", async () => {
    const { svc } = setup();
    const withProduct = await svc.createBuilderSignal("org", "u1", { text: "ওয়ালেটে প্রতিযোগীর দাম কম", productId: "prod-2" });
    const outA = await svc.draftFromSignal("org", "u1", withProduct.signal.id, { adAccountId: "acc-1", totalDailyBudget: "800" });
    expect(outA.productMatched).toBe(true);
    expect(outA.plan.adSets[0].ads[0].productId).toBe("prod-2");

    const noMatch = await svc.createBuilderSignal("org", "u1", { text: "প্রতিযোগী নতুন ডেলিভারি অফার চালু করেছে সারাদেশে" });
    const outB = await svc.draftFromSignal("org", "u1", noMatch.signal.id, { adAccountId: "acc-1", totalDailyBudget: "800" });
    expect(outB.productMatched).toBe(false);
    expect(outB.plan.status).toBe("draft");
    expect(outB.signal.status).toBe("drafted");
  });
});
