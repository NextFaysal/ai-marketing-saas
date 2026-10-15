"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { EmptyState, ErrorState, Tabs, askConfirm, askInput } from "@/components/ui";
import { API_URL, apiFetch, formatMinorStr, getAdminToken } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";

interface Summary {
  mrrMinor: string; trialingCount: number; perPlan: Record<string, number>;
  overdue: { organizationId: string; organizationName: string; plan: string; status: string; daysOverdue?: number | null }[];
  collectedThisMonthMinor: string; collectedTotalMinor: string; planPricesMinor: Record<string, number>;
}
interface Payment { id: string; organizationId: string; organizationName?: string | null; amountMinor: string; refundedMinor?: string; netMinor?: string; method: string; reference?: string | null; createdAt: string; note?: string | null }
interface Checkout { id: string; organizationName?: string | null; plan: string; gateway: string; tranId: string; status: string; amountMinor: string; discountMinor: string; creditAppliedMinor: string; couponCode?: string | null; createdAt: string; stuck: boolean }
interface Coupon { id: string; code: string; kind: string; value: number; planScope?: string | null; expiresAt?: string | null; maxRedemptions?: number | null; redeemedCount: number; active: boolean }
interface DunningRow { organizationId: string; organizationName: string; plan: string; daysOverdue?: number | null; dunningStagesSent: number[]; lastDunningAt?: string | null; reminderJobConfigured?: boolean }
interface OrgRow { id: string; name: string }

const METHODS = ["bkash", "bank", "cash", "card", "other"];

/** ADX7 tabs — regrouping only, every card below already existed:
 *  Subscriptions = per-plan counts + overdue + coupons,
 *  Invoices ও Manual Payment = manual form + payments + checkouts,
 *  Dunning = PAST_DUE reminders. */
const TABS = [
  { id: "subs", label: "Subscriptions" },
  { id: "invoices", label: "Invoices ও Manual Payment" },
  { id: "dunning", label: "Dunning" },
];

