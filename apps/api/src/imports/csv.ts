import Papa from "papaparse";
import { parseMoneyToMinor } from "@repo/contracts";

export interface ParsedProductRow {
  rowNumber: number; // 1-based data row number (header excluded)
  name: string;
  sku?: string;
  priceMinor: bigint;
  compareAtMinor?: bigint;
  currency: string;
  costMinor?: bigint;
  stockQuantity?: number;
  category?: string;
  description?: string;
  imageUrl?: string;
}

export interface CsvRowError { row: number; message: string }
export interface ParseResult { rows: ParsedProductRow[]; errors: CsvRowError[]; totalRows: number }

const HEADER_ALIASES: Record<string, string> = {
  name: "name", product_name: "name", title: "name",
  sku: "sku", price: "price", sale_price: "price",
  compare_at_price: "compareAtPrice", regular_price: "compareAtPrice",
  currency: "currency", cost: "cost", unit_cost: "cost",
  stock: "stock", stock_quantity: "stock", quantity: "stock", inventory: "stock",
  category: "category", description: "description", image_url: "imageUrl", image: "imageUrl",
};

function moneyOrThrow(value: string, field: string): bigint {
  try { return parseMoneyToMinor(value); } catch { throw new Error(`Invalid ${field}: "${value}"`); }
}

/**
 * Expected CSV columns (case-insensitive, spaces or underscores):
 * name (required), price (required), sku, compare_at_price, currency,
 * cost, stock, category, description, image_url
 * Sample file: docs/examples/products-sample.csv
 */
