/**
 * SU5 + SU6 — pure helpers for Commerce Auto-Draft settings and
 * tracked-link stats on the Social Posts page.
 *
 * SU5: commerce events (new product / sale / back-in-stock /
 * review milestone) can create DRAFT posts only — publishing
 * always needs a human approval. The settings panel edits the
 * org's toggles through GET/PATCH
 * organizations/:orgId/social/auto-draft-settings.
 *
 * SU6: a post whose linkUrl was published to a Meta Page carries
 * a tracked short link (linkToken). Click / order numbers come
 * from GET organizations/:orgId/social/posts/:id/link-stats and
 * are an ASSOCIATION, never an attribution claim — the API's own
 * associationNote is shown with the numbers.
 *
 * Kept pure (no React, no fetch) so the behaviour is unit-testable
 * without a component harness — same pattern as
 * social-media-library / social-post-insights. Revenue formatting
 * reuses the existing formatTakaMinor helper (CC package).
 */

import { fmtMoneyMinor, fmtNumber, type UiLocale } from "@repo/contracts";
import { tr } from "./i18n/lookup";
import { socialBn, socialEn } from "./i18n/social";

const SOCIAL_DICTS = { bn: socialBn, en: socialEn };
const L = (locale: UiLocale, key: string, params?: Record<string, string | number>) =>
  tr(SOCIAL_DICTS, locale, key, params) ?? key;

import { formatTakaMinor } from "./connections";

// ---------------------------------------------------------------------------
// SU5 — auto-draft settings
// ---------------------------------------------------------------------------

export type AutoDraftKind = "new_product" | "sale" | "back_in_stock" | "review_milestone";

/** GET/PATCH organizations/:orgId/social/auto-draft-settings shape. */
export interface AutoDraftSettings {
  newProductEnabled: boolean;
  saleEnabled: boolean;
  backInStockEnabled: boolean;
  reviewMilestoneEnabled: boolean;
  // SN8: syndication sources (RSS feed + own YouTube channel).
  rssEnabled: boolean;
  youtubeEnabled: boolean;
  rssFeedUrl: string | null;
  maxDraftsPerDay: number;
  socialAccountId: string | null;
}

/** The panel's editable form: the account select uses "" for
 * "no explicit account" (the API stores null). */
export interface AutoDraftSettingsForm {
  newProductEnabled: boolean;
  saleEnabled: boolean;
  backInStockEnabled: boolean;
  reviewMilestoneEnabled: boolean;
  // SN8: syndication toggles + the feed URL as editable text
  // ("" in the form = null in the settings shape).
  rssEnabled: boolean;
  youtubeEnabled: boolean;
  rssFeedUrl: string;
  maxDraftsPerDay: number;
  socialAccountId: string;
}

export type AutoDraftToggleKey =
  | "newProductEnabled"
  | "saleEnabled"
  | "backInStockEnabled"
  | "reviewMilestoneEnabled"
  | "rssEnabled"
  | "youtubeEnabled";

/** The toggles, in panel order, with their Bengali labels. */
export const AUTO_DRAFT_TOGGLES: { key: AutoDraftToggleKey; label: string; labelEn: string }[] = [
  { key: "newProductEnabled", label: "নতুন product এলে", labelEn: "When a new product arrives" },
  { key: "saleEnabled", label: "সেল / প্রমোশন শুরু হলে", labelEn: "When a sale / promotion starts" },
  { key: "backInStockEnabled", label: "Back-in-stock (স্টক ফিরলে)", labelEn: "Back-in-stock" },
  { key: "reviewMilestoneEnabled", label: "রিভিউ মাইলফলক হলে", labelEn: "When a review milestone is hit" },
  { key: "rssEnabled", label: "RSS feed থেকে নতুন আইটেম", labelEn: "New item from an RSS feed" },
  { key: "youtubeEnabled", label: "নিজের YouTube চ্যানেলের নতুন ভিডিও", labelEn: "New video on my YouTube channel" },
];

export function autoDraftToggleLabel(key: AutoDraftToggleKey, locale: UiLocale = "bn"): string {
  const found = AUTO_DRAFT_TOGGLES.find((t) => t.key === key);
  if (!found) return key;
  return locale === "en" ? found.labelEn : found.label;
}

export const AUTO_DRAFT_CAP_MIN = 1;
export const AUTO_DRAFT_CAP_MAX = 20;

/** Clamp a daily-cap value into 1–20. Non-numeric input falls back
 * to the minimum rather than sending NaN to the API. */
export function clampAutoDraftCap(value: number | string): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return AUTO_DRAFT_CAP_MIN;
  return Math.min(AUTO_DRAFT_CAP_MAX, Math.max(AUTO_DRAFT_CAP_MIN, Math.floor(n)));
}

/** Settings as the API returns them → the panel's form state. */
export function autoDraftFormFromSettings(settings: AutoDraftSettings): AutoDraftSettingsForm {
  return {
    newProductEnabled: !!settings.newProductEnabled,
    saleEnabled: !!settings.saleEnabled,
    backInStockEnabled: !!settings.backInStockEnabled,
    reviewMilestoneEnabled: !!settings.reviewMilestoneEnabled,
    rssEnabled: !!settings.rssEnabled,
    youtubeEnabled: !!settings.youtubeEnabled,
    rssFeedUrl: settings.rssFeedUrl ?? "",
    maxDraftsPerDay: clampAutoDraftCap(settings.maxDraftsPerDay),
    socialAccountId: settings.socialAccountId ?? "",
  };
}

