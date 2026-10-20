"use client";

import { useCallback, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  ConnectionAccount,
  HealthCheckRunView,
  TimelineItemView,
  CommerceDiagnosticsView,
  SyncHistoryItem,
  SEVERITY_META,
  timelineKindLabel,
  formatWhen,
  overallMeta,
  stepStatusMeta,
  whatsappHealth,
  qualityMeta,
  completenessItems,
  COMPLETENESS_META,
  adBucketMeta,
  canPauseSync,
  canRefreshProviderHealth,
  syncIntervalPresets,
  syncIntervalLabel,
  syncJobStatusLabel,
  webhookTopics,
  webhookTopicMeta,
} from "@/lib/connections";
import { useLocale } from "@/lib/i18n/provider";
import { fmtNumber } from "@repo/contracts";

/**
 * CC11 + CC13, per account card: "পরীক্ষা করুন" runs the
 * Connection Doctor NOW (live provider calls server-side) and
 * renders the recorded steps exactly as the provider answered —
 * pass / fail / "যাচাই সম্ভব নয়" (not_checkable), never upgraded.
 * The expanded section shows the run history and the CC13
 * timeline (real audit / sync / webhook / health-check / payment
 * records only). Retry actions exist ONLY where a real operation
 * exists: re-run diagnose, re-run store sync.
 *
 * CC14/CC15/CC16 additions: the provider's OWN health snapshot
 * (WhatsApp quality/limit + WABA status; Meta Page completeness
 * checklist; ad-account payment-on-file) rendered exactly as
 * stored — absent fields read "তথ্য নেই" — with a refresh action
 * that re-fetches server-side. Commerce integrations get a
 * diagnostics section: the stored webhook record per topic, a
 * REAL re-register action through the existing EC2 machinery
 * (its outcome is shown verbatim), the Shopify scope diff, and
 * tracker freshness from the real abandoned-checkout records.
 */

function targetPath(account: ConnectionAccount): string {
  return `/organizations/${getOrganizationId()}/connections/targets/${encodeURIComponent(account.source)}/${encodeURIComponent(account.id)}`;
}

