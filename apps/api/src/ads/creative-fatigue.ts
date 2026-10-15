/**
 * Phase K creative leaderboard + fatigue computation, extracted
 * verbatim (NB4/CN7) so the Campaign Builder can surface the
 * SAME numbers per plan. The rule is the platform's one honest
 * fatigue definition and must never fork:
 *
 *   fatigued = frequency >= 3.5 AND CTR dropped >= 30% versus
 *   the previous equal-length window.
 *
 * Both inputs come from synced DailyAdMetric ad-level rows
 * (source "meta"); nothing is predicted or estimated. Callers
 * fetch the rows; this function only aggregates.
 */
export interface CreativeLeaderboardRow {
  adExternalId: string;
  adName: string;
  campaign: string;
  spendMinor: string;
  impressions: number;
  clicks: number;
  conversions: number;
  ctrPercent: number | null;
  frequency: number | null;
  cpaMinor: string | null;
  ctrDropPercent: number | null;
  fatigued: boolean;
  fatigueReasons: string[];
}

export function computeCreativeLeaderboard(rows: any[], days = 14, now = new Date()): { days: number; ads: CreativeLeaderboardRow[] } {
  const since = new Date(now.getTime() - days * 86400000);
  type Agg = { adExternalId: string; adName: string; campaign: string; spend: bigint; impressions: bigint; clicks: bigint; reach: bigint; conversions: bigint; prevClicks: bigint; prevImpressions: bigint };
  const map = new Map<string, Agg>();
  for (const r of rows as any[]) {
    if (!r.adExternalId) continue;
    const key = String(r.adExternalId);
    const a = map.get(key) ?? { adExternalId: key, adName: r.adName ?? key, campaign: r.campaignName ?? r.campaignExternalId ?? "", spend: 0n, impressions: 0n, clicks: 0n, reach: 0n, conversions: 0n, prevClicks: 0n, prevImpressions: 0n };
    const rowDate = new Date(r.date);
    if (rowDate >= since) {
      a.spend += BigInt(r.spendMinor ?? 0); a.impressions += BigInt(r.impressions ?? 0);
      a.clicks += BigInt(r.clicks ?? 0); a.reach += BigInt(r.reach ?? 0); a.conversions += BigInt(r.conversions ?? 0);
    } else {
      a.prevClicks += BigInt(r.clicks ?? 0); a.prevImpressions += BigInt(r.impressions ?? 0);
    }
    map.set(key, a);
  }
  const list = [...map.values()].map((a) => {
    const ctr = a.impressions > 0n ? Number(a.clicks) / Number(a.impressions) * 100 : null;
    const prevCtr = a.prevImpressions > 0n ? Number(a.prevClicks) / Number(a.prevImpressions) * 100 : null;
    const frequency = a.reach > 0n ? Number(a.impressions) / Number(a.reach) : null;
    const ctrDropPercent = ctr !== null && prevCtr !== null && prevCtr > 0 ? (prevCtr - ctr) / prevCtr * 100 : null;
    const reasons: string[] = [];
    if (frequency !== null && frequency >= 3.5) reasons.push("frequency_high");
    if (ctrDropPercent !== null && ctrDropPercent >= 30) reasons.push("ctr_declining");
    return {
      adExternalId: a.adExternalId, adName: a.adName, campaign: a.campaign,
      spendMinor: a.spend.toString(), impressions: Number(a.impressions), clicks: Number(a.clicks),
      conversions: Number(a.conversions),
      ctrPercent: ctr !== null ? Math.round(ctr * 100) / 100 : null,
      frequency: frequency !== null ? Math.round(frequency * 100) / 100 : null,
      cpaMinor: a.conversions > 0n ? (a.spend / a.conversions).toString() : null,
      ctrDropPercent: ctrDropPercent !== null ? Math.round(ctrDropPercent) : null,
      fatigued: reasons.length === 2, fatigueReasons: reasons,
    };
  }).filter((x) => x.impressions > 0 || x.spendMinor !== "0");
  list.sort((x, y) => Number(BigInt(y.spendMinor) - BigInt(x.spendMinor)));
  return { days, ads: list.slice(0, 50) };
}
