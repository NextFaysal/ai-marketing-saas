"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { Markdown } from "@/components/markdown";
import { streamAiMessage, type AiStreamToolCall } from "@/lib/ai-stream";
import { AiRichAnswer, AiToolTransparency } from "@/components/ai-rich";
import { pageContextFor, pageLabelFor, pendingBadgeLabel, pickTodaysBriefing, selectionQuote, suggestionsFor, type BriefingLike } from "@/lib/global-assistant";
import { useSavedPrompts, type SavedPrompt } from "@/lib/ai-prompts";
import { PromptPicker } from "@/components/prompt-picker";
import { applyMention, mentionQueryOf, useMentionSearch, type MentionItem, type MentionRef } from "@/lib/mentions";
import { MentionPicker } from "@/components/mention-picker";
import { ATTACHMENT_ACCEPT, uploadChatAttachment, type ChatAttachment } from "@/lib/attachments";
import { useVoiceInput } from "@/lib/voice-input";
import { useSpeechOutput } from "@/lib/voice-output";
import { PERSONAS_UI } from "@/lib/personas";
import { AiMessageAttachment } from "@/components/ai-rich";

interface Conversation { id: string; title?: string | null; updatedAt: string; pinnedAt?: string | null; tags?: string[]; persona?: string }
interface Message { id: string; role: string; content: string; toolCalls?: AiStreamToolCall[] | null; attachmentName?: string | null; attachmentKind?: string | null; attachmentText?: string | null }
interface StreamStep { phase: "planning" | "tool"; tool?: string }
interface Proposal { id: string; title: string; preview: string; status: string; error?: string | null }
type NotificationItem = BriefingLike & { conversationId?: string | null }

/**
 * Global Assistant — the AI Assistant, available on every dashboard
 * page (owner instruction 2026-10-12; design from
 * docs/ai-assistant-full-plan.md §Design: floating button +
 * Cmd/Ctrl+J, page-aware context, bottom sheet on mobile).
 *
 * It is a thin shell over the SAME chat store and streaming endpoint
 * as the full AI page: opening it resumes the most recent
 * conversation, and anything said here appears on the AI page (and
 * vice versa). Page-awareness sends only the current section path
 * (see lib/global-assistant.ts) as a compose-time hint. On the AI
 * page itself this renders nothing — the full workspace is already
 * there. A created proposal is never executed here; the notice
 * links to the approval panel on the AI page.
 */
