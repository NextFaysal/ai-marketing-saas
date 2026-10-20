"use client";

import React from "react";
import AdminShell from "@/components/AdminShell";
import { EmptyState, ErrorState, PageHead, Tabs, askConfirm, toast } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";
import { fmtMoneyMinor, fmtNumber } from "@repo/contracts";
import { useAdminLocale } from "@/components/AdminLocale";

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
const FLAG_KEY: Record<string, string> = { no_conversion: "growth.flagNoConversion", signup_spike: "growth.flagSignupSpike" };

export default function GrowthPage() {
  const { dict, locale, t } = useAdminLocale();
  const taka = (minorVal: number) => fmtMoneyMinor(locale, minorVal);
  const AUDIENCES = [
    { value: "all", label: dict.growth.audAll }, { value: "trialing", label: dict.growth.audTrialing }, { value: "past_due", label: dict.growth.audPastDue },
    { value: "plan_FREE", label: "FREE" }, { value: "plan_STARTER", label: "STARTER" }, { value: "plan_GROWTH", label: "GROWTH" }, { value: "plan_AGENCY", label: "AGENCY" },
  ];
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
    <AdminShell title={dict.growth.title}>
      <PageHead sub={dict.growth.sub} />
      {listError ? <div className="mb-3"><ErrorState message={dict.growth.listError} onRetry={load} /></div> : null}
      <div className="sticky top-0 z-20 -mx-1 mb-4 bg-slate-950/90 px-1 py-2 backdrop-blur">
        <Tabs
          tabs={[
            { id: "campaigns", label: dict.growth.tabCampaigns },
            { id: "referrals", label: dict.growth.tabReferrals },
            { id: "changelog", label: dict.growth.tabChangelog },
            { id: "feedback", label: dict.growth.tabFeedback, badge: feedback?.summary.count ?? undefined },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>
      {tab === "campaigns" ? (
        <div className="atab-panel grid items-start gap-4 lg:grid-cols-2">
        <div className="acard space-y-3">
          <div className="font-semibold">{dict.growth.campaignTitle}</div>
          <p className="text-xs text-slate-400">{dict.growth.campaignNote}</p>
          <label className="block text-sm">{dict.growth.subject}
            <input className="ainput mt-1" placeholder={dict.growth.subjectPlaceholder} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
          {campErr.subject ? <p className="text-xs text-red-300">{campErr.subject}</p> : null}
          <label className="block text-sm">{dict.growth.emailBody}
            <textarea className="ainput mt-1" rows={4} placeholder={dict.growth.emailBodyPlaceholder} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          {campErr.body ? <p className="text-xs text-red-300">{campErr.body}</p> : null}
          <label className="block text-sm">{dict.growth.audience}
            <select className="ainput mt-1" value={aud} onChange={(e) => setAud(e.target.value)}>
              {AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select></label>
          <button className="abtn" disabled={sending} onClick={async () => {
            const errs = { subject: subject.trim() ? undefined : dict.growth.subjectRequired, body: body.trim() ? undefined : dict.growth.bodyRequired };
            setCampErr(errs);
            if (errs.subject || errs.body) return;
            if (!(await askConfirm({ title: t("growth.campaignConfirmTitle", { subject }), confirmLabel: dict.growth.campaignSend }))) return;
            setSending(true);
            try {
              const r = await apiFetch<Campaign & { note?: string }>("/admin/campaigns", { method: "POST", body: JSON.stringify({ subject, body, audience: aud }) });
              toast(t("growth.campaignDone", { sent: fmtNumber(locale, r.sent), recipients: fmtNumber(locale, r.recipients), failed: fmtNumber(locale, r.failed) }) + (r.note ? " " + r.note : ""));
              setSubject(""); setBody(""); await load();
            } catch (e) { toast(e instanceof Error ? e.message : dict.growth.sendFailed, "error"); }
            finally { setSending(false); }
          }}>{sending ? dict.common.busy : dict.growth.campaignSendButton}</button>
          {!loadDone ? <div className="askel-table" /> : null}
          {loadDone && campaigns.length === 0 ? <EmptyState title={dict.growth.campaignsEmpty} /> : null}
          <ul className="space-y-1.5">
            {campaigns.slice(0, 5).map((c) => (
              <li key={c.id} className="rounded-lg bg-slate-800 px-3 py-2 text-xs">
                <b>{c.subject}</b> · {c.audience} · {t("growth.campaignRow", { sent: fmtNumber(locale, c.sent), recipients: fmtNumber(locale, c.recipients), failed: fmtNumber(locale, c.failed) })} · {fmtDateTime(locale, c.createdAt)}
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-400">{dict.growth.campaignHistoryNote}</p>
        </div>

        <div className="acard space-y-3">
          <div className="font-semibold">{dict.growth.refCampaignsTitle}</div>
          <p className="text-xs text-slate-400">{dict.growth.refCampaignsNote}</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs">{dict.growth.code}
              <input className="ainput mt-1" placeholder={dict.growth.codePlaceholder} value={campCode} onChange={(e) => setCampCode(e.target.value)} />
            </label>
            <label className="block text-xs">{dict.growth.label}
              <input className="ainput mt-1" placeholder={dict.growth.labelPlaceholder} value={campLabel} onChange={(e) => setCampLabel(e.target.value)} />
            </label>
            <label className="block text-xs">{dict.growth.flatReward}
              <input className="ainput mt-1" type="number" min={0} placeholder={dict.growth.flatReward} value={campReward} onChange={(e) => setCampReward(e.target.value)} />
            </label>
            <label className="block text-xs">{dict.growth.welcome}
              <input className="ainput mt-1" type="number" min={0} placeholder={dict.growth.welcome} value={campBonus} onChange={(e) => setCampBonus(e.target.value)} />
            </label>
            <label className="block text-xs">{dict.growth.maxUses}
              <input className="ainput mt-1" type="number" min={1} placeholder={dict.growth.maxUses} value={campMax} onChange={(e) => setCampMax(e.target.value)} />
            </label>
            <label className="block text-xs">{dict.growth.expiresDate}
              <input className="ainput mt-1" type="date" value={campExpires} onChange={(e) => setCampExpires(e.target.value)} />
            </label>
          </div>
          {refCampErr.code ? <p className="text-xs text-red-300">{refCampErr.code}</p> : null}
          {refCampErr.label ? <p className="text-xs text-red-300">{refCampErr.label}</p> : null}
          <button className="abtn" disabled={creating} onClick={async () => {
            const errs = { code: campCode.trim() ? undefined : dict.growth.codeRequired, label: campLabel.trim() ? undefined : dict.growth.labelRequired };
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
              toast(dict.growth.campaignCreated); await load();
            } catch (e) { toast(e instanceof Error ? e.message : dict.growth.createFailed, "error"); }
            finally { setCreating(false); }
          }}>{creating ? dict.common.busy : dict.growth.campaignCreate}</button>
          <ul className="space-y-1.5">
            {refCampaigns.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-2 rounded-lg bg-slate-800 px-3 py-2 text-xs">
                <span><b>{c.code}</b> · {c.label} · {c.live ? dict.growth.liveOn : dict.growth.liveOff} · {t("growth.usedCount", { count: fmtNumber(locale, c.usedCount), max: c.maxUses ? `/${fmtNumber(locale, c.maxUses)}` : "" })}
                  <span className="block text-slate-400">{t("growth.rewardLine", { reward: c.rewardMinor ? taka(Number(c.rewardMinor)) : "—", welcome: c.refereeBonusMinor ? taka(Number(c.refereeBonusMinor)) : "—" })}{c.expiresAt ? t("growth.expiresLine", { date: fmtDateTime(locale, c.expiresAt, "date") }) : ""}</span></span>
                <button className="abtn-secondary !px-2 !py-0.5 shrink-0" onClick={async () => { await apiFetch(`/admin/referrals/campaigns/${c.id}`, { method: "PATCH", body: JSON.stringify({ active: !c.active }) }); await load(); }}>{c.active ? dict.growth.closeAction : dict.growth.openAction}</button>
              </li>
            ))}
            {refCampaigns.length === 0 ? <li className="text-xs text-slate-400">{dict.growth.refCampaignsEmpty}</li> : null}
          </ul>
        </div>
        </div>
      ) : null}
      {tab === "referrals" ? (
        <div className="atab-panel">
      <div className="acard mt-4 space-y-4">
        <div className="font-semibold">{dict.growth.referralTitle}</div>
        {!referrals ? (loadDone ? <ErrorState message={dict.growth.referralLoadError} onRetry={load} /> : <div className="askel-table" />) : (
          <>
            <div className="grid grid-cols-2 gap-2 text-center lg:grid-cols-5">
              <div className="rounded-xl bg-slate-800 p-3"><div className="text-xl font-bold">{fmtNumber(locale, referrals.totals.signups)}</div><div className="text-xs text-slate-400">{dict.growth.statSignups}</div></div>
              <div className="rounded-xl bg-slate-800 p-3"><div className="text-xl font-bold">{fmtNumber(locale, referrals.totals.rewarded)}</div><div className="text-xs text-slate-400">{dict.growth.statRewarded}</div></div>
              <div className="rounded-xl bg-slate-800 p-3"><div className="text-xl font-bold">{referrals.totals.signups ? `${Math.round((referrals.totals.rewarded / referrals.totals.signups) * 1000) / 10}%` : "—"}</div><div className="text-xs text-slate-400">{dict.growth.statConversion}</div></div>
              <div className="rounded-xl bg-slate-800 p-3"><div className="text-xl font-bold">{taka(referrals.totals.paidOutMinor)}</div><div className="text-xs text-slate-400">{dict.growth.statCreditGiven}</div></div>
              <div className="rounded-xl bg-slate-800 p-3"><div className="text-xl font-bold text-red-300">{fmtNumber(locale, referrals.totals.clawedBack)}</div><div className="text-xs text-slate-400">{dict.growth.statClawback}</div></div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="space-y-3 rounded-xl bg-slate-800/60 p-3">
                <div className="text-sm font-semibold">{dict.growth.rewardSettings}</div>
                <label className="flex items-center justify-between text-sm">{dict.growth.programEnabled}
                  <input type="checkbox" checked={refEnabled} onChange={(e) => setRefEnabled(e.target.checked)} /></label>
                <label className="block text-sm">{dict.growth.rewardMode}
                  <select className="ainput mt-1" value={refMode} onChange={(e) => setRefMode(e.target.value)}>
                    <option value="flat">{dict.growth.modeFlat}</option>
                    <option value="percent">{dict.growth.modePercent}</option>
                    <option value="per_plan">{dict.growth.modePerPlan}</option>
                  </select></label>
                {refMode === "flat" ? (
                  <label className="block text-sm">{dict.growth.flatRewardTaka}
                    <input className="ainput mt-1" type="number" min={0} value={refReward} onChange={(e) => setRefReward(e.target.value)} /></label>
                ) : null}
                {refMode === "percent" ? (
                  <label className="block text-sm">{dict.growth.percentLabel}
                    <input className="ainput mt-1" type="number" min={0} max={100} value={refPercent} onChange={(e) => setRefPercent(e.target.value)} /></label>
                ) : null}
                {refMode === "per_plan" ? (
                  <div className="grid grid-cols-3 gap-2">
                    {["STARTER", "GROWTH", "AGENCY"].map((planName) => (
                      <label key={planName} className="block text-xs">{t("growth.perPlanTaka", { plan: planName })}
                        <input className="ainput mt-1" type="number" min={0} value={refPerPlan[planName] ?? ""} onChange={(e) => setRefPerPlan({ ...refPerPlan, [planName]: e.target.value })} /></label>
                    ))}
                    <p className="col-span-3 text-xs text-slate-400">{dict.growth.perPlanNote}</p>
                    <label className="block text-xs">{dict.growth.flatFallback}
                      <input className="ainput mt-1" type="number" min={0} value={refReward} onChange={(e) => setRefReward(e.target.value)} /></label>
                  </div>
                ) : null}
                <div className="grid grid-cols-3 gap-2">
                  <label className="block text-xs">{dict.growth.welcomeCredit}
                    <input className="ainput mt-1" type="number" min={0} value={refBonus} onChange={(e) => setRefBonus(e.target.value)} /></label>
                  <label className="block text-xs">{dict.growth.minFirstPayment}
                    <input className="ainput mt-1" type="number" min={0} value={refMinPay} onChange={(e) => setRefMinPay(e.target.value)} /></label>
                  <label className="block text-xs">{dict.growth.creditExpiry}
                    <input className="ainput mt-1" type="number" min={0} value={refExpiry} onChange={(e) => setRefExpiry(e.target.value)} /></label>
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-semibold">{dict.growth.milestones}</div>
                  {refMilestones.map((m, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input className="ainput max-w-[110px]" type="number" min={1} placeholder={dict.growth.milestoneCountPlaceholder} value={m.count} onChange={(e) => setRefMilestones(refMilestones.map((x, j) => (j === i ? { ...x, count: e.target.value } : x)))} />
                      <span className="text-xs text-slate-400">{dict.growth.milestoneMiddle}</span>
                      <input className="ainput max-w-[110px]" type="number" min={0} value={m.bonus} onChange={(e) => setRefMilestones(refMilestones.map((x, j) => (j === i ? { ...x, bonus: e.target.value } : x)))} />
                      <button className="abtn-danger !px-2 !py-0.5" onClick={() => setRefMilestones(refMilestones.filter((_, j) => j !== i))}>✕</button>
                    </div>
                  ))}
                  <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => setRefMilestones([...refMilestones, { count: "", bonus: "" }])}>{dict.growth.milestoneAdd}</button>
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
                    toast(dict.growth.referralSaved); await load();
                  } catch (e) { toast(e instanceof Error ? e.message : dict.growth.referralSaveFailed, "error"); }
                  finally { setSavingRef(false); }
                }}>{savingRef ? dict.common.busy : dict.common.save}</button>
              </div>

              <div className="space-y-3">
                <div className="rounded-xl bg-slate-800/60 p-3">
                  <div className="text-sm font-semibold">{dict.growth.topReferrers}</div>
                  <ul className="mt-2 space-y-1.5">
                    {referrals.referrers.slice(0, 8).map((r, i) => (
                      <li key={i} className="rounded-lg bg-slate-800 px-3 py-2 text-xs">
                        <b>{r.referrerEmail ?? dict.growth.campaignFallbackName}</b> · {t("growth.referrerRow", { signups: fmtNumber(locale, r.signups), rewarded: fmtNumber(locale, r.rewarded), conversion: r.conversionPercent !== null && r.conversionPercent !== undefined ? fmtNumber(locale, r.conversionPercent) : "—", earned: taka(r.earnedMinor) })}
                      </li>
                    ))}
                    {referrals.referrers.length === 0 ? <li className="text-xs text-slate-400">{dict.growth.noReferrers}</li> : null}
                  </ul>
                </div>
                <div className="rounded-xl bg-slate-800/60 p-3">
                  <div className="text-sm font-semibold">{dict.growth.abuseTitle}</div>
                  <p className="mt-1 text-xs text-slate-400">{dict.growth.abuseNote}</p>
                  <ul className="mt-2 space-y-1.5">
                    {referrals.flagged.map((r, i) => (
                      <li key={i} className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-200">
                        <b>{r.referrerEmail ?? "?"}</b> · {t("growth.flaggedRow", { signups: fmtNumber(locale, r.signups), last24h: fmtNumber(locale, r.signupsLast24h), rewarded: fmtNumber(locale, r.rewarded) })} · {r.flags.map((f) => (FLAG_KEY[f] ? t(FLAG_KEY[f]) : f)).join(" · ")}
                      </li>
                    ))}
                    {referrals.flagged.length === 0 ? <li className="text-xs text-slate-400">{dict.growth.noFlagged}</li> : null}
                  </ul>
                </div>
                <ul className="space-y-1.5">
                  {referrals.recent.slice(0, 6).map((r) => (
                    <li key={r.id} className="rounded-lg bg-slate-800 px-3 py-2 text-xs">
                      {r.referrerEmail ?? dict.growth.recentCampaign} → {r.referredEmail ?? "?"} · {r.status === "rewarded" ? t("growth.recentRewarded", { amount: taka(r.rewardMinor ?? 0) }) : r.status === "clawed_back" ? dict.growth.recentClawedBack : dict.growth.recentPending} · {fmtDateTime(locale, r.createdAt, "date")}
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
          <div className="font-semibold">{dict.growth.changelogTitle}</div>
          <p className="text-xs text-slate-400">{dict.growth.changelogNote}</p>
          <div className="flex gap-2">
            <label className="block text-xs">{dict.growth.version}
              <input className="ainput mt-1 max-w-[120px]" placeholder={dict.growth.versionPlaceholder} value={clVersion} onChange={(e) => setClVersion(e.target.value)} />
            </label>
            <label className="block flex-1 text-xs">{dict.growth.entryTitle}
              <input className="ainput mt-1" placeholder={dict.growth.entryTitle} value={clTitle} onChange={(e) => setClTitle(e.target.value)} />
            </label>
          </div>
          {clErr.title ? <p className="text-xs text-red-300">{clErr.title}</p> : null}
          <label className="block text-xs">{dict.growth.whatsNew}
            <textarea className="ainput mt-1" rows={3} placeholder={dict.growth.whatsNewPlaceholder} value={clBody} onChange={(e) => setClBody(e.target.value)} />
          </label>
          {clErr.body ? <p className="text-xs text-red-300">{clErr.body}</p> : null}
          <button className="abtn" disabled={publishing} onClick={async () => {
            const errs = { title: clTitle.trim() ? undefined : dict.growth.titleRequired, body: clBody.trim() ? undefined : dict.growth.bodyRequired };
            setClErr(errs);
            if (errs.title || errs.body) return;
            setPublishing(true);
            try {
              await apiFetch("/admin/changelog", { method: "POST", body: JSON.stringify({ version: clVersion || undefined, title: clTitle, body: clBody, published: true }) });
              setClTitle(""); setClBody(""); setClVersion(""); toast(dict.growth.changelogPublished); await load();
            } catch (e) { toast(e instanceof Error ? e.message : dict.growth.notDone, "error"); }
            finally { setPublishing(false); }
          }}>{publishing ? dict.common.busy : dict.growth.publish}</button>
          {!loadDone ? <div className="askel-table" /> : null}
          {loadDone && entries.length === 0 ? <EmptyState title={dict.growth.changelogEmpty} /> : null}
          <ul className="space-y-1.5">
            {entries.slice(0, 6).map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-2 rounded-lg bg-slate-800 px-3 py-2 text-xs">
                <span><b>{e.title}</b>{e.version ? ` · ${e.version}` : ""} · {e.published ? dict.growth.publishedState : dict.growth.draftState}</span>
                <span className="flex shrink-0 gap-1">
                  <button className="abtn-secondary !px-2 !py-0.5" onClick={async () => { await apiFetch(`/admin/changelog/${e.id}`, { method: "PATCH", body: JSON.stringify({ published: !e.published }) }); await load(); }}>{e.published ? dict.growth.hideAction : dict.growth.publishAction}</button>
                  <button className="abtn-danger !px-2 !py-0.5" onClick={async () => { if (await askConfirm({ title: dict.growth.deleteConfirmTitle, confirmLabel: dict.growth.deleteConfirm, danger: true })) { await apiFetch(`/admin/changelog/${e.id}`, { method: "DELETE" }); await load(); } }}>{dict.common.delete}</button>
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
          <div className="font-semibold">{dict.growth.feedbackTitle}</div>
          {!feedback ? (loadDone ? <ErrorState message={dict.growth.feedbackLoadError} onRetry={load} /> : <div className="askel-table" />) : (
            <>
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="rounded-xl bg-slate-800 p-3"><div className="text-xl font-bold">{feedback.summary.nps ?? "—"}</div><div className="text-xs text-slate-400">{dict.growth.npsScore}</div></div>
                <div className="rounded-xl bg-slate-800 p-3"><div className="text-xl font-bold">{feedback.summary.average ?? "—"}</div><div className="text-xs text-slate-400">{dict.growth.average}</div></div>
                <div className="rounded-xl bg-slate-800 p-3"><div className="text-xl font-bold text-emerald-400">{feedback.summary.promoters}</div><div className="text-xs text-slate-400">{dict.growth.promoters}</div></div>
                <div className="rounded-xl bg-slate-800 p-3"><div className="text-xl font-bold text-red-400">{feedback.summary.detractors}</div><div className="text-xs text-slate-400">{dict.growth.detractors}</div></div>
              </div>
              <ul className="space-y-1.5">
                {feedback.recent.slice(0, 8).map((f) => (
                  <li key={f.id} className="rounded-lg bg-slate-800 px-3 py-2 text-xs">
                    <b>{fmtNumber(locale, f.score)}/{fmtNumber(locale, 10)}</b> · {f.organizationName ?? f.id} · {fmtDateTime(locale, f.createdAt, "date")}
                    {f.comment ? <span className="block text-slate-400">“{f.comment}”</span> : null}
                  </li>
                ))}
                {feedback.recent.length === 0 ? <li className="text-xs text-slate-400">{dict.growth.noFeedback}</li> : null}
              </ul>
            </>
          )}
        </div>
        </div>
      ) : null}
    </AdminShell>
  );
}
