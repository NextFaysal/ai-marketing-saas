/**
 * Campaign Status, Objectives, and Presentation Helpers.
 * ML6 (W-D): records carry additive `labelEn`/`descriptionEn`
 * companions (D7); the getters take `locale` (default "bn",
 * byte-identical to the original labels).
 */
import type { UiLocale } from "@repo/contracts";

export const CAMPAIGN_STATUS_META: Record<
  string,
  { label: string; labelEn: string; badgeCls: string; icon: string }
> = {
  draft: {
    label: "Draft (খসড়া)",
    labelEn: "Draft",
    badgeCls: "bg-slate-100 text-slate-700 border-slate-200",
    icon: "📝",
  },
  pending_approval: {
    label: "অনুমোদনের অপেক্ষায়",
    labelEn: "Pending approval",
    badgeCls: "bg-amber-100 text-amber-800 border-amber-300",
    icon: "⏳",
  },
  approved: {
    label: "অনুমোদিত (Publish প্রস্তুত)",
    labelEn: "Approved (ready to publish)",
    badgeCls: "bg-emerald-100 text-emerald-800 border-emerald-300",
    icon: "✓",
  },
  rejected: {
    label: "প্রত্যাখ্যাত (রিজেক্টেড)",
    labelEn: "Rejected",
    badgeCls: "bg-rose-100 text-rose-800 border-rose-300",
    icon: "✕",
  },
  publishing: {
    label: "প্রকাশ হচ্ছে (Publishing)",
    labelEn: "Publishing",
    badgeCls: "bg-purple-100 text-purple-800 border-purple-300",
    icon: "🚀",
  },
  published: {
    label: "Meta তে প্রকাশিত",
    labelEn: "Published on Meta",
    badgeCls: "bg-emerald-100 text-emerald-800 border-emerald-300",
    icon: "🌐",
  },
  publish_failed: {
    label: "প্রকাশ ব্যর্থ (Retryable)",
    labelEn: "Publish failed (retryable)",
    badgeCls: "bg-red-100 text-red-800 border-red-300",
    icon: "⚠️",
  },
};

export const CAMPAIGN_OBJECTIVES: Record<
  string,
  { label: string; labelEn: string; icon: string; description: string; descriptionEn: string }
> = {
  OUTCOME_SALES: {
    label: "বিক্রয় ও কনভার্সন (Sales)",
    labelEn: "Sales & conversions",
    icon: "🛍️",
    description: "ওয়েবসাইটে সরাসরি অর্ডার ও চেকআউট বৃদ্ধি",
    descriptionEn: "Grow direct orders and checkouts on your website",
  },
  OUTCOME_LEADS: {
    label: "লিড জেনারেশন (Leads)",
    labelEn: "Lead generation",
    icon: "👥",
    description: "গ্রাহকের যোগাযোগের তথ্য ও ইনকোয়ারি সংগ্রহ",
    descriptionEn: "Collect customer contact details and enquiries",
  },
  OUTCOME_ENGAGEMENT: {
    label: "এনগেজমেন্ট ও মেসেজ (Engagement)",
    labelEn: "Engagement & messages",
    icon: "💬",
    description: "মেসেঞ্জার, হোয়াটসঅ্যাপ ও পোস্টে সাড়া",
    descriptionEn: "Responses on Messenger, WhatsApp and posts",
  },
  OUTCOME_TRAFFIC: {
    label: "ওয়েবসাইট ট্র্যাফিক (Traffic)",
    labelEn: "Website traffic",
    icon: "🌐",
    description: "ওয়েবসাইট বা ল্যান্ডিং পেজে ভিজিটর আনা",
    descriptionEn: "Bring visitors to your website or landing page",
  },
  OUTCOME_AWARENESS: {
    label: "ব্র্যান্ড পরিচিতি (Awareness)",
    labelEn: "Brand awareness",
    icon: "📢",
    description: "সর্বোচ্চ সংখ্যক মানুষের কাছে ব্র্যান্ড পৌঁছানো",
    descriptionEn: "Reach as many people as possible with your brand",
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
      description: locale === "en" ? "Campaign objective" : "ক্যাম্পেইন অবজেক্টিভ",
    };
  }
  return locale === "en" ? { ...meta, label: meta.labelEn, description: meta.descriptionEn } : meta;
}
