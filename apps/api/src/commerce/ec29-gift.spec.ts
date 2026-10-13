import { DiscountsService } from "./discounts.service";
import { PromotionsService } from "./promotions.service";

/** EC29 — gift promotions: threshold selection in
 * PromotionsService.evaluateCheckout (real service + fake prisma,
 * ec16 spec style) and the giftPlacement stock/variant rules. */

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
    promotion: makeTable(),
    product: makeTable(),
    productVariant: makeTable(),
    category: makeTable(),
    storeDiscount: makeTable(),
    storefrontSetting: makeTable(),
    customer: makeTable(),
    order: makeTable(),
  } as any;
}

const T0 = new Date("2026-10-01T00:00:00Z");
const auditStub: any = { log: jest.fn(async () => undefined) };

function makeServices(prisma: any) {
  const discounts = new DiscountsService(prisma, {} as any, auditStub);
  const promotions = new PromotionsService(prisma, discounts, auditStub);
  return { discounts, promotions };
}

function giftRow(partial: any = {}) {
  return {
    id: "pr-gift", organizationId: "org-1", name: "ফ্রি উপহার",
    type: "gift",
    config: { minSubtotalMinor: "100000", giftProductId: "p-gift", giftQty: 1 },
    startsAt: null, endsAt: null, active: true, priority: 0, createdBy: "u1",
    createdAt: T0, updatedAt: T0, ...partial,
  };
}

function seedGiftProduct(prisma: any, partial: any = {}) {
  prisma.product.rows.push({
    id: "p-gift", organizationId: "org-1", name: "উপহার পণ্য", status: "ACTIVE",
    priceMinor: 5000n, stockQuantity: 10, preorderEnabled: false,
    createdAt: T0, updatedAt: T0, ...partial,
  });
}

const LINES = (subtotalQty: number) => [
  { productId: "p-1", categoryId: null, quantity: subtotalQty, unitPriceMinor: 50000n, compareAtMinor: null },
];

describe("EC29 gift selection in evaluateCheckout", () => {
  it("threshold boundary: subtotal == threshold qualifies; threshold − 1 does not", async () => {
    const prisma = makePrisma();
    seedGiftProduct(prisma);
    prisma.promotion.rows.push(giftRow());
    const { promotions } = makeServices(prisma);
    // 2 × 50000 = 100000 == threshold
    const hit = await promotions.evaluateCheckout("org-1", { lines: LINES(2) });
    expect(hit.gift?.promotionId).toBe("pr-gift");
    expect(hit.gift?.productId).toBe("p-gift");
    // 99999 < 100000
    const miss = await promotions.evaluateCheckout("org-1", {
      lines: [{ productId: "p-1", categoryId: null, quantity: 1, unitPriceMinor: 99999n, compareAtMinor: null }],
    });
    expect(miss.gift).toBeNull();
  });

  it("two qualifying gifts → only the highest-priority one wins", async () => {
    const prisma = makePrisma();
    seedGiftProduct(prisma);
    prisma.product.rows.push({
      id: "p-gift-2", organizationId: "org-1", name: "দ্বিতীয় উপহার", status: "ACTIVE",
      priceMinor: 1000n, stockQuantity: null, createdAt: T0, updatedAt: T0,
    });
    prisma.promotion.rows.push(giftRow({ priority: 1 }));
    prisma.promotion.rows.push(giftRow({
      id: "pr-gift-high", name: "বড় উপহার", priority: 9,
      config: { minSubtotalMinor: "50000", giftProductId: "p-gift-2", giftQty: 2 },
    }));
    const { promotions } = makeServices(prisma);
    const ev = await promotions.evaluateCheckout("org-1", { lines: LINES(2) });
    expect(ev.gift?.promotionId).toBe("pr-gift-high");
    expect(ev.gift?.giftQty).toBe(2);
  });

  it("gift product inactive → falls through to the next candidate", async () => {
    const prisma = makePrisma();
    seedGiftProduct(prisma, { id: "p-gift-off", status: "DRAFT" });
    seedGiftProduct(prisma);
    prisma.promotion.rows.push(giftRow({
      id: "pr-gift-first", priority: 9,
      config: { minSubtotalMinor: "1000", giftProductId: "p-gift-off", giftQty: 1 },
    }));
    prisma.promotion.rows.push(giftRow({ priority: 1 }));
    const { promotions } = makeServices(prisma);
    const ev = await promotions.evaluateCheckout("org-1", { lines: LINES(2) });
    expect(ev.gift?.promotionId).toBe("pr-gift");
  });

  it("no qualifying gift → gift null", async () => {
    const prisma = makePrisma();
    seedGiftProduct(prisma);
    prisma.promotion.rows.push(giftRow({ config: { minSubtotalMinor: "999999999", giftProductId: "p-gift", giftQty: 1 } }));
    const { promotions } = makeServices(prisma);
    const ev = await promotions.evaluateCheckout("org-1", { lines: LINES(2) });
    expect(ev.gift).toBeNull();
  });

  it("malformed stored gift config is skipped without throwing", async () => {
    const prisma = makePrisma();
    seedGiftProduct(prisma);
    prisma.promotion.rows.push(giftRow({
      id: "pr-gift-bad", priority: 99,
      config: { minSubtotalMinor: "not-a-number" },
    }));
    prisma.promotion.rows.push(giftRow({ priority: 1 }));
    const { promotions } = makeServices(prisma);
    const ev = await promotions.evaluateCheckout("org-1", { lines: LINES(2) });
    expect(ev.gift?.promotionId).toBe("pr-gift");
  });

  it("gift never enters promotionsApplied or totalDiscountMinor", async () => {
    const prisma = makePrisma();
    seedGiftProduct(prisma);
    prisma.promotion.rows.push(giftRow());
    const { promotions } = makeServices(prisma);
    const ev = await promotions.evaluateCheckout("org-1", { lines: LINES(2) });
    expect(ev.gift).not.toBeNull();
    expect(ev.promotionsApplied).toEqual([]);
    expect(ev.promotionDiscountMinor).toBe(0n);
    expect(ev.totalDiscountMinor).toBe(0n);
  });

  it("preview() includes the gift", async () => {
    const prisma = makePrisma();
    seedGiftProduct(prisma);
    prisma.product.rows.push({
      id: "p-1", organizationId: "org-1", name: "মূল পণ্য", status: "ACTIVE",
      priceMinor: 50000n, compareAtMinor: null, categoryId: null, createdAt: T0, updatedAt: T0,
    });
    prisma.promotion.rows.push(giftRow());
    const { promotions } = makeServices(prisma);
    const res: any = await promotions.preview("org-1", { items: [{ productId: "p-1", quantity: 2 }] } as any);
    expect(res.gift).toEqual({
      promotionId: "pr-gift", name: "ফ্রি উপহার", productId: "p-gift", giftVariantSku: null, quantity: 1,
    });
    expect(res.totalDiscountMinor).toBe("0");
  });
});

