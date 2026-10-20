"use client";

import React from "react";
import AdminShell from "@/components/AdminShell";
import { EmptyState, ErrorState, PageHead, Tabs, askInput, toast } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";
import { fmtNumber, type UiLocale } from "@repo/contracts";
import { useAdminLocale } from "@/components/AdminLocale";
import { trAdmin, type AdminDict } from "@/lib/i18n";

interface Version {
  appVersion: string; gitSha: string | null; nodeVersion: string; environment: string;
  bootTime: string; uptimeSeconds: number;
  migrations: { applied: number; latest: string | null; recent: string[] } | null;
  database: { reachable: boolean; latencyMs: number | null };
}
interface Queues {
  scheduledJobs: { total: number; enabled: number; dueNow: number; recentlyFailed: { name: string; type: string; lastError: string; lastRunAt: string }[] };
  syncJobs: { running: number; failedLast24h: number; latestFailures: { kind: string; error: string | null; startedAt: string }[] };
  deliveries: { last24h: number; failedLast24h: number; pending: number };
  workflowRuns: { running: number; latestErrors: { error: string | null; createdAt: string }[] };
  worker?: {
    reachable: boolean; healthUrl: string; checkedAt: string; error?: string;
    health?: { status?: string; queues?: string[]; redis?: string; secretConfigured?: boolean; uptimeSec?: number };
  };
  bullmq?: {
    available: boolean; reason?: string; error?: string;
    queues: { name: string; waiting: number; active: number; delayed: number; failed: number; completed: number; paused: number }[];
  };
}
interface Errors { windowHours: number; totalErrors: number; sources: { source: string; count: number; latest: { title: string; detail: string | null; at: string }[] }[] }
interface Growth { source: string; tables: { table: string; approxRows: number; bytes: number | null }[]; totalBytes: number | null }
interface LogRow { at: string; action: string; userId: string | null; organizationId: string | null; entityType: string | null }
interface BackupPanel { info: { lastBackupAt: string | null; location: string; note: string; recordedBy: string } | null; manifest: { at: string; totalRows: number; tables: Record<string, number>; verifiedBy: string } | null }
interface WebhookEventRow {
  id: string; provider: string; topic?: string | null; integrationId: string;
  organizationId?: string | null; organizationName?: string | null;
  deliveryId?: string | null; signatureValid: boolean; processedAt?: string | null;
  error?: string | null; receivedAt: string;
}
interface WebhookEventDetail extends WebhookEventRow { payload: unknown; payloadTruncated: boolean }
interface EnvCheck {
  checkedAt: string;
  summary: { requiredTotal: number; requiredPresent: number; requiredMissing: number; ready: boolean };
  apiEnv: { name: string; required: boolean; present: boolean; hintBn: string }[];
  composeEnv: { name: string; verifiable: boolean; hintBn: string }[];
  migrations: { applied: number; latest: string | null; repoTotal: number | null; pending: number | null; pendingNames: string[] } | null;
  platformConfig: { area: string; label: string; source: string; secretConfigured: boolean }[];
}

/** ADNX11: a long error/log line — clamped to 2 lines on mobile
 * with a বিস্তারিত/লুকান toggle; full text always on sm+. */
function ErrText({ text }: { text: string }) {
  const { dict } = useAdminLocale();
  const [open, setOpen] = React.useState(false);
  return (
    <span className="min-w-0">
      <span className={open ? "" : "line-clamp-2 sm:line-clamp-none"}>{text}</span>
      <button type="button" className="ml-1 font-semibold text-indigo-300 sm:hidden" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? dict.system.hide : dict.system.detail}</button>
    </span>
  );
}

