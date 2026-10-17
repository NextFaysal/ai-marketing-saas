"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { asList } from "@/lib/as-list";
import { getOrganizationId } from "@/lib/org";
import { EmptyState } from "@repo/ui";
import { monthGrid, planCalendarDate, sameDay } from "@/lib/campaign-cn10";
import { fmtMoneyBn, fmtNumBn } from "@/lib/money-bn";
import { relTimeBn } from "@/lib/rel-time-bn";
import { layerSourceViews, type AudienceSourceEntry } from "@/lib/funnel-sources";
import {
  CAMPAIGN_STATUS_META,
  CAMPAIGN_OBJECTIVES,
  getCampaignStatusBadge,
  getCampaignObjectiveMeta,
} from "@/lib/campaign-status";
import { AbTestHub } from "./ab-test-hub";
import { GrowthCopilotHub } from "./components/GrowthCopilotHub";
import { FestivalPlaybookHub } from "./festival-playbook-hub";

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
  publishAt?: string | null;
  publishedAt?: string | null;
  // NB7 CN16: series instances carry their series marker.
  seriesId?: string | null;
  seriesInstanceDate?: string | null;
  // CN10/CN11 hub: platform metrics from the paged list payload.
  // null = no external campaign (honest "no data"), never zeros.
  performance?: {
    spendMinor: string; impressions: number; clicks: number;
    conversions: number; ctrPercent: number | null; cpaMinor: string | null;
  } | null;
  updatedAt: string;
  createdAt: string;
}

interface SavedView { id: string; name: string; filters: { statusFilter?: string; objectiveFilter?: string; searchQuery?: string; activeTab?: string } }

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

// Campaign Builder Frontier NB7 (CN16): recurring-series
// view + funnel-wizard layer result, as the API returns them.
interface SeriesRow {
  id: string;
  name: string;
  cadence: string;
  interval?: number | null;
  leadDays?: number | null;
  status: string;
  sourcePlanId: string;
  sourcePlanName?: string | null;
  sourcePlanStatus?: string | null;
  pendingPlan: { id: string; name: string; status: string } | null;
  nextInstanceDate?: string | null;
  generationHeld?: boolean;
}
interface FunnelResult {
  plan: { id: string; name: string };
  layers: { layer: string; status: string; adSetId?: string; reason?: string; usedSources?: string[]; missingSources?: string[] }[];
}
const SERIES_CADENCE_LABEL: Record<string, string> = { weekly: "সাপ্তাহিক", monthly: "মাসিক", dates: "তারিখের তালিকা" };

type TabKey = "all" | "live" | "approval" | "blueprints" | "ab_tests" | "copilot" | "festivals";

// DX2 hub views (separate from the TabKey status tabs, which
// stay inside the Plans view exactly as before).
type HubView = "plans" | "calendar" | "portfolio";

// DX2 week-summary aggregate (GET campaign-plans/week-summary)
// — the "এই সপ্তাহে" strip's single data source.
interface WeekSummary {
  label: string;
  windowDays: number;
  spendByCurrency: { currency: string; thisWeekMinor: string; prevWeekMinor: string }[];
  recommendations: { total: number; plansChecked: number; publishedPlans: number; topPlan: { planId: string; name: string; count: number } | null };
  fatigue: { total: number; topPlan: { planId: string; name: string; count: number } | null };
  offlineLoop: { configured: boolean; lastSuccessAt: string | null; lastSuccessPlatform: string | null; failedLast7Days: number };
}

