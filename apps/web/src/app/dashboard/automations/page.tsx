"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { EmptyState } from "@repo/ui";
import {
  SCHEDULED_JOB_BLUEPRINTS,
  AD_RULE_BLUEPRINTS,
  type ScheduledJobBlueprint,
  type AdRuleBlueprint,
  bpText,
} from "@/lib/automation-blueprints";
import { useLocale } from "@/lib/i18n/provider";
import { automationsBn, automationsEn } from "@/lib/i18n/automations";
import { fmtNumber, fmtMoney, fmtMoneyMinor, fmtDate } from "@repo/contracts";
import type { UiLocale } from "@repo/contracts";

const AD = (locale?: string) => (locale === "en" ? automationsEn : automationsBn);
type AutoKey = keyof typeof automationsBn;
const at = (locale: string | undefined, key: AutoKey, params?: Record<string, string | number>): string => {
  let out: string = AD(locale)[key];
  if (params) for (const [k, v] of Object.entries(params)) out = out.split(`{${k}}`).join(String(v));
  return out;
};

interface Integration {
  id: string;
  provider: string;
  store?: { name: string } | null;
}

interface AdAccount {
  id: string;
  platform: string;
  name: string;
}

interface Competitor {
  id: string;
  name: string;
}

interface Plan {
  id: string;
  name: string;
  status: string;
}

interface Job {
  id: string;
  name: string;
  type: string;
  targetId: string;
  intervalMinutes: number;
  enabled: boolean;
  lastRunAt?: string | null;
  nextRunAt: string;
  lastStatus?: string | null;
  lastError?: string | null;
}

interface Rule {
  id: string;
  name: string;
  metric: string;
  comparator: string;
  threshold: string;
  windowDays: number;
  action: string;
  campaignPlanId?: string | null;
  // CA10: execute | suggest (absent on pre-CA10 rows = execute)
  mode?: string;
  enabled: boolean;
  lastEvaluatedAt?: string | null;
  lastTriggeredAt?: string | null;
}

interface RuleSuggestion {
  id: string;
  ruleId: string;
  campaignPlanId: string;
  action: string;
  actionPayload?: { percent?: number; minDailyMinor?: number; maxDailyMinor?: number; adExternalIds?: string[] } | null;
  reason: string;
  facts?: { metric?: string; value?: number; threshold?: string; comparator?: string; windowDays?: number } | null;
  status: string;
  ruleName?: string | null;
  planName?: string | null;
  rejectReason?: string | null;
  executionResult?: { ok?: boolean; executed?: string | null; skipped?: string; changes?: unknown[]; error?: string } | null;
  createdAt: string;
}

interface Run {
  id: string;
  kind: string;
  refId: string;
  status: string;
  detail?: string | null;
  createdAt: string;
}

interface JobHealth {
  jobId: string;
  band: "ok" | "failing" | "never_run";
  runs7d: number;
  decided7d: number;
  successRate7d: number | null;
  consecutiveFailures: number;
}

interface DeadLetter {
  id: string;
  jobType?: string | null;
  scheduledJobId?: string | null;
  jobName?: string | null;
  error: string;
  errorTruncated: boolean;
  errorLength: number;
  attempts: number;
  createdAt: string;
  replayedAt?: string | null;
  open: boolean;
}

interface HealthResponse {
  jobs: JobHealth[];
  deadLetters: { openCount: number; latest: DeadLetter[] };
}

interface JobTemplate {
  key: string;
  name: string;
  descriptionBn: string;
  type: string;
  targetKind: "org" | "integration" | "competitor";
  intervalMinutes: number;
}

type TabKey = "jobs" | "rules" | "presets" | "health" | "runs" | "stock-guard" | "replenishment";

function intervalLabel(min: number, locale: UiLocale = "bn"): string {
  const n = (v: number) => fmtNumber(locale, v);
  if (min % 10080 === 0) return min === 10080 ? at(locale, "intWeeklyOnce") : at(locale, "intEveryWeeks", { n: n(min / 10080) });
  if (min % 1440 === 0) return min === 1440 ? at(locale, "intDailyOnce") : at(locale, "intEveryDays", { n: n(min / 1440) });
  if (min % 60 === 0) return min === 60 ? at(locale, "intHourly") : at(locale, "intEveryHours", { n: n(min / 60) });
  return at(locale, "intEveryMinutes", { n: n(min) });
}

function formatRelativeTime(dateStr?: string | null, locale: UiLocale = "bn"): string {
  if (!dateStr) return at(locale, "relNever");
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(Math.abs(diff) / 60000);
  if (minutes < 1) return diff > 0 ? at(locale, "relJustNow") : at(locale, "relWithin1Min");
  if (minutes < 60) return diff > 0 ? at(locale, "relMinAgo", { n: fmtNumber(locale, minutes) }) : at(locale, "relMinLater", { n: fmtNumber(locale, minutes) });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return diff > 0 ? at(locale, "relHourAgo", { n: fmtNumber(locale, hours) }) : at(locale, "relHourLater", { n: fmtNumber(locale, hours) });
  const days = Math.floor(hours / 24);
  return diff > 0 ? at(locale, "relDayAgo", { n: fmtNumber(locale, days) }) : at(locale, "relDayLater", { n: fmtNumber(locale, days) });
}

const RULE_ACTION_KEY: Record<string, AutoKey> = {
  alert: "actionAlertOnly",
  scale_budget: "actionScaleBudget",
  pause_ad: "actionPauseAd",
};
function ruleActionLabelsFor(locale: string): typeof RULE_ACTION_LABELS {
  const out: typeof RULE_ACTION_LABELS = {};
  for (const [k, v] of Object.entries(RULE_ACTION_LABELS)) {
    const key = RULE_ACTION_KEY[k];
    out[k] = key ? { ...v, label: at(locale, key) } : v;
  }
  return out;
}

const RULE_ACTION_LABELS: Record<string, { label: string; badgeCls: string; icon: string }> = {
  pause_campaign: { label: "Campaign Pause", badgeCls: "bg-rose-50 text-rose-700 border-rose-200", icon: "⏸️" },
  alert: { label: "শুধু Alert (নিরাপদ)", badgeCls: "bg-amber-50 text-amber-700 border-amber-200", icon: "🔔" },
  activate_campaign: { label: "Campaign Active", badgeCls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: "▶️" },
  scale_budget: { label: "Budget স্কেলিং (%)", badgeCls: "bg-indigo-50 text-indigo-700 border-indigo-200", icon: "📈" },
  pause_ad: { label: "বিজ্ঞাপন Pause (Ad-level)", badgeCls: "bg-purple-50 text-purple-700 border-purple-200", icon: "🛑" },
};

const METRIC_LABELS: Record<string, string> = {
  platform_cpa: "Platform CPA (মুদ্রা এককে)",
  platform_roas: "Platform ROAS (অনুপাত)",
  spend_no_conversions: "Conversion ছাড়া Spend (মুদ্রা এককে)",
  ad_frequency: "Ad Frequency (বিজ্ঞাপন-লেভেল)",
  ad_ctr_percent: "Ad CTR % (বিজ্ঞাপন-লেভেল)",
  month_spend: "চলতি মাসের মোট খরচ (মুদ্রা এককে)",
  frequency: "Campaign Frequency (Impressions/Reach)",
  ctr_percent: "Campaign CTR %",
  cpm: "CPM (প্রতি হাজার ইমপ্রেশন খরচ)",
  first_party_roas: "First-party ROAS (আমাদের Attribution)",
  first_party_cpa: "First-party CPA (আমাদের Attribution)",
};

const METRIC_KEY: Record<string, AutoKey> = {
  platform_cpa: "metricCpa", platform_roas: "metricRoas", spend_no_conversions: "metricSpendNoConv",
  ad_frequency: "metricFreq", ad_ctr_percent: "metricCtr", month_spend: "metricMonthSpend",
  cpm: "metricCpm", first_party_roas: "metricFpRoas", first_party_cpa: "metricFpCpa",
};
function metricLabelsFor(locale: string): Record<string, string> {
  const out: Record<string, string> = { ...METRIC_LABELS };
  for (const [k, key] of Object.entries(METRIC_KEY)) out[k] = at(locale, key);
  return out;
}

