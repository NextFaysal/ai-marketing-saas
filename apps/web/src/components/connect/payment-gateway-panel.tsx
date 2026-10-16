"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { buildGatewayBody, feeBpsToPercentInput, feeMinorToTakaInput, parseFeePercentToBps, parseFeeTakaToMinor, type GatewayForm, type GatewayProviderId } from "@/lib/connect-forms";
import { formatWhen, gatewayStatusLabel, type TenantPaymentGatewayView } from "@/lib/connections";
import { PlatformWalletPanel } from "./platform-wallet-panel";

/**
 * CC9 (Connect Center B4) — the tenant's OWN payment gateways.
 *
 * টাকা সরাসরি আপনার নিজের merchant অ্যাকাউন্টে settle হয় —
 * প্ল্যাটফর্ম এই টাকা ধরে রাখে না। যাচাইয়ের সত্য প্রতিটি
 * কার্ডে স্পষ্ট: bKash (grant token) ও ShurjoPay-তে (get_token,
 * GC11) আগাম আসল যাচাই হয়; SSLCommerz/Nagad/aamarPay-তে তেমন সুযোগ নেই বলে সেগুলো
 * সেভ হয় "কনফিগার করা" হিসেবে — প্রথম আসল লেনদেনই যাচাই, আর
 * পেমেন্ট "সফল" ধরা হয় শুধু গেটওয়ের সার্ভার-যাচাইয়ের পরেই।
 * Rocket-এর কোনো API গেটওয়ে নেই — এটি ম্যানুয়াল নম্বরের পথ।
 * প্ল্যাটফর্ম গেটওয়ে + Wallet (CC10) নিচের আলাদা প্যানেলে —
 * সেখানে ফি-র হার ও প্রোভাইডার-প্রাপ্যতা আসে API থেকেই।
 */

const PROVIDER_META: { id: GatewayProviderId; icon: string; title: string; note: string }[] = [
  {
    id: "sslcommerz", icon: "💳", title: "SSLCommerz (নিজের)",
    note: "আপনার নিজের SSLCommerz Store ID ও Store Password দিন। SSLCommerz কোনো আগাম credential-যাচাইয়ের সুযোগ দেয় না (যাচাইয়ের API-তে আসল লেনদেনের val_id লাগে), তাই এটি সেভ হবে \"কনফিগার করা\" হিসেবে — পেমেন্ট সফল ধরা হবে শুধু IPN + Validation API-র সার্ভার-যাচাইয়ের পরেই।",
  },
  {
    id: "bkash", icon: "📱", title: "বিকাশ (bKash Tokenized, নিজের)",
    note: "আপনার bKash merchant-এর Username, Password, App Key ও App Secret দিন। সেভ করার আগে আসল grant-token কল দিয়ে যাচাই করা হয় — যাচাই ব্যর্থ হলে কিছুই সেভ হয় না এবং bKash-এর নিজের ত্রুটি দেখায়।",
  },
  {
    id: "nagad", icon: "🟠", title: "নগদ (Nagad, নিজের)",
    note: "Nagad Merchant ID ও Private Key দিন। এই সিস্টেমে Nagad-এর কোনো আগাম credential-যাচাই বা API চেকআউট সংযুক্ত নয় — কনফিগটি সেভ হবে \"কনফিগার করা\" হিসেবে, আর চেকআউট আপাতত ম্যানুয়াল Nagad নম্বরের পথেই চলবে।",
  },
  {
    id: "shurjopay", icon: "🟢", title: "ShurjoPay (নিজের)",
    note: "আপনার ShurjoPay merchant-এর Username, Password ও Prefix দিন (Store ID থাকলে সেটিও)। সেভ করার আগে token দিয়ে যাচাই করা হয় — যাচাই ব্যর্থ হলে কিছুই সেভ হয় না এবং ShurjoPay-এর নিজের ত্রুটি দেখায়। পেমেন্ট সফল ধরা হবে শুধু সার্ভার-side verification-এ sp_code 1000 + সঠিক amount/currency মিললেই।",
  },
  {
    id: "aamarpay", icon: "🔵", title: "aamarPay (নিজের)",
    note: "আপনার aamarPay Store ID ও Signature Key দিন। SSLCommerz-এর মতো এখানে save-time যাচাই নেই — প্রথম আসল পেমেন্টেই যাচাই হবে, তাই এটি সেভ হবে \"configured\" লেবেলসহ। পেমেন্ট সফল ধরা হবে শুধু Search Transaction সার্ভার-যাচাইয়ে Successful + সঠিক amount/currency মিললেই।",
  },
];

