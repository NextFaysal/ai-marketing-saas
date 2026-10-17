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

export const SOCIAL_ACCOUNT_PLATFORMS = ["meta_page", "instagram", "tiktok", "youtube", "linkedin_page", "telegram", "threads"] as const;
export type SocialAccountPlatform = (typeof SOCIAL_ACCOUNT_PLATFORMS)[number];

export const SOCIAL_MEDIA_KINDS = ["image", "video"] as const;
export type SocialMediaKind = (typeof SOCIAL_MEDIA_KINDS)[number];