describe("EC29 giftPlacement", () => {
  const GIFT = { promotionId: "pr-gift", name: "ফ্রি উপহার", productId: "p-gift", giftVariantSku: null, giftQty: 2 };

  it("in stock → placement resolves product (+ variant by SKU)", async () => {
    const prisma = makePrisma();
    seedGiftProduct(prisma);
    prisma.productVariant.rows.push({
      id: "v-gift", productId: "p-gift", name: "ছোট", sku: "GIFT-S", priceMinor: 5000n, stockQuantity: 3,
      createdAt: T0, updatedAt: T0,
    });
    const { promotions } = makeServices(prisma);
    const plain = await promotions.giftPlacement("org-1", GIFT);
    expect(plain?.product.id).toBe("p-gift");
    expect(plain?.variant).toBeNull();
    const withVariant = await promotions.giftPlacement("org-1", { ...GIFT, giftVariantSku: "GIFT-S" });
    expect(withVariant?.variant?.id).toBe("v-gift");
  });

  it("tracked stock below giftQty → null (skip)", async () => {
    const prisma = makePrisma();
    seedGiftProduct(prisma, { stockQuantity: 1 });
    const { promotions } = makeServices(prisma);
    expect(await promotions.giftPlacement("org-1", GIFT)).toBeNull();
  });

  it("configured variant SKU missing → null", async () => {
    const prisma = makePrisma();
    seedGiftProduct(prisma);
    const { promotions } = makeServices(prisma);
    expect(await promotions.giftPlacement("org-1", { ...GIFT, giftVariantSku: "GONE" })).toBeNull();
  });

  it("untracked stock (null) → placement", async () => {
    const prisma = makePrisma();
    seedGiftProduct(prisma, { stockQuantity: null });
    const { promotions } = makeServices(prisma);
    const placement = await promotions.giftPlacement("org-1", GIFT);
    expect(placement?.product.id).toBe("p-gift");
  });

  it("create validates a gift promotion end-to-end (variant SKU must exist)", async () => {
    const prisma = makePrisma();
    seedGiftProduct(prisma);
    const { promotions } = makeServices(prisma);
    const created: any = await promotions.create("org-1", "u1", {
      name: "উপহার অফার", type: "gift",
      config: { minSubtotalMinor: "100000", giftProductId: "p-gift", giftQty: 2 },
    } as any);
    expect(created.promotion.type).toBe("gift");
    await expect(
      promotions.create("org-1", "u1", {
        name: "খারাপ", type: "gift",
        config: { minSubtotalMinor: "100", giftProductId: "p-gift", giftVariantSku: "NOPE" },
      } as any),
    ).rejects.toThrow(/উপহারের ভ্যারিয়েন্ট SKU পাওয়া যায়নি/);
    await expect(
      promotions.create("org-1", "u1", {
        name: "খারাপ ২", type: "gift", config: { giftProductId: "p-gift" },
      } as any),
    ).rejects.toThrow(/ন্যূনতম অর্ডার পরিমাণ/);
  });
});
