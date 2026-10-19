"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { useConfirm, useToast } from "@repo/ui/client";

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
  const { dict, t, locale } = useLocale();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [analytics, setAnalytics] = useState<SearchAnalytics | null>(null);
  const [synonyms, setSynonyms] = useState<Synonym[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [expansions, setExpansions] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setLoading(false); setError(dict.commerce.noOrganizationSelected); return; }
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
      setError(e instanceof Error ? e.message : dict.commerce.loadingFailed);
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
    setError("");
  }

  async function saveSynonym() {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!term.trim()) { setError(dict.commerce.giveATerm); return; }
    setBusy("synonym"); setError("");
    const body = { term: term.trim(), expansions: parseList(expansions) };
    try {
      if (editingId) {
        await apiFetch(`/organizations/${orgId}/storefront/search/synonyms/${editingId}`, {
          method: "PATCH", body: JSON.stringify(body),
        });
        toast({ title: dict.commerce.synonymUpdated, tone: "success" });
      } else {
        await apiFetch(`/organizations/${orgId}/storefront/search/synonyms`, {
          method: "POST", body: JSON.stringify(body),
        });
        toast({ title: dict.commerce.newSynonymAdded, tone: "success" });
      }
      resetForm();
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.saveFailed); }
    finally { setBusy(""); }
  }

  async function deleteSynonym(s: Synonym) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!(await confirm({ title: t("commerce.deleteTheSynonym", { term: s.term }), danger: true, confirmLabel: dict.commerce.delete2 }))) return;
    setBusy(`del-${s.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/storefront/search/synonyms/${s.id}`, { method: "DELETE" });
      toast({ title: dict.commerce.synonymDeleted, tone: "success" });
      if (editingId === s.id) resetForm();
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.deleteFailed); }
    finally { setBusy(""); }
  }

  async function reindex() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("reindex"); setError("");
    try {
      const out = await apiFetch<{ updated: number }>(`/organizations/${orgId}/storefront/search/reindex`, { method: "POST" });
      toast({ title: t("commerce.searchReindexCompleteProductsUpdated", { out: out.updated ?? 0 }), tone: "success" });
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.reindexFailed); }
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
                <th className="py-2 pr-3 font-semibold">{dict.commerce.term}</th>
                <th className="py-2 text-right font-semibold">{dict.commerce.times}</th>
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
          <h1 className="page-title">{dict.commerce.shopSearchAnalyticsSynonyms}</h1>
          <p className="text-sm text-slate-500">
            {dict.commerce.theShopSSearchIs}</p>
        </div>
        <Link href="/dashboard/commerce/storefront" className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">{dict.commerce.storefrontSettings}</Link>
      </div>

      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      {loading ? <p className="text-sm text-slate-400">{dict.common.loading}</p> : null}

      {analytics ? (
        <>
          <div className="card flex flex-wrap items-center gap-3 p-5">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{dict.commerce.searchAnalyticsLast}{analytics.windowDays} {dict.commerce.days5}</div>
              <p className="text-sm text-slate-500">{dict.commerce.totalSearches}<b>{analytics.totalSearches}</b></p>
            </div>
            <button type="button" onClick={reindex} disabled={busy !== ""} className="btn-primary disabled:opacity-50">
              {busy === "reindex" ? dict.commerce.reindexing : dict.commerce.reindexSearch}
            </button>
          </div>
          <div className="grid items-start gap-6 lg:grid-cols-2">
            {termsTable(dict.commerce.topSearches, analytics.topTerms ?? [], dict.commerce.noSearchesInThisPeriod)}
            {termsTable(dict.commerce.zeroResultSearches, analytics.zeroResultTerms ?? [], dict.commerce.noZeroResultSearchesGood)}
          </div>
        </>
      ) : null}

      <section className="card space-y-4 p-5">
        <div>
          <div className="font-semibold">{dict.commerce.synonyms}</div>
          <p className="text-sm text-slate-500">
            {dict.commerce.whenAlternativeWordsAreAdded}</p>
        </div>
        {synonyms.length === 0 ? (
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">{dict.commerce.noSynonymsYetAddBelow}</p>
        ) : (
          <ul className="space-y-2">
            {synonyms.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
                <span className="font-semibold">{s.term}</span>
                <span className="text-sm text-slate-500">→ {expansionsOf(s).join(", ") || "—"}</span>
                <span className="ml-auto flex gap-1.5">
                  <button type="button" onClick={() => startEdit(s)} className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold">{dict.commerce.edit}</button>
                  <button type="button" disabled={busy !== ""} onClick={() => void deleteSynonym(s)} className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold text-rose-600 disabled:opacity-50">{dict.commerce.delete}</button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-3 border-t pt-4 md:grid-cols-2">
          <label className="block text-sm">{dict.commerce.term2}<input className="input mt-1" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={dict.commerce.eGSaree} />
          </label>
          <label className="block text-sm">{dict.commerce.expansionsSeparateWithCommas}<input className="input mt-1" value={expansions} onChange={(e) => setExpansions(e.target.value)} placeholder={dict.commerce.sareeSari} />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={saveSynonym} disabled={busy === "synonym" || !term.trim()} className="btn-primary disabled:opacity-50">
            {busy === "synonym" ? dict.commerce.saving : editingId ? dict.commerce.updateSynonym : dict.commerce.addSynonym}
          </button>
          {editingId ? (
            <button type="button" onClick={resetForm} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold">{dict.common.cancel}</button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
