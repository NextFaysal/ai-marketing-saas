import {
  Injectable,
  Logger,
  Optional,
} from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import { assertPayoutAutomationAllowed } from "../connections/payout-legal-gate";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { EventsService } from "../common/events.service";
import { phoneKeyLoose } from "../commerce/promotions";
import type {
  CreateAffiliatePartnerDto,
  RecordAffiliatePayoutDto,
  UpdateAffiliatePartnerDto,
} from "./affiliates.dto";
import { badRequest, notFound } from "../i18n/api-exception";

/**
 * EC32 — Affiliate Program.
 *
 * A merchant runs a partner program on top of the native
 * storefront: each AffiliatePartner has a shareable code
 * (`/shop/<slug>?ref=<code>`). A code presented at checkout is
 * resolved server-side and STAMPED on the order
 * (affiliatePartnerId + affiliateCode) — no discount is given to
 * the buyer (that is EC16's separate customer-referral feature).
 * When the order reaches the codebase's SOLD bucket, exactly one
 * CommissionEntry is created: base = subtotalMinor −
 * discountMinor (delivery + tax are never part of the base),
 * commission = round-half-up(base × partner percent / 100), with
 * the percent snapshotted onto the entry.
 *
 * Staff approve entries (pending → approved) and record payouts
 * the merchant made OUTSIDE the system (bKash/Nagad/bank/cash by
 * hand). A payout is a BOOKKEEPING RECORD ONLY — no code here
 * sends money or may claim it did. Recording a payout flips
 * approved entries to paid in FIFO order (oldest first) up to the
 * cumulative payout coverage.
 *
 * Voiding: an order cancelled/refunded (status change) or fully
 * refunded (order.refunded with cumulative >= total) voids its
 * pending/approved entries. Paid entries are NEVER auto-voided —
 * the money may already be with the partner; the partner detail
 * surfaces a paid-on-refunded-orders count instead. Partial
 * refunds do not pro-rate (v1, documented).
 *
 * Every checkout/event path is failure-isolated: attribution and
 * commission problems are logged, never thrown into a checkout
 * response or an order transition.
 */

/** Same alphabet as PromotionsService.ensureCustomerReferralCode
 * (EC16) — no easily-confused characters. */
const AFFILIATE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PARTNER_STATUSES = ["active", "paused"] as const;
const PAYOUT_METHODS = ["bkash", "nagad", "bank", "cash", "other"] as const;

/* EC33 sold definition — copied constants/logic from
 * purchasing/inventory-intelligence.service.ts isSoldOrder:
 * dead states never count as sold; status completed|delivered
 * counts; otherwise a CourierShipment in delivered|
 * partial_delivered counts. */
const DEAD_ORDER_STATUSES = ["cancelled", "refunded", "failed"];
const DELIVERED_SHIPMENT_STATUSES = ["delivered", "partial_delivered"];

function toBig(v: unknown): bigint {
  try {
    return BigInt(v as any);
  } catch {
    return 0n;
  }
}

function normalizeCode(code: unknown): string {
  return String(code ?? "").trim().toUpperCase();
}

