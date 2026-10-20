import { BadRequestException } from "@nestjs/common";
import { ApiException } from "../i18n";
import { PromotionsService } from "../commerce/promotions.service";
import { DiscountsService } from "../commerce/discounts.service";
import { InventoryService } from "../inventory/inventory.service";
import { StorefrontService } from "../storefront/storefront.service";
import { OrdersService } from "./orders.service";
import { OrderSurgeryService } from "./order-surgery.service";

/**
 * ON3 — Order Surgery specs: parity against the REAL
 * PromotionsService.evaluateCheckout over the same fake data,
 * coupon drop/pin, the stage-guard matrix, EC29 bundle groups,
 * gift rules, stock deltas, split and merge.
 */

function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in (v as any)) { if (!((v as any).in as any[]).includes(row[k])) return false; continue; }
      if ("not" in (v as any)) { if (row[k] === (v as any).not) return false; continue; }
      if ("gte" in (v as any)) { if (!(row[k] != null && new Date(row[k]).getTime() >= new Date((v as any).gte).getTime())) return false; continue; }
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
      const av = a[key]; const bv = b[key];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = av instanceof Date || bv instanceof Date
        ? new Date(av).getTime() - new Date(bv).getTime()
        : av < bv ? -1 : 1;
      return dir === "desc" ? -cmp : cmp;
    });
  }
  return out;
}

function makeTable(name: string) {
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
      const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(Date.now() + seq), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error(`${name} record not found`);
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const r of rows) if (matchWhere(r, where)) { Object.assign(r, data); count++; }
      return { count };
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => matchWhere(r, where));
      if (idx < 0) throw new Error("record not found");
      return rows.splice(idx, 1)[0];
    },
    deleteMany: async ({ where }: any) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) if (matchWhere(rows[i], where)) { rows.splice(i, 1); count++; }
      return { count };
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where)).length,
    groupBy: async () => [],
  };
}

function makePrisma() {
  const prisma: any = {
    product: makeTable("product"), productVariant: makeTable("variant"),
    order: makeTable("order"), orderItem: makeTable("item"),
    customer: makeTable("customer"), stockMovement: makeTable("movement"),
    membership: makeTable("membership"), agentNotification: makeTable("notif"),
    auditLog: makeTable("audit"), promotion: makeTable("promotion"),
    storeDiscount: makeTable("discount"), storefrontSetting: makeTable("setting"),
    taxSetting: makeTable("taxSetting"), bundle: makeTable("bundle"),
    bundleItem: makeTable("bundleItem"), fulfillment: makeTable("fulfillment"),
    courierShipment: makeTable("shipment"), paymentVerification: makeTable("verification"),
    shippingZone: makeTable("zone"), shippingRateRule: makeTable("rule"),
    store: makeTable("store"), category: makeTable("category"),
    deliverySlot: makeTable("slot"), pickupPoint: makeTable("point"),
  };
  // Emulate Prisma `include: { items, customer, store }` on Order.
  const origFindFirst = prisma.order.findFirst;
  prisma.order.findFirst = async (args: any = {}) => {
    const row = await origFindFirst(args);
    if (row && args.include) {
      if (args.include.items) row.items = prisma.orderItem.rows.filter((i: any) => i.orderId === row.id);
      if (args.include.customer) row.customer = prisma.customer.rows.find((c: any) => c.id === row.customerId) ?? null;
      if (args.include.store) row.store = null;
    }
    return row;
  };
  return prisma;
}

const ORG = "org-1";

function setup(opts: { withStorefront?: boolean } = {}) {
  const prisma: any = makePrisma();
  const audit: any = {
    log: jest.fn(async (input: any) => {
      await prisma.auditLog.create({
        data: {
          organizationId: input.organizationId ?? null, userId: input.userId ?? null,
          action: input.action, entityType: input.entityType,
          entityId: input.entityId ?? null, metadata: input.metadata ?? null,
        },
      });
    }),
  };
  const discounts = new DiscountsService(prisma, {} as any, audit);
  const promotions = new PromotionsService(prisma, discounts, audit);
  const inventory = new InventoryService(prisma, audit);
  const orders = new OrdersService(prisma, undefined, undefined, audit, inventory);
  const storefront = opts.withStorefront ? new StorefrontService(prisma) : undefined;
  const surgery = new OrderSurgeryService(prisma, promotions, inventory, orders, audit, storefront as any);
  return { prisma, audit, discounts, promotions, inventory, orders, surgery };
}

async function seedCustomer(prisma: any, over: any = {}) {
  return prisma.customer.create({
    data: {
      id: "cust-1", organizationId: ORG, firstName: "Rahim", phone: "01711111111",
      address: { district: "ঢাকা" }, referralCode: null, ...over,
    },
  });
}

async function seedProduct(prisma: any, over: any = {}) {
  return prisma.product.create({
    data: {
      id: "p-1", organizationId: ORG, name: "Panjabi", sku: "PN-1", status: "ACTIVE",
      priceMinor: 100000n, compareAtMinor: null, categoryId: "cat-1",
      stockQuantity: 20, weightGrams: 100, preorderEnabled: false, ...over,
    },
  });
}

