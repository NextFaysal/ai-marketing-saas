/**
 * POS Cash Drawer Reconciliation & Shift Closing (Z-Report) Engine
 * Designed for Bangladeshi retail shops accepting Cash, bKash, Nagad, and Cards.
 */

export interface DrawerClosingParams {
  openingFloatMinor: bigint | number | string;
  cashSalesMinor: bigint | number | string;
  digitalSalesMinor: bigint | number | string;
  cashRefundsMinor?: bigint | number | string;
  cashPayoutsMinor?: bigint | number | string;
  actualCashCountedMinor: bigint | number | string;
}

export type DiscrepancyStatus = "balanced" | "over" | "short";

export interface DrawerReconciliationResult {
  openingFloatMinor: bigint;
  cashSalesMinor: bigint;
  digitalSalesMinor: bigint;
  cashRefundsMinor: bigint;
  cashPayoutsMinor: bigint;
  expectedCashInDrawerMinor: bigint;
  actualCashCountedMinor: bigint;
  discrepancyMinor: bigint;
  status: DiscrepancyStatus;
  discrepancyFormatted: string;
  summaryBangla: string;
}

export function calculateDrawerReconciliation(params: DrawerClosingParams): DrawerReconciliationResult {
  const opening = BigInt(params.openingFloatMinor || 0);
  const cashSales = BigInt(params.cashSalesMinor || 0);
  const digitalSales = BigInt(params.digitalSalesMinor || 0);
  const refunds = BigInt(params.cashRefundsMinor || 0);
  const payouts = BigInt(params.cashPayoutsMinor || 0);
  const actual = BigInt(params.actualCashCountedMinor || 0);

  const expectedCash = opening + cashSales - refunds - payouts;
  const discrepancy = actual - expectedCash;

  let status: DiscrepancyStatus = "balanced";
  let discrepancyFormatted = "৳০.০০";
  let summaryBangla = "ক্যাশ ড্রয়ার সম্পূর্ণ ব্যালেন্সড (হিসাব নির্ভুল)";

  if (discrepancy > 0n) {
    status = "over";
    const overTaka = (Number(discrepancy) / 100).toFixed(2);
    discrepancyFormatted = `+৳${overTaka}`;
    summaryBangla = `ক্যাশ ড্রয়ারে ৳${overTaka} বেশি রয়েছে (Over)`;
  } else if (discrepancy < 0n) {
    status = "short";
    const shortTaka = (Number(-discrepancy) / 100).toFixed(2);
    discrepancyFormatted = `-৳${shortTaka}`;
    summaryBangla = `ক্যাশ ড্রয়ারে ৳${shortTaka} কম রয়েছে (Short)`;
  }

  return {
    openingFloatMinor: opening,
    cashSalesMinor: cashSales,
    digitalSalesMinor: digitalSales,
    cashRefundsMinor: refunds,
    cashPayoutsMinor: payouts,
    expectedCashInDrawerMinor: expectedCash,
    actualCashCountedMinor: actual,
    discrepancyMinor: discrepancy,
    status,
    discrepancyFormatted,
    summaryBangla,
  };
}

export interface ShiftClosingSlipData {
  shopName: string;
  cashierName: string;
  shiftStartTime: string;
  shiftEndTime: string;
  orderCount: number;
  totalSalesMinor: bigint | number | string;
  reconciliation: DrawerReconciliationResult;
}

/**
 * Builds formatted 80mm Z-Report Text slip for thermal receipt printing
 */
export function buildZReportText(data: ShiftClosingSlipData): string {
  const totalSalesTaka = (Number(data.totalSalesMinor) / 100).toFixed(2);
  const openingTaka = (Number(data.reconciliation.openingFloatMinor) / 100).toFixed(2);
  const cashSalesTaka = (Number(data.reconciliation.cashSalesMinor) / 100).toFixed(2);
  const digitalSalesTaka = (Number(data.reconciliation.digitalSalesMinor) / 100).toFixed(2);
  const expectedTaka = (Number(data.reconciliation.expectedCashInDrawerMinor) / 100).toFixed(2);
  const actualTaka = (Number(data.reconciliation.actualCashCountedMinor) / 100).toFixed(2);

  return `================================
${data.shopName.toUpperCase()}
কাউন্টার শিফট সমাপ্তি রিপোর্ট (Z-REPORT)
================================
ক্যাশিয়ার: ${data.cashierName}
তারিখ: ${new Date().toLocaleDateString("bn-BD")}
শিফট শুরু: ${data.shiftStartTime}
শিফট শেষ: ${data.shiftEndTime}
--------------------------------
মোট অর্ডার সংখ্যা: ${data.orderCount} টি
সর্বমোট বিক্রি: ৳${totalSalesTaka}
 - নগদ বিক্রি: ৳${cashSalesTaka}
 - ডিজিটাল (বিকাশ/নগদ/কার্ড): ৳${digitalSalesTaka}
--------------------------------
ক্যাশ ড্রয়ার রিকনসিলিয়েশন:
প্রারম্ভিক ক্যাশ ফ্লোট: ৳${openingTaka}
প্রত্যাশিত ক্যাশ ড্রয়ার: ৳${expectedTaka}
হাতে গোনা নগদ ক্যাশ: ৳${actualTaka}
পার্থক্য (Discrepancy): ${data.reconciliation.discrepancyFormatted}
স্ট্যাটাস: ${data.reconciliation.summaryBangla}
================================
ম্যানেজার স্বাক্ষর: ____________
ক্যাশিয়ার স্বাক্ষর: ____________
================================`.trim();
}
