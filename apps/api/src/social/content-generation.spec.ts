import { BadRequestException, HttpException, NotFoundException } from "@nestjs/common";
import {
  ContentGenerationService,
  CONTENT_GENERATION_MAX_VARIANTS,
  LlmNotConfiguredError,
} from "./content-generation.service";

/**
 * SA-B19 (G1) — AI Social Content Generation:
 * - grounding: the prompt pack is built ONLY from the live
 *   product row / the APPROVED LearnedItem / the staff topic
 *   (+ business facts); a product's price joins ONLY on the
 *   caller's includePrice opt-in; a suggested LearnedItem is
 *   refused as a topic source and the LLM is never called.
 * - the shared number guard: a variant carrying a number the
 *   fact pack does not contain is DROPPED (never edited); an
 *   all-invented run fails honestly and creates nothing.
 *   Exemplar numbers are NOT in the allowed set — style
 *   references lend style, never facts.
 * - SA-B16 exemplars ride in the prompt when they exist and
 *   are absent cleanly when none qualify.
 * - draft-only persistence: survivors become real drafts via
 *   SocialService.createPost (spy) with NO scheduledAt, stamped
 *   autoDraftKind "ai_content" + the source ref (Item 2).
 * - no real LLM -> the typed LlmNotConfiguredError (503,
 *   code LLM_NOT_CONFIGURED), no usage row, no drafts.
 * - cross-org isolation: another org's product / learned item
 *   id resolves to 404 under this org.
 * - the variant cap is a named constant and binds even when
 *   the provider returns more.
 */

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
      return take ? f.slice(0, take) : f;
    },
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
  };
}

function fakePrisma() {
  const tables: any = {
    product: makeTable("product"),
    businessProfile: makeTable("bp"),
    aiBrandVoiceProfile: makeTable("voice"),
    learnedItem: makeTable("learned"),
    aIUsageRecord: makeTable("usage"),
    systemSetting: makeTable("setting"),
    organization: makeTable("org"),
    subscription: makeTable("sub"),
  };
  tables.product.rows.push(
    {
      id: "prod-1", organizationId: "org-1", name: "Cotton Panjabi",
      description: "Comfortable cotton panjabi for everyday wear", category: "Men's Fashion",
      status: "ACTIVE", priceMinor: 150000n, compareAtMinor: 200000n, currency: "BDT", stockQuantity: 12,
    },
    {
      id: "prod-2", organizationId: "org-2", name: "OTHER ORG PRODUCT",
      description: "must never leak", category: "Secret", status: "ACTIVE",
      priceMinor: 9900n, compareAtMinor: null, currency: "BDT", stockQuantity: 1,
    },
  );
  tables.businessProfile.rows.push({
    organizationId: "org-1", brandVoice: "friendly and warm", industry: "fashion",
    description: "A Dhaka fashion shop", uniqueSellingPoints: "Hand-finished stitching",
  });
  tables.learnedItem.rows.push(
    {
      id: "learned-approved", organizationId: "org-1", kind: "fact", sourceType: "creative",
      title: "প্রশ্ন-আকারের headline জেতে", content: { text: "CREATIVE_PATTERN_SENTINEL: headline প্রশ্ন-আকারের হলে CTR বাড়ে" },
      status: "approved",
    },
    {
      id: "learned-suggested", organizationId: "org-1", kind: "fact", sourceType: "competitor",
      title: "অনুমোদনহীন ধারণা", content: { text: "UNAPPROVED_SENTINEL" }, status: "suggested",
    },
    {
      id: "learned-other-org", organizationId: "org-2", kind: "fact", sourceType: "creative",
      title: "other org", content: { text: "OTHER_ORG_SENTINEL" }, status: "approved",
    },
  );
  return tables;
}

function capturingProvider(text: string, captured: { messages?: any; calls: number }) {
  return {
    name: "gemini",
    isRealLlm: true,
    complete: async (messages: any) => {
      captured.calls++;
      captured.messages = messages;
      return { text, model: "gemini-test", inputTokens: 11, outputTokens: 22, tokensEstimated: false };
    },
  };
}

const devProvider = {
  name: "dev-template",
  isRealLlm: false,
  complete: async () => ({ text: "[DEV TEMPLATE ADAPTER]", model: "dev-template-v1", inputTokens: 1, outputTokens: 1, tokensEstimated: true }),
};

function buildService(prisma: any, provider: any, opts: { exemplars?: any[] } = {}) {
  const llmStub = { getProvider: () => provider } as any;
  const createPostCalls: any[] = [];
  let postSeq = 0;
  const socialStub = {
    createPost: async (organizationId: string, userId: string, dto: any) => {
      createPostCalls.push({ organizationId, userId, dto });
      return { id: `post-${++postSeq}`, status: "draft", ...dto };
    },
  } as any;
  const creativeStub = {
    computeReport: async () => ({ exemplars: opts.exemplars ?? [] }),
  } as any;
  const svc = new ContentGenerationService(prisma as any, llmStub, socialStub, creativeStub);
  return { svc, createPostCalls };
}

