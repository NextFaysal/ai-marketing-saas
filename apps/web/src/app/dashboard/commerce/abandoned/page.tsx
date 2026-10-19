"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { fmtDateTime, fmtMoney, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { sequenceStatusLabel, type CheckoutSequence } from "@/lib/ab7";
import {
  formatCleanPhone,
  buildWhatsAppRecoveryMessage,
  buildWhatsAppLink,
  isDhakaQuietHour,
} from "@/lib/abandoned-chase";
import {
  DEFAULT_TIER_CONFIG,
  type TierChaseSequenceConfig,
  buildTierMessage,
  determineCurrentChaseTier,
  calculateSequenceRecoveryRoi,
} from "@/lib/abandoned-tier-chase";

// Unified abandoned cart & checkout item interface
interface AbandonedItem {
  source: "tracker" | "shopify" | "storefront";
  id: string;
  storeId?: string | null;
  storeName?: string | null;
  email?: string | null;
  phone?: string | null;
  items?: { name?: string; quantity?: number }[] | null;
  totalMinor?: string | null;
  currency?: string;
  checkoutUrl?: string | null;
  abandonedAt?: string | null;
  recovered?: boolean;
  recoveredOrderId?: string | null;
  recoverySentAt?: string | null;
  conversationId?: string | null;
}

// Bot Order Chase item interface (CX7 / To Chase)
interface ChaseRow {
  id: string;
  sessionId: string;
  conversationId: string;
  attempts: number;
  lastChasedAt: string | null;
  lastFailedAt: string | null;
  stoppedReason: string | null;
  lastEvent: string | null;
  createdAt: string;
  updatedAt: string;
  sessionState: string | null;
  sessionStatus: string | null;
  productName: string | null;
  phone?: string | null;
}

interface CouponSetting {
  enabled: boolean;
  kind: "percent" | "fixed";
  value: number;
  expiryHours: number;
  minOrderMinor: string | null;
}

interface ChaseSettings {
  enabled: boolean;
  firstDelayMinutes: number;
  intervalMinutes: number;
  maxAttempts: number;
  quietHoursRespect: boolean;
  quietStartHour: number;
  quietEndHour: number;
}

const money = (minor?: string | null, currency = "BDT", locale: "bn" | "en" = "bn") =>
  minor == null ? "—" : currency === "BDT" ? fmtMoney(locale, Number(minor) / 100) : `${currency} ${fmtNumber(locale, Number(minor) / 100, { maximumFractionDigits: 2 })}`;

function ageText(iso: string | null | undefined, dict: ReturnType<typeof useLocale>["dict"], t: ReturnType<typeof useLocale>["t"]): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return dict.commerce.now;
  const h = Math.floor(ms / 3600000);
  if (h < 1) return t("commerce.minutesAgo", { Math: Math.max(1, Math.floor(ms / 60000)) });
  if (h < 24) return t("commerce.hoursAgo", { h });
  return t("commerce.daysAgo2", { Math: Math.floor(h / 24) });
}

type CDict = ReturnType<typeof useLocale>["dict"]["commerce"];
const chaseStopLabel = (reason: string, d: CDict) => {
  switch (reason) {
    case "completed": return d.orderCompleted;
    case "stop_word": return d.customerAskedToStopStop;
    case "human_took_over": return d.aPersonHasTakenOver;
    case "max_attempts": return d.maximumAttemptsFinished;
    case "session_ended": return d.sessionEnded;
    default: return reason;
  }
};

const chaseStatusLabel = (c: ChaseRow, d: CDict, t: ReturnType<typeof useLocale>["t"]) => {
  if (c.stoppedReason) return chaseStopLabel(c.stoppedReason, d);
  if (c.attempts > 0) return t("commerce.remindedTimes", { attempts: c.attempts });
  if (c.lastEvent === "customer_replied") return d.customerRepliedWaiting;
  return d.waitingForAReminder;
};

