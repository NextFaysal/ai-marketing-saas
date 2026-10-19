"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { subscribeInboxStream } from "@/lib/inbox-stream";
import { EmptyState } from "@repo/ui";
import { ContactAvatar } from "@/components/inbox-avatar";
import { ChannelChip, ConvAvatar, EmojiPickerPanel, MediaView, ShipmentWidget, VoiceRecorder } from "@/components/inbox-extras";
import { insertAtCursor, toggleBulletLines, wrapSelection } from "@/lib/composer-format";
import { mergeTimeline } from "@/lib/timeline";
import { SNOOZE_PRESETS, isActivelySnoozed, snoozeBodyForCustom, snoozeBodyForMinutes } from "@/lib/snooze";
import { PRODUCT_MATCH_HONESTY, productMatchDraftText, productMatchHonesty, type ProductCandidateView } from "@/lib/cx8";
import { EMPTY_UI_FILTERS, hasAdvancedFilters, savedToUiFilters, splitSnippet, uiFiltersToParams, uiFiltersToSaved, type InboxUiFilters } from "@/lib/inbox-in1";
import { CONVERSATION_OUTCOMES, MACRO_STEP_LABELS, PIPELINE_STAGES, bulkReplySummary, formatMacroRunResult, macroRunStepLines, macroStepSummary, type MacroRunResult, type MacroStep } from "@/lib/inbox-in3";
import { parseSlaMinutesInput, slaChipInfo } from "@/lib/inbox-in4";
import { AGENT_REACTIONS, canSendReaction, deliveryTick, parseMessageReactions, quoteReachesCustomer } from "@/lib/inbox-in6";
import { NEXT_ACTION_ICONS, handoverSummaryNotice, isRunnableAction, proposalAcceptPatch, type NextActionResponse } from "@/lib/inbox-in7";
import { COURIER_RISK_BAND_BN, HANDOVER_REASON_LABELS, MOOD_TITLE, clampPane, dayLabel, initialsOf, money, relTime, renderQuick } from "@/lib/inbox-format";
import { appendConversationPage, getDraftStorage, loadComposerDraft, saveComposerDraft } from "@/lib/inbox-in9";
import { useLocale } from "@/lib/i18n/provider";
import { fmtNumber, fmtMoneyMinor, fmtDate, fmtTime, fmtDateTime } from "@repo/contracts";
import { snoozePresets } from "@/lib/snooze";
import { courierRiskBand, handoverReasonLabels, moodTitle } from "@/lib/inbox-format";
import { macroStepLabels } from "@/lib/inbox-in3";

/** IN1: a message-search hit + a saved view, as the API returns them. */
interface MessageSearchResult {
  messageId: string; conversationId: string; direction: string; type: string;
  matchedField: string; snippet: string; matchStart: number; matchLength: number;
  createdAt: string; channel?: string | null; contactName?: string | null; contactPhone?: string | null;
}
interface SavedView { id: string; name: string; filters: Record<string, unknown>; shared: boolean; mine: boolean }
/** IN3: a macro as the API returns it (steps already validated). */
interface Macro { id: string; name: string; steps: MacroStep[]; shared: boolean; mine: boolean }
/** IN3: one builder row — every field optional in the draft; the
 * save handler converts only the fields its type needs, mirroring
 * the server's strict validation (which still has the final say). */
interface MacroStepDraft { type: string; quickReplyId: string; assignedUserId: string; tag: string; stage: string; outcome: string; minutes: number }
const emptyMacroStep = (): MacroStepDraft => ({ type: "reply", quickReplyId: "", assignedUserId: "me", tag: "", stage: "talking", outcome: "", minutes: 120 });

/** Inbox Next-Gen P1: browser-upload cap. Mirrors the API's decoded
 * cap (MEDIA_UPLOAD_MAX_BYTES = 2MB in InboxService). */
const MEDIA_UPLOAD_MAX_BYTES = 2_000_000;

interface WaWindow { open: boolean; expiresAt: string | null }
interface AiScheduleWindow { days: number[]; start: string; end: string }
interface AiScheduleEntry { enabled: boolean; windows: AiScheduleWindow[] }
type AiScheduleMap = Record<string, AiScheduleEntry>;
interface Conversation {
  id: string; channel: string; contactName?: string | null; contactPhone?: string | null;
  status: string; unreadCount: number; lastMessagePreview?: string | null; lastMessageAt?: string | null;
  assignedUserId?: string | null; tags?: string[]; whatsappWindow?: WaWindow | null;
  customerId?: string | null; leadId?: string | null;
  mood?: "positive" | "neutral" | "negative" | null;
  visitorLastSeenAt?: string | null;
  createdAt?: string;
  priority?: string; sentimentFlag?: string | null; firstResponseAt?: string | null;
  spamFlag?: boolean; spamReason?: string | null;
  // IN10a: OUR system-level block (never a platform block).
  blockedAt?: string | null; blockedByUserId?: string | null; blockReason?: string | null;
  autoReplyPaused?: boolean;
  pipelineStage?: string;
  outcome?: string | null;
  csatRating?: number | null; csatSentAt?: string | null;
  summaryText?: string | null; summaryProvider?: string | null; summaryAt?: string | null;
  // CX4/CX5 (ported): handover queue + snooze + timed assignment.
  snoozedUntil?: string | null; handoverReason?: string | null; handoverAt?: string | null;
  assignmentKind?: string | null; assignedUntil?: string | null; isPractice?: boolean;
  updatedAt?: string;
  aiScheduleActive?: boolean;
  // IN4: server-computed SLA position (layered policy) — the
  // card chip renders this verdict, never a re-derived deadline.
  slaState?: "warning" | "breached" | null; slaDueAt?: string | null; slaEffectiveMinutes?: number | null;
}
interface Message {
  id: string; direction: string; content?: string | null; type: string; status: string;
  error?: string | null; createdAt: string; sentByAiDraft: boolean;
  sentWithAiAssist?: boolean; quickReplyId?: string | null;
  mediaId?: string | null; mediaUrl?: string | null;
  mediaStorageKey?: string | null; mediaContentType?: string | null;
  intent?: string | null; intentConfidence?: number | null; autoReply?: boolean;
  sentiment?: "positive" | "negative" | null;
  transcription?: string | null; transcriptionProvider?: string | null;
  transcriptionStatus?: string | null;
  // IN6: lifecycle — deliveryStatus is set ONLY on real platform
  // confirmation; quote is the server-resolved quoted snippet.
  deliveryStatus?: string | null; deliveredAt?: string | null; readAt?: string | null;
  replyToMessageId?: string | null;
  quote?: { id: string; direction?: string; snippet?: string; unavailable?: boolean } | null;
  reactions?: unknown;
  pinnedAt?: string | null; pinnedBy?: string | null;
}
interface PinnedMessage { id: string; snippet: string; pinnedAt: string; pinnedBy?: string | null }
interface PaymentVerification { id: string; messageId: string; verdict: string; provider?: string | null; trxId?: string | null; amountMinor?: string | null; expectedAmountMinor?: string | null; flags?: string[] | null }
interface Draft { id: string; content: string; provider: string; createdAt: string }
interface Note { id: string; content: string; authorUserId: string; createdAt: string }
interface QuickReply { id: string; title: string; content: string; timesUsed?: number }
interface WaTemplate { id: string; name: string; language: string; category?: string | null; bodyText?: string | null; status?: string | null; qualityRating?: string | null }
interface Member { id: string; role: string; user: { id: string; name?: string | null; email: string } }
interface ContextData {
  customer: { id: string; name?: string | null; phone?: string | null; email?: string | null; createdAt: string } | null;
  lead: { id: string; stage: string; source: string; valueMinor?: string | null; tags?: string[] } | null;
  orders: { id: string; externalNumber?: string | null; status: string; source: string; isCod: boolean; currency: string; totalMinor: string; createdAt: string; codConfirmationStatus?: string | null; shipment?: { id: string; trackingCode?: string | null; status: string; provider: string; consignmentId?: string | null; codAmountMinor?: string | null; lastCheckedAt?: string | null } | null }[];
  lifetime: { orderCount: number; totalSpentMinor: string; currency: string } | null;
  courierRecord?: { decided: number; delivered: number; successRatePct: number | null; riskBand: string; riskScore: number | null } | null;
  // IN2: identity unification — duplicates are flagged ONLY on a
  // real identifier match (phone last-10 / email); a PSID alone
  // never produces a candidate. merges are the reversible IN2
  // records into this customer.
  identity?: {
    customerId: string | null;
    duplicates: { conversationId: string | null; channel: string | null; contactName: string | null; contactPhone: string | null; customerId: string | null; customerName: string | null; matchReasons: string[]; lastMessageAt: string | null }[];
    linkedConversations: { id: string; channel: string; status: string; contactName: string | null; lastMessageAt: string | null; lastMessagePreview: string | null }[];
    merges: { id: string; sourceCustomerId: string; targetCustomerId: string; sourceName: string | null; sourcePhone: string | null; ordersMoved: number; conversationsMoved: number; createdAt: string }[];
  } | null;
}




/** IN10c: Analytics v2 payload — every number compute-on-read
 * over real rows (see docs/in10-acceptance.md definitions). */
interface InboxAnalytics {
  days: number; timezone: string;
  heatmap: { matrix: number[][]; hourTotals: number[]; peakHour: { hour: number; count: number } | null };
  channels: { channel: string; activeConversations: number; convertedConversations: number; conversationsStarted: number; conversionPct: number | null }[];
  trend: { date: string; newConversations: number; inboundMessages: number; avgFirstResponseMinutes: number | null; resolvedCount: number; avgResolutionMinutes: number | null }[];
  intents: { intent: string; count: number; pct: number | null }[];
  totals: { inboundMessages: number; classifiedMessages: number; conversationsStarted: number; chatOrders: number };
}

// UX1 Q2: one soft two-tone beep (WebAudio, no asset). The context
// is created lazily on first use; if the browser keeps it suspended
// (autoplay policy before any user gesture) the beep is simply
// silent — never an error, never a fake "played".
let beepCtx: AudioContext | null = null;
function beepOnce() {
  try {
    if (typeof window === "undefined") return;
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return;
    beepCtx ??= new AC();
    // Suspended (autoplay policy): kick a resume for next time and
    // stay silent for this one.
    if (beepCtx.state === "suspended") { void beepCtx.resume().catch(() => undefined); return; }
    const t0 = beepCtx.currentTime;
    for (const [i, freq] of [880, 660].entries()) {
      const osc = beepCtx.createOscillator();
      const gain = beepCtx.createGain();
      osc.type = "sine"; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + i * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.08, t0 + i * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.14 + 0.13);
      osc.connect(gain).connect(beepCtx.destination);
      osc.start(t0 + i * 0.14); osc.stop(t0 + i * 0.14 + 0.14);
    }
  } catch { /* sound is best-effort */ }
}

// IN9c: ChannelChip / ConvAvatar / MediaView / ShipmentWidget now
// live in components/inbox-extras (props-only, extracted verbatim).

/**
 * Audio chime synthesizer using Web Audio API (Zero external assets needed)
 * Plays a pleasant Intercom/Crisp-style double chime.
 */
function playNotificationChime() {
  if (typeof window === "undefined") return;
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // First tone (E5 ~ 659.25Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(659.25, now);
    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.25);

    // Second tone (A5 ~ 880Hz) slightly delayed for a delightful chime
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(880, now + 0.1);
    gain2.gain.setValueAtTime(0.001, now + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.25, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.45);
  } catch {
    // Audio autoplay restrictions or context blocked
  }
}

