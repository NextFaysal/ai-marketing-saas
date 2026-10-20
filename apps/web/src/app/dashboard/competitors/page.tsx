"use client";
import React, { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { fmtDate, fmtMoneyMinor, fmtNumber } from "@repo/contracts";
import { EmptyState } from "@repo/ui";
import { useLocale } from "@/lib/i18n/provider";

const CompetitorDossierModal = dynamic(() => import("./CompetitorDossierModal"), { ssr: false });

interface Competitor {
  id: string;
  name: string;
  facebookPageId?: string | null;
  facebookPageUrl?: string | null;
  websiteUrl?: string | null;
  notes?: string | null;
  stats: { ads: number; activeAds: number; priceObservations: number };
}

interface Ad {
  id: string;
  externalAdId: string;
  pageName?: string | null;
  startedAt?: string | null;
  stoppedAt?: string | null;
  isActive: boolean;
  platforms: string[];
  creativeText?: string | null;
  snapshotUrl?: string | null;
  linkUrl?: string | null;
  daysRunning?: number;
  isWinning?: boolean;
  isFresh?: boolean;
}

interface Obs {
  id: string;
  productName: string;
  priceMinor: string;
  currency: string;
  sourceUrl: string;
  sourceType: string;
  observedAt: string;
}

interface Insight {
  id: string;
  kind: string;
  title: string;
  detail?: string | null;
  evidence: { ref: string; label: string; url?: string }[];
  provider: string;
  createdAt: string;
}

interface ComparisonRow {
  productId: string;
  productName: string;
  ownPriceMinor: string;
  currency: string;
  competitorPrices: {
    competitorName: string;
    observedProductName: string;
    priceMinor: string;
    currency: string;
    diffPercent: number | null;
    sourceUrl: string;
    observedAt: string;
  }[];
}

interface Product {
  id: string;
  name: string;
  priceMinor: string;
  currency: string;
}

interface CounterAdResult {
  origin: "ai" | "template";
  hookBreakdown: {
    hookType: string;
    competitorAngle: string;
    weaknesses: string[];
  };
  counterCampaign: {
    headline: string;
    primaryText: string;
    callToAction: string;
    suggestedOffer: string;
    whyThisBeatsCompetitor: string;
  };
}

interface DossierData {
  generatedAt: string;
  agencyBranding: {
    organizationName: string;
    currency: string;
    brandSettings?: Record<string, unknown> | null;
  };
  summary: {
    totalCompetitorsTracked: number;
    totalAlertsActive: number;
    priceGapsDetected: number;
  };
  competitors: {
    competitor: Competitor;
    totalAds: number;
    activeAds: number;
    winningAdsCount: number;
    winningAds: Ad[];
    recentAds: Ad[];
    priceObservationsCount: number;
    recentObservations: Obs[];
  }[];
  priceComparisonMatrix: ComparisonRow[];
  liveOpportunityAlerts: Insight[];
  strategicInsights: Insight[];
}

interface SeoOnPageAudit {
  domain: string;
  available: boolean;
  reason?: string;
  fetchedUrl?: string;
  title?: string;
  metaDescription?: string;
  productSchemaPresent: boolean;
  og: { title?: string; description?: string; image?: string };
  sitemapPresent: boolean;
  observedPhrases: { source: "title" | "h1" | "h2"; text: string }[];
  internalLinks: { url: string; kind: "shop" | "product" | "offer" | "page" }[];
}

interface SeoStrategyResult {
  competitor: {
    id: string;
    name: string;
    domain: string;
  };
  seoAudit: SeoOnPageAudit;
  strategy: {
    recommendedMetaTitle: string;
    recommendedMetaDescription: string;
    targetKeywords: string[];
    outrankTactics: string;
  };
  origin: "ai" | "template";
}

interface ScriptScene {
  timeRange: string;
  phase: string;
  visualCue: string;
  audioVoiceover: string;
  onScreenText: string;
  directorNotes: string;
}

interface DeconstructedVideoScript {
  competitorAdId: string;
  origin: "ai" | "template";
  format: string;
  totalDurationSeconds: number;
  hookCategory: string;
  competitorHookBreakdown: {
    firstThreeSecondsHook: string;
    whyItRetainsViewers: string;
    coreEmotionalTrigger: string;
  };
  adaptedScript: {
    conceptTitle: string;
    targetProductName: string;
    scenes: ScriptScene[];
    fullVoiceoverBangla: string;
    creatorShootingChecklist: string[];
    suggestedAudioTrack: string;
  };
}

interface CustomerComplaintTheme {
  category: string;
  frequencyPercent: number;
  itemCount: number;
  complaintSummary: string;
  sampleCustomerQuotes: string[];
  severity: "High" | "Medium" | "Critical";
}

interface ReviewCounterAngle {
  hookHeadline: string;
  trustMechanism: string;
  guaranteeOffer: string;
  whyBuyersSwitch: string;
}

// HF4: discriminated union — without pasted input there is only an
// honest unavailable state, never a fabricated report.
type CompetitorReviewMineReport =
  | { available: false; competitorName: string; reason: string }
  | {
      available: true;
      competitorName: string;
      totalAnalyzedFeedback: number;
      overallRatingScore: number | null;
      sentimentDistribution: {
        satisfied: number;
        neutral: number;
        dissatisfied: number;
      };
      topComplaints: CustomerComplaintTheme[];
      biggestVulnerability: string;
      recommendedCounterAngles: ReviewCounterAngle[];
    };

interface AlertChannelConfig {
  telegramEnabled: boolean;
  telegramBotToken?: string;
  telegramChatId?: string;
  whatsappEnabled: boolean;
  whatsappWebhookUrl?: string;
  notifyOnPriceDrop: boolean;
  notifyOnStockOut: boolean;
  notifyOnWinningAd: boolean;
}

interface FunnelAuditReport {
  competitorName: string;
  domain: string;
  scanned: boolean;
  reason?: string;
  pagesScanned: string[];
  checkoutDetected: boolean;
  checkoutFieldCount: number | null;
  checkoutFields: string[];
  paymentGatewaysDetected: string[];
  trustSignalsDetected: string[];
  bundleHints: string[];
  generalTips: {
    tactic: string;
    impact: "High" | "Medium" | "Critical";
    howToBeatThem: string;
  }[];
}

interface DynamicPricingRuleItem {
  id: string;
  name: string;
  triggerType: "COMPETITOR_STOCK_OUT" | "COMPETITOR_PRICE_DROP" | "COMPETITOR_PRICE_INCREASE" | "COMPETITOR_NEW_WINNING_AD";
  actionType: "BOOST_AD_BUDGET" | "SUGGEST_PRICE_MATCH" | "TRIGGER_FLASH_SALE_BUNDLE" | "PAUSE_UNDERPERFORMING_ADS";
  conditions: {
    priceDropThresholdPercent?: number;
    priceIncreaseThresholdPercent?: number;
  };
  actions: {
    budgetBoostPercent?: number;
    priceAdjustmentPercent?: number;
    suggestedHeadline?: string;
  };
  enabled: boolean;
  lastTriggeredAt?: string | null;
  triggerCount: number;
  recentExecutions?: {
    timestamp: string;
    description: string;
    status: "EXECUTED" | "SIMULATED" | "SKIPPED";
  }[];
}

export default function CompetitorsPage() {
  const { t, locale } = useLocale();
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [active, setActive] = useState<Competitor | null>(null);
  const [ads, setAds] = useState<Ad[]>([]);
  const [observations, setObservations] = useState<Obs[]>([]);
  const [comparison, setComparison] = useState<ComparisonRow[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [alerts, setAlerts] = useState<Insight[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  // Workspace Tabs
  const [activeTab, setActiveTab] = useState<"spy" | "swipefile" | "pricing" | "playbook" | "seo" | "complaints" | "funnel">("spy");

  // Funnel Audit State
  const [funnelReport, setFunnelReport] = useState<FunnelAuditReport | null>(null);
  const [loadingFunnel, setLoadingFunnel] = useState(false);


  // Swipe File (Saved creatives)
  const [savedSwipeIds, setSavedSwipeIds] = useState<string[]>([]);

  // White-label Dossier Modal
  const [isDossierOpen, setIsDossierOpen] = useState(false);
  const [dossierData, setDossierData] = useState<DossierData | null>(null);
  const [loadingDossier, setLoadingDossier] = useState(false);

  // SEO & Traffic Spy State
  const [seoReport, setSeoReport] = useState<SeoOnPageAudit | null>(null);
  const [seoStrategy, setSeoStrategy] = useState<SeoStrategyResult | null>(null);
  const [loadingSeo, setLoadingSeo] = useState(false);
  const [generatingSeoGap, setGeneratingSeoGap] = useState(false);
  const [selectedProductIdForSeo, setSelectedProductIdForSeo] = useState<string>("");

  // Video Script Deconstructor Modal State
  const [videoModalAd, setVideoModalAd] = useState<Ad | null>(null);
  const [videoScriptResult, setVideoScriptResult] = useState<DeconstructedVideoScript | null>(null);
  const [isVideoDeconstructing, setIsVideoDeconstructing] = useState(false);
  const [selectedProductIdForVideo, setSelectedProductIdForVideo] = useState<string>("");
  const [videoScriptStyle, setVideoScriptStyle] = useState<string>("ugc");

  // Review Mine State
  const [reviewMineReport, setReviewMineReport] = useState<CompetitorReviewMineReport | null>(null);
  const [reviewText, setReviewText] = useState("");
  const [loadingReviewMine, setLoadingReviewMine] = useState(false);

  // Alert Bot Modal State
  const [isAlertSettingsOpen, setIsAlertSettingsOpen] = useState(false);
  const [alertConfig, setAlertConfig] = useState<AlertChannelConfig>({
    telegramEnabled: false,
    telegramBotToken: "",
    telegramChatId: "",
    whatsappEnabled: false,
    whatsappWebhookUrl: "",
    notifyOnPriceDrop: true,
    notifyOnStockOut: true,
    notifyOnWinningAd: true,
  });
  const [isSavingAlertConfig, setIsSavingAlertConfig] = useState(false);
  const [isTestingAlert, setIsTestingAlert] = useState(false);

  // Dynamic Pricing & Automated Budget Rules State
  const [dynamicRules, setDynamicRules] = useState<DynamicPricingRuleItem[]>([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [isSavingRules, setIsSavingRules] = useState(false);
  const [simulatingRuleId, setSimulatingRuleId] = useState<string | null>(null);

  // Forms & Modals

  const [form, setForm] = useState({ name: "", facebookPageId: "", websiteUrl: "", notes: "" });

  const [editCompetitor, setEditCompetitor] = useState<Competitor | null>(null);
  const [obsForm, setObsForm] = useState({ productName: "", price: "", sourceUrl: "" });
  
  // Filter for ads
  const [adFilter, setAdFilter] = useState<"all" | "active" | "winning">("all");
  const [platformFilter, setPlatformFilter] = useState<"all" | "facebook" | "google" | "tiktok" | "bing">("all");

  // Counter Ad State
  const [counterModalAd, setCounterModalAd] = useState<Ad | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [counterAdResult, setCounterAdResult] = useState<CounterAdResult | null>(null);
  const [isGeneratingCounterAd, setIsGeneratingCounterAd] = useState(false);
  const [copiedText, setCopiedText] = useState("");


  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  // Load Saved Swipe file from local storage
  useEffect(() => {
    try {
      const stored = localStorage.getItem("competitor_swipe_file");
      if (stored) setSavedSwipeIds(JSON.parse(stored));
    } catch {
      // ignore
    }
  }, []);

  const toggleSwipeSave = (adId: string) => {
    let next: string[];
    if (savedSwipeIds.includes(adId)) {
      next = savedSwipeIds.filter((id) => id !== adId);
      setNotice(t("social.cmSwipeRemoved"));
    } else {
      next = [...savedSwipeIds, adId];
      setNotice(t("social.cmSwipeSaved"));
    }
    setSavedSwipeIds(next);
    localStorage.setItem("competitor_swipe_file", JSON.stringify(next));
  };

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const [c, cmp, ins, alertsData, prodRes] = await Promise.all([
        apiFetch<Competitor[]>(`/organizations/${orgId}/competitors`),
        apiFetch<{ rows: ComparisonRow[] }>(`/organizations/${orgId}/competitors/price-comparison`),
        apiFetch<Insight[]>(`/organizations/${orgId}/competitors/insights`),
        apiFetch<Insight[]>(`/organizations/${orgId}/competitors/alerts`).catch(() => []),
        apiFetch<{ items?: Product[]; products?: Product[] } | Product[]>(`/organizations/${orgId}/products`).catch(() => []),
      ]);
      setCompetitors(c);
      setComparison(cmp.rows);
      setInsights(ins);
      setAlerts(alertsData);

      const prodList = Array.isArray(prodRes) ? prodRes : (prodRes?.items || prodRes?.products || []);
      setProducts(prodList);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    }
  }, []);

  useEffect(() => {
    load();
    loadAlertSettings();
    loadDynamicRules();
  }, [load]);

  async function loadDynamicRules() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setLoadingRules(true);
    try {
      const res = await apiFetch<DynamicPricingRuleItem[]>(`/organizations/${orgId}/competitors/rules`);
      if (res && Array.isArray(res)) setDynamicRules(res);
    } catch {
      // ignore
    } finally {
      setLoadingRules(false);
    }
  }

  async function toggleRule(ruleId: string) {
    const updated = dynamicRules.map((r) =>
      r.id === ruleId ? { ...r, enabled: !r.enabled } : r
    );
    setDynamicRules(updated);
    const orgId = getOrganizationId();
    if (!orgId) return;
    setIsSavingRules(true);
    try {
      await apiFetch(`/organizations/${orgId}/competitors/rules`, {
        method: "POST",
        body: JSON.stringify({ rules: updated }),
      });
      setNotice(t("social.cmRuleUpdated"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update rule");
    } finally {
      setIsSavingRules(false);
    }
  }

  async function simulateRuleTriggerHandler(rule: DynamicPricingRuleItem) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setSimulatingRuleId(rule.id);
    setError("");
    try {
      const res = await apiFetch<{ triggeredCount: number; results: any[] }>(
        `/organizations/${orgId}/competitors/rules/simulate`,
        {
          method: "POST",
          body: JSON.stringify({
            triggerType: rule.triggerType,
            competitorName: active?.name || t("misc.zzCompSimCompetitorFallback"),
            productName: t("misc.zzCompSimProductSample"),
            percentageChange: rule.conditions.priceDropThresholdPercent || 15,
          }),
        }
      );
      if (res.triggeredCount > 0) {
        setNotice(t("social.cmRuleTriggered", { action: res.results[0]?.actionTaken || "Action executed!" }));
        await loadDynamicRules();
      } else {
        setNotice(t("social.cmRuleNoMatch"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to trigger simulation");
    } finally {
      setSimulatingRuleId(null);
    }
  }

  async function loadAlertSettings() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const res = await apiFetch<AlertChannelConfig>(`/organizations/${orgId}/competitors/alert-settings`);
      if (res) setAlertConfig(res);
    } catch {
      // ignore
    }
  }

  async function saveAlertSettingsHandler(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId();
    if (!orgId) return;
    setIsSavingAlertConfig(true);
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/competitors/alert-settings`, {
        method: "POST",
        body: JSON.stringify(alertConfig),
      });
      setNotice(t("social.cmAlertSettingsSaved"));
      setIsAlertSettingsOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save alert settings");
    } finally {
      setIsSavingAlertConfig(false);
    }
  }

  async function testAlertChannelHandler(channel: "telegram" | "whatsapp") {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setIsTestingAlert(true);
    setError("");
    try {
      const res = await apiFetch<{ success: boolean; error?: string }>(
        `/organizations/${orgId}/competitors/alert-settings/test`,
        {
          method: "POST",
          body: JSON.stringify({
            channel,
            telegramBotToken: alertConfig.telegramBotToken,
            telegramChatId: alertConfig.telegramChatId,
            whatsappWebhookUrl: alertConfig.whatsappWebhookUrl,
          }),
        }
      );
      if (res.success) {
        setNotice(t("social.cmTestSent", { channel: channel === "telegram" ? "Telegram" : "WhatsApp" }));
      } else {
        setError(t("social.cmTestFailed", { error: res.error || "Unknown error" }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send test alert");
    } finally {
      setIsTestingAlert(false);
    }
  }


  const fetchSeoReport = useCallback(async (c: Competitor) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setLoadingSeo(true);
    setError("");
    try {
      const report = await apiFetch<SeoOnPageAudit>(`/organizations/${orgId}/competitors/${c.id}/seo-traffic`);
      setSeoReport(report);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load SEO report");
    } finally {
      setLoadingSeo(false);
    }
  }, []);

  async function generateSeoGapHandler(c: Competitor) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setGeneratingSeoGap(true);
    setError("");
    try {
      const res = await apiFetch<SeoStrategyResult>(`/organizations/${orgId}/competitors/${c.id}/seo-gap`, {
        method: "POST",
        body: JSON.stringify({ ownProductId: selectedProductIdForSeo || undefined }),
      });
      setSeoStrategy(res);
      setNotice(t("social.cmSeoGapDone"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate SEO gap strategy");
    } finally {
      setGeneratingSeoGap(false);
    }
  }

  async function deconstructVideoScriptHandler() {
    if (!videoModalAd || !active) return;
    const orgId = getOrganizationId();
    if (!orgId) return;
    setIsVideoDeconstructing(true);
    setError("");
    try {
      const res = await apiFetch<DeconstructedVideoScript>(
        `/organizations/${orgId}/competitors/${active.id}/video-script`,
        {
          method: "POST",
          body: JSON.stringify({
            competitorAdId: videoModalAd.id,
            ownProductId: selectedProductIdForVideo || undefined,
            videoStyle: videoScriptStyle || undefined,
          }),
        }
      );
      setVideoScriptResult(res);
      setNotice(t("social.cmVideoDone"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to deconstruct video script");
    } finally {
      setIsVideoDeconstructing(false);
    }
  }

  // HF4: analysis runs ONLY on the review text the owner pasted above.
  async function analyzeReviews(c: Competitor) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setLoadingReviewMine(true);
    setError("");
    try {
      const res = await apiFetch<CompetitorReviewMineReport>(
        `/organizations/${orgId}/competitors/${c.id}/reviews-mine`,
        { method: "POST", body: JSON.stringify({ reviewsText: reviewText }) }
      );
      setReviewMineReport(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to analyze reviews");
    } finally {
      setLoadingReviewMine(false);
    }
  }

  const fetchFunnelAudit = useCallback(async (c: Competitor) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setLoadingFunnel(true);
    setError("");
    try {
      const res = await apiFetch<FunnelAuditReport>(
        `/organizations/${orgId}/competitors/${c.id}/funnel-audit`
      );
      setFunnelReport(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load funnel audit");
    } finally {
      setLoadingFunnel(false);
    }
  }, []);

  const openCompetitor = useCallback(async (c: Competitor) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setActive(c);
    setSeoReport(null);
    setSeoStrategy(null);
    setReviewMineReport(null);
    setFunnelReport(null);
    try {
      const [a, o] = await Promise.all([
        apiFetch<Ad[]>(`/organizations/${orgId}/competitors/${c.id}/ads`),
        apiFetch<Obs[]>(`/organizations/${orgId}/competitors/${c.id}/observations`),
      ]);
      setAds(a);
      setObservations(o);
      if (activeTab === "seo") {
        fetchSeoReport(c);
      } else if (activeTab === "funnel") {
        fetchFunnelAudit(c);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load competitor details");
    }
  }, [activeTab, fetchSeoReport, fetchFunnelAudit]);




  async function openDossierModalHandler() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setLoadingDossier(true);
    setIsDossierOpen(true);
    setError("");
    try {
      const res = await apiFetch<DossierData>(`/organizations/${orgId}/competitors/dossier`);
      setDossierData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dossier");
    } finally {
      setLoadingDossier(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId();
    if (!orgId) return;
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/competitors`, {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          facebookPageId: form.facebookPageId || undefined,
          websiteUrl: form.websiteUrl || undefined,
          notes: form.notes || undefined,
        }),
      });
      setForm({ name: "", facebookPageId: "", websiteUrl: "", notes: "" });
      setNotice(t("social.cmCompetitorAdded"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function updateCompetitorHandler(e: React.FormEvent) {
    e.preventDefault();
    if (!editCompetitor) return;
    const orgId = getOrganizationId();
    if (!orgId) return;
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/competitors/${editCompetitor.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editCompetitor.name,
          facebookPageId: editCompetitor.facebookPageId || undefined,
          websiteUrl: editCompetitor.websiteUrl || undefined,
          notes: editCompetitor.notes || undefined,
        }),
      });
      setEditCompetitor(null);
      setNotice(t("social.cmCompetitorUpdated"));
      await load();
      if (active?.id === editCompetitor.id) {
        await openCompetitor({ ...active, ...editCompetitor });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function deleteCompetitor(id: string, name: string) {
    if (!confirm(t("social.cmDeleteConfirm", { name }))) return;
    const orgId = getOrganizationId();
    if (!orgId) return;
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/competitors/${id}`, { method: "DELETE" });
      setNotice(t("social.cmDeleted", { name }));
      if (active?.id === id) setActive(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  // Auto-sync schedule handler
  async function scheduleAutoSyncHandler(c: Competitor) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(`auto-${c.id}`);
    setError("");
    try {
      const res = await apiFetch<{ enabled: boolean; message: string }>(
        `/organizations/${orgId}/competitors/${c.id}/schedule-sync`,
        { method: "POST" }
      );
      setNotice(`${c.name}: ${res.message}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to toggle auto-sync");
    } finally {
      setBusy("");
    }
  }

  // Push Counter Ad to Campaign Builder
  function pushToCampaignBuilder() {
    if (!counterAdResult) return;
    const campaignDraft = {
      headline: counterAdResult.counterCampaign.headline,
      primaryText: counterAdResult.counterCampaign.primaryText,
      callToAction: counterAdResult.counterCampaign.callToAction,
      suggestedOffer: counterAdResult.counterCampaign.suggestedOffer,
      productId: selectedProductId,
    };
    try {
      localStorage.setItem("campaign_builder_draft", JSON.stringify(campaignDraft));
    } catch {
      // ignore
    }
    setNotice(t("social.cmDraftSaved"));
    setTimeout(() => {
      window.location.href = "/dashboard/campaign-builder";
    }, 800);
  }

  // Multi-Platform Sync Handler
  async function syncMultiPlatform(c: Competitor) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(`multi-${c.id}`);
    setError("");
    try {
      const res = await apiFetch<{
        fetched: number;
        created: number;
        updated: number;
        breakdown: Record<string, number>;
        unavailable?: Record<string, string>;
      }>(`/organizations/${orgId}/competitors/${c.id}/sync-multi-platform`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const unavailableNotes = Object.entries(res.unavailable ?? {})
        .map(([platform, note]) => `${platform}: ${note}`)
        .join("; ");
      setNotice(
        t("social.cmSyncResult", {
          name: c.name,
          fetched: fmtNumber(locale, res.fetched),
          fb: fmtNumber(locale, res.breakdown?.facebook ?? 0),
          g: fmtNumber(locale, res.breakdown?.google ?? 0),
          tt: fmtNumber(locale, res.breakdown?.tiktok ?? 0),
          bing: fmtNumber(locale, res.breakdown?.bing ?? 0),
        }) + (unavailableNotes ? t("social.cmSyncUnavailable", { notes: unavailableNotes }) : "")
      );
      await load();
      if (active?.id === c.id) await openCompetitor(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Multi-Platform sync failed");
    } finally {
      setBusy("");
    }
  }

  async function scanWebsite(c: Competitor) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(`scan-${c.id}`);
    setError("");
    try {
      const res = await apiFetch<{ scannedUrls: number; found: number; stored: number; alerts?: string[] }>(
        `/organizations/${orgId}/competitors/${c.id}/scan-website`,
        { method: "POST" }
      );
      const alertMsg = res.alerts?.length ? t("social.cmScanAlerts", { count: fmtNumber(locale, res.alerts.length) }) : "";
      setNotice(t("social.cmScanResult", { name: c.name, pages: fmtNumber(locale, res.scannedUrls), stored: fmtNumber(locale, res.stored), alerts: alertMsg }));
      await load();
      if (active?.id === c.id) await openCompetitor(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setBusy("");
    }
  }

  async function addObservation(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId();
    if (!orgId || !active) return;
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/competitors/${active.id}/observations`, {
        method: "POST",
        body: JSON.stringify(obsForm),
      });
      setObsForm({ productName: "", price: "", sourceUrl: "" });
      await openCompetitor(active);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function generateInsights() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy("insights");
    setError("");
    try {
      const res = await apiFetch<{ generated: number; droppedWithoutEvidence: number }>(
        `/organizations/${orgId}/competitors/insights/generate`,
        { method: "POST", body: JSON.stringify({ competitorId: active?.id }) }
      );
      setNotice(
        t("social.cmInsightsResult", {
          count: fmtNumber(locale, res.generated),
          suffix: res.droppedWithoutEvidence ? t("social.cmInsightsDropped", { count: fmtNumber(locale, res.droppedWithoutEvidence) }) : "",
        })
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy("");
    }
  }

  async function handleGenerateCounterAd() {
    if (!counterModalAd) return;
    const orgId = getOrganizationId();
    if (!orgId) return;
    setIsGeneratingCounterAd(true);
    setError("");
    try {
      const result = await apiFetch<CounterAdResult>(`/organizations/${orgId}/competitors/counter-ad`, {
        method: "POST",
        body: JSON.stringify({
          competitorAdId: counterModalAd.id,
          ownProductId: selectedProductId || undefined,
        }),
      });
      setCounterAdResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Counter-Ad generation failed");
    } finally {
      setIsGeneratingCounterAd(false);
    }
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(""), 2000);
  }

  // Filter Ads
  const filteredAds = ads.filter((a) => {
    if (activeTab === "swipefile" && !savedSwipeIds.includes(a.id)) return false;
    if (adFilter === "active" && !a.isActive) return false;
    if (adFilter === "winning" && !a.isWinning) return false;

    if (platformFilter !== "all") {
      const isPlatformMatch = a.platforms.some((p) => p.toLowerCase().includes(platformFilter));
      if (!isPlatformMatch) return false;
    }
    return true;
  });

  // Header stat chips: totals derived only from data already fetched
  // on this page (competitor list stats + alerts feed) — never invented.
  const totalAds = competitors.reduce((sum, c) => sum + c.stats.ads, 0);
  const totalActiveAds = competitors.reduce((sum, c) => sum + c.stats.activeAds, 0);
  const totalObservations = competitors.reduce((sum, c) => sum + c.stats.priceObservations, 0);

  const inputCls = "input mt-1 w-full";

  function getPlatformBadge(platforms: string[]) {
    const pStr = platforms.join(" ").toLowerCase();
    if (pStr.includes("tiktok")) {
      return (
        <span className="badge bg-pink-100 text-pink-800 ring-1 ring-inset ring-pink-200">
          🎵 TikTok
        </span>
      );
    }
    if (pStr.includes("google")) {
      return (
        <span className="badge bg-blue-100 text-blue-800 ring-1 ring-inset ring-blue-200">
          🔍 Google Ads
        </span>
      );
    }
    if (pStr.includes("bing") || pStr.includes("microsoft")) {
      return (
        <span className="badge bg-cyan-100 text-cyan-800 ring-1 ring-inset ring-cyan-200">
          🌐 Bing
        </span>
      );
    }
    return (
      <span className="badge bg-indigo-100 text-indigo-800 ring-1 ring-inset ring-indigo-200">
        📘 Meta
      </span>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Power Header v2 */}
      <div className="space-y-3.5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="comp-title-icon" aria-hidden="true">🕵️</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="page-title">Competitor Intelligence Suite</h1>
                <span className="badge-brand">
                  v2.0 Full Suite
                </span>
              </div>
              <p className="page-sub mt-0.5">
                {t("social.cmSubtitle")}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setIsAlertSettingsOpen(true)}
              className="btn-secondary min-h-[40px] flex-1 text-xs sm:flex-none"
            >
              <span>📲 Telegram & WhatsApp Alert Bot</span>
              <span className="badge-green px-1 py-0.2 text-[10px]">24/7</span>
            </button>
            <button
              onClick={openDossierModalHandler}
              className="btn-primary min-h-[40px] flex-1 text-xs sm:flex-none"
            >
              <span>📄 White-Label Agency Audit</span>
              <span className="rounded bg-white/20 px-1 py-0.2 text-[10px] font-medium">Export</span>
            </button>
          </div>
        </div>
        {/* Live stat chips — only numbers already fetched on this page */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="stat-chip">
            {t("social.cmChipCompetitors")} <span className="stat-chip-count">{fmtNumber(locale, competitors.length)}</span>
          </span>
          <span className="stat-chip">
            {t("social.cmChipTotalAds")} <span className="stat-chip-count">{fmtNumber(locale, totalAds)}</span>
          </span>
          <span className="stat-chip">
            {t("social.cmChipActiveAds")} <span className="stat-chip-count">{fmtNumber(locale, totalActiveAds)}</span>
          </span>
          <span className="stat-chip">
            {t("social.cmChipPriceRecords")} <span className="stat-chip-count">{fmtNumber(locale, totalObservations)}</span>
          </span>
          <span className={`stat-chip ${alerts.length > 0 ? "stat-chip-danger" : ""}`}>
            {t("social.cmChipLiveAlerts")} <span className="stat-chip-count">{fmtNumber(locale, alerts.length)}</span>
          </span>
        </div>
      </div>


      {/* Tab rail v2 — sticky, scroll-snap on mobile, one brand active state */}
      <div className="comp-tab-rail">
        <button
          onClick={() => setActiveTab("spy")}
          className={`comp-tab-btn ${activeTab === "spy" ? "comp-tab-btn-active" : ""}`}
        >
          🌐 Multi-Platform Ad Spy <span className="comp-tab-count">{ads.length}</span>
        </button>
        <button
          onClick={() => setActiveTab("swipefile")}
          className={`comp-tab-btn ${activeTab === "swipefile" ? "comp-tab-btn-active" : ""}`}
        >
          <span>💾 Swipe File & Inspiration</span> <span className="comp-tab-count">{savedSwipeIds.length}</span>
        </button>
        <button
          onClick={() => setActiveTab("pricing")}
          className={`comp-tab-btn ${activeTab === "pricing" ? "comp-tab-btn-active" : ""}`}
        >
          🏷️ Price & Stock Comparison
        </button>
        <button
          onClick={() => setActiveTab("playbook")}
          className={`comp-tab-btn ${activeTab === "playbook" ? "comp-tab-btn-active" : ""}`}
        >
          📊 Strategy & Offer Playbook
        </button>
        <button
          onClick={() => {
            setActiveTab("seo");
            if (active) fetchSeoReport(active);
          }}
          className={`comp-tab-btn ${activeTab === "seo" ? "comp-tab-btn-active" : ""}`}
        >
          <span>{t("social.cmSeoTab")}</span>
          <span className="comp-tab-note bg-emerald-500/20 text-emerald-700">New</span>
        </button>
        <button
          onClick={() => {
            setActiveTab("complaints");
          }}
          className={`comp-tab-btn ${activeTab === "complaints" ? "comp-tab-btn-active" : ""}`}
        >
          <span>💬 Bad Review Mine</span>
          <span className="comp-tab-note bg-rose-500/20 text-rose-700">Hot</span>
        </button>
        <button
          onClick={() => {
            setActiveTab("funnel");
            if (active) fetchFunnelAudit(active);
          }}
          className={`comp-tab-btn ${activeTab === "funnel" ? "comp-tab-btn-active" : ""}`}
        >
          <span>🛒 Checkout & Funnel Spy</span>
          <span className="comp-tab-note bg-amber-500/20 text-amber-700">+35% AOV</span>
        </button>
      </div>




      {error ? <p className="alert alert-red">{error}</p> : null}
      {notice ? <p className="alert alert-green">{notice}</p> : null}

      {/* 🚨 Live Intelligence Alerts Banner v2 */}
      {alerts.length > 0 ? (
        <div className="alert alert-amber fade-rise flex-col gap-3">
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 animate-ping" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-amber-900">
                {t("social.cmAlertsTitle", { count: fmtNumber(locale, alerts.length) })}
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setIsAlertSettingsOpen(true)}
                className="rounded-lg bg-amber-200/70 hover:bg-amber-200 px-2.5 py-1.5 min-h-[32px] text-[11px] font-bold text-amber-900 flex items-center gap-1 transition-colors"
                title={t("social.cmAlertBotTitle")}
              >
                {t("social.cmAlertBotBtn")}
              </button>
              <span className="text-[11px] text-amber-800 font-medium">{t("social.cmInstantOpp")}</span>
            </div>
          </div>

          <div className="grid w-full gap-2 sm:grid-cols-2">
            {alerts.slice(0, 4).map((alt) => (
              <div key={alt.id} className="rounded-xl bg-white p-3 text-xs shadow-sm ring-1 ring-inset ring-amber-200/80">
                <span className="font-bold text-slate-900">{alt.title}</span>
                <p className="mt-1 text-slate-600 text-[11px] line-clamp-2">{alt.detail}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Competitor Cards v2 */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {competitors.map((c) => (
          <div
            key={c.id}
            className={`card card-hover p-4 sm:p-5 ${
              active?.id === c.id ? "comp-card-active" : ""
            }`}
          >
            <div className="flex items-start gap-3">
              <span className="comp-avatar" aria-hidden="true">{c.name.trim().charAt(0) || "?"}</span>
              <div className="min-w-0 flex-1">
                <button
                  className="text-left font-bold text-slate-900 hover:text-brand-700 hover:underline"
                  onClick={() => openCompetitor(c)}
                >
                  {c.name}
                </button>
                {c.websiteUrl ? (
                  <p className="truncate text-xs text-slate-400">
                    <a href={c.websiteUrl} target="_blank" rel="noreferrer" className="hover:underline">
                      {c.websiteUrl.replace(/^https?:\/\//, "")}
                    </a>
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => setEditCompetitor(c)}
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 text-sm"
                  title={t("social.cmEdit")}
                >
                  ✏️
                </button>
                <button
                  onClick={() => deleteCompetitor(c.id, c.name)}
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 text-sm"
                  title={t("social.cmDelete")}
                >
                  🗑️
                </button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="ctx-tile">
                <div className="ctx-tile-label">{t("social.cmTileAds")}</div>
                <div className="ctx-tile-value">{fmtNumber(locale, c.stats.ads)}</div>
              </div>
              <div className="ctx-tile">
                <div className="ctx-tile-label">{t("social.cmTileActive")}</div>
                <div className="ctx-tile-value">{fmtNumber(locale, c.stats.activeAds)}</div>
              </div>
              <div className="ctx-tile">
                <div className="ctx-tile-label">{t("social.cmTilePriceRecords")}</div>
                <div className="ctx-tile-value">{fmtNumber(locale, c.stats.priceObservations)}</div>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:flex-wrap">
              <button
                className="btn-ai min-h-[40px] text-xs sm:flex-1"
                disabled={busy !== ""}
                onClick={() => syncMultiPlatform(c)}
              >
                {busy === `multi-${c.id}` ? "Spying all platforms..." : "⚡ All-Platform Spy (FB+Google+TikTok+Bing)"}
              </button>
              <button
                className="btn-secondary btn-sm min-h-[40px]"
                disabled={busy !== "" || !c.websiteUrl}
                onClick={() => scanWebsite(c)}
              >
                {busy === `scan-${c.id}` ? "Scanning..." : t("social.cmScanBtn")}
              </button>
              <button
                className="comp-soft-btn min-h-[40px]"
                disabled={busy !== ""}
                onClick={() => scheduleAutoSyncHandler(c)}
                title={t("social.cmAutoSyncTitle")}
              >
                {busy === `auto-${c.id}` ? "Updating..." : t("social.cmAutoSyncBtn")}
              </button>
            </div>
          </div>
        ))}
      </div>

      {competitors.length === 0 ? (
        <EmptyState
          title={t("social.cmEmptyTitle")}
          description={t("social.cmEmptyDesc")}
        />
      ) : null}

      {/* Edit Modal v2 */}
      {editCompetitor ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center modal-backdrop sm:items-center sm:p-4">
          <form onSubmit={updateCompetitorHandler} className="comp-sheet space-y-4 sm:max-w-md">
            <h3 className="modal-head -mx-5 -mt-5 px-5 sm:-mx-6 sm:-mt-6 sm:px-6 sm:rounded-t-3xl text-base font-bold text-slate-900">{t("social.cmEditTitle")}</h3>
            <div>
              <label className="text-xs font-semibold text-slate-600">{t("social.cmNameLabel")}</label>
              <input
                className={inputCls}
                value={editCompetitor.name}
                onChange={(e) => setEditCompetitor({ ...editCompetitor, name: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Facebook Page ID</label>
              <input
                className={inputCls}
                value={editCompetitor.facebookPageId || ""}
                onChange={(e) => setEditCompetitor({ ...editCompetitor, facebookPageId: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">{t("social.cmWebsiteUrlLabel")}</label>
              <input
                className={inputCls}
                value={editCompetitor.websiteUrl || ""}
                onChange={(e) => setEditCompetitor({ ...editCompetitor, websiteUrl: e.target.value })}
              />
            </div>
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                className="btn-secondary min-h-[40px]"
                onClick={() => setEditCompetitor(null)}
              >
                {t("common.cancel")}
              </button>
              <button type="submit" className="btn-primary min-h-[40px]">
                {t("common.save")}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {/* Add New Competitor Form */}
      <form onSubmit={create} className="card p-4 space-y-3 bg-white sm:p-5">
        <div className="section-title">{t("social.cmAddTitle")}</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-xs font-medium text-slate-700">
            {t("social.cmNameStar")}
            <input
              className={inputCls}
              placeholder={t("social.cmNamePlaceholder")}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </label>
          <label className="block text-xs font-medium text-slate-700">
            Facebook Page ID
            <input
              className={inputCls}
              value={form.facebookPageId}
              onChange={(e) => setForm({ ...form, facebookPageId: e.target.value })}
              placeholder={t("social.cmPageIdPlaceholder")}
            />
          </label>
          <label className="block text-xs font-medium text-slate-700">
            {t("social.cmWebsiteLabel")}
            <input
              className={inputCls}
              value={form.websiteUrl}
              onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })}
              placeholder="https://example.com"
            />
          </label>
        </div>
        <button className="btn-primary min-h-[40px] w-full text-xs py-2 px-4 sm:w-auto">{t("social.cmAddBtn")}</button>
      </form>

      {/* TAB 1 & 2: SPY & SWIPE FILE VIEW */}
      {(activeTab === "spy" || activeTab === "swipefile") && active ? (
        <div className="fade-rise grid gap-6 lg:grid-cols-2">
          {/* Ad Library Stream */}
          <div className="card p-4 bg-white sm:p-5">
            <div className="flex flex-col gap-2 border-b border-slate-100 pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-bold text-slate-900">
                    {activeTab === "swipefile"
                      ? `💾 My Saved Swipe File (${fmtNumber(locale, filteredAds.length)})`
                      : t("social.cmAdsOf", { name: active.name, count: fmtNumber(locale, ads.length) })}
                  </h3>
                  <p className="text-xs text-slate-400">Facebook • Google • TikTok • Bing</p>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setAdFilter("all")}
                    className={`min-h-[32px] rounded-full px-3 py-1.5 text-xs font-medium transition active:scale-[0.97] ${
                      adFilter === "all" ? "comp-chip-active" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {t("social.cmFilterAll")}
                  </button>
                  <button
                    onClick={() => setAdFilter("active")}
                    className={`min-h-[32px] rounded-full px-3 py-1.5 text-xs font-medium transition active:scale-[0.97] ${
                      adFilter === "active" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {t("social.cmFilterActive")}
                  </button>
                  <button
                    onClick={() => setAdFilter("winning")}
                    className={`min-h-[32px] rounded-full px-3 py-1.5 text-xs font-semibold transition active:scale-[0.97] ${
                      adFilter === "winning" ? "bg-amber-500 text-white" : "bg-amber-100 text-amber-800 hover:bg-amber-200/70"
                    }`}
                  >
                    🔥 Winning
                  </button>
                </div>
              </div>

              {/* Platform Selector Tabs */}
              <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-100">
                <span className="text-[11px] font-semibold text-slate-400 self-center mr-1">{t("social.cmFilterLabel")}</span>
                <button
                  onClick={() => setPlatformFilter("all")}
                  className={`min-h-[32px] rounded-full px-2.5 py-1 text-xs font-medium transition active:scale-[0.97] ${
                    platformFilter === "all" ? "comp-chip-active" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {t("social.cmAllPlatforms")}
                </button>
                <button
                  onClick={() => setPlatformFilter("facebook")}
                  className={`min-h-[32px] rounded-full px-2.5 py-1 text-xs font-medium transition active:scale-[0.97] ${
                    platformFilter === "facebook" ? "bg-indigo-600 text-white" : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                  }`}
                >
                  📘 Meta
                </button>
                <button
                  onClick={() => setPlatformFilter("google")}
                  className={`min-h-[32px] rounded-full px-2.5 py-1 text-xs font-medium transition active:scale-[0.97] ${
                    platformFilter === "google" ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                  }`}
                >
                  🔍 Google
                </button>
                <button
                  onClick={() => setPlatformFilter("tiktok")}
                  className={`min-h-[32px] rounded-full px-2.5 py-1 text-xs font-medium transition active:scale-[0.97] ${
                    platformFilter === "tiktok" ? "bg-pink-600 text-white" : "bg-pink-50 text-pink-700 hover:bg-pink-100"
                  }`}
                >
                  🎵 TikTok
                </button>
                <button
                  onClick={() => setPlatformFilter("bing")}
                  className={`min-h-[32px] rounded-full px-2.5 py-1 text-xs font-medium transition active:scale-[0.97] ${
                    platformFilter === "bing" ? "bg-cyan-700 text-white" : "bg-cyan-50 text-cyan-800 hover:bg-cyan-100"
                  }`}
                >
                  🌐 Bing
                </button>
              </div>
            </div>

            <div className="mt-3 max-h-[500px] space-y-3 overflow-y-auto pr-1">
              {filteredAds.map((a) => (
                <div
                  key={a.id}
                  className={`rounded-2xl border p-3.5 text-sm shadow-sm transition duration-150 hover:shadow-card-hover ${
                    a.isWinning
                      ? "border-amber-300 bg-amber-50/30"
                      : "border-slate-200/80 bg-white"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-slate-500">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {getPlatformBadge(a.platforms)}
                      {a.isWinning ? (
                        <span className="badge bg-amber-500 text-white shadow-sm ring-1 ring-inset ring-amber-600/30">
                          {t("social.cmWinningBadge", { days: fmtNumber(locale, a.daysRunning || 14) })}
                        </span>
                      ) : a.isFresh ? (
                        <span className="badge-brand">
                          {t("social.cmFreshBadge", { days: fmtNumber(locale, a.daysRunning || 1) })}
                        </span>
                      ) : (
                        <span className="font-semibold text-slate-700">
                          {a.daysRunning ? t("social.cmDaysRunning", { days: fmtNumber(locale, a.daysRunning) }) : ""}
                        </span>
                      )}
                      <span>· {a.isActive ? t("social.cmActiveWord") : t("social.cmInactiveWord")}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleSwipeSave(a.id)}
                        className={`min-h-[32px] rounded-full px-2.5 py-1 text-xs font-medium border transition-colors ${
                          savedSwipeIds.includes(a.id)
                            ? "bg-amber-100 border-amber-300 text-amber-900"
                            : "bg-white text-slate-600 hover:bg-slate-100"
                        }`}
                        title={t("social.cmSaveSwipeTitle")}
                      >
                        {savedSwipeIds.includes(a.id) ? "★ Saved" : "☆ Save"}
                      </button>
                      {a.snapshotUrl ? (
                        <a
                          className="font-medium text-blue-600 hover:underline"
                          href={a.snapshotUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t("social.cmLiveLink")}
                        </a>
                      ) : null}
                    </div>
                  </div>

                  <p className="mt-2 whitespace-pre-wrap text-slate-800 text-xs leading-relaxed font-sans line-clamp-6">
                    {a.creativeText ?? t("social.cmNoAdText")}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/60 pt-2.5">
                    {a.linkUrl ? (
                      <a
                        className="min-w-0 flex-1 truncate text-xs text-blue-600 hover:underline sm:max-w-[220px]"
                        href={a.linkUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {a.linkUrl}
                      </a>
                    ) : <span />}

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        onClick={() => {
                          setVideoModalAd(a);
                          setVideoScriptResult(null);
                        }}
                        className="min-h-[36px] rounded-lg border border-pink-200 bg-pink-50/70 px-2.5 py-1.5 text-xs font-semibold text-pink-700 hover:bg-pink-100 flex items-center gap-1 transition-colors"
                        title={t("social.cmDeconstructTitle")}
                      >
                        {t("social.cmDeconstructBtn")}
                      </button>
                      <button
                        onClick={() => {
                          setCounterModalAd(a);
                          setCounterAdResult(null);
                        }}
                        className="btn-ai min-h-[36px] text-xs"
                      >
                        ⚡ Beat This Ad
                      </button>
                    </div>
                  </div>

                </div>
              ))}

              {filteredAds.length === 0 ? (
                <p className="p-4 text-center text-sm text-slate-400">
                  {activeTab === "swipefile"
                    ? t("social.cmSwipeEmpty")
                    : t("social.cmSpyEmpty")}
                </p>
              ) : null}
            </div>
          </div>

          {/* Price & Stock Observations */}
          <div className="space-y-4">
            <div className="card p-4 bg-white sm:p-5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div className="font-bold text-slate-900">{t("social.cmObsTitle")}</div>
                <span className="stat-chip-count">{t("social.cmObsTotal", { count: fmtNumber(locale, observations.length) })}</span>
              </div>
              <div className="mt-2 max-h-56 space-y-2 overflow-y-auto pr-1">
                {observations.map((o) => (
                  <div
                    key={o.id}
                    className="flex items-center justify-between gap-2 rounded-xl bg-slate-50/70 px-3 py-2.5 text-xs ring-1 ring-inset ring-slate-200/60"
                  >
                    <div>
                      <span className="font-medium text-slate-900">{o.productName}</span>
                      <span className="ml-2 text-slate-400">
                        ({o.sourceType}, {fmtDate(locale, o.observedAt)})
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-slate-900">
                        {fmtMoneyMinor(locale, BigInt(o.priceMinor), { currency: o.currency })}
                      </span>
                      <a
                        className="ml-2 text-blue-600 hover:underline"
                        href={o.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t("social.cmEvidence")}
                      </a>
                    </div>
                  </div>
                ))}
                {observations.length === 0 ? (
                  <p className="text-xs text-slate-400 py-3 text-center">
                    {t("social.cmObsEmpty")}
                  </p>
                ) : null}
              </div>

              {/* Add Observation Form */}
              <form onSubmit={addObservation} className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 border-t border-slate-100 pt-3">
                <input
                  className="input w-full text-xs"
                  placeholder={t("social.cmObsProductPlaceholder")}
                  value={obsForm.productName}
                  onChange={(e) => setObsForm({ ...obsForm, productName: e.target.value })}
                  required
                />
                <input
                  className="input w-full text-xs"
                  placeholder={t("social.cmObsPricePlaceholder")}
                  value={obsForm.price}
                  onChange={(e) => setObsForm({ ...obsForm, price: e.target.value })}
                  required
                />
                <input
                  className="input w-full text-xs"
                  placeholder={t("social.cmObsUrlPlaceholder")}
                  value={obsForm.sourceUrl}
                  onChange={(e) => setObsForm({ ...obsForm, sourceUrl: e.target.value })}
                  required
                />
                <button className="btn-dark btn-sm min-h-[40px] sm:col-span-3 w-full">
                  {t("social.cmObsSaveBtn")}
                </button>
              </form>
            </div>

            {/* Quick Intelligence Summary */}
            <div className="comp-dark p-4 sm:p-5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-white/60">
                Omnichannel Advantage
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-white/85">
                {t("social.cmQuickSummaryA", { name: active.name, count: fmtNumber(locale, ads.length) })}<b>Swipe File</b>{t("social.cmQuickSummaryB")}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* TAB 3: PRICE COMPARISON TABLE */}
      {activeTab === "pricing" ? (
        <div className="card fade-rise p-4 bg-white sm:p-5">
          <div className="font-bold text-slate-900">{t("social.cmMatrixTitle")}</div>
          <p className="text-xs text-slate-400">
            {t("social.cmMatrixSub")}
          </p>
          <div className="table-wrap mt-3">
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th className="comp-sticky-col">{t("social.cmThYourProduct")}</th>
                  <th>{t("social.cmThYourPrice")}</th>
                  <th>{t("social.cmThCompPrice")}</th>
                  <th>{t("social.cmThDiff")}</th>
                  <th>{t("social.cmThEvidence")}</th>
                </tr>
              </thead>
              <tbody className="text-xs">
                {comparison.map((row) =>
                  row.competitorPrices.length ? (
                    row.competitorPrices.map((cp, i) => (
                      <tr key={`${row.productId}-${i}`}>
                        <td className="comp-sticky-col font-medium text-slate-900">
                          {i === 0 ? row.productName : ""}
                        </td>
                        <td className="font-semibold text-slate-700">
                          {i === 0 ? fmtMoneyMinor(locale, BigInt(row.ownPriceMinor), { currency: row.currency }) : ""}
                        </td>
                        <td>
                          <span className="font-semibold text-slate-900">{cp.competitorName}:</span>{" "}
                          {fmtMoneyMinor(locale, BigInt(cp.priceMinor), { currency: cp.currency })}
                        </td>
                        <td
                          className={`font-bold ${
                            cp.diffPercent === null
                              ? ""
                              : cp.diffPercent < 0
                              ? "text-red-600"
                              : "text-green-600"
                          }`}
                        >
                          {cp.diffPercent === null
                            ? "—"
                            : cp.diffPercent < 0
                            ? t("social.cmCompCheaper", { pct: fmtNumber(locale, Math.abs(cp.diffPercent)) })
                            : t("social.cmYouCheaper", { pct: fmtNumber(locale, cp.diffPercent) })}
                        </td>
                        <td>
                          <a
                            className="text-blue-600 hover:underline"
                            href={cp.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t("social.cmLiveSource")}
                          </a>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr key={row.productId}>
                      <td className="comp-sticky-col font-medium text-slate-900">{row.productName}</td>
                      <td className="font-semibold text-slate-700">
                        {fmtMoneyMinor(locale, BigInt(row.ownPriceMinor), { currency: row.currency })}
                      </td>
                      <td className="text-slate-400" colSpan={3}>
                        {t("social.cmNoCompPrice")}
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>

          {/* 🤖 AUTOMATED DYNAMIC PRICING & BUDGET RULE ENGINE */}
          <div className="mt-8 border-t border-slate-100 pt-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold text-slate-900 text-base">🤖 Automated Dynamic Pricing & Budget Rule Engine</h3>
                  <span className="badge-brand">
                    Autonomous AI Pilot
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {t("social.cmRulesSub")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={loadDynamicRules}
                  disabled={loadingRules}
                  className="btn-secondary btn-sm min-h-[40px]"
                >
                  {loadingRules ? t("common.loading") : t("social.cmRefresh")}
                </button>
              </div>
            </div>

            {loadingRules && dynamicRules.length === 0 ? (
              <div className="grid gap-4 md:grid-cols-2" aria-hidden="true">
                {[0, 1].map((i) => (
                  <div key={i} className="rounded-2xl border border-slate-200/80 p-4 space-y-3">
                    <div className="skeleton h-4 w-2/3" />
                    <div className="skeleton h-3 w-full" />
                    <div className="skeleton h-3 w-4/5" />
                    <div className="skeleton h-8 w-full" />
                  </div>
                ))}
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              {dynamicRules.map((rule) => (
                <div
                  key={rule.id}
                  className={`rounded-2xl border p-4 transition-all ${
                    rule.enabled
                      ? "comp-rule-on"
                      : "border-slate-200 bg-slate-50/50 opacity-75"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm">{rule.name}</span>
                        {rule.enabled ? (
                          <span className="rounded bg-emerald-100 text-emerald-800 text-[10px] px-1.5 py-0.5 font-bold">
                            Active
                          </span>
                        ) : (
                          <span className="rounded bg-slate-200 text-slate-600 text-[10px] px-1.5 py-0.5 font-semibold">
                            Paused
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        <b>{t("social.cmTriggerLabel")}</b>{" "}
                        {rule.triggerType === "COMPETITOR_STOCK_OUT"
                          ? t("social.cmTriggerStockOut")
                          : rule.triggerType === "COMPETITOR_PRICE_DROP"
                          ? t("social.cmTriggerPriceDrop", { pct: fmtNumber(locale, rule.conditions.priceDropThresholdPercent || 10) })
                          : rule.triggerType === "COMPETITOR_PRICE_INCREASE"
                          ? t("social.cmTriggerPriceUp", { pct: fmtNumber(locale, rule.conditions.priceIncreaseThresholdPercent || 10) })
                          : t("social.cmTriggerWinning")}
                      </div>
                      <div className="text-xs text-brand-700 font-medium mt-1">
                        <b>{t("social.cmActionLabel")}</b>{" "}
                        {rule.actionType === "BOOST_AD_BUDGET"
                          ? t("social.cmActionBoost", { pct: fmtNumber(locale, rule.actions.budgetBoostPercent || 20) })
                          : rule.actionType === "TRIGGER_FLASH_SALE_BUNDLE"
                          ? t("social.cmActionFlash")
                          : t("social.cmActionAdjust")}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleRule(rule.id)}
                      disabled={isSavingRules}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        rule.enabled ? "comp-switch-on" : "bg-slate-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
                          rule.enabled ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  {rule.actions.suggestedHeadline ? (
                    <div className="mt-3 rounded-lg bg-amber-50/80 border border-amber-200/70 p-2 text-xs text-amber-900">
                      💡 <b>{t("social.cmAutoMsgLabel")}</b> {rule.actions.suggestedHeadline}
                    </div>
                  ) : null}

                  {/* Executions & Simulator */}
                  <div className="mt-3 border-t pt-2 flex items-center justify-between text-xs text-slate-500">
                    <span>
                      {t("social.cmTotalFired")} <b>{t("social.cmTimesCount", { count: fmtNumber(locale, rule.triggerCount) })}</b>
                      {rule.lastTriggeredAt ? t("social.cmLastTriggered", { date: fmtDate(locale, rule.lastTriggeredAt) }) : ""}
                    </span>

                    <button
                      type="button"
                      disabled={simulatingRuleId === rule.id || !rule.enabled}
                      onClick={() => simulateRuleTriggerHandler(rule)}
                      className="comp-soft-btn min-h-[32px] px-2.5 py-1 text-[11px]"
                    >
                      {simulatingRuleId === rule.id ? t("social.cmTesting") : t("social.cmTestTrigger")}
                    </button>
                  </div>

                  {rule.recentExecutions && rule.recentExecutions.length > 0 ? (
                    <div className="mt-2 text-[11px] text-slate-500 bg-slate-50 p-2 rounded border border-slate-100">
                      <div className="font-semibold text-slate-700 mb-0.5">{t("social.cmLatestLog")}</div>
                      <div>• {rule.recentExecutions[0].description}</div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* TAB 4: STRATEGY & OFFER PLAYBOOK */}
      {activeTab === "playbook" ? (
        <div className="card fade-rise p-4 bg-white space-y-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-slate-900">Competitor Strategy & Tactics Playbook</h3>
              <p className="text-xs text-slate-500">
                {t("social.cmPlaybookSub")}
              </p>
            </div>
            <button
              className="btn-primary min-h-[40px] text-xs py-1.5 px-3 disabled:opacity-50"
              disabled={busy !== ""}
              onClick={generateInsights}
            >
              {busy === "insights" ? t("social.cmAnalyzing") : t("social.cmGenPlaybook")}
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl bg-blue-50/50 p-4 ring-1 ring-inset ring-blue-100">
              <span className="text-xs font-bold text-blue-900 uppercase">{t("social.cmPattern1Title")}</span>
              <p className="mt-2 text-xs text-slate-700 leading-relaxed">
                {t("social.cmPattern1Text")}
              </p>
            </div>
            <div className="rounded-2xl bg-emerald-50/50 p-4 ring-1 ring-inset ring-emerald-100">
              <span className="text-xs font-bold text-emerald-900 uppercase">{t("social.cmPattern2Title")}</span>
              <p className="mt-2 text-xs text-slate-700 leading-relaxed">
                {t("social.cmPattern2Text")}
              </p>
            </div>
            <div className="rounded-2xl bg-purple-50/50 p-4 ring-1 ring-inset ring-purple-100">
              <span className="text-xs font-bold text-purple-900 uppercase">{t("social.cmPattern3Title")}</span>
              <p className="mt-2 text-xs text-slate-700 leading-relaxed">
                {t("social.cmPattern3Text")}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* TAB 5: SEO ON-PAGE AUDIT (HF2: real fetched facts, no invented traffic metrics) */}
      {activeTab === "seo" ? (
        <div className="fade-rise space-y-6">
          {!active ? (
            <div className="card p-6 bg-white text-center space-y-4 sm:p-8">
              <div className="comp-icon-tile mx-auto h-14 w-14 text-2xl">
                🔍
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">{t("social.cmSelectCompetitor")}</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
                  {t("social.cmSeoSelectSub")}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                {competitors.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      openCompetitor(c);
                      fetchSeoReport(c);
                    }}
                    className="btn-secondary btn-sm min-h-[40px]"
                  >
                    🏢 {c.name}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Header card */}
              <div className="card p-4 bg-white flex flex-col md:flex-row md:items-center md:justify-between gap-4 sm:p-5">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-bold text-slate-900">{t("social.cmSeoAuditTitle", { name: active.name })}</h3>
                    <span className="badge-brand">
                      {t("social.cmRealFetchedBadge")}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {t("social.cmSeoHeaderSub")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="btn-secondary btn-sm min-h-[40px]"
                    disabled={loadingSeo}
                    onClick={() => fetchSeoReport(active)}
                  >
                    {loadingSeo ? t("social.cmAuditing") : t("social.cmRescanSeo")}
                  </button>
                </div>
              </div>

              {loadingSeo ? (
                <div className="card p-6 bg-white space-y-5 sm:p-8" aria-hidden="true">
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="space-y-2">
                        <div className="skeleton h-3 w-2/3" />
                        <div className="skeleton h-8 w-1/2" />
                        <div className="skeleton h-3 w-4/5" />
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <div className="skeleton h-4 w-1/3" />
                    <div className="skeleton h-10 w-full" />
                    <div className="skeleton h-10 w-full" />
                    <div className="skeleton h-10 w-full" />
                  </div>
                  <p className="text-center text-sm text-slate-500">{t("social.cmSeoFetching")}</p>
                </div>
              ) : seoReport && !seoReport.available ? (
                <div className="card p-8 bg-white text-center space-y-3">
                  <div className="comp-icon-tile mx-auto h-14 w-14 text-2xl">🚫</div>
                  <h4 className="font-bold text-slate-900 text-sm">{t("social.cmSeoNotFound")}</h4>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    {seoReport.reason ?? t("social.cmSeoNotFoundDefault")}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {t("social.cmSeoNotFoundHint")}
                  </p>
                </div>
              ) : seoReport ? (
                <div className="space-y-6">
                  {/* Observed facts overview */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="comp-metric">
                      <span className="stat-label">
                        {t("social.cmSchemaLabel")}
                      </span>
                      <p className="stat-value text-brand-700">
                        {seoReport.productSchemaPresent ? t("social.cmFound") : t("social.cmNotFound")}
                      </p>
                      <span className="stat-hint block">{t("social.cmSchemaHint")}</span>
                    </div>

                    <div className="comp-metric">
                      <span className="stat-label">
                        Sitemap.xml
                      </span>
                      <p className="stat-value text-emerald-700">
                        {seoReport.sitemapPresent ? t("social.cmPresent") : t("social.cmNotFound")}
                      </p>
                      <span className="stat-hint block">{t("social.cmSitemapHint")}</span>
                    </div>

                    <div className="comp-metric">
                      <span className="stat-label">
                        Meta Description
                      </span>
                      <p className="stat-value text-blue-700">
                        {seoReport.metaDescription ? t("social.cmPresent") : t("social.cmAbsent")}
                      </p>
                      <span className="stat-hint block">{seoReport.metaDescription ? t("social.cmMetaChars", { count: fmtNumber(locale, seoReport.metaDescription.length) }) : t("social.cmMetaMissingHint")}</span>
                    </div>

                    <div className="comp-metric">
                      <span className="stat-label">
                        {t("social.cmInternalLinksLabel")}
                      </span>
                      <p className="stat-value text-purple-700">
                        {t("social.cmCountSuffix", { count: fmtNumber(locale, seoReport.internalLinks.length) })}
                      </p>
                      <span className="stat-hint block">{t("social.cmInternalLinksHint")}</span>
                    </div>
                  </div>

                  {/* Title & meta as actually served */}
                  <div className="card p-4 bg-white space-y-3 sm:p-5">
                    <div className="border-b border-slate-100 pb-3">
                      <h4 className="font-bold text-slate-900 text-sm">
                        {t("social.cmTitleMetaTitle")}
                      </h4>
                      <p className="text-xs text-slate-500">
                        {t("social.cmFetchedFrom", { url: seoReport.fetchedUrl ?? "" })}
                      </p>
                    </div>
                    <div className="space-y-2 text-xs">
                      <div className="rounded-lg bg-slate-50 px-3 py-2 border">
                        <span className="font-bold text-slate-500 block text-[10px] uppercase">Title</span>
                        <span className="font-semibold text-slate-900">{seoReport.title ?? t("social.cmNotDetected")}</span>
                      </div>
                      <div className="rounded-lg bg-slate-50 px-3 py-2 border">
                        <span className="font-bold text-slate-500 block text-[10px] uppercase">Meta Description</span>
                        <span className="text-slate-700">{seoReport.metaDescription ?? t("social.cmNotDetected")}</span>
                      </div>
                      <div className="rounded-lg bg-slate-50 px-3 py-2 border">
                        <span className="font-bold text-slate-500 block text-[10px] uppercase">OpenGraph (og:title)</span>
                        <span className="text-slate-700">{seoReport.og.title ?? t("social.cmNotDetected")}</span>
                      </div>
                    </div>
                  </div>

                  {/* Phrases the site itself uses */}
                  <div className="card p-4 bg-white space-y-4 sm:p-5">
                    <div className="border-b border-slate-100 pb-3">
                      <h4 className="font-bold text-slate-900 text-sm">
                        {t("social.cmPhrasesTitle")}
                      </h4>
                      <p className="text-xs text-slate-500">
                        {t("social.cmPhrasesSub")}
                      </p>
                    </div>
                    {seoReport.observedPhrases.length ? (
                      <div className="flex flex-wrap gap-2">
                        {seoReport.observedPhrases.map((p, i) => (
                          <span key={i} className="rounded-lg bg-slate-100 text-slate-800 text-xs px-2.5 py-1 font-semibold border">
                            <span className="text-slate-400 uppercase text-[10px] mr-1">{p.source}</span>
                            {p.text}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">{t("social.cmNoPhrases")}</p>
                    )}
                  </div>

                  {/* Internal links found */}
                  <div className="card p-4 bg-white space-y-4 sm:p-5">
                    <div className="border-b border-slate-100 pb-3">
                      <h4 className="font-bold text-slate-900 text-sm">
                        {t("social.cmLinksTitle")}
                      </h4>
                      <p className="text-xs text-slate-500">
                        {t("social.cmLinksSub")}
                      </p>
                    </div>
                    {seoReport.internalLinks.length ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {seoReport.internalLinks.map((l, i) => (
                          <div key={i} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 border">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              l.kind === "offer" ? "bg-amber-100 text-amber-800" :
                              l.kind === "product" ? "bg-emerald-100 text-emerald-800" :
                              l.kind === "shop" ? "bg-blue-100 text-blue-800" : "bg-slate-200 text-slate-700"
                            }`}>
                              {l.kind}
                            </span>
                            <a href={l.url} target="_blank" rel="noreferrer" className="text-[11px] text-blue-600 truncate font-mono hover:underline">
                              {l.url}
                            </a>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">{t("social.cmNoLinks")}</p>
                    )}
                  </div>

                  {/* ⚡ AI SEO Gap Strategy — grounded in the real audit above */}
                  <div className="comp-dark p-5 space-y-5 sm:p-6">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-white/15 pb-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/15 text-sm">⚡</span>
                          <h4 className="font-bold text-base text-white">
                            {t("social.cmSeoGapTitle")}
                          </h4>
                        </div>
                        <p className="text-xs text-white/70 mt-1">
                          {t("social.cmSeoGapSub")}
                        </p>
                      </div>

                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <select
                          className="min-h-[40px] rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs text-white outline-none"
                          value={selectedProductIdForSeo}
                          onChange={(e) => setSelectedProductIdForSeo(e.target.value)}
                        >
                          <option value="">{t("social.cmGeneralStoreOption")}</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => generateSeoGapHandler(active)}
                          disabled={generatingSeoGap}
                          className="btn-ai min-h-[40px] shrink-0 px-4 py-2 text-xs"
                        >
                          {generatingSeoGap ? t("social.cmGeneratingStrategy") : t("social.cmGenSeoDraft")}
                        </button>
                      </div>
                    </div>

                    {seoStrategy ? (
                      <div className="space-y-4 pt-2">
                        <div className="flex items-center gap-2">
                          <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${seoStrategy.origin === "ai" ? "bg-emerald-500/20 text-emerald-300" : "bg-white/15 text-white/80"}`}>
                            {seoStrategy.origin === "ai" ? t("social.cmAiDraft") : t("social.cmTemplateDraft")}
                          </span>
                          <span className="text-[11px] text-white/60">{t("social.cmDraftNote")}</span>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div className="comp-dark-panel space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="comp-dark-label">
                                {t("social.cmMetaTitleLabel")}
                              </span>
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(seoStrategy.strategy.recommendedMetaTitle);
                                  setCopiedText("metaTitle");
                                  setTimeout(() => setCopiedText(""), 2000);
                                }}
                                className="min-h-[28px] rounded bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-white/25"
                              >
                                {copiedText === "metaTitle" ? t("social.cmCopiedBang") : t("social.cmCopy")}
                              </button>
                            </div>
                            <p className="font-bold text-sm text-emerald-300">
                              {seoStrategy.strategy.recommendedMetaTitle}
                            </p>
                            <span className="text-[10px] text-white/50">{t("social.cmLengthLine", { count: fmtNumber(locale, seoStrategy.strategy.recommendedMetaTitle.length), max: 60 })}</span>
                          </div>

                          <div className="comp-dark-panel space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="comp-dark-label">
                                📝 High-CTR Meta Description
                              </span>
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(seoStrategy.strategy.recommendedMetaDescription);
                                  setCopiedText("metaDesc");
                                  setTimeout(() => setCopiedText(""), 2000);
                                }}
                                className="min-h-[28px] rounded bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-white/25"
                              >
                                {copiedText === "metaDesc" ? t("social.cmCopiedBang") : t("social.cmCopy")}
                              </button>
                            </div>
                            <p className="text-xs text-white/85 leading-relaxed">
                              {seoStrategy.strategy.recommendedMetaDescription}
                            </p>
                            <span className="text-[10px] text-white/50">{t("social.cmLengthLine", { count: fmtNumber(locale, seoStrategy.strategy.recommendedMetaDescription.length), max: 155 })}</span>
                          </div>
                        </div>

                        <div className="comp-dark-panel space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="comp-dark-label">
                              {t("social.cmKeywordsLabel")}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-2 pt-1">
                            {seoStrategy.strategy.targetKeywords.map((kw: string, i: number) => (
                              <button
                                key={i}
                                onClick={() => {
                                  navigator.clipboard.writeText(kw);
                                  setCopiedText(kw);
                                  setTimeout(() => setCopiedText(""), 2000);
                                }}
                                className="min-h-[32px] rounded-lg bg-white/10 px-2.5 py-1 text-xs font-semibold text-white ring-1 ring-inset ring-white/20 transition hover:bg-white/20"
                              >
                                {kw} {copiedText === kw ? "✓" : "+"}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 rounded-xl bg-white/10 p-3 text-xs text-white/85 ring-1 ring-inset ring-white/15">
                          <span>💡</span>
                          <span><strong>{t("social.cmWhyHelps")}</strong> {seoStrategy.strategy.outrankTactics}</span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="card p-8 bg-white text-center text-xs text-slate-500">
                  <p>{t("social.cmSeoLoadHint")}</p>
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}
      {/* TAB 6: BAD REVIEW & COMPLAINT MINE (HF4: input-driven — only owner-pasted real reviews are analyzed) */}
      {activeTab === "complaints" ? (
        <div className="fade-rise space-y-6">
          {!active ? (
            <div className="card p-6 bg-white text-center space-y-4 sm:p-8">
              <div className="comp-icon-tile mx-auto h-14 w-14 text-2xl">
                💬
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">{t("social.cmSelectCompetitor")}</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
                  {t("social.cmReviewSelectSub")}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                {competitors.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => openCompetitor(c)}
                    className="btn-secondary btn-sm min-h-[40px]"
                  >
                    🏢 {c.name}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Header card */}
              <div className="card p-4 bg-white flex flex-col md:flex-row md:items-center md:justify-between gap-4 sm:p-5">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-bold text-slate-900">
                      {active.name} — Customer Sentiment & Complaint Mining
                    </h3>
                    <span className="badge bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-200">
                      {t("social.cmReviewBadge")}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {t("social.cmReviewHeaderSub")}
                  </p>
                </div>
              </div>

              {/* Paste real reviews */}
              <div className="card p-4 bg-white space-y-3 sm:p-5">
                <label className="text-xs font-bold text-slate-900 uppercase tracking-wider" htmlFor="review-paste-box">
                  {t("social.cmPasteLabel")}
                </label>
                <textarea
                  id="review-paste-box"
                  className="w-full min-h-[140px] rounded-xl border border-slate-200 p-3 text-sm text-slate-800 outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
                  placeholder={t("social.cmPastePlaceholder")}
                  value={reviewText}
                  onChange={(e) => setReviewText(e.target.value)}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className="btn-primary btn-sm min-h-[40px]"
                    disabled={loadingReviewMine || !reviewText.trim()}
                    onClick={() => analyzeReviews(active)}
                  >
                    {loadingReviewMine ? t("social.cmAnalyzing") : t("social.cmAnalyzeBtn")}
                  </button>
                  <span className="text-[11px] text-slate-400">
                    {t("social.cmReviewNote")}
                  </span>
                </div>
              </div>

              {loadingReviewMine ? (
                <div className="card p-6 bg-white space-y-5 sm:p-8" aria-hidden="true">
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <div className="skeleton h-3 w-2/3" />
                      <div className="skeleton h-9 w-1/3" />
                      <div className="skeleton h-3 w-4/5" />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <div className="skeleton h-3 w-1/3" />
                      <div className="skeleton h-2.5 w-full" />
                      <div className="skeleton h-3 w-1/2" />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="skeleton h-28 w-full" />
                    ))}
                  </div>
                  <p className="text-center text-sm text-slate-500">{t("social.cmReviewAnalyzing")}</p>
                </div>
              ) : reviewMineReport && !reviewMineReport.available ? (
                <div className="card p-8 bg-white text-center space-y-3">
                  <div className="comp-icon-tile mx-auto h-14 w-14 text-2xl">📋</div>
                  <h4 className="font-bold text-slate-900 text-sm">{t("social.cmReportNotCreated")}</h4>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    {reviewMineReport.reason}
                  </p>
                </div>
              ) : reviewMineReport ? (
                <div className="space-y-6">
                  {/* Satisfaction & Sentiment Overview */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="comp-metric">
                      <span className="stat-label">
                        {t("social.cmAvgRatingLabel")}
                      </span>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="text-3xl font-black text-rose-700">
                          {reviewMineReport.overallRatingScore !== null ? reviewMineReport.overallRatingScore : "—"}
                        </span>
                        {reviewMineReport.overallRatingScore !== null ? (
                          <span className="text-xs text-slate-400 font-semibold">{t("social.cmRatingOutOf")}</span>
                        ) : null}
                      </div>
                      <span className="stat-hint block">
                        {reviewMineReport.overallRatingScore !== null
                          ? t("social.cmTotalAnalyzed", { count: fmtNumber(locale, reviewMineReport.totalAnalyzedFeedback) })
                          : t("social.cmNoRatingNote")}
                      </span>
                    </div>

                    <div className="card p-4 bg-white md:col-span-2 space-y-2">
                      <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                        {t("social.cmSentimentTitle")}
                      </span>
                      <div className="space-y-2 pt-1">
                        <div>
                          <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                            <span>{t("social.cmDissatisfied")}</span>
                            <span className="text-rose-600 font-bold">{fmtNumber(locale, reviewMineReport.sentimentDistribution.dissatisfied)}%</span>
                          </div>
                          <div className="meter">
                            <div className="h-full rounded-full bg-rose-500 transition-[width] duration-500" style={{ width: `${reviewMineReport.sentimentDistribution.dissatisfied}%` }} />
                          </div>
                        </div>
                        <div className="flex justify-between text-xs text-slate-500 pt-1">
                          <span>{t("social.cmSatisfiedLine", { pct: fmtNumber(locale, reviewMineReport.sentimentDistribution.satisfied) })}</span>
                          <span>{t("social.cmNeutralLine", { pct: fmtNumber(locale, reviewMineReport.sentimentDistribution.neutral) })}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Biggest Vulnerability Alert */}
                  <div className="alert alert-red">
                    <span className="text-xl">🚨</span>
                    <div>
                      <h4 className="font-bold text-rose-950 text-sm">
                        {t("social.cmBiggestVuln")}
                      </h4>
                      <p className="mt-1 text-xs text-rose-800 leading-relaxed font-medium">
                        {reviewMineReport.biggestVulnerability}
                      </p>
                    </div>
                  </div>

                  {/* Recurring Complaint Categories */}
                  <div className="card p-4 bg-white space-y-4 sm:p-5">
                    <div className="border-b border-slate-100 pb-3">
                      <h4 className="font-bold text-slate-900 text-sm">
                        {t("social.cmComplaintsTitle")}
                      </h4>
                      <p className="text-xs text-slate-500">
                        {t("social.cmComplaintsSub")}
                      </p>
                    </div>

                    {reviewMineReport.topComplaints.length ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {reviewMineReport.topComplaints.map((item, idx) => (
                          <div key={idx} className="rounded-2xl p-4 bg-slate-50/50 space-y-2.5 ring-1 ring-inset ring-slate-200/60">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-slate-900 text-xs">{item.category}</span>
                              <div className="flex items-center gap-1.5">
                                <span className="rounded bg-rose-100 text-rose-800 text-[10px] font-bold px-1.5 py-0.5">
                                  {t("social.cmFreqLine", { pct: fmtNumber(locale, item.frequencyPercent), count: fmtNumber(locale, item.itemCount) })}
                                </span>
                                <span className={`rounded text-[10px] font-bold px-1.5 py-0.5 ${
                                  item.severity === "Critical" ? "bg-red-500 text-white" : "bg-amber-100 text-amber-800"
                                }`}>
                                  {item.severity}
                                </span>
                              </div>
                            </div>
                            <p className="text-xs text-slate-700 leading-relaxed">{item.complaintSummary}</p>
                            {item.sampleCustomerQuotes.length ? (
                              <div className="space-y-1 bg-white p-2.5 rounded-lg border border-slate-200/70">
                                <span className="text-[10px] font-bold text-slate-400 uppercase">{t("social.cmVerbatimLabel")}</span>
                                {item.sampleCustomerQuotes.map((q, qi) => (
                                  <p key={qi} className="text-[11px] text-slate-600 italic">
                                    &ldquo;{q}&rdquo;
                                  </p>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">{t("social.cmNoComplaints")}</p>
                    )}
                  </div>

                  {/* Counter-Positioning Angles */}
                  {reviewMineReport.recommendedCounterAngles.length ? (
                    <div className="comp-dark p-5 space-y-4 sm:p-6">
                      <div className="border-b border-white/15 pb-3">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500 text-sm">🎯</span>
                          <h4 className="font-bold text-base text-white">
                            {t("social.cmAnglesTitle")}
                          </h4>
                        </div>
                        <p className="text-xs text-white/70 mt-1">
                          {t("social.cmAnglesSub")}
                        </p>
                      </div>

                      <div className="grid sm:grid-cols-2 gap-4 pt-1">
                        {reviewMineReport.recommendedCounterAngles.map((angle, i) => (
                          <div key={i} className="comp-dark-panel space-y-3">
                            <div className="flex items-start justify-between gap-2">
                              <span className="font-bold text-sm text-emerald-300 leading-snug">
                                &ldquo;{angle.hookHeadline}&rdquo;
                              </span>
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(angle.hookHeadline);
                                  setCopiedText(`angle-${i}`);
                                  setTimeout(() => setCopiedText(""), 2000);
                                }}
                                className="min-h-[28px] rounded bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-white/25 shrink-0"
                              >
                                {copiedText === `angle-${i}` ? t("social.cmCopiedBang") : t("social.cmCopy")}
                              </button>
                            </div>

                            <div className="space-y-2 text-xs">
                              <div className="rounded-lg bg-white/5 p-2.5 ring-1 ring-inset ring-white/10">
                                <span className="font-semibold text-white/70 text-[11px] block">{t("social.cmTrustMechanism")}</span>
                                <p className="text-white/85 mt-0.5">{angle.trustMechanism}</p>
                              </div>
                              <div className="rounded-lg bg-white/5 p-2.5 ring-1 ring-inset ring-white/10">
                                <span className="font-semibold text-amber-300 text-[11px] block">{t("social.cmGuaranteeOffer")}</span>
                                <p className="text-white/85 mt-0.5">{angle.guaranteeOffer}</p>
                              </div>
                            </div>

                            <div className="text-[11px] text-white/60 italic pt-1 border-t border-white/10">
                              {t("social.cmWhySwitch", { text: angle.whyBuyersSwitch })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="card p-8 bg-white text-center text-xs text-slate-500">
                  <p>{t("social.cmReviewLoadHint")}</p>
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}
      {/* TAB 7: FUNNEL & CHECKOUT SPY (HF3: detected from real fetched pages; not-detected = শনাক্ত হয়নি) */}
      {activeTab === "funnel" ? (
        <div className="fade-rise space-y-6">
          {!active ? (
            <div className="card p-6 bg-white text-center space-y-4 sm:p-8">
              <div className="comp-icon-tile mx-auto h-14 w-14 text-2xl">
                🛒
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">{t("social.cmSelectCompetitor")}</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
                  {t("social.cmFunnelSelectSub")}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                {competitors.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      openCompetitor(c);
                      fetchFunnelAudit(c);
                    }}
                    className="btn-secondary btn-sm min-h-[40px]"
                  >
                    🏢 {c.name}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Header card */}
              <div className="card p-4 bg-white flex flex-col md:flex-row md:items-center md:justify-between gap-4 sm:p-5">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-bold text-slate-900">
                      {t("social.cmFunnelAuditTitle", { name: active.name })}
                    </h3>
                    <span className="badge bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200">
                      {t("social.cmDetectedBadge")}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {t("social.cmFunnelHeaderSub")}
                  </p>
                </div>
                <button
                  className="btn-secondary btn-sm min-h-[40px]"
                  disabled={loadingFunnel}
                  onClick={() => fetchFunnelAudit(active)}
                >
                  {loadingFunnel ? t("social.cmAuditing") : t("social.cmRescanFunnel")}
                </button>
              </div>

              {loadingFunnel ? (
                <div className="card p-6 bg-white space-y-5 sm:p-8" aria-hidden="true">
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="space-y-2">
                        <div className="skeleton h-3 w-2/3" />
                        <div className="skeleton h-8 w-1/2" />
                        <div className="skeleton h-3 w-4/5" />
                      </div>
                    ))}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="skeleton h-24 w-full" />
                    ))}
                  </div>
                  <p className="text-center text-sm text-slate-500">{t("social.cmFunnelFetching")}</p>
                </div>
              ) : funnelReport && !funnelReport.scanned ? (
                <div className="card p-8 bg-white text-center space-y-3">
                  <div className="comp-icon-tile mx-auto h-14 w-14 text-2xl">🚫</div>
                  <h4 className="font-bold text-slate-900 text-sm">{t("social.cmFunnelNotScanned")}</h4>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    {funnelReport.reason ?? t("social.cmFunnelNotScannedDefault")}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {t("social.cmFunnelNotScannedHint")}
                  </p>
                </div>
              ) : funnelReport ? (
                <div className="space-y-6">
                  {/* Detection overview */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="comp-metric">
                      <span className="stat-label">
                        {t("social.cmCheckoutLabel")}
                      </span>
                      <p className="mt-2 text-base font-black text-slate-900">
                        {funnelReport.checkoutDetected ? t("social.cmDetectedYes") : t("social.cmNotDetected")}
                      </p>
                      <span className="stat-hint block">{t("social.cmPagesScannedLine", { count: fmtNumber(locale, funnelReport.pagesScanned.length) })}</span>
                    </div>

                    <div className="comp-metric">
                      <span className="stat-label">
                        {t("social.cmFieldCountLabel")}
                      </span>
                      <p className="stat-value text-brand-700">
                        {funnelReport.checkoutFieldCount !== null ? t("social.cmCountSuffix", { count: fmtNumber(locale, funnelReport.checkoutFieldCount) }) : t("social.cmNotDetected")}
                      </p>
                      <span className="stat-hint block">{t("social.cmFieldCountHint")}</span>
                    </div>

                    <div className="comp-metric">
                      <span className="stat-label">
                        {t("social.cmGatewayLabel")}
                      </span>
                      <p className="stat-value text-blue-700">
                        {t("social.cmCountSuffix", { count: fmtNumber(locale, funnelReport.paymentGatewaysDetected.length) })}
                      </p>
                      <span className="stat-hint block">{t("social.cmGatewayHint")}</span>
                    </div>

                    <div className="comp-metric">
                      <span className="stat-label">
                        {t("social.cmTrustLabel")}
                      </span>
                      <p className="stat-value text-purple-700">
                        {t("social.cmCountSuffix", { count: fmtNumber(locale, funnelReport.trustSignalsDetected.length) })}
                      </p>
                      <span className="stat-hint block">{t("social.cmTrustHint")}</span>
                    </div>
                  </div>

                  {/* Form fields & payment/trust detection */}
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="card p-4 bg-white space-y-3">
                      <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                        {t("social.cmFieldsTitle")}
                      </span>
                      {funnelReport.checkoutFields.length ? (
                        <div className="space-y-1.5 pt-1">
                          {funnelReport.checkoutFields.map((rf, i) => (
                            <div key={i} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 border text-xs text-slate-800">
                              <span className="text-emerald-600 font-bold">✓</span>
                              <span>{rf}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 pt-1">{t("social.cmNoFields")}</p>
                      )}
                    </div>

                    <div className="card p-4 bg-white space-y-3">
                      <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                        {t("social.cmTrustTitle")}
                      </span>
                      {funnelReport.trustSignalsDetected.length ? (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {funnelReport.trustSignalsDetected.map((badge, i) => (
                            <span key={i} className="rounded-lg bg-emerald-50 text-emerald-800 text-xs px-2.5 py-1 font-semibold border border-emerald-200">
                              🛡️ {badge}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 pt-1">{t("social.cmNotDetectedDot")}</p>
                      )}
                      <div className="pt-2 border-t">
                        <span className="text-[11px] font-bold text-slate-500 uppercase block mb-1">{t("social.cmGatewayColon")}</span>
                        {funnelReport.paymentGatewaysDetected.length ? (
                          <div className="flex flex-wrap gap-1.5">
                            {funnelReport.paymentGatewaysDetected.map((pg, i) => (
                              <span key={i} className="rounded bg-slate-100 text-slate-700 text-[11px] px-2 py-0.5 font-medium">
                                💳 {pg}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-500">{t("social.cmNotDetectedDot")}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Bundle / combo hints actually printed on the pages */}
                  <div className="card p-4 bg-white space-y-4 sm:p-5">
                    <div className="border-b border-slate-100 pb-3">
                      <h4 className="font-bold text-slate-900 text-sm">
                        {t("social.cmBundleTitle")}
                      </h4>
                      <p className="text-xs text-slate-500">
                        {t("social.cmBundleSub")}
                      </p>
                    </div>
                    {funnelReport.bundleHints.length ? (
                      <div className="space-y-2">
                        {funnelReport.bundleHints.map((hint, idx) => (
                          <div key={idx} className="rounded-2xl border border-slate-200/70 bg-slate-50/50 p-4">
                            <p className="text-xs text-slate-700 leading-relaxed">&ldquo;{hint}&rdquo;</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">{t("social.cmNoBundle")}</p>
                    )}
                    <div className="pt-2 border-t">
                      <span className="text-[11px] font-bold text-slate-500 uppercase block mb-1">{t("social.cmScannedPagesLabel")}</span>
                      <div className="flex flex-wrap gap-1.5">
                        {funnelReport.pagesScanned.map((u, i) => (
                          <a key={i} href={u} target="_blank" rel="noreferrer" className="rounded bg-slate-100 text-blue-600 text-[11px] px-2 py-0.5 font-mono hover:underline truncate max-w-full">
                            {u}
                          </a>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* General advice — clearly labeled as NOT competitor findings */}
                  <div className="comp-dark p-5 space-y-4 sm:p-6">
                    <div className="border-b border-white/15 pb-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-500 text-sm">⚡</span>
                        <h4 className="font-bold text-base text-white">
                          {t("social.cmFunnelTipsTitle")}
                        </h4>
                        <span className="rounded bg-white/15 text-white/85 text-[10px] font-bold px-2 py-0.5">
                          {t("social.cmGeneralAdviceBadge")}
                        </span>
                      </div>
                      <p className="text-xs text-white/70 mt-1">
                        {t("social.cmFunnelTipsSub")}
                      </p>
                    </div>

                    <div className="grid sm:grid-cols-3 gap-3 pt-1">
                      {funnelReport.generalTips.map((tip, i) => (
                        <div key={i} className="comp-dark-panel space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-xs text-emerald-300">{tip.tactic}</span>
                            <span className={`rounded text-[10px] font-bold px-1.5 py-0.5 ${
                              tip.impact === "Critical" ? "bg-red-500 text-white" : "bg-white/15 text-white"
                            }`}>
                              {tip.impact}
                            </span>
                          </div>
                          <p className="text-xs text-white/80 leading-relaxed font-sans">
                            {tip.howToBeatThem}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="card p-8 bg-white text-center text-xs text-slate-500">
                  <p>{t("social.cmFunnelLoadHint")}</p>
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}
      {/* White-Label Agency Dossier Audit Modal v2 */}
      <CompetitorDossierModal
        isOpen={isDossierOpen}
        onClose={() => setIsDossierOpen(false)}
        loading={loadingDossier}
        data={dossierData}
      />

      {/* Counter-Ad Generator Modal v2 */}
      {counterModalAd ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center modal-backdrop sm:items-center sm:p-4">
          <div className="comp-sheet space-y-4 sm:max-w-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  ⚡ AI Counter-Ad & Strategy Generator
                </h3>
                <p className="text-xs text-slate-500">
                  {t("social.cmCounterSub")}
                </p>
              </div>
              <button
                onClick={() => setCounterModalAd(null)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            {/* Competitor Ad Snippet */}
            <div className="rounded-2xl bg-slate-50 p-3.5 text-xs ring-1 ring-inset ring-slate-200/60">
              <span className="font-semibold text-slate-500 uppercase tracking-wider text-[10px]">
                {t("social.cmOriginalAdLabel", { platforms: counterModalAd.platforms.join(", ") })}
              </span>
              <p className="mt-1 text-slate-700 line-clamp-3">
                {counterModalAd.creativeText || t("social.cmNoText")}
              </p>
            </div>

            {/* Select Our Product */}
            <div>
              <label className="text-xs font-semibold text-slate-700">
                {t("social.cmCounterProductQ")}
              </label>
              <select
                className={inputCls}
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
              >
                <option value="">{t("social.cmDefaultStoreOption")}</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({fmtMoneyMinor(locale, BigInt(p.priceMinor), { currency: p.currency })})
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleGenerateCounterAd}
              disabled={isGeneratingCounterAd}
              className="btn-primary min-h-[44px] w-full py-2.5 text-sm flex items-center justify-center gap-2"
            >
              {isGeneratingCounterAd ? (
                <span>{t("social.cmGeneratingCounter")}</span>
              ) : (
                <span>🚀 Generate Unstoppable Counter-Campaign</span>
              )}
            </button>

            {/* Results Display */}
            {counterAdResult ? (
              <div className="space-y-4 border-t border-slate-100 pt-4">
                <div>
                  <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${counterAdResult.origin === "ai" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>
                    {counterAdResult.origin === "ai" ? t("social.cmAiDraft") : t("social.cmTemplateDraft")}
                  </span>
                  <span className="ml-2 text-[11px] text-slate-400">{t("social.cmCounterDraftNote")}</span>
                </div>
                {/* Hook & Weakness Breakdown */}
                <div className="comp-soft-panel">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-slate-900">
                    {t("social.cmHookAnalysisTitle")}
                  </h4>
                  <p className="mt-1 text-xs text-slate-700">
                    <span className="font-semibold">Hook Type:</span>{" "}
                    {counterAdResult.hookBreakdown.hookType}
                  </p>
                  <p className="mt-1 text-xs text-slate-700">
                    <span className="font-semibold">Angle:</span>{" "}
                    {counterAdResult.hookBreakdown.competitorAngle}
                  </p>
                  <div className="mt-2">
                    <span className="font-semibold text-xs text-red-700">{t("social.cmWeaknessesLabel")}</span>
                    <ul className="list-disc pl-4 text-xs text-slate-600 mt-1 space-y-0.5">
                      {counterAdResult.hookBreakdown.weaknesses.map((w, idx) => (
                        <li key={idx}>{w}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Generated Copy */}
                <div className="rounded-2xl bg-emerald-50/50 p-4 ring-1 ring-inset ring-emerald-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-xs uppercase tracking-wider text-emerald-900">
                      {t("social.cmCounterCopyTitle")}
                    </h4>
                    {copiedText ? (
                      <span className="text-xs font-semibold text-emerald-600">✓ {copiedText}</span>
                    ) : null}
                  </div>

                  <div>
                    <span className="text-[11px] font-semibold text-slate-500">HEADLINE:</span>
                    <div className="flex items-center justify-between bg-white p-2 rounded border mt-0.5">
                      <span className="text-xs font-bold text-slate-900">
                        {counterAdResult.counterCampaign.headline}
                      </span>
                      <button
                        onClick={() =>
                          copyToClipboard(counterAdResult.counterCampaign.headline, t("social.cmHeadlineCopied"))
                        }
                        className="text-xs text-blue-600 hover:underline"
                      >
                        {t("social.cmCopyWord")}
                      </button>
                    </div>
                  </div>

                  <div>
                    <span className="text-[11px] font-semibold text-slate-500">PRIMARY AD TEXT:</span>
                    <div className="bg-white p-2.5 rounded border mt-0.5 text-xs whitespace-pre-wrap text-slate-800">
                      {counterAdResult.counterCampaign.primaryText}
                      <div className="text-right mt-2 border-t pt-1">
                        <button
                          onClick={() =>
                            copyToClipboard(counterAdResult.counterCampaign.primaryText, t("social.cmPrimaryCopied"))
                          }
                          className="text-xs font-semibold text-blue-600 hover:underline"
                        >
                          {t("social.cmCopyFullText")}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                    <div className="bg-white p-2 rounded border">
                      <span className="font-semibold text-slate-500">{t("social.cmOfferAdvice")}</span>
                      <p className="font-medium text-emerald-700">
                        {counterAdResult.counterCampaign.suggestedOffer}
                      </p>
                    </div>
                    <div className="bg-white p-2 rounded border">
                      <span className="font-semibold text-slate-500">{t("social.cmCtaLabel")}</span>
                      <p className="font-medium text-slate-900">
                        {counterAdResult.counterCampaign.callToAction}
                      </p>
                    </div>
                  </div>

                  <p className="text-xs text-slate-500 italic">
                    {t("social.cmWhyBeats", { text: counterAdResult.counterCampaign.whyThisBeatsCompetitor })}
                  </p>

                  <div className="pt-2 border-t border-emerald-200/80">
                    <button
                      onClick={pushToCampaignBuilder}
                      className="w-full min-h-[44px] rounded-lg bg-gradient-to-r from-emerald-600 to-teal-700 py-2.5 text-xs font-bold text-white shadow hover:from-emerald-700 hover:to-teal-800 flex items-center justify-center gap-2"
                    >
                      <span>{t("social.cmPushBuilder")}</span>
                      <span>➔</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Video Script Deconstructor Modal v2 */}
      {videoModalAd ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center modal-backdrop sm:items-center sm:p-4">
          <div className="comp-sheet space-y-5 sm:max-w-4xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="comp-icon-tile h-10 w-10 text-lg">
                  🎬
                </span>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Viral UGC & Video Script Deconstructor
                  </h3>
                  <p className="text-xs text-slate-500">
                    {t("social.cmVideoSub")}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setVideoModalAd(null)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            {/* Competitor Ad Snippet */}
            <div className="rounded-2xl bg-slate-50 p-3.5 text-xs ring-1 ring-inset ring-slate-200/60">
              <span className="font-semibold text-slate-500 uppercase tracking-wider text-[10px]">
                {t("social.cmOriginalVideoLabel", { platforms: videoModalAd.platforms.join(", ") })}
              </span>
              <p className="mt-1 text-slate-800 line-clamp-3 leading-relaxed">
                {videoModalAd.creativeText || t("social.cmNoVideoText")}
              </p>
            </div>

            {/* Inputs: Product & Style */}
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  {t("social.cmVideoProductQ")}
                </label>
                <select
                  className={inputCls}
                  value={selectedProductIdForVideo}
                  onChange={(e) => setSelectedProductIdForVideo(e.target.value)}
                >
                  <option value="">{t("social.cmDefaultProductOption")}</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({fmtMoneyMinor(locale, BigInt(p.priceMinor), { currency: p.currency })})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  {t("social.cmVideoStyleLabel")}
                </label>
                <select
                  className={inputCls}
                  value={videoScriptStyle}
                  onChange={(e) => setVideoScriptStyle(e.target.value)}
                >
                  <option value="ugc">{t("social.cmStyleUgc")}</option>
                  <option value="unboxing">{t("social.cmStyleUnboxing")}</option>
                  <option value="problem_solution">{t("social.cmStyleProblem")}</option>
                  <option value="skit">{t("social.cmStyleSkit")}</option>
                </select>
              </div>
            </div>

            <button
              onClick={deconstructVideoScriptHandler}
              disabled={isVideoDeconstructing}
              className="btn-ai min-h-[44px] w-full py-3 text-xs"
            >
              {isVideoDeconstructing ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-r-transparent" />
                  <span>{t("social.cmVideoAnalyzing")}</span>
                </>
              ) : (
                <>
                  <span>{t("social.cmDeconstructRun")}</span>
                  <span>➔</span>
                </>
              )}
            </button>

            {/* Generated Script Results */}
            {videoScriptResult ? (
              <div className="space-y-5 pt-3 border-t">
                <div>
                  <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${videoScriptResult.origin === "ai" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>
                    {videoScriptResult.origin === "ai" ? t("social.cmAiDraft") : t("social.cmTemplateDraft")}
                  </span>
                  <span className="ml-2 text-[11px] text-slate-400">{t("social.cmScriptDraftNote")}</span>
                </div>
                {/* Hook & Retention Breakdown Card */}
                <div className="comp-soft-panel space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                      <span>{t("social.cmHookAnalysis")}</span>
                      <span className="badge-brand">
                        {videoScriptResult.hookCategory}
                      </span>
                    </span>
                    <span className="text-xs font-semibold text-slate-600">
                      {t("social.cmTotalDuration", { sec: fmtNumber(locale, videoScriptResult.totalDurationSeconds), format: videoScriptResult.format })}
                    </span>
                  </div>
                  <div className="grid sm:grid-cols-3 gap-3 text-xs">
                    <div className="rounded-xl bg-white p-3 ring-1 ring-inset ring-slate-200/60">
                      <span className="font-semibold text-slate-500 text-[11px]">{t("social.cmScrollHook")}</span>
                      <p className="mt-1 font-bold text-slate-800">{videoScriptResult.competitorHookBreakdown.firstThreeSecondsHook}</p>
                    </div>
                    <div className="rounded-xl bg-white p-3 ring-1 ring-inset ring-slate-200/60">
                      <span className="font-semibold text-slate-500 text-[11px]">{t("social.cmRetention")}</span>
                      <p className="mt-1 text-slate-700">{videoScriptResult.competitorHookBreakdown.whyItRetainsViewers}</p>
                    </div>
                    <div className="rounded-xl bg-white p-3 ring-1 ring-inset ring-slate-200/60">
                      <span className="font-semibold text-slate-500 text-[11px]">{t("social.cmTrigger")}</span>
                      <p className="mt-1 font-semibold text-brand-700">{videoScriptResult.competitorHookBreakdown.coreEmotionalTrigger}</p>
                    </div>
                  </div>
                </div>

                {/* Scene-by-Scene Storyboard & Teleprompter */}
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="font-bold text-slate-900 text-sm">
                      {t("social.cmStoryboardTitle", { title: videoScriptResult.adaptedScript.conceptTitle })}
                    </h4>
                    <span className="text-xs text-slate-400">{t("social.cmFormatNote")}</span>
                  </div>

                  <div className="table-wrap">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr>
                          <th className="w-24">{t("social.cmThTimestamp")}</th>
                          <th className="w-36">{t("social.cmThPhase")}</th>
                          <th>{t("social.cmThVisual")}</th>
                          <th>{t("social.cmThAudio")}</th>
                          <th>{t("social.cmThScreenText")}</th>
                        </tr>
                      </thead>
                      <tbody className="text-slate-800">
                        {videoScriptResult.adaptedScript.scenes.map((scene, idx) => (
                          <tr key={idx}>
                            <td className="font-mono font-bold text-brand-700">
                              {scene.timeRange}
                            </td>
                            <td>
                              <span className="badge-brand">
                                {scene.phase}
                              </span>
                            </td>
                            <td className="text-slate-600">
                              <span className="font-medium text-slate-900">{scene.visualCue}</span>
                              <p className="text-[10px] text-slate-400 mt-0.5">{t("social.cmNotePrefix", { text: scene.directorNotes })}</p>
                            </td>
                            <td className="font-semibold text-slate-900 leading-relaxed">
                              &ldquo;{scene.audioVoiceover}&rdquo;
                            </td>
                            <td className="font-bold text-pink-700">
                              {scene.onScreenText}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Teleprompter Box */}
                <div className="comp-dark p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="comp-dark-label">
                      {t("social.cmTeleprompterLabel")}
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(videoScriptResult.adaptedScript.fullVoiceoverBangla);
                        setCopiedText("voiceover");
                        setTimeout(() => setCopiedText(""), 2000);
                      }}
                      className="flex min-h-[32px] items-center gap-1 rounded-lg bg-white/15 px-2.5 py-1 text-xs font-semibold text-white ring-1 ring-inset ring-white/20 hover:bg-white/25"
                    >
                      {copiedText === "voiceover" ? t("social.cmCopiedBang") : t("social.cmCopyTeleprompter")}
                    </button>
                  </div>
                  <p className="text-xs text-white/85 leading-relaxed font-sans">
                    {videoScriptResult.adaptedScript.fullVoiceoverBangla}
                  </p>
                </div>

                {/* Creator Shooting Checklist */}
                <div className="grid sm:grid-cols-2 gap-3 text-xs">
                  <div className="rounded-xl border p-3.5 bg-slate-50 space-y-2">
                    <span className="font-bold text-slate-900 block">{t("social.cmChecklistTitle")}</span>
                    <ul className="space-y-1 text-slate-600 list-disc list-inside text-[11px]">
                      {videoScriptResult.adaptedScript.creatorShootingChecklist.map((item, ix) => (
                        <li key={ix}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-xl border p-3.5 bg-slate-50 space-y-2">
                    <span className="font-bold text-slate-900 block">{t("social.cmMusicTitle")}</span>
                    <p className="text-slate-700 text-[11px] leading-relaxed">
                      {videoScriptResult.adaptedScript.suggestedAudioTrack}
                    </p>
                    <div className="pt-2 border-t text-[11px] text-slate-500">
                      {t("social.cmMusicTip")}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Alert Bot Settings Modal v2 */}
      {isAlertSettingsOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center modal-backdrop sm:items-center sm:p-4">
          <form onSubmit={saveAlertSettingsHandler} className="comp-sheet space-y-5 sm:max-w-lg">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="comp-icon-tile h-10 w-10 text-lg">
                  📲
                </span>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Telegram & WhatsApp Real-Time Alert Bot
                  </h3>
                  <p className="text-xs text-slate-500">
                    {t("social.cmAlertBotSub")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAlertSettingsOpen(false)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            {/* Telegram Settings */}
            <div className="rounded-2xl p-4 bg-slate-50 space-y-3 ring-1 ring-inset ring-slate-200/60">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 font-bold text-xs text-slate-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={alertConfig.telegramEnabled}
                    onChange={(e) => setAlertConfig({ ...alertConfig, telegramEnabled: e.target.checked })}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>{t("social.cmTelegramEnable")}</span>
                </label>
                <button
                  type="button"
                  disabled={!alertConfig.telegramBotToken || !alertConfig.telegramChatId || isTestingAlert}
                  onClick={() => testAlertChannelHandler("telegram")}
                  className="comp-soft-btn min-h-[32px] px-2.5 py-1 text-[11px]"
                >
                  {isTestingAlert ? t("social.cmSending") : t("social.cmTestMsgBtn")}
                </button>
              </div>

              {alertConfig.telegramEnabled ? (
                <div className="space-y-2 pt-1 text-xs">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">
                      {t("social.cmBotTokenLabel")}
                    </label>
                    <input
                      className={inputCls}
                      placeholder="e.g. 7123456789:AAH..."
                      value={alertConfig.telegramBotToken || ""}
                      onChange={(e) => setAlertConfig({ ...alertConfig, telegramBotToken: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">
                      Telegram Chat ID / Channel ID
                    </label>
                    <input
                      className={inputCls}
                      placeholder={t("social.cmChatIdPlaceholder")}
                      value={alertConfig.telegramChatId || ""}
                      onChange={(e) => setAlertConfig({ ...alertConfig, telegramChatId: e.target.value })}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            {/* WhatsApp Settings */}
            <div className="rounded-2xl p-4 bg-slate-50 space-y-3 ring-1 ring-inset ring-slate-200/60">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 font-bold text-xs text-slate-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={alertConfig.whatsappEnabled}
                    onChange={(e) => setAlertConfig({ ...alertConfig, whatsappEnabled: e.target.checked })}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>{t("social.cmWaWebhookLabel2")}</span>
                </label>
                <button
                  type="button"
                  disabled={!alertConfig.whatsappWebhookUrl || isTestingAlert}
                  onClick={() => testAlertChannelHandler("whatsapp")}
                  className="min-h-[32px] rounded-lg border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                >
                  {isTestingAlert ? t("social.cmSending") : t("social.cmTestWebhookBtn")}
                </button>
              </div>

              {alertConfig.whatsappEnabled ? (
                <div className="pt-1 text-xs">
                  <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">
                    WhatsApp Webhook URL (Make / Zapier / UltraMsg / WPPConnect)
                  </label>
                  <input
                    className={inputCls}
                    placeholder="https://hook.eu1.make.com/..."
                    value={alertConfig.whatsappWebhookUrl || ""}
                    onChange={(e) => setAlertConfig({ ...alertConfig, whatsappWebhookUrl: e.target.value })}
                  />
                </div>
              ) : null}
            </div>

            {/* Trigger Checkboxes */}
            <div className="space-y-2 border-t pt-3 text-xs">
              <span className="font-bold text-slate-800 block">{t("social.cmAlertCasesTitle")}</span>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={alertConfig.notifyOnStockOut}
                    onChange={(e) => setAlertConfig({ ...alertConfig, notifyOnStockOut: e.target.checked })}
                  />
                  <span>{t("social.cmAlertStockOut")}</span>
                </label>
                <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={alertConfig.notifyOnPriceDrop}
                    onChange={(e) => setAlertConfig({ ...alertConfig, notifyOnPriceDrop: e.target.checked })}
                  />
                  <span>{t("social.cmAlertPriceDrop")}</span>
                </label>
                <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={alertConfig.notifyOnWinningAd}
                    onChange={(e) => setAlertConfig({ ...alertConfig, notifyOnWinningAd: e.target.checked })}
                  />
                  <span>{t("social.cmAlertWinning")}</span>
                </label>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex flex-col-reverse gap-2 pt-2 border-t border-slate-100 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setIsAlertSettingsOpen(false)}
                className="btn-secondary min-h-[40px] text-xs"
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={isSavingAlertConfig}
                className="btn-primary min-h-[40px] text-xs py-2 px-4 disabled:opacity-50"
              >
                {isSavingAlertConfig ? t("social.cmSavingSettings") : t("social.cmSaveSettings")}
              </button>
            </div>
          </form>
        </div>
      ) : null}



      {/* AI Market Intelligence Feed */}
      <div className="card fade-rise p-4 bg-white sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="font-bold text-slate-900">
              AI Market Intelligence {active ? `(${active.name})` : t("social.cmIntelAllSuffix")}
            </h3>
            <p className="text-xs text-slate-400">
              {t("social.cmIntelSub")}
            </p>
          </div>
          <button
            className="btn-primary min-h-[40px] text-xs py-1.5 px-3 disabled:opacity-50"
            disabled={busy !== ""}
            onClick={generateInsights}
          >
            {busy === "insights" ? t("social.cmGeneratingInsights") : t("social.cmGenInsights")}
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {insights.map((ins) => (
            <div key={ins.id} className="rounded-2xl bg-slate-50/70 p-3.5 text-xs ring-1 ring-inset ring-slate-200/60">
              <div className="font-semibold text-slate-900 flex flex-wrap items-center justify-between gap-2">
                <span>{ins.title}</span>
                <span className="badge-slate">
                  {ins.kind} · {ins.provider}
                </span>
              </div>
              {ins.detail ? <p className="mt-1 text-slate-600 leading-relaxed">{ins.detail}</p> : null}
              <div className="mt-2 text-[11px] text-slate-400">
                {t("social.cmEvidenceLabel")}{" "}
                {ins.evidence.map((e, i) => (
                  <span key={i}>
                    {i > 0 ? " · " : ""}
                    {e.url ? (
                      <a className="text-blue-600 hover:underline" href={e.url} target="_blank" rel="noreferrer">
                        {e.label}
                      </a>
                    ) : (
                      e.label
                    )}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {insights.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">
              {t("social.cmNoInsights")}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
