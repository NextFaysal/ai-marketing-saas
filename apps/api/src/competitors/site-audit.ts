import { SCANNER_UA, parseRobotsDisallows, isPathAllowed } from "./website-scanner";

/**
 * Shared fetch discipline for the HF2/HF3 real on-page auditors.
 * Same rules as WebsiteScanner (Milestone 8):
 * - Only http(s) URLs on the competitor's own host.
 * - robots.txt is fetched first; a Disallow for "*" or our agent blocks
 *   the path — reported, never bypassed.
 * - The crawler identifies itself honestly as QospreyCompetitorScanner.
 * - A failed fetch returns null (an honest "unreachable"), never a
 *   template substitute.
 */

export type FetchFn = typeof fetch;

export async function fetchText(fetchFn: FetchFn, url: string): Promise<string | null> {
  try {
    const res = await fetchFn(url, {
      headers: { "User-Agent": SCANNER_UA, Accept: "text/html,application/xml" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export async function loadRobotsDisallows(fetchFn: FetchFn, origin: string): Promise<string[]> {
  const robotsText = await fetchText(fetchFn, `${origin}/robots.txt`);
  return robotsText ? parseRobotsDisallows(robotsText) : [];
}

export function pageAllowed(url: string, disallows: string[]): boolean {
  try {
    return isPathAllowed(new URL(url).pathname, disallows);
  } catch {
    return false;
  }
}

/** Visible text of a page (scripts/styles stripped) for phrase detection. */
export function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same-host absolute links found in the page's href attributes. */
export function extractSameHostLinks(html: string, base: URL): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1], base);
      if (u.host !== base.host) continue;
      u.hash = "";
      const s = u.toString();
      if (!seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    } catch {
      /* skip malformed hrefs */
    }
  }
  return out;
}

export function metaContent(html: string, attr: "name" | "property", value: string): string | undefined {
  const a = html.match(new RegExp(`<meta[^>]*${attr}=["']${value}["'][^>]*content=["']([^"']*)["']`, "i"))?.[1];
  const b = html.match(new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*${attr}=["']${value}["']`, "i"))?.[1];
  const v = (a ?? b)?.trim();
  return v ? v : undefined;
}

export function pageTitle(html: string): string | undefined {
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
  return t ? t : undefined;
}

export function headingTexts(html: string, tag: "h1" | "h2"): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))) {
    const text = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text) out.push(text.slice(0, 200));
  }
  return out;
}

/** True when a JSON-LD block declares a Product (same evidence standard
 *  as WebsiteScanner's price extraction). */
export function hasProductSchema(html: string): boolean {
  for (const block of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(block[1]);
      const nodes = Array.isArray(parsed) ? parsed : parsed["@graph"] ? parsed["@graph"] : [parsed];
      for (const node of nodes) {
        const type = node?.["@type"];
        if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) return true;
      }
    } catch {
      /* malformed JSON-LD: not evidence of a product schema */
    }
  }
  return false;
}
