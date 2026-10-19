"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
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
  const { dict, t, locale } = useLocale();
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
      setError(e instanceof Error ? e.message : dict.orders.teamPerformanceLoadFailed);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={dict.orders.teamPerformance2}>
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{dict.orders.teamPerformance}</h2>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>{dict.orders.close}</button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {dict.orders.allCalculationsAreByAsia}<span className="font-medium text-slate-600"> {dict.orders.theNowOpenCurrentColumn}</span>
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={preset === "7" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => applyPreset("7")}>{dict.orders.last7Days}</button>
          <button type="button" className={preset === "30" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => applyPreset("30")}>{dict.orders.last30Days}</button>
          <button type="button" className={preset === "custom" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => applyPreset("custom")}>{dict.orders.custom}</button>
          {preset === "custom" ? (
            <>
              <input type="date" className="input input-sm" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={dict.orders.startDate} />
              <span className="text-sm text-slate-500">{dict.orders.from}</span>
              <input type="date" className="input input-sm" value={to} onChange={(e) => setTo(e.target.value)} aria-label={dict.orders.endDate} />
              <button type="button" className="btn-secondary btn-sm" onClick={() => void load(from, to)}>{dict.orders.view}</button>
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
                  <th className="py-1 pr-2">{dict.orders.member}</th>
                  <th className="py-1 pr-2">{dict.orders.role}</th>
                  <th className="py-1 pr-2" title={dict.orders.unfinishedOrdersCurrentlyAssignedTo}>{dict.orders.nowOpenCurrent}</th>
                  <th className="py-1 pr-2">{dict.orders.statusChange}</th>
                  <th className="py-1 pr-2">{dict.orders.hold}</th>
                  <th className="py-1 pr-2">{dict.orders.cODCall}</th>
                  <th className="py-1 pr-2">{dict.orders.picked}</th>
                  <th className="py-1 pr-2">{dict.orders.comment}</th>
                  <th className="py-1">{dict.orders.order}</th>
                </tr></thead>
                <tbody>
                  {data.members.map((m) => (
                    <tr key={m.userId} className="border-t">
                      <td className="py-1.5 pr-2">
                        <span className="font-medium">{memberDisplayName(m)}</span>
                        {m.email && m.name !== m.email ? <span className="block text-xs text-slate-500">{m.email}</span> : null}
                      </td>
                      <td className="py-1.5 pr-2">{roleLabel(m.role, locale)}</td>
                      <td className="py-1.5 pr-2">{m.assignedOpen}</td>
                      <td className="py-1.5 pr-2">{m.statusChanges}</td>
                      <td className="py-1.5 pr-2">{formatHolds(m.holdsPlaced, m.holdsReleased)}</td>
                      <td className="py-1.5 pr-2">{m.codCalls}</td>
                      <td className="py-1.5 pr-2">{m.picksDone}</td>
                      <td className="py-1.5 pr-2">{m.commentsPosted}</td>
                      <td className="py-1.5">
                        <button type="button" className="btn-secondary btn-sm" onClick={() => onViewAssignee(m.userId)}>{dict.orders.viewOrder}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 font-semibold">
                    <td className="py-1.5 pr-2">{dict.orders.total}</td>
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
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{roleLabel(m.role, locale)}</span>
                      </div>
                      <dl className="mt-2 space-y-1 text-xs">
                        <div className="flex justify-between gap-2"><dt className="text-slate-500">{dict.orders.nowOpenCurrent}</dt><dd className="font-medium">{m.assignedOpen}</dd></div>
                        <div className="flex justify-between gap-2"><dt className="text-slate-500">{dict.orders.statusChange}</dt><dd className="font-medium">{m.statusChanges}</dd></div>
                        <div className="flex justify-between gap-2"><dt className="text-slate-500">{dict.orders.hold}</dt><dd className="font-medium">{formatHolds(m.holdsPlaced, m.holdsReleased)}</dd></div>
                        <div className="flex justify-between gap-2"><dt className="text-slate-500">{dict.orders.cODCall}</dt><dd className="font-medium">{m.codCalls}</dd></div>
                        <div className="flex justify-between gap-2"><dt className="text-slate-500">{dict.orders.picked}</dt><dd className="font-medium">{m.picksDone}</dd></div>
                        <div className="flex justify-between gap-2"><dt className="text-slate-500">{dict.orders.comment}</dt><dd className="font-medium">{m.commentsPosted}</dd></div>
                      </dl>
                      <button type="button" className="btn-secondary btn-sm mt-3 inline-flex min-h-[44px] items-center" onClick={() => onViewAssignee(m.userId)}>{dict.orders.viewOrder}</button>
                    </div>
                  ))}
                  <div className="rounded-xl border bg-slate-50 p-3 shadow-sm">
                    <div className="font-bold text-slate-900">{dict.orders.total}</div>
                    <dl className="mt-2 space-y-1 text-xs">
                      <div className="flex justify-between gap-2"><dt className="text-slate-500">{dict.orders.nowOpenCurrent}</dt><dd className="font-semibold">{data.totals.assignedOpen}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-slate-500">{dict.orders.statusChange}</dt><dd className="font-semibold">{data.totals.statusChanges}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-slate-500">{dict.orders.hold}</dt><dd className="font-semibold">{formatHolds(data.totals.holdsPlaced, data.totals.holdsReleased)}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-slate-500">{dict.orders.cODCall}</dt><dd className="font-semibold">{data.totals.codCalls}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-slate-500">{dict.orders.picked}</dt><dd className="font-semibold">{data.totals.picksDone}</dd></div>
                      <div className="flex justify-between gap-2"><dt className="text-slate-500">{dict.orders.comment}</dt><dd className="font-semibold">{data.totals.commentsPosted}</dd></div>
                    </dl>
                  </div>
                </>
              }
            />
          ) : <p className="mt-4 text-sm text-slate-500">{dict.orders.thisOrganizationHasNoActive}</p>
        ) : <p className="mt-4 text-sm text-slate-500">{dict.common.loading}</p>}
      </div>
    </div>
  );
}
