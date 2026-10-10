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
