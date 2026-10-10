"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { apiFetch, formatMinorStr } from "@/lib/api";

interface Summary {
  mrrMinor: string; trialingCount: number; perPlan: Record<string, number>;
  overdue: { organizationId: string; organizationName: string; plan: string; status: string; daysOverdue?: number | null }[];
  collectedThisMonthMinor: string; collectedTotalMinor: string; planPricesMinor: Record<string, number>;
}
interface Payment { id: string; organizationId: string; organizationName?: string | null; amountMinor: string; method: string; reference?: string | null; createdAt: string; note?: string | null }
interface OrgRow { id: string; name: string }

const METHODS = ["bkash", "bank", "cash", "card", "other"];

export default function BillingPage() {
  const [sum, setSum] = React.useState<Summary | null>(null);
  const [payments, setPayments] = React.useState<Payment[]>([]);
  const [orgs, setOrgs] = React.useState<OrgRow[]>([]);
  const [msg, setMsg] = React.useState("");
  const [form, setForm] = React.useState({ organizationId: "", amount: "", method: "bkash", reference: "", periodEnd: "" });
  const load = React.useCallback(async () => {
    setSum(await apiFetch<Summary>("/admin/billing/summary").catch(() => null));
    setPayments(await apiFetch<Payment[]>("/admin/payments?take=50").catch(() => []));
    setOrgs(await apiFetch<OrgRow[]>("/admin/orgs?take=100").catch(() => []));
  }, []);
  React.useEffect(() => { load(); }, [load]);

  async function record() {
    const amountTaka = Number(form.amount);
    if (!form.organizationId || !amountTaka || amountTaka <= 0) { setMsg("Organization ও সঠিক পরিমাণ দিন।"); return; }
    try {
      await apiFetch("/admin/payments", { method: "POST", body: JSON.stringify({
        organizationId: form.organizationId, amountMinor: String(Math.round(amountTaka * 100)), method: form.method,
        reference: form.reference || undefined, periodEnd: form.periodEnd || undefined,
      }) });
      setMsg("পেমেন্ট রেকর্ড হয়েছে।");
      setForm({ ...form, amount: "", reference: "" });
      await load();
    } catch (e) { setMsg(e instanceof Error ? e.message : "ব্যর্থ হয়েছে"); }
  }

  return (
    <AdminShell title="💳 SaaS Billing">
      {msg ? <p className="mb-3 rounded-lg bg-indigo-500/10 p-3 text-sm text-indigo-200">{msg}</p> : null}
      {!sum ? <p className="text-slate-400">লোড হচ্ছে…</p> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "MRR (ACTIVE সাবস্ক্রিপশন)", value: `৳ ${formatMinorStr(sum.mrrMinor)}` },
              { label: "এই মাসে সংগ্রহ", value: `৳ ${formatMinorStr(sum.collectedThisMonthMinor)}` },
              { label: "মোট সংগ্রহ (সর্বকাল)", value: `৳ ${formatMinorStr(sum.collectedTotalMinor)}` },
              { label: "Trial চলছে", value: `${sum.trialingCount}টি Org` },
            ].map((c) => (
              <div key={c.label} className="acard"><div className="text-xs uppercase tracking-wide text-slate-400">{c.label}</div><div className="mt-1 text-2xl font-bold">{c.value}</div></div>
            ))}
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="acard">
              <div className="mb-2 font-semibold">Plan অনুযায়ী Org সংখ্যা</div>
              <ul className="space-y-1 text-sm">{Object.entries(sum.perPlan).map(([plan, n]) => <li key={plan} className="flex justify-between border-b border-slate-800 pb-1"><span>{plan} (৳ {formatMinorStr(sum.planPricesMinor[plan] ?? 0)}/মাস)</span><span>{n}টি</span></li>)}</ul>
              <div className="mb-2 mt-5 font-semibold text-amber-300">⚠ মেয়াদ শেষ / Past Due ({sum.overdue.length})</div>
              {sum.overdue.length === 0 ? <p className="text-sm text-emerald-300">কেউ overdue নয়।</p> : (
                <ul className="space-y-1.5 text-sm">{sum.overdue.map((o) => (
                  <li key={o.organizationId} className="flex items-center justify-between rounded bg-slate-800 px-3 py-2">
                    <a className="text-indigo-300 hover:underline" href={`/orgs/${o.organizationId}`}>{o.organizationName}</a>
                    <span>{o.plan} · {o.status}{o.daysOverdue != null ? ` · ${o.daysOverdue} দিন পার` : ""}</span>
                  </li>
                ))}</ul>
              )}
              <p className="mt-2 text-xs text-slate-500">মেয়াদ শেষ হলে Subscription স্বয়ংক্রিয়ভাবে PAST_DUE হয় (subscription_sweep Job) — কিন্তু কোনো Org স্বয়ংক্রিয়ভাবে Suspend হয় না; সেটা Admin এর সিদ্ধান্ত।</p>
            </div>
            <div className="acard space-y-3">
              <div className="font-semibold">💰 Manual পেমেন্ট রেকর্ড করুন (bKash/Bank/Cash)</div>
              <label className="block text-sm">Organization
                <select className="ainput mt-1" value={form.organizationId} onChange={(e) => setForm({ ...form, organizationId: e.target.value })}>
                  <option value="">— বেছে নিন —</option>
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-sm">পরিমাণ (টাকা)
                  <input className="ainput mt-1" type="number" min={0} step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
                <label className="block text-sm">মাধ্যম
                  <select className="ainput mt-1" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>{METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-sm">রেফারেন্স (TrxID ইত্যাদি)
                  <input className="ainput mt-1" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></label>
                <label className="block text-sm">মেয়াদ শেষ (এই পেমেন্টে)
                  <input className="ainput mt-1" type="date" value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} /></label>
              </div>
              <button className="abtn" onClick={record}>রেকর্ড করুন</button>
              <p className="text-xs text-slate-500">পেমেন্ট রেকর্ড করলে Subscription এর মেয়াদ নিজে বদলায় না — Org পেজ থেকে Plan/মেয়াদ আপডেট করুন।</p>
            </div>
          </div>
          <div className="acard mt-4 overflow-hidden p-0">
            <div className="border-b border-slate-800 p-4 font-semibold">সাম্প্রতিক পেমেন্ট</div>
            <table className="atable">
              <thead className="bg-slate-900"><tr><th className="ath">তারিখ</th><th className="ath">Organization</th><th className="ath">পরিমাণ</th><th className="ath">মাধ্যম</th><th className="ath">রেফারেন্স</th><th className="ath"></th></tr></thead>
              <tbody>{payments.map((p) => (
                <tr key={p.id} className="border-t border-slate-800">
                  <td className="atd text-slate-400">{new Date(p.createdAt).toLocaleString("bn-BD")}</td>
                  <td className="atd">{p.organizationName ?? p.organizationId}</td>
                  <td className="atd">৳ {formatMinorStr(p.amountMinor)}</td>
                  <td className="atd">{p.method}</td>
                  <td className="atd text-slate-400">{p.reference ?? "—"}</td>
                  <td className="atd"><button className="abtn-danger !px-2 !py-1 text-xs" onClick={async () => {
                    const reason = window.prompt("পেমেন্ট মুছে ফেলার কারণ (Audit এ Snapshot থাকবে):");
                    if (!reason || reason.trim().length < 3) return;
                    try { await apiFetch(`/admin/payments/${p.id}`, { method: "DELETE", body: JSON.stringify({ reason }) }); setMsg("পেমেন্ট মোছা হয়েছে (Snapshot Audit এ আছে)।"); await load(); }
                    catch (e) { setMsg(e instanceof Error ? e.message : "ব্যর্থ"); }
                  }}>মুছুন</button></td>
                </tr>
              ))}</tbody>
            </table>
            {payments.length === 0 ? <p className="p-4 text-sm text-slate-500">এখনো কোনো পেমেন্ট রেকর্ড হয়নি।</p> : null}
          </div>
        </>
      )}
    </AdminShell>
  );
}
