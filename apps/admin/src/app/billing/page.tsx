"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { EmptyState, ErrorState, PageHead, Tabs, askConfirm, askInput, toast } from "@/components/ui";
import { API_URL, apiFetch, formatMinorStr, getAdminToken } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";
import { fmtNumber } from "@repo/contracts";
import { useAdminLocale } from "@/components/AdminLocale";

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
export default function BillingPage() {
  const { dict, locale, t } = useAdminLocale();
  const TABS = [
    { id: "subs", label: dict.billing.tabSubs },
    { id: "invoices", label: dict.billing.tabInvoices },
    { id: "dunning", label: dict.billing.tabDunning },
  ];
  const [sum, setSum] = React.useState<Summary | null>(null);
  const [payments, setPayments] = React.useState<Payment[]>([]);
  const [orgs, setOrgs] = React.useState<OrgRow[]>([]);
  const [checkouts, setCheckouts] = React.useState<Checkout[]>([]);
  const [coupons, setCoupons] = React.useState<Coupon[]>([]);
  const [dunning, setDunning] = React.useState<DunningRow[]>([]);
  // ADNX9: feedback moved to the toast system; form validation
  // errors stay WITH their form (field-level, persistent until
  // fixed) instead of a page-top banner.
  const [formError, setFormError] = React.useState<{ org?: string; amount?: string }>({});
  const [couponError, setCouponError] = React.useState("");
  const [recordBusy, setRecordBusy] = React.useState(false);
  const [couponBusy, setCouponBusy] = React.useState(false);
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
    if (!res.ok) { toast(t("billing.openFailed", { status: fmtNumber(locale, res.status) }), "error"); return; }
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
    const remaining = formatMinorStr(p.netMinor ?? p.amountMinor, locale);
    const amountStr = await askInput({ title: dict.billing.refundTitle, description: t("billing.refundDesc", { amount: remaining }), inputLabel: dict.billing.refundAmountLabel, inputOptional: true, confirmLabel: dict.common.proceed });
    if (amountStr === null) return;
    const reason = await askInput({ title: dict.billing.refundReasonTitle, inputLabel: dict.common.reason, inputRequired: true, confirmLabel: dict.common.proceed });
    if (!reason) return;
    const revoke = await askConfirm({ title: dict.billing.refundRevokeTitle, description: dict.billing.refundRevokeDesc, confirmLabel: dict.billing.refundRevokeConfirm, cancelLabel: dict.billing.refundOnly, danger: true });
    try {
      const taka = amountStr.trim() ? Number(amountStr) : null;
      const out = await apiFetch<any>(`/admin/payments/${p.id}/refund`, {
        method: "POST",
        body: JSON.stringify({ amountMinor: taka != null && Number.isFinite(taka) ? String(Math.round(taka * 100)) : undefined, reason, revokeAccess: revoke }),
      });
      toast(`${t("billing.refundDone", { amount: formatMinorStr(out.refundedMinor, locale) })}${out.accessRevoked ? dict.billing.refundDoneRevoked : ""}`);
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : dict.billing.refundFailed, "error"); }
  }

  async function reconcile(c: Checkout) {
    try {
      const out = await apiFetch<any>(`/admin/billing/checkouts/${c.id}/reconcile`, { method: "POST", body: "{}" });
      toast(out.ok ? (out.alreadyProcessed ? dict.billing.reconcileAlready : dict.billing.reconcileDone)
        : t("billing.reconcileNotYet", { reason: out.reason ?? out.gatewayStatus ?? dict.billing.reconcileUnknown }), out.ok ? "success" : "error");
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : dict.billing.reconcileFailed, "error"); }
  }

  async function createCoupon() {
    const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";
    const kind = val("cp-kind");
    const rawValue = Number(val("cp-value"));
    if (!val("cp-code") || !rawValue) { setCouponError(dict.billing.couponCodeValueRequired); return; }
    setCouponError(""); setCouponBusy(true);
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
      toast(dict.billing.couponCreated);
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : dict.billing.couponCreateFailed, "error"); }
    finally { setCouponBusy(false); }
  }

  async function toggleCoupon(c: Coupon) {
    const reason = await askInput({ title: c.active ? dict.billing.couponDeactivateReason : dict.billing.couponActivateReason, inputLabel: dict.common.reason, inputRequired: true, confirmLabel: dict.common.proceed });
    if (!reason) return;
    try {
      await apiFetch(`/admin/coupons/${c.id}/status`, { method: "POST", body: JSON.stringify({ active: !c.active, reason }) });
      toast(dict.billing.couponStatusChanged);
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : dict.billing.failedShort, "error"); }
  }

  async function record() {
    const amountTaka = Number(form.amount);
    const errs: { org?: string; amount?: string } = {};
    if (!form.organizationId) errs.org = dict.billing.orgRequired;
    if (!amountTaka || amountTaka <= 0) errs.amount = dict.billing.amountInvalid;
    setFormError(errs);
    if (errs.org || errs.amount) return;
    setRecordBusy(true);
    try {
      await apiFetch("/admin/payments", { method: "POST", body: JSON.stringify({
        organizationId: form.organizationId, amountMinor: String(Math.round(amountTaka * 100)), method: form.method,
        reference: form.reference || undefined, periodEnd: form.periodEnd || undefined,
      }) });
      toast(dict.billing.paymentRecorded);
      setForm({ ...form, amount: "", reference: "" });
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : dict.billing.failedLong, "error"); }
    finally { setRecordBusy(false); }
  }

  const planOverdueCard = sum ? (
    <div className="acard">
      <div className="mb-2 font-semibold">{dict.billing.planOrgCount}</div>
      <ul className="space-y-1 text-sm">{Object.entries(sum.perPlan).map(([plan, n]) => <li key={plan} className="flex justify-between border-b border-slate-800 pb-1"><span>{plan} ({t("billing.perMonth", { price: formatMinorStr(sum.planPricesMinor[plan] ?? 0, locale) })})</span><span>{t("billing.countSuffix", { count: fmtNumber(locale, n) })}</span></li>)}</ul>
      <div className="mb-2 mt-5 font-semibold text-amber-300">{t("billing.overdueTitle", { count: fmtNumber(locale, sum.overdue.length) })}</div>
      {sum.overdue.length === 0 ? <p className="text-sm text-emerald-300">{dict.billing.nobodyOverdue}</p> : (
        <ul className="space-y-1.5 text-sm">{sum.overdue.map((o) => (
          <li key={o.organizationId} className="flex items-center justify-between rounded bg-slate-800 px-3 py-2">
            <a className="text-indigo-300 hover:underline" href={`/orgs/${o.organizationId}`}>{o.organizationName}</a>
            <span>{o.plan} · {o.status}{o.daysOverdue != null ? t("billing.daysOver", { days: fmtNumber(locale, o.daysOverdue) }) : ""}</span>
          </li>
        ))}</ul>
      )}
      <p className="mt-2 text-xs text-slate-400">{dict.billing.overdueNote}</p>
    </div>
  ) : null;

  const couponCard = (
    <div className="acard">
      <div className="mb-3 font-semibold">{dict.billing.couponTitle}</div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm">{dict.billing.couponCode}<input id="cp-code" className="ainput mt-1" placeholder={dict.billing.couponCodePlaceholder} /></label>
        <label className="block text-sm">{dict.billing.couponKind}
          <select id="cp-kind" className="ainput mt-1"><option value="percent">{dict.billing.couponKindPercent}</option><option value="fixed">{dict.billing.couponKindFixed}</option></select></label>
        <label className="block text-sm">{dict.billing.couponValue}<input id="cp-value" type="number" min="0" step="any" className="ainput mt-1" /></label>
        <label className="block text-sm">{dict.billing.couponPlan}<input id="cp-plan" className="ainput mt-1" placeholder="STARTER / GROWTH / AGENCY" /></label>
        <label className="block text-sm">{dict.billing.couponExpires}<input id="cp-exp" type="date" className="ainput mt-1" /></label>
        <label className="block text-sm">{dict.billing.couponMaxUses}<input id="cp-max" type="number" min="1" className="ainput mt-1" /></label>
      </div>
      {couponError ? <p className="mt-2 text-sm text-red-300" role="alert">{couponError}</p> : null}
      <button className="abtn mt-3" onClick={createCoupon} disabled={couponBusy}>{couponBusy ? dict.common.busy : dict.billing.couponCreate}</button>
      {coupons.length === 0 ? <div className="mt-3"><EmptyState title={dict.billing.couponEmptyTitle} sub={dict.billing.couponEmptySub} /></div> : null}
      {coupons.length > 0 ? (
        <ul className="mt-3 space-y-1.5 text-sm">
          {coupons.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-slate-800 px-3 py-2">
              <span><strong>{c.code}</strong> · {c.kind === "percent" ? `${fmtNumber(locale, c.value)}%` : t("billing.moneyValue", { amount: formatMinorStr(c.value, locale) })}{c.planScope ? ` · ${c.planScope}` : ""} · {t("billing.couponUsed", { count: fmtNumber(locale, c.redeemedCount), max: c.maxRedemptions ? `/${fmtNumber(locale, c.maxRedemptions)}` : "" })}</span>
              <span className="flex items-center gap-2">
                {c.active ? <span className="abadge-green">{dict.billing.couponActive}</span> : <span className="abadge-red">{dict.billing.couponInactive}</span>}
                <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => toggleCoupon(c)}>{c.active ? dict.billing.couponDeactivate : dict.billing.couponActivate}</button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );

  const manualCard = (
    <div className="acard space-y-3">
      <div className="font-semibold">{dict.billing.manualTitle}</div>
      <label className="block text-sm">{dict.common.organization}
        <select className="ainput mt-1" value={form.organizationId} onChange={(e) => setForm({ ...form, organizationId: e.target.value })}>
          <option value="">{dict.billing.orgSelectPlaceholder}</option>
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        {formError.org ? <span className="mt-1 block text-xs font-normal text-red-300">{formError.org}</span> : null}
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm">{dict.billing.amountTaka}
          <input className="ainput mt-1" type="number" min={0} step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          {formError.amount ? <span className="mt-1 block text-xs font-normal text-red-300">{formError.amount}</span> : null}
        </label>
        <label className="block text-sm">{dict.billing.method}
          <select className="ainput mt-1" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>{METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm">{dict.billing.reference}
          <input className="ainput mt-1" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></label>
        <label className="block text-sm">{dict.billing.periodEnd}
          <input className="ainput mt-1" type="date" value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} /></label>
      </div>
      <button className="abtn" onClick={record} disabled={recordBusy}>{recordBusy ? dict.common.busy : dict.billing.record}</button>
      <p className="text-xs text-slate-400">{dict.billing.manualNote}</p>
    </div>
  );

  const paymentsCard = (
    <div className="acard mt-4 overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-slate-800 p-4">
        <span className="font-semibold">{dict.billing.recentPayments}</span>
        <button className="abtn-secondary !px-3 !py-1.5 text-xs" onClick={() => openAuthed("/admin/billing/export.csv", "payments-export.csv")}>{dict.billing.csvExport}</button>
      </div>
      <table className="atable atable-cards atable-v3">
        <thead className="bg-slate-900"><tr><th className="ath">{dict.billing.colDate}</th><th className="ath">{dict.common.organization}</th><th className="ath">{dict.billing.colAmountNet}</th><th className="ath">{dict.billing.method}</th><th className="ath">{dict.billing.reference}</th><th className="ath"></th></tr></thead>
        <tbody>{payments.map((p) => (
          <tr key={p.id} className="border-t border-slate-800">
            <td data-label={dict.billing.colDate} className="atd text-slate-400">{fmtDateTime(locale, p.createdAt)}</td>
            <td data-label={dict.common.organization} className="atd">{p.organizationName ?? p.organizationId}</td>
            <td data-label={dict.billing.colAmountNet} className="atd">{t("billing.moneyValue", { amount: formatMinorStr(p.netMinor ?? p.amountMinor, locale) })}
              {p.refundedMinor && p.refundedMinor !== "0" ? <div className="text-xs text-amber-300">{t("billing.refundedLine", { refunded: formatMinorStr(p.refundedMinor, locale), total: formatMinorStr(p.amountMinor, locale) })}</div> : null}
            </td>
            <td data-label={dict.billing.method} className="atd">{p.method}</td>
            <td data-label={dict.billing.reference} className="atd text-slate-400">{p.reference ?? "—"}</td>
            <td className="atd">
              <div className="flex flex-wrap gap-1.5">
                <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => openAuthed(`/admin/payments/${p.id}/invoice`)}>{dict.billing.invoice}</button>
                <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => openAuthed(`/admin/payments/${p.id}/invoice.pdf`, `invoice-${p.id}.pdf`)}>{dict.billing.pdf}</button>
                <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={async () => {
                  try { const out = await apiFetch<any>(`/admin/payments/${p.id}/invoice-email`, { method: "POST", body: "{}" }); toast(t("billing.invoiceEmailSent", { count: fmtNumber(locale, out.sent) })); }
                  catch (e) { toast(e instanceof Error ? e.message : dict.billing.emailFailed, "error"); }
                }}>{dict.billing.send}</button>
                <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => refund(p)}>{dict.billing.refund}</button>
                <button className="abtn-danger !px-2 !py-1 text-xs" onClick={async () => {
                  const reason = await askInput({ title: dict.billing.deletePaymentReason, inputLabel: dict.common.reason, inputRequired: true, confirmLabel: dict.common.proceed });
                  if (!reason) return;
                  try { await apiFetch(`/admin/payments/${p.id}`, { method: "DELETE", body: JSON.stringify({ reason }) }); toast(dict.billing.paymentDeleted); await load(); }
                  catch (e) { toast(e instanceof Error ? e.message : dict.billing.failedShort, "error"); }
                }}>{dict.common.delete}</button>
              </div>
            </td>
          </tr>
        ))}</tbody>
      </table>
      {payments.length === 0 ? <div className="p-4"><EmptyState title={dict.billing.paymentsEmptyTitle} sub={dict.billing.paymentsEmptySub} /></div> : null}
    </div>
  );

  const checkoutCard = (
    <div className="acard">
      <div className="mb-1 font-semibold">{dict.billing.checkoutTitle}</div>
      <p className="mb-3 text-xs text-slate-400">{dict.billing.checkoutNotePre}<span className="text-amber-300">{dict.billing.checkoutNoteStuck}</span>{dict.billing.checkoutNotePost}</p>
      {checkouts.length === 0 ? <EmptyState title={dict.billing.checkoutEmptyTitle} sub={dict.billing.checkoutEmptySub} /> : (
        <div className="overflow-x-auto">
          <table className="atable atable-cards atable-v3">
            <thead><tr><th className="ath">{dict.billing.colTime}</th><th className="ath">{dict.billing.colOrgPlan}</th><th className="ath">{dict.billing.colGateway}</th><th className="ath">{dict.billing.colAmount}</th><th className="ath">{dict.common.status}</th><th className="ath"></th></tr></thead>
            <tbody>{checkouts.map((c) => (
              <tr key={c.id}>
                <td data-label={dict.billing.colTime} className="atd text-slate-400">{fmtDateTime(locale, c.createdAt)}</td>
                <td data-label={dict.billing.colOrgPlan} className="atd">{c.organizationName ?? "—"}<div className="text-xs text-slate-400">{c.plan} · {c.tranId}{c.couponCode ? ` · 🎟 ${c.couponCode}` : ""}</div></td>
                <td data-label={dict.billing.colGateway} className="atd">{c.gateway}</td>
                <td data-label={dict.billing.colAmount} className="atd">{t("billing.moneyValue", { amount: formatMinorStr(c.amountMinor, locale) })}{c.discountMinor !== "0" ? <div className="text-xs text-slate-400">{t("billing.discountLine", { amount: formatMinorStr(c.discountMinor, locale) })}</div> : null}</td>
                <td data-label={dict.common.status} className="atd">{c.status === "success" ? <span className="abadge-green">success</span> : c.stuck ? <span className="abadge-red">{dict.billing.stuck}</span> : <span className="abadge-slate">{c.status}</span>}</td>
                <td className="atd">{c.status === "initiated" ? <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => reconcile(c)}>{dict.billing.verify}</button> : null}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );

  const dunningCard = (
    <div className="acard">
      <div className="mb-1 font-semibold">{dict.billing.dunningTitle}</div>
      <p className="mb-3 text-xs text-slate-400">{dict.billing.dunningNotePre}<code>dunning_reminders</code>{dict.billing.dunningNotePost}</p>
      {dunning.length === 0 ? <EmptyState title={dict.billing.dunningEmptyTitle} sub={dict.billing.dunningEmptySub} /> : (
        <ul className="space-y-1.5 text-sm">{dunning.map((d) => (
          <li key={d.organizationId} className="flex flex-wrap items-center justify-between gap-2 rounded bg-slate-800 px-3 py-2">
            <a className="text-indigo-300 hover:underline" href={`/orgs/${d.organizationId}`}>{d.organizationName}</a>
            <span>{t("billing.dunningRow", { plan: d.plan, days: d.daysOverdue != null ? fmtNumber(locale, d.daysOverdue) : "—", stages: d.dunningStagesSent.length ? d.dunningStagesSent.map((n) => fmtNumber(locale, n)).join(", ") : dict.billing.dunningStagesNone })}{d.reminderJobConfigured === false ? <span className="ml-2 text-red-400">{dict.billing.dunningNoJob}</span> : null}</span>
          </li>
        ))}</ul>
      )}
    </div>
  );

  return (
    <AdminShell title={dict.billing.title}>
      <PageHead sub={dict.billing.sub} />
      {!sum && loadFailed ? <ErrorState message={dict.billing.summaryLoadError} onRetry={load} /> : !sum ? (
        <div aria-hidden="true">
          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 sm:grid sm:snap-none sm:grid-cols-2 sm:overflow-visible sm:pb-0 xl:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="askel-card" />)}</div>
          <div className="askel-table mt-5" />
        </div>
      ) : (
        <>
          {/* ADX7 KPI strip — all five figures come from the billing
              summary the page already loads (the overdue count is
              sum.overdue.length, the same list shown below). */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {[
              { label: dict.billing.kpiMrr, value: t("billing.moneyValue", { amount: formatMinorStr(sum.mrrMinor, locale) }) },
              { label: dict.billing.kpiCollectedMonth, value: t("billing.moneyValue", { amount: formatMinorStr(sum.collectedThisMonthMinor, locale) }) },
              { label: dict.billing.kpiCollectedTotal, value: t("billing.moneyValue", { amount: formatMinorStr(sum.collectedTotalMinor, locale) }) },
              { label: dict.billing.kpiTrialing, value: t("billing.kpiTrialingValue", { count: fmtNumber(locale, sum.trialingCount) }) },
              { label: dict.billing.kpiOverdue, value: t("billing.kpiTrialingValue", { count: fmtNumber(locale, sum.overdue.length) }) },
            ].map((c) => (
              <div key={c.label} className="acard min-w-[212px] snap-start sm:min-w-0"><div className="text-xs uppercase tracking-wide text-slate-400">{c.label}</div><div className="mt-1 text-2xl font-bold">{c.value}</div></div>
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
