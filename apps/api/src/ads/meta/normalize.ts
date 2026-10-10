import { parseMoneyToMinor } from "@repo/contracts";

// Meta reports conversions inside `actions` arrays. Different accounts use
// different action types; we take the first of these, in order, so a total
// is never double-counted by summing several overlapping types.
const CONVERSION_ACTION_PRIORITY = ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"];

export function extractConversions(actions: any[] | undefined): number {
  if (!Array.isArray(actions)) return 0;
  for (const type of CONVERSION_ACTION_PRIORITY) {
    const found = actions.find((a) => a.action_type === type);
    if (found) return Math.max(0, Math.floor(Number(found.value ?? 0)));
  }
  return 0;
}

export function extractConversionValue(actionValues: any[] | undefined): bigint {
  if (!Array.isArray(actionValues)) return 0n;
  for (const type of CONVERSION_ACTION_PRIORITY) {
    const found = actionValues.find((a) => a.action_type === type);
    if (found) {
      try { return parseMoneyToMinor(String(found.value ?? "0")); } catch { return 0n; }
    }
  }
  return 0n;
}

export interface NormalizedInsight {
  reach?: number;
  date: string; // YYYY-MM-DD
  campaignExternalId: string;
  campaignName?: string;
  spendMinor: bigint;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValueMinor: bigint;
}

export function normalizeMetaInsight(row: any): NormalizedInsight {
  return {
    date: String(row.date_start),
    campaignExternalId: String(row.campaign_id ?? ""),
    campaignName: row.campaign_name || undefined,
    spendMinor: row.spend ? parseMoneyToMinor(String(row.spend)) : 0n,
    impressions: Math.max(0, Math.floor(Number(row.impressions ?? 0))),
    clicks: Math.max(0, Math.floor(Number(row.clicks ?? 0))),
    conversions: extractConversions(row.actions),
    conversionValueMinor: extractConversionValue(row.action_values),
    reach: Math.max(0, Math.floor(Number(row.reach ?? 0))),
  };
}

export interface NormalizedAdInsight extends NormalizedInsight {
  adSetExternalId: string; adSetName?: string;
  adExternalId: string; adName?: string;
  reach: number; videoViews: number;
}

export function extractVideoViews(actions: any): number {
  if (!Array.isArray(actions)) return 0;
  const hit = actions.find((a: any) => a?.action_type === "video_view");
  return hit ? Math.max(0, Math.floor(Number(hit.value ?? 0))) : 0;
}

export function normalizeMetaAdInsight(row: any): NormalizedAdInsight {
  return {
    ...normalizeMetaInsight(row),
    adSetExternalId: String(row.adset_id ?? ""),
    adSetName: row.adset_name || undefined,
    adExternalId: String(row.ad_id ?? ""),
    adName: row.ad_name || undefined,
    reach: Math.max(0, Math.floor(Number(row.reach ?? 0))),
    videoViews: extractVideoViews(row.actions),
  };
}
