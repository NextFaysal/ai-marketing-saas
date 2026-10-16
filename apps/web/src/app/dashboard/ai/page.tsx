"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { Markdown } from "@/components/markdown";
import { streamAiMessage, type AiStreamToolCall } from "@/lib/ai-stream";
import { AiRichAnswer, AiToolTransparency } from "@/components/ai-rich";
import { STARTER_PROMPTS, useSavedPrompts, type SavedPrompt } from "@/lib/ai-prompts";
import { PromptPicker } from "@/components/prompt-picker";
import { applyMention, mentionQueryOf, useMentionSearch, type MentionItem, type MentionRef } from "@/lib/mentions";
import { MentionPicker } from "@/components/mention-picker";
import { ATTACHMENT_ACCEPT, uploadChatAttachment, type ChatAttachment } from "@/lib/attachments";
import { useVoiceInput } from "@/lib/voice-input";
import { useSpeechOutput } from "@/lib/voice-output";
import { PERSONAS_UI, personaLabel } from "@/lib/personas";
import { AiMessageAttachment } from "@/components/ai-rich";
import { MediaBuyerAdvisor } from "./media-buyer-advisor";

interface Conversation { id: string; title?: string | null; updatedAt: string; pinnedAt?: string | null; tags?: string[]; persona?: string }
interface Proposal { id: string; type: string; title: string; preview: string; status: string; error?: string | null; createdAt: string }
interface ProposalTargets { campaigns: { id: string; name: string; metaStatus?: string | null }[]; adSets: { id: string; name: string; planId: string; planName: string }[] }
interface Message { id: string; role: string; content: string; toolCalls?: AiStreamToolCall[] | null; attachmentName?: string | null; attachmentKind?: string | null; attachmentText?: string | null }
interface StreamStep { phase: "planning" | "tool"; tool?: string }

// GV3: the suggestion texts are the canonical STARTER_PROMPTS
// (lib/ai-prompts.ts) — the API planner spec proves each maps to a
// real tool. Icons stay local, paired by position.
const SUGGESTION_ICONS = ["📊", "📣", "🔔", "⚠️", "💰", "👥", "📦", "🚚", "🌐"];
const SUGGESTIONS: { icon: string; text: string }[] = STARTER_PROMPTS.map((text, i) => ({ icon: SUGGESTION_ICONS[i] ?? "✦", text }));

