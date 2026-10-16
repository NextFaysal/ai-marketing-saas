/**
 * AB2 (AX3) — gift cards: the evaluator gift-card line + the
 * pure gift-card helpers.
 *
 * Self-contained fake-prisma harness (the AB1 / GB7 spec
 * pattern): the evaluator tests run the REAL
 * PromotionsService.evaluateCheckout against the fake, with
 * coupon + loyalty snapshots supplied exactly as the checkout
 * callers supply them (the evaluator reads no gift-card tables).
 *
 * What is pinned here:
 *  - no giftCard input ⇒ totals identical to a hand-computed
 *    baseline (pre-AB2 parity);
 *  - the gift-card line applies min(balance, remainder) AFTER
 *    coupon + loyalty — it only touches what loyalty left, and
 *    loyalty is priced first even when it consumes everything;
 *  - balance > remainder ⇒ applied = remainder, never more;
 *  - zero / negative remainder (or a non-positive balance) ⇒ 0
 *    applied and null id/last4 echoes;
 *  - the tax base shrinks by the gift-card amount exactly like
 *    the other discount lines;
 *  - stampOrder writes the gift_card appliedDiscounts entry
 *    (with codeLast4) and writes none when applied = 0;
 *  - the pure helpers: code generation / normalization / hash,
 *    config validation reason keys, amount allowance, and the
 *    lazy-expiry effective status / balance.
 */
import { PromotionsService } from "./promotions.service";
import {
  GIFT_CARD_CODE_ALPHABET,
  effectiveGiftCardStatus,
  generateGiftCardCode,
  giftCardEffectiveBalanceMinor,
  hashGiftCardCode,
  isGiftCardAmountAllowed,
  normalizeGiftCardCode,
  validateGiftCardConfig,
} from "./gift-cards";

// ------------------------------------------------------------------
// Fake prisma harness (mirrors ab1-loyalty.spec.ts)
// ------------------------------------------------------------------

let seq = 0;
const nid = (p: string) => `${p}_${++seq}`;

function cmpVal(a: any, b: any): number {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  if (av === bv) return 0;
  if (av == null) return -1;
  if (bv == null) return 1;
  return av < bv ? -1 : 1;
}

function matchWhere(row: any, where: any): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (key === "OR") {
      if (!Array.isArray(cond) || !(cond as any[]).some((w) => matchWhere(row, w))) return false;
      continue;
    }
    if (key === "AND") {
      if (!Array.isArray(cond) || !(cond as any[]).every((w) => matchWhere(row, w))) return false;
      continue;
    }
    const v = row[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date) && !Array.isArray(cond)) {
      const c: any = cond;
      if ("in" in c && !c.in.some((x: any) => x === v || String(x) === String(v))) return false;
      if ("notIn" in c && c.notIn.some((x: any) => x === v)) return false;
      if ("gt" in c && !(cmpVal(v, c.gt) > 0)) return false;
      if ("gte" in c && !(cmpVal(v, c.gte) >= 0)) return false;
      if ("lt" in c && !(cmpVal(v, c.lt) < 0)) return false;
      if ("lte" in c && !(cmpVal(v, c.lte) <= 0)) return false;
      if ("not" in c) {
        if (c.not === null) {
          if (v == null) return false;
        } else if (v === c.not) return false;
      }
      if ("equals" in c && v !== c.equals) return false;
      if ("contains" in c && !(typeof v === "string" && v.includes(c.contains))) return false;
      continue;
    }
    if (cond === null) {
      if (v != null) return false;
      continue;
    }
    if (v !== cond) return false;
  }
  return true;
}

function applyData(row: any, data: any) {
  for (const [k, val] of Object.entries(data)) {
    if (val !== null && typeof val === "object" && !(val instanceof Date) && !Array.isArray(val)) {
      const o: any = val;
      if ("increment" in o) row[k] = (row[k] ?? 0) + o.increment;
      else if ("decrement" in o) row[k] = (row[k] ?? 0) - o.decrement;
      else if ("set" in o) row[k] = o.set;
      else row[k] = val;
    } else {
      row[k] = val;
    }
  }
}

