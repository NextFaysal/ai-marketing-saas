"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { API_URL, apiFetch, getAdminToken } from "@/lib/api";
import { EmptyState, ErrorState, SortableTh, type SortDir } from "@/components/ui";

interface Row { organizationId: string; name: string; status: string; aiCalls30d: number; aiTokens30d: number; deliveries30d: number; broadcastsTotal: number; workflowRuns30d: number; courierShipmentsTotal: number; orders30d: number; storageBytes: number; mediaAssets: number }

function formatBytes(n: number): string {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default function UsagePage() {
  const [rows, setRows] = React.useState<Row[]>([]);
  // ADX12: loading + load-error states for the ranking table —
  // before, load-in-flight and load-failed both read as
  // "কোনো Organization নেই"।
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");
  const load = React.useCallback(async () => {
    setLoading(true); setLoadError("");
    try { setRows(await apiFetch<Row[]>("/admin/usage")); }
    catch (e) { setLoadError(e instanceof Error ? e.message : "Usage লোড ব্যর্থ হয়েছে"); }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { load(); }, [load]);
  // ADX11: per-org ranking — sortable by every numeric column,
  // client-side over the loaded rows only (default = server order).
  // Money verdict: neither this payload nor the ai-detail payload
  // carries a cost field, so this table ranks USAGE, not cost; the
  // money view stays on Analytics' operator-rate AI-cost board.
  const [sortKey, setSortKey] = React.useState("");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");
  const onSort = (k: string) => {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };
  const shown = React.useMemo(() => {
    if (!sortKey) return rows;
    const f = (r: Row) => Number((r as unknown as Record<string, unknown>)[sortKey] ?? 0);
    return [...rows].sort((a, b) => (sortDir === "asc" ? f(a) - f(b) : f(b) - f(a)));
  }, [rows, sortKey, sortDir]);
  const th = (label: string, key: string) => <SortableTh label={label} sortKey={key} current={sortKey} dir={sortDir} onSort={onSort} />;
  return (
    <AdminShell title="📈 Usage & Cost (শেষ ৩০ দিন)">
      <p className="mb-3 text-sm text-slate-400">Org অনুযায়ী ব্যবহারের Ranking — যেকোনো সংখ্যার Header-এ ক্লিক করে বেশি→কম / কম→বেশি সাজান (সাজানো এই পেজে লোড করা Row-র ওপরেই)।</p>
      <div className="acard overflow-hidden p-0">
        <table className="atable atable-sticky">
          <thead className="bg-slate-900"><tr><th className="ath">Organization</th>{th("AI কল", "aiCalls30d")}{th("AI টোকেন", "aiTokens30d")}{th("Message Delivery", "deliveries30d")}{th("Broadcast", "broadcastsTotal")}{th("Workflow Run", "workflowRuns30d")}{th("Courier", "courierShipmentsTotal")}{th("Order", "orders30d")}{th("Storage", "storageBytes")}</tr></thead>
          <tbody>{shown.map((r) => (
            <tr key={r.organizationId} className="border-t border-slate-800">
              <td className="atd"><a className="text-indigo-300 hover:underline" href={`/orgs/${r.organizationId}`}>{r.name}</a>{r.status !== "ACTIVE" ? <span className="abadge-amber ml-2">{r.status}</span> : null}</td>
              <td className="atd">{r.aiCalls30d}</td><td className="atd">{r.aiTokens30d.toLocaleString()}</td>
              <td className="atd">{r.deliveries30d}</td><td className="atd">{r.broadcastsTotal}</td>
              <td className="atd">{r.workflowRuns30d}</td><td className="atd">{r.courierShipmentsTotal}</td><td className="atd">{r.orders30d}</td>
              <td className="atd">{formatBytes(r.storageBytes ?? 0)}<span className="block text-xs text-slate-500">{r.mediaAssets ?? 0}টি ফাইল</span></td>
            </tr>
          ))}</tbody>
        </table>
        {loading && rows.length === 0 ? <div className="askel-table m-4" /> : null}
        {!loading && loadError ? <div className="p-4"><ErrorState message={`Usage লোড হয়নি: ${loadError}`} onRetry={load} /></div> : null}
        {!loading && !loadError && rows.length === 0 ? <EmptyState title="কোনো Organization নেই।" sub="Organization তৈরি হলে তাদের ব্যবহার এখানে Ranking আকারে দেখা যাবে।" /> : null}
      </div>
      <p className="mt-3 text-xs text-slate-500">AI খরচ টাকায় দেখানো হয়নি — প্রোভাইডার অনুযায়ী টোকেনের দাম বদলায়; এখানে শুধু প্রকৃত ব্যবহার (কল ও টোকেন) দেখানো হচ্ছে।</p>
      <AiFeatureSection />
    </AdminShell>
  );
}

interface AiRow { organizationId: string; orgName: string; feature: string; calls: number; inputTokens: number; outputTokens: number; totalTokens: number; estimatedCalls: number }

/** AA7: AI usage drill-down — one row per organization x feature.
 * Tokens/calls only (money lives on the Analytics AI-cost board).
 * The org filter narrows the loaded rows client-side; if it is an
 * exact organizationId, the CSV export is scoped to that org too. */
function AiFeatureSection() {
  const [days, setDays] = React.useState(30);
  const [rows, setRows] = React.useState<AiRow[]>([]);
  const [filter, setFilter] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async (d: number) => {
    setLoading(true);
    const out = await apiFetch<{ days: number; rows: AiRow[] }>(`/admin/usage/ai-detail?days=${d}`).catch(() => null);
    setRows(out?.rows ?? []);
    setLoading(false);
  }, []);
  React.useEffect(() => { load(days); }, [days, load]);

  const f = filter.trim().toLowerCase();
  const filtered = f ? rows.filter((r) => r.orgName.toLowerCase().includes(f) || r.organizationId.toLowerCase().includes(f)) : rows;
  const [sortKey, setSortKey] = React.useState("");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");
  const onSort = (k: string) => {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };
  const shown = React.useMemo(() => {
    if (!sortKey) return filtered;
    const g = (r: AiRow) => Number((r as unknown as Record<string, unknown>)[sortKey] ?? 0);
    return [...filtered].sort((a, b) => (sortDir === "asc" ? g(a) - g(b) : g(b) - g(a)));
  }, [filtered, sortKey, sortDir]);
  const th = (label: string, key: string) => <SortableTh label={label} sortKey={key} current={sortKey} dir={sortDir} onSort={onSort} />;

  async function downloadCsv() {
    const token = getAdminToken();
    const exact = rows.find((r) => r.organizationId === filter.trim());
    const qs = `days=${days}${exact ? `&organizationId=${encodeURIComponent(exact.organizationId)}` : ""}`;
    const res = await fetch(`${API_URL}/admin/usage/ai-detail/export.csv?${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).catch(() => null);
    if (!res || !res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "ai-usage-by-feature.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mt-6">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold">🤖 AI by Feature (Org × Feature)</h2>
        <select className="ainput !w-auto px-2 py-1 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>শেষ ৭ দিন</option>
          <option value={30}>শেষ ৩০ দিন</option>
          <option value={90}>শেষ ৯০ দিন</option>
        </select>
        <input className="ainput px-2 py-1 text-sm sm:!w-64" placeholder="Org নাম বা ID দিয়ে ফিল্টার" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="abtn-secondary !px-3 !py-1.5 text-xs" onClick={downloadCsv}>⬇ CSV Export</button>
        {loading ? <span className="text-xs text-slate-500">লোড হচ্ছে…</span> : null}
      </div>
      <div className="acard overflow-hidden p-0">
        <table className="atable">
          <thead className="bg-slate-900"><tr><th className="ath">Organization</th><th className="ath">Feature</th>{th("কল", "calls")}{th("Input টোকেন", "inputTokens")}{th("Output টোকেন", "outputTokens")}{th("মোট টোকেন", "totalTokens")}{th("Estimated কল", "estimatedCalls")}</tr></thead>
          <tbody>{shown.map((r) => (
            <tr key={`${r.organizationId}|${r.feature}`} className="border-t border-slate-800">
              <td className="atd"><a className="text-indigo-300 hover:underline" href={`/orgs/${r.organizationId}`}>{r.orgName}</a></td>
              <td className="atd">{r.feature}</td>
              <td className="atd">{r.calls.toLocaleString()}</td>
              <td className="atd">{r.inputTokens.toLocaleString()}</td>
              <td className="atd">{r.outputTokens.toLocaleString()}</td>
              <td className="atd">{r.totalTokens.toLocaleString()}</td>
              <td className="atd">{r.estimatedCalls > 0 ? <span className="abadge-amber">{r.estimatedCalls.toLocaleString()}</span> : 0}</td>
            </tr>
          ))}</tbody>
        </table>
        {shown.length === 0 ? <p className="p-4 text-sm text-slate-500">এই সময়সীমায় কোনো AI ব্যবহারের রেকর্ড নেই।</p> : null}
      </div>
      <p className="mt-3 text-xs text-slate-500">এখানে শুধু কল ও টোকেন — টাকার হিসাব Analytics পেজের AI Cost বোর্ডে (Operator-এর সেট করা Rate দিয়ে)। Estimated কল মানে ওই কলগুলোর টোকেন সংখ্যা Dev Adapter-এর আনুমানিক হিসাব — আসল Provider-এর মাপা সংখ্যা নয়, তাই আলাদা করে দেখানো হয়েছে।</p>
    </div>
  );
}
