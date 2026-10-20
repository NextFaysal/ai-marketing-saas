/**
 * MS8 — messaging journey presets: ready-made customer journeys
 * (trigger + waits + a REAL message template) installed through
 * the real WorkflowsService path (see
 * MessagingService.installJourneyPreset).
 *
 * EVERY preset was audited against what the workflow engine
 * actually executes — the trigger must really fire and its
 * context must let resolveRecipient find a recipient, and every
 * template variable used must be one the real context supplies
 * (sendToRecipient merges { name: recipient.name, ...context }):
 *
 *  - order_created / order_delivered events carry an orderId;
 *    enrichContext fills customerId / orderNumber / total, and
 *    resolveRecipient resolves the customer. The post-purchase
 *    and review-ask journeys can therefore really send.
 *  - cart_abandoned contexts carry contactEmail / contactPhone
 *    (+ itemsSummary / cartValue); resolveRecipient falls back
 *    to a contact-based recipient, so the SMS recovery sends
 *    when a phone exists and fails honestly when it does not.
 *  - lead_created contexts carry { leadId, name, email, phone }
 *    and resolve to the lead.
 *
 * A sixth candidate, winback_sweep (schedule trigger → send to
 * inactive customers), was DROPPED: the schedule trigger's
 * context is { date, scheduledFor, dayOfWeek } — it carries NO
 * recipient at all, so its send step could only ever fail with
 * "No recipient could be resolved". A preset that cannot run
 * is worse than none; lead_followup takes its place. (See the
 * B4 acceptance for the full audit.)
 *
 * delivered_review_ask deliberately carries NO review link: a
 * real review link needs a per-order ReviewRequest token
 * (ReviewsService.reviewLinkFor), which the order_delivered
 * workflow context does not supply — inventing a URL would be
 * fabrication, so the copy simply asks for a reply.
 */

export interface JourneyPreset {
  key: string;
  name: string;
  descriptionBn: string;
  /** One-line Bengali flow for the UI card: trigger → wait → send. */
  flow: string;
  trigger: string;
  channel: "email" | "sms";
  template: { name: string; subject?: string; body: string };
  steps: (templateId: string) => Record<string, unknown>[];
  /** MB4 (D-MB4-8): en companions of the platform-authored
   * preset content. Install picks one locale (org
   * dashboardLocale); the installed copy is merchant-owned
   * afterwards (D-MB4-5). */
  descriptionEn: string;
  flowEn: string;
  templateEn: { name: string; subject?: string; body: string };
}

/** The preset's installable content in one locale. */
export function journeyPresetForLocale(preset: JourneyPreset, locale: "bn" | "en"): {
  description: string; flow: string; template: { name: string; subject?: string; body: string };
} {
  return locale === "en"
    ? { description: preset.descriptionEn, flow: preset.flowEn, template: preset.templateEn }
    : { description: preset.descriptionBn, flow: preset.flow, template: preset.template };
}

