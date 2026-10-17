"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BD_DISTRICTS, shopSubdomainHost } from "@repo/contracts";
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

const SECTION_LABELS: Record<ShopSectionKey, string> = {
  hero: "হিরো (দোকানের নাম + সার্চ)",
  categories: "ক্যাটাগরি",
  brands: "ব্র্যান্ড ফিল্টার",
  bundles: "বান্ডল",
  flash: "ফ্ল্যাশ সেল",
  featured: "ফিচার্ড সেকশন",
  recently: "সম্প্রতি দেখা",
};

const THEME_OPTIONS = [
  { id: "fashion", label: "👗 ফ্যাশন ও ক্লদিং (Aarong / Yellow)", desc: "৩:৪ পোর্ট্রেট কার্ড, সাইজ সিলেক্টর ও সাইজ চার্ট গাইড" },
  { id: "electronics", label: "⚡ ইলেকট্রনিক্স ও গ্যাজেটস (Star Tech / Ryans)", desc: "টেক স্পেকস টেবিল, ব্র্যান্ড ওয়ারেন্টি, EMI ক্যালকুলেটর ও গ্যাজেট কম্পেয়ার" },
  { id: "grocery", label: "🛒 গ্রোসারি ও অর্গানিক ফুডস (Chaldal / Khaas Food)", desc: "১ ঘণ্টার এক্সপ্রেস ডেলিভারি, ওজন/কেজি সিলেক্টর ও ইনস্ট্যান্ট কোয়ান্টিটি কাউন্টার" },
  { id: "beauty", label: "💄 হেলথ, বিউটি ও কসমেটিক্স (Shajgoj / Banglashoppers)", desc: "১০০% অরিজিনাল সনদ, স্কিন টাইপ ম্যাচিং, রুটিন কম্বো ও শেড পিকার" },
  { id: "furniture", label: "🛋️ হোম ডেকর ও ফার্নিচার (HATIL / ISHO / Otobi)", desc: "১০ বছরের ওয়ারেন্টি, সেগুন/ওক ফিনিশ সিলেক্টর ও রুম সেট বান্ডেল" },
  { id: "books", label: "📚 বই, প্রকাশনী ও স্টেশনারি (Rokomari / Batighar)", desc: "একটু পড়ে দেখুন প্রিভিউয়ার, লেখক/প্রকাশনী ফিল্টার, বাইন্ডিং সিলেক্টর ও বইমেলা কালেকশন" },
  { id: "kids", label: "🧸 বেবি কেয়ার, টয়স ও কিডস ফ্যাশন (Hopscotch / Babyshop BD)", desc: "বয়স ভিত্তিক সাইজ সিলেক্টর, ১০০% নন-টক্সিক ও BPA-Free গ্যারান্টি, নিউবর্ন গিফট হ্যাম্পার" },
  { id: "automotive", label: "🏍️ অটোমোটিভ, বাইক ও মোটর পার্টস (BikeBD / Motorparts BD)", desc: "বাইক মডেল ফিটমেন্ট চেকার, ইঞ্জিন অয়েল ভিসকোসিটি সিলেক্টর ও সার্ভিসিং কম্বো" },
  { id: "sports", label: "🏋️‍♂️ স্পোর্টস, ফিটনেস ও জিম ইকুইপমেন্ট (Decathlon / Sports World)", desc: "ডাম্বেল/ওজন সিলেক্টর, হোম জিম অ্যাসেম্বলি ও টেকনিশিয়ান রিকোয়েস্ট, অরিজিনাল অ্যাথলেটিক গিয়ার" },
  { id: "jewelry", label: "💎 জুয়েলারি, ডায়মন্ড ও লাক্সারি ওয়াচেস (Apan Jewellers / Diamond World)", desc: "২২ ক্যারেট হলমার্ক গোল্ড সনদ, ডায়মন্ড ৪সি সার্টিফিকেট, রিং সাইজ গাইড ও ব্রাইডাল সেট" },
  { id: "classic", label: "১. ক্লাসিক", desc: "চেনা, ভারসাম্যপূর্ণ ও স্ট্যান্ডার্ড শপ লুক" },
  { id: "bold", label: "২. বোল্ড", desc: "বড় হিরো, গাঢ় রঙ ও নজরকাড়া অফার" },
  { id: "minimal", label: "৩. মিনিমাল", desc: "হালকা, পরিষ্কার, পণ্যে সরাসরি ফোকাস" },
  { id: "luxury", label: "৪. লাক্সারি গোল্ড", desc: "অভিজাত ডার্ক ও গোল্ডেন ভাইব — গয়না ও ঘড়ি" },
  { id: "organic", label: "৫. অর্গানিক নেচার", desc: "প্রাকৃতিক সবুজ ও মাটির টান — অর্গানিক ফুড" },
  { id: "vibrant", label: "৬. ভাইব্রেন্ট পপ", desc: "উজ্জ্বল রঙের ছোঁয়া — ট্রেন্ডি গিফট ও ফ্যাশন" },
  { id: "modern", label: "৭. মডার্ন টেক", desc: "হাই-টেক ফিনিশ — গ্যাজেট ও ইলেকট্রনিক্স" },
  { id: "pastel", label: "৮. প্যাস্টেল সফট", desc: "নরম মিষ্টি রং — স্কিনকেয়ার ও কসমেটিকস" },
  { id: "nordic", label: "৯. নর্ডিক ওয়ার্ম", desc: "স্ক্যান্ডিনেভিয়ান কাঠ — হোম ডেকর ও লাইফস্টাইল" },
  { id: "midnight", label: "১০. মিডনাইট নিয়ন", desc: "ট্রু ডার্ক মোড ও নিয়ন — স্ট্রিটওয়্যার ও ইউথ" },
  { id: "v2", label: "১১. আধুনিক ডিজাইন v2", desc: "আধুনিক ডিজাইন — মোবাইল অ্যাপের মতো নেভিগেশন, ব্র্যান্ড রঙে সব বোতাম" },
  { id: "warm", label: "১২. ওয়ার্ম (OU8)", desc: "নরম আম্বর আভা, গোলগাল কোণ — ফ্যাশন ও লাইফস্টাইল দোকানের জন্য" },
  { id: "ocean", label: "১৩. ওশান (OU8)", desc: "গাঢ় টিল হিরো, টাইট গ্রিড — গ্যাজেট ও ইলেকট্রনিক্স দোকানের জন্য" },
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
  inside_dhaka: "ঢাকার ভিতরে",
  outside_dhaka: "ঢাকার বাইরে",
  district_list: "নির্দিষ্ট জেলা তালিকা",
  all: "সব এলাকা",
};
const KINDS = Object.keys(KIND_LABEL);

// ED12: in-page section anchors — ids match the section elements below
// (in page order); labels match the section titles.
const SECTION_NAV = [
  { id: "shop-link", label: "আপনার দোকানের লিংক" },
  { id: "shop-settings", label: "দোকানের সেটিংস" },
  { id: "referral-rewards", label: "রেফারেল পুরস্কার" },
  { id: "popup", label: "প্রমোশনাল পপআপ" },
  { id: "push", label: "ওয়েব পুশ" },
  { id: "social-proof", label: "সোশ্যাল প্রুফ" },
  { id: "content-pages", label: "কনটেন্ট পেজ" },
  { id: "blog", label: "ব্লগ" },
  { id: "shop-search", label: "দোকানের সার্চ" },
  { id: "delivery-slots", label: "ডেলিভারি স্লট" },
  { id: "shipping-zones", label: "শিপিং জোন ও ডেলিভারি চার্জ" },
  { id: "rate-rules", label: "ওজনভিত্তিক ডেলিভারি রেট রুল" },
  { id: "pickup-points", label: "পিকআপ পয়েন্ট" },
  { id: "checkout-fields", label: "চেকআউট ফিল্ড" },
  { id: "custom-domain", label: "কাস্টম ডোমেইন" },
] as const;

