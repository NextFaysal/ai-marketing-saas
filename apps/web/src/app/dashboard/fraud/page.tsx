"use client";
import React, { useState, useEffect, useMemo } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import Link from "next/link";

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
  const [activeTab, setActiveTab] = useState<"settings" | "rules" | "blocklist" | "attempts">("settings");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Data states
  const [settings, setSettings] = useState<FraudSettings | null>(null);
  const [rules, setRules] = useState<FraudRule[]>([]);
  const [blockedPhones, setBlockedPhones] = useState<BlockedPhone[]>([]);
  const [attempts, setAttempts] = useState<FraudAttempt[]>([]);

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

  const loadAll = async () => {
    const orgId = getOrganizationId();
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [sRes, rRes, bRes, aRes] = await Promise.all([
        apiFetch<FraudSettings>(`/organizations/${orgId}/orders/fraud-settings`).catch(() => null),
        apiFetch<FraudRule[]>(`/organizations/${orgId}/orders/fraud-rules`).catch(() => []),
        apiFetch<BlockedPhone[]>(`/organizations/${orgId}/orders/blocked-phones`).catch(() => []),
        apiFetch<FraudAttempt[]>(`/organizations/${orgId}/orders/fraud-attempts?limit=100`).catch(() => []),
      ]);

      if (sRes) {
        setSettings(sRes);
        setHighValueTaka(String(Math.round(Number(sRes.highValueMinor || "500000") / 100)));
      }
      setRules(rRes ?? []);
      setBlockedPhones(bRes ?? []);
      setAttempts(aRes ?? []);
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
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab("settings")}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-xs sm:text-sm font-bold transition ${
            activeTab === "settings"
              ? "border-indigo-600 text-indigo-600 bg-indigo-50/20"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <span>🛡️ ফ্রড শিল্ড পলিসি ও সেটিংস</span>
        </button>

        <button
          onClick={() => setActiveTab("rules")}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-xs sm:text-sm font-bold transition ${
            activeTab === "rules"
              ? "border-indigo-600 text-indigo-600 bg-indigo-50/20"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <span>⚡ কাস্টম ফ্রড রুলস ({rules.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("blocklist")}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-xs sm:text-sm font-bold transition ${
            activeTab === "blocklist"
              ? "border-indigo-600 text-indigo-600 bg-indigo-50/20"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <span>🚫 ব্লকলিস্ট ম্যানেজার ({blockedPhones.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("attempts")}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-xs sm:text-sm font-bold transition ${
            activeTab === "attempts"
              ? "border-indigo-600 text-indigo-600 bg-indigo-50/20"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <span>🚨 প্রতিরোধকৃত ফ্রড লগ ({attempts.length})</span>
        </button>
      </div>

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
    </div>
  );
}
