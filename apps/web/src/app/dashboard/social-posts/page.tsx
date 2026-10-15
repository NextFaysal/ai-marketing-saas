"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { API_URL, apiFetch, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { filterSocialPosts } from "@/lib/social-post-filters";
import {
  canSubmitForApproval,
  formatHourBn,
  insightChips,
  summaryMetricRows,
  weekdayNameBn,
  type SocialApprovalStatus,
  type SocialInsightsSummary,
  type Sp7SocialPost,
} from "@/lib/social-post-insights";
import { bucketPostsByDay, localInputToUtcIso, monthCells, orgDayKey, utcToLocalInput } from "@/lib/social-calendar";
import {
  ASPECT_OPTIONS,
  buildMediaQuery,
  formatMediaTags,
  parseMediaTagsInput,
  summarizeBulkResults,
  type MediaAspect,
  type MediaBulkResult,
  type MediaQueryFilters,
} from "@/lib/social-media-library";
import {
  buildPlatformPreview,
  groupVariantsForSave,
  isFirstCommentApplicable,
  weekdayLabelBn,
  type RecurrenceFrequency,
  type VariantOverride,
} from "@/lib/social-composer";
import {
  AUTO_DRAFT_TOGGLES,
  autoDraftBadgeLabel,
  autoDraftFormFromSettings,
  buildAutoDraftSettingsPayload,
  formatClicksLabel,
  formatOrdersRevenueLabel,
  nonTrackedPlatformNote,
  type AutoDraftSettings,
  type AutoDraftSettingsForm,
  type SocialLinkStats,
} from "@/lib/social-posts-su5";
import {
  contentTypeLabel,
  currentMonthValue,
  followerGrowth,
  formatBnNumber,
  monthLabelBn,
  parseYoutubeTagsInput,
  platformFieldsForSave,
  timeseriesBars,
  youtubeTagsToInput,
  type SocialAccountsInsights,
  type SocialContentTypes,
  type SocialFollowers,
  type SocialTimeseries,
} from "@/lib/social-analytics";
import {
  type SocialShareLink,
  type SocialShareLinkCreated,
  type YouTubePlaylistOption,
} from "@/lib/social-posts-sn";
import { EmptyState } from "@repo/ui";

// SU11: the contract types, status constants, MediaThumb and
// formatMb now live in components/shared.tsx (imported back here
// for the page body, and by the panel components directly).
import {
  ACCOUNT_STATUS_META, ApprovalStatusPill, MAX_MEDIA, PLATFORM_LABELS, POST_STATUS_META,
  type AiCopyResponse, type AiCopyVariant, type AiProductOption, type AiScriptResult,
  type ContentPlan, type DeriveResult, type DeriveWarning, type DiscoveredPage,
  type EvergreenFormState, type HashtagInsight, type HashtagSet, type MediaAsset,
  type MediaFolder, type MediaUsage, type PlatformModes, type SelectedMedia,
  type SocialAccount, type SocialPostingSlot,
  type OrgMemberOption, type SocialAccountHealthRow, type SocialFailureGroup,
  type SocialPostNote, type SocialPostVersion, type SocialTimelineEntry,
} from "./components/shared";
import { ComposerPanel } from "./components/ComposerPanel";
import { LibraryPanel } from "./components/LibraryPanel";
import { AnalyticsPanel } from "./components/AnalyticsPanel";
import { PostsPanel } from "./components/PostsPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import {
  buildPostsPageQuery, healthPill, mergePostPage, summarizeBulkPostResults, summarizeCsvImport,
  type BulkPostsResponse, type CsvImportResponse,
} from "@/lib/social-posts-su11";

