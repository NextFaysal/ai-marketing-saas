/**
 * ON6 — Fulfillment SLA: PURE helper (no Nest / Prisma imports,
 * so OrdersService may import it for the sla_breach queue without
 * any module cycle).
 *
 * Stage machine for one order:
 * - terminal/cancelled order statuses (cancelled, refunded,
 *   failed, returned) and delivered/completed orders are done:
 *   stage "shipped" when a shipment exists, else
 *   "not_applicable"; never breached.
 * - otherwise, with NO packed-or-later fulfilment:
 *   "awaiting_pack" since the order was placed
 *   (placedAt ?? createdAt), breached once the age exceeds the
 *   setting's confirmToPackHours.
 * - with a packed fulfilment but NO shipment: "awaiting_handover"
 *   since the packed fulfilment's updatedAt, breached once the
 *   age exceeds packToHandoverHours.
 * - with a shipment: "shipped", never breached.
 *
 * Packed-time approximation (documented, package-wide): the
 * Fulfillment model has NO packedAt column, so the packed time
 * is the updatedAt of the EARLIEST packed-or-later fulfilment
 * (the moment it first reached a packed-or-later status is the
 * closest stored witness).
 *
 * Held orders (reviewHold = true) still compute exactly the
 * same — the SLA clock keeps running during a hold in v1 (the
 * hold is a staff fraud decision, not a customer-facing pause of
 * the fulfilment promise).
 */

export interface SlaSettingLike {
  confirmToPackHours?: number | null;
  packToHandoverHours?: number | null;
  stuckDays?: number | null;
}

export interface SlaStageResult {
  stage: "awaiting_pack" | "awaiting_handover" | "shipped" | "not_applicable";
  stageSince: Date | null;
  ageHours: number | null;
  breached: boolean;
}

export const SLA_DEFAULTS = { confirmToPackHours: 24, packToHandoverHours: 24, stuckDays: 5 } as const;

const DONE_STATUSES = ["cancelled", "refunded", "failed", "returned", "delivered", "completed"];
const PACKED_OR_LATER = ["packed", "handed_over", "in_transit", "delivered"];

function toTime(v: any): number | null {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

function positiveOr(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function computeSlaStage(
  order: any,
  fulfillments: any[],
  shipments: any[],
  setting: SlaSettingLike | null | undefined,
  now: Date = new Date(),
): SlaStageResult {
  const confirmToPackHours = positiveOr(setting?.confirmToPackHours, SLA_DEFAULTS.confirmToPackHours);
  const packToHandoverHours = positiveOr(setting?.packToHandoverHours, SLA_DEFAULTS.packToHandoverHours);
  const hasShipment = (shipments ?? []).length > 0;
  const status = String(order?.status ?? "");

  if (DONE_STATUSES.includes(status)) {
    return { stage: hasShipment ? "shipped" : "not_applicable", stageSince: null, ageHours: null, breached: false };
  }

  // Earliest packed-or-later fulfilment, by its updatedAt
  // (packed-time approximation — see the header note).
  let packed: any = null;
  let packedTime: number | null = null;
  for (const f of fulfillments ?? []) {
    if (!PACKED_OR_LATER.includes(String(f?.status ?? ""))) continue;
    const t = toTime(f?.updatedAt) ?? toTime(f?.createdAt);
    if (t === null) continue;
    if (packedTime === null || t < packedTime) { packed = f; packedTime = t; }
  }

  if (!packed) {
    const sinceTime = toTime(order?.placedAt) ?? toTime(order?.createdAt);
    if (sinceTime === null) {
      return { stage: "awaiting_pack", stageSince: null, ageHours: null, breached: false };
    }
    const ageHours = (now.getTime() - sinceTime) / 3600_000;
    return {
      stage: "awaiting_pack",
      stageSince: new Date(sinceTime),
      ageHours,
      breached: ageHours > confirmToPackHours,
    };
  }

  if (!hasShipment) {
    const ageHours = packedTime === null ? null : (now.getTime() - packedTime) / 3600_000;
    return {
      stage: "awaiting_handover",
      stageSince: packedTime === null ? null : new Date(packedTime),
      ageHours,
      breached: ageHours !== null && ageHours > packToHandoverHours,
    };
  }

  return { stage: "shipped", stageSince: null, ageHours: null, breached: false };
}