export function GlobalAssistant() {
  const pathname = usePathname() ?? "/dashboard";
  const [open, setOpen] = useState(false);
  const [booted, setBooted] = useState(false);
  const [activeId, setActiveId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [provider, setProvider] = useState("");
  // GV1 (G1): history view — the panel can switch conversations, not
  // just resume the latest. Server order is kept verbatim.
  const [view, setView] = useState<"chat" | "history">("chat");
  const [assistantName, setAssistantName] = useState("");
  const [personaSel, setPersonaSel] = useState("general");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [histSearch, setHistSearch] = useState("");
  // GV2 (G3+G5): pending proposals (badge + in-panel decisions) and
  // today's briefing card. All counts/bodies are server data only.
  const [pendingProposals, setPendingProposals] = useState<Proposal[]>([]);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [propBusy, setPropBusy] = useState("");
  const [propNotice, setPropNotice] = useState("");
  const [briefing, setBriefing] = useState<NotificationItem | null>(null);
  const [briefingExpanded, setBriefingExpanded] = useState(false);
  // GV3 (G4): "/" prompt picker over the per-user saved library.
  const promptsLib = useSavedPrompts();
  const [pickerDismissedFor, setPickerDismissedFor] = useState<string | null>(null);
  const [promptNote, setPromptNote] = useState("");
  // G6: @-mention — one attached record per message.
  const [mentionRef, setMentionRef] = useState<MentionRef | null>(null);
  const [mentionDismissedFor, setMentionDismissedFor] = useState<string | null>(null);
  // G6 select-to-ask bubble (dashboard text selection → ask AI).
  const [selBubble, setSelBubble] = useState<{ x: number; y: number; text: string } | null>(null);
  // AP2: one pending attachment per message (processed server-side).
  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null);
  const [attaching, setAttaching] = useState(false);
  // AP2: voice dictation (browser speech recognition, BN/EN).
  const voice = useVoiceInput((text) => setInput(text));
  // AP7: voice-first read-aloud (browser TTS, toggle persisted).
  const tts = useSpeechOutput("ga-panel-tts");
  const wasSendingRef = useRef(false);
  useEffect(() => {
    if (wasSendingRef.current && !sending) {
      const last = [...messages].reverse().find((m) => m.role === "assistant");
      if (last) tts.speakOnce(last.id, last.content);
    }
    wasSendingRef.current = sending;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending, messages, tts.enabled]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [streaming, setStreaming] = useState<{ text: string; steps: StreamStep[] } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamConvRef = useRef("");
  const streamTextRef = useRef("");

  const onAiPage = pathname === "/dashboard/ai" || pathname.startsWith("/dashboard/ai/");
  const pageLabel = pageLabelFor(pathname);
  const pageContext = pageContextFor(pathname);
  const starters = suggestionsFor(pathname);

  const loadMessages = useCallback(async (convId: string) => {
    const id = getOrganizationId(); if (!id || !convId) return;
    try { setMessages(await apiFetch<Message[]>(`/organizations/${id}/ai/chat/conversations/${convId}/messages`)); }
    catch (e) { setError(e instanceof Error ? e.message : "মেসেজ লোড করা যায়নি"); }
  }, []);

  const loadConversations = useCallback(async (q?: string): Promise<Conversation[]> => {
    const id = getOrganizationId(); if (!id) return [];
    try {
      const query = q?.trim() ? `?search=${encodeURIComponent(q.trim())}` : "";
      const convs = await apiFetch<Conversation[]>(`/organizations/${id}/ai/chat/conversations${query}`);
      setConversations(convs);
      return convs;
    } catch { return []; } // a fresh account simply has none
  }, []);

  const loadPending = useCallback(async () => {
    const id = getOrganizationId(); if (!id) return;
    try {
      const rows = await apiFetch<Proposal[]>(`/organizations/${id}/ai/proposals?status=proposed`);
      setPendingProposals(rows);
      setPendingCount(rows.length);
    } catch { /* best-effort: no badge/strip on failure */ }
  }, []);

  const loadBriefing = useCallback(async () => {
    const id = getOrganizationId(); if (!id) return;
    try {
      const items = await apiFetch<NotificationItem[]>(`/organizations/${id}/inbox/notifications`);
      setBriefing(pickTodaysBriefing(items));
    } catch { /* best-effort: no card on failure */ }
  }, []);

  // FAB badge polling (the NotificationBell pattern): 60s, and only
  // where the FAB actually renders.
  useEffect(() => {
    if (onAiPage) return;
    void loadPending();
    const t = setInterval(() => void loadPending(), 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Panel open: refresh decisions + briefing.
  useEffect(() => {
    if (!open) return;
    void loadPending();
    void loadBriefing();
  }, [open, loadPending, loadBriefing]);

  // AP5: bulk approval in-panel — same endpoint, per-item summary.
  async function approveAllPending() {
    const ids = pendingProposals.map((x) => x.id);
    if (ids.length < 2 || propBusy) return;
    if (!window.confirm(`${ids.length}টি অপেক্ষমাণ প্রস্তাবের সবগুলো অনুমোদন দেবেন? প্রতিটির ফলাফল আলাদাভাবে জানানো হবে।`)) return;
    const orgId = getOrganizationId();
    if (!orgId) return;
    setPropBusy("bulk");
    try {
      const out = await apiFetch<{ results: { id: string; status: string; error?: string }[]; executed: number }>(
        `/organizations/${orgId}/ai/proposals/bulk-approve`, { method: "POST", body: JSON.stringify({ ids }) });
      const failures = out.results.filter((r) => r.status !== "executed");
      setPropNotice(failures.length === 0
        ? `সবগুলো প্রস্তাব কার্যকর হয়েছে (${out.executed}টি)।`
        : `${out.executed}টি কার্যকর হয়েছে; ${failures.length}টি হয়নি: ${failures.map((f) => f.error ?? f.status).join(" · ")}`);
      await loadPending();
    } catch (e) { setPropNotice(e instanceof Error ? e.message : "Bulk অনুমোদন ব্যর্থ হয়েছে"); }
    setPropBusy("");
  }

  // AP7: assistant identity (best-effort) + persona sync/switch.
  useEffect(() => {
    const id = getOrganizationId();
    if (!id) return;
    apiFetch<{ assistantName?: string | null }>(`/organizations/${id}/ai/proactive/settings`)
      .then((s) => setAssistantName(s.assistantName ?? ""))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    const current = conversations.find((c) => c.id === activeId);
    if (current?.persona) setPersonaSel(current.persona);
  }, [activeId, conversations]);
  async function changePersona(persona: string) {
    setPersonaSel(persona);
    const id = getOrganizationId();
    if (!id || !activeId) return;
    try {
      await apiFetch(`/organizations/${id}/ai/chat/conversations/${activeId}`, { method: "PATCH", body: JSON.stringify({ persona }) });
      setConversations((prev) => prev.map((c) => (c.id === activeId ? { ...c, persona } : c)));
    } catch { /* persona stays local until reload */ }
  }

  async function decideProposal(pr: Proposal, action: "approve" | "reject") {
    const id = getOrganizationId(); if (!id || propBusy) return;
    if (action === "approve" && !window.confirm(`${pr.preview}\n\nআপনি কি সত্যিই অনুমোদন দিচ্ছেন?`)) return;
    setPropBusy(pr.id);
    setPropNotice("");
    try {
      const updated = await apiFetch<Proposal>(`/organizations/${id}/ai/proposals/${pr.id}/${action}`, { method: "POST", body: JSON.stringify({}) });
      if (action === "approve" && updated.status === "failed") {
        setPropNotice(`প্রস্তাবটি ব্যর্থ হিসেবে রেকর্ড হয়েছে: ${updated.error ?? "platform error"}`);
      } else if (action === "approve") {
        setPropNotice("প্রস্তাব অনুমোদিত ও কার্যকর হয়েছে।");
      } else {
        setPropNotice("প্রস্তাব প্রত্যাখ্যান করা হয়েছে।");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      setPropNotice(msg.toLowerCase().includes("forbidden")
        ? "আপনার রোলে প্রস্তাব অনুমোদন/প্রত্যাখ্যানের অধিকার নেই — একজন OWNER/ADMIN/MARKETING_MANAGER-কে দিয়ে করান।"
        : msg);
    } finally {
      setPropBusy("");
      void loadPending();
    }
  }

  const pickerOpen = view === "chat" && input.startsWith("/") && pickerDismissedFor !== input && !sending;

  const mentionQuery = mentionQueryOf(input);
  const mentionOpen = view === "chat" && !pickerOpen && !!mentionQuery && mentionQuery.query.length >= 1 && mentionDismissedFor !== input && !sending;
  const mentionSearch = useMentionSearch(mentionOpen && mentionQuery ? mentionQuery.query : null);

  async function onAttachFile(file: File | undefined) {
    if (!file) return;
    const orgId = getOrganizationId();
    if (!orgId) { setError("Organization পাওয়া যায়নি"); return; }
    setAttaching(true);
    try {
      setPendingAttachment(await uploadChatAttachment(orgId, file));
    } catch (e) { setError(e instanceof Error ? e.message : "আপলোড ব্যর্থ হয়েছে"); }
    setAttaching(false);
  }

  function pickMention(item: MentionItem) {
    const next = applyMention(input, item);
    setInput(next);
    setMentionRef({ type: item.type, id: item.id, label: item.label });
    setMentionDismissedFor(next);
  }

  async function saveCurrentAsPrompt() {
    const body = input.trim();
    if (!body || body.startsWith("/")) return;
    const fallback = body.split("\n")[0].slice(0, 60);
    const title = window.prompt("এই prompt-এর নাম দিন:", fallback);
    if (title === null) return;
    if (!title.trim()) { setError("Prompt-এর নাম খালি রাখা যাবে না"); return; }
    try {
      await promptsLib.create(title.trim(), body);
      setPromptNote("✓ Prompt save হয়েছে — এবার “/” লিখলেই পাবেন");
    } catch (e) { setError(e instanceof Error ? e.message : "Prompt save করা যায়নি"); }
  }

  function renameSavedPrompt(sp: SavedPrompt) {
    const title = window.prompt("Prompt-এর নতুন নাম:", sp.title);
    if (title === null) return;
    if (!title.trim()) { setError("Prompt-এর নাম খালি রাখা যাবে না"); return; }
    promptsLib.rename(sp.id, title.trim()).catch((e) => setError(e instanceof Error ? e.message : "নাম বদলানো যায়নি"));
  }

  function deleteSavedPrompt(sp: SavedPrompt) {
    if (!window.confirm(`“${sp.title}” prompt-টি মুছে ফেলবেন?`)) return;
    promptsLib.remove(sp.id).catch((e) => setError(e instanceof Error ? e.message : "মুছে ফেলা যায়নি"));
  }

  function expandBriefing() {
    setBriefingExpanded(true);
    const id = getOrganizationId();
    if (!id || !briefing || briefing.readAt) return;
    const bid = briefing.id;
    setBriefing({ ...briefing, readAt: new Date().toISOString() });
    void apiFetch(`/organizations/${id}/inbox/notifications/${bid}/read`, { method: "POST" }).catch(() => undefined);
  }

  // First open: resume the most recent conversation (the list API
  // returns updatedAt desc), if the user has one.
  useEffect(() => {
    if (!open || booted) return;
    setBooted(true);
    void loadConversations().then((convs) => {
      if (convs.length > 0) {
        setActiveId(convs[0].id);
        void loadMessages(convs[0].id);
      }
    });
  }, [open, booted, loadConversations, loadMessages]);

  // History search: debounced, server-side (same pattern as the AI page).
  useEffect(() => {
    if (view !== "history") return;
    const t = setTimeout(() => void loadConversations(histSearch), 300);
    return () => clearTimeout(t);
  }, [histSearch, view, loadConversations]);

  function switchConversation(c: Conversation) {
    if (sending) return;
    setActiveId(c.id);
    setFollowUps([]);
    setNotice("");
    setError("");
    setView("chat");
    void loadMessages(c.id);
  }

  async function togglePin(c: Conversation) {
    const id = getOrganizationId(); if (!id) return;
    try {
      await apiFetch(`/organizations/${id}/ai/chat/conversations/${c.id}`, { method: "PATCH", body: JSON.stringify({ pinned: !c.pinnedAt }) });
      void loadConversations(histSearch);
    } catch (e) { setError(e instanceof Error ? e.message : "পিন করা যায়নি"); }
  }

  // G6: watch dashboard text selections while the panel is closed;
  // a meaningful selection offers a floating ask bubble. Selections
  // inside inputs/textareas or the panel itself never trigger it.
  useEffect(() => {
    if (open || onAiPage) { setSelBubble(null); return; }
    const onUp = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) { setSelBubble(null); return; }
      const quote = selectionQuote(sel.toString());
      if (!quote) { setSelBubble(null); return; }
      const node = sel.anchorNode;
      const el = node instanceof Element ? node : node?.parentElement;
      if (!el || el.closest("input, textarea, select, [contenteditable], .ga-panel")) { setSelBubble(null); return; }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      setSelBubble({
        x: Math.min(Math.max(rect.left + rect.width / 2, 90), window.innerWidth - 90),
        y: Math.max(rect.top - 10, 60),
        text: quote,
      });
    };
    const onChange = () => { if (window.getSelection()?.isCollapsed) setSelBubble(null); };
    document.addEventListener("mouseup", onUp);
    document.addEventListener("selectionchange", onChange);
    return () => { document.removeEventListener("mouseup", onUp); document.removeEventListener("selectionchange", onChange); };
  }, [open, onAiPage]);

  function askAboutSelection() {
    if (!selBubble) return;
    setInput(`নির্বাচিত লেখা: “${selBubble.text}”\nআমার প্রশ্ন: `);
    setSelBubble(null);
    window.getSelection()?.removeAllRanges();
    setOpen(true);
  }

  // Cmd/Ctrl+J toggles the panel from anywhere; Esc closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [open, messages, streaming]);

  async function newConversation(): Promise<string | null> {
    const id = getOrganizationId(); if (!id) return null;
    const conv = await apiFetch<Conversation>(`/organizations/${id}/ai/chat/conversations`, { method: "POST", body: JSON.stringify({}) });
    setActiveId(conv.id);
    setMessages([]);
    setFollowUps([]);
    setNotice("");
    setView("chat");
    void loadConversations(histSearch);
    return conv.id;
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending) return;
    const orgId = getOrganizationId(); if (!orgId) return;
    setError(""); setNotice(""); setSending(true); setInput(""); setFollowUps([]);
    let convId = activeId;
    try {
      if (!convId) { convId = (await newConversation()) ?? ""; if (!convId) { setSending(false); return; } }
    } catch (e) {
      setError(e instanceof Error ? e.message : "পাঠানো যায়নি");
      setSending(false);
      return;
    }
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: "user", content, ...(sendAttachment ? { attachmentName: sendAttachment.name, attachmentKind: sendAttachment.kind, attachmentText: sendAttachment.text } : {}) }]);
    streamConvRef.current = convId;
    streamTextRef.current = "";
    setStreaming({ text: "", steps: [] });
    const sendEntity = mentionRef ? { type: mentionRef.type, id: mentionRef.id } : undefined;
    setMentionRef(null);
    const sendAttachment = pendingAttachment ? { name: pendingAttachment.name, kind: pendingAttachment.kind, text: pendingAttachment.text } : undefined;
    setPendingAttachment(null);
    abortRef.current = streamAiMessage(orgId, convId, content, {
      onStep: (step) => setStreaming((cur) => (cur ? { ...cur, steps: [...cur.steps, step] } : cur)),
      onDelta: (delta) => {
        streamTextRef.current += delta;
        setStreaming((cur) => (cur ? { ...cur, text: cur.text + delta } : cur));
      },
      onDone: (done) => {
        setProvider(done.isRealLlm ? done.provider : "dev-template");
        setMessages((m) => [...m, { id: done.messageId, role: "assistant", content: streamTextRef.current, toolCalls: done.toolsUsed }]);
        setStreaming(null);
        setFollowUps(done.suggestions ?? []);
        if (done.proposal) {
          setNotice(`একটি প্রস্তাব তৈরি হয়েছে: ${done.proposal.title ?? ""} — অনুমোদন ছাড়া কিছুই হয়নি। নিচের প্রস্তাব কার্ডে সিদ্ধান্ত দিন।`);
          void loadPending();
        }
        setSending(false);
      },
      onError: (message) => {
        setStreaming(null);
        setError(message);
        setSending(false);
      },
    }, pageContext, { entity: sendEntity, attachment: sendAttachment });
  }

  function stopStreaming() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(null);
    setSending(false);
    const convId = streamConvRef.current;
    if (convId) void loadMessages(convId);
  }

  const historyBody = (
    <div className="space-y-2">
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">🔍</span>
        <input
          className="input pl-9"
          placeholder="কথোপকথন খুঁজুন (নাম বা মেসেজ)..."
          value={histSearch}
          onChange={(e) => setHistSearch(e.target.value)}
          autoFocus
        />
      </div>
      {conversations.length === 0 ? (
        <p className="px-1 py-4 text-center text-sm text-slate-400">{histSearch.trim() ? "কিছু পাওয়া যায়নি" : "এখনো কোনো কথোপকথন নেই।"}</p>
      ) : conversations.map((c) => (
        <div key={c.id} className={`ai3-conv ${c.id === activeId ? "ai3-conv-active" : ""}`}>
          <button type="button" className="w-full text-left" onClick={() => switchConversation(c)}>
            <span className={`block truncate text-sm ${c.id === activeId ? "font-bold text-slate-900" : "font-medium text-slate-700"}`}>{c.pinnedAt ? "📌 " : ""}{c.title ?? "নতুন কথোপকথন"}</span>
            <span className="mt-0.5 block text-[11px] text-slate-400">{new Date(c.updatedAt).toLocaleDateString()}</span>
          </button>
          {c.tags && c.tags.length > 0 ? (
            <span className="mt-1.5 flex flex-wrap gap-1">
              {c.tags.map((tag) => <span key={tag} className="ai-tag-chip">{tag}</span>)}
            </span>
          ) : null}
          <span className="mt-1.5 flex gap-1">
            <button type="button" className="ai3-act-btn" onClick={() => void togglePin(c)}>{c.pinnedAt ? "আনপিন" : "পিন করুন"}</button>
          </span>
        </div>
      ))}
      <p className="px-1 pt-1 text-[11px] leading-5 text-slate-400">
        নাম বদল, এক্সপোর্ট ও মুছে ফেলা <Link href="/dashboard/ai" className="font-semibold underline" onClick={() => setOpen(false)}>পূর্ণ AI পেজে</Link> করা যায়।
      </p>
    </div>
  );

  if (onAiPage) return null;

  return (
    <>
      {!open && selBubble ? (
        <button
          type="button"
          className="ga-ask-bubble"
          style={{ left: selBubble.x, top: selBubble.y }}
          onClick={askAboutSelection}
        >✦ AI-কে জিজ্ঞেস করুন</button>
      ) : null}
      {!open ? (
        <button
          type="button"
          className="ga-fab"
          onClick={() => setOpen(true)}
          aria-label="AI Assistant খুলুন (Ctrl+J)"
          title="AI Assistant — Ctrl/⌘+J"
        >
          <span className="text-xl leading-none" aria-hidden="true">✦</span>
          <span className="hidden text-sm font-bold sm:inline">AI সাহায্য</span>
          {pendingBadgeLabel(pendingCount) ? (
            <span className="ga-fab-badge" title="অপেক্ষমাণ প্রস্তাব">{pendingBadgeLabel(pendingCount)}</span>
          ) : null}
        </button>
      ) : null}

      {open ? (
        <div className="ga-backdrop" onClick={() => setOpen(false)}>
          <section
            className="ga-panel fade-rise"
            role="dialog"
            aria-label="AI Assistant"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="ga-head">
              <span className="ai3-orb !h-10 !w-10 !rounded-2xl text-lg" aria-hidden="true">✦</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold leading-tight">{assistantName || "AI Assistant"}</p>
                <p className="truncate text-[11.5px] text-white/80">
                  📍 এখন: {pageLabel}
                  {provider === "dev-template" ? " · ⚠ Dev Template Mode" : provider ? ` · LLM: ${provider}` : ""}
                </p>
                <select className="ga-persona-select" value={personaSel} onChange={(e) => void changePersona(e.target.value)} aria-label="Persona">
                  {PERSONAS_UI.map((p) => <option key={p.id} value={p.id}>{p.icon} {p.labelBn}</option>)}
                </select>
              </div>
              {view === "history" ? (
                <button type="button" className="ga-head-btn" onClick={() => setView("chat")} title="চ্যাটে ফিরুন">← চ্যাট</button>
              ) : (
                <>
                  <button type="button" className="ga-head-btn" onClick={() => { setView("history"); void loadConversations(histSearch); }} title="কথোপকথনের ইতিহাস">🕘 ইতিহাস</button>
                  <button type="button" className="ga-head-btn" onClick={() => void newConversation().catch(() => undefined)} title="নতুন কথোপকথন">+ নতুন</button>
                </>
              )}
              <Link href="/dashboard/ai" className="ga-head-btn" title="পূর্ণ AI পেজ খুলুন" onClick={() => setOpen(false)}>পূর্ণ পেজ ↗</Link>
              <button type="button" className="ga-head-btn" onClick={() => setOpen(false)} aria-label="বন্ধ করুন">✕</button>
            </div>

            {/* Messages / History (GV1) */}
            <div className="ga-body">
              {view === "history" ? historyBody : (<>
              {briefing ? (
                <div className="ai3-prop-card">
                  <div className="flex items-center gap-2">
                    <span aria-hidden="true">🌅</span>
                    <p className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900">{briefing.title}</p>
                    {!briefing.readAt ? <span className="badge badge-brand">নতুন</span> : null}
                  </div>
                  {briefing.body ? (
                    briefingExpanded ? (
                      <div className="mt-1.5 text-sm leading-6 text-slate-600"><Markdown text={briefing.body} /></div>
                    ) : (
                      <>
                        <p className="mt-1 text-sm leading-6 text-slate-600">{briefing.body.slice(0, 220)}{briefing.body.length > 220 ? "…" : ""}</p>
                        <button type="button" className="mt-1 text-[13px] font-bold text-brand-600 hover:underline" onClick={() => expandBriefing()}>পুরোটা পড়ুন →</button>
                      </>
                    )
                  ) : null}
                </div>
              ) : null}
              {pendingProposals.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">অপেক্ষমাণ প্রস্তাব ({pendingProposals.length})</p>
                    {pendingProposals.length >= 2 ? (
                      <button type="button" className="ai3-act-btn" disabled={Boolean(propBusy)} onClick={() => void approveAllPending()}>সব অনুমোদন</button>
                    ) : null}
                  </div>
                  {propNotice ? <p className="alert alert-amber text-[13px]">{propNotice}</p> : null}
                  {pendingProposals.map((pr) => (
                    <div key={pr.id} className="ai3-prop-card">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-900">{pr.title}</span>
                        <span className="badge badge-amber">{pr.status}</span>
                      </div>
                      <p className="mt-1 text-[13px] leading-6 text-slate-600">{pr.preview}</p>
                      <div className="mt-2 flex gap-2">
                        <button type="button" className="btn-primary btn-sm" disabled={propBusy === pr.id} onClick={() => void decideProposal(pr, "approve")}>অনুমোদন দিন</button>
                        <button type="button" className="btn-secondary btn-sm" disabled={propBusy === pr.id} onClick={() => void decideProposal(pr, "reject")}>প্রত্যাখ্যান</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : propNotice ? <p className="alert alert-amber text-[13px]">{propNotice}</p> : null}
              {error ? <p className="alert alert-red" role="alert">⚠ {error}</p> : null}
              {notice ? <p className="alert alert-amber">{notice}</p> : null}

              {messages.length === 0 && !streaming ? (
                <div className="space-y-3 py-1">
                  <p className="text-sm leading-6 text-slate-500">
                    যেকোনো পেজ থেকে জিজ্ঞেস করুন — উত্তর শুধু যাচাইকৃত ডেটা থেকে আসে। আপনি এখন <b>{pageLabel}</b> পেজে আছেন, তাই এই পেজের প্রসঙ্গ উত্তর বুঝতে সাহায্য করবে।
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {starters.map((s) => (
                      <button key={s} type="button" className="ai3-follow-chip" onClick={() => send(s)}>{s}</button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((m) => m.role === "user" ? (
                    <div key={m.id} className="flex items-start justify-end gap-2">
                      <div className="ai3-bubble-user !max-w-[88%]">
                        <p className="text-sm leading-6">{m.content}</p>
                        {m.attachmentName ? <AiMessageAttachment name={m.attachmentName} kind={m.attachmentKind ?? "file"} text={m.attachmentText} /> : null}
                      </div>
                    </div>
                  ) : (
                    <div key={m.id} className="flex items-start gap-2">
                      <span className="ai3-avatar ai3-avatar-ai !h-8 !w-8 text-[13px]" aria-hidden="true">✦</span>
                      <div className="ai3-bubble-ai min-w-0 flex-1 !max-w-none">
                        <Markdown text={m.content} />
                        <AiRichAnswer toolCalls={m.toolCalls} />
                        <AiToolTransparency toolCalls={m.toolCalls} />
                      </div>
                    </div>
                  ))}
                  {streaming ? (
                    <div className="flex items-start gap-2">
                      <span className="ai3-avatar ai3-avatar-ai !h-8 !w-8 text-[13px]" aria-hidden="true">✦</span>
                      <div className="ai3-bubble-ai min-w-0 flex-1 !max-w-none">
                        {streaming.steps.map((s, i) => (
                          <p key={i} className="ai-step-row">
                            <span className="ai-step-dot" />
                            {s.phase === "planning" ? "পরিকল্পনা চলছে…" : `টুল চলছে… ${s.tool ?? ""}`}
                          </p>
                        ))}
                        {streaming.text ? (
                          <div className="ai-stream-caret mt-1"><Markdown text={streaming.text} /></div>
                        ) : (
                          <span className="ai3-typing" aria-label="ভাবছি"><span /><span /><span /></span>
                        )}
                      </div>
                    </div>
                  ) : null}
                </>
              )}

              {followUps.length > 0 && !sending ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold text-slate-400">এরপর:</span>
                  {followUps.map((s) => (
                    <button key={s} type="button" className="ai3-follow-chip" onClick={() => send(s)}>{s}</button>
                  ))}
                </div>
              ) : null}
              <div ref={bottomRef} />
              </>)}
            </div>

            {/* Composer (chat view only) */}
            {view === "chat" ? (
            <div className="ga-composer">
              <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
                <textarea
                  className="ai3-textarea"
                  rows={1}
                  autoFocus
                  placeholder="বাংলা বা ইংরেজিতে জিজ্ঞেস করুন..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
                />
                {sending ? (
                  <button type="button" className="ai3-stop-btn !min-h-[40px] !min-w-[56px] !px-3 text-[13px]" onClick={() => stopStreaming()}>■ থামান</button>
                ) : (
                  <button type="submit" className="ai3-send-btn !min-h-[40px] !min-w-[48px] !px-4 text-[13px]" disabled={!input.trim()}>পাঠান ➤</button>
                )}
              </form>
              {pendingAttachment ? (
                <div className="mx-2 mb-1 flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  <span className="min-w-0 flex-1 truncate">{pendingAttachment.kind === "image" ? "🖼️" : "📎"} {pendingAttachment.name}{pendingAttachment.truncated ? " (আংশিক)" : ""}</span>
                  <button type="button" aria-label="সংযুক্তি সরান" onClick={() => setPendingAttachment(null)}>✕</button>
                </div>
              ) : null}
              <input ref={fileInputRef} type="file" accept={ATTACHMENT_ACCEPT} className="hidden" onChange={(e) => { void onAttachFile(e.target.files?.[0]); e.target.value = ""; }} />
              {mentionRef ? (
                <div className="mx-2 mb-1 flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
                  <span className="min-w-0 flex-1 truncate">📌 সংযুক্ত রেকর্ড: {mentionRef.label}</span>
                  <button type="button" aria-label="রেকর্ড সরান" onClick={() => setMentionRef(null)}>✕</button>
                </div>
              ) : null}
              {mentionOpen ? (
                <MentionPicker
                  items={mentionSearch.items}
                  loading={mentionSearch.loading}
                  onPick={pickMention}
                  onDismiss={() => setMentionDismissedFor(input)}
                />
              ) : null}
              {pickerOpen ? (
                <PromptPicker
                  saved={promptsLib.saved}
                  query={input.slice(1)}
                  onPick={(body) => setInput(body)}
                  onDismiss={() => setPickerDismissedFor(input)}
                  onRenameSaved={renameSavedPrompt}
                  onDeleteSaved={deleteSavedPrompt}
                />
              ) : null}
              <div className="flex flex-wrap items-center gap-2 px-2 pb-0.5 pt-1.5">
                <p className="min-w-0 flex-1 text-[10.5px] text-slate-400"><span className="kbd">Enter</span> পাঠান · <span className="kbd">/</span> prompt লাইব্রেরি · <span className="kbd">Esc</span> বন্ধ</p>
                <button type="button" className="ai3-act-btn" disabled={attaching} title="ফাইল বা ছবি সংযুক্ত করুন (.txt, .md, .csv, .pdf, .docx, ছবি)" onClick={() => fileInputRef.current?.click()}>{attaching ? "…" : "📎"}</button>
                {voice.supported ? (
                  <span className="inline-flex items-center gap-1">
                    <button type="button" className="ai3-act-btn" title="ভয়েসে লিখুন (বাংলা/English)" onClick={() => (voice.listening ? voice.stop() : voice.start(input))}>{voice.listening ? "🔴 শুনছি…" : "🎤"}</button>
                    <button type="button" className="ai3-act-btn" title="ভয়েসের ভাষা বদলান" onClick={() => voice.setLang(voice.lang === "bn-BD" ? "en-US" : "bn-BD")}>{voice.lang === "bn-BD" ? "বাং" : "EN"}</button>
                  </span>
                ) : null}
              {tts.supported ? (
                <button type="button" className="ai3-act-btn" title="উত্তর পড়ে শোনান (voice-first)" onClick={() => tts.setEnabled(!tts.enabled)}>{tts.enabled ? "🔊 শোনা চালু" : "🔇"}</button>
              ) : null}
                {input.trim() && !input.startsWith("/") ? (
                  <button type="button" className="ai3-act-btn" onClick={() => void saveCurrentAsPrompt()}>＋ Prompt হিসেবে save</button>
                ) : null}
                {promptNote ? <span className="text-[10.5px] font-semibold text-emerald-600">{promptNote}</span> : null}
              </div>
            </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
