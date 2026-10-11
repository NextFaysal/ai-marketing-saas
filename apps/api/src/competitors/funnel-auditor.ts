import {
  FetchFn,
  fetchText,
  loadRobotsDisallows,
  pageAllowed,
  extractSameHostLinks,
  stripTags,
} from "./site-audit";

/**
 * Checkout funnel auditor — ACTUALLY audits (HF3, replaces the template
 * report removed in the Honesty Fix package).
 *
 * The old auditor accepted a fetchFn and never called it: every
 * competitor received the identical invented report (friction score 28,
 * the same bundle tiers with "popularity" percentages, the same
 * gateways and trust badges). This version fetches the homepage under
 * the WebsiteScanner discipline (own host, robots-respecting, honest
 * UA, page budget), follows a few same-host shop/cart/checkout links,
 * and detects from the REAL markup:
 * - payment gateway mentions (bKash, Nagad, Rocket, SSLCommerz, …)
 * - trust phrases actually printed on the pages
 * - checkout form presence and its observed field count/names
 * - bundle/combo offer hints printed on the pages
 *
 * Anything not found is reported as not detected — the UI renders
 * "শনাক্ত হয়নি" — never assumed. No friction score or popularity
 * percentage exists anymore, because no observed basis for one exists.
 * Generic improvement tips remain, labeled in the UI as general advice
 * (সাধারণ পরামর্শ), not as findings about this competitor.
 */

export interface FunnelGeneralTip {
  tactic: string;
  impact: "High" | "Medium" | "Critical";
  howToBeatThem: string;
}

export interface FunnelAuditReport {
  competitorName: string;
  domain: string;
  /** false = the site could not be scanned at all; reason says why. */
  scanned: boolean;
  reason?: string;
  pagesScanned: string[];
  checkoutDetected: boolean;
  /** null = no checkout form was found, so no count is claimed. */
  checkoutFieldCount: number | null;
  checkoutFields: string[];
  paymentGatewaysDetected: string[];
  trustSignalsDetected: string[];
  bundleHints: string[];
  generalTips: FunnelGeneralTip[];
}

const GATEWAYS: { label: string; re: RegExp }[] = [
  { label: "bKash (বিকাশ)", re: /bkash|বিকাশ/i },
  { label: "Nagad (নগদ)", re: /nagad|নগদ/i },
  { label: "Rocket (রকেট)", re: /rocket|রকেট/i },
  { label: "SSLCommerz", re: /sslcommerz/i },
  { label: "ShurjoPay", re: /shurjopay/i },
  { label: "AamarPay", re: /aamarpay/i },
  { label: "Stripe", re: /stripe/i },
  { label: "PayPal", re: /paypal/i },
  { label: "Cash on Delivery (ক্যাশ অন ডেলিভারি)", re: /cash on delivery|ক্যাশ অন ডেলিভারি/i },
];

const TRUST_SIGNALS: { label: string; re: RegExp }[] = [
  { label: "ক্যাশ অন ডেলিভারি", re: /ক্যাশ অন ডেলিভারি|cash on delivery/i },
  { label: "ফ্রি ডেলিভারি", re: /ফ্রি ডেলিভারি|free delivery|free shipping/i },
  { label: "সহজ রিটার্ন/এক্সচেঞ্জ", re: /সহজ রিটার্ন|easy return|easy exchange|রিটার্ন গ্যারান্টি/i },
  { label: "ওয়ারেন্টি/গ্যারান্টি", re: /ওয়ারেন্টি|warranty|গ্যারান্টি|guarantee/i },
  { label: "অরিজিনাল পণ্যের দাবি", re: /অরিজিনাল পণ্য|100%\s*original|authentic product/i },
  { label: "হোম ডেলিভারি", re: /হোম ডেলিভারি|home delivery/i },
  { label: "পণ্য দেখে পেমেন্ট", re: /পণ্য দেখে|ডেলিভারি ম্যানের সামনে|check before (you )?pay/i },
];

const GENERAL_TIPS: FunnelGeneralTip[] = [
  {
    tactic: "১-পেজ এক্সপ্রেস চেকআউট ফর্ম ব্যবহার করুন",
    impact: "Critical",
    howToBeatThem: "নিজের স্টোরে 'নাম, মোবাইল নাম্বার এবং ঠিকানা' দিয়ে ৩-ফিল্ড এক্সপ্রেস অর্ডার ফর্ম দিন — কম ফিল্ড মানেই সাধারণত কম ড্রপ-অফ।",
  },
  {
    tactic: "চেকআউট বাটনের নিচে স্পষ্ট ট্রাস্ট ব্যাজ রাখুন",
    impact: "High",
    howToBeatThem: "অর্ডার কনফার্ম বাটনের ঠিক নিচে 'ডেলিভারি ম্যানের সামনে দেখে নেওয়ার সুযোগ'-এর মতো যাচাইযোগ্য প্রতিশ্রুতি রাখুন, যাতে ক্রেতা দ্বিধা না রাখে।",
  },
  {
    tactic: "অটো কম্বো সিলেক্টর (Order Bump)",
    impact: "High",
    howToBeatThem: "চেকআউট পেজে ২ পিসের বান্ডেল ডিফল্ট সিলেক্টেড রাখলে গড় অর্ডার ভ্যালু (AOV) বাড়ার সুযোগ থাকে — নিজের ডেটা দিয়ে যাচাই করে সিদ্ধান্ত নিন।",
  },
];

