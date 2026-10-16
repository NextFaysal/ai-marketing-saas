"use client";
import React, { useCallback, useEffect, useState } from "react";
import { ResponsiveTable } from "@repo/ui";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { rangeForPreset } from "@/lib/orders-on9";
import {
  buildTeamPerformancePath, formatHolds, memberDisplayName, roleLabel,
  type TeamPerformancePayload,
} from "@/lib/orders-on12";

/**
 * ON12 — Team Performance panel (opened from the orders page
 * header, same modal pattern as the ON8/ON9/ON10 panels).
 * Every number's definition is the API's (see
 * order-team-performance.service.ts): range-bound counts come
 * from the exact AuditLog actions + PickWaveOrder picks, and
 * "এখন খোলা (বর্তমান)" is a current snapshot that the range
 * never changes. Bulk actions write one orders.bulk audit row,
 * so bulk status changes do NOT appear in the status-change
 * count — the panel says so. "অর্ডার দেখুন" hands the member's
 * userId back to the page, which closes this panel and lands
 * on the command center filtered by that assignee (ON1).
 * Bengali-first.
 */
export function OrderTeamPanel({ onClose, onViewAssignee }: {
  onClose: () => void;
  onViewAssignee: (userId: string) => void;
}) {
  const orgId = getOrganizationId() ?? "";
  const [preset, setPreset] = useState<"7" | "30" | "custom">("30");
  const initial = rangeForPreset(30);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [data, setData] = useState<TeamPerformancePayload | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async (f: string, t: string) => {
    try {
      const out = await apiFetch<TeamPerformancePayload>(buildTeamPerformancePath(orgId, f, t));
      setData(out); setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "টিম পারফরম্যান্স লোড ব্যর্থ হয়েছে");
    }
  }, [orgId]);

  useEffect(() => { void load(from, to); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyPreset(p: "7" | "30" | "custom") {
    setPreset(p);
    if (p === "custom") return;
    const r = rangeForPreset(p === "7" ? 7 : 30);
    setFrom(r.from); setTo(r.to);
    void load(r.from, r.to);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="টিম পারফরম্যান্স">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">👥 টিম পারফরম্যান্স</h2>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>বন্ধ করুন</button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          সব হিসাব Asia/Dhaka ক্যালেন্ডার দিনে, শুধু সক্রিয় টিম সদস্যদের জন্য। স্ট্যাটাস পরিবর্তন, হোল্ড, COD কল ও মন্তব্য
          গণনা হয় অর্ডারের অডিট লগ থেকে; পিক গণনা হয় পিক ওয়েভ থেকে। বাল্ক (একসঙ্গে অনেক) স্ট্যাটাস পরিবর্তন অডিটে একটিমাত্র
          বাল্ক রেকর্ড হিসেবে থাকে, তাই তা আলাদা স্ট্যাটাস-পরিবর্তন হিসেবে এখানে গণনা হয় না।
          <span className="font-medium text-slate-600"> "এখন খোলা (বর্তমান)" কলামটি এই মুহূর্তের চিত্র — তারিখের সীমা এতে প্রযোজ্য নয়।</span>
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={preset === "7" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => applyPreset("7")}>শেষ ৭ দিন</button>
          <button type="button" className={preset === "30" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => applyPreset("30")}>শেষ ৩০ দিন</button>
          <button type="button" className={preset === "custom" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => applyPreset("custom")}>কাস্টম</button>
          {preset === "custom" ? (
            <>
              <input type="date" className="input input-sm" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="শুরুর তারিখ" />
              <span className="text-sm text-slate-500">থেকে</span>
              <input type="date" className="input input-sm" value={to} onChange={(e) => setTo(e.target.value)} aria-label="শেষ তারিখ" />
              <button type="button" className="btn-secondary btn-sm" onClick={() => void load(from, to)}>দেখুন</button>
            </>
          ) : null}
          {data ? <span className="text-xs text-slate-500">{data.from} → {data.to}</span> : null}
        </div>

        {error ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p> : null}

        {data ? (
          data.members.length ? (
            <ResponsiveTable
              className="mt-4"
              table={
                <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-slate-500">
                  <th className="py-1 pr-2">সদস্য</th>
                  <th className="py-1 pr-2">ভূমিকা</th>
                  <th className="py-1 pr-2" title="এই মুহূর্তে এই সদস্যের দায়িত্বে থাকা অসমাপ্ত অর্ডার — তারিখের সীমা প্রযোজ্য নয়">এখন খোলা (বর্তমান)</th>
                  <th className="py-1 pr-2">স্ট্যাটাস পরিবর্তন</th>
                  <th className="py-1 pr-2">হোল্ড (+/−)</th>
                  <th className="py-1 pr-2">COD কল</th>
                  <th className="py-1 pr-2">পিক সম্পন্ন</th>
                  <th className="py-1 pr-2">মন্তব্য</th>
                  <th className="py-1">অর্ডার</th>
                </tr></thead>
                <tbody>
                  {data.members.map((m) => (
                    <tr key={m.userId} className="border-t">
                      <td className="py-1.5 pr-2">
                        <span className="font-medium">{memberDisplayName(m)}</span>
                        {m.email && m.name !== m.email ? <span className="block text-xs text-slate-500">{m.email}</span> : null}
                      </td>
                      <td className="py-1.5 pr-2">{roleLabel(m.role)}</td>
                      <td className="py-1.5 pr-2">{m.assignedOpen}</td>
                      <td className="py-1.5 pr-2">{m.statusChanges}</td>
                      <td className="py-1.5 pr-2">{formatHolds(m.holdsPlaced, m.holdsReleased)}</td>
                      <td className="py-1.5 pr-2">{m.codCalls}</td>
                      <td className="py-1.5 pr-2">{m.picksDone}</td>
                      <td className="py-1.5 pr-2">{m.commentsPosted}</td>
                      <td className="py-1.5">
                        <button type="button" className="btn-secondary btn-sm" onClick={() => onViewAssignee(m.userId)}>অর্ডার দেখুন</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 font-semibold">
                    <td className="py-1.5 pr-2">মোট</td>
                    <td className="py-1.5 pr-2">—</td>
                    <td className="py-1.5 pr-2">{data.totals.assignedOpen}</td>
                    <td className="py-1.5 pr-2">{data.totals.statusChanges}</td>
                    <td className="py-1.5 pr-2">{formatHolds(data.totals.holdsPlaced, data.totals.holdsReleased)}</td>
                    <td className="py-1.5 pr-2">{data.totals.codCalls}</td>
                    <td className="py-1.5 pr-2">{data.totals.picksDone}</td>
                    <td className="py-1.5 pr-2">{data.totals.commentsPosted}</td>
                    <td className="py-1.5">—</td>
                  </tr>
                </tfoot>
              </table>
                </div>
              }
              cards={
                <>
                  {data.members.map((m) => (
                    <div key={m.userId} className="rounded-xl border bg-white p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-bold text-slate-900">{memberDisplayName(m)}</div>
                          {m.email && m.name !== m.email ? <div className="text-xs text-slate-500">{m.email}</div> : null}
                        </div>
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{roleLabel(m.role)}</span>
                      </div>
                      <dl className="mt-2 space-y-1 text-xs">
                        <div className="flex justify-between gap-2"><dt className="text-slate-500">এখন খোলা (বর্তমান)</dt><dd className="font-medium">{m.assignedOpen}</dd></div>
                        <div className="flex justify-between gap-2"><dt className="text-slate-500">স্ট্যাটাস পরিবর্তন</dt><dd className="font-medium">{m.statusChanges}</dd></div>
                        <div className="flex justify-between gap-2"><dt className="text-slate-500">হোল্ড (+/−)</dt><dd className="font-medium">{formatHolds(m.holdsPlaced, m.holdsReleased)}</dd></div>
                        <div className="flex justify-between gap-2"><dt className="text-slate-500">COD কল</dt><dd className="font-medium">{m.codCalls}</dd></div>
                        <div className="flex justify-between gap-2"><dt className="text-slate-500">পিক সম্পন্ন</dt><dd className="font-medium">{m.picksDone}</dd></div>
                        <div className="flex justify-between gap-2"><dt className="text-slate-500">মন্তব্য</dt><dd className="font-medium">{m.commentsPosted}</dd></div>
                      </dl>
                      <button type="button" className="btn-secondary btn-sm mt-3 inline-flex min-h-[44px] items-center" onClick={() => onViewAssignee(m.userId)}>অর্ডার দেখুন</button>
                    </div>
                  ))}
                  <div className="rounded-xl border bg-slate-50 p-3 shadow-sm">
                    <div className="font-bold text-slate-900">মোট</div>
                    <dl className="mt-2 space-y-1 text-xs">
                      <div className="flex justify-between gap-2"><dt className="text-slate-500">এখন খোলা (বর্তমান)</dt><dd className="font-semibold">{data.totals.assignedOpen}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-slate-500">স্ট্যাটাস পরিবর্তন</dt><dd className="font-semibold">{data.totals.statusChanges}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-slate-500">হোল্ড (+/−)</dt><dd className="font-semibold">{formatHolds(data.totals.holdsPlaced, data.totals.holdsReleased)}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-slate-500">COD কল</dt><dd className="font-semibold">{data.totals.codCalls}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-slate-500">পিক সম্পন্ন</dt><dd className="font-semibold">{data.totals.picksDone}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-slate-500">মন্তব্য</dt><dd className="font-semibold">{data.totals.commentsPosted}</dd></div>
                    </dl>
                  </div>
                </>
              }
            />
          ) : <p className="mt-4 text-sm text-slate-500">এই সংগঠনে কোনো সক্রিয় টিম সদস্য নেই।</p>
        ) : <p className="mt-4 text-sm text-slate-500">লোড হচ্ছে…</p>}
      </div>
    </div>
  );
}
