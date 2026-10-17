import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import Papa from "papaparse";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { parseSpentAt } from "./finance.service";
import { dhakaDateKey, toBig } from "./finance-common";

/**
 * OU7 — bank statement reconciliation.
 *
 * A statement CSV (headers: date, description, amount [, reference];
 * amount in TAKA, signed — positive money in, negative money out)
 * is imported as BankStatementLine rows that start UNMATCHED,
 * always. The matcher only ever SUGGESTS: a candidate payment /
 * settlement / expense record with the exact same signed amount
 * within ±7 days. A match exists only after a human confirms one
 * suggestion (confirmMatch) — there is no auto-confirm path in
 * this service, and the specs pin that.
 */

export interface MatchCandidate {
  sourceType: "tenant_payment_transaction" | "courier_settlement" | "payment_verification" | "expense";
  sourceId: string;
  dateKey: string;
  amountMinor: bigint; // signed like a statement line: receipts +, expenses −
  label: string;
}

export const MATCH_WINDOW_DAYS = 7;

function dayDiff(aKey: string, bKey: string): number {
  const a = new Date(`${aKey}T12:00:00+06:00`).getTime();
  const b = new Date(`${bKey}T12:00:00+06:00`).getTime();
  return Math.abs(Math.round((a - b) / 86400_000));
}

/** Pure matcher: exact signed-amount equality + date window.
 * Returns suggestions only — it mutates nothing. */
export function suggestMatchesFor(line: { amountMinor: bigint; dateKey: string }, candidates: MatchCandidate[]) {
  return candidates
    .filter((c) => c.amountMinor === line.amountMinor && dayDiff(c.dateKey, line.dateKey) <= MATCH_WINDOW_DAYS)
    .map((c) => ({ sourceType: c.sourceType, sourceId: c.sourceId, date: c.dateKey, amountMinor: c.amountMinor.toString(), label: c.label, daysApart: dayDiff(c.dateKey, line.dateKey) }))
    .sort((a, b) => a.daysApart - b.daysApart)
    .slice(0, 5);
}

/** "1,234.50" / "-500" / "500.5" (taka) → signed paisa. Throws on
 * anything that is not a plain decimal with ≤2 fraction digits. */
export function parseMoneyToMinor(raw: unknown): bigint {
  const s = String(raw ?? "").replace(/[,\s৳]/g, "");
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`পরিমাণটি সঠিক নয়: ${String(raw ?? "")}`);
  const minor = BigInt(m[2]) * 100n + BigInt((m[3] ?? "").padEnd(2, "0") || "0");
  return m[1] === "-" ? -minor : minor;
}

const TAKE = 5001;