function sortRows(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...rows];
  for (const spec of specs.reverse()) {
    const [field, dir] = Object.entries(spec)[0] as [string, string];
    out.sort((a, b) => cmpVal(a[field], b[field]) * (dir === "desc" ? -1 : 1));
  }
  return out;
}

class FakeTable {
  rows: any[] = [];
  constructor(public name: string) {}
  async create({ data }: any) {
    const row = { id: data.id ?? nid(this.name), createdAt: new Date(), ...data };
    this.rows.push(row);
    return row;
  }
  async findFirst(args: any = {}) {
    const m = sortRows(this.rows.filter((r) => matchWhere(r, args.where)), args.orderBy);
    return m[0] ?? null;
  }
  async findMany(args: any = {}) {
    let m = sortRows(this.rows.filter((r) => matchWhere(r, args?.where)), args?.orderBy);
    if (args?.skip) m = m.slice(args.skip);
    if (args?.take != null) m = m.slice(0, args.take);
    return m;
  }
  async findUnique(args: any) {
    return this.findFirst(args);
  }
  async update({ where, data }: any) {
    const row = this.rows.find((r) => r.id === where.id) ?? this.rows.find((r) => matchWhere(r, where));
    if (!row) throw new Error(`fake ${this.name}: update target missing`);
    applyData(row, data);
    return row;
  }
  async updateMany({ where, data }: any) {
    const ms = this.rows.filter((r) => matchWhere(r, where));
    for (const r of ms) applyData(r, data);
    return { count: ms.length };
  }
  async count(args: any = {}) {
    return this.rows.filter((r) => matchWhere(r, args.where)).length;
  }
}

const TABLE_NAMES = [
  "organization", "customer", "order", "promotion",
  "storefrontSetting", "taxSetting", "product", "storeDiscount",
] as const;

class FakeDb {
  [key: string]: any;
  constructor() {
    for (const n of TABLE_NAMES) this[n] = new FakeTable(n);
  }
  async $transaction(cb: any) {
    return cb(this);
  }
}

const auditStub = { log: async () => undefined };
const noCouponStub = {
  validateForCheckout: async () => ({ valid: false, reason: "none" }),
};
const couponStub = (discountMinor: bigint) => ({
  validateForCheckout: async () => ({
    valid: true,
    discountMinor,
    freeShipping: false,
    discount: { id: "disc-1" },
  }),
});

const ORG = "org1";

function makeService(db: FakeDb, discounts: any = noCouponStub) {
  return new PromotionsService(db as any, discounts as any, auditStub as any);
}

async function seedOrder(db: FakeDb, over: any = {}) {
  return db.order.create({
    data: {
      organizationId: ORG,
      source: "native_storefront",
      externalId: nid("ext"),
      status: "completed",
      isPractice: false,
      appliedDiscounts: null,
      placedAt: new Date(),
      ...over,
    },
  });
}

const payableOf = (ev: any) => ev.subtotalMinor - ev.totalDiscountMinor + ev.taxAddedMinor;

const line = (unitPriceMinor: bigint, quantity = 1) => ({
  productId: "prod1",
  categoryId: null,
  quantity,
  unitPriceMinor,
  compareAtMinor: null,
});

const giftCard = (balanceMinor: bigint) => ({
  giftCardId: "gc-1",
  balanceMinor,
  codeLast4: "1234",
});

// ------------------------------------------------------------------
// Evaluator: the gift-card discount line
// ------------------------------------------------------------------

