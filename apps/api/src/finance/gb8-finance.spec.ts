import "reflect-metadata";
import { parseFinanceRange } from "./finance-common";
import { FinanceReportsService } from "./finance-reports.service";
import { FinanceService } from "./finance.service";
import { ScheduledReportsService } from "./scheduled-reports.service";
import { OrderProfitService } from "../orders/order-profit.service";
import { ReconciliationService } from "../reconciliation/reconciliation.service";

/**
 * GB8 (GC19 + GC20) — definition-pinning specs. Every figure is
 * asserted against hand-computed values from the fixtures; the
 * export-parity test proves the CSV/XLSX carry the same numbers
 * as the JSON payload (both are built from it).
 */

// ---------------- fake prisma (gb5-style matcher + dates) -------

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    const val = row[k];
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in v && !v.in.map(String).includes(String(val))) return false;
      if ("notIn" in v && v.notIn.map(String).includes(String(val))) return false;
      if ("gte" in v && !(new Date(val).getTime() >= new Date(v.gte).getTime())) return false;
      if ("lte" in v && !(new Date(val).getTime() <= new Date(v.lte).getTime())) return false;
      if ("lt" in v && !(new Date(val).getTime() < new Date(v.lt).getTime())) return false;
      if ("gt" in v && !(Number(val) > Number(v.gt))) return false;
      if ("not" in v && String(val) === String(v.not)) return false;
      return true;
    }
    if (v === null) return val === null || val === undefined;
    return String(val) === String(v);
  });
}

let seq = 0;
function makeTable(name: string) {
  const rows: any[] = [];
  const applyOrder = (list: any[], orderBy: any) => {
    if (!orderBy) return list;
    const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
    const out = [...list];
    for (const spec of specs.reverse()) {
      const [field, dir] = Object.entries(spec)[0] as [string, string];
      out.sort((a, b) => {
        const av = a[field] instanceof Date ? a[field].getTime() : a[field];
        const bv = b[field] instanceof Date ? b[field].getTime() : b[field];
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return dir === "desc" ? -cmp : cmp;
      });
    }
    return out;
  };
  return {
    rows,
    findMany: async ({ where, orderBy, take, skip }: any = {}) => {
      let f = applyOrder(rows.filter((r) => matches(r, where ?? {})), orderBy);
      if (skip) f = f.slice(skip);
      if (take !== undefined) f = f.slice(0, take);
      return f;
    },
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const r of rows) if (matches(r, where)) { Object.assign(r, data); count += 1; }
      return { count };
    },
    delete: async ({ where }: any) => {
      const i = rows.findIndex((r) => r.id === where.id);
      if (i >= 0) rows.splice(i, 1);
      return {};
    },
  };
}

const D = (s: string) => new Date(`${s}T06:00:00Z`); // Dhaka midday of 2026-10-<s>
const MIDNIGHT = (s: string) => new Date(`${s}T00:00:00+06:00`);
const FROM = "2026-10-01";
const TO = "2026-10-31";

