"use client";
import React from "react";
import { useParams } from "next/navigation";
import AdminShell, { reasonPrompt } from "@/components/AdminShell";
import { API_URL, apiFetch, getAdminToken } from "@/lib/api";

interface OrgDetail {
  id: string; name: string; slug: string; status: string; country: string; currency: string; timezone: string; createdAt: string;
  members: { id: string; role: string; user?: { email: string; name: string; status: string } | null }[];
  integrations: { id: string; provider: string; status: string }[];
  subscription?: { plan: string; status: string; currentPeriodEnd?: string | null } | null;
  counts: { products: number; orders: number; conversations: number; campaigns: number };
  aiDailyLimitOverride?: number | null; broadcastCapOverride?: number | null; seatLimit?: number | null;
}

export default function OrgDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const [data, setData] = React.useState<OrgDetail | null>(null);
  const [notes, setNotes] = React.useState<{ id: string; body: string; createdAt: string }[]>([]);
  const [note, setNote] = React.useState("");
  const [msg, setMsg] = React.useState("");
  const [limits, setLimits] = React.useState<{ aiDailyLimitOverride: string; broadcastCapOverride: string; seatLimit: string }>({ aiDailyLimitOverride: "", broadcastCapOverride: "", seatLimit: "" });
  const [flags, setFlags] = React.useState<{ knownFlags: string[]; flags: { key: string; enabled: boolean }[] }>({ knownFlags: [], flags: [] });
  const [support, setSupport] = React.useState<{ recentOrders: { id: string; externalNumber?: string | null; status: string; totalMinor: string }[]; recentConversations: { id: string; channel: string; status: string; contactName?: string | null; messageCount: number }[] } | null>(null);
  const [convMessages, setConvMessages] = React.useState<{ direction: string; body?: string | null; createdAt: string }[]>([]);
  const load = React.useCallback(async () => {
    const d = await apiFetch<OrgDetail>(`/admin/orgs/${id}`).catch(() => null);
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
    const r = reasonPrompt(label);
    if (!r) return;
    try {
      await apiFetch(`/admin/orgs/${id}/status`, { method: "POST", body: JSON.stringify({ status, reason: r }) });
      setMsg(`${label} সম্পন্ন হয়েছে।`);
      await load();
    } catch (e) { setMsg(e instanceof Error ? e.message : "ব্যর্থ হয়েছে"); }
  }
  if (!data) return <AdminShell title="🏢 Organization"><p className="text-slate-400">লোড হচ্ছে…</p></AdminShell>;
  return (
    <AdminShell title={`🏢 ${data.name}`}>
      {msg ? <p className="mb-3 rounded-lg bg-indigo-500/10 p-3 text-sm text-indigo-200">{msg}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="acard space-y-2 text-sm">
          <div><span className="text-slate-400">Slug:</span> {data.slug} · <span className="text-slate-400">দেশ:</span> {data.country} · <span className="text-slate-400">মুদ্রা:</span> {data.currency}</div>
          <div><span className="text-slate-400">অবস্থা:</span> <span className={data.status === "ACTIVE" ? "abadge-green" : "abadge-amber"}>{data.status}</span></div>
          <div><span className="text-slate-400">Subscription:</span> {data.subscription ? `${data.subscription.plan} · ${data.subscription.status}${data.subscription.currentPeriodEnd ? ` · মেয়াদ শেষ ${new Date(data.subscription.currentPeriodEnd).toLocaleDateString("bn-BD")}` : ""}` : "কোনো Subscription রেকর্ড নেই"}</div>
          <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-800 p-3">
            <label className="text-xs text-slate-400">Plan
              <select id="sub-plan" className="ainput mt-1 w-32" defaultValue={data.subscription?.plan ?? "FREE"}>{["FREE", "STARTER", "GROWTH", "AGENCY"].map((pl) => <option key={pl} value={pl}>{pl}</option>)}</select></label>
            <label className="text-xs text-slate-400">Status
              <select id="sub-status" className="ainput mt-1 w-32" defaultValue={data.subscription?.status ?? "TRIALING"}>{["TRIALING", "ACTIVE", "PAST_DUE", "CANCELLED"].map((st) => <option key={st} value={st}>{st}</option>)}</select></label>
            <label className="text-xs text-slate-400">মেয়াদ শেষ
              <input id="sub-end" className="ainput mt-1 w-40" type="date" defaultValue={data.subscription?.currentPeriodEnd ? new Date(data.subscription.currentPeriodEnd).toISOString().slice(0, 10) : ""} /></label>
            <button className="abtn-secondary" onClick={async () => {
              const reason = window.prompt("Subscription বদলের কারণ (Audit এ থাকবে):");
              if (!reason || reason.trim().length < 3) return;
              const plan = (document.getElementById("sub-plan") as HTMLSelectElement).value;
              const status = (document.getElementById("sub-status") as HTMLSelectElement).value;
              const end = (document.getElementById("sub-end") as HTMLInputElement).value;
              try {
                await apiFetch(`/admin/orgs/${id}/subscription`, { method: "PATCH", body: JSON.stringify({ plan, status, currentPeriodEnd: end || null, reason }) });
                setMsg("Subscription আপডেট হয়েছে। Plan বদলালে Limit সঙ্গে সঙ্গে কার্যকর হয়।");
                await load();
              } catch (e) { setMsg(e instanceof Error ? e.message : "ব্যর্থ"); }
            }}>💳 Subscription সেভ</button>
          </div>
          <div className="grid grid-cols-4 gap-2 pt-2 text-center">
            {([["পণ্য", data.counts.products], ["অর্ডার", data.counts.orders], ["কথোপকথন", data.counts.conversations], ["ক্যাম্পেইন", data.counts.campaigns]] as const).map(([label, v]) => (
              <div key={label} className="rounded-lg bg-slate-800 p-2"><div className="text-lg font-bold">{v}</div><div className="text-xs text-slate-500">{label}</div></div>
            ))}
          </div>
          <div className="pt-2 font-medium">সদস্যবৃন্দ</div>
          {data.members.map((m) => <div key={m.id} className="rounded-lg bg-slate-800 px-3 py-2">{m.user?.name ?? "?"} <span className="text-slate-500">{m.user?.email}</span> — <b>{m.role}</b>{m.user?.status !== "ACTIVE" ? <span className="abadge-amber ml-2">{m.user?.status}</span> : null}</div>)}
          <div className="pt-2 font-medium">Integrations (শুধু অবস্থা — গোপন তথ্য কখনো দেখানো হয় না)</div>
          {data.integrations.map((i) => <div key={i.id} className="rounded-lg bg-slate-800 px-3 py-2">{i.provider} — {i.status}</div>)}
          {data.integrations.length === 0 ? <p className="text-slate-500">কোনো Integration নেই।</p> : null}
        </div>
        <div className="acard space-y-3">
          <div className="font-semibold">অ্যাকশন (কারণসহ Audit হবে)</div>
          <div className="flex flex-wrap gap-2">
            {data.status === "ACTIVE" ? <button className="abtn-secondary" onClick={() => setStatus("SUSPENDED", "Suspend Organization")}>⏸ Suspend (সদস্যদের লগইন বন্ধ)</button> : null}
            {data.status !== "ACTIVE" ? <button className="abtn" onClick={() => setStatus("ACTIVE", "Reactivate Organization")}>✅ আবার সক্রিয় করুন</button> : null}
            {data.status !== "DELETED" ? <button className="abtn-danger" onClick={() => setStatus("DELETED", "Soft-Delete Organization")}>🗑 Soft-Delete</button> : null}
          </div>
          <p className="text-xs text-slate-500">Suspend করলে Tenant এর সব সদস্যের প্রবেশ বন্ধ থাকবে, কিন্তু কোনো ডেটা মুছবে না।</p>
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
                  setMsg("Export ডাউনলোড হয়েছে (Audit এ রেকর্ড আছে)। Credential কখনোই Export এ থাকে না।");
                } catch (e) { setMsg(e instanceof Error ? e.message : "Export ব্যর্থ"); }
              }}>⬇ সম্পূর্ণ Data Export (JSON)</button>
              {data.status === "DELETED" ? (
                <button className="abtn-danger" onClick={async () => {
                  const typed = window.prompt(`স্থায়ীভাবে মুছতে Org এর নাম হুবহু লিখুন: "${data.name}" — এটি আর ফেরানো যাবে না। আগে Export নিয়ে রাখুন।`);
                  if (typed !== data.name) { setMsg("নাম মেলেনি — স্থায়ী Deletion বাতিল।"); return; }
                  const reason = window.prompt("স্থায়ী Deletion এর কারণ (Audit Certificate এ থাকবে):");
                  if (!reason || reason.trim().length < 3) return;
                  try {
                    const out = await apiFetch<any>(`/admin/orgs/${id}/delete-permanent`, { method: "POST", body: JSON.stringify({ confirmName: typed, reason }) });
                    setMsg(`স্থায়ীভাবে মোছা হয়েছে। Certificate: ${Object.entries(out.certificate).map(([k, v]) => `${k}:${v}`).join(", ")}`);
                    setTimeout(() => { window.location.href = "/orgs"; }, 3500);
                  } catch (e) { setMsg(e instanceof Error ? e.message : "Deletion ব্যর্থ"); }
                }}>☠ স্থায়ীভাবে মুছুন (শুধু SUPER)</button>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-slate-500">স্থায়ী Deletion শুধু DELETED অবস্থার Org এর জন্য, নাম হুবহু লিখে নিশ্চিত করতে হয়। Deletion Certificate (কোন Table থেকে কত Row) Platform Audit Log এ থেকে যায়।</p>
          </div>
          <div className="border-t border-slate-800 pt-3">
            <div className="mb-2 font-medium">Admin নোট</div>
            <div className="flex gap-2">
              <input className="ainput" placeholder="অভ্যন্তরীণ নোট লিখুন…" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="abtn-secondary" onClick={async () => { if (!note.trim()) return; await apiFetch("/admin/notes", { method: "POST", body: JSON.stringify({ targetType: "organization", targetId: id, body: note }) }); setNote(""); await load(); }}>যোগ</button>
            </div>
            <ul className="mt-2 space-y-1 text-sm text-slate-400">{notes.map((n) => <li key={n.id} className="rounded bg-slate-800 px-2 py-1.5">{n.body} <span className="text-xs text-slate-500">· {new Date(n.createdAt).toLocaleString("bn-BD")}</span></li>)}</ul>
          </div>
        </div>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="acard space-y-3">
          <div className="font-semibold">🎚 Limit Override (ফাঁকা = Plan এর সীমা)</div>
          {([["aiDailyLimitOverride", "AI বার্তা / দিন"], ["broadcastCapOverride", "Broadcast প্রাপক / পাঠানো"], ["seatLimit", "Seat সংখ্যা"]] as const).map(([field, label]) => (
            <label key={field} className="block text-sm">{label}
              <input className="ainput mt-1" type="number" min={0} value={limits[field]} onChange={(e) => setLimits({ ...limits, [field]: e.target.value })} placeholder="Plan default" />
            </label>
          ))}
          <button className="abtn" onClick={async () => {
            const num = (v: string) => (v.trim() === "" ? null : Number(v));
            try {
              await apiFetch(`/admin/orgs/${id}/limits`, { method: "PATCH", body: JSON.stringify({ aiDailyLimitOverride: num(limits.aiDailyLimitOverride), broadcastCapOverride: num(limits.broadcastCapOverride), seatLimit: num(limits.seatLimit) }) });
              setMsg("Limit আপডেট হয়েছে (Audit এ সংরক্ষিত)।");
              await load();
            } catch (e) { setMsg(e instanceof Error ? e.message : "ব্যর্থ হয়েছে"); }
          }}>Limit সেভ করুন</button>
          <p className="text-xs text-slate-500">ক্রম: Override → Plan (FREE/PRO/AGENCY) → System default।</p>
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
          <p className="text-xs text-slate-500">Flag বন্ধ থাকলে ওই Org এ সংশ্লিষ্ট Beta ফিচার দেখাবে না (Tenant অ্যাপ ফ্ল্যাগ পড়ে যেখানে প্রযোজ্য)।</p>
        </div>
        <div className="acard space-y-2">
          <div className="font-semibold">🕵 Support View (শুধু সারসংক্ষেপ)</div>
          {!support ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : (
            <>
              <div className="text-sm text-slate-400">সাম্প্রতিক Order</div>
              {support.recentOrders.map((o) => <div key={o.id} className="rounded bg-slate-800 px-2 py-1.5 text-sm">#{o.externalNumber ?? o.id.slice(0, 8)} · {o.status} · {o.totalMinor}</div>)}
              {support.recentOrders.length === 0 ? <p className="text-sm text-slate-500">কোনো Order নেই।</p> : null}
              <div className="pt-1 text-sm text-slate-400">সাম্প্রতিক কথোপকথন (বডি দেখতে কারণ লাগবে)</div>
              {support.recentConversations.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded bg-slate-800 px-2 py-1.5 text-sm">
                  <span>{c.channel} · {c.contactName ?? "—"} · {c.messageCount} বার্তা</span>
                  <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={async () => {
                    const reason = window.prompt("বার্তার বডি দেখার কারণ (Audit এ থাকবে):");
                    if (!reason || reason.trim().length < 3) return;
                    try {
                      const out: any = await apiFetch(`/admin/orgs/${id}/support-view/conversations/${c.id}/messages`, { method: "POST", body: JSON.stringify({ reason }) });
                      setConvMessages(out.messages);
                    } catch (e) { setMsg(e instanceof Error ? e.message : "ব্যর্থ"); }
                  }}>দেখুন</button>
                </div>
              ))}
              {convMessages.length > 0 ? (
                <div className="max-h-56 space-y-1 overflow-auto rounded-lg border border-amber-500/30 bg-amber-500/5 p-2">
                  <div className="text-xs text-amber-300">⚠ এই Content Access Audit Log এ রেকর্ড হয়েছে।</div>
                  {convMessages.map((m, i) => <div key={i} className="text-sm"><span className="text-slate-500">{m.direction}:</span> {m.body ?? "—"}</div>)}
                </div>
              ) : null}
            </>
          )}
        </div>

        <ViewAsCard orgId={id} />
        <OrgHistory orgId={id} />
      </div>
    </AdminShell>
  );
}

