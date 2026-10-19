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
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";

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

const ACTION_LABEL_KEYS: Record<string, { key: string; badgeCls: string }> = {
  hold: { key: "misc.frActionHold", badgeCls: "bg-amber-100 text-amber-800 border-amber-300" },
  tag: { key: "misc.frActionTag", badgeCls: "bg-blue-100 text-blue-800 border-blue-300" },
  block_checkout: { key: "misc.frActionBlock", badgeCls: "bg-red-100 text-red-800 border-red-300" },
};

export default function FraudShieldPage() {
  const { t, locale } = useLocale();
  const formatBDT = (minorStr?: string | number | null) => {
    if (minorStr == null) return fmtMoney(locale, 0);
    return fmtMoney(locale, Number(minorStr) / 100);
  };
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
      setError(e instanceof Error ? e.message : t("misc.frLoadError"));
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
      setNotice(t("misc.frSettingsSaved"));
      setTimeout(() => setNotice(""), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("misc.frSettingsError"));
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
      setNotice(t("misc.frBlockedAdded"));
      loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("misc.frBlockedAddError"));
    } finally {
      setAddingPhone(false);
    }
  };

  const removeBlocked = async (id: string) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    if (!confirm(t("misc.frUnblockConfirm"))) return;
    try {
      await apiFetch(`/organizations/${orgId}/orders/blocked-phones/${id}`, { method: "DELETE" });
      setNotice(t("misc.frUnblocked"));
      loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("misc.frDeleteError"));
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
      setNotice(t("misc.frRuleCreated"));
      loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("misc.frRuleCreateError"));
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
      setError(e instanceof Error ? e.message : t("misc.frRuleUpdateError"));
    }
  };

  const deleteRule = async (id: string) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    if (!confirm(t("misc.frRuleDeleteConfirm"))) return;
    try {
      await apiFetch(`/organizations/${orgId}/orders/fraud-rules/${id}`, { method: "DELETE" });
      setNotice(t("misc.frRuleDeleted"));
      loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("misc.frRuleDeleteError"));
    }
  };

  const openAdvanceModal = useCallback((order: CodOrder) => {
    setSelectedOrder(order);
    const estCharge = estimateDistrictDeliveryCharge(order.address || order.deliveryDistrict);
    setAdvanceAmount(estCharge);
    const totalTaka = Math.round(Number(order.totalMinor || 0) / 100);
    const due = Math.max(0, totalTaka - estCharge);
    const phone = order.customer?.phone || order.recipientPhone || "";
    const items = (order.items || []).map((i) => i.name || t("misc.frProductFallback")).slice(0, 2).join(", ");
    const ordNum = order.orderNumber || order.id.slice(0, 8);

    const msg = buildAdvanceCodMessage({
      customerName: order.customer?.name || t("misc.frCustomerFallback"),
      orderNumber: ordNum,
      itemSummary: items,
      advanceAmount: estCharge,
      dueAmount: due,
      paymentMethod,
      paymentNumber: merchantNumber,
      isMerchantAccount: isMerchantAcc,
      locale,
    });
    setAdvanceCustomMsg(msg);
    setAdvanceWaLink(buildAdvanceWhatsAppLink(phone, msg));
    setAdvanceCopied(false);
    setShowAdvanceModal(true);
  }, [merchantNumber, isMerchantAcc, paymentMethod, locale, t]);

  const updateAdvanceAmount = (amt: number) => {
    setAdvanceAmount(amt);
    if (!selectedOrder) return;
    const totalTaka = Math.round(Number(selectedOrder.totalMinor || 0) / 100);
    const due = Math.max(0, totalTaka - amt);
    const phone = selectedOrder.customer?.phone || selectedOrder.recipientPhone || "";
    const items = (selectedOrder.items || []).map((i) => i.name || t("misc.frProductFallback")).slice(0, 2).join(", ");
    const ordNum = selectedOrder.orderNumber || selectedOrder.id.slice(0, 8);

    const msg = buildAdvanceCodMessage({
      customerName: selectedOrder.customer?.name || t("misc.frCustomerFallback"),
      orderNumber: ordNum,
      itemSummary: items,
      advanceAmount: amt,
      dueAmount: due,
      paymentMethod,
      paymentNumber: merchantNumber,
      isMerchantAccount: isMerchantAcc,
      locale,
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
    const items = (selectedOrder.items || []).map((i) => i.name || t("misc.frProductFallback")).slice(0, 2).join(", ");
    const ordNum = selectedOrder.orderNumber || selectedOrder.id.slice(0, 8);

    const msg = buildAdvanceCodMessage({
      customerName: selectedOrder.customer?.name || t("misc.frCustomerFallback"),
      orderNumber: ordNum,
      itemSummary: items,
      advanceAmount,
      dueAmount: due,
      paymentMethod: method,
      paymentNumber: num,
      isMerchantAccount: isMerchant,
      locale,
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
          note: t("misc.zzFrAdvanceNote"),
        }),
      });
      setShowRecordModal(false);
      setNotice(t("misc.frAdvanceRecorded", { num: recordOrder.orderNumber || recordOrder.id.slice(0, 8), amount: fmtNumber(locale, Number(recordAmountTaka)) }));
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("misc.frAdvanceRecordError"));
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
        body: JSON.stringify({ reason: t("misc.zzFrHoldReason") }),
      });
      setNotice(t("misc.frHeld"));
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("misc.frHoldError"));
    }
  };

  const releaseOrder = async (orderId: string) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      await apiFetch(`/organizations/${orgId}/orders/${orderId}/release`, { method: "POST" });
      setNotice(t("misc.frReleased"));
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("misc.frReleaseError"));
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
        locale,
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
            {t("misc.frBadge")}
          </span>
          <h1 className="mt-1 text-2xl font-black text-slate-900">
            {t("misc.frTitle")}
          </h1>
          <p className="text-xs text-slate-500">
            {t("misc.frIntro")}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/orders"
            className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            {t("misc.frOrdersLink")}
          </Link>
          <button
            onClick={loadAll}
            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-slate-800"
          >
            {t("misc.frRefresh")}
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
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("misc.frKpiBlocked")}</p>
          <p className="mt-1 text-2xl font-black text-red-600">{t("misc.frCountSuffix", { count: fmtNumber(locale, attempts.length) })}</p>
          <p className="mt-1 text-[11px] text-slate-500">{t("misc.frKpiBlockedSub")}</p>
        </div>

        <div className="card border-l-4 border-l-emerald-600 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("misc.frKpiSaved")}</p>
          <p className="mt-1 text-2xl font-black text-emerald-700">{fmtMoney(locale, estimatedSavings)}</p>
          <p className="mt-1 text-[11px] text-emerald-600 font-medium">{t("misc.frKpiSavedSub")}</p>
        </div>

        <div className="card border-l-4 border-l-slate-800 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("misc.frKpiBlocklist")}</p>
          <p className="mt-1 text-2xl font-black text-slate-900">{t("misc.frCountSuffix", { count: fmtNumber(locale, blockedPhones.length) })}</p>
          <p className="mt-1 text-[11px] text-slate-500">{t("misc.frKpiBlocklistSub")}</p>
        </div>

        <div className="card border-l-4 border-l-indigo-600 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("misc.frKpiRules")}</p>
          <p className="mt-1 text-2xl font-black text-indigo-700">
            {t("misc.frKpiRulesActive", { count: fmtNumber(locale, rules.filter((r) => r.enabled).length) })}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">{t("misc.frKpiRulesSub", { count: fmtNumber(locale, rules.length) })}</p>
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
          <span>{t("misc.frTabRto")}</span>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
            {fmtNumber(locale, codOrders.length)}
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
          <span>{t("misc.frTabSettings")}</span>
        </button>

        <button
          onClick={() => setActiveTab("rules")}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-xs sm:text-sm font-bold transition whitespace-nowrap ${
            activeTab === "rules"
              ? "border-indigo-600 text-indigo-600 bg-indigo-50/20"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <span>{t("misc.frTabRules", { count: fmtNumber(locale, rules.length) })}</span>
        </button>

        <button
          onClick={() => setActiveTab("blocklist")}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-xs sm:text-sm font-bold transition whitespace-nowrap ${
            activeTab === "blocklist"
              ? "border-indigo-600 text-indigo-600 bg-indigo-50/20"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <span>{t("misc.frTabBlocklist", { count: fmtNumber(locale, blockedPhones.length) })}</span>
        </button>

        <button
          onClick={() => setActiveTab("attempts")}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-xs sm:text-sm font-bold transition whitespace-nowrap ${
            activeTab === "attempts"
              ? "border-indigo-600 text-indigo-600 bg-indigo-50/20"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <span>{t("misc.frTabAttempts", { count: fmtNumber(locale, attempts.length) })}</span>
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
                  <h2 className="text-base font-bold text-slate-900">{t("misc.frRtoTitle")}</h2>
                </div>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed max-w-3xl">
                  {t("misc.frRtoIntro")}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const num = prompt(t("misc.frPaymentNumberPrompt"), merchantNumber);
                    if (num && num.trim()) {
                      setMerchantNumber(num.trim());
                      if (typeof window !== "undefined") {
                        localStorage.setItem("merchant_advance_bkash_number", num.trim());
                      }
                      setNotice(t("misc.frPaymentNumberSaved"));
                    }
                  }}
                  className="rounded-xl border border-emerald-300 bg-white px-3.5 py-2 text-xs font-bold text-emerald-800 shadow-xs hover:bg-emerald-50 transition"
                >
                  {t("misc.frPaymentNumber", { num: merchantNumber })}
                </button>
              </div>
            </div>
          </div>

          {/* RTO Metric KPI Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card border-l-4 border-l-emerald-600 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("misc.frScreened")}</p>
              <p className="mt-1 text-2xl font-black text-slate-900">{t("misc.frCountSuffix", { count: fmtNumber(locale, rtoOrders.length) })}</p>
              <p className="mt-1 text-[11px] text-slate-500">{t("misc.frScreenedSub")}</p>
            </div>

            <div className="card border-l-4 border-l-red-500 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-rose-500">{t("misc.frHighRisk")}</p>
              <p className="mt-1 text-2xl font-black text-rose-600">{t("misc.frCountSuffix", { count: fmtNumber(locale, highRiskRtoCount) })}</p>
              <p className="mt-1 text-[11px] text-rose-700 font-medium">{t("misc.frHighRiskSub")}</p>
            </div>

            <div className="card border-l-4 border-l-amber-500 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-600">{t("misc.frLossProtected")}</p>
              <p className="mt-1 text-2xl font-black text-amber-700">{fmtMoney(locale, rtoSavedTaka)}</p>
              <p className="mt-1 text-[11px] text-amber-800 font-medium">{t("misc.frLossProtectedSub")}</p>
            </div>

            <div className="card border-l-4 border-l-indigo-600 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">{t("misc.frAdvanceCollected")}</p>
              <p className="mt-1 text-2xl font-black text-indigo-700">{fmtMoney(locale, advanceCollectedTaka)}</p>
              <p className="mt-1 text-[11px] text-indigo-800 font-medium">{t("misc.frAdvanceCollectedSub")}</p>
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
                {t("misc.frFilterAll", { count: fmtNumber(locale, rtoOrders.length) })}
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
                {t("misc.frFilterHigh", { count: fmtNumber(locale, rtoOrders.filter((o) => o.rtoEval.band === "high").length) })}
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
                {t("misc.frFilterMedium", { count: fmtNumber(locale, rtoOrders.filter((o) => o.rtoEval.band === "medium").length) })}
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
                {t("misc.frFilterLow", { count: fmtNumber(locale, rtoOrders.filter((o) => o.rtoEval.band === "low").length) })}
              </button>
            </div>

            <div className="w-full sm:w-64">
              <input
                type="text"
                                placeholder={t("misc.frSearchPlaceholder")}
                value={rtoSearch}
                onChange={(e) => setRtoSearch(e.target.value)}
                className="input w-full text-xs py-1.5"
              />
            </div>
          </div>

          {/* RTO Orders Table */}
          <div className="card p-5">
            {loading ? (
              <p className="text-sm text-slate-400 py-6 text-center">{t("misc.frLoading")}</p>
            ) : filteredRtoOrders.length === 0 ? (
              <p className="text-sm text-slate-500 py-6 text-center">{t("misc.frNoCodOrders")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-slate-400">
                      <th className="py-2.5 font-medium">{t("misc.frThOrder")}</th>
                      <th className="py-2.5 font-medium">{t("misc.frThCustomer")}</th>
                      <th className="py-2.5 font-medium">{t("misc.frThArea")}</th>
                      <th className="py-2.5 font-medium">{t("misc.frThRisk")}</th>
                      <th className="py-2.5 font-medium">{t("misc.frThPrice")}</th>
                      <th className="py-2.5 font-medium">{t("misc.frThAction")}</th>
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
                              {ord.status === "held" ? t("misc.frHeldBadge") : ord.status}
                            </span>
                          </td>

                          <td className="py-3 text-xs">
                            <div className="font-bold text-slate-900">{ord.customer?.name || t("misc.frCustomer")}</div>
                            <div className="mt-0.5 text-slate-600 flex items-center gap-1">
                              <span>📱</span>
                              <span className="font-mono">{ord.customer?.phone || ord.recipientPhone || "—"}</span>
                            </div>
                          </td>

                          <td className="py-3 text-xs">
                            <div className="text-slate-700 max-w-xs truncate">{ord.address || t("misc.frNoAddress")}</div>
                            <div className="mt-1 flex items-center gap-1.5">
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                                {estCharge === 100 ? t("misc.frZoneMetro") : estCharge === 200 ? t("misc.frZoneRemote") : t("misc.frZoneOutside")}
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
                                  {t("misc.frAdvancePaid", { amount: fmtNumber(locale, ord.advancePaid) })}
                                </span>
                              ) : (
                                <span className="rounded bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 text-[11px] font-semibold">
                                  {t("misc.frAdvanceDue", { amount: fmtNumber(locale, estCharge) })}
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
                                <span>{t("misc.frClaimAdvance")}</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => openRecordModal(ord)}
                                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
                              >
                                {t("misc.frRecord")}
                              </button>

                              {ord.status === "held" ? (
                                <button
                                  type="button"
                                  onClick={() => releaseOrder(ord.id)}
                                  className="rounded-lg bg-blue-50 border border-blue-300 text-blue-800 px-2 py-1 text-xs font-semibold hover:bg-blue-100 transition"
                                >
                                  {t("misc.frRelease")}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => holdOrder(ord.id)}
                                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 transition"
                                >
                                  {t("misc.frHold")}
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
            <h2 className="text-base font-bold text-slate-900">{t("misc.frSettingsTitle")}</h2>
            <p className="text-xs text-slate-500">
              {t("misc.frSettingsIntro")}
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
                  <span className="font-bold text-sm text-slate-900">{t("misc.frMasterToggle")}</span>
                  <p className="text-xs text-slate-500">{t("misc.frMasterToggleSub")}</p>
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
                  <span className="font-bold text-sm text-slate-900">{t("misc.frAutoHold")}</span>
                  <p className="text-xs text-slate-500">{t("misc.frAutoHoldSub")}</p>
                </div>
              </label>

              {settings.autoHoldEnabled && (
                <div className="pt-2 pl-7">
                  <label className="text-xs font-semibold text-slate-700">{t("misc.frHoldLevel")}</label>
                  <select
                    value={settings.autoHoldBand}
                    onChange={(e) => setSettings({ ...settings, autoHoldBand: e.target.value as any })}
                    className="input ml-2 py-1 text-xs"
                  >
                    <option value="high">{t("misc.frHoldHighOnly")}</option>
                    <option value="medium">{t("misc.frHoldMediumHigh")}</option>
                  </select>
                </div>
              )}
            </div>

            {/* High Value Alert */}
            <div className="rounded-xl border p-4 space-y-2">
              <label className="block text-xs font-bold text-slate-800">
                {t("misc.frHighValueLabel")}
              </label>
              <input
                type="number"
                value={highValueTaka}
                onChange={(e) => setHighValueTaka(e.target.value)}
                className="input w-48 text-sm font-bold"
              />
              <p className="text-xs text-slate-500">
                {t("misc.frHighValueSub")}
              </p>
            </div>

            {/* Burst Prevention */}
            <div className="rounded-xl border p-4 space-y-2">
              <label className="block text-xs font-bold text-slate-800">
                {t("misc.frBurstLabel")}
              </label>
              <div className="flex items-center gap-2 text-xs">
                <span>{t("misc.frBurstFrom")}</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={settings.burstCount}
                  onChange={(e) => setSettings({ ...settings, burstCount: Number(e.target.value) })}
                  className="input w-16 py-1 text-xs font-bold text-center"
                />
                <span>{t("misc.frBurstWithin")}</span>
                <input
                  type="number"
                  min={1}
                  max={72}
                  value={settings.burstWindowHours}
                  onChange={(e) => setSettings({ ...settings, burstWindowHours: Number(e.target.value) })}
                  className="input w-16 py-1 text-xs font-bold text-center"
                />
                <span>{t("misc.frBurstSuffix")}</span>
              </div>
            </div>

            {/* Open Orders Policy */}
            <div className="rounded-xl border p-4 space-y-2">
              <label className="block text-xs font-bold text-slate-800">
                {t("misc.frOpenPolicyLabel")}
              </label>
              <select
                value={settings.openOrderPolicy}
                onChange={(e) => setSettings({ ...settings, openOrderPolicy: e.target.value as any })}
                className="input w-full text-xs"
              >
                <option value="off">{t("misc.frOpenOff")}</option>
                <option value="warn">{t("misc.frOpenWarn")}</option>
                <option value="block">{t("misc.frOpenBlock")}</option>
              </select>
              <p className="text-xs text-slate-500">
                {t("misc.frOpenPolicySub")}
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
                  <span className="font-bold text-sm text-slate-900">{t("misc.frCaptcha")}</span>
                  <p className="text-xs text-slate-500">{t("misc.frCaptchaSub")}</p>
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
              {savingSettings ? t("misc.frSaving") : t("misc.frSaveSettings")}
            </button>
          </div>
        </div>
      )}

      {/* TAB 2: SMART RULES */}
      {activeTab === "rules" && (
        <div className="card space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">{t("misc.frRulesTitle")}</h2>
              <p className="text-xs text-slate-500">
                {t("misc.frRulesIntro")}
              </p>
            </div>
            <button
              onClick={() => setShowAddRuleModal(true)}
              className="btn-primary py-2 px-4 text-xs font-bold"
            >
              {t("misc.frAddRule")}
            </button>
          </div>

          {rules.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-slate-400">
              {t("misc.frNoRules")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-slate-50 font-bold text-slate-600 uppercase">
                  <tr>
                    <th className="py-2.5 px-3">{t("misc.frThRuleName")}</th>
                    <th className="py-2.5 px-3">{t("misc.frThConditions")}</th>
                    <th className="py-2.5 px-3">{t("misc.frThRuleAction")}</th>
                    <th className="py-2.5 px-3 text-center">{t("misc.frThStatus")}</th>
                    <th className="py-2.5 px-3 text-right">{t("misc.frThDelete")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rules.map((rule) => {
                    const actInfo = ACTION_LABEL_KEYS[rule.action] || ACTION_LABEL_KEYS.hold;
                    const act = { label: t(actInfo.key), badgeCls: actInfo.badgeCls };
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
                                {t("misc.frCondMin", { amount: formatBDT(c.minTotalMinor) })}
                              </span>
                            )}
                            {c.isCod && (
                              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800 font-semibold">
                                {t("misc.frCondCodOnly")}
                              </span>
                            )}
                            {c.phoneOpenOrdersGte && (
                              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-800">
                                {t("misc.frCondOpenOrders", { count: fmtNumber(locale, c.phoneOpenOrdersGte) })}
                              </span>
                            )}
                            {c.minRiskScore && (
                              <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-800">
                                {t("misc.frCondRiskScore", { count: fmtNumber(locale, c.minRiskScore) })}
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
                            {rule.enabled ? t("misc.frEnabled") : t("misc.frDisabled")}
                          </button>
                        </td>

                        <td className="py-3 px-3 text-right">
                          <button
                            onClick={() => deleteRule(rule.id)}
                            className="text-red-600 hover:underline font-semibold"
                          >
                            {t("misc.frDelete")}
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
              <h2 className="text-base font-bold text-slate-900">{t("misc.frBlocklistTitle")}</h2>
              <p className="text-xs text-slate-500">
                {t("misc.frBlocklistIntro")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                                placeholder={t("misc.frBlockSearchPlaceholder")}
                value={blockSearch}
                onChange={(e) => setBlockSearch(e.target.value)}
                className="input py-1.5 text-xs w-48"
              />
              <button
                onClick={() => setShowAddBlockModal(true)}
                className="rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-red-700"
              >
                {t("misc.frBlockNumber")}
              </button>
            </div>
          </div>

          {filteredBlocked.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-slate-400">
              {t("misc.frNoBlocked")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-slate-50 font-bold text-slate-600 uppercase">
                  <tr>
                    <th className="py-2.5 px-3">{t("misc.frThPhone")}</th>
                    <th className="py-2.5 px-3">{t("misc.frThReason")}</th>
                    <th className="py-2.5 px-3">{t("misc.frThDate")}</th>
                    <th className="py-2.5 px-3 text-right">{t("misc.frThAction")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredBlocked.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50/70 transition">
                      <td className="py-3 px-3 font-mono font-bold text-slate-900">
                        {b.phone}
                      </td>
                      <td className="py-3 px-3 text-slate-600">
                        {b.reason || t("misc.frNoReason")}
                      </td>
                      <td className="py-3 px-3 text-slate-400">
                        {fmtDate(locale, new Date(b.createdAt))}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          onClick={() => removeBlocked(b.id)}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-50 font-semibold"
                        >
                          {t("misc.frUnblock")}
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
            <h2 className="text-base font-bold text-slate-900">{t("misc.frAttemptsTitle")}</h2>
            <p className="text-xs text-slate-500">
              {t("misc.frAttemptsIntro")}
            </p>
          </div>

          {attempts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-slate-400">
              {t("misc.frNoAttempts")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-slate-50 font-bold text-slate-600 uppercase">
                  <tr>
                    <th className="py-2.5 px-3">{t("misc.frThTime")}</th>
                    <th className="py-2.5 px-3">{t("misc.frThPhone")}</th>
                    <th className="py-2.5 px-3">{t("misc.frThDistrict")}</th>
                    <th className="py-2.5 px-3">{t("misc.frThOrderValue")}</th>
                    <th className="py-2.5 px-3">{t("misc.frThBlockReason")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {attempts.map((att) => (
                    <tr key={att.id} className="hover:bg-slate-50/70 transition">
                      <td className="py-3 px-3 text-slate-500 whitespace-nowrap">
                        {fmtDateTime(locale, new Date(att.createdAt))}
                      </td>
                      <td className="py-3 px-3 font-mono font-bold text-slate-900">
                        {att.phone || t("misc.frNoPhone")}
                      </td>
                      <td className="py-3 px-3 text-slate-700">
                        {att.district || t("misc.frUnknown")}
                      </td>
                      <td className="py-3 px-3 font-bold text-slate-800">
                        {att.totalMinor ? formatBDT(att.totalMinor) : "—"}
                      </td>
                      <td className="py-3 px-3">
                        <span className="inline-flex rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[11px] font-bold text-red-700">
                          {att.ruleName ? t("misc.frRulePrefix", { name: att.ruleName }) : att.reason}
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
              <h3 className="text-base font-bold text-slate-900">{t("misc.frBlockModalTitle")}</h3>
              <button
                onClick={() => setShowAddBlockModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t("misc.frPhoneLabel")}</label>
              <input
                type="text"
                                placeholder={t("misc.frPhonePlaceholder")}
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                className="input w-full text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t("misc.frReasonLabel")}</label>
              <textarea
                rows={3}
                placeholder={t("misc.frReasonPlaceholder")}
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
                {t("misc.frCancel")}
              </button>
              <button
                onClick={addBlocked}
                disabled={addingPhone || !newPhone.trim()}
                className="rounded-xl bg-red-600 px-5 py-2 text-xs font-bold text-white shadow hover:bg-red-700"
              >
                {addingPhone ? t("misc.frAdding") : t("misc.frAddToBlocklist")}
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
              <h3 className="text-base font-bold text-slate-900">{t("misc.frRuleModalTitle")}</h3>
              <button
                onClick={() => setShowAddRuleModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{t("misc.frRuleNameLabel")}</label>
              <input
                type="text"
                placeholder={t("misc.frRuleNamePlaceholder")}
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                className="input w-full text-xs"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{t("misc.frActionLabel")}</label>
                <select
                  value={ruleAction}
                  onChange={(e) => setRuleAction(e.target.value as any)}
                  className="input w-full text-xs"
                >
                  <option value="hold">{t("misc.frActionHold")}</option>
                  <option value="tag">{t("misc.frActionTag")}</option>
                  <option value="block_checkout">{t("misc.frActionBlock")}</option>
                </select>
              </div>

              {ruleAction === "tag" && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">{t("misc.frTagNameLabel")}</label>
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
              <p className="text-xs font-bold text-slate-800">{t("misc.frConditionsTitle")}</p>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {t("misc.frMinTotalLabel")}
                  </label>
                  <input
                    type="number"
                    placeholder={t("misc.frExample", { value: "5000" })}
                    value={ruleMinTotalTaka}
                    onChange={(e) => setRuleMinTotalTaka(e.target.value)}
                    className="input w-full text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {t("misc.frOpenOrdersLabel")}
                  </label>
                  <input
                    type="number"
                    placeholder={t("misc.frExample", { value: "2" })}
                    value={rulePhoneOpenOrders}
                    onChange={(e) => setRulePhoneOpenOrders(e.target.value)}
                    className="input w-full text-xs"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {t("misc.frMinScoreLabel")}
                  </label>
                  <input
                    type="number"
                    placeholder={t("misc.frExample", { value: "70" })}
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
                    {t("misc.frCodOnlyLabel")}
                  </label>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t pt-3">
              <button
                onClick={() => setShowAddRuleModal(false)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                {t("misc.frCancel")}
              </button>
              <button
                onClick={addRule}
                disabled={addingRule || !ruleName.trim()}
                className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow hover:bg-indigo-700"
              >
                {addingRule ? t("misc.frCreating") : t("misc.frCreateRule")}
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
                  <h3 className="font-bold text-slate-900 text-base">{t("misc.frAdvanceModalTitle")}</h3>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {t("misc.frAdvanceModalSub")}
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
                <span className="text-slate-400">{t("misc.frOrderNo")}</span>
                <span className="font-bold text-slate-900">#{selectedOrder.orderNumber || selectedOrder.id.slice(0, 8)}</span>
                <span className="mx-2 text-slate-300">|</span>
                <span className="text-slate-400">{t("misc.frCustomerColon")}</span>
                <span className="font-bold text-slate-900">{selectedOrder.customer?.name || t("misc.frCustomer")}</span>
              </div>
              <div className="font-bold text-slate-900">
                {t("misc.frTotalPrice", { amount: formatBDT(selectedOrder.totalMinor) })}
              </div>
            </div>

            {/* Advance Amount Presets */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">{t("misc.frAdvanceAmountLabel")}</label>
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
                  <div>{t("misc.frAmt100")}</div>
                  <div className="text-[10px] text-slate-400 font-normal">{t("misc.frZoneDhakaMetro")}</div>
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
                  <div>{t("misc.frAmt150")}</div>
                  <div className="text-[10px] text-slate-400 font-normal">{t("misc.frZoneOutsideDhaka")}</div>
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
                  <div>{t("misc.frAmt200")}</div>
                  <div className="text-[10px] text-slate-400 font-normal">{t("misc.frZoneRemoteUpazila")}</div>
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
                  <div>{t("misc.frAmt80")}</div>
                  <div className="text-[10px] text-slate-400 font-normal">{t("misc.frZoneCity")}</div>
                </button>
              </div>
            </div>

            {/* Payment Method & Number */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{t("misc.frMethodLabel")}</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => updatePaymentMethod("bkash", isMerchantAcc, merchantNumber)}
                    className={`flex-1 rounded-xl border py-1.5 text-xs font-bold transition ${
                      paymentMethod === "bkash" ? "bg-rose-50 border-rose-500 text-rose-800" : "bg-white text-slate-700 border-slate-200"
                    }`}
                  >
                    {t("misc.frBkash")}
                  </button>
                  <button
                    type="button"
                    onClick={() => updatePaymentMethod("nagad", isMerchantAcc, merchantNumber)}
                    className={`flex-1 rounded-xl border py-1.5 text-xs font-bold transition ${
                      paymentMethod === "nagad" ? "bg-amber-50 border-amber-500 text-amber-800" : "bg-white text-slate-700 border-slate-200"
                    }`}
                  >
                    {t("misc.frNagad")}
                  </button>
                  <button
                    type="button"
                    onClick={() => updatePaymentMethod("rocket", isMerchantAcc, merchantNumber)}
                    className={`flex-1 rounded-xl border py-1.5 text-xs font-bold transition ${
                      paymentMethod === "rocket" ? "bg-purple-50 border-purple-500 text-purple-800" : "bg-white text-slate-700 border-slate-200"
                    }`}
                  >
                    {t("misc.frRocket")}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{t("misc.frMerchantNumberLabel")}</label>
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
                <label className="text-xs font-bold text-slate-700">{t("misc.frMessagePreview")}</label>
                {advanceCopied && <span className="text-[11px] font-bold text-emerald-600">{t("misc.frMessageCopied")}</span>}
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
                {t("misc.frCopy")}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (advanceWaLink) {
                    window.open(advanceWaLink, "_blank");
                    setShowAdvanceModal(false);
                    setNotice(t("misc.frWaSent"));
                  }
                }}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 flex items-center gap-1.5 shadow-sm transition"
              >
                <span>🟢</span>
                <span>{t("misc.frSendWa")}</span>
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
                <h3 className="font-bold text-slate-900 text-base">{t("misc.frRecordModalTitle")}</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {t("misc.frRecordModalSub", { num: recordOrder.orderNumber || recordOrder.id.slice(0, 8) })}
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
                <label className="block text-xs font-bold text-slate-700 mb-1">{t("misc.frPaidAmountLabel")}</label>
                <input
                  type="number"
                  className="input w-full text-sm font-bold text-slate-900"
                  value={recordAmountTaka}
                  onChange={(e) => setRecordAmountTaka(e.target.value)}
                  placeholder={t("misc.frExample", { value: "150" })}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{t("misc.frMethodLabel")}</label>
                <select
                  className="input w-full text-xs"
                  value={recordMethod}
                  onChange={(e) => setRecordMethod(e.target.value)}
                >
                  <option value="bkash">{t("misc.frMethodBkashOpt")}</option>
                  <option value="nagad">{t("misc.frMethodNagadOpt")}</option>
                  <option value="rocket">{t("misc.frMethodRocketOpt")}</option>
                  <option value="cash">{t("misc.frMethodCashOpt")}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{t("misc.frTrxLabel")}</label>
                <input
                  type="text"
                  className="input w-full text-xs font-mono uppercase"
                  placeholder={t("misc.frTrxPlaceholder")}
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
                {t("misc.frCancel")}
              </button>
              <button
                type="button"
                onClick={submitRecordAdvance}
                disabled={recordingAdvance || !recordAmountTaka.trim()}
                className="rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow hover:bg-indigo-700 disabled:opacity-50"
              >
                {recordingAdvance ? t("misc.frSavingShort") : t("misc.frConfirmPayment")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
