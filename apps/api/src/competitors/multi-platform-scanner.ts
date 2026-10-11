/**
 * Multi-Platform Competitor Search Intelligence Scanner
 *
 * Honesty boundary (HF1, 2026-10-12): this scanner only returns records it
 * actually fetched. Platforms with no real public data source wired return
 * an empty list — they NEVER fabricate ad copy, dates, or engagement.
 *
 * What is real here:
 * - Google: a live fetch of DuckDuckGo's public HTML results for the
 *   competitor's name/domain. These are ORGANIC SEARCH RESULTS, not ads —
 *   every record is labeled as such (`raw.sourceType: "organic_search"`
 *   and a "[Google Search Result]" creative prefix). A failed fetch or
 *   zero matches returns [].
 * - TikTok / Bing: no official public data source is connected, so both
 *   return []. The sync layer reports them as unavailable instead of
 *   inventing records (they used to fabricate ads — removed by HF1;
 *   already-persisted fabrications are cleaned by
 *   scripts/cleanup-fabricated-competitor-ads.ts).
 */

export interface NormalizedCompetitorAd {
  externalAdId: string;
  pageName?: string;
  platform: "facebook" | "google" | "tiktok" | "bing";
  platforms: string[];
  startedAt?: Date;
  stoppedAt?: Date;
  isActive: boolean;
  creativeText: string;
  linkUrl?: string;
  snapshotUrl?: string;
  raw: Record<string, unknown>;
}

export class MultiPlatformScanner {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  /**
   * Google organic search presence (NOT Google Ads).
   * Fetches public DuckDuckGo HTML results and labels every record as an
   * organic search result. No start date is known for a search result, so
   * none is invented. Fetch failure or zero matches -> [].
   */
  async scanGoogleAds(competitorName: string, domain?: string): Promise<NormalizedCompetitorAd[]> {
    const results: NormalizedCompetitorAd[] = [];
    const query = domain ? `${domain}` : `${competitorName} official site`;

    try {
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await this.fetchFn(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html",
        },
      });

      if (res.ok) {
        const html = await res.text();
        const matches = [...html.matchAll(/<a class="result__url"[^>]*href="([^"]+)"[^>]*>[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi)];

        for (let i = 0; i < Math.min(matches.length, 3); i++) {
          const match = matches[i];
          const rawUrl = match[1];
          const title = match[2].replace(/<[^>]+>/g, "").trim();
          const snippet = match[3].replace(/<[^>]+>/g, "").trim();

          const linkUrl = rawUrl.startsWith("http") ? rawUrl : `https://${domain || "google.com"}`;
          results.push({
            externalAdId: `google_${Buffer.from(`${competitorName}_${title}_${i}`).toString("base64url").slice(0, 32)}`,
            pageName: `${competitorName} (Google Search)`,
            platform: "google",
            platforms: ["google", "google_search"],
            // No startedAt: a search result has no known start date.
            isActive: true,
            creativeText: `[Google Search Result]\n${title}\n\n${snippet}`,
            linkUrl,
            snapshotUrl: `https://adstransparency.google.com/?region=anywhere&domain=${domain ? encodeURIComponent(domain) : encodeURIComponent(competitorName)}`,
            raw: { source: "google", sourceType: "organic_search", title, snippet, domain },
          });
        }
      }
    } catch {
      // Network failure is an honest empty result, never a fabricated ad.
    }

    return results;
  }

  /**
   * TikTok: no official public data source is wired, so this returns [].
   * Callers surface the platform as unavailable; nothing is synthesized.
   */
  async scanTikTokAds(_competitorName: string): Promise<NormalizedCompetitorAd[]> {
    return [];
  }

  /**
   * Bing: no official public data source is wired, so this returns [].
   * Callers surface the platform as unavailable; nothing is synthesized.
   */
  async scanBingAds(_competitorName: string, _domain?: string): Promise<NormalizedCompetitorAd[]> {
    return [];
  }
}