function detectLabels(text: string, patterns: { label: string; re: RegExp }[]): string[] {
  return patterns.filter((p) => p.re.test(text)).map((p) => p.label);
}

function formFieldsIn(html: string): { count: number; fields: string[] } {
  const fields: string[] = [];
  for (const m of html.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) {
    const tag = m[0];
    const type = tag.match(/type=["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (m[1].toLowerCase() === "input" && ["hidden", "submit", "button", "image", "reset"].includes(type ?? "")) continue;
    const name =
      tag.match(/name=["']([^"']+)["']/i)?.[1] ??
      tag.match(/placeholder=["']([^"']+)["']/i)?.[1] ??
      tag.match(/aria-label=["']([^"']+)["']/i)?.[1];
    if (name) fields.push(name.slice(0, 60));
  }
  return { count: fields.length, fields: fields.slice(0, 15) };
}

function bundleHintsIn(text: string): string[] {
  const out: string[] = [];
  for (const sentence of text.split(/(?<=[।.!?])\s+/)) {
    if (/bundle|combo|কম্বো|বান্ডেল|\d+\s*পিস|buy\s*\d+\s*get/i.test(sentence)) {
      const excerpt = sentence.trim().slice(0, 140);
      if (excerpt && !out.includes(excerpt)) out.push(excerpt);
      if (out.length >= 5) break;
    }
  }
  return out;
}

export class FunnelAuditor {
  constructor(private readonly fetchFn: FetchFn = fetch) {}

  async audit(competitorName: string, websiteUrl?: string): Promise<FunnelAuditReport> {
    const cleanName = competitorName.trim();
    const base0: FunnelAuditReport = {
      competitorName: cleanName,
      domain: "",
      scanned: false,
      pagesScanned: [],
      checkoutDetected: false,
      checkoutFieldCount: null,
      checkoutFields: [],
      paymentGatewaysDetected: [],
      trustSignalsDetected: [],
      bundleHints: [],
      generalTips: GENERAL_TIPS,
    };

    if (!websiteUrl) {
      return { ...base0, reason: "প্রতিযোগীর কোনো ওয়েবসাইট URL দেওয়া নেই — ফানেল অডিটের জন্য আসল সাইট দরকার" };
    }
    let base: URL;
    try {
      base = new URL(websiteUrl);
      if (!/^https?:$/.test(base.protocol)) throw new Error("protocol");
    } catch {
      return { ...base0, reason: "প্রতিযোগীর ওয়েবসাইট URL-টি সঠিক নয় — অডিট করা যায়নি" };
    }
    const domain = base.hostname.replace(/^www\./, "");
    const disallows = await loadRobotsDisallows(this.fetchFn, base.origin);

    const homepage = base.toString();
    if (!pageAllowed(homepage, disallows)) {
      return { ...base0, domain, reason: "robots.txt এই পেজটি স্ক্যান করার অনুমতি দেয় না — অডিট করা হয়নি" };
    }
    const homeHtml = await fetchText(this.fetchFn, homepage);
    if (!homeHtml) {
      return { ...base0, domain, reason: "প্রতিযোগীর ওয়েবসাইটে পৌঁছানো যায়নি — পরে আবার চেষ্টা করুন" };
    }

    // Follow a small budget of same-host funnel-relevant links.
    const discovered = extractSameHostLinks(homeHtml, base)
      .filter((u) => u !== homepage && /checkout|cart|order|product|shop/i.test(u))
      .slice(0, 3);

    const pages: { url: string; html: string }[] = [{ url: homepage, html: homeHtml }];
    for (const url of discovered) {
      if (!pageAllowed(url, disallows)) continue;
      const html = await fetchText(this.fetchFn, url);
      if (html) pages.push({ url, html });
    }

    const allText = pages.map((p) => stripTags(p.html)).join("\n");
    let checkoutDetected = discovered.some((u) => /checkout|cart|order/i.test(u));
    // Prefer a form on a checkout/cart/order page; fall back to any form
    // found. Pages are scanned homepage-first, so track both.
    let checkoutForm: { count: number; fields: string[] } | null = null;
    let anyForm: { count: number; fields: string[] } | null = null;
    for (const page of pages) {
      if (!/<form\b/i.test(page.html)) continue;
      const f = formFieldsIn(page.html);
      if (f.count === 0) continue;
      if (/checkout|cart|order/i.test(page.url)) {
        checkoutDetected = true;
        if (!checkoutForm) checkoutForm = f;
      } else if (!anyForm) {
        anyForm = f;
      }
    }
    const chosenForm = checkoutForm ?? anyForm;
    const checkoutFieldCount = chosenForm?.count ?? null;
    const checkoutFields = chosenForm?.fields ?? [];

    return {
      competitorName: cleanName,
      domain,
      scanned: true,
      pagesScanned: pages.map((p) => p.url),
      checkoutDetected,
      checkoutFieldCount,
      checkoutFields,
      paymentGatewaysDetected: detectLabels(allText, GATEWAYS),
      trustSignalsDetected: detectLabels(allText, TRUST_SIGNALS),
      bundleHints: bundleHintsIn(allText),
      generalTips: GENERAL_TIPS,
    };
  }
}
