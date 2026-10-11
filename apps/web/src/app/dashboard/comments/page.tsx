"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch, getOrganizationId } from "@/lib/api";

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
  intent: "PRICE_QUERY" | "DELIVERY_QUERY" | "COMPLAINT" | "GENERAL" | "PRODUCT_INFO";
  status: "PENDING" | "AUTO_REPLIED" | "MANUALLY_REPLIED" | "HIDDEN" | "ESCALATED";
  replyText?: string;
  repliedAt?: string;
  isPrivateDmSent: boolean;
  privateDmText?: string;
  confidenceScore: number;
  createdAt: string;
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
  };
}

export default function SocialCommentsPage() {
  const [comments, setComments] = useState<SocialCommentItem[]>([]);
  const [stats, setStats] = useState({ pendingCount: 0, spamCount: 0 });
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
      if (!isSilent) setError(e instanceof Error ? e.message : "কমেন্ট লোড করতে সমস্যা হয়েছে");
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, [selectedPlatform, selectedStatus, searchQuery]);

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
      setNotice(`✅ সফলভাবে ${res.affected} টি কমেন্টের উপর ${action === "AI_REPLY_ALL" ? "AI অটো-রিপ্লাই" : action === "HIDE_ALL" ? "হাইড" : "সমাধান"} সম্পন্ন হয়েছে!`);
      setSelectedIds([]);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "বাল্ক অ্যাকশন ব্যর্থ হয়েছে");
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
    postTitle: "প্রিমিয়াম লেদার কম্বো প্যাক",
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
          authorName: simForm.authorName || "রিয়েল কাস্টমার",
          commentText: simForm.commentText,
        }),
      });
      setNotice("🎉 নতুন টেস্ট কমেন্ট ইনজেস্ট হয়েছে এবং AI স্বয়ংক্রিয়ভাবে প্রসেস করেছে!");
      setIsSimulatorOpen(false);
      setSimForm({ platform: "facebook", authorName: "", commentText: "", postTitle: "প্রিমিয়াম লেদার কম্বো প্যাক" });
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "সিমুলেশন ব্যর্থ");
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
    setNotice("📥 সকল সোশ্যাল কমেন্ট ও উত্তর সফলভাবে CSV ফাইলে ডাউনলোড হয়েছে!");
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
      await apiFetch(`/organizations/${orgId}/social-comments/${activeComment.id}/reply`, {
        method: "POST",
        body: JSON.stringify({
          replyText: replyInput,
          sendPrivateDm: sendDmCheckbox,
          privateDmText: privateDmInput,
        }),
      });
      setNotice(`✅ ${activeComment.authorName} এর কমেন্টে সফলভাবে উত্তর ও ইনবক্স মেসেজ পাঠানো হয়েছে!`);
      setActiveComment(null);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "রিপ্লাই পাঠাতে ব্যর্থ হয়েছে");
    } finally {
      setSubmittingReply(false);
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
      setNotice(`স্ট্যাটাস আপডেট হয়েছে: ${newStatus}`);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "স্ট্যাটাস পরিবর্তন ব্যর্থ");
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
      setNotice("AI রিপ্লাই ও স্প্যাম ফিল্টার সেটিংস সফলভাবে সংরক্ষিত হয়েছে! ⚙️");
      setIsSettingsOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "সেটিংস সংরক্ষণ ব্যর্থ");
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
        return <span className="rounded bg-emerald-100 text-emerald-800 text-[11px] px-1.5 py-0.5 font-semibold">পজিটিভ</span>;
      case "NEGATIVE":
        return <span className="rounded bg-rose-100 text-rose-800 text-[11px] px-1.5 py-0.5 font-semibold">অভিযোগ / নেগেটিভ</span>;
      case "SPAM":
        return <span className="rounded bg-purple-100 text-purple-800 text-[11px] px-1.5 py-0.5 font-semibold">স্প্যাম</span>;
      default:
        return <span className="rounded bg-slate-100 text-slate-700 text-[11px] px-1.5 py-0.5 font-semibold">সাধারণ</span>;
    }
  };

  const intentBadge = (i: string) => {
    switch (i) {
      case "PRICE_QUERY":
        return <span className="rounded border border-amber-300 bg-amber-50 text-amber-800 text-[11px] px-1.5 py-0.5 font-bold">💰 দাম জানতে চেয়েছে</span>;
      case "BARGAIN":
        return <span className="rounded border border-emerald-300 bg-emerald-50 text-emerald-800 text-[11px] px-1.5 py-0.5 font-bold">🏷️ দামাদামি / ছাড় চেয়েছে</span>;
      case "COMPETITOR_MENTION":
        return <span className="rounded border border-orange-300 bg-orange-50 text-orange-800 text-[11px] px-1.5 py-0.5 font-bold">🛑 প্রতিদ্বন্দীর তুলনা</span>;
      case "DELIVERY_QUERY":
        return <span className="rounded border border-blue-300 bg-blue-50 text-blue-800 text-[11px] px-1.5 py-0.5 font-bold">🚚 ডেলিভারি জানতে চেয়েছে</span>;
      case "COMPLAINT":
        return <span className="rounded border border-rose-300 bg-rose-50 text-rose-800 text-[11px] px-1.5 py-0.5 font-bold">🚨 কাস্টমার কমপ্লেইন্ট</span>;
      default:
        return <span className="rounded border border-slate-200 bg-slate-50 text-slate-600 text-[11px] px-1.5 py-0.5">💬 সাধারণ মতামত</span>;
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
            Facebook, Instagram, ও TikTok-এর সকল কমেন্ট এক স্ক্রিনে দেখুন। মানুষের মতো মিষ্টি ভাষায় কনটেক্সট-অ্যাওয়ার রিপ্লাই ও অটো প্রাইভেট ইনবক্স মেসেজ।
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsSimulatorOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 shadow-sm"
          >
            🧪 টেস্ট কমেন্ট সিমুলেট (Live Simulator)
          </button>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-sm"
          >
            ⚙️ AI রিপ্লাই ও স্প্যাম সেটিংস
          </button>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold shadow-sm transition-all ${
              autoRefresh 
                ? "border-emerald-300 bg-emerald-50 text-emerald-800" 
                : "border-slate-200 bg-white text-slate-500"
            }`}
            title="১৫ সেকেন্ড পরপর নতুন কমেন্ট স্বয়ংক্রিয়ভাবে স্ক্রিনে আনুন"
          >
            <span className={`h-2 w-2 rounded-full ${autoRefresh ? "bg-emerald-500 animate-pulse" : "bg-slate-400"}`} />
            {autoRefresh ? "Live Sync (অন)" : "Live Sync (অফ)"}
          </button>
          <button
            onClick={() => loadData(false)}
            disabled={loading}
            className="rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 shadow-sm disabled:opacity-50"
          >
            🔄 রিফ্রেশ স্ট্রিম
          </button>
        </div>
      </div>

      {notice ? <div className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800 border border-emerald-200">{notice}</div> : null}
      {error ? <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800 border border-rose-200">{error}</div> : null}

      {/* Top Stats Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">মোট কমেন্ট</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{comments.length}</div>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">অপেক্ষমাণ (Pending)</div>
          <div className="mt-1 text-2xl font-bold text-amber-600">{stats.pendingCount}</div>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">AI স্বয়ংক্রিয় উত্তর দিয়েছে</div>
          <div className="mt-1 text-2xl font-bold text-emerald-600">
            {comments.filter((c) => c.status === "AUTO_REPLIED").length}
          </div>
        </div>
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">স্প্যাম / হিডেন (Hidden)</div>
          <div className="mt-1 text-2xl font-bold text-purple-600">{stats.spamCount}</div>
        </div>
      </div>

      {/* 📊 Sentiment & Intent Analytics Banner */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-xs font-bold text-slate-800 mb-2">📈 কাস্টমার সেন্টিমেন্ট অনুপাত (Sentiment Distribution)</div>
          <div className="flex items-center gap-3 text-xs">
            <div className="flex-1">
              <div className="h-3 w-full rounded-full bg-slate-100 flex overflow-hidden">
                <div style={{ width: `${(comments.filter(c => c.sentiment === 'POSITIVE').length / Math.max(1, comments.length)) * 100}%` }} className="bg-emerald-500 h-full" title="পজিটিভ" />
                <div style={{ width: `${(comments.filter(c => c.sentiment === 'NEUTRAL').length / Math.max(1, comments.length)) * 100}%` }} className="bg-slate-400 h-full" title="সাধারণ" />
                <div style={{ width: `${(comments.filter(c => c.sentiment === 'NEGATIVE').length / Math.max(1, comments.length)) * 100}%` }} className="bg-rose-500 h-full" title="অভিযোগ" />
                <div style={{ width: `${(comments.filter(c => c.sentiment === 'SPAM').length / Math.max(1, comments.length)) * 100}%` }} className="bg-purple-500 h-full" title="স্প্যাম" />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between mt-3 text-[11px] text-slate-600">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> পজিটিভ ({comments.filter(c => c.sentiment === 'POSITIVE').length})</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-400" /> সাধারণ ({comments.filter(c => c.sentiment === 'NEUTRAL').length})</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" /> অভিযোগ ({comments.filter(c => c.sentiment === 'NEGATIVE').length})</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-purple-500" /> স্প্যাম ({comments.filter(c => c.sentiment === 'SPAM').length})</span>
          </div>
        </div>

        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="text-xs font-bold text-slate-800 mb-2">🎯 কাস্টমার প্রশ্নের ধরন (Buyer Intent)</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
            <div className="rounded-lg bg-amber-50 p-2 border border-amber-200">
              <div className="font-bold text-amber-900 text-sm">{comments.filter(c => c.intent === 'PRICE_QUERY').length}</div>
              <div className="text-[10px] text-amber-700 font-semibold mt-0.5">💰 দাম জিজ্ঞাসা</div>
            </div>
            <div className="rounded-lg bg-emerald-50 p-2 border border-emerald-200">
              <div className="font-bold text-emerald-900 text-sm">{comments.filter(c => c.intent === 'BARGAIN').length}</div>
              <div className="text-[10px] text-emerald-700 font-semibold mt-0.5">🏷️ দামাদামি / ছাড়</div>
            </div>
            <div className="rounded-lg bg-orange-50 p-2 border border-orange-200">
              <div className="font-bold text-orange-900 text-sm">{comments.filter(c => c.intent === 'COMPETITOR_MENTION').length}</div>
              <div className="text-[10px] text-orange-700 font-semibold mt-0.5">🛑 প্রতিদ্বন্দীর তুলনা</div>
            </div>
            <div className="rounded-lg bg-rose-50 p-2 border border-rose-200">
              <div className="font-bold text-rose-900 text-sm">{comments.filter(c => c.intent === 'COMPLAINT').length}</div>
              <div className="text-[10px] text-rose-700 font-semibold mt-0.5">🚨 কমপ্লেইন্ট</div>
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
            <option value="all">সব প্ল্যাটফর্ম (All)</option>
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
            <option value="all">সব স্ট্যাটাস</option>
            <option value="PENDING">অপেক্ষমাণ (Pending)</option>
            <option value="AUTO_REPLIED">AI Replied</option>
            <option value="MANUALLY_REPLIED">ম্যানুয়ালি রিপ্লাইড</option>
            <option value="HIDDEN">হিডেন / স্প্যাম</option>
          </select>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <input
            type="text"
            placeholder="কমেন্ট, কাস্টমার নাম বা প্রোডাক্ট সার্চ..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="rounded-lg border px-3 py-1.5 text-xs text-slate-700 w-full sm:w-64"
          />
          <button
            onClick={handleExportCsv}
            disabled={comments.length === 0}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1 flex-shrink-0 disabled:opacity-50"
            title="সকল কমেন্ট এক্সেল/সিএসভি ফাইলে এক্সপোর্ট করুন"
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
            {selectedIds.length > 0 ? `${selectedIds.length}টি কমেন্ট নির্বাচিত` : "সবগুলো একসাথে সিলেক্ট করুন"}
          </span>
        </div>

        {selectedIds.length > 0 ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleBulkAction("AI_REPLY_ALL")}
              disabled={bulkBusy}
              className="rounded-lg bg-indigo-600 px-3 py-1 font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              ⚡ একসাথে সবগুলোতে AI রিপ্লাই দিন
            </button>
            <button
              onClick={() => handleBulkAction("HIDE_ALL")}
              disabled={bulkBusy}
              className="rounded-lg bg-slate-800 px-3 py-1 font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            >
              🛡️ একসাথে হাইড করুন
            </button>
          </div>
        ) : null}
      </div>

      {/* Comment Stream List */}
      <div className="space-y-4">
        {loading ? (
          <div className="rounded-xl border bg-white p-12 text-center text-sm text-slate-500">
            সোশ্যাল কমেন্ট লোড হচ্ছে...
          </div>
        ) : comments.length === 0 ? (
          <div className="rounded-xl border bg-white p-12 text-center text-sm text-slate-500">
            কোনো কমেন্ট পাওয়া যায়নি।
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
                      • {new Date(cmt.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
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
                        📌 <b>পোস্ট:</b> {cmt.postTitle}
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
                          {cmt.status === "AUTO_REPLIED" ? "🤖 AI স্বয়ংক্রিয় উত্তর:" : "👤 সাপোর্ট এজেন্টের উত্তর:"}
                        </span>
                        {cmt.isPrivateDmSent ? (
                          <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.2 text-[10px] font-bold">
                            📩 ইনবক্স DM পাঠানো হয়েছে
                          </span>
                        ) : null}
                      </div>
                      <p className="text-slate-700">{cmt.replyText}</p>
                    </div>
                  ) : null}
                </div>

                {/* Right: Actions */}
                <div className="flex lg:flex-col items-center lg:items-end gap-2 flex-shrink-0">
                  <button
                    onClick={() => openReplyModal(cmt)}
                    className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 shadow-sm"
                  >
                    {cmt.replyText ? "✏️ রিপ্লাই এডিট / পুনরায় পাঠান" : "⚡ মানুষের মতো AI রিপ্লাই"}
                  </button>

                  {cmt.status !== "HIDDEN" ? (
                    <button
                      onClick={() => toggleStatus(cmt.id, "HIDDEN")}
                      className="rounded-lg border px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                    >
                      🛡️ হাইড করুন
                    </button>
                  ) : (
                    <button
                      onClick={() => toggleStatus(cmt.id, "PENDING")}
                      className="rounded-lg border px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                    >
                      আন-হাইড করুন
                    </button>
                  )}
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
                  {activeComment.authorName} এর কমেন্টে উত্তর দিন
                </h3>
                <p className="text-xs text-slate-500">
                  প্ল্যাটফর্ম: {activeComment.platform.toUpperCase()}
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
              <b>মূল কমেন্ট:</b> "{activeComment.commentText}"
            </div>

            {/* Public Reply Textarea */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-slate-700">
                  পাবলিক কমেন্ট রিপ্লাই (ফেসবুক/ইনস্টাতে সবাই দেখবে)
                </label>
                {loadingAiSuggestion ? (
                  <span className="text-[11px] text-indigo-600 font-medium">✨ AI সাজেশন লোড হচ্ছে...</span>
                ) : null}
              </div>

              {/* Quick Canned Snippets Toolbar */}
              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                <span className="text-[10px] text-slate-400 font-medium mr-1">⚡ Quick Snippets:</span>
                <button
                  type="button"
                  onClick={() => setReplyInput("জি ভাইয়া/আপু, আপনার ইনবক্সে বিস্তারিত মূল্য ও ডিসকাউন্ট লিংক পাঠানো হয়েছে! অনুগ্রহ করে মেসেজ চেক করুন।")}
                  className="rounded bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 px-2 py-0.5 text-[11px] font-medium text-slate-600 border border-slate-200 transition-colors"
                >
                  📨 চেক ইনবক্স
                </button>
                <button
                  type="button"
                  onClick={() => setReplyInput("আমাদের সারা বাংলাদেশে ক্যাশ অন ডেলিভারি সুবিধা আছে। ঢাকা সিটিতে ২৪-৪৮ ঘণ্টা, ঢাকার বাইরে ২-৩ দিনে পৌঁছে যাবে ইনশাআল্লাহ।")}
                  className="rounded bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 px-2 py-0.5 text-[11px] font-medium text-slate-600 border border-slate-200 transition-colors"
                >
                  🚚 ডেলিভারি নিয়ম
                </button>
                <button
                  type="button"
                  onClick={() => setReplyInput("প্রোডাক্ট হাতে পেয়ে চেক করে পেমেন্ট করার ১০০% গ্যারান্টি সুবিধা পাবেন। কোনো সমস্যা হলে ৭ দিনের ইজি রিপ্লেসমেন্ট পলিসি রয়েছে।")}
                  className="rounded bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 px-2 py-0.5 text-[11px] font-medium text-slate-600 border border-slate-200 transition-colors"
                >
                  🛡️ রিটার্ন/ওয়ারেন্টি
                </button>
                <button
                  type="button"
                  onClick={() => setReplyInput("জি অবশ্যই! আজকের স্পেশাল কম্বো অফারে অতিরিক্ত ডিসকাউন্ট পাবেন। অর্ডার করতে এখনই ইনবক্সে আপনার নম্বর ও ঠিকানা দিন।")}
                  className="rounded bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 px-2 py-0.5 text-[11px] font-medium text-slate-600 border border-slate-200 transition-colors"
                >
                  🎁 ডিসকাউন্ট অফার
                </button>
              </div>

              <textarea
                value={replyInput}
                onChange={(e) => setReplyInput(e.target.value)}
                rows={3}
                required
                className="w-full rounded-lg border p-2.5 text-xs focus:border-indigo-500 focus:outline-none"
                placeholder="মানুষের মতো মিষ্টি ভাষায় উত্তর লিখুন..."
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
                📩 কাস্টমারের ইনবক্সে সরাসরি প্রাইভেট মেসেজ ও অর্ডার লিংক পাঠান (Auto Private DM)
              </label>

              {sendDmCheckbox ? (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    ইনবক্স মেসেজের ড্রাফট (Order Link & Offer Included):
                  </label>
                  <textarea
                    value={privateDmInput}
                    onChange={(e) => setPrivateDmInput(e.target.value)}
                    rows={4}
                    className="w-full rounded-lg border p-2.5 text-xs bg-white focus:border-indigo-500 focus:outline-none"
                    placeholder="ইনবক্স মেসেজ লিখুন..."
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
                বাতিল
              </button>
              <button
                type="submit"
                disabled={submittingReply}
                className="rounded-lg bg-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {submittingReply ? "পাঠানো হচ্ছে..." : "🚀 রিপ্লাই ও ইনবক্স সেন্ড করুন"}
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
                  স্বয়ংক্রিয় উত্তর, সুরক্ষাব্যবস্থা এবং টোন পছন্দ নির্ধারণ করুন
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
                🤖 24/7 AI অটোপাইলট রিপ্লাই চালু রাখুন (নতুন কমেন্টে স্বয়ংক্রিয় উত্তর যাবে)
              </label>

              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={settings.sendPrivateDm}
                  onChange={(e) => setSettings({ ...settings, sendPrivateDm: e.target.checked })}
                />
                📩 দাম বা প্রোডাক্ট জিজ্ঞাসায় স্বয়ংক্রিয়ভাবে ইনবক্সে মেসেজ পাঠান
              </label>

              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={settings.autoHideSpam}
                  onChange={(e) => setSettings({ ...settings, autoHideSpam: e.target.checked })}
                />
                🛡️ স্প্যাম, অন্য পেজের লিংক বা গালিগালাজ যুক্ত কমেন্ট সাথে সাথে অটো-হাইড করুন
              </label>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  রিপ্লাই দেওয়ার সময় বিলম্ব (Delay Seconds - মানুষের মতো দেখাতে):
                </label>
                <input
                  type="number"
                  min={5}
                  max={300}
                  value={settings.replyDelaySeconds}
                  onChange={(e) => setSettings({ ...settings, replyDelaySeconds: Number(e.target.value) })}
                  className="w-full rounded-lg border px-3 py-1.5 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  কথোপকথনের টোন (AI Personality):
                </label>
                <select
                  value={settings.tonePreference}
                  onChange={(e) => setSettings({ ...settings, tonePreference: e.target.value })}
                  className="w-full rounded-lg border px-3 py-1.5 text-xs"
                >
                  <option value="FRIENDLY_SALES">Friendly & High-Converting (বন্ধুভাবাপন্ন ও সেলস ফোকাস্ড)</option>
                  <option value="PROFESSIONAL">Professional Corporate (মার্জিত ও পেশাদার)</option>
                  <option value="HELPFUL_SUPPORT">Helpful Customer Support (কাস্টমার সাপোর্ট)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  ডিফল্ট সেলস পেজ / অর্ডার ইউআরএল (ইনবক্স মেসেজে যাবে):
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
                  🦉 নাইট-আউল আশ্বাসন (রাত ১২টা থেকে সকাল ৮টার কমেন্টে বিশেষ বার্তা)
                </label>
                <p className="text-[11px] text-amber-700">
                  অফিস বন্ধের সময়েও কাস্টমারকে আশ্বস্ত করবে যে তাদের অর্ডার ও কুয়েরি সকাল ৯টায় ফার্স্ট প্রায়োরিটিতে প্রসেস করা হবে।
                </p>
                {settings.nightOwlEnabled ? (
                  <input
                    type="text"
                    value={settings.nightOwlMessage || ""}
                    onChange={(e) => setSettings({ ...settings, nightOwlMessage: e.target.value })}
                    placeholder="শুভরাত্রি! আমাদের অফিস এখন বন্ধ থাকলেও সকাল ৯টায় ফার্স্ট প্রায়োরিটিতে আপনার অর্ডার প্রসেস করা হবে।"
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
                  🔔 টেলিগ্রাম আর্জেন্ট অ্যালার্ট (অভিযোগ ও কম্পিটিটর হাইজ্যাক হলে সাথে সাথে নোটিফিকেশন)
                </label>
                <p className="text-[11px] text-sky-800">
                  কোনো কাস্টমার ব্যাড রিভিউ দিলে বা প্রতিদ্বন্দ্বী ব্র্যান্ড হাইজ্যাক করার চেষ্টা করলে সরাসরি টেলিগ্রাম গ্রুপ বা বটে পুশ অ্যালার্ট যাবে।
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
                বাতিল
              </button>
              <button
                type="submit"
                disabled={savingSettings}
                className="rounded-lg bg-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {savingSettings ? "সংরক্ষণ হচ্ছে..." : "সেটিংস সংরক্ষণ করুন"}
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
                  🧪 লাইভ কমেন্ট সিমুলেটর (Live Comment Simulator)
                </h3>
                <p className="text-xs text-slate-500">
                  সোশ্যাল মিডিয়া থেকে কমেন্ট এলে AI কীভাবে রেসপন্স করে তা এখনই লাইভ টেস্ট করুন
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
                <label className="block text-xs font-semibold text-slate-700 mb-1">প্ল্যাটফর্ম:</label>
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
                <label className="block text-xs font-semibold text-slate-700 mb-1">পোস্টের বিষয় / প্রোডাক্টের নাম:</label>
                <input
                  type="text"
                  required
                  value={simForm.postTitle}
                  onChange={(e) => setSimForm({ ...simForm, postTitle: e.target.value })}
                  className="w-full rounded-lg border px-3 py-1.5 text-xs"
                  placeholder="যেমন: প্রিমিয়াম লেদার ওয়ালেট ও বেল্ট কম্বো"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">কাস্টমারের নাম:</label>
                <input
                  type="text"
                  required
                  value={simForm.authorName}
                  onChange={(e) => setSimForm({ ...simForm, authorName: e.target.value })}
                  className="w-full rounded-lg border px-3 py-1.5 text-xs"
                  placeholder="যেমন: আসিফ ইকবাল"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">কাস্টমারের মন্তব্য (Comment):</label>
                <textarea
                  required
                  rows={3}
                  value={simForm.commentText}
                  onChange={(e) => setSimForm({ ...simForm, commentText: e.target.value })}
                  className="w-full rounded-lg border p-2 text-xs"
                  placeholder="যেমন: ভাইয়া এটার দাম কত? চট্টগ্রামে কতদিনের মধ্যে ডেলিভারি হবে?"
                />
              </div>

              <div className="rounded-lg bg-indigo-50/70 p-2.5 text-[11px] text-indigo-900 border border-indigo-200">
                💡 <b>দ্রুত টেস্ট আইডিয়া:</b> 
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSimForm({ ...simForm, commentText: "ভাইয়া এটার বর্তমান অফার প্রাইস কত? হোম ডেলিভারি কি ফ্রি?" })}
                    className="rounded bg-white border border-indigo-200 px-2 py-0.5 text-[10px] hover:bg-indigo-100"
                  >
                    দাম জিজ্ঞাসা
                  </button>
                  <button
                    type="button"
                    onClick={() => setSimForm({ ...simForm, commentText: "ভাইয়া ১০০০ টাকা রাখা যাবে? কিছু ছাড় দিলে এখনই নিয়ে নিব।" })}
                    className="rounded bg-white border border-indigo-200 px-2 py-0.5 text-[10px] hover:bg-indigo-100 font-medium text-emerald-700"
                  >
                    🏷️ দামাদামি / ছাড়
                  </button>
                  <button
                    type="button"
                    onClick={() => setSimForm({ ...simForm, commentText: "দারাজ এ তো এটা কম দামে পাওয়া যায়, আপনাদের এত দাম কেন?" })}
                    className="rounded bg-white border border-indigo-200 px-2 py-0.5 text-[10px] hover:bg-indigo-100 font-medium text-orange-700"
                  >
                    🛑 প্রতিদ্বন্দীর তুলনা
                  </button>
                  <button
                    type="button"
                    onClick={() => setSimForm({ ...simForm, commentText: "পার্সেল হাতে পেয়ে দেখলাম সাইজ ছোট, এক্সচেঞ্জ করতে চাই।" })}
                    className="rounded bg-white border border-indigo-200 px-2 py-0.5 text-[10px] hover:bg-indigo-100"
                  >
                    কমপ্লেইন্ট
                  </button>
                  <button
                    type="button"
                    onClick={() => setSimForm({ ...simForm, commentText: "ঘরে বসে সহজে ইনকাম করতে আমাদের টেলিগ্রাম লিংকে ক্লিক করুন bit.ly/spam" })}
                    className="rounded bg-white border border-indigo-200 px-2 py-0.5 text-[10px] hover:bg-indigo-100 text-rose-600"
                  >
                    স্প্যাম
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
                বাতিল
              </button>
              <button
                type="submit"
                disabled={simulating}
                className="rounded-lg bg-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {simulating ? "সিমুলেট হচ্ছে..." : "🚀 কমেন্ট সেন্ড করুন"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
