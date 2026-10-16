/**
 * GB3 (GC8/GC9): pure helpers for checkout trust + fraud hardening.
 * Side-effect free so they are unit-testable like orders-on*.
 * The server stays the authority — these helpers only shape the
 * payloads the fixed GB3 API contracts accept and validate the
 * dashboard forms before they are sent.
 */
import { takaToMinor } from "./orders-on1";

/** Public checkout-trust block carried by the shop-home, the
 * single-product and the landing payloads (settings-level sibling). */
export interface CheckoutTrust {
  termsRequired: boolean;
  termsRef: string | null;
  termsUrl: string | null;
  termsPage: boolean;
  captcha: { checkoutEnabled: boolean; otpEnabled: boolean; siteKey: string | null };
  cod: { maxOrderMinor: string | null; advanceAboveMinor: string | null };
}

/** Whether a Turnstile widget should render for a surface: the
 * trust block must say the surface is enabled AND carry a site
 * key (a half-configured CAPTCHA renders nothing — the server
 * mirrors this by skipping verification when unconfigured). */
export function captchaSiteKeyFor(
  trust: CheckoutTrust | null | undefined,
  surface: "checkout" | "otp",
): string | null {
  if (!trust?.captcha) return null;
  const enabled = surface === "checkout" ? trust.captcha.checkoutEnabled : trust.captcha.otpEnabled;
  if (!enabled) return null;
  const key = trust.captcha.siteKey?.trim();
  return key ? key : null;
}

/** Terms link for a checkout surface: an explicit merchant URL
 * wins; otherwise the shop terms page when the payload says one
 * exists and an org slug is available to build its route. */
export function termsHrefFor(
  trust: CheckoutTrust | null | undefined,
  orgSlug?: string | null,
): string | null {
  if (!trust?.termsRequired) return null;
  if (trust.termsUrl?.trim()) return trust.termsUrl.trim();
  if (trust.termsPage && orgSlug) return `/shop/${encodeURIComponent(orgSlug)}/p/terms`;
  return null;
}

/** True when a minor-unit total strictly exceeds a minor-unit
 * threshold. Either side unparseable / threshold null = false
 * (no invented advance requirement). */
export function exceedsMinor(totalMinor: string | number | null | undefined, thresholdMinor: string | null | undefined): boolean {
  if (thresholdMinor == null || totalMinor == null) return false;
  try {
    return BigInt(String(totalMinor)) > BigInt(thresholdMinor);
  } catch {
    return false;
  }
}

// --- Identifier lists ------------------------------------------------

export type IdentifierKind = "phone" | "email" | "ip" | "device";

/** Bengali labels for the identifier-kind vocabulary (AB8/AX27
 * adds "device" — the value is a 64-char hex device hash). */
export const IDENTIFIER_KIND_LABEL: Record<string, string> = {
  phone: "ফোন",
  email: "ইমেইল",
  ip: "IP",
  device: "ডিভাইস হ্যাশ",
};

export function identifierKindLabel(kind: string): string {
  return IDENTIFIER_KIND_LABEL[kind] ?? kind;
}

export function normalizeIdentifierValue(kind: string, value: string): string {
  const v = value.trim();
  // Device hashes are canonical lowercase hex (the API mirrors
  // this); email is case-insensitive too.
  return kind === "email" || kind === "device" ? v.toLowerCase() : v;
}

/** Basic client-side validation for the blocked/trusted identifier
 * forms. Returns a Bengali error string, or null when the value is
 * shaped plausibly for its kind. The server re-validates. */
export function validateIdentifierInput(
  kind: string,
  value: string,
  allowedKinds: readonly string[],
): string | null {
  if (!allowedKinds.includes(kind)) return "ধরনটি সঠিক নয়।";
  const v = normalizeIdentifierValue(kind, value);
  if (!v) return "মান লিখুন।";
  if (kind === "email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "সঠিক ইমেইল ঠিকানা লিখুন।";
  } else if (kind === "ip") {
    const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(v);
    const ipv6 = v.includes(":") && /^[0-9a-fA-F:]+$/.test(v);
    if (!ipv4 && !ipv6) return "সঠিক IP ঠিকানা লিখুন।";
  } else if (kind === "phone") {
    const digits = v.replace(/[\s+-]/g, "");
    if (!/^\d{7,15}$/.test(digits)) return "সঠিক ফোন নম্বর লিখুন।";
  } else if (kind === "device") {
    // AB8 (AX27): a device identifier is the full 64-char hex
    // hash (normalized to lowercase above) — a prefix alone is
    // not an identifier and must never be accepted as one.
    if (!/^[0-9a-f]{64}$/.test(v)) return "সঠিক ডিভাইস হ্যাশ লিখুন (৬৪ অক্ষরের hex)।";
  }
  return null;
}

