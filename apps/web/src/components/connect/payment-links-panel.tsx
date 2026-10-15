"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  formatWhen, paymentLinkStatusMeta,
  type PaymentLinkCreatedView, type PaymentLinkView,
} from "@/lib/connections";

/**
 * CC26(b) — শেয়ারযোগ্য পেমেন্ট লিঙ্ক।
 *
 * অর্ডারের আইডি দিয়ে একটি লিঙ্ক তৈরি হয়; ক্রেতা লিঙ্কটি
 * খুললেই শপের নাম, অর্ডার নম্বর ও পরিশোধযোগ্য অঙ্ক দেখে Pay
 * চাপতে পারেন — টাকা পাওয়ার প্রক্রিয়াটি দোকানের সাধারণ
 * অনলাইন পেমেন্টের হুবহু একই যাচাই-ভিত্তিক পথ। সার্ভারে শুধু
 * লিঙ্কের token-এর hash থাকে; পুরো লিঙ্কটি শুধু এই তৈরির
 * মুহূর্তেই দেখানো হয় — তালিকা থেকে লিঙ্কটি আর কখনো পাওয়া
 * যায় না, তাই এখনই কপি করে রাখুন। পেমেন্ট যাচাই সম্পন্ন হলে
 * লিঙ্কটি নিজে থেকেই মেয়াদোত্তীর্ণ হয়ে যায় (used)।
 */
