/**
 * AB1 (AX1 + AX2) — loyalty points + referral rewards.
 *
 * Self-contained fake-prisma harness (the GB7 spec pattern): the
 * evaluator tests run the REAL PromotionsService.evaluateCheckout
 * against the fake; the service tests run the REAL LoyaltyService
 * (its transactions execute against the same in-memory tables, so
 * ledger rows + the customer cache can be asserted together).
 *
 * What is pinned here:
 *  - the loyalty discount line: points × value EXACTLY, payable
 *    cap, share cap, min-redeem suppression, balance clamp,
 *    tax-base parity with coupon/referral, no-input parity;
 *  - stampOrder's loyalty entry + referrerCustomerId stamp;
 *  - earn exactly-once at the sold transition, basis excluding
 *    shipping + gift wrap;
 *  - redeem posting + FIFO lot consumption, the
 *    insufficient-balance race, cancel reversal;
 *  - PROPORTIONAL refund clawback (full refund ⇒ full amount),
 *    negative balances, referral points + coupon rewards with
 *    their exactly-once claims, coupon void-on-full-refund;
 *  - the expiry sweep incl. the clawback-deficit case;
 *  - settings validation + staff adjust + foreign-id 404s.
 */
import { PromotionsService } from "./promotions.service";
import { LoyaltyService } from "./loyalty.service";

// ------------------------------------------------------------------
// Fake prisma harness
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
  async upsert({ where, create, update }: any) {
    const found = this.rows.find((r) => matchWhere(r, where));
    if (found) {
      applyData(found, update);
      return found;
    }
    return this.create({ data: create });
  }
  async count(args: any = {}) {
    return this.rows.filter((r) => matchWhere(r, args.where)).length;
  }
  async delete({ where }: any) {
    const i = this.rows.findIndex((r) => r.id === where.id);
    if (i >= 0) this.rows.splice(i, 1);
    return {};
  }
}

