/**
 * Local Festival & Flash-Sale Campaign Playbook (BD Special)
 * Grounded strategic playbooks for Bangladeshi e-commerce peak seasons.
 */

export type FestivalKey =
  | "eid_ul_fitr"
  | "eid_ul_adha"
  | "pohela_boishakh"
  | "durga_puja"
  | "winter_clearance"
  | "black_friday_11_11"
  | "falgun_valentin";

export interface FestivalPhase {
  phaseNumber: number;
  name: string;
  durationLabel: string;
  focus: string;
  strategy: string;
  adAngle: string;
}

export interface FestivalAdCopyFormula {
  hook: string;
  headline: string;
  primaryText: string;
  callToAction: string;
  offerFormula: string;
}

export interface FestivalPlaybook {
  id: FestivalKey;
  name: string;
  tagline: string;
  icon: string;
  seasonBangla: string;
  typicalMonthIndex: number; // 0-11
  targetAovRange: string;
  targetNiches: string[];
  suggestedDailyBudgetBDT: number;
  budgetSplit: {
    prospectingPercent: number;
    engagementPercent: number;
    retargetingPercent: number;
  };
  courierLeadDaysOutsideDhaka: number;
  courierLeadDaysInsideDhaka: number;
  phases: FestivalPhase[];
  adCopies: FestivalAdCopyFormula[];
}