export const JOURNEY_PRESETS: JourneyPreset[] = [
  {
    key: "post_purchase_thanks",
    name: "কেনার পর ধন্যবাদ (ইমেইল)",
    descriptionBn: "নতুন অর্ডারের ৩০ মিনিট পর ক্রেতাকে ধন্যবাদ জানিয়ে একটি ইমেইল পাঠায়।",
    flow: "অর্ডার তৈরি → ৩০ মিনিট অপেক্ষা → ধন্যবাদ ইমেইল",
    trigger: "order_created",
    channel: "email",
    template: {
      name: "Journey: অর্ডারের ধন্যবাদ (ইমেইল)",
      subject: "ধন্যবাদ, {{name}}! আপনার অর্ডার {{orderNumber}} পেয়েছি",
      body: "আসসালামু আলাইকুম {{name}},\n\nআমাদের কাছ থেকে অর্ডার করার জন্য আন্তরিক ধন্যবাদ! আপনার অর্ডার নম্বর {{orderNumber}} — আমরা শীঘ্রই এটি প্রসেস করে পাঠিয়ে দেব।\n\nকোনো প্রশ্ন থাকলে এই ইমেইলেই জবাব দিন।",
    },
      descriptionEn: "Sends a thank-you email to the buyer 30 minutes after a new order.",
    flowEn: "Order created → wait 30 minutes → thank-you email",
    templateEn: {
      name: "Journey: Order thank-you (Email)",
      subject: "Thank you, {{name}}! We received your order {{orderNumber}}",
      body: "Hello {{name}},\n\nThank you so much for ordering from us! Your order number is {{orderNumber}} — we will process and dispatch it soon.\n\nIf you have any questions, just reply to this email.",
    },
    steps: (templateId) => [
      { type: "wait", minutes: 30 },
      { type: "send_email", templateId },
    ],
  },
  {
    key: "post_purchase_thanks_sms",
    name: "কেনার পর ধন্যবাদ (SMS)",
    descriptionBn: "নতুন অর্ডারের ৩০ মিনিট পর ক্রেতাকে ধন্যবাদ জানিয়ে একটি SMS পাঠায়।",
    flow: "অর্ডার তৈরি → ৩০ মিনিট অপেক্ষা → ধন্যবাদ SMS",
    trigger: "order_created",
    channel: "sms",
    template: {
      name: "Journey: অর্ডারের ধন্যবাদ (SMS)",
      body: "ধন্যবাদ, {{name}}! আপনার অর্ডার {{orderNumber}} গ্রহণ করা হয়েছে। ডেলিভারির আপডেট শীঘ্রই পাবেন।",
    },
      descriptionEn: "Sends a thank-you SMS to the buyer 30 minutes after a new order.",
    flowEn: "Order created → wait 30 minutes → thank-you SMS",
    templateEn: {
      name: "Journey: Order thank-you (SMS)",
      body: "Thank you, {{name}}! Your order {{orderNumber}} has been received. You will get delivery updates soon.",
    },
    steps: (templateId) => [
      { type: "wait", minutes: 30 },
      { type: "send_sms", templateId },
    ],
  },
  {
    key: "delivered_review_ask",
    name: "ডেলিভারির পর রিভিউ চাওয়া (SMS)",
    descriptionBn: "অর্ডার ডেলিভারির ২৪ ঘণ্টা পর SMS-এ ক্রেতার অভিজ্ঞতা জানতে চায়। (রিভিউ লিংক নেই — প্রতি-অর্ডারের রিভিউ টোকেন workflow context-এ থাকে না, তাই সরাসরি জবাব চাওয়া হয়।)",
    flow: "অর্ডার ডেলিভারি → ২৪ ঘণ্টা অপেক্ষা → রিভিউ চাওয়া SMS",
    trigger: "order_delivered",
    channel: "sms",
    template: {
      name: "Journey: ডেলিভারির পর রিভিউ (SMS)",
      body: "আসসালামু আলাইকুম {{name}}, আপনার অর্ডার {{orderNumber}} ডেলিভারি হয়েছে। পণ্যটি কেমন লাগলো? এই নম্বরেই জবাব দিয়ে আপনার অভিজ্ঞতা জানালে আমরা কৃতজ্ঞ থাকব।",
    },
      descriptionEn: "Asks the buyer about their experience by SMS 24 hours after delivery. (No review link — a per-order review token is not in the workflow context, so a direct reply is asked for.)",
    flowEn: "Order delivered → wait 24 hours → review-ask SMS",
    templateEn: {
      name: "Journey: Post-delivery review (SMS)",
      body: "Hello {{name}}, your order {{orderNumber}} has been delivered. How did you like the product? We would be grateful if you reply to this number with your experience.",
    },
    steps: (templateId) => [
      { type: "wait", minutes: 1440 },
      { type: "send_sms", templateId },
    ],
  },
  {
    key: "cart_recovery",
    name: "কার্ট রিকভারি (SMS)",
    descriptionBn: "কার্ট ফেলে যাওয়ার ১ ঘণ্টা পর SMS পাঠিয়ে অর্ডার সম্পন্ন করতে মনে করিয়ে দেয়। ফোন নম্বর না থাকলে পাঠানো যায় না — সেটি রান লগে সৎভাবে ব্যর্থ হিসেবে দেখাবে।",
    flow: "কার্ট পরিত্যক্ত → ১ ঘণ্টা অপেক্ষা → রিকভারি SMS",
    trigger: "cart_abandoned",
    channel: "sms",
    template: {
      name: "Journey: কার্ট রিকভারি (SMS)",
      body: "{{name}}, আপনি কার্টে কিছু পণ্য রেখে গেছেন ({{itemsSummary}})। স্টক শেষ হওয়ার আগেই অর্ডারটি সম্পন্ন করুন!",
    },
      descriptionEn: "Sends an SMS 1 hour after cart abandonment reminding the buyer to complete the order. Without a phone number it cannot be sent — the run log will honestly show it as failed.",
    flowEn: "Cart abandoned → wait 1 hour → recovery SMS",
    templateEn: {
      name: "Journey: Cart recovery (SMS)",
      body: "{{name}}, you left some products in your cart ({{itemsSummary}}). Complete your order before stock runs out!",
    },
    steps: (templateId) => [
      { type: "wait", minutes: 60 },
      { type: "send_sms", templateId },
    ],
  },
  {
    key: "lead_followup",
    name: "লিড ফলো-আপ (ইমেইল)",
    descriptionBn: "নতুন লিড আসার ৩ দিন পর একটি ফলো-আপ ইমেইল পাঠায়, যাতে আগ্রহী ক্রেতা হারিয়ে না যায়।",
    flow: "নতুন লিড → ৩ দিন অপেক্ষা → ফলো-আপ ইমেইল",
    trigger: "lead_created",
    channel: "email",
    template: {
      name: "Journey: লিড ফলো-আপ (ইমেইল)",
      subject: "আপনার জিজ্ঞাসা নিয়ে ছোট্ট ফলো-আপ, {{name}}",
      body: "আসসালামু আলাইকুম {{name}},\n\nকয়েকদিন আগে আপনি আমাদের সঙ্গে যোগাযোগ করেছিলেন — কোনো সাহায্য লাগলে বা কোনো প্রশ্ন থাকলে এই ইমেইলেই জবাব দিন, আমরা যত দ্রুত সম্ভব উত্তর দেব।\n\nধন্যবাদ!",
    },
      descriptionEn: "Sends a follow-up email 3 days after a new lead arrives, so an interested buyer is not lost.",
    flowEn: "New lead → wait 3 days → follow-up email",
    templateEn: {
      name: "Journey: Lead follow-up (Email)",
      subject: "A quick follow-up on your enquiry, {{name}}",
      body: "Hello {{name}},\n\nYou contacted us a few days ago — if you need any help or have any questions, just reply to this email and we will answer as quickly as possible.\n\nThank you!",
    },
    steps: (templateId) => [
      { type: "wait", minutes: 4320 },
      { type: "send_email", templateId },
    ],
  },
  {
    // AX18: the multi-step version of cart_recovery. Step 2 is
    // the engine's issue_recovery_coupon action: it issues a
    // REAL coupon (only when the org's abandoned-coupon setting
    // is enabled — otherwise the step logs "skipped" and the
    // sequence continues) and sends THIS template with the
    // coupon lines appended by the engine. The template body
    // therefore deliberately carries NO coupon code / no
    // {{couponCode}} placeholder — the coupon step composes
    // its own message from template + issued code.
    key: "cart_recovery_3step",
    name: "কার্ট রিকভারি ৩ ধাপ (SMS)",
    descriptionBn: "কার্ট ফেলে যাওয়ার ১ ঘণ্টা পর একটি রিকভারি SMS, ২৪ ঘণ্টায় কুপনসহ আরেকটি বার্তা (কুপন সেটিং চালু থাকলে), এবং ৭২ ঘণ্টায় শেষ মনে করিয়ে দেওয়া SMS পাঠায়।",
    flow: "কার্ট পরিত্যক্ত → ১ ঘণ্টা অপেক্ষা → SMS → ২৩ ঘণ্টা অপেক্ষা → কুপনসহ SMS → ৪৮ ঘণ্টা অপেক্ষা → শেষ SMS",
    trigger: "cart_abandoned",
    channel: "sms",
    template: {
      name: "Journey: কার্ট রিকভারি ৩ ধাপ (SMS)",
      body: "{{name}}, আপনি কার্টে কিছু পণ্য রেখে গেছেন ({{itemsSummary}})। স্টক শেষ হওয়ার আগেই অর্ডারটি সম্পন্ন করুন!",
    },
      descriptionEn: "Sends a recovery SMS 1 hour after cart abandonment, another message with a coupon at 24 hours (when the coupon setting is enabled), and a final reminder SMS at 72 hours.",
    flowEn: "Cart abandoned → wait 1 hour → SMS → wait 23 hours → SMS with coupon → wait 48 hours → final SMS",
    templateEn: {
      name: "Journey: Cart recovery 3-step (SMS)",
      body: "{{name}}, you left some products in your cart ({{itemsSummary}}). Complete your order before stock runs out!",
    },
    steps: (templateId) => [
      { type: "wait", minutes: 60 },
      { type: "send_sms", templateId },
      { type: "wait", minutes: 1380 },
      { type: "issue_recovery_coupon", templateId },
      { type: "wait", minutes: 2880 },
      { type: "send_sms", templateId },
    ],
  },
];