export function PaymentLinksPanel() {
  const [links, setLinks] = useState<PaymentLinkView[]>([]);
  const [orderId, setOrderId] = useState("");
  const [provider, setProvider] = useState("sslcommerz");
  const [source, setSource] = useState("own");
  const [expiresInHours, setExpiresInHours] = useState("72");
  const [created, setCreated] = useState<PaymentLinkCreatedView | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const res = await apiFetch<{ links: PaymentLinkView[] }>(`organizations/${orgId}/connections/payment-links?limit=50`);
      setLinks(res.links ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "পেমেন্ট লিঙ্ক লোড হয়নি");
    } finally { setLoaded(true); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function create() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const trimmed = orderId.trim();
    if (!trimmed) { setError("অর্ডারের আইডি দিন"); return; }
    const hours = Number(expiresInHours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) { setError("মেয়াদ ১ ঘণ্টা থেকে ৩০ দিনের (৭২০ ঘণ্টা) মধ্যে হতে হবে"); return; }
    setBusy("create"); setError(""); setNotice(""); setCreated(null);
    try {
      const out = await apiFetch<PaymentLinkCreatedView>(`organizations/${orgId}/connections/payment-links`, {
        method: "POST", body: JSON.stringify({ orderId: trimmed, provider, source, expiresInHours: hours }),
      });
      setCreated(out);
      setOrderId("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "লিঙ্ক তৈরি করা যায়নি");
    } finally { setBusy(""); }
  }

  async function revoke(link: PaymentLinkView) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(link.id); setError(""); setNotice("");
    try {
      await apiFetch(`organizations/${orgId}/connections/payment-links/${link.id}/revoke`, { method: "POST", body: "{}" });
      setNotice("লিঙ্কটি বাতিল করা হয়েছে — এই লিঙ্ক দিয়ে আর পেমেন্ট শুরু করা যাবে না।");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "লিঙ্ক বাতিল করা যায়নি");
    } finally { setBusy(""); }
  }

  async function copyUrl() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.payUrl);
      setNotice("লিঙ্কটি কপি হয়েছে।");
    } catch { setError("কপি করা যায়নি — লিঙ্কটি ম্যানুয়ালি কপি করুন"); }
  }

  return (
    <div className="card space-y-3 p-4">
      <div className="font-semibold text-slate-800">🔗 পেমেন্ট লিঙ্ক</div>
      {error ? <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{error}</div> : null}
      {notice ? <div className="rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-700">{notice}</div> : null}
      <p className="text-xs leading-relaxed text-slate-500">
        অপরিশোধিত অর্ডারের জন্য একটি লিঙ্ক বানিয়ে ক্রেতাকে পাঠান — ক্রেতা নিজেই পেমেন্ট করবেন, আর পেমেন্ট শুধু
        গেটওয়ের সার্ভার-যাচাইয়ের পরেই সম্পূর্ণ ধরা হবে (লিঙ্ক খোলা বা পেমেন্ট পেজে যাওয়া কখনো প্রমাণ নয়)।
        লিঙ্ক শুধু live গেটওয়ের জন্য — sandbox লিঙ্ক তৈরি হয় না। পেমেন্ট সম্পন্ন হলেই লিঙ্কটি স্বয়ংক্রিয়ভাবে
        ব্যবহৃত হয়ে যায়।
      </p>

      {created ? (
        <div className="space-y-2 rounded-xl bg-indigo-50 px-4 py-3">
          <div className="text-sm font-semibold text-indigo-900">লিঙ্ক তৈরি হয়েছে — এখনই কপি করে রাখুন</div>
          <p className="text-xs leading-relaxed text-indigo-800">
            ⚠️ এই পুরো লিঙ্কটি শুধু এই একবারই দেখানো হচ্ছে। সার্ভারে লিঙ্কের শুধু hash থাকে — হারিয়ে গেলে এই
            লিঙ্কটি আর উদ্ধার করা যাবে না; প্রয়োজনে নতুন লিঙ্ক তৈরি করে পুরনোটা বাতিল করুন।
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-white px-3 py-2 text-xs text-slate-700">{created.payUrl}</code>
            <button type="button" onClick={() => void copyUrl()} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700">কপি করুন</button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs text-slate-500">অর্ডারের আইডি*
          <input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="order আইডি" className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-slate-500">গেটওয়ে
          <select value={provider} onChange={(e) => setProvider(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            <option value="sslcommerz">SSLCommerz</option>
            <option value="bkash">বিকাশ</option>
          </select>
        </label>
        <label className="text-xs text-slate-500">উৎস
          <select value={source} onChange={(e) => setSource(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
            <option value="own">নিজের গেটওয়ে</option>
            <option value="platform">প্ল্যাটফর্ম গেটওয়ে</option>
          </select>
        </label>
        <label className="text-xs text-slate-500">মেয়াদ (ঘণ্টা, ১–৭২০)
          <input inputMode="numeric" value={expiresInHours} onChange={(e) => setExpiresInHours(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
        </label>
      </div>
      <button type="button" disabled={busy === "create"} onClick={() => void create()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
        {busy === "create" ? "তৈরি হচ্ছে…" : "পেমেন্ট লিঙ্ক তৈরি করুন"}
      </button>

      {!loaded ? (
        <p className="text-xs text-slate-400">লোড হচ্ছে…</p>
      ) : links.length === 0 ? (
        <p className="text-xs text-slate-400">এখনো কোনো পেমেন্ট লিঙ্ক তৈরি হয়নি।</p>
      ) : (
        <ul className="space-y-1">
          {links.map((link) => {
            const meta = paymentLinkStatusMeta(link.status);
            return (
              <li key={link.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                <span className={`rounded-full px-2 py-0.5 font-semibold ${meta.cls}`}>{meta.label}</span>
                <span className="text-slate-600">{link.provider === "bkash" ? "বিকাশ" : "SSLCommerz"} · {link.source === "platform" ? "প্ল্যাটফর্ম" : "নিজের গেটওয়ে"}</span>
                <span className="font-mono text-slate-400">অর্ডার: {link.orderId}</span>
                <span className="text-slate-400">মেয়াদ শেষ: {formatWhen(link.expiresAt) ?? "—"}</span>
                {link.usedAt ? <span className="text-slate-400">ব্যবহৃত: {formatWhen(link.usedAt) ?? ""}</span> : null}
                {link.status === "active" ? (
                  <button type="button" disabled={busy === link.id} onClick={() => void revoke(link)} className="rounded-lg bg-red-50 px-2 py-1 font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">
                    {busy === link.id ? "হচ্ছে…" : "বাতিল করুন"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
