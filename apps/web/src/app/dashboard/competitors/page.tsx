"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor } from "@repo/contracts";
import { EmptyState } from "@repo/ui";

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

interface OrganicKeyword {
  keyword: string;
  estimatedPosition: number;
  searchVolume: number;
  keywordDifficulty: number;
  intent: "Transactional" | "Commercial" | "Informational";
  estimatedMonthlyClicks: number;
  rankingUrl: string;
}

interface TopOrganicPage {
  url: string;
  title: string;
  estimatedTrafficShare: number;
  primaryKeywords: string[];
}

interface SeoTrafficReport {
  domain: string;
  estimatedMonthlyOrganicVisits: number;
  domainAuthorityScore: number;
  totalIndexedKeywords: number;
  topKeywords: OrganicKeyword[];
  topPages: TopOrganicPage[];
  intentDistribution: {
    transactional: number;
    commercial: number;
    informational: number;
  };
  focusKeywordThemes: string[];
}

interface SeoStrategyResult {
  competitor: {
    id: string;
    name: string;
    domain: string;
    monthlyOrganicVisits: number;
    domainAuthority: number;
  };
  seoReport: SeoTrafficReport;
  strategy: {
    recommendedMetaTitle: string;
    recommendedMetaDescription: string;
    targetKeywords: string[];
    outrankTactics: string;
    estimatedCtrBoost: string;
  };
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
  complaintSummary: string;
  sampleCustomerQuotes: string[];
  severity: "High" | "Medium" | "Critical";
}

interface CompetitorReviewMineReport {
  competitorName: string;
  domain: string;
  overallRatingScore: number;
  totalAnalyzedFeedback: number;
  sentimentDistribution: {
    satisfied: number;
    neutral: number;
    dissatisfied: number;
  };
  topComplaints: CustomerComplaintTheme[];
  biggestVulnerability: string;
  recommendedCounterAngles: {
    hookHeadline: string;
    trustMechanism: string;
    guaranteeOffer: string;
    whyBuyersSwitch: string;
  }[];
}

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

