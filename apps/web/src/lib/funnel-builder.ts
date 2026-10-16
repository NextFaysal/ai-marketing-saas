/**
 * High-Converting AI Sales Funnel & Landing Page Builder Engine
 * Tailored for Bangladeshi e-commerce marketers running Facebook / TikTok / WhatsApp ads.
 */

export type FunnelPresetId = "flash_sale" | "cod_guarantee" | "premium_story" | "festival_bundle";

export interface FunnelPreset {
  id: FunnelPresetId;
  name: string;
  badge: string;
  tagline: string;
  urgencyLevel: "high" | "medium" | "standard";
  primaryCtaText: string;
  defaultHeadlineSuffix: string;
  benefits: { icon: string; title: string; text: string }[];
  faqs: { q: string; a: string }[];
  trust: {
    codText: string;
    deliveryText: string;
    returnText: string;
  };
}

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
    badge: "🔥 সর্বোচ্চ কনভার্সন",
    tagline: "জরুরি অফার, স্টক কাউন্টডাউন এবং ক্যাশ অন ডেলিভারি কম্বিনেশন",
    urgencyLevel: "high",
    primaryCtaText: "🔥 অফারটি লুফে নিন - এখনই অর্ডার করুন",
    defaultHeadlineSuffix: "সীমিত সময়ের বিশেষ ধামাকা অফার! আজই অর্ডার করুন",
    benefits: [
      {
        icon: "⚡",
        title: "সীমিত স্টক মেগা ছাড়",
        text: "আজকের অর্ডারে পাচ্ছেন নিশ্চিত বিশেষ ছাড় এবং দ্রুত ডেলিভারি সুবিধা।",
      },
      {
        icon: "📦",
        title: "১০০% প্রিমিয়াম কোয়ালিটি",
        text: "প্রতিটি প্রডাক্ট অত্যন্ত সতর্কতার সাথে কোয়ালিটি চেক করে ডেলিভারি করা হয়।",
      },
      {
        icon: "🚚",
        title: "দ্রুততম হোম ডেলিভারি",
        text: "ঢাকা সিটিতে ২৪-৪৮ ঘণ্টা এবং ঢাকার বাইরে ২-৩ দিনে সারা বাংলাদেশে ডেলিভারি।",
      },
      {
        icon: "🛡️",
        title: "হাতে পেয়ে চেক করার সুযোগ",
        text: "ডেলিভারি ম্যানের সামনে পার্সেল খুলে কোয়ালিটি দেখে তারপর পেমেন্ট করুন।",
      },
    ],
    faqs: [
      {
        q: "অর্ডার করার কতদিনের মধ্যে প্রডাক্ট পাবো?",
        a: "ঢাকা মেট্রোর ভেতরে ২৪-৪৮ ঘণ্টার মধ্যে এবং ঢাকার বাইরে ২-৩ কার্যদিবসের মধ্যে পেয়ে যাবেন।",
      },
      {
        q: "পণ্য পছন্দ না হলে কি রিটার্ন করা যাবে?",
        a: "হ্যাঁ, ডেলিভারি ম্যানের সামনে পার্সেল চেক করে কোনো সমস্যা মনে হলে সাথে সাথে রিটার্ন করতে পারবেন।",
      },
      {
        q: "আগে কোনো টাকা দিতে হবে?",
        a: "না! কোনো অগ্রিম টাকা লাগবে না, শতভাগ ক্যাশ অন ডেলিভারিতে পণ্য বুঝে পেয়ে টাকা দিবেন।",
      },
    ],
    trust: {
      codText: "সম্পূর্ণ ক্যাশ অন ডেলিভারি — হাতে পণ্য পেয়ে চেক করে তবেই মূল্য পরিশোধ করুন।",
      deliveryText: "ঢাকা সিটিতে ২৪-৪৮ ঘণ্টা, সারাদেশে ২-৩ দিনের মধ্যে নিশ্চিত হোম ডেলিভারি।",
      returnText: "ত্রুটিপূর্ণ পণ্যে ২৪ ঘণ্টার মধ্যে সহজ এক্সচেঞ্জ ও রিটার্নের ১০০% গ্যারান্টি।",
    },
  },

  cod_guarantee: {
    id: "cod_guarantee",
    name: "১০০% ক্যাশ অন ডেলিভারি ও সেফ বাইং",
    badge: "🛡️ গ্রাহকের পূর্ণ আস্থা",
    tagline: "কোনো অগ্রিম পেমেন্ট নেই — পার্সেল খুলে দেখে নেওয়ার গ্যারান্টি",
    urgencyLevel: "medium",
    primaryCtaText: "🚚 ক্যাশ অন ডেলিভারিতে অর্ডার করুন",
    defaultHeadlineSuffix: "০% ঝুঁকি — দেখে বুঝে তবেই টাকা দিন",
    benefits: [
      {
        icon: "💵",
        title: "কোনো অগ্রিম টাকা নয়",
        text: "অর্ডারের জন্য অগ্রিম কোনো টাকা বা ডেলিভারি চার্জ আগে দেওয়া লাগবে না।",
      },
      {
        icon: "🔍",
        title: "খুলে দেখে নেওয়ার সুবিধা",
        text: "রাইডারের সামনে পার্সেল খুলে চেক করে সন্তুষ্ট হলে টাকা পরিশোধ করবেন।",
      },
      {
        icon: "🔄",
        title: "৭ দিনের ইনস্ট্যান্ট রিপ্লেসমেন্ট",
        text: "কোনো ডিফেক্ট বা সাইজ সমস্যা থাকলে আমরা নিজ খরচে রিপ্লেস করে দিবো।",
      },
      {
        icon: "📞",
        title: "ডেডিকেটেড কাস্টমার সাপোর্ট",
        text: "অর্ডার পরবর্তী যেকোনো প্রয়োজনে আমাদের হেল্পলাইন ২৪/৭ আপনার পাশে আছে।",
      },
    ],
    faqs: [
      {
        q: "ডেলিভারি চার্জ কত?",
        a: "ঢাকা সিটিতে মাত্র ৬০ টাকা এবং ঢাকার বাইরে ১২০ টাকা ডেলিভারি চার্জ প্রযোজ্য।",
      },
      {
        q: "ছবি আর আসল প্রডাক্ট কি একই হবে?",
        a: "আমাদের ছবিগুলো অরিজিনাল প্রডাক্ট থেকে নেওয়া। ছবিতে যা দেখছেন, অবিকল তাই পাবেন।",
      },
      {
        q: "অর্ডার কনফার্ম করার নিয়ম কী?",
        a: "ফর্মটি পূরণ করে 'অর্ডার করুন' বাটনে ক্লিক করলেই আপনার অর্ডার সম্পন্ন হবে।",
      },
    ],
    trust: {
      codText: "কোনো অগ্রিম টাকা ছাড়াই ক্যাশ অন ডেলিভারি সুবিধা।",
      deliveryText: "বিশ্বস্ত কুরিয়ার পার্টনারের মাধ্যমে দ্রুত ও সুরক্ষিত হোম ডেলিভারি।",
      returnText: "পণ্য হাতে পাওয়ার পর পছন্দ না হলে সরাসরি রিটার্ন পলিসি।",
    },
  },

  premium_story: {
    id: "premium_story",
    name: "প্রিমিয়াম ব্র্যান্ড ও ফিচার শোকেস",
    badge: "💎 হাই ভ্যালু প্রডাক্ট",
    tagline: "কোয়ালিটি, স্থায়িত্ব এবং এক্সক্লুসিভ বেনিফিটের ওপর ফোকাস",
    urgencyLevel: "standard",
    primaryCtaText: "✨ এখনই অর্ডার কনফার্ম করুন",
    defaultHeadlineSuffix: "সেরা কোয়ালিটি ও প্রিমিয়াম ফিনিশিং নিয়ে এসেছে নতুন অভিজ্ঞতা",
    benefits: [
      {
        icon: "⭐",
        title: "টপ গ্রেড ম্যাটেরিয়াল",
        text: "উন্নত মানের উপাদানে তৈরি, যা দীর্ঘদিন ব্যবহারেও নতুনের মতো উজ্জ্বল থাকবে।",
      },
      {
        icon: "🎯",
        title: "পারফেক্ট ক্রাফটম্যানশিপ",
        text: "অভিজ্ঞ কারিগরদের নিখুঁত ফিনিশিং এবং আধুনিক ডিজাইনের অপূর্ব সমন্বয়।",
      },
      {
        icon: "🏆",
        title: "সরাসরি অরিজিনাল সোর্স",
        text: "কোনো মিডলম্যান ছাড়া সরাসরি প্রস্তুতকারক থেকে সংগৃহীত হওয়ায় সেরা মূল্য।",
      },
      {
        icon: "🎁",
        title: "প্রিমিয়াম গিফট বক্স প্যাকিং",
        text: "নিরাপদ ও দৃষ্টিনন্দন প্যাকেজিংয়ে সরাসরি আপনার দরজায় পৌঁছানো হবে।",
      },
    ],
    faqs: [
      {
        q: "প্রডাক্টটির ওয়ারেন্টি আছে কি?",
        a: "হ্যাঁ, আমরা প্রতিটি প্রডাক্টের সাথে অফিসিয়াল কোয়ালিটি গ্যারান্টি প্রদান করি।",
      },
      {
        q: "প্যাকেজিং কেমন হবে?",
        a: "সম্পূর্ণ ওয়াটারপ্রুফ এবং প্রিমিয়াম বক্সে সুরক্ষিতভাবে প্যাকেজিং করা হয়।",
      },
    ],
    trust: {
      codText: "শতভাগ ক্যাশ অন ডেলিভারি সুবিধা ও জেনুইন প্রডাক্টের গ্যারান্টি।",
      deliveryText: "দ্রুততম এয়ার ও এক্সপ্রেস ডেলিভারি সারা বাংলাদেশে।",
      returnText: "অরিজিনাল কোয়ালিটি অসন্তুষ্টিতে সম্পূর্ণ মানিব্যাক নিশ্চয়তা।",
    },
  },

  festival_bundle: {
    id: "festival_bundle",
    name: "উৎসব ও ধামাকা কম্বো অফার",
    badge: "🎉 ঈদ / পূজা স্পেশাল",
    tagline: "কম্বো অফার, ফ্রি গিফট এবং বান্ডেল ডিসকাউন্ট দিয়ে বড় সাইজের অর্ডার",
    urgencyLevel: "high",
    primaryCtaText: "🎁 কম্বো অফারটি লুফে নিন - এখনই অর্ডার করুন",
    defaultHeadlineSuffix: "উৎসবের আনন্দ বাড়িয়ে দিতে বিশেষ মেগা কম্বো ডিসকাউন্ট!",
    benefits: [
      {
        icon: "🎁",
        title: "২টি অর্ডারে বিশেষ ছাড় + ফ্রি গিফট",
        text: "উৎসব উপলক্ষে ২টি বা তার বেশি অর্ডারে পাচ্ছেন স্পেশাল ক্যাশ ডিসকাউন্ট।",
      },
      {
        icon: "🚚",
        title: "ফ্রি ডেলিভারি অফার",
        text: "কম্বো প্যাকেজ অর্ডারে থাকছে সম্পূর্ণ ফ্রি হোম ডেলিভারি সুবিধা।",
      },
      {
        icon: "✨",
        title: "উৎসবের এক্সক্লুসিভ কালেকশন",
        text: "লিমিটেড ফেস্টিভ্যাল এডিশন, যা স্টক শেষ হওয়ার আগেই বুকিং দিন।",
      },
      {
        icon: "🤝",
        title: "ক্যাশ অন ডেলিভারি নিশ্চয়তা",
        text: "উৎসবের মৌসুমে ঘরে বসেই ক্যাশ অন ডেলিভারিতে নিরাপদে কেনাকাটা করুন।",
      },
    ],
    faqs: [
      {
        q: "উৎসবের আগেই ডেলিভারি নিশ্চিত হবে?",
        a: "হ্যাঁ, আমাদের এক্সপ্রেস ডেলিভারি টিম উৎসবের আগেই পণ্য ডেলিভারি নিশ্চিত করবে।",
      },
      {
        q: "কম্বো প্যাকেজের সাইজ বা কালার কি আলাদা নেওয়া যাবে?",
        a: "অবশ্যই! অর্ডার কনফার্মেশনের সময় আমাদের প্রতিনিধি কল দিয়ে সাইজ ও কালার নিশ্চিত করবে।",
      },
    ],
    trust: {
      codText: "কোনো অগ্রিম পেমেন্ট ছাড়াই সারা বাংলাদেশে ক্যাশ অন ডেলিভারি।",
      deliveryText: "উৎসবের দিনগুলোর আগেই দ্রুততম এক্সপ্রেস হোম ডেলিভারি।",
      returnText: "সহজ রিটার্ন ও সাইজ এক্সচেঞ্জ সুবিধা।",
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
  presetId: FunnelPresetId = "flash_sale"
): FunnelDraft {
  const preset = FUNNEL_PRESETS[presetId];
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
    bumpTitle: "স্পেশাল অ্যাড-অন / কেয়ার কিট (৩০% ছাড়ে যুক্ত করুন)",
  };
}
