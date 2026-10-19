"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinorTaka } from "@/lib/storefront-money";
import { ResponsiveTable } from "@repo/ui";

// EC31 — কিস্তি প্ল্যানের due worklist + সব প্ল্যানের তালিকা।
// সংখ্যা সবই InstallmentsService-এর serialized plan / due row
// থেকে আসে — এখানে কোনো হিসাব বানানো হয় না।

interface DueRow {
  planId: string;
  orderId: string;
  orderNumber: string | null;
  customerName: string | null;
  customerPhone: string | null;
  itemId: string;
  seq: number;
  dueDay: string;
  amountMinor: string;
  paidMinor: string;
  remainingMinor: string;
  daysOverdue: number;
}
interface PlanRow {
  id: string;
  orderId: string;
  orderNumber: string | null;
  customerName: string | null;
  customerPhone: string | null;
  totalMinor: string;
  paidMinor: string;
  remainingMinor: string;
  installmentCount: number;
  status: string;
}

const STATUS_LABEL: Record<string, string> = {
  active: "active",
  completed: "complete",
  cancelled: "cancel",
};
const STATUS_CLS: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  completed: "bg-indigo-100 text-indigo-700",
  cancelled: "bg-slate-200 text-slate-600",
};

export default function InstallmentsPage() {
  const { dict, t, locale } = useLocale();
  const [bucket, setBucket] = useState<"today" | "overdue">("today");
  const [dueItems, setDueItems] = useState<DueRow[]>([]);
  const [dueLoading, setDueLoading] = useState(true);
  const [dueError, setDueError] = useState("");

  const [statusFilter, setStatusFilter] = useState("");
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [plansTotal, setPlansTotal] = useState(0);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansError, setPlansError] = useState("");

  const loadDue = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setDueError(dict.commerce.noOrganizationSelected); setDueLoading(false); return; }
    setDueLoading(true);
    try {
      const out = await apiFetch<{ bucket: string; items: DueRow[] }>(`/organizations/${orgId}/installments/due?bucket=${bucket}`);
      setDueItems(out.items ?? []);
      setDueError("");
    } catch (e) {
      setDueError(e instanceof Error ? e.message : dict.commerce.couldNotLoadTheDue);
      setDueItems([]);
    } finally { setDueLoading(false); }
  }, [bucket]);
  useEffect(() => { void loadDue(); }, [loadDue]);

  const loadPlans = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setPlansError(dict.commerce.noOrganizationSelected); setPlansLoading(false); return; }
    setPlansLoading(true);
    try {
      const params = new URLSearchParams({ page: "1", pageSize: "50" });
      if (statusFilter) params.set("status", statusFilter);
      const out = await apiFetch<{ total: number; items: PlanRow[] }>(`/organizations/${orgId}/installments?${params}`);
      setPlans(out.items ?? []);
      setPlansTotal(out.total ?? 0);
      setPlansError("");
    } catch (e) {
      setPlansError(e instanceof Error ? e.message : dict.commerce.couldNotLoadPlans);
      setPlans([]);
    } finally { setPlansLoading(false); }
  }, [statusFilter]);
  useEffect(() => { void loadPlans(); }, [loadPlans]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-slate-900">{dict.commerce.installments}</h1>
          <p className="text-sm text-slate-500">{dict.commerce.installmentPlansBuiltOnOrder}</p>
        </div>
        <Link href="/dashboard/commerce" className="text-sm font-semibold text-indigo-700 hover:underline">← Commerce Hub</Link>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setBucket("today")} className={`inline-flex min-h-[44px] items-center rounded-lg px-3 py-1.5 text-sm font-semibold ${bucket === "today" ? "bg-indigo-600 text-white" : "border bg-white"}`}>{dict.commerce.todaySDues}</button>
          <button type="button" onClick={() => setBucket("overdue")} className={`inline-flex min-h-[44px] items-center rounded-lg px-3 py-1.5 text-sm font-semibold ${bucket === "overdue" ? "bg-indigo-600 text-white" : "border bg-white"}`}>{dict.commerce.elapsed}</button>
        </div>
        {dueError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{dueError}</p> : null}
        <ResponsiveTable
          table={
        <div className="overflow-x-auto rounded-2xl border bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-xs text-slate-600">
                <th className="p-3">{dict.commerce.orderNumber}</th>
                <th className="p-3">{dict.commerce.customer}</th>
                <th className="p-3">{dict.commerce.phone}</th>
                <th className="p-3">{dict.commerce.installment}</th>
                <th className="p-3">{dict.commerce.date}</th>
                <th className="p-3">{dict.commerce.due}</th>
                {bucket === "overdue" ? <th className="p-3">{dict.commerce.daysElapsed}</th> : null}
              </tr>
            </thead>
            <tbody>
              {dueLoading ? (
                <tr><td colSpan={bucket === "overdue" ? 7 : 6} className="p-4 text-slate-500">{dict.common.loading}</td></tr>
              ) : dueItems.length === 0 ? (
                <tr><td colSpan={bucket === "overdue" ? 7 : 6} className="p-4 text-slate-500">{bucket === "today" ? dict.commerce.noInstallmentsDueToday : dict.commerce.noOverdueInstallments}</td></tr>
              ) : dueItems.map((r) => (
                <tr key={r.itemId} className="border-b last:border-0">
                  <td className="p-3 font-medium">#{r.orderNumber ?? r.orderId.slice(0, 8)}</td>
                  <td className="p-3">{r.customerName ?? "—"}</td>
                  <td className="p-3 font-mono text-xs">{r.customerPhone ?? "—"}</td>
                  <td className="p-3">{r.seq}</td>
                  <td className="p-3">{r.dueDay}</td>
                  <td className="p-3 font-semibold">{formatMinorTaka(r.remainingMinor)}</td>
                  {bucket === "overdue" ? <td className="p-3 text-red-600 font-semibold">{r.daysOverdue} {dict.commerce.days}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
          }
          cards={
            dueLoading ? (
              <p className="rounded-2xl border bg-white p-4 text-sm text-slate-500">{dict.common.loading}</p>
            ) : dueItems.length === 0 ? (
              <p className="rounded-2xl border bg-white p-4 text-sm text-slate-500">{bucket === "today" ? dict.commerce.noInstallmentsDueToday : dict.commerce.noOverdueInstallments}</p>
            ) : dueItems.map((r) => (
              <div key={r.itemId} className="rounded-2xl border bg-white p-3 text-sm shadow-sm">
                <dl className="space-y-1.5">
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.orderNumber}</dt><dd className="text-right font-medium">#{r.orderNumber ?? r.orderId.slice(0, 8)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.customer}</dt><dd className="text-right">{r.customerName ?? "—"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.phone}</dt><dd className="text-right font-mono text-xs">{r.customerPhone ?? "—"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.installment}</dt><dd className="text-right">{r.seq}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.date}</dt><dd className="text-right">{r.dueDay}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.due}</dt><dd className="text-right font-semibold">{formatMinorTaka(r.remainingMinor)}</dd></div>
                  {bucket === "overdue" ? <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.daysElapsed}</dt><dd className="text-right font-semibold text-red-600">{r.daysOverdue} {dict.commerce.days}</dd></div> : null}
                </dl>
              </div>
            ))
          }
        />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold text-slate-900">{dict.commerce.allInstallmentPlans}{plansTotal ? t("commerce.text1s95gop", { plansTotal: plansTotal }) : ""}</h2>
          <select aria-label={dict.commerce.filterByPlanStatus} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="min-h-[44px] rounded-xl border border-slate-300 p-2 text-sm">
            <option value="">{dict.commerce.all}</option>
            <option value="active">{dict.commerce.active}</option>
            <option value="completed">{dict.commerce.complete}</option>
            <option value="cancelled">{dict.common.cancel}</option>
          </select>
        </div>
        {plansError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{plansError}</p> : null}
        <ResponsiveTable
          table={
        <div className="overflow-x-auto rounded-2xl border bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-xs text-slate-600">
                <th className="p-3">{dict.commerce.order}</th>
                <th className="p-3">{dict.commerce.customer}</th>
                <th className="p-3">{dict.commerce.total}</th>
                <th className="p-3">{dict.commerce.paid}</th>
                <th className="p-3">{dict.commerce.due}</th>
                <th className="p-3">{dict.commerce.installmentCount}</th>
                <th className="p-3">{dict.commerce.status}</th>
              </tr>
            </thead>
            <tbody>
              {plansLoading ? (
                <tr><td colSpan={7} className="p-4 text-slate-500">{dict.common.loading}</td></tr>
              ) : plans.length === 0 ? (
                <tr><td colSpan={7} className="p-4 text-slate-500">{dict.commerce.noInstallmentPlans}</td></tr>
              ) : plans.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="p-3 font-medium">#{p.orderNumber ?? p.orderId.slice(0, 8)}</td>
                  <td className="p-3">{p.customerName ?? "—"}{p.customerPhone ? <span className="block text-xs text-slate-500">{p.customerPhone}</span> : null}</td>
                  <td className="p-3">{formatMinorTaka(p.totalMinor)}</td>
                  <td className="p-3 text-emerald-700 font-medium">{formatMinorTaka(p.paidMinor)}</td>
                  <td className="p-3 font-semibold">{formatMinorTaka(p.remainingMinor)}</td>
                  <td className="p-3">{p.installmentCount}{dict.commerce.text1ou8}</td>
                  <td className="p-3"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_CLS[p.status] ?? "bg-slate-100 text-slate-600"}`}>{STATUS_LABEL[p.status] ? dict.commerce[STATUS_LABEL[p.status] as keyof typeof dict.commerce] : p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
          }
          cards={
            plansLoading ? (
              <p className="rounded-2xl border bg-white p-4 text-sm text-slate-500">{dict.common.loading}</p>
            ) : plans.length === 0 ? (
              <p className="rounded-2xl border bg-white p-4 text-sm text-slate-500">{dict.commerce.noInstallmentPlans}</p>
            ) : plans.map((p) => (
              <div key={p.id} className="rounded-2xl border bg-white p-3 text-sm shadow-sm">
                <dl className="space-y-1.5">
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.order}</dt><dd className="text-right font-medium">#{p.orderNumber ?? p.orderId.slice(0, 8)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.customer}</dt><dd className="text-right">{p.customerName ?? "—"}{p.customerPhone ? <span className="block text-xs text-slate-500">{p.customerPhone}</span> : null}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.total}</dt><dd className="text-right">{formatMinorTaka(p.totalMinor)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.paid}</dt><dd className="text-right font-medium text-emerald-700">{formatMinorTaka(p.paidMinor)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.due}</dt><dd className="text-right font-semibold">{formatMinorTaka(p.remainingMinor)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.installmentCount}</dt><dd className="text-right">{p.installmentCount}{dict.commerce.text1ou8}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.status}</dt><dd className="text-right"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_CLS[p.status] ?? "bg-slate-100 text-slate-600"}`}>{STATUS_LABEL[p.status] ? dict.commerce[STATUS_LABEL[p.status] as keyof typeof dict.commerce] : p.status}</span></dd></div>
                </dl>
              </div>
            ))
          }
        />
      </section>
    </div>
  );
}
