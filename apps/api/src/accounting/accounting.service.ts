import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import Papa from "papaparse";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { PdfCanvas, buildPdf, moneyText } from "../courier/pdf";
import { dhakaDateKey } from "../finance/finance-common";
import { badRequest, notFound } from "../i18n";

/**
 * NF10 (FB4) — Full accounting upgrade: chart of accounts,
 * a REAL double-entry journal, auto-entries from real records,
 * bank/mobile-banking statement reconciliation on the EXISTING
 * EC26 machinery, and journal-only P&L + VAT reports.
 *
 * THE BALANCE INVARIANT: createJournalEntry is the ONLY door
 * that writes a JournalEntry. An entry saves only if it has
 * >= 2 lines, every line carries exactly one positive side, and
 * Σdebit == Σcredit with Σ > 0. An unbalanced entry can NEVER
 * be saved — the check runs before any write (spec-proven).
 *
 * AR / REVENUE DESIGN (the one coherent design, followed
 * throughout): revenue is recognised when an order reaches a
 * sold status (completed | delivered — the codebase's canonical
 * NF7/EC33 sold statuses): Dr Accounts Receivable for the order
 * total, Cr Sales Revenue (net of delivery + VAT portions),
 * Cr Delivery Income for shippingMinor, Cr VAT Payable for
 * taxMinor. A VERIFIED payment (PaymentVerification.status =
 * "approved" — the EC19 verdict field; pending/rejected rows
 * never count) then SETTLES the receivable: Dr Cash/bKash/Bank
 * by provider, Cr Accounts Receivable. Revenue is therefore
 * never double-counted: the payment entry touches no income
 * account. A payment generated before its order's revenue entry
 * temporarily drives AR negative for that order until the sync
 * creates the revenue entry — the sync always generates revenue
 * BEFORE payments inside one run.
 *
 * AUTO-GENERATION PATTERN (documented choice): an explicit,
 * idempotent sync (POST accounting/sync + the generate call the
 * P&L/VAT reports make first) in the NF7 reconciler's spirit —
 * derived state that can always be rebuilt from source records —
 * PLUS a forward hook from FinanceService.createExpense (the one
 * write path that already exists for a source record type).
 * Idempotency rides the JournalEntry (organizationId,
 * sourceType, sourceId) unique: re-running generation creates
 * no duplicates (spec-proven).
 *
 * COURIER CHARGES — AUDIT FINDING: a real charge field EXISTS.
 * CourierShipment.chargeMinor (GB5: the delivery_fee the provider
 * returned at booking; null when none was returned) and, stronger,
 * ReconciliationLine.sheetChargeMinor (the charge on the courier's
 * own settlement sheet, stamped by EC26 imports). Generation
 * prefers the sheet charge for the shipment when one exists and
 * falls back to the booking charge; a shipment with NEITHER is
 * skipped — no charge is ever estimated. Once an entry exists for
 * a shipment it is NOT revised (first known charge wins), so a
 * later sheet charge differing from the booking charge stays a
 * documented v1 limit, visible via the EC26 mismatch surfaces.
 */

export const ACCOUNTING_DISCLAIMER = "এটি একটি হিসাব-সহায়ক টুল — অডিট করা বা বিধিবদ্ধ হিসাব নয়।";

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;

export interface DefaultAccount { code: string; name: string; type: string; systemKey: string }

/** Sensible BD-retail defaults, seeded lazily per org. Names are
 * English so the existing PDF toolkit (WinAnsi) renders them;
 * staff may rename any of them (system accounts: rename only). */
export const DEFAULT_ACCOUNTS: DefaultAccount[] = [
  { code: "1000", name: "Cash", type: "asset", systemKey: "cash" },
  { code: "1010", name: "bKash", type: "asset", systemKey: "bkash" },
  { code: "1020", name: "Bank", type: "asset", systemKey: "bank" },
  { code: "1100", name: "Accounts Receivable", type: "asset", systemKey: "accounts_receivable" },
  { code: "1200", name: "Inventory", type: "asset", systemKey: "inventory" },
  { code: "2000", name: "Accounts Payable", type: "liability", systemKey: "accounts_payable" },
  { code: "2100", name: "VAT Payable", type: "liability", systemKey: "vat_payable" },
  { code: "3000", name: "Owner Equity / Capital", type: "equity", systemKey: "owner_equity" },
  { code: "4000", name: "Sales Revenue", type: "income", systemKey: "sales_revenue" },
  { code: "4100", name: "Delivery Income", type: "income", systemKey: "delivery_income" },
  { code: "4200", name: "Other Income", type: "income", systemKey: "other_income" },
  { code: "5000", name: "COGS", type: "expense", systemKey: "cogs" },
  { code: "5100", name: "Courier Charges", type: "expense", systemKey: "courier_charges" },
  { code: "5200", name: "Expense: Rent", type: "expense", systemKey: "expense_rent" },
  { code: "5210", name: "Expense: Salary", type: "expense", systemKey: "expense_salary" },
  { code: "5220", name: "Expense: Marketing", type: "expense", systemKey: "expense_marketing" },
  { code: "5230", name: "Expense: Packaging", type: "expense", systemKey: "expense_packaging" },
  { code: "5240", name: "Expense: Utilities", type: "expense", systemKey: "expense_utilities" },
  { code: "5250", name: "Expense: Inventory Purchase", type: "expense", systemKey: "expense_inventory_purchase" },
  { code: "5260", name: "Expense: Other", type: "expense", systemKey: "expense_other" },
];

/** Expense.category (OU7/GB8 vocabulary) → chart account. The
 * "delivery" category maps onto Courier Charges (it IS the
 * merchant's delivery spend category; courier-provider charges
 * auto-generated from shipments land on the same account). */
export const EXPENSE_CATEGORY_ACCOUNT: Record<string, string> = {
  rent: "expense_rent",
  salary: "expense_salary",
  marketing: "expense_marketing",
  packaging: "expense_packaging",
  delivery: "courier_charges",
  utilities: "expense_utilities",
  inventory_purchase: "expense_inventory_purchase",
  other: "expense_other",
};

const SOLD_STATUSES = ["completed", "delivered"];
const CASH_LIKE_KEYS = ["cash", "bkash", "bank"];

export function toBig(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return BigInt(v.trim());
  return 0n;
}

function isUniqueViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /unique|P2002/i.test(msg);
}