const HEALTH_BADGE: Record<string, { text: string; cls: string; dot: string }> = {
  ok: { text: "সুস্থ", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  failing: { text: "ব্যর্থ হচ্ছে", cls: "bg-rose-50 text-rose-700 border-rose-200", dot: "bg-rose-500" },
  never_run: { text: "এখনো চলেনি", cls: "bg-slate-50 text-slate-600 border-slate-200", dot: "bg-slate-400" },
};

const HEALTH_KEY: Record<string, AutoKey> = { ok: "bandOk", failing: "bandFailing", never_run: "bandNeverRun" };
function healthBadgeFor(locale: string): typeof HEALTH_BADGE {
  const out: typeof HEALTH_BADGE = {};
  for (const [k, v] of Object.entries(HEALTH_BADGE)) {
    const key = HEALTH_KEY[k];
    out[k] = key ? { ...v, text: at(locale, key) } : v;
  }
  return out;
}

const JOB_TYPE_KEY: Record<string, AutoKey> = {
  daily_briefing: "jobDailyBriefing", ad_spend_watchdog: "jobAdSpendWatchdog", weekly_ads_report: "jobWeeklyAdsReport",
  meta_status_sync: "jobMetaStatusSync", dayparting: "jobDayparting", plan_schedule_sweep: "jobPlanSweep",
  inbox_assignment_sweep: "jobInboxAssignment", lead_followup_sweep: "jobLeadFollowup", social_publish_due: "jobSocialPublish",
  subscription_sweep: "jobSubscriptionSweep", billing_reminders: "jobBillingReminder", audit_retention: "jobAuditRetention",
  dunning_reminders: "jobDunning", email_sync: "jobEmailSync", inbox_retention: "jobInboxRetention",
  inbox_autoreply_sweep: "jobInboxAutoReply", comment_autoreply_sweep: "jobCommentAutoReply", handover_timer_sweep: "jobHandoverTimer",
  courier_auto_sync: "jobCourierSync", review_request_sweep: "jobReviewRequest", order_chase_sweep: "jobOrderChase",
};
function jobTypesFor(locale: string): typeof JOB_TYPES_BY_TARGET {
  const out: typeof JOB_TYPES_BY_TARGET = {};
  for (const [target, list] of Object.entries(JOB_TYPES_BY_TARGET)) {
    out[target] = list.map((o) => {
      const key = JOB_TYPE_KEY[o.value];
      return key ? { ...o, label: at(locale, key) } : o;
    });
  }
  return out;
}

const JOB_TYPES_BY_TARGET: Record<string, { value: string; label: string }[]> = {
  integration: [
    { value: "woo_products", label: "WooCommerce Products Sync" },
    { value: "woo_orders", label: "WooCommerce Orders Sync" },
    { value: "shopify_products", label: "Shopify Products Sync" },
    { value: "shopify_orders", label: "Shopify Orders Sync" },
  ],
  account: [
    { value: "meta_insights", label: "Meta Insights Sync" },
    { value: "google_insights", label: "Google Insights Sync" },
    { value: "tiktok_insights", label: "TikTok Insights Sync" },
  ],
  competitor: [
    { value: "competitor_ads", label: "Competitor Ads Sync" },
    { value: "competitor_scan", label: "Competitor Website Scan" },
    { value: "competitor_multi_sync", label: "Competitor Multi-Platform Sync (Meta/Google/TikTok/Bing)" },
  ],
  org: [
    { value: "daily_briefing", label: "Daily AI Briefing (সকালের ব্রিফিং + Anomaly Alert)" },
    { value: "daily_report", label: "Daily AI Report" },
    { value: "ad_spend_watchdog", label: "Ad Spend Watchdog (অস্বাভাবিক খরচের সতর্কতা)" },
    { value: "weekly_ads_report", label: "Weekly Ads Report (ইমেইল)" },
    { value: "meta_status_sync", label: "Meta Status Sync (সব Published Plan)" },
    { value: "dayparting", label: "Dayparting (Ad Set সময়সূচি প্রয়োগ)" },
    { value: "audience_refresh", label: "Audience Membership Refresh" },
    { value: "plan_schedule_sweep", label: "Plan Schedule Sweep (Plan-এর Pause/Resume Window কার্যকর — ৫ মিনিট অন্তর চালান)" },
    { value: "inbox_assignment_sweep", label: "Inbox Assignment Sweep (অ্যাসাইনবিহীন চ্যাট পুনঃবণ্টন)" },
    { value: "lead_followup_sweep", label: "Lead Follow-up Sweep (বকেয়া ও আজকের ফলো-আপ এলার্ট)" },
    { value: "social_publish_due", label: "Social Post Auto-Publish (শিডিউল পোস্ট প্রকাশ)" },
    { value: "subscription_sweep", label: "Subscription Sweep (মেয়াদ শেষ হলে Past Due)" },
    { value: "billing_reminders", label: "Billing Reminder (মেয়াদ শেষের সতর্কতা)" },
    { value: "auto_renew", label: "Auto-Renew Charge (bKash Agreement)" },
    { value: "audit_retention", label: "Audit Retention (পুরনো Audit Log পরিষ্কার)" },
    { value: "dunning_reminders", label: "Dunning Reminder (Past Due হলে ইমেইল)" },
    { value: "email_sync", label: "Email Sync (অপঠিত মেইল Inbox এ আনা)" },
    { value: "inbox_retention", label: "Inbox Retention (মেয়াদ শেষে বন্ধ কথোপকথন মোছা — Settings এ দিন সেট করুন)" },
    { value: "inbox_autoreply_sweep", label: "Inbox Auto-Reply Sweep (অপেক্ষমাণ AI উত্তর পাঠান — ১ মিনিট অন্তর চালান)" },
    { value: "comment_autoreply_sweep", label: "Comment Auto-Reply Sweep (অপেক্ষমাণ AI কমেন্ট-উত্তর দিন — ১ মিনিট অন্তর চালান)" },
    { value: "handover_timer_sweep", label: "Handover Timer Sweep (টাইমড অ্যাসাইনমেন্টের সময় শেষ হলে AI-এর কাছে ফেরত — ১ মিনিট অন্তর চালান)" },
    { value: "courier_auto_sync", label: "Courier Auto-Sync (চালু শিপমেন্টের স্ট্যাটাস যাচাই + গ্রাহককে ট্র্যাকিং কার্ড — ৬০ মিনিট অন্তর চালান)" },
    { value: "review_request_sweep", label: "Review Request Sweep (ডেলিভারির পর গ্রাহকের রিভিউ জিজ্ঞাসা — ৬০ মিনিট অন্তর চালান)" },
    { value: "order_chase_sweep", label: "Order Chase Sweep (থেমে যাওয়া অর্ডার সেশনে আলতো অনুস্মারক — ৬০ মিনিট অন্তর চালান)" },
  ],
};

export default function AutomationsPage() {
  const { t: tr, locale } = useLocale();
  const RULE_ACTION_LABELS_L = ruleActionLabelsFor(locale);
  const METRIC_LABELS_L = metricLabelsFor(locale);
  const HEALTH_BADGE_L = healthBadgeFor(locale);
  const [activeTab, setActiveTab] = useState<TabKey>("jobs");

  // Core Data
  const [jobs, setJobs] = useState<Job[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [suggestions, setSuggestions] = useState<RuleSuggestion[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [health, setHealth] = useState<Record<string, JobHealth>>({});
  const [deadLetters, setDeadLetters] = useState<{ openCount: number; latest: DeadLetter[] }>({
    openCount: 0,
    latest: [],
  });
  const [templates, setTemplates] = useState<JobTemplate[]>([]);
  const [tplTarget, setTplTarget] = useState<Record<string, string>>({});
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);

  // Feature 3: Stock-Linked Meta Ad Guardrail
  const [stockGuardLogs, setStockGuardLogs] = useState<any[]>([]);
  const [resumeBusy, setResumeBusy] = useState<string>("");

  const loadStockGuard = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const res = await apiFetch<{ totalProtectedCount: number; logs: any[] }>(`/organizations/${orgId}/automation/inventory-ad-guard`);
      setStockGuardLogs(res.logs || []);
    } catch { setStockGuardLogs([]); }
  }, []);

  useEffect(() => {
    void loadStockGuard();
  }, [loadStockGuard]);

  async function handleResumeGuardedCampaign(planId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setResumeBusy(planId);
    try {
      await apiFetch(`/organizations/${orgId}/automation/inventory-ad-guard/${planId}/resume`, { method: "POST" });
      await loadStockGuard();
      setNotice(tr("automations.campaignLaunched"));
    } catch (e: any) {
      setError(e.message || tr("automations.campaignLaunchFailed"));
    } finally {
      setResumeBusy("");
    }
  }

  // Feature 6: Predictive Replenishment & Auto Re-order
  const [replenishmentItems, setReplenishmentItems] = useState<any[]>([]);
  const [replenishmentKpi, setReplenishmentKpi] = useState({
    totalTracked: 0,
    dueCount: 0,
    remindedCount: 0,
    reorderedCount: 0,
    conversionRatePercent: 0,
    estimatedRecoveredLtvBdt: 0,
  });
  const [replenishmentStatusFilter, setReplenishmentStatusFilter] = useState("");
  const [replenishmentSearch, setReplenishmentSearch] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [remindBusy, setRemindBusy] = useState<string>("");

  const loadReplenishment = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const q = new URLSearchParams();
      if (replenishmentStatusFilter) q.set("status", replenishmentStatusFilter);
      if (replenishmentSearch) q.set("search", replenishmentSearch);
      const res = await apiFetch<any>(`/organizations/${orgId}/automation/replenishment?${q.toString()}`);
      if (res) {
        setReplenishmentItems(res.items || []);
        if (res.kpi) setReplenishmentKpi(res.kpi);
      }
    } catch {
      // ignore silently
    }
  }, [replenishmentStatusFilter, replenishmentSearch]);

  useEffect(() => {
    if (activeTab === "replenishment") {
      void loadReplenishment();
    }
  }, [activeTab, loadReplenishment]);

  async function handleScanReplenishments() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setScanBusy(true);
    try {
      const res = await apiFetch<any>(`/organizations/${orgId}/automation/replenishment/scan`, { method: "POST" });
      setNotice(res?.message || tr("automations.replenScanDone"));
      await loadReplenishment();
    } catch (e: any) {
      setError(e.message || tr("automations.scanFailed"));
    } finally {
      setScanBusy(false);
    }
  }

  async function handleSendReplenishmentReminder(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setRemindBusy(id);
    try {
      const res = await apiFetch<any>(`/organizations/${orgId}/automation/replenishment/${id}/remind`, { method: "POST" });
      setNotice(res?.message || tr("automations.reminderSent"));
      await loadReplenishment();
    } catch (e: any) {
      setError(e.message || tr("automations.reminderFailed"));
    } finally {
      setRemindBusy("");
    }
  }

  async function handleMarkReplenishmentReordered(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      await apiFetch<any>(`/organizations/${orgId}/automation/replenishment/${id}/reorder`, { method: "POST" });
      setNotice(tr("automations.reorderMarked"));
      await loadReplenishment();
    } catch (e: any) {
      setError(e.message || tr("automations.reorderFailed"));
    }
  }

  // Feedback states
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  // Search & Filter states
  const [jobSearch, setJobSearch] = useState("");
  const [jobCategoryFilter, setJobCategoryFilter] = useState<string>("all");
  const [ruleSearch, setRuleSearch] = useState("");
  const [ruleActionFilter, setRuleActionFilter] = useState<string>("all");
  const [blueprintSearch, setBlueprintSearch] = useState("");
  const [blueprintKind, setBlueprintKind] = useState<"all" | "job" | "rule">("all");
  const [runKindFilter, setRunKindFilter] = useState("");
  const [runStatusFilter, setRunStatusFilter] = useState("");

  // Forms
  const [isJobModalOpen, setIsJobModalOpen] = useState(false);
  const [jobForm, setJobForm] = useState({
    name: "",
    targetKind: "integration",
    targetId: "",
    type: "",
    intervalMinutes: 60,
  });

  const [ruleForm, setRuleForm] = useState({
    name: "",
    metric: "platform_cpa",
    comparator: "gt",
    threshold: "",
    windowDays: 3,
    action: "alert",
    campaignPlanId: "",
    percent: "20",
    minDaily: "",
    maxDaily: "",
    // CA10: new rules default to suggest (approval queue)
    mode: "suggest",
  });

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const [j, r, rn, sg, ints, accs, comps, pls, h] = await Promise.all([
        apiFetch<Job[]>(`/organizations/${orgId}/automation/jobs`),
        apiFetch<Rule[]>(`/organizations/${orgId}/automation/rules`),
        apiFetch<Run[]>(`/organizations/${orgId}/automation/runs`),
        apiFetch<{ suggestions: RuleSuggestion[] }>(`/organizations/${orgId}/automation/suggestions`).catch(() => null),
        apiFetch<Integration[]>(`/organizations/${orgId}/integrations`),
        apiFetch<AdAccount[]>(`/organizations/${orgId}/ad-accounts`),
        apiFetch<Competitor[]>(`/organizations/${orgId}/competitors`),
        apiFetch<Plan[]>(`/organizations/${orgId}/campaign-plans`),
        apiFetch<HealthResponse>(`/organizations/${orgId}/automation/health`).catch(() => null),
      ]);
      setJobs(j);
      setRules(r);
      if (sg) setSuggestions(sg.suggestions ?? []);
      setRuns(rn);
      setIntegrations(ints);
      setAccounts(accs);
      setCompetitors(comps);
      setPlans(pls);
      if (h) {
        setHealth(Object.fromEntries(h.jobs.map((x) => [x.jobId, x])));
        setDeadLetters(h.deadLetters);
      }
      const tpls = await apiFetch<JobTemplate[]>(`/organizations/${orgId}/automation/job-templates`).catch(
        () => null
      );
      if (tpls) setTemplates(tpls);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load automation data");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function wrap<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
    setBusy(key);
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : tr("automations.opFailed"));
      return null;
    } finally {
      setBusy("");
    }
  }

  // Target options for Job creation
  const targetOptions =
    jobForm.targetKind === "integration"
      ? integrations.map((i) => ({ id: i.id, label: `${i.provider} - ${i.store?.name ?? ""}` }))
      : jobForm.targetKind === "account"
        ? accounts
            .filter((a) => ["meta", "google", "tiktok"].includes(a.platform))
            .map((a) => ({ id: a.id, label: `${a.platform} - ${a.name}` }))
        : jobForm.targetKind === "competitor"
          ? competitors.map((c) => ({ id: c.id, label: c.name }))
          : [{ id: "org", label: tr("automations.orgSystemLabel") }];

  const typeOptions = jobTypesFor(locale)[jobForm.targetKind] ?? [];

  // Computed Summaries
  const activeJobsCount = useMemo(() => jobs.filter((j) => j.enabled).length, [jobs]);
  const failingJobsCount = useMemo(
    () => jobs.filter((j) => health[j.id]?.band === "failing" || j.lastStatus === "failed").length,
    [jobs, health]
  );
  const activeRulesCount = useMemo(() => rules.filter((r) => r.enabled).length, [rules]);

  const overallSuccessRate = useMemo(() => {
    const list = Object.values(health).map((h) => h.successRate7d).filter((r): r is number => r !== null);
    if (!list.length) return null;
    return Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 100);
  }, [health]);

  const nextEarliestJob = useMemo(() => {
    const active = jobs.filter((j) => j.enabled && j.nextRunAt);
    if (!active.length) return null;
    return [...active].sort((a, b) => new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime())[0];
  }, [jobs]);

  // Filtered Jobs
  const filteredJobs = useMemo(() => {
    return jobs.filter((j) => {
      if (jobSearch.trim()) {
        const q = jobSearch.toLowerCase().trim();
        if (!j.name.toLowerCase().includes(q) && !j.type.toLowerCase().includes(q)) {
          return false;
        }
      }
      if (jobCategoryFilter === "integration") {
        if (!["woo_products", "woo_orders", "shopify_products", "shopify_orders"].includes(j.type)) return false;
      } else if (jobCategoryFilter === "account") {
        if (!["meta_insights", "google_insights", "tiktok_insights"].includes(j.type)) return false;
      } else if (jobCategoryFilter === "competitor") {
        if (!["competitor_ads", "competitor_scan", "competitor_multi_sync"].includes(j.type)) return false;
      } else if (jobCategoryFilter === "org") {
        if (
          ["woo_products", "woo_orders", "shopify_products", "shopify_orders", "meta_insights", "google_insights", "tiktok_insights", "competitor_ads", "competitor_scan", "competitor_multi_sync"].includes(
            j.type
          )
        )
          return false;
      }
      return true;
    });
  }, [jobs, jobSearch, jobCategoryFilter]);

  // Filtered Rules
  const filteredRules = useMemo(() => {
    return rules.filter((r) => {
      if (ruleSearch.trim()) {
        const q = ruleSearch.toLowerCase().trim();
        if (!r.name.toLowerCase().includes(q) && !r.metric.toLowerCase().includes(q)) {
          return false;
        }
      }
      if (ruleActionFilter !== "all" && r.action !== ruleActionFilter) {
        return false;
      }
      return true;
    });
  }, [rules, ruleSearch, ruleActionFilter]);

  // Filtered Blueprints
  const filteredBlueprints = useMemo(() => {
    const jobList = SCHEDULED_JOB_BLUEPRINTS;
    const ruleList = AD_RULE_BLUEPRINTS;
    let combined = [
      ...(blueprintKind === "all" || blueprintKind === "job" ? jobList : []),
      ...(blueprintKind === "all" || blueprintKind === "rule" ? ruleList : []),
    ];

    if (blueprintSearch.trim()) {
      const q = blueprintSearch.toLowerCase().trim();
      combined = combined.filter((b) => {
        return (
          b.name.toLowerCase().includes(q) ||
          b.catLabel.toLowerCase().includes(q) ||
          b.problemBn.toLowerCase().includes(q) ||
          b.solutionBn.toLowerCase().includes(q) ||
          b.impactBn.toLowerCase().includes(q)
        );
      });
    }
    return combined;
  }, [blueprintKind, blueprintSearch]);

  // Filtered Runs
  const filteredRuns = useMemo(() => {
    return runs.filter((r) => {
      if (runKindFilter && r.kind !== runKindFilter) return false;
      if (runStatusFilter && r.status !== runStatusFilter) return false;
      return true;
    });
  }, [runs, runKindFilter, runStatusFilter]);

  // Actions
  async function createJob(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId();
    if (!orgId) return;
    const targetId = jobForm.targetKind === "org" ? orgId : jobForm.targetId;
    const res = await wrap("job-create", () =>
      apiFetch(`/organizations/${orgId}/automation/jobs`, {
        method: "POST",
        body: JSON.stringify({
          name: jobForm.name,
          type: jobForm.type,
          targetId,
          intervalMinutes: Number(jobForm.intervalMinutes),
        }),
      })
    );
    if (res) {
      setJobForm({ name: "", targetKind: "integration", targetId: "", type: "", intervalMinutes: 60 });
      setIsJobModalOpen(false);
      setNotice(tr("automations.jobCreated"));
      await load();
    }
  }

  async function toggleJob(j: Job) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    await wrap(`tog-job-${j.id}`, () =>
      apiFetch(`/organizations/${orgId}/automation/jobs/${j.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !j.enabled }),
      })
    );
    setNotice(tr("automations.jobToggled", { name: j.name, state: j.enabled ? tr("automations.stateOff") : tr("automations.stateOn") }));
    await load();
  }

  async function deleteJob(j: Job) {
    if (!confirm(tr("automations.jobDeleteConfirm", { name: j.name }))) return;
    const orgId = getOrganizationId();
    if (!orgId) return;
    await wrap(`del-job-${j.id}`, () =>
      apiFetch(`/organizations/${orgId}/automation/jobs/${j.id}`, {
        method: "DELETE",
      })
    );
    setNotice(tr("automations.jobDeleted", { name: j.name }));
    await load();
  }

  async function runJobNow(j: Job) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    await wrap(`run-job-${j.id}`, () =>
      apiFetch(`/organizations/${orgId}/automation/jobs/${j.id}/run`, {
        method: "POST",
      })
    );
    setNotice(tr("automations.jobRanNow", { name: j.name }));
    await load();
  }

  async function createRule(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId();
    if (!orgId) return;
    const res = await wrap("rule-create", () =>
      apiFetch(`/organizations/${orgId}/automation/rules`, {
        method: "POST",
        body: JSON.stringify({
          name: ruleForm.name,
          metric: ruleForm.metric,
          comparator: ruleForm.comparator,
          threshold: ruleForm.threshold,
          windowDays: Number(ruleForm.windowDays),
          action: ruleForm.action,
          mode: ruleForm.mode,
          campaignPlanId: ruleForm.campaignPlanId || undefined,
          actionConfig:
            ruleForm.action === "scale_budget"
              ? {
                  percent: Number(ruleForm.percent),
                  minDailyMinor: ruleForm.minDaily ? Math.round(Number(ruleForm.minDaily) * 100) : undefined,
                  maxDailyMinor: ruleForm.maxDaily ? Math.round(Number(ruleForm.maxDaily) * 100) : undefined,
                  cooldownHours: 24,
                }
              : undefined,
        }),
      })
    );
    if (res) {
      setRuleForm({
        name: "",
        metric: "platform_cpa",
        comparator: "gt",
        threshold: "",
        windowDays: 3,
        action: "alert",
        campaignPlanId: "",
        percent: "20",
        minDaily: "",
        maxDaily: "",
        mode: "suggest",
      });
      setNotice(tr("automations.ruleCreated"));
      await load();
    }
  }

  async function toggleRule(r: Rule) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    await wrap(`tog-rule-${r.id}`, () =>
      apiFetch(`/organizations/${orgId}/automation/rules/${r.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !r.enabled }),
      })
    );
    setNotice(tr("automations.ruleToggled", { name: r.name, state: r.enabled ? tr("automations.stateOff") : tr("automations.stateOn") }));
    await load();
  }

  async function deleteRule(r: Rule) {
    if (!confirm(tr("automations.ruleDeleteConfirm", { name: r.name }))) return;
    const orgId = getOrganizationId();
    if (!orgId) return;
    await wrap(`del-rule-${r.id}`, () =>
      apiFetch(`/organizations/${orgId}/automation/rules/${r.id}`, {
        method: "DELETE",
      })
    );
    setNotice(tr("automations.ruleDeleted", { name: r.name }));
    await load();
  }

  // CA10: approval-queue decisions. Approve executes the
  // stored action exactly once (server-side claim); the
  // notice reports the VERBATIM stored outcome.
  async function decideSuggestion(s: RuleSuggestion, decision: "approve" | "reject") {
    const orgId = getOrganizationId();
    if (!orgId) return;
    let reason: string | undefined;
    if (decision === "reject") {
      const input = prompt(tr("automations.rejectReasonPrompt"), "");
      if (input === null) return;
      reason = input || undefined;
    } else if (!confirm(tr("automations.suggestApproveConfirm", { name: s.ruleName ?? s.ruleId, action: s.action }))) return;
    const res = await wrap(`sug-${s.id}`, () =>
      apiFetch<RuleSuggestion>(`/organizations/${orgId}/automation/suggestions/${s.id}/${decision}`, {
        method: "POST",
        body: JSON.stringify(decision === "reject" ? { reason } : {}),
      })
    );
    if (res) {
      if (decision === "reject") setNotice(tr("automations.suggestRejected"));
      else if (res.executionResult?.ok === false) setNotice(tr("automations.suggestApprovedFailed", { error: res.executionResult.error ?? tr("automations.unknownError") }));
      else if (res.executionResult?.skipped) setNotice(tr("automations.suggestApprovedSkipped"));
      else setNotice(tr("automations.suggestApprovedDone"));
      await load();
    }
  }

  async function setRuleMode(r: Rule, mode: string) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    await wrap(`mode-rule-${r.id}`, () =>
      apiFetch(`/organizations/${orgId}/automation/rules/${r.id}`, {
        method: "PATCH",
        body: JSON.stringify({ mode }),
      })
    );
    setNotice(tr("automations.ruleModeChanged", { name: r.name, mode: mode === "suggest" ? tr("automations.modeSuggestText") : tr("automations.modeExecuteText") }));
    await load();
  }

  async function evaluateRulesNow() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const res = await wrap("eval-rules", () =>
      apiFetch<{ results: { triggered: boolean }[] }>(`/organizations/${orgId}/automation/rules/evaluate`, {
        method: "POST",
      })
    );
    if (res) {
      const triggered = res.results.filter((x) => x.triggered).length;
      setNotice(tr("automations.allRulesChecked", { count: fmtNumber(locale, triggered) }));
      await load();
    }
  }

  async function installTemplate(t: JobTemplate) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const targetId = t.targetKind === "org" ? undefined : tplTarget[t.key];
    if (t.targetKind !== "org" && !targetId) {
      setError(t.targetKind === "integration" ? tr("automations.pickStoreFirst") : tr("automations.pickCompetitorFirst"));
      return;
    }
    const res = await wrap(`tpl-${t.key}`, () =>
      apiFetch(`/organizations/${orgId}/automation/job-templates/${t.key}/install`, {
        method: "POST",
        body: JSON.stringify(targetId ? { targetId } : {}),
      })
    );
    if (res) {
      setNotice(tr("automations.jobFromTemplate", { name: t.name }));
      await load();
    }
  }

  function applyRuleBlueprint(rb: AdRuleBlueprint) {
    setRuleForm({
      name: rb.name,
      metric: rb.metric,
      comparator: rb.comparator,
      threshold: rb.threshold,
      windowDays: rb.windowDays,
      action: rb.action,
      campaignPlanId: "",
      percent: rb.actionConfig?.percent ? String(rb.actionConfig.percent) : "20",
      minDaily: rb.actionConfig?.minDailyMinor ? String(rb.actionConfig.minDailyMinor / 100) : "",
      maxDaily: rb.actionConfig?.maxDailyMinor ? String(rb.actionConfig.maxDailyMinor / 100) : "",
      // CA10: blueprints load in suggest mode — the human
      // still reviews the form before creating the rule.
      mode: "suggest",
    });
    setActiveTab("rules");
    setNotice(tr("automations.ruleLoadedToForm", { name: rb.name }));
  }

  const inputCls = "input mt-1 w-full text-sm";

  return (
    <div className="space-y-6">
      {/* Page Title & Subtitle */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{tr("automations.pageTitle")}</h1>
          <p className="text-sm text-slate-500">
            {tr("automations.pageIntro")}
          </p>
        </div>
      </div>

      {/* Global Notice / Error Alerts */}
      {error && (
        <div className="flex items-center justify-between rounded-xl bg-red-50 p-4 text-sm text-red-700 border border-red-200 shadow-sm">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
          <button onClick={() => setError("")} className="text-xs text-red-500 hover:text-red-700">{tr("automations.close")}</button>
        </div>
      )}

      {notice && (
        <div className="flex items-center justify-between rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 border border-emerald-200 shadow-sm">
          <div className="flex items-center gap-2">
            <span>✓</span>
            <span>{notice}</span>
          </div>
          <button onClick={() => setNotice("")} className="text-xs text-emerald-600 hover:text-emerald-800">{tr("automations.close")}</button>
        </div>
      )}

      {/* Top Metric Overview Bar */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Metric 1: Scheduled Jobs */}
        <div className="card p-4 flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Scheduled Jobs</span>
            <div className="text-2xl font-bold text-slate-900">
              {fmtNumber(locale, activeJobsCount)} <span className="text-sm font-normal text-slate-400">/ {fmtNumber(locale, jobs.length)} {tr("automations.statActiveWord")}</span>
            </div>
          </div>
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-xl text-brand-600">
            🕒
          </span>
        </div>

        {/* Metric 2: Ad Guardrail Rules */}
        <div className="card p-4 flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Ad Guardrails</span>
            <div className="text-2xl font-bold text-slate-900">
              {fmtNumber(locale, activeRulesCount)} <span className="text-sm font-normal text-slate-400">/ {fmtNumber(locale, rules.length)} {tr("automations.statActiveWord")}</span>
            </div>
          </div>
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-xl text-emerald-600">
            🛡️
          </span>
        </div>

        {/* Metric 3: System Health */}
        <div className="card p-4 flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{tr("automations.systemHealth7d")}</span>
            <div className="text-2xl font-bold text-slate-900">
              {overallSuccessRate != null ? `${fmtNumber(locale, overallSuccessRate)}%` : fmtNumber(locale, 100) + "%"}
            </div>
            <div className="text-[11px] text-slate-500">
              {failingJobsCount > 0 ? (
                <span className="text-rose-600 font-semibold">{tr("automations.jobsWarnLine", { count: fmtNumber(locale, failingJobsCount) })}</span>
              ) : (
                <span className="text-emerald-600 font-medium">{tr("automations.allSyncNormal")}</span>
              )}
            </div>
          </div>
          <span className={`flex h-12 w-12 items-center justify-center rounded-2xl text-xl ${failingJobsCount > 0 ? "bg-rose-50 text-rose-600" : "bg-teal-50 text-teal-600"}`}>
            {failingJobsCount > 0 ? "⚠️" : "💚"}
          </span>
        </div>

        {/* Metric 4: Dead Letters / Next Run */}
        <div className="card p-4 flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {deadLetters.openCount > 0 ? "Dead Letter Alert"  : tr("automations.nextSchedule")}
            </span>
            {deadLetters.openCount > 0 ? (
              <div className="text-2xl font-bold text-rose-600">
                {fmtNumber(locale, deadLetters.openCount)}{tr("automations.countSuffixTi")} <span className="text-xs font-normal text-rose-500">{tr("automations.statusPending")}</span>
              </div>
            ) : nextEarliestJob ? (
              <div>
                <div className="text-base font-bold text-slate-800 truncate max-w-[150px]">{nextEarliestJob.name}</div>
                <div className="text-xs text-slate-500">{formatRelativeTime(nextEarliestJob.nextRunAt, locale)}</div>
              </div>
            ) : (
              <div className="text-sm font-semibold text-slate-400">{tr("automations.noSchedule")}</div>
            )}
          </div>
          <span className={`flex h-12 w-12 items-center justify-center rounded-2xl text-xl ${deadLetters.openCount > 0 ? "bg-rose-100 text-rose-700 animate-pulse" : "bg-slate-100 text-slate-600"}`}>
            {deadLetters.openCount > 0 ? "🚨" : "⏱️"}
          </span>
        </div>
      </div>

      {/* Main Tab Navigation */}
      <div className="flex border-b border-slate-200">
        <div className="flex gap-2 overflow-x-auto pb-1 text-sm">
          <button
            type="button"
            onClick={() => setActiveTab("jobs")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-semibold transition ${
              activeTab === "jobs"
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <span>🕒</span>
            <span>Scheduled Jobs</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 font-bold">{jobs.length}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("rules")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-semibold transition ${
              activeTab === "rules"
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <span>🛡️</span>
            <span>Ad Guardrails</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 font-bold">{rules.length}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("presets")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-semibold transition ${
              activeTab === "presets"
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <span>📚</span>
            <span>{tr("automations.tabBlueprints")}</span>
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700 font-bold">
              {SCHEDULED_JOB_BLUEPRINTS.length + AD_RULE_BLUEPRINTS.length}+
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("health")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-semibold transition ${
              activeTab === "health"
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <span>🚨</span>
            <span>{tr("automations.tabHealthDlq")}</span>
            {deadLetters.openCount > 0 && (
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700 font-bold animate-pulse">
                {deadLetters.openCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("runs")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-semibold transition ${
              activeTab === "runs"
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <span>📜</span>
            <span>{tr("automations.tabRuns")}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 font-bold">{runs.length}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("stock-guard")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-semibold transition ${
              activeTab === "stock-guard"
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <span>🛡️</span>
            <span>{tr("automations.tabStockGuard")}</span>
            {stockGuardLogs.length > 0 && (
              <span className="rounded-full bg-rose-100 text-rose-700 px-2 py-0.5 text-xs font-bold">
                {stockGuardLogs.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("replenishment")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-semibold transition ${
              activeTab === "replenishment"
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <span>🔄</span>
            <span>{tr("automations.tabReplenish")}</span>
            {replenishmentKpi.dueCount > 0 && (
              <span className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-xs font-bold animate-pulse">
                {replenishmentKpi.dueCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ============================================================== */}
      {/* TAB 1: SCHEDULED JOBS */}
      {/* ============================================================== */}
      {activeTab === "jobs" && (
        <div className="space-y-5">
          {/* Action & Filter Bar */}
          <div className="card p-4 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {/* Search */}
              <div className="relative flex-1 max-w-md">
                <input
                  type="text"
                  placeholder={tr("automations.jobSearchPlaceholder")}
                  className="input !py-2 !pr-4 w-full text-sm rounded-xl"
                  value={jobSearch}
                  onChange={(e) => setJobSearch(e.target.value)}
                />
              </div>

              {/* Action */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsJobModalOpen(!isJobModalOpen)}
                  className="btn-primary btn-sm font-semibold flex items-center gap-1.5"
                >
                  <span>{isJobModalOpen ? tr("automations.close") : tr("automations.jobModalOpenToggle")}</span>
                </button>
              </div>
            </div>

            {/* Category Filter Chips */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs pt-1 border-t border-slate-100">
              <span className="text-xs font-semibold text-slate-400 mr-1">{tr("automations.targetLabel")}</span>
              {[
                { id: "all", label: tr("automations.allJobs"), icon: "✨", count: jobs.length },
                {
                  id: "integration",
                  label: "Store Integration",
                  icon: "🛒",
                  count: jobs.filter((j) => ["woo_products", "woo_orders", "shopify_products", "shopify_orders"].includes(j.type)).length,
                },
                {
                  id: "account",
                  label: "Ad Accounts",
                  icon: "📈",
                  count: jobs.filter((j) => ["meta_insights", "google_insights", "tiktok_insights"].includes(j.type)).length,
                },
                {
                  id: "competitor",
                  label: "Competitor",
                  icon: "🕵️",
                  count: jobs.filter((j) => ["competitor_ads", "competitor_scan", "competitor_multi_sync"].includes(j.type)).length,
                },
                {
                  id: "org",
                  label: "System & AI",
                  icon: "🤖",
                  count: jobs.filter(
                    (j) =>
                      ![
                        "woo_products",
                        "woo_orders",
                        "shopify_products",
                        "shopify_orders",
                        "meta_insights",
                        "google_insights",
                        "tiktok_insights",
                        "competitor_ads",
                        "competitor_scan",
                        "competitor_multi_sync",
                      ].includes(j.type)
                  ).length,
                },
              ].map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setJobCategoryFilter(c.id)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition ${
                    jobCategoryFilter === c.id
                      ? "bg-brand-600 text-white font-semibold shadow-xs"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  <span>{c.icon}</span>
                  <span>{c.label}</span>
                  <span className="text-[10px] opacity-75 font-mono">({c.count})</span>
                </button>
              ))}
            </div>
          </div>

          {/* New Job Modal / Inline Form */}
          {isJobModalOpen && (
            <div className="card p-5 border-2 border-brand-200 bg-brand-50/20 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-slate-900">{tr("automations.jobModalTitle")}</h3>
                  <p className="text-xs text-slate-500">{tr("automations.jobModalSub")}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsJobModalOpen(false)}
                  className="text-xs font-semibold text-slate-400 hover:text-slate-600"
                >
                  {tr("automations.close")}
                </button>
              </div>

              <form onSubmit={createJob} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">{tr("automations.jobNameLabel")}</label>
                  <input
                    className={inputCls}
                    value={jobForm.name}
                    onChange={(e) => setJobForm({ ...jobForm, name: e.target.value })}
                    required
                    placeholder={tr("automations.jobNamePlaceholder")}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">{tr("automations.targetTypeLabel")}</label>
                  <select
                    className={inputCls}
                    value={jobForm.targetKind}
                    onChange={(e) =>
                      setJobForm({ ...jobForm, targetKind: e.target.value, targetId: "", type: "" })
                    }
                  >
                    <option value="integration">Store Integration</option>
                    <option value="account">Ad Account</option>
                    <option value="competitor">Competitor</option>
                    <option value="org">{tr("automations.orgSystem")}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">{tr("automations.specificTarget")}</label>
                  <select
                    className={inputCls}
                    value={jobForm.targetId}
                    onChange={(e) => setJobForm({ ...jobForm, targetId: e.target.value })}
                    required={jobForm.targetKind !== "org"}
                  >
                    <option value="">{tr("automations.choose")}</option>
                    {targetOptions.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">{tr("automations.jobTypeLabel")}</label>
                  <select
                    className={inputCls}
                    value={jobForm.type}
                    onChange={(e) => setJobForm({ ...jobForm, type: e.target.value })}
                    required
                  >
                    <option value="">{tr("automations.choose")}</option>
                    {typeOptions.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">{tr("automations.intervalLabel")}</label>
                  <input
                    className={inputCls}
                    type="number"
                    min={1}
                    value={jobForm.intervalMinutes}
                    onChange={(e) => setJobForm({ ...jobForm, intervalMinutes: Number(e.target.value) })}
                    required
                  />
                </div>

                <div className="sm:col-span-2 lg:col-span-5 flex justify-end gap-2 pt-2 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setIsJobModalOpen(false)}
                    className="btn-secondary btn-sm"
                  >
                    {tr("automations.cancel")}
                  </button>
                  <button
                    type="submit"
                    className="btn-primary btn-sm"
                    disabled={busy !== ""}
                  >
                    {tr("automations.saveJob")}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Job List */}
          {filteredJobs.length === 0 ? (
            <div className="card p-8">
              <EmptyState
                title={tr("automations.noJobs")}
                description={tr("automations.noJobsHint")}
                actionLabel={tr("automations.createJob")}
                onAction={() => setIsJobModalOpen(true)}
              />
            </div>
          ) : (
            <div className="space-y-3">
              {filteredJobs.map((j) => {
                const jHealth = health[j.id];
                const band = jHealth?.band ?? (j.lastRunAt ? "ok" : "never_run");
                const bMeta = HEALTH_BADGE_L[band] ?? HEALTH_BADGE_L.never_run;

                return (
                  <div
                    key={j.id}
                    className="card p-4 hover:border-slate-300 transition-all flex flex-col justify-between gap-3 sm:flex-row sm:items-center"
                  >
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm">{j.name}</span>
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium border ${bMeta.cls}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${bMeta.dot}`} />
                          <span>{bMeta.text}</span>
                        </span>
                        <span className="badge badge-slate text-[10.5px]">
                          {intervalLabel(j.intervalMinutes, locale)}
                        </span>
                        <span className="text-xs text-slate-400 font-mono">({j.type})</span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span>
                          {tr("automations.lastRunLabel")} <strong className="text-slate-700">{formatRelativeTime(j.lastRunAt, locale)}</strong>
                          {j.lastStatus && ` (${j.lastStatus})`}
                        </span>
                        <span>
                          {tr("automations.nextRunLabel")} <strong className="text-slate-700">{formatRelativeTime(j.nextRunAt, locale)}</strong>
                        </span>
                        {jHealth && (
                          <span>
                            {tr("automations.runs7dLabel")} <strong className="text-slate-700">{tr("automations.runs7dSuffix", { count: fmtNumber(locale, jHealth.runs7d) })}</strong>
                            {jHealth.successRate7d != null && (
                              <> {tr("automations.successPct", { pct: fmtNumber(locale, Math.round(jHealth.successRate7d * 100)) })}</>
                            )}
                          </span>
                        )}
                      </div>

                      {/* Error trace if any */}
                      {j.lastError && (
                        <div className="text-xs text-rose-600 bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-100 break-words mt-1">
                          {tr("automations.lastErrorPrefix")} {j.lastError}
                        </div>
                      )}

                      {/* Consecutive failures warning */}
                      {jHealth && jHealth.consecutiveFailures > 0 && (
                        <div className="text-xs text-amber-700 font-medium">
                          {tr("automations.consecFails", { count: fmtNumber(locale, jHealth.consecutiveFailures) })}
                        </div>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-wrap items-center gap-2 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 shrink-0">
                      <button
                        type="button"
                        className="btn-primary btn-sm text-xs font-semibold flex items-center gap-1"
                        disabled={busy === `run-job-${j.id}`}
                        onClick={() => runJobNow(j)}
                        title={tr("automations.runNowTitle")}
                      >
                        <span>{tr("automations.runNow")}</span>
                      </button>

                      <button
                        type="button"
                        className={`rounded-lg px-2.5 py-1.5 text-xs font-medium border transition ${
                          j.enabled
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                        }`}
                        disabled={busy === `tog-job-${j.id}`}
                        onClick={() => toggleJob(j)}
                        title={j.enabled ? tr("automations.jobOffTitle") : tr("automations.jobOnTitle")}
                      >
                        {j.enabled ? tr("automations.activeOn") : tr("automations.offLabel")}
                      </button>

                      <button
                        type="button"
                        className="rounded-lg p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                        disabled={busy === `del-job-${j.id}`}
                        onClick={() => deleteJob(j)}
                        title={tr("automations.jobDeleteTitle")}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 2: AD GUARDRAILS & BUDGET RULES                             */}
      {/* ============================================================== */}
      {activeTab === "rules" && (
        <div className="space-y-5">
          {/* Action Header & Quick Evaluation */}
          <div className="card p-4 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">{tr("automations.rulesTitle")}</h3>
                <p className="text-xs text-slate-500">
                  {tr("automations.rulesIntro")}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn-primary btn-sm font-semibold flex items-center gap-1.5"
                  disabled={busy === "eval-rules"}
                  onClick={evaluateRulesNow}
                  title={tr("automations.checkAllRulesTitle")}
                >
                  <span>{tr("automations.checkAllRules")}</span>
                </button>
              </div>
            </div>

            {/* Quick Presets Strip */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs pt-1 border-t border-slate-100">
              <span className="text-xs font-semibold text-slate-400 mr-1">{tr("automations.quickPresets")}</span>
              {AD_RULE_BLUEPRINTS.slice(0, 4).map((rb) => (
                <button
                  key={rb.key}
                  type="button"
                  onClick={() => applyRuleBlueprint(rb)}
                  className="rounded-lg bg-slate-100 hover:bg-brand-50 hover:text-brand-700 px-2.5 py-1 text-slate-700 font-medium transition flex items-center gap-1"
                >
                  <span>+ {rb.name.split("—")[0]}</span>
                </button>
              ))}
            </div>
          </div>

          {/* CA10: Approval queue for suggest-mode rules */}
          <div className="card p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
              <h4 className="text-sm font-bold text-slate-900">{tr("automations.suggestQueueTitle")} ({fmtNumber(locale, suggestions.filter((s) => s.status === "pending").length)}{tr("automations.countSuffixTi")})</h4>
              <span className="text-[11px] text-slate-500">{tr("automations.suggestQueueNote")}</span>
            </div>
            {suggestions.length === 0 ? (
              <p className="text-xs text-slate-500">{tr("automations.noSuggestions")}</p>
            ) : (
              <div className="space-y-2">
                {suggestions.map((s) => (
                  <div key={s.id} className={`rounded-xl border p-3 ${s.status === "pending" ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-slate-50/60"}`}>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-bold text-slate-900">{s.ruleName ?? s.ruleId}</span>
                      <span className="text-slate-500">→</span>
                      <span className="font-medium text-slate-800">{s.planName ?? s.campaignPlanId}</span>
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700">{RULE_ACTION_LABELS_L[s.action]?.label ?? s.action}</span>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${s.status === "pending" ? "bg-amber-100 text-amber-800" : s.status === "approved" ? "bg-emerald-100 text-emerald-800" : s.status === "rejected" ? "bg-rose-100 text-rose-800" : "bg-slate-200 text-slate-600"}`}>
                        {s.status === "pending" ? tr("automations.statusPending") : s.status === "approved" ? tr("automations.statusApproved") : s.status === "rejected" ? tr("automations.statusRejected") : tr("automations.statusExpired")}
                      </span>
                      <span className="text-[11px] text-slate-400">{new Date(s.createdAt).toLocaleString("bn-BD")}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">{s.reason}</p>
                    {s.facts ? (
                      <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                        {METRIC_LABELS_L[s.facts.metric ?? ""] ?? s.facts.metric} = {fmtNumber(locale, s.facts.value ?? 0)} ({tr("automations.suggestCond")} {s.facts.comparator === "lt" ? "<" : ">"} {fmtNumber(locale, Number(s.facts.threshold ?? 0))}, {fmtNumber(locale, s.facts.windowDays ?? 0)} {tr("automations.daysWord")})
                        {s.action === "scale_budget" && s.actionPayload?.percent !== undefined ? ` · ${tr("automations.suggestBudgetSuffix", { pct: fmtNumber(locale, s.actionPayload.percent) }).replace(/^ · /, "")}` : ""}
                        {s.action === "pause_ad" && s.actionPayload?.adExternalIds ? ` · ${tr("automations.suggestAdsSuffix", { count: fmtNumber(locale, s.actionPayload.adExternalIds.length) }).replace(/^ · /, "")}` : ""}
                      </p>
                    ) : null}
                    {s.status === "approved" && s.executionResult ? (
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {tr("automations.resultLabel")} {s.executionResult.ok === false ? `${tr("automations.suggestFailedPrefix")}${s.executionResult.error ?? ""}` : s.executionResult.skipped ? `skipped (${s.executionResult.skipped})` : `${tr("automations.suggestExecutedPrefix")}${s.executionResult.executed ?? ""}`}
                      </p>
                    ) : null}
                    {s.status === "rejected" && s.rejectReason ? <p className="mt-0.5 text-[11px] text-slate-500">{tr("automations.rejectReasonLabel")} {s.rejectReason}</p> : null}
                    {s.status === "pending" && (
                      <div className="mt-2 flex gap-2">
                        <button type="button" className="btn-primary btn-sm font-semibold" disabled={busy === `sug-${s.id}`} onClick={() => decideSuggestion(s, "approve")}>{tr("automations.approveNowBtn")}</button>
                        <button type="button" className="btn-secondary btn-sm font-semibold" disabled={busy === `sug-${s.id}`} onClick={() => decideSuggestion(s, "reject")}>{tr("automations.rejectBtn")}</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Rule Creator Form */}
          <div className="card p-5 space-y-4">
            <h4 className="text-sm font-bold text-slate-900 border-b pb-2">{tr("automations.newRuleTitle")}</h4>
            <form onSubmit={createRule} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700">{tr("automations.ruleNameLabel")}</label>
                <input
                  className={inputCls}
                  value={ruleForm.name}
                  onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
                  required
                  placeholder={tr("automations.ruleNamePlaceholder")}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">{tr("automations.metricLabel")}</label>
                <select
                  className={inputCls}
                  value={ruleForm.metric}
                  onChange={(e) => setRuleForm({ ...ruleForm, metric: e.target.value })}
                >
                  {Object.entries(METRIC_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">{tr("automations.comparatorLabel")}</label>
                <select
                  className={inputCls}
                  value={ruleForm.comparator}
                  onChange={(e) => setRuleForm({ ...ruleForm, comparator: e.target.value })}
                >
                  <option value="gt">{tr("automations.greaterThan")}</option>
                  <option value="lt">{tr("automations.lessThan")}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">{tr("automations.thresholdLabel")}</label>
                <input
                  className={inputCls}
                  value={ruleForm.threshold}
                  onChange={(e) => setRuleForm({ ...ruleForm, threshold: e.target.value })}
                  required
                  placeholder={tr("automations.thresholdPlaceholder")}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">{tr("automations.windowLabel")}</label>
                <input
                  className={inputCls}
                  type="number"
                  min={1}
                  max={30}
                  value={ruleForm.windowDays}
                  onChange={(e) => setRuleForm({ ...ruleForm, windowDays: Number(e.target.value) })}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">{tr("automations.actionLabel")}</label>
                <select
                  className={inputCls}
                  value={ruleForm.action}
                  onChange={(e) => setRuleForm({ ...ruleForm, action: e.target.value })}
                >
                  <option value="alert">{tr("automations.actionAlertOnly")}</option>
                  <option value="pause_campaign">{tr("automations.actionPauseCampaign")}</option>
                  <option value="activate_campaign">{tr("automations.actionActivateCampaign")}</option>
                  <option value="scale_budget">{tr("automations.actionScaleBudgetLabel")}</option>
                  <option value="pause_ad">{tr("automations.actionPauseAd")}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">{tr("automations.modeLabel")}</label>
                <select
                  className={inputCls}
                  value={ruleForm.mode}
                  onChange={(e) => setRuleForm({ ...ruleForm, mode: e.target.value })}
                >
                  <option value="suggest">{tr("automations.modeSuggestOption")}</option>
                  <option value="execute">{tr("automations.modeExecuteOption")}</option>
                </select>
                <p className="mt-1 text-[11px] text-slate-500">{tr("automations.modeNote")}</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">{tr("automations.targetPlanLabel")}</label>
                <select
                  className={inputCls}
                  value={ruleForm.campaignPlanId}
                  onChange={(e) => setRuleForm({ ...ruleForm, campaignPlanId: e.target.value })}
                >
                  <option value="">{tr("automations.allPublishedPlans")}</option>
                  {plans
                    .filter((p) => p.status === "published")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </div>

              {ruleForm.action === "scale_budget" && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">{tr("automations.scalePctLabel")}</label>
                    <input
                      className={inputCls}
                      value={ruleForm.percent}
                      onChange={(e) => setRuleForm({ ...ruleForm, percent: e.target.value })}
                      placeholder="20"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">{tr("automations.minDailyBudgetLabel")}</label>
                    <input
                      className={inputCls}
                      value={ruleForm.minDaily}
                      onChange={(e) => setRuleForm({ ...ruleForm, minDaily: e.target.value })}
                      placeholder="500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">{tr("automations.maxDailyBudgetLabel")}</label>
                    <input
                      className={inputCls}
                      value={ruleForm.maxDaily}
                      onChange={(e) => setRuleForm({ ...ruleForm, maxDaily: e.target.value })}
                      placeholder="5000"
                    />
                  </div>
                </>
              )}

              <div className="sm:col-span-2 lg:col-span-4 flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="submit"
                  className="btn-primary btn-sm font-semibold"
                  disabled={busy === "rule-create"}
                >
                  {tr("automations.createRule")}
                </button>
              </div>
            </form>
          </div>

          {/* Rules List */}
          {filteredRules.length === 0 ? (
            <div className="card p-8">
              <EmptyState
                title={tr("automations.noRules")}
                description={tr("automations.noRulesHint")}
              />
            </div>
          ) : (
            <div className="space-y-3">
              {filteredRules.map((r) => {
                const actMeta = RULE_ACTION_LABELS_L[r.action] ?? {
                  label: r.action,
                  badgeCls: "bg-slate-50 text-slate-700 border-slate-200",
                  icon: "⚡",
                };

                return (
                  <div
                    key={r.id}
                    className="card p-4 hover:border-slate-300 transition-all flex flex-col justify-between gap-3 sm:flex-row sm:items-center"
                  >
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm">{r.name}</span>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border ${actMeta.badgeCls}`}>
                          <span>{actMeta.icon}</span>
                          <span>{actMeta.label}</span>
                        </span>
                        {r.campaignPlanId && (
                          <span className="badge badge-brand text-[10px]">{tr("automations.specificPlan")}</span>
                        )}
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold border ${r.mode === "suggest" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-sky-200 bg-sky-50 text-sky-700"}`}>
                          {r.mode === "suggest" ? tr("automations.modeSuggestBadge") : tr("automations.modeExecuteBadge")}
                        </span>
                      </div>

                      <div className="text-xs text-slate-600 font-medium">
                        {tr("automations.conditionLabel")} <span className="font-mono text-slate-800">{METRIC_LABELS_L[r.metric] ?? r.metric}</span> {r.comparator === "gt" ? ">" : "<"} <strong className="text-slate-900 font-mono">{r.threshold}</strong> ({fmtNumber(locale, r.windowDays)} {tr("automations.windowAvgSuffix")})
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                        <span>{tr("automations.lastEvalLabel")} {formatRelativeTime(r.lastEvaluatedAt, locale)}</span>
                        <span>
                          {tr("automations.lastTriggerLabel")}{" "}
                          <strong className={r.lastTriggeredAt ? "text-amber-600 font-semibold" : ""}>
                            {formatRelativeTime(r.lastTriggeredAt, locale)}
                          </strong>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 shrink-0">
                      <select
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700"
                        value={r.mode === "suggest" ? "suggest" : "execute"}
                        disabled={busy === `mode-rule-${r.id}`}
                        onChange={(e) => setRuleMode(r, e.target.value)}
                        title={tr("automations.modeSwitchTitle")}
                        aria-label={`${r.name} ${tr("automations.modeOfSuffix")}`}
                      >
                        <option value="suggest">{tr("automations.modeSuggestShort")}</option>
                        <option value="execute">{tr("automations.modeExecuteShort")}</option>
                      </select>

                      <button
                        type="button"
                        className={`rounded-lg px-2.5 py-1.5 text-xs font-medium border transition ${
                          r.enabled
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                            : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                        }`}
                        disabled={busy === `tog-rule-${r.id}`}
                        onClick={() => toggleRule(r)}
                      >
                        {r.enabled ? tr("automations.activeOn") : tr("automations.offLabel")}
                      </button>

                      <button
                        type="button"
                        className="rounded-lg p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                        disabled={busy === `del-rule-${r.id}`}
                        onClick={() => deleteRule(r)}
                        title={tr("automations.ruleDeleteTitle")}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 3: PREMADE BLUEPRINTS & TEMPLATES GALLERY                   */}
      {/* ============================================================== */}
      {activeTab === "presets" && (
        <div className="space-y-6">
          <div className="card p-5 sm:p-6 space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-slate-900">{tr("automations.galleryTitle")}</h2>
                  <span className="badge badge-brand font-bold">
                    {fmtNumber(locale, SCHEDULED_JOB_BLUEPRINTS.length + AD_RULE_BLUEPRINTS.length)}+ {tr("automations.blueprintsSuffix")}
                  </span>
                </div>
                <p className="text-sm text-slate-500 mt-0.5">
                  {tr("automations.galleryIntro")}
                </p>
              </div>

              {(blueprintSearch.trim() || blueprintKind !== "all") && (
                <button
                  type="button"
                  onClick={() => {
                    setBlueprintSearch("");
                    setBlueprintKind("all");
                  }}
                  className="btn-secondary btn-xs self-start sm:self-center"
                >
                  {tr("automations.resetFilter")}
                </button>
              )}
            </div>

            {/* Search Input */}
            <div className="relative">
              <input
                type="text"
                className="input !py-2.5 w-full text-sm rounded-xl"
                placeholder={tr("automations.gallerySearchPlaceholder")}
                value={blueprintSearch}
                onChange={(e) => setBlueprintSearch(e.target.value)}
              />
              {blueprintSearch && (
                <button
                  type="button"
                  onClick={() => setBlueprintSearch("")}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Filter chips */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs pt-1 border-t border-slate-100">
              <span className="text-xs font-semibold text-slate-400 mr-1">{tr("automations.typeLabel")}</span>
              <button
                type="button"
                onClick={() => setBlueprintKind("all")}
                className={`rounded-lg px-2.5 py-1 font-medium transition ${
                  blueprintKind === "all" ? "bg-brand-600 text-white font-semibold" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {tr("automations.allBlueprints")} ({fmtNumber(locale, SCHEDULED_JOB_BLUEPRINTS.length + AD_RULE_BLUEPRINTS.length)})
              </button>
              <button
                type="button"
                onClick={() => setBlueprintKind("job")}
                className={`rounded-lg px-2.5 py-1 font-medium transition ${
                  blueprintKind === "job" ? "bg-brand-600 text-white font-semibold" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                🕒 Scheduled Jobs ({SCHEDULED_JOB_BLUEPRINTS.length})
              </button>
              <button
                type="button"
                onClick={() => setBlueprintKind("rule")}
                className={`rounded-lg px-2.5 py-1 font-medium transition ${
                  blueprintKind === "rule" ? "bg-brand-600 text-white font-semibold" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                🛡️ Ad Guardrails ({AD_RULE_BLUEPRINTS.length})
              </button>
            </div>
          </div>

          {/* Cards Grid */}
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {filteredBlueprints.map((bp) => {
              const isJob = bp.kind === "job";
              return (
                <div
                  key={bp.key}
                  className="card card-hover p-5 border border-slate-200 flex flex-col justify-between hover:shadow-md transition-all"
                >
                  <div className="space-y-3">
                    {/* Top Badges */}
                    <div className="flex items-center justify-between">
                      <span className="badge badge-brand text-[11px]">{bp.catLabel}</span>
                      <div className="flex items-center gap-1">
                        {bp.badge && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                            ★ {bp.badge}
                          </span>
                        )}
                        <span className="badge badge-slate text-[10px]">
                          {isJob ? "🕒 Scheduled Job" : "🛡️ Ad Guardrail"}
                        </span>
                      </div>
                    </div>

                    <h3 className="text-base font-bold text-slate-900 leading-snug">{bpText(bp, "name", locale)}</h3>

                    {/* Problem Box */}
                    <div className="rounded-xl bg-rose-50/70 p-3 text-xs border border-rose-100 text-rose-950 space-y-1">
                      <div className="font-bold text-rose-700 flex items-center gap-1 text-[11px]">
                        <span>🔴</span>
                        <span>{tr("automations.problemLabel")}</span>
                      </div>
                      <p className="text-slate-700 leading-relaxed text-[11.5px]">{bpText(bp, "problem", locale)}</p>
                    </div>

                    {/* Solution Box */}
                    <div className="rounded-xl bg-emerald-50/70 p-3 text-xs border border-emerald-100 text-emerald-950 space-y-1">
                      <div className="font-bold text-emerald-700 flex items-center gap-1 text-[11px]">
                        <span>🟢</span>
                        <span>{tr("automations.solutionLabel")}</span>
                      </div>
                      <p className="text-slate-700 leading-relaxed text-[11.5px]">{bpText(bp, "solution", locale)}</p>
                    </div>

                    {/* Impact Box */}
                    <div className="rounded-xl bg-indigo-50/70 p-2.5 text-xs border border-indigo-100 text-indigo-950 flex items-start gap-1.5">
                      <span className="font-bold text-indigo-700 shrink-0 text-[11px]">{tr("automations.impactLabel")}</span>
                      <span className="text-indigo-900 font-medium text-[11.5px] leading-snug">{bpText(bp, "impact", locale)}</span>
                    </div>

                    {/* Job Target Selector if needed */}
                    {isJob && (bp as ScheduledJobBlueprint).targetKind === "integration" && (
                      <div className="pt-1">
                        <select
                          className="input !py-1 text-xs w-full"
                          value={tplTarget[bp.key] ?? ""}
                          onChange={(e) => setTplTarget({ ...tplTarget, [bp.key]: e.target.value })}
                        >
                          <option value="">{tr("automations.pickStoreTitle")}</option>
                          {integrations.map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.provider} - {i.store?.name ?? ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {isJob && (bp as ScheduledJobBlueprint).targetKind === "competitor" && (
                      <div className="pt-1">
                        <select
                          className="input !py-1 text-xs w-full"
                          value={tplTarget[bp.key] ?? ""}
                          onChange={(e) => setTplTarget({ ...tplTarget, [bp.key]: e.target.value })}
                        >
                          <option value="">{tr("automations.pickCompetitorTitle")}</option>
                          {competitors.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="mt-4 pt-3 border-t border-slate-100 flex gap-2">
                    {isJob ? (
                      <button
                        type="button"
                        className="btn-primary btn-sm flex-1 font-semibold"
                        onClick={async () => {
                          const sJob = bp as ScheduledJobBlueprint;
                          const orgId = getOrganizationId();
                          if (!orgId) return;
                          const targetId =
                            sJob.targetKind === "org"
                              ? orgId
                              : tplTarget[sJob.key];
                          if (sJob.targetKind !== "org" && !targetId) {
                            setError(
                              sJob.targetKind === "integration"
                                ? tr("automations.pickStoreFirstShort")
                                : tr("automations.pickCompetitorFirstShort")
                            );
                            return;
                          }
                          const res = await wrap(`install-bp-${sJob.key}`, () =>
                            apiFetch(`/organizations/${orgId}/automation/jobs`, {
                              method: "POST",
                              body: JSON.stringify({
                                name: sJob.name,
                                type: sJob.type,
                                targetId,
                                intervalMinutes: sJob.defaultIntervalMinutes,
                              }),
                            })
                          );
                          if (res) {
                            setNotice(tr("automations.jobInstalled", { name: sJob.name }));
                            await load();
                            setActiveTab("jobs");
                          }
                        }}
                      >
                        {tr("automations.install1Click")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-primary btn-sm flex-1 font-semibold"
                        onClick={() => applyRuleBlueprint(bp as AdRuleBlueprint)}
                      >
                        {tr("automations.loadToForm")}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Server-Provided Templates if any */}
          {templates.length > 0 && (
            <div className="card p-5 space-y-3 mt-8">
              <h3 className="font-bold text-slate-900 text-sm">{tr("automations.serverJobTemplates")}</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {templates.map((t) => (
                  <div key={t.key} className="card p-4 border border-slate-200 flex flex-col justify-between">
                    <div className="space-y-1.5">
                      <span className="badge badge-green text-[10px]">{tr("automations.serverTemplate")}</span>
                      <h4 className="text-sm font-bold text-slate-900">{t.name}</h4>
                      <p className="text-xs text-slate-500">{t.descriptionBn}</p>
                      <span className="text-[11px] text-slate-400 font-mono">
                        {intervalLabel(t.intervalMinutes)}
                      </span>
                    </div>

                    <div className="mt-3 pt-2 border-t">
                      <button
                        type="button"
                        className="btn-secondary btn-sm w-full text-xs"
                        onClick={() => installTemplate(t)}
                      >
                        {tr("automations.install")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 4: SYSTEM HEALTH & DEAD LETTER QUEUE (DLQ)                 */}
      {/* ============================================================== */}
      {activeTab === "health" && (
        <div className="space-y-6">
          {/* Health Status Banner */}
          <div className="card p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">{tr("automations.healthTitle")}</h3>
                <p className="text-xs text-slate-500">
                  {tr("automations.healthIntro")}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className={`badge ${deadLetters.openCount > 0 ? "badge-red" : "badge-green"} text-xs font-bold`}>
                  {deadLetters.openCount > 0 ? tr("automations.deadLettersWaiting", { count: fmtNumber(locale, deadLetters.openCount) }) : tr("automations.allHealthy")}
                </span>
              </div>
            </div>

            {/* Health Bands Overview */}
            <div className="grid gap-3 sm:grid-cols-3 pt-2 border-t border-slate-100">
              <div className="rounded-xl bg-emerald-50/50 p-3 border border-emerald-100">
                <span className="text-xs font-semibold text-emerald-800">{tr("automations.healthyJobs")}</span>
                <div className="text-xl font-bold text-emerald-900 mt-0.5">
                  {tr("automations.countSuffix", { count: fmtNumber(locale, jobs.filter((j) => health[j.id]?.band === "ok").length) })}
                </div>
              </div>

              <div className="rounded-xl bg-rose-50/50 p-3 border border-rose-100">
                <span className="text-xs font-semibold text-rose-800">{tr("automations.failingJobs")}</span>
                <div className="text-xl font-bold text-rose-900 mt-0.5">
                  {tr("automations.countSuffix", { count: fmtNumber(locale, jobs.filter((j) => health[j.id]?.band === "failing").length) })}
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                <span className="text-xs font-semibold text-slate-600">{tr("automations.neverRunJobs")}</span>
                <div className="text-xl font-bold text-slate-800 mt-0.5">
                  {tr("automations.countSuffix", { count: fmtNumber(locale, jobs.filter((j) => !health[j.id] || health[j.id]?.band === "never_run").length) })}
                </div>
              </div>
            </div>
          </div>

          {/* Dead Letters List */}
          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-sm">
                Dead Letter Queue ({deadLetters.latest.length})
              </h3>
            </div>

            {deadLetters.latest.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center">
                {tr("automations.noDeadLetters")}
              </p>
            ) : (
              <div className="space-y-3">
                {deadLetters.latest.map((d) => (
                  <div
                    key={d.id}
                    className="flex flex-col gap-2 rounded-xl bg-slate-50 p-4 text-sm border border-slate-200 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">{d.jobName ?? d.jobType ?? "Job"}</span>
                        <span className="badge badge-slate text-[10px]">{d.jobType ?? "?"}</span>
                        <span className="text-xs text-slate-400">
                          {formatRelativeTime(d.createdAt, locale)} · {tr("automations.attemptsSuffix", { count: fmtNumber(locale, d.attempts) })}
                        </span>
                      </div>

                      <div className="text-xs text-rose-600 bg-rose-50 p-2 rounded-lg border border-rose-100 break-words font-mono">
                        {d.error}
                        {d.errorTruncated && (
                          <span className="text-slate-400"> {tr("automations.errorTruncated", { count: fmtNumber(locale, d.errorLength) })}</span>
                        )}
                      </div>

                      <div className="text-xs text-slate-500">
                        {d.open ? (
                          <span className="text-amber-600 font-semibold">{tr("automations.dlStatusWaiting")}</span>
                        ) : (
                          <span className="text-emerald-600">
                            {tr("automations.dlReplayed")} ({formatRelativeTime(d.replayedAt, locale)})
                          </span>
                        )}
                      </div>
                    </div>

                    {d.open && (
                      <button
                        type="button"
                        className="btn-primary btn-sm text-xs font-semibold shrink-0"
                        disabled={busy === `dlq-${d.id}`}
                        onClick={async () => {
                          const o = getOrganizationId();
                          if (!o) return;
                          const r = await wrap(`dlq-${d.id}`, () =>
                            apiFetch(`/organizations/${o}/automation/dead-letters/${d.id}/replay`, {
                              method: "POST",
                            })
                          );
                          if (r) {
                            setNotice(tr("automations.deadLetterReplayed"));
                            await load();
                          }
                        }}
                      >
                        {tr("automations.replayBtn")}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 5: RUNS HISTORY & AUDIT LOGS                                */}
      {/* ============================================================== */}
      {activeTab === "runs" && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="card p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">{tr("automations.runsTitle")}</h3>
              <p className="text-xs text-slate-500">{tr("automations.runsSub")}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                className="input !py-1 text-xs"
                value={runKindFilter}
                onChange={(e) => setRunKindFilter(e.target.value)}
              >
                <option value="">{tr("automations.allKinds")}</option>
                <option value="job">Scheduled Job</option>
                <option value="rule">Rule Evaluation</option>
              </select>

              <select
                className="input !py-1 text-xs"
                value={runStatusFilter}
                onChange={(e) => setRunStatusFilter(e.target.value)}
              >
                <option value="">{tr("automations.allStatus")}</option>
                <option value="success">{tr("automations.statusSuccess")}</option>
                <option value="triggered">{tr("automations.statusTriggered")}</option>
                <option value="failed">{tr("automations.statusFailed")}</option>
              </select>
            </div>
          </div>

          {/* Runs Feed */}
          {filteredRuns.length === 0 ? (
            <div className="card p-8">
              <EmptyState
                title={tr("automations.noRuns")}
                description={tr("automations.noRunsHint")}
              />
            </div>
          ) : (
            <div className="space-y-2">
              {filteredRuns.slice(0, 50).map((r) => {
                let badgeCls = "badge-slate";
                if (r.status === "success") badgeCls = "badge-green";
                else if (r.status === "triggered") badgeCls = "badge-amber";
                else if (r.status === "failed") badgeCls = "badge-red";

                return (
                  <div
                    key={r.id}
                    className="card p-3 hover:border-slate-300 transition-all flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between text-sm"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-800 capitalize">
                          {r.kind === "job" ? "🕒 Job" : "🛡️ Rule"}
                        </span>
                        <span className={`badge ${badgeCls} text-[10px]`}>{r.status}</span>
                        <span className="text-xs text-slate-400">{formatRelativeTime(r.createdAt)}</span>
                      </div>
                      {r.detail && <p className="text-xs text-slate-600 font-mono">{r.detail}</p>}
                    </div>

                    <div className="text-xs text-slate-400 font-mono">
                      {new Date(r.createdAt).toLocaleTimeString()}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 6: INVENTORY STOCKOUT ↔ META AD GUARDRAIL                   */}
      {/* ============================================================== */}
      {activeTab === "stock-guard" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-rose-200 bg-rose-50/40 p-5 sm:p-6 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xl">🛡️</span>
              <h2 className="text-base font-bold text-slate-900">
                {tr("automations.stockGuardTitle")}
              </h2>
            </div>
            <p className="text-xs text-slate-600 max-w-3xl leading-relaxed">
              {tr("automations.stockGuardIntro")}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="card p-4">
              <p className="text-xs font-medium text-slate-500">{tr("automations.stockTotalActions")}</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{stockGuardLogs.length}</p>
              <p className="text-[11px] text-slate-400">{tr("automations.stockPrevented")}</p>
            </div>
            <div className="card p-4 border-rose-100 bg-rose-50/30">
              <p className="text-xs font-medium text-rose-700">{tr("automations.stockPausedCampaigns")}</p>
              <p className="mt-1 text-2xl font-bold text-rose-800">
                {stockGuardLogs.filter((l) => l.action === "AUTO_PAUSED").length}
              </p>
              <p className="text-[11px] text-rose-600">{tr("automations.stockSavedBudget")}</p>
            </div>
            <div className="card p-4 border-emerald-100 bg-emerald-50/30">
              <p className="text-xs font-medium text-emerald-700">{tr("automations.stockRestockAlerts")}</p>
              <p className="mt-1 text-2xl font-bold text-emerald-800">
                {stockGuardLogs.filter((l) => l.action === "ALERT_SENT" || l.action === "AUTO_RESUMED").length}
              </p>
              <p className="text-[11px] text-emerald-600">{tr("automations.stockReady")}</p>
            </div>
          </div>

          <div className="overflow-hidden card">
            <div className="border-b bg-slate-50 px-4 py-3 font-semibold text-xs text-slate-700 flex items-center justify-between">
              <span>{tr("automations.stockLogTitle")}</span>
              <button
                onClick={() => void loadStockGuard()}
                className="text-xs font-medium text-brand-600 hover:underline"
              >
                {tr("automations.refresh")}
              </button>
            </div>

            {stockGuardLogs.length === 0 ? (
              <div className="p-8 text-center">
                <span className="text-3xl">🛡️</span>
                <p className="mt-2 text-sm font-semibold text-slate-800">{tr("automations.stockNoRisk")}</p>
                <p className="text-xs text-slate-500">{tr("automations.stockNoRiskHint")}</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {stockGuardLogs.map((log: any) => (
                  <div key={log.id} className="p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between hover:bg-slate-50 transition-colors">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          log.action === "AUTO_PAUSED"
                            ? "bg-rose-100 text-rose-700"
                            : log.action === "AUTO_RESUMED"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-700"
                        }`}>
                          {log.action === "AUTO_PAUSED" ? "⏸️ AUTO PAUSED" : log.action === "AUTO_RESUMED" ? "▶️ AUTO RESUMED" : "🔔 RESTOCKED"}
                        </span>
                        <span className="font-bold text-slate-900 text-xs">{log.productName}</span>
                        <span className="text-xs font-mono text-slate-400">{tr("automations.stockLabel")} {fmtNumber(locale, log.currentStock)}</span>
                      </div>
                      <p className="text-xs text-slate-600 font-mono">{log.details}</p>
                      {log.campaignName && (
                        <p className="text-[11px] text-slate-400">{tr("automations.campaignLabel")} {log.campaignName}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-slate-400">
                        {new Date(log.createdAt).toLocaleString("bn-BD")}
                      </span>
                      {log.campaignPlanId && log.action === "AUTO_PAUSED" && (
                        <button
                          disabled={resumeBusy === log.campaignPlanId}
                          onClick={() => void handleResumeGuardedCampaign(log.campaignPlanId)}
                          className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 shadow-sm"
                        >
                          {resumeBusy === log.campaignPlanId ? tr("automations.activating") : tr("automations.activateOnMeta")}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 7: PREDICTIVE REPLENISHMENT & AUTO RE-ORDER                */}
      {/* ============================================================== */}
      {activeTab === "replenishment" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-5 sm:p-6 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl">🔄</span>
                  <h2 className="text-base font-bold text-slate-900">
                    {tr("automations.replenTitle")}
                  </h2>
                </div>
                <p className="text-xs text-slate-600 max-w-3xl leading-relaxed mt-1">
                  {tr("automations.replenIntro")}
                </p>
              </div>

              <button
                disabled={scanBusy}
                onClick={() => void handleScanReplenishments()}
                className="btn-primary btn-sm text-xs font-bold whitespace-nowrap"
              >
                {scanBusy ? tr("automations.scanning") : tr("automations.scanDelivered")}
              </button>
            </div>
          </div>

          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="card p-4">
              <p className="text-xs font-medium text-slate-500">{tr("automations.replenTrackedCycles")}</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{tr("automations.countSuffix", { count: fmtNumber(locale, replenishmentKpi.totalTracked) })}</p>
              <p className="text-[11px] text-slate-400">{tr("automations.replenConsumableBuyers")}</p>
            </div>

            <div className="card p-4 border-amber-100 bg-amber-50/30">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-amber-800">{tr("automations.replenDue7d")}</p>
                {replenishmentKpi.dueCount > 0 && (
                  <span className="rounded-full bg-amber-500 px-1.5 py-0.2 text-[9px] font-bold text-white">DUE</span>
                )}
              </div>
              <p className="mt-1 text-2xl font-bold text-amber-900">{fmtNumber(locale, replenishmentKpi.dueCount)} {tr("automations.peopleSuffix")}</p>
              <p className="text-[11px] text-amber-700">{tr("automations.replenBestTime")}</p>
            </div>

            <div className="card p-4 border-emerald-100 bg-emerald-50/30">
              <p className="text-xs font-medium text-emerald-800">{tr("automations.replenConvRate")}</p>
              <p className="mt-1 text-2xl font-bold text-emerald-900">{replenishmentKpi.conversionRatePercent}%</p>
              <p className="text-[11px] text-emerald-700">{tr("automations.replenSuccessfulRepeats", { count: fmtNumber(locale, replenishmentKpi.reorderedCount) })}</p>
            </div>

            <div className="card p-4">
              <p className="text-xs font-medium text-slate-500">{tr("automations.replenExtraLtv")}</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{fmtMoney(locale, replenishmentKpi.estimatedRecoveredLtvBdt)}</p>
              <p className="text-[11px] text-slate-400">{tr("automations.replenExtraSalesNote")}</p>
            </div>
          </div>

          {/* Filter & Search Bar */}
          <div className="card p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="input !py-1 text-xs"
                value={replenishmentStatusFilter}
                onChange={(e) => setReplenishmentStatusFilter(e.target.value)}
              >
                <option value="">{tr("automations.replenStatusAll")}</option>
                <option value="DUE">{tr("automations.replenStatusDue")}</option>
                <option value="PENDING">{tr("automations.replenStatusPending")}</option>
                <option value="REMINDED">{tr("automations.replenStatusReminded")}</option>
                <option value="REORDERED">{tr("automations.replenStatusReordered")}</option>
              </select>

              <input
                type="text"
                placeholder={tr("automations.replenSearchPlaceholder")}
                className="input !py-1 text-xs w-60"
                value={replenishmentSearch}
                onChange={(e) => setReplenishmentSearch(e.target.value)}
              />
            </div>

            <button
              onClick={() => void loadReplenishment()}
              className="text-xs font-semibold text-brand-600 hover:underline"
            >
              {tr("automations.replenRefreshList")}
            </button>
          </div>

          {/* Replenishments List Table */}
          <div className="overflow-hidden card">
            {replenishmentItems.length === 0 ? (
              <div className="p-12 text-center">
                <span className="text-4xl">🧴</span>
                <p className="mt-2 text-sm font-semibold text-slate-800">{tr("automations.replenEmpty")}</p>
                <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
                  {tr("automations.replenEmptyHint")}
                </p>
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                  <tr>
                    <th className="py-3 px-4">{tr("automations.colCustomer")}</th>
                    <th className="py-3 px-4">{tr("automations.colProductCycle")}</th>
                    <th className="py-3 px-4">{tr("automations.colDeliveryDate")}</th>
                    <th className="py-3 px-4">{tr("automations.colDueDate")}</th>
                    <th className="py-3 px-4">{tr("automations.colStatus")}</th>
                    <th className="py-3 px-4 text-right">{tr("automations.colAction")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {replenishmentItems.map((item: any) => {
                    const isDue = item.status === "DUE" || item.daysUntilDue <= 3;
                    return (
                      <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-4">
                          <span className="font-bold text-slate-900">{item.customerName}</span>
                          <div className="text-[10px] text-slate-400 font-mono">{item.customerPhone}</div>
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-semibold text-slate-800">{item.productName}</span>
                          <div className="text-[10px] text-slate-400">{tr("automations.cycleDays", { count: fmtNumber(locale, item.replenishmentDays) })}</div>
                        </td>
                        <td className="py-3 px-4 text-slate-500">
                          {new Date(item.deliveredAt).toLocaleDateString("bn-BD")}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`font-bold ${isDue ? "text-amber-800" : "text-slate-700"}`}>
                            {new Date(item.predictedDate).toLocaleDateString("bn-BD")}
                          </span>
                          <div className="text-[10px]">
                            {item.daysUntilDue > 0 ? (
                              <span className={isDue ? "text-amber-700 font-bold" : "text-slate-400"}>
                                {tr("automations.daysLeft", { count: fmtNumber(locale, item.daysUntilDue) })}
                              </span>
                            ) : (
                              <span className="text-rose-600 font-bold">
                                {tr("automations.daysOverdue", { count: fmtNumber(locale, Math.abs(item.daysUntilDue)) })}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              item.status === "REORDERED"
                                ? "bg-emerald-100 text-emerald-800"
                                : item.status === "REMINDED"
                                ? "bg-blue-100 text-blue-800"
                                : item.status === "DUE"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {item.status === "REORDERED"
                              ? "✓ REORDERED"
                              : item.status === "REMINDED"
                              ? "🔔 REMINDED"
                              : item.status === "DUE"
                              ? tr("automations.replenDueBadge")
                              : "PENDING"}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {item.status !== "REORDERED" && (
                              <button
                                disabled={remindBusy === item.id}
                                onClick={() => void handleSendReplenishmentReminder(item.id)}
                                className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100 transition-colors"
                              >
                                {remindBusy === item.id ? tr("automations.sending") : tr("automations.reminderBtn")}
                              </button>
                            )}
                            {item.status !== "REORDERED" ? (
                              <button
                                onClick={() => void handleMarkReplenishmentReordered(item.id)}
                                className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 transition-colors"
                              >
                                {tr("automations.reorderedBtn")}
                              </button>
                            ) : (
                              <span className="text-xs font-bold text-emerald-700">{tr("automations.convertedBadge")}</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
