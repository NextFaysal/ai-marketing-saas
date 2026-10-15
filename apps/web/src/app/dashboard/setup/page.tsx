"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

interface SetupStep { key: string; label: string; done: boolean; href: string }
interface SetupGuide { steps: SetupStep[]; completed: number; total: number; percent: number; allDone: boolean }
interface PracticeState {
  practiceMode: boolean;
  practiceConversationId: string | null;
  practiceConversations: number;
  practiceOrders: number;
  demoConversations?: number;
  demoPackLoaded?: boolean;
}
interface DemoScenario {
  slug: string;
  title: string;
  feature: string;
  conversationId: string;
}
interface PracticeMessage {
  id: string; direction: string; content: string | null; status: string;
  autoReply: boolean; createdAt: string;
}

/**
 * CX12a — Setup Guide + Practice Mode.
 *
 * The guide consumes the SAME real-row checklist state as the
 * API's onboarding state (GET /organizations/:id/setup-guide):
 * a step shows done only when the underlying data exists.
 * Practice Mode rehearses the full AI reply + order flow on a
 * synthetic conversation — nothing on it can reach a real
 * customer (API-enforced at the send choke point), and cleanup
 * removes every practice trace.
 */
export default function SetupPage() {
  const [guide, setGuide] = useState<SetupGuide | null>(null);
  const [practice, setPractice] = useState<PracticeState | null>(null);
  const [messages, setMessages] = useState<PracticeMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [demoScenarios, setDemoScenarios] = useState<DemoScenario[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const [g, p] = await Promise.all([
        apiFetch<SetupGuide>(`/organizations/${orgId}/setup-guide`),
        apiFetch<PracticeState>(`/organizations/${orgId}/practice`),
      ]);
      setGuide(g);
      setPractice(p);
    } catch { /* best-effort UI; the API state is the source of truth */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function togglePractice(enabled: boolean) {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const p = await apiFetch<PracticeState>(`/organizations/${orgId}/practice/toggle`, {
        method: "POST", body: JSON.stringify({ enabled }),
      });
      setPractice(p);
      setNotice(enabled ? "Practice Mode চালু হয়েছে — এখন নিরাপদে অনুশীলন করুন।" : "Practice Mode বন্ধ করা হয়েছে।");
    } catch (e) { setError(e instanceof Error ? e.message : "ব্যর্থ হয়েছে"); }
    finally { setBusy(false); }
  }

  async function loadDemoPack() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const out = await apiFetch<{ created: boolean; count: number; scenarios: DemoScenario[] }>(
        `/organizations/${orgId}/practice/demo-pack`, { method: "POST", body: JSON.stringify({}) },
      );
      setDemoScenarios(out.scenarios ?? []);
      setNotice(out.created
        ? `Demo Chat Pack লোড হয়েছে — ${out.count}টি demo কথোপকথন তৈরি হয়েছে।`
        : `Demo Chat Pack আগেই লোড করা আছে — ${out.count}টি demo কথোপকথন আছে।`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "ব্যর্থ হয়েছে"); }
    finally { setBusy(false); }
  }

  async function startConversation() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(true); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/practice/conversation`, { method: "POST", body: JSON.stringify({}) });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "ব্যর্থ হয়েছে"); }
    finally { setBusy(false); }
  }

  async function simulate(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId();
    if (!orgId || !practice?.practiceConversationId || !draft.trim()) return;
    setBusy(true); setError("");
    try {
      const out = await apiFetch<{ messages: PracticeMessage[] }>(
        `/organizations/${orgId}/practice/conversations/${practice.practiceConversationId}/simulate`,
        { method: "POST", body: JSON.stringify({ content: draft.trim() }) },
      );
      setMessages(out.messages);
      setDraft("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "ব্যর্থ হয়েছে"); }
    finally { setBusy(false); }
  }

  async function cleanup() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    if (!window.confirm("সব প্র্যাক্টিস কথোপকথন ও প্র্যাক্টিস অর্ডার মুছে যাবে এবং Practice Mode বন্ধ হবে। নিশ্চিত?")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await apiFetch<{ conversations: number; messages: number; orders: number }>(
        `/organizations/${orgId}/practice/cleanup`, { method: "POST", body: JSON.stringify({}) },
      );
      setMessages([]);
      setDemoScenarios([]);
      setNotice(`পরিষ্কার সম্পন্ন: ${r.conversations}টি কথোপকথন, ${r.messages}টি বার্তা, ${r.orders}টি অর্ডার মুছে গেছে।`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "ব্যর্থ হয়েছে"); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">🧭 Setup Guide</h1>
        <p className="mt-1 text-sm text-slate-500">ধাপে ধাপে আপনার ব্যবসা চালুর জন্য প্রস্তুত করুন। প্রতিটি ধাপ শুধুমাত্র তখনই সম্পন্ন দেখায়, যখন আসল ডাটা সত্যিই আছে।</p>
      </div>

      {error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p> : null}

      <section className="card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="font-semibold">সেটআপ অগ্রগতি</div>
          {guide ? <span className="badge-brand">{guide.completed}/{guide.total} ধাপ · {guide.percent}%</span> : null}
        </div>
        {guide ? (
          <>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${guide.percent}%` }} />
            </div>
            <ul className="mt-4 divide-y divide-slate-100">
              {guide.steps.map((s) => (
                <li key={s.key} className="flex items-center gap-3 py-2.5">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>{s.done ? "✓" : "•"}</span>
                  <span className={`flex-1 text-sm ${s.done ? "text-slate-500 line-through decoration-slate-300" : "font-medium text-slate-800"}`}>{s.label}</span>
                  {s.done
                    ? <span className="text-xs font-semibold text-emerald-600">হয়ে গেছে</span>
                    : <a href={s.href} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white">এখন করুন →</a>}
                </li>
              ))}
            </ul>
            {guide.allDone ? <p className="mt-3 text-sm font-medium text-emerald-700">🎉 সব ধাপ সম্পন্ন — আপনার ব্যবসা পুরোপুরি প্রস্তুত!</p> : null}
          </>
        ) : <p className="mt-3 text-sm text-slate-400">লোড হচ্ছে…</p>}
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="font-semibold">🧪 Practice Mode</div>
          {practice?.practiceMode
            ? <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800">চালু আছে</span>
            : <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-500">বন্ধ</span>}
          {practice && practice.practiceMode ? (
            <span className="text-xs text-slate-500">প্র্যাক্টিস কথোপকথন: {practice.practiceConversations}টি · প্র্যাক্টিস অর্ডার: {practice.practiceOrders}টি</span>
          ) : null}
          <div className="ml-auto flex gap-2">
            {practice?.practiceMode
              ? <button onClick={() => togglePractice(false)} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-50">বন্ধ করুন</button>
              : <button onClick={() => togglePractice(true)} disabled={busy} className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">চালু করুন</button>}
            {practice?.practiceMode ? (
              <button onClick={cleanup} disabled={busy} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Practice শেষ করুন (সব মুছুন)</button>
            ) : null}
          </div>
        </div>
        <p className="mt-2 text-sm text-slate-500">
          প্র্যাক্টিস কথোপকথনে নিজে customer সেজে বার্তা লিখুন — আপনার আসল AI নির্দেশনা, Knowledge Base ও প্রোডাক্ট দিয়েই AI উত্তর দেবে এবং অর্ডার ফ্লো চলবে।
          কিন্তু <b>কোনো কিছুই আসল customer-এর কাছে যাবে না</b>: প্র্যাক্টিস বার্তা শুধু এখানেই থাকে, প্র্যাক্টিস অর্ডারে কুরিয়ার বুকিং হয় না, স্টকও কাটে না।
        </p>

        <div className="mt-5 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm font-semibold">🎬 Demo Chat Pack</div>
            {practice?.demoPackLoaded ? (
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                ✓ Demo Chat লোড হয়েছে ({practice.demoConversations ?? demoScenarios.length}টি)
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-slate-500">
            পুরো সিস্টেমটা চোখে দেখে বুঝতে ১২টি তৈরি demo কথোপকথন লোড করুন — WhatsApp/Messenger/Instagram/Webchat/Email/Telegram-এ অর্ডার, অভিযোগ, handover, VIP, voice order, snoozeসহ।
            এগুলো practice data — <b>আসল customer-এর কাছে কিছুই যাবে না</b>, আর &apos;Practice শেষ করুন&apos; দিলে একবারে সব মুছে যাবে।
          </p>
          {!practice?.practiceMode ? (
            <>
              <button disabled className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">🎬 Demo Chat লোড করুন</button>
              <p className="mt-2 text-xs font-medium text-amber-700">Demo Chat লোড করতে আগে Practice Mode চালু করুন।</p>
            </>
          ) : practice.demoPackLoaded ? (
            <p className="mt-3 text-sm font-medium text-emerald-700">✓ Demo Chat লোড হয়েছে ({practice.demoConversations ?? demoScenarios.length}টি)</p>
          ) : (
            <button onClick={loadDemoPack} disabled={busy} className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">🎬 Demo Chat লোড করুন</button>
          )}
          {demoScenarios.length > 0 ? (
            <ul className="mt-4 divide-y divide-slate-200 rounded-xl bg-white ring-1 ring-slate-200">
              {demoScenarios.map((s) => (
                <li key={s.slug} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-800">{s.title}</div>
                    <div className="text-xs text-slate-500">{s.feature}</div>
                  </div>
                  <a href="/dashboard/inbox" className="shrink-0 text-xs font-semibold text-brand-600 hover:underline">Inbox-এ দেখুন →</a>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-3 text-xs text-slate-400">আবার নতুন করে সাজাতে: &apos;Practice শেষ করুন (সব মুছুন)&apos; → Practice চালু করে আবার লোড করুন।</p>
        </div>

        {practice?.practiceMode ? (
          <div className="mt-4 space-y-3">
            {!practice.practiceConversationId ? (
              <button onClick={startConversation} disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">প্র্যাক্টিস কথোপকথন শুরু করুন</button>
            ) : (
              <>
                <div className="max-h-80 space-y-2 overflow-y-auto rounded-xl bg-slate-50 p-3">
                  {messages.length === 0 ? (
                    <p className="text-sm text-slate-400">এখনো কোনো বার্তা নেই — নিচে customer হিসেবে একটি বার্তা লিখুন, যেমন: &quot;কটন শাড়ি এর দাম কত?&quot;</p>
                  ) : messages.map((m) => (
                    <div key={m.id} className={`flex ${m.direction === "in" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.direction === "in" ? "bg-blue-600 text-white" : "bg-white text-slate-800 ring-1 ring-slate-200"}`}>
                        <div className="whitespace-pre-wrap">{m.content ?? ""}</div>
                        <div className={`mt-1 text-[10px] ${m.direction === "in" ? "text-blue-100" : "text-slate-400"}`}>
                          {m.direction === "in" ? "🧪 আপনি (customer সেজে)" : m.autoReply ? "🤖 AI" : "👤 টিম"}
                          {m.status === "practice" ? " · শুধু প্র্যাক্টিসে সংরক্ষিত, পাঠানো হয়নি" : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <form onSubmit={simulate} className="flex gap-2">
                  <input className="input flex-1" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="customer হিসেবে বার্তা লিখুন…" maxLength={2000} />
                  <button disabled={busy || !draft.trim()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">পাঠান</button>
                </form>
                <p className="text-xs text-slate-400">টিপস: দাম জিজ্ঞেস করুন, তারপর অর্ডার করতে নাম/ফোন/ঠিকানা দিয়ে অর্ডার বটের পুরো ফ্লোটি পরীক্ষা করুন। প্র্যাক্টিস অর্ডার Orders পেজে ডিফল্টভাবে দেখায় না।</p>
                <a href="/dashboard/inbox" className="inline-block text-xs font-semibold text-brand-600 hover:underline">ইনবক্সে প্র্যাক্টিস কথোপকথনটি খুলুন →</a>
              </>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
