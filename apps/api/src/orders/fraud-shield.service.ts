import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EventsService } from "../common/events.service";
import { RiskService } from "./risk.service";
import { OrderInsightsService } from "./order-insights.service";
import { BlockedPhoneService } from "../fraud/blocked-phone.service";
import { bdPhoneMatchKey } from "./phone-utils";
import { namesMateriallyDifferent, scoreFraud } from "./fraud-score";

/**
 * ON4 — Fraud Shield v2 service: persisted per-order risk
 * assessment, review holds, COD call bookkeeping, org fraud
 * settings and (delegated) blocklist management.
 *
 * Failure discipline: assessOrder NEVER throws — a fraud
 * failure must never break order creation / checkout /
 * booking. The assessment runs off the "order.ingested"
 * domain event (emitted by integrations / inbox outside the
 * 24h workflow guard) and on staff demand (reassess).
 */

export const FRAUD_SETTING_DEFAULTS = {
  enabled: true,
  autoHoldEnabled: false,
  autoHoldBand: "high",
  highValueMinor: 500000n,
  burstCount: 3,
  burstWindowHours: 24,
} as const;

const COD_CALL_OUTCOMES = ["confirmed", "rejected", "unreachable", "callback_requested"] as const;
const BAND_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };
const RETURNED_RETURN_STATUSES = ["received", "restocked", "refunded"];
const MONEY_FIELDS = [
  "subtotalMinor", "shippingMinor", "discountMinor", "taxMinor", "totalMinor",
  "refundedMinor", "promotionDiscountMinor", "referralDiscountMinor", "giftWrapMinor",
];

export function stringifyOrderMoney(row: any): any {
  if (!row || typeof row !== "object") return row;
  const out: any = { ...row };
  for (const key of Object.keys(out)) {
    if (typeof out[key] === "bigint") out[key] = out[key].toString();
  }
  return out;
}

