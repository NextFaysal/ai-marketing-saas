"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { EmptyState } from "@repo/ui";
import { useLocale } from "@/lib/i18n/provider";
import { fmtDate, fmtDateTime, fmtNumber } from "@repo/contracts";

interface Account { id: string; name: string; platform: string; integrationId?: string | null }
interface Audience { id: string; adAccountId?: string; name: string; kind: string; source: string; sourceDetail?: string | null; externalAudienceId?: string | null; approximateCount?: number | null; status: string; error?: string | null; lastMembershipSyncAt?: string | null; lastMembershipCount?: number | null }
interface Saved { id: string; name: string; targeting: Record<string, unknown> }
interface Catalog {
  id: string; name: string; externalCatalogId: string; status: string; lastSyncAt?: string | null;
  lastSyncSummary?: { pushed: number; errors: number; total: number } | null;
  // AB5 (AX10): auto-sync opt-in + staff-entered Page / IG link.
  autoSync?: boolean;
  pageId?: string | null; pageName?: string | null;
  instagramId?: string | null; instagramName?: string | null;
}
/** AB5 (AX10): GET catalogs/:id/sync-status shape. */
interface CatalogSyncStatus {
  autoSync: boolean;
  counts: { pending: number; failed: number; done: number };
  lastSyncAt: string | null;
  lastSyncSummary: unknown;
}

const SEGMENTS = ["champions", "loyal", "big_spenders", "at_risk", "lost", "new", "regular"];

