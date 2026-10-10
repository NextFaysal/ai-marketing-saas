"use client";

import React from "react";
import AdminShell from "@/components/AdminShell";
import { apiFetch } from "@/lib/api";

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
}
interface Errors { windowHours: number; totalErrors: number; sources: { source: string; count: number; latest: { title: string; detail: string | null; at: string }[] }[] }
interface Growth { source: string; tables: { table: string; approxRows: number; bytes: number | null }[]; totalBytes: number | null }
interface LogRow { at: string; action: string; userId: string | null; organizationId: string | null; entityType: string | null }
interface BackupPanel { info: { lastBackupAt: string | null; location: string; note: string; recordedBy: string } | null; manifest: { at: string; totalRows: number; tables: Record<string, number>; verifiedBy: string } | null }

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
  const [version, setVersion] = React.useState<Version | null>(null);
  const [queues, setQueues] = React.useState<Queues | null>(null);
  const [errors, setErrors] = React.useState<Errors | null>(null);
  const [growth, setGrowth] = React.useState<Growth | null>(null);
  const [backup, setBackup] = React.useState<BackupPanel | null>(null);
  const [logs, setLogs] = React.useState<LogRow[]>([]);
  const [logQ, setLogQ] = React.useState("");
  const [msg, setMsg] = React.useState("");
  const [bkLocation, setBkLocation] = React.useState("");
  const [bkNote, setBkNote] = React.useState("");
  const [bkAt, setBkAt] = React.useState("");

  const load = React.useCallback(async () => {
    setVersion(await apiFetch<Version>("/admin/system/version").catch(() => null));
    setQueues(await apiFetch<Queues>("/admin/system/queues").catch(() => null));
    setErrors(await apiFetch<Errors>("/admin/system/errors").catch(() => null));
    setGrowth(await apiFetch<Growth>("/admin/system/db-growth").catch(() => null));
    const bk = await apiFetch<BackupPanel>("/admin/system/backup").catch(() => null);
    setBackup(bk);
    if (bk?.info) { setBkLocation(bk.info.location); setBkNote(bk.info.note); setBkAt(bk.info.lastBackupAt ? String(bk.info.lastBackupAt).slice(0, 16) : ""); }
  }, []);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    apiFetch<LogRow[]>(`/admin/system/logs?take=60${logQ ? `&q=${encodeURIComponent(logQ)}` : ""}`).then(setLogs).catch(() => setLogs([]));
  }, [logQ]);

  return (
    <AdminShell title="🖥 System & Reliability">
      {msg ? <p className="mb-3 rounded-lg bg-indigo-500/10 p-3 text-sm text-indigo-200">{msg}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="acard space-y-2">
          <div className="font-semibold">🚀 Version ও Deploy</div>
          {!version ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : (
            <div className="space-y-1 text-sm">
              <div>Version: <b>{version.appVersion}</b> · Git: <b>{version.gitSha ? version.gitSha.slice(0, 10) : "সেট নেই (GIT_SHA env)"}</b></div>
              <div>Node: {version.nodeVersion} · পরিবেশ: {version.environment}</div>
              <div>চালু আছে: {fmtUptime(version.uptimeSeconds)} (Boot {new Date(version.bootTime).toLocaleString("bn-BD")})</div>
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
            </div>
          )}
        </div>
      </div>

      <div className="acard mt-4">
        <div className="mb-2 font-semibold">🔥 Error Summary (শেষ {errors?.windowHours ?? 24} ঘণ্টা) — মোট {errors?.totalErrors ?? "…"}</div>
        {!errors ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {errors.sources.map((s) => (
              <div key={s.source} className="rounded-xl border border-slate-800 p-3">
                <div className="flex items-center justify-between"><b className="text-sm">{s.source}</b><span className={s.count > 0 ? "abadge-red" : "abadge-green"}>{s.count}</span></div>
                {s.latest.map((e, i) => <div key={i} className="mt-1.5 text-xs text-slate-400">{e.title} — {e.detail ?? ""} <span className="text-slate-600">{new Date(e.at).toLocaleString("bn-BD")}</span></div>)}
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
              ✅ সর্বশেষ যাচাই {new Date(backup.manifest.at).toLocaleString("bn-BD")} — মোট <b>{backup.manifest.totalRows.toLocaleString()}</b> Row, {Object.keys(backup.manifest.tables).length} টি Core Table · যাচাই করেছেন {backup.manifest.verifiedBy}
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
            {backup?.info ? <p className="text-xs text-slate-500">রেকর্ড করেছেন {backup.info.recordedBy} · শেষ Backup: {backup.info.lastBackupAt ? new Date(backup.info.lastBackupAt).toLocaleString("bn-BD") : "—"} · {backup.info.location}</p> : null}
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
            <tr key={i} className="border-t border-slate-800"><td className="atd text-slate-400">{new Date(l.at).toLocaleString("bn-BD")}</td><td className="atd font-medium">{l.action}</td><td className="atd">{l.entityType ?? "—"}</td><td className="atd">{l.organizationId ? l.organizationId.slice(0, 8) + "…" : "platform"}</td><td className="atd">{(l as any).ip ?? "—"}</td></tr>
          ))}</tbody>
        </table>
        {logs.length === 0 ? <p className="p-3 text-sm text-slate-500">কোনো Log নেই।</p> : null}
      </div>
    </AdminShell>
  );
}
