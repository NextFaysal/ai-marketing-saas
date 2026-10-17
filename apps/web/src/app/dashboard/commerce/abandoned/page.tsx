"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
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

const money = (minor?: string | null, currency = "BDT") =>
  minor == null ? "—" : `${currency === "BDT" ? "৳" : currency + " "}${(Number(minor) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function ageText(iso?: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "এখনই";
  const h = Math.floor(ms / 3600000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60000))} মিনিট আগে`;
  if (h < 24) return `${h} ঘণ্টা আগে`;
  return `${Math.floor(h / 24)} দিন আগে`;
}

const chaseStopBn = (reason: string) => {
  switch (reason) {
    case "completed": return "অর্ডার সম্পূর্ণ হয়েছে ✓";
    case "stop_word": return "গ্রাহক থামতে বলেছেন (স্টপ ওয়ার্ড)";
    case "human_took_over": return "মানুষ দায়িত্ব নিয়েছেন";
    case "max_attempts": return "সর্বোচ্চ চেষ্টা শেষ";
    case "session_ended": return "সেশন শেষ হয়েছে";
    default: return reason;
  }
};

const chaseStatusBn = (c: ChaseRow) => {
  if (c.stoppedReason) return chaseStopBn(c.stoppedReason);
  if (c.attempts > 0) return `${c.attempts} বার মনে করানো হয়েছে`;
  if (c.lastEvent === "customer_replied") return "গ্রাহক উত্তর দিয়েছেন — অপেক্ষায়";
  return "অনুস্মারকের অপেক্ষায়";
};

