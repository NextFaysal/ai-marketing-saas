"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { useLocale } from "@/lib/i18n/provider";
import { fmtNumber, fmtTime } from "@repo/contracts";

interface SocialCommentItem {
  id: string;
  organizationId: string;
  platform: "facebook" | "instagram" | "tiktok" | "youtube";
  externalPostId: string;
  externalCommentId: string;
  postTitle?: string;
  postMediaUrl?: string;
  authorName: string;
  authorAvatarUrl?: string;
  commentText: string;
  sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "SPAM";
  intent: "PRICE_QUERY" | "DELIVERY_QUERY" | "COMPLAINT" | "GENERAL" | "PRODUCT_INFO" | "BARGAIN" | "COMPETITOR_MENTION";
  status: "PENDING" | "AUTO_REPLIED" | "MANUALLY_REPLIED" | "HIDDEN" | "ESCALATED" | "DELETED";
  replyText?: string;
  repliedAt?: string;
  isPrivateDmSent: boolean;
  privateDmText?: string;
  confidenceScore: number;
  createdAt: string;
  // IN8: queue assignment + the inbox conversation a confirmed
  // private reply was linked to (null until Meta confirms a DM).
  assignedUserId?: string | null;
  dmConversationId?: string | null;
}

interface SocialReplySettings {
  id: string;
  aiAutoReplyEnabled: boolean;
  sendPrivateDm: boolean;
  autoHideSpam: boolean;
  replyDelaySeconds: number;
  tonePreference: string;
  bannedKeywords: string[];
  salesOrderUrl?: string;
  nightOwlEnabled?: boolean;
  nightOwlMessage?: string;
  urgentAlertTelegramEnabled?: boolean;
  telegramChatId?: string;
  telegramBotToken?: string;
  cannedSnippets?: Record<string, string>;
}

interface CommentListResponse {
  items: SocialCommentItem[];
  total: number;
  page: number;
  limit: number;
  stats: {
    pendingCount: number;
    spamCount: number;
    // IN8d: auto-hide report, counted from real rows.
    hiddenCount?: number;
    hiddenSpamCount?: number;
  };
}

