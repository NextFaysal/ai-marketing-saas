import { SocialCommerceDraftService, promotionDiscountPercent } from "./social-commerce-draft.service";
import { ProductsService } from "../products/products.service";
import { InventoryService } from "../inventory/inventory.service";
import { PromotionsService } from "../commerce/promotions.service";
import { ReviewsService } from "../orders/reviews.service";

/**
 * SU5 — Commerce-connected auto drafts:
 * - no config row / toggle off → nothing is created (the honest
 *   form of "default false");
 * - an enabled trigger creates exactly one DRAFT with a grounded
 *   caption, the per-kind idempotency ref, and createdById
 *   "system" — never a publish;
 * - target account resolution (pinned → first connected
 *   meta_page), per-Dhaka-day cap, duplicate ref;
 * - media import through the overridable importImage seam:
 *   success attaches, failure still drafts text-only with
 *   mediaAttached: false;
 * - sale captions take percentages ONLY from the promotion's
 *   real config fields (flash percentOff / bogo
 *   getDiscountPercent / tiered max tier);
 * - review fan-in: a 50-multiple total is a milestone (and wins
 *   over the 5-star path), otherwise a fresh 5-star review is
 *   the event;
 * - producer hooks: products.create, inventory.adjust,
 *   promotions create/update/setActive and reviews
 *   submitPublicReview emit the bus events;
 * - the engine NEVER throws, whatever the store does.
 */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      const o = v as any;
      if ("not" in o) return o.not === null ? row[k] !== null && row[k] !== undefined : row[k] !== o.not;
      if ("in" in o) return o.in.includes(row[k]);
      const t = row[k] instanceof Date ? row[k].getTime() : row[k];
      if ("gte" in o && !(t >= new Date(o.gte).getTime())) return false;
      if ("gt" in o && !(t > new Date(o.gt).getTime())) return false;
      if ("lt" in o && !(t < new Date(o.lt).getTime())) return false;
      if ("lte" in o && !(t <= new Date(o.lte).getTime())) return false;
      return true;
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
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
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
    upsert: async ({ where, update, create }: any) => {
      const existing = rows.find((r) => matches(r, where ?? {}));
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      rows.push(row);
      return row;
    },
  };
}

class FakeEvents {
  emitted: { event: string; payload: any }[] = [];
  handlers = new Map<string, ((p: any) => void)[]>();
  on(event: string, handler: (p: any) => void) {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
  }
  emit(event: string, payload: any) {
    this.emitted.push({ event, payload });
    for (const h of this.handlers.get(event) ?? []) h(payload);
  }
}

const auditStub: any = { log: async () => undefined };

function fakePrisma() {
  const tables: any = {
    socialAutoDraftConfig: makeTable("cfg"),
    socialAccount: makeTable("acct"),
    socialPost: makeTable("post"),
    product: makeTable("prod"),
    promotion: makeTable("promo"),
    orderReview: makeTable("review"),
    externalReview: makeTable("extreview"),
    order: makeTable("order"),
    orderItem: makeTable("item"),
    stockMovement: makeTable("movement"),
    productVariant: makeTable("variant"),
  };
  tables.socialAccount.rows.push(
    { id: "acct-page", organizationId: "org-1", platform: "meta_page", status: "connected", name: "Page", createdAt: new Date("2026-01-01") },
    { id: "acct-ig", organizationId: "org-1", platform: "instagram", status: "connected", name: "IG", createdAt: new Date("2026-01-02") },
  );
  tables.product.rows.push({
    id: "prod-1", organizationId: "org-1", name: "Cotton Panjabi",
    priceMinor: 150000n, currency: "BDT", imageUrl: null, createdAt: new Date(),
  });
  return tables;
}

function enabledConfig(tables: any, overrides: any = {}) {
  tables.socialAutoDraftConfig.rows.push({
    id: "cfg-1", organizationId: "org-1",
    newProductEnabled: true, saleEnabled: true, backInStockEnabled: true, reviewMilestoneEnabled: true,
    maxDraftsPerDay: 3, socialAccountId: null, ...overrides,
  });
}

function makeService(tables: any, events?: any) {
  return new SocialCommerceDraftService(tables as any, auditStub, events, undefined);
}

