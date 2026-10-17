"use client";
import React, { useState } from "react";
import { ResponsiveTable } from "@repo/ui";
import type { CourierRule, CourierPerformance, ReviewRow, ChaseRow } from "./types";
import { PERF_PROVIDER_LABEL } from "./types";

interface CourierHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Connections
  courier: { connected: boolean } | null;
  courierForm: { apiKey: string; secretKey: string };
  onCourierFormChange: (form: { apiKey: string; secretKey: string }) => void;
  onConnectCourier: (e: React.FormEvent) => void;
  onDisconnectSteadfast: () => void;
  onSyncAllCourier: () => void;
  conns: { provider: string; connected: boolean; id?: string; trackingUrlTemplate?: string | null }[];
  pathaoForm: { clientId: string; clientSecret: string; username: string; password: string; sandbox: boolean };
  onPathaoFormChange: (form: any) => void;
  onConnectPathao: (e: React.FormEvent) => void;
  redxForm: { accessToken: string; baseUrl: string };
  onRedxFormChange: (form: any) => void;
  onConnectRedx: (e: React.FormEvent) => void;
  onDisconnectProvider: (provider: string) => void;
  courierBusy: string;
  courierNotice: string;

  // Rules
  courierRules: CourierRule[];
  ruleForm: any;
  onRuleFormChange: (form: any) => void;
  editingRule: CourierRule | null;
  onEditRule: (r: CourierRule) => void;
  onCancelEditRule: () => void;
  onSaveRule: (e: React.FormEvent) => void;
  onDeleteRule: (r: CourierRule) => void;
  ruleBusy: string;
  ruleNotice: string;
  ruleConditionsSummary: (r: CourierRule) => string;

  // Tracking Templates
  trackingTemplates: Record<string, string>;
  onTrackingTemplateChange: (provider: string, val: string) => void;
  onSaveTrackingTemplate: (provider: string) => void;

  // Performance
  perfDays: number;
  onPerfDaysChange: (days: number) => void;
  perf: CourierPerformance | null;

  // Reviews & Chases
  reviews: ReviewRow[];
  chases: ChaseRow[];
}

