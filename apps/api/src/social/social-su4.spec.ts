import { SocialAiService } from "./social-ai.service";
import { SocialInsightsService, aggregateHashtagPerformance, extractHashtags } from "./social-insights.service";

/**
 * SU4 — AI Content Engine v2:
 * - hashtag performance is a pure aggregation over the org's
 *   OWN published posts (engagementScore discipline: a post
 *   with no usable insights fields never counts).
 * - content plan: real-LLM only (non-real provider refuses with
 *   NO plan row and NO usage row), per-feature usage
 *   ("social_content_plan"), and the caption number guard drops
 *   items with invented numbers while grounded prices survive.
 * - script: returned only — no SocialPost/MediaAsset rows are
 *   ever created; usage feature "social_script".
 * - materialize: plan items become drafts through a stubbed
 *   SocialService.createPost (+ PP3 importer stub); already-
 *   materialized items skip, bad indexes fail per-item, and the
 *   plan status tracks partial/full materialization.
 */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && "gte" in (v as any)) {
      return new Date(row[k]) >= (v as any).gte;
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
  };
}

function fakePrisma() {
  const tables: any = {
    product: makeTable("product"),
    businessProfile: makeTable("bp"),
    aIUsageRecord: makeTable("usage"),
    systemSetting: makeTable("setting"),
    organization: makeTable("org"),
    subscription: makeTable("sub"),
    socialContentPlan: makeTable("plan"),
    socialPost: makeTable("post"),
    mediaAsset: makeTable("asset"),
  };
  tables.product.rows.push({
    id: "prod-1", organizationId: "org-1", name: "Cotton Panjabi",
    description: "Comfortable cotton panjabi", category: "Men's Fashion",
    status: "ACTIVE", priceMinor: 150000n, compareAtMinor: 200000n,
    currency: "BDT", stockQuantity: 12, imageUrl: "https://cdn.example/panjabi.jpg",
    createdAt: new Date(),
  });
  tables.businessProfile.rows.push({
    organizationId: "org-1", brandVoice: "friendly", industry: "fashion",
    description: "A Dhaka fashion shop", uniqueSellingPoints: "Hand-finished stitching",
  });
  return tables;
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

function buildAi(prisma: any, provider: any, extra: (svc: SocialAiService) => void = () => undefined) {
  const llmStub = { getProvider: () => provider } as any;
  const svc = new SocialAiService(prisma as any, llmStub);
  extra(svc);
  return svc;
}

describe("hashtags — pure helpers", () => {
  it("extractHashtags: unicode-aware, lowercased, deduped per post", () => {
    // The frozen regex is [\p{L}\p{N}_]+: Bengali vowel signs are
    // combining marks (not \p{L}), so "#ঈদ" matches fully while a
    // tag like "#অফার" stops at the া — the contracted behaviour,
    // identical on the web side.
    expect(extractHashtags("Hello #Sale #sale #ঈদ #EID2026! and #sale")).toEqual(["sale", "ঈদ", "eid2026"]);
    expect(extractHashtags("no tags here")).toEqual([]);
    expect(extractHashtags(null)).toEqual([]);
    expect(extractHashtags(undefined)).toEqual([]);
  });

  it("aggregate: sums engagementScore per tag, null-score posts excluded, duplicate tag in one post counts once", () => {
    const posts = [
      { caption: "#sale #new #sale", insights: { reactions: 10, comments: 5, shares: 5 } }, // score 20
      { caption: "#sale", insights: { reactions: 4, comments: 1, shares: 0 } }, // score 5
      { caption: "#sale #ghost", insights: null }, // excluded entirely
      { caption: "#quiet", insights: { impressions: 100 } }, // no engagement fields → excluded
    ];
    const tags = aggregateHashtagPerformance(posts);
    expect(tags).toEqual([
      { tag: "#sale", posts: 2, totalEngagement: 25, avgEngagement: 12.5 },
      { tag: "#new", posts: 1, totalEngagement: 20, avgEngagement: 20 },
    ]);
  });
});

describe("hashtagPerformance service", () => {
  function buildInsights(prisma: any) {
    const audit = { log: async () => undefined } as any;
    return new SocialInsightsService(prisma as any, audit, {} as any, {} as any);
  }

  it("empty org → no tags, postsConsidered 0", async () => {
    const prisma = fakePrisma();
    const res: any = await buildInsights(prisma).hashtagPerformance("org-1");
    expect(res).toEqual({ tags: [], postsConsidered: 0 });
  });

  it("counts only published posts with a score, in this org", async () => {
    const prisma = fakePrisma();
    prisma.socialPost.rows.push(
      { id: "p1", organizationId: "org-1", status: "published", caption: "#eid drop", insights: { reactions: 3, comments: 1, shares: 1 } },
      { id: "p2", organizationId: "org-1", status: "draft", caption: "#eid draft", insights: { reactions: 99, comments: 0, shares: 0 } },
      { id: "p3", organizationId: "org-2", status: "published", caption: "#eid other", insights: { reactions: 50, comments: 0, shares: 0 } },
      { id: "p4", organizationId: "org-1", status: "published", caption: "no insights", insights: null },
    );
    const res: any = await buildInsights(prisma).hashtagPerformance("org-1");
    expect(res.postsConsidered).toBe(1);
    expect(res.tags).toEqual([{ tag: "#eid", posts: 1, totalEngagement: 5, avgEngagement: 5 }]);
  });
});

describe("generateContentPlan", () => {
  const planJson = JSON.stringify({
    items: [
      { day: 5, pillar: "offer", productId: "prod-1", caption: "Cotton Panjabi এখন BDT 1500.00 দামে।", mediaIdea: "product photo" },
      { day: 9, pillar: "offer", productId: "prod-1", caption: "আজ মাত্র ৯৯৯ টাকায় পাঞ্জাবি!", mediaIdea: "poster" },
      { day: 2, pillar: "tips", productId: "not-a-product", caption: "নতুন কালেকশন এসেছে — দেখে নিন।", mediaIdea: "reel" },
    ],
  });

  it("creates the plan, drops the invented-price item, nulls an unknown productId, writes one social_content_plan usage row", async () => {
    const prisma = fakePrisma();
    const res: any = await buildAi(prisma, realProviderReturning(planJson))
      .generateContentPlan("org-1", "user-1", { month: "2026-11" });
    expect(res.provider).toBe("gemini");
    expect(res.droppedItems).toBe(1);
    expect(res.plan.month).toBe("2026-11");
    expect(res.plan.status).toBe("generated");
    expect(res.plan.pillars).toEqual(["product_showcase", "offer", "customer_review", "tips"]);
    expect(res.plan.items).toHaveLength(2);
    const captions = res.plan.items.map((i: any) => i.caption);
    expect(captions.some((c: string) => c.includes("৯৯৯"))).toBe(false);
    const grounded = res.plan.items.find((i: any) => i.day === 5);
    expect(grounded.productId).toBe("prod-1");
    expect(grounded.productName).toBe("Cotton Panjabi");
    const unknown = res.plan.items.find((i: any) => i.day === 2);
    expect(unknown.productId).toBeNull();
    expect(unknown.productName).toBeNull();
    expect(prisma.socialContentPlan.rows).toHaveLength(1);
    expect(prisma.aIUsageRecord.rows).toHaveLength(1);
    expect(prisma.aIUsageRecord.rows[0].feature).toBe("social_content_plan");
  });

  it("non-real provider refuses — no plan row, no usage row", async () => {
    const prisma = fakePrisma();
    await expect(buildAi(prisma, devProvider).generateContentPlan("org-1", "user-1", { month: "2026-11" }))
      .rejects.toThrow("আসল AI (LLM) configure করা নেই");
    expect(prisma.socialContentPlan.rows).toHaveLength(0);
    expect(prisma.aIUsageRecord.rows).toHaveLength(0);
  });

  it("kill switch blocks with 403 before anything is written", async () => {
    const prisma = fakePrisma();
    prisma.systemSetting.rows.push({ key: "killSwitches", value: { aiDisabledOrgIds: ["org-1"] } });
    let caught: any = null;
    try {
      await buildAi(prisma, realProviderReturning(planJson)).generateContentPlan("org-1", "user-1", { month: "2026-11" });
    } catch (e) { caught = e; }
    expect(caught).not.toBeNull();
    expect(caught.getStatus ? caught.getStatus() : caught.status).toBe(403);
    expect(prisma.socialContentPlan.rows).toHaveLength(0);
    expect(prisma.aIUsageRecord.rows).toHaveLength(0);
  });

  it("the daily cap is per-feature: social_copy usage does not block the plan, social_content_plan usage does", async () => {
    const prisma = fakePrisma();
    prisma.organization.rows.push({ id: "org-1", aiDailyLimitOverride: 1, broadcastCapOverride: null, seatLimit: null });
    prisma.aIUsageRecord.rows.push({
      id: "u-copy", organizationId: "org-1", userId: "user-1", feature: "social_copy", provider: "gemini", createdAt: new Date(),
    });
    const ok: any = await buildAi(prisma, realProviderReturning(planJson))
      .generateContentPlan("org-1", "user-1", { month: "2026-11" });
    expect(ok.plan.items.length).toBeGreaterThan(0);

    const prisma2 = fakePrisma();
    prisma2.organization.rows.push({ id: "org-1", aiDailyLimitOverride: 1, broadcastCapOverride: null, seatLimit: null });
    prisma2.aIUsageRecord.rows.push({
      id: "u-plan", organizationId: "org-1", userId: "user-1", feature: "social_content_plan", provider: "gemini", createdAt: new Date(),
    });
    let caught: any = null;
    try {
      await buildAi(prisma2, realProviderReturning(planJson)).generateContentPlan("org-1", "user-1", { month: "2026-11" });
    } catch (e) { caught = e; }
    expect(caught).not.toBeNull();
    expect(caught.getStatus ? caught.getStatus() : caught.status).toBe(429);
  });

  it("no active products and no focus → Bengali 400; with a focus it proceeds", async () => {
    const prisma = fakePrisma();
    prisma.product.rows.length = 0;
    await expect(buildAi(prisma, realProviderReturning(planJson)).generateContentPlan("org-1", "user-1", { month: "2026-11" }))
      .rejects.toThrow("কোনো সক্রিয় Product নেই — আগে Product যোগ করুন অথবা একটা Focus লিখুন।");

    const prisma2 = fakePrisma();
    prisma2.product.rows.length = 0;
    const focusJson = JSON.stringify({ items: [{ day: 3, pillar: "tips", productId: null, caption: "ঈদের প্রস্তুতি নিয়ে টিপস।", mediaIdea: "photo" }] });
    const res: any = await buildAi(prisma2, realProviderReturning(focusJson))
      .generateContentPlan("org-1", "user-1", { month: "2026-11", focus: "ঈদ প্রস্তুতি" });
    expect(res.plan.items).toHaveLength(1);
  });

  it("bad month → Bengali 400", async () => {
    const prisma = fakePrisma();
    await expect(buildAi(prisma, realProviderReturning(planJson)).generateContentPlan("org-1", "user-1", { month: "2026-13" }))
      .rejects.toThrow("মাস সঠিক YYYY-MM আকারে দিন");
  });
});

describe("generateScript", () => {
  const scriptJson = JSON.stringify({
    hook: "এই পাঞ্জাবিটা পরলেই বুঝবেন!",
    onScreenText: ["Cotton Panjabi", "BDT 1500.00"],
    shotList: ["ক্লোজ-আপ শট", "ফুল শট"],
    captionDraft: "Cotton Panjabi — BDT 1500.00।",
  });

  it("returns the script shape, creates NO post/asset rows, writes one social_script usage row", async () => {
    const prisma = fakePrisma();
    const res: any = await buildAi(prisma, realProviderReturning(scriptJson))
      .generateScript("org-1", "user-1", { productId: "prod-1", topic: "ঈদ পাঞ্জাবি রিল" });
    expect(res.hook).toBe("এই পাঞ্জাবিটা পরলেই বুঝবেন!");
    expect(res.onScreenText).toEqual(["Cotton Panjabi", "BDT 1500.00"]);
    expect(res.shotList).toEqual(["ক্লোজ-আপ শট", "ফুল শট"]);
    expect(res.captionDraft).toContain("BDT 1500.00");
    expect(res.provider).toBe("gemini");
    expect(res.isRealLlm).toBe(true);
    expect(prisma.socialPost.rows).toHaveLength(0);
    expect(prisma.mediaAsset.rows).toHaveLength(0);
    expect(prisma.aIUsageRecord.rows).toHaveLength(1);
    expect(prisma.aIUsageRecord.rows[0].feature).toBe("social_script");
  });

  it("non-real provider refuses with no usage; empty topic → 400; missing product → 404", async () => {
    const prisma = fakePrisma();
    await expect(buildAi(prisma, devProvider).generateScript("org-1", "user-1", { topic: "রিল" }))
      .rejects.toThrow("আসল AI (LLM) configure করা নেই");
    expect(prisma.aIUsageRecord.rows).toHaveLength(0);

    const svc = buildAi(prisma, realProviderReturning(scriptJson));
    await expect(svc.generateScript("org-1", "user-1", { topic: "   " })).rejects.toThrow("একটা বিষয় (Topic) লিখুন।");
    await expect(svc.generateScript("org-1", "user-1", { productId: "nope", topic: "রিল" }))
      .rejects.toMatchObject({ code: "social.productNotFoundInThisOrganization" });
  });
});

describe("materializePlan", () => {
  function buildMaterializer(prisma: any) {
    const createPostCalls: any[] = [];
    const socialStub = {
      createPost: async (_org: string, _user: string, dto: any) => {
        createPostCalls.push(dto);
        return { id: `post-${createPostCalls.length}`, ...dto };
      },
    };
    const importCalls: string[] = [];
    const importerStub = {
      importForProduct: async (_org: string, _user: string, productId: string) => {
        importCalls.push(productId);
        return { id: "asset-9", kind: "image" };
      },
    };
    const auditRows: any[] = [];
    const auditStub = { log: async (input: any) => { auditRows.push(input); } };
    const llmStub = { getProvider: () => devProvider } as any;
    const svc = new SocialAiService(prisma as any, llmStub, socialStub as any, importerStub as any, auditStub as any);
    return { svc, createPostCalls, importCalls, auditRows };
  }

  function seedPlan(prisma: any) {
    prisma.socialContentPlan.rows.push({
      id: "plan-1", organizationId: "org-1", month: "2026-11",
      pillars: ["product_showcase"],
      items: [
        { day: 1, pillar: "product_showcase", productId: "prod-1", productName: "Cotton Panjabi", caption: "Caption A", mediaIdea: "" },
        { day: 2, pillar: "tips", productId: null, productName: null, caption: "Caption B", mediaIdea: "" },
        { day: 3, pillar: "product_showcase", productId: "prod-1", productName: "Cotton Panjabi", caption: "Caption C", mediaIdea: "" },
      ],
      status: "generated", createdById: "user-1", createdAt: new Date(), updatedAt: new Date(),
    });
  }

  it("creates drafts (product image imported + attached), tracks partial → full status, skips on re-run, fails bad indexes per-item", async () => {
    const prisma = fakePrisma();
    seedPlan(prisma);
    const { svc, createPostCalls, importCalls, auditRows } = buildMaterializer(prisma);

    const first: any = await svc.materializePlan("org-1", "user-1", "plan-1", { itemIndexes: [0, 1, 9], socialAccountId: "acc-1" });
    expect(first.results).toEqual([
      { index: 0, status: "created", postId: "post-1" },
      { index: 1, status: "created", postId: "post-2" },
      { index: 9, status: "failed", error: "item পাওয়া যায়নি" },
    ]);
    // item 0 carries the imported product image; item 1 is text-only
    expect(createPostCalls[0].mediaRefs).toEqual([{ assetId: "asset-9", kind: "image" }]);
    expect(createPostCalls[0].caption).toBe("Caption A");
    expect(createPostCalls[1].mediaRefs).toEqual([]);
    expect(importCalls).toEqual(["prod-1"]);
    expect(first.plan.status).toBe("partially_materialized");
    expect(auditRows.some((r: any) => r.action === "social.content_plan_materialized")).toBe(true);

    // re-running an already-materialized item skips it — no new draft
    const second: any = await svc.materializePlan("org-1", "user-1", "plan-1", { itemIndexes: [0], socialAccountId: "acc-1" });
    expect(second.results[0].status).toBe("skipped");
    expect(second.results[0].error).toContain("ইতিমধ্যে draft তৈরি হয়েছে");
    expect(createPostCalls).toHaveLength(2);

    const third: any = await svc.materializePlan("org-1", "user-1", "plan-1", { itemIndexes: [2], socialAccountId: "acc-1" });
    expect(third.results[0].status).toBe("created");
    expect(third.plan.status).toBe("materialized");
    const stored = prisma.socialContentPlan.rows[0];
    expect(stored.items.every((i: any) => i.materializedPostId)).toBe(true);
  });

  it("plan from another org → 404; without social/importer injected → honest Bengali 400", async () => {
    const prisma = fakePrisma();
    seedPlan(prisma);
    const { svc } = buildMaterializer(prisma);
    await expect(svc.materializePlan("org-2", "user-9", "plan-1", { itemIndexes: [0], socialAccountId: "acc-1" }))
      .rejects.toMatchObject({ code: "social.contentPlanNotFoundInThis" });

    const bare = buildAi(prisma, devProvider);
    await expect(bare.materializePlan("org-1", "user-1", "plan-1", { itemIndexes: [0], socialAccountId: "acc-1" }))
      .rejects.toThrow("উপলব্ধ নয়");
  });

  it("listContentPlans is newest-first and org-scoped; getContentPlan 404s cross-org", async () => {
    const prisma = fakePrisma();
    seedPlan(prisma);
    const svc = buildAi(prisma, devProvider);
    const list: any[] = await svc.listContentPlans("org-1");
    expect(list).toHaveLength(1);
    expect(list[0].month).toBe("2026-11");
    expect(await svc.listContentPlans("org-2")).toEqual([]);
    const one: any = await svc.getContentPlan("org-1", "plan-1");
    expect(one.id).toBe("plan-1");
    await expect(svc.getContentPlan("org-2", "plan-1")).rejects.toMatchObject({ code: "social.contentPlanNotFoundInThis" });
  });
});
