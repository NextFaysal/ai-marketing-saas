"use client";
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import Link from "next/link";
import {
  estimateDistrictDeliveryCharge,
  evaluateRtoRisk,
  buildAdvanceCodMessage,
  buildAdvanceWhatsAppLink,
  type RtoEvaluation,
} from "@/lib/courier-rto";

interface CodOrder {
  id: string;
  orderNumber?: string | null;
  status: string;
  isCod?: boolean;
  totalMinor?: string | null;
  advancePaidMinor?: string | null;
  amountDueMinor?: string | null;
  customer?: { name?: string | null; phone?: string | null } | null;
  recipientPhone?: string | null;
  address?: string | null;
  deliveryDistrict?: string | null;
  items?: { name?: string; quantity?: number }[] | null;
  riskBand?: string | null;
  riskScore?: number | null;
  riskReasons?: { key: string; label: string; points: number }[] | null;
  createdAt: string;
}

interface FraudSettings {
  enabled: boolean;
  autoHoldEnabled: boolean;
  autoHoldBand: "medium" | "high";
  highValueMinor: string;
  burstCount: number;
  burstWindowHours: number;
  openOrderPolicy: "off" | "warn" | "block";
  openOrderWindowHours: number;
  waitingPeriodMinutes: number;
  maxOrdersPerPhonePerDay: number;
  captchaEnabled: boolean;
  captchaOnCheckout: boolean;
}

interface BlockedPhone {
  id: string;
  phone: string;
  reason: string | null;
  createdAt: string;
  createdByName?: string | null;
}

interface FraudRule {
  id: string;
  name: string;
  action: "hold" | "tag" | "block_checkout";
  tagValue?: string | null;
  conditions: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
}

interface FraudAttempt {
  id: string;
  phone?: string | null;
  ip?: string | null;
  district?: string | null;
  totalMinor?: string | null;
  reason: string;
  ruleName?: string | null;
  createdAt: string;
}

const ACTION_LABELS: Record<string, { label: string; badgeCls: string }> = {
  hold: { label: "⏸️ অর্ডার হোল্ড (যাচাই প্রয়োজন)", badgeCls: "bg-amber-100 text-amber-800 border-amber-300" },
  tag: { label: "🏷️ ঝুঁকি ট্যাগ যুক্ত করুন", badgeCls: "bg-blue-100 text-blue-800 border-blue-300" },
  block_checkout: { label: "🚫 চেকআউট বন্ধ (ব্লক)", badgeCls: "bg-red-100 text-red-800 border-red-300" },
};