/**
 * Form state → the PATCH payload in the API's exact shape: the cap
 * is clamped to 1–20 and an empty account selection becomes null
 * (the API then targets the first connected Facebook Page). The
 * RSS feed URL is trimmed; empty becomes null (clears it server-side).
 */
export function buildAutoDraftSettingsPayload(form: AutoDraftSettingsForm): AutoDraftSettings {
  const accountId = (form.socialAccountId ?? "").trim();
  const feedUrl = (form.rssFeedUrl ?? "").trim();
  return {
    newProductEnabled: !!form.newProductEnabled,
    saleEnabled: !!form.saleEnabled,
    backInStockEnabled: !!form.backInStockEnabled,
    reviewMilestoneEnabled: !!form.reviewMilestoneEnabled,
    rssEnabled: !!form.rssEnabled,
    youtubeEnabled: !!form.youtubeEnabled,
    rssFeedUrl: feedUrl ? feedUrl : null,
    maxDraftsPerDay: clampAutoDraftCap(form.maxDraftsPerDay),
    socialAccountId: accountId ? accountId : null,
  };
}

// ---------------------------------------------------------------------------
// SU5 — auto-draft badge
// ---------------------------------------------------------------------------

const AUTO_DRAFT_KIND_LABELS: Record<AutoDraftKind, string> = {
  new_product: "🆕 নতুন product",
  sale: "🏷️ সেল",
  back_in_stock: "📦 Back-in-stock",
  review_milestone: "⭐ রিভিউ মাইলফলক",
};

const AUTO_DRAFT_KIND_LABELS_EN: Record<AutoDraftKind, string> = {
  new_product: "🆕 New product",
  sale: "🏷️ Sale",
  back_in_stock: "📦 Back-in-stock",
  review_milestone: "⭐ Review milestone",
};

/** Bengali event label for an autoDraftKind, or null when the post
 * was not commerce-generated (or the kind is unknown). */
export function autoDraftKindLabel(kind: AutoDraftKind | string | null | undefined, locale: UiLocale = "bn"): string | null {
  if (!kind) return null;
  return (locale === "en" ? AUTO_DRAFT_KIND_LABELS_EN[kind as AutoDraftKind] : AUTO_DRAFT_KIND_LABELS[kind as AutoDraftKind]) ?? null;
}

/** Full badge text for a post card, e.g. "Auto draft · 🆕 নতুন
 * product" — null when there is nothing to badge. */
export function autoDraftBadgeLabel(kind: AutoDraftKind | string | null | undefined, locale: UiLocale = "bn"): string | null {
  const label = autoDraftKindLabel(kind, locale);
  return label ? `Auto draft · ${label}` : null;
}

// ---------------------------------------------------------------------------
// SU6 — tracked-link stats
// ---------------------------------------------------------------------------

/** GET organizations/:orgId/social/posts/:id/link-stats shape. */
export interface SocialLinkStats {
  clicks: number;
  lastClickedAt: string | null;
  ordersAssociated: number;
  /** Decimal string in BDT minor units (poisha). */
  revenueAssociatedMinor: string;
  associationNote: string;
}

/** Only Meta Page posts get a clickable tracked link at publish
 * time; the other platforms cannot carry one. */
export function isTrackedLinkPlatform(platform: string | null | undefined): boolean {
  return platform === "meta_page";
}

/** The honest note shown for platforms where tracking does not
 * apply; null for Meta Page posts (tracking applies there). */
export function nonTrackedPlatformNote(platform: string | null | undefined, locale: UiLocale = "bn"): string | null {
  if (isTrackedLinkPlatform(platform)) return null;
  if (platform === "instagram" || platform === "tiktok" || platform === "youtube") {
    return L(locale, "su5NonTrackedNote");
  }
  return null;
}

/** "৩টি click" — Bengali digits, like the rest of the page. */
export function formatClicksLabel(clicks: number, locale: UiLocale = "bn"): string {
  const n = Number.isFinite(clicks) ? Math.max(0, Math.floor(clicks)) : 0;
  return L(locale, "su5Clicks", { count: fmtNumber(locale, n) });
}

/**
 * "{n}টি order · ৳{taka} (association, attribution নয়)" — only
 * when at least one order is associated; otherwise null (nothing
 * is shown rather than an invented zero-revenue line). Revenue
 * uses the existing formatTakaMinor helper.
 */
export function formatOrdersRevenueLabel(stats: SocialLinkStats, locale: UiLocale = "bn"): string | null {
  const orders = Number.isFinite(stats.ordersAssociated) ? Math.floor(stats.ordersAssociated) : 0;
  if (orders <= 0) return null;
  const revenue = locale === "en"
    ? fmtMoneyMinor(locale, BigInt(Math.trunc(Number(stats.revenueAssociatedMinor) || 0)))
    : formatTakaMinor(stats.revenueAssociatedMinor);
  return L(locale, "su5OrdersRevenue", { count: fmtNumber(locale, orders), revenue });
}
