import { adsBn, adsEn } from "./i18n/ads";
export interface AbVariantSummary {
  planId: string;
  name: string;
  variant: string;
  spendMinor: string;
  platformConversions: number;
  platformCpaMinor: string | null;
  firstPartyOrders: number;
  firstPartyCpaMinor: string | null;
}

export const MIN_SPEND_FOR_VERDICT_MINOR = 10000n; // ৳100 in minor units

/**
 * Judges eligibility: each compared variant must have spent at least ৳100
 * and have valid CPA calculations.
 */
export function isGroupEligibleForVerdict(
  variants: AbVariantSummary[],
  metric: "first_party_cpa" | "platform_cpa" = "first_party_cpa"
): boolean {
  if (variants.length < 2) return false;
  const key = metric === "platform_cpa" ? "platformCpaMinor" : "firstPartyCpaMinor";
  return variants.every((v) => {
    const spend = BigInt(v.spendMinor || 0);
    return spend >= MIN_SPEND_FOR_VERDICT_MINOR && v[key] !== null;
  });
}

/**
 * Determines the winner based on lowest CPA.
 */
export function findAbWinner(
  variants: AbVariantSummary[],
  metric: "first_party_cpa" | "platform_cpa" = "first_party_cpa"
): { winnerPlanId: string | null; verdict: string } {
  if (!isGroupEligibleForVerdict(variants, metric)) {
    return { winnerPlanId: null, verdict: "insufficient_data" };
  }
  const key = metric === "platform_cpa" ? "platformCpaMinor" : "firstPartyCpaMinor";
  const sorted = [...variants].sort((a, b) => {
    const cpaA = BigInt(a[key] ?? 0);
    const cpaB = BigInt(b[key] ?? 0);
    return Number(cpaA - cpaB);
  });

  return {
    winnerPlanId: sorted[0]?.planId ?? null,
    verdict: `winner_by_${metric}`,
  };
}

/**
 * Translates verdict string to a human-readable label in the active
 * locale (MB2 ML6: copy lives in the `ads` namespace; locale defaults
 * to "bn" so existing callers keep today's copy).
 */
export function getVerdictLabel(verdict: string, locale: "bn" | "en" = "bn"): { label: string; badgeCls: string } {
  const d = locale === "en" ? adsEn : adsBn;
  if (verdict === "winner_by_first_party_cpa") {
    return { label: d.abVerdictFirstParty, badgeCls: "bg-emerald-100 text-emerald-800" };
  }
  if (verdict === "winner_by_platform_cpa") {
    return { label: d.abVerdictPlatform, badgeCls: "bg-blue-100 text-blue-800" };
  }
  return { label: d.abVerdictCollecting, badgeCls: "bg-slate-100 text-slate-700" };
}