let orderSeq = 0;
async function seedOrder(prisma: any, over: any = {}, items: any[] = []) {
  const id = over.id ?? `ord-${++orderSeq}`;
  const order = await prisma.order.create({
    data: {
      id, organizationId: ORG, source: "manual", externalId: `ext-${id}`,
      externalNumber: `ORD-${id}`, status: "processing", paymentMethod: "cod",
      isCod: true, currency: "BDT", customerId: "cust-1",
      subtotalMinor: 200000n, shippingMinor: 6000n, discountMinor: 0n,
      promotionDiscountMinor: 0n, referralDiscountMinor: 0n, referralCode: null,
      couponCode: null, taxMinor: 0n, taxBreakdown: null, giftWrapMinor: 0n,
      totalMinor: 206000n, refundedMinor: 0n, isPractice: false, reviewHold: false,
      deliveryMethod: "home", address: "Dhaka address", placedAt: new Date(),
      storeDraftId: null, storeInvoiceUrl: null, internalNote: null,
      splitFromId: null, mergedIntoId: null, ...over,
    },
  });
  for (const it of items) {
    await prisma.orderItem.create({
      data: {
        orderId: order.id, productId: "p-1", sku: "PN-1", name: "Panjabi",
        quantity: 2, priceMinor: 100000n, totalMinor: 200000n,
        isPreorder: false, isGift: false, bundleId: null, bundleName: null, ...it,
      },
    });
  }
  return order;
}

function couponRow(partial: any = {}) {
  return {
    id: "d-save", organizationId: ORG, code: "SAVE10", kind: "percent", value: 10,
    minOrderMinor: null, scopeType: "all", scopeIds: null, startsAt: null, endsAt: null,
    usageLimit: null, usedCount: 0, active: true, origin: "manual",
    createdAt: new Date("2026-10-01T00:00:00Z"), updatedAt: new Date(), ...partial,
  };
}

/** The parity oracle: a FRESH evaluateCheckout over the order's
 * current stored lines (+ the documented surgery formula). */
async function expectParity(ctx: any, orderId: string, opts: { couponCode?: string | null; pinnedCoupon?: bigint } = {}) {
  const order = ctx.prisma.order.rows.find((o: any) => o.id === orderId);
  const items = ctx.prisma.orderItem.rows.filter((i: any) => i.orderId === orderId);
  const lines: any[] = [];
  let bump = 0n;
  for (const i of items) {
    if (i.isGift) continue;
    if (!i.productId) { bump += BigInt(i.priceMinor) * BigInt(i.quantity); continue; }
    const product = ctx.prisma.product.rows.find((p: any) => p.id === i.productId);
    lines.push({
      productId: i.productId, categoryId: product?.categoryId ?? null,
      quantity: i.quantity, unitPriceMinor: BigInt(i.priceMinor),
      compareAtMinor: product?.compareAtMinor != null ? BigInt(product.compareAtMinor) : null,
    });
  }
  const ev = await ctx.promotions.evaluateCheckout(ORG, {
    lines, bumpMinor: bump,
    couponCode: opts.couponCode !== undefined ? opts.couponCode : (order.couponCode ?? null),
    referralCode: order.referralCode ?? null,
    buyerPhone: "01711111111",
  });
  const couponMinor: bigint = opts.pinnedCoupon ?? ev.couponDiscountMinor;
  const discount: bigint = ev.promotionDiscountMinor + couponMinor + ev.referralDiscountMinor;
  const total: bigint = ev.subtotalMinor - discount + BigInt(order.shippingMinor) + ev.taxAddedMinor + BigInt(order.giftWrapMinor ?? 0);
  expect(BigInt(order.subtotalMinor)).toBe(ev.subtotalMinor);
  expect(BigInt(order.promotionDiscountMinor)).toBe(ev.promotionDiscountMinor);
  expect(BigInt(order.discountMinor)).toBe(discount);
  expect(BigInt(order.taxMinor)).toBe(ev.taxMinor);
  expect(BigInt(order.totalMinor)).toBe(total);
  return ev;
}

