"use client";
import React from "react";
import { useParams } from "next/navigation";
import AdminShell, { reasonDialog } from "@/components/AdminShell";
import Breadcrumb from "@/components/Breadcrumb";
import { EmptyState, ErrorState, PageHead, Tabs, askConfirm, askInput, toast } from "@/components/ui";
import { API_URL, apiFetch, getAdminToken } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";
import { fmtNumber, type UiLocale } from "@repo/contracts";
import { useAdminLocale } from "@/components/AdminLocale";
import type { AdminDict } from "@/lib/i18n";

interface OrgDetail {
  id: string; name: string; slug: string; status: string; country: string; currency: string; timezone: string; createdAt: string;
  members: { id: string; role: string; user?: { email: string; name: string; status: string } | null }[];
  integrations: { id: string; provider: string; status: string }[];
  subscription?: { plan: string; status: string; currentPeriodEnd?: string | null } | null;
  counts: { products: number; orders: number; conversations: number; campaigns: number };
  aiDailyLimitOverride?: number | null; broadcastCapOverride?: number | null; seatLimit?: number | null;
  // AB8 (AX24): white-label — platform branding fully hidden for this org.
  whiteLabel?: boolean;
  // GC21 (GB9): merchant verification + recorded storage usage.
  verificationStatus?: string; verificationNote?: string | null; verificationSubmittedAt?: string | null;
  businessProfile?: {
    tradeLicenseNo?: string | null; businessAddress?: string | null; address?: string | null;
    contactPhone?: string | null; contactEmail?: string | null; city?: string | null;
  } | null;
  storageBytes?: string; storageAssetCount?: number; storageMeteredFrom?: string;
  // ORG13 (OB4): admin-only classification tags — never shown tenant-side.
  tags?: string[];
}

