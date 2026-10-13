import "reflect-metadata";
import { BadRequestException, Global, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PosService } from "./pos.service";
import { PosModule } from "./pos.module";
import { PrismaService } from "../prisma/prisma.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { OrdersService } from "../orders/orders.service";
import { PromotionsService } from "../commerce/promotions.service";
import { dhakaDayStartUtc } from "../crm/lead-followups";

/**
 * EC34 — POS quick-sale: prices ALWAYS from the DB (a bogus
 * client price is ignored by construction), the ONE
 * evaluateCheckout pricing path (coupon discount + redeem,
 * invalid coupon refuses before placement), the storefront
 * tracked-stock rule with the preorder exemption, placement via
 * upsertOrder with source "pos", completion via updateOrder,
 * paid = approved PaymentVerification source "pos" (due 0),
 * due = no verification (due = total), and the Dhaka-day
 * "today" strip. Fake prisma + fake collaborators, positional
 * construction like the neighbouring specs.
 */

type Row = Record<string, any>;

function matches(row: Row, where: any, ctx: { products: Row[] }): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (k === "OR") return (v as any[]).some((sub) => matches(row, sub, ctx));
    if (k === "AND") return (v as any[]).every((sub) => matches(row, sub, ctx));
    if (k === "product" && v && typeof v === "object") {
      const product = ctx.products.find((p) => p.id === row.productId);
      return product ? matches(product, v, ctx) : false;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("contains" in v) {
        const hay = String(row[k] ?? "");
        return (v as any).mode === "insensitive"
          ? hay.toLowerCase().includes(String((v as any).contains).toLowerCase())
          : hay.includes(String((v as any).contains));
      }
      if ("gte" in v || "lt" in v) {
        const t = new Date(row[k]).getTime();
        if ("gte" in v && !(t >= new Date((v as any).gte).getTime())) return false;
        if ("lt" in v && !(t < new Date((v as any).lt).getTime())) return false;
        return true;
      }
      return true;
    }
    return row[k] === v;
  });
}

