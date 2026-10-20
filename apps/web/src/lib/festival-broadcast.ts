/**
 * Bangladeshi Festival Campaign Blast & Segmented Broadcast Engine
 * Optimized for SMS Gateways (SSL Wireless, BulkSMS BD) and Meta WhatsApp Cloud API.
 */
import { FestivalKey, FESTIVAL_PLAYBOOKS } from "./festival-playbook";

export type BroadcastSegmentKey =
  | "vip_champions"
  | "inactive_60_days"
  | "repeat_cod"
  | "cart_abandoners"
  | "all_customers";

export interface BroadcastSegmentDef {
  id: BroadcastSegmentKey;
  label: string;
  /** D7: English companions of label/description/suggestedDiscount. */
  labelEn: string;
  icon: string;
  description: string;
  descriptionEn: string;
  suggestedDiscount: string;
  suggestedDiscountEn: string;
  filterCriteria: string;
}

/** D7 by-locale picker for a broadcast segment definition. */
export function broadcastSegmentForLocale(seg: BroadcastSegmentDef, locale: "bn" | "en" = "bn"): BroadcastSegmentDef {
  if (locale !== "en") return seg;
  return { ...seg, label: seg.labelEn, description: seg.descriptionEn, suggestedDiscount: seg.suggestedDiscountEn };
}

export const BROADCAST_SEGMENTS: BroadcastSegmentDef[] = [
  {
    id: "vip_champions",
    label: "🏆 VIP ও নিয়মিত ক্রেতা (Champions & Loyal)",
    icon: "🏆",
    description: "৩+ সফল অর্ডার অথবা মোট ৳৫,০০০+ কেনাকাটা করা বিশ্বস্ত ক্রেতা। সর্বোচ্চ কনভার্সন রেট।",
    suggestedDiscount: "VIP20 (২০% অতিরিক্ত ছাড়)",
    labelEn: "🏆 VIP & loyal buyers (Champions & Loyal)",
    descriptionEn: "Trusted buyers with 3+ successful orders or ৳5,000+ in total purchases. Highest conversion rate.",
    suggestedDiscountEn: "VIP20 (20% extra off)",
    filterCriteria: "Orders >= 3 OR Total Spent >= ৳5,000",
  },
  {
    id: "inactive_60_days",
    label: "💤 ৬০+ দিন নিষ্ক্রিয় ক্রেতা (Win-back Sleeping)",
    icon: "💤",
    description: "গত ৬০ দিনে কোনো অর্ডার করেননি কিন্তু পূর্বে ক্রেতা ছিলেন। পুনঃসক্রিয় করার সেরা সময়।",
    suggestedDiscount: "COMEBACK150 (৳১৫০ ফ্ল্যাট ছাড়)",
    labelEn: "💤 60+ days inactive buyers (Win-back Sleeping)",
    descriptionEn: "Past buyers who haven't ordered in the last 60 days. The best time to reactivate them.",
    suggestedDiscountEn: "COMEBACK150 (৳150 flat off)",
    filterCriteria: "Last Order > 60 days ago",
  },
  {
    id: "repeat_cod",
    label: "🚚 নিয়মিত ক্যাশ-অন-ডেলিভারি ক্রেতা (Repeat COD)",
    icon: "🚚",
    description: "১০০% সফল পার্সেল রিসিভ রেকর্ডসহ নিয়মিত ক্যাশ-অন-ডেলিভারি ক্রেতা। শূন্য রিটার্ন রিস্ক।",
    suggestedDiscount: "FREESHIP (ফ্রি হোম ডেলিভারি)",
    labelEn: "🚚 Regular cash-on-delivery buyers (Repeat COD)",
    descriptionEn: "Regular cash-on-delivery buyers with a 100% successful parcel-receipt record. Zero return risk.",
    suggestedDiscountEn: "FREESHIP (free home delivery)",
    filterCriteria: "COD Deliveries >= 2 AND Return Rate = 0%",
  },
  {
    id: "cart_abandoners",
    label: "🛒 ড্রপ-অফ ও কার্ট ফেলে যাওয়া ক্রেতা (Drop-offs)",
    icon: "🛒",
    description: "কার্টে বা চেকআউটে এসে অর্ডার সম্পন্ন করেননি। জরুরি সীমিত সময়ের ছাড় দিয়ে কনভার্ট করুন।",
    suggestedDiscount: "SAVE100 (৳১০০ স্পেশাল ভাউচার)",
    labelEn: "🛒 Drop-off & cart abandoners (Drop-offs)",
    descriptionEn: "Reached the cart or checkout but didn't complete the order. Convert them with an urgent limited-time discount.",
    suggestedDiscountEn: "SAVE100 (৳100 special voucher)",
    filterCriteria: "Abandoned Session in last 30 days",
  },
  {
    id: "all_customers",
    label: "👥 সকল গ্রাহক ও অডিয়েন্স (All Subscribers)",
    icon: "👥",
    description: "স্টোরের সমস্ত নিবন্ধিত ক্রেতা ও লিড। মেগা উৎসবের সূচনা বার্তা দেওয়ার জন্য উপযুক্ত।",
    suggestedDiscount: "FESTIVAL10 (১০% সাইটওয়াইড ছাড়)",
    labelEn: "👥 All customers & audience (All Subscribers)",
    descriptionEn: "All registered buyers and leads of the store. Ideal for a mega festival kickoff message.",
    suggestedDiscountEn: "FESTIVAL10 (10% sitewide off)",
    filterCriteria: "All Opted-in Contacts",
  },
];

