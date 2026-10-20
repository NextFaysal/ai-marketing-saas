import "reflect-metadata";
import {
  ACCOUNT_CODE_BY_NAME,
  AccountingLiteService,
  DEFAULT_ACCOUNTS,
  balanceSheetFrom,
  buildCourierSettlementLines,
  buildExpenseLines,
  buildGatewayFeeLines,
  buildGatewayPaymentLines,
  buildManualPaymentLines,
  buildRefundLines,
  buildSaleLines,
  linesBalance,
  trialBalanceFrom,
  validateManualLines,
} from "./ou7-accounting.service";
import { BankReconService, parseMoneyToMinor, suggestMatchesFor } from "./ou7-bank-recon.service";
import { FinanceReportsService } from "./finance-reports.service";

/**
 * OU7 (accounting-lite) — spec-proven invariants:
 *  - every posting rule balances (debits == credits);
 *  - no source ever double-posts (idempotency key);
 *  - trial balance + balance sheet equal the sum of journal lines;
 *  - a manual entry cannot unbalance (server-side refusal);
 *  - bank matching never auto-confirms (import → unmatched;
 *    suggestions only; a human confirm is the only way to match).
 */

// ---------------- fake prisma (gb8-style) ----------------------

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    const val = row[k];
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in v && !v.in.map(String).includes(String(val))) return false;
      if ("gte" in v && !(new Date(val).getTime() >= new Date(v.gte).getTime())) return false;
      if ("lte" in v && !(new Date(val).getTime() <= new Date(v.lte).getTime())) return false;
      if ("lt" in v && !(new Date(val).getTime() < new Date(v.lt).getTime())) return false;
      return true;
    }
    if (v === null) return val === null || val === undefined;
    return String(val) === String(v);
  });
}

let seq = 0;
function makeTable(name: string) {
  const rows: any[] = [];
  return {
    rows,
    findMany: async ({ where, orderBy, take, skip, select }: any = {}) => {
      let f = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy) {
        const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
        for (const spec of [...specs].reverse()) {
          const [field, dir] = Object.entries(spec)[0] as [string, string];
          f = [...f].sort((a, b) => {
            const av = a[field] instanceof Date ? a[field].getTime() : a[field];
            const bv = b[field] instanceof Date ? b[field].getTime() : b[field];
            const cmp = av < bv ? -1 : av > bv ? 1 : 0;
            return dir === "desc" ? -cmp : cmp;
          });
        }
      }
      if (skip) f = f.slice(skip);
      if (take !== undefined) f = f.slice(0, take);
      if (select) f = f.map((r) => Object.fromEntries(Object.keys(select).map((k) => [k, r[k]])));
      return f;
    },
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => {
      // Emulate the DB unique indexes OU7 relies on.
      if (name === "ou7JournalEntry" && rows.some((r) => r.organizationId === data.organizationId && r.idempotencyKey === data.idempotencyKey)) {
        throw new Error("Unique constraint failed on the fields: (`organizationId`, `idempotencyKey`)");
      }
      if (name === "financeAccount" && rows.some((r) => r.organizationId === data.organizationId && r.code === data.code)) {
        throw new Error("Unique constraint failed on the fields: (`organizationId`, `code`)");
      }
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
  };
}

const D = (s: string) => new Date(`${s}T06:00:00Z`); // Dhaka midday

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
    expense: makeTable("exp"),
    financeAccount: makeTable("acct"),
    ou7JournalEntry: makeTable("ou7JournalEntry"),
    ou7JournalLine: makeTable("jl"),
    bankStatementLine: makeTable("bsl"),
    auditLog: makeTable("audit"),
  };
  const audit: any = { log: async (i: any) => { prisma.auditLog.rows.push({ ...i, id: `a-${++seq}` }); } };
  const reports = new FinanceReportsService(prisma);
  const accounting = new AccountingLiteService(prisma, audit, reports);
  const bank = new BankReconService(prisma, audit);
  return { prisma, accounting, bank };
}

