/**
 * SU1/SU2 — pure helpers for the Social Posts Composer v2:
 * per-platform preview + pre-flight warnings, first-comment
 * applicability, post-group payload building and posting-slot
 * weekday labels.
 *
 * Kept pure (no React, no fetch) so the behaviour is unit-testable
 * without a component harness — same pattern as
 * social-post-filters / social-post-insights.
 *
 * The preview rules mirror what the API actually does at publish
 * time (e.g. YouTube: title = the caption's first line, capped at
 * 100 chars, description = the full caption — see the API's
 * social-publish.service). The preview is a preview only: it never
 * changes the caption that gets saved.
 */
import { fmtNumber, type UiLocale } from "@repo/contracts";
import { tr } from "./i18n/lookup";
import { socialBn, socialEn } from "./i18n/social";

const SOCIAL_DICTS = { bn: socialBn, en: socialEn };
const L = (locale: UiLocale, key: string, params?: Record<string, string | number>) =>
  tr(SOCIAL_DICTS, locale, key, params) ?? key;


export type ComposerPlatform = "meta_page" | "instagram" | "tiktok" | "youtube";

export type ComposerMediaKind = "image" | "video";

export type RecurrenceFrequency = "daily" | "weekly" | "monthly";

const PLATFORM_LABELS: Record<string, string> = {
  meta_page: "Facebook Page",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
};

/** Bengali digits for a non-negative integer, e.g. 3 → "৩". */
export function bnNum(n: number): string {
  return String(n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
}

/**
 * First comments are only posted on Meta platforms. TikTok (inbox /
 * direct post) and YouTube publishes carry no first-comment step in
 * the API, so the composer must not promise one there.
 */
export function isFirstCommentApplicable(platform: string): boolean {
  return platform === "meta_page" || platform === "instagram";
}

/** Display label for a platform (falls back to the raw value). */
export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform;
}

const WEEKDAY_LABELS_BN = ["রবিবার", "সোমবার", "মঙ্গলবার", "বুধবার", "বৃহস্পতিবার", "শুক্রবার", "শনিবার"] as const;

/** Weekday label, 0 = রবিবার (Sunday) … 6 = শনিবার (Saturday). Out of range → "". */
export function weekdayLabelBn(weekday: number, locale: UiLocale = "bn"): string {
  if (locale === "en") {
    if (weekday < 0 || weekday > 6) return "";
    return new Intl.DateTimeFormat("en-IN", { weekday: "long" }).format(new Date(2024, 0, 7 + weekday));
  }
  return WEEKDAY_LABELS_BN[weekday] ?? "";
}

export interface PlatformPreviewInput {
  caption: string;
  linkUrl?: string | null;
  mediaKinds: ComposerMediaKind[];
  firstCommentText?: string | null;
}

export interface PlatformPreview {
  platform: string;
  label: string;
  /** Caption as this platform's preview shows it (truncated per platform rule, preview only). */
  captionShown: string;
  /** YouTube only: the video title (= caption's first line, max 100 chars). Null elsewhere. */
  title: string | null;
  /** YouTube only: the video description (= the full caption). Null elsewhere. */
  description: string | null;
  /** e.g. "৩টি ছবি" / "১টি ভিডিও" / "৩টি ছবি ও ১টি ভিডিও" / "শুধু লেখা". */
  mediaSummary: string;
  /** The first comment as it would appear — null when not applicable or empty. */
  firstCommentShown: string | null;
  /** Client-side pre-flight warnings, all in Bengali. Empty = no known problem. */
  warnings: string[];
}

function mediaSummaryBn(mediaKinds: ComposerMediaKind[], locale: UiLocale = "bn"): string {
  const images = mediaKinds.filter((k) => k === "image").length;
  const videos = mediaKinds.filter((k) => k === "video").length;
  if (images === 0 && videos === 0) return L(locale, "compTextOnly");
  const parts: string[] = [];
  if (images > 0) parts.push(L(locale, "compImages", { count: fmtNumber(locale, images) }));
  if (videos > 0) parts.push(L(locale, "compVideos", { count: fmtNumber(locale, videos) }));
  return parts.join(L(locale, "compJoin"));
}

