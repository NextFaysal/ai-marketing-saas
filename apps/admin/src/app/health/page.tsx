"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { apiFetch } from "@/lib/api";

interface HealthJobs {
  failedSyncJobs: { id: string; kind: string; error?: string | null; startedAt: string }[];
  errorRuns24h: { id: string; status: string; createdAt: string }[];
  scheduledJobs: { id: string; name: string; type: string; organizationId: string; enabled: boolean; lastStatus?: string | null; lastError?: string | null; nextRunAt: string }[];
}
interface HealthInt { byProvider: Record<string, { total: number; connected: number }>; broken: { id: string; provider: string; status: string; organizationName: string }[] }

export default function HealthPage() {
  const [jobs, setJobs] = React.useState<HealthJobs | null>(null);
  const [ints, setInts] = React.useState<HealthInt | null>(null);
  const [msg, setMsg] = React.useState("");
  const load = React.useCallback(async () => {
    setJobs(await apiFetch<HealthJobs>("/admin/health/jobs").catch(() => null));
    setInts(await apiFetch<HealthInt>("/admin/health/integrations").catch(() => null));
  }, []);
  React.useEffect(() => { load(); }, [load]);
  async function retry(kind: string, id: string) {
    try {
      const out: any = await apiFetch("/admin/health/retry", { method: "POST", body: JSON.stringify({ kind, id }) });
      setMsg(out.retried ? "Retry চালানো হয়েছে — ফলাফল Job এর অবস্থায় দেখুন।" : (out.message ?? "Retry হয়নি"));
      await load();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Retry ব্যর্থ"); }
  }
  return (
    <AdminShell title="💚 Platform Health">
      {msg ? <p className="mb-3 rounded-lg bg-indigo-500/10 p-3 text-sm text-indigo-200">{msg}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="acard">
          <div className="mb-2 font-semibold">Integrations (সব Tenant মিলিয়ে)</div>
          {!ints ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : (
            <>
              <ul className="space-y-1 text-sm">{Object.entries(ints.byProvider).map(([p, v]) => <li key={p} className="flex justify-between border-b border-slate-800 pb-1"><span>{p}</span><span>{v.connected}/{v.total} connected</span></li>)}</ul>
              {ints.broken.length > 0 ? <div className="mt-3 text-sm"><div className="mb-1 font-medium text-amber-300">ভাঙা/বিচ্ছিন্ন ({ints.broken.length})</div>{ints.broken.slice(0, 10).map((b) => <div key={b.id} className="rounded bg-slate-800 px-2 py-1.5">{b.provider} · {b.organizationName} · {b.status}</div>)}</div> : <p className="mt-2 text-sm text-emerald-300">সব Integration ঠিক আছে।</p>}
            </>
          )}
        </div>
        <div className="acard">
          <div className="mb-2 font-semibold">ব্যর্থ Sync Job (সর্বশেষ ২০টি)</div>
          {!jobs ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : jobs.failedSyncJobs.length === 0 ? <p className="text-sm text-emerald-300">কোনো ব্যর্থ Sync নেই।</p> : (
            <ul className="space-y-2 text-sm">{jobs.failedSyncJobs.map((j) => (
              <li key={j.id} className="rounded bg-slate-800 px-3 py-2">
                <div className="flex items-center justify-between"><span>{j.kind} · {new Date(j.startedAt).toLocaleString("bn-BD")}</span><button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => retry("sync_job", j.id)}>↻ Retry</button></div>
                {j.error ? <div className="mt-1 text-xs text-red-300">{j.error}</div> : null}
              </li>
            ))}</ul>
          )}
          <div className="mb-2 mt-5 font-semibold">Automation ত্রুটি (২৪ ঘণ্টা): {jobs?.errorRuns24h.length ?? 0}টি</div>
        </div>
      </div>
      <div className="acard mt-4 overflow-hidden p-0">
        <div className="border-b border-slate-800 p-4 font-semibold">Scheduled Jobs (সব Tenant)</div>
        <table className="w-full">
          <thead className="bg-slate-900"><tr><th className="ath">Job</th><th className="ath">ধরন</th><th className="ath">অবস্থা</th><th className="ath">পরের Run</th><th className="ath"></th></tr></thead>
          <tbody>{(jobs?.scheduledJobs ?? []).map((j) => (
            <tr key={j.id} className="border-t border-slate-800">
              <td className="atd">{j.name}<div className="text-xs text-slate-500">{j.organizationId.slice(0, 8)}…</div></td>
              <td className="atd">{j.type}</td>
              <td className="atd">{j.enabled ? (j.lastStatus === "error" ? <span className="abadge-red">error</span> : <span className="abadge-green">{j.lastStatus ?? "enabled"}</span>) : <span className="abadge-slate">disabled</span>}{j.lastError ? <div className="mt-1 max-w-md truncate text-xs text-red-300">{j.lastError}</div> : null}</td>
              <td className="atd text-slate-400">{new Date(j.nextRunAt).toLocaleString("bn-BD")}</td>
              <td className="atd"><button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => retry("scheduled_job", j.id)}>▶ এখন চালান</button></td>
            </tr>
          ))}</tbody>
        </table>
        {(jobs?.scheduledJobs ?? []).length === 0 ? <p className="p-4 text-sm text-slate-500">কোনো Scheduled Job নেই।</p> : null}
      </div>
    </AdminShell>
  );
}
