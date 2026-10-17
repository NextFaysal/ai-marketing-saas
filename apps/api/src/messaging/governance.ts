import { groupFailureReasons } from "./delivery-report";

/**
 * MX15 — pure governance helpers: delivery-health aggregation,
 * the WhatsApp hard-failure classifier for auto-suppression, and
 * the budget decision. All figures come from REAL MessageDelivery
 * rows handed in by the service; a stage no channel can report
 * stays null, never 0. No Prisma, no I/O — spec-pinned.
 */

export interface HealthDelivery {
  channel: string;
  status: string; // sent | failed | skipped
  deliveryStatus?: string | null;
  deliveredAt?: unknown;
  readAt?: unknown;
  error?: string | null;
}

export interface ChannelHealth {
  channel: string;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  /** failed / (sent + failed); null when nothing was attempted. */
  failureRate: number | null;
  /** WhatsApp + onsite only (real webhook / in-system signals);
   * null on every other channel — never 0. */
  deliveredRate: number | null;
  readRate: number | null;
  /** No bounce signal exists anywhere in this system (no email
   * bounce webhook, no SMS DLR, WhatsApp failed is deliveryStatus
   * "failed", not a bounce field) — always null, with the note. */
  bounceRate: null;
  /** No complaint/feedback signal exists anywhere — always null. */
  complaintRate: null;
  failureReasons: { reason: string; count: number }[];
}

const RATE = (num: number, den: number): number | null =>
  den > 0 ? Math.round((num / den) * 10000) / 10000 : null;

export function aggregateChannelHealth(deliveries: HealthDelivery[]): ChannelHealth[] {
  const byChannel = new Map<string, HealthDelivery[]>();
  for (const d of deliveries) {
    const list = byChannel.get(d.channel) ?? [];
    list.push(d);
    byChannel.set(d.channel, list);
  }
  const out: ChannelHealth[] = [];
  for (const [channel, rows] of [...byChannel.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sent = rows.filter((r) => r.status === "sent").length;
    const failed = rows.filter((r) => r.status === "failed").length;
    const skipped = rows.filter((r) => r.status === "skipped").length;
    const lifecycleCapable = channel === "whatsapp" || channel === "onsite";
    const delivered = lifecycleCapable
      ? rows.filter((r) => r.status === "sent" && (r.deliveryStatus === "delivered" || r.deliveryStatus === "read" || r.deliveredAt)).length
      : 0;
    const read = lifecycleCapable
      ? rows.filter((r) => r.status === "sent" && (r.deliveryStatus === "read" || r.readAt)).length
      : 0;
    out.push({
      channel,
      total: rows.length,
      sent, failed, skipped,
      failureRate: RATE(failed, sent + failed),
      deliveredRate: lifecycleCapable ? RATE(delivered, sent) : null,
      readRate: lifecycleCapable ? RATE(read, sent) : null,
      bounceRate: null,
      complaintRate: null,
      failureReasons: groupFailureReasons(rows.filter((r) => r.status === "failed").map((r) => r.error ?? null)),
    });
  }
  return out;
}

export const BOUNCE_COMPLAINT_NOTE =
  "Bounce/complaint rates are null: this system has no email bounce or spam-complaint webhook and no SMS DLR — no record carries a bounce/complaint signal, so no rate is invented. WhatsApp post-send failures appear as deliveryStatus \"failed\" and in the failure rate / reasons.";

/**
 * MX15 auto-suppression classifier for the ONE existing webhook
 * path (WhatsApp delivery-status "failed" via
 * applyWhatsAppDeliveryStatus). Only errors that identify the
 * RECIPIENT as unreachable / not on WhatsApp / blocked count as
 * hard failures; template, quality, rate-limit and auth failures
 * say nothing about the recipient and NEVER suppress anyone.
 * Patterns are Meta's documented error codes/titles for
 * recipient-side failures (131026 undeliverable, 131030 recipient
 * not in allowed list, 131047 re-engagement, 131051 unsupported
 * type for this recipient) plus unambiguous title fragments.
 */
export const HARD_FAILURE_PATTERNS = [
  "131026", "131030", "131047", "131051",
  "message undeliverable",
  "recipient not in allowed list",
  "recipient is not a valid whatsapp",
  "not on whatsapp",
  "invalid phone number",
  "invalid whatsapp",
  "chat not found",
  "recipient blocked",
] as const;

export function isHardRecipientFailure(error: unknown): boolean {
  const s = String(error ?? "").toLowerCase();
  if (!s) return false;
  return HARD_FAILURE_PATTERNS.some((p) => s.includes(p));
}

/** MX15 budget decision — pure. Caps and the estimate are minor
 * units from org-entered rates only. A missing estimate NEVER
 * blocks (the cannot-estimate default, recorded in the MX15
 * acceptance doc): it allows with a visible warning. */
export interface BudgetDecision {
  decision: "allow" | "allow_with_warning" | "block";
  estimateMinor: number | null;
  basis: string | null;
  perBroadcastCapMinor: number | null;
  monthlyCapMinor: number | null;
  monthlySpentMinor: number | null;
  monthlyEstimateComplete: boolean;
  warning: string | null;
  blockReason: string | null;
}

export function decideBudget(input: {
  estimateMinor: number | null;
  basis: string | null;
  perBroadcastCapMinor: number | null;
  monthlyCapMinor: number | null;
  monthlySpentMinor: number | null;
  monthlyEstimateComplete: boolean;
}): BudgetDecision {
  const base: BudgetDecision = {
    decision: "allow",
    estimateMinor: input.estimateMinor,
    basis: input.basis,
    perBroadcastCapMinor: input.perBroadcastCapMinor,
    monthlyCapMinor: input.monthlyCapMinor,
    monthlySpentMinor: input.monthlySpentMinor,
    monthlyEstimateComplete: input.monthlyEstimateComplete,
    warning: null,
    blockReason: null,
  };
  if (input.perBroadcastCapMinor === null && input.monthlyCapMinor === null) return base;
  if (input.estimateMinor === null) {
    return {
      ...base, decision: "allow_with_warning",
      warning: "Cost cannot be estimated (no org-entered rate for this channel), so the budget cap could not be checked. The send is allowed with this warning — set the channel rate in Sender settings to enable budget enforcement.",
    };
  }
  if (input.perBroadcastCapMinor !== null && input.estimateMinor > input.perBroadcastCapMinor) {
    return {
      ...base, decision: "block",
      blockReason: `Estimated cost BDT ${(input.estimateMinor / 100).toFixed(2)} exceeds the per-broadcast cap BDT ${(input.perBroadcastCapMinor / 100).toFixed(2)}.`,
    };
  }
  if (input.monthlyCapMinor !== null) {
    if (!input.monthlyEstimateComplete || input.monthlySpentMinor === null) {
      return {
        ...base, decision: "allow_with_warning",
        warning: "Monthly spend could not be fully estimated (some sent broadcasts this month have no org-entered rate), so the monthly cap could not be fully checked. The send is allowed with this warning.",
      };
    }
    if (input.monthlySpentMinor + input.estimateMinor > input.monthlyCapMinor) {
      return {
        ...base, decision: "block",
        blockReason: `Monthly spend cap exceeded: already spent (estimated from real sends at org rates) BDT ${(input.monthlySpentMinor / 100).toFixed(2)} + this broadcast's estimate BDT ${(input.estimateMinor / 100).toFixed(2)} exceeds the monthly cap BDT ${(input.monthlyCapMinor / 100).toFixed(2)}.`,
      };
    }
  }
  return base;
}
