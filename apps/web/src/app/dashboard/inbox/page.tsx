"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { API_URL, apiFetch, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { subscribeInboxStream } from "@/lib/inbox-stream";
import { EmptyState } from "@repo/ui";
import { EmojiPickerPanel, VoiceRecorder } from "@/components/inbox-extras";
import { ContactAvatar } from "@/components/inbox-avatar";
import { insertAtCursor, toggleBulletLines, wrapSelection } from "@/lib/composer-format";
import { COURIER_STEP_LABELS, courierStatusView } from "@/lib/courier-status";
import { mergeTimeline } from "@/lib/timeline";

/** Inbox Next-Gen P1: browser-upload cap. Mirrors the API's decoded
 * cap (MEDIA_UPLOAD_MAX_BYTES = 2MB in InboxService). */
const MEDIA_UPLOAD_MAX_BYTES = 2_000_000;
const clampPane = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(v)));

interface WaWindow { open: boolean; expiresAt: string | null }
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
  autoReplyPaused?: boolean;
  pipelineStage?: string;
  outcome?: string | null;
  csatRating?: number | null; csatSentAt?: string | null;
  summaryText?: string | null; summaryProvider?: string | null; summaryAt?: string | null;
}
interface Message {
  id: string; direction: string; content?: string | null; type: string; status: string;
  error?: string | null; createdAt: string; sentByAiDraft: boolean;
  mediaId?: string | null; mediaUrl?: string | null;
  mediaStorageKey?: string | null; mediaContentType?: string | null;
  intent?: string | null; intentConfidence?: number | null; autoReply?: boolean;
  sentiment?: "positive" | "negative" | null;
  transcription?: string | null; transcriptionProvider?: string | null;
}
interface PaymentVerification { id: string; messageId: string; verdict: string; provider?: string | null; trxId?: string | null; amountMinor?: string | null; expectedAmountMinor?: string | null; flags?: string[] | null }
interface Draft { id: string; content: string; provider: string; createdAt: string }
interface Note { id: string; content: string; authorUserId: string; createdAt: string }
interface QuickReply { id: string; title: string; content: string }
interface WaTemplate { id: string; name: string; language: string; category?: string | null; bodyText?: string | null }
interface Member { id: string; role: string; user: { id: string; name?: string | null; email: string } }
interface ContextData {
  customer: { id: string; name?: string | null; phone?: string | null; email?: string | null; createdAt: string } | null;
  lead: { id: string; stage: string; source: string; valueMinor?: string | null; tags?: string[] } | null;
  orders: { id: string; externalNumber?: string | null; status: string; source: string; isCod: boolean; currency: string; totalMinor: string; createdAt: string; codConfirmationStatus?: string | null; shipment?: { id: string; trackingCode?: string | null; status: string; provider: string; consignmentId?: string | null; codAmountMinor?: string | null; lastCheckedAt?: string | null } | null }[];
  lifetime: { orderCount: number; totalSpentMinor: string; currency: string } | null;
}

const MOOD_TITLE = "কীওয়ার্ড-ভিত্তিক আনুমানিক সংকেত — সাম্প্রতিক গ্রাহক-বার্তার শব্দ দেখে হিসাব করা, মনের অবস্থা নয়";

const money = (minor?: string | null, currency = "BDT") =>
  minor == null ? "—" : `${currency === "BDT" ? "৳" : currency + " "}${(Number(minor) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// ---- Unified Inbox U1: channel identity + day separators ----
const CHANNEL_META: Record<string, { label: string; emoji: string; cls: string }> = {
  whatsapp: { label: "WhatsApp", emoji: "🟢", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  messenger: { label: "Messenger", emoji: "🔵", cls: "bg-sky-50 text-sky-700 ring-sky-200" },
  instagram: { label: "Instagram", emoji: "🟣", cls: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200" },
  webchat: { label: "Live Chat", emoji: "🌐", cls: "bg-slate-100 text-slate-600 ring-slate-200" },
  tiktok: { label: "TikTok", emoji: "⚫", cls: "bg-slate-900 text-white ring-slate-700" },
  telegram: { label: "Telegram", emoji: "✈️", cls: "bg-cyan-50 text-cyan-700 ring-cyan-200" },
  email: { label: "Email", emoji: "✉️", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
};
function ChannelChip({ channel, lg }: { channel: string; lg?: boolean }) {
  const m = CHANNEL_META[channel] ?? { label: channel, emoji: "💬", cls: "bg-slate-100 text-slate-600 ring-slate-200" };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ring-1 ${m.cls} ${lg ? "text-xs" : "text-[10px]"}`}>{m.emoji} {m.label}</span>;
}
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yday = new Date(); yday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "আজ";
  if (d.toDateString() === yday.toDateString()) return "গতকাল";
  return d.toLocaleDateString("bn-BD", { day: "numeric", month: "long", year: "numeric" });
}

function renderQuick(content: string, conv: Conversation): string {
  const name = conv.contactName ?? "";
  return content
    .replaceAll("{{firstName}}", name.split(" ")[0] ?? "")
    .replaceAll("{{contactName}}", name)
    .replaceAll("{{phone}}", conv.contactPhone ?? "");
}