export interface FestivalBroadcastTemplate {
  id: string;
  festivalKey: FestivalKey;
  festivalName: string;
  /** D7: English companions (bodyBn's companion is bodyEn). */
  festivalNameEn: string;
  phaseLabel: string;
  phaseLabelEn: string;
  channel: "sms" | "whatsapp" | "multi_channel";
  title: string;
  titleEn: string;
  bodyBn: string;
  bodyEn: string;
  suggestedCoupon: string;
  estimatedRoas: number;
  recommendedSegment: BroadcastSegmentKey;
}

/** D7 by-locale picker for a festival broadcast template. */
export function festivalTemplateForLocale(tpl: FestivalBroadcastTemplate, locale: "bn" | "en" = "bn"): FestivalBroadcastTemplate {
  if (locale !== "en") return tpl;
  return { ...tpl, festivalName: tpl.festivalNameEn, phaseLabel: tpl.phaseLabelEn, title: tpl.titleEn, bodyBn: tpl.bodyEn };
}

export const FESTIVAL_BROADCAST_TEMPLATES: FestivalBroadcastTemplate[] = [
  // Eid-ul-Fitr Templates
  {
    id: "eid_early_bird",
    festivalKey: "eid_ul_fitr",
    festivalName: "ঈদ-উল-ফিতর",
    phaseLabel: "আর্লি বার্ড টিজার (রমজান ১-১২)",
    channel: "whatsapp",
    title: "🌙 ঈদ এক্সক্লুসিভ কালেকশন ও আর্লি বার্ড অফার",
    bodyBn:
      "সালাম {customer_name}! 🌙 {store_name}-এ শুরু হলো এই বছরের সবচেয়ে প্রতীক্ষিত প্রিমিয়াম ঈদ কালেকশন মেলা।\n\nআর্লি বার্ড অফারে আজই আপনার পছন্দের সাইজ ও কালার প্রি-বুক করুন আর বুঝে নিন ফ্ল্যাট ১৫% ছাড়!\n🏷️ কুপন কোড: *{discount_code}*\n🚚 কোনো প্রকার অগ্রিম পেমেন্ট ছাড়া ১০০% ক্যাশ অন ডেলিভারি।\n👉 কালেকশন দেখুন: {shop_url}\n\nUnsub: বন্ধ করতে STOP লিখুন",
    festivalNameEn: "Eid-ul-Fitr",
    phaseLabelEn: "Early bird teaser (Ramadan 1-12)",
    titleEn: "🌙 Eid exclusive collection & early bird offer",
    bodyEn: "Salam {customer_name}! 🌙 The most awaited premium Eid collection fair of the year has begun at {store_name}.\n\nPre-book your favorite size and color today in the early bird offer and get a flat 15% off!\n🏷️ Coupon code: *{discount_code}*\n🚚 100% cash on delivery with no advance payment.\n👉 View the collection: {shop_url}\n\nUnsub: write STOP to opt out",
    suggestedCoupon: "EIDVIP15",
    estimatedRoas: 6.5,
    recommendedSegment: "vip_champions",
  },
  {
    id: "eid_peak_blitz",
    festivalKey: "eid_ul_fitr",
    festivalName: "ঈদ-উল-ফিতর",
    phaseLabel: "পিক সেলস ব্লিটজ (রমজান ১৩-২১)",
    channel: "sms",
    title: "🔥 ঈদ মেগা ছাড় + সারাদেশে ফ্রি ডেলিভারি",
    bodyBn:
      "[{store_name}] ঈদের সেরা সাজে আপনি! যেকোনো ২টি অর্ডারে ফ্রি ডেলিভারি + ফ্ল্যাট ২০% মেগা ছাড়। কুপন: {discount_code}। ক্যাশ অন ডেলিভারিতে অর্ডার করুন: {shop_url} বন্ধ করতে STOP লিখুন",
    festivalNameEn: "Eid-ul-Fitr",
    phaseLabelEn: "Peak sales blitz (Ramadan 13-21)",
    titleEn: "🔥 Eid mega discount + free delivery nationwide",
    bodyEn: "[{store_name}] Look your best this Eid! Free delivery + a flat 20% mega discount on any 2 orders. Coupon: {discount_code}. Order with cash on delivery: {shop_url} Write STOP to opt out",
    suggestedCoupon: "EIDMEGA20",
    estimatedRoas: 5.8,
    recommendedSegment: "all_customers",
  },
  {
    id: "eid_courier_cutoff",
    festivalKey: "eid_ul_fitr",
    festivalName: "ঈদ-উল-ফিতর",
    phaseLabel: "ঢাকার বাইরে কুরিয়ার কাট-অফ (রমজান ২২-২৫)",
    channel: "sms",
    title: "🚨 শেষ সুযোগ: ঢাকার বাইরে ঈদের ডেলিভারি বন্ধ হতে চলেছে!",
    bodyBn:
      "🚨 [{store_name}] কুরিয়ার কাট-অফ এলার্ট! ঈদের আগে ঢাকার বাইরে পার্সেল নিশ্চিত করতে আজই শেষ সুযোগ। ক্যাশ অন ডেলিভারিতে অর্ডার কনফার্ম করুন: {shop_url} বন্ধ করতে STOP লিখুন",
    festivalNameEn: "Eid-ul-Fitr",
    phaseLabelEn: "Outside-Dhaka courier cut-off (Ramadan 22-25)",
    titleEn: "🚨 Last chance: Eid delivery outside Dhaka is about to close!",
    bodyEn: "🚨 [{store_name}] Courier cut-off alert! Today is the last chance to secure your parcel outside Dhaka before Eid. Confirm your order with cash on delivery: {shop_url} Write STOP to opt out",
    suggestedCoupon: "LASTCHANCE",
    estimatedRoas: 7.2,
    recommendedSegment: "cart_abandoners",
  },
  {
    id: "eid_dhaka_express",
    festivalKey: "eid_ul_fitr",
    festivalName: "ঈদ-উল-ফিতর",
    phaseLabel: "ঢাকা মেট্রো সেম-ডে এক্সপ্রেস (চাঁদ রাত পর্যন্ত)",
    channel: "whatsapp",
    title: "⚡ ঢাকা সিটিতে ২৪ ঘণ্টায় চাঁদ রাত এক্সপ্রেস ডেলিভারি",
    bodyBn:
      "হ্যালো {customer_name}! 🌙 ঈদের কেনাকাটা কি বাকি রয়ে গেছে? চিন্তা নেই!\n\n{store_name} দিচ্ছে ঢাকা মেট্রোর ভেতরে ২৪ ঘণ্টায় সেম-ডে এক্সপ্রেস হোম ডেলিভারি। চাঁদ রাতের আগেই আপনার পণ্য হাতে পান ক্যাশ অন ডেলিভারিতে!\n🎁 সাথে থাকছে বিশেষ ঈদ উপহার।\n👉 এখনই শেষ মুহূর্তের অর্ডার করুন: {shop_url}",
    festivalNameEn: "Eid-ul-Fitr",
    phaseLabelEn: "Dhaka metro same-day express (until Chand Raat)",
    titleEn: "⚡ Chand Raat express delivery within 24 hours in Dhaka city",
    bodyEn: "Hello {customer_name}! 🌙 Still have Eid shopping left? No worries!\n\n{store_name} offers same-day express home delivery within 24 hours inside Dhaka metro. Get your product in hand before Chand Raat with cash on delivery!\n🎁 A special Eid gift is included.\n👉 Place your last-minute order now: {shop_url}",
    suggestedCoupon: "EXPRESSDHAKA",
    estimatedRoas: 8.0,
    recommendedSegment: "repeat_cod",
  },

  // Eid-ul-Adha Templates
  {
    id: "adha_knife_appliance",
    festivalKey: "eid_ul_adha",
    festivalName: "ঈদ-উল-আযহা",
    phaseLabel: "কোরবানি কিচেন ও অ্যাপ্লায়েন্স কম্বো",
    channel: "whatsapp",
    title: "🥩 কোরবানি স্পেশাল নাইফ ও চপার কম্বো ধামাকা",
    bodyBn:
      "সালাম {customer_name}! 🥩 আসন্ন কোরবানি ঈদে মাংস প্রসেসিং হোক সহজ ও ঝামেলামুক্ত।\n\n{store_name}-এর হেভি-ডিউটি স্টেইনলেস স্টিল কিচেন সেটে চলছে কোরবানি স্পেশাল ৩০০ টাকা ছাড়!\n🏷️ কুপন কোড: *{discount_code}*\n🚚 পার্সেল খুলে দেখে পেমেন্ট করার সুযোগ (ক্যাশ অন ডেলিভারি)।\n👉 আজই সংগ্রহ করুন: {shop_url}",
    festivalNameEn: "Eid-ul-Adha",
    phaseLabelEn: "Qurbani kitchen & appliance combo",
    titleEn: "🥩 Qurbani special knife & chopper combo blockbuster",
    bodyEn: "Salam {customer_name}! 🥩 Make meat processing easy and hassle-free this Qurbani Eid.\n\n{store_name}'s heavy-duty stainless steel kitchen set has a Qurbani special 300 taka off!\n🏷️ Coupon code: *{discount_code}*\n🚚 Open the parcel and check before paying (cash on delivery).\n👉 Get yours today: {shop_url}",
    suggestedCoupon: "QURBANI300",
    estimatedRoas: 5.4,
    recommendedSegment: "vip_champions",
  },

  // Pohela Boishakh Templates
  {
    id: "boishakh_red_white",
    festivalKey: "pohela_boishakh",
    festivalName: "পহেলা বৈশাখ",
    phaseLabel: "নববর্ষ বৈশাখী মেলা ও ফ্যাশন",
    channel: "sms",
    title: "🪕 শুভ নববর্ষ! বৈশাখী মেলা উপলক্ষে বিশেষ ছাড়",
    bodyBn:
      "[{store_name}] শুভ নববর্ষ ১৪৩৩! বৈশাখী আমেজে লাল-সাদা কালেকশনে চলছে ফ্ল্যাট ১৫% ছাড় ও ফ্রি ডেলিভারি। কুপন: {discount_code}। এখনই অর্ডার করুন: {shop_url} বন্ধ করতে STOP লিখুন",
    festivalNameEn: "Pohela Boishakh",
    phaseLabelEn: "New year Boishakhi fair & fashion",
    titleEn: "🪕 Happy New Year! Special discount for the Boishakhi fair",
    bodyEn: "[{store_name}] Happy New Year 1433! A flat 15% discount and free delivery on the red-and-white collection in the Boishakhi spirit. Coupon: {discount_code}. Order now: {shop_url} Write STOP to opt out",
    suggestedCoupon: "BOISHAKH15",
    estimatedRoas: 4.9,
    recommendedSegment: "all_customers",
  },

  // 11.11 & Black Friday Templates
  {
    id: "black_friday_mega",
    festivalKey: "black_friday_11_11",
    festivalName: "১১.১১ ও ব্ল্যাক ফ্রাইডে",
    phaseLabel: "বছরের সবচেয়ে বড় ফ্ল্যাশ সেল",
    channel: "whatsapp",
    title: "🔥 ১১.১১ বছরের সেরা মেগা সেল — ৫০% পর্যন্ত ছাড়!",
    bodyBn:
      "হ্যালো {customer_name}! 🔥 শুরু হলো বছরের সবচেয়ে বড় ডিসকাউন্ট মেলা — {store_name} 11.11 Mega Sale!\n\nআমাদের টপ সেলিং পণ্যে ফ্ল্যাট ৫০% পর্যন্ত অবিশ্বাস্য মূল্যছাড় + ২টি কেনাকাটায় ফ্রি ডেলিভারি!\n🏷️ মেগা কুপন: *{discount_code}*\n⏳ স্টক অত্যন্ত সীমিত, প্রথম ১০০ জন ক্রেতার জন্য বিশেষ গিফট!\n👉 ধামাকা ডিল লুফে নিন: {shop_url}",
    festivalNameEn: "11.11 & Black Friday",
    phaseLabelEn: "The biggest flash sale of the year",
    titleEn: "🔥 11.11 biggest mega sale of the year — up to 50% off!",
    bodyEn: "Hello {customer_name}! 🔥 The biggest discount fair of the year has begun — {store_name} 11.11 Mega Sale!\n\nAn unbelievable flat up-to-50% price cut on our top-selling products + free delivery on 2 purchases!\n🏷️ Mega coupon: *{discount_code}*\n⏳ Stock is extremely limited, with a special gift for the first 100 buyers!\n👉 Grab the blockbuster deal: {shop_url}",
    suggestedCoupon: "MEGA1111",
    estimatedRoas: 8.5,
    recommendedSegment: "inactive_60_days",
  },

  // Winter Clearance Templates
  {
    id: "winter_clearance_sale",
    festivalKey: "winter_clearance",
    festivalName: "উইন্টার ক্লিয়ারেন্স সেল",
    phaseLabel: "শীতের শেষ মেগা ক্লিয়ারেন্স",
    channel: "sms",
    title: "❄️ উইন্টার ক্লিয়ারেন্স সেল — সর্বোচ্চ ৬০% ছাড়",
    bodyBn:
      "[{store_name}] শীতের সেরা জ্যাকেট, হুডি ও শালের ওপর উইন্টার ক্লিয়ারেন্স সেল! স্টক থাকা পর্যন্ত বিশেষ মূল্যছাড়। কুপন: {discount_code}। আজই অর্ডার করুন: {shop_url} বন্ধ করতে STOP লিখুন",
    festivalNameEn: "Winter clearance sale",
    phaseLabelEn: "End-of-winter mega clearance",
    titleEn: "❄️ Winter clearance sale — up to 60% off",
    bodyEn: "[{store_name}] Winter clearance sale on the best jackets, hoodies and shawls of the season! Special price cuts while stock lasts. Coupon: {discount_code}. Order today: {shop_url} Write STOP to opt out",
    suggestedCoupon: "WINTERCLEAR",
    estimatedRoas: 5.2,
    recommendedSegment: "all_customers",
  },
];

