/**
 * Milestone 53: minimal, dependency-free PDF 1.4 writer plus the
 * shipping-label and invoice page composers. Pages are vector
 * content streams (Helvetica / Helvetica-Bold, rectangles for the
 * Code128 bars from barcode.ts) assembled with a correct xref
 * table - the output is a real PDF, not an HTML print page.
 *
 * Honest limitation: the built-in Type1 fonts cover WinAnsi text.
 * Characters outside printable ASCII (e.g. Bengali script in a
 * recipient address) are replaced with "?" in the PDF; every
 * machine-critical value on the label/invoice (tracking id, order
 * number, amounts, phone) is ASCII and renders exactly. The data
 * itself in the app is unaffected.
 */
import { encodeCode128 } from "./barcode";

export function pdfText(s: unknown): string {
  return String(s ?? "")
    .split("")
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code === 92) return "\\\\";
      if (code === 40) return "\\(";
      if (code === 41) return "\\)";
      if (code < 32 || code > 126) return "?";
      return ch;
    })
    .join("");
}

export function moneyText(minor: bigint | number | string, currency = "BDT"): string {
  const n = Number(BigInt(minor as any)) / 100;
  return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function wrapText(text: string, maxChars: number): string[] {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > maxChars && line) { lines.push(line); line = w; }
    else line = (line + " " + w).trim();
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export class PdfCanvas {
  private ops: string[] = [];
  text(x: number, y: number, size: number, str: string, bold = false): this {
    this.ops.push(`BT /F${bold ? 2 : 1} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${pdfText(str)}) Tj ET`);
    return this;
  }
  rect(x: number, y: number, w: number, h: number): this {
    this.ops.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
    return this;
  }
  /** Milestone 59: set the fill colour from a #RRGGBB brand colour.
   * Invalid input is ignored (black stays) — a bad brand colour must
   * never break a label. Pair with resetFill(). */
  fillColor(hex?: string | null): this {
    const m = /^#([0-9a-fA-F]{6})$/.exec(String(hex ?? ""));
    if (!m) return this;
    const n = parseInt(m[1], 16);
    const c = (v: number) => (v / 255).toFixed(3);
    this.ops.push(`${c((n >> 16) & 255)} ${c((n >> 8) & 255)} ${c(n & 255)} rg`);
    return this;
  }
  resetFill(): this { this.ops.push("0 g"); return this; }
  strokeRect(x: number, y: number, w: number, h: number, lineWidth = 1): this {
    this.ops.push(`${lineWidth} w ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`);
    return this;
  }
  line(x1: number, y: number, x2: number): this {
    this.ops.push(`0.5 w ${x1.toFixed(2)} ${y.toFixed(2)} m ${x2.toFixed(2)} ${y.toFixed(2)} l S`);
    return this;
  }
  /** Draw a real Code128 barcode of `payload` inside the given box. */
  barcode(x: number, y: number, width: number, height: number, payload: string): this {
    const enc = encodeCode128(payload);
    const totalModules = enc.widths.reduce((a, b) => a + b, 0) + 20; // quiet zones
    const moduleW = width / totalModules;
    let cursor = x + 10 * moduleW;
    this.ops.push("0 g");
    enc.widths.forEach((w, i) => {
      if (i % 2 === 0) this.rect(cursor, y, w * moduleW, height);
      cursor += w * moduleW;
    });
    return this;
  }
  build(): string { return this.ops.join("\n"); }
}

export interface PdfPageSpec { width: number; height: number; content: string }

export function buildPdf(pages: PdfPageSpec[]): Buffer {
  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ");
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((page, i) => {
    const pageObj = 5 + i * 2;
    const contentObj = pageObj + 1;
    objects[pageObj] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObj} 0 R >>`;
    objects[contentObj] = page.content;
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let n = 1; n < objects.length; n++) {
    offsets[n] = Buffer.byteLength(out, "latin1");
    if (n >= 6 && n % 2 === 0) {
      // content stream object
      const stream = objects[n];
      out += `${n} 0 obj\n<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream\nendobj\n`;
    } else {
      out += `${n} 0 obj\n${objects[n]}\nendobj\n`;
    }
  }
  const xrefAt = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objects.length; n++) out += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** One 4x6" shipping-label page for a booked shipment. */
export function shippingLabelPage(input: {
  orgName: string; orgPhone?: string | null; provider: string;
  recipientName: string; recipientPhone: string; recipientAddress: string;
  invoice: string; trackingCode: string; codAmountMinor: bigint | number | string; currency?: string;
  brandColor?: string | null;
}): PdfPageSpec {
  const c = new PdfCanvas();
  const W = 288, H = 432;
  c.strokeRect(6, 6, W - 12, H - 12, 1.5);
  if (input.brandColor) { c.fillColor(input.brandColor); c.rect(6, H - 11, W - 12, 4); c.resetFill(); }
  c.text(16, H - 30, 9, "FROM:");
  c.text(16, H - 46, 12, input.orgName, true);
  if (input.orgPhone) c.text(16, H - 60, 9, `Phone: ${input.orgPhone}`);
  c.line(16, H - 70, W - 16);
  c.text(16, H - 88, 9, "TO:");
  c.text(16, H - 108, 15, input.recipientName, true);
  c.text(16, H - 124, 11, `Phone: ${input.recipientPhone}`);
  let y = H - 140;
  for (const line of wrapText(input.recipientAddress, 36).slice(0, 4)) { c.text(16, y, 10, line); y -= 13; }
  c.line(16, y - 2, W - 16);
  c.text(16, y - 20, 10, `Order: ${input.invoice}`);
  c.text(16, y - 34, 10, `Courier: ${input.provider}`);
  const cod = BigInt(input.codAmountMinor as any);
  c.text(16, y - 56, 13, cod > 0n ? `COD: ${moneyText(cod, input.currency)}` : "PREPAID - NO COD", true);
  const barcodeY = 56;
  c.barcode(24, barcodeY, W - 48, 52, input.trackingCode);
  const tw = Math.min(W - 32, input.trackingCode.length * 7.2);
  c.text((W - tw) / 2, barcodeY - 16, 12, input.trackingCode, true);
  return { width: W, height: H, content: c.build() };
}

/** One A4 invoice page for an order, from the stored order rows. */
export function invoicePage(input: {
  orgName: string; orgPhone?: string | null; invoiceNo: string; date: string;
  customerName: string; customerPhone?: string | null;
  items: { name: string; quantity: number; totalMinor: bigint | number | string }[];
  subtotalMinor: bigint | number | string; shippingMinor: bigint | number | string;
  discountMinor: bigint | number | string; totalMinor: bigint | number | string;
  paymentLabel: string; currency?: string;
  brandColor?: string | null;
  // ON10: optional print-template fields (PrintTemplateSetting).
  // Each renders ONLY when non-empty, so a template with every
  // field unset produces a byte-identical page to the pre-ON10
  // composer (spec-pinned in on10-print.spec.ts).
  invoiceNote?: string | null;
  termsText?: string | null;
  footerText?: string | null;
}): PdfPageSpec {
  const c = new PdfCanvas();
  const W = 595, H = 842;
  c.text(48, H - 56, 18, input.orgName, true);
  if (input.brandColor) { c.fillColor(input.brandColor); c.rect(48, H - 66, W - 96, 3); c.resetFill(); }
  if (input.orgPhone) c.text(48, H - 72, 9, `Phone: ${input.orgPhone}`);
  c.text(48, H - 96, 13, "INVOICE", true);
  c.text(48, H - 112, 10, `Invoice: ${input.invoiceNo}   Date: ${input.date}`);
  c.text(48, H - 126, 10, `Billed to: ${input.customerName}${input.customerPhone ? ` (${input.customerPhone})` : ""}`);
  c.text(48, H - 140, 10, `Payment: ${input.paymentLabel}`);
  c.line(48, H - 150, W - 48);
  let y = H - 172;
  c.text(48, y, 10, "Item", true); c.text(W - 168, y, 10, "Qty", true); c.text(W - 118, y, 10, "Amount", true);
  y -= 8; c.line(48, y, W - 48); y -= 18;
  for (const item of input.items) {
    const nameLines = wrapText(item.name, 52).slice(0, 2);
    c.text(48, y, 10, nameLines[0]);
    if (nameLines[1]) c.text(48, y - 12, 10, nameLines[1]);
    c.text(W - 168, y, 10, String(item.quantity));
    c.text(W - 118, y, 10, moneyText(item.totalMinor, input.currency));
    y -= nameLines[1] ? 26 : 16;
    if (y < 150) break;
  }
  y -= 6; c.line(48, y, W - 48); y -= 20;
  const row = (label: string, minor: any, bold = false) => { c.text(W - 260, y, 10, label, bold); c.text(W - 118, y, 10, moneyText(minor, input.currency), bold); y -= 15; };
  row("Subtotal", input.subtotalMinor);
  row("Shipping", input.shippingMinor);
  if (BigInt(input.discountMinor as any) > 0n) row("Discount", input.discountMinor);
  row("Total", input.totalMinor, true);
  // ON10 template blocks — rendered only when set (see the
  // interface note above; unset = pre-ON10 bytes exactly).
  const note = String(input.invoiceNote ?? "").trim();
  if (note) {
    y -= 8;
    for (const line of wrapText(`Note: ${note}`, 88).slice(0, 3)) { c.text(48, y, 9, line); y -= 12; }
  }
  const terms = String(input.termsText ?? "").trim();
  if (terms) {
    y -= 6;
    c.text(48, y, 9, "Terms:", true); y -= 12;
    for (const line of wrapText(terms, 92).slice(0, 5)) { c.text(48, y, 8, line); y -= 11; }
  }
  c.text(48, 64, 8, "Generated from the order record exactly as stored in the system.");
  const footer = String(input.footerText ?? "").trim();
  if (footer) c.text(48, 48, 8, wrapText(footer, 100)[0]);
  return { width: W, height: H, content: c.build() };
}

/**
 * GC22 (GB9): one A4 SaaS subscription invoice page — the PDF
 * rendering of the SAME structured data buildInvoiceHtml uses
 * in payments.service (saasInvoiceData): identical invoice
 * number, org, amounts and dates. Seller is the platform
 * (Qosprey); the org is the buyer.
 */
export function saasInvoicePage(input: {
  orgName: string; invoiceNo: string; date: string;
  metaLines: string[];
  items: { label: string; amountText: string }[];
  totalLabel: string; totalText: string;
}): PdfPageSpec {
  const c = new PdfCanvas();
  const W = 595, H = 842;
  c.text(48, H - 56, 18, "Qosprey - AI Marketing SaaS", true);
  c.text(48, H - 96, 13, "INVOICE", true);
  c.text(48, H - 112, 10, `Invoice: ${input.invoiceNo}   Issued: ${input.date}`);
  let y = H - 132;
  c.text(48, y, 10, `Billed to: ${input.orgName}`, true); y -= 14;
  for (const line of input.metaLines) {
    for (const wrapped of wrapText(line, 92).slice(0, 2)) { c.text(48, y, 9, wrapped); y -= 12; }
  }
  y -= 6; c.line(48, y, W - 48); y -= 22;
  for (const item of input.items) {
    c.text(48, y, 10, item.label);
    c.text(W - 190, y, 10, item.amountText);
    y -= 16;
  }
  y -= 4; c.line(48, y, W - 48); y -= 20;
  c.text(W - 300, y, 11, input.totalLabel, true);
  c.text(W - 190, y, 11, input.totalText, true);
  c.text(48, 64, 8, "Generated from the platform's payment records. Amounts are shown exactly as recorded.");
  return { width: W, height: H, content: c.build() };
}

/**
 * ON10: one A4 delivery-challan page for an order — what the
 * courier hands over: order number, customer + phone + address,
 * the item lines (name × qty, NO prices — a challan is a
 * delivery document, not a bill) and the COD amount still due
 * (EC19 math, computed by the caller: total − Σ APPROVED
 * PaymentVerification amounts, capped at the total).
 */
export function challanPage(input: {
  orgName: string; orgPhone?: string | null; orderNo: string; date: string;
  customerName: string; customerPhone?: string | null; address?: string | null;
  items: { name: string; quantity: number }[];
  codDueMinor: bigint | number | string; currency?: string;
  brandColor?: string | null;
  termsText?: string | null;
  footerText?: string | null;
}): PdfPageSpec {
  const c = new PdfCanvas();
  const W = 595, H = 842;
  c.text(48, H - 56, 18, input.orgName, true);
  if (input.brandColor) { c.fillColor(input.brandColor); c.rect(48, H - 66, W - 96, 3); c.resetFill(); }
  if (input.orgPhone) c.text(48, H - 72, 9, `Phone: ${input.orgPhone}`);
  c.text(48, H - 96, 13, "DELIVERY CHALLAN", true);
  c.text(48, H - 112, 10, `Order: ${input.orderNo}   Date: ${input.date}`);
  c.text(48, H - 126, 10, `Customer: ${input.customerName}${input.customerPhone ? ` (${input.customerPhone})` : ""}`);
  let y = H - 140;
  const address = String(input.address ?? "").trim();
  if (address) {
    for (const line of wrapText(`Address: ${address}`, 88).slice(0, 3)) { c.text(48, y, 10, line); y -= 13; }
  }
  y -= 4; c.line(48, y, W - 48); y -= 22;
  c.text(48, y, 10, "Item", true); c.text(W - 118, y, 10, "Qty", true);
  y -= 8; c.line(48, y, W - 48); y -= 18;
  for (const item of input.items) {
    const nameLines = wrapText(item.name, 58).slice(0, 2);
    c.text(48, y, 10, nameLines[0]);
    if (nameLines[1]) c.text(48, y - 12, 10, nameLines[1]);
    c.text(W - 118, y, 10, String(item.quantity));
    y -= nameLines[1] ? 26 : 16;
    if (y < 190) break;
  }
  y -= 6; c.line(48, y, W - 48); y -= 24;
  const due = BigInt(input.codDueMinor as any);
  c.text(48, y, 12, due > 0n ? `COD amount due: ${moneyText(due, input.currency)}` : "No COD due (already paid)", true);
  y -= 28;
  c.text(48, y, 9, "Received by: ______________________    Signature: ______________________");
  const terms = String(input.termsText ?? "").trim();
  if (terms) {
    y -= 26;
    c.text(48, y, 9, "Terms:", true); y -= 12;
    for (const line of wrapText(terms, 92).slice(0, 5)) { c.text(48, y, 8, line); y -= 11; }
  }
  const footer = String(input.footerText ?? "").trim();
  if (footer) c.text(48, 48, 8, wrapText(footer, 100)[0]);
  return { width: W, height: H, content: c.build() };
}

/**
 * ON10: one A4 packing-slip page for an order — the server-side
 * mirror of the web print page's slip (apps/web .../commerce/
 * print/page.tsx, kind=slip), built from the SAME stored fields
 * that page reads through GET orders/:orderId: item lines
 * (name × qty, SKU, gift + bundle markers — NO prices, a slip
 * is a packing document), the EC29 gift message, and the
 * delivery address. Bengali text hits the toolkit's documented
 * WinAnsi limit exactly like labels/invoices do.
 */
export function packingSlipPage(input: {
  orgName: string; orgPhone?: string | null; orderNo: string; date: string;
  customerName: string; customerPhone?: string | null; address?: string | null;
  items: { name: string; quantity: number; sku?: string | null; isGift?: boolean; bundleName?: string | null }[];
  giftMessage?: string | null;
  brandColor?: string | null;
  footerText?: string | null;
}): PdfPageSpec {
  const c = new PdfCanvas();
  const W = 595, H = 842;
  c.text(48, H - 56, 18, input.orgName, true);
  if (input.brandColor) { c.fillColor(input.brandColor); c.rect(48, H - 66, W - 96, 3); c.resetFill(); }
  if (input.orgPhone) c.text(48, H - 72, 9, `Phone: ${input.orgPhone}`);
  c.text(48, H - 96, 13, "PACKING SLIP", true);
  c.text(48, H - 112, 10, `Order: ${input.orderNo}   Date: ${input.date}`);
  c.text(48, H - 126, 10, `Customer: ${input.customerName}${input.customerPhone ? ` (${input.customerPhone})` : ""}`);
  let y = H - 140;
  const address = String(input.address ?? "").trim();
  if (address) {
    for (const line of wrapText(`Address: ${address}`, 88).slice(0, 3)) { c.text(48, y, 10, line); y -= 13; }
  }
  const gift = String(input.giftMessage ?? "").trim();
  if (gift) {
    y -= 6;
    const giftLines = wrapText(`Gift message: ${gift}`, 80).slice(0, 3);
    c.strokeRect(48, y - giftLines.length * 13 - 6, W - 96, giftLines.length * 13 + 12, 1.2);
    for (const line of giftLines) { c.text(60, y, 10, line, true); y -= 13; }
    y -= 6;
  }
  y -= 4; c.line(48, y, W - 48); y -= 22;
  c.text(48, y, 10, "Item", true); c.text(W - 118, y, 10, "Qty", true);
  y -= 8; c.line(48, y, W - 48); y -= 18;
  for (const item of input.items) {
    const label = `${item.isGift ? "GIFT - " : ""}${item.name}`;
    const nameLines = wrapText(label, 58).slice(0, 2);
    c.text(48, y, 10, nameLines[0]);
    if (nameLines[1]) c.text(48, y - 12, 10, nameLines[1]);
    c.text(W - 118, y, 10, String(item.quantity));
    y -= nameLines[1] ? 26 : 16;
    const sub = [item.sku ? `SKU: ${item.sku}` : null, item.bundleName ? `Bundle: ${item.bundleName}` : null].filter(Boolean).join("   ");
    if (sub) { c.text(48, y, 8, sub); y -= 12; }
    if (y < 120) break;
  }
  const footer = String(input.footerText ?? "").trim();
  if (footer) c.text(48, 48, 8, wrapText(footer, 100)[0]);
  return { width: W, height: H, content: c.build() };
}
