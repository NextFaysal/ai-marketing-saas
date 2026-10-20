"use client";
import React, { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { asList } from "@/lib/as-list";
import { getOrganizationId } from "@/lib/org";

const ExperimentsDrawer = dynamic(() => import("./ExperimentsDrawer"), { ssr: false });
const SeriesDrawer = dynamic(() => import("./SeriesDrawer"), { ssr: false });
import { fmtDateTime, fmtMoney, fmtMoneyMinor, fmtNumber, intlLocaleOf } from "@repo/contracts";
import { mentionSegments } from "@/lib/campaign-cn10";
import { useLocale } from "@/lib/i18n/provider";
import { chipForStep, chipSymbol, createSaverRegistry, markDirty, markFailed, markSaved, readinessCounts, runStepSavers, saveStateLabel, startSaving, stepIndexForKey, type SaveState } from "@/lib/campaign-step-shell";

interface AdAccount { id: string; name: string; platform: string; sourceType: string; externalId?: string | null; platformStatusBucket?: string | null; integrationId?: string | null }
interface Product { id: string; name: string; priceMinor: string; currency: string }
interface AdItem { id: string; name: string; primaryText: string; headline?: string | null; description?: string | null; linkUrl: string; callToAction?: string; imageUrl?: string | null; format?: string; externalAdId?: string | null; createdByAi: boolean; effectiveStatus?: string | null; issuesInfo?: unknown; textOptions?: { primaryTexts: string[]; headlines: string[]; descriptions: string[]; locales?: Record<string, { primaryTexts: string[]; headlines: string[]; descriptions: string[] }> } | null; placementAssets?: { version: number; placements: { feed?: { imageAssetId?: string; videoAssetId?: string; imageUrl?: string }; vertical?: { imageAssetId?: string; videoAssetId?: string; imageUrl?: string } }; feedImageUrl?: string; verticalImageUrl?: string } | null; creativeEnhancements?: Record<string, boolean> | null; whatsappWelcome?: { greetingText?: string; prefillMessage?: string; iceBreakers?: string[] } | null }

// Campaign Builder CB3: placement preview frames. A
// mock frame around the ad's REAL content — not a Meta
// render.
function AdPreview({ ad, pageName }: { ad: AdItem; pageName: string }) {
  const { t } = useLocale();
  const domain = (() => { try { return new URL(ad.linkUrl).hostname; } catch { return ad.linkUrl; } })();
  // CN5: placement-specific media wins in its frame when set.
  const feedUrl = ad.placementAssets?.feedImageUrl ?? ad.imageUrl;
  const verticalUrl = ad.placementAssets?.verticalImageUrl ?? ad.imageUrl;
  const mediaFor = (url?: string | null) => url
    ? <img src={url} alt="" className="h-full w-full object-cover" />
    : <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-200 to-slate-300 text-xs text-slate-500">{ad.format === "video" ? t("campaignBuilder.previewVideo") : ad.format === "carousel" ? "🎠 Carousel" : t("campaignBuilder.previewNoImage")}</div>;
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
      <div className="mb-2 text-xs font-semibold text-slate-500">{t("campaignBuilder.previewTitle")}</div>
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
interface AdSet { id: string; name: string; dailyBudgetMinor?: string | null; lifetimeBudgetMinor?: string | null; optimizationGoal: string; pageId?: string | null; pixelId?: string | null; targeting: { countries?: string[]; ageMin?: number; ageMax?: number; genders?: number[]; interests?: TEntry[]; behaviors?: TEntry[]; narrowInterests?: TEntry[]; narrowBehaviors?: TEntry[]; cities?: { key: string; name?: string; radius?: number; distanceUnit?: string }[]; postcodes?: string[]; locationTypes?: string[]; locales?: number[]; demographics?: { educationStatuses?: number[]; relationshipStatuses?: number[]; lifeEvents?: TEntry[]; workPositions?: TEntry[] }; targetingExpansion?: boolean; platforms?: string[]; positions?: string[]; devices?: string[]; customAudienceIds?: string[]; excludedAudienceIds?: string[]; regions?: { key: string; name?: string }[]; exclusionPresets?: { key: string; label: string; audienceRecordId: string; externalAudienceId: string }[] }; bidStrategy?: string | null; bidAmountMinor?: string | null; costGoalMinor?: string | null; roasAverageFloor?: number | null; conversionEvent?: string | null; catalogRecordId?: string | null; productSetId?: string | null; leadFormId?: string | null; appId?: string | null; appStoreUrl?: string | null; destinationType?: string | null; whatsappIntegrationId?: string | null; whatsappPhoneNumberId?: string | null; whatsappPhoneNumber?: string | null; funnelLayer?: string | null; funnelIncomplete?: string | null; __catalog?: { id: string; name: string } | null; __productSet?: { id: string; name: string; status: string; externalSetId?: string | null } | null; __leadForm?: { id: string; name: string; status: string; externalFormId?: string | null } | null; externalAdSetId?: string | null; effectiveStatus?: string | null; startTime?: string | null; endTime?: string | null; daypart?: { day: number; startHour: number; endHour: number }[] | null; ads: AdItem[] }

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
interface StudioRecord { id: string; name: string; kind: string; source: string; status: string; externalAudienceId?: string | null; approximateCount?: number | null; lastMembershipCount?: number | null; performance?: { spend: number; impressions: number; clicks: number; conversions: number; cpa: number | null; ctr: number | null; windowDays: number; adSetsCounted: number } | null }
interface StudioData { available: boolean; reason?: string; sources: StudioSource[]; records: StudioRecord[]; presets: { key: string; label: string; source: string; segment?: string | null }[] }
interface AudienceInsights { included: { externalAudienceId: string; name: string | null; size: number | null; sizeSource: string | null }[]; excluded: { externalAudienceId: string; name: string | null; size: number | null; sizeSource: string | null }[]; warnings: { code: string; message: string }[]; overlap: { status: string; reason: string }; estimate: { available: boolean; reason?: string; lowerBound?: number; upperBound?: number; currency?: string } }

// Campaign Builder CB1: placement vocabularies.
const PLATFORM_OPTS = [{ v: "facebook", l: "Facebook" }, { v: "instagram", l: "Instagram" }, { v: "audience_network", l: "Audience Network" }, { v: "messenger", l: "Messenger" }];
const POSITION_OPTS = [{ v: "feed", l: "Feed" }, { v: "reels", l: "Reels" }, { v: "story", l: "Story" }, { v: "search", l: "Search" }];
const DEVICE_OPTS = [{ v: "mobile", l: "Mobile" }, { v: "desktop", l: "Desktop" }];

function PlacementChecks({ values, onChange }: { values: { platforms: string[]; positions: string[]; devices: string[] }; onChange: (next: { platforms: string[]; positions: string[]; devices: string[] }) => void }) {
  const { t } = useLocale();
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
      <div className="text-sm font-semibold">{t("campaignBuilder.placementTitle")}<span className="font-normal text-slate-500">{t("campaignBuilder.placementNote")}</span></div>
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
  adAccountId: string; id: string; name: string; objective: string; status: string; advantagePlus?: boolean; advantageState?: string | null; advantageStateCheckedAt?: string | null; budgetMode?: string; campaignDailyBudgetMinor?: string | null; campaignLifetimeBudgetMinor?: string | null; dailyBudgetCapMinor?: string | null; metaStatus?: string | null; metaEffectiveStatus?: string | null; lastStatusSyncAt?: string | null; healthIssues?: { level: string; name: string; status: string }[]; externalCampaignId?: string | null; approvedById?: string | null; firstApproverId?: string | null; firstApprovedAt?: string | null; approvalState?: { twoStep: boolean; step: number; awaitingSecond: boolean } | null; rejectionReason?: string | null; abGroupId?: string | null; publishAt?: string | null; pauseAt?: string | null; resumeAt?: string | null; pauseExecutedAt?: string | null; resumeExecutedAt?: string | null; seriesId?: string | null; seriesInstanceDate?: string | null; adSets: AdSet[]; publishLogs: PublishLog[] }

const STATUS_KEY: Record<string, string> = {
  draft: "", pending_approval: "campaignBuilder.statusPending", approved: "campaignBuilder.statusApproved", rejected: "campaignBuilder.statusRejected",
  publishing: "campaignBuilder.statusPublishing", published: "campaignBuilder.statusPublished", publish_failed: "campaignBuilder.statusPublishFailed",
};

// Campaign Builder Frontier NB7 (CN15/CN16): Meta Experiment
// rows + recurring-series views live in the extracted drawers
// (dynamic payloads — read defensively with ?.).
import type { ExperimentRow, ExpReadback } from "./ExperimentsDrawer";
import type { SeriesRow } from "./SeriesDrawer";
/** CA13: client mirror of the server naming renderer,
 * used ONLY for the settings live preview with sample
 * values (the server re-renders authoritatively). Empty
 * tokens vanish with their separators. */
function renderNamingPreview(template: string): string {
  const values: Record<string, string> = { product: "Panjabi", audience: "Dhaka Men", objective: "OUTCOME_SALES", date: "2026-10-17", platform: "Meta" };
  if (!template) return "";
  const parts: { lit?: string; tok?: string }[] = [];
  const re = /\{([a-zA-Z]+)\}/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(template))) { if (m.index > last) parts.push({ lit: template.slice(last, m.index) }); parts.push({ tok: m[1].toLowerCase() }); last = m.index + m[0].length; }
  if (last < template.length) parts.push({ lit: template.slice(last) });
  const isSep = (s: string) => /^[\s\-_./|]+$/.test(s);
  let out = ""; let pendingSep = "";
  for (const p of parts) {
    if (p.lit !== undefined) {
      if (isSep(p.lit)) { pendingSep = p.lit; continue; }
      const lead = p.lit.match(/^[\s\-_./|]+/)?.[0] ?? "";
      const trail = p.lit.match(/[\s\-_./|]+$/)?.[0] ?? "";
      const core = p.lit.slice(lead.length, p.lit.length - trail.length);
      if (out && (pendingSep || lead)) out += pendingSep || lead;
      out += core; pendingSep = trail; continue;
    }
    const v = (values[p.tok!] ?? "").trim();
    if (!v) continue;
    if (out && pendingSep) out += pendingSep;
    pendingSep = ""; out += v;
  }
  return out.replace(/^[\s\-_./|]+/, "").replace(/[\s\-_./|]+$/, "").trim().slice(0, 200);
}