function seedSources(prisma: any) {
  // Sold COD order: subtotal 10000, discount 500, shipping 600, tax 0 → total 10100, remainder 0.
  prisma.order.rows.push({ id: "o-1", organizationId: "org-1", isPractice: false, externalNumber: "ORD-1", status: "completed", isCod: true,
    placedAt: D("2026-10-05"), createdAt: D("2026-10-05"), updatedAt: D("2026-10-06"),
    subtotalMinor: 10000n, discountMinor: 500n, shippingMinor: 600n, taxMinor: 0n, totalMinor: 10100n, refundedMinor: 0n, customerId: null });
  // Verified gateway txn for the same order, with a known fee.
  prisma.tenantPaymentTransaction.rows.push({ id: "tx-1", organizationId: "org-1", orderId: "o-1", provider: "bkash", providerTxnId: "TRX1", status: "verified_paid",
    amountMinor: 10100n, feeMinor: 100n, createdAt: D("2026-10-05"), updatedAt: D("2026-10-05") });
  // Approved manual advance on the same order (cash) — posts separately.
  prisma.paymentVerification.rows.push({ id: "pv-1", organizationId: "org-1", orderId: "o-1", status: "approved", source: "manual_advance", provider: "cash", trxId: null, amountMinor: 1000n, createdAt: D("2026-10-05") });
  // Gateway-deposit verification — must NOT post (would double the txn).
  prisma.paymentVerification.rows.push({ id: "pv-2", organizationId: "org-1", orderId: "o-1", status: "approved", source: "gateway_deposit", provider: "bkash", trxId: "TRX1", amountMinor: 10100n, createdAt: D("2026-10-05") });
  // Matched courier settlement line: sheet 10100.
  prisma.reconciliationImport.rows.push({ id: "imp-1", organizationId: "org-1", courierIntegrationId: "int-1", createdAt: D("2026-10-07"), matchedCount: 1, mismatchCount: 0, rowCount: 1, status: "processed", fileName: "sheet.csv" });
  prisma.reconciliationLine.rows.push({ id: "rl-1", organizationId: "org-1", importId: "imp-1", rowNumber: 1, outcome: "matched", sheetAmountMinor: 10100n, sheetChargeMinor: 200n, expectedMinor: 10100n, matchedOrderId: "o-1", matchedShipmentId: "sh-1", rawTrackingId: "TRK1" });
  // Completed refund with recorded amount.
  prisma.returnRequest.rows.push({ id: "rr-1", organizationId: "org-1", orderId: "o-1", status: "completed", resolution: "refund", refundAmountMinor: 2000n, createdAt: D("2026-10-08"), updatedAt: D("2026-10-09") });
  // Completed refund WITHOUT an amount — unposted with reason.
  prisma.returnRequest.rows.push({ id: "rr-2", organizationId: "org-1", orderId: "o-1", status: "completed", resolution: "refund", refundAmountMinor: null, createdAt: D("2026-10-08"), updatedAt: D("2026-10-09") });
  // Expense (salary — the payroll-lite category reuses this rule).
  prisma.expense.rows.push({ id: "ex-1", organizationId: "org-1", category: "salary", amountMinor: 50000n, spentAt: D("2026-10-10"), note: "অক্টোবর বেতন", paymentMethod: "bank", createdAt: D("2026-10-10") });
}

const RANGE = { from: "2026-10-01", to: "2026-10-31" };

// ---------------- posting rules balance -------------------------

describe("OU7 posting rules — every rule balances", () => {
  const order = { isCod: true, totalMinor: 10100n, discountMinor: 500n, subtotalMinor: 10000n, shippingMinor: 600n, taxMinor: 200n };
  it("sale balances incl. discount/shipping/tax/remainder legs", () => {
    const lines = buildSaleLines(order);
    expect(linesBalance(lines)).toBe(true);
    const byName = new Map([...ACCOUNT_CODE_BY_NAME.entries()].map(([n, c]) => [c, n]));
    const names = lines.map((l) => byName.get(l.accountCode));
    expect(names).toContain("Sales");
    expect(names).toContain("COD Receivable");
    // total debits: receivable 10100 + discounts 500 + remainder adj.
    // remainder = 10100 − 10000 + 500 − 600 − 200 = −200 → Dr Other Adjustments 200
    const adj = lines.find((l) => byName.get(l.accountCode) === "Other Adjustments");
    expect(adj?.debitMinor).toBe(200n);
  });
  it("gateway payment, manual payment, courier settlement, fee, refund, expense all balance", () => {
    expect(linesBalance(buildGatewayPaymentLines({ amountMinor: 500n }, order))).toBe(true);
    expect(linesBalance(buildManualPaymentLines({ amountMinor: 500n, provider: "bank" }, order))).toBe(true);
    expect(linesBalance(buildCourierSettlementLines({ sheetAmountMinor: 500n }))).toBe(true);
    expect(linesBalance(buildGatewayFeeLines({ feeMinor: 50n }))).toBe(true);
    expect(linesBalance(buildRefundLines({ refundAmountMinor: 500n }, order, true))).toBe(true);
    expect(linesBalance(buildExpenseLines({ amountMinor: 500n, category: "salary" }))).toBe(true);
  });
  it("expense category accounts come from the visible mapping", () => {
    const lines = buildExpenseLines({ amountMinor: 100n, category: "salary" });
    expect(lines[0].accountCode).toBe(ACCOUNT_CODE_BY_NAME.get("Expense: salary"));
  });
});

