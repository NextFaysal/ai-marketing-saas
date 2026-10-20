"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { EmptyState, ErrorState, PageHead, SavedViewsBar, useLastFilters } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";
import { fmtNumber } from "@repo/contracts";
import { useAdminLocale } from "@/components/AdminLocale";
import { subscribeAdminTicketStream } from "@/lib/support-stream";

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

interface Customer360 {
  organizationName?: string | null;
  organizationSlug?: string | null;
  creatorEmail?: string | null;
  creatorName?: string | null;
  membersCount: number;
  activeIntegrationsCount: number;
  diagnostics?: Record<string, any> | null;
}

interface Ticket {
  id: string;
  organizationId: string;
  organizationName?: string | null;
  subject: string;
  category?: string;
  status: string;
  priority: string;
  assignedToId?: string | null;
  lastMessageAt: string;
  messageCount?: number;
  messages?: TicketMessage[];
  creatorEmail?: string | null;
  slaDueAt?: string | null;
  csatRating?: number | null;
  csatFeedback?: string | null;
  customer360?: Customer360;
  firstRespondedAt?: string | null;
  slaBreached?: boolean;
  slaHours?: number;
}


interface Admin {
  id: string;
  email: string;
}

interface CannedResponse {
  id: string;
  shortcut: string;
  title: string;
  body: string;
  category?: string;
}

interface SupportMetrics {
  total: number;
  statusCounts: Record<string, number>;
  priorityCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
  avgFirstResponseMinutes: number | null;
  avgResolutionHours: number | null;
  csat: {
    average: number | null;
    count: number;
    breakdown: Record<number, number>;
    recentFeedback: Array<{ id: string; subject: string; rating: number; feedback: string; resolvedAt?: string }>;
  };
  sla: {
    checked: number;
    breached: number;
    complianceRate: number;
  };
}

const FILTERS = ["", "open", "pending", "in_progress", "resolved", "closed"] as const;
const CATEGORY_FILTERS = ["", "general", "billing", "technical", "campaigns", "integration", "account", "feature", "other"] as const;

