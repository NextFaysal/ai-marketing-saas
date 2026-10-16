"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  REPORT_TYPES,
  SCHEDULED_REPORT_TYPES,
  cadenceLabel,
  reportTypeLabel,
  scheduledRunStatusLabel,
  type ScheduledReport,
  type ScheduledReportRun,
} from "@/lib/finance-gb8";

// GB8 / GC19 — Reports hub: index of every commerce report +
// the scheduled-reports manager. This page is an index, not a
// re-render of any single report.

const EXTRA_CARDS: { href: string; title: string; description: string }[] = [
  { href: "/dashboard/commerce/promotions", title: "প্রমোশন রিপোর্ট", description: "প্রমোশনের পারফরম্যান্স ও প্রয়োগের হিসাব" },
  { href: "/dashboard/commerce/accounting", title: "গেটওয়ে ফি রিপোর্ট + সেটেলমেন্ট", description: "যাচাইকৃত অনলাইন পেমেন্টে গেটওয়ে ফি ও প্রত্যাশিত সেটেলমেন্ট (কর ও হিসাব পেজে)" },
  { href: "/dashboard/commerce/accounting", title: "লাভের রিপোর্ট (ON7)", description: "পণ্যের খরচ বাদ দিয়ে লাভের হিসাব (কর ও হিসাব পেজে)" },
  { href: "/dashboard/orders", title: "অর্ডার অ্যানালিটিক্স (ON9)", description: "অর্ডারের সার্বিক বিশ্লেষণ (অর্ডার পেজে)" },
  { href: "/dashboard/commerce/finance", title: "ফাইন্যান্স ও লেজার", description: "বিক্রি লেজার, COD বকেয়া, সেটেলমেন্ট, রিফান্ড লেজার ও খরচ" },
  { href: "/dashboard/commerce/gift-cards", title: "গিফট কার্ডের দায় (Liability)", description: "বকেয়া গিফট কার্ড ব্যালেন্স ও সময়কালের ইস্যু/রিডিম/মেয়াদোত্তীর্ণ হিসাব (গিফট কার্ড পেজে)" },
];

