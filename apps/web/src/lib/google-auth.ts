/**
 * AB8 (AX26) — Google SSO login helpers. Pure, unit-testable.
 *
 * Flow (API contract): the login page asks GET /auth/google/config;
 * when enabled, GET /auth/google/start returns the Google consent
 * URL. After consent the API redirects the browser to
 * /login/google#handoff=<token> on success, or back to
 * /login?googleError=<code> on failure. The handoff token is then
 * exchanged via POST /auth/google/exchange for the usual login
 * response (access token, or a TOTP challenge).
 */

/** Error codes the API may put in ?googleError= after a failed Google login. */
export const GOOGLE_ERROR_CODES = [
  "not_configured",
  "state_invalid",
  "exchange_failed",
  "email_unverified",
  "account_not_found",
  "account_inactive",
] as const;

export type GoogleErrorCode = (typeof GOOGLE_ERROR_CODES)[number];

const GENERIC_GOOGLE_ERROR = "Google লগইন ব্যর্থ হয়েছে — আবার চেষ্টা করুন";

/**
 * Bengali message for a ?googleError= code. Returns null when there
 * is no code (nothing to show). Unknown codes fall back to the
 * generic message — the code itself is never rendered.
 */
export function googleErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  switch (code) {
    case "account_not_found":
      return "এই Google অ্যাকাউন্টের ইমেইলে কোনো অ্যাকাউন্ট নেই — আগে পাসওয়ার্ড দিয়ে নিবন্ধন করুন";
    case "account_inactive":
      return "অ্যাকাউন্টটি সক্রিয় নয়";
    case "email_unverified":
      return "Google অ্যাকাউন্টের ইমেইল যাচাই করা নয়";
    default:
      return GENERIC_GOOGLE_ERROR;
  }
}

/**
 * Extract the handoff token from a location.hash value such as
 * "#handoff=abc123" (extra fragment params are ignored). Returns
 * null when the fragment is empty or carries no usable token.
 */
export function parseHandoffFromHash(hash: string | null | undefined): string | null {
  if (!hash) return null;
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  const token = new URLSearchParams(raw).get("handoff");
  return token && token.trim() !== "" ? token : null;
}
