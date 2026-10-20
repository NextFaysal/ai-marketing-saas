import { CreativeStudioService, STUDIO_CTAS } from "./creative-studio.service";
import { CampaignsService } from "../campaigns/campaigns.service";

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && "gte" in (v as any)) {
      return new Date(row[k]) >= (v as any).gte;
    }
    if (v !== null && typeof v === "object" && !(v instanceof Date) && "in" in (v as any)) {
      return (v as any).in.includes(row[k]);
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
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where, take, orderBy }: any = {}) => {
      let f = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "desc") f = [...f].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (orderBy?.createdAt === "asc") f = [...f].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return take ? f.slice(0, take) : f;
    },
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (row) Object.assign(row, data);
      return row;
    },
    delete: async ({ where }: any) => {
      const i = rows.findIndex((r) => r.id === where.id);
      const [row] = rows.splice(i, 1);
      return row;
    },
    deleteMany: async ({ where }: any = {}) => {
      const hit = rows.filter((r) => matches(r, where ?? {}));
      for (const r of hit) rows.splice(rows.indexOf(r), 1);
      return { count: hit.length };
    },
  };
}

function fakePrisma() {
  const tables: any = {
    product: makeTable("product"),
    businessProfile: makeTable("bp"),
    aIUsageRecord: makeTable("usage"),
    adAccount: makeTable("account"),
    campaignPlan: makeTable("plan"),
    campaignAdSet: makeTable("adset"),
    campaignAd: makeTable("ad"),
    campaignPublishLog: makeTable("log"),
    systemSetting: makeTable("setting"),
    organization: makeTable("org"),
    subscription: makeTable("sub"),
  };
  tables.product.rows.push({
    id: "prod-1",
    organizationId: "org-1",
    name: "Cotton Panjabi",
    slug: "cotton-panjabi",
    description: "Comfortable cotton panjabi for everyday wear",
    category: "clothing",
    sku: "PAN-1",
    status: "ACTIVE",
    priceMinor: 150000n,
    compareAtMinor: 200000n,
    currency: "BDT",
    stockQuantity: 12,
    imageUrl: "https://shop.example/panjabi.jpg",
  });
  tables.businessProfile.rows.push({
    organizationId: "org-1",
    websiteUrl: "https://shop.example",
    brandVoice: "friendly",
    industry: "fashion",
  });
  tables.adAccount.rows.push({
    id: "acc-1",
    organizationId: "org-1",
    platform: "meta",
    externalId: "act_777",
    name: "Main",
    currency: "BDT",
  });
  return tables;
}

const auditStub = { log: async () => undefined } as any;

function buildService(prisma: any, provider: any) {
  const llmStub = { getProvider: () => provider } as any;
  const campaigns = new CampaignsService(prisma as any, auditStub, llmStub);
  const studio = new CreativeStudioService(prisma as any, llmStub, campaigns);
  return { studio, campaigns, llmStub };
}

function realProviderReturning(text: string) {
  return {
    name: "gemini",
    isRealLlm: true,
    complete: async () => ({ text, model: "gemini-test", inputTokens: 11, outputTokens: 22, tokensEstimated: false }),
  };
}

const devProvider = {
  name: "dev-template",
  isRealLlm: false,
  complete: async () => ({ text: "[DEV TEMPLATE ADAPTER]", model: "dev-template-v1", inputTokens: 1, outputTokens: 1, tokensEstimated: true }),
};

