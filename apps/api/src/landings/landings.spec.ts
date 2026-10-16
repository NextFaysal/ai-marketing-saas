import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { LandingsService, assignVariant, fnv1aHash } from "./landings.service";
import { validateSections, normalizeSections, defaultSections } from "./sections";
import { StorefrontService } from "../storefront/storefront.service";
import { InventoryService } from "../inventory/inventory.service";

/* Fake prisma in the EC spec style (same matcher as the
 * storefront specs): equality, { in }, { not }, { gte/lte },
 * { contains, mode }, OR, orderBy (single or array), skip/take. */
function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (k === "OR") {
      if (!(v as any[]).some((sub) => matchWhere(row, sub))) return false;
      continue;
    }
    if (k === "AND") {
      if (!(v as any[]).every((sub) => matchWhere(row, sub))) return false;
      continue;
    }
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const cond: any = v;
      if ("in" in cond) {
        if (!cond.in.includes(row[k])) return false;
        continue;
      }
      if ("not" in cond) {
        if (row[k] === cond.not) return false;
        continue;
      }
      if ("gte" in cond || "lte" in cond) {
        if (row[k] === null || row[k] === undefined) return false;
        const t = new Date(row[k]).getTime();
        if ("gte" in cond && t < new Date(cond.gte).getTime()) return false;
        if ("lte" in cond && t > new Date(cond.lte).getTime()) return false;
        continue;
      }
      if ("contains" in cond) {
        const hay = String(row[k] ?? "");
        const needle = String(cond.contains);
        const hit =
          cond.mode === "insensitive"
            ? hay.toLowerCase().includes(needle.toLowerCase())
            : hay.includes(needle);
        if (!hit) return false;
        continue;
      }
      if (!matchWhere(row, cond)) return false;
    } else if (v === null) {
      if (row[k] !== null && row[k] !== undefined) return false;
    } else if (row[k] !== v) {
      return false;
    }
  }
  return true;
}

function applyOrderBy(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...rows];
  for (const spec of [...specs].reverse()) {
    for (const [field, dir] of Object.entries(spec)) {
      out.sort((a: any, b: any) => {
        const av = a[field];
        const bv = b[field];
        if (av === bv) return 0;
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        const cmp =
          av instanceof Date || bv instanceof Date
            ? new Date(av).getTime() - new Date(bv).getTime()
            : av < bv
              ? -1
              : 1;
        return dir === "desc" ? -cmp : cmp;
      });
    }
  }
  return out;
}

function makeTable() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where, orderBy }: any = {}) =>
      applyOrderBy(rows.filter((r) => matchWhere(r, where)), orderBy)[0] ?? null,
    findMany: async ({ where, orderBy, take, skip }: any = {}) => {
      let found = applyOrderBy(rows.filter((r) => matchWhere(r, where)), orderBy);
      if (skip) found = found.slice(skip);
      if (take !== undefined) found = found.slice(0, take);
      return found;
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)).length,
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return row;
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => matchWhere(r, where));
      if (idx < 0) throw new Error("record not found");
      return rows.splice(idx, 1)[0];
    },
    deleteMany: async ({ where }: any = {}) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (matchWhere(rows[i], where)) rows.splice(i, 1);
      }
      return { count: before - rows.length };
    },
  };
}

function makePrisma() {
  return {
    organization: makeTable(),
    businessProfile: makeTable(),
    product: makeTable(),
    productVariant: makeTable(),
    productImage: makeTable(),
    shippingZone: makeTable(),
    landingPage: makeTable(),
    landingVariant: makeTable(),
    landingEvent: makeTable(),
    order: makeTable(),
    orderItem: makeTable(),
    fulfillment: makeTable(),
    stockMovement: makeTable(),
    auditLog: makeTable(),
    bundleItem: makeTable(),
    membership: makeTable(),
    agentNotification: makeTable(),
  } as any;
}

const T0 = new Date("2026-10-01T00:00:00Z");
const T1 = new Date("2026-10-02T00:00:00Z");

