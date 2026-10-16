import { BadRequestException } from "@nestjs/common";
import { PosService } from "./pos.service";
import { PromotionsService } from "../commerce/promotions.service";

/**
 * AB2 (AX3) — gift cards at the POS counter: a sale presenting a
 * giftCardCode resolves the card through the GiftCardsService
 * stub, prices the discount through the REAL
 * PromotionsService.evaluateCheckout (the evaluator's gift-card
 * line is min(balance, merchandise payable after other discounts)),
 * and spends the balance via postPlacementRedeem AFTER placement
 * with the EVALUATION's amount. A redemption refusal propagates
 * and NO order is created. Harness mirrors ec34-pos.spec.ts.
 */

type Row = Record<string, any>;

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (k === "OR") return (v as any[]).some((sub) => matches(row, sub));
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      return true;
    }
    return row[k] === v;
  });
}

function makeTable(rows: Row[]) {
  return {
    rows,
    findFirst: jest.fn(async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null),
    findMany: jest.fn(async ({ where, orderBy }: any = {}) => {
      const found = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy) return found; // ordering is irrelevant to these tests
      return found;
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `row-${rows.length + 1}`, createdAt: new Date(), ...data };
      rows.push(row);
      return row;
    }),
  };
}

function setup(opts: { giftCards?: any } = {}) {
  const products: Row[] = [
    { id: "p1", organizationId: "org-1", name: "চাল ৫ কেজি", sku: "RICE-5", barcode: null, status: "ACTIVE", priceMinor: 50000n, compareAtMinor: null, stockQuantity: 10, categoryId: null, preorderEnabled: false, isGiftCard: false },
    { id: "p-gc", organizationId: "org-1", name: "গিফট কার্ড", sku: "GC-1", barcode: null, status: "ACTIVE", priceMinor: 50000n, compareAtMinor: null, stockQuantity: null, categoryId: null, preorderEnabled: false, isGiftCard: true },
  ];
  const orders: Row[] = [];
  const pvRows: Row[] = [];
  let orderSeq = 0;

  const prisma: any = {
    product: makeTable(products),
    productVariant: makeTable([]),
    promotion: makeTable([]),
    storeDiscount: makeTable([]),
    taxSetting: makeTable([]),
    storefrontSetting: makeTable([]),
    category: makeTable([]),
    customer: makeTable([]),
    order: {
      findFirst: jest.fn(async ({ where }: any) => orders.find((r) => matches(r, where)) ?? null),
      findMany: jest.fn(async ({ where }: any = {}) => orders.filter((r) => matches(r, where))),
    },
    paymentVerification: makeTable(pvRows),
    organization: { findFirst: jest.fn(async () => ({ id: "org-1", name: "টেস্ট দোকান", brandName: null })) },
  };

  const integrations: any = {
    upsertOrder: jest.fn(async (orgId: string, _storeId: any, payload: any, source: string) => {
      const row = {
        id: `ord-${++orderSeq}`, organizationId: orgId, source,
        externalId: payload.externalId, externalNumber: payload.externalNumber,
        status: payload.status, totalMinor: payload.totalMinor,
        customerId: "cust-1", createdAt: new Date(),
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
      const total = BigInt(row?.totalMinor ?? 0);
      return {
        id: orderId, externalNumber: row?.externalNumber ?? null, status: row?.status,
        totalMinor: total.toString(), advancePaidMinor: "0", amountDueMinor: total.toString(),
        items: row?.items ?? [],
      };
    }),
  };

  const discounts: any = {
    validateForCheckout: jest.fn(async () => ({ valid: false, reason: "none" })),
    redeem: jest.fn(async () => ({ id: "d1" })),
  };
  const audit: any = { log: jest.fn(async () => undefined) };
  // The REAL evaluator — only its gift-card line can discount
  // this sale (no promotions / coupons / tax are seeded).
  const promotions = new PromotionsService(prisma, discounts, audit);
  const stampSpy = jest.spyOn(promotions, "stampOrder").mockResolvedValue(undefined as any);

  const giftCards = opts.giftCards ?? {
    resolveForCheckout: jest.fn(async () => ({
      giftCardId: "gc-1", codeLast4: "1234", balanceMinor: 20000n, status: "active", expiresAt: null,
    })),
    postPlacementRedeem: jest.fn(async () => ({ id: "ledger-1" })),
  };

  const service = new PosService(
    prisma, integrations, ordersService, promotions as any, discounts, audit, undefined, giftCards as any,
  );
  return { service, prisma, integrations, ordersService, promotions, stampSpy, giftCards, orders, pvRows, products };
}

const DUE = { mode: "due" } as const;

describe("AB2 POS — gift-card sale", () => {
  it("prices the gift-card discount via the real evaluator and posts postPlacementRedeem after placement with the evaluation amount", async () => {
    const s = setup();
    const res: any = await s.service.createSale("org-1", "staff-1", {
      items: [{ productId: "p1", quantity: 1 }],
      giftCardCode: "QG-AAAA-BBBB-1234",
      payment: { ...DUE },
    });
    // Resolved with the cart flag computed from the sale's lines.
    expect(s.giftCards.resolveForCheckout).toHaveBeenCalledWith(
      "org-1", "QG-AAAA-BBBB-1234", { cartHasGiftCardProduct: false },
    );
    // Real evaluator: subtotal 50000, card balance 20000 ⇒
    // discount 20000, total 30000 rides the placement payload.
    const payload = s.integrations.upsertOrder.mock.calls[0][2];
    expect(payload.discountMinor).toBe(20000n);
    expect(payload.totalMinor).toBe(30000n);
    // The balance is spent AFTER placement, for the placed
    // order, with the evaluation's amount + card id.
    expect(s.orders).toHaveLength(1);
    expect(s.giftCards.postPlacementRedeem).toHaveBeenCalledWith("org-1", {
      orderId: s.orders[0].id, giftCardId: "gc-1", amountMinor: 20000n,
    });
    // The receipt carries the gift-card slice (last4 + amount).
    expect(res.receipt.giftCard).toEqual({ codeLast4: "1234", discountMinor: "20000" });
    expect(res.receipt.totalMinor).toBe("30000");
  });

  it("a balance larger than the sale is clamped to the sale total by the evaluator", async () => {
    const s = setup({
      giftCards: {
        resolveForCheckout: jest.fn(async () => ({
          giftCardId: "gc-9", codeLast4: "9876", balanceMinor: 999999n, status: "active", expiresAt: null,
        })),
        postPlacementRedeem: jest.fn(async () => ({ id: "ledger-9" })),
      },
    });
    const res: any = await s.service.createSale("org-1", "staff-1", {
      items: [{ productId: "p1", quantity: 1 }],
      giftCardCode: "QG-CCCC-DDDD-9876",
      payment: { ...DUE },
    });
    const payload = s.integrations.upsertOrder.mock.calls[0][2];
    expect(payload.totalMinor).toBe(0n);
    expect(s.giftCards.postPlacementRedeem).toHaveBeenCalledWith("org-1", {
      orderId: s.orders[0].id, giftCardId: "gc-9", amountMinor: 50000n,
    });
    expect(res.receipt.giftCard).toEqual({ codeLast4: "9876", discountMinor: "50000" });
  });

  it("redemption refusal propagates and NO order is created", async () => {
    const s = setup({
      giftCards: {
        resolveForCheckout: jest.fn(async () => {
          throw new BadRequestException("গিফট কার্ডের মেয়াদ শেষ হয়ে গেছে");
        }),
        postPlacementRedeem: jest.fn(async () => null),
      },
    });
    await expect(s.service.createSale("org-1", "staff-1", {
      items: [{ productId: "p1", quantity: 1 }],
      giftCardCode: "QG-EXPI-RED0-0000",
      payment: { ...DUE },
    })).rejects.toThrow("গিফট কার্ডের মেয়াদ শেষ হয়ে গেছে");
    expect(s.integrations.upsertOrder).not.toHaveBeenCalled();
    expect(s.orders).toHaveLength(0);
    expect(s.giftCards.postPlacementRedeem).not.toHaveBeenCalled();
  });

  it("buying a gift-card PRODUCT with a gift card is refused by resolution (cartHasGiftCardProduct=true)", async () => {
    const s = setup({
      giftCards: {
        resolveForCheckout: jest.fn(async (_org: string, _code: string, optsArg: any) => {
          if (optsArg?.cartHasGiftCardProduct) {
            throw new BadRequestException("গিফট কার্ড দিয়ে গিফট কার্ড কেনা যাবে না");
          }
          return { giftCardId: "gc-1", codeLast4: "1234", balanceMinor: 20000n, status: "active", expiresAt: null };
        }),
        postPlacementRedeem: jest.fn(async () => null),
      },
    });
    await expect(s.service.createSale("org-1", "staff-1", {
      items: [{ productId: "p-gc", quantity: 1 }],
      giftCardCode: "QG-AAAA-BBBB-1234",
      payment: { ...DUE },
    })).rejects.toThrow("গিফট কার্ড দিয়ে গিফট কার্ড কেনা যাবে না");
    expect(s.giftCards.resolveForCheckout).toHaveBeenCalledWith(
      "org-1", "QG-AAAA-BBBB-1234", { cartHasGiftCardProduct: true },
    );
    expect(s.integrations.upsertOrder).not.toHaveBeenCalled();
  });
});