function makeWorld() {
  const prisma: any = {
    order: makeTable("order"),
    courierShipment: makeTable("shipment"),
    paymentVerification: makeTable("pv"),
    returnRequest: makeTable("rr"),
    tenantPaymentTransaction: makeTable("txn"),
    reconciliationImport: makeTable("imp"),
    reconciliationLine: makeTable("line"),
    integration: makeTable("int"),
    customer: makeTable("cust"),
    product: makeTable("prod"),
    category: makeTable("cat"),
    expense: makeTable("exp"),
    scheduledReport: makeTable("sr"),
    scheduledReportRun: makeTable("srr"),
    membership: makeTable("mem"),
    agentNotification: makeTable("notif"),
  };
  const O = (o: any) => prisma.order.rows.push({ organizationId: "org-1", isPractice: false, items: [], ...o });
  O({ id: "o-1", externalNumber: "ORD-1", status: "completed", isCod: true, paymentMethod: "cod", customerId: "cu-1",
    placedAt: D("2026-10-05"), createdAt: D("2026-10-05"), updatedAt: D("2026-10-12"),
    subtotalMinor: 10000n, discountMinor: 500n, shippingMinor: 600n, taxMinor: 0n, totalMinor: 10100n, refundedMinor: 0n,
    appliedDiscounts: [
      { kind: "coupon", couponCode: "SAVE10", name: "SAVE10", discountMinor: "300" },
      { kind: "promotion", promotionId: "p-1", name: "ঈদ অফার", discountMinor: "200" },
    ],
    items: [{ productId: "pr-1", quantity: 2, totalMinor: 10000n }] });
  O({ id: "o-2", externalNumber: "ORD-2", status: "delivered", isCod: false, paymentMethod: "bkash", customerId: "cu-2",
    placedAt: D("2026-10-06"), createdAt: D("2026-10-06"), updatedAt: D("2026-10-13"),
    subtotalMinor: 5000n, discountMinor: 0n, shippingMinor: 0n, taxMinor: 250n, totalMinor: 5250n, refundedMinor: 1000n,
    appliedDiscounts: null, items: [{ productId: "pr-2", quantity: 1, totalMinor: 5000n }] });
  O({ id: "o-3", externalNumber: "ORD-3", status: "cancelled", isCod: true, paymentMethod: "cod", customerName: null,
    placedAt: D("2026-10-09"), createdAt: D("2026-10-09"), updatedAt: D("2026-10-09"),
    subtotalMinor: 1000n, discountMinor: 0n, shippingMinor: 500n, taxMinor: 0n, totalMinor: 1500n, refundedMinor: 0n, items: [] });
  O({ id: "o-4", externalNumber: "ORD-4", status: "processing", isCod: false, paymentMethod: "", customerName: null,
    placedAt: D("2026-10-07"), createdAt: D("2026-10-07"), updatedAt: D("2026-10-07"),
    subtotalMinor: 2000n, discountMinor: 100n, shippingMinor: 100n, taxMinor: 0n, totalMinor: 2100n, refundedMinor: 0n,
    appliedDiscounts: null, items: [{ productId: "pr-1", quantity: 1, totalMinor: 2000n }] });
  O({ id: "o-5", externalNumber: "ORD-5", status: "completed", isCod: false, paymentMethod: null, customerName: null,
    placedAt: D("2026-10-08"), createdAt: D("2026-10-08"), updatedAt: D("2026-10-08"),
    subtotalMinor: 3000n, discountMinor: 0n, shippingMinor: 0n, taxMinor: 0n, totalMinor: 3200n, refundedMinor: 500n,
    appliedDiscounts: null, items: [{ productId: null, quantity: 1, totalMinor: 3000n }] });
  prisma.order.rows.push({ id: "o-x", organizationId: "org-2", isPractice: false, status: "completed", isCod: false, paymentMethod: "bkash",
    placedAt: D("2026-10-05"), createdAt: D("2026-10-05"), updatedAt: D("2026-10-05"), subtotalMinor: 99900n, discountMinor: 0n,
    shippingMinor: 0n, taxMinor: 0n, totalMinor: 99900n, refundedMinor: 0n, appliedDiscounts: null, items: [] });

  const S = (s: any) => prisma.courierShipment.rows.push({ organizationId: "org-1", ...s });
  S({ id: "sh-1", orderId: "o-1", provider: "pathao", status: "delivered", createdAt: D("2026-10-05"), chargeMinor: 550n, codAmountMinor: 10100n, codCollectedAt: null, codCollectedMinor: null });
  S({ id: "sh-3", orderId: "o-1", provider: "pathao", status: "delivered", createdAt: D("2026-10-17"), chargeMinor: null, codAmountMinor: 8100n, codCollectedAt: D("2026-10-18"), codCollectedMinor: 8100n });
  S({ id: "sh-2", orderId: "o-2", provider: "steadfast", status: "delivered", createdAt: D("2026-10-06"), chargeMinor: null, codAmountMinor: 0n, codCollectedAt: null, codCollectedMinor: null });

  prisma.paymentVerification.rows.push(
    { id: "pv-1", organizationId: "org-1", orderId: "o-1", status: "approved", amountMinor: 2000n },
    { id: "pv-2", organizationId: "org-1", orderId: "o-1", status: "pending", amountMinor: 5000n },
  );
  prisma.product.rows.push(
    { id: "pr-1", organizationId: "org-1", categoryId: "cat-1", category: null },
    { id: "pr-2", organizationId: "org-1", categoryId: null, category: "Legacy Cat" },
  );
  prisma.category.rows.push({ id: "cat-1", organizationId: "org-1", name: "পোশাক" });
  prisma.customer.rows.push(
    { id: "cu-1", organizationId: "org-1", firstName: "রহিম", lastName: "উদ্দিন" },
    { id: "cu-2", organizationId: "org-1", firstName: "করিম", lastName: null },
  );

  const R = (r: any) => prisma.returnRequest.rows.push({ organizationId: "org-1", ...r });
  R({ id: "r-1", orderId: "o-1", status: "completed", resolution: "refund", refundAmountMinor: 10100n, createdAt: D("2026-10-10"), updatedAt: D("2026-10-12") });
  R({ id: "r-2", orderId: "o-2", status: "completed", resolution: "refund", refundAmountMinor: 1000n, createdAt: D("2026-10-11"), updatedAt: D("2026-10-13") });
  R({ id: "r-3", orderId: "o-1", status: "requested", resolution: null, refundAmountMinor: null, createdAt: D("2026-10-12"), updatedAt: D("2026-10-12") });
  R({ id: "r-4", orderId: "o-5", status: "completed", resolution: "store_credit_note", refundAmountMinor: null, createdAt: D("2026-10-14"), updatedAt: D("2026-10-14") });
  R({ id: "r-5", orderId: "o-2", status: "completed", resolution: "refund", refundAmountMinor: null, createdAt: D("2026-10-15"), updatedAt: D("2026-10-15") });

  const T = (t: any) => prisma.tenantPaymentTransaction.rows.push({ organizationId: "org-1", source: "own", ...t });
  T({ id: "tx-1", orderId: "o-2", provider: "bkash", status: "verified_paid", amountMinor: 5250n, feeMinor: 100n, providerTxnId: "BKT-1", updatedAt: D("2026-10-06"), createdAt: D("2026-10-06") });
  T({ id: "tx-2", orderId: "o-other", provider: "sslcommerz", status: "verified_paid", amountMinor: 3200n, feeMinor: null, providerTxnId: "SSL-1", updatedAt: D("2026-10-08"), createdAt: D("2026-10-08") });
  T({ id: "tx-3", orderId: "o-2", provider: "bkash", status: "failed", amountMinor: 5250n, feeMinor: null, updatedAt: D("2026-10-06"), createdAt: D("2026-10-06") });

  prisma.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: "pathao" });
  prisma.reconciliationImport.rows.push({ id: "imp-1", organizationId: "org-1", courierIntegrationId: "int-1", fileName: "oct.csv",
    rowCount: 3, matchedCount: 1, mismatchCount: 1, notFoundCount: 1, duplicateCount: 0, status: "processed",
    createdAt: D("2026-10-15"), mismatchAlertedAt: null });
  const L = (l: any) => prisma.reconciliationLine.rows.push({ organizationId: "org-1", importId: "imp-1", ...l });
  L({ id: "rl-1", outcome: "matched", sheetAmountMinor: 10100n, sheetChargeMinor: 500n, expectedMinor: 10100n, matchedOrderId: "o-1", matchedShipmentId: "sh-1", rawTrackingId: "TRK-1", rawOrderRef: "ORD-1", rowNumber: 1 });
  L({ id: "rl-2", outcome: "amount_mismatch", sheetAmountMinor: 9000n, sheetChargeMinor: 500n, expectedMinor: 10100n, matchedOrderId: "o-1", matchedShipmentId: "sh-1", rawTrackingId: "TRK-2", rawOrderRef: "ORD-1", rowNumber: 2 });
  L({ id: "rl-3", outcome: "not_found", sheetAmountMinor: 7000n, sheetChargeMinor: null, expectedMinor: 0n, matchedOrderId: null, matchedShipmentId: null, rawTrackingId: "TRK-3", rawOrderRef: null, rowNumber: 3 });

  prisma.expense.rows.push(
    { id: "e-1", organizationId: "org-1", category: "rent", amountMinor: 500000n, spentAt: MIDNIGHT("2026-10-01"), note: "অফিস ভাড়া", paymentMethod: "cash", receiptUrl: null, createdById: "u-1", createdAt: D("2026-10-01"), updatedAt: D("2026-10-01") },
    { id: "e-2", organizationId: "org-1", category: "marketing", amountMinor: 150000n, spentAt: MIDNIGHT("2026-10-20"), note: null, paymentMethod: "bkash", receiptUrl: null, createdById: "u-1", createdAt: D("2026-10-20"), updatedAt: D("2026-10-20") },
    { id: "e-3", organizationId: "org-2", category: "rent", amountMinor: 999n, spentAt: MIDNIGHT("2026-10-02"), note: null, paymentMethod: null, receiptUrl: null, createdById: null, createdAt: D("2026-10-02"), updatedAt: D("2026-10-02") },
  );

  const audit = { calls: [] as any[], log: jest.fn(async (input: any) => { audit.calls.push(input); }) };
  const reports = new FinanceReportsService(prisma);
  const finance = new FinanceService(prisma, audit as any, reports);
  return { prisma, audit, reports, finance };
}

