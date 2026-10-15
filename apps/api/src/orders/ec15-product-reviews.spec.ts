import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ProductReviewsService } from "./product-reviews.service";

/**
 * EC15 — unified public reviews + staff moderation.
 * Public privacy and honesty are pinned here: first name only,
 * hidden rows never counted, average null (never 0.0) when empty,
 * external reviews never "verified".
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
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => { const row = { id: `new-${rows.length + 1}`, ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const r = rows.find((x) => x.id === where.id)!; Object.assign(r, data); return r; },
  };
}

function fixture() {
  const reviews: any[] = [
    { id: "rev-1", organizationId: ORG, orderId: "ord-1", customerId: "cus-1", rating: 5, comment: "দারুণ পণ্য", source: "link", status: "received", deliveredAt: new Date("2026-10-01"), receivedAt: new Date("2026-10-10"), isVisible: true, replyText: null, repliedAt: null },
    { id: "rev-2", organizationId: ORG, orderId: "ord-2", customerId: "cus-1", rating: 1, comment: "খারাপ অভিজ্ঞতা", source: "chat", status: "received", deliveredAt: new Date("2026-10-02"), receivedAt: new Date("2026-10-11"), isVisible: false, replyText: null, repliedAt: null },
    { id: "rev-pending", organizationId: ORG, orderId: "ord-1", customerId: "cus-1", rating: null, comment: null, source: null, status: "pending_send", deliveredAt: new Date("2026-10-03"), receivedAt: null, isVisible: true, replyText: null, repliedAt: null },
    { id: "rev-foreign", organizationId: "org-2", orderId: "ord-x", customerId: "cus-9", rating: 5, comment: "অন্য দোকান", source: "link", status: "received", deliveredAt: new Date("2026-10-01"), receivedAt: new Date("2026-10-09"), isVisible: true, replyText: null, repliedAt: null },
  ];
  const externals: any[] = [
    { id: "ext-1", organizationId: ORG, storeId: "store-woo", productId: "prod-1", externalId: "101", authorName: "Nadia", rating: 4, text: "ভালো", imageUrls: ["https://img.example/r1.jpg"], status: "visible", createdAtRemote: new Date("2026-10-12"), createdAt: new Date("2026-10-12") },
    { id: "ext-hidden", organizationId: ORG, storeId: "store-woo", productId: "prod-1", externalId: "102", authorName: "Gone", rating: 2, text: "লুকানো", imageUrls: [], status: "hidden", createdAtRemote: new Date("2026-10-13"), createdAt: new Date("2026-10-13") },
  ];
  const prisma = {
    organization: table([{ id: ORG, slug: "meghna", name: "Meghna" }]),
    product: table([
      { id: "prod-1", organizationId: ORG, slug: "shirt", name: "Cotton Shirt", status: "ACTIVE" },
      { id: "prod-2", organizationId: ORG, slug: "pants", name: "Pants", status: "ACTIVE" },
    ]),
    store: table([
      { id: "store-woo", platform: "WOOCOMMERCE" },
      { id: "store-shop", platform: "SHOPIFY" },
    ]),
    order: table([
      { id: "ord-1", organizationId: ORG, customerId: "cus-1", status: "completed" },
      { id: "ord-2", organizationId: ORG, customerId: "cus-1", status: "processing" },
    ]),
    orderItem: table([
      { id: "oi-1", orderId: "ord-1", productId: "prod-1", name: "Cotton Shirt" },
      { id: "oi-2", orderId: "ord-2", productId: "prod-1", name: "Cotton Shirt" },
    ]),
    customer: table([
      { id: "cus-1", organizationId: ORG, firstName: "Rahim", lastName: "UddinSecret", email: "rahim-secret@example.com", phone: "01799999999" },
    ]),
    orderReview: table(reviews),
    externalReview: table(externals),
  };
  const audits: any[] = [];
  const svc = new ProductReviewsService(prisma as any, { log: async (i: any) => { audits.push(i); } } as any);
  return { svc, prisma, reviews, externals, audits };
}

describe("EC15 public unified reviews", () => {
  it("merges own + external, newest first, with the platform labelled", async () => {
    const { svc } = fixture();
    const out = await svc.getPublicProductReviews(ORG, "prod-1");
    expect(out.items).toHaveLength(2);
    expect(out.items[0].source).toBe("woocommerce"); // 2026-10-12, newest
    expect(out.items[0].authorName).toBe("Nadia");
    expect(out.items[0].imageUrls).toEqual(["https://img.example/r1.jpg"]);
    expect(out.items[1].source).toBe("store");
    expect(out.items[1].text).toBe("দারুণ পণ্য");
    expect(out.items[1].imageUrls).toEqual([]);
  });

  it("hidden own + hidden external are excluded AND the summary excludes them", async () => {
    const { svc } = fixture();
    const out = await svc.getPublicProductReviews(ORG, "prod-1");
    expect(out.items.map((i: any) => i.rating).sort()).toEqual([4, 5]);
    expect(out.summary).toEqual({ average: 4.5, count: 2 });
  });

  it("average math rounds to 1 decimal; empty product gives null average, never 0.0", async () => {
    const { svc } = fixture();
    const empty = await svc.getPublicProductReviews(ORG, "prod-2");
    expect(empty.summary).toEqual({ average: null, count: 0 });
    expect(empty.items).toEqual([]);
  });

  it("customer privacy: no email, phone, or last name in the public payload; first name only", async () => {
    const { svc } = fixture();
    const out = await svc.getPublicProductReviews(ORG, "prod-1");
    const json = JSON.stringify(out);
    expect(json).not.toContain("rahim-secret@example.com");
    expect(json).not.toContain("01799999999");
    expect(json).not.toContain("UddinSecret");
    const own = out.items.find((i: any) => i.source === "store");
    expect(own.authorName).toBe("Rahim");
  });

  it("verified rule: own received review is delivery-backed (verified), external is never verified", async () => {
    const { svc } = fixture();
    const out = await svc.getPublicProductReviews(ORG, "prod-1");
    expect(out.items.find((i: any) => i.source === "store").verified).toBe(true);
    expect(out.items.find((i: any) => i.source === "woocommerce").verified).toBe(false);
  });

  it("public slug resolution: org + ACTIVE product; unknown org/product 404", async () => {
    const { svc } = fixture();
    const out = await svc.getPublicBySlug("meghna", "shirt");
    expect(out.product.name).toBe("Cotton Shirt");
    expect(out.summary.count).toBe(2);
    await expect(svc.getPublicBySlug("nope", "shirt")).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.getPublicBySlug("meghna", "nope")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("EC15 staff moderation", () => {
  it("staff list unifies both sources with product names and hidden state; filters work", async () => {
    const { svc } = fixture();
    const all = await svc.listStaffReviews(ORG);
    expect(all).toHaveLength(4); // own visible+hidden, external visible+hidden; pending excluded
    expect(all.every((i: any) => i.productName === "Cotton Shirt")).toBe(true);
    expect(all.filter((i: any) => i.hidden)).toHaveLength(2);
    expect((await svc.listStaffReviews(ORG, { source: "woocommerce" })).map((i: any) => i.id)).toEqual(["ext-hidden", "ext-1"]);
    expect((await svc.listStaffReviews(ORG, { rating: 5 })).map((i: any) => i.id)).toEqual(["rev-1"]);
    expect((await svc.listStaffReviews(ORG, { hidden: true })).map((i: any) => i.id).sort()).toEqual(["ext-hidden", "rev-2"]);
    expect((await svc.listStaffReviews(ORG, { productId: "prod-2" }))).toEqual([]);
  });

  it("hide/show works for both sources and is audit-logged", async () => {
    const { svc, reviews, externals, audits } = fixture();
    await svc.moderate(ORG, "store", "rev-1", { isVisible: false }, "user-1");
    expect(reviews.find((r) => r.id === "rev-1").isVisible).toBe(false);
    await svc.moderate(ORG, "woocommerce", "ext-1", { isVisible: false }, "user-1");
    expect(externals.find((r) => r.id === "ext-1").status).toBe("hidden");
    await svc.moderate(ORG, "woocommerce", "ext-1", { isVisible: true }, "user-1");
    expect(externals.find((r) => r.id === "ext-1").status).toBe("visible");
    expect(audits.map((a) => a.action)).toEqual(["review.moderate", "review.moderate", "review.moderate"]);
  });

  it("reply on an own review stamps replyText + repliedAt", async () => {
    const { svc, reviews } = fixture();
    const out = await svc.moderate(ORG, "store", "rev-1", { replyText: "ধন্যবাদ!" }, "user-1");
    expect(out.replyText).toBe("ধন্যবাদ!");
    expect(reviews.find((r) => r.id === "rev-1").repliedAt).toBeInstanceOf(Date);
  });

  it("reply on an external review is an honest 400; foreign ids 404", async () => {
    const { svc } = fixture();
    await expect(svc.moderate(ORG, "woocommerce", "ext-1", { replyText: "hi" }, "user-1")).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.moderate(ORG, "woocommerce", "ext-1", { replyText: "hi" }, "user-1")).rejects.toThrow("বাইরের রিভিউতে উত্তর দেওয়া যায় না");
    await expect(svc.moderate(ORG, "store", "rev-foreign", { isVisible: false }, "user-1")).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.moderate(ORG, "woocommerce", "nope", { isVisible: false }, "user-1")).rejects.toBeInstanceOf(NotFoundException);
  });
});