describe("SU5 SocialCommerceDraftService — guards", () => {
  it("no config row → disabled, nothing created", async () => {
    const tables = fakePrisma();
    const svc = makeService(tables);
    const out = await svc.maybeCreateDraft("org-1", { kind: "new_product", productId: "prod-1" });
    expect(out).toEqual({ created: false, reason: "disabled" });
    expect(tables.socialPost.rows).toHaveLength(0);
  });

  it("config row with the kind's toggle OFF → disabled", async () => {
    const tables = fakePrisma();
    enabledConfig(tables, { newProductEnabled: false });
    const svc = makeService(tables);
    const out = await svc.maybeCreateDraft("org-1", { kind: "new_product", productId: "prod-1" });
    expect(out.created).toBe(false);
    expect(out.reason).toBe("disabled");
    expect(tables.socialPost.rows).toHaveLength(0);
  });

  it("no connected meta_page account → no_account", async () => {
    const tables = fakePrisma();
    enabledConfig(tables);
    tables.socialAccount.rows.length = 0;
    tables.socialAccount.rows.push({ id: "acct-x", organizationId: "org-1", platform: "meta_page", status: "disconnected", createdAt: new Date() });
    const svc = makeService(tables);
    const out = await svc.maybeCreateDraft("org-1", { kind: "new_product", productId: "prod-1" });
    expect(out).toEqual({ created: false, reason: "no_account" });
  });

  it("daily cap reached (Dhaka day) → daily_cap", async () => {
    const tables = fakePrisma();
    enabledConfig(tables, { maxDraftsPerDay: 1 });
    tables.socialPost.rows.push({
      id: "post-old", organizationId: "org-1", autoDraftKind: "sale", autoDraftRef: "promo-x",
      status: "draft", createdAt: new Date(),
    });
    const svc = makeService(tables);
    const out = await svc.maybeCreateDraft("org-1", { kind: "new_product", productId: "prod-1" });
    expect(out).toEqual({ created: false, reason: "daily_cap" });
    expect(tables.socialPost.rows).toHaveLength(1);
  });

  it("same autoDraftRef already exists → duplicate", async () => {
    const tables = fakePrisma();
    enabledConfig(tables);
    tables.socialPost.rows.push({
      id: "post-old", organizationId: "org-1", autoDraftKind: "new_product", autoDraftRef: "prod-1",
      status: "draft", createdAt: new Date(Date.now() - 3 * 86_400_000),
    });
    const svc = makeService(tables);
    const out = await svc.maybeCreateDraft("org-1", { kind: "new_product", productId: "prod-1" });
    expect(out).toEqual({ created: false, reason: "duplicate" });
  });

  it("missing product row → no_product", async () => {
    const tables = fakePrisma();
    enabledConfig(tables);
    const svc = makeService(tables);
    const out = await svc.maybeCreateDraft("org-1", { kind: "new_product", productId: "prod-nope" });
    expect(out).toEqual({ created: false, reason: "no_product" });
  });

  it("never throws: a store failure becomes { created:false, reason:'error' }", async () => {
    const tables = fakePrisma();
    enabledConfig(tables);
    tables.socialPost.create = async () => { throw new Error("db down"); };
    const svc = makeService(tables);
    await expect(svc.maybeCreateDraft("org-1", { kind: "new_product", productId: "prod-1" }))
      .resolves.toEqual({ created: false, reason: "error" });
  });
});