function displayName(customer: any): string {
  if (!customer) return "";
  return [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();
}

/** EC33 sold predicate — mirrors order-insights.isSoldOrder. */
function isSoldOrder(order: any, shipmentStatuses: string[]): boolean {
  const status = String(order?.status ?? "");
  if (["cancelled", "refunded", "failed"].includes(status)) return false;
  if (status === "completed" || status === "delivered") return true;
  return shipmentStatuses.some((s) => ["delivered", "partial_delivered"].includes(String(s)));
}

@Injectable()
export class FraudShieldService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly risk?: RiskService,
    @Optional() private readonly blockedPhones?: BlockedPhoneService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly events?: EventsService,
    @Optional() private readonly insights?: OrderInsightsService,
  ) {
    // Mirror the ConversionsService subscription pattern: the
    // handler is fire-and-forget and assessOrder never throws.
    try {
      this.events?.on("order.ingested", (p: any) => {
        void this.assessOrder(p?.organizationId, p?.context?.orderId).catch(() => undefined);
      });
    } catch { /* events are best-effort */ }
  }

  // ---------- settings ----------

  private settingsPublic(row: any) {
    return {
      enabled: row.enabled !== false,
      autoHoldEnabled: row.autoHoldEnabled === true,
      autoHoldBand: row.autoHoldBand ?? "high",
      highValueMinor: (() => { try { return BigInt(row.highValueMinor ?? 500000).toString(); } catch { return "500000"; } })(),
      burstCount: row.burstCount ?? 3,
      burstWindowHours: row.burstWindowHours ?? 24,
    };
  }

  /** Raw settings row (get-or-create); on ANY error the in-code
   * defaults object — assessment must never die on settings. */
  private async loadSettingsRow(orgId: string): Promise<any> {
    try {
      const table = (this.prisma as any).fraudShieldSetting;
      if (!table) return { ...FRAUD_SETTING_DEFAULTS };
      let row = null;
      if (table.findUnique) row = await table.findUnique({ where: { organizationId: orgId } }).catch(() => null);
      if (!row && table.findFirst) row = await table.findFirst({ where: { organizationId: orgId } }).catch(() => null);
      if (row) return row;
      if (table.create) {
        const created = await table.create({
          data: {
            organizationId: orgId,
            enabled: FRAUD_SETTING_DEFAULTS.enabled,
            autoHoldEnabled: FRAUD_SETTING_DEFAULTS.autoHoldEnabled,
            autoHoldBand: FRAUD_SETTING_DEFAULTS.autoHoldBand,
            highValueMinor: FRAUD_SETTING_DEFAULTS.highValueMinor,
            burstCount: FRAUD_SETTING_DEFAULTS.burstCount,
            burstWindowHours: FRAUD_SETTING_DEFAULTS.burstWindowHours,
          },
        }).catch(() => null);
        if (created) return created;
      }
      return { ...FRAUD_SETTING_DEFAULTS };
    } catch {
      return { ...FRAUD_SETTING_DEFAULTS };
    }
  }

  async getSettings(orgId: string) {
    const row = await this.loadSettingsRow(orgId);
    return this.settingsPublic(row);
  }

  async updateSettings(orgId: string, actorId: string, dto: any) {
    const data: Record<string, unknown> = {};
    if (dto?.autoHoldBand !== undefined) {
      if (!["medium", "high"].includes(String(dto.autoHoldBand))) {
        throw new BadRequestException("autoHoldBand হতে হবে medium অথবা high");
      }
      data.autoHoldBand = String(dto.autoHoldBand);
    }
    if (dto?.highValueMinor !== undefined) {
      const raw = String(dto.highValueMinor);
      if (!/^\d+$/.test(raw)) {
        throw new BadRequestException("highValueMinor সঠিক সংখ্যায় পাঠান (পয়সায়)");
      }
      data.highValueMinor = BigInt(raw);
    }
    if (dto?.burstCount !== undefined) {
      const v = Number(dto.burstCount);
      if (!Number.isInteger(v) || v < 1 || v > 50) {
        throw new BadRequestException("burstCount ১–৫০ এর মধ্যে পূর্ণসংখ্যা হতে হবে");
      }
      data.burstCount = v;
    }
    if (dto?.burstWindowHours !== undefined) {
      const v = Number(dto.burstWindowHours);
      if (!Number.isInteger(v) || v < 1 || v > 720) {
        throw new BadRequestException("burstWindowHours ১–৭২০ এর মধ্যে পূর্ণসংখ্যা হতে হবে");
      }
      data.burstWindowHours = v;
    }
    if (dto?.enabled !== undefined) {
      if (typeof dto.enabled !== "boolean") throw new BadRequestException("enabled boolean হতে হবে");
      data.enabled = dto.enabled;
    }
    if (dto?.autoHoldEnabled !== undefined) {
      if (typeof dto.autoHoldEnabled !== "boolean") throw new BadRequestException("autoHoldEnabled boolean হতে হবে");
      data.autoHoldEnabled = dto.autoHoldEnabled;
    }

    const current = await this.loadSettingsRow(orgId);
    const changedKeys = Object.keys(data).filter((k) => {
      const before = (current as any)?.[k];
      const after = (data as any)[k];
      return String(before ?? "") !== String(after ?? "");
    });

    const table = (this.prisma as any).fraudShieldSetting;
    let row: any = current;
    if (table) {
      const hasRow = Boolean(current?.id);
      if (hasRow && table.update) {
        row = await table.update({ where: { id: current.id }, data }).catch(() => current);
      } else if (table.upsert) {
        row = await table.upsert({
          where: { organizationId: orgId },
          create: { organizationId: orgId, ...FRAUD_SETTING_DEFAULTS, ...data },
          update: data,
        }).catch(() => ({ ...current, ...data }));
      } else if (table.create) {
        row = await table.create({ data: { organizationId: orgId, ...FRAUD_SETTING_DEFAULTS, ...data } }).catch(() => ({ ...current, ...data }));
      } else {
        row = { ...current, ...data };
      }
    } else {
      row = { ...current, ...data };
    }

    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "orders.fraud_settings_updated",
      entityType: "FraudShieldSetting", entityId: row?.id ?? orgId, metadata: { changedKeys },
    }).catch(() => undefined);
    return this.settingsPublic(row ?? { ...FRAUD_SETTING_DEFAULTS, ...data });
  }

  // ---------- blocklist delegation (controller stays thin) ----------

  blockList(orgId: string) {
    if (!this.blockedPhones) return Promise.resolve([]);
    return this.blockedPhones.list(orgId);
  }

  blockAdd(orgId: string, actorId: string, dto: { phone?: string; reason?: string }) {
    if (!this.blockedPhones) throw new BadRequestException("ব্লকলিস্ট সুবিধাটি এই ডিপ্লয়মেন্টে নেই");
    return this.blockedPhones.add(orgId, actorId, dto);
  }

  blockRemove(orgId: string, actorId: string, id: string) {
    if (!this.blockedPhones) throw new BadRequestException("ব্লকলিস্ট সুবিধাটি এই ডিপ্লয়মেন্টে নেই");
    return this.blockedPhones.remove(orgId, actorId, id);
  }

  // ---------- phone resolution ----------

  /** customer phone → first shipment recipientPhone →
   * conversation contactPhone (mirrors RiskService's order). */
  async resolveOrderPhone(orgId: string, order: any): Promise<string | null> {
    try {
      let customer = order?.customer ?? null;
      if (!customer?.phone && order?.customerId) {
        customer = await (this.prisma as any).customer?.findFirst({
          where: { id: order.customerId, organizationId: orgId },
        }).catch(() => null);
      }
      if (customer?.phone) return String(customer.phone);
    } catch { /* fall through */ }
    try {
      const shipments = await (this.prisma as any).courierShipment?.findMany({
        where: { organizationId: orgId, orderId: order.id },
      }).catch(() => []);
      const phone = (shipments ?? []).map((s: any) => s.recipientPhone).find(Boolean);
      if (phone) return String(phone);
    } catch { /* fall through */ }
    try {
      if (order?.conversationId) {
        const conv = await (this.prisma as any).channelConversation?.findFirst({
          where: { id: order.conversationId, organizationId: orgId },
        }).catch(() => null);
        if (conv?.contactPhone) return String(conv.contactPhone);
      }
    } catch { /* fall through */ }
    return null;
  }

  // ---------- assessment ----------

  private async loadOrder(orgId: string, orderId: string): Promise<any | null> {
    try {
      return await (this.prisma as any).order.findFirst({
        where: { id: orderId, organizationId: orgId },
        include: { customer: true },
      });
    } catch {
      return null;
    }
  }

  /** Bad-outcome + reliability figures: prefer Customer-360,
   * else compute the same counts directly (mirror definitions:
   * cancelled = status "cancelled"; returned = status
   * "returned" OR a ReturnRequest in received/restocked/
   * refunded; delivered = the EC33 sold bucket). */
  private async outcomeStats(orgId: string, order: any): Promise<{
    badOutcomeCount: number; reliabilityPercent: number | null; reliabilityDecided: number;
  }> {
    if (this.insights?.customer360) {
      try {
        const c360: any = await this.insights.customer360(orgId, order.id);
        if (c360 && c360.customer) {
          const delivered = Number(c360.deliveredCount ?? 0);
          const cancelled = Number(c360.cancelledCount ?? 0);
          const returned = Number(c360.returnedCount ?? 0);
          return {
            badOutcomeCount: cancelled + returned,
            reliabilityPercent: c360.reliabilityPercent ?? null,
            reliabilityDecided: delivered + cancelled + returned,
          };
        }
        if (c360 && !order.customerId) {
          return { badOutcomeCount: 0, reliabilityPercent: null, reliabilityDecided: 0 };
        }
      } catch { /* fall back to the direct computation */ }
    }
    try {
      if (!order.customerId) return { badOutcomeCount: 0, reliabilityPercent: null, reliabilityDecided: 0 };
      const orders: any[] = ((await (this.prisma as any).order.findMany({
        where: { organizationId: orgId, customerId: order.customerId },
      }).catch(() => [])) ?? []);
      const ids = orders.map((o: any) => String(o.id));
      const shipments: any[] = ids.length
        ? (((await (this.prisma as any).courierShipment?.findMany({
            where: { organizationId: orgId, orderId: { in: ids } },
          }).catch(() => [])) ?? []))
        : [];
      const statusesByOrder = new Map<string, string[]>();
      for (const s of shipments) {
        const list = statusesByOrder.get(String(s.orderId)) ?? [];
        list.push(String(s.status));
        statusesByOrder.set(String(s.orderId), list);
      }
      const returns: any[] = ((await (this.prisma as any).returnRequest?.findMany({
        where: { organizationId: orgId, customerId: order.customerId },
      }).catch(() => [])) ?? []);
      const returnedOrderIds = new Set(
        returns
          .filter((r: any) => RETURNED_RETURN_STATUSES.includes(String(r.status)))
          .map((r: any) => String(r.orderId)),
      );
      let cancelled = 0;
      let returned = 0;
      let delivered = 0;
      for (const o of orders) {
        if (o.status === "cancelled") cancelled += 1;
        if (o.status === "returned" || returnedOrderIds.has(String(o.id))) returned += 1;
        if (isSoldOrder(o, statusesByOrder.get(String(o.id)) ?? [])) delivered += 1;
      }
      const decided = delivered + cancelled + returned;
      return {
        badOutcomeCount: cancelled + returned,
        reliabilityPercent: decided === 0 ? null : Math.round((delivered / decided) * 1000) / 10,
        reliabilityDecided: decided,
      };
    } catch {
      return { badOutcomeCount: 0, reliabilityPercent: null, reliabilityDecided: 0 };
    }
  }

  /** NEVER throws. Returns the assessment, or null when the
   * shield is disabled / the order is missing / anything failed. */
  async assessOrder(orgId: string, orderId: string): Promise<{
    score: number; band: string; reasons: any[]; reviewHold: boolean;
  } | null> {
    try {
      if (!orgId || !orderId) return null;
      const settings = await this.loadSettingsRow(orgId);
      if (settings.enabled === false) return null;

      const order = await this.loadOrder(orgId, orderId);
      if (!order) return null;

      const phone = await this.resolveOrderPhone(orgId, order);
      let blocked = false;
      if (this.blockedPhones && phone) {
        blocked = await this.blockedPhones.isBlocked(orgId, phone).catch(() => false);
      }

      let historyBand: string | null = null;
      let historyScore: number | null = null;
      if (this.risk) {
        try {
          const r: any = await this.risk.forOrder(orgId, order);
          if (r) {
            historyBand = r.band ?? null;
            historyScore = r.score ?? null;
          }
        } catch { /* signal simply does not fire */ }
      }

      const outcomes = await this.outcomeStats(orgId, order);

      // Burst / prior count / name mismatch over ONE bounded load.
      let burstCount = 0;
      let priorOrderCount = 0;
      let nameMismatch = false;
      let mismatchedName: string | null = null;
      try {
        const rows: any[] = ((await (this.prisma as any).order.findMany({
          where: { organizationId: orgId },
          orderBy: { createdAt: "desc" },
          take: 5000,
          include: { customer: true },
        }).catch(() => [])) ?? []);
        const targetKey = phone ? bdPhoneMatchKey(phone) : null;
        const pool = rows.filter((r: any) => String(r.id) !== String(order.id) && r.isPractice !== true);
        const population = targetKey
          ? pool.filter((r: any) => {
              const key = bdPhoneMatchKey(r.customer?.phone ?? null);
              return key !== null && key === targetKey;
            })
          : [];
        const cutoff = Date.now() - Number(settings.burstWindowHours ?? 24) * 3600 * 1000;
        burstCount = population.filter((r: any) => {
          const t = new Date(r.createdAt ?? 0).getTime();
          return !Number.isNaN(t) && t >= cutoff;
        }).length;
        priorOrderCount = order.customerId
          ? pool.filter((r: any) => r.customerId === order.customerId).length
          : population.length;
        const targetName = displayName(order.customer);
        if (targetName) {
          for (const r of population) {
            const other = displayName(r.customer);
            if (other && namesMateriallyDifferent(other, targetName)) {
              nameMismatch = true;
              mismatchedName = other;
              break;
            }
          }
        }
      } catch { /* signals degrade to zero */ }

      let totalMinor = 0n;
      try { totalMinor = BigInt(order.totalMinor ?? 0); } catch { totalMinor = 0n; }
      let highValueMinor = 500000n;
      try { highValueMinor = BigInt(settings.highValueMinor ?? 500000); } catch { highValueMinor = 500000n; }

      const result = scoreFraud({
        burstCount,
        burstThreshold: Number(settings.burstCount ?? 3),
        burstWindowHours: Number(settings.burstWindowHours ?? 24),
        historyBand,
        historyScore,
        badOutcomeCount: outcomes.badOutcomeCount,
        reliabilityPercent: outcomes.reliabilityPercent,
        reliabilityDecided: outcomes.reliabilityDecided,
        priorOrderCount,
        totalMinor,
        highValueMinor,
        nameMismatch,
        mismatchedName,
        blocked,
      });

      const now = new Date();
      const data: Record<string, unknown> = {
        riskScore: result.score,
        riskBand: result.band,
        riskReasons: result.reasons,
        riskAssessedAt: now,
      };
      const alreadyHeld = order.reviewHold === true;
      let holdNow = false;
      let holdReason: string | null = null;
      if (blocked) {
        holdNow = true;
        holdReason = "ব্লকলিস্টে থাকা ফোন নম্বর থেকে অর্ডার";
      } else if (
        settings.autoHoldEnabled === true &&
        (BAND_RANK[result.band] ?? 0) >= (BAND_RANK[String(settings.autoHoldBand ?? "high")] ?? 2)
      ) {
        const top = [...result.reasons].sort((a, b) => b.points - a.points)[0];
        holdNow = true;
        holdReason = `স্বয়ংক্রিয়: ${top?.label ?? ""}`;
      }
      // Never CLEAR an existing hold during assessment; a held
      // order keeps its original reason untouched.
      if (holdNow && !alreadyHeld) {
        data.reviewHold = true;
        data.reviewHoldReason = holdReason;
        data.reviewHeldAt = now;
      }
      await (this.prisma as any).order.update({ where: { id: order.id }, data }).catch(() => undefined);
      return { score: result.score, band: result.band, reasons: result.reasons, reviewHold: alreadyHeld || holdNow };
    } catch {
      return null;
    }
  }

  async reassess(orgId: string, actorId: string, orderId: string) {
    const order = await this.loadOrder(orgId, orderId);
    if (!order) throw new NotFoundException("Order not found in this organization");
    const assessment = await this.assessOrder(orgId, orderId);
    const fresh = await this.loadOrder(orgId, orderId);
    if (assessment) {
      await this.audit?.log({
        organizationId: orgId, userId: actorId, action: "orders.risk_reassessed",
        entityType: "Order", entityId: orderId,
        metadata: { score: assessment.score, band: assessment.band },
      }).catch(() => undefined);
    }
    return {
      score: assessment?.score ?? fresh?.riskScore ?? null,
      band: assessment?.band ?? fresh?.riskBand ?? null,
      reasons: assessment?.reasons ?? fresh?.riskReasons ?? null,
      reviewHold: fresh?.reviewHold ?? assessment?.reviewHold ?? false,
      order: fresh ? stringifyOrderMoney(fresh) : null,
    };
  }

  // ---------- review hold ----------

  async hold(orgId: string, actorId: string, orderId: string, reasonRaw: unknown) {
    const reason = String(reasonRaw ?? "").trim();
    if (reason.length < 1 || reason.length > 300) {
      throw new BadRequestException("আটকানোর কারণ ১–৩০০ অক্ষরের হতে হবে");
    }
    const order = await this.loadOrder(orgId, orderId);
    if (!order) throw new NotFoundException("Order not found in this organization");
    const updated = await (this.prisma as any).order.update({
      where: { id: order.id },
      data: { reviewHold: true, reviewHoldReason: reason, reviewHeldAt: new Date() },
    });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "orders.review_hold_set",
      entityType: "Order", entityId: orderId, metadata: {},
    }).catch(() => undefined);
    return stringifyOrderMoney(updated);
  }

  async release(orgId: string, actorId: string, orderId: string) {
    const order = await this.loadOrder(orgId, orderId);
    if (!order) throw new NotFoundException("Order not found in this organization");
    const updated = await (this.prisma as any).order.update({
      where: { id: order.id },
      data: { reviewHold: false, reviewHoldReason: null, reviewHeldAt: null },
    });
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "orders.review_hold_released",
      entityType: "Order", entityId: orderId, metadata: {},
    }).catch(() => undefined);
    return stringifyOrderMoney(updated);
  }

  // ---------- COD call worklist ----------

  async recordCodCall(orgId: string, actorId: string, orderId: string, outcomeRaw: unknown) {
    const outcome = String(outcomeRaw ?? "");
    if (!(COD_CALL_OUTCOMES as readonly string[]).includes(outcome)) {
      throw new BadRequestException("কলের ফলাফল সঠিক নয় — confirmed, rejected, unreachable অথবা callback_requested পাঠান");
    }
    const order = await this.loadOrder(orgId, orderId);
    if (!order) throw new NotFoundException("Order not found in this organization");
    if (!order.isCod) throw new BadRequestException("এটি COD অর্ডার নয়");
    if (!["pending", "on-hold", "processing"].includes(String(order.status))) {
      throw new BadRequestException(`এই অবস্থায় ("${order.status}") COD কল রেকর্ড করা যায় না`);
    }
    const attempts = Number(order.codCallAttempts ?? 0) + 1;
    const data: Record<string, unknown> = {
      codCallAttempts: attempts,
      codLastCallAt: new Date(),
      codLastCallOutcome: outcome,
    };
    // "rejected" maps onto the existing verdict vocabulary:
    // codConfirmationStatus is confirmed | declined (parseCodReply).
    if (outcome === "confirmed") data.codConfirmationStatus = "confirmed";
    if (outcome === "rejected") data.codConfirmationStatus = "declined";
    const updated = await (this.prisma as any).order.update({ where: { id: order.id }, data });
    if (outcome === "confirmed") {
      try {
        this.events?.emit("order.cod_confirmed", { organizationId: orgId, context: { orderId } });
      } catch { /* conversion hooks never block the call record */ }
    }
    await this.audit?.log({
      organizationId: orgId, userId: actorId, action: "orders.cod_call_recorded",
      entityType: "Order", entityId: orderId, metadata: { outcome, attempts },
    }).catch(() => undefined);
    return {
      order: stringifyOrderMoney(updated),
      codConfirmationStatus: (updated as any)?.codConfirmationStatus ?? (data.codConfirmationStatus as string | undefined) ?? order.codConfirmationStatus ?? null,
    };
  }
}
