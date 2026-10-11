import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleInit, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { leaderClaim } from "../common/leader-claim";
import { PublishingService } from "../publishing/publishing.service";
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
export class CampaignsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly llm: LlmFactory,
    @Optional() private readonly publishing?: PublishingService,
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
      withAds.push({ ...adSet, dailyBudgetMinor: adSet.dailyBudgetMinor?.toString() ?? null, lifetimeBudgetMinor: adSet.lifetimeBudgetMinor?.toString() ?? null, ads });
    }
    const publishLogs = await (this.prisma as any).campaignPublishLog.findMany({ where: { planId }, orderBy: { createdAt: "desc" }, take: 50 });
    return { ...plan, dailyBudgetCapMinor: plan.dailyBudgetCapMinor?.toString() ?? null, adSets: withAds, publishLogs };
  }

  /** CB3 fix: plan money leaves the API as strings
   *  (a set cap is a BigInt — the raw row 500s JSON). */
  private planJson(p: any) {
    return { ...p, dailyBudgetCapMinor: p?.dailyBudgetCapMinor?.toString() ?? null };
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
      out.push({ ...this.planJson(p), adSetCount: adSets });
    }
    return out;
  }

  async getPlan(organizationId: string, planId: string) { return this.getPlanFull(organizationId, planId); }

  async updatePlan(organizationId: string, planId: string, dto: { name?: string; objective?: string; dailyBudgetCap?: string | null }) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    this.assertEditable(plan);
    if (dto.objective && !(OBJECTIVES as readonly string[]).includes(dto.objective)) throw new BadRequestException("Invalid objective");
    const data: any = { ...(dto.name ? { name: dto.name } : {}), ...(dto.objective ? { objective: dto.objective } : {}) };
    // CB2: plan-level daily budget cap (taka string in,
    // minor units stored; empty/null clears).
    if (dto.dailyBudgetCap !== undefined) {
      data.dailyBudgetCapMinor = dto.dailyBudgetCap ? parseMoneyToMinor(dto.dailyBudgetCap) : null;
    }
    await (this.prisma as any).campaignPlan.update({ where: { id: planId }, data });
    return this.getPlanFull(organizationId, planId);
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
    return { perAdSet, dailyTotalMinor: daily.toString(), lifetimeTotalMinor: lifetime.toString() };
  }

  /** CB2 guardrail: refuse when daily budgets exceed
   *  the plan's own cap. Enforced at submit + publish. */
  private assertWithinCap(full: any) {
    if (full.dailyBudgetCapMinor == null) return;
    const cap = BigInt(full.dailyBudgetCapMinor);
    let daily = 0n;
    for (const s of full.adSets ?? []) if (s.dailyBudgetMinor != null) daily += BigInt(s.dailyBudgetMinor);
    if (daily > cap) {
      throw new BadRequestException(`Plan daily budget cap exceeded: ad sets total ${daily.toString()} minor units per day, cap is ${cap.toString()}. Lower a budget or raise the cap.`);
    }
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
    if (full.dailyBudgetCapMinor != null) {
      const over = BigInt(budget.dailyTotalMinor) > BigInt(full.dailyBudgetCapMinor);
      push("budget", over ? "error" : "ok", "Budget Cap", over
        ? `দৈনিক মোট ${budget.dailyTotalMinor} > Cap ${String(full.dailyBudgetCapMinor)} (minor units) — Submit/Publish আটকাবে`
        : `দৈনিক মোট ${budget.dailyTotalMinor} ≤ Cap ${String(full.dailyBudgetCapMinor)} (minor units)`);
    } else {
      push("budget", "ok", "Budget", `দৈনিক মোট ${budget.dailyTotalMinor}, Lifetime মোট ${budget.lifetimeTotalMinor} (minor units) — কোনো Cap সেট নেই`);
    }

    let estimate: { available: boolean; reason?: string; lowerBound?: number; upperBound?: number; currency?: string } = { available: false, reason: "কোনো Ad Set নেই" };
    const firstSet = (full.adSets ?? [])[0];
    if (firstSet) {
      try {
        const { client, account: acc } = await this.publishClient(organizationId, full);
        const est = await client.deliveryEstimate(acc.externalId, {
          targeting: this.toGraphTargeting(firstSet.targeting ?? {}, full.advantagePlus === true),
          optimizationGoal: firstSet.optimizationGoal, currency: acc.currency ?? "BDT",
        });
        estimate = est.lowerBound != null || est.upperBound != null
          ? { available: true, lowerBound: est.lowerBound, upperBound: est.upperBound, currency: acc.currency ?? "BDT" }
          : { available: false, reason: "Meta কোনো Estimate ফেরত দেয়নি" };
      } catch (e) {
        estimate = { available: false, reason: e instanceof Error ? e.message.slice(0, 160) : "Meta Estimate পাওয়া যায়নি" };
      }
    }

    return { ready: !checks.some((c) => c.level === "error"), checks, budget, estimate };
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

  /** Build the stored targeting object from DTO fields,
   *  layering over an existing object on edits so a
   *  partial update never wipes untouched keys. */
  private buildTargeting(dto: {
    countries?: string[]; ageMin?: number; ageMax?: number; genders?: number[];
    interests?: string[]; customAudienceIds?: string[]; excludedAudienceIds?: string[];
    platforms?: string[]; positions?: string[]; devices?: string[];
  }, base?: any) {
    const t: any = { ...(base ?? {}) };
    if (dto.countries !== undefined) t.countries = dto.countries;
    if (dto.ageMin !== undefined) t.ageMin = dto.ageMin;
    if (dto.ageMax !== undefined) t.ageMax = dto.ageMax;
    if (dto.genders !== undefined) t.genders = dto.genders;
    for (const key of ["interests", "customAudienceIds", "excludedAudienceIds", "platforms", "positions", "devices"] as const) {
      if (dto[key] !== undefined) {
        if (dto[key]?.length) t[key] = dto[key];
        else delete t[key];
      }
    }
    return t;
  }

  async addAdSet(organizationId: string, planId: string, dto: {
    name: string; dailyBudget?: string; lifetimeBudget?: string; optimizationGoal: string;
    pageId?: string; pixelId?: string; countries: string[]; ageMin?: number; ageMax?: number; genders?: number[];
    interests?: string[]; customAudienceIds?: string[]; excludedAudienceIds?: string[];
    platforms?: string[]; positions?: string[]; devices?: string[];
    startTime?: string; endTime?: string;
  }) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    this.assertEditable(plan);
    if (!(OPTIMIZATION_GOALS as readonly string[]).includes(dto.optimizationGoal)) throw new BadRequestException("Invalid optimization goal");
    if (!dto.dailyBudget && !dto.lifetimeBudget) throw new BadRequestException("Either a daily or a lifetime budget is required");
    if (!dto.countries?.length) throw new BadRequestException("At least one target country is required");
    this.validatePlacements(dto);
    const adSet = await (this.prisma as any).campaignAdSet.create({
      data: {
        planId, name: dto.name,
        dailyBudgetMinor: dto.dailyBudget ? parseMoneyToMinor(dto.dailyBudget) : null,
        lifetimeBudgetMinor: dto.lifetimeBudget ? parseMoneyToMinor(dto.lifetimeBudget) : null,
        optimizationGoal: dto.optimizationGoal, pageId: dto.pageId ?? null, pixelId: dto.pixelId ?? null,
        targeting: this.buildTargeting({
          countries: dto.countries, ageMin: dto.ageMin ?? 18, ageMax: dto.ageMax ?? 65, genders: dto.genders ?? [0],
          interests: dto.interests, customAudienceIds: dto.customAudienceIds, excludedAudienceIds: dto.excludedAudienceIds,
          platforms: dto.platforms, positions: dto.positions, devices: dto.devices,
        }) as any,
        startTime: dto.startTime ? new Date(dto.startTime) : null,
        endTime: dto.endTime ? new Date(dto.endTime) : null,
      },
    });
    return { ...adSet, dailyBudgetMinor: adSet.dailyBudgetMinor?.toString() ?? null, lifetimeBudgetMinor: adSet.lifetimeBudgetMinor?.toString() ?? null };
  }

  /** CB1: edit an ad set in place (draft plans only).
   *  When either budget field is present the budget
   *  pair is replaced wholesale — send both to switch
   *  between daily and lifetime. */
  async updateAdSet(organizationId: string, planId: string, adSetId: string, actorId: string, dto: {
    name?: string; dailyBudget?: string; lifetimeBudget?: string; optimizationGoal?: string;
    pageId?: string; pixelId?: string; countries?: string[]; ageMin?: number; ageMax?: number; genders?: number[];
    interests?: string[]; customAudienceIds?: string[]; excludedAudienceIds?: string[];
    platforms?: string[]; positions?: string[]; devices?: string[];
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
    const targetingTouched = ["countries", "ageMin", "ageMax", "genders", "interests", "customAudienceIds", "excludedAudienceIds", "platforms", "positions", "devices"]
      .some((k) => (dto as any)[k] !== undefined);
    if (targetingTouched) data.targeting = this.buildTargeting(dto, adSet.targeting);
    if (dto.startTime !== undefined) data.startTime = dto.startTime ? new Date(dto.startTime) : null;
    if (dto.endTime !== undefined) data.endTime = dto.endTime ? new Date(dto.endTime) : null;
    const updated = await (this.prisma as any).campaignAdSet.update({ where: { id: adSetId }, data });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.adset_updated", entityType: "CampaignAdSet", entityId: adSetId, metadata: { fields: Object.keys(data) } }).catch(() => undefined);
    return { ...updated, dailyBudgetMinor: updated.dailyBudgetMinor?.toString() ?? null, lifetimeBudgetMinor: updated.lifetimeBudgetMinor?.toString() ?? null };
  }

  /** CB1: duplicate one ad set WITH its ads (drafts only). */
  async duplicateAdSet(organizationId: string, planId: string, adSetId: string, actorId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    this.assertEditable(plan);
    const src = await (this.prisma as any).campaignAdSet.findFirst({ where: { id: adSetId, planId }, include: { ads: true } });
    if (!src) throw new NotFoundException("Ad set not found in this plan");
    const copy = await (this.prisma as any).campaignAdSet.create({
      data: {
        planId, name: `${src.name} (কপি)`,
        dailyBudgetMinor: src.dailyBudgetMinor ?? undefined, lifetimeBudgetMinor: src.lifetimeBudgetMinor ?? undefined,
        billingEvent: src.billingEvent, optimizationGoal: src.optimizationGoal,
        pageId: src.pageId ?? undefined, pixelId: src.pixelId ?? undefined, targeting: src.targeting ?? {},
        startTime: src.startTime ?? undefined, endTime: src.endTime ?? undefined,
        daypart: src.daypart ?? undefined, daypartTz: src.daypartTz ?? undefined,
      },
    });
    for (const ad of src.ads ?? []) {
      await (this.prisma as any).campaignAd.create({
        data: {
          adSetId: copy.id, name: ad.name, primaryText: ad.primaryText, headline: ad.headline ?? undefined,
          description: ad.description ?? undefined, linkUrl: ad.linkUrl, callToAction: ad.callToAction,
          imageUrl: ad.imageUrl ?? undefined, productId: ad.productId ?? undefined,
          format: ad.format ?? "link", imageAssetId: ad.imageAssetId ?? undefined,
          videoAssetId: ad.videoAssetId ?? undefined, carouselCards: ad.carouselCards ?? undefined,
          createdByAi: ad.createdByAi ?? false,
        },
      });
    }
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.adset_duplicated", entityType: "CampaignAdSet", entityId: copy.id, metadata: { sourceAdSetId: adSetId } }).catch(() => undefined);
    const full = await (this.prisma as any).campaignAdSet.findFirst({ where: { id: copy.id }, include: { ads: true } });
    // Money leaves the API as strings (BigInt is not
    // JSON-serializable — the M75 lesson).
    return { ...full, dailyBudgetMinor: full.dailyBudgetMinor?.toString() ?? null, lifetimeBudgetMinor: full.lifetimeBudgetMinor?.toString() ?? null };
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
        createdByAi: src.createdByAi ?? false,
      },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.ad_duplicated", entityType: "CampaignAd", entityId: copy.id, metadata: { sourceAdId: adId } }).catch(() => undefined);
    return copy;
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
      adSets: (full.adSets ?? []).map((s: any) => ({
        name: s.name, dailyBudgetMinor: s.dailyBudgetMinor?.toString() ?? null,
        lifetimeBudgetMinor: s.lifetimeBudgetMinor?.toString() ?? null,
        optimizationGoal: s.optimizationGoal, pageId: s.pageId ?? null, pixelId: s.pixelId ?? null,
        targeting: s.targeting ?? {},
        ads: (s.ads ?? []).map((a: any) => ({
          name: a.name, primaryText: a.primaryText, headline: a.headline ?? null,
          description: a.description ?? null, linkUrl: a.linkUrl, callToAction: a.callToAction,
          format: a.format ?? "link", imageAssetId: a.imageAssetId ?? null,
          videoAssetId: a.videoAssetId ?? null, imageUrl: a.imageUrl ?? null,
          carouselCards: a.carouselCards ?? null,
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
    await (this.prisma as any).campaignPlan.update({ where: { id: planId }, data: { status: "pending_approval", rejectionReason: null, submissionSnapshot: snapshot } });
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

  /** CB4: plan comments (the approval conversation). */
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
    return (rows as any[]).map((r) => ({ ...r, authorName: nameOf.get(r.authorId) ?? r.authorId }));
  }

  async addComment(organizationId: string, planId: string, authorId: string, body: string) {
    await this.getPlanOrThrow(organizationId, planId);
    const text = String(body ?? "").trim();
    if (!text) throw new BadRequestException("Comment cannot be empty");
    const row = await (this.prisma as any).campaignPlanComment.create({
      data: { organizationId, planId, authorId, body: text.slice(0, 2000) },
    });
    await this.audit.log({ organizationId, userId: authorId, action: "campaign.comment", entityType: "CampaignPlan", entityId: planId }).catch(() => undefined);
    return row;
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

  async approve(organizationId: string, actorId: string, planId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    if (plan.status !== "pending_approval") throw new BadRequestException(`Only pending_approval plans can be approved (current: ${plan.status})`);
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
      where: { id: planId }, data: { status: "rejected", rejectionReason: reason.slice(0, 500) },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "campaign.rejected", entityType: "CampaignPlan", entityId: planId, metadata: { reason } });
    if (plan.createdById && plan.createdById !== actorId) {
      await this.notifyUsers(organizationId, [plan.createdById], "campaign_rejected", "↩️ Campaign এ পরিবর্তন চাওয়া হয়েছে", `"${plan.name}" প্রত্যাখ্যাত: ${reason.slice(0, 200)} — Draft এ ঠিক করে আবার পাঠান।`);
    }
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
  async planPerformance(organizationId: string, planId: string) {
    const plan = await this.getPlanOrThrow(organizationId, planId);
    const full = await this.getPlanFull(organizationId, planId);
    if (!plan.externalCampaignId) {
      return { published: false, totals: null, perAdSet: [], daily: [] };
    }
    const rows = await (this.prisma as any).dailyAdMetric.findMany({
      where: { organizationId, campaignExternalId: plan.externalCampaignId }, take: 10000,
    }).catch(() => []);
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
    const credits = await (this.prisma as any).attributionCredit?.findMany?.({ where: { organizationId }, take: 10000 })?.catch?.(() => []) ?? [];
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
  async crossPlatformDraft(organizationId: string, planId: string, actorId: string, dto: { platform: string; targetAdAccountId: string }) {
    if (!["google", "tiktok"].includes(dto.platform)) throw new BadRequestException("platform must be google or tiktok");
    if (!this.publishing) throw new BadRequestException("Cross-platform publishing is not available in this context");
    const plan = await this.getPlanOrThrow(organizationId, planId);
    if (!["approved", "published", "publish_failed"].includes(plan.status)) {
      throw new BadRequestException(`Cross-platform drafts need an approved plan (current: ${plan.status})`);
    }
    const account = await (this.prisma as any).adAccount.findFirst({ where: { id: dto.targetAdAccountId, organizationId } });
    if (!account) throw new BadRequestException("Target ad account not found in this organization");
    if (account.platform !== dto.platform) throw new BadRequestException(`Target account is a ${account.platform} account, not ${dto.platform}`);
    const full = await this.getPlanFull(organizationId, planId);
    const totals = this.budgetTotals(full);
    const dailyTaka = (Number(BigInt(totals.dailyTotalMinor)) / 100).toFixed(2);
    const countries = [...new Set((full.adSets ?? []).flatMap((s: any) => (s.targeting?.countries ?? []) as string[]))];
    const allAds = (full.adSets ?? []).flatMap((s: any) => s.ads ?? []);
    const interests = [...new Set((full.adSets ?? []).flatMap((s: any) => (s.targeting?.interests ?? []) as string[]))];
    const unmapped: string[] = [];
    const transformations: string[] = [];
    if (BigInt(totals.dailyTotalMinor) <= 0n) unmapped.push("দৈনিক বাজেট নেই — দুই প্ল্যাটফর্মই দৈনিক বাজেট চায় (Plan এ শুধু Lifetime আছে)");
    if (!countries.length) unmapped.push("কোনো Target দেশ নেই");
    const firstUrl = allAds.find((a: any) => a.linkUrl)?.linkUrl;
    if (!firstUrl) unmapped.push("কোনো Ad এর Link URL নেই");

    let mapped: any = null;
    if (dto.platform === "google") {
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
      mapped = { adAccountId: dto.targetAdAccountId, name: plan.name, dailyBudget: dailyTaka, countryCodes: countries, adText, landingUrl: firstUrl, imageUrl };
    }

    if (unmapped.length) {
      return { status: "blocked", platform: dto.platform, mapped, unmapped, transformations, note: "কিছু তথ্য Map করা যায়নি — Publish ডাকা হয়নি। এই Payload টি Export Package: ঘাটতি পূরণ করে আবার চেষ্টা করুন।" };
    }
    const record = dto.platform === "google"
      ? await this.publishing.publishGoogle(organizationId, actorId, mapped)
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
    return { status: created ? "created" : "failed", platform: dto.platform, publication: record, mapped, unmapped, transformations };
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