/** Signed statement-money parse ("1,250.00", "-500", "৳300"):
 * returns { abs, negative } or null — never guesses. */
export function parseStatementMoney(raw: unknown): { abs: bigint; negative: boolean } | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  s = s.replace(/^(?:bdt|tk\.?|taka|৳)\s*/i, "").replace(/\s*(?:bdt|tk\.?|taka|৳)$/i, "").replace(/[,\s]/g, "");
  if (s.startsWith("-")) { negative = true; s = s.slice(1); }
  else if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return { abs: BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2)), negative };
}

/** Statement date: YYYY-MM-DD, DD/MM/YYYY or DD-MM-YYYY. */
export function parseStatementDate(raw: unknown): Date | null {
  const s = String(raw ?? "").trim();
  let ymd: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) ymd = s;
  else {
    const m = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(s);
    if (m) ymd = `${m[3]}-${m[2]}-${m[1]}`;
  }
  if (!ymd) return null;
  const d = new Date(`${ymd}T12:00:00+06:00`);
  if (Number.isNaN(d.getTime()) || dhakaDateKey(d) !== ymd) return null;
  return d;
}

function monthRange(month: string): { month: string; start: Date; end: Date } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? "")) {
    throw badRequest("accounting.monthFormatYmd");
  }
  const [y, m] = month.split("-").map(Number);
  const start = new Date(`${month}-01T00:00:00+06:00`);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  const end = new Date(new Date(`${next}-01T00:00:00+06:00`).getTime() - 1);
  return { month, start, end };
}

