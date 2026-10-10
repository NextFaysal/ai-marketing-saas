"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { Markdown } from "@/components/markdown";

interface Conversation { id: string; title?: string | null; updatedAt: string }
interface Message { id: string; role: string; content: string; toolCalls?: { tool: string; status: string }[] | null }

const SUGGESTIONS = [
  "গত ৭ দিনে বিক্রি কেমন ছিল?",
  "আমার সবচেয়ে ভালো ক্যাম্পেইন কোনগুলো?",
  "কোন অর্ডারগুলোর ফলো-আপ দরকার?",
  "কোনো অস্বাভাবিক কিছু ঘটেছে কি?",
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
  const bottomRef = useRef<HTMLDivElement>(null);

  const orgId = typeof window !== "undefined" ? getOrganizationId() : null;

  const loadConversations = useCallback(async () => {
    const id = getOrganizationId(); if (!id) return;
    try { setConversations(await apiFetch<Conversation[]>(`/organizations/${id}/ai/chat/conversations`)); }
    catch { /* a fresh account simply has none */ }
  }, []);

  const loadMessages = useCallback(async (convId: string) => {
    const id = getOrganizationId(); if (!id || !convId) return;
    try { setMessages(await apiFetch<Message[]>(`/organizations/${id}/ai/chat/conversations/${convId}/messages`)); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to load messages"); }
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);
  useEffect(() => { if (activeId) loadMessages(activeId); }, [activeId, loadMessages]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);

  async function newConversation(): Promise<string | null> {
    if (!orgId) return null;
    const conv = await apiFetch<Conversation>(`/organizations/${orgId}/ai/chat/conversations`, { method: "POST", body: JSON.stringify({}) });
    setConversations((c) => [conv, ...c]);
    setActiveId(conv.id);
    setMessages([]);
    return conv.id;
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending) return;
    setError(""); setSending(true); setInput("");
    try {
      let convId = activeId;
      if (!convId) { convId = (await newConversation()) ?? ""; if (!convId) return; }
      setMessages((m) => [...m, { id: `tmp-${Date.now()}`, role: "user", content }]);
      const res = await apiFetch<{ message: Message; provider: string; isRealLlm: boolean }>(
        `/organizations/${orgId}/ai/chat/conversations/${convId}/messages`,
        { method: "POST", body: JSON.stringify({ content }) });
      setProvider(res.isRealLlm ? res.provider : "dev-template");
      setMessages((m) => [...m, res.message]);
      await loadConversations();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to send"); }
    finally { setSending(false); }
  }

  return (
    <div className="flex gap-4">
      <div className="hidden w-60 shrink-0 flex-col gap-2 md:flex">
        <button className="btn-primary btn-sm" onClick={() => newConversation()}>+ নতুন কথোপকথন</button>
        {conversations.map((c) => (
          <button key={c.id} onClick={() => setActiveId(c.id)} className={`rounded-lg px-3 py-2 text-left text-sm ${c.id === activeId ? "bg-blue-50 font-semibold" : "hover:bg-slate-100"}`}>
            {c.title ?? "নতুন কথোপকথন"}
            <div className="text-xs text-slate-400">{new Date(c.updatedAt).toLocaleDateString()}</div>
          </button>
        ))}
      </div>

      <div className="min-w-0 flex-1 space-y-4">
        <div>
          <h1 className="page-title">AI Assistant</h1>
          <p className="text-sm text-slate-500">
            শুধুমাত্র যাচাইকৃত ডেটা দিয়ে উত্তর দেয়। এই ফেজে AI Read-only: ক্যাম্পেইন প্রকাশ, বাজেট বদল বা মেসেজ পাঠাতে পারে না।
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

        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <input className="flex-1 rounded-lg border bg-white px-3 py-2.5 text-sm" placeholder="বাংলা বা ইংরেজিতে জিজ্ঞেস করুন..." value={input} onChange={(e) => setInput(e.target.value)} />
          <button className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={sending}>পাঠান</button>
        </form>
      </div>
    </div>
  );
}