/** Fetches protected media bytes through the API proxy and renders them. */
function MediaView({ convId, message }: { convId: string; message: Message }) {
  const orgId = getOrganizationId();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/organizations/${orgId}/inbox/conversations/${convId}/messages/${message.id}/media`, {
          headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        });
        if (!res.ok) throw new Error("media");
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setUrl(objectUrl);
      } catch { if (!cancelled) setFailed(true); }
    })();
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [orgId, convId, message.id]);

  if (failed) return <span className="text-xs opacity-70">[মিডিয়া লোড হয়নি: {message.type}]</span>;
  if (!url) return <span className="text-xs opacity-70">মিডিয়া লোড হচ্ছে...</span>;
  if (message.type === "image" || message.type === "sticker") return <img src={url} alt={message.content ?? "ছবি"} className="max-h-56 rounded-lg" />;
  if (message.type === "audio") return <audio controls src={url} className="max-w-[240px]" />;
  if (message.type === "video") return <video controls src={url} className="max-h-56 rounded-lg" />;
  return <a href={url} target="_blank" rel="noreferrer" className="underline">📎 ফাইল খুলুন ({message.type})</a>;
}

/** Inbox Next-Gen P2: live courier tracking widget. The status
 * string is the courier's own words (stored verbatim); the
 * stepper follows the documented mapping in lib/courier-status —
 * an unmapped status renders the courier's words alone, with no
 * stepper guess. Sync calls the existing manual sync endpoint and
 * surfaces provider errors verbatim (handled by the caller). */
function ShipmentWidget({ shipment, currency, syncing, onSync }: {
  shipment: { id: string; trackingCode?: string | null; status: string; provider: string; codAmountMinor?: string | null; lastCheckedAt?: string | null };
  currency: string;
  syncing: boolean;
  onSync: () => void;
}) {
  const view = courierStatusView(shipment.status);
  return (
    <div className="mt-1.5 rounded-lg bg-white p-2 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <span className="font-semibold">🚚 {shipment.provider}{shipment.trackingCode ? ` · ${shipment.trackingCode}` : ""}</span>
        <button className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold hover:bg-slate-200 disabled:opacity-50" disabled={syncing} onClick={onSync} title="কুরিয়ারের কাছ থেকে এখনই সর্বশেষ স্ট্যাটাস আনুন">
          {syncing ? "আপডেট হচ্ছে…" : "🔄 এখনই আপডেট করুন"}
        </button>
      </div>
      {view.kind === "progress" ? (
        <div className="mt-2">
          <div className="flex items-center gap-1">
            {COURIER_STEP_LABELS.map((label, i) => (
              <div key={label} className="flex flex-1 flex-col items-center gap-1">
                <div className={`h-1.5 w-full rounded-full ${i <= view.step ? "bg-emerald-500" : "bg-slate-200"}`} />
                <span className={`text-center text-[9px] leading-tight ${i === view.step ? "font-bold text-emerald-700" : "text-slate-400"}`}>{label}</span>
              </div>
            ))}
          </div>
          {view.partial ? <div className="mt-1 text-[11px] font-medium text-amber-600">আংশিক ডেলিভার্ড — কিছু পণ্য পৌঁছেছে (কুরিয়ারের স্ট্যাটাস: {shipment.status})</div> : null}
        </div>
      ) : view.kind === "returned" ? (
        <div className="mt-1.5 rounded-md bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700">↩️ পার্সেল রিটার্ন এসেছে (কুরিয়ারের স্ট্যাটাস: {shipment.status})</div>
      ) : view.kind === "cancelled" ? (
        <div className="mt-1.5 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">✖️ শিপমেন্ট বাতিল হয়েছে (কুরিয়ারের স্ট্যাটাস: {shipment.status})</div>
      ) : (
        <div className="mt-1.5 text-[11px] text-slate-500">কুরিয়ারের স্ট্যাটাস: <b>{shipment.status}</b></div>
      )}
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
        <span>সর্বশেষ যাচাই: {shipment.lastCheckedAt ? new Date(shipment.lastCheckedAt).toLocaleString("bn-BD") : "এখনো যাচাই হয়নি"}</span>
        {shipment.codAmountMinor && Number(shipment.codAmountMinor) > 0 ? <span>COD: <b className="text-slate-600">{money(shipment.codAmountMinor, currency)}</b></span> : null}
      </div>
    </div>
  );
}

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
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
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
  const [filters, setFilters] = useState({ q: "", channel: "", status: "", assignee: "", tag: "", unreadOnly: false, sort: "recent", spamOnly: false });
  // Inbox Next-Gen P2: smart folders (server-side counts — the
  // list page itself is capped, so its length would lie) + bulk
  // selection state.
  const [smartFolder, setSmartFolder] = useState<"" | "sla" | "vip">("");
  const [folderCounts, setFolderCounts] = useState<{ all: number; mine: number; unassigned: number; slaBreach: number; vip: number; vipThresholdMinor: string | null; slaFirstResponseMinutes: number } | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAssign, setBulkAssign] = useState("");
  const [bulkTag, setBulkTag] = useState("");
  const [connectForm, setConnectForm] = useState({ channel: "whatsapp", accessToken: "", appSecret: "", verifyToken: "", phoneNumberId: "", pageId: "" });
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [qrForm, setQrForm] = useState({ title: "", content: "" });
  const [tplForm, setTplForm] = useState({ name: "", language: "bn", category: "UTILITY", bodyText: "" });
  const [settings, setSettings] = useState<{ autoReplyMode: string; confidenceThreshold: number; perIntent: Record<string, string>; smartAssign: string; slaFirstResponseMinutes: number; botEnabled?: boolean; botDeliveryChargeMinor?: number | null; reassignAfterMinutes?: number | null; escalationTeamId?: string | null; perChannelModes?: Record<string, string>; escalationThresholdMinor?: number | null; retentionDays?: number | null } | null>(null);
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
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { apiFetch<any>("/auth/me").then((j) => setMyId(j?.id ?? j?.user?.id ?? null)).catch(() => undefined); }, []);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadConversations = useCallback(async (f = filters, folderOverride?: string) => {
    const orgId = getOrganizationId(); if (!orgId) return;
    const params = new URLSearchParams();
    if (f.q) params.set("q", f.q);
    if (f.channel) params.set("channel", f.channel);
    if (f.status) params.set("status", f.status);
    if (f.assignee) params.set("assignee", f.assignee);
    if (f.tag) params.set("tag", f.tag);
    if (f.unreadOnly) params.set("unread", "1");
    if (f.spamOnly) params.set("spam", "1");
    if (f.sort !== "recent") params.set("sort", f.sort);
    // P2: the SLA/VIP smart folder rides as its own parameter and
    // AND-composes with the filters above (server-side).
    const effFolder = folderOverride !== undefined ? folderOverride : smartFolder;
    if (effFolder) params.set("folder", effFolder);
    try { setConversations(await apiFetch<Conversation[]>(`/organizations/${orgId}/inbox/conversations?${params.toString()}`)); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    try { setIntegrations(await apiFetch<any[]>(`/organizations/${orgId}/inbox/integrations`)); } catch { /* none */ }
    // P2: folder counts are server-side totals (see counts endpoint).
    try { setFolderCounts(await apiFetch<any>(`/organizations/${orgId}/inbox/conversations/counts`)); } catch { /* counts are additive */ }
  }, [filters, smartFolder]);

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
    const ob = new IntersectionObserver((es) => { if (es[0]?.isIntersecting) setVisibleCount((c) => c + 40); }, { rootMargin: "240px" });
    ob.observe(el);
    return () => ob.disconnect();
  }, [conversations.length]);
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
      setNotice("Inbox সেটিংস সেভ হয়েছে।");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  async function requestCod(orderId: string) {
    const orgId = getOrganizationId(); if (!orgId || !active) return;
    setBusy("cod"); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/inbox/conversations/${active.id}/cod-confirmation`, { method: "POST", body: JSON.stringify({ orderId }) });
      setNotice("COD কনফার্মেশন বার্তা পাঠানো হয়েছে। গ্রাহকের উত্তরের অপেক্ষায়।");
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
  function applyFolder(folderVal: "" | "sla" | "vip", assigneeVal?: string) {
    setVisibleCount(40); setFocusedIdx(0);
    setSmartFolder(folderVal);
    setSelectedIds(new Set());
    if (assigneeVal !== undefined) {
      const next = { ...filters, assignee: assigneeVal };
      setFilters(next);
      loadConversations(next, folderVal);
    } else {
      loadConversations(filters, folderVal);
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
    if (action === "assign" && !bulkAssign) { setError("অ্যাসাইন করার জন্য একজন সদস্য বেছে নিন।"); return; }
    if (action === "tag-add" && !bulkTag.trim()) { setError("যোগ করার জন্য একটি ট্যাগ লিখুন।"); return; }
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
      setNotice(`বাল্ক সম্পন্ন: সফল ${r.succeeded}টি${r.failed ? `, ব্যর্থ ${r.failed}টি` : ""}।`);
      if (failed.length) {
        setError(`ব্যর্থ ${failed.length}টি: ${failed.slice(0, 3).map((x) => x.error ?? x.id).join(" · ")}`);
        setSelectedIds(new Set(failed.map((x) => x.id)));
      } else {
        setSelectedIds(new Set());
        if (action === "tag-add") setBulkTag("");
      }
      loadConversations();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  /** P2 courier widget: manual sync through the existing courier
   * endpoint; provider errors surface verbatim. */
  async function syncShipment(shipmentId: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(`sync:${shipmentId}`); setError("");
    try {
      const r = await apiFetch<any>(`/organizations/${orgId}/courier/shipments/${shipmentId}/sync`, { method: "POST" });
      setNotice(`কুরিয়ার স্ট্যাটাস আপডেট হয়েছে: ${r.status ?? ""}`);
      await refreshActive();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  async function openConversation(conv: Conversation) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError("");
    // P3: ghost / tone state never carries across conversations.
    setGhost(""); ghostForRef.current = ""; ghostLastFetchRef.current = "";
    ghostAbortRef.current?.abort();
    setPrevReply(null); setShowToneMenu(false); setComposerMode("reply");
    try {
      const res = await apiFetch<{ conversation: Conversation; messages: Message[]; drafts: Draft[]; context: ContextData; botSession?: { id: string; state: string; status: string } | null }>(`/organizations/${orgId}/inbox/conversations/${conv.id}`);
      setActive(res.conversation); setMessages(res.messages); setDrafts(res.drafts); setContext(res.context); setBotSession(res.botSession ?? null);
      apiFetch<any>(`/organizations/${orgId}/inbox/conversations/${conv.id}/command-profile`).then(setProfile).catch(() => setProfile(null));
      setNotes(await apiFetch<Note[]>(`/organizations/${orgId}/inbox/conversations/${conv.id}/notes`).catch(() => []));
      setVerifications(await apiFetch<PaymentVerification[]>(`/organizations/${orgId}/inbox/conversations/${conv.id}/payment-verifications`).catch(() => []));
      setMobileChat(true);
      if (conv.unreadCount > 0) {
        await apiFetch(`/organizations/${orgId}/inbox/conversations/${conv.id}/read`, { method: "POST" });
        loadConversations();
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  async function refreshActive() { if (active) await openConversation(active); }

  async function patchConversation(patch: Partial<Conversation>) {
    const orgId = getOrganizationId(); if (!orgId || !active) return;
    try {
      const updated = await apiFetch<Conversation>(`/organizations/${orgId}/inbox/conversations/${active.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      setActive({ ...active, ...updated });
      loadConversations();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy("connect"); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/inbox/connect`, { method: "POST", body: JSON.stringify(connectForm) });
      setNotice("কানেক্ট হয়েছে (Token যাচাই সফল)। এখন Webhook সেট করলেই বার্তা আসবে।");
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
    setBusy("send"); setError("");
    try {
      const msg = await apiFetch<Message>(`/organizations/${orgId}/inbox/conversations/${active.id}/messages`, { method: "POST", body: JSON.stringify({ content: reply }) });
      setMessages((m) => [...m, msg]); setReply(""); setGhost(""); ghostForRef.current = ""; ghostLastFetchRef.current = "";
      loadConversations();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
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
      reader.onerror = () => reject(new Error("ফাইলটি পড়া যায়নি।"));
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
        setError(`"${file.name}" খুব বড় (${(file.size / 1048576).toFixed(1)}MB) — সর্বোচ্চ 2MB পর্যন্ত পাঠানো যাবে।`);
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
    if (orderItems.length === 0) { setError("অন্তত একটি পণ্য যোগ করুন।"); return; }
    setBusy("order"); setError("");
    try {
      const order = await apiFetch<any>(`/organizations/${orgId}/inbox/conversations/${active.id}/orders`, {
        method: "POST",
        body: JSON.stringify({ items: orderItems, shippingMinor: Math.round((Number(orderShip) || 0) * 100), isCod: orderCod, address: orderAddress || undefined }),
      });
      if (order.storeSyncStatus === "synced") setNotice(`Order তৈরি হয়েছে এবং WooCommerce এ পাঠানো হয়েছে (#${order.externalNumber})।`);
      else if (order.storeSyncStatus === "failed") setNotice(`Order তৈরি হয়েছে (শুধু এই সিস্টেমে)। স্টোরে পাঠানো যায়নি: ${order.storeSyncError ?? "অজানা ত্রুটি"}`);
      else setNotice(`Order তৈরি হয়েছে (শুধু এই সিস্টেমে) — ${order.externalNumber}।`);
      // M50: merchant-side return-risk warning (never shown to the customer).
      if (order.risk && (order.risk.band === "high" || order.risk.band === "medium")) {
        setError(`⚠️ রিটার্ন ঝুঁকি (${order.risk.band === "high" ? "উচ্চ" : "মাঝারি"}${order.risk.score != null ? `, স্কোর ${order.risk.score}` : ""}): ${order.risk.reasons?.[0] ?? ""} ${order.risk.suggestion ?? ""}`);
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
      setNotice("সারসংক্ষেপ তৈরি হয়েছে।");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(""); }
  }

  function insertProductSnippet(prod: { name: string; priceMinor: string; currency: string; stockQuantity?: number | null }) {
    const price = money(prod.priceMinor, prod.currency);
    const stock = prod.stockQuantity == null ? "" : prod.stockQuantity > 0 ? `, স্টকে ${prod.stockQuantity}টি আছে` : ", আপাতত স্টক শেষ";
    setReply((prev) => `${prev}${prev && !prev.endsWith(" ") ? " " : ""}"${prod.name}" — দাম ${price}${stock}।`);
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
        r.sentAs === "text" ? "⚠️ প্রোডাক্টের ছবি পাঠানো যায়নি — টেক্সট হিসেবে পাঠানো হয়েছে।" :
        r.captionDelivered === false ? "ছবি পাঠানো হয়েছে, তবে ক্যাপশন টেক্সটটি পাঠানো যায়নি।" :
        "🃏 প্রোডাক্ট কার্ড পাঠানো হয়েছে।",
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
      setNotice("Template পাঠানো হয়েছে (Meta Message ID পাওয়া গেছে)।");
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
      const note = await apiFetch<Note>(`/organizations/${orgId}/inbox/conversations/${active.id}/notes`, { method: "POST", body: JSON.stringify({ content: reply }) });
      setNotes((n) => [...n, note]); setReply(""); setIAmTyping(false);
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
  const statusIcon = (m: Message) => m.direction === "in" ? "" : m.status === "failed" ? " · ব্যর্থ" : m.status === "read" ? " · পঠিত" : m.status === "delivered" ? " · পৌঁছেছে" : " · পাঠানো হয়েছে";
  const memberName = (userId?: string | null) => {
    const m = members.find((x) => x.user.id === userId);
    return m ? (m.user.name ?? m.user.email) : userId ? "টিম সদস্য" : "কেউ নয়";
  };
  const windowLeft = (w?: WaWindow | null): string => {
    if (!w?.expiresAt) return "";
    const ms = new Date(w.expiresAt).getTime() - Date.now();
    if (ms <= 0) return "";
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return `${h} ঘণ্টা ${m} মিনিট`;
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
    if (mood === "positive") return <span title={MOOD_TITLE} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">😃 ইতিবাচক</span>;
    if (mood === "neutral") return <span title={MOOD_TITLE} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">😐 স্বাভাবিক</span>;
    if (mood === "negative") return <span title={MOOD_TITLE} className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-red-200">😡 অসন্তুষ্টির সংকেত</span>;
    return null;
  };

  return (
    <div className={viewMode === "list" ? "flex h-[calc(100dvh-164px)] flex-col gap-3 sm:h-[calc(100dvh-180px)] lg:h-[calc(100dvh-116px)]" : "space-y-6"}>
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
                  {conversations.length} চ্যাট
                </span>
              </div>
              <p className="text-xs text-slate-400">রিয়েলটাইম অমনিচ্যানেল মেসেজিং ও সেলস পাইপলাইন</p>
            </div>
          </div>

          {/* Segmented View Switcher */}
          <div className="flex items-center rounded-xl bg-slate-100/90 p-1 text-xs font-semibold ring-1 ring-slate-200/60">
            <button
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all ${viewMode === "list" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
              onClick={() => setViewMode("list")}
            >
              <span>💬</span> <span>কথোপকথন</span>
            </button>
            <button
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all ${viewMode === "board" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
              onClick={() => setViewMode("board")}
            >
              <span>🗂️</span> <span>পাইপলাইন</span>
            </button>
            <button
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all ${viewMode === "media" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
              onClick={() => setViewMode("media")}
            >
              <span>🖼️</span> <span>মিডিয়া</span>
            </button>
            <button
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all ${viewMode === "manage" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
              onClick={() => setViewMode("manage")}
            >
              <span>⚙️</span> <span>সেটিংস ও টিম</span>
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
              title={soundEnabled ? "বিজ্ঞপ্তি সাউন্ড চালু (ক্লিক করে বন্ধ করুন)" : "বিজ্ঞপ্তি সাউন্ড বন্ধ (ক্লিক করে চালু করুন)"}
            >
              <span>{soundEnabled ? "🔔" : "🔕"}</span>
            </button>
            <button
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50 transition"
              onClick={() => setPaletteOpen(true)}
              title="কমান্ড প্যালেট খুলুন"
            >
              <span>🔍</span>
              <kbd className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">⌘K</kbd>
            </button>
            <button
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50 transition"
              onClick={async () => {
                const orgId = getOrganizationId(); if (!orgId) return;
                try {
                  const data = await apiFetch<any>(`/organizations/${orgId}/inbox/export`);
                  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "inbox-export.json"; a.click(); URL.revokeObjectURL(a.href);
                } catch (e) { setError(e instanceof Error ? e.message : "Export ব্যর্থ"); }
              }}
              title="বিগত ৩০ দিনের ডেটা Export করুন"
            >
              <span>⬇️</span>
              <span className="hidden sm:inline">Export</span>
            </button>
          </div>
        </div>
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
                <span className="text-base font-bold text-slate-900">🗂️ সেলস পাইপলাইন বোর্ড</span>
                {board && (
                  <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-bold text-indigo-700 ring-1 ring-indigo-200">
                    মোট সক্রিয় {board.totalActive}টি
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">ড্র্যাগ করে স্টেজ পরিবর্তন করুন — অটোমেটিক স্টেজ সিঙ্ক হবে</p>
            </div>
            <button className="btn-secondary btn-sm" onClick={() => void loadBoard()}>↻ রিফ্রেশ</button>
          </div>

          {!board ? (
            <p className="py-12 text-center text-sm text-slate-400 font-medium">পাইপলাইন লোড হচ্ছে...</p>
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
                  title={stage === "shipped" ? "Shipped ধাপটি কুরিয়ারের স্ট্যাটাস থেকে নিজে থেকে আসে — এখানে কার্ড ফেলা যায় না" : undefined}
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
                    অর্ডার মূল্য: ৳{board.stages[stage] ? (Number(board.stages[stage].valueMinor) / 100).toLocaleString("bn-BD") : "০"}
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
                          <span className="truncate text-xs font-bold text-slate-900">{card.contactName ?? card.contactPhone ?? "গ্রাহক"}</span>
                          <ChannelChip channel={card.channel} />
                        </div>
                        <div className="truncate text-xs text-slate-500 mt-1">{card.lastMessagePreview ?? "—"}</div>
                        <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-1.5 text-[10.5px] text-slate-400">
                          <span>{card.lastMessageAt ? new Date(card.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ""}</span>
                          {card.unreadCount > 0 ? <span className="rounded-full bg-red-500 px-1.5 py-0.2 font-bold text-white text-[10px]">{card.unreadCount}</span> : null}
                          {card.latestOrderTotalMinor ? <span className="font-bold text-emerald-600">৳{(Number(card.latestOrderTotalMinor) / 100).toLocaleString("bn-BD")}</span> : null}
                        </div>
                      </div>
                    ))}
                    {(board.stages[stage]?.cards ?? []).length === 0 && (
                      <p className="py-6 text-center text-xs text-slate-400 italic">কোনো চ্যাট নেই</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-slate-400">কার্ড Drag করে অন্য কলামে ছাড়লে Stage বদলায়। Stage অটো-এগোয়ও: প্রথম Reply → Talking, Chat Order → Order Placed/Repeat, কুরিয়ার পার্সেল পথে থাকলে → Shipped (এই ধাপটি শুধু কুরিয়ারের আসল স্ট্যাটাস থেকে আসে — হাতে বসানো যায় না), Order Delivered হলে → Completed।</p>
        </div>
      ) : null}

      {viewMode === "media" ? (
        <div className="card p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <div className="text-base font-bold text-slate-900">🖼️ মিডিয়া লাইব্রেরি (শেষ ৯০ দিন)</div>
              <p className="text-xs text-slate-400 mt-0.5">সব চ্যানেল থেকে আসা ছবি, অডিও, ভিডিও ও ডকুমেন্ট</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="input !w-48 !text-xs !py-1.5"
                placeholder="নাম বা ফোন খুঁজুন…"
                value={mediaQ}
                onChange={(e) => setMediaQ(e.target.value)}
              />
              <select
                className="input !w-32 !text-xs !py-1.5"
                value={mediaType}
                onChange={(e) => setMediaType(e.target.value)}
              >
                <option value="">সব ধরন</option>
                <option value="image">🖼️ ছবি</option>
                <option value="audio">🎙️ ভয়েস</option>
                <option value="video">🎬 ভিডিও</option>
                <option value="document">📄 ডকুমেন্ট</option>
              </select>
              <button className="btn-secondary btn-sm" onClick={() => void loadMedia()}>↻ রিফ্রেশ</button>
            </div>
          </div>

          {mediaItems.length === 0 ? (
            <div className="py-16 text-center">
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-xl">🖼️</div>
              <p className="text-sm font-semibold text-slate-700">কোনো মিডিয়া পাওয়া যায়নি</p>
              <p className="text-xs text-slate-400 mt-0.5">গ্রাহক বা এজেন্টের পাঠানো ছবি ও ভয়েস ফাইল এখানে জমা থাকবে</p>
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
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">
                        💾 সুরক্ষিত ক্লাউড
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">
                        প্ল্যাটফর্মে
                      </span>
                    )}
                  </div>
                  <div className="mt-3 truncate text-xs font-bold text-slate-900 group-hover:text-brand-600 transition-colors">
                    {m.contactName ?? "গ্রাহক"} · <span className="capitalize">{m.channel}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400 flex items-center justify-between">
                    <span>{new Date(m.createdAt).toLocaleDateString("bn-BD")}</span>
                    {m.sizeBytes ? <span>{(m.sizeBytes / 1024).toFixed(0)} KB</span> : null}
                  </div>
                </button>
              ))}
            </div>
          )}
          <p className="text-[11px] text-slate-400">"💾 সুরক্ষিত ক্লাউড" মানে ছবি/ভয়েস আমাদের মিডিয়া পাইপলাইনে জমা আছে — মূল প্ল্যাটফর্ম থেকে লিংক মেয়াদ শেষ হলেও ফাইল মুছে যাবে না।</p>
        </div>
      ) : null}

      <div
        className={`${viewMode !== "list" ? "hidden" : ""} relative grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[var(--ilw,300px)_minmax(0,1fr)] xl:grid-cols-[var(--ilw,300px)_minmax(0,1fr)_var(--icw,320px)]`}
        style={{ "--ilw": `${listW}px`, "--icw": `${ctxW}px` } as React.CSSProperties}
      >
        {/* Pane splitters (desktop only): drag to resize, arrow
            keys nudge, double-click resets. Widths persist locally. */}
        <div
          role="separator" aria-label="কথোপকথন তালিকার প্রস্থ" aria-orientation="vertical" tabIndex={0}
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
          role="separator" aria-label="গ্রাহক প্যানেলের প্রস্থ" aria-orientation="vertical" tabIndex={0}
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
          {/* Glass Search Input */}
          <div className="relative shrink-0">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
              🔍
            </span>
            <input
              id="inbox-search"
              className="w-full rounded-2xl border border-slate-200/90 bg-white py-2 pl-9 pr-10 text-xs text-slate-900 shadow-xs placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              placeholder="নাম, ফোন বা বার্তা খুঁজুন..."
              value={filters.q}
              onChange={(e) => onSearch(e.target.value)}
            />
            <kbd className="pointer-events-none absolute inset-y-0 right-0 my-auto mr-2.5 flex h-5 items-center rounded border border-slate-200 bg-slate-50 px-1.5 text-[10px] font-bold text-slate-400 shadow-xs">
              /
            </kbd>
          </div>

          {/* Smart Folders with Badge Counts */}
          <div className="flex shrink-0 gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {([
              { key: "all", label: "সব", active: !smartFolder && !filters.assignee, count: folderCounts?.all, title: "সব কথোপকথন", onClick: () => applyFolder("", "") },
              { key: "mine", label: "👤 আমার", active: !smartFolder && filters.assignee === "me", count: folderCounts?.mine, title: "আমাকে অ্যাসাইন করা", onClick: () => applyFolder("", "me") },
              { key: "unassigned", label: "📥 অনির্ধারিত", active: !smartFolder && filters.assignee === "unassigned", count: folderCounts?.unassigned, title: "কাউকে অ্যাসাইন করা হয়নি", onClick: () => applyFolder("", "unassigned") },
              { key: "sla", label: "⏰ SLA Breach", active: smartFolder === "sla", count: folderCounts?.slaBreach, title: `প্রথম জবাব এখনো হয়নি এবং অপেক্ষা ${folderCounts?.slaFirstResponseMinutes ?? settings?.slaFirstResponseMinutes ?? 60} মিনিটের বেশি`, onClick: () => applyFolder("sla") },
              { key: "vip", label: "⭐ VIP অর্ডার", active: smartFolder === "vip", count: folderCounts?.vip, title: "বড় মূল্যের অর্ডারযুক্ত কন্ট্যাক্ট", onClick: () => applyFolder("vip") },
            ]).map((chip) => (
              <button
                key={chip.key}
                title={chip.title}
                onClick={chip.onClick}
                className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                  chip.active
                    ? "bg-slate-900 text-white shadow-xs"
                    : "border border-slate-200/80 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <span>{chip.label}</span>
                {chip.count !== undefined && chip.count !== null ? (
                  <span className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                    chip.active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"
                  }`}>
                    {chip.count}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          {/* Compact Filter Controls */}
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs">
            <select
              className="rounded-xl border border-slate-200/90 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-xs focus:border-brand-500 focus:outline-none"
              value={filters.channel}
              onChange={(e) => onFilter({ channel: e.target.value })}
            >
              <option value="">সব চ্যানেল</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="messenger">Messenger</option>
              <option value="instagram">Instagram</option>
              <option value="webchat">ওয়েবসাইট চ্যাট</option>
            </select>
            <select
              className="rounded-xl border border-slate-200/90 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-xs focus:border-brand-500 focus:outline-none"
              value={filters.assignee}
              onChange={(e) => onFilter({ assignee: e.target.value })}
            >
              <option value="">সবাই</option>
              <option value="me">আমারগুলো</option>
              <option value="unassigned">অনির্ধারিত</option>
            </select>
            <button
              className={`rounded-xl border px-2.5 py-1 text-xs font-semibold transition ${
                filters.unreadOnly ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200/80 bg-white text-slate-700 hover:bg-slate-50"
              }`}
              onClick={() => onFilter({ unreadOnly: !filters.unreadOnly })}
            >
              অপঠিত
            </button>
            <button
              className={`rounded-xl border px-2.5 py-1 text-xs font-semibold transition ${
                filters.sort === "unread" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200/80 bg-white text-slate-700 hover:bg-slate-50"
              }`}
              onClick={() => onFilter({ sort: filters.sort === "unread" ? "recent" : "unread" })}
            >
              অপঠিত আগে
            </button>
            <button
              className={`rounded-xl border px-2.5 py-1 text-xs font-semibold transition ${
                filters.spamOnly ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200/80 bg-white text-slate-700 hover:bg-slate-50"
              }`}
              onClick={() => onFilter({ spamOnly: !filters.spamOnly })}
            >
              🚫 Spam
            </button>
            <button
              className={`rounded-xl border px-2.5 py-1 text-xs font-semibold transition ${
                selectMode ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200/80 bg-white text-slate-700 hover:bg-slate-50"
              }`}
              title="একসাথে একাধিক কথোপকথন বেছে অ্যাকশন নিন"
              onClick={() => { setSelectMode((v) => !v); setSelectedIds(new Set()); }}
            >
              ☑️ বাল্ক
            </button>
          </div>
          <input
            className="rounded-xl border border-slate-200/90 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-xs placeholder:text-slate-400 focus:border-brand-500 focus:outline-none"
            placeholder="🏷️ Tag দিয়ে ফিল্টার (যেমন vip, repeat)..."
            value={filters.tag}
            onChange={(e) => onFilter({ tag: e.target.value })}
          />
          {selectedIds.size > 0 ? (
            <div className="shrink-0 rounded-xl bg-indigo-50 p-2 ring-1 ring-indigo-200">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-indigo-800">{selectedIds.size}টি নির্বাচিত</span>
                <button className="text-[11px] font-semibold text-indigo-600 hover:underline" onClick={() => setSelectedIds(new Set())}>সিলেকশন মুছুন</button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <select className="rounded-lg border border-indigo-200 bg-white px-1.5 py-1 text-[11px]" value={bulkAssign} onChange={(e) => setBulkAssign(e.target.value)} aria-label="অ্যাসাইন করুন">
                  <option value="">— অ্যাসাইন —</option>
                  <option value="__none__">অ্যাসাইন তুলে নিন</option>
                  {members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.name ?? m.user.email}</option>)}
                </select>
                <button className="rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50" disabled={busy === "bulk"} onClick={() => runBulk("assign")}>অ্যাসাইন</button>
                <input className="w-24 rounded-lg border border-indigo-200 bg-white px-1.5 py-1 text-[11px]" placeholder="ট্যাগ…" value={bulkTag} onChange={(e) => setBulkTag(e.target.value)} list="bulk-tag-list" />
                <datalist id="bulk-tag-list">{[...new Set(conversations.flatMap((c) => c.tags ?? []))].map((t) => <option key={t} value={t} />)}</datalist>
                <button className="rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50" disabled={busy === "bulk"} onClick={() => runBulk("tag-add")}>ট্যাগ যোগ</button>
                <button className="rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-indigo-200 disabled:opacity-50" disabled={busy === "bulk"} onClick={() => runBulk("mark-read")}>পঠিত</button>
                <button className="rounded-lg bg-white px-2 py-1 text-[11px] font-semibold text-red-600 ring-1 ring-red-200 disabled:opacity-50" disabled={busy === "bulk"} onClick={() => runBulk("close")}>বন্ধ করুন</button>
              </div>
            </div>
          ) : selectMode ? (
            <div className="shrink-0 text-[11px] text-slate-400">বাল্ক মোড চালু — কার্ডে ক্লিক করে কথোপকথন বেছে নিন।</div>
          ) : null}
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pt-1 pr-0.5">
            {conversations.length === 0 ? (
              smartFolder === "vip" && !folderCounts?.vipThresholdMinor ? (
                <EmptyState title="VIP ফোল্ডার এখনো সেট হয়নি" description="এই ফোল্ডারটি ইনবক্স সেটিংসের ‘এসকেলেশন থ্রেশহোল্ড’ ব্যবহার করে — থ্রেশহোল্ড সেট করা থাকলে, যেসব কথোপকথনের সর্বশেষ লিংকড অর্ডার সেই পরিমাণ বা তার বেশি, সেগুলো এখানে আসবে। সেটিংস খুলে থ্রেশহোল্ড বসান।" />
              ) : smartFolder === "vip" ? (
                <EmptyState title="কোনো VIP কথোপকথন নেই" description="থ্রেশহোল্ডের সমান বা বড় সর্বশেষ অর্ডারওয়ালা কোনো কথোপকথন এখন নেই।" />
              ) : smartFolder === "sla" ? (
                <EmptyState title="🎉 কোনো SLA breach নেই" description="প্রথম জবাবের অপেক্ষায় থ্রেশহোল্ডের বেশি সময় ধরে কোনো কথোপকথন আটকে নেই।" />
              ) : (
                <EmptyState title="কোনো কথোপকথন নেই" description="WhatsApp/Messenger কানেক্ট করে Webhook সেট করলে গ্রাহকের বার্তা এখানে আসবে। নতুন গ্রাহক মেসেজ দিলে স্বয়ংক্রিয়ভাবে একটি Lead তৈরি হয়।" />
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
                        {c.contactName ?? c.contactPhone ?? "(নাম নেই)"}
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        {c.lastMessageAt ? (
                          <span className="text-[10px] text-slate-400 font-medium">
                            {new Date(c.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
                      {c.lastMessagePreview || "কোনো বার্তা নেই"}
                    </p>

                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10.5px]">
                      <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium ${
                        c.status === "open" ? "bg-emerald-50 text-emerald-700" : c.status === "pending" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"
                      }`}>
                        {c.status === "open" ? "● ওপেন" : c.status === "pending" ? "○ পেন্ডিং" : "✓ বন্ধ"}
                      </span>

                      {isSlaBreach ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-1.5 py-0.5 font-semibold text-red-600 ring-1 ring-red-200">
                          ⏰ SLA
                        </span>
                      ) : null}

                      {c.channel === "whatsapp" && c.whatsappWindow ? (
                        c.whatsappWindow.open ? (
                          <span className="text-emerald-600 font-medium" title="২৪ ঘণ্টার ফ্রি-ফর্ম উইন্ডো খোলা">🟢 Window</span>
                        ) : (
                          <span className="text-amber-600 font-medium" title="উইন্ডো বন্ধ, শুধু টেমপ্লেট প্রযোজ্য">🔒 Window</span>
                        )
                      ) : null}

                      {c.spamFlag ? <span className="font-semibold text-amber-600">🚫 Spam</span> : null}
                      {c.priority === "high" ? <span className="font-semibold text-red-600">🔥 জরুরি</span> : null}
                      {c.mood === "negative" ? <span title={MOOD_TITLE}>😡</span> : c.mood === "positive" ? <span title={MOOD_TITLE}>😃</span> : null}

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
            {visibleCount < conversations.length ? <div ref={sentinelRef} className="py-2 text-center text-xs text-slate-400">আরও কথোপকথন লোড হচ্ছে… ({conversations.length - visibleCount} বাকি)</div> : null}
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
                  <span className="rounded-lg bg-white px-3 py-2 text-sm font-semibold shadow">📎 ছেড়ে দিন — ফাইলটি পাঠানো হবে</span>
                </div>
              ) : null}
              {/* Modern Thread Header */}
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-3">
                  <button className="rounded-xl border border-slate-200 bg-white p-2 text-xs font-semibold text-slate-700 shadow-xs lg:hidden hover:bg-slate-50" onClick={() => setMobileChat(false)}>
                    ← তালিকা
                  </button>
                  <ContactAvatar
                    name={active.contactName ?? active.contactPhone}
                    channel={active.channel}
                    size="md"
                    isOnline={active.channel === "webchat" && isVisitorOnline(active)}
                  />
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-900 text-sm sm:text-base">
                        {active.contactName ?? active.contactPhone ?? "গ্রাহক"}
                      </span>
                      <ChannelChip channel={active.channel} lg />
                      {moodChip(active.mood)}
                      {active.channel === "webchat" ? (() => {
                        const live = visitorLive[active.id];
                        const typingFresh = Boolean(live?.typing && nowTick - live.at < 8000);
                        if (typingFresh) return <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600 animate-pulse">✍️ টাইপ করছেন…</span>;
                        if (isVisitorOnline(active)) return <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600">🟢 অনলাইন</span>;
                        return null;
                      })() : null}
                    </div>
                    {active.contactPhone && (
                      <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                        <span>📞 {active.contactPhone}</span>
                        {active.assignedUserId && <span>· 👤 {memberName(active.assignedUserId)}</span>}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs xl:hidden hover:bg-slate-50" onClick={() => setCtxOpen(true)}>
                    <span>👤</span> <span>CRM তথ্য</span>
                  </button>
                  {/* Status Switcher pill */}
                  <div className="flex items-center rounded-xl bg-slate-100 p-1 text-xs font-semibold">
                    {(["open", "pending", "closed"] as const).map((s) => (
                      <button
                        key={s}
                        className={`rounded-lg px-2.5 py-1 transition-all ${
                          active.status === s ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-900"
                        }`}
                        onClick={() => patchConversation({ status: s })}
                      >
                        {s === "open" ? "ওপেন" : s === "pending" ? "পেন্ডিং" : "বন্ধ"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Thread Action Controls */}
              <div className="flex shrink-0 flex-wrap items-center gap-1.5 rounded-xl bg-slate-50/80 p-2 text-xs ring-1 ring-slate-100">
                <div className="flex items-center gap-1">
                  <span className="text-slate-400 font-medium ml-1">স্টেজ:</span>
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

                <button
                  className="flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 font-semibold text-sky-700 hover:bg-sky-100 transition disabled:opacity-50"
                  disabled={busy !== ""}
                  onClick={async () => {
                    const orgId = getOrganizationId(); if (!orgId) return; setBusy("track");
                    try { const r = await apiFetch<any>(`/organizations/${orgId}/inbox/conversations/${active.id}/share-tracking`, { method: "POST" }); setNotice(`Tracking পাঠানো হয়েছে: ${r.trackingCode}`); await refreshActive(); }
                    catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setBusy(""); }
                  }}
                >
                  <span>🚚</span> <span>ট্র্যাকিং</span>
                </button>

                <button
                  className="flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 font-semibold text-violet-700 hover:bg-violet-100 transition disabled:opacity-50"
                  disabled={busy !== ""}
                  onClick={async () => {
                    const orgId = getOrganizationId(); if (!orgId) return;
                    const order = context?.orders?.[0];
                    if (!order) { setError("কুরিয়ার বুকিংয়ের জন্য আগে একটি অর্ডার থাকতে হবে"); return; }
                    setBusy("courier");
                    try {
                      const conns = await apiFetch<any[]>(`/organizations/${orgId}/courier/connections`).catch(() => []);
                      const provider = (conns as any[])?.find((c: any) => c.status === "CONNECTED")?.provider;
                      if (!provider) { setError("কোনো কুরিয়ার কানেক্ট করা নেই — Orders পেজ থেকে আগে কানেক্ট করুন"); return; }
                      const address = (order as any).address || window.prompt("ডেলিভারি ঠিকানা দিন:") || "";
                      if (!address) return;
                      const r = await apiFetch<any>(`/organizations/${orgId}/courier/shipments`, { method: "POST", body: JSON.stringify({ orderId: order.id, provider, recipientAddress: address }) });
                      setNotice(`কুরিয়ার বুক হয়েছে (${provider}) — Tracking: ${r.trackingCode ?? ""}`);
                      await refreshActive();
                    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setBusy(""); }
                  }}
                >
                  <span>📦</span> <span>কুরিয়ার বুকিং</span>
                </button>

                <button
                  className="flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 font-semibold text-amber-700 hover:bg-amber-100 transition disabled:opacity-50"
                  disabled={busy !== ""}
                  onClick={async () => {
                    const orgId = getOrganizationId(); if (!orgId) return;
                    const reason = window.prompt("রিফান্ড অনুরোধের কারণ (বিলিং মালিক দেখবেন):") ?? "";
                    setBusy("refund");
                    try { await apiFetch(`/organizations/${orgId}/inbox/conversations/${active.id}/refund-request`, { method: "POST", body: JSON.stringify({ reason }) }); setNotice("রিফান্ড অনুরোধ বিলিং মালিকের কাছে পাঠানো হয়েছে (নোটে সংরক্ষিত)"); await refreshActive(); }
                    catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setBusy(""); }
                  }}
                >
                  <span>💸</span> <span>রিফান্ড</span>
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
                      if (!res.ok) throw new Error("Export ব্যর্থ");
                      const blob = await res.blob();
                      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `conversation-${active.id}.csv`; a.click(); URL.revokeObjectURL(a.href);
                    } catch (e) { setError(e instanceof Error ? e.message : "Export ব্যর্থ"); }
                  }}
                >
                  <span>⬇️</span> <span>CSV</span>
                </button>

                <button
                  className="flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 font-semibold text-red-600 hover:bg-red-100 transition disabled:opacity-50"
                  disabled={busy !== ""}
                  onClick={() => { if (window.confirm("এই কথোপকথন Spam হিসেবে চিহ্নিত করে বন্ধ করবেন?")) void patchConversation({ spamFlag: true, status: "closed", outcome: "spam" }); }}
                >
                  <span>🚫</span> <span>Spam</span>
                </button>

                {active.status !== "closed" ? (
                  <div className="ml-auto flex items-center gap-1.5">
                    <select
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 shadow-xs"
                      value={closeOutcome}
                      onChange={(e) => setCloseOutcome(e.target.value)}
                      title="বন্ধ করার ফলাফল (Outcome)"
                    >
                      <option value="sale">🛒 Sale হয়েছে</option>
                      <option value="no_sale_price">💰 No-sale: দাম</option>
                      <option value="no_sale_stock">📦 No-sale: স্টক নেই</option>
                      <option value="no_sale_undecided">🤔 No-sale: সিদ্ধান্ত নেয়নি</option>
                      <option value="support_resolved">🛠️ Support সমাধান</option>
                      <option value="spam">🚫 Spam</option>
                      <option value="other">• অন্যান্য</option>
                    </select>
                    <button
                      className="rounded-lg bg-slate-900 px-3 py-1 font-semibold text-white shadow-xs hover:bg-slate-800 transition"
                      onClick={() => patchConversation({ status: "closed", outcome: closeOutcome })}
                    >
                      ✓ ক্লোজ
                    </button>
                  </div>
                ) : active.outcome ? (
                  <span className="ml-auto font-medium text-slate-500">ফলাফল: {active.outcome}</span>
                ) : null}
              </div>

              {/* Inbox Next-Gen P1: the thread's ONE scroll region —
                  banners + messages + drafts scroll together; the
                  header rows above and the composer below stay put. */}
              <div ref={threadScrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
              {active.autoReplyPaused ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700 ring-1 ring-red-100">
                  <span>⏸️ Autopilot এই কথোপকথনে থেমে আছে (Escalation) — এখন মানুষ উত্তর দেবে।</span>
                  <button className="rounded-lg bg-white px-2 py-1 font-semibold text-red-600 ring-1 ring-red-200" onClick={() => patchConversation({ autoReplyPaused: false })}>▶️ আবার চালু করুন</button>
                </div>
              ) : null}

              {active.channel === "whatsapp" ? (
                active.whatsappWindow?.open ? (
                  <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">WhatsApp Window খোলা আছে · আরও {windowLeft(active.whatsappWindow)} ফ্রি-ফর্ম বার্তা পাঠানো যাবে।</p>
                ) : (
                  <div className="space-y-2 rounded-lg bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                    <p className="font-semibold">WhatsApp ২৪ ঘণ্টার Window বন্ধ। ফ্রি-ফর্ম বার্তা যাবে না, শুধু অনুমোদিত Template পাঠানো যাবে।</p>
                    {templates.length ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <select className="input !w-auto flex-1 bg-white" value={tplId} onChange={(e) => setTplId(e.target.value)}>
                          {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
                        </select>
                        <input className="input !w-auto flex-1 bg-white" placeholder="ভেরিয়েবল, কমা দিয়ে ({{1}}, {{2}}...)" value={tplVars} onChange={(e) => setTplVars(e.target.value)} />
                        <button className="btn-warning btn-sm" disabled={busy !== ""} onClick={sendTemplate}>{busy === "template" ? "পাঠাচ্ছি..." : "Template পাঠান"}</button>
                      </div>
                    ) : <p>কোনো Template রেজিস্ট্রি করা নেই। নিচের "WhatsApp Template রেজিস্ট্রি" অংশে Meta-অনুমোদিত Template যোগ করুন।</p>}
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
                    ⚠️ {merged.map((o) => o.typing ? `${o.name} উত্তর লিখছেন ✍️` : `${o.name} এই কথোপকথনটি দেখছেন 👁`).join(" · ")} — ডুপ্লিকেট উত্তর এড়াতে সমন্বয় করুন।
                  </p>
                );
              })()}
              <div className="space-y-3 rounded-2xl bg-slate-50/70 p-3 sm:p-4 ring-1 ring-slate-100">
                {timeline.map((item, i) => {
                  const prevDay = i > 0 ? new Date(timeline[i - 1].at).toDateString() : null;
                  const thisDay = new Date(item.at).toDateString();
                  const daySep = prevDay !== thisDay ? (
                    <div className="flex items-center gap-3 py-2">
                      <div className="h-px flex-1 bg-slate-200" />
                      <span className="rounded-full bg-white px-3 py-0.5 text-[11px] font-semibold text-slate-400 shadow-xs ring-1 ring-slate-200/60">
                        {dayLabel(item.at)}
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
                                <span>🔒</span> <span>টিম প্রাইভেট নোট (গ্রাহক দেখবে না)</span>
                              </span>
                              <span className="text-[10px] text-amber-600/80 font-medium">
                                {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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

                  return (
                    <React.Fragment key={m.id}>
                      {daySep}
                      <div className={`flex ${isIncoming ? "justify-start" : "justify-end"} my-0.5`}>
                        <div
                          className={`max-w-[85%] sm:max-w-[78%] px-4 py-2.5 shadow-xs transition-all ${
                            isIncoming
                              ? "inbox-bubble-in border border-slate-200/90 bg-white text-slate-800"
                              : m.status === "failed"
                              ? "inbox-bubble-out bg-red-50 border border-red-200 text-red-800"
                              : "inbox-bubble-out text-white shadow-indigo-500/10"
                          }`}
                        >
                          {(m.mediaId || m.mediaUrl || m.mediaStorageKey) && m.type !== "text" ? (
                            <div className="mb-2 overflow-hidden rounded-xl">
                              <MediaView convId={active.id} message={m} />
                            </div>
                          ) : null}

                          {m.content ? (
                            <div className="whitespace-pre-wrap text-[13.5px] leading-relaxed break-words font-normal">
                              {m.type === "template" ? `🧩 ${m.content}` : m.content}
                            </div>
                          ) : (m.mediaId || m.mediaUrl || m.mediaStorageKey) ? null : (
                            <div className="italic text-xs opacity-75">[{m.type}]</div>
                          )}

                          {/* Footer metadata */}
                          <div className={`mt-1.5 flex flex-wrap items-center gap-1 text-[10px] ${
                            isIncoming ? "text-slate-400" : "text-white/80"
                          }`}>
                            <span>
                              {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            {!isIncoming && (
                              <span className="font-medium">
                                {m.status === "read" ? " · ✓✓ পঠিত" : m.status === "delivered" ? " · ✓✓ পৌঁছেছে" : m.status === "failed" ? " · ⚠️ ব্যর্থ" : " · ✓ পাঠানো"}
                              </span>
                            )}
                            {m.sentByAiDraft ? <span className="rounded bg-black/10 px-1">AI Draft</span> : null}
                            {m.autoReply ? <span className="rounded bg-black/10 px-1">🤖 অটো</span> : null}

                            {isIncoming && m.intent && m.intent !== "other" ? (
                              <span className="ml-1 rounded-md bg-indigo-50 px-1.5 py-0.5 font-semibold text-indigo-600 ring-1 ring-indigo-200/60" title={`কনফিডেন্স ${m.intentConfidence ?? 0}%`}>
                                💡 {m.intent} ({m.intentConfidence}%)
                              </span>
                            ) : null}

                            {isIncoming && m.content ? (
                              <button
                                className="ml-1 font-semibold text-indigo-500 hover:text-indigo-700 hover:underline"
                                onClick={() => translateMsg(m)}
                              >
                                🌐 অনুবাদ
                              </button>
                            ) : null}
                          </div>

                          {m.error ? <div className="mt-1 text-xs text-red-500 font-medium">⚠️ {m.error}</div> : null}
                          {translations[m.id] ? (
                            <div className="mt-2 rounded-xl border border-indigo-100 bg-indigo-50/70 p-2 text-xs italic text-indigo-900">
                              🌐 {translations[m.id]}
                            </div>
                          ) : null}
                          {m.transcription ? (
                            <div className="mt-2 rounded-xl bg-slate-100/90 p-2 text-xs text-slate-700">
                              🎙️ {m.transcription} <span className="text-slate-400">({m.transcriptionProvider})</span>
                            </div>
                          ) : null}

                          {isIncoming && (m.mediaId || m.mediaUrl || m.mediaStorageKey) && m.type === "audio" && !m.transcription ? (
                            <button
                              className="mt-2 flex items-center gap-1 rounded-lg bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-100 transition disabled:opacity-50"
                              disabled={busy !== ""}
                              onClick={async () => {
                                const orgId = getOrganizationId(); if (!orgId || !active) return;
                                setBusy("transcribe");
                                try { await apiFetch(`/organizations/${orgId}/inbox/conversations/${active.id}/messages/${m.id}/transcribe`, { method: "POST" }); await refreshActive(); }
                                catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
                                finally { setBusy(""); }
                              }}
                            >
                              <span>🎙️</span> <span>ভয়েস লেখায় রূপান্তর করুন</span>
                            </button>
                          ) : null}

                          {isIncoming && (m.mediaId || m.mediaUrl || m.mediaStorageKey) && m.type === "image" ? (() => {
                            const v = verifications.find((x) => x.messageId === m.id);
                            return v ? (
                              <div className={`mt-2 rounded-xl p-2 text-xs font-medium ring-1 ${
                                v.verdict === "matched"
                                  ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                                  : v.verdict === "amount_mismatch" || v.verdict === "duplicate_trxid"
                                  ? "bg-red-50 text-red-800 ring-red-200"
                                  : "bg-amber-50 text-amber-800 ring-amber-200"
                              }`}>
                                💳 পেমেন্ট যাচাই: <b>{v.verdict}</b>
                                {v.trxId ? ` · TrxID: ${v.trxId}` : ""}
                                {v.amountMinor ? ` · ${money(v.amountMinor)}` : ""}
                                {v.expectedAmountMinor ? ` (প্রত্যাশিত ${money(v.expectedAmountMinor)})` : ""}
                                {v.flags?.length ? ` · ⚠️ ${v.flags.join(", ")}` : ""}
                              </div>
                            ) : (
                              <button
                                className="mt-2 flex items-center gap-1 rounded-lg bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-100 transition disabled:opacity-50"
                                disabled={busy !== ""}
                                onClick={async () => {
                                  const orgId = getOrganizationId(); if (!orgId || !active) return;
                                  setBusy("verify");
                                  try { await apiFetch(`/organizations/${orgId}/inbox/conversations/${active.id}/messages/${m.id}/verify-payment`, { method: "POST" }); await refreshActive(); }
                                  catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
                                  finally { setBusy(""); }
                                }}
                              >
                                <span>💳</span> <span>পেমেন্ট স্ক্রিনশট যাচাই</span>
                              </button>
                            );
                          })() : null}
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
                {timeline.length === 0 ? <p className="text-center py-6 text-sm text-slate-400 font-medium">কোনো বার্তা নেই</p> : null}
              </div>

              {drafts.map((d) => (
                <div key={d.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-amber-700">AI Draft {d.provider === "dev-template" ? "(Dev Template)" : `(${d.provider})`} · পাঠানো হয়নি, আপনার অনুমোদন দরকার</div>
                    <div className="flex gap-2">
                      <button className="rounded bg-amber-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50" disabled={busy !== ""} onClick={() => sendDraft(d)}>অনুমোদন ও পাঠান</button>
                      <button className="text-xs text-slate-500" onClick={() => dismissDraft(d.id)}>বাদ দিন</button>
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
                      <span>💬</span> <span>গ্রাহককে উত্তর</span>
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
                      <span>🔒</span> <span>টিম নোট (Whisper)</span>
                    </button>
                  </div>
                  {composerMode === "note" ? (
                    <span className="text-[11px] font-semibold text-amber-700">🔒 গোপনীয় — গ্রাহক কখনোই দেখবে না</span>
                  ) : active.whatsappWindow?.open ? (
                    <span className="text-[11px] text-emerald-600 font-medium">🟢 উইন্ডো খোলা ({windowLeft(active.whatsappWindow)})</span>
                  ) : null}
                </div>

                {composerMode === "reply" && showQuick && quickMatches.length ? (
                  <div className="absolute bottom-full left-0 right-0 z-20 mb-2 max-h-52 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl">
                    <div className="px-2 py-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">⚡ কুইক রিপ্লাই মিল</div>
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
                    <span className="text-[11px] font-medium text-amber-700">টিম মেম্বার Mention:</span>
                    {members.filter((mb) => mb.user.id !== myId).slice(0, 6).map((mb) => (
                      <button key={mb.user.id} type="button" className="rounded-full bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-700 ring-1 ring-amber-200 hover:bg-amber-100 transition" onClick={() => { setReply((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}@${mb.user.name ?? mb.user.email} `); focusComposer(); }}>
                        @{mb.user.name ?? mb.user.email}
                      </button>
                    ))}
                  </div>
                ) : null}

                {/* Textarea Box with Ghost Text Overlay */}
                <div className="relative">
                  {ghostVisible ? (
                    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden whitespace-pre-wrap break-words px-3 py-2 text-sm leading-relaxed">
                      <span className="invisible">{reply}</span><span className="text-slate-400/90 font-medium">{ghost}</span>
                    </div>
                  ) : null}
                  <textarea
                    id="inbox-reply"
                    ref={replyRef}
                    rows={2}
                    className={`relative z-10 w-full resize-none border-0 bg-transparent px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-0 ${
                      composerMode === "note" ? "text-amber-950 placeholder:text-amber-600/60" : "text-slate-900 placeholder:text-slate-400"
                    }`}
                    placeholder={composerMode === "note" ? "টিমের জন্য প্রাইভেট নোট লিখুন — গ্রাহক কখনোই দেখবে না…" : "উত্তর লিখুন... ( / চাপলে Quick Reply · Enter = পাঠান, Shift+Enter = নতুন লাইন )"}
                    value={reply}
                    onChange={(e) => { const v = e.target.value; setReply(v); setGhost(""); ghostForRef.current = ""; setPrevReply(null); setShowQuick(composerMode === "reply" && v.startsWith("/")); setIAmTyping(composerMode === "reply" && v.length > 0); }}
                    onBlur={() => setIAmTyping(false)}
                    onFocus={() => { if (composerMode === "reply" && reply.startsWith("/")) setShowQuick(true); }}
                    onPaste={(e) => {
                      if (composerMode !== "reply") return;
                      const files = Array.from(e.clipboardData?.files ?? []);
                      if (files.length) { e.preventDefault(); void sendMediaFiles(files); }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Tab" && ghostVisible) { e.preventDefault(); const accepted = reply + ghost; setGhost(""); ghostForRef.current = ""; ghostLastFetchRef.current = ""; setReply(accepted); focusComposer(accepted.length, accepted.length); return; }
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (composerMode === "note") { void addNote(); } else { void sendReply(); } }
                      if (e.key === "Escape") { setGhost(""); ghostForRef.current = ""; setShowQuick(false); setShowEmoji(false); setShowToneMenu(false); }
                    }}
                  />
                </div>

                {ghostVisible ? (
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-brand-600 bg-brand-50/60 px-2.5 py-1 rounded-lg">
                    <span>✨</span>
                    <span>AI সাজেশন পাওয়া গেছে —</span>
                    <kbd className="rounded bg-white px-1.5 py-0.5 text-[10px] font-bold shadow-xs">Tab</kbd>
                    <span>চাপলে গ্রহণ হবে ·</span>
                    <kbd className="rounded bg-white px-1.5 py-0.5 text-[10px] font-bold shadow-xs">Esc</kbd>
                    <span>চাপলে বাতিল</span>
                  </div>
                ) : null}

                {/* Toolbar & Send Controls */}
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
                  <div className="flex flex-wrap items-center gap-1">
                    {composerMode === "reply" ? (
                      <>
                        <button type="button" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition" title="Quick Reply ( / চাপলেও আসে )" onClick={() => setShowQuick((s) => !s)}>
                          ⚡
                        </button>
                        <button type="button" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition" title="ইমোজি" onClick={() => setShowEmoji((s) => !s)}>
                          😀
                        </button>
                        {active.channel === "whatsapp" ? (
                          <>
                            <button type="button" className="rounded-lg px-2 py-1 text-xs font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition" title="বোল্ড (*লেখা*)" onClick={() => applyFormat("bold")}>
                              B
                            </button>
                            <button type="button" className="rounded-lg px-2 py-1 text-xs italic font-serif text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition" title="ইটালিক (_লেখা_)" onClick={() => applyFormat("italic")}>
                              I
                            </button>
                            <button type="button" className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition" title="বুলেট তালিকা" onClick={() => applyFormat("list")}>
                              • তালিকা
                            </button>
                          </>
                        ) : null}
                        <button type="button" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition" title="পণ্য ক্যাটালগ" onClick={() => setShowPicker((s) => !s)}>
                          🛍️
                        </button>
                        <button type="button" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition" title="ছবির URL" onClick={() => setShowImage((s) => !s)}>
                          🖼️
                        </button>
                        <button type="button" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition" title="ফাইল/ছবি আপলোড (সর্বোচ্চ 2MB)" disabled={busy !== ""} onClick={() => fileInputRef.current?.click()}>
                          📎
                        </button>
                        <VoiceRecorder disabled={busy !== ""} onSend={(f) => void sendMediaFiles([f])} onError={(msg) => setError(msg)} />
                        <button type="button" className="rounded-lg bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-100 transition disabled:opacity-50" disabled={busy !== ""} onClick={suggestDraft}>
                          {busy === "draft" ? "..." : "✨ AI Draft"}
                        </button>
                        <span className="relative inline-flex">
                          <button type="button" className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition disabled:opacity-50" disabled={!reply.trim() || busy !== ""} onClick={() => setShowToneMenu((s) => !s)}>
                            ✨ টোন
                          </button>
                          {showToneMenu ? (
                            <span className="absolute bottom-full left-0 z-30 mb-2 flex w-40 flex-col gap-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
                              <button type="button" className="rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold hover:bg-slate-100 transition" disabled={busy !== ""} onClick={() => void applyTone("polite")}>মার্জিত</button>
                              <button type="button" className="rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold hover:bg-slate-100 transition" disabled={busy !== ""} onClick={() => void applyTone("professional")}>পেশাদার</button>
                              <button type="button" className="rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold hover:bg-slate-100 transition" disabled={busy !== ""} onClick={() => void applyTone("sales")}>সেলস-বান্ধব</button>
                            </span>
                          ) : null}
                        </span>
                        {prevReply !== null ? (
                          <button type="button" className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition" onClick={() => { const prev = prevReply; setPrevReply(null); setReply(prev); setGhost(""); ghostForRef.current = ""; }}>
                            ↩ আগের লেখায়
                          </button>
                        ) : null}
                      </>
                    ) : null}
                    <input ref={fileInputRef} type="file" className="hidden" multiple accept="image/*,audio/*,video/mp4,video/webm,application/pdf"
                      onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; if (files.length) void sendMediaFiles(files); }} />
                  </div>

                  <div className="flex items-center gap-2">
                    {busy === "send" || busy === "note" || busy === "media" ? (
                      <span className="text-xs text-slate-400 font-medium animate-pulse">প্রসেসিং…</span>
                    ) : null}
                    <button
                      type="button"
                      className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white shadow-xs transition-all active:scale-95 disabled:opacity-50 ${
                        composerMode === "note"
                          ? "bg-amber-600 hover:bg-amber-700 shadow-amber-500/25"
                          : "bg-gradient-to-r from-brand-600 to-indigo-600 hover:brightness-110 shadow-indigo-500/25"
                      }`}
                      disabled={busy !== "" || !reply.trim()}
                      onClick={() => { if (composerMode === "note") { void addNote(); } else { void sendReply(); } }}
                    >
                      <span>{composerMode === "note" ? "🔒 নোট সংরক্ষণ" : "পাঠান"}</span>
                      <kbd className="hidden sm:inline rounded bg-black/20 px-1 py-0.5 text-[9px] font-normal">↵</kbd>
                    </button>
                  </div>
                </div>
              </div>
              {showPicker && composerMode === "reply" ? (
                <div className="max-h-44 shrink-0 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
                  {products.length === 0 ? <p className="px-1 py-2 text-xs text-slate-400">কোনো পণ্য নেই</p> : products.map((prod) => (
                    <div key={prod.id} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-indigo-50">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{prod.name}</span>
                        <span className="text-slate-500">{money(prod.priceMinor, prod.currency)}{prod.stockQuantity != null ? ` · স্টক ${prod.stockQuantity}` : ""}</span>
                      </span>
                      <span className="flex shrink-0 gap-1">
                        <button className="rounded-md bg-slate-100 px-2 py-1 font-semibold hover:bg-slate-200" title="পণ্যের তথ্য কম্পোজারে টেক্সট হিসেবে বসান" onClick={() => insertProductSnippet(prod)}>টেক্সট বসান</button>
                        <button className="rounded-md bg-indigo-600 px-2 py-1 font-semibold text-white disabled:opacity-50 hover:bg-indigo-500" disabled={busy === "product-card"} title="ছবিসহ প্রোডাক্ট কার্ড সরাসরি পাঠান (কম্পোজারের লেখা ক্যাপশন হিসেবে যাবে)" onClick={() => sendProductCard(prod)}>🃏 কার্ড পাঠান</button>
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              {showImage && composerMode === "reply" ? (
                <div className="flex shrink-0 flex-wrap gap-2 rounded-xl bg-slate-50 p-3">
                  <input className="input flex-1" placeholder="ছবির পাবলিক https URL" value={imageForm.url} onChange={(e) => setImageForm({ ...imageForm, url: e.target.value })} />
                  <input className="input flex-1" placeholder="ক্যাপশন (ঐচ্ছিক)" value={imageForm.caption} onChange={(e) => setImageForm({ ...imageForm, caption: e.target.value })} />
                  <button className="btn-primary btn-sm" disabled={busy !== ""} onClick={sendImage}>{busy === "image" ? "পাঠাচ্ছি..." : "ছবি পাঠান"}</button>
                </div>
              ) : null}
            </div>
          ) : <p className="card flex-1 p-5 text-sm text-slate-500">বাম দিক থেকে একটি কথোপকথন বেছে নিন।</p>}
        </div>

        {/* ---- Customer context + controls + notes ----
            Inbox Next-Gen P1: third grid column on xl+ (own scroll);
            below xl it becomes a right-side drawer opened from the
            thread header (the panel used to drop under the thread
            and force a page scroll). */}
        {active ? (
          <div
            className={`${ctxOpen ? "fixed inset-0 z-50 flex justify-end bg-slate-900/40" : "hidden"} xl:static xl:z-auto xl:block xl:min-h-0 xl:overflow-y-auto xl:bg-transparent xl:pr-0.5`}
            onClick={(e) => { if (e.target === e.currentTarget) setCtxOpen(false); }}
          >
            <div className="h-full w-[340px] max-w-[94vw] space-y-4 overflow-y-auto bg-[#f6f7fb] p-3 shadow-2xl xl:h-auto xl:w-auto xl:max-w-none xl:overflow-visible xl:bg-transparent xl:p-0 xl:shadow-none">
              <div className="flex items-center justify-between xl:hidden">
                <span className="text-sm font-bold">গ্রাহক ও নিয়ন্ত্রণ</span>
                <button className="rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold shadow-sm" onClick={() => setCtxOpen(false)}>✕ বন্ধ করুন</button>
              </div>
            <div className="card space-y-4 p-4 shadow-sm border border-slate-200/80">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">👤 কাস্টমার প্রোফাইল</span>
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
                        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">মোট অর্ডার</div>
                        <div className="mt-1 text-lg font-black text-slate-900">{context.lifetime.orderCount}টি</div>
                      </div>
                      <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3 text-center">
                        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">Lifetime স্পেন্ড</div>
                        <div className="mt-1 text-lg font-black text-emerald-600">{money(context.lifetime.totalSpentMinor, context.lifetime.currency)}</div>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-xl bg-slate-50 p-3 text-center text-xs text-slate-500">
                  কোনো Customer রেকর্ডের সাথে যুক্ত নয়{context?.lead ? "" : " (নতুন কন্ট্যাক্ট হলে Lead তৈরি হয়েছে)"}।
                </div>
              )}

              {context?.lead && !context?.customer ? (
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="badge-brand">Lead: {context.lead.stage}</span>
                  <span className="badge-slate">{context.lead.source}</span>
                  {context.lead.valueMinor ? <span className="badge-green">{money(context.lead.valueMinor)}</span> : null}
                  {(context.lead.tags ?? []).map((t) => <span key={t} className="badge-amber">{t}</span>)}
                </div>
              ) : null}
              {context?.orders?.length ? (
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">সাম্প্রতিক অর্ডার</div>
                  <div className="space-y-1.5">
                    {context.orders.map((o) => (
                      <div key={o.id} className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">#{o.externalNumber ?? o.id.slice(0, 6)} · {o.status}{o.isCod ? " · COD" : ""}</span>
                          <span className="font-semibold">{money(o.totalMinor, o.currency)}</span>
                        </div>
                        {o.shipment ? <ShipmentWidget shipment={o.shipment} currency={o.currency} syncing={busy === `sync:${o.shipment.id}`} onSync={() => syncShipment(o.shipment!.id)} /> : null}
                        {o.isCod ? (
                          <div className="mt-1 flex items-center gap-2">
                            {o.codConfirmationStatus === "awaiting" ? <span className="badge-amber">কনফার্ম অপেক্ষমাণ</span>
                              : o.codConfirmationStatus === "confirmed" ? <span className="badge-green">✓ COD কনফার্মড</span>
                              : o.codConfirmationStatus === "declined" ? <span className="badge-red">✗ গ্রাহক বাতিল করেছে</span>
                              : ["pending", "on-hold", "processing"].includes(o.status) ? (
                                <button className="btn-warning btn-sm !px-2 !py-0.5 !text-[11px]" disabled={busy !== ""} onClick={() => requestCod(o.id)}>{busy === "cod" ? "পাঠাচ্ছি..." : "COD কনফার্ম পাঠান"}</button>
                              ) : null}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {profile ? (
              <div className="card space-y-3 p-4">
                <div className="section-title">🎯 Command Profile</div>
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  <span className="badge-indigo">Stage: {profile.conversation.pipelineStage}</span>
                  {profile.rfm ? <span className="badge-green">RFM: {profile.rfm.segment} · {profile.rfm.frequency}টি অর্ডার · শেষ {profile.rfm.recencyDays} দিন আগে</span> : <span className="badge-slate">RFM: এখনো অর্ডার নেই</span>}
                  {profile.adOrigin?.ctwaSourceId ? <span className="badge-amber">📣 Click-to-WhatsApp Ad থেকে এসেছে</span> : null}
                  {profile.adOrigin?.leadSource ? <span className="badge-slate">Lead Source: {profile.adOrigin.leadSource}</span> : null}
                </div>
                {profile.conversations?.length > 1 ? (
                  <div>
                    <div className="mb-1 text-[11px] font-semibold uppercase text-slate-400">সব চ্যানেলে কথোপকথন</div>
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
                    <div className="mb-1 text-[11px] font-semibold uppercase text-slate-400">পেমেন্ট যাচাই (Screenshot)</div>
                    {profile.payments.verifications.map((v: any) => (
                      <div key={v.id} className="rounded-lg bg-slate-50 px-2 py-1 text-xs">
                        {v.provider ?? "?"} · <b>{v.verdict}</b>{v.trxId ? ` · TrxID ${v.trxId}` : ""}{v.amountMinor ? ` · ৳${(Number(v.amountMinor) / 100).toLocaleString("bn-BD")}` : ""}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="card space-y-3 p-4">
              <div className="section-title">দায়িত্ব ও Tag</div>
              {active.spamFlag ? (
                <div className="rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
                  <div className="text-xs font-semibold text-amber-800">🚫 Spam সন্দেহভাজন</div>
                  <p className="mt-0.5 text-xs text-amber-700">{active.spamReason ?? ""}</p>
                  <button className="btn-secondary btn-sm mt-2" disabled={busy !== ""} onClick={() => patchConversation({ spamFlag: false })}>Spam নয়, ঠিক আছে</button>
                </div>
              ) : null}
              {botSession?.status === "active" ? (
                <div className="rounded-xl bg-indigo-50 p-3 ring-1 ring-indigo-100">
                  <div className="text-xs font-semibold text-indigo-800">🤖 অর্ডার Bot চলছে — ধাপ: {botSession.state}</div>
                  <p className="mt-0.5 text-xs text-indigo-600">গ্রাহক নিজে "এজেন্ট" লিখলে বা আপনি উত্তর দিলেই বট থেমে যাবে।</p>
                  <button className="btn-secondary btn-sm mt-2" disabled={busy !== ""} onClick={async () => {
                    const orgId = getOrganizationId(); if (!orgId || !active) return;
                    try { await apiFetch(`/organizations/${orgId}/inbox/conversations/${active.id}/bot/stop`, { method: "POST" }); setNotice("বট থামানো হয়েছে।"); await refreshActive(); }
                    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
                  }}>বট থামান</button>
                </div>
              ) : null}
              {active.csatRating ? (
                <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-100">⭐ CSAT রেটিং: {active.csatRating}/5</div>
              ) : null}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">সারসংক্ষেপ</span>
                  <button className="text-xs font-semibold text-indigo-600 hover:underline" disabled={busy !== ""} onClick={summarize}>{busy === "summary" ? "তৈরি হচ্ছে..." : "তৈরি করুন"}</button>
                </div>
                {active.summaryText ? (
                  <div className="whitespace-pre-line rounded-xl bg-slate-50 p-2.5 text-xs text-slate-600">{active.summaryText}
                    <div className="mt-1 text-[10px] text-slate-400">{active.summaryProvider} · {active.summaryAt ? new Date(active.summaryAt).toLocaleString() : ""}</div>
                  </div>
                ) : <p className="text-xs text-slate-400">এখনো সারসংক্ষেপ তৈরি হয়নি।</p>}
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">চ্যাট থেকে Order</span>
                  <button className="text-xs font-semibold text-indigo-600 hover:underline" onClick={() => setOrderOpen(!orderOpen)}>{orderOpen ? "বন্ধ করুন" : "＋ তৈরি করুন"}</button>
                </div>
                {orderOpen ? (
                  <div className="space-y-2 rounded-xl bg-slate-50 p-2.5">
                    {orderItems.map((it, idx) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        <select className="input flex-1 !py-1.5 !text-xs" value={it.productId} onChange={(e) => setOrderItems(orderItems.map((x, j) => j === idx ? { ...x, productId: e.target.value } : x))}>
                          {products.map((prod) => <option key={prod.id} value={prod.id}>{prod.name} — {money(prod.priceMinor, prod.currency)}</option>)}
                        </select>
                        <input className="input !w-14 !py-1.5 !text-xs" type="number" min={1} max={99} value={it.quantity} onChange={(e) => setOrderItems(orderItems.map((x, j) => j === idx ? { ...x, quantity: Number(e.target.value) || 1 } : x))} />
                        <button className="text-slate-400 hover:text-red-500" onClick={() => setOrderItems(orderItems.filter((_, j) => j !== idx))}>✕</button>
                      </div>
                    ))}
                    <button className="text-xs font-semibold text-indigo-600 hover:underline" onClick={() => setOrderItems([...orderItems, { productId: products[0]?.id ?? "", quantity: 1 }])}>＋ পণ্য যোগ করুন</button>
                    <label className="block text-xs">ডেলিভারির ঠিকানা<input className="input mt-0.5 !py-1.5 !text-xs" placeholder="বাসা, রোড, এলাকা, জেলা" value={orderAddress} onChange={(e) => setOrderAddress(e.target.value)} /></label>
                    <div className="flex items-end gap-2">
                      <label className="flex-1 text-xs">ডেলিভারি (৳)<input className="input mt-0.5 !py-1.5 !text-xs" type="number" min={0} value={orderShip} onChange={(e) => setOrderShip(e.target.value)} /></label>
                      <label className="flex items-center gap-1.5 pb-2 text-xs"><input type="checkbox" checked={orderCod} onChange={(e) => setOrderCod(e.target.checked)} /> COD</label>
                    </div>
                    <button className="btn-primary w-full !py-2 !text-xs" disabled={busy !== "" || orderItems.length === 0} onClick={createChatOrder}>{busy === "order" ? "তৈরি হচ্ছে..." : "Order তৈরি করুন"}</button>
                    <p className="text-[10px] text-slate-400">দাম ক্যাটালগ থেকেই হিসাব হয়। WooCommerce যুক্ত থাকলে অর্ডারটি স্টোরেও পাঠানোর চেষ্টা করা হয়, ফলাফল জানিয়ে দেওয়া হয়।</p>
                  </div>
                ) : null}
              </div>
              <label className="block text-sm">Assignee
                <select className="input mt-1" value={active.assignedUserId ?? ""} onChange={(e) => patchConversation({ assignedUserId: e.target.value || null })}>
                  <option value="">কেউ নয়</option>
                  {members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.name ?? m.user.email} ({m.role})</option>)}
                </select>
              </label>
              <div>
                <div className="mb-1 flex flex-wrap gap-1">
                  {(active.tags ?? []).map((t) => (
                    <span key={t} className="badge-brand">{t}<button className="ml-1 font-bold" onClick={() => patchConversation({ tags: (active.tags ?? []).filter((x) => x !== t) })}>×</button></span>
                  ))}
                  {(active.tags ?? []).length === 0 ? <span className="text-xs text-slate-400">কোনো Tag নেই</span> : null}
                </div>
                <div className="flex gap-1.5">
                  <input className="input flex-1" placeholder="নতুন Tag লিখে Enter" value={tagInput}
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
              { id: "settings", label: "🤖 অটোপাইলট ও SLA", icon: "⚙️" },
              { id: "teams", label: "👥 টিম ও এজেন্ট", icon: "👥" },
              { id: "report", label: "📊 টিম রিপোর্ট", icon: "📊" },
              { id: "performance", label: "🙋 আমার পারফরম্যান্স", icon: "🎯" },
              { id: "channels", label: "🔌 চ্যানেল সংযোগ", icon: "🔌" },
              { id: "quick", label: "⚡ কুইক রিপ্লাই ও টেমপ্লেট", icon: "⚡" },
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
          <div className="section-title">🤖 Auto-Reply ও Inbox সেটিংস</div>
          <p className="text-xs text-slate-500">অটো-রিপ্লাই শুধুমাত্র যাচাই করা ডেটা (আসল দাম/স্টক, নিজের Policy, আসল Order Status) দিয়ে উত্তর দেয়। ডেটা না মিললে কিছুই পাঠায় না। Complaint ও অজানা প্রশ্নে কখনো অটো-রিপ্লাই হয় না।</p>
          {settings ? (
            <div className="space-y-2.5 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <label className="block">মোড
                  <select className="input mt-1" value={settings.autoReplyMode} onChange={(e) => saveSettings({ autoReplyMode: e.target.value })}>
                    <option value="off">বন্ধ</option><option value="draft">শুধু Draft সাজেস্ট</option><option value="auto">অটো পাঠান</option>
                  </select>
                </label>
                <label className="block">আস্থার থ্রেশহোল্ড (%)
                  <input className="input mt-1" type="number" min={0} max={100} value={settings.confidenceThreshold} onChange={(e) => setSettings({ ...settings, confidenceThreshold: Number(e.target.value) })} onBlur={() => saveSettings({ confidenceThreshold: settings.confidenceThreshold })} />
                </label>
                <label className="block">Smart Assignment
                  <select className="input mt-1" value={settings.smartAssign} onChange={(e) => saveSettings({ smartAssign: e.target.value })}>
                    <option value="off">বন্ধ</option><option value="round_robin">Round-robin</option><option value="least_busy">কম ব্যস্তজনকে</option>
                  </select>
                </label>
                <label className="block">অর্ডার Bot
                  <select className="input mt-1" value={settings.botEnabled ? "on" : "off"} onChange={(e) => saveSettings({ botEnabled: e.target.value === "on" })}>
                    <option value="off">বন্ধ</option><option value="on">চালু (Order নেবে)</option>
                  </select>
                </label>
                <label className="block">Bot ডেলিভারি চার্জ (৳, ফাঁকা = টিম জানাবে)
                  <input className="input mt-1" type="number" min={0} value={settings.botDeliveryChargeMinor != null ? Math.round(settings.botDeliveryChargeMinor / 100) : ""} onChange={(e) => setSettings({ ...settings, botDeliveryChargeMinor: e.target.value === "" ? null : Number(e.target.value) * 100 })} onBlur={() => saveSettings({ botDeliveryChargeMinor: settings.botDeliveryChargeMinor ?? null })} />
                </label>
                <label className="block">SLA প্রথম উত্তর (মিনিট)
                  <input className="input mt-1" type="number" min={1} value={settings.slaFirstResponseMinutes} onChange={(e) => setSettings({ ...settings, slaFirstResponseMinutes: Number(e.target.value) })} onBlur={() => saveSettings({ slaFirstResponseMinutes: settings.slaFirstResponseMinutes })} />
                </label>
                <label className="block">Away এজেন্ট থেকে পুনঃঅ্যাসাইন (মিনিট)
                  <input className="input mt-1" type="number" min={5} placeholder="30" value={settings.reassignAfterMinutes ?? ""} onChange={(e) => setSettings({ ...settings, reassignAfterMinutes: e.target.value === "" ? null : Number(e.target.value) })} onBlur={() => saveSettings({ reassignAfterMinutes: settings.reassignAfterMinutes ?? null })} />
                </label>
                <label className="block">Retention — বন্ধ কথোপকথন মোছা (দিন, ফাঁকা = কখনো নয়)
                  <input className="input mt-1" type="number" min={7} max={3650} placeholder="বন্ধ" value={settings.retentionDays ?? ""} onChange={(e) => setSettings({ ...settings, retentionDays: e.target.value === "" ? null : Number(e.target.value) })} onBlur={() => saveSettings({ retentionDays: settings.retentionDays ?? null })} />
                  <span className="text-[11px] text-slate-400">Automation এ "Inbox Retention" Job চালালে মেয়াদ শেষ বন্ধ Thread মুছে যাবে (খোলা Thread কখনো নয়)।</span>
                </label>
                <label className="block">Escalation টিম (অভিযোগ/জরুরি)
                  <select className="input mt-1" value={settings.escalationTeamId ?? ""} onChange={(e) => saveSettings({ escalationTeamId: e.target.value || null })}>
                    <option value="">কোনোটিই নয়</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Channel অনুযায়ী Autopilot মোড (ফাঁকা = গ্লোবাল)</div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {(["whatsapp", "messenger", "instagram", "webchat"] as const).map((ch) => (
                    <label key={ch} className="block text-xs"><ChannelChip channel={ch} />
                      <select className="input mt-0.5" value={settings.perChannelModes?.[ch] ?? ""} onChange={(e) => {
                        const perChannelModes = { ...(settings.perChannelModes ?? {}) };
                        if (e.target.value) perChannelModes[ch] = e.target.value; else delete perChannelModes[ch];
                        saveSettings({ perChannelModes });
                      }}>
                        <option value="">গ্লোবাল</option><option value="off">বন্ধ</option><option value="draft">Draft</option><option value="auto">অটো</option>
                      </select>
                    </label>
                  ))}
                </div>
                <label className="mt-2 block text-xs">উচ্চ-মূল্যের অর্ডারে Escalation (৳, ফাঁকা = বন্ধ) — এর বেশি মূল্যের খোলা অর্ডার থাকলে Autopilot থেমে মানুষের কাছে যাবে
                  <input className="input mt-0.5" type="number" min={0} value={settings.escalationThresholdMinor != null ? Math.round(settings.escalationThresholdMinor / 100) : ""} onChange={(e) => setSettings({ ...settings, escalationThresholdMinor: e.target.value === "" ? null : Number(e.target.value) * 100 })} onBlur={() => saveSettings({ escalationThresholdMinor: settings.escalationThresholdMinor ?? null })} />
                </label>
                <p className="mt-1 text-[11px] text-slate-400">Escalation হয়: অভিযোগ/নেতিবাচক ভাব, "এজেন্ট চাই" জাতীয় অনুরোধ, পরপর ২টি বোঝা-যায়নি বার্তা, উচ্চ-মূল্যের অর্ডার। থামলে Thread এ ব্যানার আসবে; মানুষের উত্তর দিলেই আবার চালু হয়। LLM Tier শুধু যাচাই করা তথ্যই বলতে পারে — সংখ্যা মিল না খেলে পাঠানো হয় না।</p>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Intent অনুযায়ী মোড (ফাঁকা = গ্লোবাল)</div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {(["price", "stock", "delivery", "order_status", "payment"] as const).map((intent) => (
                    <label key={intent} className="block text-xs">{intent}
                      <select className="input mt-0.5" value={settings.perIntent?.[intent] ?? ""} onChange={(e) => {
                        const perIntent = { ...(settings.perIntent ?? {}) };
                        if (e.target.value) perIntent[intent] = e.target.value; else delete perIntent[intent];
                        saveSettings({ perIntent });
                      }}>
                        <option value="">গ্লোবাল</option><option value="off">বন্ধ</option><option value="draft">Draft</option><option value="auto">অটো</option>
                      </select>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ) : <p className="text-xs text-slate-400">সেটিংস লোড হচ্ছে...</p>}
        </div>

        <div className={`card space-y-4 p-5 ${manageTab === "performance" ? "block xl:col-span-2" : "hidden"}`}>
          <div className="section-title">🙋 আমার পারফরম্যান্স ও স্বাক্ষর</div>
          {myPerf?.me ? (
            <div className="space-y-4">
              {/* Performance KPI Cards */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-3 text-center">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">সূচক স্কোর</div>
                  <div className="mt-1 text-2xl font-black text-indigo-700">{myPerf.me.indicator}<span className="text-xs font-normal text-indigo-400">/১০০</span></div>
                  {myPerf.rank ? <div className="mt-0.5 text-[10px] font-semibold text-indigo-600">র‍্যাংক #{myPerf.rank}/{myPerf.totalAgents}</div> : null}
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3 text-center">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">দায়িত্বপ্রাপ্ত</div>
                  <div className="mt-1 text-xl font-black text-slate-800">{myPerf.me.current.assigned}</div>
                  <div className="text-[10px] text-slate-400">মোট হ্যান্ডেল করা</div>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3 text-center">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">বন্ধ / সমাধান</div>
                  <div className="mt-1 text-xl font-black text-emerald-600">{myPerf.me.current.closed}</div>
                  <div className="text-[10px] text-slate-400">সফল রেজোলিউশন</div>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3 text-center">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">মোট রিপ্লাই</div>
                  <div className="mt-1 text-xl font-black text-slate-800">{myPerf.me.current.replies}</div>
                  <div className="text-[10px] text-slate-400">প্রেরিত বার্তা</div>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3 text-center">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">গড় প্রথম উত্তর</div>
                  <div className="mt-1 text-xl font-black text-slate-800">{myPerf.me.current.avgFirstResponseMinutes != null ? `${myPerf.me.current.avgFirstResponseMinutes}m` : "—"}</div>
                  <div className="text-[10px] text-slate-400">SLA স্পিড</div>
                </div>
                <div className="rounded-2xl border border-amber-100 bg-amber-50/50 p-3 text-center">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-amber-500">CSAT রেটিং</div>
                  <div className="mt-1 text-xl font-black text-amber-700">{myPerf.me.current.csatAvg != null ? `⭐ ${myPerf.me.current.csatAvg}` : "—"}</div>
                  <div className="text-[10px] text-amber-600/80">গ্রাহক সন্তুষ্টি</div>
                </div>
              </div>

              {myPerf.today ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50/80 px-3.5 py-2.5 text-xs ring-1 ring-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-700">আজকের স্থিতি:</span>
                    <span className="rounded-full bg-white px-2.5 py-0.5 font-bold shadow-2xs ring-1 ring-slate-200">
                      {myPerf.today.state === "active" ? "🟢 সক্রিয়" : myPerf.today.state === "idle" ? "🟡 অলস" : myPerf.today.state === "away" ? "⚪ দূরে" : "⚫ অফলাইন"}
                    </span>
                    <span className="text-slate-400">|</span>
                    <span className="text-slate-600">আজকের জবাব: <strong className="text-slate-800">{myPerf.today.repliesToday}টি</strong></span>
                    <span className="text-slate-400">|</span>
                    <span className="text-slate-600">আজ বন্ধ: <strong className="text-slate-800">{myPerf.today.closedToday}টি</strong></span>
                  </div>
                  <span className="rounded-md bg-amber-100 px-2 py-0.5 font-bold text-amber-800">
                    এখন খোলা: {myPerf.today.openNow}টি
                  </span>
                </div>
              ) : null}
            </div>
          ) : <p className="text-xs text-slate-400">আপনার Role টি এজেন্ট হিসেবে গণনা হয় না, তাই নিজের স্কোরকার্ড নেই — পুরো হিসাব Team Performance পেজে।</p>}

          <div className="border-t border-slate-100 pt-3">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <input type="checkbox" checked={mySig.enabled} onChange={(e) => setMySig({ ...mySig, enabled: e.target.checked })} />
              <span>আমার পাঠানো বার্তায় স্বাক্ষর যোগ করুন</span>
            </label>
            <textarea className="input mt-2" rows={2} maxLength={300} placeholder={"যেমন:\n— রাফি, সাপোর্ট টিম, Qosprey"} value={mySig.signature} onChange={(e) => setMySig({ ...mySig, signature: e.target.value })} />
            <div className="mt-2.5 flex items-center justify-between gap-2">
              <button className="btn-secondary btn-sm" onClick={async () => {
                const orgId = getOrganizationId(); if (!orgId) return;
                try {
                  const saved = await apiFetch<any>(`/organizations/${orgId}/inbox/my-signature`, { method: "PUT", body: JSON.stringify(mySig) });
                  setMySig({ signature: saved.signature ?? "", enabled: Boolean(saved.enabled) });
                  setNotice("আপনার স্বাক্ষর সংরক্ষণ হয়েছে — এখন থেকে আপনার নিজের পাঠানো বার্তায় এটি যোগ হবে।");
                } catch (e) { setError(e instanceof Error ? e.message : "স্বাক্ষর সংরক্ষণ ব্যর্থ"); }
              }}>স্বাক্ষর সংরক্ষণ</button>
              <span className="text-[11px] text-slate-400">শুধু নিজের হাতে পাঠানো বার্তায় যোগ হয় — স্বয়ংক্রিয়/সিস্টেম বার্তায় নয়।</span>
            </div>
          </div>
        </div>

        <div className={`card space-y-4 p-5 ${manageTab === "report" ? "block xl:col-span-2" : "hidden"}`}>
          <div className="section-title">📊 টিম রিপোর্ট (শেষ ৭ দিন)</div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500 font-medium">পরিসর:</span>
              <select className="input w-52 py-1 text-xs" defaultValue="" onChange={async (e) => {
                const orgId = getOrganizationId(); if (!orgId) return;
                const tid = e.target.value;
                try {
                  setReport(await apiFetch<any>(`/organizations/${orgId}/inbox/team-report?days=7${tid ? `&teamId=${tid}` : ""}`));
                } catch (err) { setError(err instanceof Error ? err.message : "রিপোর্ট লোড ব্যর্থ"); }
              }}>
                <option value="">সব টিম (পুরো Organization)</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name} টিম</option>)}
              </select>
              {report?.scopedTeamName ? <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-bold text-indigo-700 ring-1 ring-indigo-200">শুধু "{report.scopedTeamName}" টিম</span> : null}
            </div>
          </div>

          {report ? (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5 text-center">
                  <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">নতুন কথোপকথন</div>
                  <div className="mt-1 text-2xl font-black text-slate-900">{report.opened}</div>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5 text-center">
                  <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">বন্ধ হয়েছে</div>
                  <div className="mt-1 text-2xl font-black text-emerald-600">{report.closed}</div>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5 text-center">
                  <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">গড় প্রথম উত্তর</div>
                  <div className="mt-1 text-2xl font-black text-slate-900">{report.avgFirstResponseMinutes != null ? `${report.avgFirstResponseMinutes}m` : "—"}</div>
                </div>
                <div className={`rounded-2xl border p-3.5 text-center ${report.currentBreaches > 0 ? "border-red-200 bg-red-50/80" : "border-slate-100 bg-slate-50/70"}`}>
                  <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">SLA ভঙ্গ (এখন)</div>
                  <div className={`mt-1 text-2xl font-black ${report.currentBreaches > 0 ? "text-red-600" : "text-slate-900"}`}>{report.currentBreaches}</div>
                </div>
              </div>

              {/* Chat-linked Revenue Card */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-3.5 text-xs text-emerald-800">
                <div className="flex items-center gap-2">
                  <span className="text-base">🛒</span>
                  <span>চ্যাট থেকে অর্জিত মোট অর্ডার: <strong className="font-bold text-slate-900">{report.chatLinkedOrders}টি</strong></span>
                </div>
                <div className="text-sm font-black text-emerald-700">
                  মোট আয়: {money(report.chatLinkedRevenueMinor, report.chatLinkedCurrency)}
                </div>
              </div>

              {report.autopilot ? (
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 text-xs text-indigo-900">
                  <div className="font-bold mb-1 flex items-center gap-1.5">
                    <span>🤖</span> <span>Autopilot কার্যকারিতা</span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-slate-600">
                    <span>অটো প্রেরিত: <strong className="text-slate-800">{report.autopilot.autoSent}টি</strong> (LLM {report.autopilot.llmSent}টি)</span>
                    <span>সাজেস্টেড ড্রাফট: <strong className="text-slate-800">{report.autopilot.draftsSuggested}টি</strong></span>
                    <span>হাতে স্থানান্তর (Escalated): <strong className="text-amber-700">{report.autopilot.escalatedNow}টি</strong></span>
                  </div>
                </div>
              ) : null}

              {(report.perAgent ?? []).length ? (
                <div className="space-y-1.5 pt-1">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">👤 এজেন্টদের একক পারফরম্যান্স</div>
                  <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200/80 bg-white">
                    {report.perAgent.map((a: any) => (
                      <div key={a.userId} className="flex flex-wrap items-center justify-between gap-2 p-2.5 text-xs hover:bg-slate-50 transition">
                        <span className="font-bold text-slate-800">{memberName(a.userId)}</span>
                        <div className="flex flex-wrap items-center gap-2 text-slate-600">
                          <span className="rounded bg-slate-100 px-2 py-0.5">দায়িত্ব {a.assigned}</span>
                          <span className="rounded bg-emerald-50 text-emerald-700 font-semibold px-2 py-0.5">বন্ধ {a.closed}</span>
                          <span>গড় উত্তর: {a.avgFirstResponseMinutes != null ? `${a.avgFirstResponseMinutes}m` : "—"}</span>
                          {a.csatAvg != null ? <span className="rounded bg-amber-50 text-amber-700 font-bold px-2 py-0.5">⭐ {a.csatAvg}</span> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {(report.perTeam ?? []).length ? (
                <div className="space-y-1.5 pt-2">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">👥 টিম অনুযায়ী হিসাব</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {report.perTeam.map((t: any) => (
                      <div key={t.teamId} className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-3 text-xs">
                        <div className="flex items-center justify-between font-bold text-slate-800">
                          <span>{t.name} টিম</span>
                          <span className="text-[11px] font-normal text-slate-500">{t.memberCount} জন সদস্য</span>
                        </div>
                        {t.leadUserId ? <div className="text-[11px] text-slate-400 mt-0.5">লিড: {memberName(t.leadUserId)}</div> : null}
                        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                          <span className="rounded bg-white px-1.5 py-0.5 shadow-2xs">দায়িত্ব {t.assigned}</span>
                          <span className="rounded bg-white px-1.5 py-0.5 shadow-2xs">খোলা {t.openNow}</span>
                          <span className="rounded bg-white px-1.5 py-0.5 shadow-2xs text-emerald-700 font-bold">বন্ধ {t.closed}</span>
                          {t.csatAvg != null ? <span className="rounded bg-amber-100 text-amber-800 font-bold px-1.5 py-0.5">⭐ {t.csatAvg}</span> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {(report.dailyTrend ?? []).length ? (
                <div className="border-t border-slate-100 pt-3">
                  <div className="mb-2 text-xs font-bold text-slate-500 uppercase tracking-wider">📈 প্রতিদিনের ধারা (দৈনিক নতুন বনাম সমাধান)</div>
                  <div className="flex flex-wrap gap-2">
                    {report.dailyTrend.map((d: any) => (
                      <div key={d.date} className="rounded-xl border border-slate-100 bg-slate-50/70 p-2 text-center text-xs min-w-[90px]">
                        <div className="text-[10px] font-bold text-slate-400">{d.date.slice(5)}</div>
                        <div className="mt-1 flex items-center justify-center gap-1.5 text-[11px]">
                          <span className="font-semibold text-slate-800" title="নতুন">+{d.created}</span>
                          <span className="font-bold text-emerald-600" title="বন্ধ">✓{d.closed}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : <p className="text-xs text-slate-400">রিপোর্ট লোড হচ্ছে...</p>}
        </div>

        <div className={`card space-y-3 p-5 ${manageTab === "teams" ? "block xl:col-span-2" : "hidden"}`}>
          <div className="section-title">👥 টিম ও এজেন্ট</div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">আমার অবস্থা:</span>
            {([["online", "🟢 Online"], ["busy", "🟠 ব্যস্ত"], ["away", "⚪ Away"]] as const).map(([v, label]) => (
              <button key={v} className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${myStatus === v ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-600 ring-slate-200"}`}
                onClick={async () => {
                  setMyStatus(v);
                  const orgId = getOrganizationId(); if (!orgId) return;
                  await apiFetch(`/organizations/${orgId}/inbox/agent-state`, { method: "POST", body: JSON.stringify({ status: v }) }).catch(() => undefined);
                  loadTeams();
                }}>{label}</button>
            ))}
            <span className="text-xs text-slate-400">Away থাকলে নতুন অ্যাসাইনমেন্ট আসবে না; পুরনো খোলা কথোপকথন Sweep এ সরে যাবে।</span>
          </div>
          {agentStates.length ? (
            <div className="space-y-1">
              {agentStates.map((a) => (
                <div key={a.userId} className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                  <span className="font-medium">{a.status === "away" ? "⚪" : a.status === "busy" ? "🟠" : "🟢"} {a.name} <span className="text-slate-400">({a.role})</span>{a.hasSchedule && !a.onShift ? <span className="ml-1 rounded bg-slate-200 px-1 py-0.5 text-slate-600">অফ-শিফট</span> : null}</span>
                  <span>খোলা {a.openCount}/{a.capacity}{a.teams?.length ? ` · ${a.teams.join(", ")}` : ""}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-slate-400">এজেন্ট তালিকা লোড হচ্ছে...</p>}
          <div className="space-y-2 border-t pt-3">
            <div className="flex flex-wrap gap-2">
              <input className="input w-44" placeholder="নতুন টিমের নাম (যেমন: সেলস)" value={teamForm.name} onChange={(e) => setTeamForm({ ...teamForm, name: e.target.value })} />
              {(["whatsapp", "messenger", "instagram", "webchat"] as const).map((ch) => (
                <label key={ch} className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={teamForm.channels.includes(ch)} onChange={(e) => setTeamForm({ ...teamForm, channels: e.target.checked ? [...teamForm.channels, ch] : teamForm.channels.filter((x) => x !== ch) })} />
                  <ChannelChip channel={ch} />
                </label>
              ))}
              <button className="btn-primary btn-sm" disabled={!teamForm.name.trim() || busy !== ""} onClick={async () => {
                const orgId = getOrganizationId(); if (!orgId) return;
                setBusy("team");
                try { await apiFetch(`/organizations/${orgId}/inbox/teams`, { method: "POST", body: JSON.stringify(teamForm) }); setTeamForm({ name: "", channels: [] }); loadTeams(); setNotice("টিম তৈরি হয়েছে।"); }
                catch (e) { setError(e instanceof Error ? e.message : "টিম তৈরি ব্যর্থ"); }
                finally { setBusy(""); }
              }}>টিম তৈরি</button>
            </div>
            <p className="text-[11px] text-slate-400">চ্যানেল না বাছলে টিম সব চ্যানেল নেবে। Smart Assignment চালু থাকলে নতুন কথোপকথন টিমের সদস্যদের মধ্যে ভাগ হয় — Capacity পূর্ণ বা Away সদস্য বাদ পড়ে।</p>
            {teams.map((t) => (
              <div key={t.id} className="rounded-xl border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">{t.name} <span className="ml-1 font-normal text-xs text-slate-400">খোলা {t.openCount}টি</span></div>
                  <div className="flex flex-wrap gap-1">{(t.channels ?? []).length ? (t.channels as string[]).map((ch) => <ChannelChip key={ch} channel={ch} />) : <span className="text-[11px] text-slate-400">সব চ্যানেল</span>}</div>
                </div>
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {members.map((mb) => {
                    const draft = teamDraft[t.id] ?? {};
                    const on = mb.user.id in draft;
                    return (
                      <label key={mb.user.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5 text-xs">
                        <input type="checkbox" checked={on} onChange={(e) => {
                          const next = { ...(teamDraft[t.id] ?? {}) };
                          if (e.target.checked) next[mb.user.id] = next[mb.user.id] ?? 20; else delete next[mb.user.id];
                          setTeamDraft({ ...teamDraft, [t.id]: next });
                        }} />
                        <span className="flex-1 truncate">{mb.user.name ?? mb.user.email}</span>
                        <span className="text-slate-400">ধারণক্ষমতা</span>
                        <input type="number" min={1} max={200} className="w-16 rounded border px-1.5 py-0.5" disabled={!on} value={draft[mb.user.id] ?? 20}
                          onChange={(e) => setTeamDraft({ ...teamDraft, [t.id]: { ...(teamDraft[t.id] ?? {}), [mb.user.id]: Number(e.target.value) || 20 } })} />
                      </label>
                    );
                  })}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-slate-500">টিম লিড:</span>
                  {["OWNER", "ADMIN"].includes(agentStates.find((a) => a.userId === myId)?.role ?? "") ? (
                    <select className="input w-52" value={t.leadUserId ?? ""} onChange={async (e) => {
                      const orgId = getOrganizationId(); if (!orgId) return;
                      try {
                        await apiFetch(`/organizations/${orgId}/inbox/teams/${t.id}`, { method: "PATCH", body: JSON.stringify({ leadUserId: e.target.value || null }) });
                        loadTeams(); setNotice("টিম লিড হালনাগাদ হয়েছে।");
                      } catch (err) { setError(err instanceof Error ? err.message : "লিড সেট করা যায়নি"); }
                    }}>
                      <option value="">কেউ না</option>
                      {members.map((mb) => <option key={mb.user.id} value={mb.user.id}>{mb.user.name ?? mb.user.email}</option>)}
                    </select>
                  ) : (
                    <span className="font-medium">{t.leadName ?? "কেউ না"}</span>
                  )}
                  <span className="text-slate-400">লিড নিজের টিমের সদস্য সাজাতে ও শুধু নিজের টিমের রিপোর্ট/স্কোরকার্ড দেখতে পারেন</span>
                </div>
                <div className="mt-2 flex gap-2">
                  <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                    const orgId = getOrganizationId(); if (!orgId) return;
                    setBusy("team");
                    try {
                      await apiFetch(`/organizations/${orgId}/inbox/teams/${t.id}/members`, { method: "POST", body: JSON.stringify({ members: Object.entries(teamDraft[t.id] ?? {}).map(([userId, capacity]) => ({ userId, capacity })) }) });
                      loadTeams(); setNotice("টিমের সদস্য সংরক্ষণ হয়েছে।");
                    } catch (e) { setError(e instanceof Error ? e.message : "সংরক্ষণ ব্যর্থ"); }
                    finally { setBusy(""); }
                  }}>সদস্য সংরক্ষণ</button>
                  <button className="text-xs text-red-500" onClick={async () => {
                    const orgId = getOrganizationId(); if (!orgId || !window.confirm(`"${t.name}" টিম মুছে ফেলবেন?`)) return;
                    await apiFetch(`/organizations/${orgId}/inbox/teams/${t.id}`, { method: "DELETE" }).catch(() => undefined);
                    loadTeams();
                  }}>টিম মুছুন</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={`${viewMode === "manage" && manageTab === "channels" ? "block" : "hidden"} space-y-4`}>
        <div className="card space-y-4 p-5">
          <div className="section-title">🔌 আরও চ্যানেল (Telegram · Email · TikTok)</div>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-2 rounded-xl border p-3">
              <div className="flex items-center gap-2 text-sm font-semibold"><ChannelChip channel="telegram" lg /> Bot Channel</div>
              <p className="text-xs text-slate-500">BotFather থেকে পাওয়া Bot Token দিন — যাচাই (getMe) সফল হলেই কানেক্ট হবে। Message এই Inbox এই আসবে, একই Assignment/Autopilot চলবে।</p>
              <input className="input" type="password" placeholder="Bot Token (123456:ABC...)" value={tgToken} onChange={(e) => setTgToken(e.target.value)} />
              <button className="btn-primary btn-sm" disabled={!tgToken || busy !== ""} onClick={async () => {
                const orgId = getOrganizationId(); if (!orgId) return;
                setBusy("tg"); setTgResult("");
                try {
                  const r = await apiFetch<any>(`/organizations/${orgId}/inbox/connect/telegram`, { method: "POST", body: JSON.stringify({ botToken: tgToken }) });
                  setTgResult(`কানেক্ট হয়েছে: ${r.bot} · Webhook: ${r.webhook?.registered ? "নিবন্ধিত ✅" : `হয়নি — ${r.webhook?.error ?? ""}`}`);
                  setTgToken("");
                } catch (e) { setTgResult(e instanceof Error ? e.message : "কানেক্ট ব্যর্থ"); }
                finally { setBusy(""); }
              }}>{busy === "tg" ? "যাচাই হচ্ছে..." : "যাচাই করে কানেক্ট"}</button>
              {tgResult ? <p className="text-xs text-slate-600">{tgResult}</p> : null}
            </div>
            <div className="space-y-2 rounded-xl border p-3">
              <div className="flex items-center gap-2 text-sm font-semibold"><ChannelChip channel="email" lg /> Mailbox Lane</div>
              <p className="text-xs text-slate-500">নিজের Mailbox এর IMAP + SMTP দিন — দুই দিকই যাচাই সফল হলেই কানেক্ট হবে। অপঠিত মেইল Sync হয়ে এই Inbox এ আসবে (Automation এ "email_sync" Job চালু করুন)।</p>
              <div className="grid grid-cols-2 gap-1.5">
                <input className="input !text-xs" placeholder="IMAP Host" value={emailForm.imapHost} onChange={(e) => setEmailForm({ ...emailForm, imapHost: e.target.value })} />
                <input className="input !text-xs" type="number" placeholder="IMAP Port" value={emailForm.imapPort} onChange={(e) => setEmailForm({ ...emailForm, imapPort: Number(e.target.value) || 993 })} />
                <input className="input !text-xs" placeholder="SMTP Host" value={emailForm.smtpHost} onChange={(e) => setEmailForm({ ...emailForm, smtpHost: e.target.value })} />
                <input className="input !text-xs" type="number" placeholder="SMTP Port" value={emailForm.smtpPort} onChange={(e) => setEmailForm({ ...emailForm, smtpPort: Number(e.target.value) || 587 })} />
              </div>
              <input className="input" placeholder="ইমেইল ঠিকানা" value={emailForm.user} onChange={(e) => setEmailForm({ ...emailForm, user: e.target.value })} />
              <input className="input" type="password" placeholder="Password / App Password" value={emailForm.password} onChange={(e) => setEmailForm({ ...emailForm, password: e.target.value })} />
              <div className="flex gap-2">
                <button className="btn-primary btn-sm" disabled={!emailForm.imapHost || !emailForm.user || busy !== ""} onClick={async () => {
                  const orgId = getOrganizationId(); if (!orgId) return;
                  setBusy("email"); setEmailResult("");
                  try {
                    const r = await apiFetch<any>(`/organizations/${orgId}/inbox/connect/email`, { method: "POST", body: JSON.stringify(emailForm) });
                    setEmailResult(`কানেক্ট হয়েছে: ${r.mailbox}`);
                  } catch (e) { setEmailResult(e instanceof Error ? e.message : "কানেক্ট ব্যর্থ"); }
                  finally { setBusy(""); }
                }}>{busy === "email" ? "যাচাই হচ্ছে..." : "যাচাই করে কানেক্ট"}</button>
                <button className="btn-secondary btn-sm" disabled={busy !== ""} onClick={async () => {
                  const orgId = getOrganizationId(); if (!orgId) return;
                  setBusy("emailsync");
                  try {
                    const r = await apiFetch<any>(`/organizations/${orgId}/inbox/email/sync`, { method: "POST" });
                    setEmailResult(`Sync: ${r.stored}টি নতুন, ${r.duplicates}টি আগের`);
                  } catch (e) { setEmailResult(e instanceof Error ? e.message : "Sync ব্যর্থ"); }
                  finally { setBusy(""); }
                }}>এখন Sync</button>
              </div>
              {emailResult ? <p className="text-xs text-slate-600">{emailResult}</p> : null}
            </div>
            <div className="space-y-2 rounded-xl border border-dashed p-3">
              <div className="flex items-center gap-2 text-sm font-semibold"><ChannelChip channel="tiktok" lg /> Business Messaging</div>
              <p className="text-xs text-amber-700">⏳ Partner অনুমোদন প্রয়োজন — TikTok এই API Self-serve দেয় না।</p>
              {tiktokPack ? (
                <ol className="list-decimal space-y-1 pl-4 text-xs text-slate-500">
                  {(tiktokPack.steps as string[]).map((step: string, i: number) => <li key={i}>{step}</li>)}
                </ol>
              ) : <p className="text-xs text-slate-400">তথ্য লোড হচ্ছে...</p>}
            </div>
          </div>
        </div>

        <form onSubmit={connect} className="card space-y-3 p-5">
          <div className="section-title">WhatsApp / Messenger কানেক্ট করুন</div>
          <p className="text-sm text-slate-500">
            Meta App থেকে Page/System-User Access Token, App Secret ও নিজের পছন্দের Verify Token লাগবে। Token যাচাই ব্যর্থ হলে কিছুই সেভ হয় না।
            কানেক্টের পর Meta App এর Webhook সেটিংসে Callback URL দিন: <code className="rounded bg-slate-100 px-1">https://আপনার-ডোমেইন/webhooks/meta/ইন্টিগ্রেশন-ID</code>, একই Verify Token ব্যবহার করুন এবং <span className="font-medium">messages</span> ফিল্ড সাবস্ক্রাইব করুন।
            বর্তমান কানেকশন: {integrations.length ? integrations.map((i) => `${i.provider} (${i.externalAccountId})`).join(", ") : "নেই"}
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <label className="block text-sm">চ্যানেল
              <select className={inputCls} value={connectForm.channel} onChange={(e) => setConnectForm({ ...connectForm, channel: e.target.value })}>
                <option value="whatsapp">WhatsApp</option><option value="messenger">Messenger</option><option value="instagram">Instagram</option>
              </select>
            </label>
            <label className="block text-sm">Access Token<input className={inputCls} type="password" value={connectForm.accessToken} onChange={(e) => setConnectForm({ ...connectForm, accessToken: e.target.value })} required /></label>
            <label className="block text-sm">App Secret (প্ল্যাটফর্ম অ্যাপ ব্যবহার করলে খালি রাখুন)<input className={inputCls} type="password" value={connectForm.appSecret} onChange={(e) => setConnectForm({ ...connectForm, appSecret: e.target.value })} placeholder="নিজের Meta অ্যাপ থাকলে দিন" /></label>
            <label className="block text-sm">Verify Token (নিজে ঠিক করুন)<input className={inputCls} value={connectForm.verifyToken} onChange={(e) => setConnectForm({ ...connectForm, verifyToken: e.target.value })} required /></label>
            <label className="block text-sm">Phone Number ID (WhatsApp)<input className={inputCls} value={connectForm.phoneNumberId} onChange={(e) => setConnectForm({ ...connectForm, phoneNumberId: e.target.value })} /></label>
            <label className="block text-sm">Page ID (Messenger/Instagram)<input className={inputCls} value={connectForm.pageId} onChange={(e) => setConnectForm({ ...connectForm, pageId: e.target.value })} /></label>
          </div>
          <button className="btn-primary disabled:opacity-50" disabled={busy !== ""}>{busy === "connect" ? "যাচাই হচ্ছে..." : "যাচাই করে কানেক্ট করুন"}</button>
        </form>
      </div>

      <div className={`${viewMode === "manage" && manageTab === "quick" ? "block" : "hidden"} grid gap-4 xl:grid-cols-2`}>
        <div className="card space-y-3 p-5">
          <div className="section-title">⚡ Quick Replies</div>
          <p className="text-xs text-slate-500">বারবার লিখতে হয় এমন উত্তরের লাইব্রেরি। {"{{firstName}}"}, {"{{contactName}}"}, {"{{phone}}"} ব্যবহার করা যায়, পাঠানোর আগে আসল তথ্য বসে যাবে। Reply বক্সে / চাপলেই তালিকা আসবে।</p>
          <div className="space-y-1.5">
            {quickReplies.map((q) => (
              <div key={q.id} className="flex items-start justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <div className="min-w-0"><span className="font-semibold">{q.title}</span><span className="block truncate text-xs text-slate-500">{q.content}</span></div>
                <button className="text-xs text-red-500" onClick={() => deleteQr(q.id)}>মুছুন</button>
              </div>
            ))}
            {quickReplies.length === 0 ? <p className="text-xs text-slate-400">এখনো কোনো Quick Reply নেই।</p> : null}
          </div>
          <form onSubmit={addQr} className="space-y-2">
            <input className="input" placeholder="শিরোনাম (যেমন: ডেলিভারি চার্জ)" value={qrForm.title} onChange={(e) => setQrForm({ ...qrForm, title: e.target.value })} required />
            <textarea className="input" rows={2} placeholder="উত্তরের লেখা..." value={qrForm.content} onChange={(e) => setQrForm({ ...qrForm, content: e.target.value })} required />
            <button className="btn-secondary btn-sm">যোগ করুন</button>
          </form>
        </div>

        <div className="card space-y-3 p-5">
          <div className="section-title">🧩 WhatsApp Template রেজিস্ট্রি</div>
          <p className="text-xs text-slate-500">Meta তে আগে থেকে অনুমোদিত Template গুলো এখানে রেজিস্ট্রি করুন (নাম ও ভাষা হুবহু Meta এর মতো হতে হবে)। ২৪ ঘণ্টার Window বন্ধ থাকলে Inbox থেকে এগুলোই পাঠানো যাবে। Template আসলে অনুমোদিত না হলে Meta এর এররটাই দেখানো হবে।</p>
          <div className="space-y-1.5">
            {templates.map((t) => (
              <div key={t.id} className="flex items-start justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <div className="min-w-0"><span className="font-semibold">{t.name}</span> <span className="badge-slate">{t.language}</span> {t.category ? <span className="badge-brand">{t.category}</span> : null}<span className="block truncate text-xs text-slate-500">{t.bodyText ?? ""}</span></div>
                <button className="text-xs text-red-500" onClick={() => deleteTpl(t.id)}>মুছুন</button>
              </div>
            ))}
            {templates.length === 0 ? <p className="text-xs text-slate-400">এখনো কোনো Template রেজিস্ট্রি করা নেই।</p> : null}
          </div>
          <form onSubmit={addTpl} className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder="Template নাম (Meta অনুযায়ী)" value={tplForm.name} onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })} required />
              <input className="input" placeholder="ভাষা কোড (bn / en_US)" value={tplForm.language} onChange={(e) => setTplForm({ ...tplForm, language: e.target.value })} required />
            </div>
            <select className="input" value={tplForm.category} onChange={(e) => setTplForm({ ...tplForm, category: e.target.value })}>
              <option value="UTILITY">UTILITY</option><option value="MARKETING">MARKETING</option><option value="AUTHENTICATION">AUTHENTICATION</option>
            </select>
            <textarea className="input" rows={2} placeholder={"Body প্রিভিউ (যেমন: আপনার অর্ডার {{1}} কনফার্ম হয়েছে)"} value={tplForm.bodyText} onChange={(e) => setTplForm({ ...tplForm, bodyText: e.target.value })} />
            <button className="btn-secondary btn-sm">যোগ করুন</button>
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
                <span>দ্রুত অ্যাকশন ও কমান্ড প্যালেট</span>
              </span>
              <kbd className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 shadow-2xs">ESC</kbd>
            </div>
            <div className="max-h-84 overflow-y-auto p-2 space-y-1">
              <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">অপঠিত কথোপকথন</div>
              {conversations.filter((c) => c.unreadCount > 0).slice(0, 5).map((c) => (
                <button key={c.id} className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-slate-50 transition" onClick={() => { setPaletteOpen(false); void openConversation(c); }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <ContactAvatar name={c.contactName ?? c.contactPhone} channel={c.channel} size="sm" />
                    <span className="truncate font-medium text-slate-800">{c.contactName ?? c.contactPhone ?? "গ্রাহক"}</span>
                  </div>
                  <span className="shrink-0 flex items-center gap-1.5">
                    <ChannelChip channel={c.channel} />
                    <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600 ring-1 ring-rose-200">{c.unreadCount} অপঠিত</span>
                  </span>
                </button>
              ))}
              <div className="my-1.5 border-t border-slate-100" />
              <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">কুইক ফিল্টার ও অ্যাকশন</div>
              <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 transition" onClick={() => { setPaletteOpen(false); onFilter({ unreadOnly: !filters.unreadOnly }); }}>
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-50 text-blue-600 text-xs font-bold">📬</span>
                <span>{filters.unreadOnly ? "সব কথোপকথন দেখুন" : "শুধু অপঠিত বার্তাগুলো ফিল্টার করুন"}</span>
              </button>
              {(["whatsapp", "messenger", "instagram", "webchat"] as const).map((ch) => (
                <button key={ch} className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 transition" onClick={() => { setPaletteOpen(false); onFilter({ channel: filters.channel === ch ? "" : ch }); }}>
                  <span className="flex items-center gap-2">
                    <ChannelChip channel={ch} />
                    <span className="font-medium capitalize">{ch} এর চ্যাট ফিল্টার</span>
                  </span>
                  <span className="text-xs text-slate-400 font-medium">{filters.channel === ch ? "সক্রিয় ✓" : "ফিল্টার"}</span>
                </button>
              ))}
              {active && myId ? (
                <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-indigo-700 hover:bg-indigo-50 transition" onClick={() => { setPaletteOpen(false); void patchConversation({ assignedUserId: myId }); }}>
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 text-xs font-bold">👤</span>
                  <span>বর্তমান কথোপকথন নিজেকে অ্যাসাইন করুন</span>
                  <kbd className="ml-auto rounded-md border border-indigo-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 shadow-2xs">E</kbd>
                </button>
              ) : null}
              <button className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 transition" onClick={() => { setPaletteOpen(false); setShowShortcuts(true); }}>
                <span className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-100 text-slate-600 text-xs font-bold">⌨️</span>
                  <span>কীবোর্ড শর্টকাট তালিকা</span>
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
                <span>কীবোর্ড শর্টকাট</span>
              </div>
              <button className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition" onClick={() => setShowShortcuts(false)}>✕</button>
            </div>
            <ul className="divide-y divide-slate-100 text-xs text-slate-600">
              <li className="flex items-center justify-between py-2">
                <span>Command Palette খুলুন</span>
                <span className="flex items-center gap-1 font-mono">
                  <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700 shadow-2xs">⌘K</kbd>
                  <span className="text-slate-400">বা</span>
                  <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700 shadow-2xs">Ctrl+K</kbd>
                </span>
              </li>
              <li className="flex items-center justify-between py-2">
                <span>তালিকায় নিচে / ওপরে যান</span>
                <span className="flex items-center gap-1 font-mono">
                  <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700 shadow-2xs">J</kbd>
                  <span className="text-slate-400">/</span>
                  <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700 shadow-2xs">K</kbd>
                </span>
              </li>
              <li className="flex items-center justify-between py-2">
                <span>বেছে নেওয়া কথোপকথন খুলুন</span>
                <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold font-mono text-slate-700 shadow-2xs">Enter</kbd>
              </li>
              <li className="flex items-center justify-between py-2">
                <span>খোঁজার বক্সে ফোকাস করুন</span>
                <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold font-mono text-slate-700 shadow-2xs">/</kbd>
              </li>
              <li className="flex items-center justify-between py-2">
                <span>উত্তরের ঘরে (Composer) যান</span>
                <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold font-mono text-slate-700 shadow-2xs">R</kbd>
              </li>
              <li className="flex items-center justify-between py-2">
                <span>বর্তমান কথোপকথন নিজেকে অ্যাসাইন করুন</span>
                <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold font-mono text-slate-700 shadow-2xs">E</kbd>
              </li>
              <li className="flex items-center justify-between py-2">
                <span>শর্টকাট গাইড দেখুন</span>
                <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold font-mono text-slate-700 shadow-2xs">?</kbd>
              </li>
              <li className="flex items-center justify-between py-2">
                <span>প্যানেল বা মোডাল বন্ধ করুন</span>
                <kbd className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold font-mono text-slate-700 shadow-2xs">Esc</kbd>
              </li>
            </ul>
            <div className="mt-4 rounded-xl bg-slate-50 p-2.5 text-[11px] text-slate-500 text-center">
              💡 কোনো লেখার ঘরে (Input/Textarea) থাকা অবস্থায় ⌘K ছাড়া অন্যান্য শর্টকাট ট্রিগার হয় না।
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

