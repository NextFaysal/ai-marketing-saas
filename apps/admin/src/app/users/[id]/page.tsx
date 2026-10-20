"use client";
import React from "react";
import { useParams } from "next/navigation";
import AdminShell, { reasonDialog } from "@/components/AdminShell";
import Breadcrumb from "@/components/Breadcrumb";
import { EmptyState, ErrorState, PageHead, Tabs, askConfirm, askInput, toast } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";
import { useAdminLocale } from "@/components/AdminLocale";

interface Detail { id: string; email: string; name: string; isSuperAdmin: boolean; adminTier?: string | null; status: string; lastLoginAt?: string | null; createdAt: string; totpEnabled: boolean; memberships: { id: string; role: string; organizationId: string; organizationName?: string | null }[]; auditTrail: { id: string; action: string; createdAt: string }[] }

/** ADX6 tabs — content regrouped only, nothing invented:
 *  সারসংক্ষেপ = profile + memberships, কার্যকলাপ = audit trail,
 *  নোট = admin notes. All action buttons live in the sticky
 *  header below so they stay visible on every tab. */
export default function UserDetailPage() {
  const { dict, locale, t } = useAdminLocale();
  const TABS = [
    { id: "summary", label: dict.userDetail.tabSummary },
    { id: "activity", label: dict.userDetail.tabActivity },
    { id: "notes", label: dict.userDetail.tabNotes },
  ];
  const params = useParams();
  const id = String(params.id);
  const [data, setData] = React.useState<Detail | null>(null);
  const [notes, setNotes] = React.useState<{ id: string; body: string; createdAt: string }[]>([]);
  const [note, setNote] = React.useState("");
  const [tab, setTab] = React.useState("summary");
  const [resetPath, setResetPath] = React.useState("");
  // ADX12: detail-load failure state (see org detail).
  const [loadFailed, setLoadFailed] = React.useState(false);
  const load = React.useCallback(async () => {
    setLoadFailed(false);
    const d = await apiFetch<Detail>(`/admin/users/${id}`).catch(() => null);
    setLoadFailed(d === null);
    setData(d);
    setNotes(await apiFetch<{ id: string; body: string; createdAt: string }[]>(`/admin/notes?targetType=user&targetId=${id}`).catch(() => []));
  }, [id]);
  React.useEffect(() => { load(); }, [load]);

  async function act(path: string, body?: unknown, okMsg?: string) {
    try {
      const out: any = await apiFetch(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
      if (out?.resetPath) setResetPath(out.resetPath);
      toast(okMsg ?? dict.userDetail.doneToast);
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : dict.common.failed, "error"); }
  }

  if (!data) return <AdminShell title={dict.userDetail.titleFallback}>{loadFailed ? <ErrorState message={dict.userDetail.loadError} onRetry={load} /> : <div className="space-y-4" aria-hidden="true"><div className="askel-card" /><div className="askel-table" /></div>}</AdminShell>;
  return (
    <AdminShell title={`👤 ${data.name}`}>
      {/* ADNX8: ONE detail pattern (same as Org Detail) —
          PageHead carries breadcrumb + status badges, actions
          live in the unified action bar below. All action
          feedback now goes through the toast system (act()). */}
      <PageHead
        breadcrumb={<Breadcrumb items={[{ label: t("nav.items.users"), href: "/users" }, { label: data.name?.trim() ? data.name : `${id.slice(0, 8)}…` }]} />}
        sub={data.email}
      >
        <span className={data.status === "ACTIVE" ? "abadge-green" : "abadge-amber"}>{data.status}</span>
        {data.isSuperAdmin ? <span className="abadge-slate">{t("users.adminBadge", { tier: data.adminTier ?? "SUPER" })}</span> : null}
      </PageHead>

      {/* ADNX8: unified detail action bar — sticky top on lg,
          fixed bottom above the quick bar on mobile. */}
      <div className="max-lg:fixed max-lg:inset-x-0 max-lg:bottom-[calc(64px+env(safe-area-inset-bottom))] max-lg:z-30 max-lg:border-t max-lg:border-slate-800 max-lg:bg-slate-950/95 max-lg:px-4 max-lg:py-2.5 lg:sticky lg:top-0 lg:z-20 lg:mb-4 lg:rounded-b-2xl lg:bg-slate-950/90 lg:py-2.5 lg:backdrop-blur">
        <div className="flex flex-wrap gap-2 lg:justify-end">
            {data.status !== "ACTIVE" ? <button className="abtn" onClick={async () => { const r = await reasonDialog(dict.userDetail.activateAction); if (r) act(`/admin/users/${id}/status`, { status: "ACTIVE", reason: r }, dict.userDetail.activatedToast); }}>{dict.userDetail.activateButton}</button> : null}
            {data.status === "ACTIVE" ? <button className="abtn-secondary" onClick={async () => { const r = await reasonDialog(dict.userDetail.suspendAction); if (r) act(`/admin/users/${id}/status`, { status: "SUSPENDED", reason: r }, dict.userDetail.suspendedToast); }}>{dict.userDetail.suspendButton}</button> : null}
            {data.status !== "DELETED" ? <button className="abtn-danger" onClick={async () => { const r = await reasonDialog(dict.userDetail.deleteAction); if (!r) return; const ok = await askConfirm({ title: dict.userDetail.deleteConfirmTitle, description: dict.userDetail.deleteConfirmDesc, confirmLabel: dict.userDetail.deleteConfirm, danger: true }); if (ok) act(`/admin/users/${id}/status`, { status: "DELETED", reason: r }, dict.userDetail.deletedToast); }}>{dict.userDetail.deleteButton}</button> : null}
            <button className="abtn-secondary" onClick={() => act(`/admin/users/${id}/force-reset`, undefined, dict.userDetail.resetToast)}>{dict.userDetail.resetButton}</button>
            <button className="abtn-secondary" onClick={async () => { const r = await reasonDialog(dict.userDetail.revokeSessionsAction); if (r) act(`/admin/users/${id}/revoke-sessions`, { reason: r }, dict.userDetail.sessionsRevokedToast); }}>{dict.userDetail.revokeSessionsButton}</button>
            {!data.isSuperAdmin ? <button className="abtn-secondary" onClick={async () => { const tier = await askInput({ title: dict.userDetail.grantTierTitle, inputLabel: dict.userDetail.tierLabel, initialValue: "SUPPORT", confirmLabel: dict.common.proceed }); if (!tier) return; const r = await reasonDialog(dict.userDetail.grantAction); if (r) act(`/admin/users/${id}/grant`, { tier: tier.toUpperCase(), reason: r }, dict.userDetail.grantedToast); }}>{dict.userDetail.grantButton}</button> : null}
            {data.isSuperAdmin ? <button className="abtn-danger" onClick={async () => { const r = await reasonDialog(dict.userDetail.revokeAdminAction); if (r) act(`/admin/users/${id}/revoke`, { reason: r }, dict.userDetail.adminRevokedToast); }}>{dict.userDetail.revokeAdminButton}</button> : null}
          </div>
      </div>
      {/* The reset link itself is persistent information (it must
          stay readable until copied), so it keeps its own box —
          now in normal flow below the action bar instead of
          inside the (mobile-fixed) bar. */}
      {resetPath ? <div className="mb-4 break-all rounded-lg bg-slate-800 p-3 text-xs">{dict.userDetail.resetLinkBox}<br /><span className="text-indigo-300">{resetPath}</span><br /><span className="text-slate-400">{t("userDetail.resetLinkHint", { path: resetPath })}</span></div> : null}

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === "summary" ? (
        <div className="atab-panel">
          <div className="acard space-y-2 text-sm">
            <div><span className="text-slate-400">{dict.userDetail.emailLabel}</span> {data.email}</div>
            <div><span className="text-slate-400">{dict.userDetail.statusLabel}</span> <span className={data.status === "ACTIVE" ? "abadge-green" : "abadge-amber"}>{data.status}</span>{data.isSuperAdmin ? <span className="abadge-slate ml-2">{t("users.adminBadge", { tier: data.adminTier ?? "SUPER" })}</span> : null}</div>
            <div><span className="text-slate-400">{dict.userDetail.lastLoginLabel}</span> {data.lastLoginAt ? fmtDateTime(locale, data.lastLoginAt) : "—"}</div>
            <div><span className="text-slate-400">{dict.userDetail.twoFaLabel}</span> {data.totpEnabled ? dict.userDetail.twoFaOn : dict.userDetail.twoFaOff}</div>
            <div className="pt-2 font-medium">{dict.userDetail.membershipsTitle}</div>
            {data.memberships.map((m) => <div key={m.id} className="rounded-lg bg-slate-800 px-3 py-2">{m.organizationName ?? m.organizationId} — <b>{m.role}</b></div>)}
            {data.memberships.length === 0 ? <EmptyState title={dict.userDetail.noMembershipsTitle} sub={dict.userDetail.noMembershipsSub} /> : null}
          </div>
        </div>
      ) : null}

      {tab === "activity" ? (
        <div className="atab-panel">
          <div className="acard">
            <div className="mb-2 font-semibold">{dict.userDetail.activityTitle}</div>
            <ul className="space-y-1 text-sm text-slate-400">{data.auditTrail.map((a) => <li key={a.id} className="flex justify-between border-b border-slate-800 pb-1"><span>{a.action}</span><span>{fmtDateTime(locale, a.createdAt)}</span></li>)}</ul>
            {data.auditTrail.length === 0 ? <EmptyState title={dict.userDetail.noActivityTitle} sub={dict.userDetail.noActivitySub} /> : null}
          </div>
        </div>
      ) : null}

      {tab === "notes" ? (
        <div className="atab-panel">
          <div className="acard">
            <div className="mb-2 font-medium">{dict.userDetail.notesTitle}</div>
            <div className="flex gap-2">
              <input className="ainput" placeholder={dict.userDetail.notePlaceholder} value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="abtn-secondary" onClick={async () => { if (!note.trim()) return; try { await apiFetch("/admin/notes", { method: "POST", body: JSON.stringify({ targetType: "user", targetId: id, body: note }) }); setNote(""); toast(dict.userDetail.noteAdded); await load(); } catch (e) { toast(e instanceof Error ? e.message : dict.userDetail.noteAddFailed, "error"); } }}>{dict.userDetail.noteAdd}</button>
            </div>
            <ul className="mt-2 space-y-1 text-sm text-slate-400">{notes.map((n) => <li key={n.id} className="rounded bg-slate-800 px-2 py-1.5">{n.body} <span className="text-xs text-slate-400">· {fmtDateTime(locale, n.createdAt)}</span></li>)}</ul>
            {notes.length === 0 ? <EmptyState title={dict.userDetail.noNotesTitle} sub={dict.userDetail.noNotesSub} /> : null}
          </div>
        </div>
      ) : null}
      <div className="h-16 lg:hidden" aria-hidden="true" />
    </AdminShell>
  );
}
