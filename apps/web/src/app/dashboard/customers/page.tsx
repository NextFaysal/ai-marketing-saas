"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { EmptyState } from "@repo/ui";

interface CustomerRow {
  id: string; name?: string | null; phone?: string | null; email?: string | null;
  source: string; createdAt: string; orderCount: number; totalSpentMinor: string;
}
interface Detail {
  customer: { id: string; name?: string | null; phone?: string | null; email?: string | null; source: string; createdAt: string; mergedIntoId?: string | null };
  orders: { id: string; externalNumber?: string | null; status: string; source: string; isCod: boolean; totalMinor: string; createdAt: string }[];
  conversations: { id: string; channel: string; status: string; lastMessagePreview?: string | null; lastMessageAt?: string | null; unreadCount: number }[];
  shipments: { id: string; trackingCode?: string | null; status: string; provider: string }[];
  lead: { id: string; stage: string; source: string } | null;
  lifetime: { orderCount: number; totalSpentMinor: string; currency: string };
}

const money = (minor?: string | null, currency = "BDT") =>
  minor == null ? "—" : `${currency === "BDT" ? "৳" : currency + " "}${(Number(minor) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function CustomersPage() {
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [mergeTarget, setMergeTarget] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) { setLoading(false); return; }
    setLoading(true);
    try {
      setRows(await apiFetch<CustomerRow[]>(`/organizations/${orgId}/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`));
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setLoading(false); }
  }, [q]);
  useEffect(() => { load(); }, [load]);

  async function open(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    try { setDetail(await apiFetch<Detail>(`/organizations/${orgId}/customers/${id}`)); setMergeTarget(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  async function doMerge() {
    const orgId = getOrganizationId(); if (!orgId || !detail || !mergeTarget) return;
    if (!confirm("এই কাস্টমার রেকর্ডটি নির্বাচিত রেকর্ডে মার্জ হবে। অর্ডার ও কথোপকথন সরে যাবে; মূল রেকর্ডটি লুকানো থাকবে (মুছে যাবে না)। নিশ্চিত তো?")) return;
    setBusy("merge"); setNotice("");
    try {
      const merged = await apiFetch<Detail>(`/organizations/${orgId}/customers/merge`, {
        method: "POST", body: JSON.stringify({ sourceId: detail.customer.id, targetId: mergeTarget }),
      });
      setDetail(merged);
      setNotice("মার্জ সম্পন্ন হয়েছে।");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Merge ব্যর্থ"); }
    finally { setBusy(""); }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Customers 360</h1>
        <p className="text-slate-500">প্রতিটি গ্রাহকের সম্পূর্ণ ছবি: অর্ডার, কথোপকথন, পার্সেল ও মোট কেনাকাটা। ডুপ্লিকেট রেকর্ড মার্জও এখান থেকে।</p>
      </div>
      {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-xl bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p> : null}
      <div className="flex gap-2">
        <input className="input w-72" placeholder="নাম, ফোন বা ইমেইল দিয়ে খুঁজুন" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="card overflow-hidden p-0 lg:col-span-2">
          {loading ? <p className="p-4 text-sm text-slate-400">লোড হচ্ছে...</p> : rows.length === 0 ? (
            <div className="p-4"><EmptyState title="কোনো কাস্টমার নেই" description="অর্ডার Sync বা চ্যাট থেকে কাস্টমার তৈরি হলে এখানে দেখা যাবে।" /></div>
          ) : rows.map((c) => (
            <button key={c.id} onClick={() => open(c.id)} className={`block w-full border-b px-4 py-3 text-left transition hover:bg-slate-50 ${detail?.customer.id === c.id ? "bg-indigo-50/60" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{c.name || "নাম নেই"}</span>
                <span className="text-sm font-semibold">{money(c.totalSpentMinor)}</span>
              </div>
              <div className="mt-0.5 text-xs text-slate-400">{c.phone ?? c.email ?? "—"} · {c.orderCount}টি অর্ডার · {c.source}</div>
            </button>
          ))}
        </div>
        <div className="lg:col-span-3">
          {detail ? (
            <div className="space-y-4">
              <div className="card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold">{detail.customer.name || "নাম নেই"}</h2>
                    <p className="text-sm text-slate-500">{detail.customer.phone ?? "—"} · {detail.customer.email ?? "—"}</p>
                    <p className="text-xs text-slate-400">সূত্র: {detail.customer.source} · যোগ দিয়েছেন {new Date(detail.customer.createdAt).toLocaleDateString()}{detail.lead ? ` · Lead: ${detail.lead.stage}` : ""}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-black">{money(detail.lifetime.totalSpentMinor, detail.lifetime.currency)}</div>
                    <div className="text-xs text-slate-400">মোট কেনাকাটা (বাতিল ছাড়া) · {detail.lifetime.orderCount}টি অর্ডার</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
                  <label className="block text-sm">এই রেকর্ডটি মার্জ করুন যার মধ্যে:
                    <select className="input ml-2 w-56" value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
                      <option value="">কাস্টমার বেছে নিন</option>
                      {rows.filter((r) => r.id !== detail.customer.id).map((r) => <option key={r.id} value={r.id}>{r.name || r.phone || r.id.slice(0, 8)} ({r.orderCount} অর্ডার)</option>)}
                    </select>
                  </label>
                  <button className="btn-warning" disabled={!mergeTarget || busy !== ""} onClick={doMerge}>{busy === "merge" ? "মার্জ হচ্ছে..." : "মার্জ করুন"}</button>
                </div>
              </div>
              <div className="card">
                <h3 className="mb-2 font-semibold">অর্ডারসমূহ</h3>
                {detail.orders.length === 0 ? <p className="text-sm text-slate-400">কোনো অর্ডার নেই</p> : detail.orders.map((o) => (
                  <div key={o.id} className="flex items-center justify-between border-b py-2 text-sm last:border-0">
                    <span>#{o.externalNumber ?? o.id.slice(0, 8)} <span className="badge-slate ml-1">{o.status}</span>{o.isCod ? <span className="badge-amber ml-1">COD</span> : null}</span>
                    <span className="font-medium">{money(o.totalMinor)}</span>
                  </div>
                ))}
                {detail.shipments.map((s) => (
                  <div key={s.id} className="py-1 text-xs text-slate-500">🚚 {s.provider}: {s.status}{s.trackingCode ? ` · ${s.trackingCode}` : ""}</div>
                ))}
              </div>
              <div className="card">
                <h3 className="mb-2 font-semibold">কথোপকথন</h3>
                {detail.conversations.length === 0 ? <p className="text-sm text-slate-400">কোনো কথোপকথন নেই</p> : detail.conversations.map((c) => (
                  <a key={c.id} href="/dashboard/inbox" className="block border-b py-2 text-sm last:border-0 hover:bg-slate-50">
                    <span className="badge-indigo">{c.channel}</span> <span className="badge-slate ml-1">{c.status}</span>
                    <span className="ml-2 text-slate-600">{c.lastMessagePreview ?? ""}</span>
                    {c.unreadCount > 0 ? <span className="badge-red ml-1">{c.unreadCount} অপঠিত</span> : null}
                  </a>
                ))}
              </div>
            </div>
          ) : (
            <div className="card"><EmptyState title="কাস্টমার বেছে নিন" description="বাম দিকের তালিকা থেকে একজন কাস্টমারে ক্লিক করলে তার সম্পূর্ণ প্রোফাইল এখানে দেখা যাবে।" /></div>
          )}
        </div>
      </div>
    </div>
  );
}
