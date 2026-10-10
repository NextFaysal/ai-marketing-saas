// Presentation ratios: numbers are fine, money itself stays BigInt.
// Every ratio returns null when its denominator is 0 - never Infinity or a
// fabricated 0 that looks like a real result.

export function ratio2(numerator: bigint, denominator: bigint): number | null {
  if (denominator === 0n) return null;
  // Ratio with 2 decimal places: scale by 100, integer-divide, scale back.
  return Number((numerator * 100n) / denominator) / 100;
}
export function percent2(part: bigint, whole: bigint): number | null {
  if (whole === 0n) return null;
  return Number((part * 10000n) / whole) / 100;
}

export interface AdKpiInput {
  spendMinor: bigint;
  impressions: number;
  clicks: number;
  platformConversions: number;
  platformConversionValueMinor: bigint;
  revenueMinor: bigint; // first-party order revenue in the same period
}

export interface AdKpis {
  ctrPercent: number | null;   // clicks / impressions
  cpcMinor: number | null;     // spend / clicks (minor units, can be fractional)
  cpmMinor: number | null;     // spend per 1000 impressions
  cpaMinor: number | null;     // spend / platform conversions
  platformRoas: number | null; // platform-reported conversion value / spend
  mer: number | null;          // total revenue / total ad spend (blended)
  costPerOrder: null;          // computed by caller with order counts
}

export function computeAdKpis(i: AdKpiInput): AdKpis {
  return {
    ctrPercent: i.impressions > 0 ? Math.round((i.clicks / i.impressions) * 10000) / 100 : null,
    cpcMinor: i.clicks > 0 ? Math.round((Number(i.spendMinor) / i.clicks) * 100) / 100 : null,
    cpmMinor: i.impressions > 0 ? Math.round((Number(i.spendMinor) / i.impressions) * 1000 * 100) / 100 : null,
    cpaMinor: i.platformConversions > 0 ? Math.round((Number(i.spendMinor) / i.platformConversions) * 100) / 100 : null,
    platformRoas: ratio2(i.platformConversionValueMinor, i.spendMinor),
    mer: ratio2(i.revenueMinor, i.spendMinor),
    costPerOrder: null,
  };
}

/** Pick the cost in effect on a date: latest effectiveFrom <= date, else the earliest known cost. */
export function chooseCostForDate(
  costs: { costMinor: bigint; effectiveFrom: Date }[], date: Date,
): bigint | null {
  if (costs.length === 0) return null;
  const sorted = [...costs].sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
  let chosen: bigint | null = null;
  for (const c of sorted) {
    if (c.effectiveFrom.getTime() <= date.getTime()) chosen = c.costMinor;
    else break;
  }
  return chosen ?? sorted[0].costMinor;
}

export interface ContributionInput { revenueMinor: bigint; refundedMinor: bigint; cogsMinor: bigint; adSpendMinor: bigint }
export function contributionProfit(i: ContributionInput): { profitMinor: bigint; marginPercent: number | null } {
  const profitMinor = i.revenueMinor - i.refundedMinor - i.cogsMinor - i.adSpendMinor;
  return { profitMinor, marginPercent: percent2(profitMinor, i.revenueMinor) };
}
