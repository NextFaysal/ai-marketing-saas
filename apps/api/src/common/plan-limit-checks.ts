/**
 * GC22 (GB9): plan-limit enforcement helpers — the read/check
 * side of Plan Enforcement. Pure-ish functions over prisma in
 * the platform-settings helper style: every lookup is
 * defensive, and an infrastructure failure yields "no limit
 * info" (never a block). Only a POSITIVELY-KNOWN breach
 * refuses: a paused subscription, a PAST_DUE subscription past
 * its grace window, or a counted usage at/over a configured
 * limit. Refusals are ForbiddenException with merchant-facing
 * Bengali messages for staff surfaces; the order check throws
 * OrderLimitBlockedError, which additionally carries the
 * generic shopper-safe message so public checkout surfaces
 * never leak plan/limit details.
 */
import { ForbiddenException } from "@nestjs/common";
import { billingGraceDays, planResourceLimits } from "./platform-settings";
import { storageUsageForOrg } from "./storage-usage";
import { createAgentNotification } from "./agent-notify";
import { dhakaDayKey, dhakaDayStartUtc } from "../crm/lead-followups";
import { forbidden } from "../i18n";

export const PAUSED_MESSAGE = "সাবস্ক্রিপশন সাময়িকভাবে বন্ধ (pause) করা আছে — আবার চালু করতে Billing পেজ থেকে Resume করুন।";
export const PAST_DUE_GRACE_MESSAGE = "সাবস্ক্রিপশনের বকেয়া পরিশোধ করুন — গ্রেস পিরিয়ড শেষ হয়ে গেছে";
/** The ONLY message a shopper may ever see for an order block. */
export const SHOPPER_ORDER_BLOCK_MESSAGE = "দোকানটি সাময়িকভাবে অর্ডার নিতে পারছে না";

export type CommerceBlockReason = "paused" | "past_due_grace" | null;

export interface CommerceBlock {
  blocked: boolean;
  reason: CommerceBlockReason;
  message: string | null;
}

const OPEN: CommerceBlock = { blocked: false, reason: null, message: null };

/**
 * Commerce gate shared by every write choke point: paused
 * (latest subscription pausedAt set) blocks immediately;
 * PAST_DUE blocks only once currentPeriodEnd + grace days has
 * passed (the org keeps trading during grace). Any lookup
 * failure reads as OPEN — no limit info never blocks.
 */
export async function commerceBlocked(prisma: any, organizationId: string, now: Date = new Date()): Promise<CommerceBlock> {
  try {
    const sub = await prisma.subscription?.findFirst?.({
      where: { organizationId }, orderBy: { createdAt: "desc" },
    });
    if (!sub) return OPEN;
    if (sub.pausedAt) return { blocked: true, reason: "paused", message: PAUSED_MESSAGE };
    if (sub.status === "PAST_DUE" && sub.currentPeriodEnd) {
      const grace = await billingGraceDays(prisma);
      const graceEndsAt = new Date(sub.currentPeriodEnd).getTime() + grace * 24 * 3600 * 1000;
      if (graceEndsAt < now.getTime()) {
        return { blocked: true, reason: "past_due_grace", message: PAST_DUE_GRACE_MESSAGE };
      }
    }
    return OPEN;
  } catch {
    return OPEN;
  }
}

/** Start (UTC instant) of the current Asia/Dhaka calendar
 * month containing `now`. Dhaka is UTC+6 year-round, so whole
 * days subtract exactly from the Dhaka day start. */
export function dhakaMonthStartUtc(now: Date = new Date()): Date {
  const dayStart = dhakaDayStartUtc(now);
  const dayOfMonth = Number(dhakaDayKey(now).slice(8, 10));
  return new Date(dayStart.getTime() - (dayOfMonth - 1) * 24 * 3600 * 1000);
}

/** Today's Asia/Dhaka day key (yyyy-mm-dd) — the ApiUsageDaily
 * day format GC23's interceptor writes. */
export function todayDhakaKey(now: Date = new Date()): string {
  return dhakaDayKey(now);
}

/**
 * Typed order-block refusal. Carries the staff-facing Bengali
 * message (the exception message) plus `shopperMessage` — the
 * generic text public checkout callers substitute so shoppers
 * never see plan/limit details. Sync callers detect it via
 * instanceof / `code` and skip the order instead of failing
 * the whole sync.
 */
export class OrderLimitBlockedError extends ForbiddenException {
  readonly code = "ORDER_LIMIT_BLOCKED";
  readonly shopperMessage = SHOPPER_ORDER_BLOCK_MESSAGE;
  readonly blockReason: CommerceBlockReason | "order_limit";
  /** ML10: catalog pointer for the staff-facing message — the
   * global filter renders it in the request locale. */
  readonly catalogCode?: string;
  readonly catalogParams?: Record<string, unknown>;
  constructor(
    message: string,
    blockReason: CommerceBlockReason | "order_limit",
    catalog?: { code: string; params?: Record<string, unknown> },
  ) {
    super(message);
    this.blockReason = blockReason;
    this.catalogCode = catalog?.code;
    this.catalogParams = catalog?.params;
  }
}

export function isOrderLimitBlocked(e: unknown): e is OrderLimitBlockedError {
  return e instanceof OrderLimitBlockedError
    || (typeof e === "object" && e !== null && (e as any).code === "ORDER_LIMIT_BLOCKED");
}

/** Product creation gate: commerce block first, then the
 * plan's productLimit against live (non-ARCHIVED) products. */