function ViewAsCard({ orgId }: { orgId: string }) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const start = async (mode: "read" | "write") => {
    const reason = window.prompt(`View-As (${mode === "write" ? "WRITE" : "Read-only"}) শুরুর কারণ — Audit এ থাকবে:`);
    if (!reason || reason.trim().length < 3) return;
    if (mode === "write" && !window.confirm("Write মোডে Tenant ওয়ার্কস্পেসে পরিবর্তন করা যাবে। নিশ্চিত তো?")) return;
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
      <p className="text-sm text-slate-500">৩০ মিনিটের সেশন, Org এর OWNER হিসেবে ঢুকবেন। Read-only ই ডিফল্ট; Write মোড শুধু SUPER Admin দের জন্য — দুটোই কারণসহ Audit হয়।</p>
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
      {events === null ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p>
        : events.length === 0 ? <p className="text-sm text-slate-500">কোনো ইভেন্ট নেই।</p> : (
          <ol className="relative border-l border-slate-800 pl-5">
            {events.slice(0, 30).map((e, i) => (
              <li key={i} className="relative pb-3.5 last:pb-0">
                <span className="absolute -left-[25px] top-0 flex h-4 w-4 items-center justify-center text-[10px]">{icon(e.kind)}</span>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm">{e.title}{e.detail ? <span className="ml-1.5 text-slate-500">{e.detail}</span> : null}</span>
                  <span className="text-xs text-slate-500">{new Date(e.at).toLocaleString("bn-BD")}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
    </div>
  );
}