export default function InboxPage() {
  const { t, locale } = useLocale();
  const dictT = t;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  // IN6: composer quote target + server-provided pinned list +
  // which message's reaction picker is open.
  const [quoteTarget, setQuoteTarget] = useState<Message | null>(null);
  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessage[]>([]);
  const [reactionFor, setReactionFor] = useState<string | null>(null);
  const [productMatch, setProductMatch] = useState<{ messageId: string; loading?: boolean; available?: boolean; message?: string; candidates?: ProductCandidateView[] } | null>(null);

  async function findProductsForMessage(m: Message) {
    const orgId = getOrganizationId(); if (!orgId || !active) return;
    setProductMatch({ messageId: m.id, loading: true });
    setError("");
    try {
      const out = await apiFetch<{ available: boolean; message?: string; candidates?: ProductCandidateView[] }>(
        `/organizations/${orgId}/inbox/conversations/${active.id}/messages/${m.id}/recognize-product`,
        { method: "POST" },
      );
      setProductMatch({ messageId: m.id, available: out.available, message: out.message, candidates: out.candidates ?? [] });
    } catch (e) {
      setProductMatch(null);
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  function insertProductMatchDraft(candidate: ProductCandidateView) {
    const text = productMatchDraftText(candidate);
    setReply((prev) => `${prev}${prev && !prev.endsWith(" ") ? " " : ""}${text}`);
    setProductMatch(null);
    focusComposer();
  }
  const [context, setContext] = useState<ContextData | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  // P3: composer mode — "reply" is customer-visible, "note" is an
  // internal whisper. The composer text (`reply`) is shared across
  // modes; note mode has NO path to any customer send endpoint.
  const [composerMode, setComposerMode] = useState<"reply" | "note">("reply");
  // P3: ghost text (AI autocomplete suggestion for the reply only).
  const [ghost, setGhost] = useState("");
  const ghostForRef = useRef("");
  const ghostSeqRef = useRef(0);
  const ghostAbortRef = useRef<AbortController | null>(null);
  const ghostLastFetchRef = useRef("");
  // P3: tone rewriter — undo stash + menu visibility.
  const [showToneMenu, setShowToneMenu] = useState(false);
  const [prevReply, setPrevReply] = useState<string | null>(null);
  // P3: webchat visitor presence (live stream cues keyed by conv id).
  const [visitorLive, setVisitorLive] = useState<Record<string, { typing: boolean; at: number }>>({});
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [templates, setTemplates] = useState<WaTemplate[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [reply, setReply] = useState("");
  const [showQuick, setShowQuick] = useState(false);
  const [imageForm, setImageForm] = useState({ url: "", caption: "" });
  const [showImage, setShowImage] = useState(false);
  const [tplVars, setTplVars] = useState("");
  const [tplId, setTplId] = useState("");
  const [tagInput, setTagInput] = useState("");
  // UX1 Q3: last-used filters persist per agent (same localStorage
  // pattern as the pane widths) — merged over the defaults so a
  // stale/partial saved object can never break the shape.
  const [filters, setFilters] = useState(() => {
    const base: InboxUiFilters = { ...EMPTY_UI_FILTERS };
    try { const raw = localStorage.getItem("inbox.filters"); if (raw) return { ...base, ...JSON.parse(raw) }; } catch { /* defaults */ }
    return base;
  });
  // Inbox Next-Gen P2: smart folders (server-side counts — the
  // list page itself is capped, so its length would lie) + bulk
  // selection state.
  const [smartFolder, setSmartFolder] = useState<"" | "sla" | "vip" | "handover" | "snoozed">(() => {
    try { const v = localStorage.getItem("inbox.folder"); return v === "sla" || v === "vip" || v === "handover" || v === "snoozed" ? v : ""; } catch { return ""; }
  });
  useEffect(() => { try { localStorage.setItem("inbox.folder", smartFolder); } catch { /* best-effort */ } }, [smartFolder]);
  // CX5: action-bar menu state (snooze / timer / mobile more).
  const [folderCounts, setFolderCounts] = useState<{ all: number; mine: number; unassigned: number; slaBreach: number; vip: number; handover: number; snoozed: number; vipThresholdMinor: string | null; slaFirstResponseMinutes: number; slaByChannel?: Record<string, number>; slaVipMinutes?: number | null } | null>(null);
  // IN1: message search + advanced filter panel + saved views.
  const [showAdv, setShowAdv] = useState(false);
  const [msgQ, setMsgQ] = useState("");
  const [msgResults, setMsgResults] = useState<MessageSearchResult[] | null>(null);
  const [msgBusy, setMsgBusy] = useState(false);
  const [highlightMsgId, setHighlightMsgId] = useState<string | null>(null);
  const [aiAssistUsed, setAiAssistUsed] = useState(false);
  const [usedQuickReplyId, setUsedQuickReplyId] = useState<string | null>(null);
  // UX1 Q2/Q3: org-wide unread total drives the tab-title badge.
  const [unreadTotal, setUnreadTotal] = useState(0);
  const messagesRef = useRef<Message[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => {
    const original = t("inbox.titleWord");
    document.title = unreadTotal > 0 ? `(${fmtNumber(locale, unreadTotal)}) ${t("inbox.titleWord")}` : original;
    return () => { document.title = original; };
  }, [unreadTotal]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [saveViewName, setSaveViewName] = useState("");
  const [saveViewShared, setSaveViewShared] = useState(false);
  const loadSavedViews = useCallback(() => {
    const orgId = getOrganizationId(); if (!orgId) return;
    apiFetch<SavedView[]>(`/organizations/${orgId}/inbox/saved-views`).then(setSavedViews).catch(() => undefined);
  }, []);
  useEffect(() => { loadSavedViews(); }, [loadSavedViews]);
  // CX5: one-row action bar menu state (snooze / timer / mobile more).
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);
  const [showTimerMenu, setShowTimerMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [snoozeCustom, setSnoozeCustom] = useState("");
  // CX4: 30s tick so handover waiting / timed chips move.
  const [handoverTick, setHandoverTick] = useState(() => Date.now());
  useEffect(() => { const tm = setInterval(() => setHandoverTick(Date.now()), 30000); return () => clearInterval(tm); }, []);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAssign, setBulkAssign] = useState("");
  const [bulkTag, setBulkTag] = useState("");
  // IN3: macros + bulk reply.
  const [macros, setMacros] = useState<Macro[]>([]);
  const [showMacroMenu, setShowMacroMenu] = useState(false);
  const [macroResult, setMacroResult] = useState<MacroRunResult | null>(null);
  const [macroName, setMacroName] = useState("");
  const [macroShared, setMacroShared] = useState(false);
  const [macroDraft, setMacroDraft] = useState<MacroStepDraft[]>([emptyMacroStep()]);
  const [bulkQrId, setBulkQrId] = useState("");
  const [bulkTplId, setBulkTplId] = useState("");
  // CC4: appSource arrives from the Connect Center ("নিজের অ্যাপ
  // দিয়ে" deep-link sets ?appSource=own); the form's select can
  // still change it. "own" uses the tenant's Meta app saved in
  // the Connect Center — its secret, not a re-typed one.
  const [connectForm, setConnectForm] = useState(() => ({
    channel: "whatsapp", accessToken: "", appSecret: "", verifyToken: "", phoneNumberId: "", pageId: "",
    appSource: typeof window !== "undefined" && new URLSearchParams(window.location.search).get("appSource") === "own" ? "own" : "platform",
  }));
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [qrForm, setQrForm] = useState({ title: "", content: "" });
  const [tplForm, setTplForm] = useState({ name: "", language: "bn", category: "UTILITY", bodyText: "" });
  const [settings, setSettings] = useState<{ autoReplyMode: string; confidenceThreshold: number; perIntent: Record<string, string>; smartAssign: string; slaFirstResponseMinutes: number; botEnabled?: boolean; botDeliveryChargeMinor?: number | null; reassignAfterMinutes?: number | null; escalationTeamId?: string | null; perChannelModes?: Record<string, string>; escalationThresholdMinor?: number | null; retentionDays?: number | null; aiReplyDelaySeconds?: number; aiReplyDelayByChannel?: Record<string, number>; aiScheduleByChannel?: AiScheduleMap; reviewRequestEnabled?: boolean; reviewRequestDelayHours?: number; chaseEnabled?: boolean; chaseFirstDelayMinutes?: number; chaseIntervalMinutes?: number; chaseMaxAttempts?: number; chaseQuietHoursRespect?: boolean; chaseQuietStartHour?: number; chaseQuietEndHour?: number; maxChaseAttempts?: number; chaseMessage?: string | null; slaByChannel?: Record<string, number>; slaVipMinutes?: number | null; slaEscalateAfterMinutes?: number; slaLeadAlertEnabled?: boolean; slaAutoReassignEnabled?: boolean } | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState<AiScheduleMap | null>(null);
  const [botSession, setBotSession] = useState<{ id: string; state: string; status: string } | null>(null);
  const [verifications, setVerifications] = useState<PaymentVerification[]>([]);
  const [presence, setPresence] = useState<{ userId: string; name: string; typing: boolean }[]>([]);
  const [iAmTyping, setIAmTyping] = useState(false);

  useEffect(() => {
    if (!active) { setPresence([]); return; }
    const orgId = getOrganizationId(); if (!orgId) return;
    let cancelled = false;
    const beat = async () => {
      try {
        const r = await apiFetch<{ others: { userId: string; name: string; typing: boolean }[] }>(`/organizations/${orgId}/inbox/conversations/${active.id}/presence`, { method: "POST", body: JSON.stringify({ typing: iAmTyping }) });
        if (!cancelled) setPresence(r.others);
      } catch { /* presence is best-effort */ }
    };
    beat();
    const t = setInterval(beat, 20000);
    return () => { cancelled = true; clearInterval(t); };
  }, [active?.id, iAmTyping]);
  // P3: age-out ticker for visitor presence cues — runs only while
  // a conversation is open so stale "typing/online" cues fade.
  useEffect(() => {
    if (!active) return;
    setNowTick(Date.now());
    const t = setInterval(() => setNowTick(Date.now()), 5000);
    return () => clearInterval(t);
  }, [active?.id]);

  // P3: note mode must never claim customer-visible typing.
  useEffect(() => { if (composerMode === "note") setIAmTyping(false); }, [composerMode]);

  // P3 ghost: clear immediately on ANY reply / conversation / mode
  // change (declared before the fetch effect so clearing runs first).
  useEffect(() => {
    setGhost("");
    ghostForRef.current = "";
  }, [reply, active?.id, composerMode]);

  // P3 ghost: debounced fetch. All failures are silent "no ghost".
  useEffect(() => {
    if (composerMode !== "reply" || !active) return;
    if (reply.trim().length < 3 || reply.startsWith("/")) return;
    if (ghostLastFetchRef.current === reply) return;
    const partial = reply;
    const convId = active.id;
    const timer = setTimeout(() => {
      ghostLastFetchRef.current = partial;
      const seq = ++ghostSeqRef.current;
      ghostAbortRef.current?.abort();
      const ctrl = new AbortController();
      ghostAbortRef.current = ctrl;
      const orgId = getOrganizationId(); if (!orgId) return;
      apiFetch<{ completion: string }>(`/organizations/${orgId}/inbox/conversations/${convId}/ghost`, {
        method: "POST",
        body: JSON.stringify({ partial }),
        signal: ctrl.signal,
      }).then((r) => {
        if (seq !== ghostSeqRef.current || ctrl.signal.aborted) return;
        if (!r.completion) { setGhost(""); return; }
        ghostForRef.current = partial;
        setGhost(r.completion);
      }).catch(() => {
        if (seq !== ghostSeqRef.current || ctrl.signal.aborted) return;
        setGhost("");
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [reply, composerMode, active?.id]);

  const [report, setReport] = useState<any>(null);
  // IN10b/c: note PII masking opt-in + Analytics v2 state.
  const [noteMask, setNoteMask] = useState(false);
  const [analytics, setAnalytics] = useState<InboxAnalytics | null>(null);
  const [analyticsDays, setAnalyticsDays] = useState(7);
  const [blockReason, setBlockReason] = useState("");
  // Milestone 73: my performance + my signature (self-service).
  const [myPerf, setMyPerf] = useState<any>(null);
  const [mySig, setMySig] = useState<{ signature: string; enabled: boolean }>({ signature: "", enabled: false });
  // U4: telegram / email connect forms
  const [tgToken, setTgToken] = useState("");
  const [tgResult, setTgResult] = useState("");
  const [emailForm, setEmailForm] = useState({ imapHost: "", imapPort: 993, smtpHost: "", smtpPort: 587, user: "", password: "" });
  const [emailResult, setEmailResult] = useState("");
  const [tiktokPack, setTiktokPack] = useState<any>(null);
  useEffect(() => {
    const orgId = getOrganizationId(); if (!orgId) return;
    apiFetch<any>(`/organizations/${orgId}/inbox/tiktok/status`).then(setTiktokPack).catch(() => undefined);
  }, []);

  // U5: control center — board view, command profile, close outcome
  const [viewMode, setViewMode] = useState<"list" | "board" | "media" | "manage">("list");
  const [manageTab, setManageTab] = useState<"settings" | "performance" | "report" | "teams" | "channels" | "quick">("settings");
  // Inbox Next-Gen P1: fixed workspace + resizable panes + composer extras.
  const [listW, setListW] = useState<number>(() => { try { return clampPane(Number(localStorage.getItem("inbox.listW")) || 300, 230, 520); } catch { return 300; } });
  const [ctxW, setCtxW] = useState<number>(() => { try { return clampPane(Number(localStorage.getItem("inbox.ctxW")) || 320, 260, 520); } catch { return 320; } });
  const [ctxOpen, setCtxOpen] = useState(false);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  const [stageMenuOpen, setStageMenuOpen] = useState(false);
  const [filterExpanded, setFilterExpanded] = useState(false);
  const [mobileTab, setMobileTab] = useState<"chat" | "customer">("chat");
  const [newMsgOpen, setNewMsgOpen] = useState(false);
  const [newMsgForm, setNewMsgForm] = useState({ channel: "whatsapp", recipient: "", message: "" });
  const [showEmoji, setShowEmoji] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const threadScrollRef = useRef<HTMLDivElement | null>(null);
  const openConvRef = useRef<string | null>(null);
  const lastMsgIdRef = useRef<string | null>(null);
  const [mediaItems, setMediaItems] = useState<any[]>([]);
  const [mediaQ, setMediaQ] = useState("");
  const [mediaType, setMediaType] = useState("");
  const loadMedia = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    const params = new URLSearchParams(); if (mediaType) params.set("type", mediaType); if (mediaQ) params.set("q", mediaQ);
    try { setMediaItems(await apiFetch<any[]>(`/organizations/${orgId}/inbox/media?${params.toString()}`)); } catch { setMediaItems([]); }
  }, [mediaQ, mediaType]);
  useEffect(() => { if (viewMode === "media") void loadMedia(); }, [viewMode, loadMedia]);
  const [board, setBoard] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [closeOutcome, setCloseOutcome] = useState<string>("sale");
  const loadBoard = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try { setBoard(await apiFetch<any>(`/organizations/${orgId}/inbox/pipeline-board`)); } catch { /* board is additive */ }
  }, []);
  useEffect(() => { if (viewMode === "board") { void loadBoard(); const t = setInterval(loadBoard, 30000); return () => clearInterval(t); } }, [viewMode, loadBoard]);

  // U2: teams + agent states
  const [teams, setTeams] = useState<any[]>([]);
  const [agentStates, setAgentStates] = useState<any[]>([]);
  const [myStatus, setMyStatus] = useState("online");
  const [teamForm, setTeamForm] = useState<{ name: string; channels: string[] }>({ name: "", channels: [] });
  const [teamDraft, setTeamDraft] = useState<Record<string, Record<string, number>>>({});
  const loadTeams = useCallback(() => {
    const orgId = getOrganizationId(); if (!orgId) return;
    apiFetch<any[]>(`/organizations/${orgId}/inbox/teams`).then((rows) => {
      setTeams(rows);
      const draft: Record<string, Record<string, number>> = {};
      for (const t of rows) { draft[t.id] = {}; for (const mb of t.members ?? []) draft[t.id][mb.userId] = mb.capacity ?? 20; }
      setTeamDraft(draft);
    }).catch(() => undefined);
    apiFetch<any[]>(`/organizations/${orgId}/inbox/agent-states`).then(setAgentStates).catch(() => undefined);
  }, []);
  useEffect(() => { loadTeams(); }, [loadTeams]);
  const [products, setProducts] = useState<{ id: string; name: string; priceMinor: string; currency: string; stockQuantity?: number | null }[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderItems, setOrderItems] = useState<{ productId: string; quantity: number }[]>([]);
  const [orderShip, setOrderShip] = useState("60");
  const [orderAddress, setOrderAddress] = useState("");
  const [orderCod, setOrderCod] = useState(true);
  // IN7b/c: the AI next-action proposal for the open thread —
  // display-only until the agent clicks (nothing auto-runs).
  const [nextAction, setNextAction] = useState<NextActionResponse | null>(null);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [mobileChat, setMobileChat] = useState(false);
  // U1: realtime + command-center state
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [visibleCount, setVisibleCount] = useState(40);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [myId, setMyId] = useState<string | null>(null);
  const [liveOthers, setLiveOthers] = useState<Record<string, { typing: boolean; at: number }>>({});
  const activeRef = useRef<Conversation | null>(null);
  const listTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // IN9a: cursor pagination state. nextCursor mirrors the API
  // envelope (null = no older page exists); the ref copy lets the
  // scroll sentinel + load-more guard read the freshest value
  // without re-binding the observer on every page.
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const nextCursorRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);
  const listParamsRef = useRef<URLSearchParams | null>(null);
  const applyNextCursor = useCallback((c: string | null) => {
    nextCursorRef.current = c;
    setNextCursor(c);
  }, []);
  // IN9d: which conversation the composer text currently belongs
  // to — drafts are saved/restored per conversation, and this ref
  // stops a restore for conversation B from ever being written
  // under conversation A's key during the switch render.
  const replyOwnerRef = useRef<string | null>(null);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { apiFetch<any>("/auth/me").then((j) => setMyId(j?.id ?? j?.user?.id ?? null)).catch(() => undefined); }, []);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadConversations = useCallback(async (f = filters, folderOverride?: string) => {
    const orgId = getOrganizationId(); if (!orgId) return;
    // P2 + IN1b: ALL list params (incl. the advanced date/amount/
    // intent/sentiment filters and the smart folder, which
    // AND-composes server-side) are built by the tested helper.
    const effFolder = folderOverride !== undefined ? folderOverride : smartFolder;
    const params = uiFiltersToParams(f, effFolder);
    // IN9a: the first page is fetched in cursor mode (cursor=""),
    // which returns { items, nextCursor } — pages beyond the first
    // 100 are reachable via loadMoreConversations. A legacy bare
    // array (older API) is still accepted and simply has no next
    // page. listParamsRef remembers the exact filter set so
    // load-more pages can never drift from the visible list.
    params.set("cursor", "");
    listParamsRef.current = params;
    try {
      const res = await apiFetch<Conversation[] | { items: Conversation[]; nextCursor: string | null }>(`/organizations/${orgId}/inbox/conversations?${params.toString()}`);
      if (Array.isArray(res)) { setConversations(res); applyNextCursor(null); }
      else { setConversations(res.items ?? []); applyNextCursor(res.nextCursor ?? null); }
    }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    try { setIntegrations(await apiFetch<any[]>(`/organizations/${orgId}/inbox/integrations`)); } catch { /* none */ }
    // P2: folder counts are server-side totals (see counts endpoint).
    try { const c = await apiFetch<any>(`/organizations/${orgId}/inbox/conversations/counts`); setFolderCounts(c); setUnreadTotal(typeof c?.unreadTotal === "number" ? c.unreadTotal : 0); } catch { /* counts are additive */ }
  }, [filters, smartFolder, applyNextCursor]);

  // IN9a: fetch the NEXT cursor page for the CURRENT filter set
  // and append it (de-duplicated by the tested helper). A stale
  // response — the list was refreshed/filtered while this page was
  // in flight — is dropped by checking the cursor is still the
  // live one. A failure keeps the cursor, so the sentinel/button
  // simply offers the same page again; nothing is marked loaded
  // that was not actually returned.
  const loadMoreConversations = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    const cursor = nextCursorRef.current;
    const base = listParamsRef.current;
    if (!cursor || !base || loadingMoreRef.current) return;
    loadingMoreRef.current = true; setLoadingMore(true);
    try {
      const params = new URLSearchParams(base);
      params.set("cursor", cursor);
      const res = await apiFetch<Conversation[] | { items: Conversation[]; nextCursor: string | null }>(`/organizations/${orgId}/inbox/conversations?${params.toString()}`);
      if (nextCursorRef.current !== cursor) return; // superseded by a refresh
      const items = Array.isArray(res) ? res : (res.items ?? []);
      if (items.length) setConversations((prev) => appendConversationPage(prev, items));
      applyNextCursor(Array.isArray(res) ? null : (res.nextCursor ?? null));
      setVisibleCount((c) => c + 40);
    } catch { /* cursor kept — the next sentinel hit / click retries */ }
    finally { loadingMoreRef.current = false; setLoadingMore(false); }
  }, [applyNextCursor]);

  useEffect(() => { loadConversations(); }, [loadConversations]);
  useEffect(() => { const mine = agentStates.find((a) => a.userId === myId); if (mine?.status) setMyStatus(mine.status); }, [agentStates, myId]);
  // U1: realtime stream — instant messages/updates/presence, with a
  // slow safety poll if the stream silently drops.
  useEffect(() => {
    const orgId = getOrganizationId(); if (!orgId) return;
    const scheduleList = () => {
      if (listTimer.current) clearTimeout(listTimer.current);
      listTimer.current = setTimeout(() => loadConversations(), 400);
    };
    const unsub = subscribeInboxStream(orgId, (ev) => {
      if (ev.type === "message.created" && ev.message) {
        const msg = ev.message as unknown as Message;
        if (msg.direction === "in" && soundEnabled) {
          playNotificationChime();
        }
        if (activeRef.current && ev.conversationId === activeRef.current.id) {
          setMessages((prev) => {
            const i = prev.findIndex((m) => m.id === msg.id);
            if (i >= 0) { const copy = [...prev]; copy[i] = { ...copy[i], ...msg }; return copy; }
            return [...prev, msg];
          });
        }
        scheduleList();
      } else if (ev.type === "conversation.updated") {
        scheduleList();
      } else if (ev.type === "presence" && ev.userId && ev.conversationId === activeRef.current?.id) {
        setLiveOthers((prev) => ({ ...prev, [ev.userId as string]: { typing: Boolean(ev.typing), at: Date.now() } }));
      } else if (ev.type === "visitor.presence" && ev.conversationId) {
        const cid = ev.conversationId;
        setVisitorLive((prev) => ({ ...prev, [cid]: { typing: Boolean(ev.visitorTyping), at: Date.now() } }));
        setNowTick(Date.now());
      }
    });
    const fallback = setInterval(() => loadConversations(), 60000);
    return () => { unsub(); clearInterval(fallback); };
  }, [loadConversations, soundEnabled]);
  // U1: progressive list rendering
  useEffect(() => {
    const el = sentinelRef.current; if (!el) return;
    const ob = new IntersectionObserver((es) => {
      if (!es[0]?.isIntersecting) return;
      setVisibleCount((c) => c + 40);
      if (nextCursorRef.current) void loadMoreConversations();
    }, { rootMargin: "240px" });
    ob.observe(el);
    return () => ob.disconnect();
  }, [conversations.length, nextCursor, loadMoreConversations]);

  // IN9d: persist the composer draft per conversation (UX1-style
  // localStorage, best-effort). The replyOwnerRef guard ties the
  // text to the conversation it was restored/typed for; an empty
  // text removes the draft — which is exactly what a successful
  // send leaves behind (the send path clears `reply` itself, and
  // a failed send's text survives in the pending bubble instead).
  useEffect(() => {
    if (!active || replyOwnerRef.current !== active.id) return;
    saveComposerDraft(getDraftStorage(), active.id, reply);
  }, [reply, active?.id]);
  // U1: keyboard-first operation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = Boolean(target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable));
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((v) => !v); return; }
      if (typing) return;
      if (e.key === "j") { e.preventDefault(); setFocusedIdx((i) => { const n = Math.min(conversations.length - 1, i + 1); document.getElementById(`conv-${conversations[n]?.id}`)?.scrollIntoView({ block: "nearest" }); return n; }); }
      else if (e.key === "k") { e.preventDefault(); setFocusedIdx((i) => { const n = Math.max(0, i - 1); document.getElementById(`conv-${conversations[n]?.id}`)?.scrollIntoView({ block: "nearest" }); return n; }); }
      else if (e.key === "Enter") { const c = conversations[focusedIdx]; if (c) void openConversation(c); }
      else if (e.key === "/") { e.preventDefault(); document.getElementById("inbox-search")?.focus(); }
      else if (e.key === "e") { if (active && myId) void patchConversation({ assignedUserId: myId }); }
      else if (e.key === "r") { e.preventDefault(); document.getElementById("inbox-reply")?.focus(); }
      else if (e.key === "?") setShowShortcuts((v) => !v);
      else if (e.key === "Escape") { setPaletteOpen(false); setShowShortcuts(false); setGhost(""); ghostForRef.current = ""; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [conversations, focusedIdx, active, myId]);
  useEffect(() => {
    const orgId = getOrganizationId(); if (!orgId) return;
    apiFetch<QuickReply[]>(`/organizations/${orgId}/inbox/quick-replies`).then(setQuickReplies).catch(() => undefined);
    apiFetch<Macro[]>(`/organizations/${orgId}/inbox/macros`).then(setMacros).catch(() => undefined);
    apiFetch<WaTemplate[]>(`/organizations/${orgId}/inbox/whatsapp-templates`).then((t) => { setTemplates(t); if (t[0]) setTplId(t[0].id); }).catch(() => undefined);
    apiFetch<Member[]>(`/organizations/${orgId}/members`).then(setMembers).catch(() => undefined);
    apiFetch<any>(`/organizations/${orgId}/inbox/settings`).then(setSettings).catch(() => undefined);
    apiFetch<any>(`/organizations/${orgId}/inbox/team-report?days=7`).then(setReport).catch(() => undefined);
    apiFetch<any>(`/organizations/${orgId}/inbox/my-performance?days=7`).then(setMyPerf).catch(() => undefined);
    apiFetch<any>(`/organizations/${orgId}/inbox/my-signature`).then((s) => setMySig({ signature: s.signature ?? "", enabled: Boolean(s.enabled) })).catch(() => undefined);
    // Milestone 71: the report can be scoped to one team.
    apiFetch<any>(`/organizations/${orgId}/products?pageSize=100`).then((r) => setProducts(r.items ?? [])).catch(() => undefined);
  }, []);

  async function saveSettings(patch: Record<string, unknown>) {
    const orgId = getOrganizationId(); if (!orgId || !settings) return;
    try {
      const saved = await apiFetch<any>(`/organizations/${orgId}/inbox/settings`, { method: "PATCH", body: JSON.stringify(patch) });
      setSettings(saved);
      setNotice(t("inbox.settingsSaved"));
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  async function requestCod(orderId: string) {
    const orgId = getOrganizationId(); if (!orgId || !active) return;
    setBusy("cod"); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/inbox/conversations/${active.id}/cod-confirmation`, { method: "POST", body: JSON.stringify({ orderId }) });
      setNotice(t("inbox.codSent"));
      await refreshActive();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  function onSearch(q: string) {
    setVisibleCount(40); setFocusedIdx(0);
    const next = { ...filters, q };
    setFilters(next);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadConversations(next), 350);
  }
  function onFilter(patch: Partial<typeof filters>) {
    setVisibleCount(40); setFocusedIdx(0);
    const next = { ...filters, ...patch };
    setFilters(next);
    loadConversations(next);
  }

  /** P2 smart folders: "সব / আমার / অনির্ধারিত" drive the existing
   * assignee filter; "sla" / "vip" set the server-side folder,
   * which AND-composes with whatever filters are active. */
  function applyFolder(folderVal: "" | "sla" | "vip" | "handover" | "snoozed", assigneeVal?: string) {
    setVisibleCount(40); setFocusedIdx(0);
    setSmartFolder(folderVal);
    setSelectedIds(new Set());
    // IN4d: the SLA-risk sort belongs to the handover queue —
    // leaving the folder restores the default order so the
    // persisted filters never carry it into other folders.
    const effective = folderVal !== "handover" && filters.sort === "sla_risk" ? { ...filters, sort: "recent" } : filters;
    if (effective !== filters) setFilters(effective);
    if (assigneeVal !== undefined) {
      const next = { ...effective, assignee: assigneeVal };
      setFilters(next);
      loadConversations(next, folderVal);
    } else {
      loadConversations(effective, folderVal);
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  /** P2 bulk actions — ONE POST to the bulk endpoint (never a
   * client-side PATCH loop). Results are reported honestly:
   * successes clear, failures stay selected with their reasons. */
  async function runBulk(action: "close" | "assign" | "tag-add" | "mark-read") {
    const orgId = getOrganizationId(); if (!orgId || selectedIds.size === 0) return;
    if (action === "assign" && !bulkAssign) { setError(t("inbox.assignPickMember")); return; }
    if (action === "tag-add" && !bulkTag.trim()) { setError(t("inbox.tagTypeOne")); return; }
    setBusy("bulk"); setError("");
    try {
      const r = await apiFetch<{ results: { id: string; ok: boolean; error?: string }[]; succeeded: number; failed: number }>(
        `/organizations/${orgId}/inbox/conversations/bulk`,
        {
          method: "POST",
          body: JSON.stringify({
            ids: [...selectedIds], action,
            ...(action === "assign" ? { assignedUserId: bulkAssign === "__none__" ? null : bulkAssign } : {}),
            ...(action === "tag-add" ? { tag: bulkTag.trim() } : {}),
          }),
        },
      );
      const failed = r.results.filter((x) => !x.ok);
      setNotice(t("inbox.bulkDoneLine", { ok: fmtNumber(locale, r.succeeded), failed: r.failed ? t("inbox.bulkFailedPart", { n: fmtNumber(locale, r.failed) }) : "" }));
      if (failed.length) {
        setError(t("inbox.failedListLine", { n: fmtNumber(locale, failed.length), list: failed.slice(0, 3).map((x) => x.error ?? x.id).join(" · ") }));
        setSelectedIds(new Set(failed.map((x) => x.id)));
      } else {
        setSelectedIds(new Set());
        if (action === "tag-add") setBulkTag("");
      }
      loadConversations();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  /** IN3: run a macro on the open conversation. The server runs
   * each step through the real action path and reports per-step
   * results — the panel below shows exactly what happened,
   * including where a failed run stopped. */
  async function runMacroOnActive(macro: Macro) {
    const orgId = getOrganizationId(); if (!orgId || !active) return;
    setShowMacroMenu(false); setBusy("macro"); setError(""); setMacroResult(null);
    try {
      const r = await apiFetch<MacroRunResult>(`/organizations/${orgId}/inbox/macros/${macro.id}/run`, {
        method: "POST", body: JSON.stringify({ conversationId: active.id }),
      });
      setMacroResult(r);
      if (r.success) setNotice(formatMacroRunResult(r));
      else setError(formatMacroRunResult(r));
      await refreshActive();
      loadConversations();
      // A reply step may have consumed a quick reply — refresh counts.
      apiFetch<QuickReply[]>(`/organizations/${orgId}/inbox/quick-replies`).then(setQuickReplies).catch(() => undefined);
    } catch (e) { setError(e instanceof Error ? e.message : t("inbox.macroCannotRun")); }
    finally { setBusy(""); }
  }

  /** IN3: build a macro from the builder rows. Conversion keeps
   * only the fields each step type needs; the server validates
   * strictly and its error is shown verbatim. */
  async function createMacroFromBuilder() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const name = macroName.trim();
    if (!name) { setError(t("inbox.macroNeedName")); return; }
    const steps: MacroStep[] = [];
    for (const d of macroDraft) {
      if (d.type === "reply") { if (!d.quickReplyId) { setError(t("inbox.macroNeedQuickReply")); return; } steps.push({ type: "reply", quickReplyId: d.quickReplyId }); }
      else if (d.type === "assign") steps.push({ type: "assign", assignedUserId: d.assignedUserId === "__none__" ? null : d.assignedUserId });
      else if (d.type === "tag") { if (!d.tag.trim()) { setError(t("inbox.macroNeedTag")); return; } steps.push({ type: "tag", tag: d.tag.trim() }); }
      else if (d.type === "pipeline") steps.push({ type: "pipeline", stage: d.stage });
      else if (d.type === "close") steps.push({ type: "close", ...(d.outcome ? { outcome: d.outcome } : {}) });
      else if (d.type === "snooze") steps.push({ type: "snooze", minutes: d.minutes });
    }
    setBusy("macro-create"); setError("");
    try {
      const created = await apiFetch<Macro>(`/organizations/${orgId}/inbox/macros`, {
        method: "POST", body: JSON.stringify({ name, shared: macroShared, steps }),
      });
      setMacros((prev) => [created, ...prev]);
      setMacroName(""); setMacroShared(false); setMacroDraft([emptyMacroStep()]);
      setNotice(t("inbox.macroCreated", { name: created.name }));
    } catch (e) { setError(e instanceof Error ? e.message : t("inbox.macroCreateFailed")); }
    finally { setBusy(""); }
  }

  async function deleteMacroById(macro: Macro) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("macro-delete"); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/inbox/macros/${macro.id}`, { method: "DELETE" });
      setMacros((prev) => prev.filter((m) => m.id !== macro.id));
      setNotice(t("inbox.macroDeleted", { name: macro.name }));
    } catch (e) { setError(e instanceof Error ? e.message : t("inbox.macroDeleteFailed")); }
    finally { setBusy(""); }
  }

  /** IN3c: bulk reply — ONE POST to the bulk-reply endpoint.
   * Failures stay selected with their reasons, like bulk actions;
   * a WhatsApp window-closed item fails on the server before any
   * send and is reported, never dressed as sent. */
  async function runBulkReply(via: "quick" | "template") {
    const orgId = getOrganizationId(); if (!orgId || selectedIds.size === 0) return;
    if (via === "quick" && !bulkQrId) { setError(t("inbox.bulkNeedQuick")); return; }
    if (via === "template" && !bulkTplId) { setError(t("inbox.bulkNeedTemplate")); return; }
    setBusy("bulk-reply"); setError("");
    try {
      const r = await apiFetch<{ results: { id: string; ok: boolean; error?: string }[]; succeeded: number; failed: number }>(
        `/organizations/${orgId}/inbox/conversations/bulk-reply`,
        {
          method: "POST",
          body: JSON.stringify({ ids: [...selectedIds], ...(via === "quick" ? { quickReplyId: bulkQrId } : { templateId: bulkTplId }) }),
        },
      );
      const failed = r.results.filter((x) => !x.ok);
      setNotice(bulkReplySummary(r.succeeded, r.failed));
      if (failed.length) {
        setError(t("inbox.notSentListLine", { n: fmtNumber(locale, failed.length), list: failed.slice(0, 3).map((x) => x.error ?? x.id).join(" · ") }));
        setSelectedIds(new Set(failed.map((x) => x.id)));
      } else {
        setSelectedIds(new Set());
      }
      loadConversations();
    } catch (e) { setError(e instanceof Error ? e.message : t("inbox.bulkReplyFailed")); }
    finally { setBusy(""); }
  }

  /** P2 courier widget: manual sync through the existing courier
   * endpoint; provider errors surface verbatim. */
  async function syncShipment(shipmentId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`sync:${shipmentId}`); setError("");
    try {
      const r = await apiFetch<any>(`/organizations/${orgId}/courier/shipments/${shipmentId}/sync`, { method: "POST" });
      setNotice(t("inbox.courierUpdated", { status: r.status ?? "" }));
      await refreshActive();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  /** IN1a: search INSIDE messages via the API; results are real
   * rows from this org only (the server scopes them). */
  async function runMessageSearch() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const q = msgQ.trim();
    if (q.length < 2) { setError(t("inbox.searchMinChars")); return; }
    setMsgBusy(true); setError("");
    try {
      const r = await apiFetch<{ query: string; results: MessageSearchResult[] }>(`/organizations/${orgId}/inbox/messages/search?q=${encodeURIComponent(q)}&limit=30`);
      setMsgResults(r.results);
    } catch (e) { setError(e instanceof Error ? e.message : t("inbox.searchFailed")); setMsgResults(null); }
    finally { setMsgBusy(false); }
  }

  /** IN1a: open the hit's conversation and scroll to the message.
   * The thread loads the newest 100 messages — an older hit is
   * reported honestly instead of pretending the jump worked. */
  async function openSearchResult(hit: MessageSearchResult) {
    setMsgResults(null);
    await openConversation({ id: hit.conversationId } as Conversation, hit.messageId);
  }

  /** IN1c: apply a saved view — its stored filters replace the
   * current ones (folder included), exactly like re-typing them. */
  function applySavedView(view: SavedView) {
    const { filters: next, folder } = savedToUiFilters(view.filters);
    setVisibleCount(40); setFocusedIdx(0);
    setSmartFolder(folder as "" | "sla" | "vip" | "handover" | "snoozed");
    setFilters(next);
    setNotice(t("inbox.viewOn", { name: view.name }));
    loadConversations(next, folder);
  }

  async function saveCurrentView() {
    const orgId = getOrganizationId(); if (!orgId) return;
    const name = saveViewName.trim();
    if (!name) { setError(t("inbox.viewNeedName")); return; }
    setBusy("save-view"); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/inbox/saved-views`, {
        method: "POST",
        body: JSON.stringify({ name, shared: saveViewShared, filters: uiFiltersToSaved(filters, smartFolder) }),
      });
      setSaveViewOpen(false); setSaveViewName(""); setSaveViewShared(false);
      setNotice(t("inbox.viewSaved", { name }) + (saveViewShared ? t("inbox.viewSavedSharedSuffix") : ""));
      loadSavedViews();
    } catch (e) { setError(e instanceof Error ? e.message : t("inbox.viewSaveFailed")); }
    finally { setBusy(""); }
  }

  async function deleteSavedView(view: SavedView) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/inbox/saved-views/${view.id}`, { method: "DELETE" });
      setNotice(t("inbox.viewDeleted", { name: view.name }));
      loadSavedViews();
    } catch (e) { setError(e instanceof Error ? e.message : t("inbox.viewDeleteFailed")); }
  }

  async function openConversation(conv: Conversation, focusMessageId?: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError("");
    // P3: ghost / tone state never carries across conversations.
    setGhost(""); ghostForRef.current = ""; ghostLastFetchRef.current = "";
    ghostAbortRef.current?.abort();
    setPrevReply(null); setShowToneMenu(false); setComposerMode("reply");
    try {
      const res = await apiFetch<{ conversation: Conversation; messages: Message[]; drafts: Draft[]; pinnedMessages?: PinnedMessage[]; context: ContextData; botSession?: { id: string; state: string; status: string } | null }>(`/organizations/${orgId}/inbox/conversations/${conv.id}`);
      setActive(res.conversation); setMessages(res.messages); setDrafts(res.drafts); setPinnedMessages(res.pinnedMessages ?? []); setQuoteTarget(null); setReactionFor(null); setNextAction(null); setContext(res.context); setBotSession(res.botSession ?? null);
      // IN9d: restore THIS conversation's composer draft ("" when
      // none). The owner ref is set first so the save effect can
      // never write the restored text under another conversation.
      replyOwnerRef.current = res.conversation.id;
      setReply(loadComposerDraft(getDraftStorage(), res.conversation.id));
      apiFetch<any>(`/organizations/${orgId}/inbox/conversations/${conv.id}/command-profile`).then(setProfile).catch(() => setProfile(null));
      setNotes(await apiFetch<Note[]>(`/organizations/${orgId}/inbox/conversations/${conv.id}/notes`).catch(() => []));
      setVerifications(await apiFetch<PaymentVerification[]>(`/organizations/${orgId}/inbox/conversations/${conv.id}/payment-verifications`).catch(() => []));
      setMobileChat(true);
      // IN1a: a search jump highlights + scrolls to the message —
      // but only when it is inside the loaded newest-100 window;
      // otherwise the agent is told plainly (no fake jump).
      if (focusMessageId) {
        if (res.messages.some((m) => m.id === focusMessageId)) {
          setHighlightMsgId(focusMessageId);
          setTimeout(() => {
            document.getElementById(`msg-${focusMessageId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
          }, 180);
        } else {
          setHighlightMsgId(null);
          setNotice(t("inbox.convOpenedOld"));
        }
      } else {
        setHighlightMsgId(null);
      }
      setMobileTab("chat");
      if (conv.unreadCount > 0) {
        await apiFetch(`/organizations/${orgId}/inbox/conversations/${conv.id}/read`, { method: "POST" });
        loadConversations();
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  async function refreshActive() { if (active) await openConversation(active); }

  /** IN2: merge a duplicate customer INTO this conversation's
   * customer (agent-confirmed, reversible). The API moves the
   * rows and writes the undo record; here we only confirm + act. */
  async function mergeDuplicate(sourceCustomerId: string, sourceLabel: string) {
    const orgId = getOrganizationId(); if (!orgId || !active || !context?.identity?.customerId) return;
    if (!window.confirm(t("inbox.mergeConfirm", { label: sourceLabel }))) return;
    setBusy("identity"); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/inbox/conversations/${active.id}/merge-customer`, {
        method: "POST", body: JSON.stringify({ sourceCustomerId, targetCustomerId: context.identity.customerId }),
      });
      setNotice(t("inbox.mergeDone"));
      await refreshActive();
    } catch (e) { setError(e instanceof Error ? e.message : t("inbox.mergeFailed")); }
    finally { setBusy(""); }
  }

  /** IN2: link THIS unlinked conversation to an existing
   * customer (used when the thread has no customer yet but a
   * duplicate candidate was found by phone/email). */
  async function linkToCustomer(customerId: string, label: string) {
    const orgId = getOrganizationId(); if (!orgId || !active) return;
    if (!window.confirm(t("inbox.linkConfirm", { label }))) return;
    setBusy("identity"); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/inbox/conversations/${active.id}/link-customer`, {
        method: "POST", body: JSON.stringify({ customerId }),
      });
      setNotice(t("inbox.linkDone"));
      await refreshActive();
    } catch (e) { setError(e instanceof Error ? e.message : t("inbox.linkFailed")); }
    finally { setBusy(""); }
  }

  /** IN2: undo a recorded merge from the survivor's panel. */
  async function unmergeCustomer(sourceCustomerId: string, sourceLabel: string) {
    const orgId = getOrganizationId(); if (!orgId || !active) return;
    if (!window.confirm(t("inbox.unmergeConfirm", { label: sourceLabel }))) return;
    setBusy("identity"); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/inbox/conversations/${active.id}/unmerge-customer`, {
        method: "POST", body: JSON.stringify({ sourceCustomerId }),
      });
      setNotice(t("inbox.unmergeDone"));
      await refreshActive();
    } catch (e) { setError(e instanceof Error ? e.message : t("inbox.unmergeFailed")); }
    finally { setBusy(""); }
  }

  /** IN10a: block/unblock — OUR system only. Future messages
   * land in the Spam queue and no bot/AI runs for the thread. */
  async function setBlocked(blocked: boolean) {
    const orgId = getOrganizationId(); if (!orgId || !active) return;
    if (blocked && !window.confirm(t("inbox.blockConfirm"))) return;
    setBusy("block"); setError("");
    try {
      const updated = await apiFetch<Conversation>(`/organizations/${orgId}/inbox/conversations/${active.id}/block`, {
        method: "POST", body: JSON.stringify({ blocked, reason: blocked ? blockReason.trim() || undefined : undefined }),
      });
      setActive((a) => (a ? { ...a, ...updated } : a));
      setBlockReason("");
      setNotice(blocked ? t("inbox.blockDone") : t("inbox.unblockDone"));
      void loadConversations();
    } catch (e) { setError(e instanceof Error ? e.message : t("inbox.blockFailed")); }
    finally { setBusy(""); }
  }

  /** IN10c: load Analytics v2 for the manage view. */
  async function loadAnalytics(days: number) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setAnalyticsDays(days); setBusy("analytics");
    try { setAnalytics(await apiFetch<InboxAnalytics>(`/organizations/${orgId}/inbox/analytics?days=${days}`)); }
    catch (e) { setError(e instanceof Error ? e.message : t("inbox.analyticsLoadFailed")); }
    finally { setBusy(""); }
  }

  /** IN6d/6b: scroll + highlight a message in the open thread
   * (same mechanism the IN1 search jump uses). */
  function jumpToMessage(id: string) {
    if (!messagesRef.current.some((m) => m.id === id)) {
      setNotice(t("inbox.msgNotInRecent"));
      return;
    }
    setHighlightMsgId(id);
    setTimeout(() => {
      document.getElementById(`msg-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 60);
  }

  /** IN6d: pin/unpin — server is org-scoped + audited; the list
   * refreshes from the server response, never local invention. */
  async function togglePin(m: Message) {
    const orgId = getOrganizationId(); if (!orgId || !active) return;
    try {
      await apiFetch(`/organizations/${orgId}/inbox/conversations/${active.id}/messages/${m.id}/pin`, { method: "POST", body: JSON.stringify({ pinned: !m.pinnedAt }) });
      await refreshActive();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  /** IN6c: agent reaction — offered only on Messenger/Instagram
   * (canSendReaction); the API confirms with Meta BEFORE storing,
   * so a failure here is Meta's verbatim refusal, shown as-is. */
  async function sendReaction(m: Message, emoji: string | null) {
    const orgId = getOrganizationId(); if (!orgId || !active) return;
    setReactionFor(null);
    try {
      await apiFetch(`/organizations/${orgId}/inbox/conversations/${active.id}/messages/${m.id}/react`, { method: "POST", body: JSON.stringify({ emoji }) });
      await refreshActive();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  async function patchConversation(patch: Partial<Conversation> & { assignForMinutes?: number }) {
    const orgId = getOrganizationId(); if (!orgId || !active) return;
    try {
      const updated = await apiFetch<Conversation>(`/organizations/${orgId}/inbox/conversations/${active.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      setActive({ ...active, ...updated });
      loadConversations();
      // IN7a: an assignee change is a handover — the API reports
      // the AI summary outcome separately; surface it honestly
      // and refresh so the summary note shows in the timeline.
      const hsNote = handoverSummaryNotice((updated as any).handoverSummary, locale);
      if (hsNote) { setNotice(hsNote); void refreshActive(); }
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  /** CX5: action-bar POST actions (snooze / unsnooze / take-over /
   * back-to-ai) — merge the returned row into `active` and reload
   * the list (a snoozed row leaves the current list view). */
  async function conversationAction(action: "snooze" | "unsnooze" | "take-over" | "back-to-ai", body?: unknown) {
    const orgId = getOrganizationId(); if (!orgId || !active) return;
    try {
      const updated = await apiFetch<Conversation>(`/organizations/${orgId}/inbox/conversations/${active.id}/${action}`, {
        method: "POST", ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      setActive({ ...active, ...updated });
      loadConversations();
      // IN7a: take-over carries the handover-summary outcome.
      if (action === "take-over") {
        const hsNote = handoverSummaryNotice((updated as any).handoverSummary, locale);
        if (hsNote) { setNotice(hsNote); void refreshActive(); }
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  async function snoozeWith(body: { minutes: number } | { until: string } | null) {
    if (!body) { setError(t("inbox.snoozeTimeInvalid")); return; }
    setShowSnoozeMenu(false); setShowMoreMenu(false);
    await conversationAction("snooze", body);
    setNotice(t("inbox.snoozedNotice"));
  }

  // CX5: action-bar segment renderers (snooze / timer menus).
  const cx5Btn = "rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium transition hover:bg-slate-200";
  const cx5Menu = "absolute left-0 top-full z-20 mt-1 flex w-64 flex-col gap-1 rounded-xl border bg-white p-1.5 shadow-lg";
  const cx5MenuItem = "rounded-lg px-2 py-1.5 text-left text-xs font-semibold hover:bg-slate-100 disabled:opacity-50";
  const timerRemaining = active?.assignmentKind === "timed" && active?.assignedUntil
    ? Math.max(0, Math.ceil((new Date(active.assignedUntil).getTime() - handoverTick) / 60000)) : null;
  const renderAssignSelect = () => (
    <select className="rounded-lg bg-white px-2 py-1.5 font-medium ring-1 ring-inset ring-slate-200" value={active?.assignedUserId ?? ""}
      onChange={(e) => { setShowMoreMenu(false); void patchConversation({ assignedUserId: e.target.value || null }); }} title="Assign" aria-label={t("inbox.assignBtn")}>
      <option value="">{t("inbox.nobody")}</option>
      {members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.name ?? m.user.email} ({m.role})</option>)}
    </select>
  );
  const renderLeadSelect = () => (
    <select className="rounded-lg bg-white px-2 py-1.5 font-medium ring-1 ring-inset ring-slate-200" value={active?.pipelineStage ?? "new"}
      onChange={(e) => { setShowMoreMenu(false); void patchConversation({ pipelineStage: e.target.value }); }} title="Pipeline Stage" aria-label="Lead Stage">
      <option value="new">🎯 🆕 New Lead</option><option value="talking">🎯 💬 Talking</option>
      <option value="ordered">🎯 🛒 Ordered</option><option value="delivered">🎯 ✅ Delivered</option><option value="repeat">🎯 🔁 Repeat</option>
    </select>
  );


  const renderSnoozeControls = () => (
    <>
      {snoozePresets(locale).map((p) => (
        <button key={p.minutes} className={cx5MenuItem} onClick={() => void snoozeWith(snoozeBodyForMinutes(p.minutes))}>{p.label} {t("inbox.snoozeLaterSuffix")}</button>
      ))}
      <span className="mt-1 flex items-center gap-1 border-t border-slate-100 pt-1.5">
        <input type="datetime-local" className="input !w-auto min-w-0 flex-1 !py-1 !text-xs" value={snoozeCustom} onChange={(e) => setSnoozeCustom(e.target.value)} aria-label={t("inbox.customSnoozeTime")} />
        <button className="btn-primary btn-sm shrink-0" onClick={() => void snoozeWith(snoozeBodyForCustom(snoozeCustom))}>{t("inbox.snoozeDoBtn")}</button>
      </span>
      <span className="px-1 pt-1 text-[10px] leading-snug text-slate-400">{t("inbox.snoozeAiNote")}</span>
    </>
  );
  const renderTimerControls = () => (
    <>
      {timerRemaining !== null ? <span className="px-2 py-1 text-[11px] font-semibold text-indigo-600">{t("inbox.timerLeft", { n: fmtNumber(locale, timerRemaining) })}</span> : null}
      {([15, 30, 60, 120, 240] as const).map((n) => (
        <button key={n} className={cx5MenuItem} disabled={!myId} onClick={() => { setShowTimerMenu(false); setShowMoreMenu(false); void patchConversation({ assignedUserId: myId, assignForMinutes: n }); }}>{t("inbox.inbZAssignToMeFor", { minutes: fmtNumber(locale, n) })}</button>
      ))}
      {timerRemaining !== null ? (
        <button className="rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-red-600 hover:bg-red-50" onClick={() => { setShowTimerMenu(false); setShowMoreMenu(false); if (active) void patchConversation({ assignedUserId: active.assignedUserId }); }}>{t("inbox.inbZCancelTimer")}</button>
      ) : null}
    </>
  );

  async function shareTracking() {
    const orgId = getOrganizationId(); if (!orgId || !active) return;
    setBusy("track");
    try {
      const r = await apiFetch<any>(`/organizations/${orgId}/inbox/conversations/${active.id}/share-tracking`, { method: "POST" });
      setNotice(t("inbox.trackingSent", { code: r.trackingCode }));
      await refreshActive();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  async function bookCourier() {
    const orgId = getOrganizationId(); if (!orgId || !active) return;
    const order = context?.orders?.[0];
    if (!order) { setError(t("inbox.courierNeedOrder")); return; }
    setBusy("courier");
    try {
      const conns = await apiFetch<any[]>(`/organizations/${orgId}/courier/connections`).catch(() => []);
      const provider = (conns as any[])?.find((c: any) => c.status === "CONNECTED")?.provider;
      if (!provider) { setError(t("inbox.courierNoneConnected")); return; }
      const address = (order as any).address || window.prompt(t("inbox.deliveryAddressPrompt")) || "";
      if (!address) return;
      const r = await apiFetch<any>(`/organizations/${orgId}/courier/shipments`, { method: "POST", body: JSON.stringify({ orderId: order.id, provider, recipientAddress: address }) });
      setNotice(t("inbox.courierBooked", { provider, code: r.trackingCode ?? "" }));
      await refreshActive();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  async function requestRefund() {
    const orgId = getOrganizationId(); if (!orgId || !active) return;
    const reason = window.prompt(t("inbox.refundReasonPrompt")) ?? "";
    setBusy("refund");
    try {
      await apiFetch(`/organizations/${orgId}/inbox/conversations/${active.id}/refund-request`, { method: "POST", body: JSON.stringify({ reason }) });
      setNotice(t("inbox.refundSent"));
      await refreshActive();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  async function exportCsv() {
    const orgId = getOrganizationId(); if (!orgId || !active) return;
    try {
      const token = localStorage.getItem("accessToken");
      const base = (window as any).location.origin;
      const res = await fetch(`${base}/backend/organizations/${orgId}/inbox/conversations/${active.id}/export?format=csv`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(t("inbox.exportFailed"));
      const blob = await res.blob();
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `conversation-${active.id}.csv`; a.click(); URL.revokeObjectURL(a.href);
    } catch (e) { setError(e instanceof Error ? e.message : t("inbox.exportFailed")); }
  }

  function markSpam() {
    if (window.confirm(t("inbox.spamConfirm"))) {
      void patchConversation({ spamFlag: true, status: "closed", outcome: "spam" });
    }
  }

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("connect"); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/inbox/connect`, { method: "POST", body: JSON.stringify(connectForm) });
      setNotice(t("inbox.connectedOk"));
      loadConversations();
    } catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
    finally { setBusy(""); }
  }

  async function sendReply() {
    // P3 structural safety: this customer-send path is unreachable
    // in note mode — the composer send button / Enter dispatch to
    // addNote() there, and this guard is the belt-and-braces check.
    if (composerMode === "note") return;
    const orgId = getOrganizationId(); if (!orgId || !active || !reply.trim()) return;
    const convId = active.id;
    const content = reply;
    // CX11ac: attribution snapshot for THIS send (the flags are
    // reset only on success).
    const sendAiAssisted = aiAssistUsed;
    const sendQuickReplyId = usedQuickReplyId;
    // UX1 Q5: instant local pending bubble. It is labelled
    // t("inbox.sending") (status "sending") and only ever replaced by
    // the server's real message row — it never poses as sent. The
    // composer clears immediately; the BUBBLE keeps the content, so
    // a failure is retried from the bubble, not re-typed.
    const tempId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // IN6b: the quote target rides this send; the pending bubble
    // shows the same quoted snippet the thread will show.
    const sendQuote = quoteTarget;
    const temp: Message = { id: tempId, direction: "out", content, type: "text", status: "sending", createdAt: new Date().toISOString(), sentByAiDraft: false, replyToMessageId: sendQuote?.id ?? null, quote: sendQuote ? { id: sendQuote.id, direction: sendQuote.direction, snippet: String(sendQuote.content ?? `[${sendQuote.type}]`).slice(0, 140) } : null };
    setMessages((m) => [...m, temp]);
    setReply(""); setGhost(""); ghostForRef.current = ""; ghostLastFetchRef.current = "";
    setBusy("send"); setError("");
    try {
      const msg = await apiFetch<Message>(`/organizations/${orgId}/inbox/conversations/${convId}/messages`, { method: "POST", body: JSON.stringify({ content, aiAssisted: sendAiAssisted || undefined, quickReplyId: sendQuickReplyId ?? undefined, replyToMessageId: sendQuote?.id ?? undefined }) });
      setQuoteTarget(null);
      setAiAssistUsed(false); setUsedQuickReplyId(null);
      setMessages((prev) => {
        // The realtime stream may have delivered the real row first.
        if (prev.some((m) => m.id === msg.id)) return prev.filter((m) => m.id !== tempId);
        return prev.map((m) => (m.id === tempId ? msg : m));
      });
      loadConversations();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  async function retryLocalSend(tempId: string) {
    const orgId = getOrganizationId(); if (!orgId || !active) return;
    const local = messagesRef.current.find((m) => m.id === tempId);
    if (!local?.content || local.status !== "failed") return;
    const convId = active.id;
    setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, status: "sending" } : m)));
    setError("");
    try {
      const msg = await apiFetch<Message>(`/organizations/${orgId}/inbox/conversations/${convId}/messages`, { method: "POST", body: JSON.stringify({ content: local.content }) });
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev.filter((m) => m.id !== tempId);
        return prev.map((m) => (m.id === tempId ? msg : m));
      });
      loadConversations();
    } catch (e) {
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, status: "failed" } : m)));
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  async function sendImage() {
    const orgId = getOrganizationId(); if (!orgId || !active || !imageForm.url.trim()) return;
    setBusy("image"); setError("");
    try {
      const msg = await apiFetch<Message>(`/organizations/${orgId}/inbox/conversations/${active.id}/messages/image`, { method: "POST", body: JSON.stringify({ imageUrl: imageForm.url.trim(), caption: imageForm.caption || undefined }) });
      setMessages((m) => [...m, msg]); setImageForm({ url: "", caption: "" }); setShowImage(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  // ----- Inbox Next-Gen P1: uploads (drag-drop / paste / picker / voice) -----
  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => { const s = String(reader.result ?? ""); resolve(s.slice(s.indexOf(",") + 1)); };
      reader.onerror = () => reject(new Error(t("inbox.fileUnreadable")));
      reader.readAsDataURL(file);
    });
  }

  /** Sends files through the API media-upload flow. A file counts
   * as sent only when the API returns the message row — the
   * platform's own error (wrong container, missing integration…)
   * shows verbatim, exactly like the URL image send. When exactly
   * one file is sent, the composer's current text rides along as
   * its caption. */
  async function sendMediaFiles(files: File[]) {
    // P3 structural safety: no media-to-customer path in note mode.
    if (composerMode === "note") return;
    const orgId = getOrganizationId(); if (!orgId || !active || files.length === 0) return;
    for (const file of files) {
      if (file.size > MEDIA_UPLOAD_MAX_BYTES) {
        setError(t("inbox.fileTooBig", { name: file.name, size: (file.size / 1048576).toFixed(1) }));
        continue;
      }
      setBusy("media"); setError("");
      try {
        const dataBase64 = await fileToBase64(file);
        const caption = files.length === 1 && reply.trim() ? reply.trim() : undefined;
        const msg = await apiFetch<Message>(`/organizations/${orgId}/inbox/conversations/${active.id}/messages/media`, {
          method: "POST",
          body: JSON.stringify({ dataBase64, fileName: file.name, contentType: file.type || undefined, caption }),
        });
        setMessages((m) => [...m, msg]);
        if (caption) setReply("");
        loadConversations();
      } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
      finally { setBusy(""); }
    }
  }

  function focusComposer(selectionStart?: number, selectionEnd?: number) {
    requestAnimationFrame(() => {
      const ta = replyRef.current;
      if (!ta) return;
      ta.focus();
      if (selectionStart != null) ta.setSelectionRange(selectionStart, selectionEnd ?? selectionStart);
    });
  }

  /** Insert text (emoji, canned snippet) at the composer's caret. */
  function insertIntoReply(insert: string) {
    const ta = replyRef.current;
    const start = ta?.selectionStart ?? reply.length;
    const end = ta?.selectionEnd ?? reply.length;
    const r = insertAtCursor(reply, start, end, insert);
    setReply(r.text); setIAmTyping(r.text.length > 0);
    focusComposer(r.selectionStart, r.selectionEnd);
  }

  /** WhatsApp-marker formatting helpers (composer shows these only
   * on whatsapp — the one channel that renders the markers). */
  function applyFormat(kind: "bold" | "italic" | "list") {
    const ta = replyRef.current; if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const r = kind === "list" ? toggleBulletLines(reply, start, end) : wrapSelection(reply, start, end, kind === "bold" ? "*" : "_");
    setReply(r.text); setIAmTyping(r.text.length > 0);
    focusComposer(r.selectionStart, r.selectionEnd);
  }

  /** Pane splitter drag (desktop): pointer capture on the handle,
   * widths persisted on release. Double-click resets (handled in
   * the handle's onDoubleClick). */
  function startResize(e: React.PointerEvent, which: "list" | "ctx") {
    e.preventDefault();
    const startX = e.clientX;
    const startW = which === "list" ? listW : ctxW;
    const min = which === "list" ? 230 : 260;
    let lastDelta = 0;
    const onMove = (ev: PointerEvent) => {
      lastDelta = ev.clientX - startX;
      if (which === "list") setListW(clampPane(startW + lastDelta, min, 520));
      else setCtxW(clampPane(startW - lastDelta, min, 520));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      try {
        localStorage.setItem(which === "list" ? "inbox.listW" : "inbox.ctxW", String(which === "list" ? clampPane(startW + lastDelta, min, 520) : clampPane(startW - lastDelta, min, 520)));
      } catch { /* storage is best-effort */ }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // Keep the thread pinned to the newest message: always on open /
  // own send, otherwise only when the agent is already near the
  // bottom (reading history is never yanked away).
  useEffect(() => {
    const el = threadScrollRef.current; if (!el) return;
    const last = messages[messages.length - 1];
    if (openConvRef.current !== active?.id) {
      openConvRef.current = active?.id ?? null;
      lastMsgIdRef.current = null;
    }
    if (!last) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 280;
    if (lastMsgIdRef.current === null || last.direction === "out" || nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
    lastMsgIdRef.current = last.id;
  }, [messages, active?.id]);

  async function createChatOrder() {
    const orgId = getOrganizationId(); if (!orgId || !active) return;
    if (orderItems.length === 0) { setError(t("inbox.addOneProduct")); return; }
    setBusy("order"); setError("");
    try {
      const order = await apiFetch<any>(`/organizations/${orgId}/inbox/conversations/${active.id}/orders`, {
        method: "POST",
        body: JSON.stringify({ items: orderItems, shippingMinor: Math.round((Number(orderShip) || 0) * 100), isCod: orderCod, address: orderAddress || undefined }),
      });
      if (order.storeSyncStatus === "synced") setNotice(t("inbox.orderCreatedWoo", { num: order.externalNumber }));
      else if (order.storeSyncStatus === "failed") setNotice(t("inbox.orderCreatedLocalFailed", { err: order.storeSyncError ?? "" }));
      else setNotice(t("inbox.orderCreatedLocal", { num: order.externalNumber }));
      // M50: merchant-side return-risk warning (never shown to the customer).
      if (order.risk && (order.risk.band === "high" || order.risk.band === "medium")) {
        setError(t("inbox.inbZReturnRisk", { band: order.risk.band === "high" ? t("inbox.riskHighWord") : t("inbox.riskMediumWord"), scorePart: order.risk.score != null ? t("inbox.inbZScorePart", { score: fmtNumber(locale, order.risk.score) }) : "", reason: order.risk.reasons?.[0] ?? "", suggestion: order.risk.suggestion ?? "" }));
      }
      setOrderOpen(false); setOrderItems([]);
      await refreshActive();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  async function translateMsg(m: Message) {
    const orgId = getOrganizationId(); if (!orgId || !active || !m.content) return;
    const target = /[\u0980-\u09FF]/.test(m.content) ? "en" : "bn";
    setBusy("translate"); setError("");
    try {
      const out = await apiFetch<any>(`/organizations/${orgId}/inbox/conversations/${active.id}/messages/${m.id}/translate`, { method: "POST", body: JSON.stringify({ target }) });
      setTranslations((prev) => ({ ...prev, [m.id]: out.translatedText }));
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  async function summarize() {
    const orgId = getOrganizationId(); if (!orgId || !active) return;
    setBusy("summary"); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/inbox/conversations/${active.id}/summary`, { method: "POST" });
      await refreshActive();
      setNotice(t("inbox.summaryCreated"));
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  /** IN7b: fetch the AI next-action proposal for the open
   * thread. The endpoint is suggestion-only — fetching it sends
   * nothing and changes nothing. */
  async function loadNextAction() {
    const orgId = getOrganizationId(); if (!orgId || !active) return;
    setBusy("next-action"); setError("");
    try {
      const res = await apiFetch<NextActionResponse>(`/organizations/${orgId}/inbox/conversations/${active.id}/next-action`, { method: "POST" });
      setNextAction(res);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  /** IN7b: run the proposed action through its EXISTING path —
   * the same handlers the toolbar/panels already use. Only ever
   * runs on an explicit click; wait_customer has no run. */
  async function runNextAction() {
    const orgId = getOrganizationId(); if (!orgId || !active || !nextAction?.proposal) return;
    const action = nextAction.proposal.action;
    if (action === "share_tracking") {
      setBusy("track"); setError("");
      try { const r = await apiFetch<any>(`/organizations/${orgId}/inbox/conversations/${active.id}/share-tracking`, { method: "POST" }); setNotice(t("inbox.trackingSent", { code: r.trackingCode })); await refreshActive(); }
      catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setBusy(""); }
    } else if (action === "cod_confirm") {
      const order = (context?.orders ?? []).find((o) => o.isCod && o.codConfirmationStatus !== "awaiting" && o.codConfirmationStatus !== "confirmed");
      if (!order) { setError(t("inbox.noCodOrder")); return; }
      await requestCod(order.id);
    } else if (action === "create_order") {
      setOrderOpen(true);
      setNotice(t("inbox.orderPanelOpened"));
    } else if (action === "reply_manually") {
      replyRef.current?.focus();
    } else if (action === "resolve") {
      await patchConversation({ status: "closed" });
    }
  }

  /** IN7c: accept the tag/stage proposal — applied ONLY here, on
   * this click, through the normal updateConversation path. */
  async function acceptNextActionProposal() {
    if (!active || !nextAction?.proposal) return;
    const patch = proposalAcceptPatch(nextAction.proposal, active.tags ?? []);
    if (!patch) { setNotice(t("inbox.noProposal")); return; }
    await patchConversation(patch);
    setNextAction(null);
    setNotice(t("inbox.proposalApplied"));
  }

  function insertProductSnippet(prod: { name: string; priceMinor: string; currency: string; stockQuantity?: number | null }) {
    const price = money(prod.priceMinor, prod.currency, locale);
    const stock = prod.stockQuantity == null ? "" : prod.stockQuantity > 0 ? t("inbox.inbZStockPart", { count: fmtNumber(locale, prod.stockQuantity) }) : t("inbox.inbZStockOut");
    setReply((prev) => `${prev}${prev && !prev.endsWith(" ") ? " " : ""}${t("inbox.inbZProductSnippet", { name: prod.name, price, stock })}`);
    setShowPicker(false);
  }

  /** P2 product showcase card: sends the product's REAL image with
   * the composed card caption via the product endpoint. The notice
   * states what was ACTUALLY sent (image+caption vs image vs text
   * fallback) — from the server's own `sentAs`, never assumed. The
   * current composer text rides along as the agent caption. */
  async function sendProductCard(prod: { id: string; name: string; priceMinor: string; currency: string; stockQuantity?: number | null }) {
    const orgId = getOrganizationId(); if (!orgId || !active) return;
    setBusy("product-card"); setError("");
    try {
      const caption = reply.trim();
      const r = await apiFetch<{ sentAs: string; message: Message; captionMessage?: Message; captionDelivered?: boolean }>(
        `/organizations/${orgId}/inbox/conversations/${active.id}/messages/product`,
        { method: "POST", body: JSON.stringify({ productId: prod.id, ...(caption ? { caption } : {}) }) },
      );
      setMessages((prev) => [...prev, r.message, ...(r.captionMessage ? [r.captionMessage] : [])]);
      if (caption) setReply("");
      setShowPicker(false);
      setNotice(
        r.sentAs === "text" ? t("inbox.imgSendFailedText") :
        r.captionDelivered === false ? t("inbox.captionSendFailed") :
        t("inbox.productCardSent"),
      );
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  async function sendTemplate() {
    const orgId = getOrganizationId(); if (!orgId || !active || !tplId) return;
    setBusy("template"); setError("");
    try {
      const variables = tplVars.split(",").map((v) => v.trim()).filter(Boolean);
      const msg = await apiFetch<Message>(`/organizations/${orgId}/inbox/conversations/${active.id}/send-template`, { method: "POST", body: JSON.stringify({ templateId: tplId, variables }) });
      setMessages((m) => [...m, msg]); setTplVars("");
      setNotice(t("inbox.templateSentMeta"));
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  async function suggestDraft() {
    const orgId = getOrganizationId(); if (!orgId || !active) return;
    setBusy("draft"); setError("");
    try {
      const draft = await apiFetch<Draft>(`/organizations/${orgId}/inbox/conversations/${active.id}/drafts/suggest`, { method: "POST", body: JSON.stringify({}) });
      setDrafts((d) => [draft, ...d]);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  async function sendDraft(draft: Draft) {
    const orgId = getOrganizationId(); if (!orgId || !active) return;
    setBusy("draft-send"); setError("");
    try {
      const msg = await apiFetch<Message>(`/organizations/${orgId}/inbox/conversations/${active.id}/drafts/${draft.id}/send`, { method: "POST", body: JSON.stringify({}) });
      setMessages((m) => [...m, msg]);
      setDrafts((d) => d.filter((x) => x.id !== draft.id));
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  async function dismissDraft(draftId: string) {
    const orgId = getOrganizationId(); if (!orgId || !active) return;
    await apiFetch(`/organizations/${orgId}/inbox/conversations/${active.id}/drafts/${draftId}/dismiss`, { method: "POST" });
    setDrafts((d) => d.filter((x) => x.id !== draftId));
  }

  /** P3: internal note from the composer (note mode). Sources its
   * text from the shared composer state and ONLY ever calls the
   * notes endpoint — no message/media/draft-send path exists here. */
  async function addNote() {
    const orgId = getOrganizationId(); if (!orgId || !active || !reply.trim()) return;
    setBusy("note"); setError("");
    try {
      const note = await apiFetch<Note>(`/organizations/${orgId}/inbox/conversations/${active.id}/notes`, { method: "POST", body: JSON.stringify({ content: reply, maskSensitive: noteMask }) });
      setNotes((n) => [...n, note]); setReply(""); setIAmTyping(false); setNoteMask(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  /** P3: tone rewriter (reply mode only). On success the rewritten
   * text replaces the composer text and the previous text is kept
   * for a one-click undo until the next manual edit. API errors
   * surface verbatim via setError. */
  async function applyTone(tone: "polite" | "professional" | "sales") {
    const orgId = getOrganizationId(); if (!orgId || !active || !reply.trim() || busy !== "") return;
    const before = reply;
    setBusy("tone"); setError("");
    try {
      const r = await apiFetch<{ text: string }>(`/organizations/${orgId}/inbox/conversations/${active.id}/tone-rewrite`, {
        method: "POST",
        body: JSON.stringify({ text: before, tone }),
      });
      setPrevReply(before);
      setReply(r.text);
      setGhost(""); ghostForRef.current = "";
      setShowToneMenu(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  async function addQr(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const qr = await apiFetch<QuickReply>(`/organizations/${orgId}/inbox/quick-replies`, { method: "POST", body: JSON.stringify(qrForm) });
      setQuickReplies((q) => [...q, qr]); setQrForm({ title: "", content: "" });
    } catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
  }
  async function deleteQr(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await apiFetch(`/organizations/${orgId}/inbox/quick-replies/${id}`, { method: "DELETE" });
    setQuickReplies((q) => q.filter((x) => x.id !== id));
  }
  async function addTpl(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const t = await apiFetch<WaTemplate>(`/organizations/${orgId}/inbox/whatsapp-templates`, { method: "POST", body: JSON.stringify(tplForm) });
      setTemplates((x) => [...x, t]); if (!tplId) setTplId(t.id);
      setTplForm({ name: "", language: "bn", category: "UTILITY", bodyText: "" });
    } catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
  }
  async function deleteTpl(id: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await apiFetch(`/organizations/${orgId}/inbox/whatsapp-templates/${id}`, { method: "DELETE" });
    setTemplates((x) => x.filter((t) => t.id !== id));
  }

  const inputCls = "input mt-1";
  const statusIcon = (m: Message) => {
    if (m.direction === "in") return "";
    if (m.status === "sending") return t("inbox.statusSending");
    if (m.status === "failed") return t("inbox.statusFailed");
    // IN6a: on Meta channels + webchat the tick comes ONLY from
    // the platform-confirmed deliveryStatus — no status, no tick.
    // (Telegram/Email have no confirmed source: nothing shown.)
    if (["whatsapp", "messenger", "instagram", "webchat"].includes(active?.channel ?? "")) {
      const tick = deliveryTick(active?.channel, m, locale);
      if (!tick) return "";
      return ` · ${tick.glyph ? `${tick.glyph} ` : ""}${tick.label}`;
    }
    return t("inbox.statusSent");
  };
  const memberName = (userId?: string | null) => {
    const m = members.find((x) => x.user.id === userId);
    return m ? (m.user.name ?? m.user.email) : userId ? t("inbox.teamMember") : t("inbox.nobodyPlain");
  };
  const windowLeft = (w?: WaWindow | null): string => {
    if (!w?.expiresAt) return "";
    const ms = new Date(w.expiresAt).getTime() - Date.now();
    if (ms <= 0) return "";
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return t("inbox.ghontaMin", { h: fmtNumber(locale, h), m: fmtNumber(locale, m) });
  };
  const quickMatches = showQuick
    ? quickReplies.filter((q) => !reply.startsWith("/") || q.title.toLowerCase().includes(reply.slice(1).toLowerCase()))
    : [];
  // P3: visitor online = last-seen within 60s OR a live presence
  // event within 60s (nowTick ages the live cue out).
  const isVisitorOnline = (c: Conversation): boolean => {
    if (c.visitorLastSeenAt && nowTick - new Date(c.visitorLastSeenAt).getTime() < 60000) return true;
    const live = visitorLive[c.id];
    return Boolean(live && nowTick - live.at < 60000);
  };
  const ghostVisible = composerMode === "reply" && ghost.length > 0 && ghostForRef.current === reply;
  // P3: merged message + note timeline for the thread render.
  const timeline = mergeTimeline(messages, notes);
  const moodChip = (mood?: string | null) => {
    if (mood === "positive") return <span title={moodTitle(locale)} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">{t("inbox.moodPositive")}</span>;
    if (mood === "neutral") return <span title={moodTitle(locale)} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">{t("inbox.moodNeutral")}</span>;
    if (mood === "negative") return <span title={moodTitle(locale)} className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-red-200">{t("inbox.moodNegative")}</span>;
    return null;
  };

  const renderCustomerContent = (isDrawer = false) => {
    if (!active) return null;
    return (
      <div className="space-y-4">
        {isDrawer && (
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 xl:hidden">
            <span className="text-sm font-bold text-slate-900">{t("inbox.ctxProfileTitle")}</span>
            <button className="rounded-xl bg-white px-2.5 py-1.5 text-xs font-semibold shadow-2xs border border-slate-200" onClick={() => setCtxOpen(false)}>{t("inbox.closeX")}</button>
          </div>
        )}

        {/* Customer Profile Card */}
        <div className="card space-y-3 p-4 shadow-2xs border border-slate-200/80">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{t("inbox.customerProfile")}</span>
            {context?.lead ? <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 ring-1 ring-indigo-200/60">Lead: {context.lead.stage}</span> : null}
          </div>

          {context?.customer ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <ContactAvatar name={context.customer.name ?? active.contactName} channel={active.channel} size="lg" />
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 truncate">{context.customer.name ?? active.contactName ?? "—"}</div>
                  <div className="text-xs text-slate-500 flex flex-col gap-0.5 mt-0.5">
                    {context.customer.phone || active.contactPhone ? (
                      <a href={`tel:${context.customer.phone ?? active.contactPhone}`} className="text-indigo-600 hover:underline">
                        📞 {context.customer.phone ?? active.contactPhone}
                      </a>
                    ) : null}
                    {context.customer.email ? <span className="truncate">✉️ {context.customer.email}</span> : null}
                  </div>
                </div>
              </div>

              {context.lifetime ? (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3 text-center">
                    <div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">{t("inbox.totalOrders")}</div>
                    <div className="mt-1 text-lg font-black text-slate-900">{t("inbox.orderCountTi", { count: fmtNumber(locale, context.lifetime.orderCount) })}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3 text-center">
                    <div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">{t("inbox.lifetimeSpend")}</div>
                    <div className="mt-1 text-lg font-black text-emerald-600">{money(context.lifetime.totalSpentMinor, context.lifetime.currency, locale)}</div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-xl bg-slate-50 p-3 text-center text-xs text-slate-500">
              {t("inbox.notLinkedCustomer")}{context?.lead ? "" : ` ${t("inbox.leadCreatedSuffix")}`}
            </div>
          )}

          {context?.lead && !context?.customer ? (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="badge-brand">Lead: {context.lead.stage}</span>
              <span className="badge-slate">{context.lead.source}</span>
              {context.lead.valueMinor ? <span className="badge-green">{money(context.lead.valueMinor, "BDT", locale)}</span> : null}
              {(context.lead.tags ?? []).map((t) => <span key={t} className="badge-amber">{t}</span>)}
            </div>
          ) : null}
          {context?.orders?.length ? (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("inbox.recentOrders")}</div>
              <div className="space-y-1.5">
                {context.orders.map((o) => (
                  <div key={o.id} className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">#{o.externalNumber ?? o.id.slice(0, 6)} · {o.status}{o.isCod ? " · COD" : ""}</span>
                      <span className="font-semibold">{money(o.totalMinor, o.currency, locale)}</span>
                    </div>
                    {o.shipment ? <ShipmentWidget shipment={o.shipment} currency={o.currency} syncing={busy === `sync:${o.shipment.id}`} onSync={() => syncShipment(o.shipment!.id)} /> : null}
                    {o.isCod ? (
                      <div className="mt-1 flex items-center gap-2">
                        {o.codConfirmationStatus === "awaiting" ? <span className="badge-amber">{t("inbox.codAwaiting")}</span>
                          : o.codConfirmationStatus === "confirmed" ? <span className="badge-green">{t("inbox.codConfirmed")}</span>
                          : o.codConfirmationStatus === "declined" ? <span className="badge-red">{t("inbox.codDeclined")}</span>
                          : ["pending", "on-hold", "processing"].includes(o.status) ? (
                            <button className="btn-warning btn-sm !px-2 !py-0.5 !text-[11px]" disabled={busy !== ""} onClick={() => requestCod(o.id)}>{busy === "cod" ? t("inbox.sendingDots") : t("inbox.codSendBtn")}</button>
                          ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* Quick Action Tiles */}
        <div className="card p-4 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">{t("inbox.quickActions")}</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <button
              type="button"
              className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-slate-200/90 bg-white p-3 font-semibold text-slate-700 shadow-2xs hover:border-blue-400 hover:bg-blue-50/50 hover:text-blue-700 transition"
              onClick={() => setOrderOpen((v) => !v)}
            >
              <span className="text-base">📄</span>
              <span>{t("inbox.sendInvoice")}</span>
            </button>
            <button
              type="button"
              className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-slate-200/90 bg-white p-3 font-semibold text-slate-700 shadow-2xs hover:border-blue-400 hover:bg-blue-50/50 hover:text-blue-700 transition"
              onClick={() => setNotice(t("inbox.taskWindowOpening"))}
            >
              <span className="text-base">📋</span>
              <span>{t("inbox.createTask")}</span>
            </button>
            <button
              type="button"
              className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-slate-200/90 bg-white p-3 font-semibold text-slate-700 shadow-2xs hover:border-amber-400 hover:bg-amber-50/50 hover:text-amber-800 transition"
              onClick={() => { setComposerMode("note"); setMobileTab("chat"); focusComposer(); }}
            >
              <span className="text-base">📝</span>
              <span>{t("inbox.addNote")}</span>
            </button>
            <button
              type="button"
              className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-slate-200/90 bg-white p-3 font-semibold text-slate-700 shadow-2xs hover:border-emerald-400 hover:bg-emerald-50/50 hover:text-emerald-800 transition"
              onClick={() => patchConversation({ status: active.status === "closed" ? "open" : "closed" })}
            >
              <span className="text-base">✓</span>
              <span>{active.status === "closed" ? t("inbox.reopenChat") : t("inbox.resolveChat")}</span>
            </button>
          </div>
        </div>

        {/* AI Conversation Summary Card */}
        <div className="card p-4 space-y-2 border-indigo-100 bg-gradient-to-br from-indigo-50/40 via-white to-purple-50/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-900">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-indigo-100 text-indigo-600 text-[10px]">✨</span>
              <span>{t("inbox.aiSummaryTitle")}</span>
            </div>
            <button
              className="text-[11px] font-bold text-indigo-600 hover:underline disabled:opacity-50"
              disabled={busy !== ""}
              onClick={summarize}
            >
              {busy === "summary" ? t("inbox.generating") : active.summaryText ? t("inbox.refresh") : t("inbox.create")}
            </button>
          </div>

          {active.summaryText ? (
            <div className="rounded-xl bg-white/90 p-3 text-xs leading-relaxed text-slate-700 shadow-2xs ring-1 ring-slate-100 whitespace-pre-line">
              {active.summaryText}
              <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-1.5 text-[10px] text-slate-400">
                <span>{active.summaryProvider ?? "AI Engine"}</span>
                <span>{active.summaryAt ? fmtTime(locale, active.summaryAt) : ""}</span>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-indigo-200 p-3 text-center text-xs text-indigo-600/80">{t("inbox.summaryHint")}</div>
          )}
        </div>

        {/* Command Profile (if available) */}
        {profile ? (
          <div className="card space-y-3 p-4">
            <div className="section-title">🎯 Command Profile</div>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              <span className="badge-indigo">Stage: {profile.conversation?.pipelineStage}</span>
              {profile.rfm ? <span className="badge-green">{t("inbox.inbZRfmBadge", { segment: profile.rfm.segment, freq: fmtNumber(locale, profile.rfm.frequency), days: fmtNumber(locale, profile.rfm.recencyDays) })}</span> : <span className="badge-slate">{t("inbox.rfmNoOrders")}</span>}
              {profile.adOrigin?.ctwaSourceId ? <span className="badge-amber">{t("inbox.ctwaAd")}</span> : null}
              {profile.adOrigin?.leadSource ? <span className="badge-slate">Lead Source: {profile.adOrigin.leadSource}</span> : null}
            </div>
            {profile.conversations?.length > 1 ? (
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase text-slate-400">{t("inbox.allChannelConvs")}</div>
                <div className="space-y-1">
                  {profile.conversations.map((c: any) => (
                    <button key={c.id} className="flex w-full items-center justify-between rounded-lg bg-slate-50 px-2 py-1 text-left text-xs hover:bg-slate-100"
                      onClick={() => { if (c.id !== active.id) void openConversation({ id: c.id } as Conversation); }}>
                      <span className="flex items-center gap-1.5"><ChannelChip channel={c.channel} /> <span className="truncate">{c.lastMessagePreview ?? "—"}</span></span>
                      <span className="shrink-0 text-slate-400">{c.status}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {profile.payments?.verifications?.length ? (
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase text-slate-400">{t("inbox.paymentVerify")}</div>
                {profile.payments.verifications.map((v: any) => (
                  <div key={v.id} className="rounded-lg bg-slate-50 px-2 py-1 text-xs">
                    {v.provider ?? "?"} · <b>{v.verdict}</b>{v.trxId ? ` · TrxID ${v.trxId}` : ""}{v.amountMinor ? ` · ${money(v.amountMinor, "BDT", locale)}` : ""}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Responsibility & Tags & Chat Order */}
        <div className="card space-y-3 p-4">
          <div className="section-title">{t("inbox.responsibilityTags")}</div>
          {active.spamFlag ? (
            <div className="rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
              <div className="text-xs font-semibold text-amber-800">{t("inbox.spamSuspect")}</div>
              <p className="mt-0.5 text-xs text-amber-700">{active.spamReason ?? ""}</p>
              <button className="btn-secondary btn-sm mt-2" disabled={busy !== ""} onClick={() => patchConversation({ spamFlag: false })}>{t("inbox.spamNotOk")}</button>
            </div>
          ) : null}
          {botSession?.status === "active" ? (
            <div className="rounded-xl bg-indigo-50 p-3 ring-1 ring-indigo-100">
              <div className="text-xs font-semibold text-indigo-800">{t("inbox.botRunning", { state: botSession.state })}</div>
              <p className="mt-0.5 text-xs text-indigo-600">{t("inbox.inbZBotStopNote")}</p>
              <button className="btn-secondary btn-sm mt-2" disabled={busy !== ""} onClick={async () => {
                const orgId = getOrganizationId(); if (!orgId || !active) return;
                try { await apiFetch(`/organizations/${orgId}/inbox/conversations/${active.id}/bot/stop`, { method: "POST" }); setNotice(t("inbox.botStopped")); await refreshActive(); }
                catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
              }}>{t("inbox.stopBot")}</button>
            </div>
          ) : null}
          {active.csatRating ? (
            <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-100">{t("inbox.inbZCsatRating", { rating: fmtNumber(locale, active.csatRating ?? 0) })}</div>
          ) : null}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t("inbox.orderFromChat")}</span>
              <button className="text-xs font-semibold text-indigo-600 hover:underline" onClick={() => setOrderOpen(!orderOpen)}>{orderOpen ? t("inbox.closeBtn") : t("inbox.createPlusBtn")}</button>
            </div>
            {orderOpen ? (
              <div className="space-y-2 rounded-xl bg-slate-50 p-2.5">
                {orderItems.map((it, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <select className="input flex-1 !py-1.5 !text-xs" value={it.productId} onChange={(e) => setOrderItems(orderItems.map((x, j) => j === idx ? { ...x, productId: e.target.value } : x))}>
                      {products.map((prod) => <option key={prod.id} value={prod.id}>{prod.name} — {money(prod.priceMinor, prod.currency, locale)}</option>)}
                    </select>
                    <input className="input !w-14 !py-1.5 !text-xs" type="number" min={1} max={99} value={it.quantity} onChange={(e) => setOrderItems(orderItems.map((x, j) => j === idx ? { ...x, quantity: Number(e.target.value) || 1 } : x))} />
                    <button className="text-slate-400 hover:text-red-500" onClick={() => setOrderItems(orderItems.filter((_, j) => j !== idx))}>✕</button>
                  </div>
                ))}
                <button className="text-xs font-semibold text-indigo-600 hover:underline" onClick={() => setOrderItems([...orderItems, { productId: products[0]?.id ?? "", quantity: 1 }])}>{t("inbox.addProductBtn")}</button>
                <label className="block text-xs">{t("inbox.deliveryAddressLabel")}<input className="input mt-0.5 !py-1.5 !text-xs" placeholder={t("inbox.addressPlaceholder")} value={orderAddress} onChange={(e) => setOrderAddress(e.target.value)} /></label>
                <div className="flex items-end gap-2">
                  <label className="flex-1 text-xs">{t("inbox.deliveryTakaLabel")}<input className="input mt-0.5 !py-1.5 !text-xs" type="number" min={0} value={orderShip} onChange={(e) => setOrderShip(e.target.value)} /></label>
                  <label className="flex items-center gap-1.5 pb-2 text-xs"><input type="checkbox" checked={orderCod} onChange={(e) => setOrderCod(e.target.checked)} /> COD</label>
                </div>
                <button className="btn-primary w-full !py-2 !text-xs" disabled={busy !== "" || orderItems.length === 0} onClick={createChatOrder}>{busy === "order" ? t("inbox.creatingDots") : t("inbox.createOrderBtn")}</button>
                <p className="text-[10px] text-slate-400">{t("inbox.orderPriceNote")}</p>
              </div>
            ) : null}
          </div>
          <label className="block text-sm">Assignee
            <select className="input mt-1" value={active.assignedUserId ?? ""} onChange={(e) => patchConversation({ assignedUserId: e.target.value || null })}>
              <option value="">{t("inbox.nobodyPlain")}</option>
              {members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.name ?? m.user.email} ({m.role})</option>)}
            </select>
          </label>
          <div>
            <div className="mb-1 flex flex-wrap gap-1">
              {(active.tags ?? []).map((t) => (
                <span key={t} className="badge-brand">{t}<button className="ml-1 font-bold" onClick={() => patchConversation({ tags: (active.tags ?? []).filter((x) => x !== t) })}>×</button></span>
              ))}
              {(active.tags ?? []).length === 0 ? <span className="text-xs text-slate-400">{t("inbox.noTags")}</span> : null}
            </div>
            <div className="flex gap-1.5">
              <input className="input flex-1" placeholder={t("inbox.newTagPlaceholder")} value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && tagInput.trim()) { patchConversation({ tags: [...(active.tags ?? []), tagInput.trim()] }); setTagInput(""); } }} />
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={viewMode === "list" ? "flex h-[calc(100dvh-164px)] flex-col gap-3 sm:h-[calc(100dvh-180px)] lg:h-[calc(100dvh-116px)]" : "space-y-6"}>
      {/* Invisible backdrop to dismiss open dropdowns */}
      {(actionMenuOpen || stageMenuOpen || attachMenuOpen || aiMenuOpen || formatMenuOpen) && (
        <div
          className="fixed inset-0 z-30 bg-transparent"
          onClick={() => {
            setActionMenuOpen(false);
            setStageMenuOpen(false);
            setAttachMenuOpen(false);
            setAiMenuOpen(false);
            setFormatMenuOpen(false);
          }}
        />
      )}
      {/* Modern Top Command Bar */}
      <div className="shrink-0 rounded-2xl border border-slate-200/80 bg-white/80 p-2.5 shadow-sm backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-lg font-black text-white shadow-md shadow-indigo-500/25">
              💬
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-slate-900">Unified Inbox</h1>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200/60">
                  {t("inbox.chatCountTi", { count: fmtNumber(locale, conversations.length) })}
                </span>
              </div>
              <p className="text-xs text-slate-400">{t("inbox.subtitle")}</p>
            </div>
          </div>

          {/* Segmented View Switcher */}
          <div className="flex items-center rounded-xl bg-slate-100/90 p-1 text-xs font-semibold ring-1 ring-slate-200/60">
            <button
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all ${viewMode === "list" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
              onClick={() => setViewMode("list")}
            >
              <span>💬</span> <span>{t("inbox.tabConversations")}</span>
            </button>
            <button
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all ${viewMode === "board" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
              onClick={() => setViewMode("board")}
            >
              <span>🗂️</span> <span>{t("inbox.tabPipeline")}</span>
            </button>
            <button
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all ${viewMode === "media" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
              onClick={() => setViewMode("media")}
            >
              <span>🖼️</span> <span>{t("inbox.tabMedia")}</span>
            </button>
            <button
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all ${viewMode === "manage" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
              onClick={() => setViewMode("manage")}
            >
              <span>⚙️</span> <span>{t("inbox.tabSettingsTeam")}</span>
            </button>
          </div>

          {/* Quick Actions & Status */}
          <div className="flex items-center gap-2">
            <button
              className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium shadow-xs transition ${
                soundEnabled
                  ? "border-emerald-200 bg-emerald-50/80 text-emerald-700 hover:bg-emerald-100"
                  : "border-slate-200 bg-white text-slate-400 hover:bg-slate-50"
              }`}
              onClick={() => {
                const next = !soundEnabled;
                setSoundEnabled(next);
                if (next) playNotificationChime();
              }}
              title={soundEnabled ? t("inbox.soundOn") : t("inbox.soundOff")}
            >
              <span>{soundEnabled ? "🔔" : "🔕"}</span>
            </button>
            <button
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50 transition"
              onClick={() => setPaletteOpen(true)}
              title={t("inbox.commandPalette")}
            >
              <span>🔍</span>
              <kbd className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">⌘K</kbd>
            </button>
            <button
              className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-blue-700 transition"
              onClick={() => setNewMsgOpen(true)}
              title={t("inbox.newMessage")}
            >
              <span>＋</span>
              <span>{t("inbox.newChat")}</span>
            </button>
            <button
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50 transition"
              onClick={async () => {
                const orgId = getOrganizationId(); if (!orgId) return;
                try {
                  const data = await apiFetch<any>(`/organizations/${orgId}/inbox/export`);
                  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "inbox-export.json"; a.click(); URL.revokeObjectURL(a.href);
                } catch (e) { setError(e instanceof Error ? e.message : t("inbox.exportFailed")); }
              }}
              title={t("inbox.export30d")}
            >
              <span>⬇️</span>
              <span className="hidden sm:inline">Export</span>
            </button>
          </div>
        </div>
        {viewMode === "list" ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {([
              { key: "all", label: t("inbox.allWord"), active: !smartFolder && !filters.assignee, count: folderCounts?.all, title: t("inbox.allConvs"), onClick: () => applyFolder("", "") },
              { key: "mine", label: t("inbox.myInbox"), active: !smartFolder && filters.assignee === "me", count: folderCounts?.mine, title: t("inbox.assignedToMe"), onClick: () => applyFolder("", "me") },
              { key: "unassigned", label: t("inbox.unassigned"), active: !smartFolder && filters.assignee === "unassigned", count: folderCounts?.unassigned, title: t("inbox.unassignedSub"), onClick: () => applyFolder("", "unassigned") },
              { key: "sla", label: "⏰ SLA Breach", active: smartFolder === "sla", count: folderCounts?.slaBreach, title: t("inbox.inbZSlaTitleA", { minutes: fmtNumber(locale, folderCounts?.slaFirstResponseMinutes ?? settings?.slaFirstResponseMinutes ?? 60) }), onClick: () => applyFolder("sla") },
              { key: "vip", label: t("inbox.vipFolder"), active: smartFolder === "vip", count: folderCounts?.vip, title: folderCounts?.vipThresholdMinor ? t("inbox.inbZVipTitle", { amount: money(folderCounts.vipThresholdMinor, "BDT", locale) }) : t("inbox.inbZVipNoThreshold"), onClick: () => applyFolder("vip") },
              { key: "handover", label: t("inbox.handoverQueue"), active: smartFolder === "handover", count: folderCounts?.handover, title: t("inbox.handoverSub"), onClick: () => applyFolder("handover") },
              { key: "snoozed", label: "😴 Snoozed", active: smartFolder === "snoozed", count: folderCounts?.snoozed, title: t("inbox.snoozedSub"), onClick: () => applyFolder("snoozed") },
            ]).map((chip) => (
              <button key={chip.key} title={chip.title} onClick={chip.onClick}
                className={`stat-chip ${chip.active ? "stat-chip-active" : ""} ${chip.key === "sla" && (chip.count ?? 0) > 0 && !chip.active ? "stat-chip-danger" : ""}`}>
                {chip.label}{chip.count !== undefined && chip.count !== null ? <span className="stat-chip-count">{chip.count}</span> : null}
              </button>
            ))}
            <span className="ml-1 min-w-0 truncate text-[11px] text-slate-400">{t("inbox.aiDraftNote")}</span>
          </div>
        ) : (
          <p className="truncate text-[11px] text-slate-400">{t("inbox.aiDraftNote")}</p>
        )}
      </div>
      {error ? (
        <div className="shrink-0 flex items-center justify-between rounded-xl border border-red-200 bg-red-50/90 px-4 py-2.5 text-xs text-red-700 shadow-xs">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
          <button onClick={() => setError("")} className="font-bold text-red-500 hover:text-red-700">✕</button>
        </div>
      ) : null}
      {notice ? (
        <div className="shrink-0 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/90 px-4 py-2.5 text-xs text-emerald-700 shadow-xs">
          <div className="flex items-center gap-2">
            <span>✅</span>
            <span>{notice}</span>
          </div>
          <button onClick={() => setNotice("")} className="font-bold text-emerald-500 hover:text-emerald-700">✕</button>
        </div>
      ) : null}

      {viewMode === "board" ? (
        <div className="card p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-slate-900">{t("inbox.pipelineBoard")}</span>
                {board && (
                  <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-bold text-indigo-700 ring-1 ring-indigo-200">
                    {t("inbox.totalActiveLine", { count: fmtNumber(locale, board.totalActive) })}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">{t("inbox.dragStageHint")}</p>
            </div>
            <button className="btn-secondary btn-sm" onClick={() => void loadBoard()}>{t("inbox.inbZRefreshBtn")}</button>
          </div>

          {!board ? (
            <p className="py-12 text-center text-sm text-slate-400 font-medium">{t("inbox.boardLoading")}</p>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-4 pt-1 snap-x">
              {([["new", "🆕 New Lead"], ["talking", "💬 Talking"], ["ordered", "🛒 Order Placed"], ["shipped", "🚚 Shipped"], ["delivered", "✅ Completed"], ["repeat", "🔁 Repeat"]] as const).map(([stage, label]) => (
                <div
                  key={stage}
                  className={`min-h-[220px] w-72 shrink-0 rounded-2xl p-3 border transition-colors snap-start ${
                    stage === "shipped"
                      ? "border-sky-200 bg-sky-50/40"
                      : "border-slate-200/80 bg-slate-50/70"
                  }`}
                  title={stage === "shipped" ? t("inbox.shippedNote") : undefined}
                  onDragOver={stage === "shipped" ? undefined : (e) => e.preventDefault()}
                  onDrop={stage === "shipped" ? undefined : async (e) => {
                    e.preventDefault();
                    const convId = e.dataTransfer.getData("text/plain");
                    const orgId = getOrganizationId(); if (!convId || !orgId) return;
                    await apiFetch(`/organizations/${orgId}/inbox/conversations/${convId}`, { method: "PATCH", body: JSON.stringify({ pipelineStage: stage }) }).catch(() => undefined);
                    void loadBoard();
                  }}
                >
                  <div className="mb-2 flex items-center justify-between border-b border-slate-200/60 pb-2">
                    <span className="text-xs font-bold text-slate-800">{label}</span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10.5px] font-bold text-slate-600 shadow-xs ring-1 ring-slate-200/60">
                      {board.stages[stage]?.count ?? 0}
                    </span>
                  </div>
                  <div className="text-[11px] font-semibold text-emerald-700 bg-emerald-50/80 px-2 py-1 rounded-lg mb-3">
                    {t("inbox.inbZOrderValueLabel")} {fmtMoneyMinor(locale, board.stages[stage] ? Number(board.stages[stage].valueMinor) : 0)}
                  </div>

                  <div className="space-y-2">
                    {(board.stages[stage]?.cards ?? []).map((card: any) => (
                      <div
                        key={card.id}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", card.id)}
                        onClick={() => { setViewMode("list"); void openConversation({ id: card.id } as Conversation); }}
                        className="cursor-pointer rounded-xl border border-slate-200/90 bg-white p-3 shadow-xs transition hover:border-brand-300 hover:shadow-md hover:-translate-y-0.5 active:scale-98"
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="truncate text-xs font-bold text-slate-900">{card.contactName ?? card.contactPhone ?? t("inbox.customerFallback")}</span>
                          <ChannelChip channel={card.channel} />
                        </div>
                        <div className="truncate text-xs text-slate-500 mt-1">{card.lastMessagePreview ?? "—"}</div>
                        <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-1.5 text-[10.5px] text-slate-400">
                          <span>{card.lastMessageAt ? fmtTime(locale, card.lastMessageAt) : ""}</span>
                          {card.unreadCount > 0 ? <span className="rounded-full bg-red-500 px-1.5 py-0.2 font-bold text-white text-[10px]">{card.unreadCount}</span> : null}
                          {card.latestOrderTotalMinor ? <span className="font-bold text-emerald-600">{fmtMoneyMinor(locale, Number(card.latestOrderTotalMinor))}</span> : null}
                        </div>
                      </div>
                    ))}
                    {(board.stages[stage]?.cards ?? []).length === 0 && (
                      <p className="py-6 text-center text-xs text-slate-400 italic">{t("inbox.noChats")}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-slate-400">{t("inbox.inbZBoardNote")}</p>
        </div>
      ) : null}

      {viewMode === "media" ? (
        <div className="card p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <div className="text-base font-bold text-slate-900">{t("inbox.mediaLibrary")}</div>
              <p className="text-xs text-slate-400 mt-0.5">{t("inbox.mediaSub")}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="input !w-48 !text-xs !py-1.5"
                placeholder={t("inbox.namePhoneSearch")}
                value={mediaQ}
                onChange={(e) => setMediaQ(e.target.value)}
              />
              <select
                className="input !w-32 !text-xs !py-1.5"
                value={mediaType}
                onChange={(e) => setMediaType(e.target.value)}
              >
                <option value="">{t("inbox.allTypes")}</option>
                <option value="image">{t("inbox.typeImage")}</option>
                <option value="audio">{t("inbox.voiceLabel")}</option>
                <option value="video">{t("inbox.typeVideo")}</option>
                <option value="document">{t("inbox.typeDoc")}</option>
              </select>
              <button className="btn-secondary btn-sm" onClick={() => void loadMedia()}>{t("inbox.inbZRefreshBtn")}</button>
            </div>
          </div>

          {mediaItems.length === 0 ? (
            <div className="py-16 text-center">
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-xl">🖼️</div>
              <p className="text-sm font-semibold text-slate-700">{t("inbox.noMedia")}</p>
              <p className="text-xs text-slate-400 mt-0.5">{t("inbox.mediaEmptyHint")}</p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
              {mediaItems.map((m: any) => (
                <button
                  key={m.id}
                  className="group rounded-2xl border border-slate-200/80 bg-white p-3.5 text-left shadow-xs transition hover:border-brand-300 hover:shadow-md hover:-translate-y-0.5"
                  onClick={() => { setViewMode("list"); void openConversation({ id: m.conversationId } as Conversation); }}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-lg group-hover:scale-105 transition-transform">
                      {m.type === "image" ? "🖼️" : m.type === "audio" ? "🎙️" : m.type === "video" ? "🎬" : "📄"}
                    </span>
                    {m.stored ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">{t("inbox.cloudSaved")}</span>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">{t("inbox.onPlatform")}</span>
                    )}
                  </div>
                  <div className="mt-3 truncate text-xs font-bold text-slate-900 group-hover:text-brand-600 transition-colors">
                    {m.contactName ?? t("inbox.customerFallback")} · <span className="capitalize">{m.channel}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400 flex items-center justify-between">
                    <span>{fmtDate(locale, m.createdAt)}</span>
                    {m.sizeBytes ? <span>{(m.sizeBytes / 1024).toFixed(0)} KB</span> : null}
                  </div>
                </button>
              ))}
            </div>
          )}
          <p className="text-[11px] text-slate-400">{t("inbox.cloudNote")}</p>
        </div>
      ) : null}

      <div
        className={`${viewMode !== "list" ? "hidden" : ""} relative grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[var(--ilw,300px)_minmax(0,1fr)] xl:grid-cols-[var(--ilw,300px)_minmax(0,1fr)_var(--icw,320px)]`}
        style={{ "--ilw": `${listW}px`, "--icw": `${ctxW}px` } as React.CSSProperties}
      >
        {/* Pane splitters (desktop only): drag to resize, arrow
            keys nudge, double-click resets. Widths persist locally. */}
        <div
          role="separator" aria-label={t("inbox.listWidth")} aria-orientation="vertical" tabIndex={0}
          className="absolute inset-y-0 z-20 hidden w-3 cursor-col-resize touch-none rounded hover:bg-brand-100 focus:bg-brand-100 focus:outline-none lg:block"
          style={{ left: "calc(var(--ilw,300px) - 2px)" }}
          onPointerDown={(e) => startResize(e, "list")}
          onDoubleClick={() => { setListW(300); try { localStorage.setItem("inbox.listW", "300"); } catch { /* best-effort */ } }}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            const next = clampPane(listW + (e.key === "ArrowRight" ? 12 : -12), 230, 520);
            setListW(next); try { localStorage.setItem("inbox.listW", String(next)); } catch { /* best-effort */ }
          }}
        />
        <div
          role="separator" aria-label={t("inbox.panelWidth")} aria-orientation="vertical" tabIndex={0}
          className="absolute inset-y-0 z-20 hidden w-3 cursor-col-resize touch-none rounded hover:bg-brand-100 focus:bg-brand-100 focus:outline-none xl:block"
          style={{ right: "calc(var(--icw,320px) - 2px)" }}
          onPointerDown={(e) => startResize(e, "ctx")}
          onDoubleClick={() => { setCtxW(320); try { localStorage.setItem("inbox.ctxW", "320"); } catch { /* best-effort */ } }}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            const next = clampPane(ctxW + (e.key === "ArrowLeft" ? 12 : -12), 260, 520);
            setCtxW(next); try { localStorage.setItem("inbox.ctxW", String(next)); } catch { /* best-effort */ }
          }}
        />
        {/* ---- Conversation list + filters ---- */}
        <div className={`${mobileChat ? "hidden lg:flex" : "flex"} min-h-0 flex-col gap-2.5`}>
          {/* Modern Search Input */}
          <div className="relative shrink-0">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
              🔍
            </span>
            <input
              id="inbox-search"
              className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-10 pr-10 text-xs text-slate-900 shadow-2xs placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder={t("inbox.searchPlaceholder")}
              value={filters.q}
              onChange={(e) => onSearch(e.target.value)}
            />
            <kbd className="pointer-events-none absolute inset-y-0 right-0 my-auto mr-3 flex h-5 items-center rounded-md border border-slate-200 bg-slate-50 px-1.5 text-[10px] font-bold text-slate-400">
              ⌘K
            </kbd>
          </div>

          {/* Channel Round Pills Bar (Matches Demo 3 & 4) */}
          <div className="flex shrink-0 gap-1.5 overflow-x-auto pb-1 scrollbar-none items-center">
            <button
              onClick={() => onFilter({ channel: "" })}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                !filters.channel
                  ? "bg-blue-600 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              <span>All</span>
              <span className={`rounded-full px-1.5 text-[10px] ${!filters.channel ? "bg-white/20 text-white" : "bg-slate-200 text-slate-700"}`}>
                {conversations.length}
              </span>
            </button>

            {([
              { id: "whatsapp", label: "WhatsApp", icon: "🟢", count: conversations.filter(c => c.channel === "whatsapp").length, activeCls: "bg-emerald-600 text-white" },
              { id: "messenger", label: "Messenger", icon: "🔵", count: conversations.filter(c => c.channel === "messenger").length, activeCls: "bg-sky-600 text-white" },
              { id: "instagram", label: "Instagram", icon: "🟣", count: conversations.filter(c => c.channel === "instagram").length, activeCls: "bg-fuchsia-600 text-white" },
              { id: "telegram", label: "Telegram", icon: "✈️", count: conversations.filter(c => c.channel === "telegram").length, activeCls: "bg-cyan-600 text-white" },
              { id: "webchat", label: "Website", icon: "🌐", count: conversations.filter(c => c.channel === "webchat").length, activeCls: "bg-indigo-600 text-white" },
            ]).map((ch) => (
              <button
                key={ch.id}
                onClick={() => onFilter({ channel: filters.channel === ch.id ? "" : ch.id })}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  filters.channel === ch.id
                    ? ch.activeCls
                    : "bg-slate-100/90 text-slate-600 hover:bg-slate-200/80"
                }`}
              >
                <span>{ch.icon}</span>
                <span>{ch.label}</span>
                {ch.count > 0 ? (
                  <span className={`rounded-full px-1.5 text-[10px] font-bold ${
                    filters.channel === ch.id ? "bg-white/20 text-white" : "bg-slate-200 text-slate-600"
                  }`}>
                    {ch.count}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          {/* Clean Status & Filter Toggle Bar */}
          <div className="flex shrink-0 items-center justify-between gap-1.5 rounded-xl bg-slate-100/70 p-1 text-xs">
            <div className="flex items-center gap-1">
              <button
                className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                  !filters.unreadOnly && !filters.spamOnly && !filters.status ? "bg-white text-slate-900 shadow-2xs" : "text-slate-600 hover:text-slate-900"
                }`}
                onClick={() => onFilter({ unreadOnly: false, spamOnly: false, status: "" })}
              >
                {t("inbox.allWord")}
              </button>
              <button
                className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                  filters.unreadOnly ? "bg-white text-blue-600 shadow-2xs font-bold" : "text-slate-600 hover:text-slate-900"
                }`}
                onClick={() => onFilter({ unreadOnly: !filters.unreadOnly, spamOnly: false })}
              >
                {t("inbox.inbZUnreadWord")} {conversations.filter(c => c.unreadCount > 0).length ? `(${fmtNumber(locale, conversations.filter(c => c.unreadCount > 0).length)})` : ""}
              </button>
              <button
                className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                  filters.status === "closed" ? "bg-white text-slate-900 shadow-2xs" : "text-slate-600 hover:text-slate-900"
                }`}
                onClick={() => onFilter({ status: filters.status === "closed" ? "" : "closed", unreadOnly: false })}
              >{t("inbox.resolvedWord")}</button>
            </div>

            <button
              onClick={() => setFilterExpanded((v) => !v)}
              className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold transition ${
                filterExpanded || filters.spamOnly || filters.assignee || filters.tag || selectMode
                  ? "bg-blue-50 text-blue-700 font-bold"
                  : "text-slate-500 hover:text-slate-800"
              }`}
              title={t("inbox.filterBulk")}
            >
              <span>{t("inbox.filterBtn")}</span>
              {(filters.spamOnly || filters.assignee || filters.tag || selectMode) && (
                <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />
              )}
            </button>
          </div>
          <input
            className="rounded-xl border border-slate-200/90 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-xs placeholder:text-slate-400 focus:border-brand-500 focus:outline-none"
            placeholder={t("inbox.tagFilterPlaceholder")}
            value={filters.tag}
            onChange={(e) => onFilter({ tag: e.target.value })}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {([
              { key: "all", label: t("inbox.allWord"), active: !smartFolder && !filters.assignee, count: folderCounts?.all, title: t("inbox.allConvs"), onClick: () => applyFolder("", "") },
              { key: "mine", label: t("inbox.myInbox"), active: !smartFolder && filters.assignee === "me", count: folderCounts?.mine, title: t("inbox.assignedToMe"), onClick: () => applyFolder("", "me") },
              { key: "unassigned", label: t("inbox.unassigned"), active: !smartFolder && filters.assignee === "unassigned", count: folderCounts?.unassigned, title: t("inbox.unassignedSub"), onClick: () => applyFolder("", "unassigned") },
              { key: "sla", label: "⏰ SLA Breach", active: smartFolder === "sla", count: folderCounts?.slaBreach, title: t("inbox.inbZSlaTitleB", { minutes: fmtNumber(locale, folderCounts?.slaFirstResponseMinutes ?? settings?.slaFirstResponseMinutes ?? 60) }), onClick: () => applyFolder("sla") },
              { key: "vip", label: t("inbox.vipFolder"), active: smartFolder === "vip", count: folderCounts?.vip, title: folderCounts?.vipThresholdMinor ? t("inbox.inbZVipTitle", { amount: money(folderCounts.vipThresholdMinor, "BDT", locale) }) : t("inbox.inbZVipNoThreshold"), onClick: () => applyFolder("vip") },
              { key: "handover", label: t("inbox.handoverQueue"), active: smartFolder === "handover", count: folderCounts?.handover, title: t("inbox.handoverSub"), onClick: () => applyFolder("handover") },
              { key: "snoozed", label: "😴 Snoozed", active: smartFolder === "snoozed", count: folderCounts?.snoozed, title: t("inbox.snoozedSub"), onClick: () => applyFolder("snoozed") },
            ]).map((chip) => (
              <button key={chip.key} title={chip.title} onClick={chip.onClick}
                className={`stat-chip ${chip.active ? "stat-chip-active" : ""} ${chip.key === "sla" && (chip.count ?? 0) > 0 && !chip.active ? "stat-chip-danger" : ""}`}>
                {chip.label}{chip.count !== undefined && chip.count !== null ? <span className="stat-chip-count">{chip.count}</span> : null}
              </button>
            ))}
          </div>
          {/* IN1a: search INSIDE messages (content + voice transcript) */}
          <div className="shrink-0">
            <div className="flex gap-1.5">
              <input className="input min-w-0 flex-1" placeholder={t("inbox.inMessageSearchPlaceholder")} value={msgQ}
                onChange={(e) => setMsgQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void runMessageSearch(); }} />
              <button className="btn-secondary btn-sm shrink-0" disabled={msgBusy} onClick={() => void runMessageSearch()}>{msgBusy ? t("inbox.searchingDots") : t("inbox.searchInMessagesBtn")}</button>
            </div>
            {msgResults !== null ? (
              <div className="mt-1.5 max-h-64 space-y-1 overflow-y-auto rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-slate-200">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] font-bold text-slate-600">{t("inbox.msgsMatched", { count: fmtNumber(locale, msgResults.length) })}</span>
                  <button className="text-[11px] font-semibold text-indigo-600 hover:underline" onClick={() => setMsgResults(null)}>{t("inbox.closeBtn")}</button>
                </div>
                {msgResults.length === 0 ? <p className="px-1 py-1 text-[11px] text-slate-400">{t("inbox.noMsgMatch")}</p> : msgResults.map((r) => {
                  const parts = splitSnippet(r.snippet, r.matchStart, r.matchLength);
                  return (
                    <button key={r.messageId} className="block w-full rounded-xl px-2 py-1.5 text-left hover:bg-indigo-50" onClick={() => void openSearchResult(r)}>
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
                        <span className="truncate">{r.contactName ?? r.contactPhone ?? t("inbox.customerFallback")}</span>
                        {r.channel ? <ChannelChip channel={r.channel} /> : null}
                        <span className="ml-auto shrink-0 font-normal text-slate-400">{fmtDateTime(locale, r.createdAt)}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                        {r.direction === "out" ? "➡️ " : ""}{parts.before}{parts.match ? <mark className="rounded bg-amber-200 px-0.5">{parts.match}</mark> : null}{parts.after}
                        {r.matchedField === "transcription" ? <span className="ml-1 text-slate-400">{t("inbox.fromVoiceText")}</span> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          {/* IN1b: advanced filters */}
          <div className="shrink-0">
            <button className={`toggle-pill ${showAdv || hasAdvancedFilters(filters) ? "toggle-pill-active" : ""}`} onClick={() => setShowAdv((v) => !v)}>
              {t("inbox.inbZAdvFilters")}{hasAdvancedFilters(filters) ? " •" : ""}
            </button>
            {showAdv ? (
              <div className="mt-1.5 space-y-1.5 rounded-2xl bg-slate-50 p-2 ring-1 ring-slate-200">
                <div className="flex items-center gap-1.5 text-[11px]">
                  <label className="w-14 shrink-0 font-semibold text-slate-500">{t("inbox.dateLabel")}</label>
                  <input type="date" className="input min-w-0 flex-1 !py-1" value={filters.dateFrom} onChange={(e) => onFilter({ dateFrom: e.target.value })} aria-label={t("inbox.startDate")} />
                  <span className="text-slate-400">–</span>
                  <input type="date" className="input min-w-0 flex-1 !py-1" value={filters.dateTo} onChange={(e) => onFilter({ dateTo: e.target.value })} aria-label={t("inbox.endDate")} />
                </div>
                <div className="flex items-center gap-1.5 text-[11px]">
                  <label className="w-14 shrink-0 font-semibold text-slate-500">{t("inbox.orderTakaLabel")}</label>
                  <input type="number" min="0" className="input min-w-0 flex-1 !py-1" placeholder={t("inbox.atLeast")} value={filters.amountMin} onChange={(e) => onFilter({ amountMin: e.target.value })} aria-label={t("inbox.minOrderPlaceholder")} />
                  <span className="text-slate-400">–</span>
                  <input type="number" min="0" className="input min-w-0 flex-1 !py-1" placeholder={t("inbox.maxWord")} value={filters.amountMax} onChange={(e) => onFilter({ amountMax: e.target.value })} aria-label={t("inbox.maxOrderPlaceholder")} />
                </div>
                <div className="flex items-center gap-1.5 text-[11px]">
                  <label className="w-14 shrink-0 font-semibold text-slate-500">{t("inbox.subjectLabel")}</label>
                  <select className="filter-select min-w-0 flex-1" value={filters.intent} onChange={(e) => onFilter({ intent: e.target.value })} aria-label="Intent">
                    <option value="">{t("inbox.allSubjects")}</option>
                    <option value="price">{t("inbox.draftPriceWord")}</option><option value="stock">{t("inbox.intentStock")}</option><option value="delivery">{t("inbox.intentDelivery")}</option>
                    <option value="order_status">{t("inbox.intentOrderStatus")}</option><option value="payment">{t("inbox.intentPayment")}</option>
                    <option value="complaint">{t("inbox.intentComplaint")}</option><option value="order_intent">{t("inbox.intentWantsOrder")}</option><option value="greeting">{t("inbox.intentGreeting")}</option>
                  </select>
                  <select className="filter-select min-w-0 flex-1" value={filters.sentiment} onChange={(e) => onFilter({ sentiment: e.target.value })} aria-label="Sentiment">
                    <option value="">{t("inbox.allMoods")}</option>
                    <option value="positive">{t("inbox.moodPositive")}</option><option value="neutral">{t("inbox.moodNeutral")}</option><option value="negative">{t("inbox.moodNegativeShort")}</option>
                  </select>
                </div>
                <p className="text-[10px] text-slate-400">{t("inbox.filterNote")}</p>
                {hasAdvancedFilters(filters) ? (
                  <button className="text-[11px] font-semibold text-red-600 hover:underline" onClick={() => onFilter({ dateFrom: "", dateTo: "", amountMin: "", amountMax: "", intent: "", sentiment: "" })}>{t("inbox.inbZAdvFiltersClear")}</button>
                ) : null}
              </div>
            ) : null}
          </div>
          {/* IN1c: saved views */}
          <div className="shrink-0">
            <div className="flex flex-wrap items-center gap-1.5">
              {savedViews.map((v) => (
                <span key={v.id} className="stat-chip" title={v.shared ? t("inbox.teamViews") : t("inbox.myViewsOnly")}>
                  <button className="font-semibold" onClick={() => applySavedView(v)}>⭐ {v.name}{v.shared ? t("inbox.teamSuffix") : ""}</button>
                  {v.mine ? <button className="ml-1 text-slate-400 hover:text-red-600" title={t("inbox.deleteView")} onClick={() => void deleteSavedView(v)}>✕</button> : null}
                </span>
              ))}
              <button className="toggle-pill" onClick={() => setSaveViewOpen((v) => !v)}>{t("inbox.saveViewBtn")}</button>
            </div>
            {saveViewOpen ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-2xl bg-indigo-50 p-2 ring-1 ring-indigo-200">
                <input className="input min-w-0 flex-1 !py-1" placeholder={t("inbox.viewNamePlaceholder")} value={saveViewName} onChange={(e) => setSaveViewName(e.target.value)} maxLength={80} />
                <label className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
                  <input type="checkbox" checked={saveViewShared} onChange={(e) => setSaveViewShared(e.target.checked)} /> {t("inbox.inbZViewSharedNote")}
                </label>
                <button className="btn-primary btn-sm" disabled={busy === "save-view"} onClick={() => void saveCurrentView()}>{t("inbox.saveBtn")}</button>
              </div>
            ) : null}
          </div>

          {/* Expandable Advanced Filters & Bulk Tools */}
          {filterExpanded ? (
            <div className="shrink-0 space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-2 text-xs animate-in fade-in">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-medium text-slate-500">{t("inbox.assigneeLabel")}</span>
                  <select
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-2xs focus:ring-0 cursor-pointer"
                    value={filters.assignee}
                    onChange={(e) => onFilter({ assignee: e.target.value })}
                  >
                    <option value="">{t("inbox.allMembers")}</option>
                    <option value="me">{t("inbox.mineOnly")}</option>
                    <option value="unassigned">{t("inbox.unassignedPlain")}</option>
                  </select>
                </div>
                <button
                  className={`rounded-lg px-2 py-1 text-xs font-semibold transition ${
                    filters.spamOnly ? "bg-rose-100 text-rose-700 font-bold" : "text-slate-600 hover:bg-slate-200"
                  }`}
                  onClick={() => onFilter({ spamOnly: !filters.spamOnly, unreadOnly: false })}
                >{t("inbox.spamWord")}</button>
                <button
                  className={`rounded-lg border px-2 py-1 text-xs font-semibold transition ${
                    selectMode ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                  }`}
                  onClick={() => { setSelectMode((v) => !v); setSelectedIds(new Set()); }}
                >{t("inbox.bulkWord")}</button>
              </div>
              <input
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
                placeholder={t("inbox.tagSearchPlaceholder")}
                value={filters.tag}
                onChange={(e) => onFilter({ tag: e.target.value })}
              />
            </div>
          ) : null}
          {selectedIds.size > 0 ? (
            <div className="shrink-0 rounded-xl bg-indigo-50 p-2 ring-1 ring-indigo-200">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-indigo-800">{t("inbox.selectedCount", { count: fmtNumber(locale, selectedIds.size) })}</span>
                <button className="text-[11px] font-semibold text-indigo-600 hover:underline" onClick={() => setSelectedIds(new Set())}>{t("inbox.clearSelection")}</button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <select className="rounded-lg border border-indigo-200 bg-white px-1.5 py-1 text-[11px]" value={bulkAssign} onChange={(e) => setBulkAssign(e.target.value)} aria-label={t("inbox.assignAction")}>
                  <option value="">{t("inbox.assignDash")}</option>
                  <option value="__none__">{t("inbox.unassignAction")}</option>
                  {members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.name ?? m.user.email}</option>)}
                </select>
                <button className="rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50" disabled={busy === "bulk"} onClick={() => runBulk("assign")}>{t("inbox.assignDoBtn")}</button>
                <input className="w-24 rounded-lg border border-indigo-200 bg-white px-1.5 py-1 text-[11px]" placeholder={t("inbox.tagDots")} value={bulkTag} onChange={(e) => setBulkTag(e.target.value)} list="bulk-tag-list" />
                <datalist id="bulk-tag-list">{[...new Set(conversations.flatMap((c) => c.tags ?? []))].map((t) => <option key={t} value={t} />)}</datalist>
                <button className="rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50" disabled={busy === "bulk"} onClick={() => runBulk("tag-add")}>{t("inbox.tagAddBtn")}</button>
                <button className="rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-indigo-200 disabled:opacity-50" disabled={busy === "bulk"} onClick={() => runBulk("mark-read")}>{t("inbox.markReadBtn")}</button>
                <button className="rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-red-600 ring-1 ring-red-200 disabled:opacity-50" disabled={busy === "bulk"} onClick={() => runBulk("close")}>{t("inbox.closeBtn")}</button>
              </div>
              {/* IN3c: bulk reply — the same quick reply / template to
                  every selected conversation. WhatsApp window-closed
                  items fail on the server before any send. */}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 border-t border-indigo-100 pt-1.5">
                <select className="rounded-lg border border-indigo-200 bg-white px-1.5 py-1 text-[11px]" value={bulkQrId} onChange={(e) => setBulkQrId(e.target.value)} aria-label={t("inbox.bulkReplyQrLabel")}>
                  <option value="">— Quick Reply —</option>
                  {quickReplies.map((q) => <option key={q.id} value={q.id}>{q.title}</option>)}
                </select>
                <button className="rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50" disabled={busy === "bulk-reply"} onClick={() => void runBulkReply("quick")}>{t("inbox.bulkReplyBtn")}</button>
                <select className="rounded-lg border border-indigo-200 bg-white px-1.5 py-1 text-[11px]" value={bulkTplId} onChange={(e) => setBulkTplId(e.target.value)} aria-label={t("inbox.bulkTemplateLabel")}>
                  <option value="">— Template —</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
                </select>
                <button className="rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-indigo-200 disabled:opacity-50" disabled={busy === "bulk-reply"} onClick={() => void runBulkReply("template")}>{t("inbox.templateSendBtn2")}</button>
                <span className="text-[10px] text-indigo-400">{t("inbox.bulkWaNote")}</span>
              </div>
            </div>
          ) : selectMode ? (
            <div className="shrink-0 text-[11px] text-slate-400">{t("inbox.bulkModeHint")}</div>
          ) : null}
          {/* IN4d: handover queue ordering — longest wait (default)
              or SLA risk (effective deadline order, server-side). */}
          {smartFolder === "handover" ? (
            <div className="flex shrink-0 items-center gap-1.5 pt-1 text-[11px]">
              <span className="text-slate-400">{t("inbox.sortLabel")}</span>
              <button className={`rounded-full px-2 py-0.5 font-semibold ring-1 ${filters.sort !== "sla_risk" ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-600 ring-slate-200"}`} onClick={() => onFilter({ sort: "recent" })}>{t("inbox.sortWaiting")}</button>
              <button className={`rounded-full px-2 py-0.5 font-semibold ring-1 ${filters.sort === "sla_risk" ? "bg-red-600 text-white ring-red-600" : "bg-white text-slate-600 ring-slate-200"}`} title={t("inbox.sortSlaTitle")} onClick={() => onFilter({ sort: "sla_risk" })}>{t("inbox.sortSla")}</button>
            </div>
          ) : null}
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pt-1 pr-0.5">
            {conversations.length === 0 ? (
              smartFolder === "vip" && !folderCounts?.vipThresholdMinor ? (
                <EmptyState title={t("inbox.vipNotSet")} description={t("inbox.inbZVipEmptyDesc")} />
              ) : smartFolder === "vip" ? (
                <EmptyState title={t("inbox.noVipConvs")} description={t("inbox.noVipHint")} />
              ) : smartFolder === "sla" ? (
                <EmptyState title={t("inbox.noSlaBreach")} description={t("inbox.noSlaBreachHint")} />
              ) : smartFolder === "handover" ? (
                <EmptyState title={t("inbox.handoverEmpty")} description={t("inbox.handoverEmptyHint")} />
              ) : smartFolder === "snoozed" ? (
                <EmptyState title={t("inbox.noSnoozed")} description={t("inbox.noSnoozedHint")} />
              ) : (
                <EmptyState title={t("inbox.noConvs")} description={t("inbox.inbZNoConvsDesc")} />
              )
            ) : conversations.slice(0, visibleCount).map((c, ci) => {
              const isSelected = selectedIds.has(c.id);
              const isActive = active?.id === c.id;
              const isFocused = focusedIdx === ci;
              const isOnline = c.channel === "webchat" && isVisitorOnline(c);
              const isSlaBreach = !c.firstResponseAt && c.status !== "closed" && c.createdAt && Date.now() - new Date(c.createdAt).getTime() > (settings?.slaFirstResponseMinutes ?? 60) * 60000;

              return (
                <button
                  key={c.id}
                  id={`conv-${c.id}`}
                  onClick={() => {
                    if (selectMode) {
                      toggleSelect(c.id);
                      return;
                    }
                    setFocusedIdx(ci);
                    openConversation(c);
                  }}
                  className={`group relative flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition-all duration-150 ${
                    selectMode ? "pl-9" : ""
                  } ${
                    isSelected
                      ? "border-indigo-500 bg-indigo-50/40 shadow-sm ring-1 ring-indigo-400"
                      : isActive
                      ? "border-brand-500 bg-gradient-to-r from-brand-50/50 via-white to-white shadow-sm ring-1 ring-brand-500/30"
                      : "border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50/50 hover:shadow-xs"
                  } ${isFocused ? "ring-2 ring-indigo-300" : ""}`}
                >
                  {selectMode ? (
                    <span
                      className={`absolute left-2.5 top-4 flex h-4.5 w-4.5 items-center justify-center rounded-md border text-[11px] font-bold transition ${
                        isSelected ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white text-transparent"
                      }`}
                      style={{ width: 18, height: 18 }}
                    >
                      ✓
                    </span>
                  ) : null}

                  {/* Contact Avatar */}
                  <ContactAvatar
                    name={c.contactName ?? c.contactPhone}
                    channel={c.channel}
                    size="md"
                    isOnline={isOnline}
                  />

                  {/* Conversation Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="truncate font-semibold text-slate-900 group-hover:text-brand-600 transition-colors">
                        {c.contactName ?? c.contactPhone ?? t("inbox.noName")}
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        {c.lastMessageAt ? (
                          <span className="text-[10px] text-slate-400 font-medium">
                            {fmtTime(locale, c.lastMessageAt)}
                          </span>
                        ) : null}
                        {c.unreadCount > 0 ? (
                          <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-gradient-to-r from-brand-600 to-indigo-600 px-1.5 text-[10px] font-bold text-white shadow-xs animate-pulse">
                            {c.unreadCount}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <p className={`truncate text-xs mt-0.5 ${c.unreadCount > 0 ? "font-medium text-slate-800" : "text-slate-500"}`}>
                      {c.lastMessagePreview || t("inbox.noMessages")}
                    </p>

                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10.5px]">
                      <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium ${
                        c.status === "open" ? "bg-emerald-50 text-emerald-700" : c.status === "pending" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"
                      }`}>
                        {c.status === "open" ? t("inbox.stOpen") : c.status === "pending" ? t("inbox.stPending") : t("inbox.stClosed")}
                      </span>

                      {isSlaBreach ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-1.5 py-0.5 font-semibold text-red-600 ring-1 ring-red-200">
                          ⏰ SLA
                        </span>
                      ) : null}

                      {isActivelySnoozed(c.snoozedUntil) ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 font-semibold text-indigo-700 ring-1 ring-indigo-200" title={`${t("inbox.snoozedUntilWord")} ${fmtDateTime(locale, c.snoozedUntil as string)}`}>
                          😴 Snoozed
                        </span>
                      ) : null}

                      {smartFolder === "handover" && c.handoverReason ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-700 ring-1 ring-amber-200">
                          {handoverReasonLabels(locale)[c.handoverReason] ?? c.handoverReason} · {t("inbox.inbZWaitingMinutes", { count: fmtNumber(locale, Math.max(0, Math.floor((handoverTick - new Date(c.handoverAt ?? c.updatedAt ?? handoverTick).getTime()) / 60000))) })}
                        </span>
                      ) : null}

                      {c.channel === "whatsapp" && c.whatsappWindow ? (
                        c.whatsappWindow.open ? (
                          <span className="text-emerald-600 font-medium" title={t("inbox.windowOpen24")}>🟢 Window</span>
                        ) : (
                          <span className="text-amber-600 font-medium" title={t("inbox.windowClosedTpl")}>🔒 Window</span>
                        )
                      ) : null}

                      {c.spamFlag ? <span className="font-semibold text-amber-600">🚫 Spam</span> : null}
                      {c.priority === "high" ? <span className="font-semibold text-red-600">{t("inbox.urgentFire")}</span> : null}
                      {c.mood === "negative" ? <span title={moodTitle(locale)}>😡</span> : c.mood === "positive" ? <span title={moodTitle(locale)}>😃</span> : null}

                      {c.assignedUserId ? (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500 font-medium">
                          👤 {memberName(c.assignedUserId).split(" ")[0]}
                        </span>
                      ) : null}

                      {(c.tags ?? []).slice(0, 2).map((t) => (
                        <span key={t} className="rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
                          #{t}
                        </span>
                      ))}
                      {(c.tags ?? []).length > 2 ? (
                        <span className="text-[10px] text-slate-400">+{c.tags!.length - 2}</span>
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })}
            {visibleCount < conversations.length ? <div ref={sentinelRef} className="py-2 text-center text-xs text-slate-400">{t("inbox.inbZLoadingMore", { rest: fmtNumber(locale, conversations.length - visibleCount) })}</div> : nextCursor ? (
              <div ref={sentinelRef} className="py-2 text-center">
                <button className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50" disabled={loadingMore} onClick={() => void loadMoreConversations()}>
                  {loadingMore ? t("inbox.loadingDots") : t("inbox.loadMoreConvs")}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* ---- Thread ---- */}
        <div className={`${mobileChat ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-col`}>
          {active ? (
            <div
              className="card relative flex min-h-0 flex-1 flex-col gap-3 p-4"
              onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
              onDrop={(e) => {
                e.preventDefault(); setDragOver(false);
                if (composerMode === "note") return;
                const files = Array.from(e.dataTransfer.files ?? []);
                if (files.length) void sendMediaFiles(files);
              }}
            >
              {dragOver ? (
                <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-[inherit] bg-brand-500/10 ring-2 ring-inset ring-brand-500">
                  <span className="rounded-lg bg-white px-3 py-2 text-sm font-semibold shadow">{t("inbox.dropFile")}</span>
                </div>
              ) : null}
              {/* Modern Sleek Thread Header with Dropdown Actions */}
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2.5 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 shadow-2xs lg:hidden hover:bg-slate-50"
                    onClick={() => setMobileChat(false)}
                    title={t("inbox.backToList")}
                  >
                    <span>←</span> <span className="hidden xs:inline">{t("inbox.listWord")}</span>
                  </button>
                  <ContactAvatar
                    name={active.contactName ?? active.contactPhone}
                    channel={active.channel}
                    size="md"
                    isOnline={active.channel === "webchat" && isVisitorOnline(active)}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-bold text-slate-900 text-sm sm:text-base truncate">
                        {active.contactName ?? active.contactPhone ?? t("inbox.customerFallback")}
                      </span>
                      {/* Online Indicator */}
                      <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Online
                      </span>
                    </div>

                    {/* Customer Tags & Stage Row */}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <ChannelChip channel={active.channel} />
                      {active.tags?.includes("vip") && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800 ring-1 ring-amber-200">
                          👑 VIP
                        </span>
                      )}
                      {active.mood && moodChip(active.mood)}

                      {/* Interactive Pipeline Stage Dropdown */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => { setStageMenuOpen((v) => !v); setActionMenuOpen(false); }}
                          className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2 py-0.5 text-[10.5px] font-bold text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-100 transition"
                          title={t("inbox.stageChange")}
                        >
                          <span>🏷️ {active.pipelineStage ? active.pipelineStage.toUpperCase() : "NEW"}</span>
                          <span className="text-[8px]">▾</span>
                        </button>
                        {stageMenuOpen && (
                          <div className="absolute left-0 top-full mt-1.5 z-40 w-44 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl animate-in fade-in zoom-in-95">
                            {[
                              { id: "new", label: "🆕 New Lead" },
                              { id: "talking", label: "💬 Talking" },
                              { id: "ordered", label: "🛒 Order Placed" },
                              { id: "delivered", label: "✅ Delivered" },
                              { id: "repeat", label: "🔁 Repeat" },
                            ].map((st) => (
                              <button
                                key={st.id}
                                type="button"
                                className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs font-semibold transition ${
                                  active.pipelineStage === st.id ? "bg-indigo-50 text-indigo-700 font-bold" : "text-slate-700 hover:bg-slate-50"
                                }`}
                                onClick={() => {
                                  setStageMenuOpen(false);
                                  patchConversation({ pipelineStage: st.id });
                                }}
                              >
                                {st.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Header Actions: Mobile Tab, Status, Action Dropdown */}
                <div className="flex items-center gap-1.5 sm:gap-2">
                  {/* On Mobile: Segmented Tab for Chat vs Customer Info */}
                  <div className="flex items-center rounded-xl bg-slate-100 p-0.5 text-xs font-semibold lg:hidden">
                    <button
                      className={`rounded-lg px-2.5 py-1 transition-all ${
                        mobileTab === "chat" ? "bg-white text-slate-900 shadow-2xs font-bold" : "text-slate-500"
                      }`}
                      onClick={() => setMobileTab("chat")}
                    >{t("inbox.chatTab")}</button>
                    <button
                      className={`rounded-lg px-2.5 py-1 transition-all ${
                        mobileTab === "customer" ? "bg-white text-indigo-700 shadow-2xs font-bold" : "text-slate-500"
                      }`}
                      onClick={() => setMobileTab("customer")}
                    >{t("inbox.profileTab")}</button>
                  </div>

                  {/* Phone Call Button */}
                  {active.contactPhone ? (
                    <a
                      href={`tel:${active.contactPhone}`}
                      className="hidden sm:flex rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 hover:text-slate-900 shadow-2xs transition"
                      title={t("inbox.callDirect")}
                    >
                      📞
                    </a>
                  ) : null}

                  {/* Customer Profile Button for Tablet/Desktop */}
                  <button
                    className="hidden sm:flex xl:hidden items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50"
                    onClick={() => setCtxOpen(true)}
                  >
                    <span>👤</span> <span>{t("inbox.profileWord")}</span>
                  </button>

                  {/* Status Switcher pill */}
                  <div className="hidden xs:flex items-center rounded-xl bg-slate-100 p-1 text-xs font-semibold">
                    {(["open", "pending", "closed"] as const).map((s) => (
                      <button
                        key={s}
                        className={`rounded-lg px-2 sm:px-2.5 py-1 transition-all ${
                          active.status === s ? "bg-white text-slate-900 shadow-2xs font-bold" : "text-slate-500 hover:text-slate-900"
                        }`}
                        onClick={() => patchConversation({ status: s })}
                      >
                        {s === "open" ? t("inbox.stOpenPlain") : s === "pending" ? t("inbox.stPendingPlain") : t("inbox.stClosedPlain")}
                      </button>
                    ))}
                  </div>

                  {/* ⚡ Organized Action Menu Dropdown */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => { setActionMenuOpen((v) => !v); setStageMenuOpen(false); }}
                      className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold shadow-2xs transition ${
                        actionMenuOpen
                          ? "border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-500/20"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300"
                      }`}
                      title={t("inbox.actionMenu")}
                    >
                      <span>⚡</span>
                      <span className="hidden sm:inline">{t("inbox.actionsWord")}</span>
                      <span className="text-[10px]">▾</span>
                    </button>

                    {actionMenuOpen && (
                      <div className="absolute right-0 top-full mt-2 z-40 w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl ring-1 ring-slate-900/5 animate-in fade-in zoom-in-95">
                        <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("inbox.ordersCourier")}</div>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-sky-50 hover:text-sky-700 transition disabled:opacity-50"
                          disabled={busy !== ""}
                          onClick={() => { setActionMenuOpen(false); void shareTracking(); }}
                        >
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-100 text-sky-700 text-sm">🚚</span>
                          <div>
                            <div className="font-bold text-slate-900">{t("inbox.sendTracking")}</div>
                            <div className="text-[10px] text-slate-400">{t("inbox.shareTrackingCode")}</div>
                          </div>
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-violet-50 hover:text-violet-700 transition disabled:opacity-50"
                          disabled={busy !== ""}
                          onClick={() => { setActionMenuOpen(false); void bookCourier(); }}
                        >
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100 text-violet-700 text-sm">📦</span>
                          <div>
                            <div className="font-bold text-slate-900">{t("inbox.courierBooking")}</div>
                            <div className="text-[10px] text-slate-400">{t("inbox.courierBookSub")}</div>
                          </div>
                        </button>

                        <div className="my-1.5 border-t border-slate-100" />
                        <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("inbox.billingData")}</div>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-amber-50 hover:text-amber-800 transition disabled:opacity-50"
                          disabled={busy !== ""}
                          onClick={() => { setActionMenuOpen(false); void requestRefund(); }}
                        >
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-800 text-sm">💸</span>
                          <div>
                            <div className="font-bold text-slate-900">{t("inbox.refundRequest")}</div>
                            <div className="text-[10px] text-slate-400">{t("inbox.refundSub")}</div>
                          </div>
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 transition disabled:opacity-50"
                          disabled={busy !== ""}
                          onClick={() => { setActionMenuOpen(false); void exportCsv(); }}
                        >
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-700 text-sm">⬇️</span>
                          <div>
                            <div className="font-bold text-slate-900">{t("inbox.csvExport")}</div>
                            <div className="text-[10px] text-slate-400">{t("inbox.csvExportSub")}</div>
                          </div>
                        </button>

                        <div className="my-1.5 border-t border-slate-100" />
                        <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("inbox.moderation")}</div>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50 transition disabled:opacity-50"
                          disabled={busy !== ""}
                          onClick={() => { setActionMenuOpen(false); markSpam(); }}
                        >
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-100 text-rose-700 text-sm">🚫</span>
                          <div>
                            <div className="font-bold text-rose-700">{t("inbox.markSpamClose")}</div>
                            <div className="text-[10px] text-rose-400">{t("inbox.markSpamSub")}</div>
                          </div>
                        </button>

                        {active.status !== "closed" ? (
                          <div className="mt-2 rounded-xl bg-slate-50 p-2 text-xs">
                            <label className="block text-[11px] font-bold text-slate-700 mb-1">{t("inbox.closeWithOutcome")}</label>
                            <div className="flex gap-1.5">
                              <select
                                className="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                                value={closeOutcome}
                                onChange={(e) => setCloseOutcome(e.target.value)}
                              >
                                <option value="sale">{t("inbox.outcomeSale")}</option>
                                <option value="no_sale_price">{t("inbox.outcomeNoSalePrice")}</option>
                                <option value="no_sale_stock">{t("inbox.outcomeNoSaleStock")}</option>
                                <option value="no_sale_undecided">{t("inbox.outcomeNoSaleUndecided")}</option>
                                <option value="support_resolved">{t("inbox.outcomeSupport")}</option>
                                <option value="spam">🚫 Spam</option>
                                <option value="other">{t("inbox.outcomeOther")}</option>
                              </select>
                              <button
                                type="button"
                                className="rounded-lg bg-slate-900 px-3 py-1 font-bold text-white hover:bg-slate-800 transition"
                                onClick={() => { setActionMenuOpen(false); patchConversation({ status: "closed", outcome: closeOutcome }); }}
                              >{t("inbox.closeCheck")}</button>
                            </div>
                          </div>
                        ) : active.outcome ? (
                          <div className="mt-2 rounded-xl bg-slate-50 p-2 text-center text-xs font-medium text-slate-500">{t("inbox.outcomeLabel")}<span className="font-bold text-slate-700">{active.outcome}</span>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Thread Action Controls */}
              <div className="flex shrink-0 flex-wrap items-center gap-1.5 rounded-xl bg-slate-50/80 p-2 text-xs ring-1 ring-slate-100">
                <div className="flex items-center gap-1">
                  <span className="text-slate-400 font-medium ml-1">{t("inbox.stageLabel")}</span>
                  <select
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 shadow-xs"
                    value={active.pipelineStage ?? "new"}
                    onChange={(e) => patchConversation({ pipelineStage: e.target.value })}
                    title="Pipeline Stage"
                  >
                    <option value="new">🆕 New</option>
                    <option value="talking">💬 Talking</option>
                    <option value="ordered">🛒 Ordered</option>
                    <option value="delivered">✅ Delivered</option>
                    <option value="repeat">🔁 Repeat</option>
                  </select>
                </div>

                <div className="h-4 w-px bg-slate-200 mx-1" />

                {/* CX5 (ported): Later / Take over / Back to AI / Timer */}
                {isActivelySnoozed(active.snoozedUntil) ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="rounded-lg bg-indigo-50 px-2.5 py-1.5 font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200/70">😴 {t("inbox.snoozedUntilWord")} {fmtDateTime(locale, active.snoozedUntil as string)}</span>
                    <button className={cx5Btn} onClick={() => void conversationAction("unsnooze")}>{t("inbox.wakeNow")}</button>
                  </span>
                ) : (
                  <span className="relative hidden sm:inline-flex">
                    <button className={cx5Btn} onClick={() => { setShowSnoozeMenu((v) => !v); setShowTimerMenu(false); }}>😴 Later</button>
                    {showSnoozeMenu ? <span className={cx5Menu}>{renderSnoozeControls()}</span> : null}
                  </span>
                )}
                <button className={cx5Btn} onClick={() => void conversationAction("take-over")}>🙋 Take over</button>
                {active.autoReplyPaused ? (
                  <button className="rounded-lg bg-emerald-50 px-2.5 py-1.5 font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200/70 transition hover:bg-emerald-100" onClick={() => void conversationAction("back-to-ai")}>🤖 Back to AI</button>
                ) : null}
                <span className="relative hidden sm:inline-flex">
                  <button className={cx5Btn} onClick={() => { setShowTimerMenu((v) => !v); setShowSnoozeMenu(false); }}>⏱️ Timer{timerRemaining !== null ? t("inbox.inbZTimerMinutes", { minutes: fmtNumber(locale, timerRemaining) }) : ""}</button>
                  {showTimerMenu ? <span className={cx5Menu}>{renderTimerControls()}</span> : null}
                </span>
                <span className="relative inline-flex">
                  <button className={cx5Btn} onClick={() => { setShowMacroMenu((v) => !v); setShowSnoozeMenu(false); setShowTimerMenu(false); }} title={t("inbox.inbZMacroTitle")}>{t("inbox.inbZMacroBtn")}</button>
                  {showMacroMenu ? (
                    <span className={cx5Menu}>
                      <span className="px-2 pt-1 text-[11px] font-bold text-slate-400">{t("inbox.macroRunHere")}</span>
                      {macros.length === 0 ? <span className="px-2 py-1.5 text-xs text-slate-400">{t("inbox.noMacros")}</span> : macros.map((m) => (
                        <button key={m.id} className={cx5MenuItem} disabled={busy === "macro"} onClick={() => void runMacroOnActive(m)}>
                          ⚡ {m.name}{m.shared ? t("inbox.teamSuffix") : ""}
                          <span className="block truncate text-[10px] font-normal text-slate-400">{m.steps.map((s) => macroStepSummary(s, { quickReplyTitle: (id) => quickReplies.find((q) => q.id === id)?.title, memberName: (id) => members.find((mm) => mm.user.id === id)?.user.name ?? undefined })).join(" → ")}</span>
                        </button>
                      ))}
                    </span>
                  ) : null}
                </span>
                <span className="hidden sm:inline-flex">{renderAssignSelect()}</span>
                <span className="hidden sm:inline-flex">{renderLeadSelect()}</span>
                <span className="relative inline-flex sm:hidden">
                  <button className={cx5Btn} onClick={() => setShowMoreMenu((v) => !v)} aria-label={t("inbox.inbZMoreActions")}>{t("inbox.inbZMoreBtn")}</button>
                  {showMoreMenu ? (
                    <span className={`${cx5Menu} !w-72`}>
                      {!isActivelySnoozed(active.snoozedUntil) ? (<><span className="px-2 pt-1 text-[11px] font-bold text-slate-400">😴 Later</span>{renderSnoozeControls()}</>) : null}
                      <span className="px-2 pt-1.5 text-[11px] font-bold text-slate-400">{t("inbox.timerWord")}</span>
                      {renderTimerControls()}
                    </span>
                  ) : null}
                </span>

                <button
                  className="flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 font-semibold text-sky-700 hover:bg-sky-100 transition disabled:opacity-50"
                  disabled={busy !== ""}
                  onClick={async () => {
                    const orgId = getOrganizationId(); if (!orgId) return; setBusy("track");
                    try { const r = await apiFetch<any>(`/organizations/${orgId}/inbox/conversations/${active.id}/share-tracking`, { method: "POST" }); setNotice(t("inbox.trackingSent", { code: r.trackingCode })); await refreshActive(); }
                    catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setBusy(""); }
                  }}
                >
                  <span>🚚</span> <span>{t("inbox.trackingWord")}</span>
                </button>
              </div>

              {/* IN3: the last macro run's per-step report — exactly
                  which steps happened, where a failed run stopped. */}
              {macroResult && macroResult.conversationId === active.id ? (
                <div className={`shrink-0 rounded-xl p-2.5 text-xs ring-1 ${macroResult.success ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-red-50 text-red-800 ring-red-200"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold">{formatMacroRunResult(macroResult)}</span>
                    <button className="shrink-0 font-semibold hover:underline" onClick={() => setMacroResult(null)}>{t("inbox.stClosedPlain")}</button>
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {macroRunStepLines(macroResult).map((line, i) => <li key={i}>{line}</li>)}
                  </ul>
                </div>
              ) : null}

              <div className="flex shrink-0 flex-wrap gap-1.5 lg:hidden">
                <button className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium disabled:opacity-50" disabled={!myId} onClick={() => patchConversation({ assignedUserId: myId })}>{t("inbox.assignToMe")}</button>
                {active.contactPhone ? <a className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700" href={`tel:${active.contactPhone}`}>{t("inbox.callBtn")}</a> : null}
                <button className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium" onClick={() => setPaletteOpen(true)}>⌘K</button>
              </div>

              {/* U5 quick actions + outcome controls (CX5: the
                  pipeline-stage select moved UP into the action
                  bar as 🎯 Lead — it is not duplicated here). */}
              <div className="toolbar-v2 text-xs">
                <button className="rounded-lg bg-sky-50 px-2.5 py-1.5 font-medium text-sky-700 ring-1 ring-inset ring-sky-200/70 transition hover:bg-sky-100" disabled={busy !== ""}
                  onClick={async () => {
                    const orgId = getOrganizationId(); if (!orgId) return; setBusy("track");
                    try { const r = await apiFetch<any>(`/organizations/${orgId}/inbox/conversations/${active.id}/share-tracking`, { method: "POST" }); setNotice(t("inbox.trackingSent", { code: r.trackingCode })); await refreshActive(); }
                    catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setBusy(""); }
                  }}
                >
                  <span>🚚</span> <span>{t("inbox.trackingWord")}</span>
                </button>

                <button
                  className="flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 font-semibold text-violet-700 hover:bg-violet-100 transition disabled:opacity-50"
                  disabled={busy !== ""}
                  onClick={async () => {
                    const orgId = getOrganizationId(); if (!orgId) return;
                    const order = context?.orders?.[0];
                    if (!order) { setError(t("inbox.courierNeedOrder")); return; }
                    setBusy("courier");
                    try {
                      const conns = await apiFetch<any[]>(`/organizations/${orgId}/courier/connections`).catch(() => []);
                      const provider = (conns as any[])?.find((c: any) => c.status === "CONNECTED")?.provider;
                      if (!provider) { setError(t("inbox.courierNoneConnected")); return; }
                      const address = (order as any).address || window.prompt(t("inbox.deliveryAddressPrompt")) || "";
                      if (!address) return;
                      const r = await apiFetch<any>(`/organizations/${orgId}/courier/shipments`, { method: "POST", body: JSON.stringify({ orderId: order.id, provider, recipientAddress: address }) });
                      setNotice(t("inbox.courierBooked", { provider, code: r.trackingCode ?? "" }));
                      await refreshActive();
                    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setBusy(""); }
                  }}
                >
                  <span>📦</span> <span>{t("inbox.courierBooking")}</span>
                </button>

                <button
                  className="flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 font-semibold text-amber-700 hover:bg-amber-100 transition disabled:opacity-50"
                  disabled={busy !== ""}
                  onClick={async () => {
                    const orgId = getOrganizationId(); if (!orgId) return;
                    const reason = window.prompt(t("inbox.refundReasonPrompt")) ?? "";
                    setBusy("refund");
                    try { await apiFetch(`/organizations/${orgId}/inbox/conversations/${active.id}/refund-request`, { method: "POST", body: JSON.stringify({ reason }) }); setNotice(t("inbox.refundSent")); await refreshActive(); }
                    catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setBusy(""); }
                  }}
                >
                  <span>💸</span> <span>{t("inbox.refundWord")}</span>
                </button>

                <button
                  className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-100 transition disabled:opacity-50"
                  disabled={busy !== ""}
                  onClick={async () => {
                    const orgId = getOrganizationId(); if (!orgId) return;
                    try {
                      const token = localStorage.getItem("accessToken");
                      const base = (window as any).location.origin;
                      const res = await fetch(`${base}/backend/organizations/${orgId}/inbox/conversations/${active.id}/export?format=csv`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
                      if (!res.ok) throw new Error(t("inbox.exportFailed"));
                      const blob = await res.blob();
                      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `conversation-${active.id}.csv`; a.click(); URL.revokeObjectURL(a.href);
                    } catch (e) { setError(e instanceof Error ? e.message : t("inbox.exportFailed")); }
                  }}
                >
                  <span>⬇️</span> <span>CSV</span>
                </button>

                <button
                  className="flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 font-semibold text-red-600 hover:bg-red-100 transition disabled:opacity-50"
                  disabled={busy !== ""}
                  onClick={() => { if (window.confirm(t("inbox.spamConfirm"))) void patchConversation({ spamFlag: true, status: "closed", outcome: "spam" }); }}
                >
                  <span>🚫</span> <span>Spam</span>
                </button>

                {active.status !== "closed" ? (
                  <div className="ml-auto flex items-center gap-1.5">
                    <select
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 shadow-xs"
                      value={closeOutcome}
                      onChange={(e) => setCloseOutcome(e.target.value)}
                      title={t("inbox.closeWithOutcome")}
                    >
                      <option value="sale">{t("inbox.outcomeSale")}</option>
                      <option value="no_sale_price">{t("inbox.outcomeNoSalePrice")}</option>
                      <option value="no_sale_stock">{t("inbox.outcomeNoSaleStock")}</option>
                      <option value="no_sale_undecided">{t("inbox.outcomeNoSaleUndecided")}</option>
                      <option value="support_resolved">{t("inbox.outcomeSupport")}</option>
                      <option value="spam">🚫 Spam</option>
                      <option value="other">{t("inbox.outcomeOther")}</option>
                    </select>
                    <button
                      className="rounded-lg bg-slate-900 px-3 py-1 font-semibold text-white shadow-xs hover:bg-slate-800 transition"
                      onClick={() => patchConversation({ status: "closed", outcome: closeOutcome })}
                    >{t("inbox.closeCheck")}</button>
                  </div>
                ) : active.outcome ? (
                  <span className="ml-auto font-medium text-slate-500">{t("inbox.outcomeLabel")} {active.outcome}</span>
                ) : null}
              </div>

              {mobileTab === "customer" ? (
                <div className="min-h-0 flex-1 overflow-y-auto p-1 lg:hidden">
                  {renderCustomerContent(false)}
                </div>
              ) : (
                <>
                  {/* Inbox Next-Gen P1: the thread's ONE scroll region —
                      banners + messages + drafts scroll together; the
                      header rows above and the composer below stay put. */}
                  <div ref={threadScrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
              {active.autoReplyPaused ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700 ring-1 ring-red-100">
                  <span>{t("inbox.autopilotPaused")}</span>
                  <button className="rounded-lg bg-white px-2 py-1 font-semibold text-red-600 ring-1 ring-red-200" onClick={() => patchConversation({ autoReplyPaused: false })}>{t("inbox.resumeBtn")}</button>
                </div>
              ) : null}

              {active.channel === "whatsapp" ? (
                active.whatsappWindow?.open ? (
                  <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{t("inbox.inbZWaWindowOpen", { left: windowLeft(active.whatsappWindow) })}</p>
                ) : (
                  <div className="space-y-2 rounded-lg bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                    <p className="font-semibold">{t("inbox.waWindowClosed")}</p>
                    {templates.length ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <select className="input !w-auto flex-1 bg-white" value={tplId} onChange={(e) => setTplId(e.target.value)}>
                          {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
                        </select>
                        <input className="input !w-auto flex-1 bg-white" placeholder={t("inbox.inbZTplVarsPlaceholder")} value={tplVars} onChange={(e) => setTplVars(e.target.value)} />
                        <button className="btn-warning btn-sm" disabled={busy !== ""} onClick={sendTemplate}>{busy === "template" ? t("inbox.sendingDots") : t("inbox.templateSendBtn")}</button>
                      </div>
                    ) : <p>{t("inbox.noTemplatesReg")}</p>}
                  </div>
                )
              ) : null}

              {(() => {
                const merged = [...presence];
                for (const [uid, lo] of Object.entries(liveOthers)) {
                  if (Date.now() - lo.at > 20000) continue;
                  if (!merged.some((p) => p.userId === uid)) merged.push({ userId: uid, name: memberName(uid), typing: lo.typing });
                  else { const found = merged.find((p) => p.userId === uid); if (found) found.typing = lo.typing; }
                }
                if (!merged.length) return null;
                return (
                  <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 ring-1 ring-amber-100">
                    ⚠️ {merged.map((o) => o.typing ? t("inbox.inbZTypingNow", { name: o.name }) : t("inbox.inbZViewingNow", { name: o.name })).join(" · ")}{t("inbox.inbZPresenceSuffix")}
                  </p>
                );
              })()}
              <div className="space-y-3 rounded-2xl bg-slate-50/70 p-3 sm:p-4 ring-1 ring-slate-100">
              {pinnedMessages.length ? (
                <div className="rounded-xl bg-amber-50 px-2.5 py-1.5 ring-1 ring-amber-200">
                  <div className="text-[10px] font-bold text-amber-700">📌 Pinned ({pinnedMessages.length})</div>
                  {pinnedMessages.map((p) => (
                    <button key={p.id} type="button" className="block w-full truncate text-left text-[11px] text-amber-800 hover:underline" title={t("inbox.goToMessage")} onClick={() => jumpToMessage(p.id)}>{p.snippet}</button>
                  ))}
                </div>
              ) : null}
              <div className="thread-canvas thread-scroll flex flex-col gap-2 rounded-2xl p-3 ring-1 ring-inset ring-slate-200/50">
                {timeline.map((item, i) => {
                  const prevDay = i > 0 ? new Date(timeline[i - 1].at).toDateString() : null;
                  const thisDay = new Date(item.at).toDateString();
                  const daySep = prevDay !== thisDay ? (
                    <div className="flex items-center gap-3 py-2">
                      <div className="h-px flex-1 bg-slate-200" />
                      <span className="rounded-full bg-white px-3 py-0.5 text-[11px] font-semibold text-slate-400 shadow-xs ring-1 ring-slate-200/60">
                        {dayLabel(item.at, locale)}
                      </span>
                      <div className="h-px flex-1 bg-slate-200" />
                    </div>
                  ) : null;

                  if (item.kind === "note") {
                    const n = item.note;
                    return (
                      <React.Fragment key={`note-${n.id}`}>
                        {daySep}
                        <div className="flex justify-center my-1.5">
                          <div className="w-full max-w-[88%] rounded-2xl border border-amber-200/90 bg-gradient-to-br from-amber-50 to-amber-100/60 p-3 shadow-xs">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="flex items-center gap-1 font-bold text-amber-800">
                                <span>🔒</span> <span>{t("inbox.teamPrivateNote")}</span>
                              </span>
                              <span className="text-[10px] text-amber-600/80 font-medium">
                                {fmtTime(locale, n.createdAt)}
                              </span>
                            </div>
                            <div className="mt-1.5 whitespace-pre-wrap text-sm text-slate-800 font-normal">
                              {n.content}
                            </div>
                            <div className="mt-1.5 flex items-center gap-1 text-[10.5px] text-amber-700 font-semibold">
                              <span>✍️ {memberName(n.authorUserId)}</span>
                            </div>
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  }
                  const m = item.message;
                  const isIncoming = m.direction === "in";
                  const prevItem = i > 0 ? timeline[i - 1] : null;
                  const grouped = Boolean(prevItem && prevItem.kind === "message" && prevItem.message.direction === m.direction && prevDay === thisDay);

                  return (
                    <React.Fragment key={m.id}>
                      {daySep}
                      <div id={`msg-${m.id}`} className={`${m.direction === "in" ? "flex justify-start" : "flex justify-end"} items-end gap-2${grouped ? " -mt-1" : ""}`}>
                      {isIncoming ? (<div className="mb-1 shrink-0"><ContactAvatar name={active.contactName ?? active.contactPhone} channel={active.channel} size="sm" /></div>) : null}
                    <div className={`max-w-[80%] ${m.direction === "in" ? "inbox-msg-in" : m.status === "failed" ? "inbox-msg-failed" : "inbox-msg-out"}${m.status === "sending" ? " opacity-70" : ""}${highlightMsgId === m.id ? " ring-2 ring-amber-400" : ""}`}>
                      {m.quote ? (
                        <button type="button" className="mb-1 block w-full rounded border-l-4 border-indigo-300 bg-white/60 px-1.5 py-1 text-left text-[11px] text-slate-500" title={t("inbox.goToOriginal")} onClick={() => jumpToMessage(m.quote!.id)}>
                          {m.quote.unavailable ? t("inbox.quoteNotFound") : <>↩️ {m.quote.direction === "in" ? t("inbox.customerFallback") : t("inbox.quoteYou")}: {m.quote.snippet}</>}
                        </button>
                      ) : null}
                      {(m.mediaId || m.mediaUrl || m.mediaStorageKey) && m.type !== "text" ? <div className="mb-1"><MediaView convId={active.id} message={m} /></div> : null}
                      {m.content ? <div className="whitespace-pre-wrap">{m.type === "template" ? `🧩 ${m.content}` : m.content}</div> : (m.mediaId || m.mediaUrl || m.mediaStorageKey) ? null : <div>[{m.type}]</div>}
                      <div className={`mt-0.5 text-[10px] ${m.direction === "in" ? "text-slate-400" : "opacity-75"}`}>
                        {fmtDateTime(locale, m.createdAt)}{(() => { const t = m.direction === "out" ? deliveryTick(active.channel, m, locale) : null; return t?.blue ? <span className="font-bold text-sky-500">{` · ${t.glyph} ${t.label}`}</span> : statusIcon(m); })()}{m.sentByAiDraft ? t("inbox.inbZFromAiDraft") : ""}{m.autoReply ? t("inbox.inbZAutoReplyMark") : ""}{!m.autoReply && !m.sentByAiDraft && m.sentWithAiAssist ? t("inbox.inbZAiAssistedMark") : ""}
                        {m.direction === "in" && m.intent && m.intent !== "other" ? <span className="ml-1 rounded bg-indigo-50 px-1 py-px font-semibold text-indigo-600" title={t("inbox.inbZConfidenceTitle", { pct: fmtNumber(locale, m.intentConfidence ?? 0) })}>{m.intent} · {fmtNumber(locale, m.intentConfidence ?? 0)}%</span> : null}
                        {m.direction === "in" && m.content ? <button className="ml-1 font-semibold text-indigo-500 hover:underline" onClick={() => translateMsg(m)}>{t("inbox.translateBtn")}</button> : null}
                        {m.error ? <div className="text-red-600">{m.error}</div> : null}
                        {m.status === "failed" && m.id.startsWith("local-") ? <button className="ml-1 font-bold text-red-600 underline hover:text-red-700" onClick={() => void retryLocalSend(m.id)}>{t("inbox.retrySend")}</button> : null}
                      </div>
                      {(() => { const rs = parseMessageReactions(m.reactions); return rs.length ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {rs.map((r, i) => <span key={i} className="rounded-full bg-white/80 px-1.5 py-px text-[11px] ring-1 ring-slate-200" title={r.actor === "page" ? t("inbox.yourReaction") : t("inbox.customerReaction")}>{r.emoji}</span>)}
                        </div>
                      ) : null; })()}
                      {!m.id.startsWith("local-") ? (
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-semibold text-slate-400">
                          <button type="button" className="hover:text-indigo-600" title={t("inbox.quoteReply")} onClick={() => { setQuoteTarget(m); setComposerMode("reply"); replyRef.current?.focus(); }}>↩️ Quote</button>
                          <button type="button" className="hover:text-indigo-600" title={m.pinnedAt ? t("inbox.unpin") : t("inbox.pin")} onClick={() => void togglePin(m)}>{m.pinnedAt ? t("inbox.pinnedRemove") : t("inbox.pinnedWord")}</button>
                          {canSendReaction(active.channel) ? (
                            <span className="relative">
                              <button type="button" className="hover:text-indigo-600" title={t("inbox.reactionSend")} onClick={() => setReactionFor(reactionFor === m.id ? null : m.id)}>😊 React</button>
                              {reactionFor === m.id ? (
                                <span className="absolute bottom-5 left-0 z-20 flex gap-0.5 rounded-full bg-white px-1.5 py-1 shadow ring-1 ring-slate-200">
                                  {AGENT_REACTIONS.map((e) => <button key={e} type="button" className="text-sm hover:scale-125" onClick={() => void sendReaction(m, e)}>{e}</button>)}
                                  {parseMessageReactions(m.reactions).some((r) => r.actor === "page") ? <button type="button" className="text-[10px] text-red-500" onClick={() => void sendReaction(m, null)}>{t("inbox.removeWord")}</button> : null}
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      {translations[m.id] ? <div className="mt-1 rounded bg-white/70 px-1.5 py-1 text-[11px] italic text-slate-600">🌐 {translations[m.id]}</div> : null}
                      {m.transcription ? <div className="mt-1 rounded bg-slate-100 px-1.5 py-1 text-[11px] text-slate-600">🎙️ {m.transcription} <span className="text-slate-400">({m.transcriptionProvider})</span></div> : null}
                      {!m.transcription && m.transcriptionStatus === "failed" ? <div className="mt-1 rounded bg-amber-50 px-1.5 py-1 text-[11px] text-amber-700">{t("inbox.voiceNoTranscript")}</div> : null}
                      {!m.transcription && m.transcriptionStatus === "unavailable" ? <div className="mt-1 rounded bg-slate-100 px-1.5 py-1 text-[11px] text-slate-500">{t("inbox.voiceTranscriptNA")}</div> : null}
                      {m.direction === "in" && (m.mediaId || m.mediaUrl || m.mediaStorageKey) && m.type === "audio" && !m.transcription ? (
                        <button className="mt-1 text-[11px] font-semibold text-indigo-600 hover:underline" disabled={busy !== ""} onClick={async () => {
                          const orgId = getOrganizationId(); if (!orgId || !active) return;
                          setBusy("transcribe");
                          try { await apiFetch(`/organizations/${orgId}/inbox/conversations/${active.id}/messages/${m.id}/transcribe`, { method: "POST" }); await refreshActive(); }
                          catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
                          finally { setBusy(""); }
                        }}>{t("inbox.voiceToText")}</button>
                      ) : null}
                      {m.direction === "in" && (m.mediaId || m.mediaUrl || m.mediaStorageKey) && m.type === "image" ? (() => {
                        const v = verifications.find((x) => x.messageId === m.id);
                        return v ? (
                          <div className={`mt-1 rounded px-1.5 py-1 text-[11px] font-medium ${v.verdict === "matched" ? "bg-green-100 text-green-800" : v.verdict === "amount_mismatch" || v.verdict === "duplicate_trxid" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                            💳 {t("inbox.verifyWord")} {v.verdict}{v.trxId ? ` · TrxID ${v.trxId}` : ""}{v.amountMinor ? ` · ${money(v.amountMinor, "BDT", locale)}` : ""}{v.expectedAmountMinor ? t("inbox.inbZExpectedPart", { amount: money(v.expectedAmountMinor, "BDT", locale) }) : ""}{v.flags?.length ? ` · ⚠️ ${v.flags.join(", ")}` : ""}
                          </div>
                        ) : (
                          <button className="mt-1 text-[11px] font-semibold text-indigo-600 hover:underline" disabled={busy !== ""} onClick={async () => {
                            const orgId = getOrganizationId(); if (!orgId || !active) return;
                            setBusy("verify");
                            try { await apiFetch(`/organizations/${orgId}/inbox/conversations/${active.id}/messages/${m.id}/verify-payment`, { method: "POST" }); await refreshActive(); }
                            catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
                            finally { setBusy(""); }
                          }}>{t("inbox.verifyPayment")}</button>
                        );
                      })() : null}
                                              {m.direction === "in" && (m.mediaId || m.mediaUrl || m.mediaStorageKey) && m.type === "image" ? (
                        <div className="mt-1">
                          <button className="text-[11px] font-semibold text-indigo-600 hover:underline" disabled={busy !== "" || productMatch?.loading} onClick={() => void findProductsForMessage(m)}>
                            {productMatch?.messageId === m.id && productMatch.loading ? t("inbox.readingImage") : t("inbox.findProductByImage")}
                          </button>
                          {productMatch?.messageId === m.id && !productMatch.loading ? (
                            <div className="mt-1 space-y-1.5 rounded bg-white/80 px-2 py-2 text-[11px] text-slate-700">
                              <p className="font-medium text-slate-500">{productMatchHonesty(locale)}</p>
                              {productMatch.available === false ? (
                                <p className="text-amber-700">{productMatch.message ?? t("inbox.visionUnavailable")}</p>
                              ) : (productMatch.candidates ?? []).length === 0 ? (
                                <p>{t("inbox.noProductMatch")}</p>
                              ) : (
                                (productMatch.candidates ?? []).map((c) => (
                                  <div key={c.productId} className="flex items-center gap-2 rounded bg-slate-50 px-1.5 py-1">
                                    {c.imageUrl ? <img src={c.imageUrl} alt={c.name} className="h-9 w-9 shrink-0 rounded object-cover" /> : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-slate-200 text-base">🛍️</span>}
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate font-semibold">{c.name}</span>
                                      <span className="block">{c.priceText}</span>
                                      <span className="block text-slate-400">{c.reasons.join(" · ")}</span>
                                    </span>
                                    <button className="shrink-0 rounded-md bg-indigo-600 px-2 py-1 font-semibold text-white hover:bg-indigo-500" title={t("inbox.draftInComposer")} onClick={() => insertProductMatchDraft(c)}>{t("inbox.putInComposer")}</button>
                                  </div>
                                ))
                              )}
                              <button className="text-slate-400 hover:underline" onClick={() => setProductMatch(null)}>{t("inbox.closeBtn")}</button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      </div>
                      </div>
                    </React.Fragment>
                  );
                })}
                {timeline.length === 0 ? <p className="text-center py-6 text-sm text-slate-400 font-medium">{t("inbox.noMessages")}</p> : null}
              </div>

              {drafts.map((d) => (
                <div key={d.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-amber-700">AI Draft {d.provider === "dev-template" ? "(Dev Template)" : `(${d.provider})`}{t("inbox.inbZDraftNotSent")}</div>
                    <div className="flex gap-2">
                      <button className="rounded bg-amber-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50" disabled={busy !== ""} onClick={() => sendDraft(d)}>{t("inbox.approveSend")}</button>
                      <button className="text-xs text-slate-500" onClick={() => dismissDraft(d.id)}>{t("inbox.dismiss")}</button>
                    </div>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{d.content}</p>
                </div>
              ))}

              </div>

              {/* Modern Composer Area */}
              <div className={`relative shrink-0 rounded-2xl border transition-all ${
                composerMode === "note"
                  ? "border-amber-300 bg-amber-50/60 p-3 ring-2 ring-amber-300/40"
                  : "border-slate-200/90 bg-white p-3 shadow-xs focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20"
              }`}>
                {/* Mode toggle */}
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 text-xs font-semibold">
                    <button
                      type="button"
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1 transition-all ${
                        composerMode === "reply" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-900"
                      }`}
                      onClick={() => setComposerMode("reply")}
                    >
                      <span>💬</span> <span>{t("inbox.replyToCustomer")}</span>
                    </button>
                    <button
                      type="button"
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1 transition-all ${
                        composerMode === "note" ? "bg-amber-500 text-white shadow-xs" : "text-amber-700 hover:text-amber-900"
                      }`}
                      onClick={() => {
                        setComposerMode("note");
                        setIAmTyping(false);
                        setShowQuick(false);
                        setShowEmoji(false);
                        setShowToneMenu(false);
                        setGhost("");
                        ghostForRef.current = "";
                      }}
                    >
                      <span>🔒</span> <span>{t("inbox.teamNoteWhisper")}</span>
                    </button>
                  </div>
                  {composerMode === "note" ? (
                    <span className="text-[11px] font-semibold text-amber-700">{t("inbox.confidential")}</span>
                  ) : active.whatsappWindow?.open ? (
                    <span className="text-[11px] text-emerald-600 font-medium">{t("inbox.inbZWindowOpenChip", { left: windowLeft(active.whatsappWindow) })}</span>
                  ) : null}
                </div>
                {composerMode === "reply" && quoteTarget ? (
                  <div className="mb-2 flex items-start gap-2 rounded-lg border-l-4 border-indigo-300 bg-indigo-50 px-2 py-1.5 text-xs text-slate-600">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-indigo-700">↩️ {quoteTarget.direction === "in" ? t("inbox.quoteCustomerGen") : t("inbox.quoteYourGen")}{t("inbox.inbZQuoteReplySuffix")}</span>
                      <span className="block truncate">{String(quoteTarget.content ?? `[${quoteTarget.type}]`).slice(0, 140)}</span>
                      {active && !quoteReachesCustomer(active.channel) ? <span className="block text-amber-600">{t("inbox.quoteChannelNote")}</span> : null}
                    </span>
                    <button type="button" className="shrink-0 font-bold text-slate-400 hover:text-slate-600" title={t("inbox.dropQuote")} onClick={() => setQuoteTarget(null)}>✕</button>
                  </div>
                ) : null}
                {composerMode === "reply" && showQuick && quickMatches.length ? (
                  <div className="absolute bottom-full left-0 right-0 z-20 mb-2 max-h-52 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl">
                    <div className="px-2 py-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">{t("inbox.quickReplyMatch")}</div>
                    {quickMatches.map((q) => (
                      <button key={q.id} className="block w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-brand-50 transition" onClick={() => { setReply(renderQuick(q.content, active)); setShowQuick(false); focusComposer(); }}>
                        <span className="font-semibold text-slate-800">{q.title}</span>
                        <span className="block truncate text-xs text-slate-500 mt-0.5">{q.content}</span>
                      </button>
                    ))}
                  </div>
                ) : null}

                {composerMode === "reply" && showEmoji ? (
                  <div className="absolute bottom-full left-0 z-20 mb-2 shadow-2xl">
                    <EmojiPickerPanel onPick={(em) => { insertIntoReply(em); setShowEmoji(false); }} />
                  </div>
                ) : null}

                {composerMode === "note" && members.length > 1 ? (
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-medium text-amber-700">{t("inbox.mentionLabel")}</span>
                    {members.filter((mb) => mb.user.id !== myId).slice(0, 6).map((mb) => (
                      <button key={mb.user.id} type="button" className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-700 ring-1 ring-amber-200 hover:bg-amber-100 transition" onClick={() => { setReply((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}@${mb.user.name ?? mb.user.email} `); focusComposer(); }}>
                        @{mb.user.name ?? mb.user.email}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="flex items-end gap-2">
                  <div className="relative flex-1">
                    {ghostVisible ? (
                      <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden whitespace-pre-wrap break-words border border-transparent px-3 py-2 text-sm leading-5">
                        <span className="invisible">{reply}</span><span className="text-slate-400">{ghost}</span>
                      </div>
                    ) : null}
                    <textarea id="inbox-reply" ref={replyRef} rows={2} className={`input relative z-10 max-h-36 w-full flex-1 resize-y ${ghostVisible ? "bg-transparent" : ""} ${composerMode === "note" ? "border-amber-300 bg-amber-50 focus:border-amber-400 focus:ring-amber-400/20" : ""}`} placeholder={composerMode === "note" ? t("inbox.notePlaceholder") : t("inbox.replyPlaceholder")} value={reply}
                      onChange={(e) => { const v = e.target.value; setReply(v); setGhost(""); ghostForRef.current = ""; setPrevReply(null); setUsedQuickReplyId(null); setShowQuick(composerMode === "reply" && v.startsWith("/")); setIAmTyping(composerMode === "reply" && v.length > 0); }}
                      onBlur={() => setIAmTyping(false)}
                      onFocus={() => { if (composerMode === "reply" && reply.startsWith("/")) setShowQuick(true); }}
                      onPaste={(e) => {
                        if (composerMode !== "reply") return;
                        const files = Array.from(e.clipboardData?.files ?? []);
                        if (files.length) { e.preventDefault(); void sendMediaFiles(files); }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Tab" && ghostVisible) { e.preventDefault(); const accepted = reply + ghost; setGhost(""); ghostForRef.current = ""; ghostLastFetchRef.current = ""; setAiAssistUsed(true); setReply(accepted); focusComposer(accepted.length, accepted.length); return; }
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (composerMode === "note") { void addNote(); } else { void sendReply(); } }
                        if (e.key === "Escape") { setGhost(""); ghostForRef.current = ""; setShowQuick(false); setShowEmoji(false); setShowToneMenu(false); }
                      }} />
                  </div>
                  <button className={`${composerMode === "note" ? "btn-warning" : "btn-primary"} disabled:opacity-50`} disabled={busy !== ""} onClick={() => { if (composerMode === "note") { void addNote(); } else { void sendReply(); } }}>{composerMode === "note" ? (busy === "note" ? t("inbox.inbZNoteAdding") : t("inbox.addNote")) : busy === "send" ? t("inbox.sendingDots") : t("inbox.sendBtn")}</button>
                </div>
                {composerMode === "note" ? (
                  <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-[11px] text-amber-700" title={t("inbox.inbZMaskTitle")}>
                    <input type="checkbox" checked={noteMask} onChange={(e) => setNoteMask(e.target.checked)} className="h-3.5 w-3.5 accent-amber-500" />{t("inbox.maskToggle")}</label>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="composer-group"><span className="composer-group-label">{t("inbox.addWord")}</span>
                  <button className="btn-secondary btn-sm" title={t("inbox.quickReplySlash")} onClick={() => setShowQuick((s) => !s)}>⚡</button>
                  <button className="btn-secondary btn-sm" title={t("inbox.emojiWord")} onClick={() => setShowEmoji((s) => !s)}>😀</button>
                  {active.channel === "whatsapp" ? (
                    <>
                      <button className="btn-secondary btn-sm font-bold" title={t("inbox.boldHint")} onClick={() => applyFormat("bold")}>B</button>
                      <button className="btn-secondary btn-sm italic" title={t("inbox.italicHint")} onClick={() => applyFormat("italic")}>I</button>
                      <button className="btn-secondary btn-sm" title={t("inbox.bulletList")} onClick={() => applyFormat("list")}>{t("inbox.listWord")}</button>
                    </>
                  ) : null}
                  <button className="btn-secondary btn-sm" title={t("inbox.productSnippetPick")} onClick={() => setShowPicker((s) => !s)}>🛍️</button>
                  <button className="btn-secondary btn-sm" title={t("inbox.imageByUrl")} onClick={() => setShowImage((s) => !s)}>🖼️</button>
                  </span><span className="composer-group composer-group-ai"><span className="composer-group-label">AI</span>
                  <button className="btn-ai btn-sm" disabled={busy !== ""} onClick={suggestDraft}>{busy === "draft" ? "..." : "AI Draft"}</button>
                  <span className="relative inline-flex">
                    <button className="btn-ai btn-sm" disabled={!reply.trim() || busy !== ""} onClick={() => setShowToneMenu((s) => !s)}>{t("inbox.toneChange")}</button>
                    {showToneMenu ? (
                      <span className="absolute bottom-full left-0 z-20 mb-1 flex w-40 flex-col gap-1 rounded-xl border bg-white p-1.5 shadow-lg">
                        <button className="rounded-lg px-2 py-1.5 text-left text-xs font-semibold hover:bg-slate-100" disabled={busy !== ""} onClick={() => void applyTone("polite")}>{t("inbox.tonePolite")}</button>
                        <button className="rounded-lg px-2 py-1.5 text-left text-xs font-semibold hover:bg-slate-100" disabled={busy !== ""} onClick={() => void applyTone("professional")}>{t("inbox.toneProfessional")}</button>
                        <button className="rounded-lg px-2 py-1.5 text-left text-xs font-semibold hover:bg-slate-100" disabled={busy !== ""} onClick={() => void applyTone("sales")}>{t("inbox.toneSales")}</button>
                      </span>
                    ) : null}
                  </span>
                  {prevReply !== null ? (
                    <button className="btn-secondary btn-sm" onClick={() => { const prev = prevReply; setPrevReply(null); setReply(prev); setGhost(""); ghostForRef.current = ""; }}>{t("inbox.inbZBackToPrevDraft")}</button>
                  ) : null}
                  {busy === "media" ? <span className="text-xs font-medium text-slate-500">{t("inbox.fileSending")}</span> : null}
                  {busy === "tone" ? <span className="text-xs font-medium text-slate-500">{t("inbox.toneChanging")}</span> : null}
                  </span>
                </div>

                {ghostVisible ? (
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-brand-600 bg-brand-50/60 px-2.5 py-1 rounded-lg">
                    <span>✨</span>
                    <span>{t("inbox.aiSuggestionFound")}</span>
                    <kbd className="rounded bg-white px-1.5 py-0.5 text-[10px] font-bold shadow-xs">Tab</kbd>
                    <span>{t("inbox.pressAccept")}</span>
                    <kbd className="rounded bg-white px-1.5 py-0.5 text-[10px] font-bold shadow-xs">Esc</kbd>
                    <span>{t("inbox.pressDismiss")}</span>
                  </div>
                ) : null}

                {/* Clean Modern Composer Toolbar */}
                <div className="mt-1 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
                  <div className="flex items-center gap-1">
                    {composerMode === "reply" ? (
                      <>
                        {/* Quick Reply & Emoji */}
                        <button
                          type="button"
                          className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition"
                          title={t("inbox.quickReplyTitle")}
                          onClick={() => { setShowQuick((s) => !s); setAttachMenuOpen(false); setAiMenuOpen(false); }}
                        >
                          ⚡
                        </button>
                        <button
                          type="button"
                          className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition"
                          title={t("inbox.pickEmoji")}
                          onClick={() => { setShowEmoji((s) => !s); setAttachMenuOpen(false); setAiMenuOpen(false); }}
                        >
                          😀
                        </button>

                        {/* Attachments Dropdown Menu */}
                        <div className="relative">
                          <button
                            type="button"
                            className={`flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-semibold transition ${
                              attachMenuOpen || showPicker || showImage
                                ? "bg-indigo-50 text-indigo-700"
                                : "text-slate-600 hover:bg-slate-100"
                            }`}
                            onClick={() => {
                              setAttachMenuOpen((v) => !v);
                              setShowEmoji(false);
                              setShowQuick(false);
                              setAiMenuOpen(false);
                              setFormatMenuOpen(false);
                            }}
                            title={t("inbox.attachTitle")}
                          >
                            <span>📎</span>
                            <span className="hidden sm:inline">{t("inbox.attachmentWord")}</span>
                            <span className="text-[10px]">▾</span>
                          </button>

                          {attachMenuOpen && (
                            <div className="absolute bottom-full left-0 z-40 mb-2 w-56 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl animate-in fade-in zoom-in-95">
                              <button
                                type="button"
                                className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
                                onClick={() => { setAttachMenuOpen(false); fileInputRef.current?.click(); }}
                              >
                                <span className="text-base">📁</span>
                                <div>
                                  <div>{t("inbox.fileUpload")}</div>
                                  <div className="text-[10px] text-slate-400">{t("inbox.max2mb")}</div>
                                </div>
                              </button>
                              <button
                                type="button"
                                className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition"
                                onClick={() => { setAttachMenuOpen(false); setShowPicker((s) => !s); setShowImage(false); }}
                              >
                                <span className="text-base">🛍️</span>
                                <div>
                                  <div>{t("inbox.productCatalog")}</div>
                                  <div className="text-[10px] text-slate-400">{t("inbox.sendProductCardHint")}</div>
                                </div>
                              </button>
                              <button
                                type="button"
                                className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
                                onClick={() => { setAttachMenuOpen(false); setShowImage((s) => !s); setShowPicker(false); }}
                              >
                                <span className="text-base">🖼️</span>
                                <div>
                                  <div>{t("inbox.imageLink")}</div>
                                  <div className="text-[10px] text-slate-400">{t("inbox.sendFromPublicUrl")}</div>
                                </div>
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Voice Recorder */}
                        <VoiceRecorder disabled={busy !== ""} onSend={(f) => void sendMediaFiles([f])} onError={(msg) => setError(msg)} />

                        {/* WhatsApp Text Formatting Menu */}
                        {active.channel === "whatsapp" && (
                          <div className="relative hidden sm:block">
                            <button
                              type="button"
                              className="rounded-xl px-2 py-1 text-xs font-serif font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition"
                              title={t("inbox.textFormatting")}
                              onClick={() => { setFormatMenuOpen((v) => !v); setAttachMenuOpen(false); setAiMenuOpen(false); }}
                            >
                              𝑩▾
                            </button>
                            {formatMenuOpen && (
                              <div className="absolute bottom-full left-0 z-40 mb-2 flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl animate-in fade-in">
                                <button type="button" className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-bold hover:bg-slate-100" onClick={() => { applyFormat("bold"); setFormatMenuOpen(false); }}>
                                  <span>B</span> <span>{t("inbox.boldFmt")}</span>
                                </button>
                                <button type="button" className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs italic hover:bg-slate-100" onClick={() => { applyFormat("italic"); setFormatMenuOpen(false); }}>
                                  <span>I</span> <span>{t("inbox.italicFmt")}</span>
                                </button>
                                <button type="button" className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs hover:bg-slate-100" onClick={() => { applyFormat("list"); setFormatMenuOpen(false); }}>
                                  <span>•</span> <span>{t("inbox.bulletList")}</span>
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    ) : null}

                    <input ref={fileInputRef} type="file" className="hidden" multiple accept="image/*,audio/*,video/mp4,video/webm,application/pdf"
                      onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; if (files.length) void sendMediaFiles(files); }} />
                  </div>

                  {/* Right Actions: AI Tools Dropdown & Send Button */}
                  <div className="flex items-center gap-1.5">
                    {composerMode === "reply" && (
                      <div className="relative">
                        <button
                          type="button"
                          className="flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-purple-50 px-2.5 sm:px-3 py-1.5 text-xs font-bold text-indigo-700 shadow-2xs hover:from-indigo-100 hover:to-purple-100 transition disabled:opacity-50"
                          disabled={busy !== ""}
                          onClick={() => { setAiMenuOpen((v) => !v); setAttachMenuOpen(false); setFormatMenuOpen(false); }}
                        >
                          <span>✨</span>
                          <span className="hidden sm:inline">{busy === "draft" ? t("inbox.writingDots") : t("inbox.aiTools")}</span>
                          <span className="text-[10px]">▾</span>
                        </button>

                        {aiMenuOpen && (
                          <div className="absolute bottom-full right-0 z-40 mb-2 w-52 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl animate-in fade-in zoom-in-95">
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-bold text-indigo-700 hover:bg-indigo-50 transition disabled:opacity-50"
                              disabled={busy !== ""}
                              onClick={() => { setAiMenuOpen(false); void suggestDraft(); }}
                            >
                              <span>✨</span>
                              <div>
                                <div>{t("inbox.aiReplySuggest")}</div>
                                <div className="text-[10px] font-normal text-slate-400">{t("inbox.smartDraft")}</div>
                              </div>
                            </button>

                            <div className="my-1 border-t border-slate-100" />
                            <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("inbox.toneChangeTitle")}</div>

                            <button
                              type="button"
                              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 transition disabled:opacity-40"
                              disabled={!reply.trim() || busy !== ""}
                              onClick={() => { setAiMenuOpen(false); void applyTone("polite"); }}
                            >
                              <span>🌸</span> <span>{t("inbox.politeTone")}</span>
                            </button>
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 transition disabled:opacity-40"
                              disabled={!reply.trim() || busy !== ""}
                              onClick={() => { setAiMenuOpen(false); void applyTone("professional"); }}
                            >
                              <span>💼</span> <span>{t("inbox.professionalTone")}</span>
                            </button>
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 transition disabled:opacity-40"
                              disabled={!reply.trim() || busy !== ""}
                              onClick={() => { setAiMenuOpen(false); void applyTone("sales"); }}
                            >
                              <span>🎯</span> <span>{t("inbox.salesTone")}</span>
                            </button>

                            {prevReply !== null && (
                              <button
                                type="button"
                                className="mt-1 flex w-full items-center gap-2 border-t border-slate-100 pt-1.5 px-2.5 py-1 text-left text-xs font-semibold text-amber-700 hover:bg-amber-50 rounded-lg transition"
                                onClick={() => {
                                  const prev = prevReply;
                                  setPrevReply(null);
                                  setReply(prev);
                                  setGhost("");
                                  ghostForRef.current = "";
                                  setAiMenuOpen(false);
                                }}
                              >
                                <span>↩</span> <span>{t("inbox.revertText")}</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Send Button */}
                    <button
                      type="button"
                      className={`flex items-center justify-center gap-1.5 rounded-xl px-4 sm:px-5 py-2 text-xs font-bold text-white shadow-md transition-all active:scale-95 disabled:opacity-50 ${
                        composerMode === "note"
                          ? "bg-amber-600 hover:bg-amber-700 shadow-amber-500/25"
                          : "bg-blue-600 hover:bg-blue-700 shadow-blue-500/30"
                      }`}
                      disabled={busy !== "" || !reply.trim()}
                      onClick={() => { if (composerMode === "note") { void addNote(); } else { void sendReply(); } }}
                      title={t("inbox.enterToSend")}
                    >
                      <span>{composerMode === "note" ? t("inbox.saveNoteBtn") : t("inbox.sendBtn")}</span>
                      <span>🚀</span>
                    </button>
                  </div>
                </div>
              </div>
              {showPicker && composerMode === "reply" ? (
                <div className="max-h-44 shrink-0 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
                  {products.length === 0 ? <p className="px-1 py-2 text-xs text-slate-400">{t("inbox.noProducts")}</p> : products.map((prod) => (
                    <div key={prod.id} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-indigo-50">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{prod.name}</span>
                        <span className="text-slate-500">{money(prod.priceMinor, prod.currency, locale)}{prod.stockQuantity != null ? t("inbox.inbZStockSuffix", { count: fmtNumber(locale, prod.stockQuantity) }) : ""}</span>
                      </span>
                      <span className="flex shrink-0 gap-1">
                        <button className="rounded-md bg-slate-100 px-2 py-1 font-semibold hover:bg-slate-200" title={t("inbox.insertProductText")} onClick={() => insertProductSnippet(prod)}>{t("inbox.insertTextBtn")}</button>
                        <button className="rounded-md bg-indigo-600 px-2 py-1 font-semibold text-white disabled:opacity-50 hover:bg-indigo-500" disabled={busy === "product-card"} title={t("inbox.sendCardHint")} onClick={() => sendProductCard(prod)}>{t("inbox.sendCardBtn")}</button>
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              {showImage && composerMode === "reply" ? (
                <div className="flex shrink-0 flex-wrap gap-2 rounded-xl bg-slate-50 p-3">
                  <input className="input flex-1" placeholder={t("inbox.imageUrlPlaceholder")} value={imageForm.url} onChange={(e) => setImageForm({ ...imageForm, url: e.target.value })} />
                  <input className="input flex-1" placeholder={t("inbox.captionOptional")} value={imageForm.caption} onChange={(e) => setImageForm({ ...imageForm, caption: e.target.value })} />
                  <button className="btn-primary btn-sm" disabled={busy !== ""} onClick={sendImage}>{busy === "image" ? t("inbox.sendingDots") : t("inbox.sendImageBtn")}</button>
                </div>
              ) : null}
            </div>
                </>
              )}
            </div>
          ) : <p className="card flex-1 p-5 text-sm text-slate-500">{t("inbox.pickConversation")}</p>}
        </div>

        {/* ---- Customer context + controls + notes ----
            Inbox Next-Gen P1: third grid column on xl+ (own scroll);
            below xl it becomes a right-side drawer opened from the
            thread header. */}
        {active ? (
          <div
            className={`${ctxOpen ? "fixed inset-0 z-50 flex justify-end bg-slate-900/40" : "hidden"} xl:static xl:z-auto xl:block xl:min-h-0 xl:overflow-y-auto xl:bg-transparent xl:pr-0.5`}
            onClick={(e) => { if (e.target === e.currentTarget) setCtxOpen(false); }}
          >
            <div className="h-full w-[340px] max-w-[94vw] space-y-4 overflow-y-auto bg-[#f6f7fb] p-3 shadow-2xl xl:h-auto xl:w-auto xl:max-w-none xl:overflow-visible xl:bg-transparent xl:p-0 xl:shadow-none">
              <div className="flex items-center justify-between xl:hidden">
                <span className="text-sm font-bold">{t("inbox.customerControls")}</span>
                <button className="rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold shadow-sm" onClick={() => setCtxOpen(false)}>{t("inbox.closePanelBtn")}</button>
              </div>
            <div className="card space-y-4 p-4 shadow-sm border border-slate-200/80">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{t("inbox.customerProfile")}</span>
                {context?.lead ? <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 ring-1 ring-indigo-200/60">Lead: {context.lead.stage}</span> : null}
              </div>

              {context?.customer ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <ContactAvatar name={context.customer.name ?? active.contactName} channel={active.channel} size="lg" />
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-900 truncate">{context.customer.name ?? active.contactName ?? "—"}</div>
                      <div className="text-xs text-slate-500 flex flex-col gap-0.5 mt-0.5">
                        {context.customer.phone || active.contactPhone ? (
                          <a href={`tel:${context.customer.phone ?? active.contactPhone}`} className="text-indigo-600 hover:underline">
                            📞 {context.customer.phone ?? active.contactPhone}
                          </a>
                        ) : null}
                        {context.customer.email ? <span className="truncate">✉️ {context.customer.email}</span> : null}
                      </div>
                    </div>
                  </div>

                  {context.lifetime ? (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3 text-center">
                        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">{t("inbox.totalOrders")}</div>
                        <div className="mt-1 text-lg font-black text-slate-900">{t("inbox.orderCountTi", { count: fmtNumber(locale, context.lifetime.orderCount) })}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3 text-center">
                        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">{t("inbox.lifetimeSpend")}</div>
                        <div className="mt-1 text-lg font-black text-emerald-600">{money(context.lifetime.totalSpentMinor, context.lifetime.currency, locale)}</div>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-xl bg-slate-50 p-3 text-center text-xs text-slate-500">
                  {t("inbox.notLinkedCustomer")}{context?.lead ? "" : ` ${t("inbox.leadCreatedSuffix")}`}
                </div>
              )}

              {context?.lead && !context?.customer ? (
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="badge-brand">Lead: {context.lead.stage}</span>
                  <span className="badge-slate">{context.lead.source}</span>
                  {context.lead.valueMinor ? <span className="badge-green">{money(context.lead.valueMinor, "BDT", locale)}</span> : null}
                  {(context.lead.tags ?? []).map((t) => <span key={t} className="badge-amber">{t}</span>)}
                </div>
              ) : null}
              {context?.orders?.length ? (
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("inbox.recentOrders")}</div>
                  <div className="space-y-1.5">
                    {context.orders.map((o) => (
                      <div key={o.id} className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">#{o.externalNumber ?? o.id.slice(0, 6)} · {o.status}{o.isCod ? " · COD" : ""}</span>
                          <span className="font-semibold">{money(o.totalMinor, o.currency, locale)}</span>
                        </div>
                        {o.shipment ? <ShipmentWidget shipment={o.shipment} currency={o.currency} syncing={busy === `sync:${o.shipment.id}`} onSync={() => syncShipment(o.shipment!.id)} /> : null}
                        {o.isCod ? (
                          <div className="mt-1 flex items-center gap-2">
                            {o.codConfirmationStatus === "awaiting" ? <span className="badge-amber">{t("inbox.codAwaiting")}</span>
                              : o.codConfirmationStatus === "confirmed" ? <span className="badge-green">{t("inbox.codConfirmed")}</span>
                              : o.codConfirmationStatus === "declined" ? <span className="badge-red">{t("inbox.codDeclined")}</span>
                              : ["pending", "on-hold", "processing"].includes(o.status) ? (
                                <button className="btn-warning btn-sm !px-2 !py-0.5 !text-[11px]" disabled={busy !== ""} onClick={() => requestCod(o.id)}>{busy === "cod" ? t("inbox.sendingDots") : t("inbox.codSendBtn")}</button>
                              ) : null}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {/* IN2: identity — সব চ্যানেলে একই গ্রাহক। মিল শুধু
                  আসল identifier-এ (ফোনের শেষ ১০ ডিজিট / ইমেইল);
                  শুধু Messenger PSID দিয়ে কাউকে মেলানো হয় না। */}
              {context?.identity ? (
                <div className="space-y-2">
                  {context.identity.duplicates.length ? (
                    <div className="rounded-xl bg-amber-50 p-2.5 ring-1 ring-amber-200">
                      <div className="text-xs font-semibold text-amber-800">{t("inbox.possibleSameCustomer")}</div>
                      <p className="mt-0.5 text-[11px] text-amber-700">{t("inbox.possibleSameHint")}</p>
                      <div className="mt-2 space-y-1.5">
                        {context.identity.duplicates.map((d, i) => (
                          <div key={`${d.customerId ?? d.conversationId ?? i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/70 px-2 py-1.5 text-xs ring-1 ring-amber-100">
                            <span className="min-w-0">
                              <span className="font-semibold">{d.customerName ?? d.contactName ?? t("inbox.noNamePlain")}</span>
                              <span className="text-slate-500"> · {d.matchReasons.includes("phone") ? t("inbox.phoneMatched") : ""}{d.matchReasons.includes("phone") && d.matchReasons.includes("email") ? " + " : ""}{d.matchReasons.includes("email") ? t("inbox.inbZEmailMatched") : ""}{d.channel ? ` · ${d.channel}` : ""}{d.contactPhone ? ` · ${d.contactPhone}` : ""}</span>
                            </span>
                            <span className="flex shrink-0 gap-1.5">
                              {d.conversationId ? (
                                <button className="btn-secondary btn-sm !px-2 !py-0.5 !text-[11px]" onClick={() => void openConversation({ id: d.conversationId } as Conversation)}>{t("inbox.viewThread")}</button>
                              ) : null}
                              {d.customerId && context.identity?.customerId && d.customerId !== context.identity.customerId ? (
                                <button className="btn-warning btn-sm !px-2 !py-0.5 !text-[11px]" disabled={busy !== ""} onClick={() => void mergeDuplicate(d.customerId!, d.customerName ?? d.contactName ?? t("inbox.customerFallback"))}>{t("inbox.mergeHere")}</button>
                              ) : null}
                              {d.customerId && !context.identity?.customerId ? (
                                <button className="btn-warning btn-sm !px-2 !py-0.5 !text-[11px]" disabled={busy !== ""} onClick={() => void linkToCustomer(d.customerId!, d.customerName ?? d.contactName ?? t("inbox.customerFallback"))}>{t("inbox.linkToThisCustomer")}</button>
                              ) : null}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {context.identity.linkedConversations.length ? (
                    <div>
                      <div className="mb-1 text-[11px] font-semibold uppercase text-slate-400">{t("inbox.otherChannels")}</div>
                      <div className="space-y-1">
                        {context.identity.linkedConversations.map((c) => (
                          <button key={c.id} className="flex w-full items-center justify-between rounded-xl bg-slate-50 px-2 py-1.5 text-left text-xs ring-1 ring-inset ring-slate-200/50 transition hover:bg-slate-100"
                            onClick={() => void openConversation({ id: c.id } as Conversation)}>
                            <span className="flex min-w-0 items-center gap-1.5"><ChannelChip channel={c.channel} /> <span className="truncate">{c.lastMessagePreview ?? c.contactName ?? "—"}</span></span>
                            <span className="shrink-0 text-slate-400">{c.status}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {context.identity.merges.length ? (
                    <div>
                      <div className="mb-1 text-[11px] font-semibold uppercase text-slate-400">{t("inbox.mergedRecords")}</div>
                      <div className="space-y-1">
                        {context.identity.merges.map((m) => (
                          <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-2 py-1.5 text-xs ring-1 ring-inset ring-slate-200/50">
                            <span>{m.sourceName ?? t("inbox.noNamePlain")}{m.sourcePhone ? ` · ${m.sourcePhone}` : ""} <span className="text-slate-400">{t("inbox.inbZMovedCounts", { orders: fmtNumber(locale, m.ordersMoved), convs: fmtNumber(locale, m.conversationsMoved) })}</span></span>
                            <button className="btn-secondary btn-sm !px-2 !py-0.5 !text-[11px]" disabled={busy !== ""} onClick={() => void unmergeCustomer(m.sourceCustomerId, m.sourceName ?? t("inbox.customerFallback"))}>{t("inbox.unmergeBtn")}</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {profile ? (
              <div className="card space-y-3 p-4">
                <div className="section-title">🎯 Command Profile</div>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  <span className="badge-indigo">Stage: {profile.conversation.pipelineStage}</span>
                  {profile.rfm ? <span className="badge-green">{t("inbox.inbZRfmBadge", { segment: profile.rfm.segment, freq: fmtNumber(locale, profile.rfm.frequency), days: fmtNumber(locale, profile.rfm.recencyDays) })}</span> : <span className="badge-slate">{t("inbox.rfmNoOrders")}</span>}
                  {profile.adOrigin?.ctwaSourceId ? <span className="badge-amber">{t("inbox.ctwaAd")}</span> : null}
                  {profile.adOrigin?.leadSource ? <span className="badge-slate">Lead Source: {profile.adOrigin.leadSource}</span> : null}
                </div>
                {profile.conversations?.length > 1 ? (
                  <div>
                    <div className="mb-1 text-[11px] font-semibold uppercase text-slate-400">{t("inbox.allChannelConvs")}</div>
                    <div className="space-y-1">
                      {profile.conversations.map((c: any) => (
                        <button key={c.id} className="flex w-full items-center justify-between rounded-lg bg-slate-50 px-2 py-1 text-left text-xs hover:bg-slate-100"
                          onClick={() => { if (c.id !== active.id) void openConversation({ id: c.id } as Conversation); }}>
                          <span className="flex items-center gap-1.5"><ChannelChip channel={c.channel} /> <span className="truncate">{c.lastMessagePreview ?? "—"}</span></span>
                          <span className="shrink-0 text-slate-400">{c.status}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {profile.payments?.verifications?.length ? (
                  <div>
                    <div className="mb-1 text-[11px] font-semibold uppercase text-slate-400">{t("inbox.paymentVerify")}</div>
                    {profile.payments.verifications.map((v: any) => (
                      <div key={v.id} className="rounded-lg bg-slate-50 px-2 py-1 text-xs">
                        {v.provider ?? "?"} · <b>{v.verdict}</b>{v.trxId ? ` · TrxID ${v.trxId}` : ""}{v.amountMinor ? ` · ${money(v.amountMinor, "BDT", locale)}` : ""}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Quick Action Tiles (Matching Demo 3 & 4) */}
            <div className="card p-4 space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400">{t("inbox.quickActions")}</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  type="button"
                  className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-slate-200/90 bg-white p-3 font-semibold text-slate-700 shadow-2xs hover:border-blue-400 hover:bg-blue-50/50 hover:text-blue-700 transition"
                  onClick={() => setOrderOpen((v) => !v)}
                >
                  <span className="text-base">📄</span>
                  <span>{t("inbox.sendInvoice")}</span>
                </button>
                <button
                  type="button"
                  className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-slate-200/90 bg-white p-3 font-semibold text-slate-700 shadow-2xs hover:border-blue-400 hover:bg-blue-50/50 hover:text-blue-700 transition"
                  onClick={() => setNotice(t("inbox.taskWindowOpening"))}
                >
                  <span className="text-base">📋</span>
                  <span>{t("inbox.createTask")}</span>
                </button>
                <button
                  type="button"
                  className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-slate-200/90 bg-white p-3 font-semibold text-slate-700 shadow-2xs hover:border-amber-400 hover:bg-amber-50/50 hover:text-amber-800 transition"
                  onClick={() => { setComposerMode("note"); focusComposer(); }}
                >
                  <span className="text-base">📝</span>
                  <span>{t("inbox.addNote")}</span>
                </button>
                <button
                  type="button"
                  className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-slate-200/90 bg-white p-3 font-semibold text-slate-700 shadow-2xs hover:border-emerald-400 hover:bg-emerald-50/50 hover:text-emerald-800 transition"
                  onClick={() => patchConversation({ status: active.status === "closed" ? "open" : "closed" })}
                >
                  <span className="text-base">✓</span>
                  <span>{active.status === "closed" ? t("inbox.reopenChat") : t("inbox.resolveChat")}</span>
                </button>
              </div>
            </div>

            {/* AI Conversation Summary Card (Matching Demo 3 & 4) */}
            <div className="card p-4 space-y-2 border-indigo-100 bg-gradient-to-br from-indigo-50/40 via-white to-purple-50/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-900">
                  <span className="flex h-5 w-5 items-center justify-center rounded-md bg-indigo-100 text-indigo-600 text-[10px]">✨</span>
                  <span>{t("inbox.aiSummaryTitle")}</span>
                </div>
                <button
                  className="text-[11px] font-bold text-indigo-600 hover:underline disabled:opacity-50"
                  disabled={busy !== ""}
                  onClick={summarize}
                >
                  {busy === "summary" ? t("inbox.generating") : active.summaryText ? t("inbox.refresh") : t("inbox.create")}
                </button>
              </div>

              {active.summaryText ? (
                <div className="rounded-xl bg-white/90 p-3 text-xs leading-relaxed text-slate-700 shadow-2xs ring-1 ring-slate-100 whitespace-pre-line">
                  {active.summaryText}
                  <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-1.5 text-[10px] text-slate-400">
                    <span>{active.summaryProvider ?? "AI Engine"}</span>
                    <span>{active.summaryAt ? fmtTime(locale, active.summaryAt) : ""}</span>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-indigo-200 p-3 text-center text-xs text-indigo-600/80">{t("inbox.summaryHint")}</div>
              )}
            </div>

            <div className="card space-y-3 p-4">
              <div className="section-title">{t("inbox.responsibilityTags")}</div>
              {active.spamFlag ? (
                <div className="rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
                  <div className="text-xs font-semibold text-amber-800">{t("inbox.spamSuspect")}</div>
                  <p className="mt-0.5 text-xs text-amber-700">{active.spamReason ?? ""}</p>
                  <button className="btn-secondary btn-sm mt-2" disabled={busy !== ""} onClick={() => patchConversation({ spamFlag: false })}>{t("inbox.spamNotOk")}</button>
                </div>
              ) : null}
              {/* IN10a: block — আমাদের সিস্টেমের ব্লক, প্ল্যাটফর্মের নয়। */}
              {active.blockedAt ? (
                <div className="rounded-xl bg-red-50 p-3 ring-1 ring-red-200">
                  <div className="text-xs font-semibold text-red-800">{t("inbox.blockedBanner")}</div>
                  <p className="mt-0.5 text-xs text-red-700">
                    {active.blockReason ? t("inbox.inbZReasonPrefix", { reason: active.blockReason }) : ""}{t("inbox.inbZBlockBannerBody")}
                  </p>
                  <button className="btn-secondary btn-sm mt-2" disabled={busy !== ""} onClick={() => void setBlocked(false)}>{busy === "block" ? t("inbox.doingDots") : t("inbox.unblockBtn")}</button>
                </div>
              ) : (
                <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200/70">
                  <div className="text-xs font-semibold text-slate-700">{t("inbox.blockCustomerBtn")}</div>
                  <p className="mt-0.5 text-[11px] text-slate-500">{t("inbox.blockExplain")}</p>
                  <div className="mt-2 flex gap-1.5">
                    <input className="input !py-1.5 text-xs" placeholder={t("inbox.reasonOptional")} value={blockReason} onChange={(e) => setBlockReason(e.target.value)} maxLength={300} />
                    <button className="btn-danger btn-sm shrink-0" disabled={busy !== ""} onClick={() => void setBlocked(true)}>{busy === "block" ? t("inbox.doingDots") : t("inbox.blockBtn")}</button>
                  </div>
                </div>
              )}
              {botSession?.status === "active" ? (
                <div className="rounded-xl bg-indigo-50 p-3 ring-1 ring-indigo-100">
                  <div className="text-xs font-semibold text-indigo-800">{t("inbox.botRunning", { state: botSession.state })}</div>
                  <p className="mt-0.5 text-xs text-indigo-600">{t("inbox.inbZBotStopNote")}</p>
                  <button className="btn-secondary btn-sm mt-2" disabled={busy !== ""} onClick={async () => {
                    const orgId = getOrganizationId(); if (!orgId || !active) return;
                    try { await apiFetch(`/organizations/${orgId}/inbox/conversations/${active.id}/bot/stop`, { method: "POST" }); setNotice(t("inbox.botStopped")); await refreshActive(); }
                    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
                  }}>{t("inbox.stopBot")}</button>
                </div>
              ) : null}
              {active.csatRating ? (
                <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-100">{t("inbox.inbZCsatRating", { rating: fmtNumber(locale, active.csatRating ?? 0) })}</div>
              ) : null}
              {/* IN7b/c: AI next-action card — proposal only.
                  Nothing runs or is applied without a click;
                  rejecting/ignoring changes nothing (the endpoint
                  persisted nothing). */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t("inbox.aiNextStep")}</span>
                  <button className="text-xs font-semibold text-indigo-600 hover:underline" disabled={busy !== ""} onClick={loadNextAction}>{busy === "next-action" ? t("inbox.thinkingDots") : nextAction ? t("inbox.seeAgain") : t("inbox.seeProposal")}</button>
                </div>
                {nextAction?.proposal ? (
                  <div className="ctx-subcard space-y-1.5 text-xs text-slate-600">
                    <div className="font-semibold text-slate-800">{NEXT_ACTION_ICONS[nextAction.proposal.action]} {nextAction.proposal.label}</div>
                    {nextAction.proposal.reason ? <p>{nextAction.proposal.reason}</p> : null}
                    {(nextAction.proposal.tags.length > 0 || nextAction.proposal.pipelineStage) ? (
                      <p className="text-slate-500">
                        {t("inbox.inbZProposedWord")}{nextAction.proposal.tags.length ? ` Tag: ${nextAction.proposal.tags.join(", ")}` : ""}{nextAction.proposal.pipelineStage ? ` · Stage: ${nextAction.proposal.pipelineStage}` : ""}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {isRunnableAction(nextAction.proposal.action) ? (
                        <button className="btn-primary !px-2.5 !py-1 !text-xs" disabled={busy !== ""} onClick={() => void runNextAction()}>{nextAction.proposal.label}</button>
                      ) : (
                        <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-medium text-slate-500">{t("inbox.nothingToDo")}</span>
                      )}
                      {proposalAcceptPatch(nextAction.proposal, active.tags ?? []) ? (
                        <button className="btn-secondary !px-2.5 !py-1 !text-xs" disabled={busy !== ""} onClick={() => void acceptNextActionProposal()}>{t("inbox.acceptProposal")}</button>
                      ) : null}
                      <button className="rounded-lg px-2 py-1 font-medium text-slate-400 hover:text-slate-600" onClick={() => setNextAction(null)}>{t("inbox.rejectBtn")}</button>
                    </div>
                  </div>
                ) : nextAction ? (
                  <p className="text-xs text-slate-400">{nextAction.reason ?? t("inbox.noProposalMade")}</p>
                ) : (
                  <p className="text-xs text-slate-400">{t("inbox.nextStepHint")}</p>
                )}
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t("inbox.orderFromChat")}</span>
                  <button className="text-xs font-semibold text-indigo-600 hover:underline" onClick={() => setOrderOpen(!orderOpen)}>{orderOpen ? t("inbox.closeBtn") : t("inbox.createPlusBtn")}</button>
                </div>
                {orderOpen ? (
                  <div className="space-y-2 rounded-xl bg-slate-50 p-2.5">
                    {orderItems.map((it, idx) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        <select className="input flex-1 !py-1.5 !text-xs" value={it.productId} onChange={(e) => setOrderItems(orderItems.map((x, j) => j === idx ? { ...x, productId: e.target.value } : x))}>
                          {products.map((prod) => <option key={prod.id} value={prod.id}>{prod.name} — {money(prod.priceMinor, prod.currency, locale)}</option>)}
                        </select>
                        <input className="input !w-14 !py-1.5 !text-xs" type="number" min={1} max={99} value={it.quantity} onChange={(e) => setOrderItems(orderItems.map((x, j) => j === idx ? { ...x, quantity: Number(e.target.value) || 1 } : x))} />
                        <button className="text-slate-400 hover:text-red-500" onClick={() => setOrderItems(orderItems.filter((_, j) => j !== idx))}>✕</button>
                      </div>
                    ))}
                    <button className="text-xs font-semibold text-indigo-600 hover:underline" onClick={() => setOrderItems([...orderItems, { productId: products[0]?.id ?? "", quantity: 1 }])}>{t("inbox.addProductBtn")}</button>
                    <label className="block text-xs">{t("inbox.deliveryAddressLabel")}<input className="input mt-0.5 !py-1.5 !text-xs" placeholder={t("inbox.addressPlaceholder")} value={orderAddress} onChange={(e) => setOrderAddress(e.target.value)} /></label>
                    <div className="flex items-end gap-2">
                      <label className="flex-1 text-xs">{t("inbox.deliveryTakaLabel")}<input className="input mt-0.5 !py-1.5 !text-xs" type="number" min={0} value={orderShip} onChange={(e) => setOrderShip(e.target.value)} /></label>
                      <label className="flex items-center gap-1.5 pb-2 text-xs"><input type="checkbox" checked={orderCod} onChange={(e) => setOrderCod(e.target.checked)} /> COD</label>
                    </div>
                    <button className="btn-primary w-full !py-2 !text-xs" disabled={busy !== "" || orderItems.length === 0} onClick={createChatOrder}>{busy === "order" ? t("inbox.creatingDots") : t("inbox.createOrderBtn")}</button>
                    <p className="text-[10px] text-slate-400">{t("inbox.orderPriceNote")}</p>
                  </div>
                ) : null}
              </div>
              <label className="block text-sm">Assignee
                <select className="input mt-1" value={active.assignedUserId ?? ""} onChange={(e) => patchConversation({ assignedUserId: e.target.value || null })}>
                  <option value="">{t("inbox.nobodyPlain")}</option>
                  {members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.name ?? m.user.email} ({m.role})</option>)}
                </select>
              </label>
              <div>
                <div className="mb-1 flex flex-wrap gap-1">
                  {(active.tags ?? []).map((t) => (
                    <span key={t} className="badge-brand">{t}<button className="ml-1 font-bold" onClick={() => patchConversation({ tags: (active.tags ?? []).filter((x) => x !== t) })}>×</button></span>
                  ))}
                  {(active.tags ?? []).length === 0 ? <span className="text-xs text-slate-400">{t("inbox.noTags")}</span> : null}
                </div>
                <div className="flex gap-1.5">
                  <input className="input flex-1" placeholder={t("inbox.newTagPlaceholder")} value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && tagInput.trim()) { patchConversation({ tags: [...(active.tags ?? []), tagInput.trim()] }); setTagInput(""); } }} />
                </div>
              </div>
            </div>

            </div>
          </div>
        ) : null}
      </div>

      {/* Manage & Settings Organized View */}
      {viewMode === "manage" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-slate-200/80 bg-white/80 p-2 shadow-xs backdrop-blur-md">
            {[
              { id: "settings", label: t("inbox.settingsAutopilot"), icon: "⚙️" },
              { id: "teams", label: t("inbox.settingsTeam"), icon: "👥" },
              { id: "report", label: t("inbox.settingsReport"), icon: "📊" },
              { id: "performance", label: t("inbox.settingsMyPerf"), icon: "🎯" },
              { id: "channels", label: t("inbox.settingsChannels"), icon: "🔌" },
              { id: "quick", label: t("inbox.settingsQuick"), icon: "⚡" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all ${
                  manageTab === tab.id
                    ? "bg-slate-900 text-white shadow-xs"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
                onClick={() => setManageTab(tab.id as any)}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className={`card space-y-3 p-5 ${manageTab === "settings" ? "block xl:col-span-2" : "hidden"}`}>
          <div className="section-title">{t("inbox.autoReplySettings")}</div>
          <p className="text-xs text-slate-500">{t("inbox.inbZAutoReplyNote")}</p>
          {settings ? (
            <div className="space-y-2.5 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <label className="block">{t("inbox.modeLabel")}<select className="input mt-1" value={settings.autoReplyMode} onChange={(e) => saveSettings({ autoReplyMode: e.target.value })}>
                    <option value="off">{t("inbox.stClosedPlain")}</option><option value="draft">{t("inbox.modeDraftOnly")}</option><option value="auto">{t("inbox.modeAutoSend")}</option>
                  </select>
                </label>
                <label className="block">{t("inbox.confidenceThreshold")}<input className="input mt-1" type="number" min={0} max={100} value={settings.confidenceThreshold} onChange={(e) => setSettings({ ...settings, confidenceThreshold: Number(e.target.value) })} onBlur={() => saveSettings({ confidenceThreshold: settings.confidenceThreshold })} />
                </label>
                <label className="block">Smart Assignment
                  <select className="input mt-1" value={settings.smartAssign} onChange={(e) => saveSettings({ smartAssign: e.target.value })}>
                    <option value="off">{t("inbox.stClosedPlain")}</option><option value="round_robin">Round-robin</option><option value="least_busy">{t("inbox.leastBusy")}</option>
                  </select>
                </label>
                <label className="block">{t("inbox.orderBotLabel")}<select className="input mt-1" value={settings.botEnabled ? "on" : "off"} onChange={(e) => saveSettings({ botEnabled: e.target.value === "on" })}>
                    <option value="off">{t("inbox.stClosedPlain")}</option><option value="on">{t("inbox.orderBotOn")}</option>
                  </select>
                </label>
                <label className="block">{t("inbox.botDeliveryCharge")}<input className="input mt-1" type="number" min={0} value={settings.botDeliveryChargeMinor != null ? Math.round(settings.botDeliveryChargeMinor / 100) : ""} onChange={(e) => setSettings({ ...settings, botDeliveryChargeMinor: e.target.value === "" ? null : Number(e.target.value) * 100 })} onBlur={() => saveSettings({ botDeliveryChargeMinor: settings.botDeliveryChargeMinor ?? null })} />
                </label>
                <label className="block">{t("inbox.slaFirstResponse")}<input className="input mt-1" type="number" min={1} value={settings.slaFirstResponseMinutes} onChange={(e) => setSettings({ ...settings, slaFirstResponseMinutes: Number(e.target.value) })} onBlur={() => saveSettings({ slaFirstResponseMinutes: settings.slaFirstResponseMinutes })} />
                </label>
                <label className="block">{t("inbox.awayReassign")}<input className="input mt-1" type="number" min={5} placeholder="30" value={settings.reassignAfterMinutes ?? ""} onChange={(e) => setSettings({ ...settings, reassignAfterMinutes: e.target.value === "" ? null : Number(e.target.value) })} onBlur={() => saveSettings({ reassignAfterMinutes: settings.reassignAfterMinutes ?? null })} />
                </label>
                {/* IN4: layered SLA + the active escalation chain.
                    Priority: VIP সীমা → Channel সীমা → উপরের সাধারণ
                    সীমা। Chain চলতে Automations-এ "Inbox SLA Sweep"
                    job চালু থাকতে হবে। */}
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-2.5">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-700">{t("inbox.slaTiersTitle")}</div>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    {(["whatsapp", "messenger", "instagram", "webchat"] as const).map((ch) => (
                      <label key={ch} className="block text-xs"><ChannelChip channel={ch} />
                        <input className="input mt-0.5" type="number" min={1} max={10080} placeholder={t("inbox.sentNeutral")} value={settings.slaByChannel?.[ch] ?? ""} onChange={(e) => {
                          const slaByChannel = { ...(settings.slaByChannel ?? {}) };
                          const parsed = parseSlaMinutesInput(e.target.value);
                          if (parsed === null) delete slaByChannel[ch]; else if (parsed !== undefined) slaByChannel[ch] = parsed;
                          setSettings({ ...settings, slaByChannel });
                        }} onBlur={() => saveSettings({ slaByChannel: settings.slaByChannel ?? {} })} />
                        <span className="text-[10px] text-slate-400">{t("inbox.minutesEmptyGeneral")}</span>
                      </label>
                    ))}
                  </div>
                  <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
                    <label className="block text-xs">{t("inbox.vipLimitLabel")}<input className="input mt-0.5" type="number" min={1} max={10080} placeholder="—" value={settings.slaVipMinutes ?? ""} onChange={(e) => setSettings({ ...settings, slaVipMinutes: e.target.value === "" ? null : Number(e.target.value) })} onBlur={() => saveSettings({ slaVipMinutes: settings.slaVipMinutes ?? null })} />
                      <span className="text-[10px] text-slate-400">{t("inbox.vipExplain")}</span>
                    </label>
                    <label className="block text-xs">{t("inbox.escalationAfterLabel")}<input className="input mt-0.5" type="number" min={1} max={1440} value={settings.slaEscalateAfterMinutes ?? 30} onChange={(e) => setSettings({ ...settings, slaEscalateAfterMinutes: Number(e.target.value) })} onBlur={() => saveSettings({ slaEscalateAfterMinutes: settings.slaEscalateAfterMinutes ?? 30 })} />
                    </label>
                  </div>
                  <label className="mt-2 flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={settings.slaLeadAlertEnabled ?? true} onChange={(e) => { setSettings({ ...settings, slaLeadAlertEnabled: e.target.checked }); saveSettings({ slaLeadAlertEnabled: e.target.checked }); }} />{t("inbox.escalationAlertLabel")}</label>
                  <label className="mt-1.5 flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={settings.slaAutoReassignEnabled ?? false} onChange={(e) => { setSettings({ ...settings, slaAutoReassignEnabled: e.target.checked }); saveSettings({ slaAutoReassignEnabled: e.target.checked }); }} />{t("inbox.autoReassignLabel")}</label>
                  <p className="mt-1.5 text-[11px] text-slate-500">{t("inbox.inbZSlaAlertNote")}</p>
                </div>
                <label className="setting-row"><span className="setting-row-label">{t("inbox.awayReassign")}</span>
                  <span className="setting-row-control"><input className="input" type="number" min={5} placeholder="30" value={settings.reassignAfterMinutes ?? ""} onChange={(e) => setSettings({ ...settings, reassignAfterMinutes: e.target.value === "" ? null : Number(e.target.value) })} onBlur={() => saveSettings({ reassignAfterMinutes: settings.reassignAfterMinutes ?? null })} /></span>
                </label>
                <label className="block">{t("inbox.retentionLabel")}<input className="input mt-1" type="number" min={7} max={3650} placeholder={t("inbox.stClosedPlain")} value={settings.retentionDays ?? ""} onChange={(e) => setSettings({ ...settings, retentionDays: e.target.value === "" ? null : Number(e.target.value) })} onBlur={() => saveSettings({ retentionDays: settings.retentionDays ?? null })} />
                  <span className="text-[11px] text-slate-400">{t("inbox.inbZRetentionNote")}</span>
                </label>
                <label className="block">{t("inbox.escalationTeamLabel")}<select className="input mt-1" value={settings.escalationTeamId ?? ""} onChange={(e) => saveSettings({ escalationTeamId: e.target.value || null })}>
                    <option value="">{t("inbox.noneOption")}</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("inbox.waitBeforeReply")}</div>
                <label className="block text-xs">{t("inbox.waitSecondsLabel")}<input className="input mt-0.5" type="number" min={0} max={600} value={settings.aiReplyDelaySeconds ?? 0} onChange={(e) => setSettings({ ...settings, aiReplyDelaySeconds: Number(e.target.value) })} onBlur={() => saveSettings({ aiReplyDelaySeconds: settings.aiReplyDelaySeconds ?? 0 })} />
                </label>
                <p className="mt-1 text-[11px] text-slate-400">{t("inbox.inbZReplyDelayNote")}</p>
                <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {(["whatsapp", "messenger", "instagram", "webchat"] as const).map((ch) => (
                    <label key={ch} className="block text-xs"><ChannelChip channel={ch} />
                      <input className="input mt-0.5" type="number" min={0} max={600} placeholder={t("inbox.globalWord")} value={settings.aiReplyDelayByChannel?.[ch] ?? ""} onChange={(e) => {
                        const aiReplyDelayByChannel = { ...(settings.aiReplyDelayByChannel ?? {}) };
                        if (e.target.value === "" || Number(e.target.value) === 0) delete aiReplyDelayByChannel[ch]; else aiReplyDelayByChannel[ch] = Number(e.target.value);
                        setSettings({ ...settings, aiReplyDelayByChannel });
                      }} onBlur={() => saveSettings({ aiReplyDelayByChannel: settings.aiReplyDelayByChannel ?? {} })} />
                      <span className="text-[10px] text-slate-400">{t("inbox.secondsOrgDefault")}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("inbox.reviewRequestTitle")}</div>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={settings.reviewRequestEnabled ?? false} onChange={(e) => { setSettings({ ...settings, reviewRequestEnabled: e.target.checked }); saveSettings({ reviewRequestEnabled: e.target.checked }); }} />{t("inbox.reviewOnNote")}</label>
                <label className="mt-2 block text-xs">{t("inbox.reviewHoursLabel")}<input className="input mt-0.5" type="number" min={0} max={168} value={settings.reviewRequestDelayHours ?? 24} onChange={(e) => setSettings({ ...settings, reviewRequestDelayHours: Number(e.target.value) })} onBlur={() => saveSettings({ reviewRequestDelayHours: settings.reviewRequestDelayHours ?? 24 })} />
                </label>
                <p className="mt-1 text-[11px] text-slate-400">{t("inbox.inbZReviewNote")}</p>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("inbox.toChaseTitle")}</div>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={settings.chaseEnabled ?? false} onChange={(e) => { setSettings({ ...settings, chaseEnabled: e.target.checked }); saveSettings({ chaseEnabled: e.target.checked }); }} />{t("inbox.chaseOnNote")}</label>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <label className="block text-xs">{t("inbox.chaseFirstLabel")}<input className="input mt-0.5" type="number" min={15} max={1440} value={settings.chaseFirstDelayMinutes ?? 60} onChange={(e) => setSettings({ ...settings, chaseFirstDelayMinutes: Number(e.target.value) })} onBlur={() => saveSettings({ chaseFirstDelayMinutes: settings.chaseFirstDelayMinutes ?? 60 })} />
                  </label>
                  <label className="block text-xs">{t("inbox.chaseGapLabel")}<input className="input mt-0.5" type="number" min={60} max={2880} value={settings.chaseIntervalMinutes ?? 240} onChange={(e) => setSettings({ ...settings, chaseIntervalMinutes: Number(e.target.value) })} onBlur={() => saveSettings({ chaseIntervalMinutes: settings.chaseIntervalMinutes ?? 240 })} />
                  </label>
                  <label className="block text-xs">{t("inbox.chaseMaxLabel")}<input className="input mt-0.5" type="number" min={1} max={5} value={settings.chaseMaxAttempts ?? 3} onChange={(e) => setSettings({ ...settings, chaseMaxAttempts: Number(e.target.value) })} onBlur={() => saveSettings({ chaseMaxAttempts: settings.chaseMaxAttempts ?? 3 })} />
                  </label>
                </div>
                <label className="mt-2 flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={settings.chaseQuietHoursRespect ?? true} onChange={(e) => { setSettings({ ...settings, chaseQuietHoursRespect: e.target.checked }); saveSettings({ chaseQuietHoursRespect: e.target.checked }); }} />{t("inbox.quietHoursLabel")}</label>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="block text-xs">{t("inbox.quietStartLabel")}<input className="input mt-0.5" type="number" min={0} max={23} value={settings.chaseQuietStartHour ?? 22} onChange={(e) => setSettings({ ...settings, chaseQuietStartHour: Number(e.target.value) })} onBlur={() => saveSettings({ chaseQuietStartHour: settings.chaseQuietStartHour ?? 22 })} />
                  </label>
                  <label className="block text-xs">{t("inbox.quietEndLabel")}<input className="input mt-0.5" type="number" min={0} max={23} value={settings.chaseQuietEndHour ?? 8} onChange={(e) => setSettings({ ...settings, chaseQuietEndHour: Number(e.target.value) })} onBlur={() => saveSettings({ chaseQuietEndHour: settings.chaseQuietEndHour ?? 8 })} />
                  </label>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">{t("inbox.inbZChaseNote")}</p>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("inbox.channelScheduleTitle")}</div>
                {(() => {
                  const draft: AiScheduleMap = scheduleDraft ?? settings.aiScheduleByChannel ?? {};
                  const setEntry = (ch: string, entry: AiScheduleEntry) => setScheduleDraft({ ...draft, [ch]: entry });
                  return (
                    <>
                      {(["whatsapp", "messenger", "instagram", "webchat"] as const).map((ch) => {
                        const entry: AiScheduleEntry = draft[ch] ?? { enabled: false, windows: [] };
                        const setWindow = (wi: number, w: AiScheduleWindow) => setEntry(ch, { ...entry, windows: entry.windows.map((x, i) => (i === wi ? w : x)) });
                        return (
                          <div key={ch} className="mt-2 rounded-lg border border-slate-200 p-2">
                            <div className="flex items-center justify-between gap-2">
                              <ChannelChip channel={ch} />
                              <label className="flex items-center gap-1.5 text-xs">
                                <input type="checkbox" checked={entry.enabled} onChange={(e) => setEntry(ch, { ...entry, enabled: e.target.checked })} /> {t("inbox.inbZScheduleOn")}
                              </label>
                            </div>
                            {entry.windows.map((w, wi) => (
                              <div key={wi} className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                                <span className="flex flex-wrap gap-1">
                                  {([t("inbox.daySun"), t("inbox.dayMon"), t("inbox.dayTue"), t("inbox.dayWed"), t("inbox.dayThu"), t("inbox.dayFri"), t("inbox.daySat")] as const).map((label, d) => {
                                    const on = w.days.includes(d);
                                    return (
                                      <button key={d} type="button" className={`rounded px-1.5 py-0.5 ring-1 ring-inset ${on ? "bg-brand-500 font-semibold text-white ring-brand-500" : "bg-slate-100 text-slate-600 ring-slate-200"}`} onClick={() => setWindow(wi, { ...w, days: on ? w.days.filter((x) => x !== d) : [...w.days, d].sort((a, b) => a - b) })}>{label}</button>
                                    );
                                  })}
                                </span>
                                <input className="input w-auto" type="time" value={w.start} onChange={(e) => setWindow(wi, { ...w, start: e.target.value })} />
                                <span className="text-slate-400">–</span>
                                <input className="input w-auto" type="time" value={w.end} onChange={(e) => setWindow(wi, { ...w, end: e.target.value })} />
                                <button type="button" className="rounded bg-slate-100 px-2 py-1 font-medium text-slate-600" onClick={() => setEntry(ch, { ...entry, windows: entry.windows.filter((_, i) => i !== wi) })}>{t("inbox.removeX")}</button>
                              </div>
                            ))}
                            <button type="button" className="mt-2 rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700" onClick={() => setEntry(ch, { ...entry, windows: [...entry.windows, { days: [0, 1, 2, 3, 4], start: "09:00", end: "22:00" }] })}>{t("inbox.inbZAddWindowBtn")}</button>
                          </div>
                        );
                      })}
                      <button type="button" className="mt-2 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white" onClick={async () => { await saveSettings({ aiScheduleByChannel: draft }); setScheduleDraft(null); }}>{t("inbox.saveSchedule")}</button>
                      <p className="mt-1 text-[11px] text-slate-400">{t("inbox.inbZScheduleNote")}</p>
                    </>
                  );
                })()}
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("inbox.channelModeLabel")}</div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {(["whatsapp", "messenger", "instagram", "webchat"] as const).map((ch) => (
                    <label key={ch} className="block text-xs"><ChannelChip channel={ch} />
                      <select className="input mt-0.5" value={settings.perChannelModes?.[ch] ?? ""} onChange={(e) => {
                        const perChannelModes = { ...(settings.perChannelModes ?? {}) };
                        if (e.target.value) perChannelModes[ch] = e.target.value; else delete perChannelModes[ch];
                        saveSettings({ perChannelModes });
                      }}>
                        <option value="">{t("inbox.globalWord")}</option><option value="off">{t("inbox.stClosedPlain")}</option><option value="draft">Draft</option><option value="auto">{t("inbox.inbZAutoOption")}</option>
                      </select>
                    </label>
                  ))}
                </div>
                <label className="mt-2 block text-xs">{t("inbox.inbZEscalationLabel")}
                  <input className="input mt-0.5" type="number" min={0} value={settings.escalationThresholdMinor != null ? Math.round(settings.escalationThresholdMinor / 100) : ""} onChange={(e) => setSettings({ ...settings, escalationThresholdMinor: e.target.value === "" ? null : Number(e.target.value) * 100 })} onBlur={() => saveSettings({ escalationThresholdMinor: settings.escalationThresholdMinor ?? null })} />
                </label>
                <p className="mt-1 text-[11px] text-slate-400">{t("inbox.inbZEscalationNote")}</p>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{t("inbox.intentModeLabel")}</div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {(["price", "stock", "delivery", "order_status", "payment"] as const).map((intent) => (
                    <label key={intent} className="block text-xs">{intent}
                      <select className="input mt-0.5" value={settings.perIntent?.[intent] ?? ""} onChange={(e) => {
                        const perIntent = { ...(settings.perIntent ?? {}) };
                        if (e.target.value) perIntent[intent] = e.target.value; else delete perIntent[intent];
                        saveSettings({ perIntent });
                      }}>
                        <option value="">{t("inbox.globalWord")}</option><option value="off">{t("inbox.stClosedPlain")}</option><option value="draft">Draft</option><option value="auto">{t("inbox.inbZAutoOption")}</option>
                      </select>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ) : <p className="text-xs text-slate-400">{t("inbox.settingsLoading")}</p>}
        </div>

        <div className={`card space-y-4 p-5 ${manageTab === "performance" ? "block xl:col-span-2" : "hidden"}`}>
          <div className="section-title">{t("inbox.myPerfTitle")}</div>
          {myPerf?.me ? (
            <div className="space-y-4">
              {/* Performance KPI Cards */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-3 text-center">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">{t("inbox.indexScore")}</div>
                  <div className="mt-1 text-2xl font-black text-indigo-700">{myPerf.me.indicator}<span className="text-xs font-normal text-indigo-400">{t("inbox.of100")}</span></div>
                  {myPerf.rank ? <div className="mt-0.5 text-[10px] font-semibold text-indigo-600">{t("inbox.rankLine", { rank: fmtNumber(locale, myPerf.rank), total: fmtNumber(locale, myPerf.totalAgents) })}</div> : null}
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3 text-center">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("inbox.assignedWord")}</div>
                  <div className="mt-1 text-xl font-black text-slate-800">{myPerf.me.current.assigned}</div>
                  <div className="text-[10px] text-slate-400">{t("inbox.totalHandled")}</div>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3 text-center">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("inbox.closedResolved")}</div>
                  <div className="mt-1 text-xl font-black text-emerald-600">{myPerf.me.current.closed}</div>
                  <div className="text-[10px] text-slate-400">{t("inbox.successfulResolution")}</div>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3 text-center">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("inbox.totalReplies")}</div>
                  <div className="mt-1 text-xl font-black text-slate-800">{myPerf.me.current.replies}</div>
                  <div className="text-[10px] text-slate-400">{t("inbox.sentMessages")}</div>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3 text-center">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("inbox.avgFirstResponse")}</div>
                  <div className="mt-1 text-xl font-black text-slate-800">{myPerf.me.current.avgFirstResponseMinutes != null ? `${myPerf.me.current.avgFirstResponseMinutes}m` : "—"}</div>
                  <div className="text-[10px] text-slate-400">{t("inbox.slaSpeed")}</div>
                </div>
                <div className="rounded-2xl border border-amber-100 bg-amber-50/50 p-3 text-center">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-amber-500">{t("inbox.csatLabel")}</div>
                  <div className="mt-1 text-xl font-black text-amber-700">{myPerf.me.current.csatAvg != null ? `⭐ ${myPerf.me.current.csatAvg}` : "—"}</div>
                  <div className="text-[10px] text-amber-600/80">{t("inbox.customerSatisfaction")}</div>
                </div>
              </div>

              {myPerf.today ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50/80 px-3.5 py-2.5 text-xs ring-1 ring-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-700">{t("inbox.todayStatus")}</span>
                    <span className="rounded-full bg-white px-2.5 py-0.5 font-bold shadow-2xs ring-1 ring-slate-200">
                      {myPerf.today.state === "active" ? t("inbox.stActive") : myPerf.today.state === "idle" ? t("inbox.stIdle") : myPerf.today.state === "away" ? t("inbox.stAway") : t("inbox.stOffline")}
                    </span>
                    <span className="text-slate-400">|</span>
                    <span className="text-slate-600">{t("inbox.todayReplies")}<strong className="text-slate-800">{t("inbox.countTiSuffix", { count: fmtNumber(locale, myPerf.today.repliesToday) })}</strong></span>
                    <span className="text-slate-400">|</span>
                    <span className="text-slate-600">{t("inbox.todayClosed")}<strong className="text-slate-800">{t("inbox.countTiSuffix", { count: fmtNumber(locale, myPerf.today.closedToday) })}</strong></span>
                  </div>
                  <span className="rounded-md bg-amber-100 px-2 py-0.5 font-bold text-amber-800">
                    {t("inbox.openNowLine", { n: fmtNumber(locale, myPerf.today.openNow) })}
                  </span>
                </div>
              ) : null}
            </div>
          ) : <p className="text-xs text-slate-400">{t("inbox.noScorecard")}</p>}

          <div className="border-t border-slate-100 pt-3">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <input type="checkbox" checked={mySig.enabled} onChange={(e) => setMySig({ ...mySig, enabled: e.target.checked })} />
              <span>{t("inbox.signatureToggle")}</span>
            </label>
            <textarea className="input mt-2" rows={2} maxLength={300} placeholder={t("inbox.inbZSignaturePlaceholder")} value={mySig.signature} onChange={(e) => setMySig({ ...mySig, signature: e.target.value })} />
            <div className="mt-2.5 flex items-center justify-between gap-2">
              <button className="btn-secondary btn-sm" onClick={async () => {
                const orgId = getOrganizationId(); if (!orgId) return;
                try {
                  const saved = await apiFetch<any>(`/organizations/${orgId}/inbox/my-signature`, { method: "PUT", body: JSON.stringify(mySig) });
                  setMySig({ signature: saved.signature ?? "", enabled: Boolean(saved.enabled) });
                  setNotice(t("inbox.signatureSaved"));
                } catch (e) { setError(e instanceof Error ? e.message : t("inbox.signatureSaveFailed")); }
              }}>{t("inbox.signatureSaveBtn")}</button>
              <span className="text-[11px] text-slate-400">{t("inbox.signatureNote")}</span>
            </div>
          </div>
        </div>

        <div className={`card space-y-4 p-5 ${manageTab === "report" ? "block xl:col-span-2" : "hidden"}`}>
          <div className="section-title">{t("inbox.teamReportTitle")}</div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500 font-medium">{t("inbox.rangeLabel")}</span>
              <select className="input w-52 py-1 text-xs" defaultValue="" onChange={async (e) => {
                const orgId = getOrganizationId(); if (!orgId) return;
                const tid = e.target.value;
                try {
                  setReport(await apiFetch<any>(`/organizations/${orgId}/inbox/team-report?days=7${tid ? `&teamId=${tid}` : ""}`));
                } catch (err) { setError(err instanceof Error ? err.message : t("inbox.reportLoadFailed")); }
              }}>
                <option value="">{t("inbox.allTeamsOrg")}</option>
                {teams.map((team) => <option key={team.id} value={team.id}>{team.name} {t("inbox.teamWordSuffix")}</option>)}
              </select>
              {report?.scopedTeamName ? <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-bold text-indigo-700 ring-1 ring-indigo-200">{t("inbox.inbZOnlyTeam", { name: report.scopedTeamName })}</span> : null}
            </div>
          </div>

          {report ? (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5 text-center">
                  <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">{t("inbox.newConvsLabel")}</div>
                  <div className="mt-1 text-2xl font-black text-slate-900">{report.opened}</div>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5 text-center">
                  <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">{t("inbox.closedLabel")}</div>
                  <div className="mt-1 text-2xl font-black text-emerald-600">{report.closed}</div>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5 text-center">
                  <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">{t("inbox.avgFirstResponse")}</div>
                  <div className="mt-1 text-2xl font-black text-slate-900">{report.avgFirstResponseMinutes != null ? `${report.avgFirstResponseMinutes}m` : "—"}</div>
                </div>
                <div className={`rounded-2xl border p-3.5 text-center ${report.currentBreaches > 0 ? "border-red-200 bg-red-50/80" : "border-slate-100 bg-slate-50/70"}`}>
                  <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">{t("inbox.slaBreachNow")}</div>
                  <div className={`mt-1 text-2xl font-black ${report.currentBreaches > 0 ? "text-red-600" : "text-slate-900"}`}>{report.currentBreaches}</div>
                </div>
              </div>

              {/* Chat-linked Revenue Card */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-3.5 text-xs text-emerald-800">
                <div className="flex items-center gap-2">
                  <span className="text-base">🛒</span>
                  <span>{t("inbox.chatOrdersEarned")}<strong className="font-bold text-slate-900">{t("inbox.countTiSuffix", { count: fmtNumber(locale, report.chatLinkedOrders) })}</strong></span>
                </div>
                <div className="text-sm font-black text-emerald-700">
                  {t("inbox.totalRevenuePrefix")} {money(report.chatLinkedRevenueMinor, report.chatLinkedCurrency, locale)}
                </div>
              </div>

              {report.autopilot ? (
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 text-xs text-indigo-900">
                  <div className="font-bold mb-1 flex items-center gap-1.5">
                    <span>🤖</span> <span>{t("inbox.autopilotEffectiveness")}</span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-slate-600">
                    <span>{t("inbox.autoSentLabel")}<strong className="text-slate-800">{t("inbox.countTiSuffix", { count: fmtNumber(locale, report.autopilot.autoSent) })}</strong> {t("inbox.llmSuffix", { n: fmtNumber(locale, report.autopilot.llmSent) })}</span>
                    <span>{t("inbox.draftsSuggestedLabel")}<strong className="text-slate-800">{t("inbox.countTiSuffix", { count: fmtNumber(locale, report.autopilot.draftsSuggested) })}</strong></span>
                    <span>{t("inbox.escalatedLabel")}<strong className="text-amber-700">{t("inbox.countTiSuffix", { count: fmtNumber(locale, report.autopilot.escalatedNow) })}</strong></span>
                  </div>
                </div>
              ) : null}

              {(report.perAgent ?? []).length ? (
                <div className="space-y-1.5 pt-1">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t("inbox.agentPerfTitle")}</div>
                  <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200/80 bg-white">
                    {report.perAgent.map((a: any) => (
                      <div key={a.userId} className="flex flex-wrap items-center justify-between gap-2 p-2.5 text-xs hover:bg-slate-50 transition">
                        <span className="font-bold text-slate-800">{memberName(a.userId)}</span>
                        <div className="flex flex-wrap items-center gap-2 text-slate-600">
                          <span className="rounded bg-slate-100 px-2 py-0.5">{t("inbox.assignedShort", { n: fmtNumber(locale, a.assigned) })}</span>
                          <span className="rounded bg-emerald-50 text-emerald-700 font-semibold px-2 py-0.5">{t("inbox.closedShort", { n: fmtNumber(locale, a.closed) })}</span>
                          <span>{t("inbox.avgReplyShort")} {a.avgFirstResponseMinutes != null ? `${a.avgFirstResponseMinutes}m` : "—"}</span>
                          {a.csatAvg != null ? <span className="rounded bg-amber-50 text-amber-700 font-bold px-2 py-0.5">⭐ {a.csatAvg}</span> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {(report.perTeam ?? []).length ? (
                <div className="space-y-1.5 pt-2">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t("inbox.teamsBreakdown")}</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {report.perTeam.map((t: any) => (
                      <div key={t.teamId} className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-3 text-xs">
                        <div className="flex items-center justify-between font-bold text-slate-800">
                          <span>{t.name} {dictT("inbox.teamWordSuffix")}</span>
                          <span className="text-[11px] font-normal text-slate-500">{t("inbox.membersSuffix", { n: fmtNumber(locale, t.memberCount) })}</span>
                        </div>
                        {t.leadUserId ? <div className="text-[11px] text-slate-400 mt-0.5">{t("inbox.leadShort")} {memberName(t.leadUserId)}</div> : null}
                        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                          <span className="rounded bg-white px-1.5 py-0.5 shadow-2xs">{t("inbox.assignedShort", { n: fmtNumber(locale, t.assigned) })}</span>
                          <span className="rounded bg-white px-1.5 py-0.5 shadow-2xs">{t("inbox.openShort", { n: fmtNumber(locale, t.openNow) })}</span>
                          <span className="rounded bg-white px-1.5 py-0.5 shadow-2xs text-emerald-700 font-bold">{t("inbox.closedShort", { n: fmtNumber(locale, t.closed) })}</span>
                          {t.csatAvg != null ? <span className="rounded bg-amber-100 text-amber-800 font-bold px-1.5 py-0.5">⭐ {t.csatAvg}</span> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {(report.dailyTrend ?? []).length ? (
                <div className="border-t border-slate-100 pt-3">
                  <div className="mb-2 text-xs font-bold text-slate-500 uppercase tracking-wider">{t("inbox.dailyTrend")}</div>
                  <div className="flex flex-wrap gap-2">
                    {report.dailyTrend.map((d: any) => (
                      <div key={d.date} className="rounded-xl border border-slate-100 bg-slate-50/70 p-2 text-center text-xs min-w-[90px]">
                        <div className="text-[10px] font-bold text-slate-400">{d.date.slice(5)}</div>
                        <div className="mt-1 flex items-center justify-center gap-1.5 text-[11px]">
                          <span className="font-semibold text-slate-800" title={t("inbox.newWord")}>+{d.created}</span>
                          <span className="font-bold text-emerald-600" title={t("inbox.stClosedPlain")}>✓{d.closed}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : <p className="text-xs text-slate-400">{t("inbox.reportLoading")}</p>}
        </div>

        {/* IN10c: Analytics v2 — সব সংখ্যা আসল row থেকে
            compute-on-read; সংজ্ঞা docs/in10-acceptance.md-তে। */}
        <div id="inbox-manage-analytics" className="manage-card fade-rise scroll-mt-20 space-y-3">
          <div className="manage-head"><span className="manage-icon" aria-hidden="true">📈</span><div className="section-title">Inbox Analytics v2</div></div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">{t("inbox.rangeLabel")}</span>
            {[7, 30].map((d) => (
              <button key={d} className={`rounded-lg px-2.5 py-1 font-semibold ring-1 ${analyticsDays === d ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"}`} disabled={busy !== ""} onClick={() => void loadAnalytics(d)}>{t("inbox.inbZLastDays", { days: fmtNumber(locale, d) })}</button>
            ))}
            <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={() => void loadAnalytics(analyticsDays)}>{busy === "analytics" ? t("inbox.loadingBtn") : analytics ? t("inbox.reloadBtn") : t("inbox.loadBtn")}</button>
            {analytics ? <span className="text-slate-400">{t("inbox.inbZTimezoneNote", { tz: analytics.timezone })}</span> : null}
          </div>
          {analytics ? (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="ctx-tile"><div className="ctx-tile-label">{t("inbox.incomingMessages")}</div><div className="ctx-tile-value">{analytics.totals.inboundMessages}</div></div>
                <div className="ctx-tile"><div className="ctx-tile-label">{t("inbox.newConvsLabel")}</div><div className="ctx-tile-value">{analytics.totals.conversationsStarted}</div></div>
                <div className="ctx-tile"><div className="ctx-tile-label">{t("inbox.chatLinkedOrders")}</div><div className="ctx-tile-value">{analytics.totals.chatOrders}</div></div>
                <div className="ctx-tile"><div className="ctx-tile-label">{t("inbox.intentDetected")}</div><div className="ctx-tile-value">{analytics.totals.classifiedMessages}</div></div>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-500">{t("inbox.inbZHeatmapTitle")}{analytics.heatmap.peakHour ? <span className="font-normal text-slate-400">{t("inbox.inbZPeakPart", { hour: fmtNumber(locale, analytics.heatmap.peakHour.hour), count: fmtNumber(locale, analytics.heatmap.peakHour.count) })}</span> : null}</div>
                {(() => { const max = Math.max(1, ...analytics.heatmap.hourTotals); return (
                  <div className="flex h-16 items-end gap-[2px]" role="img" aria-label={t("inbox.heatmapAria")}>
                    {analytics.heatmap.hourTotals.map((n, h) => (
                      <div key={h} className="flex flex-1 flex-col items-center gap-0.5" title={t("inbox.inbZHeatHourTitle", { hour: fmtNumber(locale, h), count: fmtNumber(locale, n) })}>
                        <div className="w-full rounded-t bg-indigo-500/80" style={{ height: `${Math.max(4, (n / max) * 100)}%` }} />
                        <span className="text-[9px] text-slate-400">{h % 3 === 0 ? h : ""}</span>
                      </div>
                    ))}
                  </div>
                ); })()}
                {(() => { const max = Math.max(1, ...analytics.heatmap.matrix.flat()); const dayNames = [t("inbox.daySun"), t("inbox.dayMon"), t("inbox.dayTue"), t("inbox.dayWed"), t("inbox.dayThu"), t("inbox.dayFri"), t("inbox.daySat")]; return (
                  <div className="mt-2 space-y-[2px]" aria-label={t("inbox.heatmapWeekAria")}>
                    {analytics.heatmap.matrix.map((row, wd) => (
                      <div key={wd} className="flex items-center gap-[2px]">
                        <span className="w-12 shrink-0 text-[10px] text-slate-400">{dayNames[wd]}</span>
                        {row.map((n, h) => (
                          <span key={h} className="h-3 flex-1 rounded-[3px]" style={{ backgroundColor: `rgba(79,70,229,${n === 0 ? 0.05 : 0.15 + 0.85 * (n / max)})` }} title={t("inbox.inbZHeatCellTitle", { day: dayNames[wd], hour: fmtNumber(locale, h), count: fmtNumber(locale, n) })} />
                        ))}
                      </div>
                    ))}
                  </div>
                ); })()}
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-500">{t("inbox.channelConversionTitle")}</div>
                  <table className="w-full text-xs">
                    <thead><tr className="text-left text-slate-500"><th className="py-1 pr-2 font-semibold">{t("inbox.channelLabel")}</th><th className="py-1 pr-2 font-semibold">{t("inbox.inbZColActive")}</th><th className="py-1 pr-2 font-semibold">{t("inbox.inbZColOrdered")}</th><th className="py-1 font-semibold">{t("inbox.inbZColRate")}</th></tr></thead>
                    <tbody>
                      {analytics.channels.map((c) => (
                        <tr key={c.channel} className="border-t border-slate-100">
                          <td className="py-1 pr-2 font-medium">{c.channel}</td>
                          <td className="py-1 pr-2">{c.activeConversations}</td>
                          <td className="py-1 pr-2">{c.convertedConversations}</td>
                          <td className="py-1 font-semibold">{c.conversionPct != null ? `${c.conversionPct}%` : "—"}</td>
                        </tr>
                      ))}
                      {analytics.channels.length === 0 ? <tr><td colSpan={4} className="py-2 text-slate-400">{t("inbox.noConvsInRange")}</td></tr> : null}
                    </tbody>
                  </table>
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-500">{t("inbox.inbZIntentTitle")}</div>
                  <div className="space-y-1">
                    {analytics.intents.map((it) => (
                      <div key={it.intent} className="flex items-center gap-2 text-xs">
                        <span className="w-24 shrink-0 truncate font-medium">{it.intent}</span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full bg-emerald-500/80" style={{ width: `${it.pct ?? 0}%` }} /></span>
                        <span className="w-16 shrink-0 text-right text-slate-500">{t("inbox.inbZCountTi", { count: fmtNumber(locale, it.count) })}{it.pct != null ? ` · ${fmtNumber(locale, it.pct)}%` : ""}</span>
                      </div>
                    ))}
                    {analytics.intents.length === 0 ? <p className="text-xs text-slate-400">{t("inbox.inbZIntentEmpty")}</p> : null}
                  </div>
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-500">{t("inbox.inbZDailyTrendTitle")}</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-left text-slate-500"><th className="py-1 pr-2 font-semibold">{t("inbox.dateLabel")}</th><th className="py-1 pr-2 font-semibold">{t("inbox.newWord")}</th><th className="py-1 pr-2 font-semibold">{t("inbox.incomingMessages")}</th><th className="py-1 pr-2 font-semibold">{t("inbox.avgFirstResponse")}</th><th className="py-1 pr-2 font-semibold">{t("inbox.cmtBulkResolve")}</th><th className="py-1 font-semibold">{t("inbox.inbZAvgResolution")}</th></tr></thead>
                    <tbody>
                      {analytics.trend.map((r) => (
                        <tr key={r.date} className="border-t border-slate-100">
                          <td className="py-1 pr-2 font-medium">{r.date}</td>
                          <td className="py-1 pr-2">{r.newConversations}</td>
                          <td className="py-1 pr-2">{r.inboundMessages}</td>
                          <td className="py-1 pr-2">{r.avgFirstResponseMinutes != null ? t("inbox.inbZMinutesWord", { count: fmtNumber(locale, r.avgFirstResponseMinutes) }) : "—"}</td>
                          <td className="py-1 pr-2">{r.resolvedCount}</td>
                          <td className="py-1">{r.avgResolutionMinutes != null ? t("inbox.inbZMinutesWord", { count: fmtNumber(locale, r.avgResolutionMinutes) }) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">{t("inbox.inbZAvgNote")}</p>
              </div>
            </div>
          ) : <p className="text-xs text-slate-400">{t("inbox.inbZLoadHint", { load: t("inbox.loadBtn") })}</p>}
        </div>

        <div id="inbox-manage-teams" className="manage-card fade-rise scroll-mt-20 space-y-3">
          <div className="manage-head"><span className="manage-icon" aria-hidden="true">👥</span><div className="section-title">{t("inbox.inbZTeamAgentsTitle")}</div></div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">{t("inbox.inbZMyStatusLabel")}</span>
            {([["online", "🟢 Online"], ["busy", t("inbox.inbZStatusBusy")], ["away", "⚪ Away"]] as const).map(([v, label]) => (
              <button key={v} className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${myStatus === v ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-600 ring-slate-200"}`}
                onClick={async () => {
                  setMyStatus(v);
                  const orgId = getOrganizationId(); if (!orgId) return;
                  await apiFetch(`/organizations/${orgId}/inbox/agent-state`, { method: "POST", body: JSON.stringify({ status: v }) }).catch(() => undefined);
                  loadTeams();
                }}>{label}</button>
            ))}
            <span className="text-xs text-slate-400">{t("inbox.inbZAwayNote")}</span>
          </div>
          {agentStates.length ? (
            <div className="space-y-1">
              {agentStates.map((a) => (
                <div key={a.userId} className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                  <span className="font-medium">{a.status === "away" ? "⚪" : a.status === "busy" ? "🟠" : "🟢"} {a.name} <span className="text-slate-400">({a.role})</span>{a.hasSchedule && !a.onShift ? <span className="ml-1 rounded bg-slate-200 px-1 py-0.5 text-slate-600">{t("inbox.inbZOffShift")}</span> : null}</span>
                  <span>{t("inbox.inbZAgentOpen", { open: fmtNumber(locale, a.openCount), cap: fmtNumber(locale, a.capacity) })}{a.teams?.length ? ` · ${a.teams.join(", ")}` : ""}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-slate-400">{t("inbox.inbZAgentsLoading")}</p>}
          <div className="space-y-2 border-t pt-3">
            <div className="flex flex-wrap gap-2">
              <input className="input w-44" placeholder={t("inbox.inbZNewTeamPlaceholder")} value={teamForm.name} onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })} />
              {(["whatsapp", "messenger", "instagram", "webchat"] as const).map((ch) => (
                <label key={ch} className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={teamForm.channels.includes(ch)} onChange={(e) => setTeamForm({ ...teamForm, channels: e.target.checked ? [...teamForm.channels, ch] : teamForm.channels.filter((x) => x !== ch) })} />
                  <ChannelChip channel={ch} />
                </label>
              ))}
              <button className="btn-primary btn-sm" disabled={!teamForm.name.trim() || busy !== ""} onClick={async () => {
                const orgId = getOrganizationId(); if (!orgId) return;
                setBusy("team");
                try { await apiFetch(`/organizations/${orgId}/inbox/teams`, { method: "POST", body: JSON.stringify(teamForm) }); setTeamForm({ name: "", channels: [] }); loadTeams(); setNotice(t("inbox.inbZTeamCreated")); }
                catch (e) { setError(e instanceof Error ? e.message : t("inbox.inbZTeamCreateFailed")); }
                finally { setBusy(""); }
              }}>{t("inbox.inbZCreateTeamBtn")}</button>
            </div>
            <p className="text-[11px] text-slate-400">{t("inbox.inbZTeamNote")}</p>
            {teams.map((team) => (
              <div key={team.id} className="rounded-xl border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">{team.name} <span className="ml-1 font-normal text-xs text-slate-400">{t("inbox.inbZTeamOpenCount", { count: fmtNumber(locale, team.openCount) })}</span></div>
                  <div className="flex flex-wrap gap-1">{(team.channels ?? []).length ? (team.channels as string[]).map((ch) => <ChannelChip key={ch} channel={ch} />) : <span className="text-[11px] text-slate-400">{t("inbox.inbZAllChannels")}</span>}</div>
                </div>
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {members.map((mb) => {
                    const draft = teamDraft[team.id] ?? {};
                    const on = mb.user.id in draft;
                    return (
                      <label key={mb.user.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5 text-xs">
                        <input type="checkbox" checked={on} onChange={(e) => {
                          const next = { ...(teamDraft[team.id] ?? {}) };
                          if (e.target.checked) next[mb.user.id] = next[mb.user.id] ?? 20; else delete next[mb.user.id];
                          setTeamDraft({ ...teamDraft, [team.id]: next });
                        }} />
                        <span className="flex-1 truncate">{mb.user.name ?? mb.user.email}</span>
                        <span className="text-slate-400">{t("inbox.inbZCapacityWord")}</span>
                        <input type="number" min={1} max={200} className="w-16 rounded border px-1.5 py-0.5" disabled={!on} value={draft[mb.user.id] ?? 20}
                          onChange={(e) => setTeamDraft({ ...teamDraft, [team.id]: { ...(teamDraft[team.id] ?? {}), [mb.user.id]: Number(e.target.value) || 20 } })} />
                      </label>
                    );
                  })}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-slate-500">{t("inbox.inbZTeamLeadLabel")}</span>
                  {["OWNER", "ADMIN"].includes(agentStates.find((a) => a.userId === myId)?.role ?? "") ? (
                    <select className="input w-52" value={team.leadUserId ?? ""} onChange={async (e) => {
                      const orgId = getOrganizationId(); if (!orgId) return;
                      try {
                        await apiFetch(`/organizations/${orgId}/inbox/teams/${team.id}`, { method: "PATCH", body: JSON.stringify({ leadUserId: e.target.value || null }) });
                        loadTeams(); setNotice(t("inbox.inbZLeadUpdated"));
                      } catch (err) { setError(err instanceof Error ? err.message : t("inbox.inbZLeadSetFailed")); }
                    }}>
                      <option value="">{t("inbox.nobodyShort")}</option>
                      {members.map((mb) => <option key={mb.user.id} value={mb.user.id}>{mb.user.name ?? mb.user.email}</option>)}
                    </select>
                  ) : (
                    <span className="font-medium">{team.leadName ?? t("inbox.nobodyShort")}</span>
                  )}
                  <span className="text-slate-400">{t("inbox.leadTeamNote")}</span>
                </div>
                <div className="mt-2 flex gap-2">
                  <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                    const orgId = getOrganizationId(); if (!orgId) return;
                    setBusy("team");
                    try {
                      await apiFetch(`/organizations/${orgId}/inbox/teams/${team.id}/members`, { method: "POST", body: JSON.stringify({ members: Object.entries(teamDraft[team.id] ?? {}).map(([userId, capacity]) => ({ userId, capacity })) }) });
                      loadTeams(); setNotice(t("inbox.memberSaved"));
                    } catch (e) { setError(e instanceof Error ? e.message : t("inbox.saveFailed")); }
                    finally { setBusy(""); }
                  }}>{t("inbox.memberSaveBtn")}</button>
                  <button className="text-xs text-red-500" onClick={async () => {
                    const orgId = getOrganizationId(); if (!orgId || !window.confirm(t("inbox.inbZDeleteTeamConfirm", { name: team.name }))) return;
                    await apiFetch(`/organizations/${orgId}/inbox/teams/${team.id}`, { method: "DELETE" }).catch(() => undefined);
                    loadTeams();
                  }}>{t("inbox.teamDeleteBtn")}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={`${viewMode === "manage" && manageTab === "channels" ? "block" : "hidden"} space-y-4`}>
        <div className="rounded-xl bg-indigo-50 px-4 py-3 text-sm text-indigo-800 ring-1 ring-inset ring-indigo-100">
          🔗 <b>{t("inbox.connectCenterLabel")}</b>{t("inbox.inbZConnectCenterNoteA")}{" "}
          <Link href="/dashboard/connections#cc-forms-messaging" className="font-semibold underline">{t("inbox.connectCenterLink")}</Link>{" "}
          {t("inbox.inbZConnectCenterNoteB")}
        </div>
        <div className="card space-y-4 p-5">
          <div className="section-title">{t("inbox.moreChannels")}</div>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-2 rounded-xl border p-3">
              <div className="flex items-center gap-2 text-sm font-semibold"><ChannelChip channel="telegram" lg /> Bot Channel</div>
              <p className="text-xs text-slate-500">{t("inbox.inbZTelegramNote")}</p>
              <input className="input" type="password" placeholder="Bot Token (123456:ABC...)" value={tgToken} onChange={(e) => setTgToken(e.target.value)} />
              <button className="btn-primary btn-sm" disabled={!tgToken || busy !== ""} onClick={async () => {
                const orgId = getOrganizationId(); if (!orgId) return;
                setBusy("tg"); setTgResult("");
                try {
                  const r = await apiFetch<any>(`/organizations/${orgId}/inbox/connect/telegram`, { method: "POST", body: JSON.stringify({ botToken: tgToken }) });
                  setTgResult(t("inbox.inbZConnectedBot", { bot: r.bot, webhook: r.webhook?.registered ? t("inbox.inbZWebhookRegistered") : t("inbox.inbZWebhookFailed", { error: r.webhook?.error ?? "" }) }));
                  setTgToken("");
                } catch (e) { setTgResult(e instanceof Error ? e.message : t("inbox.connectFailed")); }
                finally { setBusy(""); }
              }}>{busy === "tg" ? t("inbox.verifying") : t("inbox.verifyConnect")}</button>
              {tgResult ? <p className="text-xs text-slate-600">{tgResult}</p> : null}
            </div>
            <div className="space-y-2 rounded-xl border p-3">
              <div className="flex items-center gap-2 text-sm font-semibold"><ChannelChip channel="email" lg /> Mailbox Lane</div>
              <p className="text-xs text-slate-500">{t("inbox.inbZEmailConnectNote")}</p>
              <div className="grid grid-cols-2 gap-1.5">
                <input className="input !text-xs" placeholder="IMAP Host" value={emailForm.imapHost} onChange={(e) => setEmailForm({ ...emailForm, imapHost: e.target.value })} />
                <input className="input !text-xs" type="number" placeholder="IMAP Port" value={emailForm.imapPort} onChange={(e) => setEmailForm({ ...emailForm, imapPort: Number(e.target.value) || 993 })} />
                <input className="input !text-xs" placeholder="SMTP Host" value={emailForm.smtpHost} onChange={(e) => setEmailForm({ ...emailForm, smtpHost: e.target.value })} />
                <input className="input !text-xs" type="number" placeholder="SMTP Port" value={emailForm.smtpPort} onChange={(e) => setEmailForm({ ...emailForm, smtpPort: Number(e.target.value) || 587 })} />
              </div>
              <input className="input" placeholder={t("inbox.emailAddressLabel")} value={emailForm.user} onChange={(e) => setEmailForm({ ...emailForm, user: e.target.value })} />
              <input className="input" type="password" placeholder="Password / App Password" value={emailForm.password} onChange={(e) => setEmailForm({ ...emailForm, password: e.target.value })} />
              <div className="flex gap-2">
                <button className="btn-primary btn-sm" disabled={!emailForm.imapHost || !emailForm.user || busy !== ""} onClick={async () => {
                  const orgId = getOrganizationId(); if (!orgId) return;
                  setBusy("email"); setEmailResult("");
                  try {
                    const r = await apiFetch<any>(`/organizations/${orgId}/inbox/connect/email`, { method: "POST", body: JSON.stringify(emailForm) });
                    setEmailResult(t("inbox.inbZConnectedMailbox", { mailbox: r.mailbox }));
                  } catch (e) { setEmailResult(e instanceof Error ? e.message : t("inbox.connectFailed")); }
                  finally { setBusy(""); }
                }}>{busy === "email" ? t("inbox.verifying") : t("inbox.verifyConnect")}</button>
                <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                  const orgId = getOrganizationId(); if (!orgId) return;
                  setBusy("emailsync");
                  try {
                    const r = await apiFetch<any>(`/organizations/${orgId}/inbox/email/sync`, { method: "POST" });
                    setEmailResult(t("inbox.inbZSyncResult", { stored: fmtNumber(locale, r.stored), dup: fmtNumber(locale, r.duplicates) }));
                  } catch (e) { setEmailResult(e instanceof Error ? e.message : t("inbox.syncFailed")); }
                  finally { setBusy(""); }
                }}>{t("inbox.syncNowBtn")}</button>
              </div>
              {emailResult ? <p className="text-xs text-slate-600">{emailResult}</p> : null}
            </div>
            <div className="space-y-2 rounded-xl border border-dashed p-3">
              <div className="flex items-center gap-2 text-sm font-semibold"><ChannelChip channel="tiktok" lg /> Business Messaging</div>
              <p className="text-xs text-amber-700">{t("inbox.tiktokPartner")}</p>
              {tiktokPack ? (
                <ol className="list-decimal space-y-1 pl-4 text-xs text-slate-500">
                  {(tiktokPack.steps as string[]).map((step: string, i: number) => <li key={i}>{step}</li>)}
                </ol>
              ) : <p className="text-xs text-slate-400">{t("inbox.infoLoading")}</p>}
            </div>
          </div>
        </div>

        <form onSubmit={connect} className="card space-y-3 p-5">
          <div className="section-title">{t("inbox.connectWaMsgr")}</div>
          <p className="text-sm text-slate-500">
            {t("inbox.inbZMetaConnectA")}
            {t("inbox.inbZMetaConnectB1")} <code className="rounded bg-slate-100 px-1">{t("inbox.connectYourDomain")}</code>{t("inbox.inbZMetaConnectB2")} <span className="font-medium">messages</span>{t("inbox.inbZMetaConnectB3")}
            {t("inbox.inbZCurrentConnection")}{integrations.length ? integrations.map((i) => `${i.provider} (${i.externalAccountId})`).join(", ") : t("inbox.noneWordShort")}
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <label className="block text-sm">{t("inbox.channelLabel")}<select className={inputCls} value={connectForm.channel} onChange={(e) => setConnectForm({ ...connectForm, channel: e.target.value })}>
                <option value="whatsapp">WhatsApp</option><option value="messenger">Messenger</option><option value="instagram">Instagram</option>
              </select>
            </label>
            <label className="block text-sm">Access Token<input className={inputCls} type="password" value={connectForm.accessToken} onChange={(e) => setConnectForm({ ...connectForm, accessToken: e.target.value })} required /></label>
            <label className="block text-sm">{t("inbox.appSecretLabel")}<input className={inputCls} type="password" value={connectForm.appSecret} onChange={(e) => setConnectForm({ ...connectForm, appSecret: e.target.value })} placeholder={t("inbox.appSecretPlaceholder")} /></label>
            <label className="block text-sm">{t("inbox.whichApp")}<select className={inputCls} value={connectForm.appSource} onChange={(e) => setConnectForm({ ...connectForm, appSource: e.target.value })}>
                <option value="platform">{t("inbox.platformApp")}</option>
                <option value="own">{t("inbox.ownApp")}</option>
              </select>
              {connectForm.appSource === "own" ? <span className="mt-1 block text-xs text-slate-400">{t("inbox.inbZOwnAppNote")}</span> : null}
            </label>
            <label className="block text-sm">{t("inbox.verifyTokenLabel")}<input className={inputCls} value={connectForm.verifyToken} onChange={(e) => setConnectForm({ ...connectForm, verifyToken: e.target.value })} required /></label>
            <label className="block text-sm">Phone Number ID (WhatsApp)<input className={inputCls} value={connectForm.phoneNumberId} onChange={(e) => setConnectForm({ ...connectForm, phoneNumberId: e.target.value })} /></label>
            <label className="block text-sm">Page ID (Messenger/Instagram)<input className={inputCls} value={connectForm.pageId} onChange={(e) => setConnectForm({ ...connectForm, pageId: e.target.value })} /></label>
          </div>
          <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>{busy === "connect" ? t("inbox.verifying") : t("inbox.verifyConnectLong")}</button>
        </form>
      </div>

      <div className={`${viewMode === "manage" && manageTab === "quick" ? "block" : "hidden"} grid gap-4 xl:grid-cols-2`}>
        <div className="card space-y-3 p-5">
          <div className="section-title">⚡ Quick Replies</div>
          <p className="text-xs text-slate-500">{t("inbox.inbZQuickReplyIntroA")}{"{{firstName}}"}, {"{{contactName}}"}, {"{{phone}}"}{t("inbox.inbZQuickReplyIntroB")}</p>
          <div className="space-y-1.5">
            {quickReplies.map((q) => (
              <div key={q.id} className="flex items-start justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <div className="min-w-0"><span className="font-semibold">{q.title}</span><span className="block truncate text-xs text-slate-500">{q.content}</span></div>
                <button className="text-xs text-red-500" onClick={() => deleteQr(q.id)}>{t("inbox.deleteBtn")}</button>
              </div>
            ))}
            {quickReplies.length === 0 ? <p className="text-xs text-slate-400">{t("inbox.noQuickReplies")}</p> : null}
          </div>
          <form onSubmit={addQr} className="space-y-2">
            <input className="input" placeholder={t("inbox.qrTitlePlaceholder")} value={qrForm.title} onChange={(e) => setQrForm({ ...qrForm, title: e.target.value })} required />
            <textarea className="input" rows={2} placeholder={t("inbox.qrBodyPlaceholder")} value={qrForm.content} onChange={(e) => setQrForm({ ...qrForm, content: e.target.value })} required />
            <button className="btn-secondary btn-sm">{t("inbox.addWord")}</button>
          </form>
        </div>

        <div className="manage-card fade-rise space-y-3">
          <div className="manage-head"><span className="manage-icon" aria-hidden="true">🎬</span><div className="section-title">{t("inbox.macroTitle")}</div></div>
          <p className="text-xs text-slate-500">{t("inbox.inbZMacroIntro")}</p>
          <div className="space-y-1.5">
            {macros.map((m) => (
              <div key={m.id} className="flex items-start justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-inset ring-slate-200/50">
                <div className="min-w-0">
                  <span className="font-semibold">{m.name}</span>
                  {m.shared ? <span className="badge-slate ml-1">{t("inbox.teamWordSuffix")}</span> : null}
                  {!m.mine ? <span className="badge-slate ml-1">{t("inbox.madeByOther")}</span> : null}
                  <span className="block truncate text-xs text-slate-500">{m.steps.map((s) => macroStepSummary(s, { quickReplyTitle: (id) => quickReplies.find((q) => q.id === id)?.title, memberName: (id) => members.find((mm) => mm.user.id === id)?.user.name ?? undefined })).join(" → ")}</span>
                </div>
                {m.mine ? <button className="shrink-0 text-xs text-red-500" disabled={busy === "macro-delete"} onClick={() => void deleteMacroById(m)}>{t("inbox.deleteBtn")}</button> : null}
              </div>
            ))}
            {macros.length === 0 ? <p className="text-xs text-slate-400">{t("inbox.noMacrosYet")}</p> : null}
          </div>
          <div className="space-y-2 rounded-xl bg-indigo-50/60 p-2.5 ring-1 ring-indigo-100">
            <input className="input" placeholder={t("inbox.macroNamePlaceholder")} value={macroName} onChange={(e) => setMacroName(e.target.value)} maxLength={80} />
            <div className="space-y-1.5">
              {macroDraft.map((d, i) => (
                <div key={i} className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="w-12 shrink-0 font-semibold text-slate-500">{t("inbox.inbZStepN", { n: fmtNumber(locale, i + 1) })}</span>
                  <select className="input !w-auto !py-1" value={d.type} onChange={(e) => setMacroDraft((prev) => prev.map((x, xi) => (xi === i ? { ...x, type: e.target.value } : x)))}>
                    {Object.entries(macroStepLabels(locale)).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                  </select>
                  {d.type === "reply" ? (
                    <select className="input !w-auto !py-1" value={d.quickReplyId} onChange={(e) => setMacroDraft((prev) => prev.map((x, xi) => (xi === i ? { ...x, quickReplyId: e.target.value } : x)))}>
                      <option value="">{t("inbox.pickQuickReplyDash")}</option>
                      {quickReplies.map((q) => <option key={q.id} value={q.id}>{q.title}</option>)}
                    </select>
                  ) : null}
                  {d.type === "assign" ? (
                    <select className="input !w-auto !py-1" value={d.assignedUserId} onChange={(e) => setMacroDraft((prev) => prev.map((x, xi) => (xi === i ? { ...x, assignedUserId: e.target.value } : x)))}>
                      <option value="me">{t("inbox.selfRunner")}</option>
                      <option value="__none__">{t("inbox.unassignAction")}</option>
                      {members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.name ?? m.user.email}</option>)}
                    </select>
                  ) : null}
                  {d.type === "tag" ? <input className="input !w-32 !py-1" placeholder={t("inbox.tagDots")} value={d.tag} onChange={(e) => setMacroDraft((prev) => prev.map((x, xi) => (xi === i ? { ...x, tag: e.target.value } : x)))} /> : null}
                  {d.type === "pipeline" ? (
                    <select className="input !w-auto !py-1" value={d.stage} onChange={(e) => setMacroDraft((prev) => prev.map((x, xi) => (xi === i ? { ...x, stage: e.target.value } : x)))}>
                      {PIPELINE_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  ) : null}
                  {d.type === "close" ? (
                    <select className="input !w-auto !py-1" value={d.outcome} onChange={(e) => setMacroDraft((prev) => prev.map((x, xi) => (xi === i ? { ...x, outcome: e.target.value } : x)))}>
                      <option value="">{t("inbox.noOutcomeOption")}</option>
                      {CONVERSATION_OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : null}
                  {d.type === "snooze" ? (
                    <input className="input !w-24 !py-1" type="number" min={5} max={10080} value={d.minutes} onChange={(e) => setMacroDraft((prev) => prev.map((x, xi) => (xi === i ? { ...x, minutes: Number(e.target.value) } : x)))} aria-label={t("inbox.snoozeMinutes")} />
                  ) : null}
                  {macroDraft.length > 1 ? <button className="text-red-500" onClick={() => setMacroDraft((prev) => prev.filter((_, xi) => xi !== i))}>✕</button> : null}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn-secondary btn-sm" disabled={macroDraft.length >= 10} onClick={() => setMacroDraft((prev) => [...prev, emptyMacroStep()])}>{t("inbox.addStepBtn")}</button>
              <label className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
                <input type="checkbox" checked={macroShared} onChange={(e) => setMacroShared(e.target.checked)} />{t("inbox.teamCanRun")}</label>
              <button className="btn-primary btn-sm" disabled={busy === "macro-create"} onClick={() => void createMacroFromBuilder()}>{t("inbox.createMacroBtn")}</button>
            </div>
          </div>
        </div>

        <div className="manage-card fade-rise space-y-3">
          <div className="manage-head"><span className="manage-icon" aria-hidden="true">🧩</span><div className="section-title">{t("inbox.waTplRegistry")}</div></div>
          <p className="text-xs text-slate-500">{t("inbox.inbZTemplateRegistryNote")}</p>
          <div className="space-y-1.5">
            {templates.map((tpl) => (
              <div key={tpl.id} className="flex items-start justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-inset ring-slate-200/50 transition hover:ring-slate-300">
                <div className="min-w-0"><span className="font-semibold">{tpl.name}</span> <span className="badge-slate">{tpl.language}</span> {tpl.category ? <span className="badge-brand">{tpl.category}</span> : null} {tpl.status === "APPROVED" ? <span className="badge-green">{t("inbox.tplApproved")}</span> : tpl.status === "PENDING" ? <span className="badge-amber">{t("inbox.tplPending")}</span> : tpl.status === "REJECTED" ? <span className="badge-red">{t("inbox.tplRejected")}</span> : tpl.status === "NOT_ON_META" ? <span className="badge-slate">{t("inbox.tplGoneFromMeta")}</span> : tpl.status ? <span className="badge-slate">{tpl.status}</span> : <span className="badge-slate">{t("inbox.tplNotVerified")}</span>}{tpl.qualityRating ? <span className="badge-slate">{t("inbox.inbZQualityPrefix", { rating: tpl.qualityRating })}</span> : null}<span className="block truncate text-xs text-slate-500">{tpl.bodyText ?? ""}</span></div>
                <button className="text-xs text-red-500" onClick={() => deleteTpl(tpl.id)}>{t("inbox.deleteBtn")}</button>
              </div>
            ))}
            {templates.length === 0 ? <p className="text-xs text-slate-400">{t("inbox.noTplRegistered")}</p> : null}
          </div>
          <form onSubmit={addTpl} className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder={t("inbox.tplNameLabel")} value={tplForm.name} onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })} required />
              <input className="input" placeholder={t("inbox.tplLangLabel")} value={tplForm.language} onChange={(e) => setTplForm({ ...tplForm, language: e.target.value })} required />
            </div>
            <select className="input" value={tplForm.category} onChange={(e) => setTplForm({ ...tplForm, category: e.target.value })}>
              <option value="UTILITY">UTILITY</option><option value="MARKETING">MARKETING</option><option value="AUTHENTICATION">AUTHENTICATION</option>
            </select>
            <textarea className="input" rows={2} placeholder={t("inbox.inbZTemplateBodyPlaceholder")} value={tplForm.bodyText} onChange={(e) => setTplForm({ ...tplForm, bodyText: e.target.value })} />
            <button className="btn-secondary btn-sm">{t("inbox.addWord")}</button>
          </form>
        </div>
      </div>
    </div>
  )}

      {paletteOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/60 backdrop-blur-sm p-4 pt-20 transition-all animate-in fade-in duration-150" onClick={() => setPaletteOpen(false)}>
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-3 text-sm font-semibold text-slate-800">
              <span className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-100 text-xs font-bold text-indigo-600">⌘</span>
                <span>{t("inbox.quickActionsPalette")}</span>
              </span>
              <kbd className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 shadow-2xs">ESC</kbd>
            </div>
            <div className="max-h-84 overflow-y-auto p-2 space-y-1">
              <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("inbox.unreadConvs")}</div>
              {conversations.filter((c) => c.unreadCount > 0).slice(0, 5).map((c) => (
                <button key={c.id} className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-slate-50 transition" onClick={() => { setPaletteOpen(false); void openConversation(c); }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <ContactAvatar name={c.contactName ?? c.contactPhone} channel={c.channel} size="sm" />
                    <span className="truncate font-medium text-slate-800">{c.contactName ?? c.contactPhone ?? t("inbox.customerFallback")}</span>
                  </div>
                  <span className="shrink-0 flex items-center gap-1.5">
                    <ChannelChip channel={c.channel} />
                    <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600 ring-1 ring-rose-200">{t("inbox.inbZUnreadCount", { count: fmtNumber(locale, c.unreadCount) })}</span>
                  </span>
                </button>
              ))}
              <div className="my-1.5 border-t border-slate-100" />
              <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("inbox.quickFiltersActions")}</div>
              <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 transition" onClick={() => { setPaletteOpen(false); onFilter({ unreadOnly: !filters.unreadOnly }); }}>
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-50 text-blue-600 text-xs font-bold">📬</span>
                <span>{filters.unreadOnly ? t("inbox.seeAllConvs") : t("inbox.filterUnreadOnly")}</span>
              </button>
              {(["whatsapp", "messenger", "instagram", "webchat"] as const).map((ch) => (
                <button key={ch} className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 transition" onClick={() => { setPaletteOpen(false); onFilter({ channel: filters.channel === ch ? "" : ch }); }}>
                  <span className="flex items-center gap-2">
                    <ChannelChip channel={ch} />
                    <span className="font-medium capitalize">{t("inbox.inbZChannelChatFilter", { channel: ch })}</span>
                  </span>
                  <span className="text-xs text-slate-400 font-medium">{filters.channel === ch ? t("inbox.activeCheck") : t("inbox.filterWord")}</span>
                </button>
              ))}
              {active && myId ? (
                <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-indigo-700 hover:bg-indigo-50 transition" onClick={() => { setPaletteOpen(false); void patchConversation({ assignedUserId: myId }); }}>
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 text-xs font-bold">👤</span>
                  <span>{t("inbox.assignSelfCurrent")}</span>
                  <kbd className="ml-auto rounded-md border border-indigo-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 shadow-2xs">E</kbd>
                </button>
              ) : null}
              <button className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 transition" onClick={() => { setPaletteOpen(false); setShowShortcuts(true); }}>
                <span className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-100 text-slate-600 text-xs font-bold">⌨️</span>
                  <span>{t("inbox.keyboardShortcutsList")}</span>
                </span>
                <kbd className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 shadow-2xs">?</kbd>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showShortcuts ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 transition-all animate-in fade-in duration-150" onClick={() => setShowShortcuts(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-slate-900/10" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 text-xs">⌨️</span>
                <span>{t("inbox.keyboardShortcuts")}</span>
              </div>
              <button className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition" onClick={() => setShowShortcuts(false)}>✕</button>
            </div>
            <ul className="divide-y divide-slate-100 text-xs text-slate-600">
              <li className="flex items-center justify-between py-2">
                <span>{t("inbox.openCommandPalette")}</span>
                <span className="flex items-center gap-1 font-mono">
                  <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700 shadow-2xs">⌘K</kbd>
                  <span className="text-slate-400">{t("inbox.inbZOrWord")}</span>
                  <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700 shadow-2xs">Ctrl+K</kbd>
                </span>
              </li>
              <li className="flex items-center justify-between py-2">
                <span>{t("inbox.listUpDown")}</span>
                <span className="flex items-center gap-1 font-mono">
                  <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700 shadow-2xs">J</kbd>
                  <span className="text-slate-400">/</span>
                  <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700 shadow-2xs">K</kbd>
                </span>
              </li>
              <li className="flex items-center justify-between py-2">
                <span>{t("inbox.openSelectedConv")}</span>
                <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold font-mono text-slate-700 shadow-2xs">Enter</kbd>
              </li>
              <li className="flex items-center justify-between py-2">
                <span>{t("inbox.focusSearch")}</span>
                <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold font-mono text-slate-700 shadow-2xs">/</kbd>
              </li>
              <li className="flex items-center justify-between py-2">
                <span>{t("inbox.goComposer")}</span>
                <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold font-mono text-slate-700 shadow-2xs">R</kbd>
              </li>
              <li className="flex items-center justify-between py-2">
                <span>{t("inbox.assignSelfCurrent")}</span>
                <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold font-mono text-slate-700 shadow-2xs">E</kbd>
              </li>
              <li className="flex items-center justify-between py-2">
                <span>{t("inbox.shortcutGuide")}</span>
                <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold font-mono text-slate-700 shadow-2xs">?</kbd>
              </li>
              <li className="flex items-center justify-between py-2">
                <span>{t("inbox.closePanelModal")}</span>
                <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold font-mono text-slate-700 shadow-2xs">Esc</kbd>
              </li>
            </ul>
            <div className="mt-4 rounded-xl bg-slate-50 p-2.5 text-[11px] text-slate-500 text-center">
              {t("inbox.inbZShortcutNote")}
            </div>
          </div>
        </div>
      ) : null}

      {/* 📱 Mobile Quick Actions Bottom Sheet (Matching Demo 1 & 2 Image #8) */}
      {quickActionsOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 backdrop-blur-xs transition-opacity animate-in fade-in" onClick={() => setQuickActionsOpen(false)}>
          <div className="w-full max-w-lg rounded-t-3xl bg-white p-5 shadow-2xl animate-in slide-in-from-bottom duration-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <span className="text-base font-bold text-slate-900">{t("inbox.quickActionWord")}</span>
              <button className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200" onClick={() => setQuickActionsOpen(false)}>✕</button>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-4">
              <button
                className="flex items-center gap-3 rounded-2xl border border-slate-200/90 bg-white p-3.5 text-left text-xs font-semibold text-slate-800 shadow-2xs hover:bg-blue-50/50 hover:border-blue-300"
                onClick={() => { setQuickActionsOpen(false); setOrderOpen(true); }}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 text-lg">📄</span>
                <div>
                  <div className="font-bold text-slate-900">{t("inbox.sendInvoice")}</div>
                  <div className="text-[10px] text-slate-400">{t("inbox.createOrderFromChat")}</div>
                </div>
              </button>
              <button
                className="flex items-center gap-3 rounded-2xl border border-slate-200/90 bg-white p-3.5 text-left text-xs font-semibold text-slate-800 shadow-2xs hover:bg-blue-50/50 hover:border-blue-300"
                onClick={() => { setQuickActionsOpen(false); setNotice(t("inbox.taskWindowOpeningShort")); }}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 text-lg">📋</span>
                <div>
                  <div className="font-bold text-slate-900">{t("inbox.createTaskBtn")}</div>
                  <div className="text-[10px] text-slate-400">{t("inbox.reminderFollowup")}</div>
                </div>
              </button>
              <button
                className="flex items-center gap-3 rounded-2xl border border-slate-200/90 bg-white p-3.5 text-left text-xs font-semibold text-slate-800 shadow-2xs hover:bg-amber-50/50 hover:border-amber-300"
                onClick={() => { setQuickActionsOpen(false); setComposerMode("note"); focusComposer(); }}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600 text-lg">📝</span>
                <div>
                  <div className="font-bold text-slate-900">{t("inbox.addNote")}</div>
                  <div className="text-[10px] text-slate-400">{t("inbox.teamPrivateWhisper")}</div>
                </div>
              </button>
              <button
                className="flex items-center gap-3 rounded-2xl border border-slate-200/90 bg-white p-3.5 text-left text-xs font-semibold text-slate-800 shadow-2xs hover:bg-emerald-50/50 hover:border-emerald-300"
                onClick={() => { setQuickActionsOpen(false); if (active) patchConversation({ status: active.status === "closed" ? "open" : "closed" }); }}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 text-lg">✓</span>
                <div>
                  <div className="font-bold text-slate-900">{t("inbox.markResolved")}</div>
                  <div className="text-[10px] text-slate-400">{t("inbox.resolveChatAction")}</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ✉️ New Message Modal (Matching Demo 1 & 2 Image #9) */}
      {newMsgOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in" onClick={() => setNewMsgOpen(false)}>
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl animate-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600 text-sm">✉️</span>
                <span className="text-base font-bold text-slate-900">{t("inbox.newMessage")}</span>
              </div>
              <button className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200" onClick={() => setNewMsgOpen(false)}>✕</button>
            </div>

            <div className="space-y-4 pt-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">{t("inbox.whichChannel")}</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {([
                    { id: "whatsapp", label: "WhatsApp", icon: "🟢", cls: "border-emerald-200 bg-emerald-50/60 text-emerald-800" },
                    { id: "messenger", label: "Messenger", icon: "🔵", cls: "border-sky-200 bg-sky-50/60 text-sky-800" },
                    { id: "instagram", label: "Instagram", icon: "🟣", cls: "border-fuchsia-200 bg-fuchsia-50/60 text-fuchsia-800" },
                    { id: "telegram", label: "Telegram", icon: "✈️", cls: "border-cyan-200 bg-cyan-50/60 text-cyan-800" },
                  ] as const).map((ch) => (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => setNewMsgForm({ ...newMsgForm, channel: ch.id })}
                      className={`flex items-center justify-center gap-1.5 rounded-2xl border p-2.5 text-xs font-bold transition ${
                        newMsgForm.channel === ch.id
                          ? `${ch.cls} ring-2 ring-blue-500/30 shadow-xs`
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <span>{ch.icon}</span>
                      <span>{ch.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">{t("inbox.recipientLabel")}</label>
                <input
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder={t("inbox.recipientPlaceholder")}
                  value={newMsgForm.recipient}
                  onChange={(e) => setNewMsgForm({ ...newMsgForm, recipient: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">{t("inbox.messageContentLabel")}</label>
                <textarea
                  rows={4}
                  className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50/50 px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder={t("inbox.sampleOfferText")}
                  value={newMsgForm.message}
                  onChange={(e) => setNewMsgForm({ ...newMsgForm, message: e.target.value })}
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                  onClick={() => setNewMsgOpen(false)}
                >{t("inbox.cancel")}</button>
                <button
                  type="button"
                  disabled={!newMsgForm.recipient.trim() || !newMsgForm.message.trim()}
                  className="flex items-center gap-1.5 rounded-2xl bg-blue-600 px-5 py-2.5 text-xs font-bold text-white shadow-md hover:bg-blue-700 disabled:opacity-50 transition"
                  onClick={() => {
                    setNewMsgOpen(false);
                    setNotice(t("inbox.inbZSendProcessing", { channel: newMsgForm.channel.toUpperCase() }));
                    setNewMsgForm({ channel: "whatsapp", recipient: "", message: "" });
                  }}
                >
                  <span>{t("inbox.sendBtn")}</span>
                  <span>🚀</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* 📱 Mobile Bottom Navigation Bar (Hidden during active chat so composer is never covered) */}
      <nav aria-label={t("inbox.mobileInboxMenu")} className={`fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-slate-200/90 bg-white/95 px-2 py-2 backdrop-blur-lg sm:hidden shadow-lg ${mobileChat ? "hidden" : ""}`}>
        <button
          onClick={() => { setViewMode("list"); setMobileChat(false); }}
          className={`flex flex-col items-center gap-0.5 text-[10px] font-semibold transition ${
            viewMode === "list" && !mobileChat ? "text-blue-600 font-bold" : "text-slate-500"
          }`}
        >
          <span className="text-lg">💬</span>
          <span>{t("inbox.tabConversations")}</span>
        </button>
        <button
          onClick={() => { setViewMode("board"); setMobileChat(false); }}
          className={`flex flex-col items-center gap-0.5 text-[10px] font-semibold transition ${
            viewMode === "board" ? "text-blue-600 font-bold" : "text-slate-500"
          }`}
        >
          <span className="text-lg">🗂️</span>
          <span>{t("inbox.tabPipeline")}</span>
        </button>
        <button
          onClick={() => setQuickActionsOpen(true)}
          className="flex flex-col items-center gap-0.5 text-[10px] font-semibold text-slate-700"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-white text-sm shadow-md">⚡</span>
          <span>{t("inbox.actionsWord")}</span>
        </button>
        <button
          onClick={() => { setViewMode("media"); setMobileChat(false); }}
          className={`flex flex-col items-center gap-0.5 text-[10px] font-semibold transition ${
            viewMode === "media" ? "text-blue-600 font-bold" : "text-slate-500"
          }`}
        >
          <span className="text-lg">🖼️</span>
          <span>{t("inbox.tabMedia")}</span>
        </button>
        <button
          onClick={() => { setViewMode("manage"); setMobileChat(false); }}
          className={`flex flex-col items-center gap-0.5 text-[10px] font-semibold transition ${
            viewMode === "manage" ? "text-blue-600 font-bold" : "text-slate-500"
          }`}
        >
          <span className="text-lg">⚙️</span>
          <span>{t("inbox.tabSettingsTeam")}</span>
        </button>
      </nav>
    </div>
  );
}

