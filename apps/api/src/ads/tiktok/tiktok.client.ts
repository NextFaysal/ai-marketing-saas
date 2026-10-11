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
