/**
 * RFM segmentation from real orders (cancelled orders excluded).
 * Scores are quintiles (1-5) computed by rank within the org's own
 * customer base, so they are always relative to this business - never
 * invented thresholds presented as absolutes.
 */
export interface RfmRow {
  customerId: string;
  name: string;
  phone: string | null;
  email: string | null;
  recencyDays: number;
  frequency: number;
  monetaryMinor: string;
  r: number; f: number; m: number;
  segment: string;
}

export function segmentFor(r: number, f: number, m: number): string {
  if (r >= 4 && f >= 4 && m >= 4) return "champions";
  if (f >= 4 && m >= 3) return "loyal";
  if (m >= 5) return "big_spenders";
  if (r <= 2 && f >= 3) return "at_risk";
  if (r === 1 && f <= 2) return "lost";
  if (f === 1 && r >= 4) return "new";
  return "regular";
}

function quintile(sortedAsc: number[], value: number): number {
  if (!sortedAsc.length) return 3;
  const idx = sortedAsc.indexOf(value);
  const rank = idx === -1 ? sortedAsc.filter((v) => v < value).length : idx;
  return Math.min(5, Math.floor((rank / sortedAsc.length) * 5) + 1);
}

/**
 * Scale SC1: the aggregates are computed by the DATABASE.
 * Two groupBy partitions on placedAt nullability keep the
 * per-order `placedAt ?? createdAt` semantics EXACT (a
 * single max(createdAt) would overstate recency for
 * store-synced orders, whose createdAt is sync time):
 *   A: placedAt NOT NULL → count, sum, max(placedAt)
 *   B: placedAt NULL     → count, sum, max(createdAt)
 * Frequency/monetary add across partitions; last-order
 * time is the max of the two maxima. No customer cap, no
 * order cap, no N+1, no raw order rows in memory.
 */
export async function computeRfm(prisma: any, organizationId: string): Promise<RfmRow[]> {
  const baseWhere = { organizationId, status: { not: "cancelled" }, customerId: { not: null } };
  const [withPlaced, withoutPlaced] = await Promise.all([
    prisma.order.groupBy({
      by: ["customerId"], where: { ...baseWhere, placedAt: { not: null } },
      _count: { _all: true }, _sum: { totalMinor: true }, _max: { placedAt: true },
    }),
    prisma.order.groupBy({
      by: ["customerId"], where: { ...baseWhere, placedAt: null },
      _count: { _all: true }, _sum: { totalMinor: true }, _max: { createdAt: true },
    }),
  ]);
  interface Agg { frequency: number; monetary: bigint; last: number }
  const byCustomer = new Map<string, Agg>();
  const add = (customerId: string, count: number, sum: unknown, last: unknown) => {
    const cur = byCustomer.get(customerId) ?? { frequency: 0, monetary: 0n, last: 0 };
    cur.frequency += Number(count ?? 0);
    cur.monetary += BigInt((sum as bigint | number | string | null) ?? 0);
    const t = last ? new Date(last as any).getTime() : 0;
    if (t > cur.last) cur.last = t;
    byCustomer.set(customerId, cur);
  };
  for (const g of withPlaced ?? []) add(g.customerId, g._count?._all ?? 0, g._sum?.totalMinor, g._max?.placedAt);
  for (const g of withoutPlaced ?? []) add(g.customerId, g._count?._all ?? 0, g._sum?.totalMinor, g._max?.createdAt);
  if (!byCustomer.size) return [];

  // Display fields by id, chunked; merged customers drop
  // out here — exactly as the old customer-side filter did.
  const ids = [...byCustomer.keys()];
  const customersById = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = await prisma.customer.findMany({
      where: { organizationId, mergedIntoId: null, id: { in: ids.slice(i, i + 1000) } },
      select: { id: true, firstName: true, lastName: true, phone: true, email: true },
    });
    for (const c of chunk ?? []) customersById.set(c.id, c);
  }

  const rows: Omit<RfmRow, "r" | "f" | "m" | "segment">[] = [];
  const now = Date.now();
  for (const [customerId, agg] of byCustomer) {
    const c = customersById.get(customerId);
    if (!c) continue; // merged (or foreign) — excluded, as before
    rows.push({
      customerId,
      name: [c.firstName, c.lastName].filter(Boolean).join(" ") || "Customer",
      phone: c.phone ?? null, email: c.email ?? null,
      recencyDays: Math.max(0, Math.floor((now - agg.last) / 86400000)),
      frequency: agg.frequency,
      monetaryMinor: String(agg.monetary),
    });
  }
  if (!rows.length) return [];
  const recencies = rows.map((r) => r.recencyDays).sort((a, b) => a - b);
  const freqs = rows.map((r) => r.frequency).sort((a, b) => a - b);
  const mons = rows.map((r) => Number(r.monetaryMinor)).sort((a, b) => a - b);
  return rows.map((row) => {
    // Recency inverts: fewer days since last order = higher score.
    const r = 6 - quintile(recencies, row.recencyDays);
    const f = quintile(freqs, row.frequency);
    const m = quintile(mons, Number(row.monetaryMinor));
    return { ...row, r, f, m, segment: segmentFor(r, f, m) };
  }).sort((a, b) => Number(b.monetaryMinor) - Number(a.monetaryMinor));
}

export const RFM_SEGMENTS = ["champions", "loyal", "big_spenders", "at_risk", "lost", "new", "regular"] as const;
