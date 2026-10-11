/**
 * Comprehensive Catalog of Problem-Based Automation Blueprints & Presets.
 * Designed for Bangladeshi E-commerce, Agencies, and SMEs.
 * Includes both Scheduled Sync/Routine Jobs and Ad Budget/Performance Guardrail Rules.
 */

export interface ScheduledJobBlueprint {
  kind: "job";
  key: string;
  category: "store" | "ads" | "competitor" | "routine" | "billing";
  catLabel: string;
  name: string;
  problemBn: string;
  solutionBn: string;
  impactBn: string;
  type: string;
  targetKind: "org" | "integration" | "account" | "competitor";
  defaultIntervalMinutes: number;
  badge?: string;
}

export interface AdRuleBlueprint {
  kind: "rule";
  key: string;
  category: "cpa_roas" | "budget" | "fatigue" | "safety";
  catLabel: string;
  name: string;
  problemBn: string;
  solutionBn: string;
  impactBn: string;
  metric: string;
  comparator: "gt" | "lt";
  threshold: string;
  windowDays: number;
  action: "pause_campaign" | "alert" | "activate_campaign" | "scale_budget" | "pause_ad";
  actionConfig?: {
    percent?: number;
    minDailyMinor?: number;
    maxDailyMinor?: number;
  };
  badge?: string;
}

export type AutomationBlueprint = ScheduledJobBlueprint | AdRuleBlueprint;