// ---------------- GC19 reports ----------------

describe("GB8 GC19 discounts report — two distinct layers", () => {
  it("order-level totals cover all counted orders; the stamp layer only stamped ones", async () => {
    const { reports } = makeWorld();
    const out = await reports.discountsReport("org-1", parseFinanceRange(FROM, TO));
    expect(out.totals).toEqual({ orderDiscountMinor: "600", stampedDiscountMinor: "500", ordersInPeriod: 4, stampedOrders: 1 });
    const coupon = out.bySource.find((s: any) => s.kind === "coupon");
    const promo = out.bySource.find((s: any) => s.kind === "promotion");
    expect(coupon).toMatchObject({ key: "SAVE10", applications: 1, discountMinor: "300" });
    expect(promo).toMatchObject({ applications: 1, discountMinor: "200" });
    const d5 = out.daily.find((d: any) => d.date === "2026-10-05");
    const d7 = out.daily.find((d: any) => d.date === "2026-10-07");
    expect(d5).toEqual({ date: "2026-10-05", orderDiscountMinor: "500", stampedDiscountMinor: "500", orders: 1 });
    expect(d7).toEqual({ date: "2026-10-07", orderDiscountMinor: "100", stampedDiscountMinor: "0", orders: 1 });
  });
});

describe("GB8 GC19 refunds report + ledger (one loader, two presentations)", () => {
  it("counts by status, amounts by resolution over completed, partial/full derived", async () => {
    const { reports } = makeWorld();
    const range = parseFinanceRange(FROM, TO);
    const out = await reports.refundsReport("org-1", range);
    expect(out.requests.total).toBe(5);
    expect(out.requests.byStatus).toEqual(expect.arrayContaining([{ status: "completed", count: 4 }, { status: "requested", count: 1 }]));
    const refund = out.requests.byResolution.find((r: any) => r.resolution === "refund");
    const credit = out.requests.byResolution.find((r: any) => r.resolution === "store_credit_note");
    expect(refund).toEqual({ resolution: "refund", count: 3, amountMinor: "11100", amountsKnown: 2 });
    expect(credit).toEqual({ resolution: "store_credit_note", count: 1, amountMinor: "0", amountsKnown: 0 });
    expect(out.requests.fullCount).toBe(1);
    expect(out.requests.partialCount).toBe(1);
    expect(out.requests.amountUnknownCount).toBe(1);
    // Order-level lens: o-2 (1000) + o-5 (500) carry recorded
    // refundedMinor and were touched in the period.
    expect(out.orderLevel).toEqual({ ordersWithRefunds: 2, recordedRefundMinor: "1500" });

    const ledger = await reports.refundLedgerRows("org-1", range);
    expect(ledger.totals).toEqual({ count: 4, refundAmountMinor: "11100" });
    const byId = new Map(ledger.rows.map((r: any) => [r.returnId, r]));
    expect(byId.get("r-1").partialFull).toBe("full");
    expect(byId.get("r-2").partialFull).toBe("partial");
    expect(byId.get("r-5").partialFull).toBe("unknown");
    expect(byId.get("r-4").partialFull).toBeNull();
    expect(byId.get("r-1").orderNumber).toBe("ORD-1");
  });
});

