"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { filterAdAccounts } from "@/lib/ad-account-filters";
import { EmptyState } from "@repo/ui";
import { fmtDateTime, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";

interface AdAccountConnection { integrationId: string; status: string; lastSyncAt?: string | null; lastError?: string | null; connectedAt?: string }
interface AdAccount { id: string; platform: string; sourceType: string; externalId?: string | null; name: string; currency: string; integrationId?: string | null; connection?: AdAccountConnection | null; health?: string; platformStatusRaw?: string | null; platformStatusBucket?: string | null; timezone?: string | null; platformStatusCheckedAt?: string | null; spendWatchEnabled?: boolean; dailyCapMinor?: string | null; anomalyPct?: number | null; syncDisabled?: boolean; label?: string | null }
// AD6 bulk sync-all response (POST ad-accounts/sync-all).
interface SyncAllResult { total: number; success: number; failed: number; skipped: number; results: { accountId: string; status: string; error?: string }[] }
// AD5 picker step 1 response (POST integrations/meta/discover) —
// the token itself is never part of this payload.
interface DiscoveredMetaAccount { externalId: string; name: string; currency: string; platformStatusRaw?: string | null; platformStatusBucket?: string | null; timezone?: string | null; alreadyConnected: boolean; accountId?: string | null }
interface SpendWatchView { todaySpendFormatted: string; avgDailySpendFormatted: string; avgDaysUsed: number; avgBasis: string; dailyCapFormatted?: string | null; capCrossed: boolean; anomalyTriggered: boolean }

export default function AdAccountsPage() {
  const { t, locale } = useLocale();
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [loading, setLoading] = useState(true);
  // AD6: client-side search/filter state + bulk sync-all result +
  // per-card label drafts.
  const [filterQuery, setFilterQuery] = useState("");
  const [filterPlatform, setFilterPlatform] = useState("");
  const [filterHealth, setFilterHealth] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [syncAllResult, setSyncAllResult] = useState<SyncAllResult | null>(null);
  const [labelForm, setLabelForm] = useState<Record<string, string>>({});
  const [watch, setWatch] = useState<Record<string, SpendWatchView>>({});
  const [watchForm, setWatchForm] = useState<Record<string, { capTaka: string; pct: string }>>({});
  const [capi, setCapi] = useState<{ configured: boolean; pixelId?: string; hasDedicatedToken?: boolean; testEventCode?: string | null; purchaseTrigger?: string; enabled?: boolean; sendLeadEvents?: boolean } | null>(null);
  const [capiForm, setCapiForm] = useState({ pixelId: "", accessToken: "", testEventCode: "", purchaseTrigger: "placed", enabled: true, sendLeadEvents: true });
  const [capiEvents, setCapiEvents] = useState<{ id: string; eventName: string; sourceType: string; eventId: string; status: string; eventsReceived?: number | null; error?: string | null; createdAt: string }[]>([]);
  const [pubs, setPubs] = useState<{ id: string; platform: string; name: string; status: string; externalCampaignId?: string | null; error?: string | null; createdAt: string }[]>([]);
  const [ocSettings, setOcSettings] = useState<{ platform: string; conversionAction?: string | null; pixelCode?: string | null; datasetId?: string | null; leadFeedbackEnabled?: boolean; trigger: string; enabled: boolean }[]>([]);
  const [ocLogs, setOcLogs] = useState<{ id: string; platform: string; eventId: string; status: string; detail?: string | null; createdAt: string }[]>([]);
  const [ocForm, setOcForm] = useState({ googleAccount: "", googleAction: "", tiktokAccount: "", tiktokPixel: "", metaAccount: "", metaDataset: "", metaLeadFeedback: true, trigger: "cod_confirmed" });
  const [gForm, setGForm] = useState({ name: "", dailyBudget: "500", countries: "BD", headlines: "", descriptions: "", finalUrl: "" });
  const [gKeywords, setGKeywords] = useState("");
  const [gNegatives, setGNegatives] = useState("");
  const [gSitelinks, setGSitelinks] = useState("");
  const [gCallouts, setGCallouts] = useState("");
  const [tForm, setTForm] = useState({ name: "", dailyBudget: "500", countries: "BD", adText: "", landingUrl: "", imageUrl: "", videoUrl: "" });
  const [pForm, setPForm] = useState({ name: "", dailyBudget: "500", countries: "BD", finalUrl: "", businessName: "", headlines: "", longHeadlines: "", descriptions: "", logoUrl: "", imageUrls: "" });
  const [form, setForm] = useState({ platform: "meta", name: "", externalId: "", currency: "BDT" });
  const [manual, setManual] = useState<Record<string, { date: string; spend: string }>>({});
  const [metaToken, setMetaToken] = useState("");
  // CC28: which Meta app the pasted token belongs to.
  const [metaAppSource, setMetaAppSource] = useState<"platform" | "own">("platform");
  // AD5 picker: accounts discovered under the pasted token (step 1)
  // and the user's checkbox selection (step 2).
  const [metaDiscovered, setMetaDiscovered] = useState<DiscoveredMetaAccount[] | null>(null);
  const [metaSelected, setMetaSelected] = useState<Record<string, boolean>>({});
  const [googleForm, setGoogleForm] = useState({ customerId: "", clientId: "", clientSecret: "", refreshToken: "", developerToken: "", loginCustomerId: "" });
  const [tiktokForm, setTiktokForm] = useState({ advertiserId: "", accessToken: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError(t("ads.aaNoOrg")); setLoading(false); return; }
    try {
      const list = await apiFetch<AdAccount[]>(`/organizations/${orgId}/ad-accounts`);
      setAccounts(list);
      // AD4: live spend-watch computation per account (same function
      // the watchdog job uses — the numbers here and in alerts match).
      void (async () => {
        const entries = await Promise.all(list.map(async (a) => {
          try {
            const w = await apiFetch<SpendWatchView>(`/organizations/${orgId}/ad-accounts/${a.id}/spend-watch`);
            return [a.id, w] as const;
          } catch { return null; }
        }));
        setWatch(Object.fromEntries(entries.filter(Boolean) as [string, SpendWatchView][]));
        setWatchForm((prev) => {
          const next = { ...prev };
          for (const a of list) {
            if (!next[a.id]) {
              next[a.id] = {
                capTaka: a.dailyCapMinor ? String(Number(a.dailyCapMinor) / 100) : "",
                pct: a.anomalyPct != null ? String(a.anomalyPct) : "",
              };
            }
          }
          return next;
        });
      })();
      apiFetch(`/organizations/${orgId}/conversions/settings`).then((s: any) => { setCapi(s); if (s?.configured) setCapiForm((f) => ({ ...f, pixelId: s.pixelId ?? "", testEventCode: s.testEventCode ?? "", purchaseTrigger: s.purchaseTrigger ?? "placed", enabled: s.enabled ?? true, sendLeadEvents: s.sendLeadEvents ?? true })); }).catch(() => undefined);
      apiFetch(`/organizations/${orgId}/conversions/events`).then((rows: any) => setCapiEvents(rows)).catch(() => undefined);
      apiFetch(`/organizations/${orgId}/publish/publications`).then((rows: any) => setPubs(rows)).catch(() => undefined);
      apiFetch(`/organizations/${orgId}/offline-conversions/settings`).then((rows: any) => setOcSettings(rows)).catch(() => undefined);
      apiFetch(`/organizations/${orgId}/offline-conversions/logs`).then((rows: any) => setOcLogs(rows)).catch(() => undefined);
    }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("create"); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/ad-accounts`, {
        method: "POST",
        body: JSON.stringify({ platform: form.platform, sourceType: "csv", name: form.name, externalId: form.externalId || undefined, currency: form.currency }),
      });
      setForm({ platform: "meta", name: "", externalId: "", currency: "BDT" });
      setNotice(t("ads.aaCreated"));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  // AD5 picker step 1: verify the token and list the accounts
  // under it. The server stores NOTHING for this call; accounts the
  // org already knows come back flagged and pre-checked.
  async function discoverMeta(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("meta-discover"); setError("");
    try {
      const res = await apiFetch<{ accounts: DiscoveredMetaAccount[] }>(`/organizations/${orgId}/integrations/meta/discover`, {
        method: "POST", body: JSON.stringify({ accessToken: metaToken }),
      });
      setMetaDiscovered(res.accounts);
      setMetaSelected(Object.fromEntries(res.accounts.map((a) => [a.externalId, a.alreadyConnected])));
      if (res.accounts.length === 0) setNotice(t("ads.aaNoAccountsUnderToken"));
    } catch (e) { setError(e instanceof Error ? e.message : "Meta discovery failed"); }
    finally { setBusy(""); }
  }

  // AD5 picker step 2: connect ONLY the checked accounts (the
  // server treats a present-but-empty selection as an error, never
  // as "connect everything").
  async function connectMetaSelected() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const ids = Object.entries(metaSelected).filter(([, v]) => v).map(([k]) => k);
    if (ids.length === 0) { setError(t("ads.aaSelectAtLeastOne")); return; }
    setBusy("meta-connect"); setError("");
    try {
      const res = await apiFetch<{ connectedAccounts: AdAccount[] }>(`/organizations/${orgId}/integrations/meta/connect`, {
        method: "POST", body: JSON.stringify({ accessToken: metaToken, adAccountExternalIds: ids, appSource: metaAppSource }),
      });
      setMetaToken("");
      setMetaDiscovered(null);
      setMetaSelected({});
      setNotice(t("ads.aaMetaConnected", { count: fmtNumber(locale, res.connectedAccounts.length) }));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Meta connection failed"); }
    finally { setBusy(""); }
  }

  // AD5: flip the per-account sync switch. While sync is off, the
  // manual + scheduled insights syncs refuse/skip — publishing is
  // a different concern and is NOT touched by this switch.
  async function setSyncDisabled(a: AdAccount, disabled: boolean) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`syncflag-${a.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/ad-accounts/${a.id}/sync`, {
        method: "PATCH", body: JSON.stringify({ syncDisabled: disabled }),
      });
      setNotice(disabled
        ? t("ads.aaSyncOff", { name: a.name })
        : t("ads.aaSyncOn", { name: a.name }));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : t("ads.aaSyncSettingFailed")); }
    finally { setBusy(""); }
  }

  async function syncMeta(accountId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`sync-${accountId}`); setError("");
    try {
      const res = await apiFetch<{ rows: number; created: number; updated: number }>(`/organizations/${orgId}/ad-accounts/${accountId}/sync/meta-insights`, { method: "POST", body: JSON.stringify({}) });
      setNotice(t("ads.aaMetaSyncDone", { rows: fmtNumber(locale, res.rows), created: fmtNumber(locale, res.created), updated: fmtNumber(locale, res.updated) }));
    } catch (e) { setError(e instanceof Error ? e.message : "Sync failed"); }
    finally { setBusy(""); }
  }

  async function syncMetaExtra(accountId: string, kind: string, label: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`syncx-${accountId}`); setError("");
    try {
      const res = await apiFetch<{ rows: number }>(`/organizations/${orgId}/ad-accounts/${accountId}/sync/${kind}`, { method: "POST", body: JSON.stringify({}) });
      setNotice(t("ads.aaExtraSyncDone", { label, rows: fmtNumber(locale, res.rows) }));
    } catch (e) { setError(e instanceof Error ? e.message : "Sync failed"); }
    finally { setBusy(""); }
  }

  async function connectGoogle(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("google"); setError("");
    try {
      const res = await apiFetch<{ connectedAccounts: AdAccount[] }>(`/organizations/${orgId}/integrations/google/connect`, {
        method: "POST", body: JSON.stringify({ ...googleForm, loginCustomerId: googleForm.loginCustomerId || undefined }),
      });
      setGoogleForm({ customerId: "", clientId: "", clientSecret: "", refreshToken: "", developerToken: "", loginCustomerId: "" });
      setNotice(t("ads.aaGoogleConnected", { name: res.connectedAccounts[0]?.name ?? "" }));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Google connection failed"); }
    finally { setBusy(""); }
  }

  async function connectTikTok(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("tiktok"); setError("");
    try {
      const res = await apiFetch<{ connectedAccounts: AdAccount[] }>(`/organizations/${orgId}/integrations/tiktok/connect`, {
        method: "POST", body: JSON.stringify(tiktokForm),
      });
      setTiktokForm({ advertiserId: "", accessToken: "" });
      setNotice(t("ads.aaTiktokConnected", { name: res.connectedAccounts[0]?.name ?? "" }));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "TikTok connection failed"); }
    finally { setBusy(""); }
  }

  async function syncPlatform(accountId: string, platform: "google" | "tiktok") {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`sync-${accountId}`); setError("");
    try {
      const res = await apiFetch<{ rows: number; created: number; updated: number }>(`/organizations/${orgId}/ad-accounts/${accountId}/sync/${platform}-insights`, { method: "POST", body: JSON.stringify({}) });
      setNotice(t("ads.aaPlatformSyncDone", { platform: platform === "google" ? "Google" : "TikTok", rows: fmtNumber(locale, res.rows), created: fmtNumber(locale, res.created), updated: fmtNumber(locale, res.updated) }));
    } catch (e) { setError(e instanceof Error ? e.message : "Sync failed"); }
    finally { setBusy(""); }
  }

  async function importCsv(accountId: string, file: File) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`csv-${accountId}`); setError("");
    try {
      const csvText = await file.text();
      const res = await apiFetch<{ totalRows: number; created: number; updated: number; failed: number }>(
        `/organizations/${orgId}/ad-accounts/${accountId}/metrics/import-csv`,
        { method: "POST", body: JSON.stringify({ fileName: file.name, csvText }) });
      setNotice(t("ads.aaCsvImportDone", { total: fmtNumber(locale, res.totalRows), created: fmtNumber(locale, res.created), updated: fmtNumber(locale, res.updated), failed: fmtNumber(locale, res.failed) }));
    } catch (e) { setError(e instanceof Error ? e.message : "Import failed"); }
    finally { setBusy(""); }
  }

  async function manualEntry(accountId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const entry = manual[accountId];
    if (!entry?.date || !entry?.spend) { setError(t("ads.aaDateSpendRequired")); return; }
    setBusy(`manual-${accountId}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/ad-accounts/${accountId}/metrics/manual`, {
        method: "POST", body: JSON.stringify(entry),
      });
      setNotice(t("ads.aaManualSaved"));
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  async function disconnectAccount(a: AdAccount) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const sharedCount = a.integrationId ? accounts.filter((x) => x.integrationId === a.integrationId).length : 0;
    let message = t("ads.aaDisconnectConfirm", { name: a.name });
    if (sharedCount > 1) message += t("ads.aaDisconnectSharedSuffix");
    if (!window.confirm(message)) return;
    setBusy(`disconnect-${a.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/ad-accounts/${a.id}/disconnect`, { method: "POST" });
      setNotice(t("ads.aaDisconnected", { name: a.name }));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Disconnect failed"); }
    finally { setBusy(""); }
  }

  // AD6: bulk sync-all — the server runs each account's primary
  // insights sync sequentially and reports per-account results; a
  // failure in one account never fails the batch.
  async function syncAll() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("sync-all"); setError(""); setSyncAllResult(null);
    try {
      const res = await apiFetch<SyncAllResult>(`/organizations/${orgId}/ad-accounts/sync-all`, { method: "POST" });
      setSyncAllResult(res);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : t("ads.aaSyncAllFailed")); }
    finally { setBusy(""); }
  }

  // AD6: save (or clear, with an empty value) the account's display
  // label through the AD5 settings endpoint.
  async function saveLabel(a: AdAccount) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const value = (labelForm[a.id] ?? a.label ?? "").trim();
    setBusy(`label-${a.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/ad-accounts/${a.id}/sync`, {
        method: "PATCH", body: JSON.stringify({ label: value }),
      });
      setNotice(value ? t("ads.aaLabelSaved", { name: a.name, value }) : t("ads.aaLabelCleared", { name: a.name }));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : t("ads.aaLabelSaveFailed")); }
    finally { setBusy(""); }
  }

  function reconnect(platform: string) {
    const id = platform === "meta" ? "connect-meta" : platform === "google" ? "connect-google" : platform === "tiktok" ? "connect-tiktok" : null;
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("ring-2", "ring-red-400");
    window.setTimeout(() => el.classList.remove("ring-2", "ring-red-400"), 2500);
    const firstInput = el.querySelector("input");
    if (firstInput) window.setTimeout(() => (firstInput as HTMLElement).focus(), 350);
  }

  // DX2 state-pattern helper: smooth-scroll to a form/card on this
  // page and focus its first field (used by the honest-state notices).
  function scrollToSection(id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    const firstInput = el.querySelector("input, select, textarea");
    if (firstInput) window.setTimeout(() => (firstInput as HTMLElement).focus(), 350);
  }

  const healthMeta: Record<string, { labelKey: string; cls: string }> = {
    connected: { labelKey: "ads.aaHealthConnected", cls: "bg-green-100 text-green-700" },
    stale: { labelKey: "ads.aaHealthStale", cls: "bg-amber-100 text-amber-700" },
    error: { labelKey: "ads.aaHealthError", cls: "bg-red-100 text-red-700" },
    disconnected: { labelKey: "ads.aaHealthDisconnected", cls: "bg-slate-200 text-red-600" },
    manual: { labelKey: "ads.aaHealthManual", cls: "bg-slate-100 text-slate-600" },
    // AD5: sync was deliberately switched off — its own state, not "stale".
    sync_disabled: { labelKey: "ads.aaHealthSyncDisabled", cls: "bg-slate-200 text-slate-700" },
  };

  // AD3: the platform's own account status (verbatim value kept in
  // platformStatusRaw). A null bucket means the platform has not
  // reported a status — shown as such, never guessed as "active".
  const platformStatusMeta: Record<string, { labelKey: string; shortKey: string; cls: string }> = {
    active: { labelKey: "ads.aaStatusActive", shortKey: "ads.aaStatusShortActive", cls: "bg-green-100 text-green-700" },
    disabled: { labelKey: "ads.aaStatusDisabled", shortKey: "ads.aaStatusShortDisabled", cls: "bg-red-100 text-red-700" },
    restricted: { labelKey: "ads.aaStatusRestricted", shortKey: "ads.aaStatusShortRestricted", cls: "bg-amber-100 text-amber-700" },
    unknown: { labelKey: "ads.aaStatusUnknown", shortKey: "ads.aaStatusShortUnknown", cls: "bg-slate-200 text-slate-600" },
  };

  async function refreshStatus(a: AdAccount) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`refresh-${a.id}`); setError("");
    try {
      const res = await apiFetch<{ platformStatusBucket?: string | null; platformStatusRaw?: string | null }>(`/organizations/${orgId}/ad-accounts/${a.id}/refresh-status`, { method: "POST" });
      const label = res.platformStatusBucket ? (platformStatusMeta[res.platformStatusBucket] ? t(platformStatusMeta[res.platformStatusBucket].labelKey) : res.platformStatusBucket) : t("ads.aaPlatformNotReported");
      setNotice(t("ads.aaStatusNotice", { name: a.name, label, raw: res.platformStatusRaw ? t("ads.aaStatusRawSuffix", { raw: res.platformStatusRaw }) : "" }));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : t("ads.aaStatusCheckFailed")); }
    finally { setBusy(""); }
  }

  // AD4: save the spend-watch settings (toggle saves immediately too).
  // ALERTING ONLY — enabling this never pauses or stops a campaign.
  async function saveWatch(a: AdAccount, enabledOverride?: boolean) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const form = watchForm[a.id] ?? { capTaka: "", pct: "" };
    setBusy(`watch-${a.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/ad-accounts/${a.id}/spend-watch`, {
        method: "PATCH",
        body: JSON.stringify({
          enabled: enabledOverride ?? a.spendWatchEnabled ?? false,
          dailyCap: form.capTaka.trim() === "" ? null : form.capTaka.trim(),
          anomalyPct: form.pct.trim() === "" ? null : Number(form.pct),
        }),
      });
      setNotice(t("ads.aaWatchSaved", { name: a.name }));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : t("ads.aaWatchSaveFailed")); }
    finally { setBusy(""); }
  }

  // AD6: the visible list is the fetched list filtered client-side
  // (the endpoint already returns every field the filters need).
  const filteredAccounts = filterAdAccounts(accounts, { query: filterQuery, platform: filterPlatform, health: filterHealth, status: filterStatus });
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const inputCls = "input mt-1";

  return (
    <div className="space-y-8 [&_button]:min-h-[40px]">
      <div>
        <h1 className="page-title">Advertising Accounts</h1>
        <p className="text-sm leading-[1.7] text-slate-500">{t("ads.aaIntro")}</p>
      </div>
      {error ? <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 shadow-sm"><span>⛔</span><span>{error}</span></div> : null}
      {notice ? (
        <div role="status" className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 shadow-sm">
          <div className="flex items-center gap-2">
            <span>✓</span>
            <span>{notice}</span>
          </div>
          <button type="button" onClick={() => setNotice("")} className="text-xs text-emerald-600 hover:text-emerald-800">{t("ads.aaClose")}</button>
        </div>
      ) : null}

      <form id="connect-meta" onSubmit={discoverMeta} className="space-y-3 card p-5">
        <div className="font-semibold">{t("ads.aaMetaConnectTitle")}</div>
        <p className="text-sm leading-[1.7] text-slate-500">
          {t("ads.aaMetaConnectBody")}
        </p>
        <label className="block text-sm">Access Token
          <input className={inputCls} type="password" value={metaToken} onChange={(e) => { setMetaToken(e.target.value); setMetaDiscovered(null); setMetaSelected({}); }} required placeholder="EAA..." />
        </label>
        <label className="block text-sm">{t("ads.aaTokenAppLabel")}
          <select className={inputCls} value={metaAppSource} onChange={(e) => setMetaAppSource(e.target.value as "platform" | "own")}>
            <option value="platform">{t("ads.aaTokenAppPlatform")}</option>
            <option value="own">{t("ads.aaTokenAppOwn")}</option>
          </select>
        </label>
        <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>
          {busy === "meta-discover" ? t("ads.aaVerifying") : t("ads.aaFindAccounts")}
        </button>
        {metaDiscovered !== null ? (
          <div className="space-y-2 border-t border-slate-100 pt-3">
            {metaDiscovered.length === 0 ? (
              <div className="flex flex-wrap items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <span aria-hidden="true" className="text-lg leading-none">🔍</span>
                <p className="min-w-0 flex-1 text-sm leading-[1.7] text-slate-500">{t("ads.aaNoAccountsFound")}</p>
              </div>
            ) : (
              <>
                <p className="text-sm font-medium">{t("ads.aaWhichAccounts", { count: fmtNumber(locale, Object.values(metaSelected).filter(Boolean).length) })}</p>
                <div className="space-y-1">
                  {metaDiscovered.map((d) => (
                    <label key={d.externalId} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                      <input type="checkbox" checked={metaSelected[d.externalId] ?? false} disabled={busy !== ""} onChange={(e) => setMetaSelected((p) => ({ ...p, [d.externalId]: e.target.checked }))} />
                      <span className="font-medium">{d.name}</span>
                      <span className="break-all text-xs text-slate-400">{d.externalId} · {d.currency}{d.timezone ? ` · ${d.timezone}` : ""}</span>
                      {d.platformStatusBucket ? <span className={`rounded px-2 py-0.5 text-xs font-medium ${platformStatusMeta[d.platformStatusBucket]?.cls ?? "bg-slate-100 text-slate-600"}`}>{platformStatusMeta[d.platformStatusBucket] ? t(platformStatusMeta[d.platformStatusBucket].labelKey) : d.platformStatusBucket}</span> : <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{t("ads.aaPlatformNotReported")}</span>}
                      {d.alreadyConnected ? <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">{t("ads.aaAlreadyConnected")}</span> : null}
                    </label>
                  ))}
                </div>
                <button type="button" className="btn-primary disabled:opacity-50" disabled={busy !== "" || Object.values(metaSelected).filter(Boolean).length === 0} onClick={connectMetaSelected}>
                  {busy === "meta-connect" ? t("ads.aaConnecting") : t("ads.aaConnectSelected")}
                </button>
              </>
            )}
          </div>
        ) : null}
      </form>

      {loading ? (
        <div className="card space-y-3 p-5" aria-busy="true">
          <div className="skeleton h-5 w-48 max-w-full" />
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-2/3" />
          <p className="text-sm leading-[1.7] text-slate-500">{t("ads.aaLoadingAccounts")}</p>
        </div>
      ) : accounts.length === 0 ? (
        <EmptyState title={t("ads.aaEmptyTitle")} description={t("ads.aaEmptyDesc")} actionLabel={t("ads.aaEmptyAction")} onAction={() => scrollToSection("connect-meta")} />
      ) : (
        <div className="space-y-3">
          <div className="card space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={syncAll}>
                {busy === "sync-all" ? t("ads.aaSyncingAll") : t("ads.aaSyncAll")}
              </button>
              <span className="text-xs leading-[1.7] text-slate-500">{t("ads.aaSyncAllNote")}</span>
            </div>
            {syncAllResult ? (
              <div className="rounded-lg bg-slate-50 p-3 text-sm">
                <p>{t("ads.aaSyncAllDoneA")} <b className="text-green-700">{t("ads.aaSyncSuccess", { count: fmtNumber(locale, syncAllResult.success) })}</b> · <b className="text-red-600">{t("ads.aaSyncFailedWord", { count: fmtNumber(locale, syncAllResult.failed) })}</b> · <b>{t("ads.aaSyncSkippedPart", { count: fmtNumber(locale, syncAllResult.skipped), total: fmtNumber(locale, syncAllResult.total) })}</b></p>
                {syncAllResult.results.some((r) => r.status === "failed") ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-red-600">{t("ads.aaFailedDetails")}</summary>
                    <ul className="mt-1 list-inside list-disc text-xs text-red-700">
                      {syncAllResult.results.filter((r) => r.status === "failed").map((r) => (
                        <li key={r.accountId}>{accountById.get(r.accountId)?.label || accountById.get(r.accountId)?.name || r.accountId} — {r.error ?? t("ads.aaUnknownError")}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            ) : null}
            <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
              <label className="w-full text-xs text-slate-500 sm:w-auto">{t("ads.aaSearchLabel")}
                <input className="input mt-1 w-full sm:w-52" placeholder={t("ads.aaSearchPlaceholder")} value={filterQuery} onChange={(e) => setFilterQuery(e.target.value)} />
              </label>
              <label className="text-xs text-slate-500">{t("ads.aaPlatformLabel")}
                <select className="input mt-1" value={filterPlatform} onChange={(e) => setFilterPlatform(e.target.value)}>
                  <option value="">{t("ads.aaAllOption")}</option><option value="meta">Meta</option><option value="google">Google</option><option value="tiktok">TikTok</option>
                </select>
              </label>
              <label className="text-xs text-slate-500">Health
                <select className="input mt-1" value={filterHealth} onChange={(e) => setFilterHealth(e.target.value)}>
                  <option value="">{t("ads.aaAllOption")}</option>
                  {Object.entries(healthMeta).map(([k, v]) => <option key={k} value={k}>{t(v.labelKey)}</option>)}
                </select>
              </label>
              <label className="text-xs text-slate-500">{t("ads.aaStatusFilterLabel")}
                <select className="input mt-1" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                  <option value="">{t("ads.aaAllOption")}</option>
                  {Object.entries(platformStatusMeta).map(([k, v]) => <option key={k} value={k}>{t(v.shortKey)}</option>)}
                </select>
              </label>
              <span className="pb-2 text-sm text-slate-500">{t("ads.aaShowingCount", { shown: fmtNumber(locale, filteredAccounts.length), total: fmtNumber(locale, accounts.length) })}</span>
            </div>
          </div>
          {filteredAccounts.length === 0 ? (
            <div className="card flex flex-wrap items-start gap-3 p-5">
              <span aria-hidden="true" className="text-lg leading-none">🔍</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-[1.7] text-slate-500">{t("ads.aaNoFilterMatch", { total: fmtNumber(locale, accounts.length) })}</p>
                <button type="button" className="btn-secondary btn-sm mt-2" onClick={() => { setFilterQuery(""); setFilterPlatform(""); setFilterHealth(""); setFilterStatus(""); }}>{t("ads.aaClearFilters")}</button>
              </div>
            </div>
          ) : null}
          {filteredAccounts.map((a) => (
            <div key={a.id} className="card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 break-words font-semibold">{a.label || a.name}{a.label ? <span className="ml-1 text-xs font-normal text-slate-400">({a.name})</span> : null} <span className="ml-1 rounded bg-slate-100 px-2 py-0.5 text-xs capitalize">{a.platform}</span> <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{a.sourceType}</span>{a.health ? <span className={`ml-1 rounded px-2 py-0.5 text-xs font-medium ${healthMeta[a.health]?.cls ?? "bg-slate-100 text-slate-600"}`}>{healthMeta[a.health] ? t(healthMeta[a.health].labelKey) : a.health}</span> : null}{a.sourceType === "api" ? (a.platformStatusBucket ? <span className={`ml-1 rounded px-2 py-0.5 text-xs font-medium ${platformStatusMeta[a.platformStatusBucket]?.cls ?? "bg-slate-100 text-slate-600"}`} title={a.platformStatusRaw ? t("ads.aaPlatformRawTitle", { raw: a.platformStatusRaw }) : undefined}>{platformStatusMeta[a.platformStatusBucket] ? t(platformStatusMeta[a.platformStatusBucket].labelKey) : a.platformStatusBucket}</span> : <span className="ml-1 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{t("ads.aaPlatformNotReported")}</span>) : null}</div>
                <div className="text-xs text-slate-400">{a.externalId ?? ""} · {a.currency}{a.timezone ? ` · ${a.timezone}` : ""}</div>
              </div>
              {a.platformStatusCheckedAt ? <p className="mt-1 text-xs text-slate-500">{t("ads.aaStatusCheckedAt", { date: fmtDateTime(locale, a.platformStatusCheckedAt) })}</p> : null}
              {a.connection?.lastSyncAt ? <p className="mt-1 text-xs text-slate-500">{t("ads.aaLastSync", { date: fmtDateTime(locale, a.connection.lastSyncAt) })}</p> : null}
              {a.connection?.lastError ? <p className="mt-1 break-words text-xs leading-[1.7] text-red-600">{a.connection.lastError}</p> : null}
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="w-full text-xs text-slate-500 sm:w-auto">{t("ads.aaLabelFieldLabel")}
                  <input className="input mt-1 w-full sm:w-60" maxLength={200} placeholder={a.name} value={labelForm[a.id] ?? a.label ?? ""} onChange={(e) => setLabelForm((p) => ({ ...p, [a.id]: e.target.value }))} />
                </label>
                <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => saveLabel(a)}>
                  {busy === `label-${a.id}` ? t("ads.aaSaving") : t("ads.aaSaveLabel")}
                </button>
              </div>
              <div className="mt-3 border-t border-slate-100 pt-3">
                <label className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={a.spendWatchEnabled ?? false} disabled={busy !== ""} onChange={(e) => saveWatch(a, e.target.checked)} />
                  {t("ads.aaWatchTitle")}
                  <span className="text-xs font-normal leading-[1.7] text-slate-500">{t("ads.aaWatchNote")}</span>
                </label>
                {watch[a.id] ? (
                  <p className="mt-1 text-xs text-slate-500">
                    {t("ads.aaTodaySoFar")} <b>{watch[a.id].todaySpendFormatted}</b> · {watch[a.id].avgBasis}: <b>{watch[a.id].avgDailySpendFormatted}</b>
                    {watch[a.id].dailyCapFormatted ? <>{t("ads.aaCapPart", { cap: watch[a.id].dailyCapFormatted ?? "" })}</> : null}
                    {watch[a.id].capCrossed ? <span className="ml-1 font-semibold text-red-600">{t("ads.aaCapCrossed")}</span> : null}
                    {watch[a.id].anomalyTriggered ? <span className="ml-1 font-semibold text-amber-600">{t("ads.aaAnomaly")}</span> : null}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="text-xs text-slate-500">{t("ads.aaCapFieldLabel")}
                    <input className="input mt-1 w-36 max-w-full" inputMode="decimal" placeholder={t("ads.aaCapPlaceholder")} value={watchForm[a.id]?.capTaka ?? ""} onChange={(e) => setWatchForm((p) => ({ ...p, [a.id]: { capTaka: e.target.value, pct: p[a.id]?.pct ?? "" } }))} />
                  </label>
                  <label className="text-xs text-slate-500">{t("ads.aaAnomalyFieldLabel")}
                    <input className="input mt-1 w-28 max-w-full" inputMode="numeric" placeholder={t("ads.aaAnomalyPlaceholder")} value={watchForm[a.id]?.pct ?? ""} onChange={(e) => setWatchForm((p) => ({ ...p, [a.id]: { capTaka: p[a.id]?.capTaka ?? "", pct: e.target.value } }))} />
                  </label>
                  <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => saveWatch(a)}>
                    {busy === `watch-${a.id}` ? t("ads.aaSaving") : t("ads.aaSaveWatchSettings")}
                  </button>
                </div>
              </div>
              {(a.health === "error" || a.health === "disconnected") && a.sourceType === "api" ? (
                <div className="mt-2">
                  <button type="button" className="btn-secondary btn-sm" onClick={() => reconnect(a.platform)}>{t("ads.aaReconnect")}</button>
                </div>
              ) : null}
              {a.integrationId ? (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <label className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={!a.syncDisabled} disabled={busy !== ""} onChange={(e) => setSyncDisabled(a, !e.target.checked)} />
                    🔄 Sync {a.syncDisabled ? t("ads.aaSyncToggleOff") : t("ads.aaSyncToggleOn")}
                    <span className="text-xs font-normal leading-[1.7] text-slate-500">{t("ads.aaSyncToggleNote")}</span>
                  </label>
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap items-end gap-3">
                {a.syncDisabled && a.integrationId ? (
                  <span className="text-xs text-slate-500">{t("ads.aaSyncDisabledNote")}</span>
                ) : null}
                {a.platform === "google" && a.integrationId && !a.syncDisabled ? (
                  <button className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => syncPlatform(a.id, "google")}>
                    {busy === `sync-${a.id}` ? t("ads.aaSyncing") : t("ads.aaGoogleSyncBtn")}
                  </button>
                ) : null}
                {a.platform === "tiktok" && a.integrationId && !a.syncDisabled ? (
                  <button className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => syncPlatform(a.id, "tiktok")}>
                    {busy === `sync-${a.id}` ? t("ads.aaSyncing") : t("ads.aaTiktokSyncBtn")}
                  </button>
                ) : null}
                {a.platform === "meta" && a.integrationId && !a.syncDisabled ? (
                  <button className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => syncMeta(a.id)}>
                    {busy === `sync-${a.id}` ? t("ads.aaSyncing") : t("ads.aaMetaSyncBtn")}
                  </button>
                ) : null}
                {a.platform === "meta" && a.integrationId && !a.syncDisabled ? (
                  <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => syncMetaExtra(a.id, "meta-ad-insights", "Ad-level")}>
                    {busy === `syncx-${a.id}` ? t("ads.aaSyncing") : "Ad-level Sync"}
                  </button>
                ) : null}
                {a.platform === "meta" && a.integrationId && !a.syncDisabled ? (
                  <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => syncMetaExtra(a.id, "meta-breakdowns", "Breakdown")}>
                    {busy === `syncx-${a.id}` ? t("ads.aaSyncing") : "Breakdown Sync"}
                  </button>
                ) : null}
                {a.integrationId && !a.syncDisabled ? (
                  <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => refreshStatus(a)}>
                    {busy === `refresh-${a.id}` ? t("ads.aaChecking") : t("ads.aaCheckStatus")}
                  </button>
                ) : null}
                {a.integrationId ? (
                  <button className="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => disconnectAccount(a)}>
                    {busy === `disconnect-${a.id}` ? t("ads.aaDisconnecting") : t("ads.aaDisconnect")}
                  </button>
                ) : null}
                <label className="text-sm">
                  <span className="block text-xs text-slate-500">Ad Spend CSV</span>
                  <input type="file" accept=".csv,text/csv" className="max-w-full text-sm" onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(a.id, f); }} />
                </label>
                <label className="text-sm">{t("ads.aaDateLabel")}
                  <input type="date" className="ml-1 rounded-lg border px-2 py-1.5" value={manual[a.id]?.date ?? ""} onChange={(e) => setManual({ ...manual, [a.id]: { date: e.target.value, spend: manual[a.id]?.spend ?? "" } })} />
                </label>
                <label className="text-sm">Spend
                  <input className="ml-1 w-28 rounded-lg border px-2 py-1.5" placeholder="0.00" value={manual[a.id]?.spend ?? ""} onChange={(e) => setManual({ ...manual, [a.id]: { date: manual[a.id]?.date ?? "", spend: e.target.value } })} />
                </label>
                <button className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => manualEntry(a.id)}>{t("ads.aaManualSave")}</button>
              </div>
              <p className="mt-2 text-xs leading-[1.7] text-slate-400">{t("ads.aaCsvColumnsNote")}</p>
            </div>
          ))}
        </div>
      )}

      <div className="card space-y-3 p-5">
        <div className="font-semibold">{t("ads.ocTitle")}</div>
        <p className="text-sm leading-[1.7] text-slate-500">{t("ads.ocIntroA")}{ocSettings.map((s) => `${s.platform}=${s.trigger}${s.enabled ? "" : t("ads.ocOffSuffix")}`).join(", ") || t("ads.ocIntroNotSet")}{t("ads.ocPeriod")}</p>
        {ocSettings.length === 0 ? (
          <div className="flex flex-wrap items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <span aria-hidden="true" className="text-lg leading-none">⚠️</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-[1.7] text-amber-800">{t("ads.ocNotSetBody")}</p>
              <button type="button" className="btn-secondary btn-sm mt-2" onClick={() => scrollToSection("oc-settings")}>{t("ads.ocGoSettings")}</button>
            </div>
          </div>
        ) : null}
        <div id="oc-settings" className="grid gap-2 md:grid-cols-2">
          <div className="space-y-2 rounded-xl bg-slate-50 p-3">
            <div className="text-sm font-medium">Google Ads</div>
            <select className="input" value={ocForm.googleAccount} onChange={(e) => setOcForm({ ...ocForm, googleAccount: e.target.value })}>
              <option value="">{t("ads.ocChooseGoogle")}</option>
              {accounts.filter((a) => a.platform === "google").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <input className="input" placeholder={t("ads.ocGoogleActionPlaceholder")} value={ocForm.googleAction} onChange={(e) => setOcForm({ ...ocForm, googleAction: e.target.value })} />
            <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
              const orgId = getOrganizationId(); if (!orgId || !ocForm.googleAccount || !ocForm.googleAction) { setError(t("ads.ocGoogleRequired")); return; }
              try { await apiFetch(`/organizations/${orgId}/offline-conversions/settings/google`, { method: "PUT", body: JSON.stringify({ adAccountId: ocForm.googleAccount, conversionAction: ocForm.googleAction, trigger: ocForm.trigger, enabled: true }) }); setNotice(t("ads.ocGoogleSaved")); await load(); } catch (e) { setError(e instanceof Error ? e.message : t("ads.ocSaveFailed")); }
            }}>{t("ads.aaSaveShort")}</button>
          </div>
          <div className="space-y-2 rounded-xl bg-slate-50 p-3">
            <div className="text-sm font-medium">TikTok Events API</div>
            <select className="input" value={ocForm.tiktokAccount} onChange={(e) => setOcForm({ ...ocForm, tiktokAccount: e.target.value })}>
              <option value="">{t("ads.ocChooseTiktok")}</option>
              {accounts.filter((a) => a.platform === "tiktok").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <input className="input" placeholder={t("ads.ocTiktokPixelPlaceholder")} value={ocForm.tiktokPixel} onChange={(e) => setOcForm({ ...ocForm, tiktokPixel: e.target.value })} />
            <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
              const orgId = getOrganizationId(); if (!orgId || !ocForm.tiktokAccount || !ocForm.tiktokPixel) { setError(t("ads.ocTiktokRequired")); return; }
              try { await apiFetch(`/organizations/${orgId}/offline-conversions/settings/tiktok`, { method: "PUT", body: JSON.stringify({ adAccountId: ocForm.tiktokAccount, pixelCode: ocForm.tiktokPixel, trigger: ocForm.trigger, enabled: true }) }); setNotice(t("ads.ocTiktokSaved")); await load(); } catch (e) { setError(e instanceof Error ? e.message : t("ads.ocSaveFailed")); }
            }}>{t("ads.aaSaveShort")}</button>
          </div>
          <div className="space-y-2 rounded-xl bg-slate-50 p-3">
            <div className="text-sm font-medium">Meta Dataset — Offline Conversions (CN14)</div>
            <select className="input" value={ocForm.metaAccount} onChange={(e) => setOcForm({ ...ocForm, metaAccount: e.target.value })}>
              <option value="">{t("ads.ocChooseMeta")}</option>
              {accounts.filter((a) => a.platform === "meta").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <input className="input" placeholder={t("ads.ocMetaDatasetPlaceholder")} value={ocForm.metaDataset} onChange={(e) => setOcForm({ ...ocForm, metaDataset: e.target.value })} />
            <label className="flex items-start gap-2 text-xs text-slate-600">
              <input type="checkbox" className="mt-0.5" checked={ocForm.metaLeadFeedback} onChange={(e) => setOcForm({ ...ocForm, metaLeadFeedback: e.target.checked })} />
              <span>{t("ads.ocLeadFeedbackA")}<b>Qualified</b>{t("ads.ocLeadFeedbackB")}<b>Won</b>{t("ads.ocLeadFeedbackC")}{ocSettings.find((s) => s.platform === "meta") ? t("ads.ocCurrentSetting", { dataset: ocSettings.find((s) => s.platform === "meta")?.datasetId ?? "—", state: ocSettings.find((s) => s.platform === "meta")?.leadFeedbackEnabled ? t("ads.ocStateOn") : t("ads.ocStateOff") }) : ""}</span>
            </label>
            <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
              const orgId = getOrganizationId(); if (!orgId || !ocForm.metaAccount || !ocForm.metaDataset) { setError(t("ads.ocMetaRequired")); return; }
              try { await apiFetch(`/organizations/${orgId}/offline-conversions/settings/meta`, { method: "PUT", body: JSON.stringify({ adAccountId: ocForm.metaAccount, datasetId: ocForm.metaDataset, leadFeedbackEnabled: ocForm.metaLeadFeedback, trigger: ocForm.trigger, enabled: true }) }); setNotice(t("ads.ocMetaSaved")); await load(); } catch (e) { setError(e instanceof Error ? e.message : t("ads.ocSaveFailed")); }
            }}>{t("ads.aaSaveShort")}</button>
          </div>
        </div>
        <label className="block text-sm">{t("ads.ocTriggerLabel")}
          <select className="input mt-1 w-full sm:w-56" value={ocForm.trigger} onChange={(e) => setOcForm({ ...ocForm, trigger: e.target.value })}>
            <option value="placed">{t("ads.ocTriggerPlaced")}</option>
            <option value="cod_confirmed">{t("ads.ocTriggerCod")}</option>
            <option value="delivered">{t("ads.ocTriggerDelivered")}</option>
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
            const orgId = getOrganizationId(); if (!orgId) { setError(t("ads.ocNoOrg")); return; } try { const res = await apiFetch<{ examined: number; sent: number; skipped: number; failed: number }>(`/organizations/${orgId}/offline-conversions/upload-recent`, { method: "POST", body: JSON.stringify({ platform: "google", days: 30 }) }); setNotice(t("ads.ocBackfillNotice", { platform: "Google", examined: fmtNumber(locale, res.examined), sent: fmtNumber(locale, res.sent), skipped: fmtNumber(locale, res.skipped), failed: fmtNumber(locale, res.failed) })); await load(); } catch (e) { setError(e instanceof Error ? e.message : t("ads.ocBackfillFailed")); }
          }}>{t("ads.ocBackfillGoogle")}</button>
          <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
            const orgId = getOrganizationId(); if (!orgId) { setError(t("ads.ocNoOrg")); return; } try { const res = await apiFetch<{ examined: number; sent: number; skipped: number; failed: number }>(`/organizations/${orgId}/offline-conversions/upload-recent`, { method: "POST", body: JSON.stringify({ platform: "tiktok", days: 30 }) }); setNotice(t("ads.ocBackfillNotice", { platform: "TikTok", examined: fmtNumber(locale, res.examined), sent: fmtNumber(locale, res.sent), skipped: fmtNumber(locale, res.skipped), failed: fmtNumber(locale, res.failed) })); await load(); } catch (e) { setError(e instanceof Error ? e.message : t("ads.ocBackfillFailed")); }
          }}>{t("ads.ocBackfillTiktok")}</button>
          <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
            const orgId = getOrganizationId(); if (!orgId) { setError(t("ads.ocNoOrg")); return; } try { const res = await apiFetch<{ examined: number; sent: number; skipped: number; failed: number }>(`/organizations/${orgId}/offline-conversions/upload-recent`, { method: "POST", body: JSON.stringify({ platform: "meta", days: 30 }) }); setNotice(t("ads.ocBackfillNotice", { platform: "Meta", examined: fmtNumber(locale, res.examined), sent: fmtNumber(locale, res.sent), skipped: fmtNumber(locale, res.skipped), failed: fmtNumber(locale, res.failed) })); await load(); } catch (e) { setError(e instanceof Error ? e.message : t("ads.ocBackfillFailed")); }
          }}>{t("ads.ocBackfillMeta")}</button>
        </div>
        {ocLogs.length > 0 ? (
          <ul className="space-y-1 text-xs leading-[1.7] text-slate-500">
            {ocLogs.slice(0, 8).map((l) => <li key={l.id} className="break-words">{l.platform} · {l.eventId} · <b>{l.status}</b>{l.detail ? ` — ${l.detail}` : ""} · {fmtDateTime(locale, l.createdAt)}</li>)}
          </ul>
        ) : (
          <div className="flex flex-wrap items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <span aria-hidden="true" className="text-lg leading-none">📭</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-[1.7] text-slate-600">{t("ads.ocNoLogs")}</p>
              <button type="button" className="btn-secondary btn-sm mt-2" onClick={() => scrollToSection("oc-settings")}>{t("ads.ocGoSettings")}</button>
            </div>
          </div>
        )}
      </div>

      <div className="card space-y-4 p-5">
        <h2 className="font-semibold">{t("ads.pubTitle")}</h2>
        <p className="text-sm leading-[1.7] text-slate-500">{t("ads.pubIntro")}</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <form className="space-y-2 rounded-xl bg-slate-50 p-4" onSubmit={async (e) => {
            e.preventDefault();
            const orgId = getOrganizationId(); if (!orgId) return;
            const acc = accounts.find((x) => x.platform === "google" && x.integrationId);
            if (!acc) { setError(t("ads.pubNeedGoogle")); return; }
            setBusy("gpub"); setError("");
            try {
              const pub = await apiFetch<any>(`/organizations/${orgId}/publish/google`, { method: "POST", body: JSON.stringify({
                adAccountId: acc.id, name: gForm.name, dailyBudget: gForm.dailyBudget,
                countryCodes: gForm.countries.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean),
                headlines: gForm.headlines.split("\n").map((x) => x.trim()).filter(Boolean),
                descriptions: gForm.descriptions.split("\n").map((x) => x.trim()).filter(Boolean),
                finalUrl: gForm.finalUrl,
                keywords: gKeywords.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [text, mt] = l.split("|").map((x) => x.trim()); return { text, matchType: mt || undefined }; }),
                negativeKeywords: gNegatives.split(",").map((x) => x.trim()).filter(Boolean),
                sitelinks: gSitelinks.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [text, url] = l.split("|").map((x) => x.trim()); return { text, url }; }),
                callouts: gCallouts.split(",").map((x) => x.trim()).filter(Boolean),
              }) });
              setNotice(pub.status === "created_paused" ? t("ads.pubGoogleCreated") : t("ads.pubGoogleFailed", { error: pub.error }));
              await load();
            } catch (err) { setError(err instanceof Error ? err.message : "Publish failed"); }
            finally { setBusy(""); }
          }}>
            <div className="font-medium">Google Search Campaign</div>
            <input className="input" placeholder={t("ads.pubCampaignName")} value={gForm.name} onChange={(e) => setGForm({ ...gForm, name: e.target.value })} required />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input className="input" placeholder={t("ads.pubDailyBudget")} value={gForm.dailyBudget} onChange={(e) => setGForm({ ...gForm, dailyBudget: e.target.value })} required />
              <input className="input" placeholder={t("ads.pubCountriesGoogle")} value={gForm.countries} onChange={(e) => setGForm({ ...gForm, countries: e.target.value })} required />
            </div>
            <textarea className="input" rows={3} placeholder={t("ads.pubHeadlinesGoogle")} value={gForm.headlines} onChange={(e) => setGForm({ ...gForm, headlines: e.target.value })} required />
            <textarea className="input" rows={2} placeholder={t("ads.pubDescriptionsGoogle")} value={gForm.descriptions} onChange={(e) => setGForm({ ...gForm, descriptions: e.target.value })} required />
            <input className="input" placeholder="Final URL (https://...)" value={gForm.finalUrl} onChange={(e) => setGForm({ ...gForm, finalUrl: e.target.value })} required />
            <textarea className="input md:col-span-2" rows={3} placeholder={t("ads.pubKeywords")} value={gKeywords} onChange={(e) => setGKeywords(e.target.value)} required />
            <input className="input md:col-span-2" placeholder={t("ads.pubNegatives")} value={gNegatives} onChange={(e) => setGNegatives(e.target.value)} />
            <textarea className="input md:col-span-2" rows={2} placeholder={t("ads.pubSitelinks")} value={gSitelinks} onChange={(e) => setGSitelinks(e.target.value)} />
            <input className="input md:col-span-2" placeholder={t("ads.pubCallouts")} value={gCallouts} onChange={(e) => setGCallouts(e.target.value)} />
            <button className="btn-primary btn-sm" disabled={busy !== ""}>{busy === "gpub" ? t("ads.pubCreating") : t("ads.pubCreateGoogle")}</button>
          </form>
          <form className="space-y-2 rounded-xl bg-slate-50 p-4" onSubmit={async (e) => {
            e.preventDefault();
            const orgId = getOrganizationId(); if (!orgId) return;
            const acc = accounts.find((x) => x.platform === "tiktok" && x.integrationId);
            if (!acc) { setError(t("ads.pubNeedTiktok")); return; }
            setBusy("tpub"); setError("");
            try {
              const pub = await apiFetch<any>(`/organizations/${orgId}/publish/tiktok`, { method: "POST", body: JSON.stringify({
                adAccountId: acc.id, name: tForm.name, dailyBudget: tForm.dailyBudget,
                countryCodes: tForm.countries.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean),
                adText: tForm.adText, landingUrl: tForm.landingUrl, imageUrl: tForm.imageUrl || undefined, videoUrl: tForm.videoUrl || undefined,
              }) });
              setNotice(pub.status === "created_paused" ? t("ads.pubTiktokCreated") : t("ads.pubTiktokFailed", { error: pub.error }));
              await load();
            } catch (err) { setError(err instanceof Error ? err.message : "Publish failed"); }
            finally { setBusy(""); }
          }}>
            <div className="font-medium">TikTok Traffic Campaign</div>
            <input className="input" placeholder={t("ads.pubCampaignName")} value={tForm.name} onChange={(e) => setTForm({ ...tForm, name: e.target.value })} required />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input className="input" placeholder={t("ads.pubDailyBudget")} value={tForm.dailyBudget} onChange={(e) => setTForm({ ...tForm, dailyBudget: e.target.value })} required />
              <input className="input" placeholder={t("ads.pubCountriesTiktok")} value={tForm.countries} onChange={(e) => setTForm({ ...tForm, countries: e.target.value })} required />
            </div>
            <input className="input" placeholder="Ad Text" value={tForm.adText} onChange={(e) => setTForm({ ...tForm, adText: e.target.value })} required />
            <input className="input" placeholder="Landing URL" value={tForm.landingUrl} onChange={(e) => setTForm({ ...tForm, landingUrl: e.target.value })} required />
            <input className="input" placeholder={t("ads.pubImageUrl")} value={tForm.imageUrl} onChange={(e) => setTForm({ ...tForm, imageUrl: e.target.value })} />
            <input className="input" placeholder={t("ads.pubVideoUrl")} value={tForm.videoUrl} onChange={(e) => setTForm({ ...tForm, videoUrl: e.target.value })} />
            <button className="btn-primary btn-sm" disabled={busy !== ""}>{busy === "tpub" ? t("ads.pubCreating") : t("ads.pubCreateTiktok")}</button>
          </form>
        </div>
        <form className="space-y-2 rounded-xl bg-slate-50 p-4" onSubmit={async (e) => {
          e.preventDefault();
          const orgId = getOrganizationId(); if (!orgId) return;
          const acc = accounts.find((x) => x.platform === "google" && x.integrationId);
          if (!acc) { setError(t("ads.pubNeedGoogle")); return; }
          setBusy("ppub"); setError("");
          try {
            const lines = (v: string) => v.split("\n").map((x) => x.trim()).filter(Boolean);
            const pub = await apiFetch<any>(`/organizations/${orgId}/publish/google-pmax`, { method: "POST", body: JSON.stringify({
              adAccountId: acc.id, name: pForm.name, dailyBudget: pForm.dailyBudget,
              countryCodes: pForm.countries.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean),
              finalUrl: pForm.finalUrl, businessName: pForm.businessName,
              headlines: lines(pForm.headlines), longHeadlines: lines(pForm.longHeadlines), descriptions: lines(pForm.descriptions),
              logoUrl: pForm.logoUrl, imageUrls: lines(pForm.imageUrls),
            }) });
            setNotice(pub.status === "created_paused" ? t("ads.pubPmaxCreated") : t("ads.pubPmaxFailed", { error: pub.error }));
            await load();
          } catch (err) { setError(err instanceof Error ? err.message : "Publish failed"); }
          finally { setBusy(""); }
        }}>
          <div className="font-medium">Google Performance Max (Asset Group)</div>
          <p className="text-xs leading-[1.7] text-slate-500">{t("ads.pubPmaxNote")}</p>
          <div className="grid gap-2 md:grid-cols-2">
            <input className="input" placeholder={t("ads.pubCampaignName")} value={pForm.name} onChange={(e) => setPForm({ ...pForm, name: e.target.value })} required />
            <input className="input" placeholder={t("ads.pubBusinessName")} value={pForm.businessName} onChange={(e) => setPForm({ ...pForm, businessName: e.target.value })} required />
            <input className="input" placeholder={t("ads.pubDailyBudget")} value={pForm.dailyBudget} onChange={(e) => setPForm({ ...pForm, dailyBudget: e.target.value })} required />
            <input className="input" placeholder={t("ads.pubCountriesGoogle")} value={pForm.countries} onChange={(e) => setPForm({ ...pForm, countries: e.target.value })} required />
            <input className="input" placeholder="Final URL (https://...)" value={pForm.finalUrl} onChange={(e) => setPForm({ ...pForm, finalUrl: e.target.value })} required />
            <input className="input" placeholder={t("ads.pubLogoUrl")} value={pForm.logoUrl} onChange={(e) => setPForm({ ...pForm, logoUrl: e.target.value })} required />
            <textarea className="input" rows={3} placeholder={t("ads.pubHeadlinesPmax")} value={pForm.headlines} onChange={(e) => setPForm({ ...pForm, headlines: e.target.value })} required />
            <textarea className="input" rows={3} placeholder={t("ads.pubImageUrls")} value={pForm.imageUrls} onChange={(e) => setPForm({ ...pForm, imageUrls: e.target.value })} required />
            <textarea className="input" rows={2} placeholder={t("ads.pubLongHeadlines")} value={pForm.longHeadlines} onChange={(e) => setPForm({ ...pForm, longHeadlines: e.target.value })} required />
            <textarea className="input" rows={2} placeholder={t("ads.pubDescriptionsPmax")} value={pForm.descriptions} onChange={(e) => setPForm({ ...pForm, descriptions: e.target.value })} required />
          </div>
          <button className="btn-primary btn-sm" disabled={busy !== ""}>{busy === "ppub" ? t("ads.pubCreating") : t("ads.pubCreatePmax")}</button>
        </form>
        {pubs.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {pubs.slice(0, 8).map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 [&>*]:min-w-0 [&>*]:break-words">
                <span className="capitalize">{p.platform} · {p.name}</span>
                <span className={p.status === "created_paused" ? "text-green-600" : p.status === "failed" ? "text-red-600" : "text-slate-500"}>{p.status}{p.externalCampaignId ? ` · ${p.externalCampaignId}` : ""}{p.error ? ` · ${p.error}` : ""}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">📡 Meta Conversions API (CAPI)</h2>
          <span className={capi?.configured && capi.enabled ? "badge-green" : "badge-slate"}>{capi?.configured ? (capi.enabled ? t("ads.capiOn") : t("ads.capiOff")) : t("ads.capiNotSetup")}</span>
        </div>
        <p className="text-sm leading-[1.7] text-slate-500">{t("ads.capiIntro")}</p>
        {capi !== null && !capi.configured ? (
          <div className="flex flex-wrap items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <span aria-hidden="true" className="text-lg leading-none">⚠️</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm leading-[1.7] text-amber-800">{t("ads.capiNotSetupBody")}</p>
              <button type="button" className="btn-secondary btn-sm mt-2" onClick={() => scrollToSection("capi-settings")}>{t("ads.capiGoForm")}</button>
            </div>
          </div>
        ) : null}
        <form id="capi-settings" className="grid gap-2 sm:grid-cols-3" onSubmit={async (e) => {
          e.preventDefault();
          const orgId = getOrganizationId(); if (!orgId) return;
          setBusy("capi"); setError("");
          try {
            const s = await apiFetch(`/organizations/${orgId}/conversions/settings`, { method: "PATCH", body: JSON.stringify({ ...capiForm, accessToken: capiForm.accessToken || undefined, testEventCode: capiForm.testEventCode || null }) });
            setCapi(s as any); setCapiForm({ ...capiForm, accessToken: "" }); setNotice(t("ads.capiSaved"));
          } catch (err) { setError(err instanceof Error ? err.message : "Save failed"); }
          finally { setBusy(""); }
        }}>
          <label className="block text-sm">{t("ads.capiPixelLabel")}<input className="input mt-1" value={capiForm.pixelId} onChange={(e) => setCapiForm({ ...capiForm, pixelId: e.target.value })} required placeholder={t("ads.capiPixelPlaceholder")} /></label>
          <label className="block text-sm">{t("ads.capiTokenLabel")}<input className="input mt-1" type="password" value={capiForm.accessToken} onChange={(e) => setCapiForm({ ...capiForm, accessToken: e.target.value })} placeholder={capi?.hasDedicatedToken ? t("ads.capiTokenSavedPlaceholder") : t("ads.capiTokenEmptyPlaceholder")} /></label>
          <label className="block text-sm">{t("ads.capiTestCodeLabel")}<input className="input mt-1" value={capiForm.testEventCode} onChange={(e) => setCapiForm({ ...capiForm, testEventCode: e.target.value })} placeholder="TEST12345" /></label>
          <label className="block text-sm">{t("ads.capiTriggerLabel")}
            <select className="input mt-1" value={capiForm.purchaseTrigger} onChange={(e) => setCapiForm({ ...capiForm, purchaseTrigger: e.target.value })}>
              <option value="placed">{t("ads.capiTriggerPlaced")}</option>
              <option value="cod_confirmed">{t("ads.capiTriggerCod")}</option>
              <option value="delivered">{t("ads.capiTriggerDelivered")}</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={capiForm.enabled} onChange={(e) => setCapiForm({ ...capiForm, enabled: e.target.checked })} /> {t("ads.capiEnabledLabel")}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={capiForm.sendLeadEvents} onChange={(e) => setCapiForm({ ...capiForm, sendLeadEvents: e.target.checked })} /> {t("ads.capiLeadLabel")}</label>
          <span className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy !== ""}>{busy === "capi" ? t("ads.capiSaving") : t("ads.capiSave")}</button>
            <button type="button" className="btn-secondary" disabled={busy !== ""} onClick={async () => {
              const orgId = getOrganizationId(); if (!orgId) return;
              setBusy("capitest"); setError("");
              try { await apiFetch(`/organizations/${orgId}/conversions/test`, { method: "POST" }); setNotice(t("ads.capiTestSent")); await load(); }
              catch (err) { setError(err instanceof Error ? err.message : "Test failed"); }
              finally { setBusy(""); }
            }}>{busy === "capitest" ? t("ads.capiSending") : t("ads.capiTestSend")}</button>
          </span>
        </form>
        {capiEvents.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[620px] text-left text-xs">
              <thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2">Event</th><th className="px-3 py-2">{t("ads.capiThSource")}</th><th className="px-3 py-2">Event ID</th><th className="px-3 py-2">{t("ads.capiThStatus")}</th><th className="px-3 py-2">{t("ads.capiThTime")}</th></tr></thead>
              <tbody>{capiEvents.slice(0, 10).map((ev) => (
                <tr key={ev.id} className="border-t"><td className="px-3 py-2 font-medium">{ev.eventName}</td><td className="px-3 py-2">{ev.sourceType}</td><td className="px-3 py-2">{ev.eventId}</td><td className="px-3 py-2">{ev.status === "sent" ? <span className="text-green-600">✓ sent ({ev.eventsReceived})</span> : <span className="text-red-600" title={ev.error ?? ""}>✗ failed</span>}</td><td className="px-3 py-2">{fmtDateTime(locale, ev.createdAt)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        ) : null}
      </div>

      <form onSubmit={createAccount} className="space-y-3 card p-5">
        <div className="font-semibold">{t("ads.aaCreateTitle")}</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm">{t("ads.aaPlatformField")}
            <select className={inputCls} value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
              <option value="meta">Meta</option><option value="google">Google</option><option value="tiktok">TikTok</option><option value="manual">Manual / Other</option>
            </select>
          </label>
          <label className="block text-sm">{t("ads.aaNameField")}<input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Main Facebook Ads" /></label>
          <label className="block text-sm">{t("ads.aaAccountIdField")}<input className={inputCls} value={form.externalId} onChange={(e) => setForm({ ...form, externalId: e.target.value })} placeholder="act_123456" /></label>
          <label className="block text-sm">{t("ads.aaCurrencyField")}<input className={inputCls} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} /></label>
        </div>
        <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>{t("ads.aaCreateBtn")}</button>
      </form>

      <form id="connect-google" onSubmit={connectGoogle} className="space-y-3 card p-5">
        <div className="font-semibold">{t("ads.aaGoogleConnectTitle")}</div>
        <p className="text-sm leading-[1.7] text-slate-500">
          {t("ads.aaGoogleConnectBody")}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm">Customer ID<input className={inputCls} value={googleForm.customerId} onChange={(e) => setGoogleForm({ ...googleForm, customerId: e.target.value })} required placeholder="123-456-7890" /></label>
          <label className="block text-sm">Developer Token<input className={inputCls} type="password" value={googleForm.developerToken} onChange={(e) => setGoogleForm({ ...googleForm, developerToken: e.target.value })} required /></label>
          <label className="block text-sm">OAuth Client ID<input className={inputCls} value={googleForm.clientId} onChange={(e) => setGoogleForm({ ...googleForm, clientId: e.target.value })} required /></label>
          <label className="block text-sm">OAuth Client Secret<input className={inputCls} type="password" value={googleForm.clientSecret} onChange={(e) => setGoogleForm({ ...googleForm, clientSecret: e.target.value })} required /></label>
          <label className="block text-sm">Refresh Token<input className={inputCls} type="password" value={googleForm.refreshToken} onChange={(e) => setGoogleForm({ ...googleForm, refreshToken: e.target.value })} required /></label>
          <label className="block text-sm">{t("ads.aaMccLabel")}<input className={inputCls} value={googleForm.loginCustomerId} onChange={(e) => setGoogleForm({ ...googleForm, loginCustomerId: e.target.value })} placeholder={t("ads.aaOptionalPlaceholder")} /></label>
        </div>
        <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>
          {busy === "google" ? t("ads.aaVerifying") : t("ads.aaGoogleConnectBtn")}
        </button>
      </form>

      <form id="connect-tiktok" onSubmit={connectTikTok} className="space-y-3 card p-5">
        <div className="font-semibold">{t("ads.aaTiktokConnectTitle")}</div>
        <p className="text-sm leading-[1.7] text-slate-500">{t("ads.aaTiktokConnectBody")}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm">Advertiser ID<input className={inputCls} value={tiktokForm.advertiserId} onChange={(e) => setTiktokForm({ ...tiktokForm, advertiserId: e.target.value })} required /></label>
          <label className="block text-sm">Access Token<input className={inputCls} type="password" value={tiktokForm.accessToken} onChange={(e) => setTiktokForm({ ...tiktokForm, accessToken: e.target.value })} required /></label>
        </div>
        <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>
          {busy === "tiktok" ? t("ads.aaVerifying") : t("ads.aaTiktokConnectBtn")}
        </button>
      </form>
    </div>
  );
}
