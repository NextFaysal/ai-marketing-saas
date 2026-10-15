/**
 * Campaign Status, Objectives, and Presentation Helpers.
 */

export const CAMPAIGN_STATUS_META: Record<
  string,
  { label: string; badgeCls: string; icon: string }
> = {
  draft: {
    label: "Draft (খসড়া)",
    badgeCls: "bg-slate-100 text-slate-700 border-slate-200",
    icon: "📝",
  },
  pending_approval: {
    label: "অনুমোদনের অপেক্ষায়",
    badgeCls: "bg-amber-100 text-amber-800 border-amber-300",
    icon: "⏳",
  },
  approved: {
    label: "অনুমোদিত (Publish প্রস্তুত)",
    badgeCls: "bg-emerald-100 text-emerald-800 border-emerald-300",
    icon: "✓",
  },
  rejected: {
    label: "প্রত্যাখ্যাত (রিজেক্টেড)",
    badgeCls: "bg-rose-100 text-rose-800 border-rose-300",
    icon: "✕",
  },
  publishing: {
    label: "প্রকাশ হচ্ছে (Publishing)",
    badgeCls: "bg-purple-100 text-purple-800 border-purple-300",
    icon: "🚀",
  },
  published: {
    label: "Meta তে প্রকাশিত",
    badgeCls: "bg-emerald-100 text-emerald-800 border-emerald-300",
    icon: "🌐",
  },
  publish_failed: {
    label: "প্রকাশ ব্যর্থ (Retryable)",
    badgeCls: "bg-red-100 text-red-800 border-red-300",
    icon: "⚠️",
  },
};

export const CAMPAIGN_OBJECTIVES: Record<
  string,
  { label: string; icon: string; description: string }
> = {
  OUTCOME_SALES: {
    label: "বিক্রয় ও কনভার্সন (Sales)",
    icon: "🛍️",
    description: "ওয়েবসাইটে সরাসরি অর্ডার ও চেকআউট বৃদ্ধি",
  },
  OUTCOME_LEADS: {
    label: "লিড জেনারেশন (Leads)",
    icon: "👥",
    description: "গ্রাহকের যোগাযোগের তথ্য ও ইনকোয়ারি সংগ্রহ",
  },
  OUTCOME_ENGAGEMENT: {
    label: "এনগেজমেন্ট ও মেসেজ (Engagement)",
    icon: "💬",
    description: "মেসেঞ্জার, হোয়াটসঅ্যাপ ও পোস্টে সাড়া",
  },
  OUTCOME_TRAFFIC: {
    label: "ওয়েবসাইট ট্র্যাফিক (Traffic)",
    icon: "🌐",
    description: "ওয়েবসাইট বা ল্যান্ডিং পেজে ভিজিটর আনা",
  },
  OUTCOME_AWARENESS: {
    label: "ব্র্যান্ড পরিচিতি (Awareness)",
    icon: "📢",
    description: "সর্বোচ্চ সংখ্যক মানুষের কাছে ব্র্যান্ড পৌঁছানো",
  },
};

export function getCampaignStatusBadge(status: string) {
  return (
    CAMPAIGN_STATUS_META[status] ?? {
      label: status,
      badgeCls: "bg-slate-100 text-slate-600 border-slate-200",
      icon: "•",
    }
  );
}

export function getCampaignObjectiveMeta(objective: string) {
  return (
    CAMPAIGN_OBJECTIVES[objective] ?? {
      label: objective,
      icon: "🎯",
      description: "ক্যাম্পেইন অবজেক্টিভ",
    }
  );
}
