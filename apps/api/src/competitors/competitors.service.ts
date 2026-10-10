import { ensurePlatformConfig, getPlatformConfigSync } from "../common/platform-config";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { decryptJson } from "../integrations/crypto";
import { AdLibraryClient } from "./ad-library.client";
import { WebsiteScanner } from "./website-scanner";
import { LlmFactory } from "../ai/llm/llm.factory";
import { parseMoneyToMinor, formatMinor } from "@repo/contracts";

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
    if (!c) throw new NotFoundException("Competitor not found in this organization");
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
    throw new BadRequestException("No Ad Library access token available. Ask the platform admin to set one in the Admin Console, connect Meta (Milestone 5), or set FACEBOOK_AD_LIBRARY_TOKEN. Meta may require an identity-confirmed user token depending on your country.");
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

  async listAds(organizationId: string, competitorId: string) {
    await this.getOrThrow(organizationId, competitorId);
    const ads = await (this.prisma as any).competitorAd.findMany({
      where: { competitorId }, orderBy: { startedAt: "desc" }, take: 100,
    });
    return ads.map((a: any) => ({ ...a, raw: undefined }));
  }

  // ----- Website scan + manual price observations -----
  async scanWebsite(organizationId: string, actorId: string, competitorId: string) {
    const competitor = await this.getOrThrow(organizationId, competitorId);
    if (!competitor.websiteUrl) throw new BadRequestException("This competitor has no website URL");
    const scan = await new WebsiteScanner().scan(competitor.websiteUrl);
    let stored = 0;
    for (const product of scan.products) {
      await (this.prisma as any).competitorPriceObservation.create({
        data: {
          competitorId, productName: product.name, priceMinor: BigInt(product.priceMinor),
          currency: product.currency, sourceUrl: product.url, sourceType: "website_scan",
        },
      });
      stored++;
    }
    await this.audit.log({ organizationId, userId: actorId, action: "competitor.website_scanned", entityType: "Competitor", entityId: competitorId, metadata: { scannedUrls: scan.scannedUrls, stored } });
    return { scannedUrls: scan.scannedUrls, found: scan.products.length, stored, skippedByRobots: scan.skippedByRobots, errors: scan.errors };
  }

  async addObservation(organizationId: string, competitorId: string, dto: { productName: string; price: string; currency?: string; sourceUrl: string }) {
    await this.getOrThrow(organizationId, competitorId);
    if (!dto.sourceUrl || !/^https?:\/\//i.test(dto.sourceUrl)) {
      throw new BadRequestException("A source URL is required as evidence for every price observation");
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
      throw new BadRequestException("No competitor evidence collected yet. Sync ads or scan/add prices first - insights are never generated without evidence.");
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
