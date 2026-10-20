// NF2 (FB1 Part C) — Video Studio page helpers. Pure logic
// only (labels, payload builders, preview-src resolution):
// the page owns fetching and state — same pattern as
// lib/live-commerce.ts / lib/pos-scan.ts.
import { mediaSrc } from "./media-src";
import type { UiLocale } from "@repo/contracts";

/** VideoProject public view (video-studio.service serialize):
 * status queued|rendering|ready|failed; errorLabel is the API's
 * own Bengali failure reason (shown verbatim); assetUrl is the
 * ready asset's EXISTING public URL or null; socialPostId is
 * set once the project has been turned into a SocialPost. */
export interface VideoProjectView {
  id: string;
  organizationId: string;
  productId: string;
  productName: string | null;
  template: string; // showcase | offer
  language: string; // bn | en
  offerText: string | null;
  status: string; // queued | rendering | ready | failed
  mediaAssetId: string | null;
  assetUrl: string | null;
  errorLabel: string | null;
  socialPostId: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export const VIDEO_TEMPLATES = [
  { value: "showcase", label: "শোকেস", labelEn: "Showcase" },
  { value: "offer", label: "অফার", labelEn: "Offer" },
] as const;

export const VIDEO_LANGUAGES = [
  { value: "bn", label: "বাংলা", labelEn: "Bengali" },
  { value: "en", label: "English", labelEn: "English" },
] as const;

/** Honest provenance note: v1 renders templates locally with
 * ffmpeg — nothing on this surface is AI-generated, and the
 * page must never label it so. */
export const VIDEO_HONESTY_NOTE =
  "ভিডিওগুলো সার্ভারে টেমপ্লেট দিয়ে স্থানীয়ভাবে (ffmpeg) রেন্ডার হয় — বাইরের AI ভিডিও সুবিধা এখনো যুক্ত হয়নি।";
export const VIDEO_HONESTY_NOTE_EN =
  "Videos are rendered locally on the server from templates (ffmpeg) — no external AI video service is connected yet.";

export function videoHonestyNote(locale: UiLocale = "bn"): string {
  return locale === "en" ? VIDEO_HONESTY_NOTE_EN : VIDEO_HONESTY_NOTE;
}

export function templateLabel(template: string, locale: UiLocale = "bn"): string {
  const found = VIDEO_TEMPLATES.find((t) => t.value === template);
  if (!found) return template;
  return locale === "en" ? found.labelEn : found.label;
}

export function projectStatusChip(status: string, locale: UiLocale = "bn"): { label: string; cls: string } {
  switch (status) {
    case "ready":
      return { label: locale === "en" ? "Ready" : "প্রস্তুত", cls: "bg-emerald-100 text-emerald-700" };
    case "rendering":
      return { label: locale === "en" ? "Rendering" : "তৈরি হচ্ছে", cls: "bg-sky-100 text-sky-700" };
    case "failed":
      return { label: locale === "en" ? "Failed" : "ব্যর্থ", cls: "bg-red-100 text-red-700" };
    default:
      return { label: locale === "en" ? "Pending" : "অপেক্ষমাণ", cls: "bg-amber-100 text-amber-700" };
  }
}

/** Publish is offered only for ready projects (the API refuses
 * anything else before it ever touches SocialService). */
export function canPublish(project: Pick<VideoProjectView, "status">): boolean {
  return project.status === "ready";
}

/** Retry-render is meaningful for failed projects (recorded
 * failure) and queued ones (the sweep may not run for this org);
 * a ready project re-render is a server no-op, a rendering one
 * is in flight — neither gets the button. */
export function canRetryRender(project: Pick<VideoProjectView, "status">): boolean {
  return project.status === "failed" || project.status === "queued";
}

export function isPublished(project: Pick<VideoProjectView, "socialPostId">): boolean {
  return Boolean(project.socialPostId);
}

/** Where a published project's SocialPost lives in the
 * dashboard — the API returns only the post id, so the link
 * targets the Social Posts page and the id is shown verbatim. */
export function socialPostHref(_project: Pick<VideoProjectView, "socialPostId">): string {
  return "/dashboard/social-posts";
}

/** Resolve the API's assetUrl to a playable <video> src:
 * absolute CDN URLs pass through, the relative
 * /public/media/<token> path is prefixed with the API base
 * (the existing mediaSrc rule). Null stays null — no preview
 * is ever fabricated for a project without an asset. */
export function videoPreviewSrc(assetUrl: string | null | undefined, apiBase: string): string | null {
  return mediaSrc(apiBase, assetUrl ?? null);
}

export interface CreateProjectFormInput {
  productId: string;
  template: string;
  language: string;
  offerText?: string;
}

/** Build the CreateVideoProjectDto body: empty offer text is
 * omitted (the API stores null), never sent as "". */
export function buildCreateProjectPayload(input: CreateProjectFormInput) {
  return {
    productId: input.productId,
    template: input.template || "showcase",
    language: input.language || "bn",
    ...(input.offerText?.trim() ? { offerText: input.offerText.trim() } : {}),
  };
}

/** Build the PublishVideoProjectDto body: both fields optional
 * — omitting the account lets the API pick the org's first
 * connected account; omitting the caption uses its default. */
export function buildPublishPayload(input: { socialAccountId?: string; caption?: string }) {
  return {
    ...(input.socialAccountId?.trim() ? { socialAccountId: input.socialAccountId.trim() } : {}),
    ...(input.caption?.trim() ? { caption: input.caption.trim() } : {}),
  };
}
