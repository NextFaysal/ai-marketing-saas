"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { EmptyState } from "@repo/ui";

interface Integration { id: string; provider: string; store?: { name: string } | null }
interface AdAccount { id: string; platform: string; name: string }
interface Competitor { id: string; name: string }
interface Plan { id: string; name: string; status: string }
interface Job { id: string; name: string; type: string; targetId: string; intervalMinutes: number; enabled: boolean; lastRunAt?: string | null; nextRunAt: string; lastStatus?: string | null; lastError?: string | null }
interface Rule { id: string; name: string; metric: string; comparator: string; threshold: string; windowDays: number; action: string; campaignPlanId?: string | null; enabled: boolean; lastEvaluatedAt?: string | null; lastTriggeredAt?: string | null }
interface Run { id: string; kind: string; refId: string; status: string; detail?: string | null; createdAt: string }

const JOB_TYPES_BY_TARGET: Record<string, { value: string; label: string }[]> = {
  integration: [
    { value: "woo_products", label: "WooCommerce Products Sync" }, { value: "woo_orders", label: "WooCommerce Orders Sync" },
    { value: "shopify_products", label: "Shopify Products Sync" }, { value: "shopify_orders", label: "Shopify Orders Sync" },
  ],
  account: [
    { value: "meta_insights", label: "Meta Insights Sync" }, { value: "google_insights", label: "Google Insights Sync" }, { value: "tiktok_insights", label: "TikTok Insights Sync" },
  ],
  competitor: [{ value: "competitor_ads", label: "Competitor Ads Sync" }, { value: "competitor_scan", label: "Competitor Website Scan" }],
  org: [{ value: "daily_report", label: "Daily AI Report" }, { value: "weekly_ads_report", label: "Weekly Ads Report (ইমেইল)" }, { value: "meta_status_sync", label: "Meta Status Sync (সব Published Plan)" }, { value: "dayparting", label: "Dayparting (Ad Set সময়সূচি প্রয়োগ)" }, { value: "audience_refresh", label: "Audience Membership Refresh" }, { value: "subscription_sweep", label: "Subscription Sweep (মেয়াদ শেষ হলে Past Due)" }, { value: "dunning_reminders", label: "Dunning Reminder (Past Due হলে ইমেইল)" }],
};

