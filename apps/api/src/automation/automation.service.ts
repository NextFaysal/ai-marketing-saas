import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from "@nestjs/common";
import { leaderClaim } from "../common/leader-claim";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { ShopifyService } from "../integrations/shopify/shopify.service";
import { AdsService } from "../ads/ads.service";
import { ReportsService } from "../ai/reports.service";
import { CompetitorsService } from "../competitors/competitors.service";
import { CampaignsService } from "../campaigns/campaigns.service";
import { EmailProvider } from "../messaging/email.provider";
import { MessagingService } from "../messaging/messaging.service";
import { AudiencesService } from "../audiences/audiences.service";
import { InboxService } from "../inbox/inbox.service";
import { EmailChannelService } from "../inbox/channels/email.service";
import { ProactiveService } from "../ai/proactive.service";
import { LeadsService } from "../crm/leads.service";
import { PaymentsService } from "../payments/payments.service";
import { SocialPublishService } from "../social/social-publish.service";
import { SocialCommentsService } from "../inbox/social-comments.service";
import { CourierService } from "../courier/courier.service";
import { ReviewsService } from "../orders/reviews.service";
import { OrderChaseService } from "../orders/order-chase.service";
import { ReportExportService } from "../reports/report-export.service";
import { dhakaDayStartUtc } from "../crm/lead-followups";
import { refreshPlatformConfig } from "../common/platform-config";
import { orgFlagEnabled } from "../common/feature-flags";
import { platformSetting, effectiveLimits } from "../common/platform-settings";
import { SyncOutboxService } from "../commerce/sync-outbox.service";
import { CatalogPushService } from "../commerce/catalog-push.service";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { RetentionService } from "../storefront/retention.service";
import { InstallmentsService } from "../installments/installments.service";

export const JOB_TYPES = [
  "woo_products", "woo_orders", "shopify_products", "shopify_orders", "woo_customers", "shopify_customers", "woo_reviews",
  "meta_insights", "google_insights", "tiktok_insights",
  "daily_report", "daily_briefing", "competitor_ads", "competitor_scan", "competitor_multi_sync", "weekly_ads_report", "monthly_report", "saved_report_delivery", "meta_status_sync", "audience_refresh", "dayparting",
  "subscription_sweep", "dunning_reminders", "billing_reminders", "audit_retention",
  "inbox_assignment_sweep", "email_sync", "inbox_retention",
  "lead_followup_sweep", "auto_renew", "ad_spend_watchdog", "social_publish_due", "broadcast_send_sweep",
  "inbox_autoreply_sweep", "comment_autoreply_sweep", "handover_timer_sweep",
  "courier_auto_sync", "review_request_sweep", "order_chase_sweep", "inbox_chase_sweep", "sync_outbox", "sale_schedule", "inbox_sla_sweep",
  // EC24c: commerce (customer) subscription renewals — distinct
  // from the SaaS billing "subscription_sweep" above.
  "commerce_subscription_sweep",
  // EC28: wishlist price-drop alerts (sweep detection — price
  // writes have no single choke point).
  "wishlist_price_alert_sweep",
  // EC31: installment due reminders (due_soon / overdue SMS,
  // exactly once per item per state).
  "installment_due_sweep",
] as const;


/**
 * Automations A4 — job template gallery (server-side catalogue,
 * mirroring WORKFLOW_PRESETS so API and web share one list).
 * Every template is grounded in a REAL executeJob case; the
 * description states only what that case actually does.
 * targetKind "org" installs with targetId = the organization id
 * (the same convention as the Automations page's org job group);
 * "integration"/"competitor" templates require the tenant to pick
 * a target at install time — a target is never fabricated.
 */
