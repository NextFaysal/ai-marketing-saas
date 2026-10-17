/**
 * NF13 (FB5) — Platform Fraud Network web helpers + payload
 * types. The network signal is a SIBLING of the shop's own
 * fraud score — it is never merged into it, and every label
 * here keeps that distinction explicit. A signal only exists
 * for opted-in orgs; below 3 contributing orgs the API returns
 * insufficient_data with NO counts, and the helpers mirror
 * that honesty (no number is ever invented client-side).
 */

export interface FraudNetworkSettingsView {
  available: boolean;
  enabled: boolean;
  enabledAt: string | null;
  enabledById?: string | null;
  explainerSeen?: boolean;
}

export type FraudNetworkSignal =
  | {
      status: "ok";
      delivered: number;
      returnedFailed: number;
      codRefusals: number;
      contributingOrgCount: number;
      total: number;
    }
  | { status: "insufficient_data"; contributingOrgCount: number }
  | { status: "not_opted_in" }
  | { status: "unavailable" };

/** Shown when the API says the feature is not live on the
 * server (no HMAC key configured) — the toggle stays disabled. */
export const FRAUD_NETWORK_UNAVAILABLE_BN =
  "এই সুবিধাটি সার্ভারে এখনো চালু হয়নি";

/** What is shared — stated BEFORE enabling, verbatim in the
 * card: counts only, phone as hash, nothing else. */
export const FRAUD_NETWORK_SHARED_BN =
  "শেয়ার হয় শুধু সংখ্যা — একটি নম্বরে কতটি ডেলিভারি হয়েছে, কতটি রিটার্ন/ব্যর্থ হয়েছে; ফোন নম্বরটি শুধু hash আকারে থাকে। নাম, অর্ডারের বিবরণ, মেসেজ — কিছুই শেয়ার হয় না।";

/** The honest irreversibility note — also stated BEFORE
 * enabling: past contributions already merged into the
 * aggregates cannot be removed; disabling stops only future
 * contributions. */
export const FRAUD_NETWORK_PAST_BN =
  "সত্যি কথা: একবার চালু করার পর যেসব ফলাফল সম্মিলিত হিসাবে মিশে গেছে, তা আর আলাদা করে সরানো যায় না। বন্ধ করলে শুধু ভবিষ্যতের অবদান সঙ্গে সঙ্গে থেমে যাবে।";

/** Heading for a rendered signal — always labelled as combined
 * network data with the contributing-shop count, never as the
 * shop's own score. Null when there is nothing honest to show
 * (not opted in / unavailable / missing). */
export function networkSignalHeading(
  signal: FraudNetworkSignal | null | undefined,
): string | null {
  if (!signal) return null;
  if (signal.status === "ok") {
    return `নেটওয়ার্ক তথ্য (${signal.contributingOrgCount}টি দোকানের সম্মিলিত)`;
  }
  if (signal.status === "insufficient_data") return "নেটওয়ার্ক তথ্য";
  return null;
}

/** Body line for a rendered signal. For insufficient_data the
 * counts are NEVER shown (the API does not send them) — only
 * the honest "not enough data yet" line. */
export function networkSignalBody(
  signal: FraudNetworkSignal | null | undefined,
): string | null {
  if (!signal) return null;
  if (signal.status === "ok") {
    return `ডেলিভারি: ${signal.delivered}টি · রিটার্ন/ব্যর্থ: ${signal.returnedFailed}টি · COD প্রত্যাখ্যান: ${signal.codRefusals}টি`;
  }
  if (signal.status === "insufficient_data") {
    return "নেটওয়ার্কে এখনো যথেষ্ট তথ্য নেই";
  }
  return null;
}

/** The settings toggle is disabled when the settings have not
 * loaded or the server says the feature is unavailable. */
export function fraudNetworkToggleDisabled(
  settings: FraudNetworkSettingsView | null | undefined,
): boolean {
  return !settings || settings.available !== true;
}