describe("AB2 evaluator — gift-card line inside evaluateCheckout", () => {
  it("(a) no giftCard input ⇒ totals identical to the hand-computed baseline", async () => {
    const db = new FakeDb();
    const promotions = makeService(db);
    const ev = await promotions.evaluateCheckout(ORG, {
      lines: [line(100000n), line(5000n, 2)],
    });
    // Hand-computed: subtotal 100_000 + 2×5_000 = 110_000; no
    // promotions / coupon / referral / loyalty / tax configured.
    expect(ev.subtotalMinor).toBe(110000n);
    expect(ev.promotionDiscountMinor).toBe(0n);
    expect(ev.couponDiscountMinor).toBe(0n);
    expect(ev.referralDiscountMinor).toBe(0n);
    expect(ev.totalDiscountMinor).toBe(0n);
    expect(ev.taxMinor).toBe(0n);
    expect(ev.giftCardDiscountMinor ?? 0n).toBe(0n);
    expect(ev.giftCardId ?? null).toBeNull();
    expect(ev.giftCardCodeLast4 ?? null).toBeNull();
    expect(payableOf(ev)).toBe(110000n);

    const withNull = await promotions.evaluateCheckout(ORG, {
      lines: [line(100000n), line(5000n, 2)],
      giftCard: null,
    });
    expect(withNull.subtotalMinor).toBe(ev.subtotalMinor);
    expect(withNull.totalDiscountMinor).toBe(ev.totalDiscountMinor);
    expect(withNull.taxMinor).toBe(ev.taxMinor);
    expect(payableOf(withNull)).toBe(payableOf(ev));
  });

  it("(b) gift card applies min(balance, remainder) after coupon + loyalty", async () => {
    const db = new FakeDb();
    const promotions = makeService(db, couponStub(10000n));
    const ev = await promotions.evaluateCheckout(ORG, {
      lines: [line(100000n)],
      couponCode: "SAVE",
      loyalty: {
        pointsToRedeem: 100, balance: 500, redeemValueMinorPerPoint: 100,
        minRedeemPoints: 0, maxRedeemSharePct: null,
      },
      giftCard: giftCard(50000n),
    });
    // Coupon 10_000, loyalty 100 pts × 100 = 10_000; the gift
    // card only touches what loyalty left: 100_000 − 20_000 =
    // 80_000, and its 50_000 balance fits entirely.
    expect(ev.couponDiscountMinor).toBe(10000n);
    expect(ev.loyaltyDiscountMinor).toBe(10000n);
    expect(ev.loyaltyPointsApplied).toBe(100);
    expect(ev.giftCardDiscountMinor).toBe(50000n);
    expect(ev.giftCardId).toBe("gc-1");
    expect(ev.giftCardCodeLast4).toBe("1234");
    expect(ev.totalDiscountMinor).toBe(70000n);
    expect(payableOf(ev)).toBe(30000n);
  });

  it("(b2) ordering is real: loyalty is priced BEFORE the gift card", async () => {
    const db = new FakeDb();
    const promotions = makeService(db, couponStub(10000n));
    const ev = await promotions.evaluateCheckout(ORG, {
      lines: [line(100000n)],
      couponCode: "SAVE",
      loyalty: {
        pointsToRedeem: 900, balance: 900, redeemValueMinorPerPoint: 100,
        minRedeemPoints: 0, maxRedeemSharePct: null,
      },
      giftCard: giftCard(50000n),
    });
    // If the gift card were priced first it would take 50_000 and
    // loyalty would cap at 40_000. Correct order: loyalty takes
    // the full post-coupon 90_000 and the gift card gets nothing.
    expect(ev.loyaltyDiscountMinor).toBe(90000n);
    expect(ev.giftCardDiscountMinor).toBe(0n);
    expect(ev.giftCardId).toBeNull();
    expect(ev.giftCardCodeLast4).toBeNull();
    expect(ev.totalDiscountMinor).toBe(100000n);
    expect(payableOf(ev)).toBe(0n);
  });

  it("(c) balance > remainder ⇒ applied = remainder, never exceeds it", async () => {
    const db = new FakeDb();
    const promotions = makeService(db);
    const ev = await promotions.evaluateCheckout(ORG, {
      lines: [line(30000n)],
      giftCard: giftCard(999999n),
    });
    expect(ev.giftCardDiscountMinor).toBe(30000n);
    expect(ev.giftCardId).toBe("gc-1");
    expect(ev.giftCardCodeLast4).toBe("1234");
    expect(ev.totalDiscountMinor).toBe(30000n);
    expect(payableOf(ev)).toBe(0n);
  });

  it("(d) zero remainder ⇒ 0 applied and null echoes", async () => {
    const db = new FakeDb();
    const promotions = makeService(db);
    const ev = await promotions.evaluateCheckout(ORG, {
      lines: [line(20000n)],
      loyalty: {
        pointsToRedeem: 200, balance: 200, redeemValueMinorPerPoint: 100,
        minRedeemPoints: 0, maxRedeemSharePct: null,
      },
      giftCard: giftCard(50000n),
    });
    expect(ev.loyaltyDiscountMinor).toBe(20000n);
    expect(ev.giftCardDiscountMinor).toBe(0n);
    expect(ev.giftCardId).toBeNull();
    expect(ev.giftCardCodeLast4).toBeNull();
    expect(payableOf(ev)).toBe(0n);
  });

  it("(d2) negative remainder (over-covering coupon) floors at 0", async () => {
    const db = new FakeDb();
    const promotions = makeService(db, couponStub(60000n));
    const ev = await promotions.evaluateCheckout(ORG, {
      lines: [line(50000n)],
      couponCode: "SAVE",
      giftCard: giftCard(10000n),
    });
    expect(ev.giftCardDiscountMinor).toBe(0n);
    expect(ev.giftCardId).toBeNull();
    expect(ev.giftCardCodeLast4).toBeNull();
  });

  it("(d3) a non-positive balance applies nothing and echoes nulls", async () => {
    const db = new FakeDb();
    const promotions = makeService(db);
    for (const bal of [0n, -5000n]) {
      const ev = await promotions.evaluateCheckout(ORG, {
        lines: [line(50000n)],
        giftCard: giftCard(bal),
      });
      expect(ev.giftCardDiscountMinor).toBe(0n);
      expect(ev.giftCardId).toBeNull();
      expect(ev.giftCardCodeLast4).toBeNull();
      expect(ev.totalDiscountMinor).toBe(0n);
      expect(payableOf(ev)).toBe(50000n);
    }
  });

  it("(e) the tax base shrinks by the gift-card amount", async () => {
    const db = new FakeDb();
    await db.taxSetting.create({
      data: { organizationId: ORG, defaultVatBps: 1500, pricesIncludeVat: false },
    });
    const promotions = makeService(db);
    const plain = await promotions.evaluateCheckout(ORG, { lines: [line(100000n)] });
    const withGift = await promotions.evaluateCheckout(ORG, {
      lines: [line(100000n)],
      giftCard: giftCard(40000n),
    });
    // The no-gift-card tax on the REDUCED base (60_000) is the
    // reference: the gift-card evaluation's tax must equal it.
    const reducedBase = await promotions.evaluateCheckout(ORG, { lines: [line(60000n)] });
    expect(plain.taxAddedMinor).toBe(15000n);
    expect(withGift.giftCardDiscountMinor).toBe(40000n);
    expect(withGift.taxMinor).toBe(9000n);
    expect(withGift.taxAddedMinor).toBe(9000n);
    expect(withGift.taxMinor).toBe(reducedBase.taxMinor);
    expect(payableOf(withGift)).toBe(60000n + 9000n);
  });

  it("(f) stampOrder writes the gift_card entry with codeLast4 — and none at 0", async () => {
    const db = new FakeDb();
    const promotions = makeService(db);
    const baseEv: any = {
      promotionDiscountMinor: 0n,
      promotionsApplied: [],
      referralDiscountMinor: 0n,
      referralCodeToRecord: null,
      appliedDiscountId: null,
      taxBreakdown: [],
      gift: null,
      giftOutcome: null,
    };

    const order = await seedOrder(db, { externalId: "ext-gc-stamp" });
    await promotions.stampOrder(ORG, "native_storefront", "ext-gc-stamp", {
      ...baseEv,
      giftCardDiscountMinor: 25000n,
      giftCardId: "gc-1",
      giftCardCodeLast4: "1234",
    });
    const row = db.order.rows.find((r: any) => r.id === order.id);
    const entries = JSON.parse(JSON.stringify(row.appliedDiscounts));
    expect(entries).toEqual([
      {
        kind: "gift_card",
        name: "গিফট কার্ড (••••1234)",
        discountMinor: "25000",
        codeLast4: "1234",
      },
    ]);

    const order2 = await seedOrder(db, { externalId: "ext-gc-zero" });
    await promotions.stampOrder(ORG, "native_storefront", "ext-gc-zero", {
      ...baseEv,
      giftCardDiscountMinor: 0n,
      giftCardId: null,
      giftCardCodeLast4: null,
    });
    const row2 = db.order.rows.find((r: any) => r.id === order2.id);
    // No entry at all: appliedDiscounts is only written when the
    // stamp carries at least one positive discount line.
    expect(row2.appliedDiscounts).toBeNull();
  });
});