export default function AutomationsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [jobForm, setJobForm] = useState({ name: "", targetKind: "integration", targetId: "", type: "", intervalMinutes: 60 });
  const [ruleForm, setRuleForm] = useState({ name: "", metric: "platform_cpa", comparator: "gt", threshold: "", windowDays: 3, action: "alert", campaignPlanId: "", percent: "20", minDaily: "", maxDaily: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const [j, r, rn, ints, accs, comps, pls] = await Promise.all([
        apiFetch<Job[]>(`/organizations/${orgId}/automation/jobs`),
        apiFetch<Rule[]>(`/organizations/${orgId}/automation/rules`),
        apiFetch<Run[]>(`/organizations/${orgId}/automation/runs`),
        apiFetch<Integration[]>(`/organizations/${orgId}/integrations`),
        apiFetch<AdAccount[]>(`/organizations/${orgId}/ad-accounts`),
        apiFetch<Competitor[]>(`/organizations/${orgId}/competitors`),
        apiFetch<Plan[]>(`/organizations/${orgId}/campaign-plans`),
      ]);
      setJobs(j); setRules(r); setRuns(rn); setIntegrations(ints); setAccounts(accs); setCompetitors(comps); setPlans(pls);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function wrap<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
    setBusy(key); setError("");
    try { return await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Failed"); return null; } finally { setBusy(""); }
  }

  const targetOptions = jobForm.targetKind === "integration" ? integrations.map((i) => ({ id: i.id, label: `${i.provider} - ${i.store?.name ?? ""}` }))
    : jobForm.targetKind === "account" ? accounts.filter((a) => ["meta", "google", "tiktok"].includes(a.platform)).map((a) => ({ id: a.id, label: `${a.platform} - ${a.name}` }))
    : jobForm.targetKind === "competitor" ? competitors.map((c) => ({ id: c.id, label: c.name }))
    : [{ id: "org", label: "এই Organization" }];
  const typeOptions = JOB_TYPES_BY_TARGET[jobForm.targetKind] ?? [];

  async function createJob(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    const targetId = jobForm.targetKind === "org" ? orgId : jobForm.targetId;
    const res = await wrap("job", () => apiFetch(`/organizations/${orgId}/automation/jobs`, {
      method: "POST", body: JSON.stringify({ name: jobForm.name, type: jobForm.type, targetId, intervalMinutes: Number(jobForm.intervalMinutes) }),
    }));
    if (res) { setJobForm({ name: "", targetKind: "integration", targetId: "", type: "", intervalMinutes: 60 }); setNotice("Scheduled Job তৈরি হয়েছে। নির্ধারিত সময়ে সার্ভার নিজে চালাবে।"); await load(); }
  }

  async function createRule(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    const res = await wrap("rule", () => apiFetch(`/organizations/${orgId}/automation/rules`, {
      method: "POST", body: JSON.stringify({
        name: ruleForm.name, metric: ruleForm.metric, comparator: ruleForm.comparator, threshold: ruleForm.threshold,
        windowDays: Number(ruleForm.windowDays), action: ruleForm.action, campaignPlanId: ruleForm.campaignPlanId || undefined,
        actionConfig: ruleForm.action === "scale_budget" ? {
          percent: Number(ruleForm.percent),
          minDailyMinor: ruleForm.minDaily ? Math.round(Number(ruleForm.minDaily) * 100) : undefined,
          maxDailyMinor: ruleForm.maxDaily ? Math.round(Number(ruleForm.maxDaily) * 100) : undefined,
          cooldownHours: 24,
        } : undefined,
      }),
    }));
    if (res) { setRuleForm({ name: "", metric: "platform_cpa", comparator: "gt", threshold: "", windowDays: 3, action: "alert", campaignPlanId: "", percent: "20", minDaily: "", maxDaily: "" }); setNotice("Rule তৈরি হয়েছে। প্রতি ঘণ্টায় যাচাই হবে, অথবা এখন যাচাই বাটন চাপুন।"); await load(); }
  }

  const inputCls = "input mt-1";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">Automations</h1>
        <p className="text-sm text-slate-500">নির্ধারিত সময়ে Sync ও Report, আর প্রকাশিত Campaign এর জন্য সুরক্ষা Rule। Rule দিয়ে Pause হলে সেটি Meta এর নিশ্চিতকরণ ছাড়া ধরা হয় না, আর প্রতিটি ঘটনা Runs তালিকায় প্রমাণসহ থাকে।</p>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      <div className="space-y-3 card p-5">
        <div className="font-semibold">Scheduled Jobs ({jobs.length})</div>
        {jobs.length === 0 ? <EmptyState title="কোনো Scheduled Job নেই" description="নিচের ফর্মে যেমন WooCommerce Orders প্রতি ৩০ মিনিটে Sync এর মতো Job বানান।" /> : jobs.map((j) => (
          <div key={j.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <div>
              <span className="font-medium">{j.name}</span> <span className="text-slate-400">({j.type}, প্রতি {j.intervalMinutes} মিনিট)</span>
              <div className="text-xs text-slate-500">শেষ: {j.lastRunAt ? new Date(j.lastRunAt).toLocaleString() : "এখনো হয়নি"} {j.lastStatus ? `(${j.lastStatus})` : ""} · পরের: {new Date(j.nextRunAt).toLocaleString()}{j.lastError ? <span className="text-red-600"> · {j.lastError}</span> : null}</div>
            </div>
            <div className="flex gap-2">
              <button className="rounded-lg bg-blue-600 px-3 py-1.5 text-white disabled:opacity-50" disabled={busy !== ""} onClick={async () => { const o = getOrganizationId(); if (o) { await wrap(`run-${j.id}`, () => apiFetch(`/organizations/${o}/automation/jobs/${j.id}/run`, { method: "POST" })); await load(); } }}>এখন চালান</button>
              <button className="rounded-lg border px-3 py-1.5" onClick={async () => { const o = getOrganizationId(); if (o) { await wrap(`tog-${j.id}`, () => apiFetch(`/organizations/${o}/automation/jobs/${j.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !j.enabled }) })); await load(); } }}>{j.enabled ? "বন্ধ করুন" : "চালু করুন"}</button>
            </div>
          </div>
        ))}
        <form onSubmit={createJob} className="grid gap-3 border-t pt-3 lg:grid-cols-5">
          <label className="block text-sm">Job এর নাম<input className={inputCls} value={jobForm.name} onChange={(e) => setJobForm({ ...jobForm, name: e.target.value })} required placeholder="Orders sync" /></label>
          <label className="block text-sm">Target ধরন
            <select className={inputCls} value={jobForm.targetKind} onChange={(e) => setJobForm({ ...jobForm, targetKind: e.target.value, targetId: "", type: "" })}>
              <option value="integration">Store Integration</option><option value="account">Ad Account</option><option value="competitor">Competitor</option><option value="org">Organization</option>
            </select>
          </label>
          <label className="block text-sm">Target
            <select className={inputCls} value={jobForm.targetId} onChange={(e) => setJobForm({ ...jobForm, targetId: e.target.value })} required={jobForm.targetKind !== "org"}>
              <option value="">বেছে নিন</option>
              {targetOptions.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <label className="block text-sm">কাজ
            <select className={inputCls} value={jobForm.type} onChange={(e) => setJobForm({ ...jobForm, type: e.target.value })} required>
              <option value="">বেছে নিন</option>
              {typeOptions.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <label className="block text-sm">প্রতি কত মিনিটে<input className={inputCls} type="number" min={5} value={jobForm.intervalMinutes} onChange={(e) => setJobForm({ ...jobForm, intervalMinutes: Number(e.target.value) })} /></label>
          <button className="self-end btn-primary disabled:opacity-50" disabled={busy !== ""}>Job তৈরি করুন</button>
        </form>
      </div>

      <div className="space-y-3 card p-5">
        <div className="flex items-center justify-between">
          <div className="font-semibold">Automation Rules ({rules.length})</div>
          <button className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50" disabled={busy !== ""} onClick={async () => { const o = getOrganizationId(); if (o) { const r = await wrap("eval", () => apiFetch<{ results: { triggered: boolean }[] }>(`/organizations/${o}/automation/rules/evaluate`, { method: "POST" })); if (r) setNotice(`Rule যাচাই শেষ: ${r.results.filter((x) => x.triggered).length}টি Trigger হয়েছে।`); await load(); } }}>এখন সব Rule যাচাই করুন</button>
        </div>
        {rules.length === 0 ? <EmptyState title="কোনো Rule নেই" description="যেমন: Platform CPA ৩ দিনে ৩০০ টাকার বেশি হলে Campaign Pause করুন।" /> : rules.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <div>
              <span className="font-medium">{r.name}</span>
              <div className="text-xs text-slate-500">{r.metric} {r.comparator === "gt" ? ">" : "<"} {r.threshold} · {r.windowDays} দিনের উইন্ডো · অ্যাকশন: {r.action === "pause_campaign" ? "Campaign Pause" : "শুধু Alert"} · শেষ যাচাই: {r.lastEvaluatedAt ? new Date(r.lastEvaluatedAt).toLocaleString() : "হয়নি"} · শেষ Trigger: {r.lastTriggeredAt ? new Date(r.lastTriggeredAt).toLocaleString() : "হয়নি"}</div>
            </div>
            <button className="rounded-lg border px-3 py-1.5" onClick={async () => { const o = getOrganizationId(); if (o) { await wrap(`rtog-${r.id}`, () => apiFetch(`/organizations/${o}/automation/rules/${r.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !r.enabled }) })); await load(); } }}>{r.enabled ? "বন্ধ করুন" : "চালু করুন"}</button>
          </div>
        ))}
        <form onSubmit={createRule} className="grid gap-3 border-t pt-3 lg:grid-cols-4">
          <label className="block text-sm">Rule এর নাম<input className={inputCls} value={ruleForm.name} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} required placeholder="CPA guard" /></label>
          <label className="block text-sm">Metric
            <select className={inputCls} value={ruleForm.metric} onChange={(e) => setRuleForm({ ...ruleForm, metric: e.target.value })}>
              <option value="platform_cpa">Platform CPA (মুদ্রা এককে)</option>
              <option value="ad_frequency">Ad Frequency (সর্বোচ্চ, Ad-level)</option>
              <option value="ad_ctr_percent">Ad CTR % (সর্বনিম্ন, Ad-level)</option>
              <option value="month_spend">মাসের মোট খরচ (মুদ্রা এককে)</option>
              <option value="platform_roas">Platform ROAS (অনুপাত)</option>
              <option value="spend_no_conversions">Conversion ছাড়া Spend (মুদ্রা এককে)</option>
              <option value="frequency">Frequency (Impressions/Reach)</option>
              <option value="ctr_percent">CTR %</option>
              <option value="cpm">CPM (মুদ্রা এককে)</option>
              <option value="first_party_roas">First-party ROAS (আমাদের Attribution)</option>
              <option value="first_party_cpa">First-party CPA (আমাদের Attribution)</option>
            </select>
          </label>
          <label className="block text-sm">শর্ত
            <select className={inputCls} value={ruleForm.comparator} onChange={(e) => setRuleForm({ ...ruleForm, comparator: e.target.value })}>
              <option value="gt">বেশি হলে ( &gt; )</option><option value="lt">কম হলে ( &lt; )</option>
            </select>
          </label>
          <label className="block text-sm">Threshold<input className={inputCls} value={ruleForm.threshold} onChange={(e) => setRuleForm({ ...ruleForm, threshold: e.target.value })} required placeholder="300" /></label>
          <label className="block text-sm">উইন্ডো (দিন)<input className={inputCls} type="number" min={1} max={30} value={ruleForm.windowDays} onChange={(e) => setRuleForm({ ...ruleForm, windowDays: Number(e.target.value) })} /></label>
          <label className="block text-sm">অ্যাকশন
            <select className={inputCls} value={ruleForm.action} onChange={(e) => setRuleForm({ ...ruleForm, action: e.target.value })}>
              <option value="alert">শুধু Alert (নিরাপদ)</option><option value="pause_campaign">Campaign Pause করুন</option>
              <option value="activate_campaign">Campaign Active করুন</option><option value="scale_budget">Budget বাড়ান/কমান (%)</option>
              <option value="pause_ad">বিজ্ঞাপন Pause (শুধু Ad-level মেট্রিকে)</option>
            </select>
          </label>
          <label className="block text-sm">শুধু এই Plan (ঐচ্ছিক)
            <select className={inputCls} value={ruleForm.campaignPlanId} onChange={(e) => setRuleForm({ ...ruleForm, campaignPlanId: e.target.value })}>
              <option value="">সব Published Plan</option>
              {plans.filter((p) => p.status === "published").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {ruleForm.action === "scale_budget" ? (<>
            <label className="block text-sm">Budget পরিবর্তন % (যেমন 20 বা -20)<input className={inputCls} value={ruleForm.percent} onChange={(e) => setRuleForm({ ...ruleForm, percent: e.target.value })} /></label>
            <label className="block text-sm">সর্বনিম্ন দৈনিক বাজেট (ঐচ্ছিক)<input className={inputCls} value={ruleForm.minDaily} onChange={(e) => setRuleForm({ ...ruleForm, minDaily: e.target.value })} placeholder="100" /></label>
            <label className="block text-sm">সর্বোচ্চ দৈনিক বাজেট (ঐচ্ছিক)<input className={inputCls} value={ruleForm.maxDaily} onChange={(e) => setRuleForm({ ...ruleForm, maxDaily: e.target.value })} placeholder="5000" /></label>
          </>) : null}
          <button className="self-end btn-primary disabled:opacity-50" disabled={busy !== ""}>Rule তৈরি করুন</button>
        </form>
        <p className="text-xs text-slate-400">Platform Metric প্ল্যাটফর্মের Reported সংখ্যা; First-party Metric আমাদের নিজের Attribution Credit থেকে (Campaign এর নাম/ID মিলিয়ে)। Budget Scaling Meta নিশ্চিত করলেই কেবল প্রয়োগ হয়, ২৪ ঘণ্টা Cooldown থাকে।</p>
      </div>

      <div className="card p-5">
        <div className="font-semibold">সাম্প্রতিক Runs</div>
        {runs.length === 0 ? <p className="mt-2 text-sm text-slate-500">এখনো কোনো Run নেই।</p> : (
          <div className="mt-2 space-y-1">
            {runs.slice(0, 30).map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
                <span><span className="font-medium capitalize">{r.kind}</span> · {new Date(r.createdAt).toLocaleString()}<span className="block text-xs text-slate-500">{r.detail ?? ""}</span></span>
                <span className={r.status === "success" ? "text-green-600" : r.status === "triggered" ? "text-amber-600" : "text-red-600"}>{r.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