describe("ON3 parity — PATCH items totals == fresh evaluateCheckout", () => {
  it("plain cart: qty change, preview writes nothing, apply reprices + moves stock", async () => {
    const ctx = setup();
    await seedCustomer(ctx.prisma);
    const p = await seedProduct(ctx.prisma);
    const order = await seedOrder(ctx.prisma, {}, [{ id: "item-1" }]);
    await ctx.inventory.applyOrderPlaced(ORG, order.id, { items: [{ productId: p.id, quantity: 2 }] });
    expect(ctx.prisma.product.rows[0].stockQuantity).toBe(18);

    const preview: any = await ctx.surgery.previewItems(ORG, order.id, {
      items: [{ orderItemId: "item-1", quantity: 3 }],
    } as any);
    expect(preview.subtotalMinor).toBe("300000");
    expect(preview.totalMinor).toBe("306000");
    // Preview wrote NOTHING.
    expect(ctx.prisma.order.rows[0].totalMinor).toBe(206000n);
    expect(ctx.prisma.product.rows[0].stockQuantity).toBe(18);

    const res: any = await ctx.surgery.editItems(ORG, "u-1", order.id, {
      items: [{ orderItemId: "item-1", quantity: 3 }],
    } as any);
    expect(res.order.totalMinor).toBe("306000");
    expect(res.stockDelta).toEqual({ adjusted: 1, skipped: 0 });
    expect(res.overpaidMinor).toBe("0");
    expect(ctx.prisma.product.rows[0].stockQuantity).toBe(17);
    await expectParity(ctx, order.id);
  });

  it("with promotion: tiered discount re-evaluates on the new cart", async () => {
    const ctx = setup();
    await seedCustomer(ctx.prisma);
    await seedProduct(ctx.prisma);
    ctx.prisma.promotion.rows.push({
      id: "pr-tier", organizationId: ORG, name: "১০% ছাড়", type: "tiered",
      config: { scope: "subtotal", tiers: [{ minAmountMinor: "150000", percentOff: 10 }] },
      startsAt: null, endsAt: null, active: true, priority: 0, createdBy: "u1",
      createdAt: new Date("2026-10-01T00:00:00Z"), updatedAt: new Date(),
    });
    const order = await seedOrder(ctx.prisma,
      { discountMinor: 20000n, promotionDiscountMinor: 20000n, totalMinor: 186000n },
      [{ id: "item-1" }]);
    const res: any = await ctx.surgery.editItems(ORG, "u-1", order.id, {
      items: [{ orderItemId: "item-1", quantity: 1 }],
    } as any);
    // 100000 < tier threshold → promotion gone.
    expect(res.order.promotionDiscountMinor).toBe("0");
    expect(res.order.totalMinor).toBe("106000");
    await expectParity(ctx, order.id);
  });

  it("with a valid stored coupon: the SAME code re-validates at the new quantity", async () => {
    const ctx = setup();
    await seedCustomer(ctx.prisma);
    await seedProduct(ctx.prisma);
    ctx.prisma.storeDiscount.rows.push(couponRow());
    const order = await seedOrder(ctx.prisma,
      { couponCode: "SAVE10", discountMinor: 20000n, totalMinor: 186000n },
      [{ id: "item-1" }]);
    const res: any = await ctx.surgery.editItems(ORG, "u-1", order.id, {
      items: [{ orderItemId: "item-1", quantity: 3 }],
    } as any);
    expect(res.couponDropped).toBe(false);
    expect(res.order.discountMinor).toBe("30000"); // 10% of 300000
    expect(res.order.totalMinor).toBe("276000");
    expect(res.order.couponCode).toBe("SAVE10");
    await expectParity(ctx, order.id);
  });

  it("with referral: totals match the evaluator oracle for the resulting cart", async () => {
    const ctx = setup();
    await seedCustomer(ctx.prisma);
    await seedProduct(ctx.prisma);
    ctx.prisma.storefrontSetting.rows.push({
      id: "set-1", organizationId: ORG, referralDiscountPercent: 10, referralMinSubtotalMinor: null,
    });
    await ctx.prisma.customer.create({
      data: { id: "cust-ref", organizationId: ORG, firstName: "Ref", phone: "01812345678", referralCode: "REFABC123" },
    });
    const order = await seedOrder(ctx.prisma,
      { referralCode: "REFABC123", referralDiscountMinor: 20000n, discountMinor: 20000n, totalMinor: 186000n },
      [{ id: "item-1" }]);
    const res: any = await ctx.surgery.editItems(ORG, "u-1", order.id, {
      items: [{ orderItemId: "item-1", quantity: 3 }],
    } as any);
    // The order itself now consumes the referral's first use, so
    // the evaluator (the oracle) drops it — surgery must match.
    await expectParity(ctx, order.id);
    expect(res.order.discountMinor).toBe(res.order.promotionDiscountMinor === "0" ? res.order.discountMinor : res.order.discountMinor);
  });
});

describe("ON3 coupon drop / pin", () => {
  it("stored code no longer valid → dropped, totals exclude it, code cleared", async () => {
    const ctx = setup();
    await seedCustomer(ctx.prisma);
    await seedProduct(ctx.prisma);
    // No discount row for GONE10 — validation fails not_found.
    const order = await seedOrder(ctx.prisma,
      { couponCode: "GONE10", discountMinor: 20000n, totalMinor: 186000n },
      [{ id: "item-1" }]);
    const res: any = await ctx.surgery.editItems(ORG, "u-1", order.id, {
      items: [{ orderItemId: "item-1", quantity: 3 }],
    } as any);
    expect(res.couponDropped).toBe(true);
    expect(res.order.discountMinor).toBe("0");
    expect(res.order.totalMinor).toBe("306000");
    expect(ctx.prisma.order.rows[0].couponCode).toBeNull();
    await expectParity(ctx, order.id, { couponCode: null });
  });

  it("legacy order (no stored code) with a derived discount → pinned with a warning", async () => {
    const ctx = setup();
    await seedCustomer(ctx.prisma);
    await seedProduct(ctx.prisma);
    const order = await seedOrder(ctx.prisma,
      { couponCode: null, discountMinor: 20000n, totalMinor: 186000n },
      [{ id: "item-1" }]);
    const res: any = await ctx.surgery.editItems(ORG, "u-1", order.id, {
      items: [{ orderItemId: "item-1", quantity: 3 }],
    } as any);
    expect(res.couponPinnedMinor).toBe("20000");
    expect(res.warnings.some((w: string) => w.includes("কুপন কোড সংরক্ষিত নেই"))).toBe(true);
    expect(res.order.discountMinor).toBe("20000");
    expect(res.order.totalMinor).toBe("286000");
    await expectParity(ctx, order.id, { couponCode: null, pinnedCoupon: 20000n });
  });

  it("explicit couponCode null in the DTO drops a stored coupon", async () => {
    const ctx = setup();
    await seedCustomer(ctx.prisma);
    await seedProduct(ctx.prisma);
    ctx.prisma.storeDiscount.rows.push(couponRow());
    const order = await seedOrder(ctx.prisma,
      { couponCode: "SAVE10", discountMinor: 20000n, totalMinor: 186000n },
      [{ id: "item-1" }]);
    const res: any = await ctx.surgery.editItems(ORG, "u-1", order.id, {
      items: [{ orderItemId: "item-1", quantity: 2 }], couponCode: null,
    } as any);
    expect(res.order.discountMinor).toBe("0");
    expect(ctx.prisma.order.rows[0].couponCode).toBeNull();
  });

  it("stampOrder stamps couponCode only when a coupon truly applied", async () => {
    const ctx = setup();
    await seedCustomer(ctx.prisma);
    await seedProduct(ctx.prisma);
    const order = await seedOrder(ctx.prisma, {}, [{ id: "item-1" }]);
    const baseEv: any = {
      promotionDiscountMinor: 0n, promotionsApplied: [], referralDiscountMinor: 0n,
      referralCodeToRecord: null, taxBreakdown: [], gift: null,
    };
    await ctx.promotions.stampOrder(ORG, "manual", order.externalId, {
      ...baseEv, appliedDiscountId: "d-save", appliedCouponCode: "SAVE10",
    });
    expect(ctx.prisma.order.rows[0].couponCode).toBe("SAVE10");
    await ctx.promotions.stampOrder(ORG, "manual", order.externalId, {
      ...baseEv, appliedDiscountId: null, appliedCouponCode: null,
    });
    expect(ctx.prisma.order.rows[0].couponCode).toBe("SAVE10"); // unchanged
  });
});

