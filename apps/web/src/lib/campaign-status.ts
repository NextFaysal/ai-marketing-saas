/**
 * Campaign Status, Objectives, and Presentation Helpers.
 * ML6 (W-D): records carry additive `labelEn`/`descriptionEn`
 * companions (D7); the getters take `locale` (default "bn",
 * byte-identical to the original labels).
 * F3-γ: every label/description is now sourced from the
 * `analytics` i18n namespace (`zzCampStatus*` / `zzCampObj*`
 * keys); the record shape and bn bytes are unchanged.
 */
import type { UiLocale } from "@repo/contracts";
import { analyticsBn, analyticsEn } from "./i18n/analytics";

export const CAMPAIGN_STATUS_META: Record<
  string,
  { label: string; labelEn: string; badgeCls: string; icon: string }
> = {
  draft: {
    label: analyticsBn.zzCampStatusDraft,
    labelEn: analyticsEn.zzCampStatusDraft,
    badgeCls: "bg-slate-100 text-slate-700 border-slate-200",
    icon: "📝",
  },
  pending_approval: {
    label: analyticsBn.zzCampStatusPendingApproval,
    labelEn: analyticsEn.zzCampStatusPendingApproval,
    badgeCls: "bg-amber-100 text-amber-800 border-amber-300",
    icon: "⏳",
  },
  approved: {
    label: analyticsBn.zzCampStatusApproved,
    labelEn: analyticsEn.zzCampStatusApproved,
    badgeCls: "bg-emerald-100 text-emerald-800 border-emerald-300",
    icon: "✓",
  },
  rejected: {
    label: analyticsBn.zzCampStatusRejected,
    labelEn: analyticsEn.zzCampStatusRejected,
    badgeCls: "bg-rose-100 text-rose-800 border-rose-300",
    icon: "✕",
  },
  publishing: {
    label: analyticsBn.zzCampStatusPublishing,
    labelEn: analyticsEn.zzCampStatusPublishing,
    badgeCls: "bg-purple-100 text-purple-800 border-purple-300",
    icon: "🚀",
  },
  published: {
    label: analyticsBn.zzCampStatusPublished,
    labelEn: analyticsEn.zzCampStatusPublished,
    badgeCls: "bg-emerald-100 text-emerald-800 border-emerald-300",
    icon: "🌐",
  },
  publish_failed: {
    label: analyticsBn.zzCampStatusPublishFailed,
    labelEn: analyticsEn.zzCampStatusPublishFailed,
    badgeCls: "bg-red-100 text-red-800 border-red-300",
    icon: "⚠️",
  },
};

export const CAMPAIGN_OBJECTIVES: Record<
  string,
  { label: string; labelEn: string; icon: string; description: string; descriptionEn: string }
> = {
  OUTCOME_SALES: {
    label: analyticsBn.zzCampObjSales,
    labelEn: analyticsEn.zzCampObjSales,
    icon: "🛍️",
    description: analyticsBn.zzCampObjSalesDesc,
    descriptionEn: analyticsEn.zzCampObjSalesDesc,
  },
  OUTCOME_LEADS: {
    label: analyticsBn.zzCampObjLeads,
    labelEn: analyticsEn.zzCampObjLeads,
    icon: "👥",
    description: analyticsBn.zzCampObjLeadsDesc,
    descriptionEn: analyticsEn.zzCampObjLeadsDesc,
  },
  OUTCOME_ENGAGEMENT: {
    label: analyticsBn.zzCampObjEngagement,
    labelEn: analyticsEn.zzCampObjEngagement,
    icon: "💬",
    description: analyticsBn.zzCampObjEngagementDesc,
    descriptionEn: analyticsEn.zzCampObjEngagementDesc,
  },
  OUTCOME_TRAFFIC: {
    label: analyticsBn.zzCampObjTraffic,
    labelEn: analyticsEn.zzCampObjTraffic,
    icon: "🌐",
    description: analyticsBn.zzCampObjTrafficDesc,
    descriptionEn: analyticsEn.zzCampObjTrafficDesc,
  },
  OUTCOME_AWARENESS: {
    label: analyticsBn.zzCampObjAwareness,
    labelEn: analyticsEn.zzCampObjAwareness,
    icon: "📢",
    description: analyticsBn.zzCampObjAwarenessDesc,
    descriptionEn: analyticsEn.zzCampObjAwarenessDesc,
  },
};

export function getCampaignStatusBadge(status: string, locale: UiLocale = "bn") {
  const meta = CAMPAIGN_STATUS_META[status];
  if (!meta) {
    return {
      label: status,
      badgeCls: "bg-slate-100 text-slate-600 border-slate-200",
      icon: "•",
    };
  }
  return locale === "en" ? { ...meta, label: meta.labelEn } : meta;
}

export function getCampaignObjectiveMeta(objective: string, locale: UiLocale = "bn") {
  const meta = CAMPAIGN_OBJECTIVES[objective];
  if (!meta) {
    return {
      label: objective,
      icon: "🎯",
      description: locale === "en" ? analyticsEn.zzCampObjFallbackDesc : analyticsBn.zzCampObjFallbackDesc,
    };
  }
  return locale === "en" ? { ...meta, label: meta.labelEn, description: meta.descriptionEn } : meta;
}