// ------------------------------------------------------------------
// Pure helpers
// ------------------------------------------------------------------

describe("AB2 gift-cards helpers — codes", () => {
  it("generateGiftCardCode produces canonical codes from the alphabet", () => {
    const code = generateGiftCardCode();
    expect(code).toMatch(/^QG-(?:[A-Z2-9]{4}-){2}[A-Z2-9]{4}$/);
    const body = code.replace(/-/g, "").slice(2);
    expect(body).toHaveLength(12);
    for (const ch of body) expect(GIFT_CARD_CODE_ALPHABET).toContain(ch);
    expect(generateGiftCardCode()).not.toBe(code);
  });

  it("normalizeGiftCardCode accepts dashed / undashed / bare, rejects the rest", () => {
    const canonical = "QG-ABCD-EFGH-JKLM";
    expect(normalizeGiftCardCode(canonical)).toBe(canonical);
    expect(normalizeGiftCardCode("QGABCDEFGHJKLM")).toBe(canonical);
    expect(normalizeGiftCardCode("ABCDEFGHJKLM")).toBe(canonical);
    expect(normalizeGiftCardCode("  qg-abcd-efgh-jklm ")).toBe(canonical);
    expect(normalizeGiftCardCode("QG ABCD EFGH JKLM")).toBe(canonical);
    // Forbidden alphabet characters (I, O, 0, 1) and bad shapes.
    expect(normalizeGiftCardCode("QG-ABCD-EFGH-JKLI")).toBeNull();
    expect(normalizeGiftCardCode("QG-ABCD-EFGH-JKL0")).toBeNull();
    expect(normalizeGiftCardCode("QG-ABC-EFGH-JKLM")).toBeNull();
    expect(normalizeGiftCardCode("ABCDEFGH")).toBeNull();
    expect(normalizeGiftCardCode("")).toBeNull();
    expect(normalizeGiftCardCode(null)).toBeNull();
    expect(normalizeGiftCardCode(1234)).toBeNull();
  });

  it("hashGiftCardCode is a stable SHA-256 hex", () => {
    const h = hashGiftCardCode("QG-ABCD-EFGH-JKLM");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashGiftCardCode("QG-ABCD-EFGH-JKLM")).toBe(h);
    expect(hashGiftCardCode("QG-ABCD-EFGH-JKLN")).not.toBe(h);
  });
});