const CLEAN_JSON = JSON.stringify({
  variants: [
    { caption: "Cotton Panjabi — আরামদায়ক কটন পাঞ্জাবি, প্রতিদিনের জন্য।", imageBrief: "A cotton panjabi on a wooden hanger, soft daylight" },
    { caption: "Hand-finished stitching আর আরাম — Cotton Panjabi এখন আমাদের কালেকশনে।", imageBrief: "Close-up of hand stitching" },
  ],
});

describe("ContentGenerationService (SA-B19 / G1)", () => {
  it("grounds on the live product; price joins the fact pack ONLY with includePrice", async () => {
    const prisma = fakePrisma();

    const capturedA: any = { calls: 0 };
    const a = buildService(prisma, capturingProvider(CLEAN_JSON, capturedA));
    await a.svc.generate("org-1", "user-1", { sourceType: "product", productId: "prod-1", socialAccountId: "acc-1" } as any);
    const userA = capturedA.messages.find((m: any) => m.role === "user").content;
    expect(userA).toContain("Cotton Panjabi");
    expect(userA).toContain("Men's Fashion");
    expect(userA).toContain("Comfortable cotton panjabi");
    expect(userA).not.toContain("Price:");

    const capturedB: any = { calls: 0 };
    const b = buildService(prisma, capturingProvider(CLEAN_JSON, capturedB));
    await b.svc.generate("org-1", "user-1", { sourceType: "product", productId: "prod-1", includePrice: true, socialAccountId: "acc-1" } as any);
    const userB = capturedB.messages.find((m: any) => m.role === "user").content;
    expect(userB).toContain("Price:");
    expect(userB).toContain("1500");
  });

  it("files survivors as real DRAFT posts through createPost — no schedule/publish fields, provenance stamped", async () => {
    const prisma = fakePrisma();
    const { svc, createPostCalls } = buildService(prisma, capturingProvider(CLEAN_JSON, { calls: 0 }));
    const res: any = await svc.generate("org-1", "user-1", { sourceType: "product", productId: "prod-1", socialAccountId: "acc-1", count: 2 } as any);
    expect(res.drafts).toHaveLength(2);
    expect(res.droppedCount).toBe(0);
    expect(res.source).toEqual({ type: "product", ref: "product:prod-1" });
    expect(createPostCalls).toHaveLength(2);
    for (const call of createPostCalls) {
      expect(call.organizationId).toBe("org-1");
      expect(call.dto.socialAccountId).toBe("acc-1");
      expect(call.dto.autoDraftKind).toBe("ai_content");
      expect(call.dto.autoDraftRef).toBe("product:prod-1");
      expect("scheduledAt" in call.dto).toBe(false);
      expect("status" in call.dto).toBe(false);
      expect(call.dto.caption).toContain("#fashion");
    }
    expect(res.drafts[0].postId).toBe("post-1");
    // usage accounting: exactly one row, this generator's bucket.
    expect(prisma.aIUsageRecord.rows).toHaveLength(1);
    expect(prisma.aIUsageRecord.rows[0].feature).toBe("content_generation");
  });

  it("refuses an UNAPPROVED learned item as a topic source — the LLM is never called", async () => {
    const prisma = fakePrisma();
    const captured: any = { calls: 0 };
    const { svc, createPostCalls } = buildService(prisma, capturingProvider(CLEAN_JSON, captured));
    await expect(
      svc.generate("org-1", "user-1", { sourceType: "learned_item", learnedItemId: "learned-suggested", socialAccountId: "acc-1" } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(captured.calls).toBe(0);
    expect(createPostCalls).toHaveLength(0);
  });

  it("an APPROVED learned item grounds the prompt and stamps the ref", async () => {
    const prisma = fakePrisma();
    const captured: any = { calls: 0 };
    const { svc } = buildService(prisma, capturingProvider(CLEAN_JSON, captured));
    const res: any = await svc.generate("org-1", "user-1", { sourceType: "learned_item", learnedItemId: "learned-approved", socialAccountId: "acc-1" } as any);
    const userMsg = captured.messages.find((m: any) => m.role === "user").content;
    expect(userMsg).toContain("CREATIVE_PATTERN_SENTINEL");
    expect(res.source.ref).toBe("learned:learned-approved");
    expect(res.drafts.length).toBeGreaterThan(0);
  });

  it("number guard: an invented-price variant is dropped, the clean one is drafted", async () => {
    const prisma = fakePrisma();
    const json = JSON.stringify({
      variants: [
        { caption: "ঈদ অফার! মাত্র ৯৯৯ টাকায় Cotton Panjabi!", imageBrief: "Festive flat-lay" },
        { caption: "ঈদ কালেকশনে Cotton Panjabi — হাতে-বোনা নিখুঁত সেলাই।", imageBrief: "Panjabi detail shot" },
      ],
    });
    const { svc, createPostCalls } = buildService(prisma, capturingProvider(json, { calls: 0 }));
    const res: any = await svc.generate("org-1", "user-1", { sourceType: "topic", topic: "ঈদ কালেকশন", socialAccountId: "acc-1", count: 2 } as any);
    expect(res.droppedCount).toBe(1);
    expect(res.drafts).toHaveLength(1);
    expect(createPostCalls).toHaveLength(1);
    expect(createPostCalls[0].dto.caption).not.toContain("৯৯৯");
  });

  it("number guard: when EVERY variant invents numbers the call fails honestly and creates nothing (usage row stands)", async () => {
    const prisma = fakePrisma();
    const json = JSON.stringify({
      variants: [
        { caption: "৫০% ছাড়ে Cotton Panjabi!", imageBrief: "Sale banner" },
        { caption: "মাত্র ৫০০ টাকায় পেয়ে যান!", imageBrief: "Price tag" },
      ],
    });
    const { svc, createPostCalls } = buildService(prisma, capturingProvider(json, { calls: 0 }));
    await expect(
      svc.generate("org-1", "user-1", { sourceType: "topic", topic: "ঈদ কালেকশন", socialAccountId: "acc-1", count: 2 } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createPostCalls).toHaveLength(0);
    expect(prisma.aIUsageRecord.rows).toHaveLength(1);
  });

  it("exemplar numbers are NOT admitted: a caption echoing the winning ad's discount is dropped", async () => {
    const prisma = fakePrisma();
    const json = JSON.stringify({
      variants: [{ caption: "এখনই কিনুন — ৫০% ছাড় চলছে!", imageBrief: "Bright product photo" }],
    });
    const { svc, createPostCalls } = buildService(prisma, capturingProvider(json, { calls: 0 }), {
      exemplars: [{ primaryText: "গত মাসের সেরা: ৫০% ছাড়ে সব পাঞ্জাবি!", headline: "বড় ছাড়", impressions: 5000, clicks: 400 }],
    });
    await expect(
      svc.generate("org-1", "user-1", { sourceType: "topic", topic: "নতুন কালেকশন", socialAccountId: "acc-1", count: 1 } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createPostCalls).toHaveLength(0);
  });

  it("exemplars ride in the prompt when they exist, and are absent cleanly when none qualify", async () => {
    const prisma = fakePrisma();
    const capturedA: any = { calls: 0 };
    const a = buildService(prisma, capturingProvider(CLEAN_JSON, capturedA), {
      exemplars: [{ primaryText: "EXEMPLAR_STYLE_SENTINEL", headline: "সেরা headline", impressions: 5000, clicks: 400 }],
    });
    const resA: any = await a.svc.generate("org-1", "user-1", { sourceType: "topic", topic: "নতুন কালেকশন", socialAccountId: "acc-1" } as any);
    const allA = capturedA.messages.map((m: any) => m.content).join("\n");
    expect(allA).toContain("Style references");
    expect(allA).toContain("EXEMPLAR_STYLE_SENTINEL");
    expect(resA.exemplarsUsed).toBe(1);

    const capturedB: any = { calls: 0 };
    const b = buildService(prisma, capturingProvider(CLEAN_JSON, capturedB), { exemplars: [] });
    const resB: any = await b.svc.generate("org-1", "user-1", { sourceType: "topic", topic: "নতুন কালেকশন", socialAccountId: "acc-1" } as any);
    const allB = capturedB.messages.map((m: any) => m.content).join("\n");
    expect(allB).not.toContain("Style references");
    expect(resB.exemplarsUsed).toBe(0);
    expect(resB.drafts.length).toBeGreaterThan(0);
  });

  it("language is honoured: en directive on request, bn by default", async () => {
    const prisma = fakePrisma();
    const capturedEn: any = { calls: 0 };
    await buildService(prisma, capturingProvider(CLEAN_JSON, capturedEn)).svc.generate(
      "org-1", "user-1", { sourceType: "topic", topic: "New collection", language: "en", socialAccountId: "acc-1" } as any,
    );
    expect(capturedEn.messages.find((m: any) => m.role === "system").content).toContain("Write in English.");

    const capturedBn: any = { calls: 0 };
    await buildService(prisma, capturingProvider(CLEAN_JSON, capturedBn)).svc.generate(
      "org-1", "user-1", { sourceType: "topic", topic: "নতুন কালেকশন", socialAccountId: "acc-1" } as any,
    );
    expect(capturedBn.messages.find((m: any) => m.role === "system").content).toContain("Write in Bengali (Bangla script).");
  });

  it("brand voice: an ACTIVE learned profile's style block leads; a merely-suggested profile changes nothing (owner text fact only)", async () => {
    const prisma = fakePrisma();
    prisma.aiBrandVoiceProfile.rows.push({
      organizationId: "org-1", status: "active",
      traits: { formality: "friendly", emojiUse: "light", greetingStyle: null, languageMix: "mixed", avgSentence: "short", signaturePhrases: ["VOICE_PHRASE_SENTINEL"] },
      exampleSnippets: ["VOICE_SNIPPET_SENTINEL একটি উদাহরণ বাক্য"],
    });
    const capturedA: any = { calls: 0 };
    await buildService(prisma, capturingProvider(CLEAN_JSON, capturedA)).svc.generate(
      "org-1", "user-1", { sourceType: "topic", topic: "নতুন কালেকশন", socialAccountId: "acc-1" } as any,
    );
    const sysA = capturedA.messages.find((m: any) => m.role === "system").content;
    expect(sysA).toContain("VOICE_PHRASE_SENTINEL");

    const prisma2 = fakePrisma();
    prisma2.aiBrandVoiceProfile.rows.push({
      organizationId: "org-1", status: "suggested",
      traits: { formality: "friendly", emojiUse: "light", greetingStyle: null, languageMix: "mixed", avgSentence: "short", signaturePhrases: ["VOICE_PHRASE_SENTINEL"] },
      exampleSnippets: ["VOICE_SNIPPET_SENTINEL একটি উদাহরণ বাক্য"],
    });
    const capturedB: any = { calls: 0 };
    await buildService(prisma2, capturingProvider(CLEAN_JSON, capturedB)).svc.generate(
      "org-1", "user-1", { sourceType: "topic", topic: "নতুন কালেকশন", socialAccountId: "acc-1" } as any,
    );
    const allB = capturedB.messages.map((m: any) => m.content).join("\n");
    expect(allB).not.toContain("VOICE_PHRASE_SENTINEL");
    expect(allB).toContain("Brand voice: friendly and warm");
  });

  it("no real LLM -> typed LlmNotConfiguredError (503 / LLM_NOT_CONFIGURED), no usage row, no drafts", async () => {
    const prisma = fakePrisma();
    const { svc, createPostCalls } = buildService(prisma, devProvider);
    const err: any = await svc
      .generate("org-1", "user-1", { sourceType: "topic", topic: "নতুন কালেকশন", socialAccountId: "acc-1" } as any)
      .catch((e: any) => e);
    expect(err).toBeInstanceOf(LlmNotConfiguredError);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(503);
    expect(err.getResponse().code).toBe("LLM_NOT_CONFIGURED");
    expect(prisma.aIUsageRecord.rows).toHaveLength(0);
    expect(createPostCalls).toHaveLength(0);
  });

  it("cross-org isolation: another org's product / learned item id is a 404 here; nothing is generated or created", async () => {
    const prisma = fakePrisma();
    const captured: any = { calls: 0 };
    const { svc, createPostCalls } = buildService(prisma, capturingProvider(CLEAN_JSON, captured));
    await expect(
      svc.generate("org-1", "user-1", { sourceType: "product", productId: "prod-2", socialAccountId: "acc-1" } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      svc.generate("org-1", "user-1", { sourceType: "learned_item", learnedItemId: "learned-other-org", socialAccountId: "acc-1" } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(captured.calls).toBe(0);
    expect(createPostCalls).toHaveLength(0);
  });

  it("variant cap: count above the named cap is clamped in the prompt and in what gets filed", async () => {
    const prisma = fakePrisma();
    const seven = JSON.stringify({
      variants: Array.from({ length: 7 }, (_, i) => ({ caption: `Cotton Panjabi variant ${["one", "two", "three", "four", "five", "six", "seven"][i]} — আরাম আর স্টাইল।`, imageBrief: "Product photo" })),
    });
    const captured: any = { calls: 0 };
    const { svc, createPostCalls } = buildService(prisma, capturingProvider(seven, captured));
    const res: any = await svc.generate("org-1", "user-1", { sourceType: "topic", topic: "Cotton Panjabi", socialAccountId: "acc-1", count: 99 } as any);
    const sys = captured.messages.find((m: any) => m.role === "system").content;
    expect(sys).toContain(`exactly ${CONTENT_GENERATION_MAX_VARIANTS} variants`);
    expect(res.drafts).toHaveLength(CONTENT_GENERATION_MAX_VARIANTS);
    expect(createPostCalls).toHaveLength(CONTENT_GENERATION_MAX_VARIANTS);
  });
});
