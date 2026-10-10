"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { getOrganizationId } from "../../../lib/org";

interface TicketMessage { id: string; authorKind: string; body: string; createdAt: string }
interface Ticket { id: string; subject: string; status: string; priority: string; lastMessageAt: string; createdAt: string; messageCount?: number; messages?: TicketMessage[] }

const STATUS_LABEL: Record<string, string> = { open: "🟢 খোলা", pending: "🟡 উত্তরের অপেক্ষায়", resolved: "✅ সমাধান হয়েছে", closed: "⚪ বন্ধ" };

export default function SupportPage() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [error, setError] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState("normal");
  const [reply, setReply] = useState("");

  useEffect(() => { setOrgId(getOrganizationId()); }, []);

  const load = useCallback(async () => {
    if (!orgId) return;
    try { setTickets(await apiFetch<Ticket[]>(`/organizations/${orgId}/tickets`)); } catch { /* honest empty */ }
  }, [orgId]);
  useEffect(() => { load(); }, [load]);

  const open = async (id: string) => {
    if (!orgId) return;
    try { setSelected(await apiFetch<Ticket>(`/organizations/${orgId}/tickets/${id}`)); } catch (e) { setError(e instanceof Error ? e.message : "Ticket খোলা যাচ্ছে না"); }
  };

  const create = async () => {
    if (!orgId) return;
    setError("");
    try {
      const t = await apiFetch<Ticket>(`/organizations/${orgId}/tickets`, { method: "POST", body: JSON.stringify({ subject, body, priority }) });
      setSubject(""); setBody(""); setPriority("normal");
      await load(); setSelected(t);
    } catch (e) { setError(e instanceof Error ? e.message : "Ticket তৈরি হয়নি"); }
  };

  const sendReply = async () => {
    if (!orgId || !selected || !reply.trim()) return;
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/tickets/${selected.id}/messages`, { method: "POST", body: JSON.stringify({ body: reply }) });
      setReply(""); await open(selected.id); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "উত্তর পাঠানো যায়নি"); }
  };

  const setStatus = async (status: string) => {
    if (!orgId || !selected) return;
    try {
      await apiFetch(`/organizations/${orgId}/tickets/${selected.id}/status`, { method: "POST", body: JSON.stringify({ status }) });
      await open(selected.id); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Status বদলায়নি"); }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">🎫 Support</h1>
        <p className="text-sm text-slate-500">প্ল্যাটফর্ম টিমের কাছে সাহায্য চান — Ticket খুলুন, উত্তর এখানেই পাবেন (ইমেইলেও জানানো হবে)।</p>
      </header>
      {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p> : null}

      <FeedbackCard orgId={orgId} />

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-bold text-slate-900">নতুন Ticket</h2>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="বিষয় — যেমন: WooCommerce Sync হচ্ছে না" className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="সমস্যাটা বিস্তারিত লিখুন…" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <div className="mt-2 flex items-center gap-2">
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-2 text-sm">
                <option value="normal">সাধারণ</option>
                <option value="high">জরুরি</option>
              </select>
              <button onClick={create} disabled={!subject.trim() || !body.trim()} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Ticket খুলুন</button>
            </div>
          </section>
          <section className="space-y-2">
            {tickets.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">কোনো Ticket নেই।</p> : null}
            {tickets.map((t) => (
              <button key={t.id} onClick={() => open(t.id)} className={`w-full rounded-xl border p-3 text-left shadow-sm ${selected?.id === t.id ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-white"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-slate-800">{t.priority === "high" ? "🔴 " : ""}{t.subject}</span>
                  <span className="shrink-0 text-xs">{STATUS_LABEL[t.status] ?? t.status}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{t.messageCount ?? 0} টি বার্তা · শেষ {new Date(t.lastMessageAt).toLocaleString("bn-BD")}</p>
              </button>
            ))}
          </section>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          {!selected ? <p className="p-6 text-center text-sm text-slate-500">বাম থেকে একটি Ticket বেছে নিন, অথবা নতুন Ticket খুলুন।</p> : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3">
                <h2 className="text-base font-bold text-slate-900">{selected.subject}</h2>
                <span className="text-xs">{STATUS_LABEL[selected.status] ?? selected.status}</span>
                <span className="ml-auto flex gap-2">
                  {selected.status !== "closed" ? <button onClick={() => setStatus("closed")} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold">বন্ধ করুন</button> : null}
                  {selected.status === "closed" || selected.status === "resolved" ? <button onClick={() => setStatus("open")} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold">আবার খুলুন</button> : null}
                </span>
              </div>
              <div className="mt-4 space-y-3">
                {(selected.messages ?? []).map((m) => (
                  <div key={m.id} className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${m.authorKind === "admin" ? "bg-indigo-50 text-slate-800" : "ml-auto bg-slate-100 text-slate-800"}`}>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{m.authorKind === "admin" ? "🛠 প্ল্যাটফর্ম টিম" : "আপনি"} · {new Date(m.createdAt).toLocaleString("bn-BD")}</p>
                    <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2} placeholder="উত্তর লিখুন…" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                <button onClick={sendReply} disabled={!reply.trim()} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">পাঠান</button>
              </div>
            </>
          )}
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
    return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">🙏 ধন্যবাদ! আপনার মতামত প্ল্যাটফর্ম টিমের কাছে পৌঁছেছে।</div>;
  }
  return (
    <div className="rounded-2xl border bg-white p-4">
      <div className="text-sm font-semibold">💬 এক মিনিটে মতামত দিন</div>
      <p className="mt-0.5 text-xs text-slate-500">বন্ধু বা পরিচিত কারো কাছে এই প্ল্যাটফর্মটি সুপারিশ করার সম্ভাবনা কতটা? (০ = একদমই না, ১০ = অবশ্যই)</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {Array.from({ length: 11 }, (_, i) => (
          <button
            key={i}
            onClick={() => setScore(i)}
            className={`h-9 w-9 rounded-lg border text-sm font-semibold ${score === i ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 bg-slate-50 hover:border-indigo-300"}`}
          >{i}</button>
        ))}
      </div>
      <textarea className="mt-2 w-full rounded-lg border p-2 text-sm" rows={2} placeholder="কী ভালো লাগলো / কী উন্নত করা দরকার? (ঐচ্ছিক)" value={comment} onChange={(e) => setComment(e.target.value)} />
      {err ? <p className="mt-1 text-xs text-red-600">{err}</p> : null}
      <button
        className="btn-primary mt-2"
        disabled={score === null}
        onClick={async () => {
          try {
            await apiFetch(`/organizations/${orgId}/feedback`, { method: "POST", body: JSON.stringify({ score, comment: comment.trim() || undefined }) });
            setDone(true);
          } catch (e) { setErr(e instanceof Error ? e.message : "পাঠানো যায়নি"); }
        }}
      >মতামত পাঠান</button>
    </div>
  );
}
