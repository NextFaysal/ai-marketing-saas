import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { FinanceReportsService } from "./finance-reports.service";
import { parseSpentAt } from "./finance.service";
import {
  dhakaDateKey,
  groupByOrderId,
  inRange,
  isSoldOrderShape,
  orderEffectiveDate,
  parseFinanceRange,
  toBig,
  type FinanceRange,
} from "./finance-common";

/**
 * OU7 (One-Umbrella) — accounting-lite: chart of accounts, a
 * DERIVED journal, trial balance + balance sheet, posting status.
 *
 * The journal is bookkeeping GENERATED from real source records by
 * the posting rules below — it is not a second, hand-maintained set
 * of books. Every entry carries the source it came from and an
 * idempotency key (`ou7:<sourceType>:<sourceId>`, unique per org in
 * the DB), so a source can never post twice. Sources that cannot
 * post are listed by the posting-status view WITH their reason —
 * nothing is silently dropped.
 *
 * Account NAMES reuse the GC20.5 GL-export mapping verbatim (see
 * FinanceService.glRows): "Sales", "Delivery Income", "Tax Payable",
 * "Discounts", "Gateway Clearing", "COD Receivable", "Receivable",
 * "Cash", "Gateway Fees", "Refunds", "Other Income",
 * "Other Adjustments", "Expense: <category>". One deliberate,
 * documented difference from the one-step GL export: the journal
 * recognises a sale against a receivable first (Dr Receivable /
 * COD Receivable) and settles that receivable when payment actually
 * arrives (payment_gateway / payment_manual / courier_settlement).
 * The GL export file itself is unchanged.
 *
 * Periods are OPEN / reporting-only: there is no period locking
 * anywhere in this system and none is claimed — reports simply
 * aggregate the journal lines whose entry date falls in the period.
 */

// ---------------- chart of accounts (visible mapping) ----------

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense" | "contra_income";
export interface AccountDef { code: string; name: string; type: AccountType; normalSide: "debit" | "credit" }

export const EXPENSE_CATEGORY_CODES: Record<string, string> = {
  rent: "5100", salary: "5110", marketing: "5120", packaging: "5130",
  delivery: "5140", utilities: "5150", inventory_purchase: "5160", other: "5170",
};

export const DEFAULT_ACCOUNTS: AccountDef[] = [
  { code: "1000", name: "Cash", type: "asset", normalSide: "debit" },
  { code: "1010", name: "Bank", type: "asset", normalSide: "debit" },
  { code: "1020", name: "Gateway Clearing", type: "asset", normalSide: "debit" },
  { code: "1030", name: "COD Receivable", type: "asset", normalSide: "debit" },
  { code: "1040", name: "Receivable", type: "asset", normalSide: "debit" },
  { code: "2000", name: "Tax Payable", type: "liability", normalSide: "credit" },
  { code: "3000", name: "Owner Equity", type: "equity", normalSide: "credit" },
  { code: "4000", name: "Sales", type: "income", normalSide: "credit" },
  { code: "4010", name: "Delivery Income", type: "income", normalSide: "credit" },
  { code: "4020", name: "Other Income", type: "income", normalSide: "credit" },
  { code: "5000", name: "Discounts", type: "contra_income", normalSide: "debit" },
  { code: "5010", name: "Refunds", type: "contra_income", normalSide: "debit" },
  { code: "5020", name: "Gateway Fees", type: "expense", normalSide: "debit" },
  { code: "5030", name: "Other Adjustments", type: "expense", normalSide: "debit" },
  ...Object.entries(EXPENSE_CATEGORY_CODES).map(([cat, code]): AccountDef => ({
    code, name: `Expense: ${cat}`, type: "expense", normalSide: "debit",
  })),
];

export const ACCOUNT_CODE_BY_NAME: ReadonlyMap<string, string> = new Map(DEFAULT_ACCOUNTS.map((a) => [a.name, a.code]));
export function accountCodeOf(name: string): string {
  const code = ACCOUNT_CODE_BY_NAME.get(name);
  if (!code) throw new Error(`অ্যাকাউন্ট ম্যাপিংয়ে নেই: ${name}`);
  return code;
}
export function receivableAccountName(order: { isCod?: unknown } | null | undefined): string {
  return order?.isCod ? "COD Receivable" : "Receivable";
}

