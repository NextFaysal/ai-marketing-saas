"use client";
import React, { useCallback, useEffect, useState } from "react";
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
import { EmptyState } from "@repo/ui";

// ---------------------------------------------------------------------------
// SP2 contract types (docs/social-posts-package-plan.md, SP1 API contract).
// ---------------------------------------------------------------------------

interface SocialAccount {
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

interface DiscoveredPage {
  pageId: string;
  name: string;
  pictureUrl?: string | null;
  instagram: { externalId: string; username?: string | null; pictureUrl?: string | null } | null;
  alreadyConnectedPage: boolean;
  alreadyConnectedInstagram: boolean;
}

interface MediaAsset {
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
}

// SP3 contract types (AI copy + hashtag sets).
interface AiProductOption {
  id: string;
  name: string;
}

interface AiPolicyFinding {
  rule: string;
  severity: string;
  snippet: string;
  explanation: string;
  suggestion: string;
}

interface AiCopyVariant {
  caption: string;
  policy: { status: string; findings: AiPolicyFinding[] };
}

interface AiCopyResponse {
  provider: string;
  isRealLlm: boolean;
  product: { id: string; name: string; price: string; currency: string } | null;
  variants: AiCopyVariant[];
  hashtags: string[];
  notice?: string;
}

interface HashtagSet {
  id: string;
  name: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** A media item attached to the composer: the MediaStore ref plus a
 * display name (post mediaRefs carry no name, so edit mode falls
 * back to a generic label). */
interface SelectedMedia {
  assetId: string;
  kind: "image" | "video";
  name?: string;
}

const MAX_MEDIA = 10;

const PLATFORM_LABELS: Record<string, string> = {
  meta_page: "Facebook Page",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
};

/** SP8/SP9: operator-app platform modes (booleans only, from
 * GET social/platform-modes) — drives the connect buttons' honest
 * availability and the TikTok card's mode label. */
interface PlatformModes {
  tiktok: { configured: boolean; audited: boolean };
  youtube: { configured: boolean };
}

const ACCOUNT_STATUS_META: Record<string, { label: string; cls: string }> = {
  connected: { label: "সংযুক্ত", cls: "bg-green-100 text-green-700" },
  disconnected: { label: "বিচ্ছিন্ন", cls: "bg-slate-200 text-red-600" },
  error: { label: "ত্রুটি", cls: "bg-red-100 text-red-700" },
};

const POST_STATUS_META: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft (খসড়া)", cls: "bg-slate-200 text-slate-700" },
  scheduled: { label: "শিডিউল করা", cls: "bg-sky-100 text-sky-700" },
  publishing: { label: "পাবলিশ হচ্ছে", cls: "bg-amber-100 text-amber-700" },
  published: { label: "প্রকাশিত", cls: "bg-green-100 text-green-700" },
  failed: { label: "ব্যর্থ", cls: "bg-red-100 text-red-700" },
  cancelled: { label: "বাতিল", cls: "bg-slate-200 text-slate-500" },
  sent_to_creator: { label: "Creator-এর কাছে পাঠানো হয়েছে", cls: "bg-violet-100 text-violet-700" },
};

// SP7 approval-status badges.
const APPROVAL_STATUS_META: Record<SocialApprovalStatus, { label: string; cls: string }> = {
  pending: { label: "⏳ অনুমোদনের অপেক্ষায়", cls: "bg-amber-100 text-amber-700" },
  approved: { label: "✅ অনুমোদিত", cls: "bg-green-100 text-green-700" },
  rejected: { label: "❌ প্রত্যাখ্যাত", cls: "bg-red-100 text-red-700" },
};

/**
 * Authenticated media thumbnail — the inbox MediaView pattern,
 * mirrored exactly: the file bytes are protected, so they are
 * fetched through the API proxy with the app's Bearer token and
 * rendered from a blob object URL (revoked on unmount). A plain
 * <img src="…/file"> would 401, which is why the inbox does it
 * this way too.
 */
function MediaThumb({ assetId, kind, className }: { assetId: string; kind: "image" | "video"; className?: string }) {
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
  if (failed) return <span className={`flex items-center justify-center bg-slate-100 text-[10px] text-slate-400 ${className ?? "h-16 w-16 rounded-lg"}`}>লোড হয়নি</span>;
  if (!url) return <span className={`flex items-center justify-center bg-slate-100 text-[10px] text-slate-400 ${className ?? "h-16 w-16 rounded-lg"}`}>লোড হচ্ছে…</span>;
  if (kind === "video") return <video src={url} className={cls} muted preload="metadata" />;
  return <img src={url} alt="" className={cls} />;
}

/** PP2: human MB for the upload-cap hint (Bengali digits). */
function formatMb(bytes: number): string {
  const mb = bytes / 1_000_000;
  const num = Number.isInteger(mb) ? String(mb) : mb.toFixed(1);
  return `${num.replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)])} MB`;
}

export default function SocialPostsPage() {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [posts, setPosts] = useState<Sp7SocialPost[]>([]);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  // Meta connect flow (discover -> picker -> connect).
  const [showConnect, setShowConnect] = useState(false);
  const [metaToken, setMetaToken] = useState("");
  const [discovered, setDiscovered] = useState<DiscoveredPage[] | null>(null);
  const [pageSelected, setPageSelected] = useState<Record<string, boolean>>({});

  // Composer.
  const [caption, setCaption] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [selectedMedia, setSelectedMedia] = useState<SelectedMedia[]>([]);
  const [accountSelected, setAccountSelected] = useState<Record<string, boolean>>({});
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
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
  const [requireApproval, setRequireApproval] = useState(false);
  const [requireApprovalLoaded, setRequireApprovalLoaded] = useState(false);
  const [rejectOpenId, setRejectOpenId] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({});

  const loadAccounts = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setAccounts(await apiFetch<SocialAccount[]>(`/organizations/${orgId}/social/accounts`));
  }, []);

  const loadPosts = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setPosts(await apiFetch<Sp7SocialPost[]>(`/organizations/${orgId}/social/posts`));
  }, []);

  // SP7 loaders — auxiliary like the media library: a failure here
  // must not blank the whole page, so callers .catch() them.
  const loadInsightsSummary = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setInsightsSummary(await apiFetch<SocialInsightsSummary>(`/organizations/${orgId}/social/insights/summary`));
  }, []);

  const loadSocialSettings = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    const res = await apiFetch<{ socialRequireApproval: boolean }>(`/organizations/${orgId}/social/settings`);
    setRequireApproval(!!res.socialRequireApproval);
    setRequireApprovalLoaded(true);
  }, []);

  const loadAssets = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    setAssets(await apiFetch<MediaAsset[]>(`/organizations/${orgId}/social/media`));
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
      loadPlatformModes().catch(() => undefined);
      loadMediaLimits().catch(() => undefined);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }, [loadAccounts, loadPosts, loadAssets, loadImageStatus, loadInsightsSummary, loadSocialSettings, loadPlatformModes, loadMediaLimits]);
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
        method: "POST", body: JSON.stringify({ accessToken: metaToken, pageIds }),
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

  function toggleAiPanel() {
    const next = !showAiPanel;
    setShowAiPanel(next);
    if (next) {
      // Lazily load products + hashtag sets when the panel opens.
      if (!aiProductsLoaded) loadAiProducts().catch((e) => setError(e instanceof Error ? e.message : "Product লোড ব্যর্থ হয়েছে"));
      loadHashtagSets().catch(() => undefined);
    }
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
        await apiFetch(`/organizations/${orgId}/social/posts/${editingPostId}`, {
          method: "PATCH",
          body: JSON.stringify({ caption, linkUrl: linkUrl.trim() || null, mediaRefs }),
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
      // One SocialPost row per selected account (SP1 model is
      // per-account) — sequential so a failure names its account.
      let saved = 0;
      for (const a of targets) {
        await apiFetch(`/organizations/${orgId}/social/posts`, {
          method: "POST",
          body: JSON.stringify({
            socialAccountId: a.id,
            caption,
            linkUrl: linkUrl.trim() || undefined,
            mediaRefs,
          }),
        });
        saved += 1;
      }
      setNotice(`${saved}টি অ্যাকাউন্টের জন্য Draft সংরক্ষণ হয়েছে।`);
      resetComposer();
      await loadPosts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Draft সংরক্ষণ ব্যর্থ হয়েছে");
      // Some accounts may already have their draft — refresh the
      // list so the user sees exactly what was saved.
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
    } catch (e) { setError(e instanceof Error ? e.message : "Data হালনাগাদ ব্যর্থ হয়েছে"); }
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

  /** SP7 approval badge (+ the rejection reason when there is one). */
  function renderApprovalBadge(p: Sp7SocialPost) {
    if (!p.approvalStatus) return null;
    const meta = APPROVAL_STATUS_META[p.approvalStatus];
    if (!meta) return null;
    return (
      <>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${meta.cls}`}>{meta.label}</span>
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
          <p className="text-sm text-slate-500">এখনো data আসেনি</p>
        )}
        <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => refreshPostInsights(p)}>
          {busy === `insights-${p.id}` ? "হালনাগাদ হচ্ছে..." : "🔄 Data হালনাগাদ করুন"}
        </button>
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
  const pendingApprovalPosts = posts.filter((p) => p.approvalStatus === "pending");
  const hasPublishedOrInsights = posts.some((p) => p.status === "published") || (insightsSummary?.postsWithInsights ?? 0) > 0;
  const connectedAccounts = accounts.filter((a) => a.status === "connected");
  const inputCls = "input mt-1";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-title">📣 Social Posts</h1>
        <p className="text-sm text-slate-500">Facebook Page, Instagram, TikTok ও YouTube-এ পোস্টের Draft তৈরি করুন। একটি Draft একাধিক অ্যাকাউন্টের জন্য একসাথে বানানো যায় — প্রতিটি অ্যাকাউন্টের জন্য আলাদা পোস্ট তৈরি হয়। TikTok/YouTube-এর জন্য ঠিক একটি Video লাগে।</p>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      {/* Accounts strip */}
      <div className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">সংযুক্ত অ্যাকাউন্ট ({accounts.length})</div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => setShowConnect((s) => !s)}>
              Meta অ্যাকাউন্ট যুক্ত করুন
            </button>
            <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== "" || platformModes?.tiktok.configured === false}
              title={platformModes && !platformModes.tiktok.configured ? "TikTok app এখনো configure করা হয়নি — Platform Operator-এর সাথে যোগাযোগ করুন।" : undefined}
              onClick={() => connectOAuth("tiktok")}>
              {busy === "connect-tiktok" ? "TikTok-এ যাচ্ছে..." : "🎵 TikTok যুক্ত করুন"}
            </button>
            <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== "" || platformModes?.youtube.configured === false}
              title={platformModes && !platformModes.youtube.configured ? "Google app এখনো configure করা হয়নি — Platform Operator-এর সাথে যোগাযোগ করুন।" : undefined}
              onClick={() => connectOAuth("youtube")}>
              {busy === "connect-youtube" ? "Google-এ যাচ্ছে..." : "▶️ YouTube যুক্ত করুন"}
            </button>
          </div>
        </div>
        {platformModes && (!platformModes.tiktok.configured || !platformModes.youtube.configured) ? (
          <p className="text-xs text-slate-400">
            {!platformModes.tiktok.configured ? "TikTok: Operator এখনো TikTok app configure করেননি — Connect করা যাচ্ছে না। " : null}
            {!platformModes.youtube.configured ? "YouTube: Operator এখনো Google app configure করেননি — Connect করা যাচ্ছে না।" : null}
          </p>
        ) : null}
        {youtubePick ? (
          <div className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3">
            <div className="text-sm font-semibold text-indigo-900">▶️ কোন YouTube Channelটি যুক্ত করবেন?</div>
            <p className="text-xs text-indigo-700">আপনার Google অ্যাকাউন্টে একাধিক Channel আছে — যেটিতে ভিডিও আপলোড হবে সেটি বেছে নিন। (এই পছন্দের লিংকটি ১০ মিনিটের মধ্যে মেয়াদোত্তীর্ণ হবে।)</p>
            {youtubePick.channels.length === 0 ? (
              <p className="text-xs text-indigo-700">Channel তালিকা লোড হচ্ছে…</p>
            ) : youtubePick.channels.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-lg bg-white p-2.5">
                {c.pictureUrl ? <img src={c.pictureUrl} alt="" className="h-9 w-9 rounded-full object-cover" /> : null}
                <span className="flex-1 truncate text-sm font-medium">{c.title}</span>
                <button className="btn-primary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => selectYouTubeChannel(c.id)}>
                  {busy === `yt-pick-${c.id}` ? "যুক্ত হচ্ছে..." : "এই Channel যুক্ত করুন"}
                </button>
              </div>
            ))}
            <button className="text-xs font-semibold text-slate-500 underline" disabled={busy !== ""} onClick={() => setYoutubePick(null)}>বাতিল করুন</button>
          </div>
        ) : null}
        {accounts.length === 0 ? (
          <p className="text-sm text-slate-500">এখনো কোনো Social অ্যাকাউন্ট যুক্ত নেই। উপরের বোতামে Meta Access Token দিয়ে Facebook Page যুক্ত করুন — Page-এর সাথে Instagram থাকলে সেটিও যুক্ত হবে।</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {accounts.map((a) => (
              <div key={a.id} className="flex min-w-[240px] flex-1 items-start gap-3 rounded-xl bg-slate-50 p-3 sm:max-w-sm">
                {a.pictureUrl ? <img src={a.pictureUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" /> : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-sm font-bold text-white">{a.name.slice(0, 1).toUpperCase()}</span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate font-medium">{a.name}</span>
                    <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{PLATFORM_LABELS[a.platform] ?? a.platform}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${ACCOUNT_STATUS_META[a.status]?.cls ?? "bg-slate-100 text-slate-600"}`}>{ACCOUNT_STATUS_META[a.status]?.label ?? a.status}</span>
                  </div>
                  {a.platform === "instagram" && a.username ? <div className="text-xs text-slate-500">@{a.username}</div> : null}
                  {a.platform === "tiktok" ? (
                    <div className="mt-1 text-xs text-slate-500">
                      {platformModes?.tiktok.audited
                        ? "Direct post mode — app audit সম্পন্ন, পোস্ট সরাসরি প্রকাশিত হয়।"
                        : "Inbox mode — audit বাকি: নির্ধারিত সময়ে ভিডিও Creator-এর TikTok inbox-এ পৌঁছাবে, তাকে app থেকে post সম্পূর্ণ করতে হবে।"}
                    </div>
                  ) : null}
                  {a.platform === "youtube" ? (
                    <div className="mt-1 text-xs text-slate-500">
                      আপলোড YouTube-এ <strong>Private</strong> হিসেবে যায় — Google app যাচাই সম্পন্ন হলে Public করা যাবে। ভিডিও Channel-এর YouTube Studio-তে দেখা যাবে।
                    </div>
                  ) : null}
                  {a.lastError ? <div className="mt-1 break-words text-xs text-red-600">{a.lastError}</div> : null}
                  {a.status === "connected" ? (
                    <button className="mt-2 rounded-lg border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => disconnectAccount(a)}>
                      {busy === `disconnect-${a.id}` ? "বিচ্ছিন্ন হচ্ছে..." : "বিচ্ছিন্ন করুন"}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}

        {showConnect ? (
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <form onSubmit={discoverPages} className="flex flex-wrap items-end gap-2">
              <label className="block flex-1 text-sm">Meta Access Token (Page পোস্টের অনুমতিসহ)
                <input type="password" className={inputCls} value={metaToken} onChange={(e) => onTokenChange(e.target.value)} placeholder="Token পেস্ট করুন" autoComplete="off" />
              </label>
              <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>
                {busy === "discover" ? "খোঁজা হচ্ছে..." : "🔍 Page খুঁজুন"}
              </button>
            </form>
            <p className="text-xs text-slate-400">Tokenটি শুধু যাচাই ও যুক্ত করার কাজে ব্যবহৃত হয়। একটি Page বেছে নিলে তার সাথে যুক্ত Instagram অ্যাকাউন্টটিও স্বয়ংক্রিয়ভাবে যুক্ত হবে।</p>
            {discovered ? (
              discovered.length === 0 ? (
                <p className="text-sm text-slate-500">এই Token-এর অধীনে কোনো Page পাওয়া যায়নি।</p>
              ) : (
                <div className="space-y-2">
                  {discovered.map((p) => (
                    <div key={p.pageId} className="rounded-xl bg-slate-50 px-3 py-2.5">
                      <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                        <input type="checkbox" checked={pageSelected[p.pageId] ?? false} onChange={(e) => setPageSelected((s) => ({ ...s, [p.pageId]: e.target.checked }))} />
                        {p.pictureUrl ? <img src={p.pictureUrl} alt="" className="h-8 w-8 rounded-full object-cover" /> : null}
                        <span className="font-medium">{p.name}</span>
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">Facebook Page</span>
                        {p.alreadyConnectedPage ? <span className="rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-700">আগে থেকেই কানেক্টেড</span> : null}
                      </label>
                      <div className="ml-7 mt-1.5 border-l-2 border-slate-200 pl-3 text-sm">
                        {p.instagram ? (
                          <span className="flex flex-wrap items-center gap-2">
                            {p.instagram.pictureUrl ? <img src={p.instagram.pictureUrl} alt="" className="h-6 w-6 rounded-full object-cover" /> : null}
                            <span>Instagram{p.instagram.username ? ` — @${p.instagram.username}` : ""}</span>
                            {p.alreadyConnectedInstagram ? <span className="rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-700">আগে থেকেই কানেক্টেড</span> : null}
                          </span>
                        ) : (
                          <span className="text-slate-400">Instagram যুক্ত নেই</span>
                        )}
                      </div>
                    </div>
                  ))}
                  <button className="btn-primary disabled:opacity-50" disabled={busy !== ""} onClick={connectSelectedPages}>
                    {busy === "connect" ? "যুক্ত হচ্ছে..." : "বেছে নেওয়া Page যুক্ত করুন"}
                  </button>
                </div>
              )
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Composer */}
      <div className="card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">{editingPostId ? "✏️ Draft সম্পাদনা" : "✍️ নতুন পোস্ট"}</div>
          {editingPostId ? (
            <button className="btn-secondary btn-sm" onClick={resetComposer}>সম্পাদনা বাতিল করুন</button>
          ) : null}
        </div>

        <label className="block text-sm">ক্যাপশন
          <textarea className={inputCls} rows={5} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="পোস্টে যা লিখতে চান..." />
        </label>
        <div className="-mt-2 text-right text-xs text-slate-400">{caption.length} অক্ষর</div>

        <label className="block text-sm">লিংক URL (ঐচ্ছিক)
          <input className={inputCls} value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://..." />
        </label>

        {/* SP3 AI copy panel */}
        <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
          <button type="button" className="flex w-full items-center justify-between text-left font-semibold" onClick={toggleAiPanel}>
            <span>✨ AI দিয়ে Caption</span>
            <span className="text-xs text-slate-500">{showAiPanel ? "লুকান ▲" : "খুলুন ▼"}</span>
          </button>
          {showAiPanel ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="block min-w-[200px] flex-1 text-sm">Product (ঐচ্ছিক)
                  <select className={inputCls} value={aiProductId} onChange={(e) => setAiProductId(e.target.value)}>
                    <option value="">কোনো Product নয়</option>
                    {aiProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                <label className="block min-w-[200px] flex-1 text-sm">বিষয় / Topic (ঐচ্ছিক)
                  <input className={inputCls} value={aiTopic} onChange={(e) => setAiTopic(e.target.value)} placeholder="যেমন: ঈদ কালেকশন লঞ্চ" />
                </label>
                <label className="block text-sm">ভাষা
                  <select className={inputCls} value={aiLanguage} onChange={(e) => setAiLanguage(e.target.value as "bn" | "en")}>
                    <option value="bn">বাংলা</option>
                    <option value="en">English</option>
                  </select>
                </label>
                <label className="block text-sm">সংখ্যা
                  <select className={inputCls} value={aiCount} onChange={(e) => setAiCount(Number(e.target.value))}>
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <button type="button" className="btn-primary disabled:opacity-50" disabled={busy !== ""} onClick={generateAiCopy}>
                  {busy === "ai-generate" ? "তৈরি হচ্ছে..." : "✨ Caption তৈরি করুন"}
                </button>
              </div>
              <p className="text-xs text-slate-400">AI শুধু আপনার Product-এর আসল তথ্য ও Business Brain-এর তথ্য ব্যবহার করে — দাম বা অফার বানিয়ে দেবে না। Product না বেছে নিলে একটি Topic লিখতে হবে।</p>

              {aiNotice ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{aiNotice}</p> : null}

              {aiHashtags.length > 0 ? (
                <div className="space-y-1.5">
                  <div className="text-sm font-medium">প্রস্তাবিত Hashtag (বেছে নিন)</div>
                  <div className="flex flex-wrap gap-1.5">
                    {aiHashtags.map((tag) => {
                      const active = selectedHashtags.includes(tag);
                      return (
                        <button key={tag} type="button" onClick={() => toggleHashtag(tag)}
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${active ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {aiVariants.length > 0 ? (
                <div className="space-y-2">
                  {aiVariants.map((v, i) => (
                    <div key={i} className="space-y-2 rounded-xl bg-white p-3">
                      <p className="whitespace-pre-wrap text-sm text-slate-700">{v.caption}</p>
                      {v.policy.status === "pass" ? (
                        <span className="inline-block rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">✅ Policy Check: Pass</span>
                      ) : (
                        <div className="space-y-1">
                          <span className="inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">⚠️ Flagged</span>
                          {v.policy.findings.map((f, j) => (
                            <p key={j} className="text-xs text-amber-800">{f.explanation}</p>
                          ))}
                        </div>
                      )}
                      <div>
                        <button type="button" className="btn-secondary btn-sm" onClick={() => useAiCaption(v)}>এই Caption ব্যবহার করুন</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {/* Hashtag sets */}
              <div className="space-y-2 border-t border-indigo-100 pt-3">
                <div className="text-sm font-medium">সংরক্ষিত Hashtag Set</div>
                {hashtagSets.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {hashtagSets.map((s) => (
                      <button key={s.id} type="button" onClick={() => applyHashtagSet(s)}
                        className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200"
                        title={s.tags.map((t) => `#${t.replace(/^#/, "")}`).join(" ")}>
                        {s.name} ({s.tags.length})
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">এখনো কোনো Hashtag Set সংরক্ষণ করা হয়নি।</p>
                )}
                <div className="flex flex-wrap items-end gap-2">
                  <label className="block min-w-[200px] flex-1 text-sm">Set-এর নাম
                    <input className={inputCls} value={hashtagSetName} onChange={(e) => setHashtagSetName(e.target.value)} placeholder="যেমন: ঈদ সেট" />
                  </label>
                  <button type="button" className="btn-secondary disabled:opacity-50" disabled={busy !== ""} onClick={saveHashtagSet}>
                    {busy === "ai-save-set" ? "সংরক্ষণ হচ্ছে..." : "💾 Set হিসেবে সংরক্ষণ"}
                  </button>
                </div>
                <p className="text-xs text-slate-400">বর্তমানে বেছে নেওয়া Hashtagগুলো ({selectedHashtags.length}টি) এই Set-এ সংরক্ষণ হবে।</p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-3">
          <div className="text-sm font-medium">মিডিয়া (সর্বোচ্চ {MAX_MEDIA}টি)</div>
          {selectedMedia.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {selectedMedia.map((m) => (
                <div key={m.assetId} className="relative">
                  <MediaThumb assetId={m.assetId} kind={m.kind} className="h-20 w-20 rounded-lg object-cover" />
                  <button type="button" aria-label={`${m.name ?? "মিডিয়া"} সরান`}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-[11px] font-bold text-white shadow"
                    onClick={() => setSelectedMedia((prev) => prev.filter((x) => x.assetId !== m.assetId))}>✕</button>
                  {m.name ? <div className="mt-0.5 w-20 truncate text-[10px] text-slate-400" title={m.name}>{m.name}</div> : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">এখনো কোনো মিডিয়া যোগ হয়নি — শুধু লেখার পোস্টও Draft করা যায়।</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <label className={`btn-secondary btn-sm cursor-pointer ${busy !== "" ? "pointer-events-none opacity-50" : ""}`}>
              {busy === "upload" ? "আপলোড হচ্ছে..." : "⬆ নতুন ফাইল আপলোড"}
              <input type="file" accept="image/*,video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadMedia(f); }} />
            </label>
            <button type="button" className="btn-secondary btn-sm" onClick={() => { setShowLibrary((s) => !s); if (!showLibrary) loadAssets().catch(() => undefined); }}>
              🖼️ মিডিয়া লাইব্রেরি {showLibrary ? "লুকান" : "থেকে বেছে নিন"}
            </button>
          </div>
          <p className="text-xs text-slate-400">ছবি সর্বোচ্চ {formatMb(mediaLimits?.imageMaxBytes ?? 2_100_000)} · ভিডিও সর্বোচ্চ {formatMb(mediaLimits?.videoMaxBytes ?? 268_435_456)} — ভিডিও সরাসরি স্ট্রিম হয়ে আপলোড হয়, বড় ফাইলও চলবে।</p>
          {/* PP3: Product থেকে ছবি import */}
          <div className="space-y-2 rounded-xl border border-slate-200 p-3">
            <div className="text-sm font-medium">🛍️ Product থেকে ছবি</div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block min-w-[200px] flex-1 text-sm">Product বেছে নিন
                <select className={inputCls} value={importProductId} onChange={(e) => { setImportProductId(e.target.value); setImportError(""); }}>
                  <option value="">Product বেছে নিন</option>
                  {aiProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <button type="button" className="btn-secondary disabled:opacity-50" disabled={busy !== "" || !importProductId} onClick={importProductImage}>
                {busy === "import-media" ? "Import হচ্ছে..." : "ছবি Import করুন"}
              </button>
            </div>
            {importError ? <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{importError}</p> : null}
            <p className="text-xs text-slate-400">Product-এর ছবি তার URL থেকে Media Library-তে import হয়ে এই Post-এ যোগ হবে। একই ছবি আগেই import করা থাকলে নতুন করে আনা হয় না — আগেরটাই ব্যবহার হয়।</p>
          </div>
          {showLibrary ? (
            assets.length === 0 ? (
              <p className="text-sm text-slate-400">লাইব্রেরিতে এখনো কোনো মিডিয়া নেই — আগে একটি ফাইল আপলোড করুন।</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {assets.map((a) => {
                  const attached = selectedMedia.some((m) => m.assetId === a.id);
                  const isSvg = a.contentType.includes("svg");
                  return (
                    <div key={a.id} className="w-20">
                      <button type="button" disabled={attached}
                        className={`relative rounded-lg text-left ${attached ? "opacity-50" : "hover:ring-2 hover:ring-indigo-400"}`}
                        title={attached ? "ইতিমধ্যে যোগ হয়েছে" : a.name}
                        onClick={() => attachMedia({ assetId: a.id, kind: a.kind, name: a.name })}>
                        <MediaThumb assetId={a.id} kind={a.kind} className="h-20 w-20 rounded-lg object-cover" />
                        {attached ? <span className="absolute left-1 top-1 rounded bg-green-600 px-1 py-0.5 text-[9px] font-bold text-white">যোগ হয়েছে</span> : null}
                      </button>
                      <span className="mt-0.5 block w-20 truncate text-[10px] text-slate-500">{a.name}</span>
                      {isSvg ? (
                        <button type="button" disabled={busy !== ""}
                          className="btn-secondary btn-sm mt-1 w-20 px-1 text-[10px] disabled:opacity-50"
                          onClick={() => rasterizeMedia(a)}>
                          {busy === `rasterize-${a.id}` ? "তৈরি হচ্ছে..." : "PNG সংস্করণ তৈরি করুন"}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )
          ) : null}

          {/* SP4: AI image generation */}
          <div className="space-y-3 rounded-xl border border-violet-100 bg-violet-50/40 p-4">
            <div className="font-semibold">🤖 AI ছবি</div>
            {imageStatus && !imageStatus.configured ? (
              <p className="text-sm text-slate-500">AI ছবি তৈরির provider configure করা নেই — Admin Panel → Platform Config-এ সেট করুন, অথবা Template Poster ব্যবহার করুন।</p>
            ) : (
              <div className="space-y-3">
                <label className="block text-sm">ছবির বর্ণনা (Prompt)
                  <textarea className={inputCls} rows={3} value={aiImagePrompt} onChange={(e) => setAiImagePrompt(e.target.value)} placeholder="যেমন: লাল পাঞ্জাবি পরা মডেল, স্টুডিও আলো, ঈদের আবহ" />
                </label>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="block min-w-[200px] flex-1 text-sm">Product (ঐচ্ছিক — নাম ও Category Prompt-এ যোগ হবে)
                    <select className={inputCls} value={aiImageProductId} onChange={(e) => setAiImageProductId(e.target.value)}>
                      <option value="">কোনো Product নয়</option>
                      {aiProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>
                  <button type="button" className="btn-primary disabled:opacity-50" disabled={busy !== ""} onClick={generateAiImage}>
                    {busy === "ai-image" ? "তৈরি হচ্ছে..." : "ছবি তৈরি করুন"}
                  </button>
                </div>
                <p className="text-xs text-slate-400">তৈরি হওয়া ছবি সরাসরি এই Post-এর জন্য বেছে নেওয়া হবে এবং Media Library-তেও থাকবে।</p>
              </div>
            )}
          </div>

          {/* SP4: template poster composer */}
          <div className="space-y-3 rounded-xl border border-teal-100 bg-teal-50/40 p-4">
            <div className="font-semibold">🎨 Template Poster</div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block min-w-[200px] flex-1 text-sm">ছবি (Media Library থেকে{templateProductId ? " — Product বাছলে ঐচ্ছিক" : ""})
                <select className={inputCls} value={templateAssetId} onChange={(e) => setTemplateAssetId(e.target.value)}>
                  <option value="">ছবি বেছে নিন</option>
                  {assets.filter((a) => a.kind === "image").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <label className="block min-w-[200px] flex-1 text-sm">Product (ঐচ্ছিক)
                <select className={inputCls} value={templateProductId} onChange={(e) => setTemplateProductId(e.target.value)}>
                  <option value="">কোনো Product নয়</option>
                  {aiProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            </div>
            <p className="text-xs text-teal-700">Product বাছলে তার ছবি নিজে থেকে import হয়ে যাবে — আলাদা করে Library থেকে ছবি না বাছলেও Poster তৈরি হবে।</p>
            <label className="block text-sm">Headline
              <input className={inputCls} value={templateHeadline} onChange={(e) => setTemplateHeadline(e.target.value)} placeholder="যেমন: ঈদ অফার" maxLength={120} />
            </label>
            <label className="block text-sm">Subtext (ঐচ্ছিক)
              <input className={inputCls} value={templateSubtext} onChange={(e) => setTemplateSubtext(e.target.value)} placeholder="খালি রাখলে Product-এর আসল দাম বসবে" maxLength={160} />
            </label>
            <button type="button" className="btn-primary disabled:opacity-50" disabled={busy !== ""} onClick={createTemplatePoster}>
              {busy === "template-image" ? "তৈরি হচ্ছে..." : "Poster তৈরি করুন"}
            </button>
            <p className="text-xs text-slate-400">Posterটি SVG ফরম্যাটে তৈরি হয় — Browser-এ দেখা ও Download করা যায়।</p>
            {templatePoster ? (
              <div className="flex flex-wrap items-center gap-3">
                <MediaThumb assetId={templatePoster.id} kind="image" className="h-24 w-24 rounded-lg object-cover" />
                <div className="space-y-1">
                  <div className="text-sm font-medium">{templatePoster.name}</div>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => attachMedia({ assetId: templatePoster.id, kind: templatePoster.kind, name: templatePoster.name })}>Post-এ ব্যবহার করুন</button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">কোন অ্যাকাউন্টের জন্য{editingPostId ? "" : " (একাধিক বেছে নেওয়া যায়)"}</div>
          {accounts.length === 0 ? (
            <p className="text-sm text-slate-400">আগে উপরে একটি অ্যাকাউন্ট যুক্ত করুন।</p>
          ) : accounts.map((a) => {
            const usable = a.status === "connected";
            return (
              <label key={a.id} className={`flex items-center gap-2.5 text-sm ${usable ? "" : "opacity-60"}`}>
                <input type="checkbox" disabled={!usable || editingPostId !== null}
                  checked={accountSelected[a.id] ?? false}
                  onChange={(e) => setAccountSelected((s) => ({ ...s, [a.id]: e.target.checked }))} />
                <span className="font-medium">{a.name}</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{PLATFORM_LABELS[a.platform] ?? a.platform}</span>
                {a.platform === "instagram" && a.username ? <span className="text-xs text-slate-500">@{a.username}</span> : null}
                {!usable ? (
                  <span className="text-xs text-red-600">
                    ({ACCOUNT_STATUS_META[a.status]?.label ?? a.status}{a.lastError ? ` — ${a.lastError}` : ""})
                  </span>
                ) : null}
              </label>
            );
          })}
          {editingPostId ? <p className="text-xs text-slate-400">সম্পাদনার সময় অ্যাকাউন্ট বদলানো যায় না — Draftটি যেই অ্যাকাউন্টের, সেটিতেই থাকবে।</p> : null}
          {!editingPostId && accounts.some((a) => (a.platform === "tiktok" || a.platform === "youtube") && a.status === "connected" && accountSelected[a.id]) ? (
            <p className="rounded-lg bg-violet-50 p-2.5 text-xs text-violet-800">
              🎬 TikTok/YouTube বেছে নিয়েছেন — এই প্ল্যাটফর্মগুলোতে শুধু <strong>ঠিক একটি Video</strong> পোস্ট করা যায়। ছবি বা একাধিক মিডিয়া থাকলে TikTok/YouTube-এর পোস্ট শিডিউল/প্রকাশের সময় আটকে যাবে (Meta-র পোস্টে সমস্যা হবে না)।
              {accounts.some((a) => a.platform === "tiktok" && a.status === "connected" && accountSelected[a.id]) && platformModes && !platformModes.tiktok.audited
                ? " TikTok Inbox mode-এ ক্যাপশন সাথে যায় না — Creator-কে app-এ ক্যাপশন লিখতে হবে।"
                : null}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
          <button className="btn-primary disabled:opacity-50" disabled={busy !== ""} onClick={saveDraft}>
            {busy === "save" ? "সংরক্ষণ হচ্ছে..." : editingPostId ? "পরিবর্তন সংরক্ষণ করুন" : "Draft সংরক্ষণ করুন"}
          </button>
          <p className="text-xs text-slate-400">Draft সংরক্ষণের পর নিচের তালিকা থেকে পোস্ট শিডিউল করতে বা এখনই প্রকাশ করতে পারবেন।</p>
        </div>
      </div>

      {/* SP7 performance strip + best time */}
      <div className="card space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">📊 পোস্টের পারফরম্যান্স</div>
          <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={refreshAllInsights}>
            {busy === "insights-bulk" ? "হালনাগাদ হচ্ছে..." : "সব post-এর data হালনাগাদ করুন"}
          </button>
        </div>
        {insightsSummary && insightsSummary.postsWithInsights > 0 ? (
          <>
            <p className="text-xs text-slate-400">যেসব post-এর data এসেছে তার ভিত্তিতে</p>
            <div className="flex flex-wrap gap-2">
              {summaryMetricRows(insightsSummary.totals).map((row) => (
                <span key={row.key} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  {row.label}: <span className="font-semibold">{row.total.toLocaleString("bn-BD")}</span>{" "}
                  <span className="text-xs text-slate-400">({row.posts.toLocaleString("bn-BD")}টি post-এর data থেকে)</span>
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-500">এখনো কোনো post-এর performance data আসেনি — প্রকাশিত post-এর data হালনাগাদ হলে এখানে সারসংক্ষেপ দেখা যাবে।</p>
        )}
        {insightsSummary?.bestTime ? (
          <div className="rounded-xl bg-indigo-50/60 p-3">
            <p className="text-sm text-slate-700">
              🏆 সেরা সময় (আপনার data অনুযায়ী):{" "}
              <span className="font-semibold">{weekdayNameBn(insightsSummary.bestTime.weekday)} {formatHourBn(insightsSummary.bestTime.hour)}</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              আপনার নিজের post-এর data থেকে আনুমানিক পরামর্শ — নিশ্চয়তা নয় · {insightsSummary.bestTime.postsConsidered.toLocaleString("bn-BD")}টি post-এর data বিবেচনা করা হয়েছে
            </p>
          </div>
        ) : hasPublishedOrInsights ? (
          <p className="text-sm text-slate-500">সেরা সময়: পর্যাপ্ত data নেই — অন্তত ১০টি post-এর data লাগবে</p>
        ) : null}
      </div>

      {/* SP7 approval setting */}
      <div className="card space-y-2 p-5">
        <div className="font-semibold">পোস্ট অনুমোদন ব্যবস্থা</div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={requireApproval} disabled={busy !== "" || !requireApprovalLoaded}
            onChange={(e) => saveApprovalSetting(e.target.checked)} />
          <span>প্রকাশ / শিডিউলের আগে অনুমোদন বাধ্যতামূলক</span>
          {busy === "approval-setting" ? <span className="text-xs text-slate-400">সংরক্ষণ হচ্ছে...</span> : null}
        </label>
        <p className="text-xs text-slate-500">চালু থাকলে: যারা OWNER/ADMIN নন, তাদের পোস্ট প্রকাশ বা শিডিউলের আগে অনুমোদন লাগবে। OWNER/ADMIN-এর নিজের পোস্ট স্বয়ংক্রিয়ভাবে অনুমোদিত। প্রত্যাখ্যান করতে হলে কারণ লিখতে হবে।</p>
      </div>

      {/* SP7 approval queue */}
      <div className="card space-y-3 p-5">
        <div className="font-semibold">⏳ অনুমোদনের অপেক্ষায় ({pendingApprovalPosts.length})</div>
        {pendingApprovalPosts.length === 0 ? (
          <p className="text-sm text-slate-500">এখন কোনো পোস্ট অনুমোদনের অপেক্ষায় নেই।</p>
        ) : pendingApprovalPosts.map((p) => (
          <div key={p.id} className="space-y-2 rounded-xl bg-slate-50 p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium">{p.account?.name ?? ""}</span>
              <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{PLATFORM_LABELS[p.account?.platform ?? ""] ?? p.account?.platform ?? ""}</span>
              {p.account?.username ? <span className="text-xs text-slate-500">@{p.account.username}</span> : null}
              <span className="text-xs text-slate-400">{new Date(p.createdAt).toLocaleString("bn-BD")}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm text-slate-700 line-clamp-3">{p.caption || <span className="text-slate-400">(ক্যাপশন নেই)</span>}</p>
            {p.mediaRefs.length > 0 ? <p className="text-xs text-slate-400">{p.mediaRefs.length.toLocaleString("bn-BD")}টি মিডিয়া সংযুক্ত</p> : null}
            {rejectOpenId === p.id ? (
              <div className="space-y-2">
                <label className="block text-xs text-slate-500">প্রত্যাখ্যানের কারণ (আবশ্যক)
                  <textarea className="input mt-1" rows={2} value={rejectNotes[p.id] ?? ""}
                    onChange={(e) => setRejectNotes((s) => ({ ...s, [p.id]: e.target.value }))}
                    placeholder="কেন পোস্টটি প্রত্যাখ্যান করা হচ্ছে লিখুন" />
                </label>
                {!(rejectNotes[p.id] ?? "").trim() ? (
                  <p className="text-xs text-red-600">প্রত্যাখ্যান করতে হলে কারণ লেখা আবশ্যক — কারণ না লিখলে নিশ্চিত করা যাবে না।</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                    disabled={busy !== "" || !(rejectNotes[p.id] ?? "").trim()} onClick={() => rejectPost(p)}>
                    {busy === `reject-${p.id}` ? "প্রত্যাখ্যান হচ্ছে..." : "প্রত্যাখ্যান নিশ্চিত করুন"}
                  </button>
                  <button type="button" className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => setRejectOpenId(null)}>বাতিল</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50" disabled={busy !== ""} onClick={() => approvePost(p)}>
                  {busy === `approve-${p.id}` ? "অনুমোদন হচ্ছে..." : "✅ অনুমোদন করুন"}
                </button>
                <button type="button" className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => setRejectOpenId(p.id)}>
                  ❌ প্রত্যাখ্যান
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Posts list / calendar / queue (SP5) */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={viewMode === "list" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => setViewMode("list")}>তালিকা</button>
          <button type="button" className={viewMode === "calendar" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => setViewMode("calendar")}>ক্যালেন্ডার</button>
          <button type="button" className={viewMode === "queue" ? "btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => setViewMode("queue")}>সারি (Queue)</button>
          {viewMode !== "list" ? <span className="text-xs text-slate-400">ফিল্টার শুধু তালিকা ভিউতে প্রযোজ্য — এই ভিউতে সব পোস্ট দেখানো হচ্ছে।</span> : null}
        </div>
        {viewMode === "list" ? (
          <>
        <div className="card space-y-3 p-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-500">খুঁজুন (ক্যাপশন / অ্যাকাউন্ট)
              <input className="input mt-1 w-56" placeholder="যেমন: ঈদ অফার" value={filterQuery} onChange={(e) => setFilterQuery(e.target.value)} />
            </label>
            <label className="text-xs text-slate-500">স্ট্যাটাস
              <select className="input mt-1" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="">সব</option>
                <option value="draft">Draft</option>
                <option value="scheduled">Scheduled</option>
                <option value="published">Published</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <label className="text-xs text-slate-500">অ্যাকাউন্ট
              <select className="input mt-1" value={filterAccountId} onChange={(e) => setFilterAccountId(e.target.value)}>
                <option value="">সব অ্যাকাউন্ট</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({PLATFORM_LABELS[a.platform] ?? a.platform})</option>)}
              </select>
            </label>
            <span className="pb-2 text-sm text-slate-500">{filteredPosts.length}টি পোস্ট দেখাচ্ছে (মোট {posts.length}টি)</span>
          </div>
        </div>

        {posts.length === 0 ? (
          <EmptyState title="এখনো কোনো পোস্ট তৈরি হয়নি" description="উপরের Composer-এ ক্যাপশন লিখে, অ্যাকাউন্ট বেছে নিয়ে প্রথম Draft সংরক্ষণ করুন।" />
        ) : filteredPosts.length === 0 ? (
          <p className="card p-5 text-sm text-slate-500">এই ফিল্টারে কোনো পোস্ট মিলছে না — ফিল্টার বদলে আবার চেষ্টা করুন। (পোস্ট মুছে যায়নি; মোট {posts.length}টি পোস্টই আছে।)</p>
        ) : filteredPosts.map((p) => (
          <div key={p.id} className="card p-5">
            <div className="flex flex-wrap items-start gap-3">
              {p.mediaRefs[0] ? <MediaThumb assetId={p.mediaRefs[0].assetId} kind={p.mediaRefs[0].kind} className="h-16 w-16 shrink-0 rounded-lg object-cover" /> : null}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${POST_STATUS_META[p.status]?.cls ?? "bg-slate-100 text-slate-600"}`}>{POST_STATUS_META[p.status]?.label ?? p.status}</span>
                  {renderApprovalBadge(p)}
                  <span className="font-medium">{p.account?.name ?? ""}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{PLATFORM_LABELS[p.account?.platform ?? ""] ?? p.account?.platform ?? ""}</span>
                  {p.account?.username ? <span className="text-xs text-slate-500">@{p.account.username}</span> : null}
                  <span className="text-xs text-slate-400">{new Date(p.createdAt).toLocaleString("bn-BD")}</span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-700 line-clamp-2">{p.caption || <span className="text-slate-400">(ক্যাপশন নেই)</span>}</p>
                {p.linkUrl ? <a href={p.linkUrl} target="_blank" rel="noreferrer" className="mt-0.5 block truncate text-xs text-indigo-600 hover:underline">{p.linkUrl}</a> : null}
                {p.mediaRefs.length > 1 ? <p className="mt-0.5 text-xs text-slate-400">মোট {p.mediaRefs.length}টি মিডিয়া সংযুক্ত</p> : null}
                {p.error ? <p className="mt-1 break-words text-xs text-red-600">{p.error}</p> : null}
                {p.publishNote ? <p className="mt-1 break-words text-xs font-medium text-violet-700">{p.publishNote}</p> : null}
                {p.status === "published" && p.platformUrl ? (
                  <a href={p.platformUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-semibold text-indigo-600 hover:underline">প্রকাশিত পোস্ট দেখুন ↗</a>
                ) : null}
              </div>
              {p.status === "draft" ? (
                <div className="flex shrink-0 flex-wrap gap-2">
                  {renderSubmitApproval(p)}
                  <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={() => startEdit(p)}>সম্পাদনা</button>
                  <button className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-600 disabled:opacity-50" disabled={busy !== ""} onClick={() => deletePost(p)}>
                    {busy === `delete-${p.id}` ? "মুছছে..." : "মুছুন"}
                  </button>
                </div>
              ) : null}
            </div>
            {renderPostActions(p)}
            {renderInsights(p)}
          </div>
        ))}
          </>
        ) : viewMode === "calendar" ? (
          <div className="card space-y-3 p-4">
            <p className="text-xs text-slate-500">নির্ধারিত পোস্ট সময়মতো প্রকাশের জন্য Automations পেজে &apos;Social Post Publisher&apos; Job চালু থাকতে হবে।</p>
            <div className="flex items-center justify-between gap-2">
              <button type="button" className="btn-secondary btn-sm" onClick={() => setCalCursor((c) => (c.m === 1 ? { y: c.y - 1, m: 12 } : { y: c.y, m: c.m - 1 }))}>‹ আগের মাস</button>
              <div className="font-semibold">{calMonthTitle}</div>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setCalCursor((c) => (c.m === 12 ? { y: c.y + 1, m: 1 } : { y: c.y, m: c.m + 1 }))}>পরের মাস ›</button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-500">
              {["রবি", "সোম", "মঙ্গল", "বুধ", "বৃহ", "শুক্র", "শনি"].map((d) => (
                <div key={d} className="py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {calCells.map((cell) => {
                const dayPosts = calBuckets.get(cell.key) ?? [];
                const isToday = cell.key === orgDayKey(new Date().toISOString(), orgTz);
                return (
                  <div key={cell.key} className={`min-h-[92px] rounded-lg border p-1.5 ${cell.inMonth ? "bg-white" : "bg-slate-50"} ${isToday ? "border-indigo-300 ring-1 ring-indigo-200" : "border-slate-100"}`}>
                    <div className={`text-xs font-semibold ${cell.inMonth ? "text-slate-700" : "text-slate-300"}`}>{cell.day.toLocaleString("bn-BD")}</div>
                    <div className="mt-1 space-y-1">
                      {dayPosts.slice(0, 3).map((p) => {
                        const t = p.scheduledAt ?? p.publishedAt;
                        return (
                          <button key={p.id} type="button" onClick={() => setSelectedPostId(p.id)}
                            className={`block w-full truncate rounded px-1 py-0.5 text-left text-[11px] ${POST_STATUS_META[p.status]?.cls ?? "bg-slate-100 text-slate-600"}`}
                            title={p.caption}>
                            {t ? `${new Date(t).toLocaleTimeString("bn-BD", { timeZone: orgTz, hour: "2-digit", minute: "2-digit" })} ` : ""}{p.caption || "(ক্যাপশন নেই)"}
                          </button>
                        );
                      })}
                      {dayPosts.length > 3 ? <div className="text-[11px] text-slate-500">+আরও {(dayPosts.length - 3).toLocaleString("bn-BD")}টি</div> : null}
                    </div>
                  </div>
                );
              })}
            </div>
            {selectedPost ? (
              <div className="space-y-2 rounded-xl bg-slate-50 p-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${POST_STATUS_META[selectedPost.status]?.cls ?? "bg-slate-100 text-slate-600"}`}>{POST_STATUS_META[selectedPost.status]?.label ?? selectedPost.status}</span>
                  {renderApprovalBadge(selectedPost)}
                  <span className="font-medium">{selectedPost.account?.name ?? ""}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{PLATFORM_LABELS[selectedPost.account?.platform ?? ""] ?? selectedPost.account?.platform ?? ""}</span>
                  {selectedPost.account?.username ? <span className="text-xs text-slate-500">@{selectedPost.account.username}</span> : null}
                  <button type="button" className="btn-secondary btn-sm ml-auto" onClick={() => setSelectedPostId(null)}>বন্ধ করুন</button>
                </div>
                <p className="whitespace-pre-wrap text-sm text-slate-700">{selectedPost.caption || <span className="text-slate-400">(ক্যাপশন নেই)</span>}</p>
                {selectedPost.mediaRefs.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {selectedPost.mediaRefs.map((m) => (
                      <MediaThumb key={m.assetId} assetId={m.assetId} kind={m.kind} className="h-16 w-16 rounded-lg object-cover" />
                    ))}
                  </div>
                ) : null}
                {selectedPost.scheduledAt ? <p className="text-xs text-slate-500">🕒 শিডিউল: {fmtInTz(selectedPost.scheduledAt)} ({orgTz})</p> : null}
                {selectedPost.publishedAt ? <p className="text-xs text-slate-500">প্রকাশিত: {fmtInTz(selectedPost.publishedAt)} ({orgTz})</p> : null}
                {selectedPost.linkUrl ? <a href={selectedPost.linkUrl} target="_blank" rel="noreferrer" className="block truncate text-xs text-indigo-600 hover:underline">{selectedPost.linkUrl}</a> : null}
                {selectedPost.error ? <p className="break-words text-xs text-red-600">{selectedPost.error}</p> : null}
                {selectedPost.publishNote ? <p className="break-words text-xs font-medium text-violet-700">{selectedPost.publishNote}</p> : null}
                {selectedPost.status === "published" && selectedPost.platformUrl ? (
                  <a href={selectedPost.platformUrl} target="_blank" rel="noreferrer" className="inline-block text-xs font-semibold text-indigo-600 hover:underline">প্রকাশিত পোস্ট দেখুন ↗</a>
                ) : null}
                {renderSubmitApproval(selectedPost)}
                {renderInsights(selectedPost)}
                {renderPostActions(selectedPost)}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-2">
            {queuePosts.length === 0 ? (
              <p className="card p-5 text-sm text-slate-500">এখন কোনো পোস্ট শিডিউল করা নেই।</p>
            ) : queuePosts.map((p) => (
              <div key={p.id} className="card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{p.scheduledAt ? fmtInTz(p.scheduledAt) : ""}</span>
                  <span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">{relativeLabel(p.scheduledAt)}</span>
                  {renderApprovalBadge(p)}
                  <span className="font-medium">{p.account?.name ?? ""}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{PLATFORM_LABELS[p.account?.platform ?? ""] ?? p.account?.platform ?? ""}</span>
                  {p.account?.username ? <span className="text-xs text-slate-500">@{p.account.username}</span> : null}
                </div>
                <p className="mt-1 truncate text-sm text-slate-700">{p.caption || <span className="text-slate-400">(ক্যাপশন নেই)</span>}</p>
                {renderPostActions(p)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
