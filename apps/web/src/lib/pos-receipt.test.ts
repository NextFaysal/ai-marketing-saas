import { describe, expect, it } from "vitest";
import {
  DEFAULT_RECEIPT_SETTINGS,
  generateBarcodeSvg,
  calculateLabelGrid,
} from "./pos-receipt";
import {
  calculateDrawerReconciliation,
  buildZReportText,
} from "./pos-closing";

describe("POS Receipt Customizer & Barcode Label Helpers", () => {
  it("provides default Bengali receipt settings with 80mm width", () => {
    expect(DEFAULT_RECEIPT_SETTINGS.paperWidth).toBe("80mm");
    expect(DEFAULT_RECEIPT_SETTINGS.showBarcode).toBe(true);
    expect(DEFAULT_RECEIPT_SETTINGS.returnPolicy).toContain("ক্যাশ মেমো");
    expect(DEFAULT_RECEIPT_SETTINGS.footerGreeting).toContain("আবার আসবেন");
  });

  it("generates valid SVG Code128 barcode markup for products and receipts", () => {
    const svg = generateBarcodeSvg("PRD-10293");
    expect(svg).toContain("<svg");
    expect(svg).toContain("PRD-10293");
    expect(svg).toContain("<rect");
  });

  it("calculates A4 label grid pages accurately", () => {
    const grid1 = calculateLabelGrid(24);
    expect(grid1.totalPages).toBe(1);
    expect(grid1.labelsPerPage).toBe(24);

    const grid2 = calculateLabelGrid(50);
    expect(grid2.totalPages).toBe(3);
  });
});

describe("POS Cash Drawer Reconciliation & Z-Report Engine", () => {
  it("computes accurate balanced cash drawer when actual matches expected", () => {
    // Opening ৳2,000 (200000 minor) + Cash Sales ৳8,000 (800000 minor) = Expected ৳10,000
    const rec = calculateDrawerReconciliation({
      openingFloatMinor: "200000",
      cashSalesMinor: "800000",
      digitalSalesMinor: "500000",
      actualCashCountedMinor: "1000000",
    });

    expect(rec.status).toBe("balanced");
    expect(rec.discrepancyMinor).toBe(0n);
    expect(rec.discrepancyFormatted).toBe("৳০.০০");
  });

  it("identifies short cash discrepancy when cash is missing", () => {
    // Expected ৳10,000, Actual counted ৳9,800 -> ৳200 short
    const rec = calculateDrawerReconciliation({
      openingFloatMinor: "200000",
      cashSalesMinor: "800000",
      digitalSalesMinor: "0",
      actualCashCountedMinor: "980000",
    });

    expect(rec.status).toBe("short");
    expect(rec.discrepancyMinor).toBe(-20000n);
    expect(rec.discrepancyFormatted).toBe("-৳200.00");
    expect(rec.summaryBangla).toContain("কম রয়েছে");
  });

  it("identifies over cash discrepancy when excess cash exists", () => {
    // Expected ৳10,000, Actual counted ৳10,150 -> ৳150 over
    const rec = calculateDrawerReconciliation({
      openingFloatMinor: "200000",
      cashSalesMinor: "800000",
      digitalSalesMinor: "0",
      actualCashCountedMinor: "1015000",
    });

    expect(rec.status).toBe("over");
    expect(rec.discrepancyMinor).toBe(15000n);
    expect(rec.discrepancyFormatted).toBe("+৳150.00");
    expect(rec.summaryBangla).toContain("বেশি রয়েছে");
  });

  it("builds formatted 80mm Z-Report text slip", () => {
    const rec = calculateDrawerReconciliation({
      openingFloatMinor: "200000",
      cashSalesMinor: "500000",
      digitalSalesMinor: "300000",
      actualCashCountedMinor: "700000",
    });

    const slip = buildZReportText({
      shopName: "স্মার্ট রিটেল মিরপুর",
      cashierName: "সাকিব হাসান",
      shiftStartTime: "10:00 AM",
      shiftEndTime: "08:00 PM",
      orderCount: 14,
      totalSalesMinor: "800000",
      reconciliation: rec,
    });

    expect(slip).toContain("স্মার্ট রিটেল মিরপুর");
    expect(slip).toContain("Z-REPORT");
    expect(slip).toContain("সাকিব হাসান");
    expect(slip).toContain("মোট অর্ডার সংখ্যা: 14 টি");
    expect(slip).toContain("সর্বমোট বিক্রি: ৳8000.00");
    expect(slip).toContain("ক্যাশ ড্রয়ার সম্পূর্ণ ব্যালেন্সড");
  });
});
