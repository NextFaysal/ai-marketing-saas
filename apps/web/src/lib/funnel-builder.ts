/**
 * High-Converting AI Sales Funnel & Landing Page Builder Engine
 * Tailored for Bangladeshi e-commerce marketers running Facebook / TikTok / WhatsApp ads.
 */

export type FunnelPresetId = "flash_sale" | "cod_guarantee" | "premium_story" | "festival_bundle";

export interface FunnelPreset {
  id: FunnelPresetId;
  name: string;
  /** D7: English companion of `name` (bn stays the source field). */
  nameEn: string;
  badge: string;
  badgeEn: string;
  tagline: string;
  taglineEn: string;
  urgencyLevel: "high" | "medium" | "standard";
  primaryCtaText: string;
  primaryCtaTextEn: string;
  defaultHeadlineSuffix: string;
  defaultHeadlineSuffixEn: string;
  benefits: { icon: string; title: string; text: string; titleEn: string; textEn: string }[];
  faqs: { q: string; a: string; qEn: string; aEn: string }[];
  trust: {
    codText: string;
    deliveryText: string;
    returnText: string;
    codTextEn: string;
    deliveryTextEn: string;
    returnTextEn: string;
  };
}

/** D7 by-locale picker: returns a FunnelPreset view whose display
 * fields hold the active locale's copy (bn = the preset as-is;
 * en = the *En companions swapped into the bn field slots, so
 * existing consumers keep working unchanged). */
export function funnelPresetForLocale(preset: FunnelPreset, locale: "bn" | "en" = "bn"): FunnelPreset {
  if (locale !== "en") return preset;
  return {
    ...preset,
    name: preset.nameEn,
    badge: preset.badgeEn,
    tagline: preset.taglineEn,
    primaryCtaText: preset.primaryCtaTextEn,
    defaultHeadlineSuffix: preset.defaultHeadlineSuffixEn,
    benefits: preset.benefits.map((b) => ({ ...b, title: b.titleEn, text: b.textEn })),
    faqs: preset.faqs.map((f) => ({ ...f, q: f.qEn, a: f.aEn })),
    trust: {
      ...preset.trust,
      codText: preset.trust.codTextEn,
      deliveryText: preset.trust.deliveryTextEn,
      returnText: preset.trust.returnTextEn,
    },
  };
}

/** D7: the default order-bump title in both locales. */
export const FUNNEL_BUMP_TITLE = {
  bn: "স্পেশাল অ্যাড-অন / কেয়ার কিট (৩০% ছাড়ে যুক্ত করুন)",
  en: "Special add-on / care kit (add at 30% off)",
} as const;

export interface FunnelDraft {
  presetId: FunnelPresetId;
  productId: string;
  productName: string;
  priceMinor: number;
  compareAtMinor?: number;
  imageUrl?: string;
  slug: string;
  headline: string;
  ctaText: string;
  urgencyStock: number;
  benefits: { icon: string; title: string; text: string }[];
  faqs: { q: string; a: string }[];
  trust: {
    codText: string;
    deliveryText: string;
    returnText: string;
  };
  showBump: boolean;
  bumpTitle?: string;
}