export default function SocialCommentsPage() {
  const { t, locale } = useLocale();
  const [comments, setComments] = useState<SocialCommentItem[]>([]);
  const [stats, setStats] = useState<{ pendingCount: number; spamCount: number; hiddenCount?: number; hiddenSpamCount?: number }>({ pendingCount: 0, spamCount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Filters
  const [selectedPlatform, setSelectedPlatform] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Settings Modal State
  const [settings, setSettings] = useState<SocialReplySettings | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // Active Reply Modal State
  const [activeComment, setActiveComment] = useState<SocialCommentItem | null>(null);
  const [replyInput, setReplyInput] = useState("");
  const [sendDmCheckbox, setSendDmCheckbox] = useState(true);
  const [privateDmInput, setPrivateDmInput] = useState("");
  const [loadingAiSuggestion, setLoadingAiSuggestion] = useState(false);
  const [submittingReply, setSubmittingReply] = useState(false);

  // Bulk Actions
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Live Auto-Refresh (Polling)
  const [autoRefresh, setAutoRefresh] = useState(true);

  const loadData = useCallback(async (isSilent = false) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    if (!isSilent) setLoading(true);
    setError("");
    try {
      // First ensure demo seed if fresh
      await apiFetch(`/organizations/${orgId}/social-comments/seed-demo`, { method: "POST" });

      const queryParams = new URLSearchParams();
      if (selectedPlatform !== "all") queryParams.append("platform", selectedPlatform);
      if (selectedStatus !== "all") queryParams.append("status", selectedStatus);
      if (searchQuery) queryParams.append("search", searchQuery);

      const [res, setRes] = await Promise.all([
        apiFetch<CommentListResponse>(`/organizations/${orgId}/social-comments?${queryParams.toString()}`),
        apiFetch<SocialReplySettings>(`/organizations/${orgId}/social-comments/settings`),
      ]);

      setComments(res.items || []);
      setStats(res.stats || { pendingCount: 0, spamCount: 0 });
      setSettings(setRes);
    } catch (e) {
      if (!isSilent) setError(e instanceof Error ? e.message : t("inbox.cmtLoadError"));
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, [selectedPlatform, selectedStatus, searchQuery, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Periodic Auto-Refresh every 15 seconds if enabled
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      loadData(true);
    }, 15000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadData]);

  async function handleBulkAction(action: "AI_REPLY_ALL" | "HIDE_ALL" | "MARK_RESOLVED") {
    if (selectedIds.length === 0) return;
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBulkBusy(true);
    setError("");
    try {
      const res = await apiFetch<{ success: boolean; affected: number }>(
        `/organizations/${orgId}/social-comments/bulk-action`,
        {
          method: "POST",
          body: JSON.stringify({
            commentIds: selectedIds,
            action,
          }),
        }
      );
      setNotice(t("inbox.cmtBulkDone", { count: fmtNumber(locale, res.affected), action: action === "AI_REPLY_ALL" ? t("inbox.cmtBulkAiReply") : action === "HIDE_ALL" ? t("inbox.cmtBulkHide") : t("inbox.cmtBulkResolve") }));
      setSelectedIds([]);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("inbox.cmtBulkFailed"));
    } finally {
      setBulkBusy(false);
    }
  }

  // Interactive Live Comment Simulator
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);
  const [simForm, setSimForm] = useState({
    platform: "facebook" as const,
    authorName: "",
    commentText: "",
    postTitle: t("inbox.cmtSimPostTitleDefault"),
  });
  const [simulating, setSimulating] = useState(false);

  async function handleSimulateSubmit(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId();
    if (!orgId) return;
    setSimulating(true);
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/social-comments/ingest`, {
        method: "POST",
        body: JSON.stringify({
          platform: simForm.platform,
          externalPostId: `post_${Date.now()}`,
          externalCommentId: `cmt_${Date.now()}`,
          postTitle: simForm.postTitle,
          authorName: simForm.authorName || t("inbox.cmtSimAuthorDefault"),
          commentText: simForm.commentText,
        }),
      });
      setNotice(t("inbox.cmtSimDone"));
      setIsSimulatorOpen(false);
      setSimForm({ platform: "facebook", authorName: "", commentText: "", postTitle: t("inbox.cmtSimPostTitleDefault") });
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("inbox.cmtSimFailed"));
    } finally {
      setSimulating(false);
    }
  }

  function handleExportCsv() {
    if (comments.length === 0) return;
    const headers = ["Platform", "Author", "Comment", "Intent", "Sentiment", "Status", "Reply", "Date"];
    const rows = comments.map((c) => [
      c.platform,
      `"${c.authorName.replace(/"/g, '""')}"`,
      `"${c.commentText.replace(/"/g, '""')}"`,
      c.intent,
      c.sentiment,
      c.status,
      `"${(c.replyText || "").replace(/"/g, '""')}"`,
      new Date(c.createdAt).toLocaleDateString(),
    ]);

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `social_comments_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setNotice(t("inbox.cmtExportDone"));
  }

  // Open Reply Modal & Generate Contextual AI Suggestion
  async function openReplyModal(cmt: SocialCommentItem) {
    setActiveComment(cmt);
    setReplyInput(cmt.replyText || "");
    setPrivateDmInput(cmt.privateDmText || "");
    setSendDmCheckbox(true);

    if (!cmt.replyText) {
      const orgId = getOrganizationId();
      if (!orgId) return;
      setLoadingAiSuggestion(true);
      try {
        const suggestion = await apiFetch<{ aiPlan: { publicCommentReply: string; privateDmText?: string; shouldSendDm: boolean } }>(
          `/organizations/${orgId}/social-comments/${cmt.id}/suggest-ai`,
          { method: "POST" }
        );
        if (suggestion?.aiPlan) {
          setReplyInput(suggestion.aiPlan.publicCommentReply);
          if (suggestion.aiPlan.privateDmText) {
            setPrivateDmInput(suggestion.aiPlan.privateDmText);
          }
          setSendDmCheckbox(suggestion.aiPlan.shouldSendDm);
        }
      } catch {
        // ignore
      } finally {
        setLoadingAiSuggestion(false);
      }
    }
  }

  async function handleSendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!activeComment) return;
    const orgId = getOrganizationId();
    if (!orgId) return;
    setSubmittingReply(true);
    setError("");
    try {
      const res = await apiFetch<{ isPrivateDmSent?: boolean; privateDmError?: string }>(`/organizations/${orgId}/social-comments/${activeComment.id}/reply`, {
        method: "POST",
        body: JSON.stringify({
          replyText: replyInput,
          sendPrivateDm: sendDmCheckbox,
          privateDmText: privateDmInput,
        }),
      });
      // IN8: the reply above is Graph-confirmed (the API throws
      // otherwise). The DM is reported separately — never claim
      // it was sent when Meta did not confirm it.
      if (res?.privateDmError) {
        setNotice(t("inbox.cmtReplyDmFailed", { name: activeComment.authorName, error: res.privateDmError }));
      } else if (sendDmCheckbox && res?.isPrivateDmSent) {
        setNotice(t("inbox.cmtReplyBothDone", { name: activeComment.authorName }));
      } else {
        setNotice(t("inbox.cmtReplyDone", { name: activeComment.authorName }));
      }
      setActiveComment(null);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("inbox.cmtReplyFailed"));
    } finally {
      setSubmittingReply(false);
    }
  }

  async function handleQuickAutoReply(cmt: SocialCommentItem) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      setNotice(t("inbox.cmtAiGenerating", { name: cmt.authorName }));
      const suggestion = await apiFetch<{ aiPlan: { publicCommentReply: string; privateDmText?: string; shouldSendDm: boolean } }>(
        `/organizations/${orgId}/social-comments/${cmt.id}/suggest-ai`,
        { method: "POST" }
      );
      if (suggestion?.aiPlan?.publicCommentReply) {
        await apiFetch(`/organizations/${orgId}/social-comments/${cmt.id}/reply`, {
          method: "POST",
          body: JSON.stringify({
            replyText: suggestion.aiPlan.publicCommentReply,
            sendPrivateDm: suggestion.aiPlan.shouldSendDm,
            privateDmText: suggestion.aiPlan.privateDmText,
          }),
        });
        setNotice(t("inbox.cmtQuickReplyDone", { name: cmt.authorName }));
        await loadData();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("inbox.cmtQuickReplyFailed"));
    }
  }

  // IN8c: one-click private reply (Meta allows one per comment,
  // within its window). Uses the DM text already planned/stored
  // for this comment; the API throws Meta's verbatim error when
  // the window has passed, and only then is nothing created.
  async function handlePrivateReply(cmt: SocialCommentItem) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    if (!cmt.privateDmText) {
      setError(t("inbox.cmtNoDmText"));
      return;
    }
    try {
      await apiFetch(`/organizations/${orgId}/social-comments/${cmt.id}/private-reply`, {
        method: "POST",
        body: JSON.stringify({ message: cmt.privateDmText }),
      });
      setNotice(t("inbox.cmtDmSent", { name: cmt.authorName }));
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("inbox.cmtDmFailed"));
    }
  }

  // IN8: platform delete — the API marks DELETED only after
  // Meta confirms with {success:true}.
  async function handleDeleteComment(cmt: SocialCommentItem) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      await apiFetch(`/organizations/${orgId}/social-comments/${cmt.id}`, { method: "DELETE" });
      setNotice(t("inbox.cmtDeleted", { name: cmt.authorName }));
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("inbox.cmtDeleteFailed"));
    }
  }

  async function toggleStatus(cmtId: string, newStatus: "PENDING" | "HIDDEN" | "ESCALATED") {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      await apiFetch(`/organizations/${orgId}/social-comments/${cmtId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
      setNotice(t("inbox.cmtStatusUpdated", { status: newStatus }));
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("inbox.cmtStatusFailed"));
    }
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    const orgId = getOrganizationId();
    if (!orgId) return;
    setSavingSettings(true);
    setError("");
    try {
      const updated = await apiFetch<SocialReplySettings>(
        `/organizations/${orgId}/social-comments/settings`,
        {
          method: "PATCH",
          body: JSON.stringify(settings),
        }
      );
      setSettings(updated);
      setNotice(t("inbox.cmtSettingsSaved"));
      setIsSettingsOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("inbox.cmtSettingsFailed"));
    } finally {
      setSavingSettings(false);
    }
  }

  const platformBadge = (p: string) => {
    switch (p) {
      case "facebook":
        return <span className="rounded bg-blue-100 text-blue-700 px-2 py-0.5 text-xs font-bold">Facebook</span>;
      case "instagram":
        return <span className="rounded bg-pink-100 text-pink-700 px-2 py-0.5 text-xs font-bold">Instagram</span>;
      case "tiktok":
        return <span className="rounded bg-slate-900 text-white px-2 py-0.5 text-xs font-bold">TikTok</span>;
      default:
        return <span className="rounded bg-red-100 text-red-700 px-2 py-0.5 text-xs font-bold">YouTube</span>;
    }
  };

  const sentimentBadge = (s: string) => {
    switch (s) {
      case "POSITIVE":
        return <span className="rounded bg-emerald-100 text-emerald-800 text-[11px] px-1.5 py-0.5 font-semibold">{t("inbox.sentPositive")}</span>;
      case "NEGATIVE":
        return <span className="rounded bg-rose-100 text-rose-800 text-[11px] px-1.5 py-0.5 font-semibold">{t("inbox.sentNegative")}</span>;
      case "SPAM":
        return <span className="rounded bg-purple-100 text-purple-800 text-[11px] px-1.5 py-0.5 font-semibold">{t("inbox.sentSpam")}</span>;
      default:
        return <span className="rounded bg-slate-100 text-slate-700 text-[11px] px-1.5 py-0.5 font-semibold">{t("inbox.sentNeutral")}</span>;
    }
  };

  const intentBadge = (i: string) => {
    switch (i) {
      case "PRICE_QUERY":
        return <span className="rounded border border-amber-300 bg-amber-50 text-amber-800 text-[11px] px-1.5 py-0.5 font-bold">{t("inbox.intentPrice")}</span>;
      case "BARGAIN":
        return <span className="rounded border border-emerald-300 bg-emerald-50 text-emerald-800 text-[11px] px-1.5 py-0.5 font-bold">{t("inbox.intentBargain")}</span>;
      case "COMPETITOR_MENTION":
        return <span className="rounded border border-orange-300 bg-orange-50 text-orange-800 text-[11px] px-1.5 py-0.5 font-bold">{t("inbox.intentCompetitor")}</span>;
      case "DELIVERY_QUERY":
        return <span className="rounded border border-blue-300 bg-blue-50 text-blue-800 text-[11px] px-1.5 py-0.5 font-bold">{t("inbox.intentDelivery")}</span>;
      case "COMPLAINT":
        return <span className="rounded border border-rose-300 bg-rose-50 text-rose-800 text-[11px] px-1.5 py-0.5 font-bold">{t("inbox.intentComplaint")}</span>;
      default:
        return <span className="rounded border border-slate-200 bg-slate-50 text-slate-600 text-[11px] px-1.5 py-0.5">{t("inbox.intentGeneral")}</span>;
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              💬 Omnichannel Social Comments & AI Reply Pilot
            </h1>
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
              Live Human-AI Mode
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {t("inbox.cmtIntro")}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsSimulatorOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 shadow-sm"
          >
            {t("inbox.cmtSimulateBtn")}
          </button>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm"
          >
            {t("inbox.cmtSettingsBtn")}
          </button>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold shadow-sm transition-all ${
              autoRefresh 
                ? "border-emerald-300 bg-emerald-50 text-emerald-800" 
                : "border-slate-200 bg-white text-slate-500"
            }`}
            title={t("inbox.cmtAutoRefreshTitle")}
          >
            <span className={`h-2 w-2 rounded-full ${autoRefresh ? "bg-emerald-500 animate-pulse" : "bg-slate-400"}`} />
            {autoRefresh ? t("inbox.cmtLiveSyncOn") : t("inbox.cmtLiveSyncOff")}
          </button>
          <button
            onClick={() => loadData(false)}
            disabled={loading}
            className="rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 shadow-sm disabled:opacity-50"
          >
            {t("inbox.cmtRefresh")}
          </button>
        </div>
      </div>

      {notice ? <div className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800 border border-emerald-200">{notice}</div> : null}
      {error ? <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800 border border-rose-200">{error}</div> : null}

      {/* Top Stats Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">{t("inbox.cmtTotal")}</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{fmtNumber(locale, comments.length)}</div>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">{t("inbox.cmtPending")}</div>
          <div className="mt-1 text-2xl font-bold text-amber-600">{fmtNumber(locale, stats.pendingCount)}</div>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">{t("inbox.cmtAiReplied")}</div>
          <div className="mt-1 text-2xl font-bold text-emerald-600">
            {fmtNumber(locale, comments.filter((c) => c.status === "AUTO_REPLIED").length)}
          </div>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">{t("inbox.cmtHidden")}</div>
          <div className="mt-1 text-2xl font-bold text-purple-600">{fmtNumber(locale, stats.hiddenCount ?? 0)}</div>
          <div className="text-[11px] text-slate-500">{t("inbox.cmtHiddenSpamLine", { hidden: fmtNumber(locale, stats.hiddenSpamCount ?? 0), spam: fmtNumber(locale, stats.spamCount) })}</div>
        </div>
      </div>

      {/* 📊 Sentiment & Intent Analytics Banner */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-xs font-bold text-slate-800 mb-2">{t("inbox.cmtSentimentTitle")}</div>
          <div className="flex items-center gap-3 text-xs">
            <div className="flex-1">
              <div className="h-3 w-full rounded-full bg-slate-100 flex overflow-hidden">
                <div style={{ width: `${(comments.filter(c => c.sentiment === 'POSITIVE').length / Math.max(1, comments.length)) * 100}%` }} className="bg-emerald-500 h-full" title={t("inbox.sentPositive")} />
                <div style={{ width: `${(comments.filter(c => c.sentiment === 'NEUTRAL').length / Math.max(1, comments.length)) * 100}%` }} className="bg-slate-400 h-full" title={t("inbox.sentNeutral")} />
                <div style={{ width: `${(comments.filter(c => c.sentiment === 'NEGATIVE').length / Math.max(1, comments.length)) * 100}%` }} className="bg-rose-500 h-full" title={t("inbox.sentComplaintShort")} />
                <div style={{ width: `${(comments.filter(c => c.sentiment === 'SPAM').length / Math.max(1, comments.length)) * 100}%` }} className="bg-purple-500 h-full" title={t("inbox.sentSpam")} />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between mt-3 text-[11px] text-slate-600">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> {t("inbox.sentPositive")} ({fmtNumber(locale, comments.filter(c => c.sentiment === 'POSITIVE').length)})</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-400" /> {t("inbox.sentNeutral")} ({fmtNumber(locale, comments.filter(c => c.sentiment === 'NEUTRAL').length)})</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" /> {t("inbox.sentComplaintShort")} ({fmtNumber(locale, comments.filter(c => c.sentiment === 'NEGATIVE').length)})</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-purple-500" /> {t("inbox.sentSpam")} ({fmtNumber(locale, comments.filter(c => c.sentiment === 'SPAM').length)})</span>
          </div>
        </div>

        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-xs font-bold text-slate-800 mb-2">{t("inbox.cmtIntentTitle")}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
            <div className="rounded-lg bg-amber-50 p-2 border border-amber-200">
              <div className="font-bold text-amber-900 text-sm">{fmtNumber(locale, comments.filter(c => c.intent === 'PRICE_QUERY').length)}</div>
              <div className="text-[10px] text-amber-700 font-semibold mt-0.5">{t("inbox.intentPriceShort")}</div>
            </div>
            <div className="rounded-lg bg-emerald-50 p-2 border border-emerald-200">
              <div className="font-bold text-emerald-900 text-sm">{fmtNumber(locale, comments.filter(c => c.intent === 'BARGAIN').length)}</div>
              <div className="text-[10px] text-emerald-700 font-semibold mt-0.5">{t("inbox.intentBargainShort")}</div>
            </div>
            <div className="rounded-lg bg-orange-50 p-2 border border-orange-200">
              <div className="font-bold text-orange-900 text-sm">{fmtNumber(locale, comments.filter(c => c.intent === 'COMPETITOR_MENTION').length)}</div>
              <div className="text-[10px] text-orange-700 font-semibold mt-0.5">{t("inbox.intentCompetitorShort")}</div>
            </div>
            <div className="rounded-lg bg-rose-50 p-2 border border-rose-200">
              <div className="font-bold text-rose-900 text-sm">{fmtNumber(locale, comments.filter(c => c.intent === 'COMPLAINT').length)}</div>
              <div className="text-[10px] text-rose-700 font-semibold mt-0.5">{t("inbox.intentComplaintShort")}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedPlatform}
            onChange={(e) => setSelectedPlatform(e.target.value)}
            className="rounded-lg border px-3 py-1.5 text-xs text-slate-700 font-medium"
          >
            <option value="all">{t("inbox.cmtAllPlatforms")}</option>
            <option value="facebook">Facebook</option>
            <option value="instagram">Instagram</option>
            <option value="tiktok">TikTok</option>
            <option value="youtube">YouTube</option>
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="rounded-lg border px-3 py-1.5 text-xs text-slate-700 font-medium"
          >
            <option value="all">{t("inbox.cmtAllStatus")}</option>
            <option value="PENDING">{t("inbox.cmtStatusPending")}</option>
            <option value="AUTO_REPLIED">AI Replied</option>
            <option value="MANUALLY_REPLIED">{t("inbox.cmtStatusManual")}</option>
            <option value="HIDDEN">{t("inbox.cmtStatusHidden")}</option>
            <option value="DELETED">{t("inbox.cmtStatusDeleted")}</option>
          </select>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <input
            type="text"
            placeholder={t("inbox.cmtSearchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="rounded-lg border px-3 py-1.5 text-xs text-slate-700 w-full sm:w-64"
          />
          <button
            onClick={handleExportCsv}
            disabled={comments.length === 0}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1 flex-shrink-0 disabled:opacity-50"
            title={t("inbox.cmtExportTitle")}
          >
            📥 Export CSV
          </button>
        </div>
      </div>

      {/* ⚡ Bulk Operations Toolbar */}
      <div className="flex items-center justify-between rounded-xl bg-slate-900 text-white px-4 py-2.5 text-xs">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={comments.length > 0 && selectedIds.length === comments.length}
            onChange={(e) => {
              if (e.target.checked) setSelectedIds(comments.map((c) => c.id));
              else setSelectedIds([]);
            }}
            className="rounded border-slate-700"
          />
          <span className="font-semibold">
            {selectedIds.length > 0 ? t("inbox.cmtSelectedCount", { count: fmtNumber(locale, selectedIds.length) }) : t("inbox.cmtSelectAll")}
          </span>
        </div>

        {selectedIds.length > 0 ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleBulkAction("AI_REPLY_ALL")}
              disabled={bulkBusy}
              className="rounded-lg bg-indigo-600 px-3 py-1 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {t("inbox.cmtBulkAi")}
            </button>
            <button
              onClick={() => handleBulkAction("HIDE_ALL")}
              disabled={bulkBusy}
              className="rounded-lg bg-slate-800 px-3 py-1 font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            >
              {t("inbox.cmtBulkHideBtn")}
            </button>
          </div>
        ) : null}
      </div>

      {/* Comment Stream List */}
      <div className="space-y-4">
        {loading ? (
          <div className="rounded-xl border bg-white p-12 text-center text-sm text-slate-500">
            {t("inbox.cmtLoading")}
          </div>
        ) : comments.length === 0 ? (
          <div className="rounded-xl border bg-white p-12 text-center text-sm text-slate-500">
            {t("inbox.cmtEmpty")}
          </div>
        ) : (
          comments.map((cmt) => (
            <div
              key={cmt.id}
              className={`rounded-xl border bg-white p-5 shadow-sm transition-all hover:border-slate-300 ${
                cmt.status === "HIDDEN" ? "opacity-60 bg-slate-50" : ""
              }`}
            >
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                {/* Left: Author & Content */}
                <div className="space-y-2 max-w-3xl">
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(cmt.id)}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedIds([...selectedIds, cmt.id]);
                        else setSelectedIds(selectedIds.filter((id) => id !== cmt.id));
                      }}
                      className="rounded border-slate-300"
                    />
                    {platformBadge(cmt.platform)}
                    <span className="font-bold text-slate-900 text-sm">{cmt.authorName}</span>
                    <span className="text-xs text-slate-400">
                      • {fmtTime(locale, cmt.createdAt)}
                    </span>
                    {sentimentBadge(cmt.sentiment)}
                    {intentBadge(cmt.intent)}
                  </div>

                  {cmt.postTitle ? (
                    <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-2 text-xs border border-slate-100">
                      {cmt.postMediaUrl ? (
                        <img
                          src={cmt.postMediaUrl}
                          alt="thumbnail"
                          className="h-10 w-10 rounded object-cover border"
                        />
                      ) : null}
                      <span className="text-slate-600 line-clamp-1 font-medium">
                        📌 <b>{t("inbox.cmtPostLabel")}:</b> {cmt.postTitle}
                      </span>
                    </div>
                  ) : null}

                  {/* Comment Bubble */}
                  <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-800 border font-medium">
                    "{cmt.commentText}"
                  </div>

                  {/* Public Reply if Exists */}
                  {cmt.replyText ? (
                    <div className="mt-2 ml-4 rounded-lg bg-indigo-50/70 p-3 text-xs border border-indigo-200">
                      <div className="flex items-center justify-between text-indigo-900 font-semibold mb-1">
                        <span>
                          {cmt.status === "AUTO_REPLIED" ? t("inbox.cmtAiReplyLabel") : t("inbox.cmtAgentReplyLabel")}
                        </span>
                        {cmt.isPrivateDmSent ? (
                          <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.2 text-[10px] font-bold">
                            {t("inbox.cmtDmSentBadge")}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-slate-700">{cmt.replyText}</p>
                    </div>
                  ) : null}
                </div>

                {/* Right: Actions */}
                <div className="flex lg:flex-col items-center lg:items-end gap-2 flex-shrink-0">
                  {!cmt.replyText ? (
                    <button
                      onClick={() => handleQuickAutoReply(cmt)}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 shadow-sm flex items-center gap-1"
                      title={t("inbox.cmtQuickReplyTitle")}
                    >
                      <span>{t("inbox.cmtQuickReplyBtn")}</span>
                    </button>
                  ) : null}

                  <button
                    onClick={() => openReplyModal(cmt)}
                    className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 shadow-sm"
                  >
                    {cmt.replyText ? t("inbox.cmtEditReplyBtn") : t("inbox.cmtReviewReplyBtn")}
                  </button>

                  {cmt.status !== "HIDDEN" ? (
                    <button
                      onClick={() => toggleStatus(cmt.id, "HIDDEN")}
                      className="rounded-lg border px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                    >
                      {t("inbox.cmtHideBtn")}
                    </button>
                  ) : (
                    <button
                      onClick={() => toggleStatus(cmt.id, "PENDING")}
                      className="rounded-lg border px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                    >
                      {t("inbox.cmtUnhideBtn")}
                    </button>
                  )}

                  {/* IN8c: comment -> DM (one Graph private reply) */}
                  {cmt.isPrivateDmSent ? (
                    <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[10px] font-bold">
                      {t("inbox.cmtDmDoneBadge")}{cmt.dmConversationId ? t("inbox.cmtDmLinkedSuffix") : ""}
                    </span>
                  ) : cmt.privateDmText && cmt.status !== "DELETED" ? (
                    <button
                      onClick={() => handlePrivateReply(cmt)}
                      className="rounded-lg border border-emerald-300 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                    >
                      {t("inbox.cmtDmBtn")}
                    </button>
                  ) : null}

                  {cmt.status !== "DELETED" ? (
                    <button
                      onClick={() => handleDeleteComment(cmt)}
                      className="rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
                    >
                      {t("inbox.cmtDeleteBtn")}
                    </button>
                  ) : (
                    <span className="rounded-full bg-rose-100 text-rose-800 px-2 py-0.5 text-[10px] font-bold">{t("inbox.cmtDeletedBadge")}</span>
                  )}

                  {cmt.assignedUserId ? (
                    <span className="text-[10px] text-slate-500">{t("inbox.cmtAssignedTo")}: {cmt.assignedUserId.slice(0, 8)}…</span>
                  ) : null}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* REPLY MODAL */}
      {activeComment ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleSendReply}
            className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {t("inbox.cmtReplyModalTitle", { name: activeComment.authorName })}
                </h3>
                <p className="text-xs text-slate-500">
                  {t("inbox.cmtPlatformLabel")}: {activeComment.platform.toUpperCase()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveComment(null)}
                className="text-slate-400 hover:text-slate-600 font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <div className="rounded-lg bg-slate-50 p-3 text-xs border text-slate-800">
              <b>{t("inbox.cmtOriginalComment")}:</b> "{activeComment.commentText}"
            </div>

            {/* Public Reply Textarea */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-slate-700">
                  {t("inbox.cmtPublicReplyLabel")}
                </label>
                {loadingAiSuggestion ? (
                  <span className="text-[11px] text-indigo-600 font-medium">{t("inbox.cmtAiSuggestionLoading")}</span>
                ) : null}
              </div>

              {/* Quick Canned Snippets Toolbar */}
              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                <span className="text-[10px] text-slate-400 font-medium mr-1">⚡ Quick Snippets:</span>
                <button
                  type="button"
                  onClick={() => setReplyInput(t("inbox.snippetCheckInboxText"))}
                  className="rounded bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 px-2 py-0.5 text-[11px] font-medium text-slate-600 border border-slate-200 transition-colors"
                >
                  {t("inbox.snippetCheckInbox")}
                </button>
                <button
                  type="button"
                  onClick={() => setReplyInput(t("inbox.snippetDeliveryText"))}
                  className="rounded bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 px-2 py-0.5 text-[11px] font-medium text-slate-600 border border-slate-200 transition-colors"
                >
                  {t("inbox.snippetDelivery")}
                </button>
                <button
                  type="button"
                  onClick={() => setReplyInput(t("inbox.snippetReturnText"))}
                  className="rounded bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 px-2 py-0.5 text-[11px] font-medium text-slate-600 border border-slate-200 transition-colors"
                >
                  {t("inbox.snippetReturn")}
                </button>
                <button
                  type="button"
                  onClick={() => setReplyInput(t("inbox.snippetDiscountText"))}
                  className="rounded bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 px-2 py-0.5 text-[11px] font-medium text-slate-600 border border-slate-200 transition-colors"
                >
                  {t("inbox.snippetDiscount")}
                </button>
              </div>

              <textarea
                value={replyInput}
                onChange={(e) => setReplyInput(e.target.value)}
                rows={3}
                required
                className="w-full rounded-lg border p-2.5 text-xs focus:border-indigo-500 focus:outline-none"
                placeholder={t("inbox.cmtReplyPlaceholder")}
              />
            </div>

            {/* Private DM Section */}
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-4 space-y-3">
              <label className="flex items-center gap-2 text-xs font-bold text-indigo-950 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendDmCheckbox}
                  onChange={(e) => setSendDmCheckbox(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600"
                />
                {t("inbox.cmtDmCheckbox")}
              </label>

              {sendDmCheckbox ? (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    {t("inbox.cmtDmDraftLabel")}
                  </label>
                  <textarea
                    value={privateDmInput}
                    onChange={(e) => setPrivateDmInput(e.target.value)}
                    rows={4}
                    className="w-full rounded-lg border p-2.5 text-xs bg-white focus:border-indigo-500 focus:outline-none"
                    placeholder={t("inbox.cmtDmPlaceholder")}
                  />
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setActiveComment(null)}
                className="rounded-lg border px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                {t("inbox.cancel")}
              </button>
              <button
                type="submit"
                disabled={submittingReply}
                className="rounded-lg bg-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {submittingReply ? t("inbox.cmtSending") : t("inbox.cmtSendReply")}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {/* SETTINGS MODAL */}
      {isSettingsOpen && settings ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleSaveSettings}
            className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  ⚙️ AI Auto-Reply & Spam Shield Settings
                </h3>
                <p className="text-xs text-slate-500">
                  {t("inbox.cmtSettingsIntro")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={settings.aiAutoReplyEnabled}
                  onChange={(e) => setSettings({ ...settings, aiAutoReplyEnabled: e.target.checked })}
                />
                {t("inbox.cmtAutopilotLabel")}
              </label>

              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={settings.sendPrivateDm}
                  onChange={(e) => setSettings({ ...settings, sendPrivateDm: e.target.checked })}
                />
                {t("inbox.cmtAutoDmLabel")}
              </label>

              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={settings.autoHideSpam}
                  onChange={(e) => setSettings({ ...settings, autoHideSpam: e.target.checked })}
                />
                {t("inbox.cmtAutoHideLabel")}
              </label>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t("inbox.cmtDelayLabel")}
                </label>
                <input
                  type="number"
                  min={5}
                  max={300}
                  value={settings.replyDelaySeconds}
                  onChange={(e) => setSettings({ ...settings, replyDelaySeconds: Number(e.target.value) })}
                  className="w-full rounded-lg border px-3 py-1.5 text-xs"
                />
                <p className="mt-1 text-[11px] text-slate-500">{t("inbox.cmtDelayNote")} {t("inbox.cmtDelayNoteSuffix")}</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t("inbox.cmtToneLabel")}
                </label>
                <select
                  value={settings.tonePreference}
                  onChange={(e) => setSettings({ ...settings, tonePreference: e.target.value })}
                  className="w-full rounded-lg border px-3 py-1.5 text-xs"
                >
                  <option value="FRIENDLY_SALES">{t("inbox.cmtToneFriendly")}</option>
                  <option value="PROFESSIONAL">{t("inbox.cmtToneProfessional")}</option>
                  <option value="HELPFUL_SUPPORT">{t("inbox.cmtToneHelpful")}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {t("inbox.cmtSalesUrlLabel")}
                </label>
                <input
                  type="url"
                  placeholder="https://yourbrand.com/shop"
                  value={settings.salesOrderUrl || ""}
                  onChange={(e) => setSettings({ ...settings, salesOrderUrl: e.target.value })}
                  className="w-full rounded-lg border px-3 py-1.5 text-xs"
                />
              </div>

              {/* Night-Owl Assurance Feature */}
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 space-y-2">
                <label className="flex items-center gap-2 text-xs font-bold text-amber-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.nightOwlEnabled ?? true}
                    onChange={(e) => setSettings({ ...settings, nightOwlEnabled: e.target.checked })}
                    className="rounded border-amber-300 text-amber-600"
                  />
                  {t("inbox.cmtNightOwlLabel")}
                </label>
                <p className="text-[11px] text-amber-700">
                  {t("inbox.cmtNightOwlNote")}
                </p>
                {settings.nightOwlEnabled ? (
                  <input
                    type="text"
                    value={settings.nightOwlMessage || ""}
                    onChange={(e) => setSettings({ ...settings, nightOwlMessage: e.target.value })}
                    placeholder={t("inbox.cmtNightOwlPlaceholder")}
                    className="w-full rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs"
                  />
                ) : null}
              </div>

              {/* Telegram Urgent Alert Notification Feature */}
              <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-3 space-y-2">
                <label className="flex items-center gap-2 text-xs font-bold text-sky-950 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.urgentAlertTelegramEnabled ?? false}
                    onChange={(e) => setSettings({ ...settings, urgentAlertTelegramEnabled: e.target.checked })}
                    className="rounded border-sky-300 text-sky-600"
                  />
                  {t("inbox.cmtTelegramLabel")}
                </label>
                <p className="text-[11px] text-sky-800">
                  {t("inbox.cmtTelegramNote")}
                </p>
                {settings.urgentAlertTelegramEnabled ? (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <label className="block text-[10px] font-semibold text-sky-900 mb-0.5">
                        Telegram Bot Token:
                      </label>
                      <input
                        type="password"
                        placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                        value={settings.telegramBotToken || ""}
                        onChange={(e) => setSettings({ ...settings, telegramBotToken: e.target.value })}
                        className="w-full rounded-lg border border-sky-200 bg-white px-2.5 py-1.5 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-sky-900 mb-0.5">
                        Telegram Chat ID / Group ID:
                      </label>
                      <input
                        type="text"
                        placeholder="@channel_or_chat_id"
                        value={settings.telegramChatId || ""}
                        onChange={(e) => setSettings({ ...settings, telegramChatId: e.target.value })}
                        className="w-full rounded-lg border border-sky-200 bg-white px-2.5 py-1.5 text-xs font-mono"
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t">
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="rounded-lg border px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                {t("inbox.cancel")}
              </button>
              <button
                type="submit"
                disabled={savingSettings}
                className="rounded-lg bg-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {savingSettings ? t("inbox.cmtSavingSettings") : t("inbox.cmtSaveSettings")}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {/* LIVE COMMENT SIMULATOR MODAL */}
      {isSimulatorOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleSimulateSubmit}
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl space-y-4"
          >
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {t("inbox.cmtSimTitle")}
                </h3>
                <p className="text-xs text-slate-500">
                  {t("inbox.cmtSimIntro")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSimulatorOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">{t("inbox.cmtSimPlatform")}</label>
                <select
                  value={simForm.platform}
                  onChange={(e) => setSimForm({ ...simForm, platform: e.target.value as any })}
                  className="w-full rounded-lg border px-3 py-1.5 text-xs font-medium"
                >
                  <option value="facebook">Facebook Page Post</option>
                  <option value="instagram">Instagram Reel / Post</option>
                  <option value="tiktok">TikTok Video</option>
                  <option value="youtube">YouTube Short</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">{t("inbox.cmtSimPostTitle")}</label>
                <input
                  type="text"
                  required
                  value={simForm.postTitle}
                  onChange={(e) => setSimForm({ ...simForm, postTitle: e.target.value })}
                  className="w-full rounded-lg border px-3 py-1.5 text-xs"
                  placeholder={t("inbox.cmtSimPostPlaceholder")}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">{t("inbox.cmtSimAuthor")}</label>
                <input
                  type="text"
                  required
                  value={simForm.authorName}
                  onChange={(e) => setSimForm({ ...simForm, authorName: e.target.value })}
                  className="w-full rounded-lg border px-3 py-1.5 text-xs"
                  placeholder={t("inbox.cmtSimAuthorPlaceholder")}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">{t("inbox.cmtSimComment")}</label>
                <textarea
                  required
                  rows={3}
                  value={simForm.commentText}
                  onChange={(e) => setSimForm({ ...simForm, commentText: e.target.value })}
                  className="w-full rounded-lg border p-2 text-xs"
                  placeholder={t("inbox.cmtSimCommentPlaceholder")}
                />
              </div>

              <div className="rounded-lg bg-indigo-50/70 p-2.5 text-[11px] text-indigo-900 border border-indigo-200">
                💡 <b>{t("inbox.cmtSimIdeas")}</b> 
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSimForm({ ...simForm, commentText: t("inbox.simIdeaPriceText") })}
                    className="rounded bg-white border border-indigo-200 px-2 py-0.5 text-[10px] hover:bg-indigo-100"
                  >
                    {t("inbox.simIdeaPrice")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSimForm({ ...simForm, commentText: t("inbox.simIdeaBargainText") })}
                    className="rounded bg-white border border-indigo-200 px-2 py-0.5 text-[10px] hover:bg-indigo-100 font-medium text-emerald-700"
                  >
                    {t("inbox.simIdeaBargain")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSimForm({ ...simForm, commentText: t("inbox.simIdeaCompetitorText") })}
                    className="rounded bg-white border border-indigo-200 px-2 py-0.5 text-[10px] hover:bg-indigo-100 font-medium text-orange-700"
                  >
                    {t("inbox.simIdeaCompetitor")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSimForm({ ...simForm, commentText: t("inbox.simIdeaComplaintText") })}
                    className="rounded bg-white border border-indigo-200 px-2 py-0.5 text-[10px] hover:bg-indigo-100"
                  >
                    {t("inbox.simIdeaComplaint")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSimForm({ ...simForm, commentText: t("inbox.simIdeaSpamText") })}
                    className="rounded bg-white border border-indigo-200 px-2 py-0.5 text-[10px] hover:bg-indigo-100 text-rose-600"
                  >
                    {t("inbox.simIdeaSpam")}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t">
              <button
                type="button"
                onClick={() => setIsSimulatorOpen(false)}
                className="rounded-lg border px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                {t("inbox.cancel")}
              </button>
              <button
                type="submit"
                disabled={simulating}
                className="rounded-lg bg-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {simulating ? t("inbox.cmtSimulating") : t("inbox.cmtSendComment")}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