export const FESTIVAL_PLAYBOOKS: Record<FestivalKey, FestivalPlaybook> = {
  eid_ul_fitr: {
    id: "eid_ul_fitr",
    name: "ঈদ-উল-ফিতর মেগা সেল",
    tagline: "বছরের সবচেয়ে বড় ই-কমার্স উৎসব — সর্বোচ্চ অর্ডার ভলিউম ও স্কেলিং মৌসুম",
    icon: "🌙",
    seasonBangla: "রমজান ও শাওয়াল (মার্চ-এপ্রিল)",
    typicalMonthIndex: 2,
    targetAovRange: "৳১,৮০০ – ৳৪,৫০০",
    targetNiches: ["পাঞ্জাবি ও এথনিক ওয়্যার", "মহিলাদের থ্রি-পিস ও শাড়ি", "জুতা ও স্যান্ডেল", "কসমেটিকস ও স্কিনকেয়ার", "কিডস ওয়্যার"],
    suggestedDailyBudgetBDT: 2500,
    budgetSplit: {
      prospectingPercent: 50,
      engagementPercent: 20,
      retargetingPercent: 30,
    },
    courierLeadDaysOutsideDhaka: 5,
    courierLeadDaysInsideDhaka: 2,
    phases: [
      {
        phaseNumber: 1,
        name: "আর্লি বার্ড ও এক্সক্লুসিভ কালেকশন টিজার",
        durationLabel: "রমজান ১ – ১২",
        focus: "নতুন ডিজাইনের ভিডিও/রিলস, ট্র্যাফিক ও সাইজ প্রি-বুকিং",
        strategy: "আর্লি বার্ড ১০-১৫% ডিসকাউন্ট বা ফ্রি ডেলিভারি অফার দিয়ে প্রথম ধাক্কায় কাস্টমার এঙ্গেজ করুন।",
        adAngle: "ঈদের সেরা কালেকশন শেষ হওয়ার আগেই নিজের সাইজটি কনফার্ম করুন।",
      },
      {
        phaseNumber: 2,
        name: "পিক সেলস ব্লিটজ (Peak Blitz)",
        durationLabel: "রমজান ১৩ – ২১",
        focus: "ক্যাটালগ সেলস ও মেগা কনভার্সন ক্যাম্পেইন",
        strategy: "বাজেট দ্বিগুণ করুন! বান্ডেল অফার (২টি কিনলে ২০০ ছাড়) চালু করে AOV বৃদ্ধি করুন।",
        adAngle: "ঈদ স্পেশাল মেগা ছাড়! শতভাগ ক্যাশ অন ডেলিভারিতে সারাদেশে দ্রুত হোম ডেলিভারি।",
      },
      {
        phaseNumber: 3,
        name: "ঢাকার বাইরে কুরিয়ার কাট-অফ আর্জেন্সি",
        durationLabel: "রমজান ২২ – ২৫",
        focus: "ঢাকার বাইরের ক্রেতাদের জন্য লাস্ট চান্স পুশ",
        strategy: "জরুরি আর্জেন্সি অ্যাড ও SMS ব্লাস্ট — 'ঢাকার বাইরে ডেলিভারির শেষ ২৪ ঘণ্টা!'",
        adAngle: "ঈদের আগে পার্সেল হাতে পেতে আজই রাত ১২টার মধ্যে অর্ডার করুন।",
      },
      {
        phaseNumber: 4,
        name: "ঢাকা মেট্রো সেম-ডে / লাস্ট আওয়ার ডেলিভারি",
        durationLabel: "রমজান ২৬ – চাঁদ রাত",
        focus: "শুধুমাত্র ঢাকা সিটি টার্গেটেড ইনস্ট্যান্ট ডেলিভারি",
        strategy: "লোকেশন শুধু ঢাকা মেট্রো সিলেক্ট করে এক্সপ্রেস রাইডার ডেলিভারি অফার প্রমোট করুন।",
        adAngle: "চাঁদ রাতের আগেই আপনার দরজায় ডেলিভারি! এখনই অর্ডার করুন ক্যাশ অন ডেলিভারিতে।",
      },
    ],
    adCopies: [
      {
        hook: "🌙 ঈদের সেরা সাজে আপনি ও আপনার পরিবার",
        headline: "ঈদ স্পেশাল ধামাকা অফার — সীমিত স্টক! আজই অর্ডার করুন",
        primaryText: "ঈদকে সামনে রেখে আমাদের প্রিমিয়াম ঈদ কালেকশনে চলছে নিশ্চিত বিশেষ ছাড়! কোনো অগ্রিম টাকা লাগবে না, শতভাগ ক্যাশ অন ডেলিভারিতে হাতে পণ্য বুঝে পেয়ে টাকা দিন। ঈদের আগেই ডেলিভারি নিশ্চিত করতে এখুনি অর্ডার করুন।",
        callToAction: "SHOP_NOW",
        offerFormula: "ফ্ল্যাট ২০% ছাড় + ২টি অর্ডারে ফ্রি ডেলিভারি",
      },
      {
        hook: "🚨 আর মাত্র ৪৮ ঘণ্টা বাকি — ঢাকার বাইরে শেষ বুকিং!",
        headline: "ঈদের আগে ডেলিভারি পেতে আজই লাস্ট অর্ডার করুন",
        primaryText: "কুরিয়ার সার্ভিস ঈদের ৩-৪ দিন আগেই বুকিং বন্ধ করে দেয়। আপনি কি ঈদের আগে প্রডাক্ট পেতে চান? তবে আর দেরি না করে এখনই ক্যাশ অন ডেলিভারিতে অর্ডার বুক করুন। পার্সেল খুলে দেখে পেমেন্ট করার সুযোগ!",
        callToAction: "ORDER_NOW",
        offerFormula: "ফ্রি গিফট বক্স + ক্যাশ অন ডেলিভারি",
      },
    ],
  },

  eid_ul_adha: {
    id: "eid_ul_adha",
    name: "কোরবানি ঈদ ও কিচেন-হোম স্পেশাল",
    tagline: "কিচেন অ্যাপ্লায়েন্স, মাংস কাটার সরঞ্জাম, ডিপ ফ্রিজার ও ক্যাজুয়াল ট্র্যাডিশনাল সেল",
    icon: "🥩",
    seasonBangla: "জিলহজ্জ মাস (জুন-জুলাই)",
    typicalMonthIndex: 5,
    targetAovRange: "৳২,২০০ – ৳৬,৫০০",
    targetNiches: ["কিচেন নাইফ ও চপার সেট", "ব্লেন্ডার ও মিট গ্রাইন্ডার", "ডিপ ফ্রিজ ও হোম অ্যাপ্লায়েন্স", "কোরবানি স্পেশাল ট্র্যাডিশনাল পাঞ্জাবি", "মশলা ও অর্গানিক ফুড"],
    suggestedDailyBudgetBDT: 2000,
    budgetSplit: {
      prospectingPercent: 55,
      engagementPercent: 15,
      retargetingPercent: 30,
    },
    courierLeadDaysOutsideDhaka: 4,
    courierLeadDaysInsideDhaka: 2,
    phases: [
      {
        phaseNumber: 1,
        name: "প্রস্তুতি ক্যাম্পেইন",
        durationLabel: "ঈদের ১৫ – ৮ দিন আগে",
        focus: "কিচেন ও হোম অ্যাপ্লায়েন্স ভিডিও শোকেস",
        strategy: "কোরবানির প্রস্তুতির প্র্যাকটিকাল ভিডিও কনটেন্ট দিয়ে ক্রেতাদের আগ্রহী করুন।",
        adAngle: "এই কোরবানি ঈদে মাংস কাটিং ও রান্নার প্রস্তুতি সহজ করুন প্রফেশনাল কিচেন সেটে।",
      },
      {
        phaseNumber: 2,
        name: "মেগা ডিলস ও কম্বো ধামাকা",
        durationLabel: "ঈদের ৭ – ৩ দিন আগে",
        focus: "হাই AOV কম্বো প্যাকেজ কনভার্সন",
        strategy: "সম্পূর্ণ কম্বো প্যাকেজ (ছুরি + চপিং বোর্ড + শার্পনার) বান্ডেল অফারে বিক্রি করুন।",
        adAngle: "কোরবানি স্পেশাল কম্বো প্যাক — নিশ্চিত ক্যাশ অন ডেলিভারি ও মানিব্যাক গ্যারান্টি।",
      },
    ],
    adCopies: [
      {
        hook: "🥩 এই কোরবানিতে মাংস প্রসেসিং হোক সুপার ফাস্ট!",
        headline: "হেভি-ডিউটি কিচেন কম্বো সেট — কোরবানি ঈদ স্পেশাল ছাড়",
        primaryText: "জাপানিজ স্টেইনলেস স্টিলের প্রিমিয়াম নাইফ ও চপার সেট। মাংস কাটার জন্য অতুলনীয় শার্প ও দীর্ঘস্থায়ী। আজই অর্ডার করুন এবং বুঝে পেয়ে মূল্য পরিশোধ করুন।",
        callToAction: "SHOP_NOW",
        offerFormula: "কম্বোতে অতিরিক্ত ৩০০ টাকা ছাড় + ফ্রি ডেলিভারি",
      },
    ],
  },

  pohela_boishakh: {
    id: "pohela_boishakh",
    name: "পহেলা বৈশাখ ও বৈশাখী মেলা",
    tagline: "বাঙালির প্রাণের উৎসব — লাল-সাদা ফ্যাশন, হ্যান্ডিক্রাফট ও দেশীয় ঐতিহ্য",
    icon: "🪕",
    seasonBangla: "চৈত্র সংক্রান্তি ও বৈশাখ (এপ্রিলের প্রথম ২ সপ্তাহ)",
    typicalMonthIndex: 3,
    targetAovRange: "৳১,২০০ – ৳২,৮০০",
    targetNiches: ["লাল-সাদা বৈশাখী শাড়ি ও পাঞ্জাবি", "হ্যান্ডমেড জুয়েলারি ও মাটির গহনা", "ঐতিহ্যবাহী লোকশিল্প ও হোম ডেকর", "মিষ্টি ও বৈশাখী খাবারের হ্যাম্পার"],
    suggestedDailyBudgetBDT: 1500,
    budgetSplit: {
      prospectingPercent: 60,
      engagementPercent: 20,
      retargetingPercent: 20,
    },
    courierLeadDaysOutsideDhaka: 4,
    courierLeadDaysInsideDhaka: 2,
    phases: [
      {
        phaseNumber: 1,
        name: "বৈশাখী আমেজ ও ম্যাচিং কম্বো",
        durationLabel: "মার্চ ২৫ – এপ্রিল ৫",
        focus: "কাপল ও ফ্যামিলি ম্যাচিং সেট",
        strategy: "পরিবারের সবার জন্য লাল-সাদা কম্বো প্যাকেজ প্রমোট করুন।",
        adAngle: "নতুন বছরের প্রথম প্রভাতে পরিবারের সবাইকে নিয়ে বৈশাখী রঙে সাজুন।",
      },
      {
        phaseNumber: 2,
        name: "বৈশাখী মেলা ফ্ল্যাশ সেল",
        durationLabel: "এপ্রিল ৬ – ১২",
        focus: "দ্রুততম ডেলিভারি ও ক্লিয়ারেন্স",
        strategy: "লিমিটেড বৈশাখী স্টক দ্রুত শেষ করতে ক্যাশ অন ডেলিভারি পুশ দিন।",
        adAngle: "পহেলা বৈশাখের আগেই ডেলিভারি পেতে আজই কনফার্ম করুন!",
      },
    ],
    adCopies: [
      {
        hook: "শুভ নববর্ষ! বৈশাখের নতুন সাজে নতুন রূপ",
        headline: "বৈশাখী মেগা সেল — আকর্ষণীয় ডিজাইনের দেশীয় কালেকশন",
        primaryText: "১৪৩১ বরণ করে নিন প্রিমিয়াম বৈশাখী শাড়ি ও পাঞ্জাবি কালেকশনে। সুতি কাপড়ে আরামদায়ক ফিনিশিং। ক্যাশ অন ডেলিভারিতে দ্রুত ডেলিভারি সুবিধা!",
        callToAction: "SHOP_NOW",
        offerFormula: "কাপল সেটে ফ্ল্যাট ২৫% ডিসকাউন্ট",
      },
    ],
  },

  durga_puja: {
    id: "durga_puja",
    name: "শারদীয় দুর্গোৎসব ধামাকা",
    tagline: "পূজার জমকালো ফ্যাশন, প্রিমিয়াম জুয়েলারি ও গিফট হ্যাম্পার",
    icon: "🪔",
    seasonBangla: "আশ্বিন ও কার্তিক (অক্টোবর)",
    typicalMonthIndex: 9,
    targetAovRange: "৳১,৫০০ – ৳৩,৮০০",
    targetNiches: ["পূজা স্পেশাল সিল্ক ও জামদানি শাড়ি", "এক্সক্লুসিভ কুর্তি ও ফিউশন ড্রেস", "ব্রাস ও অ্যান্টিক জুয়েলারি", "পূজার লাইটিং ও হোম ডেকর"],
    suggestedDailyBudgetBDT: 1500,
    budgetSplit: {
      prospectingPercent: 50,
      engagementPercent: 20,
      retargetingPercent: 30,
    },
    courierLeadDaysOutsideDhaka: 4,
    courierLeadDaysInsideDhaka: 2,
    phases: [
      {
        phaseNumber: 1,
        name: "পূজা কালেকশন শোকেস",
        durationLabel: "মহালয়ার আগে থেকে ষষ্ঠী পর্যন্ত",
        focus: "শারদীয় নতুন ট্রেন্ড ও জুয়েলারি ম্যাচিং",
        strategy: "উৎসবের প্রতিটি দিনের জন্য আলাদা লুক ও ড্রেস সাজেশন দিন।",
        adAngle: "মহালয়া থেকে দশমী — পূজার প্রতিটি দিনে থাকুক নতুন আকর্ষণ!",
      },
    ],
    adCopies: [
      {
        hook: "শারদীয় উৎসবের রঙে নিজেকে সাজিয়ে তুলুন",
        headline: "পূজা স্পেশাল এক্সক্লুসিভ কালেকশন — সেরা অফারে কিনুন",
        primaryText: "পূজার প্রতিটি দিনকে স্মরণীয় করতে আমাদের স্পেশাল শারদীয় কালেকশন এখন লাইভ। প্রিমিয়াম কোয়ালিটি এবং শতভাগ ক্যাশ অন ডেলিভারি।",
        callToAction: "SHOP_NOW",
        offerFormula: "ফ্রি ডেলিভারি + স্পেশাল পূজা ক্যাশব্যাক",
      },
    ],
  },

  winter_clearance: {
    id: "winter_clearance",
    name: "শীতকালীন মেগা কালেকশন ও হুডি ফেস্ট",
    tagline: "হিমেল হাওয়ায় স্টাইলিশ উইন্টার ফ্যাশন, জ্যাকেট, হুডি ও স্কিনকেয়ার",
    icon: "❄️",
    seasonBangla: "কার্তিক – মাঘ (নভেম্বর-জানুয়ারি)",
    typicalMonthIndex: 11,
    targetAovRange: "৳১,২০০ – ৳৩,২০০",
    targetNiches: ["প্রিমিয়াম হুডি ও সোয়েটশার্ট", "লেদার ও উইন্ডপ্রুফ জ্যাকেট", "কাশ্মীরি শাল ও চাদর", "শীতের ময়েশ্চারাইজার ও লিপ কেয়ার", "কম্ফোর্টার ও কম্বল"],
    suggestedDailyBudgetBDT: 1800,
    budgetSplit: {
      prospectingPercent: 55,
      engagementPercent: 15,
      retargetingPercent: 30,
    },
    courierLeadDaysOutsideDhaka: 4,
    courierLeadDaysInsideDhaka: 2,
    phases: [
      {
        phaseNumber: 1,
        name: "উইন্টার ড্রপ ও প্রি-অর্ডার",
        durationLabel: "নভেম্বরের শুরু",
        focus: "ট্রেন্ডি হুডি ও জ্যাকেট লঞ্চ",
        strategy: "তরুণ প্রজন্মের জন্য কুল কালার ও ড্রপ শোল্ডার হুডি হাইলাইট করুন।",
        adAngle: "শীতের শুরুতেই নিয়ে নিন এ বছরের সবচেয়ে ট্রেন্ডি হুডি কালেকশন।",
      },
      {
        phaseNumber: 2,
        name: "কোল্ড ওয়েভ ক্লিয়ারেন্স মেগা অফার",
        durationLabel: "ডিসেম্বর – জানুয়ারির শৈত্যপ্রবাহ",
        focus: "স্টক আউট ও হাই কনভার্সন",
        strategy: "বাই ১ গেট ১ বা ২টি কিনলে বিশাল ছাড় দিয়ে দ্রুত ইনভেন্টরি টার্নওভার করুন।",
        adAngle: "তীব্র শীতে উষ্ণতা ছড়িয়ে দিতে বিশেষ উইন্টার ক্লিয়ারেন্স ডিসকাউন্ট!",
      },
    ],
    adCopies: [
      {
        hook: "❄️ শীতের কাঁপনে স্টাইলিশ উষ্ণতা!",
        headline: "উইন্টার হুডি ও জ্যাকেট ফেস্ট — ফ্ল্যাট ৩০% পর্যন্ত ছাড়",
        primaryText: "জিএসএম হাই-গ্রেড কটনে তৈরি আরামদায়ক ও এক্সক্লুসিভ হুডি কালেকশন। শীতে আপনাকে রাখবে উষ্ণ ও স্মার্ট। কোনো অগ্রিম ছাড়াই ক্যাশ অন ডেলিভারিতে অর্ডার করুন।",
        callToAction: "SHOP_NOW",
        offerFormula: "২টি হুডি অর্ডারে ২০০ টাকা সেভিং + ফ্রি ডেলিভারি",
      },
    ],
  },

  black_friday_11_11: {
    id: "black_friday_11_11",
    name: "১১.১১ ও ব্ল্যাক ফ্রাইডে সুপার সেল",
    tagline: "গ্লোবাল শপিং ডে — বছরের সর্বোচ্চ ডিসকাউন্ট, ফ্ল্যাশ ড্রপ ও গ্যাজেট ঝড়",
    icon: "🔥",
    seasonBangla: "নভেম্বরের দ্বিতীয় ও শেষ সপ্তাহ",
    typicalMonthIndex: 10,
    targetAovRange: "৳১,০০০ – ৳৫,০০০",
    targetNiches: ["স্মার্ট গ্যাজেটস ও ব্লুটুথ ইয়ারবাডস", "স্মার্টওয়াচ ও পাওয়ার ব্যাংক", "লাইফস্টাইল ও ইলেকট্রনিক্স", "ফ্যাশন ক্লিয়ারেন্স স্টক"],
    suggestedDailyBudgetBDT: 3000,
    budgetSplit: {
      prospectingPercent: 45,
      engagementPercent: 15,
      retargetingPercent: 40,
    },
    courierLeadDaysOutsideDhaka: 4,
    courierLeadDaysInsideDhaka: 2,
    phases: [
      {
        phaseNumber: 1,
        name: "১১.১১ কাউন্টডাউন ও উইশলিস্ট ড্রাইভ",
        durationLabel: "নভেম্বর ১ – ১০",
        focus: "লিড জেনারেশন ও মেসেঞ্জার সাবস্ক্রাইবার",
        strategy: "সবচেয়ে কম মূল্যের সিক্রেট ড্রপের জন্য গ্রাহকদের মেসেঞ্জারে যুক্ত করুন।",
        adAngle: "১১.১১ সুপার সেলের স্পেশাল ডিসকাউন্ট কোড পেতে এখনই উইশলিস্ট করুন।",
      },
      {
        phaseNumber: 2,
        name: "২৪-ঘণ্টা ফ্ল্যাশ সেল ও ব্ল্যাক ফ্রাইডে ম্যাডনেস",
        durationLabel: "নভেম্বর ১১ ও ব্ল্যাক ফ্রাইডে উইকএন্ড",
        focus: "সর্বোচ্চ বাজেট স্কেলিং ও ইনস্ট্যান্ট অর্ডার",
        strategy: "স্টক শেষ হয়ে যাওয়ার আর্জেন্সি তৈরি করে লাইভ ট্র্যাফিক রূপান্তর করুন।",
        adAngle: "বছরের সবচেয়ে বড় প্রাইস ড্রপ! স্টক সীমিত — দেরি করলেই মিস।",
      },
    ],
    adCopies: [
      {
        hook: "🔥 ১১.১১ মেগা সেল লাইভ! বছরের সবচেয়ে বড় প্রাইস কাট",
        headline: "ফ্ল্যাট ৫০% পর্যন্ত মেগা ডিসকাউন্ট — স্টক দ্রুত ফুরিয়ে যাচ্ছে",
        primaryText: "আর কোনো অপেক্ষা নয়! বহুল প্রতীক্ষিত ব্ল্যাক ফ্রাইডে ও ১১.১১ সুপার সেল শুরু হয়েছে। আসল কোয়ালিটি, চোখ জুড়ানো ডিসকাউন্ট এবং দ্রুত হোম ডেলিভারি!",
        callToAction: "SHOP_NOW",
        offerFormula: "বাই ১ গেট ১ অথবা ফ্ল্যাট ৫০% ক্যাশব্যাক অফার",
      },
    ],
  },

  falgun_valentin: {
    id: "falgun_valentin",
    name: "বসন্ত ও ভালোবাসা দিবস স্পেশাল",
    tagline: "পহেলা ফাল্গুন ও ভ্যালেন্টাইন — হলুদ বাসন্তী ফ্যাশন, কাপল কম্বো ও গিফট প্যাকেজ",
    icon: "🌹",
    seasonBangla: "মাঘের শেষ ও ফাল্গুন (ফেব্রুয়ারি ১০-১৪)",
    typicalMonthIndex: 1,
    targetAovRange: "৳১,৫০০ – ৳৩,৫০০",
    targetNiches: ["বাসন্তী শাড়ি ও হলুদ পাঞ্জাবি", "কাপল কম্বো ড্রেস ও ঘড়ির সেট", "পারফিউম ও প্রিমিয়াম গিফট বক্স", "চকলেট হ্যাম্পার ও পারসোনালাইজড গিফট"],
    suggestedDailyBudgetBDT: 1500,
    budgetSplit: {
      prospectingPercent: 50,
      engagementPercent: 20,
      retargetingPercent: 30,
    },
    courierLeadDaysOutsideDhaka: 4,
    courierLeadDaysInsideDhaka: 1,
    phases: [
      {
        phaseNumber: 1,
        name: "উপহার ও কম্বো বুকিং",
        durationLabel: "ফেব্রুয়ারি ১ – ১০",
        focus: "গিফট প্যাকিং ও কাপল কম্বো",
        strategy: "প্রিয়জনকে সারপ্রাইজ দেওয়ার জন্য আগেভাগে অর্ডারের সুবিধা দিন।",
        adAngle: "ভালোবাসার বিশেষ দিনে আপনার প্রিয় মানুষের মুখে হাসি ফোটাতে সেরা গিফট বক্স।",
      },
    ],
    adCopies: [
      {
        hook: "🌹 ভালোবাসার দিনে প্রিয়জনকে দিন স্পেশাল সারপ্রাইজ!",
        headline: "ফাল্গুন ও ভ্যালেন্টাইন স্পেশাল গিফট বক্স — সাথে ফ্রি গিফট কার্ড",
        primaryText: "বাসন্তী হলুদ শাড়ির ম্যাচিং কম্বো অথবা এক্সক্লুসিভ পারফিউম গিফট প্যাক। দৃষ্টিনন্দন গিফট বক্সে মোড়ানো এবং নির্দিষ্ট দিনে ডেলিভারির নিশ্চয়তা!",
        callToAction: "ORDER_NOW",
        offerFormula: "ফ্রি লাক্সারি গিফট র‍্যাপিং + ২০% ডিসকাউন্ট",
      },
    ],
  },
};