export interface JobTemplate {
  key: string;
  name: string;
  descriptionBn: string;
  type: string;
  targetKind: "org" | "integration" | "competitor";
  intervalMinutes: number;
}
export const JOB_TEMPLATES: JobTemplate[] = [
  { key: "woo_orders_sync", name: "WooCommerce Orders Sync (টেমপ্লেট)", type: "woo_orders", targetKind: "integration", intervalMinutes: 30,
    descriptionBn: "বেছে নেওয়া WooCommerce স্টোরের অর্ডারগুলো প্রতি ৩০ মিনিটে Sync হবে — নতুন অর্ডার ও স্ট্যাটাসের পরিবর্তন এখানে চলে আসবে।" },
  { key: "woo_customers_sync", name: "WooCommerce Customers Sync (টেমপ্লেট)", type: "woo_customers", targetKind: "integration", intervalMinutes: 60,
    descriptionBn: "প্রতি ৬০ মিনিটে: বেছে নেওয়া WooCommerce স্টোরের গ্রাহকদের Sync হবে — নতুন গ্রাহক ও হালনাগাদ যোগাযোগের তথ্য এখানে চলে আসবে।" },
  { key: "woo_reviews_sync", name: "WooCommerce Reviews Sync (টেমপ্লেট)", type: "woo_reviews", targetKind: "integration", intervalMinutes: 60,
    descriptionBn: "প্রতি ৬০ মিনিটে: বেছে নেওয়া WooCommerce স্টোরের পণ্যের রিভিউগুলো Sync হবে — যেসব পণ্য এখানে ম্যাপ করা আছে শুধু সেগুলোর রিভিউ আসবে; ম্যাপ না থাকা পণ্যের রিভিউ বাদ যাবে। Shopify স্টোরে রিভিউর কোনো উৎস (মেটাফিল্ড) না থাকলে ফলাফলে unsupported দেখাবে।" },
  { key: "shopify_customers_sync", name: "Shopify Customers Sync (টেমপ্লেট)", type: "shopify_customers", targetKind: "integration", intervalMinutes: 60,
    descriptionBn: "প্রতি ৬০ মিনিটে: বেছে নেওয়া Shopify স্টোরের গ্রাহকদের Sync হবে — নতুন গ্রাহক ও হালনাগাদ যোগাযোগের তথ্য এখানে চলে আসবে।" },
  { key: "daily_briefing", name: "Daily AI Briefing (টেমপ্লেট)", type: "daily_briefing", targetKind: "org", intervalMinutes: 1440,
    descriptionBn: "প্রতিদিন একবার AI ব্রিফিং তৈরি হবে — গত দিনের বিক্রি ও বিজ্ঞাপনের সারসংক্ষেপ, সঙ্গে গুরুত্বপূর্ণ অস্বাভাবিক পরিবর্তনের (Anomaly) সতর্কতা।" },
  { key: "daily_report", name: "Daily AI Report (টেমপ্লেট)", type: "daily_report", targetKind: "org", intervalMinutes: 1440,
    descriptionBn: "প্রতিদিন একবার AI Daily Report তৈরি হবে — বিক্রি ও বিজ্ঞাপনের হালনাগাদ সারসংক্ষেপ Reports অংশে পাবেন।" },
  { key: "monthly_report", name: "Monthly AI Report (টেমপ্লেট)", type: "monthly_report", targetKind: "org", intervalMinutes: 43200,
    descriptionBn: "প্রতি ৩০ দিনে একবার AI Monthly Report তৈরি হবে — পুরো মাসের বিক্রি ও বিজ্ঞাপনের সারসংক্ষেপ Reports অংশে পাবেন।" },
  { key: "subscription_sweep", name: "Subscription Sweep (টেমপ্লেট)", type: "subscription_sweep", targetKind: "org", intervalMinutes: 1440,
    descriptionBn: "প্রতিদিন একবার Subscription যাচাই হবে — মেয়াদ শেষ হলে নির্ধারিত Plan পরিবর্তন প্রয়োগ হবে বা Subscription Past Due চিহ্নিত হবে।" },
  { key: "billing_reminders", name: "Billing Reminders (টেমপ্লেট)", type: "billing_reminders", targetKind: "org", intervalMinutes: 1440,
    descriptionBn: "প্রতিদিন একবার: মেয়াদ শেষের আগাম সতর্কতা এবং অসম্পূর্ণ (Abandoned) পেমেন্টের Reminder ইমেইল পাঠানো হবে।" },
  { key: "lead_followup_sweep", name: "Lead Follow-up Sweep (টেমপ্লেট)", type: "lead_followup_sweep", targetKind: "org", intervalMinutes: 60,
    descriptionBn: "প্রতি ঘণ্টায় Lead ফলোআপ যাচাই হবে — আজকের ও Overdue ফলোআপের নোটিফিকেশন দায়িত্বপ্রাপ্ত সদস্যের কাছে যাবে (একই Lead-এর জন্য দিনে একবার)।" },
  { key: "ad_spend_watchdog", name: "Ad Spend Watchdog (টেমপ্লেট)", type: "ad_spend_watchdog", targetKind: "org", intervalMinutes: 60,
    descriptionBn: "প্রতি ঘণ্টায়: Spend Watch চালু থাকা প্রতিটি Ad Account-এর আজকের খরচ যাচাই হবে — দৈনিক ক্যাপ ছুঁলে বা গত ৭ দিনের (বা যত দিনের ইতিহাস আছে) গড়ের তুলনায় অস্বাভাবিক বেশি হলে Owner/Admin নোটিফিকেশন পাবেন (Account প্রতি দিনে একবার করে)। এটি শুধু সতর্কতা — কোনো Campaign স্বয়ংক্রিয়ভাবে বন্ধ হবে না।" },
  { key: "inbox_assignment_sweep", name: "Inbox Assignment Sweep (টেমপ্লেট)", type: "inbox_assignment_sweep", targetKind: "org", intervalMinutes: 60,
    descriptionBn: "প্রতি ঘণ্টায়: অ্যাসাইনবিহীন কথোপকথন এবং Away এজেন্টের কথোপকথন সক্রিয় এজেন্টদের মধ্যে পুনঃবণ্টন হবে।" },
  { key: "competitor_multi_sync", name: "Competitor Multi-Platform Sync (টেমপ্লেট)", type: "competitor_multi_sync", targetKind: "competitor", intervalMinutes: 1440,
    descriptionBn: "প্রতিদিন একবার: বেছে নেওয়া প্রতিদ্বন্দ্বীর সব প্ল্যাটফর্মের (Meta/Google/TikTok/Bing) বিজ্ঞাপন একসাথে Sync হবে।" },
  { key: "meta_status_sync", name: "Meta Status Sync (টেমপ্লেট)", type: "meta_status_sync", targetKind: "org", intervalMinutes: 60,
    descriptionBn: "প্রতি ঘণ্টায়: সব Published Campaign Plan-এর Meta Status Sync হবে — Meta-তে বাইরে থেকে বদলালে এখানেও তা মিলে যাবে।" },
  { key: "audience_refresh", name: "Audience Refresh (টেমপ্লেট)", type: "audience_refresh", targetKind: "org", intervalMinutes: 360,
    descriptionBn: "প্রতি ৬ ঘণ্টায়: সব Audience-এর সদস্য তালিকা হালনাগাদ ডেটা দিয়ে Refresh হবে।" },
  { key: "audit_retention", name: "Audit Retention (টেমপ্লেট)", type: "audit_retention", targetKind: "org", intervalMinutes: 10080,
    descriptionBn: "সপ্তাহে একবার: মেয়াদোত্তীর্ণ পুরনো Audit Log পরিষ্কার হবে। এটি Platform-ব্যাপী Job — কত দিনের লগ থাকবে তা Platform-এর Retention সেটিং ঠিক করে; Admin কার্যকলাপের লগ মোছা হয় না।" },
  { key: "social_publish_due", name: "Social Post Publisher (টেমপ্লেট)", type: "social_publish_due", targetKind: "org", intervalMinutes: 5,
    descriptionBn: "প্রতি ৫ মিনিটে: শিডিউল করা Social পোস্টগুলোর সময় হয়ে গেলে সেগুলো Facebook Page / Instagram-এ প্রকাশ হবে। প্রকাশ ব্যর্থ হলে ব্যবধান রেখে আবার চেষ্টা হবে (সর্বোচ্চ ৩ বার), তারপর পোস্টটি Failed হবে ও Owner/Admin নোটিফিকেশন পাবেন।" },
  { key: "inbox_autoreply_sweep", name: "Inbox Auto-Reply Sweep (টেমপ্লেট)", type: "inbox_autoreply_sweep", targetKind: "org", intervalMinutes: 1,
    descriptionBn: "প্রতি ১ মিনিটে: Inbox সেটিংসে উত্তরের আগে অপেক্ষা (AI Reply Delay) চালু থাকলে, সময় হয়ে যাওয়া অপেক্ষমাণ AI উত্তরগুলো পাঠানো হবে — পরপর আসা মেসেজ জমিয়ে একটাই উত্তর। কার্যকর বিলম্ব = সেটিংসের অপেক্ষা + সর্বোচ্চ ১ মিনিট (এই Job-এর ব্যবধান)।" },
  { key: "comment_autoreply_sweep", name: "Comment Auto-Reply Sweep (টেমপ্লেট)", type: "comment_autoreply_sweep", targetKind: "org", intervalMinutes: 1,
    descriptionBn: "প্রতি ১ মিনিটে: Comments সেটিংসের Reply Delay অনুযায়ী অপেক্ষমাণ AI কমেন্ট-উত্তরগুলো দেওয়া হবে — একই লেখকের একই পোস্টে পরপর কমেন্ট জমিয়ে একটাই উত্তর। কার্যকর বিলম্ব = Delay সেটিং + সর্বোচ্চ ১ মিনিট (এই Job-এর ব্যবধান)। স্প্যাম হাইড সঙ্গে সঙ্গেই হয়, এই Job-এর জন্য অপেক্ষা করে না।" },
  { key: "handover_timer_sweep", name: "Handover Timer Sweep (টেমপ্লেট)", type: "handover_timer_sweep", targetKind: "org", intervalMinutes: 1,
    descriptionBn: "প্রতি ১ মিনিটে: টাইমড অ্যাসাইনমেন্টের সময় শেষ হয়ে গেলে যাচাই হবে — দায়িত্বপ্রাপ্ত এজেন্ট এর মধ্যে উত্তর দিয়ে থাকলে অ্যাসাইনমেন্ট স্বাভাবিক হয়ে থাকবে, উত্তর না দিয়ে থাকলে কথোপকথনটি AI-এর কাছে ফেরত যাবে (Autopilot আবার চালু হবে)।" },
  { key: "courier_auto_sync", name: "Courier Auto-Sync (টেমপ্লেট)", type: "courier_auto_sync", targetKind: "org", intervalMinutes: 60,
    descriptionBn: "প্রতি ৬০ মিনিটে: শেষ হয়নি এমন সব শিপমেন্টের স্ট্যাটাস কুরিয়ারের কাছ থেকে একে একে যাচাই হবে (সর্বশেষ ২০০টি); স্ট্যাটাস বদলালে গ্রাহক ট্র্যাকিং কার্ড পাবেন — চ্যাটে, না থাকলে SMS, না হলে ইমেইলে। একটি শিপমেন্ট ব্যর্থ হলে বাকিগুলো থামবে না; ফলাফলে ব্যর্থগুলো গণনা থাকবে।" },
  { key: "review_request_sweep", name: "Review Request Sweep (টেমপ্লেট)", type: "review_request_sweep", targetKind: "org", intervalMinutes: 60,
    descriptionBn: "প্রতি ৬০ মিনিটে: ডেলিভারি হওয়া অর্ডারের রিভিউ জিজ্ঞাসা পাঠানো হবে — Inbox সেটিংসে Review Request চালু থাকলে এবং সেটিংসের বিলম্ব (ঘণ্টা) পার হলে। জিজ্ঞাসা যায় চ্যাটে, না থাকলে SMS, না হলে ইমেইলে (রিভিউ লিংকসহ)। যেসব অর্ডারে কোনো চ্যানেলই নেই সেগুলো pending অবস্থায় থেকে যাবে — পাঠানো হয়েছে বলে কখনো দেখানো হবে না।" },
  { key: "broadcast_send_sweep", name: "Broadcast Send Sweep (টেমপ্লেট)", type: "broadcast_send_sweep", targetKind: "org", intervalMinutes: 1,
    descriptionBn: "প্রতি ১ মিনিটে: সময় হয়ে যাওয়া শিডিউল করা Broadcast পাঠানো হবে এবং মাঝপথে আটকে যাওয়া (বাধাপড়া) Broadcast আবার চালু হবে — প্রতি রানে Broadcast প্রতি সর্বোচ্চ ২০০ জন প্রাপক। এই Job চালু না থাকলে শিডিউল করা Broadcast পাঠানো হবে না।" },
  { key: "order_chase_sweep", name: "Order Chase Sweep (টেমপ্লেট)", type: "order_chase_sweep", targetKind: "org", intervalMinutes: 60,
    descriptionBn: "প্রতি ৬০ মিনিটে: অর্ডার বটে শুরু করে মাঝপথে থেমে যাওয়া গ্রাহকদের আলতো করে মনে করিয়ে দেওয়া হবে — শুধুমাত্র Inbox সেটিংসে 'To Chase' চালু থাকলে (ডিফল্ট বন্ধ)। প্রথম অনুস্মারক সেটিংসের প্রথম বিলম্বের পর, তারপর সেটিংসের ব্যবধানে, সর্বোচ্চ সেটিংসের বার পর্যন্ত; Quiet Hours সম্মান করা হয়। গ্রাহক উত্তর দিলে, অর্ডার সম্পূর্ণ হলে, মানুষ দায়িত্ব নিলে বা গ্রাহক থামতে বললে অনুসরণ সঙ্গে সঙ্গে বন্ধ হয়।" },
  { key: "inbox_chase_sweep", name: "Incomplete Order Chase (টেমপ্লেট)", type: "inbox_chase_sweep", targetKind: "org", intervalMinutes: 15,
    descriptionBn: "প্রতি ১৫ মিনিটে: চ্যাটে অসম্পূর্ণ অর্ডার রেখে যাওয়া গ্রাহকদের ভদ্র ফলো-আপ পাঠাবে এবং আটকে থাকা বট সেশনগুলো সময়মতো পরিচালনা করবে।" },
  { key: "sync_outbox_process", name: "Store Sync Outbox (টেমপ্লেট)", type: "sync_outbox", targetKind: "org", intervalMinutes: 5,
    descriptionBn: "প্রতি ৫ মিনিটে স্টোরে পাঠানোর অপেক্ষমাণ পরিবর্তনগুলো (Sync Outbox) প্রসেস হবে; যে কাজ সংশ্লিষ্ট প্ল্যাটফর্মে এখনো সমর্থিত নয় তা failed হিসেবে verbatim কারণসহ থেকে যাবে, কখনো সফল দেখানো হবে না" },
  { key: "commerce_subscription_sweep", name: "Commerce Subscription Renewal (টেমপ্লেট)", type: "commerce_subscription_sweep", targetKind: "org", intervalMinutes: 60,
    descriptionBn: "প্রতি ৬০ মিনিটে: সময় হয়ে যাওয়া গ্রাহক সাবস্ক্রিপশনগুলোর জন্য COD নবায়ন অর্ডার তৈরি হবে (ডেলিভারি চার্জ ছাড়া)। পরপর ৫ বার ব্যর্থ হলে সাবস্ক্রিপশনটি স্বয়ংক্রিয়ভাবে বিরতি পাবে।" },
  { key: "wishlist_price_alert_sweep", name: "Wishlist Price-Drop Alerts (টেমপ্লেট)", type: "wishlist_price_alert_sweep", targetKind: "org", intervalMinutes: 60,
    descriptionBn: "প্রতি ৬০ মিনিটে: উইশলিস্টে থাকা পণ্যের দাম যোগ করার সময়ের দামের (বা সর্বশেষ জানানো দামের) চেয়ে কমে গেলে গ্রাহককে SMS-এ জানানো হবে — একই দামে একবারই, আরও কমলে আবার। দোকানের SMS সেন্ডার সেটআপ না থাকলে পাঠানো হয়েছে বলে দেখানো হবে না (failed_no_channel হিসেবে রেকর্ড থাকবে)।" },
  { key: "installment_due_sweep", name: "Installment Due Reminders (টেমপ্লেট)", type: "installment_due_sweep", targetKind: "org", intervalMinutes: 60,
    descriptionBn: "প্রতি ৬০ মিনিটে: সক্রিয় কিস্তি প্ল্যানের মেয়াদ আসন্ন (আজ থেকে ২ দিনের মধ্যে) বা পার হয়ে যাওয়া অপaid কিস্তির জন্য গ্রাহককে SMS-এ একবার করে মনে করিয়ে দেওয়া হবে — প্রতিটি কিস্তির প্রতিটি অবস্থায় ঠিক একবার। দোকানের SMS সেন্ডার সেটআপ না থাকলে পাঠানো হয়েছে বলে দেখানো হবে না (failed_no_channel হিসেবে রেকর্ড থাকবে)।" },
  { key: "sale_schedule_sweep", name: "Scheduled Sale (টেমপ্লেট)", type: "sale_schedule", targetKind: "org", intervalMinutes: 15,
    descriptionBn: "প্রতি ১৫ মিনিটে: লিস্টিংয়ে সেট করা Sale-এর সময়সীমা যাচাই হবে — শুরুর সময় হলে Sale মূল্য চালু হবে, শেষের সময় পার হলে আগের মূল্যে ফিরে যাবে এবং পরিবর্তন স্টোরে পাঠানো হবে।" },
  { key: "inbox_sla_sweep", name: "Inbox SLA Sweep (টেমপ্লেট)", type: "inbox_sla_sweep", targetKind: "org", intervalMinutes: 5,
    descriptionBn: "প্রতি ৫ মিনিটে: প্রথম উত্তরের অপেক্ষায় থাকা কথোপকথনের SLA যাচাই হবে (সীমা = Inbox সেটিংসের স্তরভিত্তিক নিয়ম: VIP → Channel অনুযায়ী → সাধারণ)। সীমার ৭৫% পেরোলে দায়িত্বপ্রাপ্ত এজেন্ট সতর্কতা পাবেন; Breach-এর পর সেটিংসের Escalation বিলম্ব পেরোলে Team Lead জরুরি সতর্কতা পাবেন (সেটিংসে বন্ধ করা যায়); Auto-Reassign সেটিংসে চালু থাকলেই কেবল কথোপকথন সবচেয়ে কম ব্যস্ত যোগ্য এজেন্টের কাছে যাবে। প্রতিটি ধাপ কথোপকথনপ্রতি একবারই হয় এবং Audit-এ লেখা থাকে।" },
];

export const RULE_METRICS = [
  "platform_cpa", "platform_roas", "spend_no_conversions",
  "frequency", "ctr_percent", "cpm", "first_party_roas", "first_party_cpa",
, "ad_frequency", "ad_ctr_percent", "month_spend"] as const;
export const RULE_ACTIONS = ["pause_campaign", "alert", "activate_campaign", "scale_budget", "pause_ad"] as const;

/** Pure threshold check, unit-tested. value/threshold in the same unit. */
export function evaluateThreshold(value: number, comparator: "gt" | "lt", threshold: number): boolean {
  return comparator === "gt" ? value > threshold : value < threshold;
}

