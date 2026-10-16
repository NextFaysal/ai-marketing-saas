"use client";

import React from "react";
import AdminShell from "@/components/AdminShell";
import { EmptyState, ErrorState, PageHead, Tabs, askConfirm, toast } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";

interface Campaign { id: string; subject: string; audience: string; recipients: number; sent: number; failed: number; createdAt: string }
interface Changelog { id: string; version: string | null; title: string; body: string; published: boolean; publishedAt: string | null; createdAt: string }
interface RefConfig {
  enabled: boolean; mode: string; rewardMinor: number; percentOfFirstPayment: number;
  perPlanMinor: Record<string, number>; refereeBonusMinor: number; minFirstPaymentMinor: number;
  creditExpiryDays: number; milestones: { count: number; bonusMinor: number }[];
}
interface ReferralBoard {
  config: RefConfig;
  totals: { signups: number; rewarded: number; clawedBack: number; paidOutMinor: number };
  referrers: { referrerEmail: string | null; signups: number; rewarded: number; earnedMinor: number; conversionPercent: number | null }[];
  flagged: { referrerEmail: string | null; signups: number; rewarded: number; signupsLast24h: number; flags: string[] }[];
  recent: { id: string; code: string; status: string; referrerEmail: string | null; referredEmail: string | null; rewardMinor: number | null; createdAt: string }[];
}
interface RefCampaign {
  id: string; code: string; label: string; mode: string | null; rewardMinor: string | null;
  refereeBonusMinor: string | null; maxUses: number | null; usedCount: number;
  expiresAt: string | null; active: boolean; live: boolean;
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
const FLAG_BN: Record<string, string> = { no_conversion: "১০+ সাইন আপ, ০ কনভার্সন", signup_spike: "২৪ ঘণ্টায় ৫+ সাইন আপ" };

export default function GrowthPage() {
  const [campaigns, setCampaigns] = React.useState<Campaign[]>([]);
  const [entries, setEntries] = React.useState<Changelog[]>([]);
  const [referrals, setReferrals] = React.useState<ReferralBoard | null>(null);
  const [refCampaigns, setRefCampaigns] = React.useState<RefCampaign[]>([]);
  const [feedback, setFeedback] = React.useState<FeedbackBoard | null>(null);
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [aud, setAud] = React.useState("all");
  const [clTitle, setClTitle] = React.useState("");
  const [clBody, setClBody] = React.useState("");
  const [clVersion, setClVersion] = React.useState("");
  // Referral config v2 form (taka strings in the inputs).
  const [refEnabled, setRefEnabled] = React.useState(false);
  const [refMode, setRefMode] = React.useState("flat");
  const [refReward, setRefReward] = React.useState("500");
  const [refPercent, setRefPercent] = React.useState("0");
  const [refPerPlan, setRefPerPlan] = React.useState<Record<string, string>>({});
  const [refBonus, setRefBonus] = React.useState("0");
  const [refMinPay, setRefMinPay] = React.useState("0");
  const [refExpiry, setRefExpiry] = React.useState("0");
  const [refMilestones, setRefMilestones] = React.useState<{ count: string; bonus: string }[]>([]);
  // Campaign create form.
  const [campCode, setCampCode] = React.useState("");
  const [campLabel, setCampLabel] = React.useState("");
  const [campReward, setCampReward] = React.useState("");
  const [campBonus, setCampBonus] = React.useState("");
  const [campMax, setCampMax] = React.useState("");
  const [campExpires, setCampExpires] = React.useState("");
  // ADX11: existing sections regrouped into tabs. NOTE: there is
  // no Announcements section on this page (announcements live in
  // Settings — the ADX9 📣 section), so no tab was invented for it;
  // Referral Program and Feedback get their own tabs instead.
  const [tab, setTab] = React.useState("campaigns");
  // ADNX12: form pattern + honest list states — field-level errors
  // (persistent until fixed, like NB2's billing form), a busy flag
  // per submit, and a list-load error so a failed campaigns/
  // changelog fetch is not read as "no campaigns".
  const [campErr, setCampErr] = React.useState<{ subject?: string; body?: string }>({});
  const [refCampErr, setRefCampErr] = React.useState<{ code?: string; label?: string }>({});
  const [clErr, setClErr] = React.useState<{ title?: string; body?: string }>({});
  const [sending, setSending] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [savingRef, setSavingRef] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [listError, setListError] = React.useState(false);

  // ADX12: loadDone separates "still loading" from "board load
  // failed" for the two null-gated boards (Referrals, Feedback) —
  // before, a failed fetch showed "লোড হচ্ছে…" forever there.
  const [loadDone, setLoadDone] = React.useState(false);
  const load = React.useCallback(async () => {
    setLoadDone(false);
    let listFailed = false;
    setCampaigns(await apiFetch<Campaign[]>("/admin/campaigns").catch(() => { listFailed = true; return []; }));
    setEntries(await apiFetch<Changelog[]>("/admin/changelog").catch(() => { listFailed = true; return []; }));
    const rb = await apiFetch<ReferralBoard>("/admin/referrals").catch(() => null);
    setReferrals(rb);
    if (rb) {
      const c = rb.config;
      setRefEnabled(c.enabled); setRefMode(c.mode); setRefReward(String(c.rewardMinor / 100));
      setRefPercent(String(c.percentOfFirstPayment));
      setRefPerPlan(Object.fromEntries(Object.entries(c.perPlanMinor).map(([k, v]) => [k, String(v / 100)])));
      setRefBonus(String(c.refereeBonusMinor / 100)); setRefMinPay(String(c.minFirstPaymentMinor / 100));
      setRefExpiry(String(c.creditExpiryDays));
      setRefMilestones(c.milestones.map((m) => ({ count: String(m.count), bonus: String(m.bonusMinor / 100) })));
    }
    setRefCampaigns(await apiFetch<RefCampaign[]>("/admin/referrals/campaigns").catch(() => { listFailed = true; return []; }));
    setListError(listFailed);
    setFeedback(await apiFetch<FeedbackBoard>("/admin/feedback").catch(() => null));
    setLoadDone(true);
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const minor = (takaStr: string) => Math.round(Number(takaStr || 0) * 100);

  return (
    <AdminShell title="📈 Growth Ops">
      <PageHead sub="Campaign, Referral, Changelog ও Feedback — Tab অনুযায়ী ভাগ করা।" />
      {listError ? <div className="mb-3"><ErrorState message="তালিকা লোড হয়নি — Campaign/Changelog তালিকা দেখানো যাচ্ছে না।" onRetry={load} /></div> : null}
      <div className="sticky top-0 z-20 -mx-1 mb-4 bg-slate-950/90 px-1 py-2 backdrop-blur">
        <Tabs
          tabs={[
            { id: "campaigns", label: "✉️ Campaigns" },
            { id: "referrals", label: "🎁 Referrals" },
            { id: "changelog", label: "📰 Changelog" },
            { id: "feedback", label: "💬 Feedback / NPS", badge: feedback?.summary.count ?? undefined },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>
      {tab === "campaigns" ? (
        <div className="atab-panel grid items-start gap-4 lg:grid-cols-2">
        <div className="acard space-y-3">
          <div className="font-semibold">✉️ Tenant Email Campaign</div>
          <p className="text-xs text-slate-400">আসল Email Provider দিয়ে পাঠানো হয় — প্রতিটি Org এর OWNER/ADMIN দের কাছে। Provider সেট না থাকলে Campaign শুরুই হবে না। সর্বোচ্চ 500 জন/Campaign।</p>
          <label className="block text-sm">Subject
            <input className="ainput mt-1" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
          {campErr.subject ? <p className="text-xs text-red-300">{campErr.subject}</p> : null}
          <label className="block text-sm">ইমেইলের বার্তা
            <textarea className="ainput mt-1" rows={4} placeholder="ইমেইলের বার্তা…" value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          {campErr.body ? <p className="text-xs text-red-300">{campErr.body}</p> : null}
          <label className="block text-sm">Audience
            <select className="ainput mt-1" value={aud} onChange={(e) => setAud(e.target.value)}>
              {AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select></label>
          <button className="abtn" disabled={sending} onClick={async () => {
            const errs = { subject: subject.trim() ? undefined : "Subject লিখুন।", body: body.trim() ? undefined : "বার্তা লিখুন।" };
            setCampErr(errs);
            if (errs.subject || errs.body) return;
            if (!(await askConfirm({ title: `"${subject}" — এই Campaign টি পাঠাতে চান?`, confirmLabel: "পাঠান" }))) return;
            setSending(true);
            try {
              const r = await apiFetch<Campaign & { note?: string }>("/admin/campaigns", { method: "POST", body: JSON.stringify({ subject, body, audience: aud }) });
              toast(`Campaign শেষ: ${r.sent}/${r.recipients} সফল, ${r.failed} ব্যর্থ।${r.note ? " " + r.note : ""}`);
              setSubject(""); setBody(""); await load();
            } catch (e) { toast(e instanceof Error ? e.message : "পাঠানো যায়নি", "error"); }
            finally { setSending(false); }
          }}>{sending ? "হচ্ছে…" : "Campaign পাঠান"}</button>
          {!loadDone ? <div className="askel-table" /> : null}
          {loadDone && campaigns.length === 0 ? <EmptyState title="এখনো কোনো Campaign পাঠানো হয়নি।" /> : null}
          <ul className="space-y-1.5">
            {campaigns.slice(0, 5).map((c) => (
              <li key={c.id} className="rounded-lg bg-slate-800 px-3 py-2 text-xs">
                <b>{c.subject}</b> · {c.audience} · পাঠানো {c.sent}/{c.recipients} (ব্যর্থ {c.failed}) · {fmtDateTime(c.createdAt)}
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-400">পাঠানো Campaign সম্পাদনা বা মোছা যায় না — প্রতিটি Campaign-ই পাঠানোর পরের ইতিহাস (কে পেয়েছে, কত সফল/ব্যর্থ) হিসেবে সংরক্ষিত থাকে, ইতিহাস বদলানো হয় না। Draft Campaign বলে কিছু এই সিস্টেমে নেই — "Campaign পাঠান" চাপলেই তা সরাসরি পাঠানো হয়।</p>
        </div>

        <div className="acard space-y-3">
          <div className="font-semibold">🏷️ Referral Campaigns</div>
          <p className="text-xs text-slate-400">ক্যাম্পেইন কোডে সাইন আপ করলে নতুন Org নিজেই ক্রেডিট পায় (কোডের শর্ত সাইন আপের মুহূর্তে লক হয়ে যায়)। QOS- দিয়ে শুরু হওয়া কোড ব্যবহার করা যাবে না — ওটা User কোডের জন্য।</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs">কোড
              <input className="ainput mt-1" placeholder="কোড (যেমন EID2026)" value={campCode} onChange={(e) => setCampCode(e.target.value)} />
            </label>
            <label className="block text-xs">লেবেল
              <input className="ainput mt-1" placeholder="লেবেল" value={campLabel} onChange={(e) => setCampLabel(e.target.value)} />
            </label>
            <label className="block text-xs">Flat রিওয়ার্ড (টাকা)
              <input className="ainput mt-1" type="number" min={0} placeholder="Flat রিওয়ার্ড (টাকা)" value={campReward} onChange={(e) => setCampReward(e.target.value)} />
            </label>
            <label className="block text-xs">Welcome (টাকা)
              <input className="ainput mt-1" type="number" min={0} placeholder="Welcome (টাকা)" value={campBonus} onChange={(e) => setCampBonus(e.target.value)} />
            </label>
            <label className="block text-xs">সর্বোচ্চ ব্যবহার
              <input className="ainput mt-1" type="number" min={1} placeholder="সর্বোচ্চ ব্যবহার" value={campMax} onChange={(e) => setCampMax(e.target.value)} />
            </label>
            <label className="block text-xs">মেয়াদ শেষ (তারিখ)
              <input className="ainput mt-1" type="date" value={campExpires} onChange={(e) => setCampExpires(e.target.value)} />
            </label>
          </div>
          {refCampErr.code ? <p className="text-xs text-red-300">{refCampErr.code}</p> : null}
          {refCampErr.label ? <p className="text-xs text-red-300">{refCampErr.label}</p> : null}
          <button className="abtn" disabled={creating} onClick={async () => {
            const errs = { code: campCode.trim() ? undefined : "কোড লিখুন।", label: campLabel.trim() ? undefined : "লেবেল লিখুন।" };
            setRefCampErr(errs);
            if (errs.code || errs.label) return;
            setCreating(true);
            try {
              await apiFetch("/admin/referrals/campaigns", {
                method: "POST",
                body: JSON.stringify({
                  code: campCode, label: campLabel,
                  rewardMinor: campReward ? minor(campReward) : undefined,
                  refereeBonusMinor: campBonus ? minor(campBonus) : undefined,
                  maxUses: campMax ? Math.round(Number(campMax)) : undefined,
                  expiresAt: campExpires ? new Date(campExpires).toISOString() : undefined,
                }),
              });
              setCampCode(""); setCampLabel(""); setCampReward(""); setCampBonus(""); setCampMax(""); setCampExpires("");
              toast("Campaign তৈরি হয়েছে।"); await load();
            } catch (e) { toast(e instanceof Error ? e.message : "তৈরি হয়নি", "error"); }
            finally { setCreating(false); }
          }}>{creating ? "হচ্ছে…" : "Campaign তৈরি"}</button>
          <ul className="space-y-1.5">
            {refCampaigns.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-2 rounded-lg bg-slate-800 px-3 py-2 text-xs">
                <span><b>{c.code}</b> · {c.label} · {c.live ? "🟢 live" : "⚪ বন্ধ/শেষ"} · ব্যবহার {c.usedCount}{c.maxUses ? `/${c.maxUses}` : ""}
                  <span className="block text-slate-400">রিওয়ার্ড {c.rewardMinor ? taka(Number(c.rewardMinor)) : "—"} · Welcome {c.refereeBonusMinor ? taka(Number(c.refereeBonusMinor)) : "—"}{c.expiresAt ? ` · মেয়াদ ${fmtDateTime(c.expiresAt, "date")}` : ""}</span></span>
                <button className="abtn-secondary !px-2 !py-0.5 shrink-0" onClick={async () => { await apiFetch(`/admin/referrals/campaigns/${c.id}`, { method: "PATCH", body: JSON.stringify({ active: !c.active }) }); await load(); }}>{c.active ? "বন্ধ করুন" : "চালু করুন"}</button>
              </li>
            ))}
            {refCampaigns.length === 0 ? <li className="text-xs text-slate-400">এখনো কোনো Campaign নেই।</li> : null}
          </ul>
        </div>
        </div>
      ) : null}
      {tab === "referrals" ? (
        <div className="atab-panel">
      <div className="acard mt-4 space-y-4">
        <div className="font-semibold">🎁 Referral Program — Advanced</div>
        {!referrals ? (loadDone ? <ErrorState message="Referral Board লোড হয়নি — আবার চেষ্টা করুন।" onRetry={load} /> : <div className="askel-table" />) : (
          <>
            <div className="grid grid-cols-2 gap-2 text-center lg:grid-cols-5">
              <div className="rounded-xl bg-slate-800 p-3"><div className="text-xl font-bold">{referrals.totals.signups}</div><div className="text-xs text-slate-400">রেফারেলে সাইনআপ</div></div>
              <div className="rounded-xl bg-slate-800 p-3"><div className="text-xl font-bold">{referrals.totals.rewarded}</div><div className="text-xs text-slate-400">পুরস্কার পেয়েছেন</div></div>
              <div className="rounded-xl bg-slate-800 p-3"><div className="text-xl font-bold">{referrals.totals.signups ? `${Math.round((referrals.totals.rewarded / referrals.totals.signups) * 1000) / 10}%` : "—"}</div><div className="text-xs text-slate-400">কনভার্সন</div></div>
              <div className="rounded-xl bg-slate-800 p-3"><div className="text-xl font-bold">{taka(referrals.totals.paidOutMinor)}</div><div className="text-xs text-slate-400">মোট ক্রেডিট দেওয়া</div></div>
              <div className="rounded-xl bg-slate-800 p-3"><div className="text-xl font-bold text-red-300">{referrals.totals.clawedBack}</div><div className="text-xs text-slate-400">রিফান্ডে ফেরত (Clawback)</div></div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="space-y-3 rounded-xl bg-slate-800/60 p-3">
                <div className="text-sm font-semibold">⚙️ রিওয়ার্ড সেটিং</div>
                <label className="flex items-center justify-between text-sm">প্রোগ্রাম চালু
                  <input type="checkbox" checked={refEnabled} onChange={(e) => setRefEnabled(e.target.checked)} /></label>
                <label className="block text-sm">রিওয়ার্ডের ধরন
                  <select className="ainput mt-1" value={refMode} onChange={(e) => setRefMode(e.target.value)}>
                    <option value="flat">Flat — নির্দিষ্ট টাকা</option>
                    <option value="percent">Percent — প্রথম পেমেন্টের %</option>
                    <option value="per_plan">Per-plan — প্ল্যান অনুযায়ী</option>
                  </select></label>
                {refMode === "flat" ? (
                  <label className="block text-sm">Flat পুরস্কার (টাকা)
                    <input className="ainput mt-1" type="number" min={0} value={refReward} onChange={(e) => setRefReward(e.target.value)} /></label>
                ) : null}
                {refMode === "percent" ? (
                  <label className="block text-sm">প্রথম পেমেন্টের শতাংশ (%)
                    <input className="ainput mt-1" type="number" min={0} max={100} value={refPercent} onChange={(e) => setRefPercent(e.target.value)} /></label>
                ) : null}
                {refMode === "per_plan" ? (
                  <div className="grid grid-cols-3 gap-2">
                    {["STARTER", "GROWTH", "AGENCY"].map((t) => (
                      <label key={t} className="block text-xs">{t} (টাকা)
                        <input className="ainput mt-1" type="number" min={0} value={refPerPlan[t] ?? ""} onChange={(e) => setRefPerPlan({ ...refPerPlan, [t]: e.target.value })} /></label>
                    ))}
                    <p className="col-span-3 text-xs text-slate-400">খালি প্ল্যানে Flat অঙ্কটাই প্রযোজ্য হবে।</p>
                    <label className="block text-xs">Flat (fallback, টাকা)
                      <input className="ainput mt-1" type="number" min={0} value={refReward} onChange={(e) => setRefReward(e.target.value)} /></label>
                  </div>
                ) : null}
                <div className="grid grid-cols-3 gap-2">
                  <label className="block text-xs">নতুন Org এর Welcome ক্রেডিট (টাকা)
                    <input className="ainput mt-1" type="number" min={0} value={refBonus} onChange={(e) => setRefBonus(e.target.value)} /></label>
                  <label className="block text-xs">যোগ্যতার ন্যূনতম প্রথম পেমেন্ট (টাকা)
                    <input className="ainput mt-1" type="number" min={0} value={refMinPay} onChange={(e) => setRefMinPay(e.target.value)} /></label>
                  <label className="block text-xs">ক্রেডিটের মেয়াদ (দিন, ০ = অসীম)
                    <input className="ainput mt-1" type="number" min={0} value={refExpiry} onChange={(e) => setRefExpiry(e.target.value)} /></label>
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-semibold">🏆 মাইলস্টোন বোনাস</div>
                  {refMilestones.map((m, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input className="ainput max-w-[110px]" type="number" min={1} placeholder="রেফারেল সংখ্যা" value={m.count} onChange={(e) => setRefMilestones(refMilestones.map((x, j) => (j === i ? { ...x, count: e.target.value } : x)))} />
                      <span className="text-xs text-slate-400">টি পেইড হলে বোনাস (টাকা)</span>
                      <input className="ainput max-w-[110px]" type="number" min={0} value={m.bonus} onChange={(e) => setRefMilestones(refMilestones.map((x, j) => (j === i ? { ...x, bonus: e.target.value } : x)))} />
                      <button className="abtn-danger !px-2 !py-0.5" onClick={() => setRefMilestones(refMilestones.filter((_, j) => j !== i))}>✕</button>
                    </div>
                  ))}
                  <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => setRefMilestones([...refMilestones, { count: "", bonus: "" }])}>+ মাইলস্টোন যোগ</button>
                </div>
                <button className="abtn-secondary" disabled={savingRef} onClick={async () => {
                  setSavingRef(true);
                  try {
                    await apiFetch("/admin/referrals/config", {
                      method: "PATCH",
                      body: JSON.stringify({
                        enabled: refEnabled, rewardMinor: minor(refReward), mode: refMode,
                        percentOfFirstPayment: Math.round(Number(refPercent || 0)),
                        perPlanMinor: Object.fromEntries(Object.entries(refPerPlan).filter(([, v]) => v !== "").map(([k, v]) => [k, minor(v)])),
                        refereeBonusMinor: minor(refBonus), minFirstPaymentMinor: minor(refMinPay),
                        creditExpiryDays: Math.round(Number(refExpiry || 0)),
                        milestones: refMilestones.filter((m) => m.count && m.bonus).map((m) => ({ count: Math.round(Number(m.count)), bonusMinor: minor(m.bonus) })),
                      }),
                    });
                    toast("Referral সেটিং সেভ হয়েছে।"); await load();
                  } catch (e) { toast(e instanceof Error ? e.message : "সেভ হয়নি", "error"); }
                  finally { setSavingRef(false); }
                }}>{savingRef ? "হচ্ছে…" : "সেভ করুন"}</button>
              </div>

              <div className="space-y-3">
                <div className="rounded-xl bg-slate-800/60 p-3">
                  <div className="text-sm font-semibold">🏅 শীর্ষ রেফারার</div>
                  <ul className="mt-2 space-y-1.5">
                    {referrals.referrers.slice(0, 8).map((r, i) => (
                      <li key={i} className="rounded-lg bg-slate-800 px-3 py-2 text-xs">
                        <b>{r.referrerEmail ?? "ক্যাম্পেইন"}</b> · সাইন আপ {r.signups} · পেইড {r.rewarded} · কনভার্সন {r.conversionPercent ?? "—"}% · অর্জন {taka(r.earnedMinor)}
                      </li>
                    ))}
                    {referrals.referrers.length === 0 ? <li className="text-xs text-slate-400">এখনো কোনো রেফারার নেই।</li> : null}
                  </ul>
                </div>
                <div className="rounded-xl bg-slate-800/60 p-3">
                  <div className="text-sm font-semibold">🛡️ অপব্যবহার পর্যবেক্ষণ</div>
                  <p className="mt-1 text-xs text-slate-400">নিয়ম: ১০+ সাইন আপ কিন্তু ০ কনভার্সন, অথবা ২৪ ঘণ্টায় ৫+ সাইন আপ — এগুলো সংকেত মাত্র, প্রমাণ নয়।</p>
                  <ul className="mt-2 space-y-1.5">
                    {referrals.flagged.map((r, i) => (
                      <li key={i} className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-200">
                        <b>{r.referrerEmail ?? "?"}</b> · সাইন আপ {r.signups} (২৪ ঘণ্টায় {r.signupsLast24h}) · পেইড {r.rewarded} · {r.flags.map((f) => FLAG_BN[f] ?? f).join(" · ")}
                      </li>
                    ))}
                    {referrals.flagged.length === 0 ? <li className="text-xs text-slate-400">কোনো সন্দেহজনক নমুনা নেই।</li> : null}
                  </ul>
                </div>
                <ul className="space-y-1.5">
                  {referrals.recent.slice(0, 6).map((r) => (
                    <li key={r.id} className="rounded-lg bg-slate-800 px-3 py-2 text-xs">
                      {r.referrerEmail ?? "🏷️ ক্যাম্পেইন"} → {r.referredEmail ?? "?"} · {r.status === "rewarded" ? `✅ ${taka(r.rewardMinor ?? 0)}` : r.status === "clawed_back" ? "↩️ ফেরত" : "⏳ pending"} · {fmtDateTime(r.createdAt, "date")}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}
      </div>
        </div>
      ) : null}
      {tab === "changelog" ? (
        <div className="atab-panel">
        <div className="acard space-y-3">
          <div className="font-semibold">📰 Changelog Manager</div>
          <p className="text-xs text-slate-400">প্রকাশিত Entry গুলো Tenant দের "আপডেটসমূহ" পেজে ও Public Changelog এ দেখায়।</p>
          <div className="flex gap-2">
            <label className="block text-xs">Version
              <input className="ainput mt-1 max-w-[120px]" placeholder="Version" value={clVersion} onChange={(e) => setClVersion(e.target.value)} />
            </label>
            <label className="block flex-1 text-xs">শিরোনাম
              <input className="ainput mt-1" placeholder="শিরোনাম" value={clTitle} onChange={(e) => setClTitle(e.target.value)} />
            </label>
          </div>
          {clErr.title ? <p className="text-xs text-red-300">{clErr.title}</p> : null}
          <label className="block text-xs">কী নতুন এলো
            <textarea className="ainput mt-1" rows={3} placeholder="কী নতুন এলো…" value={clBody} onChange={(e) => setClBody(e.target.value)} />
          </label>
          {clErr.body ? <p className="text-xs text-red-300">{clErr.body}</p> : null}
          <button className="abtn" disabled={publishing} onClick={async () => {
            const errs = { title: clTitle.trim() ? undefined : "শিরোনাম লিখুন।", body: clBody.trim() ? undefined : "বার্তা লিখুন।" };
            setClErr(errs);
            if (errs.title || errs.body) return;
            setPublishing(true);
            try {
              await apiFetch("/admin/changelog", { method: "POST", body: JSON.stringify({ version: clVersion || undefined, title: clTitle, body: clBody, published: true }) });
              setClTitle(""); setClBody(""); setClVersion(""); toast("Changelog প্রকাশ হয়েছে।"); await load();
            } catch (e) { toast(e instanceof Error ? e.message : "হয়নি", "error"); }
            finally { setPublishing(false); }
          }}>{publishing ? "হচ্ছে…" : "প্রকাশ করুন"}</button>
          {!loadDone ? <div className="askel-table" /> : null}
          {loadDone && entries.length === 0 ? <EmptyState title="এখনো কোনো Changelog Entry নেই।" /> : null}
          <ul className="space-y-1.5">
            {entries.slice(0, 6).map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-2 rounded-lg bg-slate-800 px-3 py-2 text-xs">
                <span><b>{e.title}</b>{e.version ? ` · ${e.version}` : ""} · {e.published ? "✅ প্রকাশিত" : "খসড়া"}</span>
                <span className="flex shrink-0 gap-1">
                  <button className="abtn-secondary !px-2 !py-0.5" onClick={async () => { await apiFetch(`/admin/changelog/${e.id}`, { method: "PATCH", body: JSON.stringify({ published: !e.published }) }); await load(); }}>{e.published ? "লুকান" : "প্রকাশ"}</button>
                  <button className="abtn-danger !px-2 !py-0.5" onClick={async () => { if (await askConfirm({ title: "মুছে ফেলবেন?", confirmLabel: "মুছুন", danger: true })) { await apiFetch(`/admin/changelog/${e.id}`, { method: "DELETE" }); await load(); } }}>মুছুন</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
        </div>
      ) : null}
      {tab === "feedback" ? (
        <div className="atab-panel">
        <div className="acard space-y-3">
          <div className="font-semibold">💬 Feedback / NPS</div>
          {!feedback ? (loadDone ? <ErrorState message="Feedback Board লোড হয়নি — আবার চেষ্টা করুন।" onRetry={load} /> : <div className="askel-table" />) : (
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
                    <b>{f.score}/10</b> · {f.organizationName ?? f.id} · {fmtDateTime(f.createdAt, "date")}
                    {f.comment ? <span className="block text-slate-400">“{f.comment}”</span> : null}
                  </li>
                ))}
                {feedback.recent.length === 0 ? <li className="text-xs text-slate-400">এখনো কোনো Feedback আসেনি — Tenant রা Support পেজ থেকে দিতে পারে।</li> : null}
              </ul>
            </>
          )}
        </div>
        </div>
      ) : null}
    </AdminShell>
  );
}