export default function StorefrontStaffPage() {
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
    if (!orgId) { setLoading(false); setError("কোনো Organization নির্বাচিত নেই।"); return; }
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
      setError(e instanceof Error ? e.message : "লোড ব্যর্থ");
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
    } catch { setPopupLoadError("লোড ব্যর্থ হয়েছে"); }
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
    } catch { setFieldLoadError("লোড ব্যর্থ হয়েছে"); }
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
    if (!fLabel.trim()) { setFieldError("ফিল্ডের লেবেল দিন।"); return; }
    if (!editingFieldId && !fKey.trim()) { setFieldError("ফিল্ডের key দিন (ইংরেজি, যেমন: gift_note)।"); return; }
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
        toast({ title: "চেকআউট ফিল্ড আপডেট হয়েছে।", tone: "success" });
      } else {
        await apiFetch(`/organizations/${orgId}/storefront/checkout-fields`, { method: "POST", body: JSON.stringify(body) });
        toast({ title: "নতুন চেকআউট ফিল্ড তৈরি হয়েছে।", tone: "success" });
      }
      resetFieldForm();
      await loadFieldDefs();
    } catch (e) { setFieldError(e instanceof Error ? e.message : "ফিল্ড সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(""); }
  }
  async function deleteField(f: CheckoutFieldRow) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: `"${f.label}" ফিল্ডটি মুছে ফেলবেন?`, body: "আগের অর্ডারে দেওয়া উত্তরগুলো থেকে যাবে।", confirmLabel: "মুছে ফেলুন", danger: true }))) return;
    setBusy(`field-del-${f.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/storefront/checkout-fields/${f.id}`, { method: "DELETE" });
      toast({ title: "চেকআউট ফিল্ড মুছে ফেলা হয়েছে।", tone: "success" });
      if (editingFieldId === f.id) resetFieldForm();
      await loadFieldDefs();
    } catch (e) { setError(e instanceof Error ? e.message : "মুছে ফেলা ব্যর্থ"); }
    finally { setBusy(""); }
  }

  const loadShopPages = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const out = await apiFetch<{ pages: ShopPageSummary[] }>(`/organizations/${orgId}/storefront/pages`);
      setShopPages(out.pages ?? []);
      setPagesLoadError("");
    } catch { setPagesLoadError("লোড ব্যর্থ হয়েছে"); }
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
      toast({ title: "পপআপ সংরক্ষণ হয়েছে।", tone: "success" });
      await loadPopup();
    } catch (e) { setPopupError(e instanceof Error ? e.message : "পপআপ সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(""); }
  }

  const orgSlug = state?.organization.slug ?? "";
  const shopPath = orgSlug ? `/shop/${orgSlug}` : "";
  const districts: readonly string[] = state?.districts?.length ? state.districts : BD_DISTRICTS;

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${label} কপি হয়েছে।`, tone: "success" });
    } catch {
      setError("কপি করা যায়নি — লেখাটি হাতে কপি করুন।");
    }
  }

  async function saveSettings() {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (featuredIds.length > 50) { setError("Featured পণ্য সর্বোচ্চ ৫০টি হতে পারবে।"); return; }
    if (giftWrapEnabled && giftWrapFee.trim() && takaToMinorString(giftWrapFee) === null) { setError("গিফট র‍্যাপের ফি টাকায় সঠিক সংখ্যা দিন (যেমন: 50)।"); return; }
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
      toast({ title: "দোকানের সেটিংস সংরক্ষণ হয়েছে।", tone: "success" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(""); }
  }

  function toggleFeatured(id: string) {
    setFeaturedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 50) { setError("Featured পণ্য সর্বোচ্চ ৫০টি হতে পারবে।"); return prev; }
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
    if (chargeMinor === null) { setZoneError("ডেলিভারি চার্জ টাকায় সঠিক সংখ্যা দিন (যেমন: 60 অথবা 60.50)।"); return; }
    let freeAboveMinor: string | null = null;
    if (zFreeAbove.trim()) {
      freeAboveMinor = takaToMinorString(zFreeAbove);
      if (freeAboveMinor === null) { setZoneError("ফ্রি ডেলিভারির সীমা টাকায় সঠিক সংখ্যা দিন (যেমন: 1000)।"); return; }
    }
    if (zKind === "district_list" && zDistricts.length === 0) {
      setZoneError("জেলা-তালিকা জোনের জন্য অন্তত একটি জেলা বেছে নিন।");
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
        toast({ title: "শিপিং জোন আপডেট হয়েছে।", tone: "success" });
      } else {
        await apiFetch(`/organizations/${orgId}/storefront/zones`, { method: "POST", body: JSON.stringify(body) });
        toast({ title: "নতুন শিপিং জোন তৈরি হয়েছে।", tone: "success" });
      }
      resetZoneForm();
      await load();
    } catch (e) { setZoneError(e instanceof Error ? e.message : "জোন সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function deleteZone(z: Zone) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: `"${z.name}" জোনটি মুছে ফেলবেন?`, body: "এটি আর ডেলিভারি হিসেবে ব্যবহৃত হবে না।", confirmLabel: "মুছে ফেলুন", danger: true }))) return;
    setBusy(`zone-del-${z.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/storefront/zones/${z.id}`, { method: "DELETE" });
      toast({ title: "জোন মুছে ফেলা হয়েছে।", tone: "success" });
      if (editingZoneId === z.id) resetZoneForm();
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "মুছে ফেলা ব্যর্থ"); }
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
    if (!sLabel.trim()) { setSlotError("স্লটের লেবেল দিন (যেমন: সকাল)।"); return; }
    if (!/^\d{2}:\d{2}$/.test(sStart) || !/^\d{2}:\d{2}$/.test(sEnd)) { setSlotError("সময় HH:mm ফরম্যাটে দিন।"); return; }
    let capacityPerDay: number | null = null;
    if (sCapacity.trim()) {
      const n = parseInt(sCapacity, 10);
      if (!Number.isFinite(n) || n < 0 || String(n) !== sCapacity.trim()) { setSlotError("দৈনিক সক্ষমতা পূর্ণ সংখ্যায় দিন, অথবা খালি রাখুন (আনলিমিটেড)।"); return; }
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
        toast({ title: "ডেলিভারি স্লট আপডেট হয়েছে।", tone: "success" });
      } else {
        await apiFetch(`/organizations/${orgId}/storefront/slots`, { method: "POST", body: JSON.stringify(body) });
        toast({ title: "নতুন ডেলিভারি স্লট তৈরি হয়েছে।", tone: "success" });
      }
      resetSlotForm();
      await load();
    } catch (e) { setSlotError(e instanceof Error ? e.message : "স্লট সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function deleteSlot(s: Slot) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: `"${s.label}" স্লটটি মুছে ফেলবেন?`, body: `${s.startTime} – ${s.endTime} সময়ের এই ডেলিভারি স্লটটি আর চেকআউটে দেখাবে না।`, confirmLabel: "মুছে ফেলুন", danger: true }))) return;
    setBusy(`slot-del-${s.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/storefront/slots/${s.id}`, { method: "DELETE" });
      toast({ title: "স্লট মুছে ফেলা হয়েছে।", tone: "success" });
      if (editingSlotId === s.id) resetSlotForm();
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "মুছে ফেলা ব্যর্থ"); }
    finally { setBusy(""); }
  }

  // ---- EC30: rate rules ----
  function weightWindowLabel(r: RateRule): string {
    if (r.minWeightGrams != null && r.maxWeightGrams != null) return `${r.minWeightGrams}–${r.maxWeightGrams} গ্রাম`;
    if (r.minWeightGrams != null) return `সর্বনিম্ন ${r.minWeightGrams}`;
    if (r.maxWeightGrams != null) return `সর্বোচ্চ ${r.maxWeightGrams}`;
    return "যেকোনো ওজন";
  }
  function zoneNameFor(id: string | null): string {
    if (!id) return "সব জোন";
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
    if (chargeMinor === null) { setRuleError("চার্জ টাকায় সঠিক সংখ্যা দিন (যেমন: 60 অথবা 60.50)।"); return; }
    const parseWeight = (v: string): number | null => {
      if (!v.trim()) return null;
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    if (rMinWeight.trim() && parseWeight(rMinWeight) === null) { setRuleError("সর্বনিম্ন ওজন গ্রামে পূর্ণ সংখ্যা দিন, অথবা খালি রাখুন।"); return; }
    if (rMaxWeight.trim() && parseWeight(rMaxWeight) === null) { setRuleError("সর্বোচ্চ ওজন গ্রামে পূর্ণ সংখ্যা দিন, অথবা খালি রাখুন।"); return; }
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
        toast({ title: "রেট রুল আপডেট হয়েছে।", tone: "success" });
      } else {
        await apiFetch(`/organizations/${orgId}/storefront/rate-rules`, { method: "POST", body: JSON.stringify(body) });
        toast({ title: "নতুন রেট রুল তৈরি হয়েছে।", tone: "success" });
      }
      resetRuleForm();
      await loadPricing();
    } catch (e) { setRuleError(e instanceof Error ? e.message : "রুল সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(""); }
  }
  async function deleteRule(r: RateRule) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: "এই রেট রুলটি মুছে ফেলবেন?", body: `${zoneNameFor(r.shippingZoneId)} — ওজন: ${weightWindowLabel(r)}, চার্জ: ${formatMinorTaka(r.chargeMinor)}। এই রুলটি আর ডেলিভারি চার্জে প্রযোজ্য হবে না।`, confirmLabel: "মুছে ফেলুন", danger: true }))) return;
    setBusy(`rule-del-${r.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/storefront/rate-rules/${r.id}`, { method: "DELETE" });
      toast({ title: "রেট রুল মুছে ফেলা হয়েছে।", tone: "success" });
      if (editingRuleId === r.id) resetRuleForm();
      await loadPricing();
    } catch (e) { setError(e instanceof Error ? e.message : "মুছে ফেলা ব্যর্থ"); }
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
      if (converted === null) { setPointError("ফি টাকায় সঠিক সংখ্যা দিন (যেমন: 30 অথবা 30.50), অথবা খালি রাখুন (ফ্রি)।"); return; }
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
        toast({ title: "পিকআপ পয়েন্ট আপডেট হয়েছে।", tone: "success" });
      } else {
        await apiFetch(`/organizations/${orgId}/storefront/pickup-points`, { method: "POST", body: JSON.stringify(body) });
        toast({ title: "নতুন পিকআপ পয়েন্ট তৈরি হয়েছে।", tone: "success" });
      }
      resetPointForm();
      await loadPricing();
    } catch (e) { setPointError(e instanceof Error ? e.message : "পয়েন্ট সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(""); }
  }
  async function deletePoint(p: PickupPointRow) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: `"${p.name}" পিকআপ পয়েন্টটি মুছে ফেলবেন?`, body: `${p.address}, ${p.district} — এই পয়েন্টটি আর চেকআউটে পিকআপ হিসেবে বেছে নেওয়া যাবে না।`, confirmLabel: "মুছে ফেলুন", danger: true }))) return;
    setBusy(`point-del-${p.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/storefront/pickup-points/${p.id}`, { method: "DELETE" });
      toast({ title: "পিকআপ পয়েন্ট মুছে ফেলা হয়েছে।", tone: "success" });
      if (editingPointId === p.id) resetPointForm();
      await loadPricing();
    } catch (e) { setError(e instanceof Error ? e.message : "মুছে ফেলা ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function createDefaults() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("defaults"); setError("");
    try {
      const out = await apiFetch<{ created: Zone[]; zones: Zone[] }>(`/organizations/${orgId}/storefront/zones/defaults`, { method: "POST" });
      toast({
        title: out.created.length
          ? `ডিফল্ট জোন তৈরি হয়েছে: ${out.created.map((z) => z.name).join(", ")}।`
          : "ঢাকার ভিতরে/বাইরে জোন আগেই ছিল — নতুন কিছু তৈরি হয়নি।",
        tone: "success",
      });
      await load();
    } catch (e) {
      // Server refusal (e.g. BusinessProfile charges unset) verbatim.
      setError(e instanceof Error ? e.message : "ডিফল্ট জোন তৈরি ব্যর্থ");
    } finally { setBusy(""); }
  }

  async function issueToken() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("token"); setDomainError(""); setRouting(null);
    try {
      const out = await apiFetch<VerifyTokenOut>(`/organizations/${orgId}/storefront/domain/verify-token`, { method: "POST" });
      setTokenOut(out);
      toast({ title: "নতুন যাচাই টোকেন তৈরি হয়েছে।", description: "নিচের TXT রেকর্ডটি DNS-এ যোগ করুন — আগের যাচাই থাকলে তা নতুন করে প্রমাণ করতে হবে।", tone: "success" });
    } catch (e) { setDomainError(e instanceof Error ? e.message : "টোকেন তৈরি ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function verifyDomain() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("verify"); setDomainError("");
    try {
      const out = await apiFetch<{ verified: boolean; domain: string; verifiedAt: string }>(`/organizations/${orgId}/storefront/domain/verify`, { method: "POST" });
      toast({ title: `ডোমেইন যাচাই হয়েছে: ${out.domain} (${new Date(out.verifiedAt).toLocaleString("bn-BD")})`, tone: "success" });
      await load();
    } catch (e) { setDomainError(e instanceof Error ? e.message : "যাচাই ব্যর্থ"); }
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
      toast({ title: `HTTPS অবস্থা: ${out.httpsStatus}`, description: out.httpsStatusDetail, tone: out.httpsStatus === "active" ? "success" : "info" });
      await load();
    } catch (e) { setDomainError(e instanceof Error ? e.message : "HTTPS অবস্থা refresh ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function checkRouting() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("routing"); setDomainError("");
    try {
      const out = await apiFetch<RoutingOut>(`/organizations/${orgId}/storefront/domain/check-routing`, { method: "POST" });
      setRouting(out);
    } catch (e) { setDomainError(e instanceof Error ? e.message : "Routing পরীক্ষা ব্যর্থ"); }
    finally { setBusy(""); }
  }

  // TD9: set/change the custom domain. Server rejections (bad format,
  // platform domain, taken by another org) surface verbatim via
  // domainError — no client-side domain rules of our own.
  async function saveDomain() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const domain = domainInput.trim();
    if (!domain) { setDomainError("আগে ডোমেইনটি লিখুন (যেমন: dhaka-fashion.com)।"); return; }
    setBusy("domain-set"); setDomainError(""); setDomainNotice("");
    try {
      const out = await apiFetch<SetDomainOut>(`/organizations/${orgId}/storefront/domain/set`, {
        method: "POST",
        body: JSON.stringify({ domain }),
      });
      if (out.verificationReset) {
        setTokenOut(null);
        setRouting(null);
        setDomainNotice("ডোমেইন বদলানো হয়েছে — আগের যাচাই বাতিল হয়েছে, নতুন ডোমেইনের জন্য আবার TXT যাচাই করুন");
      } else {
        setDomainNotice(`ডোমেইন সেভ হয়েছে: ${out.domain ?? domain}`);
      }
      await load();
    } catch (e) { setDomainError(e instanceof Error ? e.message : "ডোমেইন সেভ ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function removeDomain() {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm("কাস্টম ডোমেইনটি সরিয়ে ফেলবেন? এরপর দোকান শুধু আপনার সাবডোমেইন ঠিকানায় খুলবে।")) return;
    setBusy("domain-remove"); setDomainError(""); setDomainNotice("");
    try {
      await apiFetch<SetDomainOut>(`/organizations/${orgId}/storefront/domain/set`, {
        method: "POST",
        body: JSON.stringify({ domain: null }),
      });
      setTokenOut(null);
      setRouting(null);
      setDomainNotice("ডোমেইন সরিয়ে ফেলা হয়েছে — এখন সাবডোমেইন ঠিকানাই আপনার দোকানের ঠিকানা।");
      await load();
    } catch (e) { setDomainError(e instanceof Error ? e.message : "ডোমেইন সরানো ব্যর্থ"); }
    finally { setBusy(""); }
  }

  if (loading) return <p className="text-sm text-slate-500">লোড হচ্ছে…</p>;
  if (!state) return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error || "Storefront state পাওয়া যায়নি।"}</p>;

  const domain = state.domain;
  const customDomain = domain.customDomain;
  const verified = !!domain.verifiedAt;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Storefront / দোকান — নেটিভ অনলাইন শপ</h1>
          <p className="text-sm text-slate-500">
            WooCommerce/Shopify ছাড়াই নিজের দোকান: পণ্য, কার্ট, ক্যাশ-অন-ডেলিভারি চেকআউট, শিপিং জোন ও কাস্টম ডোমেইন — সব এখান থেকে।
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/commerce/sync" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">← Sync Center</Link>
          <Link href="/dashboard/commerce/discounts" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">🏷️ Discounts / কুপন</Link>
          <Link href="/dashboard/commerce/abandoned" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">🛒 Abandoned Carts</Link>
        </div>
      </div>

      {/* ED12: sticky in-page sub-nav — anchor links to each section
          below (single-column layout, so a top chip row). */}
      <nav className="sticky top-2 z-30 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="সেকশন">
        {SECTION_NAV.map((n) => (
          <a key={n.id} href={`#${n.id}`} className="inline-flex min-h-[44px] shrink-0 items-center rounded-full bg-white px-3 py-2 text-[13px] font-semibold text-slate-600 shadow-card ring-1 ring-slate-200/70">
            {n.label}
          </a>
        ))}
      </nav>

      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      {/* Live shop link */}
      <div id="shop-link" className="card flex flex-wrap items-center gap-3 p-5 scroll-mt-24">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">আপনার দোকানের লিংক</div>
          {shopEnabled ? (
            <p className="truncate font-mono text-sm text-indigo-700">{typeof window !== "undefined" ? `${window.location.origin}${shopPath}` : shopPath}</p>
          ) : (
            <p className="text-sm text-slate-500">দোকান এখন বন্ধ আছে — নিচে &ldquo;দোকান চালু করুন&rdquo; অন করে সেভ করলে লিংকটি live হবে। বন্ধ থাকলে লিংকে গেলে 404 দেখাবে।</p>
          )}
        </div>
        {shopPath ? (
          <>
            <button type="button" onClick={() => copyText(typeof window !== "undefined" ? `${window.location.origin}${shopPath}` : shopPath, "দোকানের লিংক")} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">কপি করুন</button>
            <Link href={shopPath} target="_blank" className="btn-primary">দোকান দেখুন ↗</Link>
          </>
        ) : null}
      </div>

      {/* TD8: shop addresses — subdomain + custom domain + canonical */}
      <section className="card space-y-3 p-5">
        <div className="font-semibold">আপনার দোকানের ঠিকানা</div>
        {(() => {
          const subdomainHost = shopSubdomainHost(state.organization.slug);
          const subdomainUrl = `https://${subdomainHost}`;
          const canonicalHost = verified && customDomain ? customDomain : subdomainHost;
          return (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">সাবডোমেইন:</span>
                <span className="font-mono font-bold text-indigo-700">{subdomainUrl}</span>
                <button type="button" onClick={() => copyText(subdomainUrl, "সাবডোমেইন ঠিকানা")} className="rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold">কপি করুন</button>
                <a href={subdomainUrl} target="_blank" rel="noreferrer" className="rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold">খুলুন ↗</a>
                {canonicalHost === subdomainHost ? <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-700">প্রধান (canonical) ঠিকানা</span> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">কাস্টম ডোমেইন:</span>
                {customDomain ? (
                  <>
                    <span className="font-mono font-bold">{`https://${customDomain}`}</span>
                    {verified ? (
                      <span className="text-emerald-700">যাচাই হয়েছে{domain.verifiedAt ? ` (${new Date(domain.verifiedAt).toLocaleString("bn-BD")})` : ""}</span>
                    ) : (
                      <span className="text-amber-700">এখনো যাচাই হয়নি — নিচের “কাস্টম ডোমেইন” ধাপে যাচাই করুন</span>
                    )}
                    {verified && canonicalHost === customDomain ? <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-700">প্রধান (canonical) ঠিকানা</span> : null}
                  </>
                ) : (
                  <span className="text-slate-500">কোনো কাস্টম ডোমেইন সেট করা নেই — আপাতত সাবডোমেইন ঠিকানাই আপনার দোকানের ঠিকানা।</span>
                )}
              </div>
              <p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
                দুই ঠিকানাতেই একই দোকান খোলে; প্রধান (canonical) ঠিকানাটাই সার্চ ইঞ্জিন ও শেয়ারে ব্যবহৃত হয় —
                কাস্টম ডোমেইন যাচাই করা থাকলে সেটাই প্রধান, নইলে সাবডোমেইন। মনে রাখবেন: দোকান পরিচালনার প্যানেলে
                লগইন শুধু <b>app.qosprey.com</b> থেকে হয় — দোকানের ঠিকানায় কোনো লগইন পেজ নেই, প্যানেলের পথে গেলে
                স্বয়ংক্রিয়ভাবে app.qosprey.com-এ পাঠিয়ে দেওয়া হয়।
              </p>
            </>
          );
        })()}
      </section>

      {/* Settings */}
      <section id="shop-settings" className="card scroll-mt-24 space-y-4 p-5">
        <div className="font-semibold">দোকানের সেটিংস</div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={shopEnabled} onChange={(e) => setShopEnabled(e.target.checked)} />
          দোকান চালু করুন (shopEnabled) {!state.setting.exists ? <span className="text-xs font-normal text-slate-500">— এখনো কোনো সেটিংস সেভ হয়নি</span> : null}
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm">দোকানের নাম (খালি = ব্র্যান্ড/সংস্থার নাম)
            <input className="input mt-1" value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder="যেমন: আমার ফ্যাশন শপ" />
          </label>
          <label className="block text-sm">ঘোষণা / অ্যানাউন্সমেন্ট (দোকানের উপরে ব্যানার)
            <input className="input mt-1" value={announcementText} onChange={(e) => setAnnouncementText(e.target.value)} placeholder="যেমন: ঈদ অফার — সব পণ্যে ডেলিভারি ফ্রি!" />
          </label>
          <label className="block text-sm md:col-span-2">Meta description (SEO)
            <input className="input mt-1" value={metaDescription} onChange={(e) => setMetaDescription(e.target.value)} placeholder="সার্চে দেখানোর জন্য দোকানের সংক্ষিপ্ত বর্ণনা" />
          </label>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={showFeatured} onChange={(e) => setShowFeatured(e.target.checked)} /> ফিচার্ড সেকশন</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={showCategories} onChange={(e) => setShowCategories(e.target.checked)} /> ক্যাটাগরি</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={showSearch} onChange={(e) => setShowSearch(e.target.checked)} /> সার্চ</label>
        </div>
        {/* OU8: section customizer — hide/show + reorder the shop
            home sections. The product grid is not listed: it is
            the shop itself and always renders last. Up/down
            buttons (no drag-drop builder, by design). */}
        <div className="space-y-3 border-t pt-4">
          <div className="font-semibold">হোমপেজের সেকশন সাজান (OU8)</div>
          <p className="text-xs text-slate-500">যে সেকশন বন্ধ করবেন সেটি দোকানের হোমপেজে দেখাবে না; ↑ ↓ দিয়ে ক্রম বদলান। পণ্যের গ্রিড সবসময় শেষে থাকবে — এটি লুকানো যায় না।</p>
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
                    {SECTION_LABELS[key]}
                  </label>
                  <button type="button" className="rounded border px-2 py-0.5 text-xs" disabled={idx === 0} onClick={() => move(-1)}>↑ উপরে</button>
                  <button type="button" className="rounded border px-2 py-0.5 text-xs" disabled={idx === sectionOrder.length - 1} onClick={() => move(1)}>↓ নিচে</button>
                </div>
              );
            })}
          </div>
        </div>
        <div className="grid gap-3 border-t pt-4 md:grid-cols-2">
          <label className="block text-sm">ফিচার্ড পণ্যের ধরন (featuredMode)
            <select className="input mt-1" value={featuredMode} onChange={(e) => setFeaturedMode(e.target.value)}>
              <option value="merchant_picks">মার্চেন্টের বাছাই</option>
              <option value="top_sellers">সেরা বিক্রিত (শেষ ৩০ দিনের বিক্রি অনুযায়ী)</option>
            </select>
          </label>
          <label className="block text-sm">দোকানের ভাষা (locale)
            <select className="input mt-1" value={shopLocale} onChange={(e) => setShopLocale(e.target.value)}>
              <option value="bn">বাংলা</option>
              <option value="en">English</option>
            </select>
          </label>
          <label className="block text-sm">ডেলিভারির প্রতিশ্রুতি (চেকআউটে দেখাবে, খালি = লুকানো)
            <input className="input mt-1" value={deliveryPromiseText} onChange={(e) => setDeliveryPromiseText(e.target.value)} placeholder="যেমন: ঢাকায় ২৪ ঘণ্টায় ডেলিভারি" />
          </label>
          <label className="block text-sm">সাপোর্ট ফোন (চেকআউট/ট্র্যাকিংয়ে দেখাবে, খালি = লুকানো)
            <input className="input mt-1" value={supportPhone} onChange={(e) => setSupportPhone(e.target.value)} placeholder="01XXXXXXXXX" />
          </label>
          <label className="block text-sm md:col-span-2">রিটার্ন নীতি (দোকানের ফুটার/চেকআউট/ট্র্যাকিংয়ে দেখাবে, খালি = লুকানো)
            <textarea className="input mt-1" rows={3} value={returnPolicyText} onChange={(e) => setReturnPolicyText(e.target.value)} placeholder="যেমন: পণ্যে ত্রুটি থাকলে ৭ দিনের মধ্যে বদলি…" />
          </label>
        </div>
        <div className="space-y-3 border-t pt-4">
          <div className="font-semibold">রেফারেল ছাড়</div>
          <p className="text-xs text-slate-500">গ্রাহক তার নিজের রেফারেল কোড বন্ধুকে দিলে, বন্ধুর প্রথম অর্ডারে এই ছাড় পাবেন। কোডটি অর্ডার সফল পেজে গ্রাহক দেখতে পাবেন।</p>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-sm">রেফারেল ছাড়ের হার (%) — খালি = বন্ধ
              <input className="input mt-1" type="number" min="0" max="100" value={referralDiscountPercent} onChange={(e) => setReferralDiscountPercent(e.target.value)} placeholder="যেমন: ৫" />
            </label>
            <label className="block text-sm">ন্যূনতম সাবটোটাল (টাকা, খালি = নেই)
              <input className="input mt-1" inputMode="decimal" value={referralMinSubtotal} onChange={(e) => setReferralMinSubtotal(e.target.value)} placeholder="যেমন: ৫০০" />
            </label>
          </div>
        </div>
        <div className="space-y-3 border-t pt-4">
          <div className="font-semibold">গিফট র‍্যাপ</div>
          <p className="text-xs text-slate-500">চালু থাকলে ক্রেতা চেকআউটে ফি দিয়ে গিফট র‍্যাপ ও একটি গিফট বার্তা যোগ করতে পারবে। ফি খালি রাখলে চেকআউটে অপশনটি দেখাবে না।</p>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={giftWrapEnabled} onChange={(e) => setGiftWrapEnabled(e.target.checked)} />
              গিফট র‍্যাপ চালু করুন
            </label>
            <label className="block text-sm">র‍্যাপের ফি (টাকা)
              <input className="input mt-1" inputMode="decimal" value={giftWrapFee} onChange={(e) => setGiftWrapFee(e.target.value)} placeholder="যেমন: ৫০" disabled={!giftWrapEnabled} />
            </label>
          </div>
        </div>
        <div className="space-y-3 border-t pt-4">
          <div className="font-semibold">থিম ও ফেভিকন</div>
          <p className="text-xs text-slate-500">দোকানের চেহারা বেছে নিন — প্রিভিউগুলো শুধু ধারণা দেওয়ার জন্য (CSS মক)। নিচের &ldquo;সেটিংস সংরক্ষণ করুন&rdquo; বাটনেই থিম ও ফেভিকন সেভ হবে।</p>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5" role="radiogroup" aria-label="দোকানের থিম">
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
                    {t.label}
                  </div>
                  <div className="mt-0.5 text-xs font-normal text-slate-500">{t.desc}</div>
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
                নতুন ডিজাইন v2 লাইভ প্রিভিউ (সেভ না করেই দেখুন)
              </a>
            </p>
          ) : null}
          <label className="block text-sm">ফেভিকন URL (ব্রাউজার ট্যাবের ছোট আইকন)
            <div className="mt-1 flex items-center gap-3">
              <input className="input flex-1" value={faviconUrl} onChange={(e) => setFaviconUrl(e.target.value)} placeholder="https://…/favicon.png" />
              {faviconUrl.trim() ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={faviconUrl.trim()} alt="ফেভিকন প্রিভিউ" className="h-8 w-8 rounded border bg-white object-contain" />
              ) : null}
            </div>
            <span className="mt-1 block text-xs font-normal text-slate-500">খালি রাখলে লোগো ব্যবহৃত হবে।</span>
          </label>
        </div>
        <div className="space-y-3 border-t pt-4">
          <div className="font-semibold">যোগাযোগ বোতাম</div>
          <p className="text-xs text-slate-500">ভর্তি থাকলে দোকানে ভাসমান WhatsApp / Messenger বোতাম দেখাবে — ক্রেতা এক ক্লিকে চ্যাট শুরু করতে পারবে। খালি রাখলে সেই বোতামটি দেখাবে না।</p>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-sm">WhatsApp নম্বর
              <input className="input mt-1" value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} placeholder="8801XXXXXXXXX" />
              <span className="mt-1 block text-xs font-normal text-slate-500">দেশের কোডসহ, যেমন 8801XXXXXXXXX</span>
            </label>
            <label className="block text-sm">Messenger লিংক
              <input className="input mt-1" value={messengerUrl} onChange={(e) => setMessengerUrl(e.target.value)} placeholder="https://m.me/yourpage" />
              <span className="mt-1 block text-xs font-normal text-slate-500">পেজের m.me লিংক</span>
            </label>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={trackingPageEnabled} onChange={(e) => setTrackingPageEnabled(e.target.checked)} />
          পাবলিক অর্ডার ট্র্যাকিং পেজ চালু (trackingPageEnabled)
        </label>
        {orgSlug && trackingPageEnabled ? (
          <p className="text-xs text-slate-500">ট্র্যাকিং পেজ: <span className="font-mono text-indigo-700">{typeof window !== "undefined" ? `${window.location.origin}/track/${orgSlug}` : `/track/${orgSlug}`}</span> — ক্রেতা অর্ডার নম্বর + ফোন দিয়ে অবস্থা দেখতে পারবে।</p>
        ) : null}
        <div className="space-y-3 border-t pt-4">
          <div className="font-semibold">শর্তাবলি</div>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={requireTermsConsent} onChange={(e) => setRequireTermsConsent(e.target.checked)} />
            শর্তাবলি সম্মতি আবশ্যক
          </label>
          <label className="block text-sm">শর্তাবলির পেজ URL (ঐচ্ছিক)
            <input className="input mt-1" value={termsUrl} onChange={(e) => setTermsUrl(e.target.value)} placeholder="https://…/terms" />
            <span className="mt-1 block text-xs font-normal text-slate-500">URL না দিলে দোকানের Terms পেজটি ব্যবহৃত হবে।</span>
          </label>
        </div>
        <div className="space-y-3 border-t pt-4">
          <div className="font-semibold">ট্র্যাকিং ও অ্যানালিটিক্স</div>
          <p className="text-xs text-slate-500">আপনার নিজের Google অ্যাকাউন্টের আইডি বসান — ভর্তি থাকলেই দোকানে সেই ট্যাগ চলবে, খালি রাখলে কোনো ট্যাগ যাবে না।</p>
          {gtmContainerId.trim() && ga4MeasurementId.trim() ? (
            <p className="rounded-lg bg-amber-50 p-3 text-xs font-semibold text-amber-800">
              ⚠️ GTM দিয়ে GA4 চালালে এখানে আবার বসাবেন না — দ্বিগুণ গণনা হতে পারে।
            </p>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm">
              <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                <span>📘 Facebook / Meta Pixel ID</span>
                <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">মাল্টি-পিক্সেল সাপোর্টেড</span>
              </span>
              <input
                className="input mt-1 w-full"
                value={metaPixelId}
                onChange={(e) => setMetaPixelId(e.target.value)}
                placeholder="যেমন: 123456789012, 987654321098"
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                আপনার Meta Pixel ID বসান। একাধিক অ্যাকাউন্ট বা পিক্সেল থাকলে কমা (,) দিয়ে লিখুন — সবগুলোতেই স্বয়ংক্রিয়ভাবে PageView, ViewContent, AddToCart, InitiateCheckout ও Purchase যাবে।
              </span>
            </label>

            <label className="block text-sm">
              <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                <span>🎵 TikTok Pixel ID</span>
                <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">মাল্টি-পিক্সেল সাপোর্টেড</span>
              </span>
              <input
                className="input mt-1 w-full"
                value={tikTokPixelId}
                onChange={(e) => setTikTokPixelId(e.target.value)}
                placeholder="যেমন: C123456789, C987654321"
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                TikTok Ads Manager থেকে প্রাপ্ত Pixel ID। একাধিক থাকলে কমা (,) দিয়ে লিখুন।
              </span>
            </label>

            <label className="block text-sm">
              <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                <span>📊 GA4 Measurement ID</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">মাল্টি-প্রপার্টি</span>
              </span>
              <input
                className="input mt-1 w-full"
                value={ga4MeasurementId}
                onChange={(e) => setGa4MeasurementId(e.target.value)}
                placeholder="G-XXXXXXXXXX (একাধিক থাকলে কমা দিয়ে)"
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                কোথায় পাবেন: Google Analytics &gt; Admin &gt; Data Streams — Measurement ID।
              </span>
            </label>

            <label className="block text-sm">
              <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                <span>🏷️ GTM কন্টেইনার ID</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">মাল্টি-কন্টেইনার</span>
              </span>
              <input
                className="input mt-1 w-full"
                value={gtmContainerId}
                onChange={(e) => setGtmContainerId(e.target.value)}
                placeholder="GTM-XXXXXXX"
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                কোথায় পাবেন: Google Tag Manager — কন্টেইনার ID। একাধিক থাকলে কমা দিয়ে লিখুন।
              </span>
            </label>

            <label className="block text-sm">
              <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                <span>👁️ Microsoft Clarity Project ID</span>
              </span>
              <input
                className="input mt-1 w-full"
                value={clarityId}
                onChange={(e) => setClarityId(e.target.value)}
                placeholder="যেমন: abcdefgh12"
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                হিটম্যাপ, ক্লিকম্যাপ ও সেশন রেকর্ডিংয়ের জন্য Microsoft Clarity প্রজেক্ট আইডি।
              </span>
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
                কোথায় পাবেন: Google Ads &gt; Conversions — কনভার্সন অ্যাকশনের ট্যাগ আইডি।
              </span>
            </label>

            <label className="block text-sm">
              <span className="font-semibold text-slate-800">🎯 Google Ads কনভার্সন লেবেল</span>
              <input
                className="input mt-1 w-full"
                value={googleAdsConversionLabel}
                onChange={(e) => setGoogleAdsConversionLabel(e.target.value)}
                placeholder="যেমন: AbC-D_efGhIjK"
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                Google Ads কনভার্সন অ্যাকশনের লেবেল। ক্রয়ের কনভার্সন ট্র্যাক করতে আইডি ও লেবেল দুটোই লাগবে।
              </span>
            </label>

            <label className="block text-sm">
              <span className="font-semibold text-slate-800">🔍 Search Console যাচাইকরণ টোকেন</span>
              <input
                className="input mt-1 w-full"
                value={searchConsoleVerification}
                onChange={(e) => setSearchConsoleVerification(e.target.value)}
                placeholder="HTML tag এর content মানটি (শুধু টোকেন)"
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                Google Search Console এর HTML tag ভেরিফিকেশন মেটা ট্যাগের শুধু content টোকেনটি।
              </span>
            </label>
          </div>
        </div>
        <div className="space-y-3 border-t pt-4">
          <div className="font-semibold">কাস্টম CSS/JS</div>
          <p className="rounded-lg bg-amber-50 p-3 text-xs font-semibold text-amber-800">
            ⚠️ নিজের দায়িত্বে ব্যবহার করুন — ভুল কোড দোকানের পেজ ভেঙে দিতে পারে। কাস্টম JS শুধু দোকানের নিজের হোস্টে চলে (মূল অ্যাপের হোস্টে নয়)।
          </p>
          <p className="text-xs text-slate-500">
            বন্ধ করার ট্যাগ (&lt;/style&gt;, &lt;/script&gt;) সার্ভার গ্রহণ করে না — এমন কোড দিলে সংরক্ষণ ব্যর্থ হবে এবং সার্ভারের বার্তাটি ওপরে দেখানো হবে।
            CSS শুধু দোকানের পেজে প্রযোজ্য; JS চালু করতে নিচের টগলটি অন করতে হবে, নাহলে JS সংরক্ষিত থাকলেও চলবে না।
          </p>
          <label className="block text-sm">কাস্টম CSS
            <textarea className="input mt-1 font-mono text-xs" rows={6} value={customCss} onChange={(e) => setCustomCss(e.target.value)} placeholder={".my-class { color: #b91c1c; }"} spellCheck={false} />
          </label>
          <label className="block text-sm">কাস্টম JS
            <textarea className="input mt-1 font-mono text-xs" rows={6} value={customJs} onChange={(e) => setCustomJs(e.target.value)} placeholder={"console.log('hello');"} spellCheck={false} />
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={customJsEnabled} onChange={(e) => setCustomJsEnabled(e.target.checked)} />
            কাস্টম JS চালু করুন
          </label>
        </div>
        <div>
          <div className="text-sm font-medium">ফিচার্ড পণ্য ({featuredIds.length}/৫০) — ক্রম অনুযায়ী দেখাবে</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {products.length === 0 ? <span className="text-xs text-slate-500">কোনো পণ্য পাওয়া যায়নি</span> : products.map((p) => {
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
          {busy === "settings" ? "সংরক্ষণ হচ্ছে…" : "সেটিংস সংরক্ষণ করুন"}
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
        <div className="font-semibold">প্রমোশনাল পপআপ</div>
        <p className="text-sm text-slate-600">
          অবস্থা: <b>{popupEnabled ? "চালু" : "বন্ধ"}</b>
          {popup ? <> · ইমপ্রেশন: <b>{popup.impressions ?? 0}</b> · ক্লিক: <b>{popup.clicks ?? 0}</b>{popup.mode === "lead" ? <> · লিড সংগ্রহ: <b>{popup.captures ?? 0}</b></> : null}</> : null}
        </p>
        {popupLoadError ? (
          <p className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {popupLoadError}
            <button type="button" onClick={() => void loadPopup()} className="font-semibold underline">পুনরায় চেষ্টা</button>
          </p>
        ) : null}
        {popupError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{popupError}</p> : null}
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={popupEnabled} onChange={(e) => setPopupEnabled(e.target.checked)} />
              পপআপ চালু করুন
            </label>
            {/* OU8: popup kind — promo (link button) or lead capture
                (a real form; submissions become CRM Leads). */}
            <label className="block text-sm">পপআপের ধরন
              <select className="input mt-1" value={popupMode} onChange={(e) => setPopupMode(e.target.value)}>
                <option value="promo">প্রমোশন (বাটন/লিংক)</option>
                <option value="lead">লিড সংগ্রহ (ফর্ম — জমা দিলে CRM-এ লিড তৈরি হবে)</option>
              </select>
            </label>
            {popupMode === "lead" ? (
              <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                <div className="text-sm font-semibold">কোন তথ্য নেবেন</div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={popupCaptureName} onChange={(e) => setPopupCaptureName(e.target.checked)} /> নাম</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={popupCapturePhone} onChange={(e) => setPopupCapturePhone(e.target.checked)} /> ফোন নম্বর</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={popupCaptureEmail} onChange={(e) => setPopupCaptureEmail(e.target.checked)} /> ইমেইল</label>
                <label className="block text-sm">সফল বার্তা (ঐচ্ছিক)
                  <input className="input mt-1" value={popupSuccessMessage} onChange={(e) => setPopupSuccessMessage(e.target.value)} placeholder="যেমন: ধন্যবাদ! আমরা কল করব।" />
                </label>
                <p className="text-xs text-slate-500">লিড মোডে বাটনের লিংক (CTA URL) ব্যবহৃত হয় না — বাটনের লেখাটি ফর্মের জমা বাটনে দেখাবে। অন্তত একটি তথ্য চালু রাখতে হবে।</p>
              </div>
            ) : null}
            <label className="block text-sm">শিরোনাম
              <input className="input mt-1" value={popupTitle} onChange={(e) => setPopupTitle(e.target.value)} placeholder="যেমন: ঈদ অফার — ২০% ছাড়!" />
            </label>
            <label className="block text-sm">বডি
              <textarea className="input mt-1" rows={3} value={popupBody} onChange={(e) => setPopupBody(e.target.value)} placeholder="অফারের সংক্ষিপ্ত বর্ণনা…" />
            </label>
            <label className="block text-sm">ছবির URL (ঐচ্ছিক)
              <input className="input mt-1" value={popupImageUrl} onChange={(e) => setPopupImageUrl(e.target.value)} placeholder="https://…" />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-sm">বাটনের লেখা (CTA)
                <input className="input mt-1" value={popupCtaText} onChange={(e) => setPopupCtaText(e.target.value)} placeholder="এখনই কিনুন" />
              </label>
              <label className="block text-sm">বাটনের লিংক (CTA URL)
                <input className="input mt-1" value={popupCtaUrl} onChange={(e) => setPopupCtaUrl(e.target.value)} placeholder="https://…" />
              </label>
              <label className="block text-sm">কখন দেখাবে (ট্রিগার)
                <select className="input mt-1" value={popupTrigger} onChange={(e) => setPopupTrigger(e.target.value)}>
                  <option value="delay_seconds">কিছুক্ষণ পর</option>
                  <option value="scroll_percent">স্ক্রল করলে</option>
                  <option value="exit_intent">চলে যেতে চাইলে</option>
                </select>
              </label>
              <label className="block text-sm">কোন পেজে দেখাবে
                <select className="input mt-1" value={popupShowOn} onChange={(e) => setPopupShowOn(e.target.value)}>
                  <option value="home">শুধু হোমপেজে</option>
                  <option value="all">সব পেজে</option>
                </select>
              </label>
              {popupTrigger === "delay_seconds" ? (
                <label className="block text-sm">দেরি (সেকেন্ড)
                  <input className="input mt-1" type="number" min="0" value={popupDelaySeconds} onChange={(e) => setPopupDelaySeconds(e.target.value)} placeholder="যেমন: 5" />
                </label>
              ) : null}
              {popupTrigger === "scroll_percent" ? (
                <label className="block text-sm">স্ক্রল (%)
                  <input className="input mt-1" type="number" min="0" max="100" value={popupScrollPercent} onChange={(e) => setPopupScrollPercent(e.target.value)} placeholder="যেমন: 50" />
                </label>
              ) : null}
              <label className="block text-sm">একই ক্রেতাকে আবার দেখানোর ব্যবধান (দিন)
                <input className="input mt-1" type="number" min="0" value={popupFrequencyDays} onChange={(e) => setPopupFrequencyDays(e.target.value)} placeholder="যেমন: 7" />
              </label>
              <label className="block text-sm">শুরু (ঐচ্ছিক)
                <input className="input mt-1" type="datetime-local" value={popupStartsAt} onChange={(e) => setPopupStartsAt(e.target.value)} />
              </label>
              <label className="block text-sm">শেষ (ঐচ্ছিক)
                <input className="input mt-1" type="datetime-local" value={popupEndsAt} onChange={(e) => setPopupEndsAt(e.target.value)} />
              </label>
            </div>
            <button type="button" onClick={savePopup} disabled={busy === "popup"} className="btn-primary disabled:opacity-50">
              {busy === "popup" ? "সংরক্ষণ হচ্ছে…" : "পপআপ সংরক্ষণ করুন"}
            </button>
          </div>
          <div>
            <div className="text-sm font-medium">প্রিভিউ — ক্রেতা যেভাবে দেখবে</div>
            <div className="mt-2 flex items-center justify-center rounded-xl bg-slate-100 p-6">
              <div className="relative w-full max-w-xs rounded-2xl bg-white p-5 text-center shadow-xl">
                <span className="absolute right-3 top-2 text-lg leading-none text-slate-400" aria-hidden="true">×</span>
                {popupImageUrl.trim() ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={popupImageUrl.trim()} alt="" className="mx-auto mb-3 max-h-36 w-full rounded-lg object-cover" />
                ) : null}
                <div className="text-base font-bold">{popupTitle.trim() || "পপআপের শিরোনাম"}</div>
                <p className="mt-1 text-sm text-slate-600">{popupBody.trim() || "অফারের বর্ণনা এখানে দেখাবে।"}</p>
                <span className="btn-primary mt-3 inline-block">{popupCtaText.trim() || "বাটন"}</span>
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
          <div className="font-semibold">কনটেন্ট পেজ</div>
          <p className="text-sm text-slate-500">
            মোট পেজ: <b>{shopPages.length}</b> · প্রকাশিত: <b>{shopPages.filter((p) => p.published).length}</b>
            {" "}— রিটার্ন নীতি, শর্তাবলি, আমাদের সম্পর্কে ইত্যাদি পেজ এখান থেকে বানান ও সম্পাদনা করুন।
          </p>
        </div>
        <Link href="/dashboard/commerce/storefront/pages" className="btn-primary">পেজ পরিচালনা করুন →</Link>
        {pagesLoadError ? (
          <p className="flex w-full flex-wrap items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {pagesLoadError}
            <button type="button" onClick={() => void loadShopPages()} className="font-semibold underline">পুনরায় চেষ্টা</button>
          </p>
        ) : null}
      </section>

      {/* AB6 (AX12): blog manager */}
      <section id="blog" className="card flex flex-wrap items-center gap-3 p-5 scroll-mt-24">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">ব্লগ</div>
          <p className="text-sm text-slate-500">
            দোকানের ব্লগ পোস্ট বানান ও সম্পাদনা করুন — প্রকাশিত পোস্ট <span className="font-mono">/blog</span> পেজে দেখা যাবে।
          </p>
        </div>
        <Link href="/dashboard/commerce/storefront/blog" className="btn-primary">ব্লগ পরিচালনা করুন →</Link>
      </section>

      {/* AB6 (AX11): search analytics + synonyms */}
      <section id="shop-search" className="card flex flex-wrap items-center gap-3 p-5 scroll-mt-24">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">দোকানের সার্চ</div>
          <p className="text-sm text-slate-500">
            সার্চ বিশ্লেষণ, সমার্থক শব্দ ও পুনঃসূচী — সার্চ কীওয়ার্ড / পূর্ণ-টেক্সট অনুসন্ধান (FTS) ভিত্তিক।
          </p>
        </div>
        <Link href="/dashboard/commerce/storefront/search" className="btn-primary">সার্চ পরিচালনা করুন →</Link>
      </section>

      {/* EC18: Delivery slots */}
      <section id="delivery-slots" className="card scroll-mt-24 space-y-4 p-5">
        <div className="font-semibold">ডেলিভারি স্লট</div>
        <p className="text-xs text-slate-500">ক্রেতা চেকআউটে স্লট ও তারিখ (আজ থেকে ৭ দিনের মধ্যে) বেছে নিতে পারবে। জেলা বেছে না দিলে স্লটটি সব জেলার জন্য প্রযোজ্য। সক্ষমতা খালি = আনলিমিটেড।</p>

        {(state.slots ?? []).length === 0 ? (
          <EmptyState title="এখনো কোনো ডেলিভারি স্লট নেই" description="নিচে তৈরি করুন।" />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {(state.slots ?? []).map((s) => (
              <div key={s.id} className={`rounded-xl border p-4 ${s.active ? "bg-white" : "bg-slate-50 opacity-70"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{s.label} <span className="text-sm font-normal text-slate-500">{s.startTime} – {s.endTime}</span></div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <span className={`rounded-full px-2 py-0.5 font-bold ${s.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>{s.active ? "সক্রিয়" : "বন্ধ"}</span>
                      <span>সক্ষমতা: {s.capacityPerDay != null ? `প্রতিদিন ${s.capacityPerDay}টি` : "আনলিমিটেড"}</span>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => startEditSlot(s)} className="inline-flex min-h-[44px] items-center justify-center rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold">সম্পাদনা</button>
                    <button type="button" onClick={() => void deleteSlot(s)} disabled={busy === `slot-del-${s.id}`} className="inline-flex min-h-[44px] items-center justify-center rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold text-rose-600 disabled:opacity-50">মুছুন</button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {s.districtScope && s.districtScope.length > 0 ? s.districtScope.map((d) => (
                    <span key={d} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">{d}</span>
                  )) : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">সব জেলা</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-3 border-t pt-4">
          <div className="font-semibold">{editingSlotId ? "স্লট সম্পাদনা" : "নতুন স্লট"}</div>
          {slotError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{slotError}</p> : null}
          <div className="grid gap-3 md:grid-cols-4">
            <label className="block text-sm">লেবেল
              <input className="input mt-1" value={sLabel} onChange={(e) => setSLabel(e.target.value)} placeholder="যেমন: সকাল" />
            </label>
            <label className="block text-sm">শুরু (HH:mm)
              <input className="input mt-1" type="time" value={sStart} onChange={(e) => setSStart(e.target.value)} />
            </label>
            <label className="block text-sm">শেষ (HH:mm)
              <input className="input mt-1" type="time" value={sEnd} onChange={(e) => setSEnd(e.target.value)} />
            </label>
            <label className="block text-sm">দৈনিক সক্ষমতা (খালি = আনলিমিটেড)
              <input className="input mt-1" type="number" min="0" value={sCapacity} onChange={(e) => setSCapacity(e.target.value)} placeholder="আনলিমিটেড" />
            </label>
          </div>
          <div>
            <div className="text-sm font-medium">জেলা (কিছু না বাছলে = সব জেলা) — {sDistricts.length}টি বাছাই</div>
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
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sActive} onChange={(e) => setSActive(e.target.checked)} /> স্লট সক্রিয়</label>
          <div className="flex gap-2">
            <button type="button" onClick={saveSlot} disabled={busy === "slot" || !sLabel.trim()} className="btn-primary disabled:opacity-50">
              {busy === "slot" ? "সংরক্ষণ হচ্ছে…" : editingSlotId ? "স্লট আপডেট করুন" : "স্লট তৈরি করুন"}
            </button>
            {editingSlotId ? <button type="button" onClick={resetSlotForm} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">বাতিল</button> : null}
          </div>
        </div>
      </section>

      {/* Shipping zones */}
      <section id="shipping-zones" className="card scroll-mt-24 space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">শিপিং জোন ও ডেলিভারি চার্জ</div>
          <button type="button" onClick={createDefaults} disabled={busy === "defaults"} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold disabled:opacity-50">
            {busy === "defaults" ? "তৈরি হচ্ছে…" : "ঢাকার ভিতরে/বাইরে ডিফল্ট zone তৈরি করুন"}
          </button>
        </div>
        <p className="text-xs text-slate-500">ডিফল্ট জোন Business Profile-এর ডেলিভারি চার্জ থেকে তৈরি হয়। সব টাকার ঘর টাকায় লিখুন — সিস্টেম নিজে পয়সায় (minor) রূপান্তর করে পাঠাবে।</p>

        {state.zones.length === 0 ? (
          <EmptyState title="এখনো কোনো শিপিং জোন নেই" description="জোন ছাড়া চেকআউটে অর্ডার নেওয়া যাবে না। ডিফল্ট জোন তৈরি করুন অথবা নিচে নিজে বানান।" />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {state.zones.map((z) => (
              <div key={z.id} className={`rounded-xl border p-4 ${z.active ? "bg-white" : "bg-slate-50 opacity-70"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{z.name}</div>
                    <div className="text-xs text-slate-500">{KIND_LABEL[z.kind] ?? z.kind} · অবস্থান {z.position} · {z.active ? "সক্রিয়" : "বন্ধ"}</div>
                  </div>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => startEditZone(z)} className="inline-flex min-h-[44px] items-center justify-center rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold">সম্পাদনা</button>
                    <button type="button" onClick={() => void deleteZone(z)} disabled={busy === `zone-del-${z.id}`} className="inline-flex min-h-[44px] items-center justify-center rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold text-rose-600 disabled:opacity-50">মুছুন</button>
                  </div>
                </div>
                <div className="mt-2 space-y-1 text-sm">
                  <div>ডেলিভারি চার্জ: <b>{formatMinorTaka(z.chargeMinor)}</b></div>
                  <div>ফ্রি ডেলিভারি: {z.freeAboveMinor ? <>{formatMinorTaka(z.freeAboveMinor)} বা তার বেশি অর্ডারে</> : "—"}</div>
                  <div>সময়: {z.deliveryDays != null ? `${z.deliveryDays} দিন` : "—"}</div>
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
          <div className="font-semibold">{editingZoneId ? "জোন সম্পাদনা" : "নতুন জোন"}</div>
          {zoneError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{zoneError}</p> : null}
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block text-sm">জোনের নাম
              <input className="input mt-1" value={zName} onChange={(e) => setZName(e.target.value)} placeholder="যেমন: ঢাকার ভিতরে" />
            </label>
            <label className="block text-sm">ধরন
              <select className="input mt-1" value={zKind} onChange={(e) => setZKind(e.target.value)}>
                {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </label>
            <label className="block text-sm">অবস্থান (ছোট = আগে মিলবে)
              <input className="input mt-1" type="number" value={zPosition} onChange={(e) => setZPosition(e.target.value)} />
            </label>
            <label className="block text-sm">ডেলিভারি চার্জ (টাকা)
              <input className="input mt-1" inputMode="decimal" value={zCharge} onChange={(e) => setZCharge(e.target.value)} placeholder="60" />
            </label>
            <label className="block text-sm">এর উপরে ফ্রি ডেলিভারি (টাকা, খালি = নেই)
              <input className="input mt-1" inputMode="decimal" value={zFreeAbove} onChange={(e) => setZFreeAbove(e.target.value)} placeholder="1000" />
            </label>
            <label className="block text-sm">ডেলিভারি সময় (দিন, খালি = নেই)
              <input className="input mt-1" type="number" value={zDays} onChange={(e) => setZDays(e.target.value)} placeholder="2" />
            </label>
          </div>
          {zKind === "district_list" ? (
            <div>
              <div className="text-sm font-medium">জেলা বেছে নিন ({zDistricts.length}টি)</div>
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
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={zActive} onChange={(e) => setZActive(e.target.checked)} /> জোন সক্রিয়</label>
          <div className="flex gap-2">
            <button type="button" onClick={saveZone} disabled={busy === "zone" || !zName.trim()} className="btn-primary disabled:opacity-50">
              {busy === "zone" ? "সংরক্ষণ হচ্ছে…" : editingZoneId ? "জোন আপডেট করুন" : "জোন তৈরি করুন"}
            </button>
            {editingZoneId ? <button type="button" onClick={resetZoneForm} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">বাতিল</button> : null}
          </div>
        </div>
      </section>

      {/* EC30: weight-based rate rules */}
      <section id="rate-rules" className="card scroll-mt-24 space-y-4 p-5">
        <div className="font-semibold">ওজনভিত্তিক ডেলিভারি রেট রুল</div>
        <p className="text-xs text-slate-500">হোম ডেলিভারিতে কার্টের মোট ওজন অনুযায়ী জোনের ফ্ল্যাট চার্জের বদলে এই রুলের চার্জ বসবে (priority বেশি = আগে মিলবে)। ওজনের কোনো ঘর খালি = সেই দিকে সীমা নেই। কোনো পণ্যের ওজন সেট না থাকলে ওজন-সীমাওয়ালা রুল মিলবে না।</p>
        {rateRules.length === 0 ? (
          <EmptyState title="এখনো কোনো রেট রুল নেই" description="নিচে তৈরি করুন।" />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {rateRules.map((r) => (
              <div key={r.id} className={`rounded-xl border p-4 ${r.active ? "bg-white" : "bg-slate-50 opacity-70"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{zoneNameFor(r.shippingZoneId)}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <span className={`rounded-full px-2 py-0.5 font-bold ${r.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>{r.active ? "সক্রিয়" : "বন্ধ"}</span>
                      <span>Priority: {r.priority}</span>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => startEditRule(r)} className="inline-flex min-h-[44px] items-center justify-center rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold">সম্পাদনা</button>
                    <button type="button" onClick={() => void deleteRule(r)} disabled={busy === `rule-del-${r.id}`} className="inline-flex min-h-[44px] items-center justify-center rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold text-rose-600 disabled:opacity-50">মুছুন</button>
                  </div>
                </div>
                <div className="mt-2 space-y-1 text-sm">
                  <div>ওজন: <b>{weightWindowLabel(r)}</b></div>
                  <div>চার্জ: <b>{formatMinorTaka(r.chargeMinor)}</b></div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-3 border-t pt-4">
          <div className="font-semibold">{editingRuleId ? "রেট রুল সম্পাদনা" : "নতুন রেট রুল"}</div>
          {ruleError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{ruleError}</p> : null}
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block text-sm">জোন
              <select className="input mt-1" value={rZoneId} onChange={(e) => setRZoneId(e.target.value)}>
                <option value="">সব জোন</option>
                {(state.zones ?? []).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </label>
            <label className="block text-sm">সর্বনিম্ন ওজন (গ্রাম, খালি = সীমা নেই)
              <input className="input mt-1" type="number" min="0" value={rMinWeight} onChange={(e) => setRMinWeight(e.target.value)} placeholder="যেমন: 0" />
            </label>
            <label className="block text-sm">সর্বোচ্চ ওজন (গ্রাম, খালি = সীমা নেই)
              <input className="input mt-1" type="number" min="0" value={rMaxWeight} onChange={(e) => setRMaxWeight(e.target.value)} placeholder="যেমন: 1000" />
            </label>
            <label className="block text-sm">চার্জ (টাকা)
              <input className="input mt-1" inputMode="decimal" value={rCharge} onChange={(e) => setRCharge(e.target.value)} placeholder="60" />
            </label>
            <label className="block text-sm">Priority (বেশি = আগে)
              <input className="input mt-1" type="number" value={rPriority} onChange={(e) => setRPriority(e.target.value)} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rActive} onChange={(e) => setRActive(e.target.checked)} /> রুল সক্রিয়</label>
          <div className="flex gap-2">
            <button type="button" onClick={saveRule} disabled={busy === "rule"} className="btn-primary disabled:opacity-50">
              {busy === "rule" ? "সংরক্ষণ হচ্ছে…" : editingRuleId ? "রুল আপডেট করুন" : "রুল তৈরি করুন"}
            </button>
            {editingRuleId ? <button type="button" onClick={resetRuleForm} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">বাতিল</button> : null}
          </div>
        </div>
      </section>

      {/* EC30: pickup points */}
      <section id="pickup-points" className="card scroll-mt-24 space-y-4 p-5">
        <div className="font-semibold">পিকআপ পয়েন্ট</div>
        <p className="text-xs text-slate-500">ক্রেতা চেকআউটে হোম ডেলিভারির বদলে পিকআপ বেছে নিতে পারবে — তখন ডেলিভারি চার্জের বদলে পয়েন্টের নিজের ফি বসবে (ফি ০ = ফ্রি)।</p>
        {pickupPoints.length === 0 ? (
          <EmptyState title="এখনো কোনো পিকআপ পয়েন্ট নেই" description="নিচে তৈরি করুন।" />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {pickupPoints.map((p) => (
              <div key={p.id} className={`rounded-xl border p-4 ${p.active ? "bg-white" : "bg-slate-50 opacity-70"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{p.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <span className={`rounded-full px-2 py-0.5 font-bold ${p.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>{p.active ? "সক্রিয়" : "বন্ধ"}</span>
                      <span>{p.district}</span>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => startEditPoint(p)} className="inline-flex min-h-[44px] items-center justify-center rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold">সম্পাদনা</button>
                    <button type="button" onClick={() => void deletePoint(p)} disabled={busy === `point-del-${p.id}`} className="inline-flex min-h-[44px] items-center justify-center rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold text-rose-600 disabled:opacity-50">মুছুন</button>
                  </div>
                </div>
                <div className="mt-2 space-y-1 text-sm">
                  <div>{p.address}</div>
                  {p.phone ? <div className="text-slate-500">ফোন: <span className="font-mono">{p.phone}</span></div> : null}
                  <div>ফি: <b>{p.feeMinor === "0" ? "ফ্রি" : formatMinorTaka(p.feeMinor)}</b></div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-3 border-t pt-4">
          <div className="font-semibold">{editingPointId ? "পিকআপ পয়েন্ট সম্পাদনা" : "নতুন পিকআপ পয়েন্ট"}</div>
          {pointError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{pointError}</p> : null}
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block text-sm">নাম
              <input className="input mt-1" value={pName} onChange={(e) => setPName(e.target.value)} placeholder="যেমন: খুলনা সদর আউটলেট" />
            </label>
            <label className="block text-sm">জেলা
              <select className="input mt-1" value={pDistrict} onChange={(e) => setPDistrict(e.target.value)}>
                <option value="">— বেছে নিন —</option>
                {districts.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label className="block text-sm">ফোন (ঐচ্ছিক)
              <input className="input mt-1" value={pPhone} onChange={(e) => setPPhone(e.target.value)} placeholder="01XXXXXXXXX" />
            </label>
            <label className="block text-sm md:col-span-2">ঠিকানা
              <input className="input mt-1" value={pAddress} onChange={(e) => setPAddress(e.target.value)} placeholder="দোকান/আউটলেটের পূর্ণ ঠিকানা" />
            </label>
            <label className="block text-sm">ফি (টাকা, খালি = ফ্রি)
              <input className="input mt-1" inputMode="decimal" value={pFee} onChange={(e) => setPFee(e.target.value)} placeholder="0" />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pActive} onChange={(e) => setPActive(e.target.checked)} /> পয়েন্ট সক্রিয়</label>
          <div className="flex gap-2">
            <button type="button" onClick={savePoint} disabled={busy === "point" || !pName.trim() || !pAddress.trim() || !pDistrict.trim()} className="btn-primary disabled:opacity-50">
              {busy === "point" ? "সংরক্ষণ হচ্ছে…" : editingPointId ? "পয়েন্ট আপডেট করুন" : "পয়েন্ট তৈরি করুন"}
            </button>
            {editingPointId ? <button type="button" onClick={resetPointForm} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">বাতিল</button> : null}
          </div>
        </div>
      </section>

      {/* AB4 (AX5): checkout field definitions */}
      <section id="checkout-fields" className="card scroll-mt-24 space-y-4 p-5">
        <div className="font-semibold">চেকআউট ফিল্ড</div>
        <p className="text-xs leading-relaxed text-slate-500">
          চেকআউটে ক্রেতার কাছ থেকে অতিরিক্ত তথ্য নিন — যেমন উপহারের বার্তা, সাইজ বা বিশেষ নির্দেশনা।
          ক্রেতার দেওয়া উত্তরগুলো সরাসরি অর্ডারের বিবরণে (Dashboard → Orders) দেখা যাবে।
          ফিল্ডের <b>key</b> তৈরি করার পর বদলানো যায় না — উত্তরের হিসাব এই key দিয়েই রাখা হয়।
        </p>
        {fieldLoadError ? (
          <p className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {fieldLoadError}
            <button type="button" onClick={() => void loadFieldDefs()} className="font-semibold underline">পুনরায় চেষ্টা</button>
          </p>
        ) : null}
        {fieldDefs.length === 0 ? (
          <EmptyState title="এখনো কোনো চেকআউট ফিল্ড নেই" description="নিচে তৈরি করুন।" />
        ) : (
          <div className="space-y-2">
            {fieldDefs.map((f) => (
              <div key={f.id} className={`flex flex-wrap items-center gap-2 rounded-xl border p-3 text-sm ${f.active ? "bg-white" : "bg-slate-50 opacity-70"}`}>
                <span className="font-semibold">{f.label}</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">{f.key}</span>
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
                  {f.type === "textarea" ? "বড় লেখা" : f.type === "select" ? "তালিকা থেকে বাছাই" : f.type === "checkbox" ? "টিক বাক্স" : "এক লাইনের লেখা"}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                  {f.appliesTo === "shop" ? "শপ চেকআউট" : f.appliesTo === "single" ? "সিঙ্গল প্রোডাক্ট" : f.appliesTo === "landing" ? "ল্যান্ডিং" : "সব সারফেস"}
                </span>
                {f.required ? <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">আবশ্যক</span> : null}
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${f.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>{f.active ? "সক্রিয়" : "বন্ধ"}</span>
                <span className="ml-auto flex gap-1.5">
                  <button type="button" onClick={() => startEditField(f)} className="inline-flex min-h-[44px] items-center justify-center rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold">সম্পাদনা</button>
                  <button type="button" onClick={() => void deleteField(f)} disabled={busy === `field-del-${f.id}`} className="inline-flex min-h-[44px] items-center justify-center rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold text-rose-600 disabled:opacity-50">মুছুন</button>
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-3 border-t pt-4">
          <div className="font-semibold">{editingFieldId ? "চেকআউট ফিল্ড সম্পাদনা" : "নতুন চেকআউট ফিল্ড"}</div>
          {fieldError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{fieldError}</p> : null}
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block text-sm">Key (ইংরেজি, বদলানো যায় না)
              <input className="input mt-1 font-mono" value={fKey} disabled={!!editingFieldId} onChange={(e) => setFKey(e.target.value)} placeholder="যেমন: gift_note" />
            </label>
            <label className="block text-sm">লেবেল (ক্রেতা যা দেখবে)
              <input className="input mt-1" value={fLabel} onChange={(e) => setFLabel(e.target.value)} placeholder="যেমন: উপহারের বার্তা" />
            </label>
            <label className="block text-sm">ধরন
              <select className="input mt-1" value={fType} onChange={(e) => setFType(e.target.value)}>
                <option value="text">এক লাইনের লেখা</option>
                <option value="textarea">বড় লেখা</option>
                <option value="select">তালিকা থেকে বাছাই</option>
                <option value="checkbox">টিক বাক্স (হ্যাঁ/না)</option>
              </select>
            </label>
            <label className="block text-sm">কোন সারফেসে দেখাবে
              <select className="input mt-1" value={fAppliesTo} onChange={(e) => setFAppliesTo(e.target.value)}>
                <option value="all">সব সারফেস</option>
                <option value="shop">শপ চেকআউট</option>
                <option value="single">সিঙ্গল প্রোডাক্ট</option>
                <option value="landing">ল্যান্ডিং</option>
              </select>
            </label>
            <label className="block text-sm">ক্রম (sortOrder)
              <input className="input mt-1" type="number" value={fSortOrder} onChange={(e) => setFSortOrder(e.target.value)} />
            </label>
            {fType === "select" ? (
              <label className="block text-sm">অপশন (প্রতি লাইনে একটি)
                <textarea className="input mt-1" rows={3} value={fOptions} onChange={(e) => setFOptions(e.target.value)} placeholder={"M\nL\nXL"} />
              </label>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={fRequired} onChange={(e) => setFRequired(e.target.checked)} /> আবশ্যক — উত্তর ছাড়া অর্ডার হবে না</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={fActive} onChange={(e) => setFActive(e.target.checked)} /> সক্রিয়</label>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void saveField()} disabled={busy === "field" || !fLabel.trim() || (!editingFieldId && !fKey.trim())} className="btn-primary disabled:opacity-50">
              {busy === "field" ? "সংরক্ষণ হচ্ছে…" : editingFieldId ? "ফিল্ড আপডেট করুন" : "ফিল্ড তৈরি করুন"}
            </button>
            {editingFieldId ? <button type="button" onClick={resetFieldForm} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">বাতিল</button> : null}
          </div>
        </div>
      </section>

      {/* TD9: নিজের ডোমেইন — one unified 5-step custom-domain flow */}
      <section className="card space-y-5 p-5">
        <div>
          <div className="font-semibold">নিজের ডোমেইন</div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            নিজের কেনা ডোমেইনেই দোকান চালান — ডোমেইন লেখা, TXT যাচাই, routing নির্দেশনা আর অবস্থা, সব ধাপ এই এক বিভাগেই।
          </p>
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
                  <span className={stepBadge}>১</span>
                  <span className="font-semibold">ধাপ ১ — ডোমেইন লেখা ও সেভ</span>
                  {customDomain ? <span className="font-mono font-bold">{customDomain}</span> : <span className="text-slate-500">— এখনো কোনো ডোমেইন সেট করা নেই</span>}
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
                    {busy === "domain-set" ? "সেভ হচ্ছে…" : "ডোমেইন সেভ করুন"}
                  </button>
                </div>
                <p className="text-xs text-slate-500">শুধু ডোমেইনটি লিখুন — https:// বা কোনো পথ ছাড়া (যেমন: dhaka-fashion.com অথবা shop.dhaka-fashion.com)।</p>
              </div>

              {/* ধাপ ২ — TXT যাচাই */}
              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center gap-2 text-sm">
                  <span className={stepBadge}>২</span>
                  <span className="font-semibold">ধাপ ২ — TXT যাচাই</span>
                  {verified ? <span className="text-emerald-700">যাচাই হয়েছে ({domain.verifiedAt ? new Date(domain.verifiedAt).toLocaleString("bn-BD") : ""})</span> : <span className="text-slate-500">এখনো যাচাই হয়নি</span>}
                </div>
                {!customDomain ? (
                  <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                    এই ধাপটি এখন নিষ্ক্রিয় — আগে ধাপ ১-এ ডোমেইন লিখে সেভ করুন, তারপর এখানে TXT টোকেন তৈরি করে ডোমেইনটির মালিকানা যাচাই করতে পারবেন।
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={issueToken} disabled={busy === "token"} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold disabled:opacity-50">
                        {busy === "token" ? "তৈরি হচ্ছে…" : "যাচাই টোকেন তৈরি করুন (TXT)"}
                      </button>
                      <button type="button" onClick={verifyDomain} disabled={busy === "verify"} className="btn-primary disabled:opacity-50">
                        {busy === "verify" ? "যাচাই হচ্ছে…" : "এখন যাচাই করুন"}
                      </button>
                    </div>

                    {tokenOut ? (
                      <div className="space-y-2 rounded-xl bg-slate-900 p-4 text-xs text-green-300">
                        <p className="font-sans font-bold text-white">DNS-এ এই TXT রেকর্ডটি যোগ করুন:</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-sans text-slate-300">Host:</span>
                          <code className="rounded bg-slate-800 px-2 py-1">{tokenOut.recordHost}</code>
                          <button type="button" onClick={() => copyText(tokenOut.recordHost, "TXT Host")} className="rounded bg-white px-2 py-1 font-sans font-bold text-slate-900">কপি</button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-sans text-slate-300">Type: {tokenOut.recordType} · Value:</span>
                          <code className="break-all rounded bg-slate-800 px-2 py-1">{tokenOut.recordValue}</code>
                          <button type="button" onClick={() => copyText(tokenOut.recordValue, "TXT Value")} className="rounded bg-white px-2 py-1 font-sans font-bold text-slate-900">কপি</button>
                        </div>
                        <p className="font-sans text-slate-400">রেকর্ড যোগ করার পর DNS propagate হতে কিছু সময় লাগতে পারে — তারপর &ldquo;এখন যাচাই করুন&rdquo; চাপুন।</p>
                      </div>
                    ) : domain.verifyHost ? (
                      <p className="text-xs text-slate-500">TXT রেকর্ডের Host হবে: <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">{domain.verifyHost}</code> — টোকেন তৈরি করলে এর Value এখানে দেখাবে।</p>
                    ) : null}
                  </>
                )}
              </div>

              {/* ধাপ ৩ — Routing নির্দেশনা */}
              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center gap-2 text-sm">
                  <span className={stepBadge}>৩</span>
                  <span className="font-semibold">ধাপ ৩ — Routing নির্দেশনা (DNS রেকর্ড)</span>
                </div>
                {!customDomain ? (
                  <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                    আগে ধাপ ১-এ ডোমেইন সেভ করুন — তারপর সেই ডোমেইনের জন্য ঠিক কোন DNS রেকর্ড লাগবে, তা এখানে হিসাব করে দেখানো হবে।
                  </p>
                ) : (
                  <>
                    {isSubdomainStyle ? (
                      <div className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">Type:</span>
                          <code className="rounded bg-white px-2 py-1 font-mono ring-1 ring-slate-200">CNAME</code>
                          <span className="font-semibold">Host:</span>
                          <code className="rounded bg-white px-2 py-1 font-mono ring-1 ring-slate-200">{customDomain}</code>
                          <button type="button" onClick={() => copyText(customDomain, "CNAME Host")} className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold">কপি</button>
                          <span className="font-semibold">Target:</span>
                          <code className="rounded bg-white px-2 py-1 font-mono ring-1 ring-slate-200">app.qosprey.com</code>
                          <button type="button" onClick={() => copyText("app.qosprey.com", "CNAME Target")} className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold">কপি</button>
                        </div>
                        <p className="text-xs leading-relaxed text-slate-500">
                          টীকা: registrar অনুযায়ী Host ঘরে পুরো ডোমেইনটি লিখতে হতে পারে, আবার কোনোটায় শুধু subdomain অংশটি
                          (যেমন: {labels[0]}) লাগে — আপনার registrar-এর নিয়ম অনুযায়ী দিন।
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3 rounded-xl bg-slate-50 p-4 text-sm">
                        <div className="space-y-1.5">
                          <p><b>(ক)</b> আপনার registrar-এ <b>CNAME flattening / ALIAS / ANAME</b> সুবিধা থাকলে apex ডোমেইনের জন্য সেটাই ব্যবহার করুন:</p>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">Type:</span>
                            <code className="rounded bg-white px-2 py-1 font-mono ring-1 ring-slate-200">ALIAS / ANAME</code>
                            <span className="font-semibold">Host:</span>
                            <code className="rounded bg-white px-2 py-1 font-mono ring-1 ring-slate-200">@</code>
                            <span className="font-semibold">Target:</span>
                            <code className="rounded bg-white px-2 py-1 font-mono ring-1 ring-slate-200">app.qosprey.com</code>
                            <button type="button" onClick={() => copyText("app.qosprey.com", "ALIAS Target")} className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold">কপি</button>
                          </div>
                        </div>
                        <div className="space-y-1.5 border-t border-slate-200 pt-3">
                          <p><b>(খ)</b> সেই সুবিধা না থাকলে <b>A রেকর্ড</b> দিন:</p>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">Type:</span>
                            <code className="rounded bg-white px-2 py-1 font-mono ring-1 ring-slate-200">A</code>
                            <span className="font-semibold">Host:</span>
                            <code className="rounded bg-white px-2 py-1 font-mono ring-1 ring-slate-200">@</code>
                            <span className="font-semibold">Value:</span>
                            <span>সার্ভারের IP (Dokploy প্যানেলে app ডোমেইনের A রেকর্ডের মান)</span>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">www রূপ — Type:</span>
                        <code className="rounded bg-white px-2 py-1 font-mono ring-1 ring-slate-200">CNAME</code>
                        <span className="font-semibold">Host:</span>
                        <code className="rounded bg-white px-2 py-1 font-mono ring-1 ring-slate-200">www</code>
                        <button type="button" onClick={() => copyText("www", "www Host")} className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold">কপি</button>
                        <span className="font-semibold">Target:</span>
                        <code className="rounded bg-white px-2 py-1 font-mono ring-1 ring-slate-200">{customDomain}</code>
                        <button type="button" onClick={() => copyText(customDomain, "www Target")} className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold">কপি</button>
                      </div>
                      <p className="text-xs leading-relaxed text-slate-500">টীকা: যাচাই করা ডোমেইন ও তার www রূপ — দুটোতেই দোকান খুলবে।</p>
                    </div>

                    <p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
                      মনে রাখবেন: ডোমেইনটি এই প্ল্যাটফর্মের দিকে পয়েন্ট করা (DNS A/CNAME) এবং SSL সার্টিফিকেট সেটআপ (Dokploy/Traefik) একটি
                      প্ল্যাটফর্ম-স্তরের কাজ — এই অ্যাপ থেকে করা যায় না। DNS যাচাই সফল হলেও routing সক্রিয় হতে ওই সেটআপ লাগবে; নিচের ধাপ ৪-এ
                      &ldquo;Routing Check now&rdquo; দিয়ে আসল অবস্থা যাচাই করুন — প্রমাণ ছাড়া routing সক্রিয় বলা হবে না।
                    </p>
                  </>
                )}
              </div>

              {/* ধাপ ৪ — অবস্থা তালিকা */}
              <div className="space-y-2 border-t pt-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className={stepBadge}>৪</span>
                  <span className="font-semibold">ধাপ ৪ — অবস্থা</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={statusMark(hasToken)}>{hasToken ? "✓" : "…"}</span>
                  <span className="font-semibold">টোকেন দেওয়া হয়েছে</span>
                  {hasToken ? <span className="text-emerald-700">হ্যাঁ — TXT যাচাই টোকেন সেট করা আছে</span> : <span className="text-slate-500">বাকি — ধাপ ২-এ টোকেন তৈরি করুন</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={statusMark(verified)}>{verified ? "✓" : "…"}</span>
                  <span className="font-semibold">যাচাই হয়েছে</span>
                  {verified ? <span className="text-emerald-700">হ্যাঁ ({domain.verifiedAt ? new Date(domain.verifiedAt).toLocaleString("bn-BD") : ""})</span> : <span className="text-slate-500">বাকি — এখনো যাচাই হয়নি</span>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={statusMark(!!routing?.routingActive)}>{routing?.routingActive ? "✓" : "…"}</span>
                  <span className="font-semibold">Routing ঠিক আছে</span>
                  {routing?.routingActive ? (
                    <span className="text-emerald-700">সক্রিয় — {routing.evidence ?? routing.checkedUrl}</span>
                  ) : routing ? (
                    <span className="text-amber-700">সক্রিয় পাওয়া যায়নি: {routing.reason ?? routing.checkedUrl}</span>
                  ) : (
                    <span className="text-slate-500">এখনো পরীক্ষা করা হয়নি — অনুমান নয়, আসল diagnostic দেখতে Check now চাপুন</span>
                  )}
                  <button type="button" onClick={checkRouting} disabled={busy === "routing" || !verified} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold disabled:opacity-50">
                    {busy === "routing" ? "পরীক্ষা হচ্ছে…" : "Routing Check now"}
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
                  <span className="font-semibold">HTTPS সার্টিফিকেট (SSL)</span>
                  {domain.httpsStatus === "active" ? (
                    <span className="text-emerald-700">সক্রিয় — Cloudflare সার্টিফিকেট চালু আছে</span>
                  ) : domain.httpsStatus === "pending" ? (
                    <span className="text-amber-700">চলমান — সার্টিফিকেট ইস্যু/যাচাই হচ্ছে</span>
                  ) : domain.httpsStatus === "failed" ? (
                    <span className="text-red-700">ব্যর্থ হয়েছে</span>
                  ) : domain.httpsStatus === "not_configured" ? (
                    <span className="text-slate-500">প্ল্যাটফর্মে Cloudflare for SaaS এখনো configure করা হয়নি — প্ল্যাটফর্ম অপারেটরের সেটআপ বাকি</span>
                  ) : (
                    <span className="text-slate-500">এখনো চেষ্টা করা হয়নি — ডোমেইন যাচাই সফল হলে provisioning শুরু হয়</span>
                  )}
                  <button type="button" onClick={refreshHttps} disabled={busy === "https-refresh" || !verified} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold disabled:opacity-50">
                    {busy === "https-refresh" ? "Refresh হচ্ছে…" : "HTTPS অবস্থা Refresh"}
                  </button>
                </div>
                {domain.httpsStatusDetail ? (
                  <p className="pl-8 text-xs leading-relaxed text-slate-500">
                    {domain.httpsStatusDetail}
                    {domain.httpsUpdatedAt ? <> · সর্বশেষ আপডেট: {new Date(domain.httpsUpdatedAt).toLocaleString("bn-BD")}</> : null}
                  </p>
                ) : null}
              </div>

              {/* ধাপ ৫ — বদলানো/সরানো */}
              <div className="space-y-2 border-t pt-4">
                <div className="flex items-center gap-2 text-sm">
                  <span className={stepBadge}>৫</span>
                  <span className="font-semibold">ধাপ ৫ — ডোমেইন বদলানো বা সরানো</span>
                </div>
                <p className="text-xs leading-relaxed text-slate-500">
                  ডোমেইন বদলাতে চাইলে উপরের ধাপ ১-এর ঘরে নতুন ডোমেইন লিখে সেভ করুন — বদলালে আগের যাচাই রিসেট হয়ে যাবে,
                  নতুন ডোমেইনের জন্য আবার TXT যাচাই করতে হবে। ডোমেইন সরিয়ে ফেললেও চিন্তা নেই — আপনার সাবডোমেইন ঠিকানা
                  ({shopSubdomainHost(state.organization.slug)}) সবসময়ই থাকে, দোকান সেখানেই খুলবে।
                </p>
                <button type="button" onClick={removeDomain} disabled={busy === "domain-remove" || !customDomain} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold text-rose-600 disabled:opacity-50">
                  {busy === "domain-remove" ? "সরানো হচ্ছে…" : "ডোমেইন সরিয়ে ফেলুন"}
                </button>
                {!customDomain ? <span className="ml-2 text-xs text-slate-400">কোনো ডোমেইন সেট করা নেই — সরানোর কিছু নেই।</span> : null}
              </div>
            </>
          );
        })()}
      </section>
    </div>
  );
}