export const FUNNEL_PRESETS: Record<FunnelPresetId, FunnelPreset> = {
  flash_sale: {
    id: "flash_sale",
    name: "ফ্ল্যাশ সেল ও লিমিটেড স্টক",
    nameEn: "Flash sale & limited stock",
    badge: "🔥 সর্বোচ্চ কনভার্সন",
    badgeEn: "🔥 Highest conversion",
    tagline: "জরুরি অফার, স্টক কাউন্টডাউন এবং ক্যাশ অন ডেলিভারি কম্বিনেশন",
    taglineEn: "Urgent offer, stock countdown and cash on delivery combined",
    urgencyLevel: "high",
    primaryCtaText: "🔥 অফারটি লুফে নিন - এখনই অর্ডার করুন",
    primaryCtaTextEn: "🔥 Grab the offer - order now",
    defaultHeadlineSuffix: "সীমিত সময়ের বিশেষ ধামাকা অফার! আজই অর্ডার করুন",
    defaultHeadlineSuffixEn: "A special limited-time blockbuster offer! Order today",
    benefits: [
      {
        icon: "⚡",
        title: "সীমিত স্টক মেগা ছাড়",
        titleEn: "Limited-stock mega discount",
        text: "আজকের অর্ডারে পাচ্ছেন নিশ্চিত বিশেষ ছাড় এবং দ্রুত ডেলিভারি সুবিধা।",
        textEn: "Today's orders get a guaranteed special discount and fast delivery.",
      },
      {
        icon: "📦",
        title: "১০০% প্রিমিয়াম কোয়ালিটি",
        titleEn: "100% premium quality",
        text: "প্রতিটি প্রডাক্ট অত্যন্ত সতর্কতার সাথে কোয়ালিটি চেক করে ডেলিভারি করা হয়।",
        textEn: "Every product is carefully quality-checked before delivery.",
      },
      {
        icon: "🚚",
        title: "দ্রুততম হোম ডেলিভারি",
        titleEn: "Fastest home delivery",
        text: "ঢাকা সিটিতে ২৪-৪৮ ঘণ্টা এবং ঢাকার বাইরে ২-৩ দিনে সারা বাংলাদেশে ডেলিভারি।",
        textEn: "Delivery in 24-48 hours inside Dhaka city and 2-3 days anywhere in Bangladesh.",
      },
      {
        icon: "🛡️",
        title: "হাতে পেয়ে চেক করার সুযোগ",
        titleEn: "Check it in hand before paying",
        text: "ডেলিভারি ম্যানের সামনে পার্সেল খুলে কোয়ালিটি দেখে তারপর পেমেন্ট করুন।",
        textEn: "Open the parcel in front of the delivery person, check the quality, then pay.",
      },
    ],
    faqs: [
      {
        q: "অর্ডার করার কতদিনের মধ্যে প্রডাক্ট পাবো?",
        qEn: "How soon will I get the product after ordering?",
        a: "ঢাকা মেট্রোর ভেতরে ২৪-৪৮ ঘণ্টার মধ্যে এবং ঢাকার বাইরে ২-৩ কার্যদিবসের মধ্যে পেয়ে যাবেন।",
        aEn: "Within 24-48 hours inside Dhaka metro and 2-3 working days outside Dhaka.",
      },
      {
        q: "পণ্য পছন্দ না হলে কি রিটার্ন করা যাবে?",
        qEn: "Can I return the product if I don't like it?",
        a: "হ্যাঁ, ডেলিভারি ম্যানের সামনে পার্সেল চেক করে কোনো সমস্যা মনে হলে সাথে সাথে রিটার্ন করতে পারবেন।",
        aEn: "Yes — check the parcel in front of the delivery person and return it right away if anything seems wrong.",
      },
      {
        q: "আগে কোনো টাকা দিতে হবে?",
        qEn: "Do I need to pay anything in advance?",
        a: "না! কোনো অগ্রিম টাকা লাগবে না, শতভাগ ক্যাশ অন ডেলিভারিতে পণ্য বুঝে পেয়ে টাকা দিবেন।",
        aEn: "No! No advance payment is needed — it's 100% cash on delivery, so you pay only after receiving the product.",
      },
    ],
    trust: {
      codText: "সম্পূর্ণ ক্যাশ অন ডেলিভারি — হাতে পণ্য পেয়ে চেক করে তবেই মূল্য পরিশোধ করুন।",
      codTextEn: "Full cash on delivery — receive the product, check it in hand, then pay.",
      deliveryText: "ঢাকা সিটিতে ২৪-৪৮ ঘণ্টা, সারাদেশে ২-৩ দিনের মধ্যে নিশ্চিত হোম ডেলিভারি।",
      deliveryTextEn: "Guaranteed home delivery: 24-48 hours in Dhaka city, 2-3 days nationwide.",
      returnText: "ত্রুটিপূর্ণ পণ্যে ২৪ ঘণ্টার মধ্যে সহজ এক্সচেঞ্জ ও রিটার্নের ১০০% গ্যারান্টি।",
      returnTextEn: "100% guarantee of easy exchange and return within 24 hours for defective products.",
    },
  },

  cod_guarantee: {
    id: "cod_guarantee",
    name: "১০০% ক্যাশ অন ডেলিভারি ও সেফ বাইং",
    nameEn: "100% cash on delivery & safe buying",
    badge: "🛡️ গ্রাহকের পূর্ণ আস্থা",
    badgeEn: "🛡️ Complete customer trust",
    tagline: "কোনো অগ্রিম পেমেন্ট নেই — পার্সেল খুলে দেখে নেওয়ার গ্যারান্টি",
    taglineEn: "No advance payment — guaranteed to open and check the parcel first",
    urgencyLevel: "medium",
    primaryCtaText: "🚚 ক্যাশ অন ডেলিভারিতে অর্ডার করুন",
    primaryCtaTextEn: "🚚 Order with cash on delivery",
    defaultHeadlineSuffix: "০% ঝুঁকি — দেখে বুঝে তবেই টাকা দিন",
    defaultHeadlineSuffixEn: "0% risk — check it first, then pay",
    benefits: [
      {
        icon: "💵",
        title: "কোনো অগ্রিম টাকা নয়",
        titleEn: "No advance money",
        text: "অর্ডারের জন্য অগ্রিম কোনো টাকা বা ডেলিভারি চার্জ আগে দেওয়া লাগবে না।",
        textEn: "You don't have to pay any money or delivery charge in advance for your order.",
      },
      {
        icon: "🔍",
        title: "খুলে দেখে নেওয়ার সুবিধা",
        titleEn: "Open and check before you take it",
        text: "রাইডারের সামনে পার্সেল খুলে চেক করে সন্তুষ্ট হলে টাকা পরিশোধ করবেন।",
        textEn: "Open the parcel in front of the rider, check it, and pay only if you're satisfied.",
      },
      {
        icon: "🔄",
        title: "৭ দিনের ইনস্ট্যান্ট রিপ্লেসমেন্ট",
        titleEn: "7-day instant replacement",
        text: "কোনো ডিফেক্ট বা সাইজ সমস্যা থাকলে আমরা নিজ খরচে রিপ্লেস করে দিবো।",
        textEn: "If there's any defect or size issue, we'll replace it at our own cost.",
      },
      {
        icon: "📞",
        title: "ডেডিকেটেড কাস্টমার সাপোর্ট",
        titleEn: "Dedicated customer support",
        text: "অর্ডার পরবর্তী যেকোনো প্রয়োজনে আমাদের হেল্পলাইন ২৪/৭ আপনার পাশে আছে।",
        textEn: "Our helpline is by your side 24/7 for anything you need after ordering.",
      },
    ],
    faqs: [
      {
        q: "ডেলিভারি চার্জ কত?",
        qEn: "How much is the delivery charge?",
        a: "ঢাকা সিটিতে মাত্র ৬০ টাকা এবং ঢাকার বাইরে ১২০ টাকা ডেলিভারি চার্জ প্রযোজ্য।",
        aEn: "Only 60 taka inside Dhaka city and 120 taka outside Dhaka.",
      },
      {
        q: "ছবি আর আসল প্রডাক্ট কি একই হবে?",
        qEn: "Will the real product match the photo?",
        a: "আমাদের ছবিগুলো অরিজিনাল প্রডাক্ট থেকে নেওয়া। ছবিতে যা দেখছেন, অবিকল তাই পাবেন।",
        aEn: "Our photos are taken from the original product. What you see in the photo is exactly what you'll get.",
      },
      {
        q: "অর্ডার কনফার্ম করার নিয়ম কী?",
        qEn: "How do I confirm my order?",
        a: "ফর্মটি পূরণ করে 'অর্ডার করুন' বাটনে ক্লিক করলেই আপনার অর্ডার সম্পন্ন হবে।",
        aEn: "Fill in the form and click the 'Order now' button — that's all it takes to complete your order.",
      },
    ],
    trust: {
      codText: "কোনো অগ্রিম টাকা ছাড়াই ক্যাশ অন ডেলিভারি সুবিধা।",
      codTextEn: "Cash on delivery with no advance money.",
      deliveryText: "বিশ্বস্ত কুরিয়ার পার্টনারের মাধ্যমে দ্রুত ও সুরক্ষিত হোম ডেলিভারি।",
      deliveryTextEn: "Fast, secure home delivery through trusted courier partners.",
      returnText: "পণ্য হাতে পাওয়ার পর পছন্দ না হলে সরাসরি রিটার্ন পলিসি।",
      returnTextEn: "Straightforward return policy if you don't like the product after receiving it.",
    },
  },

  premium_story: {
    id: "premium_story",
    name: "প্রিমিয়াম ব্র্যান্ড ও ফিচার শোকেস",
    nameEn: "Premium brand & feature showcase",
    badge: "💎 হাই ভ্যালু প্রডাক্ট",
    badgeEn: "💎 High-value product",
    tagline: "কোয়ালিটি, স্থায়িত্ব এবং এক্সক্লুসিভ বেনিফিটের ওপর ফোকাস",
    taglineEn: "Focused on quality, durability and exclusive benefits",
    urgencyLevel: "standard",
    primaryCtaText: "✨ এখনই অর্ডার কনফার্ম করুন",
    primaryCtaTextEn: "✨ Confirm your order now",
    defaultHeadlineSuffix: "সেরা কোয়ালিটি ও প্রিমিয়াম ফিনিশিং নিয়ে এসেছে নতুন অভিজ্ঞতা",
    defaultHeadlineSuffixEn: "Brings a new experience with the best quality and premium finishing",
    benefits: [
      {
        icon: "⭐",
        title: "টপ গ্রেড ম্যাটেরিয়াল",
        titleEn: "Top-grade material",
        text: "উন্নত মানের উপাদানে তৈরি, যা দীর্ঘদিন ব্যবহারেও নতুনের মতো উজ্জ্বল থাকবে।",
        textEn: "Made from high-quality materials that stay bright like new even after long use.",
      },
      {
        icon: "🎯",
        title: "পারফেক্ট ক্রাফটম্যানশিপ",
        titleEn: "Perfect craftsmanship",
        text: "অভিজ্ঞ কারিগরদের নিখুঁত ফিনিশিং এবং আধুনিক ডিজাইনের অপূর্ব সমন্বয়।",
        textEn: "A wonderful blend of flawless finishing by experienced craftsmen and modern design.",
      },
      {
        icon: "🏆",
        title: "সরাসরি অরিজিনাল সোর্স",
        titleEn: "Directly from the original source",
        text: "কোনো মিডলম্যান ছাড়া সরাসরি প্রস্তুতকারক থেকে সংগৃহীত হওয়ায় সেরা মূল্য।",
        textEn: "Sourced directly from the manufacturer with no middlemen, so you get the best price.",
      },
      {
        icon: "🎁",
        title: "প্রিমিয়াম গিফট বক্স প্যাকিং",
        titleEn: "Premium gift-box packing",
        text: "নিরাপদ ও দৃষ্টিনন্দন প্যাকেজিংয়ে সরাসরি আপনার দরজায় পৌঁছানো হবে।",
        textEn: "Delivered straight to your door in safe, beautiful packaging.",
      },
    ],
    faqs: [
      {
        q: "প্রডাক্টটির ওয়ারেন্টি আছে কি?",
        qEn: "Does the product have a warranty?",
        a: "হ্যাঁ, আমরা প্রতিটি প্রডাক্টের সাথে অফিসিয়াল কোয়ালিটি গ্যারান্টি প্রদান করি।",
        aEn: "Yes, we provide an official quality guarantee with every product.",
      },
      {
        q: "প্যাকেজিং কেমন হবে?",
        qEn: "What will the packaging be like?",
        a: "সম্পূর্ণ ওয়াটারপ্রুফ এবং প্রিমিয়াম বক্সে সুরক্ষিতভাবে প্যাকেজিং করা হয়।",
        aEn: "It's packed securely in a fully waterproof premium box.",
      },
    ],
    trust: {
      codText: "শতভাগ ক্যাশ অন ডেলিভারি সুবিধা ও জেনুইন প্রডাক্টের গ্যারান্টি।",
      codTextEn: "100% cash on delivery and a genuine-product guarantee.",
      deliveryText: "দ্রুততম এয়ার ও এক্সপ্রেস ডেলিভারি সারা বাংলাদেশে।",
      deliveryTextEn: "Fastest air and express delivery across Bangladesh.",
      returnText: "অরিজিনাল কোয়ালিটি অসন্তুষ্টিতে সম্পূর্ণ মানিব্যাক নিশ্চয়তা।",
      returnTextEn: "Full money-back assurance if you're not satisfied with the original quality.",
    },
  },

  festival_bundle: {
    id: "festival_bundle",
    name: "উৎসব ও ধামাকা কম্বো অফার",
    nameEn: "Festival blockbuster combo offer",
    badge: "🎉 ঈদ / পূজা স্পেশাল",
    badgeEn: "🎉 Eid / Puja special",
    tagline: "কম্বো অফার, ফ্রি গিফট এবং বান্ডেল ডিসকাউন্ট দিয়ে বড় সাইজের অর্ডার",
    taglineEn: "Bigger orders with combo offers, free gifts and bundle discounts",
    urgencyLevel: "high",
    primaryCtaText: "🎁 কম্বো অফারটি লুফে নিন - এখনই অর্ডার করুন",
    primaryCtaTextEn: "🎁 Grab the combo offer - order now",
    defaultHeadlineSuffix: "উৎসবের আনন্দ বাড়িয়ে দিতে বিশেষ মেগা কম্বো ডিসকাউন্ট!",
    defaultHeadlineSuffixEn: "A special mega combo discount to make the festival even more joyful!",
    benefits: [
      {
        icon: "🎁",
        title: "২টি অর্ডারে বিশেষ ছাড় + ফ্রি গিফট",
        titleEn: "Special discount + free gift on 2 orders",
        text: "উৎসব উপলক্ষে ২টি বা তার বেশি অর্ডারে পাচ্ছেন স্পেশাল ক্যাশ ডিসকাউন্ট।",
        textEn: "Get a special cash discount on orders of 2 or more this festival.",
      },
      {
        icon: "🚚",
        title: "ফ্রি ডেলিভারি অফার",
        titleEn: "Free delivery offer",
        text: "কম্বো প্যাকেজ অর্ডারে থাকছে সম্পূর্ণ ফ্রি হোম ডেলিভারি সুবিধা।",
        textEn: "Combo package orders come with completely free home delivery.",
      },
      {
        icon: "✨",
        title: "উৎসবের এক্সক্লুসিভ কালেকশন",
        titleEn: "Exclusive festival collection",
        text: "লিমিটেড ফেস্টিভ্যাল এডিশন, যা স্টক শেষ হওয়ার আগেই বুকিং দিন।",
        textEn: "A limited festival edition — book before the stock runs out.",
      },
      {
        icon: "🤝",
        title: "ক্যাশ অন ডেলিভারি নিশ্চয়তা",
        titleEn: "Guaranteed cash on delivery",
        text: "উৎসবের মৌসুমে ঘরে বসেই ক্যাশ অন ডেলিভারিতে নিরাপদে কেনাকাটা করুন।",
        textEn: "Shop safely from home with cash on delivery this festival season.",
      },
    ],
    faqs: [
      {
        q: "উৎসবের আগেই ডেলিভারি নিশ্চিত হবে?",
        qEn: "Will delivery be guaranteed before the festival?",
        a: "হ্যাঁ, আমাদের এক্সপ্রেস ডেলিভারি টিম উৎসবের আগেই পণ্য ডেলিভারি নিশ্চিত করবে।",
        aEn: "Yes, our express delivery team will make sure the product arrives before the festival.",
      },
      {
        q: "কম্বো প্যাকেজের সাইজ বা কালার কি আলাদা নেওয়া যাবে?",
        qEn: "Can I pick different sizes or colors in the combo package?",
        a: "অবশ্যই! অর্ডার কনফার্মেশনের সময় আমাদের প্রতিনিধি কল দিয়ে সাইজ ও কালার নিশ্চিত করবে।",
        aEn: "Of course! Our representative will call during order confirmation to confirm the size and color.",
      },
    ],
    trust: {
      codText: "কোনো অগ্রিম পেমেন্ট ছাড়াই সারা বাংলাদেশে ক্যাশ অন ডেলিভারি।",
      codTextEn: "Cash on delivery across Bangladesh with no advance payment.",
      deliveryText: "উৎসবের দিনগুলোর আগেই দ্রুততম এক্সপ্রেস হোম ডেলিভারি।",
      deliveryTextEn: "Fastest express home delivery before the festival days.",
      returnText: "সহজ রিটার্ন ও সাইজ এক্সচেঞ্জ সুবিধা।",
      returnTextEn: "Easy returns and size exchanges.",
    },
  },
};

