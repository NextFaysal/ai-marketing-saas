import "reflect-metadata";
import { AccountingService, ACCOUNTING_DISCLAIMER, DEFAULT_ACCOUNTS } from "./accounting.service";
import { FinanceService } from "../finance/finance.service";
import { FinanceReportsService } from "../finance/finance-reports.service";

/**
 * NF10 (FB4) — Full accounting upgrade specs. Fake-prisma harness
 * in the membership.spec pattern (in-memory tables, org-scoped
 * `matches`, real unique enforcement on ChartAccount
 * (org,code)/(org,systemKey) and JournalEntry
 * (org,sourceType,sourceId) with NULLs distinct — the exact
 * semantics the idempotency design rides).
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
      if ("in" in v) return (v as any).in.map(String).includes(String(row[k]));
      if ("notIn" in v) return !(v as any).notIn.map(String).includes(String(row[k]));
      if ("not" in v) return row[k] !== (v as any).not;
      if ("lt" in v) return cmp(row[k], (v as any).lt) < 0;
      if ("lte" in v) return cmp(row[k], (v as any).lte) <= 0;
      if ("gt" in v) return cmp(row[k], (v as any).gt) > 0;
      if ("gte" in v) return cmp(row[k], (v as any).gte) >= 0;
      return true;
    }
    if (v instanceof Date) return row[k] instanceof Date && row[k].getTime() === v.getTime();
    return String(row[k]) === String(v);
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
    async findMany({ where, orderBy, take, skip }: any = {}) {
      let out = rows.filter((r) => matches(r, where));
      out = sortRows(out, orderBy);
      if (skip) out = out.slice(skip);
      if (take) out = out.slice(0, take);
      return out;
    },
    async create({ data }: any) {
      for (const keys of uniqueKeys) {
        if (keys.some((k) => data[k] === null || data[k] === undefined)) continue;
        if (rows.some((r) => keys.every((k) => String(r[k]) === String(data[k])))) {
          throw new Error("Unique constraint failed on the fields: P2002");
        }
      }
      const row = { id: data.id ?? `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
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
    async count({ where }: any = {}) {
      return rows.filter((r) => matches(r, where)).length;
    },
  };
}

const ORG = "org-1";
const ORG2 = "org-2";
const D = (s: string) => new Date(`${s}T06:00:00Z`); // Dhaka midday

function setup() {
  const rows = {
    chartAccount: [] as Row[], journalEntry: [] as Row[], journalLine: [] as Row[],
    order: [] as Row[], orderItem: [] as Row[], productCost: [] as Row[],
    paymentVerification: [] as Row[], expense: [] as Row[], courierShipment: [] as Row[],
    reconciliationImport: [] as Row[], reconciliationLine: [] as Row[],
    taxSetting: [] as Row[], organization: [{ id: ORG, name: "Test Shop" }] as Row[],
  };
  const prisma: any = {
    chartAccount: makeTable(rows.chartAccount, [["organizationId", "code"], ["organizationId", "systemKey"]]),
    journalEntry: makeTable(rows.journalEntry, [["organizationId", "sourceType", "sourceId"]]),
    journalLine: makeTable(rows.journalLine),
    order: makeTable(rows.order), orderItem: makeTable(rows.orderItem),
    productCost: makeTable(rows.productCost), paymentVerification: makeTable(rows.paymentVerification),
    expense: makeTable(rows.expense), courierShipment: makeTable(rows.courierShipment),
    reconciliationImport: makeTable(rows.reconciliationImport), reconciliationLine: makeTable(rows.reconciliationLine),
    taxSetting: makeTable(rows.taxSetting), organization: makeTable(rows.organization),
    $transaction: async (fn: any) => fn(prisma),
  };
  const audit = { log: jest.fn(async () => undefined) };
  const svc = new AccountingService(prisma as any, audit as any);
  return { prisma, audit, svc, rows };
}

async function accountId(ctx: ReturnType<typeof setup>, org: string, key: string): Promise<string> {
  const { items } = await ctx.svc.listAccounts(org);
  const found = items.find((a: any) => a.systemKey === key);
  if (!found) throw new Error(`no account ${key}`);
  return found.id;
}

function addOrder(ctx: ReturnType<typeof setup>, partial: Row): Row {
  const row = {
    id: `ord-${ctx.rows.order.length + 1}`, organizationId: ORG, isPractice: false,
    status: "completed", totalMinor: 0n, subtotalMinor: 0n, shippingMinor: 0n, taxMinor: 0n,
    discountMinor: 0n, refundedMinor: 0n, externalNumber: "ORD-X",
    placedAt: D("2026-10-05"), createdAt: D("2026-10-05"), ...partial,
  };
  ctx.rows.order.push(row);
  return row;
}

describe("NF10 (a) chart of accounts — lazy seeding + system rules", () => {
  it("seeds the BD-retail defaults lazily and idempotently", async () => {
    const ctx = setup();
    const first = await ctx.svc.listAccounts(ORG);
    expect(first.items.length).toBe(DEFAULT_ACCOUNTS.length);
    expect(first.items.every((a: any) => a.isSystem)).toBe(true);
    expect(first.items.map((a: any) => a.systemKey)).toEqual(expect.arrayContaining(["cash", "bkash", "bank", "sales_revenue", "delivery_income", "cogs", "courier_charges", "vat_payable", "owner_equity", "accounts_receivable", "accounts_payable"]));
    const second = await ctx.svc.listAccounts(ORG);
    expect(second.items.length).toBe(DEFAULT_ACCOUNTS.length);
    expect(ctx.rows.chartAccount.length).toBe(DEFAULT_ACCOUNTS.length);
  });

  it("system accounts: rename allowed, retype + delete refused; custom accounts deletable", async () => {
    const ctx = setup();
    const cashId = await accountId(ctx, ORG, "cash");
    const renamed = await ctx.svc.updateAccount(ORG, "u1", cashId, { name: "নগদ টাকা" });
    expect(renamed.account.name).toBe("নগদ টাকা");
    await expect(ctx.svc.updateAccount(ORG, "u1", cashId, { type: "liability" })).rejects.toThrow();
    await expect(ctx.svc.deleteAccount(ORG, "u1", cashId)).rejects.toThrow();
    const custom = await ctx.svc.createAccount(ORG, "u1", { code: "9000", name: "Petty Cash Reserve", type: "asset" });
    await expect(ctx.svc.createAccount(ORG, "u1", { code: "9000", name: "Dup", type: "asset" })).rejects.toThrow();
    await expect(ctx.svc.deleteAccount(ORG, "u1", custom.account.id)).resolves.toEqual({ deleted: true });
  });

  it("accounts are org-isolated: org-2 seeding never touches org-1", async () => {
    const ctx = setup();
    await ctx.svc.listAccounts(ORG);
    await ctx.svc.listAccounts(ORG2);
    expect(ctx.rows.chartAccount.filter((a) => a.organizationId === ORG).length).toBe(DEFAULT_ACCOUNTS.length);
    expect(ctx.rows.chartAccount.filter((a) => a.organizationId === ORG2).length).toBe(DEFAULT_ACCOUNTS.length);
    const foreignId = ctx.rows.chartAccount.find((a) => a.organizationId === ORG2)!.id;
    await expect(ctx.svc.updateAccount(ORG, "u1", foreignId, { name: "হ্যাক" })).rejects.toThrow();
  });
});

describe("NF10 (b) journal balance invariant — unbalanced can NEVER be saved", () => {
  it("a balanced manual entry saves with equal totals", async () => {
    const ctx = setup();
    const cash = await accountId(ctx, ORG, "cash");
    const equity = await accountId(ctx, ORG, "owner_equity");
    const { entry } = await ctx.svc.createManualEntry(ORG, "u1", {
      date: "2026-10-01", memo: "মূলধন",
      lines: [
        { accountId: cash, debitMinor: "100000", creditMinor: "0" },
        { accountId: equity, debitMinor: "0", creditMinor: "100000" },
      ],
    });
    expect(entry.totalDebitMinor).toBe("100000");
    expect(entry.totalCreditMinor).toBe("100000");
    expect(ctx.rows.journalEntry.length).toBe(1);
    expect(ctx.rows.journalLine.length).toBe(2);
  });

  it("unbalanced, single-line, zero and both-sided entries are ALL rejected with nothing saved", async () => {
    const ctx = setup();
    const cash = await accountId(ctx, ORG, "cash");
    const equity = await accountId(ctx, ORG, "owner_equity");
    const attempt = (lines: any[]) => ctx.svc.createManualEntry(ORG, "u1", { date: "2026-10-01", lines });
    await expect(attempt([
      { accountId: cash, debitMinor: "1000", creditMinor: "0" },
      { accountId: equity, debitMinor: "0", creditMinor: "900" },
    ])).rejects.toThrow(/ব্যালান্স/);
    await expect(attempt([{ accountId: cash, debitMinor: "1000", creditMinor: "0" }])).rejects.toThrow();
    await expect(attempt([
      { accountId: cash, debitMinor: "0", creditMinor: "0" },
      { accountId: equity, debitMinor: "0", creditMinor: "0" },
    ])).rejects.toThrow();
    await expect(attempt([
      { accountId: cash, debitMinor: "1000", creditMinor: "1000" },
      { accountId: equity, debitMinor: "0", creditMinor: "1000" },
    ])).rejects.toThrow();
    expect(ctx.rows.journalEntry.length).toBe(0);
    expect(ctx.rows.journalLine.length).toBe(0);
  });

  it("a manual entry naming another org's account is rejected, nothing saved", async () => {
    const ctx = setup();
    await ctx.svc.listAccounts(ORG2);
    const foreign = ctx.rows.chartAccount.find((a) => a.organizationId === ORG2 && a.systemKey === "cash")!;
    const mine = await accountId(ctx, ORG, "owner_equity");
    await expect(ctx.svc.createManualEntry(ORG, "u1", {
      date: "2026-10-01",
      lines: [
        { accountId: String(foreign.id), debitMinor: "500", creditMinor: "0" },
        { accountId: mine, debitMinor: "0", creditMinor: "500" },
      ],
    })).rejects.toThrow();
    expect(ctx.rows.journalEntry.filter((e) => e.organizationId === ORG).length).toBe(0);
  });
});

describe("NF10 (c) auto-entries — revenue / payments / idempotency", () => {
  function seedOrderWithCost(ctx: ReturnType<typeof setup>) {
    const order = addOrder(ctx, {
      id: "ord-1", externalNumber: "ORD-1", status: "completed",
      subtotalMinor: 10000n, discountMinor: 0n, shippingMinor: 600n, taxMinor: 500n, totalMinor: 11100n,
    });
    ctx.rows.orderItem.push({ id: "oi-1", orderId: "ord-1", productId: "p-1", quantity: 2, priceMinor: 5000n, totalMinor: 10000n });
    ctx.rows.productCost.push({ id: "pc-1", productId: "p-1", variantId: null, costMinor: 3000n, effectiveFrom: D("2026-09-01") });
    return order;
  }

  it("completed order → Dr AR total, Cr Sales net / Delivery / VAT, plus COGS Dr / Inventory Cr from real ProductCost", async () => {
    const ctx = setup();
    seedOrderWithCost(ctx);
    const r = await ctx.svc.syncAutoEntries(ORG);
    expect(r.ordersCreated).toBe(1);
    expect(r.cogsMissingOrders).toBe(0);
    const entry = ctx.rows.journalEntry.find((e) => e.sourceType === "order" && e.sourceId === "ord-1")!;
    const lines = ctx.rows.journalLine.filter((l) => l.entryId === entry.id);
    const ids: Record<string, string> = {};
    for (const key of ["accounts_receivable", "sales_revenue", "delivery_income", "vat_payable", "cogs", "inventory"]) {
      ids[key] = await accountId(ctx, ORG, key);
    }
    const byKey = (key: string) => lines.find((l) => l.accountId === ids[key]);
    expect(byKey("accounts_receivable")?.debitMinor).toBe(11100n);
    expect(byKey("sales_revenue")?.creditMinor).toBe(10000n);
    expect(byKey("delivery_income")?.creditMinor).toBe(600n);
    expect(byKey("vat_payable")?.creditMinor).toBe(500n);
    expect(byKey("cogs")?.debitMinor).toBe(6000n); // 2 × 3000 real cost
    expect(byKey("inventory")?.creditMinor).toBe(6000n);
    const dr = lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
    const cr = lines.reduce((s, l) => s + BigInt(l.creditMinor), 0n);
    expect(dr).toBe(cr);
  });

  it("generate twice → exactly one entry per source (idempotent)", async () => {
    const ctx = setup();
    seedOrderWithCost(ctx);
    await ctx.svc.syncAutoEntries(ORG);
    const again = await ctx.svc.syncAutoEntries(ORG);
    expect(again.ordersCreated).toBe(0);
    expect(ctx.rows.journalEntry.filter((e) => e.sourceType === "order").length).toBe(1);
  });

  it("pending / processing / cancelled orders create NO revenue entry", async () => {
    const ctx = setup();
    addOrder(ctx, { id: "o-p", status: "pending", totalMinor: 5000n });
    addOrder(ctx, { id: "o-pr", status: "processing", totalMinor: 5000n });
    addOrder(ctx, { id: "o-c", status: "cancelled", totalMinor: 5000n });
    addOrder(ctx, { id: "o-d", status: "delivered", totalMinor: 5000n });
    const r = await ctx.svc.syncAutoEntries(ORG);
    expect(r.ordersCreated).toBe(1);
    expect(ctx.rows.journalEntry.map((e) => e.sourceId)).toEqual(["o-d"]);
  });

  it("only APPROVED payment verifications settle AR (Dr by provider); pending/rejected create none", async () => {
    const ctx = setup();
    ctx.rows.paymentVerification.push(
      { id: "pv-1", organizationId: ORG, orderId: "ord-1", status: "approved", provider: "bkash", amountMinor: 5000n, trxId: "T1", createdAt: D("2026-10-06") },
      { id: "pv-2", organizationId: ORG, orderId: "ord-1", status: "pending", provider: "bkash", amountMinor: 7000n, trxId: "T2", createdAt: D("2026-10-06") },
      { id: "pv-3", organizationId: ORG, orderId: "ord-1", status: "rejected", provider: "bank", amountMinor: 9000n, trxId: "T3", createdAt: D("2026-10-06") },
      { id: "pv-4", organizationId: ORG2, orderId: "ord-9", status: "approved", provider: "bkash", amountMinor: 1000n, trxId: "T4", createdAt: D("2026-10-06") },
    );
    const r = await ctx.svc.syncAutoEntries(ORG);
    expect(r.paymentsCreated).toBe(1);
    const entry = ctx.rows.journalEntry.find((e) => e.sourceType === "payment")!;
    const lines = ctx.rows.journalLine.filter((l) => l.entryId === entry.id);
    const bkash = await accountId(ctx, ORG, "bkash");
    const ar = await accountId(ctx, ORG, "accounts_receivable");
    expect(lines.find((l) => l.accountId === bkash)?.debitMinor).toBe(5000n);
    expect(lines.find((l) => l.accountId === ar)?.creditMinor).toBe(5000n);
  });

  it("COGS omitted + gap counted when cost absent; P&L shows the gap and the disclaimer", async () => {
    const ctx = setup();
    addOrder(ctx, { id: "ord-nc", status: "completed", subtotalMinor: 8000n, totalMinor: 8000n });
    ctx.rows.orderItem.push({ id: "oi-nc", orderId: "ord-nc", productId: "p-nocost", quantity: 1, priceMinor: 8000n, totalMinor: 8000n });
    const r = await ctx.svc.syncAutoEntries(ORG);
    expect(r.cogsMissingOrders).toBe(1);
    const entry = ctx.rows.journalEntry.find((e) => e.sourceId === "ord-nc")!;
    const cogsId = await accountId(ctx, ORG, "cogs");
    expect(ctx.rows.journalLine.filter((l) => l.entryId === entry.id && l.accountId === cogsId).length).toBe(0);
    const pnl = await ctx.svc.profitAndLoss(ORG, "2026-10");
    expect(pnl.cogsMissingOrders).toBe(1);
    expect(pnl.totals.cogsMinor).toBe("0");
    expect(pnl.totals.totalIncomeMinor).toBe("8000");
    expect(pnl.totals.netProfitMinor).toBe("8000");
    expect(pnl.disclaimer).toBe(ACCOUNTING_DISCLAIMER);
    expect(pnl.disclaimer).toBe("এটি একটি হিসাব-সহায়ক টুল — অডিট করা বা বিধিবদ্ধ হিসাব নয়।");
  });
});

describe("NF10 (d) expenses + courier charges", () => {
  it("existing expenses backfill via sync; a NEW expense via FinanceService.createExpense is journal-backed immediately", async () => {
    const ctx = setup();
    ctx.rows.expense.push({ id: "exp-1", organizationId: ORG, category: "rent", amountMinor: 20000n, spentAt: D("2026-10-03"), paymentMethod: "bank", note: null });
    const r = await ctx.svc.syncAutoEntries(ORG);
    expect(r.expensesCreated).toBe(1);
    const entry = ctx.rows.journalEntry.find((e) => e.sourceType === "expense" && e.sourceId === "exp-1")!;
    const lines = ctx.rows.journalLine.filter((l) => l.entryId === entry.id);
    const rentId = await accountId(ctx, ORG, "expense_rent");
    const bankId = await accountId(ctx, ORG, "bank");
    expect(lines.find((l) => l.accountId === rentId)?.debitMinor).toBe(20000n);
    expect(lines.find((l) => l.accountId === bankId)?.creditMinor).toBe(20000n);

    const finance = new FinanceService(ctx.prisma as any, ctx.audit as any, new FinanceReportsService(ctx.prisma as any), ctx.svc as any);
    const created = await finance.createExpense(ORG, "u1", { category: "salary", amountMinor: "15000", spentAt: "2026-10-10", paymentMethod: "cash" });
    const hookEntry = ctx.rows.journalEntry.find((e) => e.sourceType === "expense" && e.sourceId === created.id);
    expect(hookEntry).toBeTruthy();
    // And the sync does not duplicate the hooked entry.
    const again = await ctx.svc.syncAutoEntries(ORG);
    expect(again.expensesCreated).toBe(0);
  });

  it("courier charge: booking chargeMinor is used, the settlement-sheet charge wins, no charge → no entry", async () => {
    const ctx = setup();
    ctx.rows.courierShipment.push(
      { id: "sh-1", organizationId: ORG, orderId: "ord-1", provider: "steadfast", trackingCode: "TRK1", chargeMinor: 7000n, createdAt: D("2026-10-04") },
      { id: "sh-2", organizationId: ORG, orderId: "ord-2", provider: "pathao", trackingCode: "TRK2", chargeMinor: 6000n, createdAt: D("2026-10-04") },
      { id: "sh-3", organizationId: ORG, orderId: "ord-3", provider: "redx", trackingCode: "TRK3", chargeMinor: null, createdAt: D("2026-10-04") },
    );
    ctx.rows.reconciliationLine.push({ id: "rl-1", importId: "imp-1", organizationId: ORG, rowNumber: 1, matchedShipmentId: "sh-2", sheetChargeMinor: 6500n, sheetAmountMinor: 10000n, outcome: "matched" });
    const r = await ctx.svc.syncAutoEntries(ORG);
    expect(r.courierCreated).toBe(2);
    const courierAcc = await accountId(ctx, ORG, "courier_charges");
    const amountFor = (sid: string) => {
      const e = ctx.rows.journalEntry.find((x) => x.sourceType === "courier_charge" && x.sourceId === sid);
      if (!e) return null;
      return ctx.rows.journalLine.find((l) => l.entryId === e.id && l.accountId === courierAcc)?.debitMinor;
    };
    expect(amountFor("sh-1")).toBe(7000n);
    expect(amountFor("sh-2")).toBe(6500n); // sheet charge preferred over booking 6000
    expect(amountFor("sh-3")).toBeNull();
  });
});

describe("NF10 (e) P&L + VAT from the journal only", () => {
  it("P&L = income − COGS − expenses, all from journal lines", async () => {
    const ctx = setup();
    addOrder(ctx, { id: "ord-1", status: "delivered", subtotalMinor: 10000n, shippingMinor: 600n, taxMinor: 0n, totalMinor: 10600n });
    ctx.rows.orderItem.push({ id: "oi-1", orderId: "ord-1", productId: "p-1", quantity: 1, priceMinor: 10000n, totalMinor: 10000n });
    ctx.rows.productCost.push({ id: "pc-1", productId: "p-1", variantId: null, costMinor: 4000n, effectiveFrom: D("2026-09-01") });
    ctx.rows.expense.push({ id: "exp-1", organizationId: ORG, category: "marketing", amountMinor: 1500n, spentAt: D("2026-10-08"), paymentMethod: "cash", note: null });
    const pnl = await ctx.svc.profitAndLoss(ORG, "2026-10");
    expect(pnl.totals.totalIncomeMinor).toBe("10600"); // 10000 sales + 600 delivery
    expect(pnl.totals.cogsMinor).toBe("4000");
    expect(pnl.totals.grossProfitMinor).toBe("6600");
    expect(pnl.totals.totalExpensesMinor).toBe("1500");
    expect(pnl.totals.netProfitMinor).toBe("5100");
  });

  it("VAT summary reads the TaxSetting rate when configured, and never invents one when not", async () => {
    const ctx = setup();
    addOrder(ctx, { id: "ord-1", status: "completed", subtotalMinor: 10000n, taxMinor: 1500n, totalMinor: 11500n });
    ctx.rows.orderItem.push({ id: "oi-1", orderId: "ord-1", productId: "p-1", quantity: 1, priceMinor: 10000n, totalMinor: 10000n });
    ctx.rows.productCost.push({ id: "pc-1", productId: "p-1", variantId: null, costMinor: 1000n, effectiveFrom: D("2026-09-01") });
    const noRate = await ctx.svc.vatSummary(ORG, "2026-10");
    expect(noRate.vatRateBps).toBeNull();
    expect(noRate.collectedMinor).toBe("1500");
    expect(noRate.balanceMinor).toBe("1500");
    expect(noRate.disclaimer).toBe(ACCOUNTING_DISCLAIMER);
    ctx.rows.taxSetting.push({ id: "ts-1", organizationId: ORG, defaultVatBps: 1500, pricesIncludeVat: true });
    const withRate = await ctx.svc.vatSummary(ORG, "2026-10");
    expect(withRate.vatRateBps).toBe(1500);
    expect(withRate.collectedMinor).toBe("1500");
  });

  it("PDF reports build through the existing courier/pdf machinery", async () => {
    const ctx = setup();
    addOrder(ctx, { id: "ord-1", status: "completed", subtotalMinor: 5000n, totalMinor: 5000n });
    const pnlPdf = await ctx.svc.buildReportPdf(ORG, "pnl", "2026-10");
    const vatPdf = await ctx.svc.buildReportPdf(ORG, "vat", "2026-10");
    expect(pnlPdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(vatPdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pnlPdf.length).toBeGreaterThan(500);
  });
});

describe("NF10 (f) statement import + human-confirmed matching", () => {
  const CSV = [
    "Date,Description,Amount",
    "2026-10-06,Order payment received,50.00",
    "2026-10-07,Shop rent,-200.00",
    "2026-10-08,Unknown transfer,999.00",
  ].join("\n");

  async function seedPaymentAndImport(ctx: ReturnType<typeof setup>) {
    ctx.rows.paymentVerification.push({ id: "pv-1", organizationId: ORG, orderId: "ord-1", status: "approved", provider: "bkash", amountMinor: 5000n, trxId: "T1", createdAt: D("2026-10-06") });
    await ctx.svc.syncAutoEntries(ORG); // creates the payment journal entry the matcher can suggest
    return ctx.svc.importStatement(ORG, "u1", {
      csvText: CSV, fileName: "bkash-oct.csv", accountLabel: "bKash 017…",
      mapping: { dateColumn: "Date", descriptionColumn: "Description", amountColumn: "Amount" },
    });
  }

  it("import creates lines on the EXISTING reconciliation tables; matches are SUGGESTED, never auto-confirmed", async () => {
    const ctx = setup();
    const res = await seedPaymentAndImport(ctx);
    expect(res.counts.rowCount).toBe(3);
    expect(ctx.rows.reconciliationImport.length).toBe(1);
    expect(ctx.rows.reconciliationImport[0].kind).toBe("bank_statement");
    expect(ctx.rows.reconciliationImport[0].courierIntegrationId).toBeNull();
    const lines = ctx.rows.reconciliationLine.filter((l) => l.importId === res.import.id);
    expect(lines.length).toBe(3);
    expect(lines.every((l) => l.matchState !== "matched")).toBe(true);
    const first = lines.find((l) => l.rowNumber === 1)!;
    expect(first.matchState).toBe("suggested");
    expect(first.direction).toBe("credit");
    expect(first.sheetAmountMinor).toBe(5000n);
    const rent = lines.find((l) => l.rowNumber === 2)!;
    expect(rent.direction).toBe("debit");
    expect(rent.sheetAmountMinor).toBe(20000n);
  });

  it("a human confirms a suggestion → matched; rejects another → rejected; foreign-org lines are invisible", async () => {
    const ctx = setup();
    const res = await seedPaymentAndImport(ctx);
    const { items } = await ctx.svc.listStatementLines(ORG, res.import.id);
    const first = items[0];
    expect(first.matchState).toBe("suggested");
    const confirmed = await ctx.svc.resolveStatementLine(ORG, "u1", first.id, { action: "confirm" });
    expect(confirmed.line.matchState).toBe("matched");
    expect(confirmed.line.suggestedRefId).toBeTruthy();
    const second = items[1];
    const rejected = await ctx.svc.resolveStatementLine(ORG, "u1", second.id, { action: "reject" });
    expect(rejected.line.matchState).toBe("rejected");
    // Org isolation: org-2 cannot see or resolve org-1's import/lines.
    await expect(ctx.svc.listStatementLines(ORG2, res.import.id)).rejects.toThrow();
    await expect(ctx.svc.resolveStatementLine(ORG2, "u9", first.id, { action: "confirm" })).rejects.toThrow();
    // Re-importing the identical file is refused without force (EC26 dedupe pattern).
    await expect(ctx.svc.importStatement(ORG, "u1", {
      csvText: CSV, mapping: { dateColumn: "Date", amountColumn: "Amount" },
    })).rejects.toThrow(/আগেই import/);
  });
});
