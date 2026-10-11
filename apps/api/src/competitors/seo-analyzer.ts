import {
  FetchFn,
  fetchText,
  loadRobotsDisallows,
  pageAllowed,
  extractSameHostLinks,
  metaContent,
  pageTitle,
  headingTexts,
  hasProductSchema,
} from "./site-audit";

/**
 * Competitor SEO — REAL on-page audit (HF2, replaces the invented
 * "traffic estimator" removed in the Honesty Fix package).
 *
 * The old analyzer never fetched anything: keyword volumes, positions,
 * Domain Authority, visits and traffic shares were name-template
 * inventions. This auditor fetches the competitor's homepage under the
 * WebsiteScanner discipline (own host, robots-respecting, honest UA)
 * and reports OBSERVED FACTS ONLY:
 * - the page's real <title> and meta description
 * - H1/H2 heading texts (the phrases the site itself uses)
 * - whether a Product JSON-LD schema is present
 * - OpenGraph tags actually served
 * - whether /sitemap.xml is served
 * - internal shop/product/offer links found in the homepage HTML
 *
 * No website URL, a robots block, or an unreachable site produces an
 * honest `available: false` with a reason — never a template report.
 */

export interface ObservedPhrase {
  source: "title" | "h1" | "h2";
  text: string;
}

export interface SeoInternalLink {
  url: string;
  kind: "shop" | "product" | "offer" | "page";
}

export interface SeoOnPageAudit {
  domain: string;
  available: boolean;
  /** Bengali, user-facing reason when available is false. */
  reason?: string;
  fetchedUrl?: string;
  title?: string;
  metaDescription?: string;
  productSchemaPresent: boolean;
  og: { title?: string; description?: string; image?: string };
  sitemapPresent: boolean;
  observedPhrases: ObservedPhrase[];
  internalLinks: SeoInternalLink[];
}

function linkKind(url: string): SeoInternalLink["kind"] {
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (/offer|sale|discount|campaign|deal/.test(path)) return "offer";
  if (/product|\/p\/|item/.test(path)) return "product";
  if (/shop|collection|categor/.test(path)) return "shop";
  return "page";
}

const UNAVAILABLE_BASE: Omit<SeoOnPageAudit, "domain" | "available" | "reason"> = {
  productSchemaPresent: false,
  og: {},
  sitemapPresent: false,
  observedPhrases: [],
  internalLinks: [],
};

export class SeoOnPageAuditor {
  constructor(private readonly fetchFn: FetchFn = fetch) {}

  async audit(competitorName: string, websiteUrl?: string): Promise<SeoOnPageAudit> {
    if (!websiteUrl) {
      return {
        ...UNAVAILABLE_BASE,
        domain: "",
        available: false,
        reason: "প্রতিযোগীর কোনো ওয়েবসাইট URL দেওয়া নেই — আসল পেজ ফেচ না করে SEO অডিট তৈরি হয় না",
      };
    }

    let base: URL;
    try {
      base = new URL(websiteUrl);
      if (!/^https?:$/.test(base.protocol)) throw new Error("protocol");
    } catch {
      return {
        ...UNAVAILABLE_BASE,
        domain: "",
        available: false,
        reason: "প্রতিযোগীর ওয়েবসাইট URL-টি সঠিক নয় — অডিট করা যায়নি",
      };
    }
    const domain = base.hostname.replace(/^www\./, "");
    const homepage = base.toString();

    const disallows = await loadRobotsDisallows(this.fetchFn, base.origin);
    if (!pageAllowed(homepage, disallows)) {
      return {
        ...UNAVAILABLE_BASE,
        domain,
        available: false,
        reason: "robots.txt এই পেজটি স্ক্যান করার অনুমতি দেয় না — অডিট করা হয়নি",
      };
    }

    const html = await fetchText(this.fetchFn, homepage);
    if (!html) {
      return {
        ...UNAVAILABLE_BASE,
        domain,
        available: false,
        reason: "প্রতিযোগীর ওয়েবসাইটে পৌঁছানো যায়নি — পরে আবার চেষ্টা করুন",
      };
    }

    const sitemapXml = await fetchText(this.fetchFn, `${base.origin}/sitemap.xml`);
    const title = pageTitle(html);
    const phrases: ObservedPhrase[] = [];
    if (title) phrases.push({ source: "title", text: title });
    for (const text of headingTexts(html, "h1").slice(0, 5)) phrases.push({ source: "h1", text });
    for (const text of headingTexts(html, "h2").slice(0, 5)) phrases.push({ source: "h2", text });

    const internalLinks = extractSameHostLinks(html, base)
      .filter((u) => u !== homepage)
      .slice(0, 30)
      .map((url) => ({ url, kind: linkKind(url) }))
      // Shop/product/offer links are the SEO-relevant ones; plain pages
      // are only kept to fill the cap after them.
      .sort((a, b) => (a.kind === "page" ? 1 : 0) - (b.kind === "page" ? 1 : 0))
      .slice(0, 12);

    return {
      domain,
      available: true,
      fetchedUrl: homepage,
      title,
      metaDescription: metaContent(html, "name", "description"),
      productSchemaPresent: hasProductSchema(html),
      og: {
        title: metaContent(html, "property", "og:title"),
        description: metaContent(html, "property", "og:description"),
        image: metaContent(html, "property", "og:image"),
      },
      sitemapPresent: sitemapXml !== null,
      observedPhrases: phrases,
      internalLinks,
    };
  }
}