export function parseProductsCsv(csvText: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
  });
  const rows: ParsedProductRow[] = [];
  const errors: CsvRowError[] = [];

  parsed.data.forEach((raw, idx) => {
    const rowNumber = idx + 1;
    const rec: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      const canonical = HEADER_ALIASES[key];
      if (canonical) rec[canonical] = typeof value === "string" ? value.trim() : "";
    }
    try {
      if (!rec.name) throw new Error("Missing required column: name");
      if (!rec.price) throw new Error("Missing required column: price");
      const priceMinor = moneyOrThrow(rec.price, "price");
      if (priceMinor < 0n) throw new Error("Price cannot be negative");
      let stockQuantity: number | undefined;
      if (rec.stock) {
        const n = Number(rec.stock);
        if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid stock: "${rec.stock}"`);
        stockQuantity = n;
      }
      rows.push({
        rowNumber,
        name: rec.name,
        sku: rec.sku || undefined,
        priceMinor,
        compareAtMinor: rec.compareAtPrice ? moneyOrThrow(rec.compareAtPrice, "compare_at_price") : undefined,
        currency: (rec.currency || "BDT").toUpperCase(),
        costMinor: rec.cost ? moneyOrThrow(rec.cost, "cost") : undefined,
        stockQuantity,
        category: rec.category || undefined,
        description: rec.description || undefined,
        imageUrl: rec.imageUrl || undefined,
      });
    } catch (e) {
      errors.push({ row: rowNumber, message: e instanceof Error ? e.message : "Invalid row" });
    }
  });

  return { rows, errors, totalRows: parsed.data.length };
}

// ---------------- Shared CSV writing (exports) ----------------

/** Same escaping discipline as the inbox scorecard CSV: quote when
 * the value contains a quote, comma or newline; double the quotes. */
export function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) lines.push(row.map(csvEscape).join(","));
  return lines.join("\n");
}

/** BigInt minor units (poisha) -> major-unit string with exactly
 * two decimals, integer math only (no float drift). */
export function minorToMajor(minor: bigint): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  return `${neg ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}

// ---------------- CRM C3: leads CSV import ----------------

export interface ParsedLeadRow {
  rowNumber: number; // 1-based data row number (header excluded)
  name: string;
  phone?: string;
  email?: string;
  source: string;
  stage: string;
  tags: string[];
  value?: string; // taka string, re-parsed by LeadsService.create
  notes?: string;
  nextFollowUpAt?: string; // ISO date string, validated parseable
}
export interface LeadParseResult { rows: ParsedLeadRow[]; errors: CsvRowError[]; totalRows: number }

const LEAD_HEADER_ALIASES: Record<string, string> = {
  name: "name", lead_name: "name", full_name: "name", customer_name: "name",
  phone: "phone", mobile: "phone", customer_phone: "phone", phone_number: "phone",
  email: "email", customer_email: "email", email_address: "email",
  source: "source", stage: "stage", status: "stage",
  tags: "tags", tag: "tags",
  value: "value", lead_value: "value", amount: "value", estimated_value: "value",
  notes: "notes", note: "notes", comment: "notes",
  next_follow_up_at: "nextFollowUpAt", next_follow_up: "nextFollowUpAt", follow_up_at: "nextFollowUpAt", follow_up_date: "nextFollowUpAt",
};
// Mirror of LeadsService.LEAD_SOURCES / LEAD_STAGES (crm/leads.service.ts),
// the manual-create vocabulary. `facebook_lead_ads` is deliberately NOT
// importable: that source is reserved for the Meta webhook ingestion,
// which dedupes on externalId. LeadsService.create() re-validates anyway.
const LEAD_CSV_SOURCES = ["manual", "whatsapp", "messenger", "woocommerce", "website"];
const LEAD_CSV_STAGES = ["new", "contacted", "qualified", "proposal", "won", "lost"];

/**
 * Expected CSV columns (case-insensitive, spaces or underscores):
 * name (required), phone, email, source, stage, tags (| or ;
 * separated), value (BDT taka, major units like the other CSVs),
 * notes, next_follow_up_at (ISO date). Unknown columns are ignored.
 * Sample file: docs/examples/leads-sample.csv
 */
export function parseLeadsCsv(csvText: string): LeadParseResult {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
  });
  const rows: ParsedLeadRow[] = [];
  const errors: CsvRowError[] = [];
  parsed.data.forEach((raw, idx) => {
    const rowNumber = idx + 1;
    const rec: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      const canonical = LEAD_HEADER_ALIASES[key];
      if (canonical) rec[canonical] = typeof value === "string" ? value.trim() : "";
    }
    try {
      if (!rec.name) throw new Error("Missing required column: name");
      const source = (rec.source || "manual").toLowerCase();
      if (!LEAD_CSV_SOURCES.includes(source)) throw new Error(`Invalid source: "${rec.source}" (use ${LEAD_CSV_SOURCES.join(", ")})`);
      const stage = (rec.stage || "new").toLowerCase();
      if (!LEAD_CSV_STAGES.includes(stage)) throw new Error(`Invalid stage: "${rec.stage}" (use ${LEAD_CSV_STAGES.join(", ")})`);
      let value: string | undefined;
      if (rec.value) {
        const minor = moneyOrThrow(rec.value, "value");
        if (minor < 0n) throw new Error("value cannot be negative");
        value = rec.value;
      }
      let nextFollowUpAt: string | undefined;
      if (rec.nextFollowUpAt) {
        const d = new Date(rec.nextFollowUpAt);
        if (Number.isNaN(d.getTime())) throw new Error(`Invalid next_follow_up_at: "${rec.nextFollowUpAt}" (use an ISO date, e.g. 2026-10-20)`);
        nextFollowUpAt = rec.nextFollowUpAt;
      }
      const tags = rec.tags ? rec.tags.split(/[|;]/).map((t) => t.trim()).filter(Boolean) : [];
      rows.push({
        rowNumber,
        name: rec.name,
        phone: rec.phone || undefined,
        email: rec.email || undefined,
        source,
        stage,
        tags,
        value,
        notes: rec.notes || undefined,
        nextFollowUpAt,
      });
    } catch (e) {
      errors.push({ row: rowNumber, message: e instanceof Error ? e.message : "Invalid row" });
    }
  });
  return { rows, errors, totalRows: parsed.data.length };
}

// ---------------- Milestone 65: orders CSV ----------------

export interface ParsedOrderRow {
  rowNumber: number;
  externalRef: string;
  customerPhone: string;
  customerName?: string;
  customerEmail?: string;
  status: string;
  currency: string;
  itemName: string;
  itemSku?: string;
  quantity: number;
  unitPriceMinor: bigint;
  shippingMinor: bigint;
  discountMinor: bigint;
  isCod: boolean;
  placedAt?: Date;
}
export interface OrderParseResult { rows: ParsedOrderRow[]; errors: CsvRowError[]; totalRows: number }