export default function CampaignBuilderPage() {
  const { t, locale } = useLocale();
  const params = useSearchParams();
  // ML6: locale-aware replacements for the bn-only money-bn
  // helpers (the lib stays untouched — other pages use it).
  const fmtMoneyBn = (minor: string | bigint | number | null | undefined): string =>
    minor === null || minor === undefined || minor === "" ? "—" : fmtMoneyMinor(locale, typeof minor === "bigint" ? minor : BigInt(String(minor).trim()));
  const fmtNumBn = (n: number | null | undefined): string =>
    n === null || n === undefined || !Number.isFinite(n) ? "—" : fmtNumber(locale, n);
  const statusLabel = (status: string): string => (STATUS_KEY[status] ? t(STATUS_KEY[status]) : status === "draft" ? "Draft" : status);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [createForm, setCreateForm] = useState({ name: "", objective: "OUTCOME_SALES", adAccountId: "", budgetMode: "abo", campaignDailyBudget: "", campaignLifetimeBudget: "", useNamingTemplate: false });
  const emptyAdSetForm = { name: "", dailyBudget: "", optimizationGoal: "LINK_CLICKS", pageId: "", pixelId: "", countries: "BD", interests: "", audienceIds: "", excludeIds: "", cities: "", postcodes: "", locationTypes: "", locales: "", behaviors: "", narrowInterests: "", eduStatuses: "", relStatuses: "", lifeEvents: "", workPositions: "", bidStrategy: "", bidAmount: "", costPerResultGoal: "", roasGoal: "", conversionEvent: "", catalogRecordId: "", productSetId: "", leadFormId: "", destinationType: "", whatsappIntegrationId: "", appId: "", appStoreUrl: "" };
  const [adSetForm, setAdSetForm] = useState(emptyAdSetForm);
  const [expansion, setExpansion] = useState(false);
  // Campaign Builder Next CN1: targeting search state.
  const [tSearch, setTSearch] = useState<{ kind: string; query: string; available?: boolean; reason?: string; results: { id: string; name: string | null; audienceSizeLower: number | null; audienceSizeUpper: number | null }[] }>({ kind: "interest", query: "", results: [] });
  // Campaign Builder Next CN2: pacing state.
  // CA18 (CB5): runway rides the pacing payload; alerts
  // come from the pacing-alerts endpoint (raised by the
  // per-org Pacing Alert Sweep job).
  type PacingRunway = { available: boolean; label: string; reason?: string; metricDays?: number; burnMinorPerDay?: string; remainingMinor?: string; runwayDays?: number; projectedExhaustionDate?: string; exhausted?: boolean };
  type PacingAlertRec = { id: string; kind: string; status: string; message: string; raisedAt: string | null };
  const [pacing, setPacing] = useState<{ published: boolean; status: string; spentMinor: string; expectedMinor: string | null; varianceMinor: string | null; daysElapsed: number | null; daysTotal: number | null; budgetMode?: string; runway?: PacingRunway } | null>(null);
  const [pacingAlerts, setPacingAlerts] = useState<{ active: PacingAlertRec[]; thresholds: { exhaustionMarginDays: number; overspendPercent: number } } | null>(null);
  // Campaign Builder CB1: placements + inline editing.
  const [placements, setPlacements] = useState<{ platforms: string[]; positions: string[]; devices: string[] }>({ platforms: [], positions: [], devices: [] });
  const [editSetId, setEditSetId] = useState<string | null>(null);
  const [editAdId, setEditAdId] = useState<string | null>(null);
  // CA27: per-ad version history + catalog carousel preview.
  const [adVersionsOpen, setAdVersionsOpen] = useState<string | null>(null);
  const [adVersionList, setAdVersionList] = useState<{ id: string; version: number; source: string; createdAt: string }[]>([]);
  const [adDiff, setAdDiff] = useState<{ adId: string; version: number; changes: { field: string; versionValue: unknown; currentValue: unknown }[]; identical: boolean } | null>(null);
  const [carouselPreview, setCarouselPreview] = useState<{ adId: string; cards: { title: string }[] } | null>(null);
  // CA28: landing created/offered from the builder.
  const [landingOffer, setLandingOffer] = useState<{ adId: string; landing: { id: string; slug: string; status: string }; url: string | null; path: string; note: string; existing: { id: string; slug: string; status: string; url: string | null; path: string }[] } | null>(null);
  const [adSetStart, setAdSetStart] = useState("");
  const [adSetEnd, setAdSetEnd] = useState("");
  type AdForm = { name: string; primaryText: string; headline: string; linkUrl: string; imageUrl: string; format: string; imageAssetId: string; videoAssetId: string; carouselText: string; extraTexts: string; extraHeadlines: string; descriptions: string; feedAssetId: string; verticalAssetId: string; verticalVideoAssetId: string; enhancements: Record<string, boolean>; waGreeting: string; waPrefill: string; waIce: string };
  const emptyAdForm: AdForm = { name: "", primaryText: "", headline: "", linkUrl: "", imageUrl: "", format: "link", imageAssetId: "", videoAssetId: "", carouselText: "", extraTexts: "", extraHeadlines: "", descriptions: "", feedAssetId: "", verticalAssetId: "", verticalVideoAssetId: "", enhancements: {}, waGreeting: "", waPrefill: "", waIce: "" };
  const [adForms, setAdForms] = useState<Record<string, AdForm>>({});
  const [assets, setAssets] = useState<{ id: string; kind: string; name: string; status: string; adAccountId: string }[]>([]);
  // CA25: per-asset REAL past performance (ad-level metrics
  // only) + the picker sort. Unrated assets show তথ্য নেই
  // and never rank above rated ones in performance sort.
  const [assetPerf, setAssetPerf] = useState<Record<string, { rated: boolean; ctrPct: number | null; cpaMinor: number | null }>>({});
  const [pickerSort, setPickerSort] = useState<"newest" | "best">("newest");
  function perfOf(id: string, source: "creative" | "media" = "creative") { return assetPerf[`${source}:${id}`]; }
  function assetOptLabel(x: { id: string; name: string }, source: "creative" | "media" = "creative") {
    const p = perfOf(x.id, source);
    if (!p || !p.rated) return `${x.name}${t("campaignBuilder.assetNoInfo")}`;
    return `${x.name}${t("campaignBuilder.assetBest", { ctr: p.ctrPct ?? "", cpa: p.cpaMinor != null ? t("campaignBuilder.assetBestCpa", { amount: fmtMoney(locale, Math.round(p.cpaMinor / 100)) }) : "" })}`;
  }
  function sortPicker<T extends { id: string }>(list: T[], source: "creative" | "media" = "creative"): T[] {
    if (pickerSort === "newest") return list;
    return [...list].sort((a, b) => {
      const pa = perfOf(a.id, source); const pb = perfOf(b.id, source);
      const ra = pa?.rated ? 1 : 0; const rb = pb?.rated ? 1 : 0;
      if (ra !== rb) return rb - ra;
      if (ra && rb) return (pb?.ctrPct ?? 0) - (pa?.ctrPct ?? 0);
      return 0;
    });
  }
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
  // CA20 (CB5): per-form lead quality (real CRM rows).
  type LeadFormQuality = { minLeads: number; coverage: { attributedLeads: number; unattributedLeadAdsLeads: number }; forms: { formId: string; totalLeads: number; belowThreshold: boolean; thresholdNote: string | null; stages: Record<string, number>; qualified: number; convertedToOrder: number; qualifiedRate: number | null; orderRate: number | null; costPerQualifiedMinor: string | null; costNote: string | null; feedback: { sent: number; failed: number; lastSentAt: string | null } }[] };
  const [leadQuality, setLeadQuality] = useState<LeadFormQuality | null>(null);
  const [customFields, setCustomFields] = useState<CustomFieldLite[]>([]);
  const emptyLeadForm = { name: "", pageId: "", introHeadline: "", privacyPolicyUrl: "", thankYouTitle: "", followUpActionUrl: "", higherIntent: false, questionsText: "FULL_NAME|full_name\nEMAIL|email\nPHONE|phone_number", mappingText: "full_name=name\nemail=email\nphone_number=phone" };
  const [leadFormForm, setLeadFormForm] = useState(emptyLeadForm);
  const [preset, setPreset] = useState<{ kind: string; audienceRecordId: string; name: string }>({ kind: "product_viewers", audienceRecordId: "", name: "" });
  const [presetResult, setPresetResult] = useState<{ status: string; missing?: string[]; candidates?: { id: string; name: string; externalAudienceId?: string | null }[]; adSetId?: string } | null>(null);
  const [savedList, setSavedList] = useState<{ id: string; name: string; targeting: Record<string, unknown> }[]>([]);
  const [templates, setTemplates] = useState<{ id: string; name: string; objective: string }[]>([]);
  const [blueprints, setBlueprints] = useState<{ id?: string | null; key: string; name: string; description: string; scope?: string; editable?: boolean }[]>([]);
  const [bpForm, setBpForm] = useState({ blueprintKey: "", blueprintId: "", adAccountId: "", productId: "" });
  const [copySelection, setCopySelection] = useState<Record<string, string>>({});
  // CA1: per-ad-set AI image prompt (the generated asset lands
  // in the Creative Library, not directly in an ad).
  const [imagePrompts, setImagePrompts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [preflight, setPreflight] = useState<{ checkedAds: number; findings: { adName: string; field: string; severity: string; snippet: string; explanation: string; suggestion: string }[]; summary: { high: number; medium: number; low: number }; platformChecks?: { key: string; subject: string; status: string; label: string; detail: string }[] } | null>(null);
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
  const [perf, setPerf] = useState<{ published: boolean; attribution?: { firstParty: { windowDays: number | null; source: string }; platforms: { platform: string; configured: boolean; windowDays: number | null; display: string }[] }; totals: { spendMinor: string; impressions: number; clicks: number; conversions: number; ctrPercent: number | null; cpaMinor: string | null; firstPartyRevenueMinor: string; firstPartyOrders: number; roas: number | null } | null; perAdSet: { adSetId: string; name: string; spendMinor: string; impressions: number; clicks: number; conversions: number }[] } | null>(null);
  // CA21 (CB5): COD return-adjusted ROAS (raw beside adjusted).
  type AdjRoas = { available: boolean; reason?: string; scope: string; spendMinor?: string; codMatchedOrders?: number; deliveredOrders?: number; returnedOrders?: number; returnedValueMinor?: string; grossRevenueMinor?: string; refundedMinor?: string; adjustedRevenueMinor?: string; rawRoas?: number | null; adjustedRoas?: number | null; zeroSpendNote?: string | null; existingFirstParty?: { revenueMinor: string; orders: number; roas: number | null; note: string } | null };
  const [adjRoas, setAdjRoas] = useState<AdjRoas | null>(null);
  // Campaign Builder Next NB4 (CN7/CN8/CN9).
  type BreakdownDim = { hasData: boolean; rows: { key: string; spendMinor: string; impressions: number; clicks: number; conversions: number; ctrPercent: number | null; cpaMinor: string | null }[] };
  const [breakdowns, setBreakdowns] = useState<{ published: boolean; dimensions: Record<string, BreakdownDim> } | null>(null);
  type RegionPerf = { available: boolean; reason?: string; note?: string; minRows: number; totalRows: number; rowsBelowThreshold: number; regions: { region: string; divisionLabel: string | null; spendMinor: string; impressions: number; clicks: number; conversions: number; cpa: number | null; rows: number }[] };
  const [regionPerf, setRegionPerf] = useState<RegionPerf | null>(null);
  // CA19 (CB5): geo holdout definition + observational
  // measurement (spike verdict: Meta Ad Study cannot split
  // by geography — the panel says so, verbatim method).
  type GeoHoldoutData = { available: boolean; reason?: string; method: string; deliveryNote: string; holdout: { id: string; status: string; testRegions: string[]; holdoutRegions: string[]; startsAt: string | null; endsAt: string | null } | null; measurement: { available: boolean; reason?: string; windowRows?: number; groups?: Record<"test" | "holdout" | "other", { spendMinor: string; conversions: number; cpa: number | null; conversionsPer1000Spend: number | null; regions: { region: string }[] }>; observedDifferencePer1000?: number | null; observedDifferenceLabel?: string; holdoutSpendDetected?: boolean; holdoutSpendNote?: string; note?: string } | null };
  const [geoHoldout, setGeoHoldout] = useState<GeoHoldoutData | null>(null);
  const [holdoutForm, setHoldoutForm] = useState({ test: "", holdout: "", start: "", end: "" });
  const [regionDraftNote, setRegionDraftNote] = useState<string>("");
  const [creativeInsights, setCreativeInsights] = useState<{ published: boolean; rule: string; ads: { adId: string; name: string; hasData: boolean; spendMinor: string; impressions: number; clicks: number; conversions: number; ctrPercent: number | null; frequency: number | null; cpaMinor: string | null; ctrDropPercent: number | null; fatigued: boolean; fatigueReasons: string[] }[] } | null>(null);
  const [recs, setRecs] = useState<{ published: boolean; thresholds: { deadAdSetSpendMinor: string; winnerMinSpendMinor: string; budgetShiftPercent: number }; recommendations: any[] } | null>(null);
  // CA12: the plan pause/resume window panel (org timezone
  // comes back from the API with the schedule).
  const [schedule, setSchedule] = useState<{ timezone: string; pauseAt: string | null; resumeAt: string | null; pauseExecutedAt: string | null; resumeExecutedAt: string | null } | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [guardrails, setGuardrails] = useState<{ linked: any[]; orgWide: any[] } | null>(null);
  const [accountsHealth, setAccountsHealth] = useState<{ id: string; name: string; platform: string; currency: string | null; health: { connection: string; platformStatusBucket: string; platformStatusCheckedAt: string | null } }[]>([]);
  const [cloneReport, setCloneReport] = useState<{ plan: { id: string; name: string }; targetAccount: { name: string }; mapping: { adSet: string; field: string; outcome: string; detail: string }[]; blockers: string[] } | null>(null);
  type XDraft = { id: string; platform: string; kind?: string | null; status: string; fields: any; unmapped?: string[] | null; externalCampaignId?: string | null; lastError?: string | null; publicationId?: string | null; createdAt: string };
  const [xdrafts, setXdrafts] = useState<XDraft[] | null>(null);
  const [xdEditId, setXdEditId] = useState<string | null>(null);
  const [xdForm, setXdForm] = useState<any>(null);
  const [xdResult, setXdResult] = useState<Record<string, string>>({});
  // DX3 (CN17): the last create call's notCarried list, rendered
  // as a list (the notice string keeps its exact old text too).
  const [xdNote, setXdNote] = useState<{ notCarried: string[] } | null>(null);
  // CA15 (CB4): the one-click fan-out preview — both
  // platforms' mappings + gaps, shown BEFORE creation;
  // the create call runs only on the confirm click.
  const [fanout, setFanout] = useState<{ platforms: any[]; note?: string } | null>(null);
  // Frontier NB8 / CN18: the campaign report share link,
  // created through the existing report-shares lifecycle.
  const [shareLink, setShareLink] = useState("");
  // Campaign Builder Next CN10/CN11 (web): guided step state +
  // governance (members for @mentions, versions, approval chain,
  // last recorded activity). Loading surfaces reuse `busy`.
  const [activeStep, setActiveStep] = useState(0);
  // Design Round 2: true while a deep-linked plan (?id=) is
  // still loading, so the create screen does not flash first.
  const [planLoading, setPlanLoading] = useState(false);
  const [members, setMembers] = useState<{ id: string; role: string; user: { id: string; name: string; email: string } }[]>([]);
  const [myRole, setMyRole] = useState("");
  const [versions, setVersions] = useState<{ id: string; kind: string; createdAt: string; createdById?: string | null }[] | null>(null);
  const [versionDiffs, setVersionDiffs] = useState<Record<string, { differs: boolean; summary: { topLevelChanged: string[]; adSetsAdded: number; adSetsRemoved: number; adSetsChanged: number; adsAdded: number; adsRemoved: number; adsChanged: number } }>>({});
  const [lastActivity, setLastActivity] = useState<{ available: boolean; actorName?: string | null; action?: string | null; at?: string | null } | null>(null);
  const [twoStep, setTwoStep] = useState<boolean | null>(null);
  // CA13 naming conventions: the org template + the
  // rename-dialog state (preview diff the user confirms).
  const [namingTpl, setNamingTpl] = useState<{ template: string | null; tokens: string[]; sample: string | null } | null>(null);
  const [namingDraft, setNamingDraft] = useState("");
  const [namingOpen, setNamingOpen] = useState(false);
  const [namingPreview, setNamingPreview] = useState<{ template: string; items: { level: string; id: string; currentName: string; newName: string | null; changed: boolean }[]; note: string } | null>(null);
  const [namingResult, setNamingResult] = useState<string | null>(null);
  // CA17: the plan-level UTM template (per plan, unlike
  // the org-level naming template) + its five field drafts.
  const [utmTpl, setUtmTpl] = useState<{ template: Record<string, string> | null; keys: string[]; tokens: string[]; samples: { meta: string; google: string; tiktok: string } } | null>(null);
  const [utmDraft, setUtmDraft] = useState<Record<string, string>>({});
  // DX2: unified honest save-state + the step a failed autosave
  // was trying to reach (the retry button resumes to it).
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [pendingStep, setPendingStep] = useState<number | null>(null);

  const orgId = typeof window !== "undefined" ? getOrganizationId() : null;
  const editable = plan ? ["draft", "rejected"].includes(plan.status) : false;

  // CN3: product sets follow the catalog chosen in the ad-set form.
  useEffect(() => {
    const cat = adSetForm.catalogRecordId;
    if (!cat || !orgId) { setFormSets([]); return; }
    apiFetch<ProductSetRec[]>(`/organizations/${orgId}/catalogs/${cat}/product-sets`).then((r) => setFormSets(asList(r))).catch(() => setFormSets([]));
  }, [adSetForm.catalogRecordId, orgId]);

  const reloadLeadForms = useCallback(async () => {
    const o = getOrganizationId(); if (!o) return;
    const r = await apiFetch<LeadFormRec[]>(`/organizations/${o}/campaign-plans/lead-forms/list`).catch(() => null);
    if (r) setLeadForms(r);
  }, []);

  const loadPlan = useCallback(async (id: string) => {
    const o = getOrganizationId(); if (!o) return;
    setPlan(await apiFetch<Plan>(`/organizations/${o}/campaign-plans/${id}`));
    // DX2: readiness is fetched on plan load (and after each
    // autosave) so the step chips + summary rail are live from
    // the start — not only after the Review button is pressed.
    apiFetch<NonNullable<typeof readiness>>(`/organizations/${o}/campaign-plans/${id}/readiness`, { method: "POST", body: JSON.stringify({}) }).then(setReadiness).catch(() => undefined);
    apiFetch<StudioData>(`/organizations/${o}/campaign-plans/${id}/audience-studio`).then(setStudio).catch(() => setStudio(null));
    apiFetch<NonNullable<typeof lastActivity>>(`/organizations/${o}/campaign-plans/${id}/last-activity`).then(setLastActivity).catch(() => setLastActivity(null));
    // CA17: the plan's UTM template for the rail editor.
    apiFetch<NonNullable<typeof utmTpl>>(`/organizations/${o}/campaign-plans/${id}/utm-template`).then((r) => { setUtmTpl(r); setUtmDraft(r.template ?? {}); }).catch(() => setUtmTpl(null));
  }, []);

  useEffect(() => {
    (async () => {
      const o = getOrganizationId(); if (!o) return;
      try {
        const [accsRaw, prodsRaw] = await Promise.all([
          apiFetch<AdAccount[]>(`/organizations/${o}/ad-accounts`),
          apiFetch<Product[]>(`/organizations/${o}/products`),
        ]);
        // List responses may be bare arrays OR paginated
        // envelopes ({ items }) — /products has been an
        // envelope since the EC pagination, and storing the
        // envelope crashed this page at products.map
        // (2026-10-15 live incident). asList normalizes
        // every list this page stores.
        const accs = asList<AdAccount>(accsRaw);
        setAccounts(accs);
        setProducts(asList<Product>(prodsRaw));
        apiFetch(`/organizations/${o}/creatives`).then((r: any) => setAssets(asList(r))).catch(() => undefined);
        apiFetch(`/organizations/${o}/campaign-plans/asset-performance`).then((r: any) => {
          const map: Record<string, { rated: boolean; ctrPct: number | null; cpaMinor: number | null }> = {};
          for (const a of (r?.assets ?? [])) map[a.key] = { rated: !!a.rated, ctrPct: a.ctrPct ?? null, cpaMinor: a.cpaMinor ?? null };
          setAssetPerf(map);
        }).catch(() => undefined);
        apiFetch(`/organizations/${o}/social/media`).then((r: any) => setMediaAssets(asList(r))).catch(() => undefined);
        apiFetch(`/organizations/${o}/audiences`).then((r: any) => setAudList(asList(r))).catch(() => undefined);
        apiFetch(`/organizations/${o}/audiences/saved/list`).then((r: any) => setSavedList(asList(r))).catch(() => undefined);
        apiFetch(`/organizations/${o}/campaign-plans/templates/list`).then((r: any) => setTemplates(asList(r))).catch(() => undefined);
        apiFetch(`/organizations/${o}/campaign-plans/blueprints/list`).then((r: any) => setBlueprints(asList(r))).catch(() => undefined);
        apiFetch<CatalogRec[]>(`/organizations/${o}/catalogs`).then((r) => setCatalogs(asList(r))).catch(() => undefined);
        apiFetch<LeadFormRec[]>(`/organizations/${o}/campaign-plans/lead-forms/list`).then((r) => setLeadForms(asList(r))).catch(() => undefined);
        apiFetch<NonNullable<typeof waDestinations>>(`/organizations/${o}/campaign-plans/whatsapp-destinations`).then((r) => setWaDestinations(r)).catch(() => undefined);
        apiFetch<CustomFieldLite[]>(`/organizations/${o}/crm/custom-fields`).then((r) => setCustomFields(asList<CustomFieldLite>(r).filter((f) => !f.archivedAt))).catch(() => undefined);
        // CN11 governance reads: org members (team-page response
        // shape) for the @mention picker, my role for the
        // OWNER/ADMIN approval-chain toggle, and the chain setting.
        apiFetch<typeof members>(`/organizations/${o}/members`).then((r) => setMembers(Array.isArray(r) ? r : [])).catch(() => undefined);
        apiFetch<{ id: string; myRole: string }[]>(`/organizations`).then((orgs) => { const mine = (Array.isArray(orgs) ? orgs : []).find((x) => x.id === o); if (mine) setMyRole(mine.myRole); }).catch(() => undefined);
        apiFetch<{ twoStepApproval: boolean }>(`/organizations/${o}/campaign-plans/settings/approval-chain`).then((r) => setTwoStep(r.twoStepApproval === true)).catch(() => undefined);
        // CA13: the org naming template (Organization Settings
        // surface, edited from the builder rail below).
        apiFetch<{ template: string | null; tokens: string[]; sample: string | null }>(`/organizations/${o}/campaign-plans/settings/naming-template`).then((r) => { setNamingTpl(r); setNamingDraft(r.template ?? ""); }).catch(() => undefined);
        if (accs.length) setCreateForm((f) => ({ ...f, adAccountId: f.adAccountId || accs.find((a) => a.platform === "meta")?.id || "" }));
      } catch { /* lists are optional for viewing */ }
      const id = params.get("id");
      // DX3 (J4): deep links may name the landing step — the
      // funnel wizard's finish lands on Review (step 4).
      const stepParam = Number(params.get("step"));
      if (id && Number.isInteger(stepParam) && stepParam >= 0 && stepParam <= 4) setActiveStep(stepParam);
      if (id) { setPlanLoading(true); try { await loadPlan(id); } catch (e) { setError(e instanceof Error ? e.message : "Plan load failed"); } finally { setPlanLoading(false); } }
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
    const created = await wrap("create", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans`, { method: "POST", body: JSON.stringify({ name: createForm.name, objective: createForm.objective, adAccountId: createForm.adAccountId, budgetMode: createForm.budgetMode, campaignDailyBudget: createForm.campaignDailyBudget || undefined, campaignLifetimeBudget: createForm.campaignLifetimeBudget || undefined, useNamingTemplate: createForm.useNamingTemplate || undefined }) }));
    if (created) { setPlan(created); setNotice(t("campaignBuilder.planCreated")); }
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
        appId: adSetForm.appId || undefined,
        appStoreUrl: adSetForm.appStoreUrl || undefined,
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
    if (!f?.name || !f?.primaryText || !f?.linkUrl) { setError(t("campaignBuilder.errAdRequired")); return; }
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
    if (!productId) { setError(t("campaignBuilder.errChooseProductCopy")); return; }
    const res = await wrap(`copy-${adSetId}`, () => apiFetch<{ created: unknown[]; provider: string }>(`/organizations/${orgId}/campaign-plans/${plan.id}/generate-copy`, { method: "POST", body: JSON.stringify({ adSetId, productId }) }));
    if (res) { setNotice(t("campaignBuilder.copyCreated", { provider: res.provider === "dev-template" ? "Dev Template" : res.provider })); await loadPlan(plan.id); }
  }

  // CA1: generate an ad image with the org's AI image provider.
  // The asset lands in the Creative Library (name "AI ছবি — …");
  // the human still picks it into an ad from the picker.
  async function generateImage(adSetId: string) {
    if (!orgId || !plan) return;
    const prompt = (imagePrompts[adSetId] ?? "").trim();
    if (!prompt) { setError(t("campaignBuilder.errImagePrompt")); return; }
    const res = await wrap(`image-${adSetId}`, () => apiFetch<{ asset: { id: string; name: string; status: string }; provider: string }>(`/organizations/${orgId}/campaign-plans/${plan.id}/generate-image`, { method: "POST", body: JSON.stringify({ prompt, productId: copySelection[adSetId] || undefined }) }));
    if (res) {
      setNotice(res.asset.status === "ready"
        ? t("campaignBuilder.imageCreatedReady", { provider: res.provider })
        : t("campaignBuilder.imageCreatedIngest", { status: res.asset.status }));
      const r = await apiFetch(`/organizations/${orgId}/creatives`).catch(() => null);
      if (r) setAssets(asList(r));
    }
  }

  // CA2: generate a slideshow video ad from the selected
  // product's own photos (script fact-checked server-side;
  // a template script is labelled as such in the notice).
  async function generateVideo(adSetId: string) {
    if (!orgId || !plan) return;
    const productId = copySelection[adSetId];
    if (!productId) { setError(t("campaignBuilder.errChooseProductVideo")); return; }
    const res = await wrap(`video-${adSetId}`, () => apiFetch<{ assets: { id: string; name: string; status: string }[]; scriptSource: string; framesUsed: number }>(`/organizations/${orgId}/campaign-plans/${plan.id}/generate-video`, { method: "POST", body: JSON.stringify({ productId }) }));
    if (res) {
      setNotice(t("campaignBuilder.videoCreated", { count: fmtNumber(locale, res.assets.length), frames: fmtNumber(locale, res.framesUsed), script: res.scriptSource === "template" ? t("campaignBuilder.videoScriptTemplate") : "" }));
      const r = await apiFetch(`/organizations/${orgId}/creatives`).catch(() => null);
      if (r) setAssets(asList(r));
    }
  }

  async function action(name: string, key: string, body?: unknown) {
    if (!orgId || !plan) return;
    const res = await wrap(key, () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/${name}`, { method: "POST", body: body ? JSON.stringify(body) : undefined }));
    if (res) {
      setPlan(res);
      if ((res as Plan).approvalState?.awaitingSecond) setNotice(t("campaignBuilder.noticeFirstApproval"));
      apiFetch<NonNullable<typeof lastActivity>>(`/organizations/${orgId}/campaign-plans/${plan.id}/last-activity`).then(setLastActivity).catch(() => undefined);
    }
  }

  async function rejectPlan() {
    const reason = window.prompt(t("campaignBuilder.promptRejectReason"));
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
    if (!expForm.planBId) { setError(t("campaignBuilder.errChooseVariantB")); return; }
    const created = await wrap("exp-create", () => apiFetch<ExperimentRow>(`/organizations/${orgId}/campaign-plans/experiments`, {
      method: "POST",
      body: JSON.stringify({ planAId: plan.id, planBId: expForm.planBId, splitA: Number(expForm.splitA), metricEvent: expForm.metricEvent || undefined, durationDays: Number(expForm.durationDays) }),
    }));
    if (created) {
      setExperiments((s) => [created, ...(s ?? [])]);
      setNotice(t("campaignBuilder.expCreated", { id: created.metaStudyId ?? "—" }));
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
      setNotice(t("campaignBuilder.seriesCreated", { name: created.name }));
    }
  }

  async function doSeriesAction(id: string, act: "pause" | "resume" | "end") {
    if (!orgId) return;
    const res = await wrap(`series-${act}-${id}`, () => apiFetch<SeriesRow>(`/organizations/${orgId}/campaign-plans/series/${id}`, { method: "PATCH", body: JSON.stringify({ action: act }) }));
    if (res) setSeriesList((s) => (s ?? []).map((x) => (x.id === id ? res : x)));
  }

  // DX2: real step-shell. CN10's scroll anchors become steps —
  // exactly one step's sections are visible at a time (sections
  // whose forms use uncontrolled DOM inputs stay mounted with a
  // `hidden` class instead of unmounting, so typed-but-unsaved
  // values are never lost; see the per-section notes in the JSX).
  // Step ↔ readiness-check mapping lives in
  // lib/campaign-step-shell.ts (STEP_CHECK_KEYS).
  const CBX_STEPS = [
    { label: "Objective", anchor: "cbx-step-objective" },
    { label: "Audience", anchor: "cbx-step-audience" },
    { label: "Budget / Bidding", anchor: "cbx-step-budget" },
    { label: "Creative", anchor: "cbx-step-creative" },
    { label: "Review / Readiness", anchor: "cbx-step-review" },
  ];
  const domVal = (id: string): string => (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null)?.value ?? "";
  const domExists = (id: string): boolean => typeof document !== "undefined" && !!document.getElementById(id);

  const fetchReadiness = async () => {
    if (!orgId || !plan) return null;
    const res = await apiFetch<NonNullable<typeof readiness>>(`/organizations/${orgId}/campaign-plans/${plan.id}/readiness`, { method: "POST", body: JSON.stringify({}) }).catch(() => null);
    if (res) setReadiness(res);
    return res;
  };
  const noteSaved = () => { setSaveState((prev) => markSaved(prev, new Date(), locale)); setPendingStep(null); };

  // DX2 savers: each performs EXACTLY the apiFetch call its
  // section's existing save button performs (same endpoint, same
  // body built from the same DOM inputs), and returns whether
  // that call succeeded. "Saved" is only ever shown when these
  // return true.
  const runAdSetEditSave = async (adSet: AdSet): Promise<boolean> => {
    if (!orgId || !plan) return false;
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
    if (res) { setEditSetId(null); setNotice(t("campaignBuilder.adSetUpdated")); noteSaved(); await loadPlan(plan.id); }
    return res != null;
  };
  const runAdEditSave = async (ad: AdItem): Promise<boolean> => {
    if (!orgId || !plan) return false;
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
    if (res) { setEditAdId(null); setNotice(t("campaignBuilder.adUpdated")); noteSaved(); await loadPlan(plan.id); }
    return res != null;
  };
  const runXdSave = async (d: XDraft): Promise<boolean> => {
    if (!orgId || !plan || !xdForm) return false;
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
      if (res.problems.length) setXdResult((st) => ({ ...st, [d.id]: t("campaignBuilder.xdSavedProblems", { problems: res.problems.join(" · ") }) }));
      else { setNotice(t("campaignBuilder.xdSavedOk")); noteSaved(); setXdEditId(null); setXdForm(null); }
      const list = await apiFetch<XDraft[]>(`/organizations/${orgId}/campaign-plans/${plan.id}/xdrafts`).catch(() => null);
      if (list) setXdrafts(list);
    }
    return res != null;
  };
  // OU4: real provider status for a cross-platform draft.
  type XdSync = { available: boolean; reason?: string; providerStatus?: string; providerStatusRaw?: string; platformStatus?: string; statusLabel?: string; name?: string; status: string; externalCampaignId?: string | null; syncedAt?: string; checkedAt?: string };
  const xdProviderLabel = (s?: string) => (s === "active" ? t("campaignBuilder.xdProviderActive") : s === "paused" ? t("campaignBuilder.xdProviderPaused") : s === "removed" ? t("campaignBuilder.xdProviderRemoved") : (s ?? "—"));
  const runXdSync = async (d: XDraft): Promise<XdSync | null> => {
    if (!orgId || !plan) return null;
    const res = await wrap(`xd-sync-${d.id}`, () => apiFetch<XdSync>(`/organizations/${orgId}/campaign-plans/${plan.id}/xdrafts/${d.id}/sync-status`, { method: "POST", body: JSON.stringify({}) }));
    if (res) setXdResult((s) => ({ ...s, [d.id]: res.available ? t("campaignBuilder.xdSyncOk", { label: xdProviderLabel(res.providerStatus ?? res.platformStatus), raw: res.providerStatusRaw ?? res.platformStatus ?? "", name: res.name ? t("campaignBuilder.xdSyncName", { name: res.name }) : "", status: res.status, synced: (res.syncedAt ?? res.checkedAt) ? t("campaignBuilder.xdSyncSynced", { at: res.syncedAt ?? res.checkedAt ?? "" }) : "" }) : t("campaignBuilder.xdSyncFail", { reason: res.reason ?? t("campaignBuilder.xdReasonUnknown"), status: res.status }) }));
    return res;
  };
  const runXdLifecycle = async (d: XDraft, action: "pause" | "resume") => {
    if (!orgId || !plan) return;
    const res = await wrap(`xd-life-${action}-${d.id}`, () => apiFetch<{ providerStatus: string; providerStatusRaw?: string; providerStatusSource: string }>(`/organizations/${orgId}/campaign-plans/${plan.id}/xdrafts/${d.id}/lifecycle`, { method: "POST", body: JSON.stringify({ action }) }));
    if (res) {
      setXdResult((s) => ({ ...s, [d.id]: t("campaignBuilder.xdLifecycleOk", { action: action === "pause" ? "Pause" : "Resume", label: xdProviderLabel(res.providerStatus), raw: res.providerStatusRaw ? t("campaignBuilder.xdLifecycleRaw", { raw: res.providerStatusRaw }) : "", source: res.providerStatusSource === "fresh_sync" ? t("campaignBuilder.xdSourceFresh") : t("campaignBuilder.xdSourceTarget") }) }));
      const list = await apiFetch<XDraft[]>(`/organizations/${orgId}/campaign-plans/${plan.id}/xdrafts`).catch(() => null);
      if (list) setXdrafts(list);
      await runXdSync(d);
    }
  };
  const runBudgetModeSave = async (): Promise<boolean> => {
    if (!orgId || !plan) return false;
    const mode = (document.getElementById("plan-bmode") as HTMLSelectElement)?.value ?? "abo";
    const d = (document.getElementById("plan-cdaily") as HTMLInputElement)?.value ?? "";
    const l = (document.getElementById("plan-clife") as HTMLInputElement)?.value ?? "";
    const res = await wrap("bmode", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}`, { method: "PATCH", body: JSON.stringify({ budgetMode: mode, campaignDailyBudget: d, campaignLifetimeBudget: l }) }));
    if (res) { setPlan(res); setNotice(t("campaignBuilder.budgetModeSaved")); noteSaved(); }
    return res != null;
  };
  const runCapSave = async (): Promise<boolean> => {
    if (!orgId || !plan) return false;
    const v = (document.getElementById("plan-cap") as HTMLInputElement)?.value ?? "";
    const res = await wrap("cap", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}`, { method: "PATCH", body: JSON.stringify({ dailyBudgetCap: v }) }));
    if (res) { setPlan(res); setNotice(v ? t("campaignBuilder.capSet") : t("campaignBuilder.capRemoved")); noteSaved(); }
    return res != null;
  };
  const runScheduleSave = async (adSet: AdSet): Promise<boolean> => {
    if (!orgId || !plan) return false;
    const st = domVal(`sched-start-${adSet.id}`); const en = domVal(`sched-end-${adSet.id}`);
    if (!st && !en) { setError(t("campaignBuilder.errScheduleTime")); return false; }
    const res = await wrap(`sched-${adSet.id}`, () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets/${adSet.id}/schedule`, { method: "POST", body: JSON.stringify({ startTime: st ? new Date(st).toISOString() : undefined, endTime: en ? new Date(en).toISOString() : undefined }) }));
    if (res) { setPlan(res); setNotice(t("campaignBuilder.scheduleUpdated")); noteSaved(); }
    return res != null;
  };
  const runDaypartSave = async (adSet: AdSet): Promise<boolean> => {
    if (!orgId || !plan) return false;
    const raw = (document.getElementById(`daypart-${adSet.id}`) as HTMLTextAreaElement)?.value ?? "";
    const windows = raw.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [day, startHour, endHour] = l.split(",").map((x) => Number(x.trim())); return { day, startHour, endHour }; });
    const res = await wrap(`dp-${adSet.id}`, () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets/${adSet.id}/daypart`, { method: "POST", body: JSON.stringify({ windows, tz: "Asia/Dhaka" }) }));
    if (res) { setPlan(res); setNotice(t("campaignBuilder.daypartSaved")); noteSaved(); }
    return res != null;
  };
  const runPublishedBudgetSave = async (adSet: AdSet): Promise<boolean> => {
    if (!orgId || !plan) return false;
    const v = (document.getElementById(`budget-${adSet.id}`) as HTMLInputElement)?.value;
    if (!v) { setError(t("campaignBuilder.errNewBudget")); return false; }
    const res = await wrap(`budget-${adSet.id}`, () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets/${adSet.id}/budget`, { method: "POST", body: JSON.stringify({ dailyBudget: v }) }));
    if (res) { setPlan(res); setNotice(t("campaignBuilder.budgetUpdatedMeta")); noteSaved(); }
    return res != null;
  };

  // DX2 saver registry: every section lives in this one
  // component, so sections "register" their primary saver here
  // (into the lib registry) based on which editor is open and
  // which uncontrolled DOM inputs diverge from the saved plan.
  // Action-only sections (submit/approve/publish, comments,
  // versions, experiments, series, xdraft actions other than
  // its edit-save, guardrails, clone, studio creates) register
  // nothing and never block navigation.
  const registerCurrentSavers = (registry: ReturnType<typeof createSaverRegistry>) => {
    if (!plan || !orgId) return;
    if (editSetId) {
      const adSet = plan.adSets.find((x) => x.id === editSetId);
      if (adSet) {
        // One PATCH spans targeting + budget + destination, so
        // it registers on both the Audience and Budget steps.
        registry.register(1, `es-${adSet.id}`, () => runAdSetEditSave(adSet));
        registry.register(2, `es-${adSet.id}`, () => runAdSetEditSave(adSet));
      }
    }
    if (plan.status === "published") {
      for (const adSet of plan.adSets) {
        if (!adSet.externalAdSetId) continue;
        if (domExists(`sched-start-${adSet.id}`)) {
          const st = domVal(`sched-start-${adSet.id}`); const en = domVal(`sched-end-${adSet.id}`);
          const curSt = adSet.startTime ? String(adSet.startTime).slice(0, 16) : "";
          const curEn = adSet.endTime ? String(adSet.endTime).slice(0, 16) : "";
          if ((st || en) && (st !== curSt || en !== curEn)) registry.register(1, `sched-${adSet.id}`, () => runScheduleSave(adSet));
        }
        if (domExists(`daypart-${adSet.id}`)) {
          const raw = domVal(`daypart-${adSet.id}`);
          const cur = Array.isArray((adSet as any).daypart) ? (adSet as any).daypart.map((w: any) => `${w.day},${w.startHour},${w.endHour}`).join("\n") : "";
          if (raw.trim() !== cur.trim()) registry.register(1, `dp-${adSet.id}`, () => runDaypartSave(adSet));
        }
        if (domExists(`budget-${adSet.id}`) && domVal(`budget-${adSet.id}`)) registry.register(2, `budget-${adSet.id}`, () => runPublishedBudgetSave(adSet));
      }
    }
    if (editable) {
      const moneyEq = (a: string, b: string) => (a.trim() === "" && b.trim() === "") || (a.trim() !== "" && b.trim() !== "" && Number(a) === Number(b));
      if (domExists("plan-bmode")) {
        const curD = plan.campaignDailyBudgetMinor ? String(Number(plan.campaignDailyBudgetMinor) / 100) : "";
        const curL = plan.campaignLifetimeBudgetMinor ? String(Number(plan.campaignLifetimeBudgetMinor) / 100) : "";
        if (domVal("plan-bmode") !== (plan.budgetMode ?? "abo") || !moneyEq(domVal("plan-cdaily"), curD) || !moneyEq(domVal("plan-clife"), curL)) registry.register(2, "bmode", runBudgetModeSave);
      }
      if (domExists("plan-cap")) {
        const cur = (plan as any).dailyBudgetCapMinor ? String(Number((plan as any).dailyBudgetCapMinor) / 100) : "";
        if (!moneyEq(domVal("plan-cap"), cur)) registry.register(2, "cap", runCapSave);
      }
    }
    if (editAdId) {
      const ad = plan.adSets.flatMap((x) => x.ads).find((a) => a.id === editAdId);
      if (ad) registry.register(3, `ea-${ad.id}`, () => runAdEditSave(ad));
    }
    if (xdEditId && xdForm) {
      const d = (xdrafts ?? []).find((x) => x.id === xdEditId);
      if (d) registry.register(4, `xd-${d.id}`, () => runXdSave(d));
    }
  };
  const currentStepSaverCount = (step: number): number => {
    const registry = createSaverRegistry();
    registerCurrentSavers(registry);
    return registry.saversFor(step).length;
  };
  const refreshDirty = () => {
    try {
      const n = currentStepSaverCount(activeStep);
      setSaveState((prev) => {
        if (prev.kind === "saving" || prev.kind === "failed") return prev;
        if (n > 0) return markDirty(prev);
        return prev.kind === "dirty" ? { kind: "idle" } : prev;
      });
    } catch { /* DOM not ready yet — the dirty state stays as-is */ }
  };

  // DX2 autosave on step change (owner decision): leaving a
  // dirty step runs its savers first; success moves on, any
  // failure stays on the step in the failed/retry state.
  const goStep = async (target: number, force = false): Promise<boolean> => {
    if (!force && target === activeStep) return true;
    const registry = createSaverRegistry();
    registerCurrentSavers(registry);
    const savers = registry.saversFor(activeStep);
    if (savers.length > 0) {
      setSaveState((prev) => startSaving(prev));
      const ok = await runStepSavers(savers);
      if (!ok) {
        setSaveState((prev) => markFailed(prev));
        setPendingStep(target === activeStep ? null : target);
        return false;
      }
      setSaveState((prev) => markSaved(prev, new Date(), locale));
      setPendingStep(null);
      await fetchReadiness();
    }
    setActiveStep(target);
    return true;
  };
  const retrySave = async () => {
    const target = pendingStep;
    const ok = await goStep(target ?? activeStep, true);
    if (ok) setPendingStep(null);
  };
  const renderSaveIndicator = () => (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-2 text-sm leading-[1.7]" role="status">
      <span className={saveState.kind === "failed" ? "font-semibold text-red-700" : saveState.kind === "saved" ? "font-semibold text-emerald-700" : "text-slate-600"}>{saveStateLabel(saveState, locale)}</span>
      {saveState.kind === "failed" ? (
        <button type="button" className="btn-secondary btn-sm min-h-[40px]" style={{ minHeight: 40 }} disabled={busy !== ""} onClick={() => { void retrySave(); }}>{t("campaignBuilder.retryBtn")}</button>
      ) : null}
    </div>
  );
  // Design Round 2 (tabs pattern): ArrowLeft/ArrowRight move
  // between steps from the rail, Home/End jump to the ends —
  // through the same goStep, so autosave still runs first and
  // a failed save keeps focus (and the user) on the step.
  const focusStepButton = (i: number) => {
    document.querySelector<HTMLElement>(`[data-step-btn="${i}"]`)?.focus();
  };
  const focusStepPanel = (i: number) => {
    document.getElementById(CBX_STEPS[i]?.anchor ?? "")?.focus();
  };
  const onStepRailKeyDown = (e: React.KeyboardEvent) => {
    const next = stepIndexForKey(activeStep, e.key, CBX_STEPS.length);
    if (next === null) return;
    e.preventDefault();
    if (next === activeStep) { focusStepButton(next); return; }
    void goStep(next).then((ok) => { if (ok) focusStepButton(next); });
  };
  const stepRail = (
    <nav className="cbx-step-rail xl:flex-col xl:items-stretch" aria-label={t("campaignBuilder.railAria")} onKeyDown={onStepRailKeyDown}>
      {CBX_STEPS.map((st, i) => {
        const chip = chipForStep(readiness?.checks ?? null, i);
        return (
          <button key={st.label} type="button" data-step-btn={i} aria-current={activeStep === i ? "step" : undefined} style={{ minHeight: 40 }} className={`cbx-step-btn min-h-[40px] xl:w-full xl:justify-start ${activeStep === i ? "cbx-step-btn-active" : ""}`} onClick={() => { void goStep(i); }}>
            <span className="cbx-step-num">{i + 1}</span> {st.label} <span aria-label={`Readiness: ${chip}`}>{chipSymbol(chip)}</span>
          </button>
        );
      })}
    </nav>
  );
  const stepNavButtons = (
    <div className="flex items-center justify-between gap-2 pt-2">
      <span>{activeStep > 0 ? <button type="button" className="btn-secondary min-h-[40px]" style={{ minHeight: 40 }} disabled={busy !== ""} onClick={() => { void goStep(activeStep - 1).then((ok) => { if (ok) focusStepPanel(activeStep - 1); }); }}>{t("campaignBuilder.prevStep")}</button> : null}</span>
      <span>{activeStep < CBX_STEPS.length - 1 ? <button type="button" className="btn-primary min-h-[40px]" style={{ minHeight: 40 }} disabled={busy !== ""} onClick={() => { void goStep(activeStep + 1).then((ok) => { if (ok) focusStepPanel(activeStep + 1); }); }}>{t("campaignBuilder.nextStep")}</button> : null}</span>
    </div>
  );

  const inputCls = "input mt-1";

  if (!plan && planLoading) {
    // Design Round 2: a deep-linked plan is still loading —
    // skeleton in the shell's shape instead of flashing the
    // create screen (the .cbx-skel blocks DX2 already uses).
    return (
      <div className="space-y-6 pb-24 lg:pb-0">
        {stepRail}
        <div className="space-y-3" aria-hidden>
          <div className="cbx-skel" style={{ height: 30, width: "45%" }} />
          <div className="cbx-skel" style={{ height: 120 }} />
          <div className="cbx-skel" style={{ height: 220 }} />
        </div>
        <p className="sr-only">{t("campaignBuilder.planLoading")}</p>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="space-y-6 pb-24 lg:pb-0">
        {stepRail}
        <div id="cbx-step-objective">
          <h1 className="page-title">Campaign Builder</h1>
          <p className="text-sm text-slate-500">{t("campaignBuilder.createIntro")}</p>
        </div>
        {error ? <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 shadow-sm"><span>⛔</span><span>{error}</span></div> : null}
        <form id="cbx-create-form" onSubmit={createPlan} className="space-y-3 card p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-sm">{t("campaignBuilder.planNameLabel")}<input className={inputCls} value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} required={!createForm.useNamingTemplate} placeholder="Eid Sale 2026" />
              <span className="mt-1 flex items-center gap-1.5 text-xs text-slate-500"><input type="checkbox" checked={createForm.useNamingTemplate} onChange={(e) => setCreateForm({ ...createForm, useNamingTemplate: e.target.checked })} />{t("campaignBuilder.namingTemplateHint")}</span></label>
            <label className="block text-sm">Objective
              <select className={inputCls} value={createForm.objective} onChange={(e) => setCreateForm({ ...createForm, objective: e.target.value })}>
                <option value="OUTCOME_SALES">Sales</option><option value="OUTCOME_TRAFFIC">Traffic</option>
                <option value="OUTCOME_LEADS">Leads</option><option value="OUTCOME_ENGAGEMENT">Engagement</option><option value="OUTCOME_AWARENESS">Awareness</option>
                <option value="OUTCOME_APP_PROMOTION">App Promotion (CA23)</option>
              </select>
            </label>
            <label className="block text-sm">Meta Ad Account
              <select className={inputCls} value={createForm.adAccountId} onChange={(e) => setCreateForm({ ...createForm, adAccountId: e.target.value })} required>
                <option value="">{t("campaignBuilder.choosePlaceholder")}</option>
                {accounts.filter((a) => a.platform === "meta").map((a) => <option key={a.id} value={a.id}>{a.name} ({a.sourceType === "api" ? "API connected" : t("campaignBuilder.createAccountCsvNote")}){t("campaignBuilder.accountStatusSuffix", { status: a.platformStatusBucket ?? "unknown" })}</option>)}
              </select>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-sm">{t("campaignBuilder.budgetModeLabel")}
              <select className={inputCls} value={createForm.budgetMode} onChange={(e) => setCreateForm({ ...createForm, budgetMode: e.target.value })}>
                <option value="abo">{t("campaignBuilder.aboOption")}</option>
                <option value="cbo">{t("campaignBuilder.cboOption")}</option>
              </select>
            </label>
            {createForm.budgetMode === "cbo" ? <>
              <label className="block text-sm">{t("campaignBuilder.campaignDailyLabel")}<input className={inputCls} value={createForm.campaignDailyBudget} onChange={(e) => setCreateForm({ ...createForm, campaignDailyBudget: e.target.value })} placeholder="2000" /></label>
              <label className="block text-sm">{t("campaignBuilder.campaignLifetimeLabel")}<input className={inputCls} value={createForm.campaignLifetimeBudget} onChange={(e) => setCreateForm({ ...createForm, campaignLifetimeBudget: e.target.value })} placeholder={t("campaignBuilder.optionalPlaceholder")} /></label>
            </> : <p className="col-span-2 self-end text-xs text-slate-400">{t("campaignBuilder.aboNote")}</p>}
          </div>
          <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>{t("campaignBuilder.createPlanBtn")}</button>
          <p className="text-xs text-slate-400">{t("campaignBuilder.publishNeedsApi")}</p>
        </form>

        {blueprints.length > 0 ? (
          <div className="card space-y-3 p-5">
            <div className="font-semibold">{t("campaignBuilder.blueprintTitle")}</div>
            <p className="text-xs text-slate-400">{t("campaignBuilder.blueprintIntro")}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <select className="input" value={bpForm.blueprintId || bpForm.blueprintKey} onChange={(e) => {
                const row = blueprints.find((x) => (x.id ?? x.key) === e.target.value);
                setBpForm({ ...bpForm, blueprintKey: row?.key ?? "", blueprintId: row?.id ?? "" });
              }}>
                <option value="">{t("campaignBuilder.blueprintChoose")}</option>
                {blueprints.map((bp) => <option key={bp.id ?? bp.key} value={bp.id ?? bp.key}>{bp.name}{bp.scope === "org" ? t("campaignBuilder.blueprintOwnCopy") : " · Platform"}</option>)}
              </select>
              <select className="input" value={bpForm.productId} onChange={(e) => setBpForm({ ...bpForm, productId: e.target.value })}>
                <option value="">{t("campaignBuilder.blueprintProductOption")}</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {bpForm.blueprintKey ? <p className="text-sm text-slate-500">{blueprints.find((x) => (x.id ?? x.key) === (bpForm.blueprintId || bpForm.blueprintKey))?.description}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary btn-sm" disabled={busy !== "" || !bpForm.blueprintKey || !createForm.adAccountId} onClick={async () => {
                const res = await wrap("bp", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/blueprints/instantiate`, { method: "POST", body: JSON.stringify({ blueprintKey: bpForm.blueprintKey, blueprintId: bpForm.blueprintId || undefined, adAccountId: createForm.adAccountId, productId: bpForm.productId || undefined }) }));
                if (res) { setPlan(res); setNotice(t("campaignBuilder.blueprintDraftCreated")); }
              }}>{busy === "bp" ? t("campaignBuilder.creating") : t("campaignBuilder.blueprintMakeDraft")}</button>
              {(() => { const sel = blueprints.find((x) => (x.id ?? x.key) === (bpForm.blueprintId || bpForm.blueprintKey)); return sel && sel.scope !== "org" ? (
                <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                  const res = await wrap("bpclone", () => apiFetch(`/organizations/${orgId}/campaign-plans/blueprints/clone`, { method: "POST", body: JSON.stringify({ key: sel.key }) }));
                  if (res) {
                    const r = await apiFetch(`/organizations/${orgId}/campaign-plans/blueprints/list`).catch(() => null);
                    if (r) setBlueprints(asList(r));
                    setNotice(t("campaignBuilder.blueprintCloned"));
                  }
                }}>{t("campaignBuilder.blueprintCloneBtn")}</button>
              ) : sel?.scope === "org" ? (
                <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                  if (!sel.id) return;
                  const res = await wrap("bpdel", () => apiFetch(`/organizations/${orgId}/campaign-plans/blueprints/${sel.id}`, { method: "DELETE" }));
                  if (res) {
                    const r = await apiFetch(`/organizations/${orgId}/campaign-plans/blueprints/list`).catch(() => null);
                    if (r) setBlueprints(asList(r));
                    setBpForm({ ...bpForm, blueprintKey: "", blueprintId: "" });
                    setNotice(t("campaignBuilder.blueprintCopyDeleted"));
                  }
                }}>{t("campaignBuilder.blueprintDeleteBtn")}</button>
              ) : null; })()}
            </div>
            <p className="text-xs text-slate-400">{t("campaignBuilder.blueprintDbNote")}</p>
            {!createForm.adAccountId ? <p className="text-xs text-amber-600">{t("campaignBuilder.chooseAccountFirst")}</p> : null}
          </div>
        ) : null}

        <div className="card space-y-3 border-violet-200 p-5">
          <div className="font-semibold">🤖 AI Plan Suggestion <span className="text-xs font-normal text-slate-500">(Campaign Builder CB3)</span></div>
          <p className="text-xs text-slate-500">{t("campaignBuilder.aiSuggestIntro")}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <select className="input" id="ai-product">
              <option value="">{t("campaignBuilder.aiProductOption")}</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input className="input" id="ai-budget" placeholder={t("campaignBuilder.aiBudgetPlaceholder")} />
            <input className="input" id="ai-goal" placeholder={t("campaignBuilder.aiGoalPlaceholder")} />
          </div>
          <button className="btn-primary btn-sm" disabled={busy !== "" || !createForm.adAccountId} onClick={async () => {
            const g = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLSelectElement)?.value ?? "";
            const budget = g("ai-budget");
            if (!budget) { setError(t("campaignBuilder.errTotalBudget")); return; }
            const res = await wrap("aisuggest", () => apiFetch<{ plan: Plan; facts: { note: string } }>(`/organizations/${orgId}/campaign-plans/suggest`, {
              method: "POST",
              body: JSON.stringify({ adAccountId: createForm.adAccountId, productId: g("ai-product") || undefined, goal: g("ai-goal") || undefined, totalDailyBudget: budget }),
            }));
            if (res) { setPlan(res.plan); setNotice(t("campaignBuilder.aiDraftCreated", { note: res.facts.note })); }
          }}>{busy === "aisuggest" ? t("campaignBuilder.aiDraftCreating") : t("campaignBuilder.aiDraftBtn")}</button>
          {!createForm.adAccountId ? <p className="text-xs text-amber-600">{t("campaignBuilder.chooseAccountFirst")}</p> : null}
        </div>

        {templates.length > 0 ? (
          <div className="card space-y-2 p-5">
            <div className="font-semibold">{t("campaignBuilder.myTemplates")}</div>
            {templates.map((tpl) => (
              <div key={tpl.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span>{tpl.name} <span className="text-xs text-slate-400">· {tpl.objective}</span></span>
                <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                  const res = await wrap(`tpl-${tpl.id}`, () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${tpl.id}/duplicate`, { method: "POST", body: JSON.stringify({}) }));
                  if (res) { setPlan(res); setNotice(t("campaignBuilder.templateDraftCreated")); }
                }}>{t("campaignBuilder.useBtn")}</button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="cbx-mobile-bar">
          <button type="submit" form="cbx-create-form" className="btn-primary flex-1" disabled={busy !== ""}>{t("campaignBuilder.createPlanBtn")}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24 lg:pb-0 r2-print-doc r2-print-builder" onChange={refreshDirty}>
      {/* DX2 shell: step list left (xl) / horizontal chips below xl,
          content middle, summary rail right (existing grid below). */}
      <div className="xl:grid xl:grid-cols-[210px_minmax(0,1fr)] xl:items-start xl:gap-5">
      {stepRail}
      <div className="min-w-0 space-y-6">
      {renderSaveIndicator()}
      <div id="cbx-step-objective" tabIndex={-1} className={`r2-step-enter flex flex-wrap items-center justify-between gap-3 ${activeStep === 1 || activeStep === 2 || activeStep === 3 ? "hidden" : ""}`}>
        <div>
          <div className={activeStep !== 0 ? "hidden" : ""}>
          <h1 className="page-title">{plan.name}</h1>
          {(plan as any).seriesId ? <p className="mt-1 inline-block rounded bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800">{t("campaignBuilder.seriesInstanceBadge", { date: (plan as any).seriesInstanceDate ? fmtDateTime(locale, (plan as any).seriesInstanceDate) : "" })}</p> : null}
          <p className="text-sm text-slate-500">{plan.objective} · {t("campaignBuilder.statusLabel")}<span className="font-semibold">{statusLabel(plan.status)}</span> <span className={`cbx-pill cbx-pill-${plan.status}`}>{statusLabel(plan.status)}</span>
            {plan.status === "published" ? <>{t("campaignBuilder.metaStatusLabel")}<span className="font-semibold">{plan.metaStatus}</span>{t("campaignBuilder.campaignIdLabel")}{plan.externalCampaignId}</> : null}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {t("campaignBuilder.totalDailyBudget")}<span className="font-semibold">{fmtMoneyBn(plan.adSets.reduce((a, s) => a + BigInt(s.dailyBudgetMinor ?? "0"), 0n))}</span>
            {" · "}{t("campaignBuilder.lifetimeTotal")}{fmtMoneyBn(plan.adSets.reduce((a, s) => a + BigInt(s.lifetimeBudgetMinor ?? "0"), 0n))}
            {(plan as any).dailyBudgetCapMinor ? <>{t("campaignBuilder.dailyCapPart", { amount: fmtMoneyBn((plan as any).dailyBudgetCapMinor) })}</> : null}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {t("campaignBuilder.budgetModeLine")}<span className="font-semibold">{plan.advantagePlus ? t("campaignBuilder.budgetModeAdvantage") : plan.budgetMode === "cbo" ? t("campaignBuilder.budgetModeCbo") : t("campaignBuilder.budgetModeAbo")}</span>
            {plan.budgetMode === "cbo" || plan.advantagePlus ? <>{t("campaignBuilder.campaignDailyPart", { daily: plan.campaignDailyBudgetMinor ? fmtMoneyBn(plan.campaignDailyBudgetMinor) : "—", lifetime: plan.campaignLifetimeBudgetMinor ? fmtMoneyBn(plan.campaignLifetimeBudgetMinor) : "—" })}</> : null}
          </p>
          {lastActivity?.available ? <p className="mt-1 text-sm text-slate-600">{t("campaignBuilder.lastActivity", { actor: lastActivity.actorName ?? "—", action: lastActivity.action ? ` · ${lastActivity.action}` : "", at: lastActivity.at ? ` · ${fmtDateTime(locale, lastActivity.at)}` : "" })}<span className="text-xs text-slate-400">{t("campaignBuilder.lastActivityNote")}</span></p> : null}
          {plan.status === "pending_approval" && plan.firstApproverId ? <p className="mt-1 rounded-lg bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-800">{t("campaignBuilder.firstApprovalDone", { at: plan.firstApprovedAt ? t("campaignBuilder.firstApprovalAt", { date: fmtDateTime(locale, plan.firstApprovedAt) }) : "" })}</p> : null}
          {plan.publishAt ? <p className="mt-1 rounded-lg bg-sky-50 px-3 py-1.5 text-sm text-sky-800">{t("campaignBuilder.launchScheduled", { date: fmtDateTime(locale, plan.publishAt) })}</p> : null}
          {plan.pauseAt ? <p className="mt-1 rounded-lg bg-amber-50 px-3 py-1.5 text-sm text-amber-800">{t("campaignBuilder.pauseWindowLine", { pauseAt: fmtDateTime(locale, plan.pauseAt), pauseDone: plan.pauseExecutedAt ? t("campaignBuilder.executedSuffix") : "", resume: plan.resumeAt ? t("campaignBuilder.resumePart", { date: fmtDateTime(locale, plan.resumeAt), done: plan.resumeExecutedAt ? t("campaignBuilder.executedSuffix") : "" }) : "" })}</p> : null}
          </div>
          {/* CA12: pause-window editor (published plans) */}
          {scheduleOpen && plan.status === "published" ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="font-semibold">{t("campaignBuilder.scheduleTitle")}<span className="text-xs font-normal text-slate-500">{t("campaignBuilder.scheduleTzNote", { tz: schedule?.timezone ?? "Asia/Dhaka" })}</span></p>
              <p className="mt-0.5 text-xs text-slate-600">{t("campaignBuilder.scheduleCondition")}</p>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="block text-xs font-semibold text-slate-700">{t("campaignBuilder.pauseTimeLabel")}
                  <input type="datetime-local" className="input mt-1 w-56" id="sched-pause-at" defaultValue={schedule?.pauseAt ? new Date(new Date(schedule.pauseAt).getTime() - new Date(schedule.pauseAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""} />
                </label>
                <label className="block text-xs font-semibold text-slate-700">{t("campaignBuilder.resumeTimeLabel")}
                  <input type="datetime-local" className="input mt-1 w-56" id="sched-resume-at" defaultValue={schedule?.resumeAt ? new Date(new Date(schedule.resumeAt).getTime() - new Date(schedule.resumeAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""} />
                </label>
                <button className="btn-primary btn-sm" disabled={busy !== ""} onClick={async () => {
                  const pv = (document.getElementById("sched-pause-at") as HTMLInputElement)?.value ?? "";
                  const rv = (document.getElementById("sched-resume-at") as HTMLInputElement)?.value ?? "";
                  if (!pv && !rv) { setError(t("campaignBuilder.errPauseTime")); return; }
                  const res = await wrap("sched-set", () => apiFetch<NonNullable<typeof schedule>>(`/organizations/${orgId}/campaign-plans/${plan.id}/schedule`, { method: "POST", body: JSON.stringify({ pauseAt: pv ? new Date(pv).toISOString() : null, resumeAt: rv ? new Date(rv).toISOString() : null }) }));
                  if (res) { setSchedule(res); setNotice(t("campaignBuilder.windowSaved")); await loadPlan(plan.id); }
                }}>{t("campaignBuilder.windowSaveBtn")}</button>
                {schedule?.pauseAt || schedule?.resumeAt ? <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                  const res = await wrap("sched-clear", () => apiFetch<NonNullable<typeof schedule>>(`/organizations/${orgId}/campaign-plans/${plan.id}/schedule`, { method: "POST", body: JSON.stringify({ pauseAt: null, resumeAt: null }) }));
                  if (res) { setSchedule(res); setNotice(t("campaignBuilder.windowRemoved")); await loadPlan(plan.id); }
                }}>{t("campaignBuilder.windowRemoveBtn")}</button> : null}
              </div>
              {schedule?.pauseExecutedAt ? <p className="mt-1 text-xs text-slate-600">{t("campaignBuilder.pauseExecuted", { date: new Intl.DateTimeFormat(intlLocaleOf(locale), { timeZone: schedule.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(schedule.pauseExecutedAt)) })}</p> : null}
              {schedule?.resumeExecutedAt ? <p className="mt-1 text-xs text-slate-600">{t("campaignBuilder.resumeExecuted", { date: new Intl.DateTimeFormat(intlLocaleOf(locale), { timeZone: schedule.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(schedule.resumeExecutedAt)) })}</p> : null}
            </div>
          ) : null}
          {/* CA13: naming-template rename dialog — preview diff,
              then a confirmed apply (local records only). */}
          {namingOpen ? (
            <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm">
              <p className="font-semibold">{t("campaignBuilder.namingTitle")}<span className="text-xs font-normal text-slate-500">(CA13)</span></p>
              {!namingPreview ? <p className="mt-1 text-xs text-slate-600">{t("campaignBuilder.namingLoading")}</p> : (
                <>
                  <p className="mt-0.5 text-xs text-slate-600">Template: <code className="rounded bg-white px-1">{namingPreview.template}</code> — {namingPreview.note}</p>
                  <div className="mt-2 space-y-1">
                    {namingPreview.items.map((it) => (
                      <p key={`${it.level}-${it.id}`} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-2 py-1 text-xs">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold">{it.level === "plan" ? "Plan" : it.level === "ad_set" ? "Ad Set" : "Ad"}</span>
                        <span className="text-slate-500 line-through">{it.currentName}</span>
                        <span>→</span>
                        {it.newName ? <span className={it.changed ? "font-semibold text-violet-800" : "text-slate-600"}>{it.newName}</span> : <span className="text-amber-700">{t("campaignBuilder.namingNoName")}</span>}
                        {it.newName && !it.changed ? <span className="text-slate-400">{t("campaignBuilder.namingSame")}</span> : null}
                      </p>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button className="btn-primary btn-sm" disabled={busy !== "" || !namingPreview.items.some((i) => i.changed)} onClick={async () => {
                      const items = namingPreview.items.filter((i) => i.changed && i.newName).map((i) => ({ level: i.level, id: i.id, newName: i.newName as string }));
                      if (!window.confirm(t("campaignBuilder.namingConfirm", { count: fmtNumber(locale, items.length) }))) return;
                      const res = await wrap("naming-apply", () => apiFetch<{ appliedCount: number; failedCount: number; results: { level: string; id: string; ok: boolean; error?: string }[]; note: string }>(`/organizations/${orgId}/campaign-plans/${plan.id}/naming/apply`, { method: "POST", body: JSON.stringify({ items }) }));
                      if (res) {
                        setNamingResult(t("campaignBuilder.namingResult", { applied: fmtNumber(locale, res.appliedCount), failed: res.failedCount ? t("campaignBuilder.namingFailedPart", { count: fmtNumber(locale, res.failedCount), errors: res.results.filter((r) => !r.ok).map((r) => r.error).join(", ") }) : "", note: res.note }));
                        await loadPlan(plan.id);
                        const fresh = await apiFetch<NonNullable<typeof namingPreview>>(`/organizations/${orgId}/campaign-plans/${plan.id}/naming/preview`, { method: "POST", body: JSON.stringify({}) }).catch(() => null);
                        if (fresh) setNamingPreview(fresh);
                      }
                    }}>{t("campaignBuilder.namingApplyBtn")}</button>
                    <button className="btn-secondary btn-sm" onClick={() => setNamingOpen(false)}>{t("campaignBuilder.closeBtn")}</button>
                  </div>
                  {namingResult ? <p className="mt-1 text-xs font-semibold text-violet-900">{namingResult}</p> : null}
                </>
              )}
            </div>
          ) : null}
          {/* DX2 / J3: the destination choice lives IN the Objective
              step. It binds the same adSetForm state the New Ad Set
              form (Audience step) submits, so picking here is the
              same choice — not a second, divergent one. Existing
              ad sets keep their own Destination select in their
              edit form. */}
          <div className={`mt-3 space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm ${activeStep !== 0 ? "hidden" : ""}`}>
            <p className="font-semibold leading-[1.7]">{t("campaignBuilder.destinationTitle")}<span className="text-xs font-normal text-slate-500">{t("campaignBuilder.destinationNote")}</span></p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-sm">{t("campaignBuilder.destinationLabel")}
                <select className="input mt-1" value={adSetForm.destinationType} onChange={(e) => setAdSetForm({ ...adSetForm, destinationType: e.target.value, whatsappIntegrationId: "" })}>
                  <option value="">{t("campaignBuilder.websiteOption")}</option>
                  <option value="WHATSAPP">{t("campaignBuilder.whatsappOption")}</option>
                </select>
              </label>
              {adSetForm.destinationType === "WHATSAPP" ? (
                <label className="block text-sm">{t("campaignBuilder.waConnectionLabel")}
                  <select className="input mt-1" value={adSetForm.whatsappIntegrationId} onChange={(e) => setAdSetForm({ ...adSetForm, whatsappIntegrationId: e.target.value })}>
                    <option value="">{t("campaignBuilder.connectionChoose")}</option>
                    {(waDestinations?.destinations ?? []).map((d) => (
                      <option key={d.integrationId} value={d.integrationId} disabled={!d.connected}>
                        {d.phoneNumberId ?? t("campaignBuilder.noPhoneId")} · WABA {d.wabaId ?? "—"}{d.isDefault ? " · Default" : ""}{d.connected ? "" : t("campaignBuilder.notUsable", { status: d.status })}
                      </option>
                    ))}
                  </select>
                  {(waDestinations?.destinations ?? []).filter((d) => d.connected).length === 0 ? (
                    <span className="mt-1 block text-xs font-medium text-red-600">{t("campaignBuilder.waNoneConnected")}</span>
                  ) : (
                    <span className="mt-1 block text-xs text-slate-500">{t("campaignBuilder.waNumberNote")}</span>
                  )}
                </label>
              ) : null}
            </div>
            <p className="text-xs leading-[1.7] text-slate-500">{t("campaignBuilder.destinationSharedNote")}</p>
          </div>
          <div className={activeStep !== 4 ? "hidden" : ""}>
          {(perf || pacing || breakdowns) ? <p className="mt-4 text-sm font-bold text-slate-700">{t("campaignBuilder.rvSummaryHeading")}</p> : null}
          {perf ? (
            <div className="mt-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm">
              <p className="font-semibold">{t("campaignBuilder.rvPerfTitle")}</p>
              {!perf.totals ? <p className="text-xs text-slate-500">{t("campaignBuilder.rvNoMetric")}</p> : (
                <>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span>{t("campaignBuilder.rvSpendLabel")}<b>{fmtMoneyBn(perf.totals.spendMinor)}</b></span>
                    <span>Impressions: <b>{fmtNumBn(perf.totals.impressions)}</b></span>
                    <span>Clicks: <b>{fmtNumBn(perf.totals.clicks)}</b></span>
                    <span>CTR: <b>{perf.totals.ctrPercent ?? "—"}%</b></span>
                    <span>Conversions: <b>{perf.totals.conversions}</b></span>
                    <span>CPA: <b>{perf.totals.cpaMinor ? fmtMoneyBn(perf.totals.cpaMinor) : "—"}</b></span>
                    <span>{t("campaignBuilder.rvOwnOrders")}<b>{fmtNumBn(perf.totals.firstPartyOrders)}</b> · Revenue: <b>{fmtMoneyBn(perf.totals.firstPartyRevenueMinor)}</b></span>
                    <span>ROAS: <b>{perf.totals.roas ?? "—"}</b></span>
                  </div>
                  {perf.perAdSet.filter((s) => s.spendMinor !== "0").map((s) => (
                    <div key={s.adSetId} className="text-xs text-slate-600">{t("campaignBuilder.rvPerAdSet", { name: s.name, spend: fmtMoneyBn(s.spendMinor), impressions: fmtNumBn(s.impressions), conversions: fmtNumBn(s.conversions) })}</div>
                  ))}
                </>
              )}
              {perf.attribution ? (
                <p className="mt-2 border-t border-sky-200 pt-2 text-xs text-slate-600">
                  {t("campaignBuilder.rvAttribution")}<b>{perf.attribution.firstParty.windowDays != null ? t("campaignBuilder.rvWindowSet", { days: fmtNumBn(perf.attribution.firstParty.windowDays) }) : t("campaignBuilder.rvNotSet")}</b>{t("campaignBuilder.rvFromOrgSetting")}
                  {" · "}{t("campaignBuilder.rvMetaGoogleTikTok", { notSet: t("campaignBuilder.rvNotSet") })}
                  <span className="text-slate-400">{t("campaignBuilder.rvAttributionNote")}</span>
                </p>
              ) : null}
            </div>
          ) : null}
          {plan.externalCampaignId ? (
            <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm">
              <p className="font-semibold">{t("campaignBuilder.rvAdjTitle")}</p>
              {!adjRoas ? (
                <button className="mt-1 rounded border bg-white px-2 py-1 text-xs font-semibold" disabled={busy !== ""} onClick={async () => {
                  const res = await wrap("adjroas", () => apiFetch<NonNullable<typeof adjRoas>>(`/organizations/${orgId}/campaign-plans/${plan.id}/adjusted-roas`));
                  if (res) setAdjRoas(res);
                }}>{t("campaignBuilder.rvAdjBtn")}</button>
              ) : !adjRoas.available ? <p className="mt-1 rounded-lg border border-slate-200 bg-white/60 p-2 text-xs leading-[1.7] text-slate-500">ℹ️ {adjRoas.reason}</p> : (
                <div className="mt-1 grid gap-1 text-xs leading-[1.7] text-slate-700">
                  <p>{t("campaignBuilder.rvAdjLine1", { matched: fmtNumBn(adjRoas.codMatchedOrders ?? 0), delivered: fmtNumBn(adjRoas.deliveredOrders ?? 0), returned: fmtNumBn(adjRoas.returnedOrders ?? 0), returnedValue: fmtMoneyBn(adjRoas.returnedValueMinor ?? "0"), spend: fmtMoneyBn(adjRoas.spendMinor ?? "0") })}</p>
                  <p>{t("campaignBuilder.rvAdjLine2a")}<b>{adjRoas.rawRoas ?? "—"}</b> · <span className="font-semibold text-rose-700">{t("campaignBuilder.rvAdjLine2b")}{adjRoas.adjustedRoas ?? "—"}</span></p>
                  <p>{t("campaignBuilder.rvAdjLine3", { gross: fmtMoneyBn(adjRoas.grossRevenueMinor ?? "0"), refunded: fmtMoneyBn(adjRoas.refundedMinor ?? "0") })}<b>{fmtMoneyBn(adjRoas.adjustedRevenueMinor ?? "0")}</b></p>
                  {adjRoas.existingFirstParty ? <p className="text-slate-500">{t("campaignBuilder.rvAdjExisting", { revenue: fmtMoneyBn(adjRoas.existingFirstParty.revenueMinor), roas: adjRoas.existingFirstParty.roas ?? "—", note: adjRoas.existingFirstParty.note })}</p> : null}
                  {adjRoas.zeroSpendNote ? <p className="text-amber-700">{adjRoas.zeroSpendNote}</p> : null}
                </div>
              )}
              {adjRoas ? <p className="mt-1 text-xs leading-[1.7] text-slate-400">{adjRoas.scope}</p> : null}
            </div>
          ) : null}
          {pacing ? (
            <div className="mt-2 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm">
              <p className="font-semibold">{t("campaignBuilder.rvPacingTitle")}</p>
              {pacing.status === "no_data" ? <p className="rounded-lg border border-slate-200 bg-white/60 p-2 text-xs leading-[1.7] text-slate-500">{t("campaignBuilder.rvPacingNoData")}</p> : (
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span>{t("campaignBuilder.rvSpentToDate")}<b>{fmtMoneyBn(pacing.spentMinor)}</b></span>
                  <span>{t("campaignBuilder.rvExpectedToDate")}<b>{pacing.expectedMinor != null ? fmtMoneyBn(pacing.expectedMinor) : "—"}</b></span>
                  <span>{t("campaignBuilder.rvVarianceLabel")}<b>{pacing.varianceMinor != null ? fmtMoneyBn(pacing.varianceMinor) : "—"}</b></span>
                  <span>{t("campaignBuilder.rvDaysLabel")}<b>{pacing.daysElapsed ?? "—"}{pacing.daysTotal ? ` / ${pacing.daysTotal}` : ""}</b></span>
                  <span>Mode: <b>{pacing.budgetMode ?? "—"}</b></span>
                </div>
              )}
              <p className="mt-1 text-xs text-slate-400">{t("campaignBuilder.rvPacingNote")}</p>
              {pacing.runway ? (
                <div className="mt-2 rounded-lg bg-white/60 p-2 text-xs leading-[1.7]">
                  <p className="font-semibold">{t("campaignBuilder.rvRunwayTitle")}</p>
                  {pacing.runway.available ? (
                    <p>{t("campaignBuilder.rvRunwayLine", { remaining: fmtMoneyBn(pacing.runway.remainingMinor ?? "0"), days: pacing.runway.metricDays ?? "—", burn: fmtMoneyBn(pacing.runway.burnMinorPerDay ?? "0"), runwayDays: pacing.runway.runwayDays ?? "—", date: pacing.runway.projectedExhaustionDate ? pacing.runway.projectedExhaustionDate.slice(0, 10) : "—" })}</p>
                  ) : <p className="text-slate-500">{t("campaignBuilder.rvNoInfo", { reason: pacing.runway.reason ?? "" })}</p>}
                  <p className="text-slate-400">{pacing.runway.label}</p>
                </div>
              ) : null}
              {pacingAlerts && pacingAlerts.active.length ? (
                <div className="mt-2 space-y-1">
                  {pacingAlerts.active.map((a) => (
                    <p key={a.id} className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs leading-[1.7] text-amber-800">⚠️ {a.message}</p>
                  ))}
                  <p className="text-xs text-slate-400">{t("campaignBuilder.rvAlertRule", { margin: fmtNumBn(pacingAlerts.thresholds.exhaustionMarginDays), pct: fmtNumBn(pacingAlerts.thresholds.overspendPercent) })}</p>
                </div>
              ) : null}
            </div>
          ) : null}
          {breakdowns ? (
            <div className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm">
              <p className="font-semibold">{t("campaignBuilder.rvBreakdownTitle")}</p>
              {!breakdowns.published ? <p className="rounded-lg border border-slate-200 bg-white/60 p-2 text-xs leading-[1.7] text-slate-500">{t("campaignBuilder.rvNotPublished")}</p> : (
                <div className="mt-1 grid gap-2 md:grid-cols-2">
                  {([["age", "rvDimAge"], ["gender", "rvDimGender"], ["placement", "Placement"], ["device", "Device"]] as const).map(([dim, label]) => {
                    const d = breakdowns.dimensions[dim];
                    return (
                      <div key={dim} className="rounded-lg bg-white/60 p-2">
                        <p className="text-xs font-semibold">{label.startsWith("rv") ? t(`campaignBuilder.${label}`) : label}</p>
                        {!d || !d.hasData ? <p className="text-xs text-slate-400">{t("campaignBuilder.rvBreakdownNoData")}</p> : d.rows.slice(0, 6).map((r) => (
                          <div key={r.key} className="text-xs text-slate-600">{t("campaignBuilder.rvBreakdownRow", { key: r.key, spend: fmtMoneyBn(r.spendMinor), impressions: fmtNumBn(r.impressions), clicks: fmtNumBn(r.clicks), conversions: fmtNumBn(r.conversions), cpa: r.cpaMinor ? fmtMoneyBn(r.cpaMinor) : "—" })}</div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
          {regionPerf ? (
            <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
              <p className="font-semibold">{t("campaignBuilder.rvRegionTitle")}</p>
              {!regionPerf.available ? <p className="rounded-lg border border-slate-200 bg-white/60 p-2 text-xs leading-[1.7] text-slate-500">ℹ️ {regionPerf.reason}</p> : (
                <>
                  <p className="text-xs text-slate-500">{regionPerf.note}{t("campaignBuilder.rvRegionNote", { min: fmtNumBn(regionPerf.minRows), below: regionPerf.rowsBelowThreshold ? t("campaignBuilder.rvRegionBelow", { count: fmtNumBn(regionPerf.rowsBelowThreshold) }) : "" })}</p>
                  <div className="mt-1 grid gap-1">
                    {regionPerf.regions.map((r) => (
                      <div key={r.region} className="flex flex-wrap items-center justify-between gap-2 rounded bg-white/60 px-2 py-1 text-xs text-slate-700">
                        <span>{r.region}{r.divisionLabel ? ` (${r.divisionLabel})` : ""}</span>
                        <span>{t("campaignBuilder.rvRegionRow", { spend: fmtMoneyBn(r.spendMinor), conversions: fmtNumBn(r.conversions), cpa: r.cpa != null ? fmtMoneyBn(BigInt(Math.round(r.cpa)) * 100n) : "—", rows: fmtNumBn(r.rows) })}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-600">{t("campaignBuilder.rvRegionSrcLabel")}</span>
                    <select className="input w-56" id="region-src-set">
                      {plan.adSets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <button className="rounded border bg-white px-2 py-1 text-xs font-semibold" disabled={busy !== ""} onClick={async () => {
                      const src = (document.getElementById("region-src-set") as HTMLSelectElement)?.value ?? "";
                      if (!src) { setError(t("campaignBuilder.rvErrSourceAdSet")); return; }
                      const res = await wrap("region-draft", () => apiFetch<{ adSet: { id: string; name: string }; regions: { key: string; name: string }[]; notCarried: string[]; note: string }>(`/organizations/${orgId}/campaign-plans/${plan.id}/region-ad-set`, { method: "POST", body: JSON.stringify({ sourceAdSetId: src, topN: 3 }) }));
                      if (res) {
                        setRegionDraftNote(t("campaignBuilder.rvRegionDraftCreated", { name: res.adSet.name, regions: res.regions.map((r) => r.name).join(", "), notCarried: res.notCarried.length ? t("campaignBuilder.rvRegionNotCarried", { items: res.notCarried.join("; ") }) : "", note: res.note }));
                        await loadPlan(plan.id);
                      }
                    }}>{t("campaignBuilder.rvRegionDraftBtn")}</button>
                    <span className="text-xs text-slate-500">{t("campaignBuilder.rvRegionDraftNote")}</span>
                  </div>
                  {regionDraftNote ? <p className="mt-1 text-xs text-emerald-800">{regionDraftNote}</p> : null}
                </>
              )}
            </div>
          ) : null}
          {plan.externalCampaignId ? (
            <div className="mt-2 rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm">
              <p className="font-semibold">{t("campaignBuilder.rvHoldoutTitle")}</p>
              <p className="mt-1 text-xs leading-[1.7] text-slate-500">{t("campaignBuilder.rvHoldoutIntro")}</p>
              {!geoHoldout ? (
                <button className="mt-2 rounded border bg-white px-2 py-1 text-xs font-semibold" disabled={busy !== ""} onClick={async () => {
                  const res = await wrap("holdout-load", () => apiFetch<GeoHoldoutData>(`/organizations/${orgId}/campaign-plans/${plan.id}/geo-holdout`));
                  if (res) setGeoHoldout(res);
                }}>{t("campaignBuilder.rvHoldoutLoadBtn")}</button>
              ) : !geoHoldout.holdout ? (
                <div className="mt-2 grid gap-2">
                  <p className="text-xs text-slate-500">{geoHoldout.reason}</p>
                  <label className="text-xs">{t("campaignBuilder.rvHoldoutTestLabel")}<input className="input mt-1 w-full" placeholder={t("campaignBuilder.rvHoldoutTestPlaceholder")} value={holdoutForm.test} onChange={(e) => setHoldoutForm({ ...holdoutForm, test: e.target.value })} /></label>
                  <label className="text-xs">{t("campaignBuilder.rvHoldoutHoldoutLabel")}<input className="input mt-1 w-full" placeholder={t("campaignBuilder.rvHoldoutHoldoutPlaceholder")} value={holdoutForm.holdout} onChange={(e) => setHoldoutForm({ ...holdoutForm, holdout: e.target.value })} /></label>
                  <div className="flex flex-wrap gap-2">
                    <label className="text-xs">{t("campaignBuilder.rvHoldoutStart")}<input type="date" className="input mt-1" value={holdoutForm.start} onChange={(e) => setHoldoutForm({ ...holdoutForm, start: e.target.value })} /></label>
                    <label className="text-xs">{t("campaignBuilder.rvHoldoutEnd")}<input type="date" className="input mt-1" value={holdoutForm.end} onChange={(e) => setHoldoutForm({ ...holdoutForm, end: e.target.value })} /></label>
                  </div>
                  <button className="w-fit rounded border bg-white px-2 py-1 text-xs font-semibold" disabled={busy !== ""} onClick={async () => {
                    if (!holdoutForm.test.trim() || !holdoutForm.holdout.trim() || !holdoutForm.start || !holdoutForm.end) { setError(t("campaignBuilder.rvErrHoldoutRequired")); return; }
                    const res = await wrap("holdout-create", () => apiFetch<GeoHoldoutData>(`/organizations/${orgId}/campaign-plans/${plan.id}/geo-holdout`, { method: "POST", body: JSON.stringify({ testRegions: holdoutForm.test, holdoutRegions: holdoutForm.holdout, startsAt: new Date(`${holdoutForm.start}T00:00:00`).toISOString(), endsAt: new Date(`${holdoutForm.end}T23:59:59`).toISOString() }) }));
                    if (res) { setGeoHoldout(res); setNotice(t("campaignBuilder.rvHoldoutSaved")); }
                  }}>{t("campaignBuilder.rvHoldoutSaveBtn")}</button>
                </div>
              ) : (
                <div className="mt-2 grid gap-1 text-xs leading-[1.7] text-slate-700">
                  <p>{t("campaignBuilder.rvHoldoutSummary", { test: geoHoldout.holdout.testRegions.join(", "), holdout: geoHoldout.holdout.holdoutRegions.join(", "), start: geoHoldout.holdout.startsAt?.slice(0, 10) ?? "", end: geoHoldout.holdout.endsAt?.slice(0, 10) ?? "", status: geoHoldout.holdout.status === "active" ? t("campaignBuilder.rvHoldoutActive") : t("campaignBuilder.rvHoldoutEnded") })}</p>
                  {geoHoldout.measurement && !geoHoldout.measurement.available ? <p className="text-slate-500">ℹ️ {geoHoldout.measurement.reason}</p> : geoHoldout.measurement?.groups ? (
                    <>
                      {(["test", "holdout", "other"] as const).map((k) => {
                        const g = geoHoldout.measurement!.groups![k];
                        return <p key={k}>{t("campaignBuilder.rvHoldoutGroupLine", { group: k === "test" ? t("campaignBuilder.rvGroupTest") : k === "holdout" ? t("campaignBuilder.rvGroupHoldout") : t("campaignBuilder.rvGroupOther"), spend: fmtMoneyBn(g.spendMinor), conversions: fmtNumBn(g.conversions), cpa: g.cpa != null ? fmtMoneyBn(BigInt(Math.round(g.cpa)) * 100n) : "—", per1000: g.conversionsPer1000Spend ?? "—" })}</p>;
                      })}
                      {geoHoldout.measurement.observedDifferencePer1000 != null ? <p>{geoHoldout.measurement.observedDifferenceLabel}: <b>{geoHoldout.measurement.observedDifferencePer1000}</b></p> : null}
                      {geoHoldout.measurement.holdoutSpendNote ? <p className={geoHoldout.measurement.holdoutSpendDetected ? "font-semibold text-amber-700" : "text-slate-500"}>{geoHoldout.measurement.holdoutSpendNote}</p> : null}
                    </>
                  ) : null}
                  <p className="text-slate-400">{geoHoldout.method}</p>
                  {geoHoldout.holdout.status === "active" ? (
                    <button className="w-fit rounded border bg-white px-2 py-1 text-xs font-semibold" disabled={busy !== ""} onClick={async () => {
                      const res = await wrap("holdout-end", () => apiFetch<GeoHoldoutData>(`/organizations/${orgId}/campaign-plans/${plan.id}/geo-holdout/${geoHoldout.holdout!.id}/end`, { method: "POST", body: JSON.stringify({}) }));
                      if (res) setGeoHoldout(res);
                    }}>{t("campaignBuilder.rvHoldoutEndBtn")}</button>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}
          {recs ? (
            <>
              <p className="mt-4 text-sm font-bold text-slate-700">{t("campaignBuilder.rvDeadWinnersHeading")}</p>
              <div className="mt-2 rounded-xl border border-slate-200 bg-white p-3 text-sm">
                {recs.recommendations.filter((r) => r.type === "dead_ad_set").map((r, i) => (
                  <div key={`dw-d${i}`} className="text-xs leading-[1.7] text-slate-700">🪦 <b>{r.name}</b>{t("campaignBuilder.rvDeadLine", { spend: fmtMoneyBn(r.evidence.spendMinor), impressions: fmtNumBn(r.evidence.impressions) })}</div>
                ))}
                {recs.recommendations.filter((r) => r.type === "budget_shift").map((r, i) => (
                  <div key={`dw-w${i}`} className="text-xs leading-[1.7] text-slate-700">🏆 <b>{r.evidence.winnerName}</b>{t("campaignBuilder.rvWinnerLine", { cpa: r.evidence.winnerCpaMinor ? fmtMoneyBn(r.evidence.winnerCpaMinor) : "—", conversions: fmtNumBn(r.evidence.winnerConversions), donor: r.evidence.donorName })}</div>
                ))}
                {recs.recommendations.filter((r) => r.type === "dead_ad_set" || r.type === "budget_shift").length === 0 ? <p className="text-xs text-slate-500">{t("campaignBuilder.rvDeadWinnersNone")}</p> : null}
              </div>
            </>
          ) : null}
          {creativeInsights ? <p className="mt-4 text-sm font-bold text-slate-700">{t("campaignBuilder.rvFatigueHeading")}</p> : null}
          {creativeInsights ? (
            <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm">
              <p className="font-semibold">{t("campaignBuilder.rvInsightsTitle")}</p>
              <p className="text-xs text-slate-500">{creativeInsights.rule}</p>
              {creativeInsights.ads.length === 0 ? <p className="text-xs text-slate-500">{t("campaignBuilder.rvNoPublishedAds")}</p> : creativeInsights.ads.map((a) => (
                <div key={a.adId} className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-700">
                  <span className="font-medium">{a.name}</span>
                  {!a.hasData ? <span className="text-slate-400">{t("campaignBuilder.rvInsightsNoData")}</span> : (<>
                    <span>{t("campaignBuilder.rvInsightsSpend")}{fmtMoneyBn(a.spendMinor)}</span><span>CTR {a.ctrPercent ?? "—"}%</span>
                    <span>Frequency {a.frequency ?? "—"}</span><span>CPA {a.cpaMinor ? fmtMoneyBn(a.cpaMinor) : "—"}</span>
                    {a.fatigued ? <span className="rounded bg-red-100 px-1.5 py-0.5 font-semibold text-red-700">{t("campaignBuilder.rvInsightsFatigued", { pct: a.ctrDropPercent ?? "" })}</span> : null}
                  </>)}
                </div>
              ))}
            </div>
          ) : null}
          {recs ? <p className="mt-4 text-sm font-bold text-slate-700">{t("campaignBuilder.rvProposalsHeading")}</p> : null}
          {recs ? (
            <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="font-semibold">{t("campaignBuilder.rvRecsTitle")}</p>
              <p className="text-xs text-slate-500">{t("campaignBuilder.rvRecsRule", { threshold: fmtMoneyBn(recs.thresholds.deadAdSetSpendMinor), pct: fmtNumBn(recs.thresholds.budgetShiftPercent) })}</p>
              {recs.recommendations.length === 0 ? <p className="mt-1 text-xs text-emerald-700">{t("campaignBuilder.rvRecsNone")}</p> : recs.recommendations.map((r, i) => (
                <div key={i} className="mt-2 rounded-lg bg-white/70 p-2 text-xs text-slate-700">
                  {r.type === "fatigued_creative" ? (<>
                    <p>😫 <b>{r.name}</b>{t("campaignBuilder.rvRecFatiguedLine", { frequency: r.evidence.frequency, drop: r.evidence.ctrDropPercent, spend: fmtMoneyBn(r.evidence.spendMinor) })}</p>
                    <button className="btn-secondary btn-sm mt-1" disabled={busy !== ""} onClick={async () => {
                      const res = await wrap(`rec-fresh-${r.adId}`, () => apiFetch<{ draftId: string; note: string }>(`/organizations/${orgId}/campaign-plans/${plan.id}/recommendations/apply`, { method: "POST", body: JSON.stringify({ kind: "create_fresh_draft", adId: r.adId }) }));
                      if (res) setNotice(res.note);
                    }}>{t("campaignBuilder.rvRecFreshBtn")}</button>
                  </>) : r.type === "dead_ad_set" ? (<>
                    <p>🪦 <b>{r.name}</b>{t("campaignBuilder.rvRecDeadLine", { spend: fmtMoneyBn(r.evidence.spendMinor), impressions: fmtNumBn(r.evidence.impressions) })}</p>
                    <button className="btn-warning btn-sm mt-1" disabled={busy !== ""} onClick={async () => {
                      const res = await wrap(`rec-pause-${r.adSetId}`, () => apiFetch(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets/${r.adSetId}/status`, { method: "POST", body: JSON.stringify({ target: "PAUSED" }) }));
                      if (res) { setNotice(t("campaignBuilder.rvRecMetaPaused")); await loadPlan(plan.id); }
                    }}>{t("campaignBuilder.rvRecPauseBtn")}</button>
                  </>) : r.type === "budget_shift" ? (<>
                    <p>{t("campaignBuilder.rvRecShiftLine", { donor: r.evidence.donorName, donorCpa: r.evidence.donorCpaMinor ? fmtMoneyBn(r.evidence.donorCpaMinor) : "—", donorConv: fmtNumBn(r.evidence.donorConversions), winner: r.evidence.winnerName, winnerCpa: fmtMoneyBn(r.evidence.winnerCpaMinor), winnerConv: fmtNumBn(r.evidence.winnerConversions), shift: fmtMoneyBn(r.proposal.shiftMinor), donorAfter: fmtMoneyBn(r.proposal.fromDailyAfterMinor), winnerAfter: fmtMoneyBn(r.proposal.toDailyAfterMinor) })}</p>
                    <p className="mt-0.5 text-slate-500">{t("campaignBuilder.rvRecShiftNote")}</p>
                    <button className="btn-primary btn-sm mt-1" disabled={busy !== ""} onClick={async () => {
                      if (!confirm(t("campaignBuilder.rvRecShiftConfirm", { donor: r.evidence.donorName, winner: r.evidence.winnerName, shift: fmtMoneyBn(r.proposal.shiftMinor) }))) return;
                      const res = await wrap("rec-shift", () => apiFetch<{ applied: boolean; verified: boolean; note: string }>(`/organizations/${orgId}/campaign-plans/${plan.id}/recommendations/apply`, { method: "POST", body: JSON.stringify({ kind: "budget_shift", proposal: r.proposal }) }));
                      // সংখ্যা বদলে গেলে (stale) সার্ভার refuse করে — তালিকা
                      // refresh করলে নতুন প্রস্তাবটি দেখা যাবে।
                      const fresh = await apiFetch<NonNullable<typeof recs>>(`/organizations/${orgId}/campaign-plans/${plan.id}/recommendations`).catch(() => null);
                      if (fresh) setRecs(fresh);
                      if (res) { setNotice(res.note); await loadPlan(plan.id); }
                    }}>{t("campaignBuilder.rvRecShiftBtn")}</button>
                  </>) : null}
                </div>
              ))}
            </div>
          ) : null}
          {plan.status === "published" ? (
          <div className="mt-2 rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm">
            <p className="font-semibold">{t("campaignBuilder.rvShareTitle")}<span className="text-xs font-normal text-slate-400">{t("campaignBuilder.rvShareNote")}</span></p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-600">{t("campaignBuilder.rvShareRange")}</span>
              <select className="input w-36" id="share-days">
                <option value="7">{t("campaignBuilder.rvShareLast7")}</option>
                <option value="30">{t("campaignBuilder.rvShareLast30")}</option>
                <option value="90">{t("campaignBuilder.rvShareLast90")}</option>
              </select>
              <span className="text-xs font-semibold text-slate-600">{t("campaignBuilder.rvShareExpiry")}</span>
              <select className="input w-44" id="share-exp">
                <option value="7">{t("campaignBuilder.rvShareExp7")}</option>
                <option value="30">{t("campaignBuilder.rvShareExp30")}</option>
                <option value="90">{t("campaignBuilder.rvShareExp90")}</option>
              </select>
              <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                const days = Number((document.getElementById("share-days") as HTMLSelectElement)?.value ?? 30);
                const expiresInDays = Number((document.getElementById("share-exp") as HTMLSelectElement)?.value ?? 30);
                const res = await wrap("share-create", () => apiFetch<{ token: string }>(`/organizations/${orgId}/report-shares`, { method: "POST", body: JSON.stringify({ title: `Campaign Report — ${plan.name}`, kind: "campaign", planId: plan.id, days, expiresInDays }) }));
                if (res?.token) { setShareLink(`${window.location.origin}/r/${res.token}`); setNotice(t("campaignBuilder.rvShareCreated")); }
              }}>{t("campaignBuilder.rvShareCreateBtn")}</button>
            </div>
            {shareLink ? <p className="mt-2 break-all text-xs text-violet-800">{shareLink}</p> : null}
          </div>
          ) : null}
          {waConvs ? (
            <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
              <p className="font-semibold">{t("campaignBuilder.rvWaTitle")}<b>{waConvs.available ? fmtNumBn(waConvs.totalConversations ?? 0) : "—"}</b></p>
              {!waConvs.available ? <p className="rounded-lg border border-amber-200 bg-white/60 p-2 text-xs leading-[1.7] text-slate-500">{t("campaignBuilder.rvWaUnavailable", { reason: waConvs.reason ?? "" })}</p> : waConvs.perAd.length === 0 ? <p className="text-xs text-slate-500">{t("campaignBuilder.rvWaNoneYet")}</p> : waConvs.perAd.map((a) => (
                <div key={a.adId} className="text-xs text-slate-600">{a.name} ({a.adSetName}): {t("campaignBuilder.rvWaPerAd", { count: fmtNumBn(a.conversationsStarted) })}</div>
              ))}
              <p className="mt-1 text-xs text-slate-400">{waConvs.label}</p>
            </div>
          ) : null}
          {guardrails ? (
            <div className="mt-2 rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm">
              <p className="font-semibold">{t("campaignBuilder.rvGuardrailsTitle")}</p>
              <p className="text-xs text-slate-500">{t("campaignBuilder.rvGuardrailsIntro")}</p>
              {guardrails.linked.length === 0 ? <p className="mt-1 text-xs text-slate-500">{t("campaignBuilder.rvGuardrailsNoneLinked")}</p> : guardrails.linked.map((r) => (
                <div key={r.id} className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-700">
                  <span className="font-medium">{r.name}</span><span>{r.metric} {r.comparator} {r.threshold} ({fmtNumBn(r.windowDays)}{t("campaignBuilder.rvGuardrailDays")}) → {r.action}</span>
                  <span>{r.enabled ? t("campaignBuilder.rvGuardrailOn") : t("campaignBuilder.rvGuardrailOff")}</span>
                  <span>{t("campaignBuilder.rvGuardrailLastTrigger")}{r.lastTriggeredAt ? fmtDateTime(locale, r.lastTriggeredAt) : t("campaignBuilder.rvGuardrailNever")}{r.lastRun ? ` · ${r.lastRun.status}${r.lastRun.detail ? `: ${r.lastRun.detail}` : ""}` : ""}</span>
                  <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                    const res = await wrap(`gr-detach-${r.id}`, () => apiFetch<NonNullable<typeof guardrails>>(`/organizations/${orgId}/campaign-plans/${plan.id}/guardrails/detach`, { method: "POST", body: JSON.stringify({ ruleId: r.id }) }));
                    if (res) setGuardrails(res);
                  }}>{t("campaignBuilder.rvGuardrailDetachBtn")}</button>
                </div>
              ))}
              {guardrails.orgWide.length ? <p className="mt-2 text-xs font-semibold text-slate-600">{t("campaignBuilder.rvGuardrailsOrgWide")}</p> : null}
              {guardrails.orgWide.map((r) => (
                <div key={r.id} className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-700">
                  <span className="font-medium">{r.name}</span><span>{r.metric} {r.comparator} {r.threshold} → {r.action}</span><span>{r.enabled ? t("campaignBuilder.rvGuardrailOn") : t("campaignBuilder.rvGuardrailOff")}</span>
                  <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                    const res = await wrap(`gr-attach-${r.id}`, () => apiFetch<NonNullable<typeof guardrails>>(`/organizations/${orgId}/campaign-plans/${plan.id}/guardrails/attach`, { method: "POST", body: JSON.stringify({ ruleId: r.id }) }));
                    if (res) setGuardrails(res);
                  }}>{t("campaignBuilder.rvGuardrailAttachBtn")}</button>
                </div>
              ))}
            </div>
          ) : null}
          {creativeHealth ? (
            <div className="mt-2 space-y-1 rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm">
              <p className="font-semibold">{t("campaignBuilder.rvCreativeHealthTitle", { count: fmtNumBn(creativeHealth.adsChecked) })}</p>
              {creativeHealth.findings.length === 0 ? <p className="text-xs text-emerald-700">{t("campaignBuilder.rvCreativeHealthNone")}</p> : creativeHealth.findings.map((f, i) => (
                <div key={i} className="text-xs"><span className={f.level === "error" ? "font-semibold text-red-700" : f.level === "not_checked" ? "font-semibold text-slate-500" : "font-semibold text-amber-700"}>{f.level === "error" ? "⛔" : f.level === "not_checked" ? "🔍" : "⚠"} {f.adName}:</span> <span className="text-slate-600">{f.message}</span></div>
              ))}
              <p className="text-xs text-slate-400">{t("campaignBuilder.rvCreativeHealthNote")}</p>
            </div>
          ) : null}
          {plan.rejectionReason ? <p className="text-sm text-red-600">{t("campaignBuilder.rvRejectionReason")}{plan.rejectionReason}</p> : null}
          {plan.status === "published" ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {plan.metaEffectiveStatus ? <span className={plan.metaEffectiveStatus === "ACTIVE" ? "badge badge-green" : plan.metaEffectiveStatus === "PAUSED" ? "badge badge-slate" : "badge badge-red"}>{t("campaignBuilder.rvMetaEffective", { status: plan.metaEffectiveStatus })}</span> : null}
              <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                const res = await wrap("statussync", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/status-sync`, { method: "POST" }));
                if (res) { setPlan(res); setNotice(res.healthIssues?.length ? t("campaignBuilder.rvStatusSyncIssues", { count: fmtNumBn(res.healthIssues.length) }) : t("campaignBuilder.rvStatusSyncOk")); }
              }}>{t("campaignBuilder.rvStatusSyncBtn")}{plan.lastStatusSyncAt ? t("campaignBuilder.rvStatusSyncLast", { date: fmtDateTime(locale, plan.lastStatusSyncAt) }) : ""}</button>
            </div>
          ) : null}
          {preflight && preflight.findings.length > 0 ? (
            <div className="mt-2 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="font-semibold">{t("campaignBuilder.rvPreflightTitle", { count: fmtNumBn(preflight.checkedAds) })}</p>
              {preflight.findings.map((f, i) => (
                <div key={i} className="rounded-lg bg-white p-2">
                  <span className={f.severity === "high" ? "badge badge-red" : f.severity === "medium" ? "badge badge-amber" : "badge badge-green"}>{f.severity}</span>{" "}
                  <b>{f.adName}</b> ({f.field}): “{f.snippet}”<br />
                  <span className="text-slate-600">{f.explanation}</span><br />
                  <span className="text-green-700">{t("campaignBuilder.rvPreflightAdvice")}{f.suggestion}</span>
                </div>
              ))}
              <p className="text-xs text-slate-500">{t("campaignBuilder.rvPreflightNote")}</p>
            </div>
          ) : null}
          {preflight?.platformChecks && preflight.platformChecks.length > 0 ? (
            <div className="mt-2 space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm">
              <p className="font-semibold">{t("campaignBuilder.rvPlatformTitle")}</p>
              {preflight.platformChecks.map((c, i) => (
                <div key={i} className="rounded-lg bg-white p-2">
                  <span className={c.status === "ok" ? "badge badge-green" : c.status === "error" ? "badge badge-red" : c.status === "warn" ? "badge badge-amber" : "badge badge-slate"}>{c.status === "not_checked" ? t("campaignBuilder.rvPlatformNotChecked") : c.status}</span>{" "}
                  <b>{c.label}</b>{c.subject ? <> — {c.subject}</> : null}<br />
                  <span className="text-slate-600">{c.detail}</span>
                </div>
              ))}
              <p className="text-xs text-slate-500">{t("campaignBuilder.rvPlatformNote")}</p>
            </div>
          ) : null}
          {plan.healthIssues && plan.healthIssues.length > 0 ? (
            <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <p className="font-semibold">{t("campaignBuilder.rvMetaIssuesTitle")}</p>
              <ul className="mt-1 list-inside list-disc">{plan.healthIssues.map((h, i) => <li key={i}>{h.level}: {h.name} — {h.status}</li>)}</ul>
            </div>
          ) : null}
          </div>
        </div>
        <div id="cbx-step-budget" tabIndex={-1} className={`r2-step-enter flex flex-wrap gap-2 ${activeStep !== 2 && activeStep !== 4 ? "hidden" : ""}`}>
          <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("dup", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/duplicate`, { method: "POST", body: JSON.stringify({}) }));
            if (res) { setPlan(res); setNotice(t("campaignBuilder.abDupNotice")); }
          }}>{t("campaignBuilder.abDuplicateBtn")}</button>
          <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("pf", () => apiFetch<{ checkedAds: number; findings: { adName: string; field: string; severity: string; snippet: string; explanation: string; suggestion: string }[]; summary: { high: number; medium: number; low: number }; platformChecks?: { key: string; subject: string; status: string; label: string; detail: string }[] }>(`/organizations/${orgId}/campaign-plans/${plan.id}/preflight`, { method: "POST" }));
            if (res) {
              setPreflight(res);
              const platformError = res.platformChecks?.find((c) => c.status === "error");
              setNotice(platformError ? t("campaignBuilder.abPlatformError", { detail: platformError.detail }) : res.findings.length === 0 ? t("campaignBuilder.abPolicyClean", { count: fmtNumBn(res.checkedAds) }) : t("campaignBuilder.abPolicySummary", { high: fmtNumBn(res.summary.high), medium: fmtNumBn(res.summary.medium), low: fmtNumBn(res.summary.low) }));
            }
          }}>{t("campaignBuilder.abPolicyBtn")}</button>
          <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("ready", () => apiFetch<NonNullable<typeof readiness>>(`/organizations/${orgId}/campaign-plans/${plan.id}/readiness`, { method: "POST", body: JSON.stringify({}) }));
            if (res) { setReadiness(res); setNotice(res.ready ? t("campaignBuilder.abReadinessOk") : t("campaignBuilder.abReadinessIssues")); }
          }}>{t("campaignBuilder.abReadinessBtn")}</button>
          <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("chealth", () => apiFetch<NonNullable<typeof creativeHealth>>(`/organizations/${orgId}/campaign-plans/${plan.id}/creative-health`, { method: "POST", body: JSON.stringify({}) }));
            if (res) { setCreativeHealth(res); setNotice(res.findings.length === 0 ? t("campaignBuilder.abCreativeHealthClean", { count: fmtNumBn(res.adsChecked) }) : t("campaignBuilder.abCreativeHealthWarnings", { count: fmtNumBn(res.findings.length) })); }
          }}>{t("campaignBuilder.abCreativeHealthBtn")}</button>
          {editable ? (
            <span className="flex items-center gap-1">
              <select className="input w-32" id="plan-bmode" defaultValue={plan.budgetMode ?? "abo"}>
                <option value="abo">ABO</option><option value="cbo">CBO</option>
              </select>
              <input className="input w-28" placeholder={t("campaignBuilder.abCampaignDailyPlaceholder")} id="plan-cdaily" defaultValue={plan.campaignDailyBudgetMinor ? String(Number(plan.campaignDailyBudgetMinor) / 100) : ""} />
              <input className="input w-28" placeholder={t("campaignBuilder.abCampaignLifetimePlaceholder")} id="plan-clife" defaultValue={plan.campaignLifetimeBudgetMinor ? String(Number(plan.campaignLifetimeBudgetMinor) / 100) : ""} />
              <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                const mode = (document.getElementById("plan-bmode") as HTMLSelectElement)?.value ?? "abo";
                const d = (document.getElementById("plan-cdaily") as HTMLInputElement)?.value ?? "";
                const l = (document.getElementById("plan-clife") as HTMLInputElement)?.value ?? "";
                const res = await wrap("bmode", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}`, { method: "PATCH", body: JSON.stringify({ budgetMode: mode, campaignDailyBudget: d, campaignLifetimeBudget: l }) }));
                if (res) { setPlan(res); setNotice(t("campaignBuilder.budgetModeSaved")); noteSaved(); }
              }}>{t("campaignBuilder.abBudgetModeBtn")}</button>
            </span>
          ) : null}
          {editable ? (
            <span className="flex items-center gap-1">
              <input className="input w-28" placeholder={t("campaignBuilder.abDailyCapPlaceholder")} id="plan-cap" defaultValue={(plan as any).dailyBudgetCapMinor ? String(Number((plan as any).dailyBudgetCapMinor) / 100) : ""} />
              <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                const v = (document.getElementById("plan-cap") as HTMLInputElement)?.value ?? "";
                const res = await wrap("cap", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}`, { method: "PATCH", body: JSON.stringify({ dailyBudgetCap: v }) }));
                if (res) { setPlan(res); setNotice(v ? t("campaignBuilder.capSet") : t("campaignBuilder.capRemoved")); noteSaved(); }
              }}>{t("campaignBuilder.abCapBtn")}</button>
            </span>
          ) : null}
          <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("ab", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/ab-variant`, { method: "POST", body: JSON.stringify({}) }));
            if (res) { setPlan(res); setNotice(t("campaignBuilder.abVariantNotice")); }
          }}>{t("campaignBuilder.abVariantBtn")}</button>
          <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("tpl", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/duplicate`, { method: "POST", body: JSON.stringify({ asTemplate: true }) }));
            if (res) setNotice(t("campaignBuilder.abTemplateSaved", { name: res.name }));
          }}>{t("campaignBuilder.abTemplateBtn")}</button>
          {!plan.externalCampaignId ? <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("adv", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/advantage-plus`, { method: "POST", body: JSON.stringify({ enabled: !plan.advantagePlus }) }));
            if (res) { setPlan(res); setNotice(res.advantagePlus ? t("campaignBuilder.abAdvOn") : t("campaignBuilder.abAdvOff")); }
          }}>{plan.advantagePlus ? t("campaignBuilder.abAdvBtnOn") : t("campaignBuilder.abAdvBtnOff")}</button> : null}
          {plan.advantagePlus ? <p className="w-full text-xs text-slate-600">🤖 <b>{t("campaignBuilder.abAdvNoteTitle")}</b>{t("campaignBuilder.abAdvNoteBody")}{plan.advantageState ? <>{t("campaignBuilder.abAdvStatePrefix")}<b>{plan.advantageState}</b>{plan.advantageState === "DISABLED" ? t("campaignBuilder.abAdvStateDisabled") : t("campaignBuilder.abAdvStateConfirmed")}</> : t("campaignBuilder.abAdvStatePending")}</p> : null}
          {editable ? <button className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => action("submit", "submit")}>{t("campaignBuilder.abSubmitBtn")}</button> : null}
          {plan.status === "pending_approval" ? <>
            <button className="btn-success btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => action("approve", "approve")}>{t("campaignBuilder.abApproveBtn")}</button>
            <button className="rounded-lg border px-3 py-2 text-sm font-semibold text-red-600" onClick={rejectPlan}>{t("campaignBuilder.abRejectBtn")}</button>
          </> : null}
          {(plan.status === "approved" || plan.status === "publish_failed") ? <button className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => action("publish", "publish")}>{busy === "publish" ? t("campaignBuilder.abPublishing") : plan.status === "publish_failed" ? t("campaignBuilder.abPublishResume") : t("campaignBuilder.abPublishBtn")}</button> : null}
          {plan.status === "approved" ? (
            <span className="flex items-center gap-1">
              <input type="datetime-local" className="input w-52" id="launch-at" defaultValue={plan.publishAt ? String(plan.publishAt).slice(0, 16) : ""} />
              <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                const v = (document.getElementById("launch-at") as HTMLInputElement)?.value;
                if (!v) { setError(t("campaignBuilder.abErrLaunchTime")); return; }
                const res = await wrap("launch", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/schedule-launch`, { method: "POST", body: JSON.stringify({ publishAt: new Date(v).toISOString() }) }));
                if (res) { setPlan(res); setNotice(t("campaignBuilder.abLaunchScheduled")); }
              }}>{t("campaignBuilder.abLaunchBtn")}</button>
              {plan.publishAt ? <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                const res = await wrap("launch-cancel", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/schedule-launch`, { method: "POST", body: JSON.stringify({ publishAt: null }) }));
                if (res) { setPlan(res); setNotice(t("campaignBuilder.abLaunchCancelled")); }
              }}>{t("campaignBuilder.abCancelBtn")}</button> : null}
            </span>
          ) : null}
          {plan.status === "published" ? (
            <span className="flex items-center gap-1">
              <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                if (!scheduleOpen) {
                  const res = await wrap("sched-load", () => apiFetch<NonNullable<typeof schedule>>(`/organizations/${orgId}/campaign-plans/${plan.id}/schedule`));
                  if (res) setSchedule(res);
                }
                setScheduleOpen((o) => !o);
              }}>{t("campaignBuilder.abPauseWindowBtn")}{plan.pauseAt ? t("campaignBuilder.abPauseWindowSet") : ""}</button>
            </span>
          ) : null}
          <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            if (!namingOpen) {
              setNamingResult(null);
              const res = await wrap("naming-preview", () => apiFetch<NonNullable<typeof namingPreview>>(`/organizations/${orgId}/campaign-plans/${plan.id}/naming/preview`, { method: "POST", body: JSON.stringify({}) }));
              if (res) setNamingPreview(res);
            }
            setNamingOpen((o) => !o);
          }}>{t("campaignBuilder.abNamingBtn")}</button>
          <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={openSeries}>{t("campaignBuilder.abSeriesBtn")}</button>
          {plan.abGroupId ? <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("promote", () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/promote-winner`, { method: "POST", body: JSON.stringify({}) }));
            if (res) { setPlan(res); setNotice(t("campaignBuilder.abWinnerNotice")); }
          }}>{t("campaignBuilder.abWinnerBtn")}</button> : null}
          {plan.externalCampaignId ? <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("perf", () => apiFetch<NonNullable<typeof perf>>(`/organizations/${orgId}/campaign-plans/${plan.id}/performance`));
            if (res) setPerf(res);
          }}>{t("campaignBuilder.abPerfBtn")}</button> : null}
          {plan.externalCampaignId ? <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("waconv", () => apiFetch<NonNullable<typeof waConvs>>(`/organizations/${orgId}/campaign-plans/${plan.id}/whatsapp-conversations`));
            if (res) setWaConvs(res);
          }}>{t("campaignBuilder.abWaBtn")}</button> : null}
          {plan.abGroupId ? <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={openExperiments}>{t("campaignBuilder.abExperimentBtn")}</button> : null}
          {plan.externalCampaignId ? <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("pacing", () => apiFetch<NonNullable<typeof pacing>>(`/organizations/${orgId}/campaign-plans/${plan.id}/pacing`));
            if (res) setPacing(res);
            const al = await apiFetch<NonNullable<typeof pacingAlerts>>(`/organizations/${orgId}/campaign-plans/${plan.id}/pacing-alerts`).catch(() => null);
            if (al) setPacingAlerts(al);
          }}>{t("campaignBuilder.abPacingBtn")}</button> : null}
          {plan.externalCampaignId ? <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const b = await wrap("bdowns", () => apiFetch<NonNullable<typeof breakdowns>>(`/organizations/${orgId}/campaign-plans/${plan.id}/performance-breakdowns`));
            if (b) setBreakdowns(b);
            const c = await wrap("cinsights", () => apiFetch<NonNullable<typeof creativeInsights>>(`/organizations/${orgId}/campaign-plans/${plan.id}/creative-insights`));
            if (c) setCreativeInsights(c);
            const rp = await wrap("regionperf", () => apiFetch<RegionPerf>(`/organizations/${orgId}/campaign-plans/${plan.id}/region-performance`));
            if (rp) setRegionPerf(rp);
          }}>{t("campaignBuilder.abBreakdownBtn")}</button> : null}
          {plan.externalCampaignId ? <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("recs", () => apiFetch<NonNullable<typeof recs>>(`/organizations/${orgId}/campaign-plans/${plan.id}/recommendations`));
            if (res) setRecs(res);
          }}>{t("campaignBuilder.abRecsBtn")}</button> : null}
          <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("guardrails", () => apiFetch<NonNullable<typeof guardrails>>(`/organizations/${orgId}/campaign-plans/${plan.id}/guardrails`));
            if (res) setGuardrails(res);
            const acc = await apiFetch<typeof accountsHealth>(`/organizations/${orgId}/campaign-plans/accounts/health`).catch(() => null);
            if (acc) setAccountsHealth(acc);
          }}>{t("campaignBuilder.abGuardrailsBtn")}</button>
          {plan.status === "published" && plan.metaStatus !== "ACTIVE" ? <button className="btn-success btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => action("activate", "activate")}>{t("campaignBuilder.abActivateBtn")}</button> : null}
          {plan.status === "published" && plan.metaStatus === "ACTIVE" ? <button className="btn-warning btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => action("pause", "pause")}>{t("campaignBuilder.abPauseBtn")}</button> : null}
        </div>
      </div>
      {experiments ? (
        <ExperimentsDrawer
          experiments={experiments}
          expSiblings={expSiblings}
          expForm={expForm}
          setExpForm={setExpForm}
          createExperiment={createExperiment}
          refreshExperiment={refreshExperiment}
          expReadbacks={expReadbacks}
          busy={busy}
          activeStep={activeStep}
        />
      ) : null}
      {seriesList ? (
        <SeriesDrawer
          seriesList={seriesList}
          seriesForm={seriesForm}
          setSeriesForm={setSeriesForm}
          createSeries={createSeries}
          doSeriesAction={doSeriesAction}
          busy={busy}
          activeStep={activeStep}
        />
      ) : null}
      {error ? <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 shadow-sm"><span>⛔</span><span>{error}</span></div> : null}
      {notice ? (
        <div role="status" className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 shadow-sm">
          <div className="flex items-center gap-2">
            <span>✓</span>
            <span>{notice}</span>
          </div>
          <button type="button" onClick={() => setNotice("")} className="text-xs text-emerald-600 hover:text-emerald-800">{t("campaignBuilder.ntCloseBtn")}</button>
        </div>
      ) : null}

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_330px] lg:items-start lg:gap-5">
      <div className="min-w-0 space-y-6">
      <div id="cbx-step-audience" tabIndex={-1} className={`r2-step-enter space-y-6 ${activeStep === 0 || activeStep === 4 ? "hidden" : ""}`}>
      <span id="cbx-step-creative" tabIndex={-1} className="block scroll-mt-24" />
      {plan.adSets.map((adSet) => (
        <div key={adSet.id} className="space-y-3 card p-5">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Ad Set: {adSet.name}</div>
            {editable ? (
              <span className={`flex gap-1 ${activeStep !== 1 && activeStep !== 2 ? "hidden" : ""}`}>
                <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                  const opening = editSetId !== adSet.id;
                  setEditSetId(opening ? adSet.id : null);
                  if (opening && adSet.catalogRecordId) {
                    const r = await apiFetch<ProductSetRec[]>(`/organizations/${orgId}/catalogs/${adSet.catalogRecordId}/product-sets`).catch(() => null);
                    if (r) setEditSets(r);
                  }
                }}>{t("campaignBuilder.asEditBtn")}</button>
                <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                  const res = await wrap(`dupset-${adSet.id}`, () => apiFetch(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets/${adSet.id}/duplicate`, { method: "POST", body: JSON.stringify({}) }));
                  if (res) { setNotice(t("campaignBuilder.asDupNotice")); await loadPlan(plan.id); }
                }}>{t("campaignBuilder.asCopyBtn")}</button>
              </span>
            ) : null}
            {plan.status === "published" && adSet.externalAdSetId ? (
              <span className={`flex items-center gap-1 ${activeStep !== 2 ? "hidden" : ""}`}>
                <input className="input w-28" placeholder={t("campaignBuilder.asNewBudgetPlaceholder")} id={`budget-${adSet.id}`} />
                <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                  const v = (document.getElementById(`budget-${adSet.id}`) as HTMLInputElement)?.value;
                  if (!v) { setError(t("campaignBuilder.asErrBudget")); return; }
                  const res = await wrap(`budget-${adSet.id}`, () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets/${adSet.id}/budget`, { method: "POST", body: JSON.stringify({ dailyBudget: v }) }));
                  if (res) { setPlan(res); setNotice(t("campaignBuilder.budgetUpdatedMeta")); noteSaved(); }
                }}>{t("campaignBuilder.asBudgetUpdateBtn")}</button>
              </span>
            ) : null}
            <div className="text-xs text-slate-400">
              {adSet.dailyBudgetMinor ? t("campaignBuilder.asDailyBudgetPart", { amount: fmtMoneyBn(adSet.dailyBudgetMinor) }) : ""} · {adSet.optimizationGoal} · {t("campaignBuilder.asCountryPart", { countries: (adSet.targeting.countries ?? []).join(", ") })}
              {adSet.targeting.cities?.length ? t("campaignBuilder.asCitiesPart", { cities: adSet.targeting.cities.map((c) => c.key).join(", ") }) : ""}
              {adSet.targeting.locales?.length ? ` · Locale: ${adSet.targeting.locales.join(",")}` : ""}
              {adSet.bidStrategy ? ` · 🎯 ${adSet.bidStrategy}${adSet.bidAmountMinor ? ` ${fmtMoneyBn(adSet.bidAmountMinor)}` : ""}${adSet.costGoalMinor ? ` ${fmtMoneyBn(adSet.costGoalMinor)}` : ""}${adSet.roasAverageFloor ? ` ROAS ≥ ${adSet.roasAverageFloor / 10000}` : ""}` : ""}
              {adSet.conversionEvent ? ` · 🎯 Event: ${adSet.conversionEvent}` : ""}
              {adSet.__productSet ? ` · 🛍️ Catalog: ${adSet.__catalog?.name ?? ""} / ${adSet.__productSet.name}` : ""}
              {adSet.__leadForm ? ` · 📋 Form: ${adSet.__leadForm.name} (${adSet.__leadForm.status === "created" ? t("campaignBuilder.asFormCreated") : t("campaignBuilder.asFormLocal")})` : ""}
              {adSet.destinationType === "WHATSAPP" ? ` · 💬 WhatsApp (CTWA): ${adSet.whatsappPhoneNumber ?? t("campaignBuilder.asWaNumberFallback")}` : ""}
              {adSet.externalAdSetId ? ` · Meta ID: ${adSet.externalAdSetId}` : ""}
              {adSet.effectiveStatus ? t("campaignBuilder.asEffectivePart", { status: adSet.effectiveStatus }) : ""}
              {adSet.startTime || adSet.endTime ? ` · 🗓 ${adSet.startTime ? fmtDateTime(locale, adSet.startTime) : "…"} → ${adSet.endTime ? fmtDateTime(locale, adSet.endTime) : "…"}` : ""}
            </div>
            {plan.status === "published" && adSet.externalAdSetId ? (
              <span className={`flex items-center gap-1 ${activeStep !== 1 ? "hidden" : ""}`}>
                <input type="datetime-local" className="input w-48" id={`sched-start-${adSet.id}`} defaultValue={adSet.startTime ? String(adSet.startTime).slice(0, 16) : ""} />
                <input type="datetime-local" className="input w-48" id={`sched-end-${adSet.id}`} defaultValue={adSet.endTime ? String(adSet.endTime).slice(0, 16) : ""} />
                <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                  const st = (document.getElementById(`sched-start-${adSet.id}`) as HTMLInputElement)?.value;
                  const en = (document.getElementById(`sched-end-${adSet.id}`) as HTMLInputElement)?.value;
                  if (!st && !en) { setError(t("campaignBuilder.asErrSchedule")); return; }
                  const res = await wrap(`sched-${adSet.id}`, () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets/${adSet.id}/schedule`, { method: "POST", body: JSON.stringify({ startTime: st ? new Date(st).toISOString() : undefined, endTime: en ? new Date(en).toISOString() : undefined }) }));
                  if (res) { setPlan(res); setNotice(t("campaignBuilder.scheduleUpdated")); noteSaved(); }
                }}>{t("campaignBuilder.asScheduleBtn")}</button>
              </span>
            ) : null}
            {plan.status === "published" && adSet.externalAdSetId ? (
              <span className={`flex items-center gap-1 ${activeStep !== 1 ? "hidden" : ""}`}>
                <textarea className="input w-64" rows={1} id={`daypart-${adSet.id}`} placeholder={t("campaignBuilder.asDaypartPlaceholder")} defaultValue={Array.isArray((adSet as any).daypart) ? (adSet as any).daypart.map((w: any) => `${w.day},${w.startHour},${w.endHour}`).join("\n") : ""} />
                <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                  const raw = (document.getElementById(`daypart-${adSet.id}`) as HTMLTextAreaElement)?.value ?? "";
                  const windows = raw.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [day, startHour, endHour] = l.split(",").map((x) => Number(x.trim())); return { day, startHour, endHour }; });
                  const res = await wrap(`dp-${adSet.id}`, () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets/${adSet.id}/daypart`, { method: "POST", body: JSON.stringify({ windows, tz: "Asia/Dhaka" }) }));
                  if (res) { setPlan(res); setNotice(t("campaignBuilder.daypartSaved")); noteSaved(); }
                }}>{t("campaignBuilder.asDaypartBtn")}</button>
              </span>
            ) : null}
          </div>
          {(adSet as any).funnelLayer ? <div><span className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700">🧭 {(adSet as any).funnelLayer} Layer</span></div> : null}
          {(adSet as any).funnelIncomplete ? <p className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">{t("campaignBuilder.asIncompleteLayer", { detail: (adSet as any).funnelIncomplete })}</p> : null}
          {editable && editSetId === adSet.id ? (
            <div className={`space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 ${activeStep !== 1 && activeStep !== 2 ? "hidden" : ""}`}>
              <div className="text-sm font-semibold">{t("campaignBuilder.asEditTitle")}</div>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <label className="block text-sm">{t("campaignBuilder.asNameLabel")}<input className="input" id={`es-name-${adSet.id}`} defaultValue={adSet.name} /></label>
                <label className="block text-sm">{t("campaignBuilder.asDailyBudgetLabel")}<input className="input" id={`es-budget-${adSet.id}`} defaultValue={adSet.dailyBudgetMinor ? String(Number(adSet.dailyBudgetMinor) / 100) : ""} placeholder={t("campaignBuilder.asDailyBudgetPlaceholder")} /></label>
                <label className="block text-sm">{t("campaignBuilder.asLifetimeLabel")}<input className="input" id={`es-life-${adSet.id}`} defaultValue={adSet.lifetimeBudgetMinor ? String(Number(adSet.lifetimeBudgetMinor) / 100) : ""} placeholder={t("campaignBuilder.asLifetimePlaceholder")} /></label>
                <label className="block text-sm">{t("campaignBuilder.asCountriesLabel")}<input className="input" id={`es-countries-${adSet.id}`} defaultValue={(adSet.targeting.countries ?? []).join(",")} /></label>
                <label className="block text-sm">{t("campaignBuilder.asInterestsLabel")}<input className="input" id={`es-interests-${adSet.id}`} defaultValue={(adSet.targeting.interests ?? []).map(entryToken).join(", ")} /></label>
                <label className="block text-sm">{t("campaignBuilder.asPlatformsLabel")}<input className="input" id={`es-platforms-${adSet.id}`} defaultValue={(adSet.targeting.platforms ?? []).join(",")} placeholder={t("campaignBuilder.asMetaDefaultPlaceholder")} /></label>
                <label className="block text-sm">{t("campaignBuilder.asPositionsLabel")}<input className="input" id={`es-positions-${adSet.id}`} defaultValue={(adSet.targeting.positions ?? []).join(",")} placeholder={t("campaignBuilder.asMetaDefaultPlaceholder")} /></label>
                <label className="block text-sm">{t("campaignBuilder.asDevicesLabel")}<input className="input" id={`es-devices-${adSet.id}`} defaultValue={(adSet.targeting.devices ?? []).join(",")} placeholder={t("campaignBuilder.asAllPlaceholder")} /></label>
                <label className="block text-sm">{t("campaignBuilder.asCitiesLabel")}<input className="input" id={`es-cities-${adSet.id}`} defaultValue={(adSet.targeting.cities ?? []).map((c) => (c.radius ? `${c.key}:${c.radius}` : c.key)).join(",")} /></label>
                <label className="block text-sm">{t("campaignBuilder.asPostcodesLabel")}<input className="input" id={`es-postcodes-${adSet.id}`} defaultValue={(adSet.targeting.postcodes ?? []).join(",")} /></label>
                <label className="block text-sm">{t("campaignBuilder.asLocationTypesLabel")}<input className="input" id={`es-loctypes-${adSet.id}`} defaultValue={(adSet.targeting.locationTypes ?? []).join(",")} placeholder="home,recent" /></label>
                <label className="block text-sm">{t("campaignBuilder.asLocaleIdsLabel")}<input className="input" id={`es-locales-${adSet.id}`} defaultValue={(adSet.targeting.locales ?? []).join(",")} /></label>
                <label className="block text-sm">{t("campaignBuilder.asBehaviorsLabel")}<input className="input" id={`es-behaviors-${adSet.id}`} defaultValue={(adSet.targeting.behaviors ?? []).map(entryToken).join(", ")} /></label>
                <label className="block text-sm">{t("campaignBuilder.asNarrowLabel")}<input className="input" id={`es-narrow-${adSet.id}`} defaultValue={(adSet.targeting.narrowInterests ?? []).map(entryToken).join(", ")} /></label>
                <label className="block text-sm">{t("campaignBuilder.asLifeEventsLabel")}<input className="input" id={`es-life-${adSet.id}`} defaultValue={(adSet.targeting.demographics?.lifeEvents ?? []).map(entryToken).join(", ")} /></label>
                <label className="block text-sm">{t("campaignBuilder.asWorkLabel")}<input className="input" id={`es-work-${adSet.id}`} defaultValue={(adSet.targeting.demographics?.workPositions ?? []).map(entryToken).join(", ")} /></label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" id={`es-expansion-${adSet.id}`} defaultChecked={adSet.targeting.targetingExpansion === true} /> Targeting Expansion</label>
                <label className="block text-sm">Bid Strategy
                  <select className="input" id={`es-bidstrategy-${adSet.id}`} defaultValue={adSet.bidStrategy ?? ""}>
                    <option value="">Lowest Cost</option><option value="bid_cap">Bid Cap</option><option value="cost_cap">Cost Per Result Goal</option><option value="roas_goal">ROAS Goal</option>
                  </select>
                </label>
                <label className="block text-sm">{t("campaignBuilder.asBidAmountLabel")}<input className="input" id={`es-bidamount-${adSet.id}`} defaultValue={adSet.bidAmountMinor ? String(Number(adSet.bidAmountMinor) / 100) : ""} /></label>
                <label className="block text-sm">{t("campaignBuilder.asCostGoalLabel")}<input className="input" id={`es-costgoal-${adSet.id}`} defaultValue={adSet.costGoalMinor ? String(Number(adSet.costGoalMinor) / 100) : ""} /></label>
                <label className="block text-sm">{t("campaignBuilder.asRoasGoalLabel")}<input className="input" id={`es-roasgoal-${adSet.id}`} defaultValue={adSet.roasAverageFloor ? String(adSet.roasAverageFloor / 10000) : ""} /></label>
                <label className="block text-sm">{t("campaignBuilder.asConversionEventLabel")}
                  <select className="input" id={`es-event-${adSet.id}`} defaultValue={adSet.conversionEvent ?? ""}>
                    <option value="">PURCHASE (Default)</option>
                    {[...new Set([...SALES_EVENTS, ...LEAD_EVENTS])].map((ev) => <option key={ev} value={ev}>{ev}</option>)}
                  </select>
                </label>
                <label className="block text-sm">{t("campaignBuilder.asCatalogLabel")}
                  <select className="input" id={`es-catalog-${adSet.id}`} defaultValue={adSet.catalogRecordId ?? ""} onChange={async (e) => {
                    const cat = e.target.value;
                    if (!cat) { setEditSets([]); return; }
                    const r = await apiFetch<ProductSetRec[]>(`/organizations/${orgId}/catalogs/${cat}/product-sets`).catch(() => null);
                    if (r) setEditSets(r);
                  }}>
                    <option value="">{t("campaignBuilder.asCatalogNone")}</option>
                    {catalogs.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.platform})</option>)}
                  </select>
                </label>
                <label className="block text-sm">{t("campaignBuilder.asProductSetLabel")}
                  <select className="input" id={`es-pset-${adSet.id}`} defaultValue={adSet.productSetId ?? ""}>
                    <option value="">{t("campaignBuilder.asProductSetChoose")}</option>
                    {editSets.length === 0 && adSet.__productSet ? <option value={adSet.__productSet.id}>{t("campaignBuilder.asProductSetCurrent", { name: adSet.__productSet.name })}</option> : null}
                    {editSets.map((s) => <option key={s.id} value={s.id} disabled={s.status !== "created"}>{s.name} · {fmtNumBn(s.itemCount)}{t("campaignBuilder.asItemsSuffix")}{s.status === "created" ? "" : ` (${s.status})`}</option>)}
                  </select>
                </label>
                <label className="block text-sm">{t("campaignBuilder.asLeadFormLabel")}
                  <select className="input" id={`es-leadform-${adSet.id}`} defaultValue={adSet.leadFormId ?? ""}>
                    <option value="">{t("campaignBuilder.asLeadFormNone")}</option>
                    {leadForms.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.status === "created" ? t("campaignBuilder.asFormCreated") : t("campaignBuilder.asFormLocal")})</option>)}
                  </select>
                </label>
                <label className="block text-sm">{t("campaignBuilder.asDestinationLabel")}
                  <select className="input" id={`es-dest-${adSet.id}`} defaultValue={adSet.destinationType ?? ""}>
                    <option value="">{t("campaignBuilder.asWebsiteOption")}</option>
                    <option value="WHATSAPP">{t("campaignBuilder.asWaOption")}</option>
                  </select>
                </label>
                <label className="block text-sm">{t("campaignBuilder.asWaConnectionLabel")}
                  <select className="input" id={`es-wa-${adSet.id}`} defaultValue={adSet.whatsappIntegrationId ?? ""}>
                    <option value="">{t("campaignBuilder.asConnectionChoose")}</option>
                    {(waDestinations?.destinations ?? []).map((d) => (
                      <option key={d.integrationId} value={d.integrationId} disabled={!d.connected && d.integrationId !== adSet.whatsappIntegrationId}>
                        {d.phoneNumberId ?? t("campaignBuilder.asNoPhoneId")} · WABA {d.wabaId ?? "—"}{d.connected ? "" : ` · ${d.status}`}
                      </option>
                    ))}
                  </select>
                  {adSet.destinationType === "WHATSAPP" && adSet.whatsappPhoneNumber ? <span className="mt-0.5 block text-xs text-slate-500">{t("campaignBuilder.asWaCurrentNumber", { number: adSet.whatsappPhoneNumber })}</span> : null}
                </label>
              </div>
              <p className="text-xs text-slate-500">{t("campaignBuilder.asBudgetNote")}</p>
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
                  if (res) { setEditSetId(null); setNotice(t("campaignBuilder.asUpdatedNotice")); noteSaved(); await loadPlan(plan.id); }
                }}>{t("campaignBuilder.asSaveBtn")}</button>
                <button className="btn-secondary btn-sm" onClick={() => setEditSetId(null)}>{t("campaignBuilder.asCancelBtn")}</button>
              </div>
            </div>
          ) : null}
          <div className={`space-y-2 ${activeStep !== 3 ? "hidden" : ""}`}>
            {adSet.ads.map((ad) => (
              <div key={ad.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                <div className="font-medium">{ad.name} {(ad as any).format && (ad as any).format !== "link" ? <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">{(ad as any).format}</span> : null} {ad.createdByAi ? <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700">AI Draft</span> : null} {ad.externalAdId ? <span className="text-xs text-slate-400">Meta ID: {ad.externalAdId}</span> : null} {ad.effectiveStatus ? <span className={ad.effectiveStatus === "ACTIVE" ? "rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-semibold text-green-700" : ad.effectiveStatus === "PAUSED" ? "rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600" : "rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700"}>{ad.effectiveStatus}</span> : null}</div>
                <p className="mt-0.5 whitespace-pre-wrap">{ad.primaryText}</p>
                {ad.headline ? <div className="text-slate-500">Headline: {ad.headline}</div> : null}
                <a className="text-xs text-blue-600" href={ad.linkUrl} target="_blank" rel="noreferrer">{ad.linkUrl}</a>
                {ad.textOptions && (ad.textOptions.primaryTexts.length > 1 || ad.textOptions.headlines.length > 1 || ad.textOptions.descriptions.length > 0) ? <div className="mt-0.5 text-xs text-indigo-600">{t("campaignBuilder.adTextOptionsLine", { texts: fmtNumBn(ad.textOptions.primaryTexts.length), headlines: fmtNumBn(ad.textOptions.headlines.length), descriptions: fmtNumBn(ad.textOptions.descriptions.length) })}</div> : null}
                {ad.textOptions?.locales && Object.keys(ad.textOptions.locales).length ? <div className="mt-0.5 text-xs text-teal-700">{t("campaignBuilder.adLocalesLine", { locales: Object.keys(ad.textOptions.locales).map((l) => (l === "en" ? "English" : t("campaignBuilder.adLangBn"))).join(", ") })}</div> : null}
                {ad.placementAssets?.placements?.feed || ad.placementAssets?.placements?.vertical ? <div className="text-xs text-indigo-600">🖼️ Placement Asset: {ad.placementAssets.placements.feed ? "Feed Override" : ""}{ad.placementAssets.placements.feed && ad.placementAssets.placements.vertical ? " · " : ""}{ad.placementAssets.placements.vertical ? "Stories/Reels Override" : ""}</div> : null}
                {ad.creativeEnhancements && Object.entries(ad.creativeEnhancements).some(([, v]) => v) ? <div className="text-xs text-indigo-600">✨ Enhancements ON: {Object.entries(ad.creativeEnhancements).filter(([, v]) => v).map(([k]) => k).join(", ")}</div> : null}
                {ad.whatsappWelcome?.greetingText || ad.whatsappWelcome?.prefillMessage || ad.whatsappWelcome?.iceBreakers?.length ? <div className="text-xs text-emerald-700">{t("campaignBuilder.adWaWelcome")}{ad.whatsappWelcome?.greetingText ? `“${ad.whatsappWelcome.greetingText}”` : ""}{ad.whatsappWelcome?.iceBreakers?.length ? t("campaignBuilder.adIceBreakerPart", { count: fmtNumBn(ad.whatsappWelcome.iceBreakers.length) }) : ad.whatsappWelcome?.prefillMessage ? t("campaignBuilder.adPrefillPart", { text: ad.whatsappWelcome.prefillMessage }) : ""}</div> : null}
                <div className="mt-1">
                  <button className="rounded border bg-white px-2 py-0.5 text-xs" onClick={() => setPreviewAdId(previewAdId === ad.id ? null : ad.id)}>👁 Preview</button>
                </div>
                {previewAdId === ad.id ? <AdPreview ad={ad} pageName={plan.name} /> : null}
                {editable ? (
                  <div className="mt-1 flex gap-1">
                    <button className="rounded border bg-white px-2 py-0.5 text-xs" disabled={busy !== ""} onClick={() => setEditAdId(editAdId === ad.id ? null : ad.id)}>{t("campaignBuilder.adEditBtn")}</button>
                    <button className="rounded border bg-white px-2 py-0.5 text-xs" disabled={busy !== ""} onClick={async () => {
                      const res = await wrap(`dupad-${ad.id}`, () => apiFetch(`/organizations/${orgId}/campaign-plans/${plan.id}/ads/${ad.id}/duplicate`, { method: "POST", body: JSON.stringify({}) }));
                      if (res) { setNotice(t("campaignBuilder.adDupNotice")); await loadPlan(plan.id); }
                    }}>{t("campaignBuilder.adCopyBtn")}</button>
                    <button className="rounded border bg-white px-2 py-0.5 text-xs" disabled={busy !== ""} onClick={async () => {
                      if (adVersionsOpen === ad.id) { setAdVersionsOpen(null); return; }
                      const res = await wrap(`vers-${ad.id}`, () => apiFetch<{ versions: { id: string; version: number; source: string; createdAt: string }[] }>(`/organizations/${orgId}/campaign-plans/${plan.id}/ads/${ad.id}/versions`));
                      if (res) { setAdVersionList(res.versions ?? []); setAdVersionsOpen(ad.id); setAdDiff(null); }
                    }}>{t("campaignBuilder.adVersionsBtn")}</button>
                    <button className="rounded border bg-white px-2 py-0.5 text-xs" disabled={busy !== ""} onClick={async () => {
                      const res = await wrap(`carousel-${ad.id}`, () => apiFetch<any>(`/organizations/${orgId}/campaign-plans/${plan.id}/ads/${ad.id}/assemble-carousel`, { method: "POST", body: JSON.stringify({}) }));
                      if (res) {
                        if (res.applied) { setNotice(t("campaignBuilder.adCarouselApplied", { count: fmtNumBn(res.cards.length) })); await loadPlan(plan.id); }
                        else { setCarouselPreview({ adId: ad.id, cards: res.previewCards ?? [] }); setNotice(res.reason); }
                      }
                    }}>{t("campaignBuilder.adCarouselBtn")}</button>
                    <button className="rounded border bg-white px-2 py-0.5 text-xs" disabled={busy !== ""} onClick={async () => {
                      const res = await wrap(`landing-${ad.id}`, () => apiFetch<any>(`/organizations/${orgId}/campaign-plans/${plan.id}/landing`, { method: "POST", body: JSON.stringify({ adId: ad.id }) }));
                      if (res) {
                        setLandingOffer({ adId: ad.id, landing: res.landing, url: res.url ?? null, path: res.path, note: res.note, existing: (res.existingForProduct ?? []).map((l: any) => ({ id: l.id, slug: l.slug, status: l.status, url: l.url ?? null, path: l.path })) });
                        setNotice(res.note);
                      }
                    }}>{t("campaignBuilder.adLandingBtn")}</button>
                    <button className="rounded border bg-white px-2 py-0.5 text-xs" disabled={busy !== ""} onClick={async () => {
                      const res = await wrap(`loc-${ad.id}-en`, () => apiFetch(`/organizations/${orgId}/campaign-plans/${plan.id}/ads/${ad.id}/localize`, { method: "POST", body: JSON.stringify({ targetLocale: "en" }) }));
                      if (res) { setNotice(t("campaignBuilder.adLocEnNotice")); await loadPlan(plan.id); }
                    }}>{t("campaignBuilder.adLocEnBtn")}</button>
                    <button className="rounded border bg-white px-2 py-0.5 text-xs" disabled={busy !== ""} onClick={async () => {
                      const res = await wrap(`loc-${ad.id}-bn`, () => apiFetch(`/organizations/${orgId}/campaign-plans/${plan.id}/ads/${ad.id}/localize`, { method: "POST", body: JSON.stringify({ targetLocale: "bn" }) }));
                      if (res) { setNotice(t("campaignBuilder.adLocBnNotice")); await loadPlan(plan.id); }
                    }}>{t("campaignBuilder.adLocBnBtn")}</button>
                    <button className="rounded border bg-white px-2 py-0.5 text-xs" onClick={() => setVariantAdId(variantAdId === ad.id ? null : ad.id)}>{t("campaignBuilder.adVariantBtn")}</button>
                  </div>
                ) : null}
                {editable && variantAdId === ad.id ? (
                  <div className="mt-2 space-y-2 rounded-lg border border-teal-200 bg-white p-3">
                    <div className="text-xs font-semibold text-teal-700">{t("campaignBuilder.adVariantTitle")}</div>
                    <div className="flex flex-wrap gap-2">
                      <select className="input flex-1" id={`va-lib-${ad.id}`}>
                        <option value="">{t("campaignBuilder.adVariantLibChoose")}</option>
                        {sortPicker(assets.filter((x) => x.status === "ready" && x.adAccountId === plan.adAccountId)).map((x) => <option key={x.id} value={x.id}>{assetOptLabel(x)} ({x.kind})</option>)}
                      </select>
                      <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                        const assetId = (document.getElementById(`va-lib-${ad.id}`) as HTMLSelectElement)?.value ?? "";
                        if (!assetId) { setError(t("campaignBuilder.adErrLibAsset")); return; }
                        const res = await wrap(`variant-${ad.id}`, () => apiFetch(`/organizations/${orgId}/campaign-plans/${plan.id}/ads/${ad.id}/variant`, { method: "POST", body: JSON.stringify({ creativeAssetId: assetId }) }));
                        if (res) { setVariantAdId(null); setNotice(t("campaignBuilder.adVariantCreated")); await loadPlan(plan.id); }
                      }}>{t("campaignBuilder.adVariantCreateBtn")}</button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <select className="input flex-1" id={`va-media-${ad.id}`}>
                        <option value="">{t("campaignBuilder.adVariantMediaChoose")}</option>
                        {sortPicker(mediaAssets.filter((m) => m.kind === "image"), "media").map((m) => <option key={m.id} value={m.id}>{assetOptLabel(m, "media")}</option>)}
                      </select>
                      <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                        const assetId = (document.getElementById(`va-media-${ad.id}`) as HTMLSelectElement)?.value ?? "";
                        if (!assetId) { setError(t("campaignBuilder.adErrMediaAsset")); return; }
                        const res = await wrap(`variant-${ad.id}`, () => apiFetch(`/organizations/${orgId}/campaign-plans/${plan.id}/ads/${ad.id}/variant`, { method: "POST", body: JSON.stringify({ mediaAssetId: assetId }) }));
                        if (res) { setVariantAdId(null); setNotice(t("campaignBuilder.adVariantCreated")); await loadPlan(plan.id); }
                      }}>{t("campaignBuilder.adVariantCreateBtn")}</button>
                    </div>
                    <p className="text-[11px] text-slate-500">{t("campaignBuilder.adVariantVideoNote")}</p>
                  </div>
                ) : null}
                {editable && adVersionsOpen === ad.id ? (
                  <div className="mt-2 space-y-2 rounded-lg border border-violet-200 bg-white p-3">
                    <div className="text-xs font-semibold text-violet-700">{t("campaignBuilder.adVersionsTitle")}</div>
                    {adVersionList.length === 0 ? <p className="text-xs text-slate-500">{t("campaignBuilder.adVersionsNone")}</p> : adVersionList.map((v) => (
                      <div key={v.id} className="flex flex-wrap items-center gap-2 rounded bg-violet-50 p-2 text-xs">
                        <b>{t("campaignBuilder.adVersionLabel", { version: fmtNumBn(v.version) })}</b>
                        <span className="text-slate-500">{v.source === "restore" ? t("campaignBuilder.adVersionRestoreSource") : t("campaignBuilder.adVersionEditSource")} · {fmtDateTime(locale, v.createdAt)}</span>
                        <button className="rounded border bg-white px-2 py-0.5" disabled={busy !== ""} onClick={async () => {
                          const res = await wrap(`diff-${v.id}`, () => apiFetch<{ changes: { field: string; versionValue: unknown; currentValue: unknown }[]; identical: boolean }>(`/organizations/${orgId}/campaign-plans/${plan.id}/ads/${ad.id}/versions/${v.id}/diff`));
                          if (res) setAdDiff({ adId: ad.id, version: v.version, changes: res.changes, identical: res.identical });
                        }}>{t("campaignBuilder.adDiffBtn")}</button>
                        <button className="rounded border bg-white px-2 py-0.5" disabled={busy !== ""} onClick={async () => {
                          if (!window.confirm(t("campaignBuilder.adRestoreConfirm", { version: fmtNumBn(v.version) }))) return;
                          const res = await wrap(`restore-${v.id}`, () => apiFetch(`/organizations/${orgId}/campaign-plans/${plan.id}/ads/${ad.id}/versions/${v.id}/restore`, { method: "POST", body: JSON.stringify({}) }));
                          if (res) { setNotice(t("campaignBuilder.adRestoredNotice", { version: fmtNumBn(v.version) })); setAdVersionsOpen(null); await loadPlan(plan.id); }
                        }}>Restore</button>
                      </div>
                    ))}
                    {adDiff && adDiff.adId === ad.id ? (
                      <div className="rounded bg-slate-50 p-2 text-xs">
                        <b>{t("campaignBuilder.adDiffTitle", { version: fmtNumBn(adDiff.version) })}</b>
                        {adDiff.identical ? <p className="text-slate-500">{t("campaignBuilder.adDiffNone")}</p> : adDiff.changes.map((c, i) => (
                          <div key={i} className="mt-1"><span className="font-mono">{c.field}</span>: <span className="text-red-700 line-through">{typeof c.versionValue === "string" ? c.versionValue.slice(0, 80) : JSON.stringify(c.versionValue)?.slice(0, 80) ?? "—"}</span> → <span className="text-green-700">{typeof c.currentValue === "string" ? c.currentValue.slice(0, 80) : JSON.stringify(c.currentValue)?.slice(0, 80) ?? "—"}</span></div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {editable && carouselPreview && carouselPreview.adId === ad.id ? (
                  <div className="mt-2 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs">
                    <div className="font-semibold text-amber-800">{t("campaignBuilder.adCarouselPreviewTitle")}</div>
                    <ul className="list-inside list-disc">{carouselPreview.cards.map((c, i) => <li key={i}>{c.title}</li>)}</ul>
                    <div className="flex gap-2">
                      <button className="rounded border bg-white px-2 py-0.5" disabled={busy !== ""} onClick={async () => {
                        const res = await wrap(`carousel-replace-${ad.id}`, () => apiFetch<any>(`/organizations/${orgId}/campaign-plans/${plan.id}/ads/${ad.id}/assemble-carousel`, { method: "POST", body: JSON.stringify({ replace: true }) }));
                        if (res?.applied) { setCarouselPreview(null); setNotice(t("campaignBuilder.adCarouselReplaced")); await loadPlan(plan.id); }
                      }}>{t("campaignBuilder.adCarouselReplaceBtn")}</button>
                      <button className="rounded border bg-white px-2 py-0.5" onClick={() => setCarouselPreview(null)}>{t("campaignBuilder.adCloseBtn")}</button>
                    </div>
                  </div>
                ) : null}
                {editable && landingOffer && landingOffer.adId === ad.id ? (
                  <div className="mt-2 space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs">
                    <div className="font-semibold text-emerald-800">{t("campaignBuilder.adLandingTitle", { path: landingOffer.path })}<span className="badge badge-slate">{landingOffer.landing.status}</span></div>
                    <p className="text-slate-600">{landingOffer.note}</p>
                    {landingOffer.landing.status === "published" ? (
                      <button className="rounded border bg-white px-2 py-0.5" disabled={busy !== ""} onClick={async () => {
                        if (!window.confirm(t("campaignBuilder.adLandingApplyConfirm", { url: landingOffer.url ?? landingOffer.path }))) return;
                        const res = await wrap(`landing-apply-${ad.id}`, () => apiFetch(`/organizations/${orgId}/campaign-plans/${plan.id}/ads/${ad.id}/apply-landing`, { method: "POST", body: JSON.stringify({ landingId: landingOffer.landing.id }) }));
                        if (res) { setLandingOffer(null); setNotice(t("campaignBuilder.adLandingApplied")); await loadPlan(plan.id); }
                      }}>{t("campaignBuilder.adLandingApplyBtn")}</button>
                    ) : <p className="text-amber-700">{t("campaignBuilder.adLandingDraftNote")}</p>}
                    {landingOffer.existing.filter((l) => l.status === "published").map((l) => (
                      <div key={l.id} className="flex flex-wrap items-center gap-2">
                        <span>{t("campaignBuilder.adLandingPrev", { path: l.path })}</span>
                        <button className="rounded border bg-white px-2 py-0.5" disabled={busy !== ""} onClick={async () => {
                          if (!window.confirm(t("campaignBuilder.adLandingPrevConfirm", { url: l.url ?? l.path }))) return;
                          const res = await wrap(`landing-apply-old-${ad.id}`, () => apiFetch(`/organizations/${orgId}/campaign-plans/${plan.id}/ads/${ad.id}/apply-landing`, { method: "POST", body: JSON.stringify({ landingId: l.id }) }));
                          if (res) { setLandingOffer(null); setNotice(t("campaignBuilder.adLandingPrevApplied")); await loadPlan(plan.id); }
                        }}>{t("campaignBuilder.adLandingPrevBtn")}</button>
                      </div>
                    ))}
                    <button className="rounded border bg-white px-2 py-0.5" onClick={() => setLandingOffer(null)}>{t("campaignBuilder.adCloseBtn")}</button>
                  </div>
                ) : null}
                {editable && editAdId === ad.id ? (
                  <div className="mt-2 space-y-2 rounded-lg border border-indigo-200 bg-white p-3">
                    <input className="input" id={`ea-name-${ad.id}`} defaultValue={ad.name} placeholder={t("campaignBuilder.adNamePlaceholder")} />
                    <textarea className="input" rows={3} id={`ea-text-${ad.id}`} defaultValue={ad.primaryText} placeholder="Primary Text" />
                    <input className="input" id={`ea-headline-${ad.id}`} defaultValue={ad.headline ?? ""} placeholder="Headline" />
                    <input className="input" id={`ea-link-${ad.id}`} defaultValue={ad.linkUrl} placeholder="Link URL" />
                    <div className="space-y-2 rounded-lg bg-indigo-50 p-2">
                      <div className="text-xs font-semibold text-indigo-700">{t("campaignBuilder.adV2Title")}</div>
                      <textarea className="input" rows={3} id={`ea-primaries-${ad.id}`} defaultValue={(ad.textOptions?.primaryTexts ?? [ad.primaryText]).join("\n")} placeholder={t("campaignBuilder.adPrimariesPlaceholder")} />
                      <textarea className="input" rows={2} id={`ea-headlines-${ad.id}`} defaultValue={(ad.textOptions?.headlines ?? (ad.headline ? [ad.headline] : [])).join("\n")} placeholder={t("campaignBuilder.adHeadlinesPlaceholder")} />
                      <textarea className="input" rows={2} id={`ea-descs-${ad.id}`} defaultValue={(ad.textOptions?.descriptions ?? (ad.description ? [ad.description] : [])).join("\n")} placeholder={t("campaignBuilder.adDescsPlaceholder")} />
                      <div className="flex flex-wrap gap-2">
                        <select className="input flex-1" id={`ea-feed-${ad.id}`} defaultValue={ad.placementAssets?.placements?.feed?.imageAssetId ?? ""}>
                          <option value="">{t("campaignBuilder.adFeedNone")}</option>
                          {sortPicker(assets.filter((x) => x.kind === "image" && x.status === "ready" && x.adAccountId === plan.adAccountId)).map((x) => <option key={x.id} value={x.id}>{assetOptLabel(x)}</option>)}
                        </select>
                        <select className="input flex-1" id={`ea-vertical-${ad.id}`} defaultValue={ad.placementAssets?.placements?.vertical?.imageAssetId ?? ""}>
                          <option value="">{t("campaignBuilder.adVerticalNone")}</option>
                          {sortPicker(assets.filter((x) => x.kind === "image" && x.status === "ready" && x.adAccountId === plan.adAccountId)).map((x) => <option key={x.id} value={x.id}>{assetOptLabel(x)}</option>)}
                        </select>
                        <select className="input flex-1" id={`ea-verticalvideo-${ad.id}`} defaultValue={ad.placementAssets?.placements?.vertical?.videoAssetId ?? ""}>
                          <option value="">{t("campaignBuilder.adVerticalVideoNone")}</option>
                          {sortPicker(assets.filter((x) => x.kind === "video" && x.status === "ready" && x.adAccountId === plan.adAccountId)).map((x) => <option key={x.id} value={x.id}>{assetOptLabel(x)}</option>)}
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
                        if (res) { setEditAdId(null); setNotice(t("campaignBuilder.adUpdated")); noteSaved(); await loadPlan(plan.id); }
                      }}>{t("campaignBuilder.adSaveBtn")}</button>
                      <button className="btn-secondary btn-sm" onClick={() => setEditAdId(null)}>{t("campaignBuilder.adCancelBtn")}</button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
            {adSet.ads.length === 0 ? <p className="text-sm text-slate-400">{t("campaignBuilder.adNone")}</p> : null}
          </div>
          <div className={`space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 ${activeStep !== 1 ? "hidden" : ""}`}>
            <div className="text-sm font-semibold">{t("campaignBuilder.stTitle")}<span className="text-xs font-normal text-slate-400">{t("campaignBuilder.stTitleNote")}</span></div>
            {!studio ? <p className="rounded-lg border border-slate-200 bg-white/60 p-2 text-xs leading-[1.7] text-slate-500">{t("campaignBuilder.stNotLoaded")}</p> : studio.available === false ? <p className="rounded-lg border border-amber-200 bg-white/60 p-2 text-xs leading-[1.7] text-amber-700">{t("campaignBuilder.stUnavailable", { reason: studio.reason ?? "" })}</p> : (
              <>
                {(adSet.targeting.exclusionPresets ?? []).length > 0 ? (
                  <div className="text-xs text-slate-600">{t("campaignBuilder.stActivePresets")}{(adSet.targeting.exclusionPresets ?? []).map((p) => <span key={p.key} className="mr-1 rounded bg-white px-1.5 py-0.5 font-medium">{p.label}</span>)}</div>
                ) : null}
                {editable ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-slate-600">{t("campaignBuilder.stPresetLabel")}</span>
                    {studio.presets.map((p) => (
                      <button key={p.key} className="rounded border bg-white px-2 py-0.5 text-xs" disabled={busy !== ""} onClick={async () => {
                        const res = await wrap(`preset-${adSet.id}-${p.key}`, () => apiFetch<{ status: string; reason?: string }>(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets/${adSet.id}/audiences/exclusion-preset`, { method: "POST", body: JSON.stringify({ preset: p.key }) }));
                        if (res) { if (res.status === "applied") setNotice(t("campaignBuilder.stPresetApplied", { label: p.label })); else setError(t("campaignBuilder.stPresetFailed", { reason: res.reason ?? t("campaignBuilder.stPresetUnavailableFallback") })); await loadPlan(plan.id); }
                      }}>{p.label}</button>
                    ))}
                  </div>
                ) : null}
                <div className="grid gap-1">
                  {studio.sources.map((s) => (
                    <div key={s.key} className="flex flex-wrap items-center justify-between gap-2 rounded bg-white px-2 py-1 text-xs">
                      <span>{s.label} — {s.available ? `${fmtNumBn(s.contactCount ?? 0)}${t("campaignBuilder.stContactsSuffix")}` : <span className="text-amber-700">{t("campaignBuilder.stUnavailable", { reason: s.reason ?? "" })}</span>}</span>
                      {editable && s.available ? (
                        <button className="rounded border px-2 py-0.5 font-semibold" disabled={busy !== ""} onClick={async () => {
                          const source = s.key.startsWith("recent_purchasers") ? "recent_purchasers" : s.key.startsWith("rfm_") ? "rfm_segment" : s.key;
                          const res = await wrap(`studio-${adSet.id}-${s.key}`, () => apiFetch<{ attached: boolean }>(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets/${adSet.id}/audiences/create`, { method: "POST", body: JSON.stringify({ source, segment: s.segment ?? undefined, name: s.label, attach: true }) }));
                          if (res) { setNotice(res.attached ? t("campaignBuilder.stAttachedNotice", { label: s.label }) : t("campaignBuilder.stCreatedNotAttached", { label: s.label })); await loadPlan(plan.id); }
                        }}>{t("campaignBuilder.stCreateAttachBtn")}</button>
                      ) : null}
                    </div>
                  ))}
                </div>
                {studio.records.length ? (
                  <div className="grid gap-1">
                    <div className="text-xs font-semibold text-slate-600">{t("campaignBuilder.stPerfTitle")}</div>
                    {studio.records.map((a) => (
                      <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-white px-2 py-1 text-xs">
                        <span>{a.name} ({a.kind}){a.approximateCount != null ? t("campaignBuilder.stApproxPart", { count: fmtNumBn(a.approximateCount) }) : ""}</span>
                        {a.performance ? (
                          <span className="text-slate-600">{t("campaignBuilder.stPerfLine", { spend: fmtMoney(locale, a.performance.spend), conversions: fmtNumBn(a.performance.conversions), cpa: a.performance.cpa != null ? fmtMoney(locale, a.performance.cpa) : "—", adSets: fmtNumBn(a.performance.adSetsCounted) })}</span>
                        ) : (
                          <span className="text-slate-400">{t("campaignBuilder.stPerfNone")}</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
                {editable ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-slate-600">{t("campaignBuilder.stLookalikeLabel")}</span>
                    <select className="input w-56" id={`lk-src-${adSet.id}`}>
                      <option value="">{t("campaignBuilder.stSourceChoose")}</option>
                      {studio.records.filter((a) => a.externalAudienceId).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.kind})</option>)}
                    </select>
                    <input className="input w-20" id={`lk-country-${adSet.id}`} defaultValue="BD" placeholder={t("campaignBuilder.stCountryPlaceholder")} />
                    <select className="input w-28" id={`lk-ratio-${adSet.id}`} defaultValue="0.01">
                      <option value="0.01">1%</option><option value="0.03">3%</option><option value="0.05">5%</option><option value="0.1">10%</option>
                    </select>
                    <button className="rounded border bg-white px-2 py-1 text-xs font-semibold" disabled={busy !== ""} onClick={async () => {
                      const src = (document.getElementById(`lk-src-${adSet.id}`) as HTMLSelectElement)?.value ?? "";
                      const country = (document.getElementById(`lk-country-${adSet.id}`) as HTMLInputElement)?.value.trim().toUpperCase() ?? "";
                      const ratio = Number((document.getElementById(`lk-ratio-${adSet.id}`) as HTMLSelectElement)?.value ?? "0.01");
                      const srcName = studio.records.find((a) => a.id === src)?.name ?? "Audience";
                      if (!src) { setError(t("campaignBuilder.stErrLookalikeSource")); return; }
                      const res = await wrap(`lk-${adSet.id}`, () => apiFetch<{ attached: boolean }>(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets/${adSet.id}/audiences/lookalike`, { method: "POST", body: JSON.stringify({ sourceAudienceRecordId: src, name: `${srcName} — Lookalike ${country} ${Math.round(ratio * 100)}%`, country, ratio, attach: true }) }));
                      if (res) { setNotice(res.attached ? t("campaignBuilder.stLookalikeAttached") : t("campaignBuilder.stLookalikeNotAttached")); await loadPlan(plan.id); }
                    }}>{t("campaignBuilder.stLookalikeBtn")}</button>
                  </div>
                ) : null}
                <div>
                  <button className="rounded border bg-white px-2 py-0.5 text-xs" disabled={busy !== ""} onClick={async () => {
                    const res = await wrap(`ins-${adSet.id}`, () => apiFetch<AudienceInsights>(`/organizations/${orgId}/campaign-plans/${plan.id}/ad-sets/${adSet.id}/audience-insights`));
                    if (res) setInsights((s) => ({ ...s, [adSet.id]: res }));
                  }}>{t("campaignBuilder.stInsightsBtn")}</button>
                  {insights[adSet.id] ? (
                    <div className="mt-1 space-y-0.5 text-xs text-slate-600">
                      {insights[adSet.id].included.map((a) => <div key={a.externalAudienceId}>{t("campaignBuilder.stIncluded")}{a.name ?? a.externalAudienceId}{t("campaignBuilder.stSizePart")}{a.size != null ? fmtNumBn(a.size) : t("campaignBuilder.stUnknown")}{a.sizeSource ? ` (${a.sizeSource})` : ""}</div>)}
                      {insights[adSet.id].excluded.map((a) => <div key={a.externalAudienceId}>{t("campaignBuilder.stExcluded")}{a.name ?? a.externalAudienceId}{t("campaignBuilder.stSizePart")}{a.size != null ? fmtNumBn(a.size) : t("campaignBuilder.stUnknown")}</div>)}
                      {insights[adSet.id].warnings.map((w) => <div key={w.code + w.message} className="text-amber-700">⚠️ {w.message}</div>)}
                      <div>{t("campaignBuilder.stOverlapLabel")}{insights[adSet.id].overlap.status === "not_applicable" ? t("campaignBuilder.stOverlapNa") : t("campaignBuilder.stOverlapCant")} — {insights[adSet.id].overlap.reason}</div>
                      <div>{t("campaignBuilder.stEstimateLabel")}{insights[adSet.id].estimate.available ? t("campaignBuilder.stEstimateRange", { lower: fmtNumBn(insights[adSet.id].estimate.lowerBound ?? 0), upper: fmtNumBn(insights[adSet.id].estimate.upperBound ?? 0) }) : t("campaignBuilder.stEstimateUnavailable", { reason: insights[adSet.id].estimate.reason ?? "—" })}</div>
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>
          {editable ? (
            <div className={`grid gap-3 border-t pt-3 lg:grid-cols-2 ${activeStep !== 3 ? "hidden" : ""}`}>
              <div className="space-y-2">
                <div className="text-sm font-semibold">{t("campaignBuilder.naTitle")}</div>
                <input className="input" placeholder={t("campaignBuilder.naNamePlaceholder")} value={adForms[adSet.id]?.name ?? ""} onChange={(e) => setAdForms((s) => ({ ...s, [adSet.id]: { ...(s[adSet.id] ?? emptyAdForm), name: e.target.value } }))} />
                <textarea className="input" rows={3} placeholder="Primary Text" value={adForms[adSet.id]?.primaryText ?? ""} onChange={(e) => setAdForms((s) => ({ ...s, [adSet.id]: { ...(s[adSet.id] ?? emptyAdForm), primaryText: e.target.value } }))} />
                <input className="input" placeholder={t("campaignBuilder.naHeadlinePlaceholder")} value={adForms[adSet.id]?.headline ?? ""} onChange={(e) => setAdForms((s) => ({ ...s, [adSet.id]: { ...(s[adSet.id] ?? emptyAdForm), headline: e.target.value } }))} />
                <input className="input" placeholder="Link URL (https://...)" value={adForms[adSet.id]?.linkUrl ?? ""} onChange={(e) => setAdField(adSet.id, "linkUrl", e.target.value)} />
                <div className="flex flex-wrap gap-2">
                  <select className="input w-36" value={adForms[adSet.id]?.format ?? "link"} onChange={(e) => setAdField(adSet.id, "format", e.target.value)}>
                    <option value="link">🖼️ Link Ad</option>
                    <option value="video">🎬 Video Ad</option>
                    <option value="carousel">🎠 Carousel</option>
                  </select>
                  <select className="input w-44" value={pickerSort} onChange={(e) => setPickerSort(e.target.value as "newest" | "best")} title={t("campaignBuilder.naPickerTitle")}>
                    <option value="newest">{t("campaignBuilder.naPickerNewest")}</option>
                    <option value="best">{t("campaignBuilder.naPickerBest")}</option>
                  </select>
                  {(adForms[adSet.id]?.format ?? "link") === "link" ? (
                    <select className="input flex-1" value={adForms[adSet.id]?.imageAssetId ?? ""} onChange={(e) => setAdField(adSet.id, "imageAssetId", e.target.value)}>
                      <option value="">{t("campaignBuilder.naLibraryImage")}</option>
                      {sortPicker(assets.filter((x) => x.kind === "image" && x.status === "ready" && x.adAccountId === plan.adAccountId)).map((x) => <option key={x.id} value={x.id}>{assetOptLabel(x)}</option>)}
                    </select>
                  ) : null}
                  {(adForms[adSet.id]?.format ?? "link") === "video" ? (
                    <select className="input flex-1" value={adForms[adSet.id]?.videoAssetId ?? ""} onChange={(e) => setAdField(adSet.id, "videoAssetId", e.target.value)}>
                      <option value="">{t("campaignBuilder.naLibraryVideo")}</option>
                      {sortPicker(assets.filter((x) => x.kind === "video" && x.status === "ready" && x.adAccountId === plan.adAccountId)).map((x) => <option key={x.id} value={x.id}>{assetOptLabel(x)}</option>)}
                    </select>
                  ) : null}
                </div>
                {(adForms[adSet.id]?.format ?? "link") === "carousel" ? (
                  <textarea className="input font-mono text-xs" rows={4} placeholder={t("campaignBuilder.naCarouselPlaceholder")} value={adForms[adSet.id]?.carouselText ?? ""} onChange={(e) => setAdField(adSet.id, "carouselText", e.target.value)} />
                ) : null}
                {(adForms[adSet.id]?.format ?? "link") === "link" ? (
                  <input className="input" placeholder={t("campaignBuilder.naImageUrlPlaceholder")} value={adForms[adSet.id]?.imageUrl ?? ""} onChange={(e) => setAdField(adSet.id, "imageUrl", e.target.value)} />
                ) : null}
                <div className="space-y-2 rounded-lg bg-indigo-50 p-2">
                  <div className="text-xs font-semibold text-indigo-700">{t("campaignBuilder.naV2Title")}</div>
                  <textarea className="input" rows={2} placeholder={t("campaignBuilder.naExtraTextsPlaceholder")} value={adForms[adSet.id]?.extraTexts ?? ""} onChange={(e) => setAdField(adSet.id, "extraTexts", e.target.value)} />
                  <textarea className="input" rows={2} placeholder={t("campaignBuilder.naExtraHeadlinesPlaceholder")} value={adForms[adSet.id]?.extraHeadlines ?? ""} onChange={(e) => setAdField(adSet.id, "extraHeadlines", e.target.value)} />
                  <textarea className="input" rows={2} placeholder={t("campaignBuilder.naDescsPlaceholder")} value={adForms[adSet.id]?.descriptions ?? ""} onChange={(e) => setAdField(adSet.id, "descriptions", e.target.value)} />
                  <div className="flex flex-wrap gap-2">
                    <select className="input flex-1" value={adForms[adSet.id]?.feedAssetId ?? ""} onChange={(e) => setAdField(adSet.id, "feedAssetId", e.target.value)}>
                      <option value="">{t("campaignBuilder.naFeedOverride")}</option>
                      {sortPicker(assets.filter((x) => x.kind === "image" && x.status === "ready" && x.adAccountId === plan.adAccountId)).map((x) => <option key={x.id} value={x.id}>{assetOptLabel(x)}</option>)}
                    </select>
                    <select className="input flex-1" value={adForms[adSet.id]?.verticalAssetId ?? ""} onChange={(e) => setAdField(adSet.id, "verticalAssetId", e.target.value)}>
                      <option value="">{t("campaignBuilder.naVerticalOverride")}</option>
                      {sortPicker(assets.filter((x) => x.kind === "image" && x.status === "ready" && x.adAccountId === plan.adAccountId)).map((x) => <option key={x.id} value={x.id}>{assetOptLabel(x)}</option>)}
                    </select>
                    <select className="input flex-1" value={adForms[adSet.id]?.verticalVideoAssetId ?? ""} onChange={(e) => setAdField(adSet.id, "verticalVideoAssetId", e.target.value)}>
                      <option value="">{t("campaignBuilder.naVerticalVideoOverride")}</option>
                      {sortPicker(assets.filter((x) => x.kind === "video" && x.status === "ready" && x.adAccountId === plan.adAccountId)).map((x) => <option key={x.id} value={x.id}>{assetOptLabel(x)}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {CN5_ENHANCEMENTS.map((enh) => (
                      <label key={enh.key} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={!!adForms[adSet.id]?.enhancements?.[enh.key]} onChange={(e) => setAdForms((s) => ({ ...s, [adSet.id]: { ...(s[adSet.id] ?? emptyAdForm), enhancements: { ...(s[adSet.id]?.enhancements ?? {}), [enh.key]: e.target.checked } } }))} /> {enh.label}</label>
                    ))}
                  </div>
                  <p className="text-[11px] leading-[1.7] text-slate-500">{t("campaignBuilder.naV2Note")}</p>
                </div>
                {adSet.destinationType === "WHATSAPP" ? (
                  <div className="space-y-2 rounded-lg bg-emerald-50 p-2">
                    <div className="text-xs font-semibold text-emerald-700">{t("campaignBuilder.naWaTitle")}</div>
                    <input className="input" placeholder={t("campaignBuilder.naWaGreetingPlaceholder")} value={adForms[adSet.id]?.waGreeting ?? ""} onChange={(e) => setAdField(adSet.id, "waGreeting", e.target.value)} />
                    <input className="input" placeholder={t("campaignBuilder.naWaPrefillPlaceholder")} value={adForms[adSet.id]?.waPrefill ?? ""} onChange={(e) => setAdField(adSet.id, "waPrefill", e.target.value)} />
                    <textarea className="input" rows={2} placeholder={t("campaignBuilder.naWaIcePlaceholder")} value={adForms[adSet.id]?.waIce ?? ""} onChange={(e) => setAdField(adSet.id, "waIce", e.target.value)} />
                    <p className="text-[11px] leading-[1.7] text-slate-500">{t("campaignBuilder.naWaNote")}</p>
                  </div>
                ) : null}
                <button className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={busy !== ""} onClick={() => addAd(adSet.id)}>{t("campaignBuilder.naAddBtn")}</button>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-semibold">{t("campaignBuilder.naCopyTitle")}</div>
                <select className="input" value={copySelection[adSet.id] ?? ""} onChange={(e) => setCopySelection((s) => ({ ...s, [adSet.id]: e.target.value }))}>
                  <option value="">{t("campaignBuilder.naProductChoose")}</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name} - {fmtMoneyMinor(locale, BigInt(p.priceMinor))}</option>)}
                </select>
                <button className="btn-warning btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => generateCopy(adSet.id)}>{busy === `copy-${adSet.id}` ? t("campaignBuilder.naCopyCreating") : t("campaignBuilder.naCopyBtn")}</button>
                <p className="text-xs text-slate-400">{t("campaignBuilder.naCopyNote")}</p>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-semibold">{t("campaignBuilder.naImageTitle")}</div>
                <input className="input" placeholder={t("campaignBuilder.naImagePlaceholder")} value={imagePrompts[adSet.id] ?? ""} onChange={(e) => setImagePrompts((s) => ({ ...s, [adSet.id]: e.target.value }))} />
                <button className="btn-warning btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => generateImage(adSet.id)}>{busy === `image-${adSet.id}` ? t("campaignBuilder.naCopyCreating") : t("campaignBuilder.naImageBtn")}</button>
                <p className="text-xs text-slate-400">{t("campaignBuilder.naImageNote")}</p>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-semibold">{t("campaignBuilder.naVideoTitle")}</div>
                <button className="btn-warning btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => generateVideo(adSet.id)}>{busy === `video-${adSet.id}` ? t("campaignBuilder.naCopyCreating") : t("campaignBuilder.naVideoBtn")}</button>
                <p className="text-xs text-slate-400">{t("campaignBuilder.naVideoNote")}</p>
              </div>
            </div>
          ) : null}
        </div>
      ))}

      {editable ? (
        <form onSubmit={addAdSet} className={`space-y-3 card p-5 ${activeStep !== 1 ? "hidden" : ""}`}>
          <div className="font-semibold">{t("campaignBuilder.nsTitle")}</div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <label className="block text-sm">{t("campaignBuilder.nsNameLabel")}<input className={inputCls} value={adSetForm.name} onChange={(e) => setAdSetForm({ ...adSetForm, name: e.target.value })} required /></label>
            <label className="block text-sm">{t("campaignBuilder.nsDailyBudgetLabel")}{plan.budgetMode === "cbo" ? t("campaignBuilder.nsDailyBudgetCbo") : ""}<input className={inputCls} value={adSetForm.dailyBudget} onChange={(e) => setAdSetForm({ ...adSetForm, dailyBudget: e.target.value })} placeholder="500.00" /></label>
            <label className="block text-sm">{t("campaignBuilder.nsStartLabel")}<input type="datetime-local" className={inputCls} value={adSetStart} onChange={(e) => setAdSetStart(e.target.value)} /></label>
            <label className="block text-sm">{t("campaignBuilder.nsEndLabel")}<input type="datetime-local" className={inputCls} value={adSetEnd} onChange={(e) => setAdSetEnd(e.target.value)} /></label>
            <label className="block text-sm">Optimization Goal
              <select className={inputCls} value={adSetForm.optimizationGoal} onChange={(e) => setAdSetForm({ ...adSetForm, optimizationGoal: e.target.value })}>
                <option value="LINK_CLICKS">Link Clicks</option><option value="CONVERSATIONS">{t("campaignBuilder.nsGoalConversations")}</option><option value="OFFSITE_CONVERSIONS">{t("campaignBuilder.nsGoalConversions")}</option>
                <option value="LEAD_GENERATION">Lead Generation</option><option value="REACH">Reach</option><option value="LANDING_PAGE_VIEWS">Landing Page Views</option><option value="VALUE">{t("campaignBuilder.nsGoalValue")}</option>
                <option value="APP_INSTALLS">{t("campaignBuilder.nsGoalAppInstalls")}</option>
              </select>
            </label>
            {plan.objective === "OUTCOME_APP_PROMOTION" ? <>
              <label className="block text-sm">{t("campaignBuilder.nsAppIdLabel")}<input className={inputCls} value={adSetForm.appId} onChange={(e) => setAdSetForm({ ...adSetForm, appId: e.target.value })} placeholder="1234567890" required /></label>
              <label className="block text-sm">{t("campaignBuilder.nsAppStoreLabel")}<input className={inputCls} value={adSetForm.appStoreUrl} onChange={(e) => setAdSetForm({ ...adSetForm, appStoreUrl: e.target.value })} placeholder="https://play.google.com/store/apps/details?id=..." required /></label>
            </> : null}
            <label className="block text-sm">{t("campaignBuilder.nsPageIdLabel")}<input className={inputCls} value={adSetForm.pageId} onChange={(e) => setAdSetForm({ ...adSetForm, pageId: e.target.value })} required /></label>
            <label className="block text-sm">{t("campaignBuilder.nsPixelIdLabel")}<input className={inputCls} value={adSetForm.pixelId} onChange={(e) => setAdSetForm({ ...adSetForm, pixelId: e.target.value })} /></label>
            <label className="block text-sm">{t("campaignBuilder.nsCountriesLabel")}<input className={inputCls} value={adSetForm.countries} onChange={(e) => setAdSetForm({ ...adSetForm, countries: e.target.value })} placeholder="BD" /></label>
            <label className="block text-sm">{t("campaignBuilder.nsInterestsLabel")}<input className={inputCls} value={adSetForm.interests} onChange={(e) => setAdSetForm({ ...adSetForm, interests: e.target.value })} placeholder="Online shopping, Fashion|600123..." /></label>
            <label className="block text-sm">{t("campaignBuilder.nsCitiesLabel")}<input className={inputCls} value={adSetForm.cities} onChange={(e) => setAdSetForm({ ...adSetForm, cities: e.target.value })} placeholder={t("campaignBuilder.nsCitiesPlaceholder")} /></label>
            <label className="block text-sm">{t("campaignBuilder.nsPostcodesLabel")}<input className={inputCls} value={adSetForm.postcodes} onChange={(e) => setAdSetForm({ ...adSetForm, postcodes: e.target.value })} placeholder="US:90210" /></label>
            <label className="block text-sm">{t("campaignBuilder.nsLocationTypesLabel")}<input className={inputCls} value={adSetForm.locationTypes} onChange={(e) => setAdSetForm({ ...adSetForm, locationTypes: e.target.value })} placeholder="home" /></label>
            <label className="block text-sm">{t("campaignBuilder.nsLocalesLabel")}<input className={inputCls} value={adSetForm.locales} onChange={(e) => setAdSetForm({ ...adSetForm, locales: e.target.value })} placeholder={t("campaignBuilder.nsLocalesPlaceholder")} /></label>
            <label className="block text-sm">{t("campaignBuilder.nsBehaviorsLabel")}<input className={inputCls} value={adSetForm.behaviors} onChange={(e) => setAdSetForm({ ...adSetForm, behaviors: e.target.value })} /></label>
            <label className="block text-sm">{t("campaignBuilder.nsNarrowLabel")}<input className={inputCls} value={adSetForm.narrowInterests} onChange={(e) => setAdSetForm({ ...adSetForm, narrowInterests: e.target.value })} placeholder={t("campaignBuilder.nsNarrowPlaceholder")} /></label>
            <label className="block text-sm">{t("campaignBuilder.nsEduLabel")}<input className={inputCls} value={adSetForm.eduStatuses} onChange={(e) => setAdSetForm({ ...adSetForm, eduStatuses: e.target.value })} /></label>
            <label className="block text-sm">{t("campaignBuilder.nsRelLabel")}<input className={inputCls} value={adSetForm.relStatuses} onChange={(e) => setAdSetForm({ ...adSetForm, relStatuses: e.target.value })} /></label>
            <label className="block text-sm">{t("campaignBuilder.nsLifeEventsLabel")}<input className={inputCls} value={adSetForm.lifeEvents} onChange={(e) => setAdSetForm({ ...adSetForm, lifeEvents: e.target.value })} placeholder={t("campaignBuilder.nsLifeEventsPlaceholder")} /></label>
            <label className="block text-sm">{t("campaignBuilder.nsWorkLabel")}<input className={inputCls} value={adSetForm.workPositions} onChange={(e) => setAdSetForm({ ...adSetForm, workPositions: e.target.value })} placeholder={t("campaignBuilder.nsWorkPlaceholder")} /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={expansion} onChange={(e) => setExpansion(e.target.checked)} /> {t("campaignBuilder.nsExpansionLabel")}</label>
            <label className="block text-sm">{t("campaignBuilder.nsBidStrategyLabel")}
              <select className={inputCls} value={adSetForm.bidStrategy} onChange={(e) => setAdSetForm({ ...adSetForm, bidStrategy: e.target.value })}>
                <option value="">{t("campaignBuilder.nsBidLowest")}</option>
                <option value="bid_cap">Bid Cap</option>
                <option value="cost_cap">Cost Per Result Goal</option>
                <option value="roas_goal">{t("campaignBuilder.nsBidRoas")}</option>
              </select>
            </label>
            {adSetForm.bidStrategy === "bid_cap" ? <label className="block text-sm">{t("campaignBuilder.nsBidAmountLabel")}<input className={inputCls} value={adSetForm.bidAmount} onChange={(e) => setAdSetForm({ ...adSetForm, bidAmount: e.target.value })} /></label> : null}
            {adSetForm.bidStrategy === "cost_cap" ? <label className="block text-sm">{t("campaignBuilder.nsCostGoalLabel")}<input className={inputCls} value={adSetForm.costPerResultGoal} onChange={(e) => setAdSetForm({ ...adSetForm, costPerResultGoal: e.target.value })} /></label> : null}
            {adSetForm.bidStrategy === "roas_goal" ? <label className="block text-sm">{t("campaignBuilder.nsRoasGoalLabel")}<input className={inputCls} value={adSetForm.roasGoal} onChange={(e) => setAdSetForm({ ...adSetForm, roasGoal: e.target.value })} /></label> : null}
            <label className="block text-sm">{t("campaignBuilder.nsConversionEventLabel")}
              <select className={inputCls} value={adSetForm.conversionEvent} onChange={(e) => setAdSetForm({ ...adSetForm, conversionEvent: e.target.value })}>
                <option value="">PURCHASE (Default)</option>
                {(adSetForm.optimizationGoal === "LEAD_GENERATION" ? LEAD_EVENTS : SALES_EVENTS).map((ev) => <option key={ev} value={ev}>{ev}</option>)}
              </select>
            </label>
            <label className="block text-sm">{t("campaignBuilder.nsCatalogLabel")}
              <select className={inputCls} value={adSetForm.catalogRecordId} onChange={(e) => setAdSetForm({ ...adSetForm, catalogRecordId: e.target.value, productSetId: "" })}>
                <option value="">{t("campaignBuilder.nsCatalogNone")}</option>
                {catalogs.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.platform})</option>)}
              </select>
            </label>
            {adSetForm.catalogRecordId ? (
              <label className="block text-sm">{t("campaignBuilder.nsProductSetLabel")}
                <select className={inputCls} value={adSetForm.productSetId} onChange={(e) => setAdSetForm({ ...adSetForm, productSetId: e.target.value })}>
                  <option value="">{t("campaignBuilder.nsProductSetChoose")}</option>
                  {formSets.map((s) => <option key={s.id} value={s.id} disabled={s.status !== "created"}>{s.name} · {fmtNumBn(s.itemCount)}{t("campaignBuilder.nsItemsSuffix")}{s.status === "created" ? "" : t("campaignBuilder.nsProductSetNotCreated", { status: s.status })}</option>)}
                </select>
              </label>
            ) : null}
            <label className="block text-sm">{t("campaignBuilder.nsLeadFormLabel")}
              <select className={inputCls} value={adSetForm.leadFormId} onChange={(e) => setAdSetForm({ ...adSetForm, leadFormId: e.target.value })}>
                <option value="">{t("campaignBuilder.nsLeadFormNone")}</option>
                {leadForms.filter((f) => !adSetForm.pageId || f.pageId === adSetForm.pageId).map((f) => <option key={f.id} value={f.id}>{f.name} ({f.status === "created" ? t("campaignBuilder.nsLeadFormCreated") : t("campaignBuilder.nsLeadFormLocal")})</option>)}
              </select>
            </label>
            <label className="block text-sm">{t("campaignBuilder.nsDestinationLabel")}
              <select className={inputCls} value={adSetForm.destinationType} onChange={(e) => setAdSetForm({ ...adSetForm, destinationType: e.target.value, whatsappIntegrationId: "" })}>
                <option value="">{t("campaignBuilder.nsWebsiteOption")}</option>
                <option value="WHATSAPP">{t("campaignBuilder.nsWaOption")}</option>
              </select>
            </label>
            {adSetForm.destinationType === "WHATSAPP" ? (
              <label className="block text-sm">{t("campaignBuilder.nsWaConnectionLabel")}
                <select className={inputCls} value={adSetForm.whatsappIntegrationId} onChange={(e) => setAdSetForm({ ...adSetForm, whatsappIntegrationId: e.target.value })}>
                  <option value="">{t("campaignBuilder.nsConnectionChoose")}</option>
                  {(waDestinations?.destinations ?? []).map((d) => (
                    <option key={d.integrationId} value={d.integrationId} disabled={!d.connected}>
                      {d.phoneNumberId ?? t("campaignBuilder.nsNoPhoneId")} · WABA {d.wabaId ?? "—"}{d.isDefault ? " · Default" : ""}{d.connected ? "" : t("campaignBuilder.nsNotUsableSuffix", { status: d.status })}
                    </option>
                  ))}
                </select>
                {(waDestinations?.destinations ?? []).filter((d) => d.connected).length === 0 ? (
                  <span className="mt-1 block text-xs font-medium text-red-600">{t("campaignBuilder.nsWaNoneConnected")}</span>
                ) : (
                  <span className="mt-1 block text-xs text-slate-500">{t("campaignBuilder.nsWaNumberNote")}</span>
                )}
              </label>
            ) : null}
            <div className="space-y-1 rounded-lg bg-slate-50 p-2 lg:col-span-3">
              <div className="text-xs font-semibold text-slate-600">{t("campaignBuilder.nsSearchTitle")}</div>
              <div className="flex flex-wrap items-center gap-2">
                <select className="input w-36" value={tSearch.kind} onChange={(e) => setTSearch({ ...tSearch, kind: e.target.value })}>
                  <option value="interest">Interest</option><option value="behavior">Behavior</option><option value="geo">{t("campaignBuilder.nsSearchGeo")}</option><option value="locale">{t("campaignBuilder.nsSearchLocale")}</option><option value="life_event">Life Event</option><option value="work_position">Work Position</option>
                </select>
                <input className="input w-56" value={tSearch.query} onChange={(e) => setTSearch({ ...tSearch, query: e.target.value })} placeholder={t("campaignBuilder.nsSearchPlaceholder")} />
                <button type="button" className="btn-secondary btn-sm" disabled={busy !== "" || !tSearch.query.trim()} onClick={async () => {
                  const res = await wrap("tsearch", () => apiFetch<{ available: boolean; reason?: string; results: { id: string; name: string | null; audienceSizeLower: number | null; audienceSizeUpper: number | null }[] }>(`/organizations/${orgId}/campaign-plans/targeting/search?adAccountId=${encodeURIComponent(plan.adAccountId)}&kind=${encodeURIComponent(tSearch.kind)}&q=${encodeURIComponent(tSearch.query)}`));
                  if (res) setTSearch({ ...tSearch, available: res.available, reason: res.reason, results: res.results ?? [] });
                }}>{t("campaignBuilder.nsSearchBtn")}</button>
              </div>
              {tSearch.available === false ? <p className="text-xs text-amber-600">{t("campaignBuilder.nsSearchUnavailable", { reason: tSearch.reason ?? "" })}</p> : null}
              {tSearch.results.length > 0 ? <ul className="space-y-0.5 text-xs text-slate-600">{tSearch.results.map((r) => <li key={r.id}>{r.name ?? "—"} · ID: <span className="font-mono">{r.id}</span>{r.audienceSizeLower != null ? t("campaignBuilder.nsSearchAudience", { lower: fmtNumBn(r.audienceSizeLower), upper: fmtNumBn(r.audienceSizeUpper ?? 0) }) : ""}</li>)}</ul> : null}
            </div>
            <label className="block text-sm">{t("campaignBuilder.nsAudienceIdsLabel")}<input className={inputCls} value={adSetForm.audienceIds} onChange={(e) => setAdSetForm({ ...adSetForm, audienceIds: e.target.value })} placeholder={audList.filter((a) => a.externalAudienceId).map((a) => a.externalAudienceId).join(", ") || t("campaignBuilder.nsAudienceIdsPlaceholder")} /></label>
            <label className="block text-sm">{t("campaignBuilder.nsExcludeLabel")}<input className={inputCls} value={adSetForm.excludeIds} onChange={(e) => setAdSetForm({ ...adSetForm, excludeIds: e.target.value })} /></label>
            <label className="block text-sm">{t("campaignBuilder.nsPresetLabel")}
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
                <option value="">{t("campaignBuilder.nsPresetChoose")}</option>
                {savedList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <PlacementChecks values={placements} onChange={setPlacements} />
          </div>
          <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>{t("campaignBuilder.nsAddBtn")}</button>
        </form>
      ) : null}

      </div>

      {(plan.status === "approved" || plan.status === "published" || plan.status === "publish_failed") ? (
        <div className={`card space-y-3 p-5 ${activeStep !== 4 ? "hidden" : ""}`}>
          <div className="font-semibold">{t("campaignBuilder.xp2Title")}<span className="text-xs font-normal text-slate-400">{t("campaignBuilder.xp2TitleNote")}</span></div>
          <p className="text-xs text-slate-500">{t("campaignBuilder.xp2Intro")}</p>
          <div className="space-y-3">
            <div>
              <div className="text-xs font-semibold text-slate-600">{t("campaignBuilder.xp2PlatformLabel")}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <select className="input w-40" id="x-platform">
                  <option value="google">Google Ads</option>
                  <option value="tiktok">TikTok Ads</option>
                </select>
                <select className="input w-64" id="x-account">
                  <option value="">{t("campaignBuilder.xp2TargetChoose")}</option>
                  {accounts.filter((a) => a.platform === "google" || a.platform === "tiktok").map((a) => <option key={a.id} value={a.id}>{a.name} ({a.platform})</option>)}
                </select>
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-600">{t("campaignBuilder.xp2GoogleKindLabel")}</div>
                <select className="input mt-1 w-52" id="x-kind" title={t("campaignBuilder.xp2KindTitle")}>
                  <option value="search">Google: Search (RSA)</option>
                  <option value="pmax">Google: Performance Max</option>
                </select>
                <p className="mt-1 text-xs leading-[1.7] text-slate-500">{t("campaignBuilder.xp2PmaxNote")}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-600">{t("campaignBuilder.xp2TiktokObjectiveLabel")}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <select className="input w-56" id="x-objective" title={t("campaignBuilder.xp2ObjectiveTitle")}>
                    <option value="TRAFFIC">TikTok: Traffic</option>
                    <option value="WEB_CONVERSIONS">TikTok: Website Conversions</option>
                    <option value="LEAD_GENERATION">TikTok: Lead Generation</option>
                  </select>
                  <input className="input w-44" id="x-pixel" placeholder={t("campaignBuilder.xp2PixelPlaceholder")} />
                  <input className="input w-52" id="x-event" placeholder={t("campaignBuilder.xp2EventPlaceholder")} />
                </div>
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs leading-[1.7] text-amber-800">{t("campaignBuilder.xp2LeadNote")}</p>
              </div>
            </div>
            <button className="btn-primary btn-sm" disabled={busy !== ""} onClick={async () => {
              const platform = (document.getElementById("x-platform") as HTMLSelectElement)?.value ?? "google";
              const target = (document.getElementById("x-account") as HTMLSelectElement)?.value ?? "";
              if (!target) { setError(t("campaignBuilder.xp2ErrTarget")); return; }
              const kind = (document.getElementById("x-kind") as HTMLSelectElement)?.value ?? "search";
              const objectiveType = (document.getElementById("x-objective") as HTMLSelectElement)?.value ?? "TRAFFIC";
              const pixelId = (document.getElementById("x-pixel") as HTMLInputElement)?.value.trim() ?? "";
              const optimizationEvent = (document.getElementById("x-event") as HTMLInputElement)?.value.trim() ?? "";
              const extra = platform === "google" ? { kind } : { objectiveType, ...(pixelId ? { pixelId } : {}), ...(optimizationEvent ? { optimizationEvent } : {}) };
              const res = await wrap("xplat", () => apiFetch<{ status: string; unmapped: string[]; notCarried?: string[]; transformations: string[]; publication?: { externalCampaignId?: string | null } }>(`/organizations/${orgId}/campaign-plans/${plan.id}/cross-platform`, { method: "POST", body: JSON.stringify({ platform, targetAdAccountId: target, ...extra }) }));
              if (res) {
                setXdNote({ notCarried: res.notCarried ?? [] });
                if (res.status === "created") setNotice(t("campaignBuilder.xp2CreatedNotice", { platform: platform === "google" ? "Google" : "TikTok", id: res.publication?.externalCampaignId ?? "—", notCarried: res.notCarried?.length ? t("campaignBuilder.xp2NotCarriedPart", { items: res.notCarried.join(" · ") }) : "" }));
                else if (res.status === "blocked") setError(t("campaignBuilder.xp2BlockedError", { items: res.unmapped.join(" · ") }));
                else setError(t("campaignBuilder.xp2FailedError"));
                await loadPlan(plan.id);
              }
            }}>{t("campaignBuilder.xp2CreateBtn")}</button>
            {xdNote && xdNote.notCarried.length ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-[1.7] text-amber-800">
                <p className="font-semibold">{t("campaignBuilder.xp2NotCarriedTitle")}</p>
                <ul className="mt-1 list-inside list-disc">{xdNote.notCarried.map((n, i) => <li key={i}>{n}</li>)}</ul>
              </div>
            ) : null}
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs font-semibold text-slate-600">{t("campaignBuilder.xp2FanoutTitle")}<span className="font-normal text-slate-400">(CA15)</span></div>
              <p className="mt-1 text-xs leading-[1.7] text-slate-500">{t("campaignBuilder.xp2FanoutIntro")}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select className="input w-64" id="fo-google-account">
                  <option value="">{t("campaignBuilder.xp2GoogleNone")}</option>
                  {accounts.filter((a) => a.platform === "google").map((a) => <option key={a.id} value={a.id}>{a.name} (google)</option>)}
                </select>
                <select className="input w-64" id="fo-tiktok-account">
                  <option value="">{t("campaignBuilder.xp2TiktokNone")}</option>
                  {accounts.filter((a) => a.platform === "tiktok").map((a) => <option key={a.id} value={a.id}>{a.name} (tiktok)</option>)}
                </select>
                <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                  const googleAccountId = (document.getElementById("fo-google-account") as HTMLSelectElement)?.value ?? "";
                  const tiktokAccountId = (document.getElementById("fo-tiktok-account") as HTMLSelectElement)?.value ?? "";
                  if (!googleAccountId && !tiktokAccountId) { setError(t("campaignBuilder.xp2ErrAnyAccount")); return; }
                  const kind = (document.getElementById("x-kind") as HTMLSelectElement)?.value ?? "search";
                  const objectiveType = (document.getElementById("x-objective") as HTMLSelectElement)?.value ?? "TRAFFIC";
                  const pixelId = (document.getElementById("x-pixel") as HTMLInputElement)?.value.trim() ?? "";
                  const optimizationEvent = (document.getElementById("x-event") as HTMLInputElement)?.value.trim() ?? "";
                  const body = {
                    ...(googleAccountId ? { googleAccountId, googleKind: kind } : {}),
                    ...(tiktokAccountId ? { tiktokAccountId, tiktokObjectiveType: objectiveType, ...(pixelId ? { tiktokPixelId: pixelId } : {}), ...(optimizationEvent ? { tiktokOptimizationEvent: optimizationEvent } : {}) } : {}),
                  };
                  const res = await wrap("fanout-preview", () => apiFetch<{ platforms: any[]; note?: string }>(`/organizations/${orgId}/campaign-plans/${plan.id}/fanout/preview`, { method: "POST", body: JSON.stringify(body) }));
                  if (res) setFanout(res);
                }}>{t("campaignBuilder.xp2PreviewBtn")}</button>
              </div>
              {fanout ? (
                <div className="mt-3 space-y-2">
                  {fanout.platforms.map((b: any, i: number) => (
                    <div key={i} className="rounded-lg bg-slate-50 p-3 text-xs leading-[1.7]">
                      <p className="font-semibold">{b.platform === "google" ? (b.kind === "pmax" ? "Google Performance Max" : "Google Search") : "TikTok"} — {b.status === "error" ? t("campaignBuilder.xp2StatusError") : b.status === "blocked" ? t("campaignBuilder.xp2StatusBlocked") : b.status === "created" ? t("campaignBuilder.xp2StatusCreated") : t("campaignBuilder.xp2StatusReady")}</p>
                      {b.error ? <p className="text-red-600">{b.error}</p> : null}
                      {b.mapped ? <p className="text-slate-600">{t("campaignBuilder.xp2MappedLine", { name: b.mapped.name ?? "—", budget: b.mapped.dailyBudget != null ? fmtMoney(locale, Number(b.mapped.dailyBudget)) : "—", countries: (b.mapped.countryCodes ?? []).join(", ") })}</p> : null}
                      {Array.isArray(b.mapped?.audienceSignals) && b.mapped.audienceSignals.length ? <p className="text-slate-600">{t("campaignBuilder.xp2SignalsLine", { signals: b.mapped.audienceSignals.map((s: any) => s.name ?? s.externalAudienceId ?? s.savedAudienceId).join(", ") })}</p> : null}
                      {Array.isArray(b.unmapped) && b.unmapped.length ? <p className="text-amber-700">{t("campaignBuilder.xp2UnmappedLine", { items: b.unmapped.join(" · ") })}</p> : null}
                      {Array.isArray(b.notCarried) && b.notCarried.length ? <p className="text-amber-700">{t("campaignBuilder.xp2NotCarriedLine", { items: b.notCarried.join(" · ") })}</p> : null}
                      {Array.isArray(b.transformations) && b.transformations.length ? <p className="text-slate-500">{t("campaignBuilder.xp2TransformsLine", { items: b.transformations.join(" · ") })}</p> : null}
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center gap-2">
                    <button className="btn-primary btn-sm" disabled={busy !== ""} onClick={async () => {
                      const googleAccountId = (document.getElementById("fo-google-account") as HTMLSelectElement)?.value ?? "";
                      const tiktokAccountId = (document.getElementById("fo-tiktok-account") as HTMLSelectElement)?.value ?? "";
                      const kind = (document.getElementById("x-kind") as HTMLSelectElement)?.value ?? "search";
                      const objectiveType = (document.getElementById("x-objective") as HTMLSelectElement)?.value ?? "TRAFFIC";
                      const pixelId = (document.getElementById("x-pixel") as HTMLInputElement)?.value.trim() ?? "";
                      const optimizationEvent = (document.getElementById("x-event") as HTMLInputElement)?.value.trim() ?? "";
                      const body = {
                        ...(googleAccountId ? { googleAccountId, googleKind: kind } : {}),
                        ...(tiktokAccountId ? { tiktokAccountId, tiktokObjectiveType: objectiveType, ...(pixelId ? { tiktokPixelId: pixelId } : {}), ...(optimizationEvent ? { tiktokOptimizationEvent: optimizationEvent } : {}) } : {}),
                      };
                      const res = await wrap("fanout-create", () => apiFetch<{ platforms: any[]; created: number; total: number }>(`/organizations/${orgId}/campaign-plans/${plan.id}/fanout`, { method: "POST", body: JSON.stringify(body) }));
                      if (res) {
                        setFanout({ platforms: res.platforms });
                        if (res.created > 0) setNotice(t("campaignBuilder.xp2FanoutNotice", { created: fmtNumBn(res.created), total: fmtNumBn(res.total) }));
                        else setError(t("campaignBuilder.xp2FanoutError"));
                        const list = await apiFetch<XDraft[]>(`/organizations/${orgId}/campaign-plans/${plan.id}/xdrafts`).catch(() => null);
                        if (list) setXdrafts(list);
                      }
                    }}>{t("campaignBuilder.xp2ConfirmBtn")}</button>
                    <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => setFanout(null)}>{t("campaignBuilder.xp2PreviewCloseBtn")}</button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {(plan.status === "approved" || plan.status === "published" || plan.status === "publish_failed") ? (
        <div className={`card space-y-3 p-5 ${activeStep !== 4 ? "hidden" : ""}`}>
          <div className="font-semibold">{t("campaignBuilder.xd2Title")}<span className="text-xs font-normal text-slate-400">{t("campaignBuilder.xd2TitleNote")}</span></div>
          <p className="text-xs text-slate-500">{t("campaignBuilder.xd2Intro")}</p>
          <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("xdrafts", () => apiFetch<XDraft[]>(`/organizations/${orgId}/campaign-plans/${plan.id}/xdrafts`));
            if (res) setXdrafts(res);
          }}>{t("campaignBuilder.xd2LoadBtn")}</button>
          {xdrafts ? (xdrafts.length === 0 ? <p className="text-sm text-slate-400">{t("campaignBuilder.xd2None")}</p> : (
            <div className="space-y-2">
              {xdrafts.map((d) => (
                <div key={d.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{d.platform === "google" ? (d.kind === "pmax" ? "Google Performance Max" : "Google Search") : `TikTok · ${d.fields?.objectiveType ?? "TRAFFIC"}`} — {d.fields?.name ?? ""} <span className="text-xs text-slate-400">{t("campaignBuilder.xd2DailyBudget", { amount: d.fields?.dailyBudget ?? "—" })}</span></span>
                    <span className={d.status === "created" ? "rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-semibold text-green-700" : d.status === "blocked" ? "rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700" : d.status === "failed" ? "rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700" : "rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600"}>{d.status}{d.externalCampaignId ? ` · ${d.externalCampaignId}` : ""}</span>
                  </div>
                  {d.lastError ? <p className="mt-1 text-xs text-red-600">{d.lastError}</p> : null}
                  {Array.isArray(d.unmapped) && d.unmapped.length ? <p className="mt-1 text-xs leading-[1.7] text-amber-700">{d.status === "created" ? t("campaignBuilder.xd2NotCarriedLabel") : t("campaignBuilder.xd2MissingLabel")}: {d.unmapped.join(" · ")}</p> : null}
                  <p className="mt-1 text-xs text-slate-500">{d.platform === "google" && d.kind === "pmax" ? t("campaignBuilder.xd2PmaxSummary", { headlines: fmtNumBn((d.fields?.headlines ?? []).length), long: fmtNumBn((d.fields?.longHeadlines ?? []).length), descriptions: fmtNumBn((d.fields?.descriptions ?? []).length), images: fmtNumBn((d.fields?.imageUrls ?? []).length), business: d.fields?.businessName ?? "—", countries: (d.fields?.countryCodes ?? []).join(",") }) : d.platform === "google" ? t("campaignBuilder.xd2SearchSummary", { headlines: fmtNumBn((d.fields?.headlines ?? []).length), descriptions: fmtNumBn((d.fields?.descriptions ?? []).length), keywords: fmtNumBn((d.fields?.keywords ?? []).length), countries: (d.fields?.countryCodes ?? []).join(",") }) : `Text: ${String(d.fields?.adText ?? "").slice(0, 60)} · ${(d.fields?.countryCodes ?? []).join(",")}`}</p>
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
                      if (res) setXdResult((s) => ({ ...s, [d.id]: (res.ready ? t("campaignBuilder.xd2ReadyOk") + "\n" : t("campaignBuilder.xd2ReadyBlocked") + "\n") + res.checks.map((c) => `${c.level === "error" ? "⛔" : c.level === "warn" ? "⚠" : "✓"} ${c.label}: ${c.detail}`).join("\n") }));
                    }}>{t("campaignBuilder.xd2ReadyBtn")}</button>
                    <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                      const res = await wrap(`xd-prev-${d.id}`, () => apiFetch<any>(`/organizations/${orgId}/campaign-plans/${plan.id}/xdrafts/${d.id}/preview`));
                      if (res) setXdResult((s) => ({ ...s, [d.id]: JSON.stringify(res, null, 1) }));
                    }}>{t("campaignBuilder.xd2PreviewBtn")}</button>
                    <button className="btn-primary btn-sm" disabled={busy !== ""} onClick={async () => {
                      const res = await wrap(`xd-pub-${d.id}`, () => apiFetch<{ status: string; note?: string; unmapped?: string[] }>(`/organizations/${orgId}/campaign-plans/${plan.id}/xdrafts/${d.id}/publish`, { method: "POST", body: JSON.stringify({}) }));
                      if (res) {
                        setXdResult((s) => ({ ...s, [d.id]: res.status === "created" ? t("campaignBuilder.xd2PublishCreated", { note: res.note ?? t("campaignBuilder.xd2PublishCreatedFallback") }) : res.status === "blocked" ? t("campaignBuilder.xd2PublishBlocked", { items: (res.unmapped ?? []).join(" · ") }) : t("campaignBuilder.xd2PublishFailed") }));
                        const list = await apiFetch<XDraft[]>(`/organizations/${orgId}/campaign-plans/${plan.id}/xdrafts`).catch(() => null);
                        if (list) setXdrafts(list);
                      }
                    }}>{t("campaignBuilder.xd2RepublishBtn")}</button>
                    <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => { await runXdSync(d); }}>{t("campaignBuilder.xd2SyncBtn")}</button>
                    {d.status === "created" && d.externalCampaignId ? (<>
                      <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => { await runXdLifecycle(d, "pause"); }}>{t("campaignBuilder.xd2PausePlatformBtn")}</button>
                      <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => { await runXdLifecycle(d, "resume"); }}>{t("campaignBuilder.xd2ResumePlatformBtn")}</button>
                      <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                        if (!window.confirm(t("campaignBuilder.xd2PauseConfirm"))) return;
                        const res = await wrap(`xd-pause-${d.id}`, () => apiFetch<{ platformStatus: string }>(`/organizations/${orgId}/campaign-plans/${plan.id}/xdrafts/${d.id}/set-status`, { method: "POST", body: JSON.stringify({ target: "PAUSED" }) }));
                        if (res) setXdResult((s) => ({ ...s, [d.id]: t("campaignBuilder.xd2PauseDone", { status: res.platformStatus }) }));
                      }}>{t("campaignBuilder.xd2PauseBtn")}</button>
                      <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                        if (!window.confirm(t("campaignBuilder.xd2ActivateConfirm"))) return;
                        const res = await wrap(`xd-activate-${d.id}`, () => apiFetch<{ platformStatus: string }>(`/organizations/${orgId}/campaign-plans/${plan.id}/xdrafts/${d.id}/set-status`, { method: "POST", body: JSON.stringify({ target: "ACTIVE" }) }));
                        if (res) setXdResult((s) => ({ ...s, [d.id]: t("campaignBuilder.xd2ActivateDone", { status: res.platformStatus }) }));
                      }}>{t("campaignBuilder.xd2ActivateBtn")}</button>
                    </>) : null}
                  </div>
                  {xdResult[d.id] ? <pre className="mt-2 whitespace-pre-wrap rounded bg-white p-2 text-xs text-slate-600">{xdResult[d.id]}</pre> : null}
                  {xdEditId === d.id && xdForm ? (
                    <div className="mt-2 space-y-2 border-t pt-2">
                      <p className="text-xs font-semibold text-slate-600">{t("campaignBuilder.xd2EditHeading")}</p>
                      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                        <label className="block text-sm">{t("campaignBuilder.xd2NameLabel")}<input className="input" value={xdForm.name} onChange={(e) => setXdForm({ ...xdForm, name: e.target.value })} /></label>
                        <label className="block text-sm">{t("campaignBuilder.xd2DailyBudgetLabel")}<input className="input" value={xdForm.dailyBudget} onChange={(e) => setXdForm({ ...xdForm, dailyBudget: e.target.value })} /></label>
                        <label className="block text-sm">{t("campaignBuilder.xd2CountriesLabel")}<input className="input" value={xdForm.countries} onChange={(e) => setXdForm({ ...xdForm, countries: e.target.value })} /></label>
                      </div>
                      {d.platform === "google" && d.kind === "pmax" ? (<>
                        <p className="text-xs font-semibold text-slate-600">{t("campaignBuilder.xd2PmaxHeading")}</p>
                        <label className="block text-sm">{t("campaignBuilder.xd2FinalUrlLabel")}<input className="input" value={xdForm.finalUrl} onChange={(e) => setXdForm({ ...xdForm, finalUrl: e.target.value })} /></label>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="block text-sm">{t("campaignBuilder.xd2BusinessNameLabel")}<input className="input" value={xdForm.businessName} onChange={(e) => setXdForm({ ...xdForm, businessName: e.target.value })} /></label>
                          <label className="block text-sm">{t("campaignBuilder.xd2LogoLabel")}<input className="input" value={xdForm.logoUrl} onChange={(e) => setXdForm({ ...xdForm, logoUrl: e.target.value })} /></label>
                        </div>
                        <label className="block text-sm">{t("campaignBuilder.xd2HeadlinesPmax")}<textarea className="input font-mono text-xs" rows={5} value={xdForm.headlinesText} onChange={(e) => setXdForm({ ...xdForm, headlinesText: e.target.value })} /></label>
                        <label className="block text-sm">{t("campaignBuilder.xd2LongHeadlines")}<textarea className="input font-mono text-xs" rows={3} value={xdForm.longHeadlinesText} onChange={(e) => setXdForm({ ...xdForm, longHeadlinesText: e.target.value })} /></label>
                        <label className="block text-sm">{t("campaignBuilder.xd2DescriptionsPmax")}<textarea className="input font-mono text-xs" rows={3} value={xdForm.descriptionsText} onChange={(e) => setXdForm({ ...xdForm, descriptionsText: e.target.value })} /></label>
                        <label className="block text-sm">{t("campaignBuilder.xd2ImageUrls")}<textarea className="input font-mono text-xs" rows={3} value={xdForm.imageUrlsText} onChange={(e) => setXdForm({ ...xdForm, imageUrlsText: e.target.value })} /></label>
                        <p className="text-xs text-slate-400">{t("campaignBuilder.xd2PmaxNote")}</p>
                      </>) : d.platform === "google" ? (<>
                        <p className="text-xs font-semibold text-slate-600">{t("campaignBuilder.xd2SearchHeading")}</p>
                        <label className="block text-sm">{t("campaignBuilder.xd2FinalUrlLabel")}<input className="input" value={xdForm.finalUrl} onChange={(e) => setXdForm({ ...xdForm, finalUrl: e.target.value })} /></label>
                        <label className="block text-sm">{t("campaignBuilder.xd2HeadlinesPmax")}<textarea className="input font-mono text-xs" rows={5} value={xdForm.headlinesText} onChange={(e) => setXdForm({ ...xdForm, headlinesText: e.target.value })} /></label>
                        <label className="block text-sm">{t("campaignBuilder.xd2DescriptionsSearch")}<textarea className="input font-mono text-xs" rows={3} value={xdForm.descriptionsText} onChange={(e) => setXdForm({ ...xdForm, descriptionsText: e.target.value })} /></label>
                        <label className="block text-sm">{t("campaignBuilder.xd2KeywordsLabel")}<textarea className="input font-mono text-xs" rows={4} value={xdForm.keywordsText} onChange={(e) => setXdForm({ ...xdForm, keywordsText: e.target.value })} /></label>
                      </>) : (<>
                        <p className="text-xs font-semibold text-slate-600">{t("campaignBuilder.xd2TiktokHeading")}</p>
                        <label className="block text-sm">{t("campaignBuilder.xd2AdTextLabel")}<textarea className="input text-xs" rows={2} value={xdForm.adText} onChange={(e) => setXdForm({ ...xdForm, adText: e.target.value })} /></label>
                        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                          <label className="block text-sm">{t("campaignBuilder.xd2LandingUrlLabel")}<input className="input" value={xdForm.landingUrl} onChange={(e) => setXdForm({ ...xdForm, landingUrl: e.target.value })} /></label>
                          <label className="block text-sm">{t("campaignBuilder.xd2ImageUrlLabel")}<input className="input" value={xdForm.imageUrl} onChange={(e) => setXdForm({ ...xdForm, imageUrl: e.target.value })} /></label>
                          <label className="block text-sm">{t("campaignBuilder.xd2VideoUrlLabel")}<input className="input" value={xdForm.videoUrl} onChange={(e) => setXdForm({ ...xdForm, videoUrl: e.target.value })} /></label>
                        </div>
                        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                          <label className="block text-sm">Objective
                            <select className="input" value={xdForm.objectiveType} onChange={(e) => setXdForm({ ...xdForm, objectiveType: e.target.value })}>
                              <option value="TRAFFIC">TRAFFIC</option>
                              <option value="WEB_CONVERSIONS">WEB_CONVERSIONS</option>
                              <option value="LEAD_GENERATION">LEAD_GENERATION</option>
                            </select>
                          </label>
                          <label className="block text-sm">{t("campaignBuilder.xd2PixelLabel")}<input className="input" value={xdForm.pixelId} onChange={(e) => setXdForm({ ...xdForm, pixelId: e.target.value })} /></label>
                          <label className="block text-sm">Optimization Event<input className="input" value={xdForm.optimizationEvent} onChange={(e) => setXdForm({ ...xdForm, optimizationEvent: e.target.value })} /></label>
                        </div>
                        <p className="text-xs text-slate-400">{t("campaignBuilder.xp2LeadNote")}</p>
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
                          if (res.problems.length) setXdResult((s) => ({ ...s, [d.id]: t("campaignBuilder.xd2SaveProblems", { items: res.problems.join(" · ") }) }));
                          else { setNotice(t("campaignBuilder.xd2SavedNotice")); noteSaved(); setXdEditId(null); setXdForm(null); }
                          const list = await apiFetch<XDraft[]>(`/organizations/${orgId}/campaign-plans/${plan.id}/xdrafts`).catch(() => null);
                          if (list) setXdrafts(list);
                        }
                      }}>{t("campaignBuilder.xd2SaveBtn")}</button>
                      {d.status === "created" ? (
                        <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                          const amount = String(xdForm.dailyBudget ?? "").trim();
                          if (!amount || !(Number(amount) > 0)) { setError(t("campaignBuilder.xd2ErrBudgetPositive")); return; }
                          if (!window.confirm(t("campaignBuilder.xd2BudgetConfirm", { amount: fmtMoney(locale, Number(amount)) }))) return;
                          const res = await wrap(`xd-budget-${d.id}`, () => apiFetch<{ before: string | null; after: string }>(`/organizations/${orgId}/campaign-plans/${plan.id}/xdrafts/${d.id}/budget`, { method: "POST", body: JSON.stringify({ dailyBudget: amount }) }));
                          if (res) {
                            setXdResult((s) => ({ ...s, [d.id]: t("campaignBuilder.xd2BudgetDone", { before: res.before != null ? fmtMoney(locale, Number(res.before)) : "—", after: fmtMoney(locale, Number(res.after)) }) }));
                            const list = await apiFetch<XDraft[]>(`/organizations/${orgId}/campaign-plans/${plan.id}/xdrafts`).catch(() => null);
                            if (list) setXdrafts(list);
                          }
                        }}>{t("campaignBuilder.xd2BudgetBtn")}</button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )) : null}
        </div>
      ) : null}

      <div className={`card space-y-3 p-5 ${activeStep !== 4 ? "hidden" : ""}`}>
        <div className="font-semibold">{t("campaignBuilder.clTitle")}<span className="text-xs font-normal text-slate-400">{t("campaignBuilder.clTitleNote")}</span></div>
        <p className="text-xs text-slate-500">{t("campaignBuilder.clIntro")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input w-72" id="clone-account">
            <option value="">{t("campaignBuilder.clTargetChoose")}</option>
            {accountsHealth.filter((a) => a.platform === "meta" && a.id !== plan.adAccountId).map((a) => <option key={a.id} value={a.id}>{a.name} — Status: {a.health.platformStatusBucket}{a.health.connection === "none" ? t("campaignBuilder.clNoConnection") : ""}</option>)}
          </select>
          <input className="input w-44" id="clone-page" placeholder={t("campaignBuilder.clPagePlaceholder")} />
          <input className="input w-44" id="clone-pixel" placeholder={t("campaignBuilder.clPixelPlaceholder")} />
          <button className="btn-primary btn-sm" disabled={busy !== ""} onClick={async () => {
            const target = (document.getElementById("clone-account") as HTMLSelectElement)?.value ?? "";
            if (!target) { setError(t("campaignBuilder.clErrTarget")); return; }
            const pageId = (document.getElementById("clone-page") as HTMLInputElement)?.value.trim();
            const pixelId = (document.getElementById("clone-pixel") as HTMLInputElement)?.value.trim();
            const res = await wrap("clone", () => apiFetch<NonNullable<typeof cloneReport>>(`/organizations/${orgId}/campaign-plans/${plan.id}/clone-to-account`, { method: "POST", body: JSON.stringify({ targetAdAccountId: target, resolutions: { ...(pageId ? { pageId } : {}), ...(pixelId ? { pixelId } : {}) } }) }));
            if (res) { setCloneReport(res); setNotice(t("campaignBuilder.clCreatedNotice", { plan: res.plan.name, account: res.targetAccount.name })); }
          }}>{t("campaignBuilder.clBtn")}</button>
          <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
            const acc = await apiFetch<typeof accountsHealth>(`/organizations/${orgId}/campaign-plans/accounts/health`).catch(() => null);
            if (acc) setAccountsHealth(acc);
          }}>{t("campaignBuilder.clHealthBtn")}</button>
        </div>
        {cloneReport ? (
          <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
            <p className="font-semibold text-sm">{t("campaignBuilder.clReportTitle", { plan: cloneReport.plan.name })}</p>
            {cloneReport.blockers.length ? <div className="rounded bg-red-50 p-2 text-red-700">{cloneReport.blockers.map((b, i) => <p key={i}>⛔ {b}</p>)}</div> : <p className="text-emerald-700">{t("campaignBuilder.clNoBlockers")}</p>}
            {cloneReport.mapping.map((m, i) => (
              <p key={i}><span className={m.outcome === "carried_verified" ? "font-semibold text-emerald-700" : m.outcome === "carried_user_confirmed" ? "font-semibold text-sky-700" : "font-semibold text-red-700"}>{m.outcome === "carried_verified" ? t("campaignBuilder.clOutcomeVerified") : m.outcome === "carried_user_confirmed" ? t("campaignBuilder.clOutcomeUser") : t("campaignBuilder.clOutcomeBlocked")}</span> {m.adSet} · {m.field}: {m.detail}</p>
            ))}
          </div>
        ) : null}
      </div>

      <div className={`card space-y-3 p-5 ${activeStep !== 0 ? "hidden" : ""}`}>
        <div className="font-semibold">{t("campaignBuilder.lfTitle")}<span className="text-xs font-normal text-slate-400">{t("campaignBuilder.lfTitleNote")}</span></div>
        <p className="text-xs text-slate-500">{t("campaignBuilder.lfIntro")}</p>
        <div>
          <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
            const res = await wrap("lfquality", () => apiFetch<NonNullable<typeof leadQuality>>(`/organizations/${orgId}/campaign-plans/lead-forms/quality`));
            if (res) setLeadQuality(res);
          }}>{t("campaignBuilder.lfQualityBtn")}</button>
          {leadQuality ? <p className="mt-1 text-xs text-slate-400">{t("campaignBuilder.lfQualityNote", { attributed: fmtNumBn(leadQuality.coverage.attributedLeads), unattributed: fmtNumBn(leadQuality.coverage.unattributedLeadAdsLeads), min: fmtNumBn(leadQuality.minLeads) })}</p> : null}
        </div>
        {leadForms.length === 0 ? <p className="text-sm text-slate-400">{t("campaignBuilder.lfNone")}</p> : (
          <div className="space-y-2">
            {leadForms.map((f) => (
              <div key={f.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{f.name} <span className="text-xs text-slate-400">Page: {f.pageId}</span></span>
                  <span className={f.status === "created" ? "rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-semibold text-green-700" : f.status === "failed" ? "rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700" : "rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600"}>{f.status === "created" ? t("campaignBuilder.lfStatusCreated", { id: f.externalFormId ?? "" }) : f.status === "failed" ? t("campaignBuilder.lfStatusFailed") : t("campaignBuilder.lfStatusLocal")}</span>
                </div>
                {f.error ? <p className="mt-1 text-xs text-red-600">{f.error}</p> : null}
                {leadQuality ? (() => { const q = leadQuality.forms.find((x) => x.formId === f.id); if (!q) return null; return (
                  <div className="mt-1 rounded bg-white p-2 text-xs leading-[1.7] text-slate-600">
                    {q.belowThreshold ? <p>{t("campaignBuilder.lfQualityPrefix")}{q.thresholdNote}</p> : (
                      <p>{t("campaignBuilder.lfQualityLine", { leads: fmtNumBn(q.totalLeads), qualified: fmtNumBn(q.qualified), qualifiedRate: q.qualifiedRate ?? "—", converted: fmtNumBn(q.convertedToOrder), orderRate: q.orderRate ?? "—", stages: Object.entries(q.stages).map(([s, n]) => `${s} ${n}`).join(" · ") })}</p>
                    )}
                    <p>{q.costPerQualifiedMinor != null ? <>{t("campaignBuilder.lfCostLine", { cost: fmtMoneyBn(q.costPerQualifiedMinor) })}</> : q.costNote}</p>
                    <p>{t("campaignBuilder.lfFeedbackLine", { sent: fmtNumBn(q.feedback.sent), failed: fmtNumBn(q.feedback.failed), last: q.feedback.lastSentAt ? t("campaignBuilder.lfFeedbackLast", { date: q.feedback.lastSentAt.slice(0, 10) }) : t("campaignBuilder.lfFeedbackNever") })}</p>
                  </div>
                ); })() : null}
                {f.introHeadline ? <p className="mt-1 text-xs text-slate-500">{t("campaignBuilder.lfIntroLabel")}{f.introHeadline}</p> : null}
                <div className="mt-1 text-xs text-slate-500">{t("campaignBuilder.lfQuestionsLabel")}{f.questions.map((q) => q.label ?? q.type).join(" · ")}</div>
                <div className="text-xs text-slate-500">Mapping: {Object.entries(f.fieldMapping ?? {}).map(([k, v]) => `${k} → ${v}`).join(", ") || "—"}{f.higherIntent ? t("campaignBuilder.lfHigherIntentSuffix") : ""}</div>
                {f.status !== "created" ? (
                  <button className="btn-secondary btn-sm mt-2" disabled={busy !== ""} onClick={async () => {
                    const res = await wrap(`lfmeta-${f.id}`, () => apiFetch(`/organizations/${orgId}/campaign-plans/lead-forms/${f.id}/create-on-meta`, { method: "POST", body: JSON.stringify({ adAccountId: plan.adAccountId }) }));
                    if (res) { setNotice(t("campaignBuilder.lfMetaConfirmed")); await reloadLeadForms(); await loadPlan(plan.id); }
                    else await reloadLeadForms();
                  }}>{t("campaignBuilder.lfCreateOnMetaBtn")}</button>
                ) : null}
              </div>
            ))}
          </div>
        )}
        {editable ? (
          <div className="space-y-2 border-t pt-3">
            <div className="text-sm font-semibold">{t("campaignBuilder.lfNewTitle")}</div>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
              <label className="block text-sm">{t("campaignBuilder.lfNameLabel")}<input className="input" value={leadFormForm.name} onChange={(e) => setLeadFormForm({ ...leadFormForm, name: e.target.value })} /></label>
              <label className="block text-sm">{t("campaignBuilder.lfPageLabel")}<input className="input" value={leadFormForm.pageId} onChange={(e) => setLeadFormForm({ ...leadFormForm, pageId: e.target.value })} /></label>
              <label className="block text-sm">{t("campaignBuilder.lfIntroHeadlineLabel")}<input className="input" value={leadFormForm.introHeadline} onChange={(e) => setLeadFormForm({ ...leadFormForm, introHeadline: e.target.value })} /></label>
              <label className="block text-sm">{t("campaignBuilder.lfPrivacyLabel")}<input className="input" value={leadFormForm.privacyPolicyUrl} onChange={(e) => setLeadFormForm({ ...leadFormForm, privacyPolicyUrl: e.target.value })} placeholder="https://example.com/privacy" /></label>
              <label className="block text-sm">{t("campaignBuilder.lfThankYouLabel")}<input className="input" value={leadFormForm.thankYouTitle} onChange={(e) => setLeadFormForm({ ...leadFormForm, thankYouTitle: e.target.value })} placeholder={t("campaignBuilder.lfThankYouPlaceholder")} /></label>
              <label className="block text-sm">{t("campaignBuilder.lfFollowUpLabel")}<input className="input" value={leadFormForm.followUpActionUrl} onChange={(e) => setLeadFormForm({ ...leadFormForm, followUpActionUrl: e.target.value })} /></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={leadFormForm.higherIntent} onChange={(e) => setLeadFormForm({ ...leadFormForm, higherIntent: e.target.checked })} />{t("campaignBuilder.lfHigherIntentLabel")}</label>
            </div>
            <label className="block text-sm">{t("campaignBuilder.lfQuestionsFieldLabel")}<span className="text-xs text-slate-400">{t("campaignBuilder.lfQuestionsHint")}</span>
              <textarea className="input font-mono text-xs" rows={4} value={leadFormForm.questionsText} onChange={(e) => setLeadFormForm({ ...leadFormForm, questionsText: e.target.value })} />
            </label>
            <label className="block text-sm">{t("campaignBuilder.lfMappingLabel")}<span className="text-xs text-slate-400">{t("campaignBuilder.lfMappingHint", { custom: customFields.length ? t("campaignBuilder.lfMappingCustom", { fields: customFields.map((c) => c.key).join(", ") }) : "" })}</span>
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
              if (res) { setNotice(t("campaignBuilder.lfCreatedNotice")); setLeadFormForm(emptyLeadForm); await reloadLeadForms(); }
            }}>{t("campaignBuilder.lfCreateBtn")}</button>
          </div>
        ) : null}
      </div>

      <div className={`card space-y-3 p-5 ${activeStep !== 1 ? "hidden" : ""}`}>
        <div className="font-semibold">{t("campaignBuilder.rtTitle")}<span className="text-xs font-normal text-slate-400">{t("campaignBuilder.rtTitleNote")}</span></div>
        <p className="text-xs text-slate-500">{t("campaignBuilder.rtIntro")}</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-sm">{t("campaignBuilder.rtKindLabel")}
            <select className="input" value={preset.kind} onChange={(e) => setPreset({ ...preset, kind: e.target.value })}>
              <option value="product_viewers">Product Viewers</option>
              <option value="add_to_cart">{t("campaignBuilder.rtCartSuffix")}</option>
            </select>
          </label>
          <label className="block text-sm">{t("campaignBuilder.rtAudienceLabel")}
            <select className="input w-64" value={preset.audienceRecordId} onChange={(e) => setPreset({ ...preset, audienceRecordId: e.target.value })}>
              <option value="">{t("campaignBuilder.rtAutoOption")}</option>
              {audList.filter((a) => a.externalAudienceId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="block text-sm">{t("campaignBuilder.rtNameLabel")}<input className="input" value={preset.name} onChange={(e) => setPreset({ ...preset, name: e.target.value })} /></label>
          <button className="btn-primary btn-sm" disabled={busy !== "" || !editable} onClick={async () => {
            const res = await wrap("preset", () => apiFetch<NonNullable<typeof presetResult>>(`/organizations/${orgId}/campaign-plans/${plan.id}/retargeting-preset`, { method: "POST", body: JSON.stringify({ kind: preset.kind, audienceRecordId: preset.audienceRecordId || undefined, name: preset.name || undefined, pixelId: plan.adSets[0]?.pixelId || undefined }) }));
            if (res) {
              setPresetResult(res);
              if (res.status === "created") { setNotice(t("campaignBuilder.rtCreatedNotice")); await loadPlan(plan.id); }
            }
          }}>{t("campaignBuilder.rtApplyBtn")}</button>
        </div>
        {presetResult?.status === "missing" ? <p className="text-sm text-amber-600">{t("campaignBuilder.rtMissing", { items: (presetResult.missing ?? []).join(" · ") })}</p> : null}
        {presetResult?.status === "needs_choice" ? (
          <div className="text-sm">
            <p className="text-slate-600">{t("campaignBuilder.rtNeedsChoice")}</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {(presetResult.candidates ?? []).map((c) => <button key={c.id} className="btn-secondary btn-sm" onClick={() => setPreset({ ...preset, audienceRecordId: c.id })}>{c.name}</button>)}
            </div>
            {(presetResult.missing ?? []).length ? <p className="mt-1 text-xs text-slate-500">{(presetResult.missing ?? []).join(" · ")}</p> : null}
          </div>
        ) : null}
        {presetResult?.status === "created" && (presetResult.missing ?? []).length ? <p className="text-sm text-slate-500">{t("campaignBuilder.rtCreatedNote", { items: (presetResult.missing ?? []).join(" · ") })}</p> : null}
      </div>

      <div id="cbx-step-review" tabIndex={-1} className={`r2-step-enter card space-y-3 p-5 ${activeStep !== 4 ? "hidden" : ""}`}>
        <div className="flex items-center justify-between">
          <div className="font-semibold">{t("campaignBuilder.cmTitle")}<span className="text-xs font-normal text-slate-400">{t("campaignBuilder.cmTitleNote")}</span></div>
          <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
            const [cmts, tl] = await Promise.all([
              apiFetch<NonNullable<typeof comments>>(`/organizations/${orgId}/campaign-plans/${plan.id}/comments`).catch(() => []),
              apiFetch<NonNullable<typeof timeline>>(`/organizations/${orgId}/campaign-plans/${plan.id}/timeline`).catch(() => []),
            ]);
            setComments(cmts); setTimeline(tl);
          }}>{t("campaignBuilder.cmLoadBtn")}</button>
        </div>
        {comments === null ? <p className="text-sm text-slate-400">{t("campaignBuilder.cmNotLoaded")}</p> : (
          <>
            <div className="space-y-2">
              {comments.length === 0 ? <p className="text-sm text-slate-400">{t("campaignBuilder.cmNone")}</p> : comments.map((c) => (
                <div key={c.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                  <span className="font-semibold">{c.authorName}</span> <span className="text-xs text-slate-400">{fmtDateTime(locale, c.createdAt)}</span>
                  <p className="mt-0.5 whitespace-pre-wrap">{mentionSegments(c.body, (c.mentions ?? []).map((m) => m.name)).map((seg, si) => seg.mention ? <span key={si} className="cbx-mention">{seg.text}</span> : <React.Fragment key={si}>{seg.text}</React.Fragment>)}</p>
                </div>
              ))}
            </div>
            {members.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-600">{t("campaignBuilder.cmMentionLabel")}</span>
                <select className="input w-56" id="plan-mention-picker" defaultValue="" onChange={(e) => {
                  const m = members.find((x) => x.user.id === e.target.value);
                  const el = document.getElementById("plan-comment") as HTMLInputElement | null;
                  if (m && el) { el.value = `${el.value}${el.value && !el.value.endsWith(" ") ? " " : ""}@${m.user.name} `; el.focus(); }
                  e.target.value = "";
                }}>
                  <option value="">{t("campaignBuilder.cmMemberChoose")}</option>
                  {members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.name} ({m.role})</option>)}
                </select>
                <span className="text-xs text-slate-400">{t("campaignBuilder.cmMentionNote")}</span>
              </div>
            ) : null}
            <div className="flex gap-2">
              <input className="input flex-1" id="plan-comment" placeholder={t("campaignBuilder.cmPlaceholder")} maxLength={2000} />
              <button className="btn-primary btn-sm" disabled={busy !== ""} onClick={async () => {
                const v = (document.getElementById("plan-comment") as HTMLInputElement)?.value ?? "";
                if (!v.trim()) { setError(t("campaignBuilder.cmErrEmpty")); return; }
                const res = await wrap("comment", () => apiFetch(`/organizations/${orgId}/campaign-plans/${plan.id}/comments`, { method: "POST", body: JSON.stringify({ body: v }) }));
                if (res) {
                  (document.getElementById("plan-comment") as HTMLInputElement).value = "";
                  const c = await apiFetch<NonNullable<typeof comments>>(`/organizations/${orgId}/campaign-plans/${plan.id}/comments`).catch(() => comments);
                  setComments(c); setNotice(t("campaignBuilder.cmAddedNotice"));
                }
              }}>{t("campaignBuilder.cmPostBtn")}</button>
            </div>
            {timeline && timeline.length > 0 ? (
              <div className="border-t pt-2">
                <div className="text-sm font-semibold">{t("campaignBuilder.cmHistoryTitle")}</div>
                <div className="mt-1 space-y-1">
                  {timeline.slice(0, 20).map((e, i) => (
                    <div key={i} className="flex items-baseline justify-between gap-2 text-xs">
                      <span><span className="font-medium">{e.title}</span>{e.detail ? <span className="text-slate-500"> — {e.detail}</span> : null}</span>
                      <span className="shrink-0 text-slate-400">{fmtDateTime(locale, e.at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>


      <div className={`card space-y-3 p-5 ${activeStep !== 4 ? "hidden" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">{t("campaignBuilder.vrTitle")}<span className="text-xs font-normal text-slate-400">{t("campaignBuilder.vrTitleNote")}</span></div>
          <span className="flex gap-2">
            <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
              const res = await wrap("versions", () => apiFetch<NonNullable<typeof versions>>(`/organizations/${orgId}/campaign-plans/${plan.id}/versions`));
              if (res) setVersions(res);
            }}>{t("campaignBuilder.vrLoadBtn")}</button>
            <button className="btn-primary btn-sm" disabled={busy !== ""} onClick={async () => {
              const res = await wrap("snapshot", () => apiFetch(`/organizations/${orgId}/campaign-plans/${plan.id}/versions`, { method: "POST", body: JSON.stringify({}) }));
              if (res) {
                setNotice(t("campaignBuilder.vrSnapshotNotice"));
                const list = await apiFetch<NonNullable<typeof versions>>(`/organizations/${orgId}/campaign-plans/${plan.id}/versions`).catch(() => null);
                if (list) setVersions(list);
              }
            }}>{t("campaignBuilder.vrSnapshotBtn")}</button>
          </span>
        </div>
        {busy === "versions" || busy === "snapshot" ? <div className="space-y-2"><div className="cbx-skel" style={{ height: 18 }} /><div className="cbx-skel" style={{ height: 18 }} /></div> : null}
        {versions === null ? <p className="text-sm text-slate-400">{t("campaignBuilder.vrNotLoaded")}</p> : versions.length === 0 ? (
          <div className="cbx-empty"><p className="cbx-empty-title">{t("campaignBuilder.vrEmptyTitle")}</p><p className="cbx-empty-text">{t("campaignBuilder.vrEmptyText")}</p></div>
        ) : (
          <div className="space-y-2">
            {versions.map((v) => (
              <div key={v.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{v.kind === "submit" ? "Submit Snapshot" : v.kind === "manual" ? t("campaignBuilder.vrManualKind") : v.kind} <span className="text-xs text-slate-400">· {fmtDateTime(locale, v.createdAt)}</span></span>
                  <span className="flex gap-1">
                    <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                      const res = await wrap(`vdiff-${v.id}`, () => apiFetch<{ differs: boolean; summary: NonNullable<typeof versionDiffs>[string]["summary"] }>(`/organizations/${orgId}/campaign-plans/${plan.id}/versions/${v.id}/diff`));
                      if (res) setVersionDiffs((s) => ({ ...s, [v.id]: res }));
                    }}>{t("campaignBuilder.vrDiffBtn")}</button>
                    <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                      if (!window.confirm(t("campaignBuilder.vrRestoreConfirm"))) return;
                      const res = await wrap(`vrestore-${v.id}`, () => apiFetch<Plan>(`/organizations/${orgId}/campaign-plans/${plan.id}/versions/${v.id}/restore`, { method: "POST", body: JSON.stringify({}) }));
                      if (res) { setPlan(res); setVersions(null); setNotice(t("campaignBuilder.vrRestoredNotice", { name: res.name })); window.scrollTo({ top: 0 }); }
                    }}>{t("campaignBuilder.vrRestoreBtn")}</button>
                  </span>
                </div>
                {versionDiffs[v.id] ? (
                  <p className="mt-1 text-xs text-slate-600">{versionDiffs[v.id].differs ? <>{t("campaignBuilder.vrDiffLine", { asAdded: fmtNumBn(versionDiffs[v.id].summary.adSetsAdded), asRemoved: fmtNumBn(versionDiffs[v.id].summary.adSetsRemoved), asChanged: fmtNumBn(versionDiffs[v.id].summary.adSetsChanged), adAdded: fmtNumBn(versionDiffs[v.id].summary.adsAdded), adRemoved: fmtNumBn(versionDiffs[v.id].summary.adsRemoved), adChanged: fmtNumBn(versionDiffs[v.id].summary.adsChanged), top: versionDiffs[v.id].summary.topLevelChanged.length ? t("campaignBuilder.vrDiffTopPart", { items: versionDiffs[v.id].summary.topLevelChanged.join(", ") }) : "" })}</> : t("campaignBuilder.vrDiffNone")}</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      </div>
      <aside className="cbx-rail mt-6 space-y-4 lg:mt-0">
        <div>
          <p className="cbx-rail-title">{t("campaignBuilder.rlSummaryTitle")}</p>
          <div className="mt-2 space-y-1 rounded-xl border bg-white p-3 text-sm leading-[1.7]">
            <p className="font-semibold">{plan.name}</p>
            <p className="text-xs text-slate-500">{plan.objective} · {t("campaignBuilder.rlStatusPart")}<span className="font-semibold">{statusLabel(plan.status)}</span></p>
            <p className="text-xs text-slate-600">{t("campaignBuilder.rlTotalDaily")}<span className="font-semibold">{readiness?.budget ? fmtMoneyBn(readiness.budget.dailyTotalMinor) : fmtMoneyBn(plan.adSets.reduce((a, s) => a + BigInt(s.dailyBudgetMinor ?? "0"), 0n))}</span>{t("campaignBuilder.rlLifetimeTotal")}{readiness?.budget ? fmtMoneyBn(readiness.budget.lifetimeTotalMinor) : fmtMoneyBn(plan.adSets.reduce((a, s) => a + BigInt(s.lifetimeBudgetMinor ?? "0"), 0n))}</p>
            <p className="text-xs text-slate-600">{t("campaignBuilder.rlBudgetMode")}<span className="font-semibold">{plan.advantagePlus ? t("campaignBuilder.rlModeAdvantage") : plan.budgetMode === "cbo" ? t("campaignBuilder.rlModeCbo") : t("campaignBuilder.rlModeAbo")}</span>{plan.budgetMode === "cbo" || plan.advantagePlus ? <>{t("campaignBuilder.rlCampaignDailyPart", { amount: plan.campaignDailyBudgetMinor ? fmtMoneyBn(plan.campaignDailyBudgetMinor) : "—" })}</> : null}</p>
            {pacing ? <p className="text-xs text-slate-600">{t("campaignBuilder.rlPacing", { spent: fmtMoneyBn(pacing.spentMinor), expected: pacing.expectedMinor != null ? fmtMoneyBn(pacing.expectedMinor) : "—", variance: pacing.varianceMinor != null ? fmtMoneyBn(pacing.varianceMinor) : "—" })}</p> : null}
            {readiness ? <p className="text-xs text-slate-600">{t("campaignBuilder.rlReadinessSummary", { errors: fmtNumBn(readinessCounts(readiness.checks).errors), warnings: fmtNumBn(readinessCounts(readiness.checks).warnings), oks: fmtNumBn(readinessCounts(readiness.checks).oks) })}</p> : null}
            {renderSaveIndicator()}
          </div>
        </div>
        <div>
          <p className="cbx-rail-title">{t("campaignBuilder.rlReadinessPreviewTitle")}</p>
          {busy === "ready" ? <div className="mt-2 space-y-2"><div className="cbx-skel" style={{ height: 18 }} /><div className="cbx-skel" style={{ height: 18 }} /><div className="cbx-skel" style={{ height: 18 }} /></div> : null}
          {readiness ? (
            <div className={`mt-2 space-y-1 rounded-xl border p-3 text-sm ${readiness.ready ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
              <p className="font-semibold">{readiness.ready ? t("campaignBuilder.rlReadyOk") : t("campaignBuilder.rlReadyIssues")}</p>
              {readiness.checks.map((c, i) => (
                <div key={i} className="text-xs">
                  <span className={c.level === "error" ? "font-semibold text-red-700" : c.level === "warn" ? "font-semibold text-amber-700" : "font-semibold text-emerald-700"}>{c.level === "error" ? "⛔" : c.level === "warn" ? "⚠" : "✓"} {c.label}:</span>{" "}
                  <span className="text-slate-600">{c.detail}</span>
                </div>
              ))}
              {readiness.estimate.available ? (
                <p className="text-xs text-slate-500">{t("campaignBuilder.rlReachLine", { lower: fmtNumBn(readiness.estimate.lowerBound), upper: fmtNumBn(readiness.estimate.upperBound) })}</p>
              ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs leading-[1.7] text-slate-600">
                  <p>{t("campaignBuilder.rlReachUnavailable", { reason: readiness.estimate.reason ?? "" })}</p>
                  <p>{t("campaignBuilder.rlReachNextStep")}</p>
                </div>
              )}
              {readiness.estimates && readiness.estimates.length > 1 ? (
                <div className="space-y-0.5">
                  {readiness.estimates.map((e) => (
                    <p key={e.adSetId} className="text-xs text-slate-500">{t("campaignBuilder.rlReachPerSet", { name: e.name, value: e.available ? t("campaignBuilder.rlReachPerSetValue", { lower: fmtNumBn(e.lowerBound), upper: fmtNumBn(e.upperBound) }) : t("campaignBuilder.rlReachPerSetUnavailable", { reason: e.reason ?? "" }) })}</p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {!readiness && busy !== "ready" ? <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs leading-[1.7] text-slate-500"><p>{t("campaignBuilder.rlReadinessNotRun")}</p></div> : null}
          {(() => { const ad = previewAdId ? plan.adSets.flatMap((s) => s.ads).find((a) => a.id === previewAdId) : null; const firstAd = ad ?? plan.adSets.flatMap((s) => s.ads)[0] ?? null; return (<>
            {ad ? <div className="mt-2 overflow-x-auto"><AdPreview ad={ad} pageName={plan.name} /></div> : <p className="mt-2 text-xs text-slate-500">{t("campaignBuilder.rlPreviewHint")}</p>}
            {!ad && firstAd ? <div className="mt-2 overflow-x-auto"><AdPreview ad={firstAd} pageName={plan.name} /></div> : null}
          </>); })()}
        </div>
        <div className="border-t pt-3">
          <p className="cbx-rail-title">{t("campaignBuilder.rlApprovalTitle")}</p>
          {twoStep === null ? <p className="mt-1 text-xs text-slate-500">{t("campaignBuilder.rlApprovalNotLoaded")}</p> : myRole === "OWNER" || myRole === "ADMIN" ? (
            <label className="mt-2 flex min-h-[44px] cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={twoStep} onChange={async (e) => {
                const next = e.target.checked;
                const res = await wrap("chain", () => apiFetch<{ twoStepApproval: boolean }>(`/organizations/${orgId}/campaign-plans/settings/approval-chain`, { method: "PATCH", body: JSON.stringify({ twoStepApproval: next }) }));
                if (res) { setTwoStep(res.twoStepApproval); noteSaved(); setNotice(res.twoStepApproval ? t("campaignBuilder.rlTwoStepOnNotice") : t("campaignBuilder.rlTwoStepOffNotice")); }
              }} />
              <span>{t("campaignBuilder.rlTwoStepLabel")}{twoStep ? t("campaignBuilder.rlOnState") : t("campaignBuilder.rlOffState")}</span>
            </label>
          ) : <p className="mt-1 text-xs text-slate-600">{t("campaignBuilder.rlTwoStepView", { state: twoStep ? t("campaignBuilder.rlOnState") : t("campaignBuilder.rlOffState") })}</p>}
          {plan.status === "pending_approval" && plan.firstApproverId ? <p className="mt-1 text-xs font-semibold text-amber-700">{t("campaignBuilder.rlFirstApprovalDone")}</p> : null}
        </div>
        {/* CA13: org naming template — stored on the org's
            BusinessProfile (Organization Settings surface);
            edited here next to the approval-chain setting. */}
        <div>
          <p className="cbx-rail-title">{t("campaignBuilder.rlNamingTitle")}</p>
          <div className="mt-2 rounded-xl border bg-white p-3 text-sm">
            {namingTpl === null ? <p className="text-xs text-slate-500">{t("campaignBuilder.rlNamingNotLoaded")}</p> : (
              <>
                <input className={inputCls} value={namingDraft} onChange={(e) => setNamingDraft(e.target.value)} placeholder="{product} - {audience} - {date}" maxLength={200} />
                <div className="mt-1 flex flex-wrap gap-1">
                  {(namingTpl.tokens ?? ["product", "audience", "objective", "date", "platform"]).map((t) => (
                    <button key={t} type="button" className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-mono" onClick={() => setNamingDraft((d) => `${d}{${t}}`)}>{`{${t}}`}</button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-600">{t("campaignBuilder.rlNamingPreviewLabel")}<b>{renderNamingPreview(namingDraft) || "—"}</b> <span className="text-slate-400">{t("campaignBuilder.rlNamingPreviewNote")}</span></p>
                <p className="mt-1 text-xs text-slate-500">{t("campaignBuilder.rlNamingNote")}</p>
                <div className="mt-2 flex gap-2">
                  <button className="btn-primary btn-sm" disabled={busy !== ""} onClick={async () => {
                    const res = await wrap("naming-save", () => apiFetch<NonNullable<typeof namingTpl>>(`/organizations/${orgId}/campaign-plans/settings/naming-template`, { method: "PATCH", body: JSON.stringify({ template: namingDraft.trim() === "" ? null : namingDraft }) }));
                    if (res) { setNamingTpl(res); setNamingDraft(res.template ?? ""); setNotice(res.template ? t("campaignBuilder.rlNamingSaved") : t("campaignBuilder.rlNamingRemoved")); }
                  }}>{t("campaignBuilder.rlSaveBtn")}</button>
                  {namingTpl.template ? <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                    const res = await wrap("naming-clear", () => apiFetch<NonNullable<typeof namingTpl>>(`/organizations/${orgId}/campaign-plans/settings/naming-template`, { method: "PATCH", body: JSON.stringify({ template: null }) }));
                    if (res) { setNamingTpl(res); setNamingDraft(""); setNotice(t("campaignBuilder.rlNamingRemoved")); }
                  }}>{t("campaignBuilder.rlRemoveBtn")}</button> : null}
                </div>
              </>
            )}
          </div>
        </div>
        {/* CA17: plan-level UTM template — applied by every
            publish path (Meta url_tags + tagged link, Google
            Final URL Suffix, TikTok landing URL). Empty =
            built-in defaults shown as samples below. */}
        <div>
          <p className="cbx-rail-title">{t("campaignBuilder.rlUtmTitle")}</p>
          <div className="mt-2 rounded-xl border bg-white p-3 text-sm">
            {utmTpl === null ? <p className="text-xs text-slate-500">{t("campaignBuilder.rlUtmNotLoaded")}</p> : (
              <>
                {(utmTpl.keys ?? ["source", "medium", "campaign", "content", "term"]).map((k) => (
                  <label key={k} className="mt-1 block text-xs text-slate-600">utm_{k}
                    <input className={inputCls} value={utmDraft[k] ?? ""} onChange={(e) => setUtmDraft((d) => ({ ...d, [k]: e.target.value }))} placeholder={k === "source" ? "{platform}" : k === "medium" ? "cpc" : k === "campaign" ? "{campaign}" : k === "content" ? "{adset}" : "{ad}"} maxLength={120} />
                  </label>
                ))}
                <p className="mt-1 text-[11px] text-slate-500">{t("campaignBuilder.rlUtmNote", { tokens: "{platform} {campaign} {adset} {ad}" })}</p>
                <p className="mt-1 break-all text-[11px] text-slate-600">{t("campaignBuilder.rlUtmSampleMeta")}<span className="font-mono">{utmTpl.samples.meta || "—"}</span><br />{t("campaignBuilder.rlUtmSampleGoogle")}<span className="font-mono">{utmTpl.samples.google || "—"}</span></p>
                <div className="mt-2 flex gap-2">
                  <button className="btn-primary btn-sm" disabled={busy !== ""} onClick={async () => {
                    const template: Record<string, string> = {};
                    for (const [k, v] of Object.entries(utmDraft)) if (v.trim()) template[k] = v.trim();
                    const res = await wrap("utm-save", () => apiFetch<NonNullable<typeof utmTpl>>(`/organizations/${orgId}/campaign-plans/${plan.id}/utm-template`, { method: "POST", body: JSON.stringify({ template: Object.keys(template).length ? template : null }) }));
                    if (res) { setUtmTpl(res); setUtmDraft(res.template ?? {}); setNotice(Object.keys(template).length ? t("campaignBuilder.rlUtmSaved") : t("campaignBuilder.rlUtmRemoved")); }
                  }}>{t("campaignBuilder.rlSaveBtn")}</button>
                  {utmTpl.template ? <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                    const res = await wrap("utm-clear", () => apiFetch<NonNullable<typeof utmTpl>>(`/organizations/${orgId}/campaign-plans/${plan.id}/utm-template`, { method: "POST", body: JSON.stringify({ template: null }) }));
                    if (res) { setUtmTpl(res); setUtmDraft({}); setNotice(t("campaignBuilder.rlUtmRemoved")); }
                  }}>{t("campaignBuilder.rlUtmDefaultBtn")}</button> : null}
                </div>
              </>
            )}
          </div>
        </div>
      </aside>
      </div>
      {stepNavButtons}
      </div>
      </div>

      <div className="cbx-mobile-bar">
        <span className={`cbx-pill cbx-pill-${plan.status}`}>{statusLabel(plan.status)}</span>
        {editable ? <button type="button" className="btn-primary btn-sm flex-1" disabled={busy !== ""} onClick={() => action("submit", "submit")}>{t("campaignBuilder.abSubmitBtn")}</button> : null}
        {plan.status === "pending_approval" ? <><button type="button" className="btn-success btn-sm flex-1" disabled={busy !== ""} onClick={() => action("approve", "approve")}>{t("campaignBuilder.abApproveBtn")}</button><button type="button" className="rounded-lg border px-3 py-2 text-sm font-semibold text-red-600" onClick={rejectPlan}>{t("campaignBuilder.abRejectBtn")}</button></> : null}
        {(plan.status === "approved" || plan.status === "publish_failed") ? <button type="button" className="btn-primary btn-sm flex-1" disabled={busy !== ""} onClick={() => action("publish", "publish")}>{busy === "publish" ? t("campaignBuilder.abPublishing") : plan.status === "publish_failed" ? t("campaignBuilder.abPublishResume") : t("campaignBuilder.abPublishBtn")}</button> : null}
        {plan.status === "published" && plan.metaStatus !== "ACTIVE" ? <button type="button" className="btn-success btn-sm flex-1" disabled={busy !== ""} onClick={() => action("activate", "activate")}>{t("campaignBuilder.abActivateBtn")}</button> : null}
        {plan.status === "published" && plan.metaStatus === "ACTIVE" ? <button type="button" className="btn-warning btn-sm flex-1" disabled={busy !== ""} onClick={() => action("pause", "pause")}>{t("campaignBuilder.abPauseBtn")}</button> : null}
      </div>
      {plan.publishLogs.length > 0 ? (
        <div className={`card p-5 ${activeStep !== 4 ? "hidden" : ""}`}>
          <div className="font-semibold">{t("campaignBuilder.plTitle")}</div>
          <div className="mt-2 space-y-1">
            {plan.publishLogs.map((l) => (
              <div key={l.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
                <span><span className="font-medium capitalize">{l.step}</span> · {fmtDateTime(locale, l.createdAt)}</span>
                <span className={l.status === "success" ? "text-green-600" : "text-red-600"}>{l.status}{l.externalId ? ` · ${l.externalId}` : ""}{l.error ? ` · ${l.error}` : ""}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