function setup(opts: { evaluate?: (orgId: string, input: any) => Promise<any> } = {}) {
  const products: Row[] = [
    { id: "p1", organizationId: "org-1", name: "চাল ৫ কেজি", sku: "RICE-5", barcode: "8801001", status: "ACTIVE", priceMinor: 50000n, compareAtMinor: null, stockQuantity: 10, categoryId: "cat-1", imageUrl: null, preorderEnabled: false },
    { id: "p2", organizationId: "org-1", name: "টি-শার্ট", sku: "TSHIRT", barcode: null, status: "ACTIVE", priceMinor: 80000n, compareAtMinor: null, stockQuantity: null, categoryId: null, imageUrl: null, preorderEnabled: false },
    { id: "p3", organizationId: "org-1", name: "প্রি-অর্ডার গ্যাজেট", sku: "GADGET", barcode: null, status: "ACTIVE", priceMinor: 200000n, compareAtMinor: null, stockQuantity: 0, categoryId: null, imageUrl: null, preorderEnabled: true },
    { id: "p9", organizationId: "org-2", name: "অন্য দোকানের পণ্য", sku: "FOREIGN", barcode: null, status: "ACTIVE", priceMinor: 1000n, compareAtMinor: null, stockQuantity: 5, categoryId: null, imageUrl: null, preorderEnabled: false },
  ];
  const variants: Row[] = [
    { id: "v1", productId: "p2", name: "লাল / L", sku: "TSHIRT-L-RED", priceMinor: 90000n, stockQuantity: 4 },
    { id: "v2", productId: "p2", name: "নীল / M", sku: "TSHIRT-M-BLU", priceMinor: null, stockQuantity: null },
  ];
  const orders: Row[] = [];
  const pvRows: Row[] = [];
  let orderSeq = 0, pvSeq = 0;
  const ctx = { products };

  const prisma: any = {
    product: {
      findFirst: jest.fn(async ({ where }: any) => products.find((r) => matches(r, where, ctx)) ?? null),
      findMany: jest.fn(async ({ where, take }: any) => {
        const rows = products.filter((r) => matches(r, where, ctx));
        return rows.slice(0, take ?? rows.length).map((p) => ({ ...p, variants: variants.filter((v) => v.productId === p.id) }));
      }),
    },
    productVariant: {
      findFirst: jest.fn(async ({ where }: any) => {
        const row = variants.find((r) => matches(r, where, ctx)) ?? null;
        if (row && where?.sku && where?.product) {
          const product = products.find((p) => p.id === row.productId) ?? null;
          return { ...row, product };
        }
        return row;
      }),
      findMany: jest.fn(async ({ where }: any) => variants.filter((r) => matches(r, where, ctx))),
    },
    order: {
      findFirst: jest.fn(async ({ where }: any) => orders.find((r) => matches(r, where, ctx)) ?? null),
      findMany: jest.fn(async ({ where }: any) => orders.filter((r) => matches(r, where, ctx))),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `ord-${++orderSeq}`, createdAt: new Date(), items: [], ...data };
        orders.push(row);
        return row;
      }),
    },
    paymentVerification: {
      findFirst: jest.fn(async ({ where }: any) => pvRows.find((r) => matches(r, where, ctx)) ?? null),
      findMany: jest.fn(async ({ where }: any = {}) => pvRows.filter((r) => matches(r, where, ctx))),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `pv-${++pvSeq}`, createdAt: new Date(), ...data };
        pvRows.push(row);
        return row;
      }),
    },
    organization: {
      findFirst: jest.fn(async () => ({ id: "org-1", name: "টেস্ট দোকান", brandName: null })),
    },
  };

  const integrations: any = {
    upsertOrder: jest.fn(async (orgId: string, _storeId: any, payload: any, source: string) => {
      const row = {
        id: `ord-${++orderSeq}`, organizationId: orgId, source,
        externalId: payload.externalId, externalNumber: payload.externalNumber,
        status: payload.status, totalMinor: payload.totalMinor,
        createdAt: new Date(),
        items: (payload.items ?? []).map((i: any, idx: number) => ({ id: `oi-${idx}`, orderId: `ord-${orderSeq}`, ...i })),
      };
      orders.push(row);
      return "created";
    }),
  };

  const ordersService: any = {
    updateOrder: jest.fn(async (_orgId: string, _actor: string, orderId: string, dto: any) => {
      const row = orders.find((o) => o.id === orderId);
      if (row && dto.status) row.status = dto.status;
      return { id: orderId, status: row?.status };
    }),
    getOne: jest.fn(async (_orgId: string, orderId: string) => {
      const row = orders.find((o) => o.id === orderId);
      const paid = pvRows
        .filter((r) => r.orderId === orderId && r.status === "approved")
        .reduce((s, r) => s + BigInt(r.amountMinor ?? 0), 0n);
      const total = BigInt(row?.totalMinor ?? 0);
      const capped = paid > total ? total : paid;
      return {
        id: orderId, externalNumber: row?.externalNumber ?? null, status: row?.status,
        totalMinor: total.toString(),
        advancePaidMinor: capped.toString(), amountDueMinor: (total - capped).toString(),
        items: row?.items ?? [],
      };
    }),
  };

  const defaultEvaluate = async (_orgId: string, input: any) => {
    const subtotal = input.lines.reduce((s: bigint, l: any) => s + l.unitPriceMinor * BigInt(l.quantity), 0n);
    return {
      subtotalMinor: subtotal, promotionDiscountMinor: 0n, promotionsApplied: [],
      couponDiscountMinor: 0n, couponFreeShipping: false, appliedDiscountId: null,
      appliedCouponCode: null, referral: null, referralCodeToRecord: null,
      referralDiscountMinor: 0n, totalDiscountMinor: 0n,
      taxMinor: 0n, taxAddedMinor: 0n, taxBreakdown: [], gift: null,
    };
  };
  const promotions: any = {
    evaluateCheckout: jest.fn(opts.evaluate ?? defaultEvaluate),
    stampOrder: jest.fn(async () => undefined),
  };
  const discounts: any = { redeem: jest.fn(async () => ({ id: "d1" })) };
  const audit: any = { log: jest.fn(async () => undefined) };

  const service = new PosService(prisma, integrations, ordersService, promotions, discounts, audit);
  return { service, prisma, integrations, ordersService, promotions, discounts, audit, products, variants, orders, pvRows };
}

