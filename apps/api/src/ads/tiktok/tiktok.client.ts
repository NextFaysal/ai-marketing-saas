/**
 * TikTok Ads reporting client (read-only).
 * Integrated report endpoint: /open_api/v1.3/report/integrated/get/
 * with an advertiser-scoped Access-Token header. Requires a TikTok
 * Marketing API app + advertiser authorization; API errors are surfaced
 * verbatim (code + message from TikTok's envelope).
 * Spend arrives as a decimal string in the advertiser's currency and is
 * parsed to integer minor units exactly.
 */
import { parseMoneyToMinor } from "@repo/contracts";

export interface TikTokDailyRow {
  date: string;
  campaignExternalId: string;
  campaignName?: string;
  spendMinor: bigint;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValueMinor: bigint;
  currency: string;
}

type FetchFn = typeof fetch;

export class TikTokAdsClient {
  constructor(private readonly accessToken: string, private readonly fetchFn: FetchFn = fetch) {}

  async verifyAdvertiser(advertiserId: string): Promise<{ id: string; name?: string; currency?: string; status?: string; timezone?: string }> {
    const url = `https://business-api.tiktok.com/open_api/v1.3/advertiser/info/?advertiser_ids=${JSON.stringify([advertiserId])}&fields=${JSON.stringify(["id", "name", "currency", "status", "timezone"])}`;
    const res = await this.fetchFn(url, { headers: { "Access-Token": this.accessToken } });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || body.code !== 0) throw new Error(`TikTok advertiser check failed: ${body.message ?? res.status}`);
    const info = body.data?.list?.[0];
    if (!info) throw new Error("TikTok advertiser not found for this token");
    return {
      id: String(info.id), name: info.name, currency: info.currency,
      status: info.status ? String(info.status) : undefined,
      timezone: info.timezone ? String(info.timezone) : undefined,
    };
  }

  async getCampaignDaily(advertiserId: string, from: string, to: string): Promise<TikTokDailyRow[]> {
    const rows: TikTokDailyRow[] = [];
    let page = 1;
    for (;;) {
      const params = new URLSearchParams({
        advertiser_id: advertiserId,
        service_type: "AUCTION",
        report_type: "REQUEST",
        data_level: "AUCTION_CAMPAIGN",
        start_date: from, end_date: to,
        dimensions: JSON.stringify(["campaign_id", "stat_time_day"]),
        metrics: JSON.stringify(["spend", "impressions", "clicks", "conversion", "complete_payment_value", "currency", "campaign_name"]),
        page: String(page), page_size: "100",
      });
      const res = await this.fetchFn(`https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/?${params.toString()}`, {
        headers: { "Access-Token": this.accessToken },
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok || body.code !== 0) throw new Error(`TikTok report failed: ${body.message ?? res.status}`);
      for (const item of body.data?.list ?? []) rows.push(normalizeTikTokRow(item));
      const totalPage = body.data?.page_info?.total_page ?? 1;
      if (page >= totalPage) break;
      page++;
    }
    return rows;
  }
}

export interface TikTokCampaignInfo {
  campaignExternalId: string;
  name?: string;
  /** Verbatim TikTok operation_status: ENABLE | DISABLE (or what TikTok sends). */
  operationStatus: string;
  secondaryStatus?: string;
}

export interface TikTokAudienceInfo {
  audienceExternalId: string;
  name?: string;
  status?: string;
  /** Provider-reported covered-user count when TikTok sends one, else null — never estimated. */
  size: number | null;
}

/**
 * OU4: campaign status/lifecycle + DMP custom audiences.
 * Endpoint shapes follow the TikTok Marketing API v1.3 surface as
 * listed in TikTok's official SDK (campaign/get, campaign/status/
 * update, dmp/custom_audience/file/upload + create + get,
 * dmp/custom_audience/lookalike/create — endpoint existence verified
 * 2026-10-16); field-level live verification is M30-owed. TikTok's
 * envelope errors (code + message) surface verbatim, same as the
 * reporting client above.
 */
export class TikTokManage {
  private readonly api = "https://business-api.tiktok.com/open_api/v1.3";
  constructor(private readonly accessToken: string, private readonly fetchFn: FetchFn = fetch) {}