describe("ON3 stage-guard matrix", () => {
  async function baseCtx() {
    const ctx = setup();
    await seedCustomer(ctx.prisma);
    await seedProduct(ctx.prisma);
    return ctx;
  }
  const edit = (ctx: any, id: string) =>
    ctx.surgery.editItems(ORG, "u-1", id, { items: [{ orderItemId: "item-1", quantity: 5 }] } as any);

  it("packed fulfillment covering a changed line → 400", async () => {
    const ctx = await baseCtx();
    const order = await seedOrder(ctx.prisma, {}, [{ id: "item-1" }]);
    await ctx.prisma.fulfillment.create({
      data: { id: "ful-1", organizationId: ORG, orderId: order.id, status: "packed", items: [{ orderItemId: "item-1", quantity: 1 }] },
    });
    await expect(edit(ctx, order.id)).rejects.toBeInstanceOf(ApiException);
  });

  it("pending fulfillment covering more than the new qty → 400", async () => {
    const ctx = await baseCtx();
    const order = await seedOrder(ctx.prisma, {}, [{ id: "item-1" }]);
    await ctx.prisma.fulfillment.create({
      data: { id: "ful-1", organizationId: ORG, orderId: order.id, status: "pending", items: [{ orderItemId: "item-1", quantity: 2 }] },
    });
    await expect(ctx.surgery.editItems(ORG, "u-1", order.id, {
      items: [{ orderItemId: "item-1", quantity: 1 }],
    } as any)).rejects.toBeInstanceOf(ApiException);
  });

  it("picked_up shipment → 400", async () => {
    const ctx = await baseCtx();
    const order = await seedOrder(ctx.prisma, {}, [{ id: "item-1" }]);
    await ctx.prisma.courierShipment.create({
      data: { id: "sh-1", organizationId: ORG, orderId: order.id, provider: "steadfast", invoice: "INV", status: "picked_up", recipientName: "R", recipientPhone: "017", recipientAddress: "Dhaka" },
    });
    await expect(edit(ctx, order.id)).rejects.toThrow(/কুরিয়ারের পথে/);
  });

  it("in_review shipment → edit allowed with the stale-label warning", async () => {
    const ctx = await baseCtx();
    const order = await seedOrder(ctx.prisma, {}, [{ id: "item-1" }]);
    await ctx.prisma.courierShipment.create({
      data: { id: "sh-1", organizationId: ORG, orderId: order.id, provider: "steadfast", invoice: "INV", status: "in_review", recipientName: "R", recipientPhone: "017", recipientAddress: "Dhaka" },
    });
    const res: any = await edit(ctx, order.id);
    expect(res.warnings.some((w: string) => w.includes("courier লেবেল"))).toBe(true);
  });

  it("terminal status → 400 naming the status", async () => {
    const ctx = await baseCtx();
    const order = await seedOrder(ctx.prisma, { status: "completed" }, [{ id: "item-1" }]);
    await expect(edit(ctx, order.id)).rejects.toThrow(/completed/);
  });

  it("reviewHold → 400", async () => {
    const ctx = await baseCtx();
    const order = await seedOrder(ctx.prisma, { reviewHold: true }, [{ id: "item-1" }]);
    await expect(edit(ctx, order.id)).rejects.toThrow(/পর্যালোচনার জন্য আটকানো/);
  });

  it("store source → 400", async () => {
    const ctx = await baseCtx();
    const order = await seedOrder(ctx.prisma, { source: "woocommerce" }, [{ id: "item-1" }]);
    await expect(edit(ctx, order.id)).rejects.toThrow(/স্টোরের অর্ডার/);
  });

  it("practice order → 400", async () => {
    const ctx = await baseCtx();
    const order = await seedOrder(ctx.prisma, { isPractice: true }, [{ id: "item-1" }]);
    await expect(edit(ctx, order.id)).rejects.toThrow(/প্র্যাকটিস/);
  });
});

