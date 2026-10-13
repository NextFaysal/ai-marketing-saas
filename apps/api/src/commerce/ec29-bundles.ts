/**
 * EC29 — pure bundle pricing helper. No DB, no IO. Money is
 * BigInt minor units everywhere.
 *
 * A bundle sells a SET of components for one bundlePriceMinor.
 * For order lines / evaluator input each component needs an
 * allocated unit price. Allocation is proportional to the
 * components' regular line totals (R_i = regularUnit × qty):
 * every component except the LAST gets
 *   A_i = floor(bundlePrice × R_i / R)
 * and the last component absorbs the remainder
 *   A_last = bundlePrice − Σ A_others
 * so the identity Σ allocatedTotalMinor === bundlePriceMinor
 * holds EXACTLY (for bundlePrice ≥ 0 and ≥ 1 component) — no
 * poisha is ever created or lost. When every regular price is
 * 0 (R === 0) the quantities themselves are the weights.
 *
 * allocatedUnitMinor = A_i / qty_i (BigInt floor). Note: the
 * evaluator's discount bases use allocatedUnit × qty, which can
 * sit a few poisha UNDER the allocated total on floored lines;
 * the order's merchandise subtotal always uses the exact
 * allocated totals (allocatedTotal × bundle quantity), never
 * the floored unit reconstruction.
 */

export interface BundleItemInput {
  productId: string;
  variantSku?: string | null;
  qty: number;
}

export function allocateBundle(
  bundlePriceMinor: bigint,
  comps: Array<{ qty: number; regularUnitMinor: bigint }>,
): Array<{ allocatedUnitMinor: bigint; allocatedTotalMinor: bigint }> {
  const n = comps.length;
  if (n === 0) return [];
  const regularTotals = comps.map((c) => c.regularUnitMinor * BigInt(Math.max(0, c.qty)));
  const regularSum = regularTotals.reduce((s, x) => s + x, 0n);
  const weights =
    regularSum === 0n ? comps.map((c) => BigInt(Math.max(0, c.qty))) : regularTotals;
  const weightSum = weights.reduce((s, x) => s + x, 0n);

  const totals: bigint[] = new Array(n).fill(0n);
  let allocated = 0n;
  for (let i = 0; i < n - 1; i++) {
    const a = weightSum > 0n ? (bundlePriceMinor * weights[i]) / weightSum : 0n;
    totals[i] = a;
    allocated += a;
  }
  // Last component absorbs the remainder — the exactness identity.
  totals[n - 1] = bundlePriceMinor - allocated;

  return comps.map((c, i) => {
    const qty = Math.max(0, c.qty);
    return {
      allocatedUnitMinor: qty > 0 ? totals[i] / BigInt(qty) : 0n,
      allocatedTotalMinor: totals[i],
    };
  });
}