@Injectable()
export class AccountingService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private t(name: string): any {
    return (this.prisma as any)[name];
  }

  private async safeAudit(input: any): Promise<void> {
    try { await this.audit?.log(input); } catch { /* audit never breaks the write */ }
  }

  // ---------------- chart of accounts ----------------

  /** Lazy, idempotent seeding: create whichever system accounts
   * the org does not have yet (by systemKey). First use only —
   * later calls are pure reads once all defaults exist. */
  async ensureAccounts(orgId: string): Promise<any[]> {
    const existing = await this.t("chartAccount").findMany({ where: { organizationId: orgId } });
    const haveKeys = new Set(existing.map((a: any) => a.systemKey).filter(Boolean).map(String));
    const haveCodes = new Set(existing.map((a: any) => String(a.code)));
    for (const def of DEFAULT_ACCOUNTS) {
      if (haveKeys.has(def.systemKey)) continue;
      if (haveCodes.has(def.code)) continue; // a custom account took the code — never overwrite staff data
      try {
        const row = await this.t("chartAccount").create({
          data: { organizationId: orgId, code: def.code, name: def.name, type: def.type, isSystem: true, systemKey: def.systemKey },
        });
        existing.push(row);
        haveKeys.add(def.systemKey);
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
    }
    return existing;
  }

  private async accountByKey(orgId: string, systemKey: string): Promise<any> {
    const accounts = await this.ensureAccounts(orgId);
    const found = accounts.find((a: any) => a.systemKey === systemKey);
    if (!found) throw badRequest("accounting.ledgerAccountNotFound", { key: systemKey });
    return found;
  }

  private serializeAccount(a: any, balanceMinor?: bigint) {
    return {
      id: String(a.id), code: String(a.code), name: String(a.name), type: String(a.type),
      isSystem: Boolean(a.isSystem), systemKey: a.systemKey ?? null,
      balanceMinor: balanceMinor !== undefined ? balanceMinor.toString() : undefined,
      createdAt: a.createdAt ?? null, updatedAt: a.updatedAt ?? null,
    };
  }

  async listAccounts(orgId: string) {
    const accounts = await this.ensureAccounts(orgId);
    const ids = accounts.map((a: any) => String(a.id));
    const lines = ids.length
      ? await this.t("journalLine").findMany({ where: { accountId: { in: ids } } }).catch(() => [])
      : [];
    const balances = new Map<string, bigint>();
    for (const l of lines ?? []) {
      const k = String(l.accountId);
      balances.set(k, (balances.get(k) ?? 0n) + toBig(l.debitMinor) - toBig(l.creditMinor));
    }
    const sorted = [...accounts].sort((a: any, b: any) => String(a.code).localeCompare(String(b.code)));
    return { items: sorted.map((a: any) => this.serializeAccount(a, balances.get(String(a.id)) ?? 0n)), disclaimer: ACCOUNTING_DISCLAIMER };
  }

  async createAccount(orgId: string, actorId: string, dto: { code?: string; name?: string; type?: string }) {
    await this.ensureAccounts(orgId);
    const code = String(dto?.code ?? "").trim();
    const name = String(dto?.name ?? "").trim();
    const type = String(dto?.type ?? "").trim();
    if (!/^\d{3,10}$/.test(code)) throw badRequest("accounting.accountCodeFormat");
    if (!name) throw badRequest("accounting.accountNameRequired");
    if (!(ACCOUNT_TYPES as readonly string[]).includes(type)) throw badRequest("accounting.accountTypeChoices");
    const clash = await this.t("chartAccount").findFirst({ where: { organizationId: orgId, code } });
    if (clash) throw badRequest("accounting.accountCodeExists");
    const row = await this.t("chartAccount").create({ data: { organizationId: orgId, code, name, type, isSystem: false, systemKey: null } });
    await this.safeAudit({ organizationId: orgId, userId: actorId, action: "accounting.account_created", entityType: "ChartAccount", entityId: String(row.id), metadata: { code, type } });
    return { account: this.serializeAccount(row, 0n) };
  }

  /** Rename is always allowed. A SYSTEM account can never be
   * re-typed or deleted (its systemKey drives auto-entries);
   * a custom account can be re-typed only while it has no
   * journal lines (history must keep its meaning). */
  async updateAccount(orgId: string, actorId: string, accountId: string, dto: { name?: string; type?: string }) {
    const account = await this.t("chartAccount").findFirst({ where: { id: accountId, organizationId: orgId } });
    if (!account) throw notFound("accounting.accountNotFoundAcc");
    const data: Record<string, any> = {};
    if (dto?.name !== undefined) {
      const name = String(dto.name ?? "").trim();
      if (!name) throw badRequest("accounting.accountNameRequired");
      data.name = name;
    }
    if (dto?.type !== undefined && String(dto.type) !== String(account.type)) {
      if (account.isSystem) throw badRequest("accounting.systemAccountTypeLocked");
      if (!(ACCOUNT_TYPES as readonly string[]).includes(String(dto.type))) throw badRequest("accounting.accountTypeInvalid");
      const used = await this.t("journalLine").findFirst({ where: { accountId } }).catch(() => null);
      if (used) throw badRequest("accounting.usedAccountTypeLocked");
      data.type = String(dto.type);
    }
    if (!Object.keys(data).length) throw badRequest("accounting.sendAtLeastOneField");
    const row = await this.t("chartAccount").update({ where: { id: accountId }, data });
    await this.safeAudit({ organizationId: orgId, userId: actorId, action: "accounting.account_updated", entityType: "ChartAccount", entityId: accountId, metadata: { fields: Object.keys(data) } });
    return { account: this.serializeAccount(row) };
  }

  async deleteAccount(orgId: string, actorId: string, accountId: string) {
    const account = await this.t("chartAccount").findFirst({ where: { id: accountId, organizationId: orgId } });
    if (!account) throw notFound("accounting.accountNotFoundAcc");
    if (account.isSystem) throw badRequest("accounting.systemAccountNotDeletable");
    const used = await this.t("journalLine").findFirst({ where: { accountId } }).catch(() => null);
    if (used) throw badRequest("accounting.usedAccountNotDeletable");
    await this.t("chartAccount").delete({ where: { id: accountId } });
    await this.safeAudit({ organizationId: orgId, userId: actorId, action: "accounting.account_deleted", entityType: "ChartAccount", entityId: accountId, metadata: {} });
    return { deleted: true };
  }

  // ---------------- journal (the one write door) ----------------

  /**
   * THE write door. Validates the balance invariant BEFORE any
   * write; an unbalanced / single-line / zero entry throws and
   * NOTHING is saved. Source-keyed calls are idempotent: an
   * existing (org, sourceType, sourceId) entry is returned as-is.
   */
  async createJournalEntry(orgId: string, actorId: string | undefined, input: {
    date: Date; memo?: string | null; sourceType?: string | null; sourceId?: string | null;
    lines: Array<{ accountId: string; debitMinor: bigint; creditMinor: bigint }>;
  }): Promise<{ entry: any; lines: any[]; created: boolean }> {
    if (input.sourceType && input.sourceId) {
      const existing = await this.t("journalEntry").findFirst({
        where: { organizationId: orgId, sourceType: input.sourceType, sourceId: input.sourceId },
      });
      if (existing) {
        const lines = await this.t("journalLine").findMany({ where: { entryId: String(existing.id) } });
        return { entry: existing, lines, created: false };
      }
    }
    const lines = input.lines ?? [];
    if (lines.length < 2) throw badRequest("accounting.journalMinLines");
    let totalDebit = 0n, totalCredit = 0n;
    for (const l of lines) {
      const d = toBig(l.debitMinor), c = toBig(l.creditMinor);
      if (d < 0n || c < 0n) throw badRequest("accounting.debitCreditNegative");
      if ((d > 0n && c > 0n) || (d === 0n && c === 0n)) {
        throw badRequest("accounting.journalLineOneSide");
      }
      totalDebit += d; totalCredit += c;
    }
    if (totalDebit === 0n || totalDebit !== totalCredit) {
      throw badRequest("accounting.journalNotBalanced");
    }
    // Every account must belong to THIS org.
    const accounts = await this.t("chartAccount").findMany({ where: { organizationId: orgId, id: { in: lines.map((l) => String(l.accountId)) } } });
    if (accounts.length !== new Set(lines.map((l) => String(l.accountId))).size) {
      throw badRequest("accounting.journalAccountNotOfOrg");
    }
    let entry: any;
    try {
      entry = await this.t("journalEntry").create({
        data: {
          organizationId: orgId, date: input.date, memo: input.memo ?? null,
          sourceType: input.sourceType ?? null, sourceId: input.sourceId ?? null,
          createdById: actorId ?? null,
        },
      });
    } catch (e) {
      if (isUniqueViolation(e) && input.sourceType && input.sourceId) {
        const existing = await this.t("journalEntry").findFirst({
          where: { organizationId: orgId, sourceType: input.sourceType, sourceId: input.sourceId },
        });
        if (existing) {
          const existingLines = await this.t("journalLine").findMany({ where: { entryId: String(existing.id) } });
          return { entry: existing, lines: existingLines, created: false };
        }
      }
      throw e;
    }
    const createdLines: any[] = [];
    for (const l of lines) {
      createdLines.push(await this.t("journalLine").create({
        data: { entryId: String(entry.id), accountId: String(l.accountId), debitMinor: toBig(l.debitMinor), creditMinor: toBig(l.creditMinor) },
      }));
    }
    return { entry, lines: createdLines, created: true };
  }

  async createManualEntry(orgId: string, actorId: string, dto: {
    date?: string; memo?: string;
    lines?: Array<{ accountId?: string; debitMinor?: unknown; creditMinor?: unknown }>;
  }) {
    if (!dto?.date || !/^\d{4}-\d{2}-\d{2}$/.test(dto.date)) throw badRequest("accounting.dateFormatYmdAcc");
    const date = new Date(`${dto.date}T12:00:00+06:00`);
    if (Number.isNaN(date.getTime()) || dhakaDateKey(date) !== dto.date) throw badRequest("accounting.dateInvalidAcc");
    await this.ensureAccounts(orgId);
    const lines = (dto.lines ?? []).map((l) => ({
      accountId: String(l.accountId ?? ""),
      debitMinor: toBig(l.debitMinor as any),
      creditMinor: toBig(l.creditMinor as any),
    }));
    if (lines.some((l) => !l.accountId)) throw badRequest("accounting.journalLineAccountIdRequired");
    const { entry, lines: created } = await this.createJournalEntry(orgId, actorId, {
      date, memo: dto.memo ? String(dto.memo).slice(0, 500) : null,
      sourceType: "manual", sourceId: null, lines,
    });
    await this.safeAudit({ organizationId: orgId, userId: actorId, action: "accounting.journal_manual_created", entityType: "JournalEntry", entityId: String(entry.id), metadata: { lines: created.length } });
    return { entry: this.serializeEntry(entry, created) };
  }

  private serializeEntry(entry: any, lines: any[], accountById?: Map<string, any>) {
    return {
      id: String(entry.id), date: entry.date ? dhakaDateKey(new Date(entry.date)) : null,
      memo: entry.memo ?? null, sourceType: entry.sourceType ?? null, sourceId: entry.sourceId ?? null,
      createdById: entry.createdById ?? null, createdAt: entry.createdAt ?? null,
      totalDebitMinor: lines.reduce((s, l) => s + toBig(l.debitMinor), 0n).toString(),
      totalCreditMinor: lines.reduce((s, l) => s + toBig(l.creditMinor), 0n).toString(),
      lines: lines.map((l) => ({
        id: String(l.id), accountId: String(l.accountId),
        accountCode: accountById?.get(String(l.accountId))?.code ?? null,
        accountName: accountById?.get(String(l.accountId))?.name ?? null,
        debitMinor: toBig(l.debitMinor).toString(), creditMinor: toBig(l.creditMinor).toString(),
      })),
    };
  }

  async listEntries(orgId: string, q: { page?: string; pageSize?: string; sourceType?: string } = {}) {
    const page = Math.max(1, Number.parseInt(q.page ?? "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(q.pageSize ?? "25", 10) || 25));
    const where: any = { organizationId: orgId };
    if (q.sourceType) where.sourceType = q.sourceType;
    const [total, entries] = await Promise.all([
      this.t("journalEntry").count({ where }),
      this.t("journalEntry").findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    const accounts = await this.ensureAccounts(orgId).catch(() => []);
    const accountById = new Map(accounts.map((a: any) => [String(a.id), a]));
    const items: any[] = [];
    for (const e of entries) {
      const lines = await this.t("journalLine").findMany({ where: { entryId: String(e.id) } });
      items.push(this.serializeEntry(e, lines, accountById));
    }
    return { items, total, page, pageSize, disclaimer: ACCOUNTING_DISCLAIMER };
  }

  // ---------------- COGS ----------------

  /** COGS for one order from REAL ProductCost rows only.
   * Returns cogsMinor = null when ANY line lacks a usable cost
   * (no linked product, or no cost row) — a partial COGS would
   * understate cost, so the whole order's COGS is omitted and
   * the gap is counted instead. Cost pick per product: the
   * product-level row (variantId null — OrderItem carries no
   * variant id) with the latest effectiveFrom; if none, the
   * latest cost row of any variant of that product. */
  async orderCogs(orgId: string, order: any): Promise<{ cogsMinor: bigint | null; missing: boolean }> {
    const items = await this.t("orderItem").findMany({ where: { orderId: String(order.id) } }).catch(() => []);
    if (!items.length) return { cogsMinor: null, missing: true };
    let total = 0n;
    for (const item of items) {
      if (!item.productId) return { cogsMinor: null, missing: true };
      const costs = await this.t("productCost").findMany({ where: { productId: String(item.productId) } }).catch(() => []);
      if (!costs.length) return { cogsMinor: null, missing: true };
      const byEffective = [...costs].sort((a: any, b: any) => new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime());
      const pick = byEffective.find((c: any) => c.variantId === null || c.variantId === undefined) ?? byEffective[0];
      total += toBig(pick.costMinor) * BigInt(Number(item.quantity ?? 0));
    }
    return { cogsMinor: total, missing: false };
  }

  // ---------------- auto-generation ----------------

  async generateOrderEntry(orgId: string, order: any): Promise<{ created: boolean; cogsMissing: boolean }> {
    const total = toBig(order.totalMinor);
    const { cogsMinor, missing } = await this.orderCogs(orgId, order);
    if (total <= 0n && !(cogsMinor && cogsMinor > 0n)) return { created: false, cogsMissing: missing };
    const [ar, sales, delivery, vat, cogsAcc, inventory] = await Promise.all([
      this.accountByKey(orgId, "accounts_receivable"), this.accountByKey(orgId, "sales_revenue"),
      this.accountByKey(orgId, "delivery_income"), this.accountByKey(orgId, "vat_payable"),
      this.accountByKey(orgId, "cogs"), this.accountByKey(orgId, "inventory"),
    ]);
    const lines: Array<{ accountId: string; debitMinor: bigint; creditMinor: bigint }> = [];
    if (total > 0n) {
      const shipping = toBig(order.shippingMinor) > total ? total : toBig(order.shippingMinor);
      const afterShip = total - shipping;
      const tax = toBig(order.taxMinor) > afterShip ? afterShip : toBig(order.taxMinor);
      const salesAmt = total - shipping - tax;
      lines.push({ accountId: String(ar.id), debitMinor: total, creditMinor: 0n });
      if (salesAmt > 0n) lines.push({ accountId: String(sales.id), debitMinor: 0n, creditMinor: salesAmt });
      if (shipping > 0n) lines.push({ accountId: String(delivery.id), debitMinor: 0n, creditMinor: shipping });
      if (tax > 0n) lines.push({ accountId: String(vat.id), debitMinor: 0n, creditMinor: tax });
    }
    if (cogsMinor && cogsMinor > 0n) {
      lines.push({ accountId: String(cogsAcc.id), debitMinor: cogsMinor, creditMinor: 0n });
      lines.push({ accountId: String(inventory.id), debitMinor: 0n, creditMinor: cogsMinor });
    }
    const date = new Date(order.placedAt ?? order.createdAt);
    const { created } = await this.createJournalEntry(orgId, undefined, {
      date, memo: `অর্ডার ${order.externalNumber ?? order.id} — বিক্রি`,
      sourceType: "order", sourceId: String(order.id), lines,
    });
    return { created, cogsMissing: missing };
  }

  async generatePaymentEntry(orgId: string, pv: any): Promise<boolean> {
    const amount = toBig(pv.amountMinor);
    if (amount <= 0n) return false;
    const provider = String(pv.provider ?? "").toLowerCase();
    const cashKey = provider === "bkash" ? "bkash" : provider === "bank" ? "bank" : "cash";
    const [cashAcc, ar] = await Promise.all([this.accountByKey(orgId, cashKey), this.accountByKey(orgId, "accounts_receivable")]);
    const { created } = await this.createJournalEntry(orgId, undefined, {
      date: new Date(pv.createdAt), memo: `যাচাইকৃত পেমেন্ট ${pv.trxId ?? pv.id} (${provider || "unknown"})`,
      sourceType: "payment", sourceId: String(pv.id),
      lines: [
        { accountId: String(cashAcc.id), debitMinor: amount, creditMinor: 0n },
        { accountId: String(ar.id), debitMinor: 0n, creditMinor: amount },
      ],
    });
    return created;
  }

  /** The expense forward-hook door (also used by the sync). */
  async generateExpenseEntry(orgId: string, expense: any): Promise<boolean> {
    const amount = toBig(expense.amountMinor);
    if (amount <= 0n) return false;
    const catKey = EXPENSE_CATEGORY_ACCOUNT[String(expense.category)] ?? "expense_other";
    const method = String(expense.paymentMethod ?? "cash").toLowerCase();
    const cashKey = method === "bkash" ? "bkash" : method === "bank" ? "bank" : "cash";
    const [expAcc, cashAcc] = await Promise.all([this.accountByKey(orgId, catKey), this.accountByKey(orgId, cashKey)]);
    const { created } = await this.createJournalEntry(orgId, undefined, {
      date: new Date(expense.spentAt), memo: `খরচ · ${String(expense.category)}${expense.note ? ` · ${String(expense.note).slice(0, 60)}` : ""}`,
      sourceType: "expense", sourceId: String(expense.id),
      lines: [
        { accountId: String(expAcc.id), debitMinor: amount, creditMinor: 0n },
        { accountId: String(cashAcc.id), debitMinor: 0n, creditMinor: amount },
      ],
    });
    return created;
  }

  async generateCourierEntry(orgId: string, shipment: any): Promise<boolean> {
    // Prefer the settlement-sheet charge (the courier's own
    // actual) over the booking-time chargeMinor.
    let charge: bigint | null = null;
    const sheetLines = await this.t("reconciliationLine").findMany({
      where: { organizationId: orgId, matchedShipmentId: String(shipment.id) },
    }).catch(() => []);
    for (const l of sheetLines ?? []) {
      if (l.sheetChargeMinor !== null && l.sheetChargeMinor !== undefined && toBig(l.sheetChargeMinor) > 0n) {
        charge = toBig(l.sheetChargeMinor);
        break;
      }
    }
    if (charge === null && shipment.chargeMinor !== null && shipment.chargeMinor !== undefined) charge = toBig(shipment.chargeMinor);
    if (charge === null || charge <= 0n) return false;
    const [courierAcc, ap] = await Promise.all([this.accountByKey(orgId, "courier_charges"), this.accountByKey(orgId, "accounts_payable")]);
    const { created } = await this.createJournalEntry(orgId, undefined, {
      date: new Date(shipment.createdAt), memo: `কুরিয়ার চার্জ · ${String(shipment.provider ?? "")} ${String(shipment.trackingCode ?? shipment.id)}`,
      sourceType: "courier_charge", sourceId: String(shipment.id),
      lines: [
        { accountId: String(courierAcc.id), debitMinor: charge, creditMinor: 0n },
        { accountId: String(ap.id), debitMinor: 0n, creditMinor: charge },
      ],
    });
    return created;
  }

  /** Idempotent generation over ALL source records of the org.
   * Order is deliberate: revenue → payments → expenses → courier. */
  async syncAutoEntries(orgId: string, actorId?: string) {
    await this.ensureAccounts(orgId);
    const result = {
      ordersCreated: 0, ordersSkippedExisting: 0, paymentsCreated: 0, expensesCreated: 0,
      courierCreated: 0, cogsMissingOrders: 0,
    };
    const orders = await this.t("order").findMany({ where: { organizationId: orgId, isPractice: false } });
    for (const o of orders) {
      if (!SOLD_STATUSES.includes(String(o.status))) continue;
      const before = await this.t("journalEntry").findFirst({ where: { organizationId: orgId, sourceType: "order", sourceId: String(o.id) } });
      const r = await this.generateOrderEntry(orgId, o);
      if (r.cogsMissing) result.cogsMissingOrders += 1;
      if (r.created) result.ordersCreated += 1;
      else if (before) result.ordersSkippedExisting += 1;
    }
    const payments = await this.t("paymentVerification").findMany({ where: { organizationId: orgId, status: "approved" } });
    for (const pv of payments) {
      if (await this.generatePaymentEntry(orgId, pv)) result.paymentsCreated += 1;
    }
    const expenses = await this.t("expense").findMany({ where: { organizationId: orgId } });
    for (const e of expenses) {
      if (await this.generateExpenseEntry(orgId, e)) result.expensesCreated += 1;
    }
    const shipments = await this.t("courierShipment").findMany({ where: { organizationId: orgId } });
    for (const s of shipments) {
      if (await this.generateCourierEntry(orgId, s)) result.courierCreated += 1;
    }
    await this.safeAudit({ organizationId: orgId, userId: actorId, action: "accounting.sync_generated", entityType: "JournalEntry", entityId: orgId, metadata: { ...result } });
    return { ...result, disclaimer: ACCOUNTING_DISCLAIMER };
  }

  // ---------------- reports (journal ONLY) ----------------

  private async journalLinesInRange(orgId: string, start: Date, end: Date, upto?: Date) {
    const where: any = { organizationId: orgId, date: upto ? { lte: upto } : { gte: start, lte: end } };
    const entries = await this.t("journalEntry").findMany({ where });
    const entryIds = new Set(entries.map((e: any) => String(e.id)));
    if (!entryIds.size) return { entries, lines: [] as any[] };
    const all = await this.t("journalLine").findMany({ where: { entryId: { in: [...entryIds] } } }).catch(() => []);
    return { entries, lines: (all ?? []).filter((l: any) => entryIds.has(String(l.entryId))) };
  }

  private async cogsMissingCount(orgId: string, start: Date, end: Date): Promise<number> {
    const orders = await this.t("order").findMany({ where: { organizationId: orgId, isPractice: false } });
    let count = 0;
    for (const o of orders) {
      if (!SOLD_STATUSES.includes(String(o.status))) continue;
      const d = new Date(o.placedAt ?? o.createdAt);
      if (d.getTime() < start.getTime() || d.getTime() > end.getTime()) continue;
      const { missing } = await this.orderCogs(orgId, o);
      if (missing) count += 1;
    }
    return count;
  }

  async profitAndLoss(orgId: string, month: string) {
    await this.syncAutoEntries(orgId);
    const { start, end } = monthRange(month);
    const accounts = await this.ensureAccounts(orgId);
    const byId = new Map(accounts.map((a: any) => [String(a.id), a]));
    const { lines } = await this.journalLinesInRange(orgId, start, end);
    const perAccount = new Map<string, bigint>();
    for (const l of lines) {
      const acc = byId.get(String(l.accountId));
      if (!acc) continue;
      const net = acc.type === "income" ? toBig(l.creditMinor) - toBig(l.debitMinor) : toBig(l.debitMinor) - toBig(l.creditMinor);
      perAccount.set(String(acc.id), (perAccount.get(String(acc.id)) ?? 0n) + net);
    }
    const rows = accounts
      .filter((a: any) => a.type === "income" || a.type === "expense")
      .map((a: any) => ({
        accountId: String(a.id), code: String(a.code), name: String(a.name), type: String(a.type),
        systemKey: a.systemKey ?? null, amountMinor: (perAccount.get(String(a.id)) ?? 0n).toString(),
      }))
      .sort((a: any, b: any) => a.code.localeCompare(b.code));
    const sum = (pred: (r: any) => boolean) => rows.filter(pred).reduce((s: bigint, r: any) => s + toBig(r.amountMinor), 0n);
    const totalIncome = sum((r) => r.type === "income");
    const cogs = sum((r) => r.systemKey === "cogs");
    const totalExpenses = sum((r) => r.type === "expense" && r.systemKey !== "cogs");
    const grossProfit = totalIncome - cogs;
    const netProfit = grossProfit - totalExpenses;
    const cogsMissingOrders = await this.cogsMissingCount(orgId, start, end);
    return {
      month, rows,
      totals: {
        totalIncomeMinor: totalIncome.toString(), cogsMinor: cogs.toString(),
        grossProfitMinor: grossProfit.toString(), totalExpensesMinor: totalExpenses.toString(),
        netProfitMinor: netProfit.toString(),
      },
      cogsMissingOrders,
      cogsNote: cogsMissingOrders > 0 ? `${cogsMissingOrders}টি বিক্রীত অর্ডারের পণ্য-খরচ (ProductCost) পাওয়া যায়নি — সেগুলোর COGS এই হিসাবে ধরা হয়নি।` : null,
      disclaimer: ACCOUNTING_DISCLAIMER,
    };
  }

  async vatSummary(orgId: string, month: string) {
    await this.syncAutoEntries(orgId);
    const { start, end } = monthRange(month);
    const vatAcc = await this.accountByKey(orgId, "vat_payable");
    const monthData = await this.journalLinesInRange(orgId, start, end);
    const monthLines = monthData.lines.filter((l: any) => String(l.accountId) === String(vatAcc.id));
    const collected = monthLines.reduce((s: bigint, l: any) => s + toBig(l.creditMinor), 0n);
    const paid = monthLines.reduce((s: bigint, l: any) => s + toBig(l.debitMinor), 0n);
    const uptoData = await this.journalLinesInRange(orgId, start, end, end);
    const uptoLines = uptoData.lines.filter((l: any) => String(l.accountId) === String(vatAcc.id));
    const balance = uptoLines.reduce((s: bigint, l: any) => s + toBig(l.creditMinor) - toBig(l.debitMinor), 0n);
    const setting = await this.t("taxSetting").findFirst({ where: { organizationId: orgId } }).catch(() => null);
    const rateBps = setting?.defaultVatBps ?? null;
    return {
      month,
      account: { id: String(vatAcc.id), code: String(vatAcc.code), name: String(vatAcc.name) },
      accountsUsed: [`${vatAcc.code} ${vatAcc.name}`],
      collectedMinor: collected.toString(),
      paidMinor: paid.toString(),
      monthNetMinor: (collected - paid).toString(),
      balanceMinor: balance.toString(),
      vatRateBps: rateBps,
      pricesIncludeVat: setting ? Boolean(setting.pricesIncludeVat) : null,
      rateNote: rateBps === null
        ? "এই organization-এর TaxSetting-এ VAT হার সেট করা হয়নি — কোনো হার ধরা হয়নি; শুধু জার্নালের VAT Payable খাতে রেকর্ড করা পরিমাণ দেখানো হচ্ছে।"
        : `হার TaxSetting.defaultVatBps থেকে নেওয়া (${rateBps} bps) — পরিমাণগুলো জার্নাল থেকে, হার দিয়ে পুনঃহিসাব করা নয়।`,
      disclaimer: ACCOUNTING_DISCLAIMER,
    };
  }

  /** PDF via the EXISTING courier/pdf toolkit (PdfCanvas +
   * buildPdf) — the same machinery labels/invoices use. Its
   * documented WinAnsi limit applies: the Bengali disclaimer is
   * passed through pdfText (non-WinAnsi glyphs render as "?"),
   * so the PDF also carries the English gloss line; the web
   * page + JSON carry the disclaimer verbatim. */
  async buildReportPdf(orgId: string, kind: "pnl" | "vat", month: string): Promise<Buffer> {
    const org = await this.t("organization").findFirst({ where: { id: orgId } }).catch(() => null);
    const orgName = org?.name ? String(org.name) : "Organization";
    const c = new PdfCanvas();
    const W = 595, H = 842;
    let y = H - 56;
    c.text(48, y, 16, orgName, true); y -= 22;
    c.text(48, y, 13, kind === "pnl" ? "PROFIT & LOSS (from journal)" : "VAT SUMMARY (from journal)", true); y -= 16;
    c.text(48, y, 10, `Month: ${month}`); y -= 10;
    c.line(48, y, W - 48); y -= 20;
    const row = (label: string, minor: string, bold = false) => {
      c.text(48, y, 10, label, bold);
      c.text(W - 190, y, 10, moneyText(toBig(minor)), bold);
      y -= 15;
    };
    if (kind === "pnl") {
      const pnl = await this.profitAndLoss(orgId, month);
      for (const r of pnl.rows) {
        if (toBig(r.amountMinor) === 0n) continue;
        row(`${r.code} ${r.name} (${r.type})`, r.amountMinor);
      }
      y -= 6; c.line(48, y, W - 48); y -= 20;
      row("Total income", pnl.totals.totalIncomeMinor, true);
      row("COGS", pnl.totals.cogsMinor);
      row("Gross profit", pnl.totals.grossProfitMinor, true);
      row("Total expenses (excl. COGS)", pnl.totals.totalExpensesMinor);
      row("Net profit", pnl.totals.netProfitMinor, true);
      if (pnl.cogsMissingOrders > 0) {
        y -= 8;
        c.text(48, y, 9, `COGS missing for ${pnl.cogsMissingOrders} sold order(s) - no ProductCost recorded; COGS omitted for those orders.`); y -= 13;
      }
    } else {
      const vat = await this.vatSummary(orgId, month);
      row(`${vat.account.code} ${vat.account.name} - collected (credit)`, vat.collectedMinor);
      row(`${vat.account.code} ${vat.account.name} - paid (debit)`, vat.paidMinor);
      row("Month net", vat.monthNetMinor, true);
      row("Cumulative VAT payable balance", vat.balanceMinor, true);
      y -= 8;
      c.text(48, y, 9, vat.vatRateBps === null ? "VAT rate: not configured in TaxSetting - amounts are journal amounts only, no rate assumed." : `VAT rate (TaxSetting): ${vat.vatRateBps} bps - amounts are journal amounts, not recomputed.`); y -= 13;
    }
    c.text(48, 72, 8, "Accounting aid tool - not audited or statutory accounts.");
    c.text(48, 58, 8, ACCOUNTING_DISCLAIMER);
    return buildPdf([{ width: W, height: H, content: c.build() }]);
  }

  // ---------------- statement import + matching ----------------

  async importStatement(orgId: string, actorId: string, dto: {
    csvText?: string; fileName?: string; accountLabel?: string; force?: boolean;
    mapping?: { dateColumn?: string; descriptionColumn?: string; amountColumn?: string; directionColumn?: string };
  }) {
    const mapping = dto?.mapping ?? {};
    const dateColumn = String(mapping.dateColumn ?? "").trim();
    const amountColumn = String(mapping.amountColumn ?? "").trim();
    const descriptionColumn = mapping.descriptionColumn ? String(mapping.descriptionColumn).trim() : undefined;
    const directionColumn = mapping.directionColumn ? String(mapping.directionColumn).trim() : undefined;
    if (!dateColumn || !amountColumn) throw badRequest("accounting.mappingColumnsRequired");
    if (typeof dto?.csvText !== "string" || !dto.csvText.trim()) throw badRequest("accounting.csvNoHeader");
    const { createHash } = await import("crypto");
    const fileHash = createHash("sha256").update(dto.csvText).digest("hex");
    if (!dto.force) {
      const prior = await this.t("reconciliationImport").findFirst({ where: { organizationId: orgId, kind: "bank_statement", fileHash } });
      if (prior) throw badRequest("accounting.fileAlreadyImported");
    }
    const parsed = Papa.parse<Record<string, string>>(dto.csvText, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
    const headers = ((parsed.meta.fields ?? []) as string[]).map((h) => h.trim()).filter(Boolean);
    if (!headers.length) throw badRequest("accounting.csvNoHeader");
    for (const col of [dateColumn, amountColumn, descriptionColumn, directionColumn]) {
      if (col && !headers.includes(col)) throw badRequest("accounting.mappingColumnNotFound", { column: col });
    }
    const rows = (parsed.data ?? []).filter((r) => r && Object.values(r).some((v) => String(v ?? "").trim() !== ""));
    if (!rows.length) throw badRequest("accounting.csvNoDataRows");
    if (rows.length > 5000) throw badRequest("accounting.importRowsMax");

    const importRow = await this.t("reconciliationImport").create({
      data: {
        organizationId: orgId, courierIntegrationId: null, kind: "bank_statement",
        accountLabel: dto.accountLabel ? String(dto.accountLabel).slice(0, 200) : null,
        fileName: dto.fileName ?? null, fileHash, rowCount: rows.length, status: "processed", createdBy: actorId,
      },
    });

    // Suggestion pools: cash-like journal lines + approved
    // payment verifications of THIS org. Suggestions only —
    // matchState never becomes "matched" here.
    const accounts = await this.ensureAccounts(orgId);
    const cashLikeIds = new Set(accounts.filter((a: any) => CASH_LIKE_KEYS.includes(String(a.systemKey))).map((a: any) => String(a.id)));
    const entries = await this.t("journalEntry").findMany({ where: { organizationId: orgId } });
    const entryById = new Map<string, any>(entries.map((e: any) => [String(e.id), e] as [string, any]));
    const entryIds = entries.map((e: any) => String(e.id));
    const jLines = entryIds.length ? await this.t("journalLine").findMany({ where: { entryId: { in: entryIds } } }).catch(() => []) : [];
    const cashLines = (jLines ?? []).filter((l: any) => cashLikeIds.has(String(l.accountId)));
    const payments = await this.t("paymentVerification").findMany({ where: { organizationId: orgId, status: "approved" } }).catch(() => []);

    const WINDOW_MS = 3 * 86400_000;
    const suggestFor = (date: Date, amount: bigint, direction: "credit" | "debit"): { type: string; id: string } | null => {
      const t = date.getTime();
      for (const l of cashLines) {
        const entry = entryById.get(String(l.entryId));
        if (!entry) continue;
        const et = new Date(entry.date).getTime();
        if (Math.abs(et - t) > WINDOW_MS) continue;
        const hit = direction === "credit" ? toBig(l.debitMinor) === amount : toBig(l.creditMinor) === amount;
        if (hit) return { type: "journal_entry", id: String(entry.id) };
      }
      if (direction === "credit") {
        for (const pv of payments ?? []) {
          if (toBig(pv.amountMinor) !== amount) continue;
          if (Math.abs(new Date(pv.createdAt).getTime() - t) > WINDOW_MS) continue;
          return { type: "payment_verification", id: String(pv.id) };
        }
      }
      return null;
    };

    let suggested = 0, rowErrors = 0;
    const createdLines: any[] = [];
    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      const date = parseStatementDate(row[dateColumn]);
      const money = parseStatementMoney(row[amountColumn]);
      const description = descriptionColumn ? String(row[descriptionColumn] ?? "").trim() || null : null;
      let direction: "credit" | "debit" | null = null;
      if (directionColumn) {
        const dv = String(row[directionColumn] ?? "").trim().toLowerCase();
        if (["credit", "cr", "in", "deposit", "জমা"].includes(dv)) direction = "credit";
        else if (["debit", "dr", "out", "withdrawal", "খরচ"].includes(dv)) direction = "debit";
      }
      if (!direction && money) direction = money.negative ? "debit" : "credit";
      const line: any = {
        importId: String(importRow.id), organizationId: orgId, rowNumber: idx + 1,
        rawTrackingId: null, rawOrderRef: null,
        sheetAmountMinor: money ? money.abs : null, sheetChargeMinor: null, sheetStatus: null,
        matchedOrderId: null, matchedShipmentId: null, expectedMinor: null,
        outcome: "statement", note: null,
        statementDate: date, description, direction,
        matchState: "unmatched", suggestedRefType: null, suggestedRefId: null,
      };
      if (!date || !money || money.abs <= 0n || !direction) {
        line.outcome = "row_error";
        line.note = "তারিখ বা পরিমাণ পড়া যায়নি";
        rowErrors += 1;
      } else {
        const s = suggestFor(date, money.abs, direction);
        if (s) { line.matchState = "suggested"; line.suggestedRefType = s.type; line.suggestedRefId = s.id; suggested += 1; }
      }
      createdLines.push(await this.t("reconciliationLine").create({ data: line }));
    }
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "accounting.statement_imported",
      entityType: "ReconciliationImport", entityId: String(importRow.id),
      metadata: { accountLabel: dto.accountLabel ?? null, rowCount: rows.length, suggested, rowErrors },
    });
    return {
      import: { id: String(importRow.id), kind: "bank_statement", accountLabel: importRow.accountLabel ?? null, fileName: importRow.fileName ?? null, rowCount: rows.length, status: "processed", createdAt: importRow.createdAt ?? null },
      counts: { rowCount: rows.length, suggested, unmatched: rows.length - suggested - rowErrors, rowErrors },
      disclaimer: ACCOUNTING_DISCLAIMER,
    };
  }

  async listStatementImports(orgId: string) {
    const rows = await this.t("reconciliationImport").findMany({
      where: { organizationId: orgId, kind: "bank_statement" }, orderBy: { createdAt: "desc" },
    });
    return {
      items: rows.map((r: any) => ({
        id: String(r.id), kind: "bank_statement", accountLabel: r.accountLabel ?? null,
        fileName: r.fileName ?? null, rowCount: Number(r.rowCount ?? 0), status: String(r.status ?? "processed"),
        createdAt: r.createdAt ?? null,
      })),
      disclaimer: ACCOUNTING_DISCLAIMER,
    };
  }

  private serializeStatementLine(l: any) {
    return {
      id: String(l.id), importId: String(l.importId), rowNumber: Number(l.rowNumber ?? 0),
      statementDate: l.statementDate ? dhakaDateKey(new Date(l.statementDate)) : null,
      description: l.description ?? null, direction: l.direction ?? null,
      amountMinor: l.sheetAmountMinor != null ? toBig(l.sheetAmountMinor).toString() : null,
      outcome: String(l.outcome), matchState: String(l.matchState ?? "unmatched"),
      suggestedRefType: l.suggestedRefType ?? null, suggestedRefId: l.suggestedRefId ?? null,
      note: l.note ?? null, reviewedAt: l.reviewedAt ?? null, reviewedBy: l.reviewedBy ?? null,
    };
  }

  async listStatementLines(orgId: string, importId: string, matchState?: string) {
    const imp = await this.t("reconciliationImport").findFirst({ where: { id: importId, organizationId: orgId, kind: "bank_statement" } });
    if (!imp) throw notFound("accounting.statementImportNotFound");
    const where: any = { importId, organizationId: orgId };
    if (matchState) where.matchState = matchState;
    const rows = await this.t("reconciliationLine").findMany({ where, orderBy: { rowNumber: "asc" } });
    return { items: rows.map((l: any) => this.serializeStatementLine(l)), disclaimer: ACCOUNTING_DISCLAIMER };
  }

  /** Human confirm / reject ONLY. Confirm verifies the chosen
   * counterpart belongs to this org; reject keeps the suggestion
   * on record but marks the line rejected. Nothing anywhere
   * auto-confirms (spec-proven). */
  async resolveStatementLine(orgId: string, actorId: string, lineId: string, dto: { action?: string; refType?: string; refId?: string }) {
    const line = await this.t("reconciliationLine").findFirst({ where: { id: lineId, organizationId: orgId } });
    if (!line) throw notFound("accounting.statementLineNotFound");
    const imp = await this.t("reconciliationImport").findFirst({ where: { id: String(line.importId), organizationId: orgId, kind: "bank_statement" } });
    if (!imp) throw notFound("accounting.statementLineNotFound");
    if (dto?.action === "confirm") {
      const refType = dto.refType ?? line.suggestedRefType;
      const refId = dto.refId ?? line.suggestedRefId;
      if (!refType || !refId) throw badRequest("accounting.matchNothingChosen");
      if (refType === "journal_entry") {
        const entry = await this.t("journalEntry").findFirst({ where: { id: String(refId), organizationId: orgId } });
        if (!entry) throw badRequest("accounting.journalEntryNotOfOrg");
      } else if (refType === "payment_verification") {
        const pv = await this.t("paymentVerification").findFirst({ where: { id: String(refId), organizationId: orgId } });
        if (!pv) throw badRequest("accounting.paymentRecordNotOfOrg");
      } else {
        throw badRequest("accounting.refTypeInvalid");
      }
      const updated = await this.t("reconciliationLine").update({
        where: { id: lineId },
        data: { matchState: "matched", suggestedRefType: String(refType), suggestedRefId: String(refId), reviewedAt: new Date(), reviewedBy: actorId },
      });
      await this.safeAudit({ organizationId: orgId, userId: actorId, action: "accounting.statement_line_confirmed", entityType: "ReconciliationLine", entityId: lineId, metadata: { refType, refId } });
      return { line: this.serializeStatementLine(updated) };
    }
    if (dto?.action === "reject") {
      const updated = await this.t("reconciliationLine").update({
        where: { id: lineId },
        data: { matchState: "rejected", reviewedAt: new Date(), reviewedBy: actorId },
      });
      await this.safeAudit({ organizationId: orgId, userId: actorId, action: "accounting.statement_line_rejected", entityType: "ReconciliationLine", entityId: lineId, metadata: {} });
      return { line: this.serializeStatementLine(updated) };
    }
    throw badRequest("accounting.unknownActionConfirmReject", { action: dto?.action });
  }
}