describe("AB2 gift-cards helpers — config validation + amounts", () => {
  it("normalizes presets (de-duplicated, sorted) and defaults", () => {
    const cfg = validateGiftCardConfig({ presetAmountsMinor: [5000, 1000, 5000, 2500] });
    expect(cfg.presetAmountsMinor).toEqual([1000, 2500, 5000]);
    expect(cfg.allowCustomAmount).toBe(false);
    expect(cfg.minAmountMinor).toBeNull();
    expect(cfg.maxAmountMinor).toBeNull();
  });

  it("throws the stable reason keys", () => {
    expect(() => validateGiftCardConfig(null)).toThrow("gift_card_config_invalid");
    expect(() => validateGiftCardConfig("x")).toThrow("gift_card_config_invalid");
    expect(() => validateGiftCardConfig({})).toThrow("gift_card_no_amounts");
    expect(() => validateGiftCardConfig({ presetAmountsMinor: [] })).toThrow("gift_card_no_amounts");
    expect(() => validateGiftCardConfig({ presetAmountsMinor: [0] })).toThrow("gift_card_presets_invalid");
    expect(() => validateGiftCardConfig({ presetAmountsMinor: [100.5] })).toThrow("gift_card_presets_invalid");
    expect(() =>
      validateGiftCardConfig({ presetAmountsMinor: Array.from({ length: 21 }, (_, i) => i + 1) }),
    ).toThrow("gift_card_presets_invalid");
    expect(() => validateGiftCardConfig({ allowCustomAmount: true })).toThrow("gift_card_min_required");
    expect(() =>
      validateGiftCardConfig({ allowCustomAmount: true, minAmountMinor: 5000, maxAmountMinor: 1000 }),
    ).toThrow("gift_card_min_gt_max");
    expect(() =>
      validateGiftCardConfig({
        presetAmountsMinor: [500], allowCustomAmount: true,
        minAmountMinor: 1000, maxAmountMinor: 5000,
      }),
    ).toThrow("gift_card_preset_out_of_range");
    // A custom-only config WITH a minimum is valid.
    const cfg = validateGiftCardConfig({ allowCustomAmount: true, minAmountMinor: 1000, maxAmountMinor: 9000 });
    expect(cfg).toEqual({
      presetAmountsMinor: [], allowCustomAmount: true, minAmountMinor: 1000, maxAmountMinor: 9000,
    });
  });

  it("isGiftCardAmountAllowed: presets, custom range, positivity", () => {
    const cfg = validateGiftCardConfig({
      presetAmountsMinor: [5000], allowCustomAmount: true,
      minAmountMinor: 1000, maxAmountMinor: 20000,
    });
    expect(isGiftCardAmountAllowed(cfg, 5000n)).toBe(true); // preset
    expect(isGiftCardAmountAllowed(cfg, 7000n)).toBe(true); // custom in range
    expect(isGiftCardAmountAllowed(cfg, 999n)).toBe(false); // below min, not a preset
    expect(isGiftCardAmountAllowed(cfg, 20001n)).toBe(false); // above max
    expect(isGiftCardAmountAllowed(cfg, 0n)).toBe(false);
    expect(isGiftCardAmountAllowed(cfg, -100n)).toBe(false);
    const presetOnly = validateGiftCardConfig({ presetAmountsMinor: [5000] });
    expect(isGiftCardAmountAllowed(presetOnly, 5000n)).toBe(true);
    expect(isGiftCardAmountAllowed(presetOnly, 6000n)).toBe(false);
  });
});

