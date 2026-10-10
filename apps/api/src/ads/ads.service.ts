import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateAdAccountDto, ManualMetricDto, ImportAdCsvDto, MetaConnectDto, MetaSyncDto } from "./ads.dto";
import { parseAdSpendCsv } from "./ads.csv";
import { encryptJson, decryptJson } from "../integrations/crypto";
import { MetaClient } from "./meta/meta.client";
import { GoogleAdsClient, GoogleAdsSecrets } from "./google/google.client";
import { TikTokAdsClient } from "./tiktok/tiktok.client";
import { normalizeMetaInsight, normalizeMetaAdInsight } from "./meta/normalize";
import { parseMoneyToMinor } from "@repo/contracts";

export function utcDate(dateOnly: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) throw new BadRequestException(`Invalid date: ${dateOnly} (expected YYYY-MM-DD)`);
  return new Date(`${dateOnly}T00:00:00.000Z`);
}
function money(value: string | undefined, field: string): bigint {
  if (!value) return 0n;
  try { return parseMoneyToMinor(value); } catch { throw new BadRequestException(`Invalid ${field}: ${value}`); }
}
function intField(value: string | undefined): number {
  if (!value) return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new BadRequestException(`Invalid number: ${value}`);
  return n;
}

@Injectable()
export class AdsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async createAccount(organizationId: string, actorId: string, dto: CreateAdAccountDto) {
    const account = await (this.prisma as any).adAccount.create({
      data: {
        organizationId, platform: dto.platform, sourceType: dto.sourceType ?? "manual",
        externalId: dto.externalId ?? null, name: dto.name.trim(), currency: dto.currency ?? "BDT",
      },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "ad_account.create", entityType: "AdAccount", entityId: account.id });
    return account;
  }

  async listAccounts(organizationId: string) {
    return (this.prisma as any).adAccount.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } });
  }

  async getAccount(organizationId: string, accountId: string) {
    const account = await (this.prisma as any).adAccount.findFirst({ where: { id: accountId, organizationId } });
    if (!account) throw new NotFoundException("Ad account not found in this organization");
    return account;
  }

  /**
   * Upsert one daily metric. The unique key is
   * (org, account, campaignExternalId, date, source).
   * Re-importing or re-syncing RESTATES the row (platforms correct their
   * numbers), unlike product CSV where re-uploads are skipped.
   */
  async upsertMetric(organizationId: string, input: {
    adAccountId: string; adCampaignId?: string | null; platform: string; source: string;
    campaignExternalId: string; campaignName?: string; date: Date; currency: string;
    spendMinor: bigint; impressions: number; clicks: number; conversions: number; conversionValueMinor: bigint;
    adSetExternalId?: string; adSetName?: string; adExternalId?: string; adName?: string;
    reach?: number; videoViews?: number;
  }): Promise<"created" | "updated"> {
    const where = {
      organizationId_adAccountId_campaignExternalId_adSetExternalId_adExternalId_date_source: {
        organizationId, adAccountId: input.adAccountId,
        campaignExternalId: input.campaignExternalId,
        adSetExternalId: input.adSetExternalId ?? "", adExternalId: input.adExternalId ?? "",
        date: input.date, source: input.source,
      },
    };
    const data = {
      organizationId, adAccountId: input.adAccountId, adCampaignId: input.adCampaignId ?? null,
      platform: input.platform, source: input.source, campaignExternalId: input.campaignExternalId,
      campaignName: input.campaignName ?? null, date: input.date, currency: input.currency,
      spendMinor: input.spendMinor, impressions: input.impressions, clicks: input.clicks,
      platformConversions: input.conversions, platformConversionValueMinor: input.conversionValueMinor,
      adSetExternalId: input.adSetExternalId ?? "", adSetName: input.adSetName ?? null,
      adExternalId: input.adExternalId ?? "", adName: input.adName ?? null,
      reach: input.reach ?? 0, videoViews: input.videoViews ?? 0,
    };
    const existing = await (this.prisma as any).dailyAdMetric.findUnique({ where });
    if (existing) {
      await (this.prisma as any).dailyAdMetric.update({ where, data });
      return "updated";
    }
    await (this.prisma as any).dailyAdMetric.create({ data });
    return "created";
  }

  async manualEntry(organizationId: string, actorId: string, accountId: string, dto: ManualMetricDto) {
    const account = await this.getAccount(organizationId, accountId);
    const result = await this.upsertMetric(organizationId, {
      adAccountId: account.id, platform: account.platform, source: "manual",
      campaignExternalId: "", campaignName: dto.campaignName, date: utcDate(dto.date),
      currency: account.currency, spendMinor: money(dto.spend, "spend"),
      impressions: intField(dto.impressions), clicks: intField(dto.clicks),
      conversions: intField(dto.conversions), conversionValueMinor: money(dto.conversionValue, "conversionValue"),
    });
    await this.audit.log({ organizationId, userId: actorId, action: "ad_metric.manual", entityType: "AdAccount", entityId: account.id, metadata: { date: dto.date, result } });
    return { result };
  }

  async importCsv(organizationId: string, actorId: string, accountId: string, dto: ImportAdCsvDto) {
    const account = await this.getAccount(organizationId, accountId);
    const { rows, errors, totalRows } = parseAdSpendCsv(dto.csvText, account.currency);
    let created = 0, updated = 0;
    for (const row of rows) {
      // Link or create the AdCampaign record when the CSV carries an id.
      let campaignId: string | null = null;
      if (row.campaignExternalId) {
        const campaign = await (this.prisma as any).adCampaign.upsert({
          where: { adAccountId_externalId: { adAccountId: account.id, externalId: row.campaignExternalId } },
          update: { name: row.campaignName ?? undefined },
          create: { organizationId, adAccountId: account.id, externalId: row.campaignExternalId, name: row.campaignName ?? row.campaignExternalId },
        });
        campaignId = campaign.id;
      }
      const result = await this.upsertMetric(organizationId, {
        adAccountId: account.id, adCampaignId: campaignId, platform: account.platform, source: "csv",
        campaignExternalId: row.campaignExternalId, campaignName: row.campaignName,
        date: utcDate(row.date), currency: row.currency, spendMinor: row.spendMinor,
        impressions: row.impressions, clicks: row.clicks, conversions: row.conversions,
        conversionValueMinor: row.conversionValueMinor,
      });
      if (result === "created") created++; else updated++;
    }
    await this.audit.log({
      organizationId, userId: actorId, action: "ad_metric.import_csv", entityType: "AdAccount",
      entityId: account.id, metadata: { totalRows, created, updated, failed: errors.length },
    });
    return { totalRows, created, updated, failed: errors.length, errors: errors.slice(0, 200) };
  }

  // ---------- Meta ----------
  async connectMeta(organizationId: string, actorId: string, dto: MetaConnectDto) {
    const client = new MetaClient(dto.accessToken);
    let me: { id: string; name?: string };
    try {
      me = await client.verifyToken();
    } catch (e) {
      throw new BadRequestException(`Meta token verification failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
    let discovered = await client.listAdAccounts().catch((e) => {
      throw new BadRequestException(`Could not list Meta ad accounts: ${e instanceof Error ? e.message : "unknown error"}`);
    });
    if (dto.adAccountExternalIds?.length) {
      discovered = discovered.filter((a) => dto.adAccountExternalIds!.includes(a.externalId));
    }
    if (discovered.length === 0) throw new BadRequestException("No Meta ad accounts found for this token");

    const integration = await (this.prisma as any).integration.create({
      data: { organizationId, provider: "meta", status: "CONNECTED", externalAccountId: me.id },
    });
    await (this.prisma as any).integrationCredential.create({
      data: { integrationId: integration.id, encryptedData: encryptJson({ accessToken: dto.accessToken }) },
    });
    const accounts = [];
    for (const a of discovered) {
      const account = await (this.prisma as any).adAccount.upsert({
        where: { organizationId_platform_externalId: { organizationId, platform: "meta", externalId: a.externalId } },
        update: { name: a.name, currency: a.currency, integrationId: integration.id, sourceType: "api" },
        create: {
          organizationId, platform: "meta", sourceType: "api", externalId: a.externalId,
          name: a.name, currency: a.currency, integrationId: integration.id,
        },
      });
      accounts.push(account);
    }
    await this.audit.log({ organizationId, userId: actorId, action: "integration.connect", entityType: "Integration", entityId: integration.id, metadata: { provider: "meta", accounts: accounts.length } });
    return { integrationId: integration.id, connectedAccounts: accounts };
  }

  async syncMetaInsights(organizationId: string, actorId: string, accountId: string, dto: MetaSyncDto) {
    const account = await this.getAccount(organizationId, accountId);
    if (account.platform !== "meta" || !account.integrationId || !account.externalId) {
      throw new BadRequestException("This ad account is not connected to Meta via API");
    }
    const integration = await (this.prisma as any).integration.findFirst({
      where: { id: account.integrationId, organizationId }, include: { credential: true },
    });
    if (!integration?.credential) throw new BadRequestException("Meta credentials are missing; reconnect the account");
    const { accessToken } = decryptJson<{ accessToken: string }>(integration.credential.encryptedData);
    const until = dto.until ?? new Date().toISOString().slice(0, 10);
    const since = dto.since ?? new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const client = new MetaClient(accessToken);
    let rawRows: any[];
    try {
      rawRows = await client.getCampaignInsights(account.externalId, since, until);
    } catch (e) {
      await (this.prisma as any).integration.update({ where: { id: integration.id }, data: { status: "ERROR", lastError: e instanceof Error ? e.message : "Meta sync failed" } });
      throw new BadRequestException(`Meta insights sync failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
    let created = 0, updated = 0;
    for (const raw of rawRows) {
      const n = normalizeMetaInsight(raw);
      let campaignId: string | null = null;
      if (n.campaignExternalId) {
        const campaign = await (this.prisma as any).adCampaign.upsert({
          where: { adAccountId_externalId: { adAccountId: account.id, externalId: n.campaignExternalId } },
          update: { name: n.campaignName ?? undefined },
          create: { organizationId, adAccountId: account.id, externalId: n.campaignExternalId, name: n.campaignName ?? n.campaignExternalId },
        });
        campaignId = campaign.id;
      }
      const result = await this.upsertMetric(organizationId, {
        adAccountId: account.id, adCampaignId: campaignId, platform: "meta", source: "api",
        campaignExternalId: n.campaignExternalId, campaignName: n.campaignName,
        date: utcDate(n.date), currency: account.currency, spendMinor: n.spendMinor,
        impressions: n.impressions, clicks: n.clicks, conversions: n.conversions,
        conversionValueMinor: n.conversionValueMinor, reach: n.reach ?? 0,
      });
      if (result === "created") created++; else updated++;
    }
    await (this.prisma as any).integration.update({ where: { id: integration.id }, data: { status: "CONNECTED", lastSyncAt: new Date(), lastError: null } });
    await this.audit.log({ organizationId, userId: actorId, action: "sync.meta_insights", entityType: "AdAccount", entityId: account.id, metadata: { since, until, rows: rawRows.length, created, updated } });
    return { since, until, rows: rawRows.length, created, updated };
  }
  // ---------- Shared daily-rows upsert for API adapters ----------
  private async upsertDailyRows(organizationId: string, account: any, platform: string, rows: {
    date: string; campaignExternalId: string; campaignName?: string; spendMinor: bigint;
    impressions: number; clicks: number; conversions: number; conversionValueMinor: bigint; currency: string;
  }[]): Promise<{ created: number; updated: number }> {
    let created = 0, updated = 0;
    for (const n of rows) {
      let campaignId: string | null = null;
      if (n.campaignExternalId) {
        const campaign = await (this.prisma as any).adCampaign.upsert({
          where: { adAccountId_externalId: { adAccountId: account.id, externalId: n.campaignExternalId } },
          update: { name: n.campaignName ?? undefined },
          create: { organizationId, adAccountId: account.id, externalId: n.campaignExternalId, name: n.campaignName ?? n.campaignExternalId },
        });
        campaignId = campaign.id;
      }
      const result = await this.upsertMetric(organizationId, {
        adAccountId: account.id, adCampaignId: campaignId, platform, source: "api",
        campaignExternalId: n.campaignExternalId, campaignName: n.campaignName,
        date: new Date(`${n.date}T00:00:00.000Z`), currency: n.currency,
        spendMinor: n.spendMinor, impressions: n.impressions, clicks: n.clicks,
        conversions: n.conversions, conversionValueMinor: n.conversionValueMinor,
      });
      if (result === "created") created++; else updated++;
    }
    return { created, updated };
  }

  private async integrationSecrets<T>(organizationId: string, account: any, providerLabel: string): Promise<T> {
    if (!account.integrationId || !account.externalId) {
      throw new BadRequestException(`This ad account is not connected to ${providerLabel} via API`);
    }
    const integration = await (this.prisma as any).integration.findFirst({
      where: { id: account.integrationId, organizationId }, include: { credential: true },
    });
    if (!integration?.credential) throw new BadRequestException(`${providerLabel} credentials are missing; reconnect the account`);
    return decryptJson<T>(integration.credential.encryptedData);
  }

  private dateRange(dto: { since?: string; until?: string }): { since: string; until: string } {
    return {
      until: dto.until ?? new Date().toISOString().slice(0, 10),
      since: dto.since ?? new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10),
    };
  }

  // ---------- Ad-level + breakdown sync (Phase G) ----------
  private async metaClientFor(organizationId: string, accountId: string) {
    const account = await this.getAccount(organizationId, accountId);
    if (account.platform !== "meta" || !account.integrationId || !account.externalId) {
      throw new BadRequestException("This ad account is not connected to Meta via API");
    }
    const integration = await (this.prisma as any).integration.findFirst({
      where: { id: account.integrationId, organizationId }, include: { credential: true },
    });
    if (!integration?.credential) throw new BadRequestException("Meta credentials are missing; reconnect the account");
    const { accessToken } = decryptJson<{ accessToken: string }>(integration.credential.encryptedData);
    return { account, integration, client: new MetaClient(accessToken) };
  }

  async syncMetaAdInsights(organizationId: string, actorId: string, accountId: string, dto: MetaSyncDto) {
    const { account, integration, client } = await this.metaClientFor(organizationId, accountId);
    const until = dto.until ?? new Date().toISOString().slice(0, 10);
    const since = dto.since ?? new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    let rawRows: any[];
    try {
      rawRows = await client.getAdInsights(account.externalId, since, until);
    } catch (e) {
      throw new BadRequestException(`Meta ad-insights sync failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
    let created = 0, updated = 0;
    for (const raw of rawRows) {
      const n = normalizeMetaAdInsight(raw);
      let campaignId: string | null = null;
      if (n.campaignExternalId) {
        const campaign = await (this.prisma as any).adCampaign.upsert({
          where: { adAccountId_externalId: { adAccountId: account.id, externalId: n.campaignExternalId } },
          update: { name: n.campaignName ?? undefined },
          create: { organizationId, adAccountId: account.id, externalId: n.campaignExternalId, name: n.campaignName ?? n.campaignExternalId },
        });
        campaignId = campaign.id;
      }
      const result = await this.upsertMetric(organizationId, {
        adAccountId: account.id, adCampaignId: campaignId, platform: "meta", source: "api",
        campaignExternalId: n.campaignExternalId, campaignName: n.campaignName,
        adSetExternalId: n.adSetExternalId, adSetName: n.adSetName,
        adExternalId: n.adExternalId, adName: n.adName,
        reach: n.reach, videoViews: n.videoViews,
        date: utcDate(n.date), currency: account.currency, spendMinor: n.spendMinor,
        impressions: n.impressions, clicks: n.clicks, conversions: n.conversions,
        conversionValueMinor: n.conversionValueMinor,
      });
      if (result === "created") created++; else updated++;
    }
    await this.audit.log({ organizationId, userId: actorId, action: "sync.meta_ad_insights", entityType: "AdAccount", entityId: account.id, metadata: { since, until, rows: rawRows.length, created, updated } });
    return { since, until, rows: rawRows.length, created, updated };
  }

  async syncMetaBreakdowns(organizationId: string, actorId: string, accountId: string, dto: MetaSyncDto) {
    const { account, client } = await this.metaClientFor(organizationId, accountId);
    const until = dto.until ?? new Date().toISOString().slice(0, 10);
    const since = dto.since ?? new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const jobs: { dimension: string; breakdowns: string; keyOf: (r: any) => string }[] = [
      { dimension: "age_gender", breakdowns: "age,gender", keyOf: (r) => `${r.age ?? "unknown"}:${r.gender ?? "unknown"}` },
      { dimension: "placement", breakdowns: "publisher_platform,platform_position", keyOf: (r) => `${r.publisher_platform ?? "unknown"}:${r.platform_position ?? "unknown"}` },
      { dimension: "device", breakdowns: "impression_device", keyOf: (r) => String(r.impression_device ?? "unknown") },
      { dimension: "region", breakdowns: "region", keyOf: (r) => String(r.region ?? "unknown") },
      { dimension: "hourly", breakdowns: "hourly_stats_aggregated_by_advertiser_time_zone", keyOf: (r) => String(r.hourly_stats_aggregated_by_advertiser_time_zone ?? "?").slice(0, 2) },
    ];
    let rows = 0;
    for (const job of jobs) {
      let rawRows: any[];
      try {
        rawRows = await client.getBreakdownInsights(account.externalId, since, until, job.breakdowns);
      } catch (e) {
        throw new BadRequestException(`Meta breakdown sync (${job.dimension}) failed: ${e instanceof Error ? e.message : "unknown error"}`);
      }
      for (const raw of rawRows) {
        const n = normalizeMetaInsight(raw);
        const where = {
          organizationId_adAccountId_date_dimension_key_campaignExternalId_source: {
            organizationId, adAccountId: account.id, date: utcDate(n.date), dimension: job.dimension,
            key: job.keyOf(raw), campaignExternalId: n.campaignExternalId, source: "api",
          },
        };
        const data = {
          organizationId, adAccountId: account.id, platform: "meta", source: "api",
          date: utcDate(n.date), dimension: job.dimension, key: job.keyOf(raw),
          campaignExternalId: n.campaignExternalId, spendMinor: n.spendMinor,
          impressions: n.impressions, clicks: n.clicks, platformConversions: n.conversions,
        };
        const existing = await (this.prisma as any).dailyAdBreakdown.findUnique({ where });
        if (existing) await (this.prisma as any).dailyAdBreakdown.update({ where, data });
        else await (this.prisma as any).dailyAdBreakdown.create({ data });
        rows++;
      }
    }
    await this.audit.log({ organizationId, userId: actorId, action: "sync.meta_breakdowns", entityType: "AdAccount", entityId: account.id, metadata: { since, until, rows } });
    return { since, until, rows };
  }

  /** Creative performance: ad-level rows aggregated over the window. */
  async getAdMetrics(organizationId: string, accountId: string, days = 30) {
    const account = await this.getAccount(organizationId, accountId);
    const since = new Date(Date.now() - (days - 1) * 86400000);
    since.setUTCHours(0, 0, 0, 0);
    const rows = await (this.prisma as any).dailyAdMetric.findMany({
      where: { organizationId, adAccountId: account.id, date: { gte: since } }, take: 5000,
    });
    const adRows = rows.filter((r: any) => r.adExternalId);
    const byAd = new Map<string, any>();
    for (const r of adRows) {
      const cur = byAd.get(r.adExternalId) ?? {
        adExternalId: r.adExternalId, adName: r.adName, adSetName: r.adSetName, campaignName: r.campaignName,
        spendMinor: 0n, impressions: 0, clicks: 0, reach: 0, videoViews: 0, conversions: 0, conversionValueMinor: 0n, currency: r.currency,
      };
      cur.spendMinor += BigInt(r.spendMinor); cur.impressions += r.impressions; cur.clicks += r.clicks;
      cur.reach += r.reach; cur.videoViews += r.videoViews; cur.conversions += r.platformConversions;
      cur.conversionValueMinor += BigInt(r.platformConversionValueMinor);
      byAd.set(r.adExternalId, cur);
    }
    return [...byAd.values()].map((a) => ({
      ...a,
      spendMinor: String(a.spendMinor), conversionValueMinor: String(a.conversionValueMinor),
      ctr: a.impressions > 0 ? Math.round((a.clicks / a.impressions) * 10000) / 100 : null,
      cpaMinor: a.conversions > 0 ? String(a.spendMinor / BigInt(a.conversions)) : null,
      frequency: a.reach > 0 ? Math.round((a.impressions / a.reach) * 100) / 100 : null,
    })).sort((x, y) => Number(BigInt(y.spendMinor) - BigInt(x.spendMinor)));
  }

  /** Click-to-WhatsApp report: conversations Meta told us started
   * from an ad (referral source id = ad id), grouped per ad, with the
   * campaign name resolved from ad-level metrics when available. */
  async ctwaReport(organizationId: string, days = 30) {
    const since = new Date(Date.now() - (days - 1) * 86400000);
    const conversations = await (this.prisma as any).channelConversation.findMany({
      where: { organizationId, channel: "whatsapp", ctwaSourceId: { not: null }, lastMessageAt: { gte: since } },
      take: 5000,
    }).catch(() => []);
    const byAd = new Map<string, number>();
    for (const c of conversations) byAd.set(c.ctwaSourceId, (byAd.get(c.ctwaSourceId) ?? 0) + 1);
    const out = [];
    for (const [sourceId, chats] of byAd.entries()) {
      const metric = await (this.prisma as any).dailyAdMetric.findFirst({
        where: { organizationId, adExternalId: sourceId },
      }).catch(() => null);
      out.push({ sourceId, campaignName: metric?.campaignName ?? null, adName: metric?.adName ?? null, chats });
    }
    return out.sort((a, b) => b.chats - a.chats);
  }

  /** Creative leaderboard (Phase K): per-ad performance from the
   * synced ad-level rows, with an HONEST fatigue signal: frequency
   * >= 3.5 AND CTR down >= 30% vs the previous equal window. Both
   * inputs come from Meta's rows; nothing is predicted. */
  async creativeLeaderboard(organizationId: string, days = 14) {
    const now = new Date();
    const since = new Date(now.getTime() - days * 86400000);
    const prevSince = new Date(now.getTime() - 2 * days * 86400000);
    const rows = await (this.prisma as any).dailyAdMetric.findMany({
      where: { organizationId, source: "meta", date: { gte: prevSince } }, take: 20000,
    });
    type Agg = { adExternalId: string; adName: string; campaign: string; spend: bigint; impressions: bigint; clicks: bigint; reach: bigint; conversions: bigint; prevClicks: bigint; prevImpressions: bigint };
    const map = new Map<string, Agg>();
    for (const r of rows as any[]) {
      if (!r.adExternalId) continue;
      const key = String(r.adExternalId);
      const a = map.get(key) ?? { adExternalId: key, adName: r.adName ?? key, campaign: r.campaignName ?? r.campaignExternalId ?? "", spend: 0n, impressions: 0n, clicks: 0n, reach: 0n, conversions: 0n, prevClicks: 0n, prevImpressions: 0n };
      const rowDate = new Date(r.date);
      if (rowDate >= since) {
        a.spend += BigInt(r.spendMinor ?? 0); a.impressions += BigInt(r.impressions ?? 0);
        a.clicks += BigInt(r.clicks ?? 0); a.reach += BigInt(r.reach ?? 0); a.conversions += BigInt(r.conversions ?? 0);
      } else {
        a.prevClicks += BigInt(r.clicks ?? 0); a.prevImpressions += BigInt(r.impressions ?? 0);
      }
      map.set(key, a);
    }
    const list = [...map.values()].map((a) => {
      const ctr = a.impressions > 0n ? Number(a.clicks) / Number(a.impressions) * 100 : null;
      const prevCtr = a.prevImpressions > 0n ? Number(a.prevClicks) / Number(a.prevImpressions) * 100 : null;
      const frequency = a.reach > 0n ? Number(a.impressions) / Number(a.reach) : null;
      const ctrDropPercent = ctr !== null && prevCtr !== null && prevCtr > 0 ? (prevCtr - ctr) / prevCtr * 100 : null;
      const reasons: string[] = [];
      if (frequency !== null && frequency >= 3.5) reasons.push("frequency_high");
      if (ctrDropPercent !== null && ctrDropPercent >= 30) reasons.push("ctr_declining");
      return {
        adExternalId: a.adExternalId, adName: a.adName, campaign: a.campaign,
        spendMinor: a.spend.toString(), impressions: Number(a.impressions), clicks: Number(a.clicks),
        conversions: Number(a.conversions),
        ctrPercent: ctr !== null ? Math.round(ctr * 100) / 100 : null,
        frequency: frequency !== null ? Math.round(frequency * 100) / 100 : null,
        cpaMinor: a.conversions > 0n ? (a.spend / a.conversions).toString() : null,
        ctrDropPercent: ctrDropPercent !== null ? Math.round(ctrDropPercent) : null,
        fatigued: reasons.length === 2, fatigueReasons: reasons,
      };
    }).filter((x) => x.impressions > 0 || x.spendMinor !== "0");
    list.sort((x, y) => Number(BigInt(y.spendMinor) - BigInt(x.spendMinor)));
    return { days, ads: list.slice(0, 50) };
  }

  /** Budget pacing (Phase K): month-to-date spend vs an optional
   * monthly budget the owner sets, plus cross-plan shift suggestions
   * computed from this month's first-party + platform numbers.
   * Suggestions are information only — nothing moves automatically. */
  async pacing(organizationId: string, monthlyBudgetMajor?: number) {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const dayOfMonth = now.getUTCDate();
    const rows = await (this.prisma as any).dailyAdMetric.findMany({
      where: { organizationId, date: { gte: monthStart } }, take: 20000,
    });
    let spend = 0n;
    const perCampaign = new Map<string, { name: string; spend: bigint; conversions: bigint }>();
    for (const r of rows as any[]) {
      if ((r.adExternalId ?? "") !== "") continue; // campaign-level rows only
      spend += BigInt(r.spendMinor ?? 0);
      const key = String(r.campaignExternalId);
      const c = perCampaign.get(key) ?? { name: r.campaignName ?? key, spend: 0n, conversions: 0n };
      c.spend += BigInt(r.spendMinor ?? 0); c.conversions += BigInt(r.conversions ?? 0);
      perCampaign.set(key, c);
    }
    const dailyAvg = dayOfMonth > 0 ? Number(spend) / dayOfMonth : 0;
    const projected = Math.round(dailyAvg * daysInMonth);
    const budgetMinor = monthlyBudgetMajor && monthlyBudgetMajor > 0 ? Math.round(monthlyBudgetMajor * 100) : null;
    const expectedByNow = budgetMinor !== null ? Math.round(budgetMinor * dayOfMonth / daysInMonth) : null;
    const campaigns = [...perCampaign.values()].map((c) => ({
      name: c.name, spendMinor: c.spend.toString(), conversions: Number(c.conversions),
      cpaMinor: c.conversions > 0n ? (c.spend / c.conversions).toString() : null,
    })).sort((a, b) => Number(BigInt(b.spendMinor) - BigInt(a.spendMinor)));
    const suggestions: string[] = [];
    const withCpa = campaigns.filter((c) => c.cpaMinor !== null && BigInt(c.spendMinor) > 0n);
    if (withCpa.length >= 2) {
      const best = [...withCpa].sort((a, b) => Number(BigInt(a.cpaMinor!) - BigInt(b.cpaMinor!)))[0];
      const worst = [...withCpa].sort((a, b) => Number(BigInt(b.cpaMinor!) - BigInt(a.cpaMinor!)))[0];
      if (best !== worst && BigInt(worst.cpaMinor!) >= 2n * BigInt(best.cpaMinor!)) {
        suggestions.push(`"${worst.name}" এর CPA "${best.name}" এর দ্বিগুণেরও বেশি — বাজেটের কিছু অংশ "${best.name}" এ সরানোর কথা বিবেচনা করুন (স্বয়ংক্রিয়ভাবে কিছু সরানো হয়নি)।`);
      }
    }
    if (budgetMinor !== null && projected > budgetMinor) {
      suggestions.push(`এই গতিতে মাস শেষে খরচ বাজেট ছাড়িয়ে যাবে (আনুমানিক ${Math.round(projected / 100)} বনাম বাজেট ${monthlyBudgetMajor}) — দৈনিক বাজেট কমানো বা ক্যাপ রুল ভাবুন।`);
    }
    return {
      monthSpendMinor: spend.toString(), dayOfMonth, daysInMonth,
      projectedMonthSpendMinor: String(projected),
      monthlyBudgetMinor: budgetMinor !== null ? String(budgetMinor) : null,
      expectedSpendByNowMinor: expectedByNow !== null ? String(expectedByNow) : null,
      pacePercent: expectedByNow !== null && expectedByNow > 0 ? Math.round(Number(spend) / expectedByNow * 100) : null,
      campaigns, suggestions,
    };
  }

  async getBreakdowns(organizationId: string, accountId: string, dimension: string, days = 30) {
    const account = await this.getAccount(organizationId, accountId);
    if (!["age_gender", "placement", "device", "region", "hourly"].includes(dimension)) throw new BadRequestException("dimension must be age_gender, placement, device, region or hourly");
    const since = new Date(Date.now() - (days - 1) * 86400000);
    since.setUTCHours(0, 0, 0, 0);
    const rows = await (this.prisma as any).dailyAdBreakdown.findMany({
      where: { organizationId, adAccountId: account.id, dimension, date: { gte: since } }, take: 5000,
    });
    const byKey = new Map<string, any>();
    for (const r of rows) {
      const cur = byKey.get(r.key) ?? { key: r.key, spendMinor: 0n, impressions: 0, clicks: 0, conversions: 0 };
      cur.spendMinor += BigInt(r.spendMinor); cur.impressions += r.impressions; cur.clicks += r.clicks; cur.conversions += r.platformConversions;
      byKey.set(r.key, cur);
    }
    return [...byKey.values()].map((b) => ({
      ...b, spendMinor: String(b.spendMinor),
      ctr: b.impressions > 0 ? Math.round((b.clicks / b.impressions) * 10000) / 100 : null,
    })).sort((x, y) => Number(BigInt(y.spendMinor) - BigInt(x.spendMinor)));
  }

  // ---------- Google Ads ----------
  async connectGoogle(organizationId: string, actorId: string, dto: {
    customerId: string; clientId: string; clientSecret: string; refreshToken: string; developerToken: string; loginCustomerId?: string;
  }) {
    const secrets: GoogleAdsSecrets = {
      clientId: dto.clientId, clientSecret: dto.clientSecret, refreshToken: dto.refreshToken,
      developerToken: dto.developerToken, loginCustomerId: dto.loginCustomerId,
    };
    const client = new GoogleAdsClient(secrets);
    let customer: { id: string; descriptiveName?: string; currencyCode?: string };
    try {
      customer = await client.verifyCustomer(dto.customerId);
    } catch (e) {
      throw new BadRequestException(`Google Ads verification failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
    const integration = await (this.prisma as any).integration.create({
      data: { organizationId, provider: "google_ads", status: "CONNECTED", externalAccountId: customer.id },
    });
    await (this.prisma as any).integrationCredential.create({
      data: { integrationId: integration.id, encryptedData: encryptJson(secrets) },
    });
    const account = await (this.prisma as any).adAccount.upsert({
      where: { organizationId_platform_externalId: { organizationId, platform: "google", externalId: customer.id } },
      update: { name: customer.descriptiveName ?? `Google Ads ${customer.id}`, currency: customer.currencyCode ?? "USD", integrationId: integration.id, sourceType: "api" },
      create: { organizationId, platform: "google", sourceType: "api", externalId: customer.id, name: customer.descriptiveName ?? `Google Ads ${customer.id}`, currency: customer.currencyCode ?? "USD", integrationId: integration.id },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "integration.connect", entityType: "Integration", entityId: integration.id, metadata: { provider: "google_ads" } });
    return { integrationId: integration.id, connectedAccounts: [account] };
  }

  async syncGoogleInsights(organizationId: string, actorId: string, accountId: string, dto: { since?: string; until?: string }) {
    const account = await this.getAccount(organizationId, accountId);
    if (account.platform !== "google") throw new BadRequestException("This is not a Google Ads account");
    const secrets = await this.integrationSecrets<GoogleAdsSecrets>(organizationId, account, "Google Ads");
    const { since, until } = this.dateRange(dto);
    const client = new GoogleAdsClient(secrets);
    let rows;
    try {
      rows = await client.getCampaignDaily(account.externalId, since, until);
    } catch (e) {
      await (this.prisma as any).integration.update({ where: { id: account.integrationId }, data: { status: "ERROR", lastError: e instanceof Error ? e.message : "Google sync failed" } });
      throw new BadRequestException(`Google Ads sync failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
    const { created, updated } = await this.upsertDailyRows(organizationId, account, "google", rows);
    await (this.prisma as any).integration.update({ where: { id: account.integrationId }, data: { status: "CONNECTED", lastError: null, lastSyncAt: new Date() } });
    return { rows: rows.length, created, updated, since, until };
  }

  // ---------- TikTok Ads ----------
  async connectTikTok(organizationId: string, actorId: string, dto: { advertiserId: string; accessToken: string }) {
    const client = new TikTokAdsClient(dto.accessToken);
    let advertiser: { id: string; name?: string; currency?: string };
    try {
      advertiser = await client.verifyAdvertiser(dto.advertiserId);
    } catch (e) {
      throw new BadRequestException(`TikTok verification failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
    const integration = await (this.prisma as any).integration.create({
      data: { organizationId, provider: "tiktok", status: "CONNECTED", externalAccountId: advertiser.id },
    });
    await (this.prisma as any).integrationCredential.create({
      data: { integrationId: integration.id, encryptedData: encryptJson({ accessToken: dto.accessToken }) },
    });
    const account = await (this.prisma as any).adAccount.upsert({
      where: { organizationId_platform_externalId: { organizationId, platform: "tiktok", externalId: advertiser.id } },
      update: { name: advertiser.name ?? `TikTok ${advertiser.id}`, currency: advertiser.currency ?? "USD", integrationId: integration.id, sourceType: "api" },
      create: { organizationId, platform: "tiktok", sourceType: "api", externalId: advertiser.id, name: advertiser.name ?? `TikTok ${advertiser.id}`, currency: advertiser.currency ?? "USD", integrationId: integration.id },
    });
    await this.audit.log({ organizationId, userId: actorId, action: "integration.connect", entityType: "Integration", entityId: integration.id, metadata: { provider: "tiktok" } });
    return { integrationId: integration.id, connectedAccounts: [account] };
  }

  async syncTikTokInsights(organizationId: string, actorId: string, accountId: string, dto: { since?: string; until?: string }) {
    const account = await this.getAccount(organizationId, accountId);
    if (account.platform !== "tiktok") throw new BadRequestException("This is not a TikTok Ads account");
    const secrets = await this.integrationSecrets<{ accessToken: string }>(organizationId, account, "TikTok");
    const { since, until } = this.dateRange(dto);
    const client = new TikTokAdsClient(secrets.accessToken);
    let rows;
    try {
      rows = await client.getCampaignDaily(account.externalId, since, until);
    } catch (e) {
      await (this.prisma as any).integration.update({ where: { id: account.integrationId }, data: { status: "ERROR", lastError: e instanceof Error ? e.message : "TikTok sync failed" } });
      throw new BadRequestException(`TikTok sync failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
    const { created, updated } = await this.upsertDailyRows(organizationId, account, "tiktok", rows);
    await (this.prisma as any).integration.update({ where: { id: account.integrationId }, data: { status: "CONNECTED", lastError: null, lastSyncAt: new Date() } });
    return { rows: rows.length, created, updated, since, until };
  }
}