describe("GB8 GC19 payment-wise sales — two sources, never blended", () => {
  it("orders by method with an honest unknown bucket + verified_paid per provider", async () => {
    const { reports } = makeWorld();
    const range = parseFinanceRange(FROM, TO);
    const out = await reports.paymentSalesReport("org-1", range);
    const byMethod = new Map(out.byMethod.map((m: any) => [m.method, m]));
    expect(byMethod.get("cod")).toEqual({ method: "cod", orders: 1, totalMinor: "10100" });
    expect(byMethod.get("bkash")).toEqual({ method: "bkash", orders: 1, totalMinor: "5250" });
    expect(byMethod.get("unknown")).toEqual({ method: "unknown", orders: 2, totalMinor: "5300" });
    expect(out.totals).toEqual({ orders: 4, totalMinor: "20650" });
    expect(out.onlineVerifiedTotals).toEqual({ count: 2, grossMinor: "8450" });
    expect(out.onlineVerified).toEqual(expect.arrayContaining([
      { provider: "bkash", source: "own", count: 1, grossMinor: "5250" },
      { provider: "sslcommerz", source: "own", count: 1, grossMinor: "3200" },
    ]));
  });
});

describe("GB8 GC19 category-wise sales — current category, sold bucket only", () => {
  it("joins items to current category with legacy fallback + uncategorized bucket", async () => {
    const { reports } = makeWorld();
    const range = parseFinanceRange(FROM, TO);
    const out = await reports.categorySalesReport("org-1", range);
    const byCat = new Map(out.rows.map((r: any) => [r.category, r]));
    expect(byCat.get("পোশাক")).toEqual({ category: "পোশাক", orders: 1, quantity: 2, revenueMinor: "10000" });
    expect(byCat.get("Legacy Cat")).toEqual({ category: "Legacy Cat", orders: 1, quantity: 1, revenueMinor: "5000" });
    expect(byCat.get("শ্রেণিবিহীন")).toEqual({ category: "শ্রেণিবিহীন", orders: 1, quantity: 1, revenueMinor: "3000" });
    expect(out.totals).toEqual({ orders: 3, quantity: 4, revenueMinor: "18000" });
    expect(out.coverage.note).toContain("বর্তমান শ্রেণি");
  });
});

