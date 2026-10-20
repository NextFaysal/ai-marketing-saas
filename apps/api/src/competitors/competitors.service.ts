import { ensurePlatformConfig, getPlatformConfigSync } from "../common/platform-config";
import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { decryptJson } from "../integrations/crypto";
import { AdLibraryClient } from "./ad-library.client";
import { WebsiteScanner } from "./website-scanner";
import { MultiPlatformScanner } from "./multi-platform-scanner";
import { SeoOnPageAuditor } from "./seo-analyzer";
import { VideoScriptDeconstructor } from "./video-deconstructor";
import { ReviewMiner } from "./review-miner";
import { FunnelAuditor } from "./funnel-auditor";
import { RulesEngine, DynamicPricingRule, RuleEvaluationResult } from "./rules-engine";
import { AlertDispatcher, AlertChannelConfig, AlertNotificationPayload } from "./alert-dispatcher";
import { DeconstructVideoScriptDto, ConfigureAlertSettingsDto, TestAlertChannelDto, SaveDynamicRulesDto, SimulateRuleTriggerDto } from "./competitors.dto";
import { LlmFactory } from "../ai/llm/llm.factory";
import { parseMoneyToMinor, formatMinor } from "@repo/contracts";
import { badRequest, notFound } from "../i18n/api-exception";







interface EvidenceRef { ref: string; label: string; url?: string }

