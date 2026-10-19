"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import Link from "next/link";
import { BD_DISTRICTS, fmtDateTime, fmtNumber, shopSubdomainHost } from "@repo/contracts";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinorTaka, minorToTakaString, takaToMinorString } from "@/lib/storefront-money";
import { ReferralRewardSettingsCard } from "@/components/loyalty-referral-settings";
import { SHOP_SECTION_KEYS, normalizeSectionOrder, type ShopSectionKey } from "@/lib/shop-sections";
import { PushPanel } from "@/components/push-panel";
import { SocialProofSettingsCard } from "@/components/social-proof-settings";
import { EmptyState } from "@repo/ui";
import { useConfirm, useToast } from "@repo/ui/client";

// EC8 staff storefront administration. Consumes
// GET /organizations/:id/storefront (staffState):
//   setting { exists, id?, shopEnabled, shopName, announcementText,
//             showFeatured, showCategories, showSearch, metaDescription,
//             featuredProductIds, domainVerifiedAt, hasDomainVerifyToken }
//   zones[] { id, name, kind, districts, chargeMinor, deliveryDays,
//             freeAboveMinor, active, position }   (money = minor strings)
//   organization { id, slug, customDomain }
//   domain { customDomain, verifiedAt, verifyHost,
//            httpsStatus, httpsStatusDetail, httpsUpdatedAt,
//            customHostnameId }   (OU2: persisted CfS state)
//   districts (64, BD_DISTRICTS)

interface Setting {
  exists: boolean;
  shopEnabled: boolean;
  shopName: string | null;
  announcementText: string | null;
  showFeatured: boolean;
  showCategories: boolean;
  showSearch: boolean;
  // OU8: section customizer.
  showHero?: boolean;
  showBrands?: boolean;
  showBundles?: boolean;
  showFlashSale?: boolean;
  showRecentlyViewed?: boolean;
  sectionOrder?: string[] | null;
  metaDescription: string | null;
  featuredProductIds: string[];
  domainVerifiedAt: string | null;
  hasDomainVerifyToken: boolean;
  // EC18/EC19 (B8)
  featuredMode?: string;
  // EC16: referral discount (percent number; min subtotal minor string)
  referralDiscountPercent?: number | null;
  referralMinSubtotalMinor?: string | null;
  // EC29: gift wrap offer (fee = minor string)
  giftWrapEnabled?: boolean;
  giftWrapFeeMinor?: string | null;
  locale?: string;
  trackingPageEnabled?: boolean;
  returnPolicyText?: string | null;
  deliveryPromiseText?: string | null;
  supportPhone?: string | null;
  // GC1: theme + branding + floating contact buttons.
  themeId?: string;
  faviconUrl?: string | null;
  whatsappNumber?: string | null;
  messengerUrl?: string | null;
  // GB3 (GC8): checkout terms consent.
  requireTermsConsent?: boolean;
  termsUrl?: string | null;
  // GB7 (GC18): tracking & analytics IDs (nullable strings).
  // AB8 (AX23): merchant custom CSS/JS for the shop only.
  customCss?: string | null;
  customJs?: string | null;
  customJsEnabled?: boolean;
  ga4MeasurementId?: string | null;
  gtmContainerId?: string | null;
  googleAdsId?: string | null;
  googleAdsConversionLabel?: string | null;
  searchConsoleVerification?: string | null;
  metaPixelId?: string | null;
  tikTokPixelId?: string | null;
  clarityId?: string | null;
}
interface StorefrontPopup {
  enabled: boolean;
  title: string | null;
  body: string | null;
  imageUrl: string | null;
  ctaText: string | null;
  ctaUrl: string | null;
  trigger: string;
  delaySeconds: number | null;
  scrollPercent: number | null;
  frequencyDays: number | null;
  startsAt: string | null;
  endsAt: string | null;
  showOn: string;
  impressions: number;
  clicks: number;
  // OU8: lead-capture mode.
  mode?: string;
  captureName?: boolean;
  capturePhone?: boolean;
  captureEmail?: boolean;
  successMessage?: string | null;
  captures?: number;
}
interface ShopPageSummary {
  id: string;
  published: boolean;
  isSystem: boolean;
}
interface Slot {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
  districtScope: string[] | null;
  capacityPerDay: number | null;
  active: boolean;
}
interface Zone {
  id: string;
  name: string;
  kind: string;
  districts: string[];
  chargeMinor: string;
  deliveryDays: number | null;
  freeAboveMinor: string | null;
  active: boolean;
  position: number;
}
interface StaffState {
  setting: Setting;
  zones: Zone[];
  slots?: Slot[];
  organization: { id: string; slug: string; customDomain: string | null };
  domain: {
    customDomain: string | null; verifiedAt: string | null; verifyHost: string | null;
    // OU2: Cloudflare-for-SaaS HTTPS state persisted by the API
    // (null status = provisioning never attempted for this domain).
    httpsStatus?: string | null; httpsStatusDetail?: string | null;
    httpsUpdatedAt?: string | null; customHostnameId?: string | null;
  };
  districts: string[];
}
interface RateRule {
  id: string;
  shippingZoneId: string | null;
  minWeightGrams: number | null;
  maxWeightGrams: number | null;
  chargeMinor: string;
  priority: number;
  active: boolean;
}
interface PickupPointRow {
  id: string;
  name: string;
  address: string;
  district: string;
  phone: string | null;
  feeMinor: string;
  active: boolean;
}
interface ProductOpt { id: string; name: string }
interface VerifyTokenOut { domain: string; recordHost: string; recordType: string; recordValue: string; token: string }
interface RoutingOut { routingActive: boolean; checkedUrl: string | null; status?: number; evidence?: string; reason?: string }
// OU2: POST /storefront/domain/https-refresh contract.
interface HttpsRefreshOut { domain: string; httpsStatus: string; httpsStatusDetail: string; customHostnameId: string | null; httpsUpdatedAt: string }
// TD9: POST /storefront/domain/set contract (API worker, parallel build).
interface SetDomainOut { domain: string | null; previousDomain: string | null; verificationReset: boolean }

const SECTION_LABELS: Record<ShopSectionKey, string> = { /* values are commerce dict keys (ML6) */
  hero: "heroShopNameSearch",
  categories: "category",
  brands: "brandFilter",
  bundles: "bundle",
  flash: "flashSale",
  featured: "featuredSection",
  recently: "recentlyViewed",
};

const THEME_OPTIONS = [
  { id: "fashion", labelKey: "fashionClothingAarongYellow", descKey: "text3hckht" },
  { id: "electronics", labelKey: "electronicsGadgetsStarTechRyans", descKey: "techSpecsTableBrandWarranty" },
  { id: "grocery", labelKey: "groceryOrganicFoodsChaldalKhaas", descKey: "textf4l8f8" },
  { id: "beauty", labelKey: "healthBeautyCosmeticsShajgojBanglashoppers", descKey: "text1qjd9le" },
  { id: "furniture", labelKey: "homeDecorFurnitureHATILISHO", descKey: "texthny0gy" },
  { id: "books", labelKey: "booksPublicationsStationeryRokomariBatighar", descKey: "readALittlePreviewerAuthor" },
  { id: "kids", labelKey: "babyCareToysKidsFashion", descKey: "ageBasedSizeSelector100" },
  { id: "automotive", labelKey: "automotiveBikesMotorPartsBikeBD", descKey: "bikeModelFitmentCheckerEngine" },
  { id: "sports", labelKey: "sportsFitnessGymEquipmentDecathlon", descKey: "dumbbellWeightSelectorHomeGym" },
  { id: "jewelry", labelKey: "jewelleryDiamondsLuxuryWatchesApan", descKey: "textvda5ds" },
  { id: "classic", labelKey: "text1kpsfdd", descKey: "familiarBalancedAndStandardShop" },
  { id: "bold", labelKey: "textn660r1", descKey: "bigHeroBoldColorsAnd" },
  { id: "minimal", labelKey: "text1j813lr", descKey: "lightCleanDirectFocusOn" },
  { id: "luxury", labelKey: "texte705qf", descKey: "elegantDarkGoldenVibeJewellery" },
  { id: "organic", labelKey: "textv7ihr3", descKey: "naturalGreenEarthyTonesOrganic" },
  { id: "vibrant", labelKey: "textdbcjrq", descKey: "aTouchOfBrightColors" },
  { id: "modern", labelKey: "texttlaub0", descKey: "highTechFinishGadgetsElectronics" },
  { id: "pastel", labelKey: "text14ixjlb", descKey: "softSweetColorsSkincareCosmetics" },
  { id: "nordic", labelKey: "text1lqinc6", descKey: "scandinavianWoodHomeDecorLifestyle" },
  { id: "midnight", labelKey: "text4jfvrl", descKey: "trueDarkModeNeonStreetwear" },
  { id: "v2", labelKey: "textepts6j", descKey: "modernDesignAppLikeNavigation" },
  { id: "warm", labelKey: "text1gq4lr3", descKey: "softAmberGlowRoundedCorners" },
  { id: "ocean", labelKey: "texthc2e8", descKey: "darkTealHeroTightGrid" },
] as const;

/** GC1: pure-div mini shop mock used as a theme preview (no images). */
function ThemePreview({ theme }: { theme: string }) {
  const styles: Record<string, { wrap: string; header: string; hero: string; tile: string }> = {
    classic: {
      wrap: "rounded-lg border border-slate-200 bg-white",
      header: "h-3 rounded-t-lg bg-indigo-600",
      hero: "mx-2 mt-2 h-9 rounded-md bg-indigo-100",
      tile: "h-7 rounded-md bg-slate-200",
    },
    bold: {
      wrap: "border-2 border-slate-900 bg-white",
      header: "h-4 bg-slate-900",
      hero: "h-11 bg-orange-500",
      tile: "h-7 border-2 border-slate-900 bg-amber-200",
    },
    minimal: {
      wrap: "rounded-sm border border-slate-200 bg-white",
      header: "h-3 border-b border-slate-200 bg-white",
      hero: "mx-3 mt-2 h-7 bg-slate-50",
      tile: "h-7 border border-slate-200 bg-white",
    },
    luxury: {
      wrap: "rounded-lg border border-amber-500/40 bg-zinc-950",
      header: "h-3 bg-gradient-to-r from-amber-600 to-yellow-500",
      hero: "mx-2 mt-2 h-9 rounded-md bg-zinc-900 border border-amber-500/30",
      tile: "h-7 rounded-md bg-zinc-800 border border-amber-500/20",
    },
    organic: {
      wrap: "rounded-xl border border-emerald-200 bg-[#f7f8f5]",
      header: "h-3 bg-emerald-800",
      hero: "mx-2 mt-2 h-9 rounded-lg bg-emerald-100",
      tile: "h-7 rounded-lg bg-emerald-50 border border-emerald-200",
    },
    vibrant: {
      wrap: "rounded-xl border-2 border-violet-200 bg-white",
      header: "h-3 bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500",
      hero: "mx-2 mt-2 h-9 rounded-xl bg-gradient-to-r from-violet-100 to-pink-100",
      tile: "h-7 rounded-xl bg-violet-50 border border-violet-200",
    },
    modern: {
      wrap: "rounded-lg border border-slate-700 bg-slate-950",
      header: "h-3 bg-indigo-600",
      hero: "mx-2 mt-2 h-9 rounded-md bg-slate-900 border border-indigo-500/40",
      tile: "h-7 rounded-md bg-slate-800 border border-slate-700",
    },
    pastel: {
      wrap: "rounded-lg border border-rose-200 bg-rose-50/40",
      header: "h-3 bg-rose-300",
      hero: "mx-2 mt-2 h-9 rounded-lg bg-pink-100",
      tile: "h-7 rounded-lg bg-white border border-rose-100",
    },
    nordic: {
      wrap: "rounded-md border border-stone-300 bg-[#fbf9f5]",
      header: "h-3 bg-stone-700",
      hero: "mx-2 mt-2 h-9 rounded bg-[#ede5d8]",
      tile: "h-7 rounded bg-white border border-stone-200",
    },
    midnight: {
      wrap: "rounded-lg border border-cyan-500/40 bg-[#090d16]",
      header: "h-3 bg-[#0d1424] border-b border-cyan-500/30",
      hero: "mx-2 mt-2 h-9 rounded-md bg-[#0f172a] border border-cyan-500/40",
      tile: "h-7 rounded-md bg-[#0f172a] border border-cyan-900",
    },
    fashion: {
      wrap: "rounded-xl border border-stone-300 bg-[#faf9f6]",
      header: "h-3 bg-neutral-900",
      hero: "mx-2 mt-2 h-10 rounded-lg bg-gradient-to-r from-stone-900 to-neutral-800",
      tile: "h-9 rounded-lg bg-white border border-stone-200 shadow-xs",
    },
    electronics: {
      wrap: "rounded-xl border border-indigo-500/40 bg-[#f4f6f9]",
      header: "h-3 bg-slate-950 border-b border-indigo-500/30",
      hero: "mx-2 mt-2 h-10 rounded-lg bg-gradient-to-r from-slate-950 to-indigo-950 border border-indigo-500/30",
      tile: "h-9 rounded-lg bg-white border border-slate-200 shadow-xs",
    },
    grocery: {
      wrap: "rounded-xl border border-emerald-300 bg-[#f8faf8]",
      header: "h-3 bg-emerald-700",
      hero: "mx-2 mt-2 h-10 rounded-lg bg-gradient-to-r from-emerald-800 to-teal-700",
      tile: "h-9 rounded-lg bg-white border border-emerald-100 shadow-xs",
    },
    beauty: {
      wrap: "rounded-xl border border-pink-300 bg-[#fffafb]",
      header: "h-3 bg-gradient-to-r from-rose-900 to-pink-800",
      hero: "mx-2 mt-2 h-10 rounded-lg bg-gradient-to-r from-rose-950 via-pink-900 to-rose-900",
      tile: "h-9 rounded-lg bg-white border border-pink-100 shadow-xs",
    },
    furniture: {
      wrap: "rounded-xl border border-amber-600/40 bg-[#fcfbf9]",
      header: "h-3 bg-stone-900",
      hero: "mx-2 mt-2 h-10 rounded-lg bg-gradient-to-r from-stone-950 via-amber-950 to-stone-900 border border-amber-600/30",
      tile: "h-9 rounded-lg bg-white border border-stone-200 shadow-xs",
    },
    books: {
      wrap: "rounded-xl border border-amber-900/40 bg-[#fdfcf7]",
      header: "h-3 bg-[#3d1810]",
      hero: "mx-2 mt-2 h-10 rounded-lg bg-gradient-to-r from-amber-950 via-[#3d1810] to-stone-900 border border-amber-500/20",
      tile: "h-9 rounded-lg bg-white border border-amber-200/60 shadow-xs",
    },
    kids: {
      wrap: "rounded-xl border border-sky-300 bg-[#f9fcff]",
      header: "h-3 bg-sky-500",
      hero: "mx-2 mt-2 h-10 rounded-lg bg-gradient-to-r from-sky-400 via-teal-400 to-amber-300 border border-sky-300/40",
      tile: "h-9 rounded-lg bg-white border border-sky-100 shadow-xs",
    },
    automotive: {
      wrap: "rounded-xl border border-red-600/40 bg-[#121316]",
      header: "h-3 bg-red-600",
      hero: "mx-2 mt-2 h-10 rounded-lg bg-gradient-to-r from-zinc-950 via-neutral-900 to-red-950 border border-red-600/30",
      tile: "h-9 rounded-lg bg-zinc-900 border border-zinc-800 shadow-xs",
    },
    sports: {
      wrap: "rounded-xl border border-sky-400/40 bg-[#f8fafc]",
      header: "h-3 bg-sky-700",
      hero: "mx-2 mt-2 h-10 rounded-lg bg-gradient-to-r from-sky-950 via-slate-900 to-cyan-900 border border-sky-500/20",
      tile: "h-9 rounded-lg bg-white border border-slate-200 shadow-xs",
    },
    jewelry: {
      wrap: "rounded-xl border border-amber-500/40 bg-[#1c1917]",
      header: "h-3 bg-amber-600",
      hero: "mx-2 mt-2 h-10 rounded-lg bg-gradient-to-r from-stone-950 via-[#1a1614] to-amber-950 border border-amber-500/30",
      tile: "h-9 rounded-lg bg-[#292524] border border-amber-900/40 shadow-xs",
    },
    v2: {
      wrap: "rounded-xl border border-slate-200 bg-white shadow-sm",
      header: "h-3 rounded-t-xl bg-indigo-600",
      hero: "mx-2 mt-2 h-9 rounded-xl bg-indigo-100",
      tile: "h-7 rounded-xl bg-slate-200",
    },
    warm: {
      wrap: "rounded-2xl border border-amber-200 bg-amber-50",
      header: "h-3 rounded-t-2xl bg-amber-500",
      hero: "mx-2 mt-2 h-9 rounded-2xl bg-amber-100",
      tile: "h-7 rounded-2xl bg-amber-200",
    },
    ocean: {
      wrap: "rounded-lg border border-cyan-200 bg-white",
      header: "h-3 rounded-t-lg bg-cyan-950",
      hero: "mx-2 mt-2 h-9 rounded-lg bg-cyan-900",
      tile: "h-7 rounded-lg bg-cyan-100",
    },
  };
  const s = styles[theme] ?? styles.classic;
  return (
    <div className={`overflow-hidden ${s.wrap}`} aria-hidden="true">
      <div className={s.header} />
      <div className={s.hero} />
      <div className="grid grid-cols-3 gap-1.5 p-2">
        <div className={s.tile} />
        <div className={s.tile} />
        <div className={s.tile} />
      </div>
    </div>
  );
}

function isoToDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function datetimeLocalToIso(value: string): string | null {
  if (!value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const KIND_LABEL: Record<string, string> = {
  inside_dhaka: "insideDhaka",
  outside_dhaka: "outsideDhaka",
  district_list: "specificDistrictList",
  all: "allAreas",
};
const KINDS = Object.keys(KIND_LABEL);

// ED12: in-page section anchors — ids match the section elements below
// (in page order); labels match the section titles.
const SECTION_NAV = [
  { id: "shop-link", labelKey: "yourShopLink" },
  { id: "shop-settings", labelKey: "shopSettings" },
  { id: "referral-rewards", labelKey: "referralReward" },
  { id: "popup", labelKey: "promotionalPopup" },
  { id: "push", labelKey: "webPush" },
  { id: "social-proof", labelKey: "socialProof" },
  { id: "content-pages", labelKey: "contentPage" },
  { id: "blog", labelKey: "blog" },
  { id: "shop-search", labelKey: "shopSearch" },
  { id: "delivery-slots", labelKey: "deliverySlot" },
  { id: "shipping-zones", labelKey: "shippingZonesDeliveryCharges" },
  { id: "rate-rules", labelKey: "weightBasedDeliveryRateRules" },
  { id: "pickup-points", labelKey: "pickupPoint" },
  { id: "checkout-fields", labelKey: "checkoutField" },
  { id: "custom-domain", labelKey: "customDomain" },
] as const;

export default function StorefrontStaffPage() {
  const { dict, t, locale } = useLocale();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [state, setState] = useState<StaffState | null>(null);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  // settings form
  const [shopEnabled, setShopEnabled] = useState(false);
  const [shopName, setShopName] = useState("");
  const [announcementText, setAnnouncementText] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [showFeatured, setShowFeatured] = useState(true);
  const [showCategories, setShowCategories] = useState(true);
  const [showSearch, setShowSearch] = useState(true);
  // OU8: section customizer state.
  const [showHero, setShowHero] = useState(true);
  const [showBrands, setShowBrands] = useState(true);
  const [showBundles, setShowBundles] = useState(true);
  const [showFlashSale, setShowFlashSale] = useState(true);
  const [showRecentlyViewed, setShowRecentlyViewed] = useState(true);
  const [sectionOrder, setSectionOrder] = useState<ShopSectionKey[]>([...SHOP_SECTION_KEYS]);
  const [featuredIds, setFeaturedIds] = useState<string[]>([]);
  // EC18/EC19 (B8) settings
  const [featuredMode, setFeaturedMode] = useState("merchant_picks");
  const [shopLocale, setShopLocale] = useState("bn");
  const [trackingPageEnabled, setTrackingPageEnabled] = useState(true);
  const [deliveryPromiseText, setDeliveryPromiseText] = useState("");
  const [returnPolicyText, setReturnPolicyText] = useState("");
  const [supportPhone, setSupportPhone] = useState("");
  // EC16: referral discount settings
  const [referralDiscountPercent, setReferralDiscountPercent] = useState("");
  const [referralMinSubtotal, setReferralMinSubtotal] = useState("");
  // EC29: gift wrap settings
  const [giftWrapEnabled, setGiftWrapEnabled] = useState(false);
  const [giftWrapFee, setGiftWrapFee] = useState("");
  // GC1: theme / favicon / floating contact buttons (same settings PATCH)
  const [themeId, setThemeId] = useState("classic");
  const [faviconUrl, setFaviconUrl] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [messengerUrl, setMessengerUrl] = useState("");
  // GB3 (GC8): checkout terms consent (same settings PATCH).
  const [requireTermsConsent, setRequireTermsConsent] = useState(false);
  const [termsUrl, setTermsUrl] = useState("");
  // GB7 (GC18): tracking & analytics IDs (same settings PATCH).
  const [ga4MeasurementId, setGa4MeasurementId] = useState("");
  const [gtmContainerId, setGtmContainerId] = useState("");
  const [googleAdsId, setGoogleAdsId] = useState("");
  const [googleAdsConversionLabel, setGoogleAdsConversionLabel] = useState("");
  const [searchConsoleVerification, setSearchConsoleVerification] = useState("");
  const [metaPixelId, setMetaPixelId] = useState("");
  const [tikTokPixelId, setTikTokPixelId] = useState("");
  const [clarityId, setClarityId] = useState("");
  // AB8 (AX23): custom CSS/JS (same settings PATCH).
  const [customCss, setCustomCss] = useState("");
  const [customJs, setCustomJs] = useState("");
  const [customJsEnabled, setCustomJsEnabled] = useState(false);
  // GC2: promotional popup (own GET/PUT endpoints)
  const [popup, setPopup] = useState<StorefrontPopup | null>(null);
  const [popupEnabled, setPopupEnabled] = useState(false);
  const [popupTitle, setPopupTitle] = useState("");
  const [popupBody, setPopupBody] = useState("");
  const [popupImageUrl, setPopupImageUrl] = useState("");
  const [popupCtaText, setPopupCtaText] = useState("");
  const [popupCtaUrl, setPopupCtaUrl] = useState("");
  const [popupTrigger, setPopupTrigger] = useState("delay_seconds");
  const [popupDelaySeconds, setPopupDelaySeconds] = useState("");
  const [popupScrollPercent, setPopupScrollPercent] = useState("");
  const [popupFrequencyDays, setPopupFrequencyDays] = useState("");
  const [popupShowOn, setPopupShowOn] = useState("home");
  const [popupStartsAt, setPopupStartsAt] = useState("");
  const [popupEndsAt, setPopupEndsAt] = useState("");
  const [popupMode, setPopupMode] = useState("promo");
  const [popupCaptureName, setPopupCaptureName] = useState(true);
  const [popupCapturePhone, setPopupCapturePhone] = useState(true);
  const [popupCaptureEmail, setPopupCaptureEmail] = useState(false);
  const [popupSuccessMessage, setPopupSuccessMessage] = useState("");
  const [popupError, setPopupError] = useState("");
  const [popupLoadError, setPopupLoadError] = useState("");
  // GC3: content pages summary for the card (full manager is its own page)
  const [shopPages, setShopPages] = useState<ShopPageSummary[]>([]);
  const [pagesLoadError, setPagesLoadError] = useState("");

  // EC18 delivery slot form
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [sLabel, setSLabel] = useState("");
  const [sStart, setSStart] = useState("09:00");
  const [sEnd, setSEnd] = useState("12:00");
  const [sDistricts, setSDistricts] = useState<string[]>([]);
  const [sCapacity, setSCapacity] = useState("");
  const [sActive, setSActive] = useState(true);
  const [slotError, setSlotError] = useState("");

  // zone form
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [zName, setZName] = useState("");
  const [zKind, setZKind] = useState("district_list");
  const [zDistricts, setZDistricts] = useState<string[]>([]);
  const [zCharge, setZCharge] = useState("");
  const [zFreeAbove, setZFreeAbove] = useState("");
  const [zDays, setZDays] = useState("");
  const [zActive, setZActive] = useState(true);
  const [zPosition, setZPosition] = useState("0");
  const [zoneError, setZoneError] = useState("");

  // EC30: weight-based rate rules
  const [rateRules, setRateRules] = useState<RateRule[]>([]);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [rZoneId, setRZoneId] = useState("");
  const [rMinWeight, setRMinWeight] = useState("");
  const [rMaxWeight, setRMaxWeight] = useState("");
  const [rCharge, setRCharge] = useState("");
  const [rPriority, setRPriority] = useState("0");
  const [rActive, setRActive] = useState(true);
  const [ruleError, setRuleError] = useState("");
  // EC30: pickup points
  const [pickupPoints, setPickupPoints] = useState<PickupPointRow[]>([]);
  const [editingPointId, setEditingPointId] = useState<string | null>(null);
  const [pName, setPName] = useState("");
  const [pAddress, setPAddress] = useState("");
  const [pDistrict, setPDistrict] = useState("");
  const [pPhone, setPPhone] = useState("");
  const [pFee, setPFee] = useState("");
  const [pActive, setPActive] = useState(true);
  const [pointError, setPointError] = useState("");

  // AB4 (AX5): checkout field definitions (own staff API).
  type CheckoutFieldRow = {
    id: string; key: string; label: string; type: string;
    options: string[] | null; required: boolean; appliesTo: string;
    sortOrder: number; active: boolean;
  };
  const [fieldDefs, setFieldDefs] = useState<CheckoutFieldRow[]>([]);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [fKey, setFKey] = useState("");
  const [fLabel, setFLabel] = useState("");
  const [fType, setFType] = useState("text");
  const [fOptions, setFOptions] = useState("");
  const [fRequired, setFRequired] = useState(false);
  const [fAppliesTo, setFAppliesTo] = useState("all");
  const [fSortOrder, setFSortOrder] = useState("0");
  const [fActive, setFActive] = useState(true);
  const [fieldError, setFieldError] = useState("");
  const [fieldLoadError, setFieldLoadError] = useState("");

  // domain
  const [tokenOut, setTokenOut] = useState<VerifyTokenOut | null>(null);
  const [domainError, setDomainError] = useState("");
  const [domainNotice, setDomainNotice] = useState("");
  const [routing, setRouting] = useState<RoutingOut | null>(null);
  // TD9: step-1 domain input (prefilled from state on every load)
  const [domainInput, setDomainInput] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setLoading(false); setError(dict.commerce.noOrganizationSelected); return; }
    setLoading(true);
    try {
      const [s, p] = await Promise.all([
        apiFetch<StaffState>(`/organizations/${orgId}/storefront`),
        apiFetch<{ items: ProductOpt[] }>(`/organizations/${orgId}/products?pageSize=100`).catch(() => ({ items: [] as ProductOpt[] })),
      ]);
      setState(s);
      setDomainInput(s.domain.customDomain ?? "");
      setProducts(p.items ?? []);
      const st = s.setting;
      setShopEnabled(st.shopEnabled);
      setShopName(st.shopName ?? "");
      setAnnouncementText(st.announcementText ?? "");
      setMetaDescription(st.metaDescription ?? "");
      setShowFeatured(st.showFeatured);
      setShowCategories(st.showCategories);
      setShowSearch(st.showSearch);
      setShowHero(st.showHero ?? true);
      setShowBrands(st.showBrands ?? true);
      setShowBundles(st.showBundles ?? true);
      setShowFlashSale(st.showFlashSale ?? true);
      setShowRecentlyViewed(st.showRecentlyViewed ?? true);
      setSectionOrder(normalizeSectionOrder(st.sectionOrder ?? null));
      setFeaturedIds(st.featuredProductIds ?? []);
      setFeaturedMode(st.featuredMode ?? "merchant_picks");
      setShopLocale(st.locale ?? "bn");
      setTrackingPageEnabled(st.trackingPageEnabled ?? true);
      setDeliveryPromiseText(st.deliveryPromiseText ?? "");
      setReturnPolicyText(st.returnPolicyText ?? "");
      setSupportPhone(st.supportPhone ?? "");
      setReferralDiscountPercent(st.referralDiscountPercent != null ? String(st.referralDiscountPercent) : "");
      setReferralMinSubtotal(minorToTakaString(st.referralMinSubtotalMinor));
      setGiftWrapEnabled(st.giftWrapEnabled ?? false);
      setGiftWrapFee(minorToTakaString(st.giftWrapFeeMinor));
      setThemeId(st.themeId ?? "classic");
      setFaviconUrl(st.faviconUrl ?? "");
      setWhatsappNumber(st.whatsappNumber ?? "");
      setMessengerUrl(st.messengerUrl ?? "");
      setRequireTermsConsent(st.requireTermsConsent ?? false);
      setTermsUrl(st.termsUrl ?? "");
      setGa4MeasurementId(st.ga4MeasurementId ?? "");
      setGtmContainerId(st.gtmContainerId ?? "");
      setGoogleAdsId(st.googleAdsId ?? "");
      setGoogleAdsConversionLabel(st.googleAdsConversionLabel ?? "");
      setSearchConsoleVerification(st.searchConsoleVerification ?? "");
      setMetaPixelId(st.metaPixelId ?? "");
      setTikTokPixelId(st.tikTokPixelId ?? "");
      setClarityId(st.clarityId ?? "");
      setCustomCss(st.customCss ?? "");
      setCustomJs(st.customJs ?? "");
      setCustomJsEnabled(st.customJsEnabled ?? false);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.commerce.loadingFailed);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // EC30: rate rules + pickup points load independently of the main
  // staff state (own endpoints, own state).
  const loadPricing = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const [rulesRes, pointsRes] = await Promise.all([
      apiFetch<{ rules: RateRule[] }>(`/organizations/${orgId}/storefront/rate-rules`).catch(() => ({ rules: [] as RateRule[] })),
      apiFetch<{ points: PickupPointRow[] }>(`/organizations/${orgId}/storefront/pickup-points`).catch(() => ({ points: [] as PickupPointRow[] })),
    ]);
    setRateRules(rulesRes.rules ?? []);
    setPickupPoints(pointsRes.points ?? []);
  }, []);
  useEffect(() => { void loadPricing(); }, [loadPricing]);

  // GC2/GC3: popup + content-page counts load independently (own endpoints).
  const loadPopup = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const out = await apiFetch<{ popup: StorefrontPopup | null }>(`/organizations/${orgId}/storefront/popup`);
      const p = out.popup;
      setPopup(p);
      if (p) {
        setPopupEnabled(!!p.enabled);
        setPopupTitle(p.title ?? "");
        setPopupBody(p.body ?? "");
        setPopupImageUrl(p.imageUrl ?? "");
        setPopupCtaText(p.ctaText ?? "");
        setPopupCtaUrl(p.ctaUrl ?? "");
        setPopupTrigger(p.trigger ?? "delay_seconds");
        setPopupDelaySeconds(p.delaySeconds != null ? String(p.delaySeconds) : "");
        setPopupScrollPercent(p.scrollPercent != null ? String(p.scrollPercent) : "");
        setPopupFrequencyDays(p.frequencyDays != null ? String(p.frequencyDays) : "");
        setPopupShowOn(p.showOn ?? "home");
        setPopupStartsAt(isoToDatetimeLocal(p.startsAt));
        setPopupEndsAt(isoToDatetimeLocal(p.endsAt));
        setPopupMode(p.mode ?? "promo");
        setPopupCaptureName(p.captureName ?? true);
        setPopupCapturePhone(p.capturePhone ?? true);
        setPopupCaptureEmail(p.captureEmail ?? false);
        setPopupSuccessMessage(p.successMessage ?? "");
      }
      setPopupLoadError("");
    } catch { setPopupLoadError(dict.commerce.loadingFailed2); }
  }, []);
  useEffect(() => { void loadPopup(); }, [loadPopup]);

  // AB4: checkout field defs load independently (own endpoint).
  const loadFieldDefs = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const out = await apiFetch<unknown>(`/organizations/${orgId}/storefront/checkout-fields`);
      const items = Array.isArray(out)
        ? (out as CheckoutFieldRow[])
        : ((out as { items?: CheckoutFieldRow[]; fields?: CheckoutFieldRow[] }).items
          ?? (out as { fields?: CheckoutFieldRow[] }).fields ?? []);
      setFieldDefs(items);
      setFieldLoadError("");
    } catch { setFieldLoadError(dict.commerce.loadingFailed2); }
  }, []);
  useEffect(() => { void loadFieldDefs(); }, [loadFieldDefs]);

  function resetFieldForm() {
    setEditingFieldId(null); setFKey(""); setFLabel(""); setFType("text");
    setFOptions(""); setFRequired(false); setFAppliesTo("all");
    setFSortOrder("0"); setFActive(true); setFieldError("");
  }
  function startEditField(f: CheckoutFieldRow) {
    setEditingFieldId(f.id); setFKey(f.key); setFLabel(f.label); setFType(f.type);
    setFOptions((f.options ?? []).join("\n"));
    setFRequired(f.required); setFAppliesTo(f.appliesTo || "all");
    setFSortOrder(String(f.sortOrder ?? 0)); setFActive(f.active); setFieldError("");
  }
  async function saveField() {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!fLabel.trim()) { setFieldError(dict.commerce.giveTheFieldALabel); return; }
    if (!editingFieldId && !fKey.trim()) { setFieldError(dict.commerce.giveTheFieldAKey); return; }
    setBusy("field"); setFieldError(""); setError("");
    const options = fType === "select"
      ? fOptions.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
      : null;
    const body: Record<string, unknown> = {
      label: fLabel.trim(),
      type: fType,
      options,
      required: fRequired,
      appliesTo: fAppliesTo,
      sortOrder: parseInt(fSortOrder || "0", 10) || 0,
      active: fActive,
    };
    if (!editingFieldId) body.key = fKey.trim();
    try {
      if (editingFieldId) {
        await apiFetch(`/organizations/${orgId}/storefront/checkout-fields/${editingFieldId}`, { method: "PATCH", body: JSON.stringify(body) });
        toast({ title: dict.commerce.checkoutFieldUpdated, tone: "success" });
      } else {
        await apiFetch(`/organizations/${orgId}/storefront/checkout-fields`, { method: "POST", body: JSON.stringify(body) });
        toast({ title: dict.commerce.newCheckoutFieldCreated, tone: "success" });
      }
      resetFieldForm();
      await loadFieldDefs();
    } catch (e) { setFieldError(e instanceof Error ? e.message : dict.commerce.fieldSaveFailed); }
    finally { setBusy(""); }
  }
  async function deleteField(f: CheckoutFieldRow) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: t("commerce.deleteTheField", { label: f.label }), body: dict.commerce.answersGivenInPreviousOrders, confirmLabel: dict.commerce.delete2, danger: true }))) return;
    setBusy(`field-del-${f.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/storefront/checkout-fields/${f.id}`, { method: "DELETE" });
      toast({ title: dict.commerce.checkoutFieldDeleted, tone: "success" });
      if (editingFieldId === f.id) resetFieldForm();
      await loadFieldDefs();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.deleteFailed); }
    finally { setBusy(""); }
  }

  const loadShopPages = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const out = await apiFetch<{ pages: ShopPageSummary[] }>(`/organizations/${orgId}/storefront/pages`);
      setShopPages(out.pages ?? []);
      setPagesLoadError("");
    } catch { setPagesLoadError(dict.commerce.loadingFailed2); }
  }, []);
  useEffect(() => { void loadShopPages(); }, [loadShopPages]);

  async function savePopup() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("popup"); setPopupError("");
    try {
      const out = await apiFetch<{ popup: StorefrontPopup }>(`/organizations/${orgId}/storefront/popup`, {
        method: "PUT",
        body: JSON.stringify({
          enabled: popupEnabled,
          title: popupTitle.trim() || null,
          body: popupBody.trim() || null,
          imageUrl: popupImageUrl.trim() || null,
          ctaText: popupCtaText.trim() || null,
          ctaUrl: popupCtaUrl.trim() || null,
          trigger: popupTrigger,
          delaySeconds: popupDelaySeconds.trim() ? Number(popupDelaySeconds) : null,
          scrollPercent: popupScrollPercent.trim() ? Number(popupScrollPercent) : null,
          frequencyDays: popupFrequencyDays.trim() ? Number(popupFrequencyDays) : null,
          showOn: popupShowOn,
          startsAt: datetimeLocalToIso(popupStartsAt),
          endsAt: datetimeLocalToIso(popupEndsAt),
          mode: popupMode,
          captureName: popupCaptureName,
          capturePhone: popupCapturePhone,
          captureEmail: popupCaptureEmail,
          successMessage: popupSuccessMessage.trim() || null,
        }),
      });
      if (out.popup) setPopup(out.popup);
      toast({ title: dict.commerce.popupSaved, tone: "success" });
      await loadPopup();
    } catch (e) { setPopupError(e instanceof Error ? e.message : dict.commerce.popupSaveFailed); }
    finally { setBusy(""); }
  }

  const orgSlug = state?.organization.slug ?? "";
  const shopPath = orgSlug ? `/shop/${orgSlug}` : "";
  const districts: readonly string[] = state?.districts?.length ? state.districts : BD_DISTRICTS;

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: t("commerce.copied3", { label: label }), tone: "success" });
    } catch {
      setError(dict.commerce.couldNotCopyCopyThe4);
    }
  }

  async function saveSettings() {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (featuredIds.length > 50) { setError(dict.commerce.featuredProductsCanBeAt); return; }
    if (giftWrapEnabled && giftWrapFee.trim() && takaToMinorString(giftWrapFee) === null) { setError(dict.commerce.giveTheGiftWrapFee); return; }
    setBusy("settings"); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/storefront/settings`, {
        method: "PATCH",
        body: JSON.stringify({
          shopEnabled,
          shopName: shopName.trim() || null,
          announcementText: announcementText.trim() || null,
          metaDescription: metaDescription.trim() || null,
          showFeatured,
          showCategories,
          showSearch,
          showHero,
          showBrands,
          showBundles,
          showFlashSale,
          showRecentlyViewed,
          sectionOrder,
          featuredProductIds: featuredIds,
          featuredMode,
          locale: shopLocale,
          trackingPageEnabled,
          deliveryPromiseText: deliveryPromiseText.trim() || null,
          returnPolicyText: returnPolicyText.trim() || null,
          supportPhone: supportPhone.trim() || null,
          referralDiscountPercent: referralDiscountPercent.trim() ? Number(referralDiscountPercent) : null,
          referralMinSubtotalMinor: referralMinSubtotal.trim() ? takaToMinorString(referralMinSubtotal) : null,
          giftWrapEnabled,
          giftWrapFeeMinor: giftWrapEnabled && giftWrapFee.trim() ? takaToMinorString(giftWrapFee) : null,
          themeId,
          faviconUrl: faviconUrl.trim() || null,
          whatsappNumber: whatsappNumber.trim() || null,
          messengerUrl: messengerUrl.trim() || null,
          requireTermsConsent,
          termsUrl: termsUrl.trim() || null,
          ga4MeasurementId: ga4MeasurementId.trim() || null,
          gtmContainerId: gtmContainerId.trim() || null,
          googleAdsId: googleAdsId.trim() || null,
          googleAdsConversionLabel: googleAdsConversionLabel.trim() || null,
          searchConsoleVerification: searchConsoleVerification.trim() || null,
          metaPixelId: metaPixelId.trim() || null,
          tikTokPixelId: tikTokPixelId.trim() || null,
          clarityId: clarityId.trim() || null,
          // AB8 (AX23): empty = null (feature off); the API
          // validates lengths + rejects closing-tag breakouts
          // with a 400 whose message this page shows verbatim.
          customCss: customCss.trim() || null,
          customJs: customJs.trim() || null,
          customJsEnabled,
        }),
      });
      toast({ title: dict.commerce.shopSettingsSaved, tone: "success" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.saveFailed); }
    finally { setBusy(""); }
  }

  function toggleFeatured(id: string) {
    setFeaturedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 50) { setError(dict.commerce.featuredProductsCanBeAt); return prev; }
      return [...prev, id];
    });
  }

  function resetZoneForm() {
    setEditingZoneId(null); setZName(""); setZKind("district_list"); setZDistricts([]);
    setZCharge(""); setZFreeAbove(""); setZDays(""); setZActive(true); setZPosition("0"); setZoneError("");
  }

  function startEditZone(z: Zone) {
    setEditingZoneId(z.id); setZName(z.name); setZKind(z.kind); setZDistricts(z.districts ?? []);
    setZCharge(minorToTakaString(z.chargeMinor));
    setZFreeAbove(minorToTakaString(z.freeAboveMinor));
    setZDays(z.deliveryDays != null ? String(z.deliveryDays) : "");
    setZActive(z.active); setZPosition(String(z.position ?? 0)); setZoneError("");
  }

  async function saveZone() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const chargeMinor = takaToMinorString(zCharge);
    if (chargeMinor === null) { setZoneError(dict.commerce.giveTheDeliveryChargeIn); return; }
    let freeAboveMinor: string | null = null;
    if (zFreeAbove.trim()) {
      freeAboveMinor = takaToMinorString(zFreeAbove);
      if (freeAboveMinor === null) { setZoneError(dict.commerce.giveTheFreeDeliveryThreshold); return; }
    }
    if (zKind === "district_list" && zDistricts.length === 0) {
      setZoneError(dict.commerce.selectAtLeastOneDistrict);
      return;
    }
    setBusy("zone"); setZoneError(""); setError("");
    const body = {
      name: zName.trim(),
      kind: zKind,
      districts: zKind === "district_list" ? zDistricts : null,
      chargeMinor,
      freeAboveMinor,
      deliveryDays: zDays.trim() ? parseInt(zDays, 10) : null,
      active: zActive,
      position: parseInt(zPosition || "0", 10) || 0,
    };
    try {
      if (editingZoneId) {
        await apiFetch(`/organizations/${orgId}/storefront/zones/${editingZoneId}`, { method: "PATCH", body: JSON.stringify(body) });
        toast({ title: dict.commerce.shippingZoneUpdated, tone: "success" });
      } else {
        await apiFetch(`/organizations/${orgId}/storefront/zones`, { method: "POST", body: JSON.stringify(body) });
        toast({ title: dict.commerce.newShippingZoneCreated, tone: "success" });
      }
      resetZoneForm();
      await load();
    } catch (e) { setZoneError(e instanceof Error ? e.message : dict.commerce.zoneSaveFailed); }
    finally { setBusy(""); }
  }

  async function deleteZone(z: Zone) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: t("commerce.deleteTheZone", { name: z.name }), body: dict.commerce.itWillNoLongerBe, confirmLabel: dict.commerce.delete2, danger: true }))) return;
    setBusy(`zone-del-${z.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/storefront/zones/${z.id}`, { method: "DELETE" });
      toast({ title: dict.commerce.zoneDeleted, tone: "success" });
      if (editingZoneId === z.id) resetZoneForm();
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.deleteFailed); }
    finally { setBusy(""); }
  }

  function resetSlotForm() {
    setEditingSlotId(null); setSLabel(""); setSStart("09:00"); setSEnd("12:00");
    setSDistricts([]); setSCapacity(""); setSActive(true); setSlotError("");
  }

  function startEditSlot(s: Slot) {
    setEditingSlotId(s.id); setSLabel(s.label); setSStart(s.startTime); setSEnd(s.endTime);
    setSDistricts(s.districtScope ?? []);
    setSCapacity(s.capacityPerDay != null ? String(s.capacityPerDay) : "");
    setSActive(s.active); setSlotError("");
  }

  async function saveSlot() {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!sLabel.trim()) { setSlotError(dict.commerce.giveTheSlotALabel); return; }
    if (!/^\d{2}:\d{2}$/.test(sStart) || !/^\d{2}:\d{2}$/.test(sEnd)) { setSlotError(dict.commerce.giveTheTimeInHH); return; }
    let capacityPerDay: number | null = null;
    if (sCapacity.trim()) {
      const n = parseInt(sCapacity, 10);
      if (!Number.isFinite(n) || n < 0 || String(n) !== sCapacity.trim()) { setSlotError(dict.commerce.giveTheDailyCapacityAs); return; }
      capacityPerDay = n;
    }
    setBusy("slot"); setSlotError(""); setError("");
    const body = {
      label: sLabel.trim(),
      startTime: sStart,
      endTime: sEnd,
      districtScope: sDistricts.length > 0 ? sDistricts : null,
      capacityPerDay,
      active: sActive,
    };
    try {
      if (editingSlotId) {
        await apiFetch(`/organizations/${orgId}/storefront/slots/${editingSlotId}`, { method: "PATCH", body: JSON.stringify(body) });
        toast({ title: dict.commerce.deliverySlotUpdated, tone: "success" });
      } else {
        await apiFetch(`/organizations/${orgId}/storefront/slots`, { method: "POST", body: JSON.stringify(body) });
        toast({ title: dict.commerce.newDeliverySlotCreated, tone: "success" });
      }
      resetSlotForm();
      await load();
    } catch (e) { setSlotError(e instanceof Error ? e.message : dict.commerce.slotSaveFailed); }
    finally { setBusy(""); }
  }

  async function deleteSlot(s: Slot) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: t("commerce.deleteTheSlot", { label: s.label }), body: t("commerce.thisDeliverySlotFromWill", { startTime: s.startTime, endTime: s.endTime }), confirmLabel: dict.commerce.delete2, danger: true }))) return;
    setBusy(`slot-del-${s.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/storefront/slots/${s.id}`, { method: "DELETE" });
      toast({ title: dict.commerce.slotDeleted, tone: "success" });
      if (editingSlotId === s.id) resetSlotForm();
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.deleteFailed); }
    finally { setBusy(""); }
  }

  // ---- EC30: rate rules ----
  function weightWindowLabel(r: RateRule): string {
    if (r.minWeightGrams != null && r.maxWeightGrams != null) return t("commerce.grams", { minWeightGrams: r.minWeightGrams, maxWeightGrams: r.maxWeightGrams });
    if (r.minWeightGrams != null) return t("commerce.minimum", { minWeightGrams: r.minWeightGrams });
    if (r.maxWeightGrams != null) return t("commerce.maximum", { maxWeightGrams: r.maxWeightGrams });
    return dict.commerce.anyWeight;
  }
  function zoneNameFor(id: string | null): string {
    if (!id) return dict.commerce.allZones;
    return state?.zones.find((z) => z.id === id)?.name ?? id;
  }
  function resetRuleForm() {
    setEditingRuleId(null); setRZoneId(""); setRMinWeight(""); setRMaxWeight("");
    setRCharge(""); setRPriority("0"); setRActive(true); setRuleError("");
  }
  function startEditRule(r: RateRule) {
    setEditingRuleId(r.id); setRZoneId(r.shippingZoneId ?? "");
    setRMinWeight(r.minWeightGrams != null ? String(r.minWeightGrams) : "");
    setRMaxWeight(r.maxWeightGrams != null ? String(r.maxWeightGrams) : "");
    setRCharge(minorToTakaString(r.chargeMinor));
    setRPriority(String(r.priority ?? 0)); setRActive(r.active); setRuleError("");
  }
  async function saveRule() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const chargeMinor = takaToMinorString(rCharge);
    if (chargeMinor === null) { setRuleError(dict.commerce.giveTheChargeInTaka); return; }
    const parseWeight = (v: string): number | null => {
      if (!v.trim()) return null;
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    if (rMinWeight.trim() && parseWeight(rMinWeight) === null) { setRuleError(dict.commerce.giveTheMinimumWeightAs); return; }
    if (rMaxWeight.trim() && parseWeight(rMaxWeight) === null) { setRuleError(dict.commerce.giveTheMaximumWeightAs); return; }
    setBusy("rule"); setRuleError(""); setError("");
    const body = {
      shippingZoneId: rZoneId ? rZoneId : null,
      minWeightGrams: parseWeight(rMinWeight),
      maxWeightGrams: parseWeight(rMaxWeight),
      chargeMinor,
      priority: parseInt(rPriority || "0", 10) || 0,
      active: rActive,
    };
    try {
      if (editingRuleId) {
        await apiFetch(`/organizations/${orgId}/storefront/rate-rules/${editingRuleId}`, { method: "PATCH", body: JSON.stringify(body) });
        toast({ title: dict.commerce.rateRuleUpdated, tone: "success" });
      } else {
        await apiFetch(`/organizations/${orgId}/storefront/rate-rules`, { method: "POST", body: JSON.stringify(body) });
        toast({ title: dict.commerce.newRateRuleCreated, tone: "success" });
      }
      resetRuleForm();
      await loadPricing();
    } catch (e) { setRuleError(e instanceof Error ? e.message : dict.commerce.ruleSaveFailed); }
    finally { setBusy(""); }
  }
  async function deleteRule(r: RateRule) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: dict.commerce.deleteThisRateRule, body: t("commerce.weightChargeThisRuleWill", { zoneNameFor: zoneNameFor(r.shippingZoneId), weightWindowLabel: weightWindowLabel(r), formatMinorTaka: formatMinorTaka(r.chargeMinor) }), confirmLabel: dict.commerce.delete2, danger: true }))) return;
    setBusy(`rule-del-${r.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/storefront/rate-rules/${r.id}`, { method: "DELETE" });
      toast({ title: dict.commerce.rateRuleDeleted, tone: "success" });
      if (editingRuleId === r.id) resetRuleForm();
      await loadPricing();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.deleteFailed); }
    finally { setBusy(""); }
  }

  // ---- EC30: pickup points ----
  function resetPointForm() {
    setEditingPointId(null); setPName(""); setPAddress(""); setPDistrict("");
    setPPhone(""); setPFee(""); setPActive(true); setPointError("");
  }
  function startEditPoint(p: PickupPointRow) {
    setEditingPointId(p.id); setPName(p.name); setPAddress(p.address); setPDistrict(p.district);
    setPPhone(p.phone ?? ""); setPFee(minorToTakaString(p.feeMinor)); setPActive(p.active); setPointError("");
  }
  async function savePoint() {
    const orgId = getOrganizationId(); if (!orgId) return;
    let feeMinor = "0";
    if (pFee.trim()) {
      const converted = takaToMinorString(pFee);
      if (converted === null) { setPointError(dict.commerce.giveTheFeeInTaka); return; }
      feeMinor = converted;
    }
    setBusy("point"); setPointError(""); setError("");
    const body = {
      name: pName.trim(),
      address: pAddress.trim(),
      district: pDistrict.trim(),
      phone: pPhone.trim() ? pPhone.trim() : null,
      feeMinor,
      active: pActive,
    };
    try {
      if (editingPointId) {
        await apiFetch(`/organizations/${orgId}/storefront/pickup-points/${editingPointId}`, { method: "PATCH", body: JSON.stringify(body) });
        toast({ title: dict.commerce.pickupPointUpdated, tone: "success" });
      } else {
        await apiFetch(`/organizations/${orgId}/storefront/pickup-points`, { method: "POST", body: JSON.stringify(body) });
        toast({ title: dict.commerce.newPickupPointCreated, tone: "success" });
      }
      resetPointForm();
      await loadPricing();
    } catch (e) { setPointError(e instanceof Error ? e.message : dict.commerce.pointSaveFailed); }
    finally { setBusy(""); }
  }
  async function deletePoint(p: PickupPointRow) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: t("commerce.deleteThePickupPoint", { name: p.name }), body: t("commerce.thisPointCanNoLonger", { address: p.address, district: p.district }), confirmLabel: dict.commerce.delete2, danger: true }))) return;
    setBusy(`point-del-${p.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/storefront/pickup-points/${p.id}`, { method: "DELETE" });
      toast({ title: dict.commerce.pickupPointDeleted, tone: "success" });
      if (editingPointId === p.id) resetPointForm();
      await loadPricing();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.deleteFailed); }
    finally { setBusy(""); }
  }

  async function createDefaults() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("defaults"); setError("");
    try {
      const out = await apiFetch<{ created: Zone[]; zones: Zone[] }>(`/organizations/${orgId}/storefront/zones/defaults`, { method: "POST" });
      toast({
        title: out.created.length
          ? t("commerce.defaultZonesCreated", { out: out.created.map((z) => z.name).join(", ") })
          : dict.commerce.insideOutsideDhakaZonesAlready,
        tone: "success",
      });
      await load();
    } catch (e) {
      // Server refusal (e.g. BusinessProfile charges unset) verbatim.
      setError(e instanceof Error ? e.message : dict.commerce.defaultZoneCreationFailed);
    } finally { setBusy(""); }
  }

  async function issueToken() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("token"); setDomainError(""); setRouting(null);
    try {
      const out = await apiFetch<VerifyTokenOut>(`/organizations/${orgId}/storefront/domain/verify-token`, { method: "POST" });
      setTokenOut(out);
      toast({ title: dict.commerce.newVerificationTokenCreated, description: dict.commerce.addTheTXTRecordBelow, tone: "success" });
    } catch (e) { setDomainError(e instanceof Error ? e.message : dict.commerce.tokenCreationFailed); }
    finally { setBusy(""); }
  }

  async function verifyDomain() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("verify"); setDomainError("");
    try {
      const out = await apiFetch<{ verified: boolean; domain: string; verifiedAt: string }>(`/organizations/${orgId}/storefront/domain/verify`, { method: "POST" });
      toast({ title: t("commerce.domainVerified", { domain: out.domain, p1: fmtDateTime(locale, new Date(out.verifiedAt)) }), tone: "success" });
      await load();
    } catch (e) { setDomainError(e instanceof Error ? e.message : dict.commerce.verificationFailed); }
    finally { setBusy(""); }
  }

  // OU2: manual HTTPS (Cloudflare for SaaS) status refresh — the
  // persisted state moves only on this call or on (re-)verification;
  // the result is the API's real adapter outcome, shown verbatim.
  async function refreshHttps() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("https-refresh"); setDomainError("");
    try {
      const out = await apiFetch<HttpsRefreshOut>(`/organizations/${orgId}/storefront/domain/https-refresh`, { method: "POST" });
      toast({ title: t("commerce.hTTPSStatus", { httpsStatus: out.httpsStatus }), description: out.httpsStatusDetail, tone: out.httpsStatus === "active" ? "success" : "info" });
      await load();
    } catch (e) { setDomainError(e instanceof Error ? e.message : dict.commerce.hTTPSStatusRefreshFailed); }
    finally { setBusy(""); }
  }

  async function checkRouting() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("routing"); setDomainError("");
    try {
      const out = await apiFetch<RoutingOut>(`/organizations/${orgId}/storefront/domain/check-routing`, { method: "POST" });
      setRouting(out);
    } catch (e) { setDomainError(e instanceof Error ? e.message : dict.commerce.routingTestFailed); }
    finally { setBusy(""); }
  }

  // TD9: set/change the custom domain. Server rejections (bad format,
  // platform domain, taken by another org) surface verbatim via
  // domainError — no client-side domain rules of our own.
  async function saveDomain() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const domain = domainInput.trim();
    if (!domain) { setDomainError(dict.commerce.writeTheDomainFirstE); return; }
    setBusy("domain-set"); setDomainError(""); setDomainNotice("");
    try {
      const out = await apiFetch<SetDomainOut>(`/organizations/${orgId}/storefront/domain/set`, {
        method: "POST",
        body: JSON.stringify({ domain }),
      });
      if (out.verificationReset) {
        setTokenOut(null);
        setRouting(null);
        setDomainNotice(dict.commerce.domainChangedThePreviousVerification);
      } else {
        setDomainNotice(t("commerce.domainSaved", { out: out.domain ?? domain }));
      }
      await load();
    } catch (e) { setDomainError(e instanceof Error ? e.message : dict.commerce.domainSaveFailed); }
    finally { setBusy(""); }
  }

  async function removeDomain() {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(dict.commerce.removeTheCustomDomainAfter)) return;
    setBusy("domain-remove"); setDomainError(""); setDomainNotice("");
    try {
      await apiFetch<SetDomainOut>(`/organizations/${orgId}/storefront/domain/set`, {
        method: "POST",
        body: JSON.stringify({ domain: null }),
      });
      setTokenOut(null);
      setRouting(null);
      setDomainNotice(dict.commerce.domainRemovedTheSubdomainAddress);
      await load();
    } catch (e) { setDomainError(e instanceof Error ? e.message : dict.commerce.domainRemovalFailed); }
    finally { setBusy(""); }
  }

  if (loading) return <p className="text-sm text-slate-500">{dict.common.loading}</p>;
  if (!state) return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error || dict.commerce.storefrontStateNotFound}</p>;

  const domain = state.domain;
  const customDomain = domain.customDomain;
  const verified = !!domain.verifiedAt;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">{dict.commerce.storefrontShopNativeOnlineShop}</h1>
          <p className="text-sm text-slate-500">
            {dict.commerce.yourOwnShopWithoutWooCommerce}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/commerce/sync" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">← Sync Center</Link>
          <Link href="/dashboard/commerce/discounts" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">{dict.commerce.discountsCoupons}</Link>
          <Link href="/dashboard/commerce/abandoned" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">🛒 Abandoned Carts</Link>
        </div>
      </div>

      {/* ED12: sticky in-page sub-nav — anchor links to each section
          below (single-column layout, so a top chip row). */}
      <nav className="sticky top-2 z-30 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label={dict.commerce.section}>
        {SECTION_NAV.map((n) => (
          <a key={n.id} href={`#${n.id}`} className="inline-flex min-h-[44px] shrink-0 items-center rounded-full bg-white px-3 py-2 text-[13px] font-semibold text-slate-600 shadow-card ring-1 ring-slate-200/70">
            {dict.commerce[n.labelKey as keyof typeof dict.commerce]}
          </a>
        ))}
      </nav>

      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      {/* Live shop link */}
      <div id="shop-link" className="card flex flex-wrap items-center gap-3 p-5 scroll-mt-24">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{dict.commerce.yourShopLink}</div>
          {shopEnabled ? (
            <p className="truncate font-mono text-sm text-indigo-700">{typeof window !== "undefined" ? `${window.location.origin}${shopPath}` : shopPath}</p>
          ) : (
            <p className="text-sm text-slate-500">{dict.commerce.theShopIsCurrentlyClosed}</p>
          )}
        </div>
        {shopPath ? (
          <>
            <button type="button" onClick={() => copyText(typeof window !== "undefined" ? `${window.location.origin}${shopPath}` : shopPath, dict.commerce.shopLink)} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">{dict.commerce.copy2}</button>
            <Link href={shopPath} target="_blank" className="btn-primary">{dict.commerce.viewShop}</Link>
          </>
        ) : null}
      </div>

      {/* TD8: shop addresses — subdomain + custom domain + canonical */}
      <section className="card space-y-3 p-5">
        <div className="font-semibold">{dict.commerce.yourShopAddress}</div>
        {(() => {
          const subdomainHost = shopSubdomainHost(state.organization.slug);
          const subdomainUrl = `https://${subdomainHost}`;
          const canonicalHost = verified && customDomain ? customDomain : subdomainHost;
          return (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{dict.commerce.subdomain}</span>
                <span className="font-mono font-bold text-indigo-700">{subdomainUrl}</span>
                <button type="button" onClick={() => copyText(subdomainUrl, dict.commerce.subdomainAddress)} className="rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold">{dict.commerce.copy2}</button>
                <a href={subdomainUrl} target="_blank" rel="noreferrer" className="rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold">{dict.commerce.open2}</a>
                {canonicalHost === subdomainHost ? <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-700">{dict.commerce.mainCanonicalAddress}</span> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{dict.commerce.customDomain2}</span>
                {customDomain ? (
                  <>
                    <span className="font-mono font-bold">{`https://${customDomain}`}</span>
                    {verified ? (
                      <span className="text-emerald-700">{dict.commerce.verified}{domain.verifiedAt ? ` (${fmtDateTime(locale, new Date(domain.verifiedAt))})` : ""}</span>
                    ) : (
                      <span className="text-amber-700">{dict.commerce.notVerifiedYetVerifyIn}</span>
                    )}
                    {verified && canonicalHost === customDomain ? <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-700">{dict.commerce.mainCanonicalAddress}</span> : null}
                  </>
                ) : (
                  <span className="text-slate-500">{dict.commerce.noCustomDomainIsSet}</span>
                )}
              </div>
              <p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
                {dict.commerce.theSameShopOpensAt}<b>app.qosprey.com</b> {dict.commerce.thereIsNoLoginPage}</p>
            </>
          );
        })()}
      </section>

      {/* Settings */}
      <section id="shop-settings" className="card scroll-mt-24 space-y-4 p-5">
        <div className="font-semibold">{dict.commerce.shopSettings}</div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={shopEnabled} onChange={(e) => setShopEnabled(e.target.checked)} />
          {dict.commerce.enableTheShopShopEnabled}{!state.setting.exists ? <span className="text-xs font-normal text-slate-500">{dict.commerce.noSettingsSavedYet}</span> : null}
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm">{dict.commerce.shopNameEmptyBrandOrganization}<input className="input mt-1" value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder={dict.commerce.eGMyFashionShop} />
          </label>
          <label className="block text-sm">{dict.commerce.announcementBannerAtTheTop}<input className="input mt-1" value={announcementText} onChange={(e) => setAnnouncementText(e.target.value)} placeholder={dict.commerce.eGEidOfferFree} />
          </label>
          <label className="block text-sm md:col-span-2">Meta description (SEO)
            <input className="input mt-1" value={metaDescription} onChange={(e) => setMetaDescription(e.target.value)} placeholder={dict.commerce.aShortDescriptionOfThe} />
          </label>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={showFeatured} onChange={(e) => setShowFeatured(e.target.checked)} /> {dict.commerce.featuredSection}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={showCategories} onChange={(e) => setShowCategories(e.target.checked)} /> {dict.commerce.category}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={showSearch} onChange={(e) => setShowSearch(e.target.checked)} /> {dict.commerce.search}</label>
        </div>
        {/* OU8: section customizer — hide/show + reorder the shop
            home sections. The product grid is not listed: it is
            the shop itself and always renders last. Up/down
            buttons (no drag-drop builder, by design). */}
        <div className="space-y-3 border-t pt-4">
          <div className="font-semibold">{dict.commerce.arrangeHomepageSectionsOU8}</div>
          <p className="text-xs text-slate-500">{dict.commerce.sectionsYouTurnOffWill}</p>
          <div className="space-y-1.5">
            {sectionOrder.map((key, idx) => {
              const vis: Record<ShopSectionKey, boolean> = {
                hero: showHero, categories: showCategories, brands: showBrands, bundles: showBundles,
                flash: showFlashSale, featured: showFeatured, recently: showRecentlyViewed,
              };
              const setters: Record<ShopSectionKey, (v: boolean) => void> = {
                hero: setShowHero, categories: setShowCategories, brands: setShowBrands, bundles: setShowBundles,
                flash: setShowFlashSale, featured: setShowFeatured, recently: setShowRecentlyViewed,
              };
              const move = (dir: -1 | 1) => {
                const j = idx + dir;
                if (j < 0 || j >= sectionOrder.length) return;
                const next = [...sectionOrder];
                [next[idx], next[j]] = [next[j], next[idx]];
                setSectionOrder(next);
              };
              return (
                <div key={key} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <span className="w-6 text-xs font-bold text-slate-400">{idx + 1}.</span>
                  <label className="flex flex-1 items-center gap-2">
                    <input type="checkbox" checked={vis[key]} onChange={(e) => setters[key](e.target.checked)} />
                    {dict.commerce[SECTION_LABELS[key] as keyof typeof dict.commerce]}
                  </label>
                  <button type="button" className="rounded border px-2 py-0.5 text-xs" disabled={idx === 0} onClick={() => move(-1)}>{dict.commerce.up}</button>
                  <button type="button" className="rounded border px-2 py-0.5 text-xs" disabled={idx === sectionOrder.length - 1} onClick={() => move(1)}>{dict.commerce.down}</button>
                </div>
              );
            })}
          </div>
        </div>
        <div className="grid gap-3 border-t pt-4 md:grid-cols-2">
          <label className="block text-sm">{dict.commerce.featuredProductTypeFeaturedMode}<select className="input mt-1" value={featuredMode} onChange={(e) => setFeaturedMode(e.target.value)}>
              <option value="merchant_picks">{dict.commerce.merchantSPicks}</option>
              <option value="top_sellers">{dict.commerce.bestSellingByTheLast}</option>
            </select>
          </label>
          <label className="block text-sm">{dict.commerce.shopLanguageLocale}<select className="input mt-1" value={shopLocale} onChange={(e) => setShopLocale(e.target.value)}>
              <option value="bn">{dict.commerce.bengali}</option>
              <option value="en">English</option>
            </select>
          </label>
          <label className="block text-sm">{dict.commerce.deliveryPromiseShownAtCheckout}<input className="input mt-1" value={deliveryPromiseText} onChange={(e) => setDeliveryPromiseText(e.target.value)} placeholder={dict.commerce.eGDeliveryInDhaka} />
          </label>
          <label className="block text-sm">{dict.commerce.supportPhoneShownAtCheckout}<input className="input mt-1" value={supportPhone} onChange={(e) => setSupportPhone(e.target.value)} placeholder="01XXXXXXXXX" />
          </label>
          <label className="block text-sm md:col-span-2">{dict.commerce.returnPolicyShownInThe}<textarea className="input mt-1" rows={3} value={returnPolicyText} onChange={(e) => setReturnPolicyText(e.target.value)} placeholder={dict.commerce.eGReplacementWithin7} />
          </label>
        </div>
        <div className="space-y-3 border-t pt-4">
          <div className="font-semibold">{dict.commerce.referralDiscount}</div>
          <p className="text-xs text-slate-500">{dict.commerce.whenACustomerGivesTheir}</p>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-sm">{dict.commerce.referralDiscountRateEmptyOff}<input className="input mt-1" type="number" min="0" max="100" value={referralDiscountPercent} onChange={(e) => setReferralDiscountPercent(e.target.value)} placeholder={dict.commerce.eG5} />
            </label>
            <label className="block text-sm">{dict.commerce.minimumSubtotalTakaEmptyNone}<input className="input mt-1" inputMode="decimal" value={referralMinSubtotal} onChange={(e) => setReferralMinSubtotal(e.target.value)} placeholder={dict.commerce.eG500} />
            </label>
          </div>
        </div>
        <div className="space-y-3 border-t pt-4">
          <div className="font-semibold">{dict.commerce.giftWrap}</div>
          <p className="text-xs text-slate-500">{dict.commerce.ifOnBuyersCanAdd}</p>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={giftWrapEnabled} onChange={(e) => setGiftWrapEnabled(e.target.checked)} />
              {dict.commerce.enableGiftWrap}</label>
            <label className="block text-sm">{dict.commerce.wrapFeeTaka}<input className="input mt-1" inputMode="decimal" value={giftWrapFee} onChange={(e) => setGiftWrapFee(e.target.value)} placeholder={dict.commerce.eG50} disabled={!giftWrapEnabled} />
            </label>
          </div>
        </div>
        <div className="space-y-3 border-t pt-4">
          <div className="font-semibold">{dict.commerce.themeFavicon}</div>
          <p className="text-xs text-slate-500">{dict.commerce.chooseTheShopSLook}</p>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5" role="radiogroup" aria-label={dict.commerce.shopTheme}>
            {THEME_OPTIONS.map((t) => {
              const selected = themeId === t.id;
              return (
                <button key={t.id} type="button" role="radio" aria-checked={selected} onClick={() => setThemeId(t.id)}
                  className={`rounded-xl border p-2 text-left transition ${selected ? "border-indigo-600 ring-2 ring-indigo-600" : "border-slate-200 hover:border-slate-300"}`}>
                  <ThemePreview theme={t.id} />
                  <div className="mt-2 flex items-center gap-2 text-sm font-semibold">
                    <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${selected ? "border-indigo-600" : "border-slate-300"}`}>
                      {selected ? <span className="h-2 w-2 rounded-full bg-indigo-600" /> : null}
                    </span>
                    {dict.commerce[t.labelKey as keyof typeof dict.commerce]}
                  </div>
                  <div className="mt-0.5 text-xs font-normal text-slate-500">{dict.commerce[t.descKey as keyof typeof dict.commerce]}</div>
                </button>
              );
            })}
          </div>
          {orgSlug ? (
            <p className="text-xs">
              <a
                href={`${typeof window !== "undefined" ? window.location.origin : ""}${shopPath}?themePreview=v2`}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-indigo-700 underline"
              >
                {dict.commerce.newDesignV2LivePreview}</a>
            </p>
          ) : null}
          <label className="block text-sm">{dict.commerce.faviconURLTheSmallIcon}<div className="mt-1 flex items-center gap-3">
              <input className="input flex-1" value={faviconUrl} onChange={(e) => setFaviconUrl(e.target.value)} placeholder="https://…/favicon.png" />
              {faviconUrl.trim() ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={faviconUrl.trim()} alt={dict.commerce.faviconPreview} className="h-8 w-8 rounded border bg-white object-contain" />
              ) : null}
            </div>
            <span className="mt-1 block text-xs font-normal text-slate-500">{dict.commerce.leaveEmptyToUseThe2}</span>
          </label>
        </div>
        <div className="space-y-3 border-t pt-4">
          <div className="font-semibold">{dict.commerce.contactButtons}</div>
          <p className="text-xs text-slate-500">{dict.commerce.ifFilledAFloatingWhatsApp}</p>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-sm">{dict.commerce.whatsAppNumber}<input className="input mt-1" value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} placeholder="8801XXXXXXXXX" />
              <span className="mt-1 block text-xs font-normal text-slate-500">{dict.commerce.withCountryCodeEG}</span>
            </label>
            <label className="block text-sm">{dict.commerce.messengerLink}<input className="input mt-1" value={messengerUrl} onChange={(e) => setMessengerUrl(e.target.value)} placeholder="https://m.me/yourpage" />
              <span className="mt-1 block text-xs font-normal text-slate-500">{dict.commerce.thePageSMMe}</span>
            </label>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={trackingPageEnabled} onChange={(e) => setTrackingPageEnabled(e.target.checked)} />
          {dict.commerce.enableThePublicOrderTracking}</label>
        {orgSlug && trackingPageEnabled ? (
          <p className="text-xs text-slate-500">{dict.commerce.trackingPage}<span className="font-mono text-indigo-700">{typeof window !== "undefined" ? `${window.location.origin}/track/${orgSlug}` : `/track/${orgSlug}`}</span> {dict.commerce.buyersCanCheckStatusWith}</p>
        ) : null}
        <div className="space-y-3 border-t pt-4">
          <div className="font-semibold">{dict.commerce.terms}</div>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={requireTermsConsent} onChange={(e) => setRequireTermsConsent(e.target.checked)} />
            {dict.commerce.termsConsentRequired}</label>
          <label className="block text-sm">{dict.commerce.termsPageURLOptional}<input className="input mt-1" value={termsUrl} onChange={(e) => setTermsUrl(e.target.value)} placeholder="https://…/terms" />
            <span className="mt-1 block text-xs font-normal text-slate-500">{dict.commerce.withoutAURLTheShop}</span>
          </label>
        </div>
        <div className="space-y-3 border-t pt-4">
          <div className="font-semibold">{dict.commerce.trackingAnalytics}</div>
          <p className="text-xs text-slate-500">{dict.commerce.putYourOwnGoogleAccount}</p>
          {gtmContainerId.trim() && ga4MeasurementId.trim() ? (
            <p className="rounded-lg bg-amber-50 p-3 text-xs font-semibold text-amber-800">
              {dict.commerce.ifYouRunGA4Via}</p>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm">
              <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                <span>📘 Facebook / Meta Pixel ID</span>
                <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">{dict.commerce.multiPixelSupported}</span>
              </span>
              <input
                className="input mt-1 w-full"
                value={metaPixelId}
                onChange={(e) => setMetaPixelId(e.target.value)}
                placeholder={dict.commerce.eG123456789012987654321098}
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                {dict.commerce.putYourMetaPixelID}</span>
            </label>

            <label className="block text-sm">
              <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                <span>🎵 TikTok Pixel ID</span>
                <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">{dict.commerce.multiPixelSupported}</span>
              </span>
              <input
                className="input mt-1 w-full"
                value={tikTokPixelId}
                onChange={(e) => setTikTokPixelId(e.target.value)}
                placeholder={dict.commerce.eGC123456789C987654321}
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                {dict.commerce.pixelIDObtainedFromTikTok}</span>
            </label>

            <label className="block text-sm">
              <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                <span>📊 GA4 Measurement ID</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">{dict.commerce.multiProperty}</span>
              </span>
              <input
                className="input mt-1 w-full"
                value={ga4MeasurementId}
                onChange={(e) => setGa4MeasurementId(e.target.value)}
                placeholder={dict.commerce.gXXXXXXXXXXCommaSeparateIf}
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                {dict.commerce.whereToFindGoogleAnalytics}</span>
            </label>

            <label className="block text-sm">
              <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                <span>{dict.commerce.gTMContainerID}</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">{dict.commerce.multiContainer}</span>
              </span>
              <input
                className="input mt-1 w-full"
                value={gtmContainerId}
                onChange={(e) => setGtmContainerId(e.target.value)}
                placeholder="GTM-XXXXXXX"
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                {dict.commerce.whereToFindGoogleTag}</span>
            </label>

            <label className="block text-sm">
              <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                <span>👁️ Microsoft Clarity Project ID</span>
              </span>
              <input
                className="input mt-1 w-full"
                value={clarityId}
                onChange={(e) => setClarityId(e.target.value)}
                placeholder={dict.commerce.eGAbcdefgh12}
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                {dict.commerce.microsoftClarityProjectIDFor}</span>
            </label>

            <label className="block text-sm">
              <span className="font-semibold text-slate-800">🎯 Google Ads ID</span>
              <input
                className="input mt-1 w-full"
                value={googleAdsId}
                onChange={(e) => setGoogleAdsId(e.target.value)}
                placeholder="AW-XXXXXXXXX"
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                {dict.commerce.whereToFindGoogleAds}</span>
            </label>

            <label className="block text-sm">
              <span className="font-semibold text-slate-800">{dict.commerce.googleAdsConversionLabel}</span>
              <input
                className="input mt-1 w-full"
                value={googleAdsConversionLabel}
                onChange={(e) => setGoogleAdsConversionLabel(e.target.value)}
                placeholder={dict.commerce.eGAbCDEfGhIjK}
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                {dict.commerce.googleAdsConversionActionLabel}</span>
            </label>

            <label className="block text-sm">
              <span className="font-semibold text-slate-800">{dict.commerce.searchConsoleVerificationToken}</span>
              <input
                className="input mt-1 w-full"
                value={searchConsoleVerification}
                onChange={(e) => setSearchConsoleVerification(e.target.value)}
                placeholder={dict.commerce.theContentValueOfThe}
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                {dict.commerce.onlyTheContentTokenOf}</span>
            </label>
          </div>
        </div>
        <div className="space-y-3 border-t pt-4">
          <div className="font-semibold">{dict.commerce.customCSSJS}</div>
          <p className="rounded-lg bg-amber-50 p-3 text-xs font-semibold text-amber-800">
            {dict.commerce.useAtYourOwnResponsibility}</p>
          <p className="text-xs text-slate-500">
            {dict.commerce.theServerDoesNotAccept}</p>
          <label className="block text-sm">{dict.commerce.customCSS}<textarea className="input mt-1 font-mono text-xs" rows={6} value={customCss} onChange={(e) => setCustomCss(e.target.value)} placeholder={".my-class { color: #b91c1c; }"} spellCheck={false} />
          </label>
          <label className="block text-sm">{dict.commerce.customJS}<textarea className="input mt-1 font-mono text-xs" rows={6} value={customJs} onChange={(e) => setCustomJs(e.target.value)} placeholder={"console.log('hello');"} spellCheck={false} />
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={customJsEnabled} onChange={(e) => setCustomJsEnabled(e.target.checked)} />
            {dict.commerce.enableCustomJS}</label>
        </div>
        <div>
          <div className="text-sm font-medium">{dict.commerce.featuredProducts}{featuredIds.length}{dict.commerce.textudn9up}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {products.length === 0 ? <span className="text-xs text-slate-500">{dict.commerce.noProductsFound}</span> : products.map((p) => {
              const on = featuredIds.includes(p.id);
              const order = on ? featuredIds.indexOf(p.id) + 1 : null;
              return (
                <button key={p.id} type="button" onClick={() => toggleFeatured(p.id)}
                  className={`inline-flex min-h-[44px] items-center justify-center rounded-full px-3 py-1 text-xs font-semibold ${on ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                  {order ? `${order}. ` : ""}{p.name}
                </button>
              );
            })}
          </div>
        </div>
        <button type="button" onClick={saveSettings} disabled={busy === "settings"} className="btn-primary disabled:opacity-50">
          {busy === "settings" ? dict.commerce.saving : dict.commerce.saveSettings}
        </button>
      </section>

      {/* AB1 (AX2): referral REWARD settings — the shared card,
          placed beside the buyer-side referral % discount in the
          settings section above (that discount goes to the
          referred buyer; this reward goes to the referrer). The
          same component renders on the loyalty page. */}
      <div id="referral-rewards" className="scroll-mt-24">
        <ReferralRewardSettingsCard />
      </div>

      {/* GC2: promotional popup */}
      <section id="popup" className="card scroll-mt-24 space-y-4 p-5">
        <div className="font-semibold">{dict.commerce.promotionalPopup}</div>
        <p className="text-sm text-slate-600">
          {dict.commerce.status3}<b>{popupEnabled ? dict.commerce.on : dict.commerce.closed}</b>
          {popup ? <> {dict.commerce.impressions}<b>{popup.impressions ?? 0}</b> {dict.commerce.clicks}<b>{popup.clicks ?? 0}</b>{popup.mode === "lead" ? <> {dict.commerce.leadsCollected}<b>{popup.captures ?? 0}</b></> : null}</> : null}
        </p>
        {popupLoadError ? (
          <p className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {popupLoadError}
            <button type="button" onClick={() => void loadPopup()} className="font-semibold underline">{dict.commerce.retry}</button>
          </p>
        ) : null}
        {popupError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{popupError}</p> : null}
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={popupEnabled} onChange={(e) => setPopupEnabled(e.target.checked)} />
              {dict.commerce.enablePopup}</label>
            {/* OU8: popup kind — promo (link button) or lead capture
                (a real form; submissions become CRM Leads). */}
            <label className="block text-sm">{dict.commerce.popupType}<select className="input mt-1" value={popupMode} onChange={(e) => setPopupMode(e.target.value)}>
                <option value="promo">{dict.commerce.promotionButtonLink}</option>
                <option value="lead">{dict.commerce.leadCollectionFormSubmittingCreates}</option>
              </select>
            </label>
            {popupMode === "lead" ? (
              <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                <div className="text-sm font-semibold">{dict.commerce.whatInformationToCollect}</div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={popupCaptureName} onChange={(e) => setPopupCaptureName(e.target.checked)} /> {dict.commerce.name}</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={popupCapturePhone} onChange={(e) => setPopupCapturePhone(e.target.checked)} /> {dict.commerce.phoneNumber}</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={popupCaptureEmail} onChange={(e) => setPopupCaptureEmail(e.target.checked)} /> {dict.commerce.email}</label>
                <label className="block text-sm">{dict.commerce.successMessageOptional}<input className="input mt-1" value={popupSuccessMessage} onChange={(e) => setPopupSuccessMessage(e.target.value)} placeholder={dict.commerce.eGThankYouWe} />
                </label>
                <p className="text-xs text-slate-500">{dict.commerce.inLeadModeTheButton}</p>
              </div>
            ) : null}
            <label className="block text-sm">{dict.commerce.title}<input className="input mt-1" value={popupTitle} onChange={(e) => setPopupTitle(e.target.value)} placeholder={dict.commerce.eGEidOffer20} />
            </label>
            <label className="block text-sm">{dict.commerce.body}<textarea className="input mt-1" rows={3} value={popupBody} onChange={(e) => setPopupBody(e.target.value)} placeholder={dict.commerce.aShortDescriptionOfThe2} />
            </label>
            <label className="block text-sm">{dict.commerce.imageURLOptional}<input className="input mt-1" value={popupImageUrl} onChange={(e) => setPopupImageUrl(e.target.value)} placeholder="https://…" />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-sm">{dict.commerce.buttonTextCTA}<input className="input mt-1" value={popupCtaText} onChange={(e) => setPopupCtaText(e.target.value)} placeholder={dict.commerce.buyNow} />
              </label>
              <label className="block text-sm">{dict.commerce.buttonLinkCTAURL}<input className="input mt-1" value={popupCtaUrl} onChange={(e) => setPopupCtaUrl(e.target.value)} placeholder="https://…" />
              </label>
              <label className="block text-sm">{dict.commerce.whenToShowTrigger}<select className="input mt-1" value={popupTrigger} onChange={(e) => setPopupTrigger(e.target.value)}>
                  <option value="delay_seconds">{dict.commerce.afterAWhile}</option>
                  <option value="scroll_percent">{dict.commerce.onScroll}</option>
                  <option value="exit_intent">{dict.commerce.onExitIntent}</option>
                </select>
              </label>
              <label className="block text-sm">{dict.commerce.whichPageToShowOn}<select className="input mt-1" value={popupShowOn} onChange={(e) => setPopupShowOn(e.target.value)}>
                  <option value="home">{dict.commerce.homepageOnly}</option>
                  <option value="all">{dict.commerce.allPages}</option>
                </select>
              </label>
              {popupTrigger === "delay_seconds" ? (
                <label className="block text-sm">{dict.commerce.delaySeconds}<input className="input mt-1" type="number" min="0" value={popupDelaySeconds} onChange={(e) => setPopupDelaySeconds(e.target.value)} placeholder={dict.commerce.eG52} />
                </label>
              ) : null}
              {popupTrigger === "scroll_percent" ? (
                <label className="block text-sm">{dict.commerce.scroll}<input className="input mt-1" type="number" min="0" max="100" value={popupScrollPercent} onChange={(e) => setPopupScrollPercent(e.target.value)} placeholder={dict.commerce.eG502} />
                </label>
              ) : null}
              <label className="block text-sm">{dict.commerce.gapBeforeShowingToThe}<input className="input mt-1" type="number" min="0" value={popupFrequencyDays} onChange={(e) => setPopupFrequencyDays(e.target.value)} placeholder={dict.commerce.eG7} />
              </label>
              <label className="block text-sm">{dict.commerce.startOptional}<input className="input mt-1" type="datetime-local" value={popupStartsAt} onChange={(e) => setPopupStartsAt(e.target.value)} />
              </label>
              <label className="block text-sm">{dict.commerce.endOptional}<input className="input mt-1" type="datetime-local" value={popupEndsAt} onChange={(e) => setPopupEndsAt(e.target.value)} />
              </label>
            </div>
            <button type="button" onClick={savePopup} disabled={busy === "popup"} className="btn-primary disabled:opacity-50">
              {busy === "popup" ? dict.commerce.saving : dict.commerce.savePopup}
            </button>
          </div>
          <div>
            <div className="text-sm font-medium">{dict.commerce.previewAsBuyersWillSee}</div>
            <div className="mt-2 flex items-center justify-center rounded-xl bg-slate-100 p-6">
              <div className="relative w-full max-w-xs rounded-2xl bg-white p-5 text-center shadow-xl">
                <span className="absolute right-3 top-2 text-lg leading-none text-slate-400" aria-hidden="true">×</span>
                {popupImageUrl.trim() ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={popupImageUrl.trim()} alt="" className="mx-auto mb-3 max-h-36 w-full rounded-lg object-cover" />
                ) : null}
                <div className="text-base font-bold">{popupTitle.trim() || dict.commerce.popupTitle}</div>
                <p className="mt-1 text-sm text-slate-600">{popupBody.trim() || dict.commerce.theOfferDescriptionWillShow}</p>
                <span className="btn-primary mt-3 inline-block">{popupCtaText.trim() || dict.commerce.button}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* AB7 (AX16): web push settings + composer + history,
          beside the GC2 popup card above. */}
      <div id="push" className="scroll-mt-24">
        <PushPanel />
      </div>

      {/* AB7 (AX17): social-proof settings, beside the push card. */}
      <div id="social-proof" className="scroll-mt-24">
        <SocialProofSettingsCard />
      </div>

      {/* GC3: content pages summary */}
      <section id="content-pages" className="card flex flex-wrap items-center gap-3 p-5 scroll-mt-24">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{dict.commerce.contentPage}</div>
          <p className="text-sm text-slate-500">
            {dict.commerce.totalPages}<b>{shopPages.length}</b> {dict.commerce.published3}<b>{shopPages.filter((p) => p.published).length}</b>
            {" "}{dict.commerce.createEditPagesLikeReturn}</p>
        </div>
        <Link href="/dashboard/commerce/storefront/pages" className="btn-primary">{dict.commerce.managePages}</Link>
        {pagesLoadError ? (
          <p className="flex w-full flex-wrap items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {pagesLoadError}
            <button type="button" onClick={() => void loadShopPages()} className="font-semibold underline">{dict.commerce.retry}</button>
          </p>
        ) : null}
      </section>

      {/* AB6 (AX12): blog manager */}
      <section id="blog" className="card flex flex-wrap items-center gap-3 p-5 scroll-mt-24">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{dict.commerce.blog}</div>
          <p className="text-sm text-slate-500">
            {dict.commerce.createEditTheShopS}<span className="font-mono">/blog</span> {dict.commerce.willBeVisibleOnThe}</p>
        </div>
        <Link href="/dashboard/commerce/storefront/blog" className="btn-primary">{dict.commerce.manageBlog}</Link>
      </section>

      {/* AB6 (AX11): search analytics + synonyms */}
      <section id="shop-search" className="card flex flex-wrap items-center gap-3 p-5 scroll-mt-24">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{dict.commerce.shopSearch}</div>
          <p className="text-sm text-slate-500">
            {dict.commerce.searchAnalyticsSynonymsReindexingBased}</p>
        </div>
        <Link href="/dashboard/commerce/storefront/search" className="btn-primary">{dict.commerce.manageSearch}</Link>
      </section>

      {/* EC18: Delivery slots */}
      <section id="delivery-slots" className="card scroll-mt-24 space-y-4 p-5">
        <div className="font-semibold">{dict.commerce.deliverySlot}</div>
        <p className="text-xs text-slate-500">{dict.commerce.buyersCanChooseASlot}</p>

        {(state.slots ?? []).length === 0 ? (
          <EmptyState title={dict.commerce.noDeliverySlotsYet} description={dict.commerce.createBelow} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {(state.slots ?? []).map((s) => (
              <div key={s.id} className={`rounded-xl border p-4 ${s.active ? "bg-white" : "bg-slate-50 opacity-70"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{s.label} <span className="text-sm font-normal text-slate-500">{s.startTime} – {s.endTime}</span></div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <span className={`rounded-full px-2 py-0.5 font-bold ${s.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>{s.active ? dict.commerce.active : dict.commerce.closed}</span>
                      <span>{dict.commerce.capacity}{s.capacityPerDay != null ? t("commerce.perDay", { capacityPerDay: s.capacityPerDay }) : dict.commerce.unlimited2}</span>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => startEditSlot(s)} className="inline-flex min-h-[44px] items-center justify-center rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold">{dict.commerce.edit}</button>
                    <button type="button" onClick={() => void deleteSlot(s)} disabled={busy === `slot-del-${s.id}`} className="inline-flex min-h-[44px] items-center justify-center rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold text-rose-600 disabled:opacity-50">{dict.commerce.delete}</button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {s.districtScope && s.districtScope.length > 0 ? s.districtScope.map((d) => (
                    <span key={d} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">{d}</span>
                  )) : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{dict.commerce.allDistricts}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-3 border-t pt-4">
          <div className="font-semibold">{editingSlotId ? dict.commerce.editSlot : dict.commerce.newSlot}</div>
          {slotError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{slotError}</p> : null}
          <div className="grid gap-3 md:grid-cols-4">
            <label className="block text-sm">{dict.commerce.label}<input className="input mt-1" value={sLabel} onChange={(e) => setSLabel(e.target.value)} placeholder={dict.commerce.eGMorning} />
            </label>
            <label className="block text-sm">{dict.commerce.startHHMm}<input className="input mt-1" type="time" value={sStart} onChange={(e) => setSStart(e.target.value)} />
            </label>
            <label className="block text-sm">{dict.commerce.endHHMm}<input className="input mt-1" type="time" value={sEnd} onChange={(e) => setSEnd(e.target.value)} />
            </label>
            <label className="block text-sm">{dict.commerce.dailyCapacityEmptyUnlimited}<input className="input mt-1" type="number" min="0" value={sCapacity} onChange={(e) => setSCapacity(e.target.value)} placeholder={dict.commerce.unlimited2} />
            </label>
          </div>
          <div>
            <div className="text-sm font-medium">{dict.commerce.districtsSelectNoneAllDistricts}{sDistricts.length}{dict.commerce.selected2}</div>
            <div className="mt-2 flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
              {districts.map((d) => {
                const on = sDistricts.includes(d);
                return (
                  <button key={d} type="button" onClick={() => setSDistricts(on ? sDistricts.filter((x) => x !== d) : [...sDistricts, d])}
                    className={`inline-flex min-h-[44px] items-center justify-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${on ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sActive} onChange={(e) => setSActive(e.target.checked)} /> {dict.commerce.slotActive}</label>
          <div className="flex gap-2">
            <button type="button" onClick={saveSlot} disabled={busy === "slot" || !sLabel.trim()} className="btn-primary disabled:opacity-50">
              {busy === "slot" ? dict.commerce.saving : editingSlotId ? dict.commerce.updateSlot : dict.commerce.createSlot}
            </button>
            {editingSlotId ? <button type="button" onClick={resetSlotForm} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">{dict.common.cancel}</button> : null}
          </div>
        </div>
      </section>

      {/* Shipping zones */}
      <section id="shipping-zones" className="card scroll-mt-24 space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">{dict.commerce.shippingZonesDeliveryCharges}</div>
          <button type="button" onClick={createDefaults} disabled={busy === "defaults"} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold disabled:opacity-50">
            {busy === "defaults" ? dict.commerce.creating : dict.commerce.createInsideOutsideDhakaDefault}
          </button>
        </div>
        <p className="text-xs text-slate-500">{dict.commerce.defaultZonesAreCreatedFrom}</p>

        {state.zones.length === 0 ? (
          <EmptyState title={dict.commerce.noShippingZonesYet} description={dict.commerce.ordersCannotBeTakenAt} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {state.zones.map((z) => (
              <div key={z.id} className={`rounded-xl border p-4 ${z.active ? "bg-white" : "bg-slate-50 opacity-70"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{z.name}</div>
                    <div className="text-xs text-slate-500">{KIND_LABEL[z.kind] ? dict.commerce[KIND_LABEL[z.kind] as keyof typeof dict.commerce] : z.kind} {dict.commerce.position}{z.position} · {z.active ? dict.commerce.active : dict.commerce.closed}</div>
                  </div>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => startEditZone(z)} className="inline-flex min-h-[44px] items-center justify-center rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold">{dict.commerce.edit}</button>
                    <button type="button" onClick={() => void deleteZone(z)} disabled={busy === `zone-del-${z.id}`} className="inline-flex min-h-[44px] items-center justify-center rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold text-rose-600 disabled:opacity-50">{dict.commerce.delete}</button>
                  </div>
                </div>
                <div className="mt-2 space-y-1 text-sm">
                  <div>{dict.commerce.deliveryCharge2}<b>{formatMinorTaka(z.chargeMinor)}</b></div>
                  <div>{dict.commerce.freeDelivery3}{z.freeAboveMinor ? <>{formatMinorTaka(z.freeAboveMinor)} {dict.commerce.onOrdersOfThatOr}</> : "—"}</div>
                  <div>{dict.commerce.time2}{z.deliveryDays != null ? t("commerce.days4", { deliveryDays: z.deliveryDays }) : "—"}</div>
                  {z.kind === "district_list" ? (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {z.districts.map((d) => <span key={d} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">{d}</span>)}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-3 border-t pt-4">
          <div className="font-semibold">{editingZoneId ? dict.commerce.editZone : dict.commerce.newZone}</div>
          {zoneError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{zoneError}</p> : null}
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block text-sm">{dict.commerce.zoneName}<input className="input mt-1" value={zName} onChange={(e) => setZName(e.target.value)} placeholder={dict.commerce.eGInsideDhaka} />
            </label>
            <label className="block text-sm">{dict.commerce.type}<select className="input mt-1" value={zKind} onChange={(e) => setZKind(e.target.value)}>
                {KINDS.map((k) => <option key={k} value={k}>{dict.commerce[KIND_LABEL[k] as keyof typeof dict.commerce]}</option>)}
              </select>
            </label>
            <label className="block text-sm">{dict.commerce.positionSmallerMatchesEarlier}<input className="input mt-1" type="number" value={zPosition} onChange={(e) => setZPosition(e.target.value)} />
            </label>
            <label className="block text-sm">{dict.commerce.deliveryChargeTaka}<input className="input mt-1" inputMode="decimal" value={zCharge} onChange={(e) => setZCharge(e.target.value)} placeholder="60" />
            </label>
            <label className="block text-sm">{dict.commerce.freeDeliveryAboveTakaEmpty}<input className="input mt-1" inputMode="decimal" value={zFreeAbove} onChange={(e) => setZFreeAbove(e.target.value)} placeholder="1000" />
            </label>
            <label className="block text-sm">{dict.commerce.deliveryTimeDaysEmptyNone}<input className="input mt-1" type="number" value={zDays} onChange={(e) => setZDays(e.target.value)} placeholder="2" />
            </label>
          </div>
          {zKind === "district_list" ? (
            <div>
              <div className="text-sm font-medium">{dict.commerce.selectDistricts}{zDistricts.length}{dict.commerce.text1ge21}</div>
              <div className="mt-2 flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
                {districts.map((d) => {
                  const on = zDistricts.includes(d);
                  return (
                    <button key={d} type="button" onClick={() => setZDistricts(on ? zDistricts.filter((x) => x !== d) : [...zDistricts, d])}
                      className={`inline-flex min-h-[44px] items-center justify-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${on ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={zActive} onChange={(e) => setZActive(e.target.checked)} /> {dict.commerce.zoneActive}</label>
          <div className="flex gap-2">
            <button type="button" onClick={saveZone} disabled={busy === "zone" || !zName.trim()} className="btn-primary disabled:opacity-50">
              {busy === "zone" ? dict.commerce.saving : editingZoneId ? dict.commerce.updateZone : dict.commerce.createZone}
            </button>
            {editingZoneId ? <button type="button" onClick={resetZoneForm} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">{dict.common.cancel}</button> : null}
          </div>
        </div>
      </section>

      {/* EC30: weight-based rate rules */}
      <section id="rate-rules" className="card scroll-mt-24 space-y-4 p-5">
        <div className="font-semibold">{dict.commerce.weightBasedDeliveryRateRules}</div>
        <p className="text-xs text-slate-500">{dict.commerce.forHomeDeliveryInsteadOf}</p>
        {rateRules.length === 0 ? (
          <EmptyState title={dict.commerce.noRateRulesYet} description={dict.commerce.createBelow} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {rateRules.map((r) => (
              <div key={r.id} className={`rounded-xl border p-4 ${r.active ? "bg-white" : "bg-slate-50 opacity-70"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{zoneNameFor(r.shippingZoneId)}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <span className={`rounded-full px-2 py-0.5 font-bold ${r.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>{r.active ? dict.commerce.active : dict.commerce.closed}</span>
                      <span>Priority: {r.priority}</span>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => startEditRule(r)} className="inline-flex min-h-[44px] items-center justify-center rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold">{dict.commerce.edit}</button>
                    <button type="button" onClick={() => void deleteRule(r)} disabled={busy === `rule-del-${r.id}`} className="inline-flex min-h-[44px] items-center justify-center rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold text-rose-600 disabled:opacity-50">{dict.commerce.delete}</button>
                  </div>
                </div>
                <div className="mt-2 space-y-1 text-sm">
                  <div>{dict.commerce.weight2}<b>{weightWindowLabel(r)}</b></div>
                  <div>{dict.commerce.charge2}<b>{formatMinorTaka(r.chargeMinor)}</b></div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-3 border-t pt-4">
          <div className="font-semibold">{editingRuleId ? dict.commerce.editRateRule : dict.commerce.newRateRule}</div>
          {ruleError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{ruleError}</p> : null}
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block text-sm">{dict.commerce.zone}<select className="input mt-1" value={rZoneId} onChange={(e) => setRZoneId(e.target.value)}>
                <option value="">{dict.commerce.allZones}</option>
                {(state.zones ?? []).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </label>
            <label className="block text-sm">{dict.commerce.minimumWeightGramsEmptyNo}<input className="input mt-1" type="number" min="0" value={rMinWeight} onChange={(e) => setRMinWeight(e.target.value)} placeholder={dict.commerce.eG0} />
            </label>
            <label className="block text-sm">{dict.commerce.maximumWeightGramsEmptyNo}<input className="input mt-1" type="number" min="0" value={rMaxWeight} onChange={(e) => setRMaxWeight(e.target.value)} placeholder={dict.commerce.eG1000} />
            </label>
            <label className="block text-sm">{dict.commerce.chargeTaka}<input className="input mt-1" inputMode="decimal" value={rCharge} onChange={(e) => setRCharge(e.target.value)} placeholder="60" />
            </label>
            <label className="block text-sm">{dict.commerce.priorityMoreEarlier}<input className="input mt-1" type="number" value={rPriority} onChange={(e) => setRPriority(e.target.value)} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rActive} onChange={(e) => setRActive(e.target.checked)} /> {dict.commerce.ruleActive}</label>
          <div className="flex gap-2">
            <button type="button" onClick={saveRule} disabled={busy === "rule"} className="btn-primary disabled:opacity-50">
              {busy === "rule" ? dict.commerce.saving : editingRuleId ? dict.commerce.updateRule : dict.commerce.createRule}
            </button>
            {editingRuleId ? <button type="button" onClick={resetRuleForm} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">{dict.common.cancel}</button> : null}
          </div>
        </div>
      </section>

      {/* EC30: pickup points */}
      <section id="pickup-points" className="card scroll-mt-24 space-y-4 p-5">
        <div className="font-semibold">{dict.commerce.pickupPoint}</div>
        <p className="text-xs text-slate-500">{dict.commerce.buyersCanChoosePickupInstead}</p>
        {pickupPoints.length === 0 ? (
          <EmptyState title={dict.commerce.noPickupPointsYet} description={dict.commerce.createBelow} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {pickupPoints.map((p) => (
              <div key={p.id} className={`rounded-xl border p-4 ${p.active ? "bg-white" : "bg-slate-50 opacity-70"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{p.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <span className={`rounded-full px-2 py-0.5 font-bold ${p.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>{p.active ? dict.commerce.active : dict.commerce.closed}</span>
                      <span>{p.district}</span>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => startEditPoint(p)} className="inline-flex min-h-[44px] items-center justify-center rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold">{dict.commerce.edit}</button>
                    <button type="button" onClick={() => void deletePoint(p)} disabled={busy === `point-del-${p.id}`} className="inline-flex min-h-[44px] items-center justify-center rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold text-rose-600 disabled:opacity-50">{dict.commerce.delete}</button>
                  </div>
                </div>
                <div className="mt-2 space-y-1 text-sm">
                  <div>{p.address}</div>
                  {p.phone ? <div className="text-slate-500">{dict.commerce.phone2}<span className="font-mono">{p.phone}</span></div> : null}
                  <div>{dict.commerce.fee2}<b>{p.feeMinor === "0" ? dict.commerce.free : formatMinorTaka(p.feeMinor)}</b></div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-3 border-t pt-4">
          <div className="font-semibold">{editingPointId ? dict.commerce.editPickupPoint : dict.commerce.newPickupPoint}</div>
          {pointError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{pointError}</p> : null}
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block text-sm">{dict.commerce.name}<input className="input mt-1" value={pName} onChange={(e) => setPName(e.target.value)} placeholder={dict.commerce.eGKhulnaSadarOutlet} />
            </label>
            <label className="block text-sm">{dict.commerce.district}<select className="input mt-1" value={pDistrict} onChange={(e) => setPDistrict(e.target.value)}>
                <option value="">{dict.commerce.select}</option>
                {districts.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label className="block text-sm">{dict.commerce.phoneOptional}<input className="input mt-1" value={pPhone} onChange={(e) => setPPhone(e.target.value)} placeholder="01XXXXXXXXX" />
            </label>
            <label className="block text-sm md:col-span-2">{dict.commerce.address}<input className="input mt-1" value={pAddress} onChange={(e) => setPAddress(e.target.value)} placeholder={dict.commerce.fullAddressOfTheShop} />
            </label>
            <label className="block text-sm">{dict.commerce.feeTakaEmptyFree}<input className="input mt-1" inputMode="decimal" value={pFee} onChange={(e) => setPFee(e.target.value)} placeholder="0" />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pActive} onChange={(e) => setPActive(e.target.checked)} /> {dict.commerce.pointActive}</label>
          <div className="flex gap-2">
            <button type="button" onClick={savePoint} disabled={busy === "point" || !pName.trim() || !pAddress.trim() || !pDistrict.trim()} className="btn-primary disabled:opacity-50">
              {busy === "point" ? dict.commerce.saving : editingPointId ? dict.commerce.updatePoint : dict.commerce.createPoint}
            </button>
            {editingPointId ? <button type="button" onClick={resetPointForm} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">{dict.common.cancel}</button> : null}
          </div>
        </div>
      </section>

      {/* AB4 (AX5): checkout field definitions */}
      <section id="checkout-fields" className="card scroll-mt-24 space-y-4 p-5">
        <div className="font-semibold">{dict.commerce.checkoutField}</div>
        <p className="text-xs leading-relaxed text-slate-500">
          {dict.commerce.takeExtraInformationFromBuyers}<b>key</b> {dict.commerce.cannotBeChangedAfterCreation}</p>
        {fieldLoadError ? (
          <p className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {fieldLoadError}
            <button type="button" onClick={() => void loadFieldDefs()} className="font-semibold underline">{dict.commerce.retry}</button>
          </p>
        ) : null}
        {fieldDefs.length === 0 ? (
          <EmptyState title={dict.commerce.noCheckoutFieldsYet} description={dict.commerce.createBelow} />
        ) : (
          <div className="space-y-2">
            {fieldDefs.map((f) => (
              <div key={f.id} className={`flex flex-wrap items-center gap-2 rounded-xl border p-3 text-sm ${f.active ? "bg-white" : "bg-slate-50 opacity-70"}`}>
                <span className="font-semibold">{f.label}</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">{f.key}</span>
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
                  {f.type === "textarea" ? dict.commerce.largeText : f.type === "select" ? dict.commerce.pickFromAList : f.type === "checkbox" ? dict.commerce.checkbox : dict.commerce.singleLineText}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                  {f.appliesTo === "shop" ? dict.commerce.shopCheckout : f.appliesTo === "single" ? dict.commerce.singleProduct : f.appliesTo === "landing" ? dict.commerce.landing : dict.commerce.allSurfaces}
                </span>
                {f.required ? <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">{dict.commerce.required2}</span> : null}
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${f.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>{f.active ? dict.commerce.active : dict.commerce.closed}</span>
                <span className="ml-auto flex gap-1.5">
                  <button type="button" onClick={() => startEditField(f)} className="inline-flex min-h-[44px] items-center justify-center rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold">{dict.commerce.edit}</button>
                  <button type="button" onClick={() => void deleteField(f)} disabled={busy === `field-del-${f.id}`} className="inline-flex min-h-[44px] items-center justify-center rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold text-rose-600 disabled:opacity-50">{dict.commerce.delete}</button>
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-3 border-t pt-4">
          <div className="font-semibold">{editingFieldId ? dict.commerce.editCheckoutField : dict.commerce.newCheckoutField}</div>
          {fieldError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{fieldError}</p> : null}
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block text-sm">{dict.commerce.keyEnglishCannotBeChanged}<input className="input mt-1 font-mono" value={fKey} disabled={!!editingFieldId} onChange={(e) => setFKey(e.target.value)} placeholder={dict.commerce.eGGiftNote} />
            </label>
            <label className="block text-sm">{dict.commerce.labelWhatTheBuyerWill}<input className="input mt-1" value={fLabel} onChange={(e) => setFLabel(e.target.value)} placeholder={dict.commerce.eGGiftMessage} />
            </label>
            <label className="block text-sm">{dict.commerce.type}<select className="input mt-1" value={fType} onChange={(e) => setFType(e.target.value)}>
                <option value="text">{dict.commerce.singleLineText}</option>
                <option value="textarea">{dict.commerce.largeText}</option>
                <option value="select">{dict.commerce.pickFromAList}</option>
                <option value="checkbox">{dict.commerce.checkboxYesNo}</option>
              </select>
            </label>
            <label className="block text-sm">{dict.commerce.whichSurfaceToShowOn}<select className="input mt-1" value={fAppliesTo} onChange={(e) => setFAppliesTo(e.target.value)}>
                <option value="all">{dict.commerce.allSurfaces}</option>
                <option value="shop">{dict.commerce.shopCheckout}</option>
                <option value="single">{dict.commerce.singleProduct}</option>
                <option value="landing">{dict.commerce.landing}</option>
              </select>
            </label>
            <label className="block text-sm">{dict.commerce.orderSortOrder}<input className="input mt-1" type="number" value={fSortOrder} onChange={(e) => setFSortOrder(e.target.value)} />
            </label>
            {fType === "select" ? (
              <label className="block text-sm">{dict.commerce.optionsOnePerLine}<textarea className="input mt-1" rows={3} value={fOptions} onChange={(e) => setFOptions(e.target.value)} placeholder={"M\nL\nXL"} />
              </label>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={fRequired} onChange={(e) => setFRequired(e.target.checked)} /> {dict.commerce.requiredNoOrderWithoutAn}</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={fActive} onChange={(e) => setFActive(e.target.checked)} /> {dict.commerce.active}</label>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void saveField()} disabled={busy === "field" || !fLabel.trim() || (!editingFieldId && !fKey.trim())} className="btn-primary disabled:opacity-50">
              {busy === "field" ? dict.commerce.saving : editingFieldId ? dict.commerce.updateField : dict.commerce.createField}
            </button>
            {editingFieldId ? <button type="button" onClick={resetFieldForm} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">{dict.common.cancel}</button> : null}
          </div>
        </div>
      </section>

      {/* TD9: নিজের ডোমেইন — one unified 5-step custom-domain flow */}
      <section className="card space-y-5 p-5">
        <div>
          <div className="font-semibold">{dict.commerce.ownDomain}</div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {dict.commerce.runTheShopOnYour}</p>
        </div>

        {domainError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{domainError}</p> : null}
        {domainNotice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{domainNotice}</p> : null}

        {(() => {
          const stepBadge = "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700";
          const statusMark = (ok: boolean) =>
            `flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${ok ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`;
          const labels = customDomain ? customDomain.split(".").filter(Boolean) : [];
          const isSubdomainStyle = labels.length > 2;
          const hasToken = !!state.setting.hasDomainVerifyToken;
          return (
            <>
              {/* ধাপ ১ — ডোমেইন লেখা ও সেভ */}
              <div className="space-y-2 border-t pt-4">
                <div className="flex items-center gap-2 text-sm">
                  <span className={stepBadge}>{dict.commerce.text1yf}</span>
                  <span className="font-semibold">{dict.commerce.step1WriteSaveThe}</span>
                  {customDomain ? <span className="font-mono font-bold">{customDomain}</span> : <span className="text-slate-500">{dict.commerce.noDomainSetYet}</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    className="input min-w-64 flex-1 font-mono"
                    value={domainInput}
                    onChange={(e) => setDomainInput(e.target.value)}
                    placeholder="dhaka-fashion.com"
                    maxLength={253}
                  />
                  <button type="button" onClick={saveDomain} disabled={busy === "domain-set" || !domainInput.trim()} className="btn-primary disabled:opacity-50">
                    {busy === "domain-set" ? dict.commerce.saving2 : dict.commerce.saveDomain}
                  </button>
                </div>
                <p className="text-xs text-slate-500">{dict.commerce.writeOnlyTheDomainWithout}</p>
              </div>

              {/* ধাপ ২ — TXT যাচাই */}
              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center gap-2 text-sm">
                  <span className={stepBadge}>{dict.commerce.text1yg}</span>
                  <span className="font-semibold">{dict.commerce.step2TXTVerification}</span>
                  {verified ? <span className="text-emerald-700">{dict.commerce.verified2}{domain.verifiedAt ? fmtDateTime(locale, new Date(domain.verifiedAt)) : ""})</span> : <span className="text-slate-500">{dict.commerce.notVerifiedYet}</span>}
                </div>
                {!customDomain ? (
                  <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                    {dict.commerce.thisStepIsCurrentlyInactive}</p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={issueToken} disabled={busy === "token"} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold disabled:opacity-50">
                        {busy === "token" ? dict.commerce.creating : dict.commerce.createVerificationTokenTXT}
                      </button>
                      <button type="button" onClick={verifyDomain} disabled={busy === "verify"} className="btn-primary disabled:opacity-50">
                        {busy === "verify" ? dict.commerce.verifying : dict.commerce.verifyNow}
                      </button>
                    </div>

                    {tokenOut ? (
                      <div className="space-y-2 rounded-xl bg-slate-900 p-4 text-xs text-green-300">
                        <p className="font-sans font-bold text-white">{dict.commerce.addThisTXTRecordIn}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-sans text-slate-300">Host:</span>
                          <code className="rounded bg-slate-800 px-2 py-1">{tokenOut.recordHost}</code>
                          <button type="button" onClick={() => copyText(tokenOut.recordHost, "TXT Host")} className="rounded bg-white px-2 py-1 font-sans font-bold text-slate-900">{dict.commerce.copy}</button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-sans text-slate-300">Type: {tokenOut.recordType} · Value:</span>
                          <code className="break-all rounded bg-slate-800 px-2 py-1">{tokenOut.recordValue}</code>
                          <button type="button" onClick={() => copyText(tokenOut.recordValue, "TXT Value")} className="rounded bg-white px-2 py-1 font-sans font-bold text-slate-900">{dict.commerce.copy}</button>
                        </div>
                        <p className="font-sans text-slate-400">{dict.commerce.afterAddingTheRecordDNS}</p>
                      </div>
                    ) : domain.verifyHost ? (
                      <p className="text-xs text-slate-500">{dict.commerce.theTXTRecordSHost}<code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">{domain.verifyHost}</code> {dict.commerce.theValueWillShowHere}</p>
                    ) : null}
                  </>
                )}
              </div>

              {/* ধাপ ৩ — Routing নির্দেশনা */}
              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center gap-2 text-sm">
                  <span className={stepBadge}>{dict.commerce.text1yh}</span>
                  <span className="font-semibold">{dict.commerce.step3RoutingInstructionsDNS}</span>
                </div>
                {!customDomain ? (
                  <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                    {dict.commerce.saveTheDomainInStep}</p>
                ) : (
                  <>
                    {isSubdomainStyle ? (
                      <div className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">Type:</span>
                          <code className="rounded bg-white px-2 py-1 font-mono ring-1 ring-slate-200">CNAME</code>
                          <span className="font-semibold">Host:</span>
                          <code className="rounded bg-white px-2 py-1 font-mono ring-1 ring-slate-200">{customDomain}</code>
                          <button type="button" onClick={() => copyText(customDomain, "CNAME Host")} className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold">{dict.commerce.copy}</button>
                          <span className="font-semibold">Target:</span>
                          <code className="rounded bg-white px-2 py-1 font-mono ring-1 ring-slate-200">app.qosprey.com</code>
                          <button type="button" onClick={() => copyText("app.qosprey.com", "CNAME Target")} className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold">{dict.commerce.copy}</button>
                        </div>
                        <p className="text-xs leading-relaxed text-slate-500">
                          {dict.commerce.noteDependingOnTheRegistrar}{labels[0]}{dict.commerce.isNeededGiveItPer}</p>
                      </div>
                    ) : (
                      <div className="space-y-3 rounded-xl bg-slate-50 p-4 text-sm">
                        <div className="space-y-1.5">
                          <p><b>{dict.commerce.a}</b> {dict.commerce.atYourRegistrar}<b>CNAME flattening / ALIAS / ANAME</b> {dict.commerce.ifThatFeatureIsAvailable}</p>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">Type:</span>
                            <code className="rounded bg-white px-2 py-1 font-mono ring-1 ring-slate-200">ALIAS / ANAME</code>
                            <span className="font-semibold">Host:</span>
                            <code className="rounded bg-white px-2 py-1 font-mono ring-1 ring-slate-200">@</code>
                            <span className="font-semibold">Target:</span>
                            <code className="rounded bg-white px-2 py-1 font-mono ring-1 ring-slate-200">app.qosprey.com</code>
                            <button type="button" onClick={() => copyText("app.qosprey.com", "ALIAS Target")} className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold">{dict.commerce.copy}</button>
                          </div>
                        </div>
                        <div className="space-y-1.5 border-t border-slate-200 pt-3">
                          <p><b>{dict.commerce.b}</b> {dict.commerce.ifThatFeatureIsNot}<b>{dict.commerce.aRecord}</b> {dict.commerce.give}</p>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">Type:</span>
                            <code className="rounded bg-white px-2 py-1 font-mono ring-1 ring-slate-200">A</code>
                            <span className="font-semibold">Host:</span>
                            <code className="rounded bg-white px-2 py-1 font-mono ring-1 ring-slate-200">@</code>
                            <span className="font-semibold">Value:</span>
                            <span>{dict.commerce.serverIPTheValueOf}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{dict.commerce.theWwwVersionType}</span>
                        <code className="rounded bg-white px-2 py-1 font-mono ring-1 ring-slate-200">CNAME</code>
                        <span className="font-semibold">Host:</span>
                        <code className="rounded bg-white px-2 py-1 font-mono ring-1 ring-slate-200">www</code>
                        <button type="button" onClick={() => copyText("www", "www Host")} className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold">{dict.commerce.copy}</button>
                        <span className="font-semibold">Target:</span>
                        <code className="rounded bg-white px-2 py-1 font-mono ring-1 ring-slate-200">{customDomain}</code>
                        <button type="button" onClick={() => copyText(customDomain, "www Target")} className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold">{dict.commerce.copy}</button>
                      </div>
                      <p className="text-xs leading-relaxed text-slate-500">{dict.commerce.noteTheVerifiedDomainIts}</p>
                    </div>

                    <p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
                      {dict.commerce.rememberPointingTheDomainTo}</p>
                  </>
                )}
              </div>

              {/* ধাপ ৪ — অবস্থা তালিকা */}
              <div className="space-y-2 border-t pt-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className={stepBadge}>{dict.commerce.text1yi}</span>
                  <span className="font-semibold">{dict.commerce.step4Status}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={statusMark(hasToken)}>{hasToken ? "✓" : "…"}</span>
                  <span className="font-semibold">{dict.commerce.tokenGiven}</span>
                  {hasToken ? <span className="text-emerald-700">{dict.commerce.yesTheTXTVerificationToken}</span> : <span className="text-slate-500">{dict.commerce.pendingCreateTheTokenIn}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={statusMark(verified)}>{verified ? "✓" : "…"}</span>
                  <span className="font-semibold">{dict.commerce.verified}</span>
                  {verified ? <span className="text-emerald-700">{dict.commerce.yes}{domain.verifiedAt ? fmtDateTime(locale, new Date(domain.verifiedAt)) : ""})</span> : <span className="text-slate-500">{dict.commerce.pendingNotVerifiedYet}</span>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={statusMark(!!routing?.routingActive)}>{routing?.routingActive ? "✓" : "…"}</span>
                  <span className="font-semibold">{dict.commerce.routingIsFine}</span>
                  {routing?.routingActive ? (
                    <span className="text-emerald-700">{dict.commerce.active2}{routing.evidence ?? routing.checkedUrl}</span>
                  ) : routing ? (
                    <span className="text-amber-700">{dict.commerce.activeNotFound}{routing.reason ?? routing.checkedUrl}</span>
                  ) : (
                    <span className="text-slate-500">{dict.commerce.notTestedYetPressCheck}</span>
                  )}
                  <button type="button" onClick={checkRouting} disabled={busy === "routing" || !verified} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold disabled:opacity-50">
                    {busy === "routing" ? dict.commerce.testing : dict.commerce.routingCheckNow}
                  </button>
                </div>
                {/* OU2: HTTPS সার্টিফিকেট (Cloudflare for SaaS) — the
                    persisted state from the API, never an assumption.
                    null = provisioning never attempted for this
                    domain; not_configured = the platform operator
                    has not enabled CfS yet; active only when
                    Cloudflare itself said both legs are active. */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className={statusMark(domain.httpsStatus === "active")}>{domain.httpsStatus === "active" ? "✓" : "…"}</span>
                  <span className="font-semibold">{dict.commerce.hTTPSCertificateSSL}</span>
                  {domain.httpsStatus === "active" ? (
                    <span className="text-emerald-700">{dict.commerce.activeCloudflareCertificateIsOn}</span>
                  ) : domain.httpsStatus === "pending" ? (
                    <span className="text-amber-700">{dict.commerce.inProgressCertificateIssuingVerifying}</span>
                  ) : domain.httpsStatus === "failed" ? (
                    <span className="text-red-700">{dict.commerce.failed2}</span>
                  ) : domain.httpsStatus === "not_configured" ? (
                    <span className="text-slate-500">{dict.commerce.cloudflareForSaaSIsNot}</span>
                  ) : (
                    <span className="text-slate-500">{dict.commerce.notTriedYetProvisioningStarts}</span>
                  )}
                  <button type="button" onClick={refreshHttps} disabled={busy === "https-refresh" || !verified} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold disabled:opacity-50">
                    {busy === "https-refresh" ? dict.commerce.refreshing : dict.commerce.refreshHTTPSStatus}
                  </button>
                </div>
                {domain.httpsStatusDetail ? (
                  <p className="pl-8 text-xs leading-relaxed text-slate-500">
                    {domain.httpsStatusDetail}
                    {domain.httpsUpdatedAt ? <> {dict.commerce.lastUpdated}{fmtDateTime(locale, new Date(domain.httpsUpdatedAt))}</> : null}
                  </p>
                ) : null}
              </div>

              {/* ধাপ ৫ — বদলানো/সরানো */}
              <div className="space-y-2 border-t pt-4">
                <div className="flex items-center gap-2 text-sm">
                  <span className={stepBadge}>{dict.commerce.text1yj}</span>
                  <span className="font-semibold">{dict.commerce.step5ChangeOrRemove}</span>
                </div>
                <p className="text-xs leading-relaxed text-slate-500">
                  {dict.commerce.toChangeTheDomainWrite}{shopSubdomainHost(state.organization.slug)}{dict.commerce.alwaysStaysTheShopWill}</p>
                <button type="button" onClick={removeDomain} disabled={busy === "domain-remove" || !customDomain} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold text-rose-600 disabled:opacity-50">
                  {busy === "domain-remove" ? dict.commerce.removing : dict.commerce.removeTheDomain}
                </button>
                {!customDomain ? <span className="ml-2 text-xs text-slate-400">{dict.commerce.noDomainSetNothingTo}</span> : null}
              </div>
            </>
          );
        })()}
      </section>
    </div>
  );
}