export default function CampaignsPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [hubView, setHubView] = useState<HubView>("plans");

  // DX2: week strip + resume drafts — independent loads; a
  // failure here must never take the rest of the hub down.
  const [weekSummary, setWeekSummary] = useState<WeekSummary | null>(null);
  const [weekLoading, setWeekLoading] = useState(true);
  const [weekFailed, setWeekFailed] = useState(false);
  const [resumeDrafts, setResumeDrafts] = useState<Plan[]>([]);

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

  // Campaign Builder Next CN10: server pagination + bulk +
  // saved views + launch calendar state.
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkReport, setBulkReport] = useState("");
  const [bulkPct, setBulkPct] = useState("10");
  // Campaign Builder Advanced CA11: the multi-plan budget
  // allocator (proposal first, human-confirmed apply second).
  const [allocOpen, setAllocOpen] = useState(false);
  const [allocTotal, setAllocTotal] = useState("5000");
  const [allocProposal, setAllocProposal] = useState<any>(null);
  const [allocResult, setAllocResult] = useState<any>(null);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [calCursor, setCalCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });

  // Campaign Builder Frontier NB7 (CN16): recurring series
  // (org-wide list) + the full-funnel wizard form/result.
  const [seriesHub, setSeriesHub] = useState<SeriesRow[]>([]);
  const [showFunnel, setShowFunnel] = useState(false);
  const emptyFunnelForm = { name: "", adAccountId: "", objective: "OUTCOME_SALES", pageId: "", pixelId: "", primaryText: "", headline: "", linkUrl: "", callToAction: "SHOP_NOW", budgetMode: "abo", campaignDailyBudget: "", dailyBudgetCap: "", proDaily: "", proCountries: "BD", ageMin: "", ageMax: "", useRetargeting: false, reDaily: "", useRetention: false, rnDaily: "", catalogRecordId: "", productSetId: "" };
  const [funnelForm, setFunnelForm] = useState(emptyFunnelForm);
  const [funnelResult, setFunnelResult] = useState<FunnelResult | null>(null);
  // DX3 🚩 mini-fix: the wizard's layer source counts
  // (org-level CN6 catalogue, loaded when the wizard
  // opens — see the effect below).
  const [funnelSources, setFunnelSources] = useState<AudienceSourceEntry[] | null>(null);
  const [funnelSourcesFailed, setFunnelSourcesFailed] = useState(false);

  // Campaign Builder Frontier NB8 (CN18): the budget
  // simulator (own-data only) + the competitor-response
  // draft form/result.
  const [simForm, setSimForm] = useState({ objective: "OUTCOME_SALES", dailyBudget: "1000", days: "30" });
  const [simResult, setSimResult] = useState<any>(null);
  // CA22 (CB5): builder inbox — signals + counter-drafts.
  type InboxSignal = { id: string; source: string; text: string; productId: string | null; status: string; draftPlanId: string | null; createdAt: string };
  type ImportableRow = { source: string; sourceRefId: string; competitorName: string | null; label: string };
  const [inbox, setInbox] = useState<{ note: string; signals: InboxSignal[]; importable: { insights: ImportableRow[]; prices: ImportableRow[]; ads: ImportableRow[] } } | null>(null);
  const [signalText, setSignalText] = useState("");
  const [draftBudget, setDraftBudget] = useState("1000");
  const [draftAccount, setDraftAccount] = useState("");
  const [respForm, setRespForm] = useState({ competitorId: "", productId: "", adAccountId: "" });
  const [respLists, setRespLists] = useState<{ competitors: { id: string; name: string }[]; products: { id: string; name: string }[] } | null>(null);
  const [respResult, setRespResult] = useState<any>(null);

  // Blueprint Instantiate Modal
  const [instantiateBp, setInstantiateBp] = useState<Blueprint | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  // Campaign Builder Next CN8: cross-account portfolio totals
  // (additive strip; the hub redesign + pagination are CN10).
  const [portfolio, setPortfolio] = useState<{ accounts: { adAccountId: string; name: string; platform: string | null; currency: string; spendMinor: string; impressions: number; clicks: number; conversions: number; cpaMinor: string | null }[]; totalByCurrency: { currency: string; spendMinor: string; impressions: number; clicks: number; conversions: number }[] } | null>(null);

  const PAGE_SIZE = 20;

  // CN10: the plan list is server-paginated. Filters/search are
  // server params now (status/objective/q) — the tab maps onto
  // the same status param. The base path literal stays bare and
  // the query string is concatenated, exactly like the API's
  // "any hub param switches to the paged envelope" contract.
  const loadPlans = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setListLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), includePerformance: "true" });
      const statusParam = activeTab === "live" ? "published" : activeTab === "approval" ? "pending_approval" : statusFilter !== "all" ? statusFilter : "";
      if (statusParam) params.set("status", statusParam);
      if (objectiveFilter !== "all") params.set("objective", objectiveFilter);
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      const qs = params.toString();
      const res = await apiFetch<{ items: Plan[]; total: number; page: number; pageSize: number }>(`/organizations/${orgId}/campaign-plans` + (qs ? `?${qs}` : ""));
      setPlans(res.items ?? []);
      setTotal(res.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load campaigns");
    } finally {
      setListLoading(false);
    }
  }, [page, activeTab, statusFilter, objectiveFilter, searchQuery]);

  // CA22 (CB5): builder inbox load + actions.
  const loadInbox = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const res = await apiFetch<typeof inbox>(`/organizations/${orgId}/campaign-plans/builder-inbox`).catch(() => null);
    if (res) setInbox(res);
  }, []);
  useEffect(() => { void loadInbox(); }, [loadInbox]);
  const inboxAction = async (key: string, fn: () => Promise<unknown>, okMsg: string) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(key); setError(""); setNotice("");
    try {
      await fn();
      setNotice(okMsg);
      await loadInbox();
    } catch (e) {
      setError(e instanceof Error ? e.message : "কাজটি সম্পন্ন হয়নি");
    } finally { setBusy(""); }
  };

  // Accounts / blueprints / portfolio / saved views load once —
  // they are not part of the paged plan flow.
  const loadMeta = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const accList = await apiFetch<AdAccount[]>(`/organizations/${orgId}/ad-accounts`).catch(() => [] as AdAccount[]);
      setAccounts(accList.filter((a) => a.platform === "meta"));
      apiFetch<typeof portfolio>(`/organizations/${orgId}/campaign-plans/portfolio/totals`).then(setPortfolio).catch(() => setPortfolio(null));
      apiFetch<SavedView[]>(`/organizations/${orgId}/campaign-plans/saved-views/list`).then((r) => setSavedViews(Array.isArray(r) ? r : [])).catch(() => undefined);
      apiFetch<SeriesRow[]>(`/organizations/${orgId}/campaign-plans/series/list`).then((r) => setSeriesHub(Array.isArray(r) ? r : [])).catch(() => undefined);
      if (accList.length > 0 && !selectedAccountId) {
        const metaAcc = accList.find((a) => a.platform === "meta");
        if (metaAcc) setSelectedAccountId(metaAcc.id);
      }
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
    } catch { /* meta lists are optional for the hub */ }
  }, [selectedAccountId]);

  useEffect(() => { loadMeta(); }, [loadMeta]);

  useEffect(() => {
    const t = setTimeout(() => { void loadPlans(); }, 250);
    return () => clearTimeout(t);
  }, [loadPlans]);

  const load = loadPlans;

  // DX2: the "এই সপ্তাহে" strip aggregate. Kept fully
  // independent of loadPlans/loadMeta — on failure the strip
  // shows its own slim error row and the hub keeps working.
  const loadWeekSummary = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setWeekLoading(false); return; }
    setWeekLoading(true);
    setWeekFailed(false);
    try {
      const res = await apiFetch<WeekSummary>(`/organizations/${orgId}/campaign-plans/week-summary`);
      setWeekSummary(res);
    } catch {
      setWeekFailed(true);
    } finally {
      setWeekLoading(false);
    }
  }, []);

  useEffect(() => { void loadWeekSummary(); }, [loadWeekSummary]);

  // DX2 resume ("অসমাপ্ত কাজ"): ONE fetch of the newest Draft
  // plans via the existing paged list endpoint (the server
  // orders updatedAt desc). Silent on failure and when empty —
  // the card simply does not render.
  useEffect(() => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    apiFetch<{ items: Plan[]; total: number }>(`/organizations/${orgId}/campaign-plans?page=1&pageSize=3&status=draft`)
      .then((r) => setResumeDrafts(Array.isArray(r?.items) ? r.items.slice(0, 3) : []))
      .catch(() => undefined);
  }, []);

  // DX3 🚩 mini-fix: the funnel wizard's layer source
  // counts, fetched when the wizard opens (the org-level
  // catalogue — the same counts the Audience Studio
  // shows, before any plan exists). Fully independent:
  // on failure the wizard shows ONE honest unavailable
  // line and submits exactly as before.
  useEffect(() => {
    if (!showFunnel) return;
    const orgId = getOrganizationId();
    if (!orgId) return;
    let live = true;
    setFunnelSourcesFailed(false);
    apiFetch<{ available: boolean; sources: AudienceSourceEntry[] }>(`/organizations/${orgId}/campaign-plans/audience-sources`)
      .then((r) => { if (live) setFunnelSources(Array.isArray(r?.sources) ? r.sources : []); })
      .catch(() => { if (live) { setFunnelSources(null); setFunnelSourcesFailed(true); } });
    return () => { live = false; };
  }, [showFunnel]);


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
      apiFetch<{ approvalState?: { twoStep: boolean; step: number; awaitingSecond: boolean } }>(`/organizations/${orgId}/campaign-plans/${planId}/approve`, { method: "POST" })
    );
    if (res) {
      if (res.approvalState?.awaitingSecond) setNotice(`"${name}" — প্রথম অনুমোদন সম্পন্ন — দ্বিতীয় অনুমোদন বাকি (অন্য একজন Approver লাগবে)।`);
      else setNotice(`"${name}" সফলভাবে অনুমোদন করা হয়েছে — এখন Meta তে Publish করা যাবে।`);
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

  // NB7 CN16: series pause/resume/end from the hub card —
  // existing instance drafts are never touched by the API.
  async function hubSeriesAction(s: SeriesRow, act: "pause" | "resume" | "end") {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const res = await wrap(`series-${act}-${s.id}`, () =>
      apiFetch<SeriesRow>(`/organizations/${orgId}/campaign-plans/series/${s.id}`, { method: "PATCH", body: JSON.stringify({ action: act }) })
    );
    if (res) {
      setSeriesHub((list) => list.map((x) => (x.id === s.id ? res : x)));
      setNotice(`Series "${res.name}" — ${act === "pause" ? "বিরতি দেওয়া হয়েছে" : act === "resume" ? "আবার সক্রিয় হয়েছে" : "শেষ করা হয়েছে"}।`);
    }
  }

  // NB7 CN16: the full-funnel wizard — ONE plan with labelled
  // prospecting/retargeting/retention layers. The API reports
  // each layer's fate (complete/incomplete/failed + reason);
  // the result renders verbatim, nothing is hidden.
  async function submitFunnel() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const f = funnelForm;
    const adAccountId = f.adAccountId || selectedAccountId;
    if (!f.name.trim() || !adAccountId || !f.primaryText.trim() || !f.linkUrl.trim() || !f.proDaily.trim()) {
      setError("নাম, Ad Account, Primary Text, Link URL ও Prospecting দৈনিক বাজেট লাগবে");
      return;
    }
    const res = await wrap("funnel-create", () =>
      apiFetch<FunnelResult>(`/organizations/${orgId}/campaign-plans/funnel-plans`, {
        method: "POST",
        body: JSON.stringify({
          name: f.name.trim(),
          adAccountId,
          objective: f.objective,
          budgetMode: f.budgetMode,
          campaignDailyBudget: f.campaignDailyBudget || undefined,
          dailyBudgetCap: f.dailyBudgetCap || undefined,
          pageId: f.pageId || undefined,
          pixelId: f.pixelId || undefined,
          primaryText: f.primaryText,
          headline: f.headline || undefined,
          linkUrl: f.linkUrl,
          callToAction: f.callToAction || undefined,
          prospecting: {
            dailyBudget: f.proDaily,
            countries: f.proCountries.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean),
            ageMin: f.ageMin ? Number(f.ageMin) : undefined,
            ageMax: f.ageMax ? Number(f.ageMax) : undefined,
          },
          retargeting: f.useRetargeting ? { dailyBudget: f.reDaily } : null,
          retention: f.useRetention ? { dailyBudget: f.rnDaily, catalogRecordId: f.catalogRecordId || undefined, productSetId: f.productSetId || undefined } : null,
        }),
      })
    );
    if (res) {
      setFunnelResult(res);
      setNotice(`Full-funnel Plan তৈরি হয়েছে: "${res.plan.name}" (Draft) — Layer ফলাফল Wizard-এ দেখুন।`);
      await load();
    }
  }

  // DX3 🚩 mini-fix: one layer's source counts at
  // selection time (under its checkbox in the form).
  // Loaded → a line per source: real count in bn-BD; a
  // real zero is the §5 amber empty state; a source that
  // could not be gathered says so. Still loading → one
  // muted line. Fetch failed → nothing here (the wizard
  // shows ONE unavailable line above the form instead).
  const funnelSourceLines = (layer: "retargeting" | "retention") => {
    if (funnelSourcesFailed) return null;
    if (!funnelSources) return <p className="text-xs leading-[1.7] text-slate-500">Audience Source-এর সংখ্যা লোড হচ্ছে…</p>;
    return (
      <div className="space-y-0.5">
        {layerSourceViews(funnelSources, layer).map((v) => (
          <p key={v.key} className={`text-xs leading-[1.7] ${v.state === "empty" ? "font-medium text-amber-700" : "text-slate-600"}`}>
            {v.state === "empty" ? "⚠ " : ""}{v.text}
          </p>
        ))}
      </div>
    );
  };

  // Computed Summaries
  const totalCount = total;
  const liveCount = useMemo(() => plans.filter((p) => p.status === "published" && p.metaStatus === "ACTIVE").length, [plans]);
  const pendingCount = useMemo(() => plans.filter((p) => p.status === "pending_approval").length, [plans]);
  const approvedCount = useMemo(() => plans.filter((p) => p.status === "approved").length, [plans]);
  const totalAdSets = useMemo(() => plans.reduce((acc, p) => acc + (p.adSetCount || 0), 0), [plans]);

  // Filtered Plans — filtering/search now happen on the server
  // (see loadPlans); the loaded page IS the filtered result.
  const filteredPlans = plans;

  // CN10 bulk actions: status-sync has no bulk endpoint and
  // stays a sequential client loop with a truthful tally.
  const toggleSelect = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  async function bulkRun(kind: "status-sync") {
    const orgId = getOrganizationId();
    if (!orgId || selected.length === 0) return;
    const names = new Map(plans.map((p) => [p.id, p.name]));
    let ok = 0;
    const failed: string[] = [];
    setBusy(`bulk-${kind}`);
    setError("");
    for (const id of selected) {
      try {
        await apiFetch(`/organizations/${orgId}/campaign-plans/${id}/status-sync`, { method: "POST" });
        ok++;
      } catch { failed.push(names.get(id) ?? id); }
    }
    setBusy("");
    setBulkReport(`Status Sync: ${ok}টি সফল${failed.length ? ` · ${failed.length}টি ব্যর্থ: ${failed.join(", ")}` : ""}`);
    setSelected(failed.map((n) => plans.find((p) => p.name === n)?.id ?? "").filter(Boolean));
    await load();
  }

  // CA14: pause/activate/budget/duplicate run through the
  // SERVER bulk endpoint — one call, per-item results back;
  // the tally shown is the server's own (partial failure is
  // never dressed up as full success).
  async function bulkServer(action: "pause" | "activate" | "budget_percent" | "duplicate") {
    const orgId = getOrganizationId();
    if (!orgId || selected.length === 0) return;
    const names = new Map(plans.map((p) => [p.id, p.name]));
    const labels: Record<string, string> = { pause: "Pause", activate: "সক্রিয়", budget_percent: "বাজেট %", duplicate: "কপি" };
    if (action === "pause" && !window.confirm(`${selected.length}টি Plan Meta-তে Pause হবে। নিশ্চিত?`)) return;
    if (action === "activate" && !window.confirm(`${selected.length}টি Plan Meta-তে সক্রিয় হবে — খরচ শুরু হতে পারে। নিশ্চিত?`)) return;
    if (action === "budget_percent" && !window.confirm(`${selected.length}টি Plan-এর লাইভ Ad Set বাজেট ${bulkPct}% বদলাবে (Meta-তে)। নিশ্চিত?`)) return;
    setBusy(`bulk-${action}`);
    setError("");
    try {
      const res = await apiFetch<{ results: { planId: string; ok: boolean; error?: string }[]; succeeded: number; failed: number }>(`/organizations/${orgId}/campaign-plans/bulk`, {
        method: "POST",
        body: JSON.stringify({ planIds: selected, action, percent: action === "budget_percent" ? Number(bulkPct) : undefined }),
      });
      const failedLines = res.results.filter((r) => !r.ok).map((r) => `${names.get(r.planId) ?? r.planId} (${r.error ?? "ব্যর্থ"})`);
      setBulkReport(`${labels[action]}: ${res.succeeded}টি সফল${res.failed ? ` · ${res.failed}টি ব্যর্থ: ${failedLines.join(", ")}` : ""}`);
      setSelected(res.results.filter((r) => !r.ok).map((r) => r.planId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk action ব্যর্থ হয়েছে");
    }
    setBusy("");
    await load();
  }

  // CA11 allocator: proposal from stored rows (applies
  // NOTHING), then a separate confirmed apply.
  async function allocPropose() {
    const orgId = getOrganizationId();
    if (!orgId || selected.length === 0) return;
    const totalMinor = Math.round(Number(allocTotal) * 100);
    if (!Number.isFinite(totalMinor) || totalMinor <= 0) { setError("মোট অতিরিক্ত দৈনিক বাজেট একটি ধনাত্মক সংখ্যা হতে হবে"); return; }
    setAllocResult(null);
    const res = await wrap("alloc-propose", () => apiFetch<any>(`/organizations/${orgId}/campaign-plans/budget-allocator/proposal`, { method: "POST", body: JSON.stringify({ planIds: selected, totalShiftMinor: String(totalMinor) }) }));
    if (res) setAllocProposal(res);
  }
  async function allocApply() {
    const orgId = getOrganizationId();
    if (!orgId || !allocProposal) return;
    if (!confirm(`Allocator প্রস্তাব প্রয়োগ করবেন? ${allocProposal.allocations.length}টি Plan-এর দৈনিক বাজেট মোট ${fmtMoneyBn(allocProposal.allocatedMinor)} বাড়বে — Meta-তে সত্যিই বদলাবে।`)) return;
    const res = await wrap("alloc-apply", () => apiFetch<any>(`/organizations/${orgId}/campaign-plans/budget-allocator/apply`, {
      method: "POST",
      body: JSON.stringify({ allocations: allocProposal.allocations.map((a: any) => ({ planId: a.planId, amountMinor: a.amountMinor, expectedDailyTotalMinor: a.currentDailyTotalMinor })) }),
    }));
    if (res) {
      setAllocResult(res);
      setAllocProposal(null);
      setNotice(`Allocator: ${res.appliedCount}টি Plan-এ বাজেট বেড়েছে${res.failedCount ? ` · ${res.failedCount}টি হয়নি (নিচে কারণসহ)` : ""}`);
      await load();
    }
  }

  // CN10 saved views (CN11 API): the hub filter state, verbatim.
  async function saveCurrentView() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const name = window.prompt("Saved View এর নাম লিখুন:");
    if (!name?.trim()) return;
    const res = await wrap("save-view", () => apiFetch<SavedView>(`/organizations/${orgId}/campaign-plans/saved-views`, { method: "POST", body: JSON.stringify({ name: name.trim(), filters: { statusFilter, objectiveFilter, searchQuery, activeTab } }) }));
    if (res) {
      setSavedViews((v) => [res, ...v]);
      setNotice(`Saved View "${res.name}" সেভ হয়েছে।`);
    }
  }
  function applyView(v: SavedView) {
    setHubView("plans");
    const f = v.filters ?? {};
    setStatusFilter(f.statusFilter ?? "all");
    setObjectiveFilter(f.objectiveFilter ?? "all");
    setSearchQuery(f.searchQuery ?? "");
    if (f.activeTab === "all" || f.activeTab === "live" || f.activeTab === "approval" || f.activeTab === "blueprints" || f.activeTab === "ab_tests") setActiveTab(f.activeTab);
    setPage(1);
  }
  async function deleteView(v: SavedView) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const res = await wrap(`del-view-${v.id}`, () => apiFetch(`/organizations/${orgId}/campaign-plans/saved-views/${v.id}`, { method: "DELETE" }));
    if (res) setSavedViews((list) => list.filter((x) => x.id !== v.id));
  }

  // CN10 launch calendar: PLAN-LEVEL dates only, from the loaded
  // page rows (publishedAt → publishAt → createdAt). The hub never
  // fetches plan details, and the list payload has no ad-set
  // flight windows — so no ad-set rows are shown or invented.
  const calCells = monthGrid(calCursor.getFullYear(), calCursor.getMonth());
  const calItems = useMemo(() => {
    const map = new Map<string, { display: string; kind: string }[]>();
    for (const p of plans) {
      const cd = planCalendarDate(p);
      if (!cd || Number.isNaN(cd.date.getTime())) continue;
      const key = `${cd.date.getFullYear()}-${cd.date.getMonth()}-${cd.date.getDate()}`;
      map.set(key, [...(map.get(key) ?? []), { display: `${p.seriesId ? "🔁 " : ""}${p.name}`, kind: cd.kind }]);
    }
    // NB7 CN16: each ACTIVE series' next instance date also
    // lands on the calendar as a purple series chip.
    for (const s of seriesHub) {
      if (s.status !== "active" || !s.nextInstanceDate) continue;
      const d = new Date(s.nextInstanceDate);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      map.set(key, [...(map.get(key) ?? []), { display: `🔁 ${s.name} (পরের Instance)`, kind: "series" }]);
    }
    return map;
  }, [plans, seriesHub]);
  const calMonthCount = useMemo(() => {
    const planCount = plans.filter((p) => { const cd = planCalendarDate(p); return cd && cd.date.getFullYear() === calCursor.getFullYear() && cd.date.getMonth() === calCursor.getMonth(); }).length;
    const seriesCount = seriesHub.filter((s) => { if (s.status !== "active" || !s.nextInstanceDate) return false; const d = new Date(s.nextInstanceDate); return !Number.isNaN(d.getTime()) && d.getFullYear() === calCursor.getFullYear() && d.getMonth() === calCursor.getMonth(); }).length;
    return planCount + seriesCount;
  }, [plans, seriesHub, calCursor]);

  // DX2 week strip helpers — same minor/100 + bn-BD money
  // style as the rest of this page. The % change is computed
  // from the two real figures only; a zero previous week
  // returns null (the card says so in words, never a fake %).
  const fmtMinor = (minor: string) => (Number(BigInt(minor)) / 100).toLocaleString("bn-BD", { minimumFractionDigits: 2 });
  const weekChange = (thisMinor: string, prevMinor: string): { arrow: string; pct: string } | null => {
    const prev = Number(BigInt(prevMinor));
    if (prev === 0) return null;
    const cur = Number(BigInt(thisMinor));
    const pct = ((cur - prev) / prev) * 100;
    return { arrow: pct > 0 ? "▲" : pct < 0 ? "▼" : "—", pct: Math.abs(pct).toLocaleString("bn-BD", { maximumFractionDigits: 1 }) };
  };

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
          <button
            type="button"
            className="btn-secondary font-semibold flex items-center gap-1.5"
            onClick={() => { setFunnelResult(null); setFunnelForm((f) => ({ ...f, adAccountId: f.adAccountId || selectedAccountId })); setShowFunnel(true); }}
          >
            <span>🧭 Full-funnel Wizard</span>
          </button>
          <Link
            href="/dashboard/campaign-builder"
            className="btn-primary font-semibold flex items-center gap-1.5"
          >
            <span>+ নতুন Campaign তৈরি করুন</span>
          </Link>
        </div>
      </div>

      {/* DX2 (J2): "এই সপ্তাহে" strip — owner decision: ON TOP of the hub, above every view */}
      <section aria-label="এই সপ্তাহে" className="space-y-2">
        <h2 className="text-sm font-bold text-slate-900">📅 এই সপ্তাহে</h2>
        {weekFailed ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span aria-hidden>⚠️</span>
            <span className="leading-[1.7]">সাপ্তাহিক সারাংশ লোড হয়নি</span>
            <button type="button" className="btn-secondary btn-sm min-h-[40px] font-semibold" onClick={() => { void loadWeekSummary(); }}>আবার চেষ্টা করুন</button>
          </div>
        ) : weekLoading || !weekSummary ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="h-3 w-24 rounded bg-slate-200" />
                <div className="mt-3 h-6 w-32 rounded bg-slate-200" />
                <div className="mt-2 h-3 w-40 rounded bg-slate-100" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">💰 খরচ (শেষ ৭ দিন)</p>
              {weekSummary.spendByCurrency.length === 0 ? (
                <p className="mt-2 text-sm leading-[1.7] text-slate-500">এই সপ্তাহে কোনো খরচের ডেটা নেই — Synced Campaign Row পাওয়া যায়নি।</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {weekSummary.spendByCurrency.map((c) => {
                    const ch = weekChange(c.thisWeekMinor, c.prevWeekMinor);
                    return (
                      <div key={c.currency}>
                        <div className="text-lg font-bold text-slate-900">{fmtMinor(c.thisWeekMinor)} <span className="text-xs font-semibold text-slate-500">{c.currency}</span></div>
                        <p className="text-xs leading-[1.7] text-slate-500">আগের সপ্তাহ: {fmtMinor(c.prevWeekMinor)} {c.currency}{ch ? <> · <span className="font-semibold text-slate-700">{ch.arrow} {ch.pct}%</span></> : <> · আগের সপ্তাহে খরচ ছিল না</>}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">💡 সুপারিশ (CN7)</p>
              <div className="mt-2 text-2xl font-bold text-slate-900">{weekSummary.recommendations.total.toLocaleString("bn-BD")}টি</div>
              <p className="text-xs leading-[1.7] text-slate-500">{weekSummary.recommendations.plansChecked.toLocaleString("bn-BD")}টি Published Plan যাচাই করা হয়েছে</p>
              {weekSummary.recommendations.topPlan ? (
                <Link href={`/dashboard/campaign-builder?id=${weekSummary.recommendations.topPlan.planId}`} className="mt-1 block min-h-[40px] text-sm font-medium leading-[1.7] text-brand-600 hover:underline">সবচেয়ে বেশি: {weekSummary.recommendations.topPlan.name} ({weekSummary.recommendations.topPlan.count.toLocaleString("bn-BD")}টি) →</Link>
              ) : (
                <p className="mt-1 text-xs leading-[1.7] text-slate-400">কোনো Plan-এ সুপারিশ নেই।</p>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">🎨 Creative Fatigue</p>
              <div className="mt-2 text-2xl font-bold text-slate-900">{weekSummary.fatigue.total.toLocaleString("bn-BD")}টি</div>
              {weekSummary.fatigue.topPlan ? (
                <Link href={`/dashboard/campaign-builder?id=${weekSummary.fatigue.topPlan.planId}`} className="mt-1 block min-h-[40px] text-sm font-medium leading-[1.7] text-brand-600 hover:underline">সবচেয়ে বেশি: {weekSummary.fatigue.topPlan.name} ({weekSummary.fatigue.topPlan.count.toLocaleString("bn-BD")}টি) →</Link>
              ) : (
                <p className="mt-1 text-xs leading-[1.7] text-slate-400">কোনো Creative-এ Fatigue ধরা পড়েনি।</p>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">🔁 Conversion Loop (CN14)</p>
              {!weekSummary.offlineLoop.configured ? (
                <>
                  <p className="mt-2 flex items-start gap-2 text-sm leading-[1.7] text-slate-600"><span aria-hidden>🔌</span><span>Offline Conversion সেটআপ হয়নি</span></p>
                  <Link href="/dashboard/ad-accounts" className="btn-secondary btn-sm mt-2 inline-flex min-h-[40px] items-center font-semibold">সেটআপ করুন</Link>
                </>
              ) : (
                <Link href="/dashboard/ad-accounts" className="mt-2 block min-h-[40px]">
                  {weekSummary.offlineLoop.lastSuccessAt ? (
                    <p className="text-sm leading-[1.7] text-slate-700">সর্বশেষ সফল Upload: {new Date(weekSummary.offlineLoop.lastSuccessAt).toLocaleString("bn-BD")}{weekSummary.offlineLoop.lastSuccessPlatform ? ` (${weekSummary.offlineLoop.lastSuccessPlatform})` : ""}</p>
                  ) : (
                    <p className="text-sm leading-[1.7] text-slate-500">এখনো কোনো সফল Upload নেই</p>
                  )}
                  {weekSummary.offlineLoop.failedLast7Days > 0 ? (
                    <span className="mt-1 inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">শেষ ৭ দিনে {weekSummary.offlineLoop.failedLast7Days.toLocaleString("bn-BD")}টি Upload ব্যর্থ</span>
                  ) : null}
                </Link>
              )}
            </div>
          </div>
        )}
      </section>

      {/* DX2 hub views — the TabKey status tabs stay inside the Plans view below */}
      <div className="flex gap-2 overflow-x-auto border-b border-slate-200" role="tablist" aria-label="Campaign Hub Views">
        {([
          { key: "plans", label: "📋 পরিকল্পনা" },
          { key: "calendar", label: "📅 ক্যালেন্ডার" },
          { key: "portfolio", label: "💼 পোর্টফোলিও" },
        ] as { key: HubView; label: string }[]).map((v) => (
          <button key={v.key} type="button" role="tab" aria-selected={hubView === v.key} onClick={() => setHubView(v.key)} className={`min-h-[44px] whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition ${hubView === v.key ? "border-brand-600 text-brand-600" : "border-transparent text-slate-600 hover:text-slate-900"}`}>{v.label}</button>
        ))}
      </div>

      {hubView === "plans" && (
        <>
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
        <div role="status" className="flex items-center justify-between rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 border border-emerald-200 shadow-sm">
          <div className="flex items-center gap-2">
            <span>✓</span>
            <span>{notice}</span>
          </div>
          <button onClick={() => setNotice("")} className="text-xs text-emerald-600 hover:text-emerald-800">✕ বন্ধ</button>
        </div>
      )}

      {/* DX2: "অসমাপ্ত কাজ" resume card — newest Draft plans; renders nothing when there are none */}
      {resumeDrafts.length > 0 ? (
        <div className="card space-y-3 p-4">
          <h3 className="text-sm font-bold text-slate-900">✏️ অসমাপ্ত কাজ</h3>
          <div className="space-y-2">
            {resumeDrafts.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-800">{p.name}</div>
                  <div className="text-xs leading-[1.7] text-slate-500">আপডেট: <span title={new Date(p.updatedAt).toLocaleString("bn-BD")}>{relTimeBn(p.updatedAt)}</span> · Ad Sets: {p.adSetCount}টি</div>
                </div>
                <Link href={`/dashboard/campaign-builder?id=${p.id}`} className="btn-secondary btn-sm inline-flex min-h-[40px] items-center font-semibold">চালিয়ে যান →</Link>
              </div>
            ))}
          </div>
        </div>
      ) : null}

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
            onClick={() => { setActiveTab("all"); setPage(1); }}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-semibold transition ${
              activeTab === "all"
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <span>📋</span>
            <span>সব ক্যাম্পেইন</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 font-bold">{total}</span>
          </button>

          <button
            type="button"
            onClick={() => { setActiveTab("live"); setPage(1); }}
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
            onClick={() => { setActiveTab("approval"); setPage(1); }}
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
            onClick={() => { setActiveTab("blueprints"); setPage(1); }}
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

          <button
            type="button"
            onClick={() => { setActiveTab("ab_tests"); setPage(1); }}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-semibold transition ${
              activeTab === "ab_tests"
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <span>⚖️</span>
            <span>অটো A/B টেস্টিং ও উইনার</span>
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 font-bold">
              AI
            </span>
          </button>

          <button
            type="button"
            onClick={() => { setActiveTab("copilot"); setPage(1); }}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-semibold transition ${
              activeTab === "copilot"
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <span>🤖</span>
            <span>AI Growth Copilot</span>
            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700 font-bold">
              সক্রিয়
            </span>
          </button>

          <button
            type="button"
            onClick={() => { setActiveTab("festivals"); setPage(1); }}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-semibold transition ${
              activeTab === "festivals"
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            <span>🎉</span>
            <span>উৎসব ও ফ্ল্যাশ-সেল প্লেবুক</span>
            <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-700 font-bold">
              BD Special
            </span>
          </button>
        </div>
      </div>

      {/* ============================================================== */}
      {/* TABS 1, 2, 3: CAMPAIGNS LISTING VIEW                           */}
      {/* ============================================================== */}
      {activeTab !== "blueprints" && activeTab !== "ab_tests" && activeTab !== "copilot" && activeTab !== "festivals" && (
        <div className="space-y-4">
          {/* Search & Filters Card — Design Round 2: sticky on
              desktop so the working controls stay reachable on
              long lists (not sticky on mobile: the card is tall
              and would eat the small viewport). */}
          <div className="card p-4 space-y-3 lg:sticky lg:top-2 lg:z-30">
            {/* CN10: saved views (CN11 API) — the current filter state, restorable in one click */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">Saved Views:</span>
              {savedViews.map((v) => (
                <span key={v.id} className="cbx-view-chip">
                  <button type="button" onClick={() => applyView(v)}>{v.name}</button>
                  <button type="button" className="cbx-view-chip-del" title="View মুছুন" disabled={busy !== ""} onClick={() => deleteView(v)}>✕</button>
                </span>
              ))}
              {savedViews.length === 0 ? <span className="text-xs text-slate-400">কোনো Saved View নেই — বর্তমান ফিল্টার সেভ করে রাখুন।</span> : null}
              <button type="button" className="btn-secondary btn-sm" disabled={busy !== ""} onClick={saveCurrentView}>💾 বর্তমান View সেভ করুন</button>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {/* Search input */}
              <div className="relative flex-1 max-w-md">
                <input
                  type="text"
                  placeholder="ক্যাম্পেইনের নাম, অবজেক্টিভ বা আইডি দিয়ে খুঁজুন..."
                  className="input !py-2 !pr-4 w-full text-sm rounded-xl"
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                />
              </div>

              {/* Objective Selector */}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="input !py-1.5 text-xs"
                  value={objectiveFilter}
                  onChange={(e) => { setObjectiveFilter(e.target.value); setPage(1); }}
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
                    onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
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
                    onClick={() => { setStatusFilter(s.id); setPage(1); }}
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

          {/* CN10 bulk bar — শুধু বিদ্যমান endpoint-এর action (duplicate / status-sync) */}
          {selected.length > 0 && (
            <div className="cbx-rail flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-800">{selected.length}টি Campaign বাছাই করা হয়েছে</span>
              <button type="button" className="btn-secondary btn-sm font-semibold" disabled={busy !== ""} onClick={() => bulkServer("duplicate")}>📋 সবগুলোর কপি (Duplicate)</button>
              <button type="button" className="btn-secondary btn-sm font-semibold" disabled={busy !== ""} onClick={() => bulkServer("pause")}>⏸ সব Pause</button>
              <button type="button" className="btn-secondary btn-sm font-semibold" disabled={busy !== ""} onClick={() => bulkServer("activate")}>▶ সব সক্রিয়</button>
              <span className="flex items-center gap-1">
                <input className="w-16 rounded-lg border px-2 py-1 text-sm" value={bulkPct} onChange={(e) => setBulkPct(e.target.value)} aria-label="বাজেট শতাংশ" />
                <button type="button" className="btn-secondary btn-sm font-semibold" disabled={busy !== ""} onClick={() => bulkServer("budget_percent")}>💰 বাজেট % প্রয়োগ</button>
              </span>
              <button type="button" className="btn-secondary btn-sm font-semibold" disabled={busy !== ""} onClick={() => bulkRun("status-sync")}>🔄 Status Sync</button>
              <button type="button" className="btn-secondary btn-sm font-semibold" disabled={busy !== ""} onClick={() => { setAllocOpen((o) => !o); setAllocProposal(null); setAllocResult(null); }}>💰 বাজেট Allocator</button>
              <button type="button" className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => { setSelected([]); setBulkReport(""); }}>বাছাই পরিষ্কার করুন</button>
              {bulkReport ? <span className="text-xs font-medium text-slate-600">{bulkReport}</span> : null}
            </div>
          )}

          {/* CA11 allocator panel — proposal first, confirmed apply second */}
          {allocOpen && selected.length > 0 && (
            <div className="card mt-3 border-violet-200 bg-violet-50/60 p-4">
              <p className="text-sm font-bold text-slate-900">💰 বাজেট Allocator — বাছাই করা {selected.length}টি Plan-এ অতিরিক্ত দৈনিক বাজেট বণ্টন</p>
              <p className="mt-0.5 text-xs text-slate-600">হিসাব গত ৩০ দিনের আসল Spend/Conversion থেকে: Median CPA-র চেয়ে খারাপ CPA-র Plan বাদ, ওজন = Conversion সংখ্যা, Plan প্রতি সর্বোচ্চ বৃদ্ধি = তার বর্তমান দৈনিক মোট বাজেট। প্রস্তাব নিজে থেকে কিছুই বদলায় না — প্রয়োগ আলাদা নিশ্চিতকরণে।</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="text-xs font-semibold text-slate-700">মোট অতিরিক্ত দৈনিক বাজেট (৳)</label>
                <input className="input w-40" type="number" min="1" value={allocTotal} onChange={(e) => setAllocTotal(e.target.value)} />
                <button type="button" className="btn-primary btn-sm font-semibold" disabled={busy !== ""} onClick={allocPropose}>প্রস্তাব দেখুন</button>
              </div>
              {allocProposal ? (
                <div className="mt-3 space-y-2 text-sm">
                  {allocProposal.allocations.length === 0 ? <p className="text-xs text-slate-600">কোনো Plan-এ বণ্টন হয়নি — নিচে প্রতিটি বাদ পড়া Plan-এর কারণ দেখুন।</p> : allocProposal.allocations.map((a: any) => (
                    <div key={a.planId} className="flex flex-wrap items-center gap-x-3 rounded-lg bg-white/80 px-3 py-2 text-xs text-slate-700">
                      <b className="text-slate-900">{a.name}</b>
                      <span>+{fmtMoneyBn(a.amountMinor)}/দিন</span>
                      <span>দৈনিক মোট: {fmtMoneyBn(a.currentDailyTotalMinor)} → {fmtMoneyBn(a.newDailyTotalMinor)}</span>
                      <span>লক্ষ্য Ad Set: {a.targetAdSetName} ({a.targetBasis === "lowest_cpa" ? "সেরা CPA" : "সবচেয়ে বড় বাজেট"})</span>
                      <span>প্রমাণ: খরচ {fmtMoneyBn(a.evidence.spendMinor)} · {fmtNumBn(a.evidence.conversions)} conv · CPA {a.evidence.cpaMinor ? fmtMoneyBn(a.evidence.cpaMinor) : "—"}</span>
                    </div>
                  ))}
                  {allocProposal.excluded.map((x: any) => (
                    <p key={x.planId} className="text-xs text-slate-500">বাদ: <b>{x.name ?? x.planId}</b> — {
                      x.reason === "no_evidence" ? "গত ৩০ দিনে কোনো Conversion প্রমাণ নেই" :
                      x.reason === "below_efficiency" ? `CPA Median-এর চেয়ে খারাপ (CPA ${x.evidence?.cpaMinor ? fmtMoneyBn(x.evidence.cpaMinor) : "—"})` :
                      x.reason === "cbo_no_live_budget_path" ? "CBO Plan — Campaign-level বাজেটের Live Edit পথ নেই" :
                      x.reason === "not_published" ? "Published নয়" :
                      x.reason === "no_daily_budget" ? "Live দৈনিক বাজেট নেই" :
                      x.reason === "cap_reached_by_others" ? "অন্য Plan-দের Cap-এ বণ্টন শেষ" :
                      x.reason}</p>
                  ))}
                  <p className="text-xs font-medium text-slate-700">বণ্টন হয়েছে {fmtMoneyBn(allocProposal.allocatedMinor)} · বণ্টন হয়নি {fmtMoneyBn(allocProposal.unallocatedMinor)}</p>
                  {allocProposal.allocations.length > 0 ? (
                    <button type="button" className="btn-primary btn-sm font-semibold" disabled={busy !== ""} onClick={allocApply}>নিশ্চিত — প্রস্তাব প্রয়োগ করুন (Meta-তে বদলাবে)</button>
                  ) : null}
                </div>
              ) : null}
              {allocResult ? (
                <div className="mt-3 space-y-1 text-xs">
                  {allocResult.results.map((r: any) => (
                    <p key={r.planId} className={r.ok ? "text-emerald-800" : "text-rose-700"}>
                      {r.ok ? `✓ ${plans.find((p) => p.id === r.planId)?.name ?? r.planId}: ${fmtMoneyBn(r.beforeDailyMinor)} → ${fmtMoneyBn(r.afterDailyMinor)} (${r.targetAdSetId})${r.verified ? " · যাচাই হয়েছে" : " · যাচাই মেলেনি"}` : `✗ ${plans.find((p) => p.id === r.planId)?.name ?? r.planId}: হয়নি — ${r.error}${r.currentDailyTotalMinor ? ` (বর্তমান দৈনিক মোট ${fmtMoneyBn(r.currentDailyTotalMinor)})` : ""}`}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {/* Campaign Cards List */}
          {listLoading && filteredPlans.length === 0 ? (
            <div className="space-y-3" aria-hidden>
              {[0, 1, 2].map((i) => (
                <div key={i} className="animate-pulse card p-4">
                  <div className="flex flex-wrap gap-2">
                    <div className="h-5 w-24 rounded-full bg-slate-200" />
                    <div className="h-5 w-32 rounded-full bg-slate-100" />
                  </div>
                  <div className="mt-3 h-4 w-2/3 rounded bg-slate-200" />
                  <div className="mt-2 h-3 w-1/2 rounded bg-slate-100" />
                </div>
              ))}
            </div>
          ) : filteredPlans.length === 0 ? (
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
            <div key={`${activeTab}-${statusFilter}-${objectiveFilter}-${page}`} className="r2-step-enter space-y-3">
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
                        <input type="checkbox" className="h-5 w-5 shrink-0 accent-indigo-600" checked={selected.includes(p.id)} onChange={() => toggleSelect(p.id)} aria-label={`${p.name} বেছে নিন`} />
                        <span className={`cbx-pill cbx-pill-${p.status} inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${sMeta.badgeCls}`}>
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
                            আপডেট: <strong className="text-slate-700" title={new Date(p.updatedAt).toLocaleString("bn-BD")}>{relTimeBn(p.updatedAt)}</strong>
                          </span>
                        </div>
                      </div>

                      {/* CN10: platform metrics from the list payload (null = no data, never fake zeros) */}
                      {p.performance === null ? (
                        <div className="text-xs text-slate-400">📊 প্ল্যাটফর্ম মেট্রিক্স: ডেটা নেই — এই Plan এর কোনো Meta Campaign নেই।</div>
                      ) : p.performance ? (
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                          <span>খরচ: <b>{fmtMoneyBn(p.performance.spendMinor)}</b></span>
                          <span>Impressions: <b>{fmtNumBn(p.performance.impressions)}</b></span>
                          <span>Clicks: <b>{fmtNumBn(p.performance.clicks)}</b></span>
                          <span>CTR: <b>{p.performance.ctrPercent ?? "—"}%</b></span>
                          <span>Conversions: <b>{p.performance.conversions}</b></span>
                          <span>CPA: <b>{p.performance.cpaMinor ? fmtMoneyBn(p.performance.cpaMinor) : "—"}</b></span>
                        </div>
                      ) : null}

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

          {/* CN10: server pagination controls — total সার্ভার থেকে আসে */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="text-xs font-medium text-slate-500">মোট {total}টি Campaign · পৃষ্ঠা {page} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
            <div className="flex items-center gap-2">
              <button type="button" className="btn-secondary btn-sm font-semibold" disabled={listLoading || page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>← আগের পৃষ্ঠা</button>
              <button type="button" className="btn-secondary btn-sm font-semibold" disabled={listLoading || page >= Math.max(1, Math.ceil(total / PAGE_SIZE))} onClick={() => setPage((p) => p + 1)}>পরের পৃষ্ঠা →</button>
            </div>
          </div>

          {/* NB7 CN16: recurring series — org-wide list with pause/resume/end */}
          <div className="card p-4 space-y-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">🔁 Recurring Series</h3>
              <p className="text-xs text-slate-400">Series তার Source Plan থেকে নিয়মিত Draft Instance তৈরি করে — প্রতিটি Instance আলাদাভাবে Approval Flow দিয়ে যায়, কিছুই নিজে থেকে Publish হয় না। নতুন Series তৈরি হয় Builder-এ Source Plan খুলে "🔁 Series" বোতামে।</p>
            </div>
            {seriesHub.length === 0 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-3">
                <span aria-hidden>🔁</span>
                <p className="text-sm leading-[1.7] text-slate-500">এখনো কোনো Series নেই।</p>
                <Link href="/dashboard/campaign-builder" className="inline-flex min-h-[40px] items-center text-sm font-medium text-brand-600 hover:underline">Builder-এ গিয়ে Source Plan থেকে Series তৈরি করুন →</Link>
              </div>
            ) : (
              <div className="space-y-2">
                {seriesHub.map((s) => (
                  <div key={s.id} className="flex flex-col justify-between gap-2 rounded-lg bg-slate-50 p-3 lg:flex-row lg:items-center">
                    <div className="space-y-0.5 text-sm">
                      <div className="font-medium text-slate-800">{s.name} <span className={`ml-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${s.status === "active" ? "bg-green-100 text-green-700" : s.status === "paused" ? "bg-amber-100 text-amber-700" : "bg-slate-200 text-slate-600"}`}>{s.status === "active" ? "সক্রিয়" : s.status === "paused" ? "বিরতি" : "শেষ"}</span></div>
                      <div className="text-xs text-slate-500">Source Plan: {s.sourcePlanName ?? "—"} · Cadence: {SERIES_CADENCE_LABEL[s.cadence] ?? s.cadence}{s.cadence !== "dates" && s.interval ? ` (প্রতি ${s.interval})` : ""} · পরের Instance: {s.nextInstanceDate ? new Date(s.nextInstanceDate).toLocaleString("bn-BD") : "—"}{s.pendingPlan ? ` · Pending Instance: ${s.pendingPlan.name} (${s.pendingPlan.status})` : ""}</div>
                      {s.generationHeld ? <p className="text-xs font-medium text-amber-700">আগের Instance Draft-এ আছে — সেটি Approval Flow-তে গেলেই পরেরটি তৈরি হবে</p> : null}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {s.status === "active" ? <button type="button" className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => hubSeriesAction(s, "pause")}>⏸ Pause</button> : null}
                      {s.status === "paused" ? <button type="button" className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => hubSeriesAction(s, "resume")}>▶ Resume</button> : null}
                      {s.status !== "ended" ? <button type="button" className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => hubSeriesAction(s, "end")}>⏹ End</button> : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
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
        {/* CA22 (CB5): Builder Inbox — signals -> counter-drafts */}
        <div className="card mt-4 p-4">
          <h3 className="text-sm font-bold text-slate-900">📥 Builder Inbox — প্রতিযোগীর সিগন্যাল → জবাবি Draft (CA22)</h3>
          <p className="mt-1 text-xs leading-[1.7] text-slate-500">{inbox?.note ?? "সিগন্যাল মানে একটি পর্যবেক্ষণ — Manual এন্ট্রি অথবা সংরক্ষিত Competitor রেকর্ড থেকে Import। প্রতিটি সিগন্যাল থেকে শুধু একটি DRAFT তৈরি হয় — কখনো Publish হয় না। স্বয়ংক্রিয় Competitor Feed NOT BUILT (Smart AI C1–C2 ধারায় আছে)।"}</p>
          <div className="mt-3 flex flex-wrap items-start gap-2">
            <textarea className="input min-h-[44px] flex-1 text-sm" maxLength={500} placeholder="যেমন: প্রতিযোগী X এই অফার দিচ্ছে — পাঞ্জাবিতে ৩০% ছাড়" value={signalText} onChange={(e) => setSignalText(e.target.value)} aria-label="নতুন সিগন্যাল" />
            <button type="button" className="btn-primary btn-sm font-semibold" disabled={busy !== "" || signalText.trim().length < 3} onClick={() => {
              const orgId = getOrganizationId(); if (!orgId) return;
              void inboxAction("signal-add", () => apiFetch(`/organizations/${orgId}/campaign-plans/builder-inbox`, { method: "POST", body: JSON.stringify({ text: signalText.trim() }) }), "সিগন্যাল যোগ হয়েছে").then(() => setSignalText(""));
            }}>+ সিগন্যাল যোগ করুন</button>
          </div>
          {inbox && (inbox.importable.insights.length + inbox.importable.prices.length + inbox.importable.ads.length) > 0 ? (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-bold text-slate-700">সংরক্ষিত Competitor রেকর্ড থেকে Import (আসল ডেটা — Creative টেক্সট কপি হয় না):</p>
              <div className="mt-2 grid gap-1">
                {[...inbox.importable.insights, ...inbox.importable.prices, ...inbox.importable.ads].map((r) => (
                  <div key={`${r.source}:${r.sourceRefId}`} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                    <span>🏷️ {r.competitorName ?? "প্রতিযোগী"} — {r.label} <span className="text-slate-400">({r.source === "competitor_insight" ? "Insight" : r.source === "competitor_price" ? "Price" : "দীর্ঘমেয়াদি বিজ্ঞাপন"})</span></span>
                    <button type="button" className="btn-secondary btn-sm font-semibold" disabled={busy !== ""} onClick={() => {
                      const orgId = getOrganizationId(); if (!orgId) return;
                      void inboxAction(`imp-${r.sourceRefId}`, () => apiFetch(`/organizations/${orgId}/campaign-plans/builder-inbox/import`, { method: "POST", body: JSON.stringify({ source: r.source, sourceRefId: r.sourceRefId }) }), "সিগন্যাল Import হয়েছে");
                    }}>Inbox-এ আনুন</button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="mt-3 grid gap-2">
            {(inbox?.signals ?? []).length === 0 ? <p className="text-xs text-slate-400">কোনো সিগন্যাল নেই — উপরে Manual এন্ট্রি দিন অথবা সংরক্ষিত Competitor রেকর্ড Import করুন।</p> : null}
            {(inbox?.signals ?? []).map((s) => (
              <div key={s.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`rounded-full px-2 py-0.5 font-bold ${s.status === "new" ? "bg-amber-100 text-amber-800" : s.status === "drafted" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>{s.status === "new" ? "নতুন" : s.status === "drafted" ? "Draft তৈরি" : "Dismissed"}</span>
                  <span className="text-slate-400">{s.source === "manual" ? "Manual" : s.source === "competitor_insight" ? "Competitor Insight" : s.source === "competitor_price" ? "Competitor Price" : "Competitor Ad"} · {new Date(s.createdAt).toLocaleDateString("bn-BD")}</span>
                  {s.productId ? <span className="text-slate-400">· Product যুক্ত আছে</span> : null}
                </div>
                <p className="mt-1 leading-[1.7] text-slate-700">{s.text}</p>
                {s.status === "drafted" ? <p className="mt-1 text-xs text-emerald-700">✅ Draft Plan তৈরি হয়েছে (ID: {s.draftPlanId}) — Campaign Builder-এ খুলে যাচাই করুন; Publish হয়নি।</p> : null}
                {s.status === "new" ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select className="input w-auto text-xs" value={draftAccount} onChange={(e) => setDraftAccount(e.target.value)} aria-label="Ad Account">
                      <option value="">Ad Account বাছুন…</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    <input className="input w-28 text-xs" inputMode="decimal" value={draftBudget} onChange={(e) => setDraftBudget(e.target.value)} aria-label="দৈনিক বাজেট (টাকা)" placeholder="দৈনিক ৳" />
                    <button type="button" className="btn-primary btn-sm font-semibold" disabled={busy !== "" || !draftAccount} onClick={() => {
                      const orgId = getOrganizationId(); if (!orgId) return;
                      void inboxAction(`draft-${s.id}`, () => apiFetch(`/organizations/${orgId}/campaign-plans/builder-inbox/${s.id}/draft`, { method: "POST", body: JSON.stringify({ adAccountId: draftAccount, totalDailyBudget: draftBudget }) }), "Counter-Draft তৈরি হয়েছে — Builder-এ যাচাই করুন (Publish হয়নি)").then(() => void loadPlans());
                    }}>⚔️ Counter-Draft তৈরি করুন</button>
                    <button type="button" className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => {
                      const orgId = getOrganizationId(); if (!orgId) return;
                      void inboxAction(`dismiss-${s.id}`, () => apiFetch(`/organizations/${orgId}/campaign-plans/builder-inbox/${s.id}/dismiss`, { method: "POST", body: "{}" }), "সিগন্যাল Dismiss হয়েছে");
                    }}>Dismiss</button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
        </>
      )}

      {/* CN10 launch calendar — Plan-স্তরের তারিখ (প্রকাশিত / নির্ধারিত / তৈরি), শুধু লোড হওয়া সারি থেকে */}
      {hubView === "calendar" && (
          <div className="card p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900">📅 লঞ্চ ক্যালেন্ডার</h3>
                <p className="text-xs text-slate-400">প্রকাশিত (Published), নির্ধারিত উৎক্ষেপণ (Scheduled) ও তৈরির তারিখ — এই পেজে লোড হওয়া Campaign গুলো থেকে। সক্রিয় Series-এর পরের Instance-ও (🟣 🔁) ক্যালেন্ডারে দেখানো হয়। Ad Set-এর তারিখ তালিকার ডেটায় নেই, তাই দেখানো হয়নি।</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" className="btn-secondary btn-sm font-semibold" onClick={() => setCalCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}>←</button>
                <span className="text-sm font-bold text-slate-800">{calCursor.toLocaleDateString("bn-BD", { month: "long", year: "numeric" })}</span>
                <button type="button" className="btn-secondary btn-sm font-semibold" onClick={() => setCalCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}>→</button>
              </div>
            </div>
            {calMonthCount === 0 ? (
              <div className="cbx-empty">
                <div className="cbx-empty-title">এই মাসে কোনো Campaign-এর তারিখ নেই</div>
                <div className="cbx-empty-text">লোড হওয়া Campaign গুলোর প্রকাশ/নির্ধারিত/তৈরির তারিখ এই মাসে পড়েনি।</div>
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-1">
                {["সোম", "মঙ্গল", "বুধ", "বৃহস্পতি", "শুক্র", "শনি", "রবি"].map((d) => (
                  <div key={d} className="pb-1 text-center text-[11px] font-bold text-slate-400">{d}</div>
                ))}
                {calCells.map((cell) => {
                  const items = calItems.get(`${cell.day.getFullYear()}-${cell.day.getMonth()}-${cell.day.getDate()}`) ?? [];
                  return (
                    <div key={cell.day.toISOString()} className={`min-h-[64px] rounded-lg border p-1 ${cell.inMonth ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 text-slate-300"} ${cell.isToday ? "ring-2 ring-[var(--brand-ring)]" : ""}`}>
                      <div className="text-[11px] font-bold">{cell.day.getDate()}</div>
                      {items.slice(0, 2).map((it, i) => (
                        <div key={i} className={`mt-0.5 truncate text-[10px] font-medium leading-tight ${it.kind === "series" ? "rounded bg-violet-100 px-1 text-violet-800" : ""}`} title={it.display}>
                          <span>{it.kind === "published" ? "🟢" : it.kind === "scheduled" ? "🟠" : it.kind === "series" ? "🟣" : "⚪"}</span> {it.display}
                        </div>
                      ))}
                      {items.length > 2 ? <div className="text-[10px] font-semibold text-slate-400">+{items.length - 2}টি আরও</div> : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
      )}

      {hubView === "portfolio" && (
        <div className="space-y-6">
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
        <div role="status" className="flex items-center justify-between rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 border border-emerald-200 shadow-sm">
          <div className="flex items-center gap-2">
            <span>✓</span>
            <span>{notice}</span>
          </div>
          <button onClick={() => setNotice("")} className="text-xs text-emerald-600 hover:text-emerald-800">✕ বন্ধ</button>
        </div>
      )}

      {/* CN8: Portfolio totals across ad accounts (platform-reported synced rows; currencies never mixed) */}
      {portfolio && portfolio.accounts.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-800">💼 Portfolio — সব Ad Account মিলিয়ে (CN8)</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {portfolio.totalByCurrency.map((t) => (
              <span key={t.currency} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs text-slate-700">মোট ({t.currency}): খরচ {fmtMoneyBn(t.spendMinor)} · {fmtNumBn(t.impressions)} imp · {fmtNumBn(t.clicks)} clicks · {t.conversions} conv</span>
            ))}
          </div>
          <div className="mt-2 space-y-0.5">
            {portfolio.accounts.map((a) => (
              <p key={a.adAccountId} className="text-xs text-slate-600">{a.name} ({a.platform ?? "—"}, {a.currency}): খরচ {fmtMoneyBn(a.spendMinor)} · {fmtNumBn(a.impressions)} imp · {a.conversions} conv · CPA {a.cpaMinor ? fmtMoneyBn(a.cpaMinor) : "—"}</p>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">DailyAdMetric-এর Campaign-level Row থেকে — প্ল্যাটফর্মের রিপোর্ট করা সংখ্যা, নিজস্ব Attribution থেকে আলাদা।</p>
        </div>
      ) : null}

      {portfolio && portfolio.accounts.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="flex items-start gap-2 text-sm leading-[1.7] text-slate-600"><span aria-hidden>💼</span><span>Portfolio ডেটা নেই — কোনো Ad Account-এ এখনো Synced Campaign খরচ পাওয়া যায়নি।</span></p>
          <Link href="/dashboard/ad-accounts" className="mt-1 inline-flex min-h-[40px] items-center text-sm font-medium text-brand-600 hover:underline">Ad Accounts দেখুন →</Link>
        </div>
      ) : null}

      {/* Frontier NB8 (CN18): budget simulator + competitor-response draft */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-800">🧮 Budget Simulator (CN18)</p>
          <p className="mt-1 text-xs leading-[1.7] text-slate-500">শুধু নিজের শেষ ৯০ দিনের আসল Campaign Data থেকে — Data কম থাকলে Simulator সৎভাবে না বলবে; কোনো Industry Benchmark বা AI অনুমান নেই।</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select className="input w-48" value={simForm.objective} onChange={(e) => setSimForm({ ...simForm, objective: e.target.value })}>
              <option value="OUTCOME_SALES">Sales</option>
              <option value="OUTCOME_TRAFFIC">Traffic</option>
              <option value="OUTCOME_LEADS">Leads</option>
              <option value="OUTCOME_ENGAGEMENT">Engagement</option>
              <option value="OUTCOME_AWARENESS">Awareness</option>
            </select>
            <input className="input w-32" type="number" min="1" value={simForm.dailyBudget} onChange={(e) => setSimForm({ ...simForm, dailyBudget: e.target.value })} placeholder="দৈনিক ৳" />
            <input className="input w-24" type="number" min="1" max="90" value={simForm.days} onChange={(e) => setSimForm({ ...simForm, days: e.target.value })} placeholder="দিন" />
            <button type="button" className="btn-primary btn-sm" disabled={busy !== ""} onClick={async () => {
              const res = await wrap("simulator", () => apiFetch<any>(`/organizations/${getOrganizationId()}/campaign-plans/budget-simulator`, { method: "POST", body: JSON.stringify({ objective: simForm.objective, dailyBudget: simForm.dailyBudget || "0", days: Number(simForm.days) || 30 }) }));
              if (res) setSimResult(res);
            }}>হিসাব করুন</button>
          </div>
          {simResult ? (
            simResult.available ? (
              <div className="mt-2 text-xs leading-[1.7] text-slate-600">
                <p className="text-sm text-slate-800">সম্ভাব্য পরিসর ({fmtNumBn(simResult.input.days)} দিনে): Impressions <b>{fmtNumBn(simResult.projected.impressions.low)}–{fmtNumBn(simResult.projected.impressions.high)}</b> · Clicks <b>{fmtNumBn(simResult.projected.clicks.low)}–{fmtNumBn(simResult.projected.clicks.high)}</b>{simResult.projected.conversions ? <> · Conversions <b>{fmtNumBn(simResult.projected.conversions.low)}–{fmtNumBn(simResult.projected.conversions.high)}</b></> : " · Conversions: অতীত Data-তে নেই"}</p>
                <p className="mt-1">নমুনা: <b>{fmtNumBn(simResult.sample.campaigns)}</b>টি Campaign · <b>{fmtNumBn(simResult.sample.campaignDays)}</b> Campaign-Day · Currency {simResult.currency} · Median CPM {fmtMoneyBn(simResult.medians.cpmMinor)} · CTR {simResult.medians.ctrPercent}%{simResult.medians.cpaMinor ? ` · Median CPA ${fmtMoneyBn(simResult.medians.cpaMinor)}` : ""}</p>
                <p className="mt-1 text-slate-500">{simResult.method}</p>
                <p className="mt-1 text-slate-400">{simResult.note}</p>
              </div>
            ) : (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-[1.7] text-amber-800">
                <p>⛔ {simResult.reason}</p>
                <p className="mt-1">পরের পদক্ষেপ: এই Objective-এ আরও Campaign চালিয়ে আসল খরচের Data জমতে দিন — Data যথেষ্ট হলেই Simulator হিসাব দেবে।</p>
              </div>
            )
          ) : null}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-800">🎯 প্রতিযোগী-প্রতিক্রিয়া Draft (CN18)</p>
          <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs leading-[1.7] text-slate-600">🛡 নিয়ম: প্রতিযোগীর কোনো লেখা, ছবি বা Asset খসড়ায় আসে না — আসে শুধু তাদের কোণ/কাঠামো (আমাদের Insight থেকে); সব Copy তৈরি হয় আপনার নিজের পণ্যের তথ্য থেকে। ফলাফল একটি সাধারণ DRAFT Plan।</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
              const [comps, prods] = await Promise.all([
                apiFetch<{ id: string; name: string }[]>(`/organizations/${getOrganizationId()}/competitors`).catch(() => []),
                apiFetch<{ id: string; name: string }[]>(`/organizations/${getOrganizationId()}/products`).catch(() => []),
              ]);
              setRespLists({ competitors: asList(comps), products: asList(prods) });
            }}>তালিকা লোড করুন</button>
            <select className="input w-48" value={respForm.competitorId} onChange={(e) => setRespForm({ ...respForm, competitorId: e.target.value })}>
              <option value="">প্রতিযোগী বেছে নিন</option>
              {(respLists?.competitors ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="input w-48" value={respForm.productId} onChange={(e) => setRespForm({ ...respForm, productId: e.target.value })}>
              <option value="">নিজের পণ্য বেছে নিন</option>
              {(respLists?.products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select className="input w-52" value={respForm.adAccountId} onChange={(e) => setRespForm({ ...respForm, adAccountId: e.target.value })}>
              <option value="">Meta Account বেছে নিন</option>
              {accounts.filter((a) => a.platform === "meta").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button type="button" className="btn-primary btn-sm" disabled={busy !== "" || !respForm.competitorId || !respForm.productId || !respForm.adAccountId} onClick={async () => {
              const res = await wrap("competitor-response", () => apiFetch<any>(`/organizations/${getOrganizationId()}/campaign-plans/competitor-response`, { method: "POST", body: JSON.stringify(respForm) }));
              if (res) { setRespResult(res); setNotice(`প্রতিযোগী-প্রতিক্রিয়া Draft তৈরি: "${res.plan.name}" — Builder-এ খুলে ঠিক করে নিন।`); }
            }}>Draft তৈরি করুন</button>
          </div>
          {respResult ? (
            <div className="mt-2 text-xs text-slate-600">
              <p>কোণ (আমাদের Insight থেকে): <b>{respResult.angleNote}</b></p>
              <p className="mt-1">{respResult.rule}</p>
              <p className="mt-1">{respResult.note} <Link className="font-medium text-brand-600 hover:underline" href={`/dashboard/campaign-builder?id=${respResult.plan.id}`}>Builder-এ খুলুন →</Link></p>
            </div>
          ) : null}
        </div>
      </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 5: AUTO A/B TESTING & WINNER DETECTOR HUB                  */}
      {/* ============================================================== */}
      {activeTab === "ab_tests" && (
        <AbTestHub plans={plans} onRefreshPlans={load} />
      )}

      {/* ============================================================== */}
      {/* TAB 6: AI GROWTH COPILOT & AD OPTIMIZER HUB                   */}
      {/* ============================================================== */}
      {activeTab === "copilot" && (
        <GrowthCopilotHub onActionApplied={load} />
      )}

      {/* ============================================================== */}
      {/* TAB 7: FESTIVAL & FLASH-SALE CAMPAIGN PLAYBOOK (BD SPECIAL)   */}
      {/* ============================================================== */}
      {activeTab === "festivals" && (
        <FestivalPlaybookHub accounts={accounts} onCampaignCreated={load} />
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

      {/* NB7 CN16 wizard — DX3 J4: full-screen flow. Left: the
          three layers as a visual map; right: the same form,
          same submitFunnel call, same layer semantics. */}
      {showFunnel && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-50">
          <div className="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-lg font-bold text-slate-900">🧭 Full-funnel Wizard</h3>
                <p className="mt-1 max-w-3xl text-xs leading-[1.7] text-slate-500">একটিই Plan — Prospecting, Retargeting ও Retention Layer আলাদা Ad Set হিসেবে তৈরি হবে, প্রতিটিতে আপনার লেখা Starter Ad সহ। যেই Layer-এর ইনপুট (যেমন Audience Source-এ Contact) নেই, সেটি অসম্পূর্ণ (Incomplete) হিসেবে কারণসহ তৈরি হবে — চুপচাপ বাদ যাবে না। Plan টি Draft থাকবে; Publish আগের মতোই Approval Flow দিয়ে।</p>
              </div>
              <button type="button" className="btn-secondary btn-sm min-h-[40px]" onClick={() => setShowFunnel(false)}>বন্ধ করুন</button>
            </div>

            {funnelSourcesFailed ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-[1.7] text-amber-800">⚠ Audience Source-এর সংখ্যা এখন লোড করা যাচ্ছে না — সংখ্যা ছাড়াই Wizard আগের মতোই চলবে, কোনো Layer এতে আটকাবে না।</p>
            ) : null}

            <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
              <div className="space-y-2 lg:sticky lg:top-4">
                <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
                  <div className="text-sm font-bold text-slate-800">🧭 Prospecting — নতুন মানুষ</div>
                  <p className="mt-1 text-xs leading-[1.7] text-slate-600">যারা এখনো আপনার ব্যবসা চেনে না — দেশ/বয়স অনুযায়ী নতুন Audience। এই Layer সবসময় তৈরি হয়।</p>
                </div>
                <div className="text-center text-sm text-slate-400">↓</div>
                <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
                  <div className="text-sm font-bold text-slate-800">🧭 Retargeting — দেখেছে, কিনেনি</div>
                  <p className="mt-1 text-xs leading-[1.7] text-slate-600">Product Viewers + Cart Abandoners — পণ্য দেখেছে বা Cart-এ রেখেছে, কিন্তু কিনেনি।</p>
                </div>
                <div className="text-center text-sm text-slate-400">↓</div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                  <div className="text-sm font-bold text-slate-800">🧭 Retention — আগের Buyers</div>
                  <p className="mt-1 text-xs leading-[1.7] text-slate-600">যারা ইতিমধ্যে কিনেছে — তাদের কাছে আবার কেনার প্রস্তাব।</p>
                </div>
                <p className="text-xs leading-[1.7] text-slate-500">তিন Layer একই Plan-এর Ad Set; Budget Mode ও Cap পুরো Plan জুড়ে প্রযোজ্য।</p>
              </div>

              <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">Plan এর নাম<input className="input mt-1 w-full" value={funnelForm.name} onChange={(e) => setFunnelForm({ ...funnelForm, name: e.target.value })} placeholder="যেমন: Full Funnel — Eid" /></label>
              <label className="block text-sm">Meta Ad Account
                <select className="input mt-1 w-full" value={funnelForm.adAccountId || selectedAccountId} onChange={(e) => setFunnelForm({ ...funnelForm, adAccountId: e.target.value })}>
                  <option value="">বেছে নিন</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.platform})</option>)}
                </select>
              </label>
              <label className="block text-sm">Objective
                <select className="input mt-1 w-full" value={funnelForm.objective} onChange={(e) => setFunnelForm({ ...funnelForm, objective: e.target.value })}>
                  {Object.entries(CAMPAIGN_OBJECTIVES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                </select>
              </label>
              <label className="block text-sm">Budget Mode
                <select className="input mt-1 w-full" value={funnelForm.budgetMode} onChange={(e) => setFunnelForm({ ...funnelForm, budgetMode: e.target.value })}>
                  <option value="abo">ABO — বাজেট Ad Set এ</option>
                  <option value="cbo">CBO — বাজেট Campaign এ</option>
                </select>
              </label>
              <label className="block text-sm">Campaign দৈনিক বাজেট (টাকা, CBO হলে)<input className="input mt-1 w-full" value={funnelForm.campaignDailyBudget} onChange={(e) => setFunnelForm({ ...funnelForm, campaignDailyBudget: e.target.value })} placeholder="ঐচ্ছিক" /></label>
              <label className="block text-sm">দৈনিক Budget Cap (টাকা)<input className="input mt-1 w-full" value={funnelForm.dailyBudgetCap} onChange={(e) => setFunnelForm({ ...funnelForm, dailyBudgetCap: e.target.value })} placeholder="ঐচ্ছিক" /></label>
              <label className="block text-sm">Facebook Page ID (ঐচ্ছিক)<input className="input mt-1 w-full" value={funnelForm.pageId} onChange={(e) => setFunnelForm({ ...funnelForm, pageId: e.target.value })} /></label>
              <label className="block text-sm">Pixel ID (ঐচ্ছিক)<input className="input mt-1 w-full" value={funnelForm.pixelId} onChange={(e) => setFunnelForm({ ...funnelForm, pixelId: e.target.value })} /></label>
            </div>

            <div className="space-y-2 rounded-lg bg-slate-50 p-3">
              <div className="text-sm font-semibold">Starter Ad Copy (সব Layer-এ একই শুরুর কপি)</div>
              <label className="block text-sm">Primary Text<textarea className="input mt-1 w-full" rows={3} value={funnelForm.primaryText} onChange={(e) => setFunnelForm({ ...funnelForm, primaryText: e.target.value })} /></label>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-sm">Headline<input className="input mt-1 w-full" value={funnelForm.headline} onChange={(e) => setFunnelForm({ ...funnelForm, headline: e.target.value })} placeholder="ঐচ্ছিক" /></label>
                <label className="block text-sm">Link URL<input className="input mt-1 w-full" value={funnelForm.linkUrl} onChange={(e) => setFunnelForm({ ...funnelForm, linkUrl: e.target.value })} placeholder="https://..." /></label>
                <label className="block text-sm">Call To Action<input className="input mt-1 w-full" value={funnelForm.callToAction} onChange={(e) => setFunnelForm({ ...funnelForm, callToAction: e.target.value })} placeholder="SHOP_NOW" /></label>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50 p-3">
              <div className="text-sm font-semibold">🧭 Prospecting Layer (নতুন Audience)</div>
              <div className="grid gap-3 sm:grid-cols-4">
                <label className="block text-sm">দৈনিক বাজেট (টাকা)<input className="input mt-1 w-full" value={funnelForm.proDaily} onChange={(e) => setFunnelForm({ ...funnelForm, proDaily: e.target.value })} placeholder="1000" /></label>
                <label className="block text-sm">দেশ (কমা দিয়ে)<input className="input mt-1 w-full" value={funnelForm.proCountries} onChange={(e) => setFunnelForm({ ...funnelForm, proCountries: e.target.value })} placeholder="BD" /></label>
                <label className="block text-sm">বয়স — থেকে<input type="number" className="input mt-1 w-full" value={funnelForm.ageMin} onChange={(e) => setFunnelForm({ ...funnelForm, ageMin: e.target.value })} placeholder="18" /></label>
                <label className="block text-sm">বয়স — পর্যন্ত<input type="number" className="input mt-1 w-full" value={funnelForm.ageMax} onChange={(e) => setFunnelForm({ ...funnelForm, ageMax: e.target.value })} placeholder="65" /></label>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-sky-200 bg-sky-50 p-3">
              <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={funnelForm.useRetargeting} onChange={(e) => setFunnelForm({ ...funnelForm, useRetargeting: e.target.checked })} /> 🧭 Retargeting Layer যোগ করুন (Product Viewers + Cart Abandoners) — Source-এ কেউ না থাকলে অসম্পূর্ণ Ad Set হিসেবে তৈরি হবে</label>
              {funnelSourceLines("retargeting")}
              {funnelForm.useRetargeting ? <label className="block text-sm">দৈনিক বাজেট (টাকা)<input className="input mt-1 w-full" value={funnelForm.reDaily} onChange={(e) => setFunnelForm({ ...funnelForm, reDaily: e.target.value })} placeholder="500" /></label> : null}
            </div>

            <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={funnelForm.useRetention} onChange={(e) => setFunnelForm({ ...funnelForm, useRetention: e.target.checked })} /> 🧭 Retention Layer যোগ করুন (আগের Buyers) — Source-এ Buyer না থাকলে অসম্পূর্ণ Ad Set হিসেবে তৈরি হবে</label>
              {funnelSourceLines("retention")}
              {funnelForm.useRetention ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block text-sm">দৈনিক বাজেট (টাকা)<input className="input mt-1 w-full" value={funnelForm.rnDaily} onChange={(e) => setFunnelForm({ ...funnelForm, rnDaily: e.target.value })} placeholder="300" /></label>
                  <label className="block text-sm">Catalog Record ID (ঐচ্ছিক)<input className="input mt-1 w-full" value={funnelForm.catalogRecordId} onChange={(e) => setFunnelForm({ ...funnelForm, catalogRecordId: e.target.value })} /></label>
                  <label className="block text-sm">Product Set ID (ঐচ্ছিক)<input className="input mt-1 w-full" value={funnelForm.productSetId} onChange={(e) => setFunnelForm({ ...funnelForm, productSetId: e.target.value })} /></label>
                </div>
              ) : null}
            </div>

            {(funnelForm.useRetargeting || funnelForm.useRetention) ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-[1.7] text-amber-800">⚠ চালু করা Layer-এর Source খালি থাকলে সেই Layer অসম্পূর্ণ Ad Set হিসেবে কারণসহ তৈরি হবে — বাদ যাবে না। তৈরি হওয়ার পর Builder-এর Readiness-এ কারণটি দেখা যাবে।</p>
            ) : null}

            {funnelResult ? (
              <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                <div className="text-sm font-semibold">তৈরি হওয়া Plan: "{funnelResult.plan.name}" — Layer ফলাফল</div>
                {funnelResult.layers.map((l) => (
                  <div key={l.layer} className="flex flex-wrap items-start gap-2 text-sm">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${l.status === "complete" ? "bg-green-100 text-green-700" : l.status === "incomplete" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700"}`}>{l.layer}: {l.status}</span>
                    {l.reason ? <span className="text-xs text-slate-600">{l.reason}</span> : null}
                    {!l.reason && l.missingSources?.length ? <span className="text-xs text-slate-500">Missing Source: {l.missingSources.join(", ")}</span> : null}
                  </div>
                ))}
                <Link href={`/dashboard/campaign-builder?id=${funnelResult.plan.id}&step=4`} className="btn-primary btn-sm inline-flex font-semibold">Builder-এ Plan টি খুলুন (Review ধাপে) →</Link>
              </div>
            ) : null}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" className="btn-secondary btn-sm min-h-[40px]" onClick={() => setShowFunnel(false)}>বন্ধ করুন</button>
              <button type="button" className="btn-primary btn-sm min-h-[40px]" disabled={busy === "funnel-create"} onClick={submitFunnel}>
                {busy === "funnel-create" ? "তৈরি হচ্ছে..." : "🧭 Full-funnel Plan তৈরি করুন"}
              </button>
            </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
