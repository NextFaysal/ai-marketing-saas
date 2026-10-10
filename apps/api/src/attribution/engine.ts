export type AttributionModelName = "FIRST_TOUCH" | "LAST_TOUCH" | "LAST_NON_DIRECT" | "LINEAR";

export interface EngineTouchpoint {
  id: string;
  occurredAt: Date;
  isDirect: boolean;
  source: string;
}

export interface CreditAllocation {
  touchpointId: string | null; // null = unattributed
  revenueMinor: bigint;
}

export const DEFAULT_ATTRIBUTION_WINDOW_DAYS = 30;

/** Keep only touchpoints at or before the conversion, inside the window. Sorted oldest first. */
export function filterTouchpointsInWindow(
  touchpoints: EngineTouchpoint[], conversionAt: Date, windowDays = DEFAULT_ATTRIBUTION_WINDOW_DAYS,
): EngineTouchpoint[] {
  const start = conversionAt.getTime() - windowDays * 24 * 60 * 60 * 1000;
  return touchpoints
    .filter((t) => t.occurredAt.getTime() >= start && t.occurredAt.getTime() <= conversionAt.getTime())
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}

/**
 * Allocate an order's revenue to touchpoints under a model.
 * Rules that keep reports honest:
 * - No touchpoints in window -> a single unattributed allocation (touchpointId null).
 * - LAST_NON_DIRECT with only direct touchpoints -> unattributed.
 * - LINEAR splits integer minor units exactly: allocations always sum to
 *   the order revenue (remainder goes to the earliest touchpoints).
 */
export function computeCredits(
  touchpoints: EngineTouchpoint[], revenueMinor: bigint, model: AttributionModelName,
): CreditAllocation[] {
  if (touchpoints.length === 0) return [{ touchpointId: null, revenueMinor }];
  switch (model) {
    case "FIRST_TOUCH":
      return [{ touchpointId: touchpoints[0].id, revenueMinor }];
    case "LAST_TOUCH":
      return [{ touchpointId: touchpoints[touchpoints.length - 1].id, revenueMinor }];
    case "LAST_NON_DIRECT": {
      const nonDirect = [...touchpoints].reverse().find((t) => !t.isDirect);
      return [{ touchpointId: nonDirect?.id ?? null, revenueMinor }];
    }
    case "LINEAR": {
      const n = BigInt(touchpoints.length);
      const base = revenueMinor / n;
      let remainder = revenueMinor - base * n;
      return touchpoints.map((t) => {
        const extra = remainder > 0n ? 1n : 0n;
        if (remainder > 0n) remainder -= 1n;
        return { touchpointId: t.id, revenueMinor: base + extra };
      });
    }
  }
}

/** Classify a session's attribution data into touchpoint fields. */
export function classifyTouchpoint(input: {
  utmSource?: string | null; utmMedium?: string | null; utmCampaign?: string | null;
  utmContent?: string | null; utmTerm?: string | null;
  fbclid?: string | null; gclid?: string | null; ttclid?: string | null;
  referrer?: string | null;
}): { source: string; clickIdType: string | null; clickId: string | null; isDirect: boolean } {
  let clickIdType: string | null = null;
  let clickId: string | null = null;
  if (input.fbclid) { clickIdType = "fbclid"; clickId = input.fbclid; }
  else if (input.gclid) { clickIdType = "gclid"; clickId = input.gclid; }
  else if (input.ttclid) { clickIdType = "ttclid"; clickId = input.ttclid; }

  let source = input.utmSource?.trim().toLowerCase() || null;
  if (!source && clickIdType === "fbclid") source = "facebook";
  if (!source && clickIdType === "gclid") source = "google";
  if (!source && clickIdType === "ttclid") source = "tiktok";
  const isDirect = !source;
  return { source: source ?? "direct", clickIdType, clickId, isDirect };
}
