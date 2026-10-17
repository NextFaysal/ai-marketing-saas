/**
 * NF10 (FB4) — Accounting (double-entry journal) web helpers +
 * payload types. Money is minor-unit STRINGS from the API —
 * display via formatMinor, never floats. The disclaimer below
 * must stay byte-identical to the API's ACCOUNTING_DISCLAIMER
 * (apps/api/src/accounting/accounting.service.ts) — it is pinned
 * by the vitest suite on both sides.
 */

export const ACCOUNTING_DISCLAIMER = "এটি একটি হিসাব-সহায়ক টুল — অডিট করা বা বিধিবদ্ধ হিসাব নয়।";

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

export const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: "asset", label: "সম্পদ (Asset)" },
  { value: "liability", label: "দায় (Liability)" },
  { value: "equity", label: "মালিকানা (Equity)" },
  { value: "income", label: "আয় (Income)" },
  { value: "expense", label: "খরচ (Expense)" },
];

export function accountTypeLabel(v: string | null | undefined): string {
  return ACCOUNT_TYPES.find((t) => t.value === v)?.label ?? v ?? "—";
}

export function sourceTypeLabel(v: string | null | undefined): string {
  switch (v) {
    case "order": return "অর্ডার (বিক্রি)";
    case "payment": return "যাচাইকৃত পেমেন্ট";
    case "expense": return "খরচ";
    case "courier_charge": return "কুরিয়ার চার্জ";
    case "manual": return "ম্যানুয়াল এন্ট্রি";
    default: return v ?? "—";
  }
}

export function matchStateLabel(v: string | null | undefined): string {
  switch (v) {
    case "unmatched": return "মেলেনি";
    case "suggested": return "প্রস্তাবিত মিল";
    case "matched": return "মিল নিশ্চিত";
    case "rejected": return "বাতিল করা";
    default: return v ?? "—";
  }
}

export function directionLabel(v: string | null | undefined): string {
  switch (v) {
    case "credit": return "জমা (Credit)";
    case "debit": return "খরচ/তোলা (Debit)";
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
