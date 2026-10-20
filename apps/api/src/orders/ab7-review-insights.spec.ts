import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { ReviewInsightsService, NO_LLM_MESSAGE } from "./review-insights.service";

/**
 * AX15 — AI review insights.
 * Honesty pinned here: no real LLM → exact refusal + nothing
 * written; LLM/parse failure leaves a previous insight untouched;
 * counts never overshoot the reviews actually summarized; themes
 * capped; public payload never leaks staff internals.
 */
const ORG = "org-1";

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v && typeof v === "object" && "in" in (v as any)) return (v as any).in.includes(row[k]);
    return row[k] === v;
  });
}
function table(rows: any[]) {
  return {
    rows,
    // MB5: ReviewInsightsService now reads org/user locale rungs
    // through resolveOwnerLanguageForOrg, which uses findUnique —
    // the fake models the full Prisma surface it consumes.
    findUnique: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => { const row = { id: `new-${rows.length + 1}`, ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const r = rows.find((x) => x.id === where.id)!; Object.assign(r, data); return r; },
  };
}

const GOOD_LLM_JSON = {
  summary: "ক্রেতারা মান ও ডেলিভারি নিয়ে সন্তুষ্ট, তবে সাইজ নিয়ে কিছু অভিযোগ আছে।",
  positive: 10, neutral: 5, negative: 5, // overshoots the 4 reviews on purpose
  themes: ["মান ভালো", "দ্রুত ডেলিভারি", "সাইজ সমস্যা", "দাম যুক্তিসংগত", "প্যাকেজিং", "অতিরিক্ত থিম", "x".repeat(120)],
};

function fixture(opts: { llm?: "dev" | "real" | "throw" | "badjson"; insightRows?: any[] } = {}) {
  const reviews: any[] = [
    { id: "rev-1", organizationId: ORG, orderId: "ord-1", customerId: "cus-1", rating: 5, comment: "দারুণ মান", receivedAt: new Date("2026-10-10"), isVisible: true },
    { id: "rev-2", organizationId: ORG, orderId: "ord-1", customerId: "cus-1", rating: 4, comment: "ভালো, ডেলিভারি দ্রুত", receivedAt: new Date("2026-10-11"), isVisible: true },
    { id: "rev-3", organizationId: ORG, orderId: "ord-2", customerId: "cus-1", rating: 5, comment: "আবার কিনব", receivedAt: new Date("2026-10-12"), isVisible: true },
    { id: "rev-4", organizationId: ORG, orderId: "ord-2", customerId: "cus-1", rating: 1, comment: "সাইজ ছোট", receivedAt: new Date("2026-10-13"), isVisible: true },
    { id: "rev-hidden", organizationId: ORG, orderId: "ord-1", customerId: "cus-1", rating: 1, comment: "লুকানো", receivedAt: new Date("2026-10-14"), isVisible: false },
    { id: "rev-rating-only", organizationId: ORG, orderId: "ord-3", customerId: "cus-1", rating: 5, comment: null, receivedAt: new Date("2026-10-14"), isVisible: true },
  ];
  const insightRows: any[] = opts.insightRows ?? [];
  const usage: any[] = [];
  const prisma = {
    organization: table([{ id: ORG, slug: "meghna", name: "Meghna" }, { id: "org-2", slug: "other", name: "Other" }]),
    product: table([
      { id: "prod-1", organizationId: ORG, slug: "shirt", name: "Cotton Shirt", status: "ACTIVE" },
      { id: "prod-2", organizationId: ORG, slug: "pants", name: "Pants", status: "ACTIVE" },
      { id: "prod-foreign", organizationId: "org-2", slug: "foreign", name: "Foreign", status: "ACTIVE" },
    ]),
    order: table([
      { id: "ord-1", organizationId: ORG, customerId: "cus-1", status: "completed" },
      { id: "ord-2", organizationId: ORG, customerId: "cus-1", status: "completed" },
      { id: "ord-3", organizationId: ORG, customerId: "cus-1", status: "completed" },
    ]),
    orderItem: table([
      { id: "oi-1", orderId: "ord-1", productId: "prod-1" },
      { id: "oi-2", orderId: "ord-2", productId: "prod-1" },
      { id: "oi-3", orderId: "ord-3", productId: "prod-2" },
    ]),
    orderReview: table(reviews),
    productReviewInsight: table(insightRows),
    aIUsageRecord: { create: async ({ data }: any) => { usage.push(data); return data; } },
  };
  let llmFactory: any;
  const kind = opts.llm ?? "real";
  if (kind === "dev") {
    llmFactory = { getProvider: () => ({ name: "dev-template", isRealLlm: false, complete: jest.fn(async () => ({ text: "unused" })) }) };
  } else if (kind === "throw") {
    llmFactory = { getProvider: () => ({ name: "openai", isRealLlm: true, complete: jest.fn(async () => { throw new Error("provider down"); }) }) };
  } else if (kind === "badjson") {
    llmFactory = { getProvider: () => ({ name: "openai", isRealLlm: true, complete: jest.fn(async () => ({ text: "মোটেও JSON নয়", model: "gpt-test-1", inputTokens: 5, outputTokens: 5, tokensEstimated: false })) }) };
  } else {
    llmFactory = {
      getProvider: () => ({
        name: "openai", isRealLlm: true,
        complete: jest.fn(async () => ({ text: JSON.stringify(GOOD_LLM_JSON), model: "gpt-test-1", inputTokens: 111, outputTokens: 22, tokensEstimated: false })),
      }),
    };
  }
  const audits: any[] = [];
  const svc = new ReviewInsightsService(prisma as any, { log: async (i: any) => { audits.push(i); } } as any, llmFactory);
  return { svc, prisma, reviews, insightRows, usage, audits };
}

describe("AX15 generate", () => {
  it("refuses with the exact message when no real LLM is configured — nothing written", async () => {
    const { svc, insightRows, usage } = fixture({ llm: "dev" });
    await expect(svc.generate(ORG, "prod-1", "user-1")).rejects.toBeInstanceOf(ApiException);
    await expect(svc.generate(ORG, "prod-1", "user-1")).rejects.toThrow(NO_LLM_MESSAGE);
    expect(NO_LLM_MESSAGE).toBe("LLM কনফিগার করা নেই — AI সারসংক্ষেপ উপলব্ধ নয়");
    expect(insightRows).toHaveLength(0);
    expect(usage).toHaveLength(0);
  });

  it("zero text reviews → Bengali refusal, nothing written (rating-only does not count)", async () => {
    const { svc, insightRows } = fixture();
    await expect(svc.generate(ORG, "prod-2", "user-1")).rejects.toBeInstanceOf(ApiException);
    await expect(svc.generate(ORG, "prod-2", "user-1")).rejects.toThrow("কোনো লেখাসহ রিভিউ নেই");
    expect(insightRows).toHaveLength(0);
  });

  it("successful generation upserts with proportionally clamped counts + capped themes, records usage + audit", async () => {
    const { svc, insightRows, usage, audits } = fixture();
    const out: any = await svc.generate(ORG, "prod-1", "user-1");
    expect(insightRows).toHaveLength(1);
    expect(out.summaryText).toBe(GOOD_LLM_JSON.summary);
    // 10/5/5 over 4 reviews scales down by 0.2 → 2/1/1, sum == 4 == reviewCount
    expect(out.sentiment).toEqual({ positive: 2, neutral: 1, negative: 1, total: 4 });
    expect(out.reviewCount).toBe(4);
    expect(out.generatedById).toBe("user-1");
    expect(out.modelLabel).toBe("gpt-test-1");
    expect(out.themes).toHaveLength(5);
    expect(out.themes.every((t: string) => t.length <= 80)).toBe(true);
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ organizationId: ORG, userId: "user-1", feature: "review_insight", provider: "openai", model: "gpt-test-1", inputTokens: 111, outputTokens: 22, estimated: false });
    expect(audits.map((a) => a.action)).toEqual(["product_review_insight.generate"]);
    expect(audits[0].entityType).toBe("ProductReviewInsight");

    // Regeneration updates the SAME row (upsert), never a second one.
    const again: any = await svc.generate(ORG, "prod-1", "user-2");
    expect(insightRows).toHaveLength(1);
    expect(again.id).toBe(out.id);
    expect(again.generatedById).toBe("user-2");
  });

  it("LLM throw → BadRequest with the error, pre-existing insight untouched", async () => {
    const prior = { id: "ins-1", organizationId: ORG, productId: "prod-1", summaryText: "আগের সারসংক্ষেপ", sentimentJson: { positive: 3, neutral: 0, negative: 1, total: 4 }, themesJson: ["মান"], reviewCountAtGeneration: 4, generatedAt: new Date("2026-10-01"), generatedById: "user-0", modelLabel: "old-model" };
    const { svc, insightRows } = fixture({ llm: "throw", insightRows: [prior] });
    await expect(svc.generate(ORG, "prod-1", "user-1")).rejects.toThrow("provider down");
    expect(insightRows).toHaveLength(1);
    expect(insightRows[0].summaryText).toBe("আগের সারসংক্ষেপ");
    expect(insightRows[0].modelLabel).toBe("old-model");
  });

  it("unparseable LLM output → BadRequest, pre-existing insight untouched", async () => {
    const prior = { id: "ins-1", organizationId: ORG, productId: "prod-1", summaryText: "আগের সারসংক্ষেপ", sentimentJson: { positive: 3, neutral: 0, negative: 1, total: 4 }, themesJson: ["মান"], reviewCountAtGeneration: 4, generatedAt: new Date("2026-10-01"), generatedById: "user-0", modelLabel: "old-model" };
    const { svc, insightRows } = fixture({ llm: "badjson", insightRows: [prior] });
    await expect(svc.generate(ORG, "prod-1", "user-1")).rejects.toBeInstanceOf(ApiException);
    expect(insightRows[0].summaryText).toBe("আগের সারসংক্ষেপ");
  });

  it("foreign or unknown product → 404 for generate, staff GET and public-by-slug", async () => {
    const { svc } = fixture();
    await expect(svc.generate(ORG, "prod-foreign", "user-1")).rejects.toBeInstanceOf(ApiException);
    await expect(svc.generate(ORG, "nope", "user-1")).rejects.toBeInstanceOf(ApiException);
    await expect(svc.getForStaff(ORG, "prod-foreign")).rejects.toBeInstanceOf(ApiException);
    await expect(svc.getPublicBySlug("nope", "shirt")).rejects.toBeInstanceOf(ApiException);
    await expect(svc.getPublicBySlug("meghna", "nope")).rejects.toBeInstanceOf(ApiException);
  });
});

