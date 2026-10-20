import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { decryptJson } from "../integrations/crypto";
import { GoogleAdsClient } from "../ads/google/google.client";
import { TikTokManage } from "../ads/tiktok/tiktok.client";
import { badRequest, notFound } from "../i18n/api-exception";

/**
 * Direct publishing to Google Ads and TikTok (Phase I).
 * Same discipline as Meta publishing: everything is created PAUSED /
 * DISABLED, ids are stored only when the platform returns them, and a
 * failed step marks the publication failed with that step's error —
 * earlier resource names stay in `detail` so nothing is hidden.
 */
@Injectable()
export class PublishingService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async list(organizationId: string) {
    return (this.prisma as any).platformPublication.findMany({
      where: { organizationId }, orderBy: { createdAt: "desc" }, take: 50,
    });
  }

  private async accountSecrets(organizationId: string, adAccountId: string, platform: string): Promise<any> {
    const account = await (this.prisma as any).adAccount.findFirst({ where: { id: adAccountId, organizationId } });
    if (!account) throw notFound("publishing.adAccountNotFound");
    if (account.platform !== platform || !account.integrationId) {
      throw badRequest("publishing.thisAdAccountIsNotConnected", { platform: platform });
    }
    const integration = await (this.prisma as any).integration.findFirst({
      where: { id: account.integrationId, organizationId }, include: { credential: true },
    });
    if (!integration?.credential) throw badRequest("publishing.credentialsAreMissingReconnectTheAccount", { platform: platform });
    return { account, secrets: decryptJson<any>(integration.credential.encryptedData) };
  }

  // ---------------- OU4: cross-platform campaign status + lifecycle ----------------
  private mapGoogleStatus(raw: string): string {
    const up = String(raw ?? "").toUpperCase();
    if (up === "ENABLED") return "active";
    if (up === "PAUSED") return "paused";
    if (up === "REMOVED") return "removed";
    return String(raw ?? "").toLowerCase();
  }

  private mapTikTokStatus(raw: string): string {
    const up = String(raw ?? "").toUpperCase();
    if (up === "ENABLE") return "active";
    if (up === "DISABLE") return "paused";
    return String(raw ?? "").toLowerCase();
  }

  /**
   * OU4: REAL provider status read for a campaign created
   * through the publish paths above. Google goes through
   * GoogleAdsClient.campaignManage().getCampaignStatus and
   * TikTok through TikTokManage.getCampaign — the verbatim
   * provider enum is kept in providerStatusRaw alongside the
   * mapped providerStatus. Missing/invalid account config
   * throws the honest accountSecrets error; callers decide
   * how to present it (CampaignsService sync catches it).
   * A provider "no such campaign" answer is also a throw —
   * never a fabricated status.
   */
  async crossPlatformCampaignStatus(organizationId: string, adAccountId: string, platform: string, externalCampaignId: string) {
    const p = String(platform ?? "").toLowerCase();
    if (!externalCampaignId) throw badRequest("publishing.externalcampaignidIsRequiredToReadCampaign");
    if (p === "google") {
      const { account, secrets } = await this.accountSecrets(organizationId, adAccountId, "google");
      if (!secrets.clientId || !secrets.clientSecret || !secrets.refreshToken || !secrets.developerToken) {
        throw badRequest("publishing.googleCredentialsAreMissingClientidClientsecret");
      }
      const customerId = String(account.externalId).replace(/-/g, "");
      const client = new GoogleAdsClient({
        clientId: secrets.clientId, clientSecret: secrets.clientSecret,
        refreshToken: secrets.refreshToken, developerToken: secrets.developerToken,
        ...(secrets.loginCustomerId ? { loginCustomerId: String(secrets.loginCustomerId) } : {}),
      });
      const result = await client.campaignManage().getCampaignStatus(customerId, externalCampaignId);
      if (!result) throw new Error(`Google returned no campaign with id ${externalCampaignId}; status is NOT confirmed`);
      return {
        platform: "google",
        externalCampaignId: result.campaignExternalId,
        ...(result.name ? { name: result.name } : {}),
        providerStatus: this.mapGoogleStatus(result.status),
        providerStatusRaw: result.status,
      };
    }
    if (p === "tiktok") {
      const { account, secrets } = await this.accountSecrets(organizationId, adAccountId, "tiktok");
      if (!secrets.accessToken) throw badRequest("publishing.tiktokCredentialsAreMissingAccesstokenReconnect");
      const advertiserId = String(secrets.advertiserId ?? account.externalId);
      const info = await new TikTokManage(secrets.accessToken).getCampaign(advertiserId, externalCampaignId);
      if (!info) throw new Error(`TikTok returned no campaign with id ${externalCampaignId}; status is NOT confirmed`);
      return {
        platform: "tiktok",
        externalCampaignId: info.campaignExternalId,
        ...(info.name ? { name: info.name } : {}),
        providerStatus: this.mapTikTokStatus(info.operationStatus),
        providerStatusRaw: info.operationStatus,
      };
    }
    throw badRequest("publishing.unsupportedCrossPlatformStatusPlatformGoogle", { platform: platform });
  }

  /**
   * OU4: REAL provider lifecycle change (pause/resume only —
   * there is no cross-platform delete here; see the OU4
   * acceptance note). The provider client throws unless the
   * platform accepts the change, so a resolved return means
   * the change WAS confirmed. No audit here — CampaignsService
   * owns the lifecycle audit + publish log, consistent with
   * the Meta setMetaStatus discipline. actorId is accepted
   * for signature symmetry with the publish methods.
   */
  async crossPlatformSetCampaignStatus(organizationId: string, actorId: string, adAccountId: string, platform: string, externalCampaignId: string, target: "ACTIVE" | "PAUSED") {
    void actorId;
    const p = String(platform ?? "").toLowerCase();
    if (!externalCampaignId) throw badRequest("publishing.externalcampaignidIsRequiredToChangeCampaign");
    if (target !== "ACTIVE" && target !== "PAUSED") throw badRequest("publishing.targetMustBeActiveOrPaused", { target: target });
    if (p === "google") {
      const { account, secrets } = await this.accountSecrets(organizationId, adAccountId, "google");
      if (!secrets.clientId || !secrets.clientSecret || !secrets.refreshToken || !secrets.developerToken) {
        throw badRequest("publishing.googleCredentialsAreMissingClientidClientsecret");
      }
      const customerId = String(account.externalId).replace(/-/g, "");
      const client = new GoogleAdsClient({
        clientId: secrets.clientId, clientSecret: secrets.clientSecret,
        refreshToken: secrets.refreshToken, developerToken: secrets.developerToken,
        ...(secrets.loginCustomerId ? { loginCustomerId: String(secrets.loginCustomerId) } : {}),
      });
      const raw = target === "ACTIVE" ? "ENABLED" : "PAUSED";
      await client.campaignManage().setCampaignStatus(customerId, externalCampaignId, raw as "ENABLED" | "PAUSED");
      return { platform: "google", externalCampaignId, providerStatus: target === "ACTIVE" ? "active" : "paused", providerStatusRaw: raw };
    }
    if (p === "tiktok") {
      const { account, secrets } = await this.accountSecrets(organizationId, adAccountId, "tiktok");
      if (!secrets.accessToken) throw badRequest("publishing.tiktokCredentialsAreMissingAccesstokenReconnect");
      const advertiserId = String(secrets.advertiserId ?? account.externalId);
      const raw = target === "ACTIVE" ? "ENABLE" : "DISABLE";
      await new TikTokManage(secrets.accessToken).setCampaignStatus(advertiserId, externalCampaignId, raw as "ENABLE" | "DISABLE");
      return { platform: "tiktok", externalCampaignId, providerStatus: target === "ACTIVE" ? "active" : "paused", providerStatusRaw: raw };
    }
    throw badRequest("publishing.unsupportedCrossPlatformLifecyclePlatformGoogle", { platform: platform });
  }

  private async startRecord(organizationId: string, actorId: string, platform: string, adAccountId: string, name: string) {
    return (this.prisma as any).platformPublication.create({
      data: { organizationId, platform, adAccountId, name, status: "pending", createdById: actorId },
    });
  }
  private async finishRecord(id: string, status: string, detail: any, error?: string, externalCampaignId?: string) {
    await (this.prisma as any).platformPublication.update({
      where: { id }, data: { status, detail, error: error ?? null, externalCampaignId: externalCampaignId ?? null },
    });
    return (this.prisma as any).platformPublication.findUnique({ where: { id } });
  }

  // ---------------- Google Ads ----------------
  async publishGoogle(organizationId: string, actorId: string, dto: {
    adAccountId: string; name: string; dailyBudget: string; countryCodes: string[];
    headlines: string[]; descriptions: string[]; finalUrl: string;
    // CA17: the plan's UTM params as the campaign's
    // Final URL Suffix. Optional — absent keeps the
    // pre-CA17 campaign payload byte-identical.
    finalUrlSuffix?: string;
    keywords: { text: string; matchType?: string }[];
    negativeKeywords?: string[];
    sitelinks?: { text: string; url: string }[];
    callouts?: string[];
  }) {
    if (!dto.headlines || dto.headlines.length < 3) throw badRequest("publishing.googleRsaNeedsAtLeast3");
    if (!dto.descriptions || dto.descriptions.length < 2) throw badRequest("publishing.googleRsaNeedsAtLeast2");
    if (dto.headlines.some((h) => h.length > 30)) throw badRequest("publishing.googleHeadlinesAreLimitedTo30");
    if (dto.descriptions.some((d) => d.length > 90)) throw badRequest("publishing.googleDescriptionsAreLimitedTo90");
    const daily = Number(dto.dailyBudget);
    if (!Number.isFinite(daily) || daily <= 0) throw badRequest("publishing.dailybudgetMustBeAPositiveAmount");
    if (!dto.countryCodes?.length) throw badRequest("publishing.atLeastOneCountryIsRequired");
    if (!dto.keywords?.length) throw badRequest("publishing.aSearchCampaignNeedsAtLeast");
    if (dto.keywords.length > 100) throw badRequest("publishing.atMost100KeywordsPerAd");
    for (const kw of dto.keywords) {
      if (!kw.text?.trim() || kw.text.length > 80) throw badRequest("publishing.eachKeywordNeedsTextOfAt");
      const mt = String(kw.matchType ?? "EXACT").toUpperCase();
      if (!["BROAD", "EXACT", "PHRASE"].includes(mt)) throw badRequest("publishing.invalidMatchType", { kwMatchType: kw.matchType });
    }
    for (const s of dto.sitelinks ?? []) {
      if (!s.text?.trim() || s.text.length > 25) throw badRequest("publishing.sitelinkTextIsLimitedTo25");
      if (!s.url?.startsWith("http")) throw badRequest("publishing.sitelinkUrlMustBeAnHttp");
    }
    for (const c of dto.callouts ?? []) {
      if (c.length > 25) throw badRequest("publishing.calloutTextIsLimitedTo25");
    }

    const { account, secrets } = await this.accountSecrets(organizationId, dto.adAccountId, "google");
    const record = await this.startRecord(organizationId, actorId, "google", dto.adAccountId, dto.name);
    const detail: any = { steps: [] };
    const customerId = String(account.externalId).replace(/-/g, "");
    const base = `https://googleads.googleapis.com/v17/customers/${customerId}`;
    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: secrets.clientId, client_secret: secrets.clientSecret, refresh_token: secrets.refreshToken, grant_type: "refresh_token" }),
      });
      const tokenJson: any = await tokenRes.json().catch(() => null);
      if (!tokenRes.ok || !tokenJson?.access_token) throw new Error(`Google OAuth failed: ${tokenJson?.error_description ?? tokenJson?.error ?? tokenRes.status}`);
      const headers: Record<string, string> = {
        Authorization: `Bearer ${tokenJson.access_token}`,
        "developer-token": secrets.developerToken,
        "Content-Type": "application/json",
        ...(secrets.loginCustomerId ? { "login-customer-id": String(secrets.loginCustomerId).replace(/-/g, "") } : {}),
      };
      const mutate = async (path: string, operations: any[], step: string) => {
        const res = await fetch(`${base}/${path}:mutate`, { method: "POST", headers, body: JSON.stringify({ operations }) });
        const json: any = await res.json().catch(() => null);
        if (!res.ok || json?.error) throw new Error(`${step}: ${json?.error?.message ?? `HTTP ${res.status}`}`);
        const resourceName = json?.results?.[0]?.resourceName as string | undefined;
        if (!resourceName) throw new Error(`${step}: Google returned no resource name; creation is NOT confirmed`);
        detail.steps.push({ step, resourceName });
        return resourceName;
      };

      const budgetResource = await mutate("campaignBudgets", [{ create: { name: `${dto.name} budget`, amountMicros: Math.round(daily * 1_000_000), deliveryMethod: "STANDARD" } }], "budget");
      const campaignResource = await mutate("campaigns", [{ create: {
        name: dto.name, advertisingChannelType: "SEARCH", status: "PAUSED", campaignBudget: budgetResource,
        networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false },
        containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
        ...(dto.finalUrlSuffix ? { finalUrlSuffix: dto.finalUrlSuffix } : {}),
      } }], "campaign");
      for (const code of dto.countryCodes) {
        const suggestRes = await fetch("https://googleads.googleapis.com/v17/geoTargetConstants:suggest", {
          method: "POST", headers, body: JSON.stringify({ locale: "en", countryCode: code.toUpperCase() }),
        });
        const suggestJson: any = await suggestRes.json().catch(() => null);
        const geo = suggestJson?.geoTargetConstantSuggestions?.[0]?.geoTargetConstant?.resourceName as string | undefined;
        if (!geo) throw new Error(`location: no geo target found for country ${code}`);
        await mutate("campaignCriteria", [{ create: { campaign: campaignResource, type: "LOCATION", negative: false, location: { geoTargetConstant: geo } } }], `location ${code}`);
      }
      const adGroupResource = await mutate("adGroups", [{ create: {
        name: `${dto.name} - AG1`, campaign: campaignResource, status: "PAUSED", type: "SEARCH_STANDARD",
        cpcBidMicros: 1_000_000, // standard 1-unit default bid; the owner adjusts it in Google Ads
      } }], "ad group");
      await mutate("adGroupAds", [{ create: {
        adGroup: adGroupResource, status: "PAUSED",
        ad: { finalUrls: [dto.finalUrl], responsiveSearchAd: {
          headlines: dto.headlines.map((text) => ({ text })), descriptions: dto.descriptions.map((text) => ({ text })),
        } },
      } }], "responsive search ad");
      for (const kw of dto.keywords) {
        await mutate("adGroupCriteria", [{ create: {
          adGroup: adGroupResource, status: "PAUSED", type: "KEYWORD", negative: false,
          keyword: { text: kw.text.trim(), matchType: String(kw.matchType ?? "EXACT").toUpperCase() },
        } }], `keyword "${kw.text.trim()}"`);
      }
      for (const neg of dto.negativeKeywords ?? []) {
        if (!neg.trim()) continue;
        await mutate("adGroupCriteria", [{ create: {
          adGroup: adGroupResource, type: "KEYWORD", negative: true,
          keyword: { text: neg.trim(), matchType: "BROAD" },
        } }], `negative keyword "${neg.trim()}"`);
      }
      for (const [i, s] of (dto.sitelinks ?? []).entries()) {
        const asset = await mutate("assets", [{ create: {
          name: `${dto.name} sitelink ${i + 1}`, finalUrls: [s.url],
          sitelinkAsset: { linkText: s.text.trim() },
        } }], `sitelink asset "${s.text.trim()}"`);
        await mutate("campaignAssets", [{ create: { campaign: campaignResource, asset, fieldType: "SITELINK" } }], "link sitelink");
      }
      for (const [i, text] of (dto.callouts ?? []).entries()) {
        if (!text.trim()) continue;
        const asset = await mutate("assets", [{ create: {
          name: `${dto.name} callout ${i + 1}`,
          calloutAsset: { calloutText: text.trim() },
        } }], `callout asset "${text.trim()}"`);
        await mutate("campaignAssets", [{ create: { campaign: campaignResource, asset, fieldType: "CALLOUT" } }], "link callout");
      }
      detail.note = "Created PAUSED. The ad group carries a standard 1-unit default CPC bid — review budgets and bids in Google Ads before enabling.";
      const done = await this.finishRecord(record.id, "created_paused", detail, undefined, campaignResource.split("/").pop());
      await this.audit.log({ organizationId, userId: actorId, action: "publish.google", entityType: "PlatformPublication", entityId: record.id, metadata: { campaign: campaignResource } });
      return done;
    } catch (e) {
      return this.finishRecord(record.id, "failed", detail, e instanceof Error ? e.message : "Google publish failed");
    }
  }

  // ---------------- TikTok Ads ----------------
  /**
   * Frontier NB8 / CN17: `objectiveType` is OPTIONAL and is
   * only ever supplied by the campaign-plan draft path
   * (CampaignsService cross-platform drafts). The direct
   * publishing page never sends it, and with it absent the
   * payloads below are byte-identical to the pre-NB8
   * TRAFFIC behaviour. Spike basis (TikTok Marketing API
   * v1.3 docs + the official SDK field spec, read
   * 2026-10-15): the objective enum includes TRAFFIC,
   * WEB_CONVERSIONS (the current API name for the Ads
   * Manager "Website conversions" objective) and
   * LEAD_GENERATION. For WEB_CONVERSIONS the ad group
   * carries pixel_id + optimization_event (required
   * together), optimization_goal CONVERT and billing
   * OCPM; an ad-group pixel_id with any other objective
   * is rejected by TikTok, so it is never sent there.
   * LEAD_GENERATION needs a TikTok Instant Form bound at
   * the AD level — this flow creates website creatives
   * and has no form binding, so it refuses up front
   * instead of making a create call TikTok would reject.
   */
  async publishTikTok(organizationId: string, actorId: string, dto: {
    adAccountId: string; name: string; dailyBudget: string; countryCodes: string[];
    adText: string; landingUrl: string; imageUrl?: string; videoUrl?: string; identityId?: string;
    objectiveType?: string; pixelId?: string; optimizationEvent?: string;
  }) {
    const daily = Number(dto.dailyBudget);
    if (!Number.isFinite(daily) || daily <= 0) throw badRequest("publishing.dailybudgetMustBeAPositiveAmount");
    if (!dto.countryCodes?.length) throw badRequest("publishing.atLeastOneCountryIsRequired");
    if (!dto.videoUrl && !dto.imageUrl) throw badRequest("publishing.provideAnImageUrlOrA");
    const objective = String(dto.objectiveType ?? "TRAFFIC").trim().toUpperCase() || "TRAFFIC";
    if (!["TRAFFIC", "WEB_CONVERSIONS", "LEAD_GENERATION"].includes(objective)) {
      throw badRequest("publishing.unsupportedTiktokObjectiveForThisFlow", { objective: objective });
    }
    if (objective === "LEAD_GENERATION") {
      throw badRequest("publishing.tiktokLeadGenerationNeedsAnInstant");
    }
    if (objective === "WEB_CONVERSIONS" && (!dto.pixelId?.trim() || !dto.optimizationEvent?.trim())) {
      throw badRequest("publishing.tiktokWebConversionsNeedsAPixelid");
    }
    const { account, secrets } = await this.accountSecrets(organizationId, dto.adAccountId, "tiktok");
    const advertiserId = String(secrets.advertiserId ?? account.externalId);
    const record = await this.startRecord(organizationId, actorId, "tiktok", dto.adAccountId, dto.name);
    const detail: any = { steps: [] };
    const api = "https://business-api.tiktok.com/open_api/v1.3";
    const headers = { "Access-Token": secrets.accessToken, "Content-Type": "application/json" };
    const call = async (path: string, method: "GET" | "POST", payload: any, step: string) => {
      const url = method === "GET" ? `${api}${path}?${new URLSearchParams(payload).toString()}` : `${api}${path}`;
      const res = await fetch(url, { method, headers, ...(method === "POST" ? { body: JSON.stringify(payload) } : {}) });
      const json: any = await res.json().catch(() => null);
      if (!res.ok || (json?.code !== undefined && json.code !== 0)) {
        throw new Error(`${step}: ${json?.message ?? `HTTP ${res.status}`}`);
      }
      detail.steps.push({ step });
      return json?.data;
    };
    try {
      let identityId = dto.identityId;
      if (!identityId) {
        const identities = await call("/identity/get/", "GET", { advertiser_id: advertiserId }, "identity lookup");
        const list = identities?.identity_list ?? identities?.list ?? [];
        const custom = list.find((i: any) => i.identity_type === "CUSTOMIZED_USER") ?? list[0];
        identityId = custom?.identity_id;
        if (!identityId) throw new Error("identity lookup: no TikTok identity is available for this advertiser");
      }
      detail.identityId = identityId;
      const locations = await call("/tool/location/", "GET", { advertiser_id: advertiserId, language: "EN" }, "location lookup");
      const regionList: any[] = locations?.list ?? locations?.regions ?? [];
      const locationIds: number[] = [];
      for (const code of dto.countryCodes) {
        const hit = regionList.find((r: any) => String(r.code ?? r.region_code ?? "").toUpperCase() === code.toUpperCase());
        if (!hit) throw new Error(`location lookup: no TikTok location id resolved for ${code} — refusing to guess`);
        locationIds.push(Number(hit.location_id ?? hit.id));
      }
      detail.objectiveType = objective;
      const campaign = await call("/campaign/create/", "POST", {
        advertiser_id: advertiserId, campaign_name: dto.name, objective_type: objective, operation_status: "DISABLE",
      }, "campaign");
      if (!campaign?.campaign_id) throw new Error("campaign: TikTok returned no campaign id; creation is NOT confirmed");
      detail.campaignId = String(campaign.campaign_id);
      // CN17: only the WEB_CONVERSIONS branch differs from
      // the long-standing TRAFFIC payload — pixel and event
      // on the ad group, CONVERT goal, OCPM billing, no-bid
      // (the documented auction shape for pixel events).
      const adgroupPayload: Record<string, unknown> = objective === "WEB_CONVERSIONS"
        ? {
          advertiser_id: advertiserId, campaign_id: campaign.campaign_id, adgroup_name: `${dto.name} - AG1`,
          objective_type: "WEB_CONVERSIONS", promotion_type: "WEBSITE", placement_type: "PLACEMENT_TYPE_AUTOMATIC", location_ids: locationIds,
          pixel_id: String(dto.pixelId).trim(), optimization_event: String(dto.optimizationEvent).trim(),
          budget_mode: "BUDGET_MODE_DAY", budget: daily, schedule_type: "SCHEDULE_FROM_NOW",
          billing_event: "OCPM", optimization_goal: "CONVERT", bid_type: "BID_TYPE_NO_BID", operation_status: "DISABLE",
        }
        : {
          advertiser_id: advertiserId, campaign_id: campaign.campaign_id, adgroup_name: `${dto.name} - AG1`,
          objective_type: "TRAFFIC", placement_type: "PLACEMENT_TYPE_AUTOMATIC", location_ids: locationIds,
          budget_mode: "BUDGET_MODE_DAY", budget: daily, schedule_type: "SCHEDULE_FROM_NOW",
          billing_event: "CPC", optimization_goal: "CLICK", operation_status: "DISABLE",
        };
      const adgroup = await call("/adgroup/create/", "POST", adgroupPayload, "ad group");
      if (!adgroup?.adgroup_id) throw new Error("ad group: TikTok returned no adgroup id; creation is NOT confirmed");
      detail.adgroupId = String(adgroup.adgroup_id);
      let creativeFields: Record<string, unknown>;
      if (dto.videoUrl) {
        // Video creative (Milestone 32): upload by URL, then a
        // SINGLE_VIDEO ad. Counts only with a real video id back.
        const video = await call("/file/video/ad/upload/", "POST", {
          advertiser_id: advertiserId, upload_type: "UPLOAD_BY_URL", video_url: dto.videoUrl,
        }, "video upload");
        const videoId = Array.isArray(video) ? video[0]?.video_id
          : Array.isArray(video?.list) ? video.list[0]?.video_id : video?.video_id;
        if (!videoId) throw new Error("video upload: TikTok returned no video id; upload is NOT confirmed");
        detail.videoId = String(videoId);
        creativeFields = { video_id: videoId, ad_format: "SINGLE_VIDEO" };
      } else {
        const image = await call("/file/image/ad/upload/", "POST", {
          advertiser_id: advertiserId, upload_type: "UPLOAD_BY_URL", image_url: dto.imageUrl,
        }, "image upload");
        const imageId = Array.isArray(image) ? image[0]?.image_id : image?.image_id;
        if (!imageId) throw new Error("image upload: TikTok returned no image id; upload is NOT confirmed");
        creativeFields = { image_ids: [imageId] };
      }
      const ad = await call("/ad/create/", "POST", {
        advertiser_id: advertiserId, adgroup_id: adgroup.adgroup_id, ad_name: dto.name,
        identity_id: identityId, identity_type: "CUSTOMIZED_USER",
        ad_text: dto.adText, landing_url: dto.landingUrl, ...creativeFields,
        call_to_action: "LEARN_MORE", operation_status: "DISABLE",
      }, "ad");
      const adId = Array.isArray(ad?.ad_ids) ? ad.ad_ids[0] : ad?.ad_id;
      if (!adId) throw new Error("ad: TikTok returned no ad id; creation is NOT confirmed");
      detail.adId = String(adId);
      detail.note = "Created DISABLED at every level. Review and enable in TikTok Ads Manager.";
      const done = await this.finishRecord(record.id, "created_paused", detail, undefined, detail.campaignId);
      await this.audit.log({ organizationId, userId: actorId, action: "publish.tiktok", entityType: "PlatformPublication", entityId: record.id, metadata: { campaignId: detail.campaignId } });
      return done;
    } catch (e) {
      return this.finishRecord(record.id, "failed", detail, e instanceof Error ? e.message : "TikTok publish failed");
    }
  }

  // ---------------- Google Performance Max (Milestone 32) ----------------
  /**
   * Performance Max skeleton with the same discipline as the Search
   * chain: budget -> PAUSED PMax campaign -> location criteria ->
   * PAUSED asset group -> text/image assets -> asset links -> the
   * all-products listing group filter. Asset minimums follow
   * Google's published requirements; image assets are fetched and
   * uploaded as base64 bytes (Google has no by-URL image asset).
   * Any failed step marks the publication failed with Google's own
   * error and keeps earlier resource names in detail.
   */
  async publishGooglePmax(organizationId: string, actorId: string, dto: {
    adAccountId: string; name: string; dailyBudget: string; countryCodes: string[];
    finalUrl: string; businessName: string;
    // CA17: as publishGoogle — optional Final URL Suffix.
    finalUrlSuffix?: string;
    headlines: string[]; longHeadlines: string[]; descriptions: string[];
    logoUrl: string; imageUrls: string[];
  }) {
    if (!dto.headlines || dto.headlines.length < 3 || dto.headlines.length > 15) throw badRequest("publishing.performanceMaxNeeds315Headlines");
    if (dto.headlines.some((h) => !h?.trim() || h.length > 30)) throw badRequest("publishing.pmaxHeadlinesAreLimitedTo30");
    if (!dto.longHeadlines?.length || dto.longHeadlines.length > 5) throw badRequest("publishing.performanceMaxNeeds15Long");
    if (dto.longHeadlines.some((h) => h.length > 90)) throw badRequest("publishing.pmaxLongHeadlinesAreLimitedTo");
    if (!dto.descriptions || dto.descriptions.length < 2 || dto.descriptions.length > 5) throw badRequest("publishing.performanceMaxNeeds25Descriptions");
    if (dto.descriptions.some((d) => d.length > 90)) throw badRequest("publishing.pmaxDescriptionsAreLimitedTo90");
    if (!dto.businessName?.trim() || dto.businessName.length > 25) throw badRequest("publishing.businessNameIsRequiredMax25");
    if (!dto.logoUrl?.startsWith("http")) throw badRequest("publishing.aLogoImageUrlIsRequired");
    if (!dto.imageUrls?.length || dto.imageUrls.length > 20) throw badRequest("publishing.performanceMaxNeeds120Marketing");
    if (dto.imageUrls.some((u) => !u?.startsWith("http"))) throw badRequest("publishing.imageUrlsMustBeHttpS");
    const daily = Number(dto.dailyBudget);
    if (!Number.isFinite(daily) || daily <= 0) throw badRequest("publishing.dailybudgetMustBeAPositiveAmount");
    if (!dto.countryCodes?.length) throw badRequest("publishing.atLeastOneCountryIsRequired");

    const { account, secrets } = await this.accountSecrets(organizationId, dto.adAccountId, "google");
    const record = await this.startRecord(organizationId, actorId, "google", dto.adAccountId, dto.name);
    const detail: any = { steps: [], kind: "performance_max" };
    const customerId = String(account.externalId).replace(/-/g, "");
    const base = `https://googleads.googleapis.com/v17/customers/${customerId}`;
    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: secrets.clientId, client_secret: secrets.clientSecret, refresh_token: secrets.refreshToken, grant_type: "refresh_token" }),
      });
      const tokenJson: any = await tokenRes.json().catch(() => null);
      if (!tokenRes.ok || !tokenJson?.access_token) throw new Error(`Google OAuth failed: ${tokenJson?.error_description ?? tokenJson?.error ?? tokenRes.status}`);
      const headers: Record<string, string> = {
        Authorization: `Bearer ${tokenJson.access_token}`,
        "developer-token": secrets.developerToken,
        "Content-Type": "application/json",
        ...(secrets.loginCustomerId ? { "login-customer-id": String(secrets.loginCustomerId).replace(/-/g, "") } : {}),
      };
      const mutate = async (path: string, operations: any[], step: string) => {
        const res = await fetch(`${base}/${path}:mutate`, { method: "POST", headers, body: JSON.stringify({ operations }) });
        const json: any = await res.json().catch(() => null);
        if (!res.ok || json?.error) throw new Error(`${step}: ${json?.error?.message ?? `HTTP ${res.status}`}`);
        const resourceName = json?.results?.[0]?.resourceName as string | undefined;
        if (!resourceName) throw new Error(`${step}: Google returned no resource name; creation is NOT confirmed`);
        detail.steps.push({ step, resourceName });
        return resourceName;
      };

      const budgetResource = await mutate("campaignBudgets", [{ create: { name: `${dto.name} budget`, amountMicros: Math.round(daily * 1_000_000), deliveryMethod: "STANDARD" } }], "budget");
      const campaignResource = await mutate("campaigns", [{ create: {
        name: dto.name, advertisingChannelType: "PERFORMANCE_MAX", status: "PAUSED", campaignBudget: budgetResource,
        containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
        ...(dto.finalUrlSuffix ? { finalUrlSuffix: dto.finalUrlSuffix } : {}),
      } }], "campaign");
      // Location criteria resolved via Google's own geo suggest — never hardcoded ids.
      for (const code of dto.countryCodes) {
        const suggestRes = await fetch(`${base}/geoTargetConstants:suggest`, {
          method: "POST", headers, body: JSON.stringify({ locale: "en", countryCode: code, locationNames: { names: [code] } }),
        });
        const suggestJson: any = await suggestRes.json().catch(() => null);
        const resourceName = suggestJson?.geoTargetConstantSuggestions?.[0]?.geoTargetConstant?.resourceName as string | undefined;
        if (!suggestRes.ok || !resourceName) throw new Error(`location suggest for ${code}: ${suggestJson?.error?.message ?? "no suggestion returned; refusing to guess"}`);
        await mutate("campaignCriteria", [{ create: { campaign: campaignResource, location: { geoTargetConstant: resourceName } } }], `location ${code}`);
      }
      const assetGroupResource = await mutate("assetGroups", [{ create: {
        name: `${dto.name} - AG1`, campaign: campaignResource, finalUrls: [dto.finalUrl], status: "PAUSED",
      } }], "asset group");

      const textAsset = async (text: string, step: string) => mutate("assets", [{ create: { type: "TEXT", textAsset: { text } } }], step);
      const imageAsset = async (url: string, step: string) => {
        const imgRes = await fetch(url);
        if (!imgRes.ok) throw new Error(`${step}: could not fetch image ${url} (HTTP ${imgRes.status})`);
        const data = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
        return mutate("assets", [{ create: { type: "IMAGE", imageAsset: { data } } }], step);
      };
      const links: { assetGroup: string; asset: string; fieldType: string }[] = [];
      for (const h of dto.headlines) links.push({ assetGroup: assetGroupResource, asset: await textAsset(h, "headline asset"), fieldType: "HEADLINE" });
      for (const h of dto.longHeadlines) links.push({ assetGroup: assetGroupResource, asset: await textAsset(h, "long headline asset"), fieldType: "LONG_HEADLINE" });
      for (const d of dto.descriptions) links.push({ assetGroup: assetGroupResource, asset: await textAsset(d, "description asset"), fieldType: "DESCRIPTION" });
      links.push({ assetGroup: assetGroupResource, asset: await textAsset(dto.businessName, "business name asset"), fieldType: "BUSINESS_NAME" });
      links.push({ assetGroup: assetGroupResource, asset: await imageAsset(dto.logoUrl, "logo asset"), fieldType: "LOGO" });
      for (const url of dto.imageUrls) links.push({ assetGroup: assetGroupResource, asset: await imageAsset(url, "marketing image asset"), fieldType: "MARKETING_IMAGE" });
      await mutate("assetGroupAssets", links.map((l) => ({ create: l })), "asset group links");
      // All-products listing group: a single UNIT_INCLUDED root node.
      await mutate("assetGroupListingGroupFilters", [{ create: {
        assetGroup: assetGroupResource, type: "UNIT_INCLUDED", caseValue: { listingGroup: {} },
      } }], "listing group filter");

      detail.note = "Created PAUSED (campaign + asset group). Performance Max has no keywords; review assets and the listing group in Google Ads before enabling.";
      const done = await this.finishRecord(record.id, "created_paused", detail, undefined, campaignResource.split("/").pop());
      await this.audit.log({ organizationId, userId: actorId, action: "publish.google_pmax", entityType: "PlatformPublication", entityId: record.id, metadata: { campaign: campaignResource } });
      return done;
    } catch (e) {
      return this.finishRecord(record.id, "failed", detail, e instanceof Error ? e.message : "Performance Max publish failed");
    }
  }

  // ---------------- CA16 (CB4): post-publish control ----------------
  /**
   * Spike basis (official docs, verified 2026-10-17 — see
   * docs/campaign-advanced-cb4-acceptance.md): Google Ads
   * API MutateCampaigns accepts an `update` operation
   * (campaign resource + updateMask) — the official
   * "Update Campaign" sample sets status PAUSED exactly
   * this way; CampaignBudgetService.MutateCampaignBudgets
   * is the same mutate framework for amount_micros; and
   * the API has ONE OAuth scope
   * (https://www.googleapis.com/auth/adwords) for reads
   * and writes alike — the very scope the stored refresh
   * token already exercises for the CREATE mutates above
   * and for reporting search. TikTok: the official SDK
   * documents POST /campaign/status/update/
   * {advertiser_id, campaign_ids, operation_status},
   * POST /adgroup/update/ (budget = the ad-group budget —
   * the level THIS flow's budgets live on) and
   * GET /campaign/get/ for the campaign's own status
   * fields; the stored advertiser token already performs
   * create writes with the same authorization.
   * These methods CONFIRM through the platform's own
   * response: a Google mutate without a result resource
   * name, or a TikTok envelope with code !== 0, is a
   * failure and throws — callers record nothing locally.
   */
  private async googleAuthHeaders(secrets: any): Promise<Record<string, string>> {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: secrets.clientId, client_secret: secrets.clientSecret, refresh_token: secrets.refreshToken, grant_type: "refresh_token" }),
    });
    const tokenJson: any = await tokenRes.json().catch(() => null);
    if (!tokenRes.ok || !tokenJson?.access_token) throw new Error(`Google OAuth failed: ${tokenJson?.error_description ?? tokenJson?.error ?? tokenRes.status}`);
    return {
      Authorization: `Bearer ${tokenJson.access_token}`,
      "developer-token": secrets.developerToken,
      "Content-Type": "application/json",
      ...(secrets.loginCustomerId ? { "login-customer-id": String(secrets.loginCustomerId).replace(/-/g, "") } : {}),
    };
  }

  private async googleMutate(base: string, headers: Record<string, string>, path: string, operations: any[], step: string): Promise<string> {
    const res = await fetch(`${base}/${path}:mutate`, { method: "POST", headers, body: JSON.stringify({ operations }) });
    const json: any = await res.json().catch(() => null);
    if (!res.ok || json?.error) throw new Error(`${step}: ${json?.error?.message ?? `HTTP ${res.status}`}`);
    const resourceName = json?.results?.[0]?.resourceName as string | undefined;
    if (!resourceName) throw new Error(`${step}: Google returned no resource name; the change is NOT confirmed`);
    return resourceName;
  }

  /** Live campaign status, read back via GAQL
   * (campaign.status is a selectable field). Returns
   * Google's verbatim enum string, or null when Google
   * returns no row for the campaign — never guessed. */
  async getGoogleCampaignStatus(organizationId: string, adAccountId: string, externalCampaignId: string): Promise<{ status: string | null }> {
    const { account, secrets } = await this.accountSecrets(organizationId, adAccountId, "google");
    const customerId = String(account.externalId).replace(/-/g, "");
    const headers = await this.googleAuthHeaders(secrets);
    const id = String(externalCampaignId).replace(/[^0-9]/g, "");
    if (!id) throw new Error("Google campaign id is not numeric — status cannot be read");
    const res = await fetch(`https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:search`, {
      method: "POST", headers, body: JSON.stringify({ query: `SELECT campaign.id, campaign.status FROM campaign WHERE campaign.id = ${id}` }),
    });
    const json: any = await res.json().catch(() => null);
    if (!res.ok || json?.error) throw new Error(`Google status read: ${json?.error?.details?.[0]?.errors?.[0]?.message ?? json?.error?.message ?? `HTTP ${res.status}`}`);
    const status = json?.results?.[0]?.campaign?.status;
    return { status: status ? String(status) : null };
  }

  async setGoogleCampaignStatus(organizationId: string, adAccountId: string, externalCampaignId: string, target: "ENABLED" | "PAUSED"): Promise<{ status: string }> {
    const { account, secrets } = await this.accountSecrets(organizationId, adAccountId, "google");
    const customerId = String(account.externalId).replace(/-/g, "");
    const headers = await this.googleAuthHeaders(secrets);
    const base = `https://googleads.googleapis.com/v17/customers/${customerId}`;
    await this.googleMutate(base, headers, "campaigns", [{
      update: { resourceName: `customers/${customerId}/campaigns/${String(externalCampaignId)}`, status: target },
      updateMask: "status",
    }], "campaign status");
    return { status: target };
  }

  /** The budget is its own resource: the resource name
   * comes from the creation record's steps (the caller
   * resolves it); amount goes as amount_micros with the
   * amount_micros update mask. */
  async updateGoogleCampaignBudget(organizationId: string, adAccountId: string, budgetResourceName: string, dailyAmount: number): Promise<void> {
    const { account, secrets } = await this.accountSecrets(organizationId, adAccountId, "google");
    const customerId = String(account.externalId).replace(/-/g, "");
    const headers = await this.googleAuthHeaders(secrets);
    const base = `https://googleads.googleapis.com/v17/customers/${customerId}`;
    await this.googleMutate(base, headers, "campaignBudgets", [{
      update: { resourceName: budgetResourceName, amountMicros: Math.round(dailyAmount * 1_000_000) },
      updateMask: "amount_micros",
    }], "campaign budget");
  }

  private async tiktokCall(secrets: any, advertiserId: string, path: string, method: "GET" | "POST", payload: any, step: string): Promise<any> {
    const api = "https://business-api.tiktok.com/open_api/v1.3";
    const headers = { "Access-Token": secrets.accessToken, "Content-Type": "application/json" };
    const url = method === "GET" ? `${api}${path}?${new URLSearchParams(payload).toString()}` : `${api}${path}`;
    const res = await fetch(url, { method, headers, ...(method === "POST" ? { body: JSON.stringify(payload) } : {}) });
    const json: any = await res.json().catch(() => null);
    if (!res.ok || (json?.code !== undefined && json.code !== 0)) {
      throw new Error(`${step}: ${json?.message ?? `HTTP ${res.status}`}`);
    }
    return json?.data;
  }

  /** Live campaign status from /campaign/get/ — TikTok's
   * own fields verbatim (operation_status is the
   * configured ENABLE/DISABLE; secondary_status is
   * TikTok's delivery status). Absent fields stay null. */
  async getTikTokCampaignStatus(organizationId: string, adAccountId: string, externalCampaignId: string): Promise<{ operationStatus: string | null; secondaryStatus: string | null }> {
    const { account, secrets } = await this.accountSecrets(organizationId, adAccountId, "tiktok");
    const advertiserId = String(secrets.advertiserId ?? account.externalId);
    const id = Number(externalCampaignId);
    if (!Number.isFinite(id)) throw new Error("TikTok campaign id is not numeric — status cannot be read");
    const data = await this.tiktokCall(secrets, advertiserId, "/campaign/get/", "GET", {
      advertiser_id: advertiserId, filtering: JSON.stringify({ campaign_ids: [id] }),
    }, "campaign status read");
    const row = Array.isArray(data?.list) ? data.list[0] : undefined;
    return {
      operationStatus: row?.operation_status ? String(row.operation_status) : null,
      secondaryStatus: row?.secondary_status ? String(row.secondary_status) : null,
    };
  }

  async setTikTokCampaignStatus(organizationId: string, adAccountId: string, externalCampaignId: string, target: "ENABLE" | "DISABLE"): Promise<{ status: string }> {
    const { account, secrets } = await this.accountSecrets(organizationId, adAccountId, "tiktok");
    const advertiserId = String(secrets.advertiserId ?? account.externalId);
    const id = Number(externalCampaignId);
    if (!Number.isFinite(id)) throw new Error("TikTok campaign id is not numeric — status cannot be changed");
    await this.tiktokCall(secrets, advertiserId, "/campaign/status/update/", "POST", {
      advertiser_id: advertiserId, campaign_ids: [id], operation_status: target,
    }, "campaign status");
    return { status: target };
  }

  /** Budget edit at the level this flow PUT the budget:
   * the ad group (publishTikTok sets budget +
   * BUDGET_MODE_DAY on the ad group; the campaign itself
   * carries none). /campaign/update/ budget is NOT used —
   * it would address a campaign-level budget these
   * campaigns do not have. */
  async updateTikTokAdGroupBudget(organizationId: string, adAccountId: string, adgroupId: string, dailyBudget: number): Promise<void> {
    const { account, secrets } = await this.accountSecrets(organizationId, adAccountId, "tiktok");
    const advertiserId = String(secrets.advertiserId ?? account.externalId);
    const id = Number(adgroupId);
    if (!Number.isFinite(id)) throw new Error("TikTok ad group id is not numeric — budget cannot be changed");
    await this.tiktokCall(secrets, advertiserId, "/adgroup/update/", "POST", {
      advertiser_id: advertiserId, adgroup_id: id, budget: dailyBudget,
    }, "ad group budget");
  }
}