@Injectable()
export class CompetitorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly llm: LlmFactory,
  ) {}

  // ----- CRUD -----
  async create(organizationId: string, actorId: string, dto: { name: string; facebookPageId?: string; facebookPageUrl?: string; websiteUrl?: string; notes?: string }) {
    const competitor = await (this.prisma as any).competitor.create({
      data: { organizationId, name: dto.name, facebookPageId: dto.facebookPageId ?? null, facebookPageUrl: dto.facebookPageUrl ?? null, websiteUrl: dto.websiteUrl ?? null, notes: dto.notes ?? null },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "competitor.created", entityType: "Competitor", entityId: competitor.id });
    return competitor;
  }

  async list(organizationId: string) {
    const items = await (this.prisma as any).competitor.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });
    const out = [];
    for (const c of items) {
      const [ads, activeAds, observations] = await Promise.all([
        (this.prisma as any).competitorAd.count({ where: { competitorId: c.id } }),
        (this.prisma as any).competitorAd.count({ where: { competitorId: c.id, isActive: true } }),
        (this.prisma as any).competitorPriceObservation.count({ where: { competitorId: c.id } }),
      ]);
      out.push({ ...c, stats: { ads, activeAds, priceObservations: observations } });
    }
    return out;
  }

  private async getOrThrow(organizationId: string, competitorId: string) {
    const c = await (this.prisma as any).competitor.findFirst({ where: { id: competitorId, organizationId } });
    if (!c) throw notFound("competitors.competitorNotFoundInThisOrganization");
    return c;
  }

  async update(organizationId: string, competitorId: string, dto: Record<string, unknown>) {
    await this.getOrThrow(organizationId, competitorId);
    const data: Record<string, unknown> = {};
    for (const key of ["name", "facebookPageId", "facebookPageUrl", "websiteUrl", "notes"]) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }
    return (this.prisma as any).competitor.update({ where: { id: competitorId }, data });
  }

  async remove(organizationId: string, competitorId: string) {
    await this.getOrThrow(organizationId, competitorId);
    await (this.prisma as any).competitor.delete({ where: { id: competitorId } });
    return { deleted: true };
  }

  // ----- Automated 24/7 Background Sync Scheduler -----
  async scheduleAutoSync(organizationId: string, actorId: string, competitorId: string) {
    const competitor = await this.getOrThrow(organizationId, competitorId);
    const existingJob = await (this.prisma as any).scheduledJob.findFirst({
      where: {
        organizationId,
        type: "competitor_multi_sync",
        targetId: competitorId,
      },
    });

    if (existingJob) {
      // Toggle enable/disable
      const updated = await (this.prisma as any).scheduledJob.update({
        where: { id: existingJob.id },
        data: { enabled: !existingJob.enabled },
      });
      return {
        enabled: updated.enabled,
        message: updated.enabled
          ? `24/7 অটো-সিঙ্ক চালু করা হয়েছে (প্রতি দিন রাতে অটো আপডেট হবে)`
          : `অটো-সিঙ্ক বন্ধ করা হয়েছে`,
      };
    }

    // Create new daily cron job (intervalMinutes: 1440 = 24 hours)
    const newJob = await (this.prisma as any).scheduledJob.create({
      data: {
        organizationId,
        name: `Daily Multi-Platform Sync (${competitor.name})`,
        type: "competitor_multi_sync",
        targetId: competitorId,
        intervalMinutes: 1440,
        enabled: true,
        nextRunAt: new Date(Date.now() + 1440 * 60000),
        createdById: actorId,
      },
    });

    await this.audit.log({
      organizationId,
      userId: actorId,
      action: "competitor.autosync_scheduled",
      entityType: "ScheduledJob",
      entityId: newJob.id,
      metadata: { competitorName: competitor.name },
    });

    return {
      enabled: true,
      message: `24/7 অটো-সিঙ্ক চালু করা হয়েছে (প্রতি দিন রাতে অটো আপডেট হবে)`,
    };
  }


  // ----- Ad Library sync -----
  private async resolveAdLibraryToken(organizationId: string): Promise<string> {
    // Dynamic platform config first (Milestone 33): the token the
    // operator set in the Admin Console, then env, then the org's
    // own connected Meta token.
    await ensurePlatformConfig(this.prisma).catch(() => undefined);
    const platformToken = getPlatformConfigSync().metaApp?.adLibraryToken;
    if (platformToken) return platformToken;
    if (process.env.FACEBOOK_AD_LIBRARY_TOKEN) return process.env.FACEBOOK_AD_LIBRARY_TOKEN;
    const integration = await (this.prisma as any).integration.findFirst({
      where: { organizationId, provider: "meta", status: "CONNECTED" },
      orderBy: { createdAt: "desc" }, include: { credential: true },
    });
    if (integration?.credential) {
      const secrets = decryptJson<{ accessToken: string }>(integration.credential.encryptedData);
      if (secrets.accessToken) return secrets.accessToken;
    }
    throw badRequest("competitors.noAdLibraryAccessTokenAvailable");
  }

  async syncAds(organizationId: string, actorId: string, competitorId: string, opts: { countries?: string[]; activeOnly?: boolean } = {}) {
    const competitor = await this.getOrThrow(organizationId, competitorId);
    const token = await this.resolveAdLibraryToken(organizationId);
    const client = new AdLibraryClient(token);
    const ads = await client.searchAds({
      pageId: competitor.facebookPageId ?? undefined,
      searchTerms: competitor.facebookPageId ? undefined : competitor.name,
      countries: opts.countries?.length ? opts.countries : ["BD"],
      activeOnly: opts.activeOnly !== false,
    });
    let created = 0, updated = 0;
    for (const ad of ads) {
      const existing = await (this.prisma as any).competitorAd.findFirst({
        where: { competitorId, externalAdId: ad.externalAdId },
      });
      const data = {
        pageId: ad.pageId ?? null, pageName: ad.pageName ?? null,
        startedAt: ad.startedAt ?? null, stoppedAt: ad.stoppedAt ?? null,
        isActive: ad.isActive, platforms: ad.platforms,
        creativeText: ad.creativeText ?? null, linkUrl: ad.linkUrl ?? null,
        snapshotUrl: ad.snapshotUrl ?? null, raw: ad.raw as any, lastSeenAt: new Date(),
      };
      if (existing) {
        await (this.prisma as any).competitorAd.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await (this.prisma as any).competitorAd.create({ data: { competitorId, externalAdId: ad.externalAdId, ...data } });
        created++;
      }
    }
    await this.audit.log({ organizationId, userId: actorId, action: "competitor.ads_synced", entityType: "Competitor", entityId: competitorId, metadata: { fetched: ads.length, created, updated } });
    // Note: ads missing from this response are NOT marked stopped - with an
    // ACTIVE filter and pagination caps, absence is not proof of stopping.
    return { fetched: ads.length, created, updated };
  }

  // ----- Multi-Platform Sync (Facebook, Google, TikTok, Bing) -----
  async syncMultiPlatform(
    organizationId: string,
    actorId: string,
    competitorId: string,
    opts: { platforms?: ("facebook" | "google" | "tiktok" | "bing")[]; countries?: string[]; activeOnly?: boolean } = {}
  ) {
    const competitor = await this.getOrThrow(organizationId, competitorId);
    const targetPlatforms = opts.platforms?.length
      ? opts.platforms
      : (["facebook", "google", "tiktok", "bing"] as const);

    let totalFetched = 0;
    let totalCreated = 0;
    let totalUpdated = 0;
    const platformBreakdown: Record<string, number> = {};
    // HF1: platforms that produced nothing report WHY, in words, instead
    // of silently counting zero — and never contribute fabricated rows.
    const unavailable: Record<string, string> = {};

    // 1. Meta / Facebook (if selected)
    if (targetPlatforms.includes("facebook")) {
      try {
        const metaRes = await this.syncAds(organizationId, actorId, competitorId, {
          countries: opts.countries,
          activeOnly: opts.activeOnly,
        });
        totalFetched += metaRes.fetched;
        totalCreated += metaRes.created;
        totalUpdated += metaRes.updated;
        platformBreakdown.facebook = metaRes.fetched;
      } catch (e) {
        platformBreakdown.facebook = 0;
        unavailable.facebook = "Meta Ad Library sync সম্পন্ন হয়নি (টোকেন/সংযোগ যাচাই করুন)";
      }
    }

    // Domain extraction for search engines
    let domain: string | undefined;
    if (competitor.websiteUrl) {
      try {
        domain = new URL(competitor.websiteUrl).hostname.replace(/^www\./, "");
      } catch {
        // ignore
      }
    }

    const scanner = new MultiPlatformScanner();
    const otherAds: any[] = [];

    // 2. Google organic search results (real fetch, honestly labeled —
    // these are search results, not ads; see MultiPlatformScanner HF1 note)
    if (targetPlatforms.includes("google")) {
      const gAds = await scanner.scanGoogleAds(competitor.name, domain);
      otherAds.push(...gAds);
      platformBreakdown.google = gAds.length;
      if (gAds.length === 0) {
        unavailable.google = "কোনো সার্চ ফলাফল পাওয়া যায়নি";
      }
    }

    // 3. TikTok: no official public data source is wired — the scanner
    // returns [] by design; report the platform as unavailable.
    if (targetPlatforms.includes("tiktok")) {
      const ttAds = await scanner.scanTikTokAds(competitor.name);
      otherAds.push(...ttAds);
      platformBreakdown.tiktok = ttAds.length;
      unavailable.tiktok = "কোনো অফিসিয়াল public data source যুক্ত নেই";
    }

    // 4. Bing: same as TikTok — no source wired, nothing is invented.
    if (targetPlatforms.includes("bing")) {
      const bingAds = await scanner.scanBingAds(competitor.name, domain);
      otherAds.push(...bingAds);
      platformBreakdown.bing = bingAds.length;
      unavailable.bing = "কোনো অফিসিয়াল public data source যুক্ত নেই";
    }

    // Store non-Meta ads safely into CompetitorAd
    for (const ad of otherAds) {
      totalFetched++;
      const existing = await (this.prisma as any).competitorAd.findFirst({
        where: { competitorId, externalAdId: ad.externalAdId },
      });
      const data = {
        pageId: null,
        pageName: ad.pageName ?? null,
        startedAt: ad.startedAt ?? null,
        stoppedAt: ad.stoppedAt ?? null,
        isActive: ad.isActive,
        platforms: ad.platforms,
        creativeText: ad.creativeText ?? null,
        linkUrl: ad.linkUrl ?? null,
        snapshotUrl: ad.snapshotUrl ?? null,
        raw: ad.raw as any,
        lastSeenAt: new Date(),
      };
      if (existing) {
        await (this.prisma as any).competitorAd.update({ where: { id: existing.id }, data });
        totalUpdated++;
      } else {
        await (this.prisma as any).competitorAd.create({
          data: { competitorId, externalAdId: ad.externalAdId, ...data },
        });
        totalCreated++;
      }
    }

    await this.audit.log({
      organizationId,
      userId: actorId,
      action: "competitor.multi_platform_synced",
      entityType: "Competitor",
      entityId: competitorId,
      metadata: { totalFetched, totalCreated, totalUpdated, platformBreakdown, unavailable },
    });

    return {
      fetched: totalFetched,
      created: totalCreated,
      updated: totalUpdated,
      breakdown: platformBreakdown,
      unavailable,
    };
  }


  async listAds(organizationId: string, competitorId: string) {
    await this.getOrThrow(organizationId, competitorId);
    const ads = await (this.prisma as any).competitorAd.findMany({
      where: { competitorId }, orderBy: { startedAt: "desc" }, take: 100,
    });
    const now = Date.now();
    return ads.map((a: any) => {
      const started = a.startedAt ? new Date(a.startedAt).getTime() : null;
      const stopped = a.stoppedAt ? new Date(a.stoppedAt).getTime() : null;
      const daysRunning = started ? Math.max(1, Math.round(((stopped || now) - started) / (1000 * 60 * 60 * 24))) : 0;
      // "Winning" = active and running for at least 14 days. This is a
      // longevity signal from the ad's real archive dates, not proof of
      // ROI. Rows without a real startedAt (e.g. Google organic search
      // results persisted by syncMultiPlatform) get daysRunning 0 and can
      // never be "winning" (HF7 trace).
      const isWinning = a.isActive && daysRunning >= 14;
      const isFresh = a.isActive && daysRunning <= 3;
      return {
        ...a,
        raw: undefined,
        daysRunning,
        isWinning,
        isFresh,
      };
    });
  }

  // ----- AI Counter-Ad & Strategy Generator -----
  async generateCounterAd(
    organizationId: string,
    actorId: string,
    dto: { competitorAdId: string; ownProductId?: string; tone?: string }
  ) {
    const ad = await (this.prisma as any).competitorAd.findFirst({
      where: { id: dto.competitorAdId },
    });
    if (!ad) throw notFound("competitors.competitorAdNotFound");
    const adCompetitor = await (this.prisma as any).competitor.findFirst({
      where: { id: ad.competitorId },
    });
    if (!adCompetitor || adCompetitor.organizationId !== organizationId) {
      throw notFound("competitors.adDoesNotBelongToThis");
    }

    let ownProduct: any = null;
    if (dto.ownProductId) {
      ownProduct = await (this.prisma as any).product.findFirst({
        where: { id: dto.ownProductId, organizationId },
      });
    } else {
      // Pick the first active product as default context if available
      ownProduct = await (this.prisma as any).product.findFirst({
        where: { organizationId, status: "ACTIVE" },
      });
    }

    const provider = this.llm.getProvider();
    const competitorCreative = ad.creativeText || "No text available";
    const competitorName = adCompetitor.name;
    const daysRunning = ad.startedAt
      ? Math.max(1, Math.round((Date.now() - new Date(ad.startedAt).getTime()) / (1000 * 60 * 60 * 24)))
      : 1;

    let strategyResult: {
      hookBreakdown: { hookType: string; competitorAngle: string; weaknesses: string[] };
      counterCampaign: {
        headline: string;
        primaryText: string;
        callToAction: string;
        suggestedOffer: string;
        whyThisBeatsCompetitor: string;
      };
    };
    // HF5: the UI badges the output as a draft with its origin.
    let origin: "ai" | "template" = "template";

    if (provider.isRealLlm) {
      const prompt = `You are a world-class direct-response ecommerce copywriter and growth marketer.
Analyze this competitor's ad and generate an unstoppable counter-ad campaign for our brand that beats theirs.

Competitor Name: ${competitorName}
Days Running (Lifespan): ${daysRunning} days (Status: ${ad.isActive ? "ACTIVE" : "STOPPED"})
Competitor Ad Creative Text:
"""
${competitorCreative}
"""

Our Product Context:
${ownProduct ? `Product: ${ownProduct.name}, Price: ${formatMinor(BigInt(ownProduct.priceMinor), ownProduct.currency)}, Currency: ${ownProduct.currency}` : "Our general ecommerce store"}
Tone: ${dto.tone || "High-converting, authentic, persuasive with urgent value"}

Return strictly valid JSON with this format:
{
  "hookBreakdown": {
    "hookType": "e.g. FOMO / Pain-point / Social Proof / Direct Offer",
    "competitorAngle": "Short breakdown of what angle they are pushing",
    "weaknesses": ["Weakness 1 of competitor's angle", "Weakness 2"]
  },
  "counterCampaign": {
    "headline": "A punchy, superior headline (e.g. in Bangla/English based on context)",
    "primaryText": "Complete high-converting primary text for Facebook/Instagram ads addressing the weaknesses",
    "callToAction": "Shop Now / Order Now",
    "suggestedOffer": "e.g. Free Delivery or Bundle Offer to outvalue them",
    "whyThisBeatsCompetitor": "Explanation of psychological edge over the competitor's ad"
  }
}`;

      const res = await provider.complete([
        { role: "system", content: "You output JSON only." },
        { role: "user", content: prompt }
      ], { jsonMode: true, maxTokens: 1500 });

      try {
        strategyResult = JSON.parse(res.text);
        origin = "ai";
      } catch {
        strategyResult = this.fallbackCounterAd(competitorName, competitorCreative, ownProduct);
      }

      await (this.prisma as any).aIUsageRecord.create({
        data: {
          organizationId,
          userId: actorId,
          feature: "competitor_counter_ad",
          provider: provider.name,
          inputTokens: res.inputTokens,
          outputTokens: res.outputTokens,
          estimated: res.tokensEstimated,
        },
      });
    } else {
      strategyResult = this.fallbackCounterAd(competitorName, competitorCreative, ownProduct);
    }

    await this.audit.log({
      organizationId,
      userId: actorId,
      action: "competitor.counter_ad_generated",
      entityType: "CompetitorAd",
      entityId: ad.id,
      metadata: { competitorName, ownProductId: ownProduct?.id },
    });

    return { ...strategyResult, origin };
  }

  private fallbackCounterAd(competitorName: string, competitorCreative: string, ownProduct: any) {
    const prodName = ownProduct?.name || "আমাদের প্রিমিয়াম প্রোডাক্ট";
    return {
      hookBreakdown: {
        hookType: "Direct Offer & Problem Resolution",
        competitorAngle: `${competitorName} মূলত সাধারণ ডিসকাউন্ট ও সাধারণ সুবিধার ওপর জোর দিচ্ছে।`,
        weaknesses: [
          "ক্লিয়ার কোয়ালিটি গ্যারান্টি বা ট্রাস্ট ফ্যাক্টরের অভাব",
          "কাস্টমারের নির্দিষ্ট সমস্যার সরাসরি সমাধান স্পষ্ট করা হয়নি"
        ]
      },
      counterCampaign: {
        headline: `🔥 সেরা কোয়ালিটিতে ${prodName} - ক্যাশ অন ডেলিভারি ও দ্রুত শিপিং!`,
        primaryText: `অন্যান্য ব্র্যান্ডের নিম্নমানের পণ্য নিয়ে ভাবছেন? \n\n${competitorName}-এর চেয়ে ১০০% জেনুইন ও দীর্ঘস্থায়ী ${prodName} নিয়ে এলো আমাদের ব্র্যান্ড। দেখে শুনে মূল্য পরিশোধের সুবিধা সহ সারা বাংলাদেশে ফ্রি হোম ডেলিভারি!\n\nসীমিত সময়ের জন্য অফারটি লুফে নিন।`,
        callToAction: "অর্ডার করুন এখনই",
        suggestedOffer: "ফ্রি ডেলিভারি + ৭ দিনের রিটার্ন গ্যারান্টি",
        whyThisBeatsCompetitor: "প্রতিযোগীর চেয়ে বেশি ট্রাস্ট ফ্যাক্টর, ঝুঁকিহীন ক্যাশ অন ডেলিভারি এবং দ্রুত সিদ্ধান্তের জন্য জরুরি অফার সাজানো হয়েছে।"
      }
    };
  }


  // ----- Website scan + live price drop & stockout alerts -----
  async scanWebsite(organizationId: string, actorId: string, competitorId: string) {
    const competitor = await this.getOrThrow(organizationId, competitorId);
    if (!competitor.websiteUrl) throw badRequest("competitors.thisCompetitorHasNoWebsiteUrl");
    const scan = await new WebsiteScanner().scan(competitor.websiteUrl);
    let stored = 0;
    const generatedAlerts: string[] = [];

    for (const product of scan.products) {
      // Check previous observation to detect Price Drop
      const lastObs = await (this.prisma as any).competitorPriceObservation.findFirst({
        where: { competitorId, productName: product.name },
        orderBy: { observedAt: "desc" },
      });

      const currentPriceMinor = BigInt(product.priceMinor);
      const newObs = await (this.prisma as any).competitorPriceObservation.create({
        data: {
          competitorId,
          productName: product.name,
          priceMinor: currentPriceMinor,
          currency: product.currency,
          sourceUrl: product.url,
          sourceType: "website_scan",
        },
      });
      stored++;

      // 1. Live Price Drop Alert
      if (lastObs && BigInt(lastObs.priceMinor) > currentPriceMinor) {
        const dropPercent = Number(
          ((BigInt(lastObs.priceMinor) - currentPriceMinor) * 100n) / BigInt(lastObs.priceMinor)
        );
        if (dropPercent >= 5) {
          const alertTitle = `🚨 Price Drop: ${competitor.name} dropped "${product.name}" price by ${dropPercent}%!`;
          const alertDetail = `Old Price: ${formatMinor(BigInt(lastObs.priceMinor), lastObs.currency)} ➔ New Price: ${formatMinor(currentPriceMinor, product.currency)}. Competitor is getting aggressive on this item.`;
          await (this.prisma as any).competitorInsight.create({
            data: {
              organizationId,
              competitorId,
              kind: "pricing",
              title: alertTitle,
              detail: alertDetail,
              evidence: [
                { ref: `price:${newObs.id}`, label: `${competitor.name}: ${product.name} at ${formatMinor(currentPriceMinor, product.currency)}`, url: product.url },
              ],
              provider: "alert-engine",
            },
          });
          generatedAlerts.push(alertTitle);
        }
      }

      // 2. Out-of-Stock Opportunity Alert
      if (!product.inStock) {
        const alertTitle = `🔥 Stock-Out Opportunity: ${competitor.name} is OUT OF STOCK on "${product.name}"!`;
        const alertDetail = `Competitor has run out of stock for this high-demand product. Highly recommended: Increase your ad spend or run a counter-offer on your matching inventory to capture their buyers!`;
        await (this.prisma as any).competitorInsight.create({
          data: {
            organizationId,
            competitorId,
            kind: "activity",
            title: alertTitle,
            detail: alertDetail,
            evidence: [
              { ref: `price:${newObs.id}`, label: `${competitor.name}: ${product.name} (Stock-Out)`, url: product.url },
            ],
            provider: "alert-engine",
          },
        });
        generatedAlerts.push(alertTitle);
      }
    }

    await this.audit.log({
      organizationId,
      userId: actorId,
      action: "competitor.website_scanned",
      entityType: "Competitor",
      entityId: competitorId,
      metadata: { scannedUrls: scan.scannedUrls, stored, alertsGenerated: generatedAlerts.length },
    });

    return {
      scannedUrls: scan.scannedUrls,
      found: scan.products.length,
      stored,
      skippedByRobots: scan.skippedByRobots,
      errors: scan.errors,
      alerts: generatedAlerts,
    };
  }

  async getAlertsFeed(organizationId: string) {
    return (this.prisma as any).competitorInsight.findMany({
      where: {
        organizationId,
        provider: "alert-engine",
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
  }


  async addObservation(organizationId: string, competitorId: string, dto: { productName: string; price: string; currency?: string; sourceUrl: string }) {
    await this.getOrThrow(organizationId, competitorId);
    if (!dto.sourceUrl || !/^https?:\/\//i.test(dto.sourceUrl)) {
      throw badRequest("competitors.aSourceUrlIsRequiredAs");
    }
    const obs = await (this.prisma as any).competitorPriceObservation.create({
      data: {
        competitorId, productName: dto.productName, priceMinor: parseMoneyToMinor(dto.price),
        currency: dto.currency ?? "BDT", sourceUrl: dto.sourceUrl, sourceType: "manual",
      },
    });
    return { ...obs, priceMinor: String(obs.priceMinor) };
  }

  async listObservations(organizationId: string, competitorId: string) {
    await this.getOrThrow(organizationId, competitorId);
    const items = await (this.prisma as any).competitorPriceObservation.findMany({
      where: { competitorId }, orderBy: { observedAt: "desc" }, take: 100,
    });
    return items.map((o: any) => ({ ...o, priceMinor: String(o.priceMinor) }));
  }

  // ----- Price comparison (evidence-linked, honest about gaps) -----
  async priceComparison(organizationId: string) {
    const [ownProducts, competitors] = await Promise.all([
      (this.prisma as any).product.findMany({ where: { organizationId, status: "ACTIVE" }, take: 200 }),
      (this.prisma as any).competitor.findMany({ where: { organizationId } }),
    ]);
    const rows = [];
    for (const product of ownProducts) {
      const competitorPrices: any[] = [];
      for (const competitor of competitors) {
        const observations = await (this.prisma as any).competitorPriceObservation.findMany({
          where: { competitorId: competitor.id }, orderBy: { observedAt: "desc" }, take: 100,
        });
        const match = observations
          .map((o: any) => ({ obs: o, score: nameMatchScore(product.name, o.productName) }))
          .filter((m: any) => m.score > 0)
          .sort((a: any, b: any) => b.score - a.score || b.obs.observedAt - a.obs.observedAt)[0];
        if (!match) continue;
        const obs = match.obs;
        const sameCurrency = obs.currency === product.currency;
        const diffPercent = sameCurrency && BigInt(product.priceMinor) > 0n
          ? Number(((BigInt(obs.priceMinor) - BigInt(product.priceMinor)) * 10000n) / BigInt(product.priceMinor)) / 100
          : null;
        competitorPrices.push({
          competitorId: competitor.id, competitorName: competitor.name,
          observedProductName: obs.productName, priceMinor: String(obs.priceMinor), currency: obs.currency,
          diffPercent, sameCurrency, observedAt: obs.observedAt, sourceUrl: obs.sourceUrl, sourceType: obs.sourceType, observationId: obs.id,
        });
      }
      rows.push({
        productId: product.id, productName: product.name,
        ownPriceMinor: String(product.priceMinor), currency: product.currency,
        competitorPrices,
      });
    }
    return { rows };
  }

  // ----- Insights: evidence is enforced, not requested -----
  private async buildEvidenceBundle(organizationId: string, competitorId?: string) {
    const competitors = competitorId
      ? [await this.getOrThrow(organizationId, competitorId)]
      : await (this.prisma as any).competitor.findMany({ where: { organizationId } });
    const refs: EvidenceRef[] = [];
    const facts: any[] = [];
    for (const competitor of competitors) {
      const [ads, observations] = await Promise.all([
        (this.prisma as any).competitorAd.findMany({ where: { competitorId: competitor.id }, orderBy: { startedAt: "asc" }, take: 100 }),
        (this.prisma as any).competitorPriceObservation.findMany({ where: { competitorId: competitor.id }, orderBy: { observedAt: "desc" }, take: 50 }),
      ]);
      for (const ad of ads) {
        refs.push({ ref: `ad:${ad.id}`, label: `${competitor.name} ad (started ${ad.startedAt ? new Date(ad.startedAt).toISOString().slice(0, 10) : "unknown"}, ${ad.isActive ? "active" : "stopped"})`, url: ad.snapshotUrl ?? undefined });
      }
      for (const obs of observations) {
        refs.push({ ref: `price:${obs.id}`, label: `${competitor.name}: ${obs.productName} at ${formatMinor(BigInt(obs.priceMinor), obs.currency)} (observed ${new Date(obs.observedAt).toISOString().slice(0, 10)})`, url: obs.sourceUrl });
      }
      const active = ads.filter((a: any) => a.isActive);
      const longestRunning = active.length ? active.reduce((a: any, b: any) => (new Date(a.startedAt ?? 0) < new Date(b.startedAt ?? 0) ? a : b)) : null;
      facts.push({
        competitorId: competitor.id, competitorName: competitor.name,
        totalAdsSeen: ads.length, activeAds: active.length,
        longestRunningActiveAd: longestRunning ? { ref: `ad:${longestRunning.id}`, startedAt: longestRunning.startedAt, creativeText: longestRunning.creativeText?.slice(0, 300) } : null,
        latestPrices: observations.slice(0, 10).map((o: any) => ({ ref: `price:${o.id}`, productName: o.productName, price: formatMinor(BigInt(o.priceMinor), o.currency), observedAt: o.observedAt })),
      });
    }
    const comparison = await this.priceComparison(organizationId);
    const priceGaps = comparison.rows.flatMap((row: any) =>
      row.competitorPrices.map((cp: any) => ({ productName: row.productName, competitor: cp.competitorName, diffPercent: cp.diffPercent, sourceUrl: cp.sourceUrl, ref: `price:${cp.observationId}` })));
    return { refs, facts, priceGaps };
  }

  async generateInsights(organizationId: string, actorId: string, competitorId?: string) {
    const bundle = await this.buildEvidenceBundle(organizationId, competitorId);
    if (bundle.refs.length === 0) {
      throw badRequest("competitors.noCompetitorEvidenceCollectedYetSync");
    }
    const provider = this.llm.getProvider();
    const validRefs = new Set(bundle.refs.map((r) => r.ref));
    const refById = new Map(bundle.refs.map((r) => [r.ref, r]));
    let candidates: { kind: string; title: string; detail?: string; evidenceRefs: string[] }[] = [];

    if (provider.isRealLlm) {
      const result = await provider.complete([
        { role: "system", content: "You analyze competitor activity for an ecommerce business using ONLY the evidence bundle provided. Every insight MUST cite at least one evidence ref id from the bundle (copy the ids exactly). Do not estimate ad spend, sales or market share - the Ad Library does not publish those. Return ONLY JSON: {\"insights\":[{\"kind\":\"pricing|creative|positioning|activity\",\"title\":string,\"detail\":string,\"evidenceRefs\":[string]}]}" },
        { role: "user", content: `Evidence bundle:\n${JSON.stringify(bundle, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2).slice(0, 12000)}` },
      ], { jsonMode: true, maxTokens: 2000 });
      try {
        const parsed = JSON.parse(result.text);
        candidates = Array.isArray(parsed.insights) ? parsed.insights : [];
      } catch { candidates = []; }
      await (this.prisma as any).aIUsageRecord.create({
        data: { organizationId, userId: actorId, feature: "competitor_insight", provider: provider.name, inputTokens: result.inputTokens, outputTokens: result.outputTokens, estimated: result.tokensEstimated },
      });
    } else {
      candidates = templateInsights(bundle);
    }

    // Enforcement: an insight survives only with >=1 VALID evidence ref.
    const saved: any[] = [];
    for (const candidate of candidates.slice(0, 10)) {
      const evidenceRefs = (candidate.evidenceRefs ?? []).filter((r: string) => validRefs.has(r));
      if (evidenceRefs.length === 0) continue;
      const evidence = evidenceRefs.map((r: string) => refById.get(r)!);
      const insight = await (this.prisma as any).competitorInsight.create({
        data: {
          organizationId, competitorId: competitorId ?? null,
          kind: ["pricing", "creative", "positioning", "activity"].includes(candidate.kind) ? candidate.kind : "activity",
          title: String(candidate.title).slice(0, 300),
          detail: candidate.detail ? String(candidate.detail).slice(0, 2000) : null,
          evidence: evidence as any, provider: provider.name,
        },
      });
      saved.push(insight);
    }
    return { generated: saved.length, insights: saved, droppedWithoutEvidence: candidates.length - saved.length };
  }

  async listInsights(organizationId: string, competitorId?: string) {
    return (this.prisma as any).competitorInsight.findMany({
      where: { organizationId, ...(competitorId ? { competitorId } : {}) },
      orderBy: { createdAt: "desc" }, take: 50,
    });
  }

  // ----- White-label Agency Client Audit Dossier Export -----
  async exportDossier(organizationId: string, competitorId?: string) {
    const org = await (this.prisma as any).organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, slug: true, brandSettings: true, currency: true },
    });
    const competitors = competitorId
      ? [await this.getOrThrow(organizationId, competitorId)]
      : await (this.prisma as any).competitor.findMany({ where: { organizationId } });

    const comparison = await this.priceComparison(organizationId);
    const alerts = await this.getAlertsFeed(organizationId);
    const insights = await this.listInsights(organizationId, competitorId);

    const competitorDossiers = [];
    for (const c of competitors) {
      const ads = await this.listAds(organizationId, c.id);
      const observations = await this.listObservations(organizationId, c.id);
      const winningAds = ads.filter((a: any) => a.isWinning);
      competitorDossiers.push({
        competitor: c,
        totalAds: ads.length,
        activeAds: ads.filter((a: any) => a.isActive).length,
        winningAdsCount: winningAds.length,
        winningAds: winningAds.slice(0, 5),
        recentAds: ads.slice(0, 8),
        priceObservationsCount: observations.length,
        recentObservations: observations.slice(0, 10),
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      agencyBranding: {
        organizationName: org?.name || "Our Brand",
        currency: org?.currency || "BDT",
        brandSettings: org?.brandSettings || null,
      },
      summary: {
        totalCompetitorsTracked: competitors.length,
        totalAlertsActive: alerts.length,
        priceGapsDetected: comparison.rows.filter((r) => r.competitorPrices.length > 0).length,
      },
      competitors: competitorDossiers,
      priceComparisonMatrix: comparison.rows,
      liveOpportunityAlerts: alerts,
      strategicInsights: insights,
    };
  }

  // HF2: despite the historical name, this returns a REAL on-page audit
  // (observed title/meta/headings/schema/links), never traffic estimates.
  async getSeoTrafficReport(organizationId: string, competitorId: string) {
    const competitor = await this.getOrThrow(organizationId, competitorId);
    const auditor = new SeoOnPageAuditor();
    return auditor.audit(competitor.name, competitor.websiteUrl ?? undefined);
  }

  // HF2: the SEO gap strategy grounds ONLY in the real on-page audit
  // (the competitor's own observed title/headings/links) plus the org's
  // own product. The invented traffic/DA figures and the
  // `estimatedCtrBoost` percentage are gone — a CTR effect cannot be
  // known, so the strategy states its rationale in words and is labeled
  // an AI suggestion in the UI.
  async generateSeoGapStrategy(organizationId: string, actorId: string, competitorId: string, ownProductId?: string) {
    const competitor = await this.getOrThrow(organizationId, competitorId);
    const auditor = new SeoOnPageAuditor();
    const seoAudit = await auditor.audit(competitor.name, competitor.websiteUrl ?? undefined);
    if (!seoAudit.available) {
      throw new BadRequestException(
        seoAudit.reason ?? "প্রতিযোগীর ওয়েবসাইট থেকে আসল SEO ডেটা পাওয়া যায়নি — স্ট্র্যাটেজি তৈরি হয়নি",
      );
    }

    let ownProduct: { name: string; description?: string | null } | null = null;
    if (ownProductId) {
      const p = await this.prisma.product.findFirst({
        where: { id: ownProductId, organizationId },
        select: { name: true, description: true },
      });
      if (p) ownProduct = p;
    }

    const provider = this.llm.getProvider();
    const targetTitle = ownProduct?.name || "Your Store Product";
    const observedPhrases = seoAudit.observedPhrases.map((p) => p.text);

    const templateStrategy = {
      recommendedMetaTitle: `${targetTitle} - Best Price in BD | Cash On Delivery`,
      recommendedMetaDescription: `Looking for authentic ${targetTitle}? Order today with fast home delivery & Cash on Delivery across Bangladesh. 100% genuine product guaranteed!`,
      targetKeywords: [
        `${targetTitle.toLowerCase()} price in bangladesh`,
        `buy ${targetTitle.toLowerCase()} online`,
        `${targetTitle.toLowerCase()} cash on delivery`,
        `original ${targetTitle.toLowerCase()} shop bd`,
        `${competitor.name.toLowerCase()} alternative`,
      ],
      outrankTactics: seoAudit.title
        ? `প্রতিযোগীর হোমপেজের আসল শিরোনাম "${seoAudit.title}" — ওই পেজে ব্যবহৃত ফ্রেজের বিপরীতে আপনার প্রোডাক্টের নাম + দাম + ক্যাশ অন ডেলিভারি প্রতিশ্রুতি দিয়ে আলাদা, ক্লিক-যোগ্য মেটা সাজানো হয়েছে। এটি একটি পরামর্শমূলক খসড়া; প্রকৃত CTR প্রভাব আগে থেকে জানা যায় না।`
        : `প্রতিযোগীর হোমপেজে কোনো title পাওয়া যায়নি — আপনার প্রোডাক্টের নাম + দাম + ক্যাশ অন ডেলিভারি প্রতিশ্রুতি দিয়ে মেটা সাজানো হয়েছে। এটি একটি পরামর্শমূলক খসড়া; প্রকৃত CTR প্রভাব আগে থেকে জানা যায় না।`,
    };

    let strategyResult = templateStrategy;
    let origin: "ai" | "template" = "template";

    if (provider.isRealLlm) {
      const systemPrompt = "You are an e-commerce SEO and SERP copy strategist. You work ONLY from the observed on-page facts provided — never invent traffic, rankings, or CTR percentages.";
      const userPrompt = `Competitor: ${competitor.name} (${seoAudit.domain})
Observed homepage title: ${seoAudit.title ?? "(none found)"}
Observed meta description: ${seoAudit.metaDescription ?? "(none found)"}
Observed heading phrases from their own site: ${observedPhrases.join(" | ") || "(none found)"}
Product schema present on homepage: ${seoAudit.productSchemaPresent ? "yes" : "no"}
Target Product to Optimize: "${targetTitle}"

Task: draft an SEO package for OUR product page, informed by the phrases the competitor's own site actually uses:
1. Recommended Google SEO Meta Title (under 60 chars)
2. Meta Description (under 155 chars, highlighting COD / fast delivery)
3. 5 focus keyword phrases to tag on the product page
4. "Why this helps" tactical rationale IN WORDS. Do NOT state any CTR percentage or traffic estimate — the effect cannot be known in advance.

Format as clean JSON with keys:
{
  "recommendedMetaTitle": "...",
  "recommendedMetaDescription": "...",
  "targetKeywords": ["...", "..."],
  "outrankTactics": "..."
}`;

      try {
        const response = await provider.complete(
          [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
          { jsonMode: true },
        );
        const parsed = JSON.parse(response.text.match(/\{[\s\S]*\}/)?.[0] || "{}");
        if (parsed.recommendedMetaTitle) {
          strategyResult = {
            recommendedMetaTitle: parsed.recommendedMetaTitle,
            recommendedMetaDescription: parsed.recommendedMetaDescription || templateStrategy.recommendedMetaDescription,
            targetKeywords: Array.isArray(parsed.targetKeywords) ? parsed.targetKeywords : templateStrategy.targetKeywords,
            outrankTactics: parsed.outrankTactics || templateStrategy.outrankTactics,
          };
          origin = "ai";
        }
      } catch {
        // Keep the template draft (labeled via origin).
      }
    }

    await this.audit.log({
      organizationId,
      userId: actorId,
      action: "COMPETITOR_SEO_GAP_GENERATED",
      entityType: "competitor",
      entityId: competitorId,
      metadata: { competitorName: competitor.name, targetProduct: targetTitle },
    });

    return {
      competitor: {
        id: competitor.id,
        name: competitor.name,
        domain: seoAudit.domain,
      },
      seoAudit,
      strategy: strategyResult,
      origin,
    };
  }
  async deconstructVideoScript(
    organizationId: string,
    actorId: string,
    competitorId: string,
    dto: DeconstructVideoScriptDto,
  ) {
    const competitor = await this.getOrThrow(organizationId, competitorId);
    const ad = await this.prisma.competitorAd.findFirst({
      where: { id: dto.competitorAdId, competitorId },
    });
    if (!ad) {
      throw notFound("competitors.competitorAdNotFound2", { dtoCompetitorAdId: dto.competitorAdId });
    }

    let ownProductTitle: string | undefined = undefined;
    if (dto.ownProductId) {
      const product = await this.prisma.product.findFirst({
        where: { id: dto.ownProductId, organizationId },
        select: { name: true },
      });
      if (product) ownProductTitle = product.name;
    }

    const deconstructor = new VideoScriptDeconstructor(this.llm);
    const result = await deconstructor.deconstruct({
      competitorName: competitor.name,
      adText: ad.creativeText || "Check out our best collections online!",
      platforms: (ad.platforms as string[]) || ["facebook"],
      adId: ad.id,
      targetProductName: ownProductTitle,
      videoStyle: dto.videoStyle,
    });

    await this.audit.log({
      organizationId,
      userId: actorId,
      action: "COMPETITOR_VIDEO_SCRIPT_DECONSTRUCTED",
      entityType: "competitor_ad",
      entityId: ad.id,
      metadata: { competitorName: competitor.name, targetProduct: ownProductTitle },
    });

    return result;
  }

  // HF4: input-driven. Only the reviews the owner pastes are analyzed;
  // without pasted text the miner returns an honest unavailable state.
  async mineCustomerComplaints(organizationId: string, competitorId: string, reviewsText?: string) {
    const competitor = await this.getOrThrow(organizationId, competitorId);
    const miner = new ReviewMiner(this.llm);
    return miner.mine(competitor.name, reviewsText);
  }

  async getAlertSettings(organizationId: string): Promise<AlertChannelConfig> {
    const record = await (this.prisma as any).competitorInsight.findFirst({
      where: { organizationId, provider: "alert_config" },
      orderBy: { createdAt: "desc" },
    });
    if (!record || !record.detail) {
      return {
        telegramEnabled: false,
        whatsappEnabled: false,
        notifyOnPriceDrop: true,
        notifyOnStockOut: true,
        notifyOnWinningAd: true,
      };
    }
    try {
      return JSON.parse(record.detail);
    } catch {
      return {
        telegramEnabled: false,
        whatsappEnabled: false,
        notifyOnPriceDrop: true,
        notifyOnStockOut: true,
        notifyOnWinningAd: true,
      };
    }
  }

  async saveAlertSettings(organizationId: string, actorId: string, dto: ConfigureAlertSettingsDto) {
    const existing = await this.getAlertSettings(organizationId);
    const updated: AlertChannelConfig = {
      ...existing,
      ...dto,
      telegramEnabled: dto.telegramEnabled ?? existing.telegramEnabled,
      whatsappEnabled: dto.whatsappEnabled ?? existing.whatsappEnabled,
      notifyOnPriceDrop: dto.notifyOnPriceDrop ?? existing.notifyOnPriceDrop,
      notifyOnStockOut: dto.notifyOnStockOut ?? existing.notifyOnStockOut,
      notifyOnWinningAd: dto.notifyOnWinningAd ?? existing.notifyOnWinningAd,
    };

    await (this.prisma as any).competitorInsight.create({
      data: {
        organizationId,
        competitorId: null,
        kind: "activity",
        title: "Alert Notification Configuration",
        detail: JSON.stringify(updated),
        evidence: [{ ref: "config:alert", label: "Alert Configuration" }],
        provider: "alert_config",
      },
    });

    await this.audit.log({
      organizationId,
      userId: actorId,
      action: "COMPETITOR_ALERT_CONFIG_UPDATED",
      entityType: "organization",
      entityId: organizationId,
      metadata: { telegramEnabled: updated.telegramEnabled, whatsappEnabled: updated.whatsappEnabled },
    });

    return updated;
  }

  async testSendAlert(organizationId: string, dto: TestAlertChannelDto) {
    const dispatcher = new AlertDispatcher();
    const testPayload = {
      title: "টেস্ট অ্যালার্ট নোটিফিকেশন",
      detail: "অভিনন্দন! আপনার Marketing Intelligence OS বট সফলভাবে যুক্ত হয়েছে। এখন থেকে প্রতিযোগী দাম কমালে বা স্টক-আউট হলে আপনি রিয়েল-টাইম অ্যালার্ট পাবেন।",
      kind: "winning_ad" as const,
      competitorName: "Demo Competitor BD",
      url: "https://facebook.com/ads/library",
      timestamp: new Date().toISOString(),
    };

    if (dto.channel === "telegram") {
      const token = dto.telegramBotToken;
      const chatId = dto.telegramChatId;
      if (!token || !chatId) {
        throw badRequest("competitors.telegramBotTokenAndChatId");
      }
      return dispatcher.sendToTelegram(token, chatId, testPayload);
    } else {
      const url = dto.whatsappWebhookUrl;
      if (!url) {
        throw badRequest("competitors.whatsappWebhookUrlIsRequired");
      }
      return dispatcher.sendToWhatsapp(url, testPayload);
    }
  }

  async auditCheckoutFunnel(organizationId: string, competitorId: string) {
    const competitor = await this.getOrThrow(organizationId, competitorId);
    const auditor = new FunnelAuditor();
    return auditor.audit(competitor.name, competitor.websiteUrl ?? undefined);
  }

  async getDynamicRules(organizationId: string): Promise<DynamicPricingRule[]> {
    const record = await (this.prisma as any).competitorInsight.findFirst({
      where: {
        organizationId,
        provider: "dynamic_rules_config",
      },
      orderBy: { createdAt: "desc" },
    });

    if (!record || !record.metadata) {
      return RulesEngine.getDefaultRules();
    }

    try {
      return record.metadata.rules as DynamicPricingRule[];
    } catch {
      return RulesEngine.getDefaultRules();
    }
  }

  async saveDynamicRules(organizationId: string, actorId: string, dto: SaveDynamicRulesDto): Promise<{ success: boolean; rules: DynamicPricingRule[] }> {
    const existing = await (this.prisma as any).competitorInsight.findFirst({
      where: {
        organizationId,
        provider: "dynamic_rules_config",
      },
    });

    if (existing) {
      await (this.prisma as any).competitorInsight.update({
        where: { id: existing.id },
        data: {
          summary: "Dynamic pricing and automated budget trigger rules",
          metadata: { rules: dto.rules },
        },
      });
    } else {
      await (this.prisma as any).competitorInsight.create({
        data: {
          organizationId,
          provider: "dynamic_rules_config",
          summary: "Dynamic pricing and automated budget trigger rules",
          metadata: { rules: dto.rules },
        },
      });
    }

    await this.audit.log({
      organizationId,
      userId: actorId,
      action: "competitor.dynamic_rules_updated",
      entityType: "DynamicRules",
      entityId: organizationId,
    });

    return {
      success: true,
      rules: dto.rules,
    };
  }

  async simulateRuleTrigger(organizationId: string, dto: SimulateRuleTriggerDto): Promise<{ triggeredCount: number; results: RuleEvaluationResult[] }> {
    const rules = await this.getDynamicRules(organizationId);
    const results = RulesEngine.evaluateEvent(rules, {
      type: dto.triggerType,
      competitorName: dto.competitorName || "Daraz Bangladesh",
      productName: dto.productName || "Leather Wallet Combo",
      percentageChange: dto.percentageChange || 12,
    });

    // Save updated trigger count and recent executions back to DB
    const existing = await (this.prisma as any).competitorInsight.findFirst({
      where: {
        organizationId,
        provider: "dynamic_rules_config",
      },
    });

    if (existing) {
      await (this.prisma as any).competitorInsight.update({
        where: { id: existing.id },
        data: {
          metadata: { rules },
        },
      });
    }

    return {
      triggeredCount: results.length,
      results,
    };
  }
}








export function nameMatchScore(a: string, b: string): number {
  const words = (s: string) => s.toLowerCase().split(/[^a-z0-9\u0980-\u09FF]+/).filter((w) => w.length >= 3);
  const setB = new Set(words(b));
  return words(a).filter((w) => setB.has(w)).length;
}

/** Deterministic insights for the dev-template provider: every statement
 *  is a direct restatement of a collected fact, with its evidence. */
export function templateInsights(bundle: { facts: any[]; priceGaps: any[]; refs: EvidenceRef[] }): { kind: string; title: string; detail?: string; evidenceRefs: string[] }[] {
  const out: { kind: string; title: string; detail?: string; evidenceRefs: string[] }[] = [];
  for (const fact of bundle.facts) {
    if (fact.longestRunningActiveAd) {
      out.push({
        kind: "activity",
        title: `${fact.competitorName} has ${fact.activeAds} active ad(s); the longest-running started ${fact.longestRunningActiveAd.startedAt ? new Date(fact.longestRunningActiveAd.startedAt).toISOString().slice(0, 10) : "on an unknown date"}`,
        detail: fact.longestRunningActiveAd.creativeText ?? undefined,
        evidenceRefs: [fact.longestRunningActiveAd.ref],
      });
    }
    for (const price of fact.latestPrices.slice(0, 3)) {
      out.push({
        kind: "pricing",
        title: `${fact.competitorName} publicly lists ${price.productName} at ${price.price}`,
        evidenceRefs: [price.ref],
      });
    }
  }
  for (const gap of bundle.priceGaps) {
    if (gap.diffPercent === null || Math.abs(gap.diffPercent) < 10) continue;
    out.push({
      kind: "pricing",
      title: gap.diffPercent < 0
        ? `Competitor price for a product matching "${gap.productName}" is ${Math.abs(gap.diffPercent)}% lower than yours (${gap.competitor})`
        : `Your price for "${gap.productName}" is lower than ${gap.competitor}'s observed price by ${gap.diffPercent}%`,
      evidenceRefs: gap.ref ? [gap.ref] : [],
      detail: `Source: ${gap.sourceUrl}`,
    });
  }
  return out;
}