export async function checkProductCreate(prisma: any, organizationId: string): Promise<void> {
  const block = await commerceBlocked(prisma, organizationId);
  if (block.blocked) throw forbidden(block.reason === "paused" ? "common.subscriptionPausedBlock" : "common.subscriptionPastDueGraceBlock");
  const limits = await planResourceLimits(prisma, organizationId).catch(() => null);
  if (!limits || limits.productLimit == null) return;
  let used: number | null = null;
  try {
    // ProductStatus vocabulary: DRAFT | ACTIVE | ARCHIVED —
    // archived products no longer consume the plan's slots.
    const n = await prisma.product?.count?.({
      where: { organizationId, status: { not: "ARCHIVED" } },
    });
    used = typeof n === "number" ? n : null;
  } catch { used = null; }
  if (used != null && used >= limits.productLimit) {
    throw forbidden("common.planProductLimitReached", { limit: limits.productLimit, used: used });
  }
}

/** Orders created in the current Dhaka calendar month. */
export async function ordersThisMonthCount(prisma: any, organizationId: string, now: Date = new Date()): Promise<number | null> {
  try {
    const n = await prisma.order?.count?.({
      where: { organizationId, createdAt: { gte: dhakaMonthStartUtc(now) } },
    });
    return typeof n === "number" ? n : null;
  } catch {
    return null;
  }
}

/**
 * Staff side-effects of an order-limit block: an audit row on
 * EVERY block, plus a "billing" notification to ACTIVE
 * OWNER/ADMIN members — throttled to at most one notification
 * per hour per org (an identical audit row inside the last
 * hour suppresses the notification). Fully failure-isolated:
 * nothing here may change the refusal decision.
 */
async function recordOrderLimitBlock(prisma: any, organizationId: string, detail: { limit: number; used: number }, now: Date): Promise<void> {
  try {
    const hourAgo = new Date(now.getTime() - 3600 * 1000);
    const recent = await prisma.auditLog?.findFirst?.({
      where: { organizationId, action: "billing.order_limit_blocked", createdAt: { gte: hourAgo } },
    }).catch?.(() => null) ?? null;
    await prisma.auditLog?.create?.({
      data: {
        organizationId, userId: null, action: "billing.order_limit_blocked",
        entityType: "Organization", entityId: organizationId,
        metadata: { limit: detail.limit, used: detail.used, month: dhakaDayKey(now).slice(0, 7) },
      },
    }).catch?.(() => undefined);
    if (recent) return; // throttled — an identical block was already notified within the hour
    const members = await prisma.membership?.findMany?.({
      where: { organizationId, role: { in: ["OWNER", "ADMIN"] }, status: "ACTIVE" },
      select: { userId: true },
    }).catch?.(() => []) ?? [];
    for (const m of members as any[]) {
      if (!m?.userId) continue;
      await createAgentNotification(prisma, {
        organizationId, userId: m.userId, type: "billing",
        title: "এই মাসের অর্ডার সীমা পূর্ণ",
        body: `প্ল্যানের মাসিক অর্ডার সীমা (${detail.limit}টি) পূর্ণ হয়ে গেছে — নতুন অর্ডার নেওয়া বন্ধ আছে। প্ল্যান আপগ্রেড করলে আবার অর্ডার নেওয়া যাবে।`,
      }).catch(() => null);
    }
  } catch { /* failure-isolated by design */ }
}

/** Order creation gate (creations only — the caller invokes
 * this on the create branch of the one order door). */
export async function checkOrderCreate(prisma: any, organizationId: string, now: Date = new Date()): Promise<void> {
  const block = await commerceBlocked(prisma, organizationId, now);
  if (block.blocked) throw new OrderLimitBlockedError(
    block.message ?? SHOPPER_ORDER_BLOCK_MESSAGE, block.reason,
    { code: block.reason === "paused" ? "common.subscriptionPausedBlock" : "common.subscriptionPastDueGraceBlock" },
  );
  const limits = await planResourceLimits(prisma, organizationId).catch(() => null);
  if (!limits || limits.orderLimit == null) return;
  const used = await ordersThisMonthCount(prisma, organizationId, now);
  if (used != null && used >= limits.orderLimit) {
    await recordOrderLimitBlock(prisma, organizationId, { limit: limits.orderLimit, used }, now);
    throw new OrderLimitBlockedError(
      `এই মাসের অর্ডার সীমা পূর্ণ হয়ে গেছে — সীমা ${limits.orderLimit}টি, এই মাসে ${used}টি অর্ডার তৈরি হয়েছে। প্ল্যান আপগ্রেড করলে আবার অর্ডার নেওয়া যাবে।`,
      "order_limit",
      { code: "common.monthlyOrderLimitReached", params: { limit: limits.orderLimit, used } },
    );
  }
}

/** Media upload gate: commerce block first, then the plan's
 * storageLimitMb against recorded usage + the incoming file.
 * Exactly-at-the-limit is allowed; one byte over refuses. */
export async function checkMediaUpload(prisma: any, organizationId: string, incomingBytes: number): Promise<void> {
  const block = await commerceBlocked(prisma, organizationId);
  if (block.blocked) throw forbidden(block.reason === "paused" ? "common.subscriptionPausedBlock" : "common.subscriptionPastDueGraceBlock");
  const limits = await planResourceLimits(prisma, organizationId).catch(() => null);
  if (!limits || limits.storageLimitMb == null) return;
  const usage = await storageUsageForOrg(prisma, organizationId);
  const usedBytes = BigInt(usage.storageBytes || "0");
  const limitBytes = BigInt(limits.storageLimitMb) * 1024n * 1024n;
  const incoming = BigInt(Math.max(0, Math.trunc(Number(incomingBytes) || 0)));
  if (usedBytes + incoming > limitBytes) {
    const usedMb = (Number(usedBytes) / (1024 * 1024)).toFixed(1);
    throw forbidden("common.planStorageLimitReached", { limit: limits.storageLimitMb, used: usedMb });
  }
}
