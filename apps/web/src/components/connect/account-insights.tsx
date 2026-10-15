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
  TIMELINE_KIND_LABEL,
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
  SYNC_INTERVAL_PRESETS,
  syncIntervalLabel,
  syncJobStatusLabel,
  webhookTopics,
  webhookTopicMeta,
} from "@/lib/connections";

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
  return (
    <ul className="space-y-1.5">
      {run.steps.map((step) => {
        const meta = stepStatusMeta(step.status);
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
      setError(e instanceof Error ? e.message : "বিস্তারিত লোড হয়নি");
    }
  }, [account]);

  async function diagnose() {
    setBusy("diagnose"); setError(""); setNotice("");
    try {
      const run = await apiFetch<HealthCheckRunView>(`${targetPath(account)}/diagnose`, { method: "POST" });
      setLatestRun(run);
      setNotice(`পরীক্ষা শেষ — ফলাফল: ${overallMeta(run.overall).label}। প্রতিটি ধাপের ফল provider-এর আসল উত্তরের ভিত্তিতে।`);
      onChanged?.();
      if (open) await loadDetails(onlyProblems);
    } catch (e) {
      setError(e instanceof Error ? e.message : "পরীক্ষা চালানো যায়নি");
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
      setNotice(hours > 0 ? `এই অ্যাকাউন্টের অ্যালার্ট ${hours} ঘণ্টা বন্ধ রাখা হলো।` : "Snooze তোলা হলো — অ্যালার্ট আবার আসবে।");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Snooze সেট হয়নি");
    } finally { setBusy(""); }
  }

  async function resync(kind: "products" | "orders") {
    setBusy(`sync-${kind}`); setError(""); setNotice("");
    try {
      const orgId = getOrganizationId();
      const job = await apiFetch<{ status?: string; fetched?: number }>(`/organizations/${orgId}/integrations/${account.id}/sync/${kind}`, { method: "POST" });
      setNotice(`Sync শেষ (${kind === "products" ? "পণ্য" : "অর্ডার"}) — অবস্থা: ${job.status ?? "সম্পন্ন"}${typeof job.fetched === "number" ? `, পাওয়া গেছে ${job.fetched}টি` : ""}।`);
      onChanged?.();
      if (open) await loadDetails(onlyProblems);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync চালানো যায়নি");
    } finally { setBusy(""); }
  }

  async function loadSyncHistory() {
    setBusy("sync-history"); setError("");
    try {
      const orgId = getOrganizationId();
      const res = await apiFetch<{ jobs: SyncHistoryItem[] }>(`/organizations/${orgId}/connections/${account.id}/sync-history?limit=15`);
      setSyncHistory(res.jobs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync ইতিহাস লোড হয়নি");
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
      setNotice(next
        ? "Sync বিরতি দেওয়া হয়েছে — নির্ধারিত ও ম্যানুয়াল সব Sync এই কানেকশনের জন্য এড়িয়ে যাওয়া হবে (প্রতিটি এড়ানো Sync ইতিহাসে রেকর্ড থাকবে)।"
        : "Sync আবার চালু হয়েছে।");
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync বিরতি সেট হয়নি");
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
        ? "Cadence তোলা হয়েছে — এখন থেকে প্রতিটি নির্ধারিত (scheduled) Sync-ই চলবে।"
        : `Cadence সেট হয়েছে: নির্ধারিত Sync ${syncIntervalLabel(minutes)} অন্তর সর্বোচ্চ একবার চলবে। ম্যানুয়াল Sync-এ এর কোনো প্রভাব নেই।`);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cadence সেট হয়নি");
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
        ? "Provider তথ্য আপডেট হয়েছে — যা যা Meta/প্রোভাইডার পাঠিয়েছে ঠিক তাই দেখানো হচ্ছে।"
        : `তথ্য আনা যায়নি: ${res.error ?? res.providerHealthError ?? "অজানা ত্রুটি"} — আগের তথ্য (যদি থাকে) আগের সময়সহই আছে।`);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Provider তথ্য আনা যায়নি");
    } finally { setBusy(""); }
  }

  async function loadDiagnostics() {
    setBusy("diagnostics"); setError(""); setNotice("");
    try {
      const orgId = getOrganizationId();
      const diag = await apiFetch<CommerceDiagnosticsView>(`/organizations/${orgId}/connections/${account.id}/commerce-diagnostics`);
      setDiagnostics(diag);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Diagnostics লোড হয়নি");
    } finally { setBusy(""); }
  }

  async function repairWebhooks() {
    setBusy("repair-webhooks"); setError(""); setNotice("");
    try {
      const orgId = getOrganizationId();
      const res = await apiFetch<{ webhookRegistration: string | null }>(`/organizations/${orgId}/connections/${account.id}/repair-webhooks`, { method: "POST" });
      setNotice(`Webhook আবার নিবন্ধনের ফল: ${res.webhookRegistration ?? "অজানা"} — প্রতি topic-এর আসল ফল নিচে দেখুন।`);
      onChanged?.();
      await loadDiagnostics();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Webhook repair চালানো যায়নি");
    } finally { setBusy(""); }
  }

  const effectiveAccount: ConnectionAccount = phOverride
    ? { ...account, providerHealth: phOverride.health, providerHealthAt: phOverride.at, providerHealthError: phOverride.error }
    : account;
  const waHealth = whatsappHealth(effectiveAccount);
  const completeness = completenessItems(effectiveAccount);
  const canRefreshHealth = canRefreshProviderHealth(account);
  const isCommerce = account.source === "integration" && (account.provider === "woocommerce" || account.provider === "shopify");
  const healthAtText = formatWhen(effectiveAccount.providerHealthAt ?? null);

  const canSync = account.source === "integration" && (account.provider === "woocommerce" || account.provider === "shopify");
  const webhookText = webhookStatus && typeof webhookStatus === "object"
    ? JSON.stringify(webhookStatus)
    : null;

  return (
    <div className="space-y-2 border-t border-slate-100 pt-2.5">
      <div className="flex flex-wrap gap-1.5">
        <button type="button" disabled={busy === "diagnose"} onClick={() => void diagnose()} className="rounded-lg bg-teal-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
          {busy === "diagnose" ? "পরীক্ষা চলছে…" : "🩺 পরীক্ষা করুন"}
        </button>
        <button type="button" onClick={() => void toggleOpen()} className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-200">
          {open ? "বিস্তারিত লুকান" : "📜 ইতিহাস ও টাইমলাইন"}
        </button>
        <select
          aria-label="অ্যালার্ট snooze"
          disabled={busy === "snooze"}
          defaultValue=""
          onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) void snooze(v); e.target.value = ""; }}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-600"
        >
          <option value="" disabled>🔕 অ্যালার্ট বন্ধ…</option>
          <option value="24">২৪ ঘণ্টা</option>
          <option value="72">৩ দিন</option>
          <option value="168">৭ দিন</option>
          <option value="0">Snooze তুলুন</option>
        </select>
      </div>

      {error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}
      {notice ? <p className="text-xs font-medium text-green-700">{notice}</p> : null}

      {canPauseSync(account) ? (
        <div className="space-y-2 rounded-lg bg-slate-50 p-2.5 ring-1 ring-inset ring-slate-100">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-600">Sync নিয়ন্ত্রণ</span>
            {(pausedOverride ?? account.syncPaused ?? false) ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">⏸ Sync বিরতি দেওয়া আছে</span>
            ) : (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">Sync চালু আছে</span>
            )}
            <button type="button" disabled={busy === "sync-pause"} onClick={() => void toggleSyncPaused()} className="rounded-lg bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
              {busy === "sync-pause" ? "হচ্ছে…" : (pausedOverride ?? account.syncPaused ?? false) ? "Sync চালু করুন" : "Sync বিরতি দিন"}
            </button>
            <button type="button" disabled={busy === "sync-history"} onClick={() => void loadSyncHistory()} className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 disabled:opacity-50">
              {busy === "sync-history" ? "লোড হচ্ছে…" : "Sync ইতিহাস"}
            </button>
          </div>
          <p className="text-[11px] leading-snug text-slate-400">
            বিরতি দিলে নির্ধারিত (scheduled) Sync এড়িয়ে যাওয়া হয় এবং ম্যানুয়াল Sync চেষ্টা স্পষ্ট বার্তায় থামে — প্রতিটি এড়ানো Sync ইতিহাসে রেকর্ড থাকে।
          </p>
          {isCommerce ? (() => {
            const effectiveInterval = intervalOverride !== undefined ? intervalOverride : (account.syncIntervalMinutes ?? null);
            const selectValue = customMode ? "custom" : effectiveInterval === null ? "default" : SYNC_INTERVAL_PRESETS.some((p) => p.minutes === effectiveInterval) ? String(effectiveInterval) : "custom";
            return (
              <div className="space-y-1.5 border-t border-slate-200/70 pt-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-slate-600">Scheduled Sync ব্যবধান (cadence)</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{syncIntervalLabel(effectiveInterval)}</span>
                  <select
                    aria-label="Sync cadence"
                    disabled={busy === "sync-interval"}
                    value={selectValue}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "custom") { setCustomMode(true); setCustomInterval(effectiveInterval !== null && !SYNC_INTERVAL_PRESETS.some((p) => p.minutes === effectiveInterval) ? String(effectiveInterval) : ""); return; }
                      setCustomMode(false);
                      void setSyncInterval(v === "default" ? null : Number(v));
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600"
                  >
                    <option value="default">ডিফল্ট (cadence নেই)</option>
                    {SYNC_INTERVAL_PRESETS.map((p) => (
                      <option key={p.minutes} value={String(p.minutes)}>{p.label}</option>
                    ))}
                    <option value="custom">কাস্টম…</option>
                  </select>
                  {selectValue === "custom" ? (
                    <>
                      <input
                        type="number" min={5} max={10080} step={1}
                        value={customInterval}
                        onChange={(e) => setCustomInterval(e.target.value)}
                        placeholder="মিনিট (৫–১০০৮০)"
                        className="w-28 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                      />
                      <button
                        type="button"
                        disabled={busy === "sync-interval" || !/^\d+$/.test(customInterval) || Number(customInterval) < 5 || Number(customInterval) > 10080}
                        onClick={() => void setSyncInterval(Number(customInterval))}
                        className="rounded-lg bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                      >
                        {busy === "sync-interval" ? "হচ্ছে…" : "সেট করুন"}
                      </button>
                    </>
                  ) : null}
                </div>
                <p className="text-[11px] leading-snug text-slate-400">
                  Cadence শুধু নির্ধারিত (scheduled) Sync-এর জন্য: শেষ আসল Sync-এর পর ব্যবধান না পেরোলে ওই চক্রটি এড়িয়ে যাওয়া হয় (job-এর ফলাফলে রেকর্ড থাকে, কোনো ভুয়া Sync রেকর্ড তৈরি হয় না)।
                  ম্যানুয়াল "আবার Sync করুন" সবসময় তখনই চলে; বিরতি (pause) cadence-এর চেয়ে শক্তিশালী।
                  সর্বশেষ Sync: {formatWhen(account.lastSyncAt) ?? "এখনো রেকর্ড নেই"} — cadence-এর হিসাব এই সময় থেকেই (প্রতি ধরনের Sync আলাদাভাবে)।
                </p>
              </div>
            );
          })() : null}
          {syncHistory ? (
            syncHistory.length === 0 ? (
              <p className="text-[11px] text-slate-400">এখনও কোনো Sync রেকর্ড নেই।</p>
            ) : (
              <ul className="space-y-1">
                {syncHistory.map((job) => (
                  <li key={job.id} className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span className={`rounded-full px-1.5 py-0.5 font-semibold ${job.error === "sync_paused" ? "bg-amber-100 text-amber-700" : job.status === "FAILED" ? "bg-red-100 text-red-700" : job.status === "COMPLETED" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>
                      {syncJobStatusLabel(job)}
                    </span>
                    <span className="font-medium text-slate-700">{job.kind}</span>
                    <span>পাওয়া {job.fetched} · নতুন {job.created} · হালনাগাদ {job.updated} · এড়ানো {job.skipped}</span>
                    {job.error && job.error !== "sync_paused" ? <span className="text-red-500">{job.error}</span> : null}
                    <span className="text-slate-400">{formatWhen(job.startedAt)}</span>
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
            <span className="text-[11px] font-semibold text-slate-600">Provider health — প্রোভাইডারের আসল তথ্য</span>
            {healthAtText
              ? <span className="text-[11px] text-slate-400">সর্বশেষ আনা: {healthAtText}</span>
              : <span className="text-[11px] text-slate-400">এখনো আনা হয়নি</span>}
            {canRefreshHealth ? (
              <button type="button" disabled={busy === "provider-health"} onClick={() => void refreshProviderHealth()} className="rounded-lg bg-teal-50 px-2.5 py-1 text-[11px] font-semibold text-teal-700 hover:bg-teal-100 disabled:opacity-50">
                {busy === "provider-health" ? "আনা হচ্ছে…" : "🔄 তথ্য আপডেট করুন"}
              </button>
            ) : null}
          </div>

          {waHealth ? (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {waHealth.qualityRating
                ? <span className={`rounded-full px-2 py-0.5 font-semibold ${qualityMeta(waHealth.qualityRating).cls}`}>{qualityMeta(waHealth.qualityRating).label}</span>
                : <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-500">Quality: তথ্য নেই</span>}
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
                    {COMPLETENESS_META[item.state].icon} {item.state === "unknown" ? "তথ্য নেই" : item.state === "yes" ? "আছে" : "নেই"}
                  </span>
                  <span className="font-medium text-slate-700">{item.label}</span>
                  {item.detail ? <span className="text-slate-400">{item.detail}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}

          {effectiveAccount.providerHealth?.kind === "meta_page" && completeness.some((i) => i.state === "no") ? (
            <p className="text-[11px] leading-snug text-slate-500">
              যেগুলো "নেই" — সেগুলো Meta Business Suite / Events Manager-এ গিয়ে link করতে হয়; এখানে link করার কোনো ভান করা হয়নি।
              এই পেজের তথ্য আবার আনতে উপরের "তথ্য আপডেট করুন" ব্যবহার করুন।
            </p>
          ) : null}

          {account.source === "ad_account" ? (
            <div className="text-[11px] text-slate-500">
              প্ল্যাটফর্ম অবস্থা (AD3):{" "}
              <span className={`rounded-full px-1.5 py-0.5 font-semibold ${adBucketMeta(account.platformStatusBucket).cls}`}>{adBucketMeta(account.platformStatusBucket).label}</span>
              {account.platformStatusRaw ? <span className="text-slate-400"> (Meta-র raw মান: {account.platformStatusRaw})</span> : null}
            </div>
          ) : null}

          {effectiveAccount.providerHealthError ? (
            <p className="text-[11px] font-medium text-red-600">
              সর্বশেষ চেষ্টা ব্যর্থ: {effectiveAccount.providerHealthError} — উপরের তথ্য (যদি থাকে) আগের সময়ের, নতুন বলে ধরা হয়নি।
            </p>
          ) : null}

          {!waHealth && completeness.length === 0 && !effectiveAccount.providerHealthError ? (
            <p className="text-[11px] text-slate-400">এখনো কোনো provider তথ্য আনা হয়নি — "তথ্য আপডেট করুন" চাপুন।</p>
          ) : null}
        </div>
      ) : null}

      {isCommerce ? (
        <div className="space-y-2 rounded-lg bg-slate-50 p-2.5 ring-1 ring-inset ring-slate-100">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-600">Commerce diagnostics</span>
            <button type="button" disabled={busy === "diagnostics"} onClick={() => void loadDiagnostics()} className="rounded-lg bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
              {busy === "diagnostics" ? "লোড হচ্ছে…" : diagnostics ? "🛠 আবার লোড করুন" : "🛠 দেখুন"}
            </button>
            {diagnostics ? (
              <button type="button" disabled={busy === "repair-webhooks"} onClick={() => void repairWebhooks()} className="rounded-lg bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50">
                {busy === "repair-webhooks" ? "নিবন্ধন হচ্ছে…" : "Webhook আবার নিবন্ধন করুন"}
              </button>
            ) : null}
          </div>
          {diagnostics ? (
            <div className="space-y-2 text-[11px] text-slate-600">
              <div>
                <span className="font-semibold text-slate-700">Auto-heal (CC21):</span>{" "}
                {diagnostics.autoHealEnabled === false
                  ? "বন্ধ — webhook ভাঙলে শুধু সতর্কবার্তা যাবে, sweep নিজে থেকে মেরামত করবে না (কার্ডের 🛠 বোতামে চালু করা যায়)"
                  : "চালু — webhook ভাঙা ধরা পড়লে sweep নিজে থেকে আবার রেজিস্টার করার চেষ্টা করবে (দিনে সর্বোচ্চ ৩ বার)"}
              </div>
              <div>
                <span className="font-semibold text-slate-700">Webhook (সেভ করা রেকর্ড):</span>{" "}
                {diagnostics.webhookStatus?.status ? `সার্বিক অবস্থা: ${diagnostics.webhookStatus.status}` : "কোনো রেকর্ড নেই"}
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
                      ⚠️ অনুপস্থিত Scope: {diagnostics.shopifyScopes.missing.join(", ")} — Shopify অ্যাপে এই scope-গুলো যোগ করে স্টোরটি আবার authorize (re-auth) করুন, নইলে সংশ্লিষ্ট feature কাজ করবে না।
                    </p>
                  ) : (
                    <p className="font-medium text-green-700">✓ সব প্রয়োজনীয় Scope আছে ({diagnostics.shopifyScopes.granted.length}টি granted)।</p>
                  )
                ) : diagnostics.shopifyScopesError ? (
                  <p className="font-medium text-amber-600">Scope যাচাই করা যায়নি: {diagnostics.shopifyScopesError} — অনুমান করা হয়নি।</p>
                ) : null
              ) : null}
              {diagnostics.tracker ? (
                <p>
                  <span className="font-semibold text-slate-700">Tracker:</span>{" "}
                  {diagnostics.tracker.lastEventAt
                    ? `${diagnostics.tracker.label}: ${formatWhen(diagnostics.tracker.lastEventAt)}`
                    : "এখনো কোনো tracker event রেকর্ড হয়নি।"}
                </p>
              ) : null}
              {diagnostics.lastCheck ? (
                <p>
                  <span className="font-semibold text-slate-700">স্টোর reachable (সর্বশেষ Doctor পরীক্ষা):</span>{" "}
                  <span className={`rounded-full px-1.5 py-0.5 font-semibold ${overallMeta(diagnostics.lastCheck.overall).cls}`}>{overallMeta(diagnostics.lastCheck.overall).label}</span>{" "}
                  <span className="text-slate-400">{formatWhen(diagnostics.lastCheck.at)}</span>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {latestRun ? (
        <div className="rounded-lg bg-slate-50 p-2.5 ring-1 ring-inset ring-slate-100">
          <p className="mb-1.5 text-[11px] font-semibold text-slate-600">
            সর্বশেষ পরীক্ষা: <span className={`rounded-full px-1.5 py-0.5 ${overallMeta(latestRun.overall).cls}`}>{overallMeta(latestRun.overall).label}</span>{" "}
            <span className="font-normal text-slate-400">{formatWhen(latestRun.createdAt)}</span>
          </p>
          <StepsList run={latestRun} />
        </div>
      ) : null}

      {open ? (
        <div className="space-y-3">
          {canSync ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500">আবার চেষ্টা:</span>
              <button type="button" disabled={busy === "sync-products"} onClick={() => void resync("products")} className="rounded-lg bg-indigo-50 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">পণ্য Sync আবার করুন</button>
              <button type="button" disabled={busy === "sync-orders"} onClick={() => void resync("orders")} className="rounded-lg bg-indigo-50 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">অর্ডার Sync আবার করুন</button>
            </div>
          ) : null}

          {webhookText ? (
            <p className="rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] text-slate-500 ring-1 ring-inset ring-slate-100">
              <span className="font-semibold text-slate-600">Webhook অবস্থা (সেভ করা রেকর্ড):</span> {webhookText}
            </p>
          ) : null}

          <div>
            <p className="mb-1 text-[11px] font-semibold text-slate-500">আগের পরীক্ষাগুলো</p>
            {history.length === 0 ? (
              <p className="text-[11px] text-slate-400">এখনও কোনো পরীক্ষা চালানো হয়নি।</p>
            ) : (
              <ul className="space-y-1">
                {history.map((run) => (
                  <li key={run.id} className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span className={`rounded-full px-1.5 py-0.5 font-semibold ${overallMeta(run.overall).cls}`}>{overallMeta(run.overall).label}</span>
                    <span>{formatWhen(run.createdAt)}</span>
                    <span className="text-slate-400">{run.trigger === "sweep" ? "স্বয়ংক্রিয় পর্যবেক্ষণ" : "ম্যানুয়াল"}</span>
                    <span className="text-slate-400">{run.steps.filter((s) => s.status === "fail").length}টি ধাপ ব্যর্থ</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold text-slate-500">টাইমলাইন — আসল রেকর্ড থেকে</p>
              <label className="flex items-center gap-1 text-[11px] text-slate-500">
                <input type="checkbox" checked={onlyProblems} onChange={(e) => void changeProblems(e.target.checked)} />
                শুধু সমস্যা
              </label>
            </div>
            {timeline.length === 0 ? (
              <p className="text-[11px] text-slate-400">এই অ্যাকাউন্টের কোনো রেকর্ড এখনও নেই।</p>
            ) : (
              <ul className="space-y-1.5">
                {timeline.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-start gap-2 text-[11px]">
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 font-semibold ${SEVERITY_META[item.severity]?.cls ?? "bg-slate-100 text-slate-600"}`}>
                      {TIMELINE_KIND_LABEL[item.kind] ?? item.kind}
                    </span>
                    <span className="min-w-0">
                      <span className="font-medium text-slate-700">{item.title}</span>
                      {item.detail ? <span className="block text-slate-400">{item.detail}</span> : null}
                      <span className="block text-slate-400">{formatWhen(item.at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {nextCursor ? (
              <button type="button" onClick={() => void loadDetails(onlyProblems, nextCursor)} className="mt-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-200">আরও দেখুন</button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