// ---------------- posting rules (pure, spec-proven) ------------

export interface PostingLine { accountCode: string; debitMinor: bigint; creditMinor: bigint }
const dr = (name: string, amount: bigint): PostingLine => ({ accountCode: accountCodeOf(name), debitMinor: amount, creditMinor: 0n });
const cr = (name: string, amount: bigint): PostingLine => ({ accountCode: accountCodeOf(name), debitMinor: 0n, creditMinor: amount });
const keep = (lines: PostingLine[]): PostingLine[] => lines.filter((l) => l.debitMinor !== 0n || l.creditMinor !== 0n);

export function linesBalance(lines: PostingLine[]): boolean {
  const d = lines.reduce((s, l) => s + l.debitMinor, 0n);
  const c = lines.reduce((s, l) => s + l.creditMinor, 0n);
  return d === c && d > 0n;
}

/** Sale — the GC20.5 legs, with the debit leg on the order's
 * receivable account (settled later by a payment rule). */
export function buildSaleLines(o: any): PostingLine[] {
  const total = toBig(o.totalMinor), discount = toBig(o.discountMinor);
  const subtotal = toBig(o.subtotalMinor), shipping = toBig(o.shippingMinor), tax = toBig(o.taxMinor);
  const remainder = total - subtotal + discount - shipping - tax;
  return keep([
    dr(receivableAccountName(o), total),
    ...(discount > 0n ? [dr("Discounts", discount)] : []),
    cr("Sales", subtotal),
    ...(shipping > 0n ? [cr("Delivery Income", shipping)] : []),
    ...(tax > 0n ? [cr("Tax Payable", tax)] : []),
    ...(remainder > 0n ? [cr("Other Income", remainder)] : remainder < 0n ? [dr("Other Adjustments", -remainder)] : []),
  ]);
}

/** Payment received via a verified gateway transaction. */
export function buildGatewayPaymentLines(tx: any, order: any): PostingLine[] {
  return keep([dr("Gateway Clearing", toBig(tx.amountMinor)), cr(receivableAccountName(order), toBig(tx.amountMinor))]);
}

/** Payment received as a staff-approved manual advance (EC19).
 * Bank-provider advances land on Bank, everything else on Cash —
 * the GL export's reality convention for approved advances. */
export function buildManualPaymentLines(pv: any, order: any): PostingLine[] {
  const amount = toBig(pv.amountMinor);
  const debitAccount = String(pv.provider ?? "") === "bank" ? "Bank" : "Cash";
  return keep([dr(debitAccount, amount), cr(receivableAccountName(order), amount)]);
}

/** Courier settlement: a MATCHED reconciliation line — the courier
 * remitted the sheet amount in cash against the COD receivable. */
export function buildCourierSettlementLines(line: any): PostingLine[] {
  const amount = toBig(line.sheetAmountMinor);
  return keep([dr("Cash", amount), cr("COD Receivable", amount)]);
}

/** Gateway fee — only ever built when feeMinor is recorded (> 0). */
export function buildGatewayFeeLines(tx: any): PostingLine[] {
  const fee = toBig(tx.feeMinor);
  return keep([dr("Gateway Fees", fee), cr("Gateway Clearing", fee)]);
}

/** Refund — GC20.5 credit-leg convention: the order's reality
 * account (Gateway Clearing when a verified txn exists for the
 * order, else COD Receivable for COD orders, else Cash). */
export function buildRefundLines(r: any, order: any, hasVerifiedTxn: boolean): PostingLine[] {
  const amount = toBig(r.refundAmountMinor);
  const creditAccount = hasVerifiedTxn ? "Gateway Clearing" : order?.isCod ? "COD Receivable" : "Cash";
  return keep([dr("Refunds", amount), cr(creditAccount, amount)]);
}

/** Expense — GC20.5 parity: Dr Expense: <category> / Cr Cash. */
export function buildExpenseLines(e: any): PostingLine[] {
  const amount = toBig(e.amountMinor);
  return keep([dr(`Expense: ${String(e.category)}`, amount), cr("Cash", amount)]);
}