@Injectable()
export class AffiliatesService {
  private readonly logger = new Logger(AffiliatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly events?: EventsService,
  ) {
    if (this.events) {
      this.events.on("order.delivered", (p) => {
        void this.maybeCreateCommission(p?.organizationId, p?.context?.orderId);
      });
      this.events.on("order.status_changed", (p) => {
        const to = String(p?.context?.to ?? "").toLowerCase();
        if (to === "cancelled" || to === "refunded") {
          void this.maybeVoidForOrder(p?.organizationId, p?.context?.orderId, `order_${to}`);
        }
      });
      this.events.on("order.refunded", (p) => {
        void this.maybeVoidForFullRefund(
          p?.organizationId,
          p?.context?.orderId,
          p?.context?.cumulativeRefundedMinor,
        );
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

  // ================= Partners =================

  private validatePercent(percent: unknown): number {
    if (
      typeof percent !== "number" ||
      !Number.isInteger(percent) ||
      percent < 0 ||
      percent > 50
    ) {
      throw badRequest("affiliates.theCommissionRateMustBeAn");
    }
    return percent;
  }

  private generateCode(): string {
    const bytes = randomBytes(6);
    let suffix = "";
    for (let i = 0; i < 6; i++) {
      suffix += AFFILIATE_CODE_ALPHABET[bytes[i] % AFFILIATE_CODE_ALPHABET.length];
    }
    return `AFF${suffix}`;
  }

  private async assertCodeFree(orgId: string, code: string, exceptPartnerId?: string): Promise<void> {
    const clash = await this.t("affiliatePartner")
      .findFirst({ where: { organizationId: orgId, code } })
      .catch(() => null);
    if (clash && String(clash.id) !== String(exceptPartnerId ?? "")) {
      throw badRequest("affiliates.thisAffiliateCodeIsAlreadyUsed", { code: code });
    }
  }

  private async getPartnerOr404(orgId: string, partnerId: string): Promise<any> {
    const partner = await this.t("affiliatePartner")
      .findFirst({ where: { id: partnerId, organizationId: orgId } })
      .catch(() => null);
    if (!partner) throw notFound("affiliates.affiliatePartnerNotFoundInThis");
    return partner;
  }

  private serializePartner(partner: any) {
    return {
      id: partner.id,
      organizationId: partner.organizationId,
      name: partner.name,
      phone: partner.phone,
      email: partner.email ?? null,
      code: partner.code,
      commissionPercent: partner.commissionPercent,
      status: partner.status ?? "active",
      note: partner.note ?? null,
      createdAt: partner.createdAt ? new Date(partner.createdAt).toISOString() : null,
      updatedAt: partner.updatedAt ? new Date(partner.updatedAt).toISOString() : null,
    };
  }

  /** Per-partner aggregates computed in service from real rows:
   * entry counts + commission sums by status, and the payouts
   * total. String minor units, like every other money surface. */
  private async partnerAggregates(orgId: string, partnerId: string) {
    const entries: any[] =
      (await this.t("commissionEntry")
        .findMany({ where: { organizationId: orgId, partnerId } })
        .catch(() => [])) ?? [];
    const payouts: any[] =
      (await this.t("affiliatePayout")
        .findMany({ where: { organizationId: orgId, partnerId } })
        .catch(() => [])) ?? [];
    const byStatus = (status: string) => {
      const rows = entries.filter((e) => e.status === status);
      return {
        count: rows.length,
        commissionMinor: rows.reduce((s, e) => s + toBig(e.commissionMinor), 0n).toString(),
      };
    };
    return {
      entries: {
        total: entries.length,
        pending: byStatus("pending"),
        approved: byStatus("approved"),
        paid: byStatus("paid"),
        voided: byStatus("voided"),
      },
      payoutsTotalMinor: payouts
        .reduce((s, p) => s + toBig(p.amountMinor), 0n)
        .toString(),
      payoutsCount: payouts.length,
    };
  }

  private async partnerWithAggregates(orgId: string, partner: any) {
    return {
      ...this.serializePartner(partner),
      aggregates: await this.partnerAggregates(orgId, partner.id),
    };
  }

  async createPartner(orgId: string, actorId: string, dto: CreateAffiliatePartnerDto) {
    const name = String(dto.name ?? "").trim();
    const phone = String(dto.phone ?? "").trim();
    if (!name) throw badRequest("affiliates.thePartnerNameIsRequired");
    if (!phone) throw badRequest("affiliates.thePartnerPhoneNumberIsRequired");

    let code = dto.code ? normalizeCode(dto.code) : "";
    if (code) {
      await this.assertCodeFree(orgId, code);
    } else {
      // Generated code: retry a few times on the (unlikely) clash.
      for (let attempt = 0; attempt < 5 && !code; attempt++) {
        const candidate = this.generateCode();
        const clash = await this.t("affiliatePartner")
          .findFirst({ where: { organizationId: orgId, code: candidate } })
          .catch(() => null);
        if (!clash) code = candidate;
      }
      if (!code) throw badRequest("affiliates.theAffiliateCodeCouldNotBe");
    }

    let percent: number;
    if (dto.commissionPercent !== undefined && dto.commissionPercent !== null) {
      percent = this.validatePercent(dto.commissionPercent);
    } else {
      const setting = await this.t("storefrontSetting")
        .findFirst({ where: { organizationId: orgId } })
        .catch(() => null);
      percent = this.validatePercent(setting?.affiliateDefaultPercent ?? 10);
    }
    const status = dto.status ?? "active";
    if (!(PARTNER_STATUSES as readonly string[]).includes(status)) {
      throw badRequest("affiliates.thePartnerStatusMustBeActive");
    }

    const partner = await this.t("affiliatePartner").create({
      data: {
        organizationId: orgId,
        name,
        phone,
        email: dto.email?.trim() || null,
        code,
        commissionPercent: percent,
        status,
        note: dto.note?.trim() || null,
      },
    });
    await this.safeAudit({
      organizationId: orgId,
      userId: actorId,
      action: "affiliates.partner_created",
      entityType: "AffiliatePartner",
      entityId: partner.id,
      metadata: { code: partner.code, commissionPercent: percent },
    });
    return this.partnerWithAggregates(orgId, partner);
  }

  async listPartners(orgId: string) {
    const rows: any[] =
      (await this.t("affiliatePartner")
        .findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "desc" } })
        .catch(() => [])) ?? [];
    const items = [];
    for (const partner of rows) items.push(await this.partnerWithAggregates(orgId, partner));
    return { total: items.length, items };
  }

  async getPartner(orgId: string, partnerId: string) {
    const partner = await this.getPartnerOr404(orgId, partnerId);
    return this.partnerWithAggregates(orgId, partner);
  }

  async updatePartner(
    orgId: string,
    actorId: string,
    partnerId: string,
    dto: UpdateAffiliatePartnerDto,
  ) {
    const partner = await this.getPartnerOr404(orgId, partnerId);
    const data: Record<string, any> = {};
    if (dto.name !== undefined) {
      const name = String(dto.name ?? "").trim();
      if (!name) throw badRequest("affiliates.thePartnerNameIsRequired");
      data.name = name;
    }
    if (dto.phone !== undefined) {
      const phone = String(dto.phone ?? "").trim();
      if (!phone) throw badRequest("affiliates.thePartnerPhoneNumberIsRequired");
      data.phone = phone;
    }
    if (dto.email !== undefined) data.email = dto.email?.trim() || null;
    if (dto.code !== undefined) {
      const code = normalizeCode(dto.code);
      if (!code) throw badRequest("affiliates.theAffiliateCodeCannotBeEmpty");
      if (code !== partner.code) await this.assertCodeFree(orgId, code, partnerId);
      data.code = code;
    }
    if (dto.commissionPercent !== undefined && dto.commissionPercent !== null) {
      data.commissionPercent = this.validatePercent(dto.commissionPercent);
    }
    if (dto.status !== undefined) {
      if (!(PARTNER_STATUSES as readonly string[]).includes(dto.status)) {
        throw badRequest("affiliates.thePartnerStatusMustBeActive");
      }
      data.status = dto.status;
    }
    if (dto.note !== undefined) data.note = dto.note?.trim() || null;

    const saved =
      Object.keys(data).length > 0
        ? await this.t("affiliatePartner").update({ where: { id: partner.id }, data })
        : partner;
    await this.safeAudit({
      organizationId: orgId,
      userId: actorId,
      action: "affiliates.partner_updated",
      entityType: "AffiliatePartner",
      entityId: partner.id,
      metadata: { fields: Object.keys(data) },
    });
    return this.partnerWithAggregates(orgId, saved);
  }

  // ================= Attribution (checkout) =================

  /**
   * Resolve a presented affiliate code to a partner row, or null.
   * NEVER throws — checkout must never break on affiliate
   * problems. Rules: blank code → null; program disabled (or no
   * storefront setting) → null; unknown code → null; paused
   * partner → null; self-dealing (partner phone loosely equals
   * buyer phone) → null.
   */
  async resolveAttribution(
    orgId: string,
    presentedCode: string | null | undefined,
    buyerPhone: string | null | undefined,
  ): Promise<any | null> {
    try {
      const code = normalizeCode(presentedCode);
      if (!code) return null;
      const setting = await this.t("storefrontSetting")
        .findFirst({ where: { organizationId: orgId } })
        .catch(() => null);
      if (!setting || setting.affiliateEnabled !== true) return null;
      const partner = await this.t("affiliatePartner")
        .findFirst({ where: { organizationId: orgId, code } })
        .catch(() => null);
      if (!partner) return null;
      if (partner.status !== "active") return null;
      const buyerKey = phoneKeyLoose(buyerPhone);
      const partnerKey = phoneKeyLoose(partner.phone);
      if (buyerKey && partnerKey && buyerKey === partnerKey) return null;
      return partner;
    } catch (e) {
      this.logger.warn(
        `affiliate attribution resolution failed for org ${orgId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  /**
   * Stamp affiliate attribution onto a placed order (the EC16
   * stampOrder pattern). Failure-isolated: never throws.
   * affiliateCode keeps the code AS PRESENTED (trimmed); the
   * partner link is the source of truth for commission.
   */
  async stampAttribution(
    orgId: string,
    source: string,
    externalId: string,
    presentedCode: string | null | undefined,
    buyerPhone: string | null | undefined,
  ): Promise<void> {
    try {
      const presented = String(presentedCode ?? "").trim();
      if (!presented) return;
      const orderTable = this.t("order");
      const order = orderTable?.findFirst
        ? await orderTable.findFirst({ where: { organizationId: orgId, source, externalId } })
        : null;
      if (!order) return;
      const partner = await this.resolveAttribution(orgId, presented, buyerPhone);
      if (!partner) return;
      await orderTable.update({
        where: { id: order.id },
        data: { affiliatePartnerId: partner.id, affiliateCode: presented },
      });
    } catch (e) {
      this.logger.warn(
        `affiliate stamp failed for ${externalId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ================= Commission =================

  /** EC33 sold definition (see the constants note above). */
  private isSoldOrder(order: any, shipmentStatuses: string[]): boolean {
    const status = String(order?.status ?? "").toLowerCase();
    if (DEAD_ORDER_STATUSES.includes(status)) return false;
    if (status === "completed" || status === "delivered") return true;
    return shipmentStatuses.some((s) =>
      DELIVERED_SHIPMENT_STATUSES.includes(String(s).toLowerCase()),
    );
  }

  /**
   * Create the (single) commission entry for an attributed order
   * once it is SOLD. Exactly-once: an existing entry for the
   * order short-circuits, and CommissionEntry.orderId is UNIQUE
   * in the schema as a backstop. Failure-isolated: catches and
   * logs everything, returns the entry or null.
   */
  async maybeCreateCommission(orgId: string, orderId: string): Promise<any | null> {
    try {
      if (!orgId || !orderId) return null;
      const order = await this.t("order")
        .findFirst({ where: { id: orderId, organizationId: orgId } })
        .catch(() => null);
      if (!order) return null;
      if (!order.affiliatePartnerId) return null;

      const existing = await this.t("commissionEntry")
        .findFirst({ where: { orderId: order.id } })
        .catch(() => null);
      if (existing) return existing;

      const shipments: any[] =
        (await this.t("courierShipment")
          .findMany({ where: { organizationId: orgId, orderId: order.id } })
          .catch(() => [])) ?? [];
      if (!this.isSoldOrder(order, shipments.map((s) => String(s.status ?? "")))) {
        return null;
      }

      const base = toBig(order.subtotalMinor) - toBig(order.discountMinor);
      if (base <= 0n) return null; // no commission on a fully-discounted order

      const partner = await this.t("affiliatePartner")
        .findFirst({ where: { id: order.affiliatePartnerId, organizationId: orgId } })
        .catch(() => null);
      if (!partner) return null;
      const percent = partner.commissionPercent;
      if (typeof percent !== "number" || !Number.isInteger(percent) || percent < 0) return null;

      // Integer round-half-up for non-negative values.
      const commissionMinor = (base * BigInt(percent) + 50n) / 100n;
      const entry = await this.t("commissionEntry").create({
        data: {
          organizationId: orgId,
          partnerId: partner.id,
          orderId: order.id,
          baseMinor: base,
          percentSnapshot: percent,
          commissionMinor,
          status: "pending",
        },
      });
      return entry;
    } catch (e) {
      this.logger.warn(
        `affiliate commission creation failed for order ${orderId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  /**
   * Void the order's pending/approved entries. Paid entries are
   * NEVER touched (the partner detail flags them instead).
   * Failure-isolated; returns the number voided.
   */
  async maybeVoidForOrder(orgId: string, orderId: string, reason: string): Promise<number> {
    try {
      if (!orgId || !orderId) return 0;
      const entries: any[] =
        (await this.t("commissionEntry")
          .findMany({
            where: {
              organizationId: orgId,
              orderId,
              status: { in: ["pending", "approved"] },
            },
          })
          .catch(() => [])) ?? [];
      let voided = 0;
      for (const entry of entries) {
        if (entry.status !== "pending" && entry.status !== "approved") continue;
        await this.t("commissionEntry").update({
          where: { id: entry.id },
          data: { status: "voided", voidReason: reason },
        });
        voided++;
      }
      return voided;
    } catch (e) {
      this.logger.warn(
        `affiliate commission void failed for order ${orderId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return 0;
    }
  }

  /** order.refunded handler: void only on a FULL refund. */
  async maybeVoidForFullRefund(
    orgId: string,
    orderId: string,
    cumulativeRefundedMinor: unknown,
  ): Promise<number> {
    try {
      if (!orgId || !orderId) return 0;
      const order = await this.t("order")
        .findFirst({ where: { id: orderId, organizationId: orgId } })
        .catch(() => null);
      if (!order) return 0;
      const total = toBig(order.totalMinor);
      if (total <= 0n) return 0;
      const cumulative =
        cumulativeRefundedMinor !== undefined && cumulativeRefundedMinor !== null
          ? toBig(cumulativeRefundedMinor)
          : toBig(order.refundedMinor);
      if (cumulative < total) return 0; // partial refund: no void, no pro-rate (v1)
      return this.maybeVoidForOrder(orgId, orderId, "order_fully_refunded");
    } catch (e) {
      this.logger.warn(
        `affiliate full-refund void failed for order ${orderId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return 0;
    }
  }

  // ================= Entries (staff) =================

  private async serializeEntry(orgId: string, entry: any) {
    const partner = await this.t("affiliatePartner")
      .findFirst({ where: { id: entry.partnerId, organizationId: orgId } })
      .catch(() => null);
    const order = await this.t("order")
      .findFirst({ where: { id: entry.orderId, organizationId: orgId } })
      .catch(() => null);
    return {
      id: entry.id,
      organizationId: entry.organizationId,
      partnerId: entry.partnerId,
      partnerName: partner?.name ?? null,
      orderId: entry.orderId,
      orderNumber: order?.externalNumber ?? order?.externalId ?? null,
      baseMinor: toBig(entry.baseMinor).toString(),
      percentSnapshot: entry.percentSnapshot,
      commissionMinor: toBig(entry.commissionMinor).toString(),
      status: entry.status,
      voidReason: entry.voidReason ?? null,
      createdAt: entry.createdAt ? new Date(entry.createdAt).toISOString() : null,
      updatedAt: entry.updatedAt ? new Date(entry.updatedAt).toISOString() : null,
    };
  }

  async listEntries(
    orgId: string,
    q: { partnerId?: string; status?: string; page?: number; pageSize?: number },
  ) {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 20));
    const where: any = {
      organizationId: orgId,
      ...(q.partnerId ? { partnerId: q.partnerId } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    const table = this.t("commissionEntry");
    const total = table.count ? await table.count({ where }).catch(() => 0) : 0;
    const rows: any[] =
      (await table
        .findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        })
        .catch(() => [])) ?? [];
    const items = [];
    for (const entry of rows) items.push(await this.serializeEntry(orgId, entry));
    return { total, page, pageSize, items };
  }

  async approveEntry(orgId: string, actorId: string, entryId: string) {
    const entry = await this.t("commissionEntry")
      .findFirst({ where: { id: entryId, organizationId: orgId } })
      .catch(() => null);
    if (!entry) throw notFound("affiliates.commissionEntryNotFoundInThis");
    if (entry.status !== "pending") {
      throw badRequest("affiliates.onlyPendingCommissionCanBeApproved", { entryStatus: entry.status });
    }
    const saved = await this.t("commissionEntry").update({
      where: { id: entry.id },
      data: { status: "approved" },
    });
    await this.safeAudit({
      organizationId: orgId,
      userId: actorId,
      action: "affiliates.entry_approved",
      entityType: "CommissionEntry",
      entityId: entry.id,
      metadata: { partnerId: entry.partnerId, commissionMinor: toBig(entry.commissionMinor).toString() },
    });
    return this.serializeEntry(orgId, saved);
  }

  // ================= Balances + payouts =================

  /**
   * The FIFO balance model, computed from STORED rows:
   *  - paidSum      = sum of entries stored "paid"
   *  - approvedSum  = sum of entries stored "approved"
   *  - payoutsSum   = sum of all AffiliatePayout rows
   *  - unappliedPayouts = payoutsSum − paidSum (>= 0 by
   *    construction: payouts only flip entries they cover)
   *  - outstanding  = approvedSum − unappliedPayouts (floor 0)
   * An approved entry is fully covered when its cumulative
   * (oldest-first, over approved+paid entries) is <= payoutsSum;
   * the stored flip happens at payout-recording time.
   */
  private async balanceParts(orgId: string, partnerId: string) {
    const entries: any[] =
      (await this.t("commissionEntry")
        .findMany({ where: { organizationId: orgId, partnerId } })
        .catch(() => [])) ?? [];
    const payouts: any[] =
      (await this.t("affiliatePayout")
        .findMany({ where: { organizationId: orgId, partnerId } })
        .catch(() => [])) ?? [];
    const sumBy = (status: string): bigint =>
      entries
        .filter((e) => e.status === status)
        .reduce((s: bigint, e: any) => s + toBig(e.commissionMinor), 0n);
    const pendingSum = sumBy("pending");
    const approvedSum = sumBy("approved");
    const paidSum = sumBy("paid");
    const payoutsSum = payouts.reduce((s: bigint, p: any) => s + toBig(p.amountMinor), 0n);
    const unapplied = payoutsSum - paidSum > 0n ? payoutsSum - paidSum : 0n;
    const outstandingRaw = approvedSum - unapplied;
    const outstanding = outstandingRaw > 0n ? outstandingRaw : 0n;
    return { entries, payouts, pendingSum, approvedSum, paidSum, payoutsSum, unapplied, outstanding };
  }

  async partnerBalances(orgId: string, partnerId: string) {
    await this.getPartnerOr404(orgId, partnerId);
    const b = await this.balanceParts(orgId, partnerId);
    return {
      pendingMinor: b.pendingSum.toString(),
      approvedMinor: b.approvedSum.toString(),
      paidMinor: b.paidSum.toString(),
      paidOutMinor: b.payoutsSum.toString(),
      outstandingApprovedMinor: b.outstanding.toString(),
    };
  }

  private serializePayout(payout: any) {
    return {
      id: payout.id,
      organizationId: payout.organizationId,
      partnerId: payout.partnerId,
      amountMinor: toBig(payout.amountMinor).toString(),
      method: payout.method,
      reference: payout.reference ?? null,
      note: payout.note ?? null,
      createdById: payout.createdById ?? null,
      createdAt: payout.createdAt ? new Date(payout.createdAt).toISOString() : null,
    };
  }

  async listPayouts(orgId: string, partnerId: string) {
    await this.getPartnerOr404(orgId, partnerId);
    const rows: any[] =
      (await this.t("affiliatePayout")
        .findMany({
          where: { organizationId: orgId, partnerId },
          orderBy: { createdAt: "desc" },
        })
        .catch(() => [])) ?? [];
    return { total: rows.length, items: rows.map((p) => this.serializePayout(p)) };
  }

  /** Partner detail: partner + aggregates + balances + payouts
   * + the paid-on-refunded-orders flag count (paid entries whose
   * order later ended refunded/cancelled — never auto-voided). */
  async getPartnerDetail(orgId: string, partnerId: string) {
    const partner = await this.getPartnerOr404(orgId, partnerId);
    const withAgg = await this.partnerWithAggregates(orgId, partner);
    const b = await this.balanceParts(orgId, partnerId);
    const balances = {
      pendingMinor: b.pendingSum.toString(),
      approvedMinor: b.approvedSum.toString(),
      paidMinor: b.paidSum.toString(),
      paidOutMinor: b.payoutsSum.toString(),
      outstandingApprovedMinor: b.outstanding.toString(),
    };
    let paidOnRefundedOrders = 0;
    const paidEntries = b.entries.filter((e) => e.status === "paid");
    for (const entry of paidEntries) {
      const order = await this.t("order")
        .findFirst({ where: { id: entry.orderId, organizationId: orgId } })
        .catch(() => null);
      const status = String(order?.status ?? "").toLowerCase();
      if (status === "refunded" || status === "cancelled") paidOnRefundedOrders++;
    }
    const payouts = b.payouts
      .slice()
      .sort((x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime())
      .map((p) => this.serializePayout(p));
    return { ...withAgg, balances, payouts, paidOnRefundedOrders };
  }

  /**
   * THE FIFO flip — the one and only place approved entries
   * become "paid": walk approved+paid entries oldest first (id
   * tiebreak); an approved entry flips when its cumulative
   * commission is fully covered by the pool (Σ all payouts).
   * Pending entries never flip. Shared by recordPayout (EC32
   * manual bookkeeping) and the OU11 execution confirmation, so
   * both paths have identical bookkeeping — there is no second
   * flip implementation to drift.
   */
  private async applyFifoFlip(entries: any[], pool: bigint): Promise<void> {
    const fifo = entries
      .filter((e) => e.status === "approved" || e.status === "paid")
      .slice()
      .sort((x, y) => {
        const dt = new Date(x.createdAt).getTime() - new Date(y.createdAt).getTime();
        return dt !== 0 ? dt : String(x.id).localeCompare(String(y.id));
      });
    let cumulative = 0n;
    for (const entry of fifo) {
      cumulative += toBig(entry.commissionMinor);
      if (cumulative <= pool && entry.status === "approved") {
        await this.t("commissionEntry").update({
          where: { id: entry.id },
          data: { status: "paid" },
        });
      }
    }
  }

  /**
   * Record a payout the merchant made OUTSIDE the system. This
   * only records it (রেকর্ড করা হয়েছে) — no money is sent here.
   * Guard: amount must not exceed the outstanding approved
   * balance. On success the FIFO flip marks covered approved
   * entries as paid.
   */
  async recordPayout(
    orgId: string,
    actorId: string,
    partnerId: string,
    dto: RecordAffiliatePayoutDto,
  ) {
    const partner = await this.getPartnerOr404(orgId, partnerId);
    if (!(PAYOUT_METHODS as readonly string[]).includes(dto.method)) {
      throw badRequest("affiliates.thePayoutMethodMustBeBkash");
    }
    let amount: bigint;
    try {
      amount = BigInt(dto.amountMinor as any);
    } catch {
      amount = 0n;
    }
    if (amount <= 0n) {
      throw badRequest("affiliates.thePayoutAmountMustBeMore");
    }
    const before = await this.balanceParts(orgId, partnerId);
    if (amount > before.outstanding) {
      throw badRequest("affiliates.thePayoutAmountCannotExceedThe", { p1: amount.toString(), p2: before.outstanding.toString() });
    }

    const payout = await this.t("affiliatePayout").create({
      data: {
        organizationId: orgId,
        partnerId: partner.id,
        amountMinor: amount,
        method: dto.method,
        reference: dto.reference?.trim() || null,
        note: dto.note?.trim() || null,
        createdById: actorId,
      },
    });

    // FIFO flip: coverage pool = all payouts incl. this one.
    const pool = before.payoutsSum + amount;
    await this.applyFifoFlip(before.entries, pool);

    await this.safeAudit({
      organizationId: orgId,
      userId: actorId,
      action: "affiliates.payout_recorded",
      entityType: "AffiliatePayout",
      entityId: payout.id,
      metadata: { partnerId: partner.id, amountMinor: amount.toString(), method: dto.method },
    });

    const balances = await this.partnerBalances(orgId, partnerId);
    return { payout: this.serializePayout(payout), balances };
  }

  // ================= OU11: payout executions (bank-instruction rail) =================

  /**
   * OU11 — affiliate payouts ride the SAME disbursement rail
   * and the SAME legal gate as wallet payouts (see
   * connections/payout-legal-gate.ts): no execution entry point
   * here runs while the gate is closed. The flow mirrors the
   * wallet rail exactly:
   *  1. createAffiliatePayoutExecution issues a bank instruction
   *     for an amount covered by the partner's APPROVED
   *     outstanding commissions — unapproved (pending) commission
   *     can never be executed against, and amounts already under
   *     an open instruction are reserved, so instructions can
   *     never jointly overdraw the outstanding.
   *  2. The merchant executes at the bank by hand (v1 rail: no
   *     bKash disbursement API is evidenced anywhere in this
   *     codebase) and confirms with the BANK's reference.
   *  3. Confirmation creates the AffiliatePayout through the
   *     SAME bookkeeping as recordPayout — same row shape, same
   *     applyFifoFlip — exactly once: a duplicate confirmation
   *     returns the stored payout and creates nothing.
   * The EC32 recordPayout path above is the manual bookkeeping
   * process and, like manual wallet mark-paid, is NOT gated and
   * is unchanged.
   */

  private serializePayoutExecution(row: any) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      subjectType: row.subjectType,
      partnerId: row.partnerId ?? null,
      affiliatePayoutId: row.affiliatePayoutId ?? null,
      amountMinor: toBig(row.amountMinor).toString(),
      method: row.method,
      destination: row.destination ?? null,
      currency: row.currency ?? "BDT",
      rail: row.rail,
      status: row.status,
      instructionRef: row.instructionRef,
      bankReference: row.bankReference ?? null,
      failureReason: row.failureReason ?? null,
      issuedById: row.issuedById,
      confirmedById: row.confirmedById ?? null,
      failedById: row.failedById ?? null,
      issuedAt: row.issuedAt ? new Date(row.issuedAt).toISOString() : null,
      confirmedAt: row.confirmedAt ? new Date(row.confirmedAt).toISOString() : null,
      failedAt: row.failedAt ? new Date(row.failedAt).toISOString() : null,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    };
  }

  private async getAffiliateExecutionOr404(orgId: string, executionId: string) {
    const row = await this.t("payoutExecution")
      .findFirst({ where: { id: executionId, organizationId: orgId, subjectType: "affiliate_payout" } })
      .catch(() => null);
    if (!row) throw notFound("affiliates.payoutExecutionNotFound");
    return row;
  }

  async listAffiliatePayoutExecutions(orgId: string, partnerId: string) {
    await this.getPartnerOr404(orgId, partnerId);
    const rows: any[] =
      (await this.t("payoutExecution")
        .findMany({
          where: { organizationId: orgId, partnerId, subjectType: "affiliate_payout" },
          orderBy: { createdAt: "desc" },
        })
        .catch(() => [])) ?? [];
    return { total: rows.length, items: rows.map((r) => this.serializePayoutExecution(r)) };
  }

  async createAffiliatePayoutExecution(
    orgId: string,
    actorId: string,
    partnerId: string,
    dto: { amountMinor?: string; method?: string; destination?: any; note?: string },
  ) {
    // The legal gate is asserted FIRST — before partner lookup
    // or any validation can create state (the gate refusal
    // creates nothing, exactly like the wallet rail).
    await assertPayoutAutomationAllowed(this.prisma as any);
    const partner = await this.getPartnerOr404(orgId, partnerId);
    if (!(PAYOUT_METHODS as readonly string[]).includes(String(dto.method))) {
      throw badRequest("affiliates.thePayoutMethodMustBeBkash");
    }
    const method = String(dto.method);
    let amount: bigint;
    try {
      amount = BigInt(dto.amountMinor as any);
    } catch {
      amount = 0n;
    }
    if (amount <= 0n) {
      throw badRequest("affiliates.thePayoutAmountMustBeMore");
    }
    // Destination: the payee details the bank instruction pays
    // to. bkash/nagad need a number, bank needs account number
    // + bank name (the PayoutDestination contract); cash/other
    // fall back to the partner's own contact snapshot.
    let destination: any = dto.destination ?? null;
    if (destination !== null && (typeof destination !== "object" || Array.isArray(destination))) {
      throw badRequest("affiliates.thePayoutDestinationInformationIsNot");
    }
    if (method === "bkash" || method === "nagad") {
      if (!String(destination?.number ?? "").trim()) {
        throw badRequest("affiliates.aDestinationNumberDestinationNumberIs", { method: method });
      }
    } else if (method === "bank") {
      if (!String(destination?.accountNumber ?? "").trim() || !String(destination?.bankName ?? "").trim()) {
        throw badRequest("affiliates.forABankPayoutTheAccount");
      }
    } else if (!destination) {
      destination = { payeeName: partner.name, phone: partner.phone };
    }
    const before = await this.balanceParts(orgId, partner.id);
    const inflight: any[] =
      (await this.t("payoutExecution")
        .findMany({ where: { organizationId: orgId, partnerId: partner.id, subjectType: "affiliate_payout", status: "instruction_issued" } })
        .catch(() => [])) ?? [];
    const reserved = inflight.reduce((s: bigint, r: any) => s + toBig(r.amountMinor), 0n);
    const executable = before.outstanding - reserved;
    if (amount > executable) {
      throw badRequest("affiliates.theExecutionAmountCannotExceedThe", { p1: amount.toString(), p2: executable.toString(), p3: before.outstanding.toString(), p4: reserved.toString() });
    }
    const execution = await this.t("payoutExecution").create({
      data: {
        organizationId: orgId, subjectType: "affiliate_payout",
        partnerId: partner.id, affiliatePayoutId: null, payoutRequestId: null,
        amountMinor: amount, method, destination, currency: "BDT",
        rail: "bank_instruction", status: "instruction_issued",
        instructionRef: `BANK-${randomUUID()}`,
        issuedById: actorId, issuedAt: new Date(),
      },
    });
    await this.safeAudit({
      organizationId: orgId, userId: actorId,
      action: "affiliates.payout_execution_issued",
      entityType: "PayoutExecution", entityId: execution.id,
      metadata: { partnerId: partner.id, amountMinor: amount.toString(), method, instructionRef: execution.instructionRef },
    });
    return this.serializePayoutExecution(execution);
  }

  async confirmAffiliatePayoutExecution(
    orgId: string,
    actorId: string,
    executionId: string,
    dto: { bankReference?: string },
  ) {
    await assertPayoutAutomationAllowed(this.prisma as any);
    const ref = String(dto?.bankReference ?? "").trim();
    if (!ref) {
      throw badRequest("affiliates.toConfirmAnExecutionTheBank");
    }
    const execution = await this.getAffiliateExecutionOr404(orgId, executionId);
    if (execution.status === "confirmed") {
      // Duplicate confirmation converges on the stored truth:
      // the payout it created, no second row, no second flip.
      const payout = execution.affiliatePayoutId
        ? await this.t("affiliatePayout").findFirst({ where: { id: execution.affiliatePayoutId } }).catch(() => null)
        : null;
      const balances = await this.partnerBalances(orgId, execution.partnerId);
      return {
        execution: this.serializePayoutExecution(execution),
        payout: payout ? this.serializePayout(payout) : null,
        balances, alreadyConfirmed: true,
      };
    }
    if (execution.status !== "instruction_issued") {
      throw badRequest("affiliates.thisExecutionCannotBeConfirmedCurrent", { executionStatus: execution.status });
    }
    const amount = toBig(execution.amountMinor);
    const before = await this.balanceParts(orgId, execution.partnerId);
    if (amount > before.outstanding) {
      // Truthful + retryable: nothing is created, the execution
      // stays open — the outstanding may have been consumed by a
      // manual recordPayout after the instruction was issued.
      throw badRequest("affiliates.theCurrentApprovedOutstandingIsLess", { p1: before.outstanding.toString(), p2: amount.toString() });
    }
    const payout = await this.t("affiliatePayout").create({
      data: {
        organizationId: orgId,
        partnerId: execution.partnerId,
        amountMinor: amount,
        method: execution.method,
        reference: ref,
        note: `OU11 bank instruction ${execution.instructionRef} অনুযায়ী পরিশোধিত`,
        createdById: actorId,
      },
    });
    // The SAME FIFO flip as recordPayout, with the pool
    // recomputed from the rows that exist now (incl. this one).
    await this.applyFifoFlip(before.entries, before.payoutsSum + amount);
    const updated = await this.t("payoutExecution").update({
      where: { id: execution.id },
      data: {
        status: "confirmed", bankReference: ref, affiliatePayoutId: payout.id,
        confirmedById: actorId, confirmedAt: new Date(), failureReason: null, failedById: null, failedAt: null,
      },
    });
    await this.safeAudit({
      organizationId: orgId, userId: actorId,
      action: "affiliates.payout_execution_confirmed",
      entityType: "PayoutExecution", entityId: execution.id,
      metadata: { partnerId: execution.partnerId, affiliatePayoutId: payout.id, bankReference: ref, amountMinor: amount.toString() },
    });
    const balances = await this.partnerBalances(orgId, execution.partnerId);
    return { execution: this.serializePayoutExecution(updated), payout: this.serializePayout(payout), balances };
  }

  async failAffiliatePayoutExecution(
    orgId: string,
    actorId: string,
    executionId: string,
    dto: { reason?: string },
  ) {
    await assertPayoutAutomationAllowed(this.prisma as any);
    const reason = String(dto?.reason ?? "").trim();
    if (!reason) throw badRequest("affiliates.toRecordAnExecutionAsFailed");
    const execution = await this.getAffiliateExecutionOr404(orgId, executionId);
    if (execution.status === "confirmed") {
      throw badRequest("affiliates.aConfirmedExecutionCannotBeMarked");
    }
    if (execution.status === "failed") return this.serializePayoutExecution(execution);
    const updated = await this.t("payoutExecution").update({
      where: { id: execution.id },
      data: { status: "failed", failureReason: reason, failedById: actorId, failedAt: new Date() },
    });
    await this.safeAudit({
      organizationId: orgId, userId: actorId,
      action: "affiliates.payout_execution_failed",
      entityType: "PayoutExecution", entityId: execution.id,
      metadata: { partnerId: execution.partnerId, failureReason: reason },
    });
    return this.serializePayoutExecution(updated);
  }
}
