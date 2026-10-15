import { ProductsService } from "./products.service";
import { DiscountsService } from "../commerce/discounts.service";
import { PromotionsService } from "../commerce/promotions.service";

/** EC29 — single-product checkout (placePublicOrder) gift +
 * gift-wrap, plus the getPublicProductBySlug giftWrap offer.
 * No ProductsService checkout spec harness existed for this
 * surface in this style, so this file builds one with stubbed
 * deps in the same fake-prisma style as the ec16 harness. */

function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in (v as any)) {
        if (!((v as any).in as any[]).includes(row[k])) return false;
        continue;
      }
      if ("not" in (v as any)) {
        if (row[k] === (v as any).not) return false;
        continue;
      }
      if (!matchWhere(row, v)) return false;
    } else if (row[k] !== v) return false;
  }
  return true;
}

function applyOrderBy(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...rows];
  for (const spec of [...specs].reverse()) {
    const [key, dir] = Object.entries(spec)[0] as [string, string];
    out.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
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
  };
}

function makePrisma() {
  return {
    product: makeTable(),
    productVariant: makeTable(),
    promotion: makeTable(),
    storeDiscount: makeTable(),
    storefrontSetting: makeTable(),
    deliverySlot: makeTable(),
    customer: makeTable(),
    category: makeTable(),
    order: makeTable(),
  } as any;
}

const T0 = new Date("2026-10-01T00:00:00Z");
const auditStub: any = { log: jest.fn(async () => undefined) };

function seed(prisma: any) {
  prisma.product.rows.push(
    {
      id: "p-1", organizationId: "org-1", name: "প্রিমিয়াম পণ্য", slug: "prod-one",
      sku: "P-1", status: "ACTIVE", priceMinor: 100000n, compareAtMinor: null,
      categoryId: null, currency: "BDT", stockQuantity: null, preorderEnabled: false,
      digital: false, bumpTitle: null, bumpPriceMinor: null, variants: [],
      organization: {
        id: "org-1", name: "Shop One",
        businessProfile: { deliveryChargeInsideMinor: 6000n, deliveryChargeOutsideMinor: 12000n },
      },
      createdAt: T0, updatedAt: T0,
    },
    {
      id: "p-gift", organizationId: "org-1", name: "উপহার পণ্য", slug: "gift-one",
      sku: "GFT-1", status: "ACTIVE", priceMinor: 5000n, compareAtMinor: null,
      categoryId: null, currency: "BDT", stockQuantity: 10, preorderEnabled: false,
      createdAt: T0, updatedAt: T0,
    },
  );
  prisma.storefrontSetting.rows.push({
    id: "set-1", organizationId: "org-1", shopEnabled: true,
    referralDiscountPercent: null, referralMinSubtotalMinor: null,
    giftWrapEnabled: true, giftWrapFeeMinor: 3000n,
    createdAt: T0, updatedAt: T0,
  });
  prisma.promotion.rows.push({
    id: "pr-gift", organizationId: "org-1", name: "ফ্রি উপহার", type: "gift",
    config: { minSubtotalMinor: "150000", giftProductId: "p-gift", giftQty: 1 },
    startsAt: null, endsAt: null, active: true, priority: 0, createdBy: "u1",
    createdAt: T0, updatedAt: T0,
  });
}

function makeServices(prisma: any) {
  const discounts = new DiscountsService(prisma, {} as any, auditStub);
  const promotions = new PromotionsService(prisma, discounts, auditStub);
  const captured: any[] = [];
  let seq = 0;
  const integrations: any = {
    upsertOrder: jest.fn(async (orgId: string, _storeId: any, payload: any, source: string) => {
      captured.push(payload);
      prisma.order.rows.push({
        id: `order-${++seq}`, organizationId: orgId, source,
        externalId: payload.externalId, externalNumber: payload.externalNumber,
        status: payload.status, totalMinor: payload.totalMinor,
        createdAt: new Date(), updatedAt: new Date(),
      });
      return "created";
    }),
  };
  const products = new ProductsService(prisma, auditStub, undefined, integrations, undefined, discounts, promotions);
  return { products, integrations, captured };
}