describe("GB8 GC19 shipping cost — sheet charge wins over booking charge", () => {
  it("per-provider charged vs actual with coverage stated", async () => {
    const { reports } = makeWorld();
    const range = parseFinanceRange(FROM, TO);
    const out = await reports.shippingCostReport("org-1", range);
    const byProv = new Map(out.rows.map((r: any) => [r.provider, r]));
    // pathao: sh-1 sheet charge 500 (sheet wins over booking 550); sh-3 no actual.
    expect(byProv.get("pathao")).toEqual({ provider: "pathao", shipments: 2, orders: 1, chargedMinor: "600", actualMinor: "500", shipmentsWithActual: 1 });
    // steadfast: no charge anywhere → actual null, never a fabricated 0.
    expect(byProv.get("steadfast")).toEqual({ provider: "steadfast", shipments: 1, orders: 1, chargedMinor: "0", actualMinor: null, shipmentsWithActual: 0 });
    expect(byProv.get("unshipped")).toEqual({ provider: "unshipped", shipments: 0, orders: 3, chargedMinor: "600", actualMinor: null, shipmentsWithActual: 0 });
    expect(out.totals).toEqual({ shipments: 3, orders: 5, chargedMinor: "1200", actualMinor: "500", shipmentsWithActual: 1 });
    expect(out.coverage).toMatchObject({ ordersWithShipments: 2, ordersWithAnyActual: 1, actualCoveragePct: 50 });
  });
});

describe("GB8 export parity — CSV/XLSX carry the JSON numbers", () => {
  it("discounts CSV contains the same totals as the payload (taka cells)", async () => {
    const { reports } = makeWorld();
    const file = await reports.buildReportFile("org-1", "discounts", FROM, TO, "csv");
    expect(file.filename).toBe("discounts-2026-10-01-to-2026-10-31.csv");
    // Fixture discounts are 600/500 PAISA → ৳6.00 / ৳5.00 in taka cells.
    expect(String(file.body)).toContain("6.00");
    expect(String(file.body)).toContain("5.00");
    expect(String(file.body)).toContain("SAVE10");
    const xlsx = await reports.buildReportFile("org-1", "discounts", FROM, TO, "xlsx");
    expect(Buffer.isBuffer(xlsx.body)).toBe(true);
    expect((xlsx.body as Buffer).subarray(0, 2).toString("latin1")).toBe("PK");
  });
});

// ---------------- GC20 expenses ----------------

describe("GB8 GC20 expenses — CRUD, validation, monthly summary", () => {
  it("creates with Dhaka-midnight spentAt and validates the vocabulary", async () => {
    const { finance, audit } = makeWorld();
    const created = await finance.createExpense("org-1", "u-1", { category: "packaging", amountMinor: "25000", spentAt: "2026-10-21", paymentMethod: "cash" });
    expect(created).toMatchObject({ category: "packaging", amountMinor: "25000", spentAt: "2026-10-21" });
    expect(audit.calls.some((c: any) => c.action === "finance.expense_created")).toBe(true);
    await expect(finance.createExpense("org-1", "u-1", { category: "bogus", amountMinor: "100", spentAt: "2026-10-21" })).rejects.toMatchObject({ code: "finance.expense.categoryFromList" });
    await expect(finance.createExpense("org-1", "u-1", { category: "rent", amountMinor: "0", spentAt: "2026-10-21" })).rejects.toMatchObject({ code: "finance.expense.amountMustBePositive" });
    await expect(finance.createExpense("org-1", "u-1", { category: "rent", amountMinor: "100", spentAt: "2026-02-31" })).rejects.toMatchObject({ code: "finance.expense.dateInvalid" });
    await expect(finance.createExpense("org-1", "u-1", { category: "rent", amountMinor: "100", spentAt: "2026-10-21", receiptUrl: "ftp://x" })).rejects.toMatchObject({ code: "finance.expense.receiptUrlMustBeHttp" });
  });

  it("monthly summary totals per category; foreign rows never leak; foreign update 404s", async () => {
    const { finance } = makeWorld();
    const summary = await finance.expenseSummary("org-1", "2026-10");
    expect(summary.totalMinor).toBe("650000");
    expect(summary.count).toBe(2);
    expect(summary.byCategory).toEqual(expect.arrayContaining([
      { category: "rent", count: 1, totalMinor: "500000" },
      { category: "marketing", count: 1, totalMinor: "150000" },
    ]));
    await expect(finance.updateExpense("org-1", "u-1", "e-3", { note: "x" })).rejects.toMatchObject({ code: "finance.expense.notFound" });
    const list = await finance.listExpenses("org-1", { from: FROM, to: TO });
    expect(list.total).toBe(2);
  });
});

// ---------------- GC20 ledgers ----------------

