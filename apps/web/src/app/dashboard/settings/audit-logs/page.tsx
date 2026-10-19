"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { useLocale } from "@/lib/i18n/provider";
import { fmtDateTime, fmtNumber } from "@repo/contracts";
import {
  auditLogTotalPages, auditMetadataSummary, auditMetadataText, buildAuditLogQuery,
  type AuditLogRow, type AuditLogsPayload,
} from "@/lib/ab8";

const PAGE_SIZE = 20;

/**
 * AB8 (AX25): কার্যকলাপ লগ — the org's audit trail.
 *
 * Honesty notes baked into the surface:
 * - The API only returns ORG-STAMPED rows (scopeNote
 *   "org_stamped_only"); the header says exactly that, so the
 *   absence of a record never reads as "nothing happened".
 * - Metadata is rendered ONLY as React text nodes (via the
 *   stringify-only helper in lib/ab8) — never
 *   dangerouslySetInnerHTML — so markup stored in metadata is
 *   shown verbatim and can never execute.
 */
export default function AuditLogsPage() {
  const { dict, t, locale } = useLocale();
  const [items, setItems] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [entity, setEntity] = useState("");
  const [actorId, setActorId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // Filters actually applied to the last fetch (typing in the
  // form does not refetch until "খুঁজুন" / a page change applies).
  const [applied, setApplied] = useState({ entity: "", actorId: "", from: "", to: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setLoading(false); setError(dict.settings.noOrgSelected); return; }
    setLoading(true);
    try {
      const query = buildAuditLogQuery({ ...applied, page, pageSize: PAGE_SIZE });
      const out = await apiFetch<AuditLogsPayload>(`/organizations/${orgId}/audit-logs?${query}`);
      setItems(out.items ?? []);
      setTotal(out.total ?? 0);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.settings.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [applied, page]);
  useEffect(() => { load(); }, [load]);

  function applyFilters() {
    setApplied({ entity, actorId, from, to });
    setPage(1);
  }

  function resetFilters() {
    setEntity(""); setActorId(""); setFrom(""); setTo("");
    setApplied({ entity: "", actorId: "", from: "", to: "" });
    setPage(1);
  }

  const totalPages = auditLogTotalPages(total, PAGE_SIZE);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/dashboard/settings" className="text-sm font-semibold text-indigo-700 hover:underline">{dict.settings.auditBackToSettings}</Link>
        <h1 className="page-title mt-2">{dict.settings.auditTitle}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          {dict.settings.auditIntro}
        </p>
      </div>

      <section className="card p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm text-slate-600">{dict.settings.auditEntityType}
            <input className="input mt-1 w-52" value={entity} onChange={(e) => setEntity(e.target.value)} placeholder={dict.settings.auditEntityPlaceholder} />
          </label>
          <label className="block text-sm text-slate-600">{dict.settings.auditDateFrom}
            <input className="input mt-1" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="block text-sm text-slate-600">{dict.settings.auditDateTo}
            <input className="input mt-1" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="block text-sm text-slate-600">{dict.settings.auditActorId}
            <input className="input mt-1 w-52" value={actorId} onChange={(e) => setActorId(e.target.value)} placeholder="actor id" />
          </label>
          <button type="button" className="btn-primary min-h-[44px]" onClick={applyFilters}>{dict.common.search}</button>
          <button type="button" className="btn-secondary min-h-[44px]" onClick={resetFilters}>{dict.common.reset}</button>
        </div>
      </section>

      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      <section className="card overflow-x-auto p-0">
        {loading ? <p className="p-5 text-sm text-slate-400">{dict.common.loading}</p> : items.length === 0 ? (
          <p className="p-5 text-sm text-slate-400">{dict.settings.auditNoRecords}</p>
        ) : (
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-xs font-semibold text-slate-500">
                <th className="px-4 py-3">{dict.settings.auditTime}</th>
                <th className="px-4 py-3">{dict.settings.auditUser}</th>
                <th className="px-4 py-3">{dict.settings.auditAction}</th>
                <th className="px-4 py-3">{dict.settings.auditEntity}</th>
                <th className="px-4 py-3">{dict.settings.auditSummary}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-b last:border-0 align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{fmtDateTime(locale, row.createdAt)}</td>
                  <td className="px-4 py-3">
                    {row.actor ? (
                      <>
                        <span className="font-medium text-slate-700">{row.actor.name ?? row.actor.email}</span>
                        <span className="block text-xs text-slate-400">{row.actor.email}</span>
                      </>
                    ) : <span className="text-slate-400">{dict.settings.auditSystemUnknown}</span>}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-700">{row.action}</td>
                  <td className="px-4 py-3">
                    <span className="text-slate-700">{row.entityType}</span>
                    {row.entityId ? <span className="block break-all font-mono text-[11px] text-slate-400">{row.entityId}</span> : null}
                  </td>
                  {/* Metadata as a plain text node ONLY — the full
                      pretty-printed text is in the title tooltip;
                      the cell itself shows its one-line summary. */}
                  <td className="max-w-xs px-4 py-3 font-mono text-xs text-slate-500" title={auditMetadataText(row.metadata)}>
                    {auditMetadataSummary(row.metadata)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
        <span>{t("settings.auditTotalLine", { total: fmtNumber(locale, total), page: fmtNumber(locale, page), pages: fmtNumber(locale, totalPages) })}</span>
        <span className="flex gap-2">
          <button type="button" className="btn-secondary btn-sm" disabled={loading || page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>{dict.settings.auditPrevPage}</button>
          <button type="button" className="btn-secondary btn-sm" disabled={loading || page >= totalPages} onClick={() => setPage((p) => p + 1)}>{dict.settings.auditNextPage}</button>
        </span>
      </div>
    </div>
  );
}