function seedWorld(prisma: any) {
  prisma.organization.rows.push(
    { id: "org-1", slug: "shop-one", name: "Shop One Ltd" },
    { id: "org-2", slug: "shop-two", name: "Shop Two" },
  );
  prisma.businessProfile.rows.push({
    id: "bp-1",
    organizationId: "org-1",
    metaPixelId: "px-123",
    tikTokPixelId: "tt-456",
    codAvailable: true,
    // B8 fix: the fee columns are deliveryChargeInsideMinor /
    // deliveryChargeOutsideMinor (the old code read non-existent
    // insideDhakaFeeMinor fields and always fell back to the
    // 6000n/12000n defaults). Null here = unconfigured ⇒ default.
    deliveryChargeInsideMinor: null,
    deliveryChargeOutsideMinor: null,
  });
  prisma.product.rows.push(
    { id: "p-a", organizationId: "org-1", name: "লেদার ওয়ালেট", slug: "leather-wallet", description: "আসল চামড়া", category: "ওয়ালেট", categoryId: null, sku: "WAL-1", status: "ACTIVE", priceMinor: 50000n, compareAtMinor: 60000n, currency: "BDT", stockQuantity: 10, lowStockThreshold: null, imageUrl: "cover.jpg", bumpTitle: "কি-রিং যোগ করুন", bumpPriceMinor: 10000n, bumpImageUrl: null, createdAt: T0, updatedAt: T0 },
    { id: "p-up", organizationId: "org-1", name: "কার্ড হোল্ডার", slug: "card-holder", description: null, category: null, categoryId: null, sku: "UP-1", status: "ACTIVE", priceMinor: 20000n, compareAtMinor: null, currency: "BDT", stockQuantity: 5, lowStockThreshold: null, imageUrl: "up.jpg", bumpTitle: null, bumpPriceMinor: null, bumpImageUrl: null, createdAt: T0, updatedAt: T0 },
    { id: "p-draft", organizationId: "org-1", name: "খসড়া পণ্য", slug: "draft-item", description: null, category: null, categoryId: null, sku: "DRF-1", status: "DRAFT", priceMinor: 1000n, compareAtMinor: null, currency: "BDT", stockQuantity: 5, lowStockThreshold: null, imageUrl: null, bumpTitle: null, bumpPriceMinor: null, bumpImageUrl: null, createdAt: T0, updatedAt: T0 },
    { id: "p-other", organizationId: "org-2", name: "অন্য দোকানের পণ্য", slug: "other-item", description: null, category: null, categoryId: null, sku: "OTH-1", status: "ACTIVE", priceMinor: 9000n, compareAtMinor: null, currency: "BDT", stockQuantity: 5, lowStockThreshold: null, imageUrl: null, bumpTitle: null, bumpPriceMinor: null, bumpImageUrl: null, createdAt: T0, updatedAt: T0 },
  );
  prisma.productVariant.rows.push(
    { id: "pv-1", productId: "p-a", name: "কালো", sku: "WAL-1-BLK", priceMinor: 55000n, stockQuantity: 3, createdAt: T0, updatedAt: T0 },
    { id: "pv-up", productId: "p-up", name: "বাদামি", sku: "UP-1-BRN", priceMinor: 21000n, stockQuantity: 2, createdAt: T0, updatedAt: T0 },
  );
  prisma.productImage.rows.push(
    { id: "img-1", productId: "p-a", url: "cover.jpg", altText: null, position: 0, createdAt: T0, updatedAt: T0 },
    { id: "img-2", productId: "p-a", url: "side.jpg", altText: null, position: 1, createdAt: T0, updatedAt: T0 },
  );
  prisma.landingPage.rows.push(
    { id: "land-1", organizationId: "org-1", productId: "p-a", slug: "wallet-offer", title: "ওয়ালেট অফার", status: "published", sections: null, upsellProductId: "p-up", createdAt: T0, updatedAt: T0 },
    { id: "land-draft", organizationId: "org-1", productId: "p-a", slug: "draft-offer", title: "খসড়া অফার", status: "draft", sections: null, upsellProductId: null, createdAt: T0, updatedAt: T0 },
    { id: "land-foreign", organizationId: "org-2", productId: "p-other", slug: "foreign-offer", title: "Foreign", status: "published", sections: null, upsellProductId: null, createdAt: T0, updatedAt: T0 },
  );
  prisma.landingVariant.rows.push(
    { id: "lv-a", landingId: "land-1", name: "A (control)", isControl: true, weight: 50, headline: "সেরা ওয়ালেট", heroImageUrl: null, ctaText: "অর্ডার করুন", showCompareAt: true, createdAt: T0, updatedAt: T0 },
    { id: "lv-b", landingId: "land-1", name: "B", isControl: false, weight: 50, headline: "অফার ওয়ালেট", heroImageUrl: "hero-b.jpg", ctaText: "এখনই কিনুন", showCompareAt: false, createdAt: T1, updatedAt: T1 },
  );
}

/** Integrations stub mirroring the real upsertOrder's observable
 *  writes: an Order row + OrderItem rows with productId resolved
 *  by SKU within the org. */
function makeIntegrations(prisma: any) {
  return {
    upsertOrder: jest.fn(async (orgId: string, _storeId: any, o: any, source: string) => {
      const order = await prisma.order.create({
        data: {
          organizationId: orgId,
          source,
          externalId: o.externalId,
          externalNumber: o.externalNumber,
          status: o.status,
          paymentMethod: o.paymentMethod ?? null,
          isCod: o.isCod,
          currency: o.currency,
          subtotalMinor: o.subtotalMinor,
          shippingMinor: o.shippingMinor,
          discountMinor: o.discountMinor,
          taxMinor: o.taxMinor,
          totalMinor: o.totalMinor,
          refundedMinor: o.refundedMinor,
          placedAt: o.placedAt ?? null,
          landingPageId: null,
          landingVariantId: null,
        },
      });
      for (const item of o.items) {
        const prod = item.sku
          ? await prisma.product.findFirst({ where: { organizationId: orgId, sku: item.sku } })
          : null;
        await prisma.orderItem.create({
          data: {
            orderId: order.id,
            productId: prod?.id ?? null,
            name: item.name,
            sku: item.sku ?? null,
            quantity: item.quantity,
            priceMinor: item.priceMinor,
            totalMinor: item.totalMinor,
          },
        });
      }
      return "created";
    }),
  };
}

function makeDiscounts() {
  return {
    validateForCheckout: jest.fn(async (_orgId: string, code: string, ctx: any) => {
      const c = code.trim().toUpperCase();
      if (c === "SAVE10") {
        return { valid: true, discountMinor: ctx.subtotalMinor / 10n, freeShipping: false, discount: { id: "disc-1" } };
      }
      if (c === "FREESHIP") {
        return { valid: true, discountMinor: 0n, freeShipping: true, discount: { id: "disc-2" } };
      }
      return { valid: false, reason: "not_found", discountMinor: 0n, freeShipping: false };
    }),
    redeem: jest.fn(async () => ({})),
  };
}

