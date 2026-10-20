import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { parseCsv } from "../social/social-csv";
import { badRequest, notFound } from "../i18n";

/**
 * CC25 (Connect Center Next) — settlement reconciliation.
 *
 * A tenant downloads the settlement/statement CSV from their
 * gateway and imports it here; every row is matched ONCE, at
 * import time, against the system's own verified payment
 * records (TenantPaymentTransaction in status verified_paid,
 * same org + provider + source, live environment). The verdict
 * per row is stored (matched | amount_mismatch |
 * missing_in_system | duplicate) with the real transaction id
 * it resolved to. System payments the file does NOT mention
 * are computed on read as "missing in report" — never stored,
 * so the list can never go stale.
 *
 * Source of truth honesty: neither SSLCommerz nor bKash
 * exposes a wired bulk settlement API in this codebase, so v1
 * is CSV import ONLY. Nothing is fetched from a gateway and
 * nothing about a file is invented: a file whose headers match
 * neither accepted shape is rejected outright (no silent
 * zero-row import), and rows that cannot be parsed into a
 * reference + amount are counted as skipped, never guessed.
 *
 * Accepted shapes (matched by header NAME, column order
 * tolerated):
 * - SSLCommerz settlement export: a tran_id column ("Tran ID" /
 *   "Transaction ID" / "Bank Tran ID" fallback), an amount
 *   column ("Amount" / "Total Amount" / "Store Amount"), plus
 *   optional "Currency" / "Status".
 * - bKash statement export: a "TrxID" column (or "Payment ID"),
 *   an "Amount" column, plus optional "Currency" / "Status" /
 *   "Transaction Status". A bare "Transaction ID" column is
 *   ambiguous between the two shapes and is read as the
 *   provider the tenant declared for the import.
 */

function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

interface CsvShape {
  shape: "sslcommerz" | "bkash";
  refHeader: string;
  amountHeader: string;
  currencyHeader: string | null;
  statusHeader: string | null;
}

function detectShape(provider: string, headers: string[]): CsvShape {
  const byNorm = new Map<string, string>();
  for (const h of headers) byNorm.set(normHeader(h), h);
  const pick = (...names: string[]): string | null => {
    for (const n of names) if (byNorm.has(n)) return byNorm.get(n)!;
    return null;
  };
  const amountHeader = pick("amount", "totalamount", "storeamount", "netamount");
  const currencyHeader = pick("currency");
  const statusHeader = pick("status", "transactionstatus", "transtatus");

  // bKash is identified by its trx id column — no other shape
  // carries one.
  const bkashRef = pick("trxid", "paymentid", "payment_id");
  if (bkashRef) {
    if (!amountHeader) throw badRequest("connections.bkashStatementNoAmount");
    if (provider !== "bkash") throw badRequest("connections.bkashStatementWrongProvider");
    return { shape: "bkash", refHeader: bkashRef, amountHeader, currencyHeader, statusHeader };
  }
  const sslRef = pick("tranid", "banktranid");
  if (sslRef) {
    if (!amountHeader) throw badRequest("connections.sslSettlementNoAmount");
    if (provider !== "sslcommerz") throw badRequest("connections.sslSettlementWrongProvider");
    return { shape: "sslcommerz", refHeader: sslRef, amountHeader, currencyHeader, statusHeader };
  }
  // Ambiguous: a lone "Transaction ID" is read as the declared
  // provider's reference column.
  const genericRef = pick("transactionid");
  if (genericRef && amountHeader) {
    return { shape: provider as "sslcommerz" | "bkash", refHeader: genericRef, amountHeader, currencyHeader, statusHeader };
  }
  throw badRequest("connections.settlementShapeUnknown");
}

function parseAmountMinor(raw: string): bigint | null {
  const cleaned = String(raw ?? "").replace(/,/g, "").trim();
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return BigInt(Math.round(value * 100));
}

/** Every gateway reference a verified transaction can be
 * known by in a settlement file. */
