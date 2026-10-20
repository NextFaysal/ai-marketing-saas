/**
 * Courier Performance, District Delivery SLA & RTO Financial Analytics Engine
 * Covers Bangladesh's major courier networks: Steadfast, Pathao, RedX, eCourier.
 */
import { fmtNumber } from "@repo/contracts";
import { ordersBn, ordersEn } from "@/lib/i18n/orders";
import { interpolate } from "@/lib/i18n/lookup";

/** ML5 i18n: locale for lib label helpers — defaults to bn so
 * existing callers and tests keep the Bengali copy. */
export type LibLocale = "bn" | "en";
const D = (locale?: string): typeof ordersBn =>
  locale === "en" ? ordersEn : ordersBn;


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
    nameBangla: ordersBn.pathaoCourier,
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
    nameBangla: ordersBn.steadfastCourier,
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
    nameBangla: ordersBn.redXLogistics,
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
    nameBangla: ordersBn.eCourier,
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
    zoneNameBangla: ordersBn.dhakaMetro,
    bestCourier: "pathao",
    avgDeliveryHours: 24,
    deliverySuccessRate: 94.2,
    rtoRate: 5.8,
    avgShippingCostTaka: 60,
  },
  {
    district: "Gazipur",
    zone: "dhaka_suburb",
    zoneNameBangla: ordersBn.dhakaSuburb,
    bestCourier: "steadfast",
    avgDeliveryHours: 36,
    deliverySuccessRate: 90.5,
    rtoRate: 9.5,
    avgShippingCostTaka: 100,
  },
  {
    district: "Chittagong",
    zone: "divisional_city",
    zoneNameBangla: ordersBn.divisionalHeadCities,
    bestCourier: "steadfast",
    avgDeliveryHours: 42,
    deliverySuccessRate: 91.8,
    rtoRate: 8.2,
    avgShippingCostTaka: 115,
  },
  {
    district: "Sylhet",
    zone: "divisional_city",
    zoneNameBangla: ordersBn.divisionalHeadCities,
    bestCourier: "pathao",
    avgDeliveryHours: 44,
    deliverySuccessRate: 89.4,
    rtoRate: 10.6,
    avgShippingCostTaka: 120,
  },
  {
    district: "Rajshahi",
    zone: "divisional_city",
    zoneNameBangla: ordersBn.divisionalHeadCities,
    bestCourier: "steadfast",
    avgDeliveryHours: 46,
    deliverySuccessRate: 90.1,
    rtoRate: 9.9,
    avgShippingCostTaka: 115,
  },
  {
    district: "Khulna",
    zone: "divisional_city",
    zoneNameBangla: ordersBn.divisionalHeadCities,
    bestCourier: "steadfast",
    avgDeliveryHours: 45,
    deliverySuccessRate: 88.7,
    rtoRate: 11.3,
    avgShippingCostTaka: 115,
  },
  {
    district: "Cox's Bazar",
    zone: "remote_district",
    zoneNameBangla: ordersBn.coastalDistantDistricts,
    bestCourier: "steadfast",
    avgDeliveryHours: 64,
    deliverySuccessRate: 84.1,
    rtoRate: 15.9,
    avgShippingCostTaka: 130,
  },
  {
    district: "Bandarban",
    zone: "remote_district",
    zoneNameBangla: ordersBn.hillyRemoteAreas,
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
export function identifyDistrictZone(districtOrAddress: string, locale: LibLocale = "bn"): { zone: DistrictZone; nameBangla: string } {
  const d = D(locale);
  const text = (districtOrAddress || "").toLowerCase().trim();

  const isMetro =
    text.includes("dhaka") ||
    text.includes(ordersBn.dhaka) ||
    text.includes("mirpur") ||
    text.includes(ordersBn.mirpur) ||
    text.includes("dhanmondi") ||
    text.includes(ordersBn.dhanmondi) ||
    text.includes("uttara") ||
    text.includes(ordersBn.uttara) ||
    text.includes("gulshan") ||
    text.includes(ordersBn.gulshan) ||
    text.includes("banani") ||
    text.includes(ordersBn.banani) ||
    text.includes("mohammadpur") ||
    text.includes(ordersBn.mohammadpur);

  if (isMetro) {
    return { zone: "dhaka_metro", nameBangla: d.dhakaMetropolitan };
  }

  const isSuburb =
    text.includes("gazipur") ||
    text.includes(ordersBn.gazipur) ||
    text.includes("narayanganj") ||
    text.includes(ordersBn.narayanganj) ||
    text.includes("savar") ||
    text.includes(ordersBn.savar) ||
    text.includes("keraniganj") ||
    text.includes(ordersBn.keraniganj);

  if (isSuburb) {
    return { zone: "dhaka_suburb", nameBangla: d.dhakaSuburbSubUrban };
  }

  const isRemote =
    text.includes("bandarban") ||
    text.includes(ordersBn.bandarban) ||
    text.includes("rangamati") ||
    text.includes(ordersBn.rangamati) ||
    text.includes("khagrachhari") ||
    text.includes(ordersBn.khagrachhari) ||
    text.includes("cox") ||
    text.includes(ordersBn.coxSBazar) ||
    text.includes("teknaf") ||
    text.includes(ordersBn.teknaf) ||
    text.includes("sunamganj") ||
    text.includes(ordersBn.sunamganj) ||
    text.includes("bhola") ||
    text.includes(ordersBn.bhola) ||
    text.includes("char") ||
    text.includes(ordersBn.char);

  if (isRemote) {
    return { zone: "remote_district", nameBangla: d.hillyRemoteCoastalDistricts };
  }

  return { zone: "divisional_city", nameBangla: d.divisionalDistrictCities };
}

/**
 * Recommends the optimal courier for a given destination address/district
 */
export function recommendBestCourier(
  districtOrAddress: string,
  weightGrams = 500,
  codAmountTaka = 1500,
  priority: "speed" | "cost" | "safety" = "speed",
  locale: LibLocale = "bn",
): CourierRecommendation {
  const { zone, nameBangla } = identifyDistrictZone(districtOrAddress, locale);

  if (zone === "dhaka_metro") {
    return {
      recommendedProvider: "pathao",
      providerNameBangla: D(locale).pathaoCourier,
      zone,
      zoneNameBangla: nameBangla,
      estimatedDeliveryDays: D(locale).text1g5kaem,
      estimatedCostTaka: 60 + (weightGrams > 1000 ? Math.ceil((weightGrams - 1000) / 1000) * 15 : 0),
      successRateExpected: 94.5,
      reasonBangla: D(locale).inDhakaMetroPathaoS,
      alternativeProvider: "steadfast",
      alternativeReasonBangla: D(locale).steadfastSReturnRateIs,
    };
  }

  if (zone === "dhaka_suburb") {
    return {
      recommendedProvider: "steadfast",
      providerNameBangla: D(locale).steadfastCourier,
      zone,
      zoneNameBangla: nameBangla,
      estimatedDeliveryDays: D(locale).textaw2pxv,
      estimatedCostTaka: 100,
      successRateExpected: 90.5,
      reasonBangla: D(locale).inTheSavarGazipurHub,
      alternativeProvider: "pathao",
      alternativeReasonBangla: D(locale).pathaoProvidesRegularExpressService,
    };
  }

  if (zone === "remote_district") {
    return {
      recommendedProvider: "steadfast",
      providerNameBangla: D(locale).steadfastCourier,
      zone,
      zoneNameBangla: nameBangla,
      estimatedDeliveryDays: D(locale).text1ssz8b4,
      estimatedCostTaka: 130,
      successRateExpected: 83.0,
      reasonBangla: D(locale).inHillyCoastalUpazilasSteadfast,
      alternativeProvider: "redx",
      alternativeReasonBangla: D(locale).redXSPostalCoverageIs,
    };
  }

  // divisional_city / rest of Bangladesh
  if (priority === "cost") {
    return {
      recommendedProvider: "steadfast",
      providerNameBangla: D(locale).steadfastCourier,
      zone,
      zoneNameBangla: nameBangla,
      estimatedDeliveryDays: D(locale).text18rapd1,
      estimatedCostTaka: 115,
      successRateExpected: 90.0,
      reasonBangla: D(locale).outsideDhakaSteadfastIsThe,
      alternativeProvider: "pathao",
      alternativeReasonBangla: D(locale).pathaoIsFasterButThe,
    };
  }

  return {
    recommendedProvider: "steadfast",
    providerNameBangla: D(locale).steadfastCourier,
    zone,
    zoneNameBangla: nameBangla,
    estimatedDeliveryDays: D(locale).text1qj7g9f,
    estimatedCostTaka: 115,
    successRateExpected: 90.2,
    reasonBangla: D(locale).inDivisionalCitiesSteadfastS,
    alternativeProvider: "pathao",
    alternativeReasonBangla: D(locale).pathaoGivesTheFastestTracking,
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
  locale?: LibLocale;
}): RtoLossReport {
  const locale = params.locale ?? "bn";
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

  let recommendationBangla = D(locale).yourRTORateIsUnder;
  if (rtoPct >= 15) {
    recommendationBangla = interpolate(D(locale).rTORateIsExcessivelyHigh, { rtoPct: rtoPct, savingsWithAdvanceChargeTaka: fmtNumber(locale, savingsWithAdvanceChargeTaka) });
  } else if (rtoPct >= 10) {
    recommendationBangla = interpolate(D(locale).mediumRTOTurnOnPhone, { rtoPct: rtoPct });
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

/** ML5 i18n: locale-aware copies of the provider/district data —
 * the bn constants stay the default for existing consumers. The
 * reverse lookup maps each bn display string back to its dict key. */
const BN_KEY_BY_VALUE: Record<string, string> = Object.fromEntries(
  Object.entries(ordersBn).map(([k, v]) => [v, k]),
);
function localizeValue(locale: LibLocale, bnText: string): string {
  const key = BN_KEY_BY_VALUE[bnText];
  if (!key) return bnText;
  return (D(locale) as Record<string, string>)[key] ?? bnText;
}
export function courierProviders(locale: LibLocale = "bn"): Record<CourierProvider, CourierProviderStats> {
  if (locale === "bn") return COURIER_PROVIDERS;
  return Object.fromEntries(
    Object.entries(COURIER_PROVIDERS).map(([k, v]) => [k, { ...v, nameBangla: localizeValue(locale, v.nameBangla) }]),
  ) as Record<CourierProvider, CourierProviderStats>;
}
export function popularDistricts(locale: LibLocale = "bn"): DistrictSlaMetric[] {
  if (locale === "bn") return POPULAR_DISTRICTS_DATA;
  return POPULAR_DISTRICTS_DATA.map((d) => ({ ...d, zoneNameBangla: localizeValue(locale, d.zoneNameBangla) }));
}
