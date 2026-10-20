/**
 * MX5 — messaging journey presets v2: multi-step, multi-template
 * lifecycle presets built on the MX4 journey structure (a preset
 * installs ONE Workflow with journey meta { origin: "messaging",
 * preset, exitOnPurchase } plus one REAL MessageTemplate per
 * template slot).
 *
 * The MS8 audit discipline applies unchanged (see
 * journey-presets.ts): every preset's trigger must really fire
 * and its context must let resolveRecipient
 * (workflows.service.ts) find a recipient, and every
 * {{variable}} used must be one the real context supplies
 * (sendToRecipient merges { name: recipient.name, ...context }).
 * The per-trigger variable allowlists below are that audit,
 * written down; mx5-presets.spec.ts asserts every template
 * against them.
 *
 * Trigger audit:
 *  - lead_created: the event context carries { leadId, name,
 *    email, phone }; enrichContext adds contactName /
 *    contactPhone / contactEmail / stage / source. Variables:
 *    name.
 *  - order_delivered: the event carries an orderId;
 *    enrichContext fills customerId / orderNumber / total /
 *    currency / status / source and resolveRecipient resolves
 *    the customer. Variables: name, orderNumber.
 *  - winback_due / anniversary_due (MX5): NO event carries
 *    these — WorkflowsService.scanJourneyEnrollment enrolls
 *    customers directly with context { customerId } (winback
 *    adds the customer's REAL inactiveDays, so the workflow's
 *    inactiveDays condition evaluates against a true value,
 *    the scanUnanswered precedent). resolveRecipient resolves
 *    a bare customerId, and enrichContext is not needed.
 *    Variables: name (winback templates may also use
 *    inactiveDays — a real context number).
 *  - browse_abandoned (MX5): WorkflowsService.scanBrowseAbandoned
 *    derives viewed-not-bought visitors from REAL tracking
 *    events (deriveBrowseAbandoned in tracking/abandoned-carts.ts)
 *    and enrolls with the cart context shape { visitorId,
 *    sessionKey, contactEmail, contactPhone, contactName,
 *    itemsSummary, itemsCount } — resolveRecipient's contact
 *    fallback resolves it exactly like a cart context.
 *    Variables: name, itemsSummary.
 *
 * Cart recovery is deliberately NOT duplicated here — MS8's
 * cart_recovery + cart_recovery_3step cover it and stay as-is.
 */

export interface JourneyPresetV2Template {
  /** Stable slot name; steps reference templates by slot. */
  slot: string;
  channel: "email" | "sms";
  name: string;
  subject?: string;
  body: string;
}

export interface JourneyPresetV2 {
  key: string;
  name: string;
  descriptionBn: string;
  /** One-line Bengali flow for the UI card. */
  flow: string;
  trigger: string;
  templates: JourneyPresetV2Template[];
  /** MB4 (D-MB4-8): en companions of the platform-authored
   * preset content; install picks one locale (org
   * dashboardLocale), installed copies are merchant-owned
   * afterwards (D-MB4-5). */
  descriptionEn: string;
  flowEn: string;
  templatesEn: JourneyPresetV2Template[];
  /** Build the engine steps from the created template ids, by slot. */
  steps: (ids: Record<string, string>) => Record<string, unknown>[];
  /** MX4 journey meta: exit the journey when the customer buys. */
  exitOnPurchase?: boolean;
  /** Engine conditions stored on the workflow (editable after install). */
  journeyConditions?: { field: string; op: string; value: unknown }[];
}

/**
 * The variables each trigger's REAL context supplies to a
 * template (via sendToRecipient's { name, ...context } merge).
 * Templates in this file may use ONLY these — the spec enforces
 * it so a preset can never render a fabricated/empty variable.
 */
