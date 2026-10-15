import { computeTax } from "./tax";
import { PromotionsService } from "./promotions.service";

/**
 * EC23 — VAT math: pure computeTax (round-half-up per line,
 * inclusive contained portion vs exclusive add-on, per-rate
 * grouping) + the evaluator wiring (product override > org default,
 * bump at default rate only, coupon+referral scaling of line
 * bases, and the no-tax-configuration parity guarantee).
 */

describe("EC23 computeTax (pure)", () => {
  it("inclusive: contained portion with mixed rates + rounding", () => {
    const rates: Record<string, number> = { "p-1": 1500, "p-2": 750 };
    const out = computeTax(
      [
        { productId: "p-1", baseMinor: 10000n }, // 10000·1500/11500 = 1304.34… → 1304
        { productId: "p-2", baseMinor: 10001n }, // 10001·750/10750 = 697.72… → 698
      ],
      (id) => rates[id ?? ""] ?? null,
      true,
    );
    expect(out.taxMinor).toBe(2002n);
    expect(out.taxAddedMinor).toBe(0n); // inclusive: total unchanged
    expect(out.breakdown).toEqual([
      { rateBps: 750, taxableMinor: 10001n, taxMinor: 698n },
      { rateBps: 1500, taxableMinor: 10000n, taxMinor: 1304n },
    ]);
  });

  it("round-half-up: an exact .5 rounds UP (not floor, not banker's)", () => {
    // Exclusive 1% of 50 minor = 0.5 → 1.
    const ex = computeTax([{ productId: "p", baseMinor: 50n }], () => 100, false);
    expect(ex.taxMinor).toBe(1n);
    // Inclusive 100% of 1 minor = 0.5 → 1.
    const inc = computeTax([{ productId: "p", baseMinor: 1n }], () => 10000, true);
    expect(inc.taxMinor).toBe(1n);
    // Just under .5 rounds down: 1% of 49 = 0.49 → 0.
    const down = computeTax([{ productId: "p", baseMinor: 49n }], () => 100, false);
    expect(down.taxMinor).toBe(0n);
  });

  it("exclusive: tax is added on top (taxAddedMinor = taxMinor)", () => {
    const out = computeTax([{ productId: "p", baseMinor: 10000n }], () => 1500, false);
    expect(out.taxMinor).toBe(1500n);
    expect(out.taxAddedMinor).toBe(1500n);
    expect(out.breakdown).toEqual([{ rateBps: 1500, taxableMinor: 10000n, taxMinor: 1500n }]);
  });

  it("untaxed lines (null / 0 rate / zero base) contribute nothing", () => {
    const out = computeTax(
      [
        { productId: "a", baseMinor: 10000n },
        { productId: "b", baseMinor: 10000n },
        { productId: "c", baseMinor: 0n },
      ],
      (id) => (id === "a" ? null : id === "b" ? 0 : 1500),
      false,
    );
    expect(out.taxMinor).toBe(0n);
    expect(out.breakdown).toEqual([]);
  });

  it("same-rate lines group into one breakdown row; taxes sum per line", () => {
    const out = computeTax(
      [
        { productId: "a", baseMinor: 333n }, // 333·1500/10000 = 49.95 → 50
        { productId: "b", baseMinor: 333n }, // → 50
      ],
      () => 1500,
      false,
    );
    expect(out.breakdown).toEqual([{ rateBps: 1500, taxableMinor: 666n, taxMinor: 100n }]);
    expect(out.taxMinor).toBe(100n);
  });
});

// ---------- evaluator wiring (fake Prisma) ----------

function makePrisma(opts: {
  taxSetting?: any;
  products?: any[];
  referralPercent?: number | null;
}) {
  return {
    promotion: { findMany: async () => [] },
    taxSetting: { findFirst: async () => opts.taxSetting ?? null },
    product: {
      findMany: async ({ where }: any) => {
        const ids: string[] = where?.id?.in ?? [];
        return (opts.products ?? []).filter((p) => ids.includes(p.id));
      },
    },
    storefrontSetting: {
      findFirst: async () =>
        opts.referralPercent == null
          ? null
          : { referralDiscountPercent: opts.referralPercent, referralMinSubtotalMinor: null },
    },
    customer: {
      findFirst: async ({ where }: any) =>
        where?.referralCode
          ? { id: "cust-ref", phone: "01700000000", referralCode: where.referralCode }
          : null,
    },
    order: { findMany: async () => [] },
  } as any;
}

function makeService(prisma: any, discountsStub?: any) {
  return new PromotionsService(prisma, discountsStub ?? ({} as any), { log: async () => undefined } as any);
}