export default function TicketsPage() {
  const { dict, locale, t: tr } = useAdminLocale();
  const T = dict.tickets;
  const STATUS_LABEL: Record<string, string> = {
    open: T.statusOpen, pending: T.statusPending, in_progress: T.statusInProgress, resolved: T.statusResolved, closed: T.statusClosed,
  };
  const CATEGORY_LABEL: Record<string, string> = {
    general: T.catGeneral, billing: T.catBilling, technical: T.catTechnical, campaigns: T.catCampaigns,
    integration: T.catIntegration, account: T.catAccount, feature: T.catFeature, other: T.catOther,
  };
  const [activeTab, setActiveTab] = useState<"queue" | "analytics">("queue");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [filter, setFilter] = useState<string>("");
  // ADNX15: last-used filter persistence for the status filter
  // (restored on mount, stored on change — the saved-views apply
  // below is the same one-filter shape).
  useLastFilters("tickets", { filter }, (s) => setFilter(s.filter ?? ""));
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [slaOnly, setSlaOnly] = useState(false);
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [cannedList, setCannedList] = useState<CannedResponse[]>([]);

  // Composer states
  const [reply, setReply] = useState("");
  const [composerMode, setComposerMode] = useState<"public" | "internal">("public");
  const [attachments, setAttachments] = useState<TicketAttachment[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // AI & Analytics states
  const [aiLoading, setAiLoading] = useState(false);
  const [threadSummary, setThreadSummary] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<SupportMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Canned Response creation modal
  const [showCannedModal, setShowCannedModal] = useState(false);
  const [newShortcut, setNewShortcut] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newCategory, setNewCategory] = useState("general");
  const [cannedBusy, setCannedBusy] = useState(false);

  const handleCreateCanned = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newShortcut.trim() || !newTitle.trim() || !newBody.trim()) return;
    setCannedBusy(true);
    setError("");
    try {
      const formattedShortcut = newShortcut.startsWith("/") ? newShortcut.trim() : `/${newShortcut.trim()}`;
      await apiFetch("/admin/tickets/canned", {
        method: "POST",
        body: JSON.stringify({
          shortcut: formattedShortcut,
          title: newTitle.trim(),
          body: newBody.trim(),
          category: newCategory,
        }),
      });
      const updated = await apiFetch<CannedResponse[]>("/admin/tickets/canned/all");
      setCannedList(updated ?? []);
      setNote(tr("tickets.cannedSaved", { shortcut: formattedShortcut }));
      setShowCannedModal(false);
      setNewShortcut("");
      setNewTitle("");
      setNewBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : T.cannedSaveFailed);
    } finally {
      setCannedBusy(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (filter) q.set("status", filter);
      if (categoryFilter) q.set("category", categoryFilter);
      if (slaOnly) q.set("sla", "breached");
      const url = `/admin/tickets${q.toString() ? `?${q.toString()}` : ""}`;
      setTickets(await apiFetch<Ticket[]>(url));
      setLoadError("");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : T.listLoadFailed);
    } finally {
      setLoading(false);
    }
  }, [filter, categoryFilter, slaOnly]);

  const loadMetrics = useCallback(async () => {
    setMetricsLoading(true);
    try {
      setMetrics(await apiFetch<SupportMetrics>("/admin/tickets/analytics/metrics"));
    } catch {
      // Ignored
    } finally {
      setMetricsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    apiFetch<{ admins: Admin[] }>("/admin/security")
      .then((s) => setAdmins(s.admins ?? []))
      .catch(() => undefined);
    apiFetch<CannedResponse[]>("/admin/tickets/canned/all")
      .then((c) => setCannedList(c ?? []))
      .catch(() => undefined);
  }, []);

  const open = async (id: string) => {
    try {
      setThreadSummary(null);
      setSelected(await apiFetch<Ticket>(`/admin/tickets/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : T.openFailed);
    }
  };

  // Realtime Live Stream (SSE) + Typing indicator for Admin Superdesk
  const [tenantTyping, setTenantTyping] = useState(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastTypingSentRef = useRef<number>(0);

  const handleAdminTyping = () => {
    if (!selected) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current > 3000) {
      lastTypingSentRef.current = now;
      apiFetch(`/admin/tickets/${selected.id}/typing`, {
        method: "POST",
        body: JSON.stringify({ isTyping: true }),
      }).catch(() => undefined);
    }
  };

  useEffect(() => {
    if (!selected) return;

    const unsubscribe = subscribeAdminTicketStream(selected.id, (event) => {
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
        setTenantTyping(false);
      } else if (event.type === "ticket.updated" && event.data) {
        setSelected((prev) => (prev ? { ...prev, ...event.data } : prev));
        load();
      } else if (event.type === "typing" && event.who === "tenant") {
        setTenantTyping(Boolean(event.isTyping));
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        if (event.isTyping) {
          typingTimeoutRef.current = setTimeout(() => setTenantTyping(false), 4000);
        }
      }
    });

    return () => {
      unsubscribe();
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [selected?.id, load]);

  // Inbox ordering: urgent > high > normal, then latest activity
  const shown = [...tickets].sort((a, b) => {
    const priorityWeight: Record<string, number> = { urgent: 0, high: 1, normal: 2 };
    const pa = priorityWeight[a.priority] ?? 2;
    const pb = priorityWeight[b.priority] ?? 2;
    if (pa !== pb) return pa - pb;
    return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError(T.fileTooBig);
      return;
    }
    setUploadingFile(true);
    setError("");
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      setAttachments((prev) => [
        ...prev,
        {
          name: file.name,
          url: base64,
          size: file.size,
          mimeType: file.type,
        },
      ]);
      setUploadingFile(false);
    };
    reader.onerror = () => {
      setError(T.fileReadFailed);
      setUploadingFile(false);
    };
    reader.readAsDataURL(file);
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const sendReplyOrNote = async () => {
    if (!selected || (!reply.trim() && attachments.length === 0)) return;
    setError("");
    setNote("");

    try {
      if (composerMode === "internal") {
        await apiFetch(`/admin/tickets/${selected.id}/notes`, {
          method: "POST",
          body: JSON.stringify({ body: reply, attachments }),
        });
        setNote(T.whisperSaved);
      } else {
        const res = await apiFetch<{ emailSent: number; emailError: string | null }>(
          `/admin/tickets/${selected.id}/messages`,
          {
            method: "POST",
            body: JSON.stringify({ body: reply, attachments }),
          },
        );
        setNote(
          res.emailError
            ? tr("tickets.replyEmailFailed", { error: res.emailError })
            : tr("tickets.replySent", { count: fmtNumber(locale, res.emailSent) }),
        );
      }
      setReply("");
      setAttachments([]);
      await open(selected.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : T.sendFailed);
    }
  };

  const update = async (patch: Record<string, unknown>) => {
    if (!selected) return;
    try {
      await apiFetch(`/admin/tickets/${selected.id}/status`, {
        method: "POST",
        body: JSON.stringify(patch),
      });
      await open(selected.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : T.updateFailed);
    }
  };

  const handleAiDraft = async () => {
    if (!selected) return;
    setAiLoading(true);
    setError("");
    try {
      const res = await apiFetch<{ draft: string; source: string }>(`/admin/tickets/${selected.id}/ai-draft`, {
        method: "POST",
        body: JSON.stringify({ tone: "professional" }),
      });
      if (res?.draft) {
        setReply((prev) => (prev ? `${prev}\n\n${res.draft}` : res.draft));
        setComposerMode("public");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : T.aiDraftFailed);
    } finally {
      setAiLoading(false);
    }
  };

  const handleAiSummary = async () => {
    if (!selected) return;
    try {
      const res = await apiFetch<{ summary: string }>(`/admin/tickets/${selected.id}/summary`);
      if (res?.summary) setThreadSummary(res.summary);
    } catch {
      // Ignored
    }
  };

  const insertCanned = (item: CannedResponse) => {
    setReply((prev) => (prev ? `${prev}\n\n${item.body}` : item.body));
  };

  const getSlaBadge = (slaIso?: string | null) => {
    if (!slaIso) return null;
    const diff = new Date(slaIso).getTime() - Date.now();
    if (diff < 0) {
      return <span className="rounded bg-rose-500/20 px-2 py-0.5 text-xs font-semibold text-rose-400">{T.slaBreached}</span>;
    }
    const hours = Math.round(diff / (1000 * 60 * 60));
    return (
      <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-300">
        {tr("tickets.slaLeft", { hours: fmtNumber(locale, hours) })}
      </span>
    );
  };

  return (
    <AdminShell title={T.title}>
      <PageHead sub={T.sub} />
      {error ? <p className="anote" style={{ borderColor: "#fecaca", color: "#991b1b" }}>{error}</p> : null}
      {note ? <p className="anote">{note}</p> : null}

      {/* Top Tab Bar: Queue vs Analytics */}
      <div className="mb-4 flex items-center gap-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab("queue")}
          className={`px-3 py-1.5 text-xs font-bold rounded-xl transition ${
            activeTab === "queue"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-slate-400 hover:text-white hover:bg-slate-800/60"
          }`}
        >
          {tr("tickets.queueTab", { count: fmtNumber(locale, tickets.length) })}
        </button>
        <button
          onClick={() => {
            setActiveTab("analytics");
            loadMetrics();
          }}
          className={`px-3 py-1.5 text-xs font-bold rounded-xl transition ${
            activeTab === "analytics"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-slate-400 hover:text-white hover:bg-slate-800/60"
          }`}
        >
          {T.analyticsTab}
        </button>
      </div>
      {activeTab === "analytics" ? (
        /* Support Analytics Dashboard */
        <div className="space-y-4 animate-fade-in">
          {metricsLoading && !metrics ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="askel h-24" />
              <div className="askel h-24" />
              <div className="askel h-24" />
              <div className="askel h-24" />
            </div>
          ) : metrics ? (
            <>
              {/* Scorecards */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="acard">
                  <span className="text-slate-400 block text-xs">{T.frtLabel}</span>
                  <b className="text-xl text-indigo-400 block mt-1">
                    {metrics.avgFirstResponseMinutes !== null ? tr("tickets.minutes", { count: fmtNumber(locale, metrics.avgFirstResponseMinutes) }) : "—"}
                  </b>
                  <span className="text-[11px] text-slate-500">{T.frtSub}</span>
                </div>

                <div className="acard">
                  <span className="text-slate-400 block text-xs">{T.resolutionLabel}</span>
                  <b className="text-xl text-emerald-400 block mt-1">
                    {metrics.avgResolutionHours !== null ? tr("tickets.hours", { count: fmtNumber(locale, metrics.avgResolutionHours) }) : "—"}
                  </b>
                  <span className="text-[11px] text-slate-500">{T.resolutionSub}</span>
                </div>

                <div className="acard">
                  <span className="text-slate-400 block text-xs">{T.csatLabel}</span>
                  <b className="text-xl text-amber-400 block mt-1">
                    {metrics.csat.average !== null ? `${fmtNumber(locale, metrics.csat.average)} / ${fmtNumber(locale, 5)}` : "—"}
                  </b>
                  <span className="text-[11px] text-slate-500">{tr("tickets.csatSub", { count: fmtNumber(locale, metrics.csat.count) })}</span>
                </div>

                <div className="acard">
                  <span className="text-slate-400 block text-xs">{T.slaRateLabel}</span>
                  <b
                    className={`text-xl block mt-1 ${
                      metrics.sla.complianceRate >= 90 ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {fmtNumber(locale, metrics.sla.complianceRate)}%
                  </b>
                  <span className="text-[11px] text-slate-500">
                    {metrics.sla.breached > 0 ? tr("tickets.slaBreachedSub", { count: fmtNumber(locale, metrics.sla.breached) }) : T.slaNoBreach}
                  </span>
                </div>
              </div>
              {/* Status & Category Distributions */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="acard">
                  <h4 className="text-sm font-bold text-slate-200 mb-3">{T.categoryDist}</h4>
                  <div className="space-y-2.5">
                    {Object.entries(metrics.categoryCounts).map(([cat, count]) => {
                      const pct = metrics.total > 0 ? Math.round((count / metrics.total) * 100) : 0;
                      return (
                        <div key={cat} className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="text-slate-300">{CATEGORY_LABEL[cat] ?? cat}</span>
                            <span className="text-slate-400">
                              {tr("tickets.countPct", { count: fmtNumber(locale, count), pct: fmtNumber(locale, pct) })}
                            </span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-indigo-500 transition-all duration-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="acard">
                  <h4 className="text-sm font-bold text-slate-200 mb-3">{T.statusBreakdown}</h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-2.5">
                      <span className="text-emerald-400 font-semibold block">{T.openTickets}</span>
                      <b className="text-lg text-emerald-300">{fmtNumber(locale, metrics.statusCounts.open ?? 0)}</b>
                    </div>
                    <div className="rounded-xl border border-amber-500/20 bg-amber-950/20 p-2.5">
                      <span className="text-amber-400 font-semibold block">{T.pendingTickets}</span>
                      <b className="text-lg text-amber-300">{fmtNumber(locale, metrics.statusCounts.pending ?? 0)}</b>
                    </div>
                    <div className="rounded-xl border border-blue-500/20 bg-blue-950/20 p-2.5">
                      <span className="text-blue-400 font-semibold block">{T.inProgressTickets}</span>
                      <b className="text-lg text-blue-300">{fmtNumber(locale, metrics.statusCounts.in_progress ?? 0)}</b>
                    </div>
                    <div className="rounded-xl border border-slate-700 bg-slate-800/30 p-2.5">
                      <span className="text-slate-400 font-semibold block">{T.resolvedClosed}</span>
                      <b className="text-lg text-slate-200">
                        {fmtNumber(locale, (metrics.statusCounts.resolved ?? 0) + (metrics.statusCounts.closed ?? 0))}
                      </b>
                    </div>
                  </div>
                </div>
              </div>

              {/* Recent Customer CSAT Feedback */}
              <div className="acard">
                <h4 className="text-sm font-bold text-slate-200 mb-3">{T.recentFeedback}</h4>
                {metrics.csat.recentFeedback.length === 0 ? (
                  <p className="text-xs text-slate-500">{T.noFeedback}</p>
                ) : (
                  <div className="space-y-2">
                    {metrics.csat.recentFeedback.map((f, i) => (
                      <div key={i} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-amber-400 font-bold">
                            {"★".repeat(f.rating)}
                            <span className="text-slate-600">{"★".repeat(5 - f.rating)}</span>
                            <span className="ml-1 text-slate-300">({fmtNumber(locale, f.rating)}/{fmtNumber(locale, 5)})</span>
                          </span>
                          <span className="text-slate-500 text-[11px]">{f.resolvedAt ? fmtDateTime(locale, f.resolvedAt) : ""}</span>
                        </div>
                        <p className="text-slate-200 italic mb-1">“{f.feedback}”</p>
                        <p className="text-slate-500 text-[11px]">{tr("tickets.ticketLabel", { subject: f.subject })}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-400">{T.metricsFailed}</p>
          )}
        </div>
      ) : (
        /* Regular Queue View */
        <>
          {/* Quick KPI Ribbons */}
          <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <button
              onClick={() => setFilter(filter === "open" ? "" : "open")}
              className={`rounded-2xl border p-3.5 text-left transition-all ${
                filter === "open"
                  ? "border-emerald-500/60 bg-emerald-950/40 ring-2 ring-emerald-500/30"
                  : "border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900/90"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-400">{T.kpiOpen}</span>
                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-300">
                  {fmtNumber(locale, tickets.filter((tk) => tk.status === "open").length)}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">{T.kpiOpenSub}</p>
            </button>

            <button
              onClick={() => setFilter(filter === "pending" ? "" : "pending")}
              className={`rounded-2xl border p-3.5 text-left transition-all ${
                filter === "pending"
                  ? "border-amber-500/60 bg-amber-950/40 ring-2 ring-amber-500/30"
                  : "border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900/90"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-400">{T.kpiPending}</span>
                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-300">
                  {fmtNumber(locale, tickets.filter((tk) => tk.status === "pending").length)}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">{T.kpiPendingSub}</p>
            </button>

            <button
              onClick={() => {
                // Toggle priority focus
                if (filter === "in_progress") {
                  setFilter("");
                } else {
                  setFilter("in_progress");
                }
              }}
              className={`rounded-2xl border p-3.5 text-left transition-all ${
                filter === "in_progress"
                  ? "border-blue-500/60 bg-blue-950/40 ring-2 ring-blue-500/30"
                  : "border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900/90"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-blue-400">{T.kpiInProgress}</span>
                <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-bold text-blue-300">
                  {fmtNumber(locale, tickets.filter((tk) => tk.status === "in_progress").length)}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">{T.kpiInProgressSub}</p>
            </button>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-rose-400">{T.kpiUrgent}</span>
                <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-xs font-bold text-rose-300">
                  {fmtNumber(locale,
                    tickets.filter(
                      (tk) =>
                        tk.priority === "urgent" ||
                        (tk.slaDueAt &&
                          new Date(tk.slaDueAt).getTime() < Date.now() &&
                          tk.status !== "resolved" &&
                          tk.status !== "closed"),
                    ).length,
                  )}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">{T.kpiUrgentSub}</p>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            {/* ADNX10: status filter chips become a horizontal rail on
                mobile (no wrap stack), wrapping again from sm up. */}
            <div className="flex flex-nowrap gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
              {FILTERS.map((f) => (
                <button
                  key={f || "all"}
                  onClick={() => setFilter(f)}
                  className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-medium transition-all ${
                    filter === f
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                      : "border border-slate-800 bg-slate-900/70 text-slate-300 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  {f ? STATUS_LABEL[f] : T.allTickets}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="ainput text-xs"
                style={{ width: "auto" }}
              >
                <option value="">{T.allCategories}</option>
                {Object.entries(CATEGORY_LABEL).map(([cat, label]) => (
                  <option key={cat} value={cat}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mb-3 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40">
            <SavedViewsBar
              page="tickets"
              current={{ filter, categoryFilter }}
              onApply={(s) => {
                setFilter(s.filter ?? "");
                setCategoryFilter(s.categoryFilter ?? "");
              }}
            />
          </div>

          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(320px,400px)_1fr]">
            {/* Ticket List column */}
            <div className={`space-y-2.5 ${selected ? "hidden lg:block" : ""}`}>
              {loading && tickets.length === 0 ? (
                <>
                  <div className="askel h-24" />
                  <div className="askel h-24" />
                  <div className="askel h-24" />
                </>
              ) : null}
              {!loading && loadError && tickets.length === 0 ? (
                <div className="acard">
                  <ErrorState message={tr("tickets.listLoadError", { message: loadError })} onRetry={load} />
                </div>
              ) : null}
              {!loading && !loadError && shown.length === 0 ? (
                <div className="acard">
                  <EmptyState
                    title={T.emptyTitle}
                    sub={T.emptySub}
                  />
                </div>
              ) : null}

              {shown.map((t) => {
                const isSelected = selected?.id === t.id;
                const isUrgent = t.priority === "urgent";
                const isHigh = t.priority === "high";
                const orgInitial = (t.organizationName || t.organizationId || "Q").slice(0, 2).toUpperCase();

                return (
                  <button
                    key={t.id}
                    onClick={() => open(t.id)}
                    className={`group relative block w-full rounded-2xl border p-3.5 text-left transition-all ${
                      isSelected
                        ? "border-indigo-500/80 bg-indigo-950/25 ring-2 ring-indigo-500/40 shadow-lg shadow-indigo-950/40"
                        : "border-slate-800/80 bg-slate-900/70 hover:border-slate-700 hover:bg-slate-900/90"
                    } ${
                      isUrgent
                        ? "border-l-4 border-l-rose-500"
                        : isHigh
                        ? "border-l-4 border-l-amber-500"
                        : "border-l-4 border-l-transparent"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-bold transition ${
                            isSelected
                              ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/40"
                              : "bg-slate-800 text-slate-300 group-hover:bg-slate-700"
                          }`}
                        >
                          {orgInitial}
                        </div>
                        <div className="min-w-0">
                          <h4 className="truncate text-sm font-semibold text-slate-100 group-hover:text-indigo-300 transition">
                            {isUrgent ? "🚨 " : isHigh ? "🔴 " : ""}
                            {t.subject}
                          </h4>
                          <p className="truncate text-xs text-slate-400 mt-0.5">
                            {t.organizationName ?? t.organizationId}
                          </p>
                        </div>
                      </div>
                      <span className="shrink-0 text-[11px] font-semibold text-slate-300">
                        {STATUS_LABEL[t.status] ?? t.status}
                      </span>
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1.5 border-t border-slate-800/60 pt-2 text-xs">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-lg bg-slate-800/80 px-2 py-0.5 text-[11px] text-slate-300">
                          {CATEGORY_LABEL[t.category ?? "general"] ?? t.category}
                        </span>
                        {t.csatRating ? (
                          <span className="rounded-lg bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300">
                            ⭐ {fmtNumber(locale, t.csatRating)}/{fmtNumber(locale, 5)}
                          </span>
                        ) : null}
                        <span className="rounded-lg bg-slate-800/60 px-1.5 py-0.5 text-[11px] text-slate-400">
                          💬 {fmtNumber(locale, t.messageCount ?? 0)}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-500">{fmtDateTime(locale, t.lastMessageAt)}</span>
                    </div>

                    {t.slaDueAt && t.status !== "resolved" && t.status !== "closed" ? (
                      <div className="mt-2">{getSlaBadge(t.slaDueAt)}</div>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {/* Ticket Details & Action Panel.
                ADNX10: mobile is a true two-step flow — step 2 is the
                conversation as a full-screen sheet with the back action
                at the top; lg keeps list + detail side by side. */}
            <div className={`acard ${selected ? "max-lg:fixed max-lg:inset-0 max-lg:z-[45] max-lg:overflow-y-auto max-lg:rounded-none" : "hidden lg:block"}`}>
              {!selected ? (
                <div className="p-8 text-center text-slate-400">
                  <p className="text-3xl">🎫</p>
                  <p className="mt-2 text-sm font-medium">{T.pickTicketTitle}</p>
                </div>
              ) : (
                <>
                  <button
                    className="abtn sticky top-0 z-10 mb-3 w-full sm:w-auto lg:hidden"
                    onClick={() => setSelected(null)}
                  >
                    {T.backToList}
                  </button>

                  {/* Header */}
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-bold text-slate-100" style={{ margin: 0 }}>
                          {selected.subject}
                        </h3>
                        <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-slate-200">
                          {STATUS_LABEL[selected.status] ?? selected.status}
                        </span>
                        <span className="rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-xs font-semibold text-indigo-300">
                          {CATEGORY_LABEL[selected.category ?? "general"] ?? selected.category}
                        </span>
                        {getSlaBadge(selected.slaDueAt)}
                      </div>
                      <p className="mt-1 text-xs text-slate-400">
                        {tr("tickets.ticketMeta", { id: selected.id.slice(-6), org: selected.organizationName ?? "—", email: selected.creatorEmail ?? "—" })}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {selected.status !== "resolved" && selected.status !== "closed" ? (
                        <button
                          onClick={() => update({ status: "resolved" })}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600/20 border border-emerald-500/40 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-600/30 transition shadow-sm"
                          title={T.markResolvedTitle}
                        >
                          {T.markResolved}
                        </button>
                      ) : null}

                      <button
                        onClick={handleAiSummary}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-500/40 bg-indigo-950/40 px-3 py-1.5 text-xs font-semibold text-indigo-300 hover:bg-indigo-900/50 transition shadow-sm"
                        title={T.aiSummaryTitle}
                      >
                        {T.aiSummary}
                      </button>
                    </div>
                  </div>

                  {/* Thread AI Summary banner if requested */}
                  {threadSummary ? (
                    <div className="my-3 rounded-2xl border border-indigo-500/40 bg-gradient-to-r from-indigo-950/40 via-purple-950/20 to-slate-900/40 p-3.5 text-xs text-indigo-200 shadow-md">
                      <b className="block text-indigo-400 font-semibold mb-1 flex items-center gap-1.5">
                        <span>🤖</span> {T.aiSummaryHeading}
                      </b>
                      <p className="leading-relaxed">{threadSummary}</p>
                    </div>
                  ) : null}

                  {/* Customer 360° Sidebar Card */}
                  {selected.customer360 ? (
                    <div className="my-3 grid grid-cols-2 gap-2.5 rounded-2xl border border-slate-800/80 bg-gradient-to-r from-slate-900/90 via-slate-900/50 to-indigo-950/20 p-3.5 text-xs sm:grid-cols-4">
                      <div className="space-y-0.5">
                        <span className="text-slate-400 block text-[11px]">{T.membersCount}</span>
                        <b className="text-slate-200 text-sm">{tr("tickets.membersValue", { count: fmtNumber(locale, selected.customer360.membersCount) })}</b>
                      </div>
                      <div className="space-y-0.5">
                        <span className="text-slate-400 block text-[11px]">{T.activeChannels}</span>
                        <b className="text-indigo-300 text-sm">{tr("tickets.channelsValue", { count: fmtNumber(locale, selected.customer360.activeIntegrationsCount) })}</b>
                      </div>
                      <div className="space-y-0.5">
                        <span className="text-slate-400 block text-[11px]">{T.customerSatisfaction}</span>
                        <b className="text-amber-400 text-sm">
                          {selected.csatRating ? tr("tickets.csatValue", { rating: fmtNumber(locale, selected.csatRating) }) : T.noRatingYet}
                        </b>
                      </div>
                      <div className="space-y-0.5">
                        <span className="text-slate-400 block text-[11px]">{T.diagnostics}</span>
                        <span className="text-slate-300 truncate block text-[11px]">
                          {selected.customer360.diagnostics?.userAgent ? T.diagnosticsPresent : T.diagnosticsNone}
                        </span>
                      </div>
                    </div>
                  ) : null}

                  {/* Ticket Controls Toolbar */}
                  <div className="my-3 flex flex-wrap items-center gap-2 border-b border-slate-800/80 pb-3">
                    <div className="flex items-center gap-1 text-xs text-slate-400">
                      <span>{T.statusLabelText}</span>
                      <select
                        value={selected.status}
                        onChange={(e) => update({ status: e.target.value })}
                        className="ainput text-xs py-1"
                        style={{ width: "auto" }}
                      >
                        {Object.keys(STATUS_LABEL).map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-1 text-xs text-slate-400">
                      <span>{T.priorityLabel}</span>
                      <select
                        value={selected.priority}
                        onChange={(e) => update({ priority: e.target.value })}
                        className="ainput text-xs py-1"
                        style={{ width: "auto" }}
                      >
                        <option value="normal">{T.priorityNormal}</option>
                        <option value="high">{T.priorityHigh}</option>
                        <option value="urgent">{T.priorityUrgent}</option>
                      </select>
                    </div>

                    <div className="flex items-center gap-1 text-xs text-slate-400">
                      <span>{T.categoryLabel}</span>
                      <select
                        value={selected.category ?? "general"}
                        onChange={(e) => update({ category: e.target.value })}
                        className="ainput text-xs py-1"
                        style={{ width: "auto" }}
                      >
                        {Object.entries(CATEGORY_LABEL).map(([cat, label]) => (
                          <option key={cat} value={cat}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-1 text-xs text-slate-400 ml-auto">
                      <span>{T.assigneeLabel}</span>
                      <select
                        value={selected.assignedToId ?? ""}
                        onChange={(e) => update({ assignedToId: e.target.value || null })}
                        className="ainput text-xs py-1"
                        style={{ width: "auto" }}
                      >
                        <option value="">{T.assignNone}</option>
                        {admins.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.email}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Messages timeline */}
                  <div className="space-y-3.5 max-h-[460px] overflow-y-auto pr-1">
                    {(selected.messages ?? []).map((m) => {
                      const isInternal = !!m.isInternal;
                      const isAdmin = m.authorKind === "admin";
                      return (
                        <div
                          key={m.id}
                          className={`rounded-2xl p-4 text-sm transition-all shadow-sm ${
                            isInternal
                              ? "border border-amber-500/40 bg-gradient-to-r from-amber-950/30 via-amber-900/10 to-slate-900/80 text-amber-200"
                              : isAdmin
                              ? "bg-gradient-to-r from-indigo-950/40 via-indigo-900/20 to-slate-900/70 border border-indigo-500/30 text-slate-100 mr-6"
                              : "bg-slate-900/90 border border-slate-800 text-slate-100 ml-6"
                          }`}
                        >
                          <div className="flex items-center justify-between text-xs font-semibold mb-1.5">
                            <span
                              className={`flex items-center gap-1.5 ${
                                isInternal ? "text-amber-400" : isAdmin ? "text-indigo-400" : "text-emerald-400"
                              }`}
                            >
                              {isInternal ? (
                                <>
                                  <span>🔒</span>
                                  <span>{T.internalWhisper}</span>
                                </>
                              ) : isAdmin ? (
                                <>
                                  <span>🛡️</span>
                                  <span>{T.supportTeam}</span>
                                </>
                              ) : (
                                <>
                                  <span>👤</span>
                                  <span>{tr("tickets.customerLabel", { org: selected.organizationName || T.tenantFallback })}</span>
                                </>
                              )}
                            </span>
                            <span className="text-slate-500 font-normal">{fmtDateTime(locale, m.createdAt)}</span>
                          </div>
                          <p className="whitespace-pre-wrap leading-relaxed text-slate-200">{m.body}</p>

                          {/* Attachments rendering */}
                          {m.attachments && m.attachments.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-2.5 pt-2.5 border-t border-white/10">
                              {m.attachments.map((att, i) => {
                                const isImg = att.mimeType?.startsWith("image/") || att.url.startsWith("data:image");
                                return (
                                  <div key={i} className="flex items-center gap-2 rounded-xl bg-black/40 p-2 text-xs border border-white/5">
                                    {isImg ? (
                                      <a href={att.url} target="_blank" rel="noopener noreferrer">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                          src={att.url}
                                          alt={att.name}
                                          className="h-16 w-16 rounded-lg object-cover hover:opacity-80 transition border border-slate-700"
                                        />
                                      </a>
                                    ) : (
                                      <span className="text-xl">📄</span>
                                    )}
                                    <div className="min-w-0 max-w-[140px]">
                                      <a
                                        href={att.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="truncate block font-medium text-indigo-300 hover:underline"
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
                      );
                    })}
                  </div>

                  {tenantTyping ? (
                    <div className="mt-2.5 flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-amber-400 bg-amber-500/10 rounded-xl border border-amber-500/20 max-w-max animate-pulse">
                      <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
                      <span>{T.typing}</span>
                    </div>
                  ) : null}

                  {/* Dual-Mode Composer */}
                  <div
                    className={`mt-4 rounded-2xl border p-3.5 transition-all ${
                      composerMode === "internal"
                        ? "border-amber-500/60 bg-gradient-to-b from-amber-950/20 via-slate-900 to-slate-950 ring-1 ring-amber-500/30"
                        : "border-indigo-500/30 bg-slate-900/90"
                    }`}
                  >
                    <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setComposerMode("public")}
                          className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                            composerMode === "public"
                              ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/40"
                              : "text-slate-400 hover:text-white hover:bg-slate-800/60"
                          }`}
                        >
                          {T.publicReplyMode}
                        </button>
                        <button
                          type="button"
                          onClick={() => setComposerMode("internal")}
                          className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                            composerMode === "internal"
                              ? "bg-amber-600 text-white shadow-md shadow-amber-600/40"
                              : "text-slate-400 hover:text-white hover:bg-slate-800/60"
                          }`}
                        >
                          {T.internalMode}
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        {cannedList.length > 0 ? (
                          <select
                            onChange={(e) => {
                              const item = cannedList.find((c) => c.shortcut === e.target.value);
                              if (item) insertCanned(item);
                              e.target.value = "";
                            }}
                            className="ainput text-xs py-1"
                            style={{ width: "auto" }}
                            defaultValue=""
                          >
                            <option value="" disabled>
                              {T.cannedSelect}
                            </option>
                            {cannedList.map((c) => (
                              <option key={c.id} value={c.shortcut}>
                                {c.shortcut} - {c.title}
                              </option>
                            ))}
                          </select>
                        ) : null}

                        <button
                          type="button"
                          onClick={() => setShowCannedModal(true)}
                          title={T.cannedAddTitle}
                          className="abtn text-xs py-1 px-2.5 border-slate-700 text-slate-300 hover:text-white"
                        >
                          {T.cannedAdd}
                        </button>

                        <button
                          type="button"
                          onClick={handleAiDraft}
                          disabled={aiLoading}
                          className="abtn text-xs py-1 px-2.5 flex items-center gap-1 border-indigo-500/40 text-indigo-300 hover:text-white"
                        >
                          {aiLoading ? T.aiDrafting : T.aiDraft}
                        </button>
                      </div>
                    </div>

                    {composerMode === "internal" ? (
                      <div className="mb-2 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 text-[11px] text-amber-300 flex items-center gap-1.5">
                        <span>⚠️</span>
                        <span>{T.whisperWarning}</span>
                      </div>
                    ) : null}

                    <textarea
                      value={reply}
                      onChange={(e) => {
                        setReply(e.target.value);
                        handleAdminTyping();
                      }}
                      onKeyDown={(e) => {
                        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                          e.preventDefault();
                          sendReplyOrNote();
                        }
                      }}
                      rows={3}
                      className="ainput w-full resize-none text-sm font-sans"
                      placeholder={
                        composerMode === "internal"
                          ? T.internalPlaceholder
                          : T.publicPlaceholder
                      }
                    />

                    {attachments.length > 0 ? (
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        {attachments.map((att, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 rounded-xl bg-slate-800 px-3 py-1.5 text-xs text-slate-200"
                          >
                            <span>📎 {att.name}</span>
                            <button
                              type="button"
                              onClick={() => removeAttachment(i)}
                              className="text-rose-400 hover:text-rose-300 font-bold ml-1"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*,.pdf,.txt,.log"
                          onChange={handleFileUpload}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploadingFile}
                          className="abtn text-xs py-1.5 px-3 flex items-center gap-1.5"
                        >
                          📎 {uploadingFile ? T.uploading : T.attachFile}
                        </button>
                        <span className="hidden sm:inline text-[11px] text-slate-500">
                          {T.ctrlEnterTip}
                        </span>
                      </div>

                      <button
                        className={`abtn w-full sm:w-auto px-5 py-2 font-semibold ${
                          composerMode === "internal"
                            ? "bg-amber-600 hover:bg-amber-500 text-white shadow-md shadow-amber-600/30"
                            : "abtn-primary shadow-md shadow-indigo-600/40"
                        }`}
                        onClick={sendReplyOrNote}
                        disabled={!reply.trim() && attachments.length === 0}
                      >
                        {composerMode === "internal" ? T.saveNote : T.sendReply}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
      {/* Canned Response Creation Modal */}
      {showCannedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>⚡</span> {T.cannedModalTitle}
              </h3>
              <button
                type="button"
                onClick={() => setShowCannedModal(false)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateCanned} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">
                    {T.shortcutLabel}
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="/my-shortcut"
                    value={newShortcut}
                    onChange={(e) => setNewShortcut(e.target.value)}
                    className="ainput text-xs w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">
                    {T.categoryFormLabel}
                  </label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="ainput text-xs w-full"
                  >
                    <option value="general">{T.cannedCatGeneral}</option>
                    <option value="billing">{T.cannedCatBilling}</option>
                    <option value="technical">{T.cannedCatTechnical}</option>
                    <option value="integration">{T.cannedCatIntegration}</option>
                    <option value="campaigns">{T.cannedCatCampaigns}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
                  {T.cannedTitleLabel}
                </label>
                <input
                  type="text"
                  required
                  placeholder={T.cannedTitlePlaceholder}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="ainput text-xs w-full"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
                  {T.cannedBodyLabel}
                </label>
                <textarea
                  required
                  rows={4}
                  placeholder={T.cannedBodyPlaceholder}
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  className="ainput text-xs w-full font-mono"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCannedModal(false)}
                  className="abtn text-xs"
                >
                  {dict.common.cancel}
                </button>
                <button
                  type="submit"
                  disabled={cannedBusy || !newShortcut.trim() || !newTitle.trim() || !newBody.trim()}
                  className="abtn abtn-primary text-xs"
                >
                  {cannedBusy ? T.saving : T.saveAction}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