export const PRESET_VARIABLE_ALLOWLIST: Record<string, string[]> = {
  lead_created: ["name"],
  order_delivered: ["name", "orderNumber"],
  winback_due: ["name", "inactiveDays"],
  anniversary_due: ["name"],
  browse_abandoned: ["name", "itemsSummary"],
};

/** The preset's installable content in one locale. */
export function journeyPresetV2ForLocale(preset: JourneyPresetV2, locale: "bn" | "en"): {
  description: string; flow: string; templates: JourneyPresetV2Template[];
} {
  return locale === "en"
    ? { description: preset.descriptionEn, flow: preset.flowEn, templates: preset.templatesEn }
    : { description: preset.descriptionBn, flow: preset.flow, templates: preset.templates };
}

/** The triggers a v2 preset may use — each one audited above. */
export const PRESET_V2_TRIGGERS = Object.keys(PRESET_VARIABLE_ALLOWLIST);

export const JOURNEY_PRESETS_V2: JourneyPresetV2[] = [
  {
    key: "welcome_series",
    name: "স্বাগত সিরিজ (৩টি ইমেইল)",
    descriptionBn: "নতুন লিড এলেই একটি স্বাগত ইমেইল, পরের দিন ব্যবহার-শুরুর টিপস, তার ২ দিন পর একটি অফার/জিজ্ঞাসার ইমেইল পাঠায় — মোট ৩টি আলাদা টেমপ্লেট।",
    flow: "নতুন লিড → স্বাগত ইমেইল → ১ দিন অপেক্ষা → টিপস ইমেইল → ২ দিন অপেক্ষা → অফার ইমেইল",
    trigger: "lead_created",
    templates: [
      {
        slot: "welcome", channel: "email",
        name: "Journey v2: স্বাগত (ইমেইল ১)",
        subject: "স্বাগতম, {{name}}!",
        body: "আসসালামু আলাইকুম {{name}},\n\nআমাদের সঙ্গে যোগ দেওয়ার জন্য ধন্যবাদ! আপনার আগ্রহের বিষয়ে কোনো প্রশ্ন থাকলে এই ইমেইলেই জবাব দিন — আমরা সাহায্য করতে প্রস্তুত।\n\nশুভেচ্ছান্তে,\nটিম",
      },
      {
        slot: "tips", channel: "email",
        name: "Journey v2: শুরু করার টিপস (ইমেইল ২)",
        subject: "{{name}}, শুরু করার সহজ টিপস",
        body: "আসসালামু আলাইকুম {{name}},\n\nগতকাল আমাদের সঙ্গে যোগ দিয়েছেন — শুরুটা সহজ করতে কয়েকটি টিপস:\n\n১) প্রথমে আমাদের পণ্যের তালিকা ঘুরে দেখুন, পছন্দেরটি নোট করে রাখুন।\n২) কোনো পণ্য নিয়ে দ্বিধা থাকলে জবাব দিয়ে জিজ্ঞেস করুন — দাম, ডেলিভারি, সব জানিয়ে দেব।\n৩) অর্ডারের সময় সঠিক ফোন নম্বর দিলে ডেলিভারি দ্রুত হয়।\n\nধন্যবাদ!",
      },
      {
        slot: "offer", channel: "email",
        name: "Journey v2: অফার / জিজ্ঞাসা (ইমেইল ৩)",
        subject: "{{name}}, আপনার জন্য একটি প্রশ্ন",
        body: "আসসালামু আলাইকুম {{name}},\n\nআপনি ঠিক কোন পণ্যটি খুঁজছেন, তা জানালে আমরা সেটির সর্বশেষ দাম ও স্টকের খবর জানিয়ে দিতে পারি। এই ইমেইলেই জবাব দিন — কোনো চাপ নেই, শুধু সাহায্য করার চেষ্টা।\n\nধন্যবাদ!",
      },
    ],
        descriptionEn: "Sends a welcome email when a new lead arrives, usage tips the next day, and an offer/question email 2 days later — 3 separate templates in total.",
    flowEn: "New lead → welcome email → wait 1 day → tips email → wait 2 days → offer email",
    templatesEn: [
      {
        slot: "welcome", channel: "email",
        name: "Journey v2: Welcome (Email 1)",
        subject: "Welcome, {{name}}!",
        body: "Hello {{name}},\n\nThank you for joining us! If you have any questions about what you are interested in, just reply to this email — we are ready to help.\n\nBest wishes,\nTeam",
      },
      {
        slot: "tips", channel: "email",
        name: "Journey v2: Getting-started tips (Email 2)",
        subject: "{{name}}, easy tips to get started",
        body: "Hello {{name}},\n\nYou joined us yesterday — a few tips to make starting easy:\n\n1) Browse our product list first and note the ones you like.\n2) If you are unsure about a product, reply and ask — price, delivery, everything.\n3) Giving the correct phone number at order time makes delivery faster.\n\nThank you!",
      },
      {
        slot: "offer", channel: "email",
        name: "Journey v2: Offer / question (Email 3)",
        subject: "{{name}}, a question for you",
        body: "Hello {{name}},\n\nIf you tell us exactly which product you are looking for, we can share its latest price and stock news. Just reply to this email — no pressure, we are only trying to help.\n\nThank you!",
      },
    ],
    steps: (ids) => [
      { type: "send_email", templateId: ids.welcome },
      { type: "wait", minutes: 1440 },
      { type: "send_email", templateId: ids.tips },
      { type: "wait", minutes: 2880 },
      { type: "send_email", templateId: ids.offer },
    ],
  },
  {
    key: "post_purchase_care",
    name: "ডেলিভারির পর যত্ন (২টি SMS)",
    descriptionBn: "ডেলিভারির ১ ঘণ্টা পর একটি যত্নের SMS (সব ঠিকঠাক পৌঁছেছে কিনা), তার ২ দিন পর আরেকটি SMS-এ অভিজ্ঞতা জানতে চায়। MS8-এর একক-ধাপ রিভিউ প্রিসেটের চেয়ে দীর্ঘ সংস্করণ। (রিভিউ লিংক নেই — প্রতি-অর্ডারের রিভিউ টোকেন workflow context-এ থাকে না, তাই সরাসরি জবাব চাওয়া হয়।)",
    flow: "অর্ডার ডেলিভারি → ১ ঘণ্টা অপেক্ষা → যত্নের SMS → ২ দিন অপেক্ষা → রিভিউ চাওয়া SMS",
    trigger: "order_delivered",
    templates: [
      {
        slot: "care", channel: "sms",
        name: "Journey v2: ডেলিভারির পর যত্ন (SMS)",
        body: "আসসালামু আলাইকুম {{name}}, আপনার অর্ডার {{orderNumber}} ডেলিভারি হয়েছে। সবকিছু ঠিকঠাক পেয়েছেন তো? কোনো সমস্যা থাকলে এই নম্বরেই জবাব দিন — আমরা ঠিক করে দেব।",
      },
      {
        slot: "review", channel: "sms",
        name: "Journey v2: অভিজ্ঞতা জানতে চাওয়া (SMS)",
        body: "আসসালামু আলাইকুম {{name}}, অর্ডার {{orderNumber}}-এর পণ্যটি ব্যবহার করে কেমন লাগছে? এই নম্বরেই জবাব দিয়ে আপনার অভিজ্ঞতা জানালে আমরা কৃতজ্ঞ থাকব।",
      },
    ],
        descriptionEn: "Sends a care SMS 1 hour after delivery (did everything arrive properly?), then another SMS 2 days later asking about the experience. A longer version of the MS8 single-step review preset. (No review link — a per-order review token is not in the workflow context, so a direct reply is asked for.)",
    flowEn: "Order delivered → wait 1 hour → care SMS → wait 2 days → review-ask SMS",
    templatesEn: [
      {
        slot: "care", channel: "sms",
        name: "Journey v2: Post-delivery care (SMS)",
        body: "Hello {{name}}, your order {{orderNumber}} has been delivered. Did you receive everything properly? If there is any problem, reply to this number — we will fix it.",
      },
      {
        slot: "review", channel: "sms",
        name: "Journey v2: Experience ask (SMS)",
        body: "Hello {{name}}, how are you finding the product from order {{orderNumber}}? We would be grateful if you reply to this number with your experience.",
      },
    ],
    steps: (ids) => [
      { type: "wait", minutes: 60 },
      { type: "send_sms", templateId: ids.care },
      { type: "wait", minutes: 2880 },
      { type: "send_sms", templateId: ids.review },
    ],
  },
  {
    key: "replenishment_reminder",
    name: "আবার কেনার মনে করিয়ে দেওয়া (Replenishment)",
    descriptionBn: "ডেলিভারির ২১ দিন পর একটি SMS ও আরও ৭ দিন পর একটি ইমেইলে আবার কেনার কথা মনে করিয়ে দেয়। সতর্কতা: ২১ দিন একটি নির্দিষ্ট ডিফল্ট ব্যবধান — এটি প্রতি-পণ্যের ব্যবহার/শেষ-হওয়ার তথ্য থেকে হিসাব করা নয় (এমন তথ্য সিস্টেমে নেই); নিজের পণ্যের মেয়াদ অনুযায়ী Journey সম্পাদনা করে অপেক্ষার সময় বদলে নিন। মাঝে আবার অর্ডার করলে যাত্রাটি নিজে থেকে শেষ হয়ে যায় (Exit on Purchase)।",
    flow: "অর্ডার ডেলিভারি → ২১ দিন অপেক্ষা → SMS → ৭ দিন অপেক্ষা → ইমেইল (মাঝে কিনলে যাত্রা শেষ)",
    trigger: "order_delivered",
    exitOnPurchase: true,
    templates: [
      {
        slot: "sms", channel: "sms",
        name: "Journey v2: Replenishment (SMS)",
        body: "আসসালামু আলাইকুম {{name}}, আপনার অর্ডার {{orderNumber}}-এর পণ্যটি সম্ভবত শেষের দিকে। আবার লাগলে এই নম্বরে জবাব দিলেই আমরা অর্ডারের ব্যবস্থা করে দেব।",
      },
      {
        slot: "email", channel: "email",
        name: "Journey v2: Replenishment (ইমেইল)",
        subject: "{{name}}, আবার অর্ডার করার সময় হলো?",
        body: "আসসালামু আলাইকুম {{name}},\n\nআপনার আগের অর্ডার {{orderNumber}}-এর পর বেশ কিছুদিন কেটে গেছে — পণ্যটি শেষ হয়ে থাকলে আবার অর্ডার করতে এই ইমেইলেই জবাব দিন, অথবা আমাদের দোকানে ঘুরে আসুন।\n\nধন্যবাদ!",
      },
    ],
        descriptionEn: "Reminds the buyer to buy again with an SMS 21 days after delivery and an email 7 days after that. Caution: 21 days is a fixed default interval — it is NOT calculated from per-product usage/exhaustion data (no such data exists in the system); edit the journey's waits to match your product's lifespan. If the customer orders in between, the journey ends by itself (Exit on Purchase).",
    flowEn: "Order delivered → wait 21 days → SMS → wait 7 days → email (journey ends if they buy in between)",
    templatesEn: [
      {
        slot: "sms", channel: "sms",
        name: "Journey v2: Replenishment (SMS)",
        body: "Hello {{name}}, the product from your order {{orderNumber}} is probably running low. If you need it again, just reply to this number and we will arrange the order.",
      },
      {
        slot: "email", channel: "email",
        name: "Journey v2: Replenishment (Email)",
        subject: "{{name}}, is it time to order again?",
        body: "Hello {{name}},\n\nQuite a few days have passed since your last order {{orderNumber}} — if the product has run out, reply to this email to order again, or visit our shop.\n\nThank you!",
      },
    ],
    steps: (ids) => [
      { type: "wait", minutes: 30240 },
      { type: "send_sms", templateId: ids.sms },
      { type: "wait", minutes: 10080 },
      { type: "send_email", templateId: ids.email },
    ],
  },
  {
    key: "win_back",
    name: "হারানো কাস্টমার ফিরিয়ে আনা (Win-back)",
    descriptionBn: "যেসব কাস্টমারের শেষ অর্ডারের পর নির্দিষ্ট দিন (ডিফল্ট ৬০ দিন — Journey-র শর্তে বদলানো যায়) পেরিয়ে গেছে, তাদের স্ক্যান করে খুঁজে একটি Win-back ইমেইল ও ৩ দিন পর একটি SMS পাঠায়। মাঝে আবার অর্ডার করলে যাত্রাটি নিজে থেকে শেষ হয়ে যায় (Exit on Purchase)। একই কাস্টমারকে ৯০ দিনের মধ্যে আবার এই যাত্রায় ঢোকানো হয় না।",
    flow: "স্ক্যান: শেষ অর্ডার ≥ ৬০ দিন আগে → Win-back ইমেইল → ৩ দিন অপেক্ষা → SMS (মাঝে কিনলে যাত্রা শেষ)",
    trigger: "winback_due",
    exitOnPurchase: true,
    journeyConditions: [{ field: "inactiveDays", op: "gte", value: 60 }],
    templates: [
      {
        slot: "email", channel: "email",
        name: "Journey v2: Win-back (ইমেইল)",
        subject: "{{name}}, আপনাকে মিস করছি!",
        body: "আসসালামু আলাইকুম {{name}},\n\nঅনেকদিন ধরে ({{inactiveDays}} দিন) আপনার কোনো অর্ডার পাইনি — আশা করি ভালো আছেন। আবার কিছু লাগলে এই ইমেইলেই জবাব দিন; সর্বশেষ পণ্য ও দামের খবর জানিয়ে দেব।\n\nআবার দেখা হওয়ার অপেক্ষায়,\nটিম",
      },
      {
        slot: "sms", channel: "sms",
        name: "Journey v2: Win-back (SMS)",
        body: "আসসালামু আলাইকুম {{name}}, অনেকদিন হলো আপনার অর্ডার পাইনি। আবার কিছু লাগলে এই নম্বরে জবাব দিন — সাহায্য করতে প্রস্তুত আছি।",
      },
    ],
        descriptionEn: "Scans for customers whose last order was a set number of days ago (default 60 days — changeable in the journey conditions) and sends them a win-back email and an SMS 3 days later. If the customer orders in between, the journey ends by itself (Exit on Purchase). The same customer is not re-entered into this journey within 90 days.",
    flowEn: "Scan: last order 60+ days ago → win-back email → wait 3 days → SMS (journey ends if they buy in between)",
    templatesEn: [
      {
        slot: "email", channel: "email",
        name: "Journey v2: Win-back (Email)",
        subject: "{{name}}, we miss you!",
        body: "Hello {{name}},\n\nWe have not received an order from you for a long time ({{inactiveDays}} days) — we hope you are well. If you need anything again, reply to this email; we will share the latest products and prices.\n\nHoping to see you again,\nTeam",
      },
      {
        slot: "sms", channel: "sms",
        name: "Journey v2: Win-back (SMS)",
        body: "Hello {{name}}, it has been a long time since your last order. If you need anything again, reply to this number — we are ready to help.",
      },
    ],
    steps: (ids) => [
      { type: "send_email", templateId: ids.email },
      { type: "wait", minutes: 4320 },
      { type: "send_sms", templateId: ids.sms },
    ],
  },
  {
    key: "anniversary",
    name: "কাস্টমার বার্ষিকী (Anniversary)",
    descriptionBn: "কাস্টমার রেকর্ড তৈরি হওয়ার (createdAt) মাস/দিন আবার ফিরে এলে একটি শুভেচ্ছা ইমেইল পাঠায় — অর্থাৎ এটি কাস্টমারের অ্যাকাউন্ট/প্রথম-চেনা বার্ষিকী; জন্মদিন বা অন্য কোনো বার্ষিকীর তারিখ স্কিমায় নেই। কমপক্ষে ৩০০ দিন পুরনো রেকর্ডেই পাঠানো হয়, এবং একই কাস্টমারকে ৩০০ দিনের মধ্যে আবার ঢোকানো হয় না। তারিখ মিলানো হয় Asia/Dhaka সময় অনুযায়ী (Schedule ট্রিগারের একই নিয়ম)।",
    flow: "স্ক্যান: createdAt-এর মাস/দিন আজ (Asia/Dhaka) → শুভেচ্ছা ইমেইল",
    trigger: "anniversary_due",
    exitOnPurchase: false,
    templates: [
      {
        slot: "email", channel: "email",
        name: "Journey v2: বার্ষিকী শুভেচ্ছা (ইমেইল)",
        subject: "শুভ বার্ষিকী, {{name}}!",
        body: "আসসালামু আলাইকুম {{name}},\n\nআজ আপনার আমাদের সঙ্গে যুক্ত হওয়ার বার্ষিকী — এতদিন পাশে থাকার জন্য আন্তরিক ধন্যবাদ! কোনো প্রয়োজন হলে এই ইমেইলেই জবাব দিন।\n\nশুভেচ্ছান্তে,\nটিম",
      },
    ],
        descriptionEn: "Sends a greeting email when the month/day of the customer record's creation (createdAt) comes round again — that is, the anniversary of the customer's account/first contact; no birthday or other anniversary date exists in the schema. It is sent only for records at least 300 days old, and the same customer is not re-entered within 300 days. Dates are matched in Asia/Dhaka time (the same rule as the Schedule trigger).",
    flowEn: "Scan: createdAt month/day is today (Asia/Dhaka) → greeting email",
    templatesEn: [
      {
        slot: "email", channel: "email",
        name: "Journey v2: Anniversary greeting (Email)",
        subject: "Happy anniversary, {{name}}!",
        body: "Hello {{name}},\n\nToday is the anniversary of you joining us — heartfelt thanks for staying with us all this time! If you need anything, just reply to this email.\n\nBest wishes,\nTeam",
      },
    ],
    steps: (ids) => [
      { type: "send_email", templateId: ids.email },
    ],
  },
  {
    key: "browse_abandoned",
    name: "পণ্য দেখে না-কেনা (Browse Abandoned)",
    descriptionBn: "যেসব চেনা ভিজিটর (Identify করা ইমেইল/ফোন আছে) পণ্য দেখেছেন কিন্তু কার্টে যোগ করেননি বা কেনেননি, তাদের শেষ দেখার ২৪ ঘণ্টা পর একটি ইমেইল ও ২ দিন পর একটি SMS পাঠায়। যারা কার্টে যোগ করেছেন তারা কার্ট রিকভারিতেই আছেন — এখানে তাদের আবার ধরা হয় না। অচেনা (Identify ছাড়া) ভিজিটরের কাছে পাঠানোর কোনো ঠিকানা থাকে না, তাই তাদের ধরা হয় না।",
    flow: "স্ক্যান: পণ্য দেখেছেন, কার্ট/কেনা নেই, শেষ দেখা ≥ ২৪ ঘণ্টা আগে → ইমেইল → ২ দিন অপেক্ষা → SMS",
    trigger: "browse_abandoned",
    templates: [
      {
        slot: "email", channel: "email",
        name: "Journey v2: Browse Abandoned (ইমেইল)",
        subject: "{{name}}, দেখা পণ্যগুলো এখনো আছে",
        body: "আসসালামু আলাইকুম {{name}},\n\nআপনি সম্প্রতি এই পণ্যগুলো দেখেছিলেন: {{itemsSummary}}। কোনোটি নিয়ে প্রশ্ন থাকলে বা অর্ডার করতে চাইলে এই ইমেইলেই জবাব দিন — সাহায্য করব।\n\nধন্যবাদ!",
      },
      {
        slot: "sms", channel: "sms",
        name: "Journey v2: Browse Abandoned (SMS)",
        body: "{{name}}, আপনি যে পণ্যগুলো দেখেছিলেন ({{itemsSummary}}) সেগুলো এখনো পাওয়া যাচ্ছে। অর্ডার করতে এই নম্বরে জবাব দিন।",
      },
    ],
        descriptionEn: "Sends an email 24 hours after the last view, and an SMS 2 days later, to known visitors (with an identified email/phone) who viewed products but did not add to cart or buy. Those who added to cart are in cart recovery — they are not captured here again. Unidentified visitors have no address to send to, so they are not captured.",
    flowEn: "Scan: viewed products, no cart/purchase, last view 24+ hours ago → email → wait 2 days → SMS",
    templatesEn: [
      {
        slot: "email", channel: "email",
        name: "Journey v2: Browse Abandoned (Email)",
        subject: "{{name}}, the products you viewed are still available",
        body: "Hello {{name}},\n\nYou recently viewed these products: {{itemsSummary}}. If you have questions about any of them or want to order, just reply to this email — we will help.\n\nThank you!",
      },
      {
        slot: "sms", channel: "sms",
        name: "Journey v2: Browse Abandoned (SMS)",
        body: "{{name}}, the products you viewed ({{itemsSummary}}) are still available. Reply to this number to order.",
      },
    ],
    steps: (ids) => [
      { type: "send_email", templateId: ids.email },
      { type: "wait", minutes: 2880 },
      { type: "send_sms", templateId: ids.sms },
    ],
  },
];

