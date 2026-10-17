// NF1 (FB1 Part C) — Live Commerce page helpers. Pure logic
// only (labels, payload builders, pin-list ordering): the page
// owns fetching and state, everything testable lives here —
// same pattern as lib/pos-scan.ts / lib/social-posts-su11.ts.
import { fmtMoneyBn, fmtNumBn } from "./money-bn";

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

export function sessionStatusChip(status: string): { label: string; cls: string } {
  switch (status) {
    case "live":
      return { label: "লাইভ", cls: "bg-red-100 text-red-700" };
    case "ended":
      return { label: "শেষ", cls: "bg-slate-200 text-slate-600" };
    default:
      return { label: "সূচিত", cls: "bg-sky-100 text-sky-700" };
  }
}

/** Source badge: a meta session says "Meta"; anything else is
 * labelled manual — honestly, never dressed up as synced. */
export function sessionSourceBadge(session: Pick<LiveSessionView, "source">): { label: string; cls: string } {
  return session.source === "meta"
    ? { label: "Meta", cls: "bg-indigo-100 text-indigo-700" }
    : { label: "ম্যানুয়াল মোড", cls: "bg-amber-100 text-amber-700" };
}

/**
 * The banner line for the comments feed, from the API's own
 * mode/providerStatus fields:
 * - provider unavailable → the exact honest state (Meta থেকে
 *   লাইভ কমেন্ট আসছে না — ম্যানুয়াল মোড);
 * - manual session → comments are hand-entered;
 * - provider ok → null (comments really are flowing from Meta).
 */
export function commentsModeNotice(res: Pick<LiveCommentsResponse, "mode" | "providerStatus"> | null | undefined): string | null {
  if (!res) return null;
  if (res.providerStatus === "unavailable") {
    return "Meta থেকে লাইভ কমেন্ট আসছে না — ম্যানুয়াল মোড";
  }
  if (res.providerStatus === "not_applicable" || res.mode === "manual") {
    return "ম্যানুয়াল মোড — কমেন্ট হাতে যোগ করা হচ্ছে";
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
 * so plainly and names the existing order id. */
export function commentOrderNotice(res: CommentOrderResult): string {
  return res.alreadyExisted
    ? `এই কমেন্ট থেকে আগেই অর্ডার তৈরি হয়েছে — অর্ডার ID: ${res.orderId}`
    : `অর্ডার তৈরি হয়েছে — অর্ডার ID: ${res.orderId}`;
}

/** Recap stat rows (Bengali labels + bn-BD formatting), built
 * ONLY from the recap endpoint's fields. */
export function recapRows(recap: LiveRecap): { label: string; value: string }[] {
  return [
    { label: "মোট কমেন্ট", value: fmtNumBn(recap.commentCount) },
    { label: "কমেন্টকারী", value: fmtNumBn(recap.distinctCommenters) },
    { label: "অর্ডার", value: fmtNumBn(recap.orderCount) },
    { label: "আয়", value: fmtMoneyBn(recap.revenueMinor) },
  ];
}

/** Follow-up result line: the API's matched/unmatched counts
 * plus its own note, verbatim. */
export function followUpSummary(res: FollowUpSegmentResult): string {
  return `ফলো-আপ অডিয়েন্স তৈরি হয়েছে: ${fmtNumBn(res.matchedCustomerCount)} জন ক্রেতা মিলেছে, ${fmtNumBn(res.unmatchedCount)} জন মেলেনি। ${res.note}`;
}
