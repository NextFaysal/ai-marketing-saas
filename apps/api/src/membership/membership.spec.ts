import "reflect-metadata";
import { ForbiddenException, BadRequestException, NotFoundException } from "@nestjs/common";
import { MembershipService, tierForSpend } from "./membership.service";
import { StoreCreditService, storeCreditApplication } from "./store-credit.service";
import { PriceListsService, pickGroupPrice } from "../commerce/price-lists.service";
import { PromotionsService } from "../commerce/promotions.service";

/**
 * NF7 (FB3) — Membership tiers + store credit specs.
 * Fake-prisma harness in the gamified-promotions.spec pattern
 * (in-memory tables, org-scoped `matches`). The fake
 * StoreCreditEntry table enforces the real (organizationId,
 * sourceRef) unique — a duplicate create throws a P2002-shaped
 * error exactly like Prisma — and CustomerTier enforces the
 * real customerId unique. $transaction runs the callback
 * against the same fake (the services' claim-check-first
 * discipline is what the specs pin).
 */

type Row = Record<string, any>;

function cmp(a: any, b: any): number {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (k === "OR") return (v as any[]).some((sub) => matches(row, sub));
    if (k === "AND") return (v as any[]).every((sub) => matches(row, sub));
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      if ("notIn" in v) return !(v as any).notIn.includes(row[k]);
      if ("not" in v) return row[k] !== (v as any).not;
      if ("lt" in v) return cmp(row[k], (v as any).lt) < 0;
      if ("lte" in v) return cmp(row[k], (v as any).lte) <= 0;
      if ("gt" in v) return cmp(row[k], (v as any).gt) > 0;
      if ("gte" in v) return cmp(row[k], (v as any).gte) >= 0;
      return true;
    }
    if (v instanceof Date) return row[k] instanceof Date && row[k].getTime() === v.getTime();
    return row[k] === v;
  });
}

function sortRows(rows: Row[], orderBy: any): Row[] {
  const specs = (Array.isArray(orderBy) ? orderBy : [orderBy]).filter(Boolean);
  if (!specs.length) return rows;
  return [...rows].sort((a, b) => {
    for (const spec of specs) {
      const [key, dir] = Object.entries(spec)[0] as [string, string];
      const c = cmp(a[key], b[key]);
      if (c !== 0) return dir === "desc" ? -c : c;
    }
    return 0;
  });
}

