"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { getOrganizationId } from "../../../lib/org";
import { subscribeTicketStream } from "../../../lib/support-stream";

interface TicketAttachment {
  name: string;
  url: string;
  size?: number;
  mimeType?: string;
}

interface TicketMessage {
  id: string;
  authorKind: string;
  body: string;
  createdAt: string;
  isInternal?: boolean;
  attachments?: TicketAttachment[];
}

interface Ticket {
  id: string;
  subject: string;
  category?: string;
  status: string;
  priority: string;
  lastMessageAt: string;
  createdAt: string;
  messageCount?: number;
  messages?: TicketMessage[];
  csatRating?: number | null;
  csatFeedback?: string | null;
  slaDueAt?: string | null;
}

interface SolutionSuggestion {
  title: string;
  summary: string;
  actionText?: string;
  link?: string;
}

const STATUS_TEXT: Record<string, string> = {
  open: "খোলা",
  pending: "উত্তরের অপেক্ষায়",
  in_progress: "কাজ চলছে",
  resolved: "সমাধান হয়েছে",
  closed: "বন্ধ",
};

const STATUS_BADGE: Record<string, string> = {
  open: "badge-green",
  pending: "badge-amber",
  in_progress: "badge-brand",
  resolved: "badge-brand",
  closed: "badge-slate",
};

const STATUS_DOT: Record<string, string> = {
  open: "bg-emerald-500",
  pending: "bg-amber-500",
  in_progress: "bg-blue-500",
  resolved: "bg-brand-500",
  closed: "bg-slate-400",
};

const PRIORITY_TEXT: Record<string, string> = {
  normal: "সাধারণ",
  high: "জরুরি",
  urgent: "🚨 অতি জরুরি",
};

const CATEGORY_TEXT: Record<string, string> = {
  general: "💬 সাধারণ",
  billing: "💳 বিলিং ও পেমেন্ট",
  technical: "⚙️ কারিগরি ত্রুটি",
  campaigns: "📢 বিজ্ঞাপন ক্যাম্পেইন",
  integration: "🔌 ইন্টিগ্রেশন ও পিক্সেল",
};

const STATUS_BANNER: Record<string, { tone: string; text: string }> = {
  open: { tone: "alert-slate", text: "টিকিটটি খোলা আছে — প্ল্যাটফর্ম টিমের উত্তর এখানেই আসবে, ইমেইলেও জানানো হবে।" },
  pending: { tone: "alert-amber", text: "প্ল্যাটফর্ম টিম উত্তর দিয়েছে — এখন আপনার জবাবের অপেক্ষায়। নিচে উত্তর লিখুন।" },
  in_progress: { tone: "alert-brand", text: "আমাদের ইঞ্জিনিয়াররা সমস্যাটির ওপর সক্রিয়ভাবে কাজ করছেন। শীঘ্রই আপডেট পাবেন।" },
  resolved: { tone: "alert-green", text: "টিকিটটি সমাধান হয়েছে বলে চিহ্নিত করা হয়েছে। সমস্যাটি থেকে গেলে নিচে উত্তর লিখলেই টিকিটটি আবার খুলে যাবে।" },
  closed: { tone: "alert-slate", text: "টিকিটটি বন্ধ আছে। উত্তর পাঠালে অথবা “আবার খুলুন” চাপলে এটি আবার খুলে যাবে।" },
};

const bnNum = (n: number) => n.toLocaleString("bn-BD", { maximumFractionDigits: 0 });

function relativeBn(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "এইমাত্র";
  if (mins < 60) return `${bnNum(mins)} মিনিট আগে`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${bnNum(hours)} ঘণ্টা আগে`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${bnNum(days)} দিন আগে`;
  return new Date(iso).toLocaleDateString("bn-BD", { day: "numeric", month: "short", year: "numeric" });
}

const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("bn-BD", { day: "numeric", month: "long", year: "numeric" });
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString("bn-BD", { hour: "numeric", minute: "2-digit" });
const fullLabel = (iso: string) => new Date(iso).toLocaleString("bn-BD");

function StatusBadge({ status }: { status: string }) {
  const known = status in STATUS_TEXT;
  return (
    <span className={known ? STATUS_BADGE[status] : "badge-slate"}>
      {known ? <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} /> : null}
      {known ? STATUS_TEXT[status] : status}
    </span>
  );
}

