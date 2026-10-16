/**
 * GB8 (GC19 reports + GC20 finance) — pure helpers + payload
 * types for the Reports hub, report detail pages, scheduled
 * reports and the Finance & Ledger hub. Side-effect free,
 * unit-testable. Money is minor-unit (paisa) STRINGS from the
 * API — never parse to float for display; use formatMinor.
 */

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

export type ReportType = "discounts" | "refunds" | "payment_sales" | "category_sales" | "shipping_cost";
export type ScheduledReportType = ReportType | "profit";

export interface ReportTypeMeta { type: ReportType; label: string; description: string }

export const REPORT_TYPES: ReportTypeMeta[] = [
  { type: "discounts", label: "ছাড়ের রিপোর্ট", description: "অর্ডার-স্তরের মোট ছাড় ও কুপন/প্রমোশন/রেফারেল উৎস অনুযায়ী বিশ্লেষণ" },
  { type: "refunds", label: "রিফান্ড রিপোর্ট", description: "রিফান্ড অনুরোধ, সমাধানের ধরন ও অর্ডার-স্তরে রেকর্ড করা ফেরতের হিসাব" },
  { type: "payment_sales", label: "পেমেন্ট অনুযায়ী বিক্রি", description: "পেমেন্ট পদ্ধতি অনুযায়ী বিক্রি ও গেটওয়ে যাচাইকৃত (verified_paid) পেমেন্ট" },
  { type: "category_sales", label: "ক্যাটাগরি অনুযায়ী বিক্রি", description: "পণ্যের ক্যাটাগরি অনুযায়ী অর্ডার, পরিমাণ ও আয়" },
  { type: "shipping_cost", label: "শিপিং খরচ রিপোর্ট", description: "কুরিয়ার অনুযায়ী ধার্য চার্জ ও প্রকৃত খরচের কভারেজ" },
];

export const SCHEDULED_REPORT_TYPES: { type: ScheduledReportType; label: string }[] = [
  ...REPORT_TYPES.map((r) => ({ type: r.type as ScheduledReportType, label: r.label })),
  { type: "profit", label: "লাভের রিপোর্ট" },
];

export function isReportType(v: string | null | undefined): v is ReportType {
  return REPORT_TYPES.some((r) => r.type === v);
}
export function reportTypeLabel(v: string | null | undefined): string {
  const m = REPORT_TYPES.find((r) => r.type === v);
  if (m) return m.label;
  if (v === "profit") return "লাভের রিপোর্ট";
  return v ?? "—";
}
export function reportTypeMeta(v: string | null | undefined): ReportTypeMeta | null {
  return REPORT_TYPES.find((r) => r.type === v) ?? null;
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export type ExpenseCategory = "rent" | "salary" | "marketing" | "packaging" | "delivery" | "utilities" | "inventory_purchase" | "other";
export type ExpensePaymentMethod = "cash" | "bank" | "bkash" | "other";

export const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: "rent", label: "ভাড়া" },
  { value: "salary", label: "বেতন" },
  { value: "marketing", label: "মার্কেটিং" },
  { value: "packaging", label: "প্যাকেজিং" },
  { value: "delivery", label: "ডেলিভারি" },
  { value: "utilities", label: "ইউটিলিটি" },
  { value: "inventory_purchase", label: "ইনভেন্টরি ক্রয়" },
  { value: "other", label: "অন্যান্য" },
];

export const EXPENSE_PAYMENT_METHODS: { value: ExpensePaymentMethod; label: string }[] = [
  { value: "cash", label: "নগদ" },
  { value: "bank", label: "ব্যাংক" },
  { value: "bkash", label: "বিকাশ" },
  { value: "other", label: "অন্যান্য" },
];

export function expenseCategoryLabel(v: string | null | undefined): string {
  return EXPENSE_CATEGORIES.find((c) => c.value === v)?.label ?? v ?? "—";
}
export function expensePaymentMethodLabel(v: string | null | undefined): string {
  return EXPENSE_PAYMENT_METHODS.find((c) => c.value === v)?.label ?? v ?? "—";
}

// ---------------------------------------------------------------------------
// Other label helpers
// ---------------------------------------------------------------------------

export function discountKindLabel(kind: string | null | undefined): string {
  switch (kind) {
    case "coupon": return "কুপন";
    case "promotion": return "প্রমোশন";
    case "referral": return "রেফারেল";
    default: return kind ?? "—";
  }
}

export function refundResolutionLabel(v: string | null | undefined): string {
  switch (v) {
    case "refund": return "টাকা ফেরত";
    case "exchange": return "এক্সচেঞ্জ";
    case "store_credit_note": return "স্টোর ক্রেডিট নোট";
    default: return v ?? "—";
  }
}

