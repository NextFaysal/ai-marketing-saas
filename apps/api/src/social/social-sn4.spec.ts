import { SocialAiService } from "./social-ai.service";

/**
 * SN4 — AI variants / translation / carousel outline:
 * - all three are real-LLM only (non-real provider refuses with
 *   NO usage row), RETURN ONLY (no SocialPost / SocialContentPlan
 *   rows are ever created — only one AIUsageRecord per call, with
 *   the per-feature names social_variants / social_translate /
 *   social_carousel_outline).
 * - the number guard: a variant/slide carrying a number that is
 *   not in the source caption is dropped (droppedCount), a
 *   translation carrying a new number refuses outright, and
 *   numbers present in the source (Latin or Bengali digits)
 *   survive unchanged.
 * Stub shape mirrors social-su4.spec.ts (fakePrisma/makeTable,
 * llm factory stub returning a real or non-real provider).
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
  return {
    product: makeTable("product"),
    businessProfile: makeTable("bp"),
    aIUsageRecord: makeTable("usage"),
    systemSetting: makeTable("setting"),
    organization: makeTable("org"),
    subscription: makeTable("sub"),
    socialContentPlan: makeTable("plan"),
    socialPost: makeTable("post"),
    mediaAsset: makeTable("asset"),
  } as any;
}

function realProviderReturning(text: string, calls?: any[]) {
  return {
    name: "gemini",
    isRealLlm: true,
    complete: async (messages: any, opts: any) => {
      if (calls) calls.push({ messages, opts });
      return { text, model: "gemini-test", inputTokens: 11, outputTokens: 22, tokensEstimated: false };
    },
  };
}

const devProvider = {
  name: "dev-template",
  isRealLlm: false,
  complete: async () => ({ text: "[DEV TEMPLATE ADAPTER]", model: "dev-template-v1", inputTokens: 1, outputTokens: 1, tokensEstimated: true }),
};

function buildAi(prisma: any, provider: any) {
  const llmStub = { getProvider: () => provider } as any;
  return new SocialAiService(prisma as any, llmStub);
}

function expectNoContentRows(prisma: any) {
  expect(prisma.socialPost.rows).toHaveLength(0);
  expect(prisma.socialContentPlan.rows).toHaveLength(0);
}

describe("generateVariants (SN4)", () => {
  const caption = "Cotton Panjabi — price 1500 taka. Comfortable for summer.";

  it("happy path: 2 platforms, shape + platform match, one social_variants usage row, no content rows", async () => {
    const prisma = fakePrisma();
    const json = JSON.stringify({
      variants: [
        { platform: "meta_page", caption: "Cotton Panjabi — price 1500 taka. Comfortable for summer. See details and order now." },
        { platform: "instagram", caption: "Cotton Panjabi, 1500 taka. #panjabi #summer" },
      ],
    });
    const res: any = await buildAi(prisma, realProviderReturning(json))
      .generateVariants("org-1", "user-1", { caption, platforms: ["meta_page", "instagram"] });
    expect(res.provider).toBe("gemini");
    expect(res.isRealLlm).toBe(true);
    expect(res.droppedCount).toBe(0);
    expect(res.variants).toHaveLength(2);
    expect(res.variants.map((v: any) => v.platform)).toEqual(["meta_page", "instagram"]);
    expect(res.variants[0].caption).toContain("1500 taka");
    expect(res.variants[0].policy.status).toBe("pass");
    expect(Array.isArray(res.variants[0].policy.findings)).toBe(true);
    expect(prisma.aIUsageRecord.rows).toHaveLength(1);
    expect(prisma.aIUsageRecord.rows[0].feature).toBe("social_variants");
    expectNoContentRows(prisma);
  });

  it("a variant with an invented price is dropped (droppedCount=1), the grounded one stays", async () => {
    const prisma = fakePrisma();
    const json = JSON.stringify({
      variants: [
        { platform: "meta_page", caption: "Cotton Panjabi — price 1500 taka." },
        { platform: "instagram", caption: "Only 999 taka today! #deal" },
      ],
    });
    const res: any = await buildAi(prisma, realProviderReturning(json))
      .generateVariants("org-1", "user-1", { caption, platforms: ["meta_page", "instagram"] });
    expect(res.droppedCount).toBe(1);
    expect(res.variants).toHaveLength(1);
    expect(res.variants[0].platform).toBe("meta_page");
    expectNoContentRows(prisma);
  });

  it("all variants dropped → throw", async () => {
    const prisma = fakePrisma();
    const json = JSON.stringify({
      variants: [
        { platform: "meta_page", caption: "Only 999 taka!" },
        { platform: "instagram", caption: "Now 50% off — 750 taka!" },
      ],
    });
    await expect(buildAi(prisma, realProviderReturning(json))
      .generateVariants("org-1", "user-1", { caption, platforms: ["meta_page", "instagram"] }))
      .rejects.toThrow("AI কোনো ব্যবহারযোগ্য variant দেয়নি");
    expectNoContentRows(prisma);
  });

  it("non-real provider refuses — no usage row, no post rows", async () => {
    const prisma = fakePrisma();
    await expect(buildAi(prisma, devProvider)
      .generateVariants("org-1", "user-1", { caption, platforms: ["meta_page"] }))
      .rejects.toThrow("আসল AI (LLM) configure করা নেই — Platform Variant বানাতে");
    expect(prisma.aIUsageRecord.rows).toHaveLength(0);
    expectNoContentRows(prisma);
  });

  it("unknown platforms are filtered out and duplicates deduped (only the valid platform is requested/returned)", async () => {
    const prisma = fakePrisma();
    const calls: any[] = [];
    const json = JSON.stringify({
      variants: [
        { platform: "meta_page", caption: "Cotton Panjabi — price 1500 taka." },
        { platform: "myspace", caption: "Cotton Panjabi — price 1500 taka." },
      ],
    });
    const res: any = await buildAi(prisma, realProviderReturning(json, calls))
      .generateVariants("org-1", "user-1", { caption, platforms: ["meta_page", "myspace", "meta_page"] });
    expect(res.variants).toHaveLength(1);
    expect(res.variants[0].platform).toBe("meta_page");
    const userMessage = String(calls[0].messages[1].content);
    expect(userMessage).toContain("meta_page");
    expect(userMessage).not.toContain("myspace");
    expectNoContentRows(prisma);
  });

  it("all-unknown platforms → Bengali 400 before any provider work; empty caption → 400", async () => {
    const prisma = fakePrisma();
    const svc = buildAi(prisma, realProviderReturning("{}"));
    await expect(svc.generateVariants("org-1", "user-1", { caption, platforms: ["myspace"] }))
      .rejects.toThrow("অন্তত একটা সঠিক Platform বেছে নিন");
    await expect(svc.generateVariants("org-1", "user-1", { caption: "   ", platforms: ["meta_page"] }))
      .rejects.toThrow("Caption লিখুন।");
    expect(prisma.aIUsageRecord.rows).toHaveLength(0);
    expectNoContentRows(prisma);
  });
});

describe("translateText (SN4)", () => {
  it("bn→en happy path: grounded number (Bengali digits in source) survives, one social_translate usage row", async () => {
    const prisma = fakePrisma();
    const json = JSON.stringify({ text: "The Panjabi costs 1500 taka. #sale" });
    const res: any = await buildAi(prisma, realProviderReturning(json))
      .translateText("org-1", "user-1", { text: "পাঞ্জাবির দাম ১৫০০ টাকা। #sale", targetLang: "en" });
    expect(res.text).toBe("The Panjabi costs 1500 taka. #sale");
    expect(res.provider).toBe("gemini");
    expect(res.isRealLlm).toBe(true);
    expect(prisma.aIUsageRecord.rows).toHaveLength(1);
    expect(prisma.aIUsageRecord.rows[0].feature).toBe("social_translate");
    expectNoContentRows(prisma);
  });

  it("en→bn happy path: number returned in Bengali digits still counts as the same grounded number", async () => {
    const prisma = fakePrisma();
    const json = JSON.stringify({ text: "দাম ১৫০০ টাকা। #sale" });
    const res: any = await buildAi(prisma, realProviderReturning(json))
      .translateText("org-1", "user-1", { text: "Price 1500 taka. #sale", targetLang: "bn" });
    expect(res.text).toBe("দাম ১৫০০ টাকা। #sale");
    expectNoContentRows(prisma);
  });

  it("a new number in the translation → throw (the translation is not returned)", async () => {
    const prisma = fakePrisma();
    const json = JSON.stringify({ text: "The Panjabi costs 999 taka." });
    await expect(buildAi(prisma, realProviderReturning(json))
      .translateText("org-1", "user-1", { text: "পাঞ্জাবির দাম ১৫০০ টাকা।", targetLang: "en" }))
      .rejects.toThrow("অনুবাদে মূল লেখায় নেই এমন সংখ্যা এসেছে");
    expectNoContentRows(prisma);
  });

  it("non-real provider refuses — no usage row; empty text / bad targetLang → 400", async () => {
    const prisma = fakePrisma();
    await expect(buildAi(prisma, devProvider)
      .translateText("org-1", "user-1", { text: "Hello", targetLang: "en" }))
      .rejects.toThrow("আসল AI (LLM) configure করা নেই");
    expect(prisma.aIUsageRecord.rows).toHaveLength(0);
    expectNoContentRows(prisma);

    const svc = buildAi(prisma, realProviderReturning(JSON.stringify({ text: "x" })));
    await expect(svc.translateText("org-1", "user-1", { text: "  ", targetLang: "en" }))
      .rejects.toThrow("অনুবাদের জন্য লেখা");
    await expect(svc.translateText("org-1", "user-1", { text: "Hello", targetLang: "fr" }))
      .rejects.toThrow("bn অথবা en");
    expect(prisma.aIUsageRecord.rows).toHaveLength(0);
  });
});

describe("generateCarouselOutline (SN4)", () => {
  const caption = "New Cotton Panjabi collection is here. Comfortable cotton for summer days.";

  it("happy path: slides returned, one social_carousel_outline usage row, no content rows", async () => {
    const prisma = fakePrisma();
    const json = JSON.stringify({
      slides: [
        "New collection is here!",
        "Comfortable cotton for summer days",
        "See the full collection",
        "Order yours today",
      ],
    });
    const res: any = await buildAi(prisma, realProviderReturning(json))
      .generateCarouselOutline("org-1", "user-1", { caption });
    expect(res.slides).toHaveLength(4);
    expect(res.slides[0]).toBe("New collection is here!");
    expect(res.droppedCount).toBe(0);
    expect(res.provider).toBe("gemini");
    expect(res.isRealLlm).toBe(true);
    expect(prisma.aIUsageRecord.rows).toHaveLength(1);
    expect(prisma.aIUsageRecord.rows[0].feature).toBe("social_carousel_outline");
    expectNoContentRows(prisma);
  });

  it("a slide with an invented number is dropped, the rest stay", async () => {
    const prisma = fakePrisma();
    const json = JSON.stringify({
      slides: [
        "New collection is here!",
        "Only 500 taka today!",
        "Comfortable cotton for summer days",
        "Order yours today",
      ],
    });
    const res: any = await buildAi(prisma, realProviderReturning(json))
      .generateCarouselOutline("org-1", "user-1", { caption });
    expect(res.droppedCount).toBe(1);
    expect(res.slides).toHaveLength(3);
    expect(res.slides.some((s: string) => s.includes("500"))).toBe(false);
    expectNoContentRows(prisma);
  });

  it("fewer than 2 surviving slides → throw", async () => {
    const prisma = fakePrisma();
    const one = JSON.stringify({ slides: ["Only one slide"] });
    await expect(buildAi(prisma, realProviderReturning(one))
      .generateCarouselOutline("org-1", "user-1", { caption }))
      .rejects.toThrow("AI কোনো ব্যবহারযোগ্য carousel outline দেয়নি");

    const prisma2 = fakePrisma();
    const droppedToOne = JSON.stringify({ slides: ["Real slide", "Only 500 taka!"] });
    await expect(buildAi(prisma2, realProviderReturning(droppedToOne))
      .generateCarouselOutline("org-1", "user-1", { caption }))
      .rejects.toThrow("AI কোনো ব্যবহারযোগ্য carousel outline দেয়নি");
    expectNoContentRows(prisma2);
  });

  it("non-real provider refuses — no usage row, no content rows; empty caption → 400", async () => {
    const prisma = fakePrisma();
    await expect(buildAi(prisma, devProvider)
      .generateCarouselOutline("org-1", "user-1", { caption }))
      .rejects.toThrow("আসল AI (LLM) configure করা নেই — Carousel Outline বানাতে");
    expect(prisma.aIUsageRecord.rows).toHaveLength(0);
    expectNoContentRows(prisma);

    await expect(buildAi(prisma, realProviderReturning("{}"))
      .generateCarouselOutline("org-1", "user-1", { caption: "   " }))
      .rejects.toThrow("Caption লিখুন।");
    expect(prisma.aIUsageRecord.rows).toHaveLength(0);
  });
});
