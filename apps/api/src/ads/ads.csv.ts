import Papa from "papaparse";
import { parseMoneyToMinor } from "@repo/contracts";

export interface ParsedAdRow {
  rowNumber: number;
  date: string; // YYYY-MM-DD
  campaignExternalId: string;
  campaignName?: string;
  spendMinor: bigint;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValueMinor: bigint;
  currency: string;
}
export interface AdCsvResult { rows: ParsedAdRow[]; errors: { row: number; message: string }[]; totalRows: number }

const ALIASES: Record<string, string> = {
  date: "date", day: "date",
  campaign_id: "campaignId", campaignid: "campaignId",
  campaign: "campaignName", campaign_name: "campaignName",
  spend: "spend", amount_spent: "spend", cost: "spend",
  impressions: "impressions", clicks: "clicks",
  conversions: "conversions", purchases: "conversions", results: "conversions",
  conversion_value: "conversionValue", purchase_value: "conversionValue", value: "conversionValue",
  currency: "currency",
};

function intOrZero(v: string | undefined, field: string): number {
  if (!v) return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid ${field}: "${v}"`);
  return n;
}
function moneyOrZero(v: string | undefined, field: string): bigint {
  if (!v) return 0n;
  try { return parseMoneyToMinor(v); } catch { throw new Error(`Invalid ${field}: "${v}"`); }
}

/**
 * Expected columns (case-insensitive): date (required, YYYY-MM-DD),
 * spend (required), campaign_id, campaign_name, impressions, clicks,
 * conversions, conversion_value, currency.
 * This matches the shape of a Meta Ads Manager export closely enough that
 * a downloaded report usually imports without editing.
 */
export function parseAdSpendCsv(csvText: string, defaultCurrency = "BDT"): AdCsvResult {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true, skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
  });
  const rows: ParsedAdRow[] = [];
  const errors: { row: number; message: string }[] = [];
  parsed.data.forEach((raw, idx) => {
    const rowNumber = idx + 1;
    const rec: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      const canonical = ALIASES[k];
      if (canonical) rec[canonical] = typeof v === "string" ? v.trim() : "";
    }
    try {
      if (!rec.date || !/^\d{4}-\d{2}-\d{2}$/.test(rec.date)) throw new Error('Missing or invalid date (expected YYYY-MM-DD)');
      if (!rec.spend) throw new Error("Missing required column: spend");
      const spendMinor = moneyOrZero(rec.spend, "spend");
      if (spendMinor < 0n) throw new Error("Spend cannot be negative");
      rows.push({
        rowNumber,
        date: rec.date,
        campaignExternalId: rec.campaignId || "",
        campaignName: rec.campaignName || undefined,
        spendMinor,
        impressions: intOrZero(rec.impressions, "impressions"),
        clicks: intOrZero(rec.clicks, "clicks"),
        conversions: intOrZero(rec.conversions, "conversions"),
        conversionValueMinor: moneyOrZero(rec.conversionValue, "conversion_value"),
        currency: (rec.currency || defaultCurrency).toUpperCase(),
      });
    } catch (e) {
      errors.push({ row: rowNumber, message: e instanceof Error ? e.message : "Invalid row" });
    }
  });
  return { rows, errors, totalRows: parsed.data.length };
}
