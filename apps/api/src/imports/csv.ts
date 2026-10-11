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