export default function AiAssistantPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [provider, setProvider] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [targets, setTargets] = useState<ProposalTargets>({ campaigns: [], adSets: [] });
  // AP2 org-memory visibility: what the assistant can actually
  // answer from (Business Brain completeness + profile) — real
  // server data only; nothing is "learned" silently.
  const [memoryInfo, setMemoryInfo] = useState<{ percent: number; sections: { key: string; labelBn: string; done: boolean; missingBn: string }[]; counts: { faq: number; documents: number; products: number; policies: number } } | null>(null);
  const [profileInfo, setProfileInfo] = useState<{ hasInstructions: boolean; replyLanguage: string | null } | null>(null);
  // AP7: Assistant API keys (OWNER/ADMIN only — the panel hides
  // itself when the list call is forbidden).
  const [apiKeys, setApiKeys] = useState<{ id: string; name: string; keyPrefix: string; lastUsedAt: string | null; revokedAt: string | null; createdAt: string }[] | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState("");
  const [keyNotice, setKeyNotice] = useState("");
  const loadApiKeys = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      setApiKeys(await apiFetch(`/organizations/${orgId}/ai/api-keys`));
    } catch { setApiKeys(null); }
  }, []);
  useEffect(() => { loadApiKeys(); }, [loadApiKeys]);
  async function createApiKey() {
    const orgId = getOrganizationId();
    if (!orgId || !newKeyName.trim()) return;
    try {
      const out = await apiFetch<{ key: string }>(`/organizations/${orgId}/ai/api-keys`, { method: "POST", body: JSON.stringify({ name: newKeyName.trim() }) });
      setCreatedKey(out.key);
      setNewKeyName("");
      setKeyNotice("");
      await loadApiKeys();
    } catch (e) { setKeyNotice(e instanceof Error ? e.message : "Key তৈরি ব্যর্থ হয়েছে"); }
  }
  async function revokeApiKey(id: string) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    if (!window.confirm("এই API key revoke করবেন? এটি দিয়ে আর কোনো কল চলবে না।")) return;
    try {
      await apiFetch(`/organizations/${orgId}/ai/api-keys/${id}`, { method: "DELETE" });
      await loadApiKeys();
    } catch (e) { setKeyNotice(e instanceof Error ? e.message : "Revoke ব্যর্থ হয়েছে"); }
  }

  // AP6: assistant task inbox aggregate.
  const [taskInbox, setTaskInbox] = useState<{ pendingProposals: number; unansweredOpen: number; radar: string[]; briefingToday: boolean } | null>(null);
  // AP7: persona of the active conversation (server-scoped tools).
  const [pendingPersona, setPendingPersona] = useState("general");
  const activePersona = conversations.find((c) => c.id === activeId)?.persona ?? "general";
  async function changePersona(persona: string) {
    if (!orgId) return;
    if (activeId) {
      await patchConversation(activeId, { persona });
    } else {
      setPendingPersona(persona);
    }
  }
  const [propKind, setPropKind] = useState<"pause_campaign" | "pause_ad_set" | "create_broadcast_draft">("pause_campaign");
  const [propTarget, setPropTarget] = useState("");
  const [propDraft, setPropDraft] = useState({ name: "", channel: "email", subject: "", body: "" });
  const [propNotice, setPropNotice] = useState("");
  const [proactive, setProactive] = useState({ briefingEnabled: true, anomalyAlertsEnabled: true, dailyReportEmailEnabled: false, telegramBriefEnabled: false, telegramBriefChatId: "", autonomyLevel: 0, assistantName: "" });
  const [briefingResult, setBriefingResult] = useState("");
  // AP1 Design v2: streaming bubble state + this-session usage totals
  // (sums of the done events' usage only — real data this page holds).
  const [streaming, setStreaming] = useState<{ text: string; steps: StreamStep[] } | null>(null);
  const [sessionUsage, setSessionUsage] = useState({ count: 0, inputTokens: 0, outputTokens: 0, estimated: false });
  const [convLoading, setConvLoading] = useState(true);
  // GV3 (G4): "/" prompt picker over the per-user saved library.
  const promptsLib = useSavedPrompts();
  const [pickerDismissedFor, setPickerDismissedFor] = useState<string | null>(null);
  const [promptNote, setPromptNote] = useState("");
  // G6: @-mention — one attached record per message.
  const [mentionRef, setMentionRef] = useState<MentionRef | null>(null);
  const [mentionDismissedFor, setMentionDismissedFor] = useState<string | null>(null);
  // AP2: one pending attachment per message (processed server-side).
  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null);
  const [attaching, setAttaching] = useState(false);
  // AP2: voice dictation (browser speech recognition, BN/EN).
  const voice = useVoiceInput((text) => setInput(text));
  // AP7: voice-first read-aloud (browser TTS, toggle persisted).
  const tts = useSpeechOutput("ai-page-tts");
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
  const [msgLoading, setMsgLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamConvRef = useRef<string>("");
  const streamTextRef = useRef<string>("");

  const orgId = typeof window !== "undefined" ? getOrganizationId() : null;

  const loadConversations = useCallback(async (q?: string) => {
    const id = getOrganizationId(); if (!id) return;
    try {
      const query = q?.trim() ? `?search=${encodeURIComponent(q.trim())}` : "";
      setConversations(await apiFetch<Conversation[]>(`/organizations/${id}/ai/chat/conversations${query}`));
    } catch { /* a fresh account simply has none */ }
    finally { setConvLoading(false); }
  }, []);

  const loadMessages = useCallback(async (convId: string) => {
    const id = getOrganizationId(); if (!id || !convId) return;
    setMsgLoading(true);
    try { setMessages(await apiFetch<Message[]>(`/organizations/${id}/ai/chat/conversations/${convId}/messages`)); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load messages"); }
    finally { setMsgLoading(false); }
  }, []);

  const loadTaskInbox = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      setTaskInbox(await apiFetch(`/organizations/${orgId}/ai/task-inbox`));
    } catch { /* best-effort card */ }
  }, []);
  useEffect(() => { loadTaskInbox(); }, [loadTaskInbox]);

  const loadMemory = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const [comp, prof] = await Promise.all([
        apiFetch<any>(`/organizations/${orgId}/business-profile/completeness`),
        apiFetch<any>(`/organizations/${orgId}/business-profile`).catch(() => null),
      ]);
      if (comp && Array.isArray(comp.sections)) setMemoryInfo(comp);
      if (prof) setProfileInfo({ hasInstructions: Boolean(String(prof.aiInstructions ?? "").trim()), replyLanguage: prof.aiReplyLanguage ?? null });
    } catch { /* memory card is best-effort */ }
  }, []);
  useEffect(() => { loadMemory(); }, [loadMemory]);

  const loadProposals = useCallback(async () => {
    const id = getOrganizationId(); if (!id) return;
    try {
      setProposals(await apiFetch<Proposal[]>(`/organizations/${id}/ai/proposals`));
      setTargets(await apiFetch<ProposalTargets>(`/organizations/${id}/ai/proposals/targets`));
    } catch { /* proposals are additive; a fresh org simply has none */ }
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);
  useEffect(() => { loadProposals(); }, [loadProposals]);
  useEffect(() => {
    const id = getOrganizationId(); if (!id) return;
    apiFetch<{ briefingEnabled: boolean; anomalyAlertsEnabled: boolean; dailyReportEmailEnabled: boolean; telegramBriefEnabled: boolean; telegramBriefChatId: string | null; autonomyLevel: number; assistantName: string | null }>(`/organizations/${id}/ai/proactive/settings`).then((s) => setProactive({ ...s, telegramBriefChatId: s.telegramBriefChatId ?? "", assistantName: s.assistantName ?? "" })).catch(() => undefined);
  }, []);

  async function toggleProactive(key: "briefingEnabled" | "anomalyAlertsEnabled" | "dailyReportEmailEnabled", value: boolean) {
    if (!orgId) return;
    const next = { ...proactive, [key]: value };
    setProactive(next);
    try { setProactive(await apiFetch(`/organizations/${orgId}/ai/proactive/settings`, { method: "PATCH", body: JSON.stringify({ [key]: value }) })); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  // AP7: assistant identity + autonomy saves.
  async function saveAssistantIdentity() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const saved = await apiFetch<any>(`/organizations/${orgId}/ai/proactive/settings`, {
        method: "PATCH",
        body: JSON.stringify({ assistantName: proactive.assistantName }),
      });
      setProactive((prev) => ({ ...prev, ...saved, telegramBriefChatId: saved.telegramBriefChatId ?? "", assistantName: saved.assistantName ?? "" }));
    } catch { /* keep local state */ }
  }
  async function saveAutonomy(on: boolean) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    if (on && !window.confirm("Autonomy Level 2 চালু করবেন? Quick reply সেভ ও CRM ফলো-আপ টাস্ক অনুমোদন ছাড়াই কার্যকর হবে (শুধু এই দুই অভ্যন্তরীণ ধরন)।")) return;
    try {
      const saved = await apiFetch<any>(`/organizations/${orgId}/ai/proactive/settings`, {
        method: "PATCH",
        body: JSON.stringify({ autonomyLevel: on ? 2 : 0 }),
      });
      setProactive((prev) => ({ ...prev, ...saved, telegramBriefChatId: saved.telegramBriefChatId ?? "", assistantName: saved.assistantName ?? "" }));
    } catch { /* keep local state */ }
  }

  // AP6: telegram brief settings (toggle + chat id saved together).
  async function saveTelegram(nextEnabled: boolean, nextChatId: string) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    const next = { ...proactive, telegramBriefEnabled: nextEnabled, telegramBriefChatId: nextChatId };
    setProactive(next);
    try {
      const saved = await apiFetch<any>(`/organizations/${orgId}/ai/proactive/settings`, {
        method: "PATCH",
        body: JSON.stringify({ telegramBriefEnabled: nextEnabled, telegramBriefChatId: nextChatId }),
      });
      setProactive({ ...saved, telegramBriefChatId: saved.telegramBriefChatId ?? "" });
    } catch { /* keep local state; server unchanged */ }
  }

  async function runBriefingNow() {
    if (!orgId) return;
    try {
      const res = await apiFetch<{ briefings?: number; anomalyAlerts?: number; skipped?: string }>(`/organizations/${orgId}/ai/proactive/run-now`, { method: "POST", body: JSON.stringify({}) });
      setBriefingResult(res.skipped ? `চালানো হয়নি: ${res.skipped}` : `পাঠানো হয়েছে — ব্রিফিং ${res.briefings ?? 0}টি, anomaly alert ${res.anomalyAlerts ?? 0}টি (আজ আগেই পাঠিয়ে থাকলে dedupe-এ ০ দেখাবে)। নোটিফিকেশন বেলে দেখুন।`);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  // AP5: bulk approval — one confirm, per-item results verbatim.
  async function approveAllProposals() {
    const ids = proposals.filter((x) => x.status === "proposed").map((x) => x.id);
    if (ids.length < 2) return;
    if (!window.confirm(`${ids.length}টি অপেক্ষমাণ প্রস্তাবের সবগুলো অনুমোদন দেবেন? প্রতিটির ফলাফল আলাদাভাবে জানানো হবে।`)) return;
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const out = await apiFetch<{ results: { id: string; status: string; error?: string }[]; executed: number; failed: number }>(
        `/organizations/${orgId}/ai/proposals/bulk-approve`, { method: "POST", body: JSON.stringify({ ids }) });
      const failures = out.results.filter((r) => r.status !== "executed");
      setPropNotice(failures.length === 0
        ? `সবগুলো প্রস্তাব কার্যকর হয়েছে (${out.executed}টি)।`
        : `${out.executed}টি কার্যকর হয়েছে; ${failures.length}টি হয়নি: ${failures.map((f) => f.error ?? f.status).join(" · ")}`);
      await loadProposals();
    } catch (e) { setPropNotice(e instanceof Error ? e.message : "Bulk অনুমোদন ব্যর্থ হয়েছে"); }
  }

  // AP7: copy a signed one-time approval link (e.g. for Telegram).
  async function copyApprovalLink(p: Proposal) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const out = await apiFetch<{ url: string; expiresAt: string }>(`/organizations/${orgId}/ai/proposals/${p.id}/approval-link`, { method: "POST", body: JSON.stringify({}) });
      await navigator.clipboard?.writeText(out.url).catch(() => undefined);
      setPropNotice(`অনুমোদন লিংক কপি হয়েছে — মেয়াদ শেষ: ${new Date(out.expiresAt).toLocaleString("bn-BD")}। লিংকটি যার কাছেই যাক, সিদ্ধান্ত OWNER হিসেবে রেকর্ড হবে; একবার সিদ্ধান্ত হলেই লিংক অকেজো।`);
    } catch (e) { setPropNotice(e instanceof Error ? e.message : "লিংক তৈরি ব্যর্থ হয়েছে"); }
  }

  async function decideProposal(p: Proposal, action: "approve" | "reject") {
    if (!orgId) return;
    if (action === "approve" && !window.confirm(`${p.preview}\n\nআপনি কি সত্যিই অনুমোদন দিচ্ছেন?`)) return;
    setPropNotice("");
    try {
      const updated = await apiFetch<Proposal>(`/organizations/${orgId}/ai/proposals/${p.id}/${action}`, { method: "POST", body: JSON.stringify({}) });
      if (updated.status === "failed") setPropNotice(`প্রস্তাবটি ব্যর্থ হিসেবে রেকর্ড হয়েছে: ${updated.error ?? "platform error"}`);
      await loadProposals();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  async function createProposal() {
    if (!orgId) return;
    try {
      const body: Record<string, unknown> = propKind === "create_broadcast_draft"
        ? { type: propKind, name: propDraft.name, channel: propDraft.channel, subject: propDraft.subject || undefined, body: propDraft.body, audienceType: "customers" }
        : { type: propKind, ...(propKind === "pause_campaign" ? { planId: propTarget } : { adSetId: propTarget }) };
      await apiFetch(`/organizations/${orgId}/ai/proposals`, { method: "POST", body: JSON.stringify(body) });
      setPropNotice("প্রস্তাব তৈরি হয়েছে — অনুমোদন ছাড়া কিছুই করা হয়নি।");
      await loadProposals();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }
  useEffect(() => {
    const t = setTimeout(() => loadConversations(search), 300);
    return () => clearTimeout(t);
  }, [search, loadConversations]);
  useEffect(() => { if (activeId) loadMessages(activeId); }, [activeId, loadMessages]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending, streaming]);

  async function newConversation(): Promise<string | null> {
    if (!orgId) return null;
    const conv = await apiFetch<Conversation>(`/organizations/${orgId}/ai/chat/conversations`, { method: "POST", body: JSON.stringify({ persona: pendingPersona }) });
    setFollowUps([]);
    await loadConversations(search);
    setActiveId(conv.id);
    setMessages([]);
    return conv.id;
  }

  async function patchConversation(id: string, patch: { title?: string; pinned?: boolean; persona?: string }) {
    if (!orgId) return;
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/ai/chat/conversations/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      await loadConversations(search);
    } catch (e) { setError(e instanceof Error ? e.message : "আপডেট করা যায়নি"); }
  }

  async function renameConversation(c: Conversation) {
    const title = window.prompt("কথোপকথনের নতুন নাম লিখুন:", c.title ?? "");
    if (title === null) return;
    if (!title.trim()) { setError("নাম খালি রাখা যাবে না"); return; }
    await patchConversation(c.id, { title: title.trim() });
  }

  async function deleteConversation(c: Conversation) {
    if (!orgId) return;
    if (!window.confirm(`“${c.title ?? "নতুন কথোপকথন"}” মুছে ফেলবেন? সব মেসেজ মুছে যাবে।`)) return;
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/ai/chat/conversations/${c.id}`, { method: "DELETE" });
      if (activeId === c.id) { setActiveId(""); setMessages([]); setFollowUps([]); }
      await loadConversations(search);
    } catch (e) { setError(e instanceof Error ? e.message : "মুছে ফেলা যায়নি"); }
  }

  async function exportConversation(c: Conversation, format: "json" | "markdown") {
    if (!orgId) return;
    setError("");
    try {
      const res = await apiFetch<{ filename: string; content: string }>(
        `/organizations/${orgId}/ai/chat/conversations/${c.id}/export?format=${format}`);
      const blob = new Blob([res.content], { type: format === "json" ? "application/json" : "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = res.filename; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setError(e instanceof Error ? e.message : "এক্সপোর্ট করা যায়নি"); }
  }

  // AP1: send() goes through the SSE stream endpoint. The user bubble
  // is optimistic; the assistant bubble streams in; `done` finalizes
  // from its own payload (no loadMessages round-trip). An `error`
  // event means nothing was persisted — the streaming bubble is
  // dropped and the verbatim message shows in the error banner.
  async function send(text: string) {
    const content = text.trim();
    if (!content || sending) return;
    setError(""); setSending(true); setInput(""); setFollowUps([]);
    let convId = activeId;
    try {
      if (!convId) { convId = (await newConversation()) ?? ""; if (!convId) { setSending(false); return; } }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send");
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
    abortRef.current = streamAiMessage(orgId!, convId, content, {
      onStep: (step) => setStreaming((cur) => (cur ? { ...cur, steps: [...cur.steps, step] } : cur)),
      onDelta: (delta) => {
        streamTextRef.current += delta;
        setStreaming((cur) => (cur ? { ...cur, text: cur.text + delta } : cur));
      },
      onDone: (done) => {
        setProvider(done.isRealLlm ? done.provider : "dev-template");
        setSessionUsage((u) => ({
          count: u.count + 1,
          inputTokens: u.inputTokens + (done.usage?.inputTokens ?? 0),
          outputTokens: u.outputTokens + (done.usage?.outputTokens ?? 0),
          estimated: u.estimated || Boolean(done.usage?.estimated),
        }));
        setMessages((m) => [...m, { id: done.messageId, role: "assistant", content: streamTextRef.current, toolCalls: done.toolsUsed }]);
        setStreaming(null);
        setFollowUps(done.suggestions ?? []);
        if (done.proposal) {
          setPropNotice(`একটি প্রস্তাব তৈরি হয়েছে: ${done.proposal.title} — অনুমোদন ছাড়া কিছুই করা হয়নি। নিচের প্রস্তাব প্যানেলে দেখুন।`);
          void loadProposals();
        }
        void loadConversations(search);
        setSending(false);
      },
      onError: (message) => {
        setStreaming(null);
        setError(message);
        setSending(false);
      },
    }, undefined, { entity: sendEntity, attachment: sendAttachment });
  }

  // Stop button: abort the fetch — the server persists any non-empty
  // partial with the stopped marker, so reload the real persisted
  // state instead of guessing what was saved.
  function stopStreaming() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(null);
    setSending(false);
    const convId = streamConvRef.current;
    if (convId) void loadMessages(convId);
    void loadConversations(search);
  }

  const pickerOpen = input.startsWith("/") && pickerDismissedFor !== input && !sending;

  const mentionQuery = mentionQueryOf(input);
  const mentionOpen = !pickerOpen && !!mentionQuery && mentionQuery.query.length >= 1 && mentionDismissedFor !== input && !sending;
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

  const providerBadge = provider === "dev-template"
    ? <span className="ai3-hero-badge ai3-hero-badge-warn">⚠ Dev Template Mode: আসল LLM কনফিগার করা হয়নি</span>
    : provider
      ? <span className="ai3-hero-badge">● LLM: {provider}</span>
      : null;

  const pendingProposals = proposals.filter((p) => p.status === "proposed");
  const recentConversation = conversations.length
    ? conversations.reduce((a, b) => (new Date(b.updatedAt).getTime() > new Date(a.updatedAt).getTime() ? b : a))
    : null;

  const conversationRow = (c: Conversation) => (
    <div key={c.id} className={`ai3-conv ${c.id === activeId ? "ai3-conv-active" : ""}`}>
      <button onClick={() => { setActiveId(c.id); setFollowUps([]); }} className="w-full text-left">
        <span className={`block truncate text-sm ${c.id === activeId ? "font-bold text-slate-900" : "font-medium text-slate-700"}`}>{c.pinnedAt ? "📌 " : ""}{c.title ?? "নতুন কথোপকথন"}</span>
        <span className="mt-0.5 block text-[11px] text-slate-400">{new Date(c.updatedAt).toLocaleDateString()}</span>
      </button>
      {c.tags && c.tags.length > 0 ? (
        <span className="mt-1.5 flex flex-wrap gap-1">
          {c.tags.map((t) => <span key={t} className="ai-tag-chip">{t}</span>)}
        </span>
      ) : null}
      <span className="ai3-conv-actions mt-2 flex flex-wrap gap-1">
        <button className="ai3-act-btn" title={c.pinnedAt ? "আনপিন করুন" : "পিন করুন"} onClick={() => patchConversation(c.id, { pinned: !c.pinnedAt })}>{c.pinnedAt ? "আনপিন" : "পিন"}</button>
        <button className="ai3-act-btn" onClick={() => renameConversation(c)}>নাম বদল</button>
        <button className="ai3-act-btn" onClick={() => exportConversation(c, "markdown")}>MD</button>
        <button className="ai3-act-btn" onClick={() => exportConversation(c, "json")}>JSON</button>
        <button className="ai3-act-btn ai3-act-btn-danger" onClick={() => deleteConversation(c)}>মুছুন</button>
      </span>
    </div>
  );

  const proposalStatusCls = (status: string) => status === "executed"
    ? "bg-emerald-100 text-emerald-700"
    : status === "failed" ? "bg-red-100 text-red-700"
    : status === "rejected" ? "bg-slate-200 text-slate-600"
    : "bg-amber-100 text-amber-700";

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* ── Left rail v3: sticky glass card, brand-active rows ─────── */}
      <div className="ai3-rail hidden w-72 shrink-0 flex-col gap-2 md:flex">
        <button className="btn-primary min-h-[44px] w-full rounded-2xl" onClick={() => newConversation()}>✦ + নতুন কথোপকথন</button>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">🔍</span>
          <input
            className="input pl-9"
            placeholder="কথোপকথন খুঁজুন (নাম বা মেসেজ)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {convLoading && conversations.length === 0 ? (
          <div className="space-y-2" aria-hidden="true">
            <div className="skeleton h-14 w-full" />
            <div className="skeleton h-14 w-full" />
            <div className="skeleton h-14 w-full" />
          </div>
        ) : null}
        {conversations.length === 0 && search.trim() && !convLoading ? <p className="px-1 text-xs text-slate-400">কিছু পাওয়া যায়নি</p> : null}
        {conversations.length === 0 && !search.trim() && !convLoading ? <p className="px-1 py-3 text-center text-xs leading-5 text-slate-400">এখনো কোনো কথোপকথন নেই।<br />নতুন কথোপকথন দিয়ে শুরু করুন।</p> : null}
        <div className="space-y-1">
          {conversations.map(conversationRow)}
        </div>
      </div>

      {/* ── Centre canvas + right context panel ────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col gap-4 xl:flex-row">
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex gap-2 md:hidden">
            <select
              className="input min-w-0 flex-1"
              value={activeId}
              onChange={(e) => { setActiveId(e.target.value); setFollowUps([]); }}
            >
              <option value="">কথোপকথন বেছে নিন...</option>
              {conversations.map((c) => <option key={c.id} value={c.id}>{c.pinnedAt ? "📌 " : ""}{c.title ?? "নতুন কথোপকথন"}</option>)}
            </select>
            <button className="btn-primary btn-sm shrink-0" onClick={() => newConversation()}>+ নতুন</button>
          </div>

          {/* Hero header v3: brand gradient, orb, honest subtitle,
              provider + pending state as glass badges (real state only). */}
          <div className="ai3-hero fade-rise">
            <div className="flex flex-wrap items-start gap-4">
              <span className="ai3-orb" aria-hidden="true">✦</span>
              <div className="min-w-0 flex-1">
                <h1 className="text-[24px] font-bold leading-tight tracking-tight">{proactive.assistantName || "AI Assistant"}</h1>
                <label className="mt-1 flex items-center gap-2 text-xs font-semibold text-slate-500">Persona:
                  <select className="input w-auto py-1 text-xs" value={activeId ? activePersona : pendingPersona} onChange={(e) => void changePersona(e.target.value)}>
                    {PERSONAS_UI.map((p) => <option key={p.id} value={p.id}>{p.icon} {p.labelBn}</option>)}
                  </select>
                </label>
                <p className="mt-1 max-w-2xl text-[13.5px] leading-6 text-white/85">
                  শুধুমাত্র যাচাইকৃত ডেটা দিয়ে উত্তর দেয়। AI নিজে থেকে কিছু বদলায় না — কাজের প্রস্তাব দিতে পারে, কিন্তু অনুমোদন ছাড়া কিছুই হয় না।
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {providerBadge ?? <span className="ai3-hero-badge">● যাচাইকৃত ডেটা-ভিত্তিক উত্তর</span>}
                  {pendingProposals.length > 0 ? <span className="ai3-hero-badge">⏳ {pendingProposals.length}টি প্রস্তাব অনুমোদনের অপেক্ষায়</span> : null}
                  {sessionUsage.count > 0 ? <span className="ai3-hero-badge">এই session-এ {sessionUsage.count}টি উত্তর</span> : null}
                </div>
              </div>
            </div>
          </div>

          {error ? <p className="alert alert-red" role="alert">⚠ {error}</p> : null}

          {/* A3 recap card: real rows only — most recent conversation
              title + the real pending-proposal count. No summary text. */}
          {recentConversation && messages.length === 0 && !activeId ? (
            <div className="ai3-recap">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">শেষ কথোপকথন</p>
                <p className="truncate font-bold text-slate-900">{recentConversation.title ?? "নতুন কথোপকথন"}</p>
                <p className="text-[13px] text-slate-500">Pending প্রস্তাব: {pendingProposals.length}টি</p>
              </div>
              <button className="btn-primary btn-sm" onClick={() => { setActiveId(recentConversation.id); setFollowUps([]); }}>চালিয়ে যান →</button>
            </div>
          ) : null}

          <div className="ai3-canvas min-h-80 space-y-4">
            {msgLoading && messages.length === 0 ? (
              <div className="space-y-3" aria-hidden="true">
                <div className="skeleton h-14 w-3/4" />
                <div className="skeleton ml-auto h-10 w-1/2" />
                <div className="skeleton h-14 w-2/3" />
              </div>
            ) : messages.length === 0 && !streaming ? (
              <div className="fade-rise space-y-4 py-2">
                <div className="text-center">
                  <span className="ai3-orb mx-auto" aria-hidden="true" style={{ backgroundImage: "linear-gradient(135deg, var(--brand-from), var(--brand-to))", color: "#fff" }}>✦</span>
                  <p className="mt-3 text-[17px] font-bold tracking-tight text-slate-900">আজ কী জানতে চান?</p>
                  <p className="mt-1 text-sm text-slate-500">বিক্রি, ক্যাম্পেইন, অর্ডার, স্টক বা কুরিয়ার — যেকোনো একটি দিয়ে শুরু করুন:</p>
                </div>
                <div className="ai3-suggest-grid">
                  {SUGGESTIONS.map((s) => (
                    <button key={s.text} className="ai3-suggest-card" onClick={() => send(s.text)}>
                      <span className="ai3-suggest-icon" aria-hidden="true">{s.icon}</span>
                      <span>{s.text}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((m) => m.role === "user" ? (
                  <div key={m.id} className="fade-rise flex items-start justify-end gap-2.5">
                    <div className="ai3-bubble-user">
                      <p className="text-sm leading-6">{m.content}</p>
                      {m.attachmentName ? <AiMessageAttachment name={m.attachmentName} kind={m.attachmentKind ?? "file"} text={m.attachmentText} /> : null}
                    </div>
                    <span className="ai3-avatar ai3-avatar-user" aria-hidden="true">আ</span>
                  </div>
                ) : (
                  <div key={m.id} className="fade-rise flex items-start gap-2.5">
                    <span className="ai3-avatar ai3-avatar-ai" aria-hidden="true">✦</span>
                    <div className="ai3-bubble-ai min-w-0">
                      <Markdown text={m.content} />
                      <AiRichAnswer toolCalls={m.toolCalls} />
                      <AiToolTransparency toolCalls={m.toolCalls} />
                    </div>
                  </div>
                ))}
                {streaming ? (
                  <div className="fade-rise flex items-start gap-2.5">
                    <span className="ai3-avatar ai3-avatar-ai" aria-hidden="true">✦</span>
                    <div className="ai3-bubble-ai min-w-0">
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
            {sending && !streaming ? <p className="flex items-center gap-2 text-sm text-slate-400"><span className="ai3-typing"><span /><span /><span /></span> ভাবছি...</p> : null}
            <div ref={bottomRef} />
          </div>

          {followUps.length > 0 && !sending ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-400">এরপর জিজ্ঞেস করতে পারেন:</span>
              {followUps.map((s) => (
                <button key={s} className="ai3-follow-chip" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          ) : null}

          {/* Composer v3: sticky floating glass shell, multiline
              textarea (Enter = send, Shift+Enter = newline), gradient
              send / stop. Provider state lives in the hero badges. */}
          <div className="ai3-composer-v3">
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
              <textarea
                className="ai3-textarea"
                rows={1}
                placeholder="বাংলা বা ইংরেজিতে জিজ্ঞেস করুন..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
              />
              {sending ? (
                <button type="button" className="ai3-stop-btn" onClick={() => stopStreaming()}>■ থামান</button>
              ) : (
                <button type="submit" className="ai3-send-btn" disabled={!input.trim()}>পাঠান ➤</button>
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
              <div className="mx-3 mb-1 flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
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
            <div className="flex flex-wrap items-center gap-2 px-3 pb-1 pt-1.5">
              <p className="min-w-0 flex-1 text-[11px] text-slate-400"><span className="kbd">Enter</span> পাঠান · <span className="kbd">Shift</span> + <span className="kbd">Enter</span> নতুন লাইন · <span className="kbd">/</span> prompt লাইব্রেরি · উত্তর শুধু যাচাইকৃত ডেটা থেকে</p>
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
              {promptNote ? <span className="text-[11px] font-semibold text-emerald-600">{promptNote}</span> : null}
            </div>
          </div>

          {/* Predictive AI Media Buyer / Daily Optimization Advisor */}
          <MediaBuyerAdvisor onProposalCreated={loadProposals} />

          {taskInbox && (taskInbox.pendingProposals > 0 || taskInbox.unansweredOpen > 0 || taskInbox.radar.length > 0) ? (
            <div className="ai3-panel space-y-3">
              <div className="flex items-start gap-3">
                <span className="ai3-panel-icon" aria-hidden="true">📥</span>
                <div className="min-w-0 flex-1">
                  <h2 className="section-title">টাস্ক ইনবক্স</h2>
                  <p className="mt-0.5 text-sm leading-6 text-slate-500">যা যা আপনার সিদ্ধান্ত বা মনোযোগ চায় — সব আসল গণনা থেকে।</p>
                </div>
                {taskInbox.briefingToday ? <span className="badge badge-brand">আজকের ব্রিফিং হয়েছে</span> : null}
              </div>
              <div className="flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
                <span className="badge badge-amber">⏳ {taskInbox.pendingProposals}টি প্রস্তাব অপেক্ষমাণ</span>
                <span className="badge badge-slate">❓ {taskInbox.unansweredOpen}টি উত্তর-বাকি প্রশ্ন</span>
              </div>
              {taskInbox.radar.length > 0 ? (
                <ul className="space-y-1.5">
                  {taskInbox.radar.map((line, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-600"><span aria-hidden="true">•</span><span>{line}</span></li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {memoryInfo ? (
            <div className="ai3-panel space-y-3">
              <div className="flex items-start gap-3">
                <span className="ai3-panel-icon" aria-hidden="true">🧠</span>
                <div className="min-w-0 flex-1">
                  <h2 className="section-title">AI যা জানে</h2>
                  <p className="mt-0.5 text-sm leading-6 text-slate-500">Assistant শুধু এই আসল তথ্য থেকেই উত্তর দেয় — নিজে থেকে কিছু শেখে বা বানায় না।</p>
                </div>
                <span className="badge badge-brand">{memoryInfo.percent}% সম্পূর্ণ</span>
              </div>
              <p className="text-xs font-semibold text-slate-500">📦 {memoryInfo.counts.products}টি পণ্য · ❓ {memoryInfo.counts.faq}টি FAQ · 📄 {memoryInfo.counts.documents}টি ডকুমেন্ট · 📜 {memoryInfo.counts.policies}টি নীতি</p>
              <ul className="space-y-1.5">
                {memoryInfo.sections.map((s) => (
                  <li key={s.key} className="flex items-start gap-2 text-sm">
                    <span aria-hidden="true">{s.done ? "✅" : "⚪"}</span>
                    <span className="min-w-0">
                      <span className="font-semibold text-slate-700">{s.labelBn}</span>
                      {!s.done ? <span className="block text-xs leading-5 text-slate-400">{s.missingBn}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-slate-600">
                {profileInfo?.hasInstructions ? "✅ কাস্টম AI নির্দেশনা সেট করা আছে" : "⚪ কাস্টম AI নির্দেশনা নেই"}
                {profileInfo?.replyLanguage ? <span className="text-slate-400"> · উত্তরের ভাষা: {profileInfo.replyLanguage === "bn" ? "বাংলা" : profileInfo.replyLanguage === "en" ? "English" : profileInfo.replyLanguage}</span> : null}
              </p>
              <div className="flex flex-wrap gap-2">
                <Link className="btn btn-secondary btn-sm" href="/dashboard/knowledge">Knowledge পেজ</Link>
                <Link className="btn btn-secondary btn-sm" href="/dashboard/ai-instructions">AI নির্দেশনা</Link>
                <Link className="btn btn-secondary btn-sm" href="/dashboard/settings">Business সেটিংস</Link>
              </div>
            </div>
          ) : null}

          <div className="ai3-panel space-y-4" id="ai-proposals">
            <div className="flex items-start gap-3">
              <span className="ai3-panel-icon" aria-hidden="true">✅</span>
              <div>
                <h2 className="section-title">কার্যক্রমের প্রস্তাব (অনুমোদন লাগবে)</h2>
                <p className="mt-0.5 text-sm leading-6 text-slate-500">প্রস্তাব তৈরি হলেই কিছু হয় না। অনুমোদন দিলে তবেই আসল কাজটি হয় — ক্যাম্পেইন pause হলে Meta-র নিশ্চিতকরণ লাগে, broadcast শুধু draft তৈরি হয়, কখনো নিজে থেকে পাঠানো হয় না।</p>
              </div>
            </div>
            {propNotice ? <p className="alert alert-amber">{propNotice}</p> : null}
            <div className="flex flex-wrap items-end gap-2 rounded-2xl bg-slate-50/80 p-3 ring-1 ring-inset ring-slate-200/60">
              <label className="text-sm font-medium text-slate-600">ধরন
                <select className="input ml-2 w-auto" value={propKind} onChange={(e) => { setPropKind(e.target.value as typeof propKind); setPropTarget(""); }}>
                  <option value="pause_campaign">ক্যাম্পেইন Pause</option>
                  <option value="pause_ad_set">Ad Set Pause</option>
                  <option value="create_broadcast_draft">Broadcast Draft তৈরি</option>
                </select>
              </label>
              {propKind !== "create_broadcast_draft" ? (
                <label className="text-sm font-medium text-slate-600">লক্ষ্য
                  <select className="input ml-2 w-auto min-w-52" value={propTarget} onChange={(e) => setPropTarget(e.target.value)}>
                    <option value="">— বেছে নিন —</option>
                    {propKind === "pause_campaign"
                      ? targets.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}{c.metaStatus ? ` (${c.metaStatus})` : ""}</option>)
                      : targets.adSets.map((a) => <option key={a.id} value={a.id}>{a.planName} / {a.name}</option>)}
                  </select>
                </label>
              ) : (
                <>
                  <input className="input w-auto" placeholder="Draft-এর নাম" value={propDraft.name} onChange={(e) => setPropDraft({ ...propDraft, name: e.target.value })} />
                  <select className="input w-auto" value={propDraft.channel} onChange={(e) => setPropDraft({ ...propDraft, channel: e.target.value })}>
                    <option value="email">Email</option>
                    <option value="sms">SMS</option>
                  </select>
                  {propDraft.channel === "email" ? <input className="input w-auto" placeholder="Subject" value={propDraft.subject} onChange={(e) => setPropDraft({ ...propDraft, subject: e.target.value })} /> : null}
                  <input className="input min-w-52 flex-1" placeholder="Message body" value={propDraft.body} onChange={(e) => setPropDraft({ ...propDraft, body: e.target.value })} />
                </>
              )}
              <button className="btn-primary btn-sm min-h-[40px]" onClick={() => createProposal()}>প্রস্তাব তৈরি করুন</button>
            </div>
            {proposals.filter((x) => x.status === "proposed").length >= 2 ? (
              <div className="flex justify-end">
                <button className="btn-primary btn-sm" onClick={() => void approveAllProposals()}>সব অনুমোদন করুন ({proposals.filter((x) => x.status === "proposed").length}টি)</button>
              </div>
            ) : null}
            <div className="space-y-2">
              {proposals.length === 0 ? <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-400 ring-1 ring-inset ring-slate-200/60">কোনো প্রস্তাব নেই। চ্যাটে কোনো published ক্যাম্পেইনের নাম ধরে “pause করে দাও” বললেও প্রস্তাব তৈরি হবে।</p> : proposals.map((p) => (
                <div key={p.id} className="ai3-prop-card">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">{p.title}</span>
                    <span className={`badge ${proposalStatusCls(p.status)}`}>{p.status}</span>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{p.preview}</p>
                  {p.error ? <p className="mt-1 text-sm text-red-600">ত্রুটি: {p.error}</p> : null}
                  {p.status === "proposed" ? (
                    <div className="mt-2.5 flex gap-2">
                      <button className="btn-primary btn-sm" onClick={() => decideProposal(p, "approve")}>অনুমোদন দিন</button>
                      <button className="btn-secondary btn-sm" onClick={() => decideProposal(p, "reject")}>প্রত্যাখ্যান</button>
                      <button className="btn-secondary btn-sm" title="Telegram-এ পাঠানোর মতো signed লিংক কপি করুন" onClick={() => void copyApprovalLink(p)}>🔗 লিংক</button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right context panel v3 (stacked below canvas on mobile) ── */}
        <aside className="w-full shrink-0 space-y-4 xl:w-80">
          <div className="ai3-panel space-y-3">
            <div className="flex items-center gap-3">
              <span className="ai3-panel-icon" aria-hidden="true">⏳</span>
              <h2 className="section-title flex-1">অপেক্ষমাণ প্রস্তাব</h2>
              <span className="conv-unread">{pendingProposals.length}</span>
            </div>
            {pendingProposals.length === 0 ? (
              <p className="rounded-2xl bg-slate-50 px-3.5 py-3 text-sm text-slate-400 ring-1 ring-inset ring-slate-200/60">কোনো pending প্রস্তাব নেই।</p>
            ) : pendingProposals.map((p) => (
              <div key={p.id} className="ai3-prop-card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">{p.title}</span>
                  <span className="badge badge-amber">{p.status}</span>
                </div>
                <p className="mt-1 text-sm leading-6 text-slate-600">{p.preview}</p>
                <div className="mt-2.5 flex gap-2">
                  <button className="btn-primary btn-sm" onClick={() => decideProposal(p, "approve")}>অনুমোদন দিন</button>
                  <button className="btn-secondary btn-sm" onClick={() => decideProposal(p, "reject")}>প্রত্যাখ্যান</button>
                </div>
              </div>
            ))}
            <a href="#ai-proposals" className="block text-sm font-semibold text-brand-600 hover:underline">সব প্রস্তাব প্যানেলে যান ↓</a>
          </div>

          <div className="ai3-panel space-y-3">
            <div className="flex items-start gap-3">
              <span className="ai3-panel-icon" aria-hidden="true">🌅</span>
              <div>
                <h2 className="section-title">Proactive সহকারী (দৈনিক ব্রিফিং)</h2>
              </div>
            </div>
            <p className="text-sm leading-6 text-slate-500">প্রতিদিনের ব্রিফিং পেতে Automations পেজে একটি <b>Daily AI Briefing</b> job চালু করুন — ব্রিফিংটি নোটিফিকেশন হিসেবে OWNER/ADMIN-দের কাছে যাবে, শুধু আসল ডেটা থেকে তৈরি। ডেটা না থাকলে ব্রিফিংয়ে সেটাই লেখা থাকবে। Critical anomaly ধরা পড়লে আলাদা alert যাবে।</p>
            <div className="space-y-2">
              <label className="setting-row cursor-pointer">
                <span className="setting-row-label">দৈনিক ব্রিফিং চালু</span>
                <input type="checkbox" className="h-5 w-5 shrink-0 accent-indigo-600" checked={proactive.briefingEnabled} onChange={(e) => toggleProactive("briefingEnabled", e.target.checked)} />
              </label>
              <label className="setting-row cursor-pointer">
                <span className="setting-row-label">Critical anomaly alert চালু</span>
                <input type="checkbox" className="h-5 w-5 shrink-0 accent-indigo-600" checked={proactive.anomalyAlertsEnabled} onChange={(e) => toggleProactive("anomalyAlertsEnabled", e.target.checked)} />
              </label>
              <label className="setting-row cursor-pointer">
                <span className="setting-row-label">দৈনিক ব্রিফিংয়ের ইমেইল কপি OWNER/ADMIN-দের কাছে পাঠান
                  <span className="setting-row-help">শুধু কপি — আসল ব্রিফিং নোটিফিকেশনেই থাকে; SMTP সেট না থাকলে পাঠানো হবে না</span>
                </span>
                <input type="checkbox" className="h-5 w-5 shrink-0 accent-indigo-600" checked={proactive.dailyReportEmailEnabled} onChange={(e) => toggleProactive("dailyReportEmailEnabled", e.target.checked)} />
              </label>
              <label className="setting-row cursor-pointer">
                <span className="setting-row-label">ব্রিফিংয়ের Telegram কপি পাঠান
                  <span className="setting-row-help">Telegram integration connected থাকলেই কাজ করবে; না থাকলে কপি যাবে না (ব্রিফিং নোটিফিকেশনেই থাকবে)</span>
                </span>
                <input type="checkbox" className="h-5 w-5 shrink-0 accent-indigo-600" checked={proactive.telegramBriefEnabled} onChange={(e) => void saveTelegram(e.target.checked, proactive.telegramBriefChatId)} />
              </label>
              {proactive.telegramBriefEnabled ? (
                <div className="flex flex-wrap items-center gap-2 px-1">
                  <input className="input w-auto" placeholder="Telegram Chat ID (যেমন 123456789)" value={proactive.telegramBriefChatId} onChange={(e) => setProactive({ ...proactive, telegramBriefChatId: e.target.value })} />
                  <button type="button" className="btn-secondary btn-sm" onClick={() => void saveTelegram(true, proactive.telegramBriefChatId)}>Chat ID সেভ করুন</button>
                  <span className="text-xs text-slate-400">নিজের Chat ID জানতে Telegram-এ @userinfobot-কে message করুন।</span>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2 px-1">
                <span className="text-sm font-semibold text-slate-600">Assistant-এর নাম:</span>
                <input className="input w-auto" placeholder="যেমন: Qosprey সহকারী" value={proactive.assistantName} onChange={(e) => setProactive({ ...proactive, assistantName: e.target.value })} />
                <button type="button" className="btn-secondary btn-sm" onClick={() => void saveAssistantIdentity()}>সেভ করুন</button>
              </div>
              <label className="setting-row">
                <span className="setting-row-label">Autonomy Level 2 — অভ্যন্তরীণ কাজ স্বয়ংক্রিয়
                  <span className="setting-row-help">শুধু quick reply সেভ ও CRM ফলো-আপ টাস্ক (টাকা/বিজ্ঞাপন/পাঠানো — কোনোটাই নয়) অনুমোদন ছাড়া কার্যকর হবে; বাকি সব প্রস্তাবে মানুষের অনুমোদন লাগবেই। প্রতিটি স্বয়ংক্রিয় কাজ audit-এ চিহ্নিত থাকে।</span>
                </span>
                <input type="checkbox" className="h-5 w-5 shrink-0 accent-indigo-600" checked={proactive.autonomyLevel >= 2} onChange={(e) => void saveAutonomy(e.target.checked)} />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn-primary btn-sm min-h-[40px]" onClick={() => runBriefingNow()}>এখনই ব্রিফিং পাঠান</button>
              {briefingResult ? <span className="text-sm text-slate-600">{briefingResult}</span> : null}
            </div>
          </div>

          {apiKeys !== null ? (
            <div className="ai3-panel space-y-3">
              <div className="flex items-center gap-3">
                <span className="ai3-panel-icon" aria-hidden="true">🔑</span>
                <div className="min-w-0 flex-1">
                  <h2 className="section-title">Assistant API</h2>
                  <p className="mt-0.5 text-sm leading-6 text-slate-500">বাইরের টুল থেকে assistant-কে ডাকার key। POST <code>/assistant-api/chat</code> — header: <code>x-api-key</code>। Key শুধু তৈরি করার সময় একবারই পুরোটা দেখা যায়।</p>
                </div>
              </div>
              {keyNotice ? <p className="alert alert-amber">{keyNotice}</p> : null}
              {createdKey ? (
                <div className="rounded-2xl bg-emerald-50 px-4 py-3 ring-1 ring-inset ring-emerald-200">
                  <p className="text-xs font-bold text-emerald-800">নতুন key — এখনই কপি করুন, পরে আর দেখা যাবে না:</p>
                  <p className="mt-1 break-all font-mono text-[13px] text-emerald-900">{createdKey}</p>
                  <button type="button" className="btn-secondary btn-sm mt-2" onClick={() => { void navigator.clipboard?.writeText(createdKey).catch(() => undefined); setCreatedKey(""); }}>কপি করে বন্ধ করুন</button>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <input className="input w-auto" placeholder="Key-এর নাম (যেমন: Zapier)" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} />
                <button type="button" className="btn-primary btn-sm" disabled={!newKeyName.trim()} onClick={() => void createApiKey()}>নতুন key তৈরি</button>
              </div>
              {apiKeys.length === 0 ? <p className="text-sm text-slate-400">এখনো কোনো key নেই।</p> : (
                <ul className="space-y-2">
                  {apiKeys.map((k) => (
                    <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 px-3.5 py-2.5 ring-1 ring-inset ring-slate-200/60">
                      <span className="min-w-0 text-sm">
                        <span className="font-bold text-slate-800">{k.name}</span>{" "}
                        <span className="font-mono text-xs text-slate-500">{k.keyPrefix}…</span>
                        <span className="block text-xs text-slate-400">{k.revokedAt ? "⛔ revoked" : k.lastUsedAt ? `সর্বশেষ ব্যবহার: ${new Date(k.lastUsedAt).toLocaleString("bn-BD")}` : "এখনো ব্যবহার হয়নি"}</span>
                      </span>
                      {!k.revokedAt ? <button type="button" className="btn-secondary btn-sm" onClick={() => void revokeApiKey(k.id)}>Revoke</button> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          <div className="ai3-panel space-y-3">
            <div className="flex items-center gap-3">
              <span className="ai3-panel-icon" aria-hidden="true">📈</span>
              <h2 className="section-title">ব্যবহার (এই session)</h2>
            </div>
            {sessionUsage.count === 0 ? (
              <p className="rounded-2xl bg-slate-50 px-3.5 py-3 text-sm text-slate-400 ring-1 ring-inset ring-slate-200/60">এই session-এ এখনো কোনো streamed উত্তর আসেনি।</p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="ai3-usage-tile">
                    <p className="stat-label">উত্তর</p>
                    <p className="mt-1 text-lg font-bold leading-none text-slate-900">{sessionUsage.count}টি</p>
                  </div>
                  <div className="ai3-usage-tile">
                    <p className="stat-label">Input</p>
                    <p className="mt-1 text-lg font-bold leading-none text-slate-900">{sessionUsage.inputTokens}</p>
                  </div>
                  <div className="ai3-usage-tile">
                    <p className="stat-label">Output</p>
                    <p className="mt-1 text-lg font-bold leading-none text-slate-900">{sessionUsage.outputTokens}</p>
                  </div>
                </div>
                {sessionUsage.estimated ? <p className="alert alert-amber text-xs">~আনুমানিক (কমপক্ষে একটি উত্তরের usage আনুমানিক)</p> : null}
              </>
            )}
            <p className="text-xs leading-5 text-slate-400">শুধু এই পেজে এই session-এ আসা streamed উত্তরের done usage-এর যোগফল — কোনো cap বা limit-এর সংখ্যা এখানে দেখানো হয় না, কারণ এই পেজের হাতে সেই ডেটা নেই।</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