export default function SupportPage() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [error, setError] = useState("");

  // Creation form states
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("general");
  const [priority, setPriority] = useState("normal");
  const [createAttachments, setCreateAttachments] = useState<TicketAttachment[]>([]);

  // Reply states
  const [reply, setReply] = useState("");
  const [replyAttachments, setReplyAttachments] = useState<TicketAttachment[]>([]);

  // Deflection & Suggestions
  const [suggestions, setSuggestions] = useState<SolutionSuggestion[]>([]);
  const [aiTip, setAiTip] = useState<string | null>(null);
  const [checkingSuggestions, setCheckingSuggestions] = useState(false);

  // CSAT Rating states
  const [ratingInput, setRatingInput] = useState<number>(5);
  const [feedbackInput, setFeedbackInput] = useState("");
  const [csatSubmitted, setCsatSubmitted] = useState(false);
  const [csatSubmitting, setCsatSubmitting] = useState(false);

  const [activeLeftTab, setActiveLeftTab] = useState<"list" | "create">("list");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const createFileInputRef = useRef<HTMLInputElement | null>(null);
  const replyFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setOrgId(getOrganizationId());
  }, []);

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      const res = await apiFetch<Ticket[]>(`/organizations/${orgId}/tickets`);
      setTickets(res);
      if (res.length === 0) setActiveLeftTab("create");
    } catch {
      /* honest empty */
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime Live Stream (SSE) + Typing indicator + Fallback Polling
  const [adminTyping, setAdminTyping] = useState(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastTypingSentRef = useRef<number>(0);

  const handleTenantTyping = () => {
    if (!orgId || !selected || selected.status === "closed") return;
    const now = Date.now();
    if (now - lastTypingSentRef.current > 3000) {
      lastTypingSentRef.current = now;
      apiFetch(`/organizations/${orgId}/tickets/${selected.id}/typing`, {
        method: "POST",
        body: JSON.stringify({ isTyping: true }),
      }).catch(() => undefined);
    }
  };

  useEffect(() => {
    if (!orgId || !selected || selected.status === "closed") return;

    // 1. Instant Push via Server-Sent Events (SSE)
    const unsubscribe = subscribeTicketStream(orgId, selected.id, (event) => {
      if (event.type === "message.created" && event.data) {
        setSelected((prev) => {
          if (!prev || prev.id !== selected.id) return prev;
          if (prev.messages?.some((m) => m.id === event.data.id)) return prev;
          return {
            ...prev,
            messages: [...(prev.messages ?? []), event.data],
            lastMessageAt: event.data.createdAt ?? new Date().toISOString(),
          };
        });
        setAdminTyping(false);
      } else if (event.type === "ticket.updated" && event.data) {
        setSelected((prev) => (prev ? { ...prev, ...event.data } : prev));
      } else if (event.type === "typing" && event.who === "admin") {
        setAdminTyping(Boolean(event.isTyping));
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        if (event.isTyping) {
          typingTimeoutRef.current = setTimeout(() => setAdminTyping(false), 4000);
        }
      }
    });

    // 2. Safe Fallback polling (30s) if connection is interrupted
    const interval = setInterval(async () => {
      try {
        const fresh = await apiFetch<Ticket>(`/organizations/${orgId}/tickets/${selected.id}`);
        if (fresh && fresh.messages && fresh.messages.length !== selected.messages?.length) {
          setSelected(fresh);
        }
      } catch {
        // silent
      }
    }, 30000);

    return () => {
      unsubscribe();
      clearInterval(interval);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [orgId, selected?.id]);

  const open = async (id: string) => {
    if (!orgId) return;
    setOpening(true);
    setCsatSubmitted(false);
    try {
      setSelected(await apiFetch<Ticket>(`/organizations/${orgId}/tickets/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ticket খোলা যাচ্ছে না");
    } finally {
      setOpening(false);
    }
  };

  // Smart suggestions on subject/body change
  useEffect(() => {
    if (!orgId || subject.trim().length < 4) {
      setSuggestions([]);
      setAiTip(null);
      return;
    }
    const timer = setTimeout(async () => {
      setCheckingSuggestions(true);
      try {
        const res = await apiFetch<{ suggestions: SolutionSuggestion[]; aiInstantTip: string | null }>(
          `/organizations/${orgId}/tickets/suggest-solutions`,
          {
            method: "POST",
            body: JSON.stringify({ subject, body, category }),
          },
        );
        if (res) {
          setSuggestions(res.suggestions ?? []);
          setAiTip(res.aiInstantTip ?? null);
        }
      } catch {
        // Silent
      } finally {
        setCheckingSuggestions(false);
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [orgId, subject, body, category]);

  // File upload / paste handlers
  const handleAttachmentUpload = (file: File, isReply: boolean) => {
    if (file.size > 8 * 1024 * 1024) {
      setError("ফাইলের সাইজ সর্বোচ্চ 8MB হতে পারে");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      const att: TicketAttachment = {
        name: file.name,
        url: base64,
        size: file.size,
        mimeType: file.type,
      };
      if (isReply) {
        setReplyAttachments((prev) => [...prev, att]);
      } else {
        setCreateAttachments((prev) => [...prev, att]);
      }
    };
    reader.readAsDataURL(file);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>, isReply: boolean) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) {
          handleAttachmentUpload(file, isReply);
          e.preventDefault();
        }
      }
    }
  };

  const create = async () => {
    if (!orgId) return;
    setError("");
    try {
      const diagnostics = {
        url: typeof window !== "undefined" ? window.location.href : null,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        screen: typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : null,
      };

      const t = await apiFetch<Ticket>(`/organizations/${orgId}/tickets`, {
        method: "POST",
        body: JSON.stringify({
          subject,
          body,
          category,
          priority,
          attachments: createAttachments,
          diagnostics,
        }),
      });
      setSubject("");
      setBody("");
      setPriority("normal");
      setCategory("general");
      setCreateAttachments([]);
      setSuggestions([]);
      setAiTip(null);
      await load();
      setSelected(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ticket তৈরি হয়নি");
    }
  };

  const sendReply = async () => {
    if (!orgId || !selected || (!reply.trim() && replyAttachments.length === 0)) return;
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/tickets/${selected.id}/messages`, {
        method: "POST",
        body: JSON.stringify({
          body: reply,
          attachments: replyAttachments,
        }),
      });
      setReply("");
      setReplyAttachments([]);
      await open(selected.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "উত্তর পাঠানো যায়নি");
    }
  };

  const setStatus = async (status: string) => {
    if (!orgId || !selected) return;
    try {
      await apiFetch(`/organizations/${orgId}/tickets/${selected.id}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      await open(selected.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Status বদলায়নি");
    }
  };

  const handleCsatSubmit = async () => {
    if (!orgId || !selected) return;
    setCsatSubmitting(true);
    try {
      await apiFetch(`/organizations/${orgId}/tickets/${selected.id}/csat`, {
        method: "POST",
        body: JSON.stringify({ rating: ratingInput, feedback: feedbackInput.trim() || undefined }),
      });
      setCsatSubmitted(true);
      await open(selected.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "রেটিং সংরক্ষণ করা যায়নি");
    } finally {
      setCsatSubmitting(false);
    }
  };

  const lastMsgId = selected?.messages?.length ? selected.messages[selected.messages.length - 1].id : null;
  useEffect(() => {
    if (selected && lastMsgId) threadEndRef.current?.scrollIntoView({ block: "end" });
  }, [selected?.id, lastMsgId]);

  const counts = {
    total: tickets.length,
    open: tickets.filter((t) => t.status === "open").length,
    pending: tickets.filter((t) => t.status === "pending").length,
    resolved: tickets.filter((t) => t.status === "resolved").length,
    closed: tickets.filter((t) => t.status === "closed").length,
  };

  const filteredTickets = statusFilter === "all" ? tickets : tickets.filter((t) => t.status === statusFilter);

  const getSlaBadge = (t: Ticket) => {
    if (t.status === "resolved" || t.status === "closed") return null;
    if (!t.slaDueAt) return null;
    const diff = new Date(t.slaDueAt).getTime() - Date.now();
    if (diff <= 0) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200 px-2 py-0.5 text-[10px] font-bold text-rose-700 animate-pulse">
          <span>⚠️</span> SLA অতিক্রান্ত
        </span>
      );
    }
    const hours = Math.round(diff / (1000 * 60 * 60));
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
        <span>⏳</span> SLA: ~{hours}h বাকি
      </span>
    );
  };

  const threadActive = !!selected || opening;
  const awayOnMobile = threadActive ? "hidden lg:block" : "";
  const banner = selected ? STATUS_BANNER[selected.status] : undefined;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      {/* Modern Hero Section */}
      <section className={`hero-panel relative overflow-hidden p-5 sm:p-7 shadow-lg ${awayOnMobile}`}>
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-indigo-500/20 to-brand-500/0 rounded-full blur-3xl pointer-events-none" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="live-pulse" />
              <span className="text-xs font-semibold text-emerald-300">২৪/৭ এআই ও লাইভ সাপোর্ট সক্রিয়</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-[28px]">
              সাপোর্ট ও হেল্পডেস্ক হাব
            </h1>
            <p className="mt-1 max-w-xl text-sm text-white/80 leading-relaxed">
              যেকোনো কারিগরি ত্রুটি, পিক্সেল বা বিলিং সংক্রান্ত প্রয়োজনে সরাসরি আমাদের সাপোর্ট টিমের সাহায্য নিন।
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setActiveLeftTab("create");
                setSelected(null);
              }}
              className="px-4 py-2 text-xs font-bold rounded-xl bg-white text-slate-900 hover:bg-slate-100 shadow-md transition-all flex items-center gap-1.5"
            >
              <span>＋</span> নতুন টিকিট খুলুন
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <div className="alert alert-red">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      ) : null}

      {/* Interactive Status Summary Filter Chips */}
      <div className={`grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5 ${awayOnMobile}`}>
        {loading ? (
          Array.from({ length: 5 }, (_, i) => <div key={i} className="skeleton h-[62px]" />)
        ) : (
          <>
            <button
              type="button"
              onClick={() => { setStatusFilter("all"); setActiveLeftTab("list"); }}
              className={`count-chip text-left transition-all hover:scale-[1.01] ${
                statusFilter === "all" ? "ring-2 ring-brand-500 bg-brand-50/40" : ""
              }`}
            >
              <span className="text-xl leading-none">🎫</span>
              <span>
                <span className="count-chip-value">{bnNum(counts.total)}</span>
                <span className="count-chip-label block">মোট টিকিট</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => { setStatusFilter("open"); setActiveLeftTab("list"); }}
              className={`count-chip text-left transition-all hover:scale-[1.01] ${
                statusFilter === "open" ? "ring-2 ring-emerald-500 bg-emerald-50/40" : ""
              }`}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
              <span>
                <span className="count-chip-value">{bnNum(counts.open)}</span>
                <span className="count-chip-label block">খোলা</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => { setStatusFilter("pending"); setActiveLeftTab("list"); }}
              className={`count-chip text-left transition-all hover:scale-[1.01] ${
                statusFilter === "pending" ? "ring-2 ring-amber-500 bg-amber-50/40" : ""
              }`}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500" />
              <span>
                <span className="count-chip-value">{bnNum(counts.pending)}</span>
                <span className="count-chip-label block">অপেক্ষমাণ</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => { setStatusFilter("resolved"); setActiveLeftTab("list"); }}
              className={`count-chip text-left transition-all hover:scale-[1.01] ${
                statusFilter === "resolved" ? "ring-2 ring-indigo-500 bg-indigo-50/40" : ""
              }`}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-indigo-500" />
              <span>
                <span className="count-chip-value">{bnNum(counts.resolved)}</span>
                <span className="count-chip-label block">সমাধান</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => { setStatusFilter("closed"); setActiveLeftTab("list"); }}
              className={`count-chip text-left transition-all hover:scale-[1.01] ${
                statusFilter === "closed" ? "ring-2 ring-slate-400 bg-slate-100" : ""
              }`}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-slate-400" />
              <span>
                <span className="count-chip-value">{bnNum(counts.closed)}</span>
                <span className="count-chip-label block">বন্ধ</span>
              </span>
            </button>
          </>
        )}
      </div>

      <div className={awayOnMobile}>
        <FeedbackCard orgId={orgId} />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[380px_1fr]">
        {/* Left Column: View Switcher + Form / List */}
        <div className={`space-y-4 ${threadActive ? "hidden lg:block" : ""}`}>
          {/* Segmented View Switcher */}
          <div className="flex items-center justify-between rounded-2xl bg-slate-100/90 p-1 border border-slate-200/60 shadow-2xs">
            <button
              type="button"
              onClick={() => setActiveLeftTab("list")}
              className={`flex-1 py-2 text-xs font-bold rounded-xl transition ${
                activeLeftTab === "list"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              💬 টিকিটসমূহ ({bnNum(filteredTickets.length)})
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveLeftTab("create");
                setSelected(null);
              }}
              className={`flex-1 py-2 text-xs font-bold rounded-xl transition ${
                activeLeftTab === "create"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              ＋ নতুন টিকিট
            </button>
          </div>

          {activeLeftTab === "create" ? (
            /* Create Ticket Form */
            <section id="new-ticket" className="card p-5 animate-fade-in shadow-card-v2">
              <h2 className="section-title flex items-center gap-2">
                <span className="stat-icon stat-icon-brand !h-9 !w-9 !rounded-xl text-base">✉️</span>
                নতুন টিকিট তৈরি করুন
              </h2>

              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="বিষয় — যেমন: Meta Pixel কনভার্সন ট্র্যাকিং হচ্ছে না"
                className="input mt-4"
              />

              <div className="mt-2 grid grid-cols-2 gap-2">
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="input text-xs"
                  aria-label="ক্যাটাগরি"
                >
                  {Object.entries(CATEGORY_TEXT).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>

                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="input text-xs font-medium"
                  aria-label="গুরুত্ব"
                >
                  <option value="normal">সাধারণ (Normal)</option>
                  <option value="high">জরুরি (High)</option>
                  <option value="urgent">🚨 অতি জরুরি (Urgent)</option>
                </select>
              </div>

              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onPaste={(e) => handlePaste(e, false)}
                rows={4}
                placeholder="সমস্যাটা বিস্তারিত লিখুন (স্ক্রিনশট সরাসরি পেস্ট Ctrl+V করতে পারেন)…"
                className="input mt-2 resize-none text-sm"
              />

              {/* Attached files preview */}
              {createAttachments.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {createAttachments.map((att, idx) => (
                    <div key={idx} className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-700">
                      <span>📎 {att.name}</span>
                      <button
                        type="button"
                        onClick={() => setCreateAttachments((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-rose-600 hover:text-rose-800 font-bold"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              {/* Smart Deflection Suggestions */}
              {(suggestions.length > 0 || aiTip) && (
                <div className="mt-3 rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50/80 to-indigo-50/40 p-3.5 text-xs text-indigo-950 shadow-2xs">
                  <div className="flex items-center gap-1.5 font-bold text-sky-950 mb-2">
                    <span>💡</span>
                    <span>তাৎক্ষণিক সমাধান টিপস (টিকিট খোলার আগে দেখে নিন):</span>
                  </div>
                  {aiTip ? <p className="mb-2 leading-relaxed text-slate-800 bg-white/80 p-2.5 rounded-xl border border-sky-100">{aiTip}</p> : null}
                  <div className="space-y-1.5">
                    {suggestions.map((s, i) => (
                      <div key={i} className="rounded-xl border border-sky-100 bg-white p-2.5 shadow-2xs">
                        <b className="block text-indigo-950">{s.title}</b>
                        <p className="mt-0.5 text-slate-600 leading-normal">{s.summary}</p>
                        {s.link && s.actionText ? (
                          <a href={s.link} className="mt-1.5 inline-block font-bold text-brand-600 hover:underline">
                            → {s.actionText}
                          </a>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                <div>
                  <input
                    ref={createFileInputRef}
                    type="file"
                    accept="image/*,.pdf,.txt,.log"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleAttachmentUpload(f, false);
                    }}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => createFileInputRef.current?.click()}
                    className="btn-secondary btn-sm min-h-[40px] text-xs flex items-center gap-1"
                  >
                    📎 ফাইল/স্ক্রিনশট
                  </button>
                </div>

                <button
                  onClick={create}
                  disabled={!subject.trim() || !body.trim()}
                  className="btn-primary min-h-[40px] px-5 text-xs font-bold"
                >
                  টিকিট সাবমিট করুন ➤
                </button>
              </div>
            </section>
          ) : (
            /* Ticket list */
            <section id="ticket-list" className="space-y-2.5 animate-fade-in">
              {loading ? (
                Array.from({ length: 3 }, (_, i) => <div key={i} className="skeleton h-[84px] rounded-2xl" />)
              ) : filteredTickets.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-6 text-center">
                  <div className="text-3xl">🎫</div>
                  <p className="mt-2 text-sm font-semibold text-slate-800">
                    {statusFilter !== "all" ? `"${STATUS_TEXT[statusFilter]}" কোনো টিকিট পাওয়া যায়নি।` : "এখনো কোনো টিকিট নেই।"}
                  </p>
                  <p className="mx-auto mt-1 max-w-[260px] text-xs leading-relaxed text-slate-500">
                    সমস্যা বা প্রশ্ন থাকলে নতুন টিকিট খুলুন — আমাদের সাপোর্ট টিম দ্রুত উত্তর দেবে।
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setStatusFilter("all");
                      setActiveLeftTab("create");
                    }}
                    className="btn-primary mt-4 min-h-[40px] text-xs px-4"
                  >
                    ＋ নতুন টিকিট খুলুন
                  </button>
                </div>
              ) : (
                filteredTickets.map((t) => {
                  const isSel = selected?.id === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => open(t.id)}
                      aria-current={isSel ? "true" : undefined}
                      className={`block w-full text-left rounded-2xl border p-3.5 transition-all ${
                        isSel
                          ? "border-brand-500 bg-gradient-to-r from-brand-50/40 via-white to-white shadow-md border-l-4 border-l-brand-600"
                          : "border-slate-200/80 bg-white hover:border-slate-300 hover:shadow-xs"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-bold text-slate-900">
                          {t.priority === "urgent" ? "🚨 " : t.priority === "high" ? "🔴 " : ""}
                          {t.subject}
                        </span>
                        <StatusBadge status={t.status} />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
                          {CATEGORY_TEXT[t.category ?? "general"] ?? t.category}
                        </span>
                        {getSlaBadge(t)}
                        <span>💬 {bnNum(t.messageCount ?? 0)}টি বার্তা</span>
                        <span className="ml-auto text-[11px] text-slate-400">{relativeBn(t.lastMessageAt)}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </section>
          )}
        </div>

        {/* Right Column: Ticket Conversation Thread */}
        <section className={`card flex-col p-0 overflow-hidden shadow-card-v2 ${threadActive ? "flex" : "hidden lg:flex"}`}>
          {!selected && !opening ? (
            <div className="p-12 text-center my-auto">
              <div className="text-4xl mb-3">💬</div>
              <h3 className="text-base font-bold text-slate-800">কোনো টিকিট নির্বাচন করা হয়নি</h3>
              <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-slate-500">
                বাম পাশের তালিকা থেকে একটি টিকিট বেছে নিন অথবা নতুন টিকিট সাবমিট করুন।
              </p>
            </div>
          ) : opening && !selected ? (
            <div className="space-y-4 p-6" aria-label="লোড হচ্ছে">
              <div className="skeleton h-6 w-2/3" />
              <div className="skeleton h-16 w-3/4" />
              <div className="skeleton ml-auto h-16 w-2/3" />
              <div className="skeleton h-16 w-3/4" />
            </div>
          ) : selected ? (
            <>
              {/* Thread header */}
              <div className="border-b border-slate-100 p-4 sm:p-5 bg-slate-50/60">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <button
                      onClick={() => setSelected(null)}
                      className="btn-secondary btn-sm min-h-[38px] px-2.5 lg:hidden text-xs"
                      aria-label="টিকিটের তালিকায় ফিরুন"
                    >
                      ← তালিকা
                    </button>
                    <h2 className="min-w-0 truncate text-base font-bold text-slate-900">
                      {selected.subject}
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    {selected.status !== "closed" ? (
                      <button onClick={() => setStatus("closed")} className="btn-secondary btn-sm min-h-[36px] text-xs">
                        🔒 বন্ধ করুন
                      </button>
                    ) : null}
                    {selected.status === "closed" || selected.status === "resolved" ? (
                      <button onClick={() => setStatus("open")} className="btn-primary btn-sm min-h-[36px] text-xs font-bold">
                        🔄 আবার খুলুন
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <StatusBadge status={selected.status} />
                  <span className="rounded-lg bg-white border border-slate-200 px-2 py-0.5 text-slate-700 font-medium shadow-2xs">
                    {CATEGORY_TEXT[selected.category ?? "general"] ?? selected.category}
                  </span>
                  <span
                    className={
                      selected.priority === "urgent" || selected.priority === "high" ? "badge-red" : "badge-slate"
                    }
                  >
                    {PRIORITY_TEXT[selected.priority] ?? selected.priority}
                  </span>
                  {getSlaBadge(selected)}
                  <span className="text-slate-400">·</span>
                  <span className="font-mono text-slate-500 font-semibold">#{selected.id.slice(-6).toUpperCase()}</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-500">{fullLabel(selected.createdAt)}</span>
                </div>

                {banner ? (
                  <div className={`alert ${banner.tone} mt-4`}>
                    <span>{banner.text}</span>
                  </div>
                ) : null}

                {/* CSAT Rating Widget if resolved/closed */}
                {(selected.status === "resolved" || selected.status === "closed") && (
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h4 className="font-bold text-sm text-amber-900">
                          {selected.csatRating
                            ? `ধন্যবাদ! আপনার রেটিং সংরক্ষিত: ⭐ ${selected.csatRating}/5`
                            : "আমাদের সাপোর্ট টিমের সহায়তা কেমন ছিল?"}
                        </h4>
                        <p className="text-xs text-slate-600 mt-0.5">
                          {selected.csatRating
                            ? selected.csatFeedback
                              ? `“${selected.csatFeedback}”`
                              : "আপনার মূল্যবান মতামতের জন্য ধন্যবাদ।"
                            : "আপনার রেটিং আমাদের সেবার মান আরও উন্নত করতে সাহায্য করবে।"}
                        </p>
                      </div>

                      {!selected.csatRating && !csatSubmitted ? (
                        <div className="flex items-center gap-1">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <button
                              key={star}
                              type="button"
                              onClick={() => setRatingInput(star)}
                              className={`h-9 w-9 rounded-xl border text-base font-bold transition ${
                                ratingInput >= star
                                  ? "bg-amber-400 text-amber-950 border-amber-500 shadow-sm"
                                  : "bg-white text-slate-400 border-slate-200"
                              }`}
                            >
                              ★
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    {!selected.csatRating && !csatSubmitted ? (
                      <div className="mt-3 flex flex-col sm:flex-row gap-2">
                        <input
                          value={feedbackInput}
                          onChange={(e) => setFeedbackInput(e.target.value)}
                          placeholder="আপনার মতামত বা পরামর্শ লিখুন (ঐচ্ছিক)…"
                          className="input text-xs flex-1"
                        />
                        <button
                          type="button"
                          onClick={handleCsatSubmit}
                          disabled={csatSubmitting}
                          className="btn-primary btn-sm min-h-[38px] text-xs px-4"
                        >
                          {csatSubmitting ? "জমা হচ্ছে..." : "রেটিং জমা দিন"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              {/* Messages timeline */}
              <div className="space-y-4 p-4 sm:p-5">
                {(selected.messages ?? []).map((m, i, arr) => {
                  const support = m.authorKind === "admin";
                  const prev = arr[i - 1];
                  const newDay = !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt);
                  return (
                    <div key={m.id}>
                      {newDay ? (
                        <div className="date-sep mb-3">
                          <span>{dayLabel(m.createdAt)}</span>
                        </div>
                      ) : null}
                      <div className={`flex items-end gap-2.5 ${support ? "" : "flex-row-reverse"}`}>
                        <span
                          className={`msg-avatar ${support ? "msg-avatar-support" : "msg-avatar-own"}`}
                          aria-hidden
                        >
                          {support ? "প" : "আ"}
                        </span>
                        <div className={`msg-bubble ${support ? "msg-bubble-support" : "msg-bubble-own"}`}>
                          <p
                            className={`text-[11px] font-semibold uppercase tracking-wide ${
                              support ? "text-slate-500" : "text-white/75"
                            }`}
                          >
                            {support ? "🛠 প্ল্যাটফর্ম সাপোর্ট টিম" : "আপনি"} · {timeLabel(m.createdAt)}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap leading-relaxed">{m.body}</p>

                          {/* Message Attachments */}
                          {m.attachments && m.attachments.length > 0 ? (
                            <div className="mt-2.5 flex flex-wrap gap-2 pt-2 border-t border-black/10">
                              {m.attachments.map((att, idx) => {
                                const isImg = att.mimeType?.startsWith("image/") || att.url.startsWith("data:image");
                                return (
                                  <div
                                    key={idx}
                                    className={`flex items-center gap-1.5 rounded-lg p-1.5 text-xs ${
                                      support ? "bg-slate-100" : "bg-black/20 text-white"
                                    }`}
                                  >
                                    {isImg ? (
                                      <a href={att.url} target="_blank" rel="noopener noreferrer">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                          src={att.url}
                                          alt={att.name}
                                          className="h-16 w-16 rounded object-cover border border-white/20 hover:opacity-90 transition"
                                        />
                                      </a>
                                    ) : (
                                      <span>📄</span>
                                    )}
                                    <div className="min-w-0 max-w-[140px]">
                                      <a
                                        href={att.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="truncate block underline font-medium"
                                      >
                                        {att.name}
                                      </a>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {adminTyping ? (
                  <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 rounded-xl border border-emerald-100 max-w-max animate-pulse">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                    <span>সাপোর্ট টিম উত্তর লিখছেন...</span>
                  </div>
                ) : null}
                <div ref={threadEndRef} />
              </div>

              {/* Composer */}
              <div className="sticky bottom-[calc(62px+env(safe-area-inset-bottom))] z-10 px-4 pb-4 sm:px-5 lg:bottom-4">
                <div className="rounded-2xl border border-slate-200/90 bg-white/95 p-2.5 shadow-pop backdrop-blur">
                  {/* Reply attachment chips */}
                  {replyAttachments.length > 0 ? (
                    <div className="mb-2 flex flex-wrap gap-2 px-1">
                      {replyAttachments.map((att, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                        >
                          <span>📎 {att.name}</span>
                          <button
                            type="button"
                            onClick={() => setReplyAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                            className="text-rose-600 hover:text-rose-800 font-bold"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="flex items-end gap-2">
                    <textarea
                      value={reply}
                      onChange={(e) => {
                        setReply(e.target.value);
                        handleTenantTyping();
                      }}
                      onPaste={(e) => handlePaste(e, true)}
                      rows={2}
                      placeholder="উত্তর লিখুন (স্ক্রিনশট পেস্ট Ctrl+V করা যাবে)…"
                      className="input !border-0 !shadow-none flex-1 resize-none focus:!ring-0 text-sm"
                      aria-label="উত্তর লিখুন"
                    />

                    <div>
                      <input
                        ref={replyFileInputRef}
                        type="file"
                        accept="image/*,.pdf,.txt,.log"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleAttachmentUpload(f, true);
                        }}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => replyFileInputRef.current?.click()}
                        className="btn-secondary btn-sm min-h-[44px] shrink-0 text-sm"
                        title="ফাইল বা স্ক্রিনশট যোগ করুন"
                      >
                        📎
                      </button>
                    </div>

                    <button
                      onClick={sendReply}
                      disabled={!reply.trim() && replyAttachments.length === 0}
                      className="btn-primary min-h-[44px] shrink-0"
                    >
                      পাঠান
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}

/** Milestone 41: quick NPS feedback — goes straight to the platform team. */
function FeedbackCard({ orgId }: { orgId: string | null }) {
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  if (!orgId) return null;
  if (done) {
    return (
      <div className="alert alert-green">
        <span>🙏 ধন্যবাদ! আপনার মতামত প্ল্যাটফর্ম টিমের কাছে পৌঁছেছে।</span>
      </div>
    );
  }
  return (
    <div className="card p-5">
      <div className="section-title flex items-center gap-2">
        <span className="stat-icon stat-icon-brand !h-9 !w-9 !rounded-xl text-base">💬</span>এক মিনিটে মতামত দিন
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
        বন্ধু বা পরিচিত কারো কাছে এই প্ল্যাটফর্মটি সুপারিশ করার সম্ভাবনা কতটা? (০ = একদমই না, ১০ = অবশ্যই)
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {Array.from({ length: 11 }, (_, i) => (
          <button
            key={i}
            onClick={() => setScore(i)}
            aria-pressed={score === i}
            className={`h-11 w-11 rounded-xl border text-sm font-semibold transition active:scale-95 ${
              score === i
                ? "border-transparent text-white"
                : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300"
            }`}
            style={
              score === i ? { backgroundImage: "linear-gradient(135deg, var(--brand-from), var(--brand-to))" } : undefined
            }
          >
            {bnNum(i)}
          </button>
        ))}
      </div>
      <textarea
        className="input mt-3 resize-none"
        rows={2}
        placeholder="কী ভালো লাগলো / কী উন্নত করা দরকার? (ঐচ্ছিক)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      {err ? <p className="mt-2 text-xs font-medium text-red-600">{err}</p> : null}
      <button
        className="btn-primary mt-3 min-h-[44px]"
        disabled={score === null}
        onClick={async () => {
          try {
            await apiFetch(`/organizations/${orgId}/feedback`, {
              method: "POST",
              body: JSON.stringify({ score, comment: comment.trim() || undefined }),
            });
            setDone(true);
          } catch (e) {
            setErr(e instanceof Error ? e.message : "পাঠানো যায়নি");
          }
        }}
      >
        মতামত পাঠান
      </button>
    </div>
  );
}
