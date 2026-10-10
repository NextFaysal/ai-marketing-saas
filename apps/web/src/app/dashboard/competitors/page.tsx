"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor } from "@repo/contracts";
import { EmptyState } from "@repo/ui";

interface Competitor { id: string; name: string; facebookPageId?: string | null; websiteUrl?: string | null; stats: { ads: number; activeAds: number; priceObservations: number } }
interface Ad { id: string; externalAdId: string; pageName?: string | null; startedAt?: string | null; isActive: boolean; platforms: string[]; creativeText?: string | null; snapshotUrl?: string | null; linkUrl?: string | null }
interface Obs { id: string; productName: string; priceMinor: string; currency: string; sourceUrl: string; sourceType: string; observedAt: string }
interface Insight { id: string; kind: string; title: string; detail?: string | null; evidence: { ref: string; label: string; url?: string }[]; provider: string; createdAt: string }
interface ComparisonRow { productId: string; productName: string; ownPriceMinor: string; currency: string; competitorPrices: { competitorName: string; observedProductName: string; priceMinor: string; currency: string; diffPercent: number | null; sourceUrl: string; observedAt: string }[] }

export default function CompetitorsPage() {
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [active, setActive] = useState<Competitor | null>(null);
  const [ads, setAds] = useState<Ad[]>([]);
  const [observations, setObservations] = useState<Obs[]>([]);
  const [comparison, setComparison] = useState<ComparisonRow[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [form, setForm] = useState({ name: "", facebookPageId: "", websiteUrl: "" });
  const [obsForm, setObsForm] = useState({ productName: "", price: "", sourceUrl: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const [c, cmp, ins] = await Promise.all([
        apiFetch<Competitor[]>(`/organizations/${orgId}/competitors`),
        apiFetch<{ rows: ComparisonRow[] }>(`/organizations/${orgId}/competitors/price-comparison`),
        apiFetch<Insight[]>(`/organizations/${orgId}/competitors/insights`),
      ]);
      setCompetitors(c); setComparison(cmp.rows); setInsights(ins);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openCompetitor = useCallback(async (c: Competitor) => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setActive(c);
    const [a, o] = await Promise.all([
      apiFetch<Ad[]>(`/organizations/${orgId}/competitors/${c.id}/ads`),
      apiFetch<Obs[]>(`/organizations/${orgId}/competitors/${c.id}/observations`),
    ]);
    setAds(a); setObservations(o);
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/competitors`, { method: "POST", body: JSON.stringify({ name: form.name, facebookPageId: form.facebookPageId || undefined, websiteUrl: form.websiteUrl || undefined }) });
      setForm({ name: "", facebookPageId: "", websiteUrl: "" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  async function syncAds(c: Competitor) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`ads-${c.id}`); setError("");
    try {
      const res = await apiFetch<{ fetched: number; created: number; updated: number }>(`/organizations/${orgId}/competitors/${c.id}/sync-ads`, { method: "POST", body: JSON.stringify({}) });
      setNotice(`${c.name}: Ad Library থেকে ${res.fetched}টি বিজ্ঞাপন (নতুন ${res.created}, আপডেট ${res.updated})`);
      await load(); if (active?.id === c.id) await openCompetitor(c);
    } catch (e) { setError(e instanceof Error ? e.message : "Sync failed"); }
    finally { setBusy(""); }
  }

  async function scanWebsite(c: Competitor) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`scan-${c.id}`); setError("");
    try {
      const res = await apiFetch<{ scannedUrls: number; found: number; stored: number; skippedByRobots: string[] }>(`/organizations/${orgId}/competitors/${c.id}/scan-website`, { method: "POST" });
      setNotice(`${c.name}: ${res.scannedUrls}টি পেজ স্ক্যান, ${res.stored}টি দাম সংরক্ষিত${res.skippedByRobots.length ? `, robots.txt এর কারণে ${res.skippedByRobots.length}টি বাদ` : ""}`);
      await load(); if (active?.id === c.id) await openCompetitor(c);
    } catch (e) { setError(e instanceof Error ? e.message : "Scan failed"); }
    finally { setBusy(""); }
  }

  async function addObservation(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId || !active) return;
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/competitors/${active.id}/observations`, { method: "POST", body: JSON.stringify(obsForm) });
      setObsForm({ productName: "", price: "", sourceUrl: "" });
      await openCompetitor(active); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  async function generateInsights() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("insights"); setError("");
    try {
      const res = await apiFetch<{ generated: number; droppedWithoutEvidence: number }>(`/organizations/${orgId}/competitors/insights/generate`, { method: "POST", body: JSON.stringify({ competitorId: active?.id }) });
      setNotice(`${res.generated}টি Insight তৈরি হয়েছে${res.droppedWithoutEvidence ? `, প্রমাণহীন ${res.droppedWithoutEvidence}টি বাদ দেওয়া হয়েছে` : ""}`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  const inputCls = "input mt-1";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Competitor Analysis</h1>
        <p className="text-sm text-slate-500">
          শুধু পাবলিক ডেটা: অফিসিয়াল Meta Ad Library API ও প্রতিযোগীর নিজের পাবলিক ওয়েবসাইট (robots.txt মেনে)। প্রতিটি Observation ও Insight এর সঙ্গে Evidence (উৎস লিংক ও তারিখ) থাকে।
          Ad Library বিজ্ঞাপনের খরচ বা বিক্রি প্রকাশ করে না, তাই সেসব অনুমান এখানে করা হয় না।
        </p>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {competitors.map((c) => (
          <div key={c.id} className={`card p-4 ${active?.id === c.id ? "border-blue-500" : ""}`}>
            <button className="text-left font-semibold hover:underline" onClick={() => openCompetitor(c)}>{c.name}</button>
            <div className="mt-1 text-xs text-slate-400">বিজ্ঞাপন {c.stats.ads} (সক্রিয় {c.stats.activeAds}) · দামের Observation {c.stats.priceObservations}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" disabled={busy !== ""} onClick={() => syncAds(c)}>{busy === `ads-${c.id}` ? "Sync..." : "Ad Library Sync"}</button>
              <button className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy !== "" || !c.websiteUrl} onClick={() => scanWebsite(c)}>{busy === `scan-${c.id}` ? "Scanning..." : "ওয়েবসাইট স্ক্যান"}</button>
            </div>
          </div>
        ))}
      </div>
      {competitors.length === 0 ? <EmptyState title="কোনো Competitor যোগ করা হয়নি" description="নিচে প্রতিযোগীর নাম, Facebook Page ID ও ওয়েবসাইট দিন। Page ID পেতে Ad Library তে পেজটি খুঁজুন, URL এ ID থাকে।" /> : null}

      <form onSubmit={create} className="space-y-3 card p-5">
        <div className="font-semibold">নতুন Competitor</div>
        <div className="grid grid-cols-3 gap-3">
          <label className="block text-sm">নাম<input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
          <label className="block text-sm">Facebook Page ID<input className={inputCls} value={form.facebookPageId} onChange={(e) => setForm({ ...form, facebookPageId: e.target.value })} placeholder="1234567890" /></label>
          <label className="block text-sm">ওয়েবসাইট<input className={inputCls} value={form.websiteUrl} onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })} placeholder="https://rival-shop.com" /></label>
        </div>
        <button className="btn-primary">যোগ করুন</button>
      </form>

      {active ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card p-5">
            <div className="font-semibold">{active.name} এর বিজ্ঞাপন (Ad Library)</div>
            <div className="mt-2 max-h-96 space-y-2 overflow-y-auto">
              {ads.map((a) => (
                <div key={a.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>শুরু: {a.startedAt ? new Date(a.startedAt).toLocaleDateString() : "?"} · {a.isActive ? "সক্রিয়" : "বন্ধ"} · {a.platforms.join(", ")}</span>
                    {a.snapshotUrl ? <a className="font-semibold text-blue-600" href={a.snapshotUrl} target="_blank" rel="noreferrer">Ad Library তে দেখুন</a> : null}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap">{a.creativeText ?? "(টেক্সট নেই)"}</p>
                  {a.linkUrl ? <a className="text-xs text-blue-600" href={a.linkUrl} target="_blank" rel="noreferrer">{a.linkUrl}</a> : null}
                </div>
              ))}
              {ads.length === 0 ? <p className="text-sm text-slate-400">এখনো কোনো বিজ্ঞাপন Sync হয়নি।</p> : null}
            </div>
          </div>
          <div className="space-y-4">
            <div className="card p-5">
              <div className="font-semibold">দামের Observation</div>
              <div className="mt-2 max-h-52 space-y-2 overflow-y-auto">
                {observations.map((o) => (
                  <div key={o.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <span>{o.productName} <span className="text-xs text-slate-400">({o.sourceType}, {new Date(o.observedAt).toLocaleDateString()})</span></span>
                    <span className="font-semibold">{formatMinor(BigInt(o.priceMinor), o.currency)} <a className="ml-1 text-xs font-normal text-blue-600" href={o.sourceUrl} target="_blank" rel="noreferrer">উৎস</a></span>
                  </div>
                ))}
                {observations.length === 0 ? <p className="text-sm text-slate-400">কোনো Observation নেই। ওয়েবসাইট স্ক্যান করুন বা হাতে যোগ করুন।</p> : null}
              </div>
              <form onSubmit={addObservation} className="mt-3 grid grid-cols-3 gap-2">
                <input className="rounded-lg border px-2 py-1.5 text-sm" placeholder="প্রোডাক্টের নাম" value={obsForm.productName} onChange={(e) => setObsForm({ ...obsForm, productName: e.target.value })} required />
                <input className="rounded-lg border px-2 py-1.5 text-sm" placeholder="দাম" value={obsForm.price} onChange={(e) => setObsForm({ ...obsForm, price: e.target.value })} required />
                <input className="rounded-lg border px-2 py-1.5 text-sm" placeholder="উৎস URL (বাধ্যতামূলক)" value={obsForm.sourceUrl} onChange={(e) => setObsForm({ ...obsForm, sourceUrl: e.target.value })} required />
                <button className="col-span-3 rounded-lg border px-3 py-1.5 text-sm font-semibold">Observation যোগ করুন</button>
              </form>
            </div>
          </div>
        </div>
      ) : null}

      <div className="card p-5">
        <div className="font-semibold">আপনার দাম বনাম প্রতিযোগী (নাম মিলিয়ে)</div>
        <p className="text-xs text-slate-400">মিল পাওয়া যায়নি মানে আমাদের কাছে সেই প্রতিযোগীর দামের কোনো Evidence নেই, অনুমান করে কিছু দেখানো হয় না।</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2">আপনার প্রোডাক্ট</th><th className="px-3 py-2">আপনার দাম</th><th className="px-3 py-2">প্রতিযোগীর দাম</th><th className="px-3 py-2">পার্থক্য</th><th className="px-3 py-2">Evidence</th></tr></thead>
            <tbody>
              {comparison.map((row) => row.competitorPrices.length ? row.competitorPrices.map((cp, i) => (
                <tr key={`${row.productId}-${i}`} className="border-t">
                  <td className="px-3 py-2">{i === 0 ? row.productName : ""}</td>
                  <td className="px-3 py-2">{i === 0 ? formatMinor(BigInt(row.ownPriceMinor), row.currency) : ""}</td>
                  <td className="px-3 py-2">{cp.competitorName}: {formatMinor(BigInt(cp.priceMinor), cp.currency)}</td>
                  <td className={`px-3 py-2 font-semibold ${cp.diffPercent === null ? "" : cp.diffPercent < 0 ? "text-red-600" : "text-green-600"}`}>{cp.diffPercent === null ? "—" : `${cp.diffPercent}%`}</td>
                  <td className="px-3 py-2"><a className="text-blue-600" href={cp.sourceUrl} target="_blank" rel="noreferrer">{new Date(cp.observedAt).toLocaleDateString()} এর পেজ</a></td>
                </tr>
              )) : (
                <tr key={row.productId} className="border-t">
                  <td className="px-3 py-2">{row.productName}</td>
                  <td className="px-3 py-2">{formatMinor(BigInt(row.ownPriceMinor), row.currency)}</td>
                  <td className="px-3 py-2 text-slate-400" colSpan={3}>প্রতিযোগীর দামের Evidence নেই</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between">
          <div className="font-semibold">Insights {active ? `(${active.name})` : "(সব Competitor)"}</div>
          <button className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={generateInsights}>{busy === "insights" ? "তৈরি হচ্ছে..." : "Insight তৈরি করুন"}</button>
        </div>
        <div className="mt-3 space-y-2">
          {insights.map((ins) => (
            <div key={ins.id} className="rounded-lg bg-slate-50 p-3">
              <div className="text-sm font-medium">{ins.title} <span className="ml-1 rounded bg-white px-1.5 py-0.5 text-[11px] text-slate-500">{ins.kind} · {ins.provider === "dev-template" ? "Dev Template" : ins.provider}</span></div>
              {ins.detail ? <p className="mt-0.5 text-sm text-slate-500">{ins.detail}</p> : null}
              <div className="mt-1 text-xs text-slate-400">Evidence: {ins.evidence.map((e, i) => <span key={i}>{i > 0 ? " · " : ""}{e.url ? <a className="text-blue-600" href={e.url} target="_blank" rel="noreferrer">{e.label}</a> : e.label}</span>)}</div>
            </div>
          ))}
          {insights.length === 0 ? <p className="text-sm text-slate-400">এখনো কোনো Insight নেই। আগে Ads Sync বা দাম সংগ্রহ করুন, তারপর Insight তৈরি করুন।</p> : null}
        </div>
      </div>
    </div>
  );
}
