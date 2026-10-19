"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import Link from "next/link";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import AccountingLite from "./AccountingLite";
import { getOrganizationId } from "@/lib/org";
import { formatMinor } from "@repo/contracts";
import { ResponsiveTable } from "@repo/ui";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_PAYMENT_METHODS,
  currentMonth,
  defaultRange,
  expenseCategoryLabel,
  expensePaymentMethodLabel,
  formatMonthLabel,
  minorToTakaInput,
  partialFullLabel,
  refundResolutionLabel,
  shiftMonth,
  takaToMinor,
  type CodReceivableLedger,
  type CourierMismatches,
  type CourierSettlementsLedger,
  type Expense,
  type ExpenseList,
  type ExpenseSummary,
  type GatewayFeeRow,
  type GatewaySettlementRow,
  type RefundsLedger,
  type SalesLedger,
} from "@/lib/finance-gb8";

// GB8 / GC20 — Finance hub: sales ledger, COD receivable,
// gateway settlements, courier settlements + mismatches,
// refund ledger, expenses and the accountant GL export.

const fmtM = (minor?: string | null): string => {
  if (minor == null) return "—";
  try { return formatMinor(BigInt(minor)); } catch { return minor; }
};
const fmtSigned = (minor?: string | null): string => {
  if (minor == null) return "—";
  try {
    const v = BigInt(minor);
    return v < 0n ? `−${formatMinor(-v)}` : formatMinor(v);
  } catch { return minor; }
};

const inputCls = "w-full rounded-lg border px-3 py-2 text-sm";
const labelCls = "mb-1 block text-xs font-semibold text-slate-700";
const thCls = "py-2 pr-2 font-semibold";
const tdCls = "py-2 pr-2";

type Tab = "sales" | "cod" | "gateway" | "courier" | "refunds" | "expenses" | "accounting";
const TABS: { key: Tab; labelKey: string }[] = [
  { key: "accounting", labelKey: "ledgerJournal" },
  { key: "sales", labelKey: "salesLedger" },
  { key: "cod", labelKey: "cODDue" },
  { key: "gateway", labelKey: "gatewaySettlement" },
  { key: "courier", labelKey: "courierSettlement" },
  { key: "refunds", labelKey: "refundLedger" },
  { key: "expenses", labelKey: "cost" },
];