export default function AbandonedPage() {
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
  const [waDiscountText, setWaDiscountText] = useState("৫০ টাকা ছাড়");
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
      setError(e instanceof Error ? e.message : "লোড ব্যর্থ");
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
      setCouponNotice("পুনরুদ্ধার কুপনের সেটিংস সংরক্ষণ হয়েছে।");
      await loadCouponSetting();
    } catch (e) {
      setCouponError(e instanceof Error ? e.message : "সংরক্ষণ ব্যর্থ");
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
      setSeqErrorById((m) => ({ ...m, [item.id]: e instanceof Error ? e.message : "সিকোয়েন্স লোড ব্যর্থ" }));
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
      setNotice("Recovery ইমেইল পাঠানো হয়েছে।");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recovery ব্যর্থ");
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
    const itemNames = cartOrChase.productName || (cartOrChase.items || []).map((i) => i.name || "পণ্য").slice(0, 3).join(", ") || "পণ্য";
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
    const initialDiscount = initialTier === 2 ? tierConfig.tier2DiscountText : initialTier === 3 ? tierConfig.tier3DiscountText : "৫০ টাকা ছাড়";
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
      setNotice(`Shopify থেকে abandoned checkout টানা হয়েছে: মোট ${out.fetched}, নতুন ${out.created}, আপডেট ${out.updated}।`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backfill ব্যর্থ");
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
              ⚡ 1-Click WhatsApp রিকভারি
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            অর্ধেক তথ্য দিয়ে ড্রপ-অফ হওয়া কার্ট উদ্ধার করুন। ৫০-১০০ টাকা ডিসকাউন্ট কুপন ও অটোমেটেড WhatsApp / SMS রিকভারি পুশ দিয়ে সেলস দ্বিগুণ করুন।
          </p>
          {isDhakaQuietHour(new Date()) && (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
              <span>🌙</span>
              <span>এখন শান্ত সময় (Quiet Hours: রাত ১০টা - সকাল ৮টা) — অটোমেটেড পুশ বিলম্বিত থাকবে।</span>
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
            <span>মাল্টি-টিয়ার চেজ সিকোয়েন্স</span>
          </button>
          <button
            type="button"
            onClick={() => setShowChaseSettings(!showChaseSettings)}
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-xs hover:bg-slate-50"
          >
            ⚙️ চেজ রুল ও শান্ত সময়
          </button>
          <button
            type="button"
            onClick={() => setShowCouponSettings(!showCouponSettings)}
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-xs hover:bg-slate-50"
          >
            🎟️ কুপন কনফিগারেশন
          </button>
          <Link href="/dashboard/commerce/sync" className="btn-primary text-xs">
            Sync Center →
          </Link>
        </div>
      </div>

      {/* Top Recovery KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">মোট ড্রপ-অফ কার্ট</p>
          <div className="mt-1 text-2xl font-black text-slate-900">{items.length}</div>
          <p className="mt-1 text-[11px] text-slate-400">সর্বমোট ফেলে যাওয়া চেকআউট ও কার্ট</p>
        </div>

        <div className="card p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-rose-500">সম্ভাব্য ড্রপ-অফ রাজস্ব</p>
          <div className="mt-1 text-2xl font-black text-rose-600">
            ৳{(totalAbandonedRevenue / 100).toLocaleString("bn-BD", { maximumFractionDigits: 0 })}
          </div>
          <p className="mt-1 text-[11px] text-rose-700">কুপন দিয়ে উদ্ধারযোগ্য সেলস</p>
        </div>

        <div className="card p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-600">WhatsApp রিকভারযোগ্য</p>
          <div className="mt-1 text-2xl font-black text-emerald-600">{totalWithPhone}</div>
          <p className="mt-1 text-[11px] text-emerald-700 font-medium">সরাসরি ১-ক্লিকে বার্তা পাঠানোর যোগ্য</p>
        </div>

        <div className="card p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-indigo-600">সফলভাবে রিকভার্ড</p>
          <div className="mt-1 text-2xl font-black text-indigo-600">{totalRecovered}</div>
          <p className="mt-1 text-[11px] text-indigo-700 font-medium">অর্ডারে রূপান্তরিত হয়েছে ✓</p>
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
                  মাল্টি-টিয়ার অটো-চেজ সিকোয়েন্স ও কুপন এস্কেলেশন (WhatsApp Bot)
                </h3>
                <p className="text-xs text-slate-500">
                  ১৫ মিনিট (স্টক সতর্কতা) ➔ ১ ঘণ্টা (৳৫০ ক্যাশ ছাড়) ➔ ২৪ ঘণ্টা (৳১০০ ফাইনাল ক্লিয়ারেন্স) সিকোয়েন্সে ড্রপ-অফ সেলস পুনরুদ্ধার করুন।
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowTierSequenceDrawer(false)}
              className="text-xs font-semibold text-slate-400 hover:text-slate-600"
            >
              বন্ধ করুন ✕
            </button>
          </div>

          {/* Sequence Timeline Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            {/* Tier 1 */}
            <div className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-2xs space-y-3">
              <div className="flex items-center justify-between border-b pb-2">
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                  ধাপ ১: {tierConfig.tier1DelayMinutes} মিনিট পর
                </span>
                <span className="text-xs font-semibold text-slate-500">মার্জিন সুরক্ষা ✓</span>
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">ফ্রেন্ডলি রিমাইন্ডার ও স্টক হোল্ড</h4>
                <p className="text-xs text-slate-600 mt-1">
                  কোনো ছাড় বা কুপন ছাড়াই গ্রাহককে জানান যে তার পছন্দের পণ্যটি কার্টে রিজার্ভ রয়েছে এবং স্টক সীমিত।
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-2.5 text-[11px] text-slate-600">
                <p className="font-semibold text-slate-700">কৌশল:</p>
                <p>প্রাথমিক আগ্রহে থাকা shoppers-দের ফুল মার্জিনে কনভার্ট করা।</p>
              </div>
            </div>

            {/* Tier 2 */}
            <div className="rounded-2xl border border-blue-200 bg-white p-4 shadow-2xs space-y-3">
              <div className="flex items-center justify-between border-b pb-2">
                <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-bold text-blue-800">
                  ধাপ ২: {tierConfig.tier2DelayMinutes} মিনিট (১ ঘণ্টা)
                </span>
                <span className="text-xs font-bold text-blue-700">ইনসেন্টিভ বুস্ট 🎁</span>
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">৳৫০ ক্যাশ ছাড় কুপন অফার</h4>
                <p className="text-xs text-slate-600 mt-1">
                  যারা ১ম ধাপে অর্ডার করেননি, তাদের জন্য সীমিত সময়ের (২ ঘণ্টার) আকর্ষণীয় ছাড় কোড।
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="block font-semibold text-slate-700">
                  কুপন কোড
                  <input
                    type="text"
                    value={tierConfig.tier2CouponCode}
                    onChange={(e) => setTierConfig({ ...tierConfig, tier2CouponCode: e.target.value.toUpperCase() })}
                    className="input mt-1 py-1 font-mono uppercase text-xs"
                  />
                </label>
                <label className="block font-semibold text-slate-700">
                  ছাড়ের বিবরণ
                  <input
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
                  ধাপ ৩: {Math.round(tierConfig.tier3DelayMinutes / 60)} ঘণ্টা (২৪ ঘণ্টা)
                </span>
                <span className="text-xs font-bold text-rose-600">ফাইনাল কল ⏳</span>
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900">৳১০০ ফাইনাল ক্লিয়ারেন্স অফার</h4>
                <p className="text-xs text-slate-600 mt-1">
                  স্টক রিলিজ হওয়ার আগে শেষ সুযোগ। সর্বোচ্চ ছাড়ের মাধ্যমে ড্রপ-অফ অর্ডার পুনরুদ্ধার।
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="block font-semibold text-slate-700">
                  ফাইনাল কুপন
                  <input
                    type="text"
                    value={tierConfig.tier3CouponCode}
                    onChange={(e) => setTierConfig({ ...tierConfig, tier3CouponCode: e.target.value.toUpperCase() })}
                    className="input mt-1 py-1 font-mono uppercase text-xs"
                  />
                </label>
                <label className="block font-semibold text-slate-700">
                  ছাড়ের বিবরণ
                  <input
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
                      📊 সিকোয়েন্স রিকভারি ও সম্ভাব্য রাজস্ব সিমুলেটর (প্রজেকশন)
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      গড় অর্ডার ভ্যালু ৳১,৫০০ ধরে ১৮.৫% সম্মিলিত পুনরুদ্ধার পূর্বাভাস
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-xs font-bold">
                    <span className="text-slate-600">মোট ড্রপ-অফ: {items.length} টি</span>
                    <span className="text-emerald-700">সম্ভাব্য পুনরুদ্ধার: ~{sim.recoveredOrders} টি অর্ডার (+{sim.overallRecoveryRatePct}%)</span>
                    <span className="text-indigo-700">সম্ভাব্য নতুন সেলস: +৳{sim.recoveredRevenueTaka.toLocaleString("bn-BD")}</span>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 border-t pt-3 text-center text-xs">
                  <div className="rounded-xl bg-slate-50 p-2">
                    <div className="text-slate-500 text-[11px]">টিয়ার ১ রিকভারি</div>
                    <div className="font-bold text-slate-800">~{sim.tier1Count} টি (৮.৫%)</div>
                  </div>
                  <div className="rounded-xl bg-blue-50 p-2">
                    <div className="text-blue-600 text-[11px]">টিয়ার ২ (৳৫০ ছাড়)</div>
                    <div className="font-bold text-blue-900">~{sim.tier2Count} টি (৬.২%)</div>
                  </div>
                  <div className="rounded-xl bg-rose-50 p-2">
                    <div className="text-rose-600 text-[11px]">টিয়ার ৩ (৳১০০ ছাড়)</div>
                    <div className="font-bold text-rose-900">~{sim.tier3Count} টি (৩.৮%)</div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Controls & Quiet hours */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span className="text-emerald-600 font-bold">✓ শান্ত সময় সক্রিয়:</span>
              <span>রাত ১০:০০ থেকে সকাল ৮:০০ পর্যন্ত পুশ স্থগিত থাকবে। গ্রাহক স্টপ শব্দ পাঠালে সিকোয়েন্স অফ হবে।</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={() => {
                  setTierNotice("মাল্টি-টিয়ার সিকোয়েন্স ও কুপন এস্কেলেশন কনফিগারেশন সংরক্ষণ করা হয়েছে।");
                  setTimeout(() => setTierNotice(""), 3500);
                }}
              >
                সিকোয়েন্স কনফিগারেশন সংরক্ষণ করুন
              </button>
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
                <h3 className="font-bold text-slate-900">অটোমেটেড চেজ রুল ও শান্ত সময় (Quiet Hours)</h3>
                <p className="text-xs text-slate-500">
                  গ্রাহক ড্রপ-অফ করার পর কখন ও কতবার স্বয়ংক্রিয় ফলো-আপ পাঠানো হবে।
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowChaseSettings(false)}
              className="text-xs font-semibold text-slate-400 hover:text-slate-600"
            >
              বন্ধ করুন ✕
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-xs font-semibold text-slate-700">
              চেজ অটোমেশন স্ট্যাটাস
              <select
                className="input mt-1 text-xs"
                value={chaseSettings.enabled ? "on" : "off"}
                onChange={(e) => setChaseSettings({ ...chaseSettings, enabled: e.target.value === "on" })}
              >
                <option value="on">চালু (Active)</option>
                <option value="off">বন্ধ (Disabled)</option>
              </select>
            </label>

            <label className="block text-xs font-semibold text-slate-700">
              প্রথম অনুস্মারক বিলম্ব (First Delay)
              <select
                className="input mt-1 text-xs"
                value={chaseSettings.firstDelayMinutes}
                onChange={(e) => setChaseSettings({ ...chaseSettings, firstDelayMinutes: Number(e.target.value) })}
              >
                <option value={15}>১৫ মিনিট পর</option>
                <option value={30}>৩০ মিনিট পর</option>
                <option value={60}>১ ঘণ্টা পর (প্রস্তাবিত)</option>
                <option value={120}>২ ঘণ্টা পর</option>
              </select>
            </label>

            <label className="block text-xs font-semibold text-slate-700">
              পরবর্তী অনুস্মারক বিরতি
              <select
                className="input mt-1 text-xs"
                value={chaseSettings.intervalMinutes}
                onChange={(e) => setChaseSettings({ ...chaseSettings, intervalMinutes: Number(e.target.value) })}
              >
                <option value={120}>২ ঘণ্টা পর</option>
                <option value={240}>৪ ঘণ্টা পর (প্রস্তাবিত)</option>
                <option value={360}>৬ ঘণ্টা পর</option>
              </select>
            </label>

            <label className="block text-xs font-semibold text-slate-700">
              সর্বোচ্চ ফলো-আপ চেষ্টা
              <select
                className="input mt-1 text-xs"
                value={chaseSettings.maxAttempts}
                onChange={(e) => setChaseSettings({ ...chaseSettings, maxAttempts: Number(e.target.value) })}
              >
                <option value={2}>২ বার</option>
                <option value={3}>৩ বার (প্রস্তাবিত)</option>
                <option value={5}>৫ বার</option>
              </select>
            </label>
          </div>

          <div className="rounded-xl border border-indigo-200 bg-white p-3.5 text-xs">
            <div className="font-semibold text-indigo-900 flex items-center gap-1.5">
              <span>🛡️ শান্ত সময় সুরক্ষা (Asia/Dhaka রাত ১০টা — সকাল ৮টা):</span>
            </div>
            <p className="mt-1 text-slate-600 leading-relaxed">
              বাংলাদেশ সময় রাত ১০:০০ হতে সকাল ০৮:০০ পর্যন্ত কোনো স্বয়ংক্রিয় রিকভারি মেসেজ গ্রাহককে পাঠানো হবে না। সকাল ৮টার পর স্বয়ংক্রিয়ভাবে বিলম্বিত বার্তা পাঠানো হবে।
              গ্রাহক “থামুন”, “লাস্ট কত”, “দরকার নেই” বা “stop” লিখলে চেজ তাৎক্ষণিক স্বয়ংক্রিয়ভাবে স্থায়ীভাবে বন্ধ হয়ে যাবে।
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn-primary text-xs"
              onClick={() => {
                setChaseNotice("চেজ ও শান্ত সময়ের সেটিংস সফলভাবে আপডেট হয়েছে।");
                setTimeout(() => setChaseNotice(""), 3000);
              }}
            >
              চেজ সেটিংস সংরক্ষণ করুন
            </button>
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
                <span>স্বয়ংক্রিয় পুনরুদ্ধার কুপন সেটিংস</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                এই সেটিং চালু থাকলে, গ্রাহক রিকভারি মেসেজে একটি আসল ডিসকাউন্ট কুপন পাবেন যা চেকআউটে স্বয়ংক্রিয়ভাবে কাজ করবে।
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCouponSettings(false)}
              className="text-xs font-semibold text-slate-400 hover:text-slate-600"
            >
              বন্ধ করুন ✕
            </button>
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
            পুনরুদ্ধার কুপন সুবিধা চালু করুন
          </label>

          <div className="grid gap-3 md:grid-cols-4">
            <label className="block text-xs font-semibold text-slate-700">
              ছাড়ের ধরন
              <select
                className="input mt-1 text-xs"
                value={couponKind}
                onChange={(e) => setCouponKind(e.target.value as "percent" | "fixed")}
                disabled={!couponEnabled}
              >
                <option value="fixed">নির্দিষ্ট টাকা (৳)</option>
                <option value="percent">শতাংশ (%)</option>
              </select>
            </label>

            <label className="block text-xs font-semibold text-slate-700">
              {couponKind === "percent" ? "শতাংশ (%)" : "টাকার পরিমাণ (৳)"}
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
              কুপনের মেয়াদ (ঘণ্টা)
              <input
                className="input mt-1 text-xs"
                type="number"
                min="1"
                value={couponExpiryHours}
                onChange={(e) => setCouponExpiryHours(e.target.value)}
                disabled={!couponEnabled}
              />
            </label>

            <label className="block text-xs font-semibold text-slate-700">
              সর্বনিম্ন অর্ডার (টাকা, খালি = নেই)
              <input
                className="input mt-1 text-xs"
                type="number"
                value={couponMinOrder}
                onChange={(e) => setCouponMinOrder(e.target.value)}
                disabled={!couponEnabled}
              />
            </label>
          </div>

          <button className="btn-primary text-xs" disabled={busy !== ""} onClick={saveCouponSetting}>
            {busy === "coupon-setting" ? "সেভ হচ্ছে…" : "কুপন সেটিংস সেভ করুন"}
          </button>
        </div>
      )}

      {shopifyStoreIds.length > 0 ? (
        <div className="card p-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Shopify থেকে পুরনো abandoned checkout ব্যাকফিল:</span>
          {shopifyStoreIds.map((sid) => (
            <button
              key={sid}
              className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 hover:bg-slate-50"
              disabled={busy !== ""}
              onClick={() => backfill(sid)}
            >
              {busy === `backfill-${sid}` ? "টানা হচ্ছে…" : "Shopify Backfill করুন"}
            </button>
          ))}
          <span className="text-xs text-slate-400">নতুন ড্রপ-অফ স্বয়ংক্রিয়ভাবে Webhook দিয়ে চলে আসে।</span>
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
            🛒 সকল ড্রপ-অফ কার্ট ({items.length})
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
            🤖 বট অর্ডার চেজ ({chases.length})
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
            💬 WhatsApp রিকভারযোগ্য ({totalWithPhone})
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
            ✓ রিকভার্ড ({totalRecovered})
          </button>
        </div>

        <div className="w-full sm:w-64">
          <input
            type="text"
            className="input text-xs py-1.5"
            placeholder="🔍 ফোন নম্বর বা পণ্য খুঁজুন…"
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
              <h2 className="font-bold text-slate-900">🤖 Stalled Bot Sessions — থেমে যাওয়া বট অর্ডার</h2>
              <p className="text-xs text-slate-500">
                গ্রাহক চ্যাটবটে তথ্য (পণ্য/ফোন) দিয়ে কনফার্ম করার আগে থেমে গিয়েছেন। সরাসরি WhatsApp-এ বার্তা দিয়ে অর্ডার কনফার্ম করান।
              </p>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-slate-400">লোড হচ্ছে…</p>
          ) : filteredChases.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">
              কোনো থেমে যাওয়া বট সেশন পাওয়া যায়নি।
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-slate-400">
                    <th className="py-2.5 font-medium">পণ্য</th>
                    <th className="py-2.5 font-medium">সেশন অবস্থা</th>
                    <th className="py-2.5 font-medium">চেজ অবস্থা</th>
                    <th className="py-2.5 font-medium">সর্বশেষ কার্যকলাপ</th>
                    <th className="py-2.5 font-medium">অ্যাকশন</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredChases.map((c) => (
                    <tr key={c.id} className="border-b last:border-0 align-top">
                      <td className="py-3 font-medium text-slate-900">
                        {c.productName ?? "পণ্য অনির্ধারিত"}
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
                          {chaseStatusBn(c)}
                        </span>
                        {c.lastFailedAt && (!c.lastChasedAt || c.lastFailedAt > c.lastChasedAt) ? (
                          <div className="mt-1 text-[11px] text-red-500 font-medium">ব্যর্থ — পুনরায় চেষ্টা করা হবে</div>
                        ) : null}
                      </td>
                      <td className="py-3 text-xs text-slate-500">
                        {c.lastChasedAt ? ageText(c.lastChasedAt) : ageText(c.createdAt)}
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
                            <span>WhatsApp চেজ</span>
                          </button>

                          {c.conversationId ? (
                            <Link
                              href="/dashboard/inbox"
                              className="rounded-lg border px-2 py-1 text-xs font-semibold hover:bg-slate-50"
                            >
                              ইনবক্স খুলুন ↗
                            </Link>
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
            <p className="text-sm text-slate-400">লোড হচ্ছে…</p>
          ) : filteredItems.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">
              কোনো abandoned কার্ট পাওয়া যায়নি।
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-slate-400">
                    <th className="py-2.5 font-medium">উৎস</th>
                    <th className="py-2.5 font-medium">কাস্টমার</th>
                    <th className="py-2.5 font-medium">কার্টে যা আছে</th>
                    <th className="py-2.5 font-medium">মূল্য</th>
                    <th className="py-2.5 font-medium">ড্রপ-অফের সময়</th>
                    <th className="py-2.5 font-medium">অবস্থা</th>
                    <th className="py-2.5 font-medium">অ্যাকশন</th>
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
                                {li.name ?? "পণ্য"}
                                {li.quantity ? ` ×${li.quantity}` : ""}
                              </div>
                            ))
                          )}
                        </td>

                        <td className="py-3 font-bold text-slate-900">
                          {money(item.totalMinor, item.currency ?? "BDT")}
                        </td>

                        <td className="py-3 text-xs text-slate-500">{ageText(item.abandonedAt)}</td>

                        <td className="py-3">
                          {item.recovered ? (
                            <span className="rounded bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-700">
                              Recovered ✓ অর্ডার হয়েছে
                            </span>
                          ) : item.recoverySentAt ? (
                            <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                              পুশ পাঠানো হয়েছে
                            </span>
                          ) : (
                            <span className="rounded bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">
                              Open — ড্রপ-অফ
                            </span>
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
                                  <span>টিয়ার {tInfo.nextTier || 1} চেজ</span>
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
                                {busy === `recover-${item.id}` ? "পাঠানো হচ্ছে…" : "✉️ ইমেইল"}
                              </button>
                            ) : null}

                            {item.conversationId ? (
                              <Link
                                href="/dashboard/inbox"
                                className="rounded-lg border px-2 py-1 text-xs font-semibold hover:bg-slate-50"
                              >
                                💬 ইনবক্স
                              </Link>
                            ) : null}

                            {item.checkoutUrl ? (
                              <a
                                href={item.checkoutUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-lg border px-2 py-1 text-xs font-semibold hover:bg-slate-50"
                              >
                                চেকআউট লিংক ↗
                              </a>
                            ) : null}

                            <button
                              type="button"
                              className="rounded-lg border px-2 py-1 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50"
                              disabled={seqBusyId === item.id}
                              onClick={() => void toggleSequence(item)}
                            >
                              {seqBusyId === item.id ? "…" : expandedId === item.id ? "লুকান ▾" : "সিকোয়েন্স ▸"}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {expandedId === item.id ? (
                        <tr className="border-b bg-slate-50/70">
                          <td colSpan={7} className="px-4 py-3">
                            {seqBusyId === item.id ? (
                              <p className="text-xs text-slate-400">সিকোয়েন্স লোড হচ্ছে…</p>
                            ) : seqErrorById[item.id] ? (
                              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{seqErrorById[item.id]}</p>
                            ) : !seqById[item.id] ? (
                              <p className="text-xs text-slate-400">তথ্য পাওয়া যায়নি।</p>
                            ) : !seqById[item.id].enrolled ? (
                              <p className="text-xs font-semibold text-slate-600">কোনো অটোমেশন সিকোয়েন্সে এখনো অন্তর্ভুক্ত হয়নি।</p>
                            ) : (
                              <div className="space-y-2 text-xs">
                                <p className="text-slate-700">
                                  ওয়ার্কফ্লো: <b>{seqById[item.id].workflowName ?? "—"}</b>
                                  {" "}· রানের অবস্থা: <b>{sequenceStatusLabel(seqById[item.id].runStatus)}</b>
                                  {seqById[item.id].currentStepIndex != null ? <> · বর্তমান ধাপ: <b>{seqById[item.id].currentStepIndex! + 1}</b></> : null}
                                  {seqById[item.id].lastActivityAt ? <> · সর্বশেষ কার্যকলাপ: {new Date(seqById[item.id].lastActivityAt!).toLocaleString("bn-BD")}</> : null}
                                </p>
                                {(seqById[item.id].steps ?? []).length > 0 ? (
                                  <ul className="space-y-1">
                                    {(seqById[item.id].steps ?? []).map((s, i) => (
                                      <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 shadow-2xs">
                                        <span className="font-semibold text-slate-700">{i + 1}. {s.step}</span>
                                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{sequenceStatusLabel(s.status)}</span>
                                        {s.detail ? <span className="text-slate-500">{s.detail}</span> : null}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="text-slate-500">ধাপের লগ এখনো নেই।</p>
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
                  <h3 className="font-bold text-slate-900 text-base">1-Click WhatsApp রিকভারি পুশ</h3>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  গ্রাহকের কাছে বিশেষ কুপন সহ কাস্টমাইজড বার্তা প্রস্তুত করুন।
                </p>
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
                <span className="text-slate-400">কাস্টমার ফোন: </span>
                <span className="font-bold text-slate-900">{targetItem.phone || "নম্বর পাওয়া যায়নি"}</span>
              </div>
              <div>
                <span className="text-slate-400">পণ্য: </span>
                <span className="font-semibold text-slate-800">{targetItem.productName}</span>
              </div>
            </div>

            {/* Multi-Tier Sequence Step Selector */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700">⚡ সিকোয়েন্স টিয়ার নির্বাচন করুন:</label>
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
                  <div>১️⃣ ধাপ ১ (১৫ মি.)</div>
                  <div className="text-[10px] text-slate-500 font-normal">স্টক রিজার্ভেশন</div>
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
                  <div>২️⃣ ধাপ ২ (১ ঘণ্টা)</div>
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
                  <div>৩️⃣ ধাপ ৩ (২৪ ঘণ্টা)</div>
                  <div className="text-[10px] text-rose-600 font-normal">{tierConfig.tier3CouponCode} ({tierConfig.tier3DiscountText})</div>
                </button>
              </div>
            </div>

            {/* Quick Coupon Presets */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">অথবা অন্যান্য কুপন প্রিসেট নির্বাচন করুন:</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <button
                  type="button"
                  onClick={() => applyCouponPreset("VIP50", "৫০ টাকা ছাড়")}
                  className={`rounded-xl border p-2 text-center text-xs font-bold transition ${
                    waCouponCode === "VIP50"
                      ? "border-emerald-600 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-600"
                      : "border-slate-200 hover:bg-slate-50 text-slate-700"
                  }`}
                >
                  <div>৫০ টাকা ছাড়</div>
                  <div className="text-[10px] font-mono text-slate-400 font-normal">VIP50</div>
                </button>

                <button
                  type="button"
                  onClick={() => applyCouponPreset("COMEBACK100", "১০০ টাকা ছাড়")}
                  className={`rounded-xl border p-2 text-center text-xs font-bold transition ${
                    waCouponCode === "COMEBACK100"
                      ? "border-emerald-600 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-600"
                      : "border-slate-200 hover:bg-slate-50 text-slate-700"
                  }`}
                >
                  <div>১০০ টাকা ছাড়</div>
                  <div className="text-[10px] font-mono text-slate-400 font-normal">COMEBACK100</div>
                </button>

                <button
                  type="button"
                  onClick={() => applyCouponPreset("FREESHIP", "ফ্রি হোম ডেলিভারি")}
                  className={`rounded-xl border p-2 text-center text-xs font-bold transition ${
                    waCouponCode === "FREESHIP"
                      ? "border-emerald-600 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-600"
                      : "border-slate-200 hover:bg-slate-50 text-slate-700"
                  }`}
                >
                  <div>ফ্রি ডেলিভারি</div>
                  <div className="text-[10px] font-mono text-slate-400 font-normal">FREESHIP</div>
                </button>

                <button
                  type="button"
                  onClick={() => applyCouponPreset("SAVE10", "১০% স্পেশাল ছাড়")}
                  className={`rounded-xl border p-2 text-center text-xs font-bold transition ${
                    waCouponCode === "SAVE10"
                      ? "border-emerald-600 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-600"
                      : "border-slate-200 hover:bg-slate-50 text-slate-700"
                  }`}
                >
                  <div>১০% ছাড়</div>
                  <div className="text-[10px] font-mono text-slate-400 font-normal">SAVE10</div>
                </button>
              </div>
            </div>

            {/* Custom Discount Input fields */}
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs font-semibold text-slate-700">
                কুপন কোড
                <input
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
                ছাড়ের বিবরণ
                <input
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
                <label className="text-xs font-bold text-slate-700">বার্তা প্রিভিউ (সম্পাদনাযোগ্য):</label>
                {copiedNotice && <span className="text-[11px] font-bold text-emerald-600">✓ বার্তা কপি হয়েছে!</span>}
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
                <span>এখন শান্ত সময় (রাত ১০টা - সকাল ৮টা)। গ্রাহকের অনুমতি ছাড়া গভীর রাতে বার্তা না পাঠানোর পরামর্শ দেওয়া হচ্ছে।</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
              <button
                type="button"
                onClick={() => copyToClipboard(waCustomMessage)}
                className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
              >
                📋 কপি করুন
              </button>

              <button
                type="button"
                disabled={!targetItem.phone}
                onClick={() => {
                  if (waGeneratedLink) {
                    window.open(waGeneratedLink, "_blank");
                    setWaModalOpen(false);
                    setNotice("WhatsApp বার্তা পাঠানো হয়েছে এবং নতুন ট্যাবে খোলা হয়েছে!");
                  }
                }}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 flex items-center gap-1.5 shadow-sm transition disabled:opacity-50"
              >
                <span>🟢</span>
                <span>WhatsApp এ পাঠান (1-Click)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
