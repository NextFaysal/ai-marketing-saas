import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { isMemberConnectionDenied } from "../common/permission-catalog";
import { leaderClaim } from "../common/leader-claim";
import { PublishingService } from "../publishing/publishing.service";
import { AudiencesService } from "../audiences/audiences.service";
import { AuditService } from "../audit/audit.service";
import { decryptJson } from "../integrations/crypto";
import { MetaPublishClient } from "./meta-publish.client";
import { computeCreativeLeaderboard } from "../ads/creative-fatigue";
import { policyFindingsForText } from "./policy-check";
import { LlmFactory } from "../ai/llm/llm.factory";
import { PublicMediaService } from "../storage/public-media.service";
import { parseMoneyToMinor, formatMinor } from "@repo/contracts";

export const OBJECTIVES = ["OUTCOME_SALES", "OUTCOME_TRAFFIC", "OUTCOME_LEADS", "OUTCOME_ENGAGEMENT", "OUTCOME_AWARENESS"] as const;
export const OPTIMIZATION_GOALS = ["LINK_CLICKS", "OFFSITE_CONVERSIONS", "LEAD_GENERATION", "REACH", "LANDING_PAGE_VIEWS", "VALUE", "CONVERSATIONS"] as const;
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
    key: "ctwa", name: "Click to WhatsApp (Link Ad)", objective: "OUTCOME_ENGAGEMENT",
    description: "এটি একটি সাধারণ Link Ad (wa.me লিংক) — আসল Click-to-WhatsApp Destination নয়। আসল CTWA পেতে Ad Set-এ WhatsApp Destination বাছাই করুন (CN13): সেখানে নম্বরটি Organization-এর Connected WhatsApp থেকে আসে এবং Publish Meta-তে destination_type=WHATSAPP পাঠায়। এই Blueprint-এর কথোপকথনও ইনবক্সে আসে, সেখান থেকে অর্ডার করা যায়।",
    adSet: { name: "BD WhatsApp", dailyBudget: "300", optimizationGoal: "LINK_CLICKS", countries: ["BD"], ageMin: 18, ageMax: 55 },
    ad: { name: "Chat Ad", primaryText: "যেকোনো প্রশ্নে WhatsApp এ মেসেজ করুন, আমরা সাথে সাথে উত্তর দেব।", headline: "WhatsApp এ অর্ডার করুন", linkUrl: "https://wa.me/8801700000000", callToAction: "SEND_WHATSAPP_MESSAGE" },
  },
  {
    key: "catalog_sales", name: "Catalog Sales (Advantage ধাঁচের)", objective: "OUTCOME_SALES",
    description: "ক্যাটালগের পণ্য দিয়ে বিক্রির ক্যাম্পেইন কাঠামো। CN3 থেকে Ad Set-এ Catalog + Product Set বাছাই করলেই Publish আসল product_set_id পাঠায় (Set টি আগে Catalogs পেজ থেকে Meta-তে Publish করা থাকতে হবে)। বাজেট শুরুর মান।",
    adSet: { name: "BD Catalog Broad", dailyBudget: "500", optimizationGoal: "OFFSITE_CONVERSIONS", countries: ["BD"], ageMin: 18, ageMax: 65 },
    ad: { name: "Catalog Ad", primaryText: "আমাদের কালেকশন দেখুন — সারা দেশে ক্যাশ অন ডেলিভারি।", headline: "কালেকশন দেখুন", linkUrl: "https://example.com", callToAction: "SHOP_NOW" },
  },
  {
    key: "lead_form", name: "Lead Form", objective: "OUTCOME_LEADS",
    description: "Facebook লিড ফর্মের জন্য ক্যাম্পেইন কাঠামো। CN4 থেকে Form Builder-এই বানিয়ে Ad Set-এ যুক্ত করুন — Publish-এর সময় ফর্মটি Meta-তে তৈরি হয়, আর লিড এলে Form-এর Field Mapping অনুযায়ী CRM Lead-এ বসে।",
    adSet: { name: "BD Leads", dailyBudget: "300", optimizationGoal: "LEAD_GENERATION", countries: ["BD"], ageMin: 20, ageMax: 60 },
    ad: { name: "Lead Ad", primaryText: "আগ্রহী হলে ফর্মটি পূরণ করুন, আমাদের টিম যোগাযোগ করবে।", headline: "ফর্মটি পূরণ করুন", linkUrl: "https://example.com", callToAction: "SIGN_UP" },
  },
] as const;

