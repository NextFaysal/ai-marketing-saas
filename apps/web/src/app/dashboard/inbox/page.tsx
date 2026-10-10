"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { API_URL, apiFetch, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { subscribeInboxStream } from "@/lib/inbox-stream";
import { EmptyState } from "@repo/ui";

interface WaWindow { open: boolean; expiresAt: string | null }
interface Conversation {
  id: string; channel: string; contactName?: string | null; contactPhone?: string | null;
  status: string; unreadCount: number; lastMessagePreview?: string | null; lastMessageAt?: string | null;
  assignedUserId?: string | null; tags?: string[]; whatsappWindow?: WaWindow | null;
  customerId?: string | null; leadId?: string | null;
  priority?: string; sentimentFlag?: string | null; firstResponseAt?: string | null;
  spamFlag?: boolean; spamReason?: string | null;
  csatRating?: number | null; csatSentAt?: string | null;
  summaryText?: string | null; summaryProvider?: string | null; summaryAt?: string | null;
}
interface Message {
  id: string; direction: string; content?: string | null; type: string; status: string;
  error?: string | null; createdAt: string; sentByAiDraft: boolean;
  mediaId?: string | null; mediaUrl?: string | null;
  intent?: string | null; intentConfidence?: number | null; autoReply?: boolean;
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
  orders: { id: string; externalNumber?: string | null; status: string; source: string; isCod: boolean; currency: string; totalMinor: string; createdAt: string; codConfirmationStatus?: string | null; shipment?: { trackingCode?: string | null; status: string; provider: string } | null }[];
  lifetime: { orderCount: number; totalSpentMinor: string; currency: string } | null;
}

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

