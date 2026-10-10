"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { EmptyState } from "@repo/ui";

interface Account { id: string; name: string; platform: string; integrationId?: string | null }
interface Audience { id: string; name: string; kind: string; source: string; sourceDetail?: string | null; externalAudienceId?: string | null; approximateCount?: number | null; status: string; error?: string | null; lastMembershipSyncAt?: string | null; lastMembershipCount?: number | null }
interface Saved { id: string; name: string; targeting: Record<string, unknown> }
interface Catalog { id: string; name: string; externalCatalogId: string; status: string; lastSyncAt?: string | null; lastSyncSummary?: { pushed: number; errors: number; total: number } | null }

const SEGMENTS = ["champions", "loyal", "big_spenders", "at_risk", "lost", "new", "regular"];

export default function AudiencesPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  interface ProductSetRow { id: string; name: string; category?: string | null; memberCount: number; maxPriceMinor?: string | null; status?: string; externalSetId?: string | null; error?: string | null }
  const [setsByCatalog, setSetsByCatalog] = useState<Record<string, ProductSetRow[]>>({});
  const [setForm, setSetForm] = useState({ name: "", category: "", maxPrice: "" });
  async function loadSets(catalogId: string) {
    if (!orgId) return;
    const rows = await apiFetch<ProductSetRow[]>(`/organizations/${orgId}/catalogs/${catalogId}/product-sets`).catch(() => []);
    setSetsByCatalog((prev) => ({ ...prev, [catalogId]: rows }));
  }
  const [custom, setCustom] = useState({ adAccountId: "", name: "", source: "customers", segment: "champions" });
  const [look, setLook] = useState({ adAccountId: "", name: "", sourceAudienceRecordId: "", country: "BD", ratio: "0.01" });
  const [savedForm, setSavedForm] = useState({ name: "", targeting: "{\"countries\":[\"BD\"],\"ageMin\":18,\"ageMax\":45}" });
  const [catForm, setCatForm] = useState({ name: "", businessId: "", externalCatalogId: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const orgId = typeof window !== "undefined" ? getOrganizationId() : null;

  const load = useCallback(async () => {
    if (!orgId) return;
    const list = await apiFetch<Account[]>(`/organizations/${orgId}/ad-accounts`).catch(() => []);
    const meta = list.filter((a) => a.platform === "meta" && a.integrationId);
    setAccounts(meta);
    if (meta[0]) { setCustom((f) => ({ ...f, adAccountId: f.adAccountId || meta[0].id })); setLook((f) => ({ ...f, adAccountId: f.adAccountId || meta[0].id })); }
    setAudiences(await apiFetch<Audience[]>(`/organizations/${orgId}/audiences`).catch(() => []));
    setSaved(await apiFetch<Saved[]>(`/organizations/${orgId}/audiences/saved/list`).catch(() => []));
    setCatalogs(await apiFetch<Catalog[]>(`/organizations/${orgId}/catalogs`).catch(() => []));
  }, [orgId]);
  useEffect(() => { load(); }, [load]);

  async function run(key: string, fn: () => Promise<unknown>, okMsg: string) {
    setBusy(key); setError("");
    try { await fn(); setNotice(okMsg); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
    finally { setBusy(""); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">👥 Audiences ও Catalog</h1>
        <p className="text-sm text-slate-500">নিজের Customer/Lead ডেটা থেকে Meta Custom Audience বানান (কন্টাক্ট শুধু SHA-256 হ্যাশ হয়ে যায়), Lookalike তৈরি করুন, Targeting প্রিসেট সেভ রাখুন এবং প্রোডাক্ট Catalog এ পাঠান। Audience এর সাইজ Meta র নিজের <b>approximate_count</b> — আমরা অনুমান করি না।</p>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <form className="card space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); run("custom", () => apiFetch(`/organizations/${orgId}/audiences/custom`, { method: "POST", body: JSON.stringify({ ...custom, segment: custom.source === "rfm_segment" ? custom.segment : undefined }) }), "Custom Audience তৈরির অনুরোধ Meta গ্রহণ করেছে। Status Refresh করে সাইজ দেখুন।"); }}>
          <div className="font-semibold">নতুন Custom Audience</div>
          <label className="block text-sm">নাম<input className="input mt-1" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} required placeholder="যেমন: All Buyers 2026" /></label>
          <label className="block text-sm">Ad Account
            <select className="input mt-1" value={custom.adAccountId} onChange={(e) => setCustom({ ...custom, adAccountId: e.target.value })}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="block text-sm">সূত্র
            <select className="input mt-1" value={custom.source} onChange={(e) => setCustom({ ...custom, source: e.target.value })}>
              <option value="customers">সব Customer</option>
              <option value="leads">সব Lead</option>
              <option value="rfm_segment">RFM Segment এর Customer</option>
            </select>
          </label>
          {custom.source === "rfm_segment" ? (
            <label className="block text-sm">Segment
              <select className="input mt-1" value={custom.segment} onChange={(e) => setCustom({ ...custom, segment: e.target.value })}>
                {SEGMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          ) : null}
          <button className="btn-primary" disabled={busy !== "" || accounts.length === 0}>{busy === "custom" ? "তৈরি হচ্ছে..." : "Audience তৈরি করুন"}</button>
        </form>

        <form className="card space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); run("look", () => apiFetch(`/organizations/${orgId}/audiences/lookalike`, { method: "POST", body: JSON.stringify({ ...look, ratio: Number(look.ratio) }) }), "Lookalike তৈরির অনুরোধ পাঠানো হয়েছে।"); }}>
          <div className="font-semibold">নতুন Lookalike Audience</div>
          <label className="block text-sm">নাম<input className="input mt-1" value={look.name} onChange={(e) => setLook({ ...look, name: e.target.value })} required placeholder="যেমন: Buyers Lookalike 1% BD" /></label>
          <label className="block text-sm">Source Audience
            <select className="input mt-1" value={look.sourceAudienceRecordId} onChange={(e) => setLook({ ...look, sourceAudienceRecordId: e.target.value })} required>
              <option value="">— বেছে নিন —</option>
              {audiences.filter((a) => a.externalAudienceId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm">দেশ<input className="input mt-1" value={look.country} onChange={(e) => setLook({ ...look, country: e.target.value })} placeholder="BD" /></label>
            <label className="block text-sm">Ratio (0.01–0.20)<input className="input mt-1" value={look.ratio} onChange={(e) => setLook({ ...look, ratio: e.target.value })} placeholder="0.01" /></label>
          </div>
          <button className="btn-primary" disabled={busy !== "" || accounts.length === 0}>{busy === "look" ? "তৈরি হচ্ছে..." : "Lookalike তৈরি করুন"}</button>
        </form>
      </div>

      {audiences.length === 0 ? (
        <EmptyState title="এখনো কোনো Audience নেই" description="উপরের ফর্ম দিয়ে প্রথম Custom Audience বানান।" />
      ) : (
        <div className="overflow-hidden card">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500"><tr><th className="px-4 py-3">নাম</th><th className="px-4 py-3">ধরন / সূত্র</th><th className="px-4 py-3">Meta ID</th><th className="px-4 py-3">আকার (Meta)</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead>
            <tbody>{audiences.map((a) => (
              <tr key={a.id} className="border-t">
                <td className="px-4 py-3 font-medium">{a.name}</td>
                <td className="px-4 py-3">{a.kind} · {a.source}{a.sourceDetail ? ` (${a.sourceDetail})` : ""}</td>
                <td className="px-4 py-3">{a.externalAudienceId ?? "—"}</td>
                <td className="px-4 py-3">{a.approximateCount != null ? a.approximateCount.toLocaleString() : "—"}</td>
                <td className="px-4 py-3">{a.status}{a.error ? <span className="block text-xs text-red-600">{a.error}</span> : null}</td>
                <td className="px-4 py-3">{a.externalAudienceId ? <span className="flex flex-wrap gap-1"><button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => run(`ref-${a.id}`, () => apiFetch(`/organizations/${orgId}/audiences/${a.id}/refresh`, { method: "POST" }), "Status হালনাগাদ হয়েছে।")}>Refresh</button>{a.kind === "custom" ? <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => run(`mem-${a.id}`, () => apiFetch(`/organizations/${orgId}/audiences/${a.id}/refresh-members`, { method: "POST" }), "সদস্য তালিকা Meta তে আপডেট পাঠানো হয়েছে।")}>👥 সদস্য আপডেট{a.lastMembershipSyncAt ? ` (${a.lastMembershipCount ?? "?"}টি · ${new Date(a.lastMembershipSyncAt).toLocaleDateString("bn-BD")})` : ""}</button> : null}</span> : null}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3 p-5">
          <div className="font-semibold">💾 Saved Targeting প্রিসেট</div>
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); let parsed: unknown; try { parsed = JSON.parse(savedForm.targeting); } catch { setError("Targeting JSON ঠিক নয়"); return; } run("saved", () => apiFetch(`/organizations/${orgId}/audiences/saved`, { method: "POST", body: JSON.stringify({ name: savedForm.name, targeting: parsed }) }), "প্রিসেট সেভ হয়েছে।"); }}>
            <input className="input" placeholder="প্রিসেটের নাম" value={savedForm.name} onChange={(e) => setSavedForm({ ...savedForm, name: e.target.value })} required />
            <textarea className="input font-mono text-xs" rows={3} value={savedForm.targeting} onChange={(e) => setSavedForm({ ...savedForm, targeting: e.target.value })} />
            <button className="btn-secondary btn-sm" disabled={busy !== ""}>সেভ করুন</button>
          </form>
          <ul className="space-y-1 text-sm">
            {saved.map((s) => <li key={s.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"><span>{s.name}</span><span className="text-xs text-slate-400">{Object.keys(s.targeting).join(", ")}</span></li>)}
          </ul>
        </div>

        <div className="card space-y-3 p-5">
          <div className="font-semibold">🛍️ Meta Product Catalog</div>
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (catForm.externalCatalogId) { run("cat", () => apiFetch(`/organizations/${orgId}/catalogs/register`, { method: "POST", body: JSON.stringify({ name: catForm.name, externalCatalogId: catForm.externalCatalogId }) }), "Catalog যুক্ত হয়েছে।"); } else { run("cat", () => apiFetch(`/organizations/${orgId}/catalogs`, { method: "POST", body: JSON.stringify({ name: catForm.name, businessId: catForm.businessId }) }), "Catalog তৈরি হয়েছে।"); } }}>
            <input className="input" placeholder="Catalog এর নাম" value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} required />
            <input className="input" placeholder="Business ID (নতুন Catalog বানাতে)" value={catForm.businessId} onChange={(e) => setCatForm({ ...catForm, businessId: e.target.value })} />
            <input className="input" placeholder="অথবা বিদ্যমান Catalog ID (Commerce Manager থেকে)" value={catForm.externalCatalogId} onChange={(e) => setCatForm({ ...catForm, externalCatalogId: e.target.value })} />
            <button className="btn-secondary btn-sm" disabled={busy !== ""}>{busy === "cat" ? "হচ্ছে..." : "Catalog যোগ করুন"}</button>
          </form>
          <ul className="space-y-2 text-sm">
            {catalogs.map((c) => (
              <li key={c.id} className="rounded-lg bg-slate-50 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{c.name}</span>
                  <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => run(`push-${c.id}`, () => apiFetch(`/organizations/${orgId}/catalogs/${c.id}/push-products`, { method: "POST" }), "প্রোডাক্ট পাঠানো হয়েছে — সারসংক্ষেপ দেখুন।")}>{busy === `push-${c.id}` ? "পাঠাচ্ছে..." : "প্রোডাক্ট Push করুন"}</button>
                </div>
                <div className="mt-2 space-y-1">
                  <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => loadSets(c.id)}>📦 Product Sets দেখুন</button>
                  {(setsByCatalog[c.id] ?? []).map((s) => (
                    <div key={s.id} className="flex items-center justify-between rounded bg-white px-2 py-1 text-xs">
                      <span>{s.name}{s.category ? ` · ${s.category}` : ""} · <b>{s.memberCount}টি পণ্য</b> (আসল ক্যাটালগ থেকে গণনা)
                        {s.status === "created" && s.externalSetId ? <span className="text-green-600"> · 🌐 Meta তে তৈরি (ID: {s.externalSetId})</span> : s.status === "failed" ? <span className="text-red-600"> · Meta ব্যর্থ: {s.error}</span> : <span className="text-slate-400"> · শুধু লোকাল</span>}
                      </span>
                      <span className="flex gap-2">
                        {s.status !== "created" ? <button className="text-indigo-600" disabled={busy !== ""} onClick={() => run(`pubset-${s.id}`, () => apiFetch(`/organizations/${orgId}/catalogs/${c.id}/product-sets/${s.id}/publish`, { method: "POST" }), "সেট Meta তে তৈরি হয়েছে").then(() => loadSets(c.id))}>🌐 Meta তে তৈরি করুন</button> : null}
                        <button className="text-red-600" disabled={busy !== ""} onClick={() => run(`delset-${s.id}`, () => apiFetch(`/organizations/${orgId}/catalogs/${c.id}/product-sets/${s.id}`, { method: "DELETE" }), "সেট মোছা হয়েছে").then(() => loadSets(c.id))}>মুছুন</button>
                      </span>
                    </div>
                  ))}
                  <form className="flex flex-wrap gap-1" onSubmit={(e) => { e.preventDefault(); run(`newset-${c.id}`, () => apiFetch(`/organizations/${orgId}/catalogs/${c.id}/product-sets`, { method: "POST", body: JSON.stringify({ name: setForm.name, category: setForm.category || undefined, maxPriceMajor: setForm.maxPrice || undefined }) }), "Product Set তৈরি হয়েছে").then(() => { setSetForm({ name: "", category: "", maxPrice: "" }); loadSets(c.id); }); }}>
                    <input className="input w-32" placeholder="সেটের নাম" value={setForm.name} onChange={(e) => setSetForm({ ...setForm, name: e.target.value })} required />
                    <input className="input w-28" placeholder="Category (ঐচ্ছিক)" value={setForm.category} onChange={(e) => setSetForm({ ...setForm, category: e.target.value })} />
                    <input className="input w-28" placeholder="সর্বোচ্চ দাম (ঐচ্ছিক)" value={setForm.maxPrice} onChange={(e) => setSetForm({ ...setForm, maxPrice: e.target.value })} />
                    <button className="btn-secondary btn-sm" disabled={busy !== ""}>+ সেট</button>
                  </form>
                </div>
                <p className="text-xs text-slate-400">ID: {c.externalCatalogId}{c.lastSyncSummary ? ` · শেষ Push: ${c.lastSyncSummary.pushed}/${c.lastSyncSummary.total} সফল, ${c.lastSyncSummary.errors} এরর` : ""}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
