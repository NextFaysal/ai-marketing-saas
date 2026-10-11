/**
 * AD3 — platform account-status normalization.
 *
 * Each platform reports an account status in its own vocabulary.
 * We store the platform's VERBATIM value (platformStatusRaw) plus a
 * normalized bucket (platformStatusBucket) so the UI and the
 * transition notification have one shared vocabulary:
 *
 *   active     — the account can advertise normally
 *   disabled   — the platform has shut the account (disabled/closed)
 *   restricted — the account exists but is limited (unsettled,
 *                pending review/settlement, suspended, grace period,
 *                pending closure/verification)
 *   unknown    — the platform returned a status value that is not
 *                in the documented set we map (raw is still stored)
 *
 * When a platform returns NO status at all, callers keep raw/bucket
 * null — a missing status is never dressed up as "active".
 */

export type PlatformStatusBucket = "active" | "disabled" | "restricted" | "unknown";

export interface PlatformStatusInfo {
  /** Verbatim platform value as a string, or null when not reported. */
  raw: string | null;
  /** Normalized bucket, or null when nothing was reported. */
  bucket: PlatformStatusBucket | null;
  /** Platform-reported account timezone, or null when not reported. */
  timezone: string | null;
}

export const NO_STATUS: PlatformStatusInfo = { raw: null, bucket: null, timezone: null };

/**
 * Meta account_status codes (Graph API ad account field, documented):
 *   1 ACTIVE, 2 DISABLED, 3 UNSETTLED, 7 PENDING_RISK_REVIEW,
 *   8 PENDING_SETTLEMENT, 9 IN_GRACE_PERIOD, 100 PENDING_CLOSURE,
 *   101 CLOSED.
 */
export function metaStatusBucket(code: number): PlatformStatusBucket {
  switch (code) {
    case 1: return "active";
    case 2:
    case 101: return "disabled";
    case 3:
    case 7:
    case 8:
    case 9:
    case 100: return "restricted";
    default: return "unknown";
  }
}

export function metaStatusInfo(status: number | undefined | null, timezone?: string | null): PlatformStatusInfo {
  if (status === undefined || status === null || Number.isNaN(status)) {
    return { raw: null, bucket: null, timezone: timezone ?? null };
  }
  return { raw: String(status), bucket: metaStatusBucket(status), timezone: timezone ?? null };
}

/**
 * Google Ads customer.status (CustomerStatus enum, documented):
 * ENABLED, CANCELED, SUSPENDED, CLOSED (plus UNSPECIFIED/UNKNOWN
 * placeholders, which carry no information and map to unknown only
 * when actually returned as a value).
 */
export function googleStatusBucket(status: string | undefined | null): PlatformStatusBucket | null {
  if (!status) return null;
  switch (status.toUpperCase()) {
    case "ENABLED": return "active";
    case "SUSPENDED": return "restricted";
    case "CANCELED":
    case "CLOSED": return "disabled";
    default: return "unknown";
  }
}

export function googleStatusInfo(status?: string | null, timeZone?: string | null): PlatformStatusInfo {
  if (!status) return { raw: null, bucket: null, timezone: timeZone ?? null };
  return { raw: status, bucket: googleStatusBucket(status), timezone: timeZone ?? null };
}

/**
 * TikTok advertiser status (advertiser/info `status` field):
 * STATUS_ENABLE, STATUS_DISABLE, plus pending/limit states
 * (STATUS_PENDING_CONFIRM, STATUS_PENDING_VERIFIED,
 * STATUS_CONFIRM_FAIL, STATUS_LIMIT, ...).
 */
export function tiktokStatusBucket(status: string | undefined | null): PlatformStatusBucket | null {
  if (!status) return null;
  const s = status.toUpperCase();
  if (s === "STATUS_ENABLE") return "active";
  if (s === "STATUS_DISABLE") return "disabled";
  if (s.startsWith("STATUS_PENDING") || s.startsWith("STATUS_CONFIRM") || s.startsWith("STATUS_LIMIT")) return "restricted";
  return "unknown";
}

export function tiktokStatusInfo(status?: string | null, timezone?: string | null): PlatformStatusInfo {
  if (!status) return { raw: null, bucket: null, timezone: timezone ?? null };
  return { raw: status, bucket: tiktokStatusBucket(status), timezone: timezone ?? null };
}

/** Bengali label for a bucket, shared by notification text. */
export function bucketLabelBn(bucket: string | null | undefined): string {
  switch (bucket) {
    case "active": return "সক্রিয়";
    case "disabled": return "বন্ধ (Disabled)";
    case "restricted": return "সীমাবদ্ধ (Restricted)";
    case "unknown": return "অজানা অবস্থা";
    default: return "জানা নেই";
  }
}