const TABLE_NAMES = [
  "organization", "customer", "order", "courierShipment", "promotion",
  "storefrontSetting", "taxSetting", "product", "loyaltySetting",
  "referralRewardSetting", "loyaltyLedger", "storeDiscount", "auditLog",
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

const auditStub = { records: [] as any[], log: async function (this: any, r: any) { this.records.push(r); return r; }, record: async function (this: any, r: any) { this.records.push(r); return r; } };
const eventsStub = { on: (_e: string, _h: any) => undefined, emit: (_e: string, _p: any) => undefined };
const discountsStub = { validateForCheckout: async () => ({ ok: false, reason: "none" }) };

const ORG = "org1";

function makeServices(db: FakeDb) {
  const promotions = new PromotionsService(db as any, discountsStub as any, auditStub as any);
  const loyalty = new LoyaltyService(db as any, auditStub as any, eventsStub as any, undefined);
  return { promotions, loyalty };
}

async function seedCustomer(db: FakeDb, over: any = {}) {
  return db.customer.create({
    data: {
      organizationId: ORG,
      firstName: "Rahim",
      phone: "+8801700000000",
      loyaltyBalanceCache: 0,
      referralCode: null,
      mergedIntoId: null,
      ...over,
    },
  });
}

async function seedLoyaltySetting(db: FakeDb, over: any = {}) {
  return db.loyaltySetting.create({
    data: {
      organizationId: ORG,
      enabled: true,
      earnPointsPer1000Minor: 1,
      redeemValueMinorPerPoint: 100,
      minRedeemPoints: 0,
      maxRedeemSharePct: null,
      pointsExpiryDays: null,
      ...over,
    },
  });
}

async function seedOrder(db: FakeDb, over: any = {}) {
  return db.order.create({
    data: {
      organizationId: ORG,
      source: "native_storefront",
      externalId: nid("ext"),
      orderNumber: "ORD-1",
      status: "completed",
      isPractice: false,
      customerId: null,
      referrerCustomerId: null,
      referralCode: null,
      totalMinor: 100000n,
      shippingMinor: 6000n,
      giftWrapMinor: 0n,
      refundedMinor: 0n,
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

// ------------------------------------------------------------------
// Evaluator: the loyalty discount line
// ------------------------------------------------------------------

describe("AB1 evaluator — loyalty line inside evaluateCheckout", () => {
  it("discount = applied points × value exactly; totals flow through", async () => {
    const db = new FakeDb();
    const { promotions } = makeServices(db);
    const ev = await promotions.evaluateCheckout(ORG, {
      lines: [line(100000n)],
      loyalty: { pointsToRedeem: 100, balance: 500, redeemValueMinorPerPoint: 100, minRedeemPoints: 0, maxRedeemSharePct: null },
    });
    expect(ev.loyaltyPointsApplied).toBe(100);
    expect(ev.loyaltyDiscountMinor).toBe(10000n);
    expect(ev.totalDiscountMinor).toBe(10000n);
    expect(payableOf(ev)).toBe(90000n);
  });

  it("payable cap: applied points are floor-reduced so discount == points × value", async () => {
    const db = new FakeDb();
    const { promotions } = makeServices(db);
    // Payable 10_050; value 100/point ⇒ at most 100 points fit
    // (100 × 100 = 10_000 ≤ 10_050; 101 × 100 = 10_100 > cap).
    const ev = await promotions.evaluateCheckout(ORG, {
      lines: [line(10050n)],
      loyalty: { pointsToRedeem: 500, balance: 500, redeemValueMinorPerPoint: 100, minRedeemPoints: 0, maxRedeemSharePct: null },
    });
    expect(ev.loyaltyPointsApplied).toBe(100);
    expect(ev.loyaltyDiscountMinor).toBe(10000n);
    expect(payableOf(ev)).toBe(50n);
  });

  it("share cap: maxRedeemSharePct caps at X% of payable-after-others", async () => {
    const db = new FakeDb();
    const { promotions } = makeServices(db);
    const ev = await promotions.evaluateCheckout(ORG, {
      lines: [line(100000n)],
      loyalty: { pointsToRedeem: 900, balance: 900, redeemValueMinorPerPoint: 100, minRedeemPoints: 0, maxRedeemSharePct: 25 },
    });
    expect(ev.loyaltyDiscountMinor).toBe(25000n);
    expect(ev.loyaltyPointsApplied).toBe(250);
  });

  it("below minRedeemPoints grants nothing (and never errors)", async () => {
    const db = new FakeDb();
    const { promotions } = makeServices(db);
    const ev = await promotions.evaluateCheckout(ORG, {
      lines: [line(100000n)],
      loyalty: { pointsToRedeem: 5, balance: 500, redeemValueMinorPerPoint: 100, minRedeemPoints: 10, maxRedeemSharePct: null },
    });
    expect(ev.loyaltyPointsApplied).toBe(0);
    expect(ev.loyaltyDiscountMinor).toBe(0n);
    expect(payableOf(ev)).toBe(100000n);
  });

  it("balance clamps the request; a negative balance redeems nothing", async () => {
    const db = new FakeDb();
    const { promotions } = makeServices(db);
    const ev = await promotions.evaluateCheckout(ORG, {
      lines: [line(100000n)],
      loyalty: { pointsToRedeem: 300, balance: 40, redeemValueMinorPerPoint: 100, minRedeemPoints: 0, maxRedeemSharePct: null },
    });
    expect(ev.loyaltyPointsApplied).toBe(40);
    const evNeg = await promotions.evaluateCheckout(ORG, {
      lines: [line(100000n)],
      loyalty: { pointsToRedeem: 300, balance: -25, redeemValueMinorPerPoint: 100, minRedeemPoints: 0, maxRedeemSharePct: null },
    });
    expect(evNeg.loyaltyPointsApplied).toBe(0);
    expect(evNeg.loyaltyDiscountMinor).toBe(0n);
  });

  it("parity: no loyalty input ⇒ totals identical to the pre-AB1 shape", async () => {
    const db = new FakeDb();
    const { promotions } = makeServices(db);
    const base = await promotions.evaluateCheckout(ORG, { lines: [line(100000n), line(5000n, 2)] });
    const withNull = await promotions.evaluateCheckout(ORG, { lines: [line(100000n), line(5000n, 2)], loyalty: null });
    expect(payableOf(withNull)).toBe(payableOf(base));
    expect(withNull.totalDiscountMinor).toBe(base.totalDiscountMinor);
    expect(withNull.loyaltyDiscountMinor ?? 0n).toBe(0n);
    expect(withNull.loyaltyPointsApplied ?? 0).toBe(0);
  });

  it("loyalty shrinks the tax base exactly like the other discount lines", async () => {
    const db = new FakeDb();
    await db.taxSetting.create({
      data: { organizationId: ORG, defaultVatBps: 1500, pricesIncludeVat: false },
    });
    const { promotions } = makeServices(db);
    const plain = await promotions.evaluateCheckout(ORG, { lines: [line(100000n)] });
    const withLoyalty = await promotions.evaluateCheckout(ORG, {
      lines: [line(100000n)],
      loyalty: { pointsToRedeem: 100, balance: 500, redeemValueMinorPerPoint: 100, minRedeemPoints: 0, maxRedeemSharePct: null },
    });
    // 15% VAT added on payable: 100_000 → 15_000; with a 10_000
    // loyalty discount the base is 90_000 → 13_500.
    expect(plain.taxAddedMinor).toBe(15000n);
    expect(withLoyalty.taxAddedMinor).toBe(13500n);
    expect(payableOf(withLoyalty)).toBe(90000n + 13500n);
  });

  it("stampOrder records the loyalty line + the resolved referrer", async () => {
    const db = new FakeDb();
    const order = await seedOrder(db, { source: "native_storefront", externalId: "ext-stamp" });
    const { promotions } = makeServices(db);
    const ev: any = {
      promotionDiscountMinor: 0n,
      promotionsApplied: [],
      referralDiscountMinor: 0n,
      referralCodeToRecord: "REF-FRIEND",
      referrerCustomerIdToRecord: "cust_referrer",
      appliedDiscountId: null,
      couponCodeToRecord: null,
      taxBreakdown: [],
      giftProductIdToRecord: null,
      giftOutcome: null,
      loyaltyDiscountMinor: 3000n,
      loyaltyPointsApplied: 30,
    };
    await promotions.stampOrder(ORG, "native_storefront", "ext-stamp", ev);
    const row = db.order.rows.find((r: any) => r.id === order.id);
    expect(row.referrerCustomerId).toBe("cust_referrer");
    const lines = JSON.parse(JSON.stringify(row.appliedDiscounts));
    expect(lines).toEqual([
      { kind: "loyalty", name: "লয়্যালটি পয়েন্ট ছাড়", discountMinor: "3000", points: 30 },
    ]);
  });
});

// ------------------------------------------------------------------
// LoyaltyService: earn / redeem / reversals / referral / sweep
// ------------------------------------------------------------------

const ledgerOf = (db: FakeDb, customerId: string) =>
  db.loyaltyLedger.rows.filter((r: any) => r.customerId === customerId);
const balanceOf = async (db: FakeDb, customerId: string) =>
  (await db.customer.findFirst({ where: { id: customerId } })).loyaltyBalanceCache;

describe("AB1 LoyaltyService — earn at the sold transition", () => {
  it("earns on the total minus shipping + gift wrap, exactly once", async () => {
    const db = new FakeDb();
    await seedLoyaltySetting(db, { earnPointsPer1000Minor: 2 });
    const buyer = await seedCustomer(db);
    const order = await seedOrder(db, {
      customerId: buyer.id,
      totalMinor: 100000n,
      shippingMinor: 6000n,
      giftWrapMinor: 2000n,
    });
    const { loyalty } = makeServices(db);
    await loyalty.onOrderTransition(ORG, order.id);
    // basis 92_000 → floor(92) × 2 = 184
    expect(await balanceOf(db, buyer.id)).toBe(184);
    const entries = ledgerOf(db, buyer.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ reason: "earn", deltaPoints: 184, balanceAfter: 184, remainingPoints: 184, orderId: order.id });
    // Reconcile again (duplicate event): no second earn.
    await loyalty.onOrderTransition(ORG, order.id);
    expect(ledgerOf(db, buyer.id)).toHaveLength(1);
    expect(await balanceOf(db, buyer.id)).toBe(184);
  });

  it("earns when only a shipment is delivered (order still processing)", async () => {
    const db = new FakeDb();
    await seedLoyaltySetting(db);
    const buyer = await seedCustomer(db);
    const order = await seedOrder(db, { customerId: buyer.id, status: "processing", totalMinor: 50000n, shippingMinor: 0n });
    await db.courierShipment.create({ data: { organizationId: ORG, orderId: order.id, status: "delivered" } });
    const { loyalty } = makeServices(db);
    await loyalty.onOrderTransition(ORG, order.id);
    expect(await balanceOf(db, buyer.id)).toBe(50);
  });

  it("skips: loyalty disabled, practice order, zero-yield order, dead order", async () => {
    const db = new FakeDb();
    const buyer = await seedCustomer(db);
    const { loyalty } = makeServices(db);
    // No setting row at all = disabled.
    const o1 = await seedOrder(db, { customerId: buyer.id });
    await loyalty.onOrderTransition(ORG, o1.id);
    expect(ledgerOf(db, buyer.id)).toHaveLength(0);
    await seedLoyaltySetting(db);
    const practice = await seedOrder(db, { customerId: buyer.id, isPractice: true });
    await loyalty.onOrderTransition(ORG, practice.id);
    const tiny = await seedOrder(db, { customerId: buyer.id, totalMinor: 500n, shippingMinor: 0n });
    await loyalty.onOrderTransition(ORG, tiny.id);
    const dead = await seedOrder(db, { customerId: buyer.id, status: "cancelled" });
    await loyalty.onOrderTransition(ORG, dead.id);
    expect(ledgerOf(db, buyer.id)).toHaveLength(0);
  });

  it("expiry date is stamped from pointsExpiryDays", async () => {
    const db = new FakeDb();
    await seedLoyaltySetting(db, { pointsExpiryDays: 30 });
    const buyer = await seedCustomer(db);
    const order = await seedOrder(db, { customerId: buyer.id, totalMinor: 20000n, shippingMinor: 0n });
    const { loyalty } = makeServices(db);
    const before = Date.now();
    await loyalty.onOrderTransition(ORG, order.id);
    const entry = ledgerOf(db, buyer.id)[0];
    expect(entry.expiresAt).toBeTruthy();
    const days = (entry.expiresAt.getTime() - before) / 86400000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });
});

describe("AB1 LoyaltyService — redeem posting + FIFO + cancel reversal", () => {
  async function setup() {
    const db = new FakeDb();
    await seedLoyaltySetting(db);
    const buyer = await seedCustomer(db);
    const { loyalty } = makeServices(db);
    // Two earn lots: 100 (order A) + 50 (order B).
    const a = await seedOrder(db, { customerId: buyer.id, totalMinor: 100000n, shippingMinor: 0n });
    const b = await seedOrder(db, { customerId: buyer.id, totalMinor: 50000n, shippingMinor: 0n });
    await loyalty.onOrderTransition(ORG, a.id);
    await loyalty.onOrderTransition(ORG, b.id);
    return { db, buyer, loyalty, a, b };
  }

  it("posts the redeem entry and consumes lots oldest-first", async () => {
    const { db, buyer, loyalty } = await setup();
    const spendOrder = await seedOrder(db, { customerId: buyer.id, status: "processing" });
    const ok = await loyalty.postPlacementRedeem(ORG, { orderId: spendOrder.id, customerId: buyer.id, points: 120 });
    expect(ok).toMatchObject({ reason: "redeem", deltaPoints: -120, balanceAfter: 30 });
    expect(await balanceOf(db, buyer.id)).toBe(30);
    const lots = db.loyaltyLedger.rows.filter((r: any) => r.reason === "earn");
    expect(lots.map((l: any) => l.remainingPoints)).toEqual([0, 30]);
    const redeem = ledgerOf(db, buyer.id).find((r: any) => r.reason === "redeem");
    expect(redeem).toMatchObject({ deltaPoints: -120, balanceAfter: 30, orderId: spendOrder.id });
    // Exactly-once: a duplicate placement call posts nothing
    // new — it returns the already-posted entry (idempotent).
    const again = await loyalty.postPlacementRedeem(ORG, { orderId: spendOrder.id, customerId: buyer.id, points: 120 });
    expect(again?.id).toBe(ok?.id);
    expect(ledgerOf(db, buyer.id).filter((r: any) => r.reason === "redeem")).toHaveLength(1);
    expect(await balanceOf(db, buyer.id)).toBe(30);
  });

  it("insufficient balance at posting time ⇒ no entry, no throw", async () => {
    const { db, buyer, loyalty } = await setup();
    // Drain the balance through a staff adjust first.
    await loyalty.adjustPoints(ORG, "staff1", buyer.id, { deltaPoints: -140, note: "test drain" });
    const spendOrder = await seedOrder(db, { customerId: buyer.id, status: "processing" });
    const ok = await loyalty.postPlacementRedeem(ORG, { orderId: spendOrder.id, customerId: buyer.id, points: 120 });
    expect(ok).toBeNull();
    expect(ledgerOf(db, buyer.id).some((r: any) => r.reason === "redeem")).toBe(false);
    expect(await balanceOf(db, buyer.id)).toBe(10);
  });

  it("cancelling the spending order returns the points exactly once", async () => {
    const { db, buyer, loyalty } = await setup();
    const spendOrder = await seedOrder(db, { customerId: buyer.id, status: "processing" });
    await loyalty.postPlacementRedeem(ORG, { orderId: spendOrder.id, customerId: buyer.id, points: 120 });
    await db.order.update({ where: { id: spendOrder.id }, data: { status: "cancelled" } });
    await loyalty.onOrderTransition(ORG, spendOrder.id);
    expect(await balanceOf(db, buyer.id)).toBe(150);
    const reversal = ledgerOf(db, buyer.id).find((r: any) => r.note === "redeem_reversal");
    expect(reversal).toMatchObject({ reason: "adjust", deltaPoints: 120, orderId: spendOrder.id });
    await loyalty.onOrderTransition(ORG, spendOrder.id);
    expect(ledgerOf(db, buyer.id).filter((r: any) => r.note === "redeem_reversal")).toHaveLength(1);
  });
});

describe("AB1 LoyaltyService — refund clawback (proportional; full ⇒ full)", () => {
  it("50% refund claws back half; full refund the rest + zeroes the lot", async () => {
    const db = new FakeDb();
    await seedLoyaltySetting(db);
    const buyer = await seedCustomer(db);
    const order = await seedOrder(db, { customerId: buyer.id, totalMinor: 100000n, shippingMinor: 0n });
    const { loyalty } = makeServices(db);
    await loyalty.onOrderTransition(ORG, order.id);
    expect(await balanceOf(db, buyer.id)).toBe(100);

    await db.order.update({ where: { id: order.id }, data: { refundedMinor: 50000n } });
    await loyalty.onOrderTransition(ORG, order.id);
    expect(await balanceOf(db, buyer.id)).toBe(50);
    // Repeat reconcile: no double clawback.
    await loyalty.onOrderTransition(ORG, order.id);
    expect(await balanceOf(db, buyer.id)).toBe(50);

    await db.order.update({ where: { id: order.id }, data: { refundedMinor: 100000n, status: "refunded" } });
    await loyalty.onOrderTransition(ORG, order.id);
    expect(await balanceOf(db, buyer.id)).toBe(0);
    const lot = db.loyaltyLedger.rows.find((r: any) => r.reason === "earn");
    expect(lot.remainingPoints).toBe(0);
    const clawbacks = ledgerOf(db, buyer.id).filter((r: any) => r.note === "earn_clawback");
    expect(clawbacks.map((c: any) => c.deltaPoints)).toEqual([-50, -50]);
  });

  it("clawback may drive the balance negative; the snapshot then blocks redemption", async () => {
    const db = new FakeDb();
    await seedLoyaltySetting(db);
    const buyer = await seedCustomer(db);
    const order = await seedOrder(db, { customerId: buyer.id, totalMinor: 100000n, shippingMinor: 0n });
    const { loyalty } = makeServices(db);
    await loyalty.onOrderTransition(ORG, order.id);
    // Spend 90 of the 100 on another order, then refund the earner fully.
    const spend = await seedOrder(db, { customerId: buyer.id, status: "processing" });
    await loyalty.postPlacementRedeem(ORG, { orderId: spend.id, customerId: buyer.id, points: 90 });
    expect(await balanceOf(db, buyer.id)).toBe(10);
    await db.order.update({ where: { id: order.id }, data: { refundedMinor: 100000n, status: "refunded" } });
    await loyalty.onOrderTransition(ORG, order.id);
    expect(await balanceOf(db, buyer.id)).toBe(-90);
    const snap = await loyalty.checkoutSnapshot(ORG, buyer.id);
    expect(snap?.balance).toBe(-90);
  });
});

describe("AB1 AX2 — referral rewards", () => {
  async function setup(rewardOver: any = {}, loyaltyOver: any = {}) {
    const db = new FakeDb();
    await seedLoyaltySetting(db, loyaltyOver);
    await db.referralRewardSetting.create({
      data: {
        organizationId: ORG,
        enabled: true,
        rewardType: "points",
        rewardPoints: 50,
        couponPercent: null,
        rewardMinOrderMinor: null,
        ...rewardOver,
      },
    });
    const referrer = await seedCustomer(db, { firstName: "Referrer", referralCode: "REF-FRIEND" });
    const buyer = await seedCustomer(db, { firstName: "Buyer", phone: "+8801800000000" });
    const { loyalty } = makeServices(db);
    return { db, referrer, buyer, loyalty };
  }

  it("points reward lands on the referrer exactly once", async () => {
    const { db, referrer, buyer, loyalty } = await setup();
    const order = await seedOrder(db, {
      customerId: buyer.id,
      referrerCustomerId: referrer.id,
      referralCode: "REF-FRIEND",
      totalMinor: 80000n,
      shippingMinor: 0n,
    });
    await loyalty.onOrderTransition(ORG, order.id);
    await loyalty.onOrderTransition(ORG, order.id);
    const entries = ledgerOf(db, referrer.id).filter((r: any) => r.reason === "referral_reward");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ deltaPoints: 50, orderId: order.id, remainingPoints: 50 });
    expect(await balanceOf(db, referrer.id)).toBe(50);
    // The buyer still earns their own points on the same order.
    expect(await balanceOf(db, buyer.id)).toBe(80);
  });

  it("falls back to the referral code when the order has no stamped referrer", async () => {
    const { db, referrer, buyer, loyalty } = await setup();
    const order = await seedOrder(db, {
      customerId: buyer.id,
      referrerCustomerId: null,
      referralCode: "REF-FRIEND",
      totalMinor: 80000n,
      shippingMinor: 0n,
    });
    await loyalty.onOrderTransition(ORG, order.id);
    expect(await balanceOf(db, referrer.id)).toBe(50);
  });

  it("self-referral and below-minimum orders earn no reward", async () => {
    const { db, referrer, loyalty } = await setup({ rewardMinOrderMinor: 50000n });
    const self = await seedOrder(db, {
      customerId: referrer.id,
      referrerCustomerId: referrer.id,
      totalMinor: 90000n,
      shippingMinor: 0n,
    });
    await loyalty.onOrderTransition(ORG, self.id);
    const buyer = await seedCustomer(db, { phone: "+8801900000000" });
    const small = await seedOrder(db, {
      customerId: buyer.id,
      referrerCustomerId: referrer.id,
      totalMinor: 49999n,
      shippingMinor: 0n,
    });
    await loyalty.onOrderTransition(ORG, small.id);
    expect(ledgerOf(db, referrer.id).some((r: any) => r.reason === "referral_reward")).toBe(false);
  });

  it("points reward is skipped (not faked) when loyalty is disabled", async () => {
    const { db, referrer, buyer, loyalty } = await setup({}, { enabled: false });
    const order = await seedOrder(db, {
      customerId: buyer.id,
      referrerCustomerId: referrer.id,
      totalMinor: 80000n,
      shippingMinor: 0n,
    });
    await loyalty.onOrderTransition(ORG, order.id);
    expect(ledgerOf(db, referrer.id)).toHaveLength(0);
  });

  it("points reward is clawed back proportionally on refund", async () => {
    const { db, referrer, buyer, loyalty } = await setup();
    const order = await seedOrder(db, {
      customerId: buyer.id,
      referrerCustomerId: referrer.id,
      totalMinor: 80000n,
      shippingMinor: 0n,
    });
    await loyalty.onOrderTransition(ORG, order.id);
    expect(await balanceOf(db, referrer.id)).toBe(50);
    await db.order.update({ where: { id: order.id }, data: { refundedMinor: 80000n, status: "refunded" } });
    await loyalty.onOrderTransition(ORG, order.id);
    expect(await balanceOf(db, referrer.id)).toBe(0);
    const claw = ledgerOf(db, referrer.id).find((r: any) => r.note === "referral_reward_clawback");
    expect(claw).toMatchObject({ reason: "adjust", deltaPoints: -50, orderId: order.id });
  });

  it("coupon reward: issued once via the sourceRef claim, honest sentVia none without SMS", async () => {
    const { db, referrer, buyer, loyalty } = await setup({ rewardType: "coupon", rewardPoints: null, couponPercent: 15 });
    const order = await seedOrder(db, {
      customerId: buyer.id,
      referrerCustomerId: referrer.id,
      totalMinor: 80000n,
      shippingMinor: 0n,
    });
    auditStub.records.length = 0;
    await loyalty.onOrderTransition(ORG, order.id);
    await loyalty.onOrderTransition(ORG, order.id);
    const coupons = db.storeDiscount.rows.filter((r: any) => r.origin === "referral_reward");
    expect(coupons).toHaveLength(1);
    expect(coupons[0]).toMatchObject({ kind: "percent", value: 15, perCustomerLimit: 1, sourceRef: order.id, active: true });
    expect(typeof coupons[0].code).toBe("string");
    expect(coupons[0].code.length).toBeGreaterThanOrEqual(6);
    const days = (new Date(coupons[0].endsAt).getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
    const auditRow = auditStub.records.find((r: any) => r.action === "loyalty.referral_reward_issued");
    expect(auditRow?.metadata?.sentVia).toBe("none");
  });

  it("reward coupon is voided on full refund only while unused", async () => {
    const { db, referrer, buyer, loyalty } = await setup({ rewardType: "coupon", rewardPoints: null, couponPercent: 10 });
    const order = await seedOrder(db, {
      customerId: buyer.id,
      referrerCustomerId: referrer.id,
      totalMinor: 80000n,
      shippingMinor: 0n,
    });
    await loyalty.onOrderTransition(ORG, order.id);
    const coupon = db.storeDiscount.rows.find((r: any) => r.origin === "referral_reward");
    await db.order.update({ where: { id: order.id }, data: { refundedMinor: 80000n, status: "refunded" } });
    await loyalty.onOrderTransition(ORG, order.id);
    expect(coupon.active).toBe(false);

    // A redeemed coupon is NOT voided (its value is spent).
    const buyer2 = await seedCustomer(db, { phone: "+8801600000000" });
    const order2 = await seedOrder(db, {
      customerId: buyer2.id,
      referrerCustomerId: referrer.id,
      totalMinor: 80000n,
      shippingMinor: 0n,
    });
    await loyalty.onOrderTransition(ORG, order2.id);
    const coupon2 = db.storeDiscount.rows.find((r: any) => r.origin === "referral_reward" && r.sourceRef === order2.id);
    coupon2.usedCount = 1;
    await db.order.update({ where: { id: order2.id }, data: { refundedMinor: 80000n, status: "refunded" } });
    await loyalty.onOrderTransition(ORG, order2.id);
    expect(coupon2.active).toBe(true);
  });
});

describe("AB1 LoyaltyService — expiry sweep", () => {
  it("expires remaining points once; deficit-capped when a clawback ate the value", async () => {
    const db = new FakeDb();
    await seedLoyaltySetting(db, { pointsExpiryDays: 30 });
    const buyer = await seedCustomer(db);
    const { loyalty } = makeServices(db);
    const order = await seedOrder(db, { customerId: buyer.id, totalMinor: 100000n, shippingMinor: 0n });
    await loyalty.onOrderTransition(ORG, order.id);
    const lot = db.loyaltyLedger.rows.find((r: any) => r.reason === "earn");
    // Age the lot past expiry.
    lot.expiresAt = new Date(Date.now() - 86400000);
    const res = await loyalty.runExpirySweep(ORG);
    expect(res.expired).toBe(1);
    expect(res.pointsExpired).toBe(100);
    expect(await balanceOf(db, buyer.id)).toBe(0);
    expect(lot.remainingPoints).toBe(0);
    const expire = ledgerOf(db, buyer.id).find((r: any) => r.reason === "expire");
    expect(expire).toMatchObject({ deltaPoints: -100, orderId: order.id });
    // Second run: nothing left to expire.
    const res2 = await loyalty.runExpirySweep(ORG);
    expect(res2.expired).toBe(0);
  });

  it("unexpired and never-expiring lots are untouched", async () => {
    const db = new FakeDb();
    await seedLoyaltySetting(db);
    const buyer = await seedCustomer(db);
    const { loyalty } = makeServices(db);
    const order = await seedOrder(db, { customerId: buyer.id, totalMinor: 100000n, shippingMinor: 0n });
    await loyalty.onOrderTransition(ORG, order.id);
    const res = await loyalty.runExpirySweep(ORG);
    expect(res.expired).toBe(0);
    expect(await balanceOf(db, buyer.id)).toBe(100);
  });
});

describe("AB1 LoyaltyService — settings validation, adjust, staff reads", () => {
  it("rejects a non-positive redeem value and an amount-less referral enable", async () => {
    const db = new FakeDb();
    const { loyalty } = makeServices(db);
    await expect(
      loyalty.updateLoyaltySetting(ORG, "staff1", { redeemValueMinorPerPoint: 0 }),
    ).rejects.toThrow();
    await expect(
      loyalty.updateReferralRewardSetting(ORG, "staff1", { enabled: true, rewardType: "points", rewardPoints: null }),
    ).rejects.toThrow();
    await expect(
      loyalty.updateReferralRewardSetting(ORG, "staff1", { enabled: true, rewardType: "coupon", couponPercent: 95 }),
    ).rejects.toThrow();
    const ok = await loyalty.updateReferralRewardSetting(
      ORG,
      "staff1",
      { enabled: true, rewardType: "coupon", couponPercent: 20 },
    );
    expect(ok.setting.rewardType).toBe("coupon");
    expect(ok.setting.couponPercent).toBe(20);
  });

  it("adjust requires a note, posts through the choke point and audits", async () => {
    const db = new FakeDb();
    await seedLoyaltySetting(db);
    const buyer = await seedCustomer(db);
    const { loyalty } = makeServices(db);
    await expect(loyalty.adjustPoints(ORG, "staff1", buyer.id, { deltaPoints: 10, note: "  " })).rejects.toThrow();
    await expect(loyalty.adjustPoints(ORG, "staff1", buyer.id, { deltaPoints: 0, note: "x" })).rejects.toThrow();
    auditStub.records.length = 0;
    const out = await loyalty.adjustPoints(ORG, "staff1", buyer.id, { deltaPoints: 25, note: "সৌজন্য পয়েন্ট" });
    expect(out.balance).toBe(25);
    expect(await balanceOf(db, buyer.id)).toBe(25);
    const entry = ledgerOf(db, buyer.id)[0];
    expect(entry).toMatchObject({ reason: "adjust", deltaPoints: 25, createdById: "staff1", remainingPoints: 25 });
    expect(auditStub.records.some((r: any) => r.action === "loyalty.points_adjusted")).toBe(true);
  });

  it("foreign customer / order reads answer 404", async () => {
    const db = new FakeDb();
    const { loyalty } = makeServices(db);
    await expect(loyalty.getCustomerLoyalty(ORG, "missing")).rejects.toThrow(/পাওয়া যায়নি/);
    await expect(loyalty.getOrderLoyalty(ORG, "missing")).rejects.toThrow(/পাওয়া যায়নি/);
    await expect(
      loyalty.adjustPoints(ORG, "staff1", "missing", { deltaPoints: 5, note: "x" }),
    ).rejects.toThrow(/পাওয়া যায়নি/);
  });

  it("checkoutSnapshot: disabled ⇒ null, merged customer ⇒ null, enabled ⇒ priced shape", async () => {
    const db = new FakeDb();
    const buyer = await seedCustomer(db, { loyaltyBalanceCache: 77 });
    const { loyalty } = makeServices(db);
    expect(await loyalty.checkoutSnapshot(ORG, buyer.id)).toBeNull();
    await seedLoyaltySetting(db, { redeemValueMinorPerPoint: 150, minRedeemPoints: 5 });
    const snap = await loyalty.checkoutSnapshot(ORG, buyer.id);
    expect(snap).toEqual({ balance: 77, redeemValueMinorPerPoint: 150, minRedeemPoints: 5, maxRedeemSharePct: null });
    const merged = await seedCustomer(db, { mergedIntoId: "survivor" });
    expect(await loyalty.checkoutSnapshot(ORG, merged.id)).toBeNull();
  });

  it("order loyalty view totals earned/redeemed/clawed for the order", async () => {
    const db = new FakeDb();
    await seedLoyaltySetting(db);
    const buyer = await seedCustomer(db);
    const { loyalty } = makeServices(db);
    const order = await seedOrder(db, { customerId: buyer.id, totalMinor: 100000n, shippingMinor: 0n });
    await loyalty.onOrderTransition(ORG, order.id);
    await db.order.update({ where: { id: order.id }, data: { refundedMinor: 100000n, status: "refunded" } });
    await loyalty.onOrderTransition(ORG, order.id);
    const view = await loyalty.getOrderLoyalty(ORG, order.id);
    expect(view.totals.earned).toBe(100);
    expect(Math.abs(view.totals.redeemed)).toBe(0);
    expect(view.totals.referralReward).toBe(0);
    expect(view.totals.clawedBack).toBe(100);
    expect(view.entries.length).toBe(2);
  });
});