export function buildPlatformPreview(platform: string, input: PlatformPreviewInput, locale: UiLocale = "bn"): PlatformPreview {
  const caption = input.caption ?? "";
  const mediaKinds = input.mediaKinds ?? [];
  const images = mediaKinds.filter((k) => k === "image").length;
  const videos = mediaKinds.filter((k) => k === "video").length;
  const warnings: string[] = [];

  // --- Per-platform caption view + warnings (pre-flight, client form) ---
  let captionShown = caption;
  let title: string | null = null;
  let description: string | null = null;

  if (platform === "instagram") {
    // Instagram captions are capped at 2,200 characters by the platform.
    captionShown = caption.slice(0, 2200);
    if (mediaKinds.length === 0) {
      warnings.push(L(locale, "compWarnIgNoMedia"));
    }
    if (mediaKinds.length > 10) {
      warnings.push(L(locale, "compWarnIgMax", { count: fmtNumber(locale, mediaKinds.length) }));
    }
  }

  if (platform === "tiktok") {
    if (!(mediaKinds.length === 1 && videos === 1)) {
      warnings.push(L(locale, "compWarnTiktok"));
    }
  }

  if (platform === "youtube") {
    const firstLine = caption.split("\n")[0] ?? "";
    title = firstLine.slice(0, 100);
    description = caption;
    captionShown = title;
    if (firstLine.length > 100) {
      warnings.push(L(locale, "compWarnYtTitle"));
    }
    if (!(mediaKinds.length === 1 && videos === 1)) {
      warnings.push(L(locale, "compWarnYtVideo"));
    }
  }

  if (platform === "meta_page") {
    if (videos > 0 && mediaKinds.length > 1) {
      warnings.push(L(locale, "compWarnFbMix"));
    }
  }

  const firstComment = (input.firstCommentText ?? "").trim();
  return {
    platform,
    label: platformLabel(platform),
    captionShown,
    title,
    description,
    mediaSummary: mediaSummaryBn(mediaKinds, locale),
    firstCommentShown: isFirstCommentApplicable(platform) && firstComment ? firstComment : null,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Post groups (SU1): one draft per selected account, saved in one call.
// ---------------------------------------------------------------------------

export interface ComposerMediaRef {
  assetId: string;
  kind: ComposerMediaKind;
}

export interface ComposerBaseInput {
  caption: string;
  linkUrl?: string | null;
  mediaRefs: ComposerMediaRef[];
  firstCommentText?: string | null;
  recurrenceFrequency?: RecurrenceFrequency | null;
  recurrenceInterval?: number | null;
}

export interface VariantOverride {
  caption?: string;
  firstCommentText?: string;
}

export interface GroupVariantPayload {
  socialAccountId: string;
  caption: string;
  linkUrl?: string;
  mediaRefs: ComposerMediaRef[];
  firstCommentText?: string;
  recurrenceFrequency?: RecurrenceFrequency;
  recurrenceInterval?: number;
}

export interface GroupPayload {
  name: string;
  variants: GroupVariantPayload[];
}

/** Group name from the caption: its first line, trimmed and capped; "Untitled group" when empty. */
export function groupNameFromCaption(caption: string): string {
  const firstLine = (caption ?? "").split("\n")[0]?.trim() ?? "";
  if (!firstLine) return "Untitled group";
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
}

/**
 * Build the POST posts/group payload: one variant per selected
 * account. A per-account override wins when it has real text; an
 * empty/whitespace override falls back to the shared base value —
 * so leaving a variant's caption blank honestly means "use the
 * main caption", never an empty post.
 */
export function groupVariantsForSave(
  selectedAccountIds: string[],
  base: ComposerBaseInput,
  overrides: Record<string, VariantOverride | undefined>,
): GroupPayload {
  const baseFirstComment = (base.firstCommentText ?? "").trim();
  const linkUrl = (base.linkUrl ?? "").trim();
  const variants: GroupVariantPayload[] = selectedAccountIds.map((accountId) => {
    const override = overrides[accountId];
    const captionOverride = (override?.caption ?? "").trim();
    const firstCommentOverride = (override?.firstCommentText ?? "").trim();
    const variant: GroupVariantPayload = {
      socialAccountId: accountId,
      caption: captionOverride ? (override?.caption as string) : base.caption,
      mediaRefs: base.mediaRefs,
    };
    if (linkUrl) variant.linkUrl = linkUrl;
    const firstComment = firstCommentOverride ? (override?.firstCommentText as string) : baseFirstComment;
    if (firstComment) variant.firstCommentText = firstComment;
    if (base.recurrenceFrequency) {
      variant.recurrenceFrequency = base.recurrenceFrequency;
      if (typeof base.recurrenceInterval === "number" && base.recurrenceInterval > 0) {
        variant.recurrenceInterval = base.recurrenceInterval;
      }
    }
    return variant;
  });
  return { name: groupNameFromCaption(base.caption), variants };
}