@Injectable()
export class BankReconService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private t(name: string): any { return (this.prisma as any)[name]; }

  /** The records a statement line can be matched against. */
  async candidates(organizationId: string): Promise<MatchCandidate[]> {
    const out: MatchCandidate[] = [];
    const txns = await this.t("tenantPaymentTransaction").findMany({ where: { organizationId, status: "verified_paid" }, take: TAKE });
    for (const tx of txns) {
      out.push({ sourceType: "tenant_payment_transaction", sourceId: String(tx.id), dateKey: dhakaDateKey(new Date(tx.updatedAt)), amountMinor: toBig(tx.amountMinor), label: `গেটওয়ে পেমেন্ট · ${String(tx.provider ?? "")} ${String(tx.providerTxnId ?? tx.id)}` });
    }
    const imports = await this.t("reconciliationImport").findMany({ where: { organizationId }, take: 500 });
    for (const imp of imports) {
      const lines = await this.t("reconciliationLine").findMany({ where: { organizationId, importId: String(imp.id), outcome: "matched" }, take: 20001 });
      for (const l of lines) {
        if (l.sheetAmountMinor === null || l.sheetAmountMinor === undefined) continue;
        out.push({ sourceType: "courier_settlement", sourceId: String(l.id), dateKey: dhakaDateKey(new Date(imp.createdAt)), amountMinor: toBig(l.sheetAmountMinor), label: `কুরিয়ার সেটেলমেন্ট · সারি ${Number(l.rowNumber ?? 0)}` });
      }
    }
    const pvs = await this.t("paymentVerification").findMany({ where: { organizationId, status: "approved" }, take: TAKE });
    for (const pv of pvs) {
      if (String(pv.source ?? "") === "gateway_deposit") continue; // same money as the gateway txn candidate
      if (pv.amountMinor === null || pv.amountMinor === undefined) continue;
      out.push({ sourceType: "payment_verification", sourceId: String(pv.id), dateKey: dhakaDateKey(new Date(pv.createdAt)), amountMinor: toBig(pv.amountMinor), label: `ম্যানুয়াল advance · ${String(pv.provider ?? "—")} ${String(pv.trxId ?? pv.id)}` });
    }
    const expenses = await this.t("expense").findMany({ where: { organizationId }, take: TAKE });
    for (const e of expenses) {
      out.push({ sourceType: "expense", sourceId: String(e.id), dateKey: dhakaDateKey(new Date(e.spentAt)), amountMinor: -toBig(e.amountMinor), label: `খরচ · ${String(e.category)}${e.note ? ` · ${String(e.note).slice(0, 60)}` : ""}` });
    }
    return out;
  }

  async importStatement(organizationId: string, actorId: string | undefined, csvText: unknown) {
    if (typeof csvText !== "string" || !csvText.trim()) throw new Error("স্টেটমেন্ট CSV টেক্সট দিন");
    const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: "greedy" });
    const fields = (parsed.meta.fields ?? []).map((f) => String(f).trim().toLowerCase());
    for (const required of ["date", "description", "amount"]) {
      if (!fields.includes(required)) throw new Error(`CSV-তে '${required}' কলামটি থাকতে হবে (date, description, amount[, reference])`);
    }
    const records = (parsed.data as any[]).slice(0, 1000);
    const importId = randomUUID();
    const errors: Array<{ row: number; message: string }> = [];
    let created = 0;
    for (let i = 0; i < records.length; i++) {
      const rec: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(records[i] ?? {})) rec[String(k).trim().toLowerCase()] = v;
      try {
        const statementDate = parseSpentAt(rec.date);
        const amountMinor = parseMoneyToMinor(rec.amount);
        if (amountMinor === 0n) throw new Error("পরিমাণ শূন্য হতে পারে না");
        const description = String(rec.description ?? "").trim().slice(0, 500);
        if (!description) throw new Error("বিবরণ খালি");
        await this.t("bankStatementLine").create({
          data: {
            organizationId, importId, statementDate, description, amountMinor,
            reference: rec.reference ? String(rec.reference).slice(0, 200) : null,
            status: "unmatched", // ALWAYS — a human confirms any match later.
          },
        });
        created += 1;
      } catch (e: any) {
        errors.push({ row: i + 2, message: String(e?.message ?? e) });
      }
    }
    if (!created) throw new Error(`একটি সারিও import হয়নি — প্রথম ত্রুটি: ${errors[0]?.message ?? "অজানা"}`);
    await this.audit.log({ organizationId, userId: actorId, action: "finance.bank_statement_imported", entityType: "BankStatementLine", entityId: importId, metadata: { created, errors: errors.length } }).catch(() => undefined);
    return { importId, created, errors, note: "সব সারি 'unmatched' অবস্থায় এসেছে — প্রস্তাবিত মিল দেখে প্রতিটি নিজে নিশ্চিত করুন; স্বয়ংক্রিয়ভাবে কোনো মিল ধরা হয়নি।" };
  }

  private serializeLine(l: any, suggestions: unknown[]) {
    return {
      id: String(l.id), importId: String(l.importId),
      date: dhakaDateKey(new Date(l.statementDate)),
      description: String(l.description), amountMinor: toBig(l.amountMinor).toString(),
      reference: l.reference ?? null, status: String(l.status),
      matchedSourceType: l.matchedSourceType ?? null, matchedSourceId: l.matchedSourceId ?? null,
      confirmedById: l.confirmedById ?? null,
      confirmedAt: l.confirmedAt ? new Date(l.confirmedAt).toISOString() : null,
      suggestions,
    };
  }

  async listBankLines(organizationId: string, status?: string) {
    const where: any = { organizationId };
    if (status === "unmatched" || status === "matched") where.status = status;
    const rows = await this.t("bankStatementLine").findMany({ where, orderBy: [{ statementDate: "desc" }, { createdAt: "desc" }], take: 500 });
    const pool = await this.candidates(organizationId);
    const items = rows.map((l: any) => this.serializeLine(l,
      String(l.status) === "unmatched"
        ? suggestMatchesFor({ amountMinor: toBig(l.amountMinor), dateKey: dhakaDateKey(new Date(l.statementDate)) }, pool)
        : []));
    return {
      items,
      totals: {
        shown: items.length,
        matched: items.filter((i: any) => i.status === "matched").length,
        unmatched: items.filter((i: any) => i.status === "unmatched").length,
      },
      note: "মিল শুধু প্রস্তাব — প্রতিটি মিল একজন মানুষ নিশ্চিত না করা পর্যন্ত লাইনটি unmatched-ই থাকে।",
    };
  }

  /** The ONLY way a line becomes matched: a human picks one of
   * the current suggestions (exact amount, ±7 days). */
  async confirmMatch(organizationId: string, actorId: string | undefined, lineId: string, body: any) {
    const line = await this.t("bankStatementLine").findFirst({ where: { id: lineId, organizationId } });
    if (!line) throw new Error("স্টেটমেন্ট সারিটি পাওয়া যায়নি");
    if (String(line.status) === "matched") throw new Error("এই সারিটি ইতিমধ্যে মেলানো হয়েছে");
    const pool = await this.candidates(organizationId);
    const suggestions = suggestMatchesFor({ amountMinor: toBig(line.amountMinor), dateKey: dhakaDateKey(new Date(line.statementDate)) }, pool);
    const chosen = suggestions.find((s) => s.sourceType === String(body?.sourceType ?? "") && s.sourceId === String(body?.sourceId ?? ""));
    if (!chosen) throw new Error("প্রস্তাবিত মিলটি পাওয়া যায়নি — পরিমাণ হুবহু ও তারিখ ±৭ দিনের মধ্যে থাকতে হবে");
    const row = await this.t("bankStatementLine").update({
      where: { id: lineId },
      data: { status: "matched", matchedSourceType: chosen.sourceType, matchedSourceId: chosen.sourceId, confirmedById: actorId ?? null, confirmedAt: new Date() },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "finance.bank_match_confirmed", entityType: "BankStatementLine", entityId: lineId, metadata: { matchedSourceType: chosen.sourceType, matchedSourceId: chosen.sourceId, amountMinor: toBig(line.amountMinor).toString() } }).catch(() => undefined);
    return this.serializeLine(row, []);
  }

  async unmatch(organizationId: string, actorId: string | undefined, lineId: string) {
    const line = await this.t("bankStatementLine").findFirst({ where: { id: lineId, organizationId } });
    if (!line) throw new Error("স্টেটমেন্ট সারিটি পাওয়া যায়নি");
    if (String(line.status) !== "matched") throw new Error("এই সারিটি মেলানো অবস্থায় নেই");
    const row = await this.t("bankStatementLine").update({
      where: { id: lineId },
      data: { status: "unmatched", matchedSourceType: null, matchedSourceId: null, confirmedById: null, confirmedAt: null },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "finance.bank_match_reverted", entityType: "BankStatementLine", entityId: lineId, metadata: {} }).catch(() => undefined);
    return this.serializeLine(row, []);
  }
}