const ORDER_HEADER_ALIASES: Record<string, string> = {
  order_ref: "externalRef", ref: "externalRef", order_id: "externalRef", order_number: "externalRef",
  customer_phone: "phone", phone: "phone", mobile: "phone",
  customer_name: "name", name: "name",
  customer_email: "email", email: "email",
  status: "status", currency: "currency",
  item_name: "itemName", product: "itemName", product_name: "itemName", item: "itemName",
  item_sku: "itemSku", sku: "itemSku",
  quantity: "quantity", qty: "quantity",
  unit_price: "unitPrice", price: "unitPrice",
  shipping: "shipping", shipping_cost: "shipping", delivery_charge: "shipping",
  discount: "discount",
  is_cod: "isCod", cod: "isCod",
  placed_at: "placedAt", date: "placedAt", order_date: "placedAt",
};
const ORDER_STATUSES = ["pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed"];

/**
 * Expected CSV columns (case-insensitive):
 * order_ref (required), customer_phone (required), item_name
 * (required), unit_price (required), quantity, customer_name,
 * customer_email, status, currency, item_sku, shipping,
 * discount, is_cod, placed_at.
 * Money is in major units ("1200" or "1200.50") like the
 * products CSV. ONE ROW = ONE ORDER with ONE item line in v1:
 * upsert replaces an order's items wholesale, so multi-line
 * orders should be recorded manually or via store sync.
 * Sample file: docs/examples/orders-sample.csv
 */
export function parseOrdersCsv(csvText: string): OrderParseResult {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
  });
  const rows: ParsedOrderRow[] = [];
  const errors: CsvRowError[] = [];
  parsed.data.forEach((raw, idx) => {
    const rowNumber = idx + 1;
    const rec: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      const canonical = ORDER_HEADER_ALIASES[key];
      if (canonical) rec[canonical] = typeof value === "string" ? value.trim() : "";
    }
    try {
      if (!rec.externalRef) throw new Error("Missing required column: order_ref");
      if (!rec.phone) throw new Error("Missing required column: customer_phone");
      if (!rec.itemName) throw new Error("Missing required column: item_name");
      if (!rec.unitPrice) throw new Error("Missing required column: unit_price");
      const unitPriceMinor = moneyOrThrow(rec.unitPrice, "unit_price");
      if (unitPriceMinor < 0n) throw new Error("unit_price cannot be negative");
      let quantity = 1;
      if (rec.quantity) {
        const n = Number(rec.quantity);
        if (!Number.isInteger(n) || n < 1 || n > 999) throw new Error(`Invalid quantity: "${rec.quantity}"`);
        quantity = n;
      }
      const status = (rec.status || "processing").toLowerCase();
      if (!ORDER_STATUSES.includes(status)) throw new Error(`Invalid status: "${rec.status}" (use ${ORDER_STATUSES.join(", ")})`);
      let placedAt: Date | undefined;
      if (rec.placedAt) {
        const d = new Date(rec.placedAt);
        if (Number.isNaN(d.getTime())) throw new Error(`Invalid placed_at: "${rec.placedAt}"`);
        placedAt = d;
      }
      rows.push({
        rowNumber,
        externalRef: rec.externalRef,
        customerPhone: rec.phone,
        customerName: rec.name || undefined,
        customerEmail: rec.email || undefined,
        status,
        currency: (rec.currency || "BDT").toUpperCase(),
        itemName: rec.itemName,
        itemSku: rec.itemSku || undefined,
        quantity,
        unitPriceMinor,
        shippingMinor: rec.shipping ? moneyOrThrow(rec.shipping, "shipping") : 0n,
        discountMinor: rec.discount ? moneyOrThrow(rec.discount, "discount") : 0n,
        isCod: rec.isCod ? !/^(no|false|0)$/i.test(rec.isCod) : true,
        placedAt,
      });
    } catch (e) {
      errors.push({ row: rowNumber, message: e instanceof Error ? e.message : "Invalid row" });
    }
  });
  return { rows, errors, totalRows: parsed.data.length };
}
