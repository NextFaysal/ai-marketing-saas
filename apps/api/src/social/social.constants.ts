/**
 * Social Media Post Scheduler (SP1): shared vocabularies.
 * Statuses/platforms are plain strings in the DB (schema
 * convention); these constants are the single source of truth the
 * API validates against.
 */
export const SOCIAL_POST_STATUSES = [
  "draft",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "cancelled",
  "sent_to_creator",
] as const;
export type SocialPostStatus = (typeof SOCIAL_POST_STATUSES)[number];

export const SOCIAL_ACCOUNT_PLATFORMS = ["meta_page", "instagram", "tiktok", "youtube", "linkedin_page", "telegram", "threads", "google_business_profile"] as const;
export type SocialAccountPlatform = (typeof SOCIAL_ACCOUNT_PLATFORMS)[number];

/**
 * OU9 — Google Business Profile (GBP) as a social platform.
 *
 * The platform id is deliberately NOT "google_business": that
 * string is the Connect Center Integration provider (CC20
 * Google pack), a different row family. The SocialAccount
 * platform follows the descriptive sibling pattern
 * (meta_page / linkedin_page → google_business_profile), and
 * its Integration provider follows the *_social pattern.
 */
export const GBP_PLATFORM = "google_business_profile" as const;
export const GBP_PROVIDER = "google_business_social" as const;
/** The documented GBP OAuth scope (the same scope the CC20
 * Connect Center business flow requests). */
export const GBP_SCOPE = "https://www.googleapis.com/auth/business.manage";

/** The ONE gate message for the GBP API-access approval gate,
 * shared by the connect surface, the platform-modes payload
 * and the publish refusal so the tenant reads the same plain
 * words everywhere. Google requires a per-project API-access
 * application + approval before ANY Business Profile API call
 * can succeed (unapproved project = 0 QPM quota). */
export const GBP_API_ACCESS_GATE_MSG =
  "Google Business Profile API access is not yet approved for this platform's Google project — প্ল্যাটফর্মের Google প্রজেক্টের জন্য Google Business Profile API-এর অনুমোদন এখনো পাওয়া যায়নি। Operator Google-এর কাছে API access-এর আবেদন করে অনুমোদন পেলে এবং Admin Panel-এ সেটি ঘোষণা করলেই GBP পোস্ট প্রকাশ করা যাবে। ততক্ষণ কোনো GBP পোস্ট প্রকাশ করা যাবে না।";

/**
 * OU9 capability flags — truthful to what OU9 ships, nothing
 * more: local-post publishing EXISTS (gated on the approval
 * flag above), location selection EXISTS (the connect picker).
 * Reviews are a SEPARATE API surface (v4 accounts.locations
 * .reviews) that OU9 does NOT build; there is no GBP inbox,
 * comment or insights machinery anywhere in this codebase, so
 * every one of those flags is a literal false — the UI and any
 * future reader must not claim them.
 */
export const GBP_CAPABILITIES = {
  localPostPublishing: true,
  locationSelection: true,
  reviews: false,
  reviewReplies: false,
  inbox: false,
  comments: false,
  insights: false,
} as const;

export const SOCIAL_MEDIA_KINDS = ["image", "video"] as const;
export type SocialMediaKind = (typeof SOCIAL_MEDIA_KINDS)[number];