describe("CreativeStudioService.generate — real LLM", () => {
  it("returns 4 policy-checked variants, defaults invalid CTA, writes usage", async () => {
    const prisma = fakePrisma();
    const variants = [
      { headline: "আপনি কি Cotton Panjabi খুঁজছেন?", primaryText: "Cotton Panjabi এখন BDT 1500.00 দামে পাওয়া যাচ্ছে।", callToAction: "SHOP_NOW" },
      { headline: "Cotton Panjabi for everyday comfort", primaryText: "Comfortable cotton panjabi, price BDT 1500.00. Order from our shop today.", callToAction: "INVALID_CTA" },
      { headline: "Simple cotton panjabi", primaryText: "A comfortable cotton panjabi for everyday wear at BDT 1500.00.", callToAction: "BUY_NOW" },
      { headline: "Everyday cotton panjabi", primaryText: "Cotton Panjabi in the clothing category, priced at BDT 1500.00.", callToAction: "LEARN_MORE" },
    ];
    const provider = realProviderReturning(JSON.stringify({ variants }));
    const { studio } = buildService(prisma, provider);
    const res: any = await studio.generate("org-1", "user-1", { productId: "prod-1" });
    expect(res.provider).toBe("gemini");
    expect(res.isRealLlm).toBe(true);
    expect(res.product).toEqual({ id: "prod-1", name: "Cotton Panjabi", price: "BDT 1500.00", currency: "BDT" });
    expect(res.variants).toHaveLength(4);
    expect(res.variants[0].policy.status).toBe("flagged");
    expect(res.variants[0].policy.findings.some((f: any) => f.rule === "personal_attributes")).toBe(true);
    expect(res.variants[1].callToAction).toBe("SHOP_NOW");
    // every variant carries a policy object
    for (const v of res.variants) {
      expect(v.policy).toBeDefined();
      expect(["pass", "flagged"]).toContain(v.policy.status);
      expect(Array.isArray(v.policy.findings)).toBe(true);
    }
    expect(prisma.aIUsageRecord.rows).toHaveLength(1);
    expect(prisma.aIUsageRecord.rows[0].feature).toBe("creative_studio");
    expect(prisma.aIUsageRecord.rows[0].provider).toBe("gemini");
    expect(prisma.aIUsageRecord.rows[0].model).toBe("gemini-test");
    expect(prisma.aIUsageRecord.rows[0].inputTokens).toBe(11);
    expect(prisma.aIUsageRecord.rows[0].outputTokens).toBe(22);
  });

  it("drops malformed variants and rejects when none are usable", async () => {
    const prisma = fakePrisma();
    const mixed = realProviderReturning(JSON.stringify({
      variants: [
        { primaryText: "Missing headline entirely" },
        { headline: "   ", primaryText: "Blank headline" },
        { headline: "Good headline", primaryText: "Good primary text for the product.", callToAction: "SHOP_NOW" },
      ],
    }));
    const { studio } = buildService(prisma, mixed);
    const res: any = await studio.generate("org-1", "user-1", { productId: "prod-1" });
    expect(res.variants).toHaveLength(1);
    expect(res.variants[0].headline).toBe("Good headline");

    const prisma2 = fakePrisma();
    const allBad = realProviderReturning(JSON.stringify({
      variants: [{ primaryText: "No headline" }, { headline: "", primaryText: "" }],
    }));
    const { studio: studio2 } = buildService(prisma2, allBad);
    await expect(studio2.generate("org-1", "user-1", { productId: "prod-1" }))
      .rejects.toMatchObject({ code: "ai.theAiProviderReturnedNoUsable" });
  });

  it("provider errors surface verbatim as BadRequest and write no usage", async () => {
    const prisma = fakePrisma();
    const failing = {
      name: "gemini",
      isRealLlm: true,
      complete: async () => { throw new Error("Gemini quota exceeded (verbatim)"); },
    };
    const { studio } = buildService(prisma, failing);
    await expect(studio.generate("org-1", "user-1", { productId: "prod-1" }))
      .rejects.toThrow("Gemini quota exceeded (verbatim)");
    expect(prisma.aIUsageRecord.rows).toHaveLength(0);
  });
});

describe("CreativeStudioService.generate — dev template", () => {
  it("returns 3 template variants with notice, estimated usage, and the real price", async () => {
    const prisma = fakePrisma();
    const { studio } = buildService(prisma, devProvider);
    const res: any = await studio.generate("org-1", "user-1", { productId: "prod-1" });
    expect(res.provider).toBe("dev-template");
    expect(res.isRealLlm).toBe(false);
    expect(res.variants).toHaveLength(3);
    expect(res.notice).toBeTruthy();
    expect(res.notice).toContain("Dev Template Adapter");
    const allText = res.variants.map((v: any) => `${v.headline} ${v.primaryText}`).join("\n");
    expect(allText).toContain("BDT 1500.00");
    expect(prisma.aIUsageRecord.rows).toHaveLength(1);
    expect(prisma.aIUsageRecord.rows[0].feature).toBe("creative_studio");
    expect(prisma.aIUsageRecord.rows[0].provider).toBe("dev-template");
    expect(prisma.aIUsageRecord.rows[0].model).toBe("dev-template-v1");
    expect(prisma.aIUsageRecord.rows[0].estimated).toBe(true);
    for (const v of res.variants) expect(v.policy).toBeDefined();
  });

  it("english dev templates carry the english notice", async () => {
    const prisma = fakePrisma();
    const { studio } = buildService(prisma, devProvider);
    const res: any = await studio.generate("org-1", "user-1", { productId: "prod-1", language: "en" });
    expect(res.variants).toHaveLength(3);
    expect(res.notice).toContain("No real AI (LLM) is configured");
    expect(res.variants.map((v: any) => v.primaryText).join(" ")).toContain("BDT 1500.00");
  });
});