let seq = 0;
function makeTable(rows: Row[], uniqueKeys: string[][] = []) {
  return {
    rows,
    async findFirst({ where }: any = {}) {
      return rows.find((r) => matches(r, where)) ?? null;
    },
    async findMany({ where, orderBy, take }: any = {}) {
      let out = rows.filter((r) => matches(r, where));
      out = sortRows(out, orderBy);
      if (take) out = out.slice(0, take);
      return out;
    },
    async create({ data }: any) {
      for (const keys of uniqueKeys) {
        if (keys.some((k) => data[k] === null || data[k] === undefined)) continue;
        if (rows.some((r) => keys.every((k) => r[k] === data[k]))) {
          throw new Error("Unique constraint failed on the fields: P2002");
        }
      }
      const row = { id: `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    async update({ where, data }: any) {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("record not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    async updateMany({ where, data }: any) {
      let n = 0;
      for (const r of rows) if (matches(r, where)) { Object.assign(r, data); n++; }
      return { count: n };
    },
    async delete({ where }: any) {
      const i = rows.findIndex((r) => r.id === where.id);
      if (i < 0) throw new Error("record not found");
      rows.splice(i, 1);
      return {};
    },
    async deleteMany({ where }: any) {
      let n = 0;
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) { rows.splice(i, 1); n++; }
      return { count: n };
    },
    async count({ where }: any = {}) {
      return rows.filter((r) => matches(r, where)).length;
    },
  };
}

const ORG = "org-1";
const ORG2 = "org-2";

function setup() {
  const customers: Row[] = [
    { id: "cust-a", organizationId: ORG, firstName: "A", phone: "01710000001", mergedIntoId: null, groupId: null },
    { id: "cust-b", organizationId: ORG, firstName: "B", phone: "01710000002", mergedIntoId: null, groupId: null },
    { id: "cust-x", organizationId: ORG2, firstName: "X", phone: "01710000009", mergedIntoId: null, groupId: null },
  ];
  const orders: Row[] = [];
  const tiers: Row[] = [];
  const customerTiers: Row[] = [];
  const creditEntries: Row[] = [];
  const stores: Row[] = [
    { id: "store-1", organizationId: ORG, name: "Shop", refundPushEnabled: false, refundToCreditEnabled: false },
  ];
  const priceLists: Row[] = [];
  const priceListItems: Row[] = [];
  const products: Row[] = [
    { id: "p-1", organizationId: ORG, name: "শার্ট", priceMinor: 100000n, status: "ACTIVE" },
  ];
  const prisma: any = {
    customer: makeTable(customers),
    order: makeTable(orders),
    tierDefinition: makeTable(tiers),
    customerTier: makeTable(customerTiers, [["customerId"]]),
    storeCreditEntry: makeTable(creditEntries, [["organizationId", "sourceRef"]]),
    store: makeTable(stores),
    priceList: makeTable(priceLists),
    priceListItem: makeTable(priceListItems),
    customerGroup: makeTable([]),
    product: makeTable(products),
    productVariant: makeTable([]),
    courierShipment: makeTable([]),
    promotion: makeTable([]),
    taxSetting: makeTable([]),
    $transaction: async (fn: any) => fn(prisma),
  };
  const audit = { log: jest.fn(async () => undefined) };
  const membership = new MembershipService(prisma as any, audit as any);
  const credit = new StoreCreditService(prisma as any, audit as any, undefined, membership);
  const priceListsSvc = new PriceListsService(prisma as any, audit as any);
  return {
    prisma, audit, membership, credit, priceListsSvc,
    rows: { customers, orders, tiers, customerTiers, creditEntries, stores, priceLists, priceListItems, products },
  };
}

function addOrder(ctx: ReturnType<typeof setup>, partial: Row): Row {
  const row = {
    id: `ord-${ctx.rows.orders.length + 1}`,
    organizationId: ORG,
    customerId: "cust-a",
    storeId: null,
    status: "pending",
    totalMinor: 0n,
    refundedMinor: 0n,
    isPractice: false,
    ...partial,
  };
  ctx.rows.orders.push(row);
  return row;
}

// ---------- (a) tier derivation ----------

describe("NF7 (a) tier derivation from completed/delivered orders only", () => {
  it("tierForSpend picks the highest reached threshold", () => {
    const tiers = [
      { id: "t-silver", minSpendMinor: 100000n, sortOrder: 1 },
      { id: "t-gold", minSpendMinor: 500000n, sortOrder: 2 },
    ];
    expect(tierForSpend(tiers, 0n)).toBeNull();
    expect(tierForSpend(tiers, 99999n)).toBeNull();
    expect(tierForSpend(tiers, 100000n)).toBe("t-silver");
    expect(tierForSpend(tiers, 550000n)).toBe("t-gold");
  });

  it("completed + delivered spend counts; cancelled/pending/returned/refunded never moves a tier", async () => {
    const ctx = setup();
    await ctx.membership.createTier(ORG, "staff-1", { name: "Silver", minSpendMinor: "100000", sortOrder: 1 });
    await ctx.membership.createTier(ORG, "staff-1", { name: "Gold", minSpendMinor: "500000", sortOrder: 2 });
    addOrder(ctx, { status: "completed", totalMinor: 300000n });
    addOrder(ctx, { status: "delivered", totalMinor: 250000n });
    addOrder(ctx, { status: "cancelled", totalMinor: 900000n });
    addOrder(ctx, { status: "pending", totalMinor: 900000n });
    addOrder(ctx, { status: "processing", totalMinor: 900000n });
    addOrder(ctx, { status: "returned", totalMinor: 900000n });
    addOrder(ctx, { status: "refunded", totalMinor: 900000n });
    const view = await ctx.membership.recomputeCustomer(ORG, "cust-a");
    expect(view.lifetimeSpendMinor).toBe("550000");
    expect(view.tierName).toBe("Gold");

    // A customer whose spend is ALL non-sold stays tierless.
    addOrder(ctx, { customerId: "cust-b", status: "cancelled", totalMinor: 999999n });
    addOrder(ctx, { customerId: "cust-b", status: "pending", totalMinor: 999999n });
    const bView = await ctx.membership.recomputeCustomer(ORG, "cust-b");
    expect(bView.lifetimeSpendMinor).toBe("0");
    expect(bView.tierId).toBeNull();
  });

  it("order transition reconciler recomputes the tier when an order completes", async () => {
    const ctx = setup();
    await ctx.membership.createTier(ORG, "staff-1", { name: "Silver", minSpendMinor: "100000" });
    const order = addOrder(ctx, { status: "pending", totalMinor: 150000n });
    await ctx.credit.onOrderTransition(ORG, order.id);
    let ct = ctx.rows.customerTiers.find((r) => r.customerId === "cust-a");
    expect(ct?.tierId).toBeNull();
    order.status = "completed";
    await ctx.credit.onOrderTransition(ORG, order.id);
    ct = ctx.rows.customerTiers.find((r) => r.customerId === "cust-a");
    expect(ct?.lifetimeSpendMinor).toBe(150000n);
    expect(ct?.tierId).toBe(ctx.rows.tiers[0].id);
  });
});

// ---------- tier price-list resolution ----------

describe("NF7 tier pricing through the existing PriceList machinery", () => {
  it("a tier-bound list resolves for tier members via priceMapForCustomer; group list still wins", async () => {
    const ctx = setup();
    const { tier } = await ctx.membership.createTier(ORG, "staff-1", { name: "Gold", minSpendMinor: "500000" });
    await ctx.priceListsSvc.setTierItem(ORG, "staff-1", tier.id, { productId: "p-1", priceMinor: "80000" });
    // cust-a is not yet a member: no tier row → no map.
    expect(await ctx.priceListsSvc.priceMapForCustomer(ORG, "cust-a")).toBeNull();
    // Make cust-a a Gold member by derivation.
    addOrder(ctx, { status: "completed", totalMinor: 600000n });
    await ctx.membership.recomputeCustomer(ORG, "cust-a");
    const map = await ctx.priceListsSvc.priceMapForCustomer(ORG, "cust-a");
    expect(map).not.toBeNull();
    expect(pickGroupPrice(map, "p-1", null)).toBe(80000n);
    // cust-b (no tier) gets nothing.
    expect(await ctx.priceListsSvc.priceMapForCustomer(ORG, "cust-b")).toBeNull();
    // Precedence: a negotiated GROUP list beats the tier list.
    const { group } = await ctx.priceListsSvc.createGroup(ORG, "staff-1", { name: "পাইকারি" });
    ctx.rows.customers[0].groupId = group.id;
    await ctx.priceListsSvc.setItem(ORG, "staff-1", group.id, { productId: "p-1", priceMinor: "70000" });
    const map2 = await ctx.priceListsSvc.priceMapForCustomer(ORG, "cust-a");
    expect(pickGroupPrice(map2, "p-1", null)).toBe(70000n);
  });
});

// ---------- (b) ledger balance math ----------

describe("NF7 (b) ledger balance is derived — grants + debits + reversal", () => {
  it("balance = Σ delta across grant, spend and reversal; balanceAfter stamps follow", async () => {
    const ctx = setup();
    await ctx.credit.grantManual(ORG, "staff-1", "cust-a", { amountMinor: "10000", note: "সদিচ্ছা ক্রেডিট" });
    await ctx.credit.grantManual(ORG, "staff-1", "cust-a", { amountMinor: "5000", note: "ক্ষতিপূরণ" });
    expect((await ctx.credit.balanceFor(ORG, "cust-a")).toString()).toBe("15000");
    const order = addOrder(ctx, { status: "pending", totalMinor: 8000n });
    const spend = await ctx.credit.postPlacementSpend(ORG, { orderId: order.id, customerId: "cust-a", amountMinor: 8000n });
    expect(spend.deltaMinor).toBe(-8000n);
    expect((await ctx.credit.balanceFor(ORG, "cust-a")).toString()).toBe("7000");
    order.status = "cancelled";
    await ctx.credit.onOrderTransition(ORG, order.id);
    expect((await ctx.credit.balanceFor(ORG, "cust-a")).toString()).toBe("15000");
    const entries = ctx.rows.creditEntries.filter((e) => e.customerId === "cust-a");
    expect(entries.map((e) => e.reason)).toEqual(["grant_manual", "grant_manual", "spend", "spend_reversal"]);
    expect(entries.map((e) => e.balanceAfter)).toEqual([10000n, 15000n, 7000n, 15000n]);
    // No mutable balance column exists on the customer row.
    expect((ctx.rows.customers[0] as any).storeCreditBalance).toBeUndefined();
  });

  it("manual grant without a reason is refused and writes nothing", async () => {
    const ctx = setup();
    await expect(ctx.credit.grantManual(ORG, "staff-1", "cust-a", { amountMinor: "1000", note: "  " }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.rows.creditEntries).toHaveLength(0);
  });
});

// ---------- (c) spend cap ----------

describe("NF7 (c) credit spend cap — never above balance or order total", () => {
  it("storeCreditApplication clamps to min(balance, payable, requested)", () => {
    expect(storeCreditApplication(5000n, 3000n, null)).toBe(3000n);
    expect(storeCreditApplication(2000n, 9000n, null)).toBe(2000n);
    expect(storeCreditApplication(10000n, 9000n, 2500n)).toBe(2500n);
    expect(storeCreditApplication(0n, 9000n, null)).toBe(0n);
    expect(storeCreditApplication(5000n, 0n, null)).toBe(0n);
  });

  it("evaluator prices credit after other lines and never above the payable", async () => {
    const ctx = setup();
    const promotions = new PromotionsService(ctx.prisma as any, {} as any);
    const lines = [{ productId: "p-1", categoryId: null, quantity: 1, unitPriceMinor: 40000n, compareAtMinor: null }];
    const ev = await promotions.evaluateCheckout(ORG, {
      lines,
      storeCredit: { customerId: "cust-a", balanceMinor: 999999n },
    } as any);
    expect(ev.storeCreditDiscountMinor).toBe(40000n);
    expect(ev.storeCreditCustomerId).toBe("cust-a");
    expect(ev.totalDiscountMinor).toBe(40000n);
    const ev2 = await promotions.evaluateCheckout(ORG, {
      lines,
      storeCredit: { customerId: "cust-a", balanceMinor: 15000n, requestedMinor: 10000n },
    } as any);
    expect(ev2.storeCreditDiscountMinor).toBe(10000n);
    // No snapshot ⇒ byte-identical pre-NF7 totals.
    const ev3 = await promotions.evaluateCheckout(ORG, { lines } as any);
    expect(ev3.storeCreditDiscountMinor).toBe(0n);
    expect(ev3.totalDiscountMinor).toBe(0n);
  });

  it("postPlacementSpend re-clamps inside the transaction and is exactly-once per order", async () => {
    const ctx = setup();
    await ctx.credit.grantManual(ORG, "staff-1", "cust-a", { amountMinor: "5000", note: "গ্রান্ট" });
    const order = addOrder(ctx, { status: "pending", totalMinor: 3000n });
    // Caller asks for MORE than the order total: only 3000 posts.
    const first = await ctx.credit.postPlacementSpend(ORG, { orderId: order.id, customerId: "cust-a", amountMinor: 99999n });
    expect(first.deltaMinor).toBe(-3000n);
    const again = await ctx.credit.postPlacementSpend(ORG, { orderId: order.id, customerId: "cust-a", amountMinor: 3000n });
    expect(again.id).toBe(first.id);
    expect(ctx.rows.creditEntries.filter((e) => e.reason === "spend")).toHaveLength(1);
    expect((await ctx.credit.balanceFor(ORG, "cust-a")).toString()).toBe("2000");
  });
});

// ---------- (d) refund-to-credit gate ----------

describe("NF7 (d) refund-to-credit — hidden/refused OFF, exactly-once ON", () => {
  it("setting OFF (default): refused with 403, no entry, refundedMinor untouched", async () => {
    const ctx = setup();
    const order = addOrder(ctx, { status: "delivered", totalMinor: 20000n, storeId: "store-1" });
    await expect(ctx.credit.refundToCredit(ORG, "staff-1", order.id, { amountMinor: "5000", refundKey: "rf-1" }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(ctx.rows.creditEntries).toHaveLength(0);
    expect(order.refundedMinor).toBe(0n);
    expect(await ctx.credit.refundToCreditEnabledForOrder(ORG, order)).toBe(false);
  });

  it("setting ON: exactly one credit per refundKey even on retry; refundedMinor moves once", async () => {
    const ctx = setup();
    ctx.rows.stores[0].refundToCreditEnabled = true;
    const order = addOrder(ctx, { status: "delivered", totalMinor: 20000n, storeId: "store-1" });
    const first = await ctx.credit.refundToCredit(ORG, "staff-1", order.id, { amountMinor: "5000", refundKey: "rf-1" });
    expect(first.replayed).toBe(false);
    expect(order.refundedMinor).toBe(5000n);
    expect((await ctx.credit.balanceFor(ORG, "cust-a")).toString()).toBe("5000");
    const retry = await ctx.credit.refundToCredit(ORG, "staff-1", order.id, { amountMinor: "5000", refundKey: "rf-1" });
    expect(retry.replayed).toBe(true);
    expect(retry.entry.id).toBe(first.entry.id);
    expect(ctx.rows.creditEntries.filter((e) => e.reason === "refund_credit")).toHaveLength(1);
    expect(order.refundedMinor).toBe(5000n);
    // A DIFFERENT refundKey is a second, legitimate partial refund.
    await ctx.credit.refundToCredit(ORG, "staff-1", order.id, { amountMinor: "3000", refundKey: "rf-2" });
    expect(order.refundedMinor).toBe(8000n);
    // Beyond the refundable remainder is refused.
    await expect(ctx.credit.refundToCredit(ORG, "staff-1", order.id, { amountMinor: "99999", refundKey: "rf-3" }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it("native order (no store): gate reads any-store opt-in; missing refundKey refused", async () => {
    const ctx = setup();
    const order = addOrder(ctx, { status: "delivered", totalMinor: 10000n, storeId: null });
    await expect(ctx.credit.refundToCredit(ORG, "staff-1", order.id, { amountMinor: "1000", refundKey: "rf-x" }))
      .rejects.toBeInstanceOf(ForbiddenException);
    ctx.rows.stores[0].refundToCreditEnabled = true;
    await expect(ctx.credit.refundToCredit(ORG, "staff-1", order.id, { amountMinor: "1000", refundKey: "" }))
      .rejects.toBeInstanceOf(BadRequestException);
    const ok = await ctx.credit.refundToCredit(ORG, "staff-1", order.id, { amountMinor: "1000", refundKey: "rf-x" });
    expect(ok.entry.reason).toBe("refund_credit");
  });
});

// ---------- (e) org isolation + (f) cross-customer isolation ----------

describe("NF7 (e)+(f) org isolation and cross-customer isolation", () => {
  it("another org's customer is invisible: grant/tier/refund all 404, balances never leak", async () => {
    const ctx = setup();
    await expect(ctx.credit.grantManual(ORG, "staff-1", "cust-x", { amountMinor: "1000", note: "x" }))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(ctx.membership.recomputeCustomer(ORG, "cust-x")).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctx.credit.getCustomerCredit(ORG, "cust-x")).rejects.toBeInstanceOf(NotFoundException);
    // An org-2 order cannot be refunded-to-credit from org-1.
    const foreign = addOrder(ctx, { organizationId: ORG2, customerId: "cust-x", status: "delivered", totalMinor: 5000n });
    await expect(ctx.credit.refundToCredit(ORG, "staff-1", foreign.id, { amountMinor: "1000", refundKey: "rf-f" }))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(ctx.rows.creditEntries).toHaveLength(0);
  });

  it("customer A can never spend or see customer B's credit", async () => {
    const ctx = setup();
    await ctx.credit.grantManual(ORG, "staff-1", "cust-b", { amountMinor: "9000", note: "B-এর ক্রেডিট" });
    // A's snapshot is empty even though B has a balance.
    expect(await ctx.credit.checkoutSnapshot(ORG, "cust-a")).toBeNull();
    const snapB = await ctx.credit.checkoutSnapshot(ORG, "cust-b");
    expect(snapB?.balanceMinor).toBe(9000n);
    // A tries to spend against B's balance via A's own order:
    // postPlacementSpend keys on the ORDER's customer — A's
    // order + B's customerId is refused (returns null, no rows).
    const orderA = addOrder(ctx, { customerId: "cust-a", status: "pending", totalMinor: 5000n });
    const attempt = await ctx.credit.postPlacementSpend(ORG, { orderId: orderA.id, customerId: "cust-b", amountMinor: 5000n });
    expect(attempt).toBeNull();
    expect(ctx.rows.creditEntries.filter((e) => e.reason === "spend")).toHaveLength(0);
    expect((await ctx.credit.balanceFor(ORG, "cust-b")).toString()).toBe("9000");
    // A's own account view contains only A's (empty) history.
    const viewA = await ctx.credit.accountCredit(ORG, ctx.rows.customers[0]);
    expect(viewA.balanceMinor).toBe("0");
    expect(viewA.entries).toHaveLength(0);
    const viewB = await ctx.credit.getCustomerCredit(ORG, "cust-b");
    expect(viewB.balanceMinor).toBe("9000");
    expect(viewB.entries).toHaveLength(1);
  });
});

// ---------- (g) cancellation-before-delivery reversal ----------

describe("NF7 (g) cancellation before delivery reverses the spend exactly once", () => {
  it("cancelled order: compensating entry restores the balance; original debit untouched; idempotent", async () => {
    const ctx = setup();
    await ctx.credit.grantManual(ORG, "staff-1", "cust-a", { amountMinor: "10000", note: "গ্রান্ট" });
    const order = addOrder(ctx, { status: "processing", totalMinor: 10000n });
    await ctx.credit.postPlacementSpend(ORG, { orderId: order.id, customerId: "cust-a", amountMinor: 6000n });
    expect((await ctx.credit.balanceFor(ORG, "cust-a")).toString()).toBe("4000");
    order.status = "cancelled";
    await ctx.credit.onOrderTransition(ORG, order.id);
    await ctx.credit.onOrderTransition(ORG, order.id); // replay
    const entries = ctx.rows.creditEntries.filter((e) => e.orderId === order.id);
    expect(entries.map((e) => e.reason)).toEqual(["spend", "spend_reversal"]);
    expect(entries[0].deltaMinor).toBe(-6000n); // untouched
    expect(entries[1].deltaMinor).toBe(6000n);
    expect((await ctx.credit.balanceFor(ORG, "cust-a")).toString()).toBe("10000");
  });

  it("a DELIVERED order's spend is never reversed by a later transition", async () => {
    const ctx = setup();
    await ctx.credit.grantManual(ORG, "staff-1", "cust-a", { amountMinor: "10000", note: "গ্রান্ট" });
    const order = addOrder(ctx, { status: "delivered", totalMinor: 10000n });
    await ctx.credit.postPlacementSpend(ORG, { orderId: order.id, customerId: "cust-a", amountMinor: 6000n });
    await ctx.credit.onOrderTransition(ORG, order.id);
    expect(ctx.rows.creditEntries.filter((e) => e.reason === "spend_reversal")).toHaveLength(0);
    expect((await ctx.credit.balanceFor(ORG, "cust-a")).toString()).toBe("4000");
  });
});
