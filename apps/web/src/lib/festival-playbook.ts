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
  /** D7: English companions of the copy fields. */
  nameEn: string;
  durationLabel: string;
  durationLabelEn: string;
  focus: string;
  focusEn: string;
  strategy: string;
  strategyEn: string;
  adAngle: string;
  adAngleEn: string;
}

export interface FestivalAdCopyFormula {
  hook: string;
  hookEn: string;
  headline: string;
  headlineEn: string;
  primaryText: string;
  primaryTextEn: string;
  callToAction: string;
  offerFormula: string;
  offerFormulaEn: string;
}

export interface FestivalPlaybook {
  id: FestivalKey;
  name: string;
  /** D7: English companions of the copy fields. */
  nameEn: string;
  tagline: string;
  taglineEn: string;
  icon: string;
  seasonBangla: string;
  seasonEn: string;
  typicalMonthIndex: number; // 0-11
  targetAovRange: string;
  targetAovRangeEn: string;
  targetNiches: string[];
  targetNichesEn: string[];
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
    nameEn: "Eid-ul-Fitr mega sale",
    tagline: "বছরের সবচেয়ে বড় ই-কমার্স উৎসব — সর্বোচ্চ অর্ডার ভলিউম ও স্কেলিং মৌসুম",
    taglineEn: "The biggest e-commerce festival of the year — peak order volume and scaling season",
    icon: "🌙",
    seasonBangla: "রমজান ও শাওয়াল (মার্চ-এপ্রিল)",
    seasonEn: "Ramadan & Shawwal (March-April)",
    typicalMonthIndex: 2,
    targetAovRange: "৳১,৮০০ – ৳৪,৫০০",
    targetAovRangeEn: "৳1,800 – ৳4,500",
    targetNiches: ["পাঞ্জাবি ও এথনিক ওয়্যার", "মহিলাদের থ্রি-পিস ও শাড়ি", "জুতা ও স্যান্ডেল", "কসমেটিকস ও স্কিনকেয়ার", "কিডস ওয়্যার"],
    targetNichesEn: ["Panjabi & ethnic wear", "Women's three-piece & saree", "Shoes & sandals", "Cosmetics & skincare", "Kids wear"],
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
        nameEn: "Early bird & exclusive collection teaser",
        durationLabel: "রমজান ১ – ১২",
        durationLabelEn: "Ramadan 1 – 12",
        focus: "নতুন ডিজাইনের ভিডিও/রিলস, ট্র্যাফিক ও সাইজ প্রি-বুকিং",
        focusEn: "New-design videos/reels, traffic and size pre-booking",
        strategy: "আর্লি বার্ড ১০-১৫% ডিসকাউন্ট বা ফ্রি ডেলিভারি অফার দিয়ে প্রথম ধাক্কায় কাস্টমার এঙ্গেজ করুন।",
        strategyEn: "Engage customers in the first push with an early bird 10-15% discount or free delivery offer.",
        adAngle: "ঈদের সেরা কালেকশন শেষ হওয়ার আগেই নিজের সাইজটি কনফার্ম করুন।",
        adAngleEn: "Confirm your size before the best Eid collection runs out.",
      },
      {
        phaseNumber: 2,
        name: "পিক সেলস ব্লিটজ (Peak Blitz)",
        nameEn: "Peak sales blitz",
        durationLabel: "রমজান ১৩ – ২১",
        durationLabelEn: "Ramadan 13 – 21",
        focus: "ক্যাটালগ সেলস ও মেগা কনভার্সন ক্যাম্পেইন",
        focusEn: "Catalog sales & mega conversion campaigns",
        strategy: "বাজেট দ্বিগুণ করুন! বান্ডেল অফার (২টি কিনলে ২০০ ছাড়) চালু করে AOV বৃদ্ধি করুন।",
        strategyEn: "Double the budget! Run a bundle offer (200 off when buying 2) to raise AOV.",
        adAngle: "ঈদ স্পেশাল মেগা ছাড়! শতভাগ ক্যাশ অন ডেলিভারিতে সারাদেশে দ্রুত হোম ডেলিভারি।",
        adAngleEn: "Eid special mega discount! Fast home delivery nationwide with 100% cash on delivery.",
      },
      {
        phaseNumber: 3,
        name: "ঢাকার বাইরে কুরিয়ার কাট-অফ আর্জেন্সি",
        nameEn: "Outside-Dhaka courier cut-off urgency",
        durationLabel: "রমজান ২২ – ২৫",
        durationLabelEn: "Ramadan 22 – 25",
        focus: "ঢাকার বাইরের ক্রেতাদের জন্য লাস্ট চান্স পুশ",
        focusEn: "Last-chance push for buyers outside Dhaka",
        strategy: "জরুরি আর্জেন্সি অ্যাড ও SMS ব্লাস্ট — 'ঢাকার বাইরে ডেলিভারির শেষ ২৪ ঘণ্টা!'",
        strategyEn: "Urgent ads and SMS blast — 'Last 24 hours for delivery outside Dhaka!'",
        adAngle: "ঈদের আগে পার্সেল হাতে পেতে আজই রাত ১২টার মধ্যে অর্ডার করুন।",
        adAngleEn: "Order by midnight today to get your parcel in hand before Eid.",
      },
      {
        phaseNumber: 4,
        name: "ঢাকা মেট্রো সেম-ডে / লাস্ট আওয়ার ডেলিভারি",
        nameEn: "Dhaka metro same-day / last-hour delivery",
        durationLabel: "রমজান ২৬ – চাঁদ রাত",
        durationLabelEn: "Ramadan 26 – Chand Raat",
        focus: "শুধুমাত্র ঢাকা সিটি টার্গেটেড ইনস্ট্যান্ট ডেলিভারি",
        focusEn: "Instant delivery targeted at Dhaka city only",
        strategy: "লোকেশন শুধু ঢাকা মেট্রো সিলেক্ট করে এক্সপ্রেস রাইডার ডেলিভারি অফার প্রমোট করুন।",
        strategyEn: "Set the location to Dhaka metro only and promote an express rider delivery offer.",
        adAngle: "চাঁদ রাতের আগেই আপনার দরজায় ডেলিভারি! এখনই অর্ডার করুন ক্যাশ অন ডেলিভারিতে।",
        adAngleEn: "Delivery at your door before Chand Raat! Order now with cash on delivery.",
      },
    ],
    adCopies: [
      {
        hook: "🌙 ঈদের সেরা সাজে আপনি ও আপনার পরিবার",
        hookEn: "🌙 You and your family in the finest Eid look",
        headline: "ঈদ স্পেশাল ধামাকা অফার — সীমিত স্টক! আজই অর্ডার করুন",
        headlineEn: "Eid special blockbuster offer — limited stock! Order today",
        primaryText: "ঈদকে সামনে রেখে আমাদের প্রিমিয়াম ঈদ কালেকশনে চলছে নিশ্চিত বিশেষ ছাড়! কোনো অগ্রিম টাকা লাগবে না, শতভাগ ক্যাশ অন ডেলিভারিতে হাতে পণ্য বুঝে পেয়ে টাকা দিন। ঈদের আগেই ডেলিভারি নিশ্চিত করতে এখুনি অর্ডার করুন।",
        primaryTextEn: "A guaranteed special discount is running on our premium Eid collection for the festival! No advance money needed — pay only after receiving the product in hand, with 100% cash on delivery. Order right now to secure delivery before Eid.",
        callToAction: "SHOP_NOW",
        offerFormula: "ফ্ল্যাট ২০% ছাড় + ২টি অর্ডারে ফ্রি ডেলিভারি",
        offerFormulaEn: "Flat 20% off + free delivery on 2 orders",
      },
      {
        hook: "🚨 আর মাত্র ৪৮ ঘণ্টা বাকি — ঢাকার বাইরে শেষ বুকিং!",
        hookEn: "🚨 Only 48 hours left — last booking outside Dhaka!",
        headline: "ঈদের আগে ডেলিভারি পেতে আজই লাস্ট অর্ডার করুন",
        headlineEn: "Place your last order today to get delivery before Eid",
        primaryText: "কুরিয়ার সার্ভিস ঈদের ৩-৪ দিন আগেই বুকিং বন্ধ করে দেয়। আপনি কি ঈদের আগে প্রডাক্ট পেতে চান? তবে আর দেরি না করে এখনই ক্যাশ অন ডেলিভারিতে অর্ডার বুক করুন। পার্সেল খুলে দেখে পেমেন্ট করার সুযোগ!",
        primaryTextEn: "Courier services stop taking bookings 3-4 days before Eid. Want your product before Eid? Don't wait — book your order now with cash on delivery. You can open the parcel and check before paying!",
        callToAction: "ORDER_NOW",
        offerFormula: "ফ্রি গিফট বক্স + ক্যাশ অন ডেলিভারি",
        offerFormulaEn: "Free gift box + cash on delivery",
      },
    ],
  },

  eid_ul_adha: {
    id: "eid_ul_adha",
    name: "কোরবানি ঈদ ও কিচেন-হোম স্পেশাল",
    nameEn: "Qurbani Eid & kitchen-home special",
    tagline: "কিচেন অ্যাপ্লায়েন্স, মাংস কাটার সরঞ্জাম, ডিপ ফ্রিজার ও ক্যাজুয়াল ট্র্যাডিশনাল সেল",
    taglineEn: "Kitchen appliances, meat-cutting tools, deep freezers and casual traditional sales",
    icon: "🥩",
    seasonBangla: "জিলহজ্জ মাস (জুন-জুলাই)",
    seasonEn: "The month of Zilhajj (June-July)",
    typicalMonthIndex: 5,
    targetAovRange: "৳২,২০০ – ৳৬,৫০০",
    targetAovRangeEn: "৳2,200 – ৳6,500",
    targetNiches: ["কিচেন নাইফ ও চপার সেট", "ব্লেন্ডার ও মিট গ্রাইন্ডার", "ডিপ ফ্রিজ ও হোম অ্যাপ্লায়েন্স", "কোরবানি স্পেশাল ট্র্যাডিশনাল পাঞ্জাবি", "মশলা ও অর্গানিক ফুড"],
    targetNichesEn: ["Kitchen knife & chopper sets", "Blenders & meat grinders", "Deep freezers & home appliances", "Qurbani special traditional panjabi", "Spices & organic food"],
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
        nameEn: "Preparation campaign",
        durationLabel: "ঈদের ১৫ – ৮ দিন আগে",
        durationLabelEn: "15 – 8 days before Eid",
        focus: "কিচেন ও হোম অ্যাপ্লায়েন্স ভিডিও শোকেস",
        focusEn: "Kitchen & home appliance video showcase",
        strategy: "কোরবানির প্রস্তুতির প্র্যাকটিকাল ভিডিও কনটেন্ট দিয়ে ক্রেতাদের আগ্রহী করুন।",
        strategyEn: "Spark buyer interest with practical video content on Qurbani preparation.",
        adAngle: "এই কোরবানি ঈদে মাংস কাটিং ও রান্নার প্রস্তুতি সহজ করুন প্রফেশনাল কিচেন সেটে।",
        adAngleEn: "Make meat cutting and cooking prep easy this Qurbani Eid with a professional kitchen set.",
      },
      {
        phaseNumber: 2,
        name: "মেগা ডিলস ও কম্বো ধামাকা",
        nameEn: "Mega deals & combo blockbuster",
        durationLabel: "ঈদের ৭ – ৩ দিন আগে",
        durationLabelEn: "7 – 3 days before Eid",
        focus: "হাই AOV কম্বো প্যাকেজ কনভার্সন",
        focusEn: "High-AOV combo package conversion",
        strategy: "সম্পূর্ণ কম্বো প্যাকেজ (ছুরি + চপিং বোর্ড + শার্পনার) বান্ডেল অফারে বিক্রি করুন।",
        strategyEn: "Sell the full combo package (knife + chopping board + sharpener) as a bundle offer.",
        adAngle: "কোরবানি স্পেশাল কম্বো প্যাক — নিশ্চিত ক্যাশ অন ডেলিভারি ও মানিব্যাক গ্যারান্টি।",
        adAngleEn: "Qurbani special combo pack — guaranteed cash on delivery and money-back guarantee.",
      },
    ],
    adCopies: [
      {
        hook: "🥩 এই কোরবানিতে মাংস প্রসেসিং হোক সুপার ফাস্ট!",
        hookEn: "🥩 Super-fast meat processing this Qurbani!",
        headline: "হেভি-ডিউটি কিচেন কম্বো সেট — কোরবানি ঈদ স্পেশাল ছাড়",
        headlineEn: "Heavy-duty kitchen combo set — Qurbani Eid special discount",
        primaryText: "জাপানিজ স্টেইনলেস স্টিলের প্রিমিয়াম নাইফ ও চপার সেট। মাংস কাটার জন্য অতুলনীয় শার্প ও দীর্ঘস্থায়ী। আজই অর্ডার করুন এবং বুঝে পেয়ে মূল্য পরিশোধ করুন।",
        primaryTextEn: "A premium knife and chopper set in Japanese stainless steel. Unmatched sharpness for cutting meat, and long-lasting. Order today and pay after you receive it.",
        callToAction: "SHOP_NOW",
        offerFormula: "কম্বোতে অতিরিক্ত ৩০০ টাকা ছাড় + ফ্রি ডেলিভারি",
        offerFormulaEn: "Extra 300 taka off on the combo + free delivery",
      },
    ],
  },

  pohela_boishakh: {
    id: "pohela_boishakh",
    name: "পহেলা বৈশাখ ও বৈশাখী মেলা",
    nameEn: "Pohela Boishakh & Boishakhi fair",
    tagline: "বাঙালির প্রাণের উৎসব — লাল-সাদা ফ্যাশন, হ্যান্ডিক্রাফট ও দেশীয় ঐতিহ্য",
    taglineEn: "The festival closest to Bengali hearts — red-and-white fashion, handicrafts and local heritage",
    icon: "🪕",
    seasonBangla: "চৈত্র সংক্রান্তি ও বৈশাখ (এপ্রিলের প্রথম ২ সপ্তাহ)",
    seasonEn: "Chaitra Sankranti & Boishakh (first 2 weeks of April)",
    typicalMonthIndex: 3,
    targetAovRange: "৳১,২০০ – ৳২,৮০০",
    targetAovRangeEn: "৳1,200 – ৳2,800",
    targetNiches: ["লাল-সাদা বৈশাখী শাড়ি ও পাঞ্জাবি", "হ্যান্ডমেড জুয়েলারি ও মাটির গহনা", "ঐতিহ্যবাহী লোকশিল্প ও হোম ডেকর", "মিষ্টি ও বৈশাখী খাবারের হ্যাম্পার"],
    targetNichesEn: ["Red-and-white Boishakhi saree & panjabi", "Handmade jewellery & clay ornaments", "Traditional folk art & home decor", "Sweets & Boishakhi food hampers"],
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
        nameEn: "Boishakhi mood & matching combos",
        durationLabel: "মার্চ ২৫ – এপ্রিল ৫",
        durationLabelEn: "March 25 – April 5",
        focus: "কাপল ও ফ্যামিলি ম্যাচিং সেট",
        focusEn: "Couple & family matching sets",
        strategy: "পরিবারের সবার জন্য লাল-সাদা কম্বো প্যাকেজ প্রমোট করুন।",
        strategyEn: "Promote red-and-white combo packages for the whole family.",
        adAngle: "নতুন বছরের প্রথম প্রভাতে পরিবারের সবাইকে নিয়ে বৈশাখী রঙে সাজুন।",
        adAngleEn: "Dress in Boishakhi colors with the whole family on the first morning of the new year.",
      },
      {
        phaseNumber: 2,
        name: "বৈশাখী মেলা ফ্ল্যাশ সেল",
        nameEn: "Boishakhi fair flash sale",
        durationLabel: "এপ্রিল ৬ – ১২",
        durationLabelEn: "April 6 – 12",
        focus: "দ্রুততম ডেলিভারি ও ক্লিয়ারেন্স",
        focusEn: "Fastest delivery & clearance",
        strategy: "লিমিটেড বৈশাখী স্টক দ্রুত শেষ করতে ক্যাশ অন ডেলিভারি পুশ দিন।",
        strategyEn: "Push cash on delivery to clear the limited Boishakhi stock quickly.",
        adAngle: "পহেলা বৈশাখের আগেই ডেলিভারি পেতে আজই কনফার্ম করুন!",
        adAngleEn: "Confirm today to get delivery before Pohela Boishakh!",
      },
    ],
    adCopies: [
      {
        hook: "শুভ নববর্ষ! বৈশাখের নতুন সাজে নতুন রূপ",
        hookEn: "Happy New Year! A new look in fresh Boishakh attire",
        headline: "বৈশাখী মেগা সেল — আকর্ষণীয় ডিজাইনের দেশীয় কালেকশন",
        headlineEn: "Boishakhi mega sale — an attractive local collection",
        primaryText: "১৪৩১ বরণ করে নিন প্রিমিয়াম বৈশাখী শাড়ি ও পাঞ্জাবি কালেকশনে। সুতি কাপড়ে আরামদায়ক ফিনিশিং। ক্যাশ অন ডেলিভারিতে দ্রুত ডেলিভারি সুবিধা!",
        primaryTextEn: "Welcome 1431 with the premium Boishakhi saree and panjabi collection. Comfortable finishing in cotton fabric. Fast delivery with cash on delivery!",
        callToAction: "SHOP_NOW",
        offerFormula: "কাপল সেটে ফ্ল্যাট ২৫% ডিসকাউন্ট",
        offerFormulaEn: "Flat 25% discount on couple sets",
      },
    ],
  },

  durga_puja: {
    id: "durga_puja",
    name: "শারদীয় দুর্গোৎসব ধামাকা",
    nameEn: "Sharadiya Durga festival blockbuster",
    tagline: "পূজার জমকালো ফ্যাশন, প্রিমিয়াম জুয়েলারি ও গিফট হ্যাম্পার",
    taglineEn: "Glamorous Puja fashion, premium jewellery and gift hampers",
    icon: "🪔",
    seasonBangla: "আশ্বিন ও কার্তিক (অক্টোবর)",
    seasonEn: "Ashwin & Kartik (October)",
    typicalMonthIndex: 9,
    targetAovRange: "৳১,৫০০ – ৳৩,৮০০",
    targetAovRangeEn: "৳1,500 – ৳3,800",
    targetNiches: ["পূজা স্পেশাল সিল্ক ও জামদানি শাড়ি", "এক্সক্লুসিভ কুর্তি ও ফিউশন ড্রেস", "ব্রাস ও অ্যান্টিক জুয়েলারি", "পূজার লাইটিং ও হোম ডেকর"],
    targetNichesEn: ["Puja special silk & jamdani sarees", "Exclusive kurtis & fusion dresses", "Brass & antique jewellery", "Puja lighting & home decor"],
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
        nameEn: "Puja collection showcase",
        durationLabel: "মহালয়ার আগে থেকে ষষ্ঠী পর্যন্ত",
        durationLabelEn: "From before Mahalaya to Shashthi",
        focus: "শারদীয় নতুন ট্রেন্ড ও জুয়েলারি ম্যাচিং",
        focusEn: "New Sharadiya trends & jewellery matching",
        strategy: "উৎসবের প্রতিটি দিনের জন্য আলাদা লুক ও ড্রেস সাজেশন দিন।",
        strategyEn: "Suggest a separate look and dress for each day of the festival.",
        adAngle: "মহালয়া থেকে দশমী — পূজার প্রতিটি দিনে থাকুক নতুন আকর্ষণ!",
        adAngleEn: "From Mahalaya to Dashami — a new attraction for every day of Puja!",
      },
    ],
    adCopies: [
      {
        hook: "শারদীয় উৎসবের রঙে নিজেকে সাজিয়ে তুলুন",
        hookEn: "Adorn yourself in the colors of the Sharadiya festival",
        headline: "পূজা স্পেশাল এক্সক্লুসিভ কালেকশন — সেরা অফারে কিনুন",
        headlineEn: "Puja special exclusive collection — buy at the best offer",
        primaryText: "পূজার প্রতিটি দিনকে স্মরণীয় করতে আমাদের স্পেশাল শারদীয় কালেকশন এখন লাইভ। প্রিমিয়াম কোয়ালিটি এবং শতভাগ ক্যাশ অন ডেলিভারি।",
        primaryTextEn: "Our special Sharadiya collection is now live to make every day of Puja memorable. Premium quality and 100% cash on delivery.",
        callToAction: "SHOP_NOW",
        offerFormula: "ফ্রি ডেলিভারি + স্পেশাল পূজা ক্যাশব্যাক",
        offerFormulaEn: "Free delivery + special Puja cashback",
      },
    ],
  },

  winter_clearance: {
    id: "winter_clearance",
    name: "শীতকালীন মেগা কালেকশন ও হুডি ফেস্ট",
    nameEn: "Winter mega collection & hoodie fest",
    tagline: "হিমেল হাওয়ায় স্টাইলিশ উইন্টার ফ্যাশন, জ্যাকেট, হুডি ও স্কিনকেয়ার",
    taglineEn: "Stylish winter fashion, jackets, hoodies and skincare for the chilly breeze",
    icon: "❄️",
    seasonBangla: "কার্তিক – মাঘ (নভেম্বর-জানুয়ারি)",
    seasonEn: "Kartik – Magh (November-January)",
    typicalMonthIndex: 11,
    targetAovRange: "৳১,২০০ – ৳৩,২০০",
    targetAovRangeEn: "৳1,200 – ৳3,200",
    targetNiches: ["প্রিমিয়াম হুডি ও সোয়েটশার্ট", "লেদার ও উইন্ডপ্রুফ জ্যাকেট", "কাশ্মীরি শাল ও চাদর", "শীতের ময়েশ্চারাইজার ও লিপ কেয়ার", "কম্ফোর্টার ও কম্বল"],
    targetNichesEn: ["Premium hoodies & sweatshirts", "Leather & windproof jackets", "Kashmiri shawls & wraps", "Winter moisturizers & lip care", "Comforters & blankets"],
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
        nameEn: "Winter drop & pre-order",
        durationLabel: "নভেম্বরের শুরু",
        durationLabelEn: "Early November",
        focus: "ট্রেন্ডি হুডি ও জ্যাকেট লঞ্চ",
        focusEn: "Trendy hoodie & jacket launch",
        strategy: "তরুণ প্রজন্মের জন্য কুল কালার ও ড্রপ শোল্ডার হুডি হাইলাইট করুন।",
        strategyEn: "Highlight cool colors and drop-shoulder hoodies for the younger generation.",
        adAngle: "শীতের শুরুতেই নিয়ে নিন এ বছরের সবচেয়ে ট্রেন্ডি হুডি কালেকশন।",
        adAngleEn: "Get this year's trendiest hoodie collection right at the start of winter.",
      },
      {
        phaseNumber: 2,
        name: "কোল্ড ওয়েভ ক্লিয়ারেন্স মেগা অফার",
        nameEn: "Cold wave clearance mega offer",
        durationLabel: "ডিসেম্বর – জানুয়ারির শৈত্যপ্রবাহ",
        durationLabelEn: "December – January cold wave",
        focus: "স্টক আউট ও হাই কনভার্সন",
        focusEn: "Stock-out & high conversion",
        strategy: "বাই ১ গেট ১ বা ২টি কিনলে বিশাল ছাড় দিয়ে দ্রুত ইনভেন্টরি টার্নওভার করুন।",
        strategyEn: "Turn inventory over fast with buy-1-get-1 or a big discount on 2 items.",
        adAngle: "তীব্র শীতে উষ্ণতা ছড়িয়ে দিতে বিশেষ উইন্টার ক্লিয়ারেন্স ডিসকাউন্ট!",
        adAngleEn: "A special winter clearance discount to spread warmth in the bitter cold!",
      },
    ],
    adCopies: [
      {
        hook: "❄️ শীতের কাঁপনে স্টাইলিশ উষ্ণতা!",
        hookEn: "❄️ Stylish warmth for the winter chill!",
        headline: "উইন্টার হুডি ও জ্যাকেট ফেস্ট — ফ্ল্যাট ৩০% পর্যন্ত ছাড়",
        headlineEn: "Winter hoodie & jacket fest — flat up to 30% off",
        primaryText: "জিএসএম হাই-গ্রেড কটনে তৈরি আরামদায়ক ও এক্সক্লুসিভ হুডি কালেকশন। শীতে আপনাকে রাখবে উষ্ণ ও স্মার্ট। কোনো অগ্রিম ছাড়াই ক্যাশ অন ডেলিভারিতে অর্ডার করুন।",
        primaryTextEn: "A comfortable, exclusive hoodie collection made from high-grade GSM cotton. It will keep you warm and smart this winter. Order with cash on delivery — no advance needed.",
        callToAction: "SHOP_NOW",
        offerFormula: "২টি হুডি অর্ডারে ২০০ টাকা সেভিং + ফ্রি ডেলিভারি",
        offerFormulaEn: "Save 200 taka on 2 hoodies + free delivery",
      },
    ],
  },

  black_friday_11_11: {
    id: "black_friday_11_11",
    name: "১১.১১ ও ব্ল্যাক ফ্রাইডে সুপার সেল",
    nameEn: "11.11 & Black Friday super sale",
    tagline: "গ্লোবাল শপিং ডে — বছরের সর্বোচ্চ ডিসকাউন্ট, ফ্ল্যাশ ড্রপ ও গ্যাজেট ঝড়",
    taglineEn: "Global shopping day — the year's highest discounts, flash drops and a gadget storm",
    icon: "🔥",
    seasonBangla: "নভেম্বরের দ্বিতীয় ও শেষ সপ্তাহ",
    seasonEn: "Second and last weeks of November",
    typicalMonthIndex: 10,
    targetAovRange: "৳১,০০০ – ৳৫,০০০",
    targetAovRangeEn: "৳1,000 – ৳5,000",
    targetNiches: ["স্মার্ট গ্যাজেটস ও ব্লুটুথ ইয়ারবাডস", "স্মার্টওয়াচ ও পাওয়ার ব্যাংক", "লাইফস্টাইল ও ইলেকট্রনিক্স", "ফ্যাশন ক্লিয়ারেন্স স্টক"],
    targetNichesEn: ["Smart gadgets & Bluetooth earbuds", "Smartwatches & power banks", "Lifestyle & electronics", "Fashion clearance stock"],
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
        nameEn: "11.11 countdown & wishlist drive",
        durationLabel: "নভেম্বর ১ – ১০",
        durationLabelEn: "November 1 – 10",
        focus: "লিড জেনারেশন ও মেসেঞ্জার সাবস্ক্রাইবার",
        focusEn: "Lead generation & Messenger subscribers",
        strategy: "সবচেয়ে কম মূল্যের সিক্রেট ড্রপের জন্য গ্রাহকদের মেসেঞ্জারে যুক্ত করুন।",
        strategyEn: "Bring customers onto Messenger for the lowest-price secret drops.",
        adAngle: "১১.১১ সুপার সেলের স্পেশাল ডিসকাউন্ট কোড পেতে এখনই উইশলিস্ট করুন।",
        adAngleEn: "Wishlist now to get the 11.11 super sale special discount code.",
      },
      {
        phaseNumber: 2,
        name: "২৪-ঘণ্টা ফ্ল্যাশ সেল ও ব্ল্যাক ফ্রাইডে ম্যাডনেস",
        nameEn: "24-hour flash sale & Black Friday madness",
        durationLabel: "নভেম্বর ১১ ও ব্ল্যাক ফ্রাইডে উইকএন্ড",
        durationLabelEn: "November 11 & the Black Friday weekend",
        focus: "সর্বোচ্চ বাজেট স্কেলিং ও ইনস্ট্যান্ট অর্ডার",
        focusEn: "Maximum budget scaling & instant orders",
        strategy: "স্টক শেষ হয়ে যাওয়ার আর্জেন্সি তৈরি করে লাইভ ট্র্যাফিক রূপান্তর করুন।",
        strategyEn: "Convert live traffic by creating stock-out urgency.",
        adAngle: "বছরের সবচেয়ে বড় প্রাইস ড্রপ! স্টক সীমিত — দেরি করলেই মিস।",
        adAngleEn: "The biggest price drop of the year! Limited stock — delay and you'll miss it.",
      },
    ],
    adCopies: [
      {
        hook: "🔥 ১১.১১ মেগা সেল লাইভ! বছরের সবচেয়ে বড় প্রাইস কাট",
        hookEn: "🔥 11.11 mega sale live! The biggest price cut of the year",
        headline: "ফ্ল্যাট ৫০% পর্যন্ত মেগা ডিসকাউন্ট — স্টক দ্রুত ফুরিয়ে যাচ্ছে",
        headlineEn: "Mega discount of flat up to 50% — stock is running out fast",
        primaryText: "আর কোনো অপেক্ষা নয়! বহুল প্রতীক্ষিত ব্ল্যাক ফ্রাইডে ও ১১.১১ সুপার সেল শুরু হয়েছে। আসল কোয়ালিটি, চোখ জুড়ানো ডিসকাউন্ট এবং দ্রুত হোম ডেলিভারি!",
        primaryTextEn: "No more waiting! The long-awaited Black Friday and 11.11 super sale has begun. Genuine quality, eye-catching discounts and fast home delivery!",
        callToAction: "SHOP_NOW",
        offerFormula: "বাই ১ গেট ১ অথবা ফ্ল্যাট ৫০% ক্যাশব্যাক অফার",
        offerFormulaEn: "Buy 1 get 1, or a flat 50% cashback offer",
      },
    ],
  },

  falgun_valentin: {
    id: "falgun_valentin",
    name: "বসন্ত ও ভালোবাসা দিবস স্পেশাল",
    nameEn: "Spring & Valentine's Day special",
    tagline: "পহেলা ফাল্গুন ও ভ্যালেন্টাইন — হলুদ বাসন্তী ফ্যাশন, কাপল কম্বো ও গিফট প্যাকেজ",
    taglineEn: "Pohela Falgun & Valentine's — yellow spring fashion, couple combos and gift packages",
    icon: "🌹",
    seasonBangla: "মাঘের শেষ ও ফাল্গুন (ফেব্রুয়ারি ১০-১৪)",
    seasonEn: "End of Magh & Falgun (February 10-14)",
    typicalMonthIndex: 1,
    targetAovRange: "৳১,৫০০ – ৳৩,৫০০",
    targetAovRangeEn: "৳1,500 – ৳3,500",
    targetNiches: ["বাসন্তী শাড়ি ও হলুদ পাঞ্জাবি", "কাপল কম্বো ড্রেস ও ঘড়ির সেট", "পারফিউম ও প্রিমিয়াম গিফট বক্স", "চকলেট হ্যাম্পার ও পারসোনালাইজড গিফট"],
    targetNichesEn: ["Spring sarees & yellow panjabi", "Couple combo dresses & watch sets", "Perfume & premium gift boxes", "Chocolate hampers & personalized gifts"],
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
        nameEn: "Gift & combo booking",
        durationLabel: "ফেব্রুয়ারি ১ – ১০",
        durationLabelEn: "February 1 – 10",
        focus: "গিফট প্যাকিং ও কাপল কম্বো",
        focusEn: "Gift packing & couple combos",
        strategy: "প্রিয়জনকে সারপ্রাইজ দেওয়ার জন্য আগেভাগে অর্ডারের সুবিধা দিন।",
        strategyEn: "Offer early ordering so buyers can surprise their loved ones.",
        adAngle: "ভালোবাসার বিশেষ দিনে আপনার প্রিয় মানুষের মুখে হাসি ফোটাতে সেরা গিফট বক্স।",
        adAngleEn: "The best gift box to bring a smile to your loved one's face on this special day of love.",
      },
    ],
    adCopies: [
      {
        hook: "🌹 ভালোবাসার দিনে প্রিয়জনকে দিন স্পেশাল সারপ্রাইজ!",
        hookEn: "🌹 Give your loved one a special surprise on the day of love!",
        headline: "ফাল্গুন ও ভ্যালেন্টাইন স্পেশাল গিফট বক্স — সাথে ফ্রি গিফট কার্ড",
        headlineEn: "Falgun & Valentine's special gift box — with a free gift card",
        primaryText: "বাসন্তী হলুদ শাড়ির ম্যাচিং কম্বো অথবা এক্সক্লুসিভ পারফিউম গিফট প্যাক। দৃষ্টিনন্দন গিফট বক্সে মোড়ানো এবং নির্দিষ্ট দিনে ডেলিভারির নিশ্চয়তা!",
        primaryTextEn: "A matching combo with a spring-yellow saree, or an exclusive perfume gift pack. Wrapped in a beautiful gift box with guaranteed delivery on the chosen day!",
        callToAction: "ORDER_NOW",
        offerFormula: "ফ্রি লাক্সারি গিফট র‍্যাপিং + ২০% ডিসকাউন্ট",
        offerFormulaEn: "Free luxury gift wrapping + 20% discount",
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

/** D7 by-locale picker: returns a playbook view whose display
 * fields hold the active locale's copy (bn = the playbook as-is;
 * en = the *En companions swapped into the bn field slots). */
export function festivalPlaybookForLocale(pb: FestivalPlaybook, locale: "bn" | "en" = "bn"): FestivalPlaybook {
  if (locale !== "en") return pb;
  return {
    ...pb,
    name: pb.nameEn,
    tagline: pb.taglineEn,
    seasonBangla: pb.seasonEn,
    targetAovRange: pb.targetAovRangeEn,
    targetNiches: pb.targetNichesEn,
    phases: pb.phases.map((ph) => ({ ...ph, name: ph.nameEn, durationLabel: ph.durationLabelEn, focus: ph.focusEn, strategy: ph.strategyEn, adAngle: ph.adAngleEn })),
    adCopies: pb.adCopies.map((c) => ({ ...c, hook: c.hookEn, headline: c.headlineEn, primaryText: c.primaryTextEn, offerFormula: c.offerFormulaEn })),
  };
}

/** Calculate courier deadlines based on festival date */
export function calculateCourierCutoff(
  festivalName: string,
  targetFestivalDate: Date,
  leadDaysOutside = 4,
  leadDaysInside = 2,
  currentDate: Date = new Date(),
  locale: "bn" | "en" = "bn"
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

  const outsideFmt = new Intl.DateTimeFormat(locale === "en" ? "en-IN" : "bn-BD", {
    month: "long",
    day: "numeric",
  }).format(outsideDeadline);

  const daysLeft = Math.max(1, daysRemainingOutside);
  const urgencyAdCopy = locale === "en"
    ? (isOutsideDeadlinePassed
      ? `🚨 Express delivery is running for Dhaka metro only! Order now to get your parcel delivered before ${festivalName}.`
      : `🚨 Courier cut-off alert! To secure delivery before ${festivalName}, the last order date outside Dhaka is ${outsideFmt} (only ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left). Confirm your order today!`)
    : (isOutsideDeadlinePassed
      ? `🚨 শুধুমাত্র ঢাকা মেট্রোর জন্য এক্সপ্রেস ডেলিভারি চলছে! ${festivalName}-এর আগেই আপনার পার্সেল ডেলিভারি পেতে এখনই অর্ডার করুন।`
      : `🚨 কুরিয়ার কাট-অফ এলার্ট! ${festivalName}-এর আগে ডেলিভারি নিশ্চিত করতে ঢাকার বাইরে শেষ অর্ডারের তারিখ ${outsideFmt} (আর মাত্র ${daysLeft} দিন বাকি)। আজই অর্ডার কনফার্ম করুন!`);

  const smsBroadcastCopy = locale === "en"
    ? (isOutsideDeadlinePassed
      ? `[${festivalName}] Express delivery within 24 hours is live in Dhaka city! Place your last-minute order: [Link]`
      : `[${festivalName}] Courier booking outside Dhaka closes in just ${daysLeft} ${daysLeft === 1 ? "day" : "days"}! Book your order today to get your parcel before the festival: [Link]`)
    : (isOutsideDeadlinePassed
      ? `[${festivalName}] ঢাকা সিটিতে ২৪ ঘণ্টায় এক্সপ্রেস ডেলিভারি চালু! শেষ মুহূর্তের অর্ডার করুন: [Link]`
      : `[${festivalName}] ঢাকার বাইরে কুরিয়ার বুকিং আর মাত্র ${daysLeft} দিন! উৎসবের আগে পার্সেল পেতে আজই অর্ডার বুক করুন: [Link]`);

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
  specialOffer?: string,
  locale: "bn" | "en" = "bn"
): { headline: string; primaryText: string; callToAction: string } {
  const playbook = festivalPlaybookForLocale(FESTIVAL_PLAYBOOKS[festivalKey] || FESTIVAL_PLAYBOOKS.eid_ul_fitr, locale);
  const offer = specialOffer || (locale === "en" ? "Special blockbuster discount + cash on delivery" : "বিশেষ ধামাকা ছাড় + ক্যাশ অন ডেলিভারি");

  if (locale === "en") {
    return {
      headline: `${playbook.icon} ${productName} — ${playbook.name} special offer!`,
      primaryText: `For ${playbook.name}, ${productName} now has ${offer}! Pay after receiving and checking the product in hand, with cash on delivery anywhere in Bangladesh — no advance payment at all. Confirm your order now to get delivery before the festival.`,
      callToAction: "SHOP_NOW",
    };
  }
  return {
    headline: `${playbook.icon} ${productName} — ${playbook.name} স্পেশাল অফার!`,
    primaryText: `${playbook.name} উপলক্ষে ${productName}-এ চলছে ${offer}! কোনো প্রকার অগ্রিম পেমেন্ট ছাড়াই সারা বাংলাদেশে ক্যাশ অন ডেলিভারিতে পণ্য হাতে পেয়ে চেক করে মূল্য পরিশোধ করুন। উৎসবের আগেই ডেলিভারি পেতে এখনই অর্ডার কনফার্ম করুন।`,
    callToAction: "SHOP_NOW",
  };
}