export default function AbandonedPage() {
  const { dict, t, locale } = useLocale();
  const [items, setItems] = useState<AbandonedItem[]>([]);
  const [chases, setChases] = useState<ChaseRow[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);

  // Active view tab & search query
  const [activeTab, setActiveTab] = useState<"all" | "phone" | "recovered" | "chases">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Recovery coupon setting form
  const [couponEnabled, setCouponEnabled] = useState(false);
  const [couponKind, setCouponKind] = useState<"percent" | "fixed">("percent");
  const [couponValue, setCouponValue] = useState("10");
  const [couponExpiryHours, setCouponExpiryHours] = useState("72");
  const [couponMinOrder, setCouponMinOrder] = useState("");
  const [couponError, setCouponError] = useState("");
  const [couponNotice, setCouponNotice] = useState("");
  const [showCouponSettings, setShowCouponSettings] = useState(false);

  // Order Chase Automation Settings
  const [chaseSettings, setChaseSettings] = useState<ChaseSettings>({
    enabled: true,
    firstDelayMinutes: 60,
    intervalMinutes: 240,
    maxAttempts: 3,
    quietHoursRespect: true,
    quietStartHour: 22,
    quietEndHour: 8,
  });
  const [showChaseSettings, setShowChaseSettings] = useState(false);
  const [chaseNotice, setChaseNotice] = useState("");

  // Sequence state (expandable row)
  const [expandedId, setExpandedId] = useState("");
  const [seqById, setSeqById] = useState<Record<string, CheckoutSequence>>({});
  const [seqBusyId, setSeqBusyId] = useState("");
  const [seqErrorById, setSeqErrorById] = useState<Record<string, string>>({});

  // 1-Click WhatsApp Recovery Generator Modal & Multi-Tier Sequence State
  const [waModalOpen, setWaModalOpen] = useState(false);
  const [targetItem, setTargetItem] = useState<{
    id: string;
    phone: string;
    productName: string;
    checkoutUrl: string;
    totalMinor?: string | null;
    abandonedAt?: string | null;
    attemptsCount?: number;
  } | null>(null);
  const [waCouponCode, setWaCouponCode] = useState("VIP50");
  const [waDiscountText, setWaDiscountText] = useState(dict.commerce.text1yc0qme);
  const [waCustomMessage, setWaCustomMessage] = useState("");
  const [waGeneratedLink, setWaGeneratedLink] = useState("");
  const [copiedNotice, setCopiedNotice] = useState(false);

  // Multi-tier Chase Sequence Config & Visual Simulator State
  const [tierConfig, setTierConfig] = useState<TierChaseSequenceConfig>(DEFAULT_TIER_CONFIG);
  const [showTierSequenceDrawer, setShowTierSequenceDrawer] = useState(false);
  const [tierNotice, setTierNotice] = useState("");
  const [selectedTier, setSelectedTier] = useState<1 | 2 | 3>(1);
  const [targetItemTierInfo, setTargetItemTierInfo] = useState<{
    nextTier: 1 | 2 | 3 | null;
    isReady: boolean;
    minutesElapsed: number;
    waitMessageBangla: string;
  } | null>(null);

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [abandonedRes, chasesRes] = await Promise.allSettled([
        apiFetch<{ items: AbandonedItem[] }>(`/organizations/${orgId}/commerce/abandoned`),
        apiFetch<ChaseRow[]>(`/organizations/${orgId}/order-chases`),
      ]);

      if (abandonedRes.status === "fulfilled") {
        setItems(abandonedRes.value.items ?? []);
      }
      if (chasesRes.status === "fulfilled") {
        setChases(chasesRes.value ?? []);
      }
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.commerce.loadingFailed);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadCouponSetting = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const s = await apiFetch<CouponSetting>(`/organizations/${orgId}/commerce/abandoned/coupon-setting`);
      setCouponEnabled(!!s.enabled);
      setCouponKind(s.kind === "fixed" ? "fixed" : "percent");
      setCouponValue(String(s.value ?? 10));
      setCouponExpiryHours(String(s.expiryHours ?? 72));
      setCouponMinOrder(s.minOrderMinor ? String(Number(s.minOrderMinor) / 100) : "");
    } catch {
      // keep defaults
    }
  }, []);

  useEffect(() => { void loadCouponSetting(); }, [loadCouponSetting]);

  async function saveCouponSetting() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy("coupon-setting");
    setCouponError("");
    setCouponNotice("");
    try {
      await apiFetch<CouponSetting>(`/organizations/${orgId}/commerce/abandoned/coupon-setting`, {
        method: "PUT",
        body: JSON.stringify({
          enabled: couponEnabled,
          kind: couponKind,
          value: Math.max(0, parseInt(couponValue || "0", 10) || 0),
          expiryHours: Math.max(1, parseInt(couponExpiryHours || "72", 10) || 72),
          minOrderMinor: couponMinOrder ? String(Math.round(parseFloat(couponMinOrder) * 100)) : null,
        }),
      });
      setCouponNotice(dict.commerce.recoveryCouponSettingsSaved);
      await loadCouponSetting();
    } catch (e) {
      setCouponError(e instanceof Error ? e.message : dict.commerce.saveFailed);
    } finally {
      setBusy("");
    }
  }

  // Fetch sequence state for one checkout
  async function toggleSequence(item: AbandonedItem) {
    if (expandedId === item.id) { setExpandedId(""); return; }
    setExpandedId(item.id);
    if (seqById[item.id]) return;
    const orgId = getOrganizationId();
    if (!orgId) return;
    setSeqBusyId(item.id);
    setSeqErrorById((m) => ({ ...m, [item.id]: "" }));
    try {
      const out = await apiFetch<CheckoutSequence>(
        `/organizations/${orgId}/abandoned-checkouts/${encodeURIComponent(item.id)}/sequence`,
      );
      setSeqById((m) => ({ ...m, [item.id]: out }));
    } catch (e) {
      setSeqErrorById((m) => ({ ...m, [item.id]: e instanceof Error ? e.message : dict.commerce.sequenceLoadingFailed }));
    } finally {
      setSeqBusyId("");
    }
  }

  async function recoverEmail(item: AbandonedItem) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(`recover-${item.id}`);
    setError("");
    setNotice("");
    try {
      if (item.source === "tracker") {
        await apiFetch(`/organizations/${orgId}/tracking/abandoned-carts/${item.id}/recover`, { method: "POST" });
      } else {
        await apiFetch(`/organizations/${orgId}/commerce/abandoned/${item.id}/recover`, { method: "POST" });
      }
      setNotice(dict.commerce.recoveryEmailSent);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.commerce.recoveryFailed);
    } finally {
      setBusy("");
    }
  }

  // Open 1-Click WhatsApp modal with prepopulated Bengali text & custom tier sequence
  const openWhatsAppModal = useCallback((cartOrChase: {
    id: string;
    phone?: string | null;
    productName?: string | null;
    items?: { name?: string; quantity?: number }[] | null;
    checkoutUrl?: string | null;
    totalMinor?: string | null;
    abandonedAt?: string | null;
    attemptsCount?: number;
  }) => {
    const cleanPhone = formatCleanPhone(cartOrChase.phone);
    const itemNames = cartOrChase.productName || (cartOrChase.items || []).map((i) => i.name || dict.commerce.product).slice(0, 3).join(", ") || dict.commerce.product;
    const checkoutLink = cartOrChase.checkoutUrl || (typeof window !== "undefined" ? window.location.origin : "");

    const tierInfo = determineCurrentChaseTier(
      cartOrChase.abandonedAt || new Date().toISOString(),
      cartOrChase.attemptsCount || 0,
      tierConfig
    );
    setTargetItemTierInfo(tierInfo);

    const initialTier = tierInfo.nextTier || 1;
    setSelectedTier(initialTier);

    setTargetItem({
      id: cartOrChase.id,
      phone: cleanPhone,
      productName: itemNames,
      checkoutUrl: checkoutLink,
      totalMinor: cartOrChase.totalMinor,
      abandonedAt: cartOrChase.abandonedAt,
      attemptsCount: cartOrChase.attemptsCount,
    });

    const initialCoupon = initialTier === 2 ? tierConfig.tier2CouponCode : initialTier === 3 ? tierConfig.tier3CouponCode : "VIP50";
    const initialDiscount = initialTier === 2 ? tierConfig.tier2DiscountText : initialTier === 3 ? tierConfig.tier3DiscountText : dict.commerce.text1yc0qme;
    setWaCouponCode(initialCoupon);
    setWaDiscountText(initialDiscount);

    const initialMsg = buildTierMessage(initialTier, {
      productName: itemNames,
      checkoutUrl: checkoutLink,
      config: tierConfig,
    });
    setWaCustomMessage(initialMsg);

    const waUrl = buildWhatsAppLink(cleanPhone, initialMsg);
    setWaGeneratedLink(waUrl);
    setCopiedNotice(false);
    setWaModalOpen(true);
  }, [tierConfig]);

  // Switch tier dynamically in WhatsApp modal
  const applyTierSwitch = (tier: 1 | 2 | 3) => {
    setSelectedTier(tier);
    if (!targetItem) return;

    const coupon = tier === 2 ? tierConfig.tier2CouponCode : tier === 3 ? tierConfig.tier3CouponCode : "";
    const discount = tier === 2 ? tierConfig.tier2DiscountText : tier === 3 ? tierConfig.tier3DiscountText : "";
    if (coupon) setWaCouponCode(coupon);
    if (discount) setWaDiscountText(discount);

    const updatedMsg = buildTierMessage(tier, {
      productName: targetItem.productName,
      checkoutUrl: targetItem.checkoutUrl,
      config: tierConfig,
    });
    setWaCustomMessage(updatedMsg);

    if (targetItem.phone) {
      setWaGeneratedLink(buildWhatsAppLink(targetItem.phone, updatedMsg));
    }
  };

  // Update message when coupon or preset changes
  const applyCouponPreset = (code: string, discountText: string) => {
    setWaCouponCode(code);
    setWaDiscountText(discountText);
    if (!targetItem) return;

    const updatedMsg = buildWhatsAppRecoveryMessage({
      productName: targetItem.productName,
      couponCode: code,
      discountText,
      checkoutUrl: targetItem.checkoutUrl,
    });
    setWaCustomMessage(updatedMsg);

    if (targetItem.phone) {
      setWaGeneratedLink(buildWhatsAppLink(targetItem.phone, updatedMsg));
    }
  };

  const handleMessageChange = (newMsg: string) => {
    setWaCustomMessage(newMsg);
    if (targetItem?.phone) {
      setWaGeneratedLink(buildWhatsAppLink(targetItem.phone, newMsg));
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedNotice(true);
      setTimeout(() => setCopiedNotice(false), 2500);
    } catch {
      // fallback
    }
  };

  async function backfill(storeId: string) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(`backfill-${storeId}`);
    setError("");
    setNotice("");
    try {
      const out = await apiFetch<{ fetched: number; created: number; updated: number }>(
        `/organizations/${orgId}/commerce/abandoned/backfill/${storeId}`, { method: "POST" },
      );
      setNotice(t("commerce.abandonedCheckoutsPulledFromShopify", { fetched: out.fetched, created: out.created, updated: out.updated }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.commerce.backfillFailed);
    } finally {
      setBusy("");
    }
  }

  const shopifyStoreIds = useMemo(
    () => [...new Set(items.filter((i) => i.source === "shopify" && i.storeId).map((i) => i.storeId as string))],
    [items],
  );

  const totalAbandonedRevenue = items.reduce((sum, item) => sum + (Number(item.totalMinor) || 0), 0);
  const totalWithPhone = items.filter((i) => Boolean(i.phone)).length;
  const totalRecovered = items.filter((i) => i.recovered).length;

  // Filtered lists
  const q = searchQuery.toLowerCase().trim();
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (activeTab === "phone" && !item.phone) return false;
      if (activeTab === "recovered" && !item.recovered) return false;
      if (q) {
        const phoneMatch = item.phone?.toLowerCase().includes(q);
        const emailMatch = item.email?.toLowerCase().includes(q);
        const itemMatch = (item.items || []).some((li) => li.name?.toLowerCase().includes(q));
        if (!phoneMatch && !emailMatch && !itemMatch) return false;
      }
      return true;
    });
  }, [items, activeTab, q]);

  const filteredChases = useMemo(() => {
    return chases.filter((c) => {
      if (q) {
        const prodMatch = c.productName?.toLowerCase().includes(q);
        const sessionMatch = c.sessionId.toLowerCase().includes(q);
        if (!prodMatch && !sessionMatch) return false;
      }
      return true;
    });
  }, [chases, q]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="page-title">Abandoned Cart & Checkout Chase</h1>
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
              {dict.commerce.text1xatpzf}</span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {dict.commerce.recoverCartsDroppedOffWith}</p>
          {isDhakaQuietHour(new Date()) && (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
              <span>🌙</span>
              <span>{dict.commerce.itIsQuietHoursNow}</span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowTierSequenceDrawer(!showTierSequenceDrawer)}
            className="rounded-xl border border-emerald-500/30 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-800 shadow-xs hover:bg-emerald-100 flex items-center gap-1.5 transition"
          >
            <span>⚡</span>
            <span>{dict.commerce.multiTierChaseSequence}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowChaseSettings(!showChaseSettings)}
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-xs hover:bg-slate-50"
          >
            {dict.commerce.chaseRulesQuietHours}</button>
          <button
            type="button"
            onClick={() => setShowCouponSettings(!showCouponSettings)}
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-xs hover:bg-slate-50"
          >
            {dict.commerce.couponConfiguration}</button>
          <Link href="/dashboard/commerce/sync" className="btn-primary text-xs">
            Sync Center →
          </Link>
        </div>
      </div>

      {/* Top Recovery KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{dict.commerce.totalDropOffCarts}</p>
          <div className="mt-1 text-2xl font-black text-slate-900">{items.length}</div>
          <p className="mt-1 text-[11px] text-slate-400">{dict.commerce.allAbandonedCheckoutsCarts}</p>
        </div>

        <div className="card p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-rose-500">{dict.commerce.potentialDropOffRevenue}</p>
          <div className="mt-1 text-2xl font-black text-rose-600">
            {dict.commerce.text1yr}{fmtNumber(locale, (totalAbandonedRevenue / 100), { maximumFractionDigits: 0 })}
          </div>
          <p className="mt-1 text-[11px] text-rose-700">{dict.commerce.salesRecoverableWithCoupons}</p>
        </div>

        <div className="card p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-600">{dict.commerce.whatsAppRecoverable}</p>
          <div className="mt-1 text-2xl font-black text-emerald-600">{totalWithPhone}</div>
          <p className="mt-1 text-[11px] text-emerald-700 font-medium">{dict.commerce.eligibleForDirect1Click}</p>
        </div>

        <div className="card p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-indigo-600">{dict.commerce.successfullyRecovered}</p>
          <div className="mt-1 text-2xl font-black text-indigo-600">{totalRecovered}</div>
          <p className="mt-1 text-[11px] text-indigo-700 font-medium">{dict.commerce.convertedToAnOrder}</p>
        </div>
      </div>

      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      {/* Multi-Tier Sequence & Escalation Simulator Drawer */}
      {showTierSequenceDrawer && (
        <div className="card space-y-5 border-2 border-emerald-500/30 bg-emerald-50/15 p-5 transition">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-xl text-white shadow-sm">
                ⚡
              </span>
              <div>
                <h3 className="font-bold text-slate-900 text-base">
                  {dict.commerce.multiTierAutoChaseSequence}</h3>
                <p className="text-xs text-slate-500">
                  {dict.commerce.recoverDropOffSalesIn}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowTierSequenceDrawer(false)}
              className="text-xs font-semibold text-slate-400 hover:text-slate-600"
            >
              {dict.commerce.close2}</button>
          </div>

          {/* Sequence Timeline Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            {/* Tier 1 */}
            <div className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-2xs space-y-3">
              <div className="flex items-center justify-between border-b pb-2">
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                  {dict.commerce.step1}{tierConfig.tier1DelayMinutes} {dict.commerce.minutesLater}</span>
                <span className="text-xs font-semibold text-slate-500">{dict.commerce.marginProtection}</span>
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">{dict.commerce.friendlyReminderStockHold}</h4>
                <p className="text-xs text-slate-600 mt-1">
                  {dict.commerce.withoutAnyDiscountOrCoupon}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-2.5 text-[11px] text-slate-600">
                <p className="font-semibold text-slate-700">{dict.commerce.strategy}</p>
                <p>{dict.commerce.convertShoppersWithEarlyInterest}</p>
              </div>
            </div>

            {/* Tier 2 */}
            <div className="rounded-2xl border border-blue-200 bg-white p-4 shadow-2xs space-y-3">
              <div className="flex items-center justify-between border-b pb-2">
                <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-bold text-blue-800">
                  {dict.commerce.step2}{tierConfig.tier2DelayMinutes} {dict.commerce.minutes1Hour}</span>
                <span className="text-xs font-bold text-blue-700">{dict.commerce.incentiveBoost}</span>
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">{dict.commerce.text1r67wxw}</h4>
                <p className="text-xs text-slate-600 mt-1">
                  {dict.commerce.forThoseWhoDidNot}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="block font-semibold text-slate-700">
                  {dict.commerce.couponCode}<input
                    type="text"
                    value={tierConfig.tier2CouponCode}
                    onChange={(e) => setTierConfig({ ...tierConfig, tier2CouponCode: e.target.value.toUpperCase() })}
                    className="input mt-1 py-1 font-mono uppercase text-xs"
                  />
                </label>
                <label className="block font-semibold text-slate-700">
                  {dict.commerce.discountDescription}<input
                    type="text"
                    value={tierConfig.tier2DiscountText}
                    onChange={(e) => setTierConfig({ ...tierConfig, tier2DiscountText: e.target.value })}
                    className="input mt-1 py-1 text-xs"
                  />
                </label>
              </div>
            </div>

            {/* Tier 3 */}
            <div className="rounded-2xl border border-rose-200 bg-white p-4 shadow-2xs space-y-3">
              <div className="flex items-center justify-between border-b pb-2">
                <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-800">
                  {dict.commerce.step3}{Math.round(tierConfig.tier3DelayMinutes / 60)} {dict.commerce.hours24Hours}</span>
                <span className="text-xs font-bold text-rose-600">{dict.commerce.finalCall}</span>
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">{dict.commerce.textcr3s4s}</h4>
                <p className="text-xs text-slate-600 mt-1">
                  {dict.commerce.lastChanceBeforeTheStock}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="block font-semibold text-slate-700">
                  {dict.commerce.finalCoupon}<input
                    type="text"
                    value={tierConfig.tier3CouponCode}
                    onChange={(e) => setTierConfig({ ...tierConfig, tier3CouponCode: e.target.value.toUpperCase() })}
                    className="input mt-1 py-1 font-mono uppercase text-xs"
                  />
                </label>
                <label className="block font-semibold text-slate-700">
                  {dict.commerce.discountDescription}<input
                    type="text"
                    value={tierConfig.tier3DiscountText}
                    onChange={(e) => setTierConfig({ ...tierConfig, tier3DiscountText: e.target.value })}
                    className="input mt-1 py-1 text-xs"
                  />
                </label>
              </div>
            </div>
          </div>

          {/* ROI Simulator Banner */}
          {(() => {
            const sim = calculateSequenceRecoveryRoi(items.length, 1500);
            return (
              <div className="rounded-2xl border border-emerald-300 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                      {dict.commerce.sequenceRecoveryPotentialRevenueSimulator}</h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {dict.commerce.aCombinedRecoveryForecastOf}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-xs font-bold">
                    <span className="text-slate-600">{dict.commerce.totalDropOff}{items.length} {dict.commerce.text1ou8}</span>
                    <span className="text-emerald-700">{dict.commerce.potentialRecovery}{sim.recoveredOrders} {dict.commerce.orders2}{sim.overallRecoveryRatePct}%)</span>
                    <span className="text-indigo-700">{dict.commerce.potentialNewSales}{fmtNumber(locale, sim.recoveredRevenueTaka)}</span>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 border-t pt-3 text-center text-xs">
                  <div className="rounded-xl bg-slate-50 p-2">
                    <div className="text-slate-500 text-[11px]">{dict.commerce.tier1Recovery}</div>
                    <div className="font-bold text-slate-800">~{sim.tier1Count} {dict.commerce.texto6s0qv}</div>
                  </div>
                  <div className="rounded-xl bg-blue-50 p-2">
                    <div className="text-blue-600 text-[11px]">{dict.commerce.tier250Off}</div>
                    <div className="font-bold text-blue-900">~{sim.tier2Count} {dict.commerce.texto5odc2}</div>
                  </div>
                  <div className="rounded-xl bg-rose-50 p-2">
                    <div className="text-rose-600 text-[11px]">{dict.commerce.tier3100Off}</div>
                    <div className="font-bold text-rose-900">~{sim.tier3Count} {dict.commerce.texto41405}</div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Controls & Quiet hours */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span className="text-emerald-600 font-bold">{dict.commerce.quietHoursActive}</span>
              <span>{dict.commerce.pushesWillStayPausedFrom}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={() => {
                  setTierNotice(dict.commerce.multiTierSequenceCouponEscalation);
                  setTimeout(() => setTierNotice(""), 3500);
                }}
              >
                {dict.commerce.saveSequenceConfiguration}</button>
              {tierNotice && <span className="text-xs font-bold text-emerald-600">{tierNotice}</span>}
            </div>
          </div>
        </div>
      )}

      {/* Chase Rule & Quiet Hours Settings Drawer/Card */}
      {showChaseSettings && (
        <div className="card space-y-4 border-2 border-indigo-100 bg-indigo-50/20 p-5 transition">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">🌙</span>
              <div>
                <h3 className="font-bold text-slate-900">{dict.commerce.automatedChaseRulesQuietHours}</h3>
                <p className="text-xs text-slate-500">
                  {dict.commerce.whenHowManyTimesAutomated}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowChaseSettings(false)}
              className="text-xs font-semibold text-slate-400 hover:text-slate-600"
            >
              {dict.commerce.close2}</button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-xs font-semibold text-slate-700">
              {dict.commerce.chaseAutomationStatus}<select
                className="input mt-1 text-xs"
                value={chaseSettings.enabled ? "on" : "off"}
                onChange={(e) => setChaseSettings({ ...chaseSettings, enabled: e.target.value === "on" })}
              >
                <option value="on">{dict.commerce.onActive}</option>
                <option value="off">{dict.commerce.offDisabled}</option>
              </select>
            </label>

            <label className="block text-xs font-semibold text-slate-700">
              {dict.commerce.firstReminderDelay}<select
                className="input mt-1 text-xs"
                value={chaseSettings.firstDelayMinutes}
                onChange={(e) => setChaseSettings({ ...chaseSettings, firstDelayMinutes: Number(e.target.value) })}
              >
                <option value={15}>{dict.commerce.after15Minutes}</option>
                <option value={30}>{dict.commerce.after30Minutes}</option>
                <option value={60}>{dict.commerce.after1HourRecommended}</option>
                <option value={120}>{dict.commerce.after2Hours}</option>
              </select>
            </label>

            <label className="block text-xs font-semibold text-slate-700">
              {dict.commerce.nextReminderInterval}<select
                className="input mt-1 text-xs"
                value={chaseSettings.intervalMinutes}
                onChange={(e) => setChaseSettings({ ...chaseSettings, intervalMinutes: Number(e.target.value) })}
              >
                <option value={120}>{dict.commerce.after2Hours}</option>
                <option value={240}>{dict.commerce.after4HoursRecommended}</option>
                <option value={360}>{dict.commerce.after6Hours}</option>
              </select>
            </label>

            <label className="block text-xs font-semibold text-slate-700">
              {dict.commerce.maximumFollowUpAttempts}<select
                className="input mt-1 text-xs"
                value={chaseSettings.maxAttempts}
                onChange={(e) => setChaseSettings({ ...chaseSettings, maxAttempts: Number(e.target.value) })}
              >
                <option value={2}>{dict.commerce.text12sfdwm}</option>
                <option value={3}>{dict.commerce.text1kwstnp}</option>
                <option value={5}>{dict.commerce.text12u2rop}</option>
              </select>
            </label>
          </div>

          <div className="rounded-xl border border-indigo-200 bg-white p-3.5 text-xs">
            <div className="font-semibold text-indigo-900 flex items-center gap-1.5">
              <span>{dict.commerce.quietHoursProtectionAsiaDhaka}</span>
            </div>
            <p className="mt-1 text-slate-600 leading-relaxed">
              {dict.commerce.noAutomatedRecoveryMessagesWill}</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn-primary text-xs"
              onClick={() => {
                setChaseNotice(dict.commerce.chaseQuietHoursSettingsUpdated);
                setTimeout(() => setChaseNotice(""), 3000);
              }}
            >
              {dict.commerce.saveChaseSettings}</button>
            {chaseNotice && <span className="text-xs font-bold text-emerald-600">{chaseNotice}</span>}
          </div>
        </div>
      )}

      {/* Recovery Coupon Setting Form */}
      {showCouponSettings && (
        <div className="card space-y-4 border-2 border-emerald-100 bg-emerald-50/20 p-5 transition">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold text-slate-900 flex items-center gap-2">
                <span>🎟️</span>
                <span>{dict.commerce.automaticRecoveryCouponSettings}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {dict.commerce.ifThisSettingIsOn}</p>
            </div>
            <button
              type="button"
              onClick={() => setShowCouponSettings(false)}
              className="text-xs font-semibold text-slate-400 hover:text-slate-600"
            >
              {dict.commerce.close2}</button>
          </div>

          {couponError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{couponError}</p> : null}
          {couponNotice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{couponNotice}</p> : null}

          <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              checked={couponEnabled}
              onChange={(e) => setCouponEnabled(e.target.checked)}
            />
            {dict.commerce.enableTheRecoveryCouponFeature}</label>

          <div className="grid gap-3 md:grid-cols-4">
            <label className="block text-xs font-semibold text-slate-700">
              {dict.commerce.discountType}<select
                className="input mt-1 text-xs"
                value={couponKind}
                onChange={(e) => setCouponKind(e.target.value as "percent" | "fixed")}
                disabled={!couponEnabled}
              >
                <option value="fixed">{dict.commerce.fixedAmount}</option>
                <option value="percent">{dict.commerce.percentage}</option>
              </select>
            </label>

            <label className="block text-xs font-semibold text-slate-700">
              {couponKind === "percent" ? dict.commerce.percentage : dict.commerce.amountInTaka}
              <input
                className="input mt-1 text-xs"
                type="number"
                min="0"
                value={couponValue}
                onChange={(e) => setCouponValue(e.target.value)}
                disabled={!couponEnabled}
              />
            </label>

            <label className="block text-xs font-semibold text-slate-700">
              {dict.commerce.couponValidityHours}<input
                className="input mt-1 text-xs"
                type="number"
                min="1"
                value={couponExpiryHours}
                onChange={(e) => setCouponExpiryHours(e.target.value)}
                disabled={!couponEnabled}
              />
            </label>

            <label className="block text-xs font-semibold text-slate-700">
              {dict.commerce.minimumOrderTakaEmptyNone}<input
                className="input mt-1 text-xs"
                type="number"
                value={couponMinOrder}
                onChange={(e) => setCouponMinOrder(e.target.value)}
                disabled={!couponEnabled}
              />
            </label>
          </div>

          <button className="btn-primary text-xs" disabled={busy !== ""} onClick={saveCouponSetting}>
            {busy === "coupon-setting" ? dict.commerce.saving2 : dict.commerce.saveCouponSettings}
          </button>
        </div>
      )}

      {shopifyStoreIds.length > 0 ? (
        <div className="card p-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{dict.commerce.backfillOldAbandonedCheckoutsFrom}</span>
          {shopifyStoreIds.map((sid) => (
            <button
              key={sid}
              className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 hover:bg-slate-50"
              disabled={busy !== ""}
              onClick={() => backfill(sid)}
            >
              {busy === `backfill-${sid}` ? dict.commerce.pulling : dict.commerce.runShopifyBackfill}
            </button>
          ))}
          <span className="text-xs text-slate-400">{dict.commerce.newDropOffsArriveAutomatically}</span>
        </div>
      ) : null}

      {/* Tabs & Search Filter */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("all")}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
              activeTab === "all"
                ? "bg-slate-900 text-white shadow-xs"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {dict.commerce.allDropOffCarts}{items.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("chases")}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
              activeTab === "chases"
                ? "bg-indigo-600 text-white shadow-xs"
                : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
            }`}
          >
            {dict.commerce.botOrderChases}{chases.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("phone")}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
              activeTab === "phone"
                ? "bg-emerald-600 text-white shadow-xs"
                : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            }`}
          >
            {dict.commerce.whatsAppRecoverable2}{totalWithPhone})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("recovered")}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
              activeTab === "recovered"
                ? "bg-green-600 text-white shadow-xs"
                : "bg-green-50 text-green-700 hover:bg-green-100"
            }`}
          >
            {dict.commerce.recovered}{totalRecovered})
          </button>
        </div>

        <div className="w-full sm:w-64">
          <input
            type="text"
            className="input text-xs py-1.5"
            placeholder={dict.commerce.searchByPhoneNumberOr}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Main Content Area */}
      {activeTab === "chases" ? (
        /* Stalled Bot Sessions / Order Chase View */
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold text-slate-900">{dict.commerce.stalledBotSessionsStalledBot}</h2>
              <p className="text-xs text-slate-500">
                {dict.commerce.theCustomerStoppedInThe}</p>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-slate-400">{dict.common.loading}</p>
          ) : filteredChases.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">
              {dict.commerce.noStalledBotSessionsFound}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-slate-400">
                    <th className="py-2.5 font-medium">{dict.commerce.product}</th>
                    <th className="py-2.5 font-medium">{dict.commerce.sessionStatus}</th>
                    <th className="py-2.5 font-medium">{dict.commerce.chaseStatus}</th>
                    <th className="py-2.5 font-medium">{dict.commerce.lastActivity}</th>
                    <th className="py-2.5 font-medium">{dict.commerce.action}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredChases.map((c) => (
                    <tr key={c.id} className="border-b last:border-0 align-top">
                      <td className="py-3 font-medium text-slate-900">
                        {c.productName ?? dict.commerce.productUnspecified}
                        <div className="text-[11px] font-mono text-slate-400">ID: {c.sessionId.slice(0, 10)}…</div>
                      </td>
                      <td className="py-3 text-xs text-slate-600">
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                          {c.sessionStatus ?? "active"}
                        </span>
                        {c.sessionState ? <div className="mt-0.5 text-[11px] text-slate-400">{c.sessionState}</div> : null}
                      </td>
                      <td className="py-3">
                        <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                          c.stoppedReason === "completed"
                            ? "bg-green-100 text-green-800"
                            : c.stoppedReason
                            ? "bg-slate-100 text-slate-600"
                            : "bg-indigo-100 text-indigo-700"
                        }`}>
                          {chaseStatusLabel(c, dict.commerce, t)}
                        </span>
                        {c.lastFailedAt && (!c.lastChasedAt || c.lastFailedAt > c.lastChasedAt) ? (
                          <div className="mt-1 text-[11px] text-red-500 font-medium">{dict.commerce.failedWillRetry}</div>
                        ) : null}
                      </td>
                      <td className="py-3 text-xs text-slate-500">
                        {ageText(c.lastChasedAt ?? c.createdAt, dict, t)}
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="rounded-lg bg-emerald-600 text-white px-2.5 py-1 text-xs font-bold hover:bg-emerald-700 flex items-center gap-1 shadow-xs transition"
                            onClick={() => openWhatsAppModal({
                              id: c.id,
                              phone: c.phone || "",
                              productName: c.productName,
                              checkoutUrl: "",
                              abandonedAt: c.lastChasedAt || c.createdAt,
                              attemptsCount: c.attempts,
                            })}
                          >
                            <span>⚡</span>
                            <span>{dict.commerce.whatsAppChase}</span>
                          </button>

                          {c.conversationId ? (
                            <Link
                              href="/dashboard/inbox"
                              className="rounded-lg border px-2 py-1 text-xs font-semibold hover:bg-slate-50"
                            >
                              {dict.commerce.openInbox}</Link>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* Abandoned Checkouts & Carts View */
        <div className="card p-5">
          {loading ? (
            <p className="text-sm text-slate-400">{dict.common.loading}</p>
          ) : filteredItems.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">
              {dict.commerce.noAbandonedCartsCheckoutsFound}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-slate-400">
                    <th className="py-2.5 font-medium">{dict.commerce.source}</th>
                    <th className="py-2.5 font-medium">{dict.commerce.customer2}</th>
                    <th className="py-2.5 font-medium">{dict.commerce.whatIsInTheCart}</th>
                    <th className="py-2.5 font-medium">{dict.commerce.price}</th>
                    <th className="py-2.5 font-medium">{dict.commerce.dropOffTime}</th>
                    <th className="py-2.5 font-medium">{dict.commerce.status}</th>
                    <th className="py-2.5 font-medium">{dict.commerce.action}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => (
                    <React.Fragment key={`${item.source}-${item.id}`}>
                      <tr className="border-b last:border-0 align-top">
                        <td className="py-3">
                          <span
                            className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                              item.source === "shopify"
                                ? "bg-emerald-100 text-emerald-800"
                                : item.source === "storefront"
                                ? "bg-purple-100 text-purple-800"
                                : "bg-indigo-100 text-indigo-800"
                            }`}
                          >
                            {item.source === "shopify" ? "Shopify" : item.source === "storefront" ? "Storefront" : "Tracker"}
                          </span>
                          {item.storeName ? <div className="mt-1 text-xs text-slate-400">{item.storeName}</div> : null}
                        </td>

                        <td className="py-3 text-xs">
                          {item.phone ? (
                            <div className="font-bold text-slate-900 flex items-center gap-1">
                              <span>📱</span>
                              <span>{item.phone}</span>
                            </div>
                          ) : null}
                          <div className="text-slate-500">{item.email ?? (item.phone ? "" : "—")}</div>
                        </td>

                        <td className="py-3 text-xs text-slate-700">
                          {(item.items ?? []).length === 0 ? (
                            "—"
                          ) : (
                            (item.items ?? []).map((li, i) => (
                              <div key={i} className="font-medium">
                                {li.name ?? dict.commerce.product}
                                {li.quantity ? ` ×${li.quantity}` : ""}
                              </div>
                            ))
                          )}
                        </td>

                        <td className="py-3 font-bold text-slate-900">
                          {money(item.totalMinor, item.currency ?? "BDT", locale)}
                        </td>

                        <td className="py-3 text-xs text-slate-500">{ageText(item.abandonedAt, dict, t)}</td>

                        <td className="py-3">
                          {item.recovered ? (
                            <span className="rounded bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-700">
                              {dict.commerce.recoveredOrderPlaced}</span>
                          ) : item.recoverySentAt ? (
                            <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                              {dict.commerce.pushSent}</span>
                          ) : (
                            <span className="rounded bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">
                              {dict.commerce.openDropOff}</span>
                          )}
                        </td>

                        <td className="py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {item.phone && !item.recovered ? (() => {
                              const tInfo = determineCurrentChaseTier(
                                item.abandonedAt || new Date().toISOString(),
                                item.recoverySentAt ? 1 : 0,
                                tierConfig
                              );
                              return (
                                <button
                                  type="button"
                                  className="rounded-lg bg-emerald-600 text-white px-2.5 py-1 text-xs font-bold hover:bg-emerald-700 flex items-center gap-1 shadow-xs transition"
                                  onClick={() => openWhatsAppModal({
                                    ...item,
                                    abandonedAt: item.abandonedAt,
                                    attemptsCount: item.recoverySentAt ? 1 : 0,
                                  })}
                                >
                                  <span>⚡</span>
                                  <span>{dict.commerce.tier}{tInfo.nextTier || 1} {dict.commerce.chase}</span>
                                </button>
                              );
                            })() : null}

                            {!item.recovered && !item.recoverySentAt && item.email ? (
                              <button
                                type="button"
                                className="rounded-lg border px-2 py-1 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50"
                                disabled={busy !== ""}
                                onClick={() => recoverEmail(item)}
                              >
                                {busy === `recover-${item.id}` ? dict.commerce.sending : dict.commerce.email3}
                              </button>
                            ) : null}

                            {item.conversationId ? (
                              <Link
                                href="/dashboard/inbox"
                                className="rounded-lg border px-2 py-1 text-xs font-semibold hover:bg-slate-50"
                              >
                                {dict.commerce.inbox}</Link>
                            ) : null}

                            {item.checkoutUrl ? (
                              <a
                                href={item.checkoutUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-lg border px-2 py-1 text-xs font-semibold hover:bg-slate-50"
                              >
                                {dict.commerce.checkoutLink}</a>
                            ) : null}

                            <button
                              type="button"
                              className="rounded-lg border px-2 py-1 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50"
                              disabled={seqBusyId === item.id}
                              onClick={() => void toggleSequence(item)}
                            >
                              {seqBusyId === item.id ? "…" : expandedId === item.id ? dict.commerce.hide2 : dict.commerce.sequence}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {expandedId === item.id ? (
                        <tr className="border-b bg-slate-50/70">
                          <td colSpan={7} className="px-4 py-3">
                            {seqBusyId === item.id ? (
                              <p className="text-xs text-slate-400">{dict.commerce.sequenceLoading}</p>
                            ) : seqErrorById[item.id] ? (
                              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{seqErrorById[item.id]}</p>
                            ) : !seqById[item.id] ? (
                              <p className="text-xs text-slate-400">{dict.commerce.noInformationFound}</p>
                            ) : !seqById[item.id].enrolled ? (
                              <p className="text-xs font-semibold text-slate-600">{dict.commerce.notIncludedInAnyAutomation}</p>
                            ) : (
                              <div className="space-y-2 text-xs">
                                <p className="text-slate-700">
                                  {dict.commerce.workflow}<b>{seqById[item.id].workflowName ?? "—"}</b>
                                  {" "}{dict.commerce.runStatus}<b>{sequenceStatusLabel(seqById[item.id].runStatus, locale)}</b>
                                  {seqById[item.id].currentStepIndex != null ? <> {dict.commerce.currentStep}<b>{seqById[item.id].currentStepIndex! + 1}</b></> : null}
                                  {seqById[item.id].lastActivityAt ? <> {dict.commerce.lastActivity2}{fmtDateTime(locale, new Date(seqById[item.id].lastActivityAt!))}</> : null}
                                </p>
                                {(seqById[item.id].steps ?? []).length > 0 ? (
                                  <ul className="space-y-1">
                                    {(seqById[item.id].steps ?? []).map((s, i) => (
                                      <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 shadow-2xs">
                                        <span className="font-semibold text-slate-700">{i + 1}. {s.step}</span>
                                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{sequenceStatusLabel(s.status, locale)}</span>
                                        {s.detail ? <span className="text-slate-500">{s.detail}</span> : null}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="text-slate-500">{dict.commerce.noStepLogsYet}</p>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 1-Click WhatsApp Recovery Generator Modal */}
      {waModalOpen && targetItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="card w-full max-w-lg space-y-4 border-2 border-emerald-500 bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl">💬</span>
                  <h3 className="font-bold text-slate-900 text-base">{dict.commerce.texto39sgb}</h3>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {dict.commerce.prepareACustomizedMessageFor}</p>
              </div>
              <button
                type="button"
                onClick={() => setWaModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {/* Customer Details Pill */}
            <div className="flex flex-wrap items-center justify-between rounded-xl bg-slate-50 p-3 text-xs">
              <div>
                <span className="text-slate-400">{dict.commerce.customerPhone}</span>
                <span className="font-bold text-slate-900">{targetItem.phone || dict.commerce.numberNotFound}</span>
              </div>
              <div>
                <span className="text-slate-400">{dict.commerce.product2}</span>
                <span className="font-semibold text-slate-800">{targetItem.productName}</span>
              </div>
            </div>

            {/* Multi-Tier Sequence Step Selector */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700">{dict.commerce.selectASequenceTier}</label>
                {targetItemTierInfo && (
                  <span className={`text-[11px] font-semibold ${targetItemTierInfo.isReady ? "text-emerald-700" : "text-amber-700"}`}>
                    {targetItemTierInfo.waitMessageBangla}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => applyTierSwitch(1)}
                  className={`rounded-xl border p-2 text-center text-xs font-bold transition ${
                    selectedTier === 1
                      ? "border-emerald-600 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-600"
                      : "border-slate-200 hover:bg-slate-50 text-slate-700"
                  }`}
                >
                  <div>{dict.commerce.text1276aob}</div>
                  <div className="text-[10px] text-slate-500 font-normal">{dict.commerce.stockReservation}</div>
                </button>

                <button
                  type="button"
                  onClick={() => applyTierSwitch(2)}
                  className={`rounded-xl border p-2 text-center text-xs font-bold transition ${
                    selectedTier === 2
                      ? "border-blue-600 bg-blue-50 text-blue-800 ring-2 ring-blue-600"
                      : "border-slate-200 hover:bg-slate-50 text-slate-700"
                  }`}
                >
                  <div>{dict.commerce.textc4nko0}</div>
                  <div className="text-[10px] text-blue-600 font-normal">{tierConfig.tier2CouponCode} ({tierConfig.tier2DiscountText})</div>
                </button>

                <button
                  type="button"
                  onClick={() => applyTierSwitch(3)}
                  className={`rounded-xl border p-2 text-center text-xs font-bold transition ${
                    selectedTier === 3
                      ? "border-rose-600 bg-rose-50 text-rose-800 ring-2 ring-rose-600"
                      : "border-slate-200 hover:bg-slate-50 text-slate-700"
                  }`}
                >
                  <div>{dict.commerce.text1f1yuv9}</div>
                  <div className="text-[10px] text-rose-600 font-normal">{tierConfig.tier3CouponCode} ({tierConfig.tier3DiscountText})</div>
                </button>
              </div>
            </div>

            {/* Quick Coupon Presets */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">{dict.commerce.orSelectAnotherCouponPreset}</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <button
                  type="button"
                  onClick={() => applyCouponPreset("VIP50", dict.commerce.text1yc0qme)}
                  className={`rounded-xl border p-2 text-center text-xs font-bold transition ${
                    waCouponCode === "VIP50"
                      ? "border-emerald-600 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-600"
                      : "border-slate-200 hover:bg-slate-50 text-slate-700"
                  }`}
                >
                  <div>{dict.commerce.text1yc0qme}</div>
                  <div className="text-[10px] font-mono text-slate-400 font-normal">VIP50</div>
                </button>

                <button
                  type="button"
                  onClick={() => applyCouponPreset("COMEBACK100", dict.commerce.textj6jq2i)}
                  className={`rounded-xl border p-2 text-center text-xs font-bold transition ${
                    waCouponCode === "COMEBACK100"
                      ? "border-emerald-600 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-600"
                      : "border-slate-200 hover:bg-slate-50 text-slate-700"
                  }`}
                >
                  <div>{dict.commerce.textj6jq2i}</div>
                  <div className="text-[10px] font-mono text-slate-400 font-normal">COMEBACK100</div>
                </button>

                <button
                  type="button"
                  onClick={() => applyCouponPreset("FREESHIP", dict.commerce.freeHomeDelivery)}
                  className={`rounded-xl border p-2 text-center text-xs font-bold transition ${
                    waCouponCode === "FREESHIP"
                      ? "border-emerald-600 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-600"
                      : "border-slate-200 hover:bg-slate-50 text-slate-700"
                  }`}
                >
                  <div>{dict.commerce.freeDelivery}</div>
                  <div className="text-[10px] font-mono text-slate-400 font-normal">FREESHIP</div>
                </button>

                <button
                  type="button"
                  onClick={() => applyCouponPreset("SAVE10", dict.commerce.text170ta1j)}
                  className={`rounded-xl border p-2 text-center text-xs font-bold transition ${
                    waCouponCode === "SAVE10"
                      ? "border-emerald-600 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-600"
                      : "border-slate-200 hover:bg-slate-50 text-slate-700"
                  }`}
                >
                  <div>{dict.commerce.text1fnjq9r}</div>
                  <div className="text-[10px] font-mono text-slate-400 font-normal">SAVE10</div>
                </button>
              </div>
            </div>

            {/* Custom Discount Input fields */}
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs font-semibold text-slate-700">
                {dict.commerce.couponCode}<input
                  type="text"
                  className="input mt-1 text-xs font-mono font-bold uppercase"
                  value={waCouponCode}
                  onChange={(e) => {
                    const code = e.target.value.toUpperCase();
                    setWaCouponCode(code);
                    applyCouponPreset(code, waDiscountText);
                  }}
                />
              </label>

              <label className="block text-xs font-semibold text-slate-700">
                {dict.commerce.discountDescription}<input
                  type="text"
                  className="input mt-1 text-xs font-medium"
                  value={waDiscountText}
                  onChange={(e) => {
                    const txt = e.target.value;
                    setWaDiscountText(txt);
                    applyCouponPreset(waCouponCode, txt);
                  }}
                />
              </label>
            </div>

            {/* Live Message Preview */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700">{dict.commerce.messagePreviewEditable}</label>
                {copiedNotice && <span className="text-[11px] font-bold text-emerald-600">{dict.commerce.messageCopied}</span>}
              </div>
              <textarea
                rows={5}
                className="input w-full font-mono text-xs leading-relaxed"
                value={waCustomMessage}
                onChange={(e) => handleMessageChange(e.target.value)}
              />
            </div>

            {isDhakaQuietHour(new Date(), tierConfig.quietHoursStart, tierConfig.quietHoursEnd) && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 flex items-center gap-2">
                <span>🌙</span>
                <span>{dict.commerce.itIsQuietHoursNow2}</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
              <button
                type="button"
                onClick={() => copyToClipboard(waCustomMessage)}
                className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
              >
                {dict.commerce.copy3}</button>

              <button
                type="button"
                disabled={!targetItem.phone}
                onClick={() => {
                  if (waGeneratedLink) {
                    window.open(waGeneratedLink, "_blank");
                    setWaModalOpen(false);
                    setNotice(dict.commerce.whatsAppMessageSentAndOpened);
                  }
                }}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 flex items-center gap-1.5 shadow-sm transition disabled:opacity-50"
              >
                <span>🟢</span>
                <span>{dict.commerce.sendOnWhatsApp1Click}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