@Injectable()
export class AutomationService implements OnModuleInit {
  private readonly logger = new Logger(AutomationService.name);
  private timer: NodeJS.Timeout | null = null;
  private lastRuleEvaluation = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly integrations: IntegrationsService,
    private readonly shopify: ShopifyService,
    private readonly ads: AdsService,
    private readonly reports: ReportsService,
    private readonly competitors: CompetitorsService,
    private readonly campaigns: CampaignsService,
    @Optional() private readonly email?: EmailProvider,
    @Optional() private readonly audiences?: AudiencesService,
    @Optional() private readonly inbox?: InboxService,
    @Optional() private readonly emailChannel?: EmailChannelService,
    @Optional() private readonly proactive?: ProactiveService,
    @Optional() private readonly leads?: LeadsService,
    @Optional() private readonly payments?: PaymentsService,
    @Optional() private readonly socialPublish?: SocialPublishService,
    @Optional() private readonly reportExports?: ReportExportService,
    // CX3: comment sweep — SocialCommentsService is exported by
    // InboxModule (already imported here for InboxService), so
    // this adds no module cycle.
    @Optional() private readonly socialComments?: SocialCommentsService,
    // CX6: courier auto-sync — CourierModule imports InboxModule
    // (already here) + MessagingModule; nothing imports
    // AutomationModule back, so this adds no cycle.
    @Optional() private readonly courier?: CourierService,
    // CX12b: review request sweep — OrdersModule is imported by
    // AutomationModule for this; ReviewsService takes the inbox
    // as a structural sender (no service-level cycle).
    @Optional() private readonly reviews?: ReviewsService,
    // CX7: order chase sweep — OrdersModule already imported
    // here (ReviewsService); the service takes the inbox as a
    // structural sender, same as ReviewsService (no cycle).
    @Optional() private readonly orderChase?: OrderChaseService,
    @Optional() private readonly outbox?: SyncOutboxService,
    // EC3/EC4: scheduled-sale boundary sweep — CommerceModule is
    // already imported by AutomationModule (SyncOutboxService),
    // and CatalogPushService is exported from it.
    @Optional() private readonly catalogPush?: CatalogPushService,
    // MS1: broadcast send sweep — MessagingModule is already
    // imported by AutomationModule (EmailProvider), so this adds
    // no module cycle.
    @Optional() private readonly messaging?: MessagingService,
    // EC24c: commerce subscription renewals — SubscriptionsModule
    // imports IntegrationsModule + AuditModule only, and nothing
    // in it imports AutomationModule, so this adds no cycle
    // (same pattern as catalogPush via CommerceModule).
    @Optional() private readonly commerceSubscriptions?: SubscriptionsService,
    // EC28: wishlist price-drop sweep — StorefrontModule is
    // imported by AutomationModule for this; its chain
    // (Integrations/Commerce/Messaging) never imports
    // AutomationModule back, so this adds no cycle.
    @Optional() private readonly retention?: RetentionService,
    // EC31: installment due reminders — InstallmentsModule
    // imports AuditModule + StorefrontModule only, and nothing
    // in it imports AutomationModule, so this adds no cycle.
    @Optional() private readonly installments?: InstallmentsService,
  ) {}

  // ---------- Milestone 57: BullMQ dispatch mode ----------
  // When REDIS_URL is set, due jobs are ENQUEUED to the
  // "scheduled-jobs" queue and executed by the dedicated worker
  // (which calls back into POST /internal/jobs/execute). The
  // BullMQ jobId is deterministic per scheduled run, so multiple
  // API replicas enqueueing the same run collapse into one job.
  // Without REDIS_URL, execution stays inline exactly as before.
  private _queue: any = null;
  private _queueFailed = false;
  queueEnabled(): boolean {
    return Boolean(process.env.REDIS_URL) && !this._queueFailed;
  }
  private async getQueue(): Promise<any> {
    if (this._queue) return this._queue;
    const { Queue } = await import("bullmq");
    const { default: Redis } = await import("ioredis");
    const connection = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: null });
    this._queue = new Queue("scheduled-jobs", { connection });
    return this._queue;
  }
  private async enqueueScheduled(job: any, runKey: string): Promise<string> {
    const queue = await this.getQueue();
    const backoffMs = Number(process.env.JOB_BACKOFF_MS ?? 30000);
    const bull = await queue.add("execute", { scheduledJobId: job.id }, {
      jobId: `sched-${job.id}-${runKey}`,
      attempts: 3,
      backoff: { type: "exponential", delay: backoffMs },
      removeOnComplete: 200,
      removeOnFail: false,
    });
    return String(bull.id);
  }

  /** Worker callback path: execute + record, but RE-THROW on
   * failure so BullMQ's retry/DLQ semantics see the failure. */
  async executeScheduledJobById(jobId: string) {
    const job = await (this.prisma as any).scheduledJob.findFirst({ where: { id: jobId } });
    if (!job) throw new NotFoundException("Scheduled job not found (deleted?)");
    const startedAt = new Date();
    try {
      const result = await this.executeJob(job);
      const summary = summarizeResult(result);
      await (this.prisma as any).automationRun.create({
        data: { organizationId: job.organizationId, kind: "schedule", refId: job.id, status: "success", detail: summary },
      }).catch(() => undefined);
      await (this.prisma as any).scheduledJob.update({
        where: { id: job.id },
        data: { lastRunAt: startedAt, lastStatus: "success", lastError: null },
      });
      return { ok: true, summary };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Job failed";
      await (this.prisma as any).automationRun.create({
        data: { organizationId: job.organizationId, kind: "schedule", refId: job.id, status: "error", detail: message },
      }).catch(() => undefined);
      await (this.prisma as any).scheduledJob.update({
        where: { id: job.id },
        data: { lastRunAt: startedAt, lastStatus: "error", lastError: message },
      }).catch(() => undefined);
      throw e;
    }
  }

  /** Worker reports an exhausted job: park it in the DLQ table.
   * Milestone 63: webhook jobs carry a label instead of a
   * ScheduledJob id (`webhook:<source>:<integrationId>`) and
   * pass their own jobType. */
  async recordDlq(input: { scheduledJobId: string; error: string; attempts: number; jobType?: string }) {
    const job = input.scheduledJobId.startsWith("webhook:")
      ? null
      : await (this.prisma as any).scheduledJob.findFirst({ where: { id: input.scheduledJobId } }).catch(() => null);
    const row = await (this.prisma as any).deadLetterJob.create({
      data: {
        organizationId: job?.organizationId ?? null,
        scheduledJobId: input.scheduledJobId,
        jobType: input.jobType ?? job?.type ?? null,
        error: String(input.error ?? "unknown error").slice(0, 2000),
        attempts: input.attempts ?? 0,
      },
    });
    await this.audit.log({
      organizationId: job?.organizationId ?? null, userId: "system", action: "automation.job_dead_lettered",
      entityType: "ScheduledJob", entityId: input.scheduledJobId,
      metadata: { error: row.error, attempts: row.attempts },
    }).catch(() => undefined);
    // Automations A3: tell the org a job died for good. Fully
    // failure-isolated — a notification problem never affects
    // job processing or the DLQ write above.
    await this.notifyDeadLettered(row, job).catch(() => undefined);
    return row;
  }

  /**
   * Automations A3 — dead-letter notification. Fires when a NEW
   * DeadLetterJob row lands for a real ScheduledJob: ACTIVE
   * OWNER/ADMIN members get an AgentNotification (type
   * "job_dead_letter"), at most once per job per Asia/Dhaka day
   * (AuditLog marker "automation.dead_letter_notified", the
   * C1/S1 dedupe discipline). Webhook dead letters carry no org
   * (organizationId null) and never notify — there is nobody
   * tenant-side to notify. Never throws.
   */
  private async notifyDeadLettered(row: any, job: any): Promise<void> {
    try {
      if (!row?.organizationId || !job) return;
      const marker = await (this.prisma as any).auditLog.findFirst({
        where: {
          organizationId: row.organizationId, action: "automation.dead_letter_notified",
          entityType: "ScheduledJob", entityId: job.id,
          createdAt: { gte: dhakaDayStartUtc(new Date()) },
        },
      }).catch(() => null);
      if (marker) return;
      const memberships = await (this.prisma as any).membership.findMany({
        where: { organizationId: row.organizationId, status: "ACTIVE" }, take: 200,
      }).catch(() => []);
      const recipients = [...new Set((memberships as any[])
        .filter((m) => ["OWNER", "ADMIN"].includes(m.role))
        .map((m) => m.userId as string))];
      if (recipients.length === 0) return;
      const errorText = String(row.error ?? "");
      const excerpt = errorText.length > 200 ? `${errorText.slice(0, 200)}…` : errorText;
      const title = `অটোমেশন ব্যর্থ হয়েছে: ${job.name}`;
      const body = `“${job.name}” (${row.jobType ?? job.type}) Jobটি সব চেষ্টা শেষে ব্যর্থ হয়েছে — মোট ${row.attempts ?? 0} বার চেষ্টা করা হয়েছিল। ত্রুটি: ${excerpt} Automations পেজের Dead Letter অংশে বিস্তারিত দেখে আবার চালাতে পারবেন।`;
      for (const userId of recipients) {
        await (this.prisma as any).agentNotification.create({
          data: { organizationId: row.organizationId, userId, type: "job_dead_letter", title, body, conversationId: null },
        }).catch(() => undefined);
      }
      await this.audit.log({
        organizationId: row.organizationId, userId: undefined, action: "automation.dead_letter_notified",
        entityType: "ScheduledJob", entityId: job.id,
        metadata: { dlqId: row.id, jobType: row.jobType ?? job.type, attempts: row.attempts ?? 0, recipients: recipients.length },
      });
    } catch (e) {
      this.logger.warn(`dead-letter notification failed for dlq ${row?.id}: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  async listDlq(take = 50) {
    const rows = await (this.prisma as any).deadLetterJob.findMany({ orderBy: { createdAt: "desc" }, take }).catch(() => []);
    return rows;
  }

  async replayDlq(dlqId: string, actorId: string) {
    const row = await (this.prisma as any).deadLetterJob.findFirst({ where: { id: dlqId } });
    if (!row) throw new NotFoundException("Dead-letter entry not found");
    if (row.replayedAt) throw new BadRequestException("This entry was already replayed");
    if (!row.scheduledJobId) throw new BadRequestException("Entry has no scheduled job to replay");
    const job = await (this.prisma as any).scheduledJob.findFirst({ where: { id: row.scheduledJobId } });
    if (!job) throw new BadRequestException("The scheduled job no longer exists");
    await (this.prisma as any).deadLetterJob.update({ where: { id: dlqId }, data: { replayedAt: new Date() } });
    await this.audit.log({
      organizationId: row.organizationId, userId: actorId, action: "automation.dlq_replayed",
      entityType: "DeadLetterJob", entityId: dlqId, metadata: { scheduledJobId: job.id },
    }).catch(() => undefined);
    if (this.queueEnabled()) {
      const bullId = await this.enqueueScheduled(job, `replay-${Date.now()}`);
      return { replayed: true, mode: "queued", bullJobId: bullId };
    }
    void this.executeScheduledJobById(job.id).catch(() => undefined);
    return { replayed: true, mode: "inline" };
  }

  // ---------- Automations A3: tenant automation health ----------

  /** Bounded excerpt of a stored dead-letter error (the row keeps
   * up to 2000 chars from the write path). The list API never
   * ships the full text: it returns at most DLQ_ERROR_EXCERPT
   * chars plus the true length, so truncation is explicit. */
  static readonly DLQ_ERROR_EXCERPT = 300;

  async listOrgDeadLetters(organizationId: string, query: { take?: unknown; skip?: unknown; openOnly?: unknown } = {}) {
    const take = Math.min(50, Math.max(1, Math.floor(Number(query.take ?? 20)) || 20));
    const skip = Math.max(0, Math.floor(Number(query.skip ?? 0)) || 0);
    const openOnly = query.openOnly === true || query.openOnly === "true" || query.openOnly === "1";
    const where: Record<string, unknown> = { organizationId, ...(openOnly ? { replayedAt: null } : {}) };
    const [total, rows] = await Promise.all([
      (this.prisma as any).deadLetterJob.count({ where }),
      (this.prisma as any).deadLetterJob.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
    ]);
    const jobIds = [...new Set((rows as any[])
      .map((r) => r.scheduledJobId as string | null)
      .filter((id): id is string => Boolean(id) && !id!.startsWith("webhook:")))];
    const jobs = jobIds.length
      ? await (this.prisma as any).scheduledJob.findMany({ where: { id: { in: jobIds }, organizationId } }).catch(() => [])
      : [];
    const names = new Map((jobs as any[]).map((j) => [j.id as string, j.name as string]));
    return {
      total,
      entries: (rows as any[]).map((r) => {
        const full = String(r.error ?? "");
        const truncated = full.length > AutomationService.DLQ_ERROR_EXCERPT;
        return {
          id: r.id,
          jobType: r.jobType ?? null,
          scheduledJobId: r.scheduledJobId ?? null,
          jobName: r.scheduledJobId ? (names.get(r.scheduledJobId) ?? null) : null,
          error: truncated ? full.slice(0, AutomationService.DLQ_ERROR_EXCERPT) : full,
          errorTruncated: truncated,
          errorLength: full.length,
          attempts: r.attempts ?? 0,
          createdAt: r.createdAt,
          replayedAt: r.replayedAt ?? null,
          open: !r.replayedAt,
        };
      }),
    };
  }

  /** Tenant-scoped replay: the row must belong to the caller's
   * org (another org's entry is a 404, never a leak), then the
   * EXISTING replayDlq mechanism does the work — mark replayedAt,
   * audit, re-enqueue (queue mode) or execute inline. */
  async replayOrgDeadLetter(organizationId: string, dlqId: string, actorId: string) {
    const row = await (this.prisma as any).deadLetterJob.findFirst({ where: { id: dlqId, organizationId } });
    if (!row) throw new NotFoundException("Dead-letter entry not found");
    return this.replayDlq(dlqId, actorId);
  }

  /**
   * Per-job health, derived ONLY from stored AutomationRun rows
   * (kind "schedule") and the job row itself:
   * - runs7d / decided7d: runs in the last 7 days; decided =
   *   success + error (skipped/triggered never count as decided).
   * - successRate7d: success7d / decided7d, null when decided7d
   *   is 0 — never a fabricated 0 or 100.
   * - consecutiveFailures: error runs counting back from the
   *   newest decided run until the first success (scan capped at
   *   the latest 100 runs of the job).
   * - band: "never_run" when no decided run exists (job row's
   *   lastStatus is the fallback witness), "failing" when the
   *   latest decided run is an error, else "ok".
   */
  async getAutomationHealth(organizationId: string) {
    const jobs = await this.listJobs(organizationId);
    const since = new Date(Date.now() - 7 * 86400000);
    const health: any[] = [];
    for (const job of jobs as any[]) {
      const base = { organizationId, kind: "schedule", refId: job.id };
      const [runs7d, success7d, error7d, recent] = await Promise.all([
        (this.prisma as any).automationRun.count({ where: { ...base, createdAt: { gte: since } } }),
        (this.prisma as any).automationRun.count({ where: { ...base, status: "success", createdAt: { gte: since } } }),
        (this.prisma as any).automationRun.count({ where: { ...base, status: "error", createdAt: { gte: since } } }),
        (this.prisma as any).automationRun.findMany({ where: base, orderBy: { createdAt: "desc" }, take: 100 }),
      ]);
      const decided7d = success7d + error7d;
      let consecutiveFailures = 0;
      let latestDecided: string | null = null;
      for (const run of recent as any[]) {
        if (run.status !== "success" && run.status !== "error") continue;
        if (latestDecided === null) latestDecided = run.status;
        if (run.status === "success") break;
        consecutiveFailures++;
      }
      const band = latestDecided !== null
        ? (latestDecided === "error" ? "failing" : "ok")
        : (job.lastStatus === "error" ? "failing" : job.lastStatus === "success" ? "ok" : "never_run");
      health.push({
        jobId: job.id, name: job.name, type: job.type, enabled: job.enabled,
        lastRunAt: job.lastRunAt ?? null, lastStatus: job.lastStatus ?? null, lastError: job.lastError ?? null,
        runs7d, decided7d,
        successRate7d: decided7d > 0 ? Math.round((success7d / decided7d) * 10000) / 10000 : null,
        consecutiveFailures, band,
      });
    }
    const [openCount, latest] = await Promise.all([
      (this.prisma as any).deadLetterJob.count({ where: { organizationId, replayedAt: null } }),
      this.listOrgDeadLetters(organizationId, { take: 20 }),
    ]);
    return { jobs: health, deadLetters: { openCount, latest: latest.entries } };
  }

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULER === "true") {
      this.logger.log("Scheduler disabled via DISABLE_SCHEDULER");
      return;
    }
    // In-process scheduler. Multi-replica safe when REDIS_URL is
    // set: job dispatch dedupes via BullMQ job ids (M57) and the
    // hourly rule evaluation is leader-claimed (M62).
    this.timer = setInterval(() => { void this.tick(); }, 60_000);
    this.timer.unref?.();
    this.logger.log("Scheduler started (60s tick)");
  }

  private async tick() {
    try {
      // Keep the dynamic platform config snapshot fresh (Milestone 33).
      await refreshPlatformConfig(this.prisma as any).catch(() => undefined);
      await this.runDueJobs();
      const evalIntervalMs = Number(process.env.RULE_EVAL_INTERVAL_MS ?? 60 * 60 * 1000);
      if (Date.now() - this.lastRuleEvaluation > evalIntervalMs) {
        this.lastRuleEvaluation = Date.now();
        // Milestone 62: with multiple API replicas every tick
        // would evaluate the same rules — exactly one instance
        // claims each round (Redis test-and-set; single-instance
        // deployments always claim locally).
        const claimed = await leaderClaim.tryClaim("rule-evaluation", Math.max(60, Math.floor(evalIntervalMs / 1000)));
        if (!claimed) {
          this.logger.log("Rule evaluation skipped: another instance holds the leader claim");
        } else {
          const orgs = await (this.prisma as any).organization.findMany({ select: { id: true }, take: 100 });
          for (const org of orgs) await this.evaluateRules(org.id, null).catch((e) => this.logger.warn(`Rule evaluation failed for ${org.id}: ${e instanceof Error ? e.message : e}`));
        }
      }
    } catch (e) {
      this.logger.warn(`Scheduler tick failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  // ---------- Scheduled jobs ----------
  async createJob(organizationId: string, actorId: string, dto: { name: string; type: string; targetId: string; intervalMinutes: number }) {
    if (!(JOB_TYPES as readonly string[]).includes(dto.type)) throw new BadRequestException("Invalid job type");
    // CX3: the minimum drops 5 -> 1 so the 1-minute reply-debounce
    // sweep templates can actually be installed through this path.
    if (!Number.isFinite(dto.intervalMinutes) || dto.intervalMinutes < 1) throw new BadRequestException("intervalMinutes must be at least 1");
    const job = await (this.prisma as any).scheduledJob.create({
      data: {
        organizationId, name: dto.name, type: dto.type, targetId: dto.targetId,
        intervalMinutes: Math.floor(dto.intervalMinutes), enabled: true,
        nextRunAt: new Date(Date.now() + dto.intervalMinutes * 60000), createdById: actorId,
      },
    });
    return job;
  }

  async listJobs(organizationId: string) {
    return (this.prisma as any).scheduledJob.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });
  }

  // ---------- Automations A4: job template gallery ----------

  listJobTemplates() {
    return JOB_TEMPLATES;
  }

  /**
   * One-click install: creates a REAL ScheduledJob through the
   * existing createJob path (so the job is enabled with the
   * codebase's normal job defaults and runs on the normal
   * schedule). Org templates target the organization itself;
   * integration/competitor templates require the tenant's chosen
   * targetId, validated to belong to the org. Installing the same
   * template target twice is refused — a duplicate sweep would
   * only double store/API calls.
   */
  async installJobTemplate(organizationId: string, actorId: string, key: string, dto?: { targetId?: string; name?: string }) {
    const tpl = JOB_TEMPLATES.find((t) => t.key === key);
    if (!tpl) throw new NotFoundException("Job template not found");
    let targetId = organizationId;
    if (tpl.targetKind !== "org") {
      if (!dto?.targetId) {
        throw new BadRequestException(tpl.targetKind === "integration"
          ? "এই টেমপ্লেটের জন্য একটি Store Integration বেছে দিতে হবে"
          : "এই টেমপ্লেটের জন্য একটি Competitor বেছে দিতে হবে");
      }
      targetId = dto.targetId;
      const table = (this.prisma as any)[tpl.targetKind === "integration" ? "integration" : "competitor"];
      const owned = table ? await table.findFirst({ where: { id: targetId, organizationId } }).catch(() => null) : null;
      if (!owned) {
        throw new BadRequestException(tpl.targetKind === "integration"
          ? "Integration not found in this organization"
          : "Competitor not found in this organization");
      }
    }
    const existing = await (this.prisma as any).scheduledJob.findFirst({
      where: { organizationId, type: tpl.type, targetId },
    });
    if (existing) throw new BadRequestException("এই টেমপ্লেটের Job ইতিমধ্যে তৈরি আছে");
    return this.createJob(organizationId, actorId, {
      name: dto?.name?.trim() ? dto.name.trim() : tpl.name,
      type: tpl.type, targetId, intervalMinutes: tpl.intervalMinutes,
    });
  }

  private async getJobOrThrow(organizationId: string, jobId: string) {
    const job = await (this.prisma as any).scheduledJob.findFirst({ where: { id: jobId, organizationId } });
    if (!job) throw new NotFoundException("Scheduled job not found");
    return job;
  }

  async updateJob(organizationId: string, jobId: string, dto: { enabled?: boolean; intervalMinutes?: number; name?: string }) {
    await this.getJobOrThrow(organizationId, jobId);
    const data: Record<string, unknown> = {};
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.intervalMinutes !== undefined) {
      if (dto.intervalMinutes < 1) throw new BadRequestException("intervalMinutes must be at least 1");
      data.intervalMinutes = Math.floor(dto.intervalMinutes);
    }
    return (this.prisma as any).scheduledJob.update({ where: { id: jobId }, data });
  }

  async deleteJob(organizationId: string, jobId: string) {
    await this.getJobOrThrow(organizationId, jobId);
    await (this.prisma as any).scheduledJob.delete({ where: { id: jobId } });
    return { deleted: true };
  }

  async executeJob(job: any): Promise<unknown> {
    const orgId: string = job.organizationId;
    const actor: string = job.createdById;
    switch (job.type) {
      case "woo_products": return this.integrations.syncProducts(orgId, actor, job.targetId);
      case "woo_orders": return this.integrations.syncOrders(orgId, actor, job.targetId);
      case "shopify_products": return this.shopify.syncProducts(orgId, actor, job.targetId);
      case "shopify_orders": return this.shopify.syncOrders(orgId, actor, job.targetId);
      case "woo_customers": return this.integrations.syncCustomers(orgId, actor, job.targetId);
      case "woo_reviews": return this.integrations.syncReviews(orgId, actor, job.targetId);
      case "shopify_customers": return this.shopify.syncCustomers(orgId, actor, job.targetId);
      // AD5: scheduled insights syncs go through the job entry
      // point so a sync-disabled account is SKIPPED (the skip
      // marker becomes the run result) instead of failing the job.
      case "meta_insights": return this.ads.syncInsightsJob("meta", orgId, actor, job.targetId);
      case "google_insights": return this.ads.syncInsightsJob("google", orgId, actor, job.targetId);
      case "tiktok_insights": return this.ads.syncInsightsJob("tiktok", orgId, actor, job.targetId);
      case "daily_report": return this.reports.generate(orgId, actor, { type: "daily" });
      case "daily_briefing": return this.proactive ? this.proactive.runDailyBriefing(orgId, actor) : { skipped: "proactive service unavailable" };
      case "competitor_ads": return this.competitors.syncAds(orgId, actor, job.targetId, {});
      case "competitor_scan": return this.competitors.scanWebsite(orgId, actor, job.targetId);
      case "competitor_multi_sync": return this.competitors.syncMultiPlatform(orgId, actor, job.targetId);
      case "weekly_ads_report": return this.sendWeeklyAdsReport(orgId);
      case "monthly_report": return this.reports.generate(orgId, actor, { type: "monthly" });
      case "saved_report_delivery": return this.deliverSavedReport(orgId, job.targetId);

      case "dunning_reminders": return this.sendDunningReminder(orgId);
      case "billing_reminders": return this.sendBillingReminders(orgId);
      case "inbox_assignment_sweep": {
        if (!this.inbox) throw new BadRequestException("Inbox service is not available in this deployment");
        return this.inbox.sweepAssignments(orgId);
      }
      case "email_sync": {
        if (!this.emailChannel) throw new BadRequestException("Email channel is not available in this deployment");
        return this.emailChannel.syncOrganization(orgId);
      }
      case "inbox_retention": {
        if (!this.inbox) throw new BadRequestException("Inbox service is not available in this deployment");
        return this.inbox.applyRetention(orgId);
      }
      case "lead_followup_sweep": {
        if (!this.leads) throw new BadRequestException("Leads service is not available in this deployment");
        return this.leads.sweepFollowUpReminders(orgId);
      }
      case "ad_spend_watchdog": {
        if (!this.ads) throw new BadRequestException("Ads service is not available in this deployment");
        return this.ads.runSpendWatchdog(orgId);
      }
      case "social_publish_due": {
        if (!this.socialPublish) throw new BadRequestException("Social publish service is not available in this deployment");
        return this.socialPublish.runDuePublishes(orgId);
      }
      case "inbox_autoreply_sweep": {
        if (!this.inbox) throw new BadRequestException("Inbox service is not available in this deployment");
        return this.inbox.runDueAutoReplies(orgId);
      }
      case "comment_autoreply_sweep": {
        if (!this.socialComments) throw new BadRequestException("Social comments service is not available in this deployment");
        return this.socialComments.runDueCommentReplies(orgId);
      }
      case "handover_timer_sweep": {
        if (!this.inbox) throw new BadRequestException("Inbox service is not available in this deployment");
        return this.inbox.runHandoverSweeps(orgId);
      }
      case "inbox_sla_sweep": {
        if (!this.inbox) throw new BadRequestException("Inbox service is not available in this deployment");
        return this.inbox.runSlaSweeps(orgId);
      }
      case "courier_auto_sync": {
        if (!this.courier) throw new BadRequestException("Courier service is not available in this deployment");
        return this.courier.syncAll(orgId);
      }
      case "review_request_sweep": {
        if (!this.reviews) throw new BadRequestException("Reviews service is not available in this deployment");
        return this.reviews.runReviewSweep(orgId, this.inbox);
      }
      case "order_chase_sweep": {
        if (!this.orderChase) throw new BadRequestException("Order chase service is not available in this deployment");
        return this.orderChase.runOrderChaseSweep(orgId, this.inbox);
      }
      case "inbox_chase_sweep": {
        if (!this.inbox) throw new BadRequestException("Inbox service is not available in this deployment");
        return this.inbox.runChaseSweep(orgId);
      }
      case "broadcast_send_sweep": {
        if (!this.messaging) throw new BadRequestException("Messaging service is not available in this deployment");
        return this.messaging.runDueBroadcasts(orgId);
      }
      case "auto_renew": {
        if (!this.payments) throw new BadRequestException("Payments service is not available in this deployment");
        return this.payments.chargeAutoRenew(orgId);
      }
      case "subscription_sweep": {
        const { sweepSubscription } = await import("../common/platform-settings");
        const result = await sweepSubscription(this.prisma as any, orgId);
        if (result.changed) {
          await this.audit.log({ organizationId: orgId, action: result.status === "FREE" ? "subscription.plan_change_applied" : "subscription.past_due", entityType: "Subscription", entityId: orgId, metadata: { via: "subscription_sweep", status: result.status } });
        }
        return result;
      }
      case "meta_status_sync": return this.campaigns.syncAllPublishedStatuses(orgId, actor);
      case "dayparting": {
        // Milestone 40: platform feature flag (dayparting).
        if (!(await orgFlagEnabled(this.prisma as any, orgId, "dayparting"))) {
          return { skipped: true, reason: "dayparting is disabled for this organization by the platform team" };
        }
        return this.campaigns.applyDayparting(orgId, actor);
      }
      case "audit_retention": return this.runAuditRetention();
      case "sync_outbox": return this.outbox ? this.outbox.processDueForOrg(orgId) : { skipped: "sync outbox unavailable" };
      case "sale_schedule": return this.catalogPush ? this.catalogPush.processSaleBoundariesForOrg(orgId) : { skipped: "catalog push unavailable" };
      case "commerce_subscription_sweep": return this.commerceSubscriptions ? this.commerceSubscriptions.runDueForOrg(orgId) : { skipped: "commerce subscriptions unavailable" };
      case "wishlist_price_alert_sweep": return this.retention ? this.retention.runWishlistPriceAlerts(orgId) : { skipped: "retention service unavailable" };
      case "installment_due_sweep": return this.installments ? this.installments.runDueRemindersForOrg(orgId) : { skipped: "installments unavailable" };
      case "audience_refresh": {
        if (!this.audiences) throw new BadRequestException("Audience service is not available in this deployment");
        return this.audiences.refreshAllMemberships(orgId, actor);
      }
      default: throw new BadRequestException(`Unknown job type: ${job.type}`);
    }
  }

  async runJobNow(organizationId: string, actorId: string, jobId: string) {
    const job = await this.getJobOrThrow(organizationId, jobId);
    if (this.queueEnabled()) {
      try {
        const bullJobId = await this.enqueueScheduled(job, `manual-${Date.now()}`);
        return { queued: true, bullJobId, jobId: job.id };
      } catch (e) {
        this.logger.warn(`Enqueue failed, running inline instead: ${e instanceof Error ? e.message : e}`);
      }
    }
    return this.runJob(job);
  }

  private async runJob(job: any) {
    const startedAt = new Date();
    try {
      const result = await this.executeJob(job);
      const summary = summarizeResult(result);
      await (this.prisma as any).automationRun.create({
        data: { organizationId: job.organizationId, kind: "schedule", refId: job.id, status: "success", detail: summary },
      });
      return (this.prisma as any).scheduledJob.update({
        where: { id: job.id },
        data: { lastRunAt: startedAt, lastStatus: "success", lastError: null, nextRunAt: new Date(Date.now() + job.intervalMinutes * 60000) },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Job failed";
      await (this.prisma as any).automationRun.create({
        data: { organizationId: job.organizationId, kind: "schedule", refId: job.id, status: "error", detail: message },
      });
      return (this.prisma as any).scheduledJob.update({
        where: { id: job.id },
        data: { lastRunAt: startedAt, lastStatus: "error", lastError: message, nextRunAt: new Date(Date.now() + job.intervalMinutes * 60000) },
      });
    }
  }

  async runDueJobs(): Promise<number> {
    const due = await (this.prisma as any).scheduledJob.findMany({
      where: { enabled: true, nextRunAt: { lte: new Date() } },
      orderBy: { nextRunAt: "asc" }, take: 10,
    });
    if (this.queueEnabled() && due.length) {
      let dispatched = 0;
      for (const job of due) {
        try {
          await this.enqueueScheduled(job, String(new Date(job.nextRunAt).getTime()));
          // Advance the schedule at dispatch time; the outcome is
          // recorded by the worker callback (lastStatus/lastRunAt).
          await (this.prisma as any).scheduledJob.update({
            where: { id: job.id },
            data: { nextRunAt: new Date(Date.now() + job.intervalMinutes * 60000) },
          });
          dispatched++;
        } catch (e) {
          this.logger.warn(`Dispatch failed for job ${job.id}, running inline: ${e instanceof Error ? e.message : e}`);
          await this.runJob(job);
        }
      }
      return dispatched;
    }
    for (const job of due) await this.runJob(job);
    return due.length;
  }

  /** Weekly ads summary emailed to the org's OWNER/ADMIN members.
   * Numbers come from campaign-level DailyAdMetric rows and real
   * orders of the last 7 days. If SMTP is not configured the job
   * fails honestly (EmailProvider throws) and the run is marked
   * error by the scheduler wrapper. */
  async sendWeeklyAdsReport(organizationId: string) {
    if (!this.email) throw new BadRequestException("Email provider is not available in this deployment");
    const from = new Date(Date.now() - 6 * 86400000);
    from.setUTCHours(0, 0, 0, 0);
    const metrics = await (this.prisma as any).dailyAdMetric.findMany({
      where: { organizationId, date: { gte: from } }, take: 20000,
    });
    const campaignRows = metrics.filter((m: any) => (m.adExternalId ?? "") === "");
    let spend = 0n, impressions = 0, clicks = 0, conversions = 0;
    for (const m of campaignRows) {
      spend += BigInt(m.spendMinor); impressions += m.impressions ?? 0; clicks += m.clicks ?? 0; conversions += m.platformConversions ?? 0;
    }
    const orders = await (this.prisma as any).order.findMany({
      where: { organizationId, placedAt: { gte: from } }, take: 20000,
    }).catch(() => []);
    const revenueOrders = orders.filter((o: any) => !["cancelled", "refunded"].includes(o.status));
    const revenue = revenueOrders.reduce((s: bigint, o: any) => s + BigInt(o.totalMinor), 0n);
    const memberships = await (this.prisma as any).membership.findMany({
      where: { organizationId, role: { in: ["OWNER", "ADMIN"] } }, include: { user: true },
    });
    const recipients = memberships.map((m: any) => m.user?.email).filter(Boolean) as string[];
    if (recipients.length === 0) throw new BadRequestException("No OWNER/ADMIN email recipients found");
    const fmt = (minor: bigint) => (Number(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
    const text = [
      "Weekly Ads Summary (last 7 days)", "",
      `Ad spend: ${fmt(spend)}`,
      `Impressions: ${impressions.toLocaleString()}  Clicks: ${clicks.toLocaleString()}`,
      `Platform conversions: ${conversions}`,
      `Store orders: ${revenueOrders.length}  Revenue: ${fmt(revenue)}`,
      "",
      "Platform-reported conversions come from the ad platforms and can differ from tracked store orders.",
    ].join("\n");
    let sent = 0;
    for (const to of recipients) {
      await this.email.send({ to, subject: "Weekly Ads Summary — গত ৭ দিনের বিজ্ঞাপন সারসংক্ষেপ", text });
      sent++;
    }
    return { sent, recipients: recipients.length, spendMinor: spend.toString(), orders: revenueOrders.length };
  }

  /**
   * Reports Advanced RP4: deliver a tenant's saved
   * report by email. Recipients = the report's own
   * list ∪ OWNER/ADMIN member emails ∪ the business
   * profile's billing emails. A send counts only when
   * the provider confirms (send() throws otherwise,
   * failing the job honestly). No recipients at all
   * is a job failure, not a silent success.
   */
  async deliverSavedReport(organizationId: string, savedReportId: string) {
    if (!this.email) throw new BadRequestException("Email provider is not available in this deployment");
    if (!this.reportExports) throw new BadRequestException("Report export service is not available in this deployment");
    const def = await (this.prisma as any).savedReport.findFirst({ where: { id: savedReportId, organizationId } }).catch(() => null);
    if (!def) throw new BadRequestException("Saved report not found for this job's target");
    const memberships = await (this.prisma as any).membership.findMany({
      where: { organizationId, role: { in: ["OWNER", "ADMIN"] }, status: "ACTIVE" }, include: { user: true },
    }).catch(() => []);
    const profile = await (this.prisma as any).businessProfile.findUnique({ where: { organizationId }, select: { billingEmails: true } }).catch(() => null);
    const billing = Array.isArray(profile?.billingEmails) ? profile.billingEmails : [];
    const recipients = [...new Set([
      ...(def.recipients ?? []),
      ...(memberships ?? []).map((m: any) => m.user?.email).filter(Boolean),
      ...billing.map((b: any) => String(b)).filter((b: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b)),
    ])] as string[];
    if (!recipients.length) throw new BadRequestException("No email recipients found for this report (report recipients, OWNER/ADMIN, billing contacts all empty)");
    const parts = await this.reportExports.savedEmailParts(organizationId, savedReportId);
    let sent = 0;
    for (const to of recipients) {
      await this.email.send({ to, subject: parts.subject, text: parts.text, html: parts.html });
      sent++;
    }
    return { sent, recipients: recipients.length, reportId: savedReportId };
  }

  /** Milestone 39 dunning: staged PAST_DUE reminders (stage 1 on
   * the first run, then day 3 and day 7+). Each stage is sent
   * ONCE per past-due episode — the audit log is the record, so
   * re-runs are no-ops. Without a configured email provider the
   * job fails honestly instead of pretending to remind anyone. */
  /**
   * Milestone 40 (Phase A4): audit-log retention. Deletes audit
   * rows older than the configured retention (platform setting
   * auditRetentionDays, default 365, min 30) EXCEPT admin.*
   * actions, which are kept indefinitely for operator
   * accountability. Platform-wide — the job's org is ignored.
   */
  async runAuditRetention() {
    const raw = await platformSetting(this.prisma as any, "auditRetentionDays").catch(() => null);
    const days = Math.min(3650, Math.max(30, Number(raw ?? 365) || 365));
    const cutoff = new Date(Date.now() - days * 86400000);
    const old = await (this.prisma as any).auditLog?.findMany({
      where: { createdAt: { lt: cutoff } }, take: 100000,
    }).catch(() => []) ?? [];
    const deletable = (old as any[]).filter((r) => !String(r.action ?? "").startsWith("admin."));
    let deleted = 0;
    for (const r of deletable) {
      const res = await (this.prisma as any).auditLog.delete({ where: { id: r.id } }).catch(() => null);
      if (res) deleted++;
    }
    return { retentionDays: days, cutoff: cutoff.toISOString(), candidates: (old as any[]).length, deleted, preservedAdminActions: (old as any[]).length - deletable.length };
  }

  /**
   * Billing Package B1: pre-expiry + abandoned-checkout
   * reminders. In-app notifications are the reliable channel;
   * email is attempted when a provider exists and its outcome
   * is reported honestly (sent count / skipped / error) —
   * never claimed sent when it was not. Audit rows are the
   * dedupe record, exactly like dunning: each expiry stage
   * fires once per period, each checkout is reminded once.
   */
  async sendBillingReminders(organizationId: string) {
    const p = this.prisma as any;
    const now = new Date();
    const out: any = { expiry: null, checkoutReminders: 0, notifications: 0, emailsSent: 0, emailStatus: this.email ? "attempted" : "no_provider" };
    const memberships = (await p.membership.findMany({
      where: { organizationId, role: { in: ["OWNER", "ADMIN"] }, status: "ACTIVE" }, include: { user: true },
    }).catch(() => [])) as any[];
    const profile = (await p.businessProfile?.findUnique?.({ where: { organizationId } })?.catch?.(() => null)) ?? null;
    const extraEmails: string[] = Array.isArray(profile?.billingEmails) ? profile.billingEmails : [];
    const recipients = [...new Set([...memberships.map((m) => m.user?.email).filter(Boolean), ...extraEmails])] as string[];
    const org = await p.organization.findUnique({ where: { id: organizationId } }).catch(() => null);
    const notifyAdmins = async (title: string, body: string) => {
      for (const m of memberships) {
        const made = await p.agentNotification?.create?.({ data: { organizationId, userId: m.userId, type: "billing", title, body } })?.catch?.(() => null);
        if (made) out.notifications++;
      }
    };
    const mailAll = async (subject: string, text: string) => {
      if (!this.email) return;
      for (const to of recipients) {
        try { await this.email.send({ to, subject, text }); out.emailsSent++; }
        catch { out.emailStatus = "provider_error"; }
      }
    };
    const metaOf = (a: any) => { try { return typeof a.metadata === "string" ? JSON.parse(a.metadata) : a.metadata ?? {}; } catch { return {}; } };

    // --- subscription expiring soon (stages 7 / 3 / 1 days) ---
    const sub = await p.subscription.findFirst({ where: { organizationId }, orderBy: { createdAt: "desc" } }).catch(() => null);
    if (sub && ["ACTIVE", "TRIALING"].includes(sub.status) && sub.currentPeriodEnd) {
      const daysLeft = Math.ceil((new Date(sub.currentPeriodEnd).getTime() - now.getTime()) / 86400000);
      const stage = daysLeft <= 0 ? null : daysLeft <= 1 ? 1 : daysLeft <= 3 ? 3 : daysLeft <= 7 ? 7 : null;
      if (stage) {
        const prior = (await p.auditLog.findMany({ where: { organizationId, action: "billing.expiry_reminder_sent" }, take: 50 }).catch(() => [])) as any[];
        const already = prior.some((a) => metaOf(a)?.stage === stage && metaOf(a)?.periodEnd === new Date(sub.currentPeriodEnd).toISOString());
        if (!already) {
          const title = `⏳ সাবস্ক্রিপশনের মেয়াদ ${daysLeft} দিন বাকি`;
          const body = `${org?.name ?? "আপনার"} ওয়ার্কস্পেসের ${sub.plan} প্ল্যানের মেয়াদ ${daysLeft} দিন পর শেষ হবে। সেবা নির্বিঘ্নে চালু রাখতে Billing পেজ থেকে নবায়ন করুন।`;
          await notifyAdmins(title, body);
          await mailAll(`সাবস্ক্রিপশন নবায়ন — ${daysLeft} দিন বাকি (${sub.plan})`, `${title}\n\n${body}\n\n— Qosprey AI Marketing টিম`);
          await this.audit.log({
            organizationId, action: "billing.expiry_reminder_sent", entityType: "Subscription", entityId: sub.id,
            metadata: { stage, daysLeft, periodEnd: new Date(sub.currentPeriodEnd).toISOString(), notified: memberships.length, emailsSent: out.emailsSent, emailStatus: out.emailStatus },
          });
          out.expiry = { stage, daysLeft, sent: true };
        } else out.expiry = { stage, daysLeft, sent: false, reason: "stage already sent" };
      }
    }

    // --- abandoned checkouts (initiated 1h–3d ago), once each ---
    const stale = (await p.planCheckout.findMany({
      where: { organizationId, status: "initiated", createdAt: { lt: new Date(now.getTime() - 3600_000), gt: new Date(now.getTime() - 3 * 86400000) } },
      take: 20,
    }).catch(() => [])) as any[];
    if (stale.length) {
      const prior = (await p.auditLog.findMany({ where: { organizationId, action: "billing.checkout_reminder_sent" }, take: 100 }).catch(() => [])) as any[];
      const reminded = new Set(prior.map((a) => metaOf(a)?.checkoutId).filter(Boolean));
      for (const co of stale) {
        if (reminded.has(co.id)) continue;
        const made = await p.agentNotification?.create?.({
          data: { organizationId, userId: co.createdById, type: "billing", title: "💳 অসম্পূর্ণ পেমেন্ট", body: `${co.plan} প্ল্যানের পেমেন্টটি অসম্পূর্ণ আছে (${co.tranId}) — Billing পেজ থেকে আবার চেষ্টা করে প্ল্যানটি চালু করুন।` },
        })?.catch?.(() => null);
        if (made) out.notifications++;
        const creator = await p.user.findUnique({ where: { id: co.createdById } }).catch(() => null);
        if (this.email && creator?.email) {
          try { await this.email.send({ to: creator.email, subject: `অসম্পূর্ণ পেমেন্ট — ${co.plan} প্ল্যান`, text: `আপনার ${co.plan} প্ল্যানের পেমেন্টটি সম্পূর্ণ হয়নি। Billing পেজ থেকে আবার চেষ্টা করুন — মেয়াদ শেষ হওয়ার আগেই নবায়ন করলে সেবা বন্ধ হবে না।\n\n— Qosprey AI Marketing টিম` }); out.emailsSent++; }
          catch { out.emailStatus = "provider_error"; }
        }
        await this.audit.log({
          organizationId, action: "billing.checkout_reminder_sent", entityType: "PlanCheckout", entityId: co.id,
          metadata: { checkoutId: co.id, plan: co.plan, tranId: co.tranId },
        });
        out.checkoutReminders++;
      }
    }

    // --- Billing Package B6: usage alerts at 80% / 100% of
    // the plan limits (seats + daily AI), once per metric +
    // threshold per Asia/Dhaka day, audit-deduped. ---
    out.usageAlerts = [];
    try {
      const limits = await effectiveLimits(p, organizationId, {
        aiDaily: Number(process.env.AI_DAILY_MESSAGE_LIMIT ?? 200),
        broadcastCap: Number(process.env.BROADCAST_MAX_RECIPIENTS ?? 1000),
      });
      const dayStart = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
      const seatsUsed = await p.membership.count({ where: { organizationId, status: "ACTIVE" } }).catch(() => 0);
      const aiUsed = (await p.aIUsageRecord?.count?.({ where: { organizationId, createdAt: { gte: dayStart } } })?.catch?.(() => 0)) ?? 0;
      const dhakaDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(now);
      const checks = [
        { metric: "seats", label: "টিম সিট", used: Number(seatsUsed ?? 0), limit: limits.seats },
        { metric: "aiDaily", label: "দৈনিক AI ব্যবহার", used: Number(aiUsed ?? 0), limit: limits.aiDaily },
      ];
      for (const c of checks) {
        if (!c.limit || c.limit <= 0) continue;
        const ratio = c.used / c.limit;
        const threshold = ratio >= 1 ? 100 : ratio >= 0.8 ? 80 : null;
        if (!threshold) continue;
        const prior = (await p.auditLog.findMany({ where: { organizationId, action: "billing.usage_alert_sent" }, take: 100 }).catch(() => [])) as any[];
        const already = prior.some((a) => { const m = metaOf(a); return m?.metric === c.metric && m?.threshold === threshold && m?.day === dhakaDay; });
        if (already) continue;
        const title = threshold === 100 ? `🚫 ${c.label} এর সীমা শেষ (${c.used}/${c.limit})` : `⚠️ ${c.label} সীমার ${threshold}% ব্যবহৃত (${c.used}/${c.limit})`;
        const body = `${org?.name ?? "আপনার"} ওয়ার্কস্পেসে ${c.label}: ${c.used}/${c.limit} ব্যবহৃত হয়েছে। ${threshold === 100 ? "সীমা বাড়াতে বড় প্ল্যান নিন — Billing পেজ দেখুন।" : "সীমা শেষ হওয়ার আগেই বড় প্ল্যান নেওয়ার কথা ভাবুন।"}`;
        await notifyAdmins(title, body);
        await mailAll(title, `${title}\n\n${body}\n\n— Qosprey AI Marketing টিম`);
        await this.audit.log({
          organizationId, action: "billing.usage_alert_sent", entityType: "Organization", entityId: organizationId,
          metadata: { metric: c.metric, threshold, used: c.used, limit: c.limit, day: dhakaDay },
        });
        out.usageAlerts.push({ metric: c.metric, threshold });
      }
    } catch (e) {
      out.usageAlertsError = e instanceof Error ? e.message : "usage check failed";
    }

    // --- Referral Advanced R2: expire granted credit whose
    // date has passed, FIFO over the credit ledger. ---
    out.creditExpiredMinor = "0";
    try {
      const entries = (await p.creditLedger?.findMany?.({ where: { organizationId }, orderBy: { createdAt: "asc" }, take: 1000 })?.catch?.(() => [])) ?? [];
      const due = computeExpiredUnspent(entries as any[], now);
      if (due > 0n) {
        const orgRow = await p.organization.findUnique({ where: { id: organizationId } }).catch(() => null);
        const balance = BigInt(orgRow?.creditMinor ?? 0);
        const debit = due > balance ? balance : due;
        if (debit > 0n) {
          await p.organization.update({ where: { id: organizationId }, data: { creditMinor: balance - debit } });
          await p.creditLedger.create({ data: { organizationId, deltaMinor: -debit, reason: "credit_expired" } });
          await this.audit.log({
            organizationId, action: "billing.credit_expired", entityType: "Organization", entityId: organizationId,
            metadata: { expiredMinor: debit.toString() },
          });
          await notifyAdmins("⏰ কিছু বিলিং ক্রেডিটের মেয়াদ শেষ", `রেফারেল ক্রেডিটের মেয়াদ পেরিয়ে যাওয়ায় ৳${(Number(debit) / 100).toFixed(2)} বাদ গেছে। বিস্তারিত Billing পেজের ক্রেডিট ইতিহাসে দেখুন।`);
          out.creditExpiredMinor = debit.toString();
        }
      }
    } catch (e) {
      out.creditExpiryError = e instanceof Error ? e.message : "credit expiry check failed";
    }
    return out;
  }

  async sendDunningReminder(organizationId: string) {
    if (!this.email) throw new BadRequestException("Email provider is not available in this deployment");
    const sub = await (this.prisma as any).subscription.findFirst({
      where: { organizationId }, orderBy: { createdAt: "desc" },
    }).catch(() => null);
    if (!sub || sub.status !== "PAST_DUE") return { skipped: "subscription is not past due" };
    const end = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : new Date();
    const daysOverdue = Math.max(0, Math.floor((Date.now() - end.getTime()) / 86400000));
    const stage = daysOverdue >= 7 ? 7 : daysOverdue >= 3 ? 3 : 1;
    const prior = await (this.prisma as any).auditLog.findMany({
      where: { organizationId, action: "billing.dunning_sent" }, take: 50,
    }).catch(() => []);
    const already = (prior as any[]).some((a) => {
      const meta = typeof a.metadata === "string" ? JSON.parse(a.metadata) : a.metadata;
      return meta?.stage === stage && meta?.periodEnd === (sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toISOString() : null);
    });
    if (already) return { skipped: "stage already sent", stage, daysOverdue };
    const org = await (this.prisma as any).organization.findUnique({ where: { id: organizationId } }).catch(() => null);
    const memberships = await (this.prisma as any).membership.findMany({
      where: { organizationId, role: { in: ["OWNER", "ADMIN"] } }, include: { user: true },
    });
    const recipients = memberships.map((m: any) => m.user?.email).filter(Boolean) as string[];
    if (recipients.length === 0) throw new BadRequestException("No OWNER/ADMIN email recipients found");
    const text = [
      `আসসালামু আলাইকুম,`,
      ``,
      `${org?.name ?? "আপনার"} ওয়ার্কস্পেসের ${sub.plan} সাবস্ক্রিপশনের মেয়াদ ${daysOverdue} দিন আগে শেষ হয়েছে (PAST_DUE)।`,
      `মেয়াদ পেরিয়ে যাওয়ায় ওয়ার্কস্পেসটি এখন Read-only — নতুন ডেটা যোগ করা যাচ্ছে না, তবে সব ডেটা নিরাপদে আছে।`,
      `পেমেন্ট সম্পন্ন হলেই সাবস্ক্রিপশন আবার সক্রিয় হবে। Billing পেজ থেকে অনলাইনে পেমেন্ট করতে পারবেন, অথবা প্ল্যাটফর্ম টিমের সাথে যোগাযোগ করুন।`,
      ``,
      `— Qosprey AI Marketing টিম`,
    ].join("\n");
    let sent = 0;
    for (const to of recipients) {
      await this.email.send({ to, subject: `সাবস্ক্রিপশন মেয়াদ শেষ — ${sub.plan} (দিন ${daysOverdue})`, text });
      sent++;
    }
    await this.audit.log({
      organizationId, action: "billing.dunning_sent", entityType: "Subscription", entityId: sub.id,
      metadata: { stage, daysOverdue, recipients: sent, periodEnd: sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toISOString() : null },
    });
    return { sent, stage, daysOverdue };
  }

  // ---------- Automation rules ----------
  async createRule(organizationId: string, actorId: string, dto: {
    name: string; metric: string; comparator: string; threshold: string; windowDays?: number; action: string; campaignPlanId?: string;
    actionConfig?: { percent?: number; minDailyMinor?: number; maxDailyMinor?: number; cooldownHours?: number };
  }) {
    if (!(RULE_METRICS as readonly string[]).includes(dto.metric)) throw new BadRequestException("Invalid metric");
    if (!["gt", "lt"].includes(dto.comparator)) throw new BadRequestException("Invalid comparator");
    if (!(RULE_ACTIONS as readonly string[]).includes(dto.action)) throw new BadRequestException("Invalid action");
    if (Number.isNaN(Number(dto.threshold))) throw new BadRequestException("threshold must be numeric");
    if (dto.action === "scale_budget") {
      const percent = Number(dto.actionConfig?.percent ?? 0);
      if (!percent || percent < -90 || percent > 200) throw new BadRequestException("scale_budget needs actionConfig.percent between -90 and 200");
    }
    const rule = await (this.prisma as any).automationRule.create({
      data: {
        organizationId, name: dto.name, metric: dto.metric, comparator: dto.comparator,
        threshold: dto.threshold, windowDays: dto.windowDays ?? 3, action: dto.action,
        campaignPlanId: dto.campaignPlanId ?? null, enabled: true, createdById: actorId,
        actionConfig: dto.actionConfig ?? undefined,
      },
    });
    return rule;
  }

  /** First-party metrics for a plan from our OWN attribution credits.
   * Credits link to a campaign by name (UTM campaign) or by external id
   * when the touchpoint carried one; revenue/orders are the credited
   * amounts under the org's current attribution model credits. Spend is
   * the same platform spend used by platform metrics, so the two
   * families stay comparable but are never mixed. */
  /** Per-ad aggregates for a plan's Meta campaign (rules v3). */
  async adMetricsForPlan(organizationId: string, campaignExternalId: string, windowDays: number) {
    const since = new Date(Date.now() - windowDays * 86400000);
    const rows = await (this.prisma as any).dailyAdMetric.findMany({
      where: { organizationId, campaignExternalId, date: { gte: since } }, take: 10000,
    });
    const map = new Map<string, { adExternalId: string; spend: bigint; impressions: bigint; clicks: bigint; reach: bigint }>();
    for (const r of rows as any[]) {
      if (!r.adExternalId) continue;
      const a = map.get(r.adExternalId) ?? { adExternalId: r.adExternalId, spend: 0n, impressions: 0n, clicks: 0n, reach: 0n };
      a.spend += BigInt(r.spendMinor ?? 0); a.impressions += BigInt(r.impressions ?? 0);
      a.clicks += BigInt(r.clicks ?? 0); a.reach += BigInt(r.reach ?? 0);
      map.set(r.adExternalId, a);
    }
    return [...map.values()].map((a) => ({
      ...a,
      frequency: a.reach > 0n ? Number(a.impressions) / Number(a.reach) : null,
      ctrPercent: a.impressions > 0n ? Number(a.clicks) / Number(a.impressions) * 100 : null,
    }));
  }

  async firstPartyMetrics(organizationId: string, plan: any, windowDays: number, spendMinor: bigint) {
    const from = new Date(Date.now() - (windowDays - 1) * 86400000);
    from.setUTCHours(0, 0, 0, 0);
    const credits = await (this.prisma as any).attributionCredit.findMany({
      where: { organizationId, createdAt: { gte: from } }, take: 20000,
    }).catch(() => []);
    const touchIds = [...new Set(credits.map((c: any) => c.touchpointId).filter(Boolean))];
    const touches = touchIds.length
      ? await (this.prisma as any).touchpoint.findMany({ where: { id: { in: touchIds } } }).catch(() => [])
      : [];
    const campaignByTouch = new Map(touches.map((t: any) => [t.id, t.campaign as string | null]));
    let revenue = 0n;
    const orders = new Set<string>();
    for (const c of credits) {
      const campaignKey = c.touchpointId ? campaignByTouch.get(c.touchpointId) : null;
      if (!campaignKey) continue;
      if (campaignKey !== plan.name && campaignKey !== plan.externalCampaignId) continue;
      revenue += BigInt(c.revenueMinor ?? 0);
      if (c.orderId) orders.add(c.orderId);
    }
    return {
      revenueMinor: revenue, orders: orders.size,
      roas: spendMinor > 0n ? Number((revenue * 100n) / spendMinor) / 100 : null,
      cpaMajor: orders.size > 0 ? Number(spendMinor) / 100 / orders.size : null,
    };
  }

  async listRules(organizationId: string) {
    return (this.prisma as any).automationRule.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });
  }

  async updateRule(organizationId: string, ruleId: string, dto: { enabled?: boolean }) {
    const rule = await (this.prisma as any).automationRule.findFirst({ where: { id: ruleId, organizationId } });
    if (!rule) throw new NotFoundException("Rule not found");
    return (this.prisma as any).automationRule.update({ where: { id: ruleId }, data: { ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}) } });
  }

  async deleteRule(organizationId: string, ruleId: string) {
    const rule = await (this.prisma as any).automationRule.findFirst({ where: { id: ruleId, organizationId } });
    if (!rule) throw new NotFoundException("Rule not found");
    await (this.prisma as any).automationRule.delete({ where: { id: ruleId } });
    return { deleted: true };
  }

  /** Campaign metrics over a window, from DailyAdMetric rows of the plan's
   *  Meta campaign. Platform-reported figures, labeled as such. */
  async campaignMetrics(organizationId: string, externalCampaignId: string, windowDays: number) {
    const from = new Date(Date.now() - (windowDays - 1) * 86400000);
    from.setUTCHours(0, 0, 0, 0);
    const rows = await (this.prisma as any).dailyAdMetric.findMany({
      where: { organizationId, campaignExternalId: externalCampaignId, date: { gte: from } },
    });
    // Campaign-level rows only — ad-level rows describe the same spend.
    const campaignRows = rows.filter((r: any) => (r.adExternalId ?? "") === "");
    let spend = 0n, conversions = 0, conversionValue = 0n, impressions = 0, clicks = 0, reach = 0;
    for (const r of campaignRows) {
      spend += BigInt(r.spendMinor);
      conversions += Number(r.platformConversions ?? 0);
      conversionValue += BigInt(r.platformConversionValueMinor ?? 0);
      impressions += Number(r.impressions ?? 0);
      clicks += Number(r.clicks ?? 0);
      reach += Number(r.reach ?? 0);
    }
    return {
      spendMinor: spend, conversions, conversionValueMinor: conversionValue,
      impressions, clicks, reach,
      cpaMajor: conversions > 0 ? Number(spend) / 100 / conversions : null,
      roas: spend > 0n ? Number((conversionValue * 100n) / spend) / 100 : null,
      ctrPercent: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : null,
      cpmMinor: impressions > 0 ? Math.round((Number(spend) / impressions) * 1000) : null,
      frequency: reach > 0 ? Math.round((impressions / reach) * 100) / 100 : null,
    };
  }

  async evaluateRules(organizationId: string, actorId: string | null) {
    const rules = await (this.prisma as any).automationRule.findMany({ where: { organizationId, enabled: true } });
    const results: { ruleId: string; planId: string; triggered: boolean; detail: string }[] = [];
    for (const rule of rules) {
      await (this.prisma as any).automationRule.update({ where: { id: rule.id }, data: { lastEvaluatedAt: new Date() } });
      const plans = await (this.prisma as any).campaignPlan.findMany({
        where: { organizationId, status: "published", ...(rule.campaignPlanId ? { id: rule.campaignPlanId } : {}) },
      });
      for (const plan of plans) {
        if (!plan.externalCampaignId) continue;
        const metrics = await this.campaignMetrics(organizationId, plan.externalCampaignId, rule.windowDays);
        let value: number | null = null;
        let detail = "";
        if (rule.metric === "platform_cpa") { value = metrics.cpaMajor; detail = `Platform CPA ${value === null ? "n/a (no conversions)" : value.toFixed(2)} over ${rule.windowDays}d, spend ${metrics.spendMinor} minor, conversions ${metrics.conversions}`; }
        if (rule.metric === "platform_roas") { value = metrics.roas; detail = `Platform ROAS ${value === null ? "n/a" : value} over ${rule.windowDays}d`; }
        if (rule.metric === "spend_no_conversions") {
          value = metrics.conversions === 0 ? Number(metrics.spendMinor) / 100 : 0;
          detail = `Spend ${value.toFixed(2)} with ${metrics.conversions} platform conversions over ${rule.windowDays}d`;
        }
        if (rule.metric === "frequency") { value = metrics.frequency; detail = `Frequency ${value === null ? "n/a (no reach data — run a campaign sync)" : value} over ${rule.windowDays}d`; }
        if (rule.metric === "ctr_percent") { value = metrics.ctrPercent; detail = `CTR ${value === null ? "n/a" : value + "%"} over ${rule.windowDays}d`; }
        if (rule.metric === "cpm") { value = metrics.cpmMinor === null ? null : metrics.cpmMinor / 100; detail = `CPM ${value === null ? "n/a" : value.toFixed(2)} over ${rule.windowDays}d`; }
        if (rule.metric === "first_party_roas" || rule.metric === "first_party_cpa") {
          const fp = await this.firstPartyMetrics(organizationId, plan, rule.windowDays, metrics.spendMinor);
          value = rule.metric === "first_party_roas" ? fp.roas : fp.cpaMajor;
          detail = `First-party ${rule.metric === "first_party_roas" ? "ROAS" : "CPA"} ${value === null ? "n/a" : value} over ${rule.windowDays}d (credited revenue ${fp.revenueMinor} minor, ${fp.orders} orders, matched by campaign name/id)`;
        }
        let breachingAds: { adExternalId: string }[] = [];
        if (rule.metric === "month_spend") {
          const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
          const mrows = await (this.prisma as any).dailyAdMetric.findMany({
            where: { organizationId, campaignExternalId: plan.externalCampaignId, date: { gte: monthStart } }, take: 10000,
          });
          let ms = 0n;
          for (const r of mrows as any[]) if ((r.adExternalId ?? "") === "") ms += BigInt(r.spendMinor ?? 0);
          value = Number(ms) / 100;
          detail = `Month-to-date spend ${value.toFixed(2)} (campaign-level rows)`;
        }
        if (rule.metric === "ad_frequency" || rule.metric === "ad_ctr_percent") {
          const ads = await this.adMetricsForPlan(organizationId, plan.externalCampaignId, rule.windowDays);
          const field = rule.metric === "ad_frequency" ? "frequency" : "ctrPercent";
          const withData = ads.filter((x) => x[field] !== null);
          breachingAds = withData.filter((x) => evaluateThreshold(x[field]!, rule.comparator, Number(rule.threshold)));
          if (withData.length === 0) { value = null; detail = `No ad-level ${field} data (run an ad-level sync)`; }
          else if (rule.comparator === "lt") value = Math.min(...withData.map((x) => x[field]!));
          else value = Math.max(...withData.map((x) => x[field]!));
          detail = `${breachingAds.length} ad(s) breach ${rule.metric} ${rule.comparator} ${rule.threshold} over ${rule.windowDays}d`;
        }
        if (value === null) { results.push({ ruleId: rule.id, planId: plan.id, triggered: false, detail: `${detail} - not evaluated (no data)` }); continue; }
        const triggered = evaluateThreshold(value, rule.comparator, Number(rule.threshold));
        if (!triggered) { results.push({ ruleId: rule.id, planId: plan.id, triggered: false, detail }); continue; }

        // Triggered. Pause only makes sense for ACTIVE campaigns; alerts
        // are rate-limited to one per rule+plan per 24 hours.
        if (rule.action === "activate_campaign") {
          if (plan.metaStatus !== "PAUSED") {
            results.push({ ruleId: rule.id, planId: plan.id, triggered: false, detail: `${detail} - condition met but campaign is not PAUSED` });
            continue;
          }
          try {
            await this.campaigns.setMetaStatus(organizationId, actorId ?? rule.createdById, plan.id, "ACTIVE");
            await (this.prisma as any).automationRun.create({
              data: { organizationId, kind: "rule", refId: rule.id, status: "triggered", detail: `Activated plan ${plan.id}: ${detail}`, evidence: { planId: plan.id, action: "activate_campaign", metric: rule.metric, value, threshold: rule.threshold } as any },
            });
            await (this.prisma as any).automationRule.update({ where: { id: rule.id }, data: { lastTriggeredAt: new Date() } });
            results.push({ ruleId: rule.id, planId: plan.id, triggered: true, detail: `Activated: ${detail}` });
          } catch (e) {
            await (this.prisma as any).automationRun.create({
              data: { organizationId, kind: "rule", refId: rule.id, status: "error", detail: `Activate failed for plan ${plan.id}: ${e instanceof Error ? e.message : e}`, evidence: { planId: plan.id } as any },
            });
            results.push({ ruleId: rule.id, planId: plan.id, triggered: false, detail: "Activate attempt failed, see runs" });
          }
          continue;
        }
        if (rule.action === "scale_budget") {
          const cfg: any = rule.actionConfig ?? {};
          const cooldownMs = Math.max(1, Number(cfg.cooldownHours ?? 24)) * 3600 * 1000;
          if (rule.lastTriggeredAt && Date.now() - new Date(rule.lastTriggeredAt).getTime() < cooldownMs) {
            results.push({ ruleId: rule.id, planId: plan.id, triggered: false, detail: `${detail} - scale cooldown active` });
            continue;
          }
          try {
            const changes = await this.campaigns.scalePlanBudgets(organizationId, actorId ?? rule.createdById, plan.id, Number(cfg.percent ?? 0), {
              minDailyMinor: cfg.minDailyMinor !== undefined ? Number(cfg.minDailyMinor) : undefined,
              maxDailyMinor: cfg.maxDailyMinor !== undefined ? Number(cfg.maxDailyMinor) : undefined,
            });
            await (this.prisma as any).automationRun.create({
              data: { organizationId, kind: "rule", refId: rule.id, status: "triggered", detail: `Scaled budgets of plan ${plan.id} by ${cfg.percent}%: ${detail}`, evidence: { planId: plan.id, action: "scale_budget", metric: rule.metric, value, threshold: rule.threshold, changes } as any },
            });
            await (this.prisma as any).automationRule.update({ where: { id: rule.id }, data: { lastTriggeredAt: new Date() } });
            results.push({ ruleId: rule.id, planId: plan.id, triggered: true, detail: `Scaled ${changes.length} ad set(s): ${detail}` });
          } catch (e) {
            await (this.prisma as any).automationRun.create({
              data: { organizationId, kind: "rule", refId: rule.id, status: "error", detail: `Scale failed for plan ${plan.id}: ${e instanceof Error ? e.message : e}`, evidence: { planId: plan.id } as any },
            });
            results.push({ ruleId: rule.id, planId: plan.id, triggered: false, detail: "Scale attempt failed, see runs" });
          }
          continue;
        }
        if (rule.action === "pause_ad") {
          if (breachingAds.length === 0) {
            results.push({ ruleId: rule.id, planId: plan.id, triggered: false, detail: `${detail} - pause_ad needs an ad-level metric breach` });
            continue;
          }
          try {
            const adSets = await (this.prisma as any).campaignAdSet.findMany({ where: { planId: plan.id } });
            const setIds = adSets.map((s: any) => s.id);
            const localAds = await (this.prisma as any).campaignAd.findMany({ where: { adSetId: { in: setIds } } });
            const paused: string[] = [];
            for (const b of breachingAds) {
              const local = localAds.find((x: any) => x.externalAdId === b.adExternalId);
              if (!local) continue;
              await this.campaigns.setAdStatus(organizationId, actorId ?? rule.createdById, plan.id, local.id, "PAUSED");
              paused.push(b.adExternalId);
            }
            await (this.prisma as any).automationRun.create({
              data: { organizationId, kind: "rule", refId: rule.id, status: "triggered", detail: `Paused ${paused.length} ad(s) on plan ${plan.id}: ${detail}`, evidence: { planId: plan.id, metric: rule.metric, value, threshold: rule.threshold, pausedAds: paused } as any },
            });
            await (this.prisma as any).automationRule.update({ where: { id: rule.id }, data: { lastTriggeredAt: new Date() } });
            results.push({ ruleId: rule.id, planId: plan.id, triggered: true, detail: `Paused ads: ${detail}` });
          } catch (e) {
            await (this.prisma as any).automationRun.create({
              data: { organizationId, kind: "rule", refId: rule.id, status: "error", detail: `pause_ad failed for plan ${plan.id}: ${e instanceof Error ? e.message : e}`, evidence: { planId: plan.id } as any },
            });
            results.push({ ruleId: rule.id, planId: plan.id, triggered: false, detail: "pause_ad attempt failed, see runs" });
          }
          continue;
        }
        if (rule.action === "pause_campaign") {
          if (plan.metaStatus !== "ACTIVE") {
            results.push({ ruleId: rule.id, planId: plan.id, triggered: false, detail: `${detail} - condition met but campaign is not ACTIVE` });
            continue;
          }
          try {
            await this.campaigns.setMetaStatus(organizationId, actorId ?? rule.createdById, plan.id, "PAUSED");
            await (this.prisma as any).automationRun.create({
              data: { organizationId, kind: "rule", refId: rule.id, status: "triggered", detail: `Paused plan ${plan.id}: ${detail}`, evidence: { planId: plan.id, metric: rule.metric, value, threshold: rule.threshold } as any },
            });
            await (this.prisma as any).automationRule.update({ where: { id: rule.id }, data: { lastTriggeredAt: new Date() } });
            results.push({ ruleId: rule.id, planId: plan.id, triggered: true, detail: `Paused: ${detail}` });
          } catch (e) {
            await (this.prisma as any).automationRun.create({
              data: { organizationId, kind: "rule", refId: rule.id, status: "error", detail: `Pause failed for plan ${plan.id}: ${e instanceof Error ? e.message : e}`, evidence: { planId: plan.id } as any },
            });
            results.push({ ruleId: rule.id, planId: plan.id, triggered: false, detail: "Pause attempt failed, see runs" });
          }
        } else {
          const recent = await (this.prisma as any).automationRun.findMany({
            where: { organizationId, kind: "rule", refId: rule.id, status: "triggered", createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
          });
          const alreadyAlerted = recent.some((r: any) => (r.evidence as any)?.planId === plan.id && (r.evidence as any)?.action === "alert");
          if (alreadyAlerted) { results.push({ ruleId: rule.id, planId: plan.id, triggered: false, detail: "Alert already sent within 24h" }); continue; }
          await (this.prisma as any).automationRun.create({
            data: { organizationId, kind: "rule", refId: rule.id, status: "triggered", detail: `Alert for plan ${plan.id}: ${detail}`, evidence: { planId: plan.id, action: "alert", metric: rule.metric, value, threshold: rule.threshold } as any },
          });
          await (this.prisma as any).automationRule.update({ where: { id: rule.id }, data: { lastTriggeredAt: new Date() } });
          results.push({ ruleId: rule.id, planId: plan.id, triggered: true, detail: `Alert: ${detail}` });
        }
      }
    }
    return { evaluatedRules: rules.length, results };
  }

  async listRuns(organizationId: string, limit = 50) {
    return (this.prisma as any).automationRun.findMany({
      where: { organizationId }, orderBy: { createdAt: "desc" }, take: Math.min(100, limit),
    });
  }
}