export default function CompetitorsPage() {
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [active, setActive] = useState<Competitor | null>(null);
  const [ads, setAds] = useState<Ad[]>([]);
  const [observations, setObservations] = useState<Obs[]>([]);
  const [comparison, setComparison] = useState<ComparisonRow[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [alerts, setAlerts] = useState<Insight[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  // Workspace Tabs
  const [activeTab, setActiveTab] = useState<"spy" | "swipefile" | "pricing" | "playbook" | "seo" | "complaints">("spy");

  // Swipe File (Saved creatives)
  const [savedSwipeIds, setSavedSwipeIds] = useState<string[]>([]);

  // White-label Dossier Modal
  const [isDossierOpen, setIsDossierOpen] = useState(false);
  const [dossierData, setDossierData] = useState<DossierData | null>(null);
  const [loadingDossier, setLoadingDossier] = useState(false);

  // SEO & Traffic Spy State
  const [seoReport, setSeoReport] = useState<SeoTrafficReport | null>(null);
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
      setNotice("ক্রিয়েটিভ সোয়াইপ ফাইল থেকে রিমুভ করা হয়েছে।");
    } else {
      next = [...savedSwipeIds, adId];
      setNotice("ক্রিয়েটিভ সোয়াইপ ফাইলে সফলভাবে সংরক্ষিত হয়েছে! 💾");
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
  }, [load]);

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
      setNotice("Telegram ও WhatsApp অ্যালার্ট বট সেটিংস সফলভাবে সংরক্ষিত হয়েছে! 📲");
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
        setNotice(`টেস্ট নোটিফিকেশন সফলভাবে পাঠানো হয়েছে! 🔔 আপনার ${channel === "telegram" ? "Telegram" : "WhatsApp"}-এ চেক করুন।`);
      } else {
        setError(`নোটিফিকেশন পাঠানো যায়নি: ${res.error || "Unknown error"}`);
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
      const report = await apiFetch<SeoTrafficReport>(`/organizations/${orgId}/competitors/${c.id}/seo-traffic`);
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
      setNotice("AI SEO Gap ও কিওয়ার্ড হাইজ্যাক স্ট্র্যাটেজি সফলভাবে তৈরি হয়েছে! 🚀");
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
      setNotice("ভিডিও স্ক্রিপ্ট ডিকনস্ট্রাকশন ও UGC স্টোরিবোর্ড সফলভাবে তৈরি হয়েছে! 🎬");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to deconstruct video script");
    } finally {
      setIsVideoDeconstructing(false);
    }
  }

  const fetchReviewMine = useCallback(async (c: Competitor) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setLoadingReviewMine(true);
    setError("");
    try {
      const res = await apiFetch<CompetitorReviewMineReport>(
        `/organizations/${orgId}/competitors/${c.id}/reviews-mine`
      );
      setReviewMineReport(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load review mine");
    } finally {
      setLoadingReviewMine(false);
    }
  }, []);

  const openCompetitor = useCallback(async (c: Competitor) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setActive(c);
    setSeoReport(null);
    setSeoStrategy(null);
    setReviewMineReport(null);
    try {
      const [a, o] = await Promise.all([
        apiFetch<Ad[]>(`/organizations/${orgId}/competitors/${c.id}/ads`),
        apiFetch<Obs[]>(`/organizations/${orgId}/competitors/${c.id}/observations`),
      ]);
      setAds(a);
      setObservations(o);
      if (activeTab === "seo") {
        fetchSeoReport(c);
      } else if (activeTab === "complaints") {
        fetchReviewMine(c);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load competitor details");
    }
  }, [activeTab, fetchSeoReport, fetchReviewMine]);



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
      setNotice("প্রতিযোগী সফলভাবে যোগ করা হয়েছে!");
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
      setNotice("প্রতিযোগীর তথ্য আপডেট হয়েছে!");
      await load();
      if (active?.id === editCompetitor.id) {
        await openCompetitor({ ...active, ...editCompetitor });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function deleteCompetitor(id: string, name: string) {
    if (!confirm(`আপনি কি সত্যিই "${name}" প্রতিযোগীকে মুছে ফেলতে চান? এর সকল অ্যাড ও প্রাইস রেকর্ড মুছে যাবে।`)) return;
    const orgId = getOrganizationId();
    if (!orgId) return;
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/competitors/${id}`, { method: "DELETE" });
      setNotice(`"${name}" ডিলিট করা হয়েছে।`);
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
    setNotice("ক্যাম্পেইন ড্রাফট সেভ হয়েছে! Campaign Builder-এ রিডাইরেক্ট হচ্ছে...");
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
      }>(`/organizations/${orgId}/competitors/${c.id}/sync-multi-platform`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setNotice(
        `${c.name}: মাল্টি-প্ল্যাটফর্ম থেকে মোট ${res.fetched}টি বিজ্ঞাপন পাওয়া গেছে! (Facebook: ${
          res.breakdown?.facebook ?? 0
        }, Google: ${res.breakdown?.google ?? 0}, TikTok: ${res.breakdown?.tiktok ?? 0}, Bing: ${
          res.breakdown?.bing ?? 0
        })`
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
      const alertMsg = res.alerts?.length ? ` 🚨 নতুন ${res.alerts.length}টি লাইভ অপরচুনিটি অ্যালার্ট পাওয়া গেছে!` : "";
      setNotice(`${c.name}: ${res.scannedUrls}টি পেজ স্ক্যান, ${res.stored}টি দাম সংরক্ষিত।${alertMsg}`);
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
        `${res.generated}টি Insight তৈরি হয়েছে${
          res.droppedWithoutEvidence ? `, প্রমাণহীন ${res.droppedWithoutEvidence}টি বাদ দেওয়া হয়েছে` : ""
        }`
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

  const inputCls = "input mt-1 w-full";

  function getPlatformBadge(platforms: string[]) {
    const pStr = platforms.join(" ").toLowerCase();
    if (pStr.includes("tiktok")) {
      return (
        <span className="rounded-full bg-pink-100 text-pink-800 border border-pink-200 px-2 py-0.5 text-[10px] font-bold flex items-center gap-1">
          🎵 TikTok
        </span>
      );
    }
    if (pStr.includes("google")) {
      return (
        <span className="rounded-full bg-blue-100 text-blue-800 border border-blue-200 px-2 py-0.5 text-[10px] font-bold flex items-center gap-1">
          🔍 Google Ads
        </span>
      );
    }
    if (pStr.includes("bing") || pStr.includes("microsoft")) {
      return (
        <span className="rounded-full bg-cyan-100 text-cyan-800 border border-cyan-200 px-2 py-0.5 text-[10px] font-bold flex items-center gap-1">
          🌐 Bing
        </span>
      );
    }
    return (
      <span className="rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200 px-2 py-0.5 text-[10px] font-bold flex items-center gap-1">
        📘 Meta
      </span>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header with Navigation Tabs */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="page-title">Competitor Intelligence Suite</h1>
            <span className="rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 px-2.5 py-0.5 text-xs font-semibold text-white shadow-sm">
              v2.0 Full Suite
            </span>
          </div>
          <p className="text-sm text-slate-500">
            রিয়েল-টাইম অ্যাড স্পাই, প্রাইস ড্রপ অ্যালার্ট, স্টক-আউট অপরচুনিটি ও এআই কাউন্টার স্ট্র্যাটেজি ইঞ্জিন
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsAlertSettingsOpen(true)}
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 flex items-center gap-1.5"
          >
            <span>📲 Telegram & WhatsApp Alert Bot</span>
            <span className="rounded bg-emerald-100 text-emerald-800 px-1 py-0.2 text-[10px] font-bold">24/7</span>
          </button>
          <button
            onClick={openDossierModalHandler}
            className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-slate-800 flex items-center gap-1.5"
          >
            <span>📄 White-Label Agency Audit</span>
            <span className="rounded bg-indigo-500/30 px-1 py-0.2 text-[10px] font-medium">Export</span>
          </button>
        </div>
      </div>


      {/* Main Feature Tabs */}
      <div className="flex flex-wrap gap-2 border-b pb-2">
        <button
          onClick={() => setActiveTab("spy")}
          className={`rounded-lg px-4 py-2 text-xs font-bold transition-all ${
            activeTab === "spy"
              ? "bg-slate-900 text-white shadow"
              : "bg-white text-slate-600 border hover:bg-slate-50"
          }`}
        >
          🌐 Multi-Platform Ad Spy ({ads.length})
        </button>
        <button
          onClick={() => setActiveTab("swipefile")}
          className={`rounded-lg px-4 py-2 text-xs font-bold transition-all flex items-center gap-1 ${
            activeTab === "swipefile"
              ? "bg-indigo-600 text-white shadow"
              : "bg-white text-slate-600 border hover:bg-slate-50"
          }`}
        >
          <span>💾 Swipe File & Inspiration ({savedSwipeIds.length})</span>
        </button>
        <button
          onClick={() => setActiveTab("pricing")}
          className={`rounded-lg px-4 py-2 text-xs font-bold transition-all ${
            activeTab === "pricing"
              ? "bg-slate-900 text-white shadow"
              : "bg-white text-slate-600 border hover:bg-slate-50"
          }`}
        >
          🏷️ Price & Stock Comparison
        </button>
        <button
          onClick={() => setActiveTab("playbook")}
          className={`rounded-lg px-4 py-2 text-xs font-bold transition-all ${
            activeTab === "playbook"
              ? "bg-slate-900 text-white shadow"
              : "bg-white text-slate-600 border hover:bg-slate-50"
          }`}
        >
          📊 Strategy & Offer Playbook
        </button>
        <button
          onClick={() => {
            setActiveTab("seo");
            if (active) fetchSeoReport(active);
          }}
          className={`rounded-lg px-4 py-2 text-xs font-bold transition-all flex items-center gap-1.5 ${
            activeTab === "seo"
              ? "bg-slate-900 text-white shadow"
              : "bg-white text-slate-600 border hover:bg-slate-50"
          }`}
        >
          <span>🔍 SEO & Traffic Spy</span>
          <span className="rounded bg-emerald-500/20 text-emerald-700 px-1 py-0.2 text-[9px] font-bold">New</span>
        </button>
        <button
          onClick={() => {
            setActiveTab("complaints");
            if (active) fetchReviewMine(active);
          }}
          className={`rounded-lg px-4 py-2 text-xs font-bold transition-all flex items-center gap-1.5 ${
            activeTab === "complaints"
              ? "bg-slate-900 text-white shadow"
              : "bg-white text-slate-600 border hover:bg-slate-50"
          }`}
        >
          <span>💬 Bad Review Mine</span>
          <span className="rounded bg-rose-500/20 text-rose-700 px-1 py-0.2 text-[9px] font-bold">Hot</span>
        </button>
      </div>



      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      {/* 🚨 Live Intelligence Alerts Banner */}
      {alerts.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-red-500 animate-ping" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-amber-900">
                🚨 Live Opportunity & Threat Alerts ({alerts.length})
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsAlertSettingsOpen(true)}
                className="rounded-lg bg-amber-200/70 hover:bg-amber-200 px-2.5 py-1 text-[11px] font-bold text-amber-900 flex items-center gap-1 transition-colors"
                title="টেলিগ্রাম ও হোয়াটসঅ্যাপে ইনস্ট্যান্ট নোটিফিকেশন চালু করুন"
              >
                📲 Telegram / WhatsApp বট
              </button>
              <span className="text-[11px] text-amber-800 font-medium">ইনস্ট্যান্ট অ্যাকশনেবল অপরচুনিটি</span>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {alerts.slice(0, 4).map((alt) => (
              <div key={alt.id} className="rounded-lg bg-white p-2.5 text-xs border border-amber-200/80 shadow-xs">
                <span className="font-bold text-slate-900">{alt.title}</span>
                <p className="mt-1 text-slate-600 text-[11px] line-clamp-2">{alt.detail}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Competitor Cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {competitors.map((c) => (
          <div
            key={c.id}
            className={`card p-4 transition-all hover:shadow-md ${
              active?.id === c.id ? "ring-2 ring-blue-500 bg-blue-50/20" : ""
            }`}
          >
            <div className="flex items-start justify-between">
              <div>
                <button
                  className="text-left font-bold text-slate-900 hover:text-blue-600 hover:underline"
                  onClick={() => openCompetitor(c)}
                >
                  {c.name}
                </button>
                {c.websiteUrl ? (
                  <p className="text-xs text-slate-400 truncate max-w-[220px]">
                    <a href={c.websiteUrl} target="_blank" rel="noreferrer" className="hover:underline">
                      {c.websiteUrl.replace(/^https?:\/\//, "")}
                    </a>
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setEditCompetitor(c)}
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 text-xs"
                  title="এডিট"
                >
                  ✏️
                </button>
                <button
                  onClick={() => deleteCompetitor(c.id, c.name)}
                  className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 text-xs"
                  title="ডিলিট"
                >
                  🗑️
                </button>
              </div>
            </div>

            <div className="mt-2 flex items-center gap-2 text-xs">
              <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                বিজ্ঞাপন: {c.stats.ads} (সক্রিয় {c.stats.activeAds})
              </span>
              <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                দাম রেকর্ড: {c.stats.priceObservations}
              </span>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">
              <button
                className="rounded-lg bg-gradient-to-r from-blue-700 to-indigo-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 hover:from-blue-800 hover:to-indigo-800 shadow-sm"
                disabled={busy !== ""}
                onClick={() => syncMultiPlatform(c)}
              >
                {busy === `multi-${c.id}` ? "Spying all platforms..." : "⚡ All-Platform Spy (FB+Google+TikTok+Bing)"}
              </button>
              <button
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50 hover:bg-slate-50"
                disabled={busy !== "" || !c.websiteUrl}
                onClick={() => scanWebsite(c)}
              >
                {busy === `scan-${c.id}` ? "Scanning..." : "🌐 ওয়েবসাইট ও স্টক স্ক্যান"}
              </button>
              <button
                className="rounded-lg border border-indigo-200 bg-indigo-50/50 px-3 py-1.5 text-xs font-semibold text-indigo-800 disabled:opacity-50 hover:bg-indigo-100"
                disabled={busy !== ""}
                onClick={() => scheduleAutoSyncHandler(c)}
                title="প্রতি রাতে স্বয়ংক্রিয় ব্যাকগ্রাউন্ড সিঙ্ক চালু/বন্ধ করুন"
              >
                {busy === `auto-${c.id}` ? "Updating..." : "⏰ 24/7 অটো-সিঙ্ক"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {competitors.length === 0 ? (
        <EmptyState
          title="কোনো Competitor যোগ করা হয়নি"
          description="নিচের ফর্মে প্রতিদ্বন্দীর নাম, Facebook Page ID এবং ওয়েবসাইট দিয়ে শুরু করুন।"
        />
      ) : null}

      {/* Edit Modal */}
      {editCompetitor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={updateCompetitorHandler} className="card w-full max-w-md p-6 bg-white space-y-4">
            <h3 className="font-bold text-lg">প্রতিযোগীর তথ্য সম্পাদনা করুন</h3>
            <div>
              <label className="text-xs font-semibold text-slate-600">নাম</label>
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
              <label className="text-xs font-semibold text-slate-600">ওয়েবসাইট URL</label>
              <input
                className={inputCls}
                value={editCompetitor.websiteUrl || ""}
                onChange={(e) => setEditCompetitor({ ...editCompetitor, websiteUrl: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="rounded-lg border px-4 py-2 text-sm font-semibold"
                onClick={() => setEditCompetitor(null)}
              >
                বাতিল
              </button>
              <button type="submit" className="btn-primary">
                সংরক্ষণ করুন
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {/* Add New Competitor Form */}
      <form onSubmit={create} className="card p-5 space-y-3 bg-white">
        <div className="font-semibold text-slate-900">+ নতুন প্রতিযোগী যোগ করুন</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-xs font-medium text-slate-700">
            নাম *
            <input
              className={inputCls}
              placeholder="যেমন: Daraz / XYZ Shop"
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
              placeholder="যেমন: 104238592984"
            />
          </label>
          <label className="block text-xs font-medium text-slate-700">
            ওয়েবসাইট
            <input
              className={inputCls}
              value={form.websiteUrl}
              onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })}
              placeholder="https://example.com"
            />
          </label>
        </div>
        <button className="btn-primary text-xs py-2 px-4">প্রতিযোগী যুক্ত করুন</button>
      </form>

      {/* TAB 1 & 2: SPY & SWIPE FILE VIEW */}
      {(activeTab === "spy" || activeTab === "swipefile") && active ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Ad Library Stream */}
          <div className="card p-5 bg-white">
            <div className="flex flex-col gap-2 border-b pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-900">
                    {activeTab === "swipefile"
                      ? `💾 My Saved Swipe File (${filteredAds.length})`
                      : `${active.name} এর বিজ্ঞাপনসমূহ (${ads.length})`}
                  </h3>
                  <p className="text-xs text-slate-400">Facebook • Google • TikTok • Bing</p>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setAdFilter("all")}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                      adFilter === "all" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    সব
                  </button>
                  <button
                    onClick={() => setAdFilter("active")}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                      adFilter === "active" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    সক্রিয়
                  </button>
                  <button
                    onClick={() => setAdFilter("winning")}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                      adFilter === "winning" ? "bg-amber-500 text-white" : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    🔥 Winning
                  </button>
                </div>
              </div>

              {/* Platform Selector Tabs */}
              <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-100">
                <span className="text-[11px] font-semibold text-slate-400 self-center mr-1">ফিল্টার:</span>
                <button
                  onClick={() => setPlatformFilter("all")}
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    platformFilter === "all" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  সব প্ল্যাটফর্ম
                </button>
                <button
                  onClick={() => setPlatformFilter("facebook")}
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    platformFilter === "facebook" ? "bg-indigo-600 text-white" : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                  }`}
                >
                  📘 Meta
                </button>
                <button
                  onClick={() => setPlatformFilter("google")}
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    platformFilter === "google" ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                  }`}
                >
                  🔍 Google
                </button>
                <button
                  onClick={() => setPlatformFilter("tiktok")}
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    platformFilter === "tiktok" ? "bg-pink-600 text-white" : "bg-pink-50 text-pink-700 hover:bg-pink-100"
                  }`}
                >
                  🎵 TikTok
                </button>
                <button
                  onClick={() => setPlatformFilter("bing")}
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
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
                  className={`rounded-lg border p-3 text-sm transition-all ${
                    a.isWinning
                      ? "border-amber-300 bg-amber-50/30"
                      : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-slate-500">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {getPlatformBadge(a.platforms)}
                      {a.isWinning ? (
                        <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
                          🔥 WINNING ({a.daysRunning || 14}+ দিন)
                        </span>
                      ) : a.isFresh ? (
                        <span className="rounded-full bg-blue-500 px-2 py-0.5 text-[10px] font-bold text-white">
                          ⚡ নতুন ({a.daysRunning || 1} দিন)
                        </span>
                      ) : (
                        <span className="font-semibold text-slate-700">
                          {a.daysRunning ? `${a.daysRunning} দিন` : ""}
                        </span>
                      )}
                      <span>· {a.isActive ? "সক্রিয়" : "বন্ধ"}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleSwipeSave(a.id)}
                        className={`rounded px-2 py-0.5 text-xs font-medium border transition-colors ${
                          savedSwipeIds.includes(a.id)
                            ? "bg-amber-100 border-amber-300 text-amber-900"
                            : "bg-white text-slate-600 hover:bg-slate-100"
                        }`}
                        title="সোয়াইপ ফাইলে সেভ করুন"
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
                          লাইভ ↗
                        </a>
                      ) : null}
                    </div>
                  </div>

                  <p className="mt-2 whitespace-pre-wrap text-slate-800 text-xs leading-relaxed font-sans line-clamp-6">
                    {a.creativeText ?? "(বিজ্ঞাপনের কোনো টেক্সট পাওয়া যায়নি)"}
                  </p>

                  <div className="mt-3 flex items-center justify-between border-t border-slate-200/60 pt-2">
                    {a.linkUrl ? (
                      <a
                        className="text-xs text-blue-600 hover:underline truncate max-w-[200px]"
                        href={a.linkUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {a.linkUrl}
                      </a>
                    ) : <span />}

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => {
                          setVideoModalAd(a);
                          setVideoScriptResult(null);
                        }}
                        className="rounded border border-pink-200 bg-pink-50/70 px-2 py-1 text-xs font-semibold text-pink-700 hover:bg-pink-100 flex items-center gap-1 transition-colors"
                        title="রিলস ও টিকটক ভিডিও স্ক্রিপ্ট ফ্রেম-বাই-ফ্রেম বিশ্লেষণ"
                      >
                        🎬 স্ক্রিপ্ট ডিকনস্ট্রাক্ট
                      </button>
                      <button
                        onClick={() => {
                          setCounterModalAd(a);
                          setCounterAdResult(null);
                        }}
                        className="rounded bg-gradient-to-r from-indigo-600 to-blue-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:from-indigo-700 hover:to-blue-700"
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
                    ? "আপনার সোয়াইপ ফাইলে কোনো বিজ্ঞাপন সেভ করা নেই। বিজ্ঞাপনের পাশে '☆ Save' বাটনে চাপ দিন।"
                    : "কোনো বিজ্ঞাপন পাওয়া যায়নি। ফিল্টার পরিবর্তন করুন বা All-Platform Spy বাটনে ক্লিক করুন।"}
                </p>
              ) : null}
            </div>
          </div>

          {/* Price & Stock Observations */}
          <div className="space-y-4">
            <div className="card p-5 bg-white">
              <div className="flex items-center justify-between border-b pb-2">
                <div className="font-bold text-slate-900">দামের রেকর্ড ও স্টক ট্র্যাকিং</div>
                <span className="text-xs text-slate-400">মোট: {observations.length}</span>
              </div>
              <div className="mt-2 max-h-56 space-y-2 overflow-y-auto pr-1">
                {observations.map((o) => (
                  <div
                    key={o.id}
                    className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs border"
                  >
                    <div>
                      <span className="font-medium text-slate-900">{o.productName}</span>
                      <span className="ml-2 text-slate-400">
                        ({o.sourceType}, {new Date(o.observedAt).toLocaleDateString()})
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-slate-900">
                        {formatMinor(BigInt(o.priceMinor), o.currency)}
                      </span>
                      <a
                        className="ml-2 text-blue-600 hover:underline"
                        href={o.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        প্রমাণ ↗
                      </a>
                    </div>
                  </div>
                ))}
                {observations.length === 0 ? (
                  <p className="text-xs text-slate-400 py-3 text-center">
                    কোনো রেকর্ড নেই। ওয়েবসাইট স্ক্যান করুন বা নিচে ম্যানুয়ালি যোগ করুন।
                  </p>
                ) : null}
              </div>

              {/* Add Observation Form */}
              <form onSubmit={addObservation} className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 border-t pt-3">
                <input
                  className="rounded-lg border px-2.5 py-1.5 text-xs w-full"
                  placeholder="প্রোডাক্টের নাম"
                  value={obsForm.productName}
                  onChange={(e) => setObsForm({ ...obsForm, productName: e.target.value })}
                  required
                />
                <input
                  className="rounded-lg border px-2.5 py-1.5 text-xs w-full"
                  placeholder="দাম (যেমন: 1250)"
                  value={obsForm.price}
                  onChange={(e) => setObsForm({ ...obsForm, price: e.target.value })}
                  required
                />
                <input
                  className="rounded-lg border px-2.5 py-1.5 text-xs w-full"
                  placeholder="প্রমাণ URL"
                  value={obsForm.sourceUrl}
                  onChange={(e) => setObsForm({ ...obsForm, sourceUrl: e.target.value })}
                  required
                />
                <button className="sm:col-span-3 rounded-lg bg-slate-800 py-1.5 text-xs font-semibold text-white hover:bg-slate-700">
                  + দামের প্রমাণ সংরক্ষণ করুন
                </button>
              </form>
            </div>

            {/* Quick Intelligence Summary */}
            <div className="card p-4 bg-gradient-to-r from-slate-900 to-indigo-950 text-white">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Omnichannel Advantage
              </h4>
              <p className="mt-1 text-xs text-slate-200">
                {active.name} এর জন্য Facebook, Google, TikTok ও Bing থেকে সর্বমোট {ads.length}টি বিজ্ঞাপন সংরক্ষিত। প্রতিদ্বন্দীর সেরা ক্রিয়েটিভগুলোকে <b>Swipe File</b>-এ সেভ রাখুন যাতে যেকোনো সময় রেফারেন্স নেওয়া যায়।
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* TAB 3: PRICE COMPARISON TABLE */}
      {activeTab === "pricing" ? (
        <div className="card p-5 bg-white">
          <div className="font-bold text-slate-900">আপনার প্রোডাক্টের দাম বনাম প্রতিযোগী (Direct Matrix)</div>
          <p className="text-xs text-slate-400">
            রিয়েল-টাইম তথ্য: যেখানে প্রমাণের সরাসরি লাইভ লিংক ও তারিখ সংরক্ষিত থাকে।
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs">
                <tr>
                  <th className="px-3 py-2.5">আপনার প্রোডাক্ট</th>
                  <th className="px-3 py-2.5">আপনার দাম</th>
                  <th className="px-3 py-2.5">প্রতিযোগীর দাম</th>
                  <th className="px-3 py-2.5">পার্থক্য</th>
                  <th className="px-3 py-2.5">প্রমাণ (Source)</th>
                </tr>
              </thead>
              <tbody className="divide-y text-xs">
                {comparison.map((row) =>
                  row.competitorPrices.length ? (
                    row.competitorPrices.map((cp, i) => (
                      <tr key={`${row.productId}-${i}`} className="hover:bg-slate-50">
                        <td className="px-3 py-2.5 font-medium text-slate-900">
                          {i === 0 ? row.productName : ""}
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-slate-700">
                          {i === 0 ? formatMinor(BigInt(row.ownPriceMinor), row.currency) : ""}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="font-semibold text-slate-900">{cp.competitorName}:</span>{" "}
                          {formatMinor(BigInt(cp.priceMinor), cp.currency)}
                        </td>
                        <td
                          className={`px-3 py-2.5 font-bold ${
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
                            ? `প্রতিযোগী ${Math.abs(cp.diffPercent)}% কম`
                            : `আপনি ${cp.diffPercent}% কমে দিচ্ছেন`}
                        </td>
                        <td className="px-3 py-2.5">
                          <a
                            className="text-blue-600 hover:underline"
                            href={cp.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            লাইভ সোর্স ↗
                          </a>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr key={row.productId} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5 font-medium text-slate-900">{row.productName}</td>
                      <td className="px-3 py-2.5 font-semibold text-slate-700">
                        {formatMinor(BigInt(row.ownPriceMinor), row.currency)}
                      </td>
                      <td className="px-3 py-2.5 text-slate-400" colSpan={3}>
                        কোনো প্রতিযোগীর দামের রেকর্ড পাওয়া যায়নি
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* TAB 4: STRATEGY & OFFER PLAYBOOK */}
      {activeTab === "playbook" ? (
        <div className="card p-5 bg-white space-y-4">
          <div className="flex items-center justify-between border-b pb-3">
            <div>
              <h3 className="font-bold text-slate-900">Competitor Strategy & Tactics Playbook</h3>
              <p className="text-xs text-slate-500">
                প্রতিযোগীদের অফার, ডিসকাউন্ট কৌশল ও উইনিং প্যাটার্ন অ্যানালাইসিস
              </p>
            </div>
            <button
              className="btn-primary text-xs py-1.5 px-3 disabled:opacity-50"
              disabled={busy !== ""}
              onClick={generateInsights}
            >
              {busy === "insights" ? "অ্যানালাইসিস হচ্ছে..." : "✨ AI প্লেবুক জেনারেট করুন"}
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg bg-blue-50/50 p-4 border border-blue-100">
              <span className="text-xs font-bold text-blue-900 uppercase">১. অফার প্যাটার্ন</span>
              <p className="mt-2 text-xs text-slate-700 leading-relaxed">
                প্রতিযোগীরা সাধারণত ক্যাশ অন ডেলিভারি (COD) এবং ফ্রি ডেলিভারির অফার বেশি ব্যবহার করছে। তাদের সবচেয়ে বেশি সক্রিয় বিজ্ঞাপনগুলোতে জরুরি অফারের ওপর জোর দেওয়া হয়েছে।
              </p>
            </div>
            <div className="rounded-lg bg-emerald-50/50 p-4 border border-emerald-100">
              <span className="text-xs font-bold text-emerald-900 uppercase">২. উইনিং হুক স্ট্র্যাটেজি</span>
              <p className="mt-2 text-xs text-slate-700 leading-relaxed">
                টিকটক ও ফেসবুকে তারা সমস্যার সমাধানমূলক (Problem-Agitation) ভিডিও কন্টেন্ট দিয়ে সর্বোচ্চ ভিউ ও এনগেজমেন্ট আদায় করছে।
              </p>
            </div>
            <div className="rounded-lg bg-purple-50/50 p-4 border border-purple-100">
              <span className="text-xs font-bold text-purple-900 uppercase">৩. প্রাইসিং ট্যাকটিক্স</span>
              <p className="mt-2 text-xs text-slate-700 leading-relaxed">
                তারা বান্ডেল প্রাইসিং ও কম্বো সেলে বেশি জোর দিচ্ছে যাতে গড় অর্ডার ভ্যালু (AOV) বাড়ানো যায়।
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* TAB 5: SEO & TRAFFIC SPY */}
      {activeTab === "seo" ? (
        <div className="space-y-6">
          {!active ? (
            <div className="card p-8 bg-white text-center space-y-4">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-2xl text-indigo-600">
                🔍
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">প্রতিযোগী নির্বাচন করুন</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
                  যে কোনো প্রতিযোগীর গুগল সার্চ ট্রাফিক, র‍্যাঙ্কিং কিওয়ার্ড, ডোমেন অথরিটি এবং পেজ মেটা টাইটেল অডিট করতে নিচে ক্লিক করুন।
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
                    className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-400"
                  >
                    🏢 {c.name}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Header card */}
              <div className="card p-5 bg-white flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-slate-900">{active.name} — SEO & Organic Traffic Intelligence</h3>
                    <span className="rounded bg-indigo-100 text-indigo-700 text-xs px-2 py-0.5 font-bold">
                      Ahrefs / SEMrush Alternative
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    অর্গানিক সার্চ প্রেজেন্স, কিওয়ার্ড ভলিউম এবং গুগলে তাদের শীর্ষ পেজসমূহের বিশ্লেষণ
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    disabled={loadingSeo}
                    onClick={() => fetchSeoReport(active)}
                  >
                    {loadingSeo ? "অ্যানালাইজ হচ্ছে..." : "🔄 রি-স্ক্যান SEO"}
                  </button>
                </div>
              </div>

              {loadingSeo ? (
                <div className="card p-12 bg-white text-center text-sm text-slate-500">
                  <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-indigo-600 border-r-transparent mb-3" />
                  <p>সার্চ ইঞ্জিন ডেটা ও কিওয়ার্ড র্যাংকিং ফেচ করা হচ্ছে...</p>
                </div>
              ) : seoReport ? (
                <div className="space-y-6">
                  {/* Metric Overview Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="card p-4 bg-gradient-to-br from-indigo-50/50 to-white border border-indigo-100">
                      <span className="text-[11px] font-bold text-indigo-900 uppercase tracking-wider">
                        মাসিক অর্গানিক ট্রাফিক
                      </span>
                      <p className="mt-2 text-2xl font-black text-indigo-700">
                        {seoReport.estimatedMonthlyOrganicVisits.toLocaleString()}
                      </p>
                      <span className="text-[10px] text-slate-500">গুগল অর্গানিক ক্লিক (CTR Weighted)</span>
                    </div>

                    <div className="card p-4 bg-gradient-to-br from-emerald-50/50 to-white border border-emerald-100">
                      <span className="text-[11px] font-bold text-emerald-900 uppercase tracking-wider">
                        Domain Authority (DA)
                      </span>
                      <div className="mt-2 flex items-baseline gap-2">
                        <span className="text-2xl font-black text-emerald-700">{seoReport.domainAuthorityScore}</span>
                        <span className="text-xs text-slate-400 font-semibold">/ 100</span>
                      </div>
                      <span className="text-[10px] text-slate-500">সার্চ ইঞ্জিন র‍্যাঙ্কিং সক্ষমতা</span>
                    </div>

                    <div className="card p-4 bg-gradient-to-br from-blue-50/50 to-white border border-blue-100">
                      <span className="text-[11px] font-bold text-blue-900 uppercase tracking-wider">
                        টোটাল ইনডেক্সড কিওয়ার্ড
                      </span>
                      <p className="mt-2 text-2xl font-black text-blue-700">
                        ~{seoReport.totalIndexedKeywords}
                      </p>
                      <span className="text-[10px] text-slate-500">সার্চে ইন্ডেক্স হওয়া ভ্যারিয়েশনস</span>
                    </div>

                    <div className="card p-4 bg-gradient-to-br from-purple-50/50 to-white border border-purple-100">
                      <span className="text-[11px] font-bold text-purple-900 uppercase tracking-wider">
                        অর্গানিক ট্রাফিকের মূল্য (PPC)
                      </span>
                      <p className="mt-2 text-2xl font-black text-purple-700">
                        ৳{Math.round(seoReport.estimatedMonthlyOrganicVisits * 8.5).toLocaleString()}
                      </p>
                      <span className="text-[10px] text-slate-500">Google Ads দিলে যা খরচ হতো</span>
                    </div>
                  </div>

                  {/* Intent Distribution & Focus Themes */}
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="card p-4 bg-white space-y-3">
                      <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                        🎯 সার্চ ইনটেন্ট বন্টন (Search Intent)
                      </span>
                      <div className="space-y-2">
                        <div>
                          <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                            <span>Transactional (সরাসরি কেনাকাটা)</span>
                            <span className="text-emerald-700">{seoReport.intentDistribution.transactional}%</span>
                          </div>
                          <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${seoReport.intentDistribution.transactional}%` }} />
                          </div>
                        </div>
                        <div>
                          <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                            <span>Commercial (প্রোডাক্ট তুলনা ও যাচাই)</span>
                            <span className="text-blue-700">{seoReport.intentDistribution.commercial}%</span>
                          </div>
                          <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-500 rounded-full" style={{ width: `${seoReport.intentDistribution.commercial}%` }} />
                          </div>
                        </div>
                        <div>
                          <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                            <span>Informational (তথ্যমূলক অনুসন্ধান)</span>
                            <span className="text-amber-700">{seoReport.intentDistribution.informational}%</span>
                          </div>
                          <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-amber-500 rounded-full" style={{ width: `${seoReport.intentDistribution.informational}%` }} />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="card p-4 bg-white space-y-3">
                      <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                        🏷️ শীর্ষ কিওয়ার্ড থিম (Top SEO Pillars)
                      </span>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {seoReport.focusKeywordThemes.map((theme, i) => (
                          <span key={i} className="rounded-lg bg-slate-100 text-slate-800 text-xs px-2.5 py-1 font-semibold border">
                            #{theme}
                          </span>
                        ))}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-2">
                        প্রতিযোগী এই থিমগুলোতে গুগল সার্চ ট্রাফিকের সিংহভাগ নিয়ন্ত্রণ করছে।
                      </p>
                    </div>
                  </div>

                  {/* Top Organic Ranking Keywords Table */}
                  <div className="card p-5 bg-white space-y-4">
                    <div className="flex items-center justify-between border-b pb-3">
                      <div>
                        <h4 className="font-bold text-slate-900 text-sm">
                          গুগল টপ র‍্যাঙ্কিং কিওয়ার্ড (Top Ranking Keywords)
                        </h4>
                        <p className="text-xs text-slate-500">
                          যেসব কিওয়ার্ডে প্রতিযোগী গুগলের শীর্ষ ফলাফলে অবস্থান করছে
                        </p>
                      </div>
                      <span className="text-xs text-slate-400 font-medium">{seoReport.topKeywords.length} টি শীর্ষ কিওয়ার্ড</span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-600 font-semibold border-b">
                          <tr>
                            <th className="py-2.5 px-3">কিওয়ার্ড (Keyword)</th>
                            <th className="py-2.5 px-3">র‍্যাঙ্ক (Position)</th>
                            <th className="py-2.5 px-3">মাসিক সার্চ ভলিউম</th>
                            <th className="py-2.5 px-3">KD (Difficulty)</th>
                            <th className="py-2.5 px-3">ইনটেন্ট</th>
                            <th className="py-2.5 px-3">আনুমানিক ক্লিক</th>
                            <th className="py-2.5 px-3 text-right">অ্যাকশন</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y text-slate-700">
                          {seoReport.topKeywords.map((kw, i) => (
                            <tr key={i} className="hover:bg-slate-50/80">
                              <td className="py-2.5 px-3 font-semibold text-slate-900">
                                {kw.keyword}
                              </td>
                              <td className="py-2.5 px-3">
                                <span className="inline-flex items-center justify-center rounded-md bg-blue-100 text-blue-800 px-2 py-0.5 font-bold text-[11px]">
                                  #{kw.estimatedPosition}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 font-semibold">
                                {kw.searchVolume.toLocaleString()} /mo
                              </td>
                              <td className="py-2.5 px-3">
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                  kw.keywordDifficulty < 20 ? "bg-green-100 text-green-800" :
                                  kw.keywordDifficulty < 40 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"
                                }`}>
                                  {kw.keywordDifficulty}% KD
                                </span>
                              </td>
                              <td className="py-2.5 px-3">
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                  kw.intent === "Transactional" ? "bg-emerald-100 text-emerald-800" :
                                  kw.intent === "Commercial" ? "bg-blue-100 text-blue-800" : "bg-purple-100 text-purple-800"
                                }`}>
                                  {kw.intent}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 font-bold text-slate-900">
                                ~{kw.estimatedMonthlyClicks.toLocaleString()}
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(kw.keyword);
                                    setCopiedText(kw.keyword);
                                    setTimeout(() => setCopiedText(""), 2000);
                                  }}
                                  className="rounded border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
                                >
                                  {copiedText === kw.keyword ? "কপি হয়েছে!" : "📋 কপি"}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Top Organic Landing Pages */}
                  <div className="card p-5 bg-white space-y-4">
                    <div className="border-b pb-3">
                      <h4 className="font-bold text-slate-900 text-sm">
                        প্রতিযোগীর শীর্ষ ট্রাফিক ড্রাইভকারী পেজ (Top Organic Pages)
                      </h4>
                      <p className="text-xs text-slate-500">
                        কোন কোন ল্যান্ডিং পেজ ও মেটা টাইটেল দিয়ে তারা গুগল থেকে ক্রেতা পাচ্ছে
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      {seoReport.topPages.map((page, idx) => (
                        <div key={idx} className="rounded-xl border p-3.5 bg-slate-50/50 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-bold text-slate-900 text-xs line-clamp-1">{page.title}</span>
                            <span className="rounded bg-indigo-100 text-indigo-800 text-[10px] font-bold px-1.5 py-0.5 shrink-0">
                              {page.estimatedTrafficShare}% Traffic
                            </span>
                          </div>
                          <p className="text-[11px] text-blue-600 truncate font-mono">{page.url}</p>
                          <div className="flex flex-wrap gap-1 pt-1">
                            {page.primaryKeywords.map((pk, kx) => (
                              <span key={kx} className="rounded bg-white border border-slate-200 text-slate-600 text-[10px] px-1.5 py-0.5">
                                {pk}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ⚡ AI SEO Gap & Keyword Hijack Strategy Engine */}
                  <div className="card p-6 bg-gradient-to-br from-indigo-900 via-slate-900 to-slate-900 text-white space-y-5 rounded-2xl shadow-xl">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-700/60 pb-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-500 text-sm">⚡</span>
                          <h4 className="font-bold text-base text-white">
                            AI SEO Gap & Keyword Hijack Engine
                          </h4>
                        </div>
                        <p className="text-xs text-slate-300 mt-1">
                          প্রতিযোগীর শীর্ষ র‍্যাঙ্কিং কিওয়ার্ডগুলো হাইজ্যাক করে আপনার প্রোডাক্টের মেটা টাইটেল ও ডিসক্রিপশন তৈরি করুন
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <select
                          className="rounded-lg bg-slate-800 border border-slate-700 text-xs text-white px-3 py-2 outline-none"
                          value={selectedProductIdForSeo}
                          onChange={(e) => setSelectedProductIdForSeo(e.target.value)}
                        >
                          <option value="">জেনারেল স্টোর / সকল প্রোডাক্ট</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>{p.title}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => generateSeoGapHandler(active)}
                          disabled={generatingSeoGap}
                          className="rounded-lg bg-indigo-500 hover:bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-md transition-all disabled:opacity-50 shrink-0"
                        >
                          {generatingSeoGap ? "স্ট্র্যাটেজি তৈরি হচ্ছে..." : "🚀 মেটা টাইটেল ও কিওয়ার্ড হাইজ্যাক করুন"}
                        </button>
                      </div>
                    </div>

                    {seoStrategy ? (
                      <div className="space-y-4 pt-2">
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div className="rounded-xl bg-slate-800/80 p-4 border border-slate-700 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider">
                                🏷️ প্রস্তাবিত Google Meta Title (SERP Hook)
                              </span>
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(seoStrategy.strategy.recommendedMetaTitle);
                                  setCopiedText("metaTitle");
                                  setTimeout(() => setCopiedText(""), 2000);
                                }}
                                className="text-[10px] bg-slate-700 hover:bg-slate-600 px-2 py-0.5 rounded text-white font-semibold"
                              >
                                {copiedText === "metaTitle" ? "কপি হয়েছে!" : "📋 কপি"}
                              </button>
                            </div>
                            <p className="font-bold text-sm text-emerald-400">
                              {seoStrategy.strategy.recommendedMetaTitle}
                            </p>
                            <span className="text-[10px] text-slate-400">দৈর্ঘ্য: {seoStrategy.strategy.recommendedMetaTitle.length} অক্ষর (গুগল অপটিমাল &lt; 60)</span>
                          </div>

                          <div className="rounded-xl bg-slate-800/80 p-4 border border-slate-700 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider">
                                📝 High-CTR Meta Description
                              </span>
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(seoStrategy.strategy.recommendedMetaDescription);
                                  setCopiedText("metaDesc");
                                  setTimeout(() => setCopiedText(""), 2000);
                                }}
                                className="text-[10px] bg-slate-700 hover:bg-slate-600 px-2 py-0.5 rounded text-white font-semibold"
                              >
                                {copiedText === "metaDesc" ? "কপি হয়েছে!" : "📋 কপি"}
                              </button>
                            </div>
                            <p className="text-xs text-slate-200 leading-relaxed">
                              {seoStrategy.strategy.recommendedMetaDescription}
                            </p>
                            <span className="text-[10px] text-slate-400">দৈর্ঘ্য: {seoStrategy.strategy.recommendedMetaDescription.length} অক্ষর (গুগল অপটিমাল &lt; 155)</span>
                          </div>
                        </div>

                        <div className="rounded-xl bg-slate-800/50 p-4 border border-slate-700 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider">
                              🎯 প্রোডাক্ট পেজে ট্যাগ করার জন্য ৫টি হাই-কনভার্টিং কিওয়ার্ড
                            </span>
                            <span className="rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold px-2 py-0.5">
                              {seoStrategy.strategy.estimatedCtrBoost}
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
                                className="rounded-lg bg-indigo-950/70 border border-indigo-700/50 px-2.5 py-1 text-xs font-semibold text-indigo-200 hover:bg-indigo-900"
                              >
                                {kw} {copiedText === kw ? "✓" : "+"}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-lg bg-indigo-950/40 p-3 border border-indigo-800/50 text-xs text-indigo-200 flex items-center gap-2">
                          <span>💡</span>
                          <span><strong>কেন এটি প্রতিদ্বন্দীকে টেক্কা দেবে:</strong> {seoStrategy.strategy.outrankTactics}</span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="card p-8 bg-white text-center text-xs text-slate-500">
                  <p>সার্চ ইঞ্জিন ডেটা লোড করতে উপরের &ldquo;🔄 রি-স্ক্যান SEO&rdquo; বাটনে ক্লিক করুন।</p>
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}

      {/* TAB 6: BAD REVIEW & COMPLAINT MINE */}
      {activeTab === "complaints" ? (
        <div className="space-y-6">
          {!active ? (
            <div className="card p-8 bg-white text-center space-y-4">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-2xl text-rose-600">
                💬
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">প্রতিযোগী নির্বাচন করুন</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
                  প্রতিযোগীর কাস্টমারদের নেগেটিভ রিভিউ, ডেলিভারি অসন্তোষ এবং দুর্বলতা মাইনিং করে কাউন্টার-অ্যাড তৈরি করতে সিলেক্ট করুন।
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                {competitors.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      openCompetitor(c);
                      fetchReviewMine(c);
                    }}
                    className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-400"
                  >
                    🏢 {c.name}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Header card */}
              <div className="card p-5 bg-white flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-slate-900">
                      {active.name} — Customer Sentiment & Complaint Mining
                    </h3>
                    <span className="rounded bg-rose-100 text-rose-700 text-xs px-2 py-0.5 font-bold">
                      দুর্বলতা কাজে লাগানো
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    ক্রেতাদের অসন্তোষ, দেরিতে ডেলিভারি, এবং খারাপ ফিডব্যাক বিশ্লেষণ করে ক্রেতাকে আপনার স্টোরে টানার কৌশল
                  </p>
                </div>
                <button
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  disabled={loadingReviewMine}
                  onClick={() => fetchReviewMine(active)}
                >
                  {loadingReviewMine ? "মাইনিং হচ্ছে..." : "🔄 রি-স্ক্যান রিভিউ"}
                </button>
              </div>

              {loadingReviewMine ? (
                <div className="card p-12 bg-white text-center text-sm text-slate-500">
                  <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-rose-600 border-r-transparent mb-3" />
                  <p>কাস্টমারদের রিভিউ ও সোশ্যাল ফিডব্যাক বিশ্লেষণ করা হচ্ছে...</p>
                </div>
              ) : reviewMineReport ? (
                <div className="space-y-6">
                  {/* Satisfaction & Sentiment Overview */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="card p-4 bg-gradient-to-br from-rose-50/60 to-white border border-rose-100">
                      <span className="text-[11px] font-bold text-rose-900 uppercase tracking-wider">
                        কাস্টমার স্যাটিসফ্যাকশন স্কোর
                      </span>
                      <div className="mt-2 flex items-baseline gap-2">
                        <span className="text-3xl font-black text-rose-700">{reviewMineReport.overallRatingScore}</span>
                        <span className="text-xs text-slate-400 font-semibold">/ ৫.০</span>
                      </div>
                      <span className="text-[10px] text-slate-500 mt-1 block">
                        মোট বিশ্লেষিত ফিডব্যাক: {reviewMineReport.totalAnalyzedFeedback} টি
                      </span>
                    </div>

                    <div className="card p-4 bg-white md:col-span-2 space-y-2">
                      <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                        📊 সেন্টিমেন্ট বন্টন (Sentiment Breakdown)
                      </span>
                      <div className="space-y-2 pt-1">
                        <div>
                          <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                            <span>অসন্তুষ্ট ক্রেতা (Dissatisfied)</span>
                            <span className="text-rose-600 font-bold">{reviewMineReport.sentimentDistribution.dissatisfied}%</span>
                          </div>
                          <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-rose-500 rounded-full" style={{ width: `${reviewMineReport.sentimentDistribution.dissatisfied}%` }} />
                          </div>
                        </div>
                        <div className="flex justify-between text-xs text-slate-500 pt-1">
                          <span>সন্তুষ্ট: {reviewMineReport.sentimentDistribution.satisfied}%</span>
                          <span>নিরপেক্ষ: {reviewMineReport.sentimentDistribution.neutral}%</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Biggest Vulnerability Alert */}
                  <div className="rounded-xl border border-rose-200 bg-rose-50/80 p-4 flex items-start gap-3">
                    <span className="text-xl">🚨</span>
                    <div>
                      <h4 className="font-bold text-rose-950 text-sm">
                        প্রতিযোগীর সবচেয়ে মারাত্মক দুর্বলতা (Core Vulnerability)
                      </h4>
                      <p className="mt-1 text-xs text-rose-800 leading-relaxed font-medium">
                        {reviewMineReport.biggestVulnerability}
                      </p>
                    </div>
                  </div>

                  {/* Recurring Complaint Categories */}
                  <div className="card p-5 bg-white space-y-4">
                    <div className="border-b pb-3">
                      <h4 className="font-bold text-slate-900 text-sm">
                        শীর্ষ ৪টি গ্রাহক অসন্তোষের বিষয় (Top Customer Friction Points)
                      </h4>
                      <p className="text-xs text-slate-500">
                        যেসব কারণে ক্রেতারা প্রতিদ্বন্দীর ওপর ক্ষুব্ধ
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      {reviewMineReport.topComplaints.map((item, idx) => (
                        <div key={idx} className="rounded-xl border p-4 bg-slate-50/50 space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-slate-900 text-xs">{item.category}</span>
                            <div className="flex items-center gap-1.5">
                              <span className="rounded bg-rose-100 text-rose-800 text-[10px] font-bold px-1.5 py-0.5">
                                {item.frequencyPercent}% অভিযোগ
                              </span>
                              <span className={`rounded text-[10px] font-bold px-1.5 py-0.5 ${
                                item.severity === "Critical" ? "bg-red-500 text-white" : "bg-amber-100 text-amber-800"
                              }`}>
                                {item.severity}
                              </span>
                            </div>
                          </div>
                          <p className="text-xs text-slate-700 leading-relaxed">{item.complaintSummary}</p>
                          <div className="space-y-1 bg-white p-2.5 rounded-lg border border-slate-200/70">
                            <span className="text-[10px] font-bold text-slate-400 uppercase">ক্রেতাদের বাস্তব উক্তি:</span>
                            {item.sampleCustomerQuotes.map((q, qi) => (
                              <p key={qi} className="text-[11px] text-slate-600 italic">
                                {q}
                              </p>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* High-Converting Counter-Positioning Angles */}
                  <div className="card p-6 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white space-y-4 rounded-2xl shadow-xl">
                    <div className="border-b border-slate-700 pb-3">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500 text-sm">🎯</span>
                        <h4 className="font-bold text-base text-white">
                          AI Reassurance Angles ("ক্রেতা ছিনতাই" কপি ও ট্রাস্ট অফার)
                        </h4>
                      </div>
                      <p className="text-xs text-slate-300 mt-1">
                        প্রতিযোগীর এই দুর্বলতাগুলো সমাধান করে বিজ্ঞাপনে কী প্রতিশ্রুতি দিলে ক্রেতারা সরাসরি আপনার থেকে কিনবে
                      </p>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4 pt-1">
                      {reviewMineReport.recommendedCounterAngles.map((angle, i) => (
                        <div key={i} className="rounded-xl bg-slate-800/80 p-4 border border-slate-700 space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-bold text-sm text-emerald-400 leading-snug">
                              &ldquo;{angle.hookHeadline}&rdquo;
                            </span>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(angle.hookHeadline);
                                setCopiedText(`angle-${i}`);
                                setTimeout(() => setCopiedText(""), 2000);
                              }}
                              className="text-[10px] bg-slate-700 hover:bg-slate-600 px-2 py-0.5 rounded text-white font-semibold shrink-0"
                            >
                              {copiedText === `angle-${i}` ? "কপি হয়েছে!" : "📋 কপি"}
                            </button>
                          </div>

                          <div className="space-y-2 text-xs">
                            <div className="rounded bg-slate-900/60 p-2.5 border border-slate-700/60">
                              <span className="font-semibold text-indigo-300 text-[11px] block">🛡️ বিশ্বাস অর্জনের মেকানিজম:</span>
                              <p className="text-slate-200 mt-0.5">{angle.trustMechanism}</p>
                            </div>
                            <div className="rounded bg-slate-900/60 p-2.5 border border-slate-700/60">
                              <span className="font-semibold text-amber-300 text-[11px] block">⚡ গ্যারান্টি অফার:</span>
                              <p className="text-slate-200 mt-0.5">{angle.guaranteeOffer}</p>
                            </div>
                          </div>

                          <div className="text-[11px] text-slate-400 italic pt-1 border-t border-slate-700/60">
                            💡 ক্রেতা কেন সুইচ করবে: {angle.whyBuyersSwitch}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="card p-8 bg-white text-center text-xs text-slate-500">
                  <p>রিভিউ ও ফিডব্যাক লোড করতে উপরের &ldquo;🔄 রি-স্ক্যান রিভিউ&rdquo; বাটনে ক্লিক করুন।</p>
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}



      {/* White-Label Agency Dossier Audit Modal */}
      {isDossierOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
          <div className="card w-full max-w-4xl max-h-[92vh] overflow-y-auto bg-white p-6 sm:p-8 space-y-6">
            <div className="flex items-center justify-between border-b pb-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-slate-900 text-white font-black text-xl px-3 py-1">
                  AGENCY AUDIT
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    {dossierData?.agencyBranding.organizationName || "Client"} Competitor Intelligence Dossier
                  </h3>
                  <p className="text-xs text-slate-500">
                    তারিখ: {dossierData ? new Date(dossierData.generatedAt).toLocaleDateString() : ""} • প্রস্তুতকারক: Marketing Intelligence OS
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-slate-800"
                >
                  🖨️ প্রিন্ট / PDF ডাউনলোড
                </button>
                <button
                  onClick={() => setIsDossierOpen(false)}
                  className="rounded p-1 text-slate-400 hover:text-slate-700 text-sm"
                >
                  ✕
                </button>
              </div>
            </div>

            {loadingDossier ? (
              <p className="text-center py-12 text-sm text-slate-500">
                হোয়াইট-লেবেল অডিট রিপোর্ট প্রস্তুত হচ্ছে...
              </p>
            ) : dossierData ? (
              <div className="space-y-6 text-sm">
                {/* Executive Summary Cards */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl border bg-slate-50 p-4">
                    <span className="text-[11px] font-bold uppercase text-slate-400">ট্র্যাকড প্রতিযোগী</span>
                    <p className="mt-1 text-2xl font-black text-slate-900">{dossierData.summary.totalCompetitorsTracked}</p>
                  </div>
                  <div className="rounded-xl border bg-slate-50 p-4">
                    <span className="text-[11px] font-bold uppercase text-slate-400">সক্রিয় অপরচুনিটি অ্যালার্ট</span>
                    <p className="mt-1 text-2xl font-black text-amber-600">{dossierData.summary.totalAlertsActive}</p>
                  </div>
                  <div className="rounded-xl border bg-slate-50 p-4">
                    <span className="text-[11px] font-bold uppercase text-slate-400">মূল্য পার্থক্যের রেকর্ড</span>
                    <p className="mt-1 text-2xl font-black text-indigo-600">{dossierData.summary.priceGapsDetected}</p>
                  </div>
                </div>

                {/* Competitors Detailed Breakdown */}
                <div className="space-y-4">
                  <h4 className="font-bold text-slate-900 uppercase tracking-wider text-xs border-b pb-2">
                    ১. প্রতিযোগী ব্র্যান্ড বিশ্লেষণ ও উইনিং ক্যাম্পেইন
                  </h4>
                  {dossierData.competitors.map((item, idx) => (
                    <div key={idx} className="rounded-lg border p-4 bg-slate-50/50 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-bold text-slate-900 text-base">{item.competitor.name}</span>
                          <span className="ml-2 text-xs text-slate-400">({item.competitor.websiteUrl || "No website"})</span>
                        </div>
                        <div className="text-xs font-semibold text-slate-600">
                          মোট বিজ্ঞাপন: {item.totalAds} • সক্রিয়: {item.activeAds} • 🔥 Winning: {item.winningAdsCount}
                        </div>
                      </div>

                      {item.winningAds.length > 0 ? (
                        <div>
                          <span className="text-xs font-bold text-amber-800">সেরা লাভজনক বিজ্ঞাপন (Winning Ads):</span>
                          <div className="mt-2 space-y-1.5">
                            {item.winningAds.map((w) => (
                              <div key={w.id} className="rounded bg-white p-2.5 text-xs border border-amber-200">
                                <span className="font-semibold text-slate-700">{w.daysRunning} দিন ধরে চলছে:</span>
                                <p className="mt-1 text-slate-800 whitespace-pre-wrap line-clamp-3">{w.creativeText}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>

                {/* Price Gap Matrix */}
                <div className="space-y-3">
                  <h4 className="font-bold text-slate-900 uppercase tracking-wider text-xs border-b pb-2">
                    ২. বাজার মূল্যের তুলনামূলক ম্যাট্রিক্স
                  </h4>
                  <table className="w-full text-left text-xs border divide-y">
                    <thead className="bg-slate-100">
                      <tr>
                        <th className="p-2">আপনার প্রোডাক্ট</th>
                        <th className="p-2">আপনার দাম</th>
                        <th className="p-2">প্রতিযোগীর দাম</th>
                        <th className="p-2">মূল্যের পার্থক্য</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {dossierData.priceComparisonMatrix.slice(0, 8).map((p, i) => (
                        <tr key={i}>
                          <td className="p-2 font-medium">{p.productName}</td>
                          <td className="p-2">{formatMinor(BigInt(p.ownPriceMinor), p.currency)}</td>
                          <td className="p-2">
                            {p.competitorPrices[0] ? `${p.competitorPrices[0].competitorName}: ${formatMinor(BigInt(p.competitorPrices[0].priceMinor), p.competitorPrices[0].currency)}` : "—"}
                          </td>
                          <td className="p-2 font-bold">
                            {p.competitorPrices[0]?.diffPercent !== undefined && p.competitorPrices[0]?.diffPercent !== null
                              ? `${p.competitorPrices[0].diffPercent}%`
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Footer disclaimer */}
                <div className="border-t pt-3 text-[11px] text-slate-400 text-center">
                  গোপনীয়তা চুক্তি: এই রিপোর্টটি ক্লায়েন্টের অভ্যন্তরীণ মার্কেটিং স্ট্র্যাটেজির জন্য সংরক্ষিত। কোনো বাণিজ্যিক বিজ্ঞাপনের অনুমান বা বিক্রয় ডেটা অন্তর্ভুক্ত নয়।
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Counter-Ad Generator Modal */}
      {counterModalAd ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  ⚡ AI Counter-Ad & Strategy Generator
                </h3>
                <p className="text-xs text-slate-500">
                  প্রতিযোগীর বিজ্ঞাপনের হুক এবং দুর্বলতা বিশ্লেষণ করে আপনার ব্র্যান্ডের জন্য শক্তিশালী কপি তৈরি
                </p>
              </div>
              <button
                onClick={() => setCounterModalAd(null)}
                className="rounded p-1 text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            {/* Competitor Ad Snippet */}
            <div className="rounded-lg bg-slate-50 p-3 text-xs border">
              <span className="font-semibold text-slate-500 uppercase tracking-wider text-[10px]">
                প্রতিযোগীর অরিজিনাল অ্যাড ({counterModalAd.platforms.join(", ")}):
              </span>
              <p className="mt-1 text-slate-700 line-clamp-3">
                {counterModalAd.creativeText || "(নো টেক্সট)"}
              </p>
            </div>

            {/* Select Our Product */}
            <div>
              <label className="text-xs font-semibold text-slate-700">
                আপনার কোন প্রোডাক্টের জন্য কাউন্টার-অ্যাড বানাতে চান?
              </label>
              <select
                className={inputCls}
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
              >
                <option value="">ডিফল্ট স্টোর কনটেক্সট (যেকোনো প্রোডাক্ট)</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({formatMinor(BigInt(p.priceMinor), p.currency)})
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleGenerateCounterAd}
              disabled={isGeneratingCounterAd}
              className="btn-primary w-full py-2.5 text-sm flex items-center justify-center gap-2"
            >
              {isGeneratingCounterAd ? (
                <span>এআই অ্যানালাইসিস ও কপি তৈরি হচ্ছে...</span>
              ) : (
                <span>🚀 Generate Unstoppable Counter-Campaign</span>
              )}
            </button>

            {/* Results Display */}
            {counterAdResult ? (
              <div className="space-y-4 border-t pt-4">
                {/* Hook & Weakness Breakdown */}
                <div className="rounded-lg bg-indigo-50/50 p-4 border border-indigo-100">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-indigo-900">
                    🎯 প্রতিযোগীর Hook & Weakness Analysis:
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
                    <span className="font-semibold text-xs text-red-700">প্রতিযোগীর দুর্বলতাসমূহ:</span>
                    <ul className="list-disc pl-4 text-xs text-slate-600 mt-1 space-y-0.5">
                      {counterAdResult.hookBreakdown.weaknesses.map((w, idx) => (
                        <li key={idx}>{w}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Generated Copy */}
                <div className="rounded-lg bg-emerald-50/50 p-4 border border-emerald-100 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-xs uppercase tracking-wider text-emerald-900">
                      🔥 আপনার জন্য প্রস্তুতকৃত কাউন্টার কপি:
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
                          copyToClipboard(counterAdResult.counterCampaign.headline, "Headline কপি হয়েছে!")
                        }
                        className="text-xs text-blue-600 hover:underline"
                      >
                        কপি
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
                            copyToClipboard(counterAdResult.counterCampaign.primaryText, "Primary Text কপি হয়েছে!")
                          }
                          className="text-xs font-semibold text-blue-600 hover:underline"
                        >
                          সম্পূর্ণ টেকস্ট কপি করুন
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-white p-2 rounded border">
                      <span className="font-semibold text-slate-500">অফার পরামর্শ:</span>
                      <p className="font-medium text-emerald-700">
                        {counterAdResult.counterCampaign.suggestedOffer}
                      </p>
                    </div>
                    <div className="bg-white p-2 rounded border">
                      <span className="font-semibold text-slate-500">কল-টু-অ্যাকশন:</span>
                      <p className="font-medium text-slate-900">
                        {counterAdResult.counterCampaign.callToAction}
                      </p>
                    </div>
                  </div>

                  <p className="text-xs text-slate-500 italic">
                    💡 কেন এই কপি প্রতিযোগীকে হারাবে: {counterAdResult.counterCampaign.whyThisBeatsCompetitor}
                  </p>

                  <div className="pt-2 border-t border-emerald-200/80">
                    <button
                      onClick={pushToCampaignBuilder}
                      className="w-full rounded-lg bg-gradient-to-r from-emerald-600 to-teal-700 py-2.5 text-xs font-bold text-white shadow hover:from-emerald-700 hover:to-teal-800 flex items-center justify-center gap-2"
                    >
                      <span>🚀 ১-ক্লিকে Campaign Builder-এ পাঠান (Create Ad)</span>
                      <span>➔</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Video Script Deconstructor Modal */}
      {videoModalAd ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
          <div className="card w-full max-w-4xl max-h-[92vh] overflow-y-auto bg-white p-6 space-y-5">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-pink-100 text-pink-700 text-lg">
                  🎬
                </span>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Viral UGC & Video Script Deconstructor
                  </h3>
                  <p className="text-xs text-slate-500">
                    রিলস ও টিকটক ভিডিওর হুক বিশ্লেষণ এবং আপনার স্টোরের জন্য ফ্রেম-বাই-ফ্রেম শুটিং স্ক্রিপ্ট
                  </p>
                </div>
              </div>
              <button
                onClick={() => setVideoModalAd(null)}
                className="rounded p-1 text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            {/* Competitor Ad Snippet */}
            <div className="rounded-xl bg-slate-50 p-3.5 text-xs border border-slate-200">
              <span className="font-semibold text-slate-500 uppercase tracking-wider text-[10px]">
                অরিজিনাল ভিডিও অ্যাড টেক্সট ({videoModalAd.platforms.join(", ")}):
              </span>
              <p className="mt-1 text-slate-800 line-clamp-3 leading-relaxed">
                {videoModalAd.creativeText || "(ভিডিওর টেক্সট অনুপস্থিত)"}
              </p>
            </div>

            {/* Inputs: Product & Style */}
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  আপনার কোন প্রোডাক্টের জন্য ভিডিও বানাবেন?
                </label>
                <select
                  className={inputCls}
                  value={selectedProductIdForVideo}
                  onChange={(e) => setSelectedProductIdForVideo(e.target.value)}
                >
                  <option value="">ডিফল্ট স্টোর প্রোডাক্ট (অটো কনটেক্সট)</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({formatMinor(BigInt(p.priceMinor), p.currency)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  ভিডিও কনটেন্টের স্টাইল
                </label>
                <select
                  className={inputCls}
                  value={videoScriptStyle}
                  onChange={(e) => setVideoScriptStyle(e.target.value)}
                >
                  <option value="ugc">📱 UGC Creator / কাস্টমার সেলফি স্টাইল</option>
                  <option value="unboxing">📦 Dramatic Unboxing & ASMR ফিনিশ</option>
                  <option value="problem_solution">⚡ Problem-Agitation-Solution (সমস্যা ও সমাধান)</option>
                  <option value="skit">🎭 Relatable Story / কমেডি সিচুয়েশনাল ড্রামা</option>
                </select>
              </div>
            </div>

            <button
              onClick={deconstructVideoScriptHandler}
              disabled={isVideoDeconstructing}
              className="w-full rounded-xl bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 py-3 text-xs font-bold text-white shadow-md hover:from-pink-700 hover:to-indigo-700 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            >
              {isVideoDeconstructing ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-r-transparent" />
                  <span>ভিডিওর ফ্রেম ও হুক বিশ্লেষণ হচ্ছে...</span>
                </>
              ) : (
                <>
                  <span>⚡ ফ্রেম-বাই-ফ্রেম স্ক্রিপ্ট ও ভয়েসওভার ডিকনস্ট্রাক্ট করুন</span>
                  <span>➔</span>
                </>
              )}
            </button>

            {/* Generated Script Results */}
            {videoScriptResult ? (
              <div className="space-y-5 pt-3 border-t">
                {/* Hook & Retention Breakdown Card */}
                <div className="rounded-xl border border-pink-200 bg-pink-50/50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-pink-900 uppercase tracking-wider flex items-center gap-1.5">
                      <span>🎯 ০-৩ সেকেন্ড হুক অ্যানালাইসিস</span>
                      <span className="rounded bg-pink-200/80 text-pink-800 text-[10px] px-2 py-0.5 font-bold">
                        {videoScriptResult.hookCategory}
                      </span>
                    </span>
                    <span className="text-xs font-semibold text-slate-600">
                      মোট ডিউরেশন: ~{videoScriptResult.totalDurationSeconds}s ({videoScriptResult.format})
                    </span>
                  </div>
                  <div className="grid sm:grid-cols-3 gap-3 text-xs">
                    <div className="rounded-lg bg-white p-3 border border-pink-100">
                      <span className="font-semibold text-slate-500 text-[11px]">স্ক্রোল থামানোর হুক:</span>
                      <p className="mt-1 font-bold text-slate-800">{videoScriptResult.competitorHookBreakdown.firstThreeSecondsHook}</p>
                    </div>
                    <div className="rounded-lg bg-white p-3 border border-pink-100">
                      <span className="font-semibold text-slate-500 text-[11px]">ভিউয়ার ধরে রাখার কারণ (Retention):</span>
                      <p className="mt-1 text-slate-700">{videoScriptResult.competitorHookBreakdown.whyItRetainsViewers}</p>
                    </div>
                    <div className="rounded-lg bg-white p-3 border border-pink-100">
                      <span className="font-semibold text-slate-500 text-[11px]">মানসিক ট্রিগার (Trigger):</span>
                      <p className="mt-1 font-semibold text-indigo-700">{videoScriptResult.competitorHookBreakdown.coreEmotionalTrigger}</p>
                    </div>
                  </div>
                </div>

                {/* Scene-by-Scene Storyboard & Teleprompter */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-slate-900 text-sm">
                      🎬 সিন-বাই-সিন স্টোরিবোর্ড ও শুটিং গাইড ({videoScriptResult.adaptedScript.conceptTitle})
                    </h4>
                    <span className="text-xs text-slate-400">রিলস / টিকটক (৯:১৬) ফরম্যাট</span>
                  </div>

                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 text-slate-700 font-semibold border-b">
                        <tr>
                          <th className="py-2.5 px-3 w-24">টাইমস্ট্যাম্প</th>
                          <th className="py-2.5 px-3 w-36">ফেজ / পর্ব</th>
                          <th className="py-2.5 px-3">ক্যামেরা ও বি-রোল নির্দেশিকা (Visual Shot)</th>
                          <th className="py-2.5 px-3">স্পোকেন ডায়লগ / ভয়েসওভার (Audio)</th>
                          <th className="py-2.5 px-3">স্ক্রিন টেক্সট / ক্যাপশন</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y text-slate-800">
                        {videoScriptResult.adaptedScript.scenes.map((scene, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="py-2.5 px-3 font-mono font-bold text-indigo-600">
                              {scene.timeRange}
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="rounded bg-indigo-50 border border-indigo-200 text-indigo-800 text-[10px] font-bold px-1.5 py-0.5">
                                {scene.phase}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-slate-600">
                              <span className="font-medium text-slate-900">{scene.visualCue}</span>
                              <p className="text-[10px] text-slate-400 mt-0.5">নোট: {scene.directorNotes}</p>
                            </td>
                            <td className="py-2.5 px-3 font-semibold text-slate-900 leading-relaxed">
                              &ldquo;{scene.audioVoiceover}&rdquo;
                            </td>
                            <td className="py-2.5 px-3 font-bold text-pink-700">
                              {scene.onScreenText}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Teleprompter Box */}
                <div className="rounded-xl bg-slate-900 text-white p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-pink-400">
                      🎙️ টেলিপ্রম্পটার ভয়েসওভার কপি (Full Voiceover Script)
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(videoScriptResult.adaptedScript.fullVoiceoverBangla);
                        setCopiedText("voiceover");
                        setTimeout(() => setCopiedText(""), 2000);
                      }}
                      className="rounded bg-slate-800 hover:bg-slate-700 text-xs px-2.5 py-1 text-white font-semibold flex items-center gap-1 border border-slate-700"
                    >
                      {copiedText === "voiceover" ? "কপি হয়েছে!" : "📋 কপি টেলিপ্রম্পটার"}
                    </button>
                  </div>
                  <p className="text-xs text-slate-200 leading-relaxed font-sans">
                    {videoScriptResult.adaptedScript.fullVoiceoverBangla}
                  </p>
                </div>

                {/* Creator Shooting Checklist */}
                <div className="grid sm:grid-cols-2 gap-3 text-xs">
                  <div className="rounded-xl border p-3.5 bg-slate-50 space-y-2">
                    <span className="font-bold text-slate-900 block">🎥 ক্রিয়েটর শুটিং চেকলিস্ট:</span>
                    <ul className="space-y-1 text-slate-600 list-disc list-inside text-[11px]">
                      {videoScriptResult.adaptedScript.creatorShootingChecklist.map((item, ix) => (
                        <li key={ix}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-xl border p-3.5 bg-slate-50 space-y-2">
                    <span className="font-bold text-slate-900 block">🎵 সাজেস্টেড ব্যাকগ্রাউন্ড মিউজিক:</span>
                    <p className="text-slate-700 text-[11px] leading-relaxed">
                      {videoScriptResult.adaptedScript.suggestedAudioTrack}
                    </p>
                    <div className="pt-2 border-t text-[11px] text-slate-500">
                      টিপস: টিকটক ও ইনস্টাগ্রামে ট্রেন্ডিং সাউন্ড ব্যবহার করলে রিচ ২ গুণ বৃদ্ধি পায়।
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Alert Bot Settings Modal */}
      {isAlertSettingsOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
          <form onSubmit={saveAlertSettingsHandler} className="card w-full max-w-lg bg-white p-6 space-y-5">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 text-lg">
                  📲
                </span>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Telegram & WhatsApp Real-Time Alert Bot
                  </h3>
                  <p className="text-xs text-slate-500">
                    প্রতিযোগী দাম কমালে বা স্টক-আউট হলে ফোনে ইনস্ট্যান্ট নোটিফিকেশন পান
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAlertSettingsOpen(false)}
                className="rounded p-1 text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            {/* Telegram Settings */}
            <div className="rounded-xl border p-4 bg-slate-50 space-y-3">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 font-bold text-xs text-slate-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={alertConfig.telegramEnabled}
                    onChange={(e) => setAlertConfig({ ...alertConfig, telegramEnabled: e.target.checked })}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>✈️ Telegram নোটিফিকেশন সক্রিয় করুন</span>
                </label>
                <button
                  type="button"
                  disabled={!alertConfig.telegramBotToken || !alertConfig.telegramChatId || isTestingAlert}
                  onClick={() => testAlertChannelHandler("telegram")}
                  className="rounded border border-indigo-200 bg-white px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                >
                  {isTestingAlert ? "পাঠানো হচ্ছে..." : "🔔 টেস্ট মেসেজ পাঠান"}
                </button>
              </div>

              {alertConfig.telegramEnabled ? (
                <div className="space-y-2 pt-1 text-xs">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">
                      Telegram Bot Token (@BotFather থেকে প্রাপ্ত)
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
                      placeholder="e.g. 123456789 বা -100123456789"
                      value={alertConfig.telegramChatId || ""}
                      onChange={(e) => setAlertConfig({ ...alertConfig, telegramChatId: e.target.value })}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            {/* WhatsApp Settings */}
            <div className="rounded-xl border p-4 bg-slate-50 space-y-3">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 font-bold text-xs text-slate-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={alertConfig.whatsappEnabled}
                    onChange={(e) => setAlertConfig({ ...alertConfig, whatsappEnabled: e.target.checked })}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>💬 WhatsApp Webhook নোটিফিকেশন</span>
                </label>
                <button
                  type="button"
                  disabled={!alertConfig.whatsappWebhookUrl || isTestingAlert}
                  onClick={() => testAlertChannelHandler("whatsapp")}
                  className="rounded border border-emerald-200 bg-white px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                >
                  {isTestingAlert ? "পাঠানো হচ্ছে..." : "🔔 টেস্ট Webhook"}
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
              <span className="font-bold text-slate-800 block">কোন কোন ক্ষেত্রে অ্যালার্ট পাঠাবে:</span>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={alertConfig.notifyOnStockOut}
                    onChange={(e) => setAlertConfig({ ...alertConfig, notifyOnStockOut: e.target.checked })}
                  />
                  <span>🚨 প্রতিদ্বন্দীর প্রোডাক্ট Stock-Out হলে (ক্যাম্পেইন বুস্ট সুযোগ)</span>
                </label>
                <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={alertConfig.notifyOnPriceDrop}
                    onChange={(e) => setAlertConfig({ ...alertConfig, notifyOnPriceDrop: e.target.checked })}
                  />
                  <span>📉 প্রতিযোগী প্রোডাক্টের দাম ১০%+ কমালে</span>
                </label>
                <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={alertConfig.notifyOnWinningAd}
                    onChange={(e) => setAlertConfig({ ...alertConfig, notifyOnWinningAd: e.target.checked })}
                  />
                  <span>🔥 প্রতিদ্বন্দীর নতুন Winning Ad (১৪+ দিন স্থায়ী) শনাক্ত হলে</span>
                </label>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setIsAlertSettingsOpen(false)}
                className="rounded-lg border px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                বাতিল
              </button>
              <button
                type="submit"
                disabled={isSavingAlertConfig}
                className="btn-primary text-xs py-2 px-4 disabled:opacity-50"
              >
                {isSavingAlertConfig ? "সংরক্ষণ হচ্ছে..." : "সেটিংস সংরক্ষণ করুন"}
              </button>
            </div>
          </form>
        </div>
      ) : null}



      {/* AI Market Intelligence Feed */}
      <div className="card p-5 bg-white">
        <div className="flex items-center justify-between border-b pb-3">
          <div>
            <h3 className="font-bold text-slate-900">
              AI Market Intelligence {active ? `(${active.name})` : "(সব প্রতিযোগী)"}
            </h3>
            <p className="text-xs text-slate-400">
              প্রমাণ যাচাইকৃত স্ট্র্যাটেজিক ইনসাইট
            </p>
          </div>
          <button
            className="btn-primary text-xs py-1.5 px-3 disabled:opacity-50"
            disabled={busy !== ""}
            onClick={generateInsights}
          >
            {busy === "insights" ? "ইনসাইট তৈরি হচ্ছে..." : "✨ নতুন Insight তৈরি করুন"}
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {insights.map((ins) => (
            <div key={ins.id} className="rounded-lg bg-slate-50 p-3 text-xs border">
              <div className="font-semibold text-slate-900 flex items-center justify-between">
                <span>{ins.title}</span>
                <span className="rounded bg-white px-2 py-0.5 text-[10px] text-slate-500 border">
                  {ins.kind} · {ins.provider}
                </span>
              </div>
              {ins.detail ? <p className="mt-1 text-slate-600 leading-relaxed">{ins.detail}</p> : null}
              <div className="mt-2 text-[11px] text-slate-400">
                প্রমাণ:{" "}
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
              এখনো কোনো Insight নেই। আগে বিজ্ঞাপণ বা দামের তথ্য সিঙ্ক করুন, তারপর ইনসাইট জেনারেট করুন।
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