  private async call(path: string, init: { method: "GET" | "POST"; body?: string; headers?: Record<string, string> }, step: string): Promise<any> {
    const res = await this.fetchFn(`${this.api}${path}`, {
      method: init.method,
      headers: { "Access-Token": this.accessToken, ...(init.headers ?? {}) },
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || (body.code !== undefined && body.code !== 0)) {
      throw new Error(`TikTok ${step} failed: ${body.message ?? `HTTP ${res.status}`}`);
    }
    return body.data;
  }

  async getCampaign(advertiserId: string, campaignId: string): Promise<TikTokCampaignInfo | null> {
    const params = new URLSearchParams({
      advertiser_id: advertiserId,
      filtering: JSON.stringify({ campaign_ids: [campaignId] }),
      fields: JSON.stringify(["campaign_id", "campaign_name", "operation_status", "secondary_status"]),
      page: "1", page_size: "10",
    });
    const data = await this.call(`/campaign/get/?${params.toString()}`, { method: "GET" }, "campaign status read");
    const row = data?.list?.[0];
    if (!row) return null;
    return {
      campaignExternalId: String(row.campaign_id ?? campaignId),
      name: row.campaign_name ?? undefined,
      operationStatus: String(row.operation_status ?? ""),
      secondaryStatus: row.secondary_status ? String(row.secondary_status) : undefined,
    };
  }

  async setCampaignStatus(advertiserId: string, campaignId: string, operationStatus: "ENABLE" | "DISABLE"): Promise<void> {
    await this.call("/campaign/status/update/", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ advertiser_id: advertiserId, campaign_ids: [campaignId], operation_status: operationStatus }),
    }, "campaign status change");
  }

  /**
   * Create a customer-file custom audience: upload the hashed
   * identifier file (one SHA-256 hash per line — identifiers arrive
   * ALREADY hashed from the audiences service; raw contacts never
   * enter this client), then create the audience from the uploaded
   * file path. Returns TikTok's audience id — no id, no audience.
   */
  async createCustomAudience(advertiserId: string, name: string, hashedLines: string[]): Promise<{ audienceExternalId: string; filePath: string }> {
    const form = new FormData();
    form.append("advertiser_id", advertiserId);
    form.append("file", new Blob([hashedLines.join("\n")], { type: "text/plain" }), "customer-file.txt");
    form.append("encryption_type", "SHA256");
    const upload = await this.call("/dmp/custom_audience/file/upload/", { method: "POST", body: form as any }, "audience file upload");
    const filePath = upload?.file_path ?? upload?.path;
    if (!filePath) throw new Error("TikTok returned no file path for the audience upload; creation is NOT confirmed");
    const created = await this.call("/dmp/custom_audience/create/", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ advertiser_id: advertiserId, audience_name: name, file_paths: [filePath], encryption_algorithm: "SHA256" }),
    }, "custom audience create");
    const audienceId = created?.custom_audience_id ?? created?.audience_id;
    if (!audienceId) throw new Error("TikTok returned no audience id; creation is NOT confirmed");
    return { audienceExternalId: String(audienceId), filePath: String(filePath) };
  }

  /** Append more hashed identifiers to an existing audience (same
   * upload path; TikTok applies the file to the audience). */
  async updateCustomAudience(advertiserId: string, audienceId: string, hashedLines: string[]): Promise<{ filePath: string }> {
    const form = new FormData();
    form.append("advertiser_id", advertiserId);
    form.append("custom_audience_id", audienceId);
    form.append("file", new Blob([hashedLines.join("\n")], { type: "text/plain" }), "customer-file.txt");
    form.append("encryption_type", "SHA256");
    const upload = await this.call("/dmp/custom_audience/file/upload/", { method: "POST", body: form as any }, "audience file upload");
    const filePath = upload?.file_path ?? upload?.path;
    if (!filePath) throw new Error("TikTok returned no file path for the audience update; update is NOT confirmed");
    await this.call("/dmp/custom_audience/update/", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ advertiser_id: advertiserId, custom_audience_id: audienceId, file_paths: [filePath], encryption_algorithm: "SHA256" }),
    }, "custom audience update");
    return { filePath: String(filePath) };
  }

  async getCustomAudience(advertiserId: string, audienceId: string): Promise<TikTokAudienceInfo> {
    const params = new URLSearchParams({
      advertiser_id: advertiserId,
      custom_audience_ids: JSON.stringify([audienceId]),
    });
    const data = await this.call(`/dmp/custom_audience/get/?${params.toString()}`, { method: "GET" }, "custom audience read");
    const row = (data?.list ?? [])[0];
    if (!row) throw new Error("TikTok returned no such custom audience");
    const sizeRaw = row.cover_num ?? row.audience_size ?? row.cover_number;
    return {
      audienceExternalId: String(row.custom_audience_id ?? audienceId),
      name: row.name ?? row.audience_name ?? undefined,
      status: row.status ? String(row.status) : undefined,
      size: sizeRaw != null && Number.isFinite(Number(sizeRaw)) ? Number(sizeRaw) : null,
    };
  }

  /**
   * TikTok lookalike (the platform DOES offer API creation —
   * /dmp/custom_audience/lookalike/create/). TikTok expresses size
   * as a similarity tier, not Meta's ratio: the service maps ratio
   * → NARROW (≤0.05) / BALANCED (≤0.10) / BROAD. Field-level live
   * verification is M30-owed.
   */
  async createLookalikeAudience(advertiserId: string, input: { name: string; sourceAudienceId: string; country: string; tier: "NARROW" | "BALANCED" | "BROAD" }): Promise<{ audienceExternalId: string }> {
    const created = await this.call("/dmp/custom_audience/lookalike/create/", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        advertiser_id: advertiserId, audience_name: input.name,
        source_audience_id: input.sourceAudienceId, country_code: input.country,
        audience_size_type: input.tier,
      }),
    }, "lookalike audience create");
    const audienceId = created?.custom_audience_id ?? created?.audience_id ?? created?.lookalike_audience_id;
    if (!audienceId) throw new Error("TikTok returned no lookalike audience id; creation is NOT confirmed");
    return { audienceExternalId: String(audienceId) };
  }
}

export function normalizeTikTokRow(item: any): TikTokDailyRow {
  const dims = item.dimensions ?? {};
  const metrics = item.metrics ?? {};
  const statDay = String(dims.stat_time_day ?? "");
  return {
    date: statDay.slice(0, 10),
    campaignExternalId: String(dims.campaign_id),
    campaignName: metrics.campaign_name ?? dims.campaign_name ?? undefined,
    spendMinor: parseMoneyToMinor(String(metrics.spend ?? "0")),
    impressions: Number(metrics.impressions ?? 0),
    clicks: Number(metrics.clicks ?? 0),
    conversions: Number(metrics.conversion ?? 0),
    conversionValueMinor: metrics.complete_payment_value !== undefined ? parseMoneyToMinor(String(metrics.complete_payment_value)) : 0n,
    currency: metrics.currency ?? "USD",
  };
}
