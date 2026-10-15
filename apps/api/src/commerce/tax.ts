/**
 * EC23 — pure VAT math. No DB, no IO. Money is BigInt minor units;
 * rates are BASIS POINTS (1500 = 15.00%, 750 = 7.5%) because BD VAT
 * has fractional rates a whole-percent Int cannot express.
 *
 * ROUNDING RULE (chosen + specced in ec23-tax.spec.ts):
 * round-HALF-UP per line, computed in BigInt as
 *   floor((2·num + den) / (2·den))  ==  floor(num/den + 0.5)
 * for the non-negative amounts checkout produces. Per-line taxes
 * are rounded first, THEN summed and grouped per rate — the
 * breakdown's taxMinor is exactly the sum of its lines' taxes, so
 * breakdown rows always add up to the order's taxMinor.
 */

export interface TaxLineInput {
  productId: string | null;
  /** Post-discount merchandise amount for this line (minor units). */
  baseMinor: bigint;
}

export interface TaxBreakdownEntry {
  rateBps: number;
  taxableMinor: bigint;
  taxMinor: bigint;
}

export interface TaxComputation {
  /** Total VAT: the contained portion (inclusive) or the added
   * amount (exclusive). */
  taxMinor: bigint;
  /** Amount the order total GROWS by: 0 in inclusive mode (the tax
   * is already inside the prices), taxMinor in exclusive mode. */
  taxAddedMinor: bigint;
  breakdown: TaxBreakdownEntry[];
}

function roundHalfUpDiv(num: bigint, den: bigint): bigint {
  if (num <= 0n || den <= 0n) return 0n;
  return (2n * num + den) / (2n * den);
}

/**
 * Compute VAT for post-discount line bases.
 * `rateFor(productId)` returns the effective bps for a line, or
 * null for an untaxed line. The bump pseudo-line passes
 * productId null — the caller resolves it to the org default rate.
 */
export function computeTax(
  lines: TaxLineInput[],
  rateFor: (productId: string | null) => number | null,
  pricesIncludeVat: boolean,
): TaxComputation {
  const byRate = new Map<number, TaxBreakdownEntry>();
  let taxMinor = 0n;
  for (const line of lines) {
    const base = line.baseMinor > 0n ? line.baseMinor : 0n;
    if (base === 0n) continue;
    const bps = rateFor(line.productId);
    if (bps == null || !Number.isInteger(bps) || bps <= 0) continue;
    const rate = BigInt(bps);
    // Inclusive: the base already contains VAT, so the contained
    // portion is base · bps / (10000 + bps).
    // Exclusive: VAT is charged on top: base · bps / 10000.
    const lineTax = pricesIncludeVat
      ? roundHalfUpDiv(base * rate, 10000n + rate)
      : roundHalfUpDiv(base * rate, 10000n);
    taxMinor += lineTax;
    const entry = byRate.get(bps) ?? { rateBps: bps, taxableMinor: 0n, taxMinor: 0n };
    entry.taxableMinor += base;
    entry.taxMinor += lineTax;
    byRate.set(bps, entry);
  }
  const breakdown = [...byRate.values()].sort((a, b) => a.rateBps - b.rateBps);
  return {
    taxMinor,
    taxAddedMinor: pricesIncludeVat ? 0n : taxMinor,
    breakdown,
  };
}

/** Serialize a breakdown for Order.taxBreakdown (amounts as strings). */
export function serializeTaxBreakdown(
  breakdown: TaxBreakdownEntry[],
): Array<{ rateBps: number; taxableMinor: string; taxMinor: string }> {
  return breakdown.map((b) => ({
    rateBps: b.rateBps,
    taxableMinor: b.taxableMinor.toString(),
    taxMinor: b.taxMinor.toString(),
  }));
}
