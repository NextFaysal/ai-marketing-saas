/**
 * DX3 (§5): ONE money/number format for the campaign surfaces —
 * ৳ + bn-BD grouping (e.g. ৳১,২৫০.৫০). The shared
 * contracts `formatMinor` renders "BDT 1250.50" (no grouping,
 * Latin digits) and is spec-pinned app-wide, so the campaign
 * pages use this local renderer for values THEY format.
 * Strings that arrive pre-formatted from the API are never
 * re-parsed or rewritten here.
 */

/** Minor units (string | bigint | number) → "৳১,২৫০.৫০". */
export function fmtMoneyBn(minor: string | bigint | number | null | undefined): string {
  if (minor === null || minor === undefined || minor === "") return "—";
  let v: number;
  try {
    v = Number(typeof minor === "bigint" ? minor : BigInt(String(minor).trim()));
  } catch {
    v = Number(minor);
  }
  if (!Number.isFinite(v)) return "—";
  return `৳${(v / 100).toLocaleString("bn-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Plain count → bn-BD grouped digits (e.g. ১,২৫০). */
export function fmtNumBn(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("bn-BD");
}