/** Payment-method label: unknown/empty reads "অন্যান্য/অজানা". */
export function paymentMethodLabel(v: string | null | undefined): string {
  if (!v || v === "unknown") return "অন্যান্য/অজানা";
  return v;
}

export function partialFullLabel(v: string | null | undefined): string {
  switch (v) {
    case "full": return "পূর্ণ";
    case "partial": return "আংশিক";
    case "unknown": return "পরিমাণ অজানা";
    default: return "—";
  }
}

export function scheduledRunStatusLabel(v: string | null | undefined): string {
  switch (v) {
    case "sent": return "পাঠানো হয়েছে";
    case "failed_no_provider": return "ইমেইল সার্ভিস সেটআপ নেই";
    case "failed_error": return "ব্যর্থ হয়েছে";
    default: return v ?? "—";
  }
}

export function cadenceLabel(v: string | null | undefined): string {
  switch (v) {
    case "daily": return "প্রতিদিন";
    case "weekly": return "প্রতি সপ্তাহে";
    default: return v ?? "—";
  }
}

// ---------------------------------------------------------------------------
// Date / month helpers (Dhaka)
// ---------------------------------------------------------------------------

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today's date (YYYY-MM-DD) in Asia/Dhaka, regardless of host TZ. */
export function dhakaToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Last 30 Dhaka days, inclusive: { from: today-29d, to: today }. */
export function defaultRange(now: Date = new Date()): { from: string; to: string } {
  const to = dhakaToday(now);
  const [y, m, d] = to.split("-").map(Number);
  const fromDate = new Date(Date.UTC(y, m - 1, d));
  fromDate.setUTCDate(fromDate.getUTCDate() - 29);
  return { from: ymd(fromDate), to };
}

/** Current month (YYYY-MM) in Asia/Dhaka. */
export function currentMonth(now: Date = new Date()): string {
  return dhakaToday(now).slice(0, 7);
}