// --- Fraud attempts ---------------------------------------------------

/** Bengali labels for the fixed fraud-attempt kind vocabulary.
 * Unknown kinds render as the raw key, never an invented label.
 * AB8 (AX27): device refusals are NOT a new kind — they log as
 * "blocked_identifier" with a device-hash-prefix summary, so no
 * extra entry is needed here. */
export const FRAUD_ATTEMPT_KIND_LABEL: Record<string, string> = {
  blocked_identifier: "ব্লক করা শনাক্তকারী",
  open_order_policy: "খোলা অর্ডার নীতি",
  waiting_period: "অপেক্ষার সময়",
  daily_limit: "দৈনিক সীমা",
  captcha: "CAPTCHA যাচাই",
  fraud_rule: "নিয়ম (fraud rule)",
};

export function fraudAttemptKindLabel(kind: string): string {
  return FRAUD_ATTEMPT_KIND_LABEL[kind] ?? kind;
}

// --- Fraud rules ------------------------------------------------------

export type FraudRuleAction = "hold" | "tag" | "block_checkout";

export const FRAUD_RULE_ACTION_LABEL: Record<string, string> = {
  hold: "আটকাও",
  tag: "ট্যাগ",
  block_checkout: "checkout ব্লক",
};

export interface FraudRuleConditions {
  minTotalMinor?: string;
  isCod?: boolean;
  districtIn?: string[];
  phoneOpenOrdersGte?: number;
  minRiskScore?: number;
}

/** The dashboard rule-create form state (all text inputs stay
 * strings until shaping, mirroring the other orders panels). */
export interface FraudRuleDraft {
  name: string;
  action: string;
  tagValue: string;
  minTotalTaka: string;
  isCod: boolean;
  districtsText: string;
  phoneOpenOrdersGte: string;
  minRiskScore: string;
}

export const EMPTY_FRAUD_RULE_DRAFT: FraudRuleDraft = {
  name: "", action: "hold", tagValue: "", minTotalTaka: "",
  isCod: false, districtsText: "", phoneOpenOrdersGte: "", minRiskScore: "",
};

export interface FraudRulePayload {
  name: string;
  action: FraudRuleAction;
  tagValue?: string;
  conditions: FraudRuleConditions;
}

/**
 * Shape a rule draft into the POST /fraud-rules payload.
 * - taka -> minor string via the shared orders-on1 converter;
 * - empty conditions are dropped entirely (never sent as
 *   null / "" / []);
 * - a tag rule without a tagValue is flagged, never sent;
 * - unparseable numbers are flagged, never coerced silently.
 */
export function buildFraudRulePayload(
  draft: FraudRuleDraft,
): { payload: FraudRulePayload | null; errors: string[] } {
  const errors: string[] = [];
  const name = draft.name.trim();
  if (!name) errors.push("নিয়মের নাম লিখুন।");
  const action = draft.action as FraudRuleAction;
  if (!["hold", "tag", "block_checkout"].includes(action)) errors.push("নিয়মের অ্যাকশন সঠিক নয়।");
  const tagValue = draft.tagValue.trim();
  if (action === "tag" && !tagValue) errors.push("ট্যাগ নিয়মের জন্য ট্যাগের মান (tagValue) লিখুন।");

  const conditions: FraudRuleConditions = {};
  if (draft.minTotalTaka.trim()) {
    const minor = takaToMinor(draft.minTotalTaka);
    if (minor === null) errors.push("সর্বনিম্ন মোট টাকায় ঠিকভাবে লিখুন (যেমন: 5000 বা 5000.50)।");
    else conditions.minTotalMinor = minor;
  }
  if (draft.isCod) conditions.isCod = true;
  const districts = draft.districtsText.split(",").map((s) => s.trim()).filter(Boolean);
  if (districts.length > 0) conditions.districtIn = districts;
  if (draft.phoneOpenOrdersGte.trim()) {
    const n = Number(draft.phoneOpenOrdersGte);
    if (!Number.isInteger(n) || n < 0) errors.push("খোলা অর্ডারের সংখ্যা পূর্ণ সংখ্যায় লিখুন।");
    else conditions.phoneOpenOrdersGte = n;
  }
  if (draft.minRiskScore.trim()) {
    const n = Number(draft.minRiskScore);
    if (!Number.isFinite(n) || n < 0) errors.push("সর্বনিম্ন risk score সংখ্যায় লিখুন।");
    else conditions.minRiskScore = n;
  }

  if (errors.length > 0) return { payload: null, errors };
  return {
    payload: {
      name,
      action,
      ...(action === "tag" ? { tagValue } : {}),
      conditions,
    },
    errors: [],
  };
}
