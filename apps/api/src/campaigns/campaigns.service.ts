import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { isMemberConnectionDenied } from "../common/permission-catalog";
import { createAgentNotification } from "../common/agent-notify";
import { leaderClaim } from "../common/leader-claim";
import { PublishingService } from "../publishing/publishing.service";
import { AudiencesService } from "../audiences/audiences.service";
import { AuditService } from "../audit/audit.service";
import { decryptJson } from "../integrations/crypto";
import { MetaPublishClient } from "./meta-publish.client";
import { computeCreativeLeaderboard } from "../ads/creative-fatigue";
import { metaStatusBucket, bucketLabelBn } from "../ads/platform-status";
import { isSoldOrder } from "../storefront/ec27-discovery";
import { policyFindingsForText } from "./policy-check";
import { LlmFactory } from "../ai/llm/llm.factory";
import { VisionService } from "../ai/vision.service";
import { PublicMediaService } from "../storage/public-media.service";
import { CreativesService } from "../creatives/creatives.service";
import { LandingsService } from "../landings/landings.service";
import { parseMoneyToMinor, formatMinor } from "@repo/contracts";

export const OBJECTIVES = ["OUTCOME_SALES", "OUTCOME_TRAFFIC", "OUTCOME_LEADS", "OUTCOME_ENGAGEMENT", "OUTCOME_AWARENESS", "OUTCOME_APP_PROMOTION"] as const;
export const OPTIMIZATION_GOALS = ["LINK_CLICKS", "OFFSITE_CONVERSIONS", "LEAD_GENERATION", "REACH", "LANDING_PAGE_VIEWS", "VALUE", "CONVERSATIONS", "APP_INSTALLS"] as const;
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

/** CA13: the naming-template tokens. A template is literal
 * text plus any of these in {braces}; values come only from
 * real records (the plan's objective, a referenced saved
 * audience, a linked product) — a token without a value
 * renders EMPTY, never invented. */
export const NAMING_TOKENS = ["product", "audience", "objective", "date", "platform"] as const;

/** CA13: render a naming template. Empty tokens vanish
 * WITH their neighbouring separator, so a missing audience
 * never leaves "Panjabi -  - 2026-10-17" or a dangling
 * trailing dash: separators (space, -, _, ., /, |) are
 * held pending and only emitted between two non-empty
 * parts, and edge separators are stripped. */