// ---------------- posting + idempotency + reports ---------------

describe("OU7 posting — derived journal, no double-post, reports = journal sums", () => {
  it("posts each source once; a second run posts nothing new", async () => {
    const { prisma, accounting } = makeWorld();
    seedSources(prisma);
    const first = await accounting.postSources("org-1", "user-1", RANGE.from, RANGE.to);
    // sale, payment_gateway, gateway_fee, payment_manual(pv-1), courier_settlement, refund(rr-1), expense = 7
    expect(first.posted).toBe(7);
    expect(first.alreadyPosted).toBe(0);
    // pv-2 (gateway_deposit) and rr-2 (no amount) stay unposted WITH reasons.
    expect(first.unposted).toHaveLength(2);
    expect(first.unposted.map((u) => u.sourceId).sort()).toEqual(["pv-2", "rr-2"]);
    const second = await accounting.postSources("org-1", "user-1", RANGE.from, RANGE.to);
    expect(second.posted).toBe(0);
    expect(second.alreadyPosted).toBe(7);
    expect(prisma.ou7JournalEntry.rows).toHaveLength(7);
    // Every stored entry balances line-by-line.
    for (const e of prisma.ou7JournalEntry.rows) {
      const lines = prisma.ou7JournalLine.rows.filter((l: any) => l.entryId === e.id);
      expect(linesBalance(lines.map((l: any) => ({ accountCode: l.accountCode, debitMinor: BigInt(l.debitMinor), creditMinor: BigInt(l.creditMinor) })))).toBe(true);
    }
  });

  it("posting status shows posted vs unposted with reasons", async () => {
    const { prisma, accounting } = makeWorld();
    seedSources(prisma);
    const before = await accounting.postingStatus("org-1", RANGE.from, RANGE.to);
    expect(before.totals.posted).toBe(0);
    expect(before.items.find((i: any) => i.sourceId === "pv-2")?.reason).toContain("দ্বিগুণ");
    await accounting.postSources("org-1", "user-1", RANGE.from, RANGE.to);
    const after = await accounting.postingStatus("org-1", RANGE.from, RANGE.to);
    expect(after.totals.posted).toBe(7);
    expect(after.totals.unposted).toBe(2);
  });

  it("trial balance and balance sheet equal the sum of journal lines", async () => {
    const { prisma, accounting } = makeWorld();
    seedSources(prisma);
    await accounting.postSources("org-1", "user-1", RANGE.from, RANGE.to);
    const tb = await accounting.trialBalance("org-1", RANGE.from, RANGE.to);
    expect(tb.balanced).toBe(true);
    const lineDebit = prisma.ou7JournalLine.rows.reduce((s: bigint, l: any) => s + BigInt(l.debitMinor), 0n);
    const lineCredit = prisma.ou7JournalLine.rows.reduce((s: bigint, l: any) => s + BigInt(l.creditMinor), 0n);
    expect(tb.totalDebitMinor).toBe(lineDebit.toString());
    expect(tb.totalCreditMinor).toBe(lineCredit.toString());
    expect(tb.periodState).toBe("open"); // honest: no fake period locking
    const bs = await accounting.balanceSheet("org-1", RANGE.to);
    expect(bs.balanced).toBe(true);
    // Hand-check assets: Gateway Clearing 10100−100(fee)−2000(refund)=8000 Dr;
    // COD Receivable 10100−10100(gateway)−1000(manual)+2000? no — refund credits
    // Gateway Clearing (verified txn exists). COD Receivable: +10100 sale
    // −10100 gateway −1000 manual +10100 settlement credit? Settlement CREDITS
    // COD Receivable too: 10100−10100−1000−10100 = −11100 → balance −11100.
    // Cash: +10100 settlement −50000 expense = −39900. Assets total =
    // 8000 −11100 −39900 = −43000. Income: Sales 10000 + Delivery 600 = 10600;
    // expense: Gateway Fees 100 + Expense: salary 50000 = 50100;
    // contra: Discounts 500 + Refunds 2000 = 2500.
    // Retained = 10600 − 50100 − 2500 = −42000. L+E = Tax 0 + equity 0 + (−42000)
    // plus liabilities 0 → −42000 ≠ −43000? Manual advance Dr Cash 1000 was
    // missed above: Cash = +1000 (manual) +10100 (settlement) −50000 = −38900.
    // Assets = 8000 −11100 −38900 = −42000 ✓ equals L+E.
    expect(bs.assets.totalMinor).toBe("-42000");
    expect(bs.equity.retainedEarningsMinor).toBe("-42000");
  });

  it("pure aggregations match hand-computed rows", () => {
    const rows = [
      { accountCode: "1000", debitMinor: 1000n, creditMinor: 0n },
      { accountCode: "4000", debitMinor: 0n, creditMinor: 1000n },
    ];
    const tb = trialBalanceFrom(rows, DEFAULT_ACCOUNTS);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebitMinor).toBe("1000");
    const bs = balanceSheetFrom(rows, DEFAULT_ACCOUNTS);
    expect(bs.balanced).toBe(true);
    expect(bs.assets.totalMinor).toBe("1000");
    expect(bs.equity.retainedEarningsMinor).toBe("1000");
  });
});