function summarizeResult(result: unknown): string {
  try {
    const text = JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    return text.length > 500 ? text.slice(0, 500) + "..." : text;
  } catch {
    return "completed";
  }
}

/**
 * Referral Advanced R2: how much granted credit has expired
 * UNSPENT, FIFO over the ledger — spends and earlier expiry
 * debits consume the oldest grants first. Only ledger-tracked
 * credit can expire; pre-ledger balances are untracked by
 * design (documented in the R2 acceptance).
 */
export function computeExpiredUnspent(
  entries: { deltaMinor: bigint | number; reason: string; expiresAt?: Date | string | null; createdAt: Date | string }[],
  now: Date,
): bigint {
  const sorted = [...entries].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  let spent = 0n;
  let expiredAlready = 0n;
  const grants: { amount: bigint; expiresAt: Date | null }[] = [];
  for (const e of sorted) {
    const d = BigInt(e.deltaMinor as any);
    if (d > 0n) grants.push({ amount: d, expiresAt: e.expiresAt ? new Date(e.expiresAt) : null });
    else if (e.reason === "credit_expired") expiredAlready += -d;
    else spent += -d;
  }
  let consumed = spent + expiredAlready;
  let due = 0n;
  for (const g of grants) {
    const usedHere = consumed > g.amount ? g.amount : consumed;
    consumed -= usedHere;
    const unspent = g.amount - usedHere;
    if (unspent > 0n && g.expiresAt && g.expiresAt < now) due += unspent;
  }
  return due;
}
