// NF1 (FB1 Part C) — Live Commerce page helpers. Pure logic
// only (labels, payload builders, pin-list ordering): the page
// owns fetching and state, everything testable lives here —
// same pattern as lib/pos-scan.ts / lib/social-posts-su11.ts.
import { fmtMoneyMinor, fmtNumber } from "@repo/contracts";
import type { UiLocale } from "./i18n/dict";
import { fmtMoneyBn, fmtNumBn } from "./money-bn";

// MB6: locale-aware formatting for the helpers below. The bn
// path stays on money-bn BYTE-IDENTICALLY (spec-pinned, incl.
// the always-two-fraction-digits money form contracts
// fmtMoneyMinor drops for whole taka); only "en" routes to
// the contracts formatters.
function fmtNumLoc(n: number, locale: UiLocale): string {
  return locale === "en" ? fmtNumber("en", n) : fmtNumBn(n);
}

function fmtMoneyLoc(minor: string | bigint | number | null | undefined, locale: UiLocale): string {
  if (locale !== "en") return fmtMoneyBn(minor);
  if (minor === null || minor === undefined || minor === "") return "—";
  try {
    return fmtMoneyMinor("en", typeof minor === "bigint" ? minor : BigInt(String(minor).trim()));
  } catch {
    const v = Number(minor);
    return Number.isFinite(v) ? fmtMoneyMinor("en", BigInt(Math.round(v))) : "—";
  }
}

/** GET live-sessions / POST live-sessions response row
 * (live-commerce.service pubSession). priceMinor is a STRING
 * (BigInt-safe) or null. */
export interface LiveSessionProductPin {
  id: string;
  productId: string;
  displayOrder: number;
  isNowShowing: boolean;
  product?: {
    id: string;
    name: string;
    sku: string | null;
    priceMinor: string | null;
    imageUrl: string | null;
    status: string;
  };
}

export interface LiveSessionView {
  id: string;
  organizationId: string;
  socialAccountId: string | null;
  externalLiveVideoId: string | null;
  title: string;
  status: string; // scheduled | live | ended
  source: string; // meta | manual
  mode: string; // meta | manual (derived server-side)
  startedAt: string | null;
  endedAt: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  productCount?: number;
  commentCount?: number;
  orderCount?: number;
  products?: LiveSessionProductPin[];
}

export interface LiveComment {
  id: string;
  liveSessionId: string;
  organizationId: string;
  externalCommentId: string | null;
  commenterExternalId: string | null;
  commenterName: string;
  message: string;
  commentedAt: string;
  source: string; // meta | manual
  createdAt: string;
}

/** GET live-sessions/:id/comments — the honest mode contract:
 * a meta session whose provider cannot serve comments comes
 * back mode:"manual" + providerStatus:"unavailable" + reason;
 * the UI must show that, never imply live sync. */
export interface LiveCommentsResponse {
  sessionId: string;
  mode: "meta" | "manual";
  providerStatus: "ok" | "unavailable" | "not_applicable";
  providerReason?: string;
  fetchedCount: number;
  comments: LiveComment[];
}

export interface LiveRecap {
  sessionId: string;
  mode: string;
  status: string;
  commentCount: number;
  distinctCommenters: number;
  orderCount: number;
  revenueMinor: string;
}

export interface FollowUpSegmentResult {
  sessionId: string;
  audienceId: string | null;
  audienceName: string;
  audienceEntity: string;
  matchedCustomerIds: string[];
  matchedCustomerCount: number;
  commenterCount: number;
  unmatchedCount: number;
  note: string;
}

/** POST comments/:commentId/order response. alreadyExisted=true
 * is the exactly-once path: the API returns the EXISTING order
 * instead of creating a second one. */
export interface CommentOrderResult {
  sessionId: string;
  commentId: string;
  orderId: string;
  alreadyExisted: boolean;
  linkId?: string | null;
  order: unknown;
}

/** Catalog row from GET /products (items[]), adapted
 * defensively like social-posts' AiProductOption loader. */
export interface LiveCatalogProduct {
  id: string;
  name: string;
  sku?: string | null;
  priceMinor: string;
  imageUrl?: string | null;
}

export function sessionStatusChip(status: string, locale: UiLocale = "bn"): { label: string; cls: string } {
  switch (status) {
    case "live":
      return { label: locale === "en" ? "Live" : "লাইভ", cls: "bg-red-100 text-red-700" };
    case "ended":
      return { label: locale === "en" ? "Ended" : "শেষ", cls: "bg-slate-200 text-slate-600" };
    default:
      return { label: locale === "en" ? "Scheduled" : "সূচিত", cls: "bg-sky-100 text-sky-700" };
  }
}

/** Source badge: a meta session says "Meta"; anything else is
 * labelled manual — honestly, never dressed up as synced.
 * MB6: optional locale (default "bn", byte-identical bn output). */
export function sessionSourceBadge(session: Pick<LiveSessionView, "source">, locale: UiLocale = "bn"): { label: string; cls: string } {
  return session.source === "meta"
    ? { label: "Meta", cls: "bg-indigo-100 text-indigo-700" }
    : { label: locale === "en" ? "Manual mode" : "ম্যানুয়াল মোড", cls: "bg-amber-100 text-amber-700" };
}

/**
 * The banner line for the comments feed, from the API's own
 * mode/providerStatus fields:
 * - provider unavailable → the exact honest state (Meta থেকে
 *   লাইভ কমেন্ট আসছে না — ম্যানুয়াল মোড);
 * - manual session → comments are hand-entered;
 * - provider ok → null (comments really are flowing from Meta).
 */
