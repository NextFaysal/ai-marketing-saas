"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { DataTable, EmptyState, ErrorState, PageHead, toast } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";

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
      toast(`Nudge পাঠানো হয়েছে — ${out.sent} জনকে ইমেইল গেছে।`);
    } catch (e) { toast(e instanceof Error ? e.message : "Nudge ব্যর্থ", "error"); }
  }
  React.useEffect(() => { load(); }, [load]);
  async function retry(kind: string, id: string) {
    try {
      const out: any = await apiFetch("/admin/health/retry", { method: "POST", body: JSON.stringify({ kind, id }) });
      toast(out.retried ? "Retry চালানো হয়েছে — ফলাফল Job এর অবস্থায় দেখুন।" : (out.message ?? "Retry হয়নি"), out.retried ? "success" : "info");
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : "Retry ব্যর্থ", "error"); }
  }
  // ADX8: traffic-light summary — প্রতিটি আলো শুধু ওই এলাকার ইতিমধ্যে
  // লোড করা ডেটা থেকেই: ভাঙা integration থাকলে লাল, connection
  // board-এ broken থাকলে লাল / atRisk থাকলে হলুদ, ব্যর্থ job থাকলে
  // লাল; ডেটা লোড না হলে সেই এলাকার আলোই নেই (অনুমান নয়)। Connection
  // board-এ শুধু "তথ্য নেই" থাকলে ধূসর — সেটি board-এর নিজের অবস্থা।
  const lights: { id: string; label: string; tone: "red" | "amber" | "green" | "slate"; text: string }[] = [];
  if (ints) lights.push(ints.broken.length > 0
    ? { id: "health-integrations", label: "Integrations", tone: "red", text: `${ints.broken.length}টি ভাঙা` }
    : { id: "health-integrations", label: "Integrations", tone: "green", text: "সব ঠিক আছে" });
  if (jobs) {
    const failed = jobs.failedSyncJobs.length + jobs.errorRuns24h.length;
    lights.push(failed > 0
      ? { id: "health-jobs", label: "Sync / Automation", tone: "red", text: `${failed}টি ব্যর্থ` }
      : { id: "health-jobs", label: "Sync / Automation", tone: "green", text: "কোনো ব্যর্থতা নেই" });
    const errJobs = jobs.scheduledJobs.filter((j) => j.enabled && j.lastStatus === "error").length;
    lights.push(errJobs > 0
      ? { id: "health-scheduled", label: "Scheduled Jobs", tone: "red", text: `${errJobs}টি error অবস্থায়` }
      : { id: "health-scheduled", label: "Scheduled Jobs", tone: "green", text: "কোনো error নেই" });
  }
  if (conns && conns.summary.total > 0) {
    if (conns.summary.broken > 0) lights.push({ id: "health-connections", label: "Connections", tone: "red", text: `${conns.summary.broken}টি ভাঙা` });
    else if (conns.summary.atRisk > 0) lights.push({ id: "health-connections", label: "Connections", tone: "amber", text: `${conns.summary.atRisk}টি ঝুঁকিতে` });
    else if (conns.summary.ok > 0) lights.push({ id: "health-connections", label: "Connections", tone: "green", text: "সব ঠিক আছে" });
    else lights.push({ id: "health-connections", label: "Connections", tone: "slate", text: "শুধু তথ্য নেই" });
  }
  // ADX12: per-card pending slot — the v3 error state (with a
  // retry of the same load) after a completed-but-failed load.
  // ADNX11: the in-flight half is now a real skeleton, not text.
  const pending = (label: string) => loadDone
    ? <ErrorState message={`${label} লোড হয়নি — আবার চেষ্টা করুন।`} onRetry={load} />
    : <div className="space-y-2" aria-label="লোড হচ্ছে"><div className="askel h-4 w-2/3" /><div className="askel h-4 w-1/2" /><div className="askel h-4 w-3/5" /></div>;
  const toneDot = { red: "bg-red-400", amber: "bg-amber-400", green: "bg-emerald-400", slate: "bg-slate-500" } as const;
  const toneText = { red: "text-red-300", amber: "text-amber-300", green: "text-emerald-300", slate: "text-slate-400" } as const;
  return (
    <AdminShell title="💚 Platform Health">
      <PageHead sub="Integration, Job ও Connection-এর স্বাস্থ্য — ট্র্যাফিক-লাইট সারসংক্ষেপ সবার আগে।" />
      {/* ADNX11: the traffic-light card stays the FIRST content
          block, so it lands in the first mobile viewport. */}
      {lights.length > 0 ? (
        <div className="acard mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 !py-3.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">এক নজরে</span>
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
          <div className="mb-2 font-semibold">Integrations (সব Tenant মিলিয়ে)</div>
          {!ints ? pending("Integration তথ্য") : (
            <>
              <ul className="space-y-1 text-sm">{Object.entries(ints.byProvider).map(([p, v]) => <li key={p} className="flex justify-between border-b border-slate-800 pb-1"><span>{p}</span><span>{v.connected}/{v.total} connected</span></li>)}</ul>
              {ints.broken.length > 0 ? <div className="mt-3 text-sm"><div className="mb-1 font-medium text-amber-300">ভাঙা/বিচ্ছিন্ন ({ints.broken.length})</div>{ints.broken.slice(0, 10).map((b) => <div key={b.id} className="rounded bg-slate-800 px-2 py-1.5">{b.provider} · {b.organizationName} · {b.status}</div>)}</div> : <p className="mt-2 text-sm text-emerald-300">সব Integration ঠিক আছে।</p>}
            </>
          )}
        </div>
        <div className="acard" id="health-jobs">
          <div className="mb-2 font-semibold">ব্যর্থ Sync Job (সর্বশেষ ২০টি)</div>
          {!jobs ? pending("Job তথ্য") : jobs.failedSyncJobs.length === 0 ? <p className="text-sm text-emerald-300">কোনো ব্যর্থ Sync নেই।</p> : (
            <ul className="space-y-2 text-sm">{jobs.failedSyncJobs.map((j) => (
              <li key={j.id} className="rounded bg-slate-800 px-3 py-2">
                <div className="flex items-center justify-between"><span>{j.kind} · {fmtDateTime(j.startedAt)}</span><button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => retry("sync_job", j.id)}>↻ Retry</button></div>
                {j.error ? <div className="mt-1 text-xs text-red-300">{j.error}</div> : null}
              </li>
            ))}</ul>
          )}
          <div className="mb-2 mt-5 font-semibold">Automation ত্রুটি (২৪ ঘণ্টা): {jobs?.errorRuns24h.length ?? 0}টি</div>
        </div>
      </div>
      <div className="acard mt-4 overflow-hidden p-0" id="health-connections">
        <div className="border-b border-slate-800 p-4">
          <div className="font-semibold">Connection Health Board (সব Tenant, শেষ {conns?.windowDays ?? 30} দিন)</div>
          <p className="mt-1 text-xs text-slate-400">CC11 Doctor-এর রেকর্ড করা আসল check থেকেই হিসাব (CC22-এর নিয়মে)। যেই connection কখনো check-ই হয়নি, সেটি &quot;তথ্য নেই&quot; — ঠিক আছে বলে ধরা হয় না। Repair/Reconnect এখান থেকে হয় না — ওটা tenant-এর নিজের কাজ।</p>
          {conns ? <p className="mt-2 text-sm">মোট {conns.summary.total} · <span className="text-red-300">ভাঙা {conns.summary.broken}</span> · <span className="text-amber-300">ঝুঁকিতে {conns.summary.atRisk}</span> · <span className="text-emerald-300">ঠিক {conns.summary.ok}</span> · তথ্য নেই {conns.summary.noData}</p> : null}
        </div>
        {!conns ? <div className="p-4">{pending("Connection তথ্য")}</div> : conns.connections.length === 0 ? <div className="p-4"><EmptyState title="কোনো connection-ই নেই।" /></div> : (
            <DataTable>
              <thead className="bg-slate-900"><tr><th className="ath">অবস্থা</th><th className="ath">Connection</th><th className="ath">Org</th><th className="ath">Check (পাস/ব্যর্থ/আংশিক)</th><th className="ath">Uptime</th><th className="ath">শেষ Check</th><th className="ath"></th></tr></thead>
              <tbody>{conns.connections.map((c) => (
                <tr key={`${c.organizationId}-${c.targetType}-${c.targetId}`} className="border-t border-slate-800">
                  <td data-label="অবস্থা" className="atd">{c.boardStatus === "broken" ? <span className="abadge-red">ভাঙা</span> : c.boardStatus === "at_risk" ? <span className="abadge-amber">ঝুঁকিতে</span> : c.boardStatus === "ok" ? <span className="abadge-green">ঠিক আছে</span> : <span className="abadge-slate">তথ্য নেই</span>}{c.expiryBucket ? <div className="mt-1 text-xs text-amber-300">Token মেয়াদ: {c.tokenDaysLeft !== null && c.tokenDaysLeft < 0 ? "শেষ হয়ে গেছে" : `${c.tokenDaysLeft} দিন বাকি`}</div> : null}</td>
                  <td data-label="Connection" className="atd">{c.displayName ?? c.provider ?? c.targetType}<div className="text-xs text-slate-400">{c.provider ?? ""} · {c.targetType}{c.targetStatus === "missing" ? " · (মুছে যাওয়া)" : ""}</div></td>
                  <td data-label="Org" className="atd"><a className="text-indigo-300 underline" href={`/orgs/${c.organizationId}`}>{c.organizationName}</a></td>
                  <td data-label="Check (পাস/ব্যর্থ/আংশিক)" className="atd">{c.checks > 0 ? `${c.checks} (${c.passed}/${c.failed}/${c.degraded})` : "—"}</td>
                  <td data-label="Uptime" className="atd">{c.uptimePct !== null ? `${c.uptimePct}%` : "তথ্য নেই"}</td>
                  <td data-label="শেষ Check" className="atd text-slate-400">{c.lastCheckedAt ? fmtDateTime(c.lastCheckedAt) : "কখনো নয়"}</td>
                  <td className="atd">{c.boardStatus === "broken" ? <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => nudgeConn(c.organizationId)}>📧 Nudge</button> : null}</td>
                </tr>
              ))}</tbody>
            </DataTable>
        )}
      </div>
      <div className="acard mt-4 overflow-hidden p-0" id="health-scheduled">
        <div className="border-b border-slate-800 p-4 font-semibold">Scheduled Jobs (সব Tenant)</div>
        <DataTable empty={(jobs?.scheduledJobs ?? []).length === 0 ? <div className="p-4">{!jobs ? (loadDone ? <ErrorState message="Job তথ্য লোড হয়নি — আবার চেষ্টা করুন।" onRetry={load} /> : <div className="askel-table" />) : <EmptyState title="কোনো Scheduled Job নেই।" />}</div> : null}>
          <thead className="bg-slate-900"><tr><th className="ath">Job</th><th className="ath">ধরন</th><th className="ath">অবস্থা</th><th className="ath">পরের Run</th><th className="ath"></th></tr></thead>
          <tbody>{(jobs?.scheduledJobs ?? []).map((j) => (
            <tr key={j.id} className="border-t border-slate-800">
              <td data-label="Job" className="atd">{j.name}<div className="text-xs text-slate-400">{j.organizationId.slice(0, 8)}…</div></td>
              <td data-label="ধরন" className="atd">{j.type}</td>
              <td data-label="অবস্থা" className="atd">{j.enabled ? (j.lastStatus === "error" ? <span className="abadge-red">error</span> : <span className="abadge-green">{j.lastStatus ?? "enabled"}</span>) : <span className="abadge-slate">disabled</span>}{j.lastError ? <div className="mt-1 max-w-md truncate text-xs text-red-300">{j.lastError}</div> : null}</td>
              <td data-label="পরের Run" className="atd text-slate-400">{fmtDateTime(j.nextRunAt)}</td>
              <td className="atd"><button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => retry("scheduled_job", j.id)}>▶ এখন চালান</button></td>
            </tr>
          ))}</tbody>
        </DataTable>
      </div>
    </AdminShell>
  );
}