function makeService(prisma: any, opts: { reviews?: any } = {}) {
  const audit = { log: jest.fn(async () => undefined) };
  const storefront = new StorefrontService(prisma);
  const discounts = makeDiscounts();
  const integrations = makeIntegrations(prisma);
  const inventory = new InventoryService(prisma, audit as any);
  const reviews =
    opts.reviews === undefined
      ? {
          getPublicProductReviews: jest.fn(async () => ({
            summary: { average: 4.5, count: 2 },
            items: [{ id: "r-1", rating: 5 }],
          })),
        }
      : opts.reviews;
  const svc = new LandingsService(
    prisma,
    audit as any,
    storefront as any,
    discounts as any,
    integrations as any,
    inventory as any,
    reviews,
  );
  return { svc, audit, discounts, integrations, inventory };
}

function setup(opts: { reviews?: any } = {}) {
  const prisma = makePrisma();
  seedWorld(prisma);
  const ctx = makeService(prisma, opts);
  return { prisma, ...ctx };
}

const ORDER_BODY = {
  customerName: "রহিম উদ্দিন",
  customerPhone: "01700000000",
  customerAddress: "বাসা ১, রোড ২, ঢাকা",
};

// ---------- sections validator ----------

describe("sections validator", () => {
  it("rejects an unknown block type with 400", () => {
    expect(() => validateSections([{ type: "countdown-timer" }])).toThrow(BadRequestException);
  });

  it("rejects more than 10 faq items and more than 8 benefits items", () => {
    const faq = Array.from({ length: 11 }, (_, i) => ({ q: `q${i}`, a: `a${i}` }));
    expect(() => validateSections([{ type: "faq", data: { items: faq } }])).toThrow(BadRequestException);
    const benefits = Array.from({ length: 9 }, (_, i) => ({ title: `b${i}`, text: "x" }));
    expect(() => validateSections([{ type: "benefits", data: { items: benefits } }])).toThrow(BadRequestException);
  });

  it("rejects an oversize description and an oversize total payload", () => {
    expect(() =>
      validateSections([{ type: "description", data: { text: "x".repeat(5001) } }]),
    ).toThrow(BadRequestException);
    const big = Array.from({ length: 8 }, () => ({
      type: "hero",
      data: { blob: "y".repeat(3000) },
    }));
    expect(() => validateSections(big)).toThrow(BadRequestException);
  });

  it("rejects faq items missing q or a, and trust strings over 300 chars", () => {
    expect(() => validateSections([{ type: "faq", data: { items: [{ q: "প্রশ্ন?" }] } }])).toThrow(
      BadRequestException,
    );
    expect(() =>
      validateSections([{ type: "trust", data: { codText: "z".repeat(301) } }]),
    ).toThrow(BadRequestException);
  });

  it("normalizes defaults (enabled=true, order=index) and sorts by order", () => {
    const out = validateSections([
      { type: "faq", order: 5, data: { items: [{ q: "q", a: "a" }] } },
      { type: "hero" },
      { type: "trust", enabled: false, order: 2, data: { codText: "ক্যাশ অন ডেলিভারি" } },
    ]);
    expect(out.map((s) => s.type)).toEqual(["hero", "trust", "faq"]);
    expect(out[0]).toEqual({ type: "hero", enabled: true, order: 1, data: {} });
    expect(out[1].enabled).toBe(false);
    expect(out[2].order).toBe(5);
  });

  it("null sections ⇒ the 8 default blocks in order", () => {
    const defs = normalizeSections(null);
    expect(defs.map((s) => s.type)).toEqual([
      "hero", "description", "benefits", "gallery", "reviews", "faq", "offer", "trust",
    ]);
    expect(defs.every((s) => s.enabled)).toBe(true);
    expect(defaultSections()).toHaveLength(8);
  });
});

// ---------- variant assignment ----------

describe("assignVariant", () => {
  const v = (id: string, weight: number, isControl: boolean, day: number) => ({
    id, weight, isControl, createdAt: new Date(`2026-10-0${day}T00:00:00Z`),
  });

  it("returns null when there are no variants", () => {
    expect(assignVariant([], "visitor-1")).toBeNull();
    expect(assignVariant(undefined as any, "visitor-1")).toBeNull();
  });

  it("is deterministic: the same token always lands on the same variant", () => {
    const rows = [v("a", 50, true, 1), v("b", 50, false, 2)];
    for (const token of ["visitor-1", "visitor-2", "abc", "xyz-99"]) {
      const first = assignVariant(rows, token);
      for (let i = 0; i < 5; i++) expect(assignVariant(rows, token)?.id).toBe(first?.id);
    }
  });

  it("never picks a weight-0 variant", () => {
    const rows = [v("zero", 0, false, 1), v("full", 100, false, 2)];
    for (let i = 0; i < 60; i++) {
      expect(assignVariant(rows, `visitor-${i}`)?.id).toBe("full");
    }
  });

  it("walks cumulative weights and falls back to control beyond the total weight", () => {
    const rows = [v("first", 10, false, 1), v("ctrl", 10, true, 2)];
    let sawFirst = false;
    let sawWalk = false;
    let sawFallback = false;
    for (let i = 0; i < 500; i++) {
      const token = `visitor-${i}`;
      const bucket = fnv1aHash(token) % 100;
      const picked = assignVariant(rows, token)?.id;
      if (bucket < 10) { expect(picked).toBe("first"); sawFirst = true; }
      else if (bucket < 20) { expect(picked).toBe("ctrl"); sawWalk = true; }
      else { expect(picked).toBe("ctrl"); sawFallback = true; }
    }
    expect(sawFirst && sawWalk && sawFallback).toBe(true);
  });

  it("treats a missing token as the stable 'anon' bucket", () => {
    const rows = [v("a", 50, true, 1), v("b", 50, false, 2)];
    expect(assignVariant(rows, undefined)?.id).toBe(assignVariant(rows, "anon")?.id);
    expect(assignVariant(rows, "")?.id).toBe(assignVariant(rows, "anon")?.id);
  });
});