export default function BillingPage() {
  const [sum, setSum] = React.useState<Summary | null>(null);
  const [payments, setPayments] = React.useState<Payment[]>([]);
  const [orgs, setOrgs] = React.useState<OrgRow[]>([]);
  const [checkouts, setCheckouts] = React.useState<Checkout[]>([]);
  const [coupons, setCoupons] = React.useState<Coupon[]>([]);
  const [dunning, setDunning] = React.useState<DunningRow[]>([]);
  const [msg, setMsg] = React.useState("");
  const [tab, setTab] = React.useState("subs");
  const [form, setForm] = React.useState({ organizationId: "", amount: "", method: "bkash", reference: "", periodEnd: "" });
  // ADX12: a failed summary fetch used to leave the page on
  // "লোড হচ্ছে…" forever; it now gets an error state + retry.
  const [loadFailed, setLoadFailed] = React.useState(false);
  const load = React.useCallback(async () => {
    setLoadFailed(false);
    const summary = await apiFetch<Summary>("/admin/billing/summary").catch(() => null);
    setLoadFailed(summary === null);
    setSum(summary);
    setPayments(await apiFetch<Payment[]>("/admin/payments?take=50").catch(() => []));
    setOrgs(await apiFetch<OrgRow[]>("/admin/orgs?take=100").catch(() => []));
    setCheckouts(await apiFetch<Checkout[]>("/admin/billing/checkouts?take=50").catch(() => []));
    setCoupons(await apiFetch<Coupon[]>("/admin/coupons").catch(() => []));
    setDunning(await apiFetch<DunningRow[]>("/admin/billing/dunning").catch(() => []));
  }, []);
  React.useEffect(() => { load(); }, [load]);

  async function openAuthed(path: string, filename?: string) {
    const token = getAdminToken();
    const res = await fetch(`${API_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) { setMsg(`খুলতে ব্যর্থ: ${res.status}`); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    if (filename) {
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } else {
      window.open(url, "_blank");
    }
  }

  async function refund(p: Payment) {
    const remaining = formatMinorStr(p.netMinor ?? p.amountMinor);
    const amountStr = await askInput({ title: "Refund পরিমাণ (টাকা)", description: `খালি রাখলে পুরো বাকি অংশ (৳ ${remaining}) ফেরত হবে:`, inputLabel: "পরিমাণ (টাকা)", inputOptional: true, confirmLabel: "এগিয়ে যান" });
    if (amountStr === null) return;
    const reason = await askInput({ title: "Refund এর কারণ (Audit এ থাকবে):", inputLabel: "কারণ", inputRequired: true, confirmLabel: "এগিয়ে যান" });
    if (!reason) return;
    const revoke = await askConfirm({ title: "সাবস্ক্রিপশনের Access বন্ধ করবেন?", description: "“Access বন্ধ করুন” = সাবস্ক্রিপশন PAST_DUE হবে; “শুধু ফেরত” = শুধু টাকা ফেরতের রেকর্ড (Refund এগিয়ে যাবে)।", confirmLabel: "Access বন্ধ করুন", cancelLabel: "শুধু ফেরত", danger: true });
    try {
      const taka = amountStr.trim() ? Number(amountStr) : null;
      const out = await apiFetch<any>(`/admin/payments/${p.id}/refund`, {
        method: "POST",
        body: JSON.stringify({ amountMinor: taka != null && Number.isFinite(taka) ? String(Math.round(taka * 100)) : undefined, reason, revokeAccess: revoke }),
      });
      setMsg(`Refund রেকর্ড হয়েছে: ৳ ${formatMinorStr(out.refundedMinor)} মোট ফেরত।${out.accessRevoked ? " সাবস্ক্রিপশন PAST_DUE করা হয়েছে।" : ""}`);
      await load();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Refund ব্যর্থ"); }
  }

  async function reconcile(c: Checkout) {
    try {
      const out = await apiFetch<any>(`/admin/billing/checkouts/${c.id}/reconcile`, { method: "POST", body: "{}" });
      setMsg(out.ok ? (out.alreadyProcessed ? "ইতিমধ্যে সম্পন্ন ছিল।" : "✅ Gateway নিশ্চিত করেছে — সাবস্ক্রিপশন সক্রিয় হয়েছে।")
        : `Gateway এখনো নিশ্চিত করেনি: ${out.reason ?? out.gatewayStatus ?? "অজানা"}`);
      await load();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Reconcile ব্যর্থ"); }
  }

  async function createCoupon() {
    const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";
    const kind = val("cp-kind");
    const rawValue = Number(val("cp-value"));
    if (!val("cp-code") || !rawValue) { setMsg("Coupon কোড ও মান দিন।"); return; }
    try {
      await apiFetch("/admin/coupons", {
        method: "POST",
        body: JSON.stringify({
          code: val("cp-code"), kind,
          value: kind === "fixed" ? Math.round(rawValue * 100) : Math.round(rawValue),
          planScope: val("cp-plan") || undefined,
          expiresAt: val("cp-exp") || undefined,
          maxRedemptions: val("cp-max") ? Number(val("cp-max")) : undefined,
        }),
      });
      setMsg("Coupon তৈরি হয়েছে।");
      await load();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Coupon তৈরি ব্যর্থ"); }
  }

  async function toggleCoupon(c: Coupon) {
    const reason = await askInput({ title: c.active ? "Coupon নিষ্ক্রিয় করার কারণ:" : "Coupon আবার চালু করার কারণ:", inputLabel: "কারণ", inputRequired: true, confirmLabel: "এগিয়ে যান" });
    if (!reason) return;
    try {
      await apiFetch(`/admin/coupons/${c.id}/status`, { method: "POST", body: JSON.stringify({ active: !c.active, reason }) });
      setMsg("Coupon অবস্থা বদলেছে।");
      await load();
    } catch (e) { setMsg(e instanceof Error ? e.message : "ব্যর্থ"); }
  }

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

  const planOverdueCard = sum ? (
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
  ) : null;

  const couponCard = (
    <div className="acard">
      <div className="mb-3 font-semibold">🎟 Coupon</div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm">কোড<input id="cp-code" className="ainput mt-1" placeholder="যেমন: LAUNCH20" /></label>
        <label className="block text-sm">ধরন
          <select id="cp-kind" className="ainput mt-1"><option value="percent">Percent (%)</option><option value="fixed">Fixed (টাকা)</option></select></label>
        <label className="block text-sm">মান (% অথবা টাকা)<input id="cp-value" type="number" min="0" step="any" className="ainput mt-1" /></label>
        <label className="block text-sm">প্ল্যান (খালি = সব)<input id="cp-plan" className="ainput mt-1" placeholder="STARTER / GROWTH / AGENCY" /></label>
        <label className="block text-sm">মেয়াদ শেষ (ঐচ্ছিক)<input id="cp-exp" type="date" className="ainput mt-1" /></label>
        <label className="block text-sm">সর্বোচ্চ ব্যবহার (ঐচ্ছিক)<input id="cp-max" type="number" min="1" className="ainput mt-1" /></label>
      </div>
      <button className="abtn mt-3" onClick={createCoupon}>Coupon তৈরি করুন</button>
      {coupons.length === 0 ? <div className="mt-3"><EmptyState title="কোনো Coupon নেই।" sub="উপরে প্রথম Coupon তৈরি করুন।" /></div> : null}
      {coupons.length > 0 ? (
        <ul className="mt-3 space-y-1.5 text-sm">
          {coupons.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-slate-800 px-3 py-2">
              <span><strong>{c.code}</strong> · {c.kind === "percent" ? `${c.value}%` : `৳ ${formatMinorStr(c.value)}`}{c.planScope ? ` · ${c.planScope}` : ""} · ব্যবহৃত {c.redeemedCount}{c.maxRedemptions ? `/${c.maxRedemptions}` : ""} বার</span>
              <span className="flex items-center gap-2">
                {c.active ? <span className="abadge-green">সক্রিয়</span> : <span className="abadge-red">নিষ্ক্রিয়</span>}
                <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => toggleCoupon(c)}>{c.active ? "নিষ্ক্রিয় করুন" : "চালু করুন"}</button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );

  const manualCard = (
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
  );

  const paymentsCard = (
    <div className="acard mt-4 overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-slate-800 p-4">
        <span className="font-semibold">সাম্প্রতিক পেমেন্ট</span>
        <button className="abtn-secondary !px-3 !py-1.5 text-xs" onClick={() => openAuthed("/admin/billing/export.csv", "payments-export.csv")}>⬇ CSV Export (হিসাবের জন্য)</button>
      </div>
      <table className="atable atable-cards atable-v3">
        <thead className="bg-slate-900"><tr><th className="ath">তারিখ</th><th className="ath">Organization</th><th className="ath">পরিমাণ (নিট)</th><th className="ath">মাধ্যম</th><th className="ath">রেফারেন্স</th><th className="ath"></th></tr></thead>
        <tbody>{payments.map((p) => (
          <tr key={p.id} className="border-t border-slate-800">
            <td data-label="তারিখ" className="atd text-slate-400">{fmtDateTime(p.createdAt)}</td>
            <td data-label="Organization" className="atd">{p.organizationName ?? p.organizationId}</td>
            <td data-label="পরিমাণ (নিট)" className="atd">৳ {formatMinorStr(p.netMinor ?? p.amountMinor)}
              {p.refundedMinor && p.refundedMinor !== "0" ? <div className="text-xs text-amber-300">ফেরত ৳ {formatMinorStr(p.refundedMinor)} (মোট ৳ {formatMinorStr(p.amountMinor)})</div> : null}
            </td>
            <td data-label="মাধ্যম" className="atd">{p.method}</td>
            <td data-label="রেফারেন্স" className="atd text-slate-400">{p.reference ?? "—"}</td>
            <td className="atd">
              <div className="flex flex-wrap gap-1.5">
                <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => openAuthed(`/admin/payments/${p.id}/invoice`)}>🧾 Invoice</button>
                <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={async () => {
                  try { const out = await apiFetch<any>(`/admin/payments/${p.id}/invoice-email`, { method: "POST", body: "{}" }); setMsg(`Invoice ইমেইল পাঠানো হয়েছে (${out.sent} জনকে)।`); }
                  catch (e) { setMsg(e instanceof Error ? e.message : "ইমেইল ব্যর্থ"); }
                }}>✉ পাঠান</button>
                <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => refund(p)}>↩ Refund</button>
                <button className="abtn-danger !px-2 !py-1 text-xs" onClick={async () => {
                  const reason = await askInput({ title: "পেমেন্ট মুছে ফেলার কারণ (Audit এ Snapshot থাকবে):", inputLabel: "কারণ", inputRequired: true, confirmLabel: "এগিয়ে যান" });
                  if (!reason) return;
                  try { await apiFetch(`/admin/payments/${p.id}`, { method: "DELETE", body: JSON.stringify({ reason }) }); setMsg("পেমেন্ট মোছা হয়েছে (Snapshot Audit এ আছে)।"); await load(); }
                  catch (e) { setMsg(e instanceof Error ? e.message : "ব্যর্থ"); }
                }}>মুছুন</button>
              </div>
            </td>
          </tr>
        ))}</tbody>
      </table>
      {payments.length === 0 ? <div className="p-4"><EmptyState title="এখনো কোনো পেমেন্ট রেকর্ড হয়নি।" sub="Manual পেমেন্ট রেকর্ড করলেই বা Online Checkout সফল হলেই এখানে দেখা যাবে।" /></div> : null}
    </div>
  );

  const checkoutCard = (
    <div className="acard">
      <div className="mb-1 font-semibold">🧾 Online Checkout (Reconciliation)</div>
      <p className="mb-3 text-xs text-slate-500">Gateway Checkout গুলোর অবস্থা। <span className="text-amber-300">আটকে আছে</span> = ১ ঘণ্টার বেশি Initiated — "যাচাই করুন" Gateway এর নিজের রেকর্ড থেকে আবার নিশ্চিত করে (IPN হারিয়ে গেলে এটাই পুনরুদ্ধারের পথ)।</p>
      {checkouts.length === 0 ? <EmptyState title="কোনো Online Checkout নেই।" sub="কোনো Tenant Online Checkout শুরু করলে এখানে দেখা যাবে।" /> : (
        <div className="overflow-x-auto">
          <table className="atable atable-cards atable-v3">
            <thead><tr><th className="ath">সময়</th><th className="ath">Org / প্ল্যান</th><th className="ath">Gateway</th><th className="ath">পরিমাণ</th><th className="ath">অবস্থা</th><th className="ath"></th></tr></thead>
            <tbody>{checkouts.map((c) => (
              <tr key={c.id}>
                <td data-label="সময়" className="atd text-slate-400">{fmtDateTime(c.createdAt)}</td>
                <td data-label="Org / প্ল্যান" className="atd">{c.organizationName ?? "—"}<div className="text-xs text-slate-500">{c.plan} · {c.tranId}{c.couponCode ? ` · 🎟 ${c.couponCode}` : ""}</div></td>
                <td data-label="Gateway" className="atd">{c.gateway}</td>
                <td data-label="পরিমাণ" className="atd">৳ {formatMinorStr(c.amountMinor)}{c.discountMinor !== "0" ? <div className="text-xs text-slate-500">ছাড় ৳ {formatMinorStr(c.discountMinor)}</div> : null}</td>
                <td data-label="অবস্থা" className="atd">{c.status === "success" ? <span className="abadge-green">success</span> : c.stuck ? <span className="abadge-red">আটকে আছে</span> : <span className="abadge-slate">{c.status}</span>}</td>
                <td className="atd">{c.status === "initiated" ? <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => reconcile(c)}>যাচাই করুন</button> : null}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );

  const dunningCard = (
    <div className="acard">
      <div className="mb-1 font-semibold">📮 Dunning (PAST_DUE Reminder)</div>
      <p className="mb-3 text-xs text-slate-500">Reminder পাঠাতে Automations এ <code>dunning_reminders</code> Job তৈরি করুন (প্রতি Org এর জন্য)। প্রতিটি Stage (১/৩/৭ দিন) একবারই যায় — পাঠানো Stage এখানে দেখা যায়।</p>
      {dunning.length === 0 ? <EmptyState title="কোনো PAST_DUE Org নেই।" sub="সব Subscription হালনাগাদ আছে — Dunning লাগছে না।" /> : (
        <ul className="space-y-1.5 text-sm">{dunning.map((d) => (
          <li key={d.organizationId} className="flex flex-wrap items-center justify-between gap-2 rounded bg-slate-800 px-3 py-2">
            <a className="text-indigo-300 hover:underline" href={`/orgs/${d.organizationId}`}>{d.organizationName}</a>
            <span>{d.plan} · {d.daysOverdue ?? "—"} দিন পার · পাঠানো Stage: {d.dunningStagesSent.length ? d.dunningStagesSent.join(", ") : "এখনো নয়"}{d.reminderJobConfigured === false ? <span className="ml-2 text-red-400">⚠ reminder job নেই — পাঠানো হচ্ছে না</span> : null}</span>
          </li>
        ))}</ul>
      )}
    </div>
  );

  return (
    <AdminShell title="💳 SaaS Billing">
      {msg ? <p className="mb-3 rounded-lg bg-indigo-500/10 p-3 text-sm text-indigo-200">{msg}</p> : null}
      {!sum && loadFailed ? <ErrorState message="Billing Summary লোড হয়নি — আবার চেষ্টা করুন।" onRetry={load} /> : !sum ? (
        <div aria-hidden="true">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="askel-card" />)}</div>
          <div className="askel-table mt-5" />
        </div>
      ) : (
        <>
          {/* ADX7 KPI strip — all five figures come from the billing
              summary the page already loads (the overdue count is
              sum.overdue.length, the same list shown below). */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {[
              { label: "MRR (ACTIVE সাবস্ক্রিপশন)", value: `৳ ${formatMinorStr(sum.mrrMinor)}` },
              { label: "এই মাসে সংগ্রহ", value: `৳ ${formatMinorStr(sum.collectedThisMonthMinor)}` },
              { label: "মোট সংগ্রহ (সর্বকাল)", value: `৳ ${formatMinorStr(sum.collectedTotalMinor)}` },
              { label: "Trial চলছে", value: `${sum.trialingCount}টি Org` },
              { label: "মেয়াদ শেষ / Past Due", value: `${sum.overdue.length}টি Org` },
            ].map((c) => (
              <div key={c.label} className="acard"><div className="text-xs uppercase tracking-wide text-slate-400">{c.label}</div><div className="mt-1 text-2xl font-bold">{c.value}</div></div>
            ))}
          </div>

          <div className="mt-5">
            <Tabs tabs={TABS.map((t) => t.id === "dunning" ? { ...t, badge: dunning.length } : t)} active={tab} onChange={setTab} />
          </div>

          {tab === "subs" ? (
            <div className="atab-panel grid items-start gap-4 lg:grid-cols-2">
              {planOverdueCard}
              {couponCard}
            </div>
          ) : null}

          {tab === "invoices" ? (
            <div className="atab-panel">
              <div className="grid items-start gap-4 xl:grid-cols-2">
                {manualCard}
                {checkoutCard}
              </div>
              {paymentsCard}
            </div>
          ) : null}

          {tab === "dunning" ? (
            <div className="atab-panel">
              {dunningCard}
            </div>
          ) : null}
        </>
      )}
    </AdminShell>
  );
}
