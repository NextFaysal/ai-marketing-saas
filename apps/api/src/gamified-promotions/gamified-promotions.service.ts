import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional,
} from "@nestjs/common";
import { randomBytes, randomInt } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { BlockedPhoneService } from "../fraud/blocked-phone.service";
import { bdPhoneMatchKey, normalizeBdPhone } from "../orders/phone-utils";
import {
  GROUP_BUY_NO_PREPAYMENT_NOTE, PLACEMENT_TRIGGERS, PROMO_KINDS, discountLabel,
  pickWheelSegment, scoreQuiz, totalWeight,
  validateGroupBuyConfig, validateQuizConfig, validateWheelConfig,
  type GroupBuyConfig, type QuizConfig, type WheelConfig,
} from "./promo-config";
import type {
  CreatePromoCampaignDto, PublicGroupBuyJoinDto, PublicPlayDto, PublicQuizCompleteDto,
  UpdatePromoCampaignDto,
} from "./gamified-promotions.dto";

/**
 * NF6 (FB3) — Gamified promotions: spin wheel, product-finder
 * quiz, group buy.
 *
 * Honesty / reuse rules this service is built on:
 * - PRESENTATION rides the OU8 popup engine's machinery: the
 *   campaign carries StorePopup's exact placement vocabulary
 *   (trigger / delaySeconds / scrollPercent / frequencyDays /
 *   showOn / startsAt / endsAt) and the shop renders it through
 *   the same trigger + frequency pattern as ShopPopup. There is
 *   no second placement engine.
 * - PRIZES are REAL coupons or nothing: a win creates exactly
 *   ONE single-use StoreDiscount row — the existing EC7 coupon
 *   engine's table, validated + redeemed at checkout by
 *   DiscountsService.validateForCheckout / PromotionsService —
 *   created the same way AbandonedCheckoutsService issues
 *   recovery coupons (unique random code, usageLimit 1,
 *   perCustomerLimit 1, origin + sourceRef). NF6's sourceRef is
 *   "nf6:play:<playId>" / "nf6:groupbuy:<joinId>" and is
 *   pre-checked before every create: that pre-check is the
 *   exactly-once guard on replay, like the workflow engine's
 *   issue_recovery_coupon guard. No parallel coupon store.
 * - OUTCOMES are server-side only: the spin roll is drawn with
 *   crypto.randomInt over the configured weights; a
 *   client-submitted segment is never read.
 * - ABUSE control rides Fraud Shield: the play/join phone is
 *   normalised with the BlockedPhone machinery's own helpers
 *   (normalizeBdPhone / bdPhoneMatchKey), a BlockedPhone hit
 *   refuses the play, and the (campaignId, phoneKey) unique on
 *   PromoPlay / PromoGroupBuyJoin IS one-play-per-phone.
 * - GROUP BUY takes NO money and holds NO stock in v1:
 *   StockReservation was rejected (anonymous checkout-session
 *   stock holds that expire silently; holding real stock for a
 *   group that may never form would block real sales). A join
 *   is a record. When the threshold is met every joiner gets a
 *   real product-scoped coupon (the existing checkout discount
 *   path honours it). When the window expires unmet, joins flip
 *   to status "expired" and stay visible to staff with the
 *   joiner list — that record IS the v1 notification; no SMS /
 *   WhatsApp send exists for this and none is claimed.
 */

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

@Injectable()
export class GamifiedPromotionsService {
  private readonly logger = new Logger(GamifiedPromotionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly blockedPhones?: BlockedPhoneService,
  ) {}

  private db(): any { return this.prisma as any; }
  private t(name: string): any { return this.db()[name]; }

  private async safeAudit(input: Parameters<AuditService["log"]>[0]) {
    await this.audit?.log(input).catch(() => undefined);
  }

  // ---------- shared helpers ----------