// ---------- staff CRUD ----------

describe("LandingsService — staff CRUD", () => {
  it("creates a landing with an auto slug derived from the title", async () => {
    const { svc } = setup();
    const created = await svc.create("org-1", "user-1", {
      productId: "p-a",
      title: "My Cool Product!",
    } as any);
    expect(created.slug).toMatch(/^my-cool-product-[a-z0-9]{4}$/);
    expect(created.status).toBe("draft");
    expect(created.variants).toEqual([]);
  });

  it("404s when the product belongs to another org", async () => {
    const { svc } = setup();
    await expect(
      svc.create("org-1", "user-1", { productId: "p-other", title: "X" } as any),
    ).rejects.toThrow(NotFoundException);
    await expect(
      svc.create("org-1", "user-1", { productId: "p-a", title: "X", upsellProductId: "p-other" } as any),
    ).rejects.toThrow(NotFoundException);
  });

  it("409s on an explicit slug that clashes globally, 400s on a non-URL-safe slug", async () => {
    const { svc } = setup();
    await expect(
      svc.create("org-1", "user-1", { productId: "p-a", title: "X", slug: "wallet-offer" } as any),
    ).rejects.toThrow(ConflictException);
    // slug uniqueness is global — org-2's slug also clashes from org-1.
    await expect(
      svc.create("org-2", "user-1", { productId: "p-other", title: "X", slug: "wallet-offer" } as any),
    ).rejects.toThrow(ConflictException);
    await expect(
      svc.create("org-1", "user-1", { productId: "p-a", title: "X", slug: "Bad Slug!" } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it("validates sections on create (unknown type ⇒ 400)", async () => {
    const { svc } = setup();
    await expect(
      svc.create("org-1", "user-1", {
        productId: "p-a",
        title: "X",
        sections: [{ type: "nope" }],
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it("404s foreign landings on getOne / update / variant create", async () => {
    const { svc } = setup();
    await expect(svc.getOne("org-2", "land-1")).rejects.toThrow(NotFoundException);
    await expect(
      svc.update("org-2", "user-1", "land-1", { title: "Hacked" } as any),
    ).rejects.toThrow(NotFoundException);
    await expect(
      svc.createVariant("org-2", "user-1", "land-1", { name: "V" } as any),
    ).rejects.toThrow(NotFoundException);
    await expect(
      svc.updateVariant("org-1", "user-1", "land-1", "lv-foreign", { name: "V" } as any),
    ).rejects.toThrow(NotFoundException);
  });

  it("PATCH slug re-validates uniqueness excluding itself", async () => {
    const { svc } = setup();
    await expect(
      svc.update("org-1", "user-1", "land-1", { slug: "draft-offer" } as any),
    ).rejects.toThrow(ConflictException);
    const ok = await svc.update("org-1", "user-1", "land-1", { slug: "wallet-offer" } as any);
    expect(ok.slug).toBe("wallet-offer");
  });

  it("setting isControl=true on a new variant clears the previous control", async () => {
    const { svc, prisma } = setup();
    const created = await svc.createVariant("org-1", "user-1", "land-1", {
      name: "C",
      isControl: true,
      weight: 20,
    } as any);
    const rows = prisma.landingVariant.rows.filter((r: any) => r.landingId === "land-1");
    expect(rows.find((r: any) => r.id === "lv-a").isControl).toBe(false);
    expect(rows.find((r: any) => r.id === created.id).isControl).toBe(true);
    expect(rows.find((r: any) => r.id === "lv-b").isControl).toBe(false);
    // PATCH path clears too.
    await svc.updateVariant("org-1", "user-1", "land-1", "lv-b", { isControl: true } as any);
    const after = prisma.landingVariant.rows.filter((r: any) => r.landingId === "land-1");
    expect(after.filter((r: any) => r.isControl).map((r: any) => r.id)).toEqual(["lv-b"]);
  });

  it("rejects an out-of-range variant weight at the service layer", async () => {
    const { svc } = setup();
    await expect(
      svc.createVariant("org-1", "user-1", "land-1", { name: "V", weight: 101 } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it("DELETE archives instead of hard-deleting (attributed orders keep history)", async () => {
    const { svc, prisma } = setup();
    const res = await svc.archive("org-1", "user-1", "land-1");
    expect(res.status).toBe("archived");
    expect(res.archived).toBe(true);
    expect(prisma.landingPage.rows.some((r: any) => r.id === "land-1")).toBe(true);
    await expect(svc.getPublicLanding("wallet-offer", "v-1")).rejects.toThrow(NotFoundException);
  });

  it("list carries product name + attributed order/revenue aggregates", async () => {
    const { svc, prisma } = setup();
    prisma.order.rows.push(
      { id: "o-1", organizationId: "org-1", source: "landing", externalId: "landing-x", status: "processing", totalMinor: 70000n, landingPageId: "land-1", landingVariantId: "lv-a", placedAt: new Date(), createdAt: new Date() },
      { id: "o-2", organizationId: "org-1", source: "landing", externalId: "landing-y", status: "processing", totalMinor: 30000n, landingPageId: "land-1", landingVariantId: null, placedAt: new Date(), createdAt: new Date() },
      { id: "o-3", organizationId: "org-1", source: "manual", externalId: "m-1", status: "processing", totalMinor: 999000n, landingPageId: null, landingVariantId: null, placedAt: new Date(), createdAt: new Date() },
    );
    const list = await svc.list("org-1");
    const row = list.items.find((i: any) => i.id === "land-1")!;
    expect(row.productName).toBe("লেদার ওয়ালেট");
    expect(row.orders).toBe(2);
    expect(row.revenueMinor).toBe("100000");
  });
});

// ---------- public payload ----------

describe("LandingsService — public payload", () => {
  it("404s for a draft landing and for an unknown slug", async () => {
    const { svc } = setup();
    await expect(svc.getPublicLanding("draft-offer", "v-1")).rejects.toThrow(NotFoundException);
    await expect(svc.getPublicLanding("no-such-slug", "v-1")).rejects.toThrow(NotFoundException);
  });

  it("404s when the landing's product is not ACTIVE", async () => {
    const { svc, prisma } = setup();
    await svc.create("org-1", "user-1", { productId: "p-draft", title: "Draft product landing", slug: "draft-product-offer", status: "published" } as any);
    expect(prisma.landingPage.rows.some((r: any) => r.slug === "draft-product-offer")).toBe(true);
    await expect(svc.getPublicLanding("draft-product-offer", "v-1")).rejects.toThrow(NotFoundException);
  });

  it("serves product (with gallery), org pixels, default sections, variant, upsell, reviews, districts", async () => {
    const { svc } = setup();
    const res = await svc.getPublicLanding("wallet-offer", "visitor-42");
    expect(res.landing).toEqual({ id: "land-1", slug: "wallet-offer", title: "ওয়ালেট অফার" });
    expect(res.product.name).toBe("লেদার ওয়ালেট");
    expect(res.product.priceMinor).toBe("50000");
    expect(res.product.compareAtMinor).toBe("60000");
    expect(res.product.images).toEqual(["cover.jpg", "side.jpg"]);
    expect(res.product.imageUrl).toBe("cover.jpg");
    expect(res.product.variants).toHaveLength(1);
    expect(res.product.variants[0].priceMinor).toBe("55000");
    expect(res.organization).toEqual({
      name: "Shop One Ltd", slug: "shop-one", metaPixelId: "px-123", tikTokPixelId: "tt-456",
      // EC18 (B8): trust copy comes from StorefrontSetting; the fake
      // has no setting row, so all three are null (blocks hidden).
      returnPolicyText: null, deliveryPromiseText: null, supportPhone: null,
    });
    expect(res.sections.map((s: any) => s.type)).toEqual([
      "hero", "description", "benefits", "gallery", "reviews", "faq", "offer", "trust",
    ]);
    expect(["lv-a", "lv-b"]).toContain(res.variant!.id);
    expect(res.variant).toEqual(
      res.variant!.id === "lv-a"
        ? { id: "lv-a", isControl: true, headline: "সেরা ওয়ালেট", heroImageUrl: null, ctaText: "অর্ডার করুন", showCompareAt: true }
        : { id: "lv-b", isControl: false, headline: "অফার ওয়ালেট", heroImageUrl: "hero-b.jpg", ctaText: "এখনই কিনুন", showCompareAt: false },
    );
    // Same visitor ⇒ same variant on a second load.
    const again = await svc.getPublicLanding("wallet-offer", "visitor-42");
    expect(again.variant!.id).toBe(res.variant!.id);
    expect(res.upsell).toEqual({ productId: "p-up", name: "কার্ড হোল্ডার", priceMinor: "20000", imageUrl: "up.jpg" });
    expect(res.reviews.summary).toEqual({ average: 4.5, count: 2 });
    expect(res.reviews.items).toHaveLength(1);
    expect(res.districts).toHaveLength(64);
    expect(res.delivery).toEqual({ hasZones: false });
  });

  it("serves an honest empty reviews block when the reviews service throws", async () => {
    const { svc } = setup({
      reviews: {
        getPublicProductReviews: jest.fn(async () => {
          throw new Error("reviews backend down");
        }),
      },
    });
    const res = await svc.getPublicLanding("wallet-offer", "visitor-1");
    expect(res.reviews).toEqual({ summary: { average: null, count: 0 }, items: [] });
    expect(res.product.name).toBe("লেদার ওয়ালেট");
  });

  it("serves an honest empty reviews block when no reviews service is wired", async () => {
    const { svc } = setup({ reviews: null });
    const res = await svc.getPublicLanding("wallet-offer", "visitor-1");
    expect(res.reviews).toEqual({ summary: { average: null, count: 0 }, items: [] });
  });

  it("filters disabled sections from the public payload", async () => {
    const { svc } = setup();
    await svc.update("org-1", "user-1", "land-1", {
      sections: [
        { type: "hero" },
        { type: "faq", enabled: false, data: { items: [{ q: "q", a: "a" }] } },
      ],
    } as any);
    const res = await svc.getPublicLanding("wallet-offer", "visitor-1");
    expect(res.sections.map((s: any) => s.type)).toEqual(["hero"]);
  });

  it("records view / checkout-started events; a foreign variantId is stored as null", async () => {
    const { svc, prisma } = setup();
    await expect(svc.recordEvent("draft-offer", "view", {})).rejects.toThrow(NotFoundException);
    await svc.recordEvent("wallet-offer", "view", { variantId: "lv-a" });
    await svc.recordEvent("wallet-offer", "checkout_started", { variantId: "lv-foreign" });
    const events = prisma.landingEvent.rows.filter((e: any) => e.landingId === "land-1");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ kind: "view", variantId: "lv-a" });
    expect(events[1]).toMatchObject({ kind: "checkout_started", variantId: null });
  });
});

// ---------- public order: no-zone (BusinessProfile) path ----------

describe("LandingsService — public order (no active zones)", () => {
  it("prices from the product row and falls back to 6000/12000 BP defaults", async () => {
    const { svc, prisma } = setup();
    const res = await svc.placeOrder("wallet-offer", { ...ORDER_BODY, quantity: 2 } as any);
    expect(res.success).toBe(true);
    // 2 × 50000 + inside-Dhaka default 6000.
    expect(res.totals).toEqual({
      subtotalMinor: "100000",
      discountMinor: "0",
      shippingMinor: "6000",
      totalMinor: "106000",
      codDueMinor: "106000",
    });
    expect(res.upsellEligible).toBe(true);
    expect(res.orderNumber).toMatch(/^ORD-/);
    const order = prisma.order.rows.find((o: any) => o.id === res.orderId);
    expect(order.source).toBe("landing");
    expect(order.externalId).toMatch(/^landing-/);
    expect(order.status).toBe("processing");
  });

  it("honours BusinessProfile inside/outside fees when the fields are present", async () => {
    const { svc, prisma } = setup();
    const bp = prisma.businessProfile.rows[0];
    bp.deliveryChargeInsideMinor = 7000n;
    bp.deliveryChargeOutsideMinor = 13000n;
    const inside = await svc.placeOrder("wallet-offer", { ...ORDER_BODY } as any);
    expect(inside.totals.shippingMinor).toBe("7000");
    const outside = await svc.placeOrder("wallet-offer", {
      ...ORDER_BODY,
      deliveryZone: "outside_dhaka",
    } as any);
    expect(outside.totals.shippingMinor).toBe("13000");
    expect(outside.totals.totalMinor).toBe("63000");
  });

  it("adds the bump BEFORE the coupon and validates the coupon on the bump-included subtotal", async () => {
    const { svc, prisma, discounts } = setup();
    const res = await svc.placeOrder("wallet-offer", {
      ...ORDER_BODY,
      includeBump: true,
      couponCode: "SAVE10",
    } as any);
    // subtotal 50000 + bump 10000 = 60000; SAVE10 ⇒ 6000 off; +6000 delivery.
    expect(res.totals).toEqual({
      subtotalMinor: "60000",
      discountMinor: "6000",
      shippingMinor: "6000",
      totalMinor: "60000",
      codDueMinor: "60000",
    });
    expect(discounts.validateForCheckout).toHaveBeenCalledWith(
      "org-1",
      "SAVE10",
      expect.objectContaining({ subtotalMinor: 60000n }),
    );
    expect(discounts.redeem).toHaveBeenCalledWith("org-1", "disc-1");
    const items = prisma.orderItem.rows.filter((i: any) => i.orderId === res.orderId);
    const bump = items.find((i: any) => i.sku === "ADD-ON-BUMP");
    expect(bump).toMatchObject({ name: "[Special Add-On] কি-রিং যোগ করুন", quantity: 1, totalMinor: 10000n });
  });

  it("rejects an invalid coupon before any order is written", async () => {
    const { svc, prisma } = setup();
    await expect(
      svc.placeOrder("wallet-offer", { ...ORDER_BODY, couponCode: "NOPE" } as any),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.order.rows).toHaveLength(0);
  });

  it("a free-shipping coupon zeroes delivery on the BP path too", async () => {
    const { svc } = setup();
    const res = await svc.placeOrder("wallet-offer", { ...ORDER_BODY, couponCode: "FREESHIP" } as any);
    expect(res.totals.shippingMinor).toBe("0");
    expect(res.totals.totalMinor).toBe("50000");
  });

  it("uses the variant price when a variant of the product is chosen; 400s a foreign variant", async () => {
    const { svc } = setup();
    const res = await svc.placeOrder("wallet-offer", { ...ORDER_BODY, variantId: "pv-1" } as any);
    expect(res.totals.subtotalMinor).toBe("55000");
    await expect(
      svc.placeOrder("wallet-offer", { ...ORDER_BODY, variantId: "pv-up" } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it("stamps landingPageId + served landingVariantId on the created order (foreign served variant ⇒ null)", async () => {
    const { svc, prisma } = setup();
    const res = await svc.placeOrder("wallet-offer", { ...ORDER_BODY, servedVariantId: "lv-b" } as any);
    const order = prisma.order.rows.find((o: any) => o.id === res.orderId);
    expect(order.landingPageId).toBe("land-1");
    expect(order.landingVariantId).toBe("lv-b");

    const res2 = await svc.placeOrder("wallet-offer", { ...ORDER_BODY, servedVariantId: "lv-foreign" } as any);
    const order2 = prisma.order.rows.find((o: any) => o.id === res2.orderId);
    expect(order2.landingPageId).toBe("land-1");
    expect(order2.landingVariantId).toBeNull();
  });

  it("404s ordering from a draft landing", async () => {
    const { svc } = setup();
    await expect(svc.placeOrder("draft-offer", { ...ORDER_BODY } as any)).rejects.toThrow(
      NotFoundException,
    );
  });
});

// ---------- public order: zone path ----------

describe("LandingsService — public order (ShippingZones)", () => {
  function addZones(prisma: any) {
    prisma.shippingZone.rows.push(
      { id: "z-in", organizationId: "org-1", name: "ঢাকার ভিতরে", kind: "inside_dhaka", districts: null, chargeMinor: 5000n, freeAboveMinor: 90000n, active: true, position: 1, createdAt: T0 },
      { id: "z-out", organizationId: "org-1", name: "ঢাকার বাইরে", kind: "outside_dhaka", districts: null, chargeMinor: 15000n, freeAboveMinor: null, active: true, position: 2, createdAt: T0 },
    );
  }

  it("charges the matched zone and reports hasZones in the payload", async () => {
    const { svc, prisma } = setup();
    addZones(prisma);
    const payload = await svc.getPublicLanding("wallet-offer", "visitor-1");
    expect(payload.delivery).toEqual({ hasZones: true });
    const res = await svc.placeOrder("wallet-offer", { ...ORDER_BODY, district: "ঢাকা" } as any);
    expect(res.totals.shippingMinor).toBe("5000");
    expect(res.totals.totalMinor).toBe("55000");
    const outside = await svc.placeOrder("wallet-offer", { ...ORDER_BODY, district: "চট্টগ্রাম" } as any);
    expect(outside.totals.shippingMinor).toBe("15000");
  });

  it("400s when the district is missing in zone mode", async () => {
    const { svc, prisma } = setup();
    addZones(prisma);
    await expect(svc.placeOrder("wallet-offer", { ...ORDER_BODY } as any)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.order.rows).toHaveLength(0);
  });

  it("freeAbove zeroes delivery on the DISCOUNTED subtotal", async () => {
    const { svc, prisma } = setup();
    addZones(prisma);
    // 2 × 50000 = 100000 ≥ 90000 ⇒ free.
    const free = await svc.placeOrder("wallet-offer", { ...ORDER_BODY, district: "ঢাকা", quantity: 2 } as any);
    expect(free.totals.shippingMinor).toBe("0");
    // With SAVE10: subtotal 100000 − 10000 = 90000 ≥ 90000 ⇒ still free…
    const discounted = await svc.placeOrder("wallet-offer", {
      ...ORDER_BODY, district: "ঢাকা", quantity: 2, couponCode: "SAVE10",
    } as any);
    expect(discounted.totals.shippingMinor).toBe("0");
    // …but 1 × 55000 (variant) − 5500 = 49500 < 90000 ⇒ charged.
    const charged = await svc.placeOrder("wallet-offer", {
      ...ORDER_BODY, district: "ঢাকা", variantId: "pv-1", couponCode: "SAVE10",
    } as any);
    expect(charged.totals.shippingMinor).toBe("5000");
  });

  it("400s when no zone matches the district (EC8 message)", async () => {
    const { svc, prisma } = setup();
    prisma.shippingZone.rows.push(
      { id: "z-in", organizationId: "org-1", name: "ঢাকার ভিতরে", kind: "inside_dhaka", districts: null, chargeMinor: 5000n, freeAboveMinor: null, active: true, position: 1, createdAt: T0 },
    );
    await expect(
      svc.placeOrder("wallet-offer", { ...ORDER_BODY, district: "চট্টগ্রাম" } as any),
    ).rejects.toThrow(/এই এলাকায় ডেলিভারি সেট করা নেই/);
  });
});

// ---------- post-order upsell ----------

describe("LandingsService — post-order upsell", () => {
  async function placeLandingOrder(svc: any) {
    const res = await svc.placeOrder("wallet-offer", { ...ORDER_BODY } as any);
    return res.orderId as string;
  }

  it("happy path: appends the upsell line, bumps totals, decrements stock via applyOrderPlaced, audits", async () => {
    const { svc, prisma, audit } = setup();
    const orderId = await placeLandingOrder(svc);
    const before = prisma.order.rows.find((o: any) => o.id === orderId);
    expect(before.totalMinor).toBe(56000n); // 50000 + 6000 delivery

    const res = await svc.addUpsell("wallet-offer", orderId);
    expect(res).toEqual({
      success: true,
      orderId,
      totalMinor: "76000",
      addedItem: { name: "কার্ড হোল্ডার", totalMinor: "20000" },
    });
    const after = prisma.order.rows.find((o: any) => o.id === orderId);
    expect(after.subtotalMinor).toBe(70000n);
    expect(after.totalMinor).toBe(76000n);
    const items = prisma.orderItem.rows.filter((i: any) => i.orderId === orderId);
    const added = items.find((i: any) => i.productId === "p-up");
    expect(added).toMatchObject({ name: "কার্ড হোল্ডার", sku: "UP-1", quantity: 1, priceMinor: 20000n, totalMinor: 20000n });
    // Stock moved through the inventory ledger, not a silent write.
    const upsellProduct = prisma.product.rows.find((p: any) => p.id === "p-up");
    expect(upsellProduct.stockQuantity).toBe(4);
    const movements = prisma.stockMovement.rows.filter(
      (m: any) => m.orderId === orderId && m.productId === "p-up" && m.reason === "order_placed",
    );
    expect(movements).toHaveLength(1);
    expect(movements[0].delta).toBe(-1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "landing.upsell_added", entityType: "Order", entityId: orderId }),
    );
  });

  it("refuses when the order did not come from this landing", async () => {
    const { svc, prisma } = setup();
    const orderId = await placeLandingOrder(svc);
    await expect(svc.addUpsell("draft-offer", orderId)).rejects.toThrow(BadRequestException);
    prisma.order.rows.find((o: any) => o.id === orderId).landingPageId = null;
    await expect(svc.addUpsell("wallet-offer", orderId)).rejects.toThrow(BadRequestException);
  });

  it("refuses a closed (non-open) order status", async () => {
    const { svc, prisma } = setup();
    const orderId = await placeLandingOrder(svc);
    prisma.order.rows.find((o: any) => o.id === orderId).status = "completed";
    await expect(svc.addUpsell("wallet-offer", orderId)).rejects.toThrow(/খোলা/);
  });

  it("refuses when a fulfillment already exists for the order", async () => {
    const { svc, prisma } = setup();
    const orderId = await placeLandingOrder(svc);
    prisma.fulfillment.rows.push({ id: "f-1", organizationId: "org-1", orderId, status: "pending", items: [] });
    await expect(svc.addUpsell("wallet-offer", orderId)).rejects.toThrow(/ফুলফিলমেন্ট/);
  });

  it("refuses after the 2-hour window", async () => {
    const { svc, prisma } = setup();
    const orderId = await placeLandingOrder(svc);
    const order = prisma.order.rows.find((o: any) => o.id === orderId);
    order.placedAt = new Date(Date.now() - 2 * 3600 * 1000 - 60_000);
    await expect(svc.addUpsell("wallet-offer", orderId)).rejects.toThrow(/২ ঘণ্টা/);
  });

  it("refuses when the upsell was already added", async () => {
    const { svc } = setup();
    const orderId = await placeLandingOrder(svc);
    await svc.addUpsell("wallet-offer", orderId);
    await expect(svc.addUpsell("wallet-offer", orderId)).rejects.toThrow(/ইতিমধ্যে/);
  });

  it("refuses when the landing has no upsell configured", async () => {
    const { svc, prisma } = setup();
    const orderId = await placeLandingOrder(svc);
    prisma.landingPage.rows.find((l: any) => l.id === "land-1").upsellProductId = null;
    await expect(svc.addUpsell("wallet-offer", orderId)).rejects.toThrow(/আপসেল পণ্য সেট করা নেই/);
  });

  it("404s an unknown landing slug, 400s an unknown order", async () => {
    const { svc } = setup();
    await expect(svc.addUpsell("no-such-slug", "whatever")).rejects.toThrow(NotFoundException);
    await expect(svc.addUpsell("wallet-offer", "no-such-order")).rejects.toThrow(BadRequestException);
  });

  it("aborts with 400 and writes NO item when the stock step throws", async () => {
    const { svc, prisma } = setup();
    const orderId = await placeLandingOrder(svc);
    (svc as any).inventory = {
      applyOrderPlaced: jest.fn(async () => {
        throw new Error("stock ledger unavailable");
      }),
    };
    await expect(svc.addUpsell("wallet-offer", orderId)).rejects.toThrow(BadRequestException);
    const items = prisma.orderItem.rows.filter((i: any) => i.orderId === orderId);
    expect(items.some((i: any) => i.productId === "p-up")).toBe(false);
    const order = prisma.order.rows.find((o: any) => o.id === orderId);
    expect(order.totalMinor).toBe(56000n);
  });
});

// ---------- stats ----------

describe("LandingsService — stats", () => {
  it("computes totals and per-variant conversion (null when views=0)", async () => {
    const { svc, prisma } = setup();
    prisma.landingEvent.rows.push(
      { id: "e-1", landingId: "land-1", variantId: "lv-a", kind: "view", createdAt: new Date() },
      { id: "e-2", landingId: "land-1", variantId: "lv-a", kind: "view", createdAt: new Date() },
      { id: "e-3", landingId: "land-1", variantId: "lv-b", kind: "view", createdAt: new Date() },
      { id: "e-4", landingId: "land-1", variantId: "lv-b", kind: "view", createdAt: new Date() },
      { id: "e-5", landingId: "land-1", variantId: null, kind: "view", createdAt: new Date() },
      { id: "e-6", landingId: "land-1", variantId: "lv-a", kind: "checkout_started", createdAt: new Date() },
      { id: "e-7", landingId: "land-draft", variantId: null, kind: "view", createdAt: new Date() },
    );
    prisma.order.rows.push(
      { id: "o-1", organizationId: "org-1", source: "landing", externalId: "l-1", status: "processing", totalMinor: 50000n, landingPageId: "land-1", landingVariantId: "lv-a", placedAt: new Date(), createdAt: new Date() },
      { id: "o-2", organizationId: "org-1", source: "landing", externalId: "l-2", status: "processing", totalMinor: 50000n, landingPageId: "land-1", landingVariantId: "lv-a", placedAt: new Date(), createdAt: new Date() },
      { id: "o-3", organizationId: "org-1", source: "landing", externalId: "l-3", status: "processing", totalMinor: 30000n, landingPageId: "land-1", landingVariantId: "lv-b", placedAt: new Date(), createdAt: new Date() },
      { id: "o-4", organizationId: "org-1", source: "landing", externalId: "l-4", status: "processing", totalMinor: 99000n, landingPageId: "land-draft", landingVariantId: null, placedAt: new Date(), createdAt: new Date() },
    );
    const stats = await svc.stats("org-1", "land-1");
    expect(stats.views).toBe(5);
    expect(stats.checkoutStarted).toBe(1);
    expect(stats.orders).toBe(3);
    expect(stats.revenueMinor).toBe("130000");
    expect(stats.conversionPct).toBe(60);
    const a = stats.variants.find((x: any) => x.variantId === "lv-a");
    const b = stats.variants.find((x: any) => x.variantId === "lv-b");
    // AB7 (AX20): conversionRate + vsControl ride the same rows
    // (tie on views => A, earliest created, is the significance
    // control; both sides < 30 views => B is insufficient_data).
    expect(a).toEqual({ variantId: "lv-a", name: "A (control)", views: 2, orders: 2, revenueMinor: "100000", conversionPct: 100, conversionRate: 1, vsControl: null });
    expect(b).toEqual({ variantId: "lv-b", name: "B", views: 2, orders: 1, revenueMinor: "30000", conversionPct: 50, conversionRate: 0.5, vsControl: { pValue: null, significant: false, note: "insufficient_data" } });
    expect(stats.winnerId).toBeNull();
  });

  it("conversionPct is null when there are no views", async () => {
    const { svc } = setup();
    const stats = await svc.stats("org-1", "land-1");
    expect(stats.views).toBe(0);
    expect(stats.conversionPct).toBeNull();
    expect(stats.variants[0].conversionPct).toBeNull();
  });

  it("404s stats for a foreign landing", async () => {
    const { svc } = setup();
    await expect(svc.stats("org-2", "land-1")).rejects.toThrow(NotFoundException);
  });
});