export function isValidMonth(v: string | null | undefined): v is string {
  return !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

const BN_MONTHS = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"];
const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
export function toBengaliDigits(v: string | number): string {
  return String(v).replace(/[0-9]/g, (c) => BN_DIGITS[Number(c)]);
}

/** "2026-10" → "অক্টোবর ২০২৬". Invalid input passes through raw. */
export function formatMonthLabel(month: string | null | undefined): string {
  if (!isValidMonth(month)) return month ?? "—";
  const [y, m] = month.split("-").map(Number);
  return `${BN_MONTHS[m - 1]} ${toBengaliDigits(y)}`;
}

/** Shift a YYYY-MM month by delta months. Invalid input returns as-is. */
export function shiftMonth(month: string, delta: number): string {
  if (!isValidMonth(month)) return month;
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Money conversion (form input only — display uses formatMinor)
// ---------------------------------------------------------------------------

/**
 * Taka decimal string → minor (paisa) string, using string math
 * only (no float). Returns null for invalid / negative input.
 * "123.45" → "12345", "100" → "10000", "0.5" → "50".
 */
export function takaToMinor(input: string | number | null | undefined): string | null {
  if (input == null) return null;
  const raw = String(input).trim();
  if (!raw || raw.startsWith("-")) return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) return null;
  const whole = match[1].replace(/^0+(?=\d)/, "");
  const frac = (match[2] ?? "").padEnd(2, "0");
  const minor = `${whole}${frac}`.replace(/^0+(?=\d)/, "");
  return minor;
}

/** Minor string → taka input string for edit-form prefill. */
export function minorToTakaInput(minor: string | null | undefined): string {
  if (minor == null) return "";
  try {
    const v = BigInt(minor);
    const neg = v < 0n;
    const abs = neg ? -v : v;
    const whole = abs / 100n;
    const frac = String(abs % 100n).padStart(2, "0");
    return `${neg ? "-" : ""}${whole.toString()}.${frac}`;
  } catch { return ""; }
}

// ---------------------------------------------------------------------------
// Report payload types (EXACT API shapes)
// ---------------------------------------------------------------------------

export interface DiscountsReport {
  totals: { orderDiscountMinor: string; stampedDiscountMinor: string; ordersInPeriod: number; stampedOrders: number };
  coverage: { stampedOrders: number; ordersInPeriod: number; note: string };
  daily: { date: string; orderDiscountMinor: string; stampedDiscountMinor: string; orders: number }[];
  bySource: { kind: string; key: string; name: string; applications: number; discountMinor: string }[];
}

export interface RefundsReport {
  requests: {
    total: number;
    byStatus: { status: string; count: number }[];
    byResolution: { resolution: string; count: number; amountMinor: string; amountsKnown: number }[];
    partialCount: number; fullCount: number; amountUnknownCount: number;
  };
  orderLevel: { ordersWithRefunds: number; recordedRefundMinor: string };
  coverage: { note: string };
}

export interface PaymentSalesReport {
  byMethod: { method: string; orders: number; totalMinor: string }[];
  totals: { orders: number; totalMinor: string };
  onlineVerified: { provider: string; source: string; count: number; grossMinor: string }[];
  onlineVerifiedTotals: { count: number; grossMinor: string };
  coverage: { note: string };
}

export interface CategorySalesReport {
  rows: { category: string; orders: number; quantity: number; revenueMinor: string }[];
  totals: { orders: number; quantity: number; revenueMinor: string };
  coverage: { soldOrders: number; note: string };
}

export interface ShippingCostReport {
  rows: { provider: string; shipments: number; orders: number; chargedMinor: string; actualMinor: string | null; shipmentsWithActual: number }[];
  totals: { provider?: string; shipments: number; orders: number; chargedMinor: string; actualMinor: string | null; shipmentsWithActual: number };
  coverage: { ordersWithShipments: number; ordersWithAnyActual: number; actualCoveragePct: number | null; note: string };
}

export type ReportPayload = DiscountsReport | RefundsReport | PaymentSalesReport | CategorySalesReport | ShippingCostReport;

// ---------------------------------------------------------------------------
// Scheduled reports
// ---------------------------------------------------------------------------

export interface ScheduledReport {
  id: string; reportType: string; cadence: string; format: string;
  recipients: string[]; enabled: boolean; lastRunAt: string | null; createdAt: string;
}
export interface ScheduledReportRun {
  id: string; periodLabel: string; status: string; testRun: boolean;
  detail: string | null; createdAt: string;
}
export interface ScheduledReportsResponse { items: ScheduledReport[] }
export interface ScheduledReportRunsResponse { items: ScheduledReportRun[] }

// ---------------------------------------------------------------------------
// Finance ledgers
// ---------------------------------------------------------------------------

export interface SalesLedger {
  rows: { date: string; orderId: string; orderNumber: string; customerName: string; status: string; totalMinor: string; discountMinor: string; deliveryMinor: string; taxMinor: string; paidMinor: string; dueMinor: string }[];
  totals: { orders: number; totalMinor: string; discountMinor: string; deliveryMinor: string; taxMinor: string; paidMinor: string; dueMinor: string };
  total: number; page: number; pageSize: number;
}

export interface CodReceivableLedger {
  outstanding: {
    totalMinor: string; count: number;
    buckets: { d0_7: { count: number; totalMinor: string }; d8_30: { count: number; totalMinor: string }; d31plus: { count: number; totalMinor: string } };
    rows: { orderId: string; orderNumber: string; customerName: string; date: string; totalMinor: string; dueMinor: string; ageDays: number }[];
    truncated: boolean;
  };
  collections: { count: number; totalMinor: string; rows: { date: string; orderId: string; orderNumber: string; provider: string; amountMinor: string }[] };
}

export interface CourierSettlementsLedger {
  imports: { id: string; date: string; provider: string; fileName: string; rowCount: number; matchedCount: number; mismatchCount: number; mismatchDeltaMinor: string; status: string }[];
  totals: { imports: number; lines: number; matched: number; mismatches: number; mismatchDeltaMinor: string };
}

export interface CourierMismatches {
  rows: { importId: string; importDate: string; provider: string; rowNumber: number; trackingId: string; orderRef: string; orderNumber: string; expectedMinor: string; sheetAmountMinor: string; deltaMinor: string }[];
  totals: { count: number; deltaMinor: string };
}

export interface RefundsLedger {
  rows: { date: string; returnId: string; orderId: string; orderNumber: string; resolution: string; status: string; amountMinor: string | null; amountKnown: boolean; partialFull: "full" | "partial" | "unknown" | null }[];
  totals: { count: number; refundAmountMinor: string };
}

/** Gateway fee / settlement rows — same shapes the accounting page uses. */
export interface GatewayFeeRow {
  provider: string; source: string; count: number; grossMinor: string;
  withFeeCount: number; feeMinor: string | null; netMinor: string | null;
}
export interface GatewaySettlementRow {
  provider: string; day: string; count: number; grossMinor: string;
  withFeeCount: number; feeMinor: string | null; netMinor: string | null;
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export interface Expense {
  id: string; category: string; amountMinor: string; spentAt: string;
  note: string | null; paymentMethod: string; receiptUrl: string | null;
  createdById: string; createdAt: string;
}
export interface ExpenseList { items: Expense[]; total: number; page: number; pageSize: number }
export interface ExpenseSummary {
  month: string; totalMinor: string; count: number;
  byCategory: { category: string; count: number; totalMinor: string }[];
}