  private parseDate(value: string | null | undefined, label: string): Date | null {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) throw new BadRequestException(`${label} সঠিক তারিখ নয়`);
    return d;
  }

  private placementFrom(dto: CreatePromoCampaignDto | UpdatePromoCampaignDto, existing?: any) {
    const data: Record<string, any> = {};
    if (dto.trigger !== undefined) {
      if (!(PLACEMENT_TRIGGERS as readonly string[]).includes(String(dto.trigger))) {
        throw new BadRequestException("পপআপ ট্রিগার সঠিক নয়");
      }
      data.trigger = String(dto.trigger);
    }
    for (const key of ["delaySeconds", "scrollPercent", "frequencyDays"] as const) {
      if (dto[key] !== undefined) {
        const n = Number(dto[key]);
        if (!Number.isInteger(n) || n < 0 || n > 100000) {
          throw new BadRequestException("পপআপের সময়/শতাংশ সঠিক নয়");
        }
        data[key] = n;
      }
    }
    if (dto.showOn !== undefined) {
      if (!["home", "all"].includes(String(dto.showOn))) {
        throw new BadRequestException("পপআপ কোথায় দেখাবে তা সঠিক নয়");
      }
      data.showOn = String(dto.showOn);
    }
    if (dto.startsAt !== undefined) data.startsAt = this.parseDate(dto.startsAt, "শুরুর সময়");
    if (dto.endsAt !== undefined) data.endsAt = this.parseDate(dto.endsAt, "শেষের সময়");
    const effStarts: Date | null = data.startsAt !== undefined ? data.startsAt : existing?.startsAt ? new Date(existing.startsAt) : null;
    const effEnds: Date | null = data.endsAt !== undefined ? data.endsAt : existing?.endsAt ? new Date(existing.endsAt) : null;
    if (effStarts && effEnds && effEnds.getTime() <= effStarts.getTime()) {
      throw new BadRequestException("শেষের সময় শুরুর সময়ের পরে হতে হবে");
    }
    return data;
  }

  private validateConfig(kind: string, raw: unknown): WheelConfig | QuizConfig | GroupBuyConfig {
    if (kind === "spin_wheel") return validateWheelConfig(raw);
    if (kind === "quiz") return validateQuizConfig(raw);
    return validateGroupBuyConfig(raw);
  }

  private async loadCampaignOr404(orgId: string, id: string) {
    const row = await this.t("promoCampaign").findFirst({
      where: { id: String(id ?? ""), organizationId: orgId },
    }).catch(() => null);
    if (!row) throw new NotFoundException("ক্যাম্পেইনটি পাওয়া যায়নি");
    return row;
  }

  /** A group-buy campaign must point at one of the ORG's own
   * products — validated at save so a campaign can never scope
   * its coupons to another org's product. */
  private async assertOwnProduct(orgId: string, productId: string) {
    const product = await this.t("product").findFirst({
      where: { id: productId, organizationId: orgId },
    }).catch(() => null);
    if (!product) throw new BadRequestException("পণ্যটি এই দোকানের ক্যাটালগে পাওয়া যায়নি");
    return product;
  }

  private serializeCampaign(row: any, stats?: Record<string, number>) {
    return {
      id: row.id,
      organizationId: row.organizationId,
      kind: row.kind,
      name: row.name,
      active: !!row.active,
      trigger: row.trigger ?? "delay_seconds",
      delaySeconds: row.delaySeconds ?? 5,
      scrollPercent: row.scrollPercent ?? 50,
      frequencyDays: row.frequencyDays ?? 7,
      showOn: row.showOn ?? "home",
      startsAt: row.startsAt ? new Date(row.startsAt).toISOString() : null,
      endsAt: row.endsAt ? new Date(row.endsAt).toISOString() : null,
      config: row.config ?? {},
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
      ...(stats ? { stats } : {}),
    };
  }

  // ---------- staff: campaign CRUD ----------

  async createCampaign(orgId: string, actorId: string, dto: CreatePromoCampaignDto) {
    const kind = String(dto.kind ?? "");
    if (!(PROMO_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException("ক্যাম্পেইনের ধরন সঠিক নয় (spin_wheel | quiz | group_buy)");
    }
    const name = String(dto.name ?? "").trim();
    if (!name) throw new BadRequestException("ক্যাম্পেইনের নাম আবশ্যক");
    const config = this.validateConfig(kind, dto.config);
    if (kind === "group_buy") {
      await this.assertOwnProduct(orgId, (config as GroupBuyConfig).productId);
      if (!dto.endsAt) throw new BadRequestException("গ্রুপ বাইয়ের জন্য শেষের সময় (উইন্ডো) আবশ্যক");
    }
    const placement = this.placementFrom(dto);
    const row = await this.t("promoCampaign").create({
      data: {
        organizationId: orgId,
        kind,
        name: name.slice(0, 160),
        active: dto.active !== false,
        trigger: "delay_seconds",
        delaySeconds: 5,
        scrollPercent: 50,
        frequencyDays: 7,
        showOn: "home",
        ...placement,
        config: config as any,
        createdById: actorId ?? null,
      },
    });
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "promotions.campaign_created",
      entityType: "PromoCampaign", entityId: row.id, metadata: { kind },
    });
    return { campaign: this.serializeCampaign(row) };
  }

  async listCampaigns(orgId: string) {
    const rows = (await this.t("promoCampaign").findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
    }).catch(() => [])) ?? [];
    const campaigns = [];
    for (const row of rows) {
      campaigns.push(this.serializeCampaign(row, await this.campaignStats(orgId, row)));
    }
    return { campaigns };
  }

  async getCampaign(orgId: string, id: string) {
    const row = await this.loadCampaignOr404(orgId, id);
    if (row.kind === "group_buy") await this.settleGroupBuy(orgId, row);
    const fresh = await this.loadCampaignOr404(orgId, id);
    const stats = await this.campaignStats(orgId, fresh);
    const out: any = { campaign: this.serializeCampaign(fresh, stats) };
    if (fresh.kind === "group_buy") {
      out.joins = await this.listJoins(orgId, fresh.id);
    } else {
      out.plays = await this.listPlays(orgId, fresh.id);
    }
    return out;
  }

  async updateCampaign(orgId: string, actorId: string, id: string, dto: UpdatePromoCampaignDto) {
    const existing = await this.loadCampaignOr404(orgId, id);
    const data: Record<string, any> = { ...this.placementFrom(dto, existing) };
    if (dto.name !== undefined) {
      const name = String(dto.name ?? "").trim();
      if (!name) throw new BadRequestException("ক্যাম্পেইনের নাম আবশ্যক");
      data.name = name.slice(0, 160);
    }
    if (dto.active !== undefined) data.active = dto.active === true;
    if (dto.config !== undefined) {
      const config = this.validateConfig(existing.kind, dto.config);
      if (existing.kind === "group_buy") {
        await this.assertOwnProduct(orgId, (config as GroupBuyConfig).productId);
      }
      data.config = config as any;
    }
    if (existing.kind === "group_buy") {
      const effEnds = data.endsAt !== undefined ? data.endsAt : existing.endsAt;
      if (!effEnds) throw new BadRequestException("গ্রুপ বাইয়ের জন্য শেষের সময় (উইন্ডো) আবশ্যক");
    }
    const row = await this.t("promoCampaign").update({ where: { id: existing.id }, data });
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "promotions.campaign_updated",
      entityType: "PromoCampaign", entityId: row.id, metadata: { fields: Object.keys(data) },
    });
    return { campaign: this.serializeCampaign(row) };
  }

  async setActive(orgId: string, actorId: string, id: string, active: boolean) {
    const existing = await this.loadCampaignOr404(orgId, id);
    const row = await this.t("promoCampaign").update({
      where: { id: existing.id }, data: { active: active === true },
    });
    await this.safeAudit({
      organizationId: orgId, userId: actorId, action: "promotions.campaign_active_set",
      entityType: "PromoCampaign", entityId: row.id, metadata: { active: row.active },
    });
    return { campaign: this.serializeCampaign(row) };
  }

  async listPlays(orgId: string, campaignId: string) {
    const campaign = await this.loadCampaignOr404(orgId, campaignId);
    const rows = (await this.t("promoPlay").findMany({
      where: { organizationId: orgId, campaignId: campaign.id },
      orderBy: { createdAt: "desc" },
    }).catch(() => [])) ?? [];
    return rows.map((r: any) => ({
      id: r.id,
      campaignId: r.campaignId,
      phone: r.phone,
      customerName: r.customerName ?? null,
      outcome: r.outcome,
      segmentLabel: r.segmentLabel ?? null,
      resultKey: r.resultKey ?? null,
      couponCode: r.couponCode ?? null,
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
    }));
  }

  async listJoins(orgId: string, campaignId: string) {
    const campaign = await this.loadCampaignOr404(orgId, campaignId);
    const rows = (await this.t("promoGroupBuyJoin").findMany({
      where: { organizationId: orgId, campaignId: campaign.id },
      orderBy: { createdAt: "asc" },
    }).catch(() => [])) ?? [];
    return rows.map((r: any) => ({
      id: r.id,
      campaignId: r.campaignId,
      phone: r.phone,
      customerName: r.customerName ?? null,
      status: r.status,
      couponCode: r.couponCode ?? null,
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
    }));
  }

  /**
   * REAL stats only: plays/wins counted from PromoPlay rows,
   * group joins from PromoGroupBuyJoin rows, coupons issued
   * from the play/join stamps, coupons redeemed from the actual
   * StoreDiscount rows those stamps point at (usedCount > 0).
   * Nothing is estimated or fabricated.
   */
  private async campaignStats(orgId: string, campaign: any): Promise<Record<string, number>> {
    if (campaign.kind === "group_buy") {
      const joins = (await this.t("promoGroupBuyJoin").findMany({
        where: { organizationId: orgId, campaignId: campaign.id },
      }).catch(() => [])) ?? [];
      const couponIds = joins.filter((j: any) => j.couponId).map((j: any) => j.couponId);
      return {
        joins: joins.length,
        unlocked: joins.filter((j: any) => j.status === "unlocked").length,
        expired: joins.filter((j: any) => j.status === "expired").length,
        couponsIssued: couponIds.length,
        couponsRedeemed: await this.countRedeemed(orgId, couponIds),
      };
    }
    const plays = (await this.t("promoPlay").findMany({
      where: { organizationId: orgId, campaignId: campaign.id },
    }).catch(() => [])) ?? [];
    const couponIds = plays.filter((p: any) => p.couponId).map((p: any) => p.couponId);
    return {
      plays: plays.length,
      wins: plays.filter((p: any) => p.outcome === "won").length,
      completions: plays.filter((p: any) => p.outcome === "completed").length,
      couponsIssued: couponIds.length,
      couponsRedeemed: await this.countRedeemed(orgId, couponIds),
    };
  }

  private async countRedeemed(orgId: string, couponIds: string[]): Promise<number> {
    if (!couponIds.length) return 0;
    const rows = (await this.t("storeDiscount").findMany({
      where: { organizationId: orgId, id: { in: couponIds } },
    }).catch(() => [])) ?? [];
    return rows.filter((r: any) => Number(r.usedCount ?? 0) > 0).length;
  }

  // ---------- the existing coupon engine (StoreDiscount) ----------

  /**
   * Issue ONE real single-use coupon through the existing
   * coupon engine — the same StoreDiscount create the abandoned
   * -recovery issuer performs (unique random code with retry,
   * usageLimit 1, perCustomerLimit 1, origin + sourceRef). The
   * sourceRef pre-check makes the issue exactly-once: a replay
   * finds the already-issued row and returns it instead of
   * creating a second coupon. Returns null when issuance fails
   * (the caller leaves the play/join unstamped so a later retry
   * can heal — never a fake code).
   */
  private async issuePromoCoupon(
    orgId: string,
    input: {
      kind: "percent" | "fixed"; value: number; expiryHours: number;
      sourceRef: string; prefix: string; scopeProductId?: string | null;
    },
  ): Promise<{ id: string; code: string } | null> {
    try {
      const table = this.t("storeDiscount");
      if (!table?.create) return null;
      const existing = table.findFirst
        ? await table.findFirst({ where: { organizationId: orgId, sourceRef: input.sourceRef } }).catch(() => null)
        : null;
      if (existing) return { id: existing.id, code: existing.code };
      for (let attempt = 0; attempt < 5; attempt++) {
        const bytes = randomBytes(8);
        let suffix = "";
        for (let i = 0; i < 8; i++) suffix += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
        const code = `${input.prefix}-${suffix}`;
        try {
          const row = await table.create({
            data: {
              organizationId: orgId,
              code,
              kind: input.kind,
              value: input.value,
              endsAt: new Date(Date.now() + input.expiryHours * 3600_000),
              usageLimit: 1,
              perCustomerLimit: 1,
              scopeType: input.scopeProductId ? "products" : "all",
              scopeIds: input.scopeProductId ? [input.scopeProductId] : null,
              active: true,
              origin: "gamified_promo",
              sourceRef: input.sourceRef,
            },
          });
          return { id: row.id, code: row.code };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/unique|P2002/i.test(msg) && attempt < 4) continue;
          this.logger.warn(`promo coupon issuance failed for org ${orgId}: ${msg}`);
          return null;
        }
      }
      return null;
    } catch (e) {
      this.logger.warn(
        `promo coupon issuance failed for org ${orgId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  // ---------- public: shop resolution + phone gate ----------

  private async requireShop(orgSlug: string) {
    const org = await this.t("organization").findFirst({
      where: { slug: String(orgSlug ?? "") },
    }).catch(() => null);
    if (!org) throw new NotFoundException("দোকানটি পাওয়া যায়নি");
    const setting = await this.t("storefrontSetting").findFirst({
      where: { organizationId: org.id },
    }).catch(() => null);
    if (!setting || setting.shopEnabled !== true) {
      throw new NotFoundException("দোকানটি পাওয়া যায়নি");
    }
    return org;
  }

  private async phoneGate(orgId: string, rawPhone: unknown): Promise<{ phone: string; phoneKey: string }> {
    const phone = normalizeBdPhone(rawPhone ?? "");
    if (!phone) {
      throw new BadRequestException("সঠিক বাংলাদেশি মোবাইল নম্বর দিন");
    }
    const phoneKey = bdPhoneMatchKey(phone)!;
    if (this.blockedPhones?.isBlocked) {
      const blocked = await this.blockedPhones.isBlocked(orgId, phone).catch(() => false);
      if (blocked) {
        throw new ForbiddenException("এই নম্বরটি এই দোকানে ব্লক করা আছে — অংশ নেওয়া যাবে না");
      }
    }
    return { phone, phoneKey };
  }

  private assertLive(campaign: any) {
    const now = Date.now();
    if (!campaign.active) throw new BadRequestException("ক্যাম্পেইনটি এখন সক্রিয় নয়");
    if (campaign.startsAt && new Date(campaign.startsAt).getTime() > now) {
      throw new BadRequestException("ক্যাম্পেইনটি এখনো শুরু হয়নি");
    }
    if (campaign.endsAt && new Date(campaign.endsAt).getTime() < now) {
      throw new BadRequestException("ক্যাম্পেইনটির সময় শেষ হয়ে গেছে");
    }
  }

  private async loadPublicCampaign(orgId: string, campaignId: string, kind: string) {
    const row = await this.t("promoCampaign").findFirst({
      where: { id: String(campaignId ?? ""), organizationId: orgId, kind },
    }).catch(() => null);
    if (!row) throw new NotFoundException("ক্যাম্পেইনটি পাওয়া যায়নি");
    return row;
  }

  private placementPublic(campaign: any) {
    return {
      trigger: campaign.trigger ?? "delay_seconds",
      delaySeconds: campaign.delaySeconds ?? 5,
      scrollPercent: campaign.scrollPercent ?? 50,
      frequencyDays: campaign.frequencyDays ?? 7,
      showOn: campaign.showOn ?? "home",
      startsAt: campaign.startsAt ? new Date(campaign.startsAt).toISOString() : null,
      endsAt: campaign.endsAt ? new Date(campaign.endsAt).toISOString() : null,
    };
  }

  private isInWindow(campaign: any, now = Date.now()): boolean {
    if (!campaign.active) return false;
    if (campaign.startsAt && new Date(campaign.startsAt).getTime() > now) return false;
    if (campaign.endsAt && new Date(campaign.endsAt).getTime() < now) return false;
    return true;
  }

  // ---------- public: active campaigns (popup surface) ----------

  async publicActive(orgSlug: string) {
    const org = await this.requireShop(orgSlug);
    const rows = (await this.t("promoCampaign").findMany({
      where: { organizationId: org.id, active: true },
      orderBy: { createdAt: "desc" },
    }).catch(() => [])) ?? [];
    const campaigns: any[] = [];
    for (const row of rows) {
      if (!this.isInWindow(row)) {
        // an out-of-window group buy still settles (expiry
        // flips) even though it is no longer presented.
        if (row.kind === "group_buy") await this.settleGroupBuy(org.id, row).catch(() => undefined);
        continue;
      }
      campaigns.push(await this.publicCampaignShape(org.id, row));
    }
    return { orgSlug: org.slug, orgName: org.name, campaigns };
  }

  /** Public shape — NEVER leaks segment weights, quiz answer
   * mappings' targets beyond what the shopper must see, prize
   * internals, or any other org's data. */
  private async publicCampaignShape(orgId: string, row: any) {
    const base = {
      id: row.id,
      kind: row.kind,
      name: row.name,
      placement: this.placementPublic(row),
    };
    if (row.kind === "spin_wheel") {
      const config = validateWheelConfig(row.config);
      return {
        ...base,
        // labels only — weights and prize values stay server-side.
        segments: config.segments.map((s) => ({ label: s.label })),
      };
    }
    if (row.kind === "quiz") {
      const config = validateQuizConfig(row.config);
      return {
        ...base,
        questions: config.questions.map((q) => ({
          text: q.text,
          options: q.options.map((o) => ({ text: o.text })),
        })),
        completionCouponLabel: config.completionCoupon
          ? discountLabel(config.completionCoupon.kind, config.completionCoupon.value)
          : null,
      };
    }
    // group_buy
    const config = validateGroupBuyConfig(row.config);
    const product = await this.assertOwnProduct(orgId, config.productId).catch(() => null);
    const status = await this.groupBuyStatus(orgId, row);
    return {
      ...base,
      product: product
        ? {
            id: product.id,
            name: product.name,
            slug: product.slug ?? null,
            priceMinor: String(product.priceMinor ?? 0),
            imageUrl: product.imageUrl ?? null,
          }
        : null,
      requiredBuyers: config.requiredBuyers,
      joinedCount: status.joinedCount,
      groupStatus: status.status,
      discountLabel: discountLabel(config.discountKind, config.discountValue),
      noPrepaymentNote: GROUP_BUY_NO_PREPAYMENT_NOTE,
    };
  }

  // ---------- public: spin wheel ----------

  private serializePlay(row: any, alreadyPlayed: boolean) {
    return {
      id: row.id,
      campaignId: row.campaignId,
      outcome: row.outcome,
      segmentIndex: row.segmentIndex ?? null,
      segmentLabel: row.segmentLabel ?? null,
      couponCode: row.couponCode ?? null,
      alreadyPlayed,
    };
  }

  async publicSpinPlay(orgSlug: string, campaignId: string, dto: PublicPlayDto) {
    const org = await this.requireShop(orgSlug);
    const campaign = await this.loadPublicCampaign(org.id, campaignId, "spin_wheel");
    this.assertLive(campaign);
    const { phone, phoneKey } = await this.phoneGate(org.id, dto.phone);
    const config = validateWheelConfig(campaign.config);

    const existing = await this.t("promoPlay").findFirst({
      where: { campaignId: campaign.id, phoneKey },
    }).catch(() => null);
    if (existing) {
      const healed = await this.healPlayCoupon(org.id, campaign, existing);
      return { play: this.serializePlay(healed, true) };
    }

    // SERVER-SIDE outcome: the roll comes from crypto randomness
    // over the configured weights. dto.claimedSegmentIndex is
    // deliberately never read.
    const roll = randomInt(0, totalWeight(config));
    const segmentIndex = pickWheelSegment(config, roll);
    const segment = config.segments[segmentIndex];
    const won = segment.prizeKind !== "none";

    let row: any;
    try {
      row = await this.t("promoPlay").create({
        data: {
          organizationId: org.id,
          campaignId: campaign.id,
          phone,
          phoneKey,
          customerName: dto.name ? String(dto.name).trim().slice(0, 120) || null : null,
          outcome: won ? "won" : "lost",
          segmentIndex,
          segmentLabel: segment.label,
        },
      });
    } catch (e) {
      // (campaignId, phoneKey) unique race → the first play stands.
      const msg = e instanceof Error ? e.message : String(e);
      if (/unique|P2002/i.test(msg)) {
        const again = await this.t("promoPlay").findFirst({
          where: { campaignId: campaign.id, phoneKey },
        }).catch(() => null);
        if (again) return { play: this.serializePlay(await this.healPlayCoupon(org.id, campaign, again), true) };
      }
      throw e;
    }

    if (won) {
      const coupon = await this.issuePromoCoupon(org.id, {
        kind: segment.prizeKind as "percent" | "fixed",
        value: segment.prizeValue,
        expiryHours: config.couponExpiryHours,
        sourceRef: `nf6:play:${row.id}`,
        prefix: "WIN",
      });
      if (coupon) {
        row = await this.t("promoPlay").update({
          where: { id: row.id }, data: { couponId: coupon.id, couponCode: coupon.code },
        });
      }
    }
    return { play: this.serializePlay(row, false) };
  }

  /** A won/completed play whose coupon issuance failed earlier
   * gets exactly one coupon on a later replay — the sourceRef
   * pre-check inside issuePromoCoupon keeps it exactly-once. */
  private async healPlayCoupon(orgId: string, campaign: any, play: any) {
    if (play.couponId) return play;
    let prize: { kind: "percent" | "fixed"; value: number; expiryHours: number } | null = null;
    if (campaign.kind === "spin_wheel" && play.outcome === "won" && play.segmentIndex != null) {
      const config = validateWheelConfig(campaign.config);
      const segment = config.segments[play.segmentIndex];
      if (segment && segment.prizeKind !== "none") {
        prize = { kind: segment.prizeKind, value: segment.prizeValue, expiryHours: config.couponExpiryHours };
      }
    } else if (campaign.kind === "quiz" && play.outcome === "completed") {
      const config = validateQuizConfig(campaign.config);
      if (config.completionCoupon) {
        prize = { kind: config.completionCoupon.kind, value: config.completionCoupon.value, expiryHours: config.couponExpiryHours };
      }
    }
    if (!prize) return play;
    const coupon = await this.issuePromoCoupon(orgId, {
      ...prize, sourceRef: `nf6:play:${play.id}`, prefix: "WIN",
    });
    if (!coupon) return play;
    return this.t("promoPlay").update({
      where: { id: play.id }, data: { couponId: coupon.id, couponCode: coupon.code },
    });
  }

  // ---------- public: quiz ----------

  async publicQuizComplete(orgSlug: string, campaignId: string, dto: PublicQuizCompleteDto) {
    const org = await this.requireShop(orgSlug);
    const campaign = await this.loadPublicCampaign(org.id, campaignId, "quiz");
    this.assertLive(campaign);
    const { phone, phoneKey } = await this.phoneGate(org.id, dto.phone);
    const config = validateQuizConfig(campaign.config);

    const answers = Array.isArray(dto.answers) ? dto.answers : [];
    if (answers.length !== config.questions.length) {
      throw new BadRequestException("সব প্রশ্নের উত্তর দিতে হবে");
    }
    answers.forEach((a, i) => {
      if (!Number.isInteger(a) || a < 0 || a >= config.questions[i].options.length) {
        throw new BadRequestException("উত্তর সঠিক নয়");
      }
    });

    const existing = await this.t("promoPlay").findFirst({
      where: { campaignId: campaign.id, phoneKey },
    }).catch(() => null);
    if (existing) {
      const healed = await this.healPlayCoupon(org.id, campaign, existing);
      const products = existing.resultKey ? await this.quizProducts(org.id, existing.resultKey) : [];
      return { play: this.serializePlay(healed, true), resultKey: existing.resultKey ?? null, products };
    }

    const resultKey = scoreQuiz(config, answers);
    let row: any;
    try {
      row = await this.t("promoPlay").create({
        data: {
          organizationId: org.id,
          campaignId: campaign.id,
          phone,
          phoneKey,
          customerName: dto.name ? String(dto.name).trim().slice(0, 120) || null : null,
          outcome: "completed",
          resultKey,
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/unique|P2002/i.test(msg)) {
        const again = await this.t("promoPlay").findFirst({
          where: { campaignId: campaign.id, phoneKey },
        }).catch(() => null);
        if (again) {
          const products = again.resultKey ? await this.quizProducts(org.id, again.resultKey) : [];
          return { play: this.serializePlay(again, true), resultKey: again.resultKey ?? null, products };
        }
      }
      throw e;
    }

    if (config.completionCoupon) {
      const coupon = await this.issuePromoCoupon(org.id, {
        kind: config.completionCoupon.kind,
        value: config.completionCoupon.value,
        expiryHours: config.couponExpiryHours,
        sourceRef: `nf6:play:${row.id}`,
        prefix: "WIN",
      });
      if (coupon) {
        row = await this.t("promoPlay").update({
          where: { id: row.id }, data: { couponId: coupon.id, couponCode: coupon.code },
        });
      }
    }
    const products = resultKey ? await this.quizProducts(org.id, resultKey) : [];
    return { play: this.serializePlay(row, false), resultKey, products };
  }

  /** REAL products of THIS org only, for the winning mapping. */
  private async quizProducts(orgId: string, resultKey: string) {
    const serialize = (p: any) => ({
      id: p.id,
      name: p.name,
      slug: p.slug ?? null,
      priceMinor: String(p.priceMinor ?? 0),
      compareAtMinor: p.compareAtMinor != null ? String(p.compareAtMinor) : null,
      imageUrl: p.imageUrl ?? null,
      category: p.category ?? null,
    });
    const [kind, rest] = [resultKey.slice(0, resultKey.indexOf(":")), resultKey.slice(resultKey.indexOf(":") + 1)];
    if (kind === "cat") {
      const rows = (await this.t("product").findMany({
        where: { organizationId: orgId, categoryId: rest, status: "ACTIVE" },
        orderBy: { createdAt: "desc" }, take: 8,
      }).catch(() => [])) ?? [];
      return rows.map(serialize);
    }
    if (kind === "catname") {
      const rows = (await this.t("product").findMany({
        where: { organizationId: orgId, category: rest, status: "ACTIVE" },
        orderBy: { createdAt: "desc" }, take: 8,
      }).catch(() => [])) ?? [];
      return rows.map(serialize);
    }
    if (kind === "tag") {
      const tag = await this.t("productTag").findFirst({
        where: { organizationId: orgId, slug: rest },
      }).catch(() => null);
      if (!tag) return [];
      const assignments = (await this.t("productTagAssignment").findMany({
        where: { tagId: tag.id },
      }).catch(() => [])) ?? [];
      const ids = assignments.map((a: any) => a.productId);
      if (!ids.length) return [];
      const rows = (await this.t("product").findMany({
        where: { organizationId: orgId, id: { in: ids }, status: "ACTIVE" },
        orderBy: { createdAt: "desc" }, take: 8,
      }).catch(() => [])) ?? [];
      return rows.map(serialize);
    }
    return [];
  }

  // ---------- public: group buy ----------

  private async groupBuyJoins(orgId: string, campaignId: string) {
    return (await this.t("promoGroupBuyJoin").findMany({
      where: { organizationId: orgId, campaignId },
      orderBy: { createdAt: "asc" },
    }).catch(() => [])) ?? [];
  }

  /**
   * Settle a group buy against the clock + threshold:
   * - threshold met → every joiner without one gets a REAL
   *   product-scoped coupon and flips to "unlocked"
   *   (exactly-once via the sourceRef pre-check);
   * - window over + threshold unmet → open joins flip to
   *   "expired". Nothing was charged, nothing is issued. The
   *   flip + the staff joiner list is the v1 notification
   *   record — no send is claimed anywhere.
   */
  private async settleGroupBuy(orgId: string, campaign: any) {
    const config = validateGroupBuyConfig(campaign.config);
    const joins = await this.groupBuyJoins(orgId, campaign.id);
    if (joins.length >= config.requiredBuyers) {
      for (const join of joins) {
        if (join.couponId) {
          if (join.status !== "unlocked") {
            await this.t("promoGroupBuyJoin").update({
              where: { id: join.id }, data: { status: "unlocked" },
            }).catch(() => undefined);
          }
          continue;
        }
        const coupon = await this.issuePromoCoupon(orgId, {
          kind: config.discountKind,
          value: config.discountValue,
          expiryHours: config.couponExpiryHours,
          sourceRef: `nf6:groupbuy:${join.id}`,
          prefix: "GB",
          scopeProductId: config.productId,
        });
        if (coupon) {
          await this.t("promoGroupBuyJoin").update({
            where: { id: join.id },
            data: { status: "unlocked", couponId: coupon.id, couponCode: coupon.code },
          }).catch(() => undefined);
        }
      }
      return "unlocked" as const;
    }
    if (campaign.endsAt && new Date(campaign.endsAt).getTime() < Date.now()) {
      for (const join of joins) {
        if (join.status === "joined") {
          await this.t("promoGroupBuyJoin").update({
            where: { id: join.id }, data: { status: "expired" },
          }).catch(() => undefined);
        }
      }
      return "expired_unmet" as const;
    }
    return "open" as const;
  }

  private async groupBuyStatus(orgId: string, campaign: any) {
    const status = await this.settleGroupBuy(orgId, campaign);
    const joins = await this.groupBuyJoins(orgId, campaign.id);
    return { status, joinedCount: joins.length };
  }

  async publicGroupBuyJoin(orgSlug: string, campaignId: string, dto: PublicGroupBuyJoinDto) {
    const org = await this.requireShop(orgSlug);
    const campaign = await this.loadPublicCampaign(org.id, campaignId, "group_buy");
    this.assertLive(campaign);
    const { phone, phoneKey } = await this.phoneGate(org.id, dto.phone);
    const config = validateGroupBuyConfig(campaign.config);

    const existing = await this.t("promoGroupBuyJoin").findFirst({
      where: { campaignId: campaign.id, phoneKey },
    }).catch(() => null);
    if (existing) {
      const status = await this.groupBuyStatus(org.id, campaign);
      const fresh = await this.t("promoGroupBuyJoin").findFirst({
        where: { id: existing.id },
      }).catch(() => existing);
      return { join: this.serializeJoin(fresh, true), ...status, noPrepaymentNote: GROUP_BUY_NO_PREPAYMENT_NOTE };
    }

    let row: any;
    try {
      row = await this.t("promoGroupBuyJoin").create({
        data: {
          organizationId: org.id,
          campaignId: campaign.id,
          phone,
          phoneKey,
          customerName: dto.name ? String(dto.name).trim().slice(0, 120) || null : null,
          status: "joined",
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/unique|P2002/i.test(msg)) {
        const again = await this.t("promoGroupBuyJoin").findFirst({
          where: { campaignId: campaign.id, phoneKey },
        }).catch(() => null);
        if (again) {
          const status = await this.groupBuyStatus(org.id, campaign);
          return { join: this.serializeJoin(again, true), ...status, noPrepaymentNote: GROUP_BUY_NO_PREPAYMENT_NOTE };
        }
      }
      throw e;
    }

    // The Nth join may complete the group — settle immediately
    // so this joiner (and everyone before them) sees the truth.
    const status = await this.groupBuyStatus(org.id, campaign);
    const fresh = await this.t("promoGroupBuyJoin").findFirst({
      where: { id: row.id },
    }).catch(() => row);
    return {
      join: this.serializeJoin(fresh, false),
      ...status,
      requiredBuyers: config.requiredBuyers,
      noPrepaymentNote: GROUP_BUY_NO_PREPAYMENT_NOTE,
    };
  }

  private serializeJoin(row: any, alreadyJoined: boolean) {
    return {
      id: row.id,
      campaignId: row.campaignId,
      status: row.status,
      couponCode: row.couponCode ?? null,
      alreadyJoined,
    };
  }

  async publicGroupBuyStatus(orgSlug: string, campaignId: string) {
    const org = await this.requireShop(orgSlug);
    const campaign = await this.loadPublicCampaign(org.id, campaignId, "group_buy");
    const config = validateGroupBuyConfig(campaign.config);
    const status = await this.groupBuyStatus(org.id, campaign);
    return {
      campaignId: campaign.id,
      ...status,
      requiredBuyers: config.requiredBuyers,
      endsAt: campaign.endsAt ? new Date(campaign.endsAt).toISOString() : null,
      discountLabel: discountLabel(config.discountKind, config.discountValue),
      noPrepaymentNote: GROUP_BUY_NO_PREPAYMENT_NOTE,
    };
  }
}