const PAID = { mode: "paid", method: "cash" } as const;
const DUE = { mode: "due" } as const;

describe("EC34 POS — sale", () => {
  it("paid sale: DB prices (bogus client price ignored), upsert source pos, approved verification source pos, due 0", async () => {
    const s = setup();
    const dto: any = {
      // A hostile/buggy client price field — the DTO has no price
      // fields and the service must never read this.
      items: [{ productId: "p1", quantity: 2, unitPriceMinor: 1 }],
      payment: { ...PAID },
    };
    const res: any = await s.service.createSale("org-1", "staff-1", dto);
    expect(s.integrations.upsertOrder).toHaveBeenCalledTimes(1);
    const [orgId, storeId, payload, source] = s.integrations.upsertOrder.mock.calls[0];
    expect(orgId).toBe("org-1");
    expect(storeId).toBeNull();
    expect(source).toBe("pos");
    expect(payload.items[0].priceMinor).toBe(50000n);
    expect(payload.subtotalMinor).toBe(100000n);
    expect(payload.totalMinor).toBe(100000n);
    expect(payload.shippingMinor).toBe(0n);
    expect(payload.status).toBe("processing");
    // Placement hook itself is IntegrationsService's tested
    // behaviour — here we assert the payload it received is the
    // one that makes stock decrement (productId link + qty).
    expect(payload.items[0].productId).toBe("p1");
    expect(payload.items[0].quantity).toBe(2);
    // Completed through OrdersService, then paid in full.
    expect(s.ordersService.updateOrder).toHaveBeenCalledWith("org-1", "staff-1", expect.any(String), { status: "completed" });
    expect(s.pvRows).toHaveLength(1);
    expect(s.pvRows[0]).toMatchObject({
      source: "pos", status: "approved", verdict: "matched",
      provider: "cash", modelProvider: "manual_staff",
      reviewedById: "staff-1", createdById: "staff-1", conversationId: null,
    });
    expect(s.pvRows[0].amountMinor).toBe(100000n);
    expect(s.pvRows[0].expectedAmountMinor).toBe(100000n);
    expect(res.receipt.totalMinor).toBe("100000");
    expect(res.receipt.paidMinor).toBe("100000");
    expect(res.receipt.dueMinor).toBe("0");
    expect(res.receipt.paymentMode).toBe("paid");
    expect(res.receipt.shopName).toBe("টেস্ট দোকান");
    expect(s.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: "pos.sale_created" }));
  });

  it("due sale: no verification, due = total, order placed as COD", async () => {
    const s = setup();
    const res: any = await s.service.createSale("org-1", "staff-1", {
      items: [{ productId: "p1", quantity: 1 }],
      customerPhone: "01711111111", customerName: "রহিম",
      payment: { ...DUE },
    });
    expect(s.pvRows).toHaveLength(0);
    const payload = s.integrations.upsertOrder.mock.calls[0][2];
    expect(payload.isCod).toBe(true);
    expect(payload.paymentMethod).toBe("cod");
    expect(payload.customer).toMatchObject({ externalId: "01711111111", phone: "01711111111", firstName: "রহিম" });
    expect(res.receipt.dueMinor).toBe("50000");
    expect(res.receipt.paidMinor).toBe("0");
    expect(res.receipt.paymentMode).toBe("due");
  });

  it("walk-in sale (no phone): shared pos-walkin customer block", async () => {
    const s = setup();
    await s.service.createSale("org-1", "staff-1", {
      items: [{ productId: "p1", quantity: 1 }], payment: { ...PAID },
    });
    const payload = s.integrations.upsertOrder.mock.calls[0][2];
    expect(payload.customer).toEqual({ externalId: "pos-walkin", firstName: "কাউন্টার ক্রেতা" });
  });

  it("coupon: evaluator discount flows into totals and the coupon is redeemed after placement", async () => {
    const s = setup({
      evaluate: async (_orgId, input) => {
        const subtotal = input.lines.reduce((sum: bigint, l: any) => sum + l.unitPriceMinor * BigInt(l.quantity), 0n);
        return {
          subtotalMinor: subtotal, promotionDiscountMinor: 0n, promotionsApplied: [],
          couponDiscountMinor: 10000n, couponFreeShipping: false, appliedDiscountId: "d1",
          appliedCouponCode: "EID10", referral: null, referralCodeToRecord: null,
          referralDiscountMinor: 0n, totalDiscountMinor: 10000n,
          taxMinor: 0n, taxAddedMinor: 0n, taxBreakdown: [], gift: null,
        };
      },
    });
    const res: any = await s.service.createSale("org-1", "staff-1", {
      items: [{ productId: "p1", quantity: 2 }], couponCode: "EID10", payment: { ...PAID },
    });
    const payload = s.integrations.upsertOrder.mock.calls[0][2];
    expect(payload.discountMinor).toBe(10000n);
    expect(payload.totalMinor).toBe(90000n);
    expect(s.promotions.stampOrder).toHaveBeenCalledWith("org-1", "pos", expect.stringContaining("pos-"), expect.anything());
    expect(s.discounts.redeem).toHaveBeenCalledWith("org-1", "d1");
    expect(res.receipt.totalMinor).toBe("90000");
    expect(s.pvRows[0].amountMinor).toBe(90000n);
  });

  it("invalid coupon: the evaluator's error propagates and NOTHING is placed", async () => {
    const s = setup({
      evaluate: async () => { throw new BadRequestException("কুপন প্রয়োগ করা যায়নি: মেয়াদ শেষ"); },
    });
    await expect(s.service.createSale("org-1", "staff-1", {
      items: [{ productId: "p1", quantity: 1 }], couponCode: "BAD", payment: { ...PAID },
    })).rejects.toThrow("কুপন প্রয়োগ করা যায়নি");
    expect(s.integrations.upsertOrder).not.toHaveBeenCalled();
    expect(s.pvRows).toHaveLength(0);
  });

  it("tax: total = subtotal − discount + taxAddedMinor (EC23)", async () => {
    const s = setup({
      evaluate: async (_orgId, input) => {
        const subtotal = input.lines.reduce((sum: bigint, l: any) => sum + l.unitPriceMinor * BigInt(l.quantity), 0n);
        return {
          subtotalMinor: subtotal, promotionDiscountMinor: 0n, promotionsApplied: [],
          couponDiscountMinor: 0n, couponFreeShipping: false, appliedDiscountId: null,
          appliedCouponCode: null, referral: null, referralCodeToRecord: null,
          referralDiscountMinor: 0n, totalDiscountMinor: 0n,
          taxMinor: 7500n, taxAddedMinor: 7500n, taxBreakdown: [], gift: null,
        };
      },
    });
    const res: any = await s.service.createSale("org-1", "staff-1", {
      items: [{ productId: "p1", quantity: 1 }], payment: { ...PAID },
    });
    const payload = s.integrations.upsertOrder.mock.calls[0][2];
    expect(payload.taxMinor).toBe(7500n);
    expect(payload.totalMinor).toBe(57500n);
    expect(res.receipt.taxAddedMinor).toBe("7500");
  });

  it("oversell of a tracked product refuses before placement (incl. aggregated duplicate lines)", async () => {
    const s = setup();
    await expect(s.service.createSale("org-1", "staff-1", {
      items: [{ productId: "p1", quantity: 11 }], payment: { ...PAID },
    })).rejects.toThrow("স্টকে মাত্র 10টি আছে");
    await expect(s.service.createSale("org-1", "staff-1", {
      items: [{ productId: "p1", quantity: 6 }, { productId: "p1", quantity: 6 }], payment: { ...PAID },
    })).rejects.toThrow("স্টকে মাত্র 10টি আছে");
    expect(s.integrations.upsertOrder).not.toHaveBeenCalled();
  });

  it("untracked product (stock null) sells at any quantity", async () => {
    const s = setup();
    const res: any = await s.service.createSale("org-1", "staff-1", {
      items: [{ productId: "p2", quantity: 500 }], payment: { ...DUE },
    });
    expect(res.receipt.totalMinor).toBe("40000000");
  });

  it("preorder product sells at zero stock and its line is stamped isPreorder", async () => {
    const s = setup();
    await s.service.createSale("org-1", "staff-1", {
      items: [{ productId: "p3", quantity: 2 }], payment: { ...PAID },
    });
    const payload = s.integrations.upsertOrder.mock.calls[0][2];
    expect(payload.items[0].isPreorder).toBe(true);
    expect(payload.totalMinor).toBe(400000n);
  });

  it("variant price wins over the product price; variant sku rides the line", async () => {
    const s = setup();
    const res: any = await s.service.createSale("org-1", "staff-1", {
      items: [{ productId: "p2", variantId: "v1", quantity: 2 }], payment: { ...PAID },
    });
    const payload = s.integrations.upsertOrder.mock.calls[0][2];
    expect(payload.items[0].priceMinor).toBe(90000n);
    expect(payload.items[0].sku).toBe("TSHIRT-L-RED");
    expect(res.receipt.totalMinor).toBe("180000");
    // Variant tracked stock (4) is the limit, not the product's.
    await expect(s.service.createSale("org-1", "staff-1", {
      items: [{ productId: "p2", variantId: "v1", quantity: 5 }], payment: { ...PAID },
    })).rejects.toThrow("স্টকে মাত্র 4টি আছে");
  });

  it("foreign / unknown product id is refused (org-scoped lookup)", async () => {
    const s = setup();
    await expect(s.service.createSale("org-1", "staff-1", {
      items: [{ productId: "p9", quantity: 1 }], payment: { ...PAID },
    })).rejects.toThrow("পণ্যটি পাওয়া যায়নি বা বন্ধ আছে");
    expect(s.integrations.upsertOrder).not.toHaveBeenCalled();
  });

  it("duplicate approved TrxID refuses a paid sale before placement", async () => {
    const s = setup();
    s.pvRows.push({ id: "pv-old", organizationId: "org-1", orderId: "ord-old", trxId: "TXN123", status: "approved", amountMinor: 1000n });
    await expect(s.service.createSale("org-1", "staff-1", {
      items: [{ productId: "p1", quantity: 1 }], payment: { mode: "paid", method: "bkash", reference: "TXN123" },
    })).rejects.toThrow("already been recorded");
    expect(s.integrations.upsertOrder).not.toHaveBeenCalled();
  });

  it("fully discounted sale (total 0) records no verification and completes", async () => {
    const s = setup({
      evaluate: async (_orgId, input) => {
        const subtotal = input.lines.reduce((sum: bigint, l: any) => sum + l.unitPriceMinor * BigInt(l.quantity), 0n);
        return {
          subtotalMinor: subtotal, promotionDiscountMinor: subtotal, promotionsApplied: [],
          couponDiscountMinor: 0n, couponFreeShipping: false, appliedDiscountId: null,
          appliedCouponCode: null, referral: null, referralCodeToRecord: null,
          referralDiscountMinor: 0n, totalDiscountMinor: subtotal,
          taxMinor: 0n, taxAddedMinor: 0n, taxBreakdown: [], gift: null,
        };
      },
    });
    const res: any = await s.service.createSale("org-1", "staff-1", {
      items: [{ productId: "p1", quantity: 1 }], payment: { ...PAID },
    });
    expect(s.pvRows).toHaveLength(0);
    expect(res.receipt.totalMinor).toBe("0");
    expect(res.receipt.dueMinor).toBe("0");
  });

  it("empty items / bad quantity are refused", async () => {
    const s = setup();
    await expect(s.service.createSale("org-1", "staff-1", { items: [], payment: { ...PAID } } as any)).rejects.toThrow(BadRequestException);
    await expect(s.service.createSale("org-1", "staff-1", {
      items: [{ productId: "p1", quantity: 0 }], payment: { ...PAID },
    })).rejects.toThrow(BadRequestException);
  });
});