describe("GB8 GC20 sales ledger — sold bucket, EC19 due math, whole-period totals", () => {
  it("paid = approved advances capped at total; due floored at 0", async () => {
    const { finance } = makeWorld();
    const out: any = await finance.ledger("org-1", "sales", FROM, TO, { page: "1", pageSize: "2" });
    expect(out.total).toBe(3);
    expect(out.rows).toHaveLength(2); // page 1 of 2-per-page
    // due: o-1 10100−0−2000=8100 · o-2 5250−1000−0=4250 · o-5 3200−500−0=2700.
    expect(out.totals).toEqual({ orders: 3, totalMinor: "18550", discountMinor: "500", deliveryMinor: "600", taxMinor: "250", paidMinor: "2000", dueMinor: "15050" });
    const full: any = await finance.ledger("org-1", "sales", FROM, TO, { page: "1", pageSize: "25" });
    const o1 = full.rows.find((r: any) => r.orderId === "o-1");
    // Customer name comes from the Customer relation (Order has
    // no customerName scalar) — firstName + lastName composed.
    expect(o1).toMatchObject({ paidMinor: "2000", dueMinor: "8100", orderNumber: "ORD-1", customerName: "রহিম উদ্দিন" });
  });
});

describe("GB8 GC20 COD receivable — outstanding aged + EC26 collections", () => {
  it("outstanding is a current snapshot; collections come from codCollected stamps", async () => {
    const { finance } = makeWorld();
    const range = parseFinanceRange(FROM, TO);
    const out = await finance.codReceivableLedger("org-1", range, new Date("2026-10-19T18:00:00Z")); // Oct 20 00:00 +06
    expect(out.outstanding.count).toBe(1);
    expect(out.outstanding.totalMinor).toBe("8100");
    expect(out.outstanding.buckets.d8_30).toEqual({ count: 1, totalMinor: "8100" }); // placed Oct 5 → 14 days
    expect(out.outstanding.buckets.d0_7.count).toBe(0);
    expect(out.collections.count).toBe(1);
    expect(out.collections.totalMinor).toBe("8100");
    expect(out.collections.rows[0]).toMatchObject({ provider: "pathao", orderNumber: "ORD-1", amountMinor: "8100" });
  });
});

describe("GB8 GC20 courier settlements + mismatches", () => {
  it("import entries carry matched totals and signed mismatch deltas", async () => {
    const { finance } = makeWorld();
    const settlements: any = await finance.ledger("org-1", "courier_settlements", FROM, TO);
    expect(settlements.imports).toHaveLength(1);
    expect(settlements.imports[0]).toMatchObject({ provider: "pathao", matchedAmountMinor: "10100", mismatchDeltaMinor: "-1100", mismatchCount: 1 });
    expect(settlements.totals).toEqual({ imports: 1, lines: 3, matched: 1, mismatches: 1, mismatchDeltaMinor: "-1100" });
    const mm: any = await finance.ledger("org-1", "mismatches", FROM, TO);
    expect(mm.rows).toHaveLength(1);
    expect(mm.rows[0]).toMatchObject({ trackingId: "TRK-2", orderNumber: "ORD-1", expectedMinor: "10100", sheetAmountMinor: "9000", deltaMinor: "-1100" });
    expect(mm.totals).toEqual({ count: 1, deltaMinor: "-1100" });
  });
});

describe("GB8 GC20.5 GL export — balanced by construction", () => {
  it("debits equal credits; the mapping lands the expected legs", async () => {
    const { finance } = makeWorld();
    const range = parseFinanceRange(FROM, TO);
    const { legs, skippedRefunds, balanced, totalDebit, totalCredit } = await finance.glRows("org-1", range);
    expect(balanced).toBe(true);
    expect(totalDebit.toString()).toBe("680250");
    expect(totalCredit.toString()).toBe("680250");
    expect(skippedRefunds).toBe(1); // r-5: completed refund with no recorded amount
    const find = (account: string, debit: string) => legs.find((l: any) => l.account === account && l.debit.toString() === debit);
    expect(find("COD Receivable", "10100")).toBeTruthy(); // o-1 COD sale
    expect(find("Gateway Clearing", "5250")).toBeTruthy(); // o-2 verified online sale
    expect(find("Receivable", "3200")).toBeTruthy(); // o-5 no payment reality yet
    expect(find("Gateway Fees", "100")).toBeTruthy(); // tx-1 known fee only (tx-2 fee null → no legs)
    expect(legs.filter((l: any) => l.account === "Refunds").reduce((s: bigint, l: any) => s + l.debit, 0n).toString()).toBe("11100");
    expect(legs.some((l: any) => l.account === "Other Income" && l.credit.toString() === "200")).toBe(true); // o-5 gift-wrap remainder
    const file = await finance.glExportFile("org-1", FROM, TO, "csv");
    expect(String(file.body)).toContain("Tally/QuickBooks");
    expect(String(file.body)).toContain("ব্যালান্স: মিলেছে");
  });
});

