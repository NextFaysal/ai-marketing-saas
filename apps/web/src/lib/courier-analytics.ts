/**
 * Courier Performance, District Delivery SLA & RTO Financial Analytics Engine
 * Covers Bangladesh's major courier networks: Steadfast, Pathao, RedX, eCourier.
 */

export type CourierProvider = "steadfast" | "pathao" | "redx" | "ecourier";

export type DistrictZone = "dhaka_metro" | "dhaka_suburb" | "divisional_city" | "remote_district";

export interface DistrictSlaMetric {
  district: string;
  zone: DistrictZone;
  zoneNameBangla: string;
  bestCourier: CourierProvider;
  avgDeliveryHours: number;
  deliverySuccessRate: number; // 0-100%
  rtoRate: number; // 0-100%
  avgShippingCostTaka: number;
}

export interface CourierProviderStats {
  provider: CourierProvider;
  nameBangla: string;
  logo: string;
  overallSuccessRate: number; // 0-100%
  avgSlaDaysDhaka: number;
  avgSlaDaysOutside: number;
  rtoRate: number;
  codFeePct: number;
  dhakaChargeTaka: number;
  outsideDhakaChargeTaka: number;
  pickupSpeedRating: number; // 1-5
  trackingReliabilityRating: number; // 1-5
}

export interface CourierRecommendation {
  recommendedProvider: CourierProvider;
  providerNameBangla: string;
  zone: DistrictZone;
  zoneNameBangla: string;
  estimatedDeliveryDays: string;
  estimatedCostTaka: number;
  successRateExpected: number;
  reasonBangla: string;
  alternativeProvider: CourierProvider;
  alternativeReasonBangla: string;
}

export interface RtoLossReport {
  totalShipments: number;
  returnRatePct: number;
  returnedOrdersCount: number;
  deliveredOrdersCount: number;
  shippingLossTaka: number;
  returnFeeLossTaka: number;
  packagingLossTaka: number;
  totalNetLossTaka: number;
  lossPerSuccessfulOrderTaka: number;
  savingsWithAdvanceChargeTaka: number;
  recommendationBangla: string;
}

export const COURIER_PROVIDERS: Record<CourierProvider, CourierProviderStats> = {
  pathao: {
    provider: "pathao",
    nameBangla: "পাঠাও কুরিয়ার",
    logo: "🔴",
    overallSuccessRate: 91.5,
    avgSlaDaysDhaka: 1.1,
    avgSlaDaysOutside: 2.8,
    rtoRate: 8.5,
    codFeePct: 1.0,
    dhakaChargeTaka: 60,
    outsideDhakaChargeTaka: 120,
    pickupSpeedRating: 4.8,
    trackingReliabilityRating: 4.7,
  },
  steadfast: {
    provider: "steadfast",
    nameBangla: "স্টিডফাস্ট কুরিয়ার",
    logo: "🟢",
    overallSuccessRate: 89.8,
    avgSlaDaysDhaka: 1.3,
    avgSlaDaysOutside: 2.3,
    rtoRate: 10.2,
    codFeePct: 1.0,
    dhakaChargeTaka: 70,
    outsideDhakaChargeTaka: 115,
    pickupSpeedRating: 4.6,
    trackingReliabilityRating: 4.8,
  },
  redx: {
    provider: "redx",
    nameBangla: "রেডেক্স লজিস্টিকস",
    logo: "🔴",
    overallSuccessRate: 85.2,
    avgSlaDaysDhaka: 1.4,
    avgSlaDaysOutside: 3.2,
    rtoRate: 14.8,
    codFeePct: 1.0,
    dhakaChargeTaka: 60,
    outsideDhakaChargeTaka: 125,
    pickupSpeedRating: 4.2,
    trackingReliabilityRating: 4.1,
  },
  ecourier: {
    provider: "ecourier",
    nameBangla: "ই-কুরিয়ার",
    logo: "🔵",
    overallSuccessRate: 86.0,
    avgSlaDaysDhaka: 1.5,
    avgSlaDaysOutside: 3.0,
    rtoRate: 14.0,
    codFeePct: 1.0,
    dhakaChargeTaka: 65,
    outsideDhakaChargeTaka: 120,
    pickupSpeedRating: 4.1,
    trackingReliabilityRating: 4.2,
  },
};

