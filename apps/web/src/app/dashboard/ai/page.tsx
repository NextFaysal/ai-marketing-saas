"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { Markdown } from "@/components/markdown";

interface Conversation { id: string; title?: string | null; updatedAt: string; pinnedAt?: string | null }
interface Proposal { id: string; type: string; title: string; preview: string; status: string; error?: string | null; createdAt: string }
interface ProposalTargets { campaigns: { id: string; name: string; metaStatus?: string | null }[]; adSets: { id: string; name: string; planId: string; planName: string }[] }
interface Message { id: string; role: string; content: string; toolCalls?: { tool: string; status: string }[] | null }

const SUGGESTIONS = [
  "গত ৭ দিনে বিক্রি কেমন ছিল?",
  "আমার সবচেয়ে ভালো ক্যাম্পেইন কোনগুলো?",
  "কোন অর্ডারগুলোর ফলো-আপ দরকার?",
  "কোনো অস্বাভাবিক কিছু ঘটেছে কি?",
  "কোন পণ্যে সবচেয়ে বেশি লাভ হয়?",
  "কাস্টমার সেগমেন্টগুলো দেখাও",
  "স্টকের অবস্থা কেমন?",
  "কুরিয়ারদের পারফরম্যান্স কেমন?",
  "Which products have the best margin?",
];

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
  const [propKind, setPropKind] = useState<"pause_campaign" | "pause_ad_set" | "create_broadcast_draft">("pause_campaign");
  const [propTarget, setPropTarget] = useState("");
  const [propDraft, setPropDraft] = useState({ name: "", channel: "email", subject: "", body: "" });
  const [propNotice, setPropNotice] = useState("");
  const [proactive, setProactive] = useState({ briefingEnabled: true, anomalyAlertsEnabled: true });
  const [briefingResult, setBriefingResult] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const orgId = typeof window !== "undefined" ? getOrganizationId() : null;

  const loadConversations = useCallback(async (q?: string) => {
    const id = getOrganizationId(); if (!id) return;
    try {
      const query = q?.trim() ? `?search=${encodeURIComponent(q.trim())}` : "";
      setConversations(await apiFetch<Conversation[]>(`/organizations/${id}/ai/chat/conversations${query}`));
    } catch { /* a fresh account simply has none */ }
  }, []);

  const loadMessages = useCallback(async (convId: string) => {
    const id = getOrganizationId(); if (!id || !convId) return;
    try { setMessages(await apiFetch<Message[]>(`/organizations/${id}/ai/chat/conversations/${convId}/messages`)); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load messages"); }
  }, []);

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
    apiFetch<{ briefingEnabled: boolean; anomalyAlertsEnabled: boolean }>(`/organizations/${id}/ai/proactive/settings`).then(setProactive).catch(() => undefined);
  }, []);

  async function toggleProactive(key: "briefingEnabled" | "anomalyAlertsEnabled", value: boolean) {
    if (!orgId) return;
    const next = { ...proactive, [key]: value };
    setProactive(next);
    try { setProactive(await apiFetch(`/organizations/${orgId}/ai/proactive/settings`, { method: "PATCH", body: JSON.stringify({ [key]: value }) })); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  async function runBriefingNow() {
    if (!orgId) return;
    try {
      const res = await apiFetch<{ briefings?: number; anomalyAlerts?: number; skipped?: string }>(`/organizations/${orgId}/ai/proactive/run-now`, { method: "POST", body: JSON.stringify({}) });
      setBriefingResult(res.skipped ? `চালানো হয়নি: ${res.skipped}` : `পাঠানো হয়েছে — ব্রিফিং ${res.briefings ?? 0}টি, anomaly alert ${res.anomalyAlerts ?? 0}টি (আজ আগেই পাঠিয়ে থাকলে dedupe-এ ০ দেখাবে)। নোটিফিকেশন বেলে দেখুন।`);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
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
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);

  async function newConversation(): Promise<string | null> {
    if (!orgId) return null;
    const conv = await apiFetch<Conversation>(`/organizations/${orgId}/ai/chat/conversations`, { method: "POST", body: JSON.stringify({}) });
    setFollowUps([]);
    await loadConversations(search);
    setActiveId(conv.id);
    setMessages([]);
    return conv.id;
  }

  async function patchConversation(id: string, patch: { title?: string; pinned?: boolean }) {
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

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending) return;
    setError(""); setSending(true); setInput(""); setFollowUps([]);
    try {
      let convId = activeId;
      if (!convId) { convId = (await newConversation()) ?? ""; if (!convId) return; }
      setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: "user", content }]);
      const res = await apiFetch<{ message: Message; provider: string; isRealLlm: boolean; suggestions?: string[]; proposal?: Proposal | null }>(
        `/organizations/${orgId}/ai/chat/conversations/${convId}/messages`,
        { method: "POST", body: JSON.stringify({ content }) });
      setProvider(res.isRealLlm ? res.provider : "dev-template");
      setMessages((m) => [...m, res.message]);
      setFollowUps(res.suggestions ?? []);
      if (res.proposal) {
        setPropNotice(`একটি প্রস্তাব তৈরি হয়েছে: ${res.proposal.title} — অনুমোদন ছাড়া কিছুই করা হয়নি। নিচের প্রস্তাব প্যানেলে দেখুন।`);
        await loadProposals();
      }
      await loadConversations(search);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to send"); }
    finally { setSending(false); }
  }

  const conversationRow = (c: Conversation) => (
    <div key={c.id} className={`group rounded-lg px-3 py-2 text-sm ${c.id === activeId ? "bg-blue-50" : "hover:bg-slate-100"}`}>
      <button onClick={() => { setActiveId(c.id); setFollowUps([]); }} className="w-full text-left">
        <span className={c.id === activeId ? "font-semibold" : ""}>{c.pinnedAt ? "📌 " : ""}{c.title ?? "নতুন কথোপকথন"}</span>
        <span className="block text-xs text-slate-400">{new Date(c.updatedAt).toLocaleDateString()}</span>
      </button>
      <span className="mt-1 flex flex-wrap gap-1 text-[11px]">
        <button className="rounded border px-1.5 py-0.5 hover:bg-white" title={c.pinnedAt ? "আনপিন করুন" : "পিন করুন"} onClick={() => patchConversation(c.id, { pinned: !c.pinnedAt })}>{c.pinnedAt ? "আনপিন" : "পিন"}</button>
        <button className="rounded border px-1.5 py-0.5 hover:bg-white" onClick={() => renameConversation(c)}>নাম বদল</button>
        <button className="rounded border px-1.5 py-0.5 hover:bg-white" onClick={() => exportConversation(c, "markdown")}>MD</button>
        <button className="rounded border px-1.5 py-0.5 hover:bg-white" onClick={() => exportConversation(c, "json")}>JSON</button>
        <button className="rounded border border-red-200 px-1.5 py-0.5 text-red-600 hover:bg-red-50" onClick={() => deleteConversation(c)}>মুছুন</button>
      </span>
    </div>
  );

  return (
    <div className="flex gap-4">
      <div className="hidden w-64 shrink-0 flex-col gap-2 md:flex">
        <button className="btn-primary btn-sm" onClick={() => newConversation()}>+ নতুন কথোপকথন</button>
        <input
          className="rounded-lg border bg-white px-3 py-2 text-sm"
          placeholder="কথোপকথন খুঁজুন (নাম বা মেসেজ)..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {conversations.length === 0 && search.trim() ? <p className="px-1 text-xs text-slate-400">কিছু পাওয়া যায়নি</p> : null}
        {conversations.map(conversationRow)}
      </div>

      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex gap-2 md:hidden">
          <select
            className="min-w-0 flex-1 rounded-lg border bg-white px-2 py-2 text-sm"
            value={activeId}
            onChange={(e) => { setActiveId(e.target.value); setFollowUps([]); }}
          >
            <option value="">কথোপকথন বেছে নিন...</option>
            {conversations.map((c) => <option key={c.id} value={c.id}>{c.pinnedAt ? "📌 " : ""}{c.title ?? "নতুন কথোপকথন"}</option>)}
          </select>
          <button className="btn-primary btn-sm" onClick={() => newConversation()}>+ নতুন</button>
        </div>
        <div>
          <h1 className="page-title">AI Assistant</h1>
          <p className="text-sm text-slate-500">
            শুধুমাত্র যাচাইকৃত ডেটা দিয়ে উত্তর দেয়। AI নিজে থেকে কিছু বদলায় না — কাজের প্রস্তাব দিতে পারে, কিন্তু অনুমোদন ছাড়া কিছুই হয় না (নিচের প্রস্তাব প্যানেল দেখুন)।
            {provider === "dev-template" ? <span className="ml-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">Dev Template Mode: আসল LLM কনফিগার করা হয়নি, উত্তর টেমপ্লেট দিয়ে তৈরি</span> : null}
            {provider && provider !== "dev-template" ? <span className="ml-1 rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">LLM: {provider}</span> : null}
          </p>
        </div>
        {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

        <div className="min-h-80 space-y-3 card p-4">
          {messages.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-500">একটি প্রশ্ন দিয়ে শুরু করুন:</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="rounded-full border px-3 py-1.5 text-sm hover:bg-slate-50" onClick={() => send(s)}>{s}</button>
                ))}
              </div>
            </div>
          ) : messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${m.role === "user" ? "bg-blue-600 text-white" : "bg-slate-100"}`}>
                {m.role === "assistant" ? <Markdown text={m.content} /> : <p className="text-sm">{m.content}</p>}
                {m.toolCalls && m.toolCalls.length > 0 ? (
                  <div className="mt-2 border-t border-slate-200 pt-1 text-[11px] text-slate-500">
                    ব্যবহৃত টুল: {m.toolCalls.map((t) => t.tool).join(", ")}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          {sending ? <p className="text-sm text-slate-400">ভাবছি...</p> : null}
          <div ref={bottomRef} />
        </div>

        {followUps.length > 0 && !sending ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">এরপর জিজ্ঞেস করতে পারেন:</span>
            {followUps.map((s) => (
              <button key={s} className="rounded-full border px-3 py-1.5 text-sm hover:bg-slate-50" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        ) : null}

        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <input className="flex-1 rounded-lg border bg-white px-3 py-2.5 text-sm" placeholder="বাংলা বা ইংরেজিতে জিজ্ঞেস করুন..." value={input} onChange={(e) => setInput(e.target.value)} />
          <button className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={sending}>পাঠান</button>
        </form>

        <div className="card space-y-3 p-4">
          <div>
            <h2 className="font-semibold">কার্যক্রমের প্রস্তাব (অনুমোদন লাগবে)</h2>
            <p className="text-sm text-slate-500">প্রস্তাব তৈরি হলেই কিছু হয় না। অনুমোদন দিলে তবেই আসল কাজটি হয় — ক্যাম্পেইন pause হলে Meta-র নিশ্চিতকরণ লাগে, broadcast শুধু draft তৈরি হয়, কখনো নিজে থেকে পাঠানো হয় না।</p>
          </div>
          {propNotice ? <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">{propNotice}</p> : null}
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">ধরন
              <select className="ml-2 rounded-lg border px-2 py-2 text-sm" value={propKind} onChange={(e) => { setPropKind(e.target.value as typeof propKind); setPropTarget(""); }}>
                <option value="pause_campaign">ক্যাম্পেইন Pause</option>
                <option value="pause_ad_set">Ad Set Pause</option>
                <option value="create_broadcast_draft">Broadcast Draft তৈরি</option>
              </select>
            </label>
            {propKind !== "create_broadcast_draft" ? (
              <label className="text-sm">লক্ষ্য
                <select className="ml-2 min-w-52 rounded-lg border px-2 py-2 text-sm" value={propTarget} onChange={(e) => setPropTarget(e.target.value)}>
                  <option value="">— বেছে নিন —</option>
                  {propKind === "pause_campaign"
                    ? targets.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}{c.metaStatus ? ` (${c.metaStatus})` : ""}</option>)
                    : targets.adSets.map((a) => <option key={a.id} value={a.id}>{a.planName} / {a.name}</option>)}
                </select>
              </label>
            ) : (
              <>
                <input className="rounded-lg border px-2 py-2 text-sm" placeholder="Draft-এর নাম" value={propDraft.name} onChange={(e) => setPropDraft({ ...propDraft, name: e.target.value })} />
                <select className="rounded-lg border px-2 py-2 text-sm" value={propDraft.channel} onChange={(e) => setPropDraft({ ...propDraft, channel: e.target.value })}>
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                </select>
                {propDraft.channel === "email" ? <input className="rounded-lg border px-2 py-2 text-sm" placeholder="Subject" value={propDraft.subject} onChange={(e) => setPropDraft({ ...propDraft, subject: e.target.value })} /> : null}
                <input className="min-w-52 flex-1 rounded-lg border px-2 py-2 text-sm" placeholder="Message body" value={propDraft.body} onChange={(e) => setPropDraft({ ...propDraft, body: e.target.value })} />
              </>
            )}
            <button className="btn-primary btn-sm" onClick={() => createProposal()}>প্রস্তাব তৈরি করুন</button>
          </div>
          <div className="space-y-2">
            {proposals.length === 0 ? <p className="text-sm text-slate-400">কোনো প্রস্তাব নেই। চ্যাটে কোনো published ক্যাম্পেইনের নাম ধরে “pause করে দাও” বললেও প্রস্তাব তৈরি হবে।</p> : proposals.map((p) => (
              <div key={p.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{p.title}</span>
                  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${p.status === "executed" ? "bg-green-100 text-green-700" : p.status === "failed" ? "bg-red-100 text-red-700" : p.status === "rejected" ? "bg-slate-200 text-slate-600" : "bg-amber-100 text-amber-700"}`}>{p.status}</span>
                </div>
                <p className="mt-1 text-sm text-slate-600">{p.preview}</p>
                {p.error ? <p className="mt-1 text-sm text-red-600">ত্রুটি: {p.error}</p> : null}
                {p.status === "proposed" ? (
                  <div className="mt-2 flex gap-2">
                    <button className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white" onClick={() => decideProposal(p, "approve")}>অনুমোদন দিন</button>
                    <button className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => decideProposal(p, "reject")}>প্রত্যাখ্যান</button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="card space-y-3 p-4">
          <div>
            <h2 className="font-semibold">Proactive সহকারী (দৈনিক ব্রিফিং)</h2>
            <p className="text-sm text-slate-500">প্রতিদিনের ব্রিফিং পেতে Automations পেজে একটি <b>Daily AI Briefing</b> job চালু করুন — ব্রিফিংটি নোটিফিকেশন হিসেবে OWNER/ADMIN-দের কাছে যাবে, শুধু আসল ডেটা থেকে তৈরি। ডেটা না থাকলে ব্রিফিংয়ে সেটাই লেখা থাকবে। Critical anomaly ধরা পড়লে আলাদা alert যাবে।</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={proactive.briefingEnabled} onChange={(e) => toggleProactive("briefingEnabled", e.target.checked)} />
            দৈনিক ব্রিফিং চালু
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={proactive.anomalyAlertsEnabled} onChange={(e) => toggleProactive("anomalyAlertsEnabled", e.target.checked)} />
            Critical anomaly alert চালু
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary btn-sm" onClick={() => runBriefingNow()}>এখনই ব্রিফিং পাঠান</button>
            {briefingResult ? <span className="text-sm text-slate-600">{briefingResult}</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
