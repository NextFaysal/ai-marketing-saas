/**
 * Meta Ad Library API client (official, public data).
 * Endpoint: GET /ads_archive on the Graph API. It returns ads that ran
 * on Meta platforms for a Page id or search terms, including creative
 * text, start/stop dates and a snapshot URL - all publicly viewable in
 * the Ad Library itself.
 *
 * Access notes (Meta policy, not ours): a valid Facebook user access
 * token is required; in some countries the user must have completed
 * Meta's identity confirmation. We do not scrape the Ad Library website;
 * only this API is used.
 */
export interface AdLibraryAd {
  externalAdId: string;
  pageId?: string;
  pageName?: string;
  startedAt?: Date;
  stoppedAt?: Date;
  isActive: boolean;
  platforms: string[];
  creativeText?: string;
  linkUrl?: string;
  snapshotUrl?: string;
  raw: Record<string, unknown>;
}

const FIELDS = [
  "id", "page_id", "page_name", "ad_delivery_start_time", "ad_delivery_stop_time",
  "publisher_platforms", "ad_creative_bodies", "ad_creative_link_url",
  "ad_creative_link_titles", "ad_snapshot_url",
].join(",");

type FetchFn = typeof fetch;

export class AdLibraryClient {
  private readonly base: string;
  constructor(private readonly accessToken: string, private readonly fetchFn: FetchFn = fetch, version?: string) {
    this.base = `https://graph.facebook.com/${version ?? process.env.META_GRAPH_VERSION ?? "v21.0"}`;
  }

  async searchAds(input: {
    pageId?: string;
    searchTerms?: string;
    countries: string[];
    activeOnly?: boolean;
    limit?: number;
  }): Promise<AdLibraryAd[]> {
    if (!input.pageId && !input.searchTerms) throw new Error("Either pageId or searchTerms is required");
    const ads: AdLibraryAd[] = [];
    let url: string | null = this.buildUrl(input);
    let pages = 0;
    while (url && pages < 5) {
      const res: Response = await this.fetchFn(url);
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Ad Library request failed (${res.status}): ${body?.error?.message ?? "unknown error"}`);
      for (const item of body.data ?? []) ads.push(normalizeAd(item));
      const next: string | undefined = body.paging?.next;
      url = next && next.startsWith("https://graph.facebook.com/") ? next : null;
      pages++;
    }
    return ads.slice(0, input.limit ?? 200);
  }

  private buildUrl(input: { pageId?: string; searchTerms?: string; countries: string[]; activeOnly?: boolean }): string {
    const params = new URLSearchParams({
      access_token: this.accessToken,
      fields: FIELDS,
      ad_reached_countries: JSON.stringify(input.countries),
      ad_active_status: input.activeOnly === false ? "ALL" : "ACTIVE",
      limit: "100",
    });
    if (input.pageId) params.set("search_page_ids", JSON.stringify([input.pageId]));
    if (input.searchTerms) params.set("search_terms", input.searchTerms);
    return `${this.base}/ads_archive?${params.toString()}`;
  }
}

export function normalizeAd(item: any): AdLibraryAd {
  const stopped = item.ad_delivery_stop_time ? new Date(item.ad_delivery_stop_time) : undefined;
  return {
    externalAdId: String(item.id),
    pageId: item.page_id ? String(item.page_id) : undefined,
    pageName: item.page_name ?? undefined,
    startedAt: item.ad_delivery_start_time ? new Date(item.ad_delivery_start_time) : undefined,
    stoppedAt: stopped,
    isActive: !stopped,
    platforms: Array.isArray(item.publisher_platforms) ? item.publisher_platforms.map(String) : [],
    creativeText: Array.isArray(item.ad_creative_bodies) ? item.ad_creative_bodies.filter(Boolean).join("\n").slice(0, 2000) || undefined : undefined,
    linkUrl: item.ad_creative_link_url ?? undefined,
    snapshotUrl: item.ad_snapshot_url ?? undefined,
    raw: item,
  };
}
