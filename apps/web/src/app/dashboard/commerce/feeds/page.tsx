"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

// EC14 — product feeds (Meta catalog / Google Merchant / generic CSV).
// Every number (itemCount / skippedCount / preview rows) comes from
// the server; nothing is estimated client-side.

interface Feed {
  id: string;
  channel: string;
  format: string;
  token: string;
  url: string;
  includeOutOfStock: boolean;
  defaultGoogleCategory?: string | null;
  active: boolean;
  lastGeneratedAt?: string | null;
  itemCount?: number | null;
  skippedCount?: number | null;
}
interface PreviewItem {
  id: string; title: string; link: string; imageLink?: string | null;
  availability: string; price: string; salePrice?: string | null;
  brand?: string | null; gtin?: string | null; itemGroupId?: string | null;
}
interface Preview {
  feed: Feed;
  itemCount: number;
  skippedCount: number;
  items: PreviewItem[];
  skipped: { productId: string; name: string; reason: string; reasonMessage: string }[];
  warnings: string[];
}

const CHANNEL_LABEL: Record<string, string> = {
  meta: "Meta (Facebook/Instagram Catalog)",
  google: "Google Merchant Center",
  tiktok: "TikTok (সাধারণ CSV — ইন্টিগ্রেশন নয়)",
};

