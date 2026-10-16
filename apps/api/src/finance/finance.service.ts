import { Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { FinanceReportsService } from "./finance-reports.service";
import {
  buildFileFromSections,
  dhakaDateKey,
  groupByOrderId,
  inRange,
  isSoldOrderShape,
  orderEffectiveDate,
  parseFinanceRange,
  toBig,
  type BuiltFile,
  type FinanceRange,
  type ReportSection,
} from "./finance-common";

/**
 * GB8 (GC20) — expenses, ledger VIEWS and the accounting-format
 * (generic double-entry) export.
 *
 * Every ledger below is a formal VIEW over real records (orders,
 * shipment COD stamps, reconciliation imports/lines, return
 * requests) — definitions are stated per ledger and match the
 * EC19/EC23/ON7/EC26 originals; nothing here keeps a second set
 * of books.
 */

export const EXPENSE_CATEGORIES = ["rent", "salary", "marketing", "packaging", "delivery", "utilities", "inventory_purchase", "other"] as const;
export const EXPENSE_PAYMENT_METHODS = ["cash", "bank", "bkash", "other"] as const;

const TAKE = 5001;
const MAX_EXPENSE_MINOR = 10n ** 14n; // ৳10,00,000,00,000.00 guardrail

function pageArgs(page?: string, pageSize?: string): { page: number; pageSize: number } {
  const p = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  const ps = Math.min(100, Math.max(1, Number.parseInt(pageSize ?? "25", 10) || 25));
  return { page: p, pageSize: ps };
}

/** A merchant date (YYYY-MM-DD) → the Dhaka-midnight instant. */
export function parseSpentAt(raw: unknown): Date {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error("খরচের তারিখ YYYY-MM-DD আকারে দিন");
  const d = new Date(`${raw}T00:00:00+06:00`);
  if (Number.isNaN(d.getTime()) || dhakaDateKey(d) !== raw) throw new Error("খরচের তারিখটি সঠিক নয়");
  return d;
}

export function parseAmountMinor(raw: unknown): bigint {
  let v: bigint;
  try { v = toBig(typeof raw === "string" || typeof raw === "number" || typeof raw === "bigint" ? (raw as any) : "__bad__"); }
  catch { throw new Error("পরিমাণটি সঠিক সংখ্যা নয়"); }
  if (v <= 0n) throw new Error("পরিমাণ শূন্যের বেশি হতে হবে");
  if (v > MAX_EXPENSE_MINOR) throw new Error("পরিমাণটি অস্বাভাবিক বড়");
  return v;
}

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly reports: FinanceReportsService,
  ) {}

  private t(name: string): any {
    return (this.prisma as any)[name];
  }

  /** Display names from the Customer relation (Order has no
   * customerName scalar — the EC23 composition). */
  private async customerNameMap(organizationId: string, orders: any[]): Promise<Map<string, string | null>> {
    const map = new Map<string, string | null>();
    const ids = [...new Set(orders.map((o) => o.customerId).filter(Boolean).map(String))];
    if (!ids.length) return map;
    const rows = await this.t("customer").findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, firstName: true, lastName: true },
    });
    for (const c of rows) {
      map.set(String(c.id), [c.firstName, c.lastName].filter(Boolean).join(" ") || null);
    }
    return map;
  }

  /** Order has NO shipments / paymentVerifications relations —
   * load both tables flat and attach `_shipments` /
   * `_verifications` (the ON7/EC23 pattern). */
  private async attachOrderRelations(organizationId: string, orders: any[]): Promise<void> {
    if (!orders.length) return;
    const ids = orders.map((o) => String(o.id));
    const [shipments, verifications] = await Promise.all([
      this.t("courierShipment").findMany({ where: { organizationId, orderId: { in: ids } }, take: 20001 }),
      this.t("paymentVerification").findMany({ where: { organizationId, orderId: { in: ids } }, take: 20001 }),
    ]);
    const shipBy = groupByOrderId(shipments);
    const verBy = groupByOrderId(verifications);
    for (const o of orders) {
      o._shipments = shipBy.get(String(o.id)) ?? [];
      o._verifications = verBy.get(String(o.id)) ?? [];
    }
  }

  // ---------------- expenses ----------------

  private serializeExpense(e: any) {
    return {
      id: String(e.id),
      category: String(e.category),
      amountMinor: toBig(e.amountMinor).toString(),
      spentAt: dhakaDateKey(new Date(e.spentAt)),
      note: e.note ?? null,
      paymentMethod: e.paymentMethod ?? null,
      receiptUrl: e.receiptUrl ?? null,
      createdById: e.createdById ?? null,
      createdAt: e.createdAt ? new Date(e.createdAt).toISOString() : null,
    };
  }

  private validateExpenseBody(body: any, partial: boolean): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (!partial || body.category !== undefined) {
      if (!EXPENSE_CATEGORIES.includes(body.category)) throw new Error("খরচের শ্রেণিটি তালিকা থেকে বেছে নিন");
      out.category = body.category;
    }
    if (!partial || body.amountMinor !== undefined) out.amountMinor = parseAmountMinor(body.amountMinor);
    if (!partial || body.spentAt !== undefined) out.spentAt = parseSpentAt(body.spentAt);
    if (body.note !== undefined) {
      if (body.note !== null && typeof body.note !== "string") throw new Error("নোট লেখা হতে হবে");
      out.note = body.note === null ? null : String(body.note).slice(0, 500);
    }
    if (body.paymentMethod !== undefined) {
      if (body.paymentMethod !== null && !EXPENSE_PAYMENT_METHODS.includes(body.paymentMethod)) throw new Error("পরিশোধের মাধ্যমটি তালিকা থেকে বেছে নিন");
      out.paymentMethod = body.paymentMethod;
    }
    if (body.receiptUrl !== undefined) {
      if (body.receiptUrl === null || body.receiptUrl === "") out.receiptUrl = null;
      else {
        let u: URL;
        try { u = new URL(String(body.receiptUrl)); } catch { throw new Error("রসিদের লিংকটি সঠিক URL নয়"); }
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("রসিদের লিংক http(s) হতে হবে");
        out.receiptUrl = u.toString();
      }
    }
    return out;
  }

  async listExpenses(organizationId: string, q: { from?: string; to?: string; page?: string; pageSize?: string }) {
    const { page, pageSize } = pageArgs(q.page, q.pageSize);
    const where: any = { organizationId };
    if (q.from || q.to) {
      const range = parseFinanceRange(q.from, q.to);
      where.spentAt = { gte: range.fromDate, lte: range.toDate };
    }
    const [total, rows] = await Promise.all([
      this.t("expense").count({ where }),
      this.t("expense").findMany({ where, orderBy: [{ spentAt: "desc" }, { createdAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return { items: rows.map((e: any) => this.serializeExpense(e)), total, page, pageSize };
  }

  async createExpense(organizationId: string, actorId: string | undefined, body: any) {
    const data = this.validateExpenseBody(body ?? {}, false);
    const row = await this.t("expense").create({ data: { organizationId, createdById: actorId ?? null, ...data } });
    await this.audit.log({ organizationId, userId: actorId, action: "finance.expense_created", entityType: "Expense", entityId: String(row.id), metadata: { category: row.category, amountMinor: toBig(row.amountMinor).toString() } }).catch(() => undefined);
    return this.serializeExpense(row);
  }

  async updateExpense(organizationId: string, actorId: string | undefined, id: string, body: any) {
    const existing = await this.t("expense").findFirst({ where: { id, organizationId } });
    if (!existing) throw new Error("খরচের রেকর্ডটি পাওয়া যায়নি");
    const data = this.validateExpenseBody(body ?? {}, true);
    const row = await this.t("expense").update({ where: { id }, data });
    await this.audit.log({ organizationId, userId: actorId, action: "finance.expense_updated", entityType: "Expense", entityId: id, metadata: { fields: Object.keys(data) } }).catch(() => undefined);
    return this.serializeExpense(row);
  }

  async deleteExpense(organizationId: string, actorId: string | undefined, id: string) {
    const existing = await this.t("expense").findFirst({ where: { id, organizationId } });
    if (!existing) throw new Error("খরচের রেকর্ডটি পাওয়া যায়নি");
    await this.t("expense").delete({ where: { id } });
    await this.audit.log({ organizationId, userId: actorId, action: "finance.expense_deleted", entityType: "Expense", entityId: id, metadata: { category: existing.category, amountMinor: toBig(existing.amountMinor).toString() } }).catch(() => undefined);
    return { ok: true };
  }

  /** Monthly summary: Dhaka month of spentAt; totals + per-category. */
  async expenseSummary(organizationId: string, month?: string) {
    const m = month && /^\d{4}-\d{2}$/.test(month) ? month : dhakaDateKey(new Date()).slice(0, 7);
    const [y, mo] = m.split("-").map(Number);
    const start = new Date(`${m}-01T00:00:00+06:00`);
    const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
    const rows = await this.t("expense").findMany({
      where: { organizationId, spentAt: { gte: start, lt: new Date(`${next}-01T00:00:00+06:00`) } },
      take: TAKE,
    });
    const inMonth = (rows as any[]).filter((e) => dhakaDateKey(new Date(e.spentAt)).slice(0, 7) === m);
    const byCategory = new Map<string, { count: number; total: bigint }>();
    let total = 0n;
    for (const e of inMonth) {
      const g = byCategory.get(String(e.category)) ?? { count: 0, total: 0n };
      g.count += 1; g.total += toBig(e.amountMinor);
      byCategory.set(String(e.category), g);
      total += toBig(e.amountMinor);
    }
    return {
      month: m,
      totalMinor: total.toString(),
      count: inMonth.length,
      byCategory: [...byCategory.entries()].map(([category, g]) => ({ category, count: g.count, totalMinor: g.total.toString() })),
    };
  }

  /** Σ expenses whose spentAt falls inside a range (GC20.4). */
  async expensesInRange(organizationId: string, range: FinanceRange): Promise<bigint> {
    const rows = await this.t("expense").findMany({
      where: { organizationId, spentAt: { gte: range.fromDate, lte: range.toDate } },
      select: { amountMinor: true },
      take: TAKE,
    });
    return rows.reduce((s: bigint, e: any) => s + toBig(e.amountMinor), 0n);
  }

  // ---------------- ledger: sales ----------------
  /**
   * Sold-bucket orders (ON7/EC33 predicate), paginated. paid =
   * Σ APPROVED PaymentVerification amounts (capped at the order
   * total for display); due = total − refunded − advances,
   * floored at 0 (the EC19/EC23 math). Period totals cover the
   * WHOLE filtered set, not just the page.
   */
  async salesLedger(organizationId: string, range: FinanceRange, q: { page?: string; pageSize?: string }) {
    const { page, pageSize } = pageArgs(q.page, q.pageSize);
    const rows = await this.t("order").findMany({
      where: { organizationId, isPractice: false },
      take: TAKE,
    });
    await this.attachOrderRelations(organizationId, rows);
    const sold = rows
      .filter((o: any) => inRange(orderEffectiveDate(o), range) && isSoldOrderShape(String(o.status), (o._shipments ?? []).map((s: any) => String(s.status))))
      .sort((a: any, b: any) => orderEffectiveDate(b).getTime() - orderEffectiveDate(a).getTime());
    const names = await this.customerNameMap(organizationId, sold);
    const view = sold.map((o: any) => {
      const advances = (o._verifications ?? [])
        .filter((v: any) => String(v.status) === "approved")
        .reduce((s: bigint, v: any) => s + toBig(v.amountMinor), 0n);
      const total = toBig(o.totalMinor);
      const paid = advances > total ? total : advances;
      const dueRaw = total - toBig(o.refundedMinor) - advances;
      return {
        date: dhakaDateKey(orderEffectiveDate(o)),
        orderId: String(o.id),
        orderNumber: o.externalNumber ?? null,
        customerName: o.customerId ? (names.get(String(o.customerId)) ?? null) : null,
        status: String(o.status),
        totalMinor: total.toString(),
        discountMinor: toBig(o.discountMinor).toString(),
        deliveryMinor: toBig(o.shippingMinor).toString(),
        taxMinor: toBig(o.taxMinor).toString(),
        paidMinor: paid.toString(),
        dueMinor: (dueRaw > 0n ? dueRaw : 0n).toString(),
      };
    });
    const sum = (k: string) => view.reduce((s: bigint, r: any) => s + toBig(r[k]), 0n).toString();
    return {
      kind: "sales",
      range: { from: range.from, to: range.to },
      rows: view.slice((page - 1) * pageSize, page * pageSize),
      totals: {
        orders: view.length,
        totalMinor: sum("totalMinor"), discountMinor: sum("discountMinor"),
        deliveryMinor: sum("deliveryMinor"), taxMinor: sum("taxMinor"),
        paidMinor: sum("paidMinor"), dueMinor: sum("dueMinor"),
      },
      total: view.length, page, pageSize,
      truncated: rows.length >= TAKE,
    };
  }

  // ---------------- ledger: COD receivable ----------------
  /**
   * Outstanding = CURRENT snapshot (not range-bound): sold COD
   * orders with due > 0, oldest first, aged by effective date.
   * Collections = EC26 CourierShipment codCollected stamps whose
   * codCollectedAt falls in the range (order, courier = the
   * shipment's provider, amount = codCollectedMinor).
   */
  async codReceivableLedger(organizationId: string, range: FinanceRange, now: Date = new Date()) {
    const rows = await this.t("order").findMany({
      where: { organizationId, isPractice: false, isCod: true },
      take: TAKE,
    });
    await this.attachOrderRelations(organizationId, rows);
    const outstandingAll = rows
      .filter((o: any) => isSoldOrderShape(String(o.status), (o._shipments ?? []).map((s: any) => String(s.status))))
      .map((o: any) => {
        const advances = (o._verifications ?? [])
          .filter((v: any) => String(v.status) === "approved")
          .reduce((s: bigint, v: any) => s + toBig(v.amountMinor), 0n);
        const due = toBig(o.totalMinor) - toBig(o.refundedMinor) - advances;
        const ageDays = Math.max(0, Math.floor((now.getTime() - orderEffectiveDate(o).getTime()) / 86400_000));
        return { o, due, ageDays };
      })
      .filter((x: any) => x.due > 0n)
      .sort((a: any, b: any) => b.ageDays - a.ageDays);
    const bucket = (pred: (d: number) => boolean) => {
      const xs = outstandingAll.filter((x: any) => pred(x.ageDays));
      return { count: xs.length, totalMinor: xs.reduce((s: bigint, x: any) => s + x.due, 0n).toString() };
    };
    const collections = await this.t("courierShipment").findMany({
      where: { organizationId, codCollectedAt: { gte: range.fromDate, lte: range.toDate } },
      orderBy: { codCollectedAt: "desc" },
      take: TAKE,
    });
    const orderNumbers = new Map<string, string | null>();
    if (collections.length) {
      const os = await this.t("order").findMany({
        where: { organizationId, id: { in: [...new Set(collections.map((s: any) => String(s.orderId)))] } },
        select: { id: true, externalNumber: true },
      });
      for (const o of os) orderNumbers.set(String(o.id), o.externalNumber ?? null);
    }
    const codNames = await this.customerNameMap(organizationId, outstandingAll.map((x: any) => x.o));
    return {
      kind: "cod_receivable",
      range: { from: range.from, to: range.to },
      outstanding: {
        totalMinor: outstandingAll.reduce((s: bigint, x: any) => s + x.due, 0n).toString(),
        count: outstandingAll.length,
        buckets: { d0_7: bucket((d) => d <= 7), d8_30: bucket((d) => d >= 8 && d <= 30), d31plus: bucket((d) => d >= 31) },
        rows: outstandingAll.slice(0, 200).map((x: any) => ({
          orderId: String(x.o.id),
          orderNumber: x.o.externalNumber ?? null,
          customerName: x.o.customerId ? (codNames.get(String(x.o.customerId)) ?? null) : null,
          date: dhakaDateKey(orderEffectiveDate(x.o)),
          totalMinor: toBig(x.o.totalMinor).toString(),
          dueMinor: x.due.toString(),
          ageDays: x.ageDays,
        })),
        truncated: outstandingAll.length > 200,
      },
      collections: {
        count: collections.length,
        totalMinor: collections.reduce((s: bigint, sh: any) => s + (sh.codCollectedMinor != null ? toBig(sh.codCollectedMinor) : 0n), 0n).toString(),
        rows: collections.slice(0, 500).map((sh: any) => ({
          date: dhakaDateKey(new Date(sh.codCollectedAt)),
          orderId: String(sh.orderId),
          orderNumber: orderNumbers.get(String(sh.orderId)) ?? null,
          provider: String(sh.provider ?? "unknown"),
          amountMinor: sh.codCollectedMinor != null ? toBig(sh.codCollectedMinor).toString() : null,
        })),
      },
    };
  }

  // ---------------- ledger: courier settlements + mismatches ----

  private async importsInRange(organizationId: string, range: FinanceRange) {
    const imports = await this.t("reconciliationImport").findMany({
      where: { organizationId, createdAt: { gte: range.fromDate, lte: range.toDate } },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const providerByIntegration = new Map<string, string>();
    const integrationIds = [...new Set(imports.map((i: any) => String(i.courierIntegrationId)).filter(Boolean))];
    if (integrationIds.length) {
      const rows = await this.t("integration").findMany({ where: { organizationId, id: { in: integrationIds } }, select: { id: true, provider: true } });
      for (const r of rows) providerByIntegration.set(String(r.id), String(r.provider ?? "unknown"));
    }
    return { imports, providerByIntegration };
  }

  /** EC26 import batches as settlement entries + the
   * amount_mismatch lines with signed deltas (sheet − expected).
   * This mismatch list also powers the GC20.3 alert link. */
  async courierSettlements(organizationId: string, range: FinanceRange) {
    const { imports, providerByIntegration } = await this.importsInRange(organizationId, range);
    const out: any[] = [];
    let linesTotal = 0, matchedTotal = 0, mismatchTotal = 0;
    let mismatchDeltaTotal = 0n;
    for (const imp of imports) {
      const lines = await this.t("reconciliationLine").findMany({
        where: { organizationId, importId: String(imp.id) },
        select: { outcome: true, sheetAmountMinor: true, expectedMinor: true },
        take: 20001,
      });
      let matchedAmount = 0n, mismatchDelta = 0n;
      for (const l of lines) {
        if (String(l.outcome) === "amount_mismatch") mismatchDelta += toBig(l.sheetAmountMinor) - toBig(l.expectedMinor);
      }
      matchedAmount = lines.filter((l: any) => String(l.outcome) === "matched").reduce((s: bigint, l: any) => s + toBig(l.sheetAmountMinor), 0n);
      linesTotal += lines.length; matchedTotal += Number(imp.matchedCount ?? 0); mismatchTotal += Number(imp.mismatchCount ?? 0);
      mismatchDeltaTotal += mismatchDelta;
      out.push({
        id: String(imp.id),
        date: dhakaDateKey(new Date(imp.createdAt)),
        provider: providerByIntegration.get(String(imp.courierIntegrationId)) ?? "unknown",
        fileName: imp.fileName ?? null,
        rowCount: Number(imp.rowCount ?? lines.length),
        matchedCount: Number(imp.matchedCount ?? 0),
        mismatchCount: Number(imp.mismatchCount ?? 0),
        matchedAmountMinor: matchedAmount.toString(),
        mismatchDeltaMinor: mismatchDelta.toString(),
        status: String(imp.status ?? "processed"),
      });
    }
    return {
      kind: "courier_settlements",
      range: { from: range.from, to: range.to },
      imports: out,
      totals: { imports: out.length, lines: linesTotal, matched: matchedTotal, mismatches: mismatchTotal, mismatchDeltaMinor: mismatchDeltaTotal.toString() },
    };
  }

  async mismatches(organizationId: string, range: FinanceRange) {
    const { imports, providerByIntegration } = await this.importsInRange(organizationId, range);
    const byImport = new Map<string, any>(imports.map((i: any) => [String(i.id), i] as [string, any]));
    const rows: any[] = [];
    let deltaTotal = 0n;
    for (const imp of imports) {
      const lines = await this.t("reconciliationLine").findMany({
        where: { organizationId, importId: String(imp.id), outcome: "amount_mismatch" },
        orderBy: { rowNumber: "asc" },
        take: 5001,
      });
      for (const l of lines) {
        const delta = toBig(l.sheetAmountMinor) - toBig(l.expectedMinor);
        deltaTotal += delta;
        rows.push({
          importId: String(imp.id),
          importDate: dhakaDateKey(new Date(byImport.get(String(imp.id))?.createdAt ?? imp.createdAt)),
          provider: providerByIntegration.get(String(imp.courierIntegrationId)) ?? "unknown",
          rowNumber: Number(l.rowNumber ?? 0),
          trackingId: l.rawTrackingId ?? null,
          orderRef: l.rawOrderRef ?? null,
          orderId: l.matchedOrderId ?? null,
          shipmentId: l.matchedShipmentId ?? null,
          expectedMinor: toBig(l.expectedMinor).toString(),
          sheetAmountMinor: toBig(l.sheetAmountMinor).toString(),
          deltaMinor: delta.toString(),
        });
      }
    }
    // Resolve display order numbers in one pass.
    const orderIds = [...new Set(rows.map((r) => r.orderId).filter(Boolean).map(String))];
    if (orderIds.length) {
      const os = await this.t("order").findMany({ where: { organizationId, id: { in: orderIds } }, select: { id: true, externalNumber: true } });
      const m = new Map(os.map((o: any) => [String(o.id), o.externalNumber ?? null]));
      for (const r of rows) r.orderNumber = r.orderId ? (m.get(String(r.orderId)) ?? null) : null;
    } else for (const r of rows) r.orderNumber = null;
    return { kind: "mismatches", range: { from: range.from, to: range.to }, rows, totals: { count: rows.length, deltaMinor: deltaTotal.toString() } };
  }

  async ledger(organizationId: string, kind: string, from?: string, to?: string, q: { page?: string; pageSize?: string } = {}) {
    const range = parseFinanceRange(from, to);
    switch (kind) {
      case "sales": return this.salesLedger(organizationId, range, q);
      case "cod_receivable": return this.codReceivableLedger(organizationId, range);
      case "courier_settlements": return this.courierSettlements(organizationId, range);
      case "mismatches": return this.mismatches(organizationId, range);
      case "refunds": {
        const { rows, totals } = await this.reports.refundLedgerRows(organizationId, range);
        return { kind: "refunds", range: { from: range.from, to: range.to }, rows, totals };
      }
      default: throw new Error("লেজারের ধরনটি পাওয়া যায়নি");
    }
  }

  // ---------------- GC20.5 generic double-entry export ---------
  /**
   * FIXED mapping (also in the acceptance doc + the UI help note):
   * per SOLD order (effective date in range):
   *   Dr <payment-reality account>          totalMinor
   *   Dr Discounts                           discountMinor (if > 0)
   *   Cr Sales                               subtotalMinor
   *   Cr Delivery Income                     shippingMinor (if > 0)
   *   Cr Tax Payable                         taxMinor (if > 0)
   *   remainder (gift wrap / adjustments — total − subtotal +
   *   discount − shipping − tax) as Cr "Other Income" when
   *   positive, Dr "Other Adjustments" when negative — so every
   *   order's legs balance by construction.
   * Payment-reality account: "Gateway Clearing" when a
   * verified_paid TenantPaymentTransaction exists for the order,
   * else "COD Receivable" when isCod, else "Cash" when approved
   * advances > 0, else "Receivable".
   * Gateway fees (verified txns in range with a KNOWN fee):
   *   Dr Gateway Fees / Cr Gateway Clearing (feeMinor)
   * Expenses (spentAt in range): Dr "Expense: <category>" / Cr Cash.
   * Refunds (completed refund-resolution ReturnRequests, judged
   * on updatedAt, amount recorded): Dr Refunds / Cr the order's
   * reality account. Refunds with NO recorded amount are skipped
   * and the skip count is stated in the export notes.
   */
  async glRows(organizationId: string, range: FinanceRange) {
    const legs: Array<{ date: string; account: string; debit: bigint; credit: bigint; memo: string }> = [];
    const push = (date: string, account: string, debit: bigint, credit: bigint, memo: string) => {
      if (debit === 0n && credit === 0n) return;
      legs.push({ date, account, debit, credit, memo });
    };
    const orders = await this.t("order").findMany({
      where: { organizationId, isPractice: false },
      take: TAKE,
    });
    await this.attachOrderRelations(organizationId, orders);
    const sold = orders.filter((o: any) => inRange(orderEffectiveDate(o), range) && isSoldOrderShape(String(o.status), (o._shipments ?? []).map((s: any) => String(s.status))));
    const verifiedTxns = await this.t("tenantPaymentTransaction").findMany({
      where: { organizationId, status: "verified_paid", updatedAt: { gte: range.fromDate, lte: range.toDate } },
      take: TAKE,
    });
    const verifiedOrderIds = new Set(verifiedTxns.map((tx: any) => String(tx.orderId ?? "")).filter(Boolean));
    const realityOf = (o: any): string => {
      if (verifiedOrderIds.has(String(o.id))) return "Gateway Clearing";
      if (o.isCod) return "COD Receivable";
      const advances = (o._verifications ?? []).filter((v: any) => String(v.status) === "approved").reduce((s: bigint, v: any) => s + toBig(v.amountMinor), 0n);
      return advances > 0n ? "Cash" : "Receivable";
    };
    for (const o of sold) {
      const date = dhakaDateKey(orderEffectiveDate(o));
      const memo = `অর্ডার ${o.externalNumber ?? o.id}`;
      const total = toBig(o.totalMinor), discount = toBig(o.discountMinor);
      const subtotal = toBig(o.subtotalMinor), shipping = toBig(o.shippingMinor), tax = toBig(o.taxMinor);
      push(date, realityOf(o), total, 0n, memo);
      if (discount > 0n) push(date, "Discounts", discount, 0n, memo);
      push(date, "Sales", 0n, subtotal, memo);
      if (shipping > 0n) push(date, "Delivery Income", 0n, shipping, memo);
      if (tax > 0n) push(date, "Tax Payable", 0n, tax, memo);
      const remainder = total - subtotal + discount - shipping - tax;
      if (remainder > 0n) push(date, "Other Income", 0n, remainder, memo);
      else if (remainder < 0n) push(date, "Other Adjustments", -remainder, 0n, memo);
    }
    for (const tx of verifiedTxns) {
      if (tx.feeMinor === null || tx.feeMinor === undefined) continue;
      const fee = toBig(tx.feeMinor);
      if (fee <= 0n) continue;
      const date = dhakaDateKey(new Date(tx.updatedAt));
      const memo = `গেটওয়ে ফি · ${String(tx.provider ?? "")} ${String(tx.providerTxnId ?? tx.id)}`;
      push(date, "Gateway Fees", fee, 0n, memo);
      push(date, "Gateway Clearing", 0n, fee, memo);
    }
    const expenses = await this.t("expense").findMany({
      where: { organizationId, spentAt: { gte: range.fromDate, lte: range.toDate } },
      take: TAKE,
    });
    for (const e of expenses) {
      const date = dhakaDateKey(new Date(e.spentAt));
      const memo = `খরচ · ${String(e.category)}${e.note ? ` · ${String(e.note).slice(0, 60)}` : ""}`;
      push(date, `Expense: ${String(e.category)}`, toBig(e.amountMinor), 0n, memo);
      push(date, "Cash", 0n, toBig(e.amountMinor), memo);
    }
    let skippedRefunds = 0;
    const completedRefunds = (await this.reports.loadReturns(organizationId, range, "updatedAt"))
      .filter((r: any) => String(r.status) === "completed" && String(r.resolution ?? "") === "refund");
    const orderById = new Map<string, any>();
    if (completedRefunds.length) {
      const os = await this.t("order").findMany({
        where: { organizationId, id: { in: [...new Set(completedRefunds.map((r: any) => String(r.orderId)))] } },
      });
      for (const o of os) orderById.set(String(o.id), o);
    }
    for (const r of completedRefunds) {
      if (r.refundAmountMinor === null || r.refundAmountMinor === undefined) { skippedRefunds += 1; continue; }
      const amount = toBig(r.refundAmountMinor);
      const order = orderById.get(String(r.orderId));
      const creditAccount = order ? (verifiedOrderIds.has(String(order.id)) ? "Gateway Clearing" : order.isCod ? "COD Receivable" : "Cash") : "Cash";
      const date = dhakaDateKey(new Date(r.updatedAt));
      const memo = `রিফান্ড · অর্ডার ${order?.externalNumber ?? r.orderId}`;
      push(date, "Refunds", amount, 0n, memo);
      push(date, creditAccount, 0n, amount, memo);
    }
    const totalDebit = legs.reduce((s, l) => s + l.debit, 0n);
    const totalCredit = legs.reduce((s, l) => s + l.credit, 0n);
    return { legs, skippedRefunds, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
  }

  async glExportFile(organizationId: string, from: string | undefined, to: string | undefined, format: "csv" | "xlsx"): Promise<BuiltFile> {
    const range = parseFinanceRange(from, to);
    const { legs, skippedRefunds, totalDebit, totalCredit, balanced } = await this.glRows(organizationId, range);
    const section: ReportSection = {
      title: "ডাবল-এন্ট্রি সারি",
      headers: ["date", "account", "debit_minor", "credit_minor", "memo"],
      rows: legs.map((l) => [l.date, l.account, l.debit.toString(), l.credit.toString(), l.memo]),
    };
    const notes = [
      "সাধারণ ডাবল-এন্ট্রি CSV — Tally/QuickBooks-এ import-এর আগে আপনার হিসাবরক্ষকের সঙ্গে মিলিয়ে নিন",
      "পরিমাণ পয়সায় (minor units)। এটি কোনো নির্দিষ্ট accounting software-এর native ফাইল নয় — একটি সাধারণ double-entry সারণি।",
      `মোট ডেবিট: ${totalDebit.toString()} · মোট ক্রেডিট: ${totalCredit.toString()} · ব্যালান্স: ${balanced ? "মিলেছে" : "মেলেনি"}`,
      ...(skippedRefunds > 0 ? [`পরিমাণ রেকর্ড না থাকায় ${skippedRefunds}টি রিফান্ড এই এক্সপোর্টে আসেনি।`] : []),
    ];
    return buildFileFromSections(`gl-export-${range.from}-to-${range.to}`, [section], format, `ডাবল-এন্ট্রি সারি: ${legs.length}টি`, notes);
  }
}
