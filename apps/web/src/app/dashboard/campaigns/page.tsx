"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { EmptyState } from "@repo/ui";
import {
  CAMPAIGN_STATUS_META,
  CAMPAIGN_OBJECTIVES,
  getCampaignStatusBadge,
  getCampaignObjectiveMeta,
} from "@/lib/campaign-status";

interface Plan {
  id: string;
  name: string;
  objective: string;
  status: string;
  metaStatus?: string | null;
  externalCampaignId?: string | null;
  adAccountId?: string | null;
  adSetCount: number;
  rejectionReason?: string | null;
  updatedAt: string;
  createdAt: string;
}

interface AdAccount {
  id: string;
  platform: string;
  name: string;
}

interface Blueprint {
  key: string;
  name: string;
  objective: string;
  description?: string;
  advantagePlus?: boolean;
}

type TabKey = "all" | "live" | "approval" | "blueprints";

export default function CampaignsPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>("all");

  // Filter & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [objectiveFilter, setObjectiveFilter] = useState("all");

  // Feedback & Action state
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  // Reject Modal
  const [rejectPlanId, setRejectPlanId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // Blueprint Instantiate Modal
  const [instantiateBp, setInstantiateBp] = useState<Blueprint | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const [pList, accList] = await Promise.all([
        apiFetch<Plan[]>(`/organizations/${orgId}/campaign-plans`),
        apiFetch<AdAccount[]>(`/organizations/${orgId}/ad-accounts`).catch(() => []),
      ]);
      setPlans(pList);
      setAccounts(accList.filter((a) => a.platform === "meta"));
      if (accList.length > 0 && !selectedAccountId) {
        const metaAcc = accList.find((a) => a.platform === "meta");
        if (metaAcc) setSelectedAccountId(metaAcc.id);
      }

      // Try fetching server blueprints
      apiFetch<Blueprint[]>(`/organizations/${orgId}/campaign-plans/blueprints/list`)
        .then(setBlueprints)
        .catch(() => {
          // Fallback blueprints
          setBlueprints([
            {
              key: "ecommerce_sales",
              name: "ই-কমার্স সেলস বুস্টার (Direct Conversions)",
              objective: "OUTCOME_SALES",
              description: "ওয়েবসাইটে সরাসরি অর্ডার ও বিক্রি বৃদ্ধির জন্য অপ্টিমাইজড ক্যাম্পেইন।",
            },
            {
              key: "lead_generation",
              name: "হাই-কনভার্সন লিড জেনারেশন (Instant Form)",
              objective: "OUTCOME_LEADS",
              description: "ফেসবুক ও ইনস্টাগ্রাম ইনস্ট্যান্ট ফর্মের মাধ্যমে জেনুইন কাস্টমার লিড সংগ্রহ।",
            },
            {
              key: "messenger_chat",
              name: "ইনবক্স মেসেজিং ও বিক্রয় ক্লোজিং (Chat Ads)",
              objective: "OUTCOME_ENGAGEMENT",
              description: "সরাসরি ইনবক্স ও হোয়াটসঅ্যাপে চ্যাট শুরু করে বিক্রয় সম্পন্ন করার ফানেল।",
            },
            {
              key: "website_traffic",
              name: "হাই-ভলিউম ওয়েবসাইট ট্র্যাফিক (Landing Page Views)",
              objective: "OUTCOME_TRAFFIC",
              description: "কম খরচে ওয়েবসাইটের ল্যান্ডিং পেজে আগ্রহী ভিজিটর ও রিডাইরেকশন আনা।",
            },
            {
              key: "advantage_plus_sales",
              name: "Meta Advantage+ শপিং ক্যাম্পেইন (AI Catalog)",
              objective: "OUTCOME_SALES",
              advantagePlus: true,
              description: "মেটার কৃত্রিম বুদ্ধিমত্তা চালিত স্বয়ংক্রিয় অডিয়েন্স ও বাজেট স্কেলিং।",
            },
          ]);
        });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load campaigns");
    }
  }, [selectedAccountId]);

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

  // Action handlers
  async function submitForApproval(planId: string, name: string) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const res = await wrap(`submit-${planId}`, () =>
      apiFetch(`/organizations/${orgId}/campaign-plans/${planId}/submit`, { method: "POST" })
    );
    if (res) {
      setNotice(`"${name}" ক্যাম্পেইন অনুমোদনের জন্য জমা দেওয়া হয়েছে!`);
      await load();
    }
  }

  async function approvePlan(planId: string, name: string) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const res = await wrap(`approve-${planId}`, () =>
      apiFetch(`/organizations/${orgId}/campaign-plans/${planId}/approve`, { method: "POST" })
    );
    if (res) {
      setNotice(`"${name}" সফলভাবে অনুমোদন করা হয়েছে — এখন Meta তে Publish করা যাবে।`);
      await load();
    }
  }

  async function confirmReject() {
    if (!rejectPlanId) return;
    const orgId = getOrganizationId();
    if (!orgId) return;
    const res = await wrap(`reject-${rejectPlanId}`, () =>
      apiFetch(`/organizations/${orgId}/campaign-plans/${rejectPlanId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: rejectReason.trim() || "রিভিউতে পরিবর্তন প্রয়োজন" }),
      })
    );
    if (res) {
      setNotice("ক্যাম্পেইনটি প্রত্যাখ্যান করা হয়েছে এবং কারণ সংরক্ষণ করা হয়েছে।");
      setRejectPlanId(null);
      setRejectReason("");
      await load();
    }
  }

  async function publishPlan(planId: string, name: string) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const res = await wrap(`publish-${planId}`, () =>
      apiFetch(`/organizations/${orgId}/campaign-plans/${planId}/publish`, { method: "POST" })
    );
    if (res) {
      setNotice(`"${name}" সফলভাবে Meta তে Publish হয়েছে! (নিরাপত্তার জন্য Meta তে PAUSED অবস্থায় আছে)`);
      await load();
    }
  }

  async function toggleMetaStatus(p: Plan) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const nextStatus = p.metaStatus === "ACTIVE" ? "pause" : "activate";
    const res = await wrap(`meta-toggle-${p.id}`, () =>
      apiFetch(`/organizations/${orgId}/campaign-plans/${p.id}/${nextStatus}`, { method: "POST" })
    );
    if (res) {
      setNotice(`ক্যাম্পেইন "${p.name}" Meta তে ${nextStatus === "activate" ? "ACTIVE" : "PAUSED"} করা হয়েছে!`);
      await load();
    }
  }

  async function duplicatePlan(p: Plan) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const res = await wrap(`dup-${p.id}`, () =>
      apiFetch(`/organizations/${orgId}/campaign-plans/${p.id}/duplicate`, {
        method: "POST",
        body: JSON.stringify({ name: `${p.name} (কপি)` }),
      })
    );
    if (res) {
      setNotice(`"${p.name}" এর নতুন খসড়া কপি তৈরি হয়েছে!`);
      await load();
    }
  }

  async function deletePlan(p: Plan) {
    if (!confirm(`আপনি কি নিশ্চিত যে "${p.name}" ক্যাম্পেইন মুছে ফেলতে চান?`)) return;
    const orgId = getOrganizationId();
    if (!orgId) return;
    const res = await wrap(`del-${p.id}`, () =>
      apiFetch(`/organizations/${orgId}/campaign-plans/${p.id}`, { method: "DELETE" })
    );
    if (res) {
      setNotice(`"${p.name}" ক্যাম্পেইন মুছে ফেলা হয়েছে।`);
      await load();
    }
  }

  async function instantiateBlueprint() {
    if (!instantiateBp || !selectedAccountId) {
      setError("অনুগ্রহ করে একটি Meta Ad Account বেছে নিন");
      return;
    }
    const orgId = getOrganizationId();
    if (!orgId) return;
    const res = await wrap(`instantiate-${instantiateBp.key}`, () =>
      apiFetch<{ id: string }>(`/organizations/${orgId}/campaign-plans/blueprints/instantiate`, {
        method: "POST",
        body: JSON.stringify({
          blueprintKey: instantiateBp.key,
          adAccountId: selectedAccountId,
        }),
      })
    );
    if (res && res.id) {
      setNotice(`ব্লুপ্রিন্ট থেকে ক্যাম্পেইন তৈরি হয়েছে!`);
      setInstantiateBp(null);
      router.push(`/dashboard/campaign-builder?id=${res.id}`);
    }
  }

  // Computed Summaries
  const totalCount = plans.length;
  const liveCount = useMemo(() => plans.filter((p) => p.status === "published" && p.metaStatus === "ACTIVE").length, [plans]);
  const pendingCount = useMemo(() => plans.filter((p) => p.status === "pending_approval").length, [plans]);
  const approvedCount = useMemo(() => plans.filter((p) => p.status === "approved").length, [plans]);
  const totalAdSets = useMemo(() => plans.reduce((acc, p) => acc + (p.adSetCount || 0), 0), [plans]);

  // Filtered Plans
  const filteredPlans = useMemo(() => {
    return plans.filter((p) => {
      // Tab specific filter
      if (activeTab === "live" && p.status !== "published") return false;
      if (activeTab === "approval" && p.status !== "pending_approval") return false;

      // Status Filter
      if (statusFilter !== "all" && p.status !== statusFilter) return false;

      // Objective Filter
      if (objectiveFilter !== "all" && p.objective !== objectiveFilter) return false;

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = p.name.toLowerCase().includes(q);
        const matchObj = p.objective.toLowerCase().includes(q);
        const matchExt = p.externalCampaignId?.toLowerCase().includes(q);
        if (!matchName && !matchObj && !matchExt) return false;
      }
      return true;
    });
  }, [plans, activeTab, statusFilter, objectiveFilter, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">ক্যাম্পেইন হাব (Campaigns)</h1>
          <p className="text-sm text-slate-500">
            বিজ্ঞাপন তৈরি, অনুমোদন পাইপলাইন এবং Meta তে প্রকাশিত ক্যাম্পেইনের রিয়েল-টাইম লাইভ নিয়ন্ত্রণ।
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/campaign-builder"
            className="btn-primary font-semibold flex items-center gap-1.5"
          >
            <span>+ নতুন Campaign তৈরি করুন</span>
          </Link>
        </div>
      </div>

      {/* Global Alerts */}
      {error && (
        <div className="flex items-center justify-between rounded-xl bg-red-50 p-4 text-sm text-red-700 border border-red-200 shadow-sm">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
          <button onClick={() => setError("")} className="text-xs text-red-500 hover:text-red-700">✕ বন্ধ</button>
        </div>
      )}

      {notice && (
        <div className="flex items-center justify-between rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 border border-emerald-200 shadow-sm">
          <div className="flex items-center gap-2">
            <span>✓</span>
            <span>{notice}</span>
          </div>
          <button onClick={() => setNotice("")} className="text-xs text-emerald-600 hover:text-emerald-800">✕ বন্ধ</button>
        </div>
      )}

      {/* Top Metric Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Metric 1 */}
        <div className="card p-4 flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">মোট ক্যাম্পেইন</span>
            <div className="text-2xl font-bold text-slate-900">{totalCount}</div>
            <div className="text-[11px] text-slate-400">মোট {totalAdSets}টি Ad Set সক্রিয়</div>
          </div>
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-xl text-brand-600">
            📢
          </span>
        </div>

        {/* Metric 2 */}
        <div className="card p-4 flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Meta তে Active</span>
            <div className="text-2xl font-bold text-emerald-600">
              {liveCount} <span className="text-xs font-normal text-slate-400">/ {plans.filter(p => p.status === "published").length} প্রকাশিত</span>
            </div>
            <div className="text-[11px] text-emerald-700 font-medium">লাইভ ট্র্যাফিক ও কনভার্সন চালু</div>
          </div>
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-xl text-emerald-600">
            🟢
          </span>
        </div>

        {/* Metric 3 */}
        <div className="card p-4 flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">অনুমোদনের অপেক্ষায়</span>
            <div className="text-2xl font-bold text-amber-600">{pendingCount}</div>
            <div className="text-[11px] text-slate-400">
              {approvedCount > 0 ? `${approvedCount}টি অনুমোদিত ও পাবলিশের জন্য প্রস্তুত` : "রিভিউ পেন্ডিং"}
            </div>
          </div>
          <span className={`flex h-12 w-12 items-center justify-center rounded-2xl text-xl ${pendingCount > 0 ? "bg-amber-100 text-amber-700 animate-pulse" : "bg-slate-100 text-slate-600"}`}>
            ⏳
          </span>
        </div>

        {/* Metric 4 */}
        <div className="card p-4 flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Campaign Builder</span>
            <div className="text-base font-bold text-slate-800">Advantage+ & AI</div>
            <Link href="/dashboard/campaign-builder" className="text-xs text-brand-600 hover:underline font-medium">
              বিল্ডারে নতুন প্ল্যান বানান →
            </Link>
          </div>
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-xl text-indigo-600">
            🛠️
          </span>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-slate-200">
        <div className="flex gap-2 overflow-x-auto pb-1 text-sm">
          <button
            type="button"
            onClick={() => setActiveTab("all")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-semibold transition ${
              activeTab === "all"
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <span>📋</span>
            <span>সব ক্যাম্পেইন</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 font-bold">{plans.length}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("live")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-semibold transition ${
              activeTab === "live"
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <span>🚀</span>
            <span>Meta লাইভ হাব</span>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 font-bold">
              {plans.filter((p) => p.status === "published").length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("approval")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-semibold transition ${
              activeTab === "approval"
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <span>⏳</span>
            <span>অনুমোদন কিউ (Approval)</span>
            {pendingCount > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 font-bold animate-pulse">
                {pendingCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("blueprints")}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-semibold transition ${
              activeTab === "blueprints"
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <span>💡</span>
            <span>রেডিমেড স্ট্র্যাটেজি ব্লুপ্রিন্ট</span>
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700 font-bold">
              {blueprints.length}
            </span>
          </button>
        </div>
      </div>

      {/* ============================================================== */}
      {/* TABS 1, 2, 3: CAMPAIGNS LISTING VIEW                           */}
      {/* ============================================================== */}
      {activeTab !== "blueprints" && (
        <div className="space-y-4">
          {/* Search & Filters Card */}
          <div className="card p-4 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {/* Search input */}
              <div className="relative flex-1 max-w-md">
                <input
                  type="text"
                  placeholder="ক্যাম্পেইনের নাম, অবজেক্টিভ বা আইডি দিয়ে খুঁজুন..."
                  className="input !py-2 !pr-4 w-full text-sm rounded-xl"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {/* Objective Selector */}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="input !py-1.5 text-xs"
                  value={objectiveFilter}
                  onChange={(e) => setObjectiveFilter(e.target.value)}
                >
                  <option value="all">সব অবজেক্টিভ (All Objectives)</option>
                  {Object.entries(CAMPAIGN_OBJECTIVES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.icon} {v.label}
                    </option>
                  ))}
                </select>

                {activeTab === "all" && (
                  <select
                    className="input !py-1.5 text-xs"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="all">সব স্ট্যাটাস (All Status)</option>
                    {Object.entries(CAMPAIGN_STATUS_META).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.icon} {v.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* Quick Filter Pills (for tab 'all') */}
            {activeTab === "all" && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs pt-1 border-t border-slate-100">
                <span className="text-xs font-semibold text-slate-400 mr-1">স্ট্যাটাস:</span>
                {[
                  { id: "all", label: "সব", count: plans.length },
                  { id: "draft", label: "Draft", count: plans.filter((p) => p.status === "draft").length },
                  {
                    id: "pending_approval",
                    label: "অনুমোদনের অপেক্ষায়",
                    count: plans.filter((p) => p.status === "pending_approval").length,
                  },
                  { id: "approved", label: "অনুমোদিত", count: plans.filter((p) => p.status === "approved").length },
                  {
                    id: "published",
                    label: "প্রকাশিত/লাইভ",
                    count: plans.filter((p) => p.status === "published").length,
                  },
                  {
                    id: "rejected",
                    label: "প্রত্যাখ্যাত",
                    count: plans.filter((p) => p.status === "rejected").length,
                  },
                ].map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStatusFilter(s.id)}
                    className={`rounded-lg px-2.5 py-1 transition ${
                      statusFilter === s.id
                        ? "bg-brand-600 text-white font-semibold"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    <span>{s.label}</span>
                    <span className="text-[10px] opacity-75 font-mono ml-1">({s.count})</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Campaign Cards List */}
          {filteredPlans.length === 0 ? (
            <div className="card p-8">
              <EmptyState
                title="কোনো ক্যাম্পেইন পাওয়া যায়নি"
                description={
                  activeTab === "approval"
                    ? "অনুমোদনের অপেক্ষায় কোনো ক্যাম্পেইন নেই। সব ক্যাম্পেইন যথারীতি প্রসেস হয়েছে।"
                    : activeTab === "live"
                      ? "Meta তে এখনো কোনো প্রকাশিত বা লাইভ ক্যাম্পেইন নেই।"
                      : "আপনার ফিল্টারের সাথে মিলে এমন কোনো ক্যাম্পেইন পাওয়া যায়নি।"
                }
                actionLabel="+ নতুন Campaign তৈরি করুন"
                onAction={() => router.push("/dashboard/campaign-builder")}
              />
            </div>
          ) : (
            <div className="space-y-3">
              {filteredPlans.map((p) => {
                const sMeta = getCampaignStatusBadge(p.status);
                const oMeta = getCampaignObjectiveMeta(p.objective);
                const isMetaLive = p.status === "published" && p.metaStatus === "ACTIVE";

                return (
                  <div
                    key={p.id}
                    className="card p-4 hover:border-slate-300 transition-all flex flex-col justify-between gap-3 lg:flex-row lg:items-center"
                  >
                    <div className="space-y-2 flex-1 min-w-0">
                      {/* Top Badges */}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${sMeta.badgeCls}`}>
                          <span>{sMeta.icon}</span>
                          <span>{sMeta.label}</span>
                        </span>

                        {p.status === "published" && (
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-bold border ${
                              isMetaLive
                                ? "bg-emerald-500 text-white border-emerald-600"
                                : "bg-amber-100 text-amber-800 border-amber-300"
                            }`}
                          >
                            Meta: {p.metaStatus ?? "PAUSED"}
                          </span>
                        )}

                        <span className="badge badge-brand text-[11px] font-medium">
                          {oMeta.icon} {oMeta.label}
                        </span>

                        {p.externalCampaignId && (
                          <span className="badge badge-slate text-[10px] font-mono">
                            Meta ID: {p.externalCampaignId}
                          </span>
                        )}
                      </div>

                      {/* Name & details */}
                      <div>
                        <Link
                          href={`/dashboard/campaign-builder?id=${p.id}`}
                          className="font-bold text-slate-900 text-base hover:text-brand-600 transition"
                        >
                          {p.name}
                        </Link>
                        <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
                          <span>
                            Ad Sets: <strong className="text-slate-700">{p.adSetCount}টি</strong>
                          </span>
                          <span>
                            আপডেট: <strong className="text-slate-700">{new Date(p.updatedAt).toLocaleString()}</strong>
                          </span>
                        </div>
                      </div>

                      {/* Rejection reason if any */}
                      {p.rejectionReason && (
                        <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700 border border-rose-100">
                          ⚠️ প্রত্যাখ্যানের কারণ: <strong>{p.rejectionReason}</strong>
                        </div>
                      )}
                    </div>

                    {/* Action Controls */}
                    <div className="flex flex-wrap items-center gap-2 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-100 shrink-0">
                      {/* Meta Status Toggle (Published only) */}
                      {p.status === "published" && (
                        <button
                          type="button"
                          className={`btn-sm font-semibold flex items-center gap-1.5 transition ${
                            isMetaLive
                              ? "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100"
                              : "btn-primary"
                          }`}
                          disabled={busy === `meta-toggle-${p.id}`}
                          onClick={() => toggleMetaStatus(p)}
                        >
                          <span>{isMetaLive ? "⏸️ Pause করুন" : "▶️ Active করুন"}</span>
                        </button>
                      )}

                      {/* Submit for approval (Draft) */}
                      {p.status === "draft" && (
                        <button
                          type="button"
                          className="btn-primary btn-sm font-semibold"
                          disabled={busy === `submit-${p.id}`}
                          onClick={() => submitForApproval(p.id, p.name)}
                          title="ক্যাম্পেইনটি অ্যাডমিন বা ওনারের অনুমোদনের জন্য পাঠান"
                        >
                          অনুমোদনের জন্য পাঠান
                        </button>
                      )}

                      {/* Approval Buttons (Pending Approval) */}
                      {p.status === "pending_approval" && (
                        <>
                          <button
                            type="button"
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 transition"
                            disabled={busy === `approve-${p.id}`}
                            onClick={() => approvePlan(p.id, p.name)}
                          >
                            ✓ অনুমোদন করুন
                          </button>
                          <button
                            type="button"
                            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition"
                            onClick={() => setRejectPlanId(p.id)}
                          >
                            ✕ প্রত্যাখ্যান
                          </button>
                        </>
                      )}

                      {/* Publish to Meta Button (Approved or Failed) */}
                      {(p.status === "approved" || p.status === "publish_failed") && (
                        <button
                          type="button"
                          className="btn-primary btn-sm font-semibold flex items-center gap-1"
                          disabled={busy === `publish-${p.id}`}
                          onClick={() => publishPlan(p.id, p.name)}
                        >
                          <span>🚀 Meta তে Publish</span>
                        </button>
                      )}

                      {/* Link to Campaign Builder */}
                      <Link
                        href={`/dashboard/campaign-builder?id=${p.id}`}
                        className="btn-secondary btn-sm font-semibold"
                      >
                        বিল্ডারে এডিট
                      </Link>

                      {/* Duplicate button */}
                      <button
                        type="button"
                        className="rounded-lg p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition"
                        disabled={busy === `dup-${p.id}`}
                        onClick={() => duplicatePlan(p)}
                        title="কপি তৈরি করুন (Duplicate)"
                      >
                        📋
                      </button>

                      {/* Delete button (non-published only) */}
                      {p.status !== "published" && (
                        <button
                          type="button"
                          className="rounded-lg p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                          disabled={busy === `del-${p.id}`}
                          onClick={() => deletePlan(p)}
                          title="ক্যাম্পেইন মুছে ফেলুন"
                        >
                          🗑️
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 4: CAMPAIGN BLUEPRINTS & STARTER TEMPLATES                 */}
      {/* ============================================================== */}
      {activeTab === "blueprints" && (
        <div className="space-y-6">
          <div className="card p-5 sm:p-6 space-y-3">
            <h2 className="text-xl font-bold text-slate-900">💡 রেডিমেড মার্কেটিং ক্যাম্পেইন ব্লুপ্রিন্ট</h2>
            <p className="text-sm text-slate-500">
              অভিজ্ঞ মার্কেটারদের তৈরি হাই-কনভার্টিং ক্যাম্পেইন স্ট্র্যাটেজি — ১-ক্লিকে আপনার পছন্দের Meta Ad Account-এ লোড করুন এবং বিল্ডারে কাস্টমাইজ করুন।
            </p>
          </div>

          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {blueprints.map((bp) => {
              const oMeta = getCampaignObjectiveMeta(bp.objective);
              return (
                <div
                  key={bp.key}
                  className="card card-hover p-5 border border-slate-200 flex flex-col justify-between hover:shadow-md transition-all"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="badge badge-brand text-[11px]">
                        {oMeta.icon} {oMeta.label}
                      </span>
                      {bp.advantagePlus && (
                        <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-800">
                          Advantage+ AI
                        </span>
                      )}
                    </div>

                    <h3 className="text-base font-bold text-slate-900">{bp.name}</h3>
                    <p className="text-xs text-slate-600 leading-relaxed">{bp.description ?? oMeta.description}</p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      className="btn-primary btn-sm w-full font-semibold"
                      onClick={() => setInstantiateBp(bp)}
                    >
                      🛠️ এই Blueprint দিয়ে শুরু করুন
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Rejection Modal */}
      {rejectPlanId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900">ক্যাম্পেইন প্রত্যাখ্যানের কারণ</h3>
            <p className="text-xs text-slate-500">
              কী কারণে ক্যাম্পেইনটি প্রত্যাখ্যান করা হচ্ছে তা উল্লেখ করুন যাতে বিজ্ঞাপন নির্মাতা তা সংশোধন করতে পারে।
            </p>
            <textarea
              className="input w-full text-sm"
              rows={3}
              placeholder="যেমন: ক্রিয়েটিভের কপি সংশোধন করতে হবে, বাজেট দৈনিক ১,০০০ টাকার নিচে নামানো যাবে না..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => {
                  setRejectPlanId(null);
                  setRejectReason("");
                }}
              >
                বাতিল
              </button>
              <button
                type="button"
                className="btn-primary btn-sm bg-rose-600 hover:bg-rose-700"
                onClick={confirmReject}
              >
                প্রত্যাখ্যান নিশ্চিত করুন
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Blueprint Instantiate Modal */}
      {instantiateBp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <div>
              <h3 className="text-lg font-bold text-slate-900">ব্লুপ্রিন্ট শুরু করুন</h3>
              <p className="text-xs text-slate-500">"{instantiateBp.name}" এর জন্য Meta Ad Account নির্বাচন করুন।</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Meta Ad Account</label>
              {accounts.length === 0 ? (
                <p className="text-xs text-rose-600 bg-rose-50 p-2 rounded-lg">
                  কোনো Meta Ad Account যুক্ত নেই। অনুগ্রহ করে Integrations এ গিয়ে একটি Ad Account যুক্ত করুন।
                </p>
              ) : (
                <select
                  className="input w-full text-sm"
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.platform})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setInstantiateBp(null)}
              >
                বাতিল
              </button>
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={!selectedAccountId || busy.startsWith("instantiate-")}
                onClick={instantiateBlueprint}
              >
                তৈরি ও বিল্ডারে যান
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