export default function SocialPostsPage() {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [posts, setPosts] = useState<Sp7SocialPost[]>([]);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  // SU11: tabbed workspace — every panel stays mounted (hidden
  // with CSS, never unmounted) so composer state survives tabs.
  const [activeTab, setActiveTab] = useState<"composer" | "posts" | "library" | "analytics" | "settings">("composer");

  // Meta connect flow (discover -> picker -> connect).
  const [showConnect, setShowConnect] = useState(false);
  const [metaToken, setMetaToken] = useState("");
  // CC28: which Meta app the pasted token belongs to.
  const [metaAppSource, setMetaAppSource] = useState<"platform" | "own">("platform");
  const [discovered, setDiscovered] = useState<DiscoveredPage[] | null>(null);
  const [pageSelected, setPageSelected] = useState<Record<string, boolean>>({});

  // Composer.
  const [caption, setCaption] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [selectedMedia, setSelectedMedia] = useState<SelectedMedia[]>([]);
  const [accountSelected, setAccountSelected] = useState<Record<string, boolean>>({});
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  // SU1 composer v2: first comment, recurrence, per-account variants.
  const [firstCommentText, setFirstCommentText] = useState("");
  const [recurrenceFrequency, setRecurrenceFrequency] = useState<RecurrenceFrequency | "">("");
  const [recurrenceInterval, setRecurrenceInterval] = useState(1);
  const [variantOverrides, setVariantOverrides] = useState<Record<string, VariantOverride>>({});
  // SU8: optional YouTube / Story platform fields (composer + edit).
  const [ytTitle, setYtTitle] = useState("");
  const [ytTagsInput, setYtTagsInput] = useState("");
  const [ytCategoryId, setYtCategoryId] = useState("");
  const [ytIsShort, setYtIsShort] = useState(false);
  const [coverAssetId, setCoverAssetId] = useState("");
  const [isStory, setIsStory] = useState(false);
  // SN1: YouTube playlist choice + the picked account's playlist
  // list (loaded on demand from the SN1 endpoint).
  const [ytPlaylistId, setYtPlaylistId] = useState("");
  const [ytPlaylists, setYtPlaylists] = useState<YouTubePlaylistOption[]>([]);
  const [ytPlaylistsAccountId, setYtPlaylistsAccountId] = useState("");
  // SU8: Derive panel (per post) — selected target accounts + the
  // API's warnings, shown verbatim.
  const [deriveOpenId, setDeriveOpenId] = useState<string | null>(null);
  const [deriveSelected, setDeriveSelected] = useState<Record<string, Record<string, boolean>>>({});
  const [deriveWarnings, setDeriveWarnings] = useState<Record<string, DeriveWarning[]>>({});
  // SU2: posting slots + per-post evergreen form state.
  const [postingSlots, setPostingSlots] = useState<SocialPostingSlot[]>([]);
  const [slotAccountId, setSlotAccountId] = useState("");
  const [slotWeekday, setSlotWeekday] = useState(5);
  const [slotTime, setSlotTime] = useState("10:00");
  const [evergreenForms, setEvergreenForms] = useState<Record<string, EvergreenFormState>>({});
  const [showLibrary, setShowLibrary] = useState(false);
  // SU3: Media Library v2 — folders, filters, usage, bulk, editor.
  const [mediaFolders, setMediaFolders] = useState<MediaFolder[]>([]);
  const [mediaFolderFilter, setMediaFolderFilter] = useState("");
  const [mediaSearchInput, setMediaSearchInput] = useState("");
  const [mediaTagInput, setMediaTagInput] = useState("");
  // Applied filters live in a ref so loadAssets stays a stable
  // callback (typing in a filter input must not retrigger the
  // page-level load effect that depends on it).
  const mediaFiltersRef = useRef<MediaQueryFilters>({});
  const [usageByAsset, setUsageByAsset] = useState<Record<string, MediaUsage>>({});
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkFolderId, setBulkFolderId] = useState("");
  const [assetAspect, setAssetAspect] = useState<Record<string, MediaAspect>>({});
  // PP3: product-image import in the composer picker (reuses the
  // SP3 aiProducts list — same products endpoint, one fetch).
  const [importProductId, setImportProductId] = useState("");
  const [importError, setImportError] = useState("");

  // SP3 AI copy panel.
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiProducts, setAiProducts] = useState<AiProductOption[]>([]);
  const [aiProductsLoaded, setAiProductsLoaded] = useState(false);
  const [aiProductId, setAiProductId] = useState("");
  const [aiTopic, setAiTopic] = useState("");
  const [aiLanguage, setAiLanguage] = useState<"bn" | "en">("bn");
  const [aiCount, setAiCount] = useState(3);
  const [aiVariants, setAiVariants] = useState<AiCopyVariant[]>([]);
  const [aiNotice, setAiNotice] = useState("");
  const [aiHashtags, setAiHashtags] = useState<string[]>([]);
  const [selectedHashtags, setSelectedHashtags] = useState<string[]>([]);
  const [hashtagSets, setHashtagSets] = useState<HashtagSet[]>([]);
  const [hashtagSetName, setHashtagSetName] = useState("");
  // SU4: own-data hashtag insights, monthly content plan, script.
  const [hashtagInsights, setHashtagInsights] = useState<HashtagInsight | null>(null);
  const [planMonth, setPlanMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [planPillars, setPlanPillars] = useState("");
  const [planFocus, setPlanFocus] = useState("");
  const [contentPlan, setContentPlan] = useState<ContentPlan | null>(null);
  const [planSelectedItems, setPlanSelectedItems] = useState<Record<number, boolean>>({});
  const [planAccountId, setPlanAccountId] = useState("");
  const [scriptTopic, setScriptTopic] = useState("");
  const [scriptProductId, setScriptProductId] = useState("");
  const [aiScript, setAiScript] = useState<AiScriptResult | null>(null);

  // SP4 image panel (AI image + template poster). The product
  // selects REUSE the SP3 aiProducts state — one fetch, shared.
  const [imageStatus, setImageStatus] = useState<{ configured: boolean; provider: string | null } | null>(null);
  const [aiImagePrompt, setAiImagePrompt] = useState("");
  const [aiImageProductId, setAiImageProductId] = useState("");
  const [templateAssetId, setTemplateAssetId] = useState("");
  const [templateHeadline, setTemplateHeadline] = useState("");
  const [templateSubtext, setTemplateSubtext] = useState("");
  const [templateProductId, setTemplateProductId] = useState("");
  const [templatePoster, setTemplatePoster] = useState<MediaAsset | null>(null);

  // Posts-list filters (pure function in lib/social-post-filters).
  const [filterQuery, setFilterQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterAccountId, setFilterAccountId] = useState("");

  // SP5: org timezone, list/calendar/queue views, schedule inputs.
  const [orgTz, setOrgTz] = useState("Asia/Dhaka");
  const [viewMode, setViewMode] = useState<"list" | "calendar" | "queue">("list");
  const [calCursor, setCalCursor] = useState<{ y: number; m: number }>(() => {
    const [y, m] = orgDayKey(new Date().toISOString(), "Asia/Dhaka").split("-").map(Number);
    return { y, m };
  });
  const [scheduleInputs, setScheduleInputs] = useState<Record<string, string>>({});
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);

  // SP8/SP9: OAuth platform modes (TikTok/YouTube connect).
  const [platformModes, setPlatformModes] = useState<PlatformModes | null>(null);
  // PP2: upload caps for the picker hint (null until loaded —
  // the hint then falls back to the built-in defaults).
  const [mediaLimits, setMediaLimits] = useState<{ imageMaxBytes: number; videoMaxBytes: number } | null>(null);
  // SP9: a pending YouTube channel pick (the callback parked the
  // authorization in a 10-minute state because the Google account
  // has more than one channel).
  const [youtubePick, setYoutubePick] = useState<{ state: string; channels: { id: string; title: string; pictureUrl: string | null }[] } | null>(null);

  // SP7: insights summary, approval setting, reject-note inputs.
  const [insightsSummary, setInsightsSummary] = useState<SocialInsightsSummary | null>(null);
  // SU7 (Batch 4): Analytics v2 — each dataset loads in isolation
  // (null = not loaded / failed silently; that section then shows
  // an honest note instead of breaking the page).
  const [analyticsTimeseries, setAnalyticsTimeseries] = useState<SocialTimeseries | null>(null);
  const [analyticsContentTypes, setAnalyticsContentTypes] = useState<SocialContentTypes | null>(null);
  const [analyticsAccounts, setAnalyticsAccounts] = useState<SocialAccountsInsights | null>(null);
  const [analyticsFollowers, setAnalyticsFollowers] = useState<SocialFollowers | null>(null);
  const [reportMonth, setReportMonth] = useState(() => currentMonthValue(new Date()));
  const [requireApproval, setRequireApproval] = useState(false);
  const [requireApprovalLoaded, setRequireApprovalLoaded] = useState(false);
  // SU5: Commerce Auto-Draft settings form (+ loaded flag, same
  // pattern as the approval setting — inputs stay disabled until
  // the server's real values arrive).
  const [autoDraftForm, setAutoDraftForm] = useState<AutoDraftSettingsForm>({
    newProductEnabled: false,
    saleEnabled: false,
    backInStockEnabled: false,
    reviewMilestoneEnabled: false,
    maxDraftsPerDay: 5,
    socialAccountId: "",
  });
  const [autoDraftLoaded, setAutoDraftLoaded] = useState(false);
  // SU6: per-post tracked-link stats, loaded on demand only.
  const [linkStatsById, setLinkStatsById] = useState<Record<string, SocialLinkStats>>({});
  const [rejectOpenId, setRejectOpenId] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({});
  // SU11: cursor pagination of the post list (first page +
  // load-more), bulk selection, and the CSV import results.
  const [postsNextCursor, setPostsNextCursor] = useState<string | null>(null);
  const [selectedPostIds, setSelectedPostIds] = useState<Set<string>>(new Set());
  const [bulkRescheduleAt, setBulkRescheduleAt] = useState("");
  const [csvImportResults, setCsvImportResults] = useState<CsvImportResponse | null>(null);
  // SU9 web: org members (assign picker — the inbox/team pages'
  // GET /organizations/:id/members shape), my own user id (note
  // delete is own-or-admin, enforced by the API), per-post detail
  // data (notes / versions / timeline), and the two-step toggle.
  const [members, setMembers] = useState<OrgMemberOption[]>([]);
  const [myUserId, setMyUserId] = useState("");
  const [detailOpenId, setDetailOpenId] = useState<string | null>(null);
  const [notesByPost, setNotesByPost] = useState<Record<string, SocialPostNote[]>>({});
  const [versionsByPost, setVersionsByPost] = useState<Record<string, SocialPostVersion[]>>({});
  const [timelineByPost, setTimelineByPost] = useState<Record<string, SocialTimelineEntry[]>>({});
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});
  const [approvalTwoStep, setApprovalTwoStep] = useState(false);
  // SN2: client approval share links (per-post list + the full URL
  // of the most recently created link, shown once) and the
  // require-client-approval settings toggle.
  const [shareLinksByPost, setShareLinksByPost] = useState<Record<string, SocialShareLink[]>>({});
  const [shareCreatedByPost, setShareCreatedByPost] = useState<Record<string, SocialShareLinkCreated>>({});
  const [requireClientApproval, setRequireClientApproval] = useState(false);
  // SU10 web: account health rows + failure groups.
  const [accountHealth, setAccountHealth] = useState<SocialAccountHealthRow[]>([]);
  const [failureGroups, setFailureGroups] = useState<SocialFailureGroup[]>([]);
  // SU11: status/account filters also reach the API (cursor
  // pages are fetched with them); refs keep loadPosts stable.
  const postFilterRef = useRef<{ status: string; accountId: string }>({ status: "", accountId: "" });

  const loadAccounts = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setAccounts(await apiFetch<SocialAccount[]>(`/organizations/${orgId}/social/accounts`));
  }, []);

  // SU11: the post list loads in CURSOR mode (limit 50) — the
  // first page replaces, "আরও দেখুন" appends via mergePostPage.
  // Status/account filters go to the API with every page; the
  // caption text search stays client-side (filterSocialPosts).
  const loadPostsPage = useCallback(async (cursor: string | null, append: boolean) => {
    const orgId = getOrganizationId(); if (!orgId) return;
    const qs = buildPostsPageQuery({
      cursor, limit: 50,
      status: postFilterRef.current.status, accountId: postFilterRef.current.accountId,
    });
    const page = await apiFetch<{ items: Sp7SocialPost[]; nextCursor: string | null }>(
      `/organizations/${orgId}/social/posts?${qs}`,
    );
    setPosts((prev) => (append ? mergePostPage(prev, page.items) : page.items));
    setPostsNextCursor(page.nextCursor);
  }, []);

  const loadPosts = useCallback(async () => { await loadPostsPage(null, false); }, [loadPostsPage]);

  const loadMorePosts = useCallback(async () => {
    if (!postsNextCursor) return;
    setBusy("posts-more");
    try { await loadPostsPage(postsNextCursor, true); }
    catch (e) { setError(e instanceof Error ? e.message : "আরও পোস্ট লোড করা যায়নি"); }
    finally { setBusy(""); }
  }, [loadPostsPage, postsNextCursor]);

  // SP7 loaders — auxiliary like the media library: a failure here
  // must not blank the whole page, so callers .catch() them.
  const loadInsightsSummary = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setInsightsSummary(await apiFetch<SocialInsightsSummary>(`/organizations/${orgId}/social/insights/summary`));
  }, []);

  // SU7 loaders — auxiliary like the summary above: each dataset
  // is fetched on its own so one failing endpoint only empties its
  // own analytics section, never the page.
  const loadAnalyticsTimeseries = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setAnalyticsTimeseries(await apiFetch<SocialTimeseries>(`/organizations/${orgId}/social/insights/timeseries?days=30`));
  }, []);

  const loadAnalyticsContentTypes = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setAnalyticsContentTypes(await apiFetch<SocialContentTypes>(`/organizations/${orgId}/social/insights/content-types`));
  }, []);

  const loadAnalyticsAccounts = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setAnalyticsAccounts(await apiFetch<SocialAccountsInsights>(`/organizations/${orgId}/social/insights/accounts`));
  }, []);

  const loadAnalyticsFollowers = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setAnalyticsFollowers(await apiFetch<SocialFollowers>(`/organizations/${orgId}/social/insights/followers`));
  }, []);

  const loadSocialSettings = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    const res = await apiFetch<{ socialRequireApproval: boolean; socialApprovalTwoStep?: boolean; socialRequireClientApproval?: boolean }>(`/organizations/${orgId}/social/settings`);
    setRequireApproval(!!res.socialRequireApproval);
    setApprovalTwoStep(!!res.socialApprovalTwoStep);
    setRequireClientApproval(!!res.socialRequireClientApproval);
    setRequireApprovalLoaded(true);
  }, []);

  // SN1: the picked YouTube account's playlists (composer select).
  // Cached per account; the composer effect calls this whenever the
  // selected YouTube account changes.
  async function loadYouTubePlaylists(accountId: string) {
    if (!accountId || ytPlaylistsAccountId === accountId) return;
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("yt-playlists"); setError("");
    try {
      const res = await apiFetch<{ playlists: YouTubePlaylistOption[] }>(`/organizations/${orgId}/social/accounts/${accountId}/youtube/playlists`);
      setYtPlaylists(res.playlists ?? []);
      setYtPlaylistsAccountId(accountId);
    } catch (e) {
      setYtPlaylists([]);
      setYtPlaylistsAccountId(accountId);
      setError(e instanceof Error ? e.message : "Playlist লোড করা যায়নি");
    } finally { setBusy(""); }
  }

  // SU9/SU10 web loaders — auxiliary like the other settings:
  // callers .catch() them so a failure never blanks the page.
  const loadMembers = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setMembers(await apiFetch<OrgMemberOption[]>(`/organizations/${orgId}/members`));
  }, []);

  const loadAccountHealth = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setAccountHealth(await apiFetch<SocialAccountHealthRow[]>(`/organizations/${orgId}/social/accounts/health`));
  }, []);

  const loadFailureGroups = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setFailureGroups(await apiFetch<SocialFailureGroup[]>(`/organizations/${orgId}/social/posts/failures`));
  }, []);

  // SU5: auto-draft settings load alongside the other settings —
  // auxiliary like them, so callers .catch() it.
  const loadAutoDraftSettings = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    const res = await apiFetch<AutoDraftSettings>(`/organizations/${orgId}/social/auto-draft-settings`);
    setAutoDraftForm(autoDraftFormFromSettings(res));
    setAutoDraftLoaded(true);
  }, []);

  // SU2: posting slots are auxiliary like the media library —
  // callers .catch() this so a failure never blanks the page.
  const loadPostingSlots = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setPostingSlots(await apiFetch<SocialPostingSlot[]>(`/organizations/${orgId}/social/posting-slots`));
  }, []);

  const loadAssets = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    const qs = buildMediaQuery(mediaFiltersRef.current);
    setAssets(await apiFetch<MediaAsset[]>(`/organizations/${orgId}/social/media${qs ? `?${qs}` : ""}`));
  }, []);

  // SU3: folder list is auxiliary like the library itself.
  const loadMediaFolders = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setMediaFolders(await apiFetch<MediaFolder[]>(`/organizations/${orgId}/social/media/folders`));
  }, []);

  const loadImageStatus = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setImageStatus(await apiFetch<{ configured: boolean; provider: string | null }>(`/organizations/${orgId}/social/media/image-status`));
  }, []);

  const loadPlatformModes = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setPlatformModes(await apiFetch<PlatformModes>(`/organizations/${orgId}/social/platform-modes`));
  }, []);

  // PP2: the upload caps the picker hint shows — from the API, so
  // an operator's SOCIAL_VIDEO_MAX_BYTES change shows up verbatim.
  const loadMediaLimits = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setMediaLimits(await apiFetch<{ imageMaxBytes: number; videoMaxBytes: number }>(`/organizations/${orgId}/social/media/limits`));
  }, []);

  // SP8/SP9: OAuth return landing — the callback redirects here
  // with social_connected / social_error. Show the outcome once,
  // refresh the account list, then strip the params so a reload
  // does not replay the message.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("social_connected");
    const oauthError = params.get("social_error");
    const pick = params.get("youtube_pick");
    if (!connected && !oauthError && !pick) return;
    if (oauthError) setError(oauthError);
    if (connected === "tiktok") setNotice("TikTok অ্যাকাউন্ট যুক্ত হয়েছে।");
    if (connected === "youtube") setNotice("YouTube Channel যুক্ত হয়েছে।");
    if (pick) {
      // SP9: the callback parked a multi-channel authorization —
      // load the offered channels for the picker (the state id is
      // captured here, THEN the URL is stripped as usual).
      const orgId = getOrganizationId();
      setYoutubePick({ state: pick, channels: [] });
      if (orgId) {
        apiFetch<{ channels: { id: string; title: string; pictureUrl: string | null }[] }>(`/organizations/${orgId}/social/accounts/youtube/pick-info?state=${encodeURIComponent(pick)}`)
          .then((res) => setYoutubePick({ state: pick, channels: res.channels ?? [] }))
          .catch((e) => { setError(e instanceof Error ? e.message : "Channel তালিকা লোড করা যায়নি"); setYoutubePick(null); });
      }
    }
    loadAccounts().catch(() => undefined);
    window.history.replaceState(null, "", window.location.pathname);
  }, [loadAccounts]);

  // SD2: URL hash deep-link for the tab workspace (Messaging redesign
  // pattern) — opening /dashboard/social-posts#posts lands on that tab,
  // and switching tabs keeps the hash in sync via replaceState (no
  // history spam, no state change beyond the existing tab setter).
  useEffect(() => {
    const h = window.location.hash.replace("#", "");
    if (h === "composer" || h === "posts" || h === "library" || h === "analytics" || h === "settings") {
      setActiveTab(h);
    }
  }, []);

  const selectTab = (id: "composer" | "posts" | "library" | "analytics" | "settings") => {
    setActiveTab(id);
    window.history.replaceState(null, "", `#${id}`);
  };

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); return; }
    try {
      // Org timezone drives every schedule/calendar display (SP5);
      // a failure here just keeps the Asia/Dhaka default.
      const org = await apiFetch<{ timezone?: string }>(`/organizations/${orgId}`).catch(() => undefined);
      if (org?.timezone) setOrgTz(org.timezone);
      await Promise.all([loadAccounts(), loadPosts()]);
      // The media library is auxiliary — a failure there must not
      // blank the whole page.
      loadAssets().catch(() => undefined);
      loadImageStatus().catch(() => undefined);
      loadInsightsSummary().catch(() => undefined);
      loadSocialSettings().catch(() => undefined);
      loadAutoDraftSettings().catch(() => undefined);
      loadPlatformModes().catch(() => undefined);
      loadMediaLimits().catch(() => undefined);
      loadPostingSlots().catch(() => undefined);
      loadMediaFolders().catch(() => undefined);
      loadAnalyticsTimeseries().catch(() => undefined);
      loadAnalyticsContentTypes().catch(() => undefined);
      loadAnalyticsAccounts().catch(() => undefined);
      loadAnalyticsFollowers().catch(() => undefined);
      loadMembers().catch(() => undefined);
      loadAccountHealth().catch(() => undefined);
      loadFailureGroups().catch(() => undefined);
      apiFetch<{ id: string }>("/auth/me").then((me) => setMyUserId(me.id)).catch(() => undefined);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }, [loadAccounts, loadPosts, loadAssets, loadImageStatus, loadInsightsSummary, loadSocialSettings, loadAutoDraftSettings, loadPlatformModes, loadMediaLimits, loadPostingSlots, loadMediaFolders, loadAnalyticsTimeseries, loadAnalyticsContentTypes, loadAnalyticsAccounts, loadAnalyticsFollowers, loadMembers, loadAccountHealth, loadFailureGroups]);

  // SU11: keep the API-side post filters in a ref for loadPosts,
  // and reload from the FIRST page whenever a filter changes
  // (the mount run is skipped — load() already fetched page 1).
  const postFilterMountRef = useRef(true);
  useEffect(() => {
    postFilterRef.current = { status: filterStatus, accountId: filterAccountId };
    if (postFilterMountRef.current) { postFilterMountRef.current = false; return; }
    loadPosts().catch(() => undefined);
  }, [filterStatus, filterAccountId, loadPosts]);
  useEffect(() => { load(); }, [load]);

  // --- Meta connect flow ----------------------------------------------------

  // Editing the token invalidates any discovery made under the old
  // one — a stale picker must never connect pages from another token.
  function onTokenChange(value: string) {
    setMetaToken(value);
    setDiscovered(null);
    setPageSelected({});
  }

  async function discoverPages(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!metaToken.trim()) { setError("আগে Meta Access Token দিন।"); return; }
    setBusy("discover"); setError("");
    try {
      const res = await apiFetch<{ pages: DiscoveredPage[] }>(`/organizations/${orgId}/social/accounts/meta/discover`, {
        method: "POST", body: JSON.stringify({ accessToken: metaToken }),
      });
      setDiscovered(res.pages);
      setPageSelected(Object.fromEntries(res.pages.map((p) => [p.pageId, p.alreadyConnectedPage])));
      if (res.pages.length === 0) setNotice("এই Token-এর অধীনে কোনো Facebook Page পাওয়া যায়নি।");
    } catch (e) { setError(e instanceof Error ? e.message : "Page খোঁজা ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  async function connectSelectedPages() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const pageIds = Object.entries(pageSelected).filter(([, v]) => v).map(([k]) => k);
    if (pageIds.length === 0) { setError("অন্তত একটি Page বেছে নিন।"); return; }
    setBusy("connect"); setError("");
    try {
      const res = await apiFetch<{ accounts: SocialAccount[] }>(`/organizations/${orgId}/social/accounts/meta/connect`, {
        method: "POST", body: JSON.stringify({ accessToken: metaToken, pageIds, appSource: metaAppSource }),
      });
      setMetaToken("");
      setDiscovered(null);
      setPageSelected({});
      setShowConnect(false);
      setNotice(`যুক্ত হয়েছে: ${res.accounts.length}টি অ্যাকাউন্ট এখন সংযুক্ত।`);
      await loadAccounts();
    } catch (e) { setError(e instanceof Error ? e.message : "যুক্ত করা ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  async function disconnectAccount(a: SocialAccount) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(`“${a.name}” (${PLATFORM_LABELS[a.platform] ?? a.platform}) অ্যাকাউন্টটি বিচ্ছিন্ন করবেন?\n\nএই অ্যাকাউন্টের Draft ও আগের পোস্ট থেকে যাবে, কিন্তু নতুন পোস্টে এই অ্যাকাউন্ট আর বেছে নেওয়া যাবে না।`)) return;
    setBusy(`disconnect-${a.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/social/accounts/${a.id}/disconnect`, { method: "POST" });
      setNotice(`“${a.name}” বিচ্ছিন্ন করা হয়েছে।`);
      await loadAccounts();
    } catch (e) { setError(e instanceof Error ? e.message : "বিচ্ছিন্ন করা ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  // --- SP8/SP9 OAuth connect (TikTok / YouTube) --------------------------------
  // The API returns the platform's authorize URL; the browser
  // leaves for the platform and the callback redirects back here
  // with social_connected / social_error (handled on mount).
  async function connectOAuth(platform: "tiktok" | "youtube") {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`connect-${platform}`); setError("");
    try {
      const res = await apiFetch<{ url: string }>(`/organizations/${orgId}/social/accounts/${platform}/connect-url`);
      window.location.href = res.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connect শুরু করা যায়নি");
      setBusy("");
    }
  }

  // SP9: finish a parked YouTube connect with the chosen channel.
  async function selectYouTubeChannel(channelId: string) {
    const orgId = getOrganizationId(); if (!orgId || !youtubePick) return;
    setBusy(`yt-pick-${channelId}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/social/accounts/youtube/select-channel`, {
        method: "POST",
        body: JSON.stringify({ state: youtubePick.state, channelId }),
      });
      setYoutubePick(null);
      setNotice("YouTube Channel যুক্ত হয়েছে।");
      await loadAccounts();
    } catch (e) { setError(e instanceof Error ? e.message : "Channel যুক্ত করা যায়নি"); }
    finally { setBusy(""); }
  }

  // --- SP3 AI copy --------------------------------------------------------------

  const loadAiProducts = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    // Products list() returns { total, page, pageSize, items } —
    // adapt defensively in case the shape is a bare array.
    const res = await apiFetch<unknown>(`/organizations/${orgId}/products?pageSize=100`);
    const list: unknown[] = Array.isArray(res) ? res : Array.isArray((res as { items?: unknown[] })?.items) ? (res as { items: unknown[] }).items : [];
    setAiProducts(list.filter((p): p is AiProductOption => !!p && typeof p === "object" && typeof (p as AiProductOption).id === "string" && typeof (p as AiProductOption).name === "string"));
    setAiProductsLoaded(true);
  }, []);

  const loadHashtagSets = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setHashtagSets(await apiFetch<HashtagSet[]>(`/organizations/${orgId}/social/hashtag-sets`));
  }, []);

  // SU4: own-data hashtag insights — auxiliary, failing silently
  // so a failure never breaks the rest of the AI panel.
  const loadHashtagInsights = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setHashtagInsights(await apiFetch<HashtagInsight>(`/organizations/${orgId}/social/insights/hashtags`));
  }, []);

  // SU4: keep a plan in state and pre-check every item that has
  // not been materialized yet.
  const applyContentPlan = useCallback((plan: ContentPlan | null) => {
    setContentPlan(plan);
    setPlanSelectedItems(plan ? Object.fromEntries(plan.items.map((item, i) => [i, !item.materializedPostId])) : {});
  }, []);

  // SU4: the latest saved plan on panel open — silent on failure.
  const loadContentPlans = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    const plans = await apiFetch<ContentPlan[]>(`/organizations/${orgId}/social/content-plans`);
    if (Array.isArray(plans) && plans.length > 0) applyContentPlan(plans[0]);
  }, [applyContentPlan]);

  function toggleAiPanel() {
    const next = !showAiPanel;
    setShowAiPanel(next);
    if (next) {
      // Lazily load products + hashtag sets when the panel opens.
      if (!aiProductsLoaded) loadAiProducts().catch((e) => setError(e instanceof Error ? e.message : "Product লোড ব্যর্থ হয়েছে"));
      loadHashtagSets().catch(() => undefined);
      loadHashtagInsights().catch(() => undefined);
      loadContentPlans().catch(() => undefined);
    }
  }

  async function generateContentPlan() {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!planMonth) { setError("আগে মাস বেছে নিন।"); return; }
    setBusy("ai-plan"); setError("");
    try {
      const pillars = planPillars.split(",").map((p) => p.trim()).filter(Boolean);
      const res = await apiFetch<{ plan: ContentPlan; provider: string; droppedItems: number }>(
        `/organizations/${orgId}/social/posts/ai-content-plan`, {
          method: "POST",
          body: JSON.stringify({
            month: planMonth,
            pillars: pillars.length > 0 ? pillars : undefined,
            focus: planFocus.trim() || undefined,
          }),
        });
      applyContentPlan(res.plan);
      if (res.droppedItems > 0) {
        setNotice(`Content Plan তৈরি হয়েছে — তবে ${res.droppedItems.toLocaleString("bn-BD")}টি item যাচাইয়ে বাদ গেছে।`);
      } else {
        setNotice("মাসের Content Plan তৈরি হয়েছে।");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Content Plan তৈরি ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  async function materializeContentPlan() {
    const orgId = getOrganizationId(); if (!orgId || !contentPlan) return;
    const itemIndexes = contentPlan.items.map((_, i) => i).filter((i) => planSelectedItems[i]);
    if (itemIndexes.length === 0) { setError("আগে অন্তত একটি Plan item বেছে নিন।"); return; }
    if (!planAccountId) { setError("আগে Draft-এর জন্য একটি অ্যাকাউন্ট বেছে নিন।"); return; }
    setBusy("ai-plan-materialize"); setError("");
    try {
      const res = await apiFetch<{ results: { index: number; status: "created" | "skipped" | "failed"; postId?: string; error?: string }[]; plan: ContentPlan }>(
        `/organizations/${orgId}/social/content-plans/${contentPlan.id}/materialize`, {
          method: "POST",
          body: JSON.stringify({ itemIndexes, socialAccountId: planAccountId }),
        });
      if (res.plan) applyContentPlan(res.plan);
      const created = res.results.filter((r) => r.status === "created").length;
      const skipped = res.results.filter((r) => r.status === "skipped").length;
      const failed = res.results.filter((r) => r.status === "failed");
      setNotice(`Draft তৈরি সম্পন্ন: ${created.toLocaleString("bn-BD")}টি তৈরি হয়েছে, ${skipped.toLocaleString("bn-BD")}টি বাদ দেওয়া হয়েছে (skipped), ${failed.length.toLocaleString("bn-BD")}টি ব্যর্থ।`);
      if (failed.length > 0) {
        setError(failed.map((r) => r.error ?? "অজানা ত্রুটি").join(" · "));
      }
      await loadPosts().catch(() => undefined);
      await loadContentPlans().catch(() => undefined);
    } catch (e) { setError(e instanceof Error ? e.message : "Draft তৈরি ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  async function generateAiScript() {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!scriptTopic.trim()) { setError("আগে Script-এর বিষয় (Topic) লিখুন।"); return; }
    setBusy("ai-script"); setError("");
    try {
      const res = await apiFetch<AiScriptResult>(`/organizations/${orgId}/social/posts/ai-script`, {
        method: "POST",
        body: JSON.stringify({
          productId: scriptProductId || undefined,
          topic: scriptTopic.trim(),
          language: aiLanguage,
        }),
      });
      setAiScript(res);
    } catch (e) { setError(e instanceof Error ? e.message : "Script তৈরি ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  async function generateAiCopy() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const selectedAccount = accounts.find((a) => accountSelected[a.id]);
    setBusy("ai-generate"); setError("");
    try {
      const res = await apiFetch<AiCopyResponse>(`/organizations/${orgId}/social/posts/ai-copy`, {
        method: "POST",
        body: JSON.stringify({
          productId: aiProductId || undefined,
          topic: aiTopic.trim() || undefined,
          language: aiLanguage,
          count: aiCount,
          platform: selectedAccount?.platform,
        }),
      });
      setAiVariants(res.variants);
      setAiHashtags(res.hashtags ?? []);
      setSelectedHashtags([]); // none selected by default
      setAiNotice(res.notice ?? "");
    } catch (e) { setError(e instanceof Error ? e.message : "AI Caption তৈরি ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  function toggleHashtag(tag: string) {
    setSelectedHashtags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  }

  function applyHashtagSet(set: HashtagSet) {
    setSelectedHashtags(set.tags.map((t) => t.startsWith("#") ? t : `#${t}`));
  }

  async function saveHashtagSet() {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!hashtagSetName.trim()) { setError("Set-এর নাম দিন।"); return; }
    if (selectedHashtags.length === 0) { setError("আগে অন্তত একটি Hashtag বেছে নিন।"); return; }
    setBusy("ai-save-set"); setError("");
    try {
      await apiFetch<HashtagSet>(`/organizations/${orgId}/social/hashtag-sets`, {
        method: "POST",
        body: JSON.stringify({ name: hashtagSetName.trim(), tags: selectedHashtags }),
      });
      setHashtagSetName("");
      setNotice("Hashtag Set সংরক্ষণ হয়েছে।");
      await loadHashtagSets();
    } catch (e) { setError(e instanceof Error ? e.message : "Hashtag Set সংরক্ষণ ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  function useAiCaption(variant: AiCopyVariant) {
    setCaption(selectedHashtags.length > 0 ? `${variant.caption}\n\n${selectedHashtags.join(" ")}` : variant.caption);
  }

  // SP4 blocks live in the media section and share the SP3 product
  // list — load it once for all three panels (never fetched twice).
  useEffect(() => {
    if (!aiProductsLoaded) loadAiProducts().catch(() => undefined);
  }, [aiProductsLoaded, loadAiProducts]);

  // --- Composer ---------------------------------------------------------------

  function attachMedia(item: SelectedMedia) {
    setSelectedMedia((prev) => {
      if (prev.some((m) => m.assetId === item.assetId)) return prev;
      if (prev.length >= MAX_MEDIA) {
        setError(`সর্বোচ্চ ${MAX_MEDIA}টি মিডিয়া যোগ করা যাবে।`);
        return prev;
      }
      return [...prev, item];
    });
  }

  async function uploadMedia(file: File) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (selectedMedia.length >= MAX_MEDIA) { setError(`সর্বোচ্চ ${MAX_MEDIA}টি মিডিয়া যোগ করা যাবে।`); return; }
    setBusy("upload"); setError("");
    try {
      // PP2: the file itself is the request body — the API streams
      // it into storage, so even a 256 MB video never becomes a
      // base64 JSON payload (the old path capped everything at
      // ~2.1 MB). apiFetch is JSON-only, hence the direct fetch
      // (same pattern as MediaThumb).
      const res = await fetch(`${API_URL}/organizations/${orgId}/social/media/upload-file?fileName=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}`, "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(typeof data?.message === "string" ? data.message : "আপলোড ব্যর্থ হয়েছে");
      }
      const asset = (await res.json()) as MediaAsset;
      attachMedia({ assetId: asset.id, kind: asset.kind, name: asset.name });
      setAssets((prev) => [asset, ...prev.filter((a) => a.id !== asset.id)]);
      setNotice(`“${asset.name}” আপলোড হয়ে পোস্টে যোগ হয়েছে।`);
    } catch (e) { setError(e instanceof Error ? e.message : "আপলোড ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  // PP1: SVG asset-এর PNG সংস্করণ তৈরি — তৈরি PNG লাইব্রেরিতে যোগ
  // হয়, তারপর সেটি সরাসরি Post-এ বেছে নেওয়া যায় (Meta/Instagram
  // SVG প্রকাশ করতে পারে না)।
  async function rasterizeMedia(asset: MediaAsset) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`rasterize-${asset.id}`); setError(""); setNotice("");
    try {
      const png = await apiFetch<MediaAsset>(`/organizations/${orgId}/social/media/${asset.id}/rasterize`, {
        method: "POST",
      });
      setAssets((prev) => [png, ...prev.filter((a) => a.id !== png.id)]);
      setNotice(`“${png.name}” তৈরি হয়েছে — এখন এটি Post-এ ব্যবহার করা যাবে।`);
    } catch (e) { setError(e instanceof Error ? e.message : "PNG সংস্করণ তৈরি ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  // --- SU3 Media Library v2 ---------------------------------------------------

  async function createMediaFolder() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const name = window.prompt("নতুন ফোল্ডারের নাম দিন:");
    if (!name || !name.trim()) return;
    setBusy("folder-create"); setError("");
    try {
      await apiFetch<MediaFolder>(`/organizations/${orgId}/social/media/folders`, {
        method: "POST", body: JSON.stringify({ name: name.trim() }),
      });
      setNotice(`“${name.trim()}” ফোল্ডার তৈরি হয়েছে।`);
      await loadMediaFolders();
    } catch (e) { setError(e instanceof Error ? e.message : "ফোল্ডার তৈরি ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  async function deleteMediaFolder(folder: MediaFolder) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(`“${folder.name}” ফোল্ডারটি মুছবেন?\n\nএই ফোল্ডারের asset-গুলো মুছে যাবে না — সেগুলো ফোল্ডারহীন হয়ে যাবে।`)) return;
    setBusy(`folder-delete-${folder.id}`); setError("");
    try {
      await apiFetch<{ deleted: boolean }>(`/organizations/${orgId}/social/media/folders/${folder.id}`, { method: "DELETE" });
      if (mediaFolderFilter === folder.id) {
        setMediaFolderFilter("");
        mediaFiltersRef.current = { ...mediaFiltersRef.current, folderId: undefined };
      }
      setNotice(`“${folder.name}” ফোল্ডার মোছা হয়েছে — এর asset-গুলো এখন ফোল্ডারহীন।`);
      await Promise.all([loadMediaFolders().catch(() => undefined), loadAssets().catch(() => undefined)]);
    } catch (e) { setError(e instanceof Error ? e.message : "ফোল্ডার মোছা ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  function selectMediaFolder(folderId: string) {
    setMediaFolderFilter(folderId);
    mediaFiltersRef.current = { ...mediaFiltersRef.current, folderId: folderId || undefined };
    loadAssets().catch(() => undefined);
  }

  function applyMediaFilters() {
    mediaFiltersRef.current = {
      folderId: mediaFolderFilter || undefined,
      tag: mediaTagInput.trim() || undefined,
      q: mediaSearchInput.trim() || undefined,
    };
    loadAssets().catch(() => undefined);
  }

  function clearMediaFilters() {
    setMediaFolderFilter("");
    setMediaSearchInput("");
    setMediaTagInput("");
    mediaFiltersRef.current = {};
    loadAssets().catch(() => undefined);
  }

  async function updateAssetTags(asset: MediaAsset) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const input = window.prompt("ট্যাগগুলো কমা দিয়ে লিখুন:", formatMediaTags(asset.tags ?? []));
    if (input === null) return;
    const tags = parseMediaTagsInput(input);
    setBusy(`tags-${asset.id}`); setError("");
    try {
      const updated = await apiFetch<MediaAsset>(`/organizations/${orgId}/social/media/${asset.id}`, {
        method: "PATCH", body: JSON.stringify({ tags }),
      });
      setAssets((prev) => prev.map((a) => (a.id === asset.id ? { ...a, ...updated } : a)));
      setNotice(`“${asset.name}”-এর ট্যাগ হালনাগাদ হয়েছে।`);
    } catch (e) { setError(e instanceof Error ? e.message : "ট্যাগ হালনাগাদ ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  async function changeAssetFolder(asset: MediaAsset, folderId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`folder-${asset.id}`); setError("");
    try {
      const updated = await apiFetch<MediaAsset>(`/organizations/${orgId}/social/media/${asset.id}`, {
        method: "PATCH", body: JSON.stringify({ folderId: folderId || null }),
      });
      setAssets((prev) => prev.map((a) => (a.id === asset.id ? { ...a, ...updated } : a)));
      await loadMediaFolders().catch(() => undefined);
    } catch (e) { setError(e instanceof Error ? e.message : "ফোল্ডার বদল ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  async function loadAssetUsage(asset: MediaAsset) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`usage-${asset.id}`); setError("");
    try {
      const usage = await apiFetch<MediaUsage>(`/organizations/${orgId}/social/media/${asset.id}/usage`);
      setUsageByAsset((prev) => ({ ...prev, [asset.id]: usage }));
    } catch (e) { setError(e instanceof Error ? e.message : "ব্যবহারের তথ্য লোড ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  async function cropAsset(asset: MediaAsset) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const aspect = assetAspect[asset.id] ?? "1:1";
    setBusy(`crop-${asset.id}`); setError(""); setNotice("");
    try {
      const derived = await apiFetch<MediaAsset>(`/organizations/${orgId}/social/media/${asset.id}/edit`, {
        method: "POST", body: JSON.stringify({ aspect }),
      });
      setAssets((prev) => [derived, ...prev.filter((a) => a.id !== derived.id)]);
      setNotice("নতুন সংস্করণ তৈরি হয়েছে (আসলটি অপরিবর্তিত)");
    } catch (e) { setError(e instanceof Error ? e.message : "Crop করা ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  async function captureAssetCover(asset: MediaAsset) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`cover-${asset.id}`); setError(""); setNotice("");
    try {
      const cover = await apiFetch<MediaAsset>(`/organizations/${orgId}/social/media/${asset.id}/cover`, {
        method: "POST", body: JSON.stringify({ atSeconds: 1 }),
      });
      setAssets((prev) => [cover, ...prev.filter((a) => a.id !== cover.id)]);
      setNotice(`“${cover.name}” Cover ছবি তৈরি হয়েছে।`);
    } catch (e) { setError(e instanceof Error ? e.message : "Cover তোলা ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  function toggleBulkSelected(assetId: string) {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId); else next.add(assetId);
      return next;
    });
  }

  async function runBulkAction(action: "move" | "delete") {
    const orgId = getOrganizationId(); if (!orgId) return;
    const ids = Array.from(bulkSelected);
    if (ids.length === 0) return;
    if (action === "delete" && !window.confirm(`${ids.length.toLocaleString("bn-BD")}টি মিডিয়া মুছে ফেলবেন? এটি আর ফিরিয়ে আনা যাবে না।`)) return;
    setBusy(`bulk-${action}`); setError(""); setNotice("");
    try {
      const res = await apiFetch<{ results: MediaBulkResult[] }>(`/organizations/${orgId}/social/media/bulk`, {
        method: "POST",
        body: JSON.stringify(action === "move" ? { ids, action, folderId: bulkFolderId || null } : { ids, action }),
      });
      setNotice(summarizeBulkResults(res.results));
      const failed = (res.results ?? []).filter((r) => !r.ok);
      if (failed.length > 0) {
        setError(failed.map((r) => r.error ?? "অজানা ত্রুটি").join(" · "));
      }
      setBulkSelected(new Set());
      await Promise.all([loadAssets().catch(() => undefined), loadMediaFolders().catch(() => undefined)]);
    } catch (e) { setError(e instanceof Error ? e.message : "Bulk কাজ ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  // PP3: Product-এর ছবি তার বাইরের URL থেকে Media Library-তে
  // import করা — import হওয়া asset লাইব্রেরিতে যোগ হয় এবং
  // সরাসরি এই Post-এর জন্য বেছে নেওয়া হয়। Server-এর Bengali
  // error হুবহু picker-এর ভেতরেই দেখানো হয়।
  async function importProductImage() {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!importProductId) { setImportError("আগে একটি Product বেছে নিন।"); return; }
    setBusy("import-media"); setImportError(""); setError("");
    try {
      const asset = await apiFetch<MediaAsset>(`/organizations/${orgId}/social/media/import`, {
        method: "POST",
        body: JSON.stringify({ productId: importProductId }),
      });
      setAssets((prev) => [asset, ...prev.filter((a) => a.id !== asset.id)]);
      attachMedia({ assetId: asset.id, kind: asset.kind, name: asset.name });
      setNotice(`“${asset.name}” import হয়ে Post-এ যোগ হয়েছে।`);
    } catch (e) { setImportError(e instanceof Error ? e.message : "ছবি import ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  // --- SP4 image creation ------------------------------------------------------

  async function generateAiImage() {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!aiImagePrompt.trim()) { setError("ছবির বর্ণনা (Prompt) দিন।"); return; }
    setBusy("ai-image"); setError("");
    try {
      const asset = await apiFetch<MediaAsset>(`/organizations/${orgId}/social/media/ai-image`, {
        method: "POST",
        body: JSON.stringify({ prompt: aiImagePrompt, productId: aiImageProductId || undefined }),
      });
      await loadAssets().catch(() => undefined);
      if (selectedMedia.length < MAX_MEDIA) {
        attachMedia({ assetId: asset.id, kind: asset.kind, name: asset.name });
        setNotice("AI ছবি তৈরি হয়েছে এবং Post-এর জন্য বেছে নেওয়া হয়েছে।");
      } else {
        setNotice("AI ছবি তৈরি হয়েছে — তবে Post-এ ইতিমধ্যে সর্বোচ্চ মিডিয়া যোগ আছে, তাই Library থেকে পরে বেছে নিন।");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "AI ছবি তৈরি ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  async function createTemplatePoster() {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!templateHeadline.trim()) { setError("Poster-এর Headline দিন।"); return; }
    setBusy("template-image"); setError("");
    try {
      const asset = await apiFetch<MediaAsset>(`/organizations/${orgId}/social/media/template-image`, {
        method: "POST",
        body: JSON.stringify({
          mediaAssetId: templateAssetId || undefined,
          productId: templateProductId || undefined,
          headline: templateHeadline,
          // Empty input means "use the product's real price" —
          // so an empty subtext is NOT sent (the API treats an
          // explicit "" as "no subtext").
          subtext: templateSubtext.trim() ? templateSubtext : undefined,
        }),
      });
      setTemplatePoster(asset);
      await loadAssets().catch(() => undefined);
      setNotice("Template Poster তৈরি হয়েছে।");
    } catch (e) { setError(e instanceof Error ? e.message : "Template Poster তৈরি ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  function resetComposer() {
    setCaption("");
    setLinkUrl("");
    setSelectedMedia([]);
    setAccountSelected({});
    setEditingPostId(null);
    setFirstCommentText("");
    setRecurrenceFrequency("");
    setRecurrenceInterval(1);
    setVariantOverrides({});
    setYtTitle("");
    setYtTagsInput("");
    setYtCategoryId("");
    setYtIsShort(false);
    setCoverAssetId("");
    setIsStory(false);
    setYtPlaylistId("");
    setYtPlaylists([]);
    setYtPlaylistsAccountId("");
  }

  /** SU8: the composer's optional platform fields as a save payload. */
  function currentPlatformFields(mode: "create" | "update", isStoryApplicable: boolean) {
    return platformFieldsForSave({
      youtubeTitle: ytTitle,
      youtubeTags: parseYoutubeTagsInput(ytTagsInput),
      youtubeCategoryId: ytCategoryId,
      youtubeIsShort: ytIsShort,
      youtubePlaylistId: ytPlaylistId,
      coverAssetId,
      isStory,
      isStoryApplicable,
    }, mode);
  }

  function startEdit(p: Sp7SocialPost) {
    setEditingPostId(p.id);
    setCaption(p.caption);
    setLinkUrl(p.linkUrl ?? "");
    setSelectedMedia(p.mediaRefs.map((m) => {
      const asset = assets.find((a) => a.id === m.assetId);
      return { assetId: m.assetId, kind: m.kind, name: asset?.name };
    }));
    setAccountSelected({ [p.socialAccountId]: true });
    setFirstCommentText(p.firstCommentText ?? "");
    setRecurrenceFrequency(p.recurrenceFrequency ?? "");
    setRecurrenceInterval(p.recurrenceInterval ?? 1);
    setVariantOverrides({});
    setYtTitle(p.youtubeTitle ?? "");
    setYtTagsInput(youtubeTagsToInput(p.youtubeTags));
    setYtCategoryId(p.youtubeCategoryId ?? "");
    setYtIsShort(!!p.youtubeIsShort);
    setYtPlaylistId(p.youtubePlaylistId ?? "");
    setCoverAssetId(p.coverAssetId ?? "");
    setIsStory(!!p.isStory);
    setError("");
    setNotice("Draftটি Composer-এ লোড হয়েছে — বদলে “পরিবর্তন সংরক্ষণ করুন” চাপুন।");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveDraft() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const mediaRefs = selectedMedia.map((m) => ({ assetId: m.assetId, kind: m.kind }));
    setError("");
    if (editingPostId) {
      setBusy("save");
      try {
        const editingPost = posts.find((x) => x.id === editingPostId);
        const firstCommentApplies = editingPost ? isFirstCommentApplicable(editingPost.account?.platform ?? "") : false;
        await apiFetch(`/organizations/${orgId}/social/posts/${editingPostId}`, {
          method: "PATCH",
          body: JSON.stringify({
            caption,
            linkUrl: linkUrl.trim() || null,
            mediaRefs,
            firstCommentText: firstCommentApplies ? firstCommentText.trim() || null : undefined,
            recurrenceFrequency: recurrenceFrequency || null,
            recurrenceInterval: recurrenceFrequency ? recurrenceInterval : null,
            // SU8: update mode → empty platform fields clear as null.
            ...currentPlatformFields("update", (editingPost?.account?.platform ?? "") === "meta_page"),
          }),
        });
        setNotice("Draft-এর পরিবর্তন সংরক্ষণ হয়েছে।");
        resetComposer();
        await loadPosts();
      } catch (e) { setError(e instanceof Error ? e.message : "সংরক্ষণ ব্যর্থ হয়েছে"); }
      finally { setBusy(""); }
      return;
    }
    const targets = accounts.filter((a) => a.status === "connected" && accountSelected[a.id]);
    if (targets.length === 0) { setError("অন্তত একটি সংযুক্ত অ্যাকাউন্ট বেছে নিন।"); return; }
    setBusy("save");
    try {
      if (targets.length === 1) {
        // Single account — the original create path, now carrying
        // the SU1 first comment + recurrence fields.
        const a = targets[0];
        await apiFetch(`/organizations/${orgId}/social/posts`, {
          method: "POST",
          body: JSON.stringify({
            socialAccountId: a.id,
            caption,
            linkUrl: linkUrl.trim() || undefined,
            mediaRefs,
            firstCommentText: isFirstCommentApplicable(a.platform) ? firstCommentText.trim() || undefined : undefined,
            recurrenceFrequency: recurrenceFrequency || undefined,
            recurrenceInterval: recurrenceFrequency ? recurrenceInterval : undefined,
            // SU8: create mode → empty platform fields are omitted.
            ...currentPlatformFields("create", a.platform === "meta_page"),
          }),
        });
        setNotice("১টি অ্যাকাউন্টের জন্য Draft সংরক্ষণ হয়েছে।");
      } else {
        // SU1: multiple accounts — ONE group call; per-account
        // variant overrides are resolved by the pure helper.
        const payload = groupVariantsForSave(
          targets.map((a) => a.id),
          {
            caption,
            linkUrl: linkUrl.trim() || undefined,
            mediaRefs,
            firstCommentText,
            recurrenceFrequency: recurrenceFrequency || undefined,
            recurrenceInterval: recurrenceFrequency ? recurrenceInterval : undefined,
          },
          variantOverrides,
        );
        // SU8: carry the optional platform fields into every
        // variant; isStory মাত্র meta_page variant-এর জন্যই যায়।
        const pf = currentPlatformFields("create", targets.some((t) => t.platform === "meta_page"));
        const { isStory: storyFlag, ...pfRest } = pf;
        const payloadWithPlatform = {
          ...payload,
          variants: payload.variants.map((v, i) => ({
            ...v,
            ...pfRest,
            ...(targets[i]?.platform === "meta_page" && storyFlag ? { isStory: true } : {}),
          })),
        };
        const res = await apiFetch<{ group: unknown; posts: unknown[] }>(`/organizations/${orgId}/social/posts/group`, {
          method: "POST",
          body: JSON.stringify(payloadWithPlatform),
        });
        const count = Array.isArray(res.posts) ? res.posts.length : targets.length;
        setNotice(`Group তৈরি হয়েছে: ${count.toLocaleString("bn-BD")}টি অ্যাকাউন্টের জন্য Draft সংরক্ষণ হয়েছে।`);
      }
      resetComposer();
      await loadPosts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Draft সংরক্ষণ ব্যর্থ হয়েছে");
      // A group may partially exist server-side — refresh the list
      // so the user sees exactly what was saved.
      await loadPosts().catch(() => undefined);
    } finally { setBusy(""); }
  }

  async function deletePost(p: Sp7SocialPost) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm("এই Draftটি মুছে ফেলবেন? এটি আর ফিরিয়ে আনা যাবে না।")) return;
    setBusy(`delete-${p.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/social/posts/${p.id}`, { method: "DELETE" });
      if (editingPostId === p.id) resetComposer();
      setNotice("Draft মোছা হয়েছে।");
      await loadPosts();
    } catch (e) { setError(e instanceof Error ? e.message : "মুছতে ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  // --- SU1/SU2 clone / queue / best-time / evergreen / slots ------------------

  async function clonePost(p: Sp7SocialPost) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`clone-${p.id}`); setError("");
    try {
      const created = await apiFetch<Sp7SocialPost>(`/organizations/${orgId}/social/posts/${p.id}/clone`, { method: "POST" });
      setPosts((prev) => [created, ...prev.filter((x) => x.id !== created.id)]);
      setNotice("পোস্টটির একটি নতুন Draft কপি (Clone) তৈরি হয়েছে।");
      await loadPosts().catch(() => undefined);
    } catch (e) { setError(e instanceof Error ? e.message : "Clone করা ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  async function addToQueue(p: Sp7SocialPost) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`queue-${p.id}`); setError("");
    try {
      // The server picks the next free slot for this account in the
      // org timezone; if there is no usable slot it answers 400 and
      // that honest message is surfaced verbatim via `error`.
      const updated = await apiFetch<Sp7SocialPost>(`/organizations/${orgId}/social/posts/${p.id}/add-to-queue`, { method: "POST" });
      upsertPost(updated);
      setNotice(`পোস্টটি Queue-তে যোগ হয়েছে${updated.scheduledAt ? ` — শিডিউল: ${fmtInTz(updated.scheduledAt)} (${orgTz})` : ""}।`);
      await loadPosts().catch(() => undefined);
    } catch (e) { setError(e instanceof Error ? e.message : "Queue-তে যোগ করা ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  async function scheduleBestTime(p: Sp7SocialPost) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`best-time-${p.id}`); setError("");
    try {
      const updated = await apiFetch<Sp7SocialPost>(`/organizations/${orgId}/social/posts/${p.id}/schedule-best-time`, { method: "POST" });
      upsertPost(updated);
      setNotice(`পোস্টটি সেরা সময়ে শিডিউল হয়েছে${updated.scheduledAt ? ` — ${fmtInTz(updated.scheduledAt)} (${orgTz})` : ""}।`);
      await loadPosts().catch(() => undefined);
    } catch (e) { setError(e instanceof Error ? e.message : "সেরা সময়ে শিডিউল করা ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  function evergreenFormFor(p: Sp7SocialPost): EvergreenFormState {
    return evergreenForms[p.id] ?? {
      isEvergreen: !!p.isEvergreen,
      minGapDays: p.evergreenMinGapDays != null ? String(p.evergreenMinGapDays) : "",
      maxCycles: p.evergreenMaxCycles != null ? String(p.evergreenMaxCycles) : "",
    };
  }

  async function saveEvergreen(p: Sp7SocialPost) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const form = evergreenFormFor(p);
    const minGap = form.minGapDays.trim() ? Number(form.minGapDays) : undefined;
    const maxCycles = form.maxCycles.trim() ? Number(form.maxCycles) : undefined;
    setBusy(`evergreen-${p.id}`); setError("");
    try {
      const updated = await apiFetch<Sp7SocialPost>(`/organizations/${orgId}/social/posts/${p.id}/evergreen`, {
        method: "POST",
        body: JSON.stringify({
          isEvergreen: form.isEvergreen,
          evergreenMinGapDays: minGap != null && Number.isFinite(minGap) ? minGap : undefined,
          evergreenMaxCycles: maxCycles != null && Number.isFinite(maxCycles) ? maxCycles : undefined,
        }),
      });
      upsertPost(updated);
      setEvergreenForms((s) => { const next = { ...s }; delete next[p.id]; return next; });
      setNotice(updated.isEvergreen ? "পোস্টটি Evergreen হিসেবে চিহ্নিত হয়েছে।" : "পোস্টটির Evergreen চিহ্ন সরানো হয়েছে।");
      await loadPosts().catch(() => undefined);
    } catch (e) { setError(e instanceof Error ? e.message : "Evergreen সংরক্ষণ ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  async function createPostingSlot() {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!slotAccountId) { setError("আগে একটি অ্যাকাউন্ট বেছে নিন।"); return; }
    if (!slotTime) { setError("সময় দিন।"); return; }
    setBusy("slot-create"); setError("");
    try {
      await apiFetch<SocialPostingSlot>(`/organizations/${orgId}/social/posting-slots`, {
        method: "POST",
        body: JSON.stringify({ socialAccountId: slotAccountId, weekday: slotWeekday, time: slotTime, enabled: true }),
      });
      setNotice("Posting Slot যোগ হয়েছে।");
      await loadPostingSlots();
    } catch (e) { setError(e instanceof Error ? e.message : "Slot যোগ করা ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  async function togglePostingSlot(slot: SocialPostingSlot, enabled: boolean) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`slot-${slot.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/social/posting-slots/${slot.id}`, {
        method: "PATCH", body: JSON.stringify({ enabled }),
      });
      await loadPostingSlots();
    } catch (e) { setError(e instanceof Error ? e.message : "Slot হালনাগাদ ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  async function deletePostingSlot(slot: SocialPostingSlot) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`slot-${slot.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/social/posting-slots/${slot.id}`, { method: "DELETE" });
      setNotice("Posting Slot মোছা হয়েছে।");
      await loadPostingSlots();
    } catch (e) { setError(e instanceof Error ? e.message : "Slot মোছা ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  // --- SP5 schedule / publish actions ---------------------------------------

  const fmtInTz = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("bn-BD", { timeZone: orgTz }) : "");

  async function doSchedule(p: Sp7SocialPost) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const value = scheduleInputs[p.id] || (p.scheduledAt ? utcToLocalInput(p.scheduledAt, orgTz) : "");
    if (!value) { setError("আগে তারিখ ও সময় বেছে নিন।"); return; }
    setBusy(`schedule-${p.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/social/posts/${p.id}/schedule`, {
        method: "POST",
        body: JSON.stringify({ scheduledAt: localInputToUtcIso(value, orgTz) }),
      });
      setNotice("পোস্টটি শিডিউল করা হয়েছে — নির্ধারিত সময়ে প্রকাশ হবে (Social Post Publisher Job চালু থাকলে)।");
      await loadPosts();
    } catch (e) { setError(e instanceof Error ? e.message : "শিডিউল করা ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  async function doCancelSchedule(p: Sp7SocialPost) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`cancel-schedule-${p.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/social/posts/${p.id}/cancel-schedule`, { method: "POST" });
      setNotice("শিডিউল বাতিল হয়েছে — পোস্টটি আবার Draft অবস্থায় আছে।");
      await loadPosts();
    } catch (e) { setError(e instanceof Error ? e.message : "শিডিউল বাতিল ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  async function doPublishNow(p: Sp7SocialPost) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm("এই পোস্টটি এখনই Facebook/Instagram-এ সবার জন্য প্রকাশিত হবে। নিশ্চিত তো?")) return;
    setBusy(`publish-${p.id}`); setError("");
    try {
      // The response IS the updated post — report its real outcome,
      // never assume success.
      const updated = await apiFetch<Sp7SocialPost>(`/organizations/${orgId}/social/posts/${p.id}/publish-now`, { method: "POST" });
      if (updated.status === "published") {
        setNotice("পোস্টটি প্রকাশিত হয়েছে।");
      } else if (updated.status === "failed") {
        setError(updated.error ?? "পোস্টটি প্রকাশ করা যায়নি।");
      } else if (updated.status === "scheduled") {
        setNotice(`প্রকাশের চেষ্টা ব্যর্থ হয়েছে — পোস্টটি আবার শিডিউল করা হয়েছে${updated.scheduledAt ? `: ${fmtInTz(updated.scheduledAt)}` : ""}। নির্ধারিত সময়ে আবার চেষ্টা করা হবে।`);
      } else {
        setNotice(`পোস্টটির বর্তমান অবস্থা: ${POST_STATUS_META[updated.status]?.label ?? updated.status}`);
      }
      await loadPosts();
    } catch (e) { setError(e instanceof Error ? e.message : "প্রকাশ ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  // --- SP7 insights refresh + approval actions ------------------------------

  function upsertPost(updated: Sp7SocialPost) {
    setPosts((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
  }

  async function refreshPostInsights(p: Sp7SocialPost) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`insights-${p.id}`); setError("");
    try {
      const updated = await apiFetch<Sp7SocialPost>(`/organizations/${orgId}/social/posts/${p.id}/refresh-insights`, { method: "POST" });
      upsertPost(updated);
      setNotice("Post-এর data হালনাগাদ হয়েছে।");
      await loadInsightsSummary().catch(() => undefined);
    } catch (e) { setError(e instanceof Error ? e.message : "Data হালনাগাদ ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  async function refreshAllInsights() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("insights-bulk"); setError("");
    try {
      const res = await apiFetch<{ total: number; refreshed: number; failed: number; skippedTooNew: number }>(
        `/organizations/${orgId}/social/posts/refresh-insights`, { method: "POST" });
      setNotice(`Data হালনাগাদ সম্পন্ন: ${res.refreshed.toLocaleString("bn-BD")}টি হালনাগাদ হয়েছে, ${res.failed.toLocaleString("bn-BD")}টি ব্যর্থ, ${res.skippedTooNew.toLocaleString("bn-BD")}টি খুব নতুন বলে বাদ দেওয়া হয়েছে (মোট ${res.total.toLocaleString("bn-BD")}টি)।`);
      await Promise.all([loadPosts(), loadInsightsSummary().catch(() => undefined)]);
      loadAnalyticsTimeseries().catch(() => undefined);
      loadAnalyticsContentTypes().catch(() => undefined);
      loadAnalyticsAccounts().catch(() => undefined);
      loadAnalyticsFollowers().catch(() => undefined);
    } catch (e) { setError(e instanceof Error ? e.message : "Data হালনাগাদ ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  // --- SU7/SU8 (Batch 4): monthly report download + derive ---------------

  /**
   * Monthly report download — the established web pattern for
   * binary files (accounting CSV / orders PDF): apiFetch is
   * JSON-only, so fetch the blob directly with the Bearer token,
   * then click a temporary anchor with the filename.
   */
  async function downloadReport(format: "csv" | "pdf") {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!reportMonth) { setError("আগে মাস বেছে নিন।"); return; }
    setBusy(`report-${format}`); setError("");
    try {
      const res = await fetch(
        `${API_URL}/organizations/${orgId}/social/insights/report.${format}?month=${encodeURIComponent(reportMonth)}`,
        { headers: { Authorization: `Bearer ${getToken() ?? ""}` } },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `ডাউনলোড ব্যর্থ (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `social-report-${reportMonth}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setNotice(`✅ ${monthLabelBn(reportMonth)}-এর ${format.toUpperCase()} রিপোর্ট ডাউনলোড হয়েছে`);
    } catch (e) { setError(e instanceof Error ? e.message : "রিপোর্ট ডাউনলোড ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  /** SU8: derive new drafts for other accounts from this post's media. */
  async function derivePost(p: Sp7SocialPost) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const accountIds = accounts.filter((a) => a.id !== p.socialAccountId && deriveSelected[p.id]?.[a.id]).map((a) => a.id);
    if (accountIds.length === 0) { setError("আগে অন্তত একটি অন্য অ্যাকাউন্ট বেছে নিন।"); return; }
    setBusy(`derive-${p.id}`); setError("");
    try {
      const res = await apiFetch<DeriveResult>(`/organizations/${orgId}/social/posts/${p.id}/derive`, {
        method: "POST", body: JSON.stringify({ accountIds }),
      });
      const warnings = Array.isArray(res.warnings) ? res.warnings : [];
      setDeriveWarnings((s) => ({ ...s, [p.id]: warnings }));
      const createdCount = Array.isArray(res.created) ? res.created.length : 0;
      // Warnings are shown verbatim — in the panel AND in the notice.
      if (warnings.length > 0) {
        setNotice(`Derive সম্পন্ন: ${createdCount.toLocaleString("bn-BD")}টি নতুন Draft তৈরি হয়েছে। সতর্কতা: ${warnings.map((w) => w.message).join(" · ")}`);
      } else {
        setNotice(`Derive সম্পন্ন: ${createdCount.toLocaleString("bn-BD")}টি নতুন Draft তৈরি হয়েছে।`);
        setDeriveOpenId(null);
        setDeriveSelected((s) => { const next = { ...s }; delete next[p.id]; return next; });
      }
      await loadPosts().catch(() => undefined);
    } catch (e) { setError(e instanceof Error ? e.message : "Derive করা ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  async function saveApprovalSetting(next: boolean) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("approval-setting"); setError("");
    try {
      const res = await apiFetch<{ socialRequireApproval: boolean }>(`/organizations/${orgId}/social/settings`, {
        method: "PATCH", body: JSON.stringify({ socialRequireApproval: next }),
      });
      setRequireApproval(!!res.socialRequireApproval);
      setNotice(next ? "অনুমোদন ব্যবস্থা চালু হয়েছে।" : "অনুমোদন ব্যবস্থা বন্ধ হয়েছে।");
    } catch (e) {
      // e.g. 403 for non-OWNER/ADMIN — surface the API's own message
      // and leave the checkbox at the server's actual value.
      setError(e instanceof Error ? e.message : "সেটিং সংরক্ষণ ব্যর্থ হয়েছে");
      await loadSocialSettings().catch(() => undefined);
    } finally { setBusy(""); }
  }

  // SU9 web: the optional second approval step (Manager → Owner).
  async function saveApprovalTwoStep(next: boolean) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("approval-two-step"); setError("");
    try {
      const res = await apiFetch<{ socialRequireApproval: boolean; socialApprovalTwoStep: boolean }>(`/organizations/${orgId}/social/settings`, {
        method: "PATCH", body: JSON.stringify({ socialApprovalTwoStep: next }),
      });
      setApprovalTwoStep(!!res.socialApprovalTwoStep);
      setNotice(next ? "দুই-ধাপের অনুমোদন চালু হয়েছে (Manager → Owner)।" : "দুই-ধাপের অনুমোদন বন্ধ হয়েছে।");
    } catch (e) {
      setError(e instanceof Error ? e.message : "সেটিং সংরক্ষণ ব্যর্থ হয়েছে");
      await loadSocialSettings().catch(() => undefined);
    } finally { setBusy(""); }
  }

  // SN2 web: the optional client-approval requirement (third gate).
  async function saveRequireClientApproval(next: boolean) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("client-approval-requirement"); setError("");
    try {
      const res = await apiFetch<{ socialRequireClientApproval: boolean }>(`/organizations/${orgId}/social/settings`, {
        method: "PATCH", body: JSON.stringify({ socialRequireClientApproval: next }),
      });
      setRequireClientApproval(!!res.socialRequireClientApproval);
      setNotice(next ? "ক্লায়েন্ট অনুমোদন বাধ্যতামূলক করা হয়েছে — অনুমোদন ছাড়া publish/schedule আটকাবে।" : "ক্লায়েন্ট অনুমোদনের বাধ্যবাধকতা বন্ধ হয়েছে।");
    } catch (e) {
      setError(e instanceof Error ? e.message : "সেটিং সংরক্ষণ ব্যর্থ হয়েছে");
      await loadSocialSettings().catch(() => undefined);
    } finally { setBusy(""); }
  }

  // SU11: bulk selection + actions over the post list.
  function togglePostSelected(postId: string) {
    setSelectedPostIds((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId); else next.add(postId);
      return next;
    });
  }

  async function runPostsBulk(action: "delete_drafts" | "reschedule") {
    const orgId = getOrganizationId(); if (!orgId) return;
    const ids = Array.from(selectedPostIds);
    if (ids.length === 0) { setError("আগে তালিকা থেকে অন্তত একটি পোস্ট বেছে নিন।"); return; }
    if (action === "reschedule" && !bulkRescheduleAt) { setError("Reschedule করতে হলে আগে নতুন তারিখ ও সময় দিন।"); return; }
    setBusy(`posts-bulk-${action}`); setError("");
    try {
      const res = await apiFetch<BulkPostsResponse>(`/organizations/${orgId}/social/posts/bulk`, {
        method: "POST",
        body: JSON.stringify({
          ids, action,
          ...(action === "reschedule" ? { scheduledAt: localInputToUtcIso(bulkRescheduleAt, orgTz) } : {}),
        }),
      });
      setNotice(summarizeBulkPostResults(res, action === "delete_drafts" ? "Bulk Draft মোছা" : "Bulk Reschedule"));
      setSelectedPostIds(new Set());
      await loadPosts();
      loadFailureGroups().catch(() => undefined);
    } catch (e) { setError(e instanceof Error ? e.message : "Bulk কাজ ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  // SU11: CSV bulk draft import — the file's TEXT is the body
  // (Content-Type text/csv, so no JSON parser touches it; the
  // API reads the raw stream like media/upload-file).
  async function importPostsCsv(file: File) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("csv-import"); setError("");
    try {
      const text = await file.text();
      const res = await fetch(`${API_URL}/organizations/${orgId}/social/posts/import-csv`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}`, "Content-Type": "text/csv" },
        body: text,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? `Import ব্যর্থ হয়েছে (${res.status})`);
      }
      const data = (await res.json()) as CsvImportResponse;
      setCsvImportResults(data);
      setNotice(summarizeCsvImport(data));
      await loadPosts();
    } catch (e) { setError(e instanceof Error ? e.message : "CSV Import ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  // SU9 web: per-post detail (notes / versions / timeline),
  // loaded together the first time the panel opens for a post.
  // SN2: client share links for one post — loaded with the detail
  // panel; failures stay local (the rest of the detail still opens).
  async function loadShareLinks(postId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const links = await apiFetch<SocialShareLink[]>(`/organizations/${orgId}/social/posts/${postId}/share-links`);
      setShareLinksByPost((s) => ({ ...s, [postId]: links }));
    } catch { /* share list is auxiliary — detail opens without it */ }
  }

  async function createShareLink(p: Sp7SocialPost) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`share-create-${p.id}`); setError("");
    try {
      const created = await apiFetch<SocialShareLinkCreated>(`/organizations/${orgId}/social/posts/${p.id}/share-link`, {
        method: "POST", body: JSON.stringify({}),
      });
      setShareCreatedByPost((s) => ({ ...s, [p.id]: created }));
      setNotice("ক্লায়েন্ট শেয়ার লিংক তৈরি হয়েছে — লিংকটি এখনই কপি করে রাখুন।");
      await loadShareLinks(p.id);
    } catch (e) { setError(e instanceof Error ? e.message : "শেয়ার লিংক তৈরি করা যায়নি"); }
    finally { setBusy(""); }
  }

  async function createGroupShareLink(p: Sp7SocialPost) {
    const orgId = getOrganizationId(); if (!orgId || !p.postGroupId) return;
    setBusy(`share-group-${p.id}`); setError("");
    try {
      const created = await apiFetch<SocialShareLinkCreated>(`/organizations/${orgId}/social/post-groups/${p.postGroupId}/share-link`, {
        method: "POST", body: JSON.stringify({}),
      });
      setShareCreatedByPost((s) => ({ ...s, [p.id]: created }));
      setNotice("গ্রুপের ক্লায়েন্ট শেয়ার লিংক তৈরি হয়েছে — লিংকটি এখনই কপি করে রাখুন।");
    } catch (e) { setError(e instanceof Error ? e.message : "গ্রুপ শেয়ার লিংক তৈরি করা যায়নি"); }
    finally { setBusy(""); }
  }

  async function revokeShareLink(p: Sp7SocialPost, linkId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`share-revoke-${linkId}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/social/share-links/${linkId}`, { method: "DELETE" });
      setNotice("শেয়ার লিংক বাতিল করা হয়েছে।");
      await loadShareLinks(p.id);
    } catch (e) { setError(e instanceof Error ? e.message : "লিংক বাতিল করা যায়নি"); }
    finally { setBusy(""); }
  }

  async function togglePostDetail(p: Sp7SocialPost) {
    if (detailOpenId === p.id) { setDetailOpenId(null); return; }
    setDetailOpenId(p.id);
    void loadShareLinks(p.id);
    if (notesByPost[p.id] && versionsByPost[p.id] && timelineByPost[p.id]) return;
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`detail-${p.id}`);
    try {
      const [notes, versions, timeline] = await Promise.all([
        apiFetch<SocialPostNote[]>(`/organizations/${orgId}/social/posts/${p.id}/notes`),
        apiFetch<SocialPostVersion[]>(`/organizations/${orgId}/social/posts/${p.id}/versions`),
        apiFetch<SocialTimelineEntry[]>(`/organizations/${orgId}/social/posts/${p.id}/timeline`),
      ]);
      setNotesByPost((s) => ({ ...s, [p.id]: notes }));
      setVersionsByPost((s) => ({ ...s, [p.id]: versions }));
      setTimelineByPost((s) => ({ ...s, [p.id]: timeline }));
    } catch (e) { setError(e instanceof Error ? e.message : "বিস্তারিত লোড করা যায়নি"); }
    finally { setBusy(""); }
  }

  async function addPostNote(p: Sp7SocialPost) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const body = (noteInputs[p.id] ?? "").trim();
    if (!body) { setError("নোট খালি রাখা যাবে না — কিছু লিখুন।"); return; }
    setBusy(`note-add-${p.id}`); setError("");
    try {
      const note = await apiFetch<SocialPostNote>(`/organizations/${orgId}/social/posts/${p.id}/notes`, {
        method: "POST", body: JSON.stringify({ body }),
      });
      setNotesByPost((s) => ({ ...s, [p.id]: [...(s[p.id] ?? []), note] }));
      setNoteInputs((s) => ({ ...s, [p.id]: "" }));
    } catch (e) { setError(e instanceof Error ? e.message : "নোট যোগ করা যায়নি"); }
    finally { setBusy(""); }
  }

  async function deletePostNote(p: Sp7SocialPost, note: SocialPostNote) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`note-del-${note.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/social/posts/${p.id}/notes/${note.id}`, { method: "DELETE" });
      setNotesByPost((s) => ({ ...s, [p.id]: (s[p.id] ?? []).filter((n) => n.id !== note.id) }));
    } catch (e) { setError(e instanceof Error ? e.message : "নোট মোছা যায়নি"); }
    finally { setBusy(""); }
  }

  async function restorePostVersion(p: Sp7SocialPost, version: SocialPostVersion) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`version-restore-${version.id}`); setError("");
    try {
      const updated = await apiFetch<Sp7SocialPost>(`/organizations/${orgId}/social/posts/${p.id}/versions/${version.id}/restore`, { method: "POST" });
      upsertPost(updated);
      setNotice(`Version ${version.versionNo.toLocaleString("bn-BD")} ফিরিয়ে আনা হয়েছে — পোস্টটি আবার Draft অবস্থায় সম্পাদনা করা যাবে।`);
      // The restore itself adds a version + timeline entry.
      setVersionsByPost((s) => { const next = { ...s }; delete next[p.id]; return next; });
      setTimelineByPost((s) => { const next = { ...s }; delete next[p.id]; return next; });
      setDetailOpenId(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Version ফিরিয়ে আনা যায়নি"); }
    finally { setBusy(""); }
  }

  async function assignPost(p: Sp7SocialPost, assignedUserId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`assign-${p.id}`); setError("");
    try {
      const updated = await apiFetch<Sp7SocialPost>(`/organizations/${orgId}/social/posts/${p.id}/assign`, {
        method: "POST", body: JSON.stringify({ assignedUserId: assignedUserId || null }),
      });
      upsertPost(updated);
      setNotice(assignedUserId ? "দায়িত্ব দেওয়া হয়েছে।" : "দায়িত্ব সরানো হয়েছে।");
    } catch (e) { setError(e instanceof Error ? e.message : "দায়িত্ব দেওয়া যায়নি"); }
    finally { setBusy(""); }
  }

  function memberLabel(userId: string | null | undefined): string {
    if (!userId) return "কেউ নয়";
    const m = members.find((x) => x.user.id === userId);
    return m ? (m.user.name || m.user.email) : userId;
  }

  // SU10 web: on-demand health check for one account.
  async function checkAccountHealth(a: SocialAccount) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`health-${a.id}`); setError("");
    try {
      const res = await apiFetch<{ ok: boolean; status: string; error?: string | null }>(`/organizations/${orgId}/social/accounts/${a.id}/check-health`, { method: "POST" });
      setNotice(res.ok ? `“${a.name}”-এর স্বাস্থ্য ঠিক আছে।` : `“${a.name}”: ${res.error ?? "স্বাস্থ্য যাচাই ব্যর্থ হয়েছে"}`);
      await loadAccountHealth();
      await loadAccounts();
    } catch (e) { setError(e instanceof Error ? e.message : "স্বাস্থ্য যাচাই ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  // SU10 web: retry one failed post from the failure center.
  async function retryFailedPost(postId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`retry-${postId}`); setError("");
    try {
      const updated = await apiFetch<Sp7SocialPost>(`/organizations/${orgId}/social/posts/${postId}/retry`, { method: "POST" });
      upsertPost(updated);
      setNotice(updated.status === "published" ? "Retry সফল — পোস্টটি প্রকাশিত হয়েছে।" : `Retry সম্পন্ন — পোস্টের অবস্থা এখন: ${updated.status}`);
      loadFailureGroups().catch(() => undefined);
    } catch (e) { setError(e instanceof Error ? e.message : "Retry ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  /** SU5: save the Commerce Auto-Draft settings (OWNER/ADMIN on
   * the API side — a refusal's message is shown verbatim). */
  async function saveAutoDraftSettings() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("auto-draft-settings"); setError("");
    try {
      const res = await apiFetch<AutoDraftSettings>(`/organizations/${orgId}/social/auto-draft-settings`, {
        method: "PATCH", body: JSON.stringify(buildAutoDraftSettingsPayload(autoDraftForm)),
      });
      setAutoDraftForm(autoDraftFormFromSettings(res));
      setNotice("🤖 Commerce Auto-Draft সেটিং সংরক্ষণ হয়েছে।");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Auto-draft সেটিং সংরক্ষণ ব্যর্থ হয়েছে");
    } finally { setBusy(""); }
  }

  /** SU6: load one post's tracked-link stats on demand. */
  async function loadLinkStats(p: Sp7SocialPost) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`link-stats-${p.id}`); setError("");
    try {
      const stats = await apiFetch<SocialLinkStats>(`/organizations/${orgId}/social/posts/${p.id}/link-stats`);
      setLinkStatsById((s) => ({ ...s, [p.id]: stats }));
    } catch (e) { setError(e instanceof Error ? e.message : "Link stats লোড ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  async function submitApproval(p: Sp7SocialPost) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`submit-approval-${p.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/social/posts/${p.id}/submit-approval`, { method: "POST" });
      setNotice("পোস্টটি অনুমোদনের জন্য পাঠানো হয়েছে।");
      await loadPosts();
    } catch (e) { setError(e instanceof Error ? e.message : "অনুমোদনের জন্য পাঠানো ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  async function approvePost(p: Sp7SocialPost) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`approve-${p.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/social/posts/${p.id}/approve`, { method: "POST" });
      setNotice("পোস্টটি অনুমোদিত হয়েছে।");
      await loadPosts();
    } catch (e) { setError(e instanceof Error ? e.message : "অনুমোদন ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  async function rejectPost(p: Sp7SocialPost) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const note = (rejectNotes[p.id] ?? "").trim();
    if (!note) { setError("প্রত্যাখ্যান করতে হলে কারণ লেখা আবশ্যক।"); return; }
    setBusy(`reject-${p.id}`); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/social/posts/${p.id}/reject`, {
        method: "POST", body: JSON.stringify({ note }),
      });
      setRejectOpenId(null);
      setRejectNotes((s) => ({ ...s, [p.id]: "" }));
      setNotice("পোস্টটি প্রত্যাখ্যান করা হয়েছে।");
      await loadPosts();
    } catch (e) { setError(e instanceof Error ? e.message : "প্রত্যাখ্যান ব্যর্থ হয়েছে"); }
    finally { setBusy(""); }
  }

  /** SP7 approval badge (+ the rejection reason when there is one).
   * SD4: rendered through the ONE SD1 pill shape (ApprovalStatusPill
   * reads the same APPROVAL_STATUS_META — same label, same colours). */
  function renderApprovalBadge(p: Sp7SocialPost) {
    if (!p.approvalStatus) return null;
    return (
      <>
        <ApprovalStatusPill status={p.approvalStatus} />
        {p.approvalStatus === "rejected" && p.reviewNote ? (
          <span className="text-xs text-red-600">কারণ: {p.reviewNote}</span>
        ) : null}
      </>
    );
  }

  /** SP7 "অনুমোদনের জন্য পাঠান" button — drafts only, setting ON only. */
  function renderSubmitApproval(p: Sp7SocialPost) {
    if (!canSubmitForApproval(p, requireApproval)) return null;
    return (
      <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => submitApproval(p)}>
        {busy === `submit-approval-${p.id}` ? "পাঠানো হচ্ছে..." : "অনুমোদনের জন্য পাঠান"}
      </button>
    );
  }

  /** SU1: first-comment status badge + evergreen badge for a post.
   * SU5: + the Auto-draft badge when a commerce event created it. */
  function renderSuBadges(p: Sp7SocialPost) {
    const autoDraftBadge = autoDraftBadgeLabel(p.autoDraftKind);
    return (
      <>
        {p.isStory ? (
          <span className="rounded bg-pink-100 px-2 py-0.5 text-xs font-medium text-pink-700">📱 Story</span>
        ) : null}
        {autoDraftBadge ? (
          <span className="rounded bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">🤖 {autoDraftBadge}</span>
        ) : null}
        {p.firstCommentStatus === "pending" ? (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">প্রথম কমেন্ট অপেক্ষমাণ</span>
        ) : null}
        {p.firstCommentStatus === "posted" ? (
          <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">প্রথম কমেন্ট হয়েছে</span>
        ) : null}
        {p.firstCommentStatus === "failed" ? (
          <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700" title={p.firstCommentError ?? undefined}>
            প্রথম কমেন্ট ব্যর্থ{p.firstCommentError ? `: ${p.firstCommentError}` : ""}
          </span>
        ) : null}
        {p.isEvergreen ? (
          <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
            🌿 Evergreen{(p.evergreenCyclesUsed ?? 0) > 0 || p.evergreenMaxCycles != null
              ? ` · ${(p.evergreenCyclesUsed ?? 0).toLocaleString("bn-BD")}/${p.evergreenMaxCycles != null ? p.evergreenMaxCycles.toLocaleString("bn-BD") : "∞"} চক্র`
              : ""}
          </span>
        ) : null}
      </>
    );
  }

  /** SU1: Clone button — available for every status. */
  function renderCloneButton(p: Sp7SocialPost) {
    return (
      <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => clonePost(p)}>
        {busy === `clone-${p.id}` ? "Clone হচ্ছে..." : "📋 Clone"}
      </button>
    );
  }

  /** SU8: Derive button — only for posts that carry media. */
  function renderDeriveButton(p: Sp7SocialPost) {
    if (!p.mediaRefs || p.mediaRefs.length === 0) return null;
    return (
      <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""}
        onClick={() => { setDeriveOpenId((cur) => (cur === p.id ? null : p.id)); setError(""); }}>
        {deriveOpenId === p.id ? "Derive বন্ধ করুন" : "🔀 Derive"}
      </button>
    );
  }

  /**
   * SU8: Derive panel — pick OTHER accounts (the source account is
   * excluded) and create derived drafts from this post's media.
   * API warnings are displayed verbatim, never paraphrased away.
   */
  function renderDerivePanel(p: Sp7SocialPost) {
    if (deriveOpenId !== p.id) return null;
    if (!p.mediaRefs || p.mediaRefs.length === 0) return null;
    const others = accounts.filter((a) => a.id !== p.socialAccountId);
    const warnings = deriveWarnings[p.id] ?? [];
    return (
      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
        <div className="text-sm font-medium">🔀 অন্য অ্যাকাউন্টের জন্য Derive করুন</div>
        <p className="text-xs text-slate-500">এই পোস্টের মিডিয়া দিয়ে বেছে নেওয়া অ্যাকাউন্টগুলোর জন্য নতুন Draft তৈরি হবে। মূল পোস্টটি বদলাবে না।</p>
        {others.length === 0 ? (
          <div className="soc-empty-sm">
            <p className="text-sm text-slate-500">অন্য কোনো অ্যাকাউন্ট নেই — Derive করতে হলে আগে আরেকটি অ্যাকাউন্ট যুক্ত করুন।</p>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              {others.map((a) => (
                <label key={a.id} className="flex cursor-pointer items-center gap-2.5 text-sm">
                  <input type="checkbox" checked={deriveSelected[p.id]?.[a.id] ?? false}
                    onChange={(e) => setDeriveSelected((s) => ({ ...s, [p.id]: { ...(s[p.id] ?? {}), [a.id]: e.target.checked } }))} />
                  <span className="font-medium">{a.name}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{PLATFORM_LABELS[a.platform] ?? a.platform}</span>
                  {a.username ? <span className="text-xs text-slate-500">@{a.username}</span> : null}
                </label>
              ))}
            </div>
            <button type="button" className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => derivePost(p)}>
              {busy === `derive-${p.id}` ? "Derive হচ্ছে..." : "Derive করুন"}
            </button>
          </>
        )}
        {warnings.length > 0 ? (
          <div className="space-y-1 rounded-lg bg-amber-50 p-2.5">
            {warnings.map((w, i) => {
              const acc = accounts.find((a) => a.id === w.accountId);
              return (
                <p key={i} className="text-xs font-medium text-amber-800">
                  {acc ? `${acc.name}: ` : ""}{w.message}
                </p>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  /** SU2: evergreen controls — shown for drafts and published posts alike. */
  function renderEvergreenControls(p: Sp7SocialPost) {
    const form = evergreenFormFor(p);
    const setForm = (patch: Partial<EvergreenFormState>) =>
      setEvergreenForms((s) => ({ ...s, [p.id]: { ...evergreenFormFor(p), ...patch } }));
    return (
      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isEvergreen} onChange={(e) => setForm({ isEvergreen: e.target.checked })} />
            <span>🌿 Evergreen (মেয়াদ শেষে আবার ঘুরিয়ে পোস্ট হবে)</span>
          </label>
          <label className="block text-xs text-slate-500">ন্যূনতম ব্যবধান (দিন)
            <input type="number" min={1} className="input mt-1 w-28" value={form.minGapDays}
              onChange={(e) => setForm({ minGapDays: e.target.value })} placeholder="যেমন: ৭" />
          </label>
          <label className="block text-xs text-slate-500">সর্বোচ্চ চক্র
            <input type="number" min={1} className="input mt-1 w-28" value={form.maxCycles}
              onChange={(e) => setForm({ maxCycles: e.target.value })} placeholder="যেমন: ৩" />
          </label>
          <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => saveEvergreen(p)}>
            {busy === `evergreen-${p.id}` ? "সংরক্ষণ হচ্ছে..." : "Evergreen সংরক্ষণ করুন"}
          </button>
          {p.isEvergreen ? (
            <span className="pb-1 text-xs text-slate-500">
              এখন পর্যন্ত {(p.evergreenCyclesUsed ?? 0).toLocaleString("bn-BD")}টি চক্র হয়েছে
              {p.evergreenMaxCycles != null ? ` (সর্বোচ্চ ${p.evergreenMaxCycles.toLocaleString("bn-BD")}টি)` : ""}
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  /**
   * SP7 published-post insights — only the numbers the platform
   * actually returned. No insights yet → an honest "এখনো data
   * আসেনি", never invented zeros.
   */
  function renderInsights(p: Sp7SocialPost) {
    if (p.status !== "published") return null;
    const chips = insightChips(p.insights);
    return (
      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
        {chips.length > 0 ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <span key={c.key} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                  {c.label}: {c.value.toLocaleString("bn-BD")}
                </span>
              ))}
            </div>
            {p.insightsFetchedAt ? (
              <p className="text-xs text-slate-400">সর্বশেষ হালনাগাদ: {fmtInTz(p.insightsFetchedAt)} ({orgTz})</p>
            ) : null}
          </>
        ) : (
          <div className="soc-empty-sm">
            <p className="text-sm text-slate-500">এখনো data আসেনি</p>
          </div>
        )}
        <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => refreshPostInsights(p)}>
          {busy === `insights-${p.id}` ? "হালনাগাদ হচ্ছে..." : "🔄 Data হালনাগাদ করুন"}
        </button>
      </div>
    );
  }

  /**
   * SU6 tracked-link section — only for posts that carry a
   * linkUrl. Non-Meta platforms cannot take a clickable link, so
   * tracking honestly does not apply there; a Meta post without a
   * hasTrackedLink has no tracked link yet (it is minted at
   * schedule/publish). Loaded stats show real click counts and —
   * only when orders exist — the associated revenue, labelled
   * association, never attribution.
   */
  function renderLinkStats(p: Sp7SocialPost) {
    if (!p.linkUrl) return null;
    const platform = p.account?.platform as string | undefined;
    const nonTrackedNote = nonTrackedPlatformNote(platform);
    if (nonTrackedNote) {
      return (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="text-xs text-slate-500">🔗 Link: {nonTrackedNote}</p>
        </div>
      );
    }
    if (!p.hasTrackedLink) {
      return (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="text-xs text-slate-500">🔗 Link: Schedule/Publish হলে tracked link তৈরি হবে</p>
        </div>
      );
    }
    const stats = linkStatsById[p.id];
    return (
      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">🔗 Link</span>
          <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => loadLinkStats(p)}>
            {busy === `link-stats-${p.id}` ? "লোড হচ্ছে..." : stats ? "Stats হালনাগাদ করুন" : "Link stats দেখুন"}
          </button>
        </div>
        {stats ? (
          <div className="space-y-1">
            <p className="text-sm text-slate-700">{formatClicksLabel(stats.clicks)}</p>
            {stats.lastClickedAt ? (
              <p className="text-xs text-slate-400">শেষ click: {fmtInTz(stats.lastClickedAt)} ({orgTz})</p>
            ) : null}
            {formatOrdersRevenueLabel(stats) ? (
              <p className="text-sm text-slate-700">{formatOrdersRevenueLabel(stats)}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  function relativeLabel(iso?: string | null): string {
    if (!iso) return "";
    const now = Date.now();
    const key = orgDayKey(iso, orgTz);
    if (key === orgDayKey(new Date(now).toISOString(), orgTz)) return "আজ";
    if (key === orgDayKey(new Date(now + 86_400_000).toISOString(), orgTz)) return "আগামীকাল";
    const diffMs = new Date(iso).getTime() - now;
    if (diffMs < 0) return "সময় পেরিয়ে গেছে";
    const days = Math.round(diffMs / 86_400_000);
    if (days >= 1) return `${days.toLocaleString("bn-BD")} দিন পরে`;
    const hours = Math.max(1, Math.round(diffMs / 3_600_000));
    return `${hours.toLocaleString("bn-BD")} ঘণ্টা পরে`;
  }

  /** SP5 per-post schedule/publish controls — shared by the list
   * cards, the queue rows and the calendar detail card. */
  function renderPostActions(p: Sp7SocialPost) {
    if (p.status === "publishing") {
      return <p className="mt-3 border-t border-slate-100 pt-3 text-sm text-amber-700">প্রকাশের কাজ চলছে…</p>;
    }
    if (p.status !== "draft" && p.status !== "scheduled" && p.status !== "failed") return null;
    const inputValue = scheduleInputs[p.id] ?? (p.scheduledAt ? utcToLocalInput(p.scheduledAt, orgTz) : "");
    const scheduleLabel = p.status === "scheduled" ? "সময় বদলান" : p.status === "failed" ? "আবার শিডিউল করুন" : "শিডিউল করুন";
    return (
      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
        {p.status === "scheduled" && p.scheduledAt ? (
          <p className="text-sm text-slate-600">🕒 {fmtInTz(p.scheduledAt)} ({orgTz})</p>
        ) : null}
        {p.status === "failed" && (p.attempts ?? 0) > 0 ? (
          <p className="text-xs text-slate-500">এ পর্যন্ত {(p.attempts ?? 0).toLocaleString("bn-BD")} বার চেষ্টা হয়েছে</p>
        ) : null}
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-xs text-slate-500">তারিখ ও সময় ({orgTz})
            <input type="datetime-local" className="input mt-1" value={inputValue}
              onChange={(e) => setScheduleInputs((s) => ({ ...s, [p.id]: e.target.value }))} />
          </label>
          <button type="button" className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => doSchedule(p)}>
            {busy === `schedule-${p.id}` ? "শিডিউল হচ্ছে..." : scheduleLabel}
          </button>
          {p.status === "scheduled" ? (
            <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => doCancelSchedule(p)}>
              {busy === `cancel-schedule-${p.id}` ? "বাতিল হচ্ছে..." : "শিডিউল বাতিল করুন"}
            </button>
          ) : null}
          <button type="button" className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50" disabled={busy !== ""} onClick={() => doPublishNow(p)}>
            {busy === `publish-${p.id}` ? "প্রকাশ হচ্ছে..." : "এখনই প্রকাশ করুন"}
          </button>
          {p.status === "draft" ? (
            <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => addToQueue(p)}>
              {busy === `queue-${p.id}` ? "Queue-তে যাচ্ছে..." : "Queue-তে যোগ করুন"}
            </button>
          ) : null}
          {p.status === "draft" && insightsSummary?.bestTime ? (
            <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => scheduleBestTime(p)}>
              {busy === `best-time-${p.id}` ? "শিডিউল হচ্ছে..." : "🏆 সেরা সময়ে Schedule করুন"}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const filteredPosts = filterSocialPosts(posts, { query: filterQuery, status: filterStatus, accountId: filterAccountId });
  const calCells = monthCells(calCursor.y, calCursor.m);
  const calBuckets = bucketPostsByDay(posts, orgTz);
  const calMonthTitle = new Date(Date.UTC(calCursor.y, calCursor.m - 1, 1)).toLocaleDateString("bn-BD", { month: "long", year: "numeric", timeZone: "UTC" });
  const selectedPost = selectedPostId ? posts.find((p) => p.id === selectedPostId) ?? null : null;
  const queuePosts = posts.filter((p) => p.status === "scheduled").sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));
  // SU9: with two-step approval on, manager_approved posts also
  // wait in this queue — for the final (Owner) approval step.
  const pendingApprovalPosts = posts.filter((p) => p.approvalStatus === "pending" || p.approvalStatus === "manager_approved");
  const hasPublishedOrInsights = posts.some((p) => p.status === "published") || (insightsSummary?.postsWithInsights ?? 0) > 0;
  // SU7: Analytics v2 derived view data (pure helpers in lib/social-analytics).
  const analyticsBars = timeseriesBars(analyticsTimeseries?.series);
  const analyticsHasTimeseriesData = analyticsBars.some((b) => b.posts > 0);
  const followerHasGrowth = (analyticsFollowers?.accounts ?? []).some((a) => followerGrowth(a.snapshots) !== null);
  const connectedAccounts = accounts.filter((a) => a.status === "connected");
  // SU1: accounts the composer currently targets (in edit mode the
  // single owning account) — drives the first-comment input, the
  // variant panels and the live platform previews.
  const composerTargets = accounts.filter((a) => accountSelected[a.id] && (editingPostId !== null || a.status === "connected"));
  const showFirstCommentInput = composerTargets.some((a) => isFirstCommentApplicable(a.platform));
  const inputCls = "input mt-1";

  // SU11: the panel context — page.tsx keeps ALL state and
  // handlers; the components under components/ only render.
  const ctx = { accounts, setAccounts, posts, setPosts, assets, setAssets, error, setError, notice, setNotice, busy, setBusy, showConnect, setShowConnect, metaToken, setMetaToken, metaAppSource, setMetaAppSource, discovered, setDiscovered, pageSelected, setPageSelected, caption, setCaption, linkUrl, setLinkUrl, selectedMedia, setSelectedMedia, accountSelected, setAccountSelected, editingPostId, setEditingPostId, firstCommentText, setFirstCommentText, recurrenceFrequency, setRecurrenceFrequency, recurrenceInterval, setRecurrenceInterval, variantOverrides, setVariantOverrides, ytTitle, setYtTitle, ytTagsInput, setYtTagsInput, ytCategoryId, setYtCategoryId, ytIsShort, setYtIsShort, coverAssetId, setCoverAssetId, isStory, setIsStory, ytPlaylistId, setYtPlaylistId, ytPlaylists, ytPlaylistsAccountId, loadYouTubePlaylists, deriveOpenId, setDeriveOpenId, deriveSelected, setDeriveSelected, deriveWarnings, setDeriveWarnings, postingSlots, setPostingSlots, slotAccountId, setSlotAccountId, slotWeekday, setSlotWeekday, slotTime, setSlotTime, evergreenForms, setEvergreenForms, showLibrary, setShowLibrary, mediaFolders, setMediaFolders, mediaFolderFilter, setMediaFolderFilter, mediaSearchInput, setMediaSearchInput, mediaTagInput, setMediaTagInput, mediaFiltersRef, usageByAsset, setUsageByAsset, bulkSelected, setBulkSelected, bulkFolderId, setBulkFolderId, assetAspect, setAssetAspect, importProductId, setImportProductId, importError, setImportError, showAiPanel, setShowAiPanel, aiProducts, setAiProducts, aiProductsLoaded, setAiProductsLoaded, aiProductId, setAiProductId, aiTopic, setAiTopic, aiLanguage, setAiLanguage, aiCount, setAiCount, aiVariants, setAiVariants, aiNotice, setAiNotice, aiHashtags, setAiHashtags, selectedHashtags, setSelectedHashtags, hashtagSets, setHashtagSets, hashtagSetName, setHashtagSetName, hashtagInsights, setHashtagInsights, planMonth, setPlanMonth, planPillars, setPlanPillars, planFocus, setPlanFocus, contentPlan, setContentPlan, planSelectedItems, setPlanSelectedItems, planAccountId, setPlanAccountId, scriptTopic, setScriptTopic, scriptProductId, setScriptProductId, aiScript, setAiScript, imageStatus, setImageStatus, aiImagePrompt, setAiImagePrompt, aiImageProductId, setAiImageProductId, templateAssetId, setTemplateAssetId, templateHeadline, setTemplateHeadline, templateSubtext, setTemplateSubtext, templateProductId, setTemplateProductId, templatePoster, setTemplatePoster, filterQuery, setFilterQuery, filterStatus, setFilterStatus, filterAccountId, setFilterAccountId, orgTz, setOrgTz, viewMode, setViewMode, calCursor, setCalCursor, scheduleInputs, setScheduleInputs, selectedPostId, setSelectedPostId, platformModes, setPlatformModes, mediaLimits, setMediaLimits, youtubePick, setYoutubePick, insightsSummary, setInsightsSummary, analyticsTimeseries, setAnalyticsTimeseries, analyticsContentTypes, setAnalyticsContentTypes, analyticsAccounts, setAnalyticsAccounts, analyticsFollowers, setAnalyticsFollowers, reportMonth, setReportMonth, requireApproval, setRequireApproval, requireApprovalLoaded, setRequireApprovalLoaded, autoDraftForm, setAutoDraftForm, autoDraftLoaded, setAutoDraftLoaded, linkStatsById, setLinkStatsById, rejectOpenId, setRejectOpenId, rejectNotes, setRejectNotes, loadAccounts, loadPosts, loadInsightsSummary, loadAnalyticsTimeseries, loadAnalyticsContentTypes, loadAnalyticsAccounts, loadAnalyticsFollowers, loadSocialSettings, loadAutoDraftSettings, loadPostingSlots, loadAssets, loadMediaFolders, loadImageStatus, loadPlatformModes, loadMediaLimits, loadAiProducts, loadHashtagSets, loadHashtagInsights, applyContentPlan, loadContentPlans, onTokenChange, discoverPages, connectSelectedPages, disconnectAccount, connectOAuth, selectYouTubeChannel, resetComposer, startEdit, saveDraft, deletePost, clonePost, addToQueue, scheduleBestTime, evergreenFormFor, saveEvergreen, createPostingSlot, togglePostingSlot, deletePostingSlot, fmtInTz, doSchedule, doCancelSchedule, doPublishNow, upsertPost, refreshPostInsights, refreshAllInsights, downloadReport, derivePost, saveApprovalSetting, saveAutoDraftSettings, loadLinkStats, submitApproval, approvePost, rejectPost, toggleAiPanel, generateContentPlan, materializeContentPlan, generateAiScript, generateAiCopy, toggleHashtag, applyHashtagSet, saveHashtagSet, useAiCaption, attachMedia, uploadMedia, rasterizeMedia, createMediaFolder, deleteMediaFolder, selectMediaFolder, applyMediaFilters, clearMediaFilters, updateAssetTags, changeAssetFolder, loadAssetUsage, cropAsset, captureAssetCover, toggleBulkSelected, runBulkAction, importProductImage, generateAiImage, createTemplatePoster, currentPlatformFields, relativeLabel, renderApprovalBadge, renderSubmitApproval, renderSuBadges, renderCloneButton, renderDeriveButton, renderDerivePanel, renderEvergreenControls, renderInsights, renderLinkStats, renderPostActions, postsNextCursor, loadMorePosts, selectedPostIds, setSelectedPostIds, togglePostSelected,
  bulkRescheduleAt, setBulkRescheduleAt, runPostsBulk, csvImportResults, importPostsCsv,
  members, myUserId, detailOpenId, togglePostDetail, notesByPost, versionsByPost, timelineByPost,
  noteInputs, setNoteInputs, addPostNote, deletePostNote, restorePostVersion, assignPost, memberLabel,
  approvalTwoStep, saveApprovalTwoStep, accountHealth, failureGroups, checkAccountHealth, retryFailedPost, shareLinksByPost, shareCreatedByPost, createShareLink, createGroupShareLink, revokeShareLink, requireClientApproval, saveRequireClientApproval,
  loadAccountHealth, loadFailureGroups, filteredPosts, calCells, calBuckets, calMonthTitle, selectedPost, queuePosts, pendingApprovalPosts, hasPublishedOrInsights, analyticsBars, analyticsHasTimeseriesData, followerHasGrowth, connectedAccounts, composerTargets, showFirstCommentInput, inputCls, activeTab, setActiveTab };

  const SU11_TABS = [
    { id: "composer", label: "✍️ Composer" },
    { id: "posts", label: "🗓️ Posts ও Calendar" },
    { id: "library", label: "🖼️ Library" },
    { id: "analytics", label: "📈 Analytics" },
    { id: "settings", label: "⚙️ Settings ও Accounts" },
  ] as const;

  // SD2: header stat chips — every count comes from data this page
  // already loads (connected accounts, the scheduled queue, pending
  // approvals, SU10 failure groups / account health). Nothing invented.
  const failedTotal = failureGroups.reduce((s, g) => s + g.count, 0);
  const healthErrorCount = accountHealth.filter((h) => h.health === "error").length;

  return (
    <div className="space-y-6">
      {/* SD2: power header — title + live stat chips from loaded data */}
      <div className="soc-header fade-rise">
        <h1 className="page-title">📣 Social Posts</h1>
        <p className="page-sub mt-1">Facebook Page, Instagram, TikTok ও YouTube-এ পোস্টের Draft তৈরি করুন। একটি Draft একাধিক অ্যাকাউন্টের জন্য একসাথে বানানো যায় — প্রতিটি অ্যাকাউন্টের জন্য আলাদা পোস্ট তৈরি হয়। TikTok/YouTube-এর জন্য ঠিক একটি Video লাগে।</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="stat-chip min-h-[40px]" onClick={() => selectTab("settings")}>
            সংযুক্ত অ্যাকাউন্ট <span className="stat-chip-count">{connectedAccounts.length.toLocaleString("bn-BD")}</span>
          </button>
          <button type="button" className="stat-chip min-h-[40px]" onClick={() => selectTab("posts")}>
            Queue-তে শিডিউল <span className="stat-chip-count">{queuePosts.length.toLocaleString("bn-BD")}</span>
          </button>
          <button type="button" className="stat-chip min-h-[40px]" onClick={() => selectTab("posts")}>
            অনুমোদনের অপেক্ষায় <span className="stat-chip-count">{pendingApprovalPosts.length.toLocaleString("bn-BD")}</span>
          </button>
          {failedTotal > 0 ? (
            <button type="button" className="stat-chip stat-chip-danger min-h-[40px]" onClick={() => selectTab("settings")}>
              ব্যর্থ পোস্ট <span className="stat-chip-count">{failedTotal.toLocaleString("bn-BD")}</span>
            </button>
          ) : null}
          {healthErrorCount > 0 ? (
            <button type="button" className="stat-chip stat-chip-danger min-h-[40px]" onClick={() => selectTab("settings")}>
              ⚠️ অ্যাকাউন্টে সমস্যা আছে <span className="stat-chip-count">{healthErrorCount.toLocaleString("bn-BD")}</span>
            </button>
          ) : null}
        </div>
      </div>
      {error ? (
        <div className="alert alert-red fade-rise" role="alert">
          <span aria-hidden="true">⚠️</span>
          <p className="min-w-0 flex-1">{error}</p>
          <button type="button" aria-label="বন্ধ করুন" className="shrink-0 rounded-full px-2 py-0.5 font-bold transition hover:bg-red-100" onClick={() => setError("")}>✕</button>
        </div>
      ) : null}
      {notice ? (
        <div className="alert alert-green fade-rise" role="status">
          <span aria-hidden="true">✅</span>
          <p className="min-w-0 flex-1">{notice}</p>
          <button type="button" aria-label="বন্ধ করুন" className="shrink-0 rounded-full px-2 py-0.5 font-bold transition hover:bg-emerald-100" onClick={() => setNotice("")}>✕</button>
        </div>
      ) : null}

      {/* SU11 + SD2: sticky tab rail — panels below are NEVER unmounted
          (CSS hidden only), so switching tabs loses no state. The rail
          sticks under the dashboard topbar, scroll-snaps on mobile and
          keeps the URL hash in sync (selectTab). */}
      <div className="soc-tab-rail" role="tablist" aria-label="Social Posts">
        {SU11_TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={activeTab === t.id}
            className={activeTab === t.id ? "soc-tab-btn soc-tab-btn-active" : "soc-tab-btn"}
            onClick={() => selectTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className={activeTab === "composer" ? "space-y-8 pb-24 lg:pb-0" : "hidden"}>
        <ComposerPanel c={ctx} />
        {showLibrary ? (
          <div className="card space-y-3 p-5">
            <div className="font-semibold">🖼️ মিডিয়া লাইব্রেরি</div>
            <LibraryPanel c={ctx} />
          </div>
        ) : null}
      </div>
      <div className={activeTab === "posts" ? "space-y-8" : "hidden"}>
        <PostsPanel c={ctx} />
      </div>
      <div className={activeTab === "library" ? "space-y-8" : "hidden"}>
        <div className="card space-y-3 p-5">
          <div className="font-semibold">🖼️ মিডিয়া লাইব্রেরি</div>
          <LibraryPanel c={ctx} />
        </div>
      </div>
      <div className={activeTab === "analytics" ? "space-y-8" : "hidden"}>
        <AnalyticsPanel c={ctx} />
      </div>
      <div className={activeTab === "settings" ? "space-y-8" : "hidden"}>
        <SettingsPanel c={ctx} />
      </div>
    </div>
  );
}