describe("AX15 staff GET + staleness", () => {
  it("no insight: insight null, currentReviewCount on the countable basis, since = 0", async () => {
    const { svc } = fixture();
    const out = await svc.getForStaff(ORG, "prod-1");
    expect(out.insight).toBeNull();
    expect(out.currentReviewCount).toBe(4); // hidden + rating-only excluded
    expect(out.reviewsSinceGeneration).toBe(0);
  });

  it("staleness math: new countable reviews after generation count up", async () => {
    const { svc, reviews } = fixture();
    await svc.generate(ORG, "prod-1", "user-1");
    let out = await svc.getForStaff(ORG, "prod-1");
    expect(out.currentReviewCount).toBe(4);
    expect(out.reviewsSinceGeneration).toBe(0);
    reviews.push(
      { id: "rev-5", organizationId: ORG, orderId: "ord-1", customerId: "cus-1", rating: 5, comment: "নতুন ভালো", receivedAt: new Date("2026-10-15"), isVisible: true },
      { id: "rev-6", organizationId: ORG, orderId: "ord-2", customerId: "cus-1", rating: 2, comment: "নতুন খারাপ", receivedAt: new Date("2026-10-16"), isVisible: true },
      { id: "rev-7-hidden", organizationId: ORG, orderId: "ord-2", customerId: "cus-1", rating: 2, comment: "লুকানো নতুন", receivedAt: new Date("2026-10-16"), isVisible: false },
    );
    out = await svc.getForStaff(ORG, "prod-1");
    expect(out.currentReviewCount).toBe(6);
    expect(out.reviewsSinceGeneration).toBe(2);
    expect(out.insight!.reviewCount).toBe(4);
  });
});

describe("AX15 public payload", () => {
  it("null case returns HTTP-200 shape { insight: null }", async () => {
    const { svc } = fixture();
    await expect(svc.getPublicBySlug("meghna", "shirt")).resolves.toEqual({ insight: null });
  });

  it("existing insight: only the public fields, no generatedById / model internals", async () => {
    const { svc } = fixture();
    await svc.generate(ORG, "prod-1", "user-1");
    const out: any = await svc.getPublicBySlug("meghna", "shirt");
    expect(Object.keys(out).sort()).toEqual(["generatedAt", "reviewCount", "sentiment", "summaryText", "themes"]);
    expect(out.summaryText).toBe(GOOD_LLM_JSON.summary);
    expect(out.sentiment).toEqual({ positive: 2, neutral: 1, negative: 1, total: 4 });
    expect(out.reviewCount).toBe(4);
    const json = JSON.stringify(out);
    expect(json).not.toContain("user-1");
    expect(json).not.toContain("gpt-test-1");
    expect(json).not.toContain("generatedById");
    expect(json).not.toContain("modelLabel");
  });
});