export const POPULAR_DISTRICTS_DATA: DistrictSlaMetric[] = [
  {
    district: "Dhaka",
    zone: "dhaka_metro",
    zoneNameBangla: "ঢাকা মেট্রো",
    bestCourier: "pathao",
    avgDeliveryHours: 24,
    deliverySuccessRate: 94.2,
    rtoRate: 5.8,
    avgShippingCostTaka: 60,
  },
  {
    district: "Gazipur",
    zone: "dhaka_suburb",
    zoneNameBangla: "ঢাকা উপশহর",
    bestCourier: "steadfast",
    avgDeliveryHours: 36,
    deliverySuccessRate: 90.5,
    rtoRate: 9.5,
    avgShippingCostTaka: 100,
  },
  {
    district: "Chittagong",
    zone: "divisional_city",
    zoneNameBangla: "বিভাগীয় প্রধান শহর",
    bestCourier: "steadfast",
    avgDeliveryHours: 42,
    deliverySuccessRate: 91.8,
    rtoRate: 8.2,
    avgShippingCostTaka: 115,
  },
  {
    district: "Sylhet",
    zone: "divisional_city",
    zoneNameBangla: "বিভাগীয় প্রধান শহর",
    bestCourier: "pathao",
    avgDeliveryHours: 44,
    deliverySuccessRate: 89.4,
    rtoRate: 10.6,
    avgShippingCostTaka: 120,
  },
  {
    district: "Rajshahi",
    zone: "divisional_city",
    zoneNameBangla: "বিভাগীয় প্রধান শহর",
    bestCourier: "steadfast",
    avgDeliveryHours: 46,
    deliverySuccessRate: 90.1,
    rtoRate: 9.9,
    avgShippingCostTaka: 115,
  },
  {
    district: "Khulna",
    zone: "divisional_city",
    zoneNameBangla: "বিভাগীয় প্রধান শহর",
    bestCourier: "steadfast",
    avgDeliveryHours: 45,
    deliverySuccessRate: 88.7,
    rtoRate: 11.3,
    avgShippingCostTaka: 115,
  },
  {
    district: "Cox's Bazar",
    zone: "remote_district",
    zoneNameBangla: "উপকূলীয় ও দূরবর্তী জেলা",
    bestCourier: "steadfast",
    avgDeliveryHours: 64,
    deliverySuccessRate: 84.1,
    rtoRate: 15.9,
    avgShippingCostTaka: 130,
  },
  {
    district: "Bandarban",
    zone: "remote_district",
    zoneNameBangla: "পার্বত্য ও প্রত্যন্ত অঞ্চল",
    bestCourier: "steadfast",
    avgDeliveryHours: 72,
    deliverySuccessRate: 81.5,
    rtoRate: 18.5,
    avgShippingCostTaka: 140,
  },
];

/**
 * Classifies district into standard logistics zone
 */
export function identifyDistrictZone(districtOrAddress: string): { zone: DistrictZone; nameBangla: string } {
  const text = (districtOrAddress || "").toLowerCase().trim();

  const isMetro =
    text.includes("dhaka") ||
    text.includes("ঢাকা") ||
    text.includes("mirpur") ||
    text.includes("মিরপুর") ||
    text.includes("dhanmondi") ||
    text.includes("ধানমন্ডি") ||
    text.includes("uttara") ||
    text.includes("উত্তরা") ||
    text.includes("gulshan") ||
    text.includes("গুলশান") ||
    text.includes("banani") ||
    text.includes("বনানী") ||
    text.includes("mohammadpur") ||
    text.includes("মোহাম্মদপুর");

  if (isMetro) {
    return { zone: "dhaka_metro", nameBangla: "ঢাকা মেট্রোপলিটন" };
  }

  const isSuburb =
    text.includes("gazipur") ||
    text.includes("গাজীপুর") ||
    text.includes("narayanganj") ||
    text.includes("নারায়ণগঞ্জ") ||
    text.includes("savar") ||
    text.includes("সাভার") ||
    text.includes("keraniganj") ||
    text.includes("কেরানীগঞ্জ");

  if (isSuburb) {
    return { zone: "dhaka_suburb", nameBangla: "ঢাকা উপশহর ও সাব-আরবান" };
  }

  const isRemote =
    text.includes("bandarban") ||
    text.includes("বান্দরবান") ||
    text.includes("rangamati") ||
    text.includes("রাঙ্গামাটি") ||
    text.includes("khagrachhari") ||
    text.includes("খাগড়াছড়ি") ||
    text.includes("cox") ||
    text.includes("কক্সবাজার") ||
    text.includes("teknaf") ||
    text.includes("টেকনাফ") ||
    text.includes("sunamganj") ||
    text.includes("সুনামগঞ্জ") ||
    text.includes("bhola") ||
    text.includes("ভোলা") ||
    text.includes("char") ||
    text.includes("চর");

  if (isRemote) {
    return { zone: "remote_district", nameBangla: "পার্বত্য ও প্রত্যন্ত উপকূলীয় জেলা" };
  }

  return { zone: "divisional_city", nameBangla: "বিভাগীয় ও জেলা শহর" };
}