/**
 * Presets that are deliberately NOT built — the listing shows
 * them greyed with the reason instead of hiding them (an org
 * asking "where is the birthday journey?" gets an honest answer,
 * not silence).
 *
 * birthday: Customer has NO date-of-birth field (verified in
 * schema.prisma — firstName/lastName/email/phone/address/
 * customFields/tags/createdAt only) and Lead has none either
 * (name/phone/email/source/stage/tags/valueMinor/customFields/
 * createdAt). Both DO have a customFields Json, but its keys are
 * defined per-org by CustomFieldDefs — an org MAY have defined
 * a "dob" key, or may not, and a system preset cannot rely on a
 * key that is not a system guarantee. A birthday preset would
 * therefore fire for nobody in most orgs — a preset that cannot
 * run is worse than none (MS8 precedent).
 */
export const UNAVAILABLE_JOURNEY_PRESETS: { key: string; name: string; reasonBn: string; reasonEn: string }[] = [
  {
    key: "birthday",
    name: "জন্মদিনের শুভেচ্ছা (Birthday)",
    reasonBn: "তৈরি করা যায়নি: Customer ও Lead — কারোরই জন্মতারিখ (date of birth) ফিল্ড নেই, তাই জন্মদিন জানার কোনো নির্ভরযোগ্য উপায় সিস্টেমে নেই। কাস্টম ফিল্ডে জন্মতারিখ রাখলেও তার কী (key) প্রতিটি প্রতিষ্ঠানের নিজের বানানো — সিস্টেম-প্রিসেট তার উপর নির্ভর করতে পারে না।",
    reasonEn: "Not built: neither Customer nor Lead has a date-of-birth field, so there is no reliable way in the system to know a birthday. Even if a date of birth is kept in a custom field, its key is each organization's own creation — a system preset cannot rely on it.",
  },
];
