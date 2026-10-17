/**
 * SN1/SN2 (Social Posts Next, Batch N1) — web-side types + pure
 * helpers. Fetching stays in page.tsx / the public share page; this
 * module only shapes data so it can be unit-tested.
 */

// ---------------------------------------------------------------------------
// SN1 — YouTube playlists (GET accounts/:id/youtube/playlists).
// ---------------------------------------------------------------------------

export interface YouTubePlaylistOption {
  id: string;
  title: string;
}

// ---------------------------------------------------------------------------
// SN2 — client approval share links.
// ---------------------------------------------------------------------------

/** Row from GET posts/:id/share-links (token comes back masked). */
export interface SocialShareLink {
  id: string;
  postId: string | null;
  groupId: string | null;
  tokenMasked: string;
  expiresAt: string;
  revokedAt: string | null;
  createdById: string;
  createdAt: string;
}

/** Create response — the ONLY time the full URL is returned. */
export interface SocialShareLinkCreated extends SocialShareLink {
  url: string;
  urlNote?: string;
}

export type ShareLinkStatus = "active" | "expired" | "revoked";

/** Status is derived, never stored: revoked beats expired. */
export function shareLinkStatus(link: Pick<SocialShareLink, "expiresAt" | "revokedAt">, now: Date = new Date()): ShareLinkStatus {
  if (link.revokedAt) return "revoked";
  if (new Date(link.expiresAt).getTime() <= now.getTime()) return "expired";
  return "active";
}

export const SHARE_LINK_STATUS_META: Record<ShareLinkStatus, { label: string; pillCls: string }> = {
  active: { label: "সক্রিয়", pillCls: "bg-emerald-100 text-emerald-800" },
  expired: { label: "মেয়াদ শেষ", pillCls: "bg-slate-200 text-slate-600" },
  revoked: { label: "বাতিল করা", pillCls: "bg-red-100 text-red-700" },
};

export type ClientReviewDecision = "approved" | "changes_requested";

export const CLIENT_REVIEW_META: Record<ClientReviewDecision, { label: string; pillCls: string }> = {
  approved: { label: "ক্লায়েন্ট অনুমোদন দিয়েছেন", pillCls: "bg-emerald-100 text-emerald-800" },
  changes_requested: { label: "ক্লায়েন্ট পরিবর্তন চেয়েছেন", pillCls: "bg-amber-100 text-amber-800" },
};

/** Effective client review carried on the public preview + timeline. */
export interface ClientReviewSummary {
  decision: ClientReviewDecision;
  reviewerName: string;
  comment: string | null;
  createdAt: string;
}

/** Public preview payload (GET /public/social/share/:token) — whitelist only. */
export interface PublicSharePost {
  postId: string;
  caption: string;
  media: { kind: "image" | "video"; publicUrl: string }[];
  platform: string;
  accountDisplayName: string;
  status: string;
  clientReview: ClientReviewSummary | null;
}

export interface PublicSharePreview {
  posts: PublicSharePost[];
}