// ---------------- manual entries (pure validation) -------------

/** Throws (Bengali) unless the lines form a balanced entry against
 * known, active accounts. Shared by the service and the specs. */
export function validateManualLines(raw: unknown, accounts: AccountDef[]): PostingLine[] {
  if (!Array.isArray(raw) || raw.length < 2) throw new Error("ম্যানুয়াল এন্ট্রিতে অন্তত ২টি সারি লাগবে");
  const known = new Map(accounts.map((a) => [a.code, a]));
  const lines: PostingLine[] = raw.map((l: any) => {
    const code = String(l?.accountCode ?? "");
    if (!known.has(code)) throw new Error(`অ্যাকাউন্ট কোডটি চার্টে নেই: ${code || "—"}`);
    const debit = toBig(l?.debitMinor), credit = toBig(l?.creditMinor);
    if (debit < 0n || credit < 0n) throw new Error("ডেবিট/ক্রেডিট ঋণাত্মক হতে পারে না");
    if ((debit === 0n) === (credit === 0n)) throw new Error("প্রতি সারিতে ডেবিট অথবা ক্রেডিট — ঠিক একটিই থাকবে");
    return { accountCode: code, debitMinor: debit, creditMinor: credit };
  });
  if (!linesBalance(lines)) throw new Error("এন্ট্রিটি ব্যালান্স হয়নি — মোট ডেবিট ও মোট ক্রেডিট সমান হতে হবে");
  return lines;
}

// ---------------- reports (pure aggregation) -------------------

export interface AccountTotalsRow { accountCode: string; debitMinor: bigint; creditMinor: bigint }

export function trialBalanceFrom(rows: AccountTotalsRow[], accounts: AccountDef[]) {
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const map = new Map<string, { debit: bigint; credit: bigint }>();
  for (const r of rows) {
    const g = map.get(r.accountCode) ?? { debit: 0n, credit: 0n };
    g.debit += r.debitMinor; g.credit += r.creditMinor;
    map.set(r.accountCode, g);
  }
  const out = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([code, g]) => ({
    accountCode: code,
    accountName: byCode.get(code)?.name ?? code,
    accountType: byCode.get(code)?.type ?? "unknown",
    debitMinor: g.debit.toString(),
    creditMinor: g.credit.toString(),
    netMinor: (g.debit - g.credit).toString(),
  }));
  const totalDebit = [...map.values()].reduce((s, g) => s + g.debit, 0n);
  const totalCredit = [...map.values()].reduce((s, g) => s + g.credit, 0n);
  return { rows: out, totalDebitMinor: totalDebit.toString(), totalCreditMinor: totalCredit.toString(), balanced: totalDebit === totalCredit };
}

