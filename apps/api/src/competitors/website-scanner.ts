import { parseMoneyToMinor } from "@repo/contracts";

/**
 * Public website scanner for competitor price observation.
 * Boundaries, enforced in code:
 * - Only http(s) URLs on the competitor's own host (no open crawling).
 * - robots.txt is fetched first and any Disallow rule for "*" or our
 *   agent blocks that path; the reason is reported, not bypassed.
 * - No login, no cookies, no form submission, no user-agent spoofing:
 *   the crawler identifies itself honestly as QospreyCompetitorScanner.
 * - Page budget is capped; product data is read only from structured
 *   public markup (JSON-LD / OpenGraph / meta price tags).
 */
export const SCANNER_UA = "QospreyCompetitorScanner/1.0 (+public price observation; respects robots.txt)";

type FetchFn = typeof fetch;

export function parseRobotsDisallows(robotsText: string): string[] {
  const disallows: string[] = [];
  const groups = robotsText.split(/\r?\n\s*\r?\n/);
  for (const group of groups) {
    const lines = group.split(/\r?\n/).map((l) => l.trim());
    const agents = lines.filter((l) => /^user-agent:/i.test(l)).map((l) => l.replace(/^user-agent:/i, "").trim().toLowerCase());
    if (!agents.includes("*") && !agents.some((a) => a.includes("qosprey"))) continue;
    for (const line of lines) {
      const m = line.match(/^disallow:\s*(\S*)/i);
      if (m && m[1]) disallows.push(m[1]);
    }
  }
  return disallows;
}

export function isPathAllowed(pathname: string, disallows: string[]): boolean {
  return !disallows.some((rule) => rule !== "/" ? pathname.startsWith(rule) : true);
}

export interface ExtractedProduct {
  name: string;
  priceMinor: string;
  currency: string;
  url: string;
  inStock: boolean;
  seoDescription?: string;
}

export function extractProductData(html: string, url: string): ExtractedProduct | null {
  const isOutOfStockText = /out\s*of\s*stock|sold\s*out|স্টক\s*শেষ|unavailable/i.test(html);

  // 1) JSON-LD Product with offers
  const ldBlocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of ldBlocks) {
    try {
      const parsed = JSON.parse(block[1]);
      const nodes = Array.isArray(parsed) ? parsed : parsed["@graph"] ? parsed["@graph"] : [parsed];
      for (const node of nodes) {
        const type = node?.["@type"];
        if (type !== "Product" && !(Array.isArray(type) && type.includes("Product"))) continue;
        const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
        const price = offers?.price ?? offers?.lowPrice;
        if (price === undefined || node.name === undefined) continue;
        const currency = String(offers?.priceCurrency ?? "BDT").toUpperCase();
        
        const availability = String(offers?.availability ?? "").toLowerCase();
        const inStock = availability ? !availability.includes("outofstock") : !isOutOfStockText;
        const seoDescription = node.description ? String(node.description).slice(0, 300) : undefined;

        return {
          name: String(node.name).slice(0, 200),
          priceMinor: parsePrice(price),
          currency,
          url,
          inStock,
          seoDescription,
        };
      }
    } catch { /* malformed JSON-LD: try the next source */ }
  }
  // 2) Meta product tags (product:price:amount / og:price:amount)
  const amount = html.match(/property=["'](?:product:price:amount|og:price:amount)["']\s+content=["']([\d.,]+)["']/i)?.[1]
    ?? html.match(/content=["']([\d.,]+)["']\s+property=["'](?:product:price:amount|og:price:amount)["']/i)?.[1];
  if (amount) {
    const currency = html.match(/property=["'](?:product:price:currency|og:price:currency)["']\s+content=["']([A-Za-z]{3})["']/i)?.[1] ?? "BDT";
    const title = html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1]
      ?? html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "Product";
    const seoDescription = html.match(/name=["']description["']\s+content=["']([^"']+)["']/i)?.[1]
      ?? html.match(/property=["']og:description["']\s+content=["']([^"']+)["']/i)?.[1];

    return {
      name: title.trim().slice(0, 200),
      priceMinor: parsePrice(amount),
      currency: currency.toUpperCase(),
      url,
      inStock: !isOutOfStockText,
      seoDescription: seoDescription?.slice(0, 300),
    };
  }

  return null;
}

function parsePrice(raw: unknown): string {
  const str = String(raw).replace(/[^\d.]/g, "");
  return String(parseMoneyToMinor(str));
}

export function extractSitemapUrls(xml: string, host: string, cap: number): string[] {
  const urls: string[] = [];
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    try {
      const u = new URL(m[1].trim());
      if (u.host !== host) continue;
      if (/sitemap/i.test(u.pathname) && u.pathname.endsWith(".xml")) continue;
      urls.push(u.toString());
      if (urls.length >= cap) break;
    } catch { /* skip malformed loc entries */ }
  }
  return urls;
}

export interface ScanResult {
  scannedUrls: number;
  products: ExtractedProduct[];
  skippedByRobots: string[];
  errors: string[];
}

export class WebsiteScanner {
  constructor(private readonly fetchFn: FetchFn = fetch) {}

  private async fetchText(url: string): Promise<string | null> {
    const res = await this.fetchFn(url, { headers: { "User-Agent": SCANNER_UA, Accept: "text/html,application/xml" } });
    if (!res.ok) return null;
    return res.text();
  }

  async scan(websiteUrl: string, maxPages = 15): Promise<ScanResult> {
    const base = new URL(websiteUrl);
    if (!/^https?:$/.test(base.protocol)) throw new Error("Only http(s) websites can be scanned");
    const origin = base.origin;
    const robotsText = await this.fetchText(`${origin}/robots.txt`).catch(() => null);
    const disallows = robotsText ? parseRobotsDisallows(robotsText) : [];

    const result: ScanResult = { scannedUrls: 0, products: [], skippedByRobots: [], errors: [] };
    const candidateSet = new Set<string>();
    candidateSet.add(base.toString());

    const sitemapXml = await this.fetchText(`${origin}/sitemap.xml`).catch(() => null);
    if (sitemapXml) {
      for (const u of extractSitemapUrls(sitemapXml, base.host, 200)) {
        if (/product|shop|item|collection/i.test(u)) candidateSet.add(u);
      }
    }

    const candidates = [...candidateSet].slice(0, maxPages);
    for (const url of candidates) {
      const { pathname } = new URL(url);
      if (!isPathAllowed(pathname, disallows)) { result.skippedByRobots.push(url); continue; }
      try {
        const html = await this.fetchText(url);
        result.scannedUrls++;
        if (!html) { result.errors.push(`${url}: unavailable`); continue; }
        const product = extractProductData(html, url);
        if (product) result.products.push(product);
      } catch (e) {
        result.errors.push(`${url}: ${e instanceof Error ? e.message : "fetch failed"}`);
      }
    }
    return result;
  }
}
