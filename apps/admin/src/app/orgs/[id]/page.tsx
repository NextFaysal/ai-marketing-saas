"use client";
import React from "react";
import { useParams } from "next/navigation";
import AdminShell, { reasonDialog } from "@/components/AdminShell";
import Breadcrumb from "@/components/Breadcrumb";
import { EmptyState, ErrorState, PageHead, Tabs, askConfirm, askInput, toast } from "@/components/ui";
import { API_URL, apiFetch, getAdminToken } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";

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

function formatBytes(bytesStr?: string): string {
  const n = Number(bytesStr ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "0 বাইট";
  const units = ["বাইট", "KB", "MB", "GB", "TB"];
  let v = n; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toLocaleString("bn-BD", { maximumFractionDigits: 2 })} ${units[i]}`;
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
  const [tags, setTags] = React.useState<string[]>(initial);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { setTags(initial); }, [initial]);
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    if (t.length > 40) { toast("একটি Tag সর্বোচ্চ ৪০ অক্ষরের হতে পারে।", "error"); return; }
    if (tags.includes(t)) { toast("এই Tag ইতিমধ্যে আছে।", "error"); return; }
    if (tags.length >= 20) { toast("সর্বোচ্চ ২০টি Tag রাখা যায়।", "error"); return; }
    setTags([...tags, t]);
    setDraft("");
  };
  const save = async () => {
    setBusy(true);
    try {
      const out = await apiFetch<{ tags: string[] }>(`/admin/orgs/${orgId}/tags`, { method: "PATCH", body: JSON.stringify({ tags }) });
      setTags(out.tags);
      toast("Tag সংরক্ষিত হয়েছে (Audit-এ রেকর্ড আছে)।");
    } catch (e) { toast(e instanceof Error ? e.message : "Tag সেভ ব্যর্থ হয়েছে", "error"); }
    setBusy(false);
  };
  const dirty = JSON.stringify(tags) !== JSON.stringify(initial);
  return (
    <div className="acard space-y-3">
      <div className="font-semibold">🏷 Tags (শুধু অ্যাডমিনদের জন্য)</div>
      <p className="text-xs leading-relaxed text-slate-400">
        প্ল্যাটফর্ম টিমের অভ্যন্তরীণ শ্রেণিবিন্যাস — Tenant কখনোই এগুলো দেখে না। Organization তালিকায় Tag দিয়ে ছাঁকা যায়।
        সর্বোচ্চ ২০টি, প্রতিটি সর্বোচ্চ ৪০ অক্ষর; যেভাবে লিখবেন হুবহু সেভাবে থাকবে (বড়/ছোট হাতের হরফ বদলায় না)।
      </p>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800/70 py-0.5 pl-2.5 pr-1 text-xs text-slate-200">
            🏷 {t}
            <button type="button" className="rounded-full px-1 text-slate-400 hover:text-red-300" aria-label={`${t} Tag মুছুন`} onClick={() => setTags(tags.filter((x) => x !== t))}>✕</button>
          </span>
        ))}
        {tags.length === 0 ? <span className="text-xs text-slate-500">কোনো Tag নেই।</span> : null}
      </div>
      <div className="flex gap-2">
        <input className="ainput" placeholder="নতুন Tag লিখুন…" value={draft} maxLength={60}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button type="button" className="abtn-secondary" onClick={add}>যোগ</button>
      </div>
      <button type="button" className="abtn" disabled={busy || !dirty} onClick={save}>{busy ? "সেভ হচ্ছে…" : "Tag সেভ করুন"}</button>
    </div>
  );
}

/** ADX6 tabs — every tab's content already existed on this page;
 *  nothing new was invented, the stacked cards were regrouped:
 *  সারসংক্ষেপ = info/counts/members/integrations + Danger Zone,
 *  Billing ও Limit = subscription editor + limit override + flags,
 *  কার্যকলাপ = support view + view-as + 360 history,
 *  নোট = admin notes. */
const TABS = [
  { id: "summary", label: "সারসংক্ষেপ" },
  { id: "billing", label: "Billing ও Limit" },
  { id: "activity", label: "কার্যকলাপ" },
  { id: "notes", label: "নোট" },
];

export default function OrgDetailPage() {
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
      toast(`${label} সম্পন্ন হয়েছে।`);
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : "ব্যর্থ হয়েছে", "error"); }
  }
  if (!data) return <AdminShell title="🏢 Organization">{loadFailed ? <ErrorState message="Organization লোড হয়নি — আবার চেষ্টা করুন।" onRetry={load} /> : <div className="space-y-4" aria-hidden="true"><div className="askel-card" /><div className="askel-table" /></div>}</AdminShell>;
  return (
    <AdminShell title={`🏢 ${data.name}`}>
      {/* ADNX8: ONE detail pattern — PageHead carries the
          breadcrumb + status badges; the banner below now only
          ever shows the permanent-deletion certificate (long,
          persistent information a 6s toast cannot carry). */}
      <PageHead
        breadcrumb={<Breadcrumb items={[{ label: "Organizations", href: "/orgs" }, { label: data.name?.trim() ? data.name : `${id.slice(0, 8)}…` }]} />}
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
          {data.status === "ACTIVE" ? <button className="abtn-secondary" onClick={() => setStatus("SUSPENDED", "Suspend Organization")}>⏸ Suspend (সদস্যদের লগইন বন্ধ)</button> : null}
          {data.status !== "ACTIVE" ? <button className="abtn" onClick={() => setStatus("ACTIVE", "Reactivate Organization")}>✅ আবার সক্রিয় করুন</button> : null}
          {data.status !== "DELETED" ? <button className="abtn-danger" onClick={() => setStatus("DELETED", "Soft-Delete Organization")}>🗑 Soft-Delete</button> : null}
        </div>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === "summary" ? (
        <div className="atab-panel grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
          <div className="acard space-y-2 text-sm">
            <div><span className="text-slate-400">Slug:</span> {data.slug} · <span className="text-slate-400">দেশ:</span> {data.country} · <span className="text-slate-400">মুদ্রা:</span> {data.currency}</div>
            <div><span className="text-slate-400">অবস্থা:</span> <span className={data.status === "ACTIVE" ? "abadge-green" : "abadge-amber"}>{data.status}</span></div>
            <div><span className="text-slate-400">Subscription:</span> {data.subscription ? `${data.subscription.plan} · ${data.subscription.status}${data.subscription.currentPeriodEnd ? ` · মেয়াদ শেষ ${fmtDateTime(data.subscription.currentPeriodEnd, "date")}` : ""}` : "কোনো Subscription রেকর্ড নেই"}</div>
            <div className="grid grid-cols-4 gap-2 pt-2 text-center">
              {([[ "পণ্য", data.counts.products], ["অর্ডার", data.counts.orders], ["কথোপকথন", data.counts.conversations], ["ক্যাম্পেইন", data.counts.campaigns]] as const).map(([label, v]) => (
                <div key={label} className="rounded-lg bg-slate-800 p-2"><div className="text-lg font-bold">{v}</div><div className="text-xs text-slate-400">{label}</div></div>
              ))}
            </div>
            <div className="pt-2 font-medium">সদস্যবৃন্দ</div>
            {data.members.map((m) => <div key={m.id} className="rounded-lg bg-slate-800 px-3 py-2">{m.user?.name ?? "?"} <span className="text-slate-400">{m.user?.email}</span> — <b>{m.role}</b>{m.user?.status !== "ACTIVE" ? <span className="abadge-amber ml-2">{m.user?.status}</span> : null}</div>)}
            {data.members.length === 0 ? <EmptyState title="কোনো সদস্য নেই।" sub="এই Organization-এ এখনো কোনো সদস্য যোগ হয়নি।" /> : null}
            <div className="pt-2 font-medium">Integrations (শুধু অবস্থা — গোপন তথ্য কখনো দেখানো হয় না)</div>
            {data.integrations.map((i) => <div key={i.id} className="rounded-lg bg-slate-800 px-3 py-2">{i.provider} — {i.status}</div>)}
            {data.integrations.length === 0 ? <p className="text-slate-400">কোনো Integration নেই।</p> : null}
          </div>
          <OrgTagsCard orgId={id} initial={data.tags ?? []} />
          </div>
          <div className="acard space-y-3">
            <div className="font-semibold">অ্যাকশন (কারণসহ Audit হবে)</div>
            <p className="text-xs text-slate-400">প্রধান অ্যাকশনগুলো (Suspend / Reactivate / Soft-Delete) এখন sticky header / মোবাইলে নিচের action bar-এ সবসময় দৃশ্যমান। Suspend করলে Tenant এর সব সদস্যের প্রবেশ বন্ধ থাকবে, কিন্তু কোনো ডেটা মুছবে না।</p>
            <div className="border-t border-red-900/50 pt-3">
              <div className="font-semibold text-red-300">☠ Danger Zone — Data Export ও স্থায়ী Deletion</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button className="abtn-secondary" onClick={async () => {
                  try {
                    const res = await fetch(`${API_URL}/admin/orgs/${id}/export`, { headers: { Authorization: `Bearer ${getAdminToken()}` } });
                    if (!res.ok) throw new Error("Export ব্যর্থ হয়েছে");
                    const blob = await res.blob();
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `org-export-${data.slug}.json`;
                    a.click();
                    URL.revokeObjectURL(a.href);
                    toast("Export ডাউনলোড হয়েছে (Audit এ রেকর্ড আছে)। Credential কখনোই Export এ থাকে না।");
                  } catch (e) { toast(e instanceof Error ? e.message : "Export ব্যর্থ", "error"); }
                }}>⬇ সম্পূর্ণ Data Export (JSON)</button>
                {data.status === "DELETED" ? (
                  <button className="abtn-danger" onClick={async () => {
                    const typed = await askInput({ title: "স্থায়ীভাবে মুছুন", description: `স্থায়ীভাবে মুছতে Org এর নাম হুবহু লিখুন: "${data.name}" — এটি আর ফেরানো যাবে না। আগে Export নিয়ে রাখুন।`, inputLabel: "Org এর নাম", confirmLabel: "এগিয়ে যান", danger: true });
                    if (typed !== data.name) { toast("নাম মেলেনি — স্থায়ী Deletion বাতিল।", "error"); return; }
                    const reason = await askInput({ title: "স্থায়ী Deletion এর কারণ (Audit Certificate এ থাকবে):", inputLabel: "কারণ", inputRequired: true, confirmLabel: "স্থায়ীভাবে মুছুন", danger: true });
                    if (!reason) return;
                    try {
                      const out = await apiFetch<any>(`/admin/orgs/${id}/delete-permanent`, { method: "POST", body: JSON.stringify({ confirmName: typed, reason }) });
                      setMsg(`স্থায়ীভাবে মোছা হয়েছে। Certificate: ${Object.entries(out.certificate).map(([k, v]) => `${k}:${v}`).join(", ")}`);
                      setTimeout(() => { window.location.href = "/orgs"; }, 3500);
                    } catch (e) { toast(e instanceof Error ? e.message : "Deletion ব্যর্থ", "error"); }
                  }}>☠ স্থায়ীভাবে মুছুন (শুধু SUPER)</button>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-slate-400">স্থায়ী Deletion শুধু DELETED অবস্থার Org এর জন্য, নাম হুবহু লিখে নিশ্চিত করতে হয়। Deletion Certificate (কোন Table থেকে কত Row) Platform Audit Log এ থেকে যায়।</p>
            </div>
            <div className="border-t border-slate-800 pt-3">
              <div className="mb-2 font-semibold">🏅 Merchant Verification (GC21)</div>
              <div className="space-y-1.5 text-sm">
                <div><span className="text-slate-400">অবস্থা:</span>{" "}
                  {data.verificationStatus === "verified" ? <span className="abadge-green">verified · যাচাইকৃত</span>
                    : data.verificationStatus === "pending" ? <span className="abadge-amber">pending · রিভিউ বাকি</span>
                    : data.verificationStatus === "rejected" ? <span className="abadge-amber">rejected · ফিরিয়ে দেওয়া</span>
                    : <span className="abadge-amber">{data.verificationStatus ?? "unverified"}</span>}
                  {data.verificationSubmittedAt ? <span className="ml-2 text-xs text-slate-500">জমা: {fmtDateTime(data.verificationSubmittedAt)}</span> : null}
                </div>
                <div><span className="text-slate-400">ট্রেড লাইসেন্স নম্বর:</span> {data.businessProfile?.tradeLicenseNo ?? "—"}</div>
                <div><span className="text-slate-400">ব্যবসার ঠিকানা:</span> {data.businessProfile?.businessAddress ?? data.businessProfile?.address ?? "—"}</div>
                <div><span className="text-slate-400">যোগাযোগ:</span> {data.businessProfile?.contactPhone ?? "—"} · {data.businessProfile?.contactEmail ?? "—"}</div>
                {data.verificationNote ? <div><span className="text-slate-400">শেষ নোট (মার্চেন্ট দেখেন):</span> “{data.verificationNote}”</div> : null}
                <div><span className="text-slate-400">স্টোরেজ ব্যবহার:</span> {formatBytes(data.storageBytes)} · {data.storageAssetCount ?? 0}টি ফাইল <span className="text-xs text-slate-500">({data.storageMeteredFrom ?? "মিডিয়া লাইব্রেরিতে রেকর্ডকৃত আপলোড থেকে হিসাব"})</span></div>
              </div>
              {data.verificationStatus === "pending" ? (
                <div className="mt-3 space-y-2">
                  <input className="ainput w-full" placeholder="নোট — Reject করলে আবশ্যক, মার্চেন্ট এটি দেখতে পাবেন" value={verificationNote} onChange={(e) => setVerificationNote(e.target.value)} />
                  <div className="flex flex-wrap gap-2">
                    <button className="abtn" onClick={async () => {
                      try {
                        await apiFetch(`/admin/organizations/${id}/verification`, { method: "POST", body: JSON.stringify({ decision: "approve", note: verificationNote.trim() || undefined }) });
                        setMsg("প্রতিষ্ঠানটি যাচাইকৃত (verified) করা হয়েছে।");
                        setVerificationNote("");
                        await load();
                      } catch (e) { setMsg(e instanceof Error ? e.message : "ব্যর্থ হয়েছে"); }
                    }}>✅ Approve — যাচাইকৃত করুন</button>
                    <button className="abtn-danger" onClick={async () => {
                      if (!verificationNote.trim()) { setMsg("Reject করতে নোট লিখুন — মার্চেন্ট সেই কারণ দেখে ঠিক করে আবার জমা দেবেন।"); return; }
                      try {
                        await apiFetch(`/admin/organizations/${id}/verification`, { method: "POST", body: JSON.stringify({ decision: "reject", note: verificationNote.trim() }) });
                        setMsg("আবেদন Reject করা হয়েছে — নোটসহ মার্চেন্টের কাছে পৌঁছেছে।");
                        setVerificationNote("");
                        await load();
                      } catch (e) { setMsg(e instanceof Error ? e.message : "ব্যর্থ হয়েছে"); }
                    }}>✗ Reject — ফিরিয়ে দিন</button>
                  </div>
                  <p className="text-xs text-slate-500">সিদ্ধান্ত Admin Audit Log এ রেকর্ড হয়। শুধু pending আবেদনই রিভিউ করা যায়।</p>
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate-500">রিভিউ করার মতো pending আবেদন নেই।</p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {tab === "billing" ? (
        <div className="atab-panel grid gap-4 lg:grid-cols-3">
          <div className="acard space-y-2 text-sm">
            <div className="font-semibold">💳 Subscription বদলান</div>
            <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-800 p-3">
              <label className="text-xs text-slate-400">Plan
                <select id="sub-plan" className="ainput mt-1 w-32" defaultValue={data.subscription?.plan ?? "FREE"}>{["FREE", "STARTER", "GROWTH", "AGENCY"].map((pl) => <option key={pl} value={pl}>{pl}</option>)}</select></label>
              <label className="text-xs text-slate-400">Status
                <select id="sub-status" className="ainput mt-1 w-32" defaultValue={data.subscription?.status ?? "TRIALING"}>{["TRIALING", "ACTIVE", "PAST_DUE", "CANCELLED"].map((st) => <option key={st} value={st}>{st}</option>)}</select></label>
              <label className="text-xs text-slate-400">মেয়াদ শেষ
                <input id="sub-end" className="ainput mt-1 w-40" type="date" defaultValue={data.subscription?.currentPeriodEnd ? new Date(data.subscription.currentPeriodEnd).toISOString().slice(0, 10) : ""} /></label>
              <button className="abtn-secondary" onClick={async () => {
                const reason = await askInput({ title: "Subscription বদলের কারণ (Audit এ থাকবে):", inputLabel: "কারণ", inputRequired: true, confirmLabel: "এগিয়ে যান" });
                if (!reason) return;
                const plan = (document.getElementById("sub-plan") as HTMLSelectElement).value;
                const status = (document.getElementById("sub-status") as HTMLSelectElement).value;
                const end = (document.getElementById("sub-end") as HTMLInputElement).value;
                try {
                  await apiFetch(`/admin/orgs/${id}/subscription`, { method: "PATCH", body: JSON.stringify({ plan, status, currentPeriodEnd: end || null, reason }) });
                  toast("Subscription আপডেট হয়েছে। Plan বদলালে Limit সঙ্গে সঙ্গে কার্যকর হয়।");
                  await load();
                } catch (e) { toast(e instanceof Error ? e.message : "ব্যর্থ", "error"); }
              }}>💳 Subscription সেভ</button>
            </div>
          </div>
          <div className="acard space-y-3">
            <div className="font-semibold">🎚 Limit Override (ফাঁকা = Plan এর সীমা)</div>
            {([[ "aiDailyLimitOverride", "AI বার্তা / দিন"], ["broadcastCapOverride", "Broadcast প্রাপক / পাঠানো"], ["seatLimit", "Seat সংখ্যা"]] as const).map(([field, label]) => (
              <label key={field} className="block text-sm">{label}
                <input className="ainput mt-1" type="number" min={0} value={limits[field]} onChange={(e) => setLimits({ ...limits, [field]: e.target.value })} placeholder="Plan default" />
              </label>
            ))}
            <button className="abtn" onClick={async () => {
              const num = (v: string) => (v.trim() === "" ? null : Number(v));
              try {
                await apiFetch(`/admin/orgs/${id}/limits`, { method: "PATCH", body: JSON.stringify({ aiDailyLimitOverride: num(limits.aiDailyLimitOverride), broadcastCapOverride: num(limits.broadcastCapOverride), seatLimit: num(limits.seatLimit) }) });
                toast("Limit আপডেট হয়েছে (Audit এ সংরক্ষিত)।");
                await load();
              } catch (e) { toast(e instanceof Error ? e.message : "ব্যর্থ হয়েছে", "error"); }
            }}>Limit সেভ করুন</button>
            <p className="text-xs text-slate-400">ক্রম: Override → Plan (FREE/PRO/AGENCY) → System default।</p>
          </div>
          <div className="acard space-y-2">
            <div className="font-semibold">🚩 Feature Flags</div>
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
            {flags.knownFlags.length === 0 ? <EmptyState title="কোনো Feature Flag নেই।" sub="এই Org-এর জন্য কোনো Flag সংজ্ঞায়িত নেই।" /> : null}
            <p className="text-xs text-slate-400">Flag বন্ধ থাকলে ওই Org এ সংশ্লিষ্ট Beta ফিচার দেখাবে না (Tenant অ্যাপ ফ্ল্যাগ পড়ে যেখানে প্রযোজ্য)।</p>
          </div>
          <div className="acard space-y-2">
            <div className="font-semibold">🏷 White-label (AX24)</div>
            <label className="flex items-center justify-between gap-3 text-sm">White-label
              <input type="checkbox" checked={data.whiteLabel ?? false} onChange={async (e) => {
                const next = e.target.checked;
                try {
                  // whiteLabel persists via the org-update PATCH this page already
                  // uses for limits (LimitsDto) — there is no PATCH /admin/orgs/:id route.
                  await apiFetch(`/admin/orgs/${id}/limits`, { method: "PATCH", body: JSON.stringify({ whiteLabel: next }) });
                  setMsg(next ? "White-label চালু হয়েছে — এই প্রতিষ্ঠানের দোকান/ইমেইলে প্ল্যাটফর্মের চিহ্ন আর থাকবে না।" : "White-label বন্ধ করা হয়েছে।");
                  await load();
                } catch (err) { setMsg(err instanceof Error ? err.message : "White-label আপডেট ব্যর্থ হয়েছে"); }
              }} />
            </label>
            <p className="text-xs text-slate-500">White-label — চালু থাকলে এই প্রতিষ্ঠানের দোকান/ইমেইলে প্ল্যাটফর্মের কোনো চিহ্ন থাকবে না</p>
          </div>
        </div>
      ) : null}

      {tab === "activity" ? (
        <div className="atab-panel">
          <div className="acard space-y-2">
            <div className="font-semibold">🕵 Support View (শুধু সারসংক্ষেপ)</div>
            {!support ? <div className="askel-line" aria-hidden="true" /> : (
              <>
                <div className="text-sm text-slate-400">সাম্প্রতিক Order</div>
                {support.recentOrders.map((o) => <div key={o.id} className="rounded bg-slate-800 px-2 py-1.5 text-sm">#{o.externalNumber ?? o.id.slice(0, 8)} · {o.status} · {o.totalMinor}</div>)}
                {support.recentOrders.length === 0 ? <EmptyState title="কোনো Order নেই।" sub="এই Organization-এর কোনো Order এখনো আসেনি।" /> : null}
                <div className="pt-1 text-sm text-slate-400">সাম্প্রতিক কথোপকথন (বডি দেখতে কারণ লাগবে)</div>
                {support.recentConversations.map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded bg-slate-800 px-2 py-1.5 text-sm">
                    <span>{c.channel} · {c.contactName ?? "—"} · {c.messageCount} বার্তা</span>
                    <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={async () => {
                      const reason = await askInput({ title: "বার্তার বডি দেখার কারণ (Audit এ থাকবে):", inputLabel: "কারণ", inputRequired: true, confirmLabel: "এগিয়ে যান" });
                      if (!reason) return;
                      try {
                        const out: any = await apiFetch(`/admin/orgs/${id}/support-view/conversations/${c.id}/messages`, { method: "POST", body: JSON.stringify({ reason }) });
                        setConvMessages(out.messages);
                      } catch (e) { toast(e instanceof Error ? e.message : "ব্যর্থ", "error"); }
                    }}>দেখুন</button>
                  </div>
                ))}
                {support.recentConversations.length === 0 ? <EmptyState title="কোনো কথোপকথন নেই।" sub="এই Organization-এর কোনো কথোপকথন এখনো আসেনি।" /> : null}
                {convMessages.length > 0 ? (
                  <div className="max-h-56 space-y-1 overflow-auto rounded-lg border border-amber-500/30 bg-amber-500/5 p-2">
                    <div className="text-xs text-amber-300">⚠ এই Content Access Audit Log এ রেকর্ড হয়েছে।</div>
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
            <div className="mb-2 font-medium">Admin নোট</div>
            <div className="flex gap-2">
              <input className="ainput" placeholder="অভ্যন্তরীণ নোট লিখুন…" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="abtn-secondary" onClick={async () => { if (!note.trim()) return; try { await apiFetch("/admin/notes", { method: "POST", body: JSON.stringify({ targetType: "organization", targetId: id, body: note }) }); setNote(""); toast("নোট যোগ হয়েছে।"); await load(); } catch (e) { toast(e instanceof Error ? e.message : "নোট যোগ ব্যর্থ হয়েছে", "error"); } }}>যোগ</button>
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

function ViewAsCard({ orgId }: { orgId: string }) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const start = async (mode: "read" | "write") => {
    const reason = await askInput({ title: `View-As (${mode === "write" ? "WRITE" : "Read-only"}) শুরুর কারণ — Audit এ থাকবে:`, inputLabel: "কারণ", inputRequired: true, confirmLabel: "এগিয়ে যান" });
    if (!reason) return;
    if (mode === "write" && !(await askConfirm({ title: "নিশ্চিত তো?", description: "Write মোডে Tenant ওয়ার্কস্পেসে পরিবর্তন করা যাবে।", confirmLabel: "Write View-As শুরু করুন", danger: true }))) return;
    setBusy(true); setErr("");
    try {
      const out = await apiFetch<{ url: string; targetUser: { email: string; role: string } }>(`/admin/orgs/${orgId}/view-as`, { method: "POST", body: JSON.stringify({ mode, reason }) });
      window.open(out.url, "_blank", "noopener");
    } catch (e) { setErr(e instanceof Error ? e.message : "View-As শুরু হয়নি"); }
    setBusy(false);
  };
  return (
    <div className="acard mt-4">
      <div className="mb-2 font-semibold">👁 View-As (Tenant ওয়ার্কস্পেস দেখুন)</div>
      <p className="text-sm text-slate-400">৩০ মিনিটের সেশন, Org এর OWNER হিসেবে ঢুকবেন। Read-only ই ডিফল্ট; Write মোড শুধু SUPER Admin দের জন্য — দুটোই কারণসহ Audit হয়।</p>
      {err ? <p className="mt-2 text-sm text-red-400">{err}</p> : null}
      <div className="mt-3 flex gap-2">
        <button className="abtn abtn-primary" disabled={busy} onClick={() => start("read")}>👁 Read-only View-As</button>
        <button className="abtn" disabled={busy} onClick={() => start("write")}>✏️ Write View-As (SUPER)</button>
      </div>
    </div>
  );
}

function OrgHistory({ orgId }: { orgId: string }) {
  const [events, setEvents] = React.useState<{ at: string; kind: string; title: string; detail: string | null }[] | null>(null);
  React.useEffect(() => {
    apiFetch<{ events: { at: string; kind: string; title: string; detail: string | null }[] }>(`/admin/orgs/${orgId}/timeline360`)
      .then((h) => setEvents(h.events))
      .catch(() => setEvents([]));
  }, [orgId]);
  const icon = (kind: string) => (kind === "payment" ? "💳" : kind === "subscription" ? "📦" : kind === "order" ? "🛒" : kind === "conversation" ? "💬" : kind === "sync" ? "🔄" : kind === "ticket" ? "🎫" : "🧾");
  return (
    <div className="acard mt-4">
      <div className="mb-3 font-semibold">📜 Org 360 ইতিহাস (Audit + পেমেন্ট + অর্ডার + কথোপকথন + Sync + Ticket)</div>
      {events === null ? <div className="askel-line" aria-hidden="true" />
        : events.length === 0 ? <EmptyState title="কোনো ইভেন্ট নেই।" sub="এই Org-এর ইতিহাসে এখনো কোনো ইভেন্ট রেকর্ড হয়নি।" /> : (
          <ol className="relative border-l border-slate-800 pl-5">
            {events.slice(0, 30).map((e, i) => (
              <li key={i} className="relative pb-3.5 last:pb-0">
                <span className="absolute -left-[25px] top-0 flex h-4 w-4 items-center justify-center text-[10px]">{icon(e.kind)}</span>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm">{e.title}{e.detail ? <span className="ml-1.5 text-slate-400">{e.detail}</span> : null}</span>
                  <span className="text-xs text-slate-400">{fmtDateTime(e.at)}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
    </div>
  );
}
