import { buildPdf, invoicePage, shippingLabelPage } from "./pdf";

/**
 * Milestone 59 — white-label branding on the M53 PDFs. The PDF
 * writer emits uncompressed content streams, so the brand name and
 * the fill-colour op are directly assertable in the bytes.
 */
describe("M59 PDF branding", () => {
  const label = (brandColor?: string | null) => buildPdf([shippingLabelPage({
    orgName: "Amar Dokan", provider: "steadfast", recipientName: "Rahim",
    recipientPhone: "01700000000", recipientAddress: "Dhaka", invoice: "INV-1",
    trackingCode: "TRK123", codAmountMinor: 10000n, brandColor,
  })]).toString("latin1");

  const invoice = (brandColor?: string | null) => buildPdf([invoicePage({
    orgName: "Amar Dokan", invoiceNo: "INV-1", date: "2026-10-11", customerName: "Rahim",
    items: [{ name: "Shari", quantity: 1, totalMinor: 125000n }],
    subtotalMinor: 125000n, shippingMinor: 6000n, discountMinor: 0n, totalMinor: 131000n,
    paymentLabel: "Cash on Delivery (COD)", brandColor,
  })]).toString("latin1");

  it("label carries the brand (display) name and a brand-colour accent bar", () => {
    const pdf = label("#0E7490");
    expect(pdf).toContain("Amar Dokan");
    // 0x0E=14, 0x74=116, 0x90=144 -> 0.055 0.455 0.565 rg
    expect(pdf).toContain("0.055 0.455 0.565 rg");
  });

  it("invoice carries the brand name and accent bar", () => {
    const pdf = invoice("#0E7490");
    expect(pdf).toContain("Amar Dokan");
    expect(pdf).toContain("0.055 0.455 0.565 rg");
  });

  it("without branding the PDFs render exactly as before (no colour op)", () => {
    expect(label(null)).not.toContain(" rg");
    expect(invoice(undefined)).not.toContain(" rg");
    expect(label(null)).toContain("Amar Dokan");
  });

  it("a malformed brand colour is ignored, never breaks the PDF", () => {
    const pdf = label("not-a-colour");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).not.toContain(" rg");
  });
});