describe("SU5 SocialCommerceDraftService — draft creation", () => {
  it("new_product: grounded caption (name + real price), draft status, kind/ref, system actor", async () => {
    const tables = fakePrisma();
    enabledConfig(tables);
    const svc = makeService(tables);
    const out = await svc.maybeCreateDraft("org-1", { kind: "new_product", productId: "prod-1" });
    expect(out.created).toBe(true);
    expect(out.mediaAttached).toBe(false);
    const post = tables.socialPost.rows[0];
    expect(post.status).toBe("draft");
    expect(post.caption).toContain("নতুন এসেছে: Cotton Panjabi");
    expect(post.caption).toContain("BDT 1500.00");
    expect(post.autoDraftKind).toBe("new_product");
    expect(post.autoDraftRef).toBe("prod-1");
    expect(post.socialAccountId).toBe("acct-page");
    expect(post.createdById).toBe("system");
    expect(post.linkUrl).toBeNull();
  });

  it("pinned config account wins over the first meta_page account", async () => {
    const tables = fakePrisma();
    tables.socialAccount.rows.push({ id: "acct-page-2", organizationId: "org-1", platform: "meta_page", status: "connected", name: "Page 2", createdAt: new Date("2026-02-01") });
    enabledConfig(tables, { socialAccountId: "acct-page-2" });
    const svc = makeService(tables);
    const out = await svc.maybeCreateDraft("org-1", { kind: "new_product", productId: "prod-1" });
    expect(out.created).toBe(true);
    expect(tables.socialPost.rows[0].socialAccountId).toBe("acct-page-2");
  });

  it("back_in_stock: caption + day-scoped bist ref", async () => {
    const tables = fakePrisma();
    enabledConfig(tables);
    const svc = makeService(tables);
    const out = await svc.maybeCreateDraft("org-1", { kind: "back_in_stock", productId: "prod-1" });
    expect(out.created).toBe(true);
    const post = tables.socialPost.rows[0];
    expect(post.caption).toContain("আবার স্টকে এসেছে: Cotton Panjabi");
    expect(post.autoDraftRef).toMatch(/^prod-1:bist:\d{4}-\d{2}-\d{2}$/);
  });

  it("media import success attaches the imported asset", async () => {
    const tables = fakePrisma();
    enabledConfig(tables);
    tables.product.rows[0].imageUrl = "https://cdn.example/panjabi.jpg";
    const svc = makeService(tables);
    svc.importImage = async () => ({ id: "asset-9" });
    const out = await svc.maybeCreateDraft("org-1", { kind: "new_product", productId: "prod-1" });
    expect(out).toMatchObject({ created: true, mediaAttached: true });
    expect(tables.socialPost.rows[0].mediaRefs).toEqual([{ assetId: "asset-9", kind: "image" }]);
  });

  it("media import failure still drafts, text-only, mediaAttached false", async () => {
    const tables = fakePrisma();
    enabledConfig(tables);
    tables.product.rows[0].imageUrl = "https://cdn.example/panjabi.jpg";
    const svc = makeService(tables);
    svc.importImage = async () => { throw new Error("fetch failed"); };
    const out = await svc.maybeCreateDraft("org-1", { kind: "new_product", productId: "prod-1" });
    expect(out).toMatchObject({ created: true, mediaAttached: false });
    expect(tables.socialPost.rows[0].mediaRefs).toEqual([]);
  });
});

describe("SU5 sale captions — percentages only from real config fields", () => {
  it("promotionDiscountPercent: flash / bogo / tiered-max / unknown", () => {
    expect(promotionDiscountPercent({ type: "flash", config: { percentOff: 30 } })).toBe(30);
    expect(promotionDiscountPercent({ type: "bogo", config: { getDiscountPercent: 50 } })).toBe(50);
    expect(promotionDiscountPercent({ type: "tiered", config: { tiers: [{ percentOff: 10 }, { percentOff: 25 }] } })).toBe(25);
    expect(promotionDiscountPercent({ type: "flash", config: {} })).toBeNull();
    expect(promotionDiscountPercent({ type: "mystery", config: { percentOff: 40 } })).toBeNull();
  });

  it("flash sale caption carries the real percentOff", async () => {
    const tables = fakePrisma();
    enabledConfig(tables);
    tables.promotion.rows.push({ id: "promo-1", organizationId: "org-1", name: "Eid Sale", type: "flash", config: { percentOff: 30 }, active: true });
    const svc = makeService(tables);
    const out = await svc.maybeCreateDraft("org-1", { kind: "sale", promotionId: "promo-1" });
    expect(out.created).toBe(true);
    expect(tables.socialPost.rows[0].caption).toContain("সেল চলছে: Eid Sale");
    expect(tables.socialPost.rows[0].caption).toContain("30%");
    expect(tables.socialPost.rows[0].autoDraftRef).toBe("promo-1");
  });

  it("promotion without a discount field → name only, no invented percent", async () => {
    const tables = fakePrisma();
    enabledConfig(tables);
    tables.promotion.rows.push({ id: "promo-2", organizationId: "org-1", name: "Clearance", type: "flash", config: {}, active: true });
    const svc = makeService(tables);
    const out = await svc.maybeCreateDraft("org-1", { kind: "sale", promotionId: "promo-2" });
    expect(out.created).toBe(true);
    expect(tables.socialPost.rows[0].caption).toBe("সেল চলছে: Clearance");
    expect(tables.socialPost.rows[0].caption).not.toContain("%");
  });
});

