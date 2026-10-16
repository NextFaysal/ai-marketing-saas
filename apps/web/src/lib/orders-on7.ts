/**
 * ON7 (Orders Next): Profit & খাতা (customer ledger) — pure
 * helpers for the per-order profit card, the profit report, the
 * COD board and the customer খাতা section. Side-effect free,
 * unit-testable. Money is minor-unit STRINGS (API contract);
 * a null money field means "unknown" and is NEVER rendered as
 * 0 — the honesty rule of the whole profit surface.
 */

export interface OrderProfit {
  orderId: string;
  orderNumber?: string | null;
  revenueMinor: string;
  discountMinor: string;
  deliveryChargedMinor: string;
  productCostMinor: string | null;
  costedLines: number;
  uncostedLines: { name: string; sku?: string | null; quantity: number; revenueMinor: string }[];
  uncostedRevenueMinor: string;
  grossMarginMinor: string | null;
  deliveryActualMinor: string | null;
  deliveryActualCoverage: { shipments: number; withCharge: number };
  netMarginMinor: string | null;
}

export interface ProfitReport {
  range: { from: string; to: string };
  totals: {
    orders: number;
    revenueMinor: string;
    productCostMinor: string;
    costedRevenueMinor: string;
    costCoveragePercent: number | null;
    grossMarginMinor: string;
    uncostedOrders: number;
  };
  perProduct: {
    productId: string; name: string; sku?: string | null; quantity: number;
    revenueMinor: string; costMinor: string | null; marginMinor: string | null;
  }[];
  perProductBasis: string;
  truncated: boolean;
  /** GB8 / GC20 — finance overlay: period expenses + gateway
   * fees folded into an estimated net. estimatedNetMinor is
   * null unless product-cost coverage is complete; reasons
   * explain why (verbatim from the server). */
  finance?: {
    periodExpensesMinor: string;
    gatewayFeesMinor: string | null;
    estimatedNetMinor: string | null;
    reasons: string[];
  };
}

export interface CodBoard {
  providers: {
    provider: string;
    inTransitCodMinor: string;
    deliveredUncollectedMinor: string;
    collectedLast7dMinor: string;
    outstandingMinor: string;
  }[];
  unassigned: { orders: number; dueMinor: string };
  totals: {
    inTransitCodMinor: string;
    deliveredUncollectedMinor: string;
    collectedLast7dMinor: string;
    outstandingMinor: string;
  };
}

export interface CustomerKhata {
  customerId: string;
  // AB5 (AX7): the customer's net terms in days (0 = no terms).
  creditTermsDays?: number;
  orders: {
    id: string; number?: string | null; placedAt?: string | null;
    status: string; source: string;
    totalMinor: string; paidMinor: string; dueMinor: string;
    // AB5 (AX7): net-terms due date snapshot + overdue flag.
    creditDueDate?: string | null;
    overdue?: boolean;
  }[];
  ordersTruncated: boolean;
  totalDueMinor: string;
  aging: { d0_7: string; d8_15: string; d16_30: string; d30plus: string };
  creditLimitMinor: string | null;
  overLimit: boolean;
  availableCreditMinor: string | null;
}

export type MarginTone = "positive" | "negative" | "unknown";

/** Margin chip tone. Null / unparseable = "unknown" (the chip
 * is hidden or neutral — never green on missing data). Zero is
 * not a loss, so it reads "positive". */
export function marginTone(marginMinor: string | null | undefined): MarginTone {
  if (marginMinor == null) return "unknown";
  try {
    const v = BigInt(marginMinor);
    return v < 0n ? "negative" : "positive";
  } catch { return "unknown"; }
}

/** Overpaid check from the order's own fields (advance paid
 * beyond the current total). Returns the excess minor string,
 * or null when not overpaid / fields missing. */
export function overpaidMinorOf(
  advancePaidMinor?: string | null,
  totalMinor?: string | null,
): string | null {
  if (advancePaidMinor == null || totalMinor == null) return null;
  try {
    const diff = BigInt(advancePaidMinor) - BigInt(totalMinor);
    return diff > 0n ? diff.toString() : null;
  } catch { return null; }
}

export interface AgingRow { key: string; label: string; amountMinor: string }