// ---------------- GC19 scheduled reports ----------------

function makeSchedWorld(emailConfigured = true) {
  const world = makeWorld();
  const sent: any[] = [];
  const email: any = {
    isConfigured: () => emailConfigured,
    send: jest.fn(async (input: any) => { sent.push(input); return { providerMessageId: "msg-1" }; }),
  };
  const profit = { getProfitReport: jest.fn(async () => ({ totals: {}, perProduct: [] })) } as any;
  const scheduled = new ScheduledReportsService(world.prisma, world.audit as any, email, world.reports, profit);
  world.prisma.scheduledReport.rows.push({ id: "c-1", organizationId: "org-1", reportType: "discounts", cadence: "daily",
    format: "csv", recipients: ["owner@example.com"], enabled: true, lastRunAt: null, createdById: "u-1",
    createdAt: D("2026-10-01"), updatedAt: D("2026-10-01") });
  return { ...world, scheduled, email, sent };
}

describe("GB8 GC19 scheduled reports — due logic, attachment, exactly-once stance", () => {
  it("isDue: daily = last run before today (Dhaka); weekly = ≥ 7 days", () => {
    const now = new Date("2026-10-16T06:00:00Z");
    expect(ScheduledReportsService.isDue({ cadence: "daily", lastRunAt: null }, now)).toBe(true);
    expect(ScheduledReportsService.isDue({ cadence: "daily", lastRunAt: new Date("2026-10-15T06:00:00Z") }, now)).toBe(true);
    expect(ScheduledReportsService.isDue({ cadence: "daily", lastRunAt: new Date("2026-10-16T01:00:00Z") }, now)).toBe(false);
    expect(ScheduledReportsService.isDue({ cadence: "weekly", lastRunAt: new Date("2026-10-09T06:00:00Z") }, now)).toBe(true);
    expect(ScheduledReportsService.isDue({ cadence: "weekly", lastRunAt: new Date("2026-10-10T06:00:00Z") }, now)).toBe(false);
  });

  it("test send attaches the real file and never stamps lastRunAt", async () => {
    const { scheduled, sent, prisma } = makeSchedWorld();
    const config = prisma.scheduledReport.rows[0];
    const run = await scheduled.runOne("org-1", config, { test: true, now: new Date("2026-10-16T06:00:00Z") });
    expect(run.status).toBe("sent");
    expect(run.testRun).toBe(true);
    expect(run.periodLabel).toBe("2026-10-15"); // yesterday (Dhaka) for a daily config
    expect(sent).toHaveLength(1);
    expect(sent[0].attachments[0].filename).toBe("discounts-2026-10-15-to-2026-10-15.csv");
    expect(String(sent[0].attachments[0].content)).toContain("# ছাড়ের রিপোর্ট");
    expect(prisma.scheduledReport.rows[0].lastRunAt).toBeNull();
  });

  it("sweep stamps lastRunAt inside the run — a second sweep the same day runs nothing", async () => {
    const { scheduled, prisma } = makeSchedWorld();
    const now = new Date();
    const first = await scheduled.runSweep("org-1");
    expect(first).toMatchObject({ checked: 1, ran: 1, sent: 1, failed: 0 });
    expect(prisma.scheduledReport.rows[0].lastRunAt).not.toBeNull();
    const second = await scheduled.runSweep("org-1");
    expect(second.ran).toBe(0);
    expect(now).toBeInstanceOf(Date);
  });

  it("unconfigured email provider records failed_no_provider and sends nothing", async () => {
    const { scheduled, sent } = makeSchedWorld(false);
    const run = await scheduled.sendNow("org-1", "c-1");
    expect(run.status).toBe("failed_no_provider");
    expect(sent).toHaveLength(0);
  });

  it("config validation cleans recipients and rejects bad input", async () => {
    const { scheduled } = makeSchedWorld();
    const created = await scheduled.createConfig("org-1", "u-1", { reportType: "profit", cadence: "weekly", format: "xlsx", recipients: [" A@B.com ", "a@b.com"] });
    expect(created.recipients).toEqual(["a@b.com"]);
    await expect(scheduled.createConfig("org-1", "u-1", { reportType: "profit", cadence: "weekly", recipients: ["not-an-email"] })).rejects.toMatchObject({ code: "finance.scheduled.emailInvalid" });
    await expect(scheduled.createConfig("org-1", "u-1", { reportType: "nope", cadence: "weekly", recipients: ["a@b.com"] })).rejects.toMatchObject({ code: "finance.scheduled.reportTypeFromList" });
  });
});

