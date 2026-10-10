"use client";

import React from "react";
import AdminShell from "@/components/AdminShell";
import { apiFetch } from "@/lib/api";

interface Campaign { id: string; subject: string; audience: string; recipients: number; sent: number; failed: number; createdAt: string }
interface Changelog { id: string; version: string | null; title: string; body: string; published: boolean; publishedAt: string | null; createdAt: string }
interface ReferralBoard {
  config: { enabled: boolean; rewardMinor: number };
  totals: { signups: number; rewarded: number; paidOutMinor: number };
  recent: { id: string; code: string; status: string; referrerEmail: string | null; referredEmail: string | null; rewardMinor: number | null; createdAt: string }[];
}
interface FeedbackBoard {
  summary: { count: number; average: number | null; promoters: number; passives: number; detractors: number; nps: number | null };
  recent: { id: string; score: number; comment: string | null; organizationName: string | null; createdAt: string }[];
}
const AUDIENCES = [
  { value: "all", label: "সব সক্রিয় Org" }, { value: "trialing", label: "ট্রায়ালে থাকা" }, { value: "past_due", label: "পেমেন্ট বকেয়া" },
  { value: "plan_FREE", label: "FREE" }, { value: "plan_STARTER", label: "STARTER" }, { value: "plan_GROWTH", label: "GROWTH" }, { value: "plan_AGENCY", label: "AGENCY" },
];
const taka = (minor: number) => `৳${(minor / 100).toLocaleString("bn-BD")}`;

