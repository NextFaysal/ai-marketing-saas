/**
 * EC4 — stock divergence helpers.
 *
 * A listing's stock is "diverged" when the channel's last known
 * stock differs from the canonical product stock AND there is no
 * push already queued/in-flight that would reconcile the two.
 * While an outbox row is pending/processing the difference is
 * expected (the push just hasn't landed yet), so it is NOT a
 * divergence worth flagging to the merchant.
 */
export function computeStockDiverged(
  listing: { channelStock?: number | null },
  productStock: number | null | undefined,
  hasPendingOutbox: boolean,
): boolean {
  return (
    listing?.channelStock != null &&
    productStock != null &&
    listing.channelStock !== productStock &&
    !hasPendingOutbox
  );
}

/**
 * Which of the given (storeId, productId) pairs currently have a
 * pending/processing product outbox row?
 *
 * Fake-friendly on purpose: a single findMany scoped by
 * organizationId + entityType + status-in, then the pair
 * membership test happens in JS (`entityId` on product outbox
 * rows IS the productId). Returns a Set of `${storeId}:${productId}`
 * keys for the pairs that are pending.
 */
export async function pendingOutboxKeys(
  prisma: any,
  organizationId: string,
  pairs: Array<{ storeId: string; productId: string }>,
): Promise<Set<string>> {
  const result = new Set<string>();
  if (!pairs?.length) return result;
  const wanted = new Set(pairs.map((p) => `${p.storeId}:${p.productId}`));
  const table = (prisma as any)?.syncOutbox;
  if (!table?.findMany) return result;
  let rows: any[] = [];
  try {
    rows = await table.findMany({
      where: {
        organizationId,
        entityType: "product",
        status: { in: ["pending", "processing"] },
      },
    });
  } catch {
    // Fall back to an org-only scan and filter in JS (some fakes
    // do not understand the `in` operator).
    try {
      rows = await table.findMany({ where: { organizationId } });
    } catch {
      return result;
    }
  }
  for (const row of rows ?? []) {
    if (row.entityType !== "product") continue;
    if (row.status !== "pending" && row.status !== "processing") continue;
    const key = `${row.storeId}:${row.entityId}`;
    if (wanted.has(key)) result.add(key);
  }
  return result;
}
