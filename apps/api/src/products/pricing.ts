// Margin math in integer minor units. Percentages are the only floats,
// and they are presentation values, never stored money.
export interface MarginResult {
  marginMinor: bigint | null;      // price - cost, null when cost unknown
  marginPercent: number | null;    // (margin / price) * 100, null when unknown or price is 0
  markupPercent: number | null;    // (margin / cost) * 100, null when unknown or cost is 0
}

export function computeMargin(priceMinor: bigint, costMinor: bigint | null | undefined): MarginResult {
  if (costMinor === null || costMinor === undefined) {
    return { marginMinor: null, marginPercent: null, markupPercent: null };
  }
  const marginMinor = priceMinor - costMinor;
  const marginPercent = priceMinor > 0n ? Number((marginMinor * 10000n) / priceMinor) / 100 : null;
  const markupPercent = costMinor > 0n ? Number((marginMinor * 10000n) / costMinor) / 100 : null;
  return { marginMinor, marginPercent, markupPercent };
}
