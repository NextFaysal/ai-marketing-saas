"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor } from "@repo/contracts";
import { mentionSegments } from "@/lib/campaign-cn10";

interface AdAccount { id: string; name: string; platform: string; sourceType: string; externalId?: string | null; platformStatusBucket?: string | null; integrationId?: string | null }
interface Product { id: string; name: string; priceMinor: string; currency: string }
interface AdItem { id: string; name: string; primaryText: string; headline?: string | null; description?: string | null; linkUrl: string; callToAction?: string; imageUrl?: string | null; format?: string; externalAdId?: string | null; createdByAi: boolean; effectiveStatus?: string | null; issuesInfo?: unknown; textOptions?: { primaryTexts: string[]; headlines: string[]; descriptions: string[] } | null; placementAssets?: { version: number; placements: { feed?: { imageAssetId?: string; videoAssetId?: string; imageUrl?: string }; vertical?: { imageAssetId?: string; videoAssetId?: string; imageUrl?: string } }; feedImageUrl?: string; verticalImageUrl?: string } | null; creativeEnhancements?: Record<string, boolean> | null; whatsappWelcome?: { greetingText?: string; prefillMessage?: string; iceBreakers?: string[] } | null }

// Campaign Builder CB3: placement preview frames. A
// mock frame around the ad's REAL content — not a Meta
// render.
function AdPreview({ ad, pageName }: { ad: AdItem; pageName: string }) {
  const domain = (() => { try { return new URL(ad.linkUrl).hostname; } catch { return ad.linkUrl; } })();
  // CN5: placement-specific media wins in its frame when set.
  const feedUrl = ad.placementAssets?.feedImageUrl ?? ad.imageUrl;
  const verticalUrl = ad.placementAssets?.verticalImageUrl ?? ad.imageUrl;
  const mediaFor = (url?: string | null) => url
    ? <img src={url} alt="" className="h-full w-full object-cover" />
    : <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-200 to-slate-300 text-xs text-slate-500">{ad.format === "video" ? "🎬 ভিডিও" : ad.format === "carousel" ? "🎠 Carousel" : "🖼️ ছবি নেই / লাইব্রেরি Asset"}</div>;
  const media = mediaFor(feedUrl);
  const mediaTall = mediaFor(verticalUrl);
  const wide = (
    <div className="w-64 overflow-hidden rounded-xl border bg-white shadow-sm">
      <div className="flex items-center gap-2 p-2"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700">{pageName.slice(0, 1)}</div><div className="text-xs font-semibold">{pageName}<div className="font-normal text-slate-400">Sponsored</div></div></div>
      <p className="px-2 text-xs text-slate-700 line-clamp-3">{ad.primaryText}</p>
      <div className="mt-1 h-32">{media}</div>
      <div className="flex items-center justify-between bg-slate-50 px-2 py-1.5"><div className="min-w-0"><div className="truncate text-xs font-semibold">{ad.headline ?? domain}</div><div className="truncate text-[11px] text-slate-400">{domain}</div></div><span className="ml-2 shrink-0 rounded bg-slate-200 px-2 py-1 text-[11px] font-semibold">{ad.callToAction ?? "SHOP_NOW"}</span></div>
    </div>
  );
  const tall = (label: string) => (
    <div className="relative h-80 w-44 overflow-hidden rounded-xl border bg-slate-900 shadow-sm">
      <div className="absolute inset-0">{mediaTall}</div>
      <div className="absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/60 to-transparent p-2"><div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-xs font-bold text-indigo-700">{pageName.slice(0, 1)}</div><div className="text-[11px] font-semibold text-white">{pageName}<div className="font-normal text-white/70">Sponsored</div></div></div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 pt-6">
        <p className="text-[11px] text-white line-clamp-2">{ad.primaryText}</p>
        <div className="mt-1 truncate text-[11px] font-semibold text-white">{ad.headline ?? ""}</div>
        <span className="mt-1 inline-block rounded bg-white px-2 py-0.5 text-[11px] font-bold text-slate-900">{ad.callToAction ?? "SHOP_NOW"}</span>
        <div className="mt-0.5 text-[10px] text-white/60">{label} · {domain}</div>
      </div>
    </div>
  );
  return (
    <div className="mt-2 rounded-lg border border-dashed bg-slate-100 p-3">
      <div className="mb-2 text-xs font-semibold text-slate-500">👁 Placement Preview — আসল লেখা/ছবি দিয়ে সাজানো Mock Frame (Meta এর আসল Render নয়)</div>
      <div className="flex flex-wrap items-start gap-3">
        <div>{wide}<div className="mt-1 text-center text-[11px] text-slate-400">Feed{ad.placementAssets?.feedImageUrl ? " · Placement Asset (CN5)" : ""}</div></div>
        <div>{tall("Reels")}<div className="mt-1 text-center text-[11px] text-slate-400">Reels (9:16){ad.placementAssets?.verticalImageUrl ? " · Placement Asset (CN5)" : ""}</div></div>
        <div>{tall("Story")}<div className="mt-1 text-center text-[11px] text-slate-400">Story (9:16){ad.placementAssets?.verticalImageUrl ? " · Placement Asset (CN5)" : ""}</div></div>
      </div>
    </div>
  );
}
// Campaign Builder Next CN1: a targeting entry is a legacy
// name string or a Meta-confirmed { id, name } pair.
type TEntry = string | { id?: string; name: string };
const entryName = (e: TEntry) => (typeof e === "string" ? e : e.name);
const entryToken = (e: TEntry) => (typeof e === "string" ? e : e.id ? `${e.name}|${e.id}` : e.name);
const parseEntries = (v: string): TEntry[] => v.split(",").map((x) => x.trim()).filter(Boolean).map((tok) => {
  const [name, id] = tok.split("|").map((y) => y.trim());
  return id ? { name, id } : name;
});
const parseCities = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean).map((tok) => {
  const [key, radius] = tok.split(":").map((y) => y.trim());
  return radius && Number(radius) > 0 ? { key, radius: Number(radius), distanceUnit: "kilometer" } : { key };
});
interface AdSet { id: string; name: string; dailyBudgetMinor?: string | null; lifetimeBudgetMinor?: string | null; optimizationGoal: string; pageId?: string | null; pixelId?: string | null; targeting: { countries?: string[]; ageMin?: number; ageMax?: number; genders?: number[]; interests?: TEntry[]; behaviors?: TEntry[]; narrowInterests?: TEntry[]; narrowBehaviors?: TEntry[]; cities?: { key: string; name?: string; radius?: number; distanceUnit?: string }[]; postcodes?: string[]; locationTypes?: string[]; locales?: number[]; demographics?: { educationStatuses?: number[]; relationshipStatuses?: number[]; lifeEvents?: TEntry[]; workPositions?: TEntry[] }; targetingExpansion?: boolean; platforms?: string[]; positions?: string[]; devices?: string[]; customAudienceIds?: string[]; excludedAudienceIds?: string[]; exclusionPresets?: { key: string; name: string; audienceRecordId: string; externalAudienceId: string }[] }; bidStrategy?: string | null; bidAmountMinor?: string | null; costGoalMinor?: string | null; roasAverageFloor?: number | null; conversionEvent?: string | null; catalogRecordId?: string | null; productSetId?: string | null; leadFormId?: string | null; destinationType?: string | null; whatsappIntegrationId?: string | null; whatsappPhoneNumberId?: string | null; whatsappPhoneNumber?: string | null; funnelLayer?: string | null; funnelIncomplete?: string | null; __catalog?: { id: string; name: string } | null; __productSet?: { id: string; name: string; status: string; externalSetId?: string | null } | null; __leadForm?: { id: string; name: string; status: string; externalFormId?: string | null } | null; externalAdSetId?: string | null; effectiveStatus?: string | null; startTime?: string | null; endTime?: string | null; daypart?: { day: number; startHour: number; endHour: number }[] | null; ads: AdItem[] }

// Campaign Builder Next CN3/CN4: conversion-event vocabularies (the API enforces the objective matrix).
const SALES_EVENTS = ["PURCHASE", "ADD_TO_CART", "INITIATE_CHECKOUT", "ADD_PAYMENT_INFO", "VIEW_CONTENT", "ADD_TO_WISHLIST", "COMPLETE_REGISTRATION", "SUBSCRIBE", "START_TRIAL", "SEARCH", "CONTACT", "SCHEDULE", "SUBMIT_APPLICATION", "FIND_LOCATION", "DONATE", "OTHER"];
const LEAD_EVENTS = ["LEAD", "COMPLETE_REGISTRATION", "SUBMIT_APPLICATION", "SCHEDULE", "CONTACT"];
interface CatalogRec { id: string; name: string; platform: string; externalCatalogId: string }
interface ProductSetRec { id: string; name: string; status: string; externalSetId?: string | null; itemCount: number }
interface LeadFormQ { type: string; key: string; label?: string; options?: string[] }
interface LeadFormRec { id: string; name: string; pageId: string; introHeadline?: string | null; questions: LeadFormQ[]; privacyPolicyUrl: string; higherIntent: boolean; fieldMapping: Record<string, string>; externalFormId?: string | null; status: string; error?: string | null }
interface CustomFieldLite { id: string; key: string; label: string; archivedAt?: string | null }

// Campaign Builder Next CN5: Advantage creative enhancements (the API
// refuses any key outside this list; mapped at publish to
// degrees_of_freedom_spec.creative_features_spec).
const CN5_ENHANCEMENTS: { key: string; label: string }[] = [
  { key: "image_templates", label: "Image Templates" },
  { key: "image_touchups", label: "Image Touch-ups" },
  { key: "text_optimizations", label: "Text Optimizations" },
  { key: "inline_comment", label: "Inline Comment" },
  { key: "video_auto_crop", label: "Video Auto Crop" },
];
interface StudioSource { key: string; label: string; segment?: string | null; available: boolean; contactCount?: number; reason?: string }
interface StudioData { available: boolean; reason?: string; sources: StudioSource[]; audiences: { id: string; name: string; kind: string; source: string; status: string; externalAudienceId?: string | null; approximateCount?: number | null; lastMembershipCount?: number | null }[]; presets: { key: string; name: string }[] }
interface AudienceInsights { included: { externalAudienceId: string; name: string | null; size: number | null; sizeSource: string | null }[]; excluded: { externalAudienceId: string; name: string | null; size: number | null; sizeSource: string | null }[]; warnings: { code: string; message: string }[]; overlap: { status: string; reason: string }; estimate: { available: boolean; reason?: string; lowerBound?: number; upperBound?: number; currency?: string } }

// Campaign Builder CB1: placement vocabularies.
const PLATFORM_OPTS = [{ v: "facebook", l: "Facebook" }, { v: "instagram", l: "Instagram" }, { v: "audience_network", l: "Audience Network" }, { v: "messenger", l: "Messenger" }];
const POSITION_OPTS = [{ v: "feed", l: "Feed" }, { v: "reels", l: "Reels" }, { v: "story", l: "Story" }, { v: "search", l: "Search" }];
const DEVICE_OPTS = [{ v: "mobile", l: "Mobile" }, { v: "desktop", l: "Desktop" }];

function PlacementChecks({ values, onChange }: { values: { platforms: string[]; positions: string[]; devices: string[] }; onChange: (next: { platforms: string[]; positions: string[]; devices: string[] }) => void }) {
  const toggle = (key: "platforms" | "positions" | "devices", v: string) => {
    const arr = values[key].includes(v) ? values[key].filter((x) => x !== v) : [...values[key], v];
    onChange({ ...values, [key]: arr });
  };
  const group = (label: string, key: "platforms" | "positions" | "devices", opts: { v: string; l: string }[]) => (
    <div>
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1 flex flex-wrap gap-2">
        {opts.map((o) => (
          <label key={o.v} className="flex cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 text-xs">
            <input type="checkbox" checked={values[key].includes(o.v)} onChange={() => toggle(key, o.v)} /> {o.l}
          </label>
        ))}
      </div>
    </div>
  );
  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-3 lg:col-span-3">
      <div className="text-sm font-semibold">📍 Placement <span className="font-normal text-slate-500">— কিছুই না বাছলে Meta এর Default Placement চলবে (Advantage Placements)</span></div>
      <div className="grid gap-2 sm:grid-cols-3">
        {group("Platform", "platforms", PLATFORM_OPTS)}
        {group("Position", "positions", POSITION_OPTS)}
        {group("Device", "devices", DEVICE_OPTS)}
      </div>
    </div>
  );
}
interface PublishLog { id: string; step: string; status: string; externalId?: string | null; error?: string | null; createdAt: string }
interface Plan {
  adAccountId: string; id: string; name: string; objective: string; status: string; advantagePlus?: boolean; budgetMode?: string; campaignDailyBudgetMinor?: string | null; campaignLifetimeBudgetMinor?: string | null; dailyBudgetCapMinor?: string | null; metaStatus?: string | null; metaEffectiveStatus?: string | null; lastStatusSyncAt?: string | null; healthIssues?: { level: string; name: string; status: string }[]; externalCampaignId?: string | null; approvedById?: string | null; firstApproverId?: string | null; firstApprovedAt?: string | null; approvalState?: { twoStep: boolean; step: number; awaitingSecond: boolean } | null; rejectionReason?: string | null; abGroupId?: string | null; publishAt?: string | null; seriesId?: string | null; seriesInstanceDate?: string | null; adSets: AdSet[]; publishLogs: PublishLog[] }

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", pending_approval: "অনুমোদনের অপেক্ষায়", approved: "অনুমোদিত", rejected: "প্রত্যাখ্যাত",
  publishing: "প্রকাশ হচ্ছে", published: "প্রকাশিত (Meta তে)", publish_failed: "প্রকাশ ব্যর্থ",
};

// Campaign Builder Frontier NB7 (CN15/CN16): Meta Experiment
// rows + recurring-series views, as the API returns them
// (dynamic payloads — read defensively with ?.).
interface ExperimentRow { id: string; name?: string | null; groupId?: string | null; planAId: string; planBId: string; splitA: number; metricEvent?: string | null; startTime?: string | null; endTime?: string | null; metaBusinessId?: string | null; metaStudyId?: string | null; lastReadback?: unknown; lastReadbackAt?: string | null; significanceNote?: string | null }
interface ExpReadback { experiment?: ExperimentRow; metaVerbatim: { study?: any; cells?: any[] } | null; localNumbers: { planA: any; planB: any; note?: string } | null }
interface SeriesRow { id: string; name: string; cadence: string; interval?: number | null; anchorDate?: string | null; dates?: string[] | null; leadDays?: number | null; nextIndex?: number | null; status: string; sourcePlanId: string; sourcePlanName?: string | null; sourcePlanStatus?: string | null; pendingPlan: { id: string; name: string; status: string } | null; nextInstanceDate?: string | null; generationHeld?: boolean }
const SERIES_CADENCE_LABEL: Record<string, string> = { weekly: "সাপ্তাহিক", monthly: "মাসিক", dates: "তারিখের তালিকা" };
// Meta study times arrive as unix SECONDS (numbers or numeric
// strings); date-shaped strings pass through as dates.
const fmtStudyTime = (v: unknown): string => {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isFinite(n) && n > 0 && /^\d+$/.test(String(v).trim())) return new Date(n * 1000).toLocaleString("bn-BD");
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString("bn-BD");
};
const fmtTotalsSpend = (t: any): string => {
  try { return t?.spendMinor != null ? formatMinor(BigInt(t.spendMinor)) : "—"; } catch { return String(t?.spendMinor ?? "—"); }
};