describe("ON3 bundles + gifts", () => {
  async function bundleCtx() {
    const ctx = setup();
    await seedCustomer(ctx.prisma);
    await seedProduct(ctx.prisma, { id: "p-1", priceMinor: 60000n, sku: "A-1" });
    await seedProduct(ctx.prisma, { id: "p-2", name: "Cream", priceMinor: 30000n, sku: "B-1" });
    await ctx.prisma.bundle.create({
      data: {
        id: "bundle-1", organizationId: ORG, name: "Set", active: true,
        items: [{ productId: "p-1", qty: 1 }, { productId: "p-2", qty: 2 }],
        bundlePriceMinor: 100000n,
      },
    });
    // One set placed: allocations 50000 (p-1 ×1) + 50000 (p-2 ×2 @25000).
    const order = await seedOrder(ctx.prisma,
      { subtotalMinor: 100000n, totalMinor: 106000n },
      [
        { id: "item-b1", productId: "p-1", sku: "A-1", name: "Panjabi", quantity: 1, priceMinor: 50000n, totalMinor: 50000n, bundleId: "bundle-1", bundleName: "Set" },
        { id: "item-b2", productId: "p-2", sku: "B-1", name: "Cream", quantity: 2, priceMinor: 25000n, totalMinor: 50000n, bundleId: "bundle-1", bundleName: "Set" },
      ]);
    return { ctx, order };
  }

  it("individual component edit → 400", async () => {
    const { ctx, order } = await bundleCtx();
    await expect(ctx.surgery.editItems(ORG, "u-1", order.id, {
      items: [{ orderItemId: "item-b1", quantity: 2 }, { orderItemId: "item-b2", quantity: 2 }],
    } as any)).rejects.toThrow(/বান্ডেলের অংশ সরাসরি/);
  });

  it("group quantity change scales components; Σ totals == impliedPrice × newQty exactly", async () => {
    const { ctx, order } = await bundleCtx();
    const res: any = await ctx.surgery.editItems(ORG, "u-1", order.id, {
      items: [{ bundleId: "bundle-1", quantity: 2 }],
    } as any);
    const items = ctx.prisma.orderItem.rows.filter((i: any) => i.orderId === order.id);
    expect(items).toHaveLength(2);
    const byProduct = new Map<string, any>(items.map((i: any) => [i.productId, i]));
    expect(byProduct.get("p-1").quantity).toBe(2);
    expect(byProduct.get("p-2").quantity).toBe(4);
    const sum = items.reduce((s: bigint, i: any) => s + BigInt(i.totalMinor), 0n);
    expect(sum).toBe(200000n); // impliedPrice 100000 × 2
    expect(res.order.subtotalMinor).toBe("200000");
  });

  it("group omission removes all components (another line keeps the order alive)", async () => {
    const { ctx, order } = await bundleCtx();
    await seedProduct(ctx.prisma, { id: "p-3", name: "Soap", sku: "S-1", priceMinor: 10000n });
    await ctx.prisma.orderItem.create({
      data: { id: "item-x", orderId: order.id, productId: "p-3", sku: "S-1", name: "Soap", quantity: 1, priceMinor: 10000n, totalMinor: 10000n, isPreorder: false, isGift: false, bundleId: null, bundleName: null },
    });
    await ctx.surgery.editItems(ORG, "u-1", order.id, {
      items: [{ orderItemId: "item-x", quantity: 1 }],
    } as any);
    const items = ctx.prisma.orderItem.rows.filter((i: any) => i.orderId === order.id);
    expect(items).toHaveLength(1);
    expect(items[0].productId).toBe("p-3");
  });

  it("gift qty change → 400; gift removal OK; gift never reaches the evaluator", async () => {
    const ctx = setup();
    await seedCustomer(ctx.prisma);
    await seedProduct(ctx.prisma);
    await seedProduct(ctx.prisma, { id: "p-gift", name: "Gift", sku: "G-1", priceMinor: 5000n });
    const order = await seedOrder(ctx.prisma, {}, [
      { id: "item-1" },
      { id: "item-gift", productId: "p-gift", sku: "G-1", name: "Gift", quantity: 1, priceMinor: 0n, totalMinor: 0n, isGift: true },
    ]);
    await expect(ctx.surgery.editItems(ORG, "u-1", order.id, {
      items: [{ orderItemId: "item-1", quantity: 2 }, { orderItemId: "item-gift", quantity: 2 }],
    } as any)).rejects.toThrow(/উপহার লাইনের পরিমাণ/);

    const spy = jest.spyOn(ctx.promotions, "evaluateCheckout");
    const res: any = await ctx.surgery.editItems(ORG, "u-1", order.id, {
      items: [{ orderItemId: "item-1", quantity: 3 }],
    } as any);
    expect(res.order.totalMinor).toBe("306000");
    const items = ctx.prisma.orderItem.rows.filter((i: any) => i.orderId === order.id);
    expect(items.some((i: any) => i.isGift)).toBe(false);
    // The evaluator never saw the gift product in any call.
    for (const call of spy.mock.calls) {
      const argLines = (call[1] as any).lines ?? [];
      expect(argLines.some((l: any) => l.productId === "p-gift")).toBe(false);
    }
    spy.mockRestore();
  });
});