export interface CourierCutoffCalculation {
  festivalName: string;
  festivalDate: Date;
  outsideDhakaDeadline: Date;
  insideDhakaDeadline: Date;
  daysRemainingOutside: number;
  daysRemainingInside: number;
  isOutsideDeadlinePassed: boolean;
  isInsideDeadlinePassed: boolean;
  urgencyAdCopy: string;
  smsBroadcastCopy: string;
}

/** Calculate courier deadlines based on festival date */
export function calculateCourierCutoff(
  festivalName: string,
  targetFestivalDate: Date,
  leadDaysOutside = 4,
  leadDaysInside = 2,
  currentDate: Date = new Date()
): CourierCutoffCalculation {
  const fDate = new Date(targetFestivalDate);
  fDate.setHours(23, 59, 59, 999);

  const outsideDeadline = new Date(fDate);
  outsideDeadline.setDate(outsideDeadline.getDate() - leadDaysOutside);

  const insideDeadline = new Date(fDate);
  insideDeadline.setDate(insideDeadline.getDate() - leadDaysInside);

  const msPerDay = 1000 * 60 * 60 * 24;
  const daysRemainingOutside = Math.ceil((outsideDeadline.getTime() - currentDate.getTime()) / msPerDay);
  const daysRemainingInside = Math.ceil((insideDeadline.getTime() - currentDate.getTime()) / msPerDay);

  const isOutsideDeadlinePassed = daysRemainingOutside <= 0;
  const isInsideDeadlinePassed = daysRemainingInside <= 0;

  const outsideFmt = outsideDeadline.toLocaleDateString("bn-BD", {
    month: "long",
    day: "numeric",
  });

  const urgencyAdCopy = isOutsideDeadlinePassed
    ? `🚨 শুধুমাত্র ঢাকা মেট্রোর জন্য এক্সপ্রেস ডেলিভারি চলছে! ${festivalName}-এর আগেই আপনার পার্সেল ডেলিভারি পেতে এখনই অর্ডার করুন।`
    : `🚨 কুরিয়ার কাট-অফ এলার্ট! ${festivalName}-এর আগে ডেলিভারি নিশ্চিত করতে ঢাকার বাইরে শেষ অর্ডারের তারিখ ${outsideFmt} (আর মাত্র ${Math.max(1, daysRemainingOutside)} দিন বাকি)। আজই অর্ডার কনফার্ম করুন!`;

  const smsBroadcastCopy = isOutsideDeadlinePassed
    ? `[${festivalName}] ঢাকা সিটিতে ২৪ ঘণ্টায় এক্সপ্রেস ডেলিভারি চালু! শেষ মুহূর্তের অর্ডার করুন: [Link]`
    : `[${festivalName}] ঢাকার বাইরে কুরিয়ার বুকিং আর মাত্র ${Math.max(1, daysRemainingOutside)} দিন! উৎসবের আগে পার্সেল পেতে আজই অর্ডার বুক করুন: [Link]`;

  return {
    festivalName,
    festivalDate: fDate,
    outsideDhakaDeadline: outsideDeadline,
    insideDhakaDeadline: insideDeadline,
    daysRemainingOutside,
    daysRemainingInside,
    isOutsideDeadlinePassed,
    isInsideDeadlinePassed,
    urgencyAdCopy,
    smsBroadcastCopy,
  };
}

/** Generate custom festival ad copy for a product */
export function generateFestivalAdCopy(
  festivalKey: FestivalKey,
  productName: string,
  specialOffer?: string
): { headline: string; primaryText: string; callToAction: string } {
  const playbook = FESTIVAL_PLAYBOOKS[festivalKey] || FESTIVAL_PLAYBOOKS.eid_ul_fitr;
  const offer = specialOffer || "বিশেষ ধামাকা ছাড় + ক্যাশ অন ডেলিভারি";

  return {
    headline: `${playbook.icon} ${productName} — ${playbook.name} স্পেশাল অফার!`,
    primaryText: `${playbook.name} উপলক্ষে ${productName}-এ চলছে ${offer}! কোনো প্রকার অগ্রিম পেমেন্ট ছাড়াই সারা বাংলাদেশে ক্যাশ অন ডেলিভারিতে পণ্য হাতে পেয়ে চেক করে মূল্য পরিশোধ করুন। উৎসবের আগেই ডেলিভারি পেতে এখনই অর্ডার কনফার্ম করুন।`,
    callToAction: "SHOP_NOW",
  };
}
