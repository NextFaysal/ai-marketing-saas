"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { DataTable, EmptyState, ErrorState, PageHead } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";
import { fmtNumber } from "@repo/contracts";
import { useAdminLocale } from "@/components/AdminLocale";

interface AdminRow {
  id: string; name: string | null; email: string; tier: string; status: string;
  totpEnrolled: boolean; lastLoginAt: string | null; createdAt: string | null;
}

/** AA7 (C13): the admins roster — every platform admin in one
 * place, read-only. Grant/revoke and tier changes live on each
 * user's detail page (click the name); this page exists so the
 * operator can see the whole team — and especially who has not
 * enrolled TOTP — at a glance. */
export default function AdminsPage() {
  const { dict, locale, t } = useAdminLocale();
  const [admins, setAdmins] = React.useState<AdminRow[]>([]);
  const [error, setError] = React.useState("");
  // ADX12: loading + retry — before, the roster flashed its empty
  // state while loading and an error had no way back.
  const [loading, setLoading] = React.useState(true);
  const load = React.useCallback(async () => {
    setLoading(true); setError("");
    try {
      const o = await apiFetch<{ admins: AdminRow[] }>("/admin/security/admins");
      setAdmins(o.admins ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : dict.admins.loadFailed); }
    finally { setLoading(false); }
  }, [dict]);
  React.useEffect(() => { load(); }, [load]);

  const superWithoutTotp = admins.filter((a) => a.tier === "SUPER" && !a.totpEnrolled && a.status === "ACTIVE");
  const fmt = (v: string | null) => (v ? fmtDateTime(locale, v) : "—");

  return (
    <AdminShell title={dict.admins.title}>
      <PageHead sub={dict.admins.sub} />
      <p className="mb-3 text-sm text-slate-400">
        {dict.admins.intro}
      </p>
      {superWithoutTotp.length ? (
        <p className="mb-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-200">
          {t("admins.totpWarning", { count: fmtNumber(locale, superWithoutTotp.length), emails: superWithoutTotp.map((a) => a.email).join(", ") })}
        </p>
      ) : null}
      {error ? <div className="mb-3"><ErrorState message={error} onRetry={load} /></div> : null}
      {/* ADNX10: the roster now uses the ONE DataTable v3 pattern
          (NB1 deferred this page's one-off v3 card-table marker to
          here) — mobile card form with data-label per cell, so the
          Tier badge and সর্বশেষ Login stay visible on the card. */}
      <div className="acard overflow-hidden p-0">
        <DataTable empty={<>
          {loading && admins.length === 0 ? <div className="askel-table m-4" /> : null}
          {admins.length === 0 && !error && !loading ? <div className="p-4"><EmptyState title={dict.admins.emptyTitle} /></div> : null}
        </>}>
          <thead className="bg-slate-900"><tr>
            <th className="ath">{dict.admins.colName}</th><th className="ath">{dict.admins.colEmail}</th><th className="ath">{dict.admins.colTier}</th><th className="ath">{dict.admins.colStatus}</th>
            <th className="ath">{dict.admins.colTotp}</th><th className="ath">{dict.admins.colLastLogin}</th><th className="ath">{dict.admins.colBecameAdmin}</th>
          </tr></thead>
          <tbody>{admins.map((a) => {
            const danger = a.tier === "SUPER" && !a.totpEnrolled && a.status === "ACTIVE";
            return (
              <tr key={a.id} className={`border-t border-slate-800 ${danger ? "bg-red-500/5" : ""}`}>
                <td className="atd" data-label={dict.admins.colName}><a className="text-indigo-300 hover:underline" href={`/users/${a.id}`}>{a.name ?? "—"}</a></td>
                <td className="atd break-all sm:break-normal" data-label={dict.admins.colEmail}>{a.email}</td>
                <td className="atd" data-label={dict.admins.colTier}><span className={a.tier === "SUPER" ? "abadge-red" : "abadge-amber"}>{a.tier}</span></td>
                <td className="atd" data-label={dict.admins.colStatus}>{a.status === "ACTIVE" ? <span className="abadge-green">ACTIVE</span> : <span className="abadge-amber">{a.status}</span>}</td>
                <td className="atd" data-label={dict.admins.colTotp}>
                  {a.totpEnrolled
                    ? <span className="abadge-green">{dict.admins.totpEnrolled}</span>
                    : <span className={danger ? "abadge-red" : "abadge-amber"}>{danger ? dict.admins.totpNotSetSuper : dict.admins.totpNotSet}</span>}
                </td>
                <td className="atd" data-label={dict.admins.colLastLogin}>{fmt(a.lastLoginAt)}</td>
                <td className="atd" data-label={dict.admins.colBecameAdmin}>{fmt(a.createdAt)}</td>
              </tr>
            );
          })}</tbody>
        </DataTable>
      </div>
    </AdminShell>
  );
}
