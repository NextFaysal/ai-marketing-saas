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
} from "@/lib/automation-blueprints";

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
  enabled: boolean;
  lastEvaluatedAt?: string | null;
  lastTriggeredAt?: string | null;
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

function intervalLabel(min: number): string {
  if (min % 10080 === 0) return min === 10080 ? "সপ্তাহে একবার" : `প্রতি ${min / 10080} সপ্তাহে`;
  if (min % 1440 === 0) return min === 1440 ? "প্রতিদিন একবার" : `প্রতি ${min / 1440} দিনে`;
  if (min % 60 === 0) return min === 60 ? "প্রতি ঘণ্টায়" : `প্রতি ${min / 60} ঘণ্টায়`;
  return `প্রতি ${min} মিনিটে`;
}

function formatRelativeTime(dateStr?: string | null): string {
  if (!dateStr) return "কখনো না";
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(Math.abs(diff) / 60000);
  if (minutes < 1) return diff > 0 ? "এইমাত্র" : "১ মিনিটের মধ্যে";
  if (minutes < 60) return diff > 0 ? `${minutes} মিনিট আগে` : `${minutes} মিনিট পর`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return diff > 0 ? `${hours} ঘণ্টা আগে` : `${hours} ঘণ্টা পর`;
  const days = Math.floor(hours / 24);
  return diff > 0 ? `${days} দিন আগে` : `${days} দিন পর`;
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

const HEALTH_BADGE: Record<string, { text: string; cls: string; dot: string }> = {
  ok: { text: "সুস্থ", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  failing: { text: "ব্যর্থ হচ্ছে", cls: "bg-rose-50 text-rose-700 border-rose-200", dot: "bg-rose-500" },
  never_run: { text: "এখনো চলেনি", cls: "bg-slate-50 text-slate-600 border-slate-200", dot: "bg-slate-400" },
};

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
  const [activeTab, setActiveTab] = useState<TabKey>("jobs");

  // Core Data
  const [jobs, setJobs] = useState<Job[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
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
      setNotice("ক্যাম্পেইন সফলভাবে চালু করা হয়েছে!");
    } catch (e: any) {
      setError(e.message || "ক্যাম্পেইন চালু করতে ব্যর্থ");
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
      setNotice(res?.message || "রিপ্লেনিশমেন্ট স্ক্যান সম্পন্ন!");
      await loadReplenishment();
    } catch (e: any) {
      setError(e.message || "স্ক্যান ব্যর্থ হয়েছে");
    } finally {
      setScanBusy(false);
    }
  }

  async function handleSendReplenishmentReminder(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setRemindBusy(id);
    try {
      const res = await apiFetch<any>(`/organizations/${orgId}/automation/replenishment/${id}/remind`, { method: "POST" });
      setNotice(res?.message || "রিমাইন্ডার পাঠানো হয়েছে!");
      await loadReplenishment();
    } catch (e: any) {
      setError(e.message || "রিমাইন্ডার পাঠাতে ব্যর্থ");
    } finally {
      setRemindBusy("");
    }
  }

  async function handleMarkReplenishmentReordered(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      await apiFetch<any>(`/organizations/${orgId}/automation/replenishment/${id}/reorder`, { method: "POST" });
      setNotice("রি-অর্ডার সফলভাবে মার্ক করা হয়েছে!");
      await loadReplenishment();
    } catch (e: any) {
      setError(e.message || "রি-অর্ডার আপডেট ব্যর্থ");
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
  });

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const [j, r, rn, ints, accs, comps, pls, h] = await Promise.all([
        apiFetch<Job[]>(`/organizations/${orgId}/automation/jobs`),
        apiFetch<Rule[]>(`/organizations/${orgId}/automation/rules`),
        apiFetch<Run[]>(`/organizations/${orgId}/automation/runs`),
        apiFetch<Integration[]>(`/organizations/${orgId}/integrations`),
        apiFetch<AdAccount[]>(`/organizations/${orgId}/ad-accounts`),
        apiFetch<Competitor[]>(`/organizations/${orgId}/competitors`),
        apiFetch<Plan[]>(`/organizations/${orgId}/campaign-plans`),
        apiFetch<HealthResponse>(`/organizations/${orgId}/automation/health`).catch(() => null),
      ]);
      setJobs(j);
      setRules(r);
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
      setError(e instanceof Error ? e.message : "অপারেশন সম্পন্ন হয়নি");
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
          : [{ id: "org", label: "এই Organization (সিস্টেম)" }];

  const typeOptions = JOB_TYPES_BY_TARGET[jobForm.targetKind] ?? [];

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
      setNotice("নতুন Scheduled Job সফলভাবে তৈরি হয়েছে!");
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
    setNotice(`Job "${j.name}" ${j.enabled ? "বন্ধ" : "চালু"} করা হয়েছে।`);
    await load();
  }

  async function deleteJob(j: Job) {
    if (!confirm(`আপনি কি নিশ্চিত যে "${j.name}" Job মুছে ফেলতে চান?`)) return;
    const orgId = getOrganizationId();
    if (!orgId) return;
    await wrap(`del-job-${j.id}`, () =>
      apiFetch(`/organizations/${orgId}/automation/jobs/${j.id}`, {
        method: "DELETE",
      })
    );
    setNotice(`Job "${j.name}" মুছে ফেলা হয়েছে।`);
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
    setNotice(`"${j.name}" তাৎক্ষণিকভাবে চালানো হয়েছে! Runs ট্যাবে ফলাফল দেখুন।`);
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
      });
      setNotice("নতুন Ad Guardrail Rule তৈরি হয়েছে! সার্ভার স্বয়ংক্রিয়ভাবে এটি মূল্যায়ন করবে।");
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
    setNotice(`Rule "${r.name}" ${r.enabled ? "বন্ধ" : "চালু"} করা হয়েছে।`);
    await load();
  }

  async function deleteRule(r: Rule) {
    if (!confirm(`আপনি কি নিশ্চিত যে "${r.name}" Rule মুছে ফেলতে চান?`)) return;
    const orgId = getOrganizationId();
    if (!orgId) return;
    await wrap(`del-rule-${r.id}`, () =>
      apiFetch(`/organizations/${orgId}/automation/rules/${r.id}`, {
        method: "DELETE",
      })
    );
    setNotice(`Rule "${r.name}" মুছে ফেলা হয়েছে।`);
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
      setNotice(`সবগুলো Rule যাচাই সম্পন্ন হয়েছে: ${triggered}টি শর্তপূরণ বা ট্রিগার হয়েছে।`);
      await load();
    }
  }

  async function installTemplate(t: JobTemplate) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const targetId = t.targetKind === "org" ? undefined : tplTarget[t.key];
    if (t.targetKind !== "org" && !targetId) {
      setError(t.targetKind === "integration" ? "আগে একটি Store Integration বেছে নিন" : "আগে একটি Competitor বেছে নিন");
      return;
    }
    const res = await wrap(`tpl-${t.key}`, () =>
      apiFetch(`/organizations/${orgId}/automation/job-templates/${t.key}/install`, {
        method: "POST",
        body: JSON.stringify(targetId ? { targetId } : {}),
      })
    );
    if (res) {
      setNotice(`টেমপ্লেট থেকে Job তৈরি হয়েছে: ${t.name}`);
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
    });
    setActiveTab("rules");
    setNotice(`"${rb.name}" রুল ফর্মে লোড হয়েছে! পর্যালোচনা করে তৈরি বাটনে চাপুন।`);
  }

  const inputCls = "input mt-1 w-full text-sm";

  return (
    <div className="space-y-6">
      {/* Page Title & Subtitle */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">অটোমেশন ও সিস্টেম গার্ড (Automations)</h1>
          <p className="text-sm text-slate-500">
            নির্ধারিত শিডিউল সিঙ্ক, ডেইলি AI রুটিন এবং মেটা/গুগল ক্যাম্পেইনের স্বয়ংক্রিয় বাজেট ও CPA গার্ডরেইল।
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
          <button onClick={() => setError("")} className="text-xs text-red-500 hover:text-red-700">✕ বন্ধ করুন</button>
        </div>
      )}

      {notice && (
        <div className="flex items-center justify-between rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 border border-emerald-200 shadow-sm">
          <div className="flex items-center gap-2">
            <span>✓</span>
            <span>{notice}</span>
          </div>
          <button onClick={() => setNotice("")} className="text-xs text-emerald-600 hover:text-emerald-800">✕ বন্ধ করুন</button>
        </div>
      )}

      {/* Top Metric Overview Bar */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Metric 1: Scheduled Jobs */}
        <div className="card p-4 flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Scheduled Jobs</span>
            <div className="text-2xl font-bold text-slate-900">
              {activeJobsCount} <span className="text-sm font-normal text-slate-400">/ {jobs.length} সক্রিয়</span>
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
              {activeRulesCount} <span className="text-sm font-normal text-slate-400">/ {rules.length} সক্রিয়</span>
            </div>
          </div>
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-xl text-emerald-600">
            🛡️
          </span>
        </div>

        {/* Metric 3: System Health */}
        <div className="card p-4 flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">সিস্টেম স্বাস্থ্য (৭ দিন)</span>
            <div className="text-2xl font-bold text-slate-900">
              {overallSuccessRate != null ? `${overallSuccessRate}%` : "১০০%"}
            </div>
            <div className="text-[11px] text-slate-500">
              {failingJobsCount > 0 ? (
                <span className="text-rose-600 font-semibold">{failingJobsCount}টি জব সতর্ক অবস্থায়</span>
              ) : (
                <span className="text-emerald-600 font-medium">সব সিঙ্ক স্বাভাবিক</span>
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
              {deadLetters.openCount > 0 ? "Dead Letter Alert" : "পরবর্তী শিডিউল"}
            </span>
            {deadLetters.openCount > 0 ? (
              <div className="text-2xl font-bold text-rose-600">
                {deadLetters.openCount}টি <span className="text-xs font-normal text-rose-500">অপেক্ষমাণ</span>
              </div>
            ) : nextEarliestJob ? (
              <div>
                <div className="text-base font-bold text-slate-800 truncate max-w-[150px]">{nextEarliestJob.name}</div>
                <div className="text-xs text-slate-500">{formatRelativeTime(nextEarliestJob.nextRunAt)}</div>
              </div>
            ) : (
              <div className="text-sm font-semibold text-slate-400">কোনো শিডিউল নেই</div>
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
            <span>রেডিমেড ব্লুপ্রিন্ট ও টেমপ্লেট</span>
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
            <span>স্বাস্থ্য ও DLQ</span>
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
            <span>এক্সিকিউশন লগস</span>
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
            <span>স্টক অ্যাড-গার্ডরেল</span>
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
            <span>প্রেডিক্টিভ রিপ্লেনিশমেন্ট</span>
            {replenishmentKpi.dueCount > 0 && (
              <span className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-xs font-bold animate-pulse">
                {replenishmentKpi.dueCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ============================================================== */}
      {/* TAB 1: SCHEDULED JOBS (সিঙ্ক ও রুটিন)                            */}
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
                  placeholder="Job এর নাম বা ধরন দিয়ে খুঁজুন..."
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
                  <span>{isJobModalOpen ? "✕ বন্ধ করুন" : "+ নতুন Job তৈরি করুন"}</span>
                </button>
              </div>
            </div>

            {/* Category Filter Chips */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs pt-1 border-t border-slate-100">
              <span className="text-xs font-semibold text-slate-400 mr-1">টার্গেট:</span>
              {[
                { id: "all", label: "সব জব", icon: "✨", count: jobs.length },
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
                  <h3 className="text-base font-bold text-slate-900">নতুন Scheduled Job তৈরি করুন</h3>
                  <p className="text-xs text-slate-500">নির্ধারিত সময় পরপর সার্ভার নিজে এই টাস্কটি এক্সিকিউট করবে।</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsJobModalOpen(false)}
                  className="text-xs font-semibold text-slate-400 hover:text-slate-600"
                >
                  ✕ বন্ধ করুন
                </button>
              </div>

              <form onSubmit={createJob} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Job এর নাম</label>
                  <input
                    className={inputCls}
                    value={jobForm.name}
                    onChange={(e) => setJobForm({ ...jobForm, name: e.target.value })}
                    required
                    placeholder="যেমন: Orders 15m Sync"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">টার্গেট ধরন</label>
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
                    <option value="org">Organization (সিস্টেম)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">নির্দিষ্ট টার্গেট</label>
                  <select
                    className={inputCls}
                    value={jobForm.targetId}
                    onChange={(e) => setJobForm({ ...jobForm, targetId: e.target.value })}
                    required={jobForm.targetKind !== "org"}
                  >
                    <option value="">বেছে নিন</option>
                    {targetOptions.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">কাজের ধরন (Job Type)</label>
                  <select
                    className={inputCls}
                    value={jobForm.type}
                    onChange={(e) => setJobForm({ ...jobForm, type: e.target.value })}
                    required
                  >
                    <option value="">বেছে নিন</option>
                    {typeOptions.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">কত মিনিট পর পর</label>
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
                    বাতিল
                  </button>
                  <button
                    type="submit"
                    className="btn-primary btn-sm"
                    disabled={busy !== ""}
                  >
                    Job সেভ করুন
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Job List */}
          {filteredJobs.length === 0 ? (
            <div className="card p-8">
              <EmptyState
                title="কোনো Scheduled Job পাওয়া যায়নি"
                description="আপনার স্টোর বা অ্যাকাউন্টের জন্য নতুন একটি Job তৈরি করুন অথবা রেডিমেড ব্লুপ্রিন্ট থেকে বেছে নিন।"
                actionLabel="নতুন Job তৈরি করুন"
                onAction={() => setIsJobModalOpen(true)}
              />
            </div>
          ) : (
            <div className="space-y-3">
              {filteredJobs.map((j) => {
                const jHealth = health[j.id];
                const band = jHealth?.band ?? (j.lastRunAt ? "ok" : "never_run");
                const bMeta = HEALTH_BADGE[band] ?? HEALTH_BADGE.never_run;

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
                          {intervalLabel(j.intervalMinutes)}
                        </span>
                        <span className="text-xs text-slate-400 font-mono">({j.type})</span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span>
                          শেষ রান: <strong className="text-slate-700">{formatRelativeTime(j.lastRunAt)}</strong>
                          {j.lastStatus && ` (${j.lastStatus})`}
                        </span>
                        <span>
                          পরবর্তী রান: <strong className="text-slate-700">{formatRelativeTime(j.nextRunAt)}</strong>
                        </span>
                        {jHealth && (
                          <span>
                            ৭ দিনে রান: <strong className="text-slate-700">{jHealth.runs7d}টি</strong>
                            {jHealth.successRate7d != null && (
                              <> (সাফল্য: {Math.round(jHealth.successRate7d * 100)}%)</>
                            )}
                          </span>
                        )}
                      </div>

                      {/* Error trace if any */}
                      {j.lastError && (
                        <div className="text-xs text-rose-600 bg-rose-50 px-2.5 py-1 rounded-lg border border-rose-100 break-words mt-1">
                          ⚠️ সর্বশেষ ত্রুটি: {j.lastError}
                        </div>
                      )}

                      {/* Consecutive failures warning */}
                      {jHealth && jHealth.consecutiveFailures > 0 && (
                        <div className="text-xs text-amber-700 font-medium">
                          ⚠️ টানা {jHealth.consecutiveFailures} বার ব্যর্থ হয়েছে।
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
                        title="এই মুহূর্তে সার্ভারে একবার চালান"
                      >
                        <span>⚡ এখন চালান</span>
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
                        title={j.enabled ? "Job বন্ধ করুন" : "Job চালু করুন"}
                      >
                        {j.enabled ? "সক্রিয় (অন)" : "বন্ধ (অফ)"}
                      </button>

                      <button
                        type="button"
                        className="rounded-lg p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                        disabled={busy === `del-job-${j.id}`}
                        onClick={() => deleteJob(j)}
                        title="Job মুছে ফেলুন"
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
                <h3 className="font-bold text-slate-900 text-sm">বিজ্ঞাপন ও বাজেট সুরক্ষা রুলস (Ad Guardrails)</h3>
                <p className="text-xs text-slate-500">
                  মেটা বা গুগল বিজ্ঞাপনে CPA বৃদ্ধি, অডিয়েন্স ফ্যাটিগ বা শূন্য কনভার্সন ঘটলে স্বয়ংক্রিয় একশন নেয়।
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn-primary btn-sm font-semibold flex items-center gap-1.5"
                  disabled={busy === "eval-rules"}
                  onClick={evaluateRulesNow}
                  title="সবগুলো সক্রিয় রুল অবিলম্বে মেটা/অ্যাড অ্যাকাউন্টে যাচাই করুন"
                >
                  <span>⚡ এখন সব Rule যাচাই করুন</span>
                </button>
              </div>
            </div>

            {/* Quick Presets Strip */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs pt-1 border-t border-slate-100">
              <span className="text-xs font-semibold text-slate-400 mr-1">কুইক প্রিসেট:</span>
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

          {/* Rule Creator Form */}
          <div className="card p-5 space-y-4">
            <h4 className="text-sm font-bold text-slate-900 border-b pb-2">নতুন Rule তৈরি করুন</h4>
            <form onSubmit={createRule} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Rule এর নাম</label>
                <input
                  className={inputCls}
                  value={ruleForm.name}
                  onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
                  required
                  placeholder="যেমন: High CPA Stop"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">মেট্রিক (Metric)</label>
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
                <label className="block text-xs font-semibold text-slate-700">শর্ত (Comparator)</label>
                <select
                  className={inputCls}
                  value={ruleForm.comparator}
                  onChange={(e) => setRuleForm({ ...ruleForm, comparator: e.target.value })}
                >
                  <option value="gt">বেশি হলে ( &gt; )</option>
                  <option value="lt">কম হলে ( &lt; )</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Threshold মান (সংখ্যা)</label>
                <input
                  className={inputCls}
                  value={ruleForm.threshold}
                  onChange={(e) => setRuleForm({ ...ruleForm, threshold: e.target.value })}
                  required
                  placeholder="যেমন: 350"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">উইন্ডো (গত কত দিন)</label>
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
                <label className="block text-xs font-semibold text-slate-700">অ্যাকশন (Action)</label>
                <select
                  className={inputCls}
                  value={ruleForm.action}
                  onChange={(e) => setRuleForm({ ...ruleForm, action: e.target.value })}
                >
                  <option value="alert">শুধু Alert (নিরাপদ)</option>
                  <option value="pause_campaign">Campaign Pause করুন</option>
                  <option value="activate_campaign">Campaign Active করুন</option>
                  <option value="scale_budget">Budget বাড়ান/কমান (%)</option>
                  <option value="pause_ad">বিজ্ঞাপন Pause (Ad-level)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">টার্গেট Plan (ঐচ্ছিক)</label>
                <select
                  className={inputCls}
                  value={ruleForm.campaignPlanId}
                  onChange={(e) => setRuleForm({ ...ruleForm, campaignPlanId: e.target.value })}
                >
                  <option value="">সব Published Plan</option>
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
                    <label className="block text-xs font-semibold text-slate-700">বাজেট স্কেলিং % (যেমন: 20)</label>
                    <input
                      className={inputCls}
                      value={ruleForm.percent}
                      onChange={(e) => setRuleForm({ ...ruleForm, percent: e.target.value })}
                      placeholder="20"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">সর্বনিম্ন দৈনিক বাজেট (৳)</label>
                    <input
                      className={inputCls}
                      value={ruleForm.minDaily}
                      onChange={(e) => setRuleForm({ ...ruleForm, minDaily: e.target.value })}
                      placeholder="500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">সর্বোচ্চ দৈনিক বাজেট (৳)</label>
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
                  Rule তৈরি করুন
                </button>
              </div>
            </form>
          </div>

          {/* Rules List */}
          {filteredRules.length === 0 ? (
            <div className="card p-8">
              <EmptyState
                title="কোনো Ad Guardrail Rule নেই"
                description="বিজ্ঞাপনের অনাকাঙ্ক্ষিত খরচ রুখতে বা লাভজনক ক্যাম্পেইনে বাজেট বাড়াতে একটি Rule তৈরি করুন।"
              />
            </div>
          ) : (
            <div className="space-y-3">
              {filteredRules.map((r) => {
                const actMeta = RULE_ACTION_LABELS[r.action] ?? {
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
                          <span className="badge badge-brand text-[10px]">নির্দিষ্ট প্ল্যান</span>
                        )}
                      </div>

                      <div className="text-xs text-slate-600 font-medium">
                        শর্ত: <span className="font-mono text-slate-800">{METRIC_LABELS[r.metric] ?? r.metric}</span> {r.comparator === "gt" ? ">" : "<"} <strong className="text-slate-900 font-mono">{r.threshold}</strong> ({r.windowDays} দিনের গড়)
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                        <span>শেষ মূল্যায়ন: {formatRelativeTime(r.lastEvaluatedAt)}</span>
                        <span>
                          শেষ ট্রিগার:{" "}
                          <strong className={r.lastTriggeredAt ? "text-amber-600 font-semibold" : ""}>
                            {formatRelativeTime(r.lastTriggeredAt)}
                          </strong>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 shrink-0">
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
                        {r.enabled ? "সক্রিয় (অন)" : "বন্ধ (অফ)"}
                      </button>

                      <button
                        type="button"
                        className="rounded-lg p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                        disabled={busy === `del-rule-${r.id}`}
                        onClick={() => deleteRule(r)}
                        title="Rule মুছে ফেলুন"
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
                  <h2 className="text-xl font-bold text-slate-900">📚 রেডিমেড অটোমেশন ও রুলস গ্যালারি</h2>
                  <span className="badge badge-brand font-bold">
                    {SCHEDULED_JOB_BLUEPRINTS.length + AD_RULE_BLUEPRINTS.length}+ ব্লুপ্রিন্ট
                  </span>
                </div>
                <p className="text-sm text-slate-500 mt-0.5">
                  আপনার ব্যবসার সমস্যা নির্বাচন করে ১-ক্লিকে সিঙ্ক জব বা অ্যাড গার্ডরেইল রুল সক্রিয় করুন।
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
                  ✕ ফিল্টার রিসেট
                </button>
              )}
            </div>

            {/* Search Input */}
            <div className="relative">
              <input
                type="text"
                className="input !py-2.5 w-full text-sm rounded-xl"
                placeholder="সমস্যা বা প্রয়োজন দিয়ে খুঁজুন (যেমন: WooCommerce, Meta Insights, CPA Guard, ROAS, Competitor)..."
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
              <span className="text-xs font-semibold text-slate-400 mr-1">ধরন:</span>
              <button
                type="button"
                onClick={() => setBlueprintKind("all")}
                className={`rounded-lg px-2.5 py-1 font-medium transition ${
                  blueprintKind === "all" ? "bg-brand-600 text-white font-semibold" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                সব ব্লুপ্রিন্ট ({SCHEDULED_JOB_BLUEPRINTS.length + AD_RULE_BLUEPRINTS.length})
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

                    <h3 className="text-base font-bold text-slate-900 leading-snug">{bp.name}</h3>

                    {/* Problem Box */}
                    <div className="rounded-xl bg-rose-50/70 p-3 text-xs border border-rose-100 text-rose-950 space-y-1">
                      <div className="font-bold text-rose-700 flex items-center gap-1 text-[11px]">
                        <span>🔴</span>
                        <span>সমস্যা:</span>
                      </div>
                      <p className="text-slate-700 leading-relaxed text-[11.5px]">{bp.problemBn}</p>
                    </div>

                    {/* Solution Box */}
                    <div className="rounded-xl bg-emerald-50/70 p-3 text-xs border border-emerald-100 text-emerald-950 space-y-1">
                      <div className="font-bold text-emerald-700 flex items-center gap-1 text-[11px]">
                        <span>🟢</span>
                        <span>সমাধান:</span>
                      </div>
                      <p className="text-slate-700 leading-relaxed text-[11.5px]">{bp.solutionBn}</p>
                    </div>

                    {/* Impact Box */}
                    <div className="rounded-xl bg-indigo-50/70 p-2.5 text-xs border border-indigo-100 text-indigo-950 flex items-start gap-1.5">
                      <span className="font-bold text-indigo-700 shrink-0 text-[11px]">📈 প্রভাব:</span>
                      <span className="text-indigo-900 font-medium text-[11.5px] leading-snug">{bp.impactBn}</span>
                    </div>

                    {/* Job Target Selector if needed */}
                    {isJob && (bp as ScheduledJobBlueprint).targetKind === "integration" && (
                      <div className="pt-1">
                        <select
                          className="input !py-1 text-xs w-full"
                          value={tplTarget[bp.key] ?? ""}
                          onChange={(e) => setTplTarget({ ...tplTarget, [bp.key]: e.target.value })}
                        >
                          <option value="">Store Integration বেছে নিন</option>
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
                          <option value="">Competitor বেছে নিন</option>
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
                                ? "আগে একটি Store Integration সিলেক্ট করুন"
                                : "আগে একটি Competitor সিলেক্ট করুন"
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
                            setNotice(`"${sJob.name}" Job সফলভাবে ইনস্টল ও শিডিউল হয়েছে!`);
                            await load();
                            setActiveTab("jobs");
                          }
                        }}
                      >
                        ১-ক্লিকে ইনস্টল করুন
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-primary btn-sm flex-1 font-semibold"
                        onClick={() => applyRuleBlueprint(bp as AdRuleBlueprint)}
                      >
                        🛠️ ফর্মে লোড করুন
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
              <h3 className="font-bold text-slate-900 text-sm">⚡ সার্ভার Job টেমপ্লেট</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {templates.map((t) => (
                  <div key={t.key} className="card p-4 border border-slate-200 flex flex-col justify-between">
                    <div className="space-y-1.5">
                      <span className="badge badge-green text-[10px]">সার্ভার টেমপ্লেট</span>
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
                        ইনস্টল করুন
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
                <h3 className="text-base font-bold text-slate-900">সিস্টেম স্বাস্থ্য ও ফেইলিউর মনিটর</h3>
                <p className="text-xs text-slate-500">
                  যেসব Job নির্ধারিত রিট্রাই সীমার পরেও ব্যর্থ হয়, সেগুলো Dead Letter হিসেবে জমা থাকে যাতে ডেটা লস না হয়।
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className={`badge ${deadLetters.openCount > 0 ? "badge-red" : "badge-green"} text-xs font-bold`}>
                  {deadLetters.openCount > 0 ? `${deadLetters.openCount}টি Dead Letter অপেক্ষমাণ` : "সবকিছু সুস্থ"}
                </span>
              </div>
            </div>

            {/* Health Bands Overview */}
            <div className="grid gap-3 sm:grid-cols-3 pt-2 border-t border-slate-100">
              <div className="rounded-xl bg-emerald-50/50 p-3 border border-emerald-100">
                <span className="text-xs font-semibold text-emerald-800">সুস্থ Jobs (Healthy)</span>
                <div className="text-xl font-bold text-emerald-900 mt-0.5">
                  {jobs.filter((j) => health[j.id]?.band === "ok").length} টি
                </div>
              </div>

              <div className="rounded-xl bg-rose-50/50 p-3 border border-rose-100">
                <span className="text-xs font-semibold text-rose-800">ব্যর্থ হচ্ছে (Failing)</span>
                <div className="text-xl font-bold text-rose-900 mt-0.5">
                  {jobs.filter((j) => health[j.id]?.band === "failing").length} টি
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                <span className="text-xs font-semibold text-slate-600">এখনো চলেনি (Never Run)</span>
                <div className="text-xl font-bold text-slate-800 mt-0.5">
                  {jobs.filter((j) => !health[j.id] || health[j.id]?.band === "never_run").length} টি
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
                🎉 কোনো Dead Letter নেই — সব Job যথাসময়ে সফলভাবে চলছে!
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
                          {formatRelativeTime(d.createdAt)} · {d.attempts} বার চেষ্টা
                        </span>
                      </div>

                      <div className="text-xs text-rose-600 bg-rose-50 p-2 rounded-lg border border-rose-100 break-words font-mono">
                        {d.error}
                        {d.errorTruncated && (
                          <span className="text-slate-400"> …(সংক্ষেপিত, মোট {d.errorLength} অক্ষর)</span>
                        )}
                      </div>

                      <div className="text-xs text-slate-500">
                        {d.open ? (
                          <span className="text-amber-600 font-semibold">● অবস্থা: অপেক্ষমাণ (Replay প্রয়োজন)</span>
                        ) : (
                          <span className="text-emerald-600">
                            ✓ পুনরায় চালানো হয়েছে ({formatRelativeTime(d.replayedAt)})
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
                            setNotice("Dead Letter পুনরায় চালানো হয়েছে!");
                            await load();
                          }
                        }}
                      >
                        🔄 আবার চালান (Replay)
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
              <h3 className="font-bold text-slate-900 text-sm">এক্সিকিউশন ইতিহাস (Runs History)</h3>
              <p className="text-xs text-slate-500">সাম্প্রতিক Scheduled Job ও Rule ট্রায়ালের লাইভ রেজাল্ট</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                className="input !py-1 text-xs"
                value={runKindFilter}
                onChange={(e) => setRunKindFilter(e.target.value)}
              >
                <option value="">সব ধরন (Kind)</option>
                <option value="job">Scheduled Job</option>
                <option value="rule">Rule Evaluation</option>
              </select>

              <select
                className="input !py-1 text-xs"
                value={runStatusFilter}
                onChange={(e) => setRunStatusFilter(e.target.value)}
              >
                <option value="">সব Status</option>
                <option value="success">success (সফল)</option>
                <option value="triggered">triggered (ট্রিগার্ড)</option>
                <option value="failed">failed (ব্যর্থ)</option>
              </select>
            </div>
          </div>

          {/* Runs Feed */}
          {filteredRuns.length === 0 ? (
            <div className="card p-8">
              <EmptyState
                title="কোনো Run রেকর্ড নেই"
                description="যখন কোনো শিডিউল জব স্বয়ংক্রিয়ভাবে বা ম্যানুয়ালি চলবে, তখন এখানে ফলাফল দেখা যাবে।"
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
                স্টক-লিংকড মেটা অ্যাড গার্ডরেল (Inventory Stockout Auto-Pause)
              </h2>
            </div>
            <p className="text-xs text-slate-600 max-w-3xl leading-relaxed">
              গোডাউনে কোনো প্রোডাক্টের স্টক ০ (বা নির্ধারিত থ্রেশহোল্ড) এ নামলে সিস্টেম স্বয়ংক্রিয়ভাবে সংশ্লিষ্ট Meta Facebook Ad ক্যাম্পেইন Pause করে দেয়, যাতে কাস্টমাররা স্টকআউট প্রোডাক্টে ক্লিক করে আপনার অ্যাডের টাকা নষ্ট না করে। প্রোডাক্ট আবার রিস্টক হলে এক ক্লিকেই ক্যাম্পেইন পুনরায় চালু করা যায়।
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="card p-4">
              <p className="text-xs font-medium text-slate-500">মোট সক্রিয় গার্ডরেল অ্যাকশন</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{stockGuardLogs.length}</p>
              <p className="text-[11px] text-slate-400">স্টকআউট প্রতিরোধ রেকর্ড</p>
            </div>
            <div className="card p-4 border-rose-100 bg-rose-50/30">
              <p className="text-xs font-medium text-rose-700">স্বয়ংক্রিয়ভাবে পজ করা ক্যাম্পেইন</p>
              <p className="mt-1 text-2xl font-bold text-rose-800">
                {stockGuardLogs.filter((l) => l.action === "AUTO_PAUSED").length}
              </p>
              <p className="text-[11px] text-rose-600">বাজেট অপচয় থেকে রক্ষা</p>
            </div>
            <div className="card p-4 border-emerald-100 bg-emerald-50/30">
              <p className="text-xs font-medium text-emerald-700">রিস্টক অ্যালার্ট পাঠানো হয়েছে</p>
              <p className="mt-1 text-2xl font-bold text-emerald-800">
                {stockGuardLogs.filter((l) => l.action === "ALERT_SENT" || l.action === "AUTO_RESUMED").length}
              </p>
              <p className="text-[11px] text-emerald-600">চালুর জন্য প্রস্তুত</p>
            </div>
          </div>

          <div className="overflow-hidden card">
            <div className="border-b bg-slate-50 px-4 py-3 font-semibold text-xs text-slate-700 flex items-center justify-between">
              <span>গার্ডরেল অ্যাকশন লগ</span>
              <button
                onClick={() => void loadStockGuard()}
                className="text-xs font-medium text-brand-600 hover:underline"
              >
                🔄 রিফ্রেশ করুন
              </button>
            </div>

            {stockGuardLogs.length === 0 ? (
              <div className="p-8 text-center">
                <span className="text-3xl">🛡️</span>
                <p className="mt-2 text-sm font-semibold text-slate-800">কোনো স্টকআউট ঝুঁকি নেই</p>
                <p className="text-xs text-slate-500">বিজ্ঞাপিত সব প্রোডাক্ট পর্যাপ্ত স্টকে আছে।</p>
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
                        <span className="text-xs font-mono text-slate-400">স্টক: {log.currentStock}</span>
                      </div>
                      <p className="text-xs text-slate-600 font-mono">{log.details}</p>
                      {log.campaignName && (
                        <p className="text-[11px] text-slate-400">ক্যাম্পেইন: {log.campaignName}</p>
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
                          {resumeBusy === log.campaignPlanId ? "চালু হচ্ছে..." : "▶️ Meta-তে অ্যাড চালু করুন"}
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
                    প্রেডিক্টিভ রিপিট-পারচেজ ও রি-অর্ডার ইঞ্জিন (Predictive Replenishment)
                  </h2>
                </div>
                <p className="text-xs text-slate-600 max-w-3xl leading-relaxed mt-1">
                  স্কিনকেয়ার, গ্রোসারি, ঘি/তেল বা সাপ্লিমেন্টের মতো ব্যবহার্য পণ্যের গ্রাহকরা সাধারণত ২০-৪৫ দিন পর পর আবার কেনে। এই ইঞ্জিন ডেলিভারির তারিখ ও পণ্য চক্র বিশ্লেষণ করে গ্রাহকের পণ্য ফুরিয়ে আসার ঠিক ৩-৫ দিন আগে সময়মতো পারসোনালাইজড অফার পাঠায়।
                </p>
              </div>

              <button
                disabled={scanBusy}
                onClick={() => void handleScanReplenishments()}
                className="btn-primary btn-sm text-xs font-bold whitespace-nowrap"
              >
                {scanBusy ? "স্ক্যান হচ্ছে..." : "🔍 ডেলিভার্ড অর্ডার স্ক্যান করুন"}
              </button>
            </div>
          </div>

          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="card p-4">
              <p className="text-xs font-medium text-slate-500">মোট ট্র্যাক করা সাইকেল</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{replenishmentKpi.totalTracked} টি</p>
              <p className="text-[11px] text-slate-400">কনজিউমেবল পণ্য ক্রেতা</p>
            </div>

            <div className="card p-4 border-amber-100 bg-amber-50/30">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-amber-800">🚨 আগামী ৭ দিনে শেষ হবে</p>
                {replenishmentKpi.dueCount > 0 && (
                  <span className="rounded-full bg-amber-500 px-1.5 py-0.2 text-[9px] font-bold text-white">DUE</span>
                )}
              </div>
              <p className="mt-1 text-2xl font-bold text-amber-900">{replenishmentKpi.dueCount} জন</p>
              <p className="text-[11px] text-amber-700">রিমাইন্ডার পাঠানোর এখনই সেরা সময়</p>
            </div>

            <div className="card p-4 border-emerald-100 bg-emerald-50/30">
              <p className="text-xs font-medium text-emerald-800">রি-অর্ডার কনভার্সন রেট</p>
              <p className="mt-1 text-2xl font-bold text-emerald-900">{replenishmentKpi.conversionRatePercent}%</p>
              <p className="text-[11px] text-emerald-700">{replenishmentKpi.reorderedCount}টি সফল রিপিট পারচেজ</p>
            </div>

            <div className="card p-4">
              <p className="text-xs font-medium text-slate-500">অর্জিত অতিরিক্ত LTV</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">৳{replenishmentKpi.estimatedRecoveredLtvBdt.toLocaleString("bn-BD")}</p>
              <p className="text-[11px] text-slate-400">বিজ্ঞাপন খরচ ছাড়া বাড়তি সেলস</p>
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
                <option value="">সব স্ট্যাটাস</option>
                <option value="DUE">🚨 শেষ হওয়ার পথে (DUE)</option>
                <option value="PENDING">চলমান সাইকেল (PENDING)</option>
                <option value="REMINDED">রিমাইন্ডার পাঠানো হয়েছে (REMINDED)</option>
                <option value="REORDERED">রি-অর্ডার সফল (REORDERED)</option>
              </select>

              <input
                type="text"
                placeholder="গ্রাহক, ফোন বা প্রোডাক্ট খুঁজুন..."
                className="input !py-1 text-xs w-60"
                value={replenishmentSearch}
                onChange={(e) => setReplenishmentSearch(e.target.value)}
              />
            </div>

            <button
              onClick={() => void loadReplenishment()}
              className="text-xs font-semibold text-brand-600 hover:underline"
            >
              🔄 তালিকা রিফ্রেশ
            </button>
          </div>

          {/* Replenishments List Table */}
          <div className="overflow-hidden card">
            {replenishmentItems.length === 0 ? (
              <div className="p-12 text-center">
                <span className="text-4xl">🧴</span>
                <p className="mt-2 text-sm font-semibold text-slate-800">কোনো রিপ্লেনিশমেন্ট রেকর্ড নেই</p>
                <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
                  কনজিউমেবল প্রোডাক্টের রিপ্লেনিশমেন্ট দিন সেট করে উপরের "ডেলিভার্ড অর্ডার স্ক্যান করুন" বাটনে চাপুন।
                </p>
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                  <tr>
                    <th className="py-3 px-4">গ্রাহক</th>
                    <th className="py-3 px-4">প্রোডাক্ট ও সাইকেল</th>
                    <th className="py-3 px-4">ডেলিভারির তারিখ</th>
                    <th className="py-3 px-4">সম্ভাব্য শেষ হওয়ার তারিখ</th>
                    <th className="py-3 px-4">স্ট্যাটাস</th>
                    <th className="py-3 px-4 text-right">অ্যাকশন</th>
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
                          <div className="text-[10px] text-slate-400">{item.replenishmentDays} দিনের সাইকেল</div>
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
                                আর {item.daysUntilDue} দিন বাকি
                              </span>
                            ) : (
                              <span className="text-rose-600 font-bold">
                                {Math.abs(item.daysUntilDue)} দিন আগে পার হয়েছে
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
                              ? "🚨 শেষ হওয়ার পথে"
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
                                {remindBusy === item.id ? "পাঠানো হচ্ছে..." : "📲 রিমাইন্ডার"}
                              </button>
                            )}
                            {item.status !== "REORDERED" ? (
                              <button
                                onClick={() => void handleMarkReplenishmentReordered(item.id)}
                                className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 transition-colors"
                              >
                                ✓ রি-অর্ডার হয়েছে
                              </button>
                            ) : (
                              <span className="text-xs font-bold text-emerald-700">✓ কনভার্ট হয়েছে</span>
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