// ---------------- manual entries --------------------------------

describe("OU7 manual entries — balance enforced server-side", () => {
  it("validateManualLines refuses an unbalanced entry", () => {
    expect(() => validateManualLines([
      { accountCode: "1000", debitMinor: "1000", creditMinor: "0" },
      { accountCode: "3000", debitMinor: "0", creditMinor: "900" },
    ], DEFAULT_ACCOUNTS)).toThrow(expect.objectContaining({ code: "finance.accounting.entryNotBalanced" }));
  });
  it("validateManualLines refuses unknown accounts and two-sided lines", () => {
    expect(() => validateManualLines([
      { accountCode: "9999", debitMinor: "100", creditMinor: "0" },
      { accountCode: "3000", debitMinor: "0", creditMinor: "100" },
    ], DEFAULT_ACCOUNTS)).toThrow(expect.objectContaining({ code: "finance.accounting.codeNotInChart" }));
    expect(() => validateManualLines([
      { accountCode: "1000", debitMinor: "100", creditMinor: "100" },
      { accountCode: "3000", debitMinor: "0", creditMinor: "100" },
    ], DEFAULT_ACCOUNTS)).toThrow(expect.objectContaining({ code: "finance.accounting.debitXorCredit" }));
  });
  it("a balanced manual entry is created, marked manual and audit-logged", async () => {
    const { prisma, accounting } = makeWorld();
    const entry = await accounting.createManualEntry("org-1", "user-1", {
      date: "2026-10-15", memo: "শুরুর মূলধন",
      lines: [
        { accountCode: "1000", debitMinor: "100000", creditMinor: "0" },
        { accountCode: "3000", debitMinor: "0", creditMinor: "100000" },
      ],
    });
    expect(entry.isManual).toBe(true);
    expect(entry.sourceType).toBe("manual");
    expect(prisma.auditLog.rows.some((a: any) => a.action === "finance.journal_manual_created")).toBe(true);
    await expect(accounting.createManualEntry("org-1", "user-1", {
      date: "2026-10-15",
      lines: [
        { accountCode: "1000", debitMinor: "100", creditMinor: "0" },
        { accountCode: "3000", debitMinor: "0", creditMinor: "50" },
      ],
    })).rejects.toMatchObject({ code: "finance.accounting.entryNotBalanced" });
    expect(prisma.ou7JournalEntry.rows).toHaveLength(1);
  });
  it("chart of accounts seeds the GL-mapping names exactly once", async () => {
    const { prisma, accounting } = makeWorld();
    const a = await accounting.listAccounts("org-1");
    const b = await accounting.listAccounts("org-1");
    expect(a.accounts).toHaveLength(DEFAULT_ACCOUNTS.length);
    expect(b.accounts).toHaveLength(DEFAULT_ACCOUNTS.length);
    expect(prisma.financeAccount.rows).toHaveLength(DEFAULT_ACCOUNTS.length);
    expect(a.accounts.map((x: any) => x.name)).toContain("Gateway Clearing");
    expect(a.accounts.map((x: any) => x.name)).toContain("Expense: salary");
  });
});