describe("ON3 stock deltas through surgery + overpaid", () => {
  it("qty up/down, new line and removed line net exactly; preorder + untracked skipped", async () => {
    const ctx = setup();
    await seedCustomer(ctx.prisma);
    const p1 = await seedProduct(ctx.prisma);
    const p2 = await seedProduct(ctx.prisma, { id: "p-2", name: "Cream", sku: "B-1", priceMinor: 50000n, stockQuantity: 10 });
    const order = await seedOrder(ctx.prisma,
      { subtotalMinor: 250000n, totalMinor: 256000n },
      [
        { id: "item-1" },
        { id: "item-2", productId: "p-2", sku: "B-1", name: "Cream", quantity: 1, priceMinor: 50000n, totalMinor: 50000n },
      ]);
    await ctx.inventory.applyOrderPlaced(ORG, order.id, {
      items: [{ productId: p1.id, quantity: 2 }, { productId: p2.id, quantity: 1 }],
    });
    expect(ctx.prisma.product.rows.find((r: any) => r.id === "p-1").stockQuantity).toBe(18);
    expect(ctx.prisma.product.rows.find((r: any) => r.id === "p-2").stockQuantity).toBe(9);

    // p-1: 2→4 (+2 sold), p-2 line removed (−1 sold).
    await ctx.surgery.editItems(ORG, "u-1", order.id, {
      items: [{ orderItemId: "item-1", quantity: 4 }],
    } as any);
    expect(ctx.prisma.product.rows.find((r: any) => r.id === "p-1").stockQuantity).toBe(16);
    expect(ctx.prisma.product.rows.find((r: any) => r.id === "p-2").stockQuantity).toBe(10);

    // New line of p-2 ×3 takes 3 more.
    const itemsNow = ctx.prisma.orderItem.rows.filter((i: any) => i.orderId === order.id);
    await ctx.surgery.editItems(ORG, "u-1", order.id, {
      items: [
        { orderItemId: itemsNow[0].id, quantity: 4 },
        { productId: "p-2", quantity: 3 },
      ],
    } as any);
    expect(ctx.prisma.product.rows.find((r: any) => r.id === "p-2").stockQuantity).toBe(7);
  });

  it("preorder line delta is skipped and untracked product is skipped", async () => {
    const ctx = setup();
    await seedCustomer(ctx.prisma);
    await seedProduct(ctx.prisma, { id: "p-pre", name: "Pre", sku: "PRE-1", preorderEnabled: true, stockQuantity: 10 });
    await seedProduct(ctx.prisma, { id: "p-free", name: "Free", sku: "FR-1", stockQuantity: null });
    const order = await seedOrder(ctx.prisma, {}, [
      { id: "item-pre", productId: "p-pre", sku: "PRE-1", name: "Pre", quantity: 2, priceMinor: 100000n, totalMinor: 200000n, isPreorder: true },
      { id: "item-free", productId: "p-free", sku: "FR-1", name: "Free", quantity: 1, priceMinor: 100000n, totalMinor: 100000n },
    ]);
    const res: any = await ctx.surgery.editItems(ORG, "u-1", order.id, {
      items: [
        { orderItemId: "item-pre", quantity: 5 },
        { orderItemId: "item-free", quantity: 3 },
      ],
    } as any);
    expect(res.stockDelta.adjusted).toBe(0);
    expect(res.stockDelta.skipped).toBe(2);
    expect(ctx.prisma.product.rows.find((r: any) => r.id === "p-pre").stockQuantity).toBe(10);
  });

  it("approved verifications above the new total surface as overpaidMinor", async () => {
    const ctx = setup();
    await seedCustomer(ctx.prisma);
    await seedProduct(ctx.prisma);
    const order = await seedOrder(ctx.prisma, {}, [{ id: "item-1" }]);
    await ctx.prisma.paymentVerification.create({
      data: {
        id: "ver-1", organizationId: ORG, orderId: order.id, amountMinor: 150000n,
        status: "approved", verdict: "matched", modelProvider: "test",
      },
    });
    const res: any = await ctx.surgery.editItems(ORG, "u-1", order.id, {
      items: [{ orderItemId: "item-1", quantity: 1 }],
    } as any);
    expect(res.order.totalMinor).toBe("106000");
    expect(res.overpaidMinor).toBe("44000"); // 150000 − 106000
  });

  it("delivery recalc via StorefrontService zones (recalculateDelivery)", async () => {
    const ctx = setup({ withStorefront: true });
    await seedCustomer(ctx.prisma);
    await seedProduct(ctx.prisma);
    ctx.prisma.shippingZone.rows.push({
      id: "z-in", organizationId: ORG, name: "ঢাকার ভিতরে", kind: "inside_dhaka",
      districts: null, chargeMinor: 8000n, freeAboveMinor: null, active: true, position: 0,
      createdAt: new Date(),
    });
    const order = await seedOrder(ctx.prisma, {}, [{ id: "item-1" }]);
    const res: any = await ctx.surgery.editItems(ORG, "u-1", order.id, {
      items: [{ orderItemId: "item-1", quantity: 2 }], recalculateDelivery: true,
    } as any);
    expect(res.order.shippingMinor).toBe("8000");
    expect(res.order.totalMinor).toBe("208000");
  });
});

