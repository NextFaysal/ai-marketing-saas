import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { decryptJson } from "../integrations/crypto";
import { MetaPublishClient } from "./meta-publish.client";
import { policyFindingsForText } from "./policy-check";
import { LlmFactory } from "../ai/llm/llm.factory";
import { parseMoneyToMinor, formatMinor } from "@repo/contracts";

export const OBJECTIVES = ["OUTCOME_SALES", "OUTCOME_TRAFFIC", "OUTCOME_LEADS", "OUTCOME_ENGAGEMENT", "OUTCOME_AWARENESS"] as const;
export const OPTIMIZATION_GOALS = ["LINK_CLICKS", "OFFSITE_CONVERSIONS", "LEAD_GENERATION", "REACH", "LANDING_PAGE_VIEWS"] as const;
const EDITABLE = ["draft", "rejected"];

export const BLUEPRINTS = [
  {
    key: "advantage_plus_sales", name: "Advantage+ Sales (Meta AI)", objective: "OUTCOME_SALES", advantagePlus: true,
    description: "Meta এর Advantage+ Sales: বাজেট ক্যাম্পেইন পর্যায়ে, Audience সম্প্রসারণে Meta এর AI। বিস্তৃত টার্গেটিং রাখুন — সংকীর্ণ Interest Advantage+ এর বিরুদ্ধে যায়। বাজেটটি শুরুর মান, নিজে ঠিক করে নিন।",
    adSet: { name: "BD Broad (Advantage+)", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", countries: ["BD"], ageMin: 18, ageMax: 65 },
    ad: { name: "Advantage+ Ad", primaryText: "সারা দেশে হোম ডেলিভারি। অর্ডার করতে লিংকে ক্লিক করুন।", headline: "এখনই অর্ডার করুন", linkUrl: "https://example.com/product", callToAction: "SHOP_NOW" },
  },
  {
    key: "cod_sales", name: "COD Sales (বাংলাদেশ)", objective: "OUTCOME_SALES",
    description: "ক্যাশ অন ডেলিভারি বিক্রির জন্য ওয়েবসাইট কনভার্সন ক্যাম্পেইন। বাজেটটি শুরুর মান, নিজে ঠিক করে নিন।",
    adSet: { name: "BD Broad 18-65", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", countries: ["BD"], ageMin: 18, ageMax: 65 },
    ad: { name: "Sales Ad", primaryText: "সারা দেশে ক্যাশ অন ডেলিভারি। অর্ডার করতে লিংকে ক্লিক করুন।", headline: "এখনই অর্ডার করুন", linkUrl: "https://example.com/product", callToAction: "SHOP_NOW" },
  },
  {
    key: "ctwa", name: "Click to WhatsApp", objective: "OUTCOME_ENGAGEMENT",
    description: "WhatsApp চ্যাট শুরু করানোর ক্যাম্পেইন; কথোপকথন ইনবক্সে আসে, সেখান থেকে অর্ডার করা যায়।",
    adSet: { name: "BD WhatsApp", dailyBudget: "300", optimizationGoal: "LINK_CLICKS", countries: ["BD"], ageMin: 18, ageMax: 55 },
    ad: { name: "Chat Ad", primaryText: "যেকোনো প্রশ্নে WhatsApp এ মেসেজ করুন, আমরা সাথে সাথে উত্তর দেব।", headline: "WhatsApp এ অর্ডার করুন", linkUrl: "https://wa.me/8801700000000", callToAction: "SEND_WHATSAPP_MESSAGE" },
  },
  {
    key: "catalog_sales", name: "Catalog Sales (Advantage ধাঁচের)", objective: "OUTCOME_SALES",
    description: "ক্যাটালগের পণ্য দিয়ে বিক্রির ক্যাম্পেইন কাঠামো। একটি Product Set বেছে নিলে তার আসল পণ্য দিয়ে বিজ্ঞাপন সাজানো যায়; Meta তে Advantage+ Catalog Sales চালু করতে ক্যাটালগটি আগে Push করুন (Audiences পেজ)। বাজেট শুরুর মান।",
    adSet: { name: "BD Catalog Broad", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", countries: ["BD"], ageMin: 18, ageMax: 65 },
    ad: { name: "Catalog Ad", primaryText: "আমাদের কালেকশন দেখুন — সারা দেশে ক্যাশ অন ডেলিভারি।", headline: "কালেকশন দেখুন", linkUrl: "https://example.com", callToAction: "SHOP_NOW" },
  },
  {
    key: "lead_form", name: "Lead Form", objective: "OUTCOME_LEADS",
    description: "Facebook লিড ফর্মের জন্য ক্যাম্পেইন কাঠামো। ফর্মটি Meta তে তৈরি করতে হবে; লিড সিঙ্ক Phase I এর কাজ।",
    adSet: { name: "BD Leads", dailyBudget: "300", optimizationGoal: "LEAD_GENERATION", countries: ["BD"], ageMin: 20, ageMax: 60 },
    ad: { name: "Lead Ad", primaryText: "আগ্রহী হলে ফর্মটি পূরণ করুন, আমাদের টিম যোগাযোগ করবে।", headline: "ফর্মটি পূরণ করুন", linkUrl: "https://example.com", callToAction: "SIGN_UP" },
  },
] as const;

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly llm: LlmFactory,
  ) {}

  // ---------- helpers ----------
  private async getPlanOrThrow(organizationId: string, planId: string) {
    const plan = await (this.prisma as any).campaignPlan.findFirst({ where: { id: planId, organizationId } });
    if (!plan) throw new NotFoundException("Campaign plan not found in this organization");
    return plan;
  }

  private async getPlanFull(organizationId: string, planId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    const adSets = await (this.prisma as any).campaignAdSet.findMany({ where: { planId }, orderBy: { createdAt: "asc" } });
    const withAds = [];
    for (const adSet of adSets) {
      const ads = await (this.prisma as any).campaignAd.findMany({ where: { adSetId: adSet.id }, orderBy: { createdAt: "asc" } });
      withAds.push({ ...adSet, dailyBudgetMinor: adSet.dailyBudgetMinor?.toString() ?? null, lifetimeBudgetMinor: adSet.lifetimeBudgetMinor?.toString() ?? null, ads });
    }
    const publishLogs = await (this.prisma as any).campaignPublishLog.findMany({ where: { planId }, orderBy: { createdAt: "desc" }, take: 50 });
    return { ...plan, adSets: withAds, publishLogs };
  }

  private assertEditable(plan: any) {
    if (!EDITABLE.includes(plan.status)) {
      throw new BadRequestException(`Plan is "${plan.status}" and can no longer be edited. Only draft/rejected plans are editable.`);
    }
  }

  private async logStep(planId: string, actorId: string | null, step: string, status: string, extra: { entityRef?: string; externalId?: string; error?: string } = {}) {
    await (this.prisma as any).campaignPublishLog.create({
      data: { planId, actorId, step, status, entityRef: extra.entityRef ?? null, externalId: extra.externalId ?? null, error: extra.error ?? null },
    });
  }

  // ---------- Builder ----------
  async createPlan(organizationId: string, actorId: string, dto: { name: string; objective: string; adAccountId: string }) {
    if (!(OBJECTIVES as readonly string[]).includes(dto.objective)) throw new BadRequestException("Invalid objective");
    const account = await (this.prisma as any).adAccount.findFirst({ where: { id: dto.adAccountId, organizationId } });
    if (!account) throw new BadRequestException("Ad account not found in this organization");
    if (account.platform !== "meta") throw new BadRequestException("Milestone 9 publishing supports Meta ad accounts only");
    const plan = await (this.prisma as any).campaignPlan.create({
      data: { organizationId, adAccountId: dto.adAccountId, name: dto.name, objective: dto.objective, status: "draft", createdById: actorId },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.plan_created", entityType: "CampaignPlan", entityId: plan.id });
    return this.getPlanFull(organizationId, plan.id);
  }

  async listPlans(organizationId: string) {
    const plans = await (this.prisma as any).campaignPlan.findMany({ where: { organizationId }, orderBy: { updatedAt: "desc" }, take: 100 });
    const out = [];
    for (const p of plans) {
      const adSets = await (this.prisma as any).campaignAdSet.count({ where: { planId: p.id } });
      out.push({ ...p, adSetCount: adSets });
    }
    return out;
  }

  async getPlan(organizationId: string, planId: string) { return this.getPlanFull(organizationId, planId); }

  async updatePlan(organizationId: string, planId: string, dto: { name?: string; objective?: string }) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    this.assertEditable(plan);
    if (dto.objective && !(OBJECTIVES as readonly string[]).includes(dto.objective)) throw new BadRequestException("Invalid objective");
    await (this.prisma as any).campaignPlan.update({ where: { id: planId }, data: { ...(dto.name ? { name: dto.name } : {}), ...(dto.objective ? { objective: dto.objective } : {}) } });
    return this.getPlanFull(organizationId, planId);
  }

  async deletePlan(organizationId: string, planId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    if (plan.status === "published") throw new BadRequestException("Published plans cannot be deleted (they exist on Meta). Archive them instead.");
    await (this.prisma as any).campaignPlan.delete({ where: { id: planId } });
    return { deleted: true };
  }

  async addAdSet(organizationId: string, planId: string, dto: {
    name: string; dailyBudget?: string; lifetimeBudget?: string; optimizationGoal: string;
    pageId?: string; pixelId?: string; countries: string[]; ageMin?: number; ageMax?: number; genders?: number[];
    interests?: string[]; customAudienceIds?: string[]; excludedAudienceIds?: string[];
    startTime?: string; endTime?: string;
  }) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    this.assertEditable(plan);
    if (!(OPTIMIZATION_GOALS as readonly string[]).includes(dto.optimizationGoal)) throw new BadRequestException("Invalid optimization goal");
    if (!dto.dailyBudget && !dto.lifetimeBudget) throw new BadRequestException("Either a daily or a lifetime budget is required");
    if (!dto.countries?.length) throw new BadRequestException("At least one target country is required");
    const adSet = await (this.prisma as any).campaignAdSet.create({
      data: {
        planId, name: dto.name,
        dailyBudgetMinor: dto.dailyBudget ? parseMoneyToMinor(dto.dailyBudget) : null,
        lifetimeBudgetMinor: dto.lifetimeBudget ? parseMoneyToMinor(dto.lifetimeBudget) : null,
        optimizationGoal: dto.optimizationGoal, pageId: dto.pageId ?? null, pixelId: dto.pixelId ?? null,
        targeting: {
          countries: dto.countries, ageMin: dto.ageMin ?? 18, ageMax: dto.ageMax ?? 65, genders: dto.genders ?? [0],
          ...(dto.interests?.length ? { interests: dto.interests } : {}),
          ...(dto.customAudienceIds?.length ? { customAudienceIds: dto.customAudienceIds } : {}),
          ...(dto.excludedAudienceIds?.length ? { excludedAudienceIds: dto.excludedAudienceIds } : {}),
        } as any,
        startTime: dto.startTime ? new Date(dto.startTime) : null,
        endTime: dto.endTime ? new Date(dto.endTime) : null,
      },
    });
    return { ...adSet, dailyBudgetMinor: adSet.dailyBudgetMinor?.toString() ?? null, lifetimeBudgetMinor: adSet.lifetimeBudgetMinor?.toString() ?? null };
  }

  async deleteAdSet(organizationId: string, planId: string, adSetId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    this.assertEditable(plan);
    await (this.prisma as any).campaignAdSet.delete({ where: { id: adSetId } });
    return { deleted: true };
  }

  async addAd(organizationId: string, planId: string, adSetId: string, dto: {
    name: string; primaryText: string; headline?: string; description?: string;
    linkUrl: string; callToAction?: string; imageUrl?: string; productId?: string; createdByAi?: boolean;
    format?: string; imageAssetId?: string; videoAssetId?: string;
    carouselCards?: { title: string; description?: string; linkUrl: string; imageUrl?: string; imageAssetId?: string }[];
  }) {
    const format = dto.format ?? "link";
    if (!["link", "video", "carousel"].includes(format)) throw new BadRequestException("format must be link, video or carousel");
    if (format === "video" && !dto.videoAssetId) throw new BadRequestException("A video ad needs a videoAssetId from the creative library");
    if (format === "carousel" && (!dto.carouselCards || dto.carouselCards.length < 2 || dto.carouselCards.length > 10)) {
      throw new BadRequestException("A carousel ad needs 2-10 cards");
    }
    const plan = await this.getPlanOrThrow(organizationId, planId);
    this.assertEditable(plan);
    const adSet = await (this.prisma as any).campaignAdSet.findFirst({ where: { id: adSetId, planId } });
    if (!adSet) throw new NotFoundException("Ad set not found in this plan");
    const ad = await (this.prisma as any).campaignAd.create({
      data: {
        adSetId, name: dto.name, primaryText: dto.primaryText, headline: dto.headline ?? null,
        description: dto.description ?? null, linkUrl: dto.linkUrl, callToAction: dto.callToAction ?? "SHOP_NOW",
        imageUrl: dto.imageUrl ?? null, productId: dto.productId ?? null, createdByAi: dto.createdByAi ?? false,
        format, imageAssetId: dto.imageAssetId ?? null, videoAssetId: dto.videoAssetId ?? null,
        carouselCards: dto.carouselCards ?? undefined,
      },
    });
    return ad;
  }

  async deleteAd(organizationId: string, planId: string, adId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    this.assertEditable(plan);
    await (this.prisma as any).campaignAd.delete({ where: { id: adId } });
    return { deleted: true };
  }

  // ---------- Validation + approval workflow ----------
  validatePlan(fullPlan: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!fullPlan.adSets?.length) errors.push("At least one ad set is required");
    if (fullPlan.advantagePlus && fullPlan.objective !== "OUTCOME_SALES") {
      errors.push("Advantage+ is a Sales format: the plan objective must be OUTCOME_SALES");
    }
    for (const adSet of fullPlan.adSets ?? []) {
      if (!adSet.dailyBudgetMinor && !adSet.lifetimeBudgetMinor) errors.push(`Ad set "${adSet.name}": budget missing`);
      if (adSet.dailyBudgetMinor && BigInt(adSet.dailyBudgetMinor) <= 0n) errors.push(`Ad set "${adSet.name}": budget must be positive`);
      const countries = (adSet.targeting as any)?.countries ?? [];
      if (!countries.length) errors.push(`Ad set "${adSet.name}": no target countries`);
      if (!adSet.pageId) errors.push(`Ad set "${adSet.name}": Facebook Page ID is required to run ads`);
      if (adSet.optimizationGoal === "OFFSITE_CONVERSIONS" && !adSet.pixelId) errors.push(`Ad set "${adSet.name}": a Pixel ID is required for OFFSITE_CONVERSIONS`);
      if (adSet.optimizationGoal === "LEAD_GENERATION" && !adSet.pageId) errors.push(`Ad set "${adSet.name}": a Page ID is required for lead ads`);
      if (!adSet.ads?.length) errors.push(`Ad set "${adSet.name}": at least one ad is required`);
      for (const ad of adSet.ads ?? []) {
        if (!ad.primaryText?.trim()) errors.push(`Ad "${ad.name}": primary text is empty`);
        if (!ad.linkUrl || !/^https?:\/\//i.test(ad.linkUrl)) errors.push(`Ad "${ad.name}": a valid link URL is required`);
        if (ad.format === "video" && !ad.videoAssetId) errors.push(`Ad "${ad.name}": video format needs a creative-library video`);
        if (ad.format === "carousel" && (!Array.isArray(ad.carouselCards) || ad.carouselCards.length < 2)) errors.push(`Ad "${ad.name}": carousel needs at least 2 cards`);
      }
    }
    return { valid: errors.length === 0, errors };
  }

  async submitForApproval(organizationId: string, actorId: string, planId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    if (!EDITABLE.includes(plan.status)) throw new BadRequestException(`Plan in status "${plan.status}" cannot be submitted`);
    const full = await this.getPlanFull(organizationId, planId);
    const { valid, errors } = this.validatePlan(full);
    if (!valid) throw new BadRequestException(`Plan is not ready for approval: ${errors.join("; ")}`);
    await (this.prisma as any).campaignPlan.update({ where: { id: planId }, data: { status: "pending_approval", rejectionReason: null } });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.submitted", entityType: "CampaignPlan", entityId: planId });
    return this.getPlanFull(organizationId, planId);
  }

  async approve(organizationId: string, actorId: string, planId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    if (plan.status !== "pending_approval") throw new BadRequestException(`Only pending_approval plans can be approved (current: ${plan.status})`);
    await (this.prisma as any).campaignPlan.update({
      where: { id: planId }, data: { status: "approved", approvedById: actorId, approvedAt: new Date() },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.approved", entityType: "CampaignPlan", entityId: planId });
    return this.getPlanFull(organizationId, planId);
  }

  async reject(organizationId: string, actorId: string, planId: string, reason: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    if (plan.status !== "pending_approval") throw new BadRequestException(`Only pending_approval plans can be rejected (current: ${plan.status})`);
    await (this.prisma as any).campaignPlan.update({
      where: { id: planId }, data: { status: "rejected", rejectionReason: reason.slice(0, 500) },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.rejected", entityType: "CampaignPlan", entityId: planId, metadata: { reason } });
    return this.getPlanFull(organizationId, planId);
  }

  // ---------- Publishing ----------
  private async publishClient(organizationId: string, plan: any): Promise<{ client: MetaPublishClient; account: any }> {
    const account = await (this.prisma as any).adAccount.findFirst({ where: { id: plan.adAccountId, organizationId } });
    if (!account) throw new BadRequestException("Ad account no longer exists");
    if (!account.integrationId) throw new BadRequestException("This ad account has no Meta API connection (it was created for CSV/manual data) and cannot publish. Connect Meta first.");
    const integration = await (this.prisma as any).integration.findUnique({ where: { id: account.integrationId }, include: { credential: true } });
    if (!integration?.credential) throw new BadRequestException("Meta integration credentials are missing");
    const secrets = decryptJson<{ accessToken: string }>(integration.credential.encryptedData);
    return { client: new MetaPublishClient(secrets.accessToken), account };
  }

  private toGraphTargeting(targeting: any, advantagePlus = false): Record<string, unknown> {
    const out: Record<string, unknown> = {
      geo_locations: { countries: targeting.countries ?? [] },
      ...(targeting.ageMin ? { age_min: targeting.ageMin } : {}),
      ...(targeting.ageMax ? { age_max: targeting.ageMax } : {}),
      ...(Array.isArray(targeting.genders) ? { genders: targeting.genders } : {}),
    };
    // Phase H: interests / behaviors via flexible_spec, and saved
    // custom audiences (external Meta ids) as include / exclude.
    const flexible: Record<string, unknown>[] = [];
    if (Array.isArray(targeting.interests) && targeting.interests.length) {
      flexible.push({ interests: targeting.interests.map((i: any) => (typeof i === "string" ? { name: i } : i)) });
    }
    if (Array.isArray(targeting.behaviors) && targeting.behaviors.length) {
      flexible.push({ behaviors: targeting.behaviors });
    }
    if (flexible.length) out.flexible_spec = flexible;
    if (Array.isArray(targeting.customAudienceIds) && targeting.customAudienceIds.length) {
      out.custom_audiences = targeting.customAudienceIds.map((id: string) => ({ id }));
    }
    // Advantage+ audience expansion (Milestone 32): Meta widens the
    // audience automatically when this is on.
    if (advantagePlus) out.targeting_automation = { advantage_audience: 1 };
    if (Array.isArray(targeting.excludedAudienceIds) && targeting.excludedAudienceIds.length) {
      out.excluded_custom_audiences = targeting.excludedAudienceIds.map((id: string) => ({ id }));
    }
    return out;
  }

  /** Resolve creative-library assets to Meta media ids for an ad.
   * Throws (failing the publish honestly) when an asset is missing,
   * not ready, or was never confirmed by Meta. */
  private async resolveAdMedia(organizationId: string, ad: any): Promise<{
    imageHash?: string; videoId?: string;
    carouselCards?: { title: string; description?: string; linkUrl: string; imageUrl?: string; imageHash?: string }[];
  }> {
    const assetOrThrow = async (assetId: string, kind: string) => {
      const asset = await (this.prisma as any).creativeAsset.findFirst({ where: { id: assetId, organizationId } });
      if (!asset) throw new Error(`Creative asset ${assetId} not found`);
      if (asset.kind !== kind) throw new Error(`Creative asset "${asset.name}" is a ${asset.kind}, not a ${kind}`);
      if (asset.status !== "ready") throw new Error(`Creative asset "${asset.name}" is not ready on Meta (status: ${asset.status})`);
      return asset;
    };
    if (ad.format === "video") {
      const asset = await assetOrThrow(ad.videoAssetId, "video");
      if (!asset.externalVideoId) throw new Error(`Video asset "${asset.name}" has no Meta video id`);
      return { videoId: asset.externalVideoId, imageHash: undefined };
    }
    if (ad.format === "carousel") {
      const cards = [];
      for (const card of ad.carouselCards ?? []) {
        let imageHash: string | undefined;
        if (card.imageAssetId) {
          const asset = await assetOrThrow(card.imageAssetId, "image");
          imageHash = asset.externalHash ?? undefined;
        }
        cards.push({ title: card.title, description: card.description, linkUrl: card.linkUrl, imageUrl: card.imageUrl, imageHash });
      }
      return { carouselCards: cards };
    }
    if (ad.imageAssetId) {
      const asset = await assetOrThrow(ad.imageAssetId, "image");
      return { imageHash: asset.externalHash ?? undefined };
    }
    return {};
  }

  // ---------- Duplicate, templates, blueprints (Phase H) ----------
  async duplicatePlan(organizationId: string, actorId: string, planId: string, opts?: { asTemplate?: boolean; name?: string }) {
    const full = await this.getPlanFull(organizationId, planId);
    const copy = await (this.prisma as any).campaignPlan.create({
      data: {
        organizationId, adAccountId: full.adAccountId,
        name: opts?.name ?? (opts?.asTemplate ? full.name : `${full.name} (কপি)`),
        objective: full.objective, status: "draft", isTemplate: Boolean(opts?.asTemplate), createdById: actorId,
        advantagePlus: full.advantagePlus === true,
      },
    });
    for (const adSet of full.adSets ?? []) {
      const newSet = await (this.prisma as any).campaignAdSet.create({
        data: {
          planId: copy.id, name: adSet.name,
          dailyBudgetMinor: adSet.dailyBudgetMinor ?? undefined, lifetimeBudgetMinor: adSet.lifetimeBudgetMinor ?? undefined,
          billingEvent: adSet.billingEvent, optimizationGoal: adSet.optimizationGoal,
          pageId: adSet.pageId ?? undefined, pixelId: adSet.pixelId ?? undefined, targeting: adSet.targeting ?? {},
        },
      });
      for (const ad of adSet.ads ?? []) {
        await (this.prisma as any).campaignAd.create({
          data: {
            adSetId: newSet.id, name: ad.name, primaryText: ad.primaryText, headline: ad.headline ?? undefined,
            description: ad.description ?? undefined, linkUrl: ad.linkUrl, callToAction: ad.callToAction,
            imageUrl: ad.imageUrl ?? undefined, productId: ad.productId ?? undefined,
            format: ad.format ?? "link", imageAssetId: ad.imageAssetId ?? undefined,
            videoAssetId: ad.videoAssetId ?? undefined, carouselCards: ad.carouselCards ?? undefined,
            createdByAi: ad.createdByAi ?? false,
          },
        });
      }
    }
    await this.audit.log({ organizationId, userId: actorId, action: opts?.asTemplate ? "campaign.template_created" : "campaign.duplicated", entityType: "CampaignPlan", entityId: copy.id, metadata: { sourcePlanId: planId } });
    return this.getPlanFull(organizationId, copy.id);
  }

  async listTemplates(organizationId: string) {
    return (this.prisma as any).campaignPlan.findMany({
      where: { organizationId, isTemplate: true }, orderBy: { createdAt: "desc" }, take: 50,
    });
  }

  listBlueprints() {
    return BLUEPRINTS;
  }

  /** Instantiate a blueprint into an editable draft. Budget values are
   * editable starting points chosen by the owner, NOT recommendations
   * based on any performance data. A product, when chosen, grounds the
   * ad copy in its real catalog name and price. */
  async instantiateBlueprint(organizationId: string, actorId: string, dto: { blueprintKey: string; adAccountId: string; productId?: string }) {
    const bp = BLUEPRINTS.find((b) => b.key === dto.blueprintKey);
    if (!bp) throw new BadRequestException("Unknown blueprint");
    const account = await (this.prisma as any).adAccount.findFirst({ where: { id: dto.adAccountId, organizationId } });
    if (!account) throw new NotFoundException("Ad account not found");
    let product: any = null;
    if (dto.productId) {
      product = await (this.prisma as any).product.findFirst({ where: { id: dto.productId, organizationId } });
      if (!product) throw new NotFoundException("Product not found");
    }
    const plan = await this.createPlan(organizationId, actorId, { name: bp.name, objective: bp.objective, adAccountId: dto.adAccountId });
    if ((bp as any).advantagePlus) {
      await (this.prisma as any).campaignPlan.update({ where: { id: plan.id }, data: { advantagePlus: true } });
    }
    const adSet = await this.addAdSet(organizationId, plan.id, {
      name: bp.adSet.name, dailyBudget: bp.adSet.dailyBudget, optimizationGoal: bp.adSet.optimizationGoal,
      countries: [...bp.adSet.countries], ageMin: bp.adSet.ageMin, ageMax: bp.adSet.ageMax,
    });
    const priceText = product ? ` মাত্র ${Number(BigInt(product.priceMinor)) / 100} টাকায়।` : "";
    await this.addAd(organizationId, plan.id, adSet.id, {
      name: bp.ad.name,
      primaryText: (product ? `${product.name} —` : "") + bp.ad.primaryText + priceText,
      headline: product ? product.name : bp.ad.headline,
      linkUrl: bp.ad.linkUrl, callToAction: bp.ad.callToAction,
      imageUrl: product?.imageUrl ?? undefined, productId: product?.id,
    });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.blueprint_instantiated", entityType: "CampaignPlan", entityId: plan.id, metadata: { blueprint: bp.key } });
    return this.getPlanFull(organizationId, plan.id);
  }

  /**
   * Publishes an APPROVED plan. Every object is created PAUSED.
   * Idempotent resume: entities that already have an external id are
   * skipped, so a retry after a partial failure never duplicates a
   * campaign on Meta. Every step is logged; the plan is "published"
   * only when every entity has a confirmed external id.
   */
  async publish(organizationId: string, actorId: string, planId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    if (!["approved", "publish_failed"].includes(plan.status)) {
      throw new ForbiddenException(`Plan must be approved before publishing (current: ${plan.status}). Publishing without recorded approval is not possible.`);
    }
    const full = await this.getPlanFull(organizationId, planId);
    const { valid, errors } = this.validatePlan(full);
    if (!valid) throw new BadRequestException(`Plan no longer validates: ${errors.join("; ")}`);
    const { client, account } = await this.publishClient(organizationId, plan);
    await (this.prisma as any).campaignPlan.update({ where: { id: planId }, data: { status: "publishing" } });

    try {
      let campaignExternalId = plan.externalCampaignId as string | null;
      if (!campaignExternalId) {
        // Advantage+ (Milestone 32): the budget lives on the CAMPAIGN
        // (Advantage Campaign Budget) — the first ad set's daily
        // budget becomes it — and ad sets carry no budget of their
        // own. The choice is logged so the structure is auditable.
        const campaignBudget = plan.advantagePlus ? (full.adSets.find((a: any) => a.dailyBudgetMinor)?.dailyBudgetMinor ?? undefined) : undefined;
        if (plan.advantagePlus && !campaignBudget) {
          throw new BadRequestException("Advantage+ needs at least one ad set with a daily budget — it becomes the campaign budget");
        }
        const created = await client.createCampaign(account.externalId, { name: plan.name, objective: plan.objective, dailyBudgetMinor: campaignBudget });
        if (plan.advantagePlus) {
          await this.logStep(planId, actorId, "advantage_plus", "success", { externalId: campaignBudget }).catch(() => undefined);
          await this.audit.log({ organizationId, userId: actorId, action: "campaign.advantage_plus_publish", entityType: "CampaignPlan", entityId: planId, metadata: { campaignBudgetMinor: campaignBudget, note: "Budget moved to campaign level; ad sets created without budgets; targeting_automation.advantage_audience = 1" } }).catch(() => undefined);
        }
        campaignExternalId = created.id;
        await (this.prisma as any).campaignPlan.update({ where: { id: planId }, data: { externalCampaignId: campaignExternalId, metaStatus: "PAUSED" } });
        await this.logStep(planId, actorId, "campaign", "success", { externalId: campaignExternalId });
      }
      for (const adSet of full.adSets) {
        let adSetExternalId = adSet.externalAdSetId as string | null;
        if (!adSetExternalId) {
          const promotedObject = adSet.optimizationGoal === "OFFSITE_CONVERSIONS" && adSet.pixelId
            ? { pixel_id: adSet.pixelId, custom_event_type: "PURCHASE" }
            : adSet.optimizationGoal === "LEAD_GENERATION" && adSet.pageId ? { page_id: adSet.pageId } : undefined;
          const created = await client.createAdSet(account.externalId, {
            name: adSet.name, campaignId: campaignExternalId,
            dailyBudgetMinor: plan.advantagePlus ? undefined : (adSet.dailyBudgetMinor ?? undefined),
            lifetimeBudgetMinor: plan.advantagePlus ? undefined : (adSet.lifetimeBudgetMinor ?? undefined),
            billingEvent: adSet.billingEvent ?? "IMPRESSIONS",
            optimizationGoal: adSet.optimizationGoal,
            targeting: this.toGraphTargeting(adSet.targeting ?? {}, plan.advantagePlus === true),
            promotedObject,
            startTime: adSet.startTime ? new Date(adSet.startTime).toISOString() : undefined,
            endTime: adSet.endTime ? new Date(adSet.endTime).toISOString() : undefined,
          });
          adSetExternalId = created.id;
          await (this.prisma as any).campaignAdSet.update({ where: { id: adSet.id }, data: { externalAdSetId: adSetExternalId } });
          await this.logStep(planId, actorId, "adset", "success", { entityRef: adSet.id, externalId: adSetExternalId });
        }
        for (const ad of adSet.ads) {
          if (ad.externalAdId) continue;
          const resolved = await this.resolveAdMedia(organizationId, ad);
          const full = await this.getPlanOrThrow(organizationId, planId);
          const tagged = this.tagUtm(ad.linkUrl, full.name);
          const taggedCards = resolved.carouselCards?.map((card) => ({ ...card, linkUrl: this.tagUtm(card.linkUrl, full.name).url }));
          if (tagged.changed) {
            await this.logStep(planId, actorId, "utm_tagged", "success", { entityRef: ad.id }).catch(() => undefined);
          }
          const created = await client.createAd(account.externalId, {
            name: ad.name, adSetId: adSetExternalId, pageId: adSet.pageId,
            linkUrl: tagged.url, primaryText: ad.primaryText, headline: ad.headline ?? undefined,
            description: ad.description ?? undefined, imageUrl: ad.imageUrl ?? undefined,
            imageHash: resolved.imageHash, videoId: resolved.videoId, carouselCards: taggedCards,
            callToAction: ad.callToAction ?? "SHOP_NOW",
          });
          await (this.prisma as any).campaignAd.update({ where: { id: ad.id }, data: { externalAdId: created.id } });
          await this.logStep(planId, actorId, "ad", "success", { entityRef: ad.id, externalId: created.id });
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Publish failed";
      await (this.prisma as any).campaignPlan.update({ where: { id: planId }, data: { status: "publish_failed" } });
      await this.logStep(planId, actorId, "publish", "error", { error: message });
      await this.audit.log({ organizationId, userId: actorId, action: "campaign.publish_failed", entityType: "CampaignPlan", entityId: planId, metadata: { error: message } });
      throw new BadRequestException(`Publishing did NOT complete: ${message}. Already-created objects are saved; retrying Publish resumes without duplicating them.`);
    }

    await (this.prisma as any).campaignPlan.update({
      where: { id: planId }, data: { status: "published", metaStatus: "PAUSED", publishedAt: new Date() },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.published", entityType: "CampaignPlan", entityId: planId });
    return this.getPlanFull(organizationId, planId);
  }

  /** Live budget edit (Phase I): change a published plan's ad set
   * budget on Meta FIRST; local state and the publish log update only
   * after Meta accepts. OWNER/ADMIN enforced at the controller. */
  async updateAdSetBudget(organizationId: string, actorId: string, planId: string, adSetId: string, dto: { dailyBudget?: string; lifetimeBudget?: string }) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    if (plan.status !== "published") throw new BadRequestException("Only published plans have live budgets to edit");
    const adSet = await (this.prisma as any).campaignAdSet.findFirst({ where: { id: adSetId, planId } });
    if (!adSet?.externalAdSetId) throw new BadRequestException("This ad set has no Meta ad set id (not published)");
    const toMinor = (v?: string) => {
      if (!v) return undefined;
      const n = Math.round(Number(v) * 100);
      if (!Number.isFinite(n) || n <= 0) throw new BadRequestException("Budget must be a positive amount");
      return BigInt(n);
    };
    const daily = toMinor(dto.dailyBudget);
    const lifetime = toMinor(dto.lifetimeBudget);
    if (daily === undefined && lifetime === undefined) throw new BadRequestException("Provide dailyBudget or lifetimeBudget");
    const { client } = await this.publishClient(organizationId, plan);
    await client.updateAdSetBudget(adSet.externalAdSetId, { dailyBudgetMinor: daily, lifetimeBudgetMinor: lifetime });
    const before = { dailyBudgetMinor: adSet.dailyBudgetMinor?.toString() ?? null, lifetimeBudgetMinor: adSet.lifetimeBudgetMinor?.toString() ?? null };
    await (this.prisma as any).campaignAdSet.update({
      where: { id: adSetId },
      data: {
        ...(daily !== undefined ? { dailyBudgetMinor: daily } : {}),
        ...(lifetime !== undefined ? { lifetimeBudgetMinor: lifetime } : {}),
      },
    });
    await this.logStep(planId, actorId, "budget_update", "success", {
      entityRef: adSetId, externalId: adSet.externalAdSetId,
    }).catch(() => undefined);
    // Before/after values are preserved in the audit log entry below.
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.budget_updated", entityType: "CampaignAdSet", entityId: adSetId, metadata: { before, daily: daily?.toString(), lifetime: lifetime?.toString() } });
    return this.getPlanFull(organizationId, planId);
  }

  /** Published-object status sync (Phase J): read effective_status
   * for the campaign, every ad set and every ad from Meta and store
   * it. This is how DISAPPROVED ads and outside changes stop being
   * invisible. Health is computed from what Meta reports, never
   * assumed. */
  async syncObjectStatuses(organizationId: string, actorId: string, planId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    if (!plan.externalCampaignId) throw new BadRequestException("This plan has no Meta campaign yet (not published)");
    const full = await this.getPlanFull(organizationId, planId);
    const { client } = await this.publishClient(organizationId, plan);
    const issues: { level: string; name: string; status: string; info?: unknown }[] = [];
    const campaignStatus = await client.getObjectStatus(plan.externalCampaignId);
    await (this.prisma as any).campaignPlan.update({
      where: { id: planId },
      data: { metaEffectiveStatus: campaignStatus.effectiveStatus ?? null, lastStatusSyncAt: new Date() },
    });
    if (campaignStatus.effectiveStatus && campaignStatus.effectiveStatus !== "ACTIVE" && campaignStatus.effectiveStatus !== "PAUSED") {
      issues.push({ level: "campaign", name: plan.name, status: campaignStatus.effectiveStatus, info: campaignStatus.issuesInfo });
    }
    for (const adSet of full.adSets) {
      if (!adSet.externalAdSetId) continue;
      const st = await client.getObjectStatus(adSet.externalAdSetId);
      await (this.prisma as any).campaignAdSet.update({ where: { id: adSet.id }, data: { effectiveStatus: st.effectiveStatus ?? null } });
      if (st.effectiveStatus && !["ACTIVE", "PAUSED"].includes(st.effectiveStatus)) {
        issues.push({ level: "adset", name: adSet.name, status: st.effectiveStatus, info: st.issuesInfo });
      }
      for (const ad of adSet.ads) {
        if (!ad.externalAdId) continue;
        const ast = await client.getObjectStatus(ad.externalAdId);
        await (this.prisma as any).campaignAd.update({
          where: { id: ad.id },
          data: { effectiveStatus: ast.effectiveStatus ?? null, issuesInfo: (ast.issuesInfo as any) ?? null },
        });
        if (ast.effectiveStatus && !["ACTIVE", "PAUSED"].includes(ast.effectiveStatus)) {
          issues.push({ level: "ad", name: ad.name, status: ast.effectiveStatus, info: ast.issuesInfo });
        }
      }
    }
    await this.logStep(planId, actorId, "status_sync", "success", {}).catch(() => undefined);
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.status_synced", entityType: "CampaignPlan", entityId: planId, metadata: { issueCount: issues.length } });
    const updated = await this.getPlanFull(organizationId, planId);
    return { ...updated, healthIssues: issues };
  }

  /** Scheduler entry: sync statuses for every published plan of the org. */
  async syncAllPublishedStatuses(organizationId: string, actorId: string) {
    const plans = await (this.prisma as any).campaignPlan.findMany({
      where: { organizationId, status: "published" },
    });
    let synced = 0; const withIssues: string[] = []; const errors: string[] = [];
    for (const plan of plans) {
      try {
        const out = await this.syncObjectStatuses(organizationId, actorId, plan.id);
        synced++;
        if ((out as any).healthIssues?.length) withIssues.push(plan.id);
      } catch (e) {
        errors.push(`${plan.id}: ${e instanceof Error ? e.message : "sync failed"}`);
      }
    }
    return { plans: plans.length, synced, withIssues, errors };
  }

  /** Change ONE ad set's status on Meta (used by dayparting and
   * ad-level automation). Meta confirms first; local state follows. */
  async setAdSetStatus(organizationId: string, actorId: string, planId: string, adSetId: string, target: "ACTIVE" | "PAUSED") {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    const adSet = await (this.prisma as any).campaignAdSet.findFirst({ where: { id: adSetId, planId } });
    if (!adSet?.externalAdSetId) throw new BadRequestException("This ad set has no Meta ad set id");
    const { client } = await this.publishClient(organizationId, plan);
    await client.setObjectStatus(adSet.externalAdSetId, target);
    return { adSetId, target };
  }

  /** Pause ONE ad on Meta (rules v3 pause_ad). Confirmed by Meta. */
  async setAdStatus(organizationId: string, actorId: string, planId: string, adId: string, target: "ACTIVE" | "PAUSED") {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    const ad = await (this.prisma as any).campaignAd.findFirst({ where: { id: adId } });
    if (!ad?.externalAdId) throw new BadRequestException("This ad has no Meta ad id");
    const { client } = await this.publishClient(organizationId, plan);
    await client.setObjectStatus(ad.externalAdId, target);
    await (this.prisma as any).campaignAd.update({ where: { id: adId }, data: { effectiveStatus: target === "ACTIVE" ? "ACTIVE" : "PAUSED" } }).catch(() => undefined);
    return { adId, target };
  }

  /** Dayparting (Phase K): windows are [{day 0-6 (0=Sunday),
   * startHour, endHour}] in the ad set's timezone. Inside any window
   * the ad set should be ACTIVE, otherwise PAUSED. Only transitions
   * call Meta; every transition is logged on the plan. */
  async setDaypart(organizationId: string, actorId: string, planId: string, adSetId: string, dto: { windows: { day: number; startHour: number; endHour: number }[]; tz?: string }) {
    await this.getPlanOrThrow(organizationId, planId);
    for (const w of dto.windows ?? []) {
      if (w.day < 0 || w.day > 6 || w.startHour < 0 || w.startHour > 23 || w.endHour < 1 || w.endHour > 24 || w.startHour >= w.endHour) {
        throw new BadRequestException("Each window needs day 0-6, startHour 0-23 and endHour 1-24 with start < end");
      }
    }
    await (this.prisma as any).campaignAdSet.update({
      where: { id: adSetId },
      data: { daypart: (dto.windows ?? []) as any, daypartTz: dto.tz ?? "Asia/Dhaka", daypartState: null },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.daypart_set", entityType: "CampaignAdSet", entityId: adSetId, metadata: { windows: dto.windows?.length ?? 0 } });
    return this.getPlanFull(organizationId, planId);
  }

  daypartDesiredState(windows: { day: number; startHour: number; endHour: number }[], tz: string, at: Date): "ACTIVE" | "PAUSED" {
    try {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(at);
      const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
      const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
      const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
      const inside = (windows ?? []).some((w) => w.day === day && hour >= w.startHour && hour < w.endHour);
      return inside ? "ACTIVE" : "PAUSED";
    } catch {
      return "PAUSED";
    }
  }

  /** Scheduler entry: apply dayparting transitions for the org. */
  async applyDayparting(organizationId: string, actorId: string) {
    const allSets = await (this.prisma as any).campaignAdSet.findMany({ where: { plan: { organizationId } } });
    let checked = 0; let transitioned = 0; const errors: string[] = [];
    for (const adSet of allSets as any[]) {
      if (!adSet.daypart || !adSet.externalAdSetId) continue;
      const plan = await (this.prisma as any).campaignPlan.findFirst({ where: { id: adSet.planId, organizationId } });
      if (!plan || plan.status !== "published") continue;
      checked++;
      const desired = this.daypartDesiredState(adSet.daypart as any, adSet.daypartTz ?? "Asia/Dhaka", new Date());
      if (adSet.daypartState === desired) continue;
      try {
        await this.setAdSetStatus(organizationId, actorId, plan.id, adSet.id, desired);
        await (this.prisma as any).campaignAdSet.update({ where: { id: adSet.id }, data: { daypartState: desired } });
        await this.logStep(plan.id, actorId, desired === "ACTIVE" ? "daypart_on" : "daypart_off", "success", { entityRef: adSet.id, externalId: adSet.externalAdSetId }).catch(() => undefined);
        transitioned++;
      } catch (e) {
        errors.push(`${adSet.id}: ${e instanceof Error ? e.message : "daypart transition failed"}`);
      }
    }
    return { checked, transitioned, errors };
  }

  /** Structured A/B test (Phase K): clone a plan as a variant of a
   * test group. The clone is a fresh draft (no external ids) via
   * duplicatePlan; the ORIGINAL joins the group too when it has no
   * group yet. Winner metric defaults to first-party CPA. */
  async createAbVariant(organizationId: string, actorId: string, planId: string, dto: { variant?: string; metric?: string }) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    const groupId = plan.abGroupId ?? `ab-${Date.now().toString(36)}-${plan.id.slice(0, 6)}`;
    const metric = dto.metric ?? plan.abMetric ?? "first_party_cpa";
    if (!plan.abGroupId) {
      await (this.prisma as any).campaignPlan.update({
        where: { id: plan.id },
        data: { abGroupId: groupId, abVariant: plan.abVariant ?? "A", abMetric: metric },
      });
    }
    const clone: any = await this.duplicatePlan(organizationId, actorId, planId, {});
    const variant = dto.variant ?? "B";
    await (this.prisma as any).campaignPlan.update({
      where: { id: clone.id },
      data: { abGroupId: groupId, abVariant: variant, abMetric: metric, name: `${plan.name} [${variant}]` },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.ab_variant_created", entityType: "CampaignPlan", entityId: clone.id, metadata: { groupId, variant, metric } });
    return this.getPlanFull(organizationId, clone.id);
  }

  /** Policy pre-flight (Phase L): deterministic checks over every
   * ad's copy in the plan. Findings quote the offending snippet and
   * explain the rule in plain language. Passing pre-flight does
   * NOT guarantee Meta approval — it removes preventable causes. */
  async preflight(organizationId: string, planId: string) {
    const full = await this.getPlanFull(organizationId, planId);
    const findings: any[] = [];
    let checkedAds = 0;
    for (const adSet of full.adSets) {
      for (const ad of adSet.ads) {
        checkedAds++;
        for (const field of ["primaryText", "headline", "description"] as const) {
          const text = String((ad as any)[field] ?? "");
          if (!text.trim()) continue;
          for (const f of policyFindingsForText(text)) {
            findings.push({ adId: ad.id, adName: ad.name, field, ...f });
          }
        }
      }
    }
    const summary = {
      high: findings.filter((f) => f.severity === "high").length,
      medium: findings.filter((f) => f.severity === "medium").length,
      low: findings.filter((f) => f.severity === "low").length,
    };
    return { planId, checkedAds, findings, summary, disclaimer: "Pre-flight পাস করা মানে Meta অনুমোদনের নিশ্চয়তা নয় — এটি প্রতিরোধযোগ্য Reject এর কারণগুলো সরায়।" };
  }

  /** A/B test board: variants of each group with platform +
   * first-party numbers side by side. A winner is named ONLY when
   * every compared variant spent at least 100 major units and the
   * metric exists for all of them — otherwise "insufficient data",
   * never a guess. */
  async abTestResults(organizationId: string) {
    const plans = await (this.prisma as any).campaignPlan.findMany({ where: { organizationId } });
    const groups = new Map<string, any[]>();
    for (const p of plans as any[]) {
      if (!p.abGroupId) continue;
      const arr = groups.get(p.abGroupId) ?? [];
      arr.push(p);
      groups.set(p.abGroupId, arr);
    }
    const out: any[] = [];
    for (const [groupId, members] of groups) {
      const metric = members[0].abMetric ?? "first_party_cpa";
      const variants: any[] = [];
      for (const p of members) {
        let spend = 0n; let platformConv = 0n;
        if (p.externalCampaignId) {
          const rows = await (this.prisma as any).dailyAdMetric.findMany({ where: { organizationId, campaignExternalId: p.externalCampaignId }, take: 10000 });
          for (const r of rows as any[]) {
            if ((r.adExternalId ?? "") !== "") continue;
            spend += BigInt(r.spendMinor ?? 0); platformConv += BigInt(r.conversions ?? 0);
          }
        }
        let fpRevenue = 0n; const fpOrders = new Set<string>();
        const credits = await (this.prisma as any).attributionCredit?.findMany({ where: { organizationId }, take: 10000 }).catch(() => []);
        if (credits?.length) {
          const tpIds = [...new Set(credits.map((c: any) => c.touchpointId))];
          const tps = await (this.prisma as any).touchpoint.findMany({ where: { id: { in: tpIds } } });
          const tpMap = new Map(tps.map((t: any) => [t.id, t]));
          for (const c of credits as any[]) {
            const tp: any = tpMap.get(c.touchpointId);
            if (tp && (tp.campaign === p.name || tp.campaign === p.externalCampaignId)) {
              fpRevenue += BigInt(c.revenueMinor ?? 0); fpOrders.add(c.orderId);
            }
          }
        }
        variants.push({
          planId: p.id, name: p.name, variant: p.abVariant ?? "?", status: p.status,
          spendMinor: spend.toString(), platformConversions: Number(platformConv),
          platformCpaMinor: platformConv > 0n ? (spend / platformConv).toString() : null,
          firstPartyOrders: fpOrders.size, firstPartyRevenueMinor: fpRevenue.toString(),
          firstPartyCpaMinor: fpOrders.size > 0 ? (spend / BigInt(fpOrders.size)).toString() : null,
        });
      }
      let winner: string | null = null; let verdict = "insufficient_data";
      const key = metric === "platform_cpa" ? "platformCpaMinor" : "firstPartyCpaMinor";
      const eligible = variants.filter((v) => v[key] !== null && BigInt(v.spendMinor) >= 10000n);
      if (variants.length >= 2 && eligible.length === variants.length) {
        winner = [...eligible].sort((x, y) => Number(BigInt(x[key]) - BigInt(y[key])))[0].planId;
        verdict = "winner_by_" + metric;
      }
      out.push({ groupId, metric, variants, winnerPlanId: winner, verdict });
    }
    return out;
  }

  /** Live schedule edit: start/end times on a published ad set,
   * Meta first, local state after confirmation (like budgets). */
  async updateAdSetSchedule(organizationId: string, actorId: string, planId: string, adSetId: string, dto: { startTime?: string; endTime?: string }) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    if (plan.status !== "published") throw new BadRequestException("Only published plans have live schedules to edit");
    const adSet = await (this.prisma as any).campaignAdSet.findFirst({ where: { id: adSetId, planId } });
    if (!adSet?.externalAdSetId) throw new BadRequestException("This ad set has no Meta ad set id (not published)");
    const params: Record<string, string> = {};
    if (dto.startTime) params.start_time = new Date(dto.startTime).toISOString();
    if (dto.endTime) params.end_time = new Date(dto.endTime).toISOString();
    if (Object.keys(params).length === 0) throw new BadRequestException("Provide startTime or endTime");
    const { client } = await this.publishClient(organizationId, plan);
    await client.updateAdSetFields(adSet.externalAdSetId, params);
    await (this.prisma as any).campaignAdSet.update({
      where: { id: adSetId },
      data: {
        ...(dto.startTime ? { startTime: new Date(dto.startTime) } : {}),
        ...(dto.endTime ? { endTime: new Date(dto.endTime) } : {}),
      },
    });
    await this.logStep(planId, actorId, "schedule_update", "success", { entityRef: adSetId, externalId: adSet.externalAdSetId }).catch(() => undefined);
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.schedule_updated", entityType: "CampaignAdSet", entityId: adSetId, metadata: params });
    return this.getPlanFull(organizationId, planId);
  }

  /** Scale every ad set's daily budget of a published plan by percent,
   * clamped to [minMinor, maxMinor]. Used by automation rules v2; each
   * ad set goes through the same Meta-confirmed path as a manual edit.
   * Returns the changes actually confirmed by Meta. */
  async scalePlanBudgets(organizationId: string, actorId: string, planId: string, percent: number, caps: { minDailyMinor?: number; maxDailyMinor?: number }): Promise<{ adSetId: string; before: string; after: string }[]> {
    const full = await this.getPlanFull(organizationId, planId);
    const changes: { adSetId: string; before: string; after: string }[] = [];
    for (const adSet of full.adSets) {
      if (!adSet.externalAdSetId || !adSet.dailyBudgetMinor) continue;
      const before = BigInt(adSet.dailyBudgetMinor);
      let after = (before * BigInt(100 + Math.round(percent))) / 100n;
      if (caps.minDailyMinor !== undefined && after < BigInt(caps.minDailyMinor)) after = BigInt(caps.minDailyMinor);
      if (caps.maxDailyMinor !== undefined && after > BigInt(caps.maxDailyMinor)) after = BigInt(caps.maxDailyMinor);
      if (after === before || after <= 0n) continue;
      const { client } = await this.publishClient(organizationId, await this.getPlanOrThrow(organizationId, planId));
      await client.updateAdSetBudget(adSet.externalAdSetId, { dailyBudgetMinor: after });
      await (this.prisma as any).campaignAdSet.update({ where: { id: adSet.id }, data: { dailyBudgetMinor: after } });
      changes.push({ adSetId: adSet.id, before: before.toString(), after: after.toString() });
    }
    if (changes.length) {
      await this.audit.log({ organizationId, userId: actorId, action: "campaign.budget_scaled", entityType: "CampaignPlan", entityId: planId, metadata: { percent, changes } });
    }
    return changes;
  }

  /** UTM governance (Phase J): every ad link leaving this system
   * carries utm_source/medium/campaign so the first-party tracker and
   * the first-party rule metrics can attribute it. Existing utm_*
   * params are the owner's and are never overwritten. */
  tagUtm(linkUrl: string, planName: string): { url: string; changed: boolean } {
    try {
      const u = new URL(linkUrl);
      const slug = String(planName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "campaign";
      if (!u.searchParams.has("utm_source")) u.searchParams.set("utm_source", "facebook");
      if (!u.searchParams.has("utm_medium")) u.searchParams.set("utm_medium", "cpc");
      if (!u.searchParams.has("utm_campaign")) u.searchParams.set("utm_campaign", slug);
      const out = u.toString();
      return { url: out, changed: out !== linkUrl };
    } catch {
      return { url: linkUrl, changed: false };
    }
  }

  async setMetaStatus(organizationId: string, actorId: string, planId: string, target: "ACTIVE" | "PAUSED") {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    if (plan.status !== "published" || !plan.externalCampaignId) throw new BadRequestException("Only published plans can be activated or paused");
    const { client } = await this.publishClient(organizationId, plan);
    const step = target === "ACTIVE" ? "activate" : "pause";
    try {
      await client.setObjectStatus(plan.externalCampaignId, target);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Status change failed";
      await this.logStep(planId, actorId, step, "error", { error: message });
      throw new BadRequestException(`Meta did NOT confirm the status change: ${message}. Local status is unchanged.`);
    }
    await (this.prisma as any).campaignPlan.update({ where: { id: planId }, data: { metaStatus: target } });
    await this.logStep(planId, actorId, step, "success", { externalId: plan.externalCampaignId });
    await this.audit.log({ organizationId, userId: actorId, action: `campaign.${step}d`, entityType: "CampaignPlan", entityId: planId });
    return this.getPlanFull(organizationId, planId);
  }

  // ---------- AI copy suggestions (saved as draft ads, editable) ----------
  async generateCopy(organizationId: string, actorId: string, planId: string, dto: { adSetId: string; productId: string; linkUrl?: string }) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    this.assertEditable(plan);
    const adSet = await (this.prisma as any).campaignAdSet.findFirst({ where: { id: dto.adSetId, planId } });
    if (!adSet) throw new NotFoundException("Ad set not found in this plan");
    const product = await (this.prisma as any).product.findFirst({ where: { id: dto.productId, organizationId } });
    if (!product) throw new NotFoundException("Product not found in this organization");
    const profile = await (this.prisma as any).businessProfile.findUnique({ where: { organizationId } });
    const linkUrl = dto.linkUrl ?? profile?.websiteUrl ?? "";
    if (!linkUrl) throw new BadRequestException("A landing link is required: pass linkUrl or set the business website URL in Business Knowledge");
    const provider = this.llm.getProvider();
    const price = formatMinor(BigInt(product.priceMinor), product.currency);

    let variants: { primaryText: string; headline: string }[] = [];
    if (provider.isRealLlm) {
      const result = await provider.complete([
        { role: "system", content: "You write short ad copy for an ecommerce product. Use ONLY the product facts provided: never invent discounts, stock claims, delivery promises or features. Bengali (Bangla script) by default unless the product name is English-only. Return ONLY JSON: {\"variants\":[{\"primaryText\":string,\"headline\":string}]} with exactly 2 variants." },
        { role: "user", content: `Product: ${product.name}\nPrice: ${price}\nCategory: ${product.category ?? "-"}\nDescription: ${product.description ?? "-"}\nBusiness: ${profile?.industry ?? "-"}; brand voice: ${profile?.brandVoice ?? "-"}` },
      ], { jsonMode: true, maxTokens: 800 });
      try {
        const parsed = JSON.parse(result.text);
        variants = Array.isArray(parsed.variants) ? parsed.variants.slice(0, 2) : [];
      } catch { variants = []; }
      await (this.prisma as any).aIUsageRecord.create({
        data: { organizationId, userId: actorId, feature: "ad_copy", provider: provider.name, inputTokens: result.inputTokens, outputTokens: result.outputTokens, estimated: result.tokensEstimated },
      });
      if (variants.length === 0) throw new BadRequestException("The AI provider returned no usable copy variants. Nothing was saved.");
    } else {
      variants = [
        { primaryText: `${product.name} - দাম ${price}। বিস্তারিত দেখে এখনই অর্ডার করুন।`, headline: product.name },
        { primaryText: `আপনি কি ${product.name} খুঁজছেন? দাম ${price}। বিস্তারিত দেখতে ক্লিক করুন।`, headline: `${product.name} কিনুন` },
      ];
    }

    const created = [];
    for (let i = 0; i < variants.length; i++) {
      const ad = await (this.prisma as any).campaignAd.create({
        data: {
          adSetId: adSet.id, name: `AI suggestion ${i + 1} - ${product.name}`.slice(0, 120),
          primaryText: String(variants[i].primaryText).slice(0, 2000), headline: String(variants[i].headline ?? "").slice(0, 200) || null,
          linkUrl, callToAction: "SHOP_NOW", productId: product.id, createdByAi: true,
        },
      });
      created.push(ad);
    }
    return { created, provider: provider.name };
  }

  /** Advantage+ toggle (Milestone 32). Only while the plan has not
   * been published — the budget structure differs at creation time,
   * so flipping it afterwards would misrepresent the live objects. */
  async setAdvantagePlus(organizationId: string, actorId: string, planId: string, enabled: boolean) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    if (plan.externalCampaignId || ["published", "publishing"].includes(plan.status)) {
      throw new BadRequestException("Advantage+ can only be changed before publishing — the budget structure is fixed at creation time");
    }
    if (enabled && plan.objective !== "OUTCOME_SALES") {
      throw new BadRequestException("Advantage+ is a Sales format: the plan objective must be OUTCOME_SALES");
    }
    await (this.prisma as any).campaignPlan.update({ where: { id: planId }, data: { advantagePlus: enabled } });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.advantage_plus_set", entityType: "CampaignPlan", entityId: planId, metadata: { enabled } });
    return this.getPlanFull(organizationId, planId);
  }
}
