"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { buildGatewayBody, type GatewayForm, type GatewayProviderId } from "@/lib/connect-forms";
import { formatWhen, gatewayStatusLabel, type TenantPaymentGatewayView } from "@/lib/connections";
import { PlatformWalletPanel } from "./platform-wallet-panel";

/**
 * CC9 (Connect Center B4) — the tenant's OWN payment gateways.
 *
 * টাকা সরাসরি আপনার নিজের merchant অ্যাকাউন্টে settle হয় —
 * প্ল্যাটফর্ম এই টাকা ধরে রাখে না। যাচাইয়ের সত্য প্রতিটি
 * কার্ডে স্পষ্ট: bKash-ই একমাত্র যেখানে আগাম আসল যাচাই হয়
 * (grant token); SSLCommerz/Nagad-এ তেমন সুযোগ নেই বলে সেগুলো
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
];

const EMPTY_FORM: GatewayForm = {
  storeId: "", storePass: "", username: "", password: "", appKey: "", appSecret: "",
  merchantId: "", privateKey: "", sandbox: true,
};

const inputCls = "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400";

function GatewayCard({ meta, view, busy, onSave, onToggle, onDelete }: {
  meta: (typeof PROVIDER_META)[number];
  view: TenantPaymentGatewayView | null;
  busy: string;
  onSave: (provider: GatewayProviderId, form: GatewayForm) => void;
  onToggle: (view: TenantPaymentGatewayView) => void;
  onDelete: (view: TenantPaymentGatewayView) => void;
}) {
  const [form, setForm] = useState<GatewayForm>(EMPTY_FORM);
  const saving = busy === meta.id;
  const verifiedAt = formatWhen(view?.lastVerifiedAt);
  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="font-semibold text-slate-800">{meta.icon} {meta.title}</div>
        {view ? (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${!view.isEnabled ? "bg-slate-200 text-slate-600" : view.status === "verified" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
            {!view.isEnabled ? "বন্ধ আছে" : gatewayStatusLabel(view)}
          </span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">কনফিগার করা হয়নি</span>
        )}
      </div>
      {view ? (
        <div className="space-y-1 text-xs text-slate-500">
          {view.identifier ? <div>{meta.id === "sslcommerz" ? "Store ID" : meta.id === "bkash" ? "App Key" : "Merchant ID"}: <span className="font-medium text-slate-700">{view.identifier}</span>{view.sandbox ? " · Sandbox" : " · Live"}</div> : null}
          {verifiedAt ? <div>সর্বশেষ যাচাই: {verifiedAt}</div> : null}
          {view.lastError ? <div className="rounded-lg bg-red-50 px-2 py-1 font-medium text-red-600">⚠️ {view.lastError}</div> : null}
        </div>
      ) : null}
      <p className="text-xs leading-relaxed text-slate-500">{meta.note}</p>
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); onSave(meta.id, form); setForm((f) => ({ ...f, storePass: "", password: "", appSecret: "", privateKey: "" })); }}>
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
        ) : (
          <>
            <label className="block text-sm">Merchant ID<input className={inputCls} value={form.merchantId} onChange={(e) => setForm({ ...form, merchantId: e.target.value })} required autoComplete="off" /></label>
            <label className="block text-sm">Merchant Private Key<textarea className={inputCls} value={form.privateKey} onChange={(e) => setForm({ ...form, privateKey: e.target.value })} required rows={3} autoComplete="off" /></label>
          </>
        )}
        {meta.id !== "nagad" ? (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={form.sandbox} onChange={(e) => setForm({ ...form, sandbox: e.target.checked })} />
            Sandbox মোড (পরীক্ষামূলক অ্যাকাউন্ট হলে)
          </label>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={saving} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            {saving ? "সেভ হচ্ছে..." : meta.id === "bkash" ? "যাচাই করে সেভ করুন" : "সেভ করুন"}
          </button>
          {view ? (
            <>
              <button type="button" disabled={saving} onClick={() => onToggle(view)} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50">
                {view.isEnabled ? "বন্ধ করুন" : "চালু করুন"}
              </button>
              <button type="button" disabled={saving} onClick={() => onDelete(view)} className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 disabled:opacity-50">
                গেটওয়ে সরান
              </button>
            </>
          ) : null}
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

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const res = await apiFetch<{ gateways: TenantPaymentGatewayView[] }>(`organizations/${orgId}/connections/payment-gateways`);
      setGateways(res.gateways ?? []);
    } catch { /* the section simply shows "not configured" */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async (provider: GatewayProviderId, form: GatewayForm) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(provider); setError(""); setNotice("");
    try {
      const saved = await apiFetch<TenantPaymentGatewayView>(`organizations/${orgId}/connections/payment-gateways/${provider}`, {
        method: "PUT", body: JSON.stringify(buildGatewayBody(provider, form)),
      });
      setNotice(provider === "bkash"
        ? "আপনার bKash গেটওয়েটি bKash-এর কাছে যাচাই হয়ে সেভ হয়েছে — এখন অর্ডারে অনলাইন পেমেন্ট নেওয়া যাবে।"
        : "গেটওয়েটি সেভ হয়েছে (কনফিগার করা) — আগাম যাচাইয়ের সুযোগ এই গেটওয়েতে নেই, প্রথম আসল লেনদেনের সার্ভার-যাচাইয়েই নিশ্চিত হওয়া যাবে।");
      setGateways((prev) => [...prev.filter((g) => g.provider !== provider), saved]);
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
      await apiFetch(`organizations/${orgId}/connections/payment-gateways/${view.provider}/enabled`, {
        method: "PATCH", body: JSON.stringify({ isEnabled: !view.isEnabled }),
      });
      setNotice(view.isEnabled ? "গেটওয়েটি বন্ধ করা হয়েছে — নতুন পেমেন্ট এতে শুরু হবে না।" : "গেটওয়েটি চালু করা হয়েছে।");
      await load(); onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "কাজটি সম্পন্ন হয়নি");
    } finally { setBusy(""); }
  }, [load, onChanged]);

  const remove = useCallback(async (view: TenantPaymentGatewayView) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    if (!window.confirm("এই গেটওয়ের কনফিগ সরাবেন? আগের লেনদেনের রেকর্ড থেকে যাবে, কিন্তু নতুন পেমেন্ট আর এই গেটওয়ে দিয়ে শুরু করা যাবে না।")) return;
    setBusy(view.provider); setError("");
    try {
      await apiFetch(`organizations/${orgId}/connections/payment-gateways/${view.provider}`, { method: "DELETE" });
      setNotice("গেটওয়ের কনফিগ সরানো হয়েছে।");
      await load(); onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "সরানো যায়নি");
    } finally { setBusy(""); }
  }, [load, onChanged]);

  return (
    <div className="space-y-3">
      {error ? <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{error}</div> : null}
      {notice ? <div className="rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-700">{notice}</div> : null}
      <div className="grid gap-3 lg:grid-cols-3">
        {PROVIDER_META.map((meta) => (
          <GatewayCard
            key={meta.id}
            meta={meta}
            view={gateways.find((g) => g.provider === meta.id) ?? null}
            busy={busy}
            onSave={(p, f) => void save(p, f)}
            onToggle={(v) => void toggle(v)}
            onDelete={(v) => void remove(v)}
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