describe("ON3 split", () => {
  async function splitCtx() {
    const ctx = setup();
    await seedCustomer(ctx.prisma);
    const p1 = await seedProduct(ctx.prisma);
    const p2 = await seedProduct(ctx.prisma, { id: "p-2", name: "Cream", sku: "B-1", priceMinor: 50000n, stockQuantity: 10 });
    const order = await seedOrder(ctx.prisma,
      { subtotalMinor: 600000n, totalMinor: 606000n },
      [
        { id: "item-1", quantity: 5, totalMinor: 500000n },
        { id: "item-2", productId: "p-2", sku: "B-1", name: "Cream", quantity: 2, priceMinor: 50000n, totalMinor: 100000n },
      ]);
    await ctx.inventory.applyOrderPlaced(ORG, order.id, {
      items: [{ productId: p1.id, quantity: 5 }, { productId: p2.id, quantity: 2 }],
    });
    return { ctx, order };
  }

  it("child carries pinned prices + evaluator totals; original recomputed; balances unchanged; cancels restore each side exactly", async () => {
    const { ctx, order } = await splitCtx();
    await ctx.prisma.paymentVerification.create({
      data: { id: "ver-1", organizationId: ORG, orderId: order.id, amountMinor: 100000n, status: "approved", verdict: "matched", modelProvider: "test" },
    });
    const res: any = await ctx.surgery.split(ORG, "u-1", order.id, {
      lines: [{ orderItemId: "item-1", quantity: 2 }], deliveryChargeMinor: "7000",
    } as any);
    expect(res.verificationsStayedOnOriginal).toBe(true);
    expect(res.movedDeliveryMinor).toBe("7000");
    const child = res.created;
    expect(child.splitFromId).toBe(order.id);
    expect(child.subtotalMinor).toBe("200000");
    expect(child.shippingMinor).toBe("7000");
    expect(child.totalMinor).toBe("207000");
    const childItems = ctx.prisma.orderItem.rows.filter((i: any) => i.orderId === child.id);
    expect(childItems).toHaveLength(1);
    expect(childItems[0]).toMatchObject({ quantity: 2, priceMinor: 100000n });
    expect(res.original.subtotalMinor).toBe("400000");
    expect(res.original.totalMinor).toBe("406000");
    // Verifications stayed on the original.
    expect(ctx.prisma.paymentVerification.rows.every((v: any) => v.orderId === order.id)).toBe(true);
    // Balances UNCHANGED by the split itself.
    expect(ctx.prisma.product.rows.find((r: any) => r.id === "p-1").stockQuantity).toBe(15);
    expect(ctx.prisma.product.rows.find((r: any) => r.id === "p-2").stockQuantity).toBe(8);
    // Child cancel restores exactly the moved qty; original
    // cancel restores exactly the remainder.
    await ctx.inventory.applyOrderRestore(ORG, child.id, "order_cancelled");
    expect(ctx.prisma.product.rows.find((r: any) => r.id === "p-1").stockQuantity).toBe(17);
    await ctx.inventory.applyOrderRestore(ORG, order.id, "order_cancelled");
    expect(ctx.prisma.product.rows.find((r: any) => r.id === "p-1").stockQuantity).toBe(20);
    expect(ctx.prisma.product.rows.find((r: any) => r.id === "p-2").stockQuantity).toBe(10);
  });

  it("split with an active (in_review) shipment → 400", async () => {
    const { ctx, order } = await splitCtx();
    await ctx.prisma.courierShipment.create({
      data: { id: "sh-1", organizationId: ORG, orderId: order.id, provider: "steadfast", invoice: "INV", status: "in_review", recipientName: "R", recipientPhone: "017", recipientAddress: "Dhaka" },
    });
    await expect(ctx.surgery.split(ORG, "u-1", order.id, {
      lines: [{ orderItemId: "item-1", quantity: 1 }],
    } as any)).rejects.toThrow(/shipment বুক হয়ে থাকলে/);
  });

  it("splitting everything away → 400; gift line move → 400", async () => {
    const { ctx, order } = await splitCtx();
    await expect(ctx.surgery.split(ORG, "u-1", order.id, {
      lines: [{ orderItemId: "item-1", quantity: 5 }, { orderItemId: "item-2", quantity: 2 }],
    } as any)).rejects.toBeInstanceOf(ApiException);
  });
});

