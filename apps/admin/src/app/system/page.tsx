"use client";

import React from "react";
import AdminShell from "@/components/AdminShell";
import { apiFetch } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";

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

function fmtBytes(n: number | null): string {
  if (n === null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}
function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400); const h = Math.floor((sec % 86400) / 3600); const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d} দিন ${h} ঘণ্টা` : h > 0 ? `${h} ঘণ্টা ${m} মিনিট` : `${m} মিনিট`;
}

export default function SystemPage() {
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
  const [msg, setMsg] = React.useState("");
  const [bkLocation, setBkLocation] = React.useState("");
  const [bkNote, setBkNote] = React.useState("");
  const [bkAt, setBkAt] = React.useState("");
  const [webhooks, setWebhooks] = React.useState<WebhookEventRow[]>([]);
  const [whProvider, setWhProvider] = React.useState("");
  const [whErrorsOnly, setWhErrorsOnly] = React.useState(false);
  const [whDetail, setWhDetail] = React.useState<WebhookEventDetail | null>(null);

  async function loadWebhooks(provider = whProvider, errorsOnly = whErrorsOnly) {
    const params = new URLSearchParams();
    if (provider.trim()) params.set("provider", provider.trim());
    if (errorsOnly) params.set("hasError", "true");
    params.set("take", "50");
    setWebhooks(await apiFetch<WebhookEventRow[]>(`/admin/system/webhooks?${params.toString()}`).catch(() => []));
  }
  async function openWebhook(id: string) {
    const detail = await apiFetch<WebhookEventDetail>(`/admin/system/webhooks/${id}`).catch(() => null);
    setWhDetail(detail);
  }

  const load = React.useCallback(async () => {
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
  }, []);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    apiFetch<LogRow[]>(`/admin/system/logs?take=60${logQ ? `&q=${encodeURIComponent(logQ)}` : ""}`).then(setLogs).catch(() => setLogs([]));
  }, [logQ]);

  // AB3 / AN12: queue operator actions — reason বাধ্যতামূলক (Audit-এ
  // থাকে), API-র ফলাফল হুবহু দেখানো হয়। Drain/Delete জাতীয় কোনো
  // ধ্বংসাত্মক action এখানে নেই।
  async function queueAction(queue: string, action: "pause" | "resume" | "retry-failed") {
    const reason = window.prompt(`${queue} queue — ${action === "pause" ? "Pause" : action === "resume" ? "Resume" : "ব্যর্থ Job আবার চেষ্টা"} করার কারণ (Audit-এ থাকবে):`);
    if (!reason || reason.trim().length < 3) { if (reason !== null) setMsg("কারণ ছাড়া এই action করা যাবে না।"); return; }
    try {
      const out = await apiFetch<any>(`/admin/system/queues/${queue}/${action}`, { method: "POST", body: JSON.stringify({ reason }) });
      if (out.available === false) {
        setMsg(`⚠ ${queue}: action করা যায়নি — ${out.reason ?? out.error ?? "queue উপলব্ধ নয়"}`);
      } else if (action === "retry-failed") {
        const fails = (out.results ?? []).filter((r: any) => !r.retried).map((r: any) => `#${r.id}: ${r.error}`).join("; ");
        setMsg(`✅ ${queue}: ${out.requested}টি ব্যর্থ Job-এর মধ্যে ${out.retried}টি আবার queue-তে গেছে (Failed ছিল ${out.failedBefore} → এখন ${out.failedAfter})।${fails ? ` হয়নি: ${fails}` : ""}`);
      } else {
        setMsg(`✅ ${queue}: ${action === "pause" ? "Pause করা হয়েছে" : "Resume করা হয়েছে"} (Paused: ${out.paused ? "হ্যাঁ" : "না"})।`);
      }
      await load();
    } catch (e) {
      setMsg(`❌ ${queue}: ${e instanceof Error ? e.message : "action ব্যর্থ হয়েছে"}`);
    }
  }

  return (
    <AdminShell title="🖥 System & Reliability">
      {msg ? <p className="mb-3 rounded-lg bg-indigo-500/10 p-3 text-sm text-indigo-200">{msg}</p> : null}
      <div className="acard mb-4 space-y-2">
        <div className="font-semibold">🚀 Deploy প্রস্তুতি <span className="text-xs font-normal text-slate-500">(শুধু আছে/নেই — কোনো মান কখনো দেখানো হয় না)</span></div>
        {!envCheck ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : (
          <div className="space-y-2">
            {envCheck.summary.requiredMissing > 0 ? (
              <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">⚠️ {envCheck.summary.requiredMissing}টি বাধ্যতামূলক জিনিস বাকি — deploy/redeploy-এর আগে Dokploy-এর Environment ট্যাবে বসান।</p>
            ) : (
              <p className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">✅ সব বাধ্যতামূলক env API প্রসেসে আছে ({envCheck.summary.requiredPresent}/{envCheck.summary.requiredTotal})।</p>
            )}
            <div className="space-y-1">
              {envCheck.apiEnv.map((e) => (
                <div key={e.name} className="flex flex-wrap items-baseline gap-2 text-sm">
                  <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">{e.name}</code>
                  {e.present ? <span className="abadge-green">আছে</span> : e.required ? <span className="abadge-red">নেই — বাধ্যতামূলক</span> : <span className="abadge-amber">নেই (ঐচ্ছিক)</span>}
                  <span className="text-xs text-slate-400">{e.hintBn}</span>
                </div>
              ))}
            </div>
            <div className="space-y-1 border-t border-slate-800 pt-2">
              <div className="text-xs font-medium text-slate-400">Compose স্তরের জিনিস — এগুলো API থেকে যাচাই করা যায় না, Dokploy-তে মিলিয়ে দেখুন:</div>
              {envCheck.composeEnv.map((e) => (
                <div key={e.name} className="flex flex-wrap items-baseline gap-2 text-sm opacity-80">
                  <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">{e.name}</code>
                  <span className="rounded-full bg-slate-500/15 px-2 py-0.5 text-[11px] font-semibold text-slate-400">যাচাই করা যায় না</span>
                  <span className="text-xs text-slate-400">{e.hintBn}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-slate-800 pt-2 text-sm">
              Migration: প্রয়োগ হয়েছে <b>{envCheck.migrations ? envCheck.migrations.applied : "—"}</b>
              {envCheck.migrations?.repoTotal != null ? <> · repo-তে মোট {envCheck.migrations.repoTotal} · <b>বাকি {envCheck.migrations.pending ?? 0}টি</b>{envCheck.migrations.pendingNames.length ? <span className="text-xs text-slate-400"> ({envCheck.migrations.pendingNames.join(", ")})</span> : null}</> : <span className="text-xs text-slate-500"> · repo-র migration তালিকা এই প্রসেস থেকে পড়া যায়নি, তাই বাকি সংখ্যা বলা যাচ্ছে না</span>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {envCheck.platformConfig.map((a) => (
                <span key={a.area} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${a.source === "admin" ? "bg-emerald-500/15 text-emerald-500" : a.source === "env" ? "bg-amber-500/15 text-amber-500" : "bg-red-500/15 text-red-400"}`}>{a.label}: {a.source === "admin" ? "Admin সেটিং" : a.source === "env" ? "Env" : "সেট নেই"}{a.secretConfigured ? " · secret আছে" : ""}</span>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="acard space-y-2">
          <div className="font-semibold">🚀 Version ও Deploy</div>
          {!version ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : (
            <div className="space-y-1 text-sm">
              <div>Version: <b>{version.appVersion}</b> · Git: <b>{version.gitSha ? version.gitSha.slice(0, 10) : "সেট নেই (GIT_SHA env)"}</b></div>
              <div>Node: {version.nodeVersion} · পরিবেশ: {version.environment}</div>
              <div>চালু আছে: {fmtUptime(version.uptimeSeconds)} (Boot {fmtDateTime(version.bootTime)})</div>
              <div>Database: {version.database.reachable ? <span className="abadge-green">পৌঁছানো যাচ্ছে · {version.database.latencyMs}ms</span> : <span className="abadge-red">পৌঁছানো যাচ্ছে না</span>}</div>
              <div>Migration প্রয়োগ হয়েছে: <b>{version.migrations ? version.migrations.applied : "—"}</b>{version.migrations?.latest ? ` · সর্বশেষ ${version.migrations.latest}` : ""}</div>
              <p className="text-xs text-slate-500">Dokploy তে GIT_SHA / APP_VERSION env দিলে এখানে Deploy এর পরিচয় দেখাবে। Migration সংখ্যা আসে সরাসরি Database থেকে।</p>
            </div>
          )}
        </div>
        <div className="acard space-y-2">
          <div className="font-semibold">📬 Queue Monitor</div>
          {!queues ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : (
            <div className="space-y-1.5 text-sm">
              <div>Scheduled Job: মোট {queues.scheduledJobs.total} · চালু {queues.scheduledJobs.enabled} · <b>এখন Due {queues.scheduledJobs.dueNow}</b></div>
              {queues.scheduledJobs.recentlyFailed.map((j, i) => <div key={i} className="rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs">⚠ {j.name} ({j.type}) — {j.lastError}</div>)}
              <div>Store Sync: চলমান {queues.syncJobs.running} · শেষ ২৪ ঘণ্টায় ব্যর্থ {queues.syncJobs.failedLast24h}</div>
              {queues.syncJobs.latestFailures.map((j, i) => <div key={i} className="rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs">⚠ {j.kind} sync — {j.error ?? ""}</div>)}
              <div>Message Delivery (২৪ ঘণ্টা): মোট {queues.deliveries.last24h} · ব্যর্থ {queues.deliveries.failedLast24h} · Pending {queues.deliveries.pending}</div>
              <div>Workflow Run: চলমান {queues.workflowRuns.running} · সাম্প্রতিক Error {queues.workflowRuns.latestErrors.length}</div>
              <div className="border-t border-slate-800 pt-2">
                <div className="mb-1 font-medium">🛠 Worker Process (AA2)</div>
                {!queues.worker ? <p className="text-xs text-slate-500">Worker তথ্য পাওয়া যায়নি।</p> : queues.worker.reachable ? (
                  <div className="space-y-1 text-sm">
                    <div>
                      {queues.worker.health?.status === "degraded"
                        ? <span className="abadge-amber">চলছে — কিন্তু Degraded</span>
                        : <span className="abadge-green">চলছে</span>}
                      {typeof queues.worker.health?.uptimeSec === "number" ? <span> · চালু আছে {fmtUptime(queues.worker.health.uptimeSec)}</span> : null}
                    </div>
                    <div>Redis: {queues.worker.health?.redis === "ok" ? <span className="text-emerald-500">ঠিক আছে</span> : <span className="text-red-400">সমস্যা ({queues.worker.health?.redis ?? "?"})</span>}
                      {" "}· Job Secret: {queues.worker.health?.secretConfigured ? "সেট আছে" : <span className="text-red-400">সেট নেই — Job চলবে না</span>}</div>
                    <div className="text-xs text-slate-400">Queue: {(queues.worker.health?.queues ?? []).join(", ") || "—"} · যাচাই {fmtDateTime(queues.worker.checkedAt, "time")}</div>
                  </div>
                ) : (
                  <div className="rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs">
                    ⚠ Worker-এ পৌঁছানো যাচ্ছে না — {queues.worker.error ?? "অজানা ত্রুটি"}<br />
                    <span className="text-slate-400">Worker process/container চলছে কিনা দেখুন (Dokploy → worker service)। Probe ঠিকানা: {queues.worker.healthUrl}</span>
                  </div>
                )}
                {queues.bullmq ? (
                  queues.bullmq.available ? (
                    <table className="atable mt-2">
                      <thead><tr><th className="ath">BullMQ Queue</th><th className="ath">Waiting</th><th className="ath">Active</th><th className="ath">Delayed</th><th className="ath">Failed</th><th className="ath">Completed</th><th className="ath">Action (AB3)</th></tr></thead>
                      <tbody>{queues.bullmq.queues.map((q) => (
                        <tr key={q.name} className="border-t border-slate-800">
                          <td className="atd font-medium">{q.name}</td><td className="atd">{q.waiting}</td><td className="atd">{q.active}</td><td className="atd">{q.delayed}</td>
                          <td className="atd">{q.failed > 0 ? <span className="text-red-400 font-semibold">{q.failed}</span> : q.failed}</td><td className="atd">{q.completed}</td>
                          <td className="atd">
                            <div className="flex flex-wrap gap-1.5">
                              <button className="abtn-secondary !px-2 !py-0.5 text-xs" onClick={() => queueAction(q.name, "pause")}>Pause</button>
                              <button className="abtn-secondary !px-2 !py-0.5 text-xs" onClick={() => queueAction(q.name, "resume")}>Resume</button>
                              <button className="abtn-secondary !px-2 !py-0.5 text-xs" disabled={q.failed === 0} onClick={() => queueAction(q.name, "retry-failed")}>ব্যর্থ আবার চেষ্টা</button>
                            </div>
                          </td>
                        </tr>
                      ))}</tbody>
                    </table>
                  ) : <p className="mt-1 text-xs text-slate-500">BullMQ count পাওয়া যাচ্ছে না: {queues.bullmq.reason ?? queues.bullmq.error ?? ""}</p>
                ) : null}
                {queues.bullmq?.available ? <p className="mt-1 text-xs text-slate-500">Queue action (Pause/Resume/Retry) শুধু SUPER Admin-এর জন্য, প্রতিটিতে কারণ বাধ্যতামূলক ও Audit-এ থাকে। Queue খালি করা (drain) বা Job মোছার কোনো action ইচ্ছা করেই রাখা হয়নি।</p> : null}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="acard mt-4">
        <div className="mb-2 font-semibold">💬 Inbox Health (Unified Inbox U6)</div>
        {!inboxHealth ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : (
          <div className="space-y-1.5 text-sm">
            <div>ব্যর্থ Send (২৪ ঘণ্টা): <b>{inboxHealth.failedSends24h}</b> · Webhook Error (২৪ ঘণ্টা): <b>{inboxHealth.webhookErrors24h}</b></div>
            {inboxHealth.latestFailures?.map((f: any, i: number) => <div key={i} className="rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs">⚠ Send ব্যর্থ — {f.error ?? ""}</div>)}
            <div>অ্যাসাইনবিহীন খোলা কথোপকথন: <b>{inboxHealth.unassignedOpenBacklog}</b>{inboxHealth.oldestUnassignedAt ? ` · সবচেয়ে পুরনো: ${fmtDateTime(inboxHealth.oldestUnassignedAt)}` : ""}</div>
            <div>সংরক্ষিত মিডিয়া (Pipeline): <b>{inboxHealth.mediaStoredTotal}</b>টি ফাইল</div>
            <div className="text-xs text-slate-400">{inboxHealth.realtime}</div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {(inboxHealth.channelStates ?? []).map((c: any, i: number) => (
                <span key={i} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.status === "CONNECTED" && !c.hasError ? "bg-emerald-500/15 text-emerald-500" : "bg-red-500/15 text-red-400"}`}>{c.provider}: {c.status}{c.hasError ? " (error)" : ""}</span>
              ))}
              {(inboxHealth.channelStates ?? []).length === 0 ? <span className="text-xs text-slate-500">কোনো Channel Integration নেই</span> : null}
            </div>
          </div>
        )}
      </div>

      <div className="acard mt-4">
        <div className="mb-2 font-semibold">☠️ Dead-Letter Queue (M57) {dlq ? `— মুলতুবি ${dlq.pending}টি` : ""}</div>
        {!dlq ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : dlq.entries.length === 0 ? (
          <p className="text-sm text-slate-500">কোনো Dead-letter Job নেই — সব নির্ধারিত Job সফল বা Retry তে আছে।</p>
        ) : (
          <div className="space-y-1.5">
            {dlq.entries.map((e: any) => (
              <div key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs">
                <span className="font-semibold">{e.jobType ?? "job"}</span>
                <span className="text-slate-400">{e.createdAt ? fmtDateTime(e.createdAt) : ""} · {e.attempts} বার চেষ্টা</span>
                <span className="min-w-0 flex-1 truncate" title={e.error}>{e.error}</span>
                {e.replayedAt ? <span className="text-emerald-500">↻ Replay হয়েছে</span> : (
                  <button className="rounded bg-white/10 px-2 py-0.5 font-semibold hover:bg-white/20" onClick={async () => {
                    await apiFetch(`/admin/system/dlq/${e.id}/replay`, { method: "POST" }).catch(() => undefined);
                    load();
                  }}>↻ Replay</button>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] text-slate-500">Worker ৩ বার ব্যর্থ হলে Job এখানে আসে। Replay করলে আবার Queue তে (বা Inline) চলবে।</p>
      </div>

      <div className="acard mt-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="font-semibold">🪝 Webhook Events</span>
          <input className="ainput w-44" placeholder="Provider — যেমন woocommerce" value={whProvider} onChange={(e) => setWhProvider(e.target.value)} />
          <label className="flex items-center gap-1.5 text-sm text-slate-400">
            <input type="checkbox" checked={whErrorsOnly} onChange={(e) => setWhErrorsOnly(e.target.checked)} /> শুধু Error
          </label>
          <button className="abtn-secondary !px-3 !py-1.5 text-xs" onClick={() => loadWebhooks()}>↻ আবার লোড</button>
        </div>
        {webhooks.length === 0 ? <p className="text-sm text-slate-500">কোনো Webhook Event নেই।</p> : (
          <div className="space-y-1.5">
            {webhooks.slice(0, 20).map((w) => (
              <button key={w.id} className="flex w-full flex-wrap items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-left text-sm hover:bg-slate-700/70" onClick={() => openWebhook(w.id)}>
                <span className="font-medium">{w.provider}</span>
                <span className="text-slate-400">{w.topic ?? "—"}</span>
                {w.organizationId ? <a className="text-indigo-300 hover:underline" href={`/orgs/${w.organizationId}`} onClick={(e) => e.stopPropagation()}>{w.organizationName ?? w.organizationId}</a> : <span className="text-slate-500">—</span>}
                <span className="text-xs text-slate-500">{fmtDateTime(w.receivedAt)}</span>
                {w.error ? <span className="text-xs text-red-400">{w.error}</span> : null}
              </button>
            ))}
          </div>
        )}
        {whDetail ? (
          <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900 p-3">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span><b>{whDetail.provider}</b> · {whDetail.topic ?? "—"} · {whDetail.organizationName ?? whDetail.organizationId ?? "—"}</span>
              <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => setWhDetail(null)}>বন্ধ করুন</button>
            </div>
            {whDetail.payloadTruncated ? <p className="mb-1 text-xs text-amber-300">কেটে দেওয়া হয়েছে (truncated)</p> : null}
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs text-slate-300">{typeof whDetail.payload === "string" ? whDetail.payload : JSON.stringify(whDetail.payload, null, 2)}</pre>
          </div>
        ) : null}
      </div>

      <div className="acard mt-4">
        <div className="mb-2 font-semibold">🔥 Error Summary (শেষ {errors?.windowHours ?? 24} ঘণ্টা) — মোট {errors?.totalErrors ?? "…"}</div>
        {!errors ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {errors.sources.map((s) => (
              <div key={s.source} className="rounded-xl border border-slate-800 p-3">
                <div className="flex items-center justify-between"><b className="text-sm">{s.source}</b><span className={s.count > 0 ? "abadge-red" : "abadge-green"}>{s.count}</span></div>
                {s.latest.map((e, i) => <div key={i} className="mt-1.5 text-xs text-slate-400">{e.title} — {e.detail ?? ""} <span className="text-slate-600">{fmtDateTime(e.at)}</span></div>)}
                {s.count === 0 ? <p className="mt-1 text-xs text-slate-500">কোনো Error নেই।</p> : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2 mt-4">
        <div className="acard">
          <div className="mb-2 font-semibold">🗄 Database Growth <span className="text-xs font-normal text-slate-500">({growth?.source ?? "…"})</span></div>
          {!growth ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : (
            <table className="atable">
              <thead><tr><th className="ath">Table</th><th className="ath">আনুমানিক Row</th><th className="ath">আকার</th></tr></thead>
              <tbody>{growth.tables.slice(0, 15).map((t) => (
                <tr key={t.table} className="border-t border-slate-800"><td className="atd">{t.table}</td><td className="atd">{t.approxRows.toLocaleString()}</td><td className="atd">{fmtBytes(t.bytes)}</td></tr>
              ))}</tbody>
            </table>
          )}
          {growth?.totalBytes ? <p className="mt-2 text-xs text-slate-500">মোট (শীর্ষ Table গুলো): {fmtBytes(growth.totalBytes)}</p> : null}
        </div>
        <div className="acard space-y-3">
          <div className="font-semibold">💾 Backup Status</div>
          <p className="text-xs text-slate-500">আসল Backup হয় অ্যাপের বাইরে (Dokploy/Postgres)। অ্যাপ যেটা যাচাই করতে পারে তা হলো ডেটার বর্তমান Integrity — নিচের Manifest টি লাইভ Row Count থেকে তৈরি। বাইরের Backup এর তথ্য Operator রেকর্ড করেন।</p>
          {backup?.manifest ? (
            <div className="rounded-xl bg-slate-800 px-3 py-2 text-sm">
              ✅ সর্বশেষ যাচাই {fmtDateTime(backup.manifest.at)} — মোট <b>{backup.manifest.totalRows.toLocaleString()}</b> Row, {Object.keys(backup.manifest.tables).length} টি Core Table · যাচাই করেছেন {backup.manifest.verifiedBy}
            </div>
          ) : <p className="text-sm text-slate-500">এখনো কোনো Integrity যাচাই হয়নি।</p>}
          <button className="abtn" onClick={async () => {
            try { const m = await apiFetch<{ totalRows: number }>("/admin/system/backup-verify", { method: "POST", body: "{}" }); setMsg(`Integrity Manifest তৈরি হয়েছে — মোট ${m.totalRows.toLocaleString()} Row।`); await load(); }
            catch (e) { setMsg(e instanceof Error ? e.message : "ব্যর্থ"); }
          }}>এখনই Integrity যাচাই করুন</button>
          <div className="border-t border-slate-800 pt-3 space-y-2">
            <div className="text-sm font-medium">বাইরের Backup এর রেকর্ড</div>
            <label className="block text-sm">সর্বশেষ Backup <input type="datetime-local" className="ainput mt-1" value={bkAt} onChange={(e) => setBkAt(e.target.value)} /></label>
            <label className="block text-sm">স্থান <input className="ainput mt-1" value={bkLocation} onChange={(e) => setBkLocation(e.target.value)} placeholder="Dokploy scheduled backup / S3 bucket…" /></label>
            <label className="block text-sm">নোট <input className="ainput mt-1" value={bkNote} onChange={(e) => setBkNote(e.target.value)} placeholder="Restore drill: …" /></label>
            <button className="abtn-secondary" onClick={async () => {
              try { await apiFetch("/admin/system/backup-info", { method: "PATCH", body: JSON.stringify({ lastBackupAt: bkAt ? new Date(bkAt).toISOString() : null, location: bkLocation, note: bkNote }) }); setMsg("Backup তথ্য সেভ হয়েছে।"); await load(); }
              catch (e) { setMsg(e instanceof Error ? e.message : "ব্যর্থ"); }
            }}>রেকর্ড সেভ করুন</button>
            {backup?.info ? <p className="text-xs text-slate-500">রেকর্ড করেছেন {backup.info.recordedBy} · শেষ Backup: {backup.info.lastBackupAt ? fmtDateTime(backup.info.lastBackupAt) : "—"} · {backup.info.location}</p> : null}
          </div>
        </div>
      </div>

      <div className="acard mt-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="font-semibold">📜 Activity Log (Audit Trail)</span>
          <input className="ainput max-w-xs" placeholder="Action দিয়ে খুঁজুন — যেমন payment" value={logQ} onChange={(e) => setLogQ(e.target.value)} />
        </div>
        <p className="mb-2 text-xs text-slate-500">সার্ভারের Process Log অ্যাপের ভেতর থেকে পড়া যায় না — এখানে দেখানো হচ্ছে সম্পূর্ণ Audit Trail, যেখানে প্রতিটি গুরুত্বপূর্ণ ঘটনা রেকর্ড থাকে।</p>
        <table className="atable">
          <thead><tr><th className="ath">সময়</th><th className="ath">Action</th><th className="ath">Entity</th><th className="ath">Org</th><th className="ath">IP</th></tr></thead>
          <tbody>{logs.map((l, i) => (
            <tr key={i} className="border-t border-slate-800"><td className="atd text-slate-400">{fmtDateTime(l.at)}</td><td className="atd font-medium">{l.action}</td><td className="atd">{l.entityType ?? "—"}</td><td className="atd">{l.organizationId ? l.organizationId.slice(0, 8) + "…" : "platform"}</td><td className="atd">{(l as any).ip ?? "—"}</td></tr>
          ))}</tbody>
        </table>
        {logs.length === 0 ? <p className="p-3 text-sm text-slate-500">কোনো Log নেই।</p> : null}
      </div>
    </AdminShell>
  );
}