// ============================================================================
// 1. SCHEDULED JOB BLUEPRINTS (Sync, Operations, AI & Routines)
// ============================================================================
export const SCHEDULED_JOB_BLUEPRINTS: ScheduledJobBlueprint[] = [
  // Store & E-commerce
  {
    kind: "job",
    key: "woo_orders_fast_sync",
    category: "store",
    catLabel: "🛒 ই-কমার্স স্টোর",
    name: "WooCommerce Orders রিয়েল-টাইম সিঙ্ক",
    problemBn: "ওয়েবসাইটে নতুন অর্ডার আসার পর ড্যাশবোর্ডে দেরিতে আসলে কাস্টমার ফলো-আপ ও কুরিয়ার বুকিং বিলম্বিত হয়।",
    solutionBn: "প্রতি ১৫ মিনিটে স্বয়ংক্রিয়ভাবে WooCommerce থেকে নতুন ও পরিবর্তিত অর্ডার সিস্টেমের সাথে সিঙ্ক করা।",
    impactBn: "অর্ডার প্রসেসিং সময় ৬০% কমে এবং কাস্টমারকে দ্রুত ট্র্যাকিং আপডেট পাঠানো সম্ভব হয়।",
    type: "woo_orders",
    targetKind: "integration",
    defaultIntervalMinutes: 15,
    badge: "অপরিহার্য",
  },
  {
    kind: "job",
    key: "woo_products_inventory_sync",
    category: "store",
    catLabel: "🛒 ই-কমার্স স্টোর",
    name: "WooCommerce Products ও স্টক ইনভেন্টরি সিঙ্ক",
    problemBn: "স্টোরে পণ্য স্টক আউট হয়ে গেলে এবং তা সিস্টেমে আপডেট না থাকলে আউট-অফ-স্টক পণ্যে বিজ্ঞাপন চলে টাকা নষ্ট হয়।",
    solutionBn: "প্রতি ১ ঘণ্টায় প্রোডাক্ট ক্যাটালগ ও বর্তমান স্টক লেভেল স্বয়ংক্রিয়ভাবে সিঙ্ক করা।",
    impactBn: "স্টকবিহীন পণ্যের বিজ্ঞাপনী অপচয় শূন্যের কোঠায় নামিয়ে আনে।",
    type: "woo_products",
    targetKind: "integration",
    defaultIntervalMinutes: 60,
  },
  {
    kind: "job",
    key: "shopify_orders_sync",
    category: "store",
    catLabel: "🛒 ই-কমার্স স্টোর",
    name: "Shopify Orders ও ট্রানজেকশন সিঙ্ক",
    problemBn: "Shopify স্টোরের অর্ডার ও কাস্টমার ডাটা আলাদা প্ল্যাটফর্মে থাকার ফলে একীভূত এনালাইসিস করা কঠিন হয়।",
    solutionBn: "প্রতি ২০ মিনিটে Shopify থেকে সকল নতুন অর্ডার ও সেলস স্ট্যাটাস স্বয়ংক্রিয়ভাবে আপডেট করা।",
    impactBn: "সেন্ট্রালাইজড অর্ডার ডাটাবেস তৈরি হয় এবং মেসেজিং ও কুরিয়ার অটোমেশন সচল থাকে।",
    type: "shopify_orders",
    targetKind: "integration",
    defaultIntervalMinutes: 20,
    badge: "জনপ্রিয়",
  },
  {
    kind: "job",
    key: "shopify_products_sync",
    category: "store",
    catLabel: "🛒 ই-কমার্স স্টোর",
    name: "Shopify Products ও ভেরিয়েন্ট ক্যাটালগ সিঙ্ক",
    problemBn: "নতুন প্রোডাক্ট যোগ বা দাম পরিবর্তন করার পর মার্কেটিং সিস্টেমে আপডেট না থাকা।",
    solutionBn: "প্রতি ২ ঘণ্টায় সম্পূর্ণ প্রোডাক্ট ভেরিয়েন্ট, মূল্য ও ইমেজ সিস্টেমের সাথে সুসংগত রাখা।",
    impactBn: "সবসময় নির্ভুল মূল্য ও অফার দিয়ে ক্যাম্পেইন ও মেসেজ তৈরি নিশ্চিত হয়।",
    type: "shopify_products",
    targetKind: "integration",
    defaultIntervalMinutes: 120,
  },

  // Ad Account Insights Sync
  {
    kind: "job",
    key: "meta_insights_hourly",
    category: "ads",
    catLabel: "📈 বিজ্ঞাপন ইন্সাইটস",
    name: "Meta Ads পারফরম্যান্স ও খরচ hourly সিঙ্ক",
    problemBn: "মেটা বিজ্ঞাপনের খরচ ও কনভার্সন ম্যানুয়ালি ট্র্যাক না করলে হঠাৎ বাজেট বেশি খরচ হয়ে বাজেট লস হয়।",
    solutionBn: "প্রতি ঘণ্টায় মেটা অ্যাড একাউন্টের খরচ, ইমপ্রেশন, ক্লিক ও পারচেজ ডেটা এনে এনালাইসিস ও রুলস আপডেট রাখা।",
    impactBn: "বিজ্ঞাপনের পারফরম্যান্স ও আরওএএস (ROAS) প্রতি মুহূর্তে রিয়েল-টাইমে নজরদারিতে থাকে।",
    type: "meta_insights",
    targetKind: "account",
    defaultIntervalMinutes: 60,
    badge: "হাই-ইম্প্যাক্ট",
  },
  {
    kind: "job",
    key: "google_insights_sync",
    category: "ads",
    catLabel: "📈 বিজ্ঞাপন ইন্সাইটস",
    name: "Google Ads ক্যাম্পেইন ও সার্চ ইনসাইটস সিঙ্ক",
    problemBn: "গুগল সার্চ ও শপিং ক্যাম্পেইনের কনভার্সন ডাটা আলাদা রাখলে অমনিচ্যানেল অ্যাট্রিবিউশন সম্ভব হয় না।",
    solutionBn: "প্রতি ২ ঘণ্টায় Google Ads একাউন্টের মেকানিক ও খরচ ডেটা স্বয়ংক্রিয়ভাবে সিঙ্ক করা।",
    impactBn: "গুগল ও মেটার সম্মিলিত আরওএএস সঠিকভাবে পরিমাপ করা যায়।",
    type: "google_insights",
    targetKind: "account",
    defaultIntervalMinutes: 120,
  },
  {
    kind: "job",
    key: "tiktok_insights_sync",
    category: "ads",
    catLabel: "📈 বিজ্ঞাপন ইন্সাইটস",
    name: "TikTok Ads খরচ ও ভিডিও মেট্রিক সিঙ্ক",
    problemBn: "টিকটক বিজ্ঞাপনে দ্রুত খরচ হলেও সঠিক সময়ে সিঙ্ক না থাকায় সিপিসি (CPC) স্পাইক ধরা পড়ে না।",
    solutionBn: "প্রতি ৯০ মিনিটে TikTok Ads ইনসাইটস সিঙ্ক করে পারফরম্যান্স চার্ট আপডেট রাখা।",
    impactBn: "টিকটক বিজ্ঞাপনের ভিডিও ভিউ ও কনভার্সন রেট রিয়েল-টাইমে জানা যায়।",
    type: "tiktok_insights",
    targetKind: "account",
    defaultIntervalMinutes: 90,
  },

  // Competitor Intelligence
  {
    kind: "job",
    key: "competitor_multi_sync_daily",
    category: "competitor",
    catLabel: "🕵️ প্রতিযোগী নজরদারি",
    name: "Competitor Multi-Platform Intelligence (Meta/Google/TikTok/Bing)",
    problemBn: "প্রতিযোগীরা কী ধরনের অফার, ক্রিয়েটিভ বা নতুন বিজ্ঞাপন দিচ্ছে তা না জানলে বাজারে পিছিয়ে পড়ার ঝুঁকি থাকে।",
    solutionBn: "প্রতি ২৪ ঘণ্টায় প্রতিযোগীদের Meta Ad Library, Google Ad Transparency, TikTok ও Bing থেকে সব নতুন বিজ্ঞাপন স্ক্যান করা।",
    impactBn: "প্রতিযোগীদের সেরা ক্রিয়েটিভ ও অফার সম্পর্কে সর্বদা এক ধাপ এগিয়ে থাকা সম্ভব হয়।",
    type: "competitor_multi_sync",
    targetKind: "competitor",
    defaultIntervalMinutes: 1440,
    badge: "ইন্টেলিজেন্স",
  },
  {
    kind: "job",
    key: "competitor_website_scan_weekly",
    category: "competitor",
    catLabel: "🕵️ প্রতিযোগী নজরদারি",
    name: "Competitor Website & Pricing Scan",
    problemBn: "প্রতিযোগীরা গোপনে পণ্যের দাম কমালে বা নতুন ল্যান্ডিং পেজ বানালে সময়মতো পাল্টা ব্যবস্থা নেওয়া যায় না।",
    solutionBn: "সপ্তাহে দুইবার প্রতিযোগীর মূল পেজ ও অফার স্ক্যান করে মূল্য পরিবর্তনের রিপোর্ট তৈরি করা।",
    impactBn: "মূল্য প্রতিযোগিতায় সঠিক সময়ে স্মার্ট প্রাইসিং ডিসিশন নেওয়া যায়।",
    type: "competitor_scan",
    targetKind: "competitor",
    defaultIntervalMinutes: 5040,
  },

  // Organization Operations & AI
  {
    kind: "job",
    key: "daily_briefing_morning",
    category: "routine",
    catLabel: "🤖 AI ও রুটিন",
    name: "Daily AI Briefing — সকালের সারসংক্ষেপ ও Anomaly Alert",
    problemBn: "প্রতিদিন সকালে বহু ড্যাশবোর্ডে ঢুকে গতকালের সেলস, খরচ, আরওএএস দেখা অনেক সময়সাপেক্ষ ও ক্লান্তিকর।",
    solutionBn: "প্রতিদিন সকালে স্বয়ংক্রিয়ভাবে AI ব্রিফিং তৈরি করা: গতকালের সেলস, অ্যাড পারফরম্যান্স ও কোনো অস্বাভাবিকতা থাকলে সতর্কবার্তা।",
    impactBn: "মালিক ও পরিচালকের প্রতিদিন অন্তত ৪৫ মিনিট সময় বাঁচে এবং কোনো ক্ষতি হওয়ার আগেই জানা যায়।",
    type: "daily_briefing",
    targetKind: "org",
    defaultIntervalMinutes: 1440,
    badge: "স্মার্ট AI",
  },
  {
    kind: "job",
    key: "ad_spend_watchdog_30m",
    category: "routine",
    catLabel: "🤖 AI ও রুটিন",
    name: "Ad Spend Watchdog — অস্বাভাবিক খরচের প্রহরী",
    problemBn: "কখনও মেটা বা গুগলে বাজেট বাগ বা হ্যাকের কারণে কয়েক ঘণ্টায় সব বাজেট অপচয় হয়ে যাওয়ার ঝুঁকি থাকে।",
    solutionBn: "প্রতি ৩০ মিনিটে অ্যাড খরচ পর্যবেক্ষণ করে অস্বাভাবিক স্পাইক দেখলে তাৎক্ষণিক Alert জারি করা।",
    impactBn: "বিজ্ঞাপনী বাজেটের অনিচ্ছাকৃত বা অনিয়ন্ত্রিত অপচয় ১০০% রোধ করে।",
    type: "ad_spend_watchdog",
    targetKind: "org",
    defaultIntervalMinutes: 30,
    badge: "বাজেট গার্ড",
  },
  {
    kind: "job",
    key: "inbox_assignment_sweep_15m",
    category: "routine",
    catLabel: "🤖 AI ও রুটিন",
    name: "Inbox Assignment Sweep — কাস্টমার মেসেজ পুনঃবণ্টন",
    problemBn: "কোনো সাপোর্ট এজেন্ট ছুটিতে বা অফলাইনে থাকলে গ্রাহকের ইনবক্স মেসেজ পড়ে থাকে এবং রেসপন্স টাইম নষ্ট হয়।",
    solutionBn: "প্রতি ১৫ মিনিটে আন-অ্যাসাইনড এবং অফলাইন এজেন্টের ইনবক্স চ্যাট সক্রিয় এজেন্টদের মধ্যে সমানভাবে বণ্টন করা।",
    impactBn: "মেসেজ রেসপন্স টাইম ৩ মিনিটে নেমে আসে এবং কাস্টমার সন্তুষ্টি বৃদ্ধি পায়।",
    type: "inbox_assignment_sweep",
    targetKind: "org",
    defaultIntervalMinutes: 15,
  },
  {
    kind: "job",
    key: "lead_followup_sweep_daily",
    category: "routine",
    catLabel: "🤖 AI ও রুটিন",
    name: "Lead Follow-up Sweep — বকেয়া ও আজকের ফলো-আপ এলার্ট",
    problemBn: "সেলস টিম গ্রাহকদের সাথে কথা বলার পর নির্দিষ্ট তারিখে ফলো-আপ করতে ভুলে যায়, ফলে সম্ভাব্য সেলস হাতছাড়া হয়।",
    solutionBn: "প্রতিদিন সকাল ৯টায় আজকের ও পূর্বের জমে থাকা (Overdue) ফলো-আপগুলোর তালিকা সংশ্লিষ্ট সেলস এজেন্টের কাছে পুশ করা।",
    impactBn: "লিড ক্লোজিং রেট ৩৫% বৃদ্ধি পায় এবং কোনো সম্ভাব্য ক্রেতা মিস হয় না।",
    type: "lead_followup_sweep",
    targetKind: "org",
    defaultIntervalMinutes: 1440,
  },
  {
    kind: "job",
    key: "social_publish_due_5m",
    category: "routine",
    catLabel: "🤖 AI ও রুটিন",
    name: "Social Post Auto-Publish — সময়মতো সোশ্যাল পোস্ট প্রকাশ",
    problemBn: "শিডিউল করা ফেসবুক বা ইনস্টাগ্রাম পোস্ট সময়মতো স্বয়ংক্রিয়ভাবে পাবলিশ না হলে এঙ্গেজমেন্ট পিক আওয়ার মিস হয়।",
    solutionBn: "প্রতি ৫ মিনিটে কিউ চেক করে সঠিক সময়ে স্বয়ংক্রিয়ভাবে নির্ধারিত প্ল্যাটফর্মে পোস্ট প্রকাশ করা।",
    impactBn: "সোশ্যাল মিডিয়া শিডিউলিং ১০০% স্বয়ংক্রিয় ও নিখুঁত থাকে।",
    type: "social_publish_due",
    targetKind: "org",
    defaultIntervalMinutes: 5,
  },

  // Billing & Subscriptions
  {
    kind: "job",
    key: "billing_reminders_daily",
    category: "billing",
    catLabel: "💳 বিলিং ও সাবস্ক্রিপশন",
    name: "Billing Reminders — মেয়াদ শেষের আগাম সতর্কতা",
    problemBn: "গ্রাহক বা প্রতিষ্ঠানের সাবস্ক্রিপশন হঠাৎ বন্ধ হয়ে সার্ভিস বিঘ্নিত হওয়ার ঝুঁকি।",
    solutionBn: "প্রতিদিন মেয়াদোত্তীর্ণ হওয়ার ৩ দিন আগে ও শেষ দিনে স্বয়ংক্রিয় নোটিফিকেশন পাঠানো।",
    impactBn: "সার্ভিস ডাউনটাইম বন্ধ করে এবং অন-টাইম রিনিউয়াল বৃদ্ধি করে।",
    type: "billing_reminders",
    targetKind: "org",
    defaultIntervalMinutes: 1440,
  },
  {
    kind: "job",
    key: "auto_renew_bKash_daily",
    category: "billing",
    catLabel: "💳 বিলিং ও সাবস্ক্রিপশন",
    name: "Auto-Renew Charge (bKash Agreement)",
    problemBn: "ম্যানুয়ালি প্রতি মাসে পেমেন্ট করতে গিয়ে পেমেন্ট ফেইল হওয়া।",
    solutionBn: "মেয়াদ শেষ হওয়ার ২৪ ঘণ্টা আগে bKash এগ্রিমেন্ট থেকে রিনিউয়াল চার্জ স্বয়ংক্রিয়ভাবে সম্পন্ন করা।",
    impactBn: "নিরবচ্ছিন্ন সার্ভিস চালু থাকে।",
    type: "auto_renew",
    targetKind: "org",
    defaultIntervalMinutes: 1440,
  },
];

