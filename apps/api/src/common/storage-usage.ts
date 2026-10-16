/**
 * GC21 (GB9): recorded storage usage for one organization.
 *
 * The ONLY metered source is the MediaAsset registry: the sum of
 * `sizeBytes` over the org's recorded uploads. Bandwidth is NOT
 * metered anywhere in this platform and is never estimated — the
 * `meteredFrom` note says exactly what the figure covers, and the
 * UI copy must repeat it ("মিডিয়া লাইব্রেরিতে রেকর্ডকৃত আপলোড
 * থেকে হিসাব"). Shared by the tenant endpoint and the admin org
 * detail so both surfaces quote the same number.
 */
export const STORAGE_METERED_FROM = "মিডিয়া লাইব্রেরিতে রেকর্ডকৃত আপলোড থেকে হিসাব";

export interface StorageUsage {
  /** Sum of MediaAsset.sizeBytes, as a decimal string (BigInt-safe). */
  storageBytes: string;
  assetCount: number;
  meteredFrom: string;
}

/**
 * Aggregate read. Any failure (table missing on a partially
 * migrated database, test fake without aggregate) reads as zero —
 * a usage figure must never break the org detail payload it rides
 * on. `sizeBytes` is Int per row; the sum is funnelled through
 * BigInt so large libraries never lose precision in JSON.
 */
export async function storageUsageForOrg(prisma: any, organizationId: string): Promise<StorageUsage> {
  try {
    const agg = await prisma.mediaAsset?.aggregate?.({
      where: { organizationId },
      _sum: { sizeBytes: true },
      _count: { _all: true },
    });
    const sum = agg?._sum?.sizeBytes;
    const bytes = sum == null ? 0n : BigInt(Math.trunc(Number(sum)));
    const count = typeof agg?._count === "number" ? agg._count : Number(agg?._count?._all ?? 0);
    return { storageBytes: bytes.toString(), assetCount: Number.isFinite(count) ? count : 0, meteredFrom: STORAGE_METERED_FROM };
  } catch {
    return { storageBytes: "0", assetCount: 0, meteredFrom: STORAGE_METERED_FROM };
  }
}
