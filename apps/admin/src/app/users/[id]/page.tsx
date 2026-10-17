"use client";
import React from "react";
import { useParams } from "next/navigation";
import AdminShell, { reasonDialog } from "@/components/AdminShell";
import Breadcrumb from "@/components/Breadcrumb";
import { EmptyState, ErrorState, PageHead, Tabs, askConfirm, askInput, toast } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";

interface Detail { id: string; email: string; name: string; isSuperAdmin: boolean; adminTier?: string | null; status: string; lastLoginAt?: string | null; createdAt: string; totpEnabled: boolean; memberships: { id: string; role: string; organizationId: string; organizationName?: string | null }[]; auditTrail: { id: string; action: string; createdAt: string }[] }

/** ADX6 tabs — content regrouped only, nothing invented:
 *  সারসংক্ষেপ = profile + memberships, কার্যকলাপ = audit trail,
 *  নোট = admin notes. All action buttons live in the sticky
 *  header below so they stay visible on every tab. */
const TABS = [
  { id: "summary", label: "সারসংক্ষেপ" },
  { id: "activity", label: "কার্যকলাপ" },
  { id: "notes", label: "নোট" },
];

export default function UserDetailPage() {
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
      toast(okMsg ?? "হয়ে গেছে।");
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : "ব্যর্থ হয়েছে", "error"); }
  }

  if (!data) return <AdminShell title="👤 User">{loadFailed ? <ErrorState message="User লোড হয়নি — আবার চেষ্টা করুন।" onRetry={load} /> : <div className="space-y-4" aria-hidden="true"><div className="askel-card" /><div className="askel-table" /></div>}</AdminShell>;
  return (
    <AdminShell title={`👤 ${data.name}`}>
      {/* ADNX8: ONE detail pattern (same as Org Detail) —
          PageHead carries breadcrumb + status badges, actions
          live in the unified action bar below. All action
          feedback now goes through the toast system (act()). */}
      <PageHead
        breadcrumb={<Breadcrumb items={[{ label: "Users", href: "/users" }, { label: data.name?.trim() ? data.name : `${id.slice(0, 8)}…` }]} />}
        sub={data.email}
      >
        <span className={data.status === "ACTIVE" ? "abadge-green" : "abadge-amber"}>{data.status}</span>
        {data.isSuperAdmin ? <span className="abadge-slate">🛡 Admin ({data.adminTier ?? "SUPER"})</span> : null}
      </PageHead>

      {/* ADNX8: unified detail action bar — sticky top on lg,
          fixed bottom above the quick bar on mobile. */}
      <div className="max-lg:fixed max-lg:inset-x-0 max-lg:bottom-[calc(64px+env(safe-area-inset-bottom))] max-lg:z-30 max-lg:border-t max-lg:border-slate-800 max-lg:bg-slate-950/95 max-lg:px-4 max-lg:py-2.5 lg:sticky lg:top-0 lg:z-20 lg:mb-4 lg:rounded-b-2xl lg:bg-slate-950/90 lg:py-2.5 lg:backdrop-blur">
        <div className="flex flex-wrap gap-2 lg:justify-end">
            {data.status !== "ACTIVE" ? <button className="abtn" onClick={async () => { const r = await reasonDialog("Activate User"); if (r) act(`/admin/users/${id}/status`, { status: "ACTIVE", reason: r }, "User সক্রিয় হয়েছে।"); }}>✅ সক্রিয় করুন</button> : null}
            {data.status === "ACTIVE" ? <button className="abtn-secondary" onClick={async () => { const r = await reasonDialog("Suspend User"); if (r) act(`/admin/users/${id}/status`, { status: "SUSPENDED", reason: r }, "User Suspend হয়েছে — লগইন বন্ধ থাকবে।"); }}>⏸ Suspend করুন</button> : null}
            {data.status !== "DELETED" ? <button className="abtn-danger" onClick={async () => { const r = await reasonDialog("Soft-Delete User"); if (!r) return; const ok = await askConfirm({ title: "নিশ্চিত?", description: "Soft-delete — পরে ফেরত আনা যাবে।", confirmLabel: "Soft-Delete করুন", danger: true }); if (ok) act(`/admin/users/${id}/status`, { status: "DELETED", reason: r }, "User Soft-Delete হয়েছে।"); }}>🗑 Soft-Delete</button> : null}
            <button className="abtn-secondary" onClick={() => act(`/admin/users/${id}/force-reset`, undefined, "Reset লিংক তৈরি হয়েছে (নিচে) — যাচাইকৃত মাধ্যমে User কে দিন।")}>🔑 Password Reset লিংক</button>
            <button className="abtn-secondary" onClick={async () => { const r = await reasonDialog("Revoke All Sessions"); if (r) act(`/admin/users/${id}/revoke-sessions`, { reason: r }, "User এর সব Session বাতিল হয়েছে।"); }}>🚫 Session বাতিল করুন</button>
            {!data.isSuperAdmin ? <button className="abtn-secondary" onClick={async () => { const tier = await askInput({ title: "Tier দিন: SUPER / SUPPORT / FINANCE", inputLabel: "Tier", initialValue: "SUPPORT", confirmLabel: "এগিয়ে যান" }); if (!tier) return; const r = await reasonDialog("Grant Admin"); if (r) act(`/admin/users/${id}/grant`, { tier: tier.toUpperCase(), reason: r }, "Admin দেওয়া হয়েছে।"); }}>🛡 Admin করুন</button> : null}
            {data.isSuperAdmin ? <button className="abtn-danger" onClick={async () => { const r = await reasonDialog("Revoke Admin"); if (r) act(`/admin/users/${id}/revoke`, { reason: r }, "Admin ক্ষমতা কেড়ে নেওয়া হয়েছে।"); }}>🛡 Admin কেড়ে নিন</button> : null}
          </div>
      </div>
      {/* The reset link itself is persistent information (it must
          stay readable until copied), so it keeps its own box —
          now in normal flow below the action bar instead of
          inside the (mobile-fixed) bar. */}
      {resetPath ? <div className="mb-4 break-all rounded-lg bg-slate-800 p-3 text-xs">Reset লিংক (১ ঘণ্টা বৈধ, একবার ব্যবহারযোগ্য):<br /><span className="text-indigo-300">{resetPath}</span><br /><span className="text-slate-400">Tenant অ্যাপের ঠিকানার সাথে যুক্ত করে পাঠান, যেমন: https://your-domain{resetPath}</span></div> : null}

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === "summary" ? (
        <div className="atab-panel">
          <div className="acard space-y-2 text-sm">
            <div><span className="text-slate-400">ইমেইল:</span> {data.email}</div>
            <div><span className="text-slate-400">অবস্থা:</span> <span className={data.status === "ACTIVE" ? "abadge-green" : "abadge-amber"}>{data.status}</span>{data.isSuperAdmin ? <span className="abadge-slate ml-2">🛡 Admin ({data.adminTier ?? "SUPER"})</span> : null}</div>
            <div><span className="text-slate-400">শেষ লগইন:</span> {data.lastLoginAt ? fmtDateTime(data.lastLoginAt) : "—"}</div>
            <div><span className="text-slate-400">2FA:</span> {data.totpEnabled ? "চালু" : "বন্ধ"}</div>
            <div className="pt-2 font-medium">Membership সমূহ</div>
            {data.memberships.map((m) => <div key={m.id} className="rounded-lg bg-slate-800 px-3 py-2">{m.organizationName ?? m.organizationId} — <b>{m.role}</b></div>)}
            {data.memberships.length === 0 ? <EmptyState title="কোনো Organization এ সদস্য নন।" sub="এই User এখনো কোনো Organization-এ যোগ দেননি।" /> : null}
          </div>
        </div>
      ) : null}

      {tab === "activity" ? (
        <div className="atab-panel">
          <div className="acard">
            <div className="mb-2 font-semibold">সাম্প্রতিক কার্যকলাপ (Audit)</div>
            <ul className="space-y-1 text-sm text-slate-400">{data.auditTrail.map((a) => <li key={a.id} className="flex justify-between border-b border-slate-800 pb-1"><span>{a.action}</span><span>{fmtDateTime(a.createdAt)}</span></li>)}</ul>
            {data.auditTrail.length === 0 ? <EmptyState title="কোনো কার্যকলাপ নেই।" sub="এই User-এর Audit-এ এখনো কোনো অ্যাকশন রেকর্ড হয়নি।" /> : null}
          </div>
        </div>
      ) : null}

      {tab === "notes" ? (
        <div className="atab-panel">
          <div className="acard">
            <div className="mb-2 font-medium">Admin নোট</div>
            <div className="flex gap-2">
              <input className="ainput" placeholder="অভ্যন্তরীণ নোট লিখুন…" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="abtn-secondary" onClick={async () => { if (!note.trim()) return; try { await apiFetch("/admin/notes", { method: "POST", body: JSON.stringify({ targetType: "user", targetId: id, body: note }) }); setNote(""); toast("নোট যোগ হয়েছে।"); await load(); } catch (e) { toast(e instanceof Error ? e.message : "নোট যোগ ব্যর্থ হয়েছে", "error"); } }}>যোগ</button>
            </div>
            <ul className="mt-2 space-y-1 text-sm text-slate-400">{notes.map((n) => <li key={n.id} className="rounded bg-slate-800 px-2 py-1.5">{n.body} <span className="text-xs text-slate-400">· {fmtDateTime(n.createdAt)}</span></li>)}</ul>
            {notes.length === 0 ? <EmptyState title="কোনো নোট নেই।" sub="উপরে প্রথম অভ্যন্তরীণ নোট যোগ করুন।" /> : null}
          </div>
        </div>
      ) : null}
      <div className="h-16 lg:hidden" aria-hidden="true" />
    </AdminShell>
  );
}
