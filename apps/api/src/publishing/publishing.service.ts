import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { decryptJson } from "../integrations/crypto";

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
    if (!account) throw new NotFoundException("Ad account not found");
    if (account.platform !== platform || !account.integrationId) {
      throw new BadRequestException(`This ad account is not connected to ${platform} via API`);
    }
    const integration = await (this.prisma as any).integration.findFirst({
      where: { id: account.integrationId, organizationId }, include: { credential: true },
    });
    if (!integration?.credential) throw new BadRequestException(`${platform} credentials are missing; reconnect the account`);
    return { account, secrets: decryptJson<any>(integration.credential.encryptedData) };
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
    keywords: { text: string; matchType?: string }[];
    negativeKeywords?: string[];
    sitelinks?: { text: string; url: string }[];
    callouts?: string[];
  }) {
    if (!dto.headlines || dto.headlines.length < 3) throw new BadRequestException("Google RSA needs at least 3 headlines");
    if (!dto.descriptions || dto.descriptions.length < 2) throw new BadRequestException("Google RSA needs at least 2 descriptions");
    if (dto.headlines.some((h) => h.length > 30)) throw new BadRequestException("Google headlines are limited to 30 characters");
    if (dto.descriptions.some((d) => d.length > 90)) throw new BadRequestException("Google descriptions are limited to 90 characters");
    const daily = Number(dto.dailyBudget);
    if (!Number.isFinite(daily) || daily <= 0) throw new BadRequestException("dailyBudget must be a positive amount");
    if (!dto.countryCodes?.length) throw new BadRequestException("At least one country is required");
    if (!dto.keywords?.length) throw new BadRequestException("A Search campaign needs at least 1 keyword — without keywords it cannot serve");
    if (dto.keywords.length > 100) throw new BadRequestException("At most 100 keywords per ad group in this flow");
    for (const kw of dto.keywords) {
      if (!kw.text?.trim() || kw.text.length > 80) throw new BadRequestException("Each keyword needs text of at most 80 characters");
      const mt = String(kw.matchType ?? "EXACT").toUpperCase();
      if (!["BROAD", "EXACT", "PHRASE"].includes(mt)) throw new BadRequestException(`Invalid match type: ${kw.matchType}`);
    }
    for (const s of dto.sitelinks ?? []) {
      if (!s.text?.trim() || s.text.length > 25) throw new BadRequestException("Sitelink text is limited to 25 characters");
      if (!s.url?.startsWith("http")) throw new BadRequestException("Sitelink URL must be an http(s) URL");
    }
    for (const c of dto.callouts ?? []) {
      if (c.length > 25) throw new BadRequestException("Callout text is limited to 25 characters");
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
  async publishTikTok(organizationId: string, actorId: string, dto: {
    adAccountId: string; name: string; dailyBudget: string; countryCodes: string[];
    adText: string; landingUrl: string; imageUrl?: string; videoUrl?: string; identityId?: string;
  }) {
    const daily = Number(dto.dailyBudget);
    if (!Number.isFinite(daily) || daily <= 0) throw new BadRequestException("dailyBudget must be a positive amount");
    if (!dto.countryCodes?.length) throw new BadRequestException("At least one country is required");
    if (!dto.videoUrl && !dto.imageUrl) throw new BadRequestException("Provide an image URL or a video URL for the creative");
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
      const campaign = await call("/campaign/create/", "POST", {
        advertiser_id: advertiserId, campaign_name: dto.name, objective_type: "TRAFFIC", operation_status: "DISABLE",
      }, "campaign");
      if (!campaign?.campaign_id) throw new Error("campaign: TikTok returned no campaign id; creation is NOT confirmed");
      detail.campaignId = String(campaign.campaign_id);
      const adgroup = await call("/adgroup/create/", "POST", {
        advertiser_id: advertiserId, campaign_id: campaign.campaign_id, adgroup_name: `${dto.name} - AG1`,
        objective_type: "TRAFFIC", placement_type: "PLACEMENT_TYPE_AUTOMATIC", location_ids: locationIds,
        budget_mode: "BUDGET_MODE_DAY", budget: daily, schedule_type: "SCHEDULE_FROM_NOW",
        billing_event: "CPC", optimization_goal: "CLICK", operation_status: "DISABLE",
      }, "ad group");
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
    headlines: string[]; longHeadlines: string[]; descriptions: string[];
    logoUrl: string; imageUrls: string[];
  }) {
    if (!dto.headlines || dto.headlines.length < 3 || dto.headlines.length > 15) throw new BadRequestException("Performance Max needs 3-15 headlines");
    if (dto.headlines.some((h) => !h?.trim() || h.length > 30)) throw new BadRequestException("PMax headlines are limited to 30 characters");
    if (!dto.longHeadlines?.length || dto.longHeadlines.length > 5) throw new BadRequestException("Performance Max needs 1-5 long headlines");
    if (dto.longHeadlines.some((h) => h.length > 90)) throw new BadRequestException("PMax long headlines are limited to 90 characters");
    if (!dto.descriptions || dto.descriptions.length < 2 || dto.descriptions.length > 5) throw new BadRequestException("Performance Max needs 2-5 descriptions");
    if (dto.descriptions.some((d) => d.length > 90)) throw new BadRequestException("PMax descriptions are limited to 90 characters");
    if (!dto.businessName?.trim() || dto.businessName.length > 25) throw new BadRequestException("Business name is required (max 25 characters)");
    if (!dto.logoUrl?.startsWith("http")) throw new BadRequestException("A logo image URL is required");
    if (!dto.imageUrls?.length || dto.imageUrls.length > 20) throw new BadRequestException("Performance Max needs 1-20 marketing image URLs");
    if (dto.imageUrls.some((u) => !u?.startsWith("http"))) throw new BadRequestException("Image URLs must be http(s) URLs");
    const daily = Number(dto.dailyBudget);
    if (!Number.isFinite(daily) || daily <= 0) throw new BadRequestException("dailyBudget must be a positive amount");
    if (!dto.countryCodes?.length) throw new BadRequestException("At least one country is required");

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
}