export default function AudiencesPage() {
  const { t, locale } = useLocale();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  interface ProductSetRow { id: string; name: string; category?: string | null; memberCount: number; maxPriceMinor?: string | null; status?: string; externalSetId?: string | null; error?: string | null }
  const [setsByCatalog, setSetsByCatalog] = useState<Record<string, ProductSetRow[]>>({});
  // AB5 (AX10): per-catalog auto-sync status (queue counts +
  // last-sync stamp), fetched from the sync-status endpoint.
  const [syncByCatalog, setSyncByCatalog] = useState<Record<string, CatalogSyncStatus>>({});
  const [syncBusy, setSyncBusy] = useState("");
  async function loadSyncStatus(catalogId: string) {
    if (!orgId) return;
    setSyncBusy(catalogId);
    try {
      const s = await apiFetch<CatalogSyncStatus>(`/organizations/${orgId}/catalogs/${catalogId}/sync-status`);
      setSyncByCatalog((prev) => ({ ...prev, [catalogId]: s }));
    } catch { /* the card keeps its last known status */ }
    finally { setSyncBusy(""); }
  }
  async function toggleAutoSync(c: Catalog, next: boolean) {
    if (!orgId) return;
    // Optimistic: flip locally first, revert on error.
    setCatalogs((prev) => prev.map((x) => (x.id === c.id ? { ...x, autoSync: next } : x)));
    setSyncByCatalog((prev) => (prev[c.id] ? { ...prev, [c.id]: { ...prev[c.id], autoSync: next } } : prev));
    try {
      await apiFetch(`/organizations/${orgId}/catalogs/${c.id}`, {
        method: "PATCH", body: JSON.stringify({ autoSync: next }),
      });
      setNotice(next ? t("crm.audAutoSyncOn") : t("crm.audAutoSyncOff"));
    } catch (err) {
      setCatalogs((prev) => prev.map((x) => (x.id === c.id ? { ...x, autoSync: !next } : x)));
      setSyncByCatalog((prev) => (prev[c.id] ? { ...prev, [c.id]: { ...prev[c.id], autoSync: !next } } : prev));
      setError(err instanceof Error ? err.message : t("crm.audAutoSyncFailed"));
    }
  }
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
    // OU4: Custom Audience now Meta + Google (Customer Match) +
    // TikTok — connected accounts of all three platforms can be chosen.
    const connected = list.filter((a) => ["meta", "google", "tiktok"].includes(a.platform) && a.integrationId);
    setAccounts(connected);
    if (connected[0]) { setCustom((f) => ({ ...f, adAccountId: f.adAccountId || connected[0].id })); }
    // Lookalike is only created via API on Meta + TikTok — a Google
    // account is never the Lookalike default.
    const lookDefault = connected.find((a) => a.platform === "meta" || a.platform === "tiktok");
    if (lookDefault) { setLook((f) => ({ ...f, adAccountId: f.adAccountId || lookDefault.id })); }
    setAudiences(await apiFetch<Audience[]>(`/organizations/${orgId}/audiences`).catch(() => []));
    setSaved(await apiFetch<Saved[]>(`/organizations/${orgId}/audiences/saved/list`).catch(() => []));
    const cats = await apiFetch<Catalog[]>(`/organizations/${orgId}/catalogs`).catch(() => []);
    setCatalogs(cats);
    // AB5 (AX10): each catalog's sync status rides its own endpoint.
    for (const c of cats) {
      apiFetch<CatalogSyncStatus>(`/organizations/${orgId}/catalogs/${c.id}/sync-status`)
        .then((s) => setSyncByCatalog((prev) => ({ ...prev, [c.id]: s })))
        .catch(() => undefined);
    }
  }, [orgId]);
  useEffect(() => { load(); }, [load]);

  async function run(key: string, fn: () => Promise<unknown>, okMsg: string) {
    setBusy(key); setError("");
    try { await fn(); setNotice(okMsg); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
    finally { setBusy(""); }
  }

  // OU4: AudienceRecord has no Platform column — the platform comes
  // from the record's Ad Account (joined with the accounts loaded on the page).
  const platformLabel = (p?: string) => (p === "google" ? "Google" : p === "tiktok" ? "TikTok" : p === "meta" ? "Meta" : "—");
  const accountPlatform = (id?: string) => accounts.find((a) => a.id === id)?.platform;
  const lookPlatform = accountPlatform(look.adAccountId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{t("crm.audTitle")}</h1>
        <p className="text-sm text-slate-500">{t("crm.audIntro")}</p>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <form className="card space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); run("custom", () => apiFetch(`/organizations/${orgId}/audiences/custom`, { method: "POST", body: JSON.stringify({ ...custom, segment: custom.source === "rfm_segment" ? custom.segment : undefined }) }), t("crm.audCustomAccepted")); }}>
          <div className="font-semibold">{t("crm.audNewCustom")}</div>
          <label className="block text-sm">{t("crm.audNameLabel")}<input className="input mt-1" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} required placeholder={t("crm.audNamePlaceholderCustom")} /></label>
          <label className="block text-sm">Ad Account
            <select className="input mt-1" value={custom.adAccountId} onChange={(e) => setCustom({ ...custom, adAccountId: e.target.value })}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({platformLabel(a.platform)})</option>)}
            </select>
          </label>
          {accountPlatform(custom.adAccountId) === "google" ? <p className="text-xs text-slate-500">{t("crm.audGoogleMatchNote")}</p> : null}
          {accountPlatform(custom.adAccountId) === "tiktok" ? <p className="text-xs text-slate-500">{t("crm.audTiktokDmpNote")}</p> : null}
          <label className="block text-sm">{t("crm.audSourceLabel")}
            <select className="input mt-1" value={custom.source} onChange={(e) => setCustom({ ...custom, source: e.target.value })}>
              <option value="customers">{t("crm.audSourceCustomers")}</option>
              <option value="leads">{t("crm.audSourceLeads")}</option>
              <option value="rfm_segment">{t("crm.audSourceRfm")}</option>
            </select>
          </label>
          {custom.source === "rfm_segment" ? (
            <label className="block text-sm">Segment
              <select className="input mt-1" value={custom.segment} onChange={(e) => setCustom({ ...custom, segment: e.target.value })}>
                {SEGMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          ) : null}
          <button className="btn-primary" disabled={busy !== "" || accounts.length === 0}>{busy === "custom" ? t("crm.audCreating") : t("crm.audCreateAudience")}</button>
        </form>

        <form className="card space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); run("look", () => apiFetch(`/organizations/${orgId}/audiences/lookalike`, { method: "POST", body: JSON.stringify({ ...look, ratio: Number(look.ratio) }) }), t("crm.audLookalikeRequested")); }}>
          <div className="font-semibold">{t("crm.audNewLookalike")}</div>
          <label className="block text-sm">{t("crm.audNameLabel")}<input className="input mt-1" value={look.name} onChange={(e) => setLook({ ...look, name: e.target.value })} required placeholder={t("crm.audNamePlaceholderLook")} /></label>
          <label className="block text-sm">Ad Account
            <select className="input mt-1" value={look.adAccountId} onChange={(e) => setLook({ ...look, adAccountId: e.target.value })}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({platformLabel(a.platform)})</option>)}
            </select>
          </label>
          {lookPlatform === "google" ? (
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">{t("crm.audGoogleLookalikeWarn")}</p>
          ) : null}
          {lookPlatform === "tiktok" ? (
            <p className="text-xs text-slate-500">{t("crm.audTiktokTierNote")}</p>
          ) : null}
          <label className="block text-sm">Source Audience
            <select className="input mt-1" value={look.sourceAudienceRecordId} onChange={(e) => setLook({ ...look, sourceAudienceRecordId: e.target.value })} required>
              <option value="">{t("crm.audChoose")}</option>
              {audiences.filter((a) => a.externalAudienceId).map((a) => <option key={a.id} value={a.id}>{a.name} ({platformLabel(accountPlatform(a.adAccountId))})</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm">{t("crm.audCountryLabel")}<input className="input mt-1" value={look.country} onChange={(e) => setLook({ ...look, country: e.target.value })} placeholder="BD" /></label>
            <label className="block text-sm">Ratio (0.01–0.20)<input className="input mt-1" value={look.ratio} onChange={(e) => setLook({ ...look, ratio: e.target.value })} placeholder="0.01" /></label>
          </div>
          <button className="btn-primary" disabled={busy !== "" || accounts.length === 0 || lookPlatform === "google"}>{busy === "look" ? t("crm.audCreating") : t("crm.audCreateLookalike")}</button>
        </form>
      </div>

      <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">{t("crm.audInfoNote")}</p>

      {audiences.length === 0 ? (
        <EmptyState title={t("crm.audEmptyTitle")} description={t("crm.audEmptyDesc")} />
      ) : (
        <div className="overflow-hidden card">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500"><tr><th className="px-4 py-3">{t("crm.audColName")}</th><th className="px-4 py-3">{t("crm.audColKindSource")}</th><th className="px-4 py-3">Platform ID</th><th className="px-4 py-3">{t("crm.audColSize")}</th><th className="px-4 py-3">Status</th><th className="px-4 py-3"></th></tr></thead>
            <tbody>{audiences.map((a) => (
              <tr key={a.id} className="border-t">
                <td className="px-4 py-3 font-medium">{a.name}<span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-600">{platformLabel(accountPlatform(a.adAccountId))}</span></td>
                <td className="px-4 py-3">{a.kind} · {a.source}{a.sourceDetail ? ` (${a.sourceDetail})` : ""}</td>
                <td className="px-4 py-3">{a.externalAudienceId ?? "—"}</td>
                <td className="px-4 py-3">{a.approximateCount != null ? fmtNumber(locale, a.approximateCount) : "—"}</td>
                <td className="px-4 py-3">{a.status}{a.error ? <span className="block text-xs text-red-600">{a.error}</span> : null}</td>
                <td className="px-4 py-3">{a.externalAudienceId ? <span className="flex flex-wrap gap-1"><button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => run(`ref-${a.id}`, () => apiFetch(`/organizations/${orgId}/audiences/${a.id}/refresh`, { method: "POST" }), t("crm.audStatusUpdated"))}>Refresh</button>{a.kind === "custom" ? <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => run(`mem-${a.id}`, () => apiFetch(`/organizations/${orgId}/audiences/${a.id}/refresh-members`, { method: "POST" }), t("crm.audMembersSent"))}>{t("crm.audMembersUpdate")}{a.lastMembershipSyncAt ? ` (${a.lastMembershipCount ?? "?"}${t("crm.audMembersCountSuffix")} · ${fmtDate(locale, a.lastMembershipSyncAt)})` : ""}</button> : null}</span> : null}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3 p-5">
          <div className="font-semibold">{t("crm.audSavedTitle")}</div>
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); let parsed: unknown; try { parsed = JSON.parse(savedForm.targeting); } catch { setError(t("crm.audTargetingJsonError")); return; } run("saved", () => apiFetch(`/organizations/${orgId}/audiences/saved`, { method: "POST", body: JSON.stringify({ name: savedForm.name, targeting: parsed }) }), t("crm.audPresetSaved")); }}>
            <input className="input" placeholder={t("crm.audPresetNamePlaceholder")} value={savedForm.name} onChange={(e) => setSavedForm({ ...savedForm, name: e.target.value })} required />
            <textarea className="input font-mono text-xs" rows={3} value={savedForm.targeting} onChange={(e) => setSavedForm({ ...savedForm, targeting: e.target.value })} />
            <button className="btn-secondary btn-sm" disabled={busy !== ""}>{t("crm.audSave")}</button>
          </form>
          <ul className="space-y-1 text-sm">
            {saved.map((s) => <li key={s.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2"><span>{s.name}</span><span className="text-xs text-slate-400">{Object.keys(s.targeting).join(", ")}</span></li>)}
          </ul>
        </div>

        <div className="card space-y-3 p-5">
          <div className="font-semibold">🛍️ Meta Product Catalog</div>
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (catForm.externalCatalogId) { run("cat", () => apiFetch(`/organizations/${orgId}/catalogs/register`, { method: "POST", body: JSON.stringify({ name: catForm.name, externalCatalogId: catForm.externalCatalogId }) }), t("crm.audCatalogLinked")); } else { run("cat", () => apiFetch(`/organizations/${orgId}/catalogs`, { method: "POST", body: JSON.stringify({ name: catForm.name, businessId: catForm.businessId }) }), t("crm.audCatalogCreated")); } }}>
            <input className="input" placeholder={t("crm.audCatalogNamePlaceholder")} value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} required />
            <input className="input" placeholder={t("crm.audBusinessIdPlaceholder")} value={catForm.businessId} onChange={(e) => setCatForm({ ...catForm, businessId: e.target.value })} />
            <input className="input" placeholder={t("crm.audCatalogIdPlaceholder")} value={catForm.externalCatalogId} onChange={(e) => setCatForm({ ...catForm, externalCatalogId: e.target.value })} />
            <button className="btn-secondary btn-sm" disabled={busy !== ""}>{busy === "cat" ? t("crm.audDoing") : t("crm.audAddCatalog")}</button>
          </form>
          <ul className="space-y-2 text-sm">
            {catalogs.map((c) => (
              <li key={c.id} className="rounded-lg bg-slate-50 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{c.name}</span>
                  <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => run(`push-${c.id}`, () => apiFetch(`/organizations/${orgId}/catalogs/${c.id}/push-products`, { method: "POST" }), t("crm.audProductsPushed"))}>{busy === `push-${c.id}` ? t("crm.audPushing") : t("crm.audPushProducts")}</button>
                </div>
                <div className="mt-2 space-y-1">
                  <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => loadSets(c.id)}>{t("crm.audViewSets")}</button>
                  {(setsByCatalog[c.id] ?? []).map((s) => (
                    <div key={s.id} className="flex items-center justify-between rounded bg-white px-2 py-1 text-xs">
                      <span>{s.name}{s.category ? ` · ${s.category}` : ""} · <b>{fmtNumber(locale, s.memberCount)}{t("crm.audSetProductsSuffix")}</b> {t("crm.audSetCountNote")}
                        {s.status === "created" && s.externalSetId ? <span className="text-green-600"> · {t("crm.audSetMetaCreated")} (ID: {s.externalSetId})</span> : s.status === "failed" ? <span className="text-red-600"> · {t("crm.audSetMetaFailed")}: {s.error}</span> : <span className="text-slate-400"> · {t("crm.audSetLocalOnly")}</span>}
                      </span>
                      <span className="flex gap-2">
                        {s.status !== "created" ? <button className="text-indigo-600" disabled={busy !== ""} onClick={() => run(`pubset-${s.id}`, () => apiFetch(`/organizations/${orgId}/catalogs/${c.id}/product-sets/${s.id}/publish`, { method: "POST" }), t("crm.audSetPublished")).then(() => loadSets(c.id))}>{t("crm.audSetPublish")}</button> : null}
                        <button className="text-red-600" disabled={busy !== ""} onClick={() => run(`delset-${s.id}`, () => apiFetch(`/organizations/${orgId}/catalogs/${c.id}/product-sets/${s.id}`, { method: "DELETE" }), t("crm.audSetDeleted")).then(() => loadSets(c.id))}>{t("crm.audDelete")}</button>
                      </span>
                    </div>
                  ))}
                  <form className="flex flex-wrap gap-1" onSubmit={(e) => { e.preventDefault(); run(`newset-${c.id}`, () => apiFetch(`/organizations/${orgId}/catalogs/${c.id}/product-sets`, { method: "POST", body: JSON.stringify({ name: setForm.name, category: setForm.category || undefined, maxPriceMajor: setForm.maxPrice || undefined }) }), t("crm.audSetCreated")).then(() => { setSetForm({ name: "", category: "", maxPrice: "" }); loadSets(c.id); }); }}>
                    <input className="input w-32" placeholder={t("crm.audSetNamePlaceholder")} value={setForm.name} onChange={(e) => setSetForm({ ...setForm, name: e.target.value })} required />
                    <input className="input w-28" placeholder={t("crm.audSetCategoryPlaceholder")} value={setForm.category} onChange={(e) => setSetForm({ ...setForm, category: e.target.value })} />
                    <input className="input w-28" placeholder={t("crm.audSetMaxPricePlaceholder")} value={setForm.maxPrice} onChange={(e) => setSetForm({ ...setForm, maxPrice: e.target.value })} />
                    <button className="btn-secondary btn-sm" disabled={busy !== ""}>{t("crm.audAddSet")}</button>
                  </form>
                </div>
                <p className="text-xs text-slate-400">ID: {c.externalCatalogId}{c.lastSyncSummary ? ` · ${t("crm.audLastPush", { pushed: c.lastSyncSummary.pushed, total: c.lastSyncSummary.total, errors: c.lastSyncSummary.errors })}` : ""}</p>
                {/* AB5 (AX10): Page / IG linkage + auto-sync + sync status. */}
                <p className="text-xs text-slate-500">
                  {c.pageName || c.instagramName
                    ? <>🔗 {c.pageName ? `Facebook Page: ${c.pageName}` : ""}{c.pageName && c.instagramName ? " · " : ""}{c.instagramName ? `Instagram: ${c.instagramName}` : ""}</>
                    : t("crm.audNoPageInfo")}
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <label className="flex items-center gap-2 text-xs font-medium">
                    <input type="checkbox" checked={!!(syncByCatalog[c.id]?.autoSync ?? c.autoSync)}
                      onChange={(e) => void toggleAutoSync(c, e.target.checked)} />
                    {t("crm.audAutoSyncLabel")}
                  </label>
                  <button className="btn-secondary btn-sm" disabled={syncBusy === c.id} onClick={() => void loadSyncStatus(c.id)}>
                    {syncBusy === c.id ? "…" : t("crm.audSyncStatus")}
                  </button>
                  {syncByCatalog[c.id] ? (
                    <span className="text-xs text-slate-500">
                      {t("crm.audSyncPending")}: <b>{fmtNumber(locale, syncByCatalog[c.id].counts.pending)}</b> · {t("crm.audSyncFailed")}: <b className={syncByCatalog[c.id].counts.failed > 0 ? "text-red-600" : ""}>{fmtNumber(locale, syncByCatalog[c.id].counts.failed)}</b> · {t("crm.audSyncDone")}: <b>{fmtNumber(locale, syncByCatalog[c.id].counts.done)}</b>
                      {syncByCatalog[c.id].lastSyncAt ? ` · ${t("crm.audLastSync")}: ${fmtDateTime(locale, syncByCatalog[c.id].lastSyncAt as string)}` : ` · ${t("crm.audNeverSynced")}`}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">{t("crm.audSyncNotLoaded")}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