export default function InboxPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [context, setContext] = useState<ContextData | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteText, setNoteText] = useState("");
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
  const [connectForm, setConnectForm] = useState({ channel: "whatsapp", accessToken: "", appSecret: "", verifyToken: "", phoneNumberId: "", pageId: "" });
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [qrForm, setQrForm] = useState({ title: "", content: "" });
  const [tplForm, setTplForm] = useState({ name: "", language: "bn", category: "UTILITY", bodyText: "" });
  const [settings, setSettings] = useState<{ autoReplyMode: string; confidenceThreshold: number; perIntent: Record<string, string>; smartAssign: string; slaFirstResponseMinutes: number; botEnabled?: boolean; botDeliveryChargeMinor?: number | null } | null>(null);
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
  const [report, setReport] = useState<any>(null);
  const [products, setProducts] = useState<{ id: string; name: string; priceMinor: string; currency: string; stockQuantity?: number | null }[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderItems, setOrderItems] = useState<{ productId: string; quantity: number }[]>([]);
  const [orderShip, setOrderShip] = useState("60");
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

  const loadConversations = useCallback(async (f = filters) => {
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
    try { setConversations(await apiFetch<Conversation[]>(`/organizations/${orgId}/inbox/conversations?${params.toString()}`)); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    try { setIntegrations(await apiFetch<any[]>(`/organizations/${orgId}/inbox/integrations`)); } catch { /* none */ }
  }, [filters]);

  useEffect(() => { loadConversations(); }, [loadConversations]);
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
      }
    });
    const fallback = setInterval(() => loadConversations(), 60000);
    return () => { unsub(); clearInterval(fallback); };
  }, [loadConversations]);
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
      else if (e.key === "Escape") { setPaletteOpen(false); setShowShortcuts(false); }
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

  async function openConversation(conv: Conversation) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError("");
    try {
      const res = await apiFetch<{ conversation: Conversation; messages: Message[]; drafts: Draft[]; context: ContextData; botSession?: { id: string; state: string; status: string } | null }>(`/organizations/${orgId}/inbox/conversations/${conv.id}`);
      setActive(res.conversation); setMessages(res.messages); setDrafts(res.drafts); setContext(res.context); setBotSession(res.botSession ?? null);
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
    const orgId = getOrganizationId(); if (!orgId || !active || !reply.trim()) return;
    setBusy("send"); setError("");
    try {
      const msg = await apiFetch<Message>(`/organizations/${orgId}/inbox/conversations/${active.id}/messages`, { method: "POST", body: JSON.stringify({ content: reply }) });
      setMessages((m) => [...m, msg]); setReply("");
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

  async function createChatOrder() {
    const orgId = getOrganizationId(); if (!orgId || !active) return;
    if (orderItems.length === 0) { setError("অন্তত একটি পণ্য যোগ করুন।"); return; }
    setBusy("order"); setError("");
    try {
      const order = await apiFetch<any>(`/organizations/${orgId}/inbox/conversations/${active.id}/orders`, {
        method: "POST",
        body: JSON.stringify({ items: orderItems, shippingMinor: Math.round((Number(orderShip) || 0) * 100), isCod: orderCod }),
      });
      if (order.storeSyncStatus === "synced") setNotice(`Order তৈরি হয়েছে এবং WooCommerce এ পাঠানো হয়েছে (#${order.externalNumber})।`);
      else if (order.storeSyncStatus === "failed") setNotice(`Order তৈরি হয়েছে (শুধু এই সিস্টেমে)। স্টোরে পাঠানো যায়নি: ${order.storeSyncError ?? "অজানা ত্রুটি"}`);
      else setNotice(`Order তৈরি হয়েছে (শুধু এই সিস্টেমে) — ${order.externalNumber}।`);
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

  async function addNote() {
    const orgId = getOrganizationId(); if (!orgId || !active || !noteText.trim()) return;
    try {
      const note = await apiFetch<Note>(`/organizations/${orgId}/inbox/conversations/${active.id}/notes`, { method: "POST", body: JSON.stringify({ content: noteText }) });
      setNotes((n) => [...n, note]); setNoteText("");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Inbox</h1>
        <p className="text-sm text-slate-500">WhatsApp ও Messenger এক জায়গায়। AI শুধু Draft সাজেস্ট করে, পাঠানোর সিদ্ধান্ত সবসময় মানুষের। বার্তা "পাঠানো হয়েছে" দেখানো হয় শুধু প্ল্যাটফর্মের Message ID পেলে। Internal Note কখনোই গ্রাহকের কাছে যায় না।</p>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)_320px]">
        {/* ---- Conversation list + filters ---- */}
        <div className={`${mobileChat ? "hidden lg:block" : "block"} space-y-2`}>
          <input id="inbox-search" className="input" placeholder="নাম, ফোন বা বার্তা খুঁজুন... ( / )" value={filters.q} onChange={(e) => onSearch(e.target.value)} />
          <div className="flex flex-wrap gap-1.5">
            <select className="input !w-auto flex-1" value={filters.channel} onChange={(e) => onFilter({ channel: e.target.value })}>
              <option value="">সব চ্যানেল</option><option value="whatsapp">WhatsApp</option><option value="messenger">Messenger</option><option value="instagram">Instagram</option><option value="webchat">ওয়েবসাইট চ্যাট</option>
            </select>
            <select className="input !w-auto flex-1" value={filters.assignee} onChange={(e) => onFilter({ assignee: e.target.value })}>
              <option value="">সবাই</option><option value="me">আমারগুলো</option><option value="unassigned">অনির্ধারিত</option>
            </select>
            <button className={`btn-sm rounded-lg border px-2 py-1.5 text-xs font-semibold ${filters.unreadOnly ? "bg-slate-900 text-white" : "bg-white"}`} onClick={() => onFilter({ unreadOnly: !filters.unreadOnly })}>অপঠিত</button>
            <button className={`btn-sm rounded-lg border px-2 py-1.5 text-xs font-semibold ${filters.sort === "unread" ? "bg-slate-900 text-white" : "bg-white"}`} onClick={() => onFilter({ sort: filters.sort === "unread" ? "recent" : "unread" })}>অপঠিত আগে</button>
            <button className={`btn-sm rounded-lg border px-2 py-1.5 text-xs font-semibold ${filters.spamOnly ? "bg-slate-900 text-white" : "bg-white"}`} onClick={() => onFilter({ spamOnly: !filters.spamOnly })}>🚫 Spam সন্দেহ</button>
          </div>
          <input className="input" placeholder="Tag দিয়ে ফিল্টার (যেমন vip)" value={filters.tag} onChange={(e) => onFilter({ tag: e.target.value })} />
          <div className="space-y-2 pt-1">
            {conversations.length === 0 ? (
              <EmptyState title="কোনো কথোপকথন নেই" description="WhatsApp/Messenger কানেক্ট করে Webhook সেট করলে গ্রাহকের বার্তা এখানে আসবে। নতুন গ্রাহক মেসেজ দিলে স্বয়ংক্রিয়ভাবে একটি Lead তৈরি হয়।" />
            ) : conversations.slice(0, visibleCount).map((c, ci) => (
              <button key={c.id} id={`conv-${c.id}`} onClick={() => { setFocusedIdx(ci); openConversation(c); }} className={`block w-full rounded-xl border bg-white px-3 py-2.5 text-left shadow-sm transition hover:shadow ${active?.id === c.id ? "border-brand-500 ring-1 ring-brand-500/40" : ""} ${focusedIdx === ci ? "ring-2 ring-indigo-300" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{c.contactName ?? c.contactPhone ?? "(নাম নেই)"}</span>
                  {c.unreadCount > 0 ? <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-bold text-white">{c.unreadCount}</span> : null}
                </div>
                <div className="truncate text-xs text-slate-500">{c.lastMessagePreview ?? ""}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-400">
                  <ChannelChip channel={c.channel} /><span>· {c.status}</span>
                  {c.channel === "whatsapp" && c.whatsappWindow ? (c.whatsappWindow.open ? <span className="text-emerald-600">· Window খোলা</span> : <span className="text-amber-600">· Window বন্ধ</span>) : null}
                  {c.spamFlag ? <span className="font-semibold text-amber-600">· 🚫 Spam সন্দেহ</span> : null}
                  {c.priority === "high" ? <span className="font-semibold text-red-600">· 🔥 অগ্রাধিকার</span> : null}
                  {c.sentimentFlag === "negative" ? <span className="text-red-500">· 😡</span> : null}
                  {c.assignedUserId ? <span>· {memberName(c.assignedUserId)}</span> : null}
                  {(c.tags ?? []).map((t) => <span key={t} className="badge-slate">{t}</span>)}
                </div>
              </button>
            ))}
            {visibleCount < conversations.length ? <div ref={sentinelRef} className="py-2 text-center text-xs text-slate-400">আরও কথোপকথন লোড হচ্ছে… ({conversations.length - visibleCount} বাকি)</div> : null}
          </div>
        </div>

        {/* ---- Thread ---- */}
        <div className={`${mobileChat ? "block" : "hidden lg:block"} min-w-0`}>
          {active ? (
            <div className="space-y-3 card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button className="rounded-lg border px-2 py-1 text-xs lg:hidden" onClick={() => setMobileChat(false)}>← তালিকা</button>
                  <div className="font-semibold">{active.contactName ?? active.contactPhone} <ChannelChip channel={active.channel} lg /></div>
                </div>
                <div className="flex gap-1.5 text-xs">
                  {(["open", "pending", "closed"] as const).map((s) => (
                    <button key={s} className={`rounded-lg px-2 py-1 font-medium ${active.status === s ? "bg-slate-900 text-white" : "bg-slate-100"}`} onClick={() => patchConversation({ status: s })}>{s}</button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 lg:hidden">
                <button className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium disabled:opacity-50" disabled={!myId} onClick={() => patchConversation({ assignedUserId: myId })}>👤 আমাকে অ্যাসাইন</button>
                {active.contactPhone ? <a className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700" href={`tel:${active.contactPhone}`}>📞 কল করুন</a> : null}
                <button className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium" onClick={() => patchConversation({ status: active.status === "closed" ? "open" : "closed" })}>{active.status === "closed" ? "↩️ আবার খুলুন" : "✓ বন্ধ করুন"}</button>
                <button className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium" onClick={() => setPaletteOpen(true)}>⌘K</button>
              </div>

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
              <div className="max-h-[28rem] space-y-2 overflow-y-auto rounded-xl bg-slate-50 p-3">
                {messages.map((m, i) => {
                  const prevDay = i > 0 ? new Date(messages[i - 1].createdAt).toDateString() : null;
                  const thisDay = new Date(m.createdAt).toDateString();
                  return (
                    <React.Fragment key={m.id}>
                      {prevDay !== thisDay ? <div className="py-1 text-center text-[11px] font-semibold text-slate-400">{dayLabel(m.createdAt)}</div> : null}
                      <div className={m.direction === "in" ? "flex justify-start" : "flex justify-end"}>
                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.direction === "in" ? "border bg-white" : m.status === "failed" ? "bg-red-100" : "bg-gradient-to-br from-brand-500 to-violet-500 text-white shadow"}`}>
                      {(m.mediaId || m.mediaUrl) && m.type !== "text" ? <div className="mb-1"><MediaView convId={active.id} message={m} /></div> : null}
                      {m.content ? <div className="whitespace-pre-wrap">{m.type === "template" ? `🧩 ${m.content}` : m.content}</div> : (m.mediaId || m.mediaUrl) ? null : <div>[{m.type}]</div>}
                      <div className={`mt-0.5 text-[10px] ${m.direction === "in" ? "text-slate-400" : "opacity-75"}`}>
                        {new Date(m.createdAt).toLocaleTimeString()}{statusIcon(m)}{m.sentByAiDraft ? " · AI Draft থেকে" : ""}{m.autoReply ? " · 🤖 অটো-রিপ্লাই" : ""}
                        {m.direction === "in" && m.intent && m.intent !== "other" ? <span className="ml-1 rounded bg-indigo-50 px-1 py-px font-semibold text-indigo-600" title={`আস্থা ${m.intentConfidence ?? 0}%`}>{m.intent} · {m.intentConfidence}%</span> : null}
                        {m.direction === "in" && m.content ? <button className="ml-1 font-semibold text-indigo-500 hover:underline" onClick={() => translateMsg(m)}>অনুবাদ</button> : null}
                        {m.error ? <div className="text-red-600">{m.error}</div> : null}
                      </div>
                      {translations[m.id] ? <div className="mt-1 rounded bg-white/70 px-1.5 py-1 text-[11px] italic text-slate-600">🌐 {translations[m.id]}</div> : null}
                      {m.transcription ? <div className="mt-1 rounded bg-slate-100 px-1.5 py-1 text-[11px] text-slate-600">🎙️ {m.transcription} <span className="text-slate-400">({m.transcriptionProvider})</span></div> : null}
                      {m.direction === "in" && (m.mediaId || m.mediaUrl) && m.type === "audio" && !m.transcription ? (
                        <button className="mt-1 text-[11px] font-semibold text-indigo-600 hover:underline" disabled={busy !== ""} onClick={async () => {
                          const orgId = getOrganizationId(); if (!orgId || !active) return;
                          setBusy("transcribe");
                          try { await apiFetch(`/organizations/${orgId}/inbox/conversations/${active.id}/messages/${m.id}/transcribe`, { method: "POST" }); await refreshActive(); }
                          catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
                          finally { setBusy(""); }
                        }}>🎙️ ভয়েস লেখায় রূপান্তর করুন</button>
                      ) : null}
                      {m.direction === "in" && (m.mediaId || m.mediaUrl) && m.type === "image" ? (() => {
                        const v = verifications.find((x) => x.messageId === m.id);
                        return v ? (
                          <div className={`mt-1 rounded px-1.5 py-1 text-[11px] font-medium ${v.verdict === "matched" ? "bg-green-100 text-green-800" : v.verdict === "amount_mismatch" || v.verdict === "duplicate_trxid" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                            💳 যাচাই: {v.verdict}{v.trxId ? ` · TrxID ${v.trxId}` : ""}{v.amountMinor ? ` · ${money(v.amountMinor)}` : ""}{v.expectedAmountMinor ? ` / প্রত্যাশিত ${money(v.expectedAmountMinor)}` : ""}{v.flags?.length ? ` · ⚠️ ${v.flags.join(", ")}` : ""}
                          </div>
                        ) : (
                          <button className="mt-1 text-[11px] font-semibold text-indigo-600 hover:underline" disabled={busy !== ""} onClick={async () => {
                            const orgId = getOrganizationId(); if (!orgId || !active) return;
                            setBusy("verify");
                            try { await apiFetch(`/organizations/${orgId}/inbox/conversations/${active.id}/messages/${m.id}/verify-payment`, { method: "POST" }); await refreshActive(); }
                            catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
                            finally { setBusy(""); }
                          }}>💳 পেমেন্ট স্ক্রিনশট যাচাই করুন</button>
                        );
                      })() : null}
                      </div>
                      </div>
                    </React.Fragment>
                  );
                })}
                {messages.length === 0 ? <p className="text-sm text-slate-400">কোনো বার্তা নেই</p> : null}
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

              <div className="relative">
                {showQuick && quickMatches.length ? (
                  <div className="absolute bottom-full left-0 right-0 z-10 mb-1 max-h-48 overflow-y-auto rounded-xl border bg-white shadow-lg">
                    {quickMatches.map((q) => (
                      <button key={q.id} className="block w-full px-3 py-2 text-left text-sm hover:bg-brand-50" onClick={() => { setReply(renderQuick(q.content, active)); setShowQuick(false); }}>
                        <span className="font-semibold">{q.title}</span>
                        <span className="block truncate text-xs text-slate-500">{q.content}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="flex gap-2">
                  <input id="inbox-reply" className="input flex-1" placeholder="উত্তর লিখুন... ( / চাপলে Quick Reply )" value={reply}
                    onChange={(e) => { setReply(e.target.value); setShowQuick(e.target.value.startsWith("/")); setIAmTyping(e.target.value.length > 0); }}
                    onBlur={() => setIAmTyping(false)}
                    onFocus={() => { if (reply.startsWith("/")) setShowQuick(true); }}
                    onKeyDown={(e) => { if (e.key === "Enter") sendReply(); if (e.key === "Escape") setShowQuick(false); }} />
                  <button className="btn-secondary btn-sm" onClick={() => setShowQuick((s) => !s)}>⚡</button>
                  <button className="btn-secondary btn-sm" title="পণ্য বেছে স্নিপেট বসান" onClick={() => setShowPicker((s) => !s)}>🛍️</button>
                  <button className="btn-secondary btn-sm" onClick={() => setShowImage((s) => !s)}>🖼️</button>
                  <button className="btn-secondary btn-sm disabled:opacity-50" disabled={busy !== ""} onClick={suggestDraft}>{busy === "draft" ? "..." : "AI Draft"}</button>
                  <button className="btn-primary disabled:opacity-50" disabled={busy !== ""} onClick={sendReply}>{busy === "send" ? "পাঠাচ্ছি..." : "পাঠান"}</button>
                </div>
              </div>
              {showPicker ? (
                <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
                  {products.length === 0 ? <p className="px-1 py-2 text-xs text-slate-400">কোনো পণ্য নেই</p> : products.map((prod) => (
                    <button key={prod.id} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs hover:bg-indigo-50" onClick={() => insertProductSnippet(prod)}>
                      <span className="font-medium">{prod.name}</span>
                      <span className="text-slate-500">{money(prod.priceMinor, prod.currency)}{prod.stockQuantity != null ? ` · স্টক ${prod.stockQuantity}` : ""}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {showImage ? (
                <div className="flex flex-wrap gap-2 rounded-xl bg-slate-50 p-3">
                  <input className="input flex-1" placeholder="ছবির পাবলিক https URL" value={imageForm.url} onChange={(e) => setImageForm({ ...imageForm, url: e.target.value })} />
                  <input className="input flex-1" placeholder="ক্যাপশন (ঐচ্ছিক)" value={imageForm.caption} onChange={(e) => setImageForm({ ...imageForm, caption: e.target.value })} />
                  <button className="btn-primary btn-sm" disabled={busy !== ""} onClick={sendImage}>{busy === "image" ? "পাঠাচ্ছি..." : "ছবি পাঠান"}</button>
                </div>
              ) : null}
            </div>
          ) : <p className="card p-5 text-sm text-slate-500">বাম দিক থেকে একটি কথোপকথন বেছে নিন।</p>}
        </div>

        {/* ---- Customer context + controls + notes ---- */}
        {active ? (
          <div className="space-y-4 lg:col-span-2 2xl:col-span-1">
            <div className="card space-y-3 p-4">
              <div className="section-title">গ্রাহক</div>
              {context?.customer ? (
                <div className="text-sm">
                  <div className="font-semibold">{context.customer.name ?? active.contactName ?? "—"}</div>
                  <div className="text-slate-500">{context.customer.phone ?? active.contactPhone ?? ""}{context.customer.email ? ` · ${context.customer.email}` : ""}</div>
                  {context.lifetime ? (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-slate-50 p-2.5"><div className="text-[11px] uppercase text-slate-400">মোট অর্ডার</div><div className="font-bold">{context.lifetime.orderCount}টি</div></div>
                      <div className="rounded-xl bg-slate-50 p-2.5"><div className="text-[11px] uppercase text-slate-400">Lifetime কেনাকাটা</div><div className="font-bold">{money(context.lifetime.totalSpentMinor, context.lifetime.currency)}</div></div>
                    </div>
                  ) : null}
                </div>
              ) : <p className="text-sm text-slate-500">কোনো Customer রেকর্ডের সাথে যুক্ত নয়{context?.lead ? "" : " (নতুন কন্ট্যাক্ট হলে Lead তৈরি হয়েছে)"}।</p>}
              {context?.lead ? (
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
                        {o.shipment ? <div className="mt-1"><span className="badge-indigo" title={o.shipment.trackingCode ?? ""}>🚚 {o.shipment.provider}: {o.shipment.status}{o.shipment.trackingCode ? ` · ${o.shipment.trackingCode}` : ""}</span></div> : null}
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

            <div className="card space-y-2 p-4">
              <div className="section-title">Internal Notes <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">শুধু টিম দেখবে</span></div>
              <div className="max-h-44 space-y-2 overflow-y-auto">
                {notes.map((n) => (
                  <div key={n.id} className="rounded-lg bg-amber-50 px-2.5 py-2 text-xs">
                    <div className="whitespace-pre-wrap text-slate-700">{n.content}</div>
                    <div className="mt-0.5 text-[10px] text-slate-400">{memberName(n.authorUserId)} · {new Date(n.createdAt).toLocaleString()}</div>
                  </div>
                ))}
                {notes.length === 0 ? <p className="text-xs text-slate-400">কোনো নোট নেই।</p> : null}
              </div>
              <textarea className="input" rows={2} placeholder="টিমের জন্য নোট লিখুন (গ্রাহক দেখবে না)..." value={noteText} onChange={(e) => setNoteText(e.target.value)} />
              <button className="btn-secondary btn-sm" onClick={addNote}>নোট যোগ করুন</button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="card space-y-3 p-5">
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

        <div className="card space-y-3 p-5">
          <div className="section-title">📊 টিম রিপোর্ট (শেষ ৭ দিন)</div>
          {report ? (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-xl bg-slate-50 p-2.5"><div className="text-[11px] uppercase text-slate-400">নতুন কথোপকথন</div><div className="text-lg font-bold">{report.opened}</div></div>
                <div className="rounded-xl bg-slate-50 p-2.5"><div className="text-[11px] uppercase text-slate-400">বন্ধ হয়েছে</div><div className="text-lg font-bold">{report.closed}</div></div>
                <div className="rounded-xl bg-slate-50 p-2.5"><div className="text-[11px] uppercase text-slate-400">গড় প্রথম উত্তর</div><div className="text-lg font-bold">{report.avgFirstResponseMinutes != null ? `${report.avgFirstResponseMinutes} মিনিট` : "—"}</div></div>
                <div className={`rounded-xl p-2.5 ${report.currentBreaches > 0 ? "bg-red-50" : "bg-slate-50"}`}><div className="text-[11px] uppercase text-slate-400">SLA ভঙ্গ (এখন)</div><div className={`text-lg font-bold ${report.currentBreaches > 0 ? "text-red-600" : ""}`}>{report.currentBreaches}</div></div>
              </div>
              <div className="text-xs text-slate-500">চ্যাট-যুক্ত গ্রাহকদের অর্ডার: <span className="font-semibold text-slate-700">{report.chatLinkedOrders}টি</span> · আয়: <span className="font-semibold text-slate-700">{money(report.chatLinkedRevenueMinor, report.chatLinkedCurrency)}</span></div>
              {(report.perAgent ?? []).length ? (
                <div className="space-y-1">
                  {report.perAgent.map((a: any) => (
                    <div key={a.userId} className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                      <span className="font-medium">{memberName(a.userId)}</span>
                      <span>দায়িত্ব {a.assigned} · বন্ধ {a.closed} · গড় উত্তর {a.avgFirstResponseMinutes != null ? `${a.avgFirstResponseMinutes} মিনিট` : "—"}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : <p className="text-xs text-slate-400">রিপোর্ট লোড হচ্ছে...</p>}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
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

      {paletteOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 p-4 pt-24" onClick={() => setPaletteOpen(false)}>
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b px-4 py-3 text-sm font-semibold">⌘K — দ্রুত কাজ ও লাফ</div>
            <div className="max-h-80 overflow-y-auto p-2">
              {conversations.filter((c) => c.unreadCount > 0).slice(0, 5).map((c) => (
                <button key={c.id} className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setPaletteOpen(false); void openConversation(c); }}>
                  <span className="truncate">{c.contactName ?? c.contactPhone ?? "গ্রাহক"}</span>
                  <span className="shrink-0"><ChannelChip channel={c.channel} /> <span className="badge-slate">{c.unreadCount} অপঠিত</span></span>
                </button>
              ))}
              <button className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setPaletteOpen(false); onFilter({ unreadOnly: !filters.unreadOnly }); }}>🔵 {filters.unreadOnly ? "সব কথোপকথন দেখুন" : "শুধু অপঠিত দেখুন"}</button>
              {(["whatsapp", "messenger", "instagram", "webchat"] as const).map((ch) => (
                <button key={ch} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setPaletteOpen(false); onFilter({ channel: filters.channel === ch ? "" : ch }); }}>
                  <ChannelChip channel={ch} /> {filters.channel === ch ? "ফিল্টার সরান" : "শুধু এই চ্যানেল"}
                </button>
              ))}
              {active && myId ? <button className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setPaletteOpen(false); void patchConversation({ assignedUserId: myId }); }}>👤 বর্তমান কথোপকথন নিজেকে অ্যাসাইন করুন (E)</button> : null}
              <button className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setPaletteOpen(false); setShowShortcuts(true); }}>⌨️ কীবোর্ড Shortcut তালিকা</button>
            </div>
          </div>
        </div>
      ) : null}

      {showShortcuts ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setShowShortcuts(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 text-sm font-semibold">⌨️ কীবোর্ড Shortcut</div>
            <ul className="space-y-1.5 text-sm text-slate-600">
              <li><b>⌘K / Ctrl+K</b> — Command Palette</li>
              <li><b>J / K</b> — তালিকায় নিচে / ওপরে</li>
              <li><b>Enter</b> — বেছে নেওয়া কথোপকথন খুলুন</li>
              <li><b>/</b> — খোঁজার ঘরে যান</li>
              <li><b>R</b> — উত্তরের ঘরে যান</li>
              <li><b>E</b> — বর্তমান কথোপকথন নিজেকে অ্যাসাইন</li>
              <li><b>?</b> — এই তালিকা</li>
              <li><b>Esc</b> — প্যানেল বন্ধ</li>
            </ul>
            <p className="mt-3 text-xs text-slate-400">লেখার ঘরে থাকলে Shortcut কাজ করবে না (⌘K ছাড়া)।</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