export default function FinancePage() {
  const { dict, t, locale } = useLocale();
  const [tab, setTab] = useState<Tab>("sales");
  const [range, setRange] = useState(() => defaultRange());
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);

  const [sales, setSales] = useState<SalesLedger | null>(null);
  const [salesPage, setSalesPage] = useState(1);
  const [cod, setCod] = useState<CodReceivableLedger | null>(null);
  const [feeRows, setFeeRows] = useState<GatewayFeeRow[] | null>(null);
  const [settlementRows, setSettlementRows] = useState<GatewaySettlementRow[] | null>(null);
  const [courier, setCourier] = useState<CourierSettlementsLedger | null>(null);
  const [mismatches, setMismatches] = useState<CourierMismatches | null>(null);
  const [refundLedger, setRefundLedger] = useState<RefundsLedger | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Expenses
  const [expenses, setExpenses] = useState<ExpenseList | null>(null);
  const [expPage, setExpPage] = useState(1);
  const [expError, setExpError] = useState("");
  const [summaryMonth, setSummaryMonth] = useState(() => currentMonth());
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [expCategory, setExpCategory] = useState("other");
  const [expAmount, setExpAmount] = useState("");
  const [expSpentAt, setExpSpentAt] = useState(() => defaultRange().to);
  const [expNote, setExpNote] = useState("");
  const [expMethod, setExpMethod] = useState("cash");
  const [expReceipt, setExpReceipt] = useState("");
  const [expBusy, setExpBusy] = useState(false);
  const [expMsg, setExpMsg] = useState("");
  const [expFormError, setExpFormError] = useState("");

  // GL export
  const [glBusy, setGlBusy] = useState(false);
  const [glMsg, setGlMsg] = useState("");
  const [glError, setGlError] = useState("");

  const qs = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

  const loadSales = useCallback(async (page: number) => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(true); setError("");
    try { setSales(await apiFetch<SalesLedger>(`/organizations/${orgId}/finance/ledgers/sales?${qs}&page=${page}&pageSize=50`)); }
    catch (e) { setError(e instanceof Error ? e.message : dict.commerce.salesLedgerLoadingFailed); }
    finally { setBusy(false); }
  }, [qs]);

  const loadTab = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) { setError(dict.commerce.noOrganizationSelected); return; }
    if (tab === "accounting") return; // OU7 section loads itself
    if (tab === "sales") { await loadSales(salesPage); return; }
    if (tab === "expenses") return; // expenses load via their own effects
    setBusy(true); setError("");
    try {
      if (tab === "cod") setCod(await apiFetch<CodReceivableLedger>(`/organizations/${orgId}/finance/ledgers/cod_receivable?${qs}`));
      if (tab === "gateway") {
        const [fee, settlements] = await Promise.all([
          apiFetch<{ rows: GatewayFeeRow[] }>(`/organizations/${orgId}/connections/payment-fee-report?${qs}`),
          apiFetch<{ rows: GatewaySettlementRow[] }>(`/organizations/${orgId}/connections/payment-settlements?${qs}`),
        ]);
        setFeeRows(fee.rows ?? []); setSettlementRows(settlements.rows ?? []);
      }
      if (tab === "courier") {
        const [c, m] = await Promise.all([
          apiFetch<CourierSettlementsLedger>(`/organizations/${orgId}/finance/ledgers/courier_settlements?${qs}`),
          apiFetch<CourierMismatches>(`/organizations/${orgId}/finance/ledgers/mismatches?${qs}`),
        ]);
        setCourier(c); setMismatches(m);
      }
      if (tab === "refunds") setRefundLedger(await apiFetch<RefundsLedger>(`/organizations/${orgId}/finance/ledgers/refunds?${qs}`));
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.loadingFailed); }
    finally { setBusy(false); }
  }, [tab, qs, loadSales, salesPage]);
  useEffect(() => { void loadTab(); }, [loadTab]);

  const loadExpenses = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      setExpenses(await apiFetch<ExpenseList>(`/organizations/${orgId}/finance/expenses?${qs}&page=${expPage}&pageSize=50`));
      setExpError("");
    } catch (e) { setExpError(e instanceof Error ? e.message : dict.commerce.costLoadingFailed); }
  }, [qs, expPage]);
  useEffect(() => { if (tab === "expenses") void loadExpenses(); }, [tab, loadExpenses]);

  const loadSummary = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try { setSummary(await apiFetch<ExpenseSummary>(`/organizations/${orgId}/finance/expenses/summary?month=${encodeURIComponent(summaryMonth)}`)); }
    catch { setSummary(null); }
  }, [summaryMonth]);
  useEffect(() => { if (tab === "expenses") void loadSummary(); }, [tab, loadSummary]);

  function startEdit(exp: Expense) {
    setEditing(exp);
    setExpCategory(exp.category); setExpAmount(minorToTakaInput(exp.amountMinor));
    setExpSpentAt(exp.spentAt); setExpNote(exp.note ?? "");
    setExpMethod(exp.paymentMethod); setExpReceipt(exp.receiptUrl ?? "");
    setExpMsg(""); setExpFormError("");
  }
  function resetForm() {
    setEditing(null); setExpCategory("other"); setExpAmount("");
    setExpSpentAt(defaultRange().to); setExpNote(""); setExpMethod("cash"); setExpReceipt("");
  }

  async function saveExpense(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setExpMsg(""); setExpFormError("");
    const amountMinor = takaToMinor(expAmount);
    if (amountMinor == null) { setExpFormError(dict.commerce.giveTheAmountInTaka); return; }
    if (!expSpentAt) { setExpFormError(dict.commerce.giveTheCostDate); return; }
    setExpBusy(true);
    try {
      const body = JSON.stringify({
        category: expCategory, amountMinor, spentAt: expSpentAt,
        note: expNote.trim() || null, paymentMethod: expMethod,
        receiptUrl: expReceipt.trim() || null,
      });
      if (editing) {
        await apiFetch(`/organizations/${orgId}/finance/expenses/${editing.id}`, { method: "PATCH", body });
        setExpMsg(dict.commerce.costUpdated);
      } else {
        await apiFetch(`/organizations/${orgId}/finance/expenses`, { method: "POST", body });
        setExpMsg(dict.commerce.costAdded);
      }
      resetForm();
      await loadExpenses(); await loadSummary();
    } catch (err) { setExpFormError(err instanceof Error ? err.message : dict.commerce.saveFailed2); }
    finally { setExpBusy(false); }
  }

  // EB6/ED13: expense row actions shared verbatim by the desktop
  // table cell and the ResponsiveTable mobile card — same handlers.
  const renderExpenseActions = (exp: Expense) => (
    <span className="flex gap-2"><button type="button" className="btn-secondary inline-flex min-h-[44px] items-center" onClick={() => startEdit(exp)}>{dict.commerce.edit}</button><button type="button" className="btn-secondary inline-flex min-h-[44px] items-center text-red-600" onClick={() => void deleteExpense(exp)}>{dict.commerce.delete}</button></span>
  );

  async function deleteExpense(exp: Expense) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setExpMsg(""); setExpFormError("");
    try {
      await apiFetch(`/organizations/${orgId}/finance/expenses/${exp.id}`, { method: "DELETE" });
      setExpMsg(dict.commerce.costDeleted);
      if (editing?.id === exp.id) resetForm();
      await loadExpenses(); await loadSummary();
    } catch (err) { setExpFormError(err instanceof Error ? err.message : dict.commerce.deleteFailed3); }
  }

  async function downloadGl(fmt: "csv" | "xlsx") {
    const orgId = getOrganizationId(); if (!orgId) return;
    setGlMsg(""); setGlError("");
    if (!from || !to) { setGlError(dict.commerce.giveBothTheStartAnd); return; }
    setGlBusy(true);
    try {
      const res = await fetch(
        `${API_URL}/organizations/${orgId}/finance/gl-export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&format=${fmt}`,
        { headers: { Authorization: `Bearer ${getToken() ?? ""}` } },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? t("commerce.downloadFailedHTTP", { status: res.status }));
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `gl-export-${from}-${to}.${fmt}`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setGlMsg(t("commerce.gLExportDownloaded", { fmt: fmt.toUpperCase() }));
    } catch (err) { setGlError(err instanceof Error ? err.message : dict.commerce.downloadFailed); }
    finally { setGlBusy(false); }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <div>
        <h1 className="page-title">{dict.commerce.financeLedger}</h1>
        <p className="text-sm text-slate-500">{dict.commerce.salesLedgerCODDuesGateway}</p>
        <p className="mt-1 text-xs text-slate-400"><Link href="/dashboard/commerce/reports" className="font-semibold text-indigo-600 hover:underline">{dict.commerce.viewAllReports}</Link> · <Link href="/dashboard/commerce/ledger" className="font-semibold text-indigo-600 hover:underline">{dict.commerce.ledgerJournalDoubleEntry}</Link></p>
      </div>

      <div className="card space-y-4 p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div><label className={labelCls}>{dict.commerce.startDate}</label><input className={inputCls} type="date" value={from} onChange={(e) => { setFrom(e.target.value); setSalesPage(1); setExpPage(1); }} /></div>
          <div><label className={labelCls}>{dict.commerce.endDate}</label><input className={inputCls} type="date" value={to} onChange={(e) => { setTo(e.target.value); setSalesPage(1); setExpPage(1); }} /></div>
          <div className="flex items-end"><button type="button" className="btn-primary" disabled={busy} onClick={() => void loadTab()}>{busy ? dict.common.loading : dict.commerce.view}</button></div>
        </div>
        <div className="flex flex-wrap gap-2 border-b pb-3">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`inline-flex min-h-[44px] items-center rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === t.key ? "bg-indigo-600 text-white" : "border bg-white"}`}>{dict.commerce[t.labelKey as keyof typeof dict.commerce]}</button>
          ))}
        </div>
        {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        {busy && tab !== "expenses" && tab !== "accounting" ? <p className="text-sm text-slate-400">{dict.common.loading}</p> : null}

        {tab === "accounting" ? <AccountingLite from={from} to={to} /> : null}

        {tab === "sales" && sales ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">{dict.commerce.soldOrdersDeliveredCompletedOr}</p>
            {sales.rows.length === 0 ? <p className="text-sm text-slate-400">{dict.commerce.noSoldOrdersInThis}</p> : (
              <ResponsiveTable table={<div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>{dict.commerce.date}</th><th className={thCls}>{dict.commerce.order}</th><th className={thCls}>{dict.commerce.buyer}</th><th className={thCls}>{dict.commerce.status}</th><th className={thCls}>{dict.commerce.total}</th><th className={thCls}>{dict.commerce.discount}</th><th className={thCls}>{dict.commerce.delivery}</th><th className={thCls}>{dict.commerce.tax}</th><th className={thCls}>{dict.commerce.paid}</th><th className={thCls}>{dict.commerce.due2}</th></tr></thead><tbody>
                {sales.rows.map((r) => (<tr key={r.orderId} className="border-b last:border-0"><td className={tdCls}>{r.date}</td><td className={tdCls}>{r.orderNumber}</td><td className={tdCls}>{r.customerName}</td><td className={tdCls}>{r.status}</td><td className={tdCls}>{fmtM(r.totalMinor)}</td><td className={tdCls}>{fmtM(r.discountMinor)}</td><td className={tdCls}>{fmtM(r.deliveryMinor)}</td><td className={tdCls}>{fmtM(r.taxMinor)}</td><td className={tdCls}>{fmtM(r.paidMinor)}</td><td className={tdCls}>{fmtM(r.dueMinor)}</td></tr>))}
                <tr className="bg-slate-50 font-semibold"><td className={tdCls}>{dict.commerce.total4}{sales.totals.orders}{dict.commerce.text1ge21}</td><td className={tdCls} colSpan={3}>—</td><td className={tdCls}>{fmtM(sales.totals.totalMinor)}</td><td className={tdCls}>{fmtM(sales.totals.discountMinor)}</td><td className={tdCls}>{fmtM(sales.totals.deliveryMinor)}</td><td className={tdCls}>{fmtM(sales.totals.taxMinor)}</td><td className={tdCls}>{fmtM(sales.totals.paidMinor)}</td><td className={tdCls}>{fmtM(sales.totals.dueMinor)}</td></tr>
              </tbody></table></div>} cards={<>{sales.rows.map((r) => (<div key={r.orderId} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.date}</dt><dd className="text-right ">{r.date}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.order}</dt><dd className="text-right ">{r.orderNumber}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.buyer}</dt><dd className="text-right ">{r.customerName}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.status}</dt><dd className="text-right ">{r.status}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.total}</dt><dd className="text-right ">{fmtM(r.totalMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.discount}</dt><dd className="text-right ">{fmtM(r.discountMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.delivery}</dt><dd className="text-right ">{fmtM(r.deliveryMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.tax}</dt><dd className="text-right ">{fmtM(r.taxMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.paid}</dt><dd className="text-right ">{fmtM(r.paidMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.due2}</dt><dd className="text-right ">{fmtM(r.dueMinor)}</dd></div></dl></div>))}<div className="rounded-xl border bg-slate-50 p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.total}</dt><dd className="text-right ">{sales.totals.orders}{dict.commerce.text1ou8}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.totalAmount}</dt><dd className="text-right ">{fmtM(sales.totals.totalMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.discount}</dt><dd className="text-right ">{fmtM(sales.totals.discountMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.delivery}</dt><dd className="text-right ">{fmtM(sales.totals.deliveryMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.tax}</dt><dd className="text-right ">{fmtM(sales.totals.taxMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.paid}</dt><dd className="text-right ">{fmtM(sales.totals.paidMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.due2}</dt><dd className="text-right ">{fmtM(sales.totals.dueMinor)}</dd></div></dl></div></>} />
            )}
            <div className="flex items-center gap-2 text-sm">
              <button type="button" className="btn-secondary" disabled={salesPage <= 1} onClick={() => setSalesPage((p) => p - 1)}>{dict.commerce.previous}</button>
              <span>{dict.commerce.page}{sales.page} {dict.commerce.total2}{sales.total}{dict.commerce.text1ou8}</span>
              <button type="button" className="btn-secondary" disabled={salesPage * sales.pageSize >= sales.total} onClick={() => setSalesPage((p) => p + 1)}>{dict.commerce.next}</button>
            </div>
          </div>
        ) : null}

        {tab === "cod" && cod ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{dict.commerce.totalDue2}{cod.outstanding.count}{dict.commerce.text1ge21}</div><div className="text-lg font-bold">{fmtM(cod.outstanding.totalMinor)}</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{dict.commerce.textldvz5j}{cod.outstanding.buckets.d0_7.count}{dict.commerce.text1ge21}</div><div className="text-lg font-bold">{fmtM(cod.outstanding.buckets.d0_7.totalMinor)}</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{dict.commerce.text6vrrdl}{cod.outstanding.buckets.d8_30.count}{dict.commerce.text1ge21}</div><div className="text-lg font-bold">{fmtM(cod.outstanding.buckets.d8_30.totalMinor)}</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{dict.commerce.text1a9re3o}{cod.outstanding.buckets.d31plus.count}{dict.commerce.text1ge21}</div><div className="text-lg font-bold text-rose-700">{fmtM(cod.outstanding.buckets.d31plus.totalMinor)}</div></div>
            </div>
            {cod.outstanding.truncated ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{dict.commerce.theListIsLimitedNot2}</p> : null}
            {cod.outstanding.rows.length === 0 ? <p className="text-sm text-slate-400">{dict.commerce.noCODDues}</p> : (
              <ResponsiveTable table={<div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>{dict.commerce.order}</th><th className={thCls}>{dict.commerce.buyer}</th><th className={thCls}>{dict.commerce.date}</th><th className={thCls}>{dict.commerce.total}</th><th className={thCls}>{dict.commerce.due2}</th><th className={thCls}>{dict.commerce.age}</th></tr></thead><tbody>
                {cod.outstanding.rows.map((r) => (<tr key={r.orderId} className="border-b last:border-0"><td className={tdCls}>{r.orderNumber}</td><td className={tdCls}>{r.customerName}</td><td className={tdCls}>{r.date}</td><td className={tdCls}>{fmtM(r.totalMinor)}</td><td className={tdCls}>{fmtM(r.dueMinor)}</td><td className={tdCls}>{r.ageDays} {dict.commerce.days}</td></tr>))}
              </tbody></table></div>} cards={cod.outstanding.rows.map((r) => (<div key={r.orderId} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.order}</dt><dd className="text-right ">{r.orderNumber}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.buyer}</dt><dd className="text-right ">{r.customerName}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.date}</dt><dd className="text-right ">{r.date}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.total}</dt><dd className="text-right ">{fmtM(r.totalMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.due2}</dt><dd className="text-right ">{fmtM(r.dueMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.age}</dt><dd className="text-right ">{r.ageDays} {dict.commerce.days}</dd></div></dl></div>))} />
            )}
            <div>
              <h3 className="font-semibold">{dict.commerce.collections}{cod.collections.count}{dict.commerce.total5}{fmtM(cod.collections.totalMinor)}</h3>
              {cod.collections.rows.length === 0 ? <p className="mt-2 text-sm text-slate-400">{dict.commerce.noCollectionsInThisPeriod}</p> : (
                <ResponsiveTable table={<div className="mt-2 overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>{dict.commerce.date}</th><th className={thCls}>{dict.commerce.order}</th><th className={thCls}>{dict.commerce.courier}</th><th className={thCls}>{dict.commerce.quantity}</th></tr></thead><tbody>
                  {cod.collections.rows.map((r, i) => (<tr key={`${r.orderId}-${i}`} className="border-b last:border-0"><td className={tdCls}>{r.date}</td><td className={tdCls}>{r.orderNumber}</td><td className={tdCls}>{r.provider}</td><td className={tdCls}>{fmtM(r.amountMinor)}</td></tr>))}
                </tbody></table></div>} cards={cod.collections.rows.map((r, i) => (<div key={`${r.orderId}-${i}`} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.date}</dt><dd className="text-right ">{r.date}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.order}</dt><dd className="text-right ">{r.orderNumber}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.courier}</dt><dd className="text-right ">{r.provider}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.quantity}</dt><dd className="text-right ">{fmtM(r.amountMinor)}</dd></div></dl></div>))} />
              )}
            </div>
          </div>
        ) : null}

        {tab === "gateway" ? (
          <div className="space-y-4">
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{dict.commerce.thisIsTheSameAccount}</p>
            {feeRows && feeRows.length === 0 ? <p className="text-sm text-slate-400">{dict.commerce.noVerifiedOnlinePaymentsIn}</p> : null}
            {feeRows && feeRows.length > 0 ? (
              <ResponsiveTable table={<div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>{dict.commerce.provider}</th><th className={thCls}>{dict.commerce.source}</th><th className={thCls}>{dict.commerce.paymentCount}</th><th className={thCls}>{dict.commerce.totalGross}</th><th className={thCls}>{dict.commerce.fee}</th><th className={thCls}>{dict.commerce.net}</th></tr></thead><tbody>
                {feeRows.map((r) => (<tr key={`${r.provider}-${r.source}`} className="border-b last:border-0"><td className={tdCls}>{r.provider}</td><td className={tdCls}>{r.source === "platform" ? dict.commerce.platform : dict.commerce.own}</td><td className={tdCls}>{r.count}{dict.commerce.text1ou8}</td><td className={tdCls}>{fmtM(r.grossMinor)}</td><td className={tdCls}>{r.feeMinor != null ? fmtM(r.feeMinor) : <span className="font-semibold text-amber-700">{dict.commerce.feeRateIsNotSet}</span>}</td><td className={tdCls}>{r.netMinor != null ? fmtM(r.netMinor) : "—"}</td></tr>))}
              </tbody></table></div>} cards={feeRows.map((r) => (<div key={`${r.provider}-${r.source}`} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.provider}</dt><dd className="text-right ">{r.provider}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.source}</dt><dd className="text-right ">{r.source === "platform" ? dict.commerce.platform : dict.commerce.own}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.paymentCount}</dt><dd className="text-right ">{r.count}{dict.commerce.text1ou8}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.totalGross}</dt><dd className="text-right ">{fmtM(r.grossMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.fee}</dt><dd className="text-right ">{r.feeMinor != null ? fmtM(r.feeMinor) : <span className="font-semibold text-amber-700">{dict.commerce.feeRateIsNotSet}</span>}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.net}</dt><dd className="text-right ">{r.netMinor != null ? fmtM(r.netMinor) : "—"}</dd></div></dl></div>))} />
            ) : null}
            <h3 className="text-sm font-semibold">{dict.commerce.expectedSettlementsOwnGatewayBy}</h3>
            {settlementRows && settlementRows.length === 0 ? <p className="text-sm text-slate-400">{dict.commerce.noSettlementsOnYourOwn}</p> : null}
            {settlementRows && settlementRows.length > 0 ? (
              <ResponsiveTable table={<div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>{dict.commerce.days}</th><th className={thCls}>{dict.commerce.provider}</th><th className={thCls}>{dict.commerce.paymentCount}</th><th className={thCls}>{dict.commerce.totalGross}</th><th className={thCls}>{dict.commerce.fee}</th><th className={thCls}>{dict.commerce.net}</th></tr></thead><tbody>
                {settlementRows.map((r) => (<tr key={`${r.day}-${r.provider}`} className="border-b last:border-0"><td className={tdCls}>{r.day}</td><td className={tdCls}>{r.provider}</td><td className={tdCls}>{r.count}{dict.commerce.text1ou8}</td><td className={tdCls}>{fmtM(r.grossMinor)}</td><td className={tdCls}>{r.feeMinor != null ? fmtM(r.feeMinor) : <span className="font-semibold text-amber-700">{dict.commerce.feeRateIsNotSet}</span>}</td><td className={tdCls}>{r.netMinor != null ? fmtM(r.netMinor) : "—"}</td></tr>))}
              </tbody></table></div>} cards={settlementRows.map((r) => (<div key={`${r.day}-${r.provider}`} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.days}</dt><dd className="text-right ">{r.day}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.provider}</dt><dd className="text-right ">{r.provider}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.paymentCount}</dt><dd className="text-right ">{r.count}{dict.commerce.text1ou8}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.totalGross}</dt><dd className="text-right ">{fmtM(r.grossMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.fee}</dt><dd className="text-right ">{r.feeMinor != null ? fmtM(r.feeMinor) : <span className="font-semibold text-amber-700">{dict.commerce.feeRateIsNotSet}</span>}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.net}</dt><dd className="text-right ">{r.netMinor != null ? fmtM(r.netMinor) : "—"}</dd></div></dl></div>))} />
            ) : null}
          </div>
        ) : null}

        {tab === "courier" && courier ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{dict.commerce.import}</div><div className="text-lg font-bold">{courier.totals.imports}{dict.commerce.text1ou8}</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{dict.commerce.linesMatched}</div><div className="text-lg font-bold">{courier.totals.lines} / {courier.totals.matched}</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{dict.commerce.mismatch}</div><div className="text-lg font-bold">{courier.totals.mismatches}{dict.commerce.text1ou8}</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{dict.commerce.totalMismatchDifference}</div><div className="text-lg font-bold">{fmtSigned(courier.totals.mismatchDeltaMinor)}</div></div>
            </div>
            {courier.imports.length === 0 ? <p className="text-sm text-slate-400">{dict.commerce.noCourierSettlementImportsIn}</p> : (
              <ResponsiveTable table={<div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>{dict.commerce.date}</th><th className={thCls}>{dict.commerce.courier}</th><th className={thCls}>{dict.commerce.file}</th><th className={thCls}>{dict.commerce.row}</th><th className={thCls}>{dict.commerce.matched}</th><th className={thCls}>{dict.commerce.mismatch}</th><th className={thCls}>{dict.commerce.difference}</th><th className={thCls}>{dict.commerce.status}</th></tr></thead><tbody>
                {courier.imports.map((r) => (<tr key={r.id} className="border-b last:border-0"><td className={tdCls}>{r.date}</td><td className={tdCls}>{r.provider}</td><td className={tdCls}>{r.fileName}</td><td className={tdCls}>{r.rowCount}</td><td className={tdCls}>{r.matchedCount}</td><td className={tdCls}>{r.mismatchCount}</td><td className={tdCls}>{fmtSigned(r.mismatchDeltaMinor)}</td><td className={tdCls}>{r.status}</td></tr>))}
              </tbody></table></div>} cards={courier.imports.map((r) => (<div key={r.id} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.date}</dt><dd className="text-right ">{r.date}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.courier}</dt><dd className="text-right ">{r.provider}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.file}</dt><dd className="text-right ">{r.fileName}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.row}</dt><dd className="text-right ">{r.rowCount}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.matched}</dt><dd className="text-right ">{r.matchedCount}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.mismatch}</dt><dd className="text-right ">{r.mismatchCount}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.difference}</dt><dd className="text-right ">{fmtSigned(r.mismatchDeltaMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.status}</dt><dd className="text-right ">{r.status}</dd></div></dl></div>))} />
            )}
            <div>
              <h3 className="font-semibold">{dict.commerce.mismatchDetails}{mismatches ? t("commerce.totalDifference", { count: mismatches.totals.count, fmtSigned: fmtSigned(mismatches.totals.deltaMinor) }) : ""}</h3>
              {mismatches && mismatches.rows.length === 0 ? <p className="mt-2 text-sm text-slate-400">{dict.commerce.noMismatches}</p> : null}
              {mismatches && mismatches.rows.length > 0 ? (
                <ResponsiveTable table={<div className="mt-2 overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>{dict.commerce.importDate}</th><th className={thCls}>{dict.commerce.courier}</th><th className={thCls}>{dict.commerce.row}</th><th className={thCls}>{dict.commerce.tracking}</th><th className={thCls}>{dict.commerce.order}</th><th className={thCls}>{dict.commerce.expected}</th><th className={thCls}>{dict.commerce.onTheSheet}</th><th className={thCls}>{dict.commerce.difference}</th></tr></thead><tbody>
                  {mismatches.rows.map((r, i) => (<tr key={`${r.importId}-${r.rowNumber}-${i}`} className="border-b last:border-0"><td className={tdCls}>{r.importDate}</td><td className={tdCls}>{r.provider}</td><td className={tdCls}>{r.rowNumber}</td><td className={tdCls}>{r.trackingId}</td><td className={tdCls}>{r.orderNumber || r.orderRef}</td><td className={tdCls}>{fmtM(r.expectedMinor)}</td><td className={tdCls}>{fmtM(r.sheetAmountMinor)}</td><td className={tdCls}>{fmtSigned(r.deltaMinor)}</td></tr>))}
                </tbody></table></div>} cards={mismatches.rows.map((r, i) => (<div key={`${r.importId}-${r.rowNumber}-${i}`} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.importDate}</dt><dd className="text-right ">{r.importDate}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.courier}</dt><dd className="text-right ">{r.provider}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.row}</dt><dd className="text-right ">{r.rowNumber}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.tracking}</dt><dd className="text-right ">{r.trackingId}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.order}</dt><dd className="text-right ">{r.orderNumber || r.orderRef}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.expected}</dt><dd className="text-right ">{fmtM(r.expectedMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.onTheSheet}</dt><dd className="text-right ">{fmtM(r.sheetAmountMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.difference}</dt><dd className="text-right ">{fmtSigned(r.deltaMinor)}</dd></div></dl></div>))} />
              ) : null}
            </div>
          </div>
        ) : null}

        {tab === "refunds" && refundLedger ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">{dict.commerce.total}{refundLedger.totals.count}{dict.commerce.totalRefundedAmountKnownAmounts}{fmtM(refundLedger.totals.refundAmountMinor)}</p>
            {refundLedger.rows.length === 0 ? <p className="text-sm text-slate-400">{dict.commerce.noRefundsInThisPeriod}</p> : (
              <ResponsiveTable table={<div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>{dict.commerce.date}</th><th className={thCls}>{dict.commerce.order}</th><th className={thCls}>{dict.commerce.resolution}</th><th className={thCls}>{dict.commerce.status}</th><th className={thCls}>{dict.commerce.quantity}</th><th className={thCls}>{dict.commerce.fullPartial}</th></tr></thead><tbody>
                {refundLedger.rows.map((r) => (<tr key={r.returnId} className="border-b last:border-0"><td className={tdCls}>{r.date}</td><td className={tdCls}>{r.orderNumber}</td><td className={tdCls}>{refundResolutionLabel(r.resolution)}</td><td className={tdCls}>{r.status}</td><td className={tdCls}>{r.amountKnown && r.amountMinor != null ? fmtM(r.amountMinor) : "—"}</td><td className={tdCls}>{partialFullLabel(r.partialFull)}</td></tr>))}
              </tbody></table></div>} cards={refundLedger.rows.map((r) => (<div key={r.returnId} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.date}</dt><dd className="text-right ">{r.date}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.order}</dt><dd className="text-right ">{r.orderNumber}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.resolution}</dt><dd className="text-right ">{refundResolutionLabel(r.resolution)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.status}</dt><dd className="text-right ">{r.status}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.quantity}</dt><dd className="text-right ">{r.amountKnown && r.amountMinor != null ? fmtM(r.amountMinor) : "—"}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.fullPartial}</dt><dd className="text-right ">{partialFullLabel(r.partialFull)}</dd></div></dl></div>))} />
            )}
          </div>
        ) : null}

        {tab === "expenses" ? (
          <div className="space-y-5">
            <form onSubmit={saveExpense} className="grid grid-cols-1 gap-4 rounded-lg bg-slate-50 p-4 md:grid-cols-3">
              <div><label className={labelCls}>{dict.commerce.category}</label><select className={inputCls} value={expCategory} onChange={(e) => setExpCategory(e.target.value)}>{EXPENSE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
              <div><label className={labelCls}>{dict.commerce.amountTaka}</label><input className={inputCls} type="text" inputMode="decimal" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} placeholder={dict.commerce.eG125050} /></div>
              <div><label className={labelCls}>{dict.commerce.date}</label><input className={inputCls} type="date" value={expSpentAt} onChange={(e) => setExpSpentAt(e.target.value)} /></div>
              <div><label className={labelCls}>{dict.commerce.paymentMethod}</label><select className={inputCls} value={expMethod} onChange={(e) => setExpMethod(e.target.value)}>{EXPENSE_PAYMENT_METHODS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
              <div><label className={labelCls}>{dict.commerce.noteOptional}</label><input className={inputCls} value={expNote} onChange={(e) => setExpNote(e.target.value)} /></div>
              <div><label className={labelCls}>{dict.commerce.receiptLinkOptional}</label><input className={inputCls} value={expReceipt} onChange={(e) => setExpReceipt(e.target.value)} placeholder="https://…" /></div>
              {expMsg ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700 md:col-span-3">{expMsg}</p> : null}
              {expFormError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 md:col-span-3">{dict.commerce.error2}{expFormError}</p> : null}
              <div className="flex gap-2 md:col-span-3">
                <button type="submit" className="btn-primary" disabled={expBusy}>{expBusy ? dict.commerce.saving : editing ? dict.commerce.updateCost : dict.commerce.addCost}</button>
                {editing ? <button type="button" className="btn-secondary" onClick={resetForm}>{dict.common.cancel}</button> : null}
              </div>
              <p className="text-xs text-slate-500 md:col-span-3">{dict.commerce.onlyOWNERADMINCanAdd}</p>
            </form>

            {expError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{expError}</p> : null}
            {expenses && expenses.items.length === 0 ? <p className="text-sm text-slate-400">{dict.commerce.noCostsInThisPeriod}</p> : null}
            {expenses && expenses.items.length > 0 ? (
              <>
                <ResponsiveTable table={<div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>{dict.commerce.date}</th><th className={thCls}>{dict.commerce.category}</th><th className={thCls}>{dict.commerce.quantity}</th><th className={thCls}>{dict.commerce.method}</th><th className={thCls}>{dict.commerce.note}</th><th className={thCls}>{dict.commerce.receipt}</th><th className={thCls}>{dict.commerce.action}</th></tr></thead><tbody>
                  {expenses.items.map((exp) => (<tr key={exp.id} className="border-b last:border-0"><td className={tdCls}>{exp.spentAt}</td><td className={tdCls}>{expenseCategoryLabel(exp.category)}</td><td className={tdCls}>{fmtM(exp.amountMinor)}</td><td className={tdCls}>{expensePaymentMethodLabel(exp.paymentMethod)}</td><td className={tdCls}>{exp.note ?? "—"}</td><td className={tdCls}>{exp.receiptUrl ? <a href={exp.receiptUrl} target="_blank" rel="noreferrer" className="font-semibold text-indigo-600 hover:underline">{dict.commerce.viewReceipt}</a> : "—"}</td><td className={tdCls}>{renderExpenseActions(exp)}</td></tr>))}
                </tbody></table></div>} cards={expenses.items.map((exp) => (<div key={exp.id} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.date}</dt><dd className="text-right ">{exp.spentAt}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.category}</dt><dd className="text-right ">{expenseCategoryLabel(exp.category)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.quantity}</dt><dd className="text-right ">{fmtM(exp.amountMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.method}</dt><dd className="text-right ">{expensePaymentMethodLabel(exp.paymentMethod)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.note}</dt><dd className="text-right ">{exp.note ?? "—"}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.receipt}</dt><dd className="text-right ">{exp.receiptUrl ? <a href={exp.receiptUrl} target="_blank" rel="noreferrer" className="font-semibold text-indigo-600 hover:underline">{dict.commerce.viewReceipt}</a> : "—"}</dd></div></dl><div className="mt-2">{renderExpenseActions(exp)}</div></div>))} />
                <div className="flex items-center gap-2 text-sm">
                  <button type="button" className="btn-secondary" disabled={expPage <= 1} onClick={() => setExpPage((p) => p - 1)}>{dict.commerce.previous}</button>
                  <span>{dict.commerce.page}{expenses.page} {dict.commerce.total2}{expenses.total}{dict.commerce.text1ou8}</span>
                  <button type="button" className="btn-secondary" disabled={expPage * expenses.pageSize >= expenses.total} onClick={() => setExpPage((p) => p + 1)}>{dict.commerce.next}</button>
                </div>
              </>
            ) : null}

            <div className="border-t pt-4">
              <div className="flex flex-wrap items-end gap-3">
                <div><label className={labelCls}>{dict.commerce.month}</label><input className={inputCls} type="month" value={summaryMonth} onChange={(e) => setSummaryMonth(e.target.value)} /></div>
                <button type="button" className="btn-secondary" onClick={() => setSummaryMonth((m) => shiftMonth(m, -1))}>{dict.commerce.previousMonth}</button>
                <button type="button" className="btn-secondary" onClick={() => setSummaryMonth((m) => shiftMonth(m, 1))}>{dict.commerce.nextMonth}</button>
              </div>
              {summary ? (
                <div className="mt-3 space-y-2">
                  <p className="text-sm font-semibold">{formatMonthLabel(summary.month)} {dict.commerce.totalCost}{fmtM(summary.totalMinor)} ({summary.count}{dict.commerce.text1ge21}</p>
                  {summary.byCategory.length === 0 ? <p className="text-sm text-slate-400">{dict.commerce.noCostsThisMonth}</p> : (
                    <ul className="space-y-1 text-sm">{summary.byCategory.map((c) => (<li key={c.category} className="flex justify-between rounded bg-slate-50 px-3 py-2"><span>{expenseCategoryLabel(c.category)} ({c.count}{dict.commerce.text1ge21}</span><span className="font-semibold">{fmtM(c.totalMinor)}</span></li>))}</ul>
                  )}
                </div>
              ) : <p className="mt-3 text-sm text-slate-400">{dict.commerce.monthlySummaryDidNotLoad}</p>}
            </div>
          </div>
        ) : null}
      </div>

      {/* GL export */}
      <div className="card space-y-4 p-5">
        <h2 className="font-semibold">{dict.commerce.exportForTheAccountant}</h2>
        <p className="text-sm font-medium text-slate-700">{dict.commerce.aGeneralDoubleEntryCSV}</p>
        <p className="text-xs text-slate-500">
          {dict.commerce.mappingInBriefSalesDebit}{from} → {to}{dict.commerce.willBeExportedAccordingly}</p>
        {glMsg ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{glMsg}</p> : null}
        {glError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{glError}</p> : null}
        <div className="flex gap-2">
          <button type="button" className="btn-primary" disabled={glBusy} onClick={() => void downloadGl("csv")}>{glBusy ? dict.commerce.creating : dict.commerce.downloadCSV}</button>
          <button type="button" className="btn-secondary" disabled={glBusy} onClick={() => void downloadGl("xlsx")}>{dict.commerce.downloadXLSX}</button>
        </div>
      </div>
    </div>
  );
}
