import { SocialAiService, suggestSocialHashtags } from "./social-ai.service";
import { SocialService, normalizeHashtagTags } from "./social.service";

/**
 * SP3 — AI Copy for social posts + hashtag sets:
 * - mirrors M55 Creative Studio: kill switch / daily cap BEFORE
 *   any load (feature "social_copy"), grounded facts only, usage
 *   row after provider success and before parsing, provider errors
 *   verbatim with zero usage, dev-template path honestly labelled.
 * - policy findings attached per variant (M24 policy-check).
 * - hashtags are deterministic from grounded fields only.
 * - hashtag sets: org-scoped CRUD, normalization, duplicate-name
 *   conflict, 30-tag cap — all through the same fake-prisma style
 *   as creative-studio.spec.ts.
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
    systemSetting: makeTable("setting"),
    organization: makeTable("org"),
    subscription: makeTable("sub"),
    socialHashtagSet: makeTable("tagset"),
  };
  tables.product.rows.push({
    id: "prod-1",
    organizationId: "org-1",
    name: "Cotton Panjabi",
    description: "Comfortable cotton panjabi for everyday wear",
    category: "Men's Fashion",
    status: "ACTIVE",
    priceMinor: 150000n,
    compareAtMinor: 200000n,
    currency: "BDT",
    stockQuantity: 12,
  });
  tables.businessProfile.rows.push({
    organizationId: "org-1",
    websiteUrl: "https://shop.example",
    brandVoice: "friendly",
    industry: "fashion",
    description: "A Dhaka fashion shop",
    uniqueSellingPoints: "Hand-finished stitching",
  });
  return tables;
}

function buildAi(prisma: any, provider: any) {
  const llmStub = { getProvider: () => provider } as any;
  return new SocialAiService(prisma as any, llmStub);
}

function capturingProvider(text: string, captured: { messages?: any; opts?: any }) {
  return {
    name: "gemini",
    isRealLlm: true,
    complete: async (messages: any, opts: any) => {
      captured.messages = messages;
      captured.opts = opts;
      return { text, model: "gemini-test", inputTokens: 11, outputTokens: 22, tokensEstimated: false };
    },
  };
}

function realProviderReturning(text: string) {
  return capturingProvider(text, {});
}

const devProvider = {
  name: "dev-template",
  isRealLlm: false,
  complete: async () => ({ text: "[DEV TEMPLATE ADAPTER]", model: "dev-template-v1", inputTokens: 1, outputTokens: 1, tokensEstimated: true }),
};

describe("SocialAiService.generateCopy — real LLM", () => {
  it("parses JSON variants, attaches policy per variant, writes a social_copy usage row, echoes the real price", async () => {
    const prisma = fakePrisma();
    const provider = realProviderReturning(JSON.stringify({
      variants: [
        { caption: "Cotton Panjabi এখন BDT 1500.00 দামে।" },
        { caption: "   " },
        { caption: "Comfortable cotton panjabi for everyday wear — BDT 1500.00." },
      ],
    }));
    const res: any = await buildAi(prisma, provider).generateCopy("org-1", "user-1", { productId: "prod-1", count: 5 });
    expect(res.provider).toBe("gemini");
    expect(res.isRealLlm).toBe(true);
    expect(res.product).toEqual({ id: "prod-1", name: "Cotton Panjabi", price: "BDT 1500.00", currency: "BDT" });
    expect(res.variants).toHaveLength(2); // the blank caption is skipped
    for (const v of res.variants) {
      expect(typeof v.caption).toBe("string");
      expect(v.policy.status).toBe("pass");
      expect(v.policy.findings).toEqual([]);
    }
    expect(prisma.aIUsageRecord.rows).toHaveLength(1);
    const usage = prisma.aIUsageRecord.rows[0];
    expect(usage.feature).toBe("social_copy");
    expect(usage.provider).toBe("gemini");
    expect(usage.model).toBe("gemini-test");
    expect(usage.inputTokens).toBe(11);
    expect(usage.outputTokens).toBe(22);
    expect(usage.estimated).toBe(false);
    expect(Array.isArray(res.hashtags)).toBe(true);
    expect(res.hashtags).toContain("#cotton");
  });

  it("prompt grounding: user content carries the real facts, system prompt forbids inventing, topic-only facts carry NO price line", async () => {
    const prisma = fakePrisma();
    const captured: any = {};
    const provider = capturingProvider(JSON.stringify({ variants: [{ caption: "ok" }] }), captured);
    await buildAi(prisma, provider).generateCopy("org-1", "user-1", { productId: "prod-1" });
    const system = captured.messages.find((m: any) => m.role === "system").content as string;
    const user = captured.messages.find((m: any) => m.role === "user").content as string;
    expect(system).toContain("Never invent prices, discounts, stock, delivery promises, features or results");
    expect(system).toContain("If no price is among the facts, do not mention any price");
    expect(user).toContain("Cotton Panjabi");
    expect(user).toContain("BDT 1500.00");
    expect(user).toContain("Price: BDT 1500.00");
    expect(captured.opts).toEqual({ jsonMode: true, maxTokens: 1400 });

    const prisma2 = fakePrisma();
    const captured2: any = {};
    const provider2 = capturingProvider(JSON.stringify({ variants: [{ caption: "ঈদ কালেকশন আসছে" }] }), captured2);
    const res2: any = await buildAi(prisma2, provider2).generateCopy("org-1", "user-1", { topic: "ঈদ কালেকশন লঞ্চ" });
    const user2 = captured2.messages.find((m: any) => m.role === "user").content as string;
    expect(user2).toContain("Topic: ঈদ কালেকশন লঞ্চ");
    expect(user2).not.toContain("Price:");
    expect(user2).not.toContain("BDT");
    expect(res2.product).toBeNull();
  });

  it("a caption containing a personal-attributes phrase is flagged with the verbatim rule", async () => {
    const prisma = fakePrisma();
    const provider = realProviderReturning(JSON.stringify({
      variants: [{ caption: "আপনি কি মোটা? এই পাঞ্জাবিটি দেখুন।" }, { caption: "সুন্দর কটন পাঞ্জাবি।" }],
    }));
    const res: any = await buildAi(prisma, provider).generateCopy("org-1", "user-1", { productId: "prod-1" });
    expect(res.variants[0].policy.status).toBe("flagged");
    expect(res.variants[0].policy.findings.some((f: any) => f.rule === "personal_attributes")).toBe(true);
    expect(res.variants[0].policy.findings[0].explanation).toBeTruthy();
    expect(res.variants[1].policy.status).toBe("pass");
  });

  it("zero usable variants → BadRequest with the M55-mirrored message (usage row was still written, as in M55)", async () => {
    const prisma = fakePrisma();
    const provider = realProviderReturning(JSON.stringify({ variants: [{ caption: "  " }, {}] }));
    await expect(buildAi(prisma, provider).generateCopy("org-1", "user-1", { productId: "prod-1" }))
      .rejects.toMatchObject({ code: "social.theAiProviderReturnedNoUsable" });
  });

  it("provider errors surface verbatim as BadRequest and write NO usage row", async () => {
    const prisma = fakePrisma();
    const failing = {
      name: "gemini",
      isRealLlm: true,
      complete: async () => { throw new Error("Gemini quota exceeded (verbatim)"); },
    };
    await expect(buildAi(prisma, failing).generateCopy("org-1", "user-1", { productId: "prod-1" }))
      .rejects.toThrow("Gemini quota exceeded (verbatim)");
    expect(prisma.aIUsageRecord.rows).toHaveLength(0);
  });
});

describe("SocialAiService.generateCopy — dev template", () => {
  it("3 variants (count=2 → 2), Dev Template Adapter notice, estimated usage, and ONLY the real price appears", async () => {
    const prisma = fakePrisma();
    prisma.product.rows[0].compareAtMinor = null; // no compare price in facts → the real price is the only price
    const svc = buildAi(prisma, devProvider);
    const res: any = await svc.generateCopy("org-1", "user-1", { productId: "prod-1" });
    expect(res.provider).toBe("dev-template");
    expect(res.isRealLlm).toBe(false);
    expect(res.variants).toHaveLength(3);
    expect(res.notice).toContain("Dev Template Adapter");
    const allText = res.variants.map((v: any) => v.caption).join("\n");
    expect(allText).toContain("BDT 1500.00");
    const prices = allText.match(/BDT [\d.,]+/g) ?? [];
    expect(prices.length).toBeGreaterThan(0);
    for (const p of prices) expect(p).toBe("BDT 1500.00");
    for (const v of res.variants) expect(v.policy).toBeDefined();
    expect(prisma.aIUsageRecord.rows).toHaveLength(1);
    expect(prisma.aIUsageRecord.rows[0].feature).toBe("social_copy");
    expect(prisma.aIUsageRecord.rows[0].provider).toBe("dev-template");
    expect(prisma.aIUsageRecord.rows[0].model).toBe("dev-template-v1");
    expect(prisma.aIUsageRecord.rows[0].estimated).toBe(true);

    const prisma2 = fakePrisma();
    prisma2.product.rows[0].compareAtMinor = null;
    const res2: any = await buildAi(prisma2, devProvider).generateCopy("org-1", "user-1", { productId: "prod-1", count: 2 });
    expect(res2.variants).toHaveLength(2);
  });

  it("topic-only dev captions use the topic and never a price", async () => {
    const prisma = fakePrisma();
    const res: any = await buildAi(prisma, devProvider).generateCopy("org-1", "user-1", { topic: "Winter Sale Announcement", language: "en" });
    expect(res.variants).toHaveLength(3);
    const allText = res.variants.map((v: any) => v.caption).join("\n");
    expect(allText).toContain("Winter Sale Announcement");
    expect(allText).not.toContain("BDT");
    expect(res.product).toBeNull();
    expect(res.notice).toContain("Dev Template Adapter");
  });
});

describe("SocialAiService.generateCopy — guards", () => {
  it("kill switch blocks with 403 BEFORE the product load (missing product still 403)", async () => {
    const prisma = fakePrisma();
    prisma.systemSetting.rows.push({ key: "killSwitches", value: { aiDisabledOrgIds: ["org-1"] } });
    let caught: any = null;
    try {
      await buildAi(prisma, devProvider).generateCopy("org-1", "user-1", { productId: "does-not-exist" });
    } catch (e) { caught = e; }
    expect(caught).not.toBeNull();
    expect(caught.getStatus ? caught.getStatus() : caught.status).toBe(403);
    expect(caught.message).toContain("AI features প্ল্যাটফর্ম team দ্বারা এই organization-এর জন্য সাময়িকভাবে বন্ধ আছে।");
    expect(prisma.aIUsageRecord.rows).toHaveLength(0);
  });

  it("daily cap for social_copy blocks with 429 once the limit is used", async () => {
    const prisma = fakePrisma();
    prisma.organization.rows.push({ id: "org-1", aiDailyLimitOverride: 1, broadcastCapOverride: null, seatLimit: null });
    prisma.aIUsageRecord.rows.push({
      id: "usage-seed", organizationId: "org-1", userId: "user-1", feature: "social_copy",
      provider: "dev-template", createdAt: new Date(),
    });
    let caught: any = null;
    try {
      await buildAi(prisma, devProvider).generateCopy("org-1", "user-1", { productId: "prod-1" });
    } catch (e) { caught = e; }
    expect(caught).not.toBeNull();
    expect(caught.getStatus ? caught.getStatus() : caught.status).toBe(429);
    expect(caught.message).toContain("এই organization-এর জন্য daily AI generation limit পূর্ণ হয়েছে (1)");
    expect(prisma.aIUsageRecord.rows).toHaveLength(1); // only the seed
  });

  it("cross-org / missing product → NotFound; neither product nor topic → Bengali 400", async () => {
    const prisma = fakePrisma();
    prisma.product.rows.push({
      id: "prod-other", organizationId: "org-OTHER", name: "Other", priceMinor: 10000n, compareAtMinor: null,
      currency: "BDT", category: null, description: null, stockQuantity: null,
    });
    const svc = buildAi(prisma, devProvider);
    await expect(svc.generateCopy("org-1", "user-1", { productId: "prod-other" })).rejects.toMatchObject({ code: "social.productNotFoundInThisOrganization" });
    await expect(svc.generateCopy("org-1", "user-1", {})).rejects.toThrow("Product বেছে নিন অথবা একটা বিষয় (Topic) লিখুন।");
    await expect(svc.generateCopy("org-1", "user-1", { topic: "   " })).rejects.toThrow("Product বেছে নিন অথবা একটা বিষয় (Topic) লিখুন।");
  });
});

describe("suggestSocialHashtags", () => {
  it("is deterministic, deduped, Latin-only, max 8, first-seen order", () => {
    const tags = suggestSocialHashtags({
      product: { category: "Men's Fashion", name: "Cotton Panjabi" },
      businessProfile: { industry: "Fashion Retail" },
      topic: "Eid Sale 2026",
    });
    expect(tags).toEqual(["#mens", "#fashion", "#cotton", "#panjabi", "#retail", "#eid", "#sale", "#2026"]);
    expect(tags).toContain("#cotton");
    expect(tags).toContain("#panjabi");
    expect(tags).toContain("#mens");
    expect(tags).toContain("#fashion");
    expect(new Set(tags).size).toBe(tags.length);
    expect(tags.length).toBeLessThanOrEqual(8);
  });

  it("Bengali words yield no tokens (documented behaviour)", () => {
    expect(suggestSocialHashtags({ topic: "ঈদ অফার" })).toEqual([]);
    expect(suggestSocialHashtags({})).toEqual([]);
  });
});

describe("normalizeHashtagTags", () => {
  it("trims, strips '#', drops empties and dedupes case-insensitively keeping the first form", () => {
    expect(normalizeHashtagTags(["#Sale ", "sale", " Eid", "#eid ", "", "  ", "#New"])).toEqual(["Sale", "Eid", "New"]);
  });

  it("more than 30 distinct tags → Bengali 400", () => {
    const many = Array.from({ length: 31 }, (_, i) => `tag${i}`);
    expect(() => normalizeHashtagTags(many)).toThrow("একটি Set-এ সর্বোচ্চ ৩০টি Hashtag রাখা যায়।");
  });
});

describe("SocialService hashtag sets (SP3)", () => {
  function buildSocial(prisma: any) {
    const auditRows: any[] = [];
    const audit = { log: async (input: any) => { auditRows.push(input); } } as any;
    return { svc: new SocialService(prisma as any, audit), auditRows };
  }

  it("create normalizes tags, audits, and the serializer is org-safe", async () => {
    const prisma = fakePrisma();
    const { svc, auditRows } = buildSocial(prisma);
    const created: any = await svc.createHashtagSet("org-1", "user-1", { name: "  Eid Set  ", tags: ["#Sale ", "sale", "Eid"] });
    expect(created.name).toBe("Eid Set");
    expect(created.tags).toEqual(["Sale", "Eid"]);
    expect(created.id).toBeTruthy();
    expect(auditRows.some((r: any) => r.action === "social.hashtag_set_created" && r.metadata.tagCount === 2 && r.metadata.name === "Eid Set")).toBe(true);
  });

  it("duplicate name in the same org (case-insensitive) → Conflict; another org may reuse the name", async () => {
    const prisma = fakePrisma();
    const { svc } = buildSocial(prisma);
    await svc.createHashtagSet("org-1", "user-1", { name: "My Set", tags: ["a"] });
    await expect(svc.createHashtagSet("org-1", "user-1", { name: "my set", tags: ["b"] }))
      .rejects.toThrow("এই নামে একটি Hashtag Set আগেই আছে।");
    const other: any = await svc.createHashtagSet("org-2", "user-9", { name: "my set", tags: ["b"] });
    expect(other.name).toBe("my set");
  });

  it("list is org-scoped (another org's set is invisible)", async () => {
    const prisma = fakePrisma();
    const { svc } = buildSocial(prisma);
    await svc.createHashtagSet("org-1", "user-1", { name: "Mine", tags: ["x"] });
    await svc.createHashtagSet("org-2", "user-9", { name: "Theirs", tags: ["y"] });
    const list: any[] = await svc.listHashtagSets("org-1");
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Mine");
  });

  it("update (name + tags, duplicate check excludes self) and delete work; missing → NotFound", async () => {
    const prisma = fakePrisma();
    const { svc, auditRows } = buildSocial(prisma);
    const a: any = await svc.createHashtagSet("org-1", "user-1", { name: "First", tags: ["one"] });
    const b: any = await svc.createHashtagSet("org-1", "user-1", { name: "Second", tags: ["two"] });

    // keeping its own name is fine (self excluded from the dup check)
    const kept: any = await svc.updateHashtagSet("org-1", "user-1", a.id, { name: "First" });
    expect(kept.name).toBe("First");
    // taking the other set's name conflicts
    await expect(svc.updateHashtagSet("org-1", "user-1", a.id, { name: "second" }))
      .rejects.toThrow("এই নামে একটি Hashtag Set আগেই আছে।");

    const updated: any = await svc.updateHashtagSet("org-1", "user-1", a.id, { name: "Renamed", tags: ["#New ", "new", "Fresh"] });
    expect(updated.name).toBe("Renamed");
    expect(updated.tags).toEqual(["New", "Fresh"]);
    expect(auditRows.some((r: any) => r.action === "social.hashtag_set_updated")).toBe(true);

    const del = await svc.deleteHashtagSet("org-1", "user-1", b.id);
    expect(del).toEqual({ deleted: true, id: b.id });
    expect(await svc.listHashtagSets("org-1")).toHaveLength(1);
    expect(auditRows.some((r: any) => r.action === "social.hashtag_set_deleted")).toBe(true);

    await expect(svc.updateHashtagSet("org-1", "user-1", "missing-id", { name: "X" }))
      .rejects.toMatchObject({ code: "social.hashtagSetNotFoundInThis" });
    await expect(svc.deleteHashtagSet("org-1", "user-1", "missing-id"))
      .rejects.toMatchObject({ code: "social.hashtagSetNotFoundInThis" });
    // a set from another org is "not found" here, never leaked
    await expect(svc.deleteHashtagSet("org-2", "user-9", a.id))
      .rejects.toMatchObject({ code: "social.hashtagSetNotFoundInThis" });
  });

  it("validation: empty name → Bengali 400; >30 tags → Bengali 400", async () => {
    const prisma = fakePrisma();
    const { svc } = buildSocial(prisma);
    await expect(svc.createHashtagSet("org-1", "user-1", { name: "   ", tags: [] }))
      .rejects.toThrow("Set-এর নাম দিন।");
    const many = Array.from({ length: 31 }, (_, i) => `tag${i}`);
    await expect(svc.createHashtagSet("org-1", "user-1", { name: "Too Many", tags: many }))
      .rejects.toThrow("একটি Set-এ সর্বোচ্চ ৩০টি Hashtag রাখা যায়।");
    expect(prisma.socialHashtagSet.rows).toHaveLength(0);
  });
});