export default function GrowthPage() {
  const [campaigns, setCampaigns] = React.useState<Campaign[]>([]);
  const [entries, setEntries] = React.useState<Changelog[]>([]);
  const [referrals, setReferrals] = React.useState<ReferralBoard | null>(null);
  const [feedback, setFeedback] = React.useState<FeedbackBoard | null>(null);
  const [msg, setMsg] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [aud, setAud] = React.useState("all");
  const [clTitle, setClTitle] = React.useState("");
  const [clBody, setClBody] = React.useState("");
  const [clVersion, setClVersion] = React.useState("");
  const [refEnabled, setRefEnabled] = React.useState(false);
  const [refReward, setRefReward] = React.useState("500");

  const load = React.useCallback(async () => {
    setCampaigns(await apiFetch<Campaign[]>("/admin/campaigns").catch(() => []));
    setEntries(await apiFetch<Changelog[]>("/admin/changelog").catch(() => []));
    const rb = await apiFetch<ReferralBoard>("/admin/referrals").catch(() => null);
    setReferrals(rb);
    if (rb) { setRefEnabled(rb.config.enabled); setRefReward(String(rb.config.rewardMinor / 100)); }
    setFeedback(await apiFetch<FeedbackBoard>("/admin/feedback").catch(() => null));
  }, []);
  React.useEffect(() => { load(); }, [load]);

  return (
    <AdminShell title="📈 Growth Ops">
      {msg ? <p className="mb-3 rounded-lg bg-indigo-500/10 p-3 text-sm text-indigo-200">{msg}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="acard space-y-3">
          <div className="font-semibold">✉️ Tenant Email Campaign</div>
          <p className="text-xs text-slate-500">আসল Email Provider দিয়ে পাঠানো হয় — প্রতিটি Org এর OWNER/ADMIN দের কাছে। Provider সেট না থাকলে Campaign শুরুই হবে না। সর্বোচ্চ 500 জন/Campaign।</p>
          <input className="ainput" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <textarea className="ainput" rows={4} placeholder="ইমেইলের বার্তা…" value={body} onChange={(e) => setBody(e.target.value)} />
          <label className="block text-sm">Audience
            <select className="ainput mt-1" value={aud} onChange={(e) => setAud(e.target.value)}>
              {AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select></label>
          <button className="abtn" onClick={async () => {
            if (!subject.trim() || !body.trim()) return;
            if (!confirm(`"${subject}" — এই Campaign টি পাঠাতে চান?`)) return;
            try {
              const r = await apiFetch<Campaign & { note?: string }>("/admin/campaigns", { method: "POST", body: JSON.stringify({ subject, body, audience: aud }) });
              setMsg(`Campaign শেষ: ${r.sent}/${r.recipients} সফল, ${r.failed} ব্যর্থ।${r.note ? " " + r.note : ""}`);
              setSubject(""); setBody(""); await load();
            } catch (e) { setMsg(e instanceof Error ? e.message : "পাঠানো যায়নি"); }
          }}>Campaign পাঠান</button>
          <ul className="space-y-1.5">
            {campaigns.slice(0, 5).map((c) => (
              <li key={c.id} className="rounded-lg bg-slate-800 px-3 py-2 text-xs">
                <b>{c.subject}</b> · {c.audience} · পাঠানো {c.sent}/{c.recipients} (ব্যর্থ {c.failed}) · {new Date(c.createdAt).toLocaleString("bn-BD")}
              </li>
            ))}
          </ul>
        </div>

        <div className="acard space-y-3">
          <div className="font-semibold">🎁 Referral Program</div>
          {!referrals ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-slate-800 p-3"><div className="text-xl font-bold">{referrals.totals.signups}</div><div className="text-xs text-slate-400">রেফারেলে সাইনআপ</div></div>
                <div className="rounded-xl bg-slate-800 p-3"><div className="text-xl font-bold">{referrals.totals.rewarded}</div><div className="text-xs text-slate-400">পুরস্কার পেয়েছেন</div></div>
                <div className="rounded-xl bg-slate-800 p-3"><div className="text-xl font-bold">{taka(referrals.totals.paidOutMinor)}</div><div className="text-xs text-slate-400">মোট ক্রেডিট দেওয়া</div></div>
              </div>
              <label className="flex items-center justify-between text-sm">প্রোগ্রাম চালু
                <input type="checkbox" checked={refEnabled} onChange={(e) => setRefEnabled(e.target.checked)} /></label>
              <label className="block text-sm">প্রথম পেমেন্টে পুরস্কার (টাকা)
                <input className="ainput mt-1" type="number" min={0} value={refReward} onChange={(e) => setRefReward(e.target.value)} /></label>
              <button className="abtn-secondary" onClick={async () => {
                try {
                  await apiFetch("/admin/referrals/config", { method: "PATCH", body: JSON.stringify({ enabled: refEnabled, rewardMinor: Math.round(Number(refReward || 0) * 100) }) });
                  setMsg("Referral সেটিং সেভ হয়েছে।"); await load();
                } catch (e) { setMsg(e instanceof Error ? e.message : "সেভ হয়নি"); }
              }}>সেভ করুন</button>
              <ul className="space-y-1.5">
                {referrals.recent.slice(0, 6).map((r) => (
                  <li key={r.id} className="rounded-lg bg-slate-800 px-3 py-2 text-xs">
                    {r.referrerEmail ?? "?"} → {r.referredEmail ?? "?"} · {r.status === "rewarded" ? `✅ ${taka(r.rewardMinor ?? 0)}` : "⏳ pending"} · {new Date(r.createdAt).toLocaleDateString("bn-BD")}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 mt-4">
        <div className="acard space-y-3">
          <div className="font-semibold">📰 Changelog Manager</div>
          <p className="text-xs text-slate-500">প্রকাশিত Entry গুলো Tenant দের "আপডেটসমূহ" পেজে ও Public Changelog এ দেখায়।</p>
          <div className="flex gap-2">
            <input className="ainput max-w-[120px]" placeholder="Version" value={clVersion} onChange={(e) => setClVersion(e.target.value)} />
            <input className="ainput flex-1" placeholder="শিরোনাম" value={clTitle} onChange={(e) => setClTitle(e.target.value)} />
          </div>
          <textarea className="ainput" rows={3} placeholder="কী নতুন এলো…" value={clBody} onChange={(e) => setClBody(e.target.value)} />
          <button className="abtn" onClick={async () => {
            if (!clTitle.trim() || !clBody.trim()) return;
            try {
              await apiFetch("/admin/changelog", { method: "POST", body: JSON.stringify({ version: clVersion || undefined, title: clTitle, body: clBody, published: true }) });
              setClTitle(""); setClBody(""); setClVersion(""); setMsg("Changelog প্রকাশ হয়েছে।"); await load();
            } catch (e) { setMsg(e instanceof Error ? e.message : "হয়নি"); }
          }}>প্রকাশ করুন</button>
          <ul className="space-y-1.5">
            {entries.slice(0, 6).map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-2 rounded-lg bg-slate-800 px-3 py-2 text-xs">
                <span><b>{e.title}</b>{e.version ? ` · ${e.version}` : ""} · {e.published ? "✅ প্রকাশিত" : "খসড়া"}</span>
                <span className="flex shrink-0 gap-1">
                  <button className="abtn-secondary !px-2 !py-0.5" onClick={async () => { await apiFetch(`/admin/changelog/${e.id}`, { method: "PATCH", body: JSON.stringify({ published: !e.published }) }); await load(); }}>{e.published ? "লুকান" : "প্রকাশ"}</button>
                  <button className="abtn-danger !px-2 !py-0.5" onClick={async () => { if (confirm("মুছে ফেলবেন?")) { await apiFetch(`/admin/changelog/${e.id}`, { method: "DELETE" }); await load(); } }}>মুছুন</button>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="acard space-y-3">
          <div className="font-semibold">💬 Feedback / NPS</div>
          {!feedback ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : (
            <>
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="rounded-xl bg-slate-800 p-3"><div className="text-xl font-bold">{feedback.summary.nps ?? "—"}</div><div className="text-xs text-slate-400">NPS Score</div></div>
                <div className="rounded-xl bg-slate-800 p-3"><div className="text-xl font-bold">{feedback.summary.average ?? "—"}</div><div className="text-xs text-slate-400">গড় (০–১০)</div></div>
                <div className="rounded-xl bg-slate-800 p-3"><div className="text-xl font-bold text-emerald-400">{feedback.summary.promoters}</div><div className="text-xs text-slate-400">Promoter (৯–১০)</div></div>
                <div className="rounded-xl bg-slate-800 p-3"><div className="text-xl font-bold text-red-400">{feedback.summary.detractors}</div><div className="text-xs text-slate-400">Detractor (০–৬)</div></div>
              </div>
              <ul className="space-y-1.5">
                {feedback.recent.slice(0, 8).map((f) => (
                  <li key={f.id} className="rounded-lg bg-slate-800 px-3 py-2 text-xs">
                    <b>{f.score}/10</b> · {f.organizationName ?? f.id} · {new Date(f.createdAt).toLocaleDateString("bn-BD")}
                    {f.comment ? <span className="block text-slate-400">“{f.comment}”</span> : null}
                  </li>
                ))}
                {feedback.recent.length === 0 ? <li className="text-xs text-slate-500">এখনো কোনো Feedback আসেনি — Tenant রা Support পেজ থেকে দিতে পারে।</li> : null}
              </ul>
            </>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
