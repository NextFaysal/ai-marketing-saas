/**
 * NF10 (FB4) — Accounting (double-entry journal) web helpers +
 * payload types. Money is minor-unit STRINGS from the API —
 * display via formatMinor, never floats. The disclaimer below
 * must stay byte-identical to the API's ACCOUNTING_DISCLAIMER
 * (apps/api/src/accounting/accounting.service.ts) — it is pinned
 * by the vitest suite on both sides.
 */

export const ACCOUNTING_DISCLAIMER = "এটি একটি হিসাব-সহায়ক টুল — অডিট করা বা বিধিবদ্ধ হিসাব নয়।";

import type { UiLocale } from "@repo/contracts";
import { billingBn, billingEn } from "./i18n/billing";

const D = (locale?: string) => (locale === "en" ? billingEn : billingBn);

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

const ACCOUNT_TYPE_KEY: Record<string, keyof typeof billingBn> = {
  asset: "zzAcctTypeAsset", liability: "zzAcctTypeLiability", equity: "zzAcctTypeEquity",
  income: "zzAcctTypeIncome", expense: "zzAcctTypeExpense",
};

export function accountTypes(locale: UiLocale = "bn"): { value: AccountType; label: string }[] {
  const d = D(locale);
  return (Object.keys(ACCOUNT_TYPE_KEY) as AccountType[]).map((value) => ({ value, label: d[ACCOUNT_TYPE_KEY[value]] }));
}

export const ACCOUNT_TYPES: { value: AccountType; label: string }[] = accountTypes("bn");

export function accountTypeLabel(v: string | null | undefined, locale: UiLocale = "bn"): string {
  return accountTypes(locale).find((t) => t.value === v)?.label ?? v ?? "—";
}

export function sourceTypeLabel(v: string | null | undefined, locale: UiLocale = "bn"): string {
  const d = D(locale);
  switch (v) {
    case "order": return d.zzAcctSourceOrder;
    case "payment": return d.zzAcctSourcePayment;
    case "expense": return d.zzAcctSourceExpense;
    case "courier_charge": return d.zzAcctSourceCourier;
    case "manual": return d.zzAcctSourceManual;
    default: return v ?? "—";
  }
}

export function matchStateLabel(v: string | null | undefined, locale: UiLocale = "bn"): string {
  const d = D(locale);
  switch (v) {
    case "unmatched": return d.zzAcctMatchUnmatched;
    case "suggested": return d.zzAcctMatchSuggested;
    case "matched": return d.zzAcctMatchMatched;
    case "rejected": return d.zzAcctMatchRejected;
    default: return v ?? "—";
  }
}

export function directionLabel(v: string | null | undefined, locale: UiLocale = "bn"): string {
  const d = D(locale);
  switch (v) {
    case "credit": return d.zzAcctDirCredit;
    case "debit": return d.zzAcctDirDebit;
    default: return v ?? "—";
  }
}

export interface ChartAccount {
  id: string; code: string; name: string; type: string;
  isSystem: boolean; systemKey: string | null; balanceMinor?: string;
}

export interface JournalLineView {
  id: string; accountId: string; accountCode: string | null; accountName: string | null;
  debitMinor: string; creditMinor: string;
}

export interface JournalEntryView {
  id: string; date: string | null; memo: string | null;
  sourceType: string | null; sourceId: string | null;
  totalDebitMinor: string; totalCreditMinor: string; lines: JournalLineView[];
}

export interface PnlReport {
  month: string;
  rows: { accountId: string; code: string; name: string; type: string; systemKey: string | null; amountMinor: string }[];
  totals: { totalIncomeMinor: string; cogsMinor: string; grossProfitMinor: string; totalExpensesMinor: string; netProfitMinor: string };
  cogsMissingOrders: number; cogsNote: string | null; disclaimer: string;
}

export interface VatSummary {
  month: string;
  account: { id: string; code: string; name: string };
  accountsUsed: string[];
  collectedMinor: string; paidMinor: string; monthNetMinor: string; balanceMinor: string;
  vatRateBps: number | null; pricesIncludeVat: boolean | null; rateNote: string; disclaimer: string;
}

export interface StatementImport {
  id: string; kind: string; accountLabel: string | null; fileName: string | null;
  rowCount: number; status: string; createdAt: string | null;
}

export interface StatementLine {
  id: string; importId: string; rowNumber: number; statementDate: string | null;
  description: string | null; direction: string | null; amountMinor: string | null;
  outcome: string; matchState: string; suggestedRefType: string | null; suggestedRefId: string | null;
  note: string | null; reviewedAt: string | null; reviewedBy: string | null;
}

/** Example statement CSV the import form shows as a template. */
export const STATEMENT_CSV_TEMPLATE = "Date,Description,Amount\n2026-10-06,Order payment,1250.00\n2026-10-07,Delivery charge,-120.00";