function formatBytes(bytesStr: string | undefined, locale: UiLocale, dict: AdminDict): string {
  const n = Number(bytesStr ?? 0);
  if (!Number.isFinite(n) || n <= 0) return dict.orgDetail.bytesZero;
  const units = [dict.orgDetail.byteUnit, "KB", "MB", "GB", "TB"];
  let v = n; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${fmtNumber(locale, v, { maximumFractionDigits: 2 })} ${units[i]}`;
}

/**
 * ORG13 (Organization Next OB4): the org's admin-only tags,
 * edited as a chip list. Saving PATCHes the WHOLE list to
 * /admin/orgs/:id/tags (SUPER tier; the API normalizes — trim,
 * dedupe, case preserved — enforces max 20 × 40 chars, and
 * audits). Tags are internal classification only: tenants never
 * see them anywhere.
 */
function OrgTagsCard({ orgId, initial }: { orgId: string; initial: string[] }) {
  const { dict, t: tr } = useAdminLocale();
  const [tags, setTags] = React.useState<string[]>(initial);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { setTags(initial); }, [initial]);
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    if (t.length > 40) { toast(dict.orgDetail.tagTooLong, "error"); return; }
    if (tags.includes(t)) { toast(dict.orgDetail.tagDuplicate, "error"); return; }
    if (tags.length >= 20) { toast(dict.orgDetail.tagTooMany, "error"); return; }
    setTags([...tags, t]);
    setDraft("");
  };
  const save = async () => {
    setBusy(true);
    try {
      const out = await apiFetch<{ tags: string[] }>(`/admin/orgs/${orgId}/tags`, { method: "PATCH", body: JSON.stringify({ tags }) });
      setTags(out.tags);
      toast(dict.orgDetail.tagsSaved);
    } catch (e) { toast(e instanceof Error ? e.message : dict.orgDetail.tagsSaveFailed, "error"); }
    setBusy(false);
  };
  const dirty = JSON.stringify(tags) !== JSON.stringify(initial);
  return (
    <div className="acard space-y-3">
      <div className="font-semibold">{dict.orgDetail.tagsTitle}</div>
      <p className="text-xs leading-relaxed text-slate-400">
        {dict.orgDetail.tagsNote}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/70 py-0.5 pl-2.5 pr-1 text-xs text-slate-200">
            🏷 {t}
            <button type="button" className="rounded-full px-1 text-slate-400 hover:text-red-300" aria-label={tr("orgDetail.tagDeleteAria", { tag: t })} onClick={() => setTags(tags.filter((x) => x !== t))}>✕</button>
          </span>
        ))}
        {tags.length === 0 ? <span className="text-xs text-slate-500">{dict.orgDetail.noTags}</span> : null}
      </div>
      <div className="flex gap-2">
        <input className="ainput" placeholder={dict.orgDetail.tagPlaceholder} value={draft} maxLength={60}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button type="button" className="abtn-secondary" onClick={add}>{dict.orgDetail.tagAdd}</button>
      </div>
      <button type="button" className="abtn" disabled={busy || !dirty} onClick={save}>{busy ? dict.orgDetail.tagsSaving : dict.orgDetail.tagsSave}</button>
    </div>
  );
}

/** ADX6 tabs — every tab's content already existed on this page;
 *  nothing new was invented, the stacked cards were regrouped:
 *  সারসংক্ষেপ = info/counts/members/integrations + Danger Zone,
 *  Billing ও Limit = subscription editor + limit override + flags,
 *  কার্যকলাপ = support view + view-as + 360 history,
 *  নোট = admin notes. */


export default function OrgDetailPage() {
  const { dict, locale, t } = useAdminLocale();
  const TABS = [
    { id: "summary", label: dict.orgDetail.tabSummary },
    { id: "billing", label: dict.orgDetail.tabBilling },
    { id: "activity", label: dict.orgDetail.tabActivity },
    { id: "notes", label: dict.orgDetail.tabNotes },
  ];
  const params = useParams();
  const id = String(params.id);
  const [data, setData] = React.useState<OrgDetail | null>(null);
  const [notes, setNotes] = React.useState<{ id: string; body: string; createdAt: string }[]>([]);
  const [note, setNote] = React.useState("");
  const [verificationNote, setVerificationNote] = React.useState("");
  const [msg, setMsg] = React.useState("");
  const [tab, setTab] = React.useState("summary");
  const [limits, setLimits] = React.useState<{ aiDailyLimitOverride: string; broadcastCapOverride: string; seatLimit: string }>({ aiDailyLimitOverride: "", broadcastCapOverride: "", seatLimit: "" });
  const [flags, setFlags] = React.useState<{ knownFlags: string[]; flags: { key: string; enabled: boolean }[] }>({ knownFlags: [], flags: [] });
  const [support, setSupport] = React.useState<{ recentOrders: { id: string; externalNumber?: string | null; status: string; totalMinor: string }[]; recentConversations: { id: string; channel: string; status: string; contactName?: string | null; messageCount: number }[] } | null>(null);
  const [convMessages, setConvMessages] = React.useState<{ direction: string; body?: string | null; createdAt: string }[]>([]);
  // ADX12: detail-load failure state (before, a failed fetch sat
  // on "লোড হচ্ছে…" forever — same text as a slow load).
  const [loadFailed, setLoadFailed] = React.useState(false);
  const load = React.useCallback(async () => {
    setLoadFailed(false);
    const d = await apiFetch<OrgDetail>(`/admin/orgs/${id}`).catch(() => null);
    setLoadFailed(d === null);
    setData(d);
    if (d) setLimits({
      aiDailyLimitOverride: d.aiDailyLimitOverride != null ? String(d.aiDailyLimitOverride) : "",
      broadcastCapOverride: d.broadcastCapOverride != null ? String(d.broadcastCapOverride) : "",
      seatLimit: d.seatLimit != null ? String(d.seatLimit) : "",
    });
    setFlags(await apiFetch<{ knownFlags: string[]; flags: { key: string; enabled: boolean }[] }>(`/admin/orgs/${id}/flags`).catch(() => ({ knownFlags: [], flags: [] })));
    setSupport(await apiFetch<{ recentOrders: { id: string; externalNumber?: string | null; status: string; totalMinor: string }[]; recentConversations: { id: string; channel: string; status: string; contactName?: string | null; messageCount: number }[] }>(`/admin/orgs/${id}/support-view`).catch(() => null));
    setNotes(await apiFetch<{ id: string; body: string; createdAt: string }[]>(`/admin/notes?targetType=organization&targetId=${id}`).catch(() => []));
  }, [id]);
  React.useEffect(() => { load(); }, [load]);
  async function setStatus(status: string, label: string) {
    const r = await reasonDialog(label);
    if (!r) return;
    try {
      await apiFetch(`/admin/orgs/${id}/status`, { method: "POST", body: JSON.stringify({ status, reason: r }) });
      toast(t("orgDetail.actionDone", { label }));
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : dict.common.failed, "error"); }
  }
  if (!data) return <AdminShell title={dict.orgDetail.titleFallback}>{loadFailed ? <ErrorState message={dict.orgDetail.loadError} onRetry={load} /> : <div className="space-y-4" aria-hidden="true"><div className="askel-card" /><div className="askel-table" /></div>}</AdminShell>;
  return (
    <AdminShell title={`🏢 ${data.name}`}>
      {/* ADNX8: ONE detail pattern — PageHead carries the
          breadcrumb + status badges; the banner below now only
          ever shows the permanent-deletion certificate (long,
          persistent information a 6s toast cannot carry). */}
      <PageHead
        breadcrumb={<Breadcrumb items={[{ label: t("nav.items.organizations"), href: "/orgs" }, { label: data.name?.trim() ? data.name : `${id.slice(0, 8)}…` }]} />}
        sub={`${data.slug} · ${data.country} · ${data.currency}`}
      >
        <span className={data.status === "ACTIVE" ? "abadge-green" : "abadge-amber"}>{data.status}</span>
        {data.subscription ? <span className="abadge-indigo">{data.subscription.plan} · {data.subscription.status}</span> : null}
      </PageHead>
      {msg ? <p className="mb-3 rounded-lg bg-indigo-500/10 p-3 text-sm text-indigo-200">{msg}</p> : null}

      {/* ADNX8: unified detail action bar — sticky at the top on
          lg, a fixed bottom bar just above the NB1 quick bar on
          mobile (spacer at the page end keeps content clear). */}
      <div className="max-lg:fixed max-lg:inset-x-0 max-lg:bottom-[calc(64px+env(safe-area-inset-bottom))] max-lg:z-30 max-lg:border-t max-lg:border-slate-800 max-lg:bg-slate-950/95 max-lg:px-4 max-lg:py-2.5 lg:sticky lg:top-0 lg:z-20 lg:mb-4 lg:rounded-b-2xl lg:bg-slate-950/90 lg:py-2.5 lg:backdrop-blur">
        <div className="flex flex-wrap gap-2 lg:justify-end">
          {data.status === "ACTIVE" ? <button className="abtn-secondary" onClick={() => setStatus("SUSPENDED", dict.orgDetail.suspendAction)}>{dict.orgDetail.suspendButton}</button> : null}
          {data.status !== "ACTIVE" ? <button className="abtn" onClick={() => setStatus("ACTIVE", dict.orgDetail.reactivateAction)}>{dict.orgDetail.reactivateButton}</button> : null}
          {data.status !== "DELETED" ? <button className="abtn-danger" onClick={() => setStatus("DELETED", dict.orgDetail.deleteAction)}>{dict.orgDetail.deleteButton}</button> : null}
        </div>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === "summary" ? (
        <div className="atab-panel grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
          <div className="acard space-y-2 text-sm">
            <div><span className="text-slate-400">{dict.orgDetail.slugLabel}</span> {data.slug} · <span className="text-slate-400">{dict.orgDetail.countryLabel}</span> {data.country} · <span className="text-slate-400">{dict.orgDetail.currencyLabel}</span> {data.currency}</div>
            <div><span className="text-slate-400">{dict.orgDetail.statusLabel}</span> <span className={data.status === "ACTIVE" ? "abadge-green" : "abadge-amber"}>{data.status}</span></div>
            <div><span className="text-slate-400">{dict.orgDetail.subscriptionLabel}</span> {data.subscription ? `${data.subscription.plan} · ${data.subscription.status}${data.subscription.currentPeriodEnd ? t("orgDetail.periodEnd", { date: fmtDateTime(locale, data.subscription.currentPeriodEnd, "date") }) : ""}` : dict.orgDetail.noSubscription}</div>
            <div className="grid grid-cols-4 gap-2 pt-2 text-center">
              {([[dict.orgDetail.countProducts, data.counts.products], [dict.orgDetail.countOrders, data.counts.orders], [dict.orgDetail.countConversations, data.counts.conversations], [dict.orgDetail.countCampaigns, data.counts.campaigns]] as const).map(([label, v]) => (
                <div key={label} className="rounded-lg bg-slate-800 p-2"><div className="text-lg font-bold">{fmtNumber(locale, v)}</div><div className="text-xs text-slate-400">{label}</div></div>
              ))}
            </div>
            <div className="pt-2 font-medium">{dict.orgDetail.membersTitle}</div>
            {data.members.map((m) => <div key={m.id} className="rounded-lg bg-slate-800 px-3 py-2">{m.user?.name ?? "?"} <span className="text-slate-400">{m.user?.email}</span> — <b>{m.role}</b>{m.user?.status !== "ACTIVE" ? <span className="abadge-amber ml-2">{m.user?.status}</span> : null}</div>)}
            {data.members.length === 0 ? <EmptyState title={dict.orgDetail.noMembersTitle} sub={dict.orgDetail.noMembersSub} /> : null}
            <div className="pt-2 font-medium">{dict.orgDetail.integrationsTitle}</div>
            {data.integrations.map((i) => <div key={i.id} className="rounded-lg bg-slate-800 px-3 py-2">{i.provider} — {i.status}</div>)}
            {data.integrations.length === 0 ? <p className="text-slate-400">{dict.orgDetail.noIntegrations}</p> : null}
          </div>
          <OrgTagsCard orgId={id} initial={data.tags ?? []} />
          </div>
          <div className="acard space-y-3">
            <div className="font-semibold">{dict.orgDetail.actionsTitle}</div>
            <p className="text-xs text-slate-400">{dict.orgDetail.actionsNote}</p>
            <div className="border-t border-red-900/50 pt-3">
              <div className="font-semibold text-red-300">{dict.orgDetail.dangerTitle}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button className="abtn-secondary" onClick={async () => {
                  try {
                    const res = await fetch(`${API_URL}/admin/orgs/${id}/export`, { headers: { Authorization: `Bearer ${getAdminToken()}` } });
                    if (!res.ok) throw new Error(dict.orgDetail.exportFailed);
                    const blob = await res.blob();
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `org-export-${data.slug}.json`;
                    a.click();
                    URL.revokeObjectURL(a.href);
                    toast(dict.orgDetail.exportDone);
                  } catch (e) { toast(e instanceof Error ? e.message : dict.orgDetail.exportFailedShort, "error"); }
                }}>{dict.orgDetail.exportButton}</button>
                {data.status === "DELETED" ? (
                  <button className="abtn-danger" onClick={async () => {
                    const typed = await askInput({ title: dict.orgDetail.permanentDeleteTitle, description: t("orgDetail.permanentDeleteDesc", { name: data.name }), inputLabel: dict.orgDetail.orgNameLabel, confirmLabel: dict.common.proceed, danger: true });
                    if (typed !== data.name) { toast(dict.orgDetail.nameMismatch, "error"); return; }
                    const reason = await askInput({ title: dict.orgDetail.permanentReasonTitle, inputLabel: dict.common.reason, inputRequired: true, confirmLabel: dict.orgDetail.permanentConfirm, danger: true });
                    if (!reason) return;
                    try {
                      const out = await apiFetch<any>(`/admin/orgs/${id}/delete-permanent`, { method: "POST", body: JSON.stringify({ confirmName: typed, reason }) });
                      setMsg(t("orgDetail.permanentDone", { certificate: Object.entries(out.certificate).map(([k, v]) => `${k}:${v}`).join(", ") }));
                      setTimeout(() => { window.location.href = "/orgs"; }, 3500);
                    } catch (e) { toast(e instanceof Error ? e.message : dict.orgDetail.deletionFailed, "error"); }
                  }}>{dict.orgDetail.permanentDeleteButton}</button>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-slate-400">{dict.orgDetail.dangerNote}</p>
            </div>
            <div className="border-t border-slate-800 pt-3">
              <div className="mb-2 font-semibold">{dict.orgDetail.verificationTitle}</div>
              <div className="space-y-1.5 text-sm">
                <div><span className="text-slate-400">{dict.orgDetail.statusLabel}</span>{" "}
                  {data.verificationStatus === "verified" ? <span className="abadge-green">{dict.orgDetail.verifiedBadge}</span>
                    : data.verificationStatus === "pending" ? <span className="abadge-amber">{dict.orgDetail.pendingBadge}</span>
                    : data.verificationStatus === "rejected" ? <span className="abadge-amber">{dict.orgDetail.rejectedBadge}</span>
                    : <span className="abadge-amber">{data.verificationStatus ?? "unverified"}</span>}
                  {data.verificationSubmittedAt ? <span className="ml-2 text-xs text-slate-500">{t("orgDetail.submittedAt", { date: fmtDateTime(locale, data.verificationSubmittedAt) })}</span> : null}
                </div>
                <div><span className="text-slate-400">{dict.orgDetail.tradeLicense}</span> {data.businessProfile?.tradeLicenseNo ?? "—"}</div>
                <div><span className="text-slate-400">{dict.orgDetail.businessAddress}</span> {data.businessProfile?.businessAddress ?? data.businessProfile?.address ?? "—"}</div>
                <div><span className="text-slate-400">{dict.orgDetail.contact}</span> {data.businessProfile?.contactPhone ?? "—"} · {data.businessProfile?.contactEmail ?? "—"}</div>
                {data.verificationNote ? <div><span className="text-slate-400">{dict.orgDetail.lastNote}</span> “{data.verificationNote}”</div> : null}
                <div><span className="text-slate-400">{dict.orgDetail.storageUsage}</span> {t("orgDetail.storageFiles", { size: formatBytes(data.storageBytes, locale, dict), count: fmtNumber(locale, data.storageAssetCount ?? 0) })} <span className="text-xs text-slate-500">({data.storageMeteredFrom ?? dict.orgDetail.storageMeteredFallback})</span></div>
              </div>
              {data.verificationStatus === "pending" ? (
                <div className="mt-3 space-y-2">
                  <input className="ainput w-full" placeholder={dict.orgDetail.verificationNotePlaceholder} value={verificationNote} onChange={(e) => setVerificationNote(e.target.value)} />
                  <div className="flex flex-wrap gap-2">
                    <button className="abtn" onClick={async () => {
                      try {
                        await apiFetch(`/admin/organizations/${id}/verification`, { method: "POST", body: JSON.stringify({ decision: "approve", note: verificationNote.trim() || undefined }) });
                        setMsg(dict.orgDetail.approvedMsg);
                        setVerificationNote("");
                        await load();
                      } catch (e) { setMsg(e instanceof Error ? e.message : dict.common.failed); }
                    }}>{dict.orgDetail.approveButton}</button>
                    <button className="abtn-danger" onClick={async () => {
                      if (!verificationNote.trim()) { setMsg(dict.orgDetail.rejectNeedsNote); return; }
                      try {
                        await apiFetch(`/admin/organizations/${id}/verification`, { method: "POST", body: JSON.stringify({ decision: "reject", note: verificationNote.trim() }) });
                        setMsg(dict.orgDetail.rejectedMsg);
                        setVerificationNote("");
                        await load();
                      } catch (e) { setMsg(e instanceof Error ? e.message : dict.common.failed); }
                    }}>{dict.orgDetail.rejectButton}</button>
                  </div>
                  <p className="text-xs text-slate-500">{dict.orgDetail.verificationNote}</p>
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate-500">{dict.orgDetail.noPendingVerification}</p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {tab === "billing" ? (
        <div className="atab-panel grid gap-4 lg:grid-cols-3">
          <div className="acard space-y-2 text-sm">
            <div className="font-semibold">{dict.orgDetail.subscriptionEditTitle}</div>
            <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-800 p-3">
              <label className="text-xs text-slate-400">{dict.orgDetail.planLabel}
                <select id="sub-plan" className="ainput mt-1 w-32" defaultValue={data.subscription?.plan ?? "FREE"}>{["FREE", "STARTER", "GROWTH", "AGENCY"].map((pl) => <option key={pl} value={pl}>{pl}</option>)}</select></label>
              <label className="text-xs text-slate-400">{dict.orgDetail.statusLabel2}
                <select id="sub-status" className="ainput mt-1 w-32" defaultValue={data.subscription?.status ?? "TRIALING"}>{["TRIALING", "ACTIVE", "PAST_DUE", "CANCELLED"].map((st) => <option key={st} value={st}>{st}</option>)}</select></label>
              <label className="text-xs text-slate-400">{dict.orgDetail.periodEndLabel}
                <input id="sub-end" className="ainput mt-1 w-40" type="date" defaultValue={data.subscription?.currentPeriodEnd ? new Date(data.subscription.currentPeriodEnd).toISOString().slice(0, 10) : ""} /></label>
              <button className="abtn-secondary" onClick={async () => {
                const reason = await askInput({ title: dict.orgDetail.subscriptionReasonTitle, inputLabel: dict.common.reason, inputRequired: true, confirmLabel: dict.common.proceed });
                if (!reason) return;
                const plan = (document.getElementById("sub-plan") as HTMLSelectElement).value;
                const status = (document.getElementById("sub-status") as HTMLSelectElement).value;
                const end = (document.getElementById("sub-end") as HTMLInputElement).value;
                try {
                  await apiFetch(`/admin/orgs/${id}/subscription`, { method: "PATCH", body: JSON.stringify({ plan, status, currentPeriodEnd: end || null, reason }) });
                  toast(dict.orgDetail.subscriptionSaved);
                  await load();
                } catch (e) { toast(e instanceof Error ? e.message : dict.common.failed, "error"); }
              }}>{dict.orgDetail.subscriptionSaveButton}</button>
            </div>
          </div>
          <div className="acard space-y-3">
            <div className="font-semibold">{dict.orgDetail.limitsTitle}</div>
            {([[ "aiDailyLimitOverride", dict.orgDetail.limitAi], ["broadcastCapOverride", dict.orgDetail.limitBroadcast], ["seatLimit", dict.orgDetail.limitSeats]] as const).map(([field, label]) => (
              <label key={field} className="block text-sm">{label}
                <input className="ainput mt-1" type="number" min={0} value={limits[field]} onChange={(e) => setLimits({ ...limits, [field]: e.target.value })} placeholder={dict.orgDetail.planDefaultPlaceholder} />
              </label>
            ))}
            <button className="abtn" onClick={async () => {
              const num = (v: string) => (v.trim() === "" ? null : Number(v));
              try {
                await apiFetch(`/admin/orgs/${id}/limits`, { method: "PATCH", body: JSON.stringify({ aiDailyLimitOverride: num(limits.aiDailyLimitOverride), broadcastCapOverride: num(limits.broadcastCapOverride), seatLimit: num(limits.seatLimit) }) });
                toast(dict.orgDetail.limitsSaved);
                await load();
              } catch (e) { toast(e instanceof Error ? e.message : dict.common.failed, "error"); }
            }}>{dict.orgDetail.limitsSave}</button>
            <p className="text-xs text-slate-400">{dict.orgDetail.limitsNote}</p>
          </div>
          <div className="acard space-y-2">
            <div className="font-semibold">{dict.orgDetail.flagsTitle}</div>
            {flags.knownFlags.map((key) => {
              const current = flags.flags.find((f) => f.key === key);
              return (
                <label key={key} className="flex items-center justify-between text-sm">{key}
                  <input type="checkbox" checked={current?.enabled ?? false} onChange={async (e) => {
                    await apiFetch(`/admin/orgs/${id}/flags`, { method: "POST", body: JSON.stringify({ key, enabled: e.target.checked }) });
                    await load();
                  }} />
                </label>
              );
            })}
            {flags.knownFlags.length === 0 ? <EmptyState title={dict.orgDetail.noFlagsTitle} sub={dict.orgDetail.noFlagsSub} /> : null}
            <p className="text-xs text-slate-400">{dict.orgDetail.flagsNote}</p>
          </div>
          <div className="acard space-y-2">
            <div className="font-semibold">{dict.orgDetail.whiteLabelTitle}</div>
            <label className="flex items-center justify-between gap-3 text-sm">White-label
              <input type="checkbox" checked={data.whiteLabel ?? false} onChange={async (e) => {
                const next = e.target.checked;
                try {
                  // whiteLabel persists via the org-update PATCH this page already
                  // uses for limits (LimitsDto) — there is no PATCH /admin/orgs/:id route.
                  await apiFetch(`/admin/orgs/${id}/limits`, { method: "PATCH", body: JSON.stringify({ whiteLabel: next }) });
                  setMsg(next ? dict.orgDetail.whiteLabelOn : dict.orgDetail.whiteLabelOff);
                  await load();
                } catch (err) { setMsg(err instanceof Error ? err.message : dict.orgDetail.whiteLabelFailed); }
              }} />
            </label>
            <p className="text-xs text-slate-500">{dict.orgDetail.whiteLabelNote}</p>
          </div>
        </div>
      ) : null}

      {tab === "activity" ? (
        <div className="atab-panel">
          <div className="acard space-y-2">
            <div className="font-semibold">{dict.orgDetail.supportViewTitle}</div>
            {!support ? <div className="askel-line" aria-hidden="true" /> : (
              <>
                <div className="text-sm text-slate-400">{dict.orgDetail.recentOrders}</div>
                {support.recentOrders.map((o) => <div key={o.id} className="rounded bg-slate-800 px-2 py-1.5 text-sm">#{o.externalNumber ?? o.id.slice(0, 8)} · {o.status} · {o.totalMinor}</div>)}
                {support.recentOrders.length === 0 ? <EmptyState title={dict.orgDetail.noOrdersTitle} sub={dict.orgDetail.noOrdersSub} /> : null}
                <div className="pt-1 text-sm text-slate-400">{dict.orgDetail.recentConversations}</div>
                {support.recentConversations.map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded bg-slate-800 px-2 py-1.5 text-sm">
                    <span>{c.channel} · {c.contactName ?? "—"} · {t("orgDetail.messageCount", { count: fmtNumber(locale, c.messageCount) })}</span>
                    <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={async () => {
                      const reason = await askInput({ title: dict.orgDetail.viewMessagesReason, inputLabel: dict.common.reason, inputRequired: true, confirmLabel: dict.common.proceed });
                      if (!reason) return;
                      try {
                        const out: any = await apiFetch(`/admin/orgs/${id}/support-view/conversations/${c.id}/messages`, { method: "POST", body: JSON.stringify({ reason }) });
                        setConvMessages(out.messages);
                      } catch (e) { toast(e instanceof Error ? e.message : dict.common.failed, "error"); }
                    }}>{dict.orgDetail.viewAction}</button>
                  </div>
                ))}
                {support.recentConversations.length === 0 ? <EmptyState title={dict.orgDetail.noConversationsTitle} sub={dict.orgDetail.noConversationsSub} /> : null}
                {convMessages.length > 0 ? (
                  <div className="max-h-56 space-y-1 overflow-auto rounded-lg border border-amber-500/30 bg-amber-500/5 p-2">
                    <div className="text-xs text-amber-300">{dict.orgDetail.contentAccessWarning}</div>
                    {convMessages.map((m, i) => <div key={i} className="text-sm"><span className="text-slate-400">{m.direction}:</span> {m.body ?? "—"}</div>)}
                  </div>
                ) : null}
              </>
            )}
          </div>
          <ViewAsCard orgId={id} />
          <OrgHistory orgId={id} />
        </div>
      ) : null}

      {tab === "notes" ? (
        <div className="atab-panel">
          <div className="acard">
            <div className="mb-2 font-medium">{dict.orgDetail.notesTitle}</div>
            <div className="flex gap-2">
              <input className="ainput" placeholder={dict.orgDetail.notePlaceholder} value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="abtn-secondary" onClick={async () => { if (!note.trim()) return; try { await apiFetch("/admin/notes", { method: "POST", body: JSON.stringify({ targetType: "organization", targetId: id, body: note }) }); setNote(""); toast(dict.orgDetail.noteAdded); await load(); } catch (e) { toast(e instanceof Error ? e.message : dict.orgDetail.noteAddFailed, "error"); } }}>{dict.orgDetail.noteAdd}</button>
            </div>
            <ul className="mt-2 space-y-1 text-sm text-slate-400">{notes.map((n) => <li key={n.id} className="rounded bg-slate-800 px-2 py-1.5">{n.body} <span className="text-xs text-slate-400">· {fmtDateTime(locale, n.createdAt)}</span></li>)}</ul>
            {notes.length === 0 ? <EmptyState title={dict.orgDetail.noNotesTitle} sub={dict.orgDetail.noNotesSub} /> : null}
          </div>
        </div>
      ) : null}
      <div className="h-16 lg:hidden" aria-hidden="true" />
    </AdminShell>
  );
}

function ViewAsCard({ orgId }: { orgId: string }) {
  const { dict, t } = useAdminLocale();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const start = async (mode: "read" | "write") => {
    const reason = await askInput({ title: t("orgDetail.viewAsReason", { mode: mode === "write" ? dict.orgDetail.viewAsWriteMode : dict.orgDetail.viewAsReadMode }), inputLabel: dict.common.reason, inputRequired: true, confirmLabel: dict.common.proceed });
    if (!reason) return;
    if (mode === "write" && !(await askConfirm({ title: dict.orgDetail.viewAsWriteConfirmTitle, description: dict.orgDetail.viewAsWriteConfirmDesc, confirmLabel: dict.orgDetail.viewAsWriteConfirm, danger: true }))) return;
    setBusy(true); setErr("");
    try {
      const out = await apiFetch<{ url: string; targetUser: { email: string; role: string } }>(`/admin/orgs/${orgId}/view-as`, { method: "POST", body: JSON.stringify({ mode, reason }) });
      window.open(out.url, "_blank", "noopener");
    } catch (e) { setErr(e instanceof Error ? e.message : dict.orgDetail.viewAsFailed); }
    setBusy(false);
  };
  return (
    <div className="acard mt-4">
      <div className="mb-2 font-semibold">{dict.orgDetail.viewAsTitle}</div>
      <p className="text-sm text-slate-400">{dict.orgDetail.viewAsNote}</p>
      {err ? <p className="mt-2 text-sm text-red-400">{err}</p> : null}
      <div className="mt-3 flex gap-2">
        <button className="abtn abtn-primary" disabled={busy} onClick={() => start("read")}>{dict.orgDetail.viewAsReadButton}</button>
        <button className="abtn" disabled={busy} onClick={() => start("write")}>{dict.orgDetail.viewAsWriteButton}</button>
      </div>
    </div>
  );
}

function OrgHistory({ orgId }: { orgId: string }) {
  const { dict, locale } = useAdminLocale();
  const [events, setEvents] = React.useState<{ at: string; kind: string; title: string; detail: string | null }[] | null>(null);
  React.useEffect(() => {
    apiFetch<{ events: { at: string; kind: string; title: string; detail: string | null }[] }>(`/admin/orgs/${orgId}/timeline360`)
      .then((h) => setEvents(h.events))
      .catch(() => setEvents([]));
  }, [orgId]);
  const icon = (kind: string) => (kind === "payment" ? "💳" : kind === "subscription" ? "📦" : kind === "order" ? "🛒" : kind === "conversation" ? "💬" : kind === "sync" ? "🔄" : kind === "ticket" ? "🎫" : "🧾");
  return (
    <div className="acard mt-4">
      <div className="mb-3 font-semibold">{dict.orgDetail.historyTitle}</div>
      {events === null ? <div className="askel-line" aria-hidden="true" />
        : events.length === 0 ? <EmptyState title={dict.orgDetail.noEventsTitle} sub={dict.orgDetail.noEventsSub} /> : (
          <ol className="relative border-l border-slate-800 pl-5">
            {events.slice(0, 30).map((e, i) => (
              <li key={i} className="relative pb-3.5 last:pb-0">
                <span className="absolute -left-[25px] top-0 flex h-4 w-4 items-center justify-center text-[10px]">{icon(e.kind)}</span>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm">{e.title}{e.detail ? <span className="ml-1.5 text-slate-400">{e.detail}</span> : null}</span>
                  <span className="text-xs text-slate-400">{fmtDateTime(locale, e.at)}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
    </div>
  );
}