describe("EC34 POS — search", () => {
  it("exact product barcode returns the addable line", async () => {
    const s = setup();
    const res: any = await s.service.search("org-1", "8801001");
    expect(res.exact.productId).toBe("p1");
    expect(res.exact.variantId).toBeNull();
    expect(res.exact.unitPriceMinor).toBe("50000");
    expect(res.exact.stockState).toBe("in_stock");
  });

  it("exact variant sku returns the variant line at the variant price", async () => {
    const s = setup();
    const res: any = await s.service.search("org-1", "TSHIRT-L-RED");
    expect(res.exact.productId).toBe("p2");
    expect(res.exact.variantId).toBe("v1");
    expect(res.exact.unitPriceMinor).toBe("90000");
    expect(res.exact.effectiveStockQuantity).toBe(4);
    expect(res.exact.variants).toHaveLength(2);
    expect(res.exact.variants[0].priceMinor).toBe("90000");
    expect(res.exact.variants[1].priceMinor).toBeNull();
  });

  it("fuzzy name search returns up to 20 serialized products; empty q returns nothing", async () => {
    const s = setup();
    const res: any = await s.service.search("org-1", "চাল");
    expect(res.exact).toBeNull();
    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toMatchObject({ productId: "p1", priceMinor: "50000", stockQuantity: 10 });
    const empty: any = await s.service.search("org-1", "   ");
    expect(empty).toEqual({ exact: null, results: [] });
    // Foreign org products never surface.
    const foreign: any = await s.service.search("org-1", "FOREIGN");
    expect(foreign.results).toHaveLength(0);
    expect(foreign.exact).toBeNull();
  });
});