function refsOf(txn: any): string[] {
  const refs: string[] = [];
  if (txn.providerTxnId) refs.push(String(txn.providerTxnId));
  if (txn.valId) refs.push(String(txn.valId));
  const bankTranId = txn.ipnPayload?.validation?.bank_tran_id ?? txn.ipnPayload?.ipn?.bank_tran_id;
  if (bankTranId) refs.push(String(bankTranId));
  const trxId = txn.ipnPayload?.executeOrQuery?.trxID;
  if (trxId) refs.push(String(trxId));
  return refs;
}

@Injectable()
export class SettlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private importView(row: any) {
    return {
      id: row.id, provider: row.provider, source: row.source === "platform" ? "platform" : "own",
      periodLabel: row.periodLabel,
      periodFrom: row.periodFrom ?? null, periodTo: row.periodTo ?? null,
      fileName: row.fileName, rowCount: row.rowCount, skippedCount: row.skippedCount ?? 0,
      matchedCount: row.matchedCount, createdById: row.createdById, createdAt: row.createdAt,
    };
  }

  private rowView(row: any) {
    return {
      id: row.id, externalRef: row.externalRef, amountMinor: String(row.amountMinor),
      currency: row.currency ?? "BDT", rawStatus: row.rawStatus ?? null,
      matchState: row.matchState, matchedTransactionId: row.matchedTransactionId ?? null,
    };
  }

  private async verifiedTxns(organizationId: string, provider: string, source: string): Promise<any[]> {
    try {
      return await (this.prisma as any).tenantPaymentTransaction.findMany({
        where: { organizationId, provider, source, environment: "live", status: "verified_paid" },
      });
    } catch { return []; }
  }

  async importSettlement(organizationId: string, actorId: string, dto: {
    provider?: string; source?: string; periodLabel?: string;
    periodFrom?: string; periodTo?: string; fileName?: string; csv?: string;
  }) {
    const provider = String(dto?.provider ?? "").trim().toLowerCase();
    if (provider !== "sslcommerz" && provider !== "bkash") {
      throw badRequest("connections.providerSslOrBkash");
    }
    const source = dto?.source === "platform" ? "platform" : "own";
    const periodLabel = String(dto?.periodLabel ?? "").trim();
    if (!periodLabel) throw badRequest("connections.periodLabelRequired");
    const fileName = String(dto?.fileName ?? "").trim() || "settlement.csv";
    const parseDate = (raw?: string): Date | null => {
      if (!raw || !String(raw).trim()) return null;
      const d = new Date(String(raw).trim());
      if (Number.isNaN(d.getTime())) throw badRequest("connections.dateNotUnderstood", { raw: raw });
      return d;
    };
    const periodFrom = parseDate(dto?.periodFrom);
    const periodTo = parseDate(dto?.periodTo);

    const parsed = parseCsv(String(dto?.csv ?? ""));
    if (!parsed.headers.length || !parsed.rows.length) {
      throw badRequest("connections.settlementFileEmpty");
    }
    // Throws the honest shape error when neither shape matches
    // — BEFORE anything is stored.
    const shape = detectShape(provider, parsed.headers);

    const txns = await this.verifiedTxns(organizationId, provider, source);
    const byRef = new Map<string, any>();
    for (const txn of txns ?? []) {
      for (const ref of refsOf(txn)) {
        if (!byRef.has(ref)) byRef.set(ref, txn);
      }
    }

    const seen = new Map<string, string | null>(); // ref -> matchedTransactionId of first occurrence
    const rowData: any[] = [];
    let skippedCount = 0;
    let matchedCount = 0;
    for (const parsedRow of parsed.rows) {
      const ref = String(parsedRow.values[shape.refHeader] ?? "").trim();
      const amountMinor = parseAmountMinor(parsedRow.values[shape.amountHeader]);
      if (!ref || amountMinor === null) { skippedCount++; continue; }
      const currency = shape.currencyHeader ? String(parsedRow.values[shape.currencyHeader] ?? "").trim().toUpperCase() || "BDT" : "BDT";
      const rawStatus = shape.statusHeader ? String(parsedRow.values[shape.statusHeader] ?? "").trim() || null : null;
      if (seen.has(ref)) {
        rowData.push({ externalRef: ref, amountMinor, currency, rawStatus, matchState: "duplicate", matchedTransactionId: seen.get(ref) ?? null });
        continue;
      }
      const txn = byRef.get(ref) ?? null;
      seen.set(ref, txn?.id ?? null);
      if (!txn) {
        rowData.push({ externalRef: ref, amountMinor, currency, rawStatus, matchState: "missing_in_system", matchedTransactionId: null });
      } else if (BigInt(txn.amountMinor) !== amountMinor) {
        rowData.push({ externalRef: ref, amountMinor, currency, rawStatus, matchState: "amount_mismatch", matchedTransactionId: txn.id });
      } else {
        matchedCount++;
        rowData.push({ externalRef: ref, amountMinor, currency, rawStatus, matchState: "matched", matchedTransactionId: txn.id });
      }
    }

    const p: any = this.prisma as any;
    const createWithRows = async (client: any) => {
      const imp = await client.settlementImport.create({
        data: {
          organizationId, provider, source, periodLabel, periodFrom, periodTo, fileName,
          rowCount: rowData.length, skippedCount, matchedCount, createdById: actorId,
        },
      });
      for (const data of rowData) {
        await client.settlementRow.create({ data: { importId: imp.id, ...data } });
      }
      return imp;
    };
    const imp = typeof p.$transaction === "function" ? await p.$transaction(createWithRows) : await createWithRows(p);
    await this.audit.log({
      organizationId, userId: actorId, action: "settlement.imported",
      entityType: "SettlementImport", entityId: imp.id,
      metadata: { provider, source, periodLabel, rowCount: rowData.length, skippedCount, matchedCount },
    });
    return this.importView(imp);
  }

  async listImports(organizationId: string) {
    let rows: any[] = [];
    try {
      rows = await (this.prisma as any).settlementImport.findMany({
        where: { organizationId }, orderBy: { createdAt: "desc" }, take: 100,
      });
    } catch { rows = []; }
    return { imports: (rows ?? []).map((r: any) => this.importView(r)) };
  }

  /**
   * Import detail: the stored rows grouped by verdict, plus
   * the COMPUTED "missing in report" list — verified system
   * payments (same provider + source; inside the import's
   * period range when one was given, otherwise all of them)
   * that no row of this import resolved to. Computed on every
   * read from live records, never stored.
   */
  async getImport(organizationId: string, importId: string) {
    const p: any = this.prisma as any;
    const imp = await p.settlementImport.findFirst({ where: { id: importId, organizationId } }).catch(() => null);
    if (!imp) throw notFound("connections.settlementImportNotFound");
    let rows: any[] = [];
    try {
      rows = await p.settlementRow.findMany({ where: { importId: imp.id }, orderBy: { createdAt: "asc" }, take: 5000 });
    } catch { rows = []; }
    const byState = (state: string) => (rows ?? []).filter((r: any) => r.matchState === state).map((r: any) => this.rowView(r));

    const resolvedIds = new Set((rows ?? []).map((r: any) => r.matchedTransactionId).filter(Boolean));
    const txns = await this.verifiedTxns(organizationId, String(imp.provider), String(imp.source));
    const from = imp.periodFrom ? new Date(imp.periodFrom).getTime() : null;
    const to = imp.periodTo ? new Date(imp.periodTo).getTime() : null;
    const missingInReport = (txns ?? [])
      .filter((t: any) => !resolvedIds.has(t.id))
      .filter((t: any) => {
        if (from === null && to === null) return true;
        const at = new Date(t.createdAt).getTime();
        return (from === null || at >= from) && (to === null || at <= to);
      })
      .map((t: any) => ({
        transactionId: t.id, orderId: t.orderId, providerTxnId: t.providerTxnId ?? null,
        amountMinor: String(t.amountMinor), currency: t.currency ?? "BDT", paidAt: t.createdAt,
      }));

    return {
      import: this.importView(imp),
      counts: {
        matched: byState("matched").length,
        amount_mismatch: byState("amount_mismatch").length,
        missing_in_system: byState("missing_in_system").length,
        duplicate: byState("duplicate").length,
        missing_in_report: missingInReport.length,
      },
      matched: byState("matched"),
      amountMismatch: byState("amount_mismatch"),
      missingInSystem: byState("missing_in_system"),
      duplicates: byState("duplicate"),
      missingInReport,
    };
  }
}