export default function ReportsHubPage() {
  const [items, setItems] = useState<ScheduledReport[] | null>(null);
  const [listError, setListError] = useState("");
  const [busy, setBusy] = useState(false);

  const [reportType, setReportType] = useState("discounts");
  const [cadence, setCadence] = useState("weekly");
  const [format, setFormat] = useState("csv");
  const [recipients, setRecipients] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [createMsg, setCreateMsg] = useState("");
  const [createError, setCreateError] = useState("");

  const [actionMsg, setActionMsg] = useState("");
  const [actionError, setActionError] = useState("");
  const [runsById, setRunsById] = useState<Record<string, ScheduledReportRun[]>>({});
  const [runsError, setRunsError] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setListError("কোনো Organization নির্বাচিত নেই।"); return; }
    try {
      const r = await apiFetch<{ items: ScheduledReport[] }>(`/organizations/${orgId}/finance/scheduled-reports`);
      setItems(r.items ?? []);
      setListError("");
    } catch (e) { setListError(e instanceof Error ? e.message : "নির্ধারিত রিপোর্ট লোড ব্যর্থ"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setCreateMsg(""); setCreateError("");
    const emails = recipients.split(",").map((s) => s.trim()).filter(Boolean);
    if (emails.length === 0) { setCreateError("অন্তত একটি ইমেইল ঠিকানা দিন"); return; }
    setBusy(true);
    try {
      await apiFetch(`/organizations/${orgId}/finance/scheduled-reports`, {
        method: "POST",
        body: JSON.stringify({ reportType, cadence, format, recipients: emails, enabled }),
      });
      setCreateMsg("✅ নির্ধারিত রিপোর্ট তৈরি হয়েছে");
      setRecipients("");
      await load();
    } catch (err) { setCreateError(err instanceof Error ? err.message : "তৈরি ব্যর্থ হয়েছে"); }
    finally { setBusy(false); }
  }

  async function toggle(item: ScheduledReport) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setActionMsg(""); setActionError("");
    try {
      await apiFetch(`/organizations/${orgId}/finance/scheduled-reports/${item.id}`, {
        method: "PATCH", body: JSON.stringify({ enabled: !item.enabled }),
      });
      await load();
    } catch (err) { setActionError(err instanceof Error ? err.message : "আপডেট ব্যর্থ হয়েছে"); }
  }

  async function remove(item: ScheduledReport) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setActionMsg(""); setActionError("");
    try {
      await apiFetch(`/organizations/${orgId}/finance/scheduled-reports/${item.id}`, { method: "DELETE" });
      setActionMsg("🗑️ নির্ধারিত রিপোর্ট মুছে ফেলা হয়েছে");
      await load();
    } catch (err) { setActionError(err instanceof Error ? err.message : "মুছে ফেলা ব্যর্থ হয়েছে"); }
  }

  async function sendNow(item: ScheduledReport) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setActionMsg(""); setActionError("");
    try {
      const run = await apiFetch<ScheduledReportRun>(`/organizations/${orgId}/finance/scheduled-reports/${item.id}/send-now`, { method: "POST" });
      setActionMsg(`এখনই পাঠানোর ফলাফল: ${scheduledRunStatusLabel(run.status)}${run.periodLabel ? ` (${run.periodLabel})` : ""}`);
      await loadRuns(item.id);
      await load();
    } catch (err) { setActionError(err instanceof Error ? err.message : "পাঠানো ব্যর্থ হয়েছে"); }
  }

  async function loadRuns(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setRunsError("");
    try {
      const r = await apiFetch<{ items: ScheduledReportRun[] }>(`/organizations/${orgId}/finance/scheduled-reports/${id}/runs`);
      setRunsById((prev) => ({ ...prev, [id]: r.items ?? [] }));
    } catch (err) { setRunsError(err instanceof Error ? err.message : "ইতিহাস লোড ব্যর্থ"); }
  }

  const inputCls = "w-full rounded-lg border px-3 py-2 text-sm";
  const labelCls = "mb-1 block text-xs font-semibold text-slate-700";

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <div>
        <h1 className="page-title">📑 রিপোর্ট</h1>
        <p className="text-sm text-slate-500">বিক্রি, ছাড়, রিফান্ড, পেমেন্ট, ক্যাটাগরি ও শিপিং খরচের সব রিপোর্ট এক জায়গায়। প্রতিটি রিপোর্টে তারিখ বেছে CSV/XLSX এক্সপোর্টও করা যায়।</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORT_TYPES.map((r) => (
          <Link key={r.type} href={`/dashboard/commerce/reports/${r.type}`} className="card block p-5 transition hover:shadow-md">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold">{r.label}</div>
              <span className="text-slate-400">→</span>
            </div>
            <p className="mt-2 text-sm text-slate-500">{r.description}</p>
          </Link>
        ))}
        {EXTRA_CARDS.map((c) => (
          <Link key={c.title} href={c.href} className="card block p-5 transition hover:shadow-md">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold">{c.title}</div>
              <span className="text-slate-400">→</span>
            </div>
            <p className="mt-2 text-sm text-slate-500">{c.description}</p>
          </Link>
        ))}
      </div>

      {/* Scheduled reports manager */}
      <div className="card space-y-4 p-5">
        <h2 className="font-semibold">🕐 নির্ধারিত রিপোর্ট</h2>
        <p className="text-xs text-slate-500">
          রিপোর্টটি ইমেইলে সংযুক্তি (attachment) হিসেবে পাঠানো হয়; ইমেইল সার্ভিস সেটআপ না থাকলে পাঠানো যাবে না।
          স্বয়ংক্রিয় পাঠানোর জন্য Automation-এ scheduled_report_sweep জব চালু থাকতে হবে।
        </p>

        <form onSubmit={create} className="grid grid-cols-1 gap-4 rounded-lg bg-slate-50 p-4 md:grid-cols-2">
          <div>
            <label className={labelCls}>রিপোর্টের ধরন</label>
            <select className={inputCls} value={reportType} onChange={(e) => setReportType(e.target.value)}>
              {SCHEDULED_REPORT_TYPES.map((r) => <option key={r.type} value={r.type}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>কখন পাঠাবে</label>
            <select className={inputCls} value={cadence} onChange={(e) => setCadence(e.target.value)}>
              <option value="daily">প্রতিদিন</option>
              <option value="weekly">প্রতি সপ্তাহে</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>ফরম্যাট</label>
            <select className={inputCls} value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="csv">CSV</option>
              <option value="xlsx">XLSX</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>প্রাপকের ইমেইল (কমা দিয়ে আলাদা করুন)</label>
            <textarea className={inputCls} rows={2} value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="owner@example.com, accounts@example.com" />
          </div>
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            চালু রাখুন
          </label>
          {createMsg ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700 md:col-span-2">{createMsg}</p> : null}
          {createError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 md:col-span-2">{createError}</p> : null}
          <div className="md:col-span-2">
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? "তৈরি হচ্ছে…" : "নির্ধারিত রিপোর্ট যোগ করুন"}</button>
          </div>
        </form>

        {listError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{listError}</p> : null}
        {actionMsg ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{actionMsg}</p> : null}
        {actionError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{actionError}</p> : null}
        {!items && !listError ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : null}
        {items && items.length === 0 ? <p className="text-sm text-slate-400">এখনো কোনো নির্ধারিত রিপোর্ট নেই।</p> : null}
        {items && items.length > 0 ? (
          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-semibold">{reportTypeLabel(item.reportType)}</span>
                    <span className="text-slate-500"> · {cadenceLabel(item.cadence)} · {item.format.toUpperCase()} · {item.enabled ? "চালু" : "বন্ধ"}</span>
                    <div className="mt-1 text-xs text-slate-500">প্রাপক: {item.recipients.join(", ")}</div>
                    <div className="text-xs text-slate-400">শেষ পাঠানো: {item.lastRunAt ? new Date(item.lastRunAt).toLocaleString() : "এখনো পাঠানো হয়নি"} · তৈরি: {new Date(item.createdAt).toLocaleDateString()}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary" onClick={() => void toggle(item)}>{item.enabled ? "বন্ধ করুন" : "চালু করুন"}</button>
                    <button type="button" className="btn-secondary" onClick={() => void sendNow(item)}>এখনই পাঠান</button>
                    <button type="button" className="btn-secondary" onClick={() => void loadRuns(item.id)}>ইতিহাস</button>
                    <button type="button" className="btn-secondary text-red-600" onClick={() => void remove(item)}>মুছুন</button>
                  </div>
                </div>
                {runsById[item.id] ? (
                  <div className="mt-3 border-t pt-3">
                    {runsError ? <p className="text-xs text-red-600">{runsError}</p> : null}
                    {runsById[item.id].length === 0 ? <p className="text-xs text-slate-400">কোনো রান ইতিহাস নেই।</p> : (
                      <ul className="space-y-1 text-xs text-slate-600">
                        {runsById[item.id].map((run) => (
                          <li key={run.id} className="flex flex-wrap gap-2">
                            <span className="font-medium">{run.periodLabel}</span>
                            <span>{scheduledRunStatusLabel(run.status)}</span>
                            {run.testRun ? <span className="rounded bg-slate-100 px-1">এখনই পাঠানো</span> : null}
                            <span className="text-slate-400">{new Date(run.createdAt).toLocaleString()}</span>
                            {run.detail ? <span className="text-slate-500">— {run.detail}</span> : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