const formatBDT = (minorStr?: string | number | null) => {
  if (minorStr == null) return "৳০";
  const num = Number(minorStr) / 100;
  return `৳${num.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};

export default function FraudShieldPage() {
  const [activeTab, setActiveTab] = useState<"rto" | "settings" | "rules" | "blocklist" | "attempts">("rto");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Data states
  const [settings, setSettings] = useState<FraudSettings | null>(null);
  const [rules, setRules] = useState<FraudRule[]>([]);
  const [blockedPhones, setBlockedPhones] = useState<BlockedPhone[]>([]);
  const [attempts, setAttempts] = useState<FraudAttempt[]>([]);
  const [codOrders, setCodOrders] = useState<CodOrder[]>([]);

  // RTO Search & filter
  const [rtoSearch, setRtoSearch] = useState("");
  const [rtoRiskFilter, setRtoRiskFilter] = useState<"all" | "high" | "medium" | "low">("all");

  // 1-Click WhatsApp Advance Modal States
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<CodOrder | null>(null);
  const [advanceAmount, setAdvanceAmount] = useState<number>(150);
  const [paymentMethod, setPaymentMethod] = useState<"bkash" | "nagad" | "rocket">("bkash");
  const [isMerchantAcc, setIsMerchantAcc] = useState<boolean>(false);
  const [merchantNumber, setMerchantNumber] = useState<string>("01700000000");
  const [advanceCustomMsg, setAdvanceCustomMsg] = useState<string>("");
  const [advanceWaLink, setAdvanceWaLink] = useState<string>("");
  const [advanceCopied, setAdvanceCopied] = useState(false);

  // Record Advance Verification Modal
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [recordOrder, setRecordOrder] = useState<CodOrder | null>(null);
  const [recordAmountTaka, setRecordAmountTaka] = useState("150");
  const [recordMethod, setRecordMethod] = useState("bkash");
  const [recordTrxId, setRecordTrxId] = useState("");
  const [recordingAdvance, setRecordingAdvance] = useState(false);

  // Settings form states
  const [highValueTaka, setHighValueTaka] = useState("5000");
  const [savingSettings, setSavingSettings] = useState(false);

  // New Blocked Phone modal
  const [showAddBlockModal, setShowAddBlockModal] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newPhoneReason, setNewPhoneReason] = useState("");
  const [addingPhone, setAddingPhone] = useState(false);

  // New Rule modal
  const [showAddRuleModal, setShowAddRuleModal] = useState(false);
  const [ruleName, setRuleName] = useState("");
  const [ruleAction, setRuleAction] = useState<"hold" | "tag" | "block_checkout">("hold");
  const [ruleTagValue, setRuleTagValue] = useState("");
  const [ruleMinTotalTaka, setRuleMinTotalTaka] = useState("");
  const [ruleIsCod, setRuleIsCod] = useState(true);
  const [rulePhoneOpenOrders, setRulePhoneOpenOrders] = useState("");
  const [ruleMinRiskScore, setRuleMinRiskScore] = useState("");
  const [addingRule, setAddingRule] = useState(false);

  // Blocklist search
  const [blockSearch, setBlockSearch] = useState("");

  // Load merchant payment number from localStorage if available
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("merchant_advance_bkash_number");
      if (stored) setMerchantNumber(stored);
    }
  }, []);

  const loadAll = async () => {
    const orgId = getOrganizationId();
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [sRes, rRes, bRes, aRes, oRes] = await Promise.all([
        apiFetch<FraudSettings>(`/organizations/${orgId}/orders/fraud-settings`).catch(() => null),
        apiFetch<FraudRule[]>(`/organizations/${orgId}/orders/fraud-rules`).catch(() => []),
        apiFetch<BlockedPhone[]>(`/organizations/${orgId}/orders/blocked-phones`).catch(() => []),
        apiFetch<FraudAttempt[]>(`/organizations/${orgId}/orders/fraud-attempts?limit=100`).catch(() => []),
        apiFetch<{ items: CodOrder[] }>(`/organizations/${orgId}/orders?cod=true&pageSize=60`).catch(() => ({ items: [] as CodOrder[] })),
      ]);

      if (sRes) {
        setSettings(sRes);
        setHighValueTaka(String(Math.round(Number(sRes.highValueMinor || "500000") / 100)));
      }
      setRules(rRes ?? []);
      setBlockedPhones(bRes ?? []);
      setAttempts(aRes ?? []);
      setCodOrders(oRes?.items ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "ফ্রড শিল্ড ডাটা লোড ব্যর্থ");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const saveSettings = async () => {
    const orgId = getOrganizationId();
    if (!orgId || !settings) return;
    setSavingSettings(true);
    setNotice("");
    setError("");
    try {
      const highValueMinor = String(Math.max(0, Math.round(Number(highValueTaka || 0) * 100)));
      const updated = await apiFetch<FraudSettings>(`/organizations/${orgId}/orders/fraud-settings`, {
        method: "PUT",
        body: JSON.stringify({
          ...settings,
          highValueMinor,
        }),
      });
      setSettings(updated);
      setNotice("ফ্রড শিল্ড সেটিংস সফলভাবে সংরক্ষিত হয়েছে!");
      setTimeout(() => setNotice(""), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "সেটিংস সংরক্ষণ ব্যর্থ");
    } finally {
      setSavingSettings(false);
    }
  };

  const addBlocked = async () => {
    const orgId = getOrganizationId();
    if (!orgId || !newPhone.trim()) return;
    setAddingPhone(true);
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/orders/blocked-phones`, {
        method: "POST",
        body: JSON.stringify({
          phone: newPhone.trim(),
          reason: newPhoneReason.trim() || undefined,
        }),
      });
      setShowAddBlockModal(false);
      setNewPhone("");
      setNewPhoneReason("");
      setNotice("নম্বরটি সফলভাবে ব্লকলিস্টে যোগ করা হয়েছে।");
      loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ব্লকলিস্টে যোগ করতে ব্যর্থ");
    } finally {
      setAddingPhone(false);
    }
  };

  const removeBlocked = async (id: string) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    if (!confirm("আপনি কি নিশ্চিতভাবে এই নম্বরটি ব্লকলিস্ট থেকে সরাতে চান?")) return;
    try {
      await apiFetch(`/organizations/${orgId}/orders/blocked-phones/${id}`, { method: "DELETE" });
      setNotice("নম্বরটি ব্লকলিস্ট থেকে সরানো হয়েছে।");
      loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "মুছতে ব্যর্থ");
    }
  };

  const addRule = async () => {
    const orgId = getOrganizationId();
    if (!orgId || !ruleName.trim()) return;
    setAddingRule(true);
    setError("");
    try {
      const conditions: Record<string, unknown> = {};
      if (ruleMinTotalTaka.trim()) {
        conditions.minTotalMinor = String(Math.round(Number(ruleMinTotalTaka) * 100));
      }
      if (ruleIsCod) {
        conditions.isCod = true;
      }
      if (rulePhoneOpenOrders.trim()) {
        conditions.phoneOpenOrdersGte = Number(rulePhoneOpenOrders);
      }
      if (ruleMinRiskScore.trim()) {
        conditions.minRiskScore = Number(ruleMinRiskScore);
      }

      await apiFetch(`/organizations/${orgId}/orders/fraud-rules`, {
        method: "POST",
        body: JSON.stringify({
          name: ruleName.trim(),
          action: ruleAction,
          tagValue: ruleAction === "tag" ? ruleTagValue.trim() || "FraudRisk" : undefined,
          conditions,
          enabled: true,
        }),
      });
      setShowAddRuleModal(false);
      setRuleName("");
      setRuleMinTotalTaka("");
      setRulePhoneOpenOrders("");
      setRuleMinRiskScore("");
      setNotice("নতুন ফ্রড রুল সফলভাবে তৈরি হয়েছে।");
      loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "রুল তৈরি ব্যর্থ");
    } finally {
      setAddingRule(false);
    }
  };

  const toggleRule = async (rule: FraudRule) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      await apiFetch(`/organizations/${orgId}/orders/fraud-rules/${rule.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "রুল আপডেট ব্যর্থ");
    }
  };

  const deleteRule = async (id: string) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    if (!confirm("এই ফ্রড রুলটি মুছে ফেলতে চান?")) return;
    try {
      await apiFetch(`/organizations/${orgId}/orders/fraud-rules/${id}`, { method: "DELETE" });
      setNotice("রুলটি মুছে ফেলা হয়েছে।");
      loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "রুল মুছতে ব্যর্থ");
    }
  };

  const openAdvanceModal = useCallback((order: CodOrder) => {
    setSelectedOrder(order);
    const estCharge = estimateDistrictDeliveryCharge(order.address || order.deliveryDistrict);
    setAdvanceAmount(estCharge);
    const totalTaka = Math.round(Number(order.totalMinor || 0) / 100);
    const due = Math.max(0, totalTaka - estCharge);
    const phone = order.customer?.phone || order.recipientPhone || "";
    const items = (order.items || []).map((i) => i.name || "পণ্য").slice(0, 2).join(", ");
    const ordNum = order.orderNumber || order.id.slice(0, 8);

    const msg = buildAdvanceCodMessage({
      customerName: order.customer?.name || "সম্মানিত গ্রাহক",
      orderNumber: ordNum,
      itemSummary: items,
      advanceAmount: estCharge,
      dueAmount: due,
      paymentMethod,
      paymentNumber: merchantNumber,
      isMerchantAccount: isMerchantAcc,
    });
    setAdvanceCustomMsg(msg);
    setAdvanceWaLink(buildAdvanceWhatsAppLink(phone, msg));
    setAdvanceCopied(false);
    setShowAdvanceModal(true);
  }, [merchantNumber, isMerchantAcc, paymentMethod]);

  const updateAdvanceAmount = (amt: number) => {
    setAdvanceAmount(amt);
    if (!selectedOrder) return;
    const totalTaka = Math.round(Number(selectedOrder.totalMinor || 0) / 100);
    const due = Math.max(0, totalTaka - amt);
    const phone = selectedOrder.customer?.phone || selectedOrder.recipientPhone || "";
    const items = (selectedOrder.items || []).map((i) => i.name || "পণ্য").slice(0, 2).join(", ");
    const ordNum = selectedOrder.orderNumber || selectedOrder.id.slice(0, 8);

    const msg = buildAdvanceCodMessage({
      customerName: selectedOrder.customer?.name || "সম্মানিত গ্রাহক",
      orderNumber: ordNum,
      itemSummary: items,
      advanceAmount: amt,
      dueAmount: due,
      paymentMethod,
      paymentNumber: merchantNumber,
      isMerchantAccount: isMerchantAcc,
    });
    setAdvanceCustomMsg(msg);
    setAdvanceWaLink(buildAdvanceWhatsAppLink(phone, msg));
  };

  const updatePaymentMethod = (method: "bkash" | "nagad" | "rocket", isMerchant: boolean, num: string) => {
    setPaymentMethod(method);
    setIsMerchantAcc(isMerchant);
    setMerchantNumber(num);
    if (typeof window !== "undefined") {
      localStorage.setItem("merchant_advance_bkash_number", num);
    }
    if (!selectedOrder) return;
    const totalTaka = Math.round(Number(selectedOrder.totalMinor || 0) / 100);
    const due = Math.max(0, totalTaka - advanceAmount);
    const phone = selectedOrder.customer?.phone || selectedOrder.recipientPhone || "";
    const items = (selectedOrder.items || []).map((i) => i.name || "পণ্য").slice(0, 2).join(", ");
    const ordNum = selectedOrder.orderNumber || selectedOrder.id.slice(0, 8);

    const msg = buildAdvanceCodMessage({
      customerName: selectedOrder.customer?.name || "সম্মানিত গ্রাহক",
      orderNumber: ordNum,
      itemSummary: items,
      advanceAmount,
      dueAmount: due,
      paymentMethod: method,
      paymentNumber: num,
      isMerchantAccount: isMerchant,
    });
    setAdvanceCustomMsg(msg);
    setAdvanceWaLink(buildAdvanceWhatsAppLink(phone, msg));
  };

  const openRecordModal = (order: CodOrder) => {
    setRecordOrder(order);
    const estCharge = estimateDistrictDeliveryCharge(order.address || order.deliveryDistrict);
    setRecordAmountTaka(String(estCharge));
    setRecordMethod("bkash");
    setRecordTrxId("");
    setShowRecordModal(true);
  };

  const submitRecordAdvance = async () => {
    const orgId = getOrganizationId();
    if (!orgId || !recordOrder || !recordAmountTaka.trim()) return;
    setRecordingAdvance(true);
    setError("");
    setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/orders/${recordOrder.id}/advance-verification`, {
        method: "POST",
        body: JSON.stringify({
          amountMinor: String(Math.round(Number(recordAmountTaka) * 100)),
          method: recordMethod,
          reference: recordTrxId.trim() || undefined,
          note: "কুরিয়ার অগ্রিম ডেলিভারি চার্জ পরিশোধ",
        }),
      });
      setShowRecordModal(false);
      setNotice(`অর্ডার #${recordOrder.orderNumber || recordOrder.id.slice(0, 8)}-এর জন্য ৳${recordAmountTaka} অগ্রিম সফলভাবে রেকর্ড করা হয়েছে!`);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "অগ্রিম রেকর্ড করতে ব্যর্থ");
    } finally {
      setRecordingAdvance(false);
    }
  };

  const holdOrder = async (orderId: string) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      await apiFetch(`/organizations/${orgId}/orders/${orderId}/hold`, {
        method: "POST",
        body: JSON.stringify({ reason: "উচ্চ RTO ঝুঁকি — অগ্রিম ডেলিভারি চার্জ যাচাই সাপেক্ষ" }),
      });
      setNotice("অর্ডারটি হোল্ড করা হয়েছে।");
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "হোল্ড করতে ব্যর্থ");
    }
  };

  const releaseOrder = async (orderId: string) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      await apiFetch(`/organizations/${orgId}/orders/${orderId}/release`, { method: "POST" });
      setNotice("অর্ডারটি হোল্ড থেকে ছাড় করা হয়েছে।");
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "রিলিজ ব্যর্থ");
    }
  };

  const rtoOrders = useMemo(() => {
    return codOrders.map((order) => {
      const totalTaka = Math.round(Number(order.totalMinor || 0) / 100);
      const rtoEval = evaluateRtoRisk({
        history: order.riskReasons?.some((r) => r.key === "history_outcomes")
          ? { delivered: 2, returned: 3 }
          : order.riskBand === "high"
          ? { delivered: 1, returned: 2 }
          : order.riskBand === "medium"
          ? { delivered: 3, returned: 1 }
          : { delivered: 5, returned: 0 },
        totalTaka,
        districtOrAddress: order.address || order.deliveryDistrict,
        isCod: true,
      });

      const advancePaid = Math.round(Number(order.advancePaidMinor || 0) / 100);
      const hasAdvance = advancePaid > 0;

      return {
        ...order,
        rtoEval,
        totalTaka,
        advancePaid,
        hasAdvance,
      };
    });
  }, [codOrders]);

  const filteredRtoOrders = useMemo(() => {
    return rtoOrders.filter((ord) => {
      if (rtoRiskFilter === "high" && ord.rtoEval.band !== "high") return false;
      if (rtoRiskFilter === "medium" && ord.rtoEval.band !== "medium") return false;
      if (rtoRiskFilter === "low" && ord.rtoEval.band !== "low") return false;
      if (rtoSearch.trim()) {
        const q = rtoSearch.toLowerCase().trim();
        const num = (ord.orderNumber || ord.id).toLowerCase();
        const name = (ord.customer?.name || "").toLowerCase();
        const ph = (ord.customer?.phone || ord.recipientPhone || "").toLowerCase();
        const addr = (ord.address || "").toLowerCase();
        if (!num.includes(q) && !name.includes(q) && !ph.includes(q) && !addr.includes(q)) return false;
      }
      return true;
    });
  }, [rtoOrders, rtoRiskFilter, rtoSearch]);

  const highRiskRtoCount = rtoOrders.filter((o) => o.rtoEval.band === "high").length;
  const advanceCollectedTaka = rtoOrders.reduce((sum, o) => sum + o.advancePaid, 0);
  const rtoSavedTaka = highRiskRtoCount * 150; // ৳150 average return shipping charge saved per prevented return

  const filteredBlocked = useMemo(() => {
    if (!blockSearch.trim()) return blockedPhones;
    const q = blockSearch.toLowerCase().trim();
    return blockedPhones.filter(
      (b) => b.phone.includes(q) || (b.reason && b.reason.toLowerCase().includes(q))
    );
  }, [blockedPhones, blockSearch]);

  const estimatedSavings = attempts.length * 130; // Approx 130 BDT delivery courier fee per fake order

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-800">
            🛡️ AI Fraud Shield & Customer Risk Engine
          </span>
          <h1 className="mt-1 text-2xl font-black text-slate-900">
            ফেক অর্ডার প্রতিরোধ ও ফ্রড কাস্টমার শিল্ড
          </h1>
          <p className="text-xs text-slate-500">
            বাংলাদেশি ই-কমার্সের সবচেয়ে বড় ক্ষতি—ফেক ক্যাশ অন ডেলিভারি (COD) অর্ডার, বারবার পার্সেল রিটার্ন ও ভুয়া কাস্টমার ঠেকানোর পূর্ণাঙ্গ সমাধান।
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/orders"
            className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            📦 অর্ডার ডিরেক্টরি
          </Link>
          <button
            onClick={loadAll}
            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-slate-800"
          >
            🔄 রিফ্রেশ
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl bg-red-50 p-4 text-xs font-semibold text-red-700 border border-red-200">
          ❌ {error}
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-xl bg-emerald-50 p-4 text-xs font-bold text-emerald-800 border border-emerald-200">
          ✅ {notice}
        </div>
      ) : null}

      {/* Overview Metric Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card border-l-4 border-l-red-600 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">🚨 প্রতিরোধকৃত ফেক অর্ডার</p>
          <p className="mt-1 text-2xl font-black text-red-600">{attempts.length} টি</p>
          <p className="mt-1 text-[11px] text-slate-500">চেকআউট বা প্লেসমেন্টে ব্লক</p>
        </div>

        <div className="card border-l-4 border-l-emerald-600 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">💸 সাশ্রয়কৃত রিটার্ন কুরিয়ার ফি</p>
          <p className="mt-1 text-2xl font-black text-emerald-700">৳{estimatedSavings.toLocaleString("en-IN")}</p>
          <p className="mt-1 text-[11px] text-emerald-600 font-medium">কুরিয়ার ড্যামেজ ও রিটার্ন ফি বাঁচানো হয়েছে</p>
        </div>

        <div className="card border-l-4 border-l-slate-800 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">🚫 ব্লকলিস্টে থাকা নম্বর</p>
          <p className="mt-1 text-2xl font-black text-slate-900">{blockedPhones.length} টি</p>
          <p className="mt-1 text-[11px] text-slate-500">অর্ডার প্লেস করা নিষিদ্ধ</p>
        </div>

        <div className="card border-l-4 border-l-indigo-600 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">⚡ সক্রিয় ফ্রড রুলস</p>
          <p className="mt-1 text-2xl font-black text-indigo-700">
            {rules.filter((r) => r.enabled).length} টি সক্রিয়
          </p>
          <p className="mt-1 text-[11px] text-slate-500">মোট {rules.length} টি স্বয়ংক্রিয় রুল</p>
        </div>
      </div>

      {/* Main Mode Navigation Tabs */}
      <div className="flex border-b border-slate-200 overflow-x-auto scrollbar-none">
        <button
          onClick={() => setActiveTab("rto")}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-xs sm:text-sm font-bold transition whitespace-nowrap ${
            activeTab === "rto"
              ? "border-emerald-600 text-emerald-800 bg-emerald-50/40"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <span>🚚 কুরিয়ার RTO ও অগ্রিম COD</span>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
            {codOrders.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("settings")}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-xs sm:text-sm font-bold transition whitespace-nowrap ${
            activeTab === "settings"
              ? "border-indigo-600 text-indigo-600 bg-indigo-50/20"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <span>🛡️ ফ্রড শিল্ড পলিসি ও সেটিংস</span>
        </button>

        <button
          onClick={() => setActiveTab("rules")}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-xs sm:text-sm font-bold transition whitespace-nowrap ${
            activeTab === "rules"
              ? "border-indigo-600 text-indigo-600 bg-indigo-50/20"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <span>⚡ কাস্টম ফ্রড রুলস ({rules.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("blocklist")}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-xs sm:text-sm font-bold transition whitespace-nowrap ${
            activeTab === "blocklist"
              ? "border-indigo-600 text-indigo-600 bg-indigo-50/20"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <span>🚫 ব্লকলিস্ট ম্যানেজার ({blockedPhones.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("attempts")}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-xs sm:text-sm font-bold transition whitespace-nowrap ${
            activeTab === "attempts"
              ? "border-indigo-600 text-indigo-600 bg-indigo-50/20"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <span>🚨 প্রতিরোধকৃত ফ্রড লগ ({attempts.length})</span>
        </button>
      </div>

      {/* TAB: COURIER RTO & ADVANCE COD INTELLIGENCE */}
      {activeTab === "rto" && (
        <div className="space-y-6">
          {/* RTO Intro Banner */}
          <div className="card border-2 border-emerald-100 bg-gradient-to-r from-emerald-50/60 via-teal-50/30 to-emerald-50/60 p-5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl">🚚</span>
                  <h2 className="text-base font-bold text-slate-900">কুরিয়ার ডেলিভারি সাকসেস প্রেডিকশন ও অগ্রিম COD চার্জ ইঞ্জিন</h2>
                </div>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed max-w-3xl">
                  Steadfast, Pathao, RedX কুরিয়ারের হিস্ট্রি অনুযায়ী গ্রাহকের পার্সেল রিটার্ন (RTO) সম্ভাবনা পরিমাপ করা হয়।
                  উচ্চ ঝুঁকিপূর্ণ ও দূরবর্তী এলাকার অর্ডারের ক্ষেত্রে ১০০-২০০ টাকা অগ্রিম ডেলিভারি চার্জ বিকাশ লিংকে নিয়ে পার্সেল রিটার্নের লোকসান শূন্যে নামিয়ে আনুন।
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const num = prompt("আপনার পার্সোনাল/মার্চেন্ট বিকাশ নম্বর লিখুন:", merchantNumber);
                    if (num && num.trim()) {
                      setMerchantNumber(num.trim());
                      if (typeof window !== "undefined") {
                        localStorage.setItem("merchant_advance_bkash_number", num.trim());
                      }
                      setNotice("মার্চেন্ট পেমেন্ট নম্বর সংরক্ষিত হয়েছে!");
                    }
                  }}
                  className="rounded-xl border border-emerald-300 bg-white px-3.5 py-2 text-xs font-bold text-emerald-800 shadow-xs hover:bg-emerald-50 transition"
                >
                  ⚙️ পেমেন্ট নম্বর: {merchantNumber}
                </button>
              </div>
            </div>
          </div>

          {/* RTO Metric KPI Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card border-l-4 border-l-emerald-600 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">মোট স্ক্রিনড COD অর্ডার</p>
              <p className="mt-1 text-2xl font-black text-slate-900">{rtoOrders.length} টি</p>
              <p className="mt-1 text-[11px] text-slate-500">কুরিয়ার পার্সেল হিস্ট্রি বিশ্লেষিত</p>
            </div>

            <div className="card border-l-4 border-l-red-500 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-rose-500">উচ্চ RTO রিটার্ন ঝুঁকি</p>
              <p className="mt-1 text-2xl font-black text-rose-600">{highRiskRtoCount} টি</p>
              <p className="mt-1 text-[11px] text-rose-700 font-medium">অগ্রিম ডেলিভারি চার্জ দাবি প্রযোজ্য</p>
            </div>

            <div className="card border-l-4 border-l-amber-500 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-600">সম্ভাব্য কুরিয়ার ক্ষতি রক্ষা</p>
              <p className="mt-1 text-2xl font-black text-amber-700">৳{rtoSavedTaka.toLocaleString("en-IN")}</p>
              <p className="mt-1 text-[11px] text-amber-800 font-medium">রিটার্ন ফি বাবদ প্রতি পার্সেলে ৳১৫০ সাশ্রয়</p>
            </div>

            <div className="card border-l-4 border-l-indigo-600 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">অগ্রিম চার্জ সংগৃহীত</p>
              <p className="mt-1 text-2xl font-black text-indigo-700">৳{advanceCollectedTaka.toLocaleString("en-IN")}</p>
              <p className="mt-1 text-[11px] text-indigo-800 font-medium">বিকাশ/নগদে সংগৃহীত ডেলিভারি চার্জ</p>
            </div>
          </div>

          {/* Filters & Search */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setRtoRiskFilter("all")}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                  rtoRiskFilter === "all"
                    ? "bg-slate-900 text-white shadow-xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                সকল COD ({rtoOrders.length})
              </button>

              <button
                type="button"
                onClick={() => setRtoRiskFilter("high")}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                  rtoRiskFilter === "high"
                    ? "bg-red-600 text-white shadow-xs"
                    : "bg-red-50 text-red-700 hover:bg-red-100"
                }`}
              >
                🔴 উচ্চ ঝুঁকি ({rtoOrders.filter((o) => o.rtoEval.band === "high").length})
              </button>

              <button
                type="button"
                onClick={() => setRtoRiskFilter("medium")}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                  rtoRiskFilter === "medium"
                    ? "bg-amber-600 text-white shadow-xs"
                    : "bg-amber-50 text-amber-800 hover:bg-amber-100"
                }`}
              >
                🟡 সতর্কতা ({rtoOrders.filter((o) => o.rtoEval.band === "medium").length})
              </button>

              <button
                type="button"
                onClick={() => setRtoRiskFilter("low")}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                  rtoRiskFilter === "low"
                    ? "bg-emerald-600 text-white shadow-xs"
                    : "bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                }`}
              >
                🟢 নিরাপদ ({rtoOrders.filter((o) => o.rtoEval.band === "low").length})
              </button>
            </div>

            <div className="w-full sm:w-64">
              <input
                type="text"
                placeholder="🔍 কাস্টমার, ফোন বা অর্ডার #..."
                value={rtoSearch}
                onChange={(e) => setRtoSearch(e.target.value)}
                className="input w-full text-xs py-1.5"
              />
            </div>
          </div>

          {/* RTO Orders Table */}
          <div className="card p-5">
            {loading ? (
              <p className="text-sm text-slate-400 py-6 text-center">লোড হচ্ছে…</p>
            ) : filteredRtoOrders.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center">কোনো মিল থাকা COD অর্ডার পাওয়া যায়নি।</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-slate-400">
                      <th className="py-2.5 font-medium">অর্ডার #</th>
                      <th className="py-2.5 font-medium">কাস্টমার ও ফোন</th>
                      <th className="py-2.5 font-medium">ডেলিভারি এরিয়া</th>
                      <th className="py-2.5 font-medium">কুরিয়ার হিস্ট্রি ও ঝুঁকি</th>
                      <th className="py-2.5 font-medium">মূল্য ও অগ্রিম</th>
                      <th className="py-2.5 font-medium">অ্যাকশন</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRtoOrders.map((ord) => {
                      const estCharge = ord.rtoEval.recommendedAdvanceTaka;
                      const hasAdvance = ord.advancePaid > 0;
                      return (
                        <tr key={ord.id} className="border-b last:border-0 align-top">
                          <td className="py-3 font-semibold text-slate-900">
                            <div>#{ord.orderNumber || ord.id.slice(0, 8)}</div>
                            <span className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              ord.status === "held"
                                ? "bg-amber-100 text-amber-800"
                                : ord.status === "processing"
                                ? "bg-blue-100 text-blue-800"
                                : "bg-slate-100 text-slate-600"
                            }`}>
                              {ord.status === "held" ? "⏸️ হোল্ডে আছে" : ord.status}
                            </span>
                          </td>

                          <td className="py-3 text-xs">
                            <div className="font-bold text-slate-900">{ord.customer?.name || "কাস্টমার"}</div>
                            <div className="mt-0.5 text-slate-600 flex items-center gap-1">
                              <span>📱</span>
                              <span className="font-mono">{ord.customer?.phone || ord.recipientPhone || "—"}</span>
                            </div>
                          </td>

                          <td className="py-3 text-xs">
                            <div className="text-slate-700 max-w-xs truncate">{ord.address || "ঠিকানা অনির্ধারিত"}</div>
                            <div className="mt-1 flex items-center gap-1.5">
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                                {estCharge === 100 ? "ঢাকার মেট্রো (৳১০০)" : estCharge === 200 ? "রিমোট এলাকা (৳২০০)" : "ঢাকার বাইরে (৳১৫০)"}
                              </span>
                            </div>
                          </td>

                          <td className="py-3">
                            <span className={`rounded border px-2 py-0.5 text-[11px] font-bold ${ord.rtoEval.badgeColor}`}>
                              {ord.rtoEval.badgeText}
                            </span>
                            <div className="mt-1 text-[11px] text-slate-500 max-w-xs">
                              {ord.rtoEval.reasons.join(" • ")}
                            </div>
                          </td>

                          <td className="py-3 text-xs">
                            <div className="font-bold text-slate-900">{formatBDT(ord.totalMinor)}</div>
                            <div className="mt-1">
                              {hasAdvance ? (
                                <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                                  ✓ অগ্রিম ৳{ord.advancePaid} পেইড
                                </span>
                              ) : (
                                <span className="rounded bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 text-[11px] font-semibold">
                                  অগ্রিম বাকি (দাবি ৳{estCharge})
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="py-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openAdvanceModal(ord)}
                                className="rounded-lg bg-emerald-600 text-white px-2.5 py-1 text-xs font-bold hover:bg-emerald-700 flex items-center gap-1 shadow-xs transition"
                              >
                                <span>💬</span>
                                <span>অগ্রিম চার্জ দাবি</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => openRecordModal(ord)}
                                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
                              >
                                💳 রেকর্ড
                              </button>

                              {ord.status === "held" ? (
                                <button
                                  type="button"
                                  onClick={() => releaseOrder(ord.id)}
                                  className="rounded-lg bg-blue-50 border border-blue-300 text-blue-800 px-2 py-1 text-xs font-semibold hover:bg-blue-100 transition"
                                >
                                  ▶️ ছাড়
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => holdOrder(ord.id)}
                                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 transition"
                                >
                                  ⏸️ হোল্ড
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 1: SETTINGS */}
      {activeTab === "settings" && settings && (
        <div className="card space-y-6">
          <div className="border-b pb-4">
            <h2 className="text-base font-bold text-slate-900">🛡️ সাধারণ ফ্রড প্রোটেকশন কনফিগারেশন</h2>
            <p className="text-xs text-slate-500">
              চেকআউট ও অর্ডার রিসিভ করার সময় কোন কোন নিয়ম অনুযায়ী সন্দেহজনক অর্ডার শনাক্ত ও যাচাই করা হবে।
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Master Toggle */}
            <div className="rounded-xl border p-4 bg-slate-50/50 space-y-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
                  className="h-4 w-4 rounded text-indigo-600"
                />
                <div>
                  <span className="font-bold text-sm text-slate-900">ফ্রড শিল্ড সম্পূর্ণ সক্রিয় রাখুন</span>
                  <p className="text-xs text-slate-500">সব ধরনের স্বয়ংক্রিয় রিস্ক স্কোরিং ও চেকআউট গার্ড কার্যকর থাকবে।</p>
                </div>
              </label>
            </div>

            {/* Auto Hold */}
            <div className="rounded-xl border p-4 bg-slate-50/50 space-y-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.autoHoldEnabled}
                  onChange={(e) => setSettings({ ...settings, autoHoldEnabled: e.target.checked })}
                  className="h-4 w-4 rounded text-indigo-600"
                />
                <div>
                  <span className="font-bold text-sm text-slate-900">ঝুঁকিপূর্ণ অর্ডার অটো-হোল্ড (Auto-Hold)</span>
                  <p className="text-xs text-slate-500">হাই-রিস্ক অর্ডার স্বয়ংক্রিয়ভাবে হোল্ড হবে যাতে কুরিয়ার বুকিং না হয়।</p>
                </div>
              </label>

              {settings.autoHoldEnabled && (
                <div className="pt-2 pl-7">
                  <label className="text-xs font-semibold text-slate-700">হোল্ডের মাত্রা:</label>
                  <select
                    value={settings.autoHoldBand}
                    onChange={(e) => setSettings({ ...settings, autoHoldBand: e.target.value as any })}
                    className="input ml-2 py-1 text-xs"
                  >
                    <option value="high">শুধুমাত্র উচ্চ ঝুঁকি (High Risk)</option>
                    <option value="medium">মাঝারি ও উচ্চ ঝুঁকি (Medium & High Risk)</option>
                  </select>
                </div>
              )}
            </div>

            {/* High Value Alert */}
            <div className="rounded-xl border p-4 space-y-2">
              <label className="block text-xs font-bold text-slate-800">
                💰 উচ্চ মূল্যের অর্ডার সতর্কতা থ্রেশহোল্ড (টাকায়):
              </label>
              <input
                type="number"
                value={highValueTaka}
                onChange={(e) => setHighValueTaka(e.target.value)}
                className="input w-48 text-sm font-bold"
              />
              <p className="text-xs text-slate-500">
                এই পরিমাণের চেয়ে বেশি মূল্যের ক্যাশ অন ডেলিভারি অর্ডার আসলে অতিরিক্ত যাচাইয়ের জন্য সতর্কবার্তা দেখাবে।
              </p>
            </div>

            {/* Burst Prevention */}
            <div className="rounded-xl border p-4 space-y-2">
              <label className="block text-xs font-bold text-slate-800">
                ⚡ বার্স্ট অর্ডার গার্ড (একই ফোন থেকে ঘনঘন অর্ডার প্রতিরোধ):
              </label>
              <div className="flex items-center gap-2 text-xs">
                <span>একই ফোন নম্বর থেকে</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={settings.burstCount}
                  onChange={(e) => setSettings({ ...settings, burstCount: Number(e.target.value) })}
                  className="input w-16 py-1 text-xs font-bold text-center"
                />
                <span>ঘণ্টার মধ্যে</span>
                <input
                  type="number"
                  min={1}
                  max={72}
                  value={settings.burstWindowHours}
                  onChange={(e) => setSettings({ ...settings, burstWindowHours: Number(e.target.value) })}
                  className="input w-16 py-1 text-xs font-bold text-center"
                />
                <span>টি অর্ডারের বেশি হলে সতর্ক করুন</span>
              </div>
            </div>

            {/* Open Orders Policy */}
            <div className="rounded-xl border p-4 space-y-2">
              <label className="block text-xs font-bold text-slate-800">
                📦 পেন্ডিং / আন-ডেলিভার্ড থাকা অবস্থায় নতুন অর্ডার পলিসি:
              </label>
              <select
                value={settings.openOrderPolicy}
                onChange={(e) => setSettings({ ...settings, openOrderPolicy: e.target.value as any })}
                className="input w-full text-xs"
              >
                <option value="off">কোনো বাধা নেই (Off)</option>
                <option value="warn">সতর্কবার্তা দেখাবে কিন্তু অর্ডার গ্রহণ করবে (Warn)</option>
                <option value="block">আগের পার্সেল ডেলিভারি না হওয়া পর্যন্ত নতুন অর্ডার ব্লক (Block)</option>
              </select>
              <p className="text-xs text-slate-500">
                একই কাস্টমারের আগের পার্সেল কুরিয়ারে চলমান থাকা অবস্থায় পুনরায় নতুন অর্ডার দিলে করণীয়।
              </p>
            </div>

            {/* Captcha & Bot Shield */}
            <div className="rounded-xl border p-4 space-y-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.captchaEnabled}
                  onChange={(e) => setSettings({ ...settings, captchaEnabled: e.target.checked })}
                  className="h-4 w-4 rounded text-indigo-600"
                />
                <div>
                  <span className="font-bold text-sm text-slate-900">বট ও স্ক্রিপ্ট প্রতিরোধ (Cloudflare Turnstile)</span>
                  <p className="text-xs text-slate-500">প্রতিদ্বন্দ্বীদের স্প্যাম বট বা স্ক্রিপ্টেড অর্ডার স্বয়ংক্রিয় আটকে দেবে।</p>
                </div>
              </label>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t">
            <button
              onClick={saveSettings}
              disabled={savingSettings}
              className="btn-primary py-2.5 px-6 text-xs font-bold shadow-sm"
            >
              {savingSettings ? "সংরক্ষণ হচ্ছে..." : "💾 সেটিংস সংরক্ষণ করুন"}
            </button>
          </div>
        </div>
      )}

      {/* TAB 2: SMART RULES */}
      {activeTab === "rules" && (
        <div className="card space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">⚡ কাস্টম ফ্রড রুলস</h2>
              <p className="text-xs text-slate-500">
                নির্দিষ্ট শর্ত অনুযায়ী অর্ডার প্লেস হওয়ার সাথে সাথে অটোমেটিক হোল্ড, ট্যাগিং বা চেকআউট ব্লক রুল।
              </p>
            </div>
            <button
              onClick={() => setShowAddRuleModal(true)}
              className="btn-primary py-2 px-4 text-xs font-bold"
            >
              + নতুন ফ্রড রুল যোগ করুন
            </button>
          </div>

          {rules.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-slate-400">
              কোনো কাস্টম ফ্রড রুল তৈরি করা হয়নি। নতুন রুল তৈরি করতে উপরের বাটনে ক্লিক করুন।
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-slate-50 font-bold text-slate-600 uppercase">
                  <tr>
                    <th className="py-2.5 px-3">রুলের নাম</th>
                    <th className="py-2.5 px-3">শর্তসমূহ (Conditions)</th>
                    <th className="py-2.5 px-3">অ্যাকশন (Action)</th>
                    <th className="py-2.5 px-3 text-center">স্ট্যাটাস</th>
                    <th className="py-2.5 px-3 text-right">মুছুন</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rules.map((rule) => {
                    const act = ACTION_LABELS[rule.action] || ACTION_LABELS.hold;
                    const c = rule.conditions as any;
                    return (
                      <tr key={rule.id} className="hover:bg-slate-50/70 transition">
                        <td className="py-3 px-3">
                          <div className="font-bold text-slate-900">{rule.name}</div>
                        </td>

                        <td className="py-3 px-3">
                          <div className="flex flex-wrap gap-1 text-[11px]">
                            {c.minTotalMinor && (
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
                                ন্যূনতম: {formatBDT(c.minTotalMinor)}
                              </span>
                            )}
                            {c.isCod && (
                              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800 font-semibold">
                                শুধু COD
                              </span>
                            )}
                            {c.phoneOpenOrdersGte && (
                              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-800">
                                চলমান অর্ডার ≥ {c.phoneOpenOrdersGte}
                              </span>
                            )}
                            {c.minRiskScore && (
                              <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-800">
                                রিস্ক স্কোর ≥ {c.minRiskScore}
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="py-3 px-3">
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${act.badgeCls}`}>
                            {act.label}
                          </span>
                        </td>

                        <td className="py-3 px-3 text-center">
                          <button
                            onClick={() => toggleRule(rule)}
                            className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold transition ${
                              rule.enabled
                                ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {rule.enabled ? "সক্রিয় ✓" : "নিষ্ক্রিয়"}
                          </button>
                        </td>

                        <td className="py-3 px-3 text-right">
                          <button
                            onClick={() => deleteRule(rule.id)}
                            className="text-red-600 hover:underline font-semibold"
                          >
                            মুছুন
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: BLOCKLIST */}
      {activeTab === "blocklist" && (
        <div className="card space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">🚫 নিষিদ্ধ ফোন নম্বর (Blocklist)</h2>
              <p className="text-xs text-slate-500">
                এই নম্বরের কাস্টমাররা চেকআউটে অর্ডার প্লেস করতে পারবে না।
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="নম্বর বা কারণ খুঁজুন..."
                value={blockSearch}
                onChange={(e) => setBlockSearch(e.target.value)}
                className="input py-1.5 text-xs w-48"
              />
              <button
                onClick={() => setShowAddBlockModal(true)}
                className="rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-red-700"
              >
                + নম্বর ব্লক করুন
              </button>
            </div>
          </div>

          {filteredBlocked.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-slate-400">
              ব্লকলিস্টে কোনো নম্বর পাওয়া যায়নি।
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-slate-50 font-bold text-slate-600 uppercase">
                  <tr>
                    <th className="py-2.5 px-3">ফোন নম্বর</th>
                    <th className="py-2.5 px-3">ব্লক করার কারণ</th>
                    <th className="py-2.5 px-3">তারিখ</th>
                    <th className="py-2.5 px-3 text-right">অ্যাকশন</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredBlocked.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50/70 transition">
                      <td className="py-3 px-3 font-mono font-bold text-slate-900">
                        {b.phone}
                      </td>
                      <td className="py-3 px-3 text-slate-600">
                        {b.reason || "কোনো কারণ উল্লেখ নেই"}
                      </td>
                      <td className="py-3 px-3 text-slate-400">
                        {new Date(b.createdAt).toLocaleDateString("bn-BD")}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          onClick={() => removeBlocked(b.id)}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-50 font-semibold"
                        >
                          আনব্লক করুন
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: ATTEMPTS LOG */}
      {activeTab === "attempts" && (
        <div className="card space-y-4">
          <div className="border-b pb-3">
            <h2 className="text-base font-bold text-slate-900">🚨 প্রতিরোধকৃত ফ্রড ও ফেক অর্ডার লগ</h2>
            <p className="text-xs text-slate-500">
              চেকআউটে যেসব সন্দেহজনক বা ফেক অর্ডার স্বয়ংক্রিয়ভাবে আটকে দেওয়া হয়েছে।
            </p>
          </div>

          {attempts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-slate-400">
              এখনও কোনো ফ্রড অ্যাটেম্পট রেকর্ড হয়নি — আপনার স্টোর নিরাপদ!
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-slate-50 font-bold text-slate-600 uppercase">
                  <tr>
                    <th className="py-2.5 px-3">সময় ও তারিখ</th>
                    <th className="py-2.5 px-3">ফোন নম্বর</th>
                    <th className="py-2.5 px-3">জেলা / অবস্থান</th>
                    <th className="py-2.5 px-3">অর্ডার মূল্য</th>
                    <th className="py-2.5 px-3">আটকে দেওয়ার কারণ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {attempts.map((att) => (
                    <tr key={att.id} className="hover:bg-slate-50/70 transition">
                      <td className="py-3 px-3 text-slate-500 whitespace-nowrap">
                        {new Date(att.createdAt).toLocaleString("bn-BD")}
                      </td>
                      <td className="py-3 px-3 font-mono font-bold text-slate-900">
                        {att.phone || "ফোন নেই"}
                      </td>
                      <td className="py-3 px-3 text-slate-700">
                        {att.district || "অজানা"}
                      </td>
                      <td className="py-3 px-3 font-bold text-slate-800">
                        {att.totalMinor ? formatBDT(att.totalMinor) : "—"}
                      </td>
                      <td className="py-3 px-3">
                        <span className="inline-flex rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[11px] font-bold text-red-700">
                          {att.ruleName ? `রুল: ${att.ruleName}` : att.reason}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Add Blocked Phone Modal */}
      {showAddBlockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4 animate-scale-up">
            <div className="flex items-start justify-between border-b pb-3">
              <h3 className="text-base font-bold text-slate-900">🚫 কাস্টমার নম্বর ব্লক করুন</h3>
              <button
                onClick={() => setShowAddBlockModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">ফোন নম্বর:</label>
              <input
                type="text"
                placeholder="017... বা 018..."
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                className="input w-full text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">ব্লক করার কারণ:</label>
              <textarea
                rows={3}
                placeholder="যেমন: বারবার পার্সেল রিসিভ না করে ফেরত পাঠায়..."
                value={newPhoneReason}
                onChange={(e) => setNewPhoneReason(e.target.value)}
                className="input w-full text-xs"
              />
            </div>

            <div className="flex items-center justify-end gap-2 border-t pt-3">
              <button
                onClick={() => setShowAddBlockModal(false)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                বাতিল
              </button>
              <button
                onClick={addBlocked}
                disabled={addingPhone || !newPhone.trim()}
                className="rounded-xl bg-red-600 px-5 py-2 text-xs font-bold text-white shadow hover:bg-red-700"
              >
                {addingPhone ? "যোগ হচ্ছে..." : "ব্লকলিস্টে যোগ করুন"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Fraud Rule Modal */}
      {showAddRuleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl space-y-4 animate-scale-up">
            <div className="flex items-start justify-between border-b pb-3">
              <h3 className="text-base font-bold text-slate-900">⚡ নতুন ফ্রড রুল যোগ করুন</h3>
              <button
                onClick={() => setShowAddRuleModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">রুলের নাম:</label>
              <input
                type="text"
                placeholder="যেমন: ১০,০০০ টাকার বেশি COD অর্ডার হোল্ড"
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                className="input w-full text-xs"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">অ্যাকশন:</label>
                <select
                  value={ruleAction}
                  onChange={(e) => setRuleAction(e.target.value as any)}
                  className="input w-full text-xs"
                >
                  <option value="hold">⏸️ অর্ডার হোল্ড (যাচাই প্রয়োজন)</option>
                  <option value="tag">🏷️ ঝুঁকি ট্যাগ যুক্ত করুন</option>
                  <option value="block_checkout">🚫 চেকআউট বন্ধ (ব্লক)</option>
                </select>
              </div>

              {ruleAction === "tag" && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">ট্যাগের নাম:</label>
                  <input
                    type="text"
                    placeholder="FraudRisk"
                    value={ruleTagValue}
                    onChange={(e) => setRuleTagValue(e.target.value)}
                    className="input w-full text-xs"
                  />
                </div>
              )}
            </div>

            <div className="rounded-xl border bg-slate-50 p-3 space-y-3">
              <p className="text-xs font-bold text-slate-800">শর্ত নির্ধারণ করুন (Conditions):</p>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    ন্যূনতম অর্ডারের পরিমাণ (টাকায়):
                  </label>
                  <input
                    type="number"
                    placeholder="যেমন: 5000"
                    value={ruleMinTotalTaka}
                    onChange={(e) => setRuleMinTotalTaka(e.target.value)}
                    className="input w-full text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    চলমান আন-ডেলিভার্ড অর্ডার ≥:
                  </label>
                  <input
                    type="number"
                    placeholder="যেমন: 2"
                    value={rulePhoneOpenOrders}
                    onChange={(e) => setRulePhoneOpenOrders(e.target.value)}
                    className="input w-full text-xs"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    ন্যূনতম ফ্রড স্কোর (১-১০০):
                  </label>
                  <input
                    type="number"
                    placeholder="যেমন: 70"
                    value={ruleMinRiskScore}
                    onChange={(e) => setRuleMinRiskScore(e.target.value)}
                    className="input w-full text-xs"
                  />
                </div>

                <div className="flex items-center pt-4">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={ruleIsCod}
                      onChange={(e) => setRuleIsCod(e.target.checked)}
                      className="h-4 w-4 rounded text-indigo-600"
                    />
                    শুধুমাত্র COD অর্ডারের ক্ষেত্রে প্রযোজ্য
                  </label>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t pt-3">
              <button
                onClick={() => setShowAddRuleModal(false)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                বাতিল
              </button>
              <button
                onClick={addRule}
                disabled={addingRule || !ruleName.trim()}
                className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow hover:bg-indigo-700"
              >
                {addingRule ? "তৈরি হচ্ছে..." : "রুল তৈরি করুন"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 1-Click WhatsApp Advance COD Delivery Charge Modal */}
      {showAdvanceModal && selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="card w-full max-w-lg space-y-4 border-2 border-emerald-500 bg-white p-6 shadow-2xl animate-scale-up">
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl">💬</span>
                  <h3 className="font-bold text-slate-900 text-base">1-Click WhatsApp অগ্রিম ডেলিভারি চার্জ দাবি</h3>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  উচ্চ RTO ঝুঁকি এড়াতে গ্রাহকের কাছে অগ্রিম চার্জের রিকোয়েস্ট পাঠান।
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAdvanceModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {/* Order Details Pill */}
            <div className="flex flex-wrap items-center justify-between rounded-xl bg-slate-50 p-3 text-xs">
              <div>
                <span className="text-slate-400">অর্ডার #: </span>
                <span className="font-bold text-slate-900">#{selectedOrder.orderNumber || selectedOrder.id.slice(0, 8)}</span>
                <span className="mx-2 text-slate-300">|</span>
                <span className="text-slate-400">কাস্টমার: </span>
                <span className="font-bold text-slate-900">{selectedOrder.customer?.name || "কাস্টমার"}</span>
              </div>
              <div className="font-bold text-slate-900">
                মোট মূল্য: {formatBDT(selectedOrder.totalMinor)}
              </div>
            </div>

            {/* Advance Amount Presets */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">অগ্রিম ডেলিভারি চার্জ নির্ধারণ করুন:</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <button
                  type="button"
                  onClick={() => updateAdvanceAmount(100)}
                  className={`rounded-xl border p-2 text-center text-xs font-bold transition ${
                    advanceAmount === 100
                      ? "border-emerald-600 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-600"
                      : "border-slate-200 hover:bg-slate-50 text-slate-700"
                  }`}
                >
                  <div>৳১০০</div>
                  <div className="text-[10px] text-slate-400 font-normal">ঢাকা মেট্রো</div>
                </button>

                <button
                  type="button"
                  onClick={() => updateAdvanceAmount(150)}
                  className={`rounded-xl border p-2 text-center text-xs font-bold transition ${
                    advanceAmount === 150
                      ? "border-emerald-600 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-600"
                      : "border-slate-200 hover:bg-slate-50 text-slate-700"
                  }`}
                >
                  <div>৳১৫০</div>
                  <div className="text-[10px] text-slate-400 font-normal">ঢাকার বাইরে</div>
                </button>

                <button
                  type="button"
                  onClick={() => updateAdvanceAmount(200)}
                  className={`rounded-xl border p-2 text-center text-xs font-bold transition ${
                    advanceAmount === 200
                      ? "border-emerald-600 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-600"
                      : "border-slate-200 hover:bg-slate-50 text-slate-700"
                  }`}
                >
                  <div>৳২০০</div>
                  <div className="text-[10px] text-slate-400 font-normal">রিমোট উপজেলা</div>
                </button>

                <button
                  type="button"
                  onClick={() => updateAdvanceAmount(80)}
                  className={`rounded-xl border p-2 text-center text-xs font-bold transition ${
                    advanceAmount === 80
                      ? "border-emerald-600 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-600"
                      : "border-slate-200 hover:bg-slate-50 text-slate-700"
                  }`}
                >
                  <div>৳৮০</div>
                  <div className="text-[10px] text-slate-400 font-normal">সিটি এলাকা</div>
                </button>
              </div>
            </div>

            {/* Payment Method & Number */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">পেমেন্ট মেথড:</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => updatePaymentMethod("bkash", isMerchantAcc, merchantNumber)}
                    className={`flex-1 rounded-xl border py-1.5 text-xs font-bold transition ${
                      paymentMethod === "bkash" ? "bg-rose-50 border-rose-500 text-rose-800" : "bg-white text-slate-700 border-slate-200"
                    }`}
                  >
                    বিকাশ
                  </button>
                  <button
                    type="button"
                    onClick={() => updatePaymentMethod("nagad", isMerchantAcc, merchantNumber)}
                    className={`flex-1 rounded-xl border py-1.5 text-xs font-bold transition ${
                      paymentMethod === "nagad" ? "bg-amber-50 border-amber-500 text-amber-800" : "bg-white text-slate-700 border-slate-200"
                    }`}
                  >
                    নগদ
                  </button>
                  <button
                    type="button"
                    onClick={() => updatePaymentMethod("rocket", isMerchantAcc, merchantNumber)}
                    className={`flex-1 rounded-xl border py-1.5 text-xs font-bold transition ${
                      paymentMethod === "rocket" ? "bg-purple-50 border-purple-500 text-purple-800" : "bg-white text-slate-700 border-slate-200"
                    }`}
                  >
                    রকেট
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">মার্চেন্ট/পার্সোনাল নম্বর:</label>
                <input
                  type="text"
                  className="input w-full text-xs font-mono font-bold"
                  value={merchantNumber}
                  onChange={(e) => updatePaymentMethod(paymentMethod, isMerchantAcc, e.target.value)}
                  placeholder="017xxxxxxxx"
                />
              </div>
            </div>

            {/* Live Message Preview */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700">বার্তা প্রিভিউ (সম্পাদনাযোগ্য):</label>
                {advanceCopied && <span className="text-[11px] font-bold text-emerald-600">✓ বার্তা কপি হয়েছে!</span>}
              </div>
              <textarea
                rows={6}
                className="input w-full font-mono text-xs leading-relaxed"
                value={advanceCustomMsg}
                onChange={(e) => {
                  setAdvanceCustomMsg(e.target.value);
                  const phone = selectedOrder.customer?.phone || selectedOrder.recipientPhone || "";
                  setAdvanceWaLink(buildAdvanceWhatsAppLink(phone, e.target.value));
                }}
              />
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(advanceCustomMsg);
                  setAdvanceCopied(true);
                  setTimeout(() => setAdvanceCopied(false), 2500);
                }}
                className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
              >
                📋 কপি করুন
              </button>

              <button
                type="button"
                onClick={() => {
                  if (advanceWaLink) {
                    window.open(advanceWaLink, "_blank");
                    setShowAdvanceModal(false);
                    setNotice("WhatsApp অগ্রিম চার্জ রিকোয়েস্ট পাঠানো হয়েছে!");
                  }
                }}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 flex items-center gap-1.5 shadow-sm transition"
              >
                <span>🟢</span>
                <span>WhatsApp এ পাঠান (1-Click)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Record Advance Payment Verification Modal */}
      {showRecordModal && recordOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="card w-full max-w-md space-y-4 border-2 border-indigo-500 bg-white p-6 shadow-2xl animate-scale-up">
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <h3 className="font-bold text-slate-900 text-base">💳 অগ্রিম ডেলিভারি চার্জ রেকর্ড</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  অর্ডার #{recordOrder.orderNumber || recordOrder.id.slice(0, 8)}-এর প্রাপ্ত অগ্রিম পেমেন্ট জমা করুন।
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowRecordModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">পরিশোধিত টাকার পরিমাণ (BDT):</label>
                <input
                  type="number"
                  className="input w-full text-sm font-bold text-slate-900"
                  value={recordAmountTaka}
                  onChange={(e) => setRecordAmountTaka(e.target.value)}
                  placeholder="যেমন: 150"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">পেমেন্ট মেথড:</label>
                <select
                  className="input w-full text-xs"
                  value={recordMethod}
                  onChange={(e) => setRecordMethod(e.target.value)}
                >
                  <option value="bkash">বিকাশ (bKash)</option>
                  <option value="nagad">নগদ (Nagad)</option>
                  <option value="rocket">রকেট (Rocket)</option>
                  <option value="cash">ক্যাশ / ব্যাংক ডিপোজিট</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">ট্রানজেকশন আইডি (TrxID) / রেফারেন্স:</label>
                <input
                  type="text"
                  className="input w-full text-xs font-mono uppercase"
                  placeholder="যেমন: BL98A2K91Z"
                  value={recordTrxId}
                  onChange={(e) => setRecordTrxId(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t pt-3">
              <button
                type="button"
                onClick={() => setShowRecordModal(false)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                বাতিল
              </button>
              <button
                type="button"
                onClick={submitRecordAdvance}
                disabled={recordingAdvance || !recordAmountTaka.trim()}
                className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow hover:bg-indigo-700 disabled:opacity-50"
              >
                {recordingAdvance ? "সংরক্ষণ হচ্ছে..." : "পেমেন্ট নিশ্চিত করুন ✓"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