describe("SU5 review fan-in", () => {
  it("a 50-multiple total is a milestone draft (ref milestone:<total>)", async () => {
    const tables = fakePrisma();
    enabledConfig(tables);
    for (let i = 0; i < 50; i++) {
      tables.orderReview.rows.push({ id: `rev-${i}`, organizationId: "org-1", rating: 4, receivedAt: new Date(), orderId: `ord-${i}` });
    }
    const svc = makeService(tables);
    const out = await svc.handleReviewReceived({ organizationId: "org-1", reviewId: "rev-49", orderId: "ord-49", rating: 4 });
    expect(out.created).toBe(true);
    const post = tables.socialPost.rows[0];
    expect(post.autoDraftRef).toBe("milestone:50");
    expect(post.caption).toContain("50টি রিভিউ");
  });

  it("milestone wins over the 5-star path when both apply", async () => {
    const tables = fakePrisma();
    enabledConfig(tables);
    for (let i = 0; i < 100; i++) {
      tables.orderReview.rows.push({ id: `rev-${i}`, organizationId: "org-1", rating: 5, receivedAt: new Date(), orderId: `ord-${i}` });
    }
    const svc = makeService(tables);
    const out = await svc.handleReviewReceived({ organizationId: "org-1", reviewId: "rev-99", orderId: "ord-99", rating: 5 });
    expect(out.created).toBe(true);
    expect(tables.socialPost.rows[0].autoDraftRef).toBe("milestone:100");
  });

  it("a fresh 5-star review (no milestone) drafts with quote + product name", async () => {
    const tables = fakePrisma();
    enabledConfig(tables);
    tables.orderReview.rows.push(
      { id: "rev-1", organizationId: "org-1", rating: 5, receivedAt: new Date(), orderId: "ord-1", comment: "খুবই ভালো মানের পাঞ্জাবি!" },
      { id: "rev-2", organizationId: "org-1", rating: 4, receivedAt: new Date(), orderId: "ord-2" },
    );
    tables.orderItem.rows.push({ id: "item-1", orderId: "ord-1", productId: "prod-1" });
    const svc = makeService(tables);
    const out = await svc.handleReviewReceived({ organizationId: "org-1", reviewId: "rev-1", orderId: "ord-1", rating: 5 });
    expect(out.created).toBe(true);
    const post = tables.socialPost.rows[0];
    expect(post.autoDraftRef).toBe("review:rev-1");
    expect(post.caption).toContain("৫-তারকা");
    expect(post.caption).toContain("খুবই ভালো মানের পাঞ্জাবি!");
    expect(post.caption).toContain("Cotton Panjabi");
  });

  it("a non-5-star review below a milestone → nothing", async () => {
    const tables = fakePrisma();
    enabledConfig(tables);
    tables.orderReview.rows.push({ id: "rev-1", organizationId: "org-1", rating: 3, receivedAt: new Date(), orderId: "ord-1" });
    const svc = makeService(tables);
    const out = await svc.handleReviewReceived({ organizationId: "org-1", reviewId: "rev-1", orderId: "ord-1", rating: 3 });
    expect(out.created).toBe(false);
    expect(tables.socialPost.rows).toHaveLength(0);
  });
});

describe("SU5 settings", () => {
  it("getSettings without a row returns defaults and writes nothing", async () => {
    const tables = fakePrisma();
    const svc = makeService(tables);
    const out = await svc.getSettings("org-1");
    expect(out).toEqual({
      newProductEnabled: false, saleEnabled: false, backInStockEnabled: false,
      reviewMilestoneEnabled: false, maxDraftsPerDay: 3, socialAccountId: null,
      // SN8: syndication defaults joined the settings shape.
      rssEnabled: false, youtubeEnabled: false, rssFeedUrl: null,
    });
    expect(tables.socialAutoDraftConfig.rows).toHaveLength(0);
  });

  it("updateSettings upserts, validates the cap range and the account", async () => {
    const tables = fakePrisma();
    const svc = makeService(tables);
    const out = await svc.updateSettings("org-1", "actor-1", { newProductEnabled: true, maxDraftsPerDay: 5, socialAccountId: "acct-page" });
    expect(out.newProductEnabled).toBe(true);
    expect(out.maxDraftsPerDay).toBe(5);
    expect(out.socialAccountId).toBe("acct-page");
    expect(tables.socialAutoDraftConfig.rows).toHaveLength(1);
    await expect(svc.updateSettings("org-1", "actor-1", { maxDraftsPerDay: 21 })).rejects.toThrow();
    await expect(svc.updateSettings("org-1", "actor-1", { socialAccountId: "acct-nope" })).rejects.toThrow();
    await expect(svc.updateSettings("org-1", "actor-1", { socialAccountId: "acct-ig" })).resolves.toBeTruthy();
  });
});