export function renderNamingTemplate(template: string, values: Record<string, string | null | undefined>): string {
  if (!template) return "";
  const parts: { lit?: string; tok?: string }[] = [];
  const re = /\{([a-zA-Z]+)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template))) {
    if (m.index > last) parts.push({ lit: template.slice(last, m.index) });
    parts.push({ tok: m[1].toLowerCase() });
    last = m.index + m[0].length;
  }
  if (last < template.length) parts.push({ lit: template.slice(last) });
  const isSep = (s: string) => /^[\s\-_./|]+$/.test(s);
  let out = "";
  let pendingSep = "";
  for (const p of parts) {
    if (p.lit !== undefined) {
      if (isSep(p.lit)) { pendingSep = p.lit; continue; }
      // A text literal's own leading/trailing separators
      // join the pending-separator flow instead of baking
      // in — otherwise "Sale {empty} {product}" would keep
      // both spaces around the vanished token.
      const lead = p.lit.match(/^[\s\-_./|]+/)?.[0] ?? "";
      const trail = p.lit.match(/[\s\-_./|]+$/)?.[0] ?? "";
      const core = p.lit.slice(lead.length, p.lit.length - trail.length);
      if (out && (pendingSep || lead)) out += pendingSep || lead;
      out += core;
      pendingSep = trail;
      continue;
    }
    const v = (values[p.tok!] ?? "").toString().trim();
    if (!v) continue; // empty token: it and its pending separator vanish
    if (out && pendingSep) out += pendingSep;
    pendingSep = "";
    out += v;
  }
  return out.replace(/^[\s\-_./|]+/, "").replace(/[\s\-_./|]+$/, "").trim().slice(0, 200);
}

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
    // CA1: AI image generation delegates to CreativesService
    // (it owns the storage/registry/Meta-ingest path). Optional
    // + LAST so existing spec constructions keep working; the
    // generate-image path refuses honestly when it is absent.
    @Optional() private readonly creatives?: CreativesService,
    // CA5: creative-health's vision estimates ride the
    // existing VisionService. Optional + LAST (same
    // discipline); absent = the vision items are reported
    // not_checked, never silently passed.
    @Optional() private readonly vision?: VisionService,
    // CA28: landing-page creation delegates to the EC13
    // LandingsService (it owns slugs, sections and the
    // publish-state rules). Optional + LAST (same
    // discipline); absent = the builder landing path
    // refuses honestly.
    @Optional() private readonly landings?: LandingsService,
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

  async createPlan(organizationId: string, actorId: string, dto: { name: string; objective: string; adAccountId: string; budgetMode?: string; campaignDailyBudget?: string; campaignLifetimeBudget?: string; useNamingTemplate?: boolean }) {
    if (!(OBJECTIVES as readonly string[]).includes(dto.objective)) throw new BadRequestException("Invalid objective");
    const account = await (this.prisma as any).adAccount.findFirst({ where: { id: dto.adAccountId, organizationId } });
    if (!account) throw new BadRequestException("Ad account not found in this organization");
    if (account.platform !== "meta") throw new BadRequestException("Milestone 9 publishing supports Meta ad accounts only");
    // CA13: naming convention — only for a blank name or an
    // explicit opt-in; a typed name is never overwritten.
    const name = await this.nameAtCreate(organizationId, dto.name, {
      useTemplate: dto.useNamingTemplate,
      values: { objective: dto.objective, platform: "Meta", date: await this.orgToday(organizationId) },
    });
    const plan = await (this.prisma as any).campaignPlan.create({
      data: {
        organizationId, adAccountId: dto.adAccountId, name, objective: dto.objective, status: "draft", createdById: actorId,
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

  /** CA23: what Meta does and does not let the merchant
   * control on a TRUE Advantage+ campaign — stated verbatim
   * in readiness and the builder, so the trade is never a
   * surprise after publish. Grounded in Meta's unified
   * Advantage+ guide (developers.facebook.com/docs/
   * marketing-api/advantage-campaigns, verified 2026-10-17):
   * the Advantage+ state follows from three levers —
   * campaign-level budget on a supported bid strategy, NO
   * placement targeting/exclusions on any ad set, and
   * Advantage+ audience on at least one ad set. */
  static readonly ADVANTAGE_PLUS_EXPLAINER =
    "আসল Advantage+: বাজেট বণ্টন, Audience সম্প্রসারণ ও সব Placement Meta-র AI ঠিক করে। বিনিময়ে যা ছাড়তে হয়: Ad Set-ভিত্তিক আলাদা বাজেট, নিজে Placement বাছাই/বাদ দেওয়া, আর Placement-level নিয়ন্ত্রণ। Publish-এর পর Meta-র advantage_state_info পড়ে এই Plan-এ আসল অবস্থা দেখানো হবে — শুধু Toggle দেখে Advantage+ ধরে নেওয়া হবে না।";

  /** CA23: the campaign-level bid an Advantage+ publish
   * sends (the budget lever). Derived from the ad sets'
   * stored bids via the SAME CN2 mapping ad sets use:
   * every set lowest_cost → LOWEST_COST_WITHOUT_CAP with
   * no amount; a uniform non-default strategy → that
   * strategy with its amount/constraints (all sets must
   * agree exactly). Mixed strategies or amounts → null:
   * there is no honest single campaign bid, and
   * validatePlan names the conflict instead of picking
   * one silently. */
  private advantageCampaignBid(full: any): { bidStrategy: string; bidAmountMinor?: string; bidConstraints?: Record<string, unknown> } | null {
    const derived = (full.adSets ?? []).map((s: any) => {
      const g = this.bidGraphFields(s);
      return {
        strategy: g.bidStrategy ?? "LOWEST_COST_WITHOUT_CAP",
        amount: g.bidAmountMinor ?? null,
        constraints: g.bidConstraints ? JSON.stringify(g.bidConstraints) : null,
      };
    });
    if (!derived.length) return null;
    const first = derived[0];
    if (!derived.every((d: any) => d.strategy === first.strategy && d.amount === first.amount && d.constraints === first.constraints)) return null;
    return {
      bidStrategy: first.strategy,
      ...(first.amount ? { bidAmountMinor: first.amount } : {}),
      ...(first.constraints ? { bidConstraints: JSON.parse(first.constraints) } : {}),
    };
  }

  /** CA23: the placement fields an ad set's stored
   * targeting carries (the placement lever's blockers).
   * Returns the field names present, e.g. ["platforms",
   * "positions"] — used by validation/readiness to NAME
   * the conflict, and mirrored by toGraphTargeting's
   * Advantage+ suppression (defence in depth). */
  private static placementRestrictionsOf(targeting: any): string[] {
    const t = targeting ?? {};
    const out: string[] = [];
    if (Array.isArray(t.platforms) && t.platforms.length) out.push("platforms");
    if (Array.isArray(t.positions) && t.positions.length) out.push("positions");
    if (Array.isArray(t.devices) && t.devices.length) out.push("devices");
    return out;
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

    // CA23: Advantage+ truth. The toggle is only intent —
    // readiness states the trade in plain words, and after
    // publish it reports META's read-back state (stored on
    // the plan), never the toggle, as the confirmed state.
    if ((full as any).advantagePlus) {
      const state = (full as any).advantageState as string | null;
      if (state) {
        push("advantage", state === "DISABLED" ? "error" : "ok", "Advantage+ (Meta-নিশ্চিত)",
          state === "DISABLED"
            ? "Meta-র advantage_state_info বলছে DISABLED — Campaign চলছে কিন্তু Advantage+ নয়। Leverগুলো যাচাই করুন (Campaign Budget + Bid Strategy, সব Placement খোলা, Advantage Audience)।"
            : `Meta-র advantage_state_info নিশ্চিত করেছে: ${state} — এটি আসল Advantage+ Campaign।`);
      } else {
        push("advantage", "warn", "Advantage+ (আসল পথ)", `${CampaignsService.ADVANTAGE_PLUS_EXPLAINER} বর্তমান অবস্থা: এখনো Publish হয়নি বা Read-back হয়নি — অনিশ্চিত।`);
      }
    }
    if (full.objective === "OUTCOME_APP_PROMOTION") {
      push("app_promotion", "ok", "App Promotion", "Publish-এ প্রতিটি Ad Set থেকে promoted_object { application_id, object_store_url } যাবে; Optimization Goal APP_INSTALLS। Ad-এর Link URL-এ Store-এর Link-ই বসান।");
    }

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

    // CA6: deterministic audience-conflict findings —
    // computed ONLY from the plan's stored targeting (no
    // platform call, no member data). The include∩exclude
    // contradiction itself is a validatePlan structural
    // error (already surfaced above); here are the two
    // warning classes: one audience stretched across
    // several ad sets of the same plan (the sets compete
    // for the same people and cannibalise delivery), and a
    // prospecting set carrying no purchaser/customer
    // exclusion at all. Names resolve against OUR
    // AudienceRecords when the id is one of ours; a foreign
    // id is shown as the id, never given an invented name.
    {
      const records = (this.prisma as any).audienceRecord?.findMany
        ? await (this.prisma as any).audienceRecord.findMany({ where: { organizationId, adAccountId: full.adAccountId }, take: 200 }).catch(() => [])
        : [];
      const nameOf = new Map<string, string>((records ?? []).filter((r: any) => r.externalAudienceId).map((r: any) => [String(r.externalAudienceId), String(r.name)]));
      const kindOf = new Map<string, string>((records ?? []).filter((r: any) => r.externalAudienceId).map((r: any) => [String(r.externalAudienceId), String(r.kind)]));
      const findings = CampaignsService.audiencePlanFindings(full, nameOf, kindOf);
      if (!findings.length && (full.adSets ?? []).length) {
        push("audience", "ok", "Audience যাচাই", "কোনো Audience Conflict বা ঝুঁকি পাওয়া যায়নি");
      }
      for (const f of findings) push("audience", "warn", "Audience যাচাই", f.message);
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

  // ---------- CA20 (CB5): per-form lead quality ----------
  /** CA20 minimums — stated, not hidden: a form's rates
   *  are shown only from at least 10 form-attributed
   *  leads; below that the payload says "পর্যাপ্ত তথ্য
   *  নেই" and the rates are null. A form is linked to
   *  cost only through REAL structure: ad sets carrying
   *  leadFormId → their plans → the plans' published
   *  campaigns' stored DailyAdMetric spend. */
  static readonly LEAD_FORM_MIN_LEADS = 10;
  static readonly LEAD_QUALIFIED_STAGES = ["qualified", "proposal", "won"] as const;

  /** CA20: per-form lead quality from REAL rows only.
   *  Attribution rides Lead.leadFormId (stamped at
   *  leadgen ingest when Meta's form_id resolves to a
   *  modelled form — CA20). Leads without the stamp
   *  (every historical lead, leads from unmodelled
   *  forms) are counted as unattributed COVERAGE, never
   *  guessed into a form. Converted-to-order rides the
   *  real Lead.customerId → Order.customerId chain.
   *  Feedback status rides the CN14 OfflineConversionLog
   *  rows (eventId lead-feedback-{leadId}-{stage}). */
  async leadFormQuality(organizationId: string) {
    const p = this.prisma as any;
    const minLeads = CampaignsService.LEAD_FORM_MIN_LEADS;
    const base = {
      minLeads,
      qualifiedStages: [...CampaignsService.LEAD_QUALIFIED_STAGES],
      linkage: "Lead.leadFormId (leadgen ingest-এ stamp) → stage pipeline; order conversion: Lead.customerId → Order.customerId",
    };
    const forms = p.leadForm?.findMany ? await p.leadForm.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 100 }).catch(() => []) : [];
    const stamped = p.lead?.findMany ? await p.lead.findMany({ where: { organizationId, leadFormId: { not: null } }, take: 20000 }).catch(() => []) : [];
    const unattributed = p.lead?.count ? await p.lead.count({ where: { organizationId, source: "facebook_lead_ads", leadFormId: null } }).catch(() => 0) : 0;
    const byForm = new Map<string, any[]>();
    for (const l of stamped as any[]) {
      const arr = byForm.get(l.leadFormId) ?? [];
      arr.push(l);
      byForm.set(l.leadFormId, arr);
    }
    // customers who actually ordered (the conversion leg)
    const customerIds = [...new Set((stamped as any[]).map((l) => l.customerId).filter(Boolean))];
    const orderedCustomers = new Set<string>();
    if (customerIds.length && p.order?.findMany) {
      const orders = await p.order.findMany({ where: { organizationId, customerId: { in: customerIds } }, take: 20000 }).catch(() => []);
      for (const o of orders as any[]) if (o.customerId) orderedCustomers.add(String(o.customerId));
    }
    // CN14 feedback logs for these leads
    const leadIds = new Set((stamped as any[]).map((l) => String(l.id)));
    const feedbackByLead = new Map<string, { sent: number; failed: number; lastAt: string | null }>();
    if (leadIds.size && p.offlineConversionLog?.findMany) {
      const logs = await p.offlineConversionLog.findMany({ where: { organizationId, platform: "meta" }, orderBy: { createdAt: "desc" }, take: 10000 }).catch(() => []);
      for (const log of logs as any[]) {
        const m = /^lead-feedback-(.+)-(qualified|won)$/.exec(String(log.eventId ?? ""));
        if (!m || !leadIds.has(m[1])) continue;
        const cur = feedbackByLead.get(m[1]) ?? { sent: 0, failed: 0, lastAt: null };
        if (log.status === "sent") cur.sent++;
        else if (log.status === "failed") cur.failed++;
        if (!cur.lastAt) cur.lastAt = log.createdAt ? new Date(log.createdAt).toISOString() : null;
        feedbackByLead.set(m[1], cur);
      }
    }
    // form → plans (via ad sets) → stored campaign spend
    const spendByForm = new Map<string, { spendMinor: bigint; campaigns: number }>();
    if (p.campaignAdSet?.findMany && p.campaignPlan?.findMany) {
      const sets = await p.campaignAdSet.findMany({ where: { leadFormId: { not: null } }, take: 5000 }).catch(() => []);
      const planIds = [...new Set((sets as any[]).map((s) => s.planId))];
      const plans = planIds.length ? await p.campaignPlan.findMany({ where: { organizationId, id: { in: planIds } } }).catch(() => []) : [];
      const planById = new Map((plans as any[]).map((pl) => [pl.id, pl]));
      const extByForm = new Map<string, Set<string>>();
      for (const s of sets as any[]) {
        const plan = planById.get(s.planId);
        if (!plan?.externalCampaignId) continue;
        const set = extByForm.get(s.leadFormId) ?? new Set<string>();
        set.add(String(plan.externalCampaignId));
        extByForm.set(s.leadFormId, set);
      }
      for (const [formId, exts] of extByForm) {
        let spend = 0n;
        if (p.dailyAdMetric?.findMany) {
          const rows = await p.dailyAdMetric.findMany({ where: { organizationId, campaignExternalId: { in: [...exts] } }, take: 20000 }).catch(() => []);
          for (const r of rows as any[]) {
            if ((r.adSetExternalId ?? "") !== "" || (r.adExternalId ?? "") !== "") continue;
            try { spend += BigInt(r.spendMinor ?? 0); } catch { /* malformed row never poisons totals */ }
          }
        }
        spendByForm.set(formId, { spendMinor: spend, campaigns: exts.size });
      }
    }
    const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
    const out = (forms as any[]).map((f) => {
      const leads = byForm.get(f.id) ?? [];
      const total = leads.length;
      const stages: Record<string, number> = {};
      let qualified = 0;
      let won = 0;
      let converted = 0;
      let fbSent = 0;
      let fbFailed = 0;
      let fbLastAt: string | null = null;
      for (const l of leads) {
        stages[l.stage] = (stages[l.stage] ?? 0) + 1;
        if ((CampaignsService.LEAD_QUALIFIED_STAGES as readonly string[]).includes(l.stage)) qualified++;
        if (l.stage === "won") won++;
        if (l.customerId && orderedCustomers.has(String(l.customerId))) converted++;
        const fb = feedbackByLead.get(String(l.id));
        if (fb) {
          fbSent += fb.sent; fbFailed += fb.failed;
          if (fb.lastAt && (!fbLastAt || fb.lastAt > fbLastAt)) fbLastAt = fb.lastAt;
        }
      }
      const enough = total >= minLeads;
      const spendInfo = spendByForm.get(f.id);
      let costPerQualifiedMinor: string | null = null;
      let costNote: string | null = null;
      if (!spendInfo || spendInfo.campaigns === 0) costNote = "খরচের তথ্য নেই — এই Form কোনো Published Campaign-এর Ad Set-এ যুক্ত নয়";
      else if (qualified === 0) costNote = "যোগ্য (qualified) লিড নেই — Cost Per Qualified হিসাব হয় না";
      else costPerQualifiedMinor = (spendInfo.spendMinor / BigInt(qualified)).toString();
      return {
        formId: f.id, name: f.name, status: f.status, externalFormId: f.externalFormId ?? null,
        totalLeads: total,
        belowThreshold: !enough,
        thresholdNote: enough ? null : `পর্যাপ্ত তথ্য নেই — Rate দেখাতে অন্তত ${minLeads}টি Form-যুক্ত লিড লাগে, আছে ${total}টি`,
        stages,
        qualified, won, convertedToOrder: converted,
        qualifiedRate: enough ? pct(qualified, total) : null,
        orderRate: enough ? pct(converted, total) : null,
        spendMinor: spendInfo ? spendInfo.spendMinor.toString() : null,
        linkedCampaigns: spendInfo?.campaigns ?? 0,
        costPerQualifiedMinor, costNote,
        feedback: { sent: fbSent, failed: fbFailed, lastSentAt: fbLastAt },
      };
    });
    return {
      ...base,
      forms: out,
      coverage: {
        attributedLeads: (stamped as any[]).length,
        unattributedLeadAdsLeads: unattributed,
        note: "Form-যুক্ত লিড শুধু তারাই যাদের LeadGen Ingest-এর সময় Form মিলেছে (CA20 stamp) — আগের লিড ও মডেল-না-করা Form-এর লিড Unattributed হিসেবে গোনা হয়েছে, আন্দাজে কোনো Form-এ দেওয়া হয়নি",
      },
    };
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
    const rawRecords = (this.prisma as any).audienceRecord?.findMany
      ? await (this.prisma as any).audienceRecord.findMany({ where: { organizationId, adAccountId: plan.adAccountId }, orderBy: { createdAt: "desc" }, take: 100 }).catch(() => [])
      : [];
    // CA7: each record carries its stored performance
    // rollup (AudiencesService.rollupView shape) or null —
    // null is the honest "তথ্য নেই" state: no refresh has
    // attributed any ad set to this audience yet.
    const rollups = (this.prisma as any).audiencePerformanceRollup?.findMany
      ? await (this.prisma as any).audiencePerformanceRollup.findMany({ where: { organizationId } }).catch(() => [])
      : [];
    const perfByKey = new Map<string, any>((rollups ?? []).map((r: any) => [String(r.audienceKey), r]));
    const records = (rawRecords ?? []).map((r: any) => {
      const rollup = perfByKey.get(`record:${r.id}`);
      return { ...r, performance: rollup ? AudiencesService.rollupView(rollup) : null };
    });
    return { available: true, sources, records, presets };
  }

  /** DX3 🚩 mini-fix: the CN6 source catalogue WITHOUT a
   *  plan. The CN16 full-funnel wizard needs the same real
   *  counts at layer-selection time, when no plan exists
   *  yet — the studio above is plan-scoped (records belong
   *  to the plan's account, presets to an ad set), so only
   *  `sources` + the availability semantics carry over.
   *  This is the identical AudiencesService.sourceCatalog
   *  computation the studio embeds — no second counting
   *  implementation exists. */
  async audienceSourceCatalog(organizationId: string) {
    if (!this.audiences) {
      return { available: false, reason: "AudiencesService এই Deployment-এ যুক্ত নেই", sources: [] as Awaited<ReturnType<AudiencesService["sourceCatalog"]>> };
    }
    const sources = await this.audiences.sourceCatalog(organizationId);
    // CA7 (additive): the org's per-audience performance
    // block — stored rollups + the coverage note — rides
    // along so plan-less consumers (the CN16 wizard) see
    // the same history the studio shows.
    const performance = typeof (this.audiences as any).listPerformance === "function"
      ? await (this.audiences as any).listPerformance(organizationId).catch(() => null)
      : null;
    return { available: true, sources, performance };
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

  /** CA6: deterministic audience findings for a whole
   *  plan, computed ONLY from stored targeting — no
   *  platform call, no member data (hashes are never
   *  stored, so true overlap stays uncomputable; see
   *  audienceInsights). Two warning classes:
   *  (1) the same included audience stretched across 2+
   *  ad sets of the plan — those sets bid against each
   *  other for the same people;
   *  (2) a prospecting ad set with NO exclusion at all —
   *  people who already bought keep seeing the ad.
   *  "Prospecting" is judged conservatively: a funnel
   *  retargeting/retention layer is never prospecting, and
   *  a set including a non-lookalike custom audience is
   *  warm by construction; a set whose includes are ALL
   *  lookalikes is still cold (lookalikes are prospecting
   *  by design). Sets whose include ids cannot be resolved
   *  to our records are treated as warm — fewer false
   *  warnings, never invented ones. */
  static audiencePlanFindings(full: any, nameOf: Map<string, string>, kindOf: Map<string, string>): { code: string; message: string }[] {
    const out: { code: string; message: string }[] = [];
    const label = (id: string) => (nameOf.has(id) ? `"${nameOf.get(id)}" (${id})` : id);
    const usage = new Map<string, string[]>();
    for (const s of full.adSets ?? []) {
      const ids: string[] = Array.isArray(s.targeting?.customAudienceIds) ? [...new Set<string>(s.targeting.customAudienceIds.map(String))] : [];
      for (const id of ids) {
        const sets = usage.get(id) ?? [];
        sets.push(String(s.name));
        usage.set(id, sets);
      }
    }
    for (const [id, sets] of usage.entries()) {
      if (sets.length >= 2) {
        out.push({
          code: "audience_shared_across_ad_sets",
          message: `Audience ${label(id)} এই Plan-এর ${sets.length}টি Ad Set-এ ব্যবহৃত হয়েছে (${sets.join(", ")}) — একই মানুষের জন্য Ad Set গুলো নিজেদের সঙ্গেই প্রতিযোগিতা করবে; সম্ভব হলে Audience ভাগ করুন বা একটি Set-এ রাখুন`,
        });
      }
    }
    for (const s of full.adSets ?? []) {
      const t = s.targeting ?? {};
      const layer = String((s as any).funnelLayer ?? "");
      if (layer === "retargeting" || layer === "retention") continue;
      const included: string[] = Array.isArray(t.customAudienceIds) ? t.customAudienceIds.map(String) : [];
      const hasWarmInclude = included.some((id) => kindOf.get(id) !== "lookalike");
      if (hasWarmInclude) continue;
      const hasExclusion = (Array.isArray(t.excludedAudienceIds) && t.excludedAudienceIds.length > 0)
        || (Array.isArray(t.exclusionPresets) && t.exclusionPresets.length > 0);
      if (!hasExclusion) {
        out.push({
          code: "prospecting_without_exclusion",
          message: `Ad Set "${s.name}": Prospecting Ad Set, কিন্তু কোনো ক্রেতা/Customer Exclusion নেই — যারা ইতিমধ্যে কিনেছেন তারাও এই বিজ্ঞাপন দেখবেন; Audience Studio-র Exclusion Preset (যেমন: শেষ ৩০ দিনের ক্রেতা বাদ) প্রয়োগ ভাবুন`,
        });
      }
    }
    return out;
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
    // CA6 spike verdict (2026-10-17, checked against Meta's
    // official documentation): the Graph API exposes NO
    // audience-overlap endpoint — the Custom Audience node's
    // documented edges are adaccounts / ads / health /
    // sessions / shared_account_info, and the legacy
    // /audienceoverlap reach-estimation path is not a current
    // documented API. Overlap exists only inside the Ads
    // Manager UI tool. So overlap stays not_computable —
    // now with the platform reason, not just the local one.
    const overlap = distinctIncluded.size <= 1
      ? { status: "not_applicable", reason: "একটির বেশি Included Audience নেই — Overlap-এর প্রশ্নই ওঠে না" }
      : { status: "not_computable", reason: "Meta Graph API-তে Audience Overlap-এর কোনো Endpoint নেই (Custom Audience Node-এর নথিভুক্ত Edge: adaccounts/ads/health/sessions/shared_account_info — যাচাই 2026-10-17); Overlap শুধু Meta Ads Manager-এর Audience Overlap টুলে দেখা যায়। সদস্যদের Hash তালিকাও সংরক্ষণ করা হয় না, তাই এখান থেকে হিসাব করা যায় না" };
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
    regions?: any[];
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
    // CA9: regions are { key, name } pairs (Meta region key
    // resolved from targeting search — never a typed-in
    // guess). Same set/delete discipline as cities.
    if (dto.regions !== undefined) {
      if (dto.regions?.length) {
        t.regions = dto.regions
          .map((r: any) => ({ key: String(r?.key ?? "").trim(), ...(r?.name ? { name: String(r.name) } : {}) }))
          .filter((r: any) => r.key);
        if (!t.regions.length) delete t.regions;
      } else delete t.regions;
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
    regions?: any[];
    bidStrategy?: string; bidAmount?: string; costPerResultGoal?: string; roasGoal?: string;
    conversionEvent?: string; catalogRecordId?: string; productSetId?: string; leadFormId?: string;
    destinationType?: string; whatsappIntegrationId?: string;
    appId?: string; appStoreUrl?: string;
    startTime?: string; endTime?: string;
    useNamingTemplate?: boolean;
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
    // CA13: naming convention (blank name or explicit
    // opt-in only; a referenced saved audience names the
    // {audience} token when the stored targeting has one).
    const adSetName = await this.nameAtCreate(organizationId, dto.name, {
      useTemplate: dto.useNamingTemplate,
      values: {
        objective: plan.objective, platform: "Meta", date: await this.orgToday(organizationId),
        audience: await (async () => {
          const savedId = (targeting as any)?.savedAudienceId;
          if (!savedId || !(this.prisma as any).savedAudience?.findFirst) return null;
          const saved = await (this.prisma as any).savedAudience.findFirst({ where: { id: String(savedId), organizationId } }).catch(() => null);
          return saved?.name ?? null;
        })(),
      },
    });
    const adSet = await (this.prisma as any).campaignAdSet.create({
      data: {
        planId, name: adSetName,
        dailyBudgetMinor: dto.dailyBudget ? parseMoneyToMinor(dto.dailyBudget) : null,
        lifetimeBudgetMinor: dto.lifetimeBudget ? parseMoneyToMinor(dto.lifetimeBudget) : null,
        optimizationGoal: dto.optimizationGoal, pageId: dto.pageId ?? null, pixelId: dto.pixelId ?? null,
        targeting: targeting as any,
        bidStrategy: bid.bidStrategy, bidAmountMinor: bid.bidAmountMinor, costGoalMinor: bid.costGoalMinor, roasAverageFloor: bid.roasAverageFloor,
        conversionEvent: dto.conversionEvent ?? null,
        catalogRecordId: dto.catalogRecordId ?? null, productSetId: dto.productSetId ?? null, leadFormId: dto.leadFormId ?? null,
        // CA23: app-promotion pair (stored verbatim; the
        // structural requirement is validatePlan's).
        appId: dto.appId?.trim() || null, appStoreUrl: dto.appStoreUrl?.trim() || null,
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
    regions?: any[];
    bidStrategy?: string; bidAmount?: string; costPerResultGoal?: string; roasGoal?: string;
    conversionEvent?: string; catalogRecordId?: string; productSetId?: string; leadFormId?: string;
    destinationType?: string; whatsappIntegrationId?: string;
    appId?: string; appStoreUrl?: string;
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
    // CA23: app-promotion pair ("" clears).
    if (dto.appId !== undefined) data.appId = dto.appId?.trim() || null;
    if (dto.appStoreUrl !== undefined) data.appStoreUrl = dto.appStoreUrl?.trim() || null;
    if (dto.pixelId !== undefined) data.pixelId = dto.pixelId || null;
    if (dto.dailyBudget !== undefined || dto.lifetimeBudget !== undefined) {
      if (!dto.dailyBudget && !dto.lifetimeBudget) throw new BadRequestException("Either a daily or a lifetime budget is required");
      data.dailyBudgetMinor = dto.dailyBudget ? parseMoneyToMinor(dto.dailyBudget) : null;
      data.lifetimeBudgetMinor = dto.lifetimeBudget ? parseMoneyToMinor(dto.lifetimeBudget) : null;
    }
    const targetingTouched = ["countries", "ageMin", "ageMax", "genders", "interests", "customAudienceIds", "excludedAudienceIds", "platforms", "positions", "devices",
      "cities", "postcodes", "locationTypes", "locales", "behaviors", "demographics", "narrowInterests", "narrowBehaviors", "targetingExpansion", "regions"]
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
    // CA4: locale-labelled translations live under
    // `locales` inside the same JSON — a client round-trip
    // of the stored object must not silently drop them.
    const locales = (input as any).locales;
    return locales && typeof locales === "object" ? ({ primaryTexts, headlines, descriptions, locales } as any) : { primaryTexts, headlines, descriptions };
  }

  /** PATCH re-sync: a legacy field edit on an ad that
   *  carries options replaces option index 0, keeping the
   *  remaining options — the invariant above survives
   *  ordinary edits. */
  private resyncTextOptions(existing: any, patch: { primaryText?: string; headline?: string | null; description?: string | null }): any {
    if (!existing || typeof existing !== "object") return existing ?? null;
    const out: any = {
      primaryTexts: [...(existing.primaryTexts ?? [])],
      headlines: [...(existing.headlines ?? [])],
      descriptions: [...(existing.descriptions ?? [])],
    };
    // CA4: keep locale-labelled translations across edits.
    if ((existing as any).locales) out.locales = (existing as any).locales;
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
    useNamingTemplate?: boolean;
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
    // CA13: naming convention (blank name or explicit
    // opt-in only; {product} resolves from the ad's linked
    // product when it has one).
    const adName = await this.nameAtCreate(organizationId, dto.name, {
      useTemplate: dto.useNamingTemplate,
      values: {
        objective: plan.objective, platform: "Meta", date: await this.orgToday(organizationId),
        product: dto.productId
          ? ((await (this.prisma as any).product.findFirst({ where: { id: dto.productId, organizationId } }).catch(() => null))?.name ?? null)
          : null,
      },
    });
    const ad = await (this.prisma as any).campaignAd.create({
      data: {
        adSetId, name: adName,
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
    // CA27: snapshot the BEFORE image when this edit
    // actually changes content — a version list full of
    // no-op entries would be noise, not history. The
    // snapshot is best-effort bookkeeping (like the audit
    // log): a missing table (pre-migration env) never
    // blocks the edit itself.
    const before = CampaignsService.adContentOf(ad);
    const afterPreview: Record<string, unknown> = { ...before };
    for (const k of Object.keys(data)) {
      if ((CampaignsService.AD_CONTENT_FIELDS as readonly string[]).includes(k)) afterPreview[k] = (data as any)[k] ?? null;
    }
    if (JSON.stringify(before) !== JSON.stringify(afterPreview)) {
      await this.snapshotAdVersion(organizationId, ad, actorId, "edit").catch(() => undefined);
    }
    const updated = await (this.prisma as any).campaignAd.update({ where: { id: adId }, data });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.ad_updated", entityType: "CampaignAd", entityId: adId, metadata: { fields: Object.keys(data) } }).catch(() => undefined);
    return updated;
  }

  /** CA27: the content fields a version snapshot covers.
   * External ids, the ad-set binding and timestamps are
   * NOT content: restoring a snapshot never touches the
   * ad's Meta binding. */
  static readonly AD_CONTENT_FIELDS = [
    "name", "primaryText", "headline", "description", "linkUrl", "callToAction",
    "imageUrl", "productId", "format", "imageAssetId", "videoAssetId", "carouselCards",
    "textOptions", "placementAssets", "creativeEnhancements", "whatsappWelcome",
  ] as const;

  static adContentOf(ad: any): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of CampaignsService.AD_CONTENT_FIELDS) out[f] = ad?.[f] ?? null;
    return out;
  }

  /** CA27: append a before-image version for an ad.
   * Returns null when the version table is unavailable —
   * versioning then degrades honestly (endpoints say so)
   * instead of breaking ad edits. */
  private async snapshotAdVersion(organizationId: string, ad: any, actorId: string, source: "edit" | "restore") {
    const table = (this.prisma as any).campaignAdVersion;
    if (!table?.create) return null;
    const existing = table.findMany ? await table.findMany({ where: { adId: ad.id } }).catch(() => []) : [];
    const version = (existing?.length ?? 0) + 1;
    return table.create({
      data: { adId: ad.id, organizationId, version, snapshot: CampaignsService.adContentOf(ad), source, createdById: actorId },
    });
  }

  private async adForVersions(organizationId: string, planId: string, adId: string) {
    await this.getPlanOrThrow(organizationId, planId);
    const ad = await (this.prisma as any).campaignAd.findFirst({ where: { id: adId, adSet: { planId } } });
    if (!ad) throw new NotFoundException("Ad not found in this plan");
    return ad;
  }

  /** CA27: an ad's version list (metadata only — the
   * snapshot bodies ride the diff endpoint). */
  async adVersions(organizationId: string, planId: string, adId: string) {
    await this.adForVersions(organizationId, planId, adId);
    const table = (this.prisma as any).campaignAdVersion;
    if (!table?.findMany) return { adId, versions: [], note: "Version table পাওয়া যাচ্ছে না — Migration বাকি থাকতে পারে।" };
    const rows = await table.findMany({ where: { adId }, orderBy: { version: "desc" } }).catch(() => []);
    return {
      adId,
      versions: rows.map((r: any) => ({ id: r.id, version: r.version, source: r.source, createdById: r.createdById ?? null, createdAt: r.createdAt })),
      note: "প্রতিটি সংস্করণ হলো বদলের আগের রূপ (Before-image) — Restore করলে বর্তমান রূপটিও নতুন সংস্করণ হিসেবে থেকে যায়, ইতিহাস কখনো মোছা বা বদলানো হয় না।",
    };
  }

  /** CA27: field-by-field diff of one version's snapshot
   * against the ad's CURRENT content. */
  async adVersionDiff(organizationId: string, planId: string, adId: string, versionId: string) {
    const ad = await this.adForVersions(organizationId, planId, adId);
    const table = (this.prisma as any).campaignAdVersion;
    if (!table?.findFirst) throw new BadRequestException("Version table পাওয়া যাচ্ছে না — Migration বাকি থাকতে পারে।");
    const row = await table.findFirst({ where: { id: versionId, adId } });
    if (!row) throw new NotFoundException("Ad version not found");
    const current = CampaignsService.adContentOf(ad);
    const snap = (row.snapshot ?? {}) as Record<string, unknown>;
    const changes = CampaignsService.AD_CONTENT_FIELDS
      .filter((f) => JSON.stringify(snap[f] ?? null) !== JSON.stringify(current[f] ?? null))
      .map((f) => ({ field: f, versionValue: snap[f] ?? null, currentValue: current[f] ?? null }));
    return { adId, version: row.version, source: row.source, createdAt: row.createdAt, changes, identical: changes.length === 0 };
  }

  /** CA27: restore one version's content into the ad.
   * The pre-restore state is snapshotted FIRST (source
   * "restore"), so a restore is itself reversible and
   * history is append-only. Only content fields are
   * written — the Meta binding (externalAdId) and the
   * ad-set placement never move. */
  async restoreAdVersion(organizationId: string, planId: string, adId: string, actorId: string, versionId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    this.assertEditable(plan);
    const ad = await this.adForVersions(organizationId, planId, adId);
    const table = (this.prisma as any).campaignAdVersion;
    if (!table?.findFirst) throw new BadRequestException("Version table পাওয়া যাচ্ছে না — Migration বাকি থাকতে পারে।");
    const row = await table.findFirst({ where: { id: versionId, adId } });
    if (!row) throw new NotFoundException("Ad version not found");
    await this.snapshotAdVersion(organizationId, ad, actorId, "restore");
    const snap = (row.snapshot ?? {}) as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    for (const f of CampaignsService.AD_CONTENT_FIELDS) data[f] = snap[f] ?? null;
    const updated = await (this.prisma as any).campaignAd.update({ where: { id: adId }, data });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.ad_version_restored", entityType: "CampaignAd", entityId: adId, metadata: { restoredVersion: row.version } }).catch(() => undefined);
    return updated;
  }

  /** CA27: assemble carousel cards from a product set's
   * REAL products. The set's stored criteria (category,
   * maxPriceMinor, inStockOnly) select org Product rows;
   * each card is the product's own name, formatted real
   * price and image, linked at the AD's destination URL
   * (cards inherit the ad's link — no invented product
   * URLs). Manual-card preservation: when the ad already
   * has cards and replace is not explicitly set, NOTHING
   * is written — the would-be cards return as a preview.
   * Applying goes through updateAd, so the previous
   * cards are snapshotted as an ad version first
   * (CA27 restore can bring them back). */
  async assembleCatalogCarousel(organizationId: string, actorId: string, planId: string, adId: string, dto: { productSetId?: string; replace?: boolean; limit?: number }) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    this.assertEditable(plan);
    const ad = await (this.prisma as any).campaignAd.findFirst({ where: { id: adId, adSet: { planId } } });
    if (!ad) throw new NotFoundException("Ad not found in this plan");
    const adSet = await (this.prisma as any).campaignAdSet.findFirst({ where: { id: ad.adSetId, planId } });
    const setId = dto.productSetId ?? adSet?.productSetId;
    if (!setId) throw new BadRequestException("এই Ad Set-এ কোনো Product Set যুক্ত নেই — আগে Ad Set-এ Catalog Product Set বাছাই করুন, অথবা productSetId পাঠান।");
    const set = await (this.prisma as any).productSet?.findFirst?.({ where: { id: setId, organizationId } }).catch(() => null) ?? null;
    if (!set) throw new NotFoundException("Product set not found in this organization");
    const where: any = { organizationId, status: "ACTIVE" };
    if (set.category) where.category = set.category;
    if (set.maxPriceMinor != null) where.priceMinor = { lte: set.maxPriceMinor };
    const rows = await (this.prisma as any).product.findMany({ where, orderBy: { createdAt: "desc" }, take: 50 }).catch(() => []);
    const inStock = (p: any) => !set.inStockOnly || p.stockQuantity == null || Number(p.stockQuantity) > 0;
    const limit = Math.min(Math.max(dto.limit ?? 10, 2), 10);
    const products = (rows as any[]).filter(inStock).slice(0, limit);
    if (products.length < 2) {
      throw new BadRequestException(`এই Product Set-এর শর্তে যথেষ্ট Product পাওয়া যায়নি (পাওয়া গেছে ${products.length}টি, Carousel-এ কমপক্ষে ২টি লাগে) — Set-এর শর্ত শিথিল করুন বা Product যোগ করুন।`);
    }
    const cards = products.map((p: any) => ({
      title: String(p.name).slice(0, 120),
      description: `দাম ${formatMinor(BigInt(p.priceMinor), p.currency ?? "BDT")}`,
      linkUrl: ad.linkUrl,
      ...(p.imageUrl ? { imageUrl: p.imageUrl } : {}),
    }));
    const criteria = { category: set.category ?? null, maxPriceMinor: set.maxPriceMinor != null ? String(set.maxPriceMinor) : null, inStockOnly: !!set.inStockOnly };
    if (Array.isArray(ad.carouselCards) && ad.carouselCards.length > 0 && !dto.replace) {
      return {
        applied: false,
        reason: "এই Ad-তে আগেই হাতে বসানো কার্ড আছে — Assembly সেগুলো চাপা দেয়নি। কার্ডগুলো বদলাতে চাইলে replace: true পাঠান (আগের কার্ড Ad Version হিসেবে থেকে যাবে, Restore করা যাবে)।",
        productSet: { id: set.id, name: set.name, status: set.status },
        criteria,
        previewCards: cards,
        existingCards: ad.carouselCards,
      };
    }
    const updated = await this.updateAd(organizationId, planId, adId, actorId, { format: "carousel", carouselCards: cards });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.carousel_assembled", entityType: "CampaignAd", entityId: adId, metadata: { productSetId: set.id, cards: cards.length } }).catch(() => undefined);
    return {
      applied: true,
      productSet: { id: set.id, name: set.name, status: set.status },
      criteria,
      cards,
      ad: updated,
      note: "কার্ডগুলো আসল Product ডেটা থেকে — নাম, দাম ও ছবি Product Row-এর; লিংক Ad-এর Destination URL।",
    };
  }

  /** CA28: the public URL of a landing slug. The path is
   * always known; the absolute URL rides the SAME env
   * precedent the feeds module uses (WEB_PUBLIC_URL ??
   * APP_PUBLIC_URL) and is null — stated, not guessed —
   * when neither is configured. */
  private landingUrlFor(slug: string) {
    const base = (process.env.WEB_PUBLIC_URL ?? process.env.APP_PUBLIC_URL ?? "").replace(/\/+$/, "");
    return { path: `/l/${slug}`, url: base ? `${base}/l/${slug}` : null };
  }

  /** CA28: create a landing page for a plan (or one of
   * its ads) from the plan's REAL product, through the
   * EXISTING EC13 LandingsService — its slug, sections
   * and publish-state rules are unchanged (the page is
   * a normal LandingPage row whose public rendering
   * composes the Product row's own name/price/images).
   * Product resolution: explicit productId, else the
   * chosen ad's productId, else the first ad in the plan
   * carrying one; no product anywhere = an honest
   * refusal (a landing without a product is not a page
   * this machinery serves). The landing is created as a
   * DRAFT unless publish is explicitly requested — the
   * machinery's own status vocabulary either way. */
  async createPlanLanding(organizationId: string, actorId: string, planId: string, dto: { adId?: string; productId?: string; publish?: boolean }) {
    if (!this.landings) {
      throw new BadRequestException("Landing Service এই Build-এ যুক্ত নয় — Builder থেকে Landing তৈরি করা যাচ্ছে না (Landings পেজ থেকে তৈরি করা যাবে)।");
    }
    const plan = await this.getPlanOrThrow(organizationId, planId);
    this.assertEditable(plan);
    const full = await this.getPlanFull(organizationId, planId);
    let productId = dto.productId ?? null;
    if (!productId && dto.adId) {
      for (const s of full.adSets ?? []) {
        const ad = (s.ads ?? []).find((a: any) => a.id === dto.adId);
        if (ad) { productId = (ad as any).productId ?? null; break; }
      }
      if (!productId) throw new BadRequestException("বেছে নেওয়া Ad-টিতে কোনো Product যুক্ত নেই — Landing Page Product ছাড়া তৈরি হয় না। Ad-তে Product বাছাই করুন, অথবা Product-সহ অন্য Ad বেছে নিন।");
    }
    if (!productId) {
      for (const s of full.adSets ?? []) {
        const ad = (s.ads ?? []).find((a: any) => a.productId);
        if (ad) { productId = (ad as any).productId; break; }
      }
    }
    if (!productId) throw new BadRequestException("এই Plan-এর কোনো Ad-তেই Product যুক্ত নেই — Landing Page Product ছাড়া তৈরি হয় না।");
    const product = await (this.prisma as any).product.findFirst({ where: { id: productId, organizationId } });
    if (!product) throw new NotFoundException("Product not found in this organization");
    const landing = await this.landings.create(organizationId, actorId, {
      productId, title: String(product.name).slice(0, 200),
      status: dto.publish ? "published" : "draft",
    } as any);
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.landing_created", entityType: "LandingPage", entityId: landing.id, metadata: { planId, productId, slug: landing.slug, status: landing.status } }).catch(() => undefined);
    // Existing landings for the same product ride along
    // so the builder can offer one instead of duplicating.
    const existing = await this.landings.list(organizationId).catch(() => []);
    const existingForProduct = (existing as any[])
      .filter((l) => l.productId === productId && l.id !== landing.id)
      .map((l) => ({ id: l.id, slug: l.slug, status: l.status, title: l.title, ...this.landingUrlFor(l.slug) }));
    return {
      landing: { id: landing.id, slug: landing.slug, status: landing.status, title: landing.title, productId: landing.productId },
      ...this.landingUrlFor(landing.slug),
      product: { id: product.id, name: product.name },
      existingForProduct,
      note: landing.status === "published"
        ? "Landing তৈরি ও Publish হয়েছে — Public পেজটি Product Row-এর আসল নাম/দাম/ছবি দেখাবে। Ad-এ বসাতে চাইলে আলাদাভাবে নিশ্চিত করুন (নিচের Apply ধাপ)।"
        : "Landing Draft হিসেবে তৈরি হয়েছে — Publish না করা পর্যন্ত Public পেজ খুলবে না এবং Ad-এ বসানো যাবে না (Landings পেজ থেকে Publish করুন)।",
    };
  }

  /** CA28: offer a landing's URL into an ad's linkUrl —
   * a separate, explicit step (the builder confirms;
   * creation NEVER touches the ad). Only a PUBLISHED
   * landing may be applied: the public machinery serves
   * nothing else (getPublishedLanding), so pointing an
   * ad at a draft would send buyers to a dead page. The
   * write rides updateAd, so the previous link is
   * snapshotted as an ad version (CA27) first. */
  async applyLandingToAd(organizationId: string, actorId: string, planId: string, adId: string, landingId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    this.assertEditable(plan);
    const landing = await (this.prisma as any).landingPage?.findFirst?.({ where: { id: landingId, organizationId } }).catch(() => null) ?? null;
    if (!landing) throw new NotFoundException("Landing page not found in this organization");
    if (landing.status !== "published") {
      throw new BadRequestException(`এই Landing টি এখন "${landing.status}" অবস্থায় আছে — Publish করা Landing ছাড়া Ad-এ বসানো যায় না, কারণ Public পেজ শুধু Published Landing-ই দেখায়। আগে Landings পেজ থেকে Publish করুন।`);
    }
    const { url, path } = this.landingUrlFor(landing.slug);
    if (!url) {
      throw new BadRequestException("সার্ভারে WEB_PUBLIC_URL/APP_PUBLIC_URL সেট নেই — Landing-এর পূর্ণ URL জানা যাচ্ছে না, তাই Ad-এ বসানো হয়নি (আপেক্ষিক Path Meta-র কাছে পৌঁছাবে না)।");
    }
    const updated = await this.updateAd(organizationId, planId, adId, actorId, { linkUrl: url });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.landing_applied_to_ad", entityType: "CampaignAd", entityId: adId, metadata: { landingId, slug: landing.slug, path } }).catch(() => undefined);
    return { ad: updated, landing: { id: landing.id, slug: landing.slug, status: landing.status }, url, path };
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
    if (fullPlan.advantagePlus && !["OUTCOME_SALES", "OUTCOME_APP_PROMOTION"].includes(fullPlan.objective)) {
      errors.push("Advantage+ runs on the Sales or App Promotion objectives: the plan objective must be OUTCOME_SALES or OUTCOME_APP_PROMOTION");
    }
    // CA23: a TRUE Advantage+ campaign (Meta's unified
    // Advantage+ guide, verified 2026-10-17) additionally
    // requires (a) NO placement targeting on ANY ad set —
    // one restricted set turns the whole campaign's
    // advantage_state to DISABLED — and (b) ONE campaign
    // bid strategy, because the budget (and its bid) lives
    // at campaign level. Both conflicts are named here so
    // publish never silently drops the merchant's settings.
    if (fullPlan.advantagePlus) {
      for (const s of fullPlan.adSets ?? []) {
        const restricted = CampaignsService.placementRestrictionsOf(s.targeting);
        if (restricted.length) {
          errors.push(`Ad set "${s.name}": placement restrictions (${restricted.join(", ")}) conflict with Advantage+ — Meta requires every placement open on every ad set. Remove the placement restrictions or turn Advantage+ off`);
        }
      }
      if ((fullPlan.adSets ?? []).length && !this.advantageCampaignBid(fullPlan)) {
        errors.push("Advantage+ needs ONE campaign bid strategy: the ad sets disagree on bid strategy or amounts — make every ad set use the same bid strategy (and amount) or turn Advantage+ off");
      }
    }
    // CA23: app promotion structure (any app plan, with or
    // without Advantage+). Publish sends promoted_object
    // { application_id, object_store_url } per ad set and
    // optimizes on APP_INSTALLS (Meta's app-ads contract);
    // a missing piece is named, never invented.
    if (fullPlan.objective === "OUTCOME_APP_PROMOTION") {
      for (const s of fullPlan.adSets ?? []) {
        if (!s.appId) errors.push(`Ad set "${s.name}": App ID is required for app promotion (Meta application_id)`);
        if (!s.appStoreUrl) errors.push(`Ad set "${s.name}": App Store / Play Store URL is required for app promotion (Meta object_store_url)`);
        if (s.optimizationGoal !== "APP_INSTALLS") errors.push(`Ad set "${s.name}": app promotion optimizes on APP_INSTALLS — set the ad set's optimization goal to APP_INSTALLS`);
      }
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
      // CA6: an audience that is BOTH included and excluded
      // (directly, or via an applied exclusion preset) is a
      // contradiction — Meta would silently honour one side.
      // It is named here, at structure level, never published
      // as-is. Preset entries carry their own external id, so
      // a preset-only exclusion conflicts the same way.
      {
        const t = (adSet.targeting as any) ?? {};
        const includedIds: string[] = Array.isArray(t.customAudienceIds) ? t.customAudienceIds.map(String) : [];
        const excludedIds = new Set<string>([
          ...(Array.isArray(t.excludedAudienceIds) ? t.excludedAudienceIds.map(String) : []),
          ...(Array.isArray(t.exclusionPresets) ? t.exclusionPresets.map((p: any) => String(p?.externalAudienceId ?? "")).filter(Boolean) : []),
        ]);
        for (const id of includedIds) {
          if (excludedIds.has(id)) errors.push(`Ad set "${adSet.name}": audience ${id} is both included and excluded — remove it from one side`);
        }
      }
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
        // CA23: the app-promotion pair freezes too — but
        // ONLY on app plans, so existing plans' snapshots
        // stay byte-stable (an app field on a sales plan
        // is meaningless and must not fake a "change").
        ...(full.objective === "OUTCOME_APP_PROMOTION" ? {
          appId: s.appId ?? null,
          appStoreUrl: s.appStoreUrl ?? null,
        } : {}),
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
      await createAgentNotification(this.prisma as any, { organizationId, userId, type, title: title.slice(0, 120), body: body.slice(0, 500) }).catch(() => undefined);
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

  /** CA14: a fixed-amount (±) live budget adjustment
   * across a plan's live ad sets — the fixed-BDT sibling
   * of scalePlanBudgets. Parity rules: same live-set
   * selection (externalAdSetId + daily budget), same
   * updateAdSetBudget path (Meta-confirmed, per-set
   * audit). Fixed-specific guard: the delta is pre-checked
   * against EVERY set first — if any set would land at
   * <= 0 the whole plan is refused with NO set changed
   * (a percent scale can never cross zero; a fixed cut
   * can). */
  async adjustPlanBudgetsFixed(organizationId: string, actorId: string, planId: string, deltaMinor: bigint) {
    const plan = await this.getPlanFull(organizationId, planId);
    const live = (plan.adSets ?? []).filter((s: any) => s.externalAdSetId && s.dailyBudgetMinor != null);
    if (!live.length) return [];
    for (const s of live) {
      if (BigInt(s.dailyBudgetMinor) + deltaMinor <= 0n) {
        throw new BadRequestException(`Fixed adjust ${deltaMinor} would take ad set "${s.name}" to <= 0 — refused, nothing changed`);
      }
    }
    const out: { adSetId: string; beforeMinor: string; afterMinor: string; metaWriteOk: boolean }[] = [];
    for (const s of live) {
      const before = BigInt(s.dailyBudgetMinor);
      const after = before + deltaMinor;
      // updateAdSetBudget throws when Meta refuses, so
      // reaching the push means the Meta write succeeded
      // (it performs no read-back — metaWriteOk states
      // exactly that, nothing more).
      await this.updateAdSetBudget(organizationId, actorId, planId, s.id, { dailyBudget: CampaignsService.minorToMajorString(after) });
      out.push({ adSetId: s.id, beforeMinor: before.toString(), afterMinor: after.toString(), metaWriteOk: true });
    }
    return out;
  }

  /** CA14: server-side bulk operations over the existing
   * single-item services (setMetaStatus / scalePlanBudgets
   * / adjustPlanBudgetsFixed / duplicatePlan) — the
   * client-side per-plan loop is replaced by ONE call
   * whose response carries a per-item result for every
   * plan: partial failure is reported as partial, never
   * dressed up as full success. Every item is org-scoped
   * (a foreign id is a per-item plan_not_found, not a
   * leak and not a batch failure); per-item audits come
   * from the underlying operations, plus one summary
   * audit row here. Sequential by design (Meta calls). */
  async bulkPlanAction(organizationId: string, actorId: string, dto: { planIds?: string[]; action?: string; percent?: number; fixedMinor?: string }) {
    const action = String(dto.action ?? "");
    if (!["pause", "activate", "budget_percent", "budget_fixed", "duplicate"].includes(action)) {
      throw new BadRequestException("action must be pause, activate, budget_percent, budget_fixed or duplicate");
    }
    const planIds = [...new Set((dto.planIds ?? []).map((x) => String(x)).filter(Boolean))];
    if (!planIds.length) throw new BadRequestException("planIds is required");
    if (planIds.length > 50) throw new BadRequestException("একবারে সর্বোচ্চ ৫০টি Plan");
    let percent = 0;
    let delta = 0n;
    if (action === "budget_percent") {
      percent = Math.trunc(Number(dto.percent));
      if (!Number.isFinite(percent) || percent === 0) throw new BadRequestException("percent must be a non-zero number");
      if (percent < -90 || percent > 900) throw new BadRequestException("percent must be between -90 and +900");
    }
    if (action === "budget_fixed") {
      try { delta = BigInt(String(dto.fixedMinor ?? "")); } catch { throw new BadRequestException("fixedMinor must be an integer minor-unit amount"); }
      if (delta === 0n) throw new BadRequestException("fixedMinor must be non-zero");
    }
    const results: { planId: string; ok: boolean; result?: any; error?: string }[] = [];
    for (const planId of planIds) {
      try {
        const plan = await (this.prisma as any).campaignPlan.findFirst({ where: { id: planId, organizationId } });
        if (!plan) { results.push({ planId, ok: false, error: "plan_not_found" }); continue; }
        if (action === "pause" || action === "activate") {
          if (plan.status !== "published") { results.push({ planId, ok: false, error: "not_published" }); continue; }
          const r: any = await this.setMetaStatus(organizationId, actorId, planId, action === "pause" ? "PAUSED" : "ACTIVE");
          results.push({ planId, ok: true, result: { metaStatus: r?.metaStatus ?? (action === "pause" ? "PAUSED" : "ACTIVE") } });
        } else if (action === "budget_percent") {
          const rows = await this.scalePlanBudgets(organizationId, actorId, planId, percent, {});
          if (!rows.length) { results.push({ planId, ok: false, error: "no_live_budget_path" }); continue; }
          results.push({ planId, ok: true, result: { changed: rows } });
        } else if (action === "budget_fixed") {
          const rows = await this.adjustPlanBudgetsFixed(organizationId, actorId, planId, delta);
          if (!rows.length) { results.push({ planId, ok: false, error: "no_live_budget_path" }); continue; }
          results.push({ planId, ok: true, result: { changed: rows } });
        } else {
          const copy: any = await this.duplicatePlan(organizationId, actorId, planId);
          results.push({ planId, ok: true, result: { newPlanId: copy.id, status: copy.status } });
        }
      } catch (e) {
        results.push({ planId, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    const succeeded = results.filter((r) => r.ok).length;
    await this.audit.log({
      organizationId, userId: actorId, action: "campaign.bulk_action",
      entityType: "campaignPlan", entityId: planIds[0],
      metadata: { bulkAction: action, requested: planIds.length, succeeded, failed: planIds.length - succeeded },
    }).catch(() => undefined);
    return { action, results, succeeded, failed: planIds.length - succeeded };
  }

  // ---------- CA13: naming conventions ----------

  /** The org's naming template, stored on BusinessProfile
   * (the Organization Settings record). Absent profile or
   * null column = no convention — names stay as typed. */
  private async namingTemplate(organizationId: string): Promise<string | null> {
    const profile = await (this.prisma as any).businessProfile?.findUnique?.({ where: { organizationId } }).catch(() => null);
    const t = profile?.campaignNamingTemplate;
    return typeof t === "string" && t.trim() ? t : null;
  }

  async getNamingTemplate(organizationId: string) {
    const template = await this.namingTemplate(organizationId);
    return {
      template,
      tokens: [...NAMING_TOKENS],
      sample: template ? renderNamingTemplate(template, { product: "Panjabi", audience: "Dhaka Men", objective: "OUTCOME_SALES", date: "2026-10-17", platform: "Meta" }) : null,
    };
  }

  async setNamingTemplate(organizationId: string, actorId: string, dto: { template?: string | null }) {
    const table = (this.prisma as any).businessProfile;
    if (!table?.findUnique) throw new BadRequestException("Naming settings are not available in this context (BusinessProfile table missing)");
    const raw = dto?.template == null ? null : String(dto.template).trim();
    if (raw !== null) {
      if (raw.length > 200) throw new BadRequestException("Template সর্বোচ্চ ২০০ অক্ষরের হতে পারে");
      const used = [...raw.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1].toLowerCase());
      const unknown = used.filter((t) => !(NAMING_TOKENS as readonly string[]).includes(t));
      if (unknown.length) throw new BadRequestException(`অজানা token: ${unknown.map((t) => `{${t}}`).join(", ")} — ব্যবহারযোগ্য token: ${NAMING_TOKENS.map((t) => `{${t}}`).join(" ")}`);
      if (!used.length) throw new BadRequestException("Template-এ অন্তত একটি token থাকতে হবে — নইলে সব নাম একই হয়ে যাবে");
    }
    const template = raw === "" ? null : raw;
    const existing = await table.findUnique({ where: { organizationId } }).catch(() => null);
    if (existing) await table.update({ where: { organizationId }, data: { campaignNamingTemplate: template } });
    else await table.create({ data: { organizationId, campaignNamingTemplate: template } });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.naming_template_updated", entityType: "BusinessProfile", entityId: organizationId, metadata: { template } }).catch(() => undefined);
    return this.getNamingTemplate(organizationId);
  }

  /** YYYY-MM-DD in the ORG's timezone (en-CA formats ISO
   * order); falls back to the UTC date if the tz is bad. */
  private async orgToday(organizationId: string): Promise<string> {
    const tz = await this.orgTimezone(organizationId);
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  }

  /** Create-time naming: the template applies ONLY when
   * the name is blank or the caller explicitly opted in
   * (useNamingTemplate) — a typed name is NEVER silently
   * overwritten. A blank render (no template, or every
   * token empty) keeps the original name. */
  private async nameAtCreate(organizationId: string, currentName: string, opts: { useTemplate?: boolean; values: Record<string, string | null | undefined> }): Promise<string> {
    const typed = (currentName ?? "").trim();
    if (typed && !opts.useTemplate) return currentName;
    const template = await this.namingTemplate(organizationId);
    if (!template) return currentName;
    const rendered = renderNamingTemplate(template, opts.values);
    return rendered || currentName;
  }

  /** The token values one plan tree genuinely has: the
   * plan's objective/platform/date at every level, the
   * saved-audience name on ad sets that reference one,
   * the product name on ads linked to a product. Missing
   * values render empty — never invented. */
  private async namingItemsForPlan(organizationId: string, full: any): Promise<any[]> {
    const date = await this.orgToday(organizationId);
    const base = { objective: full.objective, platform: "Meta", date };
    const items: any[] = [{ level: "plan", id: full.id, currentName: full.name, values: base }];
    for (const s of full.adSets ?? []) {
      let audience: string | null = null;
      const savedId = (s.targeting as any)?.savedAudienceId;
      if (savedId && (this.prisma as any).savedAudience?.findFirst) {
        const saved = await (this.prisma as any).savedAudience.findFirst({ where: { id: String(savedId), organizationId } }).catch(() => null);
        audience = saved?.name ?? null;
      }
      items.push({ level: "ad_set", id: s.id, currentName: s.name, values: { ...base, audience } });
      for (const ad of s.ads ?? []) {
        let product: string | null = null;
        if (ad.productId && (this.prisma as any).product?.findFirst) {
          const prod = await (this.prisma as any).product.findFirst({ where: { id: ad.productId, organizationId } }).catch(() => null);
          product = prod?.name ?? null;
        }
        items.push({ level: "ad", id: ad.id, currentName: ad.name, values: { ...base, audience, product } });
      }
    }
    return items;
  }

  /** CA13: the rename PREVIEW — what the template would
   * make of this plan's tree. Nothing is renamed here. */
  async previewNamingApply(organizationId: string, planId: string) {
    const template = await this.namingTemplate(organizationId);
    if (!template) throw new BadRequestException("কোনো Naming Template সেট করা নেই — আগে Organization Settings / Campaign Settings-এ Template বসান");
    const full = await this.getPlanFull(organizationId, planId);
    const raw = await this.namingItemsForPlan(organizationId, full);
    const items = raw.map((it) => {
      const newName = renderNamingTemplate(template, it.values);
      return { level: it.level, id: it.id, currentName: it.currentName, newName: newName || null, changed: !!newName && newName !== it.currentName };
    });
    return {
      template, items,
      note: "এটি শুধু Preview — Apply নিশ্চিত না করলে কোনো নাম বদলাবে না। Apply শুধু এই সিস্টেমের রেকর্ডের নাম বদলায়; Meta-তে থাকা Campaign/Ad Set/Ad-এর নাম বদলায় না।",
    };
  }

  /** CA13: apply a CONFIRMED rename preview. The server
   * re-renders and each item's newName must match the
   * fresh render exactly — a stale or hand-edited preview
   * is refused per item, never applied. Local records
   * only: Meta object names are NOT touched (stated in
   * the response, not hidden). */
  async applyNaming(organizationId: string, actorId: string, planId: string, dto: { items: { level: string; id: string; newName: string }[] }) {
    const preview = await this.previewNamingApply(organizationId, planId);
    const fresh = new Map(preview.items.map((i: any) => [`${i.level}:${i.id}`, i]));
    const requested = (dto.items ?? []).filter((i) => i?.id && i?.level).slice(0, 200);
    if (!requested.length) throw new BadRequestException("প্রয়োগের জন্য অন্তত একটি নাম পাঠাতে হবে");
    const results: any[] = [];
    const appliedDiffs: any[] = [];
    for (const item of requested) {
      const f = fresh.get(`${item.level}:${item.id}`);
      if (!f) { results.push({ level: item.level, id: item.id, ok: false, error: "item_not_in_plan" }); continue; }
      if (!f.newName || f.newName !== item.newName) { results.push({ level: item.level, id: item.id, ok: false, error: "stale_preview", freshNewName: f.newName }); continue; }
      try {
        if (item.level === "plan") await (this.prisma as any).campaignPlan.update({ where: { id: item.id }, data: { name: item.newName } });
        else if (item.level === "ad_set") await (this.prisma as any).campaignAdSet.update({ where: { id: item.id }, data: { name: item.newName } });
        else if (item.level === "ad") await (this.prisma as any).campaignAd.update({ where: { id: item.id }, data: { name: item.newName } });
        else { results.push({ level: item.level, id: item.id, ok: false, error: "unknown_level" }); continue; }
        results.push({ level: item.level, id: item.id, ok: true, from: f.currentName, to: item.newName });
        appliedDiffs.push({ level: item.level, id: item.id, from: f.currentName, to: item.newName });
      } catch (e) {
        results.push({ level: item.level, id: item.id, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    if (appliedDiffs.length) {
      await this.audit.log({ organizationId, userId: actorId, action: "campaign.naming_applied", entityType: "CampaignPlan", entityId: planId, metadata: { template: preview.template, diffs: appliedDiffs } }).catch(() => undefined);
    }
    return {
      results,
      appliedCount: results.filter((r) => r.ok).length,
      failedCount: results.filter((r) => !r.ok).length,
      note: "নাম বদলেছে শুধু এই সিস্টেমের রেকর্ডে — Meta-তে থাকা Campaign/Ad Set/Ad-এর নাম বদলায়নি।",
      plan: await this.getPlanFull(organizationId, planId),
    };
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
    // CA9: stored regions are { key, name } pairs whose key
    // was RESOLVED from Meta's own targeting search at
    // draft-creation time — an unresolved region never
    // reaches this list (it is reported as notCarried by
    // the draft endpoint instead of being guessed here).
    if (Array.isArray(targeting.regions) && targeting.regions.length) {
      geo.regions = targeting.regions
        .map((r: any) => ({ key: String(r?.key ?? "") }))
        .filter((r: any) => r.key);
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
    // CA23: on an Advantage+ plan NO placement field is
    // sent at all — Meta's placement lever requires every
    // placement eligible, and a single restricted ad set
    // disables the campaign's Advantage+ state.
    // validatePlan already refuses such plans (naming the
    // stored restrictions), so this suppression is defence
    // in depth for paths that build targeting directly.
    if (!advantagePlus && Array.isArray(targeting.platforms) && targeting.platforms.length) {
      out.publisher_platforms = targeting.platforms;
    }
    if (!advantagePlus && Array.isArray(targeting.positions) && targeting.positions.length) {
      const FB: Record<string, string> = { feed: "feed", story: "story", reels: "facebook_reels", search: "search" };
      const IG: Record<string, string> = { feed: "stream", story: "story", reels: "reels", search: "ig_search" };
      const platforms: string[] = Array.isArray(targeting.platforms) && targeting.platforms.length ? targeting.platforms : ["facebook", "instagram"];
      const fb = targeting.positions.map((p: string) => FB[p]).filter(Boolean);
      const ig = targeting.positions.map((p: string) => IG[p]).filter(Boolean);
      if (platforms.includes("facebook") && fb.length) out.facebook_positions = fb;
      if (platforms.includes("instagram") && ig.length) out.instagram_positions = ig;
    }
    if (!advantagePlus && Array.isArray(targeting.devices) && targeting.devices.length) {
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

  /** CA26: the shape every blueprint source (DB row or
   * the pre-migration const fallback) is normalized to. */
  private blueprintShape(row: any) {
    return {
      id: row.id ?? null,
      key: row.key,
      name: row.name,
      objective: row.objective,
      advantagePlus: !!row.advantagePlus,
      description: row.description,
      adSet: row.adSet,
      ad: row.ad,
      scope: row.organizationId ? "org" : "platform",
      editable: !!row.organizationId,
      version: row.version ?? 1,
      category: row.category ?? null,
      tags: row.tags ?? [],
    };
  }

  /** CA26: blueprints are DATA now (CampaignBlueprint
   * rows, seeded by migration 20261030900000 with the
   * exact former constants). Platform rows
   * (organizationId null) are read-only for orgs; an
   * org's own clones ride along and win key collisions
   * at instantiate time. The BLUEPRINTS consts remain
   * ONLY as the seed source + a pre-migration fallback
   * for environments whose DB predates the table. */
  async listBlueprints(organizationId?: string) {
    const table = (this.prisma as any).campaignBlueprint;
    if (!table?.findMany) return BLUEPRINTS.map((b) => this.blueprintShape(b));
    const rows = await table.findMany({
      where: organizationId ? { OR: [{ organizationId: null }, { organizationId }] } : { organizationId: null },
      orderBy: [{ organizationId: "asc" }, { createdAt: "asc" }],
    }).catch(() => null);
    if (!rows) return BLUEPRINTS.map((b) => this.blueprintShape(b));
    return rows.map((r: any) => this.blueprintShape(r));
  }

  /** CA26: resolve the blueprint a caller may use — by
   * row id when given (must be platform or the org's
   * own), else by key with the org's copy winning over
   * the platform original. Null when nothing matches. */
  private async blueprintFor(organizationId: string, key?: string, rowId?: string) {
    const table = (this.prisma as any).campaignBlueprint;
    if (!table?.findFirst) {
      const bp = BLUEPRINTS.find((b) => b.key === key);
      return bp ? this.blueprintShape(bp) : null;
    }
    if (rowId) {
      const row = await table.findFirst({ where: { id: rowId } }).catch(() => null);
      if (row && (row.organizationId === null || row.organizationId === organizationId)) return this.blueprintShape(row);
      return null;
    }
    const own = await table.findFirst({ where: { key, organizationId } }).catch(() => null);
    if (own) return this.blueprintShape(own);
    const platform = await table.findFirst({ where: { key, organizationId: null } }).catch(() => null);
    return platform ? this.blueprintShape(platform) : null;
  }

  /** CA26: clone a platform blueprint into an editable
   * org-owned copy. Idempotent — a second clone returns
   * the existing copy. The platform original is never
   * modified by orgs. */
  async cloneBlueprint(organizationId: string, actorId: string, key: string) {
    const table = (this.prisma as any).campaignBlueprint;
    if (!table?.findFirst) throw new BadRequestException("Blueprint data এখনো পাওয়া যাচ্ছে না (Migration বাকি)।");
    const platform = await table.findFirst({ where: { key, organizationId: null } });
    if (!platform) throw new NotFoundException("Platform blueprint not found");
    const existing = await table.findFirst({ where: { key, organizationId } });
    if (existing) return this.blueprintShape(existing);
    const copy = await table.create({
      data: {
        key: platform.key, name: `${platform.name} (নিজের কপি)`, objective: platform.objective,
        advantagePlus: platform.advantagePlus, description: platform.description,
        adSet: platform.adSet, ad: platform.ad, organizationId,
        version: 1, category: platform.category ?? null, tags: platform.tags ?? [],
      },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.blueprint_cloned", entityType: "CampaignBlueprint", entityId: copy.id, metadata: { key, sourceId: platform.id } });
    return this.blueprintShape(copy);
  }

  /** CA26: edit an ORG-OWNED blueprint copy. Platform
   * rows refuse here — clone first. Version increments
   * on every edit; history is the version counter plus
   * the audit trail (no silent rewrites). */
  async updateOrgBlueprint(organizationId: string, actorId: string, rowId: string, dto: { name?: string; description?: string; objective?: string; advantagePlus?: boolean; adSet?: any; ad?: any; category?: string | null; tags?: string[] }) {
    const table = (this.prisma as any).campaignBlueprint;
    if (!table?.findFirst) throw new BadRequestException("Blueprint data এখনো পাওয়া যাচ্ছে না (Migration বাকি)।");
    const row = await table.findFirst({ where: { id: rowId } });
    if (!row) throw new NotFoundException("Blueprint not found");
    if (row.organizationId !== organizationId) {
      throw new ForbiddenException("এটি Platform Blueprint — বদলাতে হলে আগে নিজের কপি বানান (Clone)।");
    }
    const data: any = { version: (row.version ?? 1) + 1 };
    if (dto.name !== undefined) data.name = String(dto.name).slice(0, 200);
    if (dto.description !== undefined) data.description = String(dto.description).slice(0, 2000);
    if (dto.objective !== undefined) data.objective = String(dto.objective);
    if (dto.advantagePlus !== undefined) data.advantagePlus = !!dto.advantagePlus;
    if (dto.adSet !== undefined) data.adSet = dto.adSet;
    if (dto.ad !== undefined) data.ad = dto.ad;
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.tags !== undefined) data.tags = dto.tags;
    const updated = await table.update({ where: { id: rowId }, data });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.blueprint_updated", entityType: "CampaignBlueprint", entityId: rowId, metadata: { key: row.key, version: data.version } });
    return this.blueprintShape(updated);
  }

  /** CA26: delete an ORG-OWNED blueprint copy (platform
   * rows refuse — they are the platform team's data). */
  async deleteOrgBlueprint(organizationId: string, actorId: string, rowId: string) {
    const table = (this.prisma as any).campaignBlueprint;
    if (!table?.findFirst) throw new BadRequestException("Blueprint data এখনো পাওয়া যাচ্ছে না (Migration বাকি)।");
    const row = await table.findFirst({ where: { id: rowId } });
    if (!row) throw new NotFoundException("Blueprint not found");
    if (row.organizationId !== organizationId) {
      throw new ForbiddenException("Platform Blueprint মুছা যায় না — এটি Platform-এর সম্পত্তি।");
    }
    await table.delete({ where: { id: rowId } });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.blueprint_deleted", entityType: "CampaignBlueprint", entityId: rowId, metadata: { key: row.key } });
    return { deleted: true, id: rowId };
  }

  /** Instantiate a blueprint into an editable draft. Budget values are
   * editable starting points chosen by the owner, NOT recommendations
   * based on any performance data. A product, when chosen, grounds the
   * ad copy in its real catalog name and price. */
  async instantiateBlueprint(organizationId: string, actorId: string, dto: { blueprintKey: string; adAccountId: string; productId?: string; blueprintId?: string }) {
    const bp = await this.blueprintFor(organizationId, dto.blueprintKey, dto.blueprintId);
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
  private async publishPromotedObject(organizationId: string, planId: string, actorId: string, client: MetaPublishClient, adSet: any, planObjective?: string): Promise<{ promotedObject?: Record<string, unknown>; destinationType?: string; leadFormExternalId?: string; catalogTemplate?: boolean; whatsApp?: boolean }> {
    // CA23: an app-promotion set — promoted_object is the
    // app itself (Meta's app-ads contract: application_id +
    // object_store_url; a catalog set on an app plan adds
    // its product_set_id, the documented combination).
    // validatePlan has already named any missing field.
    if (planObjective === "OUTCOME_APP_PROMOTION") {
      const refs = (adSet.catalogRecordId || adSet.productSetId) ? await this.resolveCatalogRefs(organizationId, adSet) : null;
      return {
        promotedObject: {
          application_id: adSet.appId,
          object_store_url: adSet.appStoreUrl,
          ...(refs ? { product_set_id: refs!.set.externalSetId } : {}),
        },
        catalogTemplate: refs ? true : undefined,
      };
    }
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
        // CA23: an Advantage+ plan sends the budget lever
        // explicitly — campaign budget + the ONE derived
        // campaign bid strategy (validatePlan guaranteed
        // uniformity) + budget sharing off (ad sets carry
        // no budgets under CBO). Non-Advantage plans send
        // exactly what they sent before.
        const advBid = plan.advantagePlus ? this.advantageCampaignBid(full) : null;
        const created = await client.createCampaign(account.externalId, {
          name: plan.name, objective: plan.objective,
          dailyBudgetMinor: cbo ? (cb.dailyMinor?.toString() ?? undefined) : undefined,
          lifetimeBudgetMinor: cbo ? (cb.lifetimeMinor?.toString() ?? undefined) : undefined,
          ...(advBid ? { bidStrategy: advBid.bidStrategy, bidAmountMinor: advBid.bidAmountMinor, bidConstraints: advBid.bidConstraints, isAdsetBudgetSharingEnabled: false } : {}),
        });
        if (plan.advantagePlus) {
          await this.logStep(planId, actorId, "advantage_plus", "success", { externalId: cb.dailyMinor?.toString() }).catch(() => undefined);
          await this.audit.log({ organizationId, userId: actorId, action: "campaign.advantage_plus_publish", entityType: "CampaignPlan", entityId: planId, metadata: { campaignBudgetMinor: cb.dailyMinor?.toString(), bidStrategy: advBid?.bidStrategy ?? null, note: "TRUE Advantage+ path (CA23): campaign-level budget + campaign bid_strategy; ad sets created without budgets or bid fields; placements suppressed in targeting; targeting_automation.advantage_audience = 1; Meta's advantage_state_info is read back and stored on the plan" } }).catch(() => undefined);
        } else if (cbo) {
          await this.logStep(planId, actorId, "campaign_budget", "success", { externalId: cb.dailyMinor?.toString() ?? cb.lifetimeMinor?.toString() }).catch(() => undefined);
          await this.audit.log({ organizationId, userId: actorId, action: "campaign.cbo_publish", entityType: "CampaignPlan", entityId: planId, metadata: { campaignDailyMinor: cb.dailyMinor?.toString() ?? null, campaignLifetimeMinor: cb.lifetimeMinor?.toString() ?? null, note: "Budget at campaign level (CBO); ad sets created without budgets" } }).catch(() => undefined);
        }
        campaignExternalId = created.id;
        await (this.prisma as any).campaignPlan.update({ where: { id: planId }, data: { externalCampaignId: campaignExternalId, metaStatus: "PAUSED" } });
        await this.logStep(planId, actorId, "campaign", "success", { externalId: campaignExternalId });
      }
      // CA23: the Advantage+ read-back. Meta alone decides
      // whether the created campaign IS Advantage+ — the
      // state follows from the levers, and the only honest
      // confirmation is GET advantage_state_info. The
      // verdict is stored verbatim on the plan + logged;
      // a DISABLED verdict does NOT fail the publish (the
      // campaign exists, PAUSED, and is a valid manual
      // campaign) but it is recorded loudly, and the UI
      // shows Meta's state, never the toggle. Runs on
      // create and on a resume where no verdict exists yet.
      if (plan.advantagePlus && campaignExternalId && !(plan as any).advantageState) {
        const verdict = typeof (client as any).getCampaignAdvantageState === "function"
          ? await (client as any).getCampaignAdvantageState(campaignExternalId).catch(() => null)
          : null;
        if (verdict?.advantageState) {
          await (this.prisma as any).campaignPlan.update({
            where: { id: planId },
            data: { advantageState: verdict.advantageState, advantageStateInfo: verdict.raw as any, advantageStateCheckedAt: new Date() },
          }).catch(() => undefined);
          (plan as any).advantageState = verdict.advantageState;
          await this.logStep(planId, actorId, "advantage_state", "success", {
            externalId: campaignExternalId,
            error: verdict.advantageState === "DISABLED"
              ? `Meta advantage_state_info পড়ে দেখা হয়েছে: advantage_state = DISABLED (budget ${verdict.budgetState ?? "?"}, audience ${verdict.audienceState ?? "?"}, placement ${verdict.placementState ?? "?"}) — Campaign তৈরি হয়েছে (PAUSED) কিন্তু Meta এটিকে Advantage+ হিসেবে নিশ্চিত করেনি`
              : `Meta advantage_state_info নিশ্চিত করেছে: advantage_state = ${verdict.advantageState} (smart_promotion_type ${verdict.smartPromotionType ?? "GUIDED_CREATION"})`,
          }).catch(() => undefined);
          await this.audit.log({ organizationId, userId: actorId, action: "campaign.advantage_state_readback", entityType: "CampaignPlan", entityId: planId, metadata: { advantageState: verdict.advantageState, budgetState: verdict.budgetState ?? null, audienceState: verdict.audienceState ?? null, placementState: verdict.placementState ?? null, smartPromotionType: verdict.smartPromotionType ?? null } }).catch(() => undefined);
        } else {
          await this.logStep(planId, actorId, "advantage_state", "success", {
            externalId: campaignExternalId,
            error: "Meta থেকে advantage_state_info পড়া যায়নি — Advantage+ অবস্থা অনিশ্চিত (Unconfirmed); Plan-এ কোনো নিশ্চিত অবস্থা দেখানো হবে না",
          }).catch(() => undefined);
        }
      }
      for (const adSet of full.adSets) {
        // NB2: what this ad set promotes (CN3 event/catalog,
        // CN4 lead form) — computed per set, before creation;
        // on a resume it recomputes read-only state (a form
        // that already exists on Meta is not re-created).
        const po = await this.publishPromotedObject(organizationId, planId, actorId, client, adSet, plan.objective);
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
            // Meta's default needs no fields sent). CA23: on
            // an Advantage+ plan the bid lives on the
            // CAMPAIGN (created above) — ad sets send none.
            ...(plan.advantagePlus ? {} : this.bidGraphFields(adSet)),
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
          // CA17: plan-level UTM — the per-ad params
          // (template or defaults, now incl. utm_content
          // = ad set, utm_term = ad) ride BOTH the tagged
          // destination link and Meta's url_tags on the ad,
          // so the tagging is identical whichever the
          // click path. The owner's own utm_* on a link
          // still win (applyUtmParams never overwrites).
          const utmParams = this.utmParamsFor(full, { platform: "meta", adSetName: adSet.name, adName: ad.name });
          const tagged = this.applyUtmParams(ad.linkUrl, utmParams);
          const taggedCards = resolved.carouselCards?.map((card) => ({ ...card, linkUrl: this.applyUtmParams(card.linkUrl, utmParams).url }));
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
            // CA17: the same UTM params as the tagged
            // link, as Meta url_tags (Meta appends them
            // to the destination URL at click time).
            urlTags: this.utmQueryString(utmParams) || undefined,
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
  async preflight(organizationId: string, planId: string, opts?: { includePlatform?: boolean }) {
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
    // CA24: the LIVE platform checks ride the same
    // response, additively, only when asked (readiness
    // calls preflight for policy findings and keeps its
    // old cost profile). platformPreflight never throws —
    // an unreadable platform is a not_checked result.
    const platformChecks = opts?.includePlatform
      ? (await this.platformPreflight(organizationId, planId).catch(() => null))?.checks ?? []
      : undefined;
    return { planId, checkedAds, findings, summary, ...(platformChecks ? { platformChecks } : {}), disclaimer: "Pre-flight পাস করা মানে Meta অনুমোদনের নিশ্চয়তা নয় — এটি প্রতিরোধযোগ্য Reject এর কারণগুলো সরায়।" };
  }

  /** CA24: pre-flight completion — LIVE platform reads
   * through the plan account's existing Meta client:
   * (1) ad account status + disable_reason, (2) each
   * plan Page still fetchable, (3) each plan Pixel's
   * last_fired_time. Honesty rules, pinned by spec:
   * a check that could not be performed is
   * status "not_checked" WITH the reason (NEVER ok);
   * a platform-CONFIRMED hard failure (account_status
   * DISABLED/CLOSED) is level "error"; everything else
   * adverse is "warn". Read-only: nothing here writes to
   * Meta or moves money. */
  async platformPreflight(organizationId: string, planId: string) {
    const full = await this.getPlanFull(organizationId, planId);
    type Check = { key: string; subject: string; status: "ok" | "warn" | "error" | "not_checked"; label: string; detail: string };
    const checks: Check[] = [];
    let client: MetaPublishClient | null = null;
    let account: any = null;
    let clientError: string | null = null;
    try {
      ({ client, account } = await this.publishClient(organizationId, full));
    } catch (e) {
      clientError = e instanceof Error ? e.message.slice(0, 200) : "Meta connection unavailable";
    }
    const notChecked = (key: string, subject: string, label: string, reason: string): Check => ({ key, subject, status: "not_checked", label, detail: `যাচাই করা যায়নি (not_checked) — ${reason}` });

    // (1) Ad account status — fresh from Meta.
    if (!client || !account) {
      checks.push(notChecked("account_status", String((full as any).adAccountId ?? ""), "Ad Account অবস্থা (Live)", clientError ?? "Meta Client তৈরি করা যায়নি"));
    } else {
      try {
        const st = await client.getAdAccountState(account.externalId);
        if (st.accountStatus === undefined) {
          checks.push(notChecked("account_status", account.externalId, "Ad Account অবস্থা (Live)", "Meta account_status পাঠায়নি"));
        } else {
          const bucket = metaStatusBucket(st.accountStatus);
          const reason = st.disableReason ? ` · disable_reason: ${st.disableReason}` : "";
          checks.push({
            key: "account_status", subject: account.externalId,
            status: bucket === "disabled" ? "error" : bucket === "active" ? "ok" : "warn",
            label: "Ad Account অবস্থা (Live)",
            detail: `Meta সরাসরি পড়েছে: account_status ${st.accountStatus} (${bucketLabelBn(bucket)})${reason}`,
          });
        }
      } catch (e) {
        checks.push(notChecked("account_status", account.externalId, "Ad Account অবস্থা (Live)", e instanceof Error ? e.message.slice(0, 200) : "Meta read failed"));
      }
    }

    // (2) Pages — each distinct Page on the plan's ad sets.
    const pageIds = [...new Set((full.adSets ?? []).map((s: any) => s.pageId).filter(Boolean))] as string[];
    if (!pageIds.length) {
      checks.push(notChecked("page_access", "", "Page প্রবেশাধিকার (Live)", "কোনো Ad Set-এ Page ID নেই — যাচাই করার মতো Page নেই"));
    }
    for (const pageId of pageIds.slice(0, 5)) {
      if (!client) { checks.push(notChecked("page_access", pageId, "Page প্রবেশাধিকার (Live)", clientError ?? "Meta Client তৈরি করা যায়নি")); continue; }
      try {
        const page = await client.getPageNode(pageId);
        checks.push({ key: "page_access", subject: pageId, status: "ok", label: "Page প্রবেশাধিকার (Live)", detail: `Meta Page টি পড়তে পেরেছে: ${page.name ?? pageId} (id ${page.id ?? pageId})` });
      } catch (e) {
        checks.push({ key: "page_access", subject: pageId, status: "warn", label: "Page প্রবেশাধিকার (Live)", detail: `Meta Page ${pageId} পড়তে পারেনি — ${e instanceof Error ? e.message.slice(0, 200) : "read failed"}। Page মুছে গেছে বা Token-এর Access নেই হতে পারে; Publish-এর আগে যাচাই করুন।` });
      }
    }

    // (3) Pixels — last event Meta received (last_fired_time).
    const pixelIds = [...new Set((full.adSets ?? []).map((s: any) => s.pixelId).filter(Boolean))] as string[];
    if (!pixelIds.length) {
      checks.push(notChecked("pixel_health", "", "Pixel/Dataset স্বাস্থ্য (Live)", "কোনো Ad Set-এ Pixel ID নেই — যাচাই করার মতো Pixel নেই"));
    }
    for (const pixelId of pixelIds.slice(0, 5)) {
      if (!client) { checks.push(notChecked("pixel_health", pixelId, "Pixel/Dataset স্বাস্থ্য (Live)", clientError ?? "Meta Client তৈরি করা যায়নি")); continue; }
      try {
        const px = await client.getPixelNode(pixelId);
        if (px.lastFiredTime) {
          checks.push({ key: "pixel_health", subject: pixelId, status: "ok", label: "Pixel/Dataset স্বাস্থ্য (Live)", detail: `Meta-র রেকর্ড অনুযায়ী Pixel ${pixelId} সর্বশেষ Event পেয়েছে: ${px.lastFiredTime}` });
        } else {
          checks.push({ key: "pixel_health", subject: pixelId, status: "warn", label: "Pixel/Dataset স্বাস্থ্য (Live)", detail: `Meta Pixel ${pixelId}-এর last_fired_time জানায়নি — Pixel টি কখনো Event পেয়েছে কিনা Meta থেকে নিশ্চিত হওয়া যাচ্ছে না` });
        }
      } catch (e) {
        checks.push(notChecked("pixel_health", pixelId, "Pixel/Dataset স্বাস্থ্য (Live)", e instanceof Error ? e.message.slice(0, 200) : "Meta read failed"));
      }
    }

    return {
      planId,
      checkedAt: new Date().toISOString(),
      checks,
      note: "এই যাচাইগুলো Meta থেকে সরাসরি পড়া (Live Read) — সংরক্ষিত অবস্থা নয়। not_checked মানে যাচাই হয়নি; তা কখনো 'ঠিক আছে' নয়।",
    };
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
    // CA17: attribution windows AS STORED. The first-
    // party window is the org's own setting
    // (Organization.attributionWindowDays — the very
    // value the attribution engine reads). Platform
    // windows are stored NOWHERE in this system (no
    // attribution_spec is ever sent to Meta or saved
    // for any platform), so they are reported as not
    // configured — never a plausible-sounding default
    // (e.g. "7-day click") dressed up as the account's.
    const orgRow = await (this.prisma as any).organization?.findUnique?.({ where: { id: organizationId } }).catch(() => null);
    const attribution = {
      firstParty: { windowDays: typeof orgRow?.attributionWindowDays === "number" ? orgRow.attributionWindowDays : null, source: "organization_setting" },
      platforms: [
        { platform: "meta", configured: false, windowDays: null, display: "সেট করা নেই" },
        { platform: "google", configured: false, windowDays: null, display: "সেট করা নেই" },
        { platform: "tiktok", configured: false, windowDays: null, display: "সেট করা নেই" },
      ],
    };
    return {
      published: true,
      attribution,
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
      // CA18: the runway projection rides the pacing
      // payload (same rows, same instant) — see
      // computeRunway for the honesty rules.
      runway: CampaignsService.computeRunway(campaignRows, spent, lifetimeBudget, now),
    };
  }

  // ---------- CA18 (CB5): pacing alerts + runway ----------
  /** CA18 thresholds — named constants, stated in every
   *  payload and in the automation template copy, never
   *  hidden: the runway burn rate comes from the trailing
   *  7 days of REAL DailyAdMetric rows and needs at least
   *  3 distinct metric days; an early-exhaustion alert
   *  fires when the projected exhaustion lands at least
   *  2 days BEFORE the plan end date; an overspend alert
   *  fires when spend-to-date exceeds expected-to-date by
   *  more than 20%; a persistent alert re-notifies at most
   *  once per 24h. Alerts NEVER pause a campaign or move a
   *  budget — they notify, a human decides. */
  static readonly PACING_TRAILING_DAYS = 7;
  static readonly PACING_MIN_TRAILING_DAYS = 3;
  static readonly PACING_EXHAUSTION_MARGIN_DAYS = 2;
  static readonly PACING_OVERSPEND_PERCENT = 20;
  static readonly PACING_ALERT_COOLDOWN_HOURS = 24;
  static readonly PACING_RUNWAY_LABEL = "আনুমানিক projection — শেষ ৭ দিনের আসল Metric Row-এর গড় দৈনিক খরচের গতিতে হিসাব; ভবিষ্যতে গতি বদলালে তারিখও বদলাবে";

  /** CA18: runway from campaign-level metric rows: days
   *  of budget left at the trailing burn rate. Only a
   *  LIFETIME budget can run out — a daily budget refills,
   *  so daily-budget plans get an honest not-applicable,
   *  and thin data gets "তথ্য নেই", never an invented
   *  number. The burn rate divides trailing spend by the
   *  number of DISTINCT metric days inside the window (a
   *  day with no row is unknown, not zero). */
  static computeRunway(rows: any[], spent: bigint, lifetimeBudget: bigint | null, now: Date) {
    const label = CampaignsService.PACING_RUNWAY_LABEL;
    if (lifetimeBudget == null) {
      return { available: false, label, reason: "Runway শুধু Lifetime Budget-এর Plan-এ হিসাব হয় — Daily Budget প্রতিদিন নতুন করে আসে, ফুরিয়ে যাওয়ার কোনো তারিখ নেই" };
    }
    const dayMs = 86_400_000;
    const windowStart = now.getTime() - CampaignsService.PACING_TRAILING_DAYS * dayMs;
    const perDay = new Map<string, bigint>();
    for (const r of rows ?? []) {
      const t = new Date(r?.date).getTime();
      if (Number.isNaN(t) || t < windowStart || t > now.getTime()) continue;
      let v = 0n;
      try { v = BigInt(r.spendMinor ?? 0); } catch { v = 0n; }
      const key = new Date(r.date).toISOString().slice(0, 10);
      perDay.set(key, (perDay.get(key) ?? 0n) + v);
    }
    const metricDays = perDay.size;
    if (metricDays < CampaignsService.PACING_MIN_TRAILING_DAYS) {
      return { available: false, label, metricDays, reason: `শেষ ${CampaignsService.PACING_TRAILING_DAYS} দিনে মাত্র ${metricDays} দিনের Metric Row আছে — Runway-এর জন্য অন্তত ${CampaignsService.PACING_MIN_TRAILING_DAYS} দিনের আসল খরচ লাগে (তথ্য নেই)` };
    }
    let trailing = 0n;
    for (const v of perDay.values()) trailing += v;
    const burnPerDay = Number(trailing) / metricDays;
    if (!(burnPerDay > 0)) {
      return { available: false, label, metricDays, reason: "শেষ ৭ দিনের Row-তে কোনো খরচ নেই — Burn Rate শূন্য হলে Runway হিসাব হয় না (তথ্য নেই)" };
    }
    const remaining = lifetimeBudget - spent;
    const runwayDays = remaining <= 0n ? 0 : Math.round((Number(remaining) / burnPerDay) * 10) / 10;
    return {
      available: true, label, metricDays, trailingDays: CampaignsService.PACING_TRAILING_DAYS,
      burnMinorPerDay: String(Math.round(burnPerDay)),
      remainingMinor: remaining.toString(),
      runwayDays,
      projectedExhaustionDate: new Date(now.getTime() + runwayDays * dayMs).toISOString(),
      exhausted: remaining <= 0n,
    };
  }

  /** CA18: the plan's runway on its own (the builder's
   *  pacing panel reads it from planPacing; this endpoint
   *  shape exists for callers that need only the runway). */
  async planRunway(organizationId: string, planId: string, now = new Date()) {
    const pacing: any = await this.planPacing(organizationId, planId, now);
    return {
      planId, published: !!pacing.published,
      endDate: pacing.endDate ?? null, currency: pacing.currency ?? null,
      runway: pacing.runway ?? { available: false, label: CampaignsService.PACING_RUNWAY_LABEL, reason: "তথ্য নেই" },
    };
  }

  private pacingAlertJson(row: any) {
    return {
      id: row.id, planId: row.planId, kind: row.kind, status: row.status,
      message: row.message, detail: row.detail ?? null,
      raisedAt: row.raisedAt ? new Date(row.raisedAt).toISOString() : null,
      clearedAt: row.clearedAt ? new Date(row.clearedAt).toISOString() : null,
      lastNotifiedAt: row.lastNotifiedAt ? new Date(row.lastNotifiedAt).toISOString() : null,
    };
  }

  /** CA18: the plan's pacing alerts (active first, then
   *  recent history) + the stated thresholds, so the
   *  builder panel can show WHY an alert exists. */
  async listPlanPacingAlerts(organizationId: string, planId: string) {
    await this.getPlanOrThrow(organizationId, planId);
    const p = this.prisma as any;
    const thresholds = {
      trailingDays: CampaignsService.PACING_TRAILING_DAYS,
      minTrailingDays: CampaignsService.PACING_MIN_TRAILING_DAYS,
      exhaustionMarginDays: CampaignsService.PACING_EXHAUSTION_MARGIN_DAYS,
      overspendPercent: CampaignsService.PACING_OVERSPEND_PERCENT,
      cooldownHours: CampaignsService.PACING_ALERT_COOLDOWN_HOURS,
    };
    if (!p.planPacingAlert?.findMany) return { planId, thresholds, active: [] as any[], recent: [] as any[] };
    const rows = await p.planPacingAlert.findMany({ where: { organizationId, planId }, orderBy: { raisedAt: "desc" }, take: 50 }).catch(() => []);
    const all = (rows as any[]).map((r) => this.pacingAlertJson(r));
    return { planId, thresholds, active: all.filter((a) => a.status === "active"), recent: all.filter((a) => a.status !== "active").slice(0, 10) };
  }

  /** CA18: the pacing alert sweep (per-org via the
   *  pacing_alert_sweep automation job — default OFF: no
   *  job row, no runs). For every live plan whose pacing
   *  computes cleanly it derives the firing conditions
   *  from REAL stored rows and reconciles them against
   *  PlanPacingAlert: a new condition creates ONE active
   *  alert + notification + audit; a persistent condition
   *  refreshes its numbers and re-notifies at most once
   *  per cooldown; a condition that stopped firing CLEARS
   *  its alert (the row stays as history). A plan whose
   *  pacing cannot be computed (no rows / no budget
   *  basis) is skipped WITHOUT touching its alerts — a
   *  sync gap must never silently clear a real warning. */
  async scanPacingAlerts(organizationId?: string, now = new Date()) {
    const p = this.prisma as any;
    const counts = { evaluated: 0, raised: 0, cleared: 0, renotified: 0 };
    if (!p.campaignPlan?.findMany || !p.planPacingAlert?.findMany) return counts;
    const plans = await p.campaignPlan.findMany({
      where: { ...(organizationId ? { organizationId } : {}), status: "published", externalCampaignId: { not: null } },
      take: 100,
    }).catch(() => []);
    const dayMs = 86_400_000;
    for (const plan of plans as any[]) {
      const orgId = plan.organizationId;
      const pacing: any = await this.planPacing(orgId, plan.id, now).catch(() => null);
      if (!pacing || !pacing.published || pacing.status !== "ok") continue;
      counts.evaluated++;
      const firing = new Map<string, { message: string; detail: any }>();
      const runway = pacing.runway;
      if (runway?.available && pacing.endDate) {
        const endMs = new Date(pacing.endDate).getTime();
        const projMs = new Date(runway.projectedExhaustionDate).getTime();
        if (projMs < endMs - CampaignsService.PACING_EXHAUSTION_MARGIN_DAYS * dayMs) {
          firing.set("early_exhaustion", {
            message: `"${plan.name}": এই গতিতে খরচ চললে Lifetime Budget ফুরিয়ে যাবে ${String(runway.projectedExhaustionDate).slice(0, 10)} নাগাদ — Plan-এর শেষ তারিখের (${String(pacing.endDate).slice(0, 10)}) অন্তত ${CampaignsService.PACING_EXHAUSTION_MARGIN_DAYS} দিন আগেই (${CampaignsService.PACING_RUNWAY_LABEL})`,
            detail: {
              projectedExhaustionDate: runway.projectedExhaustionDate, endDate: pacing.endDate,
              runwayDays: runway.runwayDays, burnMinorPerDay: runway.burnMinorPerDay,
              remainingMinor: runway.remainingMinor, metricDays: runway.metricDays,
              marginDays: CampaignsService.PACING_EXHAUSTION_MARGIN_DAYS,
            },
          });
        }
      }
      let expected: bigint | null = null;
      try { expected = pacing.expectedMinor != null ? BigInt(pacing.expectedMinor) : null; } catch { expected = null; }
      let spent = 0n;
      try { spent = BigInt(pacing.spentMinor ?? 0); } catch { spent = 0n; }
      if (expected != null && expected > 0n) {
        const overBy = spent - expected;
        if (overBy > 0n && overBy * 100n > expected * BigInt(CampaignsService.PACING_OVERSPEND_PERCENT)) {
          const overPercent = Math.round((Number(overBy) / Number(expected)) * 1000) / 10;
          firing.set("overspend_pace", {
            message: `"${plan.name}": আজ পর্যন্ত প্রত্যাশিত খরচের চেয়ে ${overPercent}% বেশি খরচ হয়েছে — এই গতি চললে মোট Budget ছাড়িয়ে যাওয়ার ঝুঁকি আছে`,
            detail: {
              spentMinor: spent.toString(), expectedMinor: expected.toString(),
              overPercent, thresholdPercent: CampaignsService.PACING_OVERSPEND_PERCENT,
              daysElapsed: pacing.daysElapsed, daysTotal: pacing.daysTotal,
            },
          });
        }
      }
      const activeRows = await p.planPacingAlert.findMany({ where: { organizationId: orgId, planId: plan.id, status: "active" } }).catch(() => []);
      const activeByKind = new Map<string, any>((activeRows as any[]).map((r) => [r.kind, r]));
      for (const [kind, f] of firing) {
        const existing = activeByKind.get(kind);
        if (!existing) {
          await p.planPacingAlert.create({
            data: { organizationId: orgId, planId: plan.id, kind, status: "active", message: f.message, detail: f.detail, raisedAt: now, lastNotifiedAt: now },
          }).catch(() => undefined);
          counts.raised++;
          await this.audit.log({ organizationId: orgId, userId: plan.createdById, action: "campaign.pacing_alert_raised", entityType: "CampaignPlan", entityId: plan.id, metadata: { kind, detail: f.detail } }).catch(() => undefined);
          if (plan.createdById) {
            await this.notifyUsers(orgId, [plan.createdById], "campaign_pacing_alert", "⏱ Pacing Alert", f.message).catch(() => undefined);
          }
        } else {
          const lastMs = existing.lastNotifiedAt ? new Date(existing.lastNotifiedAt).getTime() : 0;
          const due = now.getTime() - lastMs >= CampaignsService.PACING_ALERT_COOLDOWN_HOURS * 3_600_000;
          await p.planPacingAlert.update({
            where: { id: existing.id },
            data: { message: f.message, detail: f.detail, ...(due ? { lastNotifiedAt: now } : {}) },
          }).catch(() => undefined);
          if (due) {
            counts.renotified++;
            if (plan.createdById) {
              await this.notifyUsers(orgId, [plan.createdById], "campaign_pacing_alert", "⏱ Pacing Alert (এখনো সক্রিয়)", f.message).catch(() => undefined);
            }
          }
        }
        activeByKind.delete(kind);
      }
      for (const leftover of activeByKind.values()) {
        await p.planPacingAlert.update({ where: { id: leftover.id }, data: { status: "cleared", clearedAt: now } }).catch(() => undefined);
        counts.cleared++;
        await this.audit.log({ organizationId: orgId, userId: plan.createdById, action: "campaign.pacing_alert_cleared", entityType: "CampaignPlan", entityId: plan.id, metadata: { kind: leftover.kind } }).catch(() => undefined);
      }
    }
    return counts;
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

  /** CA12: the org's timezone (Organization.timezone —
   * the row every org carries; Asia/Dhaka is both the
   * schema default and the fallback when the table is
   * unreachable in a spec fake). */
  private async orgTimezone(organizationId: string): Promise<string> {
    const org = await (this.prisma as any).organization?.findFirst?.({ where: { id: organizationId } }).catch(() => null);
    return org?.timezone || "Asia/Dhaka";
  }

  /** CA12: the plan's scheduled pause/resume window as the
   * builder shows it — stored UTC instants, displayed in
   * the ORG's timezone (returned alongside). */
  async getPlanSchedule(organizationId: string, planId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    return {
      planId, status: plan.status, metaStatus: plan.metaStatus ?? null,
      timezone: await this.orgTimezone(organizationId),
      pauseAt: plan.pauseAt ?? null, resumeAt: plan.resumeAt ?? null,
      pauseExecutedAt: plan.pauseExecutedAt ?? null, resumeExecutedAt: plan.resumeExecutedAt ?? null,
    };
  }

  /** CA12: set (or clear) the pause window of a PUBLISHED
   * plan. Pause applies to the plan's LIVE campaign, so a
   * window can only be set on a published plan; clearing is
   * always allowed. Setting a window resets the execution
   * stamps — a re-set window is a new instruction. Times
   * are instants (the client converts from the org
   * timezone it displays); resume must follow pause. */
  async setPlanSchedule(organizationId: string, actorId: string, planId: string, dto: { pauseAt?: string | null; resumeAt?: string | null }) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    const pauseAt = dto.pauseAt ? new Date(dto.pauseAt) : null;
    const resumeAt = dto.resumeAt ? new Date(dto.resumeAt) : null;
    if (pauseAt && Number.isNaN(pauseAt.getTime())) throw new BadRequestException("pauseAt সঠিক সময় নয়");
    if (resumeAt && Number.isNaN(resumeAt.getTime())) throw new BadRequestException("resumeAt সঠিক সময় নয়");
    if (pauseAt || resumeAt) {
      if (plan.status !== "published") throw new BadRequestException("শুধু Published Plan-এ Pause Window বসানো যায় — Pause Live Campaign-এর জন্যই অর্থবহ");
      if (pauseAt && resumeAt && resumeAt.getTime() <= pauseAt.getTime()) throw new BadRequestException("Resume-এর সময় Pause-এর পরে হতে হবে");
    }
    await (this.prisma as any).campaignPlan.update({
      where: { id: planId },
      data: { pauseAt, resumeAt, pauseExecutedAt: null, resumeExecutedAt: null },
    });
    await this.audit.log({
      organizationId, userId: actorId,
      action: pauseAt || resumeAt ? "campaign.pause_window_set" : "campaign.pause_window_cleared",
      entityType: "CampaignPlan", entityId: planId,
      metadata: { pauseAt: pauseAt?.toISOString() ?? null, resumeAt: resumeAt?.toISOString() ?? null },
    }).catch(() => undefined);
    return this.getPlanSchedule(organizationId, planId);
  }

  /** CA12: the plan-schedule sweep (per-org via the
   * plan_schedule_sweep automation job — default OFF: no
   * job row, no runs). Mirrors scanScheduledLaunches'
   * exactly-once discipline: a due leg is CLAIMED by
   * stamping its *ExecutedAt first (updateMany on the
   * unstamped row), so re-runs and racing replicas are
   * no-ops, and the outcome — executed, skipped_not_live,
   * skipped_not_paused, or failed — is audited either
   * way. Exactly one attempt per window: a failed attempt
   * does not retry silently; the owner clears/re-sets the
   * window to instruct again. Execution goes through
   * setMetaStatus, the same Meta-confirmed path as a
   * manual pause/resume. */
  async scanPlanSchedules(organizationId?: string, now = new Date()) {
    const p = this.prisma as any;
    if (!p.campaignPlan?.findMany) return { paused: 0, resumed: 0, skipped: 0, failed: 0 };
    const counts = { paused: 0, resumed: 0, skipped: 0, failed: 0 };
    const orgWhere = organizationId ? { organizationId } : {};
    // --- pause leg ---
    const duePauses = await p.campaignPlan.findMany({
      where: { ...orgWhere, pauseAt: { lte: now, not: null }, pauseExecutedAt: null }, take: 50,
    }).catch(() => []);
    for (const plan of duePauses as any[]) {
      const claimed = await p.campaignPlan.updateMany({
        where: { id: plan.id, pauseAt: { lte: now, not: null }, pauseExecutedAt: null }, data: { pauseExecutedAt: now },
      }).catch(() => ({ count: 0 }));
      if (!claimed || claimed.count === 0) continue;
      if (plan.status !== "published" || !plan.externalCampaignId) {
        counts.skipped++;
        await this.audit.log({ organizationId: plan.organizationId, userId: plan.createdById, action: "campaign.scheduled_pause_skipped", entityType: "CampaignPlan", entityId: plan.id, metadata: { reason: "not_live", pauseAt: plan.pauseAt } }).catch(() => undefined);
        continue;
      }
      try {
        await this.setMetaStatus(plan.organizationId, plan.createdById, plan.id, "PAUSED");
        counts.paused++;
        await this.notifyUsers(plan.organizationId, [plan.createdById], "campaign_paused_scheduled", "⏸ নির্ধারিত Pause কার্যকর হয়েছে", `"${plan.name}" নির্ধারিত সময়ে Pause হয়েছে (Plan Schedule)।`).catch(() => undefined);
      } catch (e) {
        counts.failed++;
        await this.audit.log({ organizationId: plan.organizationId, userId: plan.createdById, action: "campaign.scheduled_pause_failed", entityType: "CampaignPlan", entityId: plan.id, metadata: { error: e instanceof Error ? e.message.slice(0, 200) : "error" } }).catch(() => undefined);
        await this.notifyUsers(plan.organizationId, [plan.createdById], "campaign_pause_failed", "⚠️ নির্ধারিত Pause ব্যর্থ", `"${plan.name}" Pause করা যায়নি — Builder থেকে হাতে Pause করুন বা Window আবার বসান।`).catch(() => undefined);
      }
    }
    // --- resume leg ---
    const dueResumes = await p.campaignPlan.findMany({
      where: { ...orgWhere, resumeAt: { lte: now, not: null }, resumeExecutedAt: null }, take: 50,
    }).catch(() => []);
    for (const plan of dueResumes as any[]) {
      const claimed = await p.campaignPlan.updateMany({
        where: { id: plan.id, resumeAt: { lte: now, not: null }, resumeExecutedAt: null }, data: { resumeExecutedAt: now },
      }).catch(() => ({ count: 0 }));
      if (!claimed || claimed.count === 0) continue;
      if (plan.status !== "published" || !plan.externalCampaignId) {
        counts.skipped++;
        await this.audit.log({ organizationId: plan.organizationId, userId: plan.createdById, action: "campaign.scheduled_resume_skipped", entityType: "CampaignPlan", entityId: plan.id, metadata: { reason: "not_live", resumeAt: plan.resumeAt } }).catch(() => undefined);
        continue;
      }
      if (plan.metaStatus !== "PAUSED") {
        counts.skipped++;
        await this.audit.log({ organizationId: plan.organizationId, userId: plan.createdById, action: "campaign.scheduled_resume_skipped", entityType: "CampaignPlan", entityId: plan.id, metadata: { reason: "not_paused", resumeAt: plan.resumeAt } }).catch(() => undefined);
        continue;
      }
      try {
        await this.setMetaStatus(plan.organizationId, plan.createdById, plan.id, "ACTIVE");
        counts.resumed++;
        await this.notifyUsers(plan.organizationId, [plan.createdById], "campaign_resumed_scheduled", "▶️ নির্ধারিত Resume কার্যকর হয়েছে", `"${plan.name}" নির্ধারিত সময়ে আবার Active হয়েছে (Plan Schedule)।`).catch(() => undefined);
      } catch (e) {
        counts.failed++;
        await this.audit.log({ organizationId: plan.organizationId, userId: plan.createdById, action: "campaign.scheduled_resume_failed", entityType: "CampaignPlan", entityId: plan.id, metadata: { error: e instanceof Error ? e.message.slice(0, 200) : "error" } }).catch(() => undefined);
        await this.notifyUsers(plan.organizationId, [plan.createdById], "campaign_resume_failed", "⚠️ নির্ধারিত Resume ব্যর্থ", `"${plan.name}" Active করা যায়নি — Builder থেকে হাতে চেষ্টা করুন।`).catch(() => undefined);
      }
    }
    return counts;
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

  // ---------- CA9: geo intelligence ----------
  /** The minimum stored-row count before a region's totals
   *  are shown at all — a single day's row is an anecdote,
   *  and the threshold is stated in every payload. */
  static readonly REGION_MIN_ROWS = 2;
  /** Bangladesh division mapping for the region NAME
   *  strings Meta returns for BD (ads.service stores
   *  String(region) verbatim from the breakdown). Both the
   *  old and new spellings are listed because Meta has
   *  used both ("Chittagong"/"Chattogram",
   *  "Barisal"/"Barishal"). Matching is exact after
   *  case/space normalisation — an unmapped region keeps
   *  its raw name with division null; nothing is guessed. */
  static readonly BD_DIVISIONS: { division: string; label: string; names: string[] }[] = [
    { division: "dhaka", label: "ঢাকা বিভাগ", names: ["dhaka", "dhaka division"] },
    { division: "chattogram", label: "চট্টগ্রাম বিভাগ", names: ["chittagong", "chittagong division", "chattogram", "chattogram division"] },
    { division: "khulna", label: "খুলনা বিভাগ", names: ["khulna", "khulna division"] },
    { division: "rajshahi", label: "রাজশাহী বিভাগ", names: ["rajshahi", "rajshahi division"] },
    { division: "barishal", label: "বরিশাল বিভাগ", names: ["barisal", "barisal division", "barishal", "barishal division"] },
    { division: "sylhet", label: "সিলেট বিভাগ", names: ["sylhet", "sylhet division"] },
    { division: "rangpur", label: "রংপুর বিভাগ", names: ["rangpur", "rangpur division"] },
    { division: "mymensingh", label: "ময়মনসিংহ বিভাগ", names: ["mymensingh", "mymensingh division"] },
  ];
  static bdDivisionOf(regionName: string): { division: string; label: string } | null {
    const norm = String(regionName ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    for (const d of CampaignsService.BD_DIVISIONS) if (d.names.includes(norm)) return { division: d.division, label: d.label };
    return null;
  }
  /** Aggregate stored region-breakdown rows per region
   *  name (REAL rows only — spend/impressions/clicks/
   *  conversions summed, CPA derived, row count kept so
   *  callers can apply REGION_MIN_ROWS). Sorted by
   *  conversions, then spend. */
  static aggregateRegionRows(rows: any[]) {
    const byKey = new Map<string, { region: string; spendMinor: bigint; impressions: number; clicks: number; conversions: number; rows: number }>();
    for (const r of rows ?? []) {
      const region = String(r.key ?? "").trim();
      if (!region) continue;
      const cur = byKey.get(region) ?? { region, spendMinor: 0n, impressions: 0, clicks: 0, conversions: 0, rows: 0 };
      try { cur.spendMinor += BigInt(r.spendMinor ?? 0); } catch { /* malformed row never poisons the totals */ }
      cur.impressions += Number(r.impressions ?? 0) || 0;
      cur.clicks += Number(r.clicks ?? 0) || 0;
      cur.conversions += Number(r.platformConversions ?? 0) || 0;
      cur.rows += 1;
      byKey.set(region, cur);
    }
    return [...byKey.values()].map((v) => {
      const div = CampaignsService.bdDivisionOf(v.region);
      const spend = Number(v.spendMinor) / 100;
      return {
        region: v.region, division: div?.division ?? null, divisionLabel: div?.label ?? null,
        spend, spendMinor: v.spendMinor.toString(), impressions: v.impressions, clicks: v.clicks,
        conversions: v.conversions, cpa: v.conversions > 0 ? Math.round((spend / v.conversions) * 100) / 100 : null,
        rows: v.rows,
      };
    }).sort((a, b) => b.conversions - a.conversions || b.spend - a.spend);
  }

  /** CA9(a): per-plan region performance from the plan's
   *  stored region breakdown rows. HONEST SHAPE: breakdown
   *  rows are CAMPAIGN-level (DailyAdBreakdown carries no
   *  ad-set id), so this is the plan's campaign broken down
   *  by region — never a per-ad-set geo claim. Regions
   *  under REGION_MIN_ROWS stored rows are withheld and
   *  counted, not silently merged into an "other". */
  async planRegionPerformance(organizationId: string, planId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    const minRows = CampaignsService.REGION_MIN_ROWS;
    const base = { campaignExternalId: plan.externalCampaignId ?? null, minRows, totalRows: 0, rowsBelowThreshold: 0, regions: [] as any[] };
    if (!plan.externalCampaignId) {
      return { ...base, available: false, reason: "Plan এখনো Publish হয়নি — Region Performance শুধু Publish হওয়া Campaign-এর সংরক্ষিত Breakdown Row থেকে আসে" };
    }
    const p = this.prisma as any;
    if (!p.dailyAdBreakdown?.findMany) return { ...base, available: false, reason: "Breakdown Store পাওয়া যাচ্ছে না" };
    const rows = await p.dailyAdBreakdown.findMany({ where: { organizationId, campaignExternalId: plan.externalCampaignId, dimension: "region" } }).catch(() => []);
    if (!rows?.length) {
      return { ...base, available: false, reason: "এই Campaign-এর কোনো Region Breakdown Row এখনো নেই — Ads Sync চললে এখানে আসবে" };
    }
    const all = CampaignsService.aggregateRegionRows(rows);
    const kept = all.filter((r) => r.rows >= minRows);
    const rowsBelowThreshold = all.filter((r) => r.rows < minRows).reduce((a, r) => a + r.rows, 0);
    return {
      available: true, campaignExternalId: plan.externalCampaignId, minRows,
      totalRows: rows.length, rowsBelowThreshold, regions: kept,
      note: "Breakdown Row Campaign-Level — কোন Ad Set কোন Region-এ কত খরচ করেছে তা আলাদা করে জানা যায় না; এটি পুরো Campaign-এর Region ভাগ",
    };
  }

  /** CA9(b): one-click DRAFT ad set targeting the plan's
   *  top regions by conversions. The draft copies the
   *  source ad set's settings wholesale and adds
   *  targeting.regions — each region's Meta key RESOLVED
   *  through Meta's own targeting search (exact name
   *  match, region-type preferred). A region whose key
   *  cannot be resolved is reported in notCarried and
   *  left out — a key is never guessed. Nothing is
   *  published: the result is an ordinary draft ad set
   *  the owner reviews like any other. */
  async createRegionAdSetDraft(organizationId: string, actorId: string, planId: string, dto: { sourceAdSetId: string; topN?: number }) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    // Editability: the usual draft/rejected rule, PLUS a
    // published plan with a live campaign — the only state
    // region data can exist in. The created set is a LOCAL
    // draft (no Meta id, nothing is sent to Meta), so the
    // live campaign is untouched; launching it stays a
    // human decision through the normal plan flows.
    if (!["draft", "rejected"].includes(plan.status) && !(plan.status === "published" && plan.externalCampaignId)) {
      throw new BadRequestException(`Plan is "${plan.status}" — Region Draft শুধু Draft/Rejected অথবা Live Campaign-ওয়ালা Published Plan-এ বানানো যায়`);
    }
    const source = await this.getAdSetOrThrow(planId, dto.sourceAdSetId);
    const perf = await this.planRegionPerformance(organizationId, planId);
    if (!perf.available) throw new BadRequestException((perf as any).reason ?? "Region Performance পাওয়া যাচ্ছে না");
    const topN = Math.min(5, Math.max(1, Math.floor(Number(dto.topN ?? 3)) || 3));
    const top = perf.regions.filter((r) => r.conversions > 0).slice(0, topN);
    if (!top.length) throw new BadRequestException("কোনো Region-এই কনভার্সন নেই — শীর্ষ Region দিয়ে Draft বানানো যাচ্ছে না");
    let client: { client: MetaPublishClient; account: any } | null = null;
    try { client = await this.publishClient(organizationId, plan); } catch { client = null; }
    const resolved: { key: string; name: string }[] = [];
    const notCarried: string[] = [];
    for (const r of top) {
      let key: string | null = null;
      if (client) {
        const type = CampaignsService.TARGETING_SEARCH_TYPES["geo"];
        const found = await client.client.targetingSearch(client.account.externalId, { type, query: r.region }).catch(() => [] as any[]);
        const exact = (found ?? []).filter((f: any) => String(f.name ?? "").trim().toLowerCase() === r.region.trim().toLowerCase());
        const hit = exact.find((f: any) => String(f.type ?? "").toLowerCase().includes("region")) ?? exact[0];
        if (hit?.id) key = String(hit.id);
      }
      if (key) resolved.push({ key, name: r.region });
      else notCarried.push(`${r.region}: Meta Region Key resolve হয়নি — এই Region-টি Draft-এ যোগ হয়নি (আন্দাজে Key বসানো হয় না)`);
    }
    if (!resolved.length) {
      throw new BadRequestException(`কোনো Region-এরই Meta Key resolve হয়নি — Draft বানানো যাচ্ছে না। ${notCarried.join("; ")}`);
    }
    const targeting = { ...(source.targeting ?? {}), regions: resolved };
    const created = await (this.prisma as any).campaignAdSet.create({
      data: {
        planId, name: `${source.name} — শীর্ষ Region`.slice(0, 120),
        dailyBudgetMinor: source.dailyBudgetMinor ?? null,
        lifetimeBudgetMinor: source.lifetimeBudgetMinor ?? null,
        optimizationGoal: source.optimizationGoal,
        pageId: source.pageId ?? null, pixelId: source.pixelId ?? null,
        targeting: targeting as any,
        bidStrategy: source.bidStrategy ?? null, bidAmountMinor: source.bidAmountMinor ?? null,
        costGoalMinor: source.costGoalMinor ?? null, roasAverageFloor: source.roasAverageFloor ?? null,
        conversionEvent: source.conversionEvent ?? null,
        catalogRecordId: source.catalogRecordId ?? null, productSetId: source.productSetId ?? null, leadFormId: source.leadFormId ?? null,
        destinationType: source.destinationType ?? null,
        whatsappIntegrationId: source.whatsappIntegrationId ?? null,
        whatsappPhoneNumberId: source.whatsappPhoneNumberId ?? null,
        whatsappPhoneNumber: source.whatsappPhoneNumber ?? null,
        funnelLayer: (source as any).funnelLayer ?? null,
        funnelIncomplete: (source as any).funnelIncomplete ?? null,
        startTime: source.startTime ?? null, endTime: source.endTime ?? null,
      },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.region_adset_draft_created", entityType: "CampaignAdSet", entityId: created.id, metadata: { planId, sourceAdSetId: source.id, regions: resolved.map((r) => r.name), notCarried: notCarried.length } }).catch(() => undefined);
    return {
      adSet: this.adSetJson(created),
      regions: resolved,
      notCarried,
      basedOn: { campaignExternalId: perf.campaignExternalId, minRows: perf.minRows, totalRows: perf.totalRows, topN },
      note: "এটি একটি স্থানীয় খসড়া Ad Set — Meta-তে কিছুই পাঠানো হয়নি, Live Campaign অপরিবর্তিত। চালু করার আগে Targeting ও Budget যাচাই করুন",
    };
  }

  // ---------- CA19 (CB5): geo holdout — spike-first ----------
  /** CA19 SPIKE VERDICT (official Meta docs, verified
   *  2026-10-17): a Meta Ad Study CANNOT split by
   *  geography, so a geo holdout can NOT be created
   *  through the CN15 path. Evidence: (1) the documented
   *  create contract CN15 builds on — POST
   *  /{business_id}/ad_studies, type SPLIT_TEST — takes
   *  cells of { name, treatment_percentage, campaigns }:
   *  the split is a share of the audience assigned across
   *  the cells' campaigns, and there is NO region/geo
   *  field on the study or the cell; (2) Meta's own
   *  Experiments overview describes every test type as a
   *  USER split (A/B: "your audience is randomized and
   *  split into separate groups"; Brand/Conversion Lift
   *  divide the audience into test/control groups). Geo
   *  experimentation in Meta's ecosystem is the external
   *  GeoLift methodology over separately geo-targeted
   *  campaigns — an analysis method, not an Ad Study
   *  type. What ships below is therefore the honest
   *  fallback: a holdout DEFINITION on the plan plus an
   *  OBSERVATIONAL comparison over stored region
   *  breakdown rows. The definition changes NO delivery
   *  by itself, and the comparison is labelled as
   *  observation, never as an experiment or a lift %. */
  static readonly HOLDOUT_MAX_WINDOW_DAYS = 92;
  static readonly HOLDOUT_METHOD = "এটি Meta Experiment নয় — Ad Study-তে Geo Split নেই (CA19 spike, Meta-র অফিসিয়াল ডকুমেন্টেশন)। এটি সংরক্ষিত Region Breakdown Row-এর পর্যবেক্ষণমূলক (observational) তুলনা: Test ও Holdout Region-এর জনসংখ্যা, চাহিদা ও প্রতিযোগিতা আলাদা, তাই দুই পাশের পার্থক্য মানেই বিজ্ঞাপনের কারণে হওয়া প্রভাব (lift) নয়";
  static readonly HOLDOUT_DELIVERY_NOTE = "এই Definition নিজে থেকে Delivery বদলায় না — Holdout Region-এ বিজ্ঞাপন বন্ধ রাখতে চাইলে Plan-এর Targeting থেকে ওই Region বাদ দিতে হবে; Definition শুধু কোন Region কোন দলে তা মনে রাখে আর Window জুড়ে আসল Breakdown Row তুলনা করে";

  private geoHoldoutJson(row: any) {
    const names = (v: any) => (Array.isArray(v) ? v.map((r: any) => String(r?.name ?? "")).filter(Boolean) : []);
    return {
      id: row.id, planId: row.planId, status: row.status,
      testRegions: names(row.testRegions), holdoutRegions: names(row.holdoutRegions),
      startsAt: row.startsAt ? new Date(row.startsAt).toISOString() : null,
      endsAt: row.endsAt ? new Date(row.endsAt).toISOString() : null,
      note: row.note ?? null, createdById: row.createdById,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    };
  }

  private normalizeRegionNames(input: unknown): string[] {
    const raw = Array.isArray(input) ? input : typeof input === "string" ? input.split(/[\n,]+/) : [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of raw) {
      const name = String(typeof v === "string" ? v : (v as any)?.name ?? "").trim().replace(/\s+/g, " ");
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
    return out;
  }

  /** CA19: save a geo holdout DEFINITION on a plan. One
   *  ACTIVE definition per plan; the two region sets
   *  must be non-empty and disjoint; the window is at
   *  most 92 days. Nothing is sent to Meta and no
   *  targeting changes — see the spike verdict above. */
  async createGeoHoldout(organizationId: string, actorId: string, planId: string, dto: {
    testRegions?: unknown; holdoutRegions?: unknown; startsAt?: string; endsAt?: string; note?: string;
  }) {
    await this.getPlanOrThrow(organizationId, planId);
    const p = this.prisma as any;
    if (!p.planGeoHoldout?.create) throw new BadRequestException("Geo Holdout Store পাওয়া যাচ্ছে না");
    const test = this.normalizeRegionNames(dto.testRegions);
    const holdout = this.normalizeRegionNames(dto.holdoutRegions);
    if (!test.length) throw new BadRequestException("অন্তত একটি Test Region দিতে হবে");
    if (!holdout.length) throw new BadRequestException("অন্তত একটি Holdout Region দিতে হবে");
    const holdoutKeys = new Set(holdout.map((n) => n.toLowerCase()));
    const overlap = test.filter((n) => holdoutKeys.has(n.toLowerCase()));
    if (overlap.length) throw new BadRequestException(`একই Region দুই দলেই আছে: ${overlap.join(", ")} — একটি Region হয় Test, নয় Holdout`);
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (!startsAt || Number.isNaN(startsAt.getTime())) throw new BadRequestException("startsAt সঠিক তারিখ নয়");
    if (!endsAt || Number.isNaN(endsAt.getTime())) throw new BadRequestException("endsAt সঠিক তারিখ নয়");
    if (endsAt.getTime() <= startsAt.getTime()) throw new BadRequestException("Window-এর শেষ শুরুর পরে হতে হবে");
    if (endsAt.getTime() - startsAt.getTime() > CampaignsService.HOLDOUT_MAX_WINDOW_DAYS * 86_400_000) {
      throw new BadRequestException(`Holdout Window সর্বোচ্চ ${CampaignsService.HOLDOUT_MAX_WINDOW_DAYS} দিন হতে পারে`);
    }
    const existing = await p.planGeoHoldout.findFirst({ where: { organizationId, planId, status: "active" } }).catch(() => null);
    if (existing) throw new BadRequestException("এই Plan-এ ইতিমধ্যে একটি Active Holdout Definition আছে — নতুন বানাতে চাইলে আগেরটি শেষ (End) করুন");
    const row = await p.planGeoHoldout.create({
      data: {
        organizationId, planId, status: "active",
        testRegions: test.map((name) => ({ name })), holdoutRegions: holdout.map((name) => ({ name })),
        startsAt, endsAt, note: dto.note ? String(dto.note).slice(0, 500) : null, createdById: actorId,
      },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.geo_holdout_created", entityType: "CampaignPlan", entityId: planId, metadata: { holdoutId: row.id, test, holdout } }).catch(() => undefined);
    return this.getGeoHoldout(organizationId, planId);
  }

  /** CA19: end the plan's active holdout definition
   *  (history stays; the measurement remains readable). */
  async endGeoHoldout(organizationId: string, actorId: string, planId: string, holdoutId: string) {
    await this.getPlanOrThrow(organizationId, planId);
    const p = this.prisma as any;
    const row = p.planGeoHoldout?.findFirst ? await p.planGeoHoldout.findFirst({ where: { id: holdoutId, organizationId, planId } }).catch(() => null) : null;
    if (!row) throw new NotFoundException("Holdout definition not found in this organization");
    if (row.status !== "active") throw new BadRequestException("এই Holdout Definition আগেই শেষ করা হয়েছে");
    await p.planGeoHoldout.update({ where: { id: row.id }, data: { status: "ended" } });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.geo_holdout_ended", entityType: "CampaignPlan", entityId: planId, metadata: { holdoutId: row.id } }).catch(() => undefined);
    return this.getGeoHoldout(organizationId, planId);
  }

  /** CA19: the plan's latest holdout definition + its
   *  observational measurement. Region rows are the
   *  plan campaign's stored DailyAdBreakdown (dimension
   *  "region") inside the window, aggregated with the
   *  CA9 aggregator and bucketed by the definition's
   *  name sets (exact match after normalisation — the
   *  same discipline as the BD division mapping).
   *  Regions in NEITHER set are reported as "other",
   *  never silently merged into a side. Spend observed
   *  in holdout regions is flagged, not hidden: the
   *  definition does not stop delivery. */
  async getGeoHoldout(organizationId: string, planId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    const p = this.prisma as any;
    const base = {
      method: CampaignsService.HOLDOUT_METHOD,
      deliveryNote: CampaignsService.HOLDOUT_DELIVERY_NOTE,
      spikeVerdict: "not_creatable_via_ad_study",
    };
    if (!p.planGeoHoldout?.findMany) return { ...base, available: false, reason: "Geo Holdout Store পাওয়া যাচ্ছে না", holdout: null, measurement: null };
    const rows = await p.planGeoHoldout.findMany({ where: { organizationId, planId }, orderBy: { createdAt: "desc" }, take: 5 }).catch(() => []);
    const latest = (rows as any[])[0];
    if (!latest) return { ...base, available: false, reason: "এই Plan-এ কোনো Geo Holdout Definition নেই", holdout: null, measurement: null };
    const holdout = this.geoHoldoutJson(latest);
    if (!plan.externalCampaignId) {
      return { ...base, available: true, holdout, measurement: { available: false, reason: "Plan এখনো Publish হয়নি — Measurement শুধু Publish হওয়া Campaign-এর সংরক্ষিত Breakdown Row থেকে আসে" } };
    }
    if (!p.dailyAdBreakdown?.findMany) {
      return { ...base, available: true, holdout, measurement: { available: false, reason: "Breakdown Store পাওয়া যাচ্ছে না" } };
    }
    const allRows = await p.dailyAdBreakdown.findMany({ where: { organizationId, campaignExternalId: plan.externalCampaignId, dimension: "region" } }).catch(() => []);
    const startMs = new Date(latest.startsAt).getTime();
    const endMs = new Date(latest.endsAt).getTime();
    const inWindow = (allRows as any[]).filter((r) => {
      const t = new Date(r.date).getTime();
      return !Number.isNaN(t) && t >= startMs && t <= endMs;
    });
    const norm = (s: string) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    const testKeys = new Set(holdout.testRegions.map(norm));
    const holdoutKeys = new Set(holdout.holdoutRegions.map(norm));
    const aggregated = CampaignsService.aggregateRegionRows(inWindow);
    const groups = {
      test: { regions: [] as any[], spend: 0, spendMinor: "0", impressions: 0, clicks: 0, conversions: 0, cpa: null as number | null, conversionsPer1000Spend: null as number | null },
      holdout: { regions: [] as any[], spend: 0, spendMinor: "0", impressions: 0, clicks: 0, conversions: 0, cpa: null as number | null, conversionsPer1000Spend: null as number | null },
      other: { regions: [] as any[], spend: 0, spendMinor: "0", impressions: 0, clicks: 0, conversions: 0, cpa: null as number | null, conversionsPer1000Spend: null as number | null },
    };
    const addTo = (g: any, r: any) => {
      g.regions.push(r);
      g.spend += r.spend; g.impressions += r.impressions; g.clicks += r.clicks; g.conversions += r.conversions;
    };
    for (const r of aggregated) {
      if (testKeys.has(norm(r.region))) addTo(groups.test, r);
      else if (holdoutKeys.has(norm(r.region))) addTo(groups.holdout, r);
      else addTo(groups.other, r);
    }
    for (const g of Object.values(groups)) {
      g.spendMinor = String(Math.round(g.spend * 100));
      g.spend = Math.round(g.spend * 100) / 100;
      g.cpa = g.conversions > 0 ? Math.round((g.spend / g.conversions) * 100) / 100 : null;
      g.conversionsPer1000Spend = g.spend > 0 ? Math.round((g.conversions / g.spend) * 1000 * 100) / 100 : null;
    }
    const observedDifferencePer1000 = groups.test.conversionsPer1000Spend != null && groups.holdout.conversionsPer1000Spend != null
      ? Math.round((groups.test.conversionsPer1000Spend - groups.holdout.conversionsPer1000Spend) * 100) / 100
      : null;
    return {
      ...base, available: true, holdout,
      measurement: {
        available: true, campaignExternalId: plan.externalCampaignId,
        windowRows: inWindow.length,
        groups, observedDifferencePer1000,
        observedDifferenceLabel: "প্রতি ৳১,০০০ খরচে Conversion-এর পার্থক্য (Test − Holdout) — শুধু পর্যবেক্ষণমূলক পাটিগণিত, Lift নয়",
        holdoutSpendDetected: groups.holdout.spend > 0,
        holdoutSpendNote: groups.holdout.spend > 0
          ? "সতর্কতা: Window-তে Holdout Region-এও খরচ হয়েছে — Definition Delivery থামায় না; Targeting থেকে Region বাদ না দিলে বিজ্ঞাপন চলবেই"
          : "Window-তে Holdout Region-এ কোনো খরচের Row নেই",
        note: "Breakdown Row Campaign-Level — কোন Ad Set কোন Region-এ কত খরচ করেছে তা আলাদা করে জানা যায় না (CA9-এর একই সীমা)",
      },
    };
  }

  // ---------- CA22 (CB5): builder inbox + counter-drafts ----------
  static readonly BUILDER_SIGNAL_MAX_CHARS = 500;
  static readonly BUILDER_SIGNAL_MIN_CHARS = 3;
  static readonly BUILDER_AD_MIN_AGE_DAYS = 14;
  static readonly BUILDER_INBOX_NOTE = "সিগন্যাল মানে একটি পর্যবেক্ষণ — Manual এন্ট্রি অথবা আগে থেকে সংরক্ষিত Competitor রেকর্ড থেকে Merchant-এর এক ক্লিকে Import। প্রতিটি সিগন্যাল থেকে suggestPlan দিয়ে শুধু একটি DRAFT তৈরি হয় — কখনো Publish হয় না। স্বয়ংক্রিয় Competitor Feed এই Inbox-এ আসে না: Competitor Monitoring তার পরিকল্পিত Smart AI ধারায় (C1–C2) আছে — এই Batch-এ তা NOT BUILT";
  static readonly BUILDER_AD_IMPORT_NOTE = "Creative-এর টেক্সট/ছবি এখানে কপি করা হয় না (CN18 Leak-proof নিয়ম) — শুধু Metadata (কতদিন ধরে Active, Link)";

  /** Product match by NAME TOKENS (deterministic):
   *  tokens are >=3-char words of the query text; a
   *  product scores how many of its name tokens the text
   *  mentions (case-insensitive substring both ways);
   *  highest score wins, ties break by name — no match
   *  returns null and the draft is built without one. */
  async matchProductByName(organizationId: string, text: string) {
    const p = this.prisma as any;
    const products = p.product?.findMany ? await p.product.findMany({ where: { organizationId }, take: 500 }).catch(() => []) : [];
    const lower = String(text ?? "").toLowerCase();
    const textTokens = [...new Set(lower.split(/[^a-z0-9\u0980-\u09FF]+/i).map((t) => t.trim()).filter((t) => t.length >= 3))];
    let best: any = null;
    let bestScore = 0;
    for (const prod of products as any[]) {
      const nameTokens = String(prod.name ?? "").toLowerCase().split(/[^a-z0-9\u0980-\u09FF]+/i).map((t) => t.trim()).filter((t) => t.length >= 3);
      let score = 0;
      for (const nt of nameTokens) {
        if (textTokens.includes(nt) || lower.includes(nt)) score++;
      }
      if (score > bestScore || (score === bestScore && score > 0 && best && String(prod.name).localeCompare(String(best.name)) < 0)) {
        best = prod; bestScore = score;
      }
    }
    return bestScore > 0 ? best : null;
  }

  async builderSignalOrThrow(organizationId: string, signalId: string) {
    const row = await (this.prisma as any).builderInboxSignal.findFirst({ where: { id: signalId, organizationId } });
    if (!row) throw new NotFoundException("Builder inbox signal not found");
    return row;
  }

  async listBuilderInbox(organizationId: string) {
    const p = this.prisma as any;
    const signals = await p.builderInboxSignal.findMany({ where: { organizationId }, take: 100 }).catch(() => []);
    const sorted = [...(signals as any[])].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const importedKeys = new Set(sorted.filter((s) => s.status !== "dismissed" && s.sourceRefId).map((s) => `${s.source}:${s.sourceRefId}`));
    const competitors = p.competitor?.findMany ? await p.competitor.findMany({ where: { organizationId }, take: 200 }).catch(() => []) : [];
    const compName = new Map((competitors as any[]).map((c) => [c.id, c.name]));
    const orgCompIds = new Set((competitors as any[]).map((c) => c.id));
    const fresh = <T,>(rows: T[], n = 10) => [...(rows as any[])].sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()).slice(0, n);
    const insights = p.competitorInsight?.findMany ? fresh(await p.competitorInsight.findMany({ where: { organizationId }, take: 100 }).catch(() => [])) : [];
    const prices = p.competitorPriceObservation?.findMany ? fresh(await p.competitorPriceObservation.findMany({ where: { organizationId }, take: 100 }).catch(() => [])) : [];
    const allAds = p.competitorAd?.findMany ? await p.competitorAd.findMany({ take: 500 }).catch(() => []) : [];
    const minAge = CampaignsService.BUILDER_AD_MIN_AGE_DAYS * 86_400_000;
    const ads = fresh((allAds as any[]).filter((a) => orgCompIds.has(a.competitorId) && a.isActive === true && a.startedAt && Date.now() - new Date(a.startedAt).getTime() >= minAge));
    return {
      note: CampaignsService.BUILDER_INBOX_NOTE,
      winningAdMinAgeDays: CampaignsService.BUILDER_AD_MIN_AGE_DAYS,
      signals: sorted,
      importable: {
        insights: insights.filter((r: any) => !importedKeys.has(`competitor_insight:${r.id}`)).map((r: any) => ({ source: "competitor_insight", sourceRefId: r.id, competitorId: r.competitorId ?? null, competitorName: r.competitorId ? compName.get(r.competitorId) ?? null : null, label: `${String(r.kind ?? "insight")}: ${String(r.title ?? "")}`, createdAt: r.createdAt })),
        prices: prices.filter((r: any) => !importedKeys.has(`competitor_price:${r.id}`)).map((r: any) => ({ source: "competitor_price", sourceRefId: r.id, competitorId: r.competitorId ?? null, competitorName: r.competitorId ? compName.get(r.competitorId) ?? null : null, label: `${String(r.productName ?? "")} — ৳${(Number(r.priceMinor ?? 0) / 100).toLocaleString("en-IN")}`, createdAt: r.createdAt })),
        ads: ads.filter((r: any) => !importedKeys.has(`competitor_ad:${r.id}`)).map((r: any) => ({ source: "competitor_ad", sourceRefId: r.id, competitorId: r.competitorId ?? null, competitorName: r.competitorId ? compName.get(r.competitorId) ?? null : null, label: `বিজ্ঞাপন ${Math.floor((Date.now() - new Date(r.startedAt).getTime()) / 86_400_000)} দিন ধরে Active`, createdAt: r.createdAt })),
      },
    };
  }

  async createBuilderSignal(organizationId: string, actorId: string, dto: { text: string; productId?: string }) {
    const p = this.prisma as any;
    const text = String(dto.text ?? "").trim();
    if (text.length < CampaignsService.BUILDER_SIGNAL_MIN_CHARS) throw new BadRequestException(`সিগন্যালের লেখা কমপক্ষে ${CampaignsService.BUILDER_SIGNAL_MIN_CHARS} অক্ষরের হতে হবে`);
    if (text.length > CampaignsService.BUILDER_SIGNAL_MAX_CHARS) throw new BadRequestException(`সিগন্যালের লেখা সর্বোচ্চ ${CampaignsService.BUILDER_SIGNAL_MAX_CHARS} অক্ষর`);
    if (dto.productId) {
      const product = await p.product.findFirst({ where: { id: dto.productId, organizationId } });
      if (!product) throw new NotFoundException("Product not found in this organization");
    }
    const signal = await p.builderInboxSignal.create({
      data: { organizationId, source: "manual", text, productId: dto.productId ?? null, status: "new", createdById: actorId },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.builder_signal_created", entityType: "BuilderInboxSignal", entityId: signal.id, metadata: { source: "manual" } }).catch(() => undefined);
    return { signal };
  }

  /** Import ONE stored competitor row as a signal. The
   *  text is composed from stored METADATA only —
   *  CompetitorAd.creativeText is NEVER copied (CN18
   *  leak-proof rule, spec-pinned). Dedupe: a
   *  non-dismissed signal for the same source row is
   *  returned instead of creating a duplicate. */
  async importCompetitorSignal(organizationId: string, actorId: string, dto: { source: string; sourceRefId: string }) {
    const p = this.prisma as any;
    const source = String(dto.source ?? "");
    const ref = String(dto.sourceRefId ?? "");
    if (!["competitor_insight", "competitor_price", "competitor_ad"].includes(source) || !ref) {
      throw new BadRequestException("source must be competitor_insight | competitor_price | competitor_ad with a sourceRefId");
    }
    const existing = await p.builderInboxSignal.findMany({ where: { organizationId, source, sourceRefId: ref }, take: 50 }).catch(() => []);
    const live = (existing as any[]).find((s) => s.status !== "dismissed");
    if (live) return { signal: live, alreadyImported: true };
    let text = "";
    let competitorId: string | null = null;
    let productId: string | null = null;
    const compNameOf = async (cid: string | null | undefined) => {
      if (!cid || !p.competitor?.findFirst) return "অজানা প্রতিযোগী";
      const c = await p.competitor.findFirst({ where: { id: cid, organizationId } }).catch(() => null);
      return c ? String(c.name) : "অজানা প্রতিযোগী";
    };
    if (source === "competitor_insight") {
      const row = p.competitorInsight?.findFirst ? await p.competitorInsight.findFirst({ where: { id: ref, organizationId } }).catch(() => null) : null;
      if (!row) throw new NotFoundException("Competitor insight not found in this organization");
      competitorId = row.competitorId ?? null;
      productId = row.productId ?? null;
      text = `প্রতিযোগীর Insight (${String(row.kind ?? "insight")}): "${String(row.title ?? "")}" — ${String(row.detail ?? "")}`.slice(0, CampaignsService.BUILDER_SIGNAL_MAX_CHARS);
    } else if (source === "competitor_price") {
      const row = p.competitorPriceObservation?.findFirst ? await p.competitorPriceObservation.findFirst({ where: { id: ref, organizationId } }).catch(() => null) : null;
      if (!row) throw new NotFoundException("Competitor price observation not found in this organization");
      competitorId = row.competitorId ?? null;
      const name = await compNameOf(competitorId);
      text = `প্রতিযোগী ${name} "${String(row.productName ?? "")}" ৳${(Number(row.priceMinor ?? 0) / 100).toLocaleString("en-IN")} দামে বিক্রি করছে (সংরক্ষিত Price Observation থেকে)`;
      const matched = await this.matchProductByName(organizationId, String(row.productName ?? ""));
      productId = matched?.id ?? null;
    } else {
      const row = p.competitorAd?.findFirst ? await p.competitorAd.findFirst({ where: { id: ref } }).catch(() => null) : null;
      if (!row || !row.competitorId) throw new NotFoundException("Competitor ad not found");
      const comp = p.competitor?.findFirst ? await p.competitor.findFirst({ where: { id: row.competitorId, organizationId } }).catch(() => null) : null;
      if (!comp) throw new NotFoundException("Competitor ad not found in this organization");
      competitorId = row.competitorId;
      const days = row.startedAt ? Math.floor((Date.now() - new Date(row.startedAt).getTime()) / 86_400_000) : 0;
      // NOTE: row.creativeText is deliberately never read here.
      text = `প্রতিযোগী ${String(comp.name)}-এর একটি বিজ্ঞাপন ${days} দিন ধরে Active আছে${row.linkUrl ? ` (Link: ${String(row.linkUrl)})` : ""} — ${CampaignsService.BUILDER_AD_IMPORT_NOTE}`;
    }
    const signal = await p.builderInboxSignal.create({
      data: { organizationId, source, sourceRefId: ref, competitorId, text, productId, status: "new", createdById: actorId },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.builder_signal_imported", entityType: "BuilderInboxSignal", entityId: signal.id, metadata: { source, sourceRefId: ref } }).catch(() => undefined);
    return { signal, alreadyImported: false };
  }

  async dismissBuilderSignal(organizationId: string, actorId: string, signalId: string) {
    const p = this.prisma as any;
    const signal = await this.builderSignalOrThrow(organizationId, signalId);
    if (signal.status === "dismissed") return { signal };
    if (signal.status !== "new") throw new BadRequestException("শুধু 'new' অবস্থার সিগন্যাল Dismiss করা যায় — Drafted সিগন্যালের ইতিহাস থাকে");
    const updated = await p.builderInboxSignal.update({ where: { id: signalId }, data: { status: "dismissed" } });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.builder_signal_dismissed", entityType: "BuilderInboxSignal", entityId: signalId, metadata: {} }).catch(() => undefined);
    return { signal: updated };
  }

  /** One click -> a suggestPlan DRAFT seeded from the
   *  signal. suggestPlan itself only ever creates drafts
   *  (no publish path exists in it), and the created
   *  plan's status is asserted "draft" before the signal
   *  is marked drafted — the no-publish guarantee is
   *  spec-pinned, not just intended. */
  async draftFromSignal(organizationId: string, actorId: string, signalId: string, dto: { adAccountId: string; totalDailyBudget: string }) {
    const p = this.prisma as any;
    const signal = await this.builderSignalOrThrow(organizationId, signalId);
    if (signal.status === "drafted") throw new BadRequestException("এই সিগন্যাল থেকে ইতিমধ্যে Draft তৈরি হয়েছে");
    if (signal.status !== "new") throw new BadRequestException("Dismissed সিগন্যাল থেকে Draft তৈরি হয় না");
    let productId = signal.productId ?? null;
    if (!productId) {
      const matched = await this.matchProductByName(organizationId, signal.text);
      productId = matched?.id ?? null;
    }
    const suggestion: any = await this.suggestPlan(organizationId, actorId, {
      adAccountId: dto.adAccountId, productId: productId ?? undefined, goal: signal.text, totalDailyBudget: dto.totalDailyBudget,
    });
    const plan = suggestion?.plan;
    if (!plan?.id || plan.status !== "draft") {
      throw new BadRequestException("suggestPlan একটি Draft তৈরি করেনি — সিগন্যাল অপরিবর্তিত রাখা হলো");
    }
    const updated = await p.builderInboxSignal.update({ where: { id: signalId }, data: { status: "drafted", draftPlanId: plan.id, productId: productId ?? signal.productId ?? null } });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.builder_signal_drafted", entityType: "BuilderInboxSignal", entityId: signalId, metadata: { draftPlanId: plan.id, productId, productMatched: Boolean(productId) } }).catch(() => undefined);
    return { signal: updated, plan, productMatched: Boolean(productId), note: "এটি শুধু একটি DRAFT — Publish হয়নি। Builder-এ যাচাই করে সম্পাদনা করুন, তারপর নিজে Submit করুন।" };
  }

  // ---------- CA21 (CB5): COD return-adjusted ROAS ----------
  /** CA21 LINKAGE FINDING (verified in code before
   *  building): orders carry NO campaign id. Two REAL
   *  linkages exist, and this view unions them (each
   *  order counted once, provenance reported):
   *  (1) the first-party attribution engine's own join —
   *  AttributionCredit rows whose touchpoint's campaign
   *  is this plan's name or external campaign id (the
   *  exact join planPerformance's first-party revenue
   *  uses), giving credited ORDER IDS;
   *  (2) the AB7 order stamps — Order.utmCampaign equal
   *  to a utm_campaign value THIS plan's ads emit
   *  (CA17's utmParamsFor for the plan account's
   *  platform, plus the legacy Phase-J slug) with
   *  utm_source matching the plan platform's source.
   *  There is no click-level attribution and no
   *  plan→store link; the scope text below says exactly
   *  that, in the payload and the UI. */
  static readonly ADJUSTED_ROAS_SCOPE = "পরিধি: শুধু সেই COD অর্ডার যেগুলো এই Plan-এর সঙ্গে দুটি আসল যোগসূত্রের যেকোনো একটি দিয়ে মিলেছে — (১) First-party Attribution Engine-এর Credit (Touchpoint-এর Campaign = এই Plan), অথবা (২) অর্ডারের নিজের utm_campaign + utm_source স্ট্যাম্প (AB7) এই Plan-এর বিজ্ঞাপনের মানের সঙ্গে মিলেছে। Plan Publish হওয়ার পর থেকে হিসাব। স্ট্যাম্প/Credit-বিহীন অর্ডার এই হিসাবে আসেনি। এটি Click-Attribution নয়";
  static readonly ADJUSTED_ROAS_DEFINITIONS = {
    delivered: "EC33-এর Sold সংজ্ঞা (isSoldOrder): Cancelled/Refunded/Failed নয় এবং (Status completed/delivered অথবা CourierShipment delivered/partial_delivered)",
    returned: "Raw Status 'returned' অথবা received/completed অবস্থার ReturnRequest আছে এমন অর্ডার — Returned অর্ডার Delivered আয়ে কখনো ঢোকে না",
    adjusted: "প্রতিটি Delivered COD অর্ডারে (মোট − refundedMinor), শূন্যের নিচে নয়; Adjusted ROAS = এই Adjusted আয় ÷ একই Window-তে Plan Campaign-এর সংরক্ষিত Ad Spend",
  };

  /** CA21: the return-adjusted view beside the raw one.
   *  The raw figure is NEVER replaced: the payload
   *  carries planPerformance's existing first-party
   *  revenue/ROAS verbatim AND an order-set gross ROAS
   *  (same matched orders, before return adjustment). */
  async planAdjustedRoas(organizationId: string, planId: string, now = new Date()) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    const p = this.prisma as any;
    const base = {
      planId, label: "cod_return_adjusted_from_real_orders",
      scope: CampaignsService.ADJUSTED_ROAS_SCOPE,
      definitions: CampaignsService.ADJUSTED_ROAS_DEFINITIONS,
    };
    if (!plan.externalCampaignId) {
      return { ...base, available: false, reason: "Plan এখনো Publish হয়নি — Adjusted ROAS শুধু Live Campaign-এর Window-তে হিসাব হয়" };
    }
    const account = p.adAccount?.findFirst ? await p.adAccount.findFirst({ where: { id: plan.adAccountId, organizationId } }).catch(() => null) : null;
    const platform = account?.platform === "google" ? "google" : account?.platform === "tiktok" ? "tiktok" : "meta";
    const params = this.utmParamsFor(plan, { platform: platform as any });
    const campaignParam = params.find((x) => x.key === "utm_campaign")?.value ?? "";
    const sourceParam = (params.find((x) => x.key === "utm_source")?.value ?? (platform === "meta" ? "facebook" : platform)).toLowerCase();
    const legacySlug = this.utmSlug(String(plan.name ?? "")) || "campaign";
    const candidates = [...new Set([campaignParam, legacySlug].filter(Boolean))];

    // window: publish instant (fallback: first metric day,
    // then plan creation) → now, by UTC day floor for rows.
    const metricRows = p.dailyAdMetric?.findMany
      ? await p.dailyAdMetric.findMany({ where: { organizationId, campaignExternalId: plan.externalCampaignId }, take: 20000 }).catch(() => [])
      : [];
    const campaignRows = (metricRows as any[]).filter((r) => (r.adSetExternalId ?? "") === "" && (r.adExternalId ?? "") === "");
    let firstMetric: Date | null = null;
    for (const r of campaignRows) {
      const d = new Date(r.date);
      if (!Number.isNaN(d.getTime()) && (!firstMetric || d < firstMetric)) firstMetric = d;
    }
    const windowStart = plan.publishedAt ? new Date(plan.publishedAt) : firstMetric ?? new Date(plan.createdAt);
    const windowDayStart = new Date(Date.UTC(windowStart.getUTCFullYear(), windowStart.getUTCMonth(), windowStart.getUTCDate()));
    let spend = 0n;
    for (const r of campaignRows) {
      const t = new Date(r.date).getTime();
      if (Number.isNaN(t) || t < windowDayStart.getTime() || t > now.getTime()) continue;
      try { spend += BigInt(r.spendMinor ?? 0); } catch { /* malformed row never poisons totals */ }
    }

    // linkage (1): attribution credits → order ids
    const creditedOrderIds = new Set<string>();
    if (p.attributionCredit?.findMany && p.touchpoint?.findMany) {
      const credits = await p.attributionCredit.findMany({ where: { organizationId }, take: 20000 }).catch(() => []);
      if ((credits as any[]).length) {
        const tpIds = [...new Set((credits as any[]).map((c) => c.touchpointId).filter(Boolean))];
        const tps = tpIds.length ? await p.touchpoint.findMany({ where: { id: { in: tpIds } } }).catch(() => []) : [];
        const tpMap = new Map((tps as any[]).map((t) => [t.id, t]));
        for (const c of credits as any[]) {
          const tp: any = tpMap.get(c.touchpointId);
          if (tp && (tp.campaign === plan.name || tp.campaign === plan.externalCampaignId) && c.orderId) creditedOrderIds.add(String(c.orderId));
        }
      }
    }
    // linkage (2): utm-stamped orders for this plan
    const stampedOrders = p.order?.findMany
      ? await p.order.findMany({ where: { organizationId, utmCampaign: { in: candidates } }, take: 20000 }).catch(() => [])
      : [];
    const orderById = new Map<string, any>();
    const provenance = new Map<string, string[]>();
    const addOrder = (o: any, via: string) => {
      if (!o?.id) return;
      orderById.set(String(o.id), o);
      const arr = provenance.get(String(o.id)) ?? [];
      if (!arr.includes(via)) arr.push(via);
      provenance.set(String(o.id), arr);
    };
    for (const o of stampedOrders as any[]) {
      if (String(o.utmSource ?? "").trim().toLowerCase() !== sourceParam) continue;
      addOrder(o, "utm_stamp");
    }
    if (creditedOrderIds.size && p.order?.findMany) {
      const credited = await p.order.findMany({ where: { organizationId, id: { in: [...creditedOrderIds] } }, take: 20000 }).catch(() => []);
      for (const o of credited as any[]) addOrder(o, "attribution_credit");
    }
    const orderDate = (o: any) => {
      const t = o.placedAt ? new Date(o.placedAt).getTime() : o.createdAt ? new Date(o.createdAt).getTime() : NaN;
      return Number.isNaN(t) ? null : t;
    };
    const matched = [...orderById.values()].filter((o) => {
      if (o.isPractice) return false;
      const t = orderDate(o);
      return t != null && t >= windowDayStart.getTime() && t <= now.getTime();
    });
    const coverage = {
      viaAttributionCredit: matched.filter((o) => provenance.get(String(o.id))?.includes("attribution_credit")).length,
      viaUtmStamp: matched.filter((o) => provenance.get(String(o.id))?.includes("utm_stamp")).length,
      matchedUtmCampaigns: candidates, expectedSource: sourceParam,
    };
    if (!matched.length) {
      return {
        ...base, available: false,
        reason: "এই Plan-এর সঙ্গে যোগসূত্র মেলা কোনো অর্ডার Window-তে নেই — Credit বা UTM স্ট্যাম্প ছাড়া অর্ডার আন্দাজে এই Plan-এর বলে ধরা হয় না",
        windowStart: windowDayStart.toISOString(), spendMinor: spend.toString(), coverage,
      };
    }
    const isCod = (o: any) => o.isCod === true || String(o.paymentMethod ?? "").toLowerCase() === "cod";
    const codMatched = matched.filter(isCod);
    const matchedIds = matched.map((o) => String(o.id));
    // returned leg: raw status or a received/completed RMA
    const returnedIds = new Set<string>(matched.filter((o) => String(o.status ?? "") === "returned").map((o) => String(o.id)));
    if (p.returnRequest?.findMany && matchedIds.length) {
      const rrs = await p.returnRequest.findMany({ where: { organizationId, orderId: { in: matchedIds }, status: { in: ["received", "completed"] } }, take: 20000 }).catch(() => []);
      for (const rr of rrs as any[]) returnedIds.add(String(rr.orderId));
    }
    const shipByOrder = new Map<string, string[]>();
    if (p.courierShipment?.findMany && matchedIds.length) {
      const ships = await p.courierShipment.findMany({ where: { organizationId, orderId: { in: matchedIds } }, take: 20000 }).catch(() => []);
      for (const s of ships as any[]) {
        const arr = shipByOrder.get(String(s.orderId)) ?? [];
        arr.push(String(s.status ?? ""));
        shipByOrder.set(String(s.orderId), arr);
      }
    }
    let deliveredCount = 0;
    let returnedCount = 0;
    let gross = 0n;
    let refundedTotal = 0n;
    let adjusted = 0n;
    let returnedValue = 0n;
    for (const o of codMatched) {
      const total = (() => { try { return BigInt(o.totalMinor ?? 0); } catch { return 0n; } })();
      if (returnedIds.has(String(o.id))) { returnedCount++; returnedValue += total; continue; }
      if (!isSoldOrder(o, shipByOrder.get(String(o.id)) ?? [])) continue;
      deliveredCount++;
      gross += total;
      const refunded = (() => { try { return BigInt(o.refundedMinor ?? 0); } catch { return 0n; } })();
      refundedTotal += refunded;
      const net = total - refunded;
      adjusted += net > 0n ? net : 0n;
    }
    const roas = (rev: bigint) => (spend > 0n ? Math.round((Number(rev) / Number(spend)) * 100) / 100 : null);
    const perf: any = await this.planPerformance(organizationId, planId).catch(() => null);
    return {
      ...base, available: true,
      windowStart: windowDayStart.toISOString(), windowEnd: now.toISOString(),
      spendMinor: spend.toString(),
      matchedOrders: matched.length,
      codMatchedOrders: codMatched.length,
      nonCodMatchedOrders: matched.length - codMatched.length,
      deliveredOrders: deliveredCount,
      returnedOrders: returnedCount,
      grossRevenueMinor: gross.toString(),
      refundedMinor: refundedTotal.toString(),
      returnedValueMinor: returnedValue.toString(),
      adjustedRevenueMinor: adjusted.toString(),
      rawRoas: spend > 0n ? roas(gross) : null,
      adjustedRoas: spend > 0n ? roas(adjusted) : null,
      zeroSpendNote: spend > 0n ? null : "এই Window-তে Plan Campaign-এর কোনো সংরক্ষিত Ad Spend নেই — ROAS হিসাব হয় না (ভাগফল শূন্য দিয়ে ভাগ করা হয় না)",
      existingFirstParty: perf?.totals ? {
        revenueMinor: perf.totals.firstPartyRevenueMinor, orders: perf.totals.firstPartyOrders, roas: perf.totals.roas,
        note: "Builder-এর বিদ্যমান First-party Revenue/ROAS (Attribution Credit-এর যোগফল) — Return/Refund বাদ না দেওয়া Raw হিসাব; Adjusted হিসাব সেটিকে প্রতিস্থাপন করে না, পাশাপাশি থাকে",
      } : null,
      coverage,
    };
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
              action: { kind: "budget_shift_proposal", applyVia: "live_budget_edit", note: "এটি শুধু প্রস্তাব — নিচের Apply বোতামে মানুষ নিশ্চিত করলে এটি Live Budget Edit পথেই প্রয়োগ হবে (অথবা Ad Set-এর Live Budget Edit দিয়েও করা যায়)। সংখ্যা এর মধ্যে বদলে গেলে Apply refuse করবে। কিছুই নিজে থেকে বদলায়নি।" },
            });
          }
        }
      }
    }
    return { published: true, label: "deterministic_heuristics_from_synced_rows", thresholds, recommendations };
  }

  /** Exact major-unit string for a minor amount (the
   * updateAdSetBudget input format) — no float detour, so
   * ৳333.33 round-trips to exactly 33333 minor. */
  private static minorToMajorString(minor: bigint): string {
    const neg = minor < 0n;
    const abs = neg ? -minor : minor;
    return `${neg ? "-" : ""}${(abs / 100n).toString()}.${(abs % 100n).toString().padStart(2, "0")}`;
  }

  /** CN7: apply the recommendation kinds that are safe to
   * execute from here — creating a fresh DRAFT copy of the
   * plan (the CB5 promote-the-winner pattern) and, since
   * CA11, the budget_shift proposal. Pauses still refuse
   * here: they go through their existing explicit path,
   * named in the refusal. */
  async applyRecommendation(organizationId: string, actorId: string, planId: string, dto: {
    kind: string; adId?: string;
    proposal?: { fromAdSetId: string; toAdSetId: string; shiftMinor: string; fromDailyAfterMinor: string; toDailyAfterMinor: string };
  }): Promise<any> {
    if (dto.kind === "budget_shift") return this.applyBudgetShiftRecommendation(organizationId, actorId, planId, dto);
    if (dto.kind !== "create_fresh_draft") {
      throw new BadRequestException("এই সুপারিশ এখান থেকে প্রয়োগ হয় না — Budget Shift-এর জন্য Recommendation-এর Apply বোতাম (বা Live Budget Edit), Pause-এর জন্য Ad Set Pause বোতাম ব্যবহার করুন (সবই বিদ্যমান স্পষ্ট পথ)।");
    }
    const full = await this.getPlanFull(organizationId, planId);
    const ad = (full.adSets ?? []).flatMap((s: any) => (s.ads ?? []).map((a: any) => ({ ...a, adSetId: s.id }))).find((a: any) => a.id === dto.adId);
    if (!ad) throw new BadRequestException("Ad টি এই Plan-এ পাওয়া যায়নি");
    const draft = await this.duplicatePlan(organizationId, actorId, planId, { name: `${full.name} — Fresh Creative Draft` });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.fresh_draft_from_recommendation", entityType: "CampaignPlan", entityId: (draft as any).id, metadata: { sourcePlanId: planId, fatiguedAdId: ad.id, fatiguedAdName: ad.name } }).catch(() => undefined);
    return { draftId: (draft as any).id, plan: draft, note: "নতুন DRAFT তৈরি হয়েছে — ওই Draft-এ ক্লান্ত Ad-টির Creative বদলে তারপর স্বাভাবিক Approval পথে যান। Live Campaign অপরিবর্তিত।" };
  }

  /** CA11: apply a CN7 budget_shift proposal — the explicit
   * human click the recommendation always required, now
   * wired. The client sends back the proposal it was
   * shown; the server REGENERATES the recommendation and
   * refuses (returning the fresh proposal) when any number
   * moved — stale math is never applied silently. The
   * shift itself goes through updateAdSetBudget (the
   * existing Meta-confirmed live budget edit) donor first,
   * then winner; if the winner leg fails after the donor
   * moved, the donor is rolled back and the failure is
   * audited + reported, never hidden. A post-apply re-read
   * verifies both budgets landed as proposed. */
  async applyBudgetShiftRecommendation(organizationId: string, actorId: string, planId: string, dto: {
    proposal?: { fromAdSetId: string; toAdSetId: string; shiftMinor: string; fromDailyAfterMinor: string; toDailyAfterMinor: string };
  }) {
    const sent = dto.proposal;
    if (!sent?.fromAdSetId || !sent?.toAdSetId || !sent?.shiftMinor) {
      throw new BadRequestException("Budget Shift প্রয়োগে Recommendation-এর proposal পাঠাতে হবে — proposal ছাড়া কোনো সংখ্যা প্রয়োগ হবে না।");
    }
    const fresh = await this.planRecommendations(organizationId, planId);
    const rec = (fresh.recommendations as any[]).find((r) => r.type === "budget_shift");
    if (!rec) {
      throw new BadRequestException({
        message: "এই মুহূর্তে কোনো Budget Shift প্রস্তাব নেই — ডেটা বদলে গেছে। নতুন প্রস্তাব দেখে আবার নিশ্চিত করুন।",
        freshProposal: null,
      } as any);
    }
    const p = rec.proposal;
    const stale =
      p.fromAdSetId !== sent.fromAdSetId || p.toAdSetId !== sent.toAdSetId ||
      p.shiftMinor !== String(sent.shiftMinor) ||
      p.fromDailyAfterMinor !== String(sent.fromDailyAfterMinor) ||
      p.toDailyAfterMinor !== String(sent.toDailyAfterMinor);
    if (stale) {
      throw new BadRequestException({
        message: "সংখ্যা বদলে গেছে — আপনি যে প্রস্তাব দেখে নিশ্চিত করেছিলেন তা আর হুবহু নেই। নতুন প্রস্তাবটি দেখে আবার নিশ্চিত করুন; পুরনো সংখ্যা প্রয়োগ হয়নি।",
        freshProposal: p,
      } as any);
    }
    const full = await this.getPlanFull(organizationId, planId);
    const donor = (full.adSets ?? []).find((s: any) => s.id === p.fromAdSetId);
    const winner = (full.adSets ?? []).find((s: any) => s.id === p.toAdSetId);
    if (!donor || !winner) throw new BadRequestException("প্রস্তাবের Ad Set পাওয়া যায়নি");
    const before = {
      fromDailyMinor: donor.dailyBudgetMinor != null ? BigInt(donor.dailyBudgetMinor).toString() : null,
      toDailyMinor: winner.dailyBudgetMinor != null ? BigInt(winner.dailyBudgetMinor).toString() : null,
    };
    const shift = BigInt(p.shiftMinor);
    const fromAfter = BigInt(p.fromDailyAfterMinor);
    const toAfter = BigInt(p.toDailyAfterMinor);
    // Donor first (a decrease can only free budget), then
    // the winner. updateAdSetBudget is Meta-confirmed: a
    // throw means Meta did NOT confirm that leg.
    await this.updateAdSetBudget(organizationId, actorId, planId, p.fromAdSetId, { dailyBudget: CampaignsService.minorToMajorString(fromAfter) });
    try {
      await this.updateAdSetBudget(organizationId, actorId, planId, p.toAdSetId, { dailyBudget: CampaignsService.minorToMajorString(toAfter) });
    } catch (e) {
      // Roll the donor back to its pre-apply budget so a
      // half-applied shift never stands unexplained.
      let rolledBack = false;
      if (before.fromDailyMinor != null) {
        rolledBack = await this.updateAdSetBudget(organizationId, actorId, planId, p.fromAdSetId, { dailyBudget: CampaignsService.minorToMajorString(BigInt(before.fromDailyMinor)) })
          .then(() => true).catch(() => false);
      }
      await this.audit.log({ organizationId, userId: actorId, action: "campaign.budget_shift_failed", entityType: "CampaignPlan", entityId: planId, metadata: { fromAdSetId: p.fromAdSetId, toAdSetId: p.toAdSetId, shiftMinor: shift.toString(), stage: "winner_leg", donorRolledBack: rolledBack, error: e instanceof Error ? e.message : String(e) } }).catch(() => undefined);
      throw new BadRequestException(`Donor Ad Set-এর বাজেট কমেছে, কিন্তু Winner Ad Set-এ বাড়ানো যায়নি: ${e instanceof Error ? e.message : e}${rolledBack ? " — Donor আগের বাজেটে ফিরিয়ে দেওয়া হয়েছে।" : " — Donor ফিরিয়ে দেওয়াও ব্যর্থ; Budget হাতে যাচাই করুন।"}`);
    }
    // Post-apply verification: re-read and compare against
    // the proposal the human confirmed.
    const afterFull = await this.getPlanFull(organizationId, planId);
    const donorAfter = (afterFull.adSets ?? []).find((s: any) => s.id === p.fromAdSetId);
    const winnerAfter = (afterFull.adSets ?? []).find((s: any) => s.id === p.toAdSetId);
    const after = {
      fromDailyMinor: donorAfter?.dailyBudgetMinor != null ? BigInt(donorAfter.dailyBudgetMinor).toString() : null,
      toDailyMinor: winnerAfter?.dailyBudgetMinor != null ? BigInt(winnerAfter.dailyBudgetMinor).toString() : null,
    };
    const verified = after.fromDailyMinor === fromAfter.toString() && after.toDailyMinor === toAfter.toString();
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.budget_shift_applied", entityType: "CampaignPlan", entityId: planId, metadata: { fromAdSetId: p.fromAdSetId, toAdSetId: p.toAdSetId, shiftMinor: shift.toString(), before, after, verified } });
    return {
      applied: true, verified, before, after,
      shiftMinor: shift.toString(), fromAdSetId: p.fromAdSetId, toAdSetId: p.toAdSetId,
      note: verified
        ? "Budget Shift প্রয়োগ হয়েছে এবং পুনরায় পড়ে যাচাই করা হয়েছে — দুই Ad Set-এর বাজেটই প্রস্তাবের সংখ্যায় আছে।"
        : "Budget Shift-এর দুই ধাপই Meta নিশ্চিত করেছে, তবে পুনরায় পড়া সংখ্যা প্রস্তাবের সঙ্গে হুবহু মেলেনি — Plan খুলে যাচাই করুন।",
      plan: afterFull,
    };
  }

  /** CA11 allocator window: marginal evidence (spend /
   * conversions / CPA) is read from the last 30 days of
   * stored DailyAdMetric campaign-level rows. */
  static readonly ALLOCATOR_WINDOW_DAYS = 30;

  /** CA11: the plan's current daily-budget total over its
   * LIVE ad sets (external id + a daily budget) — the only
   * sets a live budget edit can move. */
  private planLiveDailyTotal(full: any): bigint {
    let total = 0n;
    for (const s of full.adSets ?? []) {
      if (s.externalAdSetId && s.dailyBudgetMinor != null) total += BigInt(s.dailyBudgetMinor);
    }
    return total;
  }

  /** CA11: the ad set an allocation lands on — the plan's
   * best-CPA live set with conversions in the performance
   * window; without per-set conversion evidence, the
   * largest daily budget (stated via targetBasis, never
   * hidden). */
  private allocatorTargetSet(full: any, perf: any): { adSet: any; basis: "lowest_cpa" | "largest_daily_budget" } | null {
    const live = (full.adSets ?? []).filter((s: any) => s.externalAdSetId && s.dailyBudgetMinor != null);
    if (!live.length) return null;
    const perSet = new Map<string, any>((perf?.perAdSet ?? []).map((x: any) => [x.adSetId, x]));
    let best: any = null; let bestCpa: bigint | null = null;
    for (const s of live) {
      const g = perSet.get(s.id);
      if (!g || !(g.conversions > 0) || BigInt(g.spendMinor) <= 0n) continue;
      const cpa = BigInt(g.spendMinor) / BigInt(g.conversions);
      if (bestCpa === null || cpa < bestCpa) { best = s; bestCpa = cpa; }
    }
    if (best) return { adSet: best, basis: "lowest_cpa" };
    const largest = [...live].sort((a: any, b: any) => Number(BigInt(b.dailyBudgetMinor) - BigInt(a.dailyBudgetMinor)))[0];
    return { adSet: largest, basis: "largest_daily_budget" };
  }

  /** CA11: multi-plan budget allocator — PROPOSAL only.
   * The owner names a total extra daily budget; it is
   * distributed across the selected plans by DETERMINISTIC
   * marginal evidence from stored rows: a plan is eligible
   * only with real conversions in the window AND a CPA at
   * or below the eligible set's median CPA; its weight is
   * its conversion count; its cap is its current live
   * daily total (an allocation never more than doubles a
   * plan). Plans failing any test are listed in `excluded`
   * with the reason and their evidence — weights are never
   * invented for a plan without data. Nothing is applied
   * here; applyBudgetAllocator is the confirmed second
   * step and re-verifies every number. */
  async budgetAllocatorProposal(organizationId: string, dto: { planIds: string[]; totalShiftMinor: string }) {
    const totalShift = (() => { try { return BigInt(dto.totalShiftMinor ?? "0"); } catch { return 0n; } })();
    if (totalShift <= 0n) throw new BadRequestException("মোট অতিরিক্ত বাজেট ধনাত্মক হতে হবে (minor units)");
    const planIds = [...new Set((dto.planIds ?? []).filter(Boolean))].slice(0, 50);
    if (!planIds.length) throw new BadRequestException("অন্তত একটি Plan বেছে নিন");
    const windowDays = CampaignsService.ALLOCATOR_WINDOW_DAYS;
    const since = new Date(Date.now() - windowDays * 86400000);
    const excluded: any[] = [];
    const eligible: any[] = [];
    for (const planId of planIds) {
      const plan = await (this.prisma as any).campaignPlan.findFirst({ where: { id: planId, organizationId } }).catch(() => null);
      if (!plan) { excluded.push({ planId, name: null, reason: "plan_not_found" }); continue; }
      if (plan.status !== "published" || !plan.externalCampaignId) { excluded.push({ planId, name: plan.name, reason: "not_published" }); continue; }
      const full = await this.getPlanFull(organizationId, planId);
      if (this.isCbo(full)) { excluded.push({ planId, name: plan.name, reason: "cbo_no_live_budget_path" }); continue; }
      const dailyTotal = this.planLiveDailyTotal(full);
      if (dailyTotal <= 0n) { excluded.push({ planId, name: plan.name, reason: "no_daily_budget" }); continue; }
      // Plan-level evidence from campaign-level metric
      // rows ONLY (both external ids empty — the planPacing
      // / rules-engine counting rule, so ad-set rows never
      // double the same spend). planPerformance is still
      // used for the per-set target choice below.
      const metricRows = await (this.prisma as any).dailyAdMetric.findMany({
        where: { organizationId, campaignExternalId: plan.externalCampaignId, date: { gte: since } }, take: 10000,
      }).catch(() => []);
      let spend = 0n; let conversions = 0;
      for (const r of metricRows as any[]) {
        if ((r.adSetExternalId ?? "") !== "" || (r.adExternalId ?? "") !== "") continue;
        spend += BigInt(r.spendMinor ?? 0);
        conversions += Number(r.platformConversions ?? r.conversions ?? 0);
      }
      const perf = await this.planPerformance(organizationId, planId, { since });
      const evidence = { spendMinor: spend.toString(), conversions, cpaMinor: conversions > 0 ? (spend / BigInt(conversions)).toString() : null, windowDays };
      if (spend <= 0n || conversions <= 0) { excluded.push({ planId, name: plan.name, reason: "no_evidence", evidence }); continue; }
      eligible.push({ planId, name: plan.name, full, perf, dailyTotal, evidence, cpa: spend / BigInt(conversions), weight: conversions });
    }
    // Efficiency gate: at or below the eligible set's
    // median CPA (lower-middle element for even counts).
    if (eligible.length) {
      const sorted = [...eligible].sort((a, b) => Number(a.cpa - b.cpa));
      const median = sorted[Math.floor((sorted.length - 1) / 2)].cpa;
      for (let i = eligible.length - 1; i >= 0; i--) {
        if (eligible[i].cpa > median) {
          excluded.push({ planId: eligible[i].planId, name: eligible[i].name, reason: "below_efficiency", evidence: eligible[i].evidence, medianCpaMinor: median.toString() });
          eligible.splice(i, 1);
        }
      }
    }
    // Water-filling: proportional to conversion weight,
    // capped per plan at its current daily total; capped
    // plans leave the pool and the remainder redistributes.
    // A final dust pass gives any floor-division remainder
    // to the heaviest plans with room, so the only
    // unallocated money is what caps genuinely refuse.
    const allocations = new Map<string, bigint>(eligible.map((e) => [e.planId, 0n]));
    let remaining = totalShift;
    const active = new Set(eligible.map((e) => e.planId));
    const byId = new Map(eligible.map((e) => [e.planId, e]));
    while (remaining > 0n && active.size > 0) {
      const totalWeight = [...active].reduce((acc, id) => acc + byId.get(id).weight, 0);
      if (totalWeight <= 0) break;
      // Shares are computed against the pass-START remainder
      // and weight total — mutating `remaining` mid-pass
      // would skew every later plan's share.
      const passRemaining = remaining;
      let progressed = false;
      for (const id of [...active]) {
        const e = byId.get(id);
        const share = (passRemaining * BigInt(e.weight)) / BigInt(totalWeight);
        const room = e.dailyTotal - allocations.get(id)!;
        const give = share < room ? share : room;
        if (give > 0n) { allocations.set(id, allocations.get(id)! + give); remaining -= give; progressed = true; }
        if (allocations.get(id)! >= e.dailyTotal) active.delete(id);
      }
      if (!progressed) break;
    }
    if (remaining > 0n && active.size > 0) {
      for (const e of [...active].map((id) => byId.get(id)).sort((a, b) => b.weight - a.weight)) {
        if (remaining <= 0n) break;
        const room = e.dailyTotal - allocations.get(e.planId)!;
        const give = remaining < room ? remaining : room;
        if (give > 0n) { allocations.set(e.planId, allocations.get(e.planId)! + give); remaining -= give; }
      }
    }
    const out = eligible
      .filter((e) => allocations.get(e.planId)! > 0n)
      .map((e) => {
        const target = this.allocatorTargetSet(e.full, e.perf);
        return {
          planId: e.planId, name: e.name,
          amountMinor: allocations.get(e.planId)!.toString(),
          currentDailyTotalMinor: e.dailyTotal.toString(),
          newDailyTotalMinor: (e.dailyTotal + allocations.get(e.planId)!).toString(),
          targetAdSetId: target?.adSet.id ?? null, targetAdSetName: target?.adSet.name ?? null, targetBasis: target?.basis ?? null,
          evidence: e.evidence,
        };
      });
    // Eligible plans the caps squeezed to zero are reported,
    // not silently dropped.
    for (const e of eligible) {
      if (allocations.get(e.planId)! <= 0n) excluded.push({ planId: e.planId, name: e.name, reason: "cap_reached_by_others", evidence: e.evidence });
    }
    const allocated = out.reduce((acc, a) => acc + BigInt(a.amountMinor), 0n);
    return {
      label: "proposal_only",
      note: "এটি শুধু প্রস্তাব — প্রয়োগ হয়নি। হিসাব: গত ৩০ দিনের আসল Spend/Conversion থেকে CPA; Median CPA-র বেশি CPA-ওয়ালা Plan বাদ; ওজন = Conversion সংখ্যা; Plan প্রতি সর্বোচ্চ = তার বর্তমান দৈনিক মোট বাজেট।",
      windowDays, totalShiftMinor: totalShift.toString(),
      allocatedMinor: allocated.toString(), unallocatedMinor: (totalShift - allocated).toString(),
      allocations: out, excluded,
    };
  }

  /** CA11: apply a CONFIRMED allocator proposal. Each
   * plan's shift is its own approved change: the plan's
   * current daily total must still equal the proposal's
   * (staleness is a per-plan refusal with the fresh total,
   * never a silent apply), the per-plan cap is re-checked,
   * the increase lands on the plan's target ad set through
   * updateAdSetBudget (Meta-confirmed), is re-read for
   * verification, and is audited per plan. Per-plan
   * results: one plan failing never fails or hides the
   * others. */
  async applyBudgetAllocator(organizationId: string, actorId: string, dto: {
    allocations: { planId: string; amountMinor: string; expectedDailyTotalMinor: string }[];
  }) {
    const items = (dto.allocations ?? []).filter((a) => a?.planId).slice(0, 50);
    if (!items.length) throw new BadRequestException("প্রয়োগের জন্য অন্তত একটি Allocation পাঠাতে হবে");
    const results: any[] = [];
    for (const item of items) {
      const planId = item.planId;
      try {
        const amount = BigInt(item.amountMinor ?? "0");
        if (amount <= 0n) { results.push({ planId, ok: false, error: "zero_amount" }); continue; }
        const plan = await this.getPlanOrThrow(organizationId, planId);
        if (plan.status !== "published" || !plan.externalCampaignId) { results.push({ planId, ok: false, error: "not_published" }); continue; }
        const full = await this.getPlanFull(organizationId, planId);
        if (this.isCbo(full)) { results.push({ planId, ok: false, error: "cbo_no_live_budget_path" }); continue; }
        const currentTotal = this.planLiveDailyTotal(full);
        if (currentTotal.toString() !== String(item.expectedDailyTotalMinor)) {
          results.push({ planId, ok: false, error: "stale_daily_total", currentDailyTotalMinor: currentTotal.toString() });
          continue;
        }
        if (amount > currentTotal) { results.push({ planId, ok: false, error: "exceeds_cap", currentDailyTotalMinor: currentTotal.toString() }); continue; }
        const perf = await this.planPerformance(organizationId, planId, { since: new Date(Date.now() - CampaignsService.ALLOCATOR_WINDOW_DAYS * 86400000) });
        const target = this.allocatorTargetSet(full, perf);
        if (!target) { results.push({ planId, ok: false, error: "no_daily_budget" }); continue; }
        const beforeMinor = BigInt(target.adSet.dailyBudgetMinor);
        const afterMinor = beforeMinor + amount;
        await this.updateAdSetBudget(organizationId, actorId, planId, target.adSet.id, { dailyBudget: CampaignsService.minorToMajorString(afterMinor) });
        const afterFull = await this.getPlanFull(organizationId, planId);
        const setAfter = (afterFull.adSets ?? []).find((s: any) => s.id === target.adSet.id);
        const verified = setAfter?.dailyBudgetMinor != null && BigInt(setAfter.dailyBudgetMinor) === afterMinor;
        await this.audit.log({ organizationId, userId: actorId, action: "campaign.budget_allocator_applied", entityType: "CampaignPlan", entityId: planId, metadata: { amountMinor: amount.toString(), targetAdSetId: target.adSet.id, targetBasis: target.basis, beforeDailyMinor: beforeMinor.toString(), afterDailyMinor: afterMinor.toString(), verified } });
        results.push({ planId, ok: true, targetAdSetId: target.adSet.id, targetBasis: target.basis, beforeDailyMinor: beforeMinor.toString(), afterDailyMinor: afterMinor.toString(), verified });
      } catch (e) {
        results.push({ planId, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return {
      results,
      appliedCount: results.filter((r) => r.ok).length,
      failedCount: results.filter((r) => !r.ok).length,
    };
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
  /** CA27: a trait VALUE is emitted only when at least
   * this many winning ads share it — below that, a
   * "pattern" would be an anecdote dressed as data. */
  static readonly WINNER_TRAIT_MIN_SAMPLE = 3;
  /** CA27: a non-A/B ad counts as a proven performer
   * only with real conversions on top of the CA25 bars. */
  static readonly WINNER_PROVEN_MIN_CONVERSIONS = 5;

  /** CA27: deterministic creative-trait facts of the
   * org's WINNING ads, computed from real rows only:
   * winners are (1) the ads of plans an A/B verdict
   * named winner (abTestResults — winnerPlanId only,
   * verdict-gated), and (2) proven performers: ads whose
   * ad-level DailyAdMetric rows clear the CA25 evidence
   * bars (>= 1,000 impressions, >= ৳100 spend) with
   * >= 5 conversions. Traits: format, aspect bucket
   * (from the creative's stored width/height), primary-
   * text length bucket, CTA. Text-overlay is NOT
   * computed: CA5's vision check runs at generation time
   * and stores no per-asset result, so the payload says
   * exactly that instead of guessing. A trait value with
   * fewer than WINNER_TRAIT_MIN_SAMPLE winners is
   * suppressed (counted in `suppressed`, never emitted). */
  async winnerTraits(organizationId: string) {
    const winners = new Map<string, { ad: any; sources: string[] }>();
    const addWinner = (ad: any, source: string) => {
      if (!ad?.id) return;
      const cur = winners.get(ad.id) ?? { ad, sources: [] };
      if (!cur.sources.includes(source)) cur.sources.push(source);
      winners.set(ad.id, cur);
    };
    // (1) A/B verdict winners.
    try {
      const groups = await this.abTestResults(organizationId);
      for (const g of groups as any[]) {
        if (!g.winnerPlanId) continue;
        const full = await this.getPlanFull(organizationId, g.winnerPlanId).catch(() => null);
        for (const s of full?.adSets ?? []) for (const ad of s.ads ?? []) addWinner(ad, "ab_verdict");
      }
    } catch { /* no A/B data — the performer path still applies */ }
    // (2) Proven performers from ad-level metric rows.
    try {
      const plans = await this.prisma.campaignPlan.findMany({ where: { organizationId }, select: { id: true } });
      const adSets = plans.length
        ? await this.prisma.campaignAdSet.findMany({ where: { planId: { in: plans.map((p: any) => p.id) } }, select: { id: true } })
        : [];
      const ads = adSets.length
        ? await (this.prisma as any).campaignAd.findMany({ where: { adSetId: { in: adSets.map((s: any) => s.id) } } })
        : [];
      const byExt = new Map<string, any>();
      for (const ad of ads as any[]) if (ad.externalAdId) byExt.set(ad.externalAdId, ad);
      const extIds = [...byExt.keys()];
      const rows = extIds.length
        ? await (this.prisma as any).dailyAdMetric.findMany({ where: { organizationId, level: "ad", adExternalId: { in: extIds } }, select: { adExternalId: true, impressions: true, spendMinor: true, conversions: true } }).catch(() => [])
        : [];
      const totals = new Map<string, { impressions: number; spendMinor: number; conversions: number }>();
      for (const r of rows as any[]) {
        const cur = totals.get(r.adExternalId) ?? { impressions: 0, spendMinor: 0, conversions: 0 };
        cur.impressions += Number(r.impressions ?? 0); cur.spendMinor += Number(r.spendMinor ?? 0); cur.conversions += Number(r.conversions ?? 0);
        totals.set(r.adExternalId, cur);
      }
      for (const [ext, t] of totals) {
        if (t.impressions >= CampaignsService.ASSET_PERF_MIN_IMPRESSIONS && t.spendMinor >= CampaignsService.ASSET_PERF_MIN_SPEND_MINOR && t.conversions >= CampaignsService.WINNER_PROVEN_MIN_CONVERSIONS) {
          addWinner(byExt.get(ext), "proven_performer");
        }
      }
    } catch { /* metric path unavailable — verdict path stands */ }

    // Aspect buckets need the creative rows' dimensions.
    const assetIds = [...new Set([...winners.values()].map((w) => w.ad.imageAssetId ?? w.ad.videoAssetId).filter(Boolean))] as string[];
    const assetRows = assetIds.length && (this.prisma as any).creativeAsset?.findMany
      ? await (this.prisma as any).creativeAsset.findMany({ where: { id: { in: assetIds } }, select: { id: true, width: true, height: true } }).catch(() => [])
      : [];
    const dims = new Map<string, { width: number; height: number }>();
    for (const r of assetRows as any[]) if (r.width && r.height) dims.set(r.id, { width: r.width, height: r.height });

    const counts = new Map<string, { trait: string; value: string; count: number }>();
    const bump = (trait: string, value: string | null) => {
      if (!value) return;
      const key = `${trait}:${value}`;
      const cur = counts.get(key) ?? { trait, value, count: 0 };
      cur.count++;
      counts.set(key, cur);
    };
    for (const { ad } of winners.values()) {
      bump("format", ad.format ?? "link");
      const assetId = ad.imageAssetId ?? ad.videoAssetId;
      const d = assetId ? dims.get(assetId) : undefined;
      if (d) {
        const r = d.width / d.height;
        bump("aspect", r >= 0.95 && r <= 1.05 ? "বর্গাকার (1:1)" : r < 0.95 ? "উল্লম্ব (4:5 / 9:16)" : "অনুভূমিক (16:9 ধরনের)");
      }
      const len = String(ad.primaryText ?? "").length;
      bump("textLength", len < 60 ? "ছোট লেখা (< 60 অক্ষর)" : len <= 150 ? "মাঝারি লেখা (60–150 অক্ষর)" : "বড় লেখা (> 150 অক্ষর)");
      bump("cta", ad.callToAction ?? null);
    }
    const all = [...counts.values()];
    const emitted = all.filter((t) => t.count >= CampaignsService.WINNER_TRAIT_MIN_SAMPLE)
      .sort((a, b) => a.trait.localeCompare(b.trait) || b.count - a.count);
    const suppressed = all.filter((t) => t.count < CampaignsService.WINNER_TRAIT_MIN_SAMPLE);
    const byTrait = new Map<string, { value: string; count: number }[]>();
    for (const t of emitted) {
      const arr = byTrait.get(t.trait) ?? [];
      arr.push({ value: t.value, count: t.count });
      byTrait.set(t.trait, arr);
    }
    const label: Record<string, string> = { format: "ফরম্যাট", aspect: "অনুপাত", textLength: "লেখার দৈর্ঘ্য", cta: "CTA" };
    const factsBn = emitted.length
      ? `আগের বিজয়ী বিজ্ঞাপনগুলোর বৈশিষ্ট্য (আসল ডেটা — ${winners.size}টি বিজয়ী Ad থেকে): ` +
        [...byTrait.entries()].map(([trait, vals]) => `${label[trait] ?? trait}: ${vals.map((v) => `${v.value} (${v.count}টি)`).join(", ")}`).join(" · ")
      : "";
    return {
      winnersConsidered: winners.size,
      sources: {
        abVerdict: [...winners.values()].filter((w) => w.sources.includes("ab_verdict")).length,
        provenPerformer: [...winners.values()].filter((w) => w.sources.includes("proven_performer")).length,
      },
      minSample: CampaignsService.WINNER_TRAIT_MIN_SAMPLE,
      traits: emitted,
      suppressed: suppressed.map((t) => ({ trait: t.trait, value: t.value, count: t.count, reason: `ন্যূনতম নমুনা ${CampaignsService.WINNER_TRAIT_MIN_SAMPLE}-এর নিচে — প্যাটার্ন বলা যায় না` })),
      factsBn,
      excluded: ["টেক্সট-ওভারলে: CA5 Vision যাচাই Generation-এর সময়ের সতর্কতা মাত্র — Asset-এ সংরক্ষিত ফল নেই, তাই এই বৈশিষ্ট্য হিসাব হয়নি (অনুমান করা হয়নি)।"],
      note: "বৈশিষ্ট্যগুলো শুধু আসল A/B Verdict ও Ad-level Metric থেকে — কোনো অনুমান বা AI-এর ধারণা নয়।",
    };
  }

  /** CA25: an asset's badge/rating exists only when BOTH
   * evidence bars are met by REAL ad-level metric rows:
   * at least 1,000 impressions AND at least ৳100 of real
   * spend (minor units) attributed to that asset's ads.
   * Below either bar the asset is "unrated" — the picker
   * shows তথ্য নেই and never ranks it above a rated one. */
  static readonly ASSET_PERF_MIN_IMPRESSIONS = 1000;
  static readonly ASSET_PERF_MIN_SPEND_MINOR = 10000;

  /** CA25: per-asset REAL past performance for the
   * builder's asset picker. Attribution chain, honest by
   * construction: org plans → their ads (imageAssetId /
   * videoAssetId, or imageUrl/videoUrl whose sourceRef is
   * creative:<id> / media:<id>) → each ad's externalAdId →
   * DailyAdMetric rows with level "ad" ONLY. Campaign-
   * and ad-set-level rows are NEVER attributed to a
   * creative (the CA7 honesty rule) — summing them into
   * an asset would fabricate per-creative numbers. */
  async assetPerformance(organizationId: string) {
    const plans = await this.prisma.campaignPlan.findMany({ where: { organizationId }, select: { id: true } });
    const planIds = plans.map((p: any) => p.id);
    const adSets = planIds.length
      ? await this.prisma.campaignAdSet.findMany({ where: { planId: { in: planIds } }, select: { id: true } })
      : [];
    const adSetIds = adSets.map((s: any) => s.id);
    const ads = adSetIds.length
      ? await (this.prisma as any).campaignAd.findMany({
          where: { adSetId: { in: adSetIds } },
          select: { id: true, externalAdId: true, imageAssetId: true, videoAssetId: true, imageUrl: true, videoUrl: true },
        })
      : [];

    // asset key -> the ads that used it
    const keyOf = (ad: any): { key: string; source: "creative" | "media"; assetId: string; kind: "image" | "video" } | null => {
      if (ad.imageAssetId) return { key: `creative:${ad.imageAssetId}`, source: "creative", assetId: ad.imageAssetId, kind: "image" };
      if (ad.videoAssetId) return { key: `creative:${ad.videoAssetId}`, source: "creative", assetId: ad.videoAssetId, kind: "video" };
      const ref = (url: string | null | undefined) => {
        const m = /^(creative|media):([0-9a-fA-F-]{36})$/.exec(String(url ?? ""));
        return m ? { src: m[1] as "creative" | "media", id: m[2] } : null;
      };
      const ri = ref(ad.imageUrl); if (ri) return { key: `${ri.src}:${ri.id}`, source: ri.src, assetId: ri.id, kind: "image" };
      const rv = ref(ad.videoUrl); if (rv) return { key: `${rv.src}:${rv.id}`, source: rv.src, assetId: rv.id, kind: "video" };
      return null;
    };
    const byAsset = new Map<string, { source: "creative" | "media"; assetId: string; kind: "image" | "video"; adIds: string[]; externalIds: string[] }>();
    for (const ad of ads as any[]) {
      const k = keyOf(ad);
      if (!k) continue;
      const cur = byAsset.get(k.key) ?? { source: k.source, assetId: k.assetId, kind: k.kind, adIds: [], externalIds: [] };
      cur.adIds.push(ad.id);
      if (ad.externalAdId) cur.externalIds.push(ad.externalAdId);
      byAsset.set(k.key, cur);
    }

    const extIds = [...new Set((ads as any[]).map((a) => a.externalAdId).filter(Boolean))] as string[];
    const metricRows = extIds.length
      ? await (this.prisma as any).dailyAdMetric.findMany({
          where: { organizationId, level: "ad", adExternalId: { in: extIds } },
          select: { adExternalId: true, impressions: true, clicks: true, spendMinor: true, conversions: true },
        }).catch(() => [])
      : [];
    const byExt = new Map<string, { impressions: number; clicks: number; spendMinor: number; conversions: number }>();
    for (const r of metricRows as any[]) {
      const cur = byExt.get(r.adExternalId) ?? { impressions: 0, clicks: 0, spendMinor: 0, conversions: 0 };
      cur.impressions += Number(r.impressions ?? 0); cur.clicks += Number(r.clicks ?? 0);
      cur.spendMinor += Number(r.spendMinor ?? 0); cur.conversions += Number(r.conversions ?? 0);
      byExt.set(r.adExternalId, cur);
    }

    // Asset display info from the real asset rows.
    const creativeIds = [...byAsset.values()].filter((a) => a.source === "creative").map((a) => a.assetId);
    const mediaIds = [...byAsset.values()].filter((a) => a.source === "media").map((a) => a.assetId);
    const creativeRows = creativeIds.length && (this.prisma as any).creativeAsset?.findMany
      ? await (this.prisma as any).creativeAsset.findMany({ where: { id: { in: creativeIds } }, select: { id: true, name: true, kind: true, createdAt: true } }).catch(() => [])
      : [];
    const mediaRows = mediaIds.length && (this.prisma as any).mediaAsset?.findMany
      ? await (this.prisma as any).mediaAsset.findMany({ where: { id: { in: mediaIds } }, select: { id: true, name: true, kind: true, createdAt: true } }).catch(() => [])
      : [];
    const infoOf = new Map<string, any>();
    for (const r of creativeRows as any[]) infoOf.set(`creative:${r.id}`, r);
    for (const r of mediaRows as any[]) infoOf.set(`media:${r.id}`, r);

    const assets = [...byAsset.entries()].map(([key, a]) => {
      const t = a.externalIds.reduce((acc, ext) => {
        const m = byExt.get(ext);
        if (m) { acc.impressions += m.impressions; acc.clicks += m.clicks; acc.spendMinor += m.spendMinor; acc.conversions += m.conversions; }
        return acc;
      }, { impressions: 0, clicks: 0, spendMinor: 0, conversions: 0 });
      const rated = t.impressions >= CampaignsService.ASSET_PERF_MIN_IMPRESSIONS && t.spendMinor >= CampaignsService.ASSET_PERF_MIN_SPEND_MINOR;
      const info = infoOf.get(key);
      return {
        key, source: a.source, assetId: a.assetId, kind: a.kind,
        name: info?.name ?? null, assetCreatedAt: info?.createdAt ?? null,
        adsUsed: a.adIds.length,
        impressions: t.impressions, clicks: t.clicks, spendMinor: t.spendMinor, conversions: t.conversions,
        rated,
        ctrPct: rated && t.impressions > 0 ? Math.round((t.clicks / t.impressions) * 10000) / 100 : null,
        cpaMinor: rated && t.conversions > 0 ? Math.round(t.spendMinor / t.conversions) : null,
      };
    });
    // Rated first (CTR desc) — the picker's performance
    // sort mirrors this; unrated assets are never above
    // rated ones.
    assets.sort((x, y) => (y.rated ? 1 : 0) - (x.rated ? 1 : 0) || (y.ctrPct ?? -1) - (x.ctrPct ?? -1));

    return {
      thresholds: {
        minImpressions: CampaignsService.ASSET_PERF_MIN_IMPRESSIONS,
        minSpendMinor: CampaignsService.ASSET_PERF_MIN_SPEND_MINOR,
        rule: "Rating পেতে কমপক্ষে 1,000 Impression এবং কমপক্ষে ৳100 আসল খরচ (শুধু Ad-level Metric থেকে) লাগবে",
      },
      assets,
      note: "সংখ্যাগুলো শুধু Ad-level DailyAdMetric থেকে — Campaign/Ad Set-level সারি কোনো Creative-এর নামে ধরা হয়নি (CA7-এর সততার নিয়ম)। Threshold-এর নিচে Asset 'তথ্য নেই' হিসেবে দেখায়।",
    };
  }

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

  /** DX2: the hub "এই সপ্তাহে" (this week) strip aggregate —
   * read-only, no schema. It exists because NONE of its four
   * numbers is reachable from the web in one load: portfolio
   * totals carry no date window (all-time only), CN7
   * recommendations and creative fatigue are per-plan
   * endpoints (an org-wide count would need 2 calls per
   * published plan), and the offline loop's last success is
   * buried in the log list. Everything here is computed from
   * the SAME read-models the rest of the builder uses —
   * DailyAdMetric campaign-level rows (the portfolioTotals
   * filter), planRecommendations, planCreativeInsights and
   * the OfflineConversionLog — never a second definition.
   * Windows are rolling: last 7 days vs the previous 7 days.
   * Currencies are never mixed. The per-plan loops are
   * bounded (25 most recently updated published plans) and
   * the bound is reported, not hidden. */
  async weekSummary(organizationId: string) {
    const p = this.prisma as any;
    const now = new Date();
    const dayMs = 86400000;
    const thisStart = new Date(now.getTime() - 7 * dayMs);
    const prevStart = new Date(now.getTime() - 14 * dayMs);
    const rows = await p.dailyAdMetric.findMany({ where: { organizationId, date: { gte: prevStart } }, take: 20000 }).catch(() => []);
    const accounts = await p.adAccount.findMany({ where: { organizationId } }).catch(() => []);
    const accById = new Map((accounts as any[]).map((a) => [a.id, a]));
    const byCurrency = new Map<string, { thisWeek: bigint; prevWeek: bigint }>();
    for (const r of rows as any[]) {
      if ((r.adSetExternalId ?? "") !== "" || (r.adExternalId ?? "") !== "") continue; // campaign-level only
      const d = new Date(r.date);
      if (d < prevStart || d > now) continue;
      const currency = accById.get(r.adAccountId)?.currency ?? "BDT";
      const g = byCurrency.get(currency) ?? { thisWeek: 0n, prevWeek: 0n };
      if (d >= thisStart) g.thisWeek += BigInt(r.spendMinor ?? 0); else g.prevWeek += BigInt(r.spendMinor ?? 0);
      byCurrency.set(currency, g);
    }
    const plans = await p.campaignPlan.findMany({
      where: { organizationId, externalCampaignId: { not: null } }, orderBy: { updatedAt: "desc" }, take: 100,
    }).catch(() => []);
    const checked = (plans as any[]).slice(0, 25);
    let recommendationTotal = 0;
    let topRecommendation: { planId: string; name: string; count: number } | null = null;
    let fatigueTotal = 0;
    let topFatigue: { planId: string; name: string; count: number } | null = null;
    for (const plan of checked) {
      const rec = await this.planRecommendations(organizationId, plan.id).catch(() => null);
      const n = rec?.recommendations?.length ?? 0;
      recommendationTotal += n;
      if (n > 0 && (!topRecommendation || n > topRecommendation.count)) topRecommendation = { planId: plan.id, name: plan.name, count: n };
      const ins = await this.planCreativeInsights(organizationId, plan.id).catch(() => null);
      const f = (ins?.ads ?? []).filter((a: any) => a.fatigued).length;
      fatigueTotal += f;
      if (f > 0 && (!topFatigue || f > topFatigue.count)) topFatigue = { planId: plan.id, name: plan.name, count: f };
    }
    const settings = p.offlineConversionSetting?.findMany
      ? await p.offlineConversionSetting.findMany({ where: { organizationId } }).catch(() => [])
      : [];
    const configured = (settings as any[]).some((s) => s.enabled);
    const logs = p.offlineConversionLog?.findMany
      ? await p.offlineConversionLog.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 200 }).catch(() => [])
      : [];
    const lastSuccess = (logs as any[]).find((l) => l.status === "sent");
    const failedLast7Days = (logs as any[]).filter((l) => l.status === "failed" && new Date(l.createdAt) >= thisStart).length;
    return {
      label: "last_7_days_vs_previous_7_days_from_synced_rows",
      windowDays: 7,
      spendByCurrency: [...byCurrency.entries()].map(([currency, g]) => ({
        currency, thisWeekMinor: g.thisWeek.toString(), prevWeekMinor: g.prevWeek.toString(),
      })),
      recommendations: { total: recommendationTotal, plansChecked: checked.length, publishedPlans: (plans as any[]).length, topPlan: topRecommendation },
      fatigue: { total: fatigueTotal, topPlan: topFatigue },
      offlineLoop: {
        configured,
        lastSuccessAt: lastSuccess ? new Date(lastSuccess.createdAt).toISOString() : null,
        lastSuccessPlatform: lastSuccess?.platform ?? null,
        failedLast7Days,
      },
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

  /** CA3: assemble a Google Search RSA from the plan's ads.
   * Sources, in order — headlines: plan name, then per ad its
   * CN5 textOptions headlines → legacy headline → ad name;
   * descriptions: per ad its textOptions descriptions →
   * textOptions primaryTexts → legacy description → legacy
   * primaryText (deduped). Google's limits are hard (15
   * headlines ≤30 chars, 4 descriptions ≤90 chars): an
   * option over its length limit, and anything past the cap,
   * is listed in notCarried with the reason — text is NEVER
   * truncated silently and overflow is never dropped without
   * a record (the pre-CA3 assembly sliced strings to the
   * limit and capped the arrays silently). RSA pinning is
   * not sent: CN5 text options have no pin model, and the
   * mapping note on the draft says so. */
  private assembleGoogleRsa(ads: any[], planName: string): { headlines: string[]; descriptions: string[]; notCarried: string[] } {
    const headlinePool: string[] = [];
    const descPool: string[] = [];
    const push = (pool: string[], v: any) => { const t = String(v ?? "").trim(); if (t && !pool.includes(t)) pool.push(t); };
    push(headlinePool, planName);
    for (const ad of ads) {
      const opts = this.textOptionsOf(ad);
      for (const h of opts?.headlines ?? []) push(headlinePool, h);
      push(headlinePool, ad.headline);
      push(headlinePool, ad.name);
      for (const d of opts?.descriptions ?? []) push(descPool, d);
      for (const p of opts?.primaryTexts ?? []) push(descPool, p);
      push(descPool, ad.description);
      push(descPool, ad.primaryText);
    }
    const notCarried: string[] = [];
    const take = (pool: string[], maxLen: number, cap: number, label: string) => {
      const ok: string[] = [];
      for (const t of pool) {
        if (t.length > maxLen) { notCarried.push(`${label} "${t.slice(0, 40)}…" — ${t.length} অক্ষর, Google-এর সীমা ${maxLen}; কেটে পাঠানো হয়নি`); continue; }
        if (ok.length >= cap) { notCarried.push(`${label} "${t.slice(0, 40)}…" — RSA-তে সর্বোচ্চ ${cap}টি যায়, এটি অতিরিক্ত`); continue; }
        ok.push(t);
      }
      return ok;
    };
    return {
      headlines: take(headlinePool, 30, 15, "Headline"),
      descriptions: take(descPool, 90, 4, "Description"),
      notCarried,
    };
  }

  /** CA15 (CB4): resolve the audiences a plan references
   * into the verbatim signal records a PMax draft
   * carries. Names come only from real rows
   * (SavedAudience / AudienceRecord); an id whose row is
   * gone is carried WITHOUT a name — never invented. */
  private async resolveAudienceSignals(organizationId: string, savedIds: string[], customIds: string[], excludedIds: string[]): Promise<any[]> {
    const out: any[] = [];
    const p = this.prisma as any;
    for (const id of savedIds) {
      const row = p.savedAudience?.findFirst ? await p.savedAudience.findFirst({ where: { id, organizationId } }).catch(() => null) : null;
      out.push({ source: "saved_audience", savedAudienceId: id, name: row?.name ?? null });
    }
    const byExternal = async (externalId: string, excluded: boolean) => {
      const row = p.audienceRecord?.findFirst ? await p.audienceRecord.findFirst({ where: { externalAudienceId: externalId, organizationId } }).catch(() => null) : null;
      out.push({ source: excluded ? "excluded_custom_audience" : "custom_audience", externalAudienceId: externalId, name: row?.name ?? null, kind: row?.kind ?? null, recordId: row?.id ?? null, excluded });
    };
    for (const id of customIds) await byExternal(id, false);
    for (const id of excludedIds) await byExternal(id, true);
    return out;
  }

  /** CA15: the fan-out draft name — the org's CA13
   * naming template rendered for the TARGET platform
   * when one is set (token values from the plan tree's
   * own records, via namingItemsForPlan); otherwise the
   * plan's name, exactly as the single-draft path uses.
   * A blank render falls back to the plan name. */
  private async fanoutDraftName(organizationId: string, full: any, platformLabel: string): Promise<string> {
    const template = await this.namingTemplate(organizationId);
    if (!template) return full.name;
    const items = await this.namingItemsForPlan(organizationId, full);
    const planItem = items.find((i: any) => i.level === "plan");
    const rendered = renderNamingTemplate(template, { ...(planItem?.values ?? { objective: full.objective }), platform: platformLabel });
    return rendered || full.name;
  }

  /** CA15: one-click fan-out PREVIEW — the Google +
   * TikTok mappings for the chosen target accounts,
   * computed and returned WITH their gaps (unmapped /
   * notCarried / transformations) BEFORE anything is
   * created. The preview persists no draft and makes no
   * platform call: it rides crossPlatformDraft's dry-run
   * path. A per-platform failure (bad account, access)
   * is reported on that platform's block only. */
  async fanoutPreview(organizationId: string, planId: string, actorId: string, dto: { googleAccountId?: string; googleKind?: string; tiktokAccountId?: string; tiktokObjectiveType?: string; tiktokPixelId?: string; tiktokOptimizationEvent?: string }) {
    if (!dto.googleAccountId && !dto.tiktokAccountId) throw new BadRequestException("অন্তত একটি Target Account দিন (Google বা TikTok)");
    const plan = await this.getPlanOrThrow(organizationId, planId);
    if (!["approved", "published", "publish_failed"].includes(plan.status)) {
      throw new BadRequestException(`Fan-out-এর জন্য Approved Plan দরকার (বর্তমান: ${plan.status})`);
    }
    const full = await this.getPlanFull(organizationId, planId);
    const platforms: any[] = [];
    if (dto.googleAccountId) {
      const nameOverride = await this.fanoutDraftName(organizationId, full, "Google");
      platforms.push(await this.fanoutAttempt("google", () => this.crossPlatformDraft(organizationId, planId, actorId, { platform: "google", targetAdAccountId: dto.googleAccountId!, kind: dto.googleKind, nameOverride, dryRun: true } as any)));
    }
    if (dto.tiktokAccountId) {
      const nameOverride = await this.fanoutDraftName(organizationId, full, "TikTok");
      platforms.push(await this.fanoutAttempt("tiktok", () => this.crossPlatformDraft(organizationId, planId, actorId, { platform: "tiktok", targetAdAccountId: dto.tiktokAccountId!, objectiveType: dto.tiktokObjectiveType, pixelId: dto.tiktokPixelId, optimizationEvent: dto.tiktokOptimizationEvent, nameOverride, dryRun: true } as any)));
    }
    return {
      planId, platforms,
      note: "এটি শুধু Preview — কোনো Draft তৈরি হয়নি, কোনো Platform Call হয়নি। Confirm করলেই দুই Platform-এ PAUSED Draft তৈরি হবে; যা Map হয়নি তা প্রতিটি Block-এ তালিকাভুক্ত আছে।",
    };
  }

  /** CA15: one-click fan-out CREATE — runs only on the
   * user's confirmation of the preview. Every platform
   * is re-mapped server-side at confirm time through
   * the existing single-draft path (never trusting
   * client-supplied fields): a platform whose mapping
   * has gaps comes back blocked with its stored export
   * draft, exactly as the single path behaves, and one
   * platform's failure never masks the other's result.
   * Drafts link back to this plan via the draft row's
   * planId (the CN9 column). The daily budget is COPIED
   * in BDT as-is — labelled in each block's budget
   * object; no currency conversion exists or is claimed. */
  async fanoutCreate(organizationId: string, planId: string, actorId: string, dto: { googleAccountId?: string; googleKind?: string; tiktokAccountId?: string; tiktokObjectiveType?: string; tiktokPixelId?: string; tiktokOptimizationEvent?: string }) {
    if (!dto.googleAccountId && !dto.tiktokAccountId) throw new BadRequestException("অন্তত একটি Target Account দিন (Google বা TikTok)");
    const plan = await this.getPlanOrThrow(organizationId, planId);
    if (!["approved", "published", "publish_failed"].includes(plan.status)) {
      throw new BadRequestException(`Fan-out-এর জন্য Approved Plan দরকার (বর্তমান: ${plan.status})`);
    }
    const full = await this.getPlanFull(organizationId, planId);
    const platforms: any[] = [];
    if (dto.googleAccountId) {
      const nameOverride = await this.fanoutDraftName(organizationId, full, "Google");
      platforms.push(await this.fanoutAttempt("google", () => this.crossPlatformDraft(organizationId, planId, actorId, { platform: "google", targetAdAccountId: dto.googleAccountId!, kind: dto.googleKind, nameOverride } as any)));
    }
    if (dto.tiktokAccountId) {
      const nameOverride = await this.fanoutDraftName(organizationId, full, "TikTok");
      platforms.push(await this.fanoutAttempt("tiktok", () => this.crossPlatformDraft(organizationId, planId, actorId, { platform: "tiktok", targetAdAccountId: dto.tiktokAccountId!, objectiveType: dto.tiktokObjectiveType, pixelId: dto.tiktokPixelId, optimizationEvent: dto.tiktokOptimizationEvent, nameOverride } as any)));
    }
    const created = platforms.filter((b) => b.status === "created").length;
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.fanout", entityType: "CampaignPlan", entityId: planId, metadata: { platforms: platforms.map((b) => ({ platform: b.platform, status: b.status, draftId: b.draftId ?? null })), created } }).catch(() => undefined);
    return { planId, platforms, created, total: platforms.length };
  }

  private async fanoutAttempt(platform: string, call: () => Promise<any>): Promise<any> {
    try {
      const r = await call();
      return { platform, ...r };
    } catch (e) {
      return { platform, status: "error", error: e instanceof Error ? e.message : "Fan-out ব্যর্থ হয়েছে" };
    }
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

    // CA15 (CB4): gap accounting shared by every cross-
    // platform shape — plan concepts NONE of these shapes
    // can carry are listed per platform (never silently
    // dropped, never approximated into a fake mapping).
    // Audience signals resolve from REAL rows only:
    // SavedAudience by the ad sets' savedAudienceId,
    // AudienceRecord by the external ids that
    // customAudienceIds / excludedAudienceIds hold (those
    // fields store Meta external ids — see
    // attachAudienceId). Age/gender counts as a gap only
    // when it RESTRICTS beyond the builder defaults
    // (18–65, all genders) — the default itself is broad
    // targeting, not a lost restriction.
    const savedAudienceIds: string[] = [...new Set<string>((full.adSets ?? []).map((s: any) => (s.targeting as any)?.savedAudienceId).filter(Boolean).map(String))];
    const planCustomAudienceIds: string[] = [...new Set<string>((full.adSets ?? []).flatMap((s: any) => (((s.targeting as any)?.customAudienceIds ?? []) as string[])).map(String))];
    const planExcludedAudienceIds: string[] = [...new Set<string>((full.adSets ?? []).flatMap((s: any) => (((s.targeting as any)?.excludedAudienceIds ?? []) as string[])).map(String))];
    const audienceSignals = await this.resolveAudienceSignals(organizationId, savedAudienceIds, planCustomAudienceIds, planExcludedAudienceIds);
    const restrictsAgeGender = (full.adSets ?? []).some((s: any) => {
      const t = s.targeting ?? {};
      const g = (t.genders ?? []) as number[];
      return (typeof t.ageMin === "number" && t.ageMin > 18) || (typeof t.ageMax === "number" && t.ageMax < 65) || (g.length > 0 && !g.includes(0));
    });
    const hasLeadFormSet = (full.adSets ?? []).some((s: any) => s.leadFormId);
    const hasCatalogSet = (full.adSets ?? []).some((s: any) => s.catalogRecordId || s.productSetId);
    const distinctLinkUrls = [...new Set(allAds.map((a: any) => a.linkUrl).filter(Boolean))] as string[];
    const sharedGaps = (platformLabel: string): string[] => {
      const gaps: string[] = [];
      if (restrictsAgeGender) gaps.push(`বয়স/লিঙ্গ সীমাবদ্ধতা ${platformLabel}-এর এই Flow-তে যায় না — শুধু দেশ ও Interest Map হয়`);
      if (hasLeadFormSet) gaps.push(`Lead Form ${platformLabel}-এ যায় না — Cross-Platform Draft Website Creative তৈরি করে, Form বাঁধে না`);
      if (hasCatalogSet) gaps.push(`Catalog/Product Set ${platformLabel}-এর এই Draft-এ যায় না — Catalog Campaign আলাদা Flow`);
      if (distinctLinkUrls.length > 1) gaps.push(`সব Ad-এর Landing URL এক নয় (${distinctLinkUrls.length}টি আলাদা) — শুধু প্রথম Ad-এর URL গেছে, বাকিগুলো এই Draft-এ যায়নি`);
      return gaps;
    };
    // CA15: a fan-out caller may pass the CA13-templated
    // name (rendered server-side by the fan-out methods);
    // the single-draft path never does, so its names stay
    // byte-identical to before.
    const draftName = (dto as any).nameOverride && String((dto as any).nameOverride).trim() ? String((dto as any).nameOverride) : plan.name;
    if (draftName !== plan.name) transformations.push(`নাম CA13 Naming Template দিয়ে তৈরি হয়েছে (Plan-এর নাম "${plan.name}" নয়)`);

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
      // CA15 (CB4): the plan's saved/custom audiences are
      // no longer dropped here — they are carried VERBATIM
      // into the draft fields as audienceSignals (resolved
      // from real rows by resolveAudienceSignals). They are
      // still NOT sent to Google at publish: a Meta
      // audience has no Google user-list counterpart in
      // this account, and inventing one would be a fake
      // mapping. The publish path ignores the field; the
      // draft keeps the signal for the human to act on.
      if (audienceSignals.length) transformations.push(`Saved Audience Signal (${audienceSignals.length}টি) Draft-এ সংরক্ষিত হয়েছে (audienceSignals) — Google-এ পাঠানো হয়নি: Meta Audience-এর Google User List এই অ্যাকাউন্টে নেই`);
      notCarried.push(...sharedGaps("Google Performance Max"));
      mapped = {
        adAccountId: dto.targetAdAccountId, name: draftName, dailyBudget: dailyTaka, countryCodes: countries,
        finalUrl: firstUrl, businessName, logoUrl: logoUrl || undefined,
        headlines, longHeadlines, descriptions, imageUrls,
        ...(audienceSignals.length ? { audienceSignals } : {}),
      };
    } else if (dto.platform === "google") {
      // CA3: RSA arrays come from the ads' CN5 text options
      // (merged with the legacy fields) via assembleGoogleRsa
      // — over-limit options and cap overflow land in
      // notCarried, never silently truncated or dropped.
      const rsa = this.assembleGoogleRsa(allAds, plan.name);
      const headlines = rsa.headlines;
      const descriptions = rsa.descriptions;
      notCarried.push(...rsa.notCarried);
      transformations.push("Google RSA: CN5 Text Options + Legacy Field থেকে Headline/Description সাজানো হয়েছে; Pinning পাঠানো হয়নি (CN5-এ Pin Model নেই)");
      if (headlines.length < 3) unmapped.push(`Google RSA এর জন্য অন্তত ৩টি Headline দরকার — পাওয়া গেছে ${headlines.length}টি (Text Options/Headline/নাম থেকে)`);
      if (descriptions.length < 2) unmapped.push(`Google RSA এর জন্য অন্তত ২টি Description দরকার — পাওয়া গেছে ${descriptions.length}টি`);
      if (!interests.length) unmapped.push("Google Keyword আবশ্যক — কোনো Ad Set এ Interest নেই (Interest গুলোই Keyword হিসেবে যায়)");
      // CA15: Search RSA carries no audience, no video —
      // listed, never silently dropped.
      if (audienceSignals.length) notCarried.push(`Audience Signal (${audienceSignals.length}টি Saved/Custom Audience) Google Search Draft-এ যায় না — এই Flow-তে Search-এর Audience Mapping নেই`);
      if (allAds.some((a: any) => (a.format ?? "link") === "video" || a.videoAssetId)) notCarried.push("ভিডিও Creative Google Search RSA-তে যায় না — RSA শুধু Text Ad");
      notCarried.push(...sharedGaps("Google Search"));
      mapped = {
        adAccountId: dto.targetAdAccountId, name: draftName, dailyBudget: dailyTaka, countryCodes: countries,
        headlines, descriptions, finalUrl: firstUrl,
        keywords: interests.map((text) => ({ text })),
      };
    } else {
      const firstAd = allAds[0];
      const adText = firstAd?.primaryText ? String(firstAd.primaryText).slice(0, 100) : "";
      if (firstAd?.primaryText && firstAd.primaryText.length > 100) transformations.push("Ad Text 100 অক্ষরে কাটা হয়েছে");
      const imageUrl = allAds.find((a: any) => a.imageUrl)?.imageUrl;
      // CA15: a video creative CAN ride TikTok (publish
      // accepts videoUrl) — resolve the library asset's
      // own source URL; an asset whose URL cannot be
      // resolved is listed, never silently dropped.
      let videoUrl: string | undefined;
      const videoAd = allAds.find((a: any) => a.videoAssetId || (a.format ?? "link") === "video");
      if (videoAd?.videoAssetId && (this.prisma as any).creativeAsset?.findFirst) {
        const asset = await (this.prisma as any).creativeAsset.findFirst({ where: { id: String(videoAd.videoAssetId), organizationId } }).catch(() => null);
        if (asset && typeof asset.sourceUrl === "string" && asset.sourceUrl.startsWith("http")) videoUrl = asset.sourceUrl;
      }
      if (videoAd && !videoUrl) notCarried.push("ভিডিও Creative-এর URL Library Asset থেকে পাওয়া যায়নি — TikTok Draft-এ ভিডিও যায়নি");
      if (videoUrl) transformations.push("ভিডিও Creative Library Asset-এর Source URL দিয়ে TikTok-এ পাঠানো হয়েছে");
      if (!imageUrl && !videoUrl) unmapped.push("TikTok এর জন্য ছবি/ভিডিওর URL দরকার — কোনো Ad এ সরাসরি ছবির URL নেই (লাইব্রেরি Asset এর ID URL নয়)");
      if (!adText) unmapped.push("কোনো Ad Text নেই");
      if (audienceSignals.length) notCarried.push(`Audience Signal (${audienceSignals.length}টি Saved/Custom Audience) TikTok Draft-এ যায় না — এই Flow-তে TikTok Audience Mapping নেই`);
      notCarried.push(...sharedGaps("TikTok"));
      // CA3 TikTok spike verdict (see
      // docs/campaign-advanced-cb1-acceptance.md): TikTok's
      // standard /ad/create/ carries ONE ad_text; multiple ad
      // texts exist only in the separate ACO product
      // (/ad/aco/create/, confirmed in TikTok's official SDK),
      // whose full create contract is a separate verified
      // build and is NOT used here. Extra CN5 text variants
      // are therefore listed in notCarried — never dropped
      // silently, never claimed as sent.
      const chosenText = String(firstAd?.primaryText ?? "").trim();
      const extraTexts = [...new Set(allAds.flatMap((a: any) => [...(this.textOptionsOf(a)?.primaryTexts ?? []), a.primaryText]))]
        .map((t: any) => String(t ?? "").trim())
        .filter((t: string) => t && t !== chosenText);
      for (const t of extraTexts) notCarried.push(`Ad Text Variant "${t.slice(0, 40)}…" — TikTok Standard Ad-এ একটিমাত্র Text যায়; Multi-text শুধু আলাদা ACO Product-এ (CA3 Spike Verdict), এই Publish-এ পাঠানো হয়নি`);
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
        adAccountId: dto.targetAdAccountId, name: draftName, dailyBudget: dailyTaka, countryCodes: countries, adText, landingUrl: firstUrl, imageUrl,
        ...(videoUrl ? { videoUrl } : {}),
        objectiveType: tiktokObjective,
        ...(tiktokObjective === "WEB_CONVERSIONS" ? { pixelId: dto.pixelId?.trim() || undefined, optimizationEvent: dto.optimizationEvent?.trim() || undefined } : {}),
      };
    }

    // CA17: the plan's UTM tagging rides every mapped
    // draft — Google as the campaign Final URL Suffix
    // (its own field; the final URLs themselves stay
    // clean), TikTok as params on the landing URL (TikTok
    // ads carry the URL itself; there is no suffix
    // field). A link's existing utm_* are the owner's
    // and win — skipped ones are reported, not forced.
    if (mapped && dto.platform === "google") {
      const qs = this.utmQueryString(this.utmParamsFor(plan, { platform: "google" }));
      if (qs) { mapped.finalUrlSuffix = qs; transformations.push("UTM: Google Campaign-এ Final URL Suffix যোগ হয়েছে (Plan-এর UTM Template/Default থেকে)"); }
    }
    if (mapped && dto.platform === "tiktok" && mapped.landingUrl) {
      const tagged = this.applyUtmParams(String(mapped.landingUrl), this.utmParamsFor(plan, { platform: "tiktok" }));
      if (tagged.applied.length) { mapped.landingUrl = tagged.url; transformations.push(`UTM: TikTok Landing URL-এ ${tagged.applied.join(", ")} যোগ হয়েছে (Plan-এর UTM Template/Default থেকে)`); }
      if (tagged.skipped.length) transformations.push(`UTM: Landing URL-এ আগে থেকেই ছিল বলে বদলানো হয়নি: ${tagged.skipped.join(", ")}`);
    }

    // CA15: fan-out preview dry run — the mapping above
    // is returned WITHOUT persisting a draft and WITHOUT
    // any platform call. Creation happens only through
    // the confirmed fan-out create (or this single-draft
    // path called without dryRun).
    if ((dto as any).dryRun) {
      return { status: unmapped.length ? "blocked" : "ready", platform: dto.platform, kind, mapped, unmapped, notCarried, transformations, budget, draftId: null };
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
        finalUrlSuffix: f.finalUrlSuffix ?? null,
        headlines: (f.headlines ?? []).map((h: string) => ({ text: h, length: String(h).length, limit: 30 })),
        longHeadlines: (f.longHeadlines ?? []).map((h: string) => ({ text: h, length: String(h).length, limit: 90 })),
        descriptions: (f.descriptions ?? []).map((d: string) => ({ text: d, length: String(d).length, limit: 90 })),
        imageUrls: f.imageUrls ?? [],
        // CA15: audience signals are stored verbatim on
        // the draft (from the plan's real audience rows);
        // they are NOT sent to Google at publish — a Meta
        // audience has no Google user-list counterpart.
        audienceSignals: f.audienceSignals ?? [],
        notes: ["Performance Max-এ Keyword থাকে না — Keyword চাইলে Search Draft ব্যবহার করুন", "এই Path-এ Video Asset যায় না", ...(Array.isArray(f.audienceSignals) && f.audienceSignals.length ? ["Audience Signal Draft-এ সংরক্ষিত আছে — Google-এ পাঠানো হয়নি (Meta Audience-এর Google User List এই অ্যাকাউন্টে নেই)"] : [])],
      };
    }
    if (draft.platform === "google") {
      return {
        platform: "google", kind: "rsa", label,
        name: f.name ?? null, dailyBudget: f.dailyBudget ?? null, countryCodes: f.countryCodes ?? [],
        headlines: (f.headlines ?? []).map((h: string) => ({ text: h, length: String(h).length, limit: 30 })),
        descriptions: (f.descriptions ?? []).map((d: string) => ({ text: d, length: String(d).length, limit: 90 })),
        finalUrl: f.finalUrl ?? null,
        finalUrlSuffix: f.finalUrlSuffix ?? null,
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

  /** OU4 + CA16 union: external status of a created draft —
   * a REAL platform read through PublishingService. Two
   * equivalent readers exist and either may answer: OU4's
   * unified crossPlatformCampaignStatus (mapped
   * providerStatus + raw enum) is tried first; CA16's
   * per-platform readers (getGoogleCampaignStatus /
   * getTikTokCampaignStatus — verbatim platform enums)
   * answer when the unified reader is absent or fails.
   * Drafts never created on the platform keep an honest
   * unavailable with the specific reason; a failed read
   * reports the platform's own error and falls back to the
   * as-created record, labelled as such — a metrics read is
   * still never dressed up as a status check. Sync never
   * throws for provider/config errors (available:false, the
   * message verbatim in `reason`); only a missing draft
   * throws (getCrossPlatformDraftOrThrow).
   * publicationStatus (from the creation record) rides on
   * the CA16 paths too, for the pre-OU4 consumers. */
  async syncCrossPlatformDraftStatus(organizationId: string, planId: string, draftId: string) {
    const draft = await this.getCrossPlatformDraftOrThrow(organizationId, planId, draftId);
    const base = { status: draft.status, externalCampaignId: draft.externalCampaignId ?? null };
    if (!draft.externalCampaignId) {
      return {
        available: false,
        reason: "এই Draft-এর কোনো External Campaign ID নেই — প্ল্যাটফর্মে এখনো তৈরি হয়নি, তাই পড়ার মতো কোনো Campaign Status নেই।",
        ...base, statusLabel: "as_created",
      };
    }
    // Union: the creation record's own status rides on the
    // CA16 paths too (OU4 kept publicationStatus on its
    // unavailable paths for the pre-OU4 consumers).
    let publicationStatus: string | null = null;
    if (draft.publicationId && (this.prisma as any).platformPublication?.findFirst) {
      const pub = await (this.prisma as any).platformPublication.findFirst({ where: { id: draft.publicationId, organizationId } }).catch(() => null);
      publicationStatus = pub?.status ?? null;
    }
    const caBase = { status: draft.status, externalCampaignId: draft.externalCampaignId ?? null, publicationStatus };
    if (draft.status !== "created") {
      return { ...caBase, available: false, statusLabel: "as_created", reason: "এই Draft এখনো Platform-এ তৈরি হয়নি — Live Status পড়ার কিছু নেই।" };
    }
    // OU4 unified reader first: mapped providerStatus + raw.
    let unifiedError: string | null = null;
    if (this.publishing && typeof (this.publishing as any).crossPlatformCampaignStatus === "function") {
      try {
        const result: any = await (this.publishing as any).crossPlatformCampaignStatus(organizationId, draft.targetAdAccountId, draft.platform, draft.externalCampaignId);
        const now = new Date().toISOString();
        return {
          available: true,
          statusLabel: "platform",
          providerStatus: result.providerStatus,
          providerStatusRaw: result.providerStatusRaw,
          platformStatus: result.providerStatusRaw ?? result.providerStatus,
          ...(result.name ? { name: result.name } : {}),
          status: draft.status,
          externalCampaignId: draft.externalCampaignId,
          publicationStatus,
          syncedAt: now,
          checkedAt: now,
        };
      } catch (e) {
        unifiedError = e instanceof Error ? e.message : String(e);
      }
    }
    // CA16 per-platform readers: verbatim platform enums —
    // the fallback when the unified reader is absent or failed.
    const reader = draft.platform === "google" ? (this.publishing as any)?.getGoogleCampaignStatus : (this.publishing as any)?.getTikTokCampaignStatus;
    if (typeof reader !== "function") {
      if (unifiedError !== null) {
        return { available: false, reason: unifiedError, status: draft.status, externalCampaignId: draft.externalCampaignId ?? null, statusLabel: "as_created", publicationStatus };
      }
      return {
        available: false,
        reason: "Cross-platform Campaign Status পড়ার পথ এই Context-এ উপলব্ধ নয় — PublishingService এই Service-এ যুক্ত নেই। তাই Status যাচাই করা যায়নি।",
        ...base, statusLabel: "as_created", publicationStatus,
      };
    }
    try {
      const live = await reader.call(this.publishing, organizationId, draft.targetAdAccountId, draft.externalCampaignId);
      if (draft.platform === "google") {
        if (!live?.status) return { ...caBase, available: false, statusLabel: "as_created", reason: "Google এই Campaign-এর কোনো Status ফেরত দেয়নি।" };
        return { ...caBase, available: true, statusLabel: "platform", platformStatus: live.status, status: live.status, checkedAt: new Date().toISOString() };
      }
      if (!live?.operationStatus && !live?.secondaryStatus) return { ...caBase, available: false, statusLabel: "as_created", reason: "TikTok এই Campaign-এর কোনো Status ফেরত দেয়নি।" };
      return { ...caBase, available: true, statusLabel: "platform", platformStatus: live.operationStatus ?? live.secondaryStatus, operationStatus: live.operationStatus ?? null, secondaryStatus: live.secondaryStatus ?? null, status: live.operationStatus ?? live.secondaryStatus, checkedAt: new Date().toISOString() };
    } catch (e) {
      return { ...caBase, available: false, statusLabel: "as_created", reason: `Platform Status পড়া যায়নি: ${e instanceof Error ? e.message : "অজানা ত্রুটি"}` };
    }
  }

  /** OU4: pause/resume a created cross-platform draft on the
   * PROVIDER, mirroring setMetaStatus discipline: resume is
   * gated by assertCampaignAccountAccess (pause never is —
   * stopping spend is a safety action), a provider failure
   * logs an error step and throws "did NOT confirm" with the
   * local state unchanged (this method never writes the
   * draft row), and success logs a `${platform}_pause|_resume`
   * publish-log step + a campaign.xdraft_paused/resumed audit.
   * Delete/archive is deliberately NOT part of this lifecycle
   * (TikTok v1.3 has no campaign delete; pause is the floor). */
  async setCrossPlatformDraftLifecycle(organizationId: string, actorId: string, planId: string, draftId: string, action: "pause" | "resume") {
    if (action !== "pause" && action !== "resume") throw new BadRequestException(`action must be "pause" or "resume" (got "${action}")`);
    if (!this.publishing || typeof (this.publishing as any).crossPlatformSetCampaignStatus !== "function") {
      throw new BadRequestException("Cross-platform publishing is not available in this context");
    }
    const draft = await this.getCrossPlatformDraftOrThrow(organizationId, planId, draftId);
    if (draft.status !== "created" || !draft.externalCampaignId) {
      throw new BadRequestException(`শুধু তৈরি (created) Draft-এরই প্ল্যাটফর্ম Status বদলানো যায় — এই Draft-এর Status "${draft.status}"${draft.externalCampaignId ? "" : " এবং কোনো External Campaign ID নেই"}।`);
    }
    // CC27 discipline, same as Meta: activation gated, pause always allowed.
    if (action === "resume") await this.assertCampaignAccountAccess(organizationId, actorId, { adAccountId: draft.targetAdAccountId });
    const target: "ACTIVE" | "PAUSED" = action === "resume" ? "ACTIVE" : "PAUSED";
    const step = `${draft.platform}_${action}`;
    const platformLabel = draft.platform === "google" ? "Google" : draft.platform === "tiktok" ? "TikTok" : draft.platform;
    try {
      await (this.publishing as any).crossPlatformSetCampaignStatus(organizationId, actorId, draft.targetAdAccountId, draft.platform, draft.externalCampaignId, target);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Status change failed";
      await this.logStep(planId, actorId, step, "error", { externalId: draft.externalCampaignId, error: message }).catch(() => undefined);
      throw new BadRequestException(`${platformLabel} did NOT confirm the status change: ${message}. Local status is unchanged.`);
    }
    await this.logStep(planId, actorId, step, "success", { externalId: draft.externalCampaignId }).catch(() => undefined);
    await this.audit.log({ organizationId, userId: actorId, action: action === "pause" ? "campaign.xdraft_paused" : "campaign.xdraft_resumed", entityType: "CrossPlatformDraft", entityId: draftId, metadata: { platform: draft.platform, externalCampaignId: draft.externalCampaignId, target } }).catch(() => undefined);
    // Fresh provider read for the returned status; if that
    // read fails, fall back to the target we just confirmed
    // with the provider — providerStatusSource says which.
    let providerStatus: string = target === "ACTIVE" ? "active" : "paused";
    let providerStatusRaw: string | undefined;
    let providerStatusSource: "fresh_sync" | "target_mapped" = "target_mapped";
    try {
      const fresh: any = await (this.publishing as any).crossPlatformCampaignStatus(organizationId, draft.targetAdAccountId, draft.platform, draft.externalCampaignId);
      if (fresh) {
        providerStatus = fresh.providerStatus;
        providerStatusRaw = fresh.providerStatusRaw;
        providerStatusSource = "fresh_sync";
      }
    } catch { /* keep the confirmed target mapping */ }
    return {
      draft,
      providerStatus,
      ...(providerStatusRaw ? { providerStatusRaw } : {}),
      providerStatusSource,
    };
  }

  /** CA16: pause / activate a CREATED cross-platform
   * draft on its platform — the Meta control treatment:
   * activation is gated on campaign-account access
   * (CC27), pause is always allowed, the platform must
   * CONFIRM (its error propagates verbatim and nothing
   * local changes), and the confirmed change is written
   * to the publish log + audit. The draft row's own
   * status stays the creation lifecycle ("created");
   * the live status read is the truth for current state. */
  async setCrossPlatformDraftStatus(organizationId: string, actorId: string, planId: string, draftId: string, target: "ACTIVE" | "PAUSED") {
    if (target !== "ACTIVE" && target !== "PAUSED") throw new BadRequestException("target হতে হবে ACTIVE বা PAUSED");
    if (!this.publishing) throw new BadRequestException("Cross-platform publishing is not available in this context");
    const draft = await this.getCrossPlatformDraftOrThrow(organizationId, planId, draftId);
    if (draft.status !== "created" || !draft.externalCampaignId) throw new BadRequestException("এই Draft এখনো Platform-এ তৈরি হয়নি — Status বদলানো যাবে না");
    if (target === "ACTIVE") await this.assertCampaignAccountAccess(organizationId, actorId, { adAccountId: draft.targetAdAccountId });
    const setter = draft.platform === "google" ? (this.publishing as any).setGoogleCampaignStatus : (this.publishing as any).setTikTokCampaignStatus;
    if (typeof setter !== "function") throw new BadRequestException("এই Deployment-এ Platform Status বদলের Path যুক্ত নেই");
    const platformTarget = draft.platform === "google" ? (target === "ACTIVE" ? "ENABLED" : "PAUSED") : (target === "ACTIVE" ? "ENABLE" : "DISABLE");
    try {
      await setter.call(this.publishing, organizationId, draft.targetAdAccountId, draft.externalCampaignId, platformTarget);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Status change failed";
      await this.logStep(planId, actorId, `${draft.platform}_status`, "error", { entityRef: draftId, externalId: draft.externalCampaignId, error: message }).catch(() => undefined);
      throw new BadRequestException(`Platform Status বদল নিশ্চিত করেনি: ${message}। Local Record অপরিবর্তিত আছে।`);
    }
    await this.logStep(planId, actorId, `${draft.platform}_status`, "success", { entityRef: draftId, externalId: draft.externalCampaignId }).catch(() => undefined);
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.xdraft_status", entityType: "CrossPlatformDraft", entityId: draftId, metadata: { platform: draft.platform, target, platformStatus: platformTarget, externalCampaignId: draft.externalCampaignId } }).catch(() => undefined);
    return { platform: draft.platform, target, platformStatus: platformTarget, externalCampaignId: draft.externalCampaignId };
  }

  /** CA16: change a CREATED draft's daily budget on its
   * platform — a money move, so it follows the Meta
   * budget treatment: explicit value, platform confirms
   * FIRST, local fields update only after confirmation,
   * before/after in the audit. The platform address of
   * the budget comes from the creation record itself
   * (Google: the budget step's resource name; TikTok:
   * the ad group id — the level this flow budgets at).
   * A draft whose creation record lacks that address
   * gets an honest refusal, never a guessed call. */
  async updateCrossPlatformDraftBudget(organizationId: string, actorId: string, planId: string, draftId: string, dailyBudgetRaw: string) {
    const daily = Number(dailyBudgetRaw);
    if (!Number.isFinite(daily) || daily <= 0) throw new BadRequestException("দৈনিক বাজেট ধনাত্মক সংখ্যা হতে হবে");
    if (!this.publishing) throw new BadRequestException("Cross-platform publishing is not available in this context");
    const draft = await this.getCrossPlatformDraftOrThrow(organizationId, planId, draftId);
    if (draft.status !== "created" || !draft.externalCampaignId) throw new BadRequestException("এই Draft এখনো Platform-এ তৈরি হয়নি — Budget বদলানো যাবে না");
    let pub: any = null;
    if (draft.publicationId && (this.prisma as any).platformPublication?.findFirst) {
      pub = await (this.prisma as any).platformPublication.findFirst({ where: { id: draft.publicationId, organizationId } }).catch(() => null);
    }
    const before = (draft.fields as any)?.dailyBudget ?? null;
    try {
      if (draft.platform === "google") {
        const budgetResource = (pub?.detail?.steps ?? []).find((s: any) => s.step === "budget")?.resourceName;
        if (!budgetResource) throw new BadRequestException("এই Draft-এর Creation Record-এ Google Budget Resource নেই — Budget বদলানো যাবে না (Re-publish করলে নতুন Record তৈরি হবে)");
        await (this.publishing as any).updateGoogleCampaignBudget(organizationId, draft.targetAdAccountId, budgetResource, daily);
      } else {
        const adgroupId = pub?.detail?.adgroupId;
        if (!adgroupId) throw new BadRequestException("এই Draft-এর Creation Record-এ TikTok Ad Group ID নেই — Budget বদলানো যাবে না (Re-publish করলে নতুন Record তৈরি হবে)");
        await (this.publishing as any).updateTikTokAdGroupBudget(organizationId, draft.targetAdAccountId, String(adgroupId), daily);
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      const message = e instanceof Error ? e.message : "Budget change failed";
      await this.logStep(planId, actorId, `${draft.platform}_budget`, "error", { entityRef: draftId, externalId: draft.externalCampaignId, error: message }).catch(() => undefined);
      throw new BadRequestException(`Platform Budget বদল নিশ্চিত করেনি: ${message}। Local Record অপরিবর্তিত আছে।`);
    }
    const fields = { ...((draft.fields as any) ?? {}), dailyBudget: daily.toFixed(2) };
    const updated = await (this.prisma as any).crossPlatformDraft.update({ where: { id: draftId }, data: { fields } }).catch(() => ({ ...draft, fields }));
    await this.logStep(planId, actorId, `${draft.platform}_budget`, "success", { entityRef: draftId, externalId: draft.externalCampaignId }).catch(() => undefined);
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.xdraft_budget", entityType: "CrossPlatformDraft", entityId: draftId, metadata: { platform: draft.platform, before, after: daily.toFixed(2), externalCampaignId: draft.externalCampaignId } }).catch(() => undefined);
    return { draft: updated, before, after: daily.toFixed(2), platform: draft.platform };
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

  // ---------- CA17 (CB4): plan-level UTM template ----------

  /** The five UTM keys a plan template may set, and the
   * tokens its values may carry. */
  static readonly UTM_KEYS = ["source", "medium", "campaign", "content", "term"] as const;
  static readonly UTM_TOKENS = ["platform", "campaign", "adset", "ad"] as const;

  private utmSlug(value: string): string {
    return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  }

  /** CA17: the UTM params for one placement, from the
   * plan's template or the built-in defaults. Defaults:
   * source = the platform's own name (facebook / google /
   * tiktok), medium "cpc", campaign = plan-name slug,
   * content = ad-set slug and term = ad slug (each only
   * when that context exists). A template key overrides
   * its default; keys the template does not set keep
   * their defaults. Template values render the tokens
   * {platform} {campaign} {adset} {ad} against the same
   * real facts; a key rendering EMPTY is omitted — an
   * empty utm value is never sent. */
  utmParamsFor(plan: any, ctx: { platform: "meta" | "google" | "tiktok"; adSetName?: string | null; adName?: string | null }): { key: string; value: string }[] {
    const sourceName = ctx.platform === "meta" ? "facebook" : ctx.platform;
    const facts: Record<string, string> = {
      platform: sourceName,
      campaign: this.utmSlug(plan?.name ?? "") || "campaign",
      adset: this.utmSlug(ctx.adSetName ?? ""),
      ad: this.utmSlug(ctx.adName ?? ""),
    };
    const defaults: Record<string, string | undefined> = {
      source: sourceName, medium: "cpc", campaign: facts.campaign,
      content: facts.adset || undefined,
      term: facts.ad || undefined,
    };
    const template = plan?.utmTemplate && typeof plan.utmTemplate === "object" && !Array.isArray(plan.utmTemplate) ? plan.utmTemplate : null;
    const out: { key: string; value: string }[] = [];
    for (const key of CampaignsService.UTM_KEYS) {
      let value: string | undefined;
      if (template && typeof template[key] === "string") {
        value = template[key].replace(/\{(platform|campaign|adset|ad)\}/g, (_m: string, t: string) => facts[t] ?? "").replace(/\s+/g, "-").trim();
      } else {
        value = defaults[key];
      }
      if (value) out.push({ key: `utm_${key}`, value });
    }
    return out;
  }

  utmQueryString(params: { key: string; value: string }[]): string {
    return params.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join("&");
  }

  /** Append UTM params WITHOUT overwriting any utm_*
   * already on the link (the Phase J rule: existing
   * params are the owner's). Invalid URLs pass through
   * unchanged; applied/skipped keys are reported so the
   * caller can say exactly what happened. */
  applyUtmParams(linkUrl: string, params: { key: string; value: string }[]): { url: string; changed: boolean; applied: string[]; skipped: string[] } {
    const applied: string[] = []; const skipped: string[] = [];
    try {
      const u = new URL(linkUrl);
      for (const p of params) {
        if (u.searchParams.has(p.key)) { skipped.push(p.key); continue; }
        u.searchParams.set(p.key, p.value); applied.push(p.key);
      }
      const url = u.toString();
      return { url, changed: url !== linkUrl, applied, skipped };
    } catch {
      return { url: linkUrl, changed: false, applied, skipped };
    }
  }

  async getPlanUtmTemplate(organizationId: string, planId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    return {
      template: (plan as any).utmTemplate ?? null,
      keys: [...CampaignsService.UTM_KEYS],
      tokens: [...CampaignsService.UTM_TOKENS],
      samples: {
        meta: this.utmQueryString(this.utmParamsFor(plan, { platform: "meta" })),
        google: this.utmQueryString(this.utmParamsFor(plan, { platform: "google" })),
        tiktok: this.utmQueryString(this.utmParamsFor(plan, { platform: "tiktok" })),
      },
    };
  }

  async setPlanUtmTemplate(organizationId: string, actorId: string, planId: string, dto: { template?: Record<string, string> | null }) {
    await this.getPlanOrThrow(organizationId, planId);
    const raw = dto?.template ?? null;
    let template: Record<string, string> | null = null;
    if (raw !== null) {
      if (typeof raw !== "object" || Array.isArray(raw)) throw new BadRequestException("UTM Template অবজেক্ট হতে হবে");
      const keys = Object.keys(raw);
      const unknown = keys.filter((k) => !(CampaignsService.UTM_KEYS as readonly string[]).includes(k));
      if (unknown.length) throw new BadRequestException(`অজানা UTM Key: ${unknown.join(", ")} — ব্যবহারযোগ্য: ${CampaignsService.UTM_KEYS.join(", ")}`);
      if (!keys.length) throw new BadRequestException("Template-এ অন্তত একটি Key দিন — Template মুছতে চাইলে null পাঠান");
      template = {};
      for (const k of keys) {
        const v = String((raw as any)[k] ?? "").trim();
        if (!v) throw new BadRequestException(`utm_${k}-এর মান খালি হতে পারবে না`);
        if (v.length > 120) throw new BadRequestException(`utm_${k}-এর মান সর্বোচ্চ ১২০ অক্ষরের হতে পারে`);
        const used = [...v.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1].toLowerCase());
        const badTokens = used.filter((t) => !(CampaignsService.UTM_TOKENS as readonly string[]).includes(t));
        if (badTokens.length) throw new BadRequestException(`অজানা Token: ${badTokens.map((t) => `{${t}}`).join(", ")} — ব্যবহারযোগ্য: ${CampaignsService.UTM_TOKENS.map((t) => `{${t}}`).join(" ")}`);
        template[k] = v;
      }
    }
    await (this.prisma as any).campaignPlan.update({ where: { id: planId }, data: { utmTemplate: template } });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.utm_template_updated", entityType: "CampaignPlan", entityId: planId, metadata: { template } }).catch(() => undefined);
    return this.getPlanUtmTemplate(organizationId, planId);
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

  /**
   * SA-B15 (A2): account-scoped twin of setMetaStatus, for Meta
   * campaigns that exist on the platform but were NOT created
   * through a CampaignPlan here (e.g. made in Ads Manager and
   * synced in as AdCampaign rows) — setMetaStatus stays the
   * dashboard path for plan campaigns; this pair gives the
   * Action Engine exactly one hub home for the account-scoped
   * case, with the SAME discipline: the CC27 gate on activation
   * (pause is never gated — stopping spend is a safety action),
   * Meta confirms FIRST through the account's own client
   * (metaClientForAccount), and a platform failure throws
   * "Meta did NOT confirm …" with no local state claimed.
   * Deliberately NO local status write: no sync maintains
   * AdCampaign.status on this line, so a value written here
   * would later masquerade as platform truth — the read
   * companion below reads Meta live instead.
   */
  async setMetaCampaignStatusByAccount(organizationId: string, actorId: string, adAccountId: string, externalCampaignId: string, target: "ACTIVE" | "PAUSED") {
    if (target !== "ACTIVE" && target !== "PAUSED") throw new BadRequestException(`target must be ACTIVE or PAUSED (got "${target}")`);
    if (!externalCampaignId) throw new BadRequestException("externalCampaignId is required to change campaign status");
    const account = await (this.prisma as any).adAccount.findFirst({ where: { id: adAccountId, organizationId } });
    if (!account) throw new NotFoundException("Ad account not found in this organization");
    if (account.platform !== "meta") throw new BadRequestException("This lifecycle path is Meta-only");
    // CC27: activation gated, pause always allowed (same as setMetaStatus).
    if (target === "ACTIVE") await this.assertCampaignAccountAccess(organizationId, actorId, { adAccountId });
    const client = await this.metaClientForAccount(organizationId, account);
    try {
      await client.setObjectStatus(externalCampaignId, target);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Status change failed";
      throw new BadRequestException(`Meta did NOT confirm the status change: ${message}. Local status is unchanged.`);
    }
    await this.audit.log({ organizationId, userId: actorId, action: target === "PAUSED" ? "campaign.paused" : "campaign.activated", entityType: "AdCampaign", entityId: externalCampaignId, metadata: { platform: "meta", adAccountId, externalCampaignId, target, via: "action_engine" } });
    return { platform: "meta", externalCampaignId, status: target };
  }

  /** SA-B15 (A2): live Meta status read for an account-scoped
   *  campaign — the Action Engine verifier's read-back. Returns
   *  Meta's own configured status + effective status; a status
   *  Meta does not report comes back null, never guessed. */
  async getMetaCampaignStatusByAccount(organizationId: string, adAccountId: string, externalCampaignId: string) {
    const account = await (this.prisma as any).adAccount.findFirst({ where: { id: adAccountId, organizationId } });
    if (!account) throw new NotFoundException("Ad account not found in this organization");
    if (account.platform !== "meta") throw new BadRequestException("This status read is Meta-only");
    const client = await this.metaClientForAccount(organizationId, account);
    const res = await client.getObjectStatus(externalCampaignId);
    return { platform: "meta", externalCampaignId, status: res.status ?? null, effectiveStatus: res.effectiveStatus ?? null };
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
      // CA27: the org's winner-trait FACTS (real A/B
      // verdicts + ad-level metrics, minimum-sample
      // gated) ride the copy prompt as a labelled line —
      // absent traits add nothing, never a guess.
      const winnerTraits = await this.winnerTraits(organizationId).catch(() => null);
      const result = await provider.complete([
        { role: "system", content: "You write short ad copy for an ecommerce product. Use ONLY the product facts provided: never invent discounts, stock claims, delivery promises or features. Bengali (Bangla script) by default unless the product name is English-only. Return ONLY JSON: {\"variants\":[{\"primaryText\":string,\"headline\":string}]} with exactly 2 variants." },
        { role: "user", content: `Product: ${product.name}\nPrice: ${price}\nCategory: ${product.category ?? "-"}\nDescription: ${product.description ?? "-"}\nBusiness: ${profile?.industry ?? "-"}; brand voice: ${profile?.brandVoice ?? "-"}${winnerTraits?.factsBn ? `\n${winnerTraits.factsBn}` : ""}` },
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

  /** CA1: AI image generation from inside the builder. The
   * plan supplies the ad account (a draft may target another
   * via dto.adAccountId); the actual generation, storage and
   * Meta ingest live in CreativesService.generateAiImage —
   * this method only gates on the plan and delegates. The
   * result is a Creative Library asset (name prefix "AI ছবি — "),
   * never an ad: the human still picks it into an ad. */
  async generateImage(organizationId: string, actorId: string, planId: string, dto: { prompt: string; productId?: string; adAccountId?: string }) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    this.assertEditable(plan);
    if (!this.creatives) throw new BadRequestException("AI image generation is not available in this context");
    return this.creatives.generateAiImage(organizationId, actorId, {
      adAccountId: dto.adAccountId ?? plan.adAccountId,
      prompt: dto.prompt,
      productId: dto.productId,
    });
  }

  /** CA2: AI video ad generation. The SCRIPT is built here
   * under the suggestPlan fact discipline: the LLM writes
   * words only, every number in its text must already exist
   * in the product fact pack (the price, in either digit
   * script), and any violation — or no real LLM at all —
   * falls back to a template script built from the same real
   * facts, LABELLED scriptSource:"template" in the response
   * (the generateCopy dev-template precedent — a fallback is
   * never dressed up as an LLM result). Assembly, storage and
   * Meta ingest live in CreativesService.generateAiVideo;
   * the output is slideshow video from the product's own
   * photos, never presented as filmed footage. */
  async generateVideo(organizationId: string, actorId: string, planId: string, dto: { productId: string; adAccountId?: string }) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    this.assertEditable(plan);
    if (!this.creatives) throw new BadRequestException("AI video generation is not available in this context");
    const product = await (this.prisma as any).product.findFirst({ where: { id: dto.productId, organizationId } });
    if (!product) throw new NotFoundException("Product not found in this organization");
    const price = formatMinor(BigInt(product.priceMinor), product.currency);

    const taka = Number(BigInt(product.priceMinor)) / 100;
    const allowedNumbers = new Set([String(taka), taka.toFixed(2)]);
    const numbersOk = (text: string) => {
      const found = text.replace(/[০-৯]/g, (d) => "০১২৩৪৫৬৭৮৯".indexOf(d).toString()).match(/\d+(?:\.\d+)?/g) ?? [];
      return found.every((n) => allowedNumbers.has(n) || allowedNumbers.has(String(Number(n))) || allowedNumbers.has(Number(n).toFixed(2)));
    };
    const templateScript = () => ({
      headline: String(product.name).slice(0, 80),
      lines: [
        product.description ? String(product.description).slice(0, 90) : product.category ? `${product.category} — আমাদের কালেকশন থেকে` : "আমাদের কালেকশন থেকে",
        "বিস্তারিত দেখতে ক্লিক করুন",
      ],
    });

    let script = templateScript();
    let scriptSource: "llm" | "template" = "template";
    const provider = this.llm.getProvider();
    if (provider.isRealLlm) {
      const result = await provider.complete([
        { role: "system", content: "You write a SHORT slideshow script for an ecommerce product video. Use ONLY the product facts provided: never invent discounts, stock claims, delivery promises or features. Bengali (Bangla script). Return ONLY JSON: {\"headline\":string,\"lines\":[string]} with 2-3 short lines (each at most 60 characters) shown after the headline." },
        { role: "user", content: `Product: ${product.name}\nPrice: ${price}\nCategory: ${product.category ?? "-"}\nDescription: ${product.description ?? "-"}` },
      ], { jsonMode: true, maxTokens: 500 }).catch(() => null);
      if (result) {
        await (this.prisma as any).aIUsageRecord.create({
          data: { organizationId, userId: actorId, feature: "ad_video_script", provider: provider.name, inputTokens: result.inputTokens, outputTokens: result.outputTokens, estimated: result.tokensEstimated },
        }).catch(() => undefined);
        try {
          const parsed = JSON.parse(result.text);
          const headline = String(parsed?.headline ?? "").trim();
          const lines = (Array.isArray(parsed?.lines) ? parsed.lines : []).map((l: any) => String(l ?? "").trim()).filter(Boolean).slice(0, 3);
          if (headline && lines.length >= 1 && numbersOk(headline) && lines.every(numbersOk)) {
            script = { headline: headline.slice(0, 120), lines: lines.map((l: string) => l.slice(0, 90)) };
            scriptSource = "llm";
          }
        } catch { /* invalid LLM output → the labelled template script stands */ }
      }
    }

    const out = await this.creatives.generateAiVideo(organizationId, actorId, {
      adAccountId: dto.adAccountId ?? plan.adAccountId,
      productId: product.id,
      name: `AI ভিডিও — ${product.name}`.slice(0, 120),
      script,
    });
    return { ...out, script, scriptSource, provider: provider.name };
  }

  /** Numbers in a text, digit-script normalized (Bengali
   * digits → Latin), as canonical numeric strings. */
  private static numbersInText(text: string): string[] {
    const normalized = String(text ?? "").replace(/[০-৯]/g, (d) => "০১২৩৪৫৬৭৮৯".indexOf(d).toString());
    const found = normalized.match(/\d+(?:\.\d+)?/g) ?? [];
    return [...new Set(found.map((n) => String(Number(n))))].sort();
  }

  /** CA4: per-ad copy localization (bn ↔ en) via the org's
   * REAL LLM. Numbers are LOCKED to the source: the union of
   * numbers across the whole ad must be identical after
   * translation — an invented or dropped number refuses the
   * whole operation and NOTHING is saved (no silent save,
   * ever). There is NO template fallback for translation: no
   * real LLM configured = an honest unavailable answer. The
   * result is stored as locale-labelled variants under
   * textOptions.locales.<locale> (the canonical fields stay
   * untouched); a same-locale request is refused from a
   * script-detection heuristic, labelled as such. */
  async localizeAdCopy(organizationId: string, actorId: string, planId: string, adId: string, dto: { targetLocale: string }) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    this.assertEditable(plan);
    const target = dto.targetLocale;
    if (!["bn", "en"].includes(target)) throw new BadRequestException("targetLocale must be bn or en");
    const ad = await (this.prisma as any).campaignAd.findFirst({ where: { id: adId, planId } });
    if (!ad) throw new NotFoundException("Ad not found in this plan");
    const opts = this.textOptionsOf(ad);
    const source = {
      primaryTexts: opts?.primaryTexts ?? (ad.primaryText ? [String(ad.primaryText)] : []),
      headlines: opts?.headlines ?? (ad.headline ? [String(ad.headline)] : []),
      descriptions: opts?.descriptions ?? (ad.description ? [String(ad.description)] : []),
    };
    const sourceAll = [...source.primaryTexts, ...source.headlines, ...source.descriptions].join("\n");
    if (!sourceAll.trim()) throw new BadRequestException("এই Ad-এ অনুবাদ করার মতো কোনো Text নেই");
    const detected = /[\u0980-\u09FF]/.test(sourceAll) ? "bn" : "en"; // Bengali Unicode block
    if (detected === target) {
      throw new BadRequestException(target === "bn" ? "Ad-এর Text এমনিতেই বাংলায় আছে বলে মনে হচ্ছে (Script দেখে আন্দাজ) — আবার অনুবাদের দরকার নেই" : "Ad-এর Text এমনিতেই English-এ আছে বলে মনে হচ্ছে (Script দেখে আন্দাজ) — আবার অনুবাদের দরকার নেই");
    }
    const provider = this.llm.getProvider();
    if (!provider.isRealLlm) {
      throw new BadRequestException("অনুবাদের জন্য আসল AI Provider দরকার — Organization Settings-এ LLM Provider configure করুন। Template দিয়ে অনুবাদ করা হয় না।");
    }
    const sourceNumbers = CampaignsService.numbersInText(sourceAll);
    const result = await provider.complete([
      { role: "system", content: `Translate ecommerce ad copy into ${target === "bn" ? "Bengali (Bangla script)" : "English"}. Keep EVERY number exactly as it appears in the source — never add, drop or change a number, price, discount or quantity. Keep the same number of items in each list, in the same order. Return ONLY JSON: {"primaryTexts":[string],"headlines":[string],"descriptions":[string]} — include a list only when the source has it; use [] otherwise.` },
      { role: "user", content: JSON.stringify(source) },
    ], { jsonMode: true, maxTokens: 1200 }).catch(() => null);
    if (!result) throw new BadRequestException("AI Provider থেকে অনুবাদ পাওয়া যায়নি — কিছুক্ষণ পরে আবার চেষ্টা করুন");
    await (this.prisma as any).aIUsageRecord.create({
      data: { organizationId, userId: actorId, feature: "ad_copy_localization", provider: provider.name, inputTokens: result.inputTokens, outputTokens: result.outputTokens, estimated: result.tokensEstimated },
    }).catch(() => undefined);
    let parsed: any;
    try { parsed = JSON.parse(result.text); } catch { throw new BadRequestException("AI-এর অনুবাদ পড়া যায়নি (JSON নয়) — কিছু সেভ হয়নি"); }
    const clean = (v: any) => (Array.isArray(v) ? v.map((x: any) => String(x ?? "").trim()) : []);
    const translated = {
      primaryTexts: clean(parsed?.primaryTexts),
      headlines: clean(parsed?.headlines),
      descriptions: clean(parsed?.descriptions),
    };
    for (const key of ["primaryTexts", "headlines", "descriptions"] as const) {
      if (source[key].length && translated[key].length !== source[key].length) {
        throw new BadRequestException(`অনুবাদে ${key}-এর সংখ্যা বদলে গেছে (আছে ${source[key].length}টি, অনুবাদে ${translated[key].length}টি) — নিরাপত্তার জন্য কিছু সেভ হয়নি`);
      }
    }
    const translatedNumbers = CampaignsService.numbersInText([...translated.primaryTexts, ...translated.headlines, ...translated.descriptions].join("\n"));
    if (JSON.stringify(translatedNumbers) !== JSON.stringify(sourceNumbers)) {
      throw new BadRequestException(`অনুবাদে সংখ্যা/দাম বদলে গেছে — Source-এ ছিল [${sourceNumbers.join(", ") || "কোনো সংখ্যা নেই"}], অনুবাদে এসেছে [${translatedNumbers.join(", ") || "কোনো সংখ্যা নেই"}]। সংখ্যা লক করা থাকে বলে কিছু সেভ হয়নি`);
    }
    const existingOpts = ad.textOptions && typeof ad.textOptions === "object" ? ad.textOptions : {};
    const baseOpts = opts ?? { primaryTexts: source.primaryTexts, headlines: source.headlines, descriptions: source.descriptions };
    const locales = { ...((existingOpts as any).locales ?? {}), [target]: translated };
    const newTextOptions = { ...baseOpts, locales };
    await (this.prisma as any).campaignAd.update({ where: { id: ad.id }, data: { textOptions: newTextOptions } });
    return { adId: ad.id, locale: target, sourceLocaleDetected: detected, translated, numbersLocked: sourceNumbers };
  }

  /**
   * CB3: deterministic creative health checks. Labelled
   * heuristics (lengths, missing pieces, domain match) —
   * not Meta verdicts; structural errors stay errors.
   */
  async creativeHealth(organizationId: string, planId: string, actorId?: string) {
    const full = await this.getPlanFull(organizationId, planId);
    const profile = await (this.prisma as any).businessProfile?.findUnique?.({ where: { organizationId } })?.catch?.(() => null);
    let siteDomain = "";
    try { siteDomain = profile?.websiteUrl ? new URL(profile.websiteUrl).hostname.replace(/^www\./, "") : ""; } catch { siteDomain = ""; }
    const findings: { adId: string; adName: string; level: "warn" | "error" | "not_checked"; message: string }[] = [];
    let adsChecked = 0;
    for (const s of full.adSets ?? []) {
      for (const ad of s.ads ?? []) {
        adsChecked++;
        const f = (level: "warn" | "error" | "not_checked", message: string) => findings.push({ adId: ad.id, adName: ad.name, level, message });
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

    // ---------- CA5: dimension checks + vision estimates ----------
    // Deterministic dimension checks read the width/height now
    // stored on CreativeAsset (CA5 migration). An asset WITHOUT
    // dimensions is reported not_checked — never passed
    // silently. The text-in-image and 9:16 safe-zone items are
    // VisionService ESTIMATES (labelled as such in every
    // message); vision unavailable / bytes unreadable / cap
    // reached → not_checked with the reason.
    const allAds = (full.adSets ?? []).flatMap((s: any) => s.ads ?? []);
    const assetIds = [...new Set(allAds.flatMap((a: any) => [a.imageAssetId, a.videoAssetId]).filter(Boolean))] as string[];
    const assetRows = assetIds.length && (this.prisma as any).creativeAsset?.findMany
      ? await (this.prisma as any).creativeAsset.findMany({ where: { id: { in: assetIds }, organizationId } }).catch(() => [])
      : [];
    const assetById = new Map<string, any>((assetRows ?? []).map((r: any) => [r.id, r]));
    const actor = actorId ?? (full as any).createdById ?? "system";
    let visionScanned = 0;
    for (const ad of allAds) {
      const f = (level: "warn" | "error" | "not_checked", message: string) => findings.push({ adId: ad.id, adName: ad.name, level, message });
      const isVideo = (ad.format ?? "link") === "video" || !!ad.videoAssetId;
      const asset = (ad.videoAssetId ? assetById.get(ad.videoAssetId) : undefined) ?? (ad.imageAssetId ? assetById.get(ad.imageAssetId) : undefined);
      if (asset) {
        if (asset.width && asset.height) {
          const w = Number(asset.width), h = Number(asset.height);
          if (Math.min(w, h) < 500) f("warn", `Creative-এর রেজোলিউশন কম (${w}×${h}) — ছোট দিক 500px-এর নিচে হলে Feed-এ ঝাপসা দেখাতে পারে (heuristic)`);
          if (h / w > 1.92) f("warn", `Creative ${w}×${h} — 9:16-এর চেয়েও লম্বা Aspect, প্ল্যাটফর্ম উপরে/নিচে Crop করবে (heuristic)`);
          if (!isVideo && w / h >= 1.5 && !ad.placementAssets?.placements?.vertical) f("warn", `Landscape ছবি (${w}×${h}) — Stories/Reels-এ Crop/ফাঁকা জায়গা থাকবে; Vertical (9:16) Asset দিলে ভালো হয় (heuristic)`);
        } else {
          f("not_checked", "Creative-এর Dimension (Width/Height) জানা নেই — এই Asset-টি Dimension সংরক্ষণের আগের; Aspect/Resolution যাচাই হয়নি (not checked)");
        }
      }
      const imageUrl = asset?.kind === "image" ? asset.sourceUrl : ad.imageUrl;
      if (!isVideo && imageUrl) {
        if (!this.vision || !this.creatives) {
          f("not_checked", "Vision যাচাই এই Context-এ যুক্ত নেই — ছবিতে লেখার পরিমাণ যাচাই হয়নি (not checked)");
        } else if (visionScanned >= 5) {
          f("not_checked", "একবারে সর্বোচ্চ ৫টি Ad-এর ছবি Vision দিয়ে যাচাই হয় — এই Ad-টি এই রানে যাচাই হয়নি (not checked)");
        } else {
          visionScanned++;
          const got = await this.creatives.creativeImageBytes(imageUrl).catch(() => null);
          if (!got) {
            f("not_checked", "ছবির Bytes আমাদের CDN থেকে পাওয়া যায়নি — Vision যাচাই হয়নি (not checked)");
          } else {
            const res = await this.vision.analyzeImage(organizationId, actor, {
              imageBytes: got.bytes, mimeType: got.mimeType, feature: "vision_ad_creative_scan",
              prompt: "You inspect an ecommerce ad image. Estimate how much of the image area is covered by text/lettering, and whether important content touches the edges. Return ONLY JSON: {\"textCoveragePercent\": number (0-100), \"contentAtEdges\": [\"top\"|\"bottom\"|\"left\"|\"right\"], \"summary\": string}. These are estimates — note uncertainty in the summary.",
            }).catch((e: any) => ({ available: false as const, reason: String(e?.message ?? e).slice(0, 200) }));
            if (!res.available) {
              f("not_checked", `Vision যাচাই হয়নি — ${(res as any).reason} (not checked)`);
            } else {
              let parsed: any = null;
              try { parsed = JSON.parse(res.text); } catch { parsed = null; }
              if (!parsed || typeof parsed.textCoveragePercent !== "number") {
                f("not_checked", "Vision-এর উত্তর পড়া যায়নি — ছবিতে লেখার পরিমাণ যাচাই হয়নি (not checked)");
              } else {
                if (parsed.textCoveragePercent > 20) f("warn", `ছবিতে লেখার পরিমাণ বেশি হতে পারে — Vision Estimate: ~${Math.round(parsed.textCoveragePercent)}% জায়গা জুড়ে লেখা (estimate; Meta-র বর্তমান নিয়মে লেখা নিষেধ নয়, তবে লেখা-ভারী ছবি সাধারণত কম পৌঁছায়)`);
                const isVertical = asset?.width && asset?.height ? Number(asset.height) > Number(asset.width) : false;
                const edges: string[] = Array.isArray(parsed.contentAtEdges) ? parsed.contentAtEdges : [];
                if (isVertical && (edges.includes("top") || edges.includes("bottom"))) {
                  f("warn", "9:16 Safe Zone: ছবির মূল অংশ একদম উপরে/নিচের ধারে — Stories/Reels-এর UI (উপরে Profile-এর নাম, নিচে CTA বোতাম) তা ঢেকে দিতে পারে (Vision estimate)");
                }
              }
            }
          }
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

    // CA7: per-audience history as FACTS — the org's
    // stored rollups (CA7), ranked by CPA. The minimums
    // are stated, not implied: an audience qualifies only
    // with at least ৳500 of attributed spend AND at least
    // one conversion in its window, so a single lucky
    // click can never top the list. Server-computed from
    // stored rows, exactly like pastPerformance above.
    const TOP_AUDIENCE_MIN_SPEND_MINOR = 50000n; // ৳500
    let topAudiences: { name: string; kind: string; spend: number; conversions: number; cpa: number; windowDays: number }[] = [];
    try {
      const rollups = p.audiencePerformanceRollup?.findMany ? await p.audiencePerformanceRollup.findMany({ where: { organizationId }, take: 200 }) : [];
      topAudiences = (rollups ?? [])
        .filter((r: any) => { try { return BigInt(r.spendMinor ?? 0) >= TOP_AUDIENCE_MIN_SPEND_MINOR; } catch { return false; } })
        .filter((r: any) => Number(r.conversions ?? 0) >= 1)
        .map((r: any) => {
          const spend = Number(BigInt(r.spendMinor ?? 0)) / 100;
          const conversions = Number(r.conversions ?? 0);
          return { name: String(r.name ?? ""), kind: String(r.audienceKind ?? ""), spend, conversions, cpa: Math.round((spend / conversions) * 100) / 100, windowDays: Number(r.windowDays ?? 90) };
        })
        .sort((a: any, b: any) => a.cpa - b.cpa)
        .slice(0, 3);
    } catch { topAudiences = []; }

    // CA9(c): top regions as FACTS, when stored breakdown
    // rows exist — the org's region rows aggregated with
    // the same stated minimums as the plan region view
    // (>= 2 stored rows AND >= 1 conversion per region).
    let topRegions: { region: string; divisionLabel: string | null; spend: number; conversions: number; cpa: number | null }[] = [];
    try {
      const brows = p.dailyAdBreakdown?.findMany ? await p.dailyAdBreakdown.findMany({ where: { organizationId, dimension: "region" }, take: 5000 }) : [];
      topRegions = CampaignsService.aggregateRegionRows(brows ?? [])
        .filter((r) => r.rows >= CampaignsService.REGION_MIN_ROWS && r.conversions >= 1)
        .slice(0, 3)
        .map((r) => ({ region: r.region, divisionLabel: r.divisionLabel, spend: r.spend, conversions: r.conversions, cpa: r.cpa }));
    } catch { topRegions = []; }

    // CA20: per-form lead quality as FACTS for lead
    // plans — the org's forms meeting the stated minimum
    // (CA20's >= 10 attributed leads), from real CRM rows
    // via leadFormQuality. (Forms carry no product link in
    // the schema, so these are org-level form facts —
    // stated as such, never dressed as product facts.)
    let leadFormFacts: { name: string; totalLeads: number; qualifiedRate: number | null; orderRate: number | null }[] = [];
    if (objective === "OUTCOME_LEADS") {
      try {
        const quality = await this.leadFormQuality(organizationId);
        leadFormFacts = (quality.forms ?? [])
          .filter((f: any) => !f.belowThreshold)
          .map((f: any) => ({ name: f.name, totalLeads: f.totalLeads, qualifiedRate: f.qualifiedRate, orderRate: f.orderRate }))
          .slice(0, 3);
      } catch { leadFormFacts = []; }
    }

    // CA27: winner-trait FACTS ride the same labelled-
    // facts discipline (CA7/CA9/CA20) — real A/B verdicts
    // + ad-level metrics, minimum-sample gated. Absent
    // traits mean NO line is added, never a guess.
    const winnerTraits = await this.winnerTraits(organizationId).catch(() => null);

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
        { role: "user", content: `Goal: ${dto.goal ?? "sales"}\nProduct: ${product?.name ?? "-"}\nPrice: ${price ?? "-"}\nCategory: ${product?.category ?? "-"}\nBusiness industry: ${profile?.industry ?? "-"}; brand voice: ${profile?.brandVoice ?? "-"}\nAd sets: ${split.map((s) => s.name).join(" | ")}${winnerTraits?.factsBn ? `\n${winnerTraits.factsBn}` : ""}` },
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
        topAudiences,
        topRegions,
        leadFormFacts,
        winnerTraits: winnerTraits ? { winnersConsidered: winnerTraits.winnersConsidered, traits: winnerTraits.traits, factsBn: winnerTraits.factsBn } : null,
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
    if (enabled && !["OUTCOME_SALES", "OUTCOME_APP_PROMOTION"].includes(plan.objective)) {
      throw new BadRequestException("Advantage+ runs on the Sales or App Promotion objectives: the plan objective must be OUTCOME_SALES or OUTCOME_APP_PROMOTION");
    }
    await (this.prisma as any).campaignPlan.update({ where: { id: planId }, data: { advantagePlus: enabled } });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.advantage_plus_set", entityType: "CampaignPlan", entityId: planId, metadata: { enabled } });
    return this.getPlanFull(organizationId, planId);
  }
}