export function balanceSheetFrom(rows: AccountTotalsRow[], accounts: AccountDef[]) {
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const net = new Map<string, bigint>(); // debit − credit
  for (const r of rows) net.set(r.accountCode, (net.get(r.accountCode) ?? 0n) + r.debitMinor - r.creditMinor);
  let assets = 0n, liabilities = 0n, equity = 0n, incomeNet = 0n, expenseNet = 0n, contraNet = 0n;
  const detail: Array<{ accountCode: string; accountName: string; accountType: string; balanceMinor: string }> = [];
  for (const [code, n] of [...net.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const def = byCode.get(code);
    if (!def) continue;
    // Balance expressed on the account's normal side (positive = normal).
    const balance = def.normalSide === "debit" ? n : -n;
    detail.push({ accountCode: code, accountName: def.name, accountType: def.type, balanceMinor: balance.toString() });
    if (def.type === "asset") assets += balance;
    else if (def.type === "liability") liabilities += balance;
    else if (def.type === "equity") equity += balance;
    else if (def.type === "income") incomeNet += balance;
    else if (def.type === "expense") expenseNet += balance;
    else if (def.type === "contra_income") contraNet += balance;
  }
  const retainedEarnings = incomeNet - expenseNet - contraNet;
  const liabilitiesAndEquity = liabilities + equity + retainedEarnings;
  return {
    assets: { totalMinor: assets.toString() },
    liabilities: { totalMinor: liabilities.toString() },
    equity: { accountsMinor: equity.toString(), retainedEarningsMinor: retainedEarnings.toString(), totalMinor: (equity + retainedEarnings).toString() },
    totalLiabilitiesAndEquityMinor: liabilitiesAndEquity.toString(),
    detail,
    balanced: assets === liabilitiesAndEquity,
  };
}

// ---------------- service --------------------------------------

export interface PostingSource {
  sourceType: string;
  sourceId: string;
  dateKey: string;
  amountMinor: string;
  label: string;
  lines: PostingLine[] | null;
  unpostedReason: string | null;
}

const TAKE = 5001;

@Injectable()
export class AccountingLiteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly reports: FinanceReportsService,
  ) {}

  private t(name: string): any { return (this.prisma as any)[name]; }

  // ---------------- chart of accounts ----------------

  async ensureAccounts(organizationId: string): Promise<AccountDef[]> {
    const existing = await this.t("financeAccount").findMany({ where: { organizationId }, take: 500 });
    const have = new Set(existing.map((a: any) => String(a.code)));
    for (const def of DEFAULT_ACCOUNTS) {
      if (have.has(def.code)) continue;
      await this.t("financeAccount").create({ data: { organizationId, ...def } }).catch(() => undefined);
    }
    const rows = existing.length === DEFAULT_ACCOUNTS.length ? existing
      : await this.t("financeAccount").findMany({ where: { organizationId }, take: 500 });
    const byCode = new Map<string, AccountDef>(rows.map((a: any) => [String(a.code), {
      code: String(a.code), name: String(a.name), type: String(a.type) as AccountType, normalSide: String(a.normalSide) as "debit" | "credit",
    }]));
    // Fall back to the code defaults for any row a partial seed missed.
    for (const def of DEFAULT_ACCOUNTS) if (!byCode.has(def.code)) byCode.set(def.code, def);
    return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  }

  async listAccounts(organizationId: string) {
    const accounts = await this.ensureAccounts(organizationId);
    return {
      accounts: accounts.map((a) => ({ ...a })),
      mappingNote: "অ্যাকাউন্টের নাম GC20.5 GL এক্সপোর্টের ম্যাপিং অনুযায়ী — একই নাম, দ্বিতীয় কোনো ম্যাপিং নেই। পোস্টিং রুল → অ্যাকাউন্ট ম্যাপিং ou7-accounting.service.ts-তে কোডে দৃশ্যমান।",
    };
  }

  // ---------------- source collection ----------------

  private async attachOrderRelations(organizationId: string, orders: any[]): Promise<void> {
    if (!orders.length) return;
    const ids = orders.map((o) => String(o.id));
    const [shipments, verifications] = await Promise.all([
      this.t("courierShipment").findMany({ where: { organizationId, orderId: { in: ids } }, take: 20001 }),
      this.t("paymentVerification").findMany({ where: { organizationId, orderId: { in: ids } }, take: 20001 }),
    ]);
    const shipBy = groupByOrderId(shipments);
    const verBy = groupByOrderId(verifications);
    for (const o of orders) { o._shipments = shipBy.get(String(o.id)) ?? []; o._verifications = verBy.get(String(o.id)) ?? []; }
  }

  /** Every postable (or explicitly unpostable) source in range. */
  async collectSources(organizationId: string, range: FinanceRange): Promise<PostingSource[]> {
    const sources: PostingSource[] = [];
    const push = (s: PostingSource) => sources.push(s);

    const orders = await this.t("order").findMany({ where: { organizationId, isPractice: false }, take: TAKE });
    await this.attachOrderRelations(organizationId, orders);
    const orderById = new Map<string, any>(orders.map((o: any) => [String(o.id), o]));
    const sold = orders.filter((o: any) => inRange(orderEffectiveDate(o), range) && isSoldOrderShape(String(o.status), (o._shipments ?? []).map((s: any) => String(s.status))));
    for (const o of sold) {
      push({ sourceType: "sale", sourceId: String(o.id), dateKey: dhakaDateKey(orderEffectiveDate(o)), amountMinor: toBig(o.totalMinor).toString(), label: `বিক্রি · অর্ডার ${o.externalNumber ?? o.id}`, lines: buildSaleLines(o), unpostedReason: null });
    }

    const verifiedTxns = await this.t("tenantPaymentTransaction").findMany({ where: { organizationId, status: "verified_paid" }, take: TAKE });
    const verifiedOrderIds = new Set(verifiedTxns.map((tx: any) => String(tx.orderId ?? "")).filter(Boolean));
    for (const tx of verifiedTxns) {
      const date = new Date(tx.updatedAt);
      if (!inRange(date, range)) continue;
      const order = orderById.get(String(tx.orderId ?? ""));
      push({
        sourceType: "payment_gateway", sourceId: String(tx.id), dateKey: dhakaDateKey(date), amountMinor: toBig(tx.amountMinor).toString(),
        label: `গেটওয়ে পেমেন্ট · ${String(tx.provider ?? "")} ${String(tx.providerTxnId ?? tx.id)}`,
        lines: order ? buildGatewayPaymentLines(tx, order) : null,
        unpostedReason: order ? null : "অর্ডারটি পাওয়া যায়নি — কোন receivable অ্যাকাউন্টে যাবে জানা নেই",
      });
      const fee = tx.feeMinor === null || tx.feeMinor === undefined ? 0n : toBig(tx.feeMinor);
      if (fee > 0n) {
        push({ sourceType: "gateway_fee", sourceId: String(tx.id), dateKey: dhakaDateKey(date), amountMinor: fee.toString(), label: `গেটওয়ে ফি · ${String(tx.provider ?? "")} ${String(tx.providerTxnId ?? tx.id)}`, lines: buildGatewayFeeLines(tx), unpostedReason: null });
      }
    }

    const approvedPvs = await this.t("paymentVerification").findMany({ where: { organizationId, status: "approved" }, take: TAKE });
    for (const pv of approvedPvs) {
      const date = new Date(pv.createdAt);
      if (!inRange(date, range)) continue;
      const base = { sourceType: "payment_manual", sourceId: String(pv.id), dateKey: dhakaDateKey(date), label: `ম্যানুয়াল advance · ${String(pv.provider ?? "—")} ${String(pv.trxId ?? pv.id)}` };
      if (String(pv.source ?? "") === "gateway_deposit") {
        push({ ...base, amountMinor: pv.amountMinor != null ? toBig(pv.amountMinor).toString() : "0", lines: null, unpostedReason: "এই advance-টি gateway লেনদেন থেকে তৈরি — payment_gateway হিসেবে ইতিমধ্যে গণনা হয়, দ্বিগুণ এড়াতে আলাদা পোস্ট হয় না" });
        continue;
      }
      const order = pv.orderId ? orderById.get(String(pv.orderId)) : undefined;
      const amount = pv.amountMinor === null || pv.amountMinor === undefined ? 0n : toBig(pv.amountMinor);
      if (!order) push({ ...base, amountMinor: amount.toString(), lines: null, unpostedReason: "কোনো অর্ডারের সঙ্গে যুক্ত নয় — receivable জানা নেই" });
      else if (amount <= 0n) push({ ...base, amountMinor: amount.toString(), lines: null, unpostedReason: "পরিমাণ রেকর্ড নেই" });
      else push({ ...base, amountMinor: amount.toString(), lines: buildManualPaymentLines(pv, order), unpostedReason: null });
    }

    const imports = await this.t("reconciliationImport").findMany({ where: { organizationId, createdAt: { gte: range.fromDate, lte: range.toDate } }, take: 500 });
    for (const imp of imports) {
      const lines = await this.t("reconciliationLine").findMany({ where: { organizationId, importId: String(imp.id) }, take: 20001 });
      for (const l of lines) {
        const base = { sourceType: "courier_settlement", sourceId: String(l.id), dateKey: dhakaDateKey(new Date(imp.createdAt)), label: `কুরিয়ার সেটেলমেন্ট · সারি ${Number(l.rowNumber ?? 0)} · ${String(l.rawTrackingId ?? "")}` };
        if (String(l.outcome) === "matched" && l.sheetAmountMinor !== null && l.sheetAmountMinor !== undefined && l.matchedOrderId) {
          push({ ...base, amountMinor: toBig(l.sheetAmountMinor).toString(), lines: buildCourierSettlementLines(l), unpostedReason: null });
        } else if (String(l.outcome) === "amount_mismatch") {
          push({ ...base, amountMinor: l.sheetAmountMinor != null ? toBig(l.sheetAmountMinor).toString() : "0", lines: null, unpostedReason: "sheet-এর পরিমাণ প্রত্যাশিত পরিমাণের সঙ্গে মেলেনি — আগে reconciliation-এ মীমাংসা করুন" });
        }
      }
    }

    const completedRefunds = (await this.reports.loadReturns(organizationId, range, "updatedAt"))
      .filter((r: any) => String(r.status) === "completed" && String(r.resolution ?? "") === "refund");
    for (const r of completedRefunds) {
      const order = orderById.get(String(r.orderId));
      const base = { sourceType: "refund", sourceId: String(r.id), dateKey: dhakaDateKey(new Date(r.updatedAt)), label: `রিফান্ড · অর্ডার ${order?.externalNumber ?? r.orderId}` };
      if (r.refundAmountMinor === null || r.refundAmountMinor === undefined) {
        push({ ...base, amountMinor: "0", lines: null, unpostedReason: "রিফান্ডের পরিমাণ রেকর্ড নেই — GL এক্সপোর্টের মতোই এড়িয়ে যাওয়া হয়েছে" });
      } else {
        push({ ...base, amountMinor: toBig(r.refundAmountMinor).toString(), lines: buildRefundLines(r, order, verifiedOrderIds.has(String(r.orderId))), unpostedReason: null });
      }
    }

    const expenses = await this.t("expense").findMany({ where: { organizationId, spentAt: { gte: range.fromDate, lte: range.toDate } }, take: TAKE });
    for (const e of expenses) {
      push({ sourceType: "expense", sourceId: String(e.id), dateKey: dhakaDateKey(new Date(e.spentAt)), amountMinor: toBig(e.amountMinor).toString(), label: `খরচ · ${String(e.category)}${e.note ? ` · ${String(e.note).slice(0, 60)}` : ""}`, lines: buildExpenseLines(e), unpostedReason: null });
    }

    return sources.sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.sourceType.localeCompare(b.sourceType));
  }

  private idempotencyKeyOf(s: PostingSource): string { return `ou7:${s.sourceType}:${s.sourceId}`; }

  private async postedEntryIds(organizationId: string): Promise<Map<string, string>> {
    const entries = await this.t("ou7JournalEntry").findMany({ where: { organizationId }, select: { id: true, idempotencyKey: true }, take: 20001 });
    return new Map(entries.map((e: any) => [String(e.idempotencyKey), String(e.id)] as [string, string]));
  }

  async postingStatus(organizationId: string, from?: string, to?: string) {
    const range = parseFinanceRange(from, to);
    const sources = await this.collectSources(organizationId, range);
    const posted = await this.postedEntryIds(organizationId);
    const items = sources.map((s) => {
      const entryId = posted.get(this.idempotencyKeyOf(s));
      return {
        sourceType: s.sourceType, sourceId: s.sourceId, date: s.dateKey, amountMinor: s.amountMinor, label: s.label,
        posted: Boolean(entryId), entryId: entryId ?? null,
        reason: entryId ? null : (s.unpostedReason ?? "এখনো পোস্ট করা হয়নি"),
      };
    });
    const byType = new Map<string, { total: number; posted: number; unposted: number }>();
    for (const i of items) {
      const g = byType.get(i.sourceType) ?? { total: 0, posted: 0, unposted: 0 };
      g.total += 1; if (i.posted) g.posted += 1; else g.unposted += 1;
      byType.set(i.sourceType, g);
    }
    return {
      range: { from: range.from, to: range.to },
      totals: { sources: items.length, posted: items.filter((i) => i.posted).length, unposted: items.filter((i) => !i.posted).length },
      byType: [...byType.entries()].map(([sourceType, g]) => ({ sourceType, ...g })),
      items: items.slice(0, 500),
      truncated: items.length > 500,
    };
  }

  /** Generate journal entries for every postable source in range.
   * Idempotent: a source whose idempotency key already exists is
   * counted as alreadyPosted and never re-created. */
  async postSources(organizationId: string, actorId: string | undefined, from?: string, to?: string) {
    await this.ensureAccounts(organizationId);
    const range = parseFinanceRange(from, to);
    const sources = await this.collectSources(organizationId, range);
    const postedMap = await this.postedEntryIds(organizationId);
    let posted = 0, alreadyPosted = 0;
    const unposted: Array<{ sourceType: string; sourceId: string; reason: string }> = [];
    for (const s of sources) {
      if (!s.lines) { unposted.push({ sourceType: s.sourceType, sourceId: s.sourceId, reason: s.unpostedReason ?? "পোস্টযোগ্য সারি তৈরি হয়নি" }); continue; }
      if (!linesBalance(s.lines)) { unposted.push({ sourceType: s.sourceType, sourceId: s.sourceId, reason: "পোস্টিং রুল ব্যালান্স হয়নি — অভ্যন্তরীণ ত্রুটি, পোস্ট হয়নি" }); continue; }
      const key = this.idempotencyKeyOf(s);
      if (postedMap.has(key)) { alreadyPosted += 1; continue; }
      try {
        const entry = await this.t("ou7JournalEntry").create({
          data: {
            organizationId, entryDate: new Date(`${s.dateKey}T00:00:00+06:00`),
            sourceType: s.sourceType, sourceId: s.sourceId, idempotencyKey: key,
            memo: s.label, isManual: false, createdById: actorId ?? null,
          },
        });
        for (const l of s.lines) {
          await this.t("ou7JournalLine").create({ data: { organizationId, entryId: String(entry.id), accountCode: l.accountCode, debitMinor: l.debitMinor, creditMinor: l.creditMinor } });
        }
        postedMap.set(key, String(entry.id));
        posted += 1;
      } catch (e: any) {
        // The DB unique index is the real guard: a concurrent post
        // of the same source lands here and counts as already posted.
        if (String(e?.message ?? e).includes("Unique constraint") || String(e?.code ?? "") === "P2002") { alreadyPosted += 1; continue; }
        throw e;
      }
    }
    await this.audit.log({ organizationId, userId: actorId, action: "finance.journal_posted", entityType: "Ou7JournalEntry", metadata: { posted, alreadyPosted, unposted: unposted.length, from: range.from, to: range.to } }).catch(() => undefined);
    return { range: { from: range.from, to: range.to }, posted, alreadyPosted, unposted };
  }

  // ---------------- journal views ----------------

  private serializeEntry(e: any, lines: any[]) {
    return {
      id: String(e.id), entryDate: dhakaDateKey(new Date(e.entryDate)),
      sourceType: String(e.sourceType), sourceId: e.sourceId ?? null,
      memo: e.memo ?? null, isManual: Boolean(e.isManual), createdById: e.createdById ?? null,
      createdAt: e.createdAt ? new Date(e.createdAt).toISOString() : null,
      lines: lines.map((l) => ({ accountCode: String(l.accountCode), debitMinor: toBig(l.debitMinor).toString(), creditMinor: toBig(l.creditMinor).toString() })),
      totalDebitMinor: lines.reduce((s, l) => s + toBig(l.debitMinor), 0n).toString(),
      totalCreditMinor: lines.reduce((s, l) => s + toBig(l.creditMinor), 0n).toString(),
    };
  }

  async listJournal(organizationId: string, from?: string, to?: string, page?: string, pageSize?: string) {
    const range = parseFinanceRange(from, to);
    const p = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
    const ps = Math.min(100, Math.max(1, Number.parseInt(pageSize ?? "25", 10) || 25));
    const where = { organizationId, entryDate: { gte: range.fromDate, lte: range.toDate } };
    const [total, entries] = await Promise.all([
      this.t("ou7JournalEntry").count({ where }),
      this.t("ou7JournalEntry").findMany({ where, orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }], skip: (p - 1) * ps, take: ps }),
    ]);
    const ids = entries.map((e: any) => String(e.id));
    const lines = ids.length ? await this.t("ou7JournalLine").findMany({ where: { organizationId, entryId: { in: ids } }, take: 20001 }) : [];
    const byEntry = groupByOrderId(lines.map((l: any) => ({ ...l, orderId: l.entryId })));
    return { items: entries.map((e: any) => this.serializeEntry(e, byEntry.get(String(e.id)) ?? [])), total, page: p, pageSize: ps };
  }

  async createManualEntry(organizationId: string, actorId: string | undefined, body: any) {
    const accounts = await this.ensureAccounts(organizationId);
    const entryDate = parseSpentAt(body?.date);
    const lines = validateManualLines(body?.lines, accounts);
    const memo = body?.memo === null || body?.memo === undefined ? null : String(body.memo).slice(0, 500);
    const entry = await this.t("ou7JournalEntry").create({
      data: {
        organizationId, entryDate, sourceType: "manual", sourceId: null,
        idempotencyKey: `manual:${randomUUID()}`, memo, isManual: true, createdById: actorId ?? null,
      },
    });
    const created: any[] = [];
    for (const l of lines) {
      created.push(await this.t("ou7JournalLine").create({ data: { organizationId, entryId: String(entry.id), accountCode: l.accountCode, debitMinor: l.debitMinor, creditMinor: l.creditMinor } }));
    }
    await this.audit.log({ organizationId, userId: actorId, action: "finance.journal_manual_created", entityType: "Ou7JournalEntry", entityId: String(entry.id), metadata: { date: dhakaDateKey(entryDate), lines: lines.length, totalMinor: lines.reduce((s, l) => s + l.debitMinor, 0n).toString() } }).catch(() => undefined);
    return this.serializeEntry(entry, created);
  }

  // ---------------- reports from journal lines ----------------

  private async accountTotals(organizationId: string, where: any): Promise<AccountTotalsRow[]> {
    const entries = await this.t("ou7JournalEntry").findMany({ where: { organizationId, ...where }, select: { id: true }, take: 20001 });
    const ids = entries.map((e: any) => String(e.id));
    if (!ids.length) return [];
    const lines = await this.t("ou7JournalLine").findMany({ where: { organizationId, entryId: { in: ids } }, take: 50001 });
    const map = new Map<string, AccountTotalsRow>();
    for (const l of lines) {
      const g = map.get(String(l.accountCode)) ?? { accountCode: String(l.accountCode), debitMinor: 0n, creditMinor: 0n };
      g.debitMinor += toBig(l.debitMinor); g.creditMinor += toBig(l.creditMinor);
      map.set(String(l.accountCode), g);
    }
    return [...map.values()];
  }

  async trialBalance(organizationId: string, from?: string, to?: string) {
    const range = parseFinanceRange(from, to);
    const accounts = await this.ensureAccounts(organizationId);
    const rows = await this.accountTotals(organizationId, { entryDate: { gte: range.fromDate, lte: range.toDate } });
    return {
      range: { from: range.from, to: range.to },
      periodState: "open",
      periodNote: "পিরিয়ড খোলা (reporting-only) — এই সিস্টেমে পিরিয়ড লক/ক্লোজ নেই, তাই কোনো লক দাবি করা হয় না।",
      ...trialBalanceFrom(rows, accounts),
    };
  }

  async balanceSheet(organizationId: string, to?: string) {
    // Cumulative from the beginning of the journal — deliberately
    // NOT parseFinanceRange (its 366-day cap is a period-report
    // rule, not a balance-sheet rule). Only the end date is parsed.
    const end = parseFinanceRange(to, to);
    const accounts = await this.ensureAccounts(organizationId);
    const rows = await this.accountTotals(organizationId, { entryDate: { lte: end.toDate } });
    return {
      asOf: end.to,
      periodState: "open",
      periodNote: "পিরিয়ড খোলা (reporting-only) — ব্যালান্স শিট শুরুর সব জার্নাল এন্ট্রি থেকে cumulative হিসাব; কোনো opening-balance এন্ট্রি না থাকলে আগের হিসাব এতে আসে না।",
      pnlLink: { reportType: "profit", note: "লাভ-ক্ষতির বিস্তারিত (P&L) বিদ্যমান profit রিপোর্টে — নির্ধারিত রিপোর্ট (scheduled reports) ও OrderProfitService থেকে; এই পেজের retained earnings জার্নাল-ভিত্তিক।" },
      ...balanceSheetFrom(rows, accounts),
    };
  }
}