function StepsList({ run }: { run: HealthCheckRunView }) {
  const { locale } = useLocale();
  return (
    <ul className="space-y-1.5">
      {run.steps.map((step) => {
        const meta = stepStatusMeta(step.status, locale);
        return (
          <li key={step.key} className="flex flex-wrap items-start gap-2 text-xs">
            <span className={`shrink-0 rounded-full px-2 py-0.5 font-semibold ${meta.cls}`}>{meta.label}</span>
            <span className="min-w-0">
              <span className="font-semibold text-slate-700">{step.label}: </span>
              <span className="text-slate-500">{step.message}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function AccountInsights({ account, onChanged }: { account: ConnectionAccount; onChanged?: () => void }) {
  const { dict, t, locale } = useLocale();
  const D = dict.connections;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [latestRun, setLatestRun] = useState<HealthCheckRunView | null>(null);
  const [history, setHistory] = useState<HealthCheckRunView[]>([]);
  const [timeline, setTimeline] = useState<TimelineItemView[]>([]);
  const [webhookStatus, setWebhookStatus] = useState<unknown>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // CC14/CC15: after a manual refresh the fresh snapshot replaces
  // the overview's copy locally (undefined = use the account's).
  const [phOverride, setPhOverride] = useState<{ health: Record<string, any> | null; at: string | null; error: string | null } | undefined>(undefined);
  const [diagnostics, setDiagnostics] = useState<CommerceDiagnosticsView | null>(null);
  // CC18: sync pause (local override after a toggle; undefined =
  // use the overview's value) + the per-connection sync history.
  const [pausedOverride, setPausedOverride] = useState<boolean | undefined>(undefined);
  const [syncHistory, setSyncHistory] = useState<SyncHistoryItem[] | null>(null);
  // CC30: sync cadence (local override after a save; undefined =
  // use the overview's value) + the custom-minutes draft.
  const [intervalOverride, setIntervalOverride] = useState<number | null | undefined>(undefined);
  const [customInterval, setCustomInterval] = useState("");
  const [customMode, setCustomMode] = useState(false);

  const loadDetails = useCallback(async (problems: boolean, cursor?: string) => {
    try {
      const [runs, tl] = await Promise.all([
        apiFetch<HealthCheckRunView[]>(`${targetPath(account)}/health-checks?limit=10`),
        apiFetch<{ items: TimelineItemView[]; nextCursor: string | null; webhookStatus: unknown }>(
          `${targetPath(account)}/timeline?limit=20&onlyProblems=${problems ? "true" : "false"}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        ),
      ]);
      setHistory(runs);
      setTimeline((prev) => (cursor ? [...prev, ...tl.items] : tl.items));
      setNextCursor(tl.nextCursor);
      setWebhookStatus(tl.webhookStatus);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : D.aiLoadFailed);
    }
  }, [account]);

  async function diagnose() {
    setBusy("diagnose"); setError(""); setNotice("");
    try {
      const run = await apiFetch<HealthCheckRunView>(`${targetPath(account)}/diagnose`, { method: "POST" });
      setLatestRun(run);
      setNotice(t("connections.aiDiagnoseDone", { label: overallMeta(run.overall, locale).label }));
      onChanged?.();
      if (open) await loadDetails(onlyProblems);
    } catch (e) {
      setError(e instanceof Error ? e.message : D.aiDiagnoseFailed);
    } finally { setBusy(""); }
  }

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && !loaded) await loadDetails(onlyProblems);
  }

  async function changeProblems(checked: boolean) {
    setOnlyProblems(checked);
    await loadDetails(checked);
  }

  async function snooze(hours: number) {
    setBusy("snooze"); setError(""); setNotice("");
    try {
      await apiFetch(`${targetPath(account)}/snooze`, { method: "POST", body: JSON.stringify({ hours }) });
      setNotice(hours > 0 ? t("connections.aiSnoozeSet", { hours: fmtNumber(locale, hours) }) : D.aiSnoozeOff);
    } catch (e) {
      setError(e instanceof Error ? e.message : D.aiSnoozeFailed);
    } finally { setBusy(""); }
  }

  async function resync(kind: "products" | "orders") {
    setBusy(`sync-${kind}`); setError(""); setNotice("");
    try {
      const orgId = getOrganizationId();
      const job = await apiFetch<{ status?: string; fetched?: number }>(`/organizations/${orgId}/integrations/${account.id}/sync/${kind}`, { method: "POST" });
      setNotice(t("connections.aiSyncDone", { kind: kind === "products" ? D.aiProducts : D.aiOrders, status: job.status ?? D.aiDoneStatus, fetched: typeof job.fetched === "number" ? t("connections.aiFetchedPart", { count: fmtNumber(locale, job.fetched) }) : "" }));
      onChanged?.();
      if (open) await loadDetails(onlyProblems);
    } catch (e) {
      setError(e instanceof Error ? e.message : D.aiSyncFailed);
    } finally { setBusy(""); }
  }

  async function loadSyncHistory() {
    setBusy("sync-history"); setError("");
    try {
      const orgId = getOrganizationId();
      const res = await apiFetch<{ jobs: SyncHistoryItem[] }>(`/organizations/${orgId}/connections/${account.id}/sync-history?limit=15`);
      setSyncHistory(res.jobs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : D.aiHistoryFailed);
    } finally { setBusy(""); }
  }

  async function toggleSyncPaused() {
    const next = !(pausedOverride ?? account.syncPaused ?? false);
    setBusy("sync-pause"); setError(""); setNotice("");
    try {
      const orgId = getOrganizationId();
      await apiFetch(`/organizations/${orgId}/connections/${account.id}/sync-paused`, {
        method: "PATCH", body: JSON.stringify({ syncPaused: next }),
      });
      setPausedOverride(next);
      setNotice(next ? D.aiPausedNotice : D.aiResumedNotice);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : D.aiPauseFailed);
    } finally { setBusy(""); }
  }

  async function setSyncInterval(minutes: number | null) {
    setBusy("sync-interval"); setError(""); setNotice("");
    try {
      const orgId = getOrganizationId();
      await apiFetch(`/organizations/${orgId}/connections/${account.id}/sync-interval`, {
        method: "PATCH", body: JSON.stringify({ syncIntervalMinutes: minutes }),
      });
      setIntervalOverride(minutes);
      setNotice(minutes === null
        ? D.aiCadenceCleared
        : t("connections.aiCadenceSet", { label: syncIntervalLabel(minutes, locale) }));
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : D.aiCadenceFailed);
    } finally { setBusy(""); }
  }

  async function refreshProviderHealth() {
    setBusy("provider-health"); setError(""); setNotice("");
    try {
      const res = await apiFetch<{ ok: boolean; error?: string; providerHealth: Record<string, any> | null; providerHealthAt: string | null; providerHealthError: string | null }>(
        `${targetPath(account)}/provider-health/refresh`, { method: "POST" },
      );
      setPhOverride({ health: res.providerHealth, at: res.providerHealthAt, error: res.providerHealthError });
      setNotice(res.ok
        ? D.aiHealthRefreshed
        : t("connections.aiHealthFetchFailed", { err: res.error ?? res.providerHealthError ?? D.aiUnknownErr }));
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : D.aiHealthLoadFailed);
    } finally { setBusy(""); }
  }

  async function loadDiagnostics() {
    setBusy("diagnostics"); setError(""); setNotice("");
    try {
      const orgId = getOrganizationId();
      const diag = await apiFetch<CommerceDiagnosticsView>(`/organizations/${orgId}/connections/${account.id}/commerce-diagnostics`);
      setDiagnostics(diag);
    } catch (e) {
      setError(e instanceof Error ? e.message : D.aiDiagLoadFailed);
    } finally { setBusy(""); }
  }

  async function repairWebhooks() {
    setBusy("repair-webhooks"); setError(""); setNotice("");
    try {
      const orgId = getOrganizationId();
      const res = await apiFetch<{ webhookRegistration: string | null }>(`/organizations/${orgId}/connections/${account.id}/repair-webhooks`, { method: "POST" });
      setNotice(t("connections.aiRepairDone", { result: res.webhookRegistration ?? D.aiUnknown }));
      onChanged?.();
      await loadDiagnostics();
    } catch (e) {
      setError(e instanceof Error ? e.message : D.aiRepairFailed);
    } finally { setBusy(""); }
  }

  const effectiveAccount: ConnectionAccount = phOverride
    ? { ...account, providerHealth: phOverride.health, providerHealthAt: phOverride.at, providerHealthError: phOverride.error }
    : account;
  const waHealth = whatsappHealth(effectiveAccount);
  const completeness = completenessItems(effectiveAccount, locale);
  const canRefreshHealth = canRefreshProviderHealth(account);
  const isCommerce = account.source === "integration" && (account.provider === "woocommerce" || account.provider === "shopify");
  const healthAtText = formatWhen(effectiveAccount.providerHealthAt ?? null, locale);

  const canSync = account.source === "integration" && (account.provider === "woocommerce" || account.provider === "shopify");
  const webhookText = webhookStatus && typeof webhookStatus === "object"
    ? JSON.stringify(webhookStatus)
    : null;

  return (
    <div className="space-y-2 border-t border-slate-100 pt-2.5">
      <div className="flex flex-wrap gap-1.5">
        <button type="button" disabled={busy === "diagnose"} onClick={() => void diagnose()} className="rounded-lg bg-teal-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
          {busy === "diagnose" ? D.aiDiagnosing : D.aiDiagnoseBtn}
        </button>
        <button type="button" onClick={() => void toggleOpen()} className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-200">
          {open ? D.aiHideDetails : D.aiHistoryBtn}
        </button>
        <select
          aria-label={D.aiAriaSnooze}
          disabled={busy === "snooze"}
          defaultValue=""
          onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) void snooze(v); e.target.value = ""; }}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-600"
        >
          <option value="" disabled>{D.aiSnoozeOpt}</option>
          <option value="24">{t("connections.aiHoursOpt", { n: fmtNumber(locale, 24) })}</option>
          <option value="72">{t("connections.aiDaysOpt", { n: fmtNumber(locale, 3) })}</option>
          <option value="168">{t("connections.aiDaysOpt", { n: fmtNumber(locale, 7) })}</option>
          <option value="0">{D.aiSnoozeLift}</option>
        </select>
      </div>

      {error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}
      {notice ? <p className="text-xs font-medium text-green-700">{notice}</p> : null}

      {canPauseSync(account) ? (
        <div className="space-y-2 rounded-lg bg-slate-50 p-2.5 ring-1 ring-inset ring-slate-100">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-600">{D.aiSyncControl}</span>
            {(pausedOverride ?? account.syncPaused ?? false) ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">{D.aiSyncPausedChip}</span>
            ) : (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">{D.aiSyncOnChip}</span>
            )}
            <button type="button" disabled={busy === "sync-pause"} onClick={() => void toggleSyncPaused()} className="rounded-lg bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
              {busy === "sync-pause" ? D.rfWorking : (pausedOverride ?? account.syncPaused ?? false) ? D.aiResumeSync : D.aiPauseSync}
            </button>
            <button type="button" disabled={busy === "sync-history"} onClick={() => void loadSyncHistory()} className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-50">
              {busy === "sync-history" ? dict.common.loading : D.aiSyncHistoryBtn}
            </button>
          </div>
          <p className="text-[11px] leading-snug text-slate-400">{D.aiPauseExplain}</p>
          {isCommerce ? (() => {
            const effectiveInterval = intervalOverride !== undefined ? intervalOverride : (account.syncIntervalMinutes ?? null);
            const selectValue = customMode ? "custom" : effectiveInterval === null ? "default" : syncIntervalPresets(locale).some((p) => p.minutes === effectiveInterval) ? String(effectiveInterval) : "custom";
            return (
              <div className="space-y-1.5 border-t border-slate-200/70 pt-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-slate-600">{D.aiCadenceLabel}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{syncIntervalLabel(effectiveInterval, locale)}</span>
                  <select
                    aria-label="Sync cadence"
                    disabled={busy === "sync-interval"}
                    value={selectValue}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "custom") { setCustomMode(true); setCustomInterval(effectiveInterval !== null && !syncIntervalPresets(locale).some((p) => p.minutes === effectiveInterval) ? String(effectiveInterval) : ""); return; }
                      setCustomMode(false);
                      void setSyncInterval(v === "default" ? null : Number(v));
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600"
                  >
                    <option value="default">{D.aiCadenceDefault}</option>
                    {syncIntervalPresets(locale).map((p) => (
                      <option key={p.minutes} value={String(p.minutes)}>{p.label}</option>
                    ))}
                    <option value="custom">{D.aiCustomOpt}</option>
                  </select>
                  {selectValue === "custom" ? (
                    <>
                      <input
                        type="number" min={5} max={10080} step={1}
                        value={customInterval}
                        onChange={(e) => setCustomInterval(e.target.value)}
                        placeholder={t("connections.aiMinutesPh", { min: fmtNumber(locale, 5), max: fmtNumber(locale, 10080) })}
                        className="w-28 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                      />
                      <button
                        type="button"
                        disabled={busy === "sync-interval" || !/^\d+$/.test(customInterval) || Number(customInterval) < 5 || Number(customInterval) > 10080}
                        onClick={() => void setSyncInterval(Number(customInterval))}
                        className="rounded-lg bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                      >
                        {busy === "sync-interval" ? D.rfWorking : D.aiSetBtn}
                      </button>
                    </>
                  ) : null}
                </div>
                <p className="text-[11px] leading-snug text-slate-400">
                  {D.aiCadenceExplain}{formatWhen(account.lastSyncAt, locale) ?? D.aiNoRecord}{D.aiCadenceExplainSuffix}
                </p>
              </div>
            );
          })() : null}
          {syncHistory ? (
            syncHistory.length === 0 ? (
              <p className="text-[11px] text-slate-400">{D.aiNoSyncRecords}</p>
            ) : (
              <ul className="space-y-1">
                {syncHistory.map((job) => (
                  <li key={job.id} className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span className={`rounded-full px-1.5 py-0.5 font-semibold ${job.error === "sync_paused" ? "bg-amber-100 text-amber-700" : job.status === "FAILED" ? "bg-red-100 text-red-700" : job.status === "COMPLETED" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>
                      {syncJobStatusLabel(job, locale)}
                    </span>
                    <span className="font-medium text-slate-700">{job.kind}</span>
                    <span>{t("connections.aiSyncCounts", { fetched: fmtNumber(locale, job.fetched), created: fmtNumber(locale, job.created), updated: fmtNumber(locale, job.updated), skipped: fmtNumber(locale, job.skipped) })}</span>
                    {job.error && job.error !== "sync_paused" ? <span className="text-red-500">{job.error}</span> : null}
                    <span className="text-slate-400">{formatWhen(job.startedAt, locale)}</span>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      ) : null}

      {(canRefreshHealth || waHealth || completeness.length > 0 || effectiveAccount.providerHealthError) ? (
        <div className="space-y-2 rounded-lg bg-slate-50 p-2.5 ring-1 ring-inset ring-slate-100">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-600">{D.aiHealthTitle}</span>
            {healthAtText
              ? <span className="text-[11px] text-slate-400">{D.aiLastFetched}{healthAtText}</span>
              : <span className="text-[11px] text-slate-400">{D.aiNotFetched}</span>}
            {canRefreshHealth ? (
              <button type="button" disabled={busy === "provider-health"} onClick={() => void refreshProviderHealth()} className="rounded-lg bg-teal-50 px-2.5 py-1 text-[11px] font-semibold text-teal-700 hover:bg-teal-100 disabled:opacity-50">
                {busy === "provider-health" ? D.aiFetching : D.aiRefreshHealthBtn}
              </button>
            ) : null}
          </div>

          {waHealth ? (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {waHealth.qualityRating
                ? <span className={`rounded-full px-2 py-0.5 font-semibold ${qualityMeta(waHealth.qualityRating, locale).cls}`}>{qualityMeta(waHealth.qualityRating, locale).label}</span>
                : <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-500">{D.aiQualityNone}</span>}
              {waHealth.messagingLimit ? <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">Messaging limit: {waHealth.messagingLimit}</span> : null}
              {waHealth.wabaReviewStatus ? <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">WABA review: {waHealth.wabaReviewStatus}</span> : null}
              {waHealth.displayPhoneNumber ? <span className="text-slate-500">{waHealth.displayPhoneNumber}{waHealth.verifiedName ? ` · ${waHealth.verifiedName}` : ""}</span> : null}
              {waHealth.wabaError ? <span className="font-medium text-amber-600">WABA: {waHealth.wabaError}</span> : null}
            </div>
          ) : null}

          {completeness.length > 0 ? (
            <ul className="space-y-1">
              {completeness.map((item) => (
                <li key={item.key} className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className={`rounded-full px-1.5 py-0.5 font-bold ${COMPLETENESS_META[item.state].cls}`}>
                    {COMPLETENESS_META[item.state].icon} {item.state === "unknown" ? D.haNoInfo : item.state === "yes" ? D.aiStateYes : D.aiStateNo}
                  </span>
                  <span className="font-medium text-slate-700">{item.label}</span>
                  {item.detail ? <span className="text-slate-400">{item.detail}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}

          {effectiveAccount.providerHealth?.kind === "meta_page" && completeness.some((i) => i.state === "no") ? (
            <p className="text-[11px] leading-snug text-slate-500">{D.aiMetaMissingNote}</p>
          ) : null}

          {account.source === "ad_account" ? (
            <div className="text-[11px] text-slate-500">
              {D.aiPlatformStatus}
              <span className={`rounded-full px-1.5 py-0.5 font-semibold ${adBucketMeta(account.platformStatusBucket, locale).cls}`}>{adBucketMeta(account.platformStatusBucket, locale).label}</span>
              {account.platformStatusRaw ? <span className="text-slate-400">{t("connections.aiMetaRaw", { raw: account.platformStatusRaw })}</span> : null}
            </div>
          ) : null}

          {effectiveAccount.providerHealthError ? (
            <p className="text-[11px] font-medium text-red-600">{t("connections.aiLastAttemptFailed", { err: effectiveAccount.providerHealthError })}</p>
          ) : null}

          {!waHealth && completeness.length === 0 && !effectiveAccount.providerHealthError ? (
            <p className="text-[11px] text-slate-400">{D.aiNoHealthYet}</p>
          ) : null}
        </div>
      ) : null}

      {isCommerce ? (
        <div className="space-y-2 rounded-lg bg-slate-50 p-2.5 ring-1 ring-inset ring-slate-100">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-600">Commerce diagnostics</span>
            <button type="button" disabled={busy === "diagnostics"} onClick={() => void loadDiagnostics()} className="rounded-lg bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
              {busy === "diagnostics" ? dict.common.loading : diagnostics ? D.aiDiagReloadBtn : D.aiDiagLoadBtn}
            </button>
            {diagnostics ? (
              <button type="button" disabled={busy === "repair-webhooks"} onClick={() => void repairWebhooks()} className="rounded-lg bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50">
                {busy === "repair-webhooks" ? D.aiRegistering : D.aiRepairBtn}
              </button>
            ) : null}
          </div>
          {diagnostics ? (
            <div className="space-y-2 text-[11px] text-slate-600">
              <div>
                <span className="font-semibold text-slate-700">{D.aiAutoHealLabel}</span>{" "}
                {diagnostics.autoHealEnabled === false
                  ? D.aiAutoHealOff
                  : D.aiAutoHealOn}
              </div>
              <div>
                <span className="font-semibold text-slate-700">{D.aiWebhookRecordLabel}</span>{" "}
                {diagnostics.webhookStatus?.status ? t("connections.aiOverallStatus", { status: diagnostics.webhookStatus.status }) : D.aiNoRecordShort}
                {webhookTopics(diagnostics.webhookStatus).length > 0 ? (
                  <ul className="mt-1 space-y-1">
                    {webhookTopics(diagnostics.webhookStatus).map((t) => (
                      <li key={t.topic} className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-1.5 py-0.5 font-semibold ${webhookTopicMeta(t.status).cls}`}>{t.status}</span>
                        <span className="font-medium text-slate-700">{t.topic}</span>
                        {t.error ? <span className="text-red-500">{t.error}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              {account.provider === "shopify" ? (
                diagnostics.shopifyScopes ? (
                  diagnostics.shopifyScopes.missing.length > 0 ? (
                    <p className="rounded-lg bg-amber-50 px-2 py-1.5 font-medium text-amber-700">
                      {t("connections.aiScopesMissing", { scopes: diagnostics.shopifyScopes.missing.join(", ") })}
                    </p>
                  ) : (
                    <p className="font-medium text-green-700">{t("connections.aiScopesOk", { count: fmtNumber(locale, diagnostics.shopifyScopes.granted.length) })}</p>
                  )
                ) : diagnostics.shopifyScopesError ? (
                  <p className="font-medium text-amber-600">{t("connections.aiScopesUnknown", { err: diagnostics.shopifyScopesError })}</p>
                ) : null
              ) : null}
              {diagnostics.tracker ? (
                <p>
                  <span className="font-semibold text-slate-700">{D.aiTrackerLabel}</span>{" "}
                  {diagnostics.tracker.lastEventAt
                    ? t("connections.aiTrackerEvent", { label: diagnostics.tracker.label, when: formatWhen(diagnostics.tracker.lastEventAt, locale) ?? "" })
                    : D.aiTrackerNone}
                </p>
              ) : null}
              {diagnostics.lastCheck ? (
                <p>
                  <span className="font-semibold text-slate-700">{D.aiStoreReachable}</span>{" "}
                  <span className={`rounded-full px-1.5 py-0.5 font-semibold ${overallMeta(diagnostics.lastCheck.overall, locale).cls}`}>{overallMeta(diagnostics.lastCheck.overall, locale).label}</span>{" "}
                  <span className="text-slate-400">{formatWhen(diagnostics.lastCheck.at, locale)}</span>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {latestRun ? (
        <div className="rounded-lg bg-slate-50 p-2.5 ring-1 ring-inset ring-slate-100">
          <p className="mb-1.5 text-[11px] font-semibold text-slate-600">
            {D.aiLatestRun}<span className={`rounded-full px-1.5 py-0.5 ${overallMeta(latestRun.overall, locale).cls}`}>{overallMeta(latestRun.overall, locale).label}</span>{" "}
            <span className="font-normal text-slate-400">{formatWhen(latestRun.createdAt, locale)}</span>
          </p>
          <StepsList run={latestRun} />
        </div>
      ) : null}

      {open ? (
        <div className="space-y-3">
          {canSync ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500">{D.aiRetryLabel}</span>
              <button type="button" disabled={busy === "sync-products"} onClick={() => void resync("products")} className="rounded-lg bg-indigo-50 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">{D.aiResyncProducts}</button>
              <button type="button" disabled={busy === "sync-orders"} onClick={() => void resync("orders")} className="rounded-lg bg-indigo-50 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">{D.aiResyncOrders}</button>
            </div>
          ) : null}

          {webhookText ? (
            <p className="rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] text-slate-500 ring-1 ring-inset ring-slate-100">
              <span className="font-semibold text-slate-600">{D.aiWebhookStatusLabel}</span> {webhookText}
            </p>
          ) : null}

          <div>
            <p className="mb-1 text-[11px] font-semibold text-slate-500">{D.aiPrevRuns}</p>
            {history.length === 0 ? (
              <p className="text-[11px] text-slate-400">{D.aiNoRuns}</p>
            ) : (
              <ul className="space-y-1">
                {history.map((run) => (
                  <li key={run.id} className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span className={`rounded-full px-1.5 py-0.5 font-semibold ${overallMeta(run.overall, locale).cls}`}>{overallMeta(run.overall, locale).label}</span>
                    <span>{formatWhen(run.createdAt, locale)}</span>
                    <span className="text-slate-400">{run.trigger === "sweep" ? D.aiSweep : D.aiManual}</span>
                    <span className="text-slate-400">{t("connections.aiStepsFailed", { count: fmtNumber(locale, run.steps.filter((s) => s.status === "fail").length) })}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold text-slate-500">{D.aiTimelineTitle}</p>
              <label className="flex items-center gap-1 text-[11px] text-slate-500">
                <input type="checkbox" checked={onlyProblems} onChange={(e) => void changeProblems(e.target.checked)} />
                {D.aiOnlyProblems}
              </label>
            </div>
            {timeline.length === 0 ? (
              <p className="text-[11px] text-slate-400">{D.aiNoTimeline}</p>
            ) : (
              <ul className="space-y-1.5">
                {timeline.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-start gap-2 text-[11px]">
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 font-semibold ${SEVERITY_META[item.severity]?.cls ?? "bg-slate-100 text-slate-600"}`}>
                      {timelineKindLabel(item.kind, locale)}
                    </span>
                    <span className="min-w-0">
                      <span className="font-medium text-slate-700">{item.title}</span>
                      {item.detail ? <span className="block text-slate-400">{item.detail}</span> : null}
                      <span className="block text-slate-400">{formatWhen(item.at, locale)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {nextCursor ? (
              <button type="button" onClick={() => void loadDetails(onlyProblems, nextCursor)} className="mt-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-200">{D.aiSeeMore}</button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
