"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { DataTable, EmptyState, ErrorState, PageHead, toast } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";
import { fmtNumber } from "@repo/contracts";
import { useAdminLocale } from "@/components/AdminLocale";

interface HealthJobs {
  failedSyncJobs: { id: string; kind: string; error?: string | null; startedAt: string }[];
  errorRuns24h: { id: string; status: string; createdAt: string }[];
  scheduledJobs: { id: string; name: string; type: string; organizationId: string; enabled: boolean; lastStatus?: string | null; lastError?: string | null; nextRunAt: string }[];
}
interface HealthInt { byProvider: Record<string, { total: number; connected: number }>; broken: { id: string; provider: string; status: string; organizationName: string }[] }
interface ConnHealth {
  generatedAt: string; windowDays: number;
  summary: { total: number; broken: number; atRisk: number; ok: number; noData: number };
  connections: {
    organizationId: string; organizationName: string; targetType: string; targetId: string;
    provider: string | null; displayName: string | null; targetStatus: string | null;
    checks: number; passed: number; failed: number; degraded: number; uptimePct: number | null;
    latestStatus: string | null; lastCheckedAt: string | null; tokenDaysLeft: number | null; expiryBucket: string | null;
    boardStatus: "broken" | "at_risk" | "ok" | "no_data";
  }[];
}

