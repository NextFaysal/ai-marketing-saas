/**
 * NF9 (FB4) — the ONE customer-visibility rule for a rider's
 * live location, shared by the CX6 public tracking payload
 * (CourierService.publicTracking), the EC18 shop tracking
 * payload (StorefrontService.trackOrder) and RiderGpsService.
 * Pure Prisma-shaped reads only (no Nest service imports), so
 * neither caller grows a module cycle; every read is
 * failure-isolated — a missing NF9 table reads as "no location",
 * never as an error and never as an invented position.
 *
 * A rider location is customer-visible ONLY when ALL hold:
 *  1. the order is out for delivery (see isOutForDelivery), AND
 *  2. the rider has an ACTIVE (assigned | picked_up)
 *     DeliveryAssignment for THIS order in THIS org, AND
 *  3. the rider's share link is currently sharing (exists, not
 *     revoked, not expired, sharingEnabled), AND
 *  4. a latest fix exists FOR THAT assignment.
 * Otherwise the payload carries riderLocation: null and the
 * pages render nothing — no placeholder, no last-known guess.
 */

export const NF9_STALE_THRESHOLD_MS = 5 * 60 * 1000;
export const NF9_ACTIVE_ASSIGNMENT_STATUSES = ["assigned", "picked_up"] as const;

/** Courier/order status normalisation — the courier-status lib
 * rule: case-insensitive, spaces/hyphens become underscores. */
export function normalizeDeliveryStatus(status: unknown): string {
  return String(status ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function isOutForDeliveryStatus(status: unknown): boolean {
  return normalizeDeliveryStatus(status) === "out_for_delivery";
}

/**
 * Own-rider (EC22) out-for-delivery equivalence: an external
 * courier reports "out_for_delivery" as a shipment status; the
 * org's OWN rider reports the same physical fact as a
 * DeliveryAssignment in "picked_up" (parcel in hand, en route).
 * "assigned" alone is NOT out for delivery — the rider has not
 * picked the parcel up yet.
 */
export function isOutForDelivery(input: {
  orderStatus?: unknown;
  shipmentStatus?: unknown;
  assignmentStatus?: unknown;
}): boolean {
  return (
    isOutForDeliveryStatus(input.orderStatus) ||
    isOutForDeliveryStatus(input.shipmentStatus) ||
    normalizeDeliveryStatus(input.assignmentStatus) === "picked_up"
  );
}

export function isStaleFix(recordedAt: unknown, now: Date = new Date()): boolean {
  const t = recordedAt instanceof Date ? recordedAt.getTime() : new Date(recordedAt as any).getTime();
  if (Number.isNaN(t)) return true;
  return now.getTime() - t > NF9_STALE_THRESHOLD_MS;
}

export function fixAgeMs(recordedAt: unknown, now: Date = new Date()): number | null {
  const t = recordedAt instanceof Date ? recordedAt.getTime() : new Date(recordedAt as any).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, now.getTime() - t);
}

/** External map link from raw coordinates — no map vendor is
 * bundled (web package.json carries none); the link is built
 * from the stored fix only. */
export function mapsUrlFor(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`;
}

export function serializeRiderFix(latest: any, riderName: string | null, now: Date = new Date()) {
  const recordedAt = latest.recordedAt instanceof Date ? latest.recordedAt : new Date(latest.recordedAt);
  return {
    riderName: riderName ?? null,
    lat: Number(latest.lat),
    lng: Number(latest.lng),
    accuracy: latest.accuracy != null ? Number(latest.accuracy) : null,
    recordedAt: recordedAt.toISOString(),
    ageMs: fixAgeMs(recordedAt, now),
    stale: isStaleFix(recordedAt, now),
    mapsUrl: mapsUrlFor(Number(latest.lat), Number(latest.lng)),
  };
}

/** A share link counts as sharing only when it exists, is not
 * revoked, is not expired and the rider's switch is ON. */
export function shareLinkIsSharing(link: any, now: Date = new Date()): boolean {
  if (!link) return false;
  if (link.revokedAt) return false;
  if (link.sharingEnabled === false) return false;
  if (link.expiresAt && new Date(link.expiresAt).getTime() <= now.getTime()) return false;
  return true;
}

export async function customerRiderLocation(
  prisma: any,
  organizationId: string,
  orderId: string,
  gates: { orderStatus?: unknown; shipmentStatus?: unknown },
  now: Date = new Date(),
): Promise<ReturnType<typeof serializeRiderFix> | null> {
  try {
    const assignmentTable = prisma?.deliveryAssignment;
    if (!assignmentTable?.findFirst) return null;
    const assignment = await assignmentTable
      .findFirst({
        where: {
          organizationId,
          orderId,
          status: { in: [...NF9_ACTIVE_ASSIGNMENT_STATUSES] },
        },
      })
      .catch(() => null);
    if (!assignment) return null;
    if (!isOutForDelivery({ ...gates, assignmentStatus: assignment.status })) return null;

    const linkTable = prisma?.riderShareLink;
    if (!linkTable?.findFirst) return null;
    const link = await linkTable
      .findFirst({ where: { organizationId, riderId: assignment.riderId } })
      .catch(() => null);
    if (!shareLinkIsSharing(link, now)) return null;

    const latestTable = prisma?.riderLocationLatest;
    if (!latestTable?.findFirst) return null;
    const latest = await latestTable
      .findFirst({ where: { organizationId, riderId: assignment.riderId } })
      .catch(() => null);
    if (!latest || latest.deliveryAssignmentId !== assignment.id) return null;

    let riderName: string | null = null;
    try {
      const rider = await prisma?.rider
        ?.findFirst({ where: { id: assignment.riderId, organizationId } })
        .catch(() => null);
      riderName = rider?.name ?? null;
    } catch { riderName = null; }

    return serializeRiderFix(latest, riderName, now);
  } catch {
    return null;
  }
}
