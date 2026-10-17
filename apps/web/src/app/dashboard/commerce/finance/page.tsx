"use client";
import React, { useCallback, useEffect, useState } from "react";
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
const TABS: { key: Tab; label: string }[] = [
  { key: "accounting", label: "📒 হিসাব (জার্নাল)" },
  { key: "sales", label: "বিক্রি লেজার" },
  { key: "cod", label: "COD বকেয়া" },
  { key: "gateway", label: "গেটওয়ে সেটেলমেন্ট" },
  { key: "courier", label: "কুরিয়ার সেটেলমেন্ট" },
  { key: "refunds", label: "রিফান্ড লেজার" },
  { key: "expenses", label: "খরচ" },
];

export default function FinancePage() {
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
    catch (e) { setError(e instanceof Error ? e.message : "বিক্রি লেজার লোড ব্যর্থ"); }
    finally { setBusy(false); }
  }, [qs]);

  const loadTab = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); return; }
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
    } catch (e) { setError(e instanceof Error ? e.message : "লোড ব্যর্থ"); }
    finally { setBusy(false); }
  }, [tab, qs, loadSales, salesPage]);
  useEffect(() => { void loadTab(); }, [loadTab]);

  const loadExpenses = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      setExpenses(await apiFetch<ExpenseList>(`/organizations/${orgId}/finance/expenses?${qs}&page=${expPage}&pageSize=50`));
      setExpError("");
    } catch (e) { setExpError(e instanceof Error ? e.message : "খরচ লোড ব্যর্থ"); }
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
    if (amountMinor == null) { setExpFormError("পরিমাণ টাকায় সঠিকভাবে দিন (যেমন: 1250.50)"); return; }
    if (!expSpentAt) { setExpFormError("খরচের তারিখ দিন"); return; }
    setExpBusy(true);
    try {
      const body = JSON.stringify({
        category: expCategory, amountMinor, spentAt: expSpentAt,
        note: expNote.trim() || null, paymentMethod: expMethod,
        receiptUrl: expReceipt.trim() || null,
      });
      if (editing) {
        await apiFetch(`/organizations/${orgId}/finance/expenses/${editing.id}`, { method: "PATCH", body });
        setExpMsg("✅ খরচ আপডেট হয়েছে");
      } else {
        await apiFetch(`/organizations/${orgId}/finance/expenses`, { method: "POST", body });
        setExpMsg("✅ খরচ যোগ হয়েছে");
      }
      resetForm();
      await loadExpenses(); await loadSummary();
    } catch (err) { setExpFormError(err instanceof Error ? err.message : "সংরক্ষণ ব্যর্থ হয়েছে"); }
    finally { setExpBusy(false); }
  }

  // EB6/ED13: expense row actions shared verbatim by the desktop
  // table cell and the ResponsiveTable mobile card — same handlers.
  const renderExpenseActions = (exp: Expense) => (
    <span className="flex gap-2"><button type="button" className="btn-secondary inline-flex min-h-[44px] items-center" onClick={() => startEdit(exp)}>সম্পাদনা</button><button type="button" className="btn-secondary inline-flex min-h-[44px] items-center text-red-600" onClick={() => void deleteExpense(exp)}>মুছুন</button></span>
  );

  async function deleteExpense(exp: Expense) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setExpMsg(""); setExpFormError("");
    try {
      await apiFetch(`/organizations/${orgId}/finance/expenses/${exp.id}`, { method: "DELETE" });
      setExpMsg("🗑️ খরচ মুছে ফেলা হয়েছে");
      if (editing?.id === exp.id) resetForm();
      await loadExpenses(); await loadSummary();
    } catch (err) { setExpFormError(err instanceof Error ? err.message : "মুছে ফেলা ব্যর্থ হয়েছে"); }
  }

  async function downloadGl(fmt: "csv" | "xlsx") {
    const orgId = getOrganizationId(); if (!orgId) return;
    setGlMsg(""); setGlError("");
    if (!from || !to) { setGlError("শুরু ও শেষের তারিখ দুটোই দিন"); return; }
    setGlBusy(true);
    try {
      const res = await fetch(
        `${API_URL}/organizations/${orgId}/finance/gl-export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&format=${fmt}`,
        { headers: { Authorization: `Bearer ${getToken() ?? ""}` } },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `ডাউনলোড ব্যর্থ (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `gl-export-${from}-${to}.${fmt}`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setGlMsg(`✅ GL এক্সপোর্ট (${fmt.toUpperCase()}) ডাউনলোড হয়েছে`);
    } catch (err) { setGlError(err instanceof Error ? err.message : "ডাউনলোড ব্যর্থ হয়েছে"); }
    finally { setGlBusy(false); }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <div>
        <h1 className="page-title">💰 ফাইন্যান্স ও লেজার</h1>
        <p className="text-sm text-slate-500">বিক্রি লেজার, COD বকেয়া, গেটওয়ে ও কুরিয়ার সেটেলমেন্ট, রিফান্ড লেজার, খরচ — আর হিসাবরক্ষকের জন্য GL এক্সপোর্ট।</p>
        <p className="mt-1 text-xs text-slate-400"><Link href="/dashboard/commerce/reports" className="font-semibold text-indigo-600 hover:underline">📑 সব রিপোর্ট দেখুন</Link> · <Link href="/dashboard/commerce/ledger" className="font-semibold text-indigo-600 hover:underline">📒 হিসাব ও জার্নাল (ডাবল-এন্ট্রি)</Link></p>
      </div>

      <div className="card space-y-4 p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div><label className={labelCls}>শুরুর তারিখ</label><input className={inputCls} type="date" value={from} onChange={(e) => { setFrom(e.target.value); setSalesPage(1); setExpPage(1); }} /></div>
          <div><label className={labelCls}>শেষের তারিখ</label><input className={inputCls} type="date" value={to} onChange={(e) => { setTo(e.target.value); setSalesPage(1); setExpPage(1); }} /></div>
          <div className="flex items-end"><button type="button" className="btn-primary" disabled={busy} onClick={() => void loadTab()}>{busy ? "লোড হচ্ছে…" : "দেখুন"}</button></div>
        </div>
        <div className="flex flex-wrap gap-2 border-b pb-3">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`inline-flex min-h-[44px] items-center rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === t.key ? "bg-indigo-600 text-white" : "border bg-white"}`}>{t.label}</button>
          ))}
        </div>
        {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        {busy && tab !== "expenses" && tab !== "accounting" ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : null}

        {tab === "accounting" ? <AccountingLite from={from} to={to} /> : null}

        {tab === "sales" && sales ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">বিক্রীত (sold) অর্ডার — delivered/completed অথবা যেকোনো শিপমেন্ট delivered; paid = অনুমোদিত অগ্রিম পেমেন্টের যোগফল, due = মোট − ফেরত − অগ্রিম।</p>
            {sales.rows.length === 0 ? <p className="text-sm text-slate-400">এই সময়ে কোনো বিক্রীত অর্ডার নেই।</p> : (
              <ResponsiveTable table={<div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>তারিখ</th><th className={thCls}>অর্ডার</th><th className={thCls}>ক্রেতা</th><th className={thCls}>অবস্থা</th><th className={thCls}>মোট</th><th className={thCls}>ছাড়</th><th className={thCls}>ডেলিভারি</th><th className={thCls}>কর</th><th className={thCls}>পরিশোধিত</th><th className={thCls}>বকেয়া</th></tr></thead><tbody>
                {sales.rows.map((r) => (<tr key={r.orderId} className="border-b last:border-0"><td className={tdCls}>{r.date}</td><td className={tdCls}>{r.orderNumber}</td><td className={tdCls}>{r.customerName}</td><td className={tdCls}>{r.status}</td><td className={tdCls}>{fmtM(r.totalMinor)}</td><td className={tdCls}>{fmtM(r.discountMinor)}</td><td className={tdCls}>{fmtM(r.deliveryMinor)}</td><td className={tdCls}>{fmtM(r.taxMinor)}</td><td className={tdCls}>{fmtM(r.paidMinor)}</td><td className={tdCls}>{fmtM(r.dueMinor)}</td></tr>))}
                <tr className="bg-slate-50 font-semibold"><td className={tdCls}>মোট ({sales.totals.orders}টি)</td><td className={tdCls} colSpan={3}>—</td><td className={tdCls}>{fmtM(sales.totals.totalMinor)}</td><td className={tdCls}>{fmtM(sales.totals.discountMinor)}</td><td className={tdCls}>{fmtM(sales.totals.deliveryMinor)}</td><td className={tdCls}>{fmtM(sales.totals.taxMinor)}</td><td className={tdCls}>{fmtM(sales.totals.paidMinor)}</td><td className={tdCls}>{fmtM(sales.totals.dueMinor)}</td></tr>
              </tbody></table></div>} cards={<>{sales.rows.map((r) => (<div key={r.orderId} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">তারিখ</dt><dd className="text-right ">{r.date}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">অর্ডার</dt><dd className="text-right ">{r.orderNumber}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">ক্রেতা</dt><dd className="text-right ">{r.customerName}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">অবস্থা</dt><dd className="text-right ">{r.status}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">মোট</dt><dd className="text-right ">{fmtM(r.totalMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">ছাড়</dt><dd className="text-right ">{fmtM(r.discountMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">ডেলিভারি</dt><dd className="text-right ">{fmtM(r.deliveryMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">কর</dt><dd className="text-right ">{fmtM(r.taxMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">পরিশোধিত</dt><dd className="text-right ">{fmtM(r.paidMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">বকেয়া</dt><dd className="text-right ">{fmtM(r.dueMinor)}</dd></div></dl></div>))}<div className="rounded-xl border bg-slate-50 p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">মোট</dt><dd className="text-right ">{sales.totals.orders}টি</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">মোট টাকা</dt><dd className="text-right ">{fmtM(sales.totals.totalMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">ছাড়</dt><dd className="text-right ">{fmtM(sales.totals.discountMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">ডেলিভারি</dt><dd className="text-right ">{fmtM(sales.totals.deliveryMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">কর</dt><dd className="text-right ">{fmtM(sales.totals.taxMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">পরিশোধিত</dt><dd className="text-right ">{fmtM(sales.totals.paidMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">বকেয়া</dt><dd className="text-right ">{fmtM(sales.totals.dueMinor)}</dd></div></dl></div></>} />
            )}
            <div className="flex items-center gap-2 text-sm">
              <button type="button" className="btn-secondary" disabled={salesPage <= 1} onClick={() => setSalesPage((p) => p - 1)}>← আগের</button>
              <span>পেজ {sales.page} · মোট {sales.total}টি</span>
              <button type="button" className="btn-secondary" disabled={salesPage * sales.pageSize >= sales.total} onClick={() => setSalesPage((p) => p + 1)}>পরের →</button>
            </div>
          </div>
        ) : null}

        {tab === "cod" && cod ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">মোট বকেয়া ({cod.outstanding.count}টি)</div><div className="text-lg font-bold">{fmtM(cod.outstanding.totalMinor)}</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">০–৭ দিন ({cod.outstanding.buckets.d0_7.count}টি)</div><div className="text-lg font-bold">{fmtM(cod.outstanding.buckets.d0_7.totalMinor)}</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">৮–৩০ দিন ({cod.outstanding.buckets.d8_30.count}টি)</div><div className="text-lg font-bold">{fmtM(cod.outstanding.buckets.d8_30.totalMinor)}</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">৩১+ দিন ({cod.outstanding.buckets.d31plus.count}টি)</div><div className="text-lg font-bold text-rose-700">{fmtM(cod.outstanding.buckets.d31plus.totalMinor)}</div></div>
            </div>
            {cod.outstanding.truncated ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">তালিকাটি সীমিত — সব বকেয়া অর্ডার দেখানো হয়নি; মোট হিসাব সব মিলিয়েই করা।</p> : null}
            {cod.outstanding.rows.length === 0 ? <p className="text-sm text-slate-400">কোনো COD বকেয়া নেই।</p> : (
              <ResponsiveTable table={<div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>অর্ডার</th><th className={thCls}>ক্রেতা</th><th className={thCls}>তারিখ</th><th className={thCls}>মোট</th><th className={thCls}>বকেয়া</th><th className={thCls}>বয়স</th></tr></thead><tbody>
                {cod.outstanding.rows.map((r) => (<tr key={r.orderId} className="border-b last:border-0"><td className={tdCls}>{r.orderNumber}</td><td className={tdCls}>{r.customerName}</td><td className={tdCls}>{r.date}</td><td className={tdCls}>{fmtM(r.totalMinor)}</td><td className={tdCls}>{fmtM(r.dueMinor)}</td><td className={tdCls}>{r.ageDays} দিন</td></tr>))}
              </tbody></table></div>} cards={cod.outstanding.rows.map((r) => (<div key={r.orderId} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">অর্ডার</dt><dd className="text-right ">{r.orderNumber}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">ক্রেতা</dt><dd className="text-right ">{r.customerName}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">তারিখ</dt><dd className="text-right ">{r.date}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">মোট</dt><dd className="text-right ">{fmtM(r.totalMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">বকেয়া</dt><dd className="text-right ">{fmtM(r.dueMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">বয়স</dt><dd className="text-right ">{r.ageDays} দিন</dd></div></dl></div>))} />
            )}
            <div>
              <h3 className="font-semibold">সংগ্রহ (Collections) — {cod.collections.count}টি, মোট {fmtM(cod.collections.totalMinor)}</h3>
              {cod.collections.rows.length === 0 ? <p className="mt-2 text-sm text-slate-400">এই সময়ে কোনো সংগ্রহ নেই।</p> : (
                <ResponsiveTable table={<div className="mt-2 overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>তারিখ</th><th className={thCls}>অর্ডার</th><th className={thCls}>কুরিয়ার</th><th className={thCls}>পরিমাণ</th></tr></thead><tbody>
                  {cod.collections.rows.map((r, i) => (<tr key={`${r.orderId}-${i}`} className="border-b last:border-0"><td className={tdCls}>{r.date}</td><td className={tdCls}>{r.orderNumber}</td><td className={tdCls}>{r.provider}</td><td className={tdCls}>{fmtM(r.amountMinor)}</td></tr>))}
                </tbody></table></div>} cards={cod.collections.rows.map((r, i) => (<div key={`${r.orderId}-${i}`} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">তারিখ</dt><dd className="text-right ">{r.date}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">অর্ডার</dt><dd className="text-right ">{r.orderNumber}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">কুরিয়ার</dt><dd className="text-right ">{r.provider}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">পরিমাণ</dt><dd className="text-right ">{fmtM(r.amountMinor)}</dd></div></dl></div>))} />
              )}
            </div>
          </div>
        ) : null}

        {tab === "gateway" ? (
          <div className="space-y-4">
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">এটি কর ও হিসাব (Accounting) পেজের গেটওয়ে ফি ও সেটেলমেন্ট ভিউয়ের একই হিসাব — একই এন্ডপয়েন্ট থেকে আসে।</p>
            {feeRows && feeRows.length === 0 ? <p className="text-sm text-slate-400">এই সময়ে কোনো যাচাইকৃত অনলাইন পেমেন্ট নেই।</p> : null}
            {feeRows && feeRows.length > 0 ? (
              <ResponsiveTable table={<div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>প্রোভাইডার</th><th className={thCls}>উৎস</th><th className={thCls}>পেমেন্ট সংখ্যা</th><th className={thCls}>মোট (গ্রস)</th><th className={thCls}>ফি</th><th className={thCls}>নেট</th></tr></thead><tbody>
                {feeRows.map((r) => (<tr key={`${r.provider}-${r.source}`} className="border-b last:border-0"><td className={tdCls}>{r.provider}</td><td className={tdCls}>{r.source === "platform" ? "প্ল্যাটফর্ম" : "নিজের"}</td><td className={tdCls}>{r.count}টি</td><td className={tdCls}>{fmtM(r.grossMinor)}</td><td className={tdCls}>{r.feeMinor != null ? fmtM(r.feeMinor) : <span className="font-semibold text-amber-700">ফি হার সেট করা হয়নি</span>}</td><td className={tdCls}>{r.netMinor != null ? fmtM(r.netMinor) : "—"}</td></tr>))}
              </tbody></table></div>} cards={feeRows.map((r) => (<div key={`${r.provider}-${r.source}`} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">প্রোভাইডার</dt><dd className="text-right ">{r.provider}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">উৎস</dt><dd className="text-right ">{r.source === "platform" ? "প্ল্যাটফর্ম" : "নিজের"}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">পেমেন্ট সংখ্যা</dt><dd className="text-right ">{r.count}টি</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">মোট (গ্রস)</dt><dd className="text-right ">{fmtM(r.grossMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">ফি</dt><dd className="text-right ">{r.feeMinor != null ? fmtM(r.feeMinor) : <span className="font-semibold text-amber-700">ফি হার সেট করা হয়নি</span>}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">নেট</dt><dd className="text-right ">{r.netMinor != null ? fmtM(r.netMinor) : "—"}</dd></div></dl></div>))} />
            ) : null}
            <h3 className="text-sm font-semibold">প্রত্যাশিত settlement (নিজের গেটওয়ে, দিন অনুযায়ী)</h3>
            {settlementRows && settlementRows.length === 0 ? <p className="text-sm text-slate-400">এই সময়ে নিজের গেটওয়েতে কোনো settlement নেই।</p> : null}
            {settlementRows && settlementRows.length > 0 ? (
              <ResponsiveTable table={<div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>দিন</th><th className={thCls}>প্রোভাইডার</th><th className={thCls}>পেমেন্ট সংখ্যা</th><th className={thCls}>মোট (গ্রস)</th><th className={thCls}>ফি</th><th className={thCls}>নেট</th></tr></thead><tbody>
                {settlementRows.map((r) => (<tr key={`${r.day}-${r.provider}`} className="border-b last:border-0"><td className={tdCls}>{r.day}</td><td className={tdCls}>{r.provider}</td><td className={tdCls}>{r.count}টি</td><td className={tdCls}>{fmtM(r.grossMinor)}</td><td className={tdCls}>{r.feeMinor != null ? fmtM(r.feeMinor) : <span className="font-semibold text-amber-700">ফি হার সেট করা হয়নি</span>}</td><td className={tdCls}>{r.netMinor != null ? fmtM(r.netMinor) : "—"}</td></tr>))}
              </tbody></table></div>} cards={settlementRows.map((r) => (<div key={`${r.day}-${r.provider}`} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">দিন</dt><dd className="text-right ">{r.day}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">প্রোভাইডার</dt><dd className="text-right ">{r.provider}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">পেমেন্ট সংখ্যা</dt><dd className="text-right ">{r.count}টি</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">মোট (গ্রস)</dt><dd className="text-right ">{fmtM(r.grossMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">ফি</dt><dd className="text-right ">{r.feeMinor != null ? fmtM(r.feeMinor) : <span className="font-semibold text-amber-700">ফি হার সেট করা হয়নি</span>}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">নেট</dt><dd className="text-right ">{r.netMinor != null ? fmtM(r.netMinor) : "—"}</dd></div></dl></div>))} />
            ) : null}
          </div>
        ) : null}

        {tab === "courier" && courier ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">ইমপোর্ট</div><div className="text-lg font-bold">{courier.totals.imports}টি</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">লাইন / মিলেছে</div><div className="text-lg font-bold">{courier.totals.lines} / {courier.totals.matched}</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">অমিল</div><div className="text-lg font-bold">{courier.totals.mismatches}টি</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">অমিলের মোট পার্থক্য</div><div className="text-lg font-bold">{fmtSigned(courier.totals.mismatchDeltaMinor)}</div></div>
            </div>
            {courier.imports.length === 0 ? <p className="text-sm text-slate-400">এই সময়ে কোনো কুরিয়ার সেটেলমেন্ট ইমপোর্ট নেই।</p> : (
              <ResponsiveTable table={<div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>তারিখ</th><th className={thCls}>কুরিয়ার</th><th className={thCls}>ফাইল</th><th className={thCls}>সারি</th><th className={thCls}>মিলেছে</th><th className={thCls}>অমিল</th><th className={thCls}>পার্থক্য</th><th className={thCls}>অবস্থা</th></tr></thead><tbody>
                {courier.imports.map((r) => (<tr key={r.id} className="border-b last:border-0"><td className={tdCls}>{r.date}</td><td className={tdCls}>{r.provider}</td><td className={tdCls}>{r.fileName}</td><td className={tdCls}>{r.rowCount}</td><td className={tdCls}>{r.matchedCount}</td><td className={tdCls}>{r.mismatchCount}</td><td className={tdCls}>{fmtSigned(r.mismatchDeltaMinor)}</td><td className={tdCls}>{r.status}</td></tr>))}
              </tbody></table></div>} cards={courier.imports.map((r) => (<div key={r.id} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">তারিখ</dt><dd className="text-right ">{r.date}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">কুরিয়ার</dt><dd className="text-right ">{r.provider}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">ফাইল</dt><dd className="text-right ">{r.fileName}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">সারি</dt><dd className="text-right ">{r.rowCount}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">মিলেছে</dt><dd className="text-right ">{r.matchedCount}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">অমিল</dt><dd className="text-right ">{r.mismatchCount}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">পার্থক্য</dt><dd className="text-right ">{fmtSigned(r.mismatchDeltaMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">অবস্থা</dt><dd className="text-right ">{r.status}</dd></div></dl></div>))} />
            )}
            <div>
              <h3 className="font-semibold">অমিলের বিবরণ {mismatches ? `— ${mismatches.totals.count}টি, মোট পার্থক্য ${fmtSigned(mismatches.totals.deltaMinor)}` : ""}</h3>
              {mismatches && mismatches.rows.length === 0 ? <p className="mt-2 text-sm text-slate-400">কোনো অমিল নেই।</p> : null}
              {mismatches && mismatches.rows.length > 0 ? (
                <ResponsiveTable table={<div className="mt-2 overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>ইমপোর্ট তারিখ</th><th className={thCls}>কুরিয়ার</th><th className={thCls}>সারি</th><th className={thCls}>ট্র্যাকিং</th><th className={thCls}>অর্ডার</th><th className={thCls}>প্রত্যাশিত</th><th className={thCls}>শিটে আছে</th><th className={thCls}>পার্থক্য</th></tr></thead><tbody>
                  {mismatches.rows.map((r, i) => (<tr key={`${r.importId}-${r.rowNumber}-${i}`} className="border-b last:border-0"><td className={tdCls}>{r.importDate}</td><td className={tdCls}>{r.provider}</td><td className={tdCls}>{r.rowNumber}</td><td className={tdCls}>{r.trackingId}</td><td className={tdCls}>{r.orderNumber || r.orderRef}</td><td className={tdCls}>{fmtM(r.expectedMinor)}</td><td className={tdCls}>{fmtM(r.sheetAmountMinor)}</td><td className={tdCls}>{fmtSigned(r.deltaMinor)}</td></tr>))}
                </tbody></table></div>} cards={mismatches.rows.map((r, i) => (<div key={`${r.importId}-${r.rowNumber}-${i}`} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">ইমপোর্ট তারিখ</dt><dd className="text-right ">{r.importDate}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">কুরিয়ার</dt><dd className="text-right ">{r.provider}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">সারি</dt><dd className="text-right ">{r.rowNumber}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">ট্র্যাকিং</dt><dd className="text-right ">{r.trackingId}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">অর্ডার</dt><dd className="text-right ">{r.orderNumber || r.orderRef}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">প্রত্যাশিত</dt><dd className="text-right ">{fmtM(r.expectedMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">শিটে আছে</dt><dd className="text-right ">{fmtM(r.sheetAmountMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">পার্থক্য</dt><dd className="text-right ">{fmtSigned(r.deltaMinor)}</dd></div></dl></div>))} />
              ) : null}
            </div>
          </div>
        ) : null}

        {tab === "refunds" && refundLedger ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">মোট {refundLedger.totals.count}টি · টাকা ফেরতের মোট (জানা পরিমাণ): {fmtM(refundLedger.totals.refundAmountMinor)}</p>
            {refundLedger.rows.length === 0 ? <p className="text-sm text-slate-400">এই সময়ে কোনো রিফান্ড নেই।</p> : (
              <ResponsiveTable table={<div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>তারিখ</th><th className={thCls}>অর্ডার</th><th className={thCls}>সমাধান</th><th className={thCls}>অবস্থা</th><th className={thCls}>পরিমাণ</th><th className={thCls}>পূর্ণ/আংশিক</th></tr></thead><tbody>
                {refundLedger.rows.map((r) => (<tr key={r.returnId} className="border-b last:border-0"><td className={tdCls}>{r.date}</td><td className={tdCls}>{r.orderNumber}</td><td className={tdCls}>{refundResolutionLabel(r.resolution)}</td><td className={tdCls}>{r.status}</td><td className={tdCls}>{r.amountKnown && r.amountMinor != null ? fmtM(r.amountMinor) : "—"}</td><td className={tdCls}>{partialFullLabel(r.partialFull)}</td></tr>))}
              </tbody></table></div>} cards={refundLedger.rows.map((r) => (<div key={r.returnId} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">তারিখ</dt><dd className="text-right ">{r.date}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">অর্ডার</dt><dd className="text-right ">{r.orderNumber}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">সমাধান</dt><dd className="text-right ">{refundResolutionLabel(r.resolution)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">অবস্থা</dt><dd className="text-right ">{r.status}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">পরিমাণ</dt><dd className="text-right ">{r.amountKnown && r.amountMinor != null ? fmtM(r.amountMinor) : "—"}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">পূর্ণ/আংশিক</dt><dd className="text-right ">{partialFullLabel(r.partialFull)}</dd></div></dl></div>))} />
            )}
          </div>
        ) : null}

        {tab === "expenses" ? (
          <div className="space-y-5">
            <form onSubmit={saveExpense} className="grid grid-cols-1 gap-4 rounded-lg bg-slate-50 p-4 md:grid-cols-3">
              <div><label className={labelCls}>ক্যাটাগরি</label><select className={inputCls} value={expCategory} onChange={(e) => setExpCategory(e.target.value)}>{EXPENSE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
              <div><label className={labelCls}>পরিমাণ (টাকা)</label><input className={inputCls} type="text" inputMode="decimal" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} placeholder="যেমন: 1250.50" /></div>
              <div><label className={labelCls}>তারিখ</label><input className={inputCls} type="date" value={expSpentAt} onChange={(e) => setExpSpentAt(e.target.value)} /></div>
              <div><label className={labelCls}>পেমেন্ট পদ্ধতি</label><select className={inputCls} value={expMethod} onChange={(e) => setExpMethod(e.target.value)}>{EXPENSE_PAYMENT_METHODS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
              <div><label className={labelCls}>নোট (ঐচ্ছিক)</label><input className={inputCls} value={expNote} onChange={(e) => setExpNote(e.target.value)} /></div>
              <div><label className={labelCls}>রসিদের লিংক (ঐচ্ছিক)</label><input className={inputCls} value={expReceipt} onChange={(e) => setExpReceipt(e.target.value)} placeholder="https://…" /></div>
              {expMsg ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700 md:col-span-3">{expMsg}</p> : null}
              {expFormError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 md:col-span-3">ত্রুটি: {expFormError}</p> : null}
              <div className="flex gap-2 md:col-span-3">
                <button type="submit" className="btn-primary" disabled={expBusy}>{expBusy ? "সংরক্ষণ হচ্ছে…" : editing ? "খরচ আপডেট করুন" : "খরচ যোগ করুন"}</button>
                {editing ? <button type="button" className="btn-secondary" onClick={resetForm}>বাতিল</button> : null}
              </div>
              <p className="text-xs text-slate-500 md:col-span-3">খরচ যোগ/সম্পাদনা/মুছে ফেলা শুধু OWNER/ADMIN করতে পারেন — সার্ভারের ত্রুটির বার্তা হুবহু উপরে দেখানো হয়।</p>
            </form>

            {expError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{expError}</p> : null}
            {expenses && expenses.items.length === 0 ? <p className="text-sm text-slate-400">এই সময়ে কোনো খরচ নেই।</p> : null}
            {expenses && expenses.items.length > 0 ? (
              <>
                <ResponsiveTable table={<div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>তারিখ</th><th className={thCls}>ক্যাটাগরি</th><th className={thCls}>পরিমাণ</th><th className={thCls}>পদ্ধতি</th><th className={thCls}>নোট</th><th className={thCls}>রসিদ</th><th className={thCls}>অ্যাকশন</th></tr></thead><tbody>
                  {expenses.items.map((exp) => (<tr key={exp.id} className="border-b last:border-0"><td className={tdCls}>{exp.spentAt}</td><td className={tdCls}>{expenseCategoryLabel(exp.category)}</td><td className={tdCls}>{fmtM(exp.amountMinor)}</td><td className={tdCls}>{expensePaymentMethodLabel(exp.paymentMethod)}</td><td className={tdCls}>{exp.note ?? "—"}</td><td className={tdCls}>{exp.receiptUrl ? <a href={exp.receiptUrl} target="_blank" rel="noreferrer" className="font-semibold text-indigo-600 hover:underline">রসিদ দেখুন</a> : "—"}</td><td className={tdCls}>{renderExpenseActions(exp)}</td></tr>))}
                </tbody></table></div>} cards={expenses.items.map((exp) => (<div key={exp.id} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">তারিখ</dt><dd className="text-right ">{exp.spentAt}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">ক্যাটাগরি</dt><dd className="text-right ">{expenseCategoryLabel(exp.category)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">পরিমাণ</dt><dd className="text-right ">{fmtM(exp.amountMinor)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">পদ্ধতি</dt><dd className="text-right ">{expensePaymentMethodLabel(exp.paymentMethod)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">নোট</dt><dd className="text-right ">{exp.note ?? "—"}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">রসিদ</dt><dd className="text-right ">{exp.receiptUrl ? <a href={exp.receiptUrl} target="_blank" rel="noreferrer" className="font-semibold text-indigo-600 hover:underline">রসিদ দেখুন</a> : "—"}</dd></div></dl><div className="mt-2">{renderExpenseActions(exp)}</div></div>))} />
                <div className="flex items-center gap-2 text-sm">
                  <button type="button" className="btn-secondary" disabled={expPage <= 1} onClick={() => setExpPage((p) => p - 1)}>← আগের</button>
                  <span>পেজ {expenses.page} · মোট {expenses.total}টি</span>
                  <button type="button" className="btn-secondary" disabled={expPage * expenses.pageSize >= expenses.total} onClick={() => setExpPage((p) => p + 1)}>পরের →</button>
                </div>
              </>
            ) : null}

            <div className="border-t pt-4">
              <div className="flex flex-wrap items-end gap-3">
                <div><label className={labelCls}>মাস</label><input className={inputCls} type="month" value={summaryMonth} onChange={(e) => setSummaryMonth(e.target.value)} /></div>
                <button type="button" className="btn-secondary" onClick={() => setSummaryMonth((m) => shiftMonth(m, -1))}>← আগের মাস</button>
                <button type="button" className="btn-secondary" onClick={() => setSummaryMonth((m) => shiftMonth(m, 1))}>পরের মাস →</button>
              </div>
              {summary ? (
                <div className="mt-3 space-y-2">
                  <p className="text-sm font-semibold">{formatMonthLabel(summary.month)} — মোট খরচ {fmtM(summary.totalMinor)} ({summary.count}টি)</p>
                  {summary.byCategory.length === 0 ? <p className="text-sm text-slate-400">এই মাসে কোনো খরচ নেই।</p> : (
                    <ul className="space-y-1 text-sm">{summary.byCategory.map((c) => (<li key={c.category} className="flex justify-between rounded bg-slate-50 px-3 py-2"><span>{expenseCategoryLabel(c.category)} ({c.count}টি)</span><span className="font-semibold">{fmtM(c.totalMinor)}</span></li>))}</ul>
                  )}
                </div>
              ) : <p className="mt-3 text-sm text-slate-400">মাসিক সারাংশ লোড হয়নি।</p>}
            </div>
          </div>
        ) : null}
      </div>

      {/* GL export */}
      <div className="card space-y-4 p-5">
        <h2 className="font-semibold">🧾 হিসাবরক্ষকের জন্য এক্সপোর্ট</h2>
        <p className="text-sm font-medium text-slate-700">সাধারণ ডাবল-এন্ট্রি CSV — Tally/QuickBooks-এ import-এর আগে আপনার হিসাবরক্ষকের সঙ্গে মিলিয়ে নিন</p>
        <p className="text-xs text-slate-500">
          ম্যাপিং সংক্ষেপে: বিক্রি: ডেবিট COD Receivable/Gateway Clearing/Cash, ক্রেডিট Sales; ডেলিভারি আয়, ছাড়, গেটওয়ে ফি, খরচ, রিফান্ড — প্রতিটির আলাদা সারি।
          উপরের তারিখ-পরিসর ({from} → {to}) অনুযায়ী এক্সপোর্ট হবে।
        </p>
        {glMsg ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{glMsg}</p> : null}
        {glError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{glError}</p> : null}
        <div className="flex gap-2">
          <button type="button" className="btn-primary" disabled={glBusy} onClick={() => void downloadGl("csv")}>{glBusy ? "তৈরি হচ্ছে…" : "CSV ডাউনলোড"}</button>
          <button type="button" className="btn-secondary" disabled={glBusy} onClick={() => void downloadGl("xlsx")}>XLSX ডাউনলোড</button>
        </div>
      </div>
    </div>
  );
}