describe("CreativeStudioService.generate — guards", () => {
  it("product from another org / missing product is NotFound", async () => {
    const prisma = fakePrisma();
    prisma.product.rows.push({
      id: "prod-other", organizationId: "org-OTHER", name: "Other", priceMinor: 10000n, compareAtMinor: null,
      currency: "BDT", category: null, description: null, stockQuantity: null, imageUrl: null,
    });
    const { studio } = buildService(prisma, devProvider);
    await expect(studio.generate("org-1", "user-1", { productId: "prod-other" })).rejects.toMatchObject({ code: "ai.productNotFoundInThisOrganization" });
    await expect(studio.generate("org-1", "user-1", { productId: "missing" })).rejects.toMatchObject({ code: "ai.productNotFoundInThisOrganization" });
  });

  it("kill switch blocks with 403 before anything else", async () => {
    const prisma = fakePrisma();
    prisma.systemSetting.rows.push({ key: "killSwitches", value: { aiDisabledOrgIds: ["org-1"] } });
    const { studio } = buildService(prisma, devProvider);
    let caught: any = null;
    try {
      await studio.generate("org-1", "user-1", { productId: "prod-1" });
    } catch (e) { caught = e; }
    expect(caught).not.toBeNull();
    expect(caught.getStatus ? caught.getStatus() : caught.status).toBe(403);
    expect(caught.message).toContain("AI features প্ল্যাটফর্ম team দ্বারা এই organization-এর জন্য সাময়িকভাবে বন্ধ আছে।");
  });

  it("daily cap for creative_studio blocks with 429 once the limit is used", async () => {
    const prisma = fakePrisma();
    prisma.organization.rows.push({ id: "org-1", aiDailyLimitOverride: 1, broadcastCapOverride: null, seatLimit: null });
    prisma.aIUsageRecord.rows.push({
      id: "usage-seed", organizationId: "org-1", userId: "user-1", feature: "creative_studio",
      provider: "dev-template", createdAt: new Date(),
    });
    const { studio } = buildService(prisma, devProvider);
    let caught: any = null;
    try {
      await studio.generate("org-1", "user-1", { productId: "prod-1" });
    } catch (e) { caught = e; }
    expect(caught).not.toBeNull();
    expect(caught.getStatus ? caught.getStatus() : caught.status).toBe(429);
    expect(caught.message).toContain("এই organization-এর জন্য daily AI generation limit পূর্ণ হয়েছে (1)");
  });
});

describe("CreativeStudioService.createDraft", () => {
  it("happy path creates a draft plan/adSet/ad through CampaignsService", async () => {
    const prisma = fakePrisma();
    const { studio } = buildService(prisma, devProvider);
    const res: any = await studio.createDraft("org-1", "user-1", {
      productId: "prod-1",
      adAccountId: "acc-1",
      headline: "Cotton Panjabi headline",
      primaryText: "Comfortable cotton panjabi at BDT 1500.00.",
    });
    expect(res.status).toBe("draft");
    expect(res.planId).toBeTruthy();
    expect(res.adSetId).toBeTruthy();
    expect(res.adId).toBeTruthy();
    expect(res.note).toBeTruthy();
    expect(res.policy).toBeDefined();
    expect(prisma.campaignPlan.rows).toHaveLength(1);
    expect(prisma.campaignPlan.rows[0].id).toBe(res.planId);
    expect(prisma.campaignPlan.rows[0].status).toBe("draft");
    expect(prisma.campaignPlan.rows[0].name).toBe("AI Studio: Cotton Panjabi");
    expect(prisma.campaignAdSet.rows).toHaveLength(1);
    expect(prisma.campaignAdSet.rows[0].id).toBe(res.adSetId);
    expect(prisma.campaignAd.rows).toHaveLength(1);
    const ad = prisma.campaignAd.rows[0];
    expect(ad.id).toBe(res.adId);
    expect(ad.createdByAi).toBe(true);
    expect(ad.productId).toBe("prod-1");
    expect(ad.linkUrl).toBe("https://shop.example");
    expect(ad.imageUrl).toBe("https://shop.example/panjabi.jpg");
    expect(ad.callToAction).toBe("SHOP_NOW");
  });

  it("without linkUrl and without a business website it throws the landing-link message", async () => {
    const prisma = fakePrisma();
    prisma.businessProfile.rows[0].websiteUrl = null;
    const { studio } = buildService(prisma, devProvider);
    await expect(studio.createDraft("org-1", "user-1", {
      productId: "prod-1",
      adAccountId: "acc-1",
      headline: "Some headline",
      primaryText: "Some primary text",
    })).rejects.toMatchObject({ code: "ai.aLandingLinkIsRequiredPass" });
    expect(prisma.campaignPlan.rows).toHaveLength(0);
  });

  it("invalid callToAction is rejected", async () => {
    const prisma = fakePrisma();
    const { studio } = buildService(prisma, devProvider);
    await expect(studio.createDraft("org-1", "user-1", {
      productId: "prod-1",
      adAccountId: "acc-1",
      headline: "Some headline",
      primaryText: "Some primary text",
      callToAction: "NOT_A_CTA",
      linkUrl: "https://shop.example/product",
    })).rejects.toThrow("callToAction");
    expect(prisma.campaignPlan.rows).toHaveLength(0);
  });

  it("STUDIO_CTAS contains the documented values", () => {
    expect(STUDIO_CTAS).toContain("SHOP_NOW");
    expect(STUDIO_CTAS).toContain("SEND_WHATSAPP_MESSAGE");
    expect(STUDIO_CTAS).toHaveLength(14);
  });
});