const EMPTY_FORM: GatewayForm = {
  storeId: "", storePass: "", username: "", password: "", appKey: "", appSecret: "",
  merchantId: "", privateKey: "", prefix: "", signatureKey: "", sandbox: true,
  feePercent: "", feeFixedTaka: "",
};

const inputCls = "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400";

function GatewayCard({ meta, views, busy, testLink, onSave, onToggle, onDelete, onTestInitiate }: {
  meta: (typeof PROVIDER_META)[number];
  views: TenantPaymentGatewayView[];
  busy: string;
  testLink: string | null;
  onSave: (provider: GatewayProviderId, form: GatewayForm, environment: "live" | "sandbox") => void;
  onToggle: (view: TenantPaymentGatewayView) => void;
  onDelete: (view: TenantPaymentGatewayView) => void;
  onTestInitiate: (provider: GatewayProviderId) => void;
}) {
  const [form, setForm] = useState<GatewayForm>(EMPTY_FORM);
  // CC19: প্রতিটি প্রোভাইডারে দুটি আলাদা credential সেট থাকতে
  // পারে — Live (আসল পেমেন্টে শুধু এটাই ব্যবহৃত হয়) ও Sandbox
  // (শুধু পরীক্ষা; কখনো আসল অর্ডার paid করে না)।
  const [environment, setEnvironment] = useState<"live" | "sandbox">("live");
  const [feeError, setFeeError] = useState("");
  const saving = busy === meta.id;
  const sandboxView = views.find((v) => (v.environment ?? "live") === "sandbox") ?? null;
  // GC12: prefill the fee inputs from the stored gateway view
  // whenever the stored fee values change (first load, or the
  // reload after a save). Because the inputs always show the
  // stored values, buildGatewayBody's always-send flow re-sends
  // them on a creds-only re-save — fees can never be wiped by
  // accident; only deliberately clearing an input clears a fee.
  const liveView = views.find((v) => (v.environment ?? "live") === "live") ?? null;
  const activeView = environment === "sandbox" ? sandboxView : liveView;
  const feeKey = activeView ? `${activeView.provider}:${activeView.environment ?? "live"}:${activeView.feeBps}:${activeView.feeFixedMinor}` : "none";
  const lastFeeKey = useRef("");
  useEffect(() => {
    if (lastFeeKey.current === feeKey) return;
    lastFeeKey.current = feeKey;
    setForm((f) => ({
      ...f,
      feePercent: feeBpsToPercentInput(activeView?.feeBps ?? null),
      feeFixedTaka: feeMinorToTakaInput(activeView?.feeFixedMinor ?? null),
    }));
  }, [feeKey, activeView]);
  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="font-semibold text-slate-800">{meta.icon} {meta.title}</div>
        {views.length === 0 ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">কনফিগার করা হয়নি</span>
        ) : null}
      </div>
      {views.map((view) => {
        const env = view.environment ?? "live";
        const verifiedAt = formatWhen(view.lastVerifiedAt);
        return (
          <div key={env} className="space-y-1 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 ring-1 ring-inset ring-slate-100">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`rounded-full px-2 py-0.5 font-semibold ${env === "sandbox" ? "bg-violet-100 text-violet-700" : "bg-emerald-100 text-emerald-700"}`}>
                {env === "sandbox" ? "🧪 Sandbox সেট" : "🟢 Live সেট"}
              </span>
              <span className={`rounded-full px-2 py-0.5 font-semibold ${!view.isEnabled ? "bg-slate-200 text-slate-600" : view.status === "verified" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                {!view.isEnabled ? "বন্ধ আছে" : gatewayStatusLabel(view)}
              </span>
            </div>
            {view.identifier ? <div>{meta.id === "sslcommerz" || meta.id === "aamarpay" ? "Store ID" : meta.id === "bkash" ? "App Key" : meta.id === "shurjopay" ? "Username" : "Merchant ID"}: <span className="font-medium text-slate-700">{view.identifier}</span></div> : null}
            {verifiedAt ? <div>সর্বশেষ যাচাই: {verifiedAt}</div> : null}
            {view.lastError ? <div className="rounded-lg bg-red-50 px-2 py-1 font-medium text-red-600">⚠️ {view.lastError}</div> : null}
            <div className="flex flex-wrap gap-1.5 pt-1">
              <button type="button" disabled={saving} onClick={() => onToggle(view)} className="rounded-lg bg-white px-2.5 py-1 font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100 disabled:opacity-50">
                {view.isEnabled ? "বন্ধ করুন" : "চালু করুন"}
              </button>
              <button type="button" disabled={saving} onClick={() => onDelete(view)} className="rounded-lg bg-red-50 px-2.5 py-1 font-semibold text-red-600 hover:bg-red-100 disabled:opacity-50">
                এই সেটটি সরান
              </button>
              {env === "sandbox" && meta.id !== "nagad" ? (
                <button type="button" disabled={saving} onClick={() => onTestInitiate(meta.id)} className="rounded-lg bg-violet-600 px-2.5 py-1 font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
                  🧪 টেস্ট পেমেন্ট শুরু করুন (৳১০০)
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
      {testLink ? (
        <div className="rounded-xl bg-violet-50 px-3 py-2 text-xs text-violet-800">
          টেস্ট পেমেন্টের লিংক তৈরি হয়েছে:{" "}
          <a href={testLink} target="_blank" rel="noreferrer" className="font-semibold underline">গেটওয়ে টেস্ট পেজ খুলুন ↗</a>
          <span className="block text-violet-600">এটি Sandbox লেনদেন — সম্পন্ন হলেও কোনো আসল অর্ডার paid হবে না, Wallet-এও কিছু জমা হবে না। ফল "গেটওয়ে লেনদেনের ইতিহাসে" Sandbox ব্যাজে দেখা যাবে।</span>
        </div>
      ) : null}
      <p className="text-xs leading-relaxed text-slate-500">{meta.note}</p>
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (!parseFeePercentToBps(form.feePercent ?? "").ok) { setFeeError("ফি হার 0–100% এর মধ্যে হতে হবে"); return; } if (!parseFeeTakaToMinor(form.feeFixedTaka ?? "").ok) { setFeeError("ফিক্সড ফি সঠিক টাকার পরিমাণে দিন (সর্বোচ্চ ২ দশমিক)"); return; } setFeeError(""); onSave(meta.id, { ...form, sandbox: environment === "sandbox" }, environment); setForm((f) => ({ ...f, storePass: "", password: "", appSecret: "", privateKey: "", signatureKey: "" })); }}>
        {meta.id === "sslcommerz" ? (
          <>
            <label className="block text-sm">Store ID<input className={inputCls} value={form.storeId} onChange={(e) => setForm({ ...form, storeId: e.target.value })} required autoComplete="off" /></label>
            <label className="block text-sm">Store Password<input type="password" className={inputCls} value={form.storePass} onChange={(e) => setForm({ ...form, storePass: e.target.value })} required autoComplete="new-password" /></label>
          </>
        ) : meta.id === "bkash" ? (
          <>
            <label className="block text-sm">Username (Merchant নম্বর)<input className={inputCls} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required autoComplete="off" /></label>
            <label className="block text-sm">Password<input type="password" className={inputCls} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required autoComplete="new-password" /></label>
            <label className="block text-sm">App Key<input className={inputCls} value={form.appKey} onChange={(e) => setForm({ ...form, appKey: e.target.value })} required autoComplete="off" /></label>
            <label className="block text-sm">App Secret<input type="password" className={inputCls} value={form.appSecret} onChange={(e) => setForm({ ...form, appSecret: e.target.value })} required autoComplete="new-password" /></label>
          </>
        ) : meta.id === "shurjopay" ? (
          <>
            <label className="block text-sm">Username<input className={inputCls} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required autoComplete="off" /></label>
            <label className="block text-sm">Password<input type="password" className={inputCls} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required autoComplete="new-password" /></label>
            <label className="block text-sm">Prefix<input className={inputCls} value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value })} required autoComplete="off" /></label>
            <label className="block text-sm">Store ID (ঐচ্ছিক)<input className={inputCls} value={form.storeId} onChange={(e) => setForm({ ...form, storeId: e.target.value })} autoComplete="off" /></label>
          </>
        ) : meta.id === "aamarpay" ? (
          <>
            <label className="block text-sm">Store ID<input className={inputCls} value={form.storeId} onChange={(e) => setForm({ ...form, storeId: e.target.value })} required autoComplete="off" /></label>
            <label className="block text-sm">Signature Key<input type="password" className={inputCls} value={form.signatureKey} onChange={(e) => setForm({ ...form, signatureKey: e.target.value })} required autoComplete="new-password" /></label>
          </>
        ) : (
          <>
            <label className="block text-sm">Merchant ID<input className={inputCls} value={form.merchantId} onChange={(e) => setForm({ ...form, merchantId: e.target.value })} required autoComplete="off" /></label>
            <label className="block text-sm">Merchant Private Key<textarea className={inputCls} value={form.privateKey} onChange={(e) => setForm({ ...form, privateKey: e.target.value })} required rows={3} autoComplete="off" /></label>
          </>
        )}
        <fieldset className="space-y-1">
          <legend className="text-sm text-slate-600">কোন সেটে সেভ হবে?</legend>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="radio" name={`${meta.id}-env`} checked={environment === "live"} onChange={() => setEnvironment("live")} />
            Live সেট — আসল পেমেন্টে শুধু এটাই ব্যবহৃত হয়
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="radio" name={`${meta.id}-env`} checked={environment === "sandbox"} onChange={() => setEnvironment("sandbox")} />
            Sandbox সেট — শুধু পরীক্ষার জন্য; আসল অর্ডারে কখনো ব্যবহৃত হয় না
          </label>
        </fieldset>
        {/* GC12: the merchant's own gateway-contract fee numbers.
            These are NOT credentials — they are plain settings the
            fee report uses; both empty = no fee rate configured. */}
        <div className="space-y-2 rounded-lg bg-slate-50 px-3 py-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm">আপনার gateway-এর ফি হার (%)
              <input className={inputCls} inputMode="decimal" placeholder="যেমন: 2.5" value={form.feePercent ?? ""} onChange={(e) => setForm({ ...form, feePercent: e.target.value })} autoComplete="off" />
            </label>
            <label className="block text-sm">ফিক্সড ফি (টাকা)
              <input className={inputCls} inputMode="decimal" placeholder="যেমন: 5" value={form.feeFixedTaka ?? ""} onChange={(e) => setForm({ ...form, feeFixedTaka: e.target.value })} autoComplete="off" />
            </label>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">ফি হার সেট না থাকলে ফি রিপোর্টে এই gateway-এর ফি দেখানো হবে না।</p>
          {feeError ? <p className="rounded-lg bg-red-50 px-2 py-1 text-xs font-medium text-red-600">⚠️ {feeError}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={saving} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            {saving ? "সেভ হচ্ছে..." : meta.id === "bkash" || meta.id === "shurjopay" ? `যাচাই করে ${environment === "sandbox" ? "Sandbox" : "Live"} সেটে সেভ করুন` : `${environment === "sandbox" ? "Sandbox" : "Live"} সেটে সেভ করুন`}
          </button>
        </div>
      </form>
    </div>
  );
}

export function PaymentGatewayPanel({ onChanged }: { onChanged?: () => void }) {
  const [gateways, setGateways] = useState<TenantPaymentGatewayView[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [testLinks, setTestLinks] = useState<Record<string, string>>({});
  // CC23: TOTP step-up code for the sensitive actions in this
  // panel (gateway বন্ধ করা / সরানো). Only sent when filled;
  // the server demands it exactly when the user has TOTP on.
  const [totpCode, setTotpCode] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const res = await apiFetch<{ gateways: TenantPaymentGatewayView[] }>(`organizations/${orgId}/connections/payment-gateways`);
      setGateways(res.gateways ?? []);
    } catch { /* the section simply shows "not configured" */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async (provider: GatewayProviderId, form: GatewayForm, environment: "live" | "sandbox") => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(provider); setError(""); setNotice("");
    try {
      const saved = await apiFetch<TenantPaymentGatewayView>(`organizations/${orgId}/connections/payment-gateways/${provider}`, {
        method: "PUT", body: JSON.stringify({ ...buildGatewayBody(provider, form), environment }),
      });
      setNotice(provider === "bkash"
        ? `আপনার bKash ${environment === "sandbox" ? "Sandbox" : "Live"} সেটটি bKash-এর কাছে যাচাই হয়ে সেভ হয়েছে।`
        : provider === "shurjopay"
          ? `আপনার ShurjoPay ${environment === "sandbox" ? "Sandbox" : "Live"} সেটটি token দিয়ে যাচাই হয়ে সেভ হয়েছে — এখন অর্ডারে অনলাইন পেমেন্ট নেওয়া যাবে।`
        : `গেটওয়ের ${environment === "sandbox" ? "Sandbox" : "Live"} সেটটি সেভ হয়েছে (কনফিগার করা) — আগাম যাচাইয়ের সুযোগ এই গেটওয়েতে নেই, প্রথম আসল লেনদেনের সার্ভার-যাচাইয়েই নিশ্চিত হওয়া যাবে।`);
      setGateways((prev) => [...prev.filter((g) => !(g.provider === provider && (g.environment ?? "live") === environment)), saved]);
      await load(); onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "গেটওয়ে সেভ হয়নি");
    } finally { setBusy(""); }
  }, [load, onChanged]);

  const toggle = useCallback(async (view: TenantPaymentGatewayView) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(view.provider); setError("");
    try {
      const res = await apiFetch<{ stepUpUnavailable?: boolean }>(`organizations/${orgId}/connections/payment-gateways/${view.provider}/enabled?environment=${view.environment ?? "live"}`, {
        method: "PATCH", body: JSON.stringify({ isEnabled: !view.isEnabled, ...(view.isEnabled && totpCode.trim() ? { totpCode: totpCode.trim() } : {}) }),
      });
      const base = view.isEnabled ? "গেটওয়ের এই সেটটি বন্ধ করা হয়েছে — নতুন পেমেন্ট এতে শুরু হবে না।" : "গেটওয়ের এই সেটটি চালু করা হয়েছে।";
      setNotice(res?.stepUpUnavailable ? `${base} (আপনার Two-Factor চালু নেই — সংবেদনশীল কাজে অতিরিক্ত সুরক্ষার জন্য Settings থেকে Two-Factor চালু করুন।)` : base);
      await load(); onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "কাজটি সম্পন্ন হয়নি");
    } finally { setBusy(""); }
  }, [load, onChanged, totpCode]);

  const remove = useCallback(async (view: TenantPaymentGatewayView) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    if (!window.confirm("এই গেটওয়ে সেটের কনফিগ সরাবেন? আগের লেনদেনের রেকর্ড থেকে যাবে, কিন্তু নতুন পেমেন্ট আর এই সেট দিয়ে শুরু করা যাবে না।")) return;
    setBusy(view.provider); setError("");
    try {
      const res = await apiFetch<{ stepUpUnavailable?: boolean }>(`organizations/${orgId}/connections/payment-gateways/${view.provider}?environment=${view.environment ?? "live"}${totpCode.trim() ? `&totpCode=${encodeURIComponent(totpCode.trim())}` : ""}`, { method: "DELETE" });
      setNotice(res?.stepUpUnavailable ? "গেটওয়ে সেটের কনফিগ সরানো হয়েছে। (আপনার Two-Factor চালু নেই — সংবেদনশীল কাজে অতিরিক্ত সুরক্ষার জন্য Settings থেকে Two-Factor চালু করুন।)" : "গেটওয়ে সেটের কনফিগ সরানো হয়েছে।");
      await load(); onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "সরানো যায়নি");
    } finally { setBusy(""); }
  }, [load, onChanged, totpCode]);

  const testInitiate = useCallback(async (provider: GatewayProviderId) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(provider); setError(""); setNotice("");
    try {
      const res = await apiFetch<{ redirectUrl?: string; bkashURL?: string }>(`organizations/${orgId}/connections/payment-gateways/${provider}/test-initiate`, {
        method: "POST", body: JSON.stringify({}),
      });
      const url = res.redirectUrl ?? res.bkashURL ?? "";
      if (!url) throw new Error("গেটওয়ে কোনো পেমেন্ট লিংক দেয়নি — টেস্ট শুরু হয়নি।");
      setTestLinks((prev) => ({ ...prev, [provider]: url }));
      setNotice("Sandbox টেস্ট পেমেন্ট শুরু হয়েছে — লিংকটি কার্ডে দেখুন। এটি কোনো আসল অর্ডারের পেমেন্ট নয়।");
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "টেস্ট পেমেন্ট শুরু হয়নি");
    } finally { setBusy(""); }
  }, [onChanged]);

  return (
    <div className="space-y-3">
      {error ? <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{error}</div> : null}
      {notice ? <div className="rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-700">{notice}</div> : null}
      <label className="block max-w-sm text-xs font-medium text-slate-600">🔐 TOTP কোড — গেটওয়ে বন্ধ/সরানোর জন্য (শুধু আপনার Two-Factor চালু থাকলেই লাগবে)
        <input value={totpCode} onChange={(e) => setTotpCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="৬-সংখ্যার কোড" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400" />
      </label>
      <div className="grid gap-3 lg:grid-cols-3">
        {PROVIDER_META.map((meta) => (
          <GatewayCard
            key={meta.id}
            meta={meta}
            views={gateways.filter((g) => g.provider === meta.id)}
            busy={busy}
            testLink={testLinks[meta.id] ?? null}
            onSave={(p, f, env) => void save(p, f, env)}
            onToggle={(v) => void toggle(v)}
            onDelete={(v) => void remove(v)}
            onTestInitiate={(p) => void testInitiate(p)}
          />
        ))}
      </div>
      <div className="card space-y-2 p-4">
        <div className="font-semibold text-slate-800">🚀 Rocket — ম্যানুয়াল নম্বরের পথ</div>
        <p className="text-xs leading-relaxed text-slate-500">
          Rocket-এর কোনো merchant API গেটওয়ে নেই, তাই এটিকে API গেটওয়ে হিসেবে দেখানো হয় না। Rocket নম্বর ও
          পেমেন্ট নির্দেশনা Settings-এর পেমেন্ট অংশে দিন — কাস্টমার ম্যানুয়ালি পাঠাবে, যাচাই হবে আগের ম্যানুয়াল
          পথেই (কখনো স্বয়ংক্রিয় "সফল" ধরা হয় না)।
        </p>
        <Link href="/dashboard/settings#hub-payment" className="inline-block rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200">Settings-এ পেমেন্ট নোট দিন →</Link>
      </div>
      <PlatformWalletPanel onChanged={onChanged} />
    </div>
  );
}