export default function CampaignBuilderPage() {
  const params = useSearchParams();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [createForm, setCreateForm] = useState({ name: "", objective: "OUTCOME_SALES", adAccountId: "", budgetMode: "abo", campaignDailyBudget: "", campaignLifetimeBudget: "" });
  const emptyAdSetForm = { name: "", dailyBudget: "", optimizationGoal: "LINK_CLICKS", pageId: "", pixelId: "", countries: "BD", interests: "", audienceIds: "", excludeIds: "", cities: "", postcodes: "", locationTypes: "", locales: "", behaviors: "", narrowInterests: "", eduStatuses: "", relStatuses: "", lifeEvents: "", workPositions: "", bidStrategy: "", bidAmount: "", costPerResultGoal: "", roasGoal: "", conversionEvent: "", catalogRecordId: "", productSetId: "", leadFormId: "", destinationType: "", whatsappIntegrationId: "" };
  const [adSetForm, setAdSetForm] = useState(emptyAdSetForm);
  const [expansion, setExpansion] = useState(false);
  // Campaign Builder Next CN1: targeting search state.
  const [tSearch, setTSearch] = useState<{ kind: string; query: string; available?: boolean; reason?: string; results: { id: string; name: string | null; audienceSizeLower: number | null; audienceSizeUpper: number | null }[] }>({ kind: "interest", query: "", results: [] });
  // Campaign Builder Next CN2: pacing state.
  const [pacing, setPacing] = useState<{ published: boolean; status: string; spentMinor: string; expectedMinor: string | null; varianceMinor: string | null; daysElapsed: number | null; daysTotal: number | null; budgetMode?: string } | null>(null);
  // Campaign Builder CB1: placements + inline editing.
  const [placements, setPlacements] = useState<{ platforms: string[]; positions: string[]; devices: string[] }>({ platforms: [], positions: [], devices: [] });
  const [editSetId, setEditSetId] = useState<string | null>(null);
  const [editAdId, setEditAdId] = useState<string | null>(null);
  const [adSetStart, setAdSetStart] = useState("");
  const [adSetEnd, setAdSetEnd] = useState("");
  type AdForm = { name: string; primaryText: string; headline: string; linkUrl: string; imageUrl: string; format: string; imageAssetId: string; videoAssetId: string; carouselText: string; extraTexts: string; extraHeadlines: string; descriptions: string; feedAssetId: string; verticalAssetId: string; verticalVideoAssetId: string; enhancements: Record<string, boolean>; waGreeting: string; waPrefill: string; waIce: string };
  const emptyAdForm: AdForm = { name: "", primaryText: "", headline: "", linkUrl: "", imageUrl: "", format: "link", imageAssetId: "", videoAssetId: "", carouselText: "", extraTexts: "", extraHeadlines: "", descriptions: "", feedAssetId: "", verticalAssetId: "", verticalVideoAssetId: "", enhancements: {}, waGreeting: "", waPrefill: "", waIce: "" };
  const [adForms, setAdForms] = useState<Record<string, AdForm>>({});
  const [assets, setAssets] = useState<{ id: string; kind: string; name: string; status: string; adAccountId: string }[]>([]);
  const [mediaAssets, setMediaAssets] = useState<{ id: string; name: string; kind: string; publicToken?: string | null }[]>([]);
  const [studio, setStudio] = useState<StudioData | null>(null);
  const [insights, setInsights] = useState<Record<string, AudienceInsights>>({});
  const [variantAdId, setVariantAdId] = useState<string | null>(null);
  const [audList, setAudList] = useState<{ id: string; name: string; externalAudienceId?: string | null; adAccountId?: string | null; status?: string }[]>([]);
  // Campaign Builder Next CN3/CN4: catalogs, product sets, lead forms, retargeting preset.
  const [catalogs, setCatalogs] = useState<CatalogRec[]>([]);
  const [formSets, setFormSets] = useState<ProductSetRec[]>([]);
  const [editSets, setEditSets] = useState<ProductSetRec[]>([]);
  const [leadForms, setLeadForms] = useState<LeadFormRec[]>([]);
  const [customFields, setCustomFields] = useState<CustomFieldLite[]>([]);
  const emptyLeadForm = { name: "", pageId: "", introHeadline: "", privacyPolicyUrl: "", thankYouTitle: "", followUpActionUrl: "", higherIntent: false, questionsText: "FULL_NAME|full_name\nEMAIL|email\nPHONE|phone_number", mappingText: "full_name=name\nemail=email\nphone_number=phone" };
  const [leadFormForm, setLeadFormForm] = useState(emptyLeadForm);
  const [preset, setPreset] = useState<{ kind: string; audienceRecordId: string; name: string }>({ kind: "product_viewers", audienceRecordId: "", name: "" });
  const [presetResult, setPresetResult] = useState<{ status: string; missing?: string[]; candidates?: { id: string; name: string; externalAudienceId?: string | null }[]; adSetId?: string } | null>(null);
  const [savedList, setSavedList] = useState<{ id: string; name: string; targeting: Record<string, unknown> }[]>([]);
  const [templates, setTemplates] = useState<{ id: string; name: string; objective: string }[]>([]);
  const [blueprints, setBlueprints] = useState<{ key: string; name: string; description: string }[]>([]);
  const [bpForm, setBpForm] = useState({ blueprintKey: "", adAccountId: "", productId: "" });
  const [copySelection, setCopySelection] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [preflight, setPreflight] = useState<{ checkedAds: number; findings: { adName: string; field: string; severity: string; snippet: string; explanation: string; suggestion: string }[]; summary: { high: number; medium: number; low: number } } | null>(null);
  // Campaign Builder CB2: readiness state.
  const [readiness, setReadiness] = useState<{ ready: boolean; checks: { key: string; level: string; label: string; detail: string }[]; budget: { dailyTotalMinor: string; lifetimeTotalMinor: string }; estimate: { available: boolean; reason?: string; lowerBound?: number; upperBound?: number; currency?: string }; estimates?: { adSetId: string; name: string; available: boolean; reason?: string; lowerBound?: number; upperBound?: number }[] } | null>(null);
  // Campaign Builder CB3: creative health + preview.
  const [creativeHealth, setCreativeHealth] = useState<{ adsChecked: number; findings: { adId: string; adName: string; level: string; message: string }[] } | null>(null);
  const [previewAdId, setPreviewAdId] = useState<string | null>(null);
  // Campaign Builder CB4: comments + timeline.
  const [comments, setComments] = useState<{ id: string; body: string; authorName: string; createdAt: string; mentions?: { userId: string; name: string }[] }[] | null>(null);
  const [timeline, setTimeline] = useState<{ at: string; kind: string; title: string; detail?: string }[] | null>(null);
  // Campaign Builder Frontier CN13 (NB6): the org's WhatsApp
  // connections the destination picker offers (connected ones
  // are selectable; the number itself is never typed here) +
  // the conversation report (conversations STARTED per ad,
  // matched by first-message referral).
  const [waDestinations, setWaDestinations] = useState<{ available: boolean; reason?: string; destinations: { integrationId: string; phoneNumberId: string | null; status: string; connected: boolean; isDefault: boolean; wabaId: string | null; appSource: string }[] } | null>(null);
  const [waConvs, setWaConvs] = useState<{ available: boolean; reason?: string; published: boolean; totalConversations: number | null; perAd: { adId: string; name: string; adSetName: string; externalAdId: string; conversationsStarted: number }[]; label: string } | null>(null);
  // Campaign Builder Frontier NB7 (CN15): Meta Experiments
  // over this plan's A/B group + per-experiment read-backs.
  // Significance/winner is NEVER computed here — Meta's
  // verbatim read-back and the API's note render as-is.
  const [experiments, setExperiments] = useState<ExperimentRow[] | null>(null);
  const [expSiblings, setExpSiblings] = useState<{ planId: string; name: string; variant?: string | null; status?: string | null }[]>([]);
  const [expForm, setExpForm] = useState({ planBId: "", splitA: 50, metricEvent: "", durationDays: 7 });
  const [expReadbacks, setExpReadbacks] = useState<Record<string, ExpReadback>>({});
  // Campaign Builder Frontier NB7 (CN16): recurring series
  // whose SOURCE plan is this plan.
  const [seriesList, setSeriesList] = useState<SeriesRow[] | null>(null);
  const [seriesForm, setSeriesForm] = useState({ name: "", cadence: "weekly", interval: 1, anchor: "", datesText: "", leadDays: 3 });
  // Campaign Builder CB5: performance.
  const [perf, setPerf] = useState<{ published: boolean; totals: { spendMinor: string; impressions: number; clicks: number; conversions: number; ctrPercent: number | null; cpaMinor: string | null; firstPartyRevenueMinor: string; firstPartyOrders: number; roas: number | null } | null; perAdSet: { adSetId: string; name: string; spendMinor: string; impressions: number; clicks: number; conversions: number }[] } | null>(null);
  // Campaign Builder Next NB4 (CN7/CN8/CN9).
  type BreakdownDim = { hasData: boolean; rows: { key: string; spendMinor: string; impressions: number; clicks: number; conversions: number; ctrPercent: number | null; cpaMinor: string | null }[] };
  const [breakdowns, setBreakdowns] = useState<{ published: boolean; dimensions: Record<string, BreakdownDim> } | null>(null);
  const [creativeInsights, setCreativeInsights] = useState<{ published: boolean; rule: string; ads: { adId: string; name: string; hasData: boolean; spendMinor: string; impressions: number; clicks: number; conversions: number; ctrPercent: number | null; frequency: number | null; cpaMinor: string | null; ctrDropPercent: number | null; fatigued: boolean; fatigueReasons: string[] }[] } | null>(null);
  const [recs, setRecs] = useState<{ published: boolean; thresholds: { deadAdSetSpendMinor: string; winnerMinSpendMinor: string; budgetShiftPercent: number }; recommendations: any[] } | null>(null);
  const [guardrails, setGuardrails] = useState<{ linked: any[]; orgWide: any[] } | null>(null);
  const [accountsHealth, setAccountsHealth] = useState<{ id: string; name: string; platform: string; currency: string | null; health: { connection: string; platformStatusBucket: string; platformStatusCheckedAt: string | null } }[]>([]);
  const [cloneReport, setCloneReport] = useState<{ plan: { id: string; name: string }; targetAccount: { name: string }; mapping: { adSet: string; field: string; outcome: string; detail: string }[]; blockers: string[] } | null>(null);
  type XDraft = { id: string; platform: string; kind?: string | null; status: string; fields: any; unmapped?: string[] | null; externalCampaignId?: string | null; lastError?: string | null; publicationId?: string | null; createdAt: string };
  const [xdrafts, setXdrafts] = useState<XDraft[] | null>(null);
  const [xdEditId, setXdEditId] = useState<string | null>(null);
  const [xdForm, setXdForm] = useState<any>(null);
  const [xdResult, setXdResult] = useState<Record<string, string>>({});
  // Frontier NB8 / CN18: the campaign report share link,
  // created through the existing report-shares lifecycle.
  const [shareLink, setShareLink] = useState("");
  // Campaign Builder Next CN10/CN11 (web): guided step state +
  // governance (members for @mentions, versions, approval chain,
  // last recorded activity). Loading surfaces reuse `busy`.
  const [activeStep, setActiveStep] = useState(0);
  const [members, setMembers] = useState<{ id: string; role: string; user: { id: string; name: string; email: string } }[]>([]);
  const [myRole, setMyRole] = useState("");
  const [versions, setVersions] = useState<{ id: string; kind: string; createdAt: string; createdById?: string | null }[] | null>(null);
  const [versionDiffs, setVersionDiffs] = useState<Record<string, { differs: boolean; summary: { topLevelChanged: string[]; adSetsAdded: number; adSetsRemoved: number; adSetsChanged: number; adsAdded: number; adsRemoved: number; adsChanged: number } }>>({});
  const [lastActivity, setLastActivity] = useState<{ available: boolean; actorName?: string | null; action?: string | null; at?: string | null } | null>(null);
  const [twoStep, setTwoStep] = useState<boolean | null>(null);

  const orgId = typeof window !== "undefined" ? getOrganizationId() : null;
  const editable = plan ? ["draft", "rejected"].includes(plan.status) : false;

  // CN3: product sets follow the catalog chosen in the ad-set form.
  useEffect(() => {
    const cat = adSetForm.catalogRecordId;
    if (!cat || !orgId) { setFormSets([]); return; }
    apiFetch<ProductSetRec[]>(`/organizations/${orgId}/catalogs/${cat}/product-sets`).then(setFormSets).catch(() => setFormSets([]));
  }, [adSetForm.catalogRecordId, orgId]);

  const reloadLeadForms = useCallback(async () => {
    const o = getOrganizationId(); if (!o) return;
    const r = await apiFetch<LeadFormRec[]>(`/organizations/${o}/campaign-plans/lead-forms/list`).catch(() => null);
    if (r) setLeadForms(r);
  }, []);

  const loadPlan = useCallback(async (id: string) => {
    const o = getOrganizationId(); if (!o) return;
    setPlan(await apiFetch<Plan>(`/organizations/${o}/campaign-plans/${id}`));
    apiFetch<StudioData>(`/organizations/${o}/campaign-plans/${id}/audience-studio`).then(setStudio).catch(() => setStudio(null));
    apiFetch<NonNullable<typeof lastActivity>>(`/organizations/${o}/campaign-plans/${id}/last-activity`).then(setLastActivity).catch(() => setLastActivity(null));
  }, []);

  useEffect(() => {
    (async () => {
      const o = getOrganizationId(); if (!o) return;
      try {
        const [accs, prods] = await Promise.all([
          apiFetch<AdAccount[]>(`/organizations/${o}/ad-accounts`),
          apiFetch<Product[]>(`/organizations/${o}/products`),
        ]);
        setAccounts(accs);
        setProducts(prods);
        apiFetch(`/organizations/${o}/creatives`).then((r: any) => setAssets(r)).catch(() => undefined);
        apiFetch(`/organizations/${o}/social/media`).then((r: any) => setMediaAssets(r)).catch(() => undefined);
        apiFetch(`/organizations/${o}/audiences`).then((r: any) => setAudList(r)).catch(() => undefined);
        apiFetch(`/organizations/${o}/audiences/saved/list`).then((r: any) => setSavedList(r)).catch(() => undefined);
        apiFetch(`/organizations/${o}/campaign-plans/templates/list`).then((r: any) => setTemplates(r)).catch(() => undefined);
        apiFetch(`/organizations/${o}/campaign-plans/blueprints/list`).then((r: any) => setBlueprints(r)).catch(() => undefined);
        apiFetch<CatalogRec[]>(`/organizations/${o}/catalogs`).then((r) => setCatalogs(r)).catch(() => undefined);
        apiFetch<LeadFormRec[]>(`/organizations/${o}/campaign-plans/lead-forms/list`).then((r) => setLeadForms(r)).catch(() => undefined);
        apiFetch<NonNullable<typeof waDestinations>>(`/organizations/${o}/campaign-plans/whatsapp-destinations`).then((r) => setWaDestinations(r)).catch(() => undefined);
        apiFetch<CustomFieldLite[]>(`/organizations/${o}/crm/custom-fields`).then((r) => setCustomFields(r.filter((f) => !f.archivedAt))).catch(() => undefined);
        // CN11 governance reads: org members (team-page response
        // shape) for the @mention picker, my role for the
        // OWNER/ADMIN approval-chain toggle, and the chain setting.
        apiFetch<typeof members>(`/organizations/${o}/members`).then((r) => setMembers(Array.isArray(r) ? r : [])).catch(() => undefined);
        apiFetch<{ id: string; myRole: string }[]>(`/organizations`).then((orgs) => { const mine = (Array.isArray(orgs) ? orgs : []).find((x) => x.id === o); if (mine) setMyRole(mine.myRole); }).catch(() => undefined);
        apiFetch<{ twoStepApproval: boolean }>(`/organizations/${o}/campaign-plans/settings/approval-chain`).then((r) => setTwoStep(r.twoStepApproval === true)).catch(() => undefined);
        if (accs.length) setCreateForm((f) => ({ ...f, adAccountId: f.adAccountId || accs.find((a) => a.platform === "meta")?.id || "" }));
      } catch { /* lists are optional for viewing */ }
      const id = params.get("id");
      if (id) { try { await loadPlan(id); } catch (e) { setError(e instanceof Error ? e.message : "Plan load failed"); } }
    })();
  }, [params, loadPlan]);

  async function wrap<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
    setBusy(key); setError("");
    try { return await fn(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); return null; }
    finally { setBusy(""); }
  }

  async function createPlan(e: React.FormEvent) {
    e.preventDefault(); if (!orgId) return;
    const created = await wrap("create", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans`, { method: "POST", body: JSON.stringify({ name: createForm.name, objective: createForm.objective, adAccountId: createForm.adAccountId, budgetMode: createForm.budgetMode, campaignDailyBudget: createForm.campaignDailyBudget || undefined, campaignLifetimeBudget: createForm.campaignLifetimeBudget || undefined }) }));
    if (created) { setPlan(created); setNotice("Plan তৈরি হয়েছে (Draft)। এবার Ad Set ও Ad যোগ করুন।"); }
  }

  async function addAdSet(e: React.FormEvent) {
    e.preventDefault(); if (!orgId || !plan) return;
    const res = await wrap("adset", () => apiFetch(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets`, {
      method: "POST",
      body: JSON.stringify({
        name: adSetForm.name, dailyBudget: adSetForm.dailyBudget || undefined, optimizationGoal: adSetForm.optimizationGoal,
        pageId: adSetForm.pageId, pixelId: adSetForm.pixelId || undefined,
        countries: adSetForm.countries.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean),
        interests: parseEntries(adSetForm.interests),
        behaviors: adSetForm.behaviors ? parseEntries(adSetForm.behaviors) : undefined,
        narrowInterests: adSetForm.narrowInterests ? parseEntries(adSetForm.narrowInterests) : undefined,
        cities: adSetForm.cities ? parseCities(adSetForm.cities) : undefined,
        postcodes: adSetForm.postcodes ? adSetForm.postcodes.split(",").map((x) => x.trim()).filter(Boolean) : undefined,
        locationTypes: adSetForm.locationTypes ? adSetForm.locationTypes.split(",").map((x) => x.trim()).filter(Boolean) : undefined,
        locales: adSetForm.locales ? adSetForm.locales.split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0) : undefined,
        demographics: (adSetForm.eduStatuses || adSetForm.relStatuses || adSetForm.lifeEvents || adSetForm.workPositions) ? { educationStatuses: adSetForm.eduStatuses.split(",").map((x) => Number(x.trim())).filter((n) => n > 0), relationshipStatuses: adSetForm.relStatuses.split(",").map((x) => Number(x.trim())).filter((n) => n > 0), lifeEvents: adSetForm.lifeEvents ? parseEntries(adSetForm.lifeEvents) : [], workPositions: adSetForm.workPositions ? parseEntries(adSetForm.workPositions) : [] } : undefined,
        targetingExpansion: expansion || undefined,
        bidStrategy: adSetForm.bidStrategy || undefined,
        bidAmount: adSetForm.bidStrategy === "bid_cap" ? adSetForm.bidAmount || undefined : undefined,
        costPerResultGoal: adSetForm.bidStrategy === "cost_cap" ? adSetForm.costPerResultGoal || undefined : undefined,
        roasGoal: adSetForm.bidStrategy === "roas_goal" ? adSetForm.roasGoal || undefined : undefined,
        conversionEvent: adSetForm.conversionEvent || undefined,
        catalogRecordId: adSetForm.catalogRecordId || undefined,
        productSetId: adSetForm.productSetId || undefined,
        leadFormId: adSetForm.leadFormId || undefined,
        destinationType: adSetForm.destinationType || undefined,
        whatsappIntegrationId: adSetForm.destinationType === "WHATSAPP" ? adSetForm.whatsappIntegrationId || undefined : undefined,
        customAudienceIds: adSetForm.audienceIds.split(",").map((x) => x.trim()).filter(Boolean),
        excludedAudienceIds: adSetForm.excludeIds.split(",").map((x) => x.trim()).filter(Boolean),
        platforms: placements.platforms.length ? placements.platforms : undefined,
        positions: placements.positions.length ? placements.positions : undefined,
        devices: placements.devices.length ? placements.devices : undefined,
        startTime: adSetStart ? new Date(adSetStart).toISOString() : undefined,
        endTime: adSetEnd ? new Date(adSetEnd).toISOString() : undefined,
      }),
    }));
    if (res) { setAdSetForm(emptyAdSetForm); setExpansion(false); setPlacements({ platforms: [], positions: [], devices: [] }); setAdSetStart(""); setAdSetEnd(""); await loadPlan(plan.id); }
  }

  async function addAd(adSetId: string) {
    if (!orgId || !plan) return;
    const f = adForms[adSetId];
    if (!f?.name || !f?.primaryText || !f?.linkUrl) { setError("Ad এর নাম, Primary Text ও Link লাগবে"); return; }
    const carouselCards = f.format === "carousel"
      ? f.carouselText.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
          const [title, linkUrl, imageUrl] = l.split("|").map((x) => x?.trim());
          return { title: title ?? "", linkUrl: linkUrl ?? "", imageUrl: imageUrl || undefined };
        })
      : undefined;
    const lines = (v: string) => v.split("\n").map((x) => x.trim()).filter(Boolean);
    const primaryTexts = [f.primaryText, ...lines(f.extraTexts)];
    const headlines = [f.headline, ...lines(f.extraHeadlines)].filter(Boolean);
    const descriptions = lines(f.descriptions);
    const textOptions = (primaryTexts.length > 1 || headlines.length > 1 || descriptions.length > 0)
      ? { primaryTexts, ...(headlines.length ? { headlines } : {}), ...(descriptions.length ? { descriptions } : {}) }
      : undefined;
    const placements: Record<string, Record<string, string>> = {};
    if (f.feedAssetId) placements.feed = { imageAssetId: f.feedAssetId };
    if (f.verticalAssetId || f.verticalVideoAssetId) placements.vertical = { ...(f.verticalAssetId ? { imageAssetId: f.verticalAssetId } : {}), ...(f.verticalVideoAssetId ? { videoAssetId: f.verticalVideoAssetId } : {}) };
    const placementAssets = Object.keys(placements).length ? placements : undefined;
    const creativeEnhancements = Object.keys(f.enhancements).length ? f.enhancements : undefined;
    // CN13: the CTWA welcome experience — only meaningful on a
    // WhatsApp-destination ad set; sent only when the merchant
    // actually wrote something (the API normalizes + caps).
    const parentSet = plan.adSets.find((s) => s.id === adSetId);
    const iceBreakers = f.waIce.split("\n").map((x) => x.trim()).filter(Boolean);
    const whatsappWelcome = parentSet?.destinationType === "WHATSAPP" && (f.waGreeting.trim() || f.waPrefill.trim() || iceBreakers.length)
      ? { greetingText: f.waGreeting.trim() || undefined, prefillMessage: f.waPrefill.trim() || undefined, iceBreakers: iceBreakers.length ? iceBreakers : undefined }
      : undefined;
    const payload = {
      name: f.name, primaryText: f.primaryText, headline: f.headline || undefined, linkUrl: f.linkUrl,
      imageUrl: f.imageUrl || undefined, format: f.format,
      imageAssetId: f.format === "link" && f.imageAssetId ? f.imageAssetId : undefined,
      videoAssetId: f.format === "video" ? f.videoAssetId || undefined : undefined,
      carouselCards, textOptions, placementAssets, creativeEnhancements, whatsappWelcome,
    };
    const res = await wrap(`ad-${adSetId}`, () => apiFetch(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets/${adSetId}/ads`, { method: "POST", body: JSON.stringify(payload) }));
    if (res) { setAdForms((s) => ({ ...s, [adSetId]: emptyAdForm })); await loadPlan(plan.id); }
  }

  const setAdField = (adSetId: string, field: keyof AdForm, value: string) =>
    setAdForms((s) => ({ ...s, [adSetId]: { ...(s[adSetId] ?? emptyAdForm), [field]: value } }));

  async function generateCopy(adSetId: string) {
    if (!orgId || !plan) return;
    const productId = copySelection[adSetId];
    if (!productId) { setError("AI Copy এর জন্য একটি প্রোডাক্ট বেছে নিন"); return; }
    const res = await wrap(`copy-${adSetId}`, () => apiFetch<{ created: unknown[]; provider: string }>(`/organizations/${orgId}/campaign-plans/${plan.id}/generate-copy`, { method: "POST", body: JSON.stringify({ adSetId, productId }) }));
    if (res) { setNotice(`AI Copy তৈরি হয়েছে (${res.provider === "dev-template" ? "Dev Template" : res.provider})। Draft Ad হিসেবে যোগ হয়েছে, চাইলে মুছে নিজের লেখা দিন।`); await loadPlan(plan.id); }
  }

  async function action(name: string, key: string, body?: unknown) {
    if (!orgId || !plan) return;
    const res = await wrap(key, () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/${name}`, { method: "POST", body: body ? JSON.stringify(body) : undefined }));
    if (res) {
      setPlan(res);
      if ((res as Plan).approvalState?.awaitingSecond) setNotice("প্রথম অনুমোদন সম্পন্ন — দ্বিতীয় অনুমোদন বাকি (অন্য একজন Approver লাগবে)।");
      apiFetch<NonNullable<typeof lastActivity>>(`/organizations/${orgId}/campaign-plans/${plan.id}/last-activity`).then(setLastActivity).catch(() => undefined);
    }
  }

  async function rejectPlan() {
    const reason = window.prompt("প্রত্যাখ্যানের কারণ লিখুন:");
    if (reason) await action("reject", "reject", { reason });
  }

  // NB7 CN15: open the experiments panel — this plan's
  // experiments plus the A/B siblings the create form offers
  // (from the EXISTING ab-tests/list board, the group that
  // matches this plan's abGroupId, minus the plan itself).
  async function openExperiments() {
    if (!orgId || !plan) return;
    const res = await wrap("exps", () => apiFetch<ExperimentRow[]>(`/organizations/${orgId}/campaign-plans/${plan.id}/experiments`));
    if (res) setExperiments(res);
    const ab = await apiFetch<any[]>(`/organizations/${orgId}/campaign-plans/ab-tests/list`).catch(() => null);
    if (ab) {
      const group = (Array.isArray(ab) ? ab : []).find((g: any) => g.groupId === plan.abGroupId);
      const vars = ((group?.variants ?? []) as any[]).filter((v) => v.planId !== plan.id).map((v) => ({ planId: v.planId, name: v.name, variant: v.variant ?? null, status: v.status ?? null }));
      setExpSiblings(vars);
      setExpForm((f) => ({ ...f, planBId: f.planBId || vars[0]?.planId || "", metricEvent: f.metricEvent || plan.adSets[0]?.conversionEvent || "PURCHASE" }));
    }
  }

  async function createExperiment() {
    if (!orgId || !plan) return;
    if (!expForm.planBId) { setError("Variant B বেছে নিন — আগে A/B Variant তৈরি করুন"); return; }
    const created = await wrap("exp-create", () => apiFetch<ExperimentRow>(`/organizations/${orgId}/campaign-plans/experiments`, {
      method: "POST",
      body: JSON.stringify({ planAId: plan.id, planBId: expForm.planBId, splitA: Number(expForm.splitA), metricEvent: expForm.metricEvent || undefined, durationDays: Number(expForm.durationDays) }),
    }));
    if (created) {
      setExperiments((s) => [created, ...(s ?? [])]);
      setNotice(`Meta Experiment তৈরি হয়েছে (Study ID ${created.metaStudyId ?? "—"}) — Campaign দুটি আগের মতোই PAUSED/Published অবস্থায় আছে, Experiment কিছু Publish করে না।`);
    }
  }

  async function refreshExperiment(exp: ExperimentRow) {
    if (!orgId) return;
    const res = await wrap(`exp-refresh-${exp.id}`, () => apiFetch<ExpReadback>(`/organizations/${orgId}/campaign-plans/experiments/${exp.id}/refresh`, { method: "POST" }));
    if (res) {
      setExpReadbacks((s) => ({ ...s, [exp.id]: res }));
      if (res.experiment) setExperiments((s) => (s ?? []).map((x) => (x.id === exp.id ? { ...x, ...res.experiment } : x)));
    }
  }

  // NB7 CN16: series panel — this plan's series (as source).
  async function openSeries() {
    if (!orgId || !plan) return;
    const res = await wrap("series", () => apiFetch<SeriesRow[]>(`/organizations/${orgId}/campaign-plans/${plan.id}/series`));
    if (res) setSeriesList(res);
  }

  async function createSeries() {
    if (!orgId || !plan) return;
    const cadence = seriesForm.cadence;
    const dates = cadence === "dates"
      ? seriesForm.datesText.split("\n").map((x) => x.trim()).filter(Boolean).map((x) => { const d = new Date(x); return Number.isNaN(d.getTime()) ? x : d.toISOString(); })
      : undefined;
    const created = await wrap("series-create", () => apiFetch<SeriesRow>(`/organizations/${orgId}/campaign-plans/${plan.id}/series`, {
      method: "POST",
      body: JSON.stringify({
        name: seriesForm.name || undefined,
        cadence,
        interval: cadence === "dates" ? undefined : Number(seriesForm.interval),
        anchorDate: cadence === "dates" ? undefined : seriesForm.anchor ? new Date(seriesForm.anchor).toISOString() : undefined,
        dates,
        leadDays: Number(seriesForm.leadDays),
      }),
    }));
    if (created) {
      setSeriesList((s) => [created, ...(s ?? [])]);
      setSeriesForm({ name: "", cadence: "weekly", interval: 1, anchor: "", datesText: "", leadDays: 3 });
      setNotice(`Series তৈরি হয়েছে: "${created.name}" — Instance গুলো Draft হিসেবে তৈরি হবে, প্রতিটি আলাদাভাবে Approval Flow দিয়ে যাবে।`);
    }
  }

  async function doSeriesAction(id: string, act: "pause" | "resume" | "end") {
    if (!orgId) return;
    const res = await wrap(`series-${act}-${id}`, () => apiFetch<SeriesRow>(`/organizations/${orgId}/campaign-plans/series/${id}`, { method: "PATCH", body: JSON.stringify({ action: act }) }));
    if (res) setSeriesList((s) => (s ?? []).map((x) => (x.id === id ? res : x)));
  }

  // NB7 CN15: one experiment's read-back block. Meta's study
  // + cells render VERBATIM (labelled as Meta's own words);
  // local totals are the API's raw synced numbers beside
  // the API's own note — no winner is ever named here.
  const renderExpReadback = (exp: ExperimentRow) => {
    const rb: ExpReadback | null = expReadbacks[exp.id] ?? (exp.lastReadback ? { metaVerbatim: exp.lastReadback as ExpReadback["metaVerbatim"], localNumbers: null } : null);
    if (!rb) return null;
    const study: any = rb.metaVerbatim?.study ?? null;
    const cells: any[] = Array.isArray(rb.metaVerbatim?.cells) ? (rb.metaVerbatim?.cells as any[]) : [];
    const cellCampaigns = (c: any): string => {
      const arr = Array.isArray(c?.campaigns) ? c.campaigns : [];
      return arr.map((x: any) => (typeof x === "string" ? x : x?.id ?? "")).filter(Boolean).join(", ");
    };
    const totalsCol = (label: string, t: any) => (
      <div className="rounded bg-white/70 p-2">
        <p className="font-semibold">{label}</p>
        {!t ? <p className="text-slate-400">Local Totals নেই (Sync হওয়া ডেটা নেই)।</p> : (<>
          <p>খরচ: <b>{fmtTotalsSpend(t)}</b> · Conversions: <b>{t.conversions ?? "—"}</b></p>
          <p>Impressions: <b>{t.impressions?.toLocaleString?.() ?? t.impressions ?? "—"}</b> · Clicks: <b>{t.clicks?.toLocaleString?.() ?? t.clicks ?? "—"}</b></p>
        </>)}
      </div>
    );
    return (
      <div className="space-y-2">
        {study ? (
          <div className="space-y-0.5 rounded bg-white p-2 text-xs text-slate-700">
            <p className="font-semibold">Meta-র নিজের তথ্য (Verbatim)</p>
            <p>নাম: {study.name ?? "—"} · ধরন: {study.type ?? "—"}</p>
            <p>শুরু: {fmtStudyTime(study.start_time)} · শেষ: {fmtStudyTime(study.end_time)} · ফলাফল প্রথম পাওয়া যাবে: {fmtStudyTime(study.results_first_available_date)}</p>
            {cells.length ? (
              <div className="pt-1">
                <p className="font-semibold">Cells — Meta-র নিজের তথ্য (Verbatim)</p>
                {cells.map((c, i) => (
                  <p key={c?.id ?? i}>{c?.name ?? `Cell ${i + 1}`} · Treatment: {c?.treatment_percentage ?? "—"}%{cellCampaigns(c) ? ` · Campaign: ${cellCampaigns(c)}` : ""}</p>
                ))}
              </div>
            ) : null}
            <details className="pt-1">
              <summary className="cursor-pointer font-medium">Meta Study-র সম্পূর্ণ Raw Response (JSON)</summary>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-slate-50 p-2">{JSON.stringify(study, null, 1)}</pre>
            </details>
          </div>
        ) : <p className="text-xs text-slate-500">Meta-র Verbatim Read-back এখনো পাওয়া যায়নি।</p>}
        {rb.localNumbers ? (
          <div className="space-y-1">
            <div className="grid gap-2 sm:grid-cols-2 text-xs text-slate-700">
              {totalsCol("Variant A — Local Totals", rb.localNumbers.planA)}
              {totalsCol("Variant B — Local Totals", rb.localNumbers.planB)}
            </div>
            {rb.localNumbers.note ? <p className="text-xs text-slate-500">{rb.localNumbers.note}</p> : null}
          </div>
        ) : null}
      </div>
    );
  };

  // CN10: guided steps are presentation — the rail scrolls to the
  // section that already owns the controls; nothing is remounted.
  const CBX_STEPS = [
    { label: "Objective", anchor: "cbx-step-objective" },
    { label: "Audience", anchor: "cbx-step-audience" },
    { label: "Budget / Bidding", anchor: "cbx-step-budget" },
    { label: "Creative", anchor: "cbx-step-creative" },
    { label: "Review / Readiness", anchor: "cbx-step-review" },
  ];
  const goStep = (i: number) => {
    setActiveStep(i);
    document.getElementById(CBX_STEPS[i].anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const stepRail = (
    <nav className="cbx-step-rail" aria-label="Campaign Builder ধাপ">
      {CBX_STEPS.map((s, i) => (
        <button key={s.label} type="button" className={`cbx-step-btn ${activeStep === i ? "cbx-step-btn-active" : ""}`} onClick={() => goStep(i)}>
          <span className="cbx-step-num">{i + 1}</span> {s.label}
        </button>
      ))}
    </nav>
  );

  const inputCls = "input mt-1";

  if (!plan) {
    return (
      <div className="space-y-6 pb-24 lg:pb-0">
        {stepRail}
        <div id="cbx-step-objective">
          <h1 className="page-title">Campaign Builder</h1>
          <p className="text-sm text-slate-500">নতুন Plan তৈরি করুন। এটি শুধুই Draft, Meta তে কিছু যাবে না অনুমোদন ও Publish ছাড়া।</p>
        </div>
        {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        <form id="cbx-create-form" onSubmit={createPlan} className="space-y-3 card p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-sm">Plan এর নাম<input className={inputCls} value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} required placeholder="Eid Sale 2026" /></label>
            <label className="block text-sm">Objective
              <select className={inputCls} value={createForm.objective} onChange={(e) => setCreateForm({ ...createForm, objective: e.target.value })}>
                <option value="OUTCOME_SALES">Sales</option><option value="OUTCOME_TRAFFIC">Traffic</option>
                <option value="OUTCOME_LEADS">Leads</option><option value="OUTCOME_ENGAGEMENT">Engagement</option><option value="OUTCOME_AWARENESS">Awareness</option>
              </select>
            </label>
            <label className="block text-sm">Meta Ad Account
              <select className={inputCls} value={createForm.adAccountId} onChange={(e) => setCreateForm({ ...createForm, adAccountId: e.target.value })} required>
                <option value="">বেছে নিন</option>
                {accounts.filter((a) => a.platform === "meta").map((a) => <option key={a.id} value={a.id}>{a.name} ({a.sourceType === "api" ? "API connected" : "CSV/manual - publish হবে না"}) · Status: {a.platformStatusBucket ?? "unknown"}</option>)}
              </select>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-sm">Budget Mode (CN2)
              <select className={inputCls} value={createForm.budgetMode} onChange={(e) => setCreateForm({ ...createForm, budgetMode: e.target.value })}>
                <option value="abo">ABO — বাজেট Ad Set এ</option>
                <option value="cbo">CBO — বাজেট Campaign এ</option>
              </select>
            </label>
            {createForm.budgetMode === "cbo" ? <>
              <label className="block text-sm">Campaign দৈনিক বাজেট (টাকা)<input className={inputCls} value={createForm.campaignDailyBudget} onChange={(e) => setCreateForm({ ...createForm, campaignDailyBudget: e.target.value })} placeholder="2000" /></label>
              <label className="block text-sm">Campaign Lifetime বাজেট (টাকা)<input className={inputCls} value={createForm.campaignLifetimeBudget} onChange={(e) => setCreateForm({ ...createForm, campaignLifetimeBudget: e.target.value })} placeholder="ঐচ্ছিক" /></label>
            </> : <p className="col-span-2 self-end text-xs text-slate-400">CBO বেছে নিলে বাজেট Campaign পর্যায়ে যাবে — Ad Set গুলোতে আলাদা বাজেট লাগবে না। ABO তে প্রতিটি Ad Set নিজের বাজেট বহন করে (আগের আচরণ)।</p>}
          </div>
          <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>Draft Plan তৈরি করুন</button>
          <p className="text-xs text-slate-400">Publish করতে হলে Ad Account টি Meta API দিয়ে কানেক্ট করা থাকতে হবে (Advertising Accounts পেজ)। CSV/Manual অ্যাকাউন্টে Publish হবে না, সার্ভারই আটকে দেবে।</p>
        </form>

        {blueprints.length > 0 ? (
          <div className="card space-y-3 p-5">
            <div className="font-semibold">⚡ Blueprint দিয়ে শুরু করুন</div>
            <p className="text-xs text-slate-400">তৈরি কাঠামো থেকে Draft তৈরি হয় — বাজেটসহ সব মান পরে বদলাতে পারবেন। বাজেটগুলো শুরুর মান মাত্র, কোনো পারফরম্যান্স ডেটার ভিত্তিতে সাজেস্ট করা নয়।</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <select className="input" value={bpForm.blueprintKey} onChange={(e) => setBpForm({ ...bpForm, blueprintKey: e.target.value })}>
                <option value="">Blueprint বেছে নিন</option>
                {blueprints.map((bp) => <option key={bp.key} value={bp.key}>{bp.name}</option>)}
              </select>
              <select className="input" value={bpForm.productId} onChange={(e) => setBpForm({ ...bpForm, productId: e.target.value })}>
                <option value="">প্রোডাক্ট (ঐচ্ছিক — কপিতে আসল নাম/দাম বসবে)</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {bpForm.blueprintKey ? <p className="text-sm text-slate-500">{blueprints.find((x) => x.key === bpForm.blueprintKey)?.description}</p> : null}
            <button className="btn-secondary btn-sm" disabled={busy !== "" || !bpForm.blueprintKey || !createForm.adAccountId} onClick={async () => {
              const res = await wrap("bp", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/blueprints/instantiate`, { method: "POST", body: JSON.stringify({ blueprintKey: bpForm.blueprintKey, adAccountId: createForm.adAccountId, productId: bpForm.productId || undefined }) }));
              if (res) { setPlan(res); setNotice("Blueprint থেকে Draft তৈরি হয়েছে। Page ID ও Pixel ID Ad Set এ বসিয়ে সম্পূর্ণ করুন।"); }
            }}>{busy === "bp" ? "তৈরি হচ্ছে..." : "Blueprint থেকে Draft বানান"}</button>
            {!createForm.adAccountId ? <p className="text-xs text-amber-600">আগে উপরে Meta Ad Account বেছে নিন।</p> : null}
          </div>
        ) : null}

        <div className="card space-y-3 border-violet-200 p-5">
          <div className="font-semibold">🤖 AI Plan Suggestion <span className="text-xs font-normal text-slate-500">(Campaign Builder CB3)</span></div>
          <p className="text-xs text-slate-500">প্রোডাক্টের আসল দাম, ক্যাটাগরি ও Business Profile থেকে খসড়া তৈরি হবে — বাজেটের ভাগ (৬০/৪০) সার্ভার হিসাব করে, AI শুধু লেখা সাজায়। এটি একটি Draft মাত্র: যাচাই ও সম্পাদনা ছাড়া কিছুই Submit/Publish হবে না। Organization Settings এ Website URL থাকা লাগবে।</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <select className="input" id="ai-product">
              <option value="">প্রোডাক্ট (ঐচ্ছিক)</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input className="input" id="ai-budget" placeholder="মোট দৈনিক বাজেট (টাকা) — যেমন 2000" />
            <input className="input" id="ai-goal" placeholder="লক্ষ্য — যেমন: বিক্রি বাড়ানো / লিড আনা" />
          </div>
          <button className="btn-primary btn-sm" disabled={busy !== "" || !createForm.adAccountId} onClick={async () => {
            const g = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement)?.value ?? "";
            const budget = g("ai-budget");
            if (!budget) { setError("মোট দৈনিক বাজেট লিখুন"); return; }
            const res = await wrap("aisuggest", () => apiFetch<{ plan: Plan; facts: { note: string } }>(`/organizations/${orgId}/campaign-plans/suggest`, {
              method: "POST",
              body: JSON.stringify({ adAccountId: createForm.adAccountId, productId: g("ai-product") || undefined, goal: g("ai-goal") || undefined, totalDailyBudget: budget }),
            }));
            if (res) { setPlan(res.plan); setNotice(`AI খসড়া তৈরি হয়েছে। ${res.facts.note}`); }
          }}>{busy === "aisuggest" ? "খসড়া তৈরি হচ্ছে..." : "🤖 AI খসড়া বানান"}</button>
          {!createForm.adAccountId ? <p className="text-xs text-amber-600">আগে উপরে Meta Ad Account বেছে নিন।</p> : null}
        </div>

        {templates.length > 0 ? (
          <div className="card space-y-2 p-5">
            <div className="font-semibold">⭐ আমার টেমপ্লেট</div>
            {templates.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span>{t.name} <span className="text-xs text-slate-400">· {t.objective}</span></span>
                <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                  const res = await wrap(`tpl-${t.id}`, () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${t.id}/duplicate`, { method: "POST", body: JSON.stringify({}) }));
                  if (res) { setPlan(res); setNotice("টেমপ্লেট থেকে নতুন Draft তৈরি হয়েছে।"); }
                }}>ব্যবহার করুন</button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="cbx-mobile-bar">
          <button type="submit" form="cbx-create-form" className="btn-primary flex-1" disabled={busy !== ""}>Draft Plan তৈরি করুন</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24 lg:pb-0">
      {stepRail}
      <div id="cbx-step-objective" className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">{plan.name}</h1>
          {(plan as any).seriesId ? <p className="mt-1 inline-block rounded bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800">🔁 Series Instance — {(plan as any).seriesInstanceDate ? new Date((plan as any).seriesInstanceDate).toLocaleString("bn-BD") : ""}</p> : null}
          <p className="text-sm text-slate-500">{plan.objective} · অবস্থা: <span className="font-semibold">{STATUS_LABEL[plan.status] ?? plan.status}</span> <span className={`cbx-pill cbx-pill-${plan.status}`}>{STATUS_LABEL[plan.status] ?? plan.status}</span>
            {plan.status === "published" ? <> · Meta অবস্থা: <span className="font-semibold">{plan.metaStatus}</span> · Campaign ID: {plan.externalCampaignId}</> : null}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            💰 মোট দৈনিক বাজেট: <span className="font-semibold">{formatMinor(plan.adSets.reduce((a, s) => a + BigInt(s.dailyBudgetMinor ?? "0"), 0n))}</span>
            {" · "}Lifetime মোট: {formatMinor(plan.adSets.reduce((a, s) => a + BigInt(s.lifetimeBudgetMinor ?? "0"), 0n))}
            {(plan as any).dailyBudgetCapMinor ? <> · 🧢 দৈনিক Cap: {formatMinor(BigInt((plan as any).dailyBudgetCapMinor))}</> : null}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            🧮 Budget Mode (CN2): <span className="font-semibold">{plan.advantagePlus ? "CBO — Advantage+ (Campaign পর্যায়ে)" : plan.budgetMode === "cbo" ? "CBO — বাজেট Campaign পর্যায়ে" : "ABO — বাজেট Ad Set পর্যায়ে"}</span>
            {plan.budgetMode === "cbo" || plan.advantagePlus ? <> · Campaign দৈনিক: {plan.campaignDailyBudgetMinor ? formatMinor(BigInt(plan.campaignDailyBudgetMinor)) : "—"} · Lifetime: {plan.campaignLifetimeBudgetMinor ? formatMinor(BigInt(plan.campaignLifetimeBudgetMinor)) : "—"}</> : null}
          </p>
          {lastActivity?.available ? <p className="mt-1 text-sm text-slate-600">🕘 সর্বশেষ কার্যকলাপ: {lastActivity.actorName ?? "—"}{lastActivity.action ? ` · ${lastActivity.action}` : ""}{lastActivity.at ? ` · ${new Date(lastActivity.at).toLocaleString("bn-BD")}` : ""} <span className="text-xs text-slate-400">(সর্বশেষ রেকর্ড করা কার্যকলাপ — কে এখন অনলাইনে আছেন তা নয়)</span></p> : null}
          {plan.status === "pending_approval" && plan.firstApproverId ? <p className="mt-1 rounded-lg bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-800">প্রথম অনুমোদন সম্পন্ন — দ্বিতীয় অনুমোদন বাকি{plan.firstApprovedAt ? ` (প্রথম অনুমোদন: ${new Date(plan.firstApprovedAt).toLocaleString("bn-BD")})` : ""}</p> : null}
          {plan.publishAt ? <p className="mt-1 rounded-lg bg-sky-50 px-3 py-1.5 text-sm text-sky-800">🚀 Launch নির্ধারিত: {new Date(plan.publishAt).toLocaleString("bn-BD")} — সময় হলে Publish হবে (PAUSED অবস্থায়)।</p> : null}
          {perf ? (
            <div className="mt-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm">
              <p className="font-semibold">📊 এই Plan এর পারফরম্যান্স (আসল সিঙ্ক হওয়া ডেটা)</p>
              {!perf.totals ? <p className="text-xs text-slate-500">কোনো Metric ডেটা নেই।</p> : (
                <>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span>খরচ: <b>{formatMinor(BigInt(perf.totals.spendMinor))}</b></span>
                    <span>Impressions: <b>{perf.totals.impressions.toLocaleString()}</b></span>
                    <span>Clicks: <b>{perf.totals.clicks.toLocaleString()}</b></span>
                    <span>CTR: <b>{perf.totals.ctrPercent ?? "—"}%</b></span>
                    <span>Conversions: <b>{perf.totals.conversions}</b></span>
                    <span>CPA: <b>{perf.totals.cpaMinor ? formatMinor(BigInt(perf.totals.cpaMinor)) : "—"}</b></span>
                    <span>নিজস্ব অর্ডার: <b>{perf.totals.firstPartyOrders}</b> · Revenue: <b>{formatMinor(BigInt(perf.totals.firstPartyRevenueMinor))}</b></span>
                    <span>ROAS: <b>{perf.totals.roas ?? "—"}</b></span>
                  </div>
                  {perf.perAdSet.filter((s) => s.spendMinor !== "0").map((s) => (
                    <div key={s.adSetId} className="text-xs text-slate-600">{s.name}: খরচ {formatMinor(BigInt(s.spendMinor))} · {s.impressions.toLocaleString()} imp · {s.conversions} conv</div>
                  ))}
                </>
              )}
            </div>
          ) : null}
          {plan.status === "published" ? (
          <div className="mt-2 rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm">
            <p className="font-semibold">🔗 Client Report Link <span className="text-xs font-normal text-slate-400">(CN18 — এই Plan-এর Totals + Breakdowns + Pacing; অভ্যন্তরীণ মন্তব্য/অনুমোদনের তথ্য যায় না)</span></p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select className="input w-36" id="share-days">
                <option value="7">শেষ ৭ দিন</option>
                <option value="30">শেষ ৩০ দিন</option>
                <option value="90">শেষ ৯০ দিন</option>
              </select>
              <select className="input w-44" id="share-exp">
                <option value="7">Link-এর মেয়াদ ৭ দিন</option>
                <option value="30">Link-এর মেয়াদ ৩০ দিন</option>
                <option value="90">Link-এর মেয়াদ ৯০ দিন</option>
              </select>
              <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                const days = Number((document.getElementById("share-days") as HTMLSelectElement)?.value ?? 30);
                const expiresInDays = Number((document.getElementById("share-exp") as HTMLSelectElement)?.value ?? 30);
                const res = await wrap("share-create", () => apiFetch<{ token: string }>(`/organizations/${orgId}/report-shares`, { method: "POST", body: JSON.stringify({ title: `Campaign Report — ${plan.name}`, kind: "campaign", planId: plan.id, days, expiresInDays }) }));
                if (res?.token) { setShareLink(`${window.location.origin}/r/${res.token}`); setNotice("Client Report Link তৈরি হয়েছে — মেয়াদ শেষ হলে বা Reports পেজ থেকে বাতিল করলে Link আর কাজ করবে না।"); }
              }}>Link তৈরি করুন</button>
            </div>
            {shareLink ? <p className="mt-2 break-all text-xs text-violet-800">{shareLink}</p> : null}
          </div>
          ) : null}
          {waConvs ? (
            <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
              <p className="font-semibold">💬 WhatsApp কথোপকথন (CN13) — মোট শুরু হওয়া কথোপকথন: <b>{waConvs.available ? waConvs.totalConversations ?? 0 : "—"}</b></p>
              {!waConvs.available ? <p className="text-xs text-slate-500">পাওয়া যাচ্ছে না: {waConvs.reason ?? ""}</p> : waConvs.perAd.length === 0 ? <p className="text-xs text-slate-500">Publish হওয়া কোনো Ad এখনো নেই — কথোপকথন গোনা হবে Publish এর পর, WhatsApp Webhook এ আসা কথোপকথন থেকে।</p> : waConvs.perAd.map((a) => (
                <div key={a.adId} className="text-xs text-slate-600">{a.name} ({a.adSetName}): <b>{a.conversationsStarted}</b>টি কথোপকথন শুরু</div>
              ))}
              <p className="mt-1 text-xs text-slate-400">{waConvs.label}</p>
            </div>
          ) : null}
          {pacing ? (
            <div className="mt-2 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm">
              <p className="font-semibold">⏱ Pacing (CN2) — খরচের গতি</p>
              {pacing.status === "no_data" ? <p className="text-xs text-slate-500">কোনো Metric Row নেই — Sync হওয়া ডেটা ছাড়া Pacing হিসাব হয় না।</p> : (
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span>এ পর্যন্ত খরচ: <b>{formatMinor(BigInt(pacing.spentMinor))}</b></span>
                  <span>আজ পর্যন্ত প্রত্যাশিত: <b>{pacing.expectedMinor != null ? formatMinor(BigInt(pacing.expectedMinor)) : "—"}</b></span>
                  <span>পার্থক্য: <b>{pacing.varianceMinor != null ? formatMinor(BigInt(pacing.varianceMinor)) : "—"}</b></span>
                  <span>দিন: <b>{pacing.daysElapsed ?? "—"}{pacing.daysTotal ? ` / ${pacing.daysTotal}` : ""}</b></span>
                  <span>Mode: <b>{pacing.budgetMode ?? "—"}</b></span>
                </div>
              )}
              <p className="mt-1 text-xs text-slate-400">DailyAdMetric এর আসল Campaign-level Row থেকে হিসাব করা — এটি Forecast বা Meta এর সংখ্যা নয়।</p>
            </div>
          ) : null}
          {breakdowns ? (
            <div className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm">
              <p className="font-semibold">📈 Breakdown (CN7) — Ads Sync-এর সংরক্ষিত Row থেকে</p>
              {!breakdowns.published ? <p className="text-xs text-slate-500">Plan টি এখনো Publish হয়নি।</p> : (
                <div className="mt-1 grid gap-2 md:grid-cols-2">
                  {([["age", "বয়স"], ["gender", "লিঙ্গ"], ["placement", "Placement"], ["device", "Device"]] as const).map(([dim, label]) => {
                    const d = breakdowns.dimensions[dim];
                    return (
                      <div key={dim} className="rounded-lg bg-white/60 p-2">
                        <p className="text-xs font-semibold">{label}</p>
                        {!d || !d.hasData ? <p className="text-xs text-slate-400">কোনো ডেটা নেই — Breakdown Sync হলে এখানে আসবে।</p> : d.rows.slice(0, 6).map((r) => (
                          <div key={r.key} className="text-xs text-slate-600">{r.key}: খরচ {formatMinor(BigInt(r.spendMinor))} · {r.impressions.toLocaleString()} imp · {r.clicks.toLocaleString()} clicks · {r.conversions} conv · CPA {r.cpaMinor ? formatMinor(BigInt(r.cpaMinor)) : "—"}</div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
          {creativeInsights ? (
            <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm">
              <p className="font-semibold">🎨 Creative Insights (CN7) — Leaderboard + Fatigue</p>
              <p className="text-xs text-slate-500">{creativeInsights.rule}</p>
              {creativeInsights.ads.length === 0 ? <p className="text-xs text-slate-500">Publish হওয়া কোনো Ad নেই।</p> : creativeInsights.ads.map((a) => (
                <div key={a.adId} className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-700">
                  <span className="font-medium">{a.name}</span>
                  {!a.hasData ? <span className="text-slate-400">সিঙ্ক হওয়া ডেটা নেই</span> : (<>
                    <span>খরচ {formatMinor(BigInt(a.spendMinor))}</span><span>CTR {a.ctrPercent ?? "—"}%</span>
                    <span>Frequency {a.frequency ?? "—"}</span><span>CPA {a.cpaMinor ? formatMinor(BigInt(a.cpaMinor)) : "—"}</span>
                    {a.fatigued ? <span className="rounded bg-red-100 px-1.5 py-0.5 font-semibold text-red-700">😫 Fatigued — CTR ↓{a.ctrDropPercent}%</span> : null}
                  </>)}
                </div>
              ))}
            </div>
          ) : null}
          {recs ? (
            <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="font-semibold">💡 সুপারিশ (CN7) — Deterministic Heuristic, আসল ডেটা থেকে</p>
              <p className="text-xs text-slate-500">Dead Ad Set ধরা হয় খরচ ≥ {formatMinor(BigInt(recs.thresholds.deadAdSetSpendMinor))} ও Conversion 0 হলে; Budget Shift প্রস্তাব {recs.thresholds.budgetShiftPercent}%। কোনো সুপারিশ নিজে থেকে কিছু বদলায় না।</p>
              {recs.recommendations.length === 0 ? <p className="mt-1 text-xs text-emerald-700">এখনকার ডেটায় কোনো সুপারিশ নেই।</p> : recs.recommendations.map((r, i) => (
                <div key={i} className="mt-2 rounded-lg bg-white/70 p-2 text-xs text-slate-700">
                  {r.type === "fatigued_creative" ? (<>
                    <p>😫 <b>{r.name}</b> — Creative ক্লান্ত: Frequency {r.evidence.frequency}, CTR কমেছে {r.evidence.ctrDropPercent}%, খরচ {formatMinor(BigInt(r.evidence.spendMinor))}।</p>
                    <button className="btn-secondary btn-sm mt-1" disabled={busy !== ""} onClick={async () => {
                      const res = await wrap(`rec-fresh-${r.adId}`, () => apiFetch<{ draftId: string; note: string }>(`/organizations/${orgId}/campaign-plans/${plan.id}/recommendations/apply`, { method: "POST", body: JSON.stringify({ kind: "create_fresh_draft", adId: r.adId }) }));
                      if (res) setNotice(res.note);
                    }}>📝 Fresh Creative Draft তৈরি করুন</button>
                  </>) : r.type === "dead_ad_set" ? (<>
                    <p>🪦 <b>{r.name}</b> — খরচ {formatMinor(BigInt(r.evidence.spendMinor))}, {r.evidence.impressions.toLocaleString()} Impression, কিন্তু Conversion 0।</p>
                    <button className="btn-warning btn-sm mt-1" disabled={busy !== ""} onClick={async () => {
                      const res = await wrap(`rec-pause-${r.adSetId}`, () => apiFetch(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets/${r.adSetId}/status`, { method: "POST", body: JSON.stringify({ target: "PAUSED" }) }));
                      if (res) { setNotice("Meta নিশ্চিত করেছে — Ad Set টি Pause হয়েছে।"); await loadPlan(plan.id); }
                    }}>⏸ এই Ad Set Pause করুন (Meta-তে)</button>
                  </>) : r.type === "budget_shift" ? (<>
                    <p>💸 <b>Budget Shift প্রস্তাব:</b> "{r.evidence.donorName}" (CPA {r.evidence.donorCpaMinor ? formatMinor(BigInt(r.evidence.donorCpaMinor)) : "—"}, {r.evidence.donorConversions} conv) থেকে "{r.evidence.winnerName}" (CPA {formatMinor(BigInt(r.evidence.winnerCpaMinor))}, {r.evidence.winnerConversions} conv)-এ দৈনিক {formatMinor(BigInt(r.proposal.shiftMinor))} সরান — Donor {formatMinor(BigInt(r.proposal.fromDailyAfterMinor))}, Winner {formatMinor(BigInt(r.proposal.toDailyAfterMinor))} হবে।</p>
                    <p className="mt-0.5 text-slate-500">প্রয়োগ করতে সংশ্লিষ্ট Ad Set-এর "💰 বাজেট আপডেট"-এ নতুন মান বসান — এটি শুধু প্রস্তাব, কিছুই বদলায়নি।</p>
                  </>) : null}
                </div>
              ))}
            </div>
          ) : null}
          {guardrails ? (
            <div className="mt-2 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm">
              <p className="font-semibold">🛡 Automation Guardrails (CN7)</p>
              <p className="text-xs text-slate-500">Rule Engine অপরিবর্তিত — Attach মানে Rule টি শুধু এই Plan-এর জন্য নির্দিষ্ট হলো; Detach মানে তা আবার সব Published Plan-এর জন্য প্রযোজ্য।</p>
              {guardrails.linked.length === 0 ? <p className="mt-1 text-xs text-slate-500">এই Plan-এ নির্দিষ্ট কোনো Rule নেই।</p> : guardrails.linked.map((r) => (
                <div key={r.id} className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-700">
                  <span className="font-medium">{r.name}</span><span>{r.metric} {r.comparator} {r.threshold} ({r.windowDays} দিন) → {r.action}</span>
                  <span>{r.enabled ? "চালু" : "বন্ধ"}</span>
                  <span>শেষ Trigger: {r.lastTriggeredAt ? new Date(r.lastTriggeredAt).toLocaleString("bn-BD") : "কখনো নয়"}{r.lastRun ? ` · ${r.lastRun.status}${r.lastRun.detail ? `: ${r.lastRun.detail}` : ""}` : ""}</span>
                  <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                    const res = await wrap(`gr-detach-${r.id}`, () => apiFetch<NonNullable<typeof guardrails>>(`/organizations/${orgId}/campaign-plans/${plan.id}/guardrails/detach`, { method: "POST", body: JSON.stringify({ ruleId: r.id }) }));
                    if (res) setGuardrails(res);
                  }}>Detach (সব Plan-এর জন্য)</button>
                </div>
              ))}
              {guardrails.orgWide.length ? <p className="mt-2 text-xs font-semibold text-slate-600">Org-wide Rule (এই Plan-কেও কভার করে):</p> : null}
              {guardrails.orgWide.map((r) => (
                <div key={r.id} className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-700">
                  <span className="font-medium">{r.name}</span><span>{r.metric} {r.comparator} {r.threshold} → {r.action}</span><span>{r.enabled ? "চালু" : "বন্ধ"}</span>
                  <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                    const res = await wrap(`gr-attach-${r.id}`, () => apiFetch<NonNullable<typeof guardrails>>(`/organizations/${orgId}/campaign-plans/${plan.id}/guardrails/attach`, { method: "POST", body: JSON.stringify({ ruleId: r.id }) }));
                    if (res) setGuardrails(res);
                  }}>শুধু এই Plan-এ Attach করুন</button>
                </div>
              ))}
            </div>
          ) : null}
          {creativeHealth ? (
            <div className="mt-2 space-y-1 rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm">
              <p className="font-semibold">🎨 Creative Health ({creativeHealth.adsChecked}টি Ad)</p>
              {creativeHealth.findings.length === 0 ? <p className="text-xs text-emerald-700">কোনো সতর্কতা নেই।</p> : creativeHealth.findings.map((f, i) => (
                <div key={i} className="text-xs"><span className={f.level === "error" ? "font-semibold text-red-700" : "font-semibold text-amber-700"}>{f.level === "error" ? "✗" : "⚠"} {f.adName}:</span> <span className="text-slate-600">{f.message}</span></div>
              ))}
              <p className="text-xs text-slate-400">এসব Heuristic পরামর্শ — Meta এর রায় নয়।</p>
            </div>
          ) : null}
          {plan.rejectionReason ? <p className="text-sm text-red-600">প্রত্যাখ্যানের কারণ: {plan.rejectionReason}</p> : null}
          {plan.status === "published" ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {plan.metaEffectiveStatus ? <span className={plan.metaEffectiveStatus === "ACTIVE" ? "badge badge-success" : plan.metaEffectiveStatus === "PAUSED" ? "badge badge-muted" : "badge badge-danger"}>Meta কার্যকর অবস্থা: {plan.metaEffectiveStatus}</span> : null}
              <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                const res = await wrap("statussync", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/status-sync`, { method: "POST" }));
                if (res) { setPlan(res); setNotice(res.healthIssues?.length ? `Meta অবস্থা আনা হয়েছে — ${res.healthIssues.length}টি সমস্যা পাওয়া গেছে।` : "Meta অবস্থা আনা হয়েছে — কোনো সমস্যা নেই।"); }
              }}>🔄 Meta অবস্থা যাচাই{plan.lastStatusSyncAt ? ` (সর্বশেষ ${new Date(plan.lastStatusSyncAt).toLocaleString("bn-BD")})` : ""}</button>
            </div>
          ) : null}
          {preflight && preflight.findings.length > 0 ? (
            <div className="mt-2 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="font-semibold">🛡 Policy Pre-flight ফলাফল ({preflight.checkedAds}টি বিজ্ঞাপন যাচাই হয়েছে)</p>
              {preflight.findings.map((f, i) => (
                <div key={i} className="rounded-lg bg-white p-2">
                  <span className={f.severity === "high" ? "badge badge-danger" : f.severity === "medium" ? "badge badge-muted" : "badge badge-success"}>{f.severity}</span>{" "}
                  <b>{f.adName}</b> ({f.field}): “{f.snippet}”<br />
                  <span className="text-slate-600">{f.explanation}</span><br />
                  <span className="text-green-700">পরামর্শ: {f.suggestion}</span>
                </div>
              ))}
              <p className="text-xs text-slate-500">Pre-flight পাস করা মানে Meta অনুমোদনের নিশ্চয়তা নয় — এটি প্রতিরোধযোগ্য Reject এর কারণ সরায়।</p>
            </div>
          ) : null}
          {plan.healthIssues && plan.healthIssues.length > 0 ? (
            <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <p className="font-semibold">⚠️ Meta তে সমস্যা:</p>
              <ul className="mt-1 list-inside list-disc">{plan.healthIssues.map((h, i) => <li key={i}>{h.level}: {h.name} — {h.status}</li>)}</ul>
            </div>
          ) : null}
        </div>
        <div id="cbx-step-budget" className="flex flex-wrap gap-2">
          <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("dup", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/duplicate`, { method: "POST", body: JSON.stringify({}) }));
            if (res) { setPlan(res); setNotice("Plan এর কপি তৈরি হয়েছে (নতুন Draft, কোনো Meta ID নেই)।"); }
          }}>📋 কপি করুন</button>
          <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("pf", () => apiFetch<{ checkedAds: number; findings: { adName: string; field: string; severity: string; snippet: string; explanation: string; suggestion: string }[]; summary: { high: number; medium: number; low: number } }>(`/organizations/${orgId}/campaign-plans/${plan.id}/preflight`, { method: "POST" }));
            if (res) {
              setPreflight(res);
              setNotice(res.findings.length === 0 ? `Policy যাচাই শেষ — ${res.checkedAds}টি বিজ্ঞাপনে কোনো সমস্যা পাওয়া যায়নি।` : `Policy যাচাই: উচ্চ ${res.summary.high}, মাঝারি ${res.summary.medium}, নিম্ন ${res.summary.low} — নিচে বিস্তারিত।`);
            }
          }}>🛡 Policy যাচাই</button>
          <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("ready", () => apiFetch<NonNullable<typeof readiness>>(`/organizations/${orgId}/campaign-plans/${plan.id}/readiness`, { method: "POST", body: JSON.stringify({}) }));
            if (res) { setReadiness(res); setNotice(res.ready ? "Readiness যাচাই: সব ঠিক আছে।" : "Readiness যাচাই: সমস্যা পাওয়া গেছে — উপরে দেখুন।"); }
          }}>✅ Readiness যাচাই</button>
          <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("chealth", () => apiFetch<NonNullable<typeof creativeHealth>>(`/organizations/${orgId}/campaign-plans/${plan.id}/creative-health`, { method: "POST", body: JSON.stringify({}) }));
            if (res) { setCreativeHealth(res); setNotice(res.findings.length === 0 ? `Creative Health: ${res.adsChecked}টি Ad এ কোনো সতর্কতা নেই।` : `Creative Health: ${res.findings.length}টি সতর্কতা — নিচে দেখুন।`); }
          }}>🎨 Creative Health</button>
          {editable ? (
            <span className="flex items-center gap-1">
              <select className="input w-32" id="plan-bmode" defaultValue={plan.budgetMode ?? "abo"}>
                <option value="abo">ABO</option><option value="cbo">CBO</option>
              </select>
              <input className="input w-28" placeholder="Campaign দৈনিক (টাকা)" id="plan-cdaily" defaultValue={plan.campaignDailyBudgetMinor ? String(Number(plan.campaignDailyBudgetMinor) / 100) : ""} />
              <input className="input w-28" placeholder="Campaign Lifetime" id="plan-clife" defaultValue={plan.campaignLifetimeBudgetMinor ? String(Number(plan.campaignLifetimeBudgetMinor) / 100) : ""} />
              <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                const mode = (document.getElementById("plan-bmode") as HTMLSelectElement)?.value ?? "abo";
                const d = (document.getElementById("plan-cdaily") as HTMLInputElement)?.value ?? "";
                const l = (document.getElementById("plan-clife") as HTMLInputElement)?.value ?? "";
                const res = await wrap("bmode", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}`, { method: "PATCH", body: JSON.stringify({ budgetMode: mode, campaignDailyBudget: d, campaignLifetimeBudget: l }) }));
                if (res) { setPlan(res); setNotice("Budget Mode/Campaign Budget সেভ হয়েছে — Publish এর সময় এই কাঠামোই যাবে।"); }
              }}>🧮 Budget Mode</button>
            </span>
          ) : null}
          {editable ? (
            <span className="flex items-center gap-1">
              <input className="input w-28" placeholder="দৈনিক Cap (টাকা)" id="plan-cap" defaultValue={(plan as any).dailyBudgetCapMinor ? String(Number((plan as any).dailyBudgetCapMinor) / 100) : ""} />
              <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                const v = (document.getElementById("plan-cap") as HTMLInputElement)?.value ?? "";
                const res = await wrap("cap", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}`, { method: "PATCH", body: JSON.stringify({ dailyBudgetCap: v }) }));
                if (res) { setPlan(res); setNotice(v ? "দৈনিক Budget Cap সেট হয়েছে — Submit/Publish এ যাচাই হবে।" : "Budget Cap সরানো হয়েছে।"); }
              }}>🧢 Cap</button>
            </span>
          ) : null}
          <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("ab", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/ab-variant`, { method: "POST", body: JSON.stringify({}) }));
            if (res) { setPlan(res); setNotice("A/B Variant তৈরি হয়েছে (নতুন Draft)। দুটি Plan Publish করে সমান বাজেটে চালান — ফলাফল Analytics পেজে।"); }
          }}>🧪 A/B Variant তৈরি</button>
          <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("tpl", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/duplicate`, { method: "POST", body: JSON.stringify({ asTemplate: true }) }));
            if (res) setNotice(`"${res.name}" টেমপ্লেট হিসেবে সেভ হয়েছে।`);
          }}>⭐ টেমপ্লেট হিসেবে সেভ</button>
          {!plan.externalCampaignId ? <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("adv", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/advantage-plus`, { method: "POST", body: JSON.stringify({ enabled: !plan.advantagePlus }) }));
            if (res) { setPlan(res); setNotice(res.advantagePlus ? "Advantage+ চালু হয়েছে — Publish এর সময় বাজেট Campaign পর্যায়ে যাবে এবং Meta নিজে Audience প্রসারিত করবে।" : "Advantage+ বন্ধ করা হয়েছে — বাজেট Ad Set পর্যায়ে থাকবে।"); }
          }}>{plan.advantagePlus ? "🤖 Advantage+ চালু আছে (বন্ধ করুন)" : "🤖 Advantage+ চালু করুন"}</button> : null}
          {editable ? <button className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => action("submit", "submit")}>অনুমোদনের জন্য পাঠান</button> : null}
          {plan.status === "pending_approval" ? <>
            <button className="btn-success btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => action("approve", "approve")}>Approve করুন (Owner/Admin)</button>
            <button className="rounded-lg border px-3 py-2 text-sm font-semibold text-red-600" onClick={rejectPlan}>Reject</button>
          </> : null}
          {(plan.status === "approved" || plan.status === "publish_failed") ? <button className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => action("publish", "publish")}>{busy === "publish" ? "Publish হচ্ছে..." : plan.status === "publish_failed" ? "আবার Publish চেষ্টা (Resume)" : "Meta তে Publish করুন (PAUSED)"}</button> : null}
          {plan.status === "approved" ? (
            <span className="flex items-center gap-1">
              <input type="datetime-local" className="input w-52" id="launch-at" defaultValue={plan.publishAt ? String(plan.publishAt).slice(0, 16) : ""} />
              <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                const v = (document.getElementById("launch-at") as HTMLInputElement)?.value;
                if (!v) { setError("Launch এর সময় বেছে নিন"); return; }
                const res = await wrap("launch", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/schedule-launch`, { method: "POST", body: JSON.stringify({ publishAt: new Date(v).toISOString() }) }));
                if (res) { setPlan(res); setNotice("Launch নির্ধারিত হয়েছে — সময় হলে স্বয়ংক্রিয়ভাবে Publish হবে (PAUSED)।"); }
              }}>🚀 Launch নির্ধারণ</button>
              {plan.publishAt ? <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                const res = await wrap("launch-cancel", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/schedule-launch`, { method: "POST", body: JSON.stringify({ publishAt: null }) }));
                if (res) { setPlan(res); setNotice("Launch এর সূচি বাতিল হয়েছে।"); }
              }}>বাতিল</button> : null}
            </span>
          ) : null}
          <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={openSeries}>🔁 Series</button>
          {plan.abGroupId ? <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("promote", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/promote-winner`, { method: "POST", body: JSON.stringify({}) }));
            if (res) { setPlan(res); setNotice("বিজয়ী Variant থেকে নতুন Draft তৈরি হয়েছে। Loser টি Pause করা হয়নি — চাইলে আলাদাভাবে করুন।"); }
          }}>🏆 Winner থেকে Draft</button> : null}
          {plan.externalCampaignId ? <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("perf", () => apiFetch<NonNullable<typeof perf>>(`/organizations/${orgId}/campaign-plans/${plan.id}/performance`));
            if (res) setPerf(res);
          }}>📊 পারফরম্যান্স</button> : null}
          {plan.externalCampaignId ? <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("waconv", () => apiFetch<NonNullable<typeof waConvs>>(`/organizations/${orgId}/campaign-plans/${plan.id}/whatsapp-conversations`));
            if (res) setWaConvs(res);
          }}>💬 WhatsApp কথোপকথন (CN13)</button> : null}
          {plan.abGroupId ? <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={openExperiments}>🧪 Meta Experiment</button> : null}
          {plan.externalCampaignId ? <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("pacing", () => apiFetch<NonNullable<typeof pacing>>(`/organizations/${orgId}/campaign-plans/${plan.id}/pacing`));
            if (res) setPacing(res);
          }}>⏱ Pacing</button> : null}
          {plan.externalCampaignId ? <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const b = await wrap("bdowns", () => apiFetch<NonNullable<typeof breakdowns>>(`/organizations/${orgId}/campaign-plans/${plan.id}/performance-breakdowns`));
            if (b) setBreakdowns(b);
            const c = await wrap("cinsights", () => apiFetch<NonNullable<typeof creativeInsights>>(`/organizations/${orgId}/campaign-plans/${plan.id}/creative-insights`));
            if (c) setCreativeInsights(c);
          }}>📈 Breakdown + Creative (CN7)</button> : null}
          {plan.externalCampaignId ? <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("recs", () => apiFetch<NonNullable<typeof recs>>(`/organizations/${orgId}/campaign-plans/${plan.id}/recommendations`));
            if (res) setRecs(res);
          }}>💡 সুপারিশ (CN7)</button> : null}
          <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("guardrails", () => apiFetch<NonNullable<typeof guardrails>>(`/organizations/${orgId}/campaign-plans/${plan.id}/guardrails`));
            if (res) setGuardrails(res);
            const acc = await apiFetch<typeof accountsHealth>(`/organizations/${orgId}/campaign-plans/accounts/health`).catch(() => null);
            if (acc) setAccountsHealth(acc);
          }}>🛡 Guardrails (CN7)</button>
          {plan.status === "published" && plan.metaStatus !== "ACTIVE" ? <button className="btn-success btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => action("activate", "activate")}>সক্রিয় করুন (খরচ শুরু হবে)</button> : null}
          {plan.status === "published" && plan.metaStatus === "ACTIVE" ? <button className="btn-warning btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => action("pause", "pause")}>Pause করুন</button> : null}
        </div>
      </div>
      {experiments ? (
        <div className="space-y-3 rounded-xl border border-fuchsia-200 bg-fuchsia-50 p-3 text-sm">
          <p className="font-semibold">🧪 Meta Experiment (CN15) — Meta Ad Study (SPLIT_TEST)</p>
          <p className="text-xs text-slate-500">দুটি Published Variant Campaign এর উপর Meta নিজে Study চালায় — Experiment তৈরি করলে Campaign দুটির অবস্থা বদলায় না, কিছু Publish হয় না। Significance/Winner এই Platform হিসাব করে না; Meta-র Read-back হুবহু দেখানো হয়।</p>
          <div className="space-y-2 rounded-lg bg-white/60 p-3">
            <div className="text-xs font-semibold text-slate-600">নতুন Experiment তৈরি করুন</div>
            {expSiblings.length === 0 ? <p className="text-xs font-medium text-amber-700">আগে A/B Variant তৈরি করুন — এই Plan এর A/B Group এ অন্য কোনো Variant পাওয়া যায়নি।</p> : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <label className="block text-xs">Variant B (অন্য Plan)
                  <select className="input mt-1" value={expForm.planBId} onChange={(e) => setExpForm({ ...expForm, planBId: e.target.value })}>
                    <option value="">Variant বেছে নিন</option>
                    {expSiblings.map((v) => <option key={v.planId} value={v.planId}>{v.name}{v.variant ? ` (Variant ${v.variant})` : ""} · {v.status ?? ""}</option>)}
                  </select>
                </label>
                <label className="block text-xs">Split — A এর শতাংশ (১০–৯০)<input type="number" min={10} max={90} className="input mt-1" value={expForm.splitA} onChange={(e) => setExpForm({ ...expForm, splitA: Number(e.target.value) })} /></label>
                <label className="block text-xs">Metric Event<input className="input mt-1" value={expForm.metricEvent} onChange={(e) => setExpForm({ ...expForm, metricEvent: e.target.value })} placeholder="PURCHASE" /></label>
                <label className="block text-xs">মেয়াদ (দিন, ১–৩০)<input type="number" min={1} max={30} className="input mt-1" value={expForm.durationDays} onChange={(e) => setExpForm({ ...expForm, durationDays: Number(e.target.value) })} /></label>
              </div>
            )}
            <button className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== "" || expSiblings.length === 0 || !expForm.planBId} onClick={createExperiment}>{busy === "exp-create" ? "তৈরি হচ্ছে..." : "🧪 Experiment তৈরি করুন (Meta তে)"}</button>
          </div>
          {experiments.length === 0 ? <p className="text-xs text-slate-500">এই Plan এর কোনো Experiment এখনো নেই।</p> : experiments.map((exp) => (
            <div key={exp.id} className="space-y-2 rounded-lg bg-white/70 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{exp.name ?? "Meta Experiment"}</span>
                <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => refreshExperiment(exp)}>🔄 Meta Read-back</button>
              </div>
              <div className="text-xs text-slate-600">Meta Study ID: <span className="font-mono">{exp.metaStudyId ?? "—"}</span> · Split: A {exp.splitA}% / B {100 - Number(exp.splitA)}% · Metric: {exp.metricEvent ?? "—"}</div>
              <div className="text-xs text-slate-600">সময়: {exp.startTime ? new Date(exp.startTime).toLocaleString("bn-BD") : "—"} → {exp.endTime ? new Date(exp.endTime).toLocaleString("bn-BD") : "—"} · সর্বশেষ Read-back: {exp.lastReadbackAt ? new Date(exp.lastReadbackAt).toLocaleString("bn-BD") : "এখনো হয়নি"}</div>
              {exp.significanceNote ? <p className="text-xs text-slate-500">{exp.significanceNote}</p> : null}
              {renderExpReadback(exp)}
            </div>
          ))}
        </div>
      ) : null}
      {seriesList ? (
        <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm">
          <p className="font-semibold">🔁 Recurring Series (CN16) — এই Plan থেকে নিয়মিত Instance</p>
          <p className="text-xs text-slate-500">Series শুধু Draft Instance তৈরি করে — প্রতিটি Instance আলাদাভাবে Approval Flow দিয়ে যাবে; Series নিজে কিছু Publish করে না। আগের Instance Draft-এ থাকলে পরেরটি তৈরি আটকে থাকে (একটির বেশি Pending Draft জমে না)।</p>
          <div className="space-y-2 rounded-lg bg-white/60 p-3">
            <div className="text-xs font-semibold text-slate-600">নতুন Series তৈরি করুন</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block text-xs">নাম (ঐচ্ছিক)<input className="input mt-1" value={seriesForm.name} onChange={(e) => setSeriesForm({ ...seriesForm, name: e.target.value })} placeholder="যেমন: সাপ্তাহিক অফার" /></label>
              <label className="block text-xs">Cadence
                <select className="input mt-1" value={seriesForm.cadence} onChange={(e) => setSeriesForm({ ...seriesForm, cadence: e.target.value })}>
                  <option value="weekly">সাপ্তাহিক</option><option value="monthly">মাসিক</option><option value="dates">তারিখের তালিকা</option>
                </select>
              </label>
              {seriesForm.cadence !== "dates" ? <label className="block text-xs">Interval (প্রতি কত {seriesForm.cadence === "weekly" ? "সপ্তাহ" : "মাস"})<input type="number" min={1} max={12} className="input mt-1" value={seriesForm.interval} onChange={(e) => setSeriesForm({ ...seriesForm, interval: Number(e.target.value) })} /></label> : null}
              {seriesForm.cadence !== "dates" ? <label className="block text-xs">প্রথম Instance এর তারিখ (Anchor)<input type="datetime-local" className="input mt-1" value={seriesForm.anchor} onChange={(e) => setSeriesForm({ ...seriesForm, anchor: e.target.value })} /></label> : null}
              <label className="block text-xs">আগে থেকে তৈরি (Lead Days)<input type="number" min={0} max={30} className="input mt-1" value={seriesForm.leadDays} onChange={(e) => setSeriesForm({ ...seriesForm, leadDays: Number(e.target.value) })} /></label>
            </div>
            {seriesForm.cadence === "dates" ? <label className="block text-xs">তারিখের তালিকা — প্রতি লাইনে একটি তারিখ/সময়<textarea className="input mt-1" rows={3} value={seriesForm.datesText} onChange={(e) => setSeriesForm({ ...seriesForm, datesText: e.target.value })} placeholder={"2026-11-01T10:00\n2026-11-15T10:00"} /></label> : null}
            <button className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={createSeries}>{busy === "series-create" ? "তৈরি হচ্ছে..." : "🔁 Series তৈরি করুন"}</button>
          </div>
          {seriesList.length === 0 ? <p className="text-xs text-slate-500">এই Plan থেকে এখনো কোনো Series তৈরি হয়নি।</p> : seriesList.map((s) => (
            <div key={s.id} className="space-y-1 rounded-lg bg-white/70 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{s.name} <span className={`ml-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${s.status === "active" ? "bg-green-100 text-green-700" : s.status === "paused" ? "bg-amber-100 text-amber-700" : "bg-slate-200 text-slate-600"}`}>{s.status === "active" ? "সক্রিয়" : s.status === "paused" ? "বিরতি" : "শেষ"}</span></span>
                <span className="flex gap-1">
                  {s.status === "active" ? <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => doSeriesAction(s.id, "pause")}>⏸ Pause</button> : null}
                  {s.status === "paused" ? <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => doSeriesAction(s.id, "resume")}>▶ Resume</button> : null}
                  {s.status !== "ended" ? <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => doSeriesAction(s.id, "end")}>⏹ End</button> : null}
                </span>
              </div>
              <div className="text-xs text-slate-600">Cadence: {SERIES_CADENCE_LABEL[s.cadence] ?? s.cadence}{s.cadence !== "dates" && s.interval ? ` (প্রতি ${s.interval})` : ""} · পরের Instance: {s.nextInstanceDate ? new Date(s.nextInstanceDate).toLocaleString("bn-BD") : "—"}{s.pendingPlan ? ` · Pending Instance: ${s.pendingPlan.name} (${s.pendingPlan.status})` : ""}</div>
              {s.generationHeld ? <p className="text-xs font-medium text-amber-700">আগের Instance Draft-এ আছে — সেটি Approval Flow-তে গেলেই পরেরটি তৈরি হবে</p> : null}
            </div>
          ))}
        </div>
      ) : null}
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_330px] lg:items-start lg:gap-5">
      <div className="min-w-0 space-y-6">
      <div id="cbx-step-audience" className="space-y-6">
      <span id="cbx-step-creative" className="block scroll-mt-24" />
      {plan.adSets.map((adSet) => (
        <div key={adSet.id} className="space-y-3 card p-5">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Ad Set: {adSet.name}</div>
            {editable ? (
              <span className="flex gap-1">
                <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                  const opening = editSetId !== adSet.id;
                  setEditSetId(opening ? adSet.id : null);
                  if (opening && adSet.catalogRecordId) {
                    const r = await apiFetch<ProductSetRec[]>(`/organizations/${orgId}/catalogs/${adSet.catalogRecordId}/product-sets`).catch(() => null);
                    if (r) setEditSets(r);
                  }
                }}>✎ সম্পাদনা</button>
                <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                  const res = await wrap(`dupset-${adSet.id}`, () => apiFetch(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets/${adSet.id}/duplicate`, { method: "POST", body: JSON.stringify({}) }));
                  if (res) { setNotice("Ad Set কপি হয়েছে (Ad সহ)।"); await loadPlan(plan.id); }
                }}>⧉ কপি</button>
              </span>
            ) : null}
            {plan.status === "published" && adSet.externalAdSetId ? (
              <span className="flex items-center gap-1">
                <input className="input w-28" placeholder="নতুন দৈনিক বাজেট" id={`budget-${adSet.id}`} />
                <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                  const v = (document.getElementById(`budget-${adSet.id}`) as HTMLInputElement)?.value;
                  if (!v) { setError("নতুন বাজেট লিখুন"); return; }
                  const res = await wrap(`budget-${adSet.id}`, () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets/${adSet.id}/budget`, { method: "POST", body: JSON.stringify({ dailyBudget: v }) }));
                  if (res) { setPlan(res); setNotice("Meta তে বাজেট আপডেট হয়েছে (Meta নিশ্চিত করেছে)।"); }
                }}>💰 বাজেট আপডেট</button>
              </span>
            ) : null}
            <div className="text-xs text-slate-400">
              {adSet.dailyBudgetMinor ? `দৈনিক বাজেট ${formatMinor(BigInt(adSet.dailyBudgetMinor))}` : ""} · {adSet.optimizationGoal} · দেশ: {(adSet.targeting.countries ?? []).join(", ")}
              {adSet.targeting.cities?.length ? ` · শহর: ${adSet.targeting.cities.map((c) => c.key).join(", ")}` : ""}
              {adSet.targeting.locales?.length ? ` · Locale: ${adSet.targeting.locales.join(",")}` : ""}
              {adSet.bidStrategy ? ` · 🎯 ${adSet.bidStrategy}${adSet.bidAmountMinor ? ` ${formatMinor(BigInt(adSet.bidAmountMinor))}` : ""}${adSet.costGoalMinor ? ` ${formatMinor(BigInt(adSet.costGoalMinor))}` : ""}${adSet.roasAverageFloor ? ` ROAS ≥ ${adSet.roasAverageFloor / 10000}` : ""}` : ""}
              {adSet.conversionEvent ? ` · 🎯 Event: ${adSet.conversionEvent}` : ""}
              {adSet.__productSet ? ` · 🛍️ Catalog: ${adSet.__catalog?.name ?? ""} / ${adSet.__productSet.name}` : ""}
              {adSet.__leadForm ? ` · 📋 Form: ${adSet.__leadForm.name} (${adSet.__leadForm.status === "created" ? "Meta তে তৈরি" : "লোকাল"})` : ""}
              {adSet.destinationType === "WHATSAPP" ? ` · 💬 WhatsApp (CTWA): ${adSet.whatsappPhoneNumber ?? "Page-Linked নম্বর (Meta থেকে সংখ্যা পড়া যায়নি)"}` : ""}
              {adSet.externalAdSetId ? ` · Meta ID: ${adSet.externalAdSetId}` : ""}
              {adSet.effectiveStatus ? ` · কার্যকর: ${adSet.effectiveStatus}` : ""}
              {adSet.startTime || adSet.endTime ? ` · 🗓 ${adSet.startTime ? new Date(adSet.startTime).toLocaleString("bn-BD") : "…"} → ${adSet.endTime ? new Date(adSet.endTime).toLocaleString("bn-BD") : "…"}` : ""}
            </div>
            {plan.status === "published" && adSet.externalAdSetId ? (
              <span className="flex items-center gap-1">
                <input type="datetime-local" className="input w-48" id={`sched-start-${adSet.id}`} defaultValue={adSet.startTime ? String(adSet.startTime).slice(0, 16) : ""} />
                <input type="datetime-local" className="input w-48" id={`sched-end-${adSet.id}`} defaultValue={adSet.endTime ? String(adSet.endTime).slice(0, 16) : ""} />
                <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                  const st = (document.getElementById(`sched-start-${adSet.id}`) as HTMLInputElement)?.value;
                  const en = (document.getElementById(`sched-end-${adSet.id}`) as HTMLInputElement)?.value;
                  if (!st && !en) { setError("শুরু বা শেষের সময় দিন"); return; }
                  const res = await wrap(`sched-${adSet.id}`, () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets/${adSet.id}/schedule`, { method: "POST", body: JSON.stringify({ startTime: st ? new Date(st).toISOString() : undefined, endTime: en ? new Date(en).toISOString() : undefined }) }));
                  if (res) { setPlan(res); setNotice("সময়সূচি Meta তে আপডেট হয়েছে।"); }
                }}>🗓 সময়সূচি</button>
              </span>
            ) : null}
            {plan.status === "published" && adSet.externalAdSetId ? (
              <span className="flex items-center gap-1">
                <textarea className="input w-64" rows={1} id={`daypart-${adSet.id}`} placeholder="Dayparting: দিন,শুরু,শেষ — যেমন 5,9,23 (শুক্র ৯টা-২৩টা)" defaultValue={Array.isArray((adSet as any).daypart) ? (adSet as any).daypart.map((w: any) => `${w.day},${w.startHour},${w.endHour}`).join("\n") : ""} />
                <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                  const raw = (document.getElementById(`daypart-${adSet.id}`) as HTMLTextAreaElement)?.value ?? "";
                  const windows = raw.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [day, startHour, endHour] = l.split(",").map((x) => Number(x.trim())); return { day, startHour, endHour }; });
                  const res = await wrap(`dp-${adSet.id}`, () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets/${adSet.id}/daypart`, { method: "POST", body: JSON.stringify({ windows, tz: "Asia/Dhaka" }) }));
                  if (res) { setPlan(res); setNotice("Dayparting সেভ হয়েছে। Dayparting Job (Automations পেজে তৈরি করুন) সময়মতো Ad Set চালু/বন্ধ করবে।"); }
                }}>🌗 Dayparting</button>
              </span>
            ) : null}
          </div>
          {(adSet as any).funnelLayer ? <div><span className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700">🧭 {(adSet as any).funnelLayer} Layer</span></div> : null}
          {(adSet as any).funnelIncomplete ? <p className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">⚠️ অসম্পূর্ণ Layer: {(adSet as any).funnelIncomplete}</p> : null}
          {editable && editSetId === adSet.id ? (
            <div className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
              <div className="text-sm font-semibold">Ad Set সম্পাদনা</div>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <label className="block text-sm">নাম<input className="input" id={`es-name-${adSet.id}`} defaultValue={adSet.name} /></label>
                <label className="block text-sm">দৈনিক বাজেট (টাকা)<input className="input" id={`es-budget-${adSet.id}`} defaultValue={adSet.dailyBudgetMinor ? String(Number(adSet.dailyBudgetMinor) / 100) : ""} placeholder="দৈনিক হলে দিন" /></label>
                <label className="block text-sm">Lifetime বাজেট (টাকা)<input className="input" id={`es-life-${adSet.id}`} defaultValue={adSet.lifetimeBudgetMinor ? String(Number(adSet.lifetimeBudgetMinor) / 100) : ""} placeholder="Lifetime হলে দিন" /></label>
                <label className="block text-sm">দেশ (কমা দিয়ে)<input className="input" id={`es-countries-${adSet.id}`} defaultValue={(adSet.targeting.countries ?? []).join(",")} /></label>
                <label className="block text-sm">Interests (কমা; নাম|ID চলবে)<input className="input" id={`es-interests-${adSet.id}`} defaultValue={(adSet.targeting.interests ?? []).map(entryToken).join(", ")} /></label>
                <label className="block text-sm">Platforms (কমা: facebook,instagram)<input className="input" id={`es-platforms-${adSet.id}`} defaultValue={(adSet.targeting.platforms ?? []).join(",")} placeholder="খালি = Meta Default" /></label>
                <label className="block text-sm">Positions (feed,reels,story,search)<input className="input" id={`es-positions-${adSet.id}`} defaultValue={(adSet.targeting.positions ?? []).join(",")} placeholder="খালি = Meta Default" /></label>
                <label className="block text-sm">Devices (mobile,desktop)<input className="input" id={`es-devices-${adSet.id}`} defaultValue={(adSet.targeting.devices ?? []).join(",")} placeholder="খালি = সব" /></label>
                <label className="block text-sm">শহর Key (কমা; key:km)<input className="input" id={`es-cities-${adSet.id}`} defaultValue={(adSet.targeting.cities ?? []).map((c) => (c.radius ? `${c.key}:${c.radius}` : c.key)).join(",")} /></label>
                <label className="block text-sm">Postcodes (Zip Key)<input className="input" id={`es-postcodes-${adSet.id}`} defaultValue={(adSet.targeting.postcodes ?? []).join(",")} /></label>
                <label className="block text-sm">Location Types<input className="input" id={`es-loctypes-${adSet.id}`} defaultValue={(adSet.targeting.locationTypes ?? []).join(",")} placeholder="home,recent" /></label>
                <label className="block text-sm">Locale IDs<input className="input" id={`es-locales-${adSet.id}`} defaultValue={(adSet.targeting.locales ?? []).join(",")} /></label>
                <label className="block text-sm">Behaviors (নাম|ID)<input className="input" id={`es-behaviors-${adSet.id}`} defaultValue={(adSet.targeting.behaviors ?? []).map(entryToken).join(", ")} /></label>
                <label className="block text-sm">Narrowing Interests (AND)<input className="input" id={`es-narrow-${adSet.id}`} defaultValue={(adSet.targeting.narrowInterests ?? []).map(entryToken).join(", ")} /></label>
                <label className="block text-sm">Life Events (নাম|ID)<input className="input" id={`es-life-${adSet.id}`} defaultValue={(adSet.targeting.demographics?.lifeEvents ?? []).map(entryToken).join(", ")} /></label>
                <label className="block text-sm">Work Positions (নাম|ID)<input className="input" id={`es-work-${adSet.id}`} defaultValue={(adSet.targeting.demographics?.workPositions ?? []).map(entryToken).join(", ")} /></label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" id={`es-expansion-${adSet.id}`} defaultChecked={adSet.targeting.targetingExpansion === true} /> Targeting Expansion</label>
                <label className="block text-sm">Bid Strategy
                  <select className="input" id={`es-bidstrategy-${adSet.id}`} defaultValue={adSet.bidStrategy ?? ""}>
                    <option value="">Lowest Cost</option><option value="bid_cap">Bid Cap</option><option value="cost_cap">Cost Per Result Goal</option><option value="roas_goal">ROAS Goal</option>
                  </select>
                </label>
                <label className="block text-sm">Bid Amount (Bid Cap হলে)<input className="input" id={`es-bidamount-${adSet.id}`} defaultValue={adSet.bidAmountMinor ? String(Number(adSet.bidAmountMinor) / 100) : ""} /></label>
                <label className="block text-sm">Cost Goal (Cost Cap হলে)<input className="input" id={`es-costgoal-${adSet.id}`} defaultValue={adSet.costGoalMinor ? String(Number(adSet.costGoalMinor) / 100) : ""} /></label>
                <label className="block text-sm">ROAS Goal (যেমন 2.0)<input className="input" id={`es-roasgoal-${adSet.id}`} defaultValue={adSet.roasAverageFloor ? String(adSet.roasAverageFloor / 10000) : ""} /></label>
                <label className="block text-sm">Conversion Event (CN3)
                  <select className="input" id={`es-event-${adSet.id}`} defaultValue={adSet.conversionEvent ?? ""}>
                    <option value="">PURCHASE (Default)</option>
                    {[...new Set([...SALES_EVENTS, ...LEAD_EVENTS])].map((ev) => <option key={ev} value={ev}>{ev}</option>)}
                  </select>
                </label>
                <label className="block text-sm">ক্যাটালগ (CN3)
                  <select className="input" id={`es-catalog-${adSet.id}`} defaultValue={adSet.catalogRecordId ?? ""} onChange={async (e) => {
                    const cat = e.target.value;
                    if (!cat) { setEditSets([]); return; }
                    const r = await apiFetch<ProductSetRec[]>(`/organizations/${orgId}/catalogs/${cat}/product-sets`).catch(() => null);
                    if (r) setEditSets(r);
                  }}>
                    <option value="">ক্যাটালগ নয়</option>
                    {catalogs.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.platform})</option>)}
                  </select>
                </label>
                <label className="block text-sm">Product Set
                  <select className="input" id={`es-pset-${adSet.id}`} defaultValue={adSet.productSetId ?? ""}>
                    <option value="">Product Set বেছে নিন</option>
                    {editSets.length === 0 && adSet.__productSet ? <option value={adSet.__productSet.id}>{adSet.__productSet.name} (বর্তমান)</option> : null}
                    {editSets.map((s) => <option key={s.id} value={s.id} disabled={s.status !== "created"}>{s.name} · {s.itemCount} আইটেম{s.status === "created" ? "" : ` (${s.status})`}</option>)}
                  </select>
                </label>
                <label className="block text-sm">Lead Form (CN4)
                  <select className="input" id={`es-leadform-${adSet.id}`} defaultValue={adSet.leadFormId ?? ""}>
                    <option value="">ফর্ম নেই</option>
                    {leadForms.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.status === "created" ? "Meta তে তৈরি" : "লোকাল"})</option>)}
                  </select>
                </label>
                <label className="block text-sm">Destination (CN13 — CTWA)
                  <select className="input" id={`es-dest-${adSet.id}`} defaultValue={adSet.destinationType ?? ""}>
                    <option value="">Website (সাধারণ)</option>
                    <option value="WHATSAPP">WhatsApp — Click-to-WhatsApp</option>
                  </select>
                </label>
                <label className="block text-sm">WhatsApp Connection (Connected টাই চলবে; নম্বর Meta থেকে পড়া হয়)
                  <select className="input" id={`es-wa-${adSet.id}`} defaultValue={adSet.whatsappIntegrationId ?? ""}>
                    <option value="">Connection বেছে নিন</option>
                    {(waDestinations?.destinations ?? []).map((d) => (
                      <option key={d.integrationId} value={d.integrationId} disabled={!d.connected && d.integrationId !== adSet.whatsappIntegrationId}>
                        {d.phoneNumberId ?? "Phone Number ID নেই"} · WABA {d.wabaId ?? "—"}{d.connected ? "" : ` · ${d.status}`}
                      </option>
                    ))}
                  </select>
                  {adSet.destinationType === "WHATSAPP" && adSet.whatsappPhoneNumber ? <span className="mt-0.5 block text-xs text-slate-500">বর্তমান নম্বর (Meta থেকে পড়া): {adSet.whatsappPhoneNumber}</span> : null}
                </label>
              </div>
              <p className="text-xs text-slate-500">বাজেট: দৈনিক বা Lifetime — যেকোনো একটি দিন; দুটোই বদলালে জোড়া হিসেবে Replace হবে।</p>
              <div className="flex gap-2">
                <button className="btn-primary btn-sm" disabled={busy !== ""} onClick={async () => {
                  const g = (id: string) => (document.getElementById(id) as HTMLInputElement)?.value ?? "";
                  const csv = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);
                  const bidStrategy = g(`es-bidstrategy-${adSet.id}`);
                  const body: Record<string, unknown> = {
                    name: g(`es-name-${adSet.id}`),
                    countries: csv(g(`es-countries-${adSet.id}`)).map((c) => c.toUpperCase()),
                    interests: parseEntries(g(`es-interests-${adSet.id}`)),
                    platforms: csv(g(`es-platforms-${adSet.id}`)), positions: csv(g(`es-positions-${adSet.id}`)), devices: csv(g(`es-devices-${adSet.id}`)),
                    cities: parseCities(g(`es-cities-${adSet.id}`)),
                    postcodes: csv(g(`es-postcodes-${adSet.id}`)), locationTypes: csv(g(`es-loctypes-${adSet.id}`)),
                    locales: csv(g(`es-locales-${adSet.id}`)).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0),
                    behaviors: parseEntries(g(`es-behaviors-${adSet.id}`)), narrowInterests: parseEntries(g(`es-narrow-${adSet.id}`)),
                    demographics: { educationStatuses: adSet.targeting.demographics?.educationStatuses ?? [], relationshipStatuses: adSet.targeting.demographics?.relationshipStatuses ?? [], lifeEvents: parseEntries(g(`es-life-${adSet.id}`)), workPositions: parseEntries(g(`es-work-${adSet.id}`)) },
                    targetingExpansion: (document.getElementById(`es-expansion-${adSet.id}`) as HTMLInputElement)?.checked ?? false,
                    bidStrategy: bidStrategy || "lowest_cost",
                    bidAmount: bidStrategy === "bid_cap" ? g(`es-bidamount-${adSet.id}`) : "",
                    costPerResultGoal: bidStrategy === "cost_cap" ? g(`es-costgoal-${adSet.id}`) : "",
                    roasGoal: bidStrategy === "roas_goal" ? g(`es-roasgoal-${adSet.id}`) : "",
                    conversionEvent: g(`es-event-${adSet.id}`) || null,
                    catalogRecordId: g(`es-catalog-${adSet.id}`) || null,
                    productSetId: g(`es-pset-${adSet.id}`) || null,
                    leadFormId: g(`es-leadform-${adSet.id}`) || null,
                    destinationType: g(`es-dest-${adSet.id}`),
                    whatsappIntegrationId: g(`es-dest-${adSet.id}`) === "WHATSAPP" ? g(`es-wa-${adSet.id}`) || null : null,
                  };
                  const d = g(`es-budget-${adSet.id}`); const l = g(`es-life-${adSet.id}`);
                  if (d || l) { body.dailyBudget = d || undefined; body.lifetimeBudget = l || undefined; }
                  const res = await wrap(`es-${adSet.id}`, () => apiFetch(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets/${adSet.id}`, { method: "PATCH", body: JSON.stringify(body) }));
                  if (res) { setEditSetId(null); setNotice("Ad Set আপডেট হয়েছে।"); await loadPlan(plan.id); }
                }}>সংরক্ষণ</button>
                <button className="btn-secondary btn-sm" onClick={() => setEditSetId(null)}>বাতিল</button>
              </div>
            </div>
          ) : null}
          <div className="space-y-2">
            {adSet.ads.map((ad) => (
              <div key={ad.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                <div className="font-medium">{ad.name} {(ad as any).format && (ad as any).format !== "link" ? <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">{(ad as any).format}</span> : null} {ad.createdByAi ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">AI Draft</span> : null} {ad.externalAdId ? <span className="text-xs text-slate-400">Meta ID: {ad.externalAdId}</span> : null} {ad.effectiveStatus ? <span className={ad.effectiveStatus === "ACTIVE" ? "rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-semibold text-green-700" : ad.effectiveStatus === "PAUSED" ? "rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600" : "rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700"}>{ad.effectiveStatus}</span> : null}</div>
                <p className="mt-0.5 whitespace-pre-wrap">{ad.primaryText}</p>
                {ad.headline ? <div className="text-slate-500">Headline: {ad.headline}</div> : null}
                <a className="text-xs text-blue-600" href={ad.linkUrl} target="_blank" rel="noreferrer">{ad.linkUrl}</a>
                {ad.textOptions && (ad.textOptions.primaryTexts.length > 1 || ad.textOptions.headlines.length > 1 || ad.textOptions.descriptions.length > 0) ? <div className="mt-0.5 text-xs text-indigo-600">✍️ Creative v2: {ad.textOptions.primaryTexts.length}টি Text · {ad.textOptions.headlines.length}টি Headline · {ad.textOptions.descriptions.length}টি Description অপশন</div> : null}
                {ad.placementAssets?.placements?.feed || ad.placementAssets?.placements?.vertical ? <div className="text-xs text-indigo-600">🖼️ Placement Asset: {ad.placementAssets.placements.feed ? "Feed Override" : ""}{ad.placementAssets.placements.feed && ad.placementAssets.placements.vertical ? " · " : ""}{ad.placementAssets.placements.vertical ? "Stories/Reels Override" : ""}</div> : null}
                {ad.creativeEnhancements && Object.entries(ad.creativeEnhancements).some(([, v]) => v) ? <div className="text-xs text-indigo-600">✨ Enhancements ON: {Object.entries(ad.creativeEnhancements).filter(([, v]) => v).map(([k]) => k).join(", ")}</div> : null}
                {ad.whatsappWelcome?.greetingText || ad.whatsappWelcome?.prefillMessage || ad.whatsappWelcome?.iceBreakers?.length ? <div className="text-xs text-emerald-700">💬 WhatsApp Welcome: {ad.whatsappWelcome?.greetingText ? `“${ad.whatsappWelcome.greetingText}”` : ""}{ad.whatsappWelcome?.iceBreakers?.length ? ` · Ice Breaker ${ad.whatsappWelcome.iceBreakers.length}টি` : ad.whatsappWelcome?.prefillMessage ? ` · Prefill: “${ad.whatsappWelcome.prefillMessage}”` : ""}</div> : null}
                <div className="mt-1">
                  <button className="rounded border bg-white px-2 py-0.5 text-xs" onClick={() => setPreviewAdId(previewAdId === ad.id ? null : ad.id)}>👁 Preview</button>
                </div>
                {previewAdId === ad.id ? <AdPreview ad={ad} pageName={plan.name} /> : null}
                {editable ? (
                  <div className="mt-1 flex gap-1">
                    <button className="rounded border bg-white px-2 py-0.5 text-xs" disabled={busy !== ""} onClick={() => setEditAdId(editAdId === ad.id ? null : ad.id)}>✎ সম্পাদনা</button>
                    <button className="rounded border bg-white px-2 py-0.5 text-xs" disabled={busy !== ""} onClick={async () => {
                      const res = await wrap(`dupad-${ad.id}`, () => apiFetch(`/organizations/${orgId}/campaign-plans/${plan.id}/ads/${ad.id}/duplicate`, { method: "POST", body: JSON.stringify({}) }));
                      if (res) { setNotice("Ad কপি হয়েছে।"); await loadPlan(plan.id); }
                    }}>⧉ কপি</button>
                    <button className="rounded border bg-white px-2 py-0.5 text-xs" onClick={() => setVariantAdId(variantAdId === ad.id ? null : ad.id)}>🏗 Variant (Library/Studio Asset)</button>
                  </div>
                ) : null}
                {editable && variantAdId === ad.id ? (
                  <div className="mt-2 space-y-2 rounded-lg border border-teal-200 bg-white p-3">
                    <div className="text-xs font-semibold text-teal-700">এই Ad এর Variant — Creative Library বা Creative Studio/Social Asset থেকে (লেখা ও Enhancement কপি হবে; Placement Override হবে না)</div>
                    <div className="flex flex-wrap gap-2">
                      <select className="input flex-1" id={`va-lib-${ad.id}`}>
                        <option value="">Creative Library Asset বেছে নিন</option>
                        {assets.filter((x) => x.status === "ready" && x.adAccountId === plan.adAccountId).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.kind})</option>)}
                      </select>
                      <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                        const assetId = (document.getElementById(`va-lib-${ad.id}`) as HTMLSelectElement)?.value ?? "";
                        if (!assetId) { setError("Library Asset বেছে নিন"); return; }
                        const res = await wrap(`variant-${ad.id}`, () => apiFetch(`/organizations/${orgId}/campaign-plans/${plan.id}/ads/${ad.id}/variant`, { method: "POST", body: JSON.stringify({ creativeAssetId: assetId }) }));
                        if (res) { setVariantAdId(null); setNotice("Variant Ad তৈরি হয়েছে।"); await loadPlan(plan.id); }
                      }}>Variant তৈরি করুন</button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <select className="input flex-1" id={`va-media-${ad.id}`}>
                        <option value="">Creative Studio / Social Media Asset (শুধু ছবি)</option>
                        {mediaAssets.filter((m) => m.kind === "image").map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                      <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                        const assetId = (document.getElementById(`va-media-${ad.id}`) as HTMLSelectElement)?.value ?? "";
                        if (!assetId) { setError("Media Asset বেছে নিন"); return; }
                        const res = await wrap(`variant-${ad.id}`, () => apiFetch(`/organizations/${orgId}/campaign-plans/${plan.id}/ads/${ad.id}/variant`, { method: "POST", body: JSON.stringify({ mediaAssetId: assetId }) }));
                        if (res) { setVariantAdId(null); setNotice("Variant Ad তৈরি হয়েছে।"); await loadPlan(plan.id); }
                      }}>Variant তৈরি করুন</button>
                    </div>
                    <p className="text-[11px] text-slate-500">ভিডিও Media Asset থেকে Variant হয় না — Meta ভিডিও Ad এর জন্য Meta-side Video ID লাগে; Creative Library তে Upload করা ভিডিও ব্যবহার করুন।</p>
                  </div>
                ) : null}
                {editable && editAdId === ad.id ? (
                  <div className="mt-2 space-y-2 rounded-lg border border-indigo-200 bg-white p-3">
                    <input className="input" id={`ea-name-${ad.id}`} defaultValue={ad.name} placeholder="Ad এর নাম" />
                    <textarea className="input" rows={3} id={`ea-text-${ad.id}`} defaultValue={ad.primaryText} placeholder="Primary Text" />
                    <input className="input" id={`ea-headline-${ad.id}`} defaultValue={ad.headline ?? ""} placeholder="Headline" />
                    <input className="input" id={`ea-link-${ad.id}`} defaultValue={ad.linkUrl} placeholder="Link URL" />
                    <div className="space-y-2 rounded-lg bg-indigo-50 p-2">
                      <div className="text-xs font-semibold text-indigo-700">Creative v2 (CN5) — অপশনগুলো প্রতি লাইনে একটি; প্রথম লাইনটাই মূল লেখা</div>
                      <textarea className="input" rows={3} id={`ea-primaries-${ad.id}`} defaultValue={(ad.textOptions?.primaryTexts ?? [ad.primaryText]).join("\n")} placeholder="Primary Text অপশনসমূহ (সর্বোচ্চ ৫)" />
                      <textarea className="input" rows={2} id={`ea-headlines-${ad.id}`} defaultValue={(ad.textOptions?.headlines ?? (ad.headline ? [ad.headline] : [])).join("\n")} placeholder="Headline অপশনসমূহ (সর্বোচ্চ ৫)" />
                      <textarea className="input" rows={2} id={`ea-descs-${ad.id}`} defaultValue={(ad.textOptions?.descriptions ?? (ad.description ? [ad.description] : [])).join("\n")} placeholder="Description অপশনসমূহ (সর্বোচ্চ ২)" />
                      <div className="flex flex-wrap gap-2">
                        <select className="input flex-1" id={`ea-feed-${ad.id}`} defaultValue={ad.placementAssets?.placements?.feed?.imageAssetId ?? ""}>
                          <option value="">Feed Placement ছবি (Override নেই)</option>
                          {assets.filter((x) => x.kind === "image" && x.status === "ready" && x.adAccountId === plan.adAccountId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                        <select className="input flex-1" id={`ea-vertical-${ad.id}`} defaultValue={ad.placementAssets?.placements?.vertical?.imageAssetId ?? ""}>
                          <option value="">Stories/Reels ছবি (Override নেই)</option>
                          {assets.filter((x) => x.kind === "image" && x.status === "ready" && x.adAccountId === plan.adAccountId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                        <select className="input flex-1" id={`ea-verticalvideo-${ad.id}`} defaultValue={ad.placementAssets?.placements?.vertical?.videoAssetId ?? ""}>
                          <option value="">Stories/Reels ভিডিও (Override নেই)</option>
                          {assets.filter((x) => x.kind === "video" && x.status === "ready" && x.adAccountId === plan.adAccountId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {CN5_ENHANCEMENTS.map((enh) => (
                          <label key={enh.key} className="flex items-center gap-1 text-xs"><input type="checkbox" id={`ee-${ad.id}-${enh.key}`} defaultChecked={!!ad.creativeEnhancements?.[enh.key]} /> {enh.label}</label>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button className="btn-primary btn-sm" disabled={busy !== ""} onClick={async () => {
                        const g = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement)?.value ?? "";
                        const gs = (id: string) => (document.getElementById(id) as HTMLSelectElement)?.value ?? "";
                        const lines = (v: string) => v.split("\n").map((x) => x.trim()).filter(Boolean);
                        const placements: Record<string, Record<string, string>> = {};
                        if (gs(`ea-feed-${ad.id}`)) placements.feed = { imageAssetId: gs(`ea-feed-${ad.id}`) };
                        const vv = gs(`ea-verticalvideo-${ad.id}`); const vi = gs(`ea-vertical-${ad.id}`);
                        if (vi || vv) placements.vertical = { ...(vi ? { imageAssetId: vi } : {}), ...(vv ? { videoAssetId: vv } : {}) };
                        const creativeEnhancements: Record<string, boolean> = {};
                        for (const enh of CN5_ENHANCEMENTS) creativeEnhancements[enh.key] = (document.getElementById(`ee-${ad.id}-${enh.key}`) as HTMLInputElement)?.checked ?? false;
                        const res = await wrap(`ea-${ad.id}`, () => apiFetch(`/organizations/${orgId}/campaign-plans/${plan.id}/ads/${ad.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({
                            name: g(`ea-name-${ad.id}`), linkUrl: g(`ea-link-${ad.id}`),
                            textOptions: { primaryTexts: lines(g(`ea-primaries-${ad.id}`)), headlines: lines(g(`ea-headlines-${ad.id}`)), descriptions: lines(g(`ea-descs-${ad.id}`)) },
                            placementAssets: placements, creativeEnhancements,
                          }),
                        }));
                        if (res) { setEditAdId(null); setNotice("Ad আপডেট হয়েছে।"); await loadPlan(plan.id); }
                      }}>সংরক্ষণ</button>
                      <button className="btn-secondary btn-sm" onClick={() => setEditAdId(null)}>বাতিল</button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
            {adSet.ads.length === 0 ? <p className="text-sm text-slate-400">কোনো Ad নেই</p> : null}
          </div>
          <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
            <div className="text-sm font-semibold">🎯 Audience Studio <span className="text-xs font-normal text-slate-400">(Campaign Builder Next CN6 — বিদ্যমান Audiences সিস্টেম দিয়েই)</span></div>
            {!studio ? <p className="text-xs text-slate-500">Studio তথ্য লোড হয়নি।</p> : studio.available === false ? <p className="text-xs text-amber-700">পাওয়া যাচ্ছে না: {studio.reason}</p> : (
              <>
                {(adSet.targeting.exclusionPresets ?? []).length > 0 ? (
                  <div className="text-xs text-slate-600">🚫 সক্রিয় Exclusion Preset: {(adSet.targeting.exclusionPresets ?? []).map((p) => <span key={p.key} className="mr-1 rounded bg-white px-1.5 py-0.5 font-medium">{p.name}</span>)}</div>
                ) : null}
                {editable ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-slate-600">Exclusion Preset:</span>
                    {studio.presets.map((p) => (
                      <button key={p.key} className="rounded border bg-white px-2 py-0.5 text-xs" disabled={busy !== ""} onClick={async () => {
                        const res = await wrap(`preset-${adSet.id}-${p.key}`, () => apiFetch<{ status: string; reason?: string }>(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets/${adSet.id}/audiences/exclusion-preset`, { method: "POST", body: JSON.stringify({ preset: p.key }) }));
                        if (res) { if (res.status === "applied") setNotice(`Preset প্রয়োগ হয়েছে: ${p.name}`); else setError(`Preset প্রয়োগ হয়নি: ${res.reason ?? "পাওয়া যাচ্ছে না"}`); await loadPlan(plan.id); }
                      }}>{p.name}</button>
                    ))}
                  </div>
                ) : null}
                <div className="grid gap-1">
                  {studio.sources.map((s) => (
                    <div key={s.key} className="flex flex-wrap items-center justify-between gap-2 rounded bg-white px-2 py-1 text-xs">
                      <span>{s.label} — {s.available ? `${(s.contactCount ?? 0).toLocaleString()}টি Contact` : <span className="text-amber-700">পাওয়া যাচ্ছে না: {s.reason}</span>}</span>
                      {editable && s.available ? (
                        <button className="rounded border px-2 py-0.5 font-semibold" disabled={busy !== ""} onClick={async () => {
                          const source = s.key.startsWith("recent_purchasers") ? "recent_purchasers" : s.key.startsWith("rfm_") ? "rfm_segment" : s.key;
                          const res = await wrap(`studio-${adSet.id}-${s.key}`, () => apiFetch<{ attached: boolean }>(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets/${adSet.id}/audiences/create`, { method: "POST", body: JSON.stringify({ source, segment: s.segment ?? undefined, name: s.label, attach: true }) }));
                          if (res) { setNotice(res.attached ? `Audience তৈরি হয়ে এই Ad Set এ যোগ হয়েছে: ${s.label}` : `Audience তৈরি হয়েছে, কিন্তু Meta ID ছাড়া যোগ করা যায়নি: ${s.label}`); await loadPlan(plan.id); }
                        }}>তৈরি করুন + যোগ করুন</button>
                      ) : null}
                    </div>
                  ))}
                </div>
                {editable ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-slate-600">Lookalike:</span>
                    <select className="input w-56" id={`lk-src-${adSet.id}`}>
                      <option value="">Source Audience বেছে নিন</option>
                      {studio.audiences.filter((a) => a.externalAudienceId).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.kind})</option>)}
                    </select>
                    <input className="input w-20" id={`lk-country-${adSet.id}`} defaultValue="BD" placeholder="দেশ (BD)" />
                    <select className="input w-28" id={`lk-ratio-${adSet.id}`} defaultValue="0.01">
                      <option value="0.01">1%</option><option value="0.03">3%</option><option value="0.05">5%</option><option value="0.1">10%</option>
                    </select>
                    <button className="rounded border bg-white px-2 py-1 text-xs font-semibold" disabled={busy !== ""} onClick={async () => {
                      const src = (document.getElementById(`lk-src-${adSet.id}`) as HTMLSelectElement)?.value ?? "";
                      const country = (document.getElementById(`lk-country-${adSet.id}`) as HTMLInputElement)?.value.trim().toUpperCase() ?? "";
                      const ratio = Number((document.getElementById(`lk-ratio-${adSet.id}`) as HTMLSelectElement)?.value ?? "0.01");
                      const srcName = studio.audiences.find((a) => a.id === src)?.name ?? "Audience";
                      if (!src) { setError("Lookalike এর Source Audience বেছে নিন"); return; }
                      const res = await wrap(`lk-${adSet.id}`, () => apiFetch<{ attached: boolean }>(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets/${adSet.id}/audiences/lookalike`, { method: "POST", body: JSON.stringify({ sourceAudienceRecordId: src, name: `${srcName} — Lookalike ${country} ${Math.round(ratio * 100)}%`, country, ratio, attach: true }) }));
                      if (res) { setNotice(res.attached ? "Lookalike তৈরি হয়ে যোগ হয়েছে।" : "Lookalike তৈরি হয়েছে, কিন্তু Meta ID ছাড়া যোগ করা যায়নি।"); await loadPlan(plan.id); }
                    }}>Lookalike তৈরি + যোগ</button>
                  </div>
                ) : null}
                <div>
                  <button className="rounded border bg-white px-2 py-0.5 text-xs" disabled={busy !== ""} onClick={async () => {
                    const res = await wrap(`ins-${adSet.id}`, () => apiFetch<AudienceInsights>(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets/${adSet.id}/audience-insights`));
                    if (res) setInsights((s) => ({ ...s, [adSet.id]: res }));
                  }}>📊 Audience Size ও Overlap দেখুন</button>
                  {insights[adSet.id] ? (
                    <div className="mt-1 space-y-0.5 text-xs text-slate-600">
                      {insights[adSet.id].included.map((a) => <div key={a.externalAudienceId}>অন্তর্ভুক্ত: {a.name ?? a.externalAudienceId} — Size: {a.size != null ? a.size.toLocaleString() : "অজানা (Unknown)"}{a.sizeSource ? ` (${a.sizeSource})` : ""}</div>)}
                      {insights[adSet.id].excluded.map((a) => <div key={a.externalAudienceId}>বাদ দেওয়া: {a.name ?? a.externalAudienceId} — Size: {a.size != null ? a.size.toLocaleString() : "অজানা (Unknown)"}</div>)}
                      {insights[adSet.id].warnings.map((w) => <div key={w.code + w.message} className="text-amber-700">⚠️ {w.message}</div>)}
                      <div>Overlap: {insights[adSet.id].overlap.status === "not_applicable" ? "প্রযোজ্য নয়" : "হিসাব করা যায় না"} — {insights[adSet.id].overlap.reason}</div>
                      <div>Delivery Estimate: {insights[adSet.id].estimate.available ? `${(insights[adSet.id].estimate.lowerBound ?? 0).toLocaleString()}–${(insights[adSet.id].estimate.upperBound ?? 0).toLocaleString()} জন/দিন` : `পাওয়া যাচ্ছে না (${insights[adSet.id].estimate.reason ?? "—"})`}</div>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>
          {editable ? (
            <div className="grid gap-3 border-t pt-3 lg:grid-cols-2">
              <div className="space-y-2">
                <div className="text-sm font-semibold">হাতে Ad যোগ করুন</div>
                <input className="input" placeholder="Ad এর নাম" value={adForms[adSet.id]?.name ?? ""} onChange={(e) => setAdForms((s) => ({ ...s, [adSet.id]: { ...(s[adSet.id] ?? emptyAdForm), name: e.target.value } }))} />
                <textarea className="input" rows={3} placeholder="Primary Text" value={adForms[adSet.id]?.primaryText ?? ""} onChange={(e) => setAdForms((s) => ({ ...s, [adSet.id]: { ...(s[adSet.id] ?? emptyAdForm), primaryText: e.target.value } }))} />
                <input className="input" placeholder="Headline (ঐচ্ছিক)" value={adForms[adSet.id]?.headline ?? ""} onChange={(e) => setAdForms((s) => ({ ...s, [adSet.id]: { ...(s[adSet.id] ?? emptyAdForm), headline: e.target.value } }))} />
                <input className="input" placeholder="Link URL (https://...)" value={adForms[adSet.id]?.linkUrl ?? ""} onChange={(e) => setAdField(adSet.id, "linkUrl", e.target.value)} />
                <div className="flex flex-wrap gap-2">
                  <select className="input w-36" value={adForms[adSet.id]?.format ?? "link"} onChange={(e) => setAdField(adSet.id, "format", e.target.value)}>
                    <option value="link">🖼️ Link Ad</option>
                    <option value="video">🎬 Video Ad</option>
                    <option value="carousel">🎠 Carousel</option>
                  </select>
                  {(adForms[adSet.id]?.format ?? "link") === "link" ? (
                    <select className="input flex-1" value={adForms[adSet.id]?.imageAssetId ?? ""} onChange={(e) => setAdField(adSet.id, "imageAssetId", e.target.value)}>
                      <option value="">লাইব্রেরির ছবি (ঐচ্ছিক)</option>
                      {assets.filter((x) => x.kind === "image" && x.status === "ready" && x.adAccountId === plan.adAccountId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  ) : null}
                  {(adForms[adSet.id]?.format ?? "link") === "video" ? (
                    <select className="input flex-1" value={adForms[adSet.id]?.videoAssetId ?? ""} onChange={(e) => setAdField(adSet.id, "videoAssetId", e.target.value)}>
                      <option value="">লাইব্রেরির ভিডিও বেছে নিন</option>
                      {assets.filter((x) => x.kind === "video" && x.status === "ready" && x.adAccountId === plan.adAccountId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  ) : null}
                </div>
                {(adForms[adSet.id]?.format ?? "link") === "carousel" ? (
                  <textarea className="input font-mono text-xs" rows={4} placeholder="প্রতি লাইনে একটি কার্ড: শিরোনাম | লিংক | ছবির URL (ঐচ্ছিক)" value={adForms[adSet.id]?.carouselText ?? ""} onChange={(e) => setAdField(adSet.id, "carouselText", e.target.value)} />
                ) : null}
                {(adForms[adSet.id]?.format ?? "link") === "link" ? (
                  <input className="input" placeholder="অথবা ছবির URL সরাসরি" value={adForms[adSet.id]?.imageUrl ?? ""} onChange={(e) => setAdField(adSet.id, "imageUrl", e.target.value)} />
                ) : null}
                <div className="space-y-2 rounded-lg bg-indigo-50 p-2">
                  <div className="text-xs font-semibold text-indigo-700">Creative v2 (CN5) — একাধিক লেখা, Placement Asset, Enhancements</div>
                  <textarea className="input" rows={2} placeholder="অতিরিক্ত Primary Text অপশন — প্রতি লাইনে একটি (সর্বোচ্চ মোট ৫টি; প্রথমটি উপরের Primary Text)" value={adForms[adSet.id]?.extraTexts ?? ""} onChange={(e) => setAdField(adSet.id, "extraTexts", e.target.value)} />
                  <textarea className="input" rows={2} placeholder="অতিরিক্ত Headline অপশন — প্রতি লাইনে একটি (সর্বোচ্চ মোট ৫টি)" value={adForms[adSet.id]?.extraHeadlines ?? ""} onChange={(e) => setAdField(adSet.id, "extraHeadlines", e.target.value)} />
                  <textarea className="input" rows={2} placeholder="Description অপশন — প্রতি লাইনে একটি (সর্বোচ্চ ২টি)" value={adForms[adSet.id]?.descriptions ?? ""} onChange={(e) => setAdField(adSet.id, "descriptions", e.target.value)} />
                  <div className="flex flex-wrap gap-2">
                    <select className="input flex-1" value={adForms[adSet.id]?.feedAssetId ?? ""} onChange={(e) => setAdField(adSet.id, "feedAssetId", e.target.value)}>
                      <option value="">Feed Placement ছবি (ঐচ্ছিক Override)</option>
                      {assets.filter((x) => x.kind === "image" && x.status === "ready" && x.adAccountId === plan.adAccountId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                    <select className="input flex-1" value={adForms[adSet.id]?.verticalAssetId ?? ""} onChange={(e) => setAdField(adSet.id, "verticalAssetId", e.target.value)}>
                      <option value="">Stories/Reels ছবি (ঐচ্ছিক Override)</option>
                      {assets.filter((x) => x.kind === "image" && x.status === "ready" && x.adAccountId === plan.adAccountId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                    <select className="input flex-1" value={adForms[adSet.id]?.verticalVideoAssetId ?? ""} onChange={(e) => setAdField(adSet.id, "verticalVideoAssetId", e.target.value)}>
                      <option value="">Stories/Reels ভিডিও (ঐচ্ছিক Override)</option>
                      {assets.filter((x) => x.kind === "video" && x.status === "ready" && x.adAccountId === plan.adAccountId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {CN5_ENHANCEMENTS.map((enh) => (
                      <label key={enh.key} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!adForms[adSet.id]?.enhancements?.[enh.key]} onChange={(e) => setAdForms((s) => ({ ...s, [adSet.id]: { ...(s[adSet.id] ?? emptyAdForm), enhancements: { ...(s[adSet.id]?.enhancements ?? {}), [enh.key]: e.target.checked } } }))} /> {enh.label}</label>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500">Publish এ Link/Video Ad এ অপশনগুলো Meta এর Asset Feed দিয়ে যায়; Carousel/Catalog/Lead Ad এ শুধু প্রথম অপশন যায় (Readiness এ সতর্কবার্তা থাকে)।</p>
                </div>
                {adSet.destinationType === "WHATSAPP" ? (
                  <div className="space-y-2 rounded-lg bg-emerald-50 p-2">
                    <div className="text-xs font-semibold text-emerald-700">💬 WhatsApp Welcome (CN13 — CTWA) — ক্রেতা Ad এ ক্লিক করলে চ্যাটে যা দেখবেন</div>
                    <input className="input" placeholder="স্বাগত বার্তা (Greeting) — যেমন: স্বাগতম! কীভাবে সাহায্য করতে পারি?" value={adForms[adSet.id]?.waGreeting ?? ""} onChange={(e) => setAdField(adSet.id, "waGreeting", e.target.value)} />
                    <input className="input" placeholder="আগে থেকে লেখা বার্তা (Prefill) — যেমন: আমি এই পণ্যটি অর্ডার করতে চাই" value={adForms[adSet.id]?.waPrefill ?? ""} onChange={(e) => setAdField(adSet.id, "waPrefill", e.target.value)} />
                    <textarea className="input" rows={2} placeholder="Ice Breaker প্রশ্ন — প্রতি লাইনে একটি (সর্বোচ্চ ৩টি; দিলে Prefill এর বদলে এগুলো যাবে)" value={adForms[adSet.id]?.waIce ?? ""} onChange={(e) => setAdField(adSet.id, "waIce", e.target.value)} />
                    <p className="text-[11px] text-slate-500">এগুলো Meta এর Page Welcome Message হিসেবে Publish এর সময় পাঠানো হয়। কিছুই না লিখলে Welcome Block যাবে না।</p>
                  </div>
                ) : null}
                <button className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => addAd(adSet.id)}>Ad যোগ করুন</button>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-semibold">AI Copy (প্রোডাক্ট থেকে)</div>
                <select className="input" value={copySelection[adSet.id] ?? ""} onChange={(e) => setCopySelection((s) => ({ ...s, [adSet.id]: e.target.value }))}>
                  <option value="">প্রোডাক্ট বেছে নিন</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name} - {formatMinor(BigInt(p.priceMinor), p.currency)}</option>)}
                </select>
                <button className="btn-warning btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => generateCopy(adSet.id)}>{busy === `copy-${adSet.id}` ? "তৈরি হচ্ছে..." : "AI Copy তৈরি করুন"}</button>
                <p className="text-xs text-slate-400">AI Copy প্রোডাক্টের আসল দাম ব্যবহার করে, কোনো ছাড় বা প্রতিশ্রুতি বানায় না। তৈরি হওয়া লেখা Draft, Publish এর আগে যাচাই করুন।</p>
              </div>
            </div>
          ) : null}
        </div>
      ))}

      {editable ? (
        <form onSubmit={addAdSet} className="space-y-3 card p-5">
          <div className="font-semibold">নতুন Ad Set</div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <label className="block text-sm">নাম<input className={inputCls} value={adSetForm.name} onChange={(e) => setAdSetForm({ ...adSetForm, name: e.target.value })} required /></label>
            <label className="block text-sm">দৈনিক বাজেট{plan.budgetMode === "cbo" ? " (CBO Plan — ঐচ্ছিক)" : ""}<input className={inputCls} value={adSetForm.dailyBudget} onChange={(e) => setAdSetForm({ ...adSetForm, dailyBudget: e.target.value })} placeholder="500.00" /></label>
            <label className="block text-sm">শুরুর সময় (ঐচ্ছিক)<input type="datetime-local" className={inputCls} value={adSetStart} onChange={(e) => setAdSetStart(e.target.value)} /></label>
            <label className="block text-sm">শেষের সময় (ঐচ্ছিক)<input type="datetime-local" className={inputCls} value={adSetEnd} onChange={(e) => setAdSetEnd(e.target.value)} /></label>
            <label className="block text-sm">Optimization Goal
              <select className={inputCls} value={adSetForm.optimizationGoal} onChange={(e) => setAdSetForm({ ...adSetForm, optimizationGoal: e.target.value })}>
                <option value="LINK_CLICKS">Link Clicks</option><option value="CONVERSATIONS">Conversations (WhatsApp Destination হলে)</option><option value="OFFSITE_CONVERSIONS">Conversions (Pixel লাগবে)</option>
                <option value="LEAD_GENERATION">Lead Generation</option><option value="REACH">Reach</option><option value="LANDING_PAGE_VIEWS">Landing Page Views</option><option value="VALUE">Value (ROAS — Pixel লাগবে)</option>
              </select>
            </label>
            <label className="block text-sm">Facebook Page ID<input className={inputCls} value={adSetForm.pageId} onChange={(e) => setAdSetForm({ ...adSetForm, pageId: e.target.value })} required /></label>
            <label className="block text-sm">Pixel ID (Conversions হলে)<input className={inputCls} value={adSetForm.pixelId} onChange={(e) => setAdSetForm({ ...adSetForm, pixelId: e.target.value })} /></label>
            <label className="block text-sm">দেশ (কমা দিয়ে)<input className={inputCls} value={adSetForm.countries} onChange={(e) => setAdSetForm({ ...adSetForm, countries: e.target.value })} placeholder="BD" /></label>
            <label className="block text-sm">Interests (কমা দিয়ে; ID-যাচাই চাইলে নাম|ID)<input className={inputCls} value={adSetForm.interests} onChange={(e) => setAdSetForm({ ...adSetForm, interests: e.target.value })} placeholder="Online shopping, Fashion|600123..." /></label>
            <label className="block text-sm">শহর — City Key (কমা; Radius চাইলে key:km)<input className={inputCls} value={adSetForm.cities} onChange={(e) => setAdSetForm({ ...adSetForm, cities: e.target.value })} placeholder="Targeting Search থেকে Key নিন" /></label>
            <label className="block text-sm">Postcodes (Zip Key, কমা দিয়ে)<input className={inputCls} value={adSetForm.postcodes} onChange={(e) => setAdSetForm({ ...adSetForm, postcodes: e.target.value })} placeholder="US:90210" /></label>
            <label className="block text-sm">Location Types (home,recent,travel_in,everyone)<input className={inputCls} value={adSetForm.locationTypes} onChange={(e) => setAdSetForm({ ...adSetForm, locationTypes: e.target.value })} placeholder="home" /></label>
            <label className="block text-sm">ভাষা — Locale ID (কমা দিয়ে)<input className={inputCls} value={adSetForm.locales} onChange={(e) => setAdSetForm({ ...adSetForm, locales: e.target.value })} placeholder="Targeting Search থেকে ID নিন" /></label>
            <label className="block text-sm">Behaviors (কমা দিয়ে; নাম|ID চলবে)<input className={inputCls} value={adSetForm.behaviors} onChange={(e) => setAdSetForm({ ...adSetForm, behaviors: e.target.value })} /></label>
            <label className="block text-sm">Narrowing — Interests (AND স্তর, কমা দিয়ে)<input className={inputCls} value={adSetForm.narrowInterests} onChange={(e) => setAdSetForm({ ...adSetForm, narrowInterests: e.target.value })} placeholder="উপরের Audience এর মধ্যেই আরও সংকীর্ণ" /></label>
            <label className="block text-sm">Education Status IDs (কমা)<input className={inputCls} value={adSetForm.eduStatuses} onChange={(e) => setAdSetForm({ ...adSetForm, eduStatuses: e.target.value })} /></label>
            <label className="block text-sm">Relationship Status IDs (কমা)<input className={inputCls} value={adSetForm.relStatuses} onChange={(e) => setAdSetForm({ ...adSetForm, relStatuses: e.target.value })} /></label>
            <label className="block text-sm">Life Events (কমা দিয়ে; নাম|ID চলবে)<input className={inputCls} value={adSetForm.lifeEvents} onChange={(e) => setAdSetForm({ ...adSetForm, lifeEvents: e.target.value })} placeholder="Targeting Search এ Life Event খুঁজে ID নিন" /></label>
            <label className="block text-sm">Work Positions (কমা দিয়ে; নাম|ID চলবে)<input className={inputCls} value={adSetForm.workPositions} onChange={(e) => setAdSetForm({ ...adSetForm, workPositions: e.target.value })} placeholder="Targeting Search এ Work Position খুঁজে ID নিন" /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={expansion} onChange={(e) => setExpansion(e.target.checked)} /> Detailed Targeting Expansion (Advantage Audience)</label>
            <label className="block text-sm">Bid Strategy (CN2)
              <select className={inputCls} value={adSetForm.bidStrategy} onChange={(e) => setAdSetForm({ ...adSetForm, bidStrategy: e.target.value })}>
                <option value="">Lowest Cost (Meta Default)</option>
                <option value="bid_cap">Bid Cap</option>
                <option value="cost_cap">Cost Per Result Goal</option>
                <option value="roas_goal">ROAS Goal (Sales + Value)</option>
              </select>
            </label>
            {adSetForm.bidStrategy === "bid_cap" ? <label className="block text-sm">Bid Amount (টাকা)<input className={inputCls} value={adSetForm.bidAmount} onChange={(e) => setAdSetForm({ ...adSetForm, bidAmount: e.target.value })} /></label> : null}
            {adSetForm.bidStrategy === "cost_cap" ? <label className="block text-sm">Cost Per Result Goal (টাকা)<input className={inputCls} value={adSetForm.costPerResultGoal} onChange={(e) => setAdSetForm({ ...adSetForm, costPerResultGoal: e.target.value })} /></label> : null}
            {adSetForm.bidStrategy === "roas_goal" ? <label className="block text-sm">ROAS Goal (যেমন 2.0)<input className={inputCls} value={adSetForm.roasGoal} onChange={(e) => setAdSetForm({ ...adSetForm, roasGoal: e.target.value })} /></label> : null}
            <label className="block text-sm">Conversion Event (CN3)
              <select className={inputCls} value={adSetForm.conversionEvent} onChange={(e) => setAdSetForm({ ...adSetForm, conversionEvent: e.target.value })}>
                <option value="">PURCHASE (Default)</option>
                {(adSetForm.optimizationGoal === "LEAD_GENERATION" ? LEAD_EVENTS : SALES_EVENTS).map((ev) => <option key={ev} value={ev}>{ev}</option>)}
              </select>
            </label>
            <label className="block text-sm">ক্যাটালগ (CN3 — Catalog Ads)
              <select className={inputCls} value={adSetForm.catalogRecordId} onChange={(e) => setAdSetForm({ ...adSetForm, catalogRecordId: e.target.value, productSetId: "" })}>
                <option value="">ক্যাটালগ নয় (সাধারণ Ad Set)</option>
                {catalogs.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.platform})</option>)}
              </select>
            </label>
            {adSetForm.catalogRecordId ? (
              <label className="block text-sm">Product Set (Meta তে তৈরি হওয়া Set ই চলবে)
                <select className={inputCls} value={adSetForm.productSetId} onChange={(e) => setAdSetForm({ ...adSetForm, productSetId: e.target.value })}>
                  <option value="">Product Set বেছে নিন</option>
                  {formSets.map((s) => <option key={s.id} value={s.id} disabled={s.status !== "created"}>{s.name} · {s.itemCount} আইটেম{s.status === "created" ? "" : ` (${s.status} — Meta তে তৈরি হয়নি)`}</option>)}
                </select>
              </label>
            ) : null}
            <label className="block text-sm">Lead Form (CN4 — Lead Generation হলে)
              <select className={inputCls} value={adSetForm.leadFormId} onChange={(e) => setAdSetForm({ ...adSetForm, leadFormId: e.target.value })}>
                <option value="">ফর্ম নেই</option>
                {leadForms.filter((f) => !adSetForm.pageId || f.pageId === adSetForm.pageId).map((f) => <option key={f.id} value={f.id}>{f.name} ({f.status === "created" ? "Meta তে তৈরি" : "লোকাল — Publish এ তৈরি হবে"})</option>)}
              </select>
            </label>
            <label className="block text-sm">Destination (CN13 — Click-to-WhatsApp)
              <select className={inputCls} value={adSetForm.destinationType} onChange={(e) => setAdSetForm({ ...adSetForm, destinationType: e.target.value, whatsappIntegrationId: "" })}>
                <option value="">Website (সাধারণ)</option>
                <option value="WHATSAPP">WhatsApp — Click-to-WhatsApp Ad</option>
              </select>
            </label>
            {adSetForm.destinationType === "WHATSAPP" ? (
              <label className="block text-sm">WhatsApp Connection (শুধু Connected টাই চলবে)
                <select className={inputCls} value={adSetForm.whatsappIntegrationId} onChange={(e) => setAdSetForm({ ...adSetForm, whatsappIntegrationId: e.target.value })}>
                  <option value="">Connection বেছে নিন</option>
                  {(waDestinations?.destinations ?? []).map((d) => (
                    <option key={d.integrationId} value={d.integrationId} disabled={!d.connected}>
                      {d.phoneNumberId ?? "Phone Number ID নেই"} · WABA {d.wabaId ?? "—"}{d.isDefault ? " · Default" : ""}{d.connected ? "" : ` · ${d.status} (ব্যবহারযোগ্য নয়)`}
                    </option>
                  ))}
                </select>
                {(waDestinations?.destinations ?? []).filter((d) => d.connected).length === 0 ? (
                  <span className="mt-1 block text-xs font-medium text-red-600">⛔ কোনো Connected WhatsApp Connection নেই — আগে Connect Center থেকে WhatsApp Connect করুন। নম্বর হাতে লিখে দেওয়া যায় না; সেভের সময় নম্বরটি Meta থেকে পড়ে যাচাই করা হয়।</span>
                ) : (
                  <span className="mt-1 block text-xs text-slate-500">সেভের সময় এই Connection এর নম্বর Meta থেকে পড়া হবে — এখানে কোনো নম্বর লেখা যায় না। Goal হিসেবে সাধারণত CONVERSATIONS নিন; Readiness এ Connection এর অবস্থা Error আকারে দেখা যাবে।</span>
                )}
              </label>
            ) : null}
            <div className="space-y-1 rounded-lg bg-slate-50 p-2 lg:col-span-3">
              <div className="text-xs font-semibold text-slate-600">🔎 Targeting Search (CN1) — Meta এর আসল তালিকা থেকে ID নিন; ID-সহ Entry সেভের সময় Meta দিয়ে যাচাই হয়</div>
              <div className="flex flex-wrap items-center gap-2">
                <select className="input w-36" value={tSearch.kind} onChange={(e) => setTSearch({ ...tSearch, kind: e.target.value })}>
                  <option value="interest">Interest</option><option value="behavior">Behavior</option><option value="geo">শহর/এলাকা (Geo)</option><option value="locale">ভাষা (Locale)</option><option value="life_event">Life Event</option><option value="work_position">Work Position</option>
                </select>
                <input className="input w-56" value={tSearch.query} onChange={(e) => setTSearch({ ...tSearch, query: e.target.value })} placeholder="যেমন: Fashion" />
                <button type="button" className="btn-secondary btn-sm" disabled={busy !== "" || !tSearch.query.trim()} onClick={async () => {
                  const res = await wrap("tsearch", () => apiFetch<{ available: boolean; reason?: string; results: { id: string; name: string | null; audienceSizeLower: number | null; audienceSizeUpper: number | null }[] }>(`/organizations/${orgId}/campaign-plans/targeting/search?adAccountId=${encodeURIComponent(plan.adAccountId)}&kind=${encodeURIComponent(tSearch.kind)}&q=${encodeURIComponent(tSearch.query)}`));
                  if (res) setTSearch({ ...tSearch, available: res.available, reason: res.reason, results: res.results ?? [] });
                }}>খুঁজুন</button>
              </div>
              {tSearch.available === false ? <p className="text-xs text-amber-600">পাওয়া যাচ্ছে না: {tSearch.reason}</p> : null}
              {tSearch.results.length > 0 ? <ul className="space-y-0.5 text-xs text-slate-600">{tSearch.results.map((r) => <li key={r.id}>{r.name ?? "—"} · ID: <span className="font-mono">{r.id}</span>{r.audienceSizeLower != null ? ` · আনুমানিক Audience: ${r.audienceSizeLower.toLocaleString()}–${(r.audienceSizeUpper ?? 0).toLocaleString()}` : ""}</li>)}</ul> : null}
            </div>
            <label className="block text-sm">Custom Audience IDs (Meta ID, কমা দিয়ে)<input className={inputCls} value={adSetForm.audienceIds} onChange={(e) => setAdSetForm({ ...adSetForm, audienceIds: e.target.value })} placeholder={audList.filter((a) => a.externalAudienceId).map((a) => a.externalAudienceId).join(", ") || "যেমন: 23850..."} /></label>
            <label className="block text-sm">বাদ দিতে Audience IDs<input className={inputCls} value={adSetForm.excludeIds} onChange={(e) => setAdSetForm({ ...adSetForm, excludeIds: e.target.value })} /></label>
            <label className="block text-sm">Saved প্রিসেট প্রয়োগ
              <select className={inputCls} value="" onChange={(e) => {
                const p = savedList.find((x) => x.id === e.target.value);
                if (!p) return;
                const t = p.targeting as any;
                setAdSetForm((f) => ({ ...f,
                  countries: Array.isArray(t.countries) ? t.countries.join(",") : f.countries,
                  interests: Array.isArray(t.interests) ? t.interests.map((e: any) => entryToken(e)).join(", ") : f.interests,
                  lifeEvents: Array.isArray(t.demographics?.lifeEvents) ? t.demographics.lifeEvents.map((e: any) => entryToken(e)).join(", ") : f.lifeEvents,
                  workPositions: Array.isArray(t.demographics?.workPositions) ? t.demographics.workPositions.map((e: any) => entryToken(e)).join(", ") : f.workPositions,
                  audienceIds: Array.isArray(t.customAudienceIds) ? t.customAudienceIds.join(",") : f.audienceIds,
                }));
              }}>
                <option value="">— প্রিসেট বেছে নিন —</option>
                {savedList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <PlacementChecks values={placements} onChange={setPlacements} />
          </div>
          <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>Ad Set যোগ করুন</button>
        </form>
      ) : null}

      </div>

      {(plan.status === "approved" || plan.status === "published" || plan.status === "publish_failed") ? (
        <div className="card space-y-3 p-5">
          <div className="font-semibold">🌐 অন্য প্ল্যাটফর্মে Draft <span className="text-xs font-normal text-slate-400">(CB6 · CN17: Performance Max ও TikTok Objective)</span></div>
          <p className="text-xs text-slate-500">এই অনুমোদিত Plan থেকে Google Search, Google Performance Max বা TikTok এ PAUSED Draft তৈরি হবে — বিদ্যমান Publish পথ দিয়েই। যা Map করা যাবে না তা তালিকা করে জানানো হবে; সেক্ষেত্রে কোনো কল যাবে না, Payload টি Export হিসেবে দেখাবে। TikTok Objective শুধু এই Draft পথের জন্য — সরাসরি Publish পেজের আচরণ অপরিবর্তিত।</p>
          <div className="flex flex-wrap items-center gap-2">
            <select className="input w-40" id="x-platform">
              <option value="google">Google Ads</option>
              <option value="tiktok">TikTok Ads</option>
            </select>
            <select className="input w-52" id="x-kind" title="Google Draft-এর ধরন">
              <option value="search">Google: Search (RSA)</option>
              <option value="pmax">Google: Performance Max</option>
            </select>
            <select className="input w-56" id="x-objective" title="TikTok Objective (শুধু Draft পথে)">
              <option value="TRAFFIC">TikTok: Traffic</option>
              <option value="WEB_CONVERSIONS">TikTok: Website Conversions</option>
              <option value="LEAD_GENERATION">TikTok: Lead Generation</option>
            </select>
            <input className="input w-44" id="x-pixel" placeholder="TikTok Pixel ID (Conversions হলে)" />
            <input className="input w-52" id="x-event" placeholder="Optimization Event (যেমন COMPLETE_PAYMENT)" />
            <select className="input w-64" id="x-account">
              <option value="">Target Account বেছে নিন</option>
              {accounts.filter((a) => a.platform === "google" || a.platform === "tiktok").map((a) => <option key={a.id} value={a.id}>{a.name} ({a.platform})</option>)}
            </select>
            <button className="btn-primary btn-sm" disabled={busy !== ""} onClick={async () => {
              const platform = (document.getElementById("x-platform") as HTMLSelectElement)?.value ?? "google";
              const target = (document.getElementById("x-account") as HTMLSelectElement)?.value ?? "";
              if (!target) { setError("Target Account বেছে নিন"); return; }
              const kind = (document.getElementById("x-kind") as HTMLSelectElement)?.value ?? "search";
              const objectiveType = (document.getElementById("x-objective") as HTMLSelectElement)?.value ?? "TRAFFIC";
              const pixelId = (document.getElementById("x-pixel") as HTMLInputElement)?.value.trim() ?? "";
              const optimizationEvent = (document.getElementById("x-event") as HTMLInputElement)?.value.trim() ?? "";
              const extra = platform === "google" ? { kind } : { objectiveType, ...(pixelId ? { pixelId } : {}), ...(optimizationEvent ? { optimizationEvent } : {}) };
              const res = await wrap("xplat", () => apiFetch<{ status: string; unmapped: string[]; notCarried?: string[]; transformations: string[]; publication?: { externalCampaignId?: string | null } }>(`/organizations/${orgId}/campaign-plans/${plan.id}/cross-platform`, { method: "POST", body: JSON.stringify({ platform, targetAdAccountId: target, ...extra }) }));
              if (res) {
                if (res.status === "created") setNotice(`${platform === "google" ? "Google" : "TikTok"} এ PAUSED Draft তৈরি হয়েছে (Campaign ID: ${res.publication?.externalCampaignId ?? "—"})। Publish Log এ রেকর্ড আছে।${res.notCarried?.length ? ` যা এই ধরনে যায়নি: ${res.notCarried.join(" · ")}` : ""}`);
                else if (res.status === "blocked") setError(`Draft হয়নি — ঘাটতি: ${res.unmapped.join(" · ")}`);
                else setError("প্ল্যাটফর্ম Publish ব্যর্থ হয়েছে — Publish Log এ কারণ লেখা আছে।");
                await loadPlan(plan.id);
              }
            }}>Draft তৈরি করুন</button>
          </div>
        </div>
      ) : null}

      {(plan.status === "approved" || plan.status === "published" || plan.status === "publish_failed") ? (
        <div className="card space-y-3 p-5">
          <div className="font-semibold">📂 Cross-Platform Drafts <span className="text-xs font-normal text-slate-400">(Campaign Builder Next CN9)</span></div>
          <p className="text-xs text-slate-500">উপরে তৈরি প্রতিটি Draft এখানে সংরক্ষিত থাকে — Field Edit, Readiness যাচাই, স্থানীয় Preview, আর Re-publish (সবসময় নতুন PAUSED Draft; আগেরটি বদলায় না) করা যায়। Status Sync-এ প্ল্যাটফর্মের Status পড়ার পথ নেই বলে সৎভাবে তা-ই জানানো হয়।</p>
          <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("xdrafts", () => apiFetch<XDraft[]>(`/organizations/${orgId}/campaign-plans/${plan.id}/xdrafts`));
            if (res) setXdrafts(res);
          }}>Draft তালিকা লোড করুন</button>
          {xdrafts ? (xdrafts.length === 0 ? <p className="text-sm text-slate-400">এখনো কোনো Draft নেই — উপরে তৈরি করুন।</p> : (
            <div className="space-y-2">
              {xdrafts.map((d) => (
                <div key={d.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{d.platform === "google" ? (d.kind === "pmax" ? "Google Performance Max" : "Google Search") : `TikTok · ${d.fields?.objectiveType ?? "TRAFFIC"}`} — {d.fields?.name ?? ""} <span className="text-xs text-slate-400">দৈনিক বাজেট: {d.fields?.dailyBudget ?? "—"}</span></span>
                    <span className={d.status === "created" ? "rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-semibold text-green-700" : d.status === "blocked" ? "rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700" : d.status === "failed" ? "rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700" : "rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600"}>{d.status}{d.externalCampaignId ? ` · ${d.externalCampaignId}` : ""}</span>
                  </div>
                  {d.lastError ? <p className="mt-1 text-xs text-red-600">{d.lastError}</p> : null}
                  {Array.isArray(d.unmapped) && d.unmapped.length ? <p className="mt-1 text-xs text-amber-700">ঘাটতি: {d.unmapped.join(" · ")}</p> : null}
                  <p className="mt-1 text-xs text-slate-500">{d.platform === "google" && d.kind === "pmax" ? `Headline ${(d.fields?.headlines ?? []).length}টি · Long ${(d.fields?.longHeadlines ?? []).length}টি · Description ${(d.fields?.descriptions ?? []).length}টি · ছবি ${(d.fields?.imageUrls ?? []).length}টি · Business: ${d.fields?.businessName ?? "—"} · ${(d.fields?.countryCodes ?? []).join(",")}` : d.platform === "google" ? `Headline ${(d.fields?.headlines ?? []).length}টি · Description ${(d.fields?.descriptions ?? []).length}টি · Keyword ${(d.fields?.keywords ?? []).length}টি · ${(d.fields?.countryCodes ?? []).join(",")}` : `Text: ${String(d.fields?.adText ?? "").slice(0, 60)} · ${(d.fields?.countryCodes ?? []).join(",")}`}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => {
                      if (xdEditId === d.id) { setXdEditId(null); setXdForm(null); return; }
                      const f = d.fields ?? {};
                      setXdForm({
                        name: f.name ?? "", dailyBudget: f.dailyBudget ?? "", countries: (f.countryCodes ?? []).join(","),
                        finalUrl: f.finalUrl ?? "", headlinesText: (f.headlines ?? []).join("\n"), descriptionsText: (f.descriptions ?? []).join("\n"),
                        keywordsText: (f.keywords ?? []).map((k: any) => (typeof k === "string" ? k : `${k.text}${k.matchType && k.matchType !== "EXACT" ? `|${k.matchType}` : ""}`)).join("\n"),
                        adText: f.adText ?? "", landingUrl: f.landingUrl ?? "", imageUrl: f.imageUrl ?? "", videoUrl: f.videoUrl ?? "",
                        longHeadlinesText: (f.longHeadlines ?? []).join("\n"), businessName: f.businessName ?? "", logoUrl: f.logoUrl ?? "", imageUrlsText: (f.imageUrls ?? []).join("\n"),
                        objectiveType: f.objectiveType ?? "TRAFFIC", pixelId: f.pixelId ?? "", optimizationEvent: f.optimizationEvent ?? "",
                      });
                      setXdEditId(d.id);
                    }}>✎ Edit</button>
                    <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                      const res = await wrap(`xd-ready-${d.id}`, () => apiFetch<{ ready: boolean; checks: { level: string; label: string; detail: string }[] }>(`/organizations/${orgId}/campaign-plans/${plan.id}/xdrafts/${d.id}/readiness`, { method: "POST", body: JSON.stringify({}) }));
                      if (res) setXdResult((s) => ({ ...s, [d.id]: (res.ready ? "✅ Readiness: প্রস্তুত\n" : "⛔ Readiness: ঘাটতি আছে\n") + res.checks.map((c) => `${c.level === "error" ? "✗" : c.level === "warn" ? "⚠" : "✓"} ${c.label}: ${c.detail}`).join("\n") }));
                    }}>✓ Readiness</button>
                    <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                      const res = await wrap(`xd-prev-${d.id}`, () => apiFetch<any>(`/organizations/${orgId}/campaign-plans/${plan.id}/xdrafts/${d.id}/preview`));
                      if (res) setXdResult((s) => ({ ...s, [d.id]: JSON.stringify(res, null, 1) }));
                    }}>👁 Preview (স্থানীয়)</button>
                    <button className="btn-primary btn-sm" disabled={busy !== ""} onClick={async () => {
                      const res = await wrap(`xd-pub-${d.id}`, () => apiFetch<{ status: string; note?: string; unmapped?: string[] }>(`/organizations/${orgId}/campaign-plans/${plan.id}/xdrafts/${d.id}/publish`, { method: "POST", body: JSON.stringify({}) }));
                      if (res) {
                        setXdResult((s) => ({ ...s, [d.id]: res.status === "created" ? `✅ ${res.note ?? "নতুন PAUSED Draft তৈরি হয়েছে।"}` : res.status === "blocked" ? `⛔ Readiness-এ আটকেছে: ${(res.unmapped ?? []).join(" · ")}` : "❌ Publish ব্যর্থ — Draft-এ কারণ লেখা আছে।" }));
                        const list = await apiFetch<XDraft[]>(`/organizations/${orgId}/campaign-plans/${plan.id}/xdrafts`).catch(() => null);
                        if (list) setXdrafts(list);
                      }
                    }}>🚀 Re-publish (নতুন PAUSED)</button>
                    <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                      const res = await wrap(`xd-sync-${d.id}`, () => apiFetch<{ available: boolean; reason: string; status: string; statusLabel: string }>(`/organizations/${orgId}/campaign-plans/${plan.id}/xdrafts/${d.id}/sync-status`, { method: "POST", body: JSON.stringify({}) }));
                      if (res) setXdResult((s) => ({ ...s, [d.id]: `Status (${res.statusLabel}): ${res.status}\n${res.reason}` }));
                    }}>↻ Status Sync</button>
                  </div>
                  {xdResult[d.id] ? <pre className="mt-2 whitespace-pre-wrap rounded bg-white p-2 text-xs text-slate-600">{xdResult[d.id]}</pre> : null}
                  {xdEditId === d.id && xdForm ? (
                    <div className="mt-2 space-y-2 border-t pt-2">
                      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                        <label className="block text-sm">নাম<input className="input" value={xdForm.name} onChange={(e) => setXdForm({ ...xdForm, name: e.target.value })} /></label>
                        <label className="block text-sm">দৈনিক বাজেট<input className="input" value={xdForm.dailyBudget} onChange={(e) => setXdForm({ ...xdForm, dailyBudget: e.target.value })} /></label>
                        <label className="block text-sm">দেশ (কমা দিয়ে)<input className="input" value={xdForm.countries} onChange={(e) => setXdForm({ ...xdForm, countries: e.target.value })} /></label>
                      </div>
                      {d.platform === "google" && d.kind === "pmax" ? (<>
                        <label className="block text-sm">Final URL<input className="input" value={xdForm.finalUrl} onChange={(e) => setXdForm({ ...xdForm, finalUrl: e.target.value })} /></label>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="block text-sm">Business Name (≤২৫ অক্ষর)<input className="input" value={xdForm.businessName} onChange={(e) => setXdForm({ ...xdForm, businessName: e.target.value })} /></label>
                          <label className="block text-sm">Logo URL (http)<input className="input" value={xdForm.logoUrl} onChange={(e) => setXdForm({ ...xdForm, logoUrl: e.target.value })} /></label>
                        </div>
                        <label className="block text-sm">Headlines — প্রতি লাইনে একটি (৩–১৫টি, ≤৩০ অক্ষর)<textarea className="input font-mono text-xs" rows={5} value={xdForm.headlinesText} onChange={(e) => setXdForm({ ...xdForm, headlinesText: e.target.value })} /></label>
                        <label className="block text-sm">Long Headlines — প্রতি লাইনে একটি (১–৫টি, ≤৯০ অক্ষর)<textarea className="input font-mono text-xs" rows={3} value={xdForm.longHeadlinesText} onChange={(e) => setXdForm({ ...xdForm, longHeadlinesText: e.target.value })} /></label>
                        <label className="block text-sm">Descriptions — প্রতি লাইনে একটি (২–৫টি, ≤৯০ অক্ষর)<textarea className="input font-mono text-xs" rows={3} value={xdForm.descriptionsText} onChange={(e) => setXdForm({ ...xdForm, descriptionsText: e.target.value })} /></label>
                        <label className="block text-sm">Marketing Image URLs — প্রতি লাইনে একটি (১–২০টি)<textarea className="input font-mono text-xs" rows={3} value={xdForm.imageUrlsText} onChange={(e) => setXdForm({ ...xdForm, imageUrlsText: e.target.value })} /></label>
                        <p className="text-xs text-slate-400">Performance Max-এ Keyword থাকে না; এই Path-এ Video Asset ও Audience Signal যায় না।</p>
                      </>) : d.platform === "google" ? (<>
                        <label className="block text-sm">Final URL<input className="input" value={xdForm.finalUrl} onChange={(e) => setXdForm({ ...xdForm, finalUrl: e.target.value })} /></label>
                        <label className="block text-sm">Headlines — প্রতি লাইনে একটি (৩–১৫টি, ≤৩০ অক্ষর)<textarea className="input font-mono text-xs" rows={5} value={xdForm.headlinesText} onChange={(e) => setXdForm({ ...xdForm, headlinesText: e.target.value })} /></label>
                        <label className="block text-sm">Descriptions — প্রতি লাইনে একটি (২–৪টি, ≤৯০ অক্ষর)<textarea className="input font-mono text-xs" rows={3} value={xdForm.descriptionsText} onChange={(e) => setXdForm({ ...xdForm, descriptionsText: e.target.value })} /></label>
                        <label className="block text-sm">Keywords — প্রতি লাইনে: text অথবা text|BROAD/PHRASE<textarea className="input font-mono text-xs" rows={4} value={xdForm.keywordsText} onChange={(e) => setXdForm({ ...xdForm, keywordsText: e.target.value })} /></label>
                      </>) : (<>
                        <label className="block text-sm">Ad Text (≤১০০ অক্ষর)<textarea className="input text-xs" rows={2} value={xdForm.adText} onChange={(e) => setXdForm({ ...xdForm, adText: e.target.value })} /></label>
                        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                          <label className="block text-sm">Landing URL<input className="input" value={xdForm.landingUrl} onChange={(e) => setXdForm({ ...xdForm, landingUrl: e.target.value })} /></label>
                          <label className="block text-sm">ছবির URL<input className="input" value={xdForm.imageUrl} onChange={(e) => setXdForm({ ...xdForm, imageUrl: e.target.value })} /></label>
                          <label className="block text-sm">ভিডিওর URL<input className="input" value={xdForm.videoUrl} onChange={(e) => setXdForm({ ...xdForm, videoUrl: e.target.value })} /></label>
                        </div>
                        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                          <label className="block text-sm">Objective
                            <select className="input" value={xdForm.objectiveType} onChange={(e) => setXdForm({ ...xdForm, objectiveType: e.target.value })}>
                              <option value="TRAFFIC">TRAFFIC</option>
                              <option value="WEB_CONVERSIONS">WEB_CONVERSIONS</option>
                              <option value="LEAD_GENERATION">LEAD_GENERATION</option>
                            </select>
                          </label>
                          <label className="block text-sm">Pixel ID (শুধু WEB_CONVERSIONS)<input className="input" value={xdForm.pixelId} onChange={(e) => setXdForm({ ...xdForm, pixelId: e.target.value })} /></label>
                          <label className="block text-sm">Optimization Event<input className="input" value={xdForm.optimizationEvent} onChange={(e) => setXdForm({ ...xdForm, optimizationEvent: e.target.value })} /></label>
                        </div>
                        <p className="text-xs text-slate-400">LEAD_GENERATION এই Flow-তে তৈরি হয় না (Ad-এর সঙ্গে Instant Form বাঁধা লাগে) — Draft-এ পছন্দটি থাকে, Readiness কারণসহ আটকায়।</p>
                      </>)}
                      <button className="btn-primary btn-sm" disabled={busy !== ""} onClick={async () => {
                        const countries = xdForm.countries.split(",").map((x: string) => x.trim()).filter(Boolean);
                        const lines = (v: string) => v.split("\n").map((x: string) => x.trim()).filter(Boolean);
                        const fields = d.platform === "google" && d.kind === "pmax" ? {
                          name: xdForm.name, dailyBudget: xdForm.dailyBudget, countryCodes: countries, finalUrl: xdForm.finalUrl,
                          businessName: xdForm.businessName, logoUrl: xdForm.logoUrl,
                          headlines: lines(xdForm.headlinesText), longHeadlines: lines(xdForm.longHeadlinesText),
                          descriptions: lines(xdForm.descriptionsText), imageUrls: lines(xdForm.imageUrlsText),
                        } : d.platform === "google" ? {
                          name: xdForm.name, dailyBudget: xdForm.dailyBudget, countryCodes: countries, finalUrl: xdForm.finalUrl,
                          headlines: lines(xdForm.headlinesText),
                          descriptions: lines(xdForm.descriptionsText),
                          keywords: xdForm.keywordsText.split("\n").map((x: string) => x.trim()).filter(Boolean).map((l: string) => { const [text, mt] = l.split("|").map((y) => y?.trim()); return { text, ...(mt ? { matchType: mt } : {}) }; }),
                        } : {
                          name: xdForm.name, dailyBudget: xdForm.dailyBudget, countryCodes: countries, adText: xdForm.adText, landingUrl: xdForm.landingUrl,
                          ...(xdForm.imageUrl ? { imageUrl: xdForm.imageUrl } : {}), ...(xdForm.videoUrl ? { videoUrl: xdForm.videoUrl } : {}),
                          objectiveType: xdForm.objectiveType || "TRAFFIC",
                          ...(xdForm.pixelId ? { pixelId: xdForm.pixelId } : {}), ...(xdForm.optimizationEvent ? { optimizationEvent: xdForm.optimizationEvent } : {}),
                        };
                        const res = await wrap(`xd-save-${d.id}`, () => apiFetch<{ problems: string[] }>(`/organizations/${orgId}/campaign-plans/${plan.id}/xdrafts/${d.id}`, { method: "PATCH", body: JSON.stringify({ fields }) }));
                        if (res) {
                          if (res.problems.length) setXdResult((s) => ({ ...s, [d.id]: `⚠ সেভ হয়েছে, কিন্তু ঘাটতি: ${res.problems.join(" · ")}` }));
                          else { setNotice("Draft সেভ হয়েছে — সব Field ঠিক আছে।"); setXdEditId(null); setXdForm(null); }
                          const list = await apiFetch<XDraft[]>(`/organizations/${orgId}/campaign-plans/${plan.id}/xdrafts`).catch(() => null);
                          if (list) setXdrafts(list);
                        }
                      }}>সেভ করুন</button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )) : null}
        </div>
      ) : null}

      <div className="card space-y-3 p-5">
        <div className="font-semibold">🔀 অন্য Ad Account-এ Clone <span className="text-xs font-normal text-slate-400">(Campaign Builder Next CN8)</span></div>
        <p className="text-xs text-slate-500">Plan টি অন্য Meta Account-এ নতুন DRAFT হিসেবে যাবে। Page/Pixel/Audience/Catalog শুধু তখনই যাবে যখন Target Account-এ তা যাচাই করা গেছে কিংবা আপনি আবার বেছে দিয়েছেন — বাকি সব Blocker হিসেবে তালিকায় আসবে, চুপচাপ যাবে না।</p>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input w-72" id="clone-account">
            <option value="">Target Meta Account বেছে নিন</option>
            {accountsHealth.filter((a) => a.platform === "meta" && a.id !== plan.adAccountId).map((a) => <option key={a.id} value={a.id}>{a.name} — Status: {a.health.platformStatusBucket}{a.health.connection === "none" ? " · API সংযোগ নেই" : ""}</option>)}
          </select>
          <input className="input w-44" id="clone-page" placeholder="Page ID (আবার বাছাই, ঐচ্ছিক)" />
          <input className="input w-44" id="clone-pixel" placeholder="Pixel ID (আবার বাছাই, ঐচ্ছিক)" />
          <button className="btn-primary btn-sm" disabled={busy !== ""} onClick={async () => {
            const target = (document.getElementById("clone-account") as HTMLSelectElement)?.value ?? "";
            if (!target) { setError("Target Account বেছে নিন — তালিকা খালি থাকলে আগে 🛡 Guardrails বোতামে Account Health লোড করুন"); return; }
            const pageId = (document.getElementById("clone-page") as HTMLInputElement)?.value.trim();
            const pixelId = (document.getElementById("clone-pixel") as HTMLInputElement)?.value.trim();
            const res = await wrap("clone", () => apiFetch<NonNullable<typeof cloneReport>>(`/organizations/${orgId}/campaign-plans/${plan.id}/clone-to-account`, { method: "POST", body: JSON.stringify({ targetAdAccountId: target, resolutions: { ...(pageId ? { pageId } : {}), ...(pixelId ? { pixelId } : {}) } }) }));
            if (res) { setCloneReport(res); setNotice(`Clone তৈরি: "${res.plan.name}" (${res.targetAccount.name}) — DRAFT। Blocker থাকলে নিচের তালিকা দেখুন।`); }
          }}>Clone করুন</button>
          <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
            const acc = await apiFetch<typeof accountsHealth>(`/organizations/${orgId}/campaign-plans/accounts/health`).catch(() => null);
            if (acc) setAccountsHealth(acc);
          }}>Account Health লোড</button>
        </div>
        {cloneReport ? (
          <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
            <p className="font-semibold text-sm">Mapping Report — {cloneReport.plan.name}</p>
            {cloneReport.blockers.length ? <div className="rounded bg-red-50 p-2 text-red-700">{cloneReport.blockers.map((b, i) => <p key={i}>⛔ {b}</p>)}</div> : <p className="text-emerald-700">✓ কোনো Blocker নেই — সব যাচাই/বাছাই সম্পূর্ণ।</p>}
            {cloneReport.mapping.map((m, i) => (
              <p key={i}><span className={m.outcome === "carried_verified" ? "font-semibold text-emerald-700" : m.outcome === "carried_user_confirmed" ? "font-semibold text-sky-700" : "font-semibold text-red-700"}>{m.outcome === "carried_verified" ? "✓ যাচাই হয়ে গেছে" : m.outcome === "carried_user_confirmed" ? "✓ আপনার বাছাই" : "✗ বাদ (Blocker)"}</span> {m.adSet} · {m.field}: {m.detail}</p>
            ))}
          </div>
        ) : null}
      </div>

      <div className="card space-y-3 p-5">
        <div className="font-semibold">📋 Lead Forms (Instant Forms) <span className="text-xs font-normal text-slate-400">(Campaign Builder Next CN4)</span></div>
        <p className="text-xs text-slate-500">ফর্ম এখানে মডেল করা হয়; Meta তে তৈরি হয় এই Plan এর Ad Account দিয়ে — Meta নিশ্চিত করলেই ফর্মটি &quot;তৈরি&quot; হিসেবে গণ্য হয়। তৈরি ফর্ম পরে সম্পাদনা করলে তা নতুন লোকাল ফর্মে পরিণত হয় (Meta তে ফর্ম Edit হয় না)। লিড এলে এখানকার Field Mapping অনুযায়ী CRM Lead এ ক্ষেত্র বসে।</p>
        {leadForms.length === 0 ? <p className="text-sm text-slate-400">এখনো কোনো Lead Form নেই।</p> : (
          <div className="space-y-2">
            {leadForms.map((f) => (
              <div key={f.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{f.name} <span className="text-xs text-slate-400">Page: {f.pageId}</span></span>
                  <span className={f.status === "created" ? "rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-semibold text-green-700" : f.status === "failed" ? "rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700" : "rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600"}>{f.status === "created" ? `Meta তে তৈরি · ${f.externalFormId}` : f.status === "failed" ? "Meta তে তৈরি ব্যর্থ" : "লোকাল"}</span>
                </div>
                {f.error ? <p className="mt-1 text-xs text-red-600">{f.error}</p> : null}
                {f.introHeadline ? <p className="mt-1 text-xs text-slate-500">শিরোনাম: {f.introHeadline}</p> : null}
                <div className="mt-1 text-xs text-slate-500">প্রশ্ন: {f.questions.map((q) => q.label ?? q.type).join(" · ")}</div>
                <div className="text-xs text-slate-500">Mapping: {Object.entries(f.fieldMapping ?? {}).map(([k, v]) => `${k} → ${v}`).join(", ") || "—"}{f.higherIntent ? " · Higher Intent (Review)" : ""}</div>
                {f.status !== "created" ? (
                  <button className="btn-secondary btn-sm mt-2" disabled={busy !== ""} onClick={async () => {
                    const res = await wrap(`lfmeta-${f.id}`, () => apiFetch(`/organizations/${orgId}/campaign-plans/lead-forms/${f.id}/create-on-meta`, { method: "POST", body: JSON.stringify({ adAccountId: plan.adAccountId }) }));
                    if (res) { setNotice("Meta ফর্ম তৈরি নিশ্চিত করেছে।"); await reloadLeadForms(); await loadPlan(plan.id); }
                    else await reloadLeadForms();
                  }}>Meta তে তৈরি করুন (এই Plan এর Ad Account দিয়ে)</button>
                ) : null}
              </div>
            ))}
          </div>
        )}
        {editable ? (
          <div className="space-y-2 border-t pt-3">
            <div className="text-sm font-semibold">নতুন Lead Form</div>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
              <label className="block text-sm">নাম<input className="input" value={leadFormForm.name} onChange={(e) => setLeadFormForm({ ...leadFormForm, name: e.target.value })} /></label>
              <label className="block text-sm">Facebook Page ID<input className="input" value={leadFormForm.pageId} onChange={(e) => setLeadFormForm({ ...leadFormForm, pageId: e.target.value })} /></label>
              <label className="block text-sm">শিরোনাম (Intro Headline)<input className="input" value={leadFormForm.introHeadline} onChange={(e) => setLeadFormForm({ ...leadFormForm, introHeadline: e.target.value })} /></label>
              <label className="block text-sm">Privacy Policy URL (https, বাধ্যতামূলক)<input className="input" value={leadFormForm.privacyPolicyUrl} onChange={(e) => setLeadFormForm({ ...leadFormForm, privacyPolicyUrl: e.target.value })} placeholder="https://example.com/privacy" /></label>
              <label className="block text-sm">ধন্যবাদ-শিরোনাম<input className="input" value={leadFormForm.thankYouTitle} onChange={(e) => setLeadFormForm({ ...leadFormForm, thankYouTitle: e.target.value })} placeholder="ধন্যবাদ!" /></label>
              <label className="block text-sm">Follow-up URL (ঐচ্ছিক)<input className="input" value={leadFormForm.followUpActionUrl} onChange={(e) => setLeadFormForm({ ...leadFormForm, followUpActionUrl: e.target.value })} /></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={leadFormForm.higherIntent} onChange={(e) => setLeadFormForm({ ...leadFormForm, higherIntent: e.target.checked })} /> Higher Intent (জমা দেওয়ার আগে Review)</label>
            </div>
            <label className="block text-sm">প্রশ্ন — প্রতি লাইনে: TYPE|key|Label|Option1,Option2 <span className="text-xs text-slate-400">(TYPE: FULL_NAME, EMAIL, PHONE, CITY, COUNTRY, POST_CODE, CUSTOM …)</span>
              <textarea className="input font-mono text-xs" rows={4} value={leadFormForm.questionsText} onChange={(e) => setLeadFormForm({ ...leadFormForm, questionsText: e.target.value })} />
            </label>
            <label className="block text-sm">Field Mapping — প্রতি লাইনে: questionKey=target <span className="text-xs text-slate-400">(target: name, email, phone, notes, custom:&lt;key&gt;{customFields.length ? ` — Custom Fields: ${customFields.map((c) => c.key).join(", ")}` : ""})</span>
              <textarea className="input font-mono text-xs" rows={3} value={leadFormForm.mappingText} onChange={(e) => setLeadFormForm({ ...leadFormForm, mappingText: e.target.value })} />
            </label>
            <button className="btn-primary btn-sm" disabled={busy !== ""} onClick={async () => {
              const questions = leadFormForm.questionsText.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
                const [type, key, label, opts] = l.split("|").map((x) => x?.trim());
                return { type, key, ...(label ? { label } : {}), ...(opts ? { options: opts.split(",").map((x) => x.trim()).filter(Boolean) } : {}) };
              });
              const fieldMapping: Record<string, string> = {};
              for (const line of leadFormForm.mappingText.split("\n")) {
                const [k, v] = line.split("=").map((x) => x?.trim());
                if (k && v) fieldMapping[k] = v;
              }
              const res = await wrap("lfcreate", () => apiFetch(`/organizations/${orgId}/campaign-plans/lead-forms`, {
                method: "POST",
                body: JSON.stringify({
                  name: leadFormForm.name, pageId: leadFormForm.pageId, introHeadline: leadFormForm.introHeadline || undefined,
                  privacyPolicyUrl: leadFormForm.privacyPolicyUrl, thankYouTitle: leadFormForm.thankYouTitle || undefined,
                  followUpActionUrl: leadFormForm.followUpActionUrl || undefined, higherIntent: leadFormForm.higherIntent,
                  questions, fieldMapping,
                }),
              }));
              if (res) { setNotice("Lead Form তৈরি হয়েছে (লোকাল)। Ad Set এ যোগ করে Publish করলে Meta তে তৈরি হবে, অথবা উপরের বোতামে এখনই তৈরি করুন।"); setLeadFormForm(emptyLeadForm); await reloadLeadForms(); }
            }}>ফর্ম তৈরি করুন (লোকাল)</button>
          </div>
        ) : null}
      </div>

      <div className="card space-y-3 p-5">
        <div className="font-semibold">🎯 Dynamic Retargeting প্রিসেট <span className="text-xs font-normal text-slate-400">(Campaign Builder Next CN3)</span></div>
        <p className="text-xs text-slate-500">বিদ্যমান Audience Record দিয়ে Retargeting Ad Set এর খসড়া বানায়। নতুন Audience তৈরি করা CN6 এর কাজ — এখানে শুধু তৈরি Record ব্যবহার হয়; না থাকলে ঠিক কী নেই তা জানানো হয়।</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-sm">ধরন
            <select className="input" value={preset.kind} onChange={(e) => setPreset({ ...preset, kind: e.target.value })}>
              <option value="product_viewers">Product Viewers</option>
              <option value="add_to_cart">Add-to-Cart (কিনেনি)</option>
            </select>
          </label>
          <label className="block text-sm">Audience Record
            <select className="input w-64" value={preset.audienceRecordId} onChange={(e) => setPreset({ ...preset, audienceRecordId: e.target.value })}>
              <option value="">(স্বয়ংক্রিয় — তৈরি Record খুঁজবে)</option>
              {audList.filter((a) => a.externalAudienceId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="block text-sm">নাম (ঐচ্ছিক)<input className="input" value={preset.name} onChange={(e) => setPreset({ ...preset, name: e.target.value })} /></label>
          <button className="btn-primary btn-sm" disabled={busy !== "" || !editable} onClick={async () => {
            const res = await wrap("preset", () => apiFetch<NonNullable<typeof presetResult>>(`/organizations/${orgId}/campaign-plans/${plan.id}/retargeting-preset`, { method: "POST", body: JSON.stringify({ kind: preset.kind, audienceRecordId: preset.audienceRecordId || undefined, name: preset.name || undefined, pixelId: plan.adSets[0]?.pixelId || undefined }) }));
            if (res) {
              setPresetResult(res);
              if (res.status === "created") { setNotice("Retargeting Ad Set (Draft) তৈরি হয়েছে।"); await loadPlan(plan.id); }
            }
          }}>প্রিসেট প্রয়োগ করুন</button>
        </div>
        {presetResult?.status === "missing" ? <p className="text-sm text-amber-600">তৈরি হয়নি — ঘাটতি: {(presetResult.missing ?? []).join(" · ")}</p> : null}
        {presetResult?.status === "needs_choice" ? (
          <div className="text-sm">
            <p className="text-slate-600">একাধিক তৈরি Audience Record আছে — একটি বেছে আবার চাপুন:</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {(presetResult.candidates ?? []).map((c) => <button key={c.id} className="btn-secondary btn-sm" onClick={() => setPreset({ ...preset, audienceRecordId: c.id })}>{c.name}</button>)}
            </div>
            {(presetResult.missing ?? []).length ? <p className="mt-1 text-xs text-slate-500">{(presetResult.missing ?? []).join(" · ")}</p> : null}
          </div>
        ) : null}
        {presetResult?.status === "created" && (presetResult.missing ?? []).length ? <p className="text-sm text-slate-500">তৈরি হয়েছে। নোট: {(presetResult.missing ?? []).join(" · ")}</p> : null}
      </div>

      <div id="cbx-step-review" className="card space-y-3 p-5">
        <div className="flex items-center justify-between">
          <div className="font-semibold">💬 আলোচনা ও কার্যক্রম <span className="text-xs font-normal text-slate-400">(Campaign Builder CB4)</span></div>
          <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
            const [c, t] = await Promise.all([
              apiFetch<NonNullable<typeof comments>>(`/organizations/${orgId}/campaign-plans/${plan.id}/comments`).catch(() => []),
              apiFetch<NonNullable<typeof timeline>>(`/organizations/${orgId}/campaign-plans/${plan.id}/timeline`).catch(() => []),
            ]);
            setComments(c); setTimeline(t);
          }}>লোড করুন</button>
        </div>
        {comments === null ? <p className="text-sm text-slate-400">মন্তব্য ও কার্যক্রম দেখতে "লোড করুন" চাপুন। অনুমোদনের সময় যা Submit হয়েছিল তার Snapshot সার্ভারে জমা থাকে — Publish এর সময় মিলিয়ে দেখা হয়।</p> : (
          <>
            <div className="space-y-2">
              {comments.length === 0 ? <p className="text-sm text-slate-400">এখনো কোনো মন্তব্য নেই।</p> : comments.map((c) => (
                <div key={c.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                  <span className="font-semibold">{c.authorName}</span> <span className="text-xs text-slate-400">{new Date(c.createdAt).toLocaleString("bn-BD")}</span>
                  <p className="mt-0.5 whitespace-pre-wrap">{mentionSegments(c.body, (c.mentions ?? []).map((m) => m.name)).map((seg, si) => seg.mention ? <span key={si} className="cbx-mention">{seg.text}</span> : <React.Fragment key={si}>{seg.text}</React.Fragment>)}</p>
                </div>
              ))}
            </div>
            {members.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-600">@ Mention:</span>
                <select className="input w-56" id="plan-mention-picker" defaultValue="" onChange={(e) => {
                  const m = members.find((x) => x.user.id === e.target.value);
                  const el = document.getElementById("plan-comment") as HTMLInputElement | null;
                  if (m && el) { el.value = `${el.value}${el.value && !el.value.endsWith(" ") ? " " : ""}@${m.user.name} `; el.focus(); }
                  e.target.value = "";
                }}>
                  <option value="">সদস্য বেছে Mention করুন</option>
                  {members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.name} ({m.role})</option>)}
                </select>
                <span className="text-xs text-slate-400">বাছাই করলে মন্তব্য বাক্সে @নাম বসবে — সার্ভার Mention টি যাচাই করে জানিয়ে দেয়।</span>
              </div>
            ) : null}
            <div className="flex gap-2">
              <input className="input flex-1" id="plan-comment" placeholder="মন্তব্য লিখুন — যেমন: বাজেট ঠিক আছে, কপিটা বদলান" maxLength={2000} />
              <button className="btn-primary btn-sm" disabled={busy !== ""} onClick={async () => {
                const v = (document.getElementById("plan-comment") as HTMLInputElement)?.value ?? "";
                if (!v.trim()) { setError("মন্তব্য লিখুন"); return; }
                const res = await wrap("comment", () => apiFetch(`/organizations/${orgId}/campaign-plans/${plan.id}/comments`, { method: "POST", body: JSON.stringify({ body: v }) }));
                if (res) {
                  (document.getElementById("plan-comment") as HTMLInputElement).value = "";
                  const c = await apiFetch<NonNullable<typeof comments>>(`/organizations/${orgId}/campaign-plans/${plan.id}/comments`).catch(() => comments);
                  setComments(c); setNotice("মন্তব্য যোগ হয়েছে।");
                }
              }}>মন্তব্য করুন</button>
            </div>
            {timeline && timeline.length > 0 ? (
              <div className="border-t pt-2">
                <div className="text-sm font-semibold">🕘 কার্যক্রমের ইতিহাস</div>
                <div className="mt-1 space-y-1">
                  {timeline.slice(0, 20).map((e, i) => (
                    <div key={i} className="flex items-baseline justify-between gap-2 text-xs">
                      <span><span className="font-medium">{e.title}</span>{e.detail ? <span className="text-slate-500"> — {e.detail}</span> : null}</span>
                      <span className="shrink-0 text-slate-400">{new Date(e.at).toLocaleString("bn-BD")}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>


      <div className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">🗂 Plan Versions <span className="text-xs font-normal text-slate-400">(Campaign Builder Next CN11)</span></div>
          <span className="flex gap-2">
            <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
              const res = await wrap("versions", () => apiFetch<NonNullable<typeof versions>>(`/organizations/${orgId}/campaign-plans/${plan.id}/versions`));
              if (res) setVersions(res);
            }}>তালিকা লোড করুন</button>
            <button className="btn-primary btn-sm" disabled={busy !== ""} onClick={async () => {
              const res = await wrap("snapshot", () => apiFetch(`/organizations/${orgId}/campaign-plans/${plan.id}/versions`, { method: "POST", body: JSON.stringify({}) }));
              if (res) {
                setNotice("বর্তমান Plan এর Snapshot নেওয়া হয়েছে।");
                const list = await apiFetch<NonNullable<typeof versions>>(`/organizations/${orgId}/campaign-plans/${plan.id}/versions`).catch(() => null);
                if (list) setVersions(list);
              }
            }}>📸 Snapshot নিন</button>
          </span>
        </div>
        {busy === "versions" || busy === "snapshot" ? <div className="space-y-2"><div className="cbx-skel" style={{ height: 18 }} /><div className="cbx-skel" style={{ height: 18 }} /></div> : null}
        {versions === null ? <p className="text-sm text-slate-400">Version ইতিহাস দেখতে "তালিকা লোড করুন" চাপুন। Submit এর সময়কার Snapshot ও হাতে নেওয়া Snapshot এখানে থাকে।</p> : versions.length === 0 ? (
          <div className="cbx-empty"><p className="cbx-empty-title">এখনো কোনো Version নেই</p><p className="cbx-empty-text">উপরে "📸 Snapshot নিন" চেপে বর্তমান অবস্থার একটি সংস্করণ জমা রাখুন।</p></div>
        ) : (
          <div className="space-y-2">
            {versions.map((v) => (
              <div key={v.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{v.kind === "submit" ? "Submit Snapshot" : v.kind === "manual" ? "হাতে নেওয়া Snapshot" : v.kind} <span className="text-xs text-slate-400">· {new Date(v.createdAt).toLocaleString("bn-BD")}</span></span>
                  <span className="flex gap-1">
                    <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                      const res = await wrap(`vdiff-${v.id}`, () => apiFetch<{ differs: boolean; summary: NonNullable<typeof versionDiffs>[string]["summary"] }>(`/organizations/${orgId}/campaign-plans/${plan.id}/versions/${v.id}/diff`));
                      if (res) setVersionDiffs((s) => ({ ...s, [v.id]: res }));
                    }}>Diff দেখুন</button>
                    <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                      if (!window.confirm("এই Version থেকে একটি নতুন Draft Plan তৈরি হবে। বর্তমান Plan টি অপরিবর্তিত থাকবে — Restore মানে বর্তমান Plan বদলে যাওয়া নয়। এগিয়ে যাবেন?")) return;
                      const res = await wrap(`vrestore-${v.id}`, () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/versions/${v.id}/restore`, { method: "POST", body: JSON.stringify({}) }));
                      if (res) { setPlan(res); setVersions(null); setNotice(`নতুন Draft তৈরি হয়েছে Version থেকে: "${res.name}" — বর্তমান (আগের) Plan টি অপরিবর্তিত আছে, এটি তার আলাদা কপি।`); window.scrollTo({ top: 0 }); }
                    }}>Restore (নতুন Draft)</button>
                  </span>
                </div>
                {versionDiffs[v.id] ? (
                  <p className="mt-1 text-xs text-slate-600">{versionDiffs[v.id].differs ? <>বর্তমান Plan এর সাথে পার্থক্য: Ad Set +{versionDiffs[v.id].summary.adSetsAdded} / −{versionDiffs[v.id].summary.adSetsRemoved} / বদলেছে {versionDiffs[v.id].summary.adSetsChanged} · Ad +{versionDiffs[v.id].summary.adsAdded} / −{versionDiffs[v.id].summary.adsRemoved} / বদলেছে {versionDiffs[v.id].summary.adsChanged}{versionDiffs[v.id].summary.topLevelChanged.length ? ` · শীর্ষ-স্তরে বদল: ${versionDiffs[v.id].summary.topLevelChanged.join(", ")}` : ""}</> : "বর্তমান Plan এর সাথে কোনো পার্থক্য নেই।"}</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      </div>
      <aside className="cbx-rail mt-6 space-y-4 lg:mt-0">
        <div>
          <p className="cbx-rail-title">✅ Readiness + 👁 Preview</p>
          {busy === "ready" ? <div className="mt-2 space-y-2"><div className="cbx-skel" style={{ height: 18 }} /><div className="cbx-skel" style={{ height: 18 }} /><div className="cbx-skel" style={{ height: 18 }} /></div> : null}
          {readiness ? (
            <div className={`mt-2 space-y-1 rounded-xl border p-3 text-sm ${readiness.ready ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
              <p className="font-semibold">{readiness.ready ? "✅ Readiness: প্রকাশের জন্য প্রস্তুত" : "⛔ Readiness: সমস্যা আছে"}</p>
              {readiness.checks.map((c, i) => (
                <div key={i} className="text-xs">
                  <span className={c.level === "error" ? "font-semibold text-red-700" : c.level === "warn" ? "font-semibold text-amber-700" : "font-semibold text-emerald-700"}>{c.level === "error" ? "✗" : c.level === "warn" ? "⚠" : "✓"} {c.label}:</span>{" "}
                  <span className="text-slate-600">{c.detail}</span>
                </div>
              ))}
              <p className="text-xs text-slate-500">
                {readiness.estimate.available
                  ? `📈 Meta এর আনুমানিক Reach (প্রথম Ad Set): ${readiness.estimate.lowerBound?.toLocaleString()} – ${readiness.estimate.upperBound?.toLocaleString()} জন — এটি Meta এর মডেল-ভিত্তিক Estimate, প্রতিশ্রুতি নয়।`
                  : `📈 Reach Estimate পাওয়া যায়নি: ${readiness.estimate.reason ?? ""}`}
              </p>
              {readiness.estimates && readiness.estimates.length > 1 ? (
                <div className="space-y-0.5">
                  {readiness.estimates.map((e) => (
                    <p key={e.adSetId} className="text-xs text-slate-500">📈 {e.name}: {e.available ? `${e.lowerBound?.toLocaleString()} – ${e.upperBound?.toLocaleString()} জন (Meta Estimate)` : `পাওয়া যায়নি — ${e.reason ?? ""}`}</p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {!readiness && busy !== "ready" ? <p className="mt-2 text-xs text-slate-500">Readiness যাচাই এখনো চালানো হয়নি — উপরের "✅ Readiness যাচাই" বোতামে চালালে চেকলিস্ট এখানে আটকে (Sticky) থাকবে।</p> : null}
          {(() => { const ad = previewAdId ? plan.adSets.flatMap((s) => s.ads).find((a) => a.id === previewAdId) : null; return ad ? <div className="mt-2 overflow-x-auto"><AdPreview ad={ad} pageName={plan.name} /></div> : <p className="mt-2 text-xs text-slate-500">কোনো Ad এর "👁 Preview" চাপলে তার Placement Preview এখানেও আটকে থাকবে।</p>; })()}
        </div>
        <div className="border-t pt-3">
          <p className="cbx-rail-title">🏛 অনুমোদন কাঠামো (CN11)</p>
          {twoStep === null ? <p className="mt-1 text-xs text-slate-500">অনুমোদন সেটিং লোড হয়নি।</p> : myRole === "OWNER" || myRole === "ADMIN" ? (
            <label className="mt-2 flex min-h-[44px] cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={twoStep} onChange={async (e) => {
                const next = e.target.checked;
                const res = await wrap("chain", () => apiFetch<{ twoStepApproval: boolean }>(`/organizations/${orgId}/campaign-plans/settings/approval-chain`, { method: "PATCH", body: JSON.stringify({ twoStepApproval: next }) }));
                if (res) { setTwoStep(res.twoStepApproval); setNotice(res.twoStepApproval ? "দুই ধাপের অনুমোদন চালু হয়েছে — এখন থেকে Pending Plan এ দুইজন আলাদা Approver লাগবে।" : "দুই ধাপের অনুমোদন বন্ধ — আগের মতো এক ধাপের অনুমোদন চলবে।"); }
              }} />
              <span>দুই ধাপের অনুমোদন (Two-step) {twoStep ? "চালু আছে" : "বন্ধ আছে"}</span>
            </label>
          ) : <p className="mt-1 text-xs text-slate-600">দুই ধাপের অনুমোদন: <b>{twoStep ? "চালু আছে" : "বন্ধ আছে"}</b> — বদলাতে OWNER/ADMIN লাগবে।</p>}
          {plan.status === "pending_approval" && plan.firstApproverId ? <p className="mt-1 text-xs font-semibold text-amber-700">প্রথম অনুমোদন সম্পন্ন — দ্বিতীয় অনুমোদন বাকি</p> : null}
        </div>
      </aside>
      </div>

      <div className="cbx-mobile-bar">
        <span className={`cbx-pill cbx-pill-${plan.status}`}>{STATUS_LABEL[plan.status] ?? plan.status}</span>
        {editable ? <button type="button" className="btn-primary btn-sm flex-1" disabled={busy !== ""} onClick={() => action("submit", "submit")}>অনুমোদনের জন্য পাঠান</button> : null}
        {plan.status === "pending_approval" ? <><button type="button" className="btn-success btn-sm flex-1" disabled={busy !== ""} onClick={() => action("approve", "approve")}>Approve করুন (Owner/Admin)</button><button type="button" className="rounded-lg border px-3 py-2 text-sm font-semibold text-red-600" onClick={rejectPlan}>Reject</button></> : null}
        {(plan.status === "approved" || plan.status === "publish_failed") ? <button type="button" className="btn-primary btn-sm flex-1" disabled={busy !== ""} onClick={() => action("publish", "publish")}>{busy === "publish" ? "Publish হচ্ছে..." : plan.status === "publish_failed" ? "আবার Publish চেষ্টা (Resume)" : "Meta তে Publish করুন (PAUSED)"}</button> : null}
        {plan.status === "published" && plan.metaStatus !== "ACTIVE" ? <button type="button" className="btn-success btn-sm flex-1" disabled={busy !== ""} onClick={() => action("activate", "activate")}>সক্রিয় করুন (খরচ শুরু হবে)</button> : null}
        {plan.status === "published" && plan.metaStatus === "ACTIVE" ? <button type="button" className="btn-warning btn-sm flex-1" disabled={busy !== ""} onClick={() => action("pause", "pause")}>Pause করুন</button> : null}
      </div>
      {plan.publishLogs.length > 0 ? (
        <div className="card p-5">
          <div className="font-semibold">Publish Log (প্রতিটি Meta কলের রেকর্ড)</div>
          <div className="mt-2 space-y-1">
            {plan.publishLogs.map((l) => (
              <div key={l.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
                <span><span className="font-medium capitalize">{l.step}</span> · {new Date(l.createdAt).toLocaleString()}</span>
                <span className={l.status === "success" ? "text-green-600" : "text-red-600"}>{l.status}{l.externalId ? ` · ${l.externalId}` : ""}{l.error ? ` · ${l.error}` : ""}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
