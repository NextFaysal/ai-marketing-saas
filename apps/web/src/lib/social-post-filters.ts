/**
 * SP2 — client-side search/filter for the Social Posts page.
 *
 * The list endpoint already returns everything the page needs per
 * post (caption, status, and the owning account's name/platform),
 * so filtering runs over the already-fetched list — the same shape
 * as AD6's filterAdAccounts. Kept as a pure function so the
 * behaviour is unit-testable without a component harness.
 */

export type SocialPlatform = "meta_page" | "instagram";

export type SocialPostStatus =
  | "draft"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed"
  | "cancelled"
  | "sent_to_creator";

export interface SocialMediaRef {
  assetId: string;
  kind: "image" | "video";
}

export interface SocialPostAccountLite {
  id: string;
  platform: SocialPlatform;
  name: string;
  username?: string | null;
}

export interface SocialPost {
  id: string;
  socialAccountId: string;
  caption: string;
  linkUrl?: string | null;
  mediaRefs: SocialMediaRef[];
  status: SocialPostStatus;
  scheduledAt?: string | null;
  publishedAt?: string | null;
  platformPostId?: string | null;
  platformUrl?: string | null;
  error?: string | null;
  attempts?: number;
  createdAt: string;
  updatedAt: string;
  account: SocialPostAccountLite;
}

export interface SocialPostFilters {
  /** Free text matched against caption, account name and @username (case-insensitive substring). */
  query?: string;
  /** Exact status match ("draft" | "scheduled" | …); empty = all. */
  status?: string;
  /** Exact owning-account match (post.socialAccountId); empty = all. */
  accountId?: string;
}

export function filterSocialPosts<T extends SocialPost>(posts: T[], filters: SocialPostFilters): T[] {
  const q = (filters.query ?? "").trim().toLowerCase();
  return posts.filter((p) => {
    if (filters.status && p.status !== filters.status) return false;
    if (filters.accountId && p.socialAccountId !== filters.accountId) return false;
    if (q) {
      const haystack = [p.caption, p.account?.name ?? "", p.account?.username ?? ""].join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}
