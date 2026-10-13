"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinorTaka } from "@/lib/storefront-money";

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
  active: "সক্রিয়",
  completed: "সম্পূর্ণ",
  cancelled: "বাতিল",
};
const STATUS_CLS: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  completed: "bg-indigo-100 text-indigo-700",
  cancelled: "bg-slate-200 text-slate-600",
};

export default function InstallmentsPage() {
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
    if (!orgId) { setDueError("কোনো Organization নির্বাচিত নেই।"); setDueLoading(false); return; }
    setDueLoading(true);
    try {
      const out = await apiFetch<{ bucket: string; items: DueRow[] }>(`/organizations/${orgId}/installments/due?bucket=${bucket}`);
      setDueItems(out.items ?? []);
      setDueError("");
    } catch (e) {
      setDueError(e instanceof Error ? e.message : "due তালিকা লোড করা যায়নি");
      setDueItems([]);
    } finally { setDueLoading(false); }
  }, [bucket]);
  useEffect(() => { void loadDue(); }, [loadDue]);

  const loadPlans = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setPlansError("কোনো Organization নির্বাচিত নেই।"); setPlansLoading(false); return; }
    setPlansLoading(true);
    try {
      const params = new URLSearchParams({ page: "1", pageSize: "50" });
      if (statusFilter) params.set("status", statusFilter);
      const out = await apiFetch<{ total: number; items: PlanRow[] }>(`/organizations/${orgId}/installments?${params}`);
      setPlans(out.items ?? []);
      setPlansTotal(out.total ?? 0);
      setPlansError("");
    } catch (e) {
      setPlansError(e instanceof Error ? e.message : "প্ল্যান লোড করা যায়নি");
      setPlans([]);
    } finally { setPlansLoading(false); }
  }, [statusFilter]);
  useEffect(() => { void loadPlans(); }, [loadPlans]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-slate-900">💰 কিস্তি / Installments</h1>
          <p className="text-sm text-slate-500">অর্ডারের বকেয়ার উপর তৈরি কিস্তি প্ল্যান — আজকের due আর অতিবাহিত কিস্তির worklist, নিচে সব প্ল্যান। সংগ্রহ অর্ডারের বিস্তারিত প্যানেল থেকে করা হয়।</p>
        </div>
        <Link href="/dashboard/commerce" className="text-sm font-semibold text-indigo-700 hover:underline">← Commerce Hub</Link>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setBucket("today")} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${bucket === "today" ? "bg-indigo-600 text-white" : "border bg-white"}`}>আজকের due</button>
          <button type="button" onClick={() => setBucket("overdue")} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${bucket === "overdue" ? "bg-indigo-600 text-white" : "border bg-white"}`}>অতিবাহিত</button>
        </div>
        {dueError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{dueError}</p> : null}
        <div className="overflow-x-auto rounded-2xl border bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-xs text-slate-600">
                <th className="p-3">অর্ডার নম্বর</th>
                <th className="p-3">গ্রাহক</th>
                <th className="p-3">ফোন</th>
                <th className="p-3">কিস্তি #</th>
                <th className="p-3">তারিখ</th>
                <th className="p-3">বাকি</th>
                {bucket === "overdue" ? <th className="p-3">অতিবাহিত দিন</th> : null}
              </tr>
            </thead>
            <tbody>
              {dueLoading ? (
                <tr><td colSpan={bucket === "overdue" ? 7 : 6} className="p-4 text-slate-500">লোড হচ্ছে…</td></tr>
              ) : dueItems.length === 0 ? (
                <tr><td colSpan={bucket === "overdue" ? 7 : 6} className="p-4 text-slate-500">{bucket === "today" ? "আজ কোনো কিস্তি due নেই" : "কোনো অতিবাহিত কিস্তি নেই"}</td></tr>
              ) : dueItems.map((r) => (
                <tr key={r.itemId} className="border-b last:border-0">
                  <td className="p-3 font-medium">#{r.orderNumber ?? r.orderId.slice(0, 8)}</td>
                  <td className="p-3">{r.customerName ?? "—"}</td>
                  <td className="p-3 font-mono text-xs">{r.customerPhone ?? "—"}</td>
                  <td className="p-3">{r.seq}</td>
                  <td className="p-3">{r.dueDay}</td>
                  <td className="p-3 font-semibold">{formatMinorTaka(r.remainingMinor)}</td>
                  {bucket === "overdue" ? <td className="p-3 text-red-600 font-semibold">{r.daysOverdue} দিন</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold text-slate-900">সব কিস্তি প্ল্যান{plansTotal ? ` (${plansTotal}টি)` : ""}</h2>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-xl border border-slate-300 p-2 text-sm">
            <option value="">সব</option>
            <option value="active">সক্রিয়</option>
            <option value="completed">সম্পূর্ণ</option>
            <option value="cancelled">বাতিল</option>
          </select>
        </div>
        {plansError ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{plansError}</p> : null}
        <div className="overflow-x-auto rounded-2xl border bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-xs text-slate-600">
                <th className="p-3">অর্ডার</th>
                <th className="p-3">গ্রাহক</th>
                <th className="p-3">মোট</th>
                <th className="p-3">পরিশোধিত</th>
                <th className="p-3">বাকি</th>
                <th className="p-3">কিস্তি সংখ্যা</th>
                <th className="p-3">অবস্থা</th>
              </tr>
            </thead>
            <tbody>
              {plansLoading ? (
                <tr><td colSpan={7} className="p-4 text-slate-500">লোড হচ্ছে…</td></tr>
              ) : plans.length === 0 ? (
                <tr><td colSpan={7} className="p-4 text-slate-500">কোনো কিস্তি প্ল্যান নেই</td></tr>
              ) : plans.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="p-3 font-medium">#{p.orderNumber ?? p.orderId.slice(0, 8)}</td>
                  <td className="p-3">{p.customerName ?? "—"}{p.customerPhone ? <span className="block text-xs text-slate-500">{p.customerPhone}</span> : null}</td>
                  <td className="p-3">{formatMinorTaka(p.totalMinor)}</td>
                  <td className="p-3 text-emerald-700 font-medium">{formatMinorTaka(p.paidMinor)}</td>
                  <td className="p-3 font-semibold">{formatMinorTaka(p.remainingMinor)}</td>
                  <td className="p-3">{p.installmentCount}টি</td>
                  <td className="p-3"><span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_CLS[p.status] ?? "bg-slate-100 text-slate-600"}`}>{STATUS_LABEL[p.status] ?? p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