/**
 * Recommends the optimal courier for a given destination address/district
 */
export function recommendBestCourier(
  districtOrAddress: string,
  weightGrams = 500,
  codAmountTaka = 1500,
  priority: "speed" | "cost" | "safety" = "speed"
): CourierRecommendation {
  const { zone, nameBangla } = identifyDistrictZone(districtOrAddress);

  if (zone === "dhaka_metro") {
    return {
      recommendedProvider: "pathao",
      providerNameBangla: "পাঠাও কুরিয়ার",
      zone,
      zoneNameBangla: nameBangla,
      estimatedDeliveryDays: "১ দিন (২৪ ঘণ্টার মধ্যে)",
      estimatedCostTaka: 60 + (weightGrams > 1000 ? Math.ceil((weightGrams - 1000) / 1000) * 15 : 0),
      successRateExpected: 94.5,
      reasonBangla: "ঢাকা মেট্রোতে পাঠাওয়ের সেইম-ডে ও নেক্সট-ডে পিকআপ নেটওয়ার্ক দ্রুততম এবং ডেলিভারি সাকসেস ৯৪.৫%",
      alternativeProvider: "steadfast",
      alternativeReasonBangla: "স্টিডফাস্টের রিটার্ন রেট কম এবং কালেকশন অটো-রিকনসিল্ড",
    };
  }

  if (zone === "dhaka_suburb") {
    return {
      recommendedProvider: "steadfast",
      providerNameBangla: "স্টিডফাস্ট কুরিয়ার",
      zone,
      zoneNameBangla: nameBangla,
      estimatedDeliveryDays: "১-২ দিন (২৪-৩৬ ঘণ্টা)",
      estimatedCostTaka: 100,
      successRateExpected: 90.5,
      reasonBangla: "সাভার ও গাজীপুর হাব এলাকায় স্টিডফাস্টের সরাসরি পয়েন্ট থাকায় আরটিও কম হয়",
      alternativeProvider: "pathao",
      alternativeReasonBangla: "পাঠাও নিয়মিত এক্সপ্রেস সার্ভিস দেয়",
    };
  }

  if (zone === "remote_district") {
    return {
      recommendedProvider: "steadfast",
      providerNameBangla: "স্টিডফাস্ট কুরিয়ার",
      zone,
      zoneNameBangla: nameBangla,
      estimatedDeliveryDays: "৩-৪ দিন (৭২ ঘণ্টা)",
      estimatedCostTaka: 130,
      successRateExpected: 83.0,
      reasonBangla: "পার্বত্য ও উপকূলীয় উপজেলায় স্টিডফাস্টের নিজস্ব সাব-এজেন্ট নেটওয়ার্ক রিটার্ন ঝুঁকি কমায়",
      alternativeProvider: "redx",
      alternativeReasonBangla: "রেডেক্সের পোস্টাল কাভারেজ বিস্তৃত",
    };
  }

  // divisional_city / rest of Bangladesh
  if (priority === "cost") {
    return {
      recommendedProvider: "steadfast",
      providerNameBangla: "স্টিডফাস্ট কুরিয়ার",
      zone,
      zoneNameBangla: nameBangla,
      estimatedDeliveryDays: "২ দিন (৪৮ ঘণ্টা)",
      estimatedCostTaka: 115,
      successRateExpected: 90.0,
      reasonBangla: "ঢাকার বাইরে স্টিডফাস্ট সবচেয়ে সাশ্রয়ী এবং ক্যাশ অন ডেলিভারি (COD) পেমেন্ট দ্রুত দেয়",
      alternativeProvider: "pathao",
      alternativeReasonBangla: "পাঠাও দ্রুততর কিন্তু চার্জ কিছুটা বেশি হতে পারে",
    };
  }

  return {
    recommendedProvider: "steadfast",
    providerNameBangla: "স্টিডফাস্ট কুরিয়ার",
    zone,
    zoneNameBangla: nameBangla,
    estimatedDeliveryDays: "২-৩ দিন",
    estimatedCostTaka: 115,
    successRateExpected: 90.2,
    reasonBangla: "বিভাগীয় শহরে স্টিডফাস্টের সফল ডেলিভারি রেট ৯০% এবং পার্সেল হ্যান্ডলিং নির্ভুল",
    alternativeProvider: "pathao",
    alternativeReasonBangla: "পাঠাও বড় বিভাগীয় শহরে দ্রুততম ট্র্যাকিং দেয়",
  };
}

