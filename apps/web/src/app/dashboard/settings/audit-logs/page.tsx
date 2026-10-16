"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
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
    if (!orgId) { setLoading(false); setError("কোনো Organization নির্বাচিত নেই।"); return; }
    setLoading(true);
    try {
      const query = buildAuditLogQuery({ ...applied, page, pageSize: PAGE_SIZE });
      const out = await apiFetch<AuditLogsPayload>(`/organizations/${orgId}/audit-logs?${query}`);
      setItems(out.items ?? []);
      setTotal(out.total ?? 0);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "লোড করা যায়নি");
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
        <Link href="/dashboard/settings" className="text-sm font-semibold text-indigo-700 hover:underline">← সেটিংসে ফিরুন</Link>
        <h1 className="page-title mt-2">🧾 কার্যকলাপ লগ</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          শুধুমাত্র এই প্রতিষ্ঠানের সঙ্গে যুক্ত রেকর্ডগুলো দেখানো হচ্ছে — প্রতিষ্ঠানের স্ট্যাম্প নেই এমন প্ল্যাটফর্ম-স্তরের কার্যকলাপ এই লগে আসে না।
        </p>
      </div>

      <section className="card p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm text-slate-600">এনটিটির ধরন
            <input className="input mt-1 w-52" value={entity} onChange={(e) => setEntity(e.target.value)} placeholder="যেমন: order, product, storefront" />
          </label>
          <label className="block text-sm text-slate-600">তারিখ থেকে
            <input className="input mt-1" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="block text-sm text-slate-600">তারিখ পর্যন্ত
            <input className="input mt-1" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="block text-sm text-slate-600">ব্যবহারকারীর আইডি (ঐচ্ছিক)
            <input className="input mt-1 w-52" value={actorId} onChange={(e) => setActorId(e.target.value)} placeholder="actor id" />
          </label>
          <button type="button" className="btn-primary min-h-[44px]" onClick={applyFilters}>খুঁজুন</button>
          <button type="button" className="btn-secondary min-h-[44px]" onClick={resetFilters}>রিসেট</button>
        </div>
      </section>

      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      <section className="card overflow-x-auto p-0">
        {loading ? <p className="p-5 text-sm text-slate-400">লোড হচ্ছে…</p> : items.length === 0 ? (
          <p className="p-5 text-sm text-slate-400">এই ফিল্টারে কোনো রেকর্ড পাওয়া যায়নি।</p>
        ) : (
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-xs font-semibold text-slate-500">
                <th className="px-4 py-3">সময়</th>
                <th className="px-4 py-3">ব্যবহারকারী</th>
                <th className="px-4 py-3">কাজ</th>
                <th className="px-4 py-3">এনটিটি</th>
                <th className="px-4 py-3">সারাংশ</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-b last:border-0 align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{new Date(row.createdAt).toLocaleString("bn-BD")}</td>
                  <td className="px-4 py-3">
                    {row.actor ? (
                      <>
                        <span className="font-medium text-slate-700">{row.actor.name ?? row.actor.email}</span>
                        <span className="block text-xs text-slate-400">{row.actor.email}</span>
                      </>
                    ) : <span className="text-slate-400">সিস্টেম / অজানা</span>}
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
        <span>মোট {total.toLocaleString("bn-BD")}টি রেকর্ড · পৃষ্ঠা {page.toLocaleString("bn-BD")} / {totalPages.toLocaleString("bn-BD")}</span>
        <span className="flex gap-2">
          <button type="button" className="btn-secondary btn-sm" disabled={loading || page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>← আগের পৃষ্ঠা</button>
          <button type="button" className="btn-secondary btn-sm" disabled={loading || page >= totalPages} onClick={() => setPage((p) => p + 1)}>পরের পৃষ্ঠা →</button>
        </span>
      </div>
    </div>
  );
}