describe("SU5 producer hooks", () => {
  it("ProductsService.create emits social_draft.product_created after success", async () => {
    const tables = fakePrisma();
    const events = new FakeEvents();
    const svc = new ProductsService(
      tables as any, auditStub, undefined, undefined, undefined, undefined, undefined, events as any,
    );
    await svc.create("org-1", "actor-1", { name: "New Shoe", price: "999.00" } as any);
    const hit = events.emitted.find((e) => e.event === "social_draft.product_created");
    expect(hit).toBeTruthy();
    expect(hit!.payload.organizationId).toBe("org-1");
    expect(hit!.payload.productId).toBeTruthy();
  });

  it("InventoryService.adjust emits back_in_stock only on a product-level 0 → positive move", async () => {
    const tables = fakePrisma();
    tables.product.rows[0].stockQuantity = 0;
    const events = new FakeEvents();
    const svc = new InventoryService(tables as any, auditStub, undefined, events as any);
    await svc.adjust("org-1", "actor-1", "prod-1", { delta: 5 });
    expect(events.emitted.filter((e) => e.event === "social_draft.back_in_stock")).toHaveLength(1);
    // Already in stock → restocking further is NOT a back-in-stock.
    await svc.adjust("org-1", "actor-1", "prod-1", { delta: 5 });
    expect(events.emitted.filter((e) => e.event === "social_draft.back_in_stock")).toHaveLength(1);
  });

  it("PromotionsService create (active) / setActive / update inactive→active emit promotion_activated", async () => {
    const tables = fakePrisma();
    const events = new FakeEvents();
    const svc = new PromotionsService(tables as any, {} as any, auditStub, events as any);
    const created = await svc.create("org-1", "actor-1", {
      name: "Flash Deal", type: "flash",
      config: { percentOff: 20, productIds: [], categoryIds: [] },
      startsAt: "2026-10-14T00:00:00.000Z", endsAt: "2026-10-20T00:00:00.000Z", active: true,
    } as any);
    expect(events.emitted.filter((e) => e.event === "social_draft.promotion_activated")).toHaveLength(1);
    const promoId = (created as any).promotion.id;

    await svc.setActive("org-1", "actor-1", promoId, false);
    expect(events.emitted.filter((e) => e.event === "social_draft.promotion_activated")).toHaveLength(1);
    await svc.setActive("org-1", "actor-1", promoId, true);
    expect(events.emitted.filter((e) => e.event === "social_draft.promotion_activated")).toHaveLength(2);

    // update(): active stays true → no NEW activation emit…
    await svc.update("org-1", "actor-1", promoId, { name: "Flash Deal 2" } as any);
    expect(events.emitted.filter((e) => e.event === "social_draft.promotion_activated")).toHaveLength(2);
    // …but flipping it off and on through update emits again.
    await svc.update("org-1", "actor-1", promoId, { active: false } as any);
    await svc.update("org-1", "actor-1", promoId, { active: true } as any);
    expect(events.emitted.filter((e) => e.event === "social_draft.promotion_activated")).toHaveLength(3);
  });

  it("ReviewsService.submitPublicReview emits social_draft.review_received", async () => {
    const tables = fakePrisma();
    tables.orderReview.rows.push({
      id: "rev-1", organizationId: "org-1", orderId: "ord-1", reviewToken: "tok-1",
      rating: null, status: "requested", deliveredAt: new Date(),
    });
    const events = new FakeEvents();
    const svc = new ReviewsService(tables as any, events as any);
    const out = await svc.submitPublicReview("tok-1", { rating: 5, comment: "Great" });
    expect(out.ok).toBe(true);
    const hit = events.emitted.find((e) => e.event === "social_draft.review_received");
    expect(hit).toBeTruthy();
    expect(hit!.payload).toMatchObject({ organizationId: "org-1", reviewId: "rev-1", orderId: "ord-1", rating: 5 });
  });

  it("the engine subscribes to all four bus events", async () => {
    const tables = fakePrisma();
    enabledConfig(tables);
    const events = new FakeEvents();
    makeService(tables, events as any);
    expect([...events.handlers.keys()].sort()).toEqual([
      "social_draft.back_in_stock",
      "social_draft.product_created",
      "social_draft.promotion_activated",
      "social_draft.review_received",
    ]);
    events.emit("social_draft.product_created", { organizationId: "org-1", productId: "prod-1" });
    // Handlers are fire-and-forget; let the microtask chain land.
    await new Promise((r) => setTimeout(r, 10));
    expect(tables.socialPost.rows).toHaveLength(1);
    expect(tables.socialPost.rows[0].autoDraftKind).toBe("new_product");
  });
});