/**
 * Calculates financial loss from RTO (Return to Origin) failed deliveries
 */
export function calculateRtoLoss(params: {
  totalShipments: number;
  returnRatePct: number;
  outboundShippingTaka?: number;
  returnFeeTaka?: number;
  packagingLossTaka?: number;
}): RtoLossReport {
  const total = Math.max(1, params.totalShipments || 1);
  const rtoPct = Math.min(100, Math.max(0, params.returnRatePct || 0));

  const returnedOrdersCount = Math.round((total * rtoPct) / 100);
  const deliveredOrdersCount = total - returnedOrdersCount;

  const outboundShippingTaka = params.outboundShippingTaka ?? 120;
  const returnFeeTaka = params.returnFeeTaka ?? 60;
  const packagingLossTaka = params.packagingLossTaka ?? 30;

  const shippingLoss = returnedOrdersCount * outboundShippingTaka;
  const returnFeeLoss = returnedOrdersCount * returnFeeTaka;
  const packagingLoss = returnedOrdersCount * packagingLossTaka;

  const totalNetLossTaka = shippingLoss + returnFeeLoss + packagingLoss;
  const lossPerSuccessfulOrderTaka = deliveredOrdersCount > 0 ? Math.round(totalNetLossTaka / deliveredOrdersCount) : 0;
  const savingsWithAdvanceChargeTaka = Math.round(returnedOrdersCount * (outboundShippingTaka + returnFeeTaka) * 0.75);

  let recommendationBangla = "আপনার আরটিও রেট নিয়ন্ত্রিত রয়েছে।";
  if (rtoPct >= 15) {
    recommendationBangla = `⚠️ আরটিও রেট (${rtoPct}%) অতিরিক্ত উচ্চ! ঢাকার বাইরের অর্ডারে ৳১০০-১৫০ অগ্রিম ডেলিভারি চার্জ গ্রহণ করলে মাসে প্রায় ৳${savingsWithAdvanceChargeTaka.toLocaleString("en-IN")} সাশ্রয় হবে।`;
  } else if (rtoPct >= 10) {
    recommendationBangla = `মাঝারি আরটিও (${rtoPct}%)। সন্দেহজনক কাস্টমারদের জন্য ফোন ভেরিফিকেশন এবং এডভান্স রিকোয়েস্ট চালু করুন।`;
  }

  return {
    totalShipments: total,
    returnRatePct: rtoPct,
    returnedOrdersCount,
    deliveredOrdersCount,
    shippingLossTaka: shippingLoss,
    returnFeeLossTaka: returnFeeLoss,
    packagingLossTaka: packagingLoss,
    totalNetLossTaka,
    lossPerSuccessfulOrderTaka,
    savingsWithAdvanceChargeTaka,
    recommendationBangla,
  };
}