// ---------------- bank reconciliation ---------------------------

describe("OU7 bank reconciliation — suggestions only, never auto-confirm", () => {
  const csv = [
    "date,description,amount,reference",
    "2026-10-05,bKash settlement,101.00,TRX1",
    "2026-10-10,Salary payment,-500.00,",
    "2026-10-20,Unknown deposit,777.00,",
  ].join("\n");

  it("parseMoneyToMinor is exact decimal math", () => {
    expect(parseMoneyToMinor("1,234.50")).toBe(123450n);
    expect(parseMoneyToMinor("-500")).toBe(-50000n);
    expect(parseMoneyToMinor("0.1")).toBe(10n);
    expect(() => parseMoneyToMinor("abc")).toThrow();
  });

  it("import leaves every line unmatched, with suggestions attached only", async () => {
    const { prisma, bank } = makeWorld();
    seedSources(prisma);
    const res = await bank.importStatement("org-1", "user-1", csv);
    expect(res.created).toBe(3);
    expect(prisma.bankStatementLine.rows.every((l: any) => l.status === "unmatched")).toBe(true);
    const list = await bank.listBankLines("org-1");
    const bkash = list.items.find((i: any) => i.amountMinor === "10100");
    expect(bkash?.status).toBe("unmatched");
    // +10100 matches BOTH the gateway txn and the courier settlement (same money, two records) — suggestions, plural, unconfirmed.
    expect((bkash?.suggestions ?? []).length).toBeGreaterThanOrEqual(1);
    const salary = list.items.find((i: any) => i.amountMinor === "-50000");
    expect((salary?.suggestions ?? []).some((s: any) => s.sourceType === "expense")).toBe(true);
    const unknown = list.items.find((i: any) => i.amountMinor === "77700");
    expect(unknown?.suggestions).toEqual([]);
  });

  it("only a human confirm matches — and it must be a real suggestion", async () => {
    const { prisma, bank } = makeWorld();
    seedSources(prisma);
    await bank.importStatement("org-1", "user-1", csv);
    const line = prisma.bankStatementLine.rows.find((l: any) => BigInt(l.amountMinor) === -50000n);
    await expect(bank.confirmMatch("org-1", "user-1", line.id, { sourceType: "expense", sourceId: "nope" })).rejects.toMatchObject({ code: "finance.bankRecon.suggestedMatchNotFound" });
    expect(prisma.bankStatementLine.rows.find((l: any) => l.id === line.id).status).toBe("unmatched");
    const done = await bank.confirmMatch("org-1", "user-1", line.id, { sourceType: "expense", sourceId: "ex-1" });
    expect(done.status).toBe("matched");
    expect(done.confirmedById).toBe("user-1");
    const back = await bank.unmatch("org-1", "user-1", line.id);
    expect(back.status).toBe("unmatched");
  });

  it("suggestMatchesFor requires exact amount AND ±7 day window", () => {
    const cands = [{ sourceType: "expense" as const, sourceId: "x", dateKey: "2026-10-20", amountMinor: -100n, label: "x" }];
    expect(suggestMatchesFor({ amountMinor: -100n, dateKey: "2026-10-10" }, cands)).toEqual([]); // 10 days apart
    expect(suggestMatchesFor({ amountMinor: -100n, dateKey: "2026-10-14" }, cands)).toHaveLength(1); // 6 days
    expect(suggestMatchesFor({ amountMinor: 100n, dateKey: "2026-10-14" }, cands)).toEqual([]); // sign differs
  });
});