export function commentsModeNotice(res: Pick<LiveCommentsResponse, "mode" | "providerStatus"> | null | undefined, locale: UiLocale = "bn"): string | null {
  if (!res) return null;
  if (res.providerStatus === "unavailable") {
    return locale === "en" ? "Live comments are not coming from Meta — manual mode" : "Meta থেকে লাইভ কমেন্ট আসছে না — ম্যানুয়াল মোড";
  }
  if (res.providerStatus === "not_applicable" || res.mode === "manual") {
    return locale === "en" ? "Manual mode — comments are added by hand" : "ম্যানুয়াল মোড — কমেন্ট হাতে যোগ করা হচ্ছে";
  }
  return null;
}

/** Poll the comments endpoint only while the session is live. */
export const COMMENT_POLL_MS = 5000;
export function shouldPollComments(session: Pick<LiveSessionView, "status"> | null | undefined): boolean {
  return session?.status === "live";
}

/** Move one id in the ordered pin list; out-of-range moves are
 * no-ops returning the same order (new array, same content). */
export function movePin(productIds: string[], productId: string, direction: -1 | 1): string[] {
  const idx = productIds.indexOf(productId);
  if (idx < 0) return [...productIds];
  const next = idx + direction;
  if (next < 0 || next >= productIds.length) return [...productIds];
  const out = [...productIds];
  [out[idx], out[next]] = [out[next], out[idx]];
  return out;
}

/** Toggle one product in the pin selection, preserving the
 * existing display order for products that stay pinned. */
export function togglePin(productIds: string[], productId: string): string[] {
  return productIds.includes(productId)
    ? productIds.filter((id) => id !== productId)
    : [...productIds, productId];
}

/** The product the "এখন দেখানো হচ্ছে" toggle targets must be
 * exactly one — this returns the currently-showing productId
 * (or null) from a pin list. */
export function nowShowingProductId(pins: LiveSessionProductPin[] | undefined): string | null {
  return pins?.find((p) => p.isNowShowing)?.productId ?? null;
}

export interface CommentOrderFormInput {
  customerPhone: string;
  customerName?: string;
  address?: string;
  product: { name: string; sku?: string | null; priceMinor: string | number | null };
  quantity: number;
}

/** Build the CreateOrderFromCommentDto body: ONE catalog line
 * resolved from the chosen product (name/sku/unitPriceMinor —
 * the manual-order item shape the API forwards untouched). */
export function buildCommentOrderPayload(input: CommentOrderFormInput) {
  const price = Number(input.product.priceMinor ?? 0);
  return {
    customerPhone: input.customerPhone.trim(),
    ...(input.customerName?.trim() ? { customerName: input.customerName.trim() } : {}),
    ...(input.address?.trim() ? { address: input.address.trim() } : {}),
    items: [{
      name: input.product.name,
      ...(input.product.sku ? { sku: input.product.sku } : {}),
      quantity: Math.max(1, Math.floor(input.quantity) || 1),
      unitPriceMinor: Number.isFinite(price) && price > 0 ? Math.floor(price) : 0,
    }],
  };
}

/** Notice for a comment→order result: the duplicate path says
 * so plainly and names the existing order id. MB6: optional
 * locale (default "bn", byte-identical bn output). The en
 * duplicate line still starts with "This comment" so the page's
 * startsWith(dict.commerce.thisComment) tone check keeps
 * working in both locales. */
export function commentOrderNotice(res: CommentOrderResult, locale: UiLocale = "bn"): string {
  if (locale === "en") {
    return res.alreadyExisted
      ? `This comment already created an order — Order ID: ${res.orderId}`
      : `Order created — Order ID: ${res.orderId}`;
  }
  return res.alreadyExisted
    ? `এই কমেন্ট থেকে আগেই অর্ডার তৈরি হয়েছে — অর্ডার ID: ${res.orderId}`
    : `অর্ডার তৈরি হয়েছে — অর্ডার ID: ${res.orderId}`;
}

/** Recap stat rows, built ONLY from the recap endpoint's
 * fields. MB6: optional locale (default "bn", byte-identical
 * bn labels + bn-BD formatting). */
export function recapRows(recap: LiveRecap, locale: UiLocale = "bn"): { label: string; value: string }[] {
  if (locale === "en") {
    return [
      { label: "Total comments", value: fmtNumLoc(recap.commentCount, locale) },
      { label: "Commenters", value: fmtNumLoc(recap.distinctCommenters, locale) },
      { label: "Orders", value: fmtNumLoc(recap.orderCount, locale) },
      { label: "Revenue", value: fmtMoneyLoc(recap.revenueMinor, locale) },
    ];
  }
  return [
    { label: "মোট কমেন্ট", value: fmtNumBn(recap.commentCount) },
    { label: "কমেন্টকারী", value: fmtNumBn(recap.distinctCommenters) },
    { label: "অর্ডার", value: fmtNumBn(recap.orderCount) },
    { label: "আয়", value: fmtMoneyBn(recap.revenueMinor) },
  ];
}

/** Follow-up result line: the API's matched/unmatched counts
 * plus its own note, verbatim. MB6: optional locale (default
 * "bn", byte-identical bn output). */
export function followUpSummary(res: FollowUpSegmentResult, locale: UiLocale = "bn"): string {
  if (locale === "en") {
    const matched = fmtNumLoc(res.matchedCustomerCount, locale);
    const unmatched = fmtNumLoc(res.unmatchedCount, locale);
    return `Follow-up audience created: ${matched} ${res.matchedCustomerCount === 1 ? "buyer" : "buyers"} matched, ${unmatched} did not match. ${res.note}`;
  }
  return `ফলো-আপ অডিয়েন্স তৈরি হয়েছে: ${fmtNumBn(res.matchedCustomerCount)} জন ক্রেতা মিলেছে, ${fmtNumBn(res.unmatchedCount)} জন মেলেনি। ${res.note}`;
}