const ORDER_DTO = {
  customerName: "Buyer", customerPhone: "01711111111", customerAddress: "Dhaka address",
  quantity: 2, deliveryZone: "inside_dhaka",
};

describe("EC29 single checkout — gift", () => {
  it("gift applied: price-0 gift item with productId appended; response + order stamp agree", async () => {
    const prisma = makePrisma();
    seed(prisma);
    const { products, captured } = makeServices(prisma);
    const res: any = await products.placePublicOrder("prod-one", { ...ORDER_DTO } as any);
    // 2 × 100000 = 200000 ≥ 150000 threshold.
    expect(res.gift).toEqual({ promotionName: "ফ্রি উপহার", productName: "উপহার পণ্য", quantity: 1 });
    expect(res.giftSkipped).toBe(false);
    expect(res.totalMinor).toBe("206000"); // 200000 + 6000 shipping, gift is free
    const giftItem = captured[0].items.find((i: any) => i.isGift);
    expect(giftItem.productId).toBe("p-gift");
    expect(BigInt(giftItem.priceMinor)).toBe(0n);
    const order = prisma.order.rows[0];
    expect(order.giftPromotionId).toBe("pr-gift");
    expect(order.giftSkipped).toBe(false);
  });

  it("gift out of stock → skipped, order still succeeds without the gift item", async () => {
    const prisma = makePrisma();
    seed(prisma);
    prisma.product.rows.find((p: any) => p.id === "p-gift").stockQuantity = 0;
    const { products, captured } = makeServices(prisma);
    const res: any = await products.placePublicOrder("prod-one", { ...ORDER_DTO } as any);
    expect(res.success).toBe(true);
    expect(res.gift).toBeNull();
    expect(res.giftSkipped).toBe(true);
    expect(captured[0].items.some((i: any) => i.isGift)).toBe(false);
    expect(prisma.order.rows[0].giftSkipped).toBe(true);
  });

  it("below threshold → no gift, neutral response fields", async () => {
    const prisma = makePrisma();
    seed(prisma);
    const { products } = makeServices(prisma);
    const res: any = await products.placePublicOrder("prod-one", { ...ORDER_DTO, quantity: 1 } as any);
    expect(res.gift).toBeNull();
    expect(res.giftSkipped).toBe(false);
    expect(res.giftWrapMinor).toBe("0");
    expect(res.totalMinor).toBe("106000");
  });
});

describe("EC29 single checkout — gift wrap", () => {
  it("wrap requested + enabled → fee in total exactly once, stamped with the message", async () => {
    const prisma = makePrisma();
    seed(prisma);
    const { products } = makeServices(prisma);
    const res: any = await products.placePublicOrder("prod-one", {
      ...ORDER_DTO, quantity: 1, giftWrap: true, giftMessage: "অভিনন্দন!",
    } as any);
    // 100000 + 6000 shipping + 3000 wrap.
    expect(res.totalMinor).toBe("109000");
    expect(res.giftWrapMinor).toBe("3000");
    const order = prisma.order.rows[0];
    expect(BigInt(order.giftWrapMinor)).toBe(3000n);
    expect(order.giftMessage).toBe("অভিনন্দন!");
  });

  it("getPublicProductBySlug exposes the top-level giftWrap offer; null when disabled", async () => {
    const prisma = makePrisma();
    seed(prisma);
    const { products } = makeServices(prisma);
    const info: any = await products.getPublicProductBySlug("prod-one");
    expect(info.giftWrap).toEqual({ enabled: true, feeMinor: "3000" });
    prisma.storefrontSetting.rows[0].giftWrapEnabled = false;
    const info2: any = await products.getPublicProductBySlug("prod-one");
    expect(info2.giftWrap).toBeNull();
  });
});