@Injectable()
export class CampaignsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly llm: LlmFactory,
    @Optional() private readonly publishing?: PublishingService,
    // CN6: the Audience Studio rides the EXISTING
    // AudiencesService (optional so older spec constructions
    // with three arguments keep working; the studio methods
    // refuse honestly when it is absent).
    @Optional() private readonly audiences?: AudiencesService,
    // RB4/RM8: CDN URL preference for library-asset variants.
    // LAST param + Optional, same discipline as audiences.
    @Optional() private readonly publicMedia?: PublicMediaService,
  ) {}

  /** CB5: scheduled-launch scan tick (leader-claimed,
   *  so replicas never double-publish). */
  onModuleInit() {
    if (process.env.DISABLE_SCHEDULER === "true" || process.env.DISABLE_SCHEDULER === "1") return;
    const timer = setInterval(() => {
      void (async () => {
        const claimed = await leaderClaim.tryClaim("campaign-launch-scan", 55).catch(() => false);
        if (!claimed) return;
        await this.scanScheduledLaunches().catch(() => undefined);
      })();
    }, 60_000);
    (timer as any).unref?.();
  }

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
      const row: any = {
        ...adSet,
        dailyBudgetMinor: adSet.dailyBudgetMinor?.toString() ?? null, lifetimeBudgetMinor: adSet.lifetimeBudgetMinor?.toString() ?? null,
        // CN2: bid money is BigInt too — same stringify rule.
        bidAmountMinor: adSet.bidAmountMinor?.toString() ?? null, costGoalMinor: adSet.costGoalMinor?.toString() ?? null,
        ads,
      };
      // NB2 (CN3/CN4): resolve the catalog / product-set /
      // lead-form records an ad set points at, so validatePlan,
      // readiness and publish judge the REAL records. Lookups
      // are guarded — a missing table (older spec fakes) or a
      // missing row leaves the ref null and validation says so.
      if (adSet.catalogRecordId && (this.prisma as any).catalogRecord?.findFirst) {
        row.__catalog = await (this.prisma as any).catalogRecord.findFirst({ where: { id: adSet.catalogRecordId, organizationId } }).catch(() => null);
      }
      if (adSet.productSetId && (this.prisma as any).productSet?.findFirst) {
        row.__productSet = await (this.prisma as any).productSet.findFirst({ where: { id: adSet.productSetId, organizationId } }).catch(() => null);
      }
      if (adSet.leadFormId && (this.prisma as any).leadForm?.findFirst) {
        row.__leadForm = await (this.prisma as any).leadForm.findFirst({ where: { id: adSet.leadFormId, organizationId } }).catch(() => null);
      }
      withAds.push(row);
    }
    const publishLogs = await (this.prisma as any).campaignPublishLog.findMany({ where: { planId }, orderBy: { createdAt: "desc" }, take: 50 });
    return {
      ...plan, dailyBudgetCapMinor: plan.dailyBudgetCapMinor?.toString() ?? null,
      // CN2: campaign-level budgets are BigInt as well.
      campaignDailyBudgetMinor: plan.campaignDailyBudgetMinor?.toString() ?? null,
      campaignLifetimeBudgetMinor: plan.campaignLifetimeBudgetMinor?.toString() ?? null,
      adSets: withAds, publishLogs,
    };
  }

  /** CB3 fix: plan money leaves the API as strings
   *  (a set cap is a BigInt — the raw row 500s JSON). */
  private planJson(p: any) {
    return {
      ...p, dailyBudgetCapMinor: p?.dailyBudgetCapMinor?.toString() ?? null,
      campaignDailyBudgetMinor: p?.campaignDailyBudgetMinor?.toString() ?? null,
      campaignLifetimeBudgetMinor: p?.campaignLifetimeBudgetMinor?.toString() ?? null,
    };
  }

  /** CN2: one ad set row with ALL its money stringified. */
  private adSetJson(s: any) {
    return {
      ...s,
      dailyBudgetMinor: s?.dailyBudgetMinor?.toString() ?? null, lifetimeBudgetMinor: s?.lifetimeBudgetMinor?.toString() ?? null,
      bidAmountMinor: s?.bidAmountMinor?.toString() ?? null, costGoalMinor: s?.costGoalMinor?.toString() ?? null,
    };
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
  /** CN2: budget mode vocabulary. */
  private parseBudgetMode(v?: string): "abo" | "cbo" {
    if (v === undefined || v === "") return "abo";
    if (v !== "abo" && v !== "cbo") throw new BadRequestException(`budgetMode must be "abo" or "cbo" (got "${v}")`);
    return v;
  }

  async createPlan(organizationId: string, actorId: string, dto: { name: string; objective: string; adAccountId: string; budgetMode?: string; campaignDailyBudget?: string; campaignLifetimeBudget?: string }) {
    if (!(OBJECTIVES as readonly string[]).includes(dto.objective)) throw new BadRequestException("Invalid objective");
    const account = await (this.prisma as any).adAccount.findFirst({ where: { id: dto.adAccountId, organizationId } });
    if (!account) throw new BadRequestException("Ad account not found in this organization");
    if (account.platform !== "meta") throw new BadRequestException("Milestone 9 publishing supports Meta ad accounts only");
    const plan = await (this.prisma as any).campaignPlan.create({
      data: {
        organizationId, adAccountId: dto.adAccountId, name: dto.name, objective: dto.objective, status: "draft", createdById: actorId,
        budgetMode: this.parseBudgetMode(dto.budgetMode),
        campaignDailyBudgetMinor: dto.campaignDailyBudget ? parseMoneyToMinor(dto.campaignDailyBudget) : null,
        campaignLifetimeBudgetMinor: dto.campaignLifetimeBudget ? parseMoneyToMinor(dto.campaignLifetimeBudget) : null,
      },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.plan_created", entityType: "CampaignPlan", entityId: plan.id });
    return this.getPlanFull(organizationId, plan.id);
  }

  /**
   * Plan list. CN11 hub contract: called with NO opts
   * (or an empty object) this is the LEGACY response —
   * a bare array, take:100, per-plan ad-set counts,
   * byte-compatible with every pre-CN11 consumer. With
   * any hub opt present it returns the paged envelope
   * { items, total, page, pageSize } where ad-set counts
   * for the page are BATCHED (one findMany for the whole
   * page, tallied in memory — no per-plan count loop)
   * and status / objective / q are server-side filters.
   * includePerformance (paged path only) attaches a
   * per-plan `performance` read-model built from ONE
   * DailyAdMetric query over the page's external
   * campaign ids: campaign/ad-set-level rows only
   * (adExternalId "" or null, the planPerformance rule),
   * null for a plan with no externalCampaignId, and a
   * zeroed totals object for a published plan with no
   * metric rows yet.
   */
  async listPlans(organizationId: string, opts?: {
    page?: number; pageSize?: number; includePerformance?: boolean;
    status?: string; q?: string; objective?: string;
  }) {
    const paged = !!opts && (opts.page !== undefined || opts.pageSize !== undefined
      || opts.includePerformance !== undefined || opts.status !== undefined
      || opts.q !== undefined || opts.objective !== undefined);
    if (!paged) {
      const plans = await (this.prisma as any).campaignPlan.findMany({ where: { organizationId }, orderBy: { updatedAt: "desc" }, take: 100 });
      const out = [];
      for (const p of plans) {
        const adSets = await (this.prisma as any).campaignAdSet.count({ where: { planId: p.id } });
        out.push({ ...this.planJson(p), adSetCount: adSets });
      }
      return out;
    }
    const page = Math.max(1, Math.floor(Number(opts.page ?? 1)) || 1);
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(opts.pageSize ?? 20)) || 20));
    const where: any = { organizationId };
    if (opts.status) where.status = opts.status;
    if (opts.objective) where.objective = opts.objective;
    if (opts.q) where.name = { contains: opts.q };
    const total = await (this.prisma as any).campaignPlan.count({ where });
    const plans = await (this.prisma as any).campaignPlan.findMany({
      where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize,
    });
    // Batched ad-set counts: ONE query for the page.
    const counts = new Map<string, number>();
    const planIds = (plans as any[]).map((p) => p.id);
    if (planIds.length && (this.prisma as any).campaignAdSet?.findMany) {
      const sets = await (this.prisma as any).campaignAdSet.findMany({ where: { planId: { in: planIds } } }).catch(() => []);
      for (const s of sets as any[]) counts.set(s.planId, (counts.get(s.planId) ?? 0) + 1);
    }
    // Optional performance read-model: ONE metric query
    // for the whole page, aggregated in memory.
    let perfByCampaign: Map<string, any> | null = null;
    if (opts.includePerformance) {
      perfByCampaign = new Map<string, any>();
      const extIds = [...new Set((plans as any[]).map((p) => p.externalCampaignId).filter(Boolean))] as string[];
      const metricTable = (this.prisma as any).dailyAdMetric;
      if (extIds.length && metricTable?.findMany) {
        const rows = await metricTable.findMany({ where: { organizationId, campaignExternalId: { in: extIds } } }).catch(() => []);
        const agg = new Map<string, { spend: bigint; impressions: number; clicks: number; conversions: bigint }>();
        for (const r of rows as any[]) {
          if ((r.adExternalId ?? "") !== "") continue; // campaign/ad-set level only
          const g = agg.get(r.campaignExternalId) ?? { spend: 0n, impressions: 0, clicks: 0, conversions: 0n };
          g.spend += BigInt(r.spendMinor ?? 0);
          g.impressions += Number(r.impressions ?? 0);
          g.clicks += Number(r.clicks ?? 0);
          g.conversions += BigInt(r.platformConversions ?? r.conversions ?? 0);
          agg.set(r.campaignExternalId, g);
        }
        for (const [extId, g] of agg) {
          perfByCampaign.set(extId, {
            spendMinor: g.spend.toString(), impressions: g.impressions, clicks: g.clicks,
            conversions: Number(g.conversions),
            ctrPercent: g.impressions > 0 ? Math.round((g.clicks / g.impressions) * 10000) / 100 : null,
            cpaMinor: g.conversions > 0n ? (g.spend / g.conversions).toString() : null,
          });
        }
      }
    }
    const zeroPerf = () => ({ spendMinor: "0", impressions: 0, clicks: 0, conversions: 0, ctrPercent: null, cpaMinor: null });
    const items = (plans as any[]).map((p) => ({
      ...this.planJson(p), adSetCount: counts.get(p.id) ?? 0,
      ...(perfByCampaign ? { performance: !p.externalCampaignId ? null : (perfByCampaign.get(p.externalCampaignId) ?? zeroPerf()) } : {}),
    }));
    return { items, total, page, pageSize };
  }

  async getPlan(organizationId: string, planId: string) { return this.getPlanFull(organizationId, planId); }

  async updatePlan(organizationId: string, planId: string, dto: { name?: string; objective?: string; dailyBudgetCap?: string | null; budgetMode?: string; campaignDailyBudget?: string | null; campaignLifetimeBudget?: string | null }) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    this.assertEditable(plan);
    if (dto.objective && !(OBJECTIVES as readonly string[]).includes(dto.objective)) throw new BadRequestException("Invalid objective");
    const data: any = { ...(dto.name ? { name: dto.name } : {}), ...(dto.objective ? { objective: dto.objective } : {}) };
    // CB2: plan-level daily budget cap (taka string in,
    // minor units stored; empty/null clears).
    if (dto.dailyBudgetCap !== undefined) {
      data.dailyBudgetCapMinor = dto.dailyBudgetCap ? parseMoneyToMinor(dto.dailyBudgetCap) : null;
    }
    // CN2: budget mode + campaign budgets (same string rule).
    if (dto.budgetMode !== undefined) data.budgetMode = this.parseBudgetMode(dto.budgetMode);
    if (dto.campaignDailyBudget !== undefined) {
      data.campaignDailyBudgetMinor = dto.campaignDailyBudget ? parseMoneyToMinor(dto.campaignDailyBudget) : null;
    }
    if (dto.campaignLifetimeBudget !== undefined) {
      data.campaignLifetimeBudgetMinor = dto.campaignLifetimeBudget ? parseMoneyToMinor(dto.campaignLifetimeBudget) : null;
    }
    await (this.prisma as any).campaignPlan.update({ where: { id: planId }, data });
    return this.getPlanFull(organizationId, planId);
  }

  /** CN2: is this plan's budget campaign-level? An
   *  explicit budgetMode "cbo" — or Advantage+, which has
   *  always implied it — makes it so. */
  private isCbo(full: any): boolean {
    return full?.budgetMode === "cbo" || full?.advantagePlus === true;
  }

  /** CN2: the campaign-level budgets a CBO publish will
   *  use: the explicit plan fields first; for Advantage+
   *  plans without them, the legacy fallback (first ad
   *  set's daily budget becomes the campaign budget). */
  private campaignBudgets(full: any): { dailyMinor: bigint | null; lifetimeMinor: bigint | null } {
    let daily = full?.campaignDailyBudgetMinor != null ? BigInt(full.campaignDailyBudgetMinor) : null;
    const lifetime = full?.campaignLifetimeBudgetMinor != null ? BigInt(full.campaignLifetimeBudgetMinor) : null;
    if (daily == null && full?.advantagePlus === true) {
      const first = (full.adSets ?? []).find((a: any) => a.dailyBudgetMinor != null);
      if (first) daily = BigInt(first.dailyBudgetMinor);
    }
    return { dailyMinor: daily, lifetimeMinor: lifetime };
  }

  /** CB2: plan budget picture (all money as strings). */
  budgetTotals(full: any) {
    const perAdSet = (full.adSets ?? []).map((s: any) => ({
      adSetId: s.id, name: s.name,
      dailyMinor: s.dailyBudgetMinor != null ? BigInt(s.dailyBudgetMinor).toString() : null,
      lifetimeMinor: s.lifetimeBudgetMinor != null ? BigInt(s.lifetimeBudgetMinor).toString() : null,
    }));
    let daily = 0n;
    let lifetime = 0n;
    for (const s of full.adSets ?? []) {
      if (s.dailyBudgetMinor != null) daily += BigInt(s.dailyBudgetMinor);
      if (s.lifetimeBudgetMinor != null) lifetime += BigInt(s.lifetimeBudgetMinor);
    }
    // CN2: the campaign level, and the EFFECTIVE daily
    // figure (CBO: the campaign's own; ABO: the ad-set sum).
    const cbo = this.isCbo(full);
    const cb = this.campaignBudgets(full);
    return {
      perAdSet, dailyTotalMinor: daily.toString(), lifetimeTotalMinor: lifetime.toString(),
      budgetMode: cbo ? "cbo" : "abo",
      campaignDailyMinor: cb.dailyMinor?.toString() ?? null,
      campaignLifetimeMinor: cb.lifetimeMinor?.toString() ?? null,
      effectiveDailyMinor: (cbo ? (cb.dailyMinor ?? 0n) : daily).toString(),
    };
  }

  /** CB2 guardrail: refuse when daily budgets exceed
   *  the plan's own cap. Enforced at submit + publish.
   *  CN2: for a CBO plan the figure that matters is the
   *  campaign's own daily budget. */
  private assertWithinCap(full: any) {
    if (full.dailyBudgetCapMinor == null) return;
    const cap = BigInt(full.dailyBudgetCapMinor);
    const daily = BigInt(this.budgetTotals(full).effectiveDailyMinor);
    if (daily > cap) {
      throw new BadRequestException(`Plan daily budget cap exceeded: ${this.isCbo(full) ? "campaign daily budget" : "ad sets total"} ${daily.toString()} minor units per day, cap is ${cap.toString()}. Lower a budget or raise the cap.`);
    }
  }

  // ---------- CN2 bidding ----------
  static readonly BID_STRATEGIES = ["lowest_cost", "bid_cap", "cost_cap", "roas_goal"] as const;

  /**
   * CN2 support matrix (pinned by cn2 specs). A strategy
   * Meta cannot run for the ad set's optimization goal —
   * or, for ROAS, the plan objective — is refused with
   * the reason, at save time and again in validatePlan.
   * Grounding: Meta's Ad Set reference lists the
   * bid_strategy enum {LOWEST_COST_WITHOUT_CAP,
   * LOWEST_COST_WITH_BID_CAP, COST_CAP,
   * LOWEST_COST_WITH_MIN_ROAS}; MIN_ROAS pairs with the
   * VALUE optimization goal (pixel PURCHASE) and
   * bid_constraints.roas_average_floor.
   */
  private validateBid(objective: string, s: { optimizationGoal: string; pixelId?: string | null; bidStrategy?: string | null; bidAmountMinor?: any; costGoalMinor?: any; roasAverageFloor?: number | null }): string | null {
    const strategy = s.bidStrategy ?? "lowest_cost";
    if (!(CampaignsService.BID_STRATEGIES as readonly string[]).includes(strategy)) {
      return `bidStrategy "${strategy}" is not supported (allowed: ${CampaignsService.BID_STRATEGIES.join(", ")})`;
    }
    const bid = s.bidAmountMinor != null ? BigInt(s.bidAmountMinor) : null;
    const cost = s.costGoalMinor != null ? BigInt(s.costGoalMinor) : null;
    const roas = s.roasAverageFloor ?? null;
    if (strategy === "lowest_cost") {
      if (bid != null || cost != null || roas != null) return "lowest_cost takes no bid/cost/ROAS amount — remove the amount or choose the matching strategy";
      return null;
    }
    if (strategy === "bid_cap") {
      if (bid == null || bid <= 0n) return "bid_cap needs a positive bidAmount";
      if (cost != null || roas != null) return "bid_cap takes only bidAmount — clear the cost/ROAS fields";
      if (s.optimizationGoal === "REACH") return "bid_cap is not supported for the REACH optimization goal — use lowest_cost";
      return null;
    }
    if (strategy === "cost_cap") {
      if (cost == null || cost <= 0n) return "cost_cap needs a positive costPerResultGoal";
      if (bid != null || roas != null) return "cost_cap takes only costPerResultGoal — clear the bid/ROAS fields";
      if (!["OFFSITE_CONVERSIONS", "LEAD_GENERATION", "VALUE"].includes(s.optimizationGoal)) {
        return `cost_cap (cost per result goal) needs a result-based optimization goal (OFFSITE_CONVERSIONS, LEAD_GENERATION or VALUE) — not ${s.optimizationGoal}`;
      }
      return null;
    }
    // roas_goal
    if (roas == null || roas <= 0) return "roas_goal needs a positive roasGoal (e.g. \"2.0\")";
    if (bid != null || cost != null) return "roas_goal takes only roasGoal — clear the bid/cost fields";
    if (objective !== "OUTCOME_SALES") return `roas_goal is a Sales strategy — the plan objective is ${objective}`;
    if (s.optimizationGoal !== "VALUE") return "roas_goal needs the VALUE optimization goal (Meta's LOWEST_COST_WITH_MIN_ROAS pairs with VALUE)";
    if (!s.pixelId) return "roas_goal needs a Pixel ID (VALUE optimizes on pixel PURCHASE value)";
    return null;
  }

  /** CN2: build the stored bid columns from DTO strings.
   *  When bidStrategy is sent the group is replaced
   *  wholesale (amounts default to cleared); amount-only
   *  edits layer onto the stored strategy. "" clears. */
  private buildBid(dto: { bidStrategy?: string; bidAmount?: string; costPerResultGoal?: string; roasGoal?: string }, base?: any): {
    bidStrategy: string | null; bidAmountMinor: bigint | null; costGoalMinor: bigint | null; roasAverageFloor: number | null;
  } | null {
    const anySent = dto.bidStrategy !== undefined || dto.bidAmount !== undefined || dto.costPerResultGoal !== undefined || dto.roasGoal !== undefined;
    if (!anySent) return null;
    const wholesale = dto.bidStrategy !== undefined;
    const strategy = dto.bidStrategy !== undefined ? dto.bidStrategy : (base?.bidStrategy ?? "lowest_cost");
    const parseAmt = (v: string | undefined, fallback: any) => {
      if (v !== undefined) return v ? parseMoneyToMinor(v) : null;
      return wholesale ? null : (fallback != null ? BigInt(fallback) : null);
    };
    const bidAmountMinor = parseAmt(dto.bidAmount, base?.bidAmountMinor);
    const costGoalMinor = parseAmt(dto.costPerResultGoal, base?.costGoalMinor);
    let roasAverageFloor: number | null;
    if (dto.roasGoal !== undefined) {
      if (!dto.roasGoal) roasAverageFloor = null;
      else {
        const n = Number(dto.roasGoal);
        if (!Number.isFinite(n) || n <= 0) throw new BadRequestException("roasGoal must be a positive number like \"2.0\"");
        roasAverageFloor = Math.round(n * 10000); // Meta's raw floor: ROAS x 10000
      }
    } else roasAverageFloor = wholesale ? null : (base?.roasAverageFloor ?? null);
    return { bidStrategy: strategy === "lowest_cost" ? null : strategy, bidAmountMinor, costGoalMinor, roasAverageFloor };
  }

  /** CN2: stored bid -> Meta ad set fields. lowest_cost
   *  sends NOTHING (Meta's default is LOWEST_COST_WITHOUT_CAP). */
  private bidGraphFields(s: any): { bidStrategy?: string; bidAmountMinor?: string; bidConstraints?: Record<string, unknown> } {
    switch (s.bidStrategy ?? "lowest_cost") {
      case "bid_cap": return { bidStrategy: "LOWEST_COST_WITH_BID_CAP", bidAmountMinor: BigInt(s.bidAmountMinor).toString() };
      case "cost_cap": return { bidStrategy: "COST_CAP", bidAmountMinor: BigInt(s.costGoalMinor).toString() };
      case "roas_goal": return { bidStrategy: "LOWEST_COST_WITH_MIN_ROAS", bidConstraints: { roas_average_floor: Number(s.roasAverageFloor) } };
      default: return {};
    }
  }

  // ---------- Campaign Builder Next CN3/CN4 (NB2) ----------

  /** CN3: standard Meta events a pixel ad set may optimize
   *  on (the documented custom_event_type values). PURCHASE
   *  stays the default when nothing is chosen. Custom
   *  conversions are deliberately NOT in this list — the
   *  NB2 spike could not confirm a current documented
   *  create path (see docs/campaign-builder-nb2-acceptance.md). */
  static readonly CONVERSION_EVENTS_SALES = ["PURCHASE", "ADD_TO_CART", "INITIATE_CHECKOUT", "ADD_PAYMENT_INFO", "VIEW_CONTENT", "ADD_TO_WISHLIST", "COMPLETE_REGISTRATION", "SUBSCRIBE", "START_TRIAL", "SEARCH", "CONTACT", "SCHEDULE", "SUBMIT_APPLICATION", "FIND_LOCATION", "DONATE", "OTHER"] as const;
  static readonly CONVERSION_EVENTS_LEADS = ["LEAD", "COMPLETE_REGISTRATION", "SUBMIT_APPLICATION", "SCHEDULE", "CONTACT"] as const;
  /** CN4: call-to-action types Meta's lead-ads guide allows
   *  on a creative carrying a lead_gen_form_id. */
  static readonly LEAD_FORM_CTAS = ["APPLY_NOW", "DOWNLOAD", "GET_QUOTE", "LEARN_MORE", "SIGN_UP", "SUBSCRIBE"] as const;

  /** CN3 support matrix (pinned by cn3 specs). The picker
   *  only exists where Meta optimizes on an event: pixel
   *  goals (OFFSITE_CONVERSIONS / VALUE), plus LEAD via
   *  pixel on a LEAD_GENERATION ad set of a Leads plan.
   *  Returns the refusal reason, or null when valid. */
  private validateConversionEvent(objective: string, s: { optimizationGoal: string; pixelId?: string | null; conversionEvent?: string | null }): string | null {
    const ev = s.conversionEvent ?? null;
    if (!ev) return null;
    if (s.optimizationGoal === "LEAD_GENERATION") {
      if (objective !== "OUTCOME_LEADS") return `conversionEvent belongs to a Leads plan — this plan's objective is ${objective}`;
      if (ev !== "LEAD") return `a LEAD_GENERATION ad set with a pixel event optimizes on LEAD only — not ${ev} (for other events use OFFSITE_CONVERSIONS)`;
      if (!s.pixelId) return "conversionEvent LEAD on a LEAD_GENERATION ad set needs a Pixel ID (without a pixel, lead ads optimize on the form through the Page)";
      return null;
    }
    if (!["OFFSITE_CONVERSIONS", "VALUE"].includes(s.optimizationGoal)) {
      return `conversionEvent applies to pixel conversion goals (OFFSITE_CONVERSIONS, VALUE, or LEAD_GENERATION with a pixel) — not ${s.optimizationGoal}`;
    }
    if (!s.pixelId) return `conversionEvent ${ev} needs a Pixel ID on the ad set`;
    const allowed: readonly string[] = objective === "OUTCOME_LEADS" ? CampaignsService.CONVERSION_EVENTS_LEADS : CampaignsService.CONVERSION_EVENTS_SALES;
    if (!allowed.includes(ev)) return `conversionEvent "${ev}" is not supported for objective ${objective} (allowed: ${allowed.join(", ")})`;
    return null;
  }

  // ---------- Frontier CN13 (NB6): Click-to-WhatsApp ----------

  /** CN13 spike verdict (Meta's "Ads that Click to
   *  WhatsApp" guide, developers.facebook.com, updated
   *  2026-05-21 — see docs/campaign-builder-nb6-acceptance.md):
   *  campaign objectives ENGAGEMENT / LEADS / SALES /
   *  TRAFFIC support WhatsApp destinations; the ad set
   *  carries destination_type "WHATSAPP" (NOT ON_WHATSAPP —
   *  that value belongs to lead ads), billing_event
   *  IMPRESSIONS and promoted_object { page_id (required),
   *  whatsapp_phone_number (optional — Meta falls back to
   *  the Page-linked number) }; the creative is link_data
   *  with link https://api.whatsapp.com/send and CTA
   *  WHATSAPP_MESSAGE / app_destination WHATSAPP.
   *  Optimization goals per objective are the guide's own
   *  table, minus POST_ENGAGEMENT (not in this builder's
   *  goal vocabulary) and minus OFFSITE_CONVERSIONS: the
   *  guide's promoted_object for WhatsApp lists no pixel
   *  fields, so a pixel-event WhatsApp set is not a shape
   *  this builder claims — WhatsApp Sales here optimizes
   *  on CONVERSATIONS and measures through CN14's offline
   *  feedback loop instead. */
  static readonly WHATSAPP_OBJECTIVES = ["OUTCOME_ENGAGEMENT", "OUTCOME_LEADS", "OUTCOME_SALES", "OUTCOME_TRAFFIC"] as const;
  static readonly WHATSAPP_GOALS_BY_OBJECTIVE: Record<string, readonly string[]> = {
    OUTCOME_ENGAGEMENT: ["CONVERSATIONS", "LINK_CLICKS"],
    OUTCOME_LEADS: ["CONVERSATIONS"],
    OUTCOME_SALES: ["CONVERSATIONS", "LINK_CLICKS", "IMPRESSIONS", "REACH"],
    OUTCOME_TRAFFIC: ["CONVERSATIONS", "LANDING_PAGE_VIEWS", "LINK_CLICKS", "IMPRESSIONS", "REACH"],
  };

  /** CN13: the pure destination matrix (save time +
   *  validatePlan). Returns the refusal reason, or null. */
  private validateWhatsAppDestination(objective: string, s: {
    destinationType?: string | null; whatsappIntegrationId?: string | null;
    optimizationGoal: string; pageId?: string | null;
    catalogRecordId?: string | null; productSetId?: string | null;
    leadFormId?: string | null; conversionEvent?: string | null;
  }): string | null {
    const hasWaFields = Boolean(s.whatsappIntegrationId);
    if (!s.destinationType) {
      return hasWaFields ? "a WhatsApp number is attached but destinationType is not \"WHATSAPP\" — set the destination or clear the number" : null;
    }
    if (s.destinationType !== "WHATSAPP") return `destinationType "${s.destinationType}" is not supported (only "WHATSAPP" — a real Click-to-WhatsApp destination)`;
    if (!(CampaignsService.WHATSAPP_OBJECTIVES as readonly string[]).includes(objective)) {
      return `WhatsApp destination needs a ${CampaignsService.WHATSAPP_OBJECTIVES.join(", ")} plan — this plan's objective is ${objective} (Meta's CTWA guide lists no WhatsApp destination for it)`;
    }
    const goals = CampaignsService.WHATSAPP_GOALS_BY_OBJECTIVE[objective] ?? [];
    if (!goals.includes(s.optimizationGoal)) {
      return `a WhatsApp ad set on a ${objective} plan optimizes on ${goals.join(", ")} — not ${s.optimizationGoal} (Meta's CTWA guide, per-objective table)`;
    }
    if (!s.pageId) return "a WhatsApp ad set needs the Facebook Page ID (promoted_object.page_id is required for CTWA)";
    if (!s.whatsappIntegrationId) return "a WhatsApp ad set needs a CONNECTED WhatsApp number picked from this organization's WhatsApp connections — a number is never typed in free-hand";
    if (s.catalogRecordId || s.productSetId) return "a WhatsApp ad set cannot also be a catalog ad set — clear the catalog/product set";
    if (s.leadFormId) return "a WhatsApp ad set cannot also carry a lead form — clear the form";
    if (s.conversionEvent) return "a WhatsApp ad set does not send a pixel conversionEvent in this builder (the CTWA guide's promoted_object carries no pixel fields) — clear it; sales outcomes return through the CN14 offline feedback loop";
    return null;
  }

  /** CN13: resolve the picked WhatsApp connection against
   *  the org's REAL Integration rows (provider whatsapp).
   *  The row must exist and be CONNECTED; its
   *  externalAccountId IS the phone_number_id. The display
   *  digits are then read back from Meta with the
   *  connection's own token (best-effort: an unreadable
   *  number stores null digits — publish omits Meta's
   *  optional whatsapp_phone_number and the Page-linked
   *  number is used; readiness warns, nothing is invented). */
  private async resolveWhatsAppRef(organizationId: string, whatsappIntegrationId: string): Promise<{ integration: any; phoneNumberId: string; phoneNumber: string | null }> {
    if (!(this.prisma as any).integration?.findFirst) {
      throw new BadRequestException("WhatsApp connections are not available in this deployment — connect WhatsApp in the Connect Center first");
    }
    const integration = await (this.prisma as any).integration.findFirst({
      where: { id: whatsappIntegrationId, organizationId, provider: "whatsapp" },
      include: { credential: true },
    }).catch(() => null);
    if (!integration) throw new BadRequestException("That WhatsApp connection was not found in this organization — pick one of the organization's connected WhatsApp numbers");
    if (integration.status !== "CONNECTED") {
      throw new BadRequestException(`That WhatsApp connection is ${String(integration.status).toLowerCase()} — reconnect it in the Connect Center before running Click-to-WhatsApp ads on it`);
    }
    const phoneNumberId = integration.externalAccountId ? String(integration.externalAccountId) : "";
    if (!phoneNumberId) throw new BadRequestException("That WhatsApp connection has no phone number id recorded — reconnect it in the Connect Center");
    let phoneNumber: string | null = null;
    if (integration.credential?.encryptedData) {
      try {
        const secrets = decryptJson<any>(integration.credential.encryptedData);
        if (secrets?.accessToken) {
          const read = await new MetaPublishClient(String(secrets.accessToken)).getWhatsAppPhoneNumber(phoneNumberId);
          if (read.displayPhoneNumber) phoneNumber = read.displayPhoneNumber;
        }
      } catch { phoneNumber = null; /* digits stay unknown — never guessed */ }
    }
    return { integration, phoneNumberId, phoneNumber };
  }

  /** CN13: the org's connected WhatsApp destinations the
   *  builder picker offers. Only real Integration rows;
   *  disconnected rows are listed (labelled) so a stale
   *  pick is explainable, never silently hidden. Secrets
   *  are never returned (the WABA id is an account id, the
   *  same exposure Inbox's list already makes). */
  async whatsappDestinations(organizationId: string) {
    if (!(this.prisma as any).integration?.findMany) return { available: false, reason: "WhatsApp connections are not available in this deployment", destinations: [] };
    const rows = await (this.prisma as any).integration.findMany({
      where: { organizationId, provider: "whatsapp" }, orderBy: { createdAt: "desc" }, include: { credential: true },
    }).catch(() => []);
    const destinations = (rows as any[]).map((i) => {
      let wabaId: string | null = null;
      if (i.credential?.encryptedData) {
        try { wabaId = decryptJson<any>(i.credential.encryptedData).wabaId ?? null; } catch { wabaId = null; }
      }
      return {
        integrationId: i.id, phoneNumberId: i.externalAccountId ?? null,
        status: i.status, connected: i.status === "CONNECTED",
        isDefault: i.isDefault === true, wabaId, appSource: i.appSource ?? "platform",
      };
    });
    return { available: true, destinations };
  }

  /** CN13 reporting: conversations STARTED per published
   *  ad of this plan, matched by the inbox's stored
   *  ctwaSourceId (the ad id Meta puts in the first
   *  message's referral). The referral exists ONLY on a
   *  conversation's first message, so this counts
   *  conversations started — never messages, never
   *  people — and only for conversations our own webhook
   *  stored. Labelled as such in the payload itself. */
  async planWhatsAppConversations(organizationId: string, planId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    const full = await this.getPlanFull(organizationId, planId);
    const label = "Matched by first-message referral (ctwaSourceId = Meta ad id): conversations STARTED from this plan's ads — not messages and not unique people. Only conversations the WhatsApp webhook stored are counted.";
    const ads: { adId: string; name: string; adSetName: string; externalAdId: string }[] = [];
    for (const s of full.adSets ?? []) {
      for (const a of s.ads ?? []) {
        if (a.externalAdId) ads.push({ adId: a.id, name: a.name, adSetName: s.name, externalAdId: String(a.externalAdId) });
      }
    }
    if (!ads.length) {
      return { available: true, published: Boolean(plan.externalCampaignId), totalConversations: 0, perAd: [], label };
    }
    if (!(this.prisma as any).channelConversation?.findMany) {
      return { available: false, reason: "Conversation records are not available in this deployment", totalConversations: null, perAd: [], label };
    }
    const rows = await (this.prisma as any).channelConversation.findMany({
      where: { organizationId, channel: "whatsapp", ctwaSourceId: { in: ads.map((a) => a.externalAdId) } },
      select: { ctwaSourceId: true }, take: 10000,
    }).catch(() => []);
    const counts = new Map<string, number>();
    for (const r of rows as any[]) counts.set(String(r.ctwaSourceId), (counts.get(String(r.ctwaSourceId)) ?? 0) + 1);
    const perAd = ads.map((a) => ({ ...a, conversationsStarted: counts.get(a.externalAdId) ?? 0 }));
    return {
      available: true, published: true,
      totalConversations: perAd.reduce((sum, a) => sum + a.conversationsStarted, 0),
      perAd, label,
    };
  }

  /** CN3: catalog refs must be BOTH present, belong to the
   *  org, match each other, and the set must already exist
   *  on Meta (externalSetId + status "created", the state
   *  CatalogsService.publishProductSet records). Used at
   *  save time (throws) — validatePlan re-checks from the
   *  rows getPlanFull resolved. */
  private async resolveCatalogRefs(organizationId: string, s: { catalogRecordId?: string | null; productSetId?: string | null }): Promise<{ catalog: any; set: any } | null> {
    if (!s.catalogRecordId && !s.productSetId) return null;
    if (!s.catalogRecordId || !s.productSetId) throw new BadRequestException("Catalog ads need BOTH a catalog and a product set (catalogRecordId + productSetId)");
    const catalog = await (this.prisma as any).catalogRecord.findFirst({ where: { id: s.catalogRecordId, organizationId } });
    if (!catalog) throw new BadRequestException("Catalog not found in this organization");
    const set = await (this.prisma as any).productSet.findFirst({ where: { id: s.productSetId, organizationId } });
    if (!set) throw new BadRequestException("Product set not found in this organization");
    if (set.catalogRecordId !== s.catalogRecordId) throw new BadRequestException("That product set belongs to a different catalog — pick a set from the chosen catalog");
    if (!set.externalSetId || set.status !== "created") {
      throw new BadRequestException(`Product set "${set.name}" is not created on Meta yet (status: ${set.status}) — publish it from the Catalogs page first; a local-only set cannot run catalog ads`);
    }
    return { catalog, set };
  }

  /** CN4: a lead form ref must resolve inside the org and,
   *  when the ad set carries a Page, the form must belong
   *  to that same Page (Meta forms live on a Page). */
  private async resolveLeadFormRef(organizationId: string, s: { leadFormId?: string | null; pageId?: string | null }): Promise<any | null> {
    if (!s.leadFormId) return null;
    const form = await (this.prisma as any).leadForm.findFirst({ where: { id: s.leadFormId, organizationId } });
    if (!form) throw new BadRequestException("Lead form not found in this organization");
    if (s.pageId && form.pageId !== s.pageId) {
      throw new BadRequestException(`Lead form "${form.name}" belongs to Page ${form.pageId}, but this ad set uses Page ${s.pageId} — a form can only run on its own Page`);
    }
    return form;
  }

  /**
   * CB2: one readiness verdict combining structure,
   * policy, account health, schedule sanity, landing
   * reachability, budgets and Meta's own reach
   * estimate. Read-only; nothing here publishes.
   */
  async readiness(organizationId: string, planId: string) {
    const full = await this.getPlanFull(organizationId, planId);
    const checks: { key: string; level: "ok" | "warn" | "error"; label: string; detail: string }[] = [];
    const push = (key: string, level: "ok" | "warn" | "error", label: string, detail: string) => checks.push({ key, level, label, detail });

    const structural = this.validatePlan(full);
    if (structural.valid) push("structure", "ok", "গঠন (Structure)", "সব Ad Set/Ad এর আবশ্যিক তথ্য ঠিক আছে");
    else for (const e of structural.errors) push("structure", "error", "গঠন (Structure)", e);

    const policy = await this.preflight(organizationId, planId).catch(() => null);
    if (policy) {
      if (!policy.findings.length) push("policy", "ok", "Policy Pre-flight", `${policy.checkedAds}টি Ad যাচাই হয়েছে — কোনো সতর্কতা নেই`);
      else for (const f of policy.findings.slice(0, 10)) push("policy", f.severity === "low" ? "ok" : "warn", "Policy Pre-flight", `${f.adName}: ${f.explanation}`);
    }

    const account = await (this.prisma as any).adAccount.findFirst({ where: { id: full.adAccountId, organizationId } }).catch(() => null);
    if (!account) push("account", "error", "Ad Account", "Ad Account টি আর পাওয়া যাচ্ছে না");
    else {
      if (account.platformStatusBucket === "disabled" || account.platformStatusBucket === "restricted") {
        push("account", "error", "Ad Account", `প্ল্যাটফর্ম অবস্থা: ${account.platformStatusBucket} — এই অ্যাকাউন্টে বিজ্ঞাপন চলবে না`);
      } else if (account.platformStatusBucket === "active") push("account", "ok", "Ad Account", "প্ল্যাটফর্ম অবস্থা: active");
      else push("account", "warn", "Ad Account", "প্ল্যাটফর্ম অবস্থা যাচাই হয়নি (unknown) — Advertising Accounts পেজে Refresh করুন");
      if (!account.integrationId) push("account", "warn", "Ad Account", "এই অ্যাকাউন্টে Meta API সংযোগ নেই (CSV/manual) — Publish হবে না, আগে Meta Connect করুন");
    }

    const now = new Date();
    for (const s of full.adSets ?? []) {
      if (s.startTime && s.endTime && new Date(s.endTime) <= new Date(s.startTime)) push("schedule", "error", "সময়সূচি", `Ad Set "${s.name}": শেষের সময় শুরুর আগেই/সমান`);
      else if (s.endTime && new Date(s.endTime) <= now) push("schedule", "error", "সময়সূচি", `Ad Set "${s.name}": শেষের সময় এরই মধ্যে পেরিয়ে গেছে`);
      else if (s.startTime && new Date(s.startTime) < now) push("schedule", "warn", "সময়সূচি", `Ad Set "${s.name}": শুরুর সময় অতীতে — চালু হলেই শুরু হবে`);
    }
    if (!checks.some((c) => c.key === "schedule")) push("schedule", "ok", "সময়সূচি", "কোনো সময়-সংক্রান্ত সমস্যা নেই");

    const urls = [...new Set((full.adSets ?? []).flatMap((s: any) => (s.ads ?? []).map((a: any) => a.linkUrl)).filter(Boolean))].slice(0, 5) as string[];
    for (const url of urls) {
      try {
        const res = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(5000) });
        if (res.status >= 200 && res.status < 400) push("landing", "ok", "Landing Page", `${url} — পৌঁছানো গেছে (HTTP ${res.status})`);
        else push("landing", "warn", "Landing Page", `${url} — HTTP ${res.status} (আমাদের সার্ভার থেকে যাচাই; Bot-protection ও এমন দেখাতে পারে)`);
      } catch (e) {
        push("landing", "warn", "Landing Page", `${url} — আমাদের সার্ভার থেকে পৌঁছানো যায়নি (${e instanceof Error ? e.message.slice(0, 80) : "error"})`);
      }
    }

    const budget = this.budgetTotals(full);
    // CN2: the cap is compared against the EFFECTIVE daily
    // figure (CBO: the campaign budget; ABO: the ad-set sum).
    const effectiveDaily = (budget as any).effectiveDailyMinor ?? budget.dailyTotalMinor;
    if (full.dailyBudgetCapMinor != null) {
      const over = BigInt(effectiveDaily) > BigInt(full.dailyBudgetCapMinor);
      push("budget", over ? "error" : "ok", "Budget Cap", over
        ? `কার্যকর দৈনিক ${effectiveDaily} > Cap ${String(full.dailyBudgetCapMinor)} (minor units) — Submit/Publish আটকাবে`
        : `কার্যকর দৈনিক ${effectiveDaily} ≤ Cap ${String(full.dailyBudgetCapMinor)} (minor units)`);
    } else {
      push("budget", "ok", "Budget", `দৈনিক মোট ${budget.dailyTotalMinor}, Lifetime মোট ${budget.lifetimeTotalMinor} (minor units) — কোনো Cap সেট নেই${(budget as any).budgetMode === "cbo" ? ` · Campaign Budget (CBO): দৈনিক ${(budget as any).campaignDailyMinor ?? "—"}` : ""}`);
    }

    // CN1: name-only (legacy free-text) targeting entries
    // are flagged, never hidden — nothing has confirmed
    // Meta recognises them. ID-carrying entries were
    // confirmed at save time (assertIdEntriesConfirmed).
    const unverified: string[] = [];
    for (const s of full.adSets ?? []) {
      const names = this.nameOnlyEntriesOf(s.targeting ?? {});
      if (names.length) unverified.push(`"${s.name}": ${names.slice(0, 5).join(", ")}${names.length > 5 ? ` (+${names.length - 5})` : ""}`);
    }
    if (unverified.length) {
      push("targeting", "warn", "Targeting যাচাই", `ID ছাড়া নাম-ভিত্তিক Entry — Meta দিয়ে যাচাই হয়নি, ভুল নাম হলে Delivery হবে না: ${unverified.join(" · ")}`);
    } else if ((full.adSets ?? []).length) {
      push("targeting", "ok", "Targeting যাচাই", "কোনো অযাচাইকৃত নাম-ভিত্তিক Entry নেই (ID-সহ Entry সেভের সময় Meta দিয়ে যাচাই হয়েছে)");
    }

    // CN3: event / Conversions API health, read from the
    // platform's EXISTING CAPI state (ConversionApiSetting +
    // ConversionEventLog — the Conversions module's own
    // records). No second health system; a state we cannot
    // see is reported as unknown, never as healthy.
    const pixelIds = [...new Set((full.adSets ?? []).map((s: any) => s.pixelId).filter(Boolean))] as string[];
    for (const pixelId of pixelIds) {
      const setting = await (this.prisma as any).conversionApiSetting?.findFirst?.({ where: { organizationId } }).catch(() => null) ?? null;
      if (!setting) {
        push("events", "warn", "Conversion Events", `Pixel ${pixelId}: এই Organization-এ Conversions API সেটআপ পাওয়া যায়নি — server-side event পাঠানো হচ্ছে কিনা যাচাই করা যায়নি (unknown)`);
      } else if (setting.pixelId !== pixelId) {
        push("events", "warn", "Conversion Events", `Pixel ${pixelId}: CAPI সেটআপ অন্য Pixel (${setting.pixelId}) এর জন্য — এই Ad Set-এর Pixel-এ server event যাচ্ছে কিনা অজানা (unknown)`);
      } else if (!setting.enabled) {
        push("events", "warn", "Conversion Events", `Pixel ${pixelId}: CAPI সেটআপ আছে কিন্তু বন্ধ (disabled) — শুধু Browser Pixel চলছে`);
      } else {
        const last = await (this.prisma as any).conversionEventLog?.findFirst?.({ where: { organizationId }, orderBy: { createdAt: "desc" } }).catch(() => null) ?? null;
        if (!last) push("events", "warn", "Conversion Events", `Pixel ${pixelId}: CAPI সেটআপ মিলেছে, কিন্তু কোনো Event পাঠানোর রেকর্ড নেই (unknown)`);
        else if (last.status === "sent") push("events", "ok", "Conversion Events", `Pixel ${pixelId}: সর্বশেষ CAPI Event (${last.eventName}) Meta গ্রহণ করেছে (events_received ${last.eventsReceived ?? "?"})`);
        else push("events", "warn", "Conversion Events", `Pixel ${pixelId}: সর্বশেষ CAPI Event (${last.eventName}) ব্যর্থ হয়েছে — ${String(last.error ?? "unknown error").slice(0, 120)}`);
      }
    }

    // CN4: lead form state per lead ad set, judged on the
    // form's real record (__leadForm from getPlanFull).
    for (const s of full.adSets ?? []) {
      if (s.optimizationGoal !== "LEAD_GENERATION") continue;
      if (!s.leadFormId) {
        push("lead_form", "warn", "Lead Form", `Ad Set "${s.name}": কোনো Lead Form যুক্ত নেই — Page দিয়ে Website Lead Ad হিসেবে চলবে; Instant Form চাইলে একটি Form তৈরি করে যুক্ত করুন`);
        continue;
      }
      const form = (s as any).__leadForm;
      if (!form) { push("lead_form", "error", "Lead Form", `Ad Set "${s.name}": যুক্ত Lead Form টি আর পাওয়া যাচ্ছে না`); continue; }
      if (!form.privacyPolicyUrl) push("lead_form", "error", "Lead Form", `Ad Set "${s.name}": Form "${form.name}"-এ Privacy Policy URL নেই — Meta ফর্ম ছাড়া চলবে না`);
      if (!Array.isArray(form.questions) || form.questions.length === 0) push("lead_form", "error", "Lead Form", `Ad Set "${s.name}": Form "${form.name}"-এ কোনো প্রশ্ন নেই`);
      if (s.pageId && form.pageId !== s.pageId) push("lead_form", "error", "Lead Form", `Ad Set "${s.name}": Form "${form.name}" Page ${form.pageId}-এর, Ad Set-এর Page ${s.pageId}`);
      if (form.privacyPolicyUrl && Array.isArray(form.questions) && form.questions.length) {
        if (form.status === "created" && form.externalFormId) push("lead_form", "ok", "Lead Form", `Ad Set "${s.name}": Form "${form.name}" Meta-তে তৈরি আছে (id ${form.externalFormId})`);
        else push("lead_form", "warn", "Lead Form", `Ad Set "${s.name}": Form "${form.name}" এখনো Meta-তে তৈরি হয়নি — Publish-এর সময় তৈরি হবে, অথবা আগেই "Meta-তে তৈরি করুন" চাপুন`);
      }
      // Mapping targets that no longer exist are named,
      // never silently dropped at ingest time.
      const mapping = (form.fieldMapping ?? {}) as Record<string, string>;
      const customTargets = [...new Set(Object.values(mapping).filter((v) => typeof v === "string" && v.startsWith("custom:")).map((v) => v.slice("custom:".length)))];
      if (customTargets.length && (this.prisma as any).customFieldDef?.findMany) {
        const defs = await (this.prisma as any).customFieldDef.findMany({ where: { organizationId, entity: "lead" } }).catch(() => []);
        const live = new Set((defs ?? []).filter((d: any) => !d.archivedAt).map((d: any) => d.key));
        const missing = customTargets.filter((k) => !live.has(k));
        if (missing.length) push("lead_form", "warn", "Lead Form", `Ad Set "${s.name}": Form-এর Mapping এই Custom Field গুলোতে যাচ্ছে যেগুলো আর নেই: ${missing.join(", ")} — সেগুলোর উত্তর Lead-এর Activity-তে থাকবে, Field-এ নয়`);
      }
    }

    // CN13: WhatsApp destination state per WhatsApp ad
    // set, judged on the LIVE Integration row — a
    // connection removed or disconnected after the pick
    // is an error here, before anyone approves. Digits
    // that Meta's read-back never resolved are a warning:
    // publish then relies on the Page-linked number.
    for (const s of full.adSets ?? []) {
      if (s.destinationType !== "WHATSAPP") {
        for (const ad of s.ads ?? []) {
          if ((ad as any).whatsappWelcome) {
            push("whatsapp", "warn", "WhatsApp", `Ad "${ad.name}": WhatsApp Welcome সেট করা আছে কিন্তু Ad Set "${s.name}"-এর Destination WhatsApp নয় — Welcome Meta-তে যাবে না`);
          }
        }
        continue;
      }
      if (!(this.prisma as any).integration?.findFirst) {
        push("whatsapp", "warn", "WhatsApp", `Ad Set "${s.name}": WhatsApp Connection-এর বর্তমান অবস্থা যাচাই করা যায়নি (unknown)`);
        continue;
      }
      const integration = await (this.prisma as any).integration.findFirst({
        where: { id: s.whatsappIntegrationId, organizationId, provider: "whatsapp" },
      }).catch(() => null);
      if (!integration) {
        push("whatsapp", "error", "WhatsApp", `Ad Set "${s.name}": যুক্ত WhatsApp Connection টি আর পাওয়া যাচ্ছে না — অন্য একটি Connected নম্বর বাছাই করুন`);
      } else if (integration.status !== "CONNECTED") {
        push("whatsapp", "error", "WhatsApp", `Ad Set "${s.name}": WhatsApp Connection টি এখন ${String(integration.status).toLowerCase()} — Connect Center-এ আবার Connect করুন`);
      } else if (!s.whatsappPhoneNumber) {
        push("whatsapp", "warn", "WhatsApp", `Ad Set "${s.name}": Connection Connected (phone_number_id ${s.whatsappPhoneNumberId ?? integration.externalAccountId ?? "?"}) কিন্তু নম্বরের Digits Meta থেকে পড়া যায়নি — Publish whatsapp_phone_number ছাড়াই যাবে, Meta Page-এর Linked নম্বরটি ব্যবহার করবে; সেই নম্বরটিই এই Connection-এর নম্বর কিনা যাচাই করুন`);
      } else {
        push("whatsapp", "ok", "WhatsApp", `Ad Set "${s.name}": Connected WhatsApp ${s.whatsappPhoneNumber} (phone_number_id ${s.whatsappPhoneNumberId ?? integration.externalAccountId ?? "?"}) — Publish destination_type=WHATSAPP পাঠাবে`);
      }
      for (const ad of s.ads ?? []) {
        const bits: string[] = [];
        if (this.hasMultiText(ad)) bits.push("Text Options");
        if ((ad as any).placementAssets && Object.keys((ad as any).placementAssets).length) bits.push("Placement Asset");
        if (bits.length) push("whatsapp", "warn", "WhatsApp", `Ad "${ad.name}": CTWA Creative-এ ${bits.join(", ")} যাবে না — শুধু প্রথম Text Option ও মূল Asset যাবে`);
      }
    }

    // CN5: creative v2 honesty — what publish will NOT
    // send is said here, before anyone approves. Catalog
    // template and lead-form creatives carry neither text
    // options, placement assets nor enhancements; carousel
    // carries enhancements but NOT options/placement.
    // Placement override assets are also checked against
    // the creative library (missing/unready = warning now,
    // a hard publish failure later).
    for (const s of full.adSets ?? []) {
      const specialSet = !!(s.catalogRecordId && s.productSetId) || !!s.leadFormId;
      for (const ad of s.ads ?? []) {
        const fmt = ad.format ?? "link";
        const bits: string[] = [];
        if (this.hasMultiText(ad)) bits.push("Text Options");
        if ((ad as any).placementAssets && Object.keys((ad as any).placementAssets).length) bits.push("Placement Asset");
        if ((ad as any).creativeEnhancements && Object.keys((ad as any).creativeEnhancements).length) bits.push("Advantage Enhancement");
        if (specialSet && bits.length) {
          push("creative", "warn", "Creative V2", `Ad "${ad.name}": এই Ad Set-এর ${s.leadFormId ? "Lead Form" : "Catalog"} Creative-এ ${bits.join(", ")} Meta-তে যাবে না — শুধু প্রথম Text Option ও মূল Asset যাবে`);
        } else if (fmt === "carousel" && bits.length) {
          const unsent = bits.filter((b) => b !== "Advantage Enhancement");
          if (unsent.length) push("creative", "warn", "Creative V2", `Ad "${ad.name}": Carousel Creative-এ ${unsent.join(", ")} যাবে না — শুধু প্রথম Text Option যাবে (Enhancement পাঠানো হবে)`);
        }
        const pa = (ad as any).placementAssets ?? {};
        for (const group of Object.keys(pa)) {
          const ref = pa[group] ?? {};
          const assetId = ref.imageAssetId ?? ref.videoAssetId;
          if (assetId && (this.prisma as any).creativeAsset?.findFirst) {
            const asset = await (this.prisma as any).creativeAsset.findFirst({ where: { id: assetId, organizationId } }).catch(() => null);
            if (!asset) push("creative", "warn", "Creative V2", `Ad "${ad.name}": ${group} Placement-এর Asset টি আর পাওয়া যাচ্ছে না — Publish ব্যর্থ হবে`);
            else if (asset.status !== "ready") push("creative", "warn", "Creative V2", `Ad "${ad.name}": ${group} Placement-এর Asset "${asset.name}" Meta-তে Ready নয় (status: ${asset.status}) — Publish ব্যর্থ হবে`);
          }
        }
      }
    }

    // CN16 (NB7): a funnel layer whose inputs were missing
    // at wizard time is an ERROR until the owner completes
    // it — the layer exists (never silently dropped) but
    // the plan is not ready while the gap stands.
    for (const s of full.adSets ?? []) {
      if ((s as any).funnelIncomplete) {
        push("funnel", "error", "Full-funnel Layer", `Ad Set "${s.name}" (${(s as any).funnelLayer ?? "layer"}): ${(s as any).funnelIncomplete}`);
      } else if ((s as any).funnelLayer) {
        push("funnel", "ok", "Full-funnel Layer", `Ad Set "${s.name}": ${(s as any).funnelLayer} Layer সম্পূর্ণ`);
      }
    }

    // CN1: a delivery estimate attempt for EVERY ad set
    // (CB2 estimated only the first). `estimate` stays as
    // the first set's result for older consumers.
    type Est = { adSetId: string; name: string; available: boolean; reason?: string; lowerBound?: number; upperBound?: number; currency?: string };
    const estimates: Est[] = [];
    let estClient: { client: MetaPublishClient; account: any } | null = null;
    let estClientError = "";
    if ((full.adSets ?? []).length) {
      try { estClient = await this.publishClient(organizationId, full); }
      catch (e) { estClientError = e instanceof Error ? e.message.slice(0, 160) : "Meta Estimate পাওয়া যায়নি"; }
    }
    for (const s of full.adSets ?? []) {
      if (!estClient) {
        estimates.push({ adSetId: s.id, name: s.name, available: false, reason: estClientError || "Meta সংযোগ নেই" });
        continue;
      }
      try {
        const est = await estClient.client.deliveryEstimate(estClient.account.externalId, {
          targeting: this.toGraphTargeting(s.targeting ?? {}, full.advantagePlus === true),
          optimizationGoal: s.optimizationGoal, currency: estClient.account.currency ?? "BDT",
        });
        estimates.push(est.lowerBound != null || est.upperBound != null
          ? { adSetId: s.id, name: s.name, available: true, lowerBound: est.lowerBound, upperBound: est.upperBound, currency: estClient.account.currency ?? "BDT" }
          : { adSetId: s.id, name: s.name, available: false, reason: "Meta কোনো Estimate ফেরত দেয়নি" });
      } catch (e) {
        estimates.push({ adSetId: s.id, name: s.name, available: false, reason: e instanceof Error ? e.message.slice(0, 160) : "Meta Estimate পাওয়া যায়নি" });
      }
    }
    const estimate: { available: boolean; reason?: string; lowerBound?: number; upperBound?: number; currency?: string } =
      estimates.length ? estimates[0] : { available: false, reason: "কোনো Ad Set নেই" };

    return { ready: !checks.some((c) => c.level === "error"), checks, budget, estimate, estimates };
  }

  // ---------- CN4: Lead Forms (model, validate, create on Meta) ----------

  /** Question types Meta's leadgen_forms reference lists
   *  that this builder offers (standard contact fields +
   *  CUSTOM + the common profile/address types). */
  static readonly LEAD_QUESTION_TYPES = ["FULL_NAME", "FIRST_NAME", "LAST_NAME", "EMAIL", "PHONE", "CUSTOM", "CITY", "COUNTRY", "POST_CODE", "ZIP", "STATE", "PROVINCE", "DOB", "GENDER", "JOB_TITLE", "COMPANY_NAME", "WEBSITE", "STREET_ADDRESS", "WORK_EMAIL", "EDUCATION_LEVEL", "SLIDER", "DATE_TIME"] as const;
  static readonly LEAD_MAPPING_TARGETS = ["name", "email", "phone", "notes"] as const;

  /** CN4 shape validation for a lead form (create + the
   *  merged row on edit). Refusals carry the reason; the
   *  privacy URL and at least one question are hard
   *  requirements — Meta will not run a form without them,
   *  so they are errors here, never silent publish-time
   *  surprises. Mapping targets are checked against the
   *  org's LIVE lead Custom Field defs. */
  private async validateLeadFormShape(organizationId: string, dto: {
    name?: string; pageId?: string; privacyPolicyUrl?: string; questions?: any[]; fieldMapping?: Record<string, string> | null;
  }): Promise<{ questions: any[]; fieldMapping: Record<string, string> | null }> {
    if (!dto.name?.trim()) throw new BadRequestException("Lead form name is required");
    if (!dto.pageId?.trim()) throw new BadRequestException("Lead form needs the Meta Page id that owns it (pageId)");
    if (!dto.privacyPolicyUrl?.trim() || !/^https:\/\//i.test(dto.privacyPolicyUrl)) {
      throw new BadRequestException("A lead form needs a Privacy Policy URL (https://...) — Meta will not run a lead form without one");
    }
    const questions = dto.questions ?? [];
    if (!Array.isArray(questions) || questions.length === 0) throw new BadRequestException("A lead form needs at least one question");
    if (questions.length > 12) throw new BadRequestException("A lead form carries at most 12 questions in this builder");
    const seen = new Set<string>();
    const out: any[] = [];
    for (const q of questions) {
      if (!q || typeof q.key !== "string" || !q.key.trim()) throw new BadRequestException("Each lead form question needs a key");
      const key = q.key.trim();
      if (seen.has(key)) throw new BadRequestException(`Duplicate question key: ${key}`);
      seen.add(key);
      if (!(CampaignsService.LEAD_QUESTION_TYPES as readonly string[]).includes(q.type)) {
        throw new BadRequestException(`Question "${key}": type "${q.type}" is not a Meta lead form question type`);
      }
      const row: any = { type: q.type, key };
      if (q.type === "CUSTOM") {
        if (!q.label?.toString().trim()) throw new BadRequestException(`Question "${key}": a CUSTOM question needs a label`);
        row.label = String(q.label).trim().slice(0, 200);
        if (Array.isArray(q.options) && q.options.length) {
          if (q.options.length > 10) throw new BadRequestException(`Question "${key}": at most 10 options`);
          row.options = q.options.map((o: any, i: number) => {
            if (!o?.value?.toString().trim()) throw new BadRequestException(`Question "${key}": each option needs a value`);
            return { key: o.key?.toString().trim() || `opt${i + 1}`, value: String(o.value).trim().slice(0, 100) };
          });
        }
      } else if (q.label) row.label = String(q.label).trim().slice(0, 200);
      out.push(row);
    }
    let fieldMapping: Record<string, string> | null = null;
    if (dto.fieldMapping && Object.keys(dto.fieldMapping).length) {
      fieldMapping = {};
      const defs = (this.prisma as any).customFieldDef?.findMany
        ? await (this.prisma as any).customFieldDef.findMany({ where: { organizationId, entity: "lead" } }).catch(() => [])
        : [];
      const liveKeys = new Set((defs ?? []).filter((d: any) => !d.archivedAt).map((d: any) => d.key));
      for (const [qk, target] of Object.entries(dto.fieldMapping)) {
        if (!seen.has(qk)) throw new BadRequestException(`fieldMapping names question "${qk}", which is not one of this form's questions`);
        if ((CampaignsService.LEAD_MAPPING_TARGETS as readonly string[]).includes(target)) fieldMapping[qk] = target;
        else if (typeof target === "string" && target.startsWith("custom:")) {
          const ck = target.slice("custom:".length);
          if (!liveKeys.has(ck)) throw new BadRequestException(`fieldMapping for "${qk}" targets custom field "${ck}", which is not a live lead Custom Field in this organization — create it in CRM first`);
          fieldMapping[qk] = target;
        } else throw new BadRequestException(`fieldMapping for "${qk}": target must be name, email, phone, notes or custom:<fieldKey>`);
      }
    }
    return { questions: out, fieldMapping };
  }

  async createLeadForm(organizationId: string, actorId: string, dto: {
    name: string; pageId: string; locale?: string; introHeadline?: string; introDescription?: string;
    questions: any[]; privacyPolicyUrl: string; privacyLinkText?: string;
    thankYouTitle?: string; thankYouBody?: string; thankYouButtonText?: string; followUpActionUrl?: string;
    higherIntent?: boolean; fieldMapping?: Record<string, string> | null;
  }) {
    const { questions, fieldMapping } = await this.validateLeadFormShape(organizationId, dto);
    const form = await (this.prisma as any).leadForm.create({
      data: {
        organizationId, pageId: dto.pageId.trim(), name: dto.name.trim(), locale: dto.locale ?? "EN_US",
        introHeadline: dto.introHeadline ?? null, introDescription: dto.introDescription ?? null,
        questions, privacyPolicyUrl: dto.privacyPolicyUrl.trim(), privacyLinkText: dto.privacyLinkText ?? null,
        thankYouTitle: dto.thankYouTitle ?? null, thankYouBody: dto.thankYouBody ?? null, thankYouButtonText: dto.thankYouButtonText ?? null,
        followUpActionUrl: dto.followUpActionUrl ?? null, higherIntent: dto.higherIntent === true,
        fieldMapping, status: "local", externalFormId: null, createdById: actorId,
      },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.lead_form_created", entityType: "LeadForm", entityId: form.id, metadata: { pageId: form.pageId, questions: questions.length } }).catch(() => undefined);
    return form;
  }

  async listLeadForms(organizationId: string) {
    return (this.prisma as any).leadForm.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 100 });
  }

  async getLeadForm(organizationId: string, formId: string) {
    const form = await (this.prisma as any).leadForm.findFirst({ where: { id: formId, organizationId } });
    if (!form) throw new NotFoundException("Lead form not found in this organization");
    return form;
  }

  /** CN4: edit a modelled form. A form already created on
   *  Meta is immutable THERE — editing forks the local row
   *  back to a draft (externalFormId cleared, status local)
   *  so the next publish creates the NEW version as its own
   *  form; the old Meta form is untouched and the response
   *  says the fork happened (forkedFromMeta). */
  async updateLeadForm(organizationId: string, formId: string, actorId: string, dto: Record<string, any>) {
    const form = await this.getLeadForm(organizationId, formId);
    const merged = {
      name: dto.name !== undefined ? dto.name : form.name,
      pageId: dto.pageId !== undefined ? dto.pageId : form.pageId,
      privacyPolicyUrl: dto.privacyPolicyUrl !== undefined ? dto.privacyPolicyUrl : form.privacyPolicyUrl,
      questions: dto.questions !== undefined ? dto.questions : form.questions,
      fieldMapping: dto.fieldMapping !== undefined ? dto.fieldMapping : form.fieldMapping,
    };
    const { questions, fieldMapping } = await this.validateLeadFormShape(organizationId, merged);
    const data: any = { questions, fieldMapping };
    for (const k of ["name", "pageId", "locale", "introHeadline", "introDescription", "privacyPolicyUrl", "privacyLinkText", "thankYouTitle", "thankYouBody", "thankYouButtonText", "followUpActionUrl"] as const) {
      if (dto[k] !== undefined) data[k] = dto[k];
    }
    if (dto.higherIntent !== undefined) data.higherIntent = dto.higherIntent === true;
    let forkedFromMeta = false;
    if (form.status === "created") { data.externalFormId = null; data.status = "local"; data.error = null; forkedFromMeta = true; }
    const updated = await (this.prisma as any).leadForm.update({ where: { id: formId }, data });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.lead_form_updated", entityType: "LeadForm", entityId: formId, metadata: { fields: Object.keys(data), forkedFromMeta } }).catch(() => undefined);
    return { ...updated, forkedFromMeta };
  }

  /** CN4: the standalone "create on Meta" action (the same
   *  call publish makes implicitly). Requires an ad account
   *  of the org to resolve the Meta token — the builder
   *  passes the plan's account. */
  async createLeadFormOnMetaAction(organizationId: string, actorId: string, formId: string, adAccountId: string) {
    const form = await this.getLeadForm(organizationId, formId);
    if (form.externalFormId && form.status === "created") return { ...form, alreadyCreated: true };
    const account = await (this.prisma as any).adAccount.findFirst({ where: { id: adAccountId, organizationId } });
    if (!account) throw new BadRequestException("Ad account not found in this organization");
    const client = await this.metaClientForAccount(organizationId, account);
    await this.createLeadFormOnMeta(organizationId, actorId, form, client);
    return this.getLeadForm(organizationId, formId);
  }

  // ---------- CN3: dynamic-retargeting preset ----------

  /** CN3: a named preset that structures a retargeting ad
   *  set from an EXISTING ready AudienceRecord of the plan's
   *  ad account (in-builder audience CREATION is CN6 — this
   *  preset consumes records only). With no record chosen it
   *  answers honestly: "missing" when the account has no
   *  ready Meta audience at all, "needs_choice" with the
   *  real candidates otherwise (the CB6 blocked/needs-input
   *  pattern — nothing is guessed). The created set is an
   *  ordinary draft ad set (PURCHASE event for both kinds;
   *  an optional catalog pair makes it a dynamic catalog
   *  retargeting set). */
  async applyRetargetingPreset(organizationId: string, planId: string, actorId: string, dto: {
    kind: string; audienceRecordId?: string; name?: string; dailyBudget?: string;
    pageId?: string; pixelId?: string; catalogRecordId?: string; productSetId?: string;
  }) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    this.assertEditable(plan);
    if (!["product_viewers", "add_to_cart"].includes(dto.kind)) {
      throw new BadRequestException(`Unknown retargeting preset "${dto.kind}" (allowed: product_viewers, add_to_cart)`);
    }
    const table = (this.prisma as any).audienceRecord;
    let record: any = null;
    if (dto.audienceRecordId) {
      record = table?.findFirst ? await table.findFirst({ where: { id: dto.audienceRecordId, organizationId } }) : null;
      if (!record) throw new BadRequestException("Audience record not found in this organization");
      if (record.adAccountId !== plan.adAccountId) throw new BadRequestException("That audience belongs to a different ad account than this plan");
      if (!record.externalAudienceId) throw new BadRequestException(`Audience "${record.name}" has no Meta audience id yet — it cannot be targeted`);
      if (record.status !== "ready") throw new BadRequestException(`Audience "${record.name}" is not ready (status: ${record.status})`);
    } else {
      const rows = table?.findMany ? await table.findMany({ where: { organizationId, adAccountId: plan.adAccountId } }) : [];
      const ready = (rows ?? []).filter((r: any) => r.externalAudienceId && r.status === "ready");
      if (!ready.length) {
        return {
          status: "missing", kind: dto.kind, adSet: null,
          missing: ["এই Plan-এর Ad Account-এ কোনো Ready Meta Audience Record নেই — Product Viewer / Cart Audience আগে Meta বা Audiences পেজে থাকতে হবে (Builder-এর ভেতরে Audience তৈরি CN6-এর কাজ); এই Preset শুধু বিদ্যমান Record ব্যবহার করে"],
          candidates: [],
        };
      }
      return {
        status: "needs_choice", kind: dto.kind, adSet: null, missing: [],
        candidates: ready.map((r: any) => ({ id: r.id, name: r.name, kind: r.kind, source: r.source, externalAudienceId: r.externalAudienceId, approximateCount: r.approximateCount ?? null })),
      };
    }
    const missing: string[] = [];
    if (!dto.pageId) missing.push("pageId — validatePlan/Ad Set-এ Page লাগবে, Preset-এর Ad Set-এ নিজে বসান");
    if (!dto.pixelId) missing.push("pixelId — OFFSITE_CONVERSIONS-এর জন্য Pixel লাগবে, Preset-এর Ad Set-এ নিজে বসান");
    const adSet = await this.addAdSet(organizationId, planId, {
      name: dto.name ?? (dto.kind === "product_viewers" ? "Retargeting — Product Viewers" : "Retargeting — Add to Cart"),
      dailyBudget: dto.dailyBudget ?? "300",
      optimizationGoal: "OFFSITE_CONVERSIONS",
      // The PURCHASE event is only storable with a pixel
      // (the CN3 matrix); without one the set still drafts
      // and publish falls back to the PURCHASE default.
      conversionEvent: dto.pixelId ? "PURCHASE" : undefined,
      pageId: dto.pageId, pixelId: dto.pixelId,
      countries: ["BD"],
      customAudienceIds: [record.externalAudienceId],
      catalogRecordId: dto.catalogRecordId, productSetId: dto.productSetId,
    });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.retargeting_preset_applied", entityType: "CampaignPlan", entityId: planId, metadata: { kind: dto.kind, audienceRecordId: record.id, adSetId: adSet.id } }).catch(() => undefined);
    return { status: "created", kind: dto.kind, audience: { id: record.id, name: record.name, externalAudienceId: record.externalAudienceId }, adSet, missing };
  }

  // ---------- Campaign Builder Next CN6: Audience Studio ----------

  /** Named exclusion presets. Each maps to a REAL source
   *  in the AudiencesService; applying one ensures a real
   *  AudienceRecord exists for the plan's ad account and
   *  puts its Meta id into the ad set's
   *  excludedAudienceIds — visible in targeting, editable
   *  like any other exclusion. No hidden magic. */
  static readonly EXCLUSION_PRESETS: Record<string, { source: string; segment?: string; label: string }> = {
    exclude_purchasers_30d: { source: "recent_purchasers", segment: "30", label: "শেষ ৩০ দিনের ক্রেতাদের বাদ দিন" },
    exclude_existing_customers: { source: "customers", label: "বিদ্যমান সব Customer বাদ দিন" },
  };

  private requireAudiences(): AudiencesService {
    if (!this.audiences) throw new BadRequestException("Audience Studio is not wired in this deployment (AudiencesService unavailable)");
    return this.audiences;
  }

  private async getAdSetOrThrow(planId: string, adSetId: string) {
    const adSet = await (this.prisma as any).campaignAdSet.findFirst({ where: { id: adSetId, planId } });
    if (!adSet) throw new NotFoundException("Ad set not found in this plan");
    return adSet;
  }

  /** Studio home data: source catalogue (real counts) +
   *  the plan account's AudienceRecords + preset list. */
  async audienceStudio(organizationId: string, planId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    const presets = Object.entries(CampaignsService.EXCLUSION_PRESETS).map(([key, v]) => ({ key, label: v.label, source: v.source, segment: v.segment ?? null }));
    if (!this.audiences) {
      return { available: false, reason: "AudiencesService এই Deployment-এ যুক্ত নেই", sources: [], records: [], presets };
    }
    const sources = await this.audiences.sourceCatalog(organizationId);
    const records = (this.prisma as any).audienceRecord?.findMany
      ? await (this.prisma as any).audienceRecord.findMany({ where: { organizationId, adAccountId: plan.adAccountId }, orderBy: { createdAt: "desc" }, take: 100 }).catch(() => [])
      : [];
    return { available: true, sources, records, presets };
  }

  /** Attach a Meta audience id to an ad set's targeting
   *  list (include or exclude), deduplicated. The caller
   *  has already checked the plan is editable. */
  private async attachAudienceId(planId: string, adSet: any, listKey: "customAudienceIds" | "excludedAudienceIds", externalId: string) {
    const targeting = { ...(adSet.targeting ?? {}) };
    const list: string[] = Array.isArray(targeting[listKey]) ? [...targeting[listKey]] : [];
    if (!list.includes(externalId)) list.push(externalId);
    targeting[listKey] = list;
    const updated = await (this.prisma as any).campaignAdSet.update({ where: { id: adSet.id }, data: { targeting } });
    return { ...this.adSetJson(updated), targeting: updated.targeting };
  }

  /** One-click audience creation from inside an ad set,
   *  through AudiencesService.createCustom — the record,
   *  the hashed upload and the Meta creation are the
   *  existing service's, end to end. Attaching happens
   *  ONLY when Meta confirmed an audience id. */
  async studioCreateAudience(organizationId: string, planId: string, adSetId: string, actorId: string, dto: { source: string; segment?: string; name: string; attach?: boolean }) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    this.assertEditable(plan);
    const adSet = await this.getAdSetOrThrow(planId, adSetId);
    const audiences = this.requireAudiences();
    const record = await audiences.createCustom(organizationId, actorId, {
      adAccountId: plan.adAccountId, name: dto.name, source: dto.source, segment: dto.segment,
    });
    let attached = false;
    let updatedAdSet: any = null;
    if (dto.attach && record?.externalAudienceId) {
      updatedAdSet = await this.attachAudienceId(planId, adSet, "customAudienceIds", String(record.externalAudienceId));
      attached = true;
    }
    return {
      record, attached, adSet: updatedAdSet,
      note: record?.status === "failed" ? (record.error ?? "Meta Audience তৈরি হয়নি") : (!record?.externalAudienceId ? "Meta এখনো Audience ID দেয়নি — তৈরি নিশ্চিত হয়নি, তাই Ad Set-এ যুক্ত করা হয়নি" : undefined),
    };
  }

  /** Inline lookalike creation (existing createLookalike
   *  path). Country is validated here as an ISO code —
   *  the underlying service validates ratio and the
   *  source's Meta id. */
  async studioCreateLookalike(organizationId: string, planId: string, adSetId: string, actorId: string, dto: { sourceAudienceRecordId: string; name: string; country: string; ratio?: number; attach?: boolean }) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    this.assertEditable(plan);
    const adSet = await this.getAdSetOrThrow(planId, adSetId);
    const country = String(dto.country ?? "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) throw new BadRequestException(`country must be an ISO 2-letter code (e.g. "BD") — got "${dto.country}"`);
    const audiences = this.requireAudiences();
    const record = await audiences.createLookalike(organizationId, actorId, {
      adAccountId: plan.adAccountId, name: dto.name, sourceAudienceRecordId: dto.sourceAudienceRecordId, country, ratio: dto.ratio,
    });
    let attached = false;
    let updatedAdSet: any = null;
    if (dto.attach && record?.externalAudienceId) {
      updatedAdSet = await this.attachAudienceId(planId, adSet, "customAudienceIds", String(record.externalAudienceId));
      attached = true;
    }
    return {
      record, attached, adSet: updatedAdSet,
      note: record?.status === "failed" ? (record.error ?? "Meta Lookalike তৈরি হয়নি") : (!record?.externalAudienceId ? "Meta এখনো Audience ID দেয়নি — তৈরি নিশ্চিত হয়নি, তাই Ad Set-এ যুক্ত করা হয়নি" : undefined),
    };
  }

  /** Apply a named exclusion preset: reuse the account's
   *  existing record for the preset's source when one
   *  exists with a Meta id; otherwise build it through
   *  the AudiencesService. The preset lands in targeting
   *  as BOTH the excluded id and a named exclusionPresets
   *  entry, so it stays inspectable and removable. */
  async studioApplyExclusionPreset(organizationId: string, planId: string, adSetId: string, actorId: string, dto: { preset: string }) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    this.assertEditable(plan);
    const adSet = await this.getAdSetOrThrow(planId, adSetId);
    const def = CampaignsService.EXCLUSION_PRESETS[dto.preset];
    if (!def) throw new BadRequestException(`preset must be one of ${Object.keys(CampaignsService.EXCLUSION_PRESETS).join(", ")}`);
    const audiences = this.requireAudiences();
    let record: any = null;
    if ((this.prisma as any).audienceRecord?.findMany) {
      const rows = await (this.prisma as any).audienceRecord.findMany({
        where: { organizationId, adAccountId: plan.adAccountId, source: def.source, ...(def.segment ? { sourceDetail: def.segment } : {}) },
      }).catch(() => []);
      record = (rows ?? []).find((r: any) => r.externalAudienceId && r.status === "ready")
        ?? (rows ?? []).find((r: any) => r.externalAudienceId)
        ?? null;
    }
    let created = false;
    if (!record) {
      record = await audiences.createCustom(organizationId, actorId, {
        adAccountId: plan.adAccountId,
        name: def.segment ? `${def.label} (auto)` : `${def.label} (auto)`,
        source: def.source, segment: def.segment,
      });
      created = true;
    }
    if (!record?.externalAudienceId) {
      return {
        status: "unavailable", preset: dto.preset, created, record,
        reason: record?.error ?? "Meta এই Audience-এর ID দেয়নি — Preset প্রয়োগ করা হয়নি (কোনো কিছু Exclude করা হয়নি)",
      };
    }
    const targeting = { ...(adSet.targeting ?? {}) };
    const excluded: string[] = Array.isArray(targeting.excludedAudienceIds) ? [...targeting.excludedAudienceIds] : [];
    if (!excluded.includes(String(record.externalAudienceId))) excluded.push(String(record.externalAudienceId));
    targeting.excludedAudienceIds = excluded;
    const presets: any[] = Array.isArray(targeting.exclusionPresets) ? targeting.exclusionPresets.filter((p: any) => p?.key !== dto.preset) : [];
    presets.push({ key: dto.preset, label: def.label, audienceRecordId: record.id, externalAudienceId: String(record.externalAudienceId), appliedAt: new Date().toISOString() });
    targeting.exclusionPresets = presets;
    const updated = await (this.prisma as any).campaignAdSet.update({ where: { id: adSet.id }, data: { targeting } });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.exclusion_preset_applied", entityType: "CampaignAdSet", entityId: adSetId, metadata: { preset: dto.preset, audienceRecordId: record.id, created } }).catch(() => undefined);
    return { status: "applied", preset: dto.preset, label: def.label, created, record, adSet: { ...this.adSetJson(updated), targeting: updated.targeting } };
  }

  /** Per-ad-set audience picture: each selected audience
   *  resolved against OUR AudienceRecords — size is Meta's
   *  approximate_count, else the last membership-sync
   *  count, else UNKNOWN (null, never invented). Overlap
   *  is honestly NOT computable from stored data (member
   *  hashes are never stored); the answer says so. */
  async audienceInsights(organizationId: string, planId: string, adSetId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    const adSet = await this.getAdSetOrThrow(planId, adSetId);
    const targeting = adSet.targeting ?? {};
    const records = (this.prisma as any).audienceRecord?.findMany
      ? await (this.prisma as any).audienceRecord.findMany({ where: { organizationId, adAccountId: plan.adAccountId }, take: 200 }).catch(() => [])
      : [];
    const byExternal = new Map<string, any>((records ?? []).map((r: any) => [String(r.externalAudienceId ?? ""), r]));
    const warnings: string[] = [];
    const entry = (externalId: string) => {
      const rec = byExternal.get(String(externalId));
      if (!rec) {
        warnings.push(`Audience ${externalId}: আমাদের AudienceRecord নয় (ID দিয়ে যোগ করা) — Size জানা নেই (unknown)`);
        return { externalId: String(externalId), recordId: null, name: null, kind: null, status: null, size: null, sizeSource: null };
      }
      const size = rec.approximateCount != null ? Number(rec.approximateCount) : (rec.lastMembershipCount != null ? Number(rec.lastMembershipCount) : null);
      if (size == null) warnings.push(`Audience "${rec.name}": Size জানা নেই (unknown) — Audiences পেজে Refresh করলে Meta-র Approximate Count আসবে`);
      return {
        externalId: String(externalId), recordId: rec.id, name: rec.name, kind: rec.kind, status: rec.status,
        size, sizeSource: rec.approximateCount != null ? "meta_approximate_count" : (rec.lastMembershipCount != null ? "last_membership_sync" : null),
      };
    };
    const included = (Array.isArray(targeting.customAudienceIds) ? targeting.customAudienceIds : []).map(entry);
    const excluded = (Array.isArray(targeting.excludedAudienceIds) ? targeting.excludedAudienceIds : []).map(entry);
    // Estimate for THIS ad set only (the CN1 pattern).
    let estimate: any = { available: false, reason: "কোনো Ad Set নেই" };
    try {
      const { client, account } = await this.publishClient(organizationId, plan);
      const est = await client.deliveryEstimate(account.externalId, {
        targeting: this.toGraphTargeting(targeting, plan.advantagePlus === true),
        optimizationGoal: adSet.optimizationGoal, currency: account.currency ?? "BDT",
      });
      estimate = est.lowerBound != null || est.upperBound != null
        ? { available: true, lowerBound: est.lowerBound, upperBound: est.upperBound, currency: account.currency ?? "BDT" }
        : { available: false, reason: "Meta কোনো Estimate ফেরত দেয়নি" };
    } catch (e) {
      estimate = { available: false, reason: e instanceof Error ? e.message.slice(0, 160) : "Meta Estimate পাওয়া যায়নি" };
    }
    const distinctIncluded = new Set(included.map((i: any) => i.externalId));
    const overlap = distinctIncluded.size <= 1
      ? { status: "not_applicable", reason: "একটির বেশি Included Audience নেই — Overlap-এর প্রশ্নই ওঠে না" }
      : { status: "not_computable", reason: "সদস্যদের Hash তালিকা সংরক্ষণ করা হয় না, তাই দুটি Audience-এর Overlap এখান থেকে হিসাব করা যায় না — Meta Ads Manager-এর Audience Overlap টুলে দেখা যাবে" };
    return { adSetId, included, excluded, estimate, overlap, warnings };
  }

  async deletePlan(organizationId: string, planId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    if (plan.status === "published") throw new BadRequestException("Published plans cannot be deleted (they exist on Meta). Archive them instead.");
    await (this.prisma as any).campaignPlan.delete({ where: { id: planId } });
    return { deleted: true };
  }

  // Campaign Builder CB1: placement vocabularies. Empty
  // selection = Meta's default placements, and the UI
  // says so — nothing is silently implied.
  static readonly PLATFORMS = ["facebook", "instagram", "audience_network", "messenger"] as const;
  static readonly POSITIONS = ["feed", "story", "reels", "search"] as const;
  static readonly DEVICES = ["mobile", "desktop"] as const;

  private validatePlacements(dto: { platforms?: string[]; positions?: string[]; devices?: string[] }) {
    const check = (values: string[] | undefined, allowed: readonly string[], label: string) => {
      for (const v of values ?? []) {
        if (!allowed.includes(v)) throw new BadRequestException(`Invalid ${label}: ${v} (allowed: ${allowed.join(", ")})`);
      }
    };
    check(dto.platforms, CampaignsService.PLATFORMS, "platform");
    check(dto.positions, CampaignsService.POSITIONS, "position");
    check(dto.devices, CampaignsService.DEVICES, "device");
  }

  // Campaign Builder Next CN1: targeting vocabularies.
  static readonly LOCATION_TYPES = ["home", "recent", "travel_in", "everyone"] as const;
  /** Search kinds the builder exposes -> Meta targetingsearch types. */
  static readonly TARGETING_SEARCH_TYPES: Record<string, string> = {
    interest: "adinterest", behavior: "adbehavior", life_event: "adlifeevent",
    work_position: "adworkposition", geo: "adgeolocation", locale: "adlocale",
  };

  /** CN1: normalize one targeting entry. A plain string is
   *  the legacy free-text form (kept as a string so stored
   *  targeting stays byte-compatible with pre-CN1 plans);
   *  an object must carry a name, and may carry the Meta id
   *  that targeting search returned for it. */
  private normalizeEntry(e: any, label: string): any {
    if (typeof e === "string") {
      const name = e.trim();
      if (!name) throw new BadRequestException(`${label}: empty entry`);
      return name;
    }
    if (e && typeof e === "object" && typeof e.name === "string" && e.name.trim()) {
      const out: any = { name: e.name.trim() };
      if (e.id !== undefined && e.id !== null && String(e.id).trim()) out.id = String(e.id).trim();
      return out;
    }
    throw new BadRequestException(`${label}: each entry must be a name or { id, name }`);
  }

  private normalizeEntries(list: any[] | undefined, label: string): any[] | undefined {
    if (list === undefined) return undefined;
    return list.map((e) => this.normalizeEntry(e, label));
  }

  /** CN1: shape/vocabulary validation for the new targeting
   *  fields. Runs on create AND on the DTO-provided slice of
   *  an edit — a value the service cannot express in the
   *  Graph payload is refused here, never silently dropped. */
  private validateTargetingShape(dto: {
    cities?: any[]; postcodes?: string[]; locationTypes?: string[]; locales?: number[];
    behaviors?: any[]; demographics?: Record<string, unknown> | null;
    narrowInterests?: any[]; narrowBehaviors?: any[]; interests?: any[];
  }) {
    for (const lt of dto.locationTypes ?? []) {
      if (!(CampaignsService.LOCATION_TYPES as readonly string[]).includes(lt)) {
        throw new BadRequestException(`Invalid location type: ${lt} (allowed: ${CampaignsService.LOCATION_TYPES.join(", ")})`);
      }
    }
    for (const c of dto.cities ?? []) {
      if (!c || typeof c.key !== "string" || !c.key.trim()) throw new BadRequestException("Each city needs its Meta location key (use Targeting Search to find it)");
      if (c.radius !== undefined && (!Number.isFinite(Number(c.radius)) || Number(c.radius) < 1 || Number(c.radius) > 80)) {
        throw new BadRequestException(`City "${c.key}": radius must be between 1 and 80`);
      }
      if (c.distanceUnit !== undefined && !["mile", "kilometer"].includes(c.distanceUnit)) {
        throw new BadRequestException(`City "${c.key}": distanceUnit must be "mile" or "kilometer"`);
      }
    }
    for (const z of dto.postcodes ?? []) {
      if (typeof z !== "string" || !z.trim()) throw new BadRequestException("Each postcode must be its Meta zip key (e.g. US:90210 — find it via Targeting Search)");
    }
    for (const l of dto.locales ?? []) {
      if (!Number.isInteger(l) || l <= 0) throw new BadRequestException(`Invalid locale id: ${l} (Meta locale ids are positive integers — find them via Targeting Search)`);
    }
    const demo = dto.demographics;
    if (demo !== undefined && demo !== null) {
      if (typeof demo !== "object" || Array.isArray(demo)) throw new BadRequestException("demographics must be an object");
      for (const k of Object.keys(demo)) {
        if (!["educationStatuses", "relationshipStatuses", "lifeEvents", "workPositions"].includes(k)) {
          throw new BadRequestException(`Unknown demographics field: ${k} (allowed: educationStatuses, relationshipStatuses, lifeEvents, workPositions)`);
        }
      }
      for (const k of ["educationStatuses", "relationshipStatuses"] as const) {
        for (const v of (demo as any)[k] ?? []) {
          if (!Number.isInteger(v) || v <= 0) throw new BadRequestException(`demographics.${k} must be positive integer ids`);
        }
      }
    }
  }

  /** CN1: every { id, name } entry inside a targeting-like
   *  object, tagged with the search kind that can confirm it. */
  private idEntriesOf(t: any): { kind: string; id: string; name: string }[] {
    const out: { kind: string; id: string; name: string }[] = [];
    const scan = (list: any, kind: string) => {
      for (const e of Array.isArray(list) ? list : []) {
        if (e && typeof e === "object" && e.id) out.push({ kind, id: String(e.id), name: String(e.name ?? "") });
      }
    };
    scan(t?.interests, "interest"); scan(t?.behaviors, "behavior");
    scan(t?.narrowInterests, "interest"); scan(t?.narrowBehaviors, "behavior");
    scan(t?.demographics?.lifeEvents, "life_event"); scan(t?.demographics?.workPositions, "work_position");
    return out;
  }

  /** CN1: entries WITHOUT an id (the legacy free-text form).
   *  Counted for the readiness flag — they are stored and
   *  published by name exactly as before, but nothing has
   *  confirmed Meta knows them. */
  private nameOnlyEntriesOf(t: any): string[] {
    const out: string[] = [];
    const scan = (list: any) => {
      for (const e of Array.isArray(list) ? list : []) {
        if (typeof e === "string" && e.trim()) out.push(e);
        else if (e && typeof e === "object" && !e.id && e.name) out.push(String(e.name));
      }
    };
    scan(t?.interests); scan(t?.behaviors); scan(t?.narrowInterests); scan(t?.narrowBehaviors);
    scan(t?.demographics?.lifeEvents); scan(t?.demographics?.workPositions);
    return out;
  }

  /**
   * CN1 validation rule (the documented resolution of the
   * legacy tension): an entry that CLAIMS a Meta id must be
   * confirmed against Meta before it is stored — an
   * unconfirmable id is refused with the reason, never
   * silently saved or published. Name-only entries skip
   * this entirely (legacy behaviour) and are flagged in
   * readiness instead. With no Meta connection the id
   * cannot be confirmed, so the refusal says exactly that.
   */
  private async assertIdEntriesConfirmed(organizationId: string, plan: any, targetingLike: any) {
    const entries = this.idEntriesOf(targetingLike);
    if (!entries.length) return;
    let client: MetaPublishClient; let account: any;
    try {
      ({ client, account } = await this.publishClient(organizationId, plan));
    } catch (e) {
      throw new BadRequestException(`Targeting ID যাচাই করা যায়নি: ${e instanceof Error ? e.message : "Meta connection unavailable"} — ID-সহ Entry সেভ করতে আগে Meta Connect করুন, অথবা ID ছাড়া শুধু নাম দিন (নাম-ভিত্তিক Entry Readiness এ অযাচাইকৃত হিসেবে চিহ্নিত থাকবে)।`);
    }
    const seen = new Set<string>();
    for (const entry of entries) {
      const cacheKey = `${entry.kind}:${entry.id}`;
      if (seen.has(cacheKey)) continue;
      seen.add(cacheKey);
      const type = CampaignsService.TARGETING_SEARCH_TYPES[entry.kind];
      let rows: any[];
      try {
        rows = await client.targetingSearch(account.externalId, { type, query: entry.name });
      } catch (e) {
        throw new BadRequestException(`Targeting "${entry.name}" (id ${entry.id}) Meta দিয়ে যাচাই করা যায়নি: ${e instanceof Error ? e.message.slice(0, 160) : "search failed"} — যাচাই ছাড়া এটি সেভ করা হবে না।`);
      }
      if (!rows.some((r: any) => String(r?.id) === entry.id)) {
        throw new BadRequestException(`Targeting "${entry.name}" (id ${entry.id}) Meta তে পাওয়া যায়নি — ID টি ভুল হতে পারে। Targeting Search দিয়ে সঠিক Entry বেছে নিন।`);
      }
    }
  }

  /** Build the stored targeting object from DTO fields,
   *  layering over an existing object on edits so a
   *  partial update never wipes untouched keys. */
  private buildTargeting(dto: {
    countries?: string[]; ageMin?: number; ageMax?: number; genders?: number[];
    interests?: any[]; customAudienceIds?: string[]; excludedAudienceIds?: string[];
    platforms?: string[]; positions?: string[]; devices?: string[];
    cities?: any[]; postcodes?: string[]; locationTypes?: string[]; locales?: number[];
    behaviors?: any[]; demographics?: Record<string, unknown> | null;
    narrowInterests?: any[]; narrowBehaviors?: any[]; targetingExpansion?: boolean;
  }, base?: any) {
    const t: any = { ...(base ?? {}) };
    if (dto.countries !== undefined) t.countries = dto.countries;
    if (dto.ageMin !== undefined) t.ageMin = dto.ageMin;
    if (dto.ageMax !== undefined) t.ageMax = dto.ageMax;
    if (dto.genders !== undefined) t.genders = dto.genders;
    for (const key of ["customAudienceIds", "excludedAudienceIds", "platforms", "positions", "devices", "postcodes", "locationTypes", "locales"] as const) {
      if (dto[key] !== undefined) {
        if (dto[key]?.length) t[key] = dto[key];
        else delete t[key];
      }
    }
    // CN1: entry lists are normalized (name strings stay
    // strings; { id, name } objects are kept as objects).
    for (const key of ["interests", "behaviors", "narrowInterests", "narrowBehaviors"] as const) {
      if (dto[key] !== undefined) {
        const normalized = this.normalizeEntries(dto[key], key);
        if (normalized?.length) t[key] = normalized;
        else delete t[key];
      }
    }
    if (dto.cities !== undefined) {
      if (dto.cities?.length) {
        t.cities = dto.cities.map((c: any) => ({
          key: String(c.key).trim(),
          ...(c.name ? { name: String(c.name) } : {}),
          ...(c.radius !== undefined ? { radius: Number(c.radius) } : {}),
          ...(c.distanceUnit ? { distanceUnit: c.distanceUnit } : {}),
        }));
      } else delete t.cities;
    }
    if (dto.demographics !== undefined) {
      const d = dto.demographics;
      const has = d && typeof d === "object" && Object.values(d as any).some((v: any) => (Array.isArray(v) ? v.length : v != null));
      if (has) {
        const demo: any = {};
        if ((d as any).educationStatuses?.length) demo.educationStatuses = (d as any).educationStatuses;
        if ((d as any).relationshipStatuses?.length) demo.relationshipStatuses = (d as any).relationshipStatuses;
        if ((d as any).lifeEvents?.length) demo.lifeEvents = this.normalizeEntries((d as any).lifeEvents, "lifeEvents");
        if ((d as any).workPositions?.length) demo.workPositions = this.normalizeEntries((d as any).workPositions, "workPositions");
        t.demographics = demo;
      } else delete t.demographics;
    }
    if (dto.targetingExpansion !== undefined) {
      if (dto.targetingExpansion) t.targetingExpansion = true;
      else delete t.targetingExpansion;
    }
    return t;
  }

  async addAdSet(organizationId: string, planId: string, dto: {
    name: string; dailyBudget?: string; lifetimeBudget?: string; optimizationGoal: string;
    pageId?: string; pixelId?: string; countries: string[]; ageMin?: number; ageMax?: number; genders?: number[];
    interests?: any[]; customAudienceIds?: string[]; excludedAudienceIds?: string[];
    platforms?: string[]; positions?: string[]; devices?: string[];
    cities?: any[]; postcodes?: string[]; locationTypes?: string[]; locales?: number[];
    behaviors?: any[]; demographics?: Record<string, unknown> | null;
    narrowInterests?: any[]; narrowBehaviors?: any[]; targetingExpansion?: boolean;
    bidStrategy?: string; bidAmount?: string; costPerResultGoal?: string; roasGoal?: string;
    conversionEvent?: string; catalogRecordId?: string; productSetId?: string; leadFormId?: string;
    destinationType?: string; whatsappIntegrationId?: string;
    startTime?: string; endTime?: string;
  }) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    this.assertEditable(plan);
    if (!(OPTIMIZATION_GOALS as readonly string[]).includes(dto.optimizationGoal)) throw new BadRequestException("Invalid optimization goal");
    // CN2: on a CBO plan the budget lives on the campaign,
    // so an ad set legitimately carries none.
    if (!dto.dailyBudget && !dto.lifetimeBudget && plan.budgetMode !== "cbo") throw new BadRequestException("Either a daily or a lifetime budget is required");
    if (!dto.countries?.length) throw new BadRequestException("At least one target country is required");
    this.validatePlacements(dto);
    this.validateTargetingShape(dto);
    const targeting = this.buildTargeting({
      countries: dto.countries, ageMin: dto.ageMin ?? 18, ageMax: dto.ageMax ?? 65, genders: dto.genders ?? [0],
      interests: dto.interests, customAudienceIds: dto.customAudienceIds, excludedAudienceIds: dto.excludedAudienceIds,
      platforms: dto.platforms, positions: dto.positions, devices: dto.devices,
      cities: dto.cities, postcodes: dto.postcodes, locationTypes: dto.locationTypes, locales: dto.locales,
      behaviors: dto.behaviors, demographics: dto.demographics,
      narrowInterests: dto.narrowInterests, narrowBehaviors: dto.narrowBehaviors, targetingExpansion: dto.targetingExpansion,
    });
    // CN1: id-carrying entries must be confirmed by Meta
    // BEFORE anything is stored (see assertIdEntriesConfirmed).
    await this.assertIdEntriesConfirmed(organizationId, plan, targeting);
    // CN2: bidding, validated against the support matrix.
    const bid = this.buildBid(dto) ?? { bidStrategy: null, bidAmountMinor: null, costGoalMinor: null, roasAverageFloor: null };
    const bidError = this.validateBid(plan.objective, { optimizationGoal: dto.optimizationGoal, pixelId: dto.pixelId ?? null, ...bid });
    if (bidError) throw new BadRequestException(bidError);
    // CN3: the conversion event, validated against its matrix.
    const eventError = this.validateConversionEvent(plan.objective, { optimizationGoal: dto.optimizationGoal, pixelId: dto.pixelId ?? null, conversionEvent: dto.conversionEvent ?? null });
    if (eventError) throw new BadRequestException(eventError);
    // CN3: catalog refs resolve against the real records now.
    await this.resolveCatalogRefs(organizationId, dto);
    if (dto.catalogRecordId && dto.conversionEvent) {
      throw new BadRequestException("A catalog ad set optimizes on its product set — conversionEvent is not sent for catalog ads; clear one of them");
    }
    // CN4: a lead form ref must exist and match the Page.
    await this.resolveLeadFormRef(organizationId, dto);
    // CN13: a WhatsApp destination — the matrix first,
    // then the picked connection resolves against the
    // org's real WhatsApp Integrations (CONNECTED only;
    // digits read back from Meta, never typed).
    const waError = this.validateWhatsAppDestination(plan.objective, {
      destinationType: dto.destinationType ?? null, whatsappIntegrationId: dto.whatsappIntegrationId ?? null,
      optimizationGoal: dto.optimizationGoal, pageId: dto.pageId ?? null,
      catalogRecordId: dto.catalogRecordId ?? null, productSetId: dto.productSetId ?? null,
      leadFormId: dto.leadFormId ?? null, conversionEvent: dto.conversionEvent ?? null,
    });
    if (waError) throw new BadRequestException(waError);
    const waRef = dto.destinationType === "WHATSAPP"
      ? await this.resolveWhatsAppRef(organizationId, dto.whatsappIntegrationId!)
      : null;
    const adSet = await (this.prisma as any).campaignAdSet.create({
      data: {
        planId, name: dto.name,
        dailyBudgetMinor: dto.dailyBudget ? parseMoneyToMinor(dto.dailyBudget) : null,
        lifetimeBudgetMinor: dto.lifetimeBudget ? parseMoneyToMinor(dto.lifetimeBudget) : null,
        optimizationGoal: dto.optimizationGoal, pageId: dto.pageId ?? null, pixelId: dto.pixelId ?? null,
        targeting: targeting as any,
        bidStrategy: bid.bidStrategy, bidAmountMinor: bid.bidAmountMinor, costGoalMinor: bid.costGoalMinor, roasAverageFloor: bid.roasAverageFloor,
        conversionEvent: dto.conversionEvent ?? null,
        catalogRecordId: dto.catalogRecordId ?? null, productSetId: dto.productSetId ?? null, leadFormId: dto.leadFormId ?? null,
        destinationType: waRef ? "WHATSAPP" : null,
        whatsappIntegrationId: waRef ? dto.whatsappIntegrationId! : null,
        whatsappPhoneNumberId: waRef?.phoneNumberId ?? null,
        whatsappPhoneNumber: waRef?.phoneNumber ?? null,
        startTime: dto.startTime ? new Date(dto.startTime) : null,
        endTime: dto.endTime ? new Date(dto.endTime) : null,
      },
    });
    return this.adSetJson(adSet);
  }

  /** CB1: edit an ad set in place (draft plans only).
   *  When either budget field is present the budget
   *  pair is replaced wholesale — send both to switch
   *  between daily and lifetime. */
  async updateAdSet(organizationId: string, planId: string, adSetId: string, actorId: string, dto: {
    name?: string; dailyBudget?: string; lifetimeBudget?: string; optimizationGoal?: string;
    pageId?: string; pixelId?: string; countries?: string[]; ageMin?: number; ageMax?: number; genders?: number[];
    interests?: any[]; customAudienceIds?: string[]; excludedAudienceIds?: string[];
    platforms?: string[]; positions?: string[]; devices?: string[];
    cities?: any[]; postcodes?: string[]; locationTypes?: string[]; locales?: number[];
    behaviors?: any[]; demographics?: Record<string, unknown> | null;
    narrowInterests?: any[]; narrowBehaviors?: any[]; targetingExpansion?: boolean;
    bidStrategy?: string; bidAmount?: string; costPerResultGoal?: string; roasGoal?: string;
    conversionEvent?: string; catalogRecordId?: string; productSetId?: string; leadFormId?: string;
    destinationType?: string; whatsappIntegrationId?: string;
    startTime?: string; endTime?: string;
  }) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    this.assertEditable(plan);
    const adSet = await (this.prisma as any).campaignAdSet.findFirst({ where: { id: adSetId, planId } });
    if (!adSet) throw new NotFoundException("Ad set not found in this plan");
    if (dto.optimizationGoal !== undefined && !(OPTIMIZATION_GOALS as readonly string[]).includes(dto.optimizationGoal)) {
      throw new BadRequestException("Invalid optimization goal");
    }
    if (dto.countries !== undefined && !dto.countries.length) throw new BadRequestException("At least one target country is required");
    this.validatePlacements(dto);
    this.validateTargetingShape(dto);
    // CN1: only the entries THIS edit carries are
    // re-confirmed — untouched legacy entries are not
    // re-validated (they keep their readiness flag).
    await this.assertIdEntriesConfirmed(organizationId, plan, {
      interests: dto.interests, behaviors: dto.behaviors,
      narrowInterests: dto.narrowInterests, narrowBehaviors: dto.narrowBehaviors,
      demographics: dto.demographics ?? undefined,
    });
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.optimizationGoal !== undefined) data.optimizationGoal = dto.optimizationGoal;
    if (dto.pageId !== undefined) data.pageId = dto.pageId || null;
    if (dto.pixelId !== undefined) data.pixelId = dto.pixelId || null;
    if (dto.dailyBudget !== undefined || dto.lifetimeBudget !== undefined) {
      if (!dto.dailyBudget && !dto.lifetimeBudget) throw new BadRequestException("Either a daily or a lifetime budget is required");
      data.dailyBudgetMinor = dto.dailyBudget ? parseMoneyToMinor(dto.dailyBudget) : null;
      data.lifetimeBudgetMinor = dto.lifetimeBudget ? parseMoneyToMinor(dto.lifetimeBudget) : null;
    }
    const targetingTouched = ["countries", "ageMin", "ageMax", "genders", "interests", "customAudienceIds", "excludedAudienceIds", "platforms", "positions", "devices",
      "cities", "postcodes", "locationTypes", "locales", "behaviors", "demographics", "narrowInterests", "narrowBehaviors", "targetingExpansion"]
      .some((k) => (dto as any)[k] !== undefined);
    if (targetingTouched) data.targeting = this.buildTargeting(dto, adSet.targeting);
    // CN2: bidding — validated against the FINAL merged
    // ad set (goal/pixel may themselves be edited here).
    const bid = this.buildBid(dto, adSet);
    if (bid) {
      const bidError = this.validateBid(plan.objective, {
        optimizationGoal: dto.optimizationGoal ?? adSet.optimizationGoal,
        pixelId: dto.pixelId !== undefined ? (dto.pixelId || null) : adSet.pixelId,
        ...bid,
      });
      if (bidError) throw new BadRequestException(bidError);
      data.bidStrategy = bid.bidStrategy;
      data.bidAmountMinor = bid.bidAmountMinor;
      data.costGoalMinor = bid.costGoalMinor;
      data.roasAverageFloor = bid.roasAverageFloor;
    }
    // NB2 (CN3/CN4): conversion event / catalog / lead-form
    // fields — the pure event matrix is re-checked against
    // the merged ad set whenever goal/pixel/event move; the
    // record-resolving checks run only when THIS edit carries
    // one of the ref fields (CN1's edit-scoped rule).
    const cnTouched = dto.conversionEvent !== undefined || dto.catalogRecordId !== undefined || dto.productSetId !== undefined || dto.leadFormId !== undefined;
    if (cnTouched || dto.optimizationGoal !== undefined || dto.pixelId !== undefined || dto.pageId !== undefined) {
      const merged = {
        optimizationGoal: dto.optimizationGoal ?? adSet.optimizationGoal,
        pixelId: dto.pixelId !== undefined ? (dto.pixelId || null) : adSet.pixelId,
        pageId: dto.pageId !== undefined ? (dto.pageId || null) : adSet.pageId,
        conversionEvent: dto.conversionEvent !== undefined ? (dto.conversionEvent || null) : (adSet.conversionEvent ?? null),
        catalogRecordId: dto.catalogRecordId !== undefined ? (dto.catalogRecordId || null) : (adSet.catalogRecordId ?? null),
        productSetId: dto.productSetId !== undefined ? (dto.productSetId || null) : (adSet.productSetId ?? null),
        leadFormId: dto.leadFormId !== undefined ? (dto.leadFormId || null) : (adSet.leadFormId ?? null),
      };
      const evErr = this.validateConversionEvent(plan.objective, merged);
      if (evErr) throw new BadRequestException(evErr);
      if (cnTouched) {
        await this.resolveCatalogRefs(organizationId, merged);
        if (merged.catalogRecordId && merged.conversionEvent) {
          throw new BadRequestException("A catalog ad set optimizes on its product set — conversionEvent is not sent for catalog ads; clear one of them");
        }
        await this.resolveLeadFormRef(organizationId, merged);
        if (dto.conversionEvent !== undefined) data.conversionEvent = merged.conversionEvent;
        if (dto.catalogRecordId !== undefined) data.catalogRecordId = merged.catalogRecordId;
        if (dto.productSetId !== undefined) data.productSetId = merged.productSetId;
        if (dto.leadFormId !== undefined) data.leadFormId = merged.leadFormId;
      }
    }
    // CN13: WhatsApp destination — the matrix is re-checked
    // against the MERGED ad set whenever the destination,
    // the picked connection, the goal or the Page moves
    // (the CN2/CN3 edit discipline). The record-resolving
    // check runs when the destination is (re)asserted or
    // the connection changes; switching the connection
    // re-reads the digits from Meta. "" clears the
    // destination (and every WhatsApp field with it).
    const waTouched = dto.destinationType !== undefined || dto.whatsappIntegrationId !== undefined;
    if (waTouched || dto.optimizationGoal !== undefined || dto.pageId !== undefined) {
      const mergedWa = {
        destinationType: dto.destinationType !== undefined ? (dto.destinationType || null) : (adSet.destinationType ?? null),
        // Clearing the destination ("") clears the number
        // binding with it — a stored number without the
        // WHATSAPP destination is exactly the inconsistent
        // state the matrix refuses.
        whatsappIntegrationId: dto.destinationType !== undefined && !dto.destinationType ? null
          : dto.whatsappIntegrationId !== undefined ? (dto.whatsappIntegrationId || null) : (adSet.whatsappIntegrationId ?? null),
        optimizationGoal: dto.optimizationGoal ?? adSet.optimizationGoal,
        pageId: dto.pageId !== undefined ? (dto.pageId || null) : adSet.pageId,
        catalogRecordId: dto.catalogRecordId !== undefined ? (dto.catalogRecordId || null) : (adSet.catalogRecordId ?? null),
        productSetId: dto.productSetId !== undefined ? (dto.productSetId || null) : (adSet.productSetId ?? null),
        leadFormId: dto.leadFormId !== undefined ? (dto.leadFormId || null) : (adSet.leadFormId ?? null),
        conversionEvent: dto.conversionEvent !== undefined ? (dto.conversionEvent || null) : (adSet.conversionEvent ?? null),
      };
      const waErr = this.validateWhatsAppDestination(plan.objective, mergedWa);
      if (waErr) throw new BadRequestException(waErr);
      if (waTouched) {
        if (!mergedWa.destinationType) {
          data.destinationType = null;
          data.whatsappIntegrationId = null;
          data.whatsappPhoneNumberId = null;
          data.whatsappPhoneNumber = null;
        } else {
          const connectionChanged = mergedWa.whatsappIntegrationId !== (adSet.whatsappIntegrationId ?? null);
          const wasWebsite = (adSet.destinationType ?? null) !== "WHATSAPP";
          if (connectionChanged || wasWebsite) {
            const ref = await this.resolveWhatsAppRef(organizationId, mergedWa.whatsappIntegrationId!);
            data.whatsappPhoneNumberId = ref.phoneNumberId;
            data.whatsappPhoneNumber = ref.phoneNumber;
          }
          data.destinationType = "WHATSAPP";
          data.whatsappIntegrationId = mergedWa.whatsappIntegrationId;
        }
      }
    }
    if (dto.startTime !== undefined) data.startTime = dto.startTime ? new Date(dto.startTime) : null;
    if (dto.endTime !== undefined) data.endTime = dto.endTime ? new Date(dto.endTime) : null;
    const updated = await (this.prisma as any).campaignAdSet.update({ where: { id: adSetId }, data });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.adset_updated", entityType: "CampaignAdSet", entityId: adSetId, metadata: { fields: Object.keys(data) } }).catch(() => undefined);
    return this.adSetJson(updated);
  }

  // ---------- NB5 mini-fix: full-field copy helpers ----------
  /** NB5: the COMPLETE ad-set create-data for a copy.
   *  Every current CampaignAdSet field is carried —
   *  budgets, billing/optimization, page/pixel, CN1
   *  targeting, schedule + daypart, CN2 bidding, CN3
   *  conversion event + catalog pair, CN4 lead form.
   *  Money is normalized through BigInt(x) so BOTH
   *  sources work: getPlanFull rows (money already
   *  stringified) and direct Prisma rows (BigInt).
   *  Callers pass resolved/mapped values as overrides
   *  (e.g. clonePlanToAccount's cross-account mapping);
   *  an override key present with value undefined clears
   *  the field, exactly like the hand-written copies did.
   *  External ids / statuses are NEVER part of copy data:
   *  a copy is a fresh local draft. */
  private adSetCopyData(planId: string, src: any, overrides: Record<string, any> = {}): Record<string, any> {
    return {
      planId, name: src.name,
      dailyBudgetMinor: src.dailyBudgetMinor != null ? BigInt(src.dailyBudgetMinor) : undefined,
      lifetimeBudgetMinor: src.lifetimeBudgetMinor != null ? BigInt(src.lifetimeBudgetMinor) : undefined,
      billingEvent: src.billingEvent, optimizationGoal: src.optimizationGoal,
      pageId: src.pageId ?? undefined, pixelId: src.pixelId ?? undefined,
      targeting: src.targeting ?? {},
      startTime: src.startTime ?? undefined, endTime: src.endTime ?? undefined,
      daypart: src.daypart ?? undefined, daypartTz: src.daypartTz ?? undefined,
      bidStrategy: src.bidStrategy ?? undefined,
      bidAmountMinor: src.bidAmountMinor != null ? BigInt(src.bidAmountMinor) : undefined,
      costGoalMinor: src.costGoalMinor != null ? BigInt(src.costGoalMinor) : undefined,
      roasAverageFloor: src.roasAverageFloor ?? undefined,
      conversionEvent: src.conversionEvent ?? undefined,
      catalogRecordId: src.catalogRecordId ?? undefined,
      productSetId: src.productSetId ?? undefined,
      leadFormId: src.leadFormId ?? undefined,
      destinationType: src.destinationType ?? undefined,
      whatsappIntegrationId: src.whatsappIntegrationId ?? undefined,
      whatsappPhoneNumberId: src.whatsappPhoneNumberId ?? undefined,
      whatsappPhoneNumber: src.whatsappPhoneNumber ?? undefined,
      // CN16 (NB7): funnel layer tags ride every copy, so a
      // series instance or manual clone of a funnel plan
      // keeps its layer structure (and its incompleteness
      // reasons) visible.
      funnelLayer: src.funnelLayer ?? undefined,
      funnelIncomplete: src.funnelIncomplete ?? undefined,
      ...overrides,
    };
  }

  /** NB5: the COMPLETE ad create-data for a copy —
   *  every CampaignAd field, including the CN5 creative
   *  v2 Json fields (textOptions / placementAssets /
   *  creativeEnhancements) and createdByAi. External ad
   *  ids are never carried. */
  private adCopyData(adSetId: string, ad: any, overrides: Record<string, any> = {}): Record<string, any> {
    return {
      adSetId, name: ad.name, primaryText: ad.primaryText, headline: ad.headline ?? undefined,
      description: ad.description ?? undefined, linkUrl: ad.linkUrl, callToAction: ad.callToAction,
      imageUrl: ad.imageUrl ?? undefined, productId: ad.productId ?? undefined,
      format: ad.format ?? "link", imageAssetId: ad.imageAssetId ?? undefined,
      videoAssetId: ad.videoAssetId ?? undefined, carouselCards: ad.carouselCards ?? undefined,
      textOptions: (ad as any).textOptions ?? undefined,
      placementAssets: (ad as any).placementAssets ?? undefined,
      creativeEnhancements: (ad as any).creativeEnhancements ?? undefined,
      whatsappWelcome: (ad as any).whatsappWelcome ?? undefined,
      createdByAi: ad.createdByAi ?? false,
      ...overrides,
    };
  }

  /** CB1: duplicate one ad set WITH its ads (drafts only). */
  async duplicateAdSet(organizationId: string, planId: string, adSetId: string, actorId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    this.assertEditable(plan);
    const src = await (this.prisma as any).campaignAdSet.findFirst({ where: { id: adSetId, planId }, include: { ads: true } });
    if (!src) throw new NotFoundException("Ad set not found in this plan");
    const copy = await (this.prisma as any).campaignAdSet.create({
      data: this.adSetCopyData(planId, src, { name: `${src.name} (কপি)` }),
    });
    for (const ad of src.ads ?? []) {
      await (this.prisma as any).campaignAd.create({
        data: this.adCopyData(copy.id, ad),
      });
    }
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.adset_duplicated", entityType: "CampaignAdSet", entityId: copy.id, metadata: { sourceAdSetId: adSetId } }).catch(() => undefined);
    const full = await (this.prisma as any).campaignAdSet.findFirst({ where: { id: copy.id }, include: { ads: true } });
    // Money leaves the API as strings (BigInt is not
    // JSON-serializable — the M75 lesson).
    return this.adSetJson(full);
  }

  async deleteAdSet(organizationId: string, planId: string, adSetId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    this.assertEditable(plan);
    await (this.prisma as any).campaignAdSet.delete({ where: { id: adSetId } });
    return { deleted: true };
  }

  // ---------- Campaign Builder Next CN5: Creative v2 ----------

  /** Advantage creative feature keys this builder offers as
   *  toggles (Meta's Ad Creative Features Spec names, the
   *  standard-enhancements sub-features: single-image ads
   *  get image_templates / image_touchups, video adds
   *  video_auto_crop; text_optimizations + inline_comment
   *  apply to both). Any other key is REFUSED at save —
   *  an unmapped toggle never silently no-ops. */
  static readonly ENHANCEMENT_FEATURES = ["image_templates", "image_touchups", "text_optimizations", "inline_comment", "video_auto_crop"] as const;
  /** Placement groups for per-placement assets: Feed
   *  (FB feed + IG stream) and the vertical group
   *  (Stories + Reels share the 9:16 creative). */
  static readonly PLACEMENT_GROUPS = ["feed", "vertical"] as const;
  /** Option caps (Meta's dynamic-creative limits as
   *  enforced in Ads Manager: 5 primary texts, 5 headlines,
   *  2 descriptions). Over-cap input is refused at save. */
  static readonly TEXT_OPTION_CAPS = { primaryTexts: 5, headlines: 5, descriptions: 2 } as const;

  private cleanOptionList(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    for (const x of v) {
      const s = typeof x === "string" ? x.trim() : "";
      if (s && !out.includes(s)) out.push(s);
    }
    return out;
  }

  /** Normalize a textOptions input against the ad's legacy
   *  fields. INVARIANT: index 0 of each list IS the legacy
   *  column value — callers write the columns from here, so
   *  publish fallbacks, A/B, health and previews keep
   *  reading the first option byte-compatibly. Returns null
   *  when nothing option-like was supplied. */
  private normalizeTextOptions(input: { primaryTexts?: string[]; headlines?: string[]; descriptions?: string[] } | undefined, base: { primaryText?: string | null; headline?: string | null; description?: string | null }, explicit: { primaryText?: boolean; headline?: boolean; description?: boolean } = {}): { primaryTexts: string[]; headlines: string[]; descriptions: string[] } | null {
    if (!input || typeof input !== "object") return null;
    // Per list: an empty list inherits the legacy value; a
    // legacy value EXPLICITLY set in the same call leads
    // its list (the byte-compat rule); otherwise the
    // caller's list order stands (a wholesale replace).
    const lead = (list: string[], legacy: string | null | undefined, isExplicit: boolean | undefined): string[] => {
      const out = [...list];
      if (!out.length && legacy) out.push(legacy);
      if (isExplicit && legacy) return [legacy, ...out.filter((t) => t !== legacy)];
      return out;
    };
    const primaryTexts = lead(this.cleanOptionList(input.primaryTexts), base.primaryText, explicit.primaryText);
    const headlines = lead(this.cleanOptionList(input.headlines), base.headline, explicit.headline);
    const descriptions = lead(this.cleanOptionList(input.descriptions), base.description, explicit.description);
    const caps = CampaignsService.TEXT_OPTION_CAPS;
    if (primaryTexts.length > caps.primaryTexts) throw new BadRequestException(`At most ${caps.primaryTexts} primary text options (Meta's dynamic creative limit)`);
    if (headlines.length > caps.headlines) throw new BadRequestException(`At most ${caps.headlines} headline options`);
    if (descriptions.length > caps.descriptions) throw new BadRequestException(`At most ${caps.descriptions} description options`);
    if (!primaryTexts.length) return null;
    return { primaryTexts, headlines, descriptions };
  }

  /** PATCH re-sync: a legacy field edit on an ad that
   *  carries options replaces option index 0, keeping the
   *  remaining options — the invariant above survives
   *  ordinary edits. */
  private resyncTextOptions(existing: any, patch: { primaryText?: string; headline?: string | null; description?: string | null }): any {
    if (!existing || typeof existing !== "object") return existing ?? null;
    const out = {
      primaryTexts: [...(existing.primaryTexts ?? [])],
      headlines: [...(existing.headlines ?? [])],
      descriptions: [...(existing.descriptions ?? [])],
    };
    const set0 = (list: string[], v: string | null | undefined) => {
      if (v === undefined) return list;
      if (!v) return list.slice(1);
      if (!list.length) return [v];
      return [v, ...list.slice(1).filter((x) => x !== v)];
    };
    out.primaryTexts = set0(out.primaryTexts, patch.primaryText);
    out.headlines = set0(out.headlines, patch.headline);
    out.descriptions = set0(out.descriptions, patch.description);
    return out.primaryTexts.length ? out : null;
  }

  private textOptionsOf(ad: any): { primaryTexts: string[]; headlines: string[]; descriptions: string[] } | null {
    const o = ad?.textOptions;
    if (!o || typeof o !== "object" || !Array.isArray(o.primaryTexts) || !o.primaryTexts.length) return null;
    return {
      primaryTexts: o.primaryTexts,
      headlines: Array.isArray(o.headlines) ? o.headlines : [],
      descriptions: Array.isArray(o.descriptions) ? o.descriptions : [],
    };
  }

  private hasMultiText(ad: any): boolean {
    const o = this.textOptionsOf(ad);
    return !!o && (o.primaryTexts.length > 1 || o.headlines.length > 1 || o.descriptions.length > 1);
  }

  /** Placement asset overrides: groups feed | vertical;
   *  a link ad's override is an IMAGE (library asset or
   *  URL), a video ad's override is a VIDEO library asset.
   *  Anything else is refused at save with the reason. */
  private normalizePlacementAssets(input: Record<string, any> | undefined, format: string): Record<string, { imageAssetId?: string; videoAssetId?: string; imageUrl?: string }> | null {
    if (!input || typeof input !== "object") return null;
    const out: Record<string, any> = {};
    for (const [group, ref] of Object.entries(input)) {
      if (!(CampaignsService.PLACEMENT_GROUPS as readonly string[]).includes(group)) {
        throw new BadRequestException(`placementAssets group "${group}" is not supported (allowed: ${CampaignsService.PLACEMENT_GROUPS.join(", ")})`);
      }
      if (!ref || typeof ref !== "object" || (!ref.imageAssetId && !ref.videoAssetId && !ref.imageUrl)) {
        throw new BadRequestException(`placementAssets.${group} needs an imageAssetId, videoAssetId or imageUrl`);
      }
      if (format === "video") {
        if (!ref.videoAssetId || ref.imageAssetId || ref.imageUrl) throw new BadRequestException(`placementAssets.${group}: a video ad's placement override must be a videoAssetId from the creative library`);
        out[group] = { videoAssetId: ref.videoAssetId };
      } else if (format === "link") {
        if (ref.videoAssetId) throw new BadRequestException(`placementAssets.${group}: a link ad's placement override must be an image (imageAssetId or imageUrl), not a video`);
        out[group] = { ...(ref.imageAssetId ? { imageAssetId: ref.imageAssetId } : {}), ...(ref.imageUrl ? { imageUrl: ref.imageUrl } : {}) };
      } else {
        throw new BadRequestException(`placementAssets are not supported for format "${format}" — carousel cards carry their own images`);
      }
    }
    return Object.keys(out).length ? out : null;
  }

  private normalizeEnhancements(input: Record<string, boolean> | undefined): Record<string, boolean> | null {
    if (!input || typeof input !== "object") return null;
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(input)) {
      if (!(CampaignsService.ENHANCEMENT_FEATURES as readonly string[]).includes(k)) {
        throw new BadRequestException(`creativeEnhancements key "${k}" is not a Meta creative feature this builder can map (allowed: ${CampaignsService.ENHANCEMENT_FEATURES.join(", ")})`);
      }
      if (typeof v !== "boolean") throw new BadRequestException(`creativeEnhancements.${k} must be true or false`);
      out[k] = v;
    }
    return Object.keys(out).length ? out : null;
  }

  /** CN13: normalize an ad's WhatsApp welcome input to
   *  the stored shape (trimmed strings, ice breakers
   *  capped at Meta's documented 3). An all-empty input
   *  stores null — no welcome block is sent for it. */
  private normalizeWhatsAppWelcome(input?: { greetingText?: string; prefillMessage?: string; iceBreakers?: string[] } | null): { greetingText?: string; prefillMessage?: string; iceBreakers?: string[] } | null {
    if (!input) return null;
    const greetingText = typeof input.greetingText === "string" ? input.greetingText.trim().slice(0, 1024) : "";
    const prefillMessage = typeof input.prefillMessage === "string" ? input.prefillMessage.trim().slice(0, 1024) : "";
    const iceBreakers = Array.isArray(input.iceBreakers)
      ? input.iceBreakers.map((t) => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, 3)
      : [];
    if (!greetingText && !prefillMessage && !iceBreakers.length) return null;
    return {
      ...(greetingText ? { greetingText } : {}),
      ...(prefillMessage ? { prefillMessage } : {}),
      ...(iceBreakers.length ? { iceBreakers } : {}),
    };
  }

  async addAd(organizationId: string, planId: string, adSetId: string, dto: {
    name: string; primaryText: string; headline?: string; description?: string;
    linkUrl: string; callToAction?: string; imageUrl?: string; productId?: string; createdByAi?: boolean;
    format?: string; imageAssetId?: string; videoAssetId?: string;
    carouselCards?: { title: string; description?: string; linkUrl: string; imageUrl?: string; imageAssetId?: string }[];
    textOptions?: { primaryTexts?: string[]; headlines?: string[]; descriptions?: string[] };
    placementAssets?: Record<string, { imageAssetId?: string; videoAssetId?: string; imageUrl?: string }>;
    creativeEnhancements?: Record<string, boolean>;
    whatsappWelcome?: { greetingText?: string; prefillMessage?: string; iceBreakers?: string[] } | null;
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
    // CN5: normalize creative v2 inputs; the legacy columns
    // are written FROM option index 0 (byte-compat invariant).
    const textOptions = this.normalizeTextOptions(dto.textOptions, dto, { primaryText: true, headline: dto.headline !== undefined, description: dto.description !== undefined });
    const placementAssets = this.normalizePlacementAssets(dto.placementAssets, format);
    const creativeEnhancements = this.normalizeEnhancements(dto.creativeEnhancements);
    const ad = await (this.prisma as any).campaignAd.create({
      data: {
        adSetId, name: dto.name,
        primaryText: textOptions ? textOptions.primaryTexts[0] : dto.primaryText,
        headline: textOptions ? (textOptions.headlines[0] ?? null) : (dto.headline ?? null),
        description: textOptions ? (textOptions.descriptions[0] ?? null) : (dto.description ?? null),
        linkUrl: dto.linkUrl, callToAction: dto.callToAction ?? "SHOP_NOW",
        imageUrl: dto.imageUrl ?? null, productId: dto.productId ?? null, createdByAi: dto.createdByAi ?? false,
        format, imageAssetId: dto.imageAssetId ?? null, videoAssetId: dto.videoAssetId ?? null,
        carouselCards: dto.carouselCards ?? undefined,
        textOptions: textOptions ?? undefined,
        placementAssets: placementAssets ?? undefined,
        creativeEnhancements: creativeEnhancements ?? undefined,
        whatsappWelcome: this.normalizeWhatsAppWelcome(dto.whatsappWelcome) ?? undefined,
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

  /** CB1: edit an ad in place (draft plans only). The
   *  ad is resolved through its ad set so a foreign
   *  plan's ad can never be touched. Format rules
   *  mirror addAd and are checked against the MERGED
   *  result. */
  async updateAd(organizationId: string, planId: string, adId: string, actorId: string, dto: {
    name?: string; primaryText?: string; headline?: string; description?: string;
    linkUrl?: string; callToAction?: string; imageUrl?: string; productId?: string;
    format?: string; imageAssetId?: string; videoAssetId?: string;
    carouselCards?: { title: string; description?: string; linkUrl: string; imageUrl?: string; imageAssetId?: string }[];
    textOptions?: { primaryTexts?: string[]; headlines?: string[]; descriptions?: string[] } | null;
    placementAssets?: Record<string, { imageAssetId?: string; videoAssetId?: string; imageUrl?: string }> | null;
    creativeEnhancements?: Record<string, boolean> | null;
    whatsappWelcome?: { greetingText?: string; prefillMessage?: string; iceBreakers?: string[] } | null;
  }) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    this.assertEditable(plan);
    const ad = await (this.prisma as any).campaignAd.findFirst({ where: { id: adId, adSet: { planId } } });
    if (!ad) throw new NotFoundException("Ad not found in this plan");
    const merged = { ...ad, ...dto };
    const format = merged.format ?? "link";
    if (!["link", "video", "carousel"].includes(format)) throw new BadRequestException("format must be link, video or carousel");
    if (format === "video" && !merged.videoAssetId) throw new BadRequestException("A video ad needs a videoAssetId from the creative library");
    if (format === "carousel" && (!Array.isArray(merged.carouselCards) || merged.carouselCards.length < 2 || merged.carouselCards.length > 10)) {
      throw new BadRequestException("A carousel ad needs 2-10 cards");
    }
    const data: any = {};
    for (const key of ["name", "primaryText", "headline", "description", "linkUrl", "callToAction", "imageUrl", "productId", "format", "imageAssetId", "videoAssetId", "carouselCards"] as const) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }
    // CN5: creative v2 fields. An explicit textOptions
    // replaces the set wholesale and re-syncs the legacy
    // columns from index 0; null clears. Without it, a
    // legacy text edit re-syncs index 0 of the stored set.
    if (dto.textOptions !== undefined) {
      if (dto.textOptions === null) data.textOptions = null;
      else {
        const normalized = this.normalizeTextOptions(dto.textOptions, {
          primaryText: dto.primaryText ?? ad.primaryText,
          headline: dto.headline !== undefined ? dto.headline : ad.headline,
          description: dto.description !== undefined ? dto.description : ad.description,
        }, { primaryText: dto.primaryText !== undefined, headline: dto.headline !== undefined, description: dto.description !== undefined });
        data.textOptions = normalized;
        if (normalized) {
          data.primaryText = normalized.primaryTexts[0];
          data.headline = normalized.headlines[0] ?? null;
          data.description = normalized.descriptions[0] ?? null;
        }
      }
    } else if ((dto.primaryText !== undefined || dto.headline !== undefined || dto.description !== undefined) && (ad as any).textOptions) {
      data.textOptions = this.resyncTextOptions((ad as any).textOptions, {
        primaryText: dto.primaryText,
        headline: dto.headline,
        description: dto.description,
      });
    }
    if (dto.placementAssets !== undefined) {
      data.placementAssets = dto.placementAssets === null ? null : this.normalizePlacementAssets(dto.placementAssets, format);
    } else if (dto.format !== undefined && (ad as any).placementAssets) {
      // A format change re-validates the stored overrides
      // against the new format (refuses instead of stranding
      // an override the new format cannot carry).
      data.placementAssets = this.normalizePlacementAssets((ad as any).placementAssets, format);
    }
    if (dto.creativeEnhancements !== undefined) {
      data.creativeEnhancements = dto.creativeEnhancements === null ? null : this.normalizeEnhancements(dto.creativeEnhancements);
    }
    if (dto.whatsappWelcome !== undefined) {
      data.whatsappWelcome = dto.whatsappWelcome === null ? null : this.normalizeWhatsAppWelcome(dto.whatsappWelcome);
    }
    const updated = await (this.prisma as any).campaignAd.update({ where: { id: adId }, data });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.ad_updated", entityType: "CampaignAd", entityId: adId, metadata: { fields: Object.keys(data) } }).catch(() => undefined);
    return updated;
  }

  /** CB1: duplicate one ad inside its ad set. */
  async duplicateAd(organizationId: string, planId: string, adId: string, actorId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    this.assertEditable(plan);
    const src = await (this.prisma as any).campaignAd.findFirst({ where: { id: adId, adSet: { planId } } });
    if (!src) throw new NotFoundException("Ad not found in this plan");
    const copy = await (this.prisma as any).campaignAd.create({
      data: {
        adSetId: src.adSetId, name: `${src.name} (কপি)`, primaryText: src.primaryText, headline: src.headline ?? undefined,
        description: src.description ?? undefined, linkUrl: src.linkUrl, callToAction: src.callToAction,
        imageUrl: src.imageUrl ?? undefined, productId: src.productId ?? undefined,
        format: src.format ?? "link", imageAssetId: src.imageAssetId ?? undefined,
        videoAssetId: src.videoAssetId ?? undefined, carouselCards: src.carouselCards ?? undefined,
        // CN5: the copy keeps the creative v2 fields.
        textOptions: (src as any).textOptions ?? undefined,
        placementAssets: (src as any).placementAssets ?? undefined,
        creativeEnhancements: (src as any).creativeEnhancements ?? undefined,
        createdByAi: src.createdByAi ?? false,
      },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.ad_duplicated", entityType: "CampaignAd", entityId: copy.id, metadata: { sourceAdId: adId } }).catch(() => undefined);
    return copy;
  }

  /** CN5: duplicate an ad as a VARIANT carrying a chosen
   *  asset, without leaving the builder. Two asset worlds:
   *  (a) CreativeAsset (the creative library — already
   *  Meta-bound): image -> link format with imageAssetId,
   *  video -> video format with videoAssetId, the exact
   *  paths publish already resolves. (b) MediaAsset
   *  (Social library / Creative Studio uploads): an IMAGE
   *  becomes the variant's imageUrl through its public
   *  media URL (API_PUBLIC_URL + /public/media/<token> —
   *  refused when either is missing, because Meta must be
   *  able to fetch it); a VIDEO MediaAsset is REFUSED with
   *  the reason — Meta video ads need a Meta-side video id,
   *  which only the creative-library upload creates.
   *  Text options + enhancements carry over; placement
   *  overrides do NOT (they referenced the old media). */
  async createAdVariant(organizationId: string, planId: string, adId: string, actorId: string, dto: { creativeAssetId?: string; mediaAssetId?: string; name?: string }) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    this.assertEditable(plan);
    const src = await (this.prisma as any).campaignAd.findFirst({ where: { id: adId, adSet: { planId } } });
    if (!src) throw new NotFoundException("Ad not found in this plan");
    if (!!dto.creativeAssetId === !!dto.mediaAssetId) {
      throw new BadRequestException("Choose exactly one asset: creativeAssetId (creative library) or mediaAssetId (social/studio library)");
    }
    const base: any = {
      adSetId: src.adSetId, primaryText: src.primaryText, headline: src.headline ?? undefined,
      description: src.description ?? undefined, linkUrl: src.linkUrl, callToAction: src.callToAction,
      productId: src.productId ?? undefined, createdByAi: src.createdByAi ?? false,
      textOptions: (src as any).textOptions ?? undefined,
      creativeEnhancements: (src as any).creativeEnhancements ?? undefined,
    };
    let variant: any;
    if (dto.creativeAssetId) {
      const asset = await (this.prisma as any).creativeAsset.findFirst({ where: { id: dto.creativeAssetId, organizationId } });
      if (!asset) throw new NotFoundException("Creative asset not found in this organization");
      if (asset.kind === "image") {
        variant = await (this.prisma as any).campaignAd.create({ data: { ...base, name: dto.name ?? `${src.name} — Variant (${asset.name})`, format: "link", imageAssetId: asset.id, videoAssetId: null, imageUrl: null, carouselCards: undefined } });
      } else if (asset.kind === "video") {
        variant = await (this.prisma as any).campaignAd.create({ data: { ...base, name: dto.name ?? `${src.name} — Variant (${asset.name})`, format: "video", videoAssetId: asset.id, imageAssetId: null, imageUrl: null, carouselCards: undefined } });
      } else throw new BadRequestException(`Creative asset kind "${asset.kind}" cannot carry an ad variant`);
    } else {
      const asset = await (this.prisma as any).mediaAsset?.findFirst?.({ where: { id: dto.mediaAssetId, organizationId } }).catch(() => null);
      if (!asset) throw new NotFoundException("Media asset not found in this organization");
      if (asset.kind !== "image") {
        throw new BadRequestException("A video from the Social/Studio library cannot run as a Meta video ad directly — Meta needs a video uploaded through the Creative Library (which creates its Meta video id). Upload it there, then make the variant from the creative asset.");
      }
      if (!asset.publicToken) throw new BadRequestException("This media asset has no public link token — Meta could not fetch the image. Re-import it from the Social library so it carries a public URL.");
      // RB4/RM8 item 6: prefer the CDN URL when the public-media
      // helper can ensure one (object storage on; the bytes are
      // copied to the public bucket first). The token above stays
      // the gate — an asset the tenant never made public is never
      // exposed via the CDN either. Helper null (local mode, copy
      // failure) keeps the CN5 behaviour below exactly.
      let imageUrl: string | null = null;
      if (this.publicMedia && asset.storageKey) {
        imageUrl = await this.publicMedia
          .resolvePublicMediaUrl(
            {
              organizationId,
              storageKey: asset.storageKey,
              contentType: asset.contentType,
              sizeBytes: asset.sizeBytes,
              createdById: asset.createdById ?? null,
            },
            "social",
          )
          .catch(() => null);
      }
      if (!imageUrl) {
        const apiBase = process.env.API_PUBLIC_URL?.replace(/\/$/, "");
        if (!apiBase) throw new BadRequestException("API_PUBLIC_URL is not configured on this deployment — Meta could not fetch the media image, so the variant was not created");
        imageUrl = `${apiBase}/public/media/${asset.publicToken}`;
      }
      variant = await (this.prisma as any).campaignAd.create({ data: { ...base, name: dto.name ?? `${src.name} — Variant (${asset.name})`, format: "link", imageUrl, imageAssetId: null, videoAssetId: null, carouselCards: undefined } });
    }
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.ad_variant_created", entityType: "CampaignAd", entityId: variant.id, metadata: { sourceAdId: adId, creativeAssetId: dto.creativeAssetId ?? null, mediaAssetId: dto.mediaAssetId ?? null } }).catch(() => undefined);
    return variant;
  }

  // ---------- Validation + approval workflow ----------
  validatePlan(fullPlan: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!fullPlan.adSets?.length) errors.push("At least one ad set is required");
    if (fullPlan.advantagePlus && fullPlan.objective !== "OUTCOME_SALES") {
      errors.push("Advantage+ is a Sales format: the plan objective must be OUTCOME_SALES");
    }
    // CN2: a CBO plan must carry its budget at campaign
    // level (Advantage+ keeps its first-ad-set fallback).
    const cbo = this.isCbo(fullPlan);
    const cb = this.campaignBudgets(fullPlan);
    if (cbo && cb.dailyMinor == null && cb.lifetimeMinor == null) {
      errors.push("Campaign budget (CBO) needs a campaign daily or lifetime budget on the plan");
    }
    if (cb.dailyMinor != null && cb.dailyMinor <= 0n) errors.push("Campaign daily budget must be positive");
    if (cb.lifetimeMinor != null && cb.lifetimeMinor <= 0n) errors.push("Campaign lifetime budget must be positive");
    for (const adSet of fullPlan.adSets ?? []) {
      if (!cbo && !adSet.dailyBudgetMinor && !adSet.lifetimeBudgetMinor) errors.push(`Ad set "${adSet.name}": budget missing`);
      if (adSet.dailyBudgetMinor && BigInt(adSet.dailyBudgetMinor) <= 0n) errors.push(`Ad set "${adSet.name}": budget must be positive`);
      // CN2: the bid support matrix is re-checked here so
      // a stored row can never reach publish out-of-matrix.
      const bidError = this.validateBid(fullPlan.objective, adSet);
      if (bidError) errors.push(`Ad set "${adSet.name}": ${bidError}`);
      const countries = (adSet.targeting as any)?.countries ?? [];
      if (!countries.length) errors.push(`Ad set "${adSet.name}": no target countries`);
      if (!adSet.pageId) errors.push(`Ad set "${adSet.name}": Facebook Page ID is required to run ads`);
      // CN3: a catalog ad set optimizes on its product set
      // (Meta uses the catalog's connected pixel), so the
      // pixel requirement below does not apply to it.
      const isCatalogSet = !!(adSet.catalogRecordId && adSet.productSetId);
      if (adSet.optimizationGoal === "OFFSITE_CONVERSIONS" && !adSet.pixelId && !isCatalogSet) errors.push(`Ad set "${adSet.name}": a Pixel ID is required for OFFSITE_CONVERSIONS`);
      if (adSet.optimizationGoal === "VALUE" && !adSet.pixelId && !isCatalogSet) errors.push(`Ad set "${adSet.name}": a Pixel ID is required for VALUE`);
      if (adSet.optimizationGoal === "LEAD_GENERATION" && !adSet.pageId) errors.push(`Ad set "${adSet.name}": a Page ID is required for lead ads`);
      // CN3: the conversion-event matrix is re-checked here
      // too, so a stored row can never reach publish
      // out-of-matrix (the validateBid discipline).
      const eventError = this.validateConversionEvent(fullPlan.objective, adSet);
      if (eventError) errors.push(`Ad set "${adSet.name}": ${eventError}`);
      // CN3: catalog ad sets — structure against the records
      // getPlanFull resolved (__catalog / __productSet).
      if (adSet.catalogRecordId || adSet.productSetId) {
        if (!adSet.catalogRecordId || !adSet.productSetId) errors.push(`Ad set "${adSet.name}": catalog ads need BOTH a catalog and a product set`);
        if (fullPlan.objective !== "OUTCOME_SALES") errors.push(`Ad set "${adSet.name}": catalog ads are a Sales structure — the plan objective is ${fullPlan.objective}`);
        if (!["OFFSITE_CONVERSIONS", "VALUE"].includes(adSet.optimizationGoal)) errors.push(`Ad set "${adSet.name}": catalog ads optimize on conversions (OFFSITE_CONVERSIONS or VALUE) — not ${adSet.optimizationGoal}`);
        if (adSet.conversionEvent) errors.push(`Ad set "${adSet.name}": a catalog ad set optimizes on its product set — conversionEvent is not sent for catalog ads; clear it`);
        if (adSet.catalogRecordId && !(adSet as any).__catalog) errors.push(`Ad set "${adSet.name}": the chosen catalog no longer exists in this organization`);
        const set = (adSet as any).__productSet;
        if (adSet.productSetId) {
          if (!set) errors.push(`Ad set "${adSet.name}": the chosen product set no longer exists in this organization`);
          else {
            if (set.catalogRecordId !== adSet.catalogRecordId) errors.push(`Ad set "${adSet.name}": the product set belongs to a different catalog`);
            if (!set.externalSetId || set.status !== "created") errors.push(`Ad set "${adSet.name}": product set "${set.name}" is not created on Meta yet (status: ${set.status}) — publish it from the Catalogs page first`);
          }
        }
        for (const ad of adSet.ads ?? []) {
          if ((ad.format ?? "link") !== "link") errors.push(`Ad "${ad.name}": catalog ads use the dynamic product template (format "link") — not "${ad.format}"`);
        }
      }
      // CN4: lead form ad sets — the form is judged on its
      // real record (__leadForm from getPlanFull).
      if (adSet.leadFormId) {
        if (adSet.optimizationGoal !== "LEAD_GENERATION") errors.push(`Ad set "${adSet.name}": a lead form belongs on a LEAD_GENERATION ad set — not ${adSet.optimizationGoal}`);
        const form = (adSet as any).__leadForm;
        if (!form) errors.push(`Ad set "${adSet.name}": the attached lead form no longer exists in this organization`);
        else {
          if (adSet.pageId && form.pageId !== adSet.pageId) errors.push(`Ad set "${adSet.name}": lead form "${form.name}" belongs to Page ${form.pageId}, not this ad set's Page ${adSet.pageId}`);
          if (!form.privacyPolicyUrl) errors.push(`Ad set "${adSet.name}": lead form "${form.name}" has no Privacy Policy URL — Meta will not run a lead form without one`);
          if (!Array.isArray(form.questions) || form.questions.length === 0) errors.push(`Ad set "${adSet.name}": lead form "${form.name}" has no questions`);
          for (const ad of adSet.ads ?? []) {
            if (!(CampaignsService.LEAD_FORM_CTAS as readonly string[]).includes(ad.callToAction ?? "SHOP_NOW")) {
              errors.push(`Ad "${ad.name}": with a lead form attached the call-to-action must be one of ${CampaignsService.LEAD_FORM_CTAS.join(", ")} — not ${ad.callToAction}`);
            }
            if ((ad.format ?? "link") !== "link") errors.push(`Ad "${ad.name}": lead form ads use the link creative format in this builder — not "${ad.format}"`);
          }
        }
      }
      // CN13: WhatsApp destination ad sets — the pure
      // matrix re-checked against the stored row (the
      // connection's live state is readiness' job; publish
      // re-resolves nothing silently).
      if (adSet.destinationType || adSet.whatsappIntegrationId) {
        const waError = this.validateWhatsAppDestination(fullPlan.objective, adSet);
        if (waError) errors.push(`Ad set "${adSet.name}": ${waError}`);
        if (adSet.destinationType === "WHATSAPP") {
          for (const ad of adSet.ads ?? []) {
            if ((ad.format ?? "link") !== "link") errors.push(`Ad "${ad.name}": Click-to-WhatsApp ads use the link creative in this builder (the documented CTWA link_data shape) — not "${ad.format}"`);
          }
        }
      }
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

  /** Canonical JSON for snapshot comparison: Postgres
   *  JSONB reorders keys, so raw stringify would report
   *  a false difference (live-caught at CB4). */
  private stableStringify(value: any): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
    if (Array.isArray(value)) return `[${value.map((v) => this.stableStringify(v)).join(",")}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${this.stableStringify(value[k])}`).join(",")}}`;
  }

  /** CB4: the normalized, comparable definition of a
   *  plan — frozen at submit, re-compared at publish. */
  private definitionOf(full: any) {
    return {
      name: full.name, objective: full.objective, adAccountId: full.adAccountId,
      advantagePlus: full.advantagePlus === true,
      dailyBudgetCapMinor: full.dailyBudgetCapMinor?.toString() ?? null,
      // CN2: the budget structure and bidding are part of
      // what was approved — they freeze in the snapshot too.
      budgetMode: full.budgetMode ?? "abo",
      campaignDailyBudgetMinor: full.campaignDailyBudgetMinor?.toString() ?? null,
      campaignLifetimeBudgetMinor: full.campaignLifetimeBudgetMinor?.toString() ?? null,
      adSets: (full.adSets ?? []).map((s: any) => ({
        name: s.name, dailyBudgetMinor: s.dailyBudgetMinor?.toString() ?? null,
        lifetimeBudgetMinor: s.lifetimeBudgetMinor?.toString() ?? null,
        optimizationGoal: s.optimizationGoal, pageId: s.pageId ?? null, pixelId: s.pixelId ?? null,
        bidStrategy: s.bidStrategy ?? null,
        bidAmountMinor: s.bidAmountMinor?.toString() ?? null,
        costGoalMinor: s.costGoalMinor?.toString() ?? null,
        roasAverageFloor: s.roasAverageFloor ?? null,
        // NB2 (CN3/CN4): the conversion event, catalog pair
        // and lead form are part of what was approved too.
        conversionEvent: s.conversionEvent ?? null,
        catalogRecordId: s.catalogRecordId ?? null,
        productSetId: s.productSetId ?? null,
        leadFormId: s.leadFormId ?? null,
        // CN13 (NB6): the WhatsApp destination is part of
        // what was approved — it freezes in the snapshot.
        destinationType: s.destinationType ?? null,
        whatsappIntegrationId: s.whatsappIntegrationId ?? null,
        whatsappPhoneNumberId: s.whatsappPhoneNumberId ?? null,
        whatsappPhoneNumber: s.whatsappPhoneNumber ?? null,
        targeting: s.targeting ?? {},
        ads: (s.ads ?? []).map((a: any) => ({
          name: a.name, primaryText: a.primaryText, headline: a.headline ?? null,
          description: a.description ?? null, linkUrl: a.linkUrl, callToAction: a.callToAction,
          format: a.format ?? "link", imageAssetId: a.imageAssetId ?? null,
          videoAssetId: a.videoAssetId ?? null, imageUrl: a.imageUrl ?? null,
          carouselCards: a.carouselCards ?? null,
          // NB3 (CN5): creative v2 is part of what was
          // approved — options, placement overrides and
          // enhancement toggles freeze in the snapshot too.
          textOptions: a.textOptions ?? null,
          placementAssets: a.placementAssets ?? null,
          creativeEnhancements: a.creativeEnhancements ?? null,
          whatsappWelcome: a.whatsappWelcome ?? null,
        })),
      })),
    };
  }

  /** CB4: in-app notifications on the platform's
   *  existing rail. Best-effort and defensive — a
   *  notification failure never blocks the workflow. */
  private async notifyUsers(organizationId: string, userIds: string[], type: string, title: string, body: string) {
    const table = (this.prisma as any).agentNotification;
    if (!table?.create) return;
    for (const userId of [...new Set(userIds)]) {
      await table.create({ data: { organizationId, userId, type, title: title.slice(0, 120), body: body.slice(0, 500) } }).catch(() => undefined);
    }
  }

  private async approverIds(organizationId: string, exceptUserId: string) {
    const table = (this.prisma as any).membership;
    if (!table?.findMany) return [];
    const rows = await table.findMany({ where: { organizationId, status: "ACTIVE" } }).catch(() => []);
    return (rows as any[]).filter((m) => ["OWNER", "ADMIN"].includes(m.role) && m.userId !== exceptUserId).map((m) => m.userId);
  }

  async submitForApproval(organizationId: string, actorId: string, planId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    if (!EDITABLE.includes(plan.status)) throw new BadRequestException(`Plan in status "${plan.status}" cannot be submitted`);
    const full = await this.getPlanFull(organizationId, planId);
    const { valid, errors } = this.validatePlan(full);
    if (!valid) throw new BadRequestException(`Plan is not ready for approval: ${errors.join("; ")}`);
    this.assertWithinCap(full);
    // CB4: freeze exactly what is being approved.
    const snapshot = this.definitionOf(full);
    // CN11: a fresh submission restarts the two-step
    // chain — any earlier first approval is cleared.
    await (this.prisma as any).campaignPlan.update({ where: { id: planId }, data: { status: "pending_approval", rejectionReason: null, submissionSnapshot: snapshot, firstApproverId: null, firstApprovedAt: null } });
    // CN11: the submission is also kept as an immutable
    // plan version (diffable / restorable later). Guarded
    // so older spec fakes without the table never break.
    const versionTable = (this.prisma as any).campaignPlanVersion;
    if (versionTable?.create) {
      await versionTable.create({ data: { organizationId, planId, kind: "submit", definition: snapshot, createdById: actorId } }).catch(() => undefined);
    }
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.submitted", entityType: "CampaignPlan", entityId: planId });
    await this.notifyUsers(organizationId, await this.approverIds(organizationId, actorId), "campaign_approval", "📢 অনুমোদনের অপেক্ষায় নতুন Campaign", `"${plan.name}" অনুমোদনের জন্য জমা হয়েছে — Campaign Builder এ যাচাই করুন।`);
    return this.getPlanFull(organizationId, planId);
  }

  /** CB4: what was submitted vs what the plan is now. */
  async submissionDiff(organizationId: string, planId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    const full = await this.getPlanFull(organizationId, planId);
    const snapshot = (plan as any).submissionSnapshot ?? null;
    const current = this.definitionOf(full);
    return { snapshot, current, differs: snapshot ? this.stableStringify(snapshot) !== this.stableStringify(current) : null };
  }

  // ---------- CN11: @mentions in plan comments ----------
  /** Mention candidates: ACTIVE org members with a
   *  display name, longest name first (so "@Alex Amin"
   *  wins over "@Alex" when both are members). */
  private async mentionCandidates(organizationId: string): Promise<{ userId: string; name: string }[]> {
    const memTable = (this.prisma as any).membership;
    const userTable = (this.prisma as any).user;
    if (!memTable?.findMany || !userTable?.findMany) return [];
    const members = await memTable.findMany({ where: { organizationId, status: "ACTIVE" } }).catch(() => []);
    const ids = [...new Set((members as any[]).map((m) => m.userId).filter(Boolean))];
    if (!ids.length) return [];
    const users = await userTable.findMany({ where: { id: { in: ids } } }).catch(() => []);
    return (users as any[])
      .filter((u) => u.name && String(u.name).trim())
      .map((u) => ({ userId: u.id, name: String(u.name).trim() }))
      .sort((a, b) => b.name.length - a.name.length);
  }

  /** Pure mention extraction: an @Name token resolves
   *  only when it matches a candidate's full name
   *  (case-insensitive, name-boundary after it). Unknown
   *  @tokens stay plain text — never an error. The
   *  excepted user (the comment's author) never resolves
   *  as their own mention. */
  private mentionsIn(text: string, candidates: { userId: string; name: string }[], exceptUserId?: string): { userId: string; name: string }[] {
    if (!text?.includes("@")) return [];
    const found: { userId: string; name: string; at: number }[] = [];
    // Longest names consume their span first: "@Alex
    // Amin" is ONE mention of Alex Amin — the shorter
    // member "Alex" must not also match its prefix. The
    // excepted author's own name still consumes its span
    // (it is a mention of the author, just not notified
    // or returned), so it cannot leak to a shorter name.
    let masked = text;
    const longestFirst = [...candidates].sort((a, b) => b.name.length - a.name.length);
    for (const cand of longestFirst) {
      const esc = cand.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const m = new RegExp(`@${esc}(?![\\p{L}\\p{N}_-])`, "iu").exec(masked);
      if (!m) continue;
      masked = masked.slice(0, m.index) + " ".repeat(m[0].length) + masked.slice(m.index + m[0].length);
      if (exceptUserId && cand.userId === exceptUserId) continue;
      found.push({ userId: cand.userId, name: cand.name, at: m.index });
    }
    return found.sort((a, b) => a.at - b.at).map(({ userId, name }) => ({ userId, name }));
  }

  private async resolveMentions(organizationId: string, text: string, exceptUserId?: string): Promise<{ userId: string; name: string }[]> {
    if (!text?.includes("@")) return [];
    return this.mentionsIn(text, await this.mentionCandidates(organizationId), exceptUserId);
  }

  /** CB4: plan comments (the approval conversation).
   *  CN11: each row also carries its resolved `mentions`. */
  async listComments(organizationId: string, planId: string) {
    await this.getPlanOrThrow(organizationId, planId);
    const table = (this.prisma as any).campaignPlanComment;
    if (!table?.findMany) return [];
    const rows = await table.findMany({ where: { planId, organizationId }, orderBy: { createdAt: "asc" }, take: 200 });
    const userIds = [...new Set((rows as any[]).map((r) => r.authorId))];
    const users = userIds.length && (this.prisma as any).user?.findMany
      ? await (this.prisma as any).user.findMany({ where: { id: { in: userIds } } }).catch(() => [])
      : [];
    const nameOf = new Map((users as any[]).map((u) => [u.id, u.name ?? u.email ?? u.id]));
    const candidates = await this.mentionCandidates(organizationId);
    return (rows as any[]).map((r) => ({
      ...r, authorName: nameOf.get(r.authorId) ?? r.authorId,
      mentions: this.mentionsIn(String(r.body ?? ""), candidates, r.authorId),
    }));
  }

  async addComment(organizationId: string, planId: string, authorId: string, body: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    const text = String(body ?? "").trim();
    if (!text) throw new BadRequestException("Comment cannot be empty");
    const row = await (this.prisma as any).campaignPlanComment.create({
      data: { organizationId, planId, authorId, body: text.slice(0, 2000) },
    });
    await this.audit.log({ organizationId, userId: authorId, action: "campaign.comment", entityType: "CampaignPlan", entityId: planId }).catch(() => undefined);
    // CN11: resolved @mentions are notified (best-effort,
    // the CB4 defensive style) and returned on the row.
    const mentions = await this.resolveMentions(organizationId, row.body, authorId);
    if (mentions.length) {
      await this.notifyUsers(organizationId, mentions.map((m) => m.userId), "campaign_mention",
        "💬 Campaign মন্তব্যে আপনাকে Mention করা হয়েছে",
        `"${plan.name}" প্ল্যানের মন্তব্যে আপনাকে Mention করা হয়েছে: ${String(row.body).slice(0, 200)}`);
    }
    return { ...row, mentions };
  }

  /** CB4: one activity feed — comments + audit +
   *  publish evidence, merged compute-on-read. */
  async planTimeline(organizationId: string, planId: string) {
    await this.getPlanOrThrow(organizationId, planId);
    const entries: { at: string; kind: string; title: string; detail?: string; actorId?: string }[] = [];
    const comments = await (this.prisma as any).campaignPlanComment?.findMany?.({ where: { planId, organizationId }, take: 100 })?.catch?.(() => []) ?? [];
    for (const c of comments as any[]) entries.push({ at: new Date(c.createdAt).toISOString(), kind: "comment", title: "💬 মন্তব্য", detail: String(c.body).slice(0, 200), actorId: c.authorId });
    const audits = await (this.prisma as any).auditLog?.findMany?.({ where: { organizationId, entityType: "CampaignPlan", entityId: planId }, take: 100 })?.catch?.(() => []) ?? [];
    for (const a of audits as any[]) entries.push({ at: new Date(a.createdAt).toISOString(), kind: "audit", title: String(a.action), actorId: a.userId ?? undefined });
    const logs = await (this.prisma as any).campaignPublishLog?.findMany?.({ where: { planId }, take: 100 })?.catch?.(() => []) ?? [];
    for (const l of logs as any[]) entries.push({ at: new Date(l.createdAt).toISOString(), kind: "publish", title: `Publish: ${l.step} ${l.status}`, detail: l.error ?? l.externalId ?? undefined, actorId: l.actorId ?? undefined });
    return entries.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100);
  }

  // ---------- CN11: plan versions ----------
  private async getVersionOrThrow(organizationId: string, planId: string, versionId: string) {
    const table = (this.prisma as any).campaignPlanVersion;
    const row = table?.findFirst ? await table.findFirst({ where: { id: versionId, planId, organizationId } }).catch(() => null) : null;
    if (!row) throw new NotFoundException("Plan version not found in this organization");
    return row;
  }

  /** CN11: a manual snapshot of the plan's CURRENT
   *  definition (kind "manual"). submitForApproval writes
   *  the "submit" kind automatically. */
  async createVersionSnapshot(organizationId: string, actorId: string, planId: string) {
    await this.getPlanOrThrow(organizationId, planId);
    const table = (this.prisma as any).campaignPlanVersion;
    if (!table?.create) throw new BadRequestException("Plan versions are not available in this context (CampaignPlanVersion table missing)");
    const full = await this.getPlanFull(organizationId, planId);
    const row = await table.create({
      data: { organizationId, planId, kind: "manual", definition: this.definitionOf(full), createdById: actorId },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.version_snapshot", entityType: "CampaignPlan", entityId: planId, metadata: { versionId: row.id } }).catch(() => undefined);
    return row;
  }

  /** CN11: version history — metadata + the frozen
   *  definition itself, newest first. */
  async listVersions(organizationId: string, planId: string) {
    await this.getPlanOrThrow(organizationId, planId);
    const table = (this.prisma as any).campaignPlanVersion;
    if (!table?.findMany) return [];
    const rows = await table.findMany({ where: { planId, organizationId }, orderBy: { createdAt: "desc" }, take: 200 }).catch(() => []);
    return [...(rows as any[])].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /** CN11: structural diff of a frozen definition vs a
   *  current one. Ad sets match by NAME, ads by name
   *  within their set; a node counts as changed when its
   *  stableStringify differs. Ads of an added/removed ad
   *  set count as added/removed ads. (Names are the
   *  builder's identity for these nodes — a rename reads
   *  as remove + add.) */
  private diffDefinitions(versionDef: any, currentDef: any) {
    const topKeys = ["name", "objective", "adAccountId", "advantagePlus", "dailyBudgetCapMinor", "budgetMode", "campaignDailyBudgetMinor", "campaignLifetimeBudgetMinor"];
    const topLevelChanged = topKeys.filter((k) => this.stableStringify(versionDef?.[k] ?? null) !== this.stableStringify(currentDef?.[k] ?? null));
    const vSets: any[] = versionDef?.adSets ?? [];
    const cSets: any[] = currentDef?.adSets ?? [];
    const vByName = new Map<string, any>(vSets.map((s) => [s.name, s]));
    const cByName = new Map<string, any>(cSets.map((s) => [s.name, s]));
    let adSetsAdded = 0, adSetsRemoved = 0, adSetsChanged = 0, adsAdded = 0, adsRemoved = 0, adsChanged = 0;
    for (const cs of cSets) {
      const vs = vByName.get(cs.name);
      if (!vs) { adSetsAdded++; adsAdded += (cs.ads ?? []).length; continue; }
      if (this.stableStringify(vs) !== this.stableStringify(cs)) adSetsChanged++;
      const vAds = new Map<string, any>((vs.ads ?? []).map((a: any) => [a.name, a]));
      const cNames = new Set((cs.ads ?? []).map((a: any) => a.name));
      for (const ca of cs.ads ?? []) {
        const va = vAds.get(ca.name);
        if (!va) adsAdded++;
        else if (this.stableStringify(va) !== this.stableStringify(ca)) adsChanged++;
      }
      for (const va of vs.ads ?? []) if (!cNames.has(va.name)) adsRemoved++;
    }
    for (const vs of vSets) if (!cByName.has(vs.name)) { adSetsRemoved++; adsRemoved += (vs.ads ?? []).length; }
    const summary = { topLevelChanged, adSetsAdded, adSetsRemoved, adSetsChanged, adsAdded, adsRemoved, adsChanged };
    const differs = topLevelChanged.length > 0 || adSetsAdded + adSetsRemoved + adSetsChanged + adsAdded + adsRemoved + adsChanged > 0;
    return { differs, summary };
  }

  async diffVersion(organizationId: string, planId: string, versionId: string) {
    await this.getPlanOrThrow(organizationId, planId);
    const version = await this.getVersionOrThrow(organizationId, planId, versionId);
    const current = this.definitionOf(await this.getPlanFull(organizationId, planId));
    return this.diffDefinitions(version.definition, current);
  }

  /** CN11: restore a version into a NEW draft plan. The
   *  source plan is never updated — restoring a version
   *  OF a plan creates its sibling draft, whatever state
   *  the source is in. The definition snapshot is the
   *  restore source (via the NB5 copy helpers); fields
   *  definitionOf never froze (billingEvent, schedule,
   *  daypart) come back at their schema defaults. */
  async restoreVersion(organizationId: string, actorId: string, planId: string, versionId: string) {
    const source = await this.getPlanOrThrow(organizationId, planId);
    const version = await this.getVersionOrThrow(organizationId, planId, versionId);
    const def = version.definition;
    if (!def || typeof def !== "object" || !Array.isArray(def.adSets)) {
      throw new BadRequestException("This version does not carry a restorable plan definition");
    }
    const p = this.prisma as any;
    const restored = await p.campaignPlan.create({
      data: {
        organizationId, adAccountId: def.adAccountId,
        name: `${source.name} (সংস্করণ থেকে পুনরুদ্ধার)`,
        objective: def.objective, status: "draft", isTemplate: false, createdById: actorId,
        advantagePlus: def.advantagePlus === true,
        budgetMode: def.budgetMode ?? "abo",
        campaignDailyBudgetMinor: def.campaignDailyBudgetMinor != null ? BigInt(def.campaignDailyBudgetMinor) : undefined,
        campaignLifetimeBudgetMinor: def.campaignLifetimeBudgetMinor != null ? BigInt(def.campaignLifetimeBudgetMinor) : undefined,
        dailyBudgetCapMinor: def.dailyBudgetCapMinor != null ? BigInt(def.dailyBudgetCapMinor) : undefined,
      },
    });
    for (const s of def.adSets) {
      const newSet = await p.campaignAdSet.create({
        data: this.adSetCopyData(restored.id, { billingEvent: "IMPRESSIONS", ...s }),
      });
      for (const ad of s.ads ?? []) {
        await p.campaignAd.create({ data: this.adCopyData(newSet.id, ad) });
      }
    }
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.version_restored", entityType: "CampaignPlan", entityId: restored.id, metadata: { sourcePlanId: planId, versionId, versionKind: version.kind } }).catch(() => undefined);
    return this.getPlanFull(organizationId, restored.id);
  }

  // ---------- CN11: two-step approval chain ----------
  /** The org's approval-chain setting. An absent row
   *  (or a missing table, in older spec fakes) is the
   *  default: two-step OFF, single approval as before. */
  async getApprovalChainSetting(organizationId: string) {
    const table = (this.prisma as any).campaignApprovalSetting;
    if (!table?.findFirst) return { twoStepApproval: false };
    const row = await table.findFirst({ where: { organizationId } }).catch(() => null);
    return { twoStepApproval: row?.twoStepApproval === true };
  }

  async setApprovalChainSetting(organizationId: string, actorId: string, dto: { twoStepApproval: boolean }) {
    const table = (this.prisma as any).campaignApprovalSetting;
    if (!table?.create || !table?.findFirst) throw new BadRequestException("Approval settings are not available in this context (CampaignApprovalSetting table missing)");
    const twoStepApproval = dto?.twoStepApproval === true;
    const existing = await table.findFirst({ where: { organizationId } }).catch(() => null);
    if (existing) await table.update({ where: { id: existing.id }, data: { twoStepApproval } });
    else await table.create({ data: { organizationId, twoStepApproval } });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.approval_chain_updated", entityType: "CampaignApprovalSetting", entityId: organizationId, metadata: { twoStepApproval } }).catch(() => undefined);
    return { twoStepApproval };
  }

  // ---------- CN11: last recorded activity ----------
  /**
   * The plan's LAST RECORDED ACTIVITY: the newest audit
   * row for this plan. This is an audit trail read, NOT
   * realtime presence — it says who last DID something
   * recorded, never who is online or viewing right now.
   */
  async planLastActivity(organizationId: string, planId: string) {
    await this.getPlanOrThrow(organizationId, planId);
    const table = (this.prisma as any).auditLog;
    if (!table?.findMany && !table?.findFirst) return { available: false };
    let row: any = null;
    if (table.findMany) {
      const rows = await table.findMany({ where: { organizationId, entityType: "CampaignPlan", entityId: planId }, take: 200 }).catch(() => []);
      row = [...(rows as any[])].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;
    }
    if (!row && table.findFirst) {
      row = await table.findFirst({ where: { organizationId, entityType: "CampaignPlan", entityId: planId }, orderBy: { createdAt: "desc" } }).catch(() => null);
    }
    if (!row) return { available: false };
    let actorName: string | null = row.userId ?? null;
    if (row.userId && (this.prisma as any).user?.findMany) {
      const users = await (this.prisma as any).user.findMany({ where: { id: { in: [row.userId] } } }).catch(() => []);
      if (users?.[0]) actorName = users[0].name ?? users[0].email ?? row.userId;
    }
    return { available: true, actorId: row.userId ?? null, actorName, action: row.action, at: row.createdAt };
  }

  // ---------- CN11: hub saved views ----------
  /** A user's own saved hub views (name + the opaque
   *  filter-state Json), newest first. */
  async listSavedViews(organizationId: string, userId: string) {
    const table = (this.prisma as any).campaignSavedView;
    if (!table?.findMany) return [];
    const rows = await table.findMany({ where: { organizationId, userId }, orderBy: { updatedAt: "desc" }, take: 100 }).catch(() => []);
    return [...(rows as any[])].sort((a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime());
  }

  async createSavedView(organizationId: string, userId: string, dto: { name: string; filters: Record<string, unknown> }) {
    const name = String(dto?.name ?? "").trim().slice(0, 200);
    if (!name) throw new BadRequestException("Saved view needs a name — একটি নাম দিন");
    if (!dto?.filters || typeof dto.filters !== "object" || Array.isArray(dto.filters)) {
      throw new BadRequestException("Saved view filters must be an object (the hub's filter state)");
    }
    if (JSON.stringify(dto.filters).length > 10000) throw new BadRequestException("Saved view filters are too large (max 10000 characters of JSON)");
    const table = (this.prisma as any).campaignSavedView;
    if (!table?.create) throw new BadRequestException("Saved views are not available in this context (CampaignSavedView table missing)");
    const row = await table.create({ data: { organizationId, userId, name, filters: dto.filters } });
    await this.audit.log({ organizationId, userId, action: "campaign.saved_view_created", entityType: "CampaignSavedView", entityId: row.id }).catch(() => undefined);
    return row;
  }

  /** Deleting is scoped to the OWNER of the view: asking
   *  for another user's view id is a 404, not a delete. */
  async deleteSavedView(organizationId: string, userId: string, viewId: string) {
    const table = (this.prisma as any).campaignSavedView;
    const row = table?.findFirst ? await table.findFirst({ where: { id: viewId, organizationId, userId } }).catch(() => null) : null;
    if (!row) throw new NotFoundException("Saved view not found");
    await table.delete({ where: { id: viewId } });
    await this.audit.log({ organizationId, userId, action: "campaign.saved_view_deleted", entityType: "CampaignSavedView", entityId: viewId }).catch(() => undefined);
    return { deleted: true };
  }

  async approve(organizationId: string, actorId: string, planId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    if (plan.status !== "pending_approval") throw new BadRequestException(`Only pending_approval plans can be approved (current: ${plan.status})`);
    // CN11: two-step chain. Setting OFF = the exact
    // pre-CN11 single-approval path below, untouched.
    if ((await this.getApprovalChainSetting(organizationId)).twoStepApproval) {
      if (!plan.firstApproverId) {
        // Step 1 of 2: record the first approver; the
        // plan STAYS pending_approval for a second,
        // different approver.
        await (this.prisma as any).campaignPlan.update({
          where: { id: planId }, data: { firstApproverId: actorId, firstApprovedAt: new Date() },
        });
        await this.audit.log({ organizationId, userId: actorId, action: "campaign.approved_step1", entityType: "CampaignPlan", entityId: planId, metadata: { twoStep: true } });
        if (plan.createdById && plan.createdById !== actorId) {
          await this.notifyUsers(organizationId, [plan.createdById], "campaign_approval", "1️⃣ প্রথম অনুমোদন হয়েছে (ধাপ ১/২)", `"${plan.name}" প্রথম অনুমোদন পেয়েছে — দ্বিতীয় (অন্য) একজন Approver-এর অনুমোদনের অপেক্ষায়।`);
        }
        await this.notifyUsers(organizationId, await this.approverIds(organizationId, actorId), "campaign_approval", "📢 দ্বিতীয় অনুমোদন দরকার (ধাপ ২/২)", `"${plan.name}" প্রথম ধাপে অনুমোদিত — একজন দ্বিতীয় Approver-এর অনুমোদন বাকি।`);
        const full = await this.getPlanFull(organizationId, planId);
        return { ...full, approvalState: { twoStep: true, step: 1, awaitingSecond: true } };
      }
      if (plan.firstApproverId === actorId) {
        throw new BadRequestException("দুই ধাপের অনুমোদনে দ্বিতীয় অনুমোদনটি অন্য একজন Approver-এর হতে হবে — Two-step approval requires a DIFFERENT second approver; your step-1 approval is already recorded.");
      }
      // Step 2 of 2: a different approver completes it,
      // exactly like a single approval, with the chain
      // recorded in the audit metadata.
      await (this.prisma as any).campaignPlan.update({
        where: { id: planId }, data: { status: "approved", approvedById: actorId, approvedAt: new Date() },
      });
      await this.audit.log({ organizationId, userId: actorId, action: "campaign.approved", entityType: "CampaignPlan", entityId: planId, metadata: { twoStep: true, firstApproverId: plan.firstApproverId } });
      if (plan.createdById && plan.createdById !== actorId) {
        await this.notifyUsers(organizationId, [plan.createdById], "campaign_approved", "✅ Campaign অনুমোদিত হয়েছে", `"${plan.name}" অনুমোদিত — এখন Publish করা যাবে (PAUSED হিসেবে)।`);
      }
      return this.getPlanFull(organizationId, planId);
    }
    await (this.prisma as any).campaignPlan.update({
      where: { id: planId }, data: { status: "approved", approvedById: actorId, approvedAt: new Date() },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.approved", entityType: "CampaignPlan", entityId: planId });
    if (plan.createdById && plan.createdById !== actorId) {
      await this.notifyUsers(organizationId, [plan.createdById], "campaign_approved", "✅ Campaign অনুমোদিত হয়েছে", `"${plan.name}" অনুমোদিত — এখন Publish করা যাবে (PAUSED হিসেবে)।`);
    }
    return this.getPlanFull(organizationId, planId);
  }

  async reject(organizationId: string, actorId: string, planId: string, reason: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    if (plan.status !== "pending_approval") throw new BadRequestException(`Only pending_approval plans can be rejected (current: ${plan.status})`);
    await (this.prisma as any).campaignPlan.update({
      where: { id: planId }, data: { status: "rejected", rejectionReason: reason.slice(0, 500), firstApproverId: null, firstApprovedAt: null },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.rejected", entityType: "CampaignPlan", entityId: planId, metadata: { reason } });
    if (plan.createdById && plan.createdById !== actorId) {
      await this.notifyUsers(organizationId, [plan.createdById], "campaign_rejected", "↩️ Campaign এ পরিবর্তন চাওয়া হয়েছে", `"${plan.name}" প্রত্যাখ্যাত: ${reason.slice(0, 200)} — Draft এ ঠিক করে আবার পাঠান।`);
    }
    return this.getPlanFull(organizationId, planId);
  }

  // ---------- Publishing ----------
  /** Resolve a Meta client for ONE ad account record
   *  (shared by publish + CN1 targeting search). */
  private async metaClientForAccount(organizationId: string, account: any): Promise<MetaPublishClient> {
    if (!account?.integrationId) throw new BadRequestException("This ad account has no Meta API connection (it was created for CSV/manual data) and cannot publish. Connect Meta first.");
    const integration = await (this.prisma as any).integration.findUnique({ where: { id: account.integrationId }, include: { credential: true } });
    if (!integration?.credential) throw new BadRequestException("Meta integration credentials are missing");
    const secrets = decryptJson<{ accessToken: string }>(integration.credential.encryptedData);
    return new MetaPublishClient(secrets.accessToken);
  }

  /** Frontier CN15 (NB7): the experiments service creates
   * Meta Ad Studies through the SAME per-account client
   * the publish flow uses — same account resolution, same
   * connection token. Exposed (rather than re-implemented)
   * so there is exactly one place that turns an ad account
   * record into an authenticated Meta client. */
  async metaClientForPlan(organizationId: string, planId: string): Promise<{ client: MetaPublishClient; account: any; plan: any }> {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    const { client, account } = await this.publishClient(organizationId, plan);
    return { client, account, plan };
  }

  private async publishClient(organizationId: string, plan: any): Promise<{ client: MetaPublishClient; account: any }> {
    const account = await (this.prisma as any).adAccount.findFirst({ where: { id: plan.adAccountId, organizationId } });
    if (!account) throw new BadRequestException("Ad account no longer exists");
    const client = await this.metaClientForAccount(organizationId, account);
    return { client, account };
  }

  /**
   * CN1: targeting discovery for the builder. Searches
   * Meta's own targeting catalogue through the account's
   * connection — results are Meta's rows verbatim (id +
   * name). Without a connection (or on a Meta error) the
   * result is the honest unavailable state: available:false
   * WITH the reason and NO invented results.
   */
  async searchTargeting(organizationId: string, dto: { adAccountId: string; kind: string; query: string }) {
    const type = CampaignsService.TARGETING_SEARCH_TYPES[dto.kind];
    if (!type) throw new BadRequestException(`kind must be one of: ${Object.keys(CampaignsService.TARGETING_SEARCH_TYPES).join(", ")}`);
    if (!dto.query?.trim()) throw new BadRequestException("A search query is required");
    const account = await (this.prisma as any).adAccount.findFirst({ where: { id: dto.adAccountId, organizationId } });
    if (!account) throw new NotFoundException("Ad account not found in this organization");
    if (account.platform !== "meta") throw new BadRequestException("Targeting search is a Meta feature");
    try {
      const client = await this.metaClientForAccount(organizationId, account);
      const rows = await client.targetingSearch(account.externalId, { type, query: dto.query.trim() });
      return {
        available: true, kind: dto.kind, type,
        results: rows.map((r: any) => ({
          id: String(r.id), name: r.name ?? null, type: r.type ?? null,
          path: Array.isArray(r.path) ? r.path : null,
          audienceSizeLower: typeof r.audience_size_lower_bound === "number" ? r.audience_size_lower_bound : null,
          audienceSizeUpper: typeof r.audience_size_upper_bound === "number" ? r.audience_size_upper_bound : null,
        })),
      };
    } catch (e) {
      return { available: false, kind: dto.kind, type, reason: e instanceof Error ? e.message.slice(0, 200) : "Meta targeting search unavailable", results: [] as any[] };
    }
  }

  private toGraphTargeting(targeting: any, advantagePlus = false): Record<string, unknown> {
    // CN1: geo_locations grows beyond countries — cities
    // (with optional radius), postcodes (zips) and location
    // types ride the same object Meta's targeting spec uses.
    const geo: Record<string, unknown> = {};
    if (Array.isArray(targeting.countries) && targeting.countries.length) geo.countries = targeting.countries;
    if (Array.isArray(targeting.cities) && targeting.cities.length) {
      geo.cities = targeting.cities.map((c: any) => ({
        key: c.key,
        ...(c.radius !== undefined ? { radius: c.radius, distance_unit: c.distanceUnit ?? "kilometer" } : {}),
      }));
    }
    if (Array.isArray(targeting.postcodes) && targeting.postcodes.length) {
      geo.zips = targeting.postcodes.map((k: string) => ({ key: k }));
    }
    if (Array.isArray(targeting.locationTypes) && targeting.locationTypes.length) {
      geo.location_types = targeting.locationTypes;
    }
    const out: Record<string, unknown> = {
      geo_locations: Object.keys(geo).length ? geo : { countries: [] },
      ...(targeting.ageMin ? { age_min: targeting.ageMin } : {}),
      ...(targeting.ageMax ? { age_max: targeting.ageMax } : {}),
      ...(Array.isArray(targeting.genders) ? { genders: targeting.genders } : {}),
      ...(Array.isArray(targeting.locales) && targeting.locales.length ? { locales: targeting.locales } : {}),
    };
    // Phase H: interests / behaviors via flexible_spec, and saved
    // custom audiences (external Meta ids) as include / exclude.
    // CN1: each flexible_spec element is ANDed with the others
    // by Meta, so the demographics group and the ONE narrowing
    // layer are separate elements on purpose.
    const entry = (e: any) => (typeof e === "string" ? { name: e } : { ...(e.id ? { id: String(e.id) } : {}), name: e.name });
    const flexible: Record<string, unknown>[] = [];
    if (Array.isArray(targeting.interests) && targeting.interests.length) {
      flexible.push({ interests: targeting.interests.map(entry) });
    }
    if (Array.isArray(targeting.behaviors) && targeting.behaviors.length) {
      flexible.push({ behaviors: targeting.behaviors.map(entry) });
    }
    const demo = targeting.demographics;
    if (demo && typeof demo === "object") {
      const d: Record<string, unknown> = {};
      if (Array.isArray(demo.educationStatuses) && demo.educationStatuses.length) d.education_statuses = demo.educationStatuses;
      if (Array.isArray(demo.relationshipStatuses) && demo.relationshipStatuses.length) d.relationship_statuses = demo.relationshipStatuses;
      if (Array.isArray(demo.lifeEvents) && demo.lifeEvents.length) d.life_events = demo.lifeEvents.map(entry);
      if (Array.isArray(demo.workPositions) && demo.workPositions.length) d.work_positions = demo.workPositions.map(entry);
      if (Object.keys(d).length) flexible.push({ demographics: [d] });
    }
    if ((Array.isArray(targeting.narrowInterests) && targeting.narrowInterests.length) || (Array.isArray(targeting.narrowBehaviors) && targeting.narrowBehaviors.length)) {
      const narrow: Record<string, unknown> = {};
      if (targeting.narrowInterests?.length) narrow.interests = targeting.narrowInterests.map(entry);
      if (targeting.narrowBehaviors?.length) narrow.behaviors = targeting.narrowBehaviors.map(entry);
      flexible.push(narrow);
    }
    if (flexible.length) out.flexible_spec = flexible;
    if (Array.isArray(targeting.customAudienceIds) && targeting.customAudienceIds.length) {
      out.custom_audiences = targeting.customAudienceIds.map((id: string) => ({ id }));
    }
    // Advantage+ audience expansion (Milestone 32): Meta widens the
    // audience automatically when this is on. CN1: the
    // detailed-targeting expansion toggle rides the same
    // mechanism (Meta has folded expansion into Advantage
    // audience) — live confirmation is M30-class.
    if (advantagePlus || targeting.targetingExpansion === true) out.targeting_automation = { advantage_audience: 1 };
    if (Array.isArray(targeting.excludedAudienceIds) && targeting.excludedAudienceIds.length) {
      out.excluded_custom_audiences = targeting.excludedAudienceIds.map((id: string) => ({ id }));
    }
    // Campaign Builder CB1: placements. Our position
    // vocabulary maps onto each platform's own enum;
    // a platform with no mapped position is simply not
    // position-restricted (its field is omitted).
    if (Array.isArray(targeting.platforms) && targeting.platforms.length) {
      out.publisher_platforms = targeting.platforms;
    }
    if (Array.isArray(targeting.positions) && targeting.positions.length) {
      const FB: Record<string, string> = { feed: "feed", story: "story", reels: "facebook_reels", search: "search" };
      const IG: Record<string, string> = { feed: "stream", story: "story", reels: "reels", search: "ig_search" };
      const platforms: string[] = Array.isArray(targeting.platforms) && targeting.platforms.length ? targeting.platforms : ["facebook", "instagram"];
      const fb = targeting.positions.map((p: string) => FB[p]).filter(Boolean);
      const ig = targeting.positions.map((p: string) => IG[p]).filter(Boolean);
      if (platforms.includes("facebook") && fb.length) out.facebook_positions = fb;
      if (platforms.includes("instagram") && ig.length) out.instagram_positions = ig;
    }
    if (Array.isArray(targeting.devices) && targeting.devices.length) {
      out.device_platforms = targeting.devices;
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

  /** CN5: resolve an ad's per-placement override assets to
   *  Meta media (same readiness rules as the base media —
   *  a missing/unready override fails the publish honestly
   *  rather than silently falling back to the base asset). */
  private async resolvePlacementMedia(organizationId: string, ad: any): Promise<{ feed?: { imageHash?: string; imageUrl?: string; videoId?: string }; vertical?: { imageHash?: string; imageUrl?: string; videoId?: string } } | undefined> {
    const pa = ad?.placementAssets;
    if (!pa || typeof pa !== "object" || !Object.keys(pa).length) return undefined;
    const out: any = {};
    for (const group of ["feed", "vertical"] as const) {
      const ref = pa[group];
      if (!ref) continue;
      if (ref.videoAssetId) {
        const asset = await (this.prisma as any).creativeAsset.findFirst({ where: { id: ref.videoAssetId, organizationId } });
        if (!asset) throw new Error(`Placement (${group}) creative asset ${ref.videoAssetId} not found`);
        if (asset.kind !== "video") throw new Error(`Placement (${group}) asset "${asset.name}" is a ${asset.kind}, not a video`);
        if (asset.status !== "ready" || !asset.externalVideoId) throw new Error(`Placement (${group}) video asset "${asset.name}" is not ready on Meta (status: ${asset.status})`);
        out[group] = { videoId: asset.externalVideoId };
      } else if (ref.imageAssetId) {
        const asset = await (this.prisma as any).creativeAsset.findFirst({ where: { id: ref.imageAssetId, organizationId } });
        if (!asset) throw new Error(`Placement (${group}) creative asset ${ref.imageAssetId} not found`);
        if (asset.kind !== "image") throw new Error(`Placement (${group}) asset "${asset.name}" is a ${asset.kind}, not an image`);
        if (asset.status !== "ready") throw new Error(`Placement (${group}) asset "${asset.name}" is not ready on Meta (status: ${asset.status})`);
        out[group] = { imageHash: asset.externalHash ?? undefined, ...(asset.externalHash ? {} : (ref.imageUrl ? { imageUrl: ref.imageUrl } : {})) };
      } else if (ref.imageUrl) {
        out[group] = { imageUrl: ref.imageUrl };
      }
    }
    return Object.keys(out).length ? out : undefined;
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
        // CN2: the copy keeps the budget structure + bids.
        budgetMode: full.budgetMode ?? "abo",
        campaignDailyBudgetMinor: full.campaignDailyBudgetMinor != null ? BigInt(full.campaignDailyBudgetMinor) : undefined,
        campaignLifetimeBudgetMinor: full.campaignLifetimeBudgetMinor != null ? BigInt(full.campaignLifetimeBudgetMinor) : undefined,
        // NB5 mini-fix: the plan-level daily budget cap
        // is part of the plan — copies keep it (the clone
        // path already did; duplicatePlan did not).
        dailyBudgetCapMinor: full.dailyBudgetCapMinor != null ? BigInt(full.dailyBudgetCapMinor) : undefined,
      },
    });
    for (const adSet of full.adSets ?? []) {
      const newSet = await (this.prisma as any).campaignAdSet.create({
        data: this.adSetCopyData(copy.id, adSet),
      });
      for (const ad of adSet.ads ?? []) {
        await (this.prisma as any).campaignAd.create({
          data: this.adCopyData(newSet.id, ad),
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

  /** CN4: our LeadForm row -> Meta's leadgen_forms payload.
   *  Field names follow Meta's Lead Ads guide + the Page
   *  leadgen_forms reference: questions is a JSON string
   *  (CUSTOM questions carry label/options), privacy_policy
   *  is an object { url, link_text }, higher intent is
   *  is_optimized_for_quality=true, the thank-you page is
   *  an object, and the post-submit website rides
   *  follow_up_action_url. The intro headline maps to
   *  question_page_custom_headline. */
  private buildLeadFormPayload(form: any): Record<string, string> {
    const questions = (Array.isArray(form.questions) ? form.questions : []).map((q: any) => {
      const out: any = { type: q.type, key: q.key };
      if (q.label) out.label = q.label;
      if (Array.isArray(q.options) && q.options.length) out.options = q.options.map((o: any) => ({ key: o.key, value: o.value }));
      return out;
    });
    const payload: Record<string, string> = {
      name: form.name,
      locale: form.locale ?? "EN_US",
      questions: JSON.stringify(questions),
      privacy_policy: JSON.stringify({ url: form.privacyPolicyUrl, ...(form.privacyLinkText ? { link_text: form.privacyLinkText } : {}) }),
      block_display_for_non_targeted_viewer: "false",
    };
    if (form.higherIntent) payload.is_optimized_for_quality = "true";
    if (form.followUpActionUrl) payload.follow_up_action_url = form.followUpActionUrl;
    if (form.introHeadline) payload.question_page_custom_headline = form.introHeadline;
    if (form.thankYouTitle || form.thankYouBody || form.thankYouButtonText) {
      payload.thank_you_page = JSON.stringify({
        title: form.thankYouTitle || "ধন্যবাদ!",
        ...(form.thankYouBody ? { body: form.thankYouBody } : {}),
        ...(form.thankYouButtonText ? { button_text: form.thankYouButtonText } : {}),
      });
    }
    return payload;
  }

  /** CN4: create a modelled form on Meta through the given
   *  client (the plan ad account's token — the token class
   *  every other publish call in this service uses; Meta's
   *  guide asks for a Page token from a person with the
   *  ADVERTISE task, so whether a given org's token is
   *  accepted for a given Page is CN12 live-proof class).
   *  The row counts as created ONLY with Meta's returned
   *  form id; a refusal is recorded on the row verbatim and
   *  rethrown — never converted into a fake success. */
  async createLeadFormOnMeta(organizationId: string, actorId: string, form: any, client: MetaPublishClient): Promise<string> {
    if (form.externalFormId && form.status === "created") return form.externalFormId;
    try {
      const created = await client.createLeadForm(form.pageId, this.buildLeadFormPayload(form));
      await (this.prisma as any).leadForm.update({ where: { id: form.id }, data: { externalFormId: created.id, status: "created", error: null } });
      await this.audit.log({ organizationId, userId: actorId, action: "campaign.lead_form_created_on_meta", entityType: "LeadForm", entityId: form.id, metadata: { externalFormId: created.id, pageId: form.pageId } }).catch(() => undefined);
      form.externalFormId = created.id; form.status = "created"; form.error = null;
      return created.id;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Meta lead form creation failed";
      await (this.prisma as any).leadForm.update({ where: { id: form.id }, data: { status: "failed", error: message } }).catch(() => undefined);
      throw new BadRequestException(`Meta lead form creation did NOT succeed: ${message}`);
    }
  }

  /** NB2: what publish actually sends for one ad set, kept
   *  in ONE place so it can be stated exactly:
   *  - catalog ad set → promoted_object
   *    { product_set_id: <the set's Meta id> }; its ads use
   *    the dynamic product-template creative; no pixel
   *    event is sent for a catalog set.
   *  - OFFSITE_CONVERSIONS / VALUE → { pixel_id,
   *    custom_event_type: <CN3's chosen event, default
   *    PURCHASE> }.
   *  - LEAD_GENERATION with a form → the form is created on
   *    Meta first when it has no external id (a refusal
   *    fails the publish with Meta's reason, recorded on
   *    the form row + publish log), promoted_object
   *    { page_id }, destination_type ON_AD, and each ad's
   *    creative carries lead_gen_form_id.
   *  - LEAD_GENERATION with pixel + LEAD event →
   *    { pixel_id, custom_event_type: "LEAD" }.
   *  - LEAD_GENERATION as before → { page_id }. */
  private async publishPromotedObject(organizationId: string, planId: string, actorId: string, client: MetaPublishClient, adSet: any): Promise<{ promotedObject?: Record<string, unknown>; destinationType?: string; leadFormExternalId?: string; catalogTemplate?: boolean; whatsApp?: boolean }> {
    // CN13: a WhatsApp destination set — promoted_object
    // is the Page plus the connected number's digits when
    // Meta's read-back resolved them at save time (the
    // field is OPTIONAL in Meta's CTWA guide; without it
    // Meta uses the number linked to the Page). The
    // destination_type is "WHATSAPP" per the guide.
    if (adSet.destinationType === "WHATSAPP") {
      const digits = adSet.whatsappPhoneNumber ? String(adSet.whatsappPhoneNumber).replace(/\D/g, "") : "";
      return {
        promotedObject: { page_id: adSet.pageId, ...(digits ? { whatsapp_phone_number: digits } : {}) },
        destinationType: "WHATSAPP", whatsApp: true,
      };
    }
    if (adSet.catalogRecordId || adSet.productSetId) {
      const refs = await this.resolveCatalogRefs(organizationId, adSet);
      return { promotedObject: { product_set_id: refs!.set.externalSetId }, catalogTemplate: true };
    }
    if ((adSet.optimizationGoal === "OFFSITE_CONVERSIONS" || adSet.optimizationGoal === "VALUE") && adSet.pixelId) {
      return { promotedObject: { pixel_id: adSet.pixelId, custom_event_type: adSet.conversionEvent ?? "PURCHASE" } };
    }
    if (adSet.optimizationGoal === "LEAD_GENERATION") {
      if (adSet.leadFormId) {
        const form = (adSet as any).__leadForm ?? (await this.resolveLeadFormRef(organizationId, adSet));
        if (!form) throw new BadRequestException(`Ad set "${adSet.name}": the attached lead form no longer exists`);
        let externalFormId = form.externalFormId as string | null;
        if (!externalFormId) {
          try {
            externalFormId = await this.createLeadFormOnMeta(organizationId, actorId, form, client);
            await this.logStep(planId, actorId, "lead_form", "success", { entityRef: adSet.id, externalId: externalFormId }).catch(() => undefined);
          } catch (e) {
            await this.logStep(planId, actorId, "lead_form", "error", { entityRef: adSet.id, error: e instanceof Error ? e.message : "lead form creation failed" }).catch(() => undefined);
            throw e;
          }
        }
        return { promotedObject: adSet.pageId ? { page_id: adSet.pageId } : undefined, destinationType: "ON_AD", leadFormExternalId: externalFormId ?? undefined };
      }
      if (adSet.pixelId && adSet.conversionEvent) {
        return { promotedObject: { pixel_id: adSet.pixelId, custom_event_type: adSet.conversionEvent } };
      }
      if (adSet.pageId) return { promotedObject: { page_id: adSet.pageId } };
    }
    return {};
  }

  /**
   * Publishes an APPROVED plan. Every object is created PAUSED.
   * Idempotent resume: entities that already have an external id are
   * skipped, so a retry after a partial failure never duplicates a
   * campaign on Meta. Every step is logged; the plan is "published"
   * only when every entity has a confirmed external id.
   */
  /**
   * CC27: campaign launch/publish deny gate. The plan's ad
   * account is a deniable target (CC27 matrix extension): a
   * member denied it cannot publish to it or (re)activate
   * anything on it. PAUSED is deliberately NOT gated anywhere —
   * stopping spend is a safety action and must never be blocked
   * by an access matrix. Automation callers pass the RULE
   * CREATOR as the actor, so automated activations are gated on
   * the creator too; scheduled launches call publish() with the
   * PLAN CREATOR as the actor (scanScheduledLaunches), so a
   * launch refused on deny lands in that path's native
   * launch_failed audit + notification.
   */
  private async assertCampaignAccountAccess(organizationId: string, actorId: string, plan: any) {
    const accountId = plan?.adAccountId ?? null;
    if (!accountId) return;
    if (await isMemberConnectionDenied(this.prisma as any, organizationId, actorId, accountId)) {
      throw new ForbiddenException("এই বিজ্ঞাপন অ্যাকাউন্টে ক্যাম্পেইন চালু/প্রকাশ করার অনুমতি আপনাকে দেওয়া হয়নি — Connect Center-এর অ্যাক্সেস সেটিংস দেখুন বা OWNER/ADMIN-কে বলুন।");
    }
  }

  async publish(organizationId: string, actorId: string, planId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    // CC27: refuse BEFORE any platform client is built (and
    // before the approval-state checks — a denied member learns
    // only that they lack access to this account).
    await this.assertCampaignAccountAccess(organizationId, actorId, plan);
    if (!["approved", "publish_failed"].includes(plan.status)) {
      throw new ForbiddenException(`Plan must be approved before publishing (current: ${plan.status}). Publishing without recorded approval is not possible.`);
    }
    const full = await this.getPlanFull(organizationId, planId);
    const { valid, errors } = this.validatePlan(full);
    if (!valid) throw new BadRequestException(`Plan no longer validates: ${errors.join("; ")}`);
    this.assertWithinCap(full);
    // CB4 integrity: what was approved is what gets
    // published. (Edits are already locked after
    // submit; this catches anything that bypassed the
    // state machine.)
    if ((plan as any).submissionSnapshot) {
      const current = this.definitionOf(full);
      if (this.stableStringify(current) !== this.stableStringify((plan as any).submissionSnapshot)) {
        throw new BadRequestException("Plan changed since approval — the published content must match the approved snapshot. Re-submit for approval first.");
      }
    }
    const { client, account } = await this.publishClient(organizationId, plan);
    await (this.prisma as any).campaignPlan.update({ where: { id: planId }, data: { status: "publishing" } });

    try {
      let campaignExternalId = plan.externalCampaignId as string | null;
      // CN2: campaign-level budget is now an explicit plan
      // choice (budgetMode "cbo") for EVERY plan; Advantage+
      // still implies it, with its legacy fallback (first
      // ad set's daily budget) when no campaign budget was
      // set explicitly. ABO plans send no campaign budget
      // and their ad sets keep their own — as before.
      const cbo = this.isCbo(full);
      if (!campaignExternalId) {
        const cb = this.campaignBudgets(full);
        if (cbo && cb.dailyMinor == null && cb.lifetimeMinor == null) {
          throw new BadRequestException("Campaign budget (CBO) needs a campaign daily or lifetime budget on the plan (Advantage+ without one needs an ad set with a daily budget)");
        }
        const created = await client.createCampaign(account.externalId, {
          name: plan.name, objective: plan.objective,
          dailyBudgetMinor: cbo ? (cb.dailyMinor?.toString() ?? undefined) : undefined,
          lifetimeBudgetMinor: cbo ? (cb.lifetimeMinor?.toString() ?? undefined) : undefined,
        });
        if (plan.advantagePlus) {
          await this.logStep(planId, actorId, "advantage_plus", "success", { externalId: cb.dailyMinor?.toString() }).catch(() => undefined);
          await this.audit.log({ organizationId, userId: actorId, action: "campaign.advantage_plus_publish", entityType: "CampaignPlan", entityId: planId, metadata: { campaignBudgetMinor: cb.dailyMinor?.toString(), note: "Budget moved to campaign level; ad sets created without budgets; targeting_automation.advantage_audience = 1" } }).catch(() => undefined);
        } else if (cbo) {
          await this.logStep(planId, actorId, "campaign_budget", "success", { externalId: cb.dailyMinor?.toString() ?? cb.lifetimeMinor?.toString() }).catch(() => undefined);
          await this.audit.log({ organizationId, userId: actorId, action: "campaign.cbo_publish", entityType: "CampaignPlan", entityId: planId, metadata: { campaignDailyMinor: cb.dailyMinor?.toString() ?? null, campaignLifetimeMinor: cb.lifetimeMinor?.toString() ?? null, note: "Budget at campaign level (CBO); ad sets created without budgets" } }).catch(() => undefined);
        }
        campaignExternalId = created.id;
        await (this.prisma as any).campaignPlan.update({ where: { id: planId }, data: { externalCampaignId: campaignExternalId, metaStatus: "PAUSED" } });
        await this.logStep(planId, actorId, "campaign", "success", { externalId: campaignExternalId });
      }
      for (const adSet of full.adSets) {
        // NB2: what this ad set promotes (CN3 event/catalog,
        // CN4 lead form) — computed per set, before creation;
        // on a resume it recomputes read-only state (a form
        // that already exists on Meta is not re-created).
        const po = await this.publishPromotedObject(organizationId, planId, actorId, client, adSet);
        let adSetExternalId = adSet.externalAdSetId as string | null;
        if (!adSetExternalId) {
          const created = await client.createAdSet(account.externalId, {
            name: adSet.name, campaignId: campaignExternalId,
            dailyBudgetMinor: cbo ? undefined : (adSet.dailyBudgetMinor ?? undefined),
            lifetimeBudgetMinor: cbo ? undefined : (adSet.lifetimeBudgetMinor ?? undefined),
            billingEvent: adSet.billingEvent ?? "IMPRESSIONS",
            optimizationGoal: adSet.optimizationGoal,
            targeting: this.toGraphTargeting(adSet.targeting ?? {}, plan.advantagePlus === true),
            promotedObject: po.promotedObject,
            destinationType: po.destinationType,
            // CN2: bidding fields (empty for lowest_cost —
            // Meta's default needs no fields sent).
            ...this.bidGraphFields(adSet),
            startTime: adSet.startTime ? new Date(adSet.startTime).toISOString() : undefined,
            endTime: adSet.endTime ? new Date(adSet.endTime).toISOString() : undefined,
          });
          adSetExternalId = created.id;
          await (this.prisma as any).campaignAdSet.update({ where: { id: adSet.id }, data: { externalAdSetId: adSetExternalId } });
          await this.logStep(planId, actorId, "adset", "success", { entityRef: adSet.id, externalId: adSetExternalId });
          // CN13: record exactly which connected WhatsApp
          // the set was bound to, and whether the number
          // went to Meta explicitly or by Page-link fallback.
          if (po.whatsApp) {
            await this.logStep(planId, actorId, "whatsapp_destination", "success", {
              entityRef: adSet.id, externalId: adSet.whatsappPhoneNumberId ?? undefined,
              error: adSet.whatsappPhoneNumber
                ? `destination_type=WHATSAPP; promoted_object.whatsapp_phone_number পাঠানো হয়েছে (${String(adSet.whatsappPhoneNumber).replace(/\D/g, "")}) — Connected WhatsApp Integration ${adSet.whatsappIntegrationId}`
                : `destination_type=WHATSAPP; whatsapp_phone_number পাঠানো হয়নি (নম্বরের Digits Meta থেকে পড়া যায়নি) — Meta Page-এর সাথে Linked WhatsApp নম্বরটি ব্যবহার করবে; Connected WhatsApp Integration ${adSet.whatsappIntegrationId}`,
            }).catch(() => undefined);
          }
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
          // NB3 (CN5): creative v2 — text options, placement
          // media and enhancement toggles ride the asset-feed
          // path for link/video ads. Catalog-template and
          // lead-form creatives cannot carry them (and
          // carousels cannot carry options/placement): when
          // an ad HAS creative v2 fields that its format will
          // not send, the publish log records the first-option
          // fallback loudly instead of claiming Meta got them.
          const placementMedia = await this.resolvePlacementMedia(organizationId, ad);
          const cn5Options = this.textOptionsOf(ad);
          const cn5Enhancements = (ad as any).creativeEnhancements ?? undefined;
          const format = ad.format ?? "link";
          const cannotCarryOptions = po.catalogTemplate === true || !!po.leadFormExternalId || format === "carousel" || po.whatsApp === true;
          if (cannotCarryOptions && (this.hasMultiText(ad) || placementMedia || (format === "carousel" && cn5Enhancements))) {
            await this.logStep(planId, actorId, "creative_v2_first_option_only", "success", {
              entityRef: ad.id,
              error: `Ad "${ad.name}": ${po.catalogTemplate ? "catalog template" : po.leadFormExternalId ? "lead form" : po.whatsApp ? "WhatsApp (CTWA)" : "carousel"} creative পাঠানো হয়েছে — Text Options/Placement Asset${format === "carousel" ? "/Enhancement" : ""} Meta-তে যায়নি, শুধু প্রথম Option ও মূল Asset গেছে (readiness-এ আগেই সতর্ক করা হয়েছিল)`,
            }).catch(() => undefined);
          }
          const created = await client.createAd(account.externalId, {
            name: ad.name, adSetId: adSetExternalId, pageId: adSet.pageId,
            linkUrl: tagged.url, primaryText: ad.primaryText, headline: ad.headline ?? undefined,
            description: ad.description ?? undefined, imageUrl: ad.imageUrl ?? undefined,
            imageHash: resolved.imageHash, videoId: resolved.videoId, carouselCards: taggedCards,
            callToAction: ad.callToAction ?? "SHOP_NOW",
            // NB2: a lead-form ad's creative carries the form
            // id; a catalog ad uses the product template.
            leadGenFormId: po.leadFormExternalId,
            catalogTemplate: po.catalogTemplate === true,
            // CN13: a WhatsApp destination set's ads are
            // CTWA creatives (the client builds the
            // documented link_data shape + welcome block).
            whatsApp: po.whatsApp ? { welcome: (ad as any).whatsappWelcome ?? null } : undefined,
            // NB3 (CN5): the client sends these only through
            // the asset-feed / degrees-of-freedom paths it
            // can actually express; the guards there mirror
            // the fallback logged above.
            textOptions: cn5Options ?? undefined,
            placementMedia,
            enhancements: cn5Enhancements ?? undefined,
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
    // CN2: a CBO campaign's budget lives on the campaign —
    // there is no per-ad-set budget on Meta to edit.
    if (this.isCbo(plan)) throw new BadRequestException("This plan uses a campaign-level budget (CBO) — ad sets carry no budget of their own on Meta, so there is no ad set budget to edit");
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
    // CC27: activation gated, pause always allowed (see
    // assertCampaignAccountAccess).
    if (target === "ACTIVE") await this.assertCampaignAccountAccess(organizationId, actorId, plan);
    const adSet = await (this.prisma as any).campaignAdSet.findFirst({ where: { id: adSetId, planId } });
    if (!adSet?.externalAdSetId) throw new BadRequestException("This ad set has no Meta ad set id");
    const { client } = await this.publishClient(organizationId, plan);
    await client.setObjectStatus(adSet.externalAdSetId, target);
    return { adSetId, target };
  }

  /** Pause ONE ad on Meta (rules v3 pause_ad). Confirmed by Meta. */
  async setAdStatus(organizationId: string, actorId: string, planId: string, adId: string, target: "ACTIVE" | "PAUSED") {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    // CC27: activation gated, pause always allowed.
    if (target === "ACTIVE") await this.assertCampaignAccountAccess(organizationId, actorId, plan);
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
            spend += BigInt(r.spendMinor ?? 0); platformConv += BigInt(r.platformConversions ?? r.conversions ?? 0);
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

  /**
   * CB5: real performance for one plan, using the same
   * semantics as the A/B results: campaign-level metric
   * rows only (ad-level rows would double-count), plus
   * first-party attributed revenue/orders. No data =
   * an honest empty result, never estimates.
   */
  async planPerformance(organizationId: string, planId: string, window?: { since: Date }) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    const full = await this.getPlanFull(organizationId, planId);
    if (!plan.externalCampaignId) {
      return { published: false, totals: null, perAdSet: [], daily: [] };
    }
    // Frontier NB8 / CN18: an optional window (the
    // campaign report share) filters the same rows by
    // date. No window = the CB5 behaviour, unchanged.
    const rows = (await (this.prisma as any).dailyAdMetric.findMany({
      where: { organizationId, campaignExternalId: plan.externalCampaignId }, take: 10000,
    }).catch(() => [])).filter((r: any) => !window || new Date(r.date).getTime() >= window.since.getTime());
    let spend = 0n; let impressions = 0; let clicks = 0; let conversions = 0n; let reach = 0;
    const byDay = new Map<string, { date: string; spendMinor: string; impressions: number; clicks: number; conversions: number }>();
    const bySet = new Map<string, { spend: bigint; impressions: number; clicks: number; conversions: bigint }>();
    for (const r of rows as any[]) {
      if ((r.adExternalId ?? "") !== "") continue; // campaign/ad-set level only
      const s = BigInt(r.spendMinor ?? 0);
      spend += s; impressions += Number(r.impressions ?? 0); clicks += Number(r.clicks ?? 0);
      conversions += BigInt(r.platformConversions ?? r.conversions ?? 0); reach += Number(r.reach ?? 0);
      const day = new Date(r.date).toISOString().slice(0, 10);
      const d = byDay.get(day) ?? { date: day, spendMinor: "0", impressions: 0, clicks: 0, conversions: 0 };
      d.spendMinor = (BigInt(d.spendMinor) + s).toString(); d.impressions += Number(r.impressions ?? 0);
      d.clicks += Number(r.clicks ?? 0); d.conversions += Number(r.platformConversions ?? r.conversions ?? 0);
      byDay.set(day, d);
      if (r.adSetExternalId) {
        const g = bySet.get(r.adSetExternalId) ?? { spend: 0n, impressions: 0, clicks: 0, conversions: 0n };
        g.spend += s; g.impressions += Number(r.impressions ?? 0); g.clicks += Number(r.clicks ?? 0); g.conversions += BigInt(r.platformConversions ?? r.conversions ?? 0);
        bySet.set(r.adSetExternalId, g);
      }
    }
    // First-party revenue (the platform's own orders).
    let fpRevenue = 0n; const fpOrders = new Set<string>();
    const credits = (await (this.prisma as any).attributionCredit?.findMany?.({ where: { organizationId }, take: 10000 })?.catch?.(() => []) ?? [])
      .filter((c: any) => !window || new Date(c.createdAt).getTime() >= window.since.getTime());
    if (credits.length) {
      const tpIds = [...new Set(credits.map((c: any) => c.touchpointId))];
      const tps = await (this.prisma as any).touchpoint.findMany({ where: { id: { in: tpIds } } }).catch(() => []);
      const tpMap = new Map((tps as any[]).map((t) => [t.id, t]));
      for (const c of credits as any[]) {
        const tp: any = tpMap.get(c.touchpointId);
        if (tp && (tp.campaign === plan.name || tp.campaign === plan.externalCampaignId)) {
          fpRevenue += BigInt(c.revenueMinor ?? 0); fpOrders.add(c.orderId);
        }
      }
    }
    const perAdSet = (full.adSets ?? []).map((s: any) => {
      const g = s.externalAdSetId ? bySet.get(s.externalAdSetId) : undefined;
      return {
        adSetId: s.id, name: s.name, externalAdSetId: s.externalAdSetId ?? null,
        spendMinor: g ? g.spend.toString() : "0", impressions: g?.impressions ?? 0,
        clicks: g?.clicks ?? 0, conversions: g ? Number(g.conversions) : 0,
      };
    });
    return {
      published: true,
      totals: {
        spendMinor: spend.toString(), impressions, clicks, conversions: Number(conversions), reach,
        ctrPercent: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : null,
        cpmMinor: impressions > 0 ? ((spend * 1000n) / BigInt(impressions)).toString() : null,
        cpaMinor: conversions > 0n ? (spend / conversions).toString() : null,
        firstPartyRevenueMinor: fpRevenue.toString(), firstPartyOrders: fpOrders.size,
        roas: spend > 0n && fpRevenue > 0n ? Math.round(Number((fpRevenue * 100n) / spend)) / 100 : null,
      },
      perAdSet,
      daily: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  /**
   * CN2: pacing read-model for a PUBLISHED plan — spent
   * to date vs the spend expected by today, computed ONLY
   * from real DailyAdMetric campaign-level rows (both
   * external ids empty, so ad-set/ad rows never
   * double-count) and the plan's own budget structure:
   *   expected = lifetime budget x elapsed/total flight days
   *   or, without a lifetime window, daily budget x days elapsed.
   * Labelled computed-from-rows everywhere it surfaces;
   * it is arithmetic on synced data, NOT a forecast and
   * NOT a Meta number. No rows = an honest no_data state.
   */
  async planPacing(organizationId: string, planId: string, now = new Date()) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    const label = "computed_from_daily_ad_metric";
    if (!plan.externalCampaignId) {
      return { published: false, label, status: "not_published", spentMinor: "0", expectedMinor: null, varianceMinor: null };
    }
    const full = await this.getPlanFull(organizationId, planId);
    const rows = await (this.prisma as any).dailyAdMetric.findMany({
      where: { organizationId, campaignExternalId: plan.externalCampaignId }, take: 10000,
    }).catch(() => []);
    const campaignRows = (rows as any[]).filter((r) => (r.adSetExternalId ?? "") === "" && (r.adExternalId ?? "") === "");
    let spent = 0n;
    let firstMetric: Date | null = null;
    for (const r of campaignRows) {
      spent += BigInt(r.spendMinor ?? 0);
      const d = new Date(r.date);
      if (!firstMetric || d < firstMetric) firstMetric = d;
    }
    const dayMs = 86_400_000;
    const midnight = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const starts = (full.adSets ?? []).map((s: any) => s.startTime).filter(Boolean).map((v: any) => new Date(v));
    const ends = (full.adSets ?? []).map((s: any) => s.endTime).filter(Boolean).map((v: any) => new Date(v));
    const start = starts.length ? new Date(Math.min(...starts.map((d: Date) => d.getTime()))) : (plan.publishedAt ? new Date(plan.publishedAt) : firstMetric);
    const end = ends.length ? new Date(Math.max(...ends.map((d: Date) => d.getTime()))) : null;
    const cbo = this.isCbo(full);
    const cb = this.campaignBudgets(full);
    let dailyBudget: bigint | null = null;
    let lifetimeBudget: bigint | null = null;
    if (cbo) {
      dailyBudget = cb.dailyMinor; lifetimeBudget = cb.lifetimeMinor;
    } else {
      let d = 0n; let l = 0n; let hasD = false; let hasL = false;
      for (const s of full.adSets ?? []) {
        if (s.dailyBudgetMinor != null) { d += BigInt(s.dailyBudgetMinor); hasD = true; }
        if (s.lifetimeBudgetMinor != null) { l += BigInt(s.lifetimeBudgetMinor); hasL = true; }
      }
      dailyBudget = hasD ? d : null; lifetimeBudget = hasL ? l : null;
    }
    let daysElapsed: number | null = null;
    let daysTotal: number | null = null;
    let expected: bigint | null = null;
    if (start) {
      daysElapsed = Math.max(0, Math.floor((midnight(now).getTime() - midnight(start).getTime()) / dayMs) + 1);
      if (end) daysTotal = Math.max(1, Math.floor((midnight(end).getTime() - midnight(start).getTime()) / dayMs) + 1);
      if (lifetimeBudget != null && daysTotal != null && daysElapsed != null) {
        expected = (lifetimeBudget * BigInt(Math.min(daysElapsed, daysTotal))) / BigInt(daysTotal);
      } else if (dailyBudget != null && daysElapsed != null) {
        expected = dailyBudget * BigInt(daysElapsed);
      }
    }
    const account = await (this.prisma as any).adAccount.findFirst({ where: { id: plan.adAccountId, organizationId } }).catch(() => null);
    return {
      published: true, label,
      status: !campaignRows.length ? "no_data" : expected == null ? "no_budget_basis" : "ok",
      budgetMode: cbo ? "cbo" : "abo",
      currency: account?.currency ?? null,
      spentMinor: spent.toString(),
      expectedMinor: expected?.toString() ?? null,
      varianceMinor: expected != null ? (spent - expected).toString() : null,
      dailyBudgetMinor: dailyBudget?.toString() ?? null,
      lifetimeBudgetMinor: lifetimeBudget?.toString() ?? null,
      startDate: start ? start.toISOString() : null,
      endDate: end ? end.toISOString() : null,
      daysElapsed, daysTotal,
      metricRows: campaignRows.length,
    };
  }

  // ---------- Frontier NB8 / CN18: insights & sharing ----------

  /** CN18 simulator floors — spec-pinned constants.
   *  Below either floor the simulator REFUSES: a range
   *  built on one lucky campaign is an invented
   *  benchmark wearing the org's own clothes. */
  static readonly SIM_WINDOW_DAYS = 90;
  static readonly SIM_MIN_CAMPAIGNS = 3;
  static readonly SIM_MIN_CAMPAIGN_DAYS = 21;
  static readonly SIM_METHOD = "নিজের শেষ ৯০ দিনের আসল Campaign Data থেকে হিসাব — Platform-reported Metric-এর Median ও Quartile দিয়ে; কোনো Industry Benchmark, Average বা AI অনুমান নয়";

  /** CN18: the budget simulator. Deterministic arithmetic
   *  ONLY, over the org's OWN last-90-day DailyAdMetric
   *  campaign-level rows for plans of the chosen objective
   *  (the objective lives on the plan; metrics join through
   *  externalCampaignId). Per-campaign CPM/CTR/CPA are
   *  summarised as median + quartiles; the projection is a
   *  RANGE (quartile spread), never a point promise.
   *  Mixed currencies refuse — numbers are never blended
   *  across currencies (the CN8 rule). */
  async budgetSimulator(organizationId: string, dto: { objective: string; dailyBudget: string; days?: number }) {
    const daily = Number(dto.dailyBudget);
    if (!dto.objective || !(OBJECTIVES as readonly string[]).includes(dto.objective)) throw new BadRequestException("A valid plan objective is required");
    if (!Number.isFinite(daily) || daily <= 0) throw new BadRequestException("dailyBudget must be a positive amount (taka)");
    const days = Math.min(90, Math.max(1, Math.floor(dto.days ?? 30) || 30));
    const method = CampaignsService.SIM_METHOD;
    const refuse = (reason: string, sample: { campaigns: number; campaignDays: number }) => ({ available: false, reason, method, windowDays: CampaignsService.SIM_WINDOW_DAYS, objective: dto.objective, sample });
    const p = this.prisma as any;
    const plans = p.campaignPlan?.findMany
      ? await p.campaignPlan.findMany({ where: { organizationId, objective: dto.objective }, take: 500 }).catch(() => [])
      : [];
    const extIds = [...new Set((plans as any[]).map((pl) => pl.externalCampaignId).filter(Boolean))] as string[];
    if (!extIds.length) return refuse("এই Objective-এ কোনো Published Campaign নেই — Simulator-এর জন্য নিজের চলমান Campaign-এর আসল Data লাগে", { campaigns: 0, campaignDays: 0 });
    const since = new Date(Date.now() - CampaignsService.SIM_WINDOW_DAYS * 86400000);
    const rows = p.dailyAdMetric?.findMany
      ? (await p.dailyAdMetric.findMany({ where: { organizationId, campaignExternalId: { in: extIds } }, take: 20000 }).catch(() => []))
        .filter((r: any) => new Date(r.date).getTime() >= since.getTime() && (r.adSetExternalId ?? "") === "" && (r.adExternalId ?? "") === "")
      : [];
    const currencies = [...new Set((rows as any[]).map((r) => String(r.currency ?? "BDT")))];
    type Agg = { spend: bigint; impressions: number; clicks: number; conversions: number; days: Set<string> };
    const byCampaign = new Map<string, Agg>();
    for (const r of rows as any[]) {
      const a = byCampaign.get(r.campaignExternalId) ?? { spend: 0n, impressions: 0, clicks: 0, conversions: 0, days: new Set<string>() };
      a.spend += BigInt(r.spendMinor ?? 0); a.impressions += Number(r.impressions ?? 0);
      a.clicks += Number(r.clicks ?? 0); a.conversions += Number(r.platformConversions ?? r.conversions ?? 0);
      a.days.add(new Date(r.date).toISOString().slice(0, 10));
      byCampaign.set(r.campaignExternalId, a);
    }
    const withData = [...byCampaign.values()].filter((a) => a.impressions > 0);
    const campaignDays = withData.reduce((n, a) => n + a.days.size, 0);
    const sample = { campaigns: withData.length, campaignDays };
    if (currencies.length > 1) return refuse(`একাধিক Currency-র Data মেশানো হয় না (${currencies.join(", ")}) — এক Currency-র Campaign দিয়ে চেষ্টা করুন`, sample);
    if (withData.length < CampaignsService.SIM_MIN_CAMPAIGNS || campaignDays < CampaignsService.SIM_MIN_CAMPAIGN_DAYS) {
      return refuse(`যথেষ্ট নিজস্ব Data নেই — অন্তত ${CampaignsService.SIM_MIN_CAMPAIGNS}টি Campaign ও ${CampaignsService.SIM_MIN_CAMPAIGN_DAYS} Campaign-Day লাগে; পাওয়া গেছে ${withData.length}টি Campaign, ${campaignDays} Campaign-Day`, sample);
    }
    const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
    const median = (xs: number[]) => { const s = sorted(xs); return s[Math.floor((s.length - 1) / 2)]; };
    // Nearest-rank quartiles — deterministic, spec-pinned.
    const quartile = (xs: number[], q: 1 | 3) => { const s = sorted(xs); return s[Math.max(0, Math.ceil((q / 4) * s.length) - 1)]; };
    const cpmMinor = withData.map((a) => (Number(a.spend) * 1000) / a.impressions); // minor per 1000 impressions (float arithmetic on real rows)
    const ctr = withData.map((a) => a.clicks / a.impressions);
    const cpaMinor = withData.filter((a) => a.conversions > 0).map((a) => Number(a.spend) / a.conversions);
    const totalBudgetMinor = Math.round(daily * 100) * days;
    const impressionsFor = (cpm: number) => Math.round((totalBudgetMinor * 1000) / cpm);
    const impLow = impressionsFor(quartile(cpmMinor, 3));
    const impHigh = impressionsFor(quartile(cpmMinor, 1));
    const ctrMed = median(ctr);
    return {
      available: true, method, windowDays: CampaignsService.SIM_WINDOW_DAYS, objective: dto.objective,
      currency: currencies[0] ?? "BDT", sample,
      input: { dailyBudgetTaka: daily, days, totalBudgetMinor: String(totalBudgetMinor) },
      medians: {
        cpmMinor: String(Math.round(median(cpmMinor))),
        ctrPercent: Math.round(ctrMed * 10000) / 100,
        cpaMinor: cpaMinor.length ? String(Math.round(median(cpaMinor))) : null,
      },
      projected: {
        impressions: { low: impLow, high: impHigh },
        clicks: { low: Math.round(impLow * ctrMed), high: Math.round(impHigh * ctrMed) },
        conversions: cpaMinor.length
          ? { low: Math.round(totalBudgetMinor / quartile(cpaMinor, 3)), high: Math.round(totalBudgetMinor / quartile(cpaMinor, 1)) }
          : null,
      },
      note: "এটি পূর্বাভাস নয় — নিজের অতীত Data-র Quartile বিস্তার দিয়ে একটি সম্ভাব্য পরিসর। আসল ফল Campaign, Creative ও বাজারের ওপর নির্ভর করে।",
    };
  }

  /** CN18: a competitor-response DRAFT. The competitor
   *  contributes ONLY the angle/structure, as an input
   *  note built from OUR OWN CompetitorInsight titles
   *  (this platform's analysis text). The competitor's
   *  creative text, notes, links and assets are never
   *  read into the draft — the copy comes from the
   *  existing grounded generateCopy path, which writes
   *  ONLY from the org's own product facts. The result
   *  is an ordinary DRAFT plan (approval flow untouched)
   *  carrying the angle note as a plan comment. */
  async competitorResponseDraft(organizationId: string, actorId: string, dto: { competitorId: string; productId: string; adAccountId: string }) {
    const p = this.prisma as any;
    const competitor = p.competitor?.findFirst
      ? await p.competitor.findFirst({ where: { id: dto.competitorId, organizationId } }).catch(() => null)
      : null;
    if (!competitor) throw new NotFoundException("Competitor not found in this organization");
    const product = p.product?.findFirst
      ? await p.product.findFirst({ where: { id: dto.productId, organizationId } }).catch(() => null)
      : null;
    if (!product) throw new NotFoundException("Product not found in this organization");
    const insights = p.competitorInsight?.findMany
      ? await p.competitorInsight.findMany({ where: { organizationId, competitorId: competitor.id }, take: 50 }).catch(() => [])
      : [];
    const angleTitles = (insights as any[])
      .filter((i) => ["creative", "positioning"].includes(String(i.kind)))
      .map((i) => String(i.title ?? "").trim()).filter(Boolean).slice(0, 3);
    const angleNote = angleTitles.length
      ? angleTitles.join(" · ")
      : "প্রতিযোগীর সক্রিয় বিজ্ঞাপনের কাঠামো ও কোণ (Creative/Positioning Insight এখনো তৈরি হয়নি — সাধারণ কাঠামো ধরা হয়েছে)";
    const plan = await this.createPlan(organizationId, actorId, {
      name: `প্রতিযোগী-প্রতিক্রিয়া খসড়া — ${product.name}`.slice(0, 200),
      objective: "OUTCOME_TRAFFIC", adAccountId: dto.adAccountId,
    });
    const adSet = await this.addAdSet(organizationId, plan.id, {
      name: `Response — ${product.name}`.slice(0, 200),
      dailyBudget: "100", optimizationGoal: "LINK_CLICKS", countries: ["BD"],
    });
    const copy = await this.generateCopy(organizationId, actorId, plan.id, { adSetId: adSet.id, productId: product.id });
    const rule = "প্রতিযোগীর কোনো লেখা, ছবি বা Asset এই খসড়ায় নেই — সব Copy ও Creative শুধু নিজের পণ্যের তথ্য থেকে তৈরি; প্রতিযোগী থেকে নেওয়া হয়েছে শুধু কোণ/কাঠামো (angle), নিচের Note-এ";
    await this.addComment(organizationId, plan.id, actorId,
      `🎯 প্রতিযোগী-প্রতিক্রিয়া খসড়া — "${competitor.name}"-এর কোণ: ${angleNote}\nনিয়ম: ${rule}।`);
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.competitor_response", entityType: "CampaignPlan", entityId: plan.id, metadata: { competitorId: competitor.id, productId: product.id, insightsUsed: angleTitles.length } }).catch(() => undefined);
    return {
      plan: await this.getPlanFull(organizationId, plan.id),
      angleNote, rule, copyProvider: (copy as any)?.provider ?? null,
      note: "এটি একটি সাধারণ DRAFT — Budget (দৈনিক ৳১০০) ও Targeting (BD) শুরুর মান; Publish-এর আগে Builder-এ ঠিক করে নিন। Approval Flow অপরিবর্তিত।",
    };
  }

  /** CN18: the ALLOWLISTED public payload for a campaign
   *  report share — built ONLY from the CB5 totals, CN7
   *  breakdowns and CN2 pacing read-models (windowed).
   *  The allowlist is the contract: plan name/objective,
   *  totals, per-ad-set numbers, breakdown rows, pacing.
   *  No comments, mentions, approval internals, publish
   *  logs or audit data can appear here — the shape is
   *  constructed field by field, never spread from a
   *  plan record. First-party revenue is labelled
   *  association, not attribution (verbatim note). */
  async publicCampaignReport(organizationId: string, planId: string, days: number) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    const to = new Date(); to.setUTCHours(0, 0, 0, 0);
    const since = new Date(to.getTime() - (days - 1) * 86400000);
    const window = { since };
    const [perf, breakdowns, pacing] = await Promise.all([
      this.planPerformance(organizationId, planId, window),
      this.planBreakdowns(organizationId, planId, window),
      this.planPacing(organizationId, planId),
    ]);
    const org = await (this.prisma as any).organization?.findUnique?.({ where: { id: organizationId } }).catch(() => null);
    return {
      kind: "campaign",
      business: org?.name ?? "",
      branding: {
        name: org?.brandName ?? org?.name ?? "",
        logoUrl: org?.logoUrl ?? null,
        primaryColor: org?.primaryColor ?? null,
      },
      generatedAt: new Date().toISOString(),
      days,
      plan: { name: plan.name, objective: plan.objective },
      published: perf.published,
      totals: perf.totals,
      perAdSet: (perf.perAdSet ?? []).map((s: any) => ({
        name: s.name, spendMinor: s.spendMinor, impressions: s.impressions,
        clicks: s.clicks, conversions: s.conversions,
      })),
      daily: perf.daily ?? [],
      breakdowns: breakdowns.dimensions,
      pacing: pacing ? {
        status: pacing.status, budgetMode: pacing.budgetMode, currency: pacing.currency,
        spentMinor: pacing.spentMinor, expectedMinor: pacing.expectedMinor, varianceMinor: pacing.varianceMinor,
        daysElapsed: pacing.daysElapsed, daysTotal: pacing.daysTotal, label: pacing.label,
      } : null,
      note: "Platform-reported conversions come from the ad platforms themselves and can differ from tracked store orders. নিজস্ব অর্ডার ও Revenue এই Campaign-এর সঙ্গে সংশ্লিষ্ট (associated) হিসেবে দেখানো হয়েছে — এটি Attribution Credit-ভিত্তিক সম্পর্ক, প্রমাণিত কার্যকারণ নয়। Costs and profit margins are not part of this client report.",
    };
  }

  /** CB5: promote an A/B winner into a fresh draft.
   *  Uses the existing A/B verdict (all variants must
   *  have CPA data and >= ৳100 spend). The loser is
   *  NOT auto-paused — that stays an explicit action. */
  async promoteWinner(organizationId: string, planId: string, actorId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    if (!plan.abGroupId) throw new BadRequestException("This plan is not part of an A/B test");
    const groups = await this.abTestResults(organizationId);
    const group = groups.find((g: any) => g.groupId === plan.abGroupId);
    if (!group || !group.winnerPlanId) {
      throw new BadRequestException(`No winner yet (verdict: ${group?.verdict ?? "unknown"}) — every variant needs spend and conversion data first`);
    }
    const draft = await this.duplicatePlan(organizationId, actorId, group.winnerPlanId, { name: undefined });
    await (this.prisma as any).campaignPlan.update({
      where: { id: draft.id },
      data: { name: `${(draft as any).name.replace(/ \(কপি\)$/, "")} — বিজয়ী সংস্করণ` },
    }).catch(() => undefined);
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.winner_promoted", entityType: "CampaignPlan", entityId: draft.id, metadata: { winnerPlanId: group.winnerPlanId, groupId: plan.abGroupId } }).catch(() => undefined);
    return this.getPlanFull(organizationId, draft.id);
  }

  /** CB5: schedule (or clear) the launch of an
   *  APPROVED plan. The scan below performs it. */
  async scheduleLaunch(organizationId: string, planId: string, actorId: string, publishAt: string | null) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    if (publishAt === null) {
      await (this.prisma as any).campaignPlan.update({ where: { id: planId }, data: { publishAt: null } });
      await this.audit.log({ organizationId, userId: actorId, action: "campaign.launch_unscheduled", entityType: "CampaignPlan", entityId: planId }).catch(() => undefined);
      return this.getPlanFull(organizationId, planId);
    }
    if (plan.status !== "approved") throw new BadRequestException(`Only approved plans can be scheduled to launch (current: ${plan.status})`);
    const when = new Date(publishAt);
    if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() + 30_000) {
      throw new BadRequestException("Launch time must be at least 30 seconds in the future");
    }
    await (this.prisma as any).campaignPlan.update({ where: { id: planId }, data: { publishAt: when } });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.launch_scheduled", entityType: "CampaignPlan", entityId: planId, metadata: { publishAt: when.toISOString() } }).catch(() => undefined);
    return this.getPlanFull(organizationId, planId);
  }

  /** CB5: the launch scan (5-minute interval, leader
   *  claimed). Claims each due plan by clearing
   *  publishAt first — exactly one attempt per
   *  schedule; the outcome is recorded either way and
   *  the creator is notified. */
  async scanScheduledLaunches(now = new Date()) {
    const p = this.prisma as any;
    if (!p.campaignPlan?.findMany) return { launched: 0, failed: 0, skipped: 0 };
    const due = await p.campaignPlan.findMany({
      where: { publishAt: { lte: now, not: null } }, take: 20,
    }).catch(() => []);
    let launched = 0; let failed = 0; let skipped = 0;
    for (const plan of due as any[]) {
      const claimed = await p.campaignPlan.updateMany({
        where: { id: plan.id, publishAt: { lte: now, not: null } }, data: { publishAt: null },
      }).catch(() => ({ count: 0 }));
      if (!claimed || claimed.count === 0) continue;
      if (plan.status !== "approved") {
        skipped++;
        await this.audit.log({ organizationId: plan.organizationId, userId: plan.createdById, action: "campaign.launch_skipped", entityType: "CampaignPlan", entityId: plan.id, metadata: { reason: `status_${plan.status}` } }).catch(() => undefined);
        continue;
      }
      try {
        await this.publish(plan.organizationId, plan.createdById, plan.id);
        launched++;
        await this.notifyUsers(plan.organizationId, [plan.createdById], "campaign_launched", "🚀 নির্ধারিত Campaign প্রকাশ হয়েছে", `"${plan.name}" নির্ধারিত সময়ে Meta তে Publish হয়েছে (PAUSED) — Builder থেকে সক্রিয় করুন।`);
      } catch (e) {
        failed++;
        await this.audit.log({ organizationId: plan.organizationId, userId: plan.createdById, action: "campaign.launch_failed", entityType: "CampaignPlan", entityId: plan.id, metadata: { error: e instanceof Error ? e.message.slice(0, 200) : "error" } }).catch(() => undefined);
        await this.notifyUsers(plan.organizationId, [plan.createdById], "campaign_launch_failed", "⚠️ নির্ধারিত Launch ব্যর্থ", `"${plan.name}" প্রকাশ করা যায়নি — Builder এ Publish আবার চেষ্টা করুন।`);
      }
    }
    return { launched, failed, skipped };
  }

  // ---------- NB4 / CN7: the optimisation loop, in the builder ----------

  /** CN7 thresholds — named constants, stated wherever the
   * recommendations surface. DEAD: an ad set that spent at
   * least ৳500 (50000 minor) with zero platform conversions.
   * WINNER: the CB5 A/B eligibility floor (৳100 spend) before
   * a CPA is trusted for a budget-shift proposal. SHIFT: a
   * proposal moves 20% of the donor's daily budget — it is a
   * number for a human to apply, never an applied change. */
  static readonly DEAD_AD_SET_SPEND_MINOR = 50000n;
  static readonly WINNER_MIN_SPEND_MINOR = 10000n;
  static readonly BUDGET_SHIFT_PERCENT = 20;

  /** CN7: demographic / placement / device breakdowns for one
   * plan, read from the EXISTING DailyAdBreakdown rows the Ads
   * sync already stores (dimensions age_gender | placement |
   * device | region | hourly, keyed by campaign). age_gender
   * is additionally split into age and gender views from the
   * same keys ("25-34:male"). No second sync, no estimation:
   * a dimension with no rows reports hasData=false. */
  async planBreakdowns(organizationId: string, planId: string, window?: { since: Date }) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    const empty = () => ({ hasData: false, rows: [] as any[] });
    const dimensions: Record<string, { hasData: boolean; rows: any[] }> = {
      age: empty(), gender: empty(), age_gender: empty(), placement: empty(), device: empty(),
    };
    if (!plan.externalCampaignId) return { published: false, dimensions };
    const p = this.prisma as any;
    const rows = (p.dailyAdBreakdown?.findMany
      ? await p.dailyAdBreakdown.findMany({ where: { organizationId, campaignExternalId: plan.externalCampaignId }, take: 20000 }).catch(() => [])
      : []).filter((r: any) => !window || new Date(r.date).getTime() >= window.since.getTime());
    type Agg = { spend: bigint; impressions: number; clicks: number; conversions: number };
    const acc = new Map<string, Map<string, Agg>>();
    const add = (dim: string, key: string, r: any) => {
      if (!acc.has(dim)) acc.set(dim, new Map());
      const m = acc.get(dim)!;
      const a = m.get(key) ?? { spend: 0n, impressions: 0, clicks: 0, conversions: 0 };
      a.spend += BigInt(r.spendMinor ?? 0); a.impressions += Number(r.impressions ?? 0);
      a.clicks += Number(r.clicks ?? 0); a.conversions += Number(r.platformConversions ?? r.conversions ?? 0);
      m.set(key, a);
    };
    for (const r of rows as any[]) {
      add(String(r.dimension), String(r.key), r);
      if (r.dimension === "age_gender") {
        const [age, gender] = String(r.key).split(":");
        add("age", age || "unknown", r);
        add("gender", gender || "unknown", r);
      }
    }
    for (const [dim, m] of acc.entries()) {
      const out = [...m.entries()].map(([key, a]) => ({
        key,
        spendMinor: a.spend.toString(), impressions: a.impressions, clicks: a.clicks, conversions: a.conversions,
        ctrPercent: a.impressions > 0 ? Math.round((a.clicks / a.impressions) * 10000) / 100 : null,
        cpaMinor: a.conversions > 0 ? (a.spend / BigInt(a.conversions)).toString() : null,
      })).sort((x, y) => Number(BigInt(y.spendMinor) - BigInt(x.spendMinor)));
      dimensions[dim] = { hasData: out.length > 0, rows: out };
    }
    return { published: true, dimensions };
  }

  /** CN7: per-ad creative leaderboard + fatigue for THIS
   * plan's ads, computed by the ONE shared Phase-K helper
   * (ads/creative-fatigue.ts) over the plan's own synced
   * ad-level rows — the same numbers the Ads page shows,
   * never a second definition. Ads with no synced rows are
   * listed with hasData=false instead of invented zeros. */
  async planCreativeInsights(organizationId: string, planId: string, days = 14) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    const rule = "fatigued = frequency >= 3.5 AND CTR drop >= 30% vs the previous equal window (Phase K)";
    if (!plan.externalCampaignId) return { published: false, days, rule, ads: [] as any[] };
    const full = await this.getPlanFull(organizationId, planId);
    const now = new Date();
    const prevSince = new Date(now.getTime() - 2 * days * 86400000);
    const rows = await (this.prisma as any).dailyAdMetric.findMany({
      where: { organizationId, campaignExternalId: plan.externalCampaignId, source: "meta", date: { gte: prevSince } }, take: 20000,
    }).catch(() => []);
    const computed = computeCreativeLeaderboard(rows as any[], days, now);
    const byExt = new Map(computed.ads.map((a) => [a.adExternalId, a]));
    const ads: any[] = [];
    for (const s of full.adSets ?? []) {
      for (const ad of s.ads ?? []) {
        if (!ad.externalAdId) continue;
        const hit = byExt.get(String(ad.externalAdId));
        ads.push({
          adId: ad.id, adSetId: s.id, name: ad.name, externalAdId: ad.externalAdId,
          hasData: Boolean(hit),
          spendMinor: hit?.spendMinor ?? "0", impressions: hit?.impressions ?? 0,
          clicks: hit?.clicks ?? 0, conversions: hit?.conversions ?? 0,
          ctrPercent: hit?.ctrPercent ?? null, frequency: hit?.frequency ?? null,
          cpaMinor: hit?.cpaMinor ?? null, ctrDropPercent: hit?.ctrDropPercent ?? null,
          fatigued: hit?.fatigued ?? false, fatigueReasons: hit?.fatigueReasons ?? [],
        });
      }
    }
    ads.sort((x, y) => Number(BigInt(y.spendMinor) - BigInt(x.spendMinor)));
    return { published: true, days, rule, ads };
  }

  /** CN7: deterministic recommendations from the plan's real
   * synced rows. This endpoint MUTATES NOTHING — it returns
   * proposals with their evidence; each action names the
   * existing explicit path a human uses to apply it. */
  async planRecommendations(organizationId: string, planId: string) {
    const thresholds = {
      deadAdSetSpendMinor: CampaignsService.DEAD_AD_SET_SPEND_MINOR.toString(),
      winnerMinSpendMinor: CampaignsService.WINNER_MIN_SPEND_MINOR.toString(),
      budgetShiftPercent: CampaignsService.BUDGET_SHIFT_PERCENT,
    };
    const perf = await this.planPerformance(organizationId, planId);
    if (!perf.published || !perf.totals) return { published: false, label: "deterministic_heuristics_from_synced_rows", thresholds, recommendations: [] as any[] };
    const recommendations: any[] = [];

    const insights = await this.planCreativeInsights(organizationId, planId);
    for (const ad of insights.ads) {
      if (!ad.fatigued) continue;
      recommendations.push({
        type: "fatigued_creative",
        adId: ad.adId, adSetId: ad.adSetId, name: ad.name,
        evidence: { frequency: ad.frequency, ctrDropPercent: ad.ctrDropPercent, spendMinor: ad.spendMinor, impressions: ad.impressions, fatigueReasons: ad.fatigueReasons },
        action: { kind: "create_fresh_draft", note: "এক ক্লিকে Plan-এর একটি নতুন DRAFT কপি তৈরি হবে — সেখানে এই Ad-এর Creative বদলে দিন। Live Ad-এ কিছুই বদলায় না।" },
      });
    }

    for (const s of perf.perAdSet) {
      if (BigInt(s.spendMinor) >= CampaignsService.DEAD_AD_SET_SPEND_MINOR && s.conversions === 0) {
        recommendations.push({
          type: "dead_ad_set",
          adSetId: s.adSetId, name: s.name,
          evidence: { spendMinor: s.spendMinor, impressions: s.impressions, clicks: s.clicks, conversions: 0 },
          action: { kind: "pause_ad_set", via: "ad_set_status", note: "Pause শুধু আপনার স্পষ্ট ক্লিকেই হবে — Ad Set-এর Pause বোতাম (বিদ্যমান পথ) দিয়ে।" },
        });
      }
    }

    // Budget-shift proposal (ABO only — a CBO plan has no
    // per-ad-set budgets to shift between).
    const full = await this.getPlanFull(organizationId, planId);
    if (!this.isCbo(full)) {
      const byId = new Map<string, any>((full.adSets ?? []).map((s: any) => [s.id, s] as [string, any]));
      const scored = (perf.perAdSet as any[])
        .map((s: any) => ({ ...s, daily: byId.get(s.adSetId)?.dailyBudgetMinor != null ? BigInt(byId.get(s.adSetId).dailyBudgetMinor) : null }))
        .filter((s: any) => s.daily !== null && s.daily > 0n && BigInt(s.spendMinor) > 0n);
      const winners = scored.filter((s: any) => s.conversions > 0 && BigInt(s.spendMinor) >= CampaignsService.WINNER_MIN_SPEND_MINOR);
      if (winners.length) {
        const cpa = (s: any) => BigInt(s.spendMinor) / BigInt(s.conversions);
        const winner = [...winners].sort((a: any, b: any) => Number(cpa(a) - cpa(b)))[0];
        const donors = scored.filter((s: any) => s.adSetId !== winner.adSetId);
        const donor = [...donors].sort((a: any, b: any) => {
          const ca = a.conversions > 0 ? cpa(a) : null; const cb = b.conversions > 0 ? cpa(b) : null;
          if (ca === null && cb === null) return Number(BigInt(b.spendMinor) - BigInt(a.spendMinor));
          if (ca === null) return -1; // zero-conversion spender is the weakest donor first
          if (cb === null) return 1;
          return Number(cb - ca);
        })[0];
        if (donor) {
          const donorDaily = donor.daily as bigint; const winnerDaily = winner.daily as bigint;
          let shift = (donorDaily * BigInt(CampaignsService.BUDGET_SHIFT_PERCENT)) / 100n;
          if (winnerDaily > 0n && shift > winnerDaily) shift = winnerDaily;
          if (shift > 0n) {
            recommendations.push({
              type: "budget_shift",
              evidence: {
                winnerAdSetId: winner.adSetId, winnerName: winner.name, winnerCpaMinor: cpa(winner).toString(), winnerConversions: winner.conversions, winnerSpendMinor: winner.spendMinor,
                donorAdSetId: donor.adSetId, donorName: donor.name, donorCpaMinor: donor.conversions > 0 ? cpa(donor).toString() : null, donorConversions: donor.conversions, donorSpendMinor: donor.spendMinor,
              },
              proposal: {
                fromAdSetId: donor.adSetId, toAdSetId: winner.adSetId, shiftMinor: shift.toString(),
                fromDailyAfterMinor: (donorDaily - shift).toString(), toDailyAfterMinor: (winnerDaily + shift).toString(),
              },
              action: { kind: "budget_shift_proposal", applyVia: "live_budget_edit", note: "এটি শুধু প্রস্তাব — প্রয়োগ করতে Ad Set-এর বিদ্যমান Live Budget Edit ব্যবহার করুন। কিছুই নিজে থেকে বদলায়নি।" },
            });
          }
        }
      }
    }
    return { published: true, label: "deterministic_heuristics_from_synced_rows", thresholds, recommendations };
  }

  /** CN7: apply the ONE recommendation kind that is safe to
   * execute from here — creating a fresh DRAFT copy of the
   * plan (the CB5 promote-the-winner pattern). Budget shifts
   * and pauses deliberately refuse here: they go through
   * their existing explicit paths, named in the refusal. */
  async applyRecommendation(organizationId: string, actorId: string, planId: string, dto: { kind: string; adId?: string }) {
    if (dto.kind !== "create_fresh_draft") {
      throw new BadRequestException("এই সুপারিশ এখান থেকে প্রয়োগ হয় না — Budget Shift-এর জন্য Live Budget Edit, Pause-এর জন্য Ad Set Pause বোতাম ব্যবহার করুন (দুটোই বিদ্যমান স্পষ্ট পথ)।");
    }
    const full = await this.getPlanFull(organizationId, planId);
    const ad = (full.adSets ?? []).flatMap((s: any) => (s.ads ?? []).map((a: any) => ({ ...a, adSetId: s.id }))).find((a: any) => a.id === dto.adId);
    if (!ad) throw new BadRequestException("Ad টি এই Plan-এ পাওয়া যায়নি");
    const draft = await this.duplicatePlan(organizationId, actorId, planId, { name: `${full.name} — Fresh Creative Draft` });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.fresh_draft_from_recommendation", entityType: "CampaignPlan", entityId: (draft as any).id, metadata: { sourcePlanId: planId, fatiguedAdId: ad.id, fatiguedAdName: ad.name } }).catch(() => undefined);
    return { draftId: (draft as any).id, plan: draft, note: "নতুন DRAFT তৈরি হয়েছে — ওই Draft-এ ক্লান্ত Ad-টির Creative বদলে তারপর স্বাভাবিক Approval পথে যান। Live Campaign অপরিবর্তিত।" };
  }

  /** CN7: automation guardrails as seen from a plan. The
   * rules engine is UNCHANGED — AutomationRule.campaignPlanId
   * is its existing linkage (null = the rule covers every
   * published plan of the org). Attach narrows a rule to this
   * plan; detach returns it to org-wide. Both semantics are
   * stated exactly, in the UI and here, because null does NOT
   * mean "applies nowhere". Last firing evidence comes from
   * the rule's own AutomationRun rows + its timestamps. */
  async planGuardrails(organizationId: string, planId: string) {
    await this.getPlanOrThrow(organizationId, planId);
    const p = this.prisma as any;
    const rules = p.automationRule?.findMany
      ? await p.automationRule.findMany({ where: { organizationId } }).catch(() => [])
      : [];
    const shape = async (r: any, scope: string) => {
      let lastRun: any = null;
      if (p.automationRun?.findMany) {
        const runs = await p.automationRun.findMany({ where: { organizationId, kind: "rule", refId: r.id } }).catch(() => []);
        const sorted = [...(runs ?? [])].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const run = sorted[0];
        if (run) lastRun = { status: run.status, detail: run.detail ?? null, evidence: run.evidence ?? null, createdAt: run.createdAt };
      }
      return {
        id: r.id, name: r.name, metric: r.metric, comparator: r.comparator, threshold: r.threshold,
        windowDays: r.windowDays, action: r.action, actionConfig: r.actionConfig ?? null,
        enabled: r.enabled, scope, lastEvaluatedAt: r.lastEvaluatedAt ?? null,
        lastTriggeredAt: r.lastTriggeredAt ?? null, lastRun,
      };
    };
    const linked: any[] = []; const orgWide: any[] = [];
    for (const r of rules as any[]) {
      if (r.campaignPlanId === planId) linked.push(await shape(r, "plan"));
      else if (r.campaignPlanId == null) orgWide.push(await shape(r, "org_wide"));
    }
    return { linked, orgWide };
  }

  async attachGuardrail(organizationId: string, actorId: string, planId: string, ruleId: string) {
    await this.getPlanOrThrow(organizationId, planId);
    const p = this.prisma as any;
    const rule = p.automationRule?.findFirst ? await p.automationRule.findFirst({ where: { id: ruleId, organizationId } }).catch(() => null) : null;
    if (!rule) throw new NotFoundException("Automation rule not found in this organization");
    await p.automationRule.update({ where: { id: ruleId }, data: { campaignPlanId: planId } });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.guardrail_attached", entityType: "CampaignPlan", entityId: planId, metadata: { ruleId, ruleName: rule.name, note: "rule narrowed to this plan only" } }).catch(() => undefined);
    return this.planGuardrails(organizationId, planId);
  }

  async detachGuardrail(organizationId: string, actorId: string, planId: string, ruleId: string) {
    await this.getPlanOrThrow(organizationId, planId);
    const p = this.prisma as any;
    const rule = p.automationRule?.findFirst ? await p.automationRule.findFirst({ where: { id: ruleId, organizationId } }).catch(() => null) : null;
    if (!rule) throw new NotFoundException("Automation rule not found in this organization");
    if (rule.campaignPlanId !== planId) throw new BadRequestException("এই Rule টি এই Plan-এ যুক্ত নয়");
    await p.automationRule.update({ where: { id: ruleId }, data: { campaignPlanId: null } });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.guardrail_detached", entityType: "CampaignPlan", entityId: planId, metadata: { ruleId, ruleName: rule.name, note: "rule returned to org-wide (applies to all published plans)" } }).catch(() => undefined);
    return this.planGuardrails(organizationId, planId);
  }

  // ---------- NB4 / CN8: multi-account & portfolio ----------

  /** CN8: ad accounts with their health as THIS tree knows
   * it — the AD package's own records (integration link =
   * API connection, platformStatusBucket from the platform's
   * verbatim status). A bucket that was never reported stays
   * "unknown"; nothing here calls a platform. (Connect
   * Center's provider-health rows live in another worktree;
   * at integration this reads the same AdAccount fields.) */
  async accountsHealth(organizationId: string) {
    const accounts = await (this.prisma as any).adAccount.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } }).catch(() => []);
    return (accounts as any[]).map((a) => ({
      id: a.id, name: a.name, platform: a.platform, externalId: a.externalId ?? null,
      currency: a.currency ?? null, status: a.status ?? null, label: a.label ?? null,
      health: {
        connection: a.integrationId ? "api" : "none",
        platformStatusBucket: a.platformStatusBucket ?? "unknown",
        platformStatusRaw: a.platformStatusRaw ?? null,
        platformStatusCheckedAt: a.platformStatusCheckedAt ?? null,
        syncDisabled: a.syncDisabled === true,
      },
    }));
  }

  /** CN8: org portfolio totals from DailyAdMetric
   * campaign-level rows only (ad-set/ad rows would
   * double-count — the CB5 semantics), grouped per ad
   * account. Currencies are NEVER mixed: org totals are
   * reported per currency. Platform-reported figures,
   * kept separate from first-party attribution as always. */
  async portfolioTotals(organizationId: string) {
    const p = this.prisma as any;
    const rows = await p.dailyAdMetric.findMany({ where: { organizationId }, take: 20000 }).catch(() => []);
    const accounts = await p.adAccount.findMany({ where: { organizationId } }).catch(() => []);
    const accById = new Map((accounts as any[]).map((a) => [a.id, a]));
    type Agg = { spend: bigint; impressions: number; clicks: number; conversions: number };
    const perAccount = new Map<string, Agg>();
    for (const r of rows as any[]) {
      if ((r.adSetExternalId ?? "") !== "" || (r.adExternalId ?? "") !== "") continue;
      const a = perAccount.get(r.adAccountId) ?? { spend: 0n, impressions: 0, clicks: 0, conversions: 0 };
      a.spend += BigInt(r.spendMinor ?? 0); a.impressions += Number(r.impressions ?? 0);
      a.clicks += Number(r.clicks ?? 0); a.conversions += Number(r.platformConversions ?? r.conversions ?? 0);
      perAccount.set(r.adAccountId, a);
    }
    const byCurrency = new Map<string, Agg>();
    const accountRows = [...perAccount.entries()].map(([adAccountId, a]) => {
      const acc = accById.get(adAccountId);
      const currency = acc?.currency ?? "BDT";
      const t = byCurrency.get(currency) ?? { spend: 0n, impressions: 0, clicks: 0, conversions: 0 };
      t.spend += a.spend; t.impressions += a.impressions; t.clicks += a.clicks; t.conversions += a.conversions;
      byCurrency.set(currency, t);
      return {
        adAccountId, name: acc?.name ?? adAccountId, platform: acc?.platform ?? null, currency,
        spendMinor: a.spend.toString(), impressions: a.impressions, clicks: a.clicks, conversions: a.conversions,
        cpaMinor: a.conversions > 0 ? (a.spend / BigInt(a.conversions)).toString() : null,
      };
    }).sort((x, y) => Number(BigInt(y.spendMinor) - BigInt(x.spendMinor)));
    return {
      label: "platform_reported_daily_ad_metric",
      accounts: accountRows,
      totalByCurrency: [...byCurrency.entries()].map(([currency, a]) => ({
        currency, spendMinor: a.spend.toString(), impressions: a.impressions, clicks: a.clicks, conversions: a.conversions,
      })),
    };
  }

  /** CN8: clone a plan into ANOTHER Meta ad account of the
   * same org, with a mapping report. An id carries over ONLY
   * when verified present in the target account's context
   * from our own records, or when the caller explicitly
   * re-picks it in `resolutions` (marked user_confirmed).
   * Everything else is DROPPED from the clone and listed as
   * a blocker — never silently carried. Verification bases:
   *  - page: an org SocialAccount (meta_page, connected)
   *    with that external id (pages are org-scoped records).
   *  - pixel: a prior ad set of a TARGET-account plan using
   *    the same pixel, or the org CAPI setting's pixel.
   *  - audience: an AudienceRecord of the TARGET account,
   *    status ready, with that external id.
   *  - catalog/product set/lead form: business/page-scoped —
   *    our records cannot verify target-account access, so
   *    they carry ONLY via explicit re-pick (validated with
   *    the CN3/CN4 save rules); the form additionally needs
   *    its page to be the carried/resolved page.
   * The clone is a fresh DRAFT (approval spine unchanged);
   * blockers make it incomplete, and validatePlan gates any
   * later submit exactly as for a hand-built draft. */
  async clonePlanToAccount(organizationId: string, actorId: string, planId: string, dto: {
    targetAdAccountId: string; name?: string;
    resolutions?: {
      pageId?: string; pixelId?: string; catalogRecordId?: string; productSetId?: string; leadFormId?: string;
      audienceReplacements?: Record<string, string>;
    };
  }) {
    const source = await this.getPlanFull(organizationId, planId);
    const target = await (this.prisma as any).adAccount.findFirst({ where: { id: dto.targetAdAccountId, organizationId } });
    if (!target) throw new NotFoundException("Target ad account not found in this organization");
    if (target.platform !== "meta") throw new BadRequestException("Cross-account clone supports Meta ad accounts only — Google/TikTok যাওয়ার পথ Cross-Platform Draft (CB6/CN9)");
    if (target.id === source.adAccountId) throw new BadRequestException("Target account টি Source-এর একই — একই Account-এ কপি চাইলে Duplicate ব্যবহার করুন");
    const p = this.prisma as any;
    const res = dto.resolutions ?? {};

    // Verification evidence, loaded once.
    const pages = p.socialAccount?.findMany ? await p.socialAccount.findMany({ where: { organizationId, platform: "meta_page" } }).catch(() => []) : [];
    const connectedPages = new Set((pages as any[]).filter((s) => s.status === "connected").map((s) => String(s.externalId)));
    const targetPlans = await p.campaignPlan.findMany({ where: { organizationId, adAccountId: target.id } }).catch(() => []);
    const targetPlanIds = [...(targetPlans as any[]).map((pl: any) => pl.id)];
    const targetSets = targetPlanIds.length
      ? (await p.campaignAdSet.findMany({ where: { planId: { in: targetPlanIds } } }).catch(() => [])) as any[]
      : [];
    const targetPixels = new Set(targetSets.filter((s) => s.pixelId).map((s) => String(s.pixelId)));
    const capi = p.conversionApiSetting?.findFirst ? await p.conversionApiSetting.findFirst({ where: { organizationId } }).catch(() => null) : null;
    const audRecords = p.audienceRecord?.findMany ? await p.audienceRecord.findMany({ where: { organizationId, adAccountId: target.id } }).catch(() => []) : [];
    const readyAudiences = new Set((audRecords as any[]).filter((a) => a.status === "ready" && a.externalAudienceId).map((a) => String(a.externalAudienceId)));

    const mapping: any[] = [];
    const blockers: string[] = [];
    const note = (adSetName: string, field: string, outcome: string, detail: string) => {
      mapping.push({ adSet: adSetName, field, outcome, detail });
      if (outcome === "dropped_blocker") blockers.push(`${adSetName} · ${field}: ${detail}`);
    };

    const clone = await p.campaignPlan.create({
      data: {
        organizationId, adAccountId: target.id,
        name: dto.name ?? `${source.name} (কপি — ${target.name})`,
        objective: source.objective, status: "draft", isTemplate: false, createdById: actorId,
        advantagePlus: source.advantagePlus === true,
        budgetMode: source.budgetMode ?? "abo",
        campaignDailyBudgetMinor: source.campaignDailyBudgetMinor != null ? BigInt(source.campaignDailyBudgetMinor) : undefined,
        campaignLifetimeBudgetMinor: source.campaignLifetimeBudgetMinor != null ? BigInt(source.campaignLifetimeBudgetMinor) : undefined,
        dailyBudgetCapMinor: source.dailyBudgetCapMinor != null ? BigInt(source.dailyBudgetCapMinor) : undefined,
      },
    });

    for (const s of source.adSets ?? []) {
      // --- page ---
      let pageId: string | undefined;
      if (s.pageId) {
        if (connectedPages.has(String(s.pageId))) { pageId = s.pageId; note(s.name, "pageId", "carried_verified", `Page ${s.pageId} — সংযুক্ত Meta Page হিসেবে পাওয়া গেছে`); }
        else if (res.pageId) { pageId = res.pageId; note(s.name, "pageId", "carried_user_confirmed", `আপনার বাছাই করা Page ${res.pageId} বসানো হয়েছে`); }
        else note(s.name, "pageId", "dropped_blocker", `Page ${s.pageId} এই Organization-এর সংযুক্ত Page তালিকায় নেই — Clone-এ বাদ দেওয়া হয়েছে, নতুন Page বেছে দিন`);
      }
      // --- pixel ---
      let pixelId: string | undefined;
      if (s.pixelId) {
        if (targetPixels.has(String(s.pixelId))) { pixelId = s.pixelId; note(s.name, "pixelId", "carried_verified", `Pixel ${s.pixelId} — Target Account-এর আগের Plan-এ ব্যবহৃত হয়েছে`); }
        else if (capi?.pixelId && String(capi.pixelId) === String(s.pixelId)) { pixelId = s.pixelId; note(s.name, "pixelId", "carried_verified", `Pixel ${s.pixelId} — Organization-এর CAPI সেটআপের Pixel`); }
        else if (res.pixelId) { pixelId = res.pixelId; note(s.name, "pixelId", "carried_user_confirmed", `আপনার বাছাই করা Pixel ${res.pixelId} বসানো হয়েছে`); }
        else note(s.name, "pixelId", "dropped_blocker", `Pixel ${s.pixelId} Target Account-এ যাচাই করা যায়নি — Clone-এ বাদ, Pixel আবার বেছে দিন`);
      }
      // --- audiences (targeting ids) ---
      const targeting: any = { ...(s.targeting ?? {}) };
      const mapAudienceList = (ids: any, field: string): string[] | undefined => {
        if (!Array.isArray(ids)) return undefined;
        const out: string[] = [];
        for (const raw of ids) {
          const id = typeof raw === "string" ? raw : raw?.id;
          if (!id) { out.push(raw); continue; }
          const key = String(id);
          if (readyAudiences.has(key)) { out.push(raw); note(s.name, field, "carried_verified", `Audience ${key} — Target Account-এ ready রেকর্ড আছে`); }
          else if (res.audienceReplacements?.[key]) {
            const repl = String(res.audienceReplacements[key]);
            if (readyAudiences.has(repl)) { out.push(typeof raw === "string" ? repl : { ...raw, id: repl }); note(s.name, field, "carried_user_confirmed", `Audience ${key} → ${repl} (আপনার Replacement, Target-এ ready)`); }
            else note(s.name, field, "dropped_blocker", `Replacement Audience ${repl} Target Account-এ ready নয় — বাদ দেওয়া হয়েছে`);
          } else note(s.name, field, "dropped_blocker", `Audience ${key} Target Account-এ ready রেকর্ড নেই — বাদ দেওয়া হয়েছে, Audience আবার বেছে দিন`);
        }
        return out;
      };
      const incl = mapAudienceList(targeting.customAudienceIds, "customAudienceIds");
      if (incl !== undefined) targeting.customAudienceIds = incl;
      const excl = mapAudienceList(targeting.excludedAudienceIds, "excludedAudienceIds");
      if (excl !== undefined) targeting.excludedAudienceIds = excl;

      // --- catalog pair (re-pick only, CN3 save rules) ---
      let catalogRecordId: string | undefined; let productSetId: string | undefined;
      if (s.catalogRecordId || s.productSetId) {
        if (res.catalogRecordId && res.productSetId) {
          const cat = p.catalogRecord?.findFirst ? await p.catalogRecord.findFirst({ where: { id: res.catalogRecordId, organizationId } }).catch(() => null) : null;
          const set = p.productSet?.findFirst ? await p.productSet.findFirst({ where: { id: res.productSetId } }).catch(() => null) : null;
          if (cat && set && set.catalogRecordId === cat.id && set.status === "created" && set.externalSetId) {
            catalogRecordId = cat.id; productSetId = set.id;
            note(s.name, "catalog", "carried_user_confirmed", `আপনার বাছাই করা Catalog/Set বসানো হয়েছে (Meta-তে তৈরি সেট)`);
          } else note(s.name, "catalog", "dropped_blocker", "বাছাই করা Catalog/Product Set যাচাইয়ে পাস করেনি (Org-এর নয় / Set Catalog-এর নয় / Meta-তে তৈরি নয়) — বাদ দেওয়া হয়েছে");
        } else note(s.name, "catalog", "dropped_blocker", "Catalog + Product Set Target Account-এ যাচাইযোগ্য নয় (Business-স্কোপড) — Clone-এ বাদ; আবার বেছে দিলে (resolutions) বসবে");
      }
      // --- lead form (page-scoped) ---
      let leadFormId: string | undefined;
      if (s.leadFormId) {
        const form = (s as any).__leadForm ?? null;
        const wanted = res.leadFormId ?? s.leadFormId;
        const f = wanted === s.leadFormId ? form : (p.leadForm?.findFirst ? await p.leadForm.findFirst({ where: { id: wanted, organizationId } }).catch(() => null) : null);
        if (f && pageId && String(f.pageId) === String(pageId)) {
          leadFormId = f.id;
          note(s.name, "leadFormId", wanted === s.leadFormId ? "carried_verified" : "carried_user_confirmed", `Form "${f.name}" — Page ${f.pageId} মিলেছে`);
        } else note(s.name, "leadFormId", "dropped_blocker", "Lead Form টি Clone-এর Page-এর নয় বা পাওয়া যায়নি — বাদ দেওয়া হয়েছে, Form আবার যুক্ত করুন");
      }

      const newSet = await p.campaignAdSet.create({
        // NB5: the shared copy helper carries every field;
        // the clone's resolved/mapped values (verified,
        // user-confirmed, or dropped-as-undefined) are the
        // overrides — mapping/blocker behaviour unchanged.
        data: this.adSetCopyData(clone.id, s, { pageId, pixelId, targeting, catalogRecordId, productSetId, leadFormId }),
      });
      for (const ad of s.ads ?? []) {
        await p.campaignAd.create({
          data: this.adCopyData(newSet.id, ad),
        });
      }
    }
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.cloned_to_account", entityType: "CampaignPlan", entityId: clone.id, metadata: { sourcePlanId: planId, targetAdAccountId: target.id, blockers: blockers.length } }).catch(() => undefined);
    const full = await this.getPlanFull(organizationId, clone.id);
    return { plan: full, targetAccount: { id: target.id, name: target.name }, mapping, blockers };
  }

  /**
   * CB6: cross-platform draft from an APPROVED plan,
   * through the EXISTING Google/TikTok publish paths
   * (which create everything PAUSED). The mapping is
   * mechanical (headline 30 / description 90 / text
   * 100 char slices — each listed as a transformation);
   * anything that cannot be mapped is listed and the
   * platform call is NOT made — the caller gets the
   * export package (the mapped payload + what is
   * missing) instead of a fake success.
   */
  async crossPlatformDraft(organizationId: string, planId: string, actorId: string, dto: { platform: string; targetAdAccountId: string; kind?: string; objectiveType?: string; pixelId?: string; optimizationEvent?: string }) {
    if (!["google", "tiktok"].includes(dto.platform)) throw new BadRequestException("platform must be google or tiktok");
    // Frontier NB8 / CN17: a Google draft is a Search RSA
    // draft (the CN9 default) or a Performance Max draft
    // (kind "pmax", riding PublishingService.publishGooglePmax).
    // A TikTok draft may carry an objective choice — the
    // plan/draft path ONLY; the direct publishing page is
    // untouched and keeps its TRAFFIC behaviour.
    const kind = dto.platform === "google" ? (dto.kind ?? "search") : null;
    if (kind !== null && !["search", "pmax"].includes(kind)) throw new BadRequestException("google draft kind must be search or pmax");
    const tiktokObjective = dto.platform === "tiktok" ? (String(dto.objectiveType ?? "TRAFFIC").trim().toUpperCase() || "TRAFFIC") : null;
    if (tiktokObjective !== null && !["TRAFFIC", "WEB_CONVERSIONS", "LEAD_GENERATION"].includes(tiktokObjective)) {
      throw new BadRequestException("tiktok objectiveType must be TRAFFIC, WEB_CONVERSIONS or LEAD_GENERATION");
    }
    if (!this.publishing) throw new BadRequestException("Cross-platform publishing is not available in this context");
    const plan = await this.getPlanOrThrow(organizationId, planId);
    if (!["approved", "published", "publish_failed"].includes(plan.status)) {
      throw new BadRequestException(`Cross-platform drafts need an approved plan (current: ${plan.status})`);
    }
    const account = await (this.prisma as any).adAccount.findFirst({ where: { id: dto.targetAdAccountId, organizationId } });
    if (!account) throw new BadRequestException("Target ad account not found in this organization");
    if (account.platform !== dto.platform) throw new BadRequestException(`Target account is a ${account.platform} account, not ${dto.platform}`);
    // CC27: the draft CREATES platform objects (paused) on the
    // TARGET account — a launch-class action, gated on the target.
    await this.assertCampaignAccountAccess(organizationId, actorId, { adAccountId: account.id });
    const full = await this.getPlanFull(organizationId, planId);
    const totals = this.budgetTotals(full);
    // NB4/CN9 carry-over fix (recorded in the NB1 acceptance):
    // the cross-platform daily budget is the EFFECTIVE daily
    // figure — the CN2 campaign budget on a CBO plan, the
    // ad-set sum on ABO — and the response labels which.
    const effectiveDailyMinor = BigInt((totals as any).effectiveDailyMinor ?? totals.dailyTotalMinor);
    const budgetMode = this.isCbo(full) ? "cbo" : "abo";
    const dailyTaka = (Number(effectiveDailyMinor) / 100).toFixed(2);
    const budget = {
      mode: budgetMode,
      effectiveDailyMinor: effectiveDailyMinor.toString(),
      adSetDailyTotalMinor: String(totals.dailyTotalMinor),
      source: budgetMode === "cbo" ? "campaign_budget" : "ad_set_sum",
    };
    const countries = [...new Set((full.adSets ?? []).flatMap((s: any) => (s.targeting?.countries ?? []) as string[]))];
    const allAds = (full.adSets ?? []).flatMap((s: any) => s.ads ?? []);
    const interests = [...new Set((full.adSets ?? []).flatMap((s: any) => (s.targeting?.interests ?? []) as string[]))];
    const unmapped: string[] = [];
    const transformations: string[] = [];
    // CN17: plan concepts the chosen platform type has no
    // field for. Listed on the response AND stored on the
    // draft — never silently dropped — but (unlike
    // `unmapped`) they do not block creation: the platform
    // type genuinely lacks the concept (e.g. PMax has no
    // keywords).
    const notCarried: string[] = [];
    if (budgetMode === "cbo") transformations.push(`CBO Plan — Campaign Budget (দৈনিক ${dailyTaka}) ব্যবহার হয়েছে, Ad Set-এর যোগফল নয়`);
    if (effectiveDailyMinor <= 0n) unmapped.push("দৈনিক বাজেট নেই — দুই প্ল্যাটফর্মই দৈনিক বাজেট চায় (Plan এ শুধু Lifetime আছে)");
    if (!countries.length) unmapped.push("কোনো Target দেশ নেই");
    const firstUrl = allAds.find((a: any) => a.linkUrl)?.linkUrl;
    if (!firstUrl) unmapped.push("কোনো Ad এর Link URL নেই");

    let mapped: any = null;
    if (dto.platform === "google" && kind === "pmax") {
      // CN17: Performance Max mapping — the field set is
      // EXACTLY what PublishingService.publishGooglePmax
      // accepts (its guards are the contract): headlines
      // 3–15 (≤30), long headlines 1–5 (≤90), descriptions
      // 2–5 (≤90), business name ≤25, a logo URL and 1–20
      // marketing image URLs, all http(s). Anything the
      // skeleton cannot carry (keywords, video creatives,
      // saved-audience signals) is listed, never dropped.
      const slice = (v: string, n: number, label: string) => { if (v.length > n) transformations.push(`${label} ${n} অক্ষরে কাটা হয়েছে`); return v.slice(0, n); };
      const headlines = [...new Set([plan.name, ...allAds.flatMap((a: any) => [a.headline, a.name])].filter(Boolean).map((v: string) => slice(String(v).trim(), 30, "Headline")))].filter(Boolean).slice(0, 15);
      const longHeadlines = [...new Set(allAds.flatMap((a: any) => [a.description, a.primaryText]).filter(Boolean).map((v: string) => slice(String(v).trim(), 90, "Long Headline")))].filter(Boolean).slice(0, 5);
      const descriptions = [...new Set(allAds.flatMap((a: any) => [a.description, a.primaryText]).filter(Boolean).map((v: string) => slice(String(v).trim(), 90, "Description")))].filter(Boolean).slice(0, 5);
      const org = await (this.prisma as any).organization?.findUnique?.({ where: { id: organizationId } }).catch(() => null);
      const rawBusiness = String(org?.brandName ?? org?.name ?? "").trim();
      const businessName = rawBusiness.length > 25 ? slice(rawBusiness, 25, "Business Name") : rawBusiness;
      const logoUrl = String(org?.logoUrl ?? "");
      const imageUrls = [...new Set(allAds.map((a: any) => a.imageUrl).filter((u: any) => typeof u === "string" && u.startsWith("http")))].slice(0, 20);
      if (headlines.length < 3) unmapped.push(`PMax-এর জন্য অন্তত ৩টি Headline দরকার — পাওয়া গেছে ${headlines.length}টি (Ad Headline/নাম থেকে)`);
      if (longHeadlines.length < 1) unmapped.push("PMax-এর জন্য অন্তত ১টি Long Headline দরকার — কোনো Ad-এ Description/Primary Text নেই");
      if (descriptions.length < 2) unmapped.push(`PMax-এর জন্য অন্তত ২টি Description দরকার — পাওয়া গেছে ${descriptions.length}টি`);
      if (!businessName) unmapped.push("Business Name নেই — Organization-এর নাম/Brand Name থেকে নেওয়া হয়, সেটি খালি");
      if (!logoUrl.startsWith("http")) unmapped.push("PMax-এ Logo আবশ্যক — Organization-এর Logo-তে পূর্ণ http(s) URL নেই (আপেক্ষিক Path চলবে না)");
      if (!imageUrls.length) unmapped.push("PMax-এর জন্য অন্তত ১টি Marketing Image URL দরকার — কোনো Ad-এ সরাসরি ছবির URL নেই (লাইব্রেরি Asset-এর ID URL নয়)");
      if (interests.length) notCarried.push(`Keyword (${interests.length}টি Interest থেকে) PMax-এ যায় না — Performance Max-এ Keyword নেই; Keyword চাইলে Search Draft তৈরি করুন`);
      if (allAds.some((a: any) => (a.format ?? "link") === "video" || a.videoAssetId)) notCarried.push("ভিডিও Creative PMax-এ পাঠানো হয়নি — এই PMax Path-এ Video Asset নেই (শুধু Text ও Image Asset যায়)");
      if ((full.adSets ?? []).some((s: any) => ((s.targeting?.customAudienceIds ?? []) as string[]).length)) notCarried.push("Saved Audience Signal এই PMax Path-এ পাঠানো হয় না — PublishingService-এর PMax কাঠামোতে Audience Signal-এর Field নেই");
      mapped = {
        adAccountId: dto.targetAdAccountId, name: plan.name, dailyBudget: dailyTaka, countryCodes: countries,
        finalUrl: firstUrl, businessName, logoUrl: logoUrl || undefined,
        headlines, longHeadlines, descriptions, imageUrls,
      };
    } else if (dto.platform === "google") {
      const slice = (v: string, n: number, label: string) => { if (v.length > n) transformations.push(`${label} ${n} অক্ষরে কাটা হয়েছে`); return v.slice(0, n); };
      const headlines = [...new Set([plan.name, ...allAds.flatMap((a: any) => [a.headline, a.name])].filter(Boolean).map((v: string) => slice(String(v).trim(), 30, "Headline")))].filter(Boolean);
      const descriptions = [...new Set(allAds.flatMap((a: any) => [a.description, a.primaryText]).filter(Boolean).map((v: string) => slice(String(v).trim(), 90, "Description")))].filter(Boolean);
      if (headlines.length < 3) unmapped.push(`Google RSA এর জন্য অন্তত ৩টি Headline দরকার — পাওয়া গেছে ${headlines.length}টি (Ad Headline/নাম থেকে)`);
      if (descriptions.length < 2) unmapped.push(`Google RSA এর জন্য অন্তত ২টি Description দরকার — পাওয়া গেছে ${descriptions.length}টি`);
      if (!interests.length) unmapped.push("Google Keyword আবশ্যক — কোনো Ad Set এ Interest নেই (Interest গুলোই Keyword হিসেবে যায়)");
      mapped = {
        adAccountId: dto.targetAdAccountId, name: plan.name, dailyBudget: dailyTaka, countryCodes: countries,
        headlines: headlines.slice(0, 15), descriptions: descriptions.slice(0, 4), finalUrl: firstUrl,
        keywords: interests.map((text) => ({ text })),
      };
    } else {
      const firstAd = allAds[0];
      const adText = firstAd?.primaryText ? String(firstAd.primaryText).slice(0, 100) : "";
      if (firstAd?.primaryText && firstAd.primaryText.length > 100) transformations.push("Ad Text 100 অক্ষরে কাটা হয়েছে");
      const imageUrl = allAds.find((a: any) => a.imageUrl)?.imageUrl;
      if (!imageUrl) unmapped.push("TikTok এর জন্য ছবি/ভিডিওর URL দরকার — কোনো Ad এ সরাসরি ছবির URL নেই (লাইব্রেরি Asset এর ID URL নয়)");
      if (!adText) unmapped.push("কোনো Ad Text নেই");
      // CN17: the draft's objective choice (TikTok v1.3
      // spike — see PublishingService.publishTikTok).
      // Inputs an objective needs but this draft does not
      // have are readiness failures HERE, so the platform
      // call is never made to fail.
      if (tiktokObjective === "WEB_CONVERSIONS") {
        if (!dto.pixelId?.trim()) unmapped.push("WEB_CONVERSIONS Objective-এর জন্য TikTok Pixel ID আবশ্যক — Draft-এ pixelId দিন");
        if (!dto.optimizationEvent?.trim()) unmapped.push("WEB_CONVERSIONS Objective-এর জন্য Optimization Event আবশ্যক (যেমন COMPLETE_PAYMENT) — Draft-এ optimizationEvent দিন");
      }
      if (tiktokObjective === "LEAD_GENERATION") {
        unmapped.push("LEAD_GENERATION এই Flow-তে তৈরি করা যায় না — TikTok Lead Ad-এর জন্য Ad-এর সঙ্গে Instant Form বাঁধতে হয়, যা এই Publishing Flow দিতে পারে না (Draft-এ পছন্দটি সংরক্ষিত আছে; Form Binding পথ এলে চালু হবে)");
      }
      if (tiktokObjective !== "WEB_CONVERSIONS" && dto.pixelId?.trim()) {
        unmapped.push("TRAFFIC Objective-এ Ad Group-এ Pixel ID পাঠানো যায় না — TikTok তা Reject করে (Pixel শুধু WEB_CONVERSIONS-এ)");
      }
      mapped = {
        adAccountId: dto.targetAdAccountId, name: plan.name, dailyBudget: dailyTaka, countryCodes: countries, adText, landingUrl: firstUrl, imageUrl,
        objectiveType: tiktokObjective,
        ...(tiktokObjective === "WEB_CONVERSIONS" ? { pixelId: dto.pixelId?.trim() || undefined, optimizationEvent: dto.optimizationEvent?.trim() || undefined } : {}),
      };
    }

    if (unmapped.length) {
      // CN9: even a blocked mapping is now a stored,
      // manageable draft — its fields ARE the export package.
      const draft = await this.persistCrossPlatformDraft(organizationId, actorId, planId, dto.platform, dto.targetAdAccountId, mapped, "blocked", { unmapped: [...unmapped, ...notCarried], kind });
      return { status: "blocked", platform: dto.platform, kind, mapped, unmapped, notCarried, transformations, budget, draftId: draft?.id ?? null, note: "কিছু তথ্য Map করা যায়নি — Publish ডাকা হয়নি। এই Payload টি Export Package: ঘাটতি পূরণ করে আবার চেষ্টা করুন। Draft হিসেবে সেভ আছে — নিচের Draft তালিকা থেকে Edit করে আবার তৈরি করা যাবে।" };
    }
    const record = dto.platform === "google"
      ? (kind === "pmax"
        ? await (this.publishing as any).publishGooglePmax(organizationId, actorId, mapped)
        : await this.publishing.publishGoogle(organizationId, actorId, mapped))
      : await this.publishing.publishTikTok(organizationId, actorId, mapped);
    const created = record?.status === "created_paused";
    await (this.prisma as any).campaignPublishLog.create({
      data: {
        planId, actorId, step: dto.platform, entityRef: dto.targetAdAccountId,
        externalId: (record as any)?.externalCampaignId ?? null,
        status: created ? "success" : "error",
        error: created ? null : String((record as any)?.error ?? (record as any)?.status ?? "failed").slice(0, 500),
      },
    }).catch(() => undefined);
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.cross_platform", entityType: "CampaignPlan", entityId: planId, metadata: { platform: dto.platform, publicationId: (record as any)?.id, status: (record as any)?.status } }).catch(() => undefined);
    const draft = await this.persistCrossPlatformDraft(organizationId, actorId, planId, dto.platform, dto.targetAdAccountId, mapped, created ? "created" : "failed", {
      publicationId: (record as any)?.id ?? null,
      externalCampaignId: (record as any)?.externalCampaignId ?? null,
      lastError: created ? null : String((record as any)?.error ?? (record as any)?.status ?? "failed").slice(0, 500),
      unmapped: notCarried.length ? notCarried : undefined,
      kind,
    });
    return { status: created ? "created" : "failed", platform: dto.platform, kind, publication: record, mapped, unmapped, notCarried, transformations, budget, draftId: draft?.id ?? null };
  }

  // ---------- NB4 / CN9: manageable cross-platform drafts ----------

  private async persistCrossPlatformDraft(organizationId: string, actorId: string, planId: string, platform: string, targetAdAccountId: string, fields: any, status: string, extra: { unmapped?: string[]; publicationId?: string | null; externalCampaignId?: string | null; lastError?: string | null; kind?: string | null } = {}) {
    const p = this.prisma as any;
    if (!p.crossPlatformDraft?.create) return null;
    return p.crossPlatformDraft.create({
      data: {
        organizationId, planId, platform, kind: extra.kind ?? undefined, targetAdAccountId, fields, status,
        unmapped: extra.unmapped ?? undefined,
        publicationId: extra.publicationId ?? undefined,
        externalCampaignId: extra.externalCampaignId ?? undefined,
        lastError: extra.lastError ?? undefined,
        createdById: actorId,
      },
    }).catch(() => null);
  }

  private async getCrossPlatformDraftOrThrow(organizationId: string, planId: string, draftId: string) {
    const p = this.prisma as any;
    const draft = p.crossPlatformDraft?.findFirst
      ? await p.crossPlatformDraft.findFirst({ where: { id: draftId, planId, organizationId } }).catch(() => null)
      : null;
    if (!draft) throw new NotFoundException("Cross-platform draft not found for this plan");
    return draft;
  }

  async listCrossPlatformDrafts(organizationId: string, planId: string) {
    await this.getPlanOrThrow(organizationId, planId);
    const p = this.prisma as any;
    if (!p.crossPlatformDraft?.findMany) return [];
    const rows = await p.crossPlatformDraft.findMany({ where: { organizationId, planId } }).catch(() => []);
    return [...(rows ?? [])].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /** CN9 field validation — the platform's real field rules
   * for this flow (mirroring PublishingService's own guards,
   * plus the CB6 mapping constraints). Returns the list of
   * problems; empty = ready. Used by draft readiness AND as
   * the publish gate — a draft that fails here is never sent
   * to the platform; its fields stay the export package. */
  validateCrossPlatformFields(platform: string, f: any, kind?: string | null): string[] {
    const problems: string[] = [];
    if (!f || typeof f !== "object") return ["Fields নেই"];
    if (!String(f.name ?? "").trim()) problems.push("নাম (name) আবশ্যক");
    const daily = Number(f.dailyBudget);
    if (!Number.isFinite(daily) || daily <= 0) problems.push("দৈনিক বাজেট (dailyBudget) ধনাত্মক সংখ্যা হতে হবে");
    if (!Array.isArray(f.countryCodes) || f.countryCodes.length === 0) problems.push("অন্তত একটি দেশ (countryCodes) আবশ্যক");
    if (platform === "google" && kind === "pmax") {
      // CN17: the PMax contract IS PublishingService.
      // publishGooglePmax's guard list — same numbers,
      // stated once here so readiness and the platform
      // call can never disagree.
      const headlines = Array.isArray(f.headlines) ? f.headlines : [];
      const longHeadlines = Array.isArray(f.longHeadlines) ? f.longHeadlines : [];
      const descriptions = Array.isArray(f.descriptions) ? f.descriptions : [];
      const imageUrls = Array.isArray(f.imageUrls) ? f.imageUrls : [];
      if (headlines.length < 3 || headlines.length > 15) problems.push(`PMax-এ ৩–১৫টি Headline দরকার — আছে ${headlines.length}টি`);
      headlines.forEach((h: any, i: number) => { if (String(h).length > 30) problems.push(`Headline ${i + 1} ৩০ অক্ষরের বেশি (${String(h).length})`); });
      if (longHeadlines.length < 1 || longHeadlines.length > 5) problems.push(`PMax-এ ১–৫টি Long Headline দরকার — আছে ${longHeadlines.length}টি`);
      longHeadlines.forEach((h: any, i: number) => { if (String(h).length > 90) problems.push(`Long Headline ${i + 1} ৯০ অক্ষরের বেশি (${String(h).length})`); });
      if (descriptions.length < 2 || descriptions.length > 5) problems.push(`PMax-এ ২–৫টি Description দরকার — আছে ${descriptions.length}টি`);
      descriptions.forEach((d: any, i: number) => { if (String(d).length > 90) problems.push(`Description ${i + 1} ৯০ অক্ষরের বেশি (${String(d).length})`); });
      const businessName = String(f.businessName ?? "").trim();
      if (!businessName) problems.push("Business Name আবশ্যক");
      if (businessName.length > 25) problems.push(`Business Name সর্বোচ্চ ২৫ অক্ষর — আছে ${businessName.length}`);
      if (!String(f.logoUrl ?? "").startsWith("http")) problems.push("Logo URL (http/https) আবশ্যক");
      if (imageUrls.length < 1 || imageUrls.length > 20) problems.push(`PMax-এ ১–২০টি Marketing Image URL দরকার — আছে ${imageUrls.length}টি`);
      imageUrls.forEach((u: any, i: number) => { if (!String(u).startsWith("http")) problems.push(`Image URL ${i + 1} http/https হতে হবে`); });
      if (!String(f.finalUrl ?? "").startsWith("http")) problems.push("Final URL (http/https) আবশ্যক");
    } else if (platform === "google") {
      const headlines = Array.isArray(f.headlines) ? f.headlines : [];
      const descriptions = Array.isArray(f.descriptions) ? f.descriptions : [];
      if (headlines.length < 3) problems.push(`Google RSA-তে অন্তত ৩টি Headline দরকার — আছে ${headlines.length}টি`);
      if (headlines.length > 15) problems.push(`Google RSA-তে সর্বোচ্চ ১৫টি Headline — আছে ${headlines.length}টি`);
      headlines.forEach((h: any, i: number) => { if (String(h).length > 30) problems.push(`Headline ${i + 1} ৩০ অক্ষরের বেশি (${String(h).length})`); });
      if (descriptions.length < 2) problems.push(`Google RSA-তে অন্তত ২টি Description দরকার — আছে ${descriptions.length}টি`);
      if (descriptions.length > 4) problems.push(`Google RSA-তে সর্বোচ্চ ৪টি Description — আছে ${descriptions.length}টি`);
      descriptions.forEach((d: any, i: number) => { if (String(d).length > 90) problems.push(`Description ${i + 1} ৯০ অক্ষরের বেশি (${String(d).length})`); });
      if (!String(f.finalUrl ?? "").startsWith("http")) problems.push("Final URL (http/https) আবশ্যক");
      const keywords = Array.isArray(f.keywords) ? f.keywords : [];
      if (keywords.length < 1) problems.push("Google Search-এর জন্য অন্তত ১টি Keyword আবশ্যক");
      if (keywords.length > 100) problems.push(`Keyword সর্বোচ্চ ১০০টি — আছে ${keywords.length}টি`);
      for (const kw of keywords) {
        const text = typeof kw === "string" ? kw : kw?.text;
        if (!text || String(text).length > 80) problems.push("প্রতিটি Keyword-এর Text ১–৮০ অক্ষর হতে হবে");
        const mt = String((typeof kw === "object" ? kw?.matchType : undefined) ?? "EXACT").toUpperCase();
        if (!["BROAD", "EXACT", "PHRASE"].includes(mt)) problems.push(`Keyword Match Type অবৈধ: ${mt}`);
      }
    } else if (platform === "tiktok") {
      const adText = String(f.adText ?? "");
      if (!adText) problems.push("Ad Text আবশ্যক");
      if (adText.length > 100) problems.push(`Ad Text সর্বোচ্চ ১০০ অক্ষর — আছে ${adText.length}`);
      if (!String(f.landingUrl ?? "").startsWith("http")) problems.push("Landing URL (http/https) আবশ্যক");
      if (!f.imageUrl && !f.videoUrl) problems.push("ছবি বা ভিডিওর URL আবশ্যক (imageUrl / videoUrl)");
      // CN17: the stored objective choice is validated
      // with the same rules the mapping applied — an
      // objective whose required inputs are missing is a
      // readiness failure, so publish is never attempted.
      const objective = String(f.objectiveType ?? "TRAFFIC").trim().toUpperCase() || "TRAFFIC";
      if (!["TRAFFIC", "WEB_CONVERSIONS", "LEAD_GENERATION"].includes(objective)) problems.push(`TikTok Objective অবৈধ: ${objective}`);
      if (objective === "WEB_CONVERSIONS") {
        if (!String(f.pixelId ?? "").trim()) problems.push("WEB_CONVERSIONS-এর জন্য Pixel ID (pixelId) আবশ্যক");
        if (!String(f.optimizationEvent ?? "").trim()) problems.push("WEB_CONVERSIONS-এর জন্য Optimization Event (optimizationEvent) আবশ্যক");
      }
      if (objective !== "WEB_CONVERSIONS" && String(f.pixelId ?? "").trim()) {
        problems.push("এই Objective-এ Ad Group-এ Pixel ID পাঠানো যায় না — TikTok Reject করে (Pixel শুধু WEB_CONVERSIONS-এ)");
      }
      if (objective === "LEAD_GENERATION") {
        problems.push("LEAD_GENERATION এই Flow-তে তৈরি করা যায় না — TikTok Lead Ad-এর জন্য Ad-এর সঙ্গে Instant Form বাঁধতে হয়, যা এই Publishing Flow দিতে পারে না (Draft-এ পছন্দটি সংরক্ষিত আছে; Form Binding পথ এলে চালু হবে)");
      }
    } else problems.push(`অজানা Platform: ${platform}`);
    return problems;
  }

  async updateCrossPlatformDraft(organizationId: string, actorId: string, planId: string, draftId: string, fields: any) {
    const draft = await this.getCrossPlatformDraftOrThrow(organizationId, planId, draftId);
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new BadRequestException("fields অবজেক্ট হতে হবে");
    const merged = { ...(draft.fields ?? {}), ...fields, adAccountId: draft.targetAdAccountId };
    const problems = this.validateCrossPlatformFields(draft.platform, merged, draft.kind);
    const updated = await (this.prisma as any).crossPlatformDraft.update({
      where: { id: draftId },
      data: { fields: merged, unmapped: problems.length ? problems : null, status: draft.status === "created" ? "mapped" : draft.status, lastError: null },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.xdraft_updated", entityType: "CrossPlatformDraft", entityId: draftId, metadata: { platform: draft.platform, problems: problems.length, note: draft.status === "created" ? "edited after creation — external draft unchanged; re-publish creates a new one" : undefined } }).catch(() => undefined);
    return { draft: updated, problems };
  }

  async crossPlatformDraftReadiness(organizationId: string, planId: string, draftId: string) {
    const draft = await this.getCrossPlatformDraftOrThrow(organizationId, planId, draftId);
    const problems = this.validateCrossPlatformFields(draft.platform, draft.fields ?? {}, draft.kind);
    const account = await (this.prisma as any).adAccount.findFirst({ where: { id: draft.targetAdAccountId, organizationId } }).catch(() => null);
    const checks = [
      { key: "fields", level: problems.length ? "error" as const : "ok" as const, label: "Platform Fields", detail: problems.length ? problems.join(" · ") : "সব আবশ্যিক Field ঠিক আছে" },
      account
        ? { key: "account", level: "ok" as const, label: "Target Account", detail: `${account.name} (${account.platform})` }
        : { key: "account", level: "error" as const, label: "Target Account", detail: "Target Account টি আর পাওয়া যাচ্ছে না" },
      { key: "state", level: "warn" as const, label: "Publish পদ্ধতি", detail: "Re-publish সবসময় নতুন PAUSED Draft তৈরি করে — আগের External Draft বদলায়/মোছে না (Platform-এ Update পথ এই Flow-তে নেই)" },
    ];
    if (!account) problems.push("Target Account পাওয়া যাচ্ছে না");
    return { ready: problems.length === 0, problems, checks };
  }

  /** CN9: a LOCAL rendering of the draft's stored fields —
   * labelled as such; it is not a platform render and claims
   * nothing about platform acceptance. */
  async previewCrossPlatformDraft(organizationId: string, planId: string, draftId: string) {
    const draft = await this.getCrossPlatformDraftOrThrow(organizationId, planId, draftId);
    const f = draft.fields ?? {};
    const label = "সংরক্ষিত Field দিয়ে স্থানীয় Rendering — এটি প্ল্যাটফর্মের আসল Preview নয়";
    if (draft.platform === "google" && draft.kind === "pmax") {
      // CN17: the PMax asset-group rendering. The two
      // absences are stated, not hidden: Performance Max
      // has no keywords, and this path sends no video or
      // audience-signal assets.
      return {
        platform: "google", kind: "pmax", label,
        name: f.name ?? null, dailyBudget: f.dailyBudget ?? null, countryCodes: f.countryCodes ?? [],
        businessName: f.businessName ?? null, logoUrl: f.logoUrl ?? null, finalUrl: f.finalUrl ?? null,
        headlines: (f.headlines ?? []).map((h: string) => ({ text: h, length: String(h).length, limit: 30 })),
        longHeadlines: (f.longHeadlines ?? []).map((h: string) => ({ text: h, length: String(h).length, limit: 90 })),
        descriptions: (f.descriptions ?? []).map((d: string) => ({ text: d, length: String(d).length, limit: 90 })),
        imageUrls: f.imageUrls ?? [],
        notes: ["Performance Max-এ Keyword থাকে না — Keyword চাইলে Search Draft ব্যবহার করুন", "এই Path-এ Video Asset ও Audience Signal যায় না"],
      };
    }
    if (draft.platform === "google") {
      return {
        platform: "google", kind: "rsa", label,
        name: f.name ?? null, dailyBudget: f.dailyBudget ?? null, countryCodes: f.countryCodes ?? [],
        headlines: (f.headlines ?? []).map((h: string) => ({ text: h, length: String(h).length, limit: 30 })),
        descriptions: (f.descriptions ?? []).map((d: string) => ({ text: d, length: String(d).length, limit: 90 })),
        finalUrl: f.finalUrl ?? null,
        keywords: (f.keywords ?? []).map((k: any) => (typeof k === "string" ? { text: k, matchType: "EXACT" } : { text: k.text, matchType: k.matchType ?? "EXACT" })),
      };
    }
    let identityId: string | null = null;
    if (draft.publicationId && (this.prisma as any).platformPublication?.findFirst) {
      const pub = await (this.prisma as any).platformPublication.findFirst({ where: { id: draft.publicationId, organizationId } }).catch(() => null);
      identityId = (pub?.detail as any)?.identityId ?? null;
    }
    return {
      platform: "tiktok", kind: "tiktok", label,
      name: f.name ?? null, dailyBudget: f.dailyBudget ?? null, countryCodes: f.countryCodes ?? [],
      objectiveType: f.objectiveType ?? "TRAFFIC",
      ...(f.objectiveType === "WEB_CONVERSIONS" ? { pixelId: f.pixelId ?? null, optimizationEvent: f.optimizationEvent ?? null } : {}),
      identity: identityId ?? "Publish-এর সময় Advertiser-এর Identity নেওয়া হবে (এখনো নির্ধারিত নয়)",
      adText: { text: f.adText ?? "", length: String(f.adText ?? "").length, limit: 100 },
      media: { imageUrl: f.imageUrl ?? null, videoUrl: f.videoUrl ?? null },
      landingUrl: f.landingUrl ?? null,
      callToAction: "LEARN_MORE (এই Flow-তে নির্দিষ্ট)",
    };
  }

  /** CN9: re-create the external PAUSED draft from the
   * stored (possibly edited) fields, through the EXISTING
   * PublishingService paths. Honest semantics: this creates
   * a NEW external draft — the platform flow has no update
   * call, and the previous external draft is neither edited
   * nor deleted. A draft failing readiness is not sent; its
   * stored fields remain the export package. */
  async publishCrossPlatformDraft(organizationId: string, actorId: string, planId: string, draftId: string) {
    if (!this.publishing) throw new BadRequestException("Cross-platform publishing is not available in this context");
    const draft = await this.getCrossPlatformDraftOrThrow(organizationId, planId, draftId);
    const problems = this.validateCrossPlatformFields(draft.platform, draft.fields ?? {}, draft.kind);
    if (problems.length) {
      const updated = await (this.prisma as any).crossPlatformDraft.update({ where: { id: draftId }, data: { status: "blocked", unmapped: problems } }).catch(() => draft);
      return { status: "blocked", draft: updated, unmapped: problems, note: "Readiness-এ আটকেছে — Publish ডাকা হয়নি। সংরক্ষিত Fields-ই Export Package।" };
    }
    const fields = { ...(draft.fields ?? {}), adAccountId: draft.targetAdAccountId };
    const record = draft.platform === "google"
      ? (draft.kind === "pmax"
        ? await (this.publishing as any).publishGooglePmax(organizationId, actorId, fields)
        : await this.publishing.publishGoogle(organizationId, actorId, fields))
      : await this.publishing.publishTikTok(organizationId, actorId, fields);
    const created = record?.status === "created_paused";
    await (this.prisma as any).campaignPublishLog.create({
      data: {
        planId, actorId, step: draft.platform, entityRef: draft.targetAdAccountId,
        externalId: (record as any)?.externalCampaignId ?? null,
        status: created ? "success" : "error",
        error: created ? null : String((record as any)?.error ?? (record as any)?.status ?? "failed").slice(0, 500),
      },
    }).catch(() => undefined);
    const updated = await (this.prisma as any).crossPlatformDraft.update({
      where: { id: draftId },
      data: {
        status: created ? "created" : "failed",
        publicationId: (record as any)?.id ?? draft.publicationId ?? null,
        externalCampaignId: (record as any)?.externalCampaignId ?? draft.externalCampaignId ?? null,
        lastError: created ? null : String((record as any)?.error ?? (record as any)?.status ?? "failed").slice(0, 500),
        unmapped: null,
      },
    }).catch(() => draft);
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.xdraft_published", entityType: "CrossPlatformDraft", entityId: draftId, metadata: { platform: draft.platform, publicationId: (record as any)?.id, status: (record as any)?.status, recreated: true } }).catch(() => undefined);
    return { status: created ? "created" : "failed", draft: updated, publication: record, note: "নতুন PAUSED Draft তৈরি হয়েছে — আগের External Draft অপরিবর্তিত আছে (Update/Delete এই Flow-তে নেই)।" };
  }

  /** CN9: external status of a created draft. This codebase
   * has NO Google/TikTok campaign-status read path
   * (PublishingService creates only; the Ads clients read
   * metrics, not campaign status) — so sync honestly reports
   * the as-created status from our own records instead of
   * dressing a metrics read up as a status check. */
  async syncCrossPlatformDraftStatus(organizationId: string, planId: string, draftId: string) {
    const draft = await this.getCrossPlatformDraftOrThrow(organizationId, planId, draftId);
    let publicationStatus: string | null = null;
    if (draft.publicationId && (this.prisma as any).platformPublication?.findFirst) {
      const pub = await (this.prisma as any).platformPublication.findFirst({ where: { id: draft.publicationId, organizationId } }).catch(() => null);
      publicationStatus = pub?.status ?? null;
    }
    return {
      available: false,
      reason: "Google/TikTok Campaign-Status পড়ার পথ এই কোডবেসে নেই — PublishingService শুধু তৈরি করে, Ads Client শুধু Metric পড়ে। তাই Status যাচাই করা যায়নি।",
      status: draft.status, statusLabel: "as_created",
      externalCampaignId: draft.externalCampaignId ?? null,
      publicationStatus,
    };
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
    // CN2: CBO plans have no per-ad-set budgets on Meta —
    // scaling them would misrepresent the live objects.
    if (this.isCbo(full)) return [];
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
    // CC27: activation gated, pause always allowed.
    if (target === "ACTIVE") await this.assertCampaignAccountAccess(organizationId, actorId, plan);
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

  /**
   * CB3: deterministic creative health checks. Labelled
   * heuristics (lengths, missing pieces, domain match) —
   * not Meta verdicts; structural errors stay errors.
   */
  async creativeHealth(organizationId: string, planId: string) {
    const full = await this.getPlanFull(organizationId, planId);
    const profile = await (this.prisma as any).businessProfile?.findUnique?.({ where: { organizationId } })?.catch?.(() => null);
    let siteDomain = "";
    try { siteDomain = profile?.websiteUrl ? new URL(profile.websiteUrl).hostname.replace(/^www\./, "") : ""; } catch { siteDomain = ""; }
    const findings: { adId: string; adName: string; level: "warn" | "error"; message: string }[] = [];
    let adsChecked = 0;
    for (const s of full.adSets ?? []) {
      for (const ad of s.ads ?? []) {
        adsChecked++;
        const f = (level: "warn" | "error", message: string) => findings.push({ adId: ad.id, adName: ad.name, level, message });
        if (!ad.headline) f("warn", "Headline নেই — Feed এ লিংকের পাশে শিরোনামটি দেখায়, থাকলে ক্লিক বাড়ে (heuristic)");
        else if (String(ad.headline).length > 40) f("warn", `Headline ${String(ad.headline).length} অক্ষর — 40 এর বেশি হলে Feed এ কেটে যেতে পারে (heuristic)`);
        if (String(ad.primaryText ?? "").length > 125) f("warn", "Primary Text 125 অক্ষরের বেশি — Feed এ 'আরও দেখুন' এর আড়ালে চলে যাবে (heuristic)");
        if (String(ad.primaryText ?? "").trim().length < 20) f("warn", "Primary Text খুব ছোট — প্রোডাক্টের মূল কথাটা আসছে না (heuristic)");
        if ((ad.format ?? "link") === "link" && !ad.imageAssetId && !ad.imageUrl) f("warn", "ছবি ছাড়া Link Ad — ছবিসহ Ad সাধারণত ভালো করে (heuristic)");
        if (ad.format === "video" && !ad.videoAssetId) f("error", "Video ফরম্যাট কিন্তু কোনো ভিডিও Asset নেই");
        if (ad.format === "carousel" && Array.isArray(ad.carouselCards)) {
          if (ad.carouselCards.some((c: any) => !c.imageUrl && !c.imageAssetId)) f("warn", "Carousel এর কোনো কার্ডে ছবি নেই");
        }
        if (siteDomain && ad.linkUrl) {
          try {
            const d = new URL(ad.linkUrl).hostname.replace(/^www\./, "");
            if (d !== siteDomain) f("warn", `Link এর Domain (${d}) ব্যবসার Website (${siteDomain}) থেকে আলাদা — ইচ্ছাকৃত না হলে যাচাই করুন`);
          } catch { /* validatePlan covers malformed URLs */ }
        }
      }
    }
    return { adsChecked, findings };
  }

  /**
   * CB3: AI plan suggestion. The SKELETON is computed
   * on the server (objective from the goal, budget
   * split by arithmetic, interests from the product's
   * own category) — the model only writes words, and
   * every number in its copy must already exist in
   * the fact pack or the variant falls back to the
   * safe template. The result is an ordinary DRAFT:
   * never submitted, never published.
   */
  async suggestPlan(organizationId: string, actorId: string, dto: { adAccountId: string; productId?: string; goal?: string; totalDailyBudget: string }) {
    const p = this.prisma as any;
    const totalMinor = parseMoneyToMinor(dto.totalDailyBudget);
    if (totalMinor <= 0n) throw new BadRequestException("A positive total daily budget is required");
    const product = dto.productId ? await p.product.findFirst({ where: { id: dto.productId, organizationId } }) : null;
    if (dto.productId && !product) throw new NotFoundException("Product not found in this organization");
    const profile = await p.businessProfile?.findUnique?.({ where: { organizationId } })?.catch?.(() => null);
    const linkUrl = profile?.websiteUrl ?? "";
    if (!linkUrl) throw new BadRequestException("Set the business website URL first (Organization Settings) — ads need a real landing link");

    const goalText = (dto.goal ?? "").toLowerCase();
    const objective = /lead|লিড|ফর্ম/.test(goalText) ? "OUTCOME_LEADS" : /traffic|ভিজিট|ক্লিক/.test(goalText) ? "OUTCOME_TRAFFIC" : "OUTCOME_SALES";
    const optimizationGoal = objective === "OUTCOME_SALES" ? "OFFSITE_CONVERSIONS" : objective === "OUTCOME_LEADS" ? "LEAD_GENERATION" : "LINK_CLICKS";

    // Grounded audience facts (real rows only).
    const savedAudiences = await p.savedTargeting?.findMany?.({ where: { organizationId } })?.catch?.(() => []) ?? [];
    const metrics = await p.dailyAdMetric?.findMany?.({ where: { adAccount: { organizationId } }, take: 1000 })?.catch?.(() => []) ?? [];
    let pastPerformance: { avgCpmMinor: string; avgCpaMinor: string | null; days: number } | null = null;
    if (Array.isArray(metrics) && metrics.length) {
      let spend = 0n; let impressions = 0; let conversions = 0;
      for (const m of metrics as any[]) {
        spend += BigInt(m.spendMinor ?? 0);
        impressions += Number(m.impressions ?? 0);
        conversions += Number(m.platformConversions ?? m.conversions ?? 0);
      }
      if (impressions > 0) {
        pastPerformance = {
          avgCpmMinor: ((spend * 1000n) / BigInt(impressions)).toString(),
          avgCpaMinor: conversions > 0 ? (spend / BigInt(conversions)).toString() : null,
          days: metrics.length,
        };
      }
    }

    const price = product ? formatMinor(BigInt(product.priceMinor), product.currency) : null;
    const categoryInterests: Record<string, string[]> = {
      clothing: ["Fashion", "Online shopping"], fashion: ["Fashion", "Online shopping"],
      electronics: ["Electronics", "Gadgets"], beauty: ["Beauty", "Cosmetics"],
      food: ["Food", "Cooking"], grocery: ["Grocery", "Online shopping"],
    };
    const interests = product?.category ? (categoryInterests[String(product.category).toLowerCase()] ?? ["Online shopping"]) : ["Online shopping"];

    const twoSets = totalMinor >= 100000n;
    const split = twoSets
      ? [{ name: "ব্রড — সবাই", share: 60, interests: [] as string[] }, { name: `আগ্রহ — ${interests.join(", ")}`, share: 40, interests }]
      : [{ name: product ? `${product.name} — প্রধান` : "প্রধান Ad Set", share: 100, interests }];

    // Words from the provider; numbers guarded below.
    const provider = this.llm.getProvider();
    const allowedNumbers = new Set<string>();
    if (product) {
      const taka = Number(BigInt(product.priceMinor)) / 100;
      allowedNumbers.add(String(taka));
      allowedNumbers.add(taka.toFixed(2));
    }
    const numbersOk = (text: string) => {
      const found = text.replace(/[০-৯]/g, (d) => "০১২৩৪৫৬৭৮৯".indexOf(d).toString()).match(/\d+(?:\.\d+)?/g) ?? [];
      return found.every((n) => allowedNumbers.has(n) || allowedNumbers.has(String(Number(n))) || allowedNumbers.has(Number(n).toFixed(2)));
    };
    let planName = product ? `${product.name} — ক্যাম্পেইন` : "নতুন ক্যাম্পেইন (AI খসড়া)";
    const copies = new Map<number, { primaryText: string; headline: string }>();
    const safeCopy = (i: number) => product
      ? { primaryText: `${product.name} - দাম ${price}। বিস্তারিত দেখে এখনই অর্ডার করুন।`, headline: product.name }
      : { primaryText: "আমাদের কালেকশন দেখুন — বিস্তারিত জানতে ক্লিক করুন।", headline: profile?.industry ?? "এখনই দেখুন" };
    if (provider.isRealLlm) {
      const result = await provider.complete([
        { role: "system", content: "You draft ecommerce ad plans. Use ONLY the facts given: never invent prices, discounts, stock or delivery promises. Bengali (Bangla script). Return ONLY JSON: {\"planName\":string,\"copies\":[{\"primaryText\":string,\"headline\":string}]} with one copy per ad set, in order." },
        { role: "user", content: `Goal: ${dto.goal ?? "sales"}\nProduct: ${product?.name ?? "-"}\nPrice: ${price ?? "-"}\nCategory: ${product?.category ?? "-"}\nBusiness industry: ${profile?.industry ?? "-"}; brand voice: ${profile?.brandVoice ?? "-"}\nAd sets: ${split.map((s) => s.name).join(" | ")}` },
      ], { jsonMode: true, maxTokens: 700 }).catch(() => null);
      if (result) {
        await p.aIUsageRecord.create({ data: { organizationId, userId: actorId, feature: "plan_suggestion", provider: provider.name, inputTokens: result.inputTokens, outputTokens: result.outputTokens, estimated: result.tokensEstimated } }).catch(() => undefined);
        try {
          const parsed = JSON.parse(result.text);
          if (typeof parsed.planName === "string" && parsed.planName.trim()) planName = parsed.planName.slice(0, 120);
          (Array.isArray(parsed.copies) ? parsed.copies : []).forEach((c: any, i: number) => {
            const text = String(c?.primaryText ?? "");
            if (text && numbersOk(text)) copies.set(i, { primaryText: text.slice(0, 2000), headline: String(c?.headline ?? "").slice(0, 200) });
          });
        } catch { /* fall through to safe copies */ }
      }
    }

    const plan = await this.createPlan(organizationId, actorId, { name: planName, objective, adAccountId: dto.adAccountId });
    for (let i = 0; i < split.length; i++) {
      const part = split[i];
      const budgetTaka = (Number(totalMinor) * part.share / 100 / 100).toFixed(2);
      const adSet = await this.addAdSet(organizationId, plan.id, {
        name: part.name, dailyBudget: budgetTaka, optimizationGoal,
        countries: ["BD"], interests: part.interests.length ? part.interests : undefined,
      });
      const copy = copies.get(i) ?? safeCopy(i);
      await this.addAd(organizationId, plan.id, (adSet as any).id, {
        name: `AI suggestion - ${part.name}`.slice(0, 120), primaryText: copy.primaryText,
        headline: copy.headline || undefined, linkUrl, productId: product?.id, createdByAi: true,
      } as any);
    }
    const full = await this.getPlanFull(organizationId, plan.id);
    return {
      plan: full, provider: provider.name,
      facts: {
        objective, productName: product?.name ?? null, price,
        savedAudiences: Array.isArray(savedAudiences) ? savedAudiences.length : 0,
        pastPerformance,
        note: "এটি একটি খসড়া — সংখ্যা ও বাজেট সার্ভার হিসাব করেছে; যাচাই করে সম্পাদনা করুন, তারপর Submit করুন।",
      },
    };
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
