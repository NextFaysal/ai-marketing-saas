"use client";
import React, { useEffect, useState } from "react";
import { API_URL, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import type { SocialApprovalStatus, SocialInsightsSummary, Sp7SocialPost } from "@/lib/social-post-insights";
import type { RecurrenceFrequency, VariantOverride } from "@/lib/social-composer";
import type { MediaAspect } from "@/lib/social-media-library";
import type { SocialAccountsInsights, SocialContentTypes, SocialFollowers, SocialTimeseries } from "@/lib/social-analytics";
import type { AutoDraftSettingsForm, SocialLinkStats } from "@/lib/social-posts-su5";
import { healthPill, type CsvImportResponse } from "@/lib/social-posts-su11";
import type { MediaQueryFilters } from "@/lib/social-media-library";
import type { MonthCell } from "@/lib/social-calendar";
import type { TimeseriesBar } from "@/lib/social-analytics";

// ---------------------------------------------------------------------------
// SP2 contract types (docs/social-posts-package-plan.md, SP1 API contract).
// ---------------------------------------------------------------------------

export interface SocialAccount {
  id: string;
  platform: "meta_page" | "instagram" | "tiktok" | "youtube";
  externalId: string;
  name: string;
  username?: string | null;
  pictureUrl?: string | null;
  status: "connected" | "disconnected" | "error";
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DiscoveredPage {
  pageId: string;
  name: string;
  pictureUrl?: string | null;
  instagram: { externalId: string; username?: string | null; pictureUrl?: string | null } | null;
  alreadyConnectedPage: boolean;
  alreadyConnectedInstagram: boolean;
}

export interface MediaAsset {
  id: string;
  kind: "image" | "video";
  name: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  publicUrl?: string | null;
  origin?: string;
  prompt?: string | null;
  derivedFromId?: string | null;
  sourceUrl?: string | null;
  // SU3: Media Library v2 — folder + tags (folderId "none"-filtered
  // server-side; null here means folderless).
  folderId?: string | null;
  tags?: string[];
}

// SU3 contract types (Media Library v2).
export interface MediaFolder {
  id: string;
  name: string;
  assetCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MediaUsage {
  assetId: string;
  count: number;
  posts: { id: string; status: string; caption: string; socialAccountId: string; createdAt: string }[];
}

// SU4 contract types (own-data hashtags, content plan, script).
export interface HashtagInsight {
  tags: { tag: string; posts: number; totalEngagement: number; avgEngagement: number }[];
  postsConsidered: number;
}

export interface ContentPlanItem {
  day: number;
  pillar: string;
  productId?: string | null;
  productName?: string | null;
  caption: string;
  mediaIdea: string;
  materializedPostId?: string | null;
}

export interface ContentPlan {
  id: string;
  month: string;
  pillars: string[];
  items: ContentPlanItem[];
  status: string;
  createdAt: string;
}

export interface AiScriptResult {
  hook: string;
  onScreenText: string[];
  shotList: string[];
  captionDraft: string;
  provider: string;
}

// SP3 contract types (AI copy + hashtag sets).
export interface AiProductOption {
  id: string;
  name: string;
}

export interface AiPolicyFinding {
  rule: string;
  severity: string;
  snippet: string;
  explanation: string;
  suggestion: string;
}

export interface AiCopyVariant {
  caption: string;
  policy: { status: string; findings: AiPolicyFinding[] };
}

export interface AiCopyResponse {
  provider: string;
  isRealLlm: boolean;
  product: { id: string; name: string; price: string; currency: string } | null;
  variants: AiCopyVariant[];
  hashtags: string[];
  notice?: string;
}

export interface HashtagSet {
  id: string;
  name: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** A media item attached to the composer: the MediaStore ref plus a
 * display name (post mediaRefs carry no name, so edit mode falls
 * back to a generic label). */
export interface SelectedMedia {
  assetId: string;
  kind: "image" | "video";
  name?: string;
}

export const MAX_MEDIA = 10;

export const PLATFORM_LABELS: Record<string, string> = {
  meta_page: "Facebook Page",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
};

/** SP8/SP9: operator-app platform modes (booleans only, from
 * GET social/platform-modes) — drives the connect buttons' honest
 * availability and the TikTok card's mode label. */
export interface PlatformModes {
  tiktok: { configured: boolean; audited: boolean };
  youtube: { configured: boolean };
}

// SU2 contract: per-account weekly posting slots (org timezone).
export interface SocialPostingSlot {
  id: string;
  socialAccountId: string;
  weekday: number; // 0 = রবিবার
  time: string; // "HH:mm"
  enabled: boolean;
}

// SU8 contract (Batch 4): POST posts/:id/derive response.
export interface DeriveWarning {
  accountId: string;
  message: string;
}

export interface DeriveResult {
  created: Sp7SocialPost[];
  warnings: DeriveWarning[];
}

export interface EvergreenFormState {
  isEvergreen: boolean;
  minGapDays: string;
  maxCycles: string;
}

export const ACCOUNT_STATUS_META: Record<string, { label: string; cls: string }> = {
  connected: { label: "সংযুক্ত", cls: "bg-green-100 text-green-700" },
  disconnected: { label: "বিচ্ছিন্ন", cls: "bg-slate-200 text-red-600" },
  error: { label: "ত্রুটি", cls: "bg-red-100 text-red-700" },
};

export const POST_STATUS_META: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft (খসড়া)", cls: "bg-slate-200 text-slate-700" },
  scheduled: { label: "শিডিউল করা", cls: "bg-sky-100 text-sky-700" },
  publishing: { label: "পাবলিশ হচ্ছে", cls: "bg-amber-100 text-amber-700" },
  published: { label: "প্রকাশিত", cls: "bg-green-100 text-green-700" },
  failed: { label: "ব্যর্থ", cls: "bg-red-100 text-red-700" },
  cancelled: { label: "বাতিল", cls: "bg-slate-200 text-slate-500" },
  sent_to_creator: { label: "Creator-এর কাছে পাঠানো হয়েছে", cls: "bg-violet-100 text-violet-700" },
};

// SP7 approval-status badges.
export const APPROVAL_STATUS_META: Record<SocialApprovalStatus, { label: string; cls: string }> = {
  pending: { label: "⏳ অনুমোদনের অপেক্ষায়", cls: "bg-amber-100 text-amber-700" },
  approved: { label: "✅ অনুমোদিত", cls: "bg-green-100 text-green-700" },
  rejected: { label: "❌ প্রত্যাখ্যাত", cls: "bg-red-100 text-red-700" },
  // SU9 two-step: step 1 done, final (Owner) approval still due.
  manager_approved: { label: "🧭 Manager ধাপে অনুমোদিত — চূড়ান্ত অনুমোদনের অপেক্ষায়", cls: "bg-sky-100 text-sky-700" },
};

// ---------------------------------------------------------------------------
// SD1: the ONE pill shape for the whole page. Labels and colours still
// come from the META records / lib helpers above — these components only
// standardise the shape (rounded-full, 12px) so every panel renders a
// status the same way. Presentation only; no new mapping is invented.
// ---------------------------------------------------------------------------

const SOC_PILL_BASE = "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold";

export function PostStatusPill({ status }: { status: string }) {
  const meta = POST_STATUS_META[status];
  return <span className={`${SOC_PILL_BASE} ${meta?.cls ?? "bg-slate-100 text-slate-600"}`}>{meta?.label ?? status}</span>;
}

export function ApprovalStatusPill({ status }: { status: SocialApprovalStatus }) {
  const meta = APPROVAL_STATUS_META[status];
  if (!meta) return null;
  return <span className={`${SOC_PILL_BASE} ${meta.cls}`}>{meta.label}</span>;
}

export function AccountStatusPill({ status }: { status: string }) {
  const meta = ACCOUNT_STATUS_META[status];
  return <span className={`${SOC_PILL_BASE} ${meta?.cls ?? "bg-slate-100 text-slate-600"}`}>{meta?.label ?? status}</span>;
}

export function HealthPill({ health }: { health: string | null | undefined }) {
  const pill = healthPill(health);
  return <span className={`${SOC_PILL_BASE} ${pill.cls}`}>{pill.label}</span>;
}

/** SD1: platform identity dot — the platform's own identity colour. */
export function PlatformDot({ platform, className }: { platform: string; className?: string }) {
  return <span aria-hidden="true" className={`soc-dot soc-dot-${platform} ${className ?? ""}`} />;
}

/**
 * SD1: account avatar — the account's picture when the platform gave
 * one, otherwise initials on the brand gradient — with the platform
 * dot pinned to the corner. Same component in every panel.
 */
export function AccountAvatar({ name, pictureUrl, platform, size }: { name: string; pictureUrl?: string | null; platform: string; size?: "lg" }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase() || "?";
  const avatarCls = size === "lg" ? "soc-avatar soc-avatar-lg" : "soc-avatar";
  return (
    <span className="relative inline-flex shrink-0">
      {pictureUrl ? (
        <span className={avatarCls}><img src={pictureUrl} alt="" className="soc-avatar-img" /></span>
      ) : (
        <span className={avatarCls}>{initials}</span>
      )}
      <PlatformDot platform={platform} className="soc-dot-on-avatar" />
    </span>
  );
}

/**
 * Authenticated media thumbnail — the inbox MediaView pattern,
 * mirrored exactly: the file bytes are protected, so they are
 * fetched through the API proxy with the app's Bearer token and
 * rendered from a blob object URL (revoked on unmount). A plain
 * <img src="…/file"> would 401, which is why the inbox does it
 * this way too.
 */
export function MediaThumb({ assetId, kind, className }: { assetId: string; kind: "image" | "video"; className?: string }) {
  const orgId = getOrganizationId();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/organizations/${orgId}/social/media/${assetId}/file`, {
          headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        });
        if (!res.ok) throw new Error("media");
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setUrl(objectUrl);
      } catch { if (!cancelled) setFailed(true); }
    })();
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [orgId, assetId]);

  const cls = className ?? "h-16 w-16 rounded-lg object-cover";
  if (failed) return <span className={`flex items-center justify-center bg-slate-100 text-xs text-slate-400 ${className ?? "h-16 w-16 rounded-lg"}`}>লোড হয়নি</span>;
  if (!url) return <span className={`soc-skeleton flex items-center justify-center text-xs text-slate-400 ${className ?? "h-16 w-16 rounded-lg"}`}>লোড হচ্ছে…</span>;
  if (kind === "video") return <video src={url} className={cls} muted preload="metadata" />;
  return <img src={url} alt="" className={cls} />;
}

/** PP2: human MB for the upload-cap hint (Bengali digits). */
export function formatMb(bytes: number): string {
  const mb = bytes / 1_000_000;
  const num = Number.isInteger(mb) ? String(mb) : mb.toFixed(1);
  return `${num.replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)])} MB`;
}



// SU9/SU10 web contract types (API response shapes).
export interface OrgMemberOption {
  id: string;
  role: string;
  user: { id: string; name?: string | null; email: string };
}

export interface SocialPostNote {
  id: string;
  socialPostId: string;
  authorId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface SocialPostVersion {
  id: string;
  socialPostId: string;
  versionNo: number;
  snapshot: { caption?: string; linkUrl?: string | null; mediaRefs?: { assetId: string; kind: string }[]; firstCommentText?: string | null } | null;
  changedById: string;
  kind: string;
  createdAt: string;
}

export interface SocialTimelineEntry {
  at: string;
  kind: string;
  label: string;
  meta?: Record<string, unknown>;
}

export interface SocialAccountHealthRow {
  id: string;
  platform: string;
  name: string;
  status: string;
  lastError: string | null;
  healthCheckedAt: string | null;
  health: string;
}

export interface SocialFailureGroup {
  signature: string;
  count: number;
  latestAt: string;
  postIds: string[];
  accountIds: string[];
}

/**
 * SU11: the page-context contract. page.tsx owns every piece of
 * state and every handler; the panel components receive them
 * through this single prop. Field types mirror the page's own
 * useState generics so panel callbacks stay fully typed.
 */
export interface SocialPageCtx {
  accounts: SocialAccount[];
  setAccounts: React.Dispatch<React.SetStateAction<SocialAccount[]>>;
  posts: Sp7SocialPost[];
  setPosts: React.Dispatch<React.SetStateAction<Sp7SocialPost[]>>;
  assets: MediaAsset[];
  setAssets: React.Dispatch<React.SetStateAction<MediaAsset[]>>;
  error: string;
  setError: React.Dispatch<React.SetStateAction<string>>;
  notice: string;
  setNotice: React.Dispatch<React.SetStateAction<string>>;
  busy: string;
  setBusy: React.Dispatch<React.SetStateAction<string>>;
  activeTab: "composer" | "posts" | "library" | "analytics" | "settings";
  setActiveTab: React.Dispatch<React.SetStateAction<"composer" | "posts" | "library" | "analytics" | "settings">>;
  showConnect: boolean;
  setShowConnect: React.Dispatch<React.SetStateAction<boolean>>;
  metaToken: string;
  setMetaToken: React.Dispatch<React.SetStateAction<string>>;
  // CC28: token-paste app source.
  metaAppSource: "platform" | "own";
  setMetaAppSource: React.Dispatch<React.SetStateAction<"platform" | "own">>;
  discovered: DiscoveredPage[] | null;
  setDiscovered: React.Dispatch<React.SetStateAction<DiscoveredPage[] | null>>;
  pageSelected: Record<string, boolean>;
  setPageSelected: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  caption: string;
  setCaption: React.Dispatch<React.SetStateAction<string>>;
  linkUrl: string;
  setLinkUrl: React.Dispatch<React.SetStateAction<string>>;
  selectedMedia: SelectedMedia[];
  setSelectedMedia: React.Dispatch<React.SetStateAction<SelectedMedia[]>>;
  accountSelected: Record<string, boolean>;
  setAccountSelected: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  editingPostId: string | null;
  setEditingPostId: React.Dispatch<React.SetStateAction<string | null>>;
  firstCommentText: string;
  setFirstCommentText: React.Dispatch<React.SetStateAction<string>>;
  recurrenceFrequency: RecurrenceFrequency | "";
  setRecurrenceFrequency: React.Dispatch<React.SetStateAction<RecurrenceFrequency | "">>;
  recurrenceInterval: number;
  setRecurrenceInterval: React.Dispatch<React.SetStateAction<number>>;
  variantOverrides: Record<string, VariantOverride>;
  setVariantOverrides: React.Dispatch<React.SetStateAction<Record<string, VariantOverride>>>;
  ytTitle: string;
  setYtTitle: React.Dispatch<React.SetStateAction<string>>;
  ytTagsInput: string;
  setYtTagsInput: React.Dispatch<React.SetStateAction<string>>;
  ytCategoryId: string;
  setYtCategoryId: React.Dispatch<React.SetStateAction<string>>;
  ytIsShort: boolean;
  setYtIsShort: React.Dispatch<React.SetStateAction<boolean>>;
  coverAssetId: string;
  setCoverAssetId: React.Dispatch<React.SetStateAction<string>>;
  isStory: boolean;
  setIsStory: React.Dispatch<React.SetStateAction<boolean>>;
  deriveOpenId: string | null;
  setDeriveOpenId: React.Dispatch<React.SetStateAction<string | null>>;
  deriveSelected: Record<string, Record<string, boolean>>;
  setDeriveSelected: React.Dispatch<React.SetStateAction<Record<string, Record<string, boolean>>>>;
  deriveWarnings: Record<string, DeriveWarning[]>;
  setDeriveWarnings: React.Dispatch<React.SetStateAction<Record<string, DeriveWarning[]>>>;
  postingSlots: SocialPostingSlot[];
  setPostingSlots: React.Dispatch<React.SetStateAction<SocialPostingSlot[]>>;
  slotAccountId: string;
  setSlotAccountId: React.Dispatch<React.SetStateAction<string>>;
  slotWeekday: number;
  setSlotWeekday: React.Dispatch<React.SetStateAction<number>>;
  slotTime: string;
  setSlotTime: React.Dispatch<React.SetStateAction<string>>;
  evergreenForms: Record<string, EvergreenFormState>;
  setEvergreenForms: React.Dispatch<React.SetStateAction<Record<string, EvergreenFormState>>>;
  showLibrary: boolean;
  setShowLibrary: React.Dispatch<React.SetStateAction<boolean>>;
  mediaFolders: MediaFolder[];
  setMediaFolders: React.Dispatch<React.SetStateAction<MediaFolder[]>>;
  mediaFolderFilter: string;
  setMediaFolderFilter: React.Dispatch<React.SetStateAction<string>>;
  mediaSearchInput: string;
  setMediaSearchInput: React.Dispatch<React.SetStateAction<string>>;
  mediaTagInput: string;
  setMediaTagInput: React.Dispatch<React.SetStateAction<string>>;
  usageByAsset: Record<string, MediaUsage>;
  setUsageByAsset: React.Dispatch<React.SetStateAction<Record<string, MediaUsage>>>;
  bulkSelected: Set<string>;
  setBulkSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
  bulkFolderId: string;
  setBulkFolderId: React.Dispatch<React.SetStateAction<string>>;
  assetAspect: Record<string, MediaAspect>;
  setAssetAspect: React.Dispatch<React.SetStateAction<Record<string, MediaAspect>>>;
  importProductId: string;
  setImportProductId: React.Dispatch<React.SetStateAction<string>>;
  importError: string;
  setImportError: React.Dispatch<React.SetStateAction<string>>;
  showAiPanel: boolean;
  setShowAiPanel: React.Dispatch<React.SetStateAction<boolean>>;
  aiProducts: AiProductOption[];
  setAiProducts: React.Dispatch<React.SetStateAction<AiProductOption[]>>;
  aiProductsLoaded: boolean;
  setAiProductsLoaded: React.Dispatch<React.SetStateAction<boolean>>;
  aiProductId: string;
  setAiProductId: React.Dispatch<React.SetStateAction<string>>;
  aiTopic: string;
  setAiTopic: React.Dispatch<React.SetStateAction<string>>;
  aiLanguage: "bn" | "en";
  setAiLanguage: React.Dispatch<React.SetStateAction<"bn" | "en">>;
  aiCount: number;
  setAiCount: React.Dispatch<React.SetStateAction<number>>;
  aiVariants: AiCopyVariant[];
  setAiVariants: React.Dispatch<React.SetStateAction<AiCopyVariant[]>>;
  aiNotice: string;
  setAiNotice: React.Dispatch<React.SetStateAction<string>>;
  aiHashtags: string[];
  setAiHashtags: React.Dispatch<React.SetStateAction<string[]>>;
  selectedHashtags: string[];
  setSelectedHashtags: React.Dispatch<React.SetStateAction<string[]>>;
  hashtagSets: HashtagSet[];
  setHashtagSets: React.Dispatch<React.SetStateAction<HashtagSet[]>>;
  hashtagSetName: string;
  setHashtagSetName: React.Dispatch<React.SetStateAction<string>>;
  hashtagInsights: HashtagInsight | null;
  setHashtagInsights: React.Dispatch<React.SetStateAction<HashtagInsight | null>>;
  planMonth: any;
  setPlanMonth: React.Dispatch<React.SetStateAction<any>>;
  planPillars: string;
  setPlanPillars: React.Dispatch<React.SetStateAction<string>>;
  planFocus: string;
  setPlanFocus: React.Dispatch<React.SetStateAction<string>>;
  contentPlan: ContentPlan | null;
  setContentPlan: React.Dispatch<React.SetStateAction<ContentPlan | null>>;
  planSelectedItems: Record<number, boolean>;
  setPlanSelectedItems: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  planAccountId: string;
  setPlanAccountId: React.Dispatch<React.SetStateAction<string>>;
  scriptTopic: string;
  setScriptTopic: React.Dispatch<React.SetStateAction<string>>;
  scriptProductId: string;
  setScriptProductId: React.Dispatch<React.SetStateAction<string>>;
  aiScript: AiScriptResult | null;
  setAiScript: React.Dispatch<React.SetStateAction<AiScriptResult | null>>;
  aiImagePrompt: string;
  setAiImagePrompt: React.Dispatch<React.SetStateAction<string>>;
  aiImageProductId: string;
  setAiImageProductId: React.Dispatch<React.SetStateAction<string>>;
  templateAssetId: string;
  setTemplateAssetId: React.Dispatch<React.SetStateAction<string>>;
  templateHeadline: string;
  setTemplateHeadline: React.Dispatch<React.SetStateAction<string>>;
  templateSubtext: string;
  setTemplateSubtext: React.Dispatch<React.SetStateAction<string>>;
  templateProductId: string;
  setTemplateProductId: React.Dispatch<React.SetStateAction<string>>;
  templatePoster: MediaAsset | null;
  setTemplatePoster: React.Dispatch<React.SetStateAction<MediaAsset | null>>;
  filterQuery: string;
  setFilterQuery: React.Dispatch<React.SetStateAction<string>>;
  filterStatus: string;
  setFilterStatus: React.Dispatch<React.SetStateAction<string>>;
  filterAccountId: string;
  setFilterAccountId: React.Dispatch<React.SetStateAction<string>>;
  orgTz: string;
  setOrgTz: React.Dispatch<React.SetStateAction<string>>;
  viewMode: "list" | "calendar" | "queue";
  setViewMode: React.Dispatch<React.SetStateAction<"list" | "calendar" | "queue">>;
  scheduleInputs: Record<string, string>;
  setScheduleInputs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  selectedPostId: string | null;
  setSelectedPostId: React.Dispatch<React.SetStateAction<string | null>>;
  platformModes: PlatformModes | null;
  setPlatformModes: React.Dispatch<React.SetStateAction<PlatformModes | null>>;
  insightsSummary: SocialInsightsSummary | null;
  setInsightsSummary: React.Dispatch<React.SetStateAction<SocialInsightsSummary | null>>;
  analyticsTimeseries: SocialTimeseries | null;
  setAnalyticsTimeseries: React.Dispatch<React.SetStateAction<SocialTimeseries | null>>;
  analyticsContentTypes: SocialContentTypes | null;
  setAnalyticsContentTypes: React.Dispatch<React.SetStateAction<SocialContentTypes | null>>;
  analyticsAccounts: SocialAccountsInsights | null;
  setAnalyticsAccounts: React.Dispatch<React.SetStateAction<SocialAccountsInsights | null>>;
  analyticsFollowers: SocialFollowers | null;
  setAnalyticsFollowers: React.Dispatch<React.SetStateAction<SocialFollowers | null>>;
  reportMonth: any;
  setReportMonth: React.Dispatch<React.SetStateAction<any>>;
  requireApproval: boolean;
  setRequireApproval: React.Dispatch<React.SetStateAction<boolean>>;
  requireApprovalLoaded: boolean;
  setRequireApprovalLoaded: React.Dispatch<React.SetStateAction<boolean>>;
  autoDraftForm: AutoDraftSettingsForm;
  setAutoDraftForm: React.Dispatch<React.SetStateAction<AutoDraftSettingsForm>>;
  autoDraftLoaded: boolean;
  setAutoDraftLoaded: React.Dispatch<React.SetStateAction<boolean>>;
  linkStatsById: Record<string, SocialLinkStats>;
  setLinkStatsById: React.Dispatch<React.SetStateAction<Record<string, SocialLinkStats>>>;
  rejectOpenId: string | null;
  setRejectOpenId: React.Dispatch<React.SetStateAction<string | null>>;
  rejectNotes: Record<string, string>;
  setRejectNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  imageStatus: { configured: boolean; provider: string | null } | null;
  setImageStatus: React.Dispatch<React.SetStateAction<{ configured: boolean; provider: string | null } | null>>;
  mediaLimits: { imageMaxBytes: number; videoMaxBytes: number } | null;
  setMediaLimits: React.Dispatch<React.SetStateAction<{ imageMaxBytes: number; videoMaxBytes: number } | null>>;
  calCursor: { y: number; m: number };
  setCalCursor: React.Dispatch<React.SetStateAction<{ y: number; m: number }>>;
  youtubePick: { state: string; channels: { id: string; title: string; pictureUrl: string | null }[] } | null;
  setYoutubePick: React.Dispatch<React.SetStateAction<{ state: string; channels: { id: string; title: string; pictureUrl: string | null }[] } | null>>;
  postsNextCursor: string | null;
  loadMorePosts: any;
  selectedPostIds: Set<string>;
  setSelectedPostIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  togglePostSelected: any;
  bulkRescheduleAt: string;
  setBulkRescheduleAt: React.Dispatch<React.SetStateAction<string>>;
  runPostsBulk: any;
  csvImportResults: CsvImportResponse | null;
  importPostsCsv: any;
  members: OrgMemberOption[];
  myUserId: string;
  detailOpenId: string | null;
  togglePostDetail: any;
  notesByPost: Record<string, SocialPostNote[]>;
  versionsByPost: Record<string, SocialPostVersion[]>;
  timelineByPost: Record<string, SocialTimelineEntry[]>;
  noteInputs: Record<string, string>;
  setNoteInputs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  addPostNote: any;
  deletePostNote: any;
  restorePostVersion: any;
  assignPost: any;
  memberLabel: any;
  approvalTwoStep: boolean;
  saveApprovalTwoStep: any;
  accountHealth: SocialAccountHealthRow[];
  failureGroups: SocialFailureGroup[];
  checkAccountHealth: any;
  retryFailedPost: any;
  loadAccountHealth: any;
  loadFailureGroups: any;
  mediaFiltersRef: React.RefObject<MediaQueryFilters>;
  loadAccounts: any;
  loadPosts: any;
  loadInsightsSummary: any;
  loadAnalyticsTimeseries: any;
  loadAnalyticsContentTypes: any;
  loadAnalyticsAccounts: any;
  loadAnalyticsFollowers: any;
  loadSocialSettings: any;
  loadAutoDraftSettings: any;
  loadPostingSlots: any;
  loadAssets: any;
  loadMediaFolders: any;
  loadImageStatus: any;
  loadPlatformModes: any;
  loadMediaLimits: any;
  loadAiProducts: any;
  loadHashtagSets: any;
  loadHashtagInsights: any;
  applyContentPlan: any;
  loadContentPlans: any;
  onTokenChange: any;
  discoverPages: any;
  connectSelectedPages: any;
  disconnectAccount: any;
  connectOAuth: any;
  selectYouTubeChannel: any;
  resetComposer: any;
  startEdit: any;
  saveDraft: any;
  deletePost: any;
  clonePost: any;
  addToQueue: any;
  scheduleBestTime: any;
  evergreenFormFor: any;
  saveEvergreen: any;
  createPostingSlot: any;
  togglePostingSlot: any;
  deletePostingSlot: any;
  fmtInTz: any;
  doSchedule: any;
  doCancelSchedule: any;
  doPublishNow: any;
  upsertPost: any;
  refreshPostInsights: any;
  refreshAllInsights: any;
  downloadReport: any;
  derivePost: any;
  saveApprovalSetting: any;
  saveAutoDraftSettings: any;
  loadLinkStats: any;
  submitApproval: any;
  approvePost: any;
  rejectPost: any;
  toggleAiPanel: any;
  generateContentPlan: any;
  materializeContentPlan: any;
  generateAiScript: any;
  generateAiCopy: any;
  toggleHashtag: any;
  applyHashtagSet: any;
  saveHashtagSet: any;
  useAiCaption: any;
  attachMedia: any;
  uploadMedia: any;
  rasterizeMedia: any;
  createMediaFolder: any;
  deleteMediaFolder: any;
  selectMediaFolder: any;
  applyMediaFilters: any;
  clearMediaFilters: any;
  updateAssetTags: any;
  changeAssetFolder: any;
  loadAssetUsage: any;
  cropAsset: any;
  captureAssetCover: any;
  toggleBulkSelected: any;
  runBulkAction: any;
  importProductImage: any;
  generateAiImage: any;
  createTemplatePoster: any;
  currentPlatformFields: any;
  relativeLabel: any;
  renderApprovalBadge: any;
  renderSubmitApproval: any;
  renderSuBadges: any;
  renderCloneButton: any;
  renderDeriveButton: any;
  renderDerivePanel: any;
  renderEvergreenControls: any;
  renderInsights: any;
  renderLinkStats: any;
  renderPostActions: any;
  filteredPosts: Sp7SocialPost[];
  calCells: MonthCell[];
  calBuckets: Map<string, Sp7SocialPost[]>;
  calMonthTitle: string;
  selectedPost: Sp7SocialPost | null;
  queuePosts: Sp7SocialPost[];
  pendingApprovalPosts: Sp7SocialPost[];
  hasPublishedOrInsights: boolean;
  analyticsBars: TimeseriesBar[];
  analyticsHasTimeseriesData: boolean;
  followerHasGrowth: boolean;
  connectedAccounts: SocialAccount[];
  composerTargets: SocialAccount[];
  showFirstCommentInput: boolean;
  inputCls: string;
}