export function CourierHubModal({
  isOpen,
  onClose,
  courier,
  courierForm,
  onCourierFormChange,
  onConnectCourier,
  onDisconnectSteadfast,
  onSyncAllCourier,
  conns,
  pathaoForm,
  onPathaoFormChange,
  onConnectPathao,
  redxForm,
  onRedxFormChange,
  onConnectRedx,
  onDisconnectProvider,
  courierBusy,
  courierNotice,
  courierRules,
  ruleForm,
  onRuleFormChange,
  editingRule,
  onEditRule,
  onCancelEditRule,
  onSaveRule,
  onDeleteRule,
  ruleBusy,
  ruleNotice,
  ruleConditionsSummary,
  trackingTemplates,
  onTrackingTemplateChange,
  onSaveTrackingTemplate,
  perfDays,
  onPerfDaysChange,
  perf,
  reviews,
  chases,
}: CourierHubModalProps) {
  const [hubTab, setHubTab] = useState<"connections" | "rules" | "perf" | "chase">("connections");

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs animate-fade">
      <div className="w-full max-w-4xl max-h-[88vh] rounded-3xl bg-white shadow-2xl flex flex-col overflow-hidden animate-rise">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-6 py-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">🚚 কুরিয়ার হাব ও অটোমেশন কন্ট্রোল</h3>
            <p className="text-xs text-slate-500">
              Steadfast, Pathao ও RedX কানেকশন, অটো-সিলেক্ট রুলস ও পারফরম্যান্স মেট্রিক্স।
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-200 bg-white p-2 text-slate-400 shadow-sm hover:bg-slate-100 hover:text-slate-700"
            aria-label="বন্ধ করুন"
          >
            ✕
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-100 px-6 gap-2 bg-white text-xs font-semibold">
          <button
            type="button"
            onClick={() => setHubTab("connections")}
            className={`border-b-2 py-3 px-3 transition ${
              hubTab === "connections"
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            🔌 সংযোগ (APIs)
          </button>
          <button
            type="button"
            onClick={() => setHubTab("rules")}
            className={`border-b-2 py-3 px-3 transition ${
              hubTab === "rules"
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            ⚙️ অটো-সিলেক্ট রুলস ({courierRules.length})
          </button>
          <button
            type="button"
            onClick={() => setHubTab("perf")}
            className={`border-b-2 py-3 px-3 transition ${
              hubTab === "perf"
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            📊 ডেলিভারি পারফরম্যান্স
          </button>
          <button
            type="button"
            onClick={() => setHubTab("chase")}
            className={`border-b-2 py-3 px-3 transition ${
              hubTab === "chase"
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            🎯 থেমে যাওয়া সেশন (Chase) ({chases.length})
          </button>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {courierNotice && (
            <div className="rounded-xl bg-indigo-50 px-3.5 py-2.5 text-xs font-semibold text-indigo-700">
              {courierNotice}
            </div>
          )}

          {/* TAB 1: CONNECTIONS */}
          {hubTab === "connections" && (
            <div className="space-y-6">
              {/* Steadfast */}
              <div className="rounded-2xl border border-slate-200/80 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-bold text-slate-900 text-sm">Steadfast Courier</span>
                    <span className="ml-2 text-xs text-slate-500">এপিআই সংযোগ</span>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                      courier?.connected ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {courier?.connected ? "✓ যুক্ত আছে" : "যুক্ত নেই"}
                  </span>
                </div>

                {courier?.connected ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={courierBusy !== ""}
                      onClick={onSyncAllCourier}
                      className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {courierBusy === "syncall" ? "Sync হচ্ছে..." : "সব পার্সেলের স্ট্যাটাস Sync করুন"}
                    </button>
                    <button
                      type="button"
                      onClick={onDisconnectSteadfast}
                      className="rounded-xl px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      সংযোগ বিচ্ছিন্ন
                    </button>
                  </div>
                ) : (
                  <form onSubmit={onConnectCourier} className="grid gap-2.5 sm:grid-cols-2">
                    <input
                      className="rounded-xl border border-slate-200 px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500"
                      placeholder="Steadfast API Key"
                      value={courierForm.apiKey}
                      onChange={(e) => onCourierFormChange({ ...courierForm, apiKey: e.target.value })}
                      required
                    />
                    <input
                      className="rounded-xl border border-slate-200 px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500"
                      placeholder="Secret Key"
                      value={courierForm.secretKey}
                      onChange={(e) => onCourierFormChange({ ...courierForm, secretKey: e.target.value })}
                      required
                    />
                    <div className="sm:col-span-2 flex items-center justify-between">
                      <p className="text-[11px] text-slate-500">Key Steadfast Merchant Portal থেকে পাবেন।</p>
                      <button
                        type="submit"
                        disabled={courierBusy !== ""}
                        className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
                      >
                        {courierBusy === "connect" ? "যাচাই হচ্ছে..." : "যাচাই করে যুক্ত করুন"}
                      </button>
                    </div>
                  </form>
                )}
              </div>

              {/* Pathao & RedX */}
              <div className="grid gap-4 md:grid-cols-2">
                {/* Pathao */}
                <div className="rounded-2xl border border-slate-200/80 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 text-sm">Pathao Courier</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        conns.find((c) => c.provider === "pathao")?.connected
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {conns.find((c) => c.provider === "pathao")?.connected ? "যুক্ত আছে" : "যুক্ত নেই"}
                    </span>
                  </div>

                  {conns.find((c) => c.provider === "pathao")?.connected ? (
                    <button
                      type="button"
                      onClick={() => onDisconnectProvider("pathao")}
                      className="rounded-xl px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      সংযোগ বিচ্ছিন্ন
                    </button>
                  ) : (
                    <form onSubmit={onConnectPathao} className="space-y-2 text-xs">
                      <input
                        className="w-full rounded-xl border border-slate-200 p-2"
                        placeholder="Client ID"
                        value={pathaoForm.clientId}
                        onChange={(e) => onPathaoFormChange({ ...pathaoForm, clientId: e.target.value })}
                        required
                      />
                      <input
                        className="w-full rounded-xl border border-slate-200 p-2"
                        placeholder="Client Secret"
                        value={pathaoForm.clientSecret}
                        onChange={(e) => onPathaoFormChange({ ...pathaoForm, clientSecret: e.target.value })}
                        required
                      />
                      <input
                        className="w-full rounded-xl border border-slate-200 p-2"
                        placeholder="Merchant ইমেইল (Username)"
                        value={pathaoForm.username}
                        onChange={(e) => onPathaoFormChange({ ...pathaoForm, username: e.target.value })}
                        required
                      />
                      <input
                        type="password"
                        className="w-full rounded-xl border border-slate-200 p-2"
                        placeholder="Merchant পাসওয়ার্ড"
                        value={pathaoForm.password}
                        onChange={(e) => onPathaoFormChange({ ...pathaoForm, password: e.target.value })}
                        required
                      />
                      <label className="flex items-center gap-2 text-[11px] text-slate-500">
                        <input
                          type="checkbox"
                          checked={pathaoForm.sandbox}
                          onChange={(e) => onPathaoFormChange({ ...pathaoForm, sandbox: e.target.checked })}
                        />
                        Sandbox (টেস্ট) পরিবেশ
                      </label>
                      <button
                        type="submit"
                        disabled={courierBusy !== ""}
                        className="w-full rounded-xl bg-slate-900 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        {courierBusy === "pathao" ? "যাচাই হচ্ছে..." : "Pathao যুক্ত করুন"}
                      </button>
                    </form>
                  )}
                </div>

                {/* RedX */}
                <div className="rounded-2xl border border-slate-200/80 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 text-sm">RedX</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        conns.find((c) => c.provider === "redx")?.connected
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {conns.find((c) => c.provider === "redx")?.connected ? "যুক্ত আছে" : "যুক্ত নেই"}
                    </span>
                  </div>

                  {conns.find((c) => c.provider === "redx")?.connected ? (
                    <button
                      type="button"
                      onClick={() => onDisconnectProvider("redx")}
                      className="rounded-xl px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      সংযোগ বিচ্ছিন্ন
                    </button>
                  ) : (
                    <form onSubmit={onConnectRedx} className="space-y-2 text-xs">
                      <input
                        className="w-full rounded-xl border border-slate-200 p-2"
                        placeholder="API Access Token"
                        value={redxForm.accessToken}
                        onChange={(e) => onRedxFormChange({ ...redxForm, accessToken: e.target.value })}
                        required
                      />
                      <input
                        className="w-full rounded-xl border border-slate-200 p-2"
                        placeholder="Base URL (ঐচ্ছিক)"
                        value={redxForm.baseUrl}
                        onChange={(e) => onRedxFormChange({ ...redxForm, baseUrl: e.target.value })}
                      />
                      <button
                        type="submit"
                        disabled={courierBusy !== ""}
                        className="w-full rounded-xl bg-slate-900 py-2 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        {courierBusy === "redx" ? "যাচাই হচ্ছে..." : "RedX যুক্ত করুন"}
                      </button>
                    </form>
                  )}
                </div>
              </div>

              {/* Tracking URL Templates */}
              <div className="rounded-2xl border border-slate-200/80 p-5 space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  ট্র্যাকিং URL কাস্টমাইজেশন
                </span>
                <div className="space-y-2">
                  {conns
                    .filter((c) => c.connected)
                    .map((c) => (
                      <div key={c.provider} className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="w-24 font-bold text-slate-800">{c.provider}</span>
                        <input
                          className="flex-1 rounded-xl border border-slate-200 px-3 py-1.5"
                          placeholder="https://.../track/{trackingId}"
                          value={trackingTemplates[c.provider] ?? ""}
                          onChange={(e) => onTrackingTemplateChange(c.provider, e.target.value)}
                        />
                        <button
                          type="button"
                          disabled={ruleBusy !== ""}
                          onClick={() => onSaveTrackingTemplate(c.provider)}
                          className="rounded-xl bg-slate-900 px-3 py-1.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                        >
                          সংরক্ষণ
                        </button>
                      </div>
                    ))}
                  {conns.filter((c) => c.connected).length === 0 && (
                    <p className="text-xs text-slate-500">কোনো সক্রিয় কুরিয়ার সংযোগ নেই।</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: COURIER RULES */}
          {hubTab === "rules" && (
            <div className="space-y-6">
              {ruleNotice && (
                <div className="rounded-xl bg-indigo-50 px-3.5 py-2 text-xs font-semibold text-indigo-700">
                  {ruleNotice}
                </div>
              )}

              {/* Existing Rules List */}
              <div className="space-y-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  বিদ্যমান অটো-সিলেক্ট নিয়মাবলী
                </span>
                {courierRules.length === 0 ? (
                  <p className="text-xs text-slate-500">এখনো কোনো নিয়ম তৈরি করা হয়নি।</p>
                ) : (
                  <div className="space-y-2">
                    {[...courierRules]
                      .sort((a, b) => b.priority - a.priority)
                      .map((r) => (
                        <div
                          key={r.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/50 p-3.5 text-xs"
                        >
                          <div>
                            <div className="flex items-center gap-2 font-bold text-slate-900">
                              <span>{r.name}</span>
                              <span className="text-indigo-600">→ {r.provider}</span>
                              <span className="rounded bg-slate-200 px-1.5 py-0.2 text-[10px]">
                                Priority: {r.priority}
                              </span>
                              <span
                                className={`rounded px-1.5 py-0.2 text-[10px] font-bold ${
                                  r.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-500"
                                }`}
                              >
                                {r.active ? "সক্রিয়" : "নিষ্ক্রিয়"}
                              </span>
                            </div>
                            <div className="mt-1 text-slate-500">{ruleConditionsSummary(r)}</div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onEditRule(r)}
                              className="font-semibold text-indigo-600 hover:underline"
                            >
                              সম্পাদনা
                            </button>
                            <button
                              type="button"
                              disabled={ruleBusy !== ""}
                              onClick={() => onDeleteRule(r)}
                              className="font-semibold text-rose-600 hover:underline disabled:opacity-50"
                            >
                              মুছুন
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* Add / Edit Rule Form */}
              <form onSubmit={onSaveRule} className="rounded-2xl border border-slate-200/80 p-5 space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  {editingRule ? "নিয়ম সম্পাদনা করুন" : "+ নতুন অটো-সিলেক্ট নিয়ম যোগ করুন"}
                </span>

                <div className="grid gap-2 sm:grid-cols-3">
                  <input
                    className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                    placeholder="নিয়মের নাম *"
                    value={ruleForm.name}
                    onChange={(e) => onRuleFormChange({ ...ruleForm, name: e.target.value })}
                    required
                  />
                  <select
                    className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                    value={ruleForm.courierAccountId}
                    onChange={(e) => {
                      const c = conns.find((x) => (x.id ?? x.provider) === e.target.value);
                      onRuleFormChange({
                        ...ruleForm,
                        courierAccountId: e.target.value,
                        provider: c?.provider ?? ruleForm.provider,
                      });
                    }}
                    required
                  >
                    <option value="">কুরিয়ার অ্যাকাউন্ট বেছে নিন</option>
                    {conns
                      .filter((c) => c.connected)
                      .map((c) => (
                        <option key={c.provider} value={c.id ?? c.provider}>
                          {c.provider}
                        </option>
                      ))}
                  </select>
                  <input
                    className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                    type="number"
                    placeholder="Priority (যেমন: 10)"
                    value={ruleForm.priority}
                    onChange={(e) => onRuleFormChange({ ...ruleForm, priority: e.target.value })}
                  />
                  <input
                    className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                    placeholder="জেলাসমূহ (কমা দিয়ে)"
                    value={ruleForm.districts}
                    onChange={(e) => onRuleFormChange({ ...ruleForm, districts: e.target.value })}
                  />
                  <input
                    className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                    type="number"
                    placeholder="সর্বনিম্ন ওজন (গ্রাম)"
                    value={ruleForm.minWeightGrams}
                    onChange={(e) => onRuleFormChange({ ...ruleForm, minWeightGrams: e.target.value })}
                  />
                  <input
                    className="rounded-xl border border-slate-200 px-3 py-2 text-xs"
                    type="number"
                    placeholder="সর্বোচ্চ ওজন (গ্রাম)"
                    value={ruleForm.maxWeightGrams}
                    onChange={(e) => onRuleFormChange({ ...ruleForm, maxWeightGrams: e.target.value })}
                  />
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={ruleForm.active}
                      onChange={(e) => onRuleFormChange({ ...ruleForm, active: e.target.checked })}
                    />
                    সক্রিয় রাখুন
                  </label>
                  <button
                    type="submit"
                    disabled={ruleBusy !== ""}
                    className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {ruleBusy === "save"
                      ? "সংরক্ষণ হচ্ছে..."
                      : editingRule
                        ? "নিয়ম আপডেট করুন"
                        : "নিয়ম সংরক্ষণ করুন"}
                  </button>
                  {editingRule && (
                    <button
                      type="button"
                      onClick={onCancelEditRule}
                      className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"
                    >
                      বাতিল
                    </button>
                  )}
                </div>
              </form>
            </div>
          )}

          {/* TAB 3: PERFORMANCE */}
          {hubTab === "perf" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  কুরিয়ার পারফরম্যান্স তুলনা
                </span>
                <select
                  className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold"
                  value={perfDays}
                  onChange={(e) => onPerfDaysChange(Number(e.target.value))}
                >
                  <option value={7}>শেষ ৭ দিন</option>
                  <option value={30}>শেষ ৩০ দিন</option>
                  <option value={90}>শেষ ৯০ দিন</option>
                </select>
              </div>

              {!perf || perf.providers.length === 0 ? (
                <p className="text-xs text-slate-500">এই সময়ে কোনো ডেটা পাওয়া যায়নি।</p>
              ) : (
                <ResponsiveTable
                  table={
                    <div className="overflow-x-auto rounded-2xl border border-slate-200/80">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b text-slate-500">
                      <tr>
                        <th className="py-2.5 px-3 font-semibold">কুরিয়ার</th>
                        <th className="py-2.5 px-3 font-semibold">বুকিং</th>
                        <th className="py-2.5 px-3 font-semibold">ডেলিভার্ড</th>
                        <th className="py-2.5 px-3 font-semibold">রিটার্ন</th>
                        <th className="py-2.5 px-3 font-semibold">বাতিল</th>
                        <th className="py-2.5 px-3 font-semibold">পথে আছে</th>
                        <th className="py-2.5 px-3 font-semibold">ডেলিভারি হার</th>
                        <th className="py-2.5 px-3 font-semibold">রিটার্ন হার</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {[...perf.providers, perf.totals].map((row) => {
                        const isTotal = row.provider === "total";
                        const rate = (r: number | null) => (r === null ? "—" : `${(r * 100).toFixed(1)}%`);
                        return (
                          <tr
                            key={row.provider}
                            className={isTotal ? "bg-slate-50 font-bold" : "hover:bg-slate-50/50"}
                          >
                            <td className="py-2.5 px-3">
                              {PERF_PROVIDER_LABEL[row.provider] ?? row.provider}
                            </td>
                            <td className="py-2.5 px-3">{row.booked}</td>
                            <td className="py-2.5 px-3 text-emerald-700">{row.delivered}</td>
                            <td className="py-2.5 px-3 text-rose-600">{row.returned}</td>
                            <td className="py-2.5 px-3">{row.cancelled}</td>
                            <td className="py-2.5 px-3 text-indigo-600">{row.inFlight}</td>
                            <td className="py-2.5 px-3 font-bold text-emerald-700">
                              {rate(row.deliveryRate)}
                            </td>
                            <td className="py-2.5 px-3 font-bold text-rose-600">{rate(row.returnRate)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                    </div>
                  }
                  cards={[...perf.providers, perf.totals].map((row) => {
                    const isTotal = row.provider === "total";
                    const rate = (r: number | null) => (r === null ? "—" : `${(r * 100).toFixed(1)}%`);
                    return (
                      <div key={row.provider} className={`rounded-xl border bg-white p-3 shadow-sm ${isTotal ? "bg-slate-50 font-bold" : ""}`}>
                        <div className="font-bold text-slate-900">{PERF_PROVIDER_LABEL[row.provider] ?? row.provider}</div>
                        <dl className="mt-2 space-y-1 text-xs">
                          <div className="flex justify-between gap-2"><dt className="text-slate-500">বুকিং</dt><dd className="font-medium">{row.booked}</dd></div>
                          <div className="flex justify-between gap-2"><dt className="text-slate-500">ডেলিভার্ড</dt><dd className="font-medium text-emerald-700">{row.delivered}</dd></div>
                          <div className="flex justify-between gap-2"><dt className="text-slate-500">রিটার্ন</dt><dd className="font-medium text-rose-600">{row.returned}</dd></div>
                          <div className="flex justify-between gap-2"><dt className="text-slate-500">বাতিল</dt><dd className="font-medium">{row.cancelled}</dd></div>
                          <div className="flex justify-between gap-2"><dt className="text-slate-500">পথে আছে</dt><dd className="font-medium text-indigo-600">{row.inFlight}</dd></div>
                          <div className="flex justify-between gap-2"><dt className="text-slate-500">ডেলিভারি হার</dt><dd className="font-bold text-emerald-700">{rate(row.deliveryRate)}</dd></div>
                          <div className="flex justify-between gap-2"><dt className="text-slate-500">রিটার্ন হার</dt><dd className="font-bold text-rose-600">{rate(row.returnRate)}</dd></div>
                        </dl>
                      </div>
                    );
                  })}
                />
              )}
            </div>
          )}

          {/* TAB 4: CHASE & REVIEWS */}
          {hubTab === "chase" && (
            <div className="space-y-4">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                🎯 থেমে যাওয়া অর্ডার বট সেশন
              </span>
              {chases.length === 0 ? (
                <p className="text-xs text-slate-500">কোনো থেমে যাওয়া সেশন নেই।</p>
              ) : (
                <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200/80">
                  {chases.slice(0, 30).map((c) => (
                    <div key={c.id} className="p-3 text-xs flex items-center justify-between">
                      <div>
                        <span className="font-semibold text-slate-900">{c.productName ?? "পণ্য অজানা"}</span>
                        <div className="text-[10px] text-slate-400">
                          {c.lastChasedAt ? `সর্বশেষ: ${new Date(c.lastChasedAt).toLocaleString("bn-BD")}` : "—"}
                        </div>
                      </div>
                      <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                        {c.attempts > 0 ? `${c.attempts} বার অনুস্মারক` : "অপেক্ষমাণ"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
