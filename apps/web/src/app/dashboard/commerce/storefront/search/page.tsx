"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

// AB6 (AX11) — staff shop-search page. Consumes:
//   GET    /organizations/:id/storefront/search/analytics
//   GET    /organizations/:id/storefront/search/synonyms   -> { synonyms[] }
//   POST   /organizations/:id/storefront/search/synonyms
//   PATCH  /organizations/:id/storefront/search/synonyms/:synonymId
//   DELETE /organizations/:id/storefront/search/synonyms/:synonymId
//   POST   /organizations/:id/storefront/search/reindex   -> { updated }
// Honest framing: shop search is keyword / full-text (FTS)
// based — "স্মার্ট সার্চ" here means পূর্ণ-টেক্সট অনুসন্ধান.

interface SearchAnalytics {
  windowDays: number;
  totalSearches: number;
  topTerms: { term: string; count: number }[];
  zeroResultTerms: { term: string; count: number }[];
}

interface Synonym {
  id: string;
  term: string;
  expansions?: string[];
  synonyms?: string[];
}

function expansionsOf(s: Synonym): string[] {
  return s.expansions ?? s.synonyms ?? [];
}
function parseList(text: string): string[] {
  return text.split(",").map((s) => s.trim()).filter(Boolean);
}

export default function StorefrontSearchPage() {
  const [analytics, setAnalytics] = useState<SearchAnalytics | null>(null);
  const [synonyms, setSynonyms] = useState<Synonym[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [expansions, setExpansions] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setLoading(false); setError("কোনো Organization নির্বাচিত নেই।"); return; }
    setLoading(true);
    try {
      const [a, s] = await Promise.all([
        apiFetch<SearchAnalytics>(`/organizations/${orgId}/storefront/search/analytics`),
        apiFetch<any>(`/organizations/${orgId}/storefront/search/synonyms`).catch(() => ({ synonyms: [] })),
      ]);
      setAnalytics(a);
      setSynonyms((Array.isArray(s) ? s : s?.synonyms ?? s?.items ?? []) as Synonym[]);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "লোড ব্যর্থ");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function resetForm() {
    setEditingId(null); setTerm(""); setExpansions("");
  }
  function startEdit(s: Synonym) {
    setEditingId(s.id);
    setTerm(s.term ?? "");
    setExpansions(expansionsOf(s).join(", "));
    setError(""); setNotice("");
  }

  async function saveSynonym() {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!term.trim()) { setError("শব্দ (term) দিন।"); return; }
    setBusy("synonym"); setError(""); setNotice("");
    const body = { term: term.trim(), expansions: parseList(expansions) };
    try {
      if (editingId) {
        await apiFetch(`/organizations/${orgId}/storefront/search/synonyms/${editingId}`, {
          method: "PATCH", body: JSON.stringify(body),
        });
        setNotice("সমার্থক শব্দ আপডেট হয়েছে।");
      } else {
        await apiFetch(`/organizations/${orgId}/storefront/search/synonyms`, {
          method: "POST", body: JSON.stringify(body),
        });
        setNotice("নতুন সমার্থক শব্দ যোগ হয়েছে।");
      }
      resetForm();
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "সংরক্ষণ ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function deleteSynonym(s: Synonym) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(`"${s.term}" সমার্থক শব্দটি মুছে ফেলবেন?`)) return;
    setBusy(`del-${s.id}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/storefront/search/synonyms/${s.id}`, { method: "DELETE" });
      setNotice("সমার্থক শব্দ মুছে ফেলা হয়েছে।");
      if (editingId === s.id) resetForm();
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "মুছে ফেলা ব্যর্থ"); }
    finally { setBusy(""); }
  }

  async function reindex() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("reindex"); setError(""); setNotice("");
    try {
      const out = await apiFetch<{ updated: number }>(`/organizations/${orgId}/storefront/search/reindex`, { method: "POST" });
      setNotice(`সার্চ পুনঃসূচী সম্পন্ন — ${out.updated ?? 0}টি পণ্য আপডেট হয়েছে।`);
    } catch (e) { setError(e instanceof Error ? e.message : "পুনঃসূচী ব্যর্থ"); }
    finally { setBusy(""); }
  }

  function termsTable(title: string, rows: { term: string; count: number }[], emptyText: string) {
    return (
      <div className="card space-y-3 p-5">
        <div className="font-semibold">{title}</div>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">{emptyText}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-slate-500">
                <th className="py-2 pr-3 font-semibold">শব্দ</th>
                <th className="py-2 text-right font-semibold">বার</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.term} className="border-b last:border-0">
                  <td className="py-2 pr-3">{r.term}</td>
                  <td className="py-2 text-right font-mono font-semibold">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">দোকানের সার্চ — বিশ্লেষণ ও সমার্থক শব্দ</h1>
          <p className="text-sm text-slate-500">
            দোকানের সার্চ কীওয়ার্ড / পূর্ণ-টেক্সট অনুসন্ধান (FTS) ভিত্তিক — এখানে &ldquo;স্মার্ট সার্চ&rdquo; বলতে
            পূর্ণ-টেক্সট অনুসন্ধানই বোঝানো হয়েছে। ক্রেতারা কী খুঁজছেন এবং কোন খোঁজে কোনো ফল আসছে না, তা এখানে দেখুন।
          </p>
        </div>
        <Link href="/dashboard/commerce/storefront" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">← Storefront সেটিংস</Link>
      </div>

      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      {loading ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : null}

      {analytics ? (
        <>
          <div className="card flex flex-wrap items-center gap-3 p-5">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">সার্চ বিশ্লেষণ (শেষ {analytics.windowDays} দিন)</div>
              <p className="text-sm text-slate-500">মোট সার্চ: <b>{analytics.totalSearches}</b></p>
            </div>
            <button type="button" onClick={reindex} disabled={busy !== ""} className="btn-primary disabled:opacity-50">
              {busy === "reindex" ? "পুনঃসূচী হচ্ছে…" : "সার্চ পুনঃসূচী"}
            </button>
          </div>
          <div className="grid items-start gap-6 lg:grid-cols-2">
            {termsTable("শীর্ষ সার্চ", analytics.topTerms ?? [], "এই সময়ে কোনো সার্চ হয়নি।")}
            {termsTable("শূন্য-ফলাফলের সার্চ", analytics.zeroResultTerms ?? [], "কোনো শূন্য-ফলাফলের সার্চ নেই — ভালো খবর!")}
          </div>
        </>
      ) : null}

      <section className="card space-y-4 p-5">
        <div>
          <div className="font-semibold">সমার্থক শব্দ (synonyms)</div>
          <p className="text-sm text-slate-500">
            একটি শব্দের সাথে বিকল্প শব্দ যোগ করলে, ক্রেতা যেকোনো একটি দিয়ে খুঁজলেই সংশ্লিষ্ট পণ্য পাওয়া যাবে।
            যেমন: term &ldquo;শাড়ি&rdquo;, বিস্তার &ldquo;saree, শাড়ী&rdquo;।
          </p>
        </div>
        {synonyms.length === 0 ? (
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">এখনো কোনো সমার্থক শব্দ নেই — নিচে যোগ করুন।</p>
        ) : (
          <ul className="space-y-2">
            {synonyms.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
                <span className="font-semibold">{s.term}</span>
                <span className="text-sm text-slate-500">→ {expansionsOf(s).join(", ") || "—"}</span>
                <span className="ml-auto flex gap-1.5">
                  <button type="button" onClick={() => startEdit(s)} className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold">সম্পাদনা</button>
                  <button type="button" disabled={busy !== ""} onClick={() => void deleteSynonym(s)} className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold text-rose-600 disabled:opacity-50">মুছুন</button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-3 border-t pt-4 md:grid-cols-2">
          <label className="block text-sm">শব্দ (term) *
            <input className="input mt-1" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="যেমন: শাড়ি" />
          </label>
          <label className="block text-sm">বিস্তার (expansions — কমা দিয়ে আলাদা করুন)
            <input className="input mt-1" value={expansions} onChange={(e) => setExpansions(e.target.value)} placeholder="saree, শাড়ী" />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={saveSynonym} disabled={busy === "synonym" || !term.trim()} className="btn-primary disabled:opacity-50">
            {busy === "synonym" ? "সংরক্ষণ হচ্ছে…" : editingId ? "সমার্থক শব্দ আপডেট করুন" : "সমার্থক শব্দ যোগ করুন"}
          </button>
          {editingId ? (
            <button type="button" onClick={resetForm} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">বাতিল</button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
