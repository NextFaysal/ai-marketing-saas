"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BD_DISTRICTS, shopSubdomainHost } from "@repo/contracts";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinorTaka, minorToTakaString, takaToMinorString } from "@/lib/storefront-money";

// EC8 staff storefront administration. Consumes
// GET /organizations/:id/storefront (staffState):
//   setting { exists, id?, shopEnabled, shopName, announcementText,
//             showFeatured, showCategories, showSearch, metaDescription,
//             featuredProductIds, domainVerifiedAt, hasDomainVerifyToken }
//   zones[] { id, name, kind, districts, chargeMinor, deliveryDays,
//             freeAboveMinor, active, position }   (money = minor strings)
//   organization { id, slug, customDomain }
//   domain { customDomain, verifiedAt, verifyHost }
//   districts (64, BD_DISTRICTS)

interface Setting {
  exists: boolean;
  shopEnabled: boolean;
  shopName: string | null;
  announcementText: string | null;
  showFeatured: boolean;
  showCategories: boolean;
  showSearch: boolean;
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
  domain: { customDomain: string | null; verifiedAt: string | null; verifyHost: string | null };
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
// TD9: POST /storefront/domain/set contract (API worker, parallel build).
interface SetDomainOut { domain: string | null; previousDomain: string | null; verificationReset: boolean }

const KIND_LABEL: Record<string, string> = {
  inside_dhaka: "ঢাকার ভিতরে",
  outside_dhaka: "ঢাকার বাইরে",
  district_list: "নির্দিষ্ট জেলা তালিকা",
  all: "সব এলাকা",
};
const KINDS = Object.keys(KIND_LABEL);

export default function StorefrontStaffPage() {
  const [state, setState] = useState<StaffState | null>(null);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  // settings form
  const [shopEnabled, setShopEnabled] = useState(false);
  const [shopName, setShopName] = useState("");
  const [announcementText, setAnnouncementText] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [showFeatured, setShowFeatured] = useState(true);
  const [showCategories, setShowCategories] = useState(true);
  const [showSearch, setShowSearch] = useState(true);
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

  const orgSlug = state?.organization.slug ?? "";
  const shopPath = orgSlug ? `/shop/${orgSlug}` : "";
  const districts: readonly string[] = state?.districts?.length ? state.districts : BD_DISTRICTS;

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`${label} কপি হয়েছে।`);
    } catch {
      setError("কপি করা যায়নি — লেখাটি হাতে কপি করুন।");
    }
  }

  async function saveSettings() {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (featuredIds.length > 50) { setError("Featured পণ্য সর্বোচ্চ ৫০টি হতে পারবে।"); return; }
    if (giftWrapEnabled && giftWrapFee.trim() && takaToMinorString(giftWrapFee) === null) { setError("গিফট র‍্যাপের ফি টাকায় সঠিক সংখ্যা দিন (যেমন: 50)।"); return; }
    setBusy("settings"); setError(""); setNotice("");
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
        }),
      });
      setNotice("দোকানের সেটিংস সংরক্ষণ হয়েছে।");
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
    setBusy("zone"); setZoneError(""); setError(""); setNotice("");
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
        setNotice("শিপিং জোন আপডেট হয়েছে।");
      } else {
        await apiFetch(`/organizations/${orgId}/storefront/zones`, { method: "POST", body: JSON.stringify(body) });
        setNotice("নতুন শিপিং জোন তৈরি হয়েছে।");
      }
      resetZoneForm();
      await load();
    } catch (e) { setZoneError(e instanceof Error ? e.message : "জোন সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function deleteZone(z: Zone) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(`"${z.name}" জোনটি মুছে ফেলবেন? এটি আর ডেলিভারি হিসেবে ব্যবহৃত হবে না।`)) return;
    setBusy(`zone-del-${z.id}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/storefront/zones/${z.id}`, { method: "DELETE" });
      setNotice("জোন মুছে ফেলা হয়েছে।");
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
    setBusy("slot"); setSlotError(""); setError(""); setNotice("");
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
        setNotice("ডেলিভারি স্লট আপডেট হয়েছে।");
      } else {
        await apiFetch(`/organizations/${orgId}/storefront/slots`, { method: "POST", body: JSON.stringify(body) });
        setNotice("নতুন ডেলিভারি স্লট তৈরি হয়েছে।");
      }
      resetSlotForm();
      await load();
    } catch (e) { setSlotError(e instanceof Error ? e.message : "স্লট সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function deleteSlot(s: Slot) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(`"${s.label}" স্লটটি মুছে ফেলবেন?`)) return;
    setBusy(`slot-del-${s.id}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/storefront/slots/${s.id}`, { method: "DELETE" });
      setNotice("স্লট মুছে ফেলা হয়েছে।");
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
    setBusy("rule"); setRuleError(""); setError(""); setNotice("");
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
        setNotice("রেট রুল আপডেট হয়েছে।");
      } else {
        await apiFetch(`/organizations/${orgId}/storefront/rate-rules`, { method: "POST", body: JSON.stringify(body) });
        setNotice("নতুন রেট রুল তৈরি হয়েছে।");
      }
      resetRuleForm();
      await loadPricing();
    } catch (e) { setRuleError(e instanceof Error ? e.message : "রুল সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(""); }
  }
  async function deleteRule(r: RateRule) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm("এই রেট রুলটি মুছে ফেলবেন?")) return;
    setBusy(`rule-del-${r.id}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/storefront/rate-rules/${r.id}`, { method: "DELETE" });
      setNotice("রেট রুল মুছে ফেলা হয়েছে।");
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
    setBusy("point"); setPointError(""); setError(""); setNotice("");
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
        setNotice("পিকআপ পয়েন্ট আপডেট হয়েছে।");
      } else {
        await apiFetch(`/organizations/${orgId}/storefront/pickup-points`, { method: "POST", body: JSON.stringify(body) });
        setNotice("নতুন পিকআপ পয়েন্ট তৈরি হয়েছে।");
      }
      resetPointForm();
      await loadPricing();
    } catch (e) { setPointError(e instanceof Error ? e.message : "পয়েন্ট সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(""); }
  }
  async function deletePoint(p: PickupPointRow) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(`"${p.name}" পিকআপ পয়েন্টটি মুছে ফেলবেন?`)) return;
    setBusy(`point-del-${p.id}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/storefront/pickup-points/${p.id}`, { method: "DELETE" });
      setNotice("পিকআপ পয়েন্ট মুছে ফেলা হয়েছে।");
      if (editingPointId === p.id) resetPointForm();
      await loadPricing();
    } catch (e) { setError(e instanceof Error ? e.message : "মুছে ফেলা ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function createDefaults() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("defaults"); setError(""); setNotice("");
    try {
      const out = await apiFetch<{ created: Zone[]; zones: Zone[] }>(`/organizations/${orgId}/storefront/zones/defaults`, { method: "POST" });
      setNotice(
        out.created.length
          ? `ডিফল্ট জোন তৈরি হয়েছে: ${out.created.map((z) => z.name).join(", ")}।`
          : "ঢাকার ভিতরে/বাইরে জোন আগেই ছিল — নতুন কিছু তৈরি হয়নি।",
      );
      await load();
    } catch (e) {
      // Server refusal (e.g. BusinessProfile charges unset) verbatim.
      setError(e instanceof Error ? e.message : "ডিফল্ট জোন তৈরি ব্যর্থ");
    } finally { setBusy(""); }
  }

  async function issueToken() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("token"); setDomainError(""); setDomainNotice(""); setRouting(null);
    try {
      const out = await apiFetch<VerifyTokenOut>(`/organizations/${orgId}/storefront/domain/verify-token`, { method: "POST" });
      setTokenOut(out);
      setDomainNotice("নতুন যাচাই টোকেন তৈরি হয়েছে। নিচের TXT রেকর্ডটি DNS-এ যোগ করুন — আগের যাচাই থাকলে তা নতুন করে প্রমাণ করতে হবে।");
    } catch (e) { setDomainError(e instanceof Error ? e.message : "টোকেন তৈরি ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function verifyDomain() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("verify"); setDomainError(""); setDomainNotice("");
    try {
      const out = await apiFetch<{ verified: boolean; domain: string; verifiedAt: string }>(`/organizations/${orgId}/storefront/domain/verify`, { method: "POST" });
      setDomainNotice(`ডোমেইন যাচাই হয়েছে: ${out.domain} (${new Date(out.verifiedAt).toLocaleString("bn-BD")})`);
      await load();
    } catch (e) { setDomainError(e instanceof Error ? e.message : "যাচাই ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function checkRouting() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("routing"); setDomainError(""); setDomainNotice("");
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

      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      {/* Live shop link */}
      <div className="card flex flex-wrap items-center gap-3 p-5">
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
      <section className="card space-y-4 p-5">
        <div className="font-semibold">দোকানের সেটিংস</div>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={shopEnabled} onChange={(e) => setShopEnabled(e.target.checked)} />
          দোকান চালু করুন (shopEnabled) {!state.setting.exists ? <span className="text-xs font-normal text-slate-400">— এখনো কোনো সেটিংস সেভ হয়নি</span> : null}
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
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={trackingPageEnabled} onChange={(e) => setTrackingPageEnabled(e.target.checked)} />
          পাবলিক অর্ডার ট্র্যাকিং পেজ চালু (trackingPageEnabled)
        </label>
        {orgSlug && trackingPageEnabled ? (
          <p className="text-xs text-slate-500">ট্র্যাকিং পেজ: <span className="font-mono text-indigo-700">{typeof window !== "undefined" ? `${window.location.origin}/track/${orgSlug}` : `/track/${orgSlug}`}</span> — ক্রেতা অর্ডার নম্বর + ফোন দিয়ে অবস্থা দেখতে পারবে।</p>
        ) : null}
        <div>
          <div className="text-sm font-medium">ফিচার্ড পণ্য ({featuredIds.length}/৫০) — ক্রম অনুযায়ী দেখাবে</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {products.length === 0 ? <span className="text-xs text-slate-400">কোনো পণ্য পাওয়া যায়নি</span> : products.map((p) => {
              const on = featuredIds.includes(p.id);
              const order = on ? featuredIds.indexOf(p.id) + 1 : null;
              return (
                <button key={p.id} type="button" onClick={() => toggleFeatured(p.id)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${on ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"}`}>
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

      {/* EC18: Delivery slots */}
      <section className="card space-y-4 p-5">
        <div className="font-semibold">ডেলিভারি স্লট</div>
        <p className="text-xs text-slate-500">ক্রেতা চেকআউটে স্লট ও তারিখ (আজ থেকে ৭ দিনের মধ্যে) বেছে নিতে পারবে। জেলা বেছে না দিলে স্লটটি সব জেলার জন্য প্রযোজ্য। সক্ষমতা খালি = আনলিমিটেড।</p>

        {(state.slots ?? []).length === 0 ? (
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">এখনো কোনো ডেলিভারি স্লট নেই — নিচে তৈরি করুন।</p>
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
                    <button type="button" onClick={() => startEditSlot(s)} className="rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold">সম্পাদনা</button>
                    <button type="button" onClick={() => deleteSlot(s)} disabled={busy === `slot-del-${s.id}`} className="rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold text-rose-600 disabled:opacity-50">মুছুন</button>
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
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${on ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"}`}>
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
      <section className="card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">শিপিং জোন ও ডেলিভারি চার্জ</div>
          <button type="button" onClick={createDefaults} disabled={busy === "defaults"} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold disabled:opacity-50">
            {busy === "defaults" ? "তৈরি হচ্ছে…" : "ঢাকার ভিতরে/বাইরে ডিফল্ট zone তৈরি করুন"}
          </button>
        </div>
        <p className="text-xs text-slate-500">ডিফল্ট জোন Business Profile-এর ডেলিভারি চার্জ থেকে তৈরি হয়। সব টাকার ঘর টাকায় লিখুন — সিস্টেম নিজে পয়সায় (minor) রূপান্তর করে পাঠাবে।</p>

        {state.zones.length === 0 ? (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">এখনো কোনো শিপিং জোন নেই — জোন ছাড়া চেকআউটে অর্ডার নেওয়া যাবে না। ডিফল্ট জোন তৈরি করুন অথবা নিচে নিজে বানান।</p>
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
                    <button type="button" onClick={() => startEditZone(z)} className="rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold">সম্পাদনা</button>
                    <button type="button" onClick={() => deleteZone(z)} disabled={busy === `zone-del-${z.id}`} className="rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold text-rose-600 disabled:opacity-50">মুছুন</button>
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
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${on ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"}`}>
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
      <section className="card space-y-4 p-5">
        <div className="font-semibold">ওজনভিত্তিক ডেলিভারি রেট রুল</div>
        <p className="text-xs text-slate-500">হোম ডেলিভারিতে কার্টের মোট ওজন অনুযায়ী জোনের ফ্ল্যাট চার্জের বদলে এই রুলের চার্জ বসবে (priority বেশি = আগে মিলবে)। ওজনের কোনো ঘর খালি = সেই দিকে সীমা নেই। কোনো পণ্যের ওজন সেট না থাকলে ওজন-সীমাওয়ালা রুল মিলবে না।</p>
        {rateRules.length === 0 ? (
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">এখনো কোনো রেট রুল নেই — নিচে তৈরি করুন।</p>
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
                    <button type="button" onClick={() => startEditRule(r)} className="rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold">সম্পাদনা</button>
                    <button type="button" onClick={() => deleteRule(r)} disabled={busy === `rule-del-${r.id}`} className="rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold text-rose-600 disabled:opacity-50">মুছুন</button>
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
      <section className="card space-y-4 p-5">
        <div className="font-semibold">পিকআপ পয়েন্ট</div>
        <p className="text-xs text-slate-500">ক্রেতা চেকআউটে হোম ডেলিভারির বদলে পিকআপ বেছে নিতে পারবে — তখন ডেলিভারি চার্জের বদলে পয়েন্টের নিজের ফি বসবে (ফি ০ = ফ্রি)।</p>
        {pickupPoints.length === 0 ? (
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">এখনো কোনো পিকআপ পয়েন্ট নেই — নিচে তৈরি করুন।</p>
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
                    <button type="button" onClick={() => startEditPoint(p)} className="rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold">সম্পাদনা</button>
                    <button type="button" onClick={() => deletePoint(p)} disabled={busy === `point-del-${p.id}`} className="rounded-lg border bg-white px-2.5 py-1 text-xs font-semibold text-rose-600 disabled:opacity-50">মুছুন</button>
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
                <div className="flex items-center gap-2">
                  <span className={statusMark(false)}>…</span>
                  <span className="font-semibold">SSL</span>
                  <span className="text-slate-500">স্বয়ংক্রিয় SSL ব্যবস্থা অপেক্ষমাণ (TD10) — সার্ভার ধাপ ছাড়া HTTPS নিশ্চিত নয়</span>
                </div>
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