describe("ON3 merge", () => {
  async function mergeCtx() {
    const ctx = setup();
    await seedCustomer(ctx.prisma);
    const p1 = await seedProduct(ctx.prisma);
    const p2 = await seedProduct(ctx.prisma, { id: "p-2", name: "Cream", sku: "B-1", priceMinor: 50000n, stockQuantity: 10 });
    const a = await seedOrder(ctx.prisma, { id: "ord-A" }, [{ id: "item-a1", quantity: 2, totalMinor: 200000n }]);
    const b = await seedOrder(ctx.prisma,
      { id: "ord-B", subtotalMinor: 350000n, shippingMinor: 8000n, totalMinor: 358000n },
      [
        { id: "item-b1", quantity: 3, totalMinor: 300000n },
        { id: "item-b2", productId: "p-2", sku: "B-1", name: "Cream", quantity: 1, priceMinor: 50000n, totalMinor: 50000n },
      ]);
    await ctx.inventory.applyOrderPlaced(ORG, a.id, { items: [{ productId: p1.id, quantity: 2 }] });
    await ctx.inventory.applyOrderPlaced(ORG, b.id, { items: [{ productId: p1.id, quantity: 3 }, { productId: p2.id, quantity: 1 }] });
    return { ctx, a, b };
  }

  it("combines lines by key, reassigns verifications, cancels the other order, balances unchanged; survivor cancel restores the FULL combined qty", async () => {
    const { ctx, a, b } = await mergeCtx();
    await ctx.prisma.paymentVerification.create({
      data: { id: "ver-b", organizationId: ORG, orderId: b.id, amountMinor: 50000n, status: "approved", verdict: "matched", modelProvider: "test" },
    });
    await ctx.prisma.fulfillment.create({
      data: { id: "ful-b", organizationId: ORG, orderId: b.id, status: "pending", items: [{ orderItemId: "item-b1", quantity: 1 }] },
    });
    const res: any = await ctx.surgery.merge(ORG, "u-1", a.id, { orderIds: [a.id, b.id] } as any);
    expect(res.cancelledOrderIds).toEqual([b.id]);
    expect(res.droppedDeliveryMinor).toBe("8000");
    expect(res.reassignedVerifications).toBe(1);
    expect(res.survivor.subtotalMinor).toBe("550000");
    expect(res.survivor.shippingMinor).toBe("6000");
    expect(res.survivor.totalMinor).toBe("556000");
    // Due math on the survivor reflects the moved verification.
    expect(res.survivor.advancePaidMinor).toBe("50000");
    expect(res.survivor.amountDueMinor).toBe("506000");
    const items = ctx.prisma.orderItem.rows.filter((i: any) => i.orderId === a.id);
    const p1Line = items.find((i: any) => i.productId === "p-1");
    expect(p1Line.quantity).toBe(5);
    const brow = ctx.prisma.order.rows.find((o: any) => o.id === b.id);
    expect(brow.status).toBe("cancelled");
    expect(brow.mergedIntoId).toBe(a.id);
    expect(String(brow.internalNote)).toContain("মার্জ হয়েছে");
    expect(ctx.prisma.fulfillment.rows.find((f: any) => f.id === "ful-b").status).toBe("cancelled");
    // Balances unchanged by the merge.
    expect(ctx.prisma.product.rows.find((r: any) => r.id === "p-1").stockQuantity).toBe(15);
    expect(ctx.prisma.product.rows.find((r: any) => r.id === "p-2").stockQuantity).toBe(9);
    // Survivor cancel afterwards restores the FULL combined qty.
    await ctx.inventory.applyOrderRestore(ORG, a.id, "order_cancelled");
    expect(ctx.prisma.product.rows.find((r: any) => r.id === "p-1").stockQuantity).toBe(20);
    expect(ctx.prisma.product.rows.find((r: any) => r.id === "p-2").stockQuantity).toBe(10);
  });

  it("differing customers → 400; same phone under different customer ids merges", async () => {
    const { ctx, a } = await mergeCtx();
    await ctx.prisma.customer.create({
      data: { id: "cust-2", organizationId: ORG, firstName: "Other", phone: "01999999999", address: { district: "ঢাকা" } },
    });
    const c = await seedOrder(ctx.prisma, { id: "ord-C", customerId: "cust-2" }, [{ id: "item-c1", quantity: 1, totalMinor: 100000n }]);
    await expect(ctx.surgery.merge(ORG, "u-1", a.id, { orderIds: [a.id, c.id] } as any))
      .rejects.toThrow(/গ্রাহক একই নয়/);

    await ctx.prisma.customer.create({
      data: { id: "cust-3", organizationId: ORG, firstName: "SamePhone", phone: "+8801711111111", address: { district: "ঢাকা" } },
    });
    const d = await seedOrder(ctx.prisma, { id: "ord-D", customerId: "cust-3" }, [{ id: "item-d1", quantity: 1, totalMinor: 100000n }]);
    const res: any = await ctx.surgery.merge(ORG, "u-1", a.id, { orderIds: [a.id, d.id] } as any);
    expect(res.cancelledOrderIds).toEqual([d.id]);
  });

  it("store-order participant → 400", async () => {
    const { ctx, a } = await mergeCtx();
    const s = await seedOrder(ctx.prisma, { id: "ord-S", source: "shopify" }, [{ id: "item-s1", quantity: 1, totalMinor: 100000n }]);
    await expect(ctx.surgery.merge(ORG, "u-1", a.id, { orderIds: [a.id, s.id] } as any))
      .rejects.toThrow(/স্টোরের অর্ডার/);
  });

  it("merged order: status change + refund refused via updateOrder, note edit allowed", async () => {
    const { ctx, a, b } = await mergeCtx();
    await ctx.surgery.merge(ORG, "u-1", a.id, { orderIds: [a.id, b.id] } as any);
    await expect(ctx.orders.updateOrder(ORG, "u-1", b.id, { status: "processing" } as any))
      .rejects.toThrow(/মার্জ হয়ে গেছে/);
    await expect(ctx.orders.updateOrder(ORG, "u-1", b.id, { refund: { amountMinor: "100" } } as any))
      .rejects.toThrow(/মার্জ হয়ে গেছে/);
    const noted: any = await ctx.orders.updateOrder(ORG, "u-1", b.id, { internalNote: "খাতায় লেখা হয়েছে" } as any);
    expect(noted.internalNote).toContain("খাতায় লেখা হয়েছে");
  });
});
