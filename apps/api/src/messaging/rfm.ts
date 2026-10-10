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

export async function computeRfm(prisma: any, organizationId: string): Promise<RfmRow[]> {
  const customers = await prisma.customer.findMany({ where: { organizationId, mergedIntoId: null }, take: 2000 });
  const rows: Omit<RfmRow, "r" | "f" | "m" | "segment">[] = [];
  const now = Date.now();
  for (const c of customers) {
    const orders = await prisma.order.findMany({
      where: { organizationId, customerId: c.id, status: { not: "cancelled" } }, take: 1000,
    });
    if (!orders.length) continue;
    const last = Math.max(...orders.map((o: any) => new Date(o.placedAt ?? o.createdAt).getTime()));
    rows.push({
      customerId: c.id,
      name: [c.firstName, c.lastName].filter(Boolean).join(" ") || "Customer",
      phone: c.phone ?? null, email: c.email ?? null,
      recencyDays: Math.max(0, Math.floor((now - last) / 86400000)),
      frequency: orders.length,
      monetaryMinor: String(orders.reduce((s: bigint, o: any) => s + BigInt(o.totalMinor), 0n)),
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