const line = (productId: string, unitPriceMinor: bigint, quantity = 1) => ({
  productId,
  categoryId: null,
  quantity,
  unitPriceMinor,
  compareAtMinor: null,
});

describe("EC23 evaluator tax step", () => {
  it("product override beats the org default; default applies otherwise", async () => {
    const svc = makeService(
      makePrisma({
        taxSetting: { defaultVatBps: 1500, pricesIncludeVat: true },
        products: [
          { id: "p-1", taxRateBps: 750 },
          { id: "p-2", taxRateBps: null },
        ],
      }),
    );
    const ev = await svc.evaluateCheckout("org-1", {
      lines: [line("p-1", 10750n), line("p-2", 11500n)],
    });
    // p-1: 10750 @7.5% inclusive = 750 exactly. p-2: 11500 @15% inclusive = 1500.
    expect(ev.taxMinor).toBe(2250n);
    expect(ev.taxAddedMinor).toBe(0n);
    expect(ev.taxBreakdown).toEqual([
      { rateBps: 750, taxableMinor: 10750n, taxMinor: 750n },
      { rateBps: 1500, taxableMinor: 11500n, taxMinor: 1500n },
    ]);
  });

  it("the bump is taxed at the org default rate only (pseudo-line)", async () => {
    const svc = makeService(
      makePrisma({
        taxSetting: { defaultVatBps: 1500, pricesIncludeVat: false },
        products: [{ id: "p-1", taxRateBps: null }],
      }),
    );
    const ev = await svc.evaluateCheckout("org-1", {
      lines: [line("p-1", 10000n)],
      bumpMinor: 10000n,
    });
    // Line 10000 + bump 10000, both @15% exclusive → 1500 + 1500.
    expect(ev.taxMinor).toBe(3000n);
    expect(ev.taxAddedMinor).toBe(3000n);
    expect(ev.taxBreakdown).toEqual([{ rateBps: 1500, taxableMinor: 20000n, taxMinor: 3000n }]);
  });

  it("no TaxSetting and no product rates ⇒ parity: tax 0, breakdown []", async () => {
    const svc = makeService(
      makePrisma({ taxSetting: null, products: [{ id: "p-1", taxRateBps: null }] }),
    );
    const ev = await svc.evaluateCheckout("org-1", { lines: [line("p-1", 10000n)], bumpMinor: 500n });
    expect(ev.taxMinor).toBe(0n);
    expect(ev.taxAddedMinor).toBe(0n);
    expect(ev.taxBreakdown).toEqual([]);
    expect(ev.subtotalMinor).toBe(10500n);
    expect(ev.totalDiscountMinor).toBe(0n);
  });

  it("product rate alone (no TaxSetting row) still taxes, inclusive by default", async () => {
    const svc = makeService(
      makePrisma({ taxSetting: null, products: [{ id: "p-1", taxRateBps: 1000 }] }),
    );
    const ev = await svc.evaluateCheckout("org-1", { lines: [line("p-1", 11000n)] });
    // 11000 @10% inclusive = 1000 exactly; a missing TaxSetting row
    // takes the schema default pricesIncludeVat = true.
    expect(ev.taxMinor).toBe(1000n);
    expect(ev.taxAddedMinor).toBe(0n);
  });

  it("coupon + referral shrink line bases proportionally before tax", async () => {
    const discountsStub = {
      validateForCheckout: async () => ({
        valid: true,
        discountMinor: 2000n,
        freeShipping: false,
        discount: { id: "d-1" },
      }),
    };
    const svc = makeService(
      makePrisma({
        taxSetting: { defaultVatBps: 2500, pricesIncludeVat: false },
        products: [{ id: "p-1", taxRateBps: null }],
        referralPercent: 10,
      }),
      discountsStub,
    );
    const ev = await svc.evaluateCheckout("org-1", {
      lines: [line("p-1", 10000n)],
      couponCode: "SAVE",
      referralCode: "REFABC",
      buyerPhone: "01811111111",
    });
    // Coupon 2000; referral 10% of (10000 − 2000) = 800.
    // Merchandise payable 7200 → scaled base 7200 (postPromotion 10000).
    // Tax @25% exclusive = 1800.
    expect(ev.couponDiscountMinor).toBe(2000n);
    expect(ev.referralDiscountMinor).toBe(800n);
    expect(ev.taxBreakdown).toEqual([{ rateBps: 2500, taxableMinor: 7200n, taxMinor: 1800n }]);
    expect(ev.taxMinor).toBe(1800n);
    expect(ev.taxAddedMinor).toBe(1800n);
  });
});
