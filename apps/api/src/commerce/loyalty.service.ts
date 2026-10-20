import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EventsService } from "../common/events.service";
import { SmsProvider } from "../messaging/sms.provider";
import { tenantSmsFromRow } from "../messaging/sender-config";
import { normalizeBdPhone } from "../orders/phone-utils";
import { badRequest, notFound } from "../i18n";

/**
 * AB1 (AX1 Loyalty Points + AX2 Referral Rewards).
 *
 * THE one writer of LoyaltyLedger rows and of
 * Customer.loyaltyBalanceCache: every movement goes through a
 * private applyDelta inside a DB transaction that (1) moves the
 * cache with an atomic increment/decrement, (2) re-reads the
 * cache for balanceAfter, (3) maintains FIFO lot remainders,
 * (4) creates the ledger row. No other code writes either.
 *
 * Program rules (see docs/advanced-ab1-acceptance.md):
 *  - Earn basis = the sold order's merchandise payable:
 *    totalMinor − shippingMinor − giftWrapMinor (delivery and
 *    gift-wrap are not goods; the tax portion stays in, exactly
 *    as it is part of totalMinor). Points = floor(basis / 1000)
 *    × earnPointsPer1000Minor.
 *  - Redemption is priced by PromotionsService.evaluateCheckout
 *    (the ONE calculator) from a snapshot this service hands the
 *    caller; the spend posts here at placement, after the order
 *    exists (GB3 idempotency discipline: no entry for a failed
 *    placement).
 *  - Reversals ride ONE reconciler, onOrderTransition, which
 *    re-reads the order and re-derives everything from current
 *    DB state — duplicated or reordered events can therefore
 *    never double-post; the ledger claims (in-transaction
 *    existence checks + the AB1 partial unique indexes) decide.
 *  - A clawback takes back the FULL earned amount at a full
 *    refund (proportionally for partial refunds, judged on the
 *    cumulative refundedMinor) and the balance MAY go negative:
 *    a negative balance blocks redemption until earned back.
 *    That is a deliberate, documented choice.
 *  - Everything here is failure-isolated from order flows: the
 *    event handlers and the placement hook catch and log, they
 *    never throw into a checkout or a status change.
 */

const DEAD_STATUSES = new Set(["cancelled", "refunded", "failed"]);
const DELIVERED_SHIPMENT_STATUSES = new Set(["delivered", "partial_delivered"]);

// Ledger note markers — machine-read (clawback accounting sums
// prior entries by marker), never customer-facing copy.
export const LOYALTY_NOTE_REDEEM_REVERSAL = "redeem_reversal";
export const LOYALTY_NOTE_EARN_CLAWBACK = "earn_clawback";
export const LOYALTY_NOTE_REFERRAL_CLAWBACK = "referral_reward_clawback";
export const LOYALTY_NOTE_EXPIRED = "points_expired";
export const LOYALTY_NOTE_REFERRAL_REWARD = "referral_reward";

const REWARD_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_LOTS_PER_OPERATION = 500;

function toBig(v: unknown): bigint {
  try {
    return BigInt(v as any);
  } catch {
    return 0n;
  }
}

function isUniqueViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /unique|P2002/i.test(msg);
}

/** Local mirror of the canonical sold predicate (ON7 /
 * finance-common isSoldOrderShape): dead statuses never count;
 * status completed|delivered counts; otherwise a delivered /
 * partially-delivered shipment counts. Kept local for the same
 * module-cycle reason the mirrors exist elsewhere. */
export function isSoldOrderShape(status: string, shipmentStatuses: string[]): boolean {
  if (DEAD_STATUSES.has(status)) return false;
  if (status === "completed" || status === "delivered") return true;
  return shipmentStatuses.some((s) => DELIVERED_SHIPMENT_STATUSES.has(s));
}

/** The earn / reward-minimum basis of an order (see header). */
export function loyaltyBasisMinor(order: any): bigint {
  const basis =
    toBig(order?.totalMinor) - toBig(order?.shippingMinor) - toBig(order?.giftWrapMinor);
  return basis > 0n ? basis : 0n;
}