/** Generate a clean URL-friendly slug */
export function slugifyFunnelTitle(name: string): string {
  const ascii = name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = Math.random().toString(36).slice(2, 6);
  return ascii ? `${ascii}-${suffix}` : `deal-${suffix}`;
}

/** Calculate percentage savings */
export function calculateSavingsPercent(priceMinor: number, compareAtMinor?: number): number {
  if (!compareAtMinor || compareAtMinor <= priceMinor) return 0;
  return Math.round(((compareAtMinor - priceMinor) / compareAtMinor) * 100);
}

/** Build sections conforming strictly to apps/api/src/landings/sections.ts */
export function buildFunnelSections(draft: FunnelDraft): {
  type: string;
  enabled: boolean;
  order: number;
  data: Record<string, unknown>;
}[] {
  return [
    {
      type: "hero",
      enabled: true,
      order: 0,
      data: {},
    },
    {
      type: "offer",
      enabled: true,
      order: 1,
      data: {
        showBump: draft.showBump,
      },
    },
    {
      type: "benefits",
      enabled: true,
      order: 2,
      data: {
        items: draft.benefits.slice(0, 8).map((b) => ({
          icon: b.icon,
          title: b.title,
          text: b.text,
        })),
      },
    },
    {
      type: "trust",
      enabled: true,
      order: 3,
      data: {
        codText: draft.trust.codText,
        deliveryText: draft.trust.deliveryText,
        returnText: draft.trust.returnText,
      },
    },
    {
      type: "reviews",
      enabled: true,
      order: 4,
      data: {},
    },
    {
      type: "faq",
      enabled: true,
      order: 5,
      data: {
        items: draft.faqs.slice(0, 10).map((f) => ({
          q: f.q,
          a: f.a,
        })),
      },
    },
  ];
}

/** Pre-populate a complete FunnelDraft from product and preset */
export function createInitialFunnelDraft(
  product: { id: string; name: string; priceMinor: number | string; compareAtMinor?: number | string | null; imageUrl?: string | null },
  presetId: FunnelPresetId = "flash_sale",
  locale: "bn" | "en" = "bn"
): FunnelDraft {
  const preset = funnelPresetForLocale(FUNNEL_PRESETS[presetId], locale);
  const pPrice = Number(product.priceMinor) || 0;
  const cPrice = product.compareAtMinor ? Number(product.compareAtMinor) : undefined;
  const slug = slugifyFunnelTitle(product.name);

  return {
    presetId,
    productId: product.id,
    productName: product.name,
    priceMinor: pPrice,
    compareAtMinor: cPrice,
    imageUrl: product.imageUrl || undefined,
    slug,
    headline: `${product.name} — ${preset.defaultHeadlineSuffix}`,
    ctaText: preset.primaryCtaText,
    urgencyStock: 7,
    benefits: [...preset.benefits],
    faqs: [...preset.faqs],
    trust: { ...preset.trust },
    showBump: true,
    bumpTitle: FUNNEL_BUMP_TITLE[locale],
  };
}