/** খাতা aging buckets -> display rows, oldest last. Labels use
 * Bengali digits, matching the dashboard's number style. */
export function agingRows(khata: Pick<CustomerKhata, "aging">): AgingRow[] {
  const a = khata.aging ?? { d0_7: "0", d8_15: "0", d16_30: "0", d30plus: "0" };
  return [
    { key: "d0_7", label: "০–৭ দিন", amountMinor: a.d0_7 },
    { key: "d8_15", label: "৮–১৫ দিন", amountMinor: a.d8_15 },
    { key: "d16_30", label: "১৬–৩০ দিন", amountMinor: a.d16_30 },
    { key: "d30plus", label: "৩০ দিনের বেশি", amountMinor: a.d30plus },
  ];
}

/** True when the customer is over their credit limit — the
 * server's flag wins; a negative available-credit figure says
 * the same thing and is honoured too (either signal alone is
 * enough to warn). */
export function isOverLimit(khata: Pick<CustomerKhata, "overLimit" | "availableCreditMinor">): boolean {
  if (khata.overLimit) return true;
  if (khata.availableCreditMinor != null) {
    try { return BigInt(khata.availableCreditMinor) < 0n; } catch { return false; }
  }
  return false;
}

export interface CodBoardRow {
  key: string;
  provider: string;
  inTransitCodMinor: string;
  deliveredUncollectedMinor: string;
  collectedLast7dMinor: string;
  outstandingMinor: string;
  kind: "provider" | "unassigned" | "total";
  /** Unassigned row only: how many orders have not gone to a
   * courier yet (their due is not courier money at all). */
  unassignedOrders?: number;
}

/** COD board -> table rows: one per provider, then the
 * unassigned row (orders not yet handed to any courier — shown
 * only when such orders exist), then the totals row. */
export function codBoardRows(board: CodBoard): CodBoardRow[] {
  const rows: CodBoardRow[] = (board.providers ?? []).map((p) => ({
    key: `provider-${p.provider}`,
    provider: p.provider,
    inTransitCodMinor: p.inTransitCodMinor,
    deliveredUncollectedMinor: p.deliveredUncollectedMinor,
    collectedLast7dMinor: p.collectedLast7dMinor,
    outstandingMinor: p.outstandingMinor,
    kind: "provider" as const,
  }));
  if (board.unassigned && board.unassigned.orders > 0) {
    rows.push({
      key: "unassigned",
      provider: "এখনো courier-এ যায়নি",
      inTransitCodMinor: "0",
      deliveredUncollectedMinor: "0",
      collectedLast7dMinor: "0",
      outstandingMinor: board.unassigned.dueMinor,
      kind: "unassigned",
      unassignedOrders: board.unassigned.orders,
    });
  }
  rows.push({
    key: "total",
    provider: "মোট",
    inTransitCodMinor: board.totals.inTransitCodMinor,
    deliveredUncollectedMinor: board.totals.deliveredUncollectedMinor,
    collectedLast7dMinor: board.totals.collectedLast7dMinor,
    outstandingMinor: board.totals.outstandingMinor,
    kind: "total",
  });
  return rows;
}

/** Cost-coverage caption for the profit report: of all the
 * revenue on lines, what share has a known product cost. Null
 * percent (no revenue at all) says so plainly instead of
 * printing a fake 0%. */
export function coverageLabel(percent: number | null | undefined): string {
  if (percent == null || !Number.isFinite(percent)) {
    return "এই সময়ে খরচ জানা আছে এমন কোনো লাইন-আয় নেই";
  }
  const p = Number.isInteger(percent) ? String(percent) : percent.toFixed(1);
  return `মোট লাইন-আয়ের ${p}% অংশের খরচ জানা আছে`;
}

/** Caption for partial courier-charge coverage on the profit
 * card: how many of the order's shipments actually reported a
 * courier charge. Null when coverage is complete (nothing to
 * explain) or there are no shipments at all. */
export function deliveryCoverageCaption(
  coverage: { shipments: number; withCharge: number } | null | undefined,
): string | null {
  if (!coverage || coverage.shipments <= 0) return null;
  if (coverage.withCharge >= coverage.shipments) return null;
  return `shipment ${coverage.withCharge}/${coverage.shipments}-তে courier চার্জ পাওয়া গেছে`;
}