export default function FeedsPage() {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);

  // create form
  const [channel, setChannel] = useState("meta");
  const [format, setFormat] = useState("xml");
  const [includeOutOfStock, setIncludeOutOfStock] = useState(false);
  const [defaultGoogleCategory, setDefaultGoogleCategory] = useState("");

  // preview
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) { setLoading(false); return; }
    setLoading(true);
    try {
      const out = await apiFetch<{ items: Feed[] }>(`/organizations/${orgId}/commerce/feeds`);
      setFeeds(out.items ?? []);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "লোড ব্যর্থ"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("create"); setError(""); setNotice("");
    try {
      await apiFetch<{ feed: Feed }>(`/organizations/${orgId}/commerce/feeds`, {
        method: "POST",
        body: JSON.stringify({
          channel,
          format,
          includeOutOfStock,
          defaultGoogleCategory: defaultGoogleCategory.trim() || undefined,
        }),
      });
      setNotice("ফিড তৈরি হয়েছে। নিচের URLটি চ্যানেলের scheduled fetch-এ বসান।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "তৈরি ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function toggleActive(f: Feed) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`active-${f.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/feeds/${f.id}/active`, {
        method: "POST", body: JSON.stringify({ active: !f.active }),
      });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function rotateToken(f: Feed) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm("টোকেন রোটেট করলে পুরনো ফিড URL কাজ করবে না — চ্যানেলে নতুন URL বসাতে হবে। চালিয়ে যাবেন?")) return;
    setBusy(`rotate-${f.id}`); setError(""); setNotice("");
    try {
      await apiFetch<{ feed: Feed }>(`/organizations/${orgId}/commerce/feeds/${f.id}/rotate-token`, { method: "POST" });
      setNotice("টোকেন রোটেট হয়েছে — নতুন URLটি চ্যানেলে বসান।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "রোটেট ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function remove(f: Feed) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm("এই ফিডটি মুছে ফেলবেন? এর URL আর কাজ করবে না।")) return;
    setBusy(`del-${f.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/commerce/feeds/${f.id}`, { method: "DELETE" });
      if (previewId === f.id) { setPreviewId(null); setPreview(null); }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "মুছে ফেলা ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function showPreview(f: Feed) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (previewId === f.id) { setPreviewId(null); setPreview(null); return; }
    setBusy(`preview-${f.id}`); setPreviewError(""); setPreview(null); setPreviewId(f.id);
    try {
      const out = await apiFetch<Preview>(`/organizations/${orgId}/commerce/feeds/${f.id}/preview`);
      setPreview(out);
    } catch (e) { setPreviewError(e instanceof Error ? e.message : "প্রিভিউ ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setNotice("ফিড URL কপি হয়েছে।");
    } catch {
      setError("কপি করা যায়নি — URLটি হাতে কপি করুন।");
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Product Feeds — প্রোডাক্ট ফিড</h1>
          <p className="text-sm text-slate-500">
            আপনার পণ্যের লাইভ ফিড URL তৈরি করুন — চ্যানেল scheduled fetch দিয়ে পণ্য টেনে নেবে।
          </p>
        </div>
        <Link href="/dashboard/commerce" className="btn-primary">← Commerce Hub</Link>
      </div>

      <p className="rounded-lg bg-amber-50 p-3 text-sm leading-relaxed text-amber-800">
        <b>সৎ অবস্থা (গবেষণা: ১৩ অক্টোবর ২০২৬):</b> Meta ও Google ফিড scheduled fetch দিয়ে যুক্ত করা যায়।{" "}
        <b>TikTok Shop বাংলাদেশে seller-দের জন্য চালু নয় ও কোনো পাবলিক ফিড স্পেসিফিকেশন নেই — TikTok CSVটি
        Google-কলামের সাধারণ এক্সপোর্ট, ইন্টিগ্রেশন নয়।</b> Daraz-এর পাবলিক seller API না থাকায় Daraz চ্যানেল নেই।
      </p>

      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      <div className="card p-5 space-y-4">
        <div className="font-semibold">নতুন ফিড</div>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-sm">চ্যানেল
            <select className="input mt-1" value={channel} onChange={(e) => setChannel(e.target.value)}>
              {Object.entries(CHANNEL_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="block text-sm">ফরম্যাট
            <select className="input mt-1" value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="xml">XML</option>
              <option value="csv">CSV</option>
            </select>
          </label>
          <label className="block text-sm">ডিফল্ট Google ক্যাটাগরি (ঐচ্ছিক)
            <input className="input mt-1" value={defaultGoogleCategory} onChange={(e) => setDefaultGoogleCategory(e.target.value)} placeholder="যেমন: Apparel & Accessories > Clothing" />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includeOutOfStock} onChange={(e) => setIncludeOutOfStock(e.target.checked)} />
          স্টক শেষ পণ্যও ফিডে রাখুন (out of stock হিসেবে)
        </label>
        <button className="btn-primary" disabled={busy !== ""} onClick={create}>
          {busy === "create" ? "তৈরি হচ্ছে…" : "ফিড তৈরি করুন"}
        </button>
      </div>

      <div className="space-y-4">
        <div className="font-semibold">সব ফিড ({feeds.length})</div>
        {loading ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : feeds.length === 0 ? (
          <p className="text-sm text-slate-500">এখনো কোনো ফিড নেই — উপরে প্রথম ফিডটি তৈরি করুন।</p>
        ) : feeds.map((f) => (
          <div key={f.id} className="card p-5 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{CHANNEL_LABEL[f.channel] ?? f.channel}</span>
              <span className="rounded bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">{f.format.toUpperCase()}</span>
              <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${f.active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}`}>{f.active ? "সক্রিয়" : "বন্ধ"}</span>
              <span className="text-xs text-slate-500">আইটেম: {f.itemCount ?? "—"} · বাদ পড়েছে: {f.skippedCount ?? "—"}</span>
              <span className="text-xs text-slate-400">শেষ তৈরি: {f.lastGeneratedAt ? new Date(f.lastGeneratedAt).toLocaleString("bn-BD") : "এখনো হয়নি"}</span>
            </div>
            <div className="flex gap-2">
              <input className="input flex-1 font-mono text-xs" readOnly value={f.url} onFocus={(e) => e.target.select()} />
              <button className="rounded-lg border px-3 py-2 text-sm font-semibold" onClick={() => copyUrl(f.url)}>কপি</button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => toggleActive(f)}>
                {busy === `active-${f.id}` ? "…" : f.active ? "বন্ধ করুন" : "সক্রিয় করুন"}
              </button>
              <button className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => showPreview(f)}>
                {busy === `preview-${f.id}` ? "প্রিভিউ আসছে…" : previewId === f.id ? "প্রিভিউ বন্ধ করুন" : "প্রিভিউ"}
              </button>
              <button className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => rotateToken(f)}>টোকেন রোটেট</button>
              <button className="rounded-lg border px-3 py-1.5 text-xs font-semibold text-rose-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => remove(f)}>মুছুন</button>
            </div>

            {previewId === f.id ? (
              <div className="space-y-3 border-t pt-3">
                {previewError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{previewError}</p> : null}
                {!preview && !previewError ? <p className="text-sm text-slate-400">প্রিভিউ লোড হচ্ছে…</p> : null}
                {preview ? (
                  <>
                    <p className="text-sm text-slate-600">
                      মোট আইটেম: <b>{preview.itemCount}</b> · বাদ পড়েছে: <b>{preview.skippedCount}</b>
                      <span className="text-xs text-slate-400"> (নিচে প্রথম {preview.items.length}টি আইটেম দেখানো হচ্ছে)</span>
                    </p>
                    {preview.warnings.length > 0 ? (
                      <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                        {preview.warnings.map((w, i) => <p key={i}>⚠️ {w}</p>)}
                      </div>
                    ) : null}
                    {preview.items.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-xs text-slate-400">
                              <th className="py-2 font-medium">ID</th><th className="py-2 font-medium">শিরোনাম</th>
                              <th className="py-2 font-medium">দাম</th><th className="py-2 font-medium">সেল দাম</th>
                              <th className="py-2 font-medium">প্রাপ্যতা</th><th className="py-2 font-medium">লিংক</th>
                            </tr>
                          </thead>
                          <tbody>
                            {preview.items.map((it) => (
                              <tr key={it.id} className="border-b last:border-0 align-top">
                                <td className="py-2 font-mono text-xs">{it.id}</td>
                                <td className="py-2">{it.title}</td>
                                <td className="py-2">{it.price}</td>
                                <td className="py-2">{it.salePrice ?? "—"}</td>
                                <td className="py-2">{it.availability}</td>
                                <td className="py-2"><a href={it.link} target="_blank" rel="noreferrer" className="text-indigo-700 underline">খুলুন</a></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : <p className="text-sm text-slate-500">প্রিভিউতে কোনো আইটেম নেই।</p>}
                    {preview.skipped.length > 0 ? (
                      <div>
                        <div className="text-sm font-medium">বাদ পড়া পণ্য ({preview.skipped.length})</div>
                        <ul className="mt-1 space-y-1 text-sm text-slate-600">
                          {preview.skipped.map((s) => (
                            <li key={s.productId}>• {s.name} — <span className="text-rose-600">{s.reasonMessage}</span> <span className="text-xs text-slate-400">({s.reason})</span></li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
