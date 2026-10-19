"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { asList } from "@/lib/as-list";
import { getOrganizationId } from "@/lib/org";
import { EmptyState } from "@repo/ui";
import { monthGrid, planCalendarDate, sameDay } from "@/lib/campaign-cn10";
import { fmtDateTime, fmtMoneyMinor, fmtNumber, fmtRelative } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
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
  nameEn?: string;
  objective: string;
  description?: string;
  descriptionEn?: string;
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
const SERIES_CADENCE_KEY: Record<string, string> = { weekly: "ads.cgCadenceWeekly", monthly: "ads.cgCadenceMonthly", dates: "ads.cgCadenceDates" };

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
  const { t, locale } = useLocale();
  const router = useRouter();
  // ML6: locale-aware replacements for the bn-only helpers
  // (money-bn / rel-time-bn stay untouched — other pages use them).
  const fmtMoneyBn = (minor: string | bigint | number | null | undefined): string =>
    minor === null || minor === undefined || minor === "" ? "—" : fmtMoneyMinor(locale, typeof minor === "bigint" ? minor : BigInt(String(minor).trim()));
  const fmtNumBn = (n: number | null | undefined): string =>
    n === null || n === undefined || !Number.isFinite(n) ? "—" : fmtNumber(locale, n);
  const relTimeBn = (iso: string | null | undefined): string => (iso ? fmtRelative(locale, iso) : "");
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
      setError(e instanceof Error ? e.message : t("ads.cgErrGeneric"));
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
              nameEn: "E-commerce sales booster (direct conversions)",
              objective: "OUTCOME_SALES",
              description: "ওয়েবসাইটে সরাসরি অর্ডার ও বিক্রি বৃদ্ধির জন্য অপ্টিমাইজড ক্যাম্পেইন।",
              descriptionEn: "A campaign optimized to grow direct orders and sales on your website.",
            },
            {
              key: "lead_generation",
              name: "হাই-কনভার্সন লিড জেনারেশন (Instant Form)",
              nameEn: "High-conversion lead generation (instant form)",
              objective: "OUTCOME_LEADS",
              description: "ফেসবুক ও ইনস্টাগ্রাম ইনস্ট্যান্ট ফর্মের মাধ্যমে জেনুইন কাস্টমার লিড সংগ্রহ।",
              descriptionEn: "Collect genuine customer leads through Facebook and Instagram instant forms.",
            },
            {
              key: "messenger_chat",
              name: "ইনবক্স মেসেজিং ও বিক্রয় ক্লোজিং (Chat Ads)",
              nameEn: "Inbox messaging & sales closing (chat ads)",
              objective: "OUTCOME_ENGAGEMENT",
              description: "সরাসরি ইনবক্স ও হোয়াটসঅ্যাপে চ্যাট শুরু করে বিক্রয় সম্পন্ন করার ফানেল।",
              descriptionEn: "A funnel that starts chats in the inbox and WhatsApp and closes the sale.",
            },
            {
              key: "website_traffic",
              name: "হাই-ভলিউম ওয়েবসাইট ট্র্যাফিক (Landing Page Views)",
              nameEn: "High-volume website traffic (landing page views)",
              objective: "OUTCOME_TRAFFIC",
              description: "কম খরচে ওয়েবসাইটের ল্যান্ডিং পেজে আগ্রহী ভিজিটর ও রিডাইরেকশন আনা।",
              descriptionEn: "Bring interested visitors to your website landing page at low cost.",
            },
            {
              key: "advantage_plus_sales",
              name: "Meta Advantage+ শপিং ক্যাম্পেইন (AI Catalog)",
              nameEn: "Meta Advantage+ shopping campaign (AI catalog)",
              objective: "OUTCOME_SALES",
              advantagePlus: true,
              description: "মেটার কৃত্রিম বুদ্ধিমত্তা চালিত স্বয়ংক্রিয় অডিয়েন্স ও বাজেট স্কেলিং।",
              descriptionEn: "Automatic audience and budget scaling powered by Meta's AI.",
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
      setError(e instanceof Error ? e.message : t("ads.cgErrOperation"));
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
      setNotice(t("ads.cgNoticeSubmitted", { name }));
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
      if (res.approvalState?.awaitingSecond) setNotice(t("ads.cgNoticeApprovedFirst", { name }));
      else setNotice(t("ads.cgNoticeApproved", { name }));
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
        body: JSON.stringify({ reason: rejectReason.trim() || t("ads.cgRejectDefaultReason") }),
      })
    );
    if (res) {
      setNotice(t("ads.cgNoticeRejected"));
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
      setNotice(t("ads.cgNoticePublished", { name }));
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
      setNotice(t("ads.cgNoticeToggled", { name: p.name, status: nextStatus === "activate" ? "ACTIVE" : "PAUSED" }));
      await load();
    }
  }

  async function duplicatePlan(p: Plan) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const res = await wrap(`dup-${p.id}`, () =>
      apiFetch(`/organizations/${orgId}/campaign-plans/${p.id}/duplicate`, {
        method: "POST",
        body: JSON.stringify({ name: `${p.name}${t("ads.cgCopySuffix")}` }),
      })
    );
    if (res) {
      setNotice(t("ads.cgNoticeDuplicated", { name: p.name }));
      await load();
    }
  }

  async function deletePlan(p: Plan) {
    if (!confirm(t("ads.cgDeleteConfirm", { name: p.name }))) return;
    const orgId = getOrganizationId();
    if (!orgId) return;
    const res = await wrap(`del-${p.id}`, () =>
      apiFetch(`/organizations/${orgId}/campaign-plans/${p.id}`, { method: "DELETE" })
    );
    if (res) {
      setNotice(t("ads.cgNoticeDeleted", { name: p.name }));
      await load();
    }
  }

  async function instantiateBlueprint() {
    if (!instantiateBp || !selectedAccountId) {
      setError(t("ads.cgErrChooseAccount"));
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
      setNotice(t("ads.cgNoticeBlueprint"));
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
      setNotice(t("ads.cgNoticeSeries", { name: res.name, action: t(act === "pause" ? "ads.cgSeriesActionPause" : act === "resume" ? "ads.cgSeriesActionResume" : "ads.cgSeriesActionEnd") }));
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
      setError(t("ads.cgErrFunnelRequired"));
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
      setNotice(t("ads.cgNoticeFunnel", { name: res.plan.name }));
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
    if (!funnelSources) return <p className="text-xs leading-[1.7] text-slate-500">{t("ads.cgSourcesLoading")}</p>;
    return (
      <div className="space-y-0.5">
        {layerSourceViews(funnelSources, layer, locale).map((v) => (
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
    setBulkReport(t("ads.cgBulkSyncReport", { ok }) + (failed.length ? t("ads.cgBulkFailedPart", { count: failed.length, names: failed.join(", ") }) : ""));
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
    const labels: Record<string, string> = { pause: "Pause", activate: t("ads.cgBulkLabelActivate"), budget_percent: t("ads.cgBulkLabelBudget"), duplicate: t("ads.cgBulkLabelDuplicate") };
    if (action === "pause" && !window.confirm(t("ads.cgConfirmPause", { count: selected.length }))) return;
    if (action === "activate" && !window.confirm(t("ads.cgConfirmActivate", { count: selected.length }))) return;
    if (action === "budget_percent" && !window.confirm(t("ads.cgConfirmBudget", { count: selected.length, pct: bulkPct }))) return;
    setBusy(`bulk-${action}`);
    setError("");
    try {
      const res = await apiFetch<{ results: { planId: string; ok: boolean; error?: string }[]; succeeded: number; failed: number }>(`/organizations/${orgId}/campaign-plans/bulk`, {
        method: "POST",
        body: JSON.stringify({ planIds: selected, action, percent: action === "budget_percent" ? Number(bulkPct) : undefined }),
      });
      const failedLines = res.results.filter((r) => !r.ok).map((r) => `${names.get(r.planId) ?? r.planId} (${r.error ?? t("ads.cgBulkFailedWord")})`);
      setBulkReport(t("ads.cgBulkReport", { label: labels[action], ok: res.succeeded }) + (res.failed ? t("ads.cgBulkFailedPart", { count: res.failed, names: failedLines.join(", ") }) : ""));
      setSelected(res.results.filter((r) => !r.ok).map((r) => r.planId));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ads.cgErrBulk"));
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
    if (!Number.isFinite(totalMinor) || totalMinor <= 0) { setError(t("ads.cgErrAllocPositive")); return; }
    setAllocResult(null);
    const res = await wrap("alloc-propose", () => apiFetch<any>(`/organizations/${orgId}/campaign-plans/budget-allocator/proposal`, { method: "POST", body: JSON.stringify({ planIds: selected, totalShiftMinor: String(totalMinor) }) }));
    if (res) setAllocProposal(res);
  }
  async function allocApply() {
    const orgId = getOrganizationId();
    if (!orgId || !allocProposal) return;
    if (!confirm(t("ads.cgConfirmAlloc", { count: allocProposal.allocations.length, amount: fmtMoneyBn(allocProposal.allocatedMinor) }))) return;
    const res = await wrap("alloc-apply", () => apiFetch<any>(`/organizations/${orgId}/campaign-plans/budget-allocator/apply`, {
      method: "POST",
      body: JSON.stringify({ allocations: allocProposal.allocations.map((a: any) => ({ planId: a.planId, amountMinor: a.amountMinor, expectedDailyTotalMinor: a.currentDailyTotalMinor })) }),
    }));
    if (res) {
      setAllocResult(res);
      setAllocProposal(null);
      setNotice(t("ads.cgNoticeAlloc", { count: res.appliedCount }) + (res.failedCount ? t("ads.cgNoticeAllocFailed", { count: res.failedCount }) : ""));
      await load();
    }
  }

  // CN10 saved views (CN11 API): the hub filter state, verbatim.
  async function saveCurrentView() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const name = window.prompt(t("ads.cgPromptViewName"));
    if (!name?.trim()) return;
    const res = await wrap("save-view", () => apiFetch<SavedView>(`/organizations/${orgId}/campaign-plans/saved-views`, { method: "POST", body: JSON.stringify({ name: name.trim(), filters: { statusFilter, objectiveFilter, searchQuery, activeTab } }) }));
    if (res) {
      setSavedViews((v) => [res, ...v]);
      setNotice(t("ads.cgNoticeViewSaved", { name: res.name }));
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
      map.set(key, [...(map.get(key) ?? []), { display: t("ads.cgSeriesNextChip", { name: s.name }), kind: "series" }]);
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
  const fmtMinor = (minor: string) => fmtMoneyMinor(locale, BigInt(minor));
  const weekChange = (thisMinor: string, prevMinor: string): { arrow: string; pct: string } | null => {
    const prev = Number(BigInt(prevMinor));
    if (prev === 0) return null;
    const cur = Number(BigInt(thisMinor));
    const pct = ((cur - prev) / prev) * 100;
    return { arrow: pct > 0 ? "▲" : pct < 0 ? "▼" : "—", pct: fmtNumber(locale, Math.abs(pct), { maximumFractionDigits: 1 }) };
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t("ads.cgTitle")}</h1>
          <p className="text-sm text-slate-500">
            {t("ads.cgIntro")}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary font-semibold flex items-center gap-1.5"
            onClick={() => { setFunnelResult(null); setFunnelForm((f) => ({ ...f, adAccountId: f.adAccountId || selectedAccountId })); setShowFunnel(true); }}
          >
            <span>{t("ads.cgFunnelWizardBtn")}</span>
          </button>
          <Link
            href="/dashboard/campaign-builder"
            className="btn-primary font-semibold flex items-center gap-1.5"
          >
            <span>{t("ads.cgNewCampaign")}</span>
          </Link>
        </div>
      </div>

      {/* DX2 (J2): "এই সপ্তাহে" strip — owner decision: ON TOP of the hub, above every view */}
      <section aria-label={t("ads.cgWeekAria")} className="space-y-2">
        <h2 className="text-sm font-bold text-slate-900">{t("ads.cgWeekTitle")}</h2>
        {weekFailed ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span aria-hidden>⚠️</span>
            <span className="leading-[1.7]">{t("ads.cgWeekLoadFailed")}</span>
            <button type="button" className="btn-secondary btn-sm min-h-[40px] font-semibold" onClick={() => { void loadWeekSummary(); }}>{t("ads.cgRetry")}</button>
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
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("ads.cgSpend7d")}</p>
              {weekSummary.spendByCurrency.length === 0 ? (
                <p className="mt-2 text-sm leading-[1.7] text-slate-500">{t("ads.cgNoSpendData")}</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {weekSummary.spendByCurrency.map((c) => {
                    const ch = weekChange(c.thisWeekMinor, c.prevWeekMinor);
                    return (
                      <div key={c.currency}>
                        <div className="text-lg font-bold text-slate-900">{fmtMinor(c.thisWeekMinor)} <span className="text-xs font-semibold text-slate-500">{c.currency}</span></div>
                        <p className="text-xs leading-[1.7] text-slate-500">{t("ads.cgPrevWeek", { amount: fmtMinor(c.prevWeekMinor), currency: c.currency })}{ch ? <> · <span className="font-semibold text-slate-700">{ch.arrow} {ch.pct}%</span></> : <>{t("ads.cgPrevWeekNone")}</>}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("ads.cgRecommendations")}</p>
              <div className="mt-2 text-2xl font-bold text-slate-900">{t("ads.cgRecommendationsCount", { count: fmtNumber(locale, weekSummary.recommendations.total) })}</div>
              <p className="text-xs leading-[1.7] text-slate-500">{t("ads.cgRecommendationsChecked", { count: fmtNumber(locale, weekSummary.recommendations.plansChecked) })}</p>
              {weekSummary.recommendations.topPlan ? (
                <Link href={`/dashboard/campaign-builder?id=${weekSummary.recommendations.topPlan.planId}`} className="mt-1 block min-h-[40px] text-sm font-medium leading-[1.7] text-brand-600 hover:underline">{t("ads.cgTopPlan", { name: weekSummary.recommendations.topPlan.name, count: fmtNumber(locale, weekSummary.recommendations.topPlan.count) })}</Link>
              ) : (
                <p className="mt-1 text-xs leading-[1.7] text-slate-400">{t("ads.cgNoRecommendations")}</p>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("ads.cgFatigueTitle")}</p>
              <div className="mt-2 text-2xl font-bold text-slate-900">{t("ads.cgFatigueCount", { count: fmtNumber(locale, weekSummary.fatigue.total) })}</div>
              {weekSummary.fatigue.topPlan ? (
                <Link href={`/dashboard/campaign-builder?id=${weekSummary.fatigue.topPlan.planId}`} className="mt-1 block min-h-[40px] text-sm font-medium leading-[1.7] text-brand-600 hover:underline">{t("ads.cgTopPlan", { name: weekSummary.fatigue.topPlan.name, count: fmtNumber(locale, weekSummary.fatigue.topPlan.count) })}</Link>
              ) : (
                <p className="mt-1 text-xs leading-[1.7] text-slate-400">{t("ads.cgNoFatigue")}</p>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("ads.cgOfflineTitle")}</p>
              {!weekSummary.offlineLoop.configured ? (
                <>
                  <p className="mt-2 flex items-start gap-2 text-sm leading-[1.7] text-slate-600"><span aria-hidden>🔌</span><span>{t("ads.cgOfflineNotSetup")}</span></p>
                  <Link href="/dashboard/ad-accounts" className="btn-secondary btn-sm mt-2 inline-flex min-h-[40px] items-center font-semibold">{t("ads.cgSetupBtn")}</Link>
                </>
              ) : (
                <Link href="/dashboard/ad-accounts" className="mt-2 block min-h-[40px]">
                  {weekSummary.offlineLoop.lastSuccessAt ? (
                    <p className="text-sm leading-[1.7] text-slate-700">{t("ads.cgLastUpload", { date: fmtDateTime(locale, weekSummary.offlineLoop.lastSuccessAt) })}{weekSummary.offlineLoop.lastSuccessPlatform ? ` (${weekSummary.offlineLoop.lastSuccessPlatform})` : ""}</p>
                  ) : (
                    <p className="text-sm leading-[1.7] text-slate-500">{t("ads.cgNoUploadYet")}</p>
                  )}
                  {weekSummary.offlineLoop.failedLast7Days > 0 ? (
                    <span className="mt-1 inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">{t("ads.cgUploadsFailed7d", { count: fmtNumber(locale, weekSummary.offlineLoop.failedLast7Days) })}</span>
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
          { key: "plans", label: t("ads.cgViewPlans") },
          { key: "calendar", label: t("ads.cgViewCalendar") },
          { key: "portfolio", label: t("ads.cgViewPortfolio") },
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
          <button onClick={() => setError("")} className="text-xs text-red-500 hover:text-red-700">{t("ads.cgClose")}</button>
        </div>
      )}

      {notice && (
        <div role="status" className="flex items-center justify-between rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 border border-emerald-200 shadow-sm">
          <div className="flex items-center gap-2">
            <span>✓</span>
            <span>{notice}</span>
          </div>
          <button onClick={() => setNotice("")} className="text-xs text-emerald-600 hover:text-emerald-800">{t("ads.cgClose")}</button>
        </div>
      )}

      {/* DX2: "অসমাপ্ত কাজ" resume card — newest Draft plans; renders nothing when there are none */}
      {resumeDrafts.length > 0 ? (
        <div className="card space-y-3 p-4">
          <h3 className="text-sm font-bold text-slate-900">{t("ads.cgResumeTitle")}</h3>
          <div className="space-y-2">
            {resumeDrafts.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-800">{p.name}</div>
                  <div className="text-xs leading-[1.7] text-slate-500">{t("ads.cgUpdatedPrefix")}<span title={fmtDateTime(locale, p.updatedAt)}>{relTimeBn(p.updatedAt)}</span> · {t("ads.cgAdSetsCount", { count: fmtNumber(locale, p.adSetCount) })}</div>
                </div>
                <Link href={`/dashboard/campaign-builder?id=${p.id}`} className="btn-secondary btn-sm inline-flex min-h-[40px] items-center font-semibold">{t("ads.cgContinueBtn")}</Link>
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
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("ads.cgMetricTotal")}</span>
            <div className="text-2xl font-bold text-slate-900">{totalCount}</div>
            <div className="text-[11px] text-slate-400">{t("ads.cgMetricTotalAdSets", { count: fmtNumber(locale, totalAdSets) })}</div>
          </div>
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-xl text-brand-600">
            📢
          </span>
        </div>

        {/* Metric 2 */}
        <div className="card p-4 flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("ads.cgMetricActive")}</span>
            <div className="text-2xl font-bold text-emerald-600">
              {liveCount} <span className="text-xs font-normal text-slate-400">/ {plans.filter(p => p.status === "published").length} {t("ads.cgMetricPublishedSuffix")}</span>
            </div>
            <div className="text-[11px] text-emerald-700 font-medium">{t("ads.cgMetricLiveOn")}</div>
          </div>
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-xl text-emerald-600">
            🟢
          </span>
        </div>

        {/* Metric 3 */}
        <div className="card p-4 flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("ads.cgMetricPending")}</span>
            <div className="text-2xl font-bold text-amber-600">{pendingCount}</div>
            <div className="text-[11px] text-slate-400">
              {approvedCount > 0 ? t("ads.cgMetricApprovedReady", { count: fmtNumber(locale, approvedCount) }) : t("ads.cgMetricReviewPending")}
            </div>
          </div>
          <span className={`flex h-12 w-12 items-center justify-center rounded-2xl text-xl ${pendingCount > 0 ? "bg-amber-100 text-amber-700 animate-pulse" : "bg-slate-100 text-slate-600"}`}>
            ⏳
          </span>
        </div>

        {/* Metric 4 */}
        <div className="card p-4 flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t("ads.cgMetricBuilder")}</span>
            <div className="text-base font-bold text-slate-800">{t("ads.cgMetricBuilderSub")}</div>
            <Link href="/dashboard/campaign-builder" className="text-xs text-brand-600 hover:underline font-medium">
              {t("ads.cgMetricBuilderLink")}
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
            <span>{t("ads.cgTabAll")}</span>
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
            <span>{t("ads.cgTabLive")}</span>
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
            <span>{t("ads.cgTabApproval")}</span>
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
            <span>{t("ads.cgTabBlueprints")}</span>
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
            <span>{t("ads.cgTabAbTests")}</span>
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
              {t("ads.cgTabCopilotActive")}
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
            <span>{t("ads.cgTabFestivals")}</span>
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
                  <button type="button" className="cbx-view-chip-del" title={t("ads.cgDeleteViewTitle")} disabled={busy !== ""} onClick={() => deleteView(v)}>✕</button>
                </span>
              ))}
              {savedViews.length === 0 ? <span className="text-xs text-slate-400">{t("ads.cgNoSavedViews")}</span> : null}
              <button type="button" className="btn-secondary btn-sm" disabled={busy !== ""} onClick={saveCurrentView}>{t("ads.cgSaveViewBtn")}</button>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {/* Search input */}
              <div className="relative flex-1 max-w-md">
                <input
                  type="text"
                  placeholder={t("ads.cgSearchPlaceholder")}
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
                  <option value="all">{t("ads.cgAllObjectives")}</option>
                  {Object.entries(CAMPAIGN_OBJECTIVES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.icon} {locale === "en" ? v.labelEn : v.label}
                    </option>
                  ))}
                </select>

                {activeTab === "all" && (
                  <select
                    className="input !py-1.5 text-xs"
                    value={statusFilter}
                    onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                  >
                    <option value="all">{t("ads.cgAllStatus")}</option>
                    {Object.entries(CAMPAIGN_STATUS_META).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.icon} {locale === "en" ? v.labelEn : v.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* Quick Filter Pills (for tab 'all') */}
            {activeTab === "all" && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs pt-1 border-t border-slate-100">
                <span className="text-xs font-semibold text-slate-400 mr-1">{t("ads.cgStatusLabel")}</span>
                {[
                  { id: "all", label: t("ads.cgPillAll"), count: plans.length },
                  { id: "draft", label: "Draft", count: plans.filter((p) => p.status === "draft").length },
                  {
                    id: "pending_approval",
                    label: getCampaignStatusBadge("pending_approval", locale).label,
                    count: plans.filter((p) => p.status === "pending_approval").length,
                  },
                  { id: "approved", label: getCampaignStatusBadge("approved", locale).label, count: plans.filter((p) => p.status === "approved").length },
                  {
                    id: "published",
                    label: locale === "en" ? "Published/live" : "প্রকাশিত/লাইভ",
                    count: plans.filter((p) => p.status === "published").length,
                  },
                  {
                    id: "rejected",
                    label: getCampaignStatusBadge("rejected", locale).label,
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
              <span className="text-sm font-semibold text-slate-800">{t("ads.cgSelectedCount", { count: fmtNumber(locale, selected.length) })}</span>
              <button type="button" className="btn-secondary btn-sm font-semibold" disabled={busy !== ""} onClick={() => bulkServer("duplicate")}>{t("ads.cgBulkDuplicate")}</button>
              <button type="button" className="btn-secondary btn-sm font-semibold" disabled={busy !== ""} onClick={() => bulkServer("pause")}>{t("ads.cgBulkPause")}</button>
              <button type="button" className="btn-secondary btn-sm font-semibold" disabled={busy !== ""} onClick={() => bulkServer("activate")}>{t("ads.cgBulkActivate")}</button>
              <span className="flex items-center gap-1">
                <input className="w-16 rounded-lg border px-2 py-1 text-sm" value={bulkPct} onChange={(e) => setBulkPct(e.target.value)} aria-label={t("ads.cgBudgetPctAria")} />
                <button type="button" className="btn-secondary btn-sm font-semibold" disabled={busy !== ""} onClick={() => bulkServer("budget_percent")}>{t("ads.cgBulkBudgetPct")}</button>
              </span>
              <button type="button" className="btn-secondary btn-sm font-semibold" disabled={busy !== ""} onClick={() => bulkRun("status-sync")}>{t("ads.cgBulkStatusSync")}</button>
              <button type="button" className="btn-secondary btn-sm font-semibold" disabled={busy !== ""} onClick={() => { setAllocOpen((o) => !o); setAllocProposal(null); setAllocResult(null); }}>{t("ads.cgBulkAllocator")}</button>
              <button type="button" className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => { setSelected([]); setBulkReport(""); }}>{t("ads.cgClearSelection")}</button>
              {bulkReport ? <span className="text-xs font-medium text-slate-600">{bulkReport}</span> : null}
            </div>
          )}

          {/* CA11 allocator panel — proposal first, confirmed apply second */}
          {allocOpen && selected.length > 0 && (
            <div className="card mt-3 border-violet-200 bg-violet-50/60 p-4">
              <p className="text-sm font-bold text-slate-900">{t("ads.cgAllocTitle", { count: fmtNumber(locale, selected.length) })}</p>
              <p className="mt-0.5 text-xs text-slate-600">{t("ads.cgAllocIntro")}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="text-xs font-semibold text-slate-700">{t("ads.cgAllocTotalLabel")}</label>
                <input className="input w-40" type="number" min="1" value={allocTotal} onChange={(e) => setAllocTotal(e.target.value)} />
                <button type="button" className="btn-primary btn-sm font-semibold" disabled={busy !== ""} onClick={allocPropose}>{t("ads.cgAllocProposeBtn")}</button>
              </div>
              {allocProposal ? (
                <div className="mt-3 space-y-2 text-sm">
                  {allocProposal.allocations.length === 0 ? <p className="text-xs text-slate-600">{t("ads.cgAllocNone")}</p> : allocProposal.allocations.map((a: any) => (
                    <div key={a.planId} className="flex flex-wrap items-center gap-x-3 rounded-lg bg-white/80 px-3 py-2 text-xs text-slate-700">
                      <b className="text-slate-900">{a.name}</b>
                      <span>{t("ads.cgAllocPerDay", { amount: fmtMoneyBn(a.amountMinor) })}</span>
                      <span>{t("ads.cgAllocDailyTotal", { from: fmtMoneyBn(a.currentDailyTotalMinor), to: fmtMoneyBn(a.newDailyTotalMinor) })}</span>
                      <span>{t("ads.cgAllocTargetAdSet", { name: a.targetAdSetName })} ({a.targetBasis === "lowest_cpa" ? t("ads.cgAllocBasisBestCpa") : t("ads.cgAllocBasisBiggest")})</span>
                      <span>{t("ads.cgAllocEvidence", { spend: fmtMoneyBn(a.evidence.spendMinor), conversions: fmtNumBn(a.evidence.conversions), cpa: a.evidence.cpaMinor ? fmtMoneyBn(a.evidence.cpaMinor) : "—" })}</span>
                    </div>
                  ))}
                  {allocProposal.excluded.map((x: any) => (
                    <p key={x.planId} className="text-xs text-slate-500">{t("ads.cgAllocExcludedPrefix")}<b>{x.name ?? x.planId}</b> — {
                      x.reason === "no_evidence" ? t("ads.cgAllocReasonNoEvidence") :
                      x.reason === "below_efficiency" ? t("ads.cgAllocReasonBelowEff", { cpa: x.evidence?.cpaMinor ? fmtMoneyBn(x.evidence.cpaMinor) : "—" }) :
                      x.reason === "cbo_no_live_budget_path" ? t("ads.cgAllocReasonCbo") :
                      x.reason === "not_published" ? t("ads.cgAllocReasonNotPublished") :
                      x.reason === "no_daily_budget" ? t("ads.cgAllocReasonNoDaily") :
                      x.reason === "cap_reached_by_others" ? t("ads.cgAllocReasonCap") :
                      x.reason}</p>
                  ))}
                  <p className="text-xs font-medium text-slate-700">{t("ads.cgAllocSummary", { allocated: fmtMoneyBn(allocProposal.allocatedMinor), unallocated: fmtMoneyBn(allocProposal.unallocatedMinor) })}</p>
                  {allocProposal.allocations.length > 0 ? (
                    <button type="button" className="btn-primary btn-sm font-semibold" disabled={busy !== ""} onClick={allocApply}>{t("ads.cgAllocApplyBtn")}</button>
                  ) : null}
                </div>
              ) : null}
              {allocResult ? (
                <div className="mt-3 space-y-1 text-xs">
                  {allocResult.results.map((r: any) => (
                    <p key={r.planId} className={r.ok ? "text-emerald-800" : "text-rose-700"}>
                      {r.ok ? t("ads.cgAllocResultOk", { name: plans.find((p) => p.id === r.planId)?.name ?? r.planId, before: fmtMoneyBn(r.beforeDailyMinor), after: fmtMoneyBn(r.afterDailyMinor), adSetId: r.targetAdSetId }) + (r.verified ? t("ads.cgAllocResultVerified") : t("ads.cgAllocResultUnverified")) : t("ads.cgAllocResultFail", { name: plans.find((p) => p.id === r.planId)?.name ?? r.planId, error: r.error }) + (r.currentDailyTotalMinor ? t("ads.cgAllocResultCurrent", { total: fmtMoneyBn(r.currentDailyTotalMinor) }) : "")}
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
                title={t("ads.cgEmptyTitle")}
                description={
                  activeTab === "approval"
                    ? t("ads.cgEmptyApproval")
                    : activeTab === "live"
                      ? t("ads.cgEmptyLive")
                      : t("ads.cgEmptyFilter")
                }
                actionLabel={t("ads.cgEmptyAction")}
                onAction={() => router.push("/dashboard/campaign-builder")}
              />
            </div>
          ) : (
            <div key={`${activeTab}-${statusFilter}-${objectiveFilter}-${page}`} className="r2-step-enter space-y-3">
              {filteredPlans.map((p) => {
                const sMeta = getCampaignStatusBadge(p.status, locale);
                const oMeta = getCampaignObjectiveMeta(p.objective, locale);
                const isMetaLive = p.status === "published" && p.metaStatus === "ACTIVE";

                return (
                  <div
                    key={p.id}
                    className="card p-4 hover:border-slate-300 transition-all flex flex-col justify-between gap-3 lg:flex-row lg:items-center"
                  >
                    <div className="space-y-2 flex-1 min-w-0">
                      {/* Top Badges */}
                      <div className="flex flex-wrap items-center gap-2">
                        <input type="checkbox" className="h-5 w-5 shrink-0 accent-indigo-600" checked={selected.includes(p.id)} onChange={() => toggleSelect(p.id)} aria-label={t("ads.cgSelectAria", { name: p.name })} />
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
                            {t("ads.cgAdSetsLabel")}<strong className="text-slate-700">{t("ads.cgAdSetsCountSuffix", { count: fmtNumber(locale, p.adSetCount) })}</strong>
                          </span>
                          <span>
                            {t("ads.cgUpdatedLabel")}<strong className="text-slate-700" title={fmtDateTime(locale, p.updatedAt)}>{relTimeBn(p.updatedAt)}</strong>
                          </span>
                        </div>
                      </div>

                      {/* CN10: platform metrics from the list payload (null = no data, never fake zeros) */}
                      {p.performance === null ? (
                        <div className="text-xs text-slate-400">{t("ads.cgNoMetrics")}</div>
                      ) : p.performance ? (
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                          <span>{t("ads.cgMetricSpend")}<b>{fmtMoneyBn(p.performance.spendMinor)}</b></span>
                          <span>Impressions: <b>{fmtNumBn(p.performance.impressions)}</b></span>
                          <span>Clicks: <b>{fmtNumBn(p.performance.clicks)}</b></span>
                          <span>CTR: <b>{p.performance.ctrPercent ?? "—"}%</b></span>
                          <span>Conversions: <b>{fmtNumber(locale, p.performance.conversions)}</b></span>
                          <span>CPA: <b>{p.performance.cpaMinor ? fmtMoneyBn(p.performance.cpaMinor) : "—"}</b></span>
                        </div>
                      ) : null}

                      {/* Rejection reason if any */}
                      {p.rejectionReason && (
                        <div className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700 border border-rose-100">
                          {t("ads.cgRejectionReason")}<strong>{p.rejectionReason}</strong>
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
                          <span>{isMetaLive ? t("ads.cgPauseBtn") : t("ads.cgActivateBtn")}</span>
                        </button>
                      )}

                      {/* Submit for approval (Draft) */}
                      {p.status === "draft" && (
                        <button
                          type="button"
                          className="btn-primary btn-sm font-semibold"
                          disabled={busy === `submit-${p.id}`}
                          onClick={() => submitForApproval(p.id, p.name)}
                          title={t("ads.cgSubmitTitle")}
                        >
                          {t("ads.cgSubmitBtn")}
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
                            {t("ads.cgApproveBtn")}
                          </button>
                          <button
                            type="button"
                            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition"
                            onClick={() => setRejectPlanId(p.id)}
                          >
                            {t("ads.cgRejectBtn")}
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
                          <span>{t("ads.cgPublishBtn")}</span>
                        </button>
                      )}

                      {/* Link to Campaign Builder */}
                      <Link
                        href={`/dashboard/campaign-builder?id=${p.id}`}
                        className="btn-secondary btn-sm font-semibold"
                      >
                        {t("ads.cgEditInBuilder")}
                      </Link>

                      {/* Duplicate button */}
                      <button
                        type="button"
                        className="rounded-lg p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition"
                        disabled={busy === `dup-${p.id}`}
                        onClick={() => duplicatePlan(p)}
                        title={t("ads.cgDuplicateTitle")}
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
                          title={t("ads.cgDeleteTitle")}
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
            <span className="text-xs font-medium text-slate-500">{t("ads.cgPagination", { total: fmtNumber(locale, total), page: fmtNumber(locale, page), pages: fmtNumber(locale, Math.max(1, Math.ceil(total / PAGE_SIZE))) })}</span>
            <div className="flex items-center gap-2">
              <button type="button" className="btn-secondary btn-sm font-semibold" disabled={listLoading || page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>{t("ads.cgPrevPage")}</button>
              <button type="button" className="btn-secondary btn-sm font-semibold" disabled={listLoading || page >= Math.max(1, Math.ceil(total / PAGE_SIZE))} onClick={() => setPage((p) => p + 1)}>{t("ads.cgNextPage")}</button>
            </div>
          </div>

          {/* NB7 CN16: recurring series — org-wide list with pause/resume/end */}
          <div className="card p-4 space-y-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">{t("ads.cgSeriesTitle")}</h3>
              <p className="text-xs text-slate-400">{t("ads.cgSeriesIntro")}</p>
            </div>
            {seriesHub.length === 0 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-3">
                <span aria-hidden>🔁</span>
                <p className="text-sm leading-[1.7] text-slate-500">{t("ads.cgSeriesEmpty")}</p>
                <Link href="/dashboard/campaign-builder" className="inline-flex min-h-[40px] items-center text-sm font-medium text-brand-600 hover:underline">{t("ads.cgSeriesEmptyLink")}</Link>
              </div>
            ) : (
              <div className="space-y-2">
                {seriesHub.map((s) => (
                  <div key={s.id} className="flex flex-col justify-between gap-2 rounded-lg bg-slate-50 p-3 lg:flex-row lg:items-center">
                    <div className="space-y-0.5 text-sm">
                      <div className="font-medium text-slate-800">{s.name} <span className={`ml-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${s.status === "active" ? "bg-green-100 text-green-700" : s.status === "paused" ? "bg-amber-100 text-amber-700" : "bg-slate-200 text-slate-600"}`}>{s.status === "active" ? t("ads.cgSeriesActive") : s.status === "paused" ? t("ads.cgSeriesPaused") : t("ads.cgSeriesEnded")}</span></div>
                      <div className="text-xs text-slate-500">{t("ads.cgSeriesSource", { name: s.sourcePlanName ?? "—", cadence: SERIES_CADENCE_KEY[s.cadence] ? t(SERIES_CADENCE_KEY[s.cadence]) : s.cadence })}{s.cadence !== "dates" && s.interval ? t("ads.cgSeriesEvery", { interval: fmtNumber(locale, s.interval) }) : ""}{t("ads.cgSeriesNext", { date: s.nextInstanceDate ? fmtDateTime(locale, s.nextInstanceDate) : "—" })}{s.pendingPlan ? t("ads.cgSeriesPending", { name: s.pendingPlan.name, status: s.pendingPlan.status }) : ""}</div>
                      {s.generationHeld ? <p className="text-xs font-medium text-amber-700">{t("ads.cgSeriesHeld")}</p> : null}
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
            <h2 className="text-xl font-bold text-slate-900">{t("ads.cgBlueprintsTitle")}</h2>
            <p className="text-sm text-slate-500">
              {t("ads.cgBlueprintsIntro")}
            </p>
          </div>

          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {blueprints.map((bp) => {
              const oMeta = getCampaignObjectiveMeta(bp.objective, locale);
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

                    <h3 className="text-base font-bold text-slate-900">{locale === "en" && bp.nameEn ? bp.nameEn : bp.name}</h3>
                    <p className="text-xs text-slate-600 leading-relaxed">{(locale === "en" && bp.descriptionEn ? bp.descriptionEn : bp.description) ?? oMeta.description}</p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      className="btn-primary btn-sm w-full font-semibold"
                      onClick={() => setInstantiateBp(bp)}
                    >
                      {t("ads.cgBlueprintStart")}
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
          <h3 className="text-sm font-bold text-slate-900">{t("ads.cgInboxTitle")}</h3>
          <p className="mt-1 text-xs leading-[1.7] text-slate-500">{inbox?.note ?? t("ads.cgInboxNoteDefault")}</p>
          <div className="mt-3 flex flex-wrap items-start gap-2">
            <textarea className="input min-h-[44px] flex-1 text-sm" maxLength={500} placeholder={t("ads.cgSignalPlaceholder")} value={signalText} onChange={(e) => setSignalText(e.target.value)} aria-label={t("ads.cgSignalAria")} />
            <button type="button" className="btn-primary btn-sm font-semibold" disabled={busy !== "" || signalText.trim().length < 3} onClick={() => {
              const orgId = getOrganizationId(); if (!orgId) return;
              void inboxAction("signal-add", () => apiFetch(`/organizations/${orgId}/campaign-plans/builder-inbox`, { method: "POST", body: JSON.stringify({ text: signalText.trim() }) }), t("ads.cgSignalAdded")).then(() => setSignalText(""));
            }}>{t("ads.cgSignalAdd")}</button>
          </div>
          {inbox && (inbox.importable.insights.length + inbox.importable.prices.length + inbox.importable.ads.length) > 0 ? (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-bold text-slate-700">{t("ads.cgImportTitle")}</p>
              <div className="mt-2 grid gap-1">
                {[...inbox.importable.insights, ...inbox.importable.prices, ...inbox.importable.ads].map((r) => (
                  <div key={`${r.source}:${r.sourceRefId}`} className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                    <span>🏷️ {r.competitorName ?? t("ads.cgCompetitorFallback")} — {r.label} <span className="text-slate-400">({r.source === "competitor_insight" ? "Insight" : r.source === "competitor_price" ? "Price" : t("ads.cgImportLongAd")})</span></span>
                    <button type="button" className="btn-secondary btn-sm font-semibold" disabled={busy !== ""} onClick={() => {
                      const orgId = getOrganizationId(); if (!orgId) return;
                      void inboxAction(`imp-${r.sourceRefId}`, () => apiFetch(`/organizations/${orgId}/campaign-plans/builder-inbox/import`, { method: "POST", body: JSON.stringify({ source: r.source, sourceRefId: r.sourceRefId }) }), t("ads.cgImported"));
                    }}>{t("ads.cgImportBtn")}</button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="mt-3 grid gap-2">
            {(inbox?.signals ?? []).length === 0 ? <p className="text-xs text-slate-400">{t("ads.cgNoSignals")}</p> : null}
            {(inbox?.signals ?? []).map((s) => (
              <div key={s.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`rounded-full px-2 py-0.5 font-bold ${s.status === "new" ? "bg-amber-100 text-amber-800" : s.status === "drafted" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>{s.status === "new" ? t("ads.cgSignalNew") : s.status === "drafted" ? t("ads.cgSignalDrafted") : "Dismissed"}</span>
                  <span className="text-slate-400">{s.source === "manual" ? "Manual" : s.source === "competitor_insight" ? "Competitor Insight" : s.source === "competitor_price" ? "Competitor Price" : "Competitor Ad"} · {fmtDateTime(locale, s.createdAt)}</span>
                  {s.productId ? <span className="text-slate-400">{t("ads.cgSignalProductLinked")}</span> : null}
                </div>
                <p className="mt-1 leading-[1.7] text-slate-700">{s.text}</p>
                {s.status === "drafted" ? <p className="mt-1 text-xs text-emerald-700">{t("ads.cgDraftCreated", { id: s.draftPlanId ?? "" })}</p> : null}
                {s.status === "new" ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select className="input w-auto text-xs" value={draftAccount} onChange={(e) => setDraftAccount(e.target.value)} aria-label="Ad Account">
                      <option value="">{t("ads.cgChooseAccount")}</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    <input className="input w-28 text-xs" inputMode="decimal" value={draftBudget} onChange={(e) => setDraftBudget(e.target.value)} aria-label={t("ads.cgDailyBudgetAria")} placeholder={t("ads.cgDailyBudgetPlaceholder")} />
                    <button type="button" className="btn-primary btn-sm font-semibold" disabled={busy !== "" || !draftAccount} onClick={() => {
                      const orgId = getOrganizationId(); if (!orgId) return;
                      void inboxAction(`draft-${s.id}`, () => apiFetch(`/organizations/${orgId}/campaign-plans/builder-inbox/${s.id}/draft`, { method: "POST", body: JSON.stringify({ adAccountId: draftAccount, totalDailyBudget: draftBudget }) }), t("ads.cgCounterDraftDone")).then(() => void loadPlans());
                    }}>{t("ads.cgCounterDraftBtn")}</button>
                    <button type="button" className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => {
                      const orgId = getOrganizationId(); if (!orgId) return;
                      void inboxAction(`dismiss-${s.id}`, () => apiFetch(`/organizations/${orgId}/campaign-plans/builder-inbox/${s.id}/dismiss`, { method: "POST", body: "{}" }), t("ads.cgDismissed"));
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
                <h3 className="text-sm font-bold text-slate-900">{t("ads.cgCalendarTitle")}</h3>
                <p className="text-xs text-slate-400">{t("ads.cgCalendarIntro")}</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" className="btn-secondary btn-sm font-semibold" onClick={() => setCalCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}>←</button>
                <span className="text-sm font-bold text-slate-800">{new Intl.DateTimeFormat(locale === "en" ? "en-IN" : "bn-BD", { month: "long", year: "numeric" }).format(calCursor)}</span>
                <button type="button" className="btn-secondary btn-sm font-semibold" onClick={() => setCalCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}>→</button>
              </div>
            </div>
            {calMonthCount === 0 ? (
              <div className="cbx-empty">
                <div className="cbx-empty-title">{t("ads.cgCalendarEmptyTitle")}</div>
                <div className="cbx-empty-text">{t("ads.cgCalendarEmptyText")}</div>
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-1">
                {[t("ads.cgDayMon"), t("ads.cgDayTue"), t("ads.cgDayWed"), t("ads.cgDayThu"), t("ads.cgDayFri"), t("ads.cgDaySat"), t("ads.cgDaySun")].map((d) => (
                  <div key={d} className="pb-1 text-center text-[11px] font-bold text-slate-400">{d}</div>
                ))}
                {calCells.map((cell) => {
                  const items = calItems.get(`${cell.day.getFullYear()}-${cell.day.getMonth()}-${cell.day.getDate()}`) ?? [];
                  return (
                    <div key={cell.day.toISOString()} className={`min-h-[64px] rounded-lg border p-1 ${cell.inMonth ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 text-slate-300"} ${cell.isToday ? "ring-2 ring-[var(--brand-ring)]" : ""}`}>
                      <div className="text-[11px] font-bold">{fmtNumber(locale, cell.day.getDate())}</div>
                      {items.slice(0, 2).map((it, i) => (
                        <div key={i} className={`mt-0.5 truncate text-[10px] font-medium leading-tight ${it.kind === "series" ? "rounded bg-violet-100 px-1 text-violet-800" : ""}`} title={it.display}>
                          <span>{it.kind === "published" ? "🟢" : it.kind === "scheduled" ? "🟠" : it.kind === "series" ? "🟣" : "⚪"}</span> {it.display}
                        </div>
                      ))}
                      {items.length > 2 ? <div className="text-[10px] font-semibold text-slate-400">{t("ads.cgCalendarMore", { count: fmtNumber(locale, items.length - 2) })}</div> : null}
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
          <button onClick={() => setError("")} className="text-xs text-red-500 hover:text-red-700">{t("ads.cgClose")}</button>
        </div>
      )}

      {notice && (
        <div role="status" className="flex items-center justify-between rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 border border-emerald-200 shadow-sm">
          <div className="flex items-center gap-2">
            <span>✓</span>
            <span>{notice}</span>
          </div>
          <button onClick={() => setNotice("")} className="text-xs text-emerald-600 hover:text-emerald-800">{t("ads.cgClose")}</button>
        </div>
      )}

      {/* CN8: Portfolio totals across ad accounts (platform-reported synced rows; currencies never mixed) */}
      {portfolio && portfolio.accounts.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-800">{t("ads.cgPortfolioTitle")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {portfolio.totalByCurrency.map((tot) => (
              <span key={tot.currency} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs text-slate-700">{t("ads.cgPortfolioTotal", { currency: tot.currency, spend: fmtMoneyBn(tot.spendMinor), impressions: fmtNumBn(tot.impressions), clicks: fmtNumBn(tot.clicks), conversions: fmtNumber(locale, tot.conversions) })}</span>
            ))}
          </div>
          <div className="mt-2 space-y-0.5">
            {portfolio.accounts.map((a) => (
              <p key={a.adAccountId} className="text-xs text-slate-600">{t("ads.cgPortfolioAccount", { name: a.name, platform: a.platform ?? "—", currency: a.currency, spend: fmtMoneyBn(a.spendMinor), impressions: fmtNumBn(a.impressions), conversions: fmtNumber(locale, a.conversions), cpa: a.cpaMinor ? fmtMoneyBn(a.cpaMinor) : "—" })}</p>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">{t("ads.cgPortfolioNote")}</p>
        </div>
      ) : null}

      {portfolio && portfolio.accounts.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="flex items-start gap-2 text-sm leading-[1.7] text-slate-600"><span aria-hidden>💼</span><span>{t("ads.cgPortfolioEmpty")}</span></p>
          <Link href="/dashboard/ad-accounts" className="mt-1 inline-flex min-h-[40px] items-center text-sm font-medium text-brand-600 hover:underline">{t("ads.cgPortfolioLink")}</Link>
        </div>
      ) : null}

      {/* Frontier NB8 (CN18): budget simulator + competitor-response draft */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-800">{t("ads.cgSimTitle")}</p>
          <p className="mt-1 text-xs leading-[1.7] text-slate-500">{t("ads.cgSimIntro")}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select className="input w-48" value={simForm.objective} onChange={(e) => setSimForm({ ...simForm, objective: e.target.value })}>
              <option value="OUTCOME_SALES">Sales</option>
              <option value="OUTCOME_TRAFFIC">Traffic</option>
              <option value="OUTCOME_LEADS">Leads</option>
              <option value="OUTCOME_ENGAGEMENT">Engagement</option>
              <option value="OUTCOME_AWARENESS">Awareness</option>
            </select>
            <input className="input w-32" type="number" min="1" value={simForm.dailyBudget} onChange={(e) => setSimForm({ ...simForm, dailyBudget: e.target.value })} placeholder={t("ads.cgSimDailyPlaceholder")} />
            <input className="input w-24" type="number" min="1" max="90" value={simForm.days} onChange={(e) => setSimForm({ ...simForm, days: e.target.value })} placeholder={t("ads.cgSimDaysPlaceholder")} />
            <button type="button" className="btn-primary btn-sm" disabled={busy !== ""} onClick={async () => {
              const res = await wrap("simulator", () => apiFetch<any>(`/organizations/${getOrganizationId()}/campaign-plans/budget-simulator`, { method: "POST", body: JSON.stringify({ objective: simForm.objective, dailyBudget: simForm.dailyBudget || "0", days: Number(simForm.days) || 30 }) }));
              if (res) setSimResult(res);
            }}>{t("ads.cgSimRun")}</button>
          </div>
          {simResult ? (
            simResult.available ? (
              <div className="mt-2 text-xs leading-[1.7] text-slate-600">
                <p className="text-sm text-slate-800">{t("ads.cgSimRange", { days: fmtNumBn(simResult.input.days) })}<b>{fmtNumBn(simResult.projected.impressions.low)}–{fmtNumBn(simResult.projected.impressions.high)}</b> · Clicks <b>{fmtNumBn(simResult.projected.clicks.low)}–{fmtNumBn(simResult.projected.clicks.high)}</b>{simResult.projected.conversions ? <> · Conversions <b>{fmtNumBn(simResult.projected.conversions.low)}–{fmtNumBn(simResult.projected.conversions.high)}</b></> : t("ads.cgSimConversionsNone")}</p>
                <p className="mt-1">{t("ads.cgSimSample")}<b>{fmtNumBn(simResult.sample.campaigns)}</b>{t("ads.cgSimSampleCampaigns")}<b>{fmtNumBn(simResult.sample.campaignDays)}</b>{t("ads.cgSimSampleDays")}{simResult.currency} · Median CPM {fmtMoneyBn(simResult.medians.cpmMinor)} · CTR {simResult.medians.ctrPercent}%{simResult.medians.cpaMinor ? ` · Median CPA ${fmtMoneyBn(simResult.medians.cpaMinor)}` : ""}</p>
                <p className="mt-1 text-slate-500">{simResult.method}</p>
                <p className="mt-1 text-slate-400">{simResult.note}</p>
              </div>
            ) : (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-[1.7] text-amber-800">
                <p>⛔ {simResult.reason}</p>
                <p className="mt-1">{t("ads.cgSimNextStep")}</p>
              </div>
            )
          ) : null}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-800">{t("ads.cgRespTitle")}</p>
          <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs leading-[1.7] text-slate-600">{t("ads.cgRespRule")}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
              const [comps, prods] = await Promise.all([
                apiFetch<{ id: string; name: string }[]>(`/organizations/${getOrganizationId()}/competitors`).catch(() => []),
                apiFetch<{ id: string; name: string }[]>(`/organizations/${getOrganizationId()}/products`).catch(() => []),
              ]);
              setRespLists({ competitors: asList(comps), products: asList(prods) });
            }}>{t("ads.cgRespLoadLists")}</button>
            <select className="input w-48" value={respForm.competitorId} onChange={(e) => setRespForm({ ...respForm, competitorId: e.target.value })}>
              <option value="">{t("ads.cgRespChooseCompetitor")}</option>
              {(respLists?.competitors ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="input w-48" value={respForm.productId} onChange={(e) => setRespForm({ ...respForm, productId: e.target.value })}>
              <option value="">{t("ads.cgRespChooseProduct")}</option>
              {(respLists?.products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select className="input w-52" value={respForm.adAccountId} onChange={(e) => setRespForm({ ...respForm, adAccountId: e.target.value })}>
              <option value="">{t("ads.cgRespChooseAccount")}</option>
              {accounts.filter((a) => a.platform === "meta").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button type="button" className="btn-primary btn-sm" disabled={busy !== "" || !respForm.competitorId || !respForm.productId || !respForm.adAccountId} onClick={async () => {
              const res = await wrap("competitor-response", () => apiFetch<any>(`/organizations/${getOrganizationId()}/campaign-plans/competitor-response`, { method: "POST", body: JSON.stringify(respForm) }));
              if (res) { setRespResult(res); setNotice(t("ads.cgRespCreated", { name: res.plan.name })); }
            }}>{t("ads.cgRespCreate")}</button>
          </div>
          {respResult ? (
            <div className="mt-2 text-xs text-slate-600">
              <p>{t("ads.cgRespAngle")}<b>{respResult.angleNote}</b></p>
              <p className="mt-1">{respResult.rule}</p>
              <p className="mt-1">{respResult.note} <Link className="font-medium text-brand-600 hover:underline" href={`/dashboard/campaign-builder?id=${respResult.plan.id}`}>{t("ads.cgRespOpenBuilder")}</Link></p>
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
            <h3 className="text-lg font-bold text-slate-900">{t("ads.cgRejectTitle")}</h3>
            <p className="text-xs text-slate-500">
              {t("ads.cgRejectBody")}
            </p>
            <textarea
              className="input w-full text-sm"
              rows={3}
              placeholder={t("ads.cgRejectPlaceholder")}
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
                {t("ads.cgCancel")}
              </button>
              <button
                type="button"
                className="btn-primary btn-sm bg-rose-600 hover:bg-rose-700"
                onClick={confirmReject}
              >
                {t("ads.cgRejectConfirm")}
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
              <h3 className="text-lg font-bold text-slate-900">{t("ads.cgBpModalTitle")}</h3>
              <p className="text-xs text-slate-500">{t("ads.cgBpModalBody", { name: locale === "en" && instantiateBp.nameEn ? instantiateBp.nameEn : instantiateBp.name })}</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Meta Ad Account</label>
              {accounts.length === 0 ? (
                <p className="text-xs text-rose-600 bg-rose-50 p-2 rounded-lg">
                  {t("ads.cgBpNoAccount")}
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
                {t("ads.cgCancel")}
              </button>
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={!selectedAccountId || busy.startsWith("instantiate-")}
                onClick={instantiateBlueprint}
              >
                {t("ads.cgBpCreateGo")}
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
                <h3 className="text-lg font-bold text-slate-900">{t("ads.cgWizardTitle")}</h3>
                <p className="mt-1 max-w-3xl text-xs leading-[1.7] text-slate-500">{t("ads.cgWizardIntro")}</p>
              </div>
              <button type="button" className="btn-secondary btn-sm min-h-[40px]" onClick={() => setShowFunnel(false)}>{t("ads.cgCloseBtn")}</button>
            </div>

            {funnelSourcesFailed ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-[1.7] text-amber-800">{t("ads.cgSourcesUnavailable")}</p>
            ) : null}

            <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
              <div className="space-y-2 lg:sticky lg:top-4">
                <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
                  <div className="text-sm font-bold text-slate-800">{t("ads.cgLayerProTitle")}</div>
                  <p className="mt-1 text-xs leading-[1.7] text-slate-600">{t("ads.cgLayerProBody")}</p>
                </div>
                <div className="text-center text-sm text-slate-400">↓</div>
                <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
                  <div className="text-sm font-bold text-slate-800">{t("ads.cgLayerReTitle")}</div>
                  <p className="mt-1 text-xs leading-[1.7] text-slate-600">{t("ads.cgLayerReBody")}</p>
                </div>
                <div className="text-center text-sm text-slate-400">↓</div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                  <div className="text-sm font-bold text-slate-800">{t("ads.cgLayerRnTitle")}</div>
                  <p className="mt-1 text-xs leading-[1.7] text-slate-600">{t("ads.cgLayerRnBody")}</p>
                </div>
                <p className="text-xs leading-[1.7] text-slate-500">{t("ads.cgLayersNote")}</p>
              </div>

              <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">{t("ads.cgPlanNameLabel")}<input className="input mt-1 w-full" value={funnelForm.name} onChange={(e) => setFunnelForm({ ...funnelForm, name: e.target.value })} placeholder={t("ads.cgPlanNamePlaceholder")} /></label>
              <label className="block text-sm">{t("ads.cgAccountLabel")}
                <select className="input mt-1 w-full" value={funnelForm.adAccountId || selectedAccountId} onChange={(e) => setFunnelForm({ ...funnelForm, adAccountId: e.target.value })}>
                  <option value="">{t("ads.cgChoosePlaceholder")}</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.platform})</option>)}
                </select>
              </label>
              <label className="block text-sm">Objective
                <select className="input mt-1 w-full" value={funnelForm.objective} onChange={(e) => setFunnelForm({ ...funnelForm, objective: e.target.value })}>
                  {Object.entries(CAMPAIGN_OBJECTIVES).map(([k, v]) => <option key={k} value={k}>{v.icon} {locale === "en" ? v.labelEn : v.label}</option>)}
                </select>
              </label>
              <label className="block text-sm">Budget Mode
                <select className="input mt-1 w-full" value={funnelForm.budgetMode} onChange={(e) => setFunnelForm({ ...funnelForm, budgetMode: e.target.value })}>
                  <option value="abo">{locale === "en" ? "ABO — budget on the ad set" : "ABO — বাজেট Ad Set এ"}</option>
                  <option value="cbo">{locale === "en" ? "CBO — budget on the campaign" : "CBO — বাজেট Campaign এ"}</option>
                </select>
              </label>
              <label className="block text-sm">{t("ads.cgCboBudgetLabel")}<input className="input mt-1 w-full" value={funnelForm.campaignDailyBudget} onChange={(e) => setFunnelForm({ ...funnelForm, campaignDailyBudget: e.target.value })} placeholder={t("ads.cgOptionalPlaceholder")} /></label>
              <label className="block text-sm">{t("ads.cgBudgetCapLabel")}<input className="input mt-1 w-full" value={funnelForm.dailyBudgetCap} onChange={(e) => setFunnelForm({ ...funnelForm, dailyBudgetCap: e.target.value })} placeholder={t("ads.cgOptionalPlaceholder")} /></label>
              <label className="block text-sm">{t("ads.cgPageIdLabel")}<input className="input mt-1 w-full" value={funnelForm.pageId} onChange={(e) => setFunnelForm({ ...funnelForm, pageId: e.target.value })} /></label>
              <label className="block text-sm">{t("ads.cgPixelIdLabel")}<input className="input mt-1 w-full" value={funnelForm.pixelId} onChange={(e) => setFunnelForm({ ...funnelForm, pixelId: e.target.value })} /></label>
            </div>

            <div className="space-y-2 rounded-lg bg-slate-50 p-3">
              <div className="text-sm font-semibold">{t("ads.cgStarterCopyTitle")}</div>
              <label className="block text-sm">Primary Text<textarea className="input mt-1 w-full" rows={3} value={funnelForm.primaryText} onChange={(e) => setFunnelForm({ ...funnelForm, primaryText: e.target.value })} /></label>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-sm">Headline<input className="input mt-1 w-full" value={funnelForm.headline} onChange={(e) => setFunnelForm({ ...funnelForm, headline: e.target.value })} placeholder={t("ads.cgOptionalPlaceholder")} /></label>
                <label className="block text-sm">Link URL<input className="input mt-1 w-full" value={funnelForm.linkUrl} onChange={(e) => setFunnelForm({ ...funnelForm, linkUrl: e.target.value })} placeholder="https://..." /></label>
                <label className="block text-sm">Call To Action<input className="input mt-1 w-full" value={funnelForm.callToAction} onChange={(e) => setFunnelForm({ ...funnelForm, callToAction: e.target.value })} placeholder="SHOP_NOW" /></label>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-violet-200 bg-violet-50 p-3">
              <div className="text-sm font-semibold">{t("ads.cgProLayerTitle")}</div>
              <div className="grid gap-3 sm:grid-cols-4">
                <label className="block text-sm">{t("ads.cgDailyBudgetLabel")}<input className="input mt-1 w-full" value={funnelForm.proDaily} onChange={(e) => setFunnelForm({ ...funnelForm, proDaily: e.target.value })} placeholder="1000" /></label>
                <label className="block text-sm">{t("ads.cgCountriesLabel")}<input className="input mt-1 w-full" value={funnelForm.proCountries} onChange={(e) => setFunnelForm({ ...funnelForm, proCountries: e.target.value })} placeholder="BD" /></label>
                <label className="block text-sm">{t("ads.cgAgeFrom")}<input type="number" className="input mt-1 w-full" value={funnelForm.ageMin} onChange={(e) => setFunnelForm({ ...funnelForm, ageMin: e.target.value })} placeholder="18" /></label>
                <label className="block text-sm">{t("ads.cgAgeTo")}<input type="number" className="input mt-1 w-full" value={funnelForm.ageMax} onChange={(e) => setFunnelForm({ ...funnelForm, ageMax: e.target.value })} placeholder="65" /></label>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-sky-200 bg-sky-50 p-3">
              <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={funnelForm.useRetargeting} onChange={(e) => setFunnelForm({ ...funnelForm, useRetargeting: e.target.checked })} /> {t("ads.cgReLayerLabel")}</label>
              {funnelSourceLines("retargeting")}
              {funnelForm.useRetargeting ? <label className="block text-sm">{t("ads.cgDailyBudgetLabel")}<input className="input mt-1 w-full" value={funnelForm.reDaily} onChange={(e) => setFunnelForm({ ...funnelForm, reDaily: e.target.value })} placeholder="500" /></label> : null}
            </div>

            <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={funnelForm.useRetention} onChange={(e) => setFunnelForm({ ...funnelForm, useRetention: e.target.checked })} /> {t("ads.cgRnLayerLabel")}</label>
              {funnelSourceLines("retention")}
              {funnelForm.useRetention ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block text-sm">{t("ads.cgDailyBudgetLabel")}<input className="input mt-1 w-full" value={funnelForm.rnDaily} onChange={(e) => setFunnelForm({ ...funnelForm, rnDaily: e.target.value })} placeholder="300" /></label>
                  <label className="block text-sm">{t("ads.cgCatalogIdLabel")}<input className="input mt-1 w-full" value={funnelForm.catalogRecordId} onChange={(e) => setFunnelForm({ ...funnelForm, catalogRecordId: e.target.value })} /></label>
                  <label className="block text-sm">{t("ads.cgProductSetIdLabel")}<input className="input mt-1 w-full" value={funnelForm.productSetId} onChange={(e) => setFunnelForm({ ...funnelForm, productSetId: e.target.value })} /></label>
                </div>
              ) : null}
            </div>

            {(funnelForm.useRetargeting || funnelForm.useRetention) ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-[1.7] text-amber-800">{t("ads.cgEmptyLayerWarning")}</p>
            ) : null}

            {funnelResult ? (
              <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                <div className="text-sm font-semibold">{t("ads.cgResultTitle", { name: funnelResult.plan.name })}</div>
                {funnelResult.layers.map((l) => (
                  <div key={l.layer} className="flex flex-wrap items-start gap-2 text-sm">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${l.status === "complete" ? "bg-green-100 text-green-700" : l.status === "incomplete" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700"}`}>{l.layer}: {l.status}</span>
                    {l.reason ? <span className="text-xs text-slate-600">{l.reason}</span> : null}
                    {!l.reason && l.missingSources?.length ? <span className="text-xs text-slate-500">{t("ads.cgMissingSource", { sources: l.missingSources.join(", ") })}</span> : null}
                  </div>
                ))}
                <Link href={`/dashboard/campaign-builder?id=${funnelResult.plan.id}&step=4`} className="btn-primary btn-sm inline-flex font-semibold">{t("ads.cgOpenPlanReview")}</Link>
              </div>
            ) : null}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" className="btn-secondary btn-sm min-h-[40px]" onClick={() => setShowFunnel(false)}>{t("ads.cgCloseBtn")}</button>
              <button type="button" className="btn-primary btn-sm min-h-[40px]" disabled={busy === "funnel-create"} onClick={submitFunnel}>
                {busy === "funnel-create" ? t("ads.cgCreating") : t("ads.cgCreateFunnelPlan")}
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