export default function HealthPage() {
  const { dict, locale, t } = useAdminLocale();
  const [jobs, setJobs] = React.useState<HealthJobs | null>(null);
  const [ints, setInts] = React.useState<HealthInt | null>(null);
  const [conns, setConns] = React.useState<ConnHealth | null>(null);
  // ADX12: loadDone separates "still loading" from "load failed"
  // — before, a failed fetch left each card on "লোড হচ্ছে…" forever.
  const [loadDone, setLoadDone] = React.useState(false);
  const load = React.useCallback(async () => {
    setLoadDone(false);
    setJobs(await apiFetch<HealthJobs>("/admin/health/jobs").catch(() => null));
    setInts(await apiFetch<HealthInt>("/admin/health/integrations").catch(() => null));
    setConns(await apiFetch<ConnHealth>("/admin/health/connections").catch(() => null));
    setLoadDone(true);
  }, []);
  // ADNX11: retry/nudge feedback rides the ONE toast system — the
  // old indigo banner carried only transient action results.
  async function nudgeConn(organizationId: string) {
    try {
      const out: any = await apiFetch("/admin/alerts/nudge", { method: "POST", body: JSON.stringify({ organizationId, kind: "integration_error" }) });
      toast(t("health.nudgeSent", { count: fmtNumber(locale, out.sent) }));
    } catch (e) { toast(e instanceof Error ? e.message : dict.health.nudgeFailed, "error"); }
  }
  React.useEffect(() => { load(); }, [load]);
  async function retry(kind: string, id: string) {
    try {
      const out: any = await apiFetch("/admin/health/retry", { method: "POST", body: JSON.stringify({ kind, id }) });
      toast(out.retried ? dict.health.retryDone : (out.message ?? dict.health.retryNotDone), out.retried ? "success" : "info");
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : dict.health.retryFailed, "error"); }
  }
  // ADX8: traffic-light summary — প্রতিটি আলো শুধু ওই এলাকার ইতিমধ্যে
  // লোড করা ডেটা থেকেই: ভাঙা integration থাকলে লাল, connection
  // board-এ broken থাকলে লাল / atRisk থাকলে হলুদ, ব্যর্থ job থাকলে
  // লাল; ডেটা লোড না হলে সেই এলাকার আলোই নেই (অনুমান নয়)। Connection
  // board-এ শুধু "তথ্য নেই" থাকলে ধূসর — সেটি board-এর নিজের অবস্থা।
  const lights: { id: string; label: string; tone: "red" | "amber" | "green" | "slate"; text: string }[] = [];
  if (ints) lights.push(ints.broken.length > 0
    ? { id: "health-integrations", label: dict.health.lightIntegrations, tone: "red", text: t("health.lightBroken", { count: fmtNumber(locale, ints.broken.length) }) }
    : { id: "health-integrations", label: dict.health.lightIntegrations, tone: "green", text: dict.health.lightAllOk });
  if (jobs) {
    const failed = jobs.failedSyncJobs.length + jobs.errorRuns24h.length;
    lights.push(failed > 0
      ? { id: "health-jobs", label: dict.health.lightJobs, tone: "red", text: t("health.lightFailed", { count: fmtNumber(locale, failed) }) }
      : { id: "health-jobs", label: dict.health.lightJobs, tone: "green", text: dict.health.lightNoFailures });
    const errJobs = jobs.scheduledJobs.filter((j) => j.enabled && j.lastStatus === "error").length;
    lights.push(errJobs > 0
      ? { id: "health-scheduled", label: dict.health.lightScheduled, tone: "red", text: t("health.lightErrorState", { count: fmtNumber(locale, errJobs) }) }
      : { id: "health-scheduled", label: dict.health.lightScheduled, tone: "green", text: dict.health.lightNoError });
  }
  if (conns && conns.summary.total > 0) {
    if (conns.summary.broken > 0) lights.push({ id: "health-connections", label: dict.health.lightConnections, tone: "red", text: t("health.lightBroken", { count: fmtNumber(locale, conns.summary.broken) }) });
    else if (conns.summary.atRisk > 0) lights.push({ id: "health-connections", label: dict.health.lightConnections, tone: "amber", text: t("health.lightAtRisk", { count: fmtNumber(locale, conns.summary.atRisk) }) });
    else if (conns.summary.ok > 0) lights.push({ id: "health-connections", label: dict.health.lightConnections, tone: "green", text: dict.health.lightAllOk });
    else lights.push({ id: "health-connections", label: dict.health.lightConnections, tone: "slate", text: dict.health.lightNoDataOnly });
  }
  // ADX12: per-card pending slot — the v3 error state (with a
  // retry of the same load) after a completed-but-failed load.
  // ADNX11: the in-flight half is now a real skeleton, not text.
  const pending = (label: string) => loadDone
    ? <ErrorState message={t("health.loadErrorSuffix", { label })} onRetry={load} />
    : <div className="space-y-2" aria-label={dict.common.loading}><div className="askel h-4 w-2/3" /><div className="askel h-4 w-1/2" /><div className="askel h-4 w-3/5" /></div>;
  const toneDot = { red: "bg-red-400", amber: "bg-amber-400", green: "bg-emerald-400", slate: "bg-slate-500" } as const;
  const toneText = { red: "text-red-300", amber: "text-amber-300", green: "text-emerald-300", slate: "text-slate-400" } as const;
  return (
    <AdminShell title={dict.health.title}>
      <PageHead sub={dict.health.sub} />
      {/* ADNX11: the traffic-light card stays the FIRST content
          block, so it lands in the first mobile viewport. */}
      {lights.length > 0 ? (
        <div className="acard mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 !py-3.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{dict.health.atAGlance}</span>
          {lights.map((l) => (
            <a key={l.id} href={`#${l.id}`} className="flex items-center gap-2 text-sm hover:underline">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${toneDot[l.tone]}`} />
              <span className="font-medium">{l.label}</span>
              <span className={toneText[l.tone]}>{l.text}</span>
            </a>
          ))}
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="acard" id="health-integrations">
          <div className="mb-2 font-semibold">{dict.health.integrationsTitle}</div>
          {!ints ? pending(dict.health.integrationInfo) : (
            <>
              <ul className="space-y-1 text-sm">{Object.entries(ints.byProvider).map(([p, v]) => <li key={p} className="flex justify-between border-b border-slate-800 pb-1"><span>{p}</span><span>{t("health.connectedSuffix", { connected: fmtNumber(locale, v.connected), total: fmtNumber(locale, v.total) })}</span></li>)}</ul>
              {ints.broken.length > 0 ? <div className="mt-3 text-sm"><div className="mb-1 font-medium text-amber-300">{t("health.brokenTitle", { count: fmtNumber(locale, ints.broken.length) })}</div>{ints.broken.slice(0, 10).map((b) => <div key={b.id} className="rounded bg-slate-800 px-2 py-1.5">{b.provider} · {b.organizationName} · {b.status}</div>)}</div> : <p className="mt-2 text-sm text-emerald-300">{dict.health.allIntegrationsOk}</p>}
            </>
          )}
        </div>
        <div className="acard" id="health-jobs">
          <div className="mb-2 font-semibold">{dict.health.failedSyncTitle}</div>
          {!jobs ? pending(dict.health.jobInfo) : jobs.failedSyncJobs.length === 0 ? <p className="text-sm text-emerald-300">{dict.health.noFailedSync}</p> : (
            <ul className="space-y-2 text-sm">{jobs.failedSyncJobs.map((j) => (
              <li key={j.id} className="rounded bg-slate-800 px-3 py-2">
                <div className="flex items-center justify-between"><span>{j.kind} · {fmtDateTime(locale, j.startedAt)}</span><button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => retry("sync_job", j.id)}>{dict.health.retry}</button></div>
                {j.error ? <div className="mt-1 text-xs text-red-300">{j.error}</div> : null}
              </li>
            ))}</ul>
          )}
          <div className="mb-2 mt-5 font-semibold">{t("health.automationErrors", { count: fmtNumber(locale, jobs?.errorRuns24h.length ?? 0) })}</div>
        </div>
      </div>
      <div className="acard mt-4 overflow-hidden p-0" id="health-connections">
        <div className="border-b border-slate-800 p-4">
          <div className="font-semibold">{t("health.connBoardTitle", { days: fmtNumber(locale, conns?.windowDays ?? 30) })}</div>
          <p className="mt-1 text-xs text-slate-400">{dict.health.connBoardNote}</p>
          {conns ? <p className="mt-2 text-sm">{t("health.connTotal", { total: fmtNumber(locale, conns.summary.total) })} · <span className="text-red-300">{t("health.connBroken", { broken: fmtNumber(locale, conns.summary.broken) })}</span> · <span className="text-amber-300">{t("health.connAtRisk", { atRisk: fmtNumber(locale, conns.summary.atRisk) })}</span> · <span className="text-emerald-300">{t("health.connOk", { ok: fmtNumber(locale, conns.summary.ok) })}</span> · {t("health.connNoData", { noData: fmtNumber(locale, conns.summary.noData) })}</p> : null}
        </div>
        {!conns ? <div className="p-4">{pending(dict.health.connInfo)}</div> : conns.connections.length === 0 ? <div className="p-4"><EmptyState title={dict.health.noConnections} /></div> : (
            <DataTable>
              <thead className="bg-slate-900"><tr><th className="ath">{dict.health.colStatus}</th><th className="ath">{dict.health.colConnection}</th><th className="ath">{dict.health.colOrg}</th><th className="ath">{dict.health.colChecks}</th><th className="ath">{dict.health.colUptime}</th><th className="ath">{dict.health.colLastCheck}</th><th className="ath"></th></tr></thead>
              <tbody>{conns.connections.map((c) => (
                <tr key={`${c.organizationId}-${c.targetType}-${c.targetId}`} className="border-t border-slate-800">
                  <td data-label={dict.health.colStatus} className="atd">{c.boardStatus === "broken" ? <span className="abadge-red">{dict.health.statusBroken}</span> : c.boardStatus === "at_risk" ? <span className="abadge-amber">{dict.health.statusAtRisk}</span> : c.boardStatus === "ok" ? <span className="abadge-green">{dict.health.statusOk}</span> : <span className="abadge-slate">{dict.health.statusNoData}</span>}{c.expiryBucket ? <div className="mt-1 text-xs text-amber-300">{t("health.tokenExpiry", { text: c.tokenDaysLeft !== null && c.tokenDaysLeft < 0 ? dict.health.tokenExpired : t("health.tokenDaysLeft", { days: fmtNumber(locale, c.tokenDaysLeft ?? 0) }) })}</div> : null}</td>
                  <td data-label={dict.health.colConnection} className="atd">{c.displayName ?? c.provider ?? c.targetType}<div className="text-xs text-slate-400">{c.provider ?? ""} · {c.targetType}{c.targetStatus === "missing" ? dict.health.deletedSuffix : ""}</div></td>
                  <td data-label={dict.health.colOrg} className="atd"><a className="text-indigo-300 underline" href={`/orgs/${c.organizationId}`}>{c.organizationName}</a></td>
                  <td data-label={dict.health.colChecks} className="atd">{c.checks > 0 ? t("health.checksFormat", { checks: fmtNumber(locale, c.checks), passed: fmtNumber(locale, c.passed), failed: fmtNumber(locale, c.failed), degraded: fmtNumber(locale, c.degraded) }) : "—"}</td>
                  <td data-label={dict.health.colUptime} className="atd">{c.uptimePct !== null ? `${fmtNumber(locale, c.uptimePct)}%` : dict.health.statusNoData}</td>
                  <td data-label={dict.health.colLastCheck} className="atd text-slate-400">{c.lastCheckedAt ? fmtDateTime(locale, c.lastCheckedAt) : dict.health.never}</td>
                  <td className="atd">{c.boardStatus === "broken" ? <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => nudgeConn(c.organizationId)}>{dict.health.nudge}</button> : null}</td>
                </tr>
              ))}</tbody>
            </DataTable>
        )}
      </div>
      <div className="acard mt-4 overflow-hidden p-0" id="health-scheduled">
        <div className="border-b border-slate-800 p-4 font-semibold">{dict.health.scheduledTitle}</div>
        <DataTable empty={(jobs?.scheduledJobs ?? []).length === 0 ? <div className="p-4">{!jobs ? (loadDone ? <ErrorState message={dict.health.scheduledLoadError} onRetry={load} /> : <div className="askel-table" />) : <EmptyState title={dict.health.noScheduled} />}</div> : null}>
          <thead className="bg-slate-900"><tr><th className="ath">{dict.health.colJob}</th><th className="ath">{dict.health.colType}</th><th className="ath">{dict.health.colStatus}</th><th className="ath">{dict.health.colNextRun}</th><th className="ath"></th></tr></thead>
          <tbody>{(jobs?.scheduledJobs ?? []).map((j) => (
            <tr key={j.id} className="border-t border-slate-800">
              <td data-label={dict.health.colJob} className="atd">{j.name}<div className="text-xs text-slate-400">{j.organizationId.slice(0, 8)}…</div></td>
              <td data-label={dict.health.colType} className="atd">{j.type}</td>
              <td data-label={dict.health.colStatus} className="atd">{j.enabled ? (j.lastStatus === "error" ? <span className="abadge-red">error</span> : <span className="abadge-green">{j.lastStatus ?? "enabled"}</span>) : <span className="abadge-slate">disabled</span>}{j.lastError ? <div className="mt-1 max-w-md truncate text-xs text-red-300">{j.lastError}</div> : null}</td>
              <td data-label={dict.health.colNextRun} className="atd text-slate-400">{fmtDateTime(locale, j.nextRunAt)}</td>
              <td className="atd"><button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => retry("scheduled_job", j.id)}>{dict.health.runNow}</button></td>
            </tr>
          ))}</tbody>
        </DataTable>
      </div>
    </AdminShell>
  );
}