function fmtBytes(n: number | null, locale: UiLocale): string {
  if (n === null) return "—";
  if (n < 1024) return `${fmtNumber(locale, n)} B`;
  if (n < 1024 * 1024) return `${fmtNumber(locale, n / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KB`;
  if (n < 1024 * 1024 * 1024) return `${fmtNumber(locale, n / 1048576, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
  return `${fmtNumber(locale, n / 1073741824, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GB`;
}
function fmtUptime(sec: number, dict: AdminDict, locale: UiLocale): string {
  const d = Math.floor(sec / 86400); const h = Math.floor((sec % 86400) / 3600); const m = Math.floor((sec % 3600) / 60);
  const tpl = (path: string, params: Record<string, string>) => trAdmin(locale, path, params);
  return d > 0 ? tpl("system.uptimeDaysHours", { days: fmtNumber(locale, d), hours: fmtNumber(locale, h) }) : h > 0 ? tpl("system.uptimeHoursMinutes", { hours: fmtNumber(locale, h), minutes: fmtNumber(locale, m) }) : tpl("system.uptimeMinutes", { minutes: fmtNumber(locale, m) });
}

export default function SystemPage() {
  const { dict, locale, t } = useAdminLocale();
  const [envCheck, setEnvCheck] = React.useState<EnvCheck | null>(null);
  const [version, setVersion] = React.useState<Version | null>(null);
  const [queues, setQueues] = React.useState<Queues | null>(null);
  const [errors, setErrors] = React.useState<Errors | null>(null);
  const [growth, setGrowth] = React.useState<Growth | null>(null);
  const [backup, setBackup] = React.useState<BackupPanel | null>(null);
  const [logs, setLogs] = React.useState<LogRow[]>([]);
  const [logQ, setLogQ] = React.useState("");
  const [inboxHealth, setInboxHealth] = React.useState<any>(null);
  const [dlq, setDlq] = React.useState<any>(null);
  const [bkLocation, setBkLocation] = React.useState("");
  const [bkNote, setBkNote] = React.useState("");
  const [bkAt, setBkAt] = React.useState("");
  const [webhooks, setWebhooks] = React.useState<WebhookEventRow[]>([]);
  const [whProvider, setWhProvider] = React.useState("");
  const [whErrorsOnly, setWhErrorsOnly] = React.useState(false);
  const [whDetail, setWhDetail] = React.useState<WebhookEventDetail | null>(null);
  // ADNX11: webhooks/logs get honest load states — before, a failed
  // fetch silently became the "কোনো … নেই" empty text (a false
  // empty, the same class of bug ADX12 fixed on Alerts).
  const [whLoaded, setWhLoaded] = React.useState(false);
  const [whError, setWhError] = React.useState("");
  const [logLoaded, setLogLoaded] = React.useState(false);
  const [logError, setLogError] = React.useState("");
  // ADX8: the page's cards regrouped into tabs (content unchanged).
  // "logs" is a declared sixth tab — the Activity Log card exists on
  // the page today and needs a home; the plan's five tabs cover the
  // other ten cards exactly.
  const [tab, setTab] = React.useState("deploy");

  async function loadWebhooks(provider = whProvider, errorsOnly = whErrorsOnly) {
    const params = new URLSearchParams();
    if (provider.trim()) params.set("provider", provider.trim());
    if (errorsOnly) params.set("hasError", "true");
    params.set("take", "50");
    setWhLoaded(false); setWhError("");
    try { setWebhooks(await apiFetch<WebhookEventRow[]>(`/admin/system/webhooks?${params.toString()}`)); }
    catch (e) { setWebhooks([]); setWhError(e instanceof Error ? e.message : dict.system.webhookLoadFallback); }
    finally { setWhLoaded(true); }
  }
  async function openWebhook(id: string) {
    const detail = await apiFetch<WebhookEventDetail>(`/admin/system/webhooks/${id}`).catch(() => null);
    setWhDetail(detail);
  }

  // ADX12: loadDone separates "still loading" from "load failed"
  // for every null-gated card below — before, a failed fetch left
  // its card on "লোড হচ্ছে…" forever.
  const [loadDone, setLoadDone] = React.useState(false);
  const load = React.useCallback(async () => {
    setLoadDone(false);
    setEnvCheck(await apiFetch<EnvCheck>("/admin/system/env-check").catch(() => null));
    setVersion(await apiFetch<Version>("/admin/system/version").catch(() => null));
    setQueues(await apiFetch<Queues>("/admin/system/queues").catch(() => null));
    setInboxHealth(await apiFetch<any>("/admin/system/inbox-health").catch(() => null));
    setDlq(await apiFetch<any>("/admin/system/dlq").catch(() => null));
    setErrors(await apiFetch<Errors>("/admin/system/errors").catch(() => null));
    setGrowth(await apiFetch<Growth>("/admin/system/db-growth").catch(() => null));
    const bk = await apiFetch<BackupPanel>("/admin/system/backup").catch(() => null);
    setBackup(bk);
    if (bk?.info) { setBkLocation(bk.info.location); setBkNote(bk.info.note); setBkAt(bk.info.lastBackupAt ? String(bk.info.lastBackupAt).slice(0, 16) : ""); }
    await loadWebhooks("", false);
    setLoadDone(true);
  }, []);
  React.useEffect(() => { load(); }, [load]);
  const loadLogs = React.useCallback(async () => {
    setLogLoaded(false); setLogError("");
    try { setLogs(await apiFetch<LogRow[]>(`/admin/system/logs?take=60${logQ ? `&q=${encodeURIComponent(logQ)}` : ""}`)); }
    catch (e) { setLogs([]); setLogError(e instanceof Error ? e.message : dict.system.logLoadFallback); }
    finally { setLogLoaded(true); }
  }, [logQ]);
  React.useEffect(() => { loadLogs(); }, [loadLogs]);

  // AB3 / AN12: queue operator actions — reason বাধ্যতামূলক (Audit-এ
  // থাকে), API-র ফলাফল হুবহু দেখানো হয়। Drain/Delete জাতীয় কোনো
  // ধ্বংসাত্মক action এখানে নেই।
  async function queueAction(queue: string, action: "pause" | "resume" | "retry-failed") {
    const actionWord = action === "pause" ? dict.system.queueActionReasonPause : action === "resume" ? dict.system.queueActionReasonResume : dict.system.queueActionReasonRetry;
    const reason = await askInput({ title: t("system.queueActionTitle", { queue }), description: t("system.queueActionDesc", { action: actionWord }), inputLabel: dict.common.reason, inputRequired: true, confirmLabel: dict.common.proceed });
    if (!reason) return;
    try {
      const out = await apiFetch<any>(`/admin/system/queues/${queue}/${action}`, { method: "POST", body: JSON.stringify({ reason }) });
      // ADNX11: queue-action feedback rides toast; the ✅/❌/⚠
      // prefixes are dropped — the toast kind carries the outcome
      // (the NB2 rule). Wording otherwise unchanged.
      if (out.available === false) {
        toast(t("system.queueUnavailable", { queue, reason: out.reason ?? out.error ?? dict.system.queueUnavailableFallback }), "error");
      } else if (action === "retry-failed") {
        const fails = (out.results ?? []).filter((r: any) => !r.retried).map((r: any) => `#${r.id}: ${r.error}`).join("; ");
        toast(t("system.queueRetryResult", { queue, requested: fmtNumber(locale, out.requested), retried: fmtNumber(locale, out.retried), before: fmtNumber(locale, out.failedBefore), after: fmtNumber(locale, out.failedAfter) }) + (fails ? t("system.queueRetryFails", { fails }) : ""));
      } else {
        toast(t(action === "pause" ? "system.queuePausedResult" : "system.queueResumedResult", { queue, paused: out.paused ? dict.system.yes : dict.system.no }));
      }
      await load();
    } catch (e) {
      toast(`${queue}: ${e instanceof Error ? e.message : dict.system.actionFailedFallback}`, "error");
    }
  }

  // ADX12: per-card pending slot (loading vs failed + retry).
  // ADNX11: the in-flight half is a skeleton, so EVERY tab's cards
  // now carry skeleton (in flight) / error+retry (failed) states.
  const pending = (label: string) => loadDone
    ? <ErrorState message={t("system.loadErrorSuffix", { label })} onRetry={load} />
    : <div className="space-y-2" aria-label={dict.common.loading}><div className="askel h-4 w-2/3" /><div className="askel h-4 w-1/2" /><div className="askel h-4 w-3/5" /></div>;

  return (
    <AdminShell title={dict.system.title}>
      <PageHead sub={dict.system.sub} />
      {/* ADX8: the AA1 deploy-readiness banner moved to page level —
          identical text/logic as inside the env card before, now
          visible regardless of the active tab (it already was the
          first thing on the page; tabbing must not hide it). */}
      {envCheck ? (
        envCheck.summary.requiredMissing > 0 ? (
          <p className="mb-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{t("system.envMissingBanner", { count: fmtNumber(locale, envCheck.summary.requiredMissing) })}</p>
        ) : (
          <p className="mb-3 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">{t("system.envOkBanner", { present: fmtNumber(locale, envCheck.summary.requiredPresent), total: fmtNumber(locale, envCheck.summary.requiredTotal) })}</p>
        )
      ) : null}
      <div className="sticky top-0 z-20 -mx-1 mb-4 bg-slate-950/90 px-1 py-2 backdrop-blur">
        <Tabs
          tabs={[
            { id: "deploy", label: dict.system.tabDeploy },
            { id: "queues", label: dict.system.tabQueues, badge: dlq?.pending ?? undefined },
            { id: "errors", label: dict.system.tabErrors, badge: errors?.totalErrors ?? undefined },
            { id: "backup", label: dict.system.tabBackup },
            { id: "webhooks", label: dict.system.tabWebhooks },
            { id: "logs", label: dict.system.tabLogs },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>
      {tab === "deploy" ? (<>
      <div className="acard mb-4 space-y-2">
        <div className="font-semibold">{dict.system.deployCardTitle} <span className="text-xs font-normal text-slate-400">{dict.system.deployCardNote}</span></div>
        {!envCheck ? pending(dict.system.deployReadiness) : (
          <div className="space-y-2">
            <div className="space-y-1">
              {envCheck.apiEnv.map((e) => (
                <div key={e.name} className="flex flex-wrap items-baseline gap-2 text-sm">
                  <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">{e.name}</code>
                  {e.present ? <span className="abadge-green">{dict.system.present}</span> : e.required ? <span className="abadge-red">{dict.system.missingRequired}</span> : <span className="abadge-amber">{dict.system.missingOptional}</span>}
                  <span className="text-xs text-slate-400">{e.hintBn}</span>
                </div>
              ))}
            </div>
            <div className="space-y-1 border-t border-slate-800 pt-2">
              <div className="text-xs font-medium text-slate-400">{dict.system.composeIntro}</div>
              {envCheck.composeEnv.map((e) => (
                <div key={e.name} className="flex flex-wrap items-baseline gap-2 text-sm opacity-80">
                  <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">{e.name}</code>
                  <span className="rounded-full bg-slate-500/15 px-2 py-0.5 text-[11px] font-semibold text-slate-400">{dict.system.notVerifiable}</span>
                  <span className="text-xs text-slate-400">{e.hintBn}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-slate-800 pt-2 text-sm">
              {dict.system.migrationLine} <b>{envCheck.migrations ? fmtNumber(locale, envCheck.migrations.applied) : "—"}</b>
              {envCheck.migrations?.repoTotal != null ? <>{t("system.migrationRepo", { total: fmtNumber(locale, envCheck.migrations.repoTotal) })}<b>{t("system.migrationPending", { count: fmtNumber(locale, envCheck.migrations.pending ?? 0) })}</b>{envCheck.migrations.pendingNames.length ? <span className="text-xs text-slate-400"> ({envCheck.migrations.pendingNames.join(", ")})</span> : null}</> : <span className="text-xs text-slate-400">{dict.system.migrationUnknown}</span>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {envCheck.platformConfig.map((a) => (
                <span key={a.area} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${a.source === "admin" ? "bg-emerald-500/15 text-emerald-500" : a.source === "env" ? "bg-amber-500/15 text-amber-500" : "bg-red-500/15 text-red-400"}`}>{a.label}: {a.source === "admin" ? dict.system.sourceAdmin : a.source === "env" ? dict.system.sourceEnv : dict.system.sourceNone}{a.secretConfigured ? dict.system.secretPresent : ""}</span>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="acard space-y-2">
          <div className="font-semibold">{dict.system.versionTitle}</div>
          {!version ? pending(dict.system.versionInfo) : (
            <div className="space-y-1 text-sm">
              <div>{dict.system.versionLabel} <b>{version.appVersion}</b> · {dict.system.gitLabel} <b>{version.gitSha ? version.gitSha.slice(0, 10) : dict.system.gitNotSet}</b></div>
              <div>{t("system.nodeEnv", { node: version.nodeVersion, env: version.environment })}</div>
              <div>{t("system.uptimeLine", { uptime: fmtUptime(version.uptimeSeconds, dict, locale), boot: fmtDateTime(locale, version.bootTime) })}</div>
              <div>{dict.system.databaseLabel} {version.database.reachable ? <span className="abadge-green">{t("system.dbReachable", { ms: version.database.latencyMs !== null ? fmtNumber(locale, version.database.latencyMs) : "—" })}</span> : <span className="abadge-red">{dict.system.dbUnreachable}</span>}</div>
              <div>{dict.system.migrationApplied} <b>{version.migrations ? fmtNumber(locale, version.migrations.applied) : "—"}</b>{version.migrations?.latest ? t("system.migrationLatest", { latest: version.migrations.latest }) : ""}</div>
              <p className="text-xs text-slate-400">{dict.system.versionNote}</p>
            </div>
          )}
        </div>
      </>) : null}
      {tab === "queues" ? (<>
        <div className="acard space-y-2">
          <div className="font-semibold">{dict.system.queueTitle}</div>
          {!queues ? pending(dict.system.queueInfo) : (
            <div className="space-y-1.5 text-sm">
              <div>{t("system.scheduledLine", { total: fmtNumber(locale, queues.scheduledJobs.total), enabled: fmtNumber(locale, queues.scheduledJobs.enabled) })}<b>{t("system.dueNow", { count: fmtNumber(locale, queues.scheduledJobs.dueNow) })}</b></div>
              {queues.scheduledJobs.recentlyFailed.map((j, i) => <div key={i} className="rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs">⚠ {j.name} ({j.type}) — <ErrText text={j.lastError} /></div>)}
              <div>{t("system.storeSyncLine", { running: fmtNumber(locale, queues.syncJobs.running), failed: fmtNumber(locale, queues.syncJobs.failedLast24h) })}</div>
              {queues.syncJobs.latestFailures.map((j, i) => <div key={i} className="rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs">⚠ {j.kind} sync — <ErrText text={j.error ?? ""} /></div>)}
              <div>{t("system.deliveriesLine", { total: fmtNumber(locale, queues.deliveries.last24h), failed: fmtNumber(locale, queues.deliveries.failedLast24h), pending: fmtNumber(locale, queues.deliveries.pending) })}</div>
              <div>{t("system.workflowLine", { running: fmtNumber(locale, queues.workflowRuns.running), errors: fmtNumber(locale, queues.workflowRuns.latestErrors.length) })}</div>
              <div className="border-t border-slate-800 pt-2">
                <div className="mb-1 font-medium">{dict.system.workerTitle}</div>
                {!queues.worker ? <p className="text-xs text-slate-400">{dict.system.workerNoInfo}</p> : queues.worker.reachable ? (
                  <div className="space-y-1 text-sm">
                    <div>
                      {queues.worker.health?.status === "degraded"
                        ? <span className="abadge-amber">{dict.system.workerDegraded}</span>
                        : <span className="abadge-green">{dict.system.workerRunning}</span>}
                      {typeof queues.worker.health?.uptimeSec === "number" ? <span>{t("system.workerUptime", { uptime: fmtUptime(queues.worker.health.uptimeSec, dict, locale) })}</span> : null}
                    </div>
                    <div>{dict.system.redisLabel} {queues.worker.health?.redis === "ok" ? <span className="text-emerald-500">{dict.system.redisOk}</span> : <span className="text-red-400">{t("system.redisProblem", { status: queues.worker.health?.redis ?? "?" })}</span>}
                      {" "}· {dict.system.jobSecretLabel} {queues.worker.health?.secretConfigured ? dict.system.jobSecretSet : <span className="text-red-400">{dict.system.jobSecretMissing}</span>}</div>
                    <div className="text-xs text-slate-400">{t("system.workerQueueLine", { queues: (queues.worker.health?.queues ?? []).join(", ") || "—", time: fmtDateTime(locale, queues.worker.checkedAt, "time") })}</div>
                  </div>
                ) : (
                  <div className="rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs">
                    ⚠ {t("system.workerUnreachable", { error: queues.worker.error ?? dict.system.unknownError })}<br />
                    <span className="text-slate-400">{t("system.workerProbeNote", { url: queues.worker.healthUrl })}</span>
                  </div>
                )}
                {queues.bullmq ? (
                  queues.bullmq.available ? (
                    <table className="atable mt-2">
                      <thead><tr><th className="ath">{dict.system.colQueue}</th><th className="ath">{dict.system.colWaiting}</th><th className="ath">{dict.system.colActive}</th><th className="ath">{dict.system.colDelayed}</th><th className="ath">{dict.system.colFailed}</th><th className="ath">{dict.system.colCompleted}</th><th className="ath">{dict.system.colQueueAction}</th></tr></thead>
                      <tbody>{queues.bullmq.queues.map((q) => (
                        <tr key={q.name} className="border-t border-slate-800">
                          <td className="atd font-medium">{q.name}</td><td className="atd">{fmtNumber(locale, q.waiting)}</td><td className="atd">{fmtNumber(locale, q.active)}</td><td className="atd">{fmtNumber(locale, q.delayed)}</td>
                          <td className="atd">{q.failed > 0 ? <span className="text-red-400 font-semibold">{fmtNumber(locale, q.failed)}</span> : fmtNumber(locale, q.failed)}</td><td className="atd">{fmtNumber(locale, q.completed)}</td>
                          <td className="atd">
                            <div className="flex flex-wrap gap-1.5">
                              <button className="abtn-secondary !px-2 !py-0.5 text-xs" onClick={() => queueAction(q.name, "pause")}>{dict.system.pause}</button>
                              <button className="abtn-secondary !px-2 !py-0.5 text-xs" onClick={() => queueAction(q.name, "resume")}>{dict.system.resume}</button>
                              <button className="abtn-secondary !px-2 !py-0.5 text-xs" disabled={q.failed === 0} onClick={() => queueAction(q.name, "retry-failed")}>{dict.system.retryFailed}</button>
                            </div>
                          </td>
                        </tr>
                      ))}</tbody>
                    </table>
                  ) : <p className="mt-1 text-xs text-slate-400">{t("system.bullmqUnavailable", { reason: queues.bullmq.reason ?? queues.bullmq.error ?? "" })}</p>
                ) : null}
                {queues.bullmq?.available ? <p className="mt-1 text-xs text-slate-400">{dict.system.queueActionNote}</p> : null}
              </div>
            </div>
          )}
        </div>

      <div className="acard mt-4">
        <div className="mb-2 font-semibold">{dict.system.inboxTitle}</div>
        {!inboxHealth ? pending(dict.system.inboxInfo) : (
          <div className="space-y-1.5 text-sm">
            <div>{t("system.inboxLine", { sends: fmtNumber(locale, inboxHealth.failedSends24h), errors: fmtNumber(locale, inboxHealth.webhookErrors24h) })}</div>
            {inboxHealth.latestFailures?.map((f: any, i: number) => <div key={i} className="rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs">⚠ {dict.system.inboxSendFailed} <ErrText text={f.error ?? ""} /></div>)}
            <div>{t("system.inboxUnassigned", { count: fmtNumber(locale, inboxHealth.unassignedOpenBacklog) })}{inboxHealth.oldestUnassignedAt ? t("system.inboxOldest", { date: fmtDateTime(locale, inboxHealth.oldestUnassignedAt) }) : ""}</div>
            <div>{t("system.inboxMedia", { count: fmtNumber(locale, inboxHealth.mediaStoredTotal) })}</div>
            <div className="text-xs text-slate-400">{inboxHealth.realtime}</div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {(inboxHealth.channelStates ?? []).map((c: any, i: number) => (
                <span key={i} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.status === "CONNECTED" && !c.hasError ? "bg-emerald-500/15 text-emerald-500" : "bg-red-500/15 text-red-400"}`}>{c.provider}: {c.status}{c.hasError ? dict.system.channelErrorSuffix : ""}</span>
              ))}
              {(inboxHealth.channelStates ?? []).length === 0 ? <span className="text-xs text-slate-400">{dict.system.inboxNoChannels}</span> : null}
            </div>
          </div>
        )}
      </div>

      <div className="acard mt-4">
        <div className="mb-2 font-semibold">{dict.system.dlqTitle}{dlq ? t("system.dlqPending", { count: fmtNumber(locale, dlq.pending) }) : ""}</div>
        {!dlq ? pending(dict.system.dlqInfo) : dlq.entries.length === 0 ? (
          <p className="text-sm text-slate-400">{dict.system.dlqEmpty}</p>
        ) : (
          <div className="space-y-1.5">
            {dlq.entries.map((e: any) => (
              <div key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs">
                <span className="font-semibold">{e.jobType ?? "job"}</span>
                <span className="text-slate-400">{t("system.dlqAttempts", { date: e.createdAt ? fmtDateTime(locale, e.createdAt) : "", attempts: fmtNumber(locale, e.attempts) })}</span>
                <span className="min-w-0 flex-1"><ErrText text={e.error ?? ""} /></span>
                {e.replayedAt ? <span className="text-emerald-500">{dict.system.dlqReplayed}</span> : (
                  <button className="rounded bg-white/10 px-2 py-0.5 font-semibold hover:bg-white/20" onClick={async () => {
                    await apiFetch(`/admin/system/dlq/${e.id}/replay`, { method: "POST" }).catch(() => undefined);
                    load();
                  }}>{dict.system.dlqReplay}</button>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] text-slate-400">{dict.system.dlqNote}</p>
      </div>
      </>) : null}
      {tab === "webhooks" ? (<>
      <div className="acard mt-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="font-semibold">{dict.system.webhooksTitle}</span>
          <input className="ainput w-44" placeholder={dict.system.webhookProviderPlaceholder} value={whProvider} onChange={(e) => setWhProvider(e.target.value)} />
          <label className="flex items-center gap-1.5 text-sm text-slate-400">
            <input type="checkbox" checked={whErrorsOnly} onChange={(e) => setWhErrorsOnly(e.target.checked)} /> {dict.system.errorsOnly}
          </label>
          <button className="abtn-secondary !px-3 !py-1.5 text-xs" onClick={() => loadWebhooks()}>{dict.system.reload}</button>
        </div>
        {!whLoaded ? <div className="askel-table" /> : whError ? <ErrorState message={t("system.webhookLoadError", { message: whError })} onRetry={() => loadWebhooks()} /> : webhooks.length === 0 ? <EmptyState title={dict.system.noWebhooks} /> : (
          <div className="space-y-1.5">
            {webhooks.slice(0, 20).map((w) => (
              <button key={w.id} className="flex w-full flex-wrap items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-left text-sm hover:bg-slate-700/70" onClick={() => openWebhook(w.id)}>
                <span className="font-medium">{w.provider}</span>
                <span className="text-slate-400">{w.topic ?? "—"}</span>
                {w.organizationId ? <a className="text-indigo-300 hover:underline" href={`/orgs/${w.organizationId}`} onClick={(e) => e.stopPropagation()}>{w.organizationName ?? w.organizationId}</a> : <span className="text-slate-400">—</span>}
                <span className="text-xs text-slate-400">{fmtDateTime(locale, w.receivedAt)}</span>
                {w.error ? <span className="text-xs text-red-400">{w.error}</span> : null}
              </button>
            ))}
          </div>
        )}
        {whDetail ? (
          <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900 p-3">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span><b>{whDetail.provider}</b> · {whDetail.topic ?? "—"} · {whDetail.organizationName ?? whDetail.organizationId ?? "—"}</span>
              <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => setWhDetail(null)}>{dict.system.closeAction}</button>
            </div>
            {whDetail.payloadTruncated ? <p className="mb-1 text-xs text-amber-300">{dict.system.truncated}</p> : null}
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs text-slate-300">{typeof whDetail.payload === "string" ? whDetail.payload : JSON.stringify(whDetail.payload, null, 2)}</pre>
          </div>
        ) : null}
      </div>
      </>) : null}
      {tab === "errors" ? (<>
      <div className="acard mt-4">
        <div className="mb-2 font-semibold">{t("system.errorsTitle", { hours: fmtNumber(locale, errors?.windowHours ?? 24), total: errors ? fmtNumber(locale, errors.totalErrors) : "…" })}</div>
        {!errors ? pending(dict.system.errorSummary) : errors.sources.length === 0 ? <EmptyState title={dict.system.noErrors} /> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {errors.sources.map((s) => (
              <div key={s.source} className="rounded-xl border border-slate-800 p-3">
                <div className="flex items-center justify-between"><b className="text-sm">{s.source}</b><span className={s.count > 0 ? "abadge-red" : "abadge-green"}>{fmtNumber(locale, s.count)}</span></div>
                {s.latest.map((e, i) => <div key={i} className="mt-1.5 text-xs text-slate-400">{e.title} — {e.detail ?? ""} <span className="text-slate-400">{fmtDateTime(locale, e.at)}</span></div>)}
                {s.count === 0 ? <p className="mt-1 text-xs text-slate-400">{dict.system.noErrors}</p> : null}
              </div>
            ))}
          </div>
        )}
      </div>
      </>) : null}
      {tab === "backup" ? (<>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="acard">
          <div className="mb-2 font-semibold">{dict.system.dbGrowthTitle} <span className="text-xs font-normal text-slate-400">({growth?.source ?? "…"})</span></div>
          {!growth ? pending(dict.system.dbGrowthInfo) : (
            <table className="atable">
              <thead><tr><th className="ath">{dict.system.colTable}</th><th className="ath">{dict.system.colApproxRows}</th><th className="ath">{dict.system.colSize}</th></tr></thead>
              <tbody>{growth.tables.slice(0, 15).map((row) => (
                <tr key={row.table} className="border-t border-slate-800"><td className="atd">{row.table}</td><td className="atd">{fmtNumber(locale, row.approxRows)}</td><td className="atd">{fmtBytes(row.bytes, locale)}</td></tr>
              ))}</tbody>
            </table>
          )}
          {growth && growth.tables.length === 0 ? <EmptyState title={dict.system.noTables} /> : null}
          {growth?.totalBytes ? <p className="mt-2 text-xs text-slate-400">{t("system.totalTopTables", { size: fmtBytes(growth.totalBytes, locale) })}</p> : null}
        </div>
        <div className="acard space-y-3">
          <div className="font-semibold">{dict.system.backupTitle}</div>
          <p className="text-xs text-slate-400">{dict.system.backupNote}</p>
          {backup?.manifest ? (
            <div className="rounded-xl bg-slate-800 px-3 py-2 text-sm">
              {t("system.backupVerified", { date: fmtDateTime(locale, backup.manifest.at), rows: fmtNumber(locale, backup.manifest.totalRows), tables: fmtNumber(locale, Object.keys(backup.manifest.tables).length), by: backup.manifest.verifiedBy })}
            </div>
          ) : <p className="text-sm text-slate-400">{dict.system.backupNever}</p>}
          <button className="abtn" onClick={async () => {
            try { const m = await apiFetch<{ totalRows: number }>("/admin/system/backup-verify", { method: "POST", body: "{}" }); toast(t("system.manifestCreated", { rows: fmtNumber(locale, m.totalRows) })); await load(); }
            catch (e) { toast(e instanceof Error ? e.message : dict.common.failedShort, "error"); }
          }}>{dict.system.verifyNow}</button>
          <div className="border-t border-slate-800 pt-3 space-y-2">
            <div className="text-sm font-medium">{dict.system.backupRecordTitle}</div>
            <label className="block text-sm">{dict.system.lastBackup} <input type="datetime-local" className="ainput mt-1" value={bkAt} onChange={(e) => setBkAt(e.target.value)} /></label>
            <label className="block text-sm">{dict.system.location} <input className="ainput mt-1" value={bkLocation} onChange={(e) => setBkLocation(e.target.value)} placeholder={dict.system.locationPlaceholder} /></label>
            <label className="block text-sm">{dict.system.noteLabel} <input className="ainput mt-1" value={bkNote} onChange={(e) => setBkNote(e.target.value)} placeholder={dict.system.notePlaceholder} /></label>
            <button className="abtn-secondary" onClick={async () => {
              try { await apiFetch("/admin/system/backup-info", { method: "PATCH", body: JSON.stringify({ lastBackupAt: bkAt ? new Date(bkAt).toISOString() : null, location: bkLocation, note: bkNote }) }); toast(dict.system.backupSaved); await load(); }
              catch (e) { toast(e instanceof Error ? e.message : dict.common.failedShort, "error"); }
            }}>{dict.system.recordSave}</button>
            {backup?.info ? <p className="text-xs text-slate-400">{t("system.backupRecordedBy", { by: backup.info.recordedBy, date: backup.info.lastBackupAt ? fmtDateTime(locale, backup.info.lastBackupAt) : "—", location: backup.info.location })}</p> : null}
          </div>
        </div>
      </div>
      </>) : null}
      {tab === "logs" ? (<>
      <div className="acard">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="font-semibold">{dict.system.logsTitle}</span>
          <input className="ainput max-w-xs" placeholder={dict.system.logSearchPlaceholder} value={logQ} onChange={(e) => setLogQ(e.target.value)} />
        </div>
        <p className="mb-2 text-xs text-slate-400">{dict.system.logsNote}</p>
        {!logLoaded ? <div className="askel-table" /> : logError ? <ErrorState message={t("system.logLoadError", { message: logError })} onRetry={loadLogs} /> : logs.length === 0 ? <EmptyState title={dict.system.noLogs} /> : (
        <table className="atable">
          <thead><tr><th className="ath">{dict.system.colTime}</th><th className="ath">{dict.system.colAction}</th><th className="ath">{dict.system.colEntity}</th><th className="ath">{dict.system.colOrg}</th><th className="ath">{dict.system.colIp}</th></tr></thead>
          <tbody>{logs.map((l, i) => (
            <tr key={i} className="border-t border-slate-800"><td className="atd text-slate-400">{fmtDateTime(locale, l.at)}</td><td className="atd font-medium">{l.action}</td><td className="atd">{l.entityType ?? "—"}</td><td className="atd">{l.organizationId ? l.organizationId.slice(0, 8) + "…" : dict.system.platform}</td><td className="atd">{(l as any).ip ?? "—"}</td></tr>
          ))}</tbody>
        </table>
        )}
      </div>
      </>) : null}
    </AdminShell>
  );
}