export interface BlastSimulationParams {
  channel: "sms" | "whatsapp";
  audienceSize: number;
  messageText: string;
  ratePerSmsPartBdt?: number;
  ratePerWhatsAppMsgBdt?: number;
  expectedAovBdt?: number;
  estimatedConversionRatePercent?: number;
}

export interface BlastSimulationResult {
  channel: "sms" | "whatsapp";
  audienceSize: number;
  smsPartsPerMessage: number;
  costPerRecipientBdt: number;
  totalCampaignCostBdt: number;
  expectedConversions: number;
  expectedRevenueBdt: number;
  expectedNetMarginBdt: number;
  projectedRoas: number;
  hasOptOutStopWord: boolean;
  charCount: number;
}

/**
 * Calculates SMS parts based on GSM-7 English vs Unicode Bengali encoding.
 */
export function calculateSmsParts(text: string): { parts: number; isUnicode: boolean } {
  // Check if text has non-GSM7 characters (Bengali, emoji, etc.)
  const isUnicode = /[^\u0020-\u007E\n\r]/.test(text);
  const len = text.length;

  if (len === 0) return { parts: 1, isUnicode };

  if (isUnicode) {
    // Unicode: 1 part = 70 chars, multi-part = 67 chars each
    if (len <= 70) return { parts: 1, isUnicode: true };
    return { parts: Math.ceil(len / 67), isUnicode: true };
  } else {
    // GSM-7 English: 1 part = 160 chars, multi-part = 153 chars each
    if (len <= 160) return { parts: 1, isUnicode: false };
    return { parts: Math.ceil(len / 153), isUnicode: false };
  }
}