describe("AB2 gift-cards helpers — effective status / balance (lazy expiry)", () => {
  const now = new Date("2026-10-15T00:00:00Z");
  const past = new Date("2026-10-01T00:00:00Z");
  const future = new Date("2027-01-01T00:00:00Z");

  it("void and expired are terminal; past-expiry active/depleted read expired", () => {
    expect(effectiveGiftCardStatus({ status: "void", expiresAt: future }, now)).toBe("void");
    expect(effectiveGiftCardStatus({ status: "expired", expiresAt: future }, now)).toBe("expired");
    expect(effectiveGiftCardStatus({ status: "active", expiresAt: past }, now)).toBe("expired");
    expect(effectiveGiftCardStatus({ status: "depleted", expiresAt: past }, now)).toBe("expired");
    expect(effectiveGiftCardStatus({ status: "active", expiresAt: future }, now)).toBe("active");
    expect(effectiveGiftCardStatus({ status: "depleted", expiresAt: future }, now)).toBe("depleted");
    expect(effectiveGiftCardStatus({ status: "active", expiresAt: null }, now)).toBe("active");
    expect(effectiveGiftCardStatus({ status: "active", expiresAt: past.toISOString() }, now)).toBe("expired");
  });

  it("effective balance is 0 for expired / void, the cache otherwise", () => {
    expect(giftCardEffectiveBalanceMinor({ status: "active", expiresAt: past, balanceCache: 5000n }, now)).toBe(0n);
    expect(giftCardEffectiveBalanceMinor({ status: "void", balanceCache: 5000n }, now)).toBe(0n);
    expect(giftCardEffectiveBalanceMinor({ status: "expired", balanceCache: 5000n }, now)).toBe(0n);
    expect(giftCardEffectiveBalanceMinor({ status: "active", expiresAt: future, balanceCache: 5000n }, now)).toBe(5000n);
    expect(giftCardEffectiveBalanceMinor({ status: "depleted", balanceCache: 0n }, now)).toBe(0n);
  });
});