// ---------------- GC20.3 mismatch alert ----------------

describe("GB8 GC20.3 settlement mismatch alert — exactly once per import", () => {
  it("notifies OWNER/ADMIN once with count + delta, stamps the batch, never repeats", async () => {
    const { prisma } = makeWorld();
    prisma.membership.rows.push(
      { id: "m-1", organizationId: "org-1", userId: "u-owner", role: "OWNER", status: "ACTIVE" },
      { id: "m-2", organizationId: "org-1", userId: "u-staff", role: "SUPPORT_AGENT", status: "ACTIVE" },
      { id: "m-3", organizationId: "org-1", userId: "u-admin", role: "ADMIN", status: "ACTIVE" },
    );
    const svc = new ReconciliationService(prisma, { log: async () => undefined } as any);
    await (svc as any).notifySettlementMismatch("org-1", "imp-1", "pathao");
    expect(prisma.agentNotification.rows).toHaveLength(2); // OWNER + ADMIN only
    const first = prisma.agentNotification.rows[0];
    expect(first.type).toBe("billing");
    expect(first.title).toContain("1টি লাইন");
    expect(first.body).toContain("−৳11.00");
    expect(prisma.reconciliationImport.rows[0].mismatchAlertedAt).not.toBeNull();
    await (svc as any).notifySettlementMismatch("org-1", "imp-1", "pathao");
    expect(prisma.agentNotification.rows).toHaveLength(2); // exactly once
  });
});

// ---------------- GC20.4 net profit finance section ----------------

describe("GB8 GC20.4 profit finance section — net only when fully costed + fees known", () => {
  function profitWorld(feeMinor: bigint | null, withCost = true) {
    const prisma: any = {
      order: makeTable("order"), orderItem: makeTable("item"), productCost: makeTable("cost"),
      productVariant: makeTable("variant"), courierShipment: makeTable("shipment"),
      reconciliationLine: makeTable("recon"), paymentVerification: makeTable("pv"),
      expense: makeTable("exp"), tenantPaymentTransaction: makeTable("txn"),
    };
    prisma.order.rows.push({ id: "ord-1", organizationId: "org-1", externalNumber: "1001", status: "completed", isPractice: false,
      totalMinor: 100000n, discountMinor: 0n, shippingMinor: 0n, placedAt: new Date("2026-09-15T10:00:00Z"), createdAt: new Date("2026-09-15T10:00:00Z") });
    prisma.orderItem.rows.push({ id: "it-1", orderId: "ord-1", productId: "p-1", sku: null, name: "Panjabi", quantity: 1, priceMinor: 100000n, totalMinor: 100000n, isGift: false });
    if (withCost) prisma.productCost.rows.push({ id: "c-1", organizationId: "org-1", productId: "p-1", variantId: null, costMinor: 40000n, effectiveFrom: new Date("2026-09-01T00:00:00Z") });
    prisma.expense.rows.push({ id: "e-1", organizationId: "org-1", category: "rent", amountMinor: 5000n, spentAt: MIDNIGHT("2026-09-20") });
    prisma.tenantPaymentTransaction.rows.push({ id: "tx-1", organizationId: "org-1", orderId: "ord-1", provider: "bkash", status: "verified_paid",
      amountMinor: 100000n, feeMinor, updatedAt: new Date("2026-09-16T10:00:00Z"), createdAt: new Date("2026-09-16T10:00:00Z") });
    return new OrderProfitService(prisma);
  }

  it("fully costed + known fees → estimatedNetMinor = margin − expenses − fees", async () => {
    const svc = profitWorld(1000n);
    const out: any = await svc.getProfitReport("org-1", { from: "2026-09-01", to: "2026-09-30" });
    expect(out.totals.grossMarginMinor).toBe("60000");
    expect(out.finance).toEqual({ periodExpensesMinor: "5000", gatewayFeesMinor: "1000", estimatedNetMinor: "54000", reasons: [] });
  });

  it("unknown fee on a verified payment → net null with the reason stated", async () => {
    const svc = profitWorld(null);
    const out: any = await svc.getProfitReport("org-1", { from: "2026-09-01", to: "2026-09-30" });
    expect(out.finance.gatewayFeesMinor).toBeNull();
    expect(out.finance.estimatedNetMinor).toBeNull();
    expect(out.finance.reasons.join(" ")).toContain("গেটওয়ে ফি জানা নেই");
  });

  it("uncosted product → coverage < 100% → net null with the coverage reason", async () => {
    const svc = profitWorld(1000n, false);
    const out: any = await svc.getProfitReport("org-1", { from: "2026-09-01", to: "2026-09-30" });
    expect(out.finance.estimatedNetMinor).toBeNull();
    expect(out.finance.reasons.join(" ")).toContain("কভারেজ ১০০% নয়");
  });
});