/**
 * Checks whether the message includes BTRC required opt-out stop words.
 */
export function hasOptOutStopWord(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("stop") ||
    lower.includes("unsub") ||
    lower.includes("বন্ধ করতে") ||
    lower.includes("না চাইলে")
  );
}

/**
 * Appends standard BTRC-compliant opt-out notice to a message.
 */
export function appendOptOutNotice(text: string, channel: "sms" | "whatsapp", locale: "bn" | "en" = "bn"): string {
  if (hasOptOutStopWord(text)) return text;
  const suffix = locale === "en"
    ? (channel === "sms" ? " Reply STOP to opt out" : "\n\nUnsub: Reply STOP to opt out")
    : (channel === "sms" ? " বন্ধ করতে STOP লিখুন" : "\n\nUnsub: বন্ধ করতে STOP লিখুন");
  return `${text.trim()}${suffix}`;
}

/**
 * Simulates campaign delivery budget, expected orders, GMV, and ROAS.
 */
export function simulateBroadcastBlast(params: BlastSimulationParams): BlastSimulationResult {
  const size = Math.max(0, params.audienceSize || 0);
  const text = params.messageText || "";
  const aov = Math.max(1, params.expectedAovBdt || 1500);
  const convRate = Math.max(0, params.estimatedConversionRatePercent || 2.5) / 100;

  const smsPartCalc = calculateSmsParts(text);
  const parts = smsPartCalc.parts;

  let costPerRecipient = 0;
  if (params.channel === "sms") {
    const ratePerPart = params.ratePerSmsPartBdt ?? 0.4;
    costPerRecipient = parts * ratePerPart;
  } else {
    costPerRecipient = params.ratePerWhatsAppMsgBdt ?? 0.85;
  }

  const totalCampaignCostBdt = Math.round(size * costPerRecipient);
  const expectedConversions = Math.round(size * convRate);
  const expectedRevenueBdt = Math.round(expectedConversions * aov);
  const expectedNetMarginBdt = expectedRevenueBdt - totalCampaignCostBdt;

  let projectedRoas = 0;
  if (totalCampaignCostBdt > 0) {
    projectedRoas = Math.round((expectedRevenueBdt / totalCampaignCostBdt) * 100) / 100;
  }

  return {
    channel: params.channel,
    audienceSize: size,
    smsPartsPerMessage: parts,
    costPerRecipientBdt: Math.round(costPerRecipient * 100) / 100,
    totalCampaignCostBdt,
    expectedConversions,
    expectedRevenueBdt,
    expectedNetMarginBdt,
    projectedRoas,
    hasOptOutStopWord: hasOptOutStopWord(text),
    charCount: text.length,
  };
}

/**
 * Populates dynamic template variables in campaign copy.
 */
export function interpolateFestivalTemplate(
  body: string,
  variables: {
    customerName?: string;
    storeName?: string;
    discountCode?: string;
    shopUrl?: string;
  },
  locale: "bn" | "en" = "bn"
): string {
  return body
    .replace(/\{customer_name\}/g, variables.customerName || (locale === "en" ? "Dear customer" : "সুপ্রিয় গ্রাহক"))
    .replace(/\{store_name\}/g, variables.storeName || (locale === "en" ? "Our shop" : "আমাদের শপ"))
    .replace(/\{discount_code\}/g, variables.discountCode || "EIDSPECIAL")
    .replace(/\{shop_url\}/g, variables.shopUrl || "https://yourshop.com");
}