@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger(LoyaltyService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly events?: EventsService,
    @Optional() private readonly sms?: SmsProvider,
  ) {
    // The affiliates pattern (EC32): subscribe in the
    // constructor, revalidate everything from the DB inside the
    // handler. Every handler funnels into the ONE reconciler.
    if (this.events) {
      const reconcile = (p: any) => {
        void this.onOrderTransition(p?.organizationId, p?.context?.orderId);
      };
      this.events.on("order.delivered", reconcile);
      this.events.on("order.ingested", reconcile);
      this.events.on("order.created", reconcile);
      this.events.on("order.status_changed", reconcile);
      this.events.on("order.refunded", reconcile);
      this.events.on("shipment.status_changed", (p) => {
        const s = String(p?.context?.shipmentStatus ?? "");
        if (DELIVERED_SHIPMENT_STATUSES.has(s)) reconcile(p);
      });
    }
  }

  private t(name: string): any {
    return (this.prisma as any)[name];
  }

  private async safeAudit(input: Parameters<AuditService["log"]>[0]): Promise<void> {
    try {
      await this.audit?.log(input);
    } catch {
      /* audit is best-effort, like the neighbouring services */
    }
  }

  // ================= settings =================

  private defaultLoyaltySetting(orgId: string): any {
    return {
      organizationId: orgId,
      enabled: false,
      earnPointsPer1000Minor: 1,
      redeemValueMinorPerPoint: 100,
      minRedeemPoints: 0,
      maxRedeemSharePct: null,
      pointsExpiryDays: null,
    };
  }

  async getLoyaltySetting(orgId: string): Promise<any> {
    const row = await this.t("loyaltySetting")
      .findFirst({ where: { organizationId: orgId } })
      .catch(() => null);
    return { setting: row ?? this.defaultLoyaltySetting(orgId) };
  }

  private async loadLoyaltySetting(orgId: string): Promise<any | null> {
    return this.t("loyaltySetting")
      .findFirst({ where: { organizationId: orgId } })
      .catch(() => null);
  }

  async updateLoyaltySetting(orgId: string, actorId: string, dto: any): Promise<any> {
    const current =
      (await this.loadLoyaltySetting(orgId)) ?? this.defaultLoyaltySetting(orgId);
    const data: Record<string, any> = {};
    // GB4 lesson: the ValidationPipe materialises absent fields
    // as undefined own-properties — "provided" means !== undefined.
    if (dto.enabled !== undefined) data.enabled = dto.enabled === true;
    if (dto.earnPointsPer1000Minor !== undefined) {
      const v = dto.earnPointsPer1000Minor;
      if (!Number.isInteger(v) || v < 0 || v > 100000) {
        throw badRequest("commerce.earnRatePointsInvalid");
      }
      data.earnPointsPer1000Minor = v;
    }
    if (dto.redeemValueMinorPerPoint !== undefined) {
      const v = dto.redeemValueMinorPerPoint;
      if (!Number.isInteger(v) || v < 1 || v > 1000000) {
        throw badRequest("commerce.pointValueMin");
      }
      data.redeemValueMinorPerPoint = v;
    }
    if (dto.minRedeemPoints !== undefined) {
      const v = dto.minRedeemPoints;
      if (!Number.isInteger(v) || v < 0 || v > 1000000) {
        throw badRequest("commerce.minRedeemPointsInvalid");
      }
      data.minRedeemPoints = v;
    }
    if (dto.maxRedeemSharePct !== undefined) {
      const v = dto.maxRedeemSharePct;
      if (v !== null && (!Number.isInteger(v) || v < 1 || v > 100)) {
        throw badRequest("commerce.maxRedeemShareRange");
      }
      data.maxRedeemSharePct = v;
    }
    if (dto.pointsExpiryDays !== undefined) {
      const v = dto.pointsExpiryDays;
      if (v !== null && (!Number.isInteger(v) || v < 1 || v > 3650)) {
        throw badRequest("commerce.pointsValidityRange");
      }
      data.pointsExpiryDays = v;
    }
    const merged = { ...current, ...data };
    const table = this.t("loyaltySetting");
    const saved = table.upsert
      ? await table.upsert({
          where: { organizationId: orgId },
          create: { organizationId: orgId, ...this.defaultLoyaltySetting(orgId), ...data },
          update: data,
        })
      : await table.update({
          where: { id: (await this.loadLoyaltySetting(orgId))?.id },
          data,
        }).catch(() => table.create({ data: { organizationId: orgId, ...merged } }));
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "loyalty.settings_updated",
      entityType: "LoyaltySetting", entityId: saved?.id ?? orgId,
      metadata: { enabled: merged.enabled },
    });
    return { setting: saved ?? merged };
  }

  private defaultReferralRewardSetting(orgId: string): any {
    return {
      organizationId: orgId,
      enabled: false,
      rewardType: "points",
      rewardPoints: null,
      couponPercent: null,
      rewardMinOrderMinor: null,
    };
  }

  async getReferralRewardSetting(orgId: string): Promise<any> {
    const row = await this.t("referralRewardSetting")
      .findFirst({ where: { organizationId: orgId } })
      .catch(() => null);
    const setting = row ?? this.defaultReferralRewardSetting(orgId);
    return {
      setting: {
        ...setting,
        rewardMinOrderMinor:
          setting.rewardMinOrderMinor != null ? String(setting.rewardMinOrderMinor) : null,
      },
    };
  }

  private async loadReferralRewardSetting(orgId: string): Promise<any | null> {
    return this.t("referralRewardSetting")
      .findFirst({ where: { organizationId: orgId } })
      .catch(() => null);
  }

  async updateReferralRewardSetting(orgId: string, actorId: string, dto: any): Promise<any> {
    const current =
      (await this.loadReferralRewardSetting(orgId)) ??
      this.defaultReferralRewardSetting(orgId);
    const data: Record<string, any> = {};
    if (dto.enabled !== undefined) data.enabled = dto.enabled === true;
    if (dto.rewardType !== undefined) {
      if (dto.rewardType !== "points" && dto.rewardType !== "coupon") {
        throw badRequest("commerce.rewardTypeInvalid");
      }
      data.rewardType = dto.rewardType;
    }
    if (dto.rewardPoints !== undefined) {
      const v = dto.rewardPoints;
      if (v !== null && (!Number.isInteger(v) || v < 1 || v > 1000000)) {
        throw badRequest("commerce.rewardPointsInvalid");
      }
      data.rewardPoints = v;
    }
    if (dto.couponPercent !== undefined) {
      const v = dto.couponPercent;
      if (v !== null && (!Number.isInteger(v) || v < 1 || v > 90)) {
        throw badRequest("commerce.rewardCouponPercentRange");
      }
      data.couponPercent = v;
    }
    if (dto.rewardMinOrderMinor !== undefined) {
      if (dto.rewardMinOrderMinor === null || dto.rewardMinOrderMinor === "") {
        data.rewardMinOrderMinor = null;
      } else {
        let parsed: bigint;
        try {
          parsed = BigInt(dto.rewardMinOrderMinor);
        } catch {
          throw badRequest("commerce.minOrderValueInvalid");
        }
        if (parsed < 0n) {
          throw badRequest("commerce.minOrderValueNegative");
        }
        data.rewardMinOrderMinor = parsed;
      }
    }
    const merged = { ...current, ...data };
    // The chosen type's amount is REQUIRED to enable: a program
    // that would silently reward nothing is a configuration
    // error, surfaced here rather than at reward time.
    if (merged.enabled === true) {
      if (merged.rewardType === "points" && !(Number(merged.rewardPoints) > 0)) {
        throw badRequest("commerce.pointsRewardNeedsPoints");
      }
      if (
        merged.rewardType === "coupon" &&
        !(Number(merged.couponPercent) >= 1 && Number(merged.couponPercent) <= 90)
      ) {
        throw badRequest("commerce.couponRewardNeedsPercent");
      }
    }
    const table = this.t("referralRewardSetting");
    const saved = table.upsert
      ? await table.upsert({
          where: { organizationId: orgId },
          create: {
            organizationId: orgId,
            ...this.defaultReferralRewardSetting(orgId),
            ...data,
          },
          update: data,
        })
      : await table.create({ data: { organizationId: orgId, ...merged } });
    await this.safeAudit({
      organizationId: orgId, userId: actorId,
      action: "loyalty.referral_reward_settings_updated",
      entityType: "ReferralRewardSetting", entityId: saved?.id ?? orgId,
      metadata: { enabled: merged.enabled, rewardType: merged.rewardType },
    });
    return {
      setting: {
        ...(saved ?? merged),
        rewardMinOrderMinor:
          (saved ?? merged).rewardMinOrderMinor != null
            ? String((saved ?? merged).rewardMinOrderMinor)
            : null,
      },
    };
  }

  // ================= ledger core (the ONE writer) =================

  /**
   * Move the customer's cached balance by `delta` inside an open
   * transaction and return the resulting balance. The UPDATE
   * row-locks the customer row, so concurrent postings for the
   * same customer serialize on it. For `requireFunds` the move is
   * a conditional decrement: when the balance cannot cover it,
   * this throws Error("insufficient_loyalty_balance") and the
   * caller's transaction rolls back.
   */
  private async applyDeltaTx(
    tx: any,
    customerId: string,
    delta: number,
    opts?: { requireFunds?: boolean },
  ): Promise<number> {
    if (opts?.requireFunds) {
      const res = await tx.customer.updateMany({
        where: { id: customerId, loyaltyBalanceCache: { gte: -delta } },
        data: { loyaltyBalanceCache: { decrement: -delta } },
      });
      if (!res || Number(res.count ?? 0) === 0) {
        throw new Error("insufficient_loyalty_balance");
      }
    } else {
      await tx.customer.update({
        where: { id: customerId },
        data: { loyaltyBalanceCache: { increment: delta } },
      });
    }
    const fresh = await tx.customer.findFirst({ where: { id: customerId } });
    return Number(fresh?.loyaltyBalanceCache ?? 0);
  }

  /** Consume `points` from the customer's positive lots, oldest
   * first (FIFO); the optional priority lot (a clawback's source
   * lot) is consumed before the rest. Bounded per operation. */
  private async consumeLotsTx(
    tx: any,
    orgId: string,
    customerId: string,
    points: number,
    priorityLotId?: string | null,
  ): Promise<void> {
    let left = points;
    if (left <= 0) return;
    const lots: any[] =
      (await tx.loyaltyLedger
        .findMany({
          where: { organizationId: orgId, customerId, remainingPoints: { gt: 0 } },
          orderBy: [{ createdAt: "asc" }],
          take: MAX_LOTS_PER_OPERATION,
        })
        .catch(() => [])) ?? [];
    const ordered = priorityLotId
      ? [
          ...lots.filter((l) => String(l.id) === String(priorityLotId)),
          ...lots.filter((l) => String(l.id) !== String(priorityLotId)),
        ]
      : lots;
    for (const lot of ordered) {
      if (left <= 0) break;
      const take = Math.min(left, Number(lot.remainingPoints ?? 0));
      if (take <= 0) continue;
      await tx.loyaltyLedger.update({
        where: { id: lot.id },
        data: { remainingPoints: Number(lot.remainingPoints) - take },
      });
      left -= take;
    }
  }

  private async createEntryTx(tx: any, data: Record<string, any>): Promise<any> {
    return tx.loyaltyLedger.create({ data });
  }

  /** The customer a points movement belongs to: a merged record
   * resolves to its survivor (the human is the same); a missing
   * survivor means no posting. */
  private async effectiveCustomerId(orgId: string, customerId: string | null): Promise<string | null> {
    if (!customerId) return null;
    const row = await this.t("customer")
      .findFirst({ where: { id: customerId, organizationId: orgId } })
      .catch(() => null);
    if (!row) return null;
    if (row.mergedIntoId) {
      const survivor = await this.t("customer")
        .findFirst({ where: { id: row.mergedIntoId, organizationId: orgId } })
        .catch(() => null);
      return survivor ? String(survivor.id) : null;
    }
    return String(row.id);
  }

  // ================= checkout =================

  /**
   * The snapshot a checkout caller hands to
   * PromotionsService.evaluateCheckout (the GB7 pattern: the
   * evaluator reads no loyalty tables). Null when redemption
   * cannot apply: program off, no identified customer, or the
   * customer record was merged away.
   */
  async checkoutSnapshot(
    orgId: string,
    customerId: string | null,
  ): Promise<{
    balance: number;
    redeemValueMinorPerPoint: number;
    minRedeemPoints: number;
    maxRedeemSharePct: number | null;
  } | null> {
    try {
      if (!customerId) return null;
      const setting = await this.loadLoyaltySetting(orgId);
      if (!setting?.enabled) return null;
      const customer = await this.t("customer")
        .findFirst({ where: { id: customerId, organizationId: orgId } })
        .catch(() => null);
      if (!customer || customer.mergedIntoId) return null;
      return {
        balance: Number(customer.loyaltyBalanceCache ?? 0),
        redeemValueMinorPerPoint: Number(setting.redeemValueMinorPerPoint ?? 100),
        minRedeemPoints: Number(setting.minRedeemPoints ?? 0),
        maxRedeemSharePct:
          setting.maxRedeemSharePct != null ? Number(setting.maxRedeemSharePct) : null,
      };
    } catch (e) {
      this.logger.warn(
        `loyalty checkout snapshot failed for org ${orgId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  /**
   * Spend the points an evaluation applied, AFTER the order
   * exists (placement-time posting — a failed placement posts
   * nothing). Failure-isolated by contract: a posting problem is
   * logged, never thrown into a completed checkout. Exactly-once
   * per order: an existing redeem entry short-circuits.
   */
  async postPlacementRedeem(
    orgId: string,
    input: { orderId: string | null; customerId: string | null; points: number },
  ): Promise<any | null> {
    try {
      const points = Math.floor(Number(input.points ?? 0));
      if (!input.orderId || !input.customerId || !(points > 0)) return null;
      const customerId = await this.effectiveCustomerId(orgId, input.customerId);
      if (!customerId) return null;
      return await (this.prisma as any).$transaction(async (tx: any) => {
        const existing = await tx.loyaltyLedger.findFirst({
          where: { organizationId: orgId, orderId: input.orderId, reason: "redeem" },
        });
        if (existing) return existing;
        const balanceAfter = await this.applyDeltaTx(tx, customerId, -points, {
          requireFunds: true,
        });
        await this.consumeLotsTx(tx, orgId, customerId, points);
        return this.createEntryTx(tx, {
          organizationId: orgId,
          customerId,
          deltaPoints: -points,
          reason: "redeem",
          orderId: input.orderId,
          balanceAfter,
          expiresAt: null,
          remainingPoints: null,
          createdById: null,
          note: null,
        });
      });
    } catch (e) {
      if (isUniqueViolation(e)) return null;
      // insufficient_loyalty_balance lands here too: the discount
      // was priced against a balance checked moments earlier, so
      // this means a concurrent spend won the race. The placed
      // order stands (its discount is in its totals); the miss
      // is logged loudly for staff reconciliation via adjust.
      this.logger.warn(
        `loyalty redeem posting failed for order ${input.orderId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  // ================= the reconciler =================

  /**
   * Re-derive an order's loyalty state from the CURRENT DB rows
   * and post whatever is missing. Called by the event handlers,
   * by IntegrationsService on external status changes, and
   * directly by specs. Idempotent by construction (every posting
   * is claim-guarded) and failure-isolated by contract.
   */
  async onOrderTransition(orgId: string | null | undefined, orderId: string | null | undefined): Promise<void> {
    try {
      if (!orgId || !orderId) return;
      const order = await this.t("order")
        .findFirst({ where: { id: orderId, organizationId: orgId } })
        .catch(() => null);
      if (!order || order.isPractice) return;

      const shipments: any[] =
        (await this.t("courierShipment")
          .findMany({ where: { organizationId: orgId, orderId: order.id } })
          .catch(() => [])) ?? [];
      const sold = isSoldOrderShape(
        String(order.status ?? ""),
        shipments.map((s) => String(s.status ?? "")),
      );

      if (sold && order.customerId) {
        await this.maybeEarn(orgId, order);
        await this.maybeReferralReward(orgId, order);
      }

      const status = String(order.status ?? "");
      if (status === "cancelled" || status === "failed") {
        await this.reverseRedeem(orgId, order);
        await this.clawback(orgId, order, toBig(order.totalMinor), /* full */ true);
        await this.voidReferralCoupon(orgId, order);
      } else {
        // A "refunded" status from an external system means a
        // FULL refund even when the synced refundedMinor lags;
        // otherwise the cumulative recorded refund rules.
        const recorded = toBig(order.refundedMinor);
        const effective =
          status === "refunded" && recorded < toBig(order.totalMinor)
            ? toBig(order.totalMinor)
            : recorded;
        if (effective > 0n) {
          await this.clawback(orgId, order, effective, effective >= toBig(order.totalMinor));
          if (effective >= toBig(order.totalMinor) && toBig(order.totalMinor) > 0n) {
            await this.voidReferralCoupon(orgId, order);
          }
        }
      }
    } catch (e) {
      this.logger.warn(
        `loyalty reconcile failed for order ${orderId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Earn, exactly-once per order (claim check inside the
   * transaction + the partial unique index as backstop). */
  private async maybeEarn(orgId: string, order: any): Promise<void> {
    const setting = await this.loadLoyaltySetting(orgId);
    if (!setting?.enabled) return;
    const rate = Number(setting.earnPointsPer1000Minor ?? 0);
    if (!(rate > 0)) return;
    const basis = loyaltyBasisMinor(order);
    const points = Number(basis / 1000n) * rate;
    if (!(points > 0)) return;
    const customerId = await this.effectiveCustomerId(orgId, order.customerId ?? null);
    if (!customerId) return;
    const expiresAt =
      setting.pointsExpiryDays != null
        ? new Date(Date.now() + Number(setting.pointsExpiryDays) * 86400_000)
        : null;
    try {
      await (this.prisma as any).$transaction(async (tx: any) => {
        const existing = await tx.loyaltyLedger.findFirst({
          where: { organizationId: orgId, orderId: order.id, reason: "earn" },
        });
        if (existing) return;
        const balanceAfter = await this.applyDeltaTx(tx, customerId, points);
        await this.createEntryTx(tx, {
          organizationId: orgId,
          customerId,
          deltaPoints: points,
          reason: "earn",
          orderId: order.id,
          balanceAfter,
          expiresAt,
          remainingPoints: points,
          createdById: null,
          note: null,
        });
      });
    } catch (e) {
      if (!isUniqueViolation(e)) {
        this.logger.warn(
          `loyalty earn failed for order ${order.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  /** AX2: reward the referrer of a sold order, exactly-once per
   * order. Self-referral never rewards. Points rewards require
   * the loyalty program (the ledger is their only home); the
   * coupon path is independent of it. */
  private async maybeReferralReward(orgId: string, order: any): Promise<void> {
    const setting = await this.loadReferralRewardSetting(orgId);
    if (!setting?.enabled) return;
    if (!order.customerId) return; // buyer unidentifiable ⇒ non-self unprovable
    let referrerId: string | null = order.referrerCustomerId ?? null;
    if (!referrerId && order.referralCode) {
      const referrer = await this.t("customer")
        .findFirst({ where: { organizationId: orgId, referralCode: order.referralCode } })
        .catch(() => null);
      if (referrer) referrerId = String(referrer.id);
    }
    if (!referrerId) return;
    if (String(referrerId) === String(order.customerId)) return;
    const referrerCustomerId = await this.effectiveCustomerId(orgId, referrerId);
    if (!referrerCustomerId) return;
    if (referrerCustomerId === (await this.effectiveCustomerId(orgId, order.customerId))) return;
    if (setting.rewardMinOrderMinor != null) {
      if (loyaltyBasisMinor(order) < toBig(setting.rewardMinOrderMinor)) return;
    }

    if (setting.rewardType === "coupon") {
      await this.issueReferralCoupon(orgId, order, referrerCustomerId, setting);
      return;
    }
    // points
    const points = Number(setting.rewardPoints ?? 0);
    if (!(points > 0)) return;
    const loyaltySetting = await this.loadLoyaltySetting(orgId);
    if (!loyaltySetting?.enabled) {
      // Honest skip: points have no home while the program is
      // off. The settings UI says so next to the toggle.
      this.logger.log(
        `referral points reward skipped for order ${order.id}: loyalty program disabled`,
      );
      return;
    }
    const expiresAt =
      loyaltySetting.pointsExpiryDays != null
        ? new Date(Date.now() + Number(loyaltySetting.pointsExpiryDays) * 86400_000)
        : null;
    try {
      await (this.prisma as any).$transaction(async (tx: any) => {
        const existing = await tx.loyaltyLedger.findFirst({
          where: { organizationId: orgId, orderId: order.id, reason: "referral_reward" },
        });
        if (existing) return;
        const balanceAfter = await this.applyDeltaTx(tx, referrerCustomerId, points);
        await this.createEntryTx(tx, {
          organizationId: orgId,
          customerId: referrerCustomerId,
          deltaPoints: points,
          reason: "referral_reward",
          orderId: order.id,
          balanceAfter,
          expiresAt,
          remainingPoints: points,
          createdById: null,
          note: LOYALTY_NOTE_REFERRAL_REWARD,
        });
      });
    } catch (e) {
      if (!isUniqueViolation(e)) {
        this.logger.warn(
          `referral points reward failed for order ${order.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  /** Issue the reward coupon (a REAL StoreDiscount, the GB7
   * pattern) and tell the referrer. The (org, sourceRef) claim —
   * checked first, partial-unique-index backstopped — is what
   * makes the reward exactly-once per referred order. */
  private async issueReferralCoupon(
    orgId: string,
    order: any,
    referrerCustomerId: string,
    setting: any,
  ): Promise<void> {
    const percent = Number(setting.couponPercent ?? 0);
    if (!(percent >= 1 && percent <= 90)) return;
    const discountTable = this.t("storeDiscount");
    if (!discountTable?.create) return;
    const existing = await discountTable
      .findFirst({
        where: { organizationId: orgId, origin: "referral_reward", sourceRef: String(order.id) },
      })
      .catch(() => null);
    if (existing) return;
    let created: any = null;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const bytes = randomBytes(6);
      let suffix = "";
      for (let i = 0; i < 6; i++) suffix += REWARD_CODE_ALPHABET[bytes[i] % REWARD_CODE_ALPHABET.length];
      const code = `REF-${suffix}`;
      try {
        created = await discountTable.create({
          data: {
            organizationId: orgId,
            code,
            kind: "percent",
            value: percent,
            minOrderMinor: null,
            endsAt: new Date(Date.now() + 30 * 86400_000),
            perCustomerLimit: 1,
            firstOrderOnly: false,
            active: true,
            origin: "referral_reward",
            sourceRef: String(order.id),
          },
        });
      } catch (e) {
        if (isUniqueViolation(e) && attempt < 4) {
          // Either the generated code clashed (retry with a new
          // one) or the per-order claim was won concurrently —
          // the re-check distinguishes them.
          const won = await discountTable
            .findFirst({
              where: { organizationId: orgId, origin: "referral_reward", sourceRef: String(order.id) },
            })
            .catch(() => null);
          if (won) return;
          continue;
        }
        this.logger.warn(
          `referral reward coupon issuance failed for order ${order.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
        return;
      }
    }
    if (!created) return;
    const sentVia = await this.notifyReferrerOfCoupon(orgId, referrerCustomerId, created, percent);
    await this.safeAudit({
      organizationId: orgId, action: "loyalty.referral_reward_issued",
      entityType: "StoreDiscount", entityId: created.id,
      metadata: {
        orderId: order.id, referrerCustomerId, rewardType: "coupon",
        couponCode: created.code, sentVia,
      },
    });
  }

  /** SMS the referrer their reward code — the same tenant-config
   * + platform-fallback plumbing as ShopAccountService.sendShopSms
   * (no second sender invented). Returns "sms" only when a send
   * actually happened; otherwise "none". */
  private async notifyReferrerOfCoupon(
    orgId: string,
    referrerCustomerId: string,
    coupon: any,
    percent: number,
  ): Promise<"sms" | "none"> {
    try {
      const referrer = await this.t("customer")
        .findFirst({ where: { id: referrerCustomerId, organizationId: orgId } })
        .catch(() => null);
      const phone = referrer?.phone ? String(referrer.phone) : null;
      if (!phone || !this.sms) return "none";
      const org = await this.t("organization")
        .findFirst({ where: { id: orgId } })
        .catch(() => null);
      const shopName = org?.brandName || org?.name || "দোকান";
      const text =
        `অভিনন্দন! আপনার রেফারেলে একটি অর্ডার সম্পন্ন হয়েছে। ` +
        `পুরস্কার হিসেবে পেয়েছেন ${percent}% ছাড়ের কুপন: ${coupon.code} (${shopName}) — মেয়াদ ৩০ দিন।`;
      const to = normalizeBdPhone(phone) ?? phone.replace(/\D/g, "");
      const tenantCfg = await this.resolveTenantSms(orgId);
      if (tenantCfg) {
        await this.sms.sendWithGateway(tenantCfg.gateway, tenantCfg, {
          to, text, reference: `referral-reward-${coupon.id}`,
        });
        return "sms";
      }
      if (this.sms.isConfigured()) {
        await this.sms.send({ to, text, reference: `referral-reward-${coupon.id}` });
        return "sms";
      }
      return "none";
    } catch (e) {
      this.logger.warn(
        `referral reward SMS failed for org ${orgId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return "none";
    }
  }

  private async resolveTenantSms(orgId: string): Promise<any | null> {
    try {
      const row =
        (await (this.prisma as any).messagingSenderConfig?.findUnique({
          where: { organizationId: orgId },
        })) ?? null;
      return tenantSmsFromRow(row);
    } catch {
      return null;
    }
  }

  /** Hand back the points a cancelled/failed order had redeemed,
   * as a fresh non-expiring adjust lot (exactly which lots the
   * original redemption consumed is not reconstructable, so the
   * return is its own lot — documented). Marker-guarded. */
  private async reverseRedeem(orgId: string, order: any): Promise<void> {
    const redeem = await this.t("loyaltyLedger")
      .findFirst({ where: { organizationId: orgId, orderId: order.id, reason: "redeem" } })
      .catch(() => null);
    if (!redeem) return;
    const points = -Number(redeem.deltaPoints ?? 0);
    if (!(points > 0)) return;
    const customerId = String(redeem.customerId);
    try {
      await (this.prisma as any).$transaction(async (tx: any) => {
        const marker = await tx.loyaltyLedger.findFirst({
          where: {
            organizationId: orgId, orderId: order.id,
            reason: "adjust", note: LOYALTY_NOTE_REDEEM_REVERSAL,
          },
        });
        if (marker) return;
        const balanceAfter = await this.applyDeltaTx(tx, customerId, points);
        await this.createEntryTx(tx, {
          organizationId: orgId,
          customerId,
          deltaPoints: points,
          reason: "adjust",
          orderId: order.id,
          balanceAfter,
          expiresAt: null,
          remainingPoints: points,
          createdById: null,
          note: LOYALTY_NOTE_REDEEM_REVERSAL,
        });
      });
    } catch (e) {
      this.logger.warn(
        `loyalty redeem reversal failed for order ${order.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Claw back earn + referral-reward points in proportion to
   * the cumulative refunded share of the order total (the full
   * amount at a full refund). Already-clawed amounts are summed
   * from the marker entries, so repeated reconciles converge
   * instead of double-posting. The balance MAY go negative
   * (documented program rule).
   */
  private async clawback(
    orgId: string,
    order: any,
    effectiveRefundedMinor: bigint,
    full: boolean,
  ): Promise<void> {
    const total = toBig(order.totalMinor);
    if (total <= 0n || effectiveRefundedMinor <= 0n) return;
    await this.clawbackOne(orgId, order, "earn", LOYALTY_NOTE_EARN_CLAWBACK, effectiveRefundedMinor, total, full);
    await this.clawbackOne(orgId, order, "referral_reward", LOYALTY_NOTE_REFERRAL_CLAWBACK, effectiveRefundedMinor, total, full);
  }

  private async clawbackOne(
    orgId: string,
    order: any,
    sourceReason: "earn" | "referral_reward",
    markerNote: string,
    effectiveRefundedMinor: bigint,
    total: bigint,
    full: boolean,
  ): Promise<void> {
    const source = await this.t("loyaltyLedger")
      .findFirst({ where: { organizationId: orgId, orderId: order.id, reason: sourceReason } })
      .catch(() => null);
    if (!source) return;
    const granted = Number(source.deltaPoints ?? 0);
    if (!(granted > 0)) return;
    const target = full
      ? granted
      : Number((BigInt(granted) * effectiveRefundedMinor) / total);
    if (!(target > 0)) return;
    const customerId = String(source.customerId);
    try {
      await (this.prisma as any).$transaction(async (tx: any) => {
        const priors: any[] =
          (await tx.loyaltyLedger
            .findMany({
              where: { organizationId: orgId, orderId: order.id, reason: "adjust", note: markerNote },
            })
            .catch(() => [])) ?? [];
        const already = priors.reduce((s, r) => s + -Number(r.deltaPoints ?? 0), 0);
        const delta = target - already;
        if (delta <= 0) return;
        // Consume the source lot first, then the rest FIFO.
        await this.consumeLotsTx(tx, orgId, customerId, delta, String(source.id));
        if (full) {
          const fresh = await tx.loyaltyLedger.findFirst({ where: { id: source.id } });
          if (fresh && Number(fresh.remainingPoints ?? 0) > 0) {
            await tx.loyaltyLedger.update({
              where: { id: source.id },
              data: { remainingPoints: 0 },
            });
          }
        }
        const balanceAfter = await this.applyDeltaTx(tx, customerId, -delta);
        await this.createEntryTx(tx, {
          organizationId: orgId,
          customerId,
          deltaPoints: -delta,
          reason: "adjust",
          orderId: order.id,
          balanceAfter,
          expiresAt: null,
          remainingPoints: null,
          createdById: null,
          note: markerNote,
        });
      });
    } catch (e) {
      this.logger.warn(
        `loyalty clawback (${sourceReason}) failed for order ${order.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** A fully-refunded referred order's UNUSED reward coupon is
   * disabled; an already-redeemed one is spent value and stays
   * (documented — there is nothing to claw back). */
  private async voidReferralCoupon(orgId: string, order: any): Promise<void> {
    try {
      const coupon = await this.t("storeDiscount")
        .findFirst({
          where: {
            organizationId: orgId, origin: "referral_reward",
            sourceRef: String(order.id), active: true,
          },
        })
        .catch(() => null);
      if (!coupon) return;
      if (Number(coupon.usedCount ?? 0) > 0) return;
      await this.t("storeDiscount").update({
        where: { id: coupon.id },
        data: { active: false },
      });
    } catch (e) {
      this.logger.warn(
        `referral coupon void failed for order ${order.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ================= expiry sweep =================

  /**
   * loyalty_points_sweep job body (per-org enablement, the
   * AutomationService pattern): expire every positive lot whose
   * expiresAt has passed. The covered amount is capped by the
   * customer's spendable balance — points already consumed by a
   * clawback deficit expire as a 0-delta record, never as a
   * second subtraction. Exactly-once: a lot is zeroed inside the
   * same transaction that posts its expire entry, and the sweep
   * only selects lots with remainingPoints > 0.
   */
  async runExpirySweep(orgId: string): Promise<{ expired: number; pointsExpired: number }> {
    const now = new Date();
    const lots: any[] =
      (await this.t("loyaltyLedger")
        .findMany({
          where: {
            organizationId: orgId,
            remainingPoints: { gt: 0 },
            expiresAt: { not: null, lt: now },
          },
          orderBy: [{ createdAt: "asc" }],
          take: MAX_LOTS_PER_OPERATION,
        })
        .catch(() => [])) ?? [];
    let expired = 0;
    let pointsExpired = 0;
    for (const lot of lots) {
      try {
        const posted = await (this.prisma as any).$transaction(async (tx: any) => {
          const fresh = await tx.loyaltyLedger.findFirst({ where: { id: lot.id } });
          if (!fresh) return 0;
          const remaining = Number(fresh.remainingPoints ?? 0);
          if (!(remaining > 0)) return 0;
          if (!fresh.expiresAt || new Date(fresh.expiresAt).getTime() >= now.getTime()) return 0;
          const customer = await tx.customer.findFirst({ where: { id: fresh.customerId } });
          const balance = Number(customer?.loyaltyBalanceCache ?? 0);
          const covered = Math.min(remaining, Math.max(balance, 0));
          await tx.loyaltyLedger.update({
            where: { id: fresh.id },
            data: { remainingPoints: 0 },
          });
          const balanceAfter =
            covered > 0 ? await this.applyDeltaTx(tx, String(fresh.customerId), -covered) : balance;
          await this.createEntryTx(tx, {
            organizationId: orgId,
            customerId: String(fresh.customerId),
            deltaPoints: -covered,
            reason: "expire",
            orderId: fresh.orderId ?? null,
            balanceAfter,
            expiresAt: null,
            remainingPoints: null,
            createdById: null,
            note: LOYALTY_NOTE_EXPIRED,
          });
          return covered;
        });
        expired += 1;
        pointsExpired += Number(posted ?? 0);
      } catch (e) {
        this.logger.warn(
          `loyalty expiry failed for lot ${lot.id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    return { expired, pointsExpired };
  }

  // ================= staff + account reads =================

  private serializeEntry(e: any): any {
    return {
      id: e.id,
      customerId: e.customerId,
      deltaPoints: Number(e.deltaPoints ?? 0),
      reason: e.reason,
      orderId: e.orderId ?? null,
      balanceAfter: Number(e.balanceAfter ?? 0),
      expiresAt: e.expiresAt ? new Date(e.expiresAt).toISOString() : null,
      remainingPoints: e.remainingPoints != null ? Number(e.remainingPoints) : null,
      createdById: e.createdById ?? null,
      note: e.note ?? null,
      createdAt: e.createdAt ? new Date(e.createdAt).toISOString() : null,
    };
  }

  /** Resolve order numbers for a page of entries (bounded). */
  private async withOrderNumbers(orgId: string, entries: any[]): Promise<any[]> {
    const ids = [...new Set(entries.map((e) => e.orderId).filter(Boolean))] as string[];
    if (ids.length === 0) return entries.map((e) => ({ ...e, orderNumber: null }));
    const orders: any[] =
      (await this.t("order")
        .findMany({ where: { organizationId: orgId, id: { in: ids } } })
        .catch(() => [])) ?? [];
    const byId = new Map(orders.map((o) => [String(o.id), o.externalNumber ?? o.externalId ?? null]));
    return entries.map((e) => ({
      ...e,
      orderNumber: e.orderId ? (byId.get(String(e.orderId)) ?? null) : null,
    }));
  }

  /** The referral rewards a customer has earned: points entries
   * + issued reward coupons (resolved through the orders they
   * referred — the coupon's claim key is the order id). */
  private async referralRewardsFor(orgId: string, referrerCustomerId: string): Promise<any> {
    const referredOrders: any[] =
      (await this.t("order")
        .findMany({
          where: { organizationId: orgId, referrerCustomerId },
          orderBy: [{ createdAt: "desc" }],
          take: 200,
        })
        .catch(() => [])) ?? [];
    const orderIds = referredOrders.map((o) => String(o.id));
    let coupons: any[] = [];
    if (orderIds.length > 0) {
      coupons =
        (await this.t("storeDiscount")
          .findMany({
            where: { organizationId: orgId, origin: "referral_reward", sourceRef: { in: orderIds } },
            orderBy: [{ createdAt: "desc" }],
            take: 20,
          })
          .catch(() => [])) ?? [];
    }
    const numberById = new Map(
      referredOrders.map((o) => [String(o.id), o.externalNumber ?? o.externalId ?? null]),
    );
    return {
      coupons: coupons.map((c) => ({
        id: c.id,
        code: c.code,
        value: Number(c.value ?? 0),
        kind: c.kind,
        endsAt: c.endsAt ? new Date(c.endsAt).toISOString() : null,
        active: c.active !== false,
        usedCount: Number(c.usedCount ?? 0),
        sourceOrderId: c.sourceRef ?? null,
        sourceOrderNumber: c.sourceRef ? (numberById.get(String(c.sourceRef)) ?? null) : null,
        createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : null,
      })),
    };
  }

  async getCustomerLoyalty(orgId: string, customerId: string): Promise<any> {
    const customer = await this.t("customer")
      .findFirst({ where: { id: customerId, organizationId: orgId } })
      .catch(() => null);
    if (!customer) throw notFound("commerce.customerNotFound");
    const setting = await this.loadLoyaltySetting(orgId);
    const balance = Number(customer.loyaltyBalanceCache ?? 0);
    const entries: any[] =
      (await this.t("loyaltyLedger")
        .findMany({
          where: { organizationId: orgId, customerId },
          orderBy: [{ createdAt: "desc" }],
          take: 50,
        })
        .catch(() => [])) ?? [];
    const rewards = await this.referralRewardsFor(orgId, customerId);
    return {
      customerId,
      enabled: setting?.enabled === true,
      balance,
      redeemValueMinorPerPoint: Number(setting?.redeemValueMinorPerPoint ?? 100),
      balanceValueMinor:
        balance > 0 ? balance * Number(setting?.redeemValueMinorPerPoint ?? 100) : 0,
      entries: await this.withOrderNumbers(orgId, entries.map((e) => this.serializeEntry(e))),
      referralRewards: rewards,
    };
  }

  async getOrderLoyalty(orgId: string, orderId: string): Promise<any> {
    const order = await this.t("order")
      .findFirst({ where: { id: orderId, organizationId: orgId } })
      .catch(() => null);
    if (!order) throw notFound("commerce.orderNotFound");
    const entries: any[] =
      (await this.t("loyaltyLedger")
        .findMany({
          where: { organizationId: orgId, orderId },
          orderBy: [{ createdAt: "asc" }],
        })
        .catch(() => [])) ?? [];
    const serialized = entries.map((e) => this.serializeEntry(e));
    const sum = (pred: (e: any) => boolean) =>
      serialized.filter(pred).reduce((s, e) => s + e.deltaPoints, 0);
    return {
      orderId,
      entries: serialized,
      totals: {
        earned: sum((e) => e.reason === "earn"),
        redeemed: -sum((e) => e.reason === "redeem"),
        referralReward: sum((e) => e.reason === "referral_reward"),
        clawedBack: -sum((e) => e.reason === "adjust" && e.deltaPoints < 0),
      },
    };
  }

  /** Staff manual correction — guarded + audited at the
   * controller; a note is mandatory so every adjust explains
   * itself in the ledger. May drive the balance negative
   * (corrections must be able to remove wrongly-granted points
   * even after they were spent). */
  async adjustPoints(
    orgId: string,
    actorId: string,
    customerId: string,
    dto: { deltaPoints?: number; note?: string },
  ): Promise<any> {
    const customer = await this.t("customer")
      .findFirst({ where: { id: customerId, organizationId: orgId } })
      .catch(() => null);
    if (!customer) throw notFound("commerce.customerNotFound");
    const delta: number | undefined = dto?.deltaPoints;
    if (delta === undefined || !Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1000000) {
      throw badRequest("commerce.pointsAmountInvalid");
    }
    const note = String(dto?.note ?? "").trim();
    if (!note) throw badRequest("commerce.adjustmentReasonMandatory");
    const entry = await (this.prisma as any).$transaction(async (tx: any) => {
      if (delta < 0) await this.consumeLotsTx(tx, orgId, customerId, -Number(delta));
      const balanceAfter = await this.applyDeltaTx(tx, customerId, Number(delta));
      return this.createEntryTx(tx, {
        organizationId: orgId,
        customerId,
        deltaPoints: Number(delta),
        reason: "adjust",
        orderId: null,
        balanceAfter,
        expiresAt: null,
        remainingPoints: delta > 0 ? Number(delta) : null,
        createdById: actorId,
        note,
      });
    });
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "loyalty.points_adjusted",
      entityType: "Customer", entityId: customerId,
      metadata: { deltaPoints: Number(delta) },
    });
    return { entry: this.serializeEntry(entry), balance: Number(entry.balanceAfter ?? 0) };
  }

  /**
   * The shop-account payload (EC25 session already resolved by
   * ShopAccountService): balance + value, recent history, and
   * the customer's referral rewards. The referral CODE itself is
   * resolved by the caller (PromotionsService owns code
   * generation) and merged into the response there.
   */
  async accountLoyalty(orgId: string, customer: any): Promise<any> {
    const setting = await this.loadLoyaltySetting(orgId);
    const enabled = setting?.enabled === true;
    const balance = Number(customer?.loyaltyBalanceCache ?? 0);
    const entries: any[] =
      (await this.t("loyaltyLedger")
        .findMany({
          where: { organizationId: orgId, customerId: String(customer.id) },
          orderBy: [{ createdAt: "desc" }],
          take: 50,
        })
        .catch(() => [])) ?? [];
    const rewards = await this.referralRewardsFor(orgId, String(customer.id));
    return {
      enabled,
      balance,
      redeemValueMinorPerPoint: Number(setting?.redeemValueMinorPerPoint ?? 100),
      balanceValueMinor:
        balance > 0 ? balance * Number(setting?.redeemValueMinorPerPoint ?? 100) : 0,
      entries: await this.withOrderNumbers(orgId, entries.map((e) => this.serializeEntry(e))),
      referralRewards: rewards,
    };
  }
}