// ============================================================================
// 2. AD PERFORMANCE & BUDGET GUARDRAIL RULES
// ============================================================================
export const AD_RULE_BLUEPRINTS: AdRuleBlueprint[] = [
  {
    kind: "rule",
    key: "cpa_hard_stop",
    category: "cpa_roas",
    catLabel: "🛡️ CPA ও ROAS গার্ড",
    name: "উচ্চ CPA ইমার্জেন্সি স্টপ — ক্যাম্পেইন পজ করুন",
    problemBn: "বিজ্ঞাপনের কনভার্সন খরচ (CPA) অতিরিক্ত বেড়ে গেলে পুরো লাভ নষ্ট হয়ে যায় এবং ব্যবসায়ী বড় লোকসানে পড়ে।",
    solutionBn: "বিগত ৩ দিনের গড় Platform CPA ৳৩৫০ এর বেশি হলে স্বয়ংক্রিয়ভাবে ক্যাম্পেইন Pause করা।",
    impactBn: "বাজেট নষ্ট হওয়া থেকে রক্ষা করে এবং ক্ষতির পরিমাণ সর্বোচ্চ সীমার মধ্যে আটকে রাখে।",
    metric: "platform_cpa",
    comparator: "gt",
    threshold: "350",
    windowDays: 3,
    action: "pause_campaign",
    badge: "জরুরি",
  },
  {
    kind: "rule",
    key: "cpa_warning_alert",
    category: "cpa_roas",
    catLabel: "🛡️ CPA ও ROAS গার্ড",
    name: "CPA সীমার কাছাকাছি পৌঁছালে সতর্কতা এলার্ট",
    problemBn: "হঠাৎ বিজ্ঞাপন খরচ বেড়ে যাওয়ার প্রাথমিক লক্ষণ টের না পাওয়া।",
    solutionBn: "Platform CPA ৳২৫০ ছাড়ালেই বিজ্ঞাপনী টিমকে Alert পাঠানো যাতে ক্যাম্পেইন বন্ধ না করে দ্রুত ক্রিয়েটিভ বা অডিয়েন্স বদলানো যায়।",
    impactBn: "বিজ্ঞাপন বন্ধ না করেই সময়মতো অপ্টিমাইজ করার সুযোগ দেয়।",
    metric: "platform_cpa",
    comparator: "gt",
    threshold: "250",
    windowDays: 2,
    action: "alert",
  },
  {
    kind: "rule",
    key: "high_roas_scale_budget",
    category: "budget",
    catLabel: "📈 বাজেট স্কেলার",
    name: "হাই ROAS ক্যাম্পেইনে ২০% বাজেট বৃদ্ধি (Auto-Scale)",
    problemBn: "বিজ্ঞাপন অসাধারণ পারফর্ম (ROAS > ৪.০) করলেও ম্যানুয়ালি বাজেট না বাড়ানোয় বিক্রয়ের সুবর্ণ সুযোগ নষ্ট হয়।",
    solutionBn: "গত ৫ দিনে Platform ROAS ৪.০ এর বেশি থাকলে স্বয়ংক্রিয়ভাবে দৈনিক বাজেট ২০% বৃদ্ধি করা (২৪ ঘণ্টা কুলডাউনসহ)।",
    impactBn: "লাভজনক ক্যাম্পেইনের সেলস দ্বিগুণ হয় কোনো লোকসানের ঝুঁকি ছাড়াই।",
    metric: "platform_roas",
    comparator: "gt",
    threshold: "4.0",
    windowDays: 5,
    action: "scale_budget",
    actionConfig: {
      percent: 20,
      minDailyMinor: 50000,
      maxDailyMinor: 500000,
    },
    badge: "স্কেলার",
  },
  {
    kind: "rule",
    key: "low_roas_pause",
    category: "cpa_roas",
    catLabel: "🛡️ CPA ও ROAS গার্ড",
    name: "অলাভজনক ক্যাম্পেইন পজ (ROAS < ২.০)",
    problemBn: "যে বিজ্ঞাপনে খরচের তুলনায় সেলস অর্ধেকও আসে না, সেটি চলতে থাকলে প্রতিদিন নগদ টাকা অপচয় হয়।",
    solutionBn: "গত ৭ দিনে Platform ROAS ২.০ এর নিচে নামলে স্বয়ংক্রিয়ভাবে ক্যাম্পেইন Pause করা।",
    impactBn: "অলাভজনক বিজ্ঞাপনের স্পেন্ড বন্ধ করে ব্যবসা লাভজনক রাখা সম্ভব হয়।",
    metric: "platform_roas",
    comparator: "lt",
    threshold: "2.0",
    windowDays: 7,
    action: "pause_campaign",
    badge: "লোকসান রোধ",
  },
  {
    kind: "rule",
    key: "zero_conversion_bleed_stopper",
    category: "safety",
    catLabel: "🛑 স্পেন্ড সুরক্ষা",
    name: "কনভার্সন ছাড়া ৳১,০০০+ খরচ হলে ক্যাম্পেইন পজ",
    problemBn: "বিজ্ঞাপনে কোনো একটি অর্ডার বা লিড ছাড়াই ১,০০০-২,০০০ টাকা খরচ হয়ে যাওয়ার সমস্যা।",
    solutionBn: "গত ২ দিনে ১টি কনভার্সনও না পেয়ে খরচ ১,০০০ টাকার বেশি হলে সাথে সাথে ক্যাম্পেইন থামানো।",
    impactBn: "শূন্য কনভার্সনযুক্ত ভুল ক্যাম্পেইনের রক্তক্ষরণ বন্ধ করে।",
    metric: "spend_no_conversions",
    comparator: "gt",
    threshold: "1000",
    windowDays: 2,
    action: "pause_campaign",
    badge: "বাজেট রক্ষক",
  },
  {
    kind: "rule",
    key: "ad_frequency_fatigue_pause",
    category: "fatigue",
    catLabel: "👁️ ফ্যাটিগ ও কোয়ালিটি",
    name: "অডিয়েন্স ফ্যাটিগ (Frequency > ৪.০) হলে বিজ্ঞাপন পজ",
    problemBn: "একই মানুষকে একই বিজ্ঞাপন বারবার দেখালে কাস্টমার বিরক্ত হয়, ক্লিক রেট কমে যায় এবং প্রতি ক্লিকে খরচ বাড়ে।",
    solutionBn: "কোনো বিজ্ঞাপনের ফ্রিকোয়েন্সি ৪.০ অতিক্রম করলে শুধু সেই নির্দিষ্ট Ad টি Pause করা।",
    impactBn: "অডিয়েন্সের বিরক্তি রোধ করে এবং ফ্রেশ ক্রিয়েটিভ দিয়ে ক্যাম্পেইন চালু রাখে।",
    metric: "ad_frequency",
    comparator: "gt",
    threshold: "4.0",
    windowDays: 3,
    action: "pause_ad",
    badge: "ক্রিয়েটিভ সুরক্ষা",
  },
  {
    kind: "rule",
    key: "low_ctr_warning_alert",
    category: "fatigue",
    catLabel: "👁️ ফ্যাটিগ ও কোয়ালিটি",
    name: "দুর্বল CTR (< ০.৮%) এলার্ট — ক্রিয়েটিভ পরিবর্তনের তাগাদা",
    problemBn: "বিজ্ঞাপনের ডিজাইন বা হুক দুর্বল হলে CTR কমে যায় এবং মেটা বিজ্ঞাপনের রিচ কমিয়ে খরচ বাড়িয়ে দেয়।",
    solutionBn: "গত ৩ দিনে Ad CTR ০.৮% এর নিচে নামলে টিমকে ক্রিয়েটিভ ও হেডলাইন পরিবর্তনের এলার্ট পাঠানো।",
    impactBn: "বিজ্ঞাপনের মান ও ক্লিক রেট সর্বদা শীর্ষ পর্যায়ে বজায় থাকে।",
    metric: "ad_ctr_percent",
    comparator: "lt",
    threshold: "0.8",
    windowDays: 3,
    action: "alert",
  },
  {
    kind: "rule",
    key: "monthly_budget_cap_alert",
    category: "safety",
    catLabel: "🛑 স্পেন্ড সুরক্ষা",
    name: "মাসের নির্ধারিত মোট বাজেট (৳৫০,০০০) অতিক্রান্ত এলার্ট",
    problemBn: "মাসের মাঝামাঝি বাজেটের বেশি খরচ হয়ে গিয়ে মাস শেষে বাজেট সংকটে পড়া।",
    solutionBn: "চলতি মাসের মোট খরচ ৳৫০,০০০ ছাড়ালে তাত্ক্ষণিক উচ্চ-অগ্রাধিকার এলার্ট তৈরি করা।",
    impactBn: "মাসের সামগ্রিক মার্কেটিং ক্যাশফ্লো নিয়ন্ত্রণে থাকে।",
    metric: "month_spend",
    comparator: "gt",
    threshold: "50000",
    windowDays: 30,
    action: "alert",
  },
  {
    kind: "rule",
    key: "first_party_roas_guard",
    category: "cpa_roas",
    catLabel: "🛡️ CPA ও ROAS গার্ড",
    name: "ফার্স্ট-পার্টি বাস্তব ROAS গার্ড (< ২.২ হলে পজ)",
    problemBn: "মেটা কখনও কখনও ভুয়া বা ওভার-রিপোর্টেড কনভার্সন দেখায়, বাস্তবে ব্যাংকে সেই টাকা জমা হয় না।",
    solutionBn: "আমাদের নিজস্ব ফার্স্ট-পার্টি অ্যাট্রিবিউশন ROAS ২.২ এর কম হলে ক্যাম্পেইন Pause করা।",
    impactBn: "শুধুমাত্র বাস্তব বিক্রয় ও আয়ের ভিত্তিতে ক্যাম্পেইন পরিচালিত হয়।",
    metric: "first_party_roas",
    comparator: "lt",
    threshold: "2.2",
    windowDays: 7,
    action: "pause_campaign",
    badge: "বাস্তব ট্র্যাকিং",
  },
  {
    kind: "rule",
    key: "first_party_cpa_alert",
    category: "cpa_roas",
    catLabel: "🛡️ CPA ও ROAS গার্ড",
    name: "ফার্স্ট-পার্টি বাস্তব CPA সতর্কতা (> ৳৩০০)",
    problemBn: "পণ্য বিক্রয়ের প্রকৃত ডেলিভারি কস্ট সহ প্রতি অর্ডারের কস্ট ৩০০ টাকার বেশি হলে লাভ কমে যাওয়া।",
    solutionBn: "আমাদের বাস্তব ট্র্যাকার অনুযায়ী প্রতি অর্ডারের খরচ ৩০০ টাকা ছাড়ালে Alert পাঠানো।",
    impactBn: "প্রকৃত মুনাফার উপর শতভাগ নিয়ন্ত্রণ থাকে।",
    metric: "first_party_cpa",
    comparator: "gt",
    threshold: "300",
    windowDays: 5,
    action: "alert",
  },
  {
    kind: "rule",
    key: "cpm_spike_alert",
    category: "fatigue",
    catLabel: "👁️ ফ্যাটিগ ও কোয়ালিটি",
    name: "অস্বাভাবিক CPM স্পাইক (> ৳৩০০) এলার্ট",
    problemBn: "কোনো কোনো দিন বা অডিয়েন্সে প্রতি ১,০০০ ইমপ্রেশনের খরচ দ্বিগুণ হয়ে বাজেট অপচয় হওয়া।",
    solutionBn: "বিগত ৩ দিনে CPM ৩০০ টাকার বেশি হলে তাৎক্ষণিক এলার্ট পাঠানো।",
    impactBn: "কম্পিটিটিভ বিডিং স্পাইক থেকে বাজেট নিরাপদ রাখা যায়।",
    metric: "cpm",
    comparator: "gt",
    threshold: "300",
    windowDays: 3,
    action: "alert",
  },
];

export const ALL_AUTOMATION_BLUEPRINTS: AutomationBlueprint[] = [
  ...SCHEDULED_JOB_BLUEPRINTS,
  ...AD_RULE_BLUEPRINTS,
];