describe("EC34 POS — DI graph (M65 insurance)", () => {
  it("PosModule resolves PosService with real Integrations/Orders/Promotions instances", async () => {
    const fakePrisma: any = new Proxy({}, { get: () => ({}) });
    @Global()
    @Module({ providers: [{ provide: PrismaService, useValue: fakePrisma }], exports: [PrismaService] })
    class FakePrismaModule {}

    @Module({ imports: [FakePrismaModule, PosModule] })
    class PosGraphRootModule {}

    const ctx = await NestFactory.createApplicationContext(PosGraphRootModule, { logger: false });
    try {
      const svc = ctx.get(PosService);
      expect((svc as any).integrations).toBe(ctx.get(IntegrationsService));
      expect((svc as any).orders).toBe(ctx.get(OrdersService));
      expect((svc as any).promotions).toBe(ctx.get(PromotionsService));
      expect((svc as any).discounts).toBeDefined();
      expect((svc as any).audit).toBeDefined();
    } finally {
      await ctx.close();
    }
  });
});

describe("EC34 POS — today", () => {
  it("queries the Dhaka day bounds with org + source scoping and sums sales + dues", async () => {
    const s = setup();
    const start = dhakaDayStartUtc(new Date());
    const mk = (id: string, createdAt: Date, total: bigint, items: any[]) => ({
      id, organizationId: "org-1", source: "pos", externalNumber: `ORD-${id}`,
      totalMinor: total, createdAt, items,
    });
    s.orders.push(
      mk("t1", new Date(start.getTime() + 3600_000), 50000n, [{ quantity: 2 }]),
      mk("t2", new Date(start.getTime() + 2 * 3600_000), 30000n, [{ quantity: 1 }]),
      mk("y1", new Date(start.getTime() - 3600_000), 99900n, [{ quantity: 9 }]),
      mk("tm1", new Date(start.getTime() + 24 * 3600_000), 88800n, [{ quantity: 9 }]),
    );
    s.pvRows.push({ id: "pv-t1", organizationId: "org-1", orderId: "t1", status: "approved", amountMinor: 50000n });

    const res: any = await s.service.today("org-1");
    // The where clause itself: org-scoped, source pos, [Dhaka
    // midnight, next Dhaka midnight).
    const where = (s.prisma.order.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.organizationId).toBe("org-1");
    expect(where.source).toBe("pos");
    expect(where.createdAt.gte.getTime()).toBe(start.getTime());
    expect(where.createdAt.lt.getTime() - where.createdAt.gte.getTime()).toBe(24 * 3600_000);

    expect(res.orderCount).toBe(2);
    expect(res.totalSalesMinor).toBe("80000");
    const t1 = res.orders.find((o: any) => o.id === "t1");
    const t2 = res.orders.find((o: any) => o.id === "t2");
    expect(t1.dueMinor).toBe("0");
    expect(t1.itemCount).toBe(2);
    expect(t2.dueMinor).toBe("30000");
  });
});
