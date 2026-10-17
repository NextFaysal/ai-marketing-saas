"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  BrainOverview,
  approvalAllowsVisibilityChoice,
  approvalTargetText,
  answerOriginLabel,
  answerStatusLabel,
  brandVoiceStatusText,
  canDeleteLearning,
  canWriteLearning,
  coverageAreaLabel,
  defaultApprovalVisibility,
  formatDate,
  invalidReasonLabel,
  languagePrefLabel,
  learnedKindLabel,
  learnedSourceLabel,
  learningStateText,
  previewText,
  unansweredReasonLabel,
  voiceTraitLines,
} from "@/lib/ai-learning";

interface KnowledgeDoc { id: string; title: string; content: string; kind: string; visibility?: string; source?: string }
interface LearnedItem { id: string; kind: string; sourceType: string; title: string; content: any; status: string; createdAt: string }
interface StoredAnswer { id: string; question: string; answerPreview: string; channel: string; origin: string; status: string; invalidReason: string | null; hitCount: number; updatedAt: string }
interface VoiceProfile { status: string; traits: any; pendingTraits: any; exampleSnippets?: unknown }
interface Unanswered { id: string; questionText: string; reason: string; count: number; status: string; lastSeenAt?: string | null }
interface Memory { id: string; customerKey: string; displayName: string | null; languagePref: string | null; orderCount: number; lastInteractionAt: string | null }

const BTN = "rounded-lg border px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50";
const FUTURE_SOURCES = "Facebook/Instagram কমেন্ট, Social পোস্টের ফল, Ads ও Campaign, Competitor, Review, Support Ticket, Courier/Returns, Lead/CRM, Broadcast-এর ফল";

/**
 * SA-B6 (Smart AI Phase 0, P9) — Learn Dashboard: Organization
 * Settings → "🧠 AI শিখন". Shows what the org's AI Brain knows,
 * where it learned from, and gives the human the controls the
 * laws require: review mined suggestions before they go live
 * (D3), manage stored answers, forget a customer, and decide
 * what the AI may learn from. Every number comes from the
 * brain-overview aggregates — nothing here is estimated.
 * Mutations mirror the API's roles: writes OWNER/ADMIN/
 * MARKETING_MANAGER, deletes OWNER/ADMIN.
 */
export function AiLearningSection() {
  const [overview, setOverview] = useState<BrainOverview | null>(null);
  const [role, setRole] = useState("");
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [suggestions, setSuggestions] = useState<LearnedItem[]>([]);
  const [answers, setAnswers] = useState<StoredAnswer[]>([]);
  const [answerStatus, setAnswerStatus] = useState("");
  const [answerSearch, setAnswerSearch] = useState("");
  const [voice, setVoice] = useState<VoiceProfile | null>(null);
  const [unanswered, setUnanswered] = useState<Unanswered[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [visChoice, setVisChoice] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [loaded, setLoaded] = useState(false);

  const orgId = typeof window !== "undefined" ? getOrganizationId() : null;
  const canWrite = canWriteLearning(role);
  const canDelete = canDeleteLearning(role);

  const load = useCallback(async () => {
    const id = getOrganizationId();
    if (!id) { setError("কোনো Organization নির্বাচিত নেই।"); setLoaded(true); return; }
    const [mine, ov, d, s, a, v, u, m] = await Promise.all([
      apiFetch<{ id: string; myRole: string }[]>(`/organizations`).catch(() => [] as { id: string; myRole: string }[]),
      apiFetch<BrainOverview>(`/organizations/${id}/brain-overview`).catch(() => null),
      apiFetch<KnowledgeDoc[]>(`/organizations/${id}/knowledge-documents`).catch(() => [] as KnowledgeDoc[]),
      apiFetch<{ items: LearnedItem[] }>(`/organizations/${id}/learning-items?status=suggested&limit=50`).catch(() => ({ items: [] as LearnedItem[] })),
      apiFetch<{ items: StoredAnswer[] }>(`/organizations/${id}/answer-store?limit=50`).catch(() => ({ items: [] as StoredAnswer[] })),
      apiFetch<VoiceProfile | null>(`/organizations/${id}/brand-voice`).catch(() => null),
      apiFetch<Unanswered[]>(`/organizations/${id}/ai-instructions/unanswered?status=open&take=50`).catch(() => [] as Unanswered[]),
      apiFetch<{ items: Memory[] }>(`/organizations/${id}/customer-memories?limit=50`).catch(() => ({ items: [] as Memory[] })),
    ]);
    setRole(mine.find((x) => x.id === id)?.myRole ?? "");
    if (!ov) setError("AI শিখনের তথ্য লোড করা যায়নি।");
    setOverview(ov);
    setDocs(d ?? []);
    setSuggestions(s?.items ?? []);
    setAnswers(a?.items ?? []);
    setVoice(v);
    setUnanswered(u ?? []);
    setMemories(m?.items ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function act(key: string, fn: () => Promise<unknown>, okMsg: string) {
    setBusy(key); setError(""); setNotice("");
    try {
      await fn();
      setNotice(okMsg);
      await load();
    } catch (e) {
      // A refusal (e.g. the Answer Store's PII screen on approve,
      // SA-B4) must be SEEN — never swallowed as silent success.
      setError(e instanceof Error ? e.message : "কাজটি করা যায়নি");
    } finally { setBusy(""); }
  }

  async function reloadAnswers(status: string, search: string) {
    if (!orgId) return;
    const qs = new URLSearchParams({ limit: "50" });
    if (status) qs.set("status", status);
    if (search.trim()) qs.set("search", search.trim());
    const a = await apiFetch<{ items: StoredAnswer[] }>(`/organizations/${orgId}/answer-store?${qs.toString()}`).catch(() => ({ items: [] as StoredAnswer[] }));
    setAnswers(a?.items ?? []);
  }

  function toggleProfileFlag(field: "conversationLearningEnabled" | "websiteLearningEnabled" | "answerStoreEnabled", value: boolean) {
    if (!orgId) return;
    act(`toggle-${field}`, () => apiFetch(`/organizations/${orgId}/business-profile`, { method: "PATCH", body: JSON.stringify({ [field]: value }) }),
      field === "answerStoreEnabled"
        ? (value ? "উত্তর ভান্ডার চালু করা হয়েছে।" : "উত্তর ভান্ডার বন্ধ করা হয়েছে — AI আর সংরক্ষিত উত্তর ব্যবহার করবে না, নতুন উত্তরও জমাবে না। জমা থাকা উত্তর মুছে যায়নি।")
        : (value ? "শেখা চালু করা হয়েছে।" : "শেখা বন্ধ করা হয়েছে।"));
  }

  function toggleDocVisibility(doc: KnowledgeDoc) {
    if (!orgId) return;
    const next = doc.visibility === "internal" ? "public" : "internal";
    act(`doc-${doc.id}`, () => apiFetch(`/organizations/${orgId}/knowledge-documents/${doc.id}`, { method: "PATCH", body: JSON.stringify({ visibility: next }) }),
      next === "internal" ? "ডকুমেন্টটি এখন শুধু ভেতরের — AI এটি customer-কে বলবে না।" : "ডকুমেন্টটি এখন সবার জন্য — AI এটি customer-কে বলতে পারবে।");
  }

  function approveItem(item: LearnedItem) {
    if (!orgId) return;
    const body: Record<string, unknown> = {};
    if (approvalAllowsVisibilityChoice(item)) body.visibility = visChoice[item.id] ?? defaultApprovalVisibility(item);
    act(`approve-${item.id}`, () => apiFetch(`/organizations/${orgId}/learning-items/${item.id}/approve`, { method: "POST", body: JSON.stringify(body) }),
      "প্রস্তাবটি অনুমোদিত হয়েছে।");
  }

  function rejectItem(item: LearnedItem) {
    if (!orgId) return;
    act(`reject-${item.id}`, () => apiFetch(`/organizations/${orgId}/learning-items/${item.id}/reject`, { method: "POST", body: JSON.stringify({}) }),
      "প্রস্তাবটি বাতিল করা হয়েছে।");
  }

  function changeAnswerStatus(a: StoredAnswer, status: "active" | "disabled") {
    if (!orgId) return;
    act(`answer-${a.id}`, () => apiFetch(`/organizations/${orgId}/answer-store/${a.id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
      status === "disabled" ? "উত্তরটি বন্ধ করা হয়েছে — AI আর এটি ব্যবহার করবে না।" : "উত্তরটি আবার চালু করা হয়েছে।");
  }

  function deleteAnswer(a: StoredAnswer) {
    if (!orgId) return;
    act(`answer-del-${a.id}`, () => apiFetch(`/organizations/${orgId}/answer-store/${a.id}`, { method: "DELETE" }), "উত্তরটি মুছে ফেলা হয়েছে।");
  }

  function forgetMemory(m: Memory) {
    if (!orgId) return;
    act(`memory-del-${m.id}`, () => apiFetch(`/organizations/${orgId}/customer-memories/${m.id}`, { method: "DELETE" }), "কাস্টমারের স্মৃতি মুছে ফেলা হয়েছে।");
  }

  function triageUnanswered(q: Unanswered, status: "resolved" | "ignored") {
    if (!orgId) return;
    act(`unanswered-${q.id}`, () => apiFetch(`/organizations/${orgId}/ai-instructions/unanswered/${q.id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
      status === "resolved" ? "প্রশ্নটি সমাধান হয়েছে হিসেবে চিহ্নিত।" : "প্রশ্নটি উপেক্ষা করা হয়েছে।");
  }

  const toggles = overview?.learning.toggles;

  return (
    <section id="hub-ai-learning" className="card scroll-mt-24 p-5 sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <span className="stat-icon stat-icon-brand !h-10 !w-10 text-lg">🧠</span>
        <div className="min-w-0">
          <h2 className="font-semibold leading-tight text-slate-900">AI শিখন</h2>
          <p className="mt-0.5 text-[13px] leading-snug text-slate-500">আপনার ব্যবসার AI কী জানে, কোথা থেকে শিখেছে, আর কী শিখবে — সব এখান থেকে দেখা ও নিয়ন্ত্রণ করা যায়। AI নিজে থেকে কিছু শিখে চালু করে না; প্রস্তাব আগে এখানে আসে, আপনি অনুমোদন দিলেই কেবল তা কাজে লাগে।</p>
        </div>
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {notice ? <p className="mb-3 text-sm text-green-600">{notice}</p> : null}
      {!loaded ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : null}

      {loaded && overview ? (
        <div className="space-y-8">
          {/* ---- কী জানে: overview + coverage ---- */}
          <div>
            <div className="font-semibold">AI কী জানে</div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-xl font-bold">{overview.knowledge.total}</div>
                <div className="text-[13px] text-slate-500">জ্ঞান ডকুমেন্ট (সবার জন্য {overview.knowledge.public} · শুধু ভেতরের {overview.knowledge.internal})</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-xl font-bold">{overview.embeddings.indexedChunks}</div>
                <div className="text-[13px] text-slate-500">অর্থ দিয়ে খুঁজে পাওয়া অংশ — {overview.embeddings.available ? "অর্থ + শব্দ মিলিয়ে খোঁজা চালু" : "এখন শুধু শব্দ মিলিয়ে খোঁজা চলছে (অর্থ-খোঁজার সেবা পাওয়া যাচ্ছে না)"} · পণ্য সূচিতে {overview.embeddings.indexedProducts}টি</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-xl font-bold">{overview.answers.active}</div>
                <div className="text-[13px] text-slate-500">সংরক্ষিত যাচাইকৃত উত্তর — মোট {overview.answers.totalHits} বার AI-কে না ডেকেই ব্যবহার হয়েছে</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-xl font-bold">{overview.learning.pendingSuggestions}</div>
                <div className="text-[13px] text-slate-500">শেখার প্রস্তাব আপনার সিদ্ধান্তের অপেক্ষায়</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-xl font-bold">{overview.unanswered.open}</div>
                <div className="text-[13px] text-slate-500">উত্তর-না-পাওয়া প্রশ্ন (AI যেখানে আটকেছে)</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-xl font-bold">{overview.customerMemories.count}</div>
                <div className="text-[13px] text-slate-500">কাস্টমারের স্মৃতি</div>
              </div>
            </div>
            <div className="mt-3 rounded-lg bg-slate-50 p-3">
              <div className="text-sm"><span className="font-semibold">জ্ঞানের আওতা: {overview.coverage.percent}%</span> <span className="text-slate-500">— কোন কোন জায়গায় AI-এর জানার মতো তথ্য আছে (এটি তথ্যের পরিমাণের হিসাব, মানের বিচার নয়)।</span></div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {overview.coverage.areas.map((a) => (
                  <span key={a.key} className={`rounded px-2 py-0.5 text-xs ${a.present ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-500"}`}>
                    {a.present ? "✓" : "✗"} {coverageAreaLabel(a.key)}
                  </span>
                ))}
              </div>
              {overview.coverage.gaps.length > 0 ? (
                <p className="mt-2 text-[13px] text-slate-500">যেখানে এখনো কিছু নেই: {overview.coverage.gaps.map(coverageAreaLabel).join(", ")}।</p>
              ) : null}
            </div>
          </div>

          {/* ---- শেখার উৎস ---- */}
          <div className="border-t border-slate-100 pt-6">
            <div className="font-semibold">শেখার উৎস</div>
            <ul className="mt-3 space-y-3 text-sm">
              <li className="rounded-lg bg-slate-50 p-3">
                <span className="font-medium">ব্যবসার প্রোফাইল ও পলিসি</span>{" "}
                <span className="text-slate-500">— এই সেটিংস পেজের <a href="#hub-identity" className="font-medium text-indigo-600 underline">পরিচিতি</a> ও <a href="#hub-knowledge" className="font-medium text-indigo-600 underline">Business Knowledge</a> থেকে। AI সবসময় এগুলো জানে।</span>
              </li>
              <li className="rounded-lg bg-slate-50 p-3">
                <span className="font-medium">পণ্য ও ক্যাটালগ</span>{" "}
                <span className="text-slate-500">— {overview.embeddings.indexedProducts}টি পণ্য অর্থ-খোঁজার সূচিতে আছে। দাম ও স্টক AI সবসময় সরাসরি (live) দেখে — শেখা কপি থেকে নয়।</span>
              </li>
              <li className="rounded-lg bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">নিজের ওয়েবসাইট</span>
                  {canWrite && toggles ? (
                    <button className={BTN} disabled={busy === "toggle-websiteLearningEnabled"} onClick={() => toggleProfileFlag("websiteLearningEnabled", !toggles.websiteLearningEnabled)}>
                      {toggles.websiteLearningEnabled ? "বন্ধ করুন" : "চালু করুন"}
                    </button>
                  ) : null}
                </div>
                <p className="mt-1 text-slate-500">
                  {toggles?.websiteLearningEnabled ? "চালু আছে" : "বন্ধ আছে"}
                  {toggles?.websiteUrl ? <> — {toggles.websiteUrl}</> : " — প্রোফাইলে ওয়েবসাইটের ঠিকানা দেওয়া নেই, তাই শেখার কিছু নেই"}
                  {" · "}{learningStateText(overview.learning.sources.website)}
                </p>
              </li>
              <li className="rounded-lg bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">কথোপকথন (Inbox)</span>
                  {canWrite && toggles ? (
                    <button className={BTN} disabled={busy === "toggle-conversationLearningEnabled"} onClick={() => toggleProfileFlag("conversationLearningEnabled", !toggles.conversationLearningEnabled)}>
                      {toggles.conversationLearningEnabled ? "বন্ধ করুন" : "চালু করুন"}
                    </button>
                  ) : null}
                </div>
                <p className="mt-1 text-slate-500">
                  {toggles?.conversationLearningEnabled ? "চালু আছে" : "বন্ধ আছে (ডিফল্ট)"}
                  {" · "}{learningStateText(overview.learning.sources.conversation)}
                </p>
                <p className="mt-1 text-[13px] text-slate-500">চালু থাকলেই কেবল AI বন্ধ হয়ে যাওয়া কথোপকথন থেকে শেখার প্রস্তাব তৈরি করে। ব্যক্তিগত তথ্য (ফোন নম্বর ইত্যাদি) আগেই ছেঁটে ফেলা হয়, আর প্রস্তাব আপনার অনুমোদন ছাড়া কখনো চালু হয় না।</p>
              </li>
              <li className="rounded-lg bg-slate-50 p-3">
                <span className="font-medium">পারফরম্যান্স</span>{" "}
                <span className="text-slate-500">— কোন পণ্য বেশি বিক্রি হয়, কোথায় বিক্রি আটকায় — হিসাব করে শেখা (AI দিয়ে বানানো নয়)। {overview.performance ? `সর্বশেষ হিসাব: ${formatDate(overview.performance.lastSnapshotAt)}` : "এখনো হিসাব হয়নি"}। এই সংখ্যা শুধু আপনার টিমের জন্য — customer-কে কখনো দেখানো হয় না।</span>
              </li>
              <li className="rounded-lg bg-slate-50 p-3">
                <span className="font-medium">ব্র্যান্ড ভয়েস</span>{" "}
                <span className="text-slate-500">— {brandVoiceStatusText(overview.brandVoice.status, overview.brandVoice.hasPendingSuggestion)} (নিচে বিস্তারিত)।</span>
              </li>
            </ul>
            <p className="mt-2 text-[13px] text-slate-400">পরের ধাপে আসছে: {FUTURE_SOURCES} — এগুলো এখনো শেখার উৎস হিসেবে যুক্ত হয়নি।</p>
          </div>

          {/* ---- জ্ঞান ডকুমেন্টের ধরন ---- */}
          <div className="border-t border-slate-100 pt-6">
            <div className="font-semibold">জ্ঞান ডকুমেন্ট — কে দেখতে পাবে</div>
            <p className="mt-1 text-[13px] text-slate-500">“সবার জন্য” ডকুমেন্ট AI customer-কে বলতে পারে; “শুধু ভেতরের” ডকুমেন্ট শুধু আপনার টিমের AI-সহায়তায় কাজে লাগে, customer-এর উত্তরে কখনো যায় না। নোট ধরনের ডকুমেন্ট তৈরি হলেই “শুধু ভেতরের” ধরা হয়।</p>
            {docs.length === 0 ? <p className="mt-2 text-sm text-slate-500">এখনো কোনো ডকুমেন্ট নেই।</p> : (
              <ul className="mt-3 space-y-2">
                {docs.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium">{d.title}</span>{" "}
                      <span className="text-slate-400">({d.kind})</span>{" "}
                      {d.visibility === "internal"
                        ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">🔒 শুধু ভেতরের</span>
                        : <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700">🌐 সবার জন্য</span>}
                    </span>
                    {canWrite ? (
                      <button className={BTN} disabled={busy === `doc-${d.id}`} onClick={() => toggleDocVisibility(d)}>
                        {d.visibility === "internal" ? "সবার জন্য করুন" : "শুধু ভেতরের করুন"}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ---- শেখার প্রস্তাব ---- */}
          <div className="border-t border-slate-100 pt-6">
            <div className="font-semibold">শেখার প্রস্তাব — আপনার সিদ্ধান্তের অপেক্ষায়</div>
            {suggestions.length === 0 ? <p className="mt-2 text-sm text-slate-500">এখন কোনো প্রস্তাব অপেক্ষায় নেই।</p> : (
              <ul className="mt-3 space-y-2">
                {suggestions.map((item) => (
                  <li key={item.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                    <div>
                      <span className="font-medium">{item.title}</span>{" "}
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">{learnedKindLabel(item.kind)}</span>{" "}
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">{learnedSourceLabel(item.sourceType)}</span>
                    </div>
                    {item.kind === "faq_pair" ? (
                      <div className="mt-1 text-slate-600">
                        <div>প্রশ্ন: {String(item.content?.question ?? "")}</div>
                        <div>উত্তর: {previewText(String(item.content?.answer ?? ""))}</div>
                      </div>
                    ) : (
                      <div className="mt-1 text-slate-600">{previewText(String(item.content?.text ?? ""))}</div>
                    )}
                    <div className="mt-1 text-[13px] text-slate-400">{approvalTargetText(item)}</div>
                    {canWrite ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {approvalAllowsVisibilityChoice(item) ? (
                          <select
                            className="rounded-lg border px-2 py-1.5 text-[13px]"
                            value={visChoice[item.id] ?? defaultApprovalVisibility(item)}
                            onChange={(e) => setVisChoice({ ...visChoice, [item.id]: e.target.value })}
                            aria-label="কে দেখতে পাবে"
                          >
                            <option value="public">সবার জন্য</option>
                            <option value="internal">শুধু ভেতরের</option>
                          </select>
                        ) : null}
                        <button className={BTN} disabled={busy === `approve-${item.id}`} onClick={() => approveItem(item)}>অনুমোদন করুন</button>
                        <button className={BTN} disabled={busy === `reject-${item.id}`} onClick={() => rejectItem(item)}>বাতিল করুন</button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ---- উত্তর ভান্ডার ---- */}
          <div className="border-t border-slate-100 pt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold">উত্তর ভান্ডার</div>
              {canWrite ? (
                <button className={BTN} disabled={busy === "toggle-answerStoreEnabled"} onClick={() => toggleProfileFlag("answerStoreEnabled", overview.answers.storeEnabled === false)}>
                  {overview.answers.storeEnabled === false ? "ভান্ডার চালু করুন" : "ভান্ডার বন্ধ করুন"}
                </button>
              ) : null}
            </div>
            <p className="mt-1 text-[13px] text-slate-500">বারবার আসা প্রশ্নের যাচাইকৃত উত্তর এখানে জমা থাকে — মিলে গেলে AI-কে নতুন করে না ডেকেই পাঠানো হয়। উৎসের তথ্য বদলে গেলে উত্তরটি নিজে থেকেই বাতিল হয়ে যায়; বাতিল উত্তর আবার চালু করা যায় না, শুধু মোছা যায়।</p>
            {overview.answers.storeEnabled === false ? (
              <p className="mt-2 rounded-lg bg-amber-50 p-3 text-[13px] text-amber-800">উত্তর ভান্ডার এখন <b>বন্ধ</b> আছে — AI সংরক্ষিত উত্তর ব্যবহার করছে না এবং নতুন উত্তরও জমাচ্ছে না। জমা থাকা উত্তরগুলো নিচে আগের মতোই আছে; আবার চালু করলেই সেগুলো আবার কাজে লাগবে।</p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                className="rounded-lg border px-3 py-2 text-sm"
                placeholder="প্রশ্ন খুঁজুন"
                value={answerSearch}
                onChange={(e) => setAnswerSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") reloadAnswers(answerStatus, answerSearch); }}
              />
              <select className="rounded-lg border px-2 py-2 text-sm" value={answerStatus} onChange={(e) => { setAnswerStatus(e.target.value); reloadAnswers(e.target.value, answerSearch); }} aria-label="অবস্থা">
                <option value="">সব অবস্থা</option>
                <option value="active">চালু</option>
                <option value="disabled">বন্ধ</option>
                <option value="invalidated">বাতিল</option>
              </select>
              <button className={BTN} onClick={() => reloadAnswers(answerStatus, answerSearch)}>খুঁজুন</button>
            </div>
            {answers.length === 0 ? <p className="mt-2 text-sm text-slate-500">এই তালিকায় কোনো উত্তর নেই।</p> : (
              <ul className="mt-3 space-y-2">
                {answers.map((a) => (
                  <li key={a.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                    <div>
                      <span className="font-medium">{a.question}</span>{" "}
                      <span className={`rounded px-1.5 py-0.5 text-xs ${a.status === "active" ? "bg-green-100 text-green-700" : a.status === "disabled" ? "bg-slate-200 text-slate-600" : "bg-red-100 text-red-700"}`}>{answerStatusLabel(a.status)}</span>{" "}
                      <span className="text-slate-400">{answerOriginLabel(a.origin)} · {a.hitCount} বার ব্যবহৃত</span>
                    </div>
                    <div className="mt-1 text-slate-600">{a.answerPreview}</div>
                    {a.status === "invalidated" ? (
                      <div className="mt-1 text-[13px] text-red-600">বাতিলের কারণ: {invalidReasonLabel(a.invalidReason)}। এই উত্তর আবার চালু করা যাবে না — দরকার হলে মুছে ফেলুন; নতুন যাচাইকৃত উত্তর এলে তা নিজে থেকেই জায়গা নেবে।</div>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {canWrite && a.status === "active" ? (
                        <button className={BTN} disabled={busy === `answer-${a.id}`} onClick={() => changeAnswerStatus(a, "disabled")}>বন্ধ করুন</button>
                      ) : null}
                      {canWrite && a.status === "disabled" ? (
                        <button className={BTN} disabled={busy === `answer-${a.id}`} onClick={() => changeAnswerStatus(a, "active")}>চালু করুন</button>
                      ) : null}
                      {canDelete ? (
                        confirming[`answer-${a.id}`] ? (
                          <>
                            <button className={`${BTN} !border-red-300 text-red-700`} disabled={busy === `answer-del-${a.id}`} onClick={() => deleteAnswer(a)}>নিশ্চিত মুছুন</button>
                            <button className={BTN} onClick={() => setConfirming({ ...confirming, [`answer-${a.id}`]: false })}>থাক</button>
                          </>
                        ) : (
                          <button className={BTN} onClick={() => setConfirming({ ...confirming, [`answer-${a.id}`]: true })}>মুছে ফেলুন</button>
                        )
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ---- ব্র্যান্ড ভয়েস ---- */}
          <div className="border-t border-slate-100 pt-6">
            <div className="font-semibold">ব্র্যান্ড ভয়েস</div>
            {!voice ? (
              <p className="mt-2 text-sm text-slate-500">এখনো কোনো ভয়েস শেখা হয়নি। কথোপকথন থেকে শেখা চালু থাকলে, আপনার টিমের লেখার ঢঙ থেকে AI একটি প্রস্তাব তৈরি করবে।</p>
            ) : (
              <div className="mt-2 text-sm">
                <p className="text-slate-600">অবস্থা: <span className="font-medium">{brandVoiceStatusText(voice.status, !!voice.pendingTraits)}</span></p>
                {voice.status === "active" ? (
                  <ul className="mt-2 list-inside list-disc text-slate-600">
                    {voiceTraitLines(voice.traits).map((l) => <li key={l}>{l}</li>)}
                  </ul>
                ) : null}
                {voice.status === "suggested" ? (
                  <ul className="mt-2 list-inside list-disc text-slate-600">
                    {voiceTraitLines(voice.traits).map((l) => <li key={l}>{l}</li>)}
                  </ul>
                ) : null}
                {voice.pendingTraits ? (
                  <div className="mt-2 rounded-lg bg-amber-50 p-3">
                    <div className="font-medium text-amber-800">নতুন প্রস্তাব এসেছে</div>
                    <ul className="mt-1 list-inside list-disc text-slate-600">
                      {voiceTraitLines(voice.pendingTraits).map((l) => <li key={l}>{l}</li>)}
                    </ul>
                  </div>
                ) : null}
                {canWrite && (voice.status === "suggested" || voice.pendingTraits) ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button className={BTN} disabled={busy === "voice-activate"} onClick={() => act("voice-activate", () => apiFetch(`/organizations/${orgId}/brand-voice/activate`, { method: "POST", body: JSON.stringify({}) }), "ব্র্যান্ড ভয়েস চালু করা হয়েছে।")}>চালু করুন</button>
                    <button className={BTN} disabled={busy === "voice-dismiss"} onClick={() => act("voice-dismiss", () => apiFetch(`/organizations/${orgId}/brand-voice/dismiss`, { method: "POST", body: JSON.stringify({}) }), "প্রস্তাবটি বাতিল করা হয়েছে।")}>বাতিল করুন</button>
                  </div>
                ) : null}
                <p className="mt-2 text-[13px] text-slate-400">আপনি Business Profile-এ নিজে যে ব্র্যান্ড ভয়েস লিখে রেখেছেন, সেটাই সবসময় আগে প্রযোজ্য — শেখা ভয়েস শুধু তার পাশাপাশি সহায়তা করে। ভয়েস শুধু লেখার ঢঙ বদলায়, কোনো তথ্য নয়।</p>
              </div>
            )}
          </div>

          {/* ---- উত্তর-না-পাওয়া প্রশ্ন ---- */}
          <div className="border-t border-slate-100 pt-6">
            <div className="font-semibold">উত্তর-না-পাওয়া প্রশ্ন</div>
            <p className="mt-1 text-[13px] text-slate-500">যেসব প্রশ্নে AI জানা তথ্য থেকে উত্তর দিতে পারেনি। এগুলোর উত্তর জ্ঞানে যোগ করলে AI পরের বার পারবে।</p>
            {unanswered.length === 0 ? <p className="mt-2 text-sm text-slate-500">এখন কোনো অমীমাংসিত প্রশ্ন নেই।</p> : (
              <ul className="mt-3 space-y-2">
                {unanswered.map((q) => (
                  <li key={q.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                    <div>
                      <span className="font-medium">{q.questionText}</span>{" "}
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">{unansweredReasonLabel(q.reason)}</span>{" "}
                      {q.count > 1 ? <span className="text-slate-400">{q.count} বার এসেছে</span> : null}
                    </div>
                    {canWrite ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button className={BTN} disabled={busy === `unanswered-${q.id}`} onClick={() => triageUnanswered(q, "resolved")}>সমাধান হয়েছে</button>
                        <button className={BTN} disabled={busy === `unanswered-${q.id}`} onClick={() => triageUnanswered(q, "ignored")}>উপেক্ষা করুন</button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ---- কাস্টমার স্মৃতি ---- */}
          <div className="border-t border-slate-100 pt-6">
            <div className="font-semibold">কাস্টমার স্মৃতি</div>
            <p className="mt-1 text-[13px] text-slate-500">কোন কাস্টমার কোন ভাষায় কথা বলেন, কী নিয়ে আগ্রহী, আগে কী কিনেছেন — AI এগুলো মনে রাখে যাতে উত্তর তাঁর জন্য মানানসই হয়। এই স্মৃতি শুধু ওই কাস্টমারের নিজের কথোপকথনেই ব্যবহার হয় — অন্য কাস্টমার বা বাইরের কেউ তা কখনো দেখতে পায় না। ভুল মনে হলে যেকোনো কাস্টমারের স্মৃতি মুছে ফেলা যায়।</p>
            {memories.length === 0 ? <p className="mt-2 text-sm text-slate-500">এখনো কোনো কাস্টমারের স্মৃতি তৈরি হয়নি।</p> : (
              <ul className="mt-3 space-y-2">
                {memories.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 text-sm">
                    <span>
                      <span className="font-medium">{m.displayName ?? m.customerKey}</span>{" "}
                      <span className="text-slate-500">· ভাষা: {languagePrefLabel(m.languagePref)} · অর্ডার: {m.orderCount}টি · শেষ যোগাযোগ: {formatDate(m.lastInteractionAt)}</span>
                    </span>
                    {canDelete ? (
                      confirming[`memory-${m.id}`] ? (
                        <span className="flex gap-2">
                          <button className={`${BTN} !border-red-300 text-red-700`} disabled={busy === `memory-del-${m.id}`} onClick={() => forgetMemory(m)}>নিশ্চিত ভুলে যান</button>
                          <button className={BTN} onClick={() => setConfirming({ ...confirming, [`memory-${m.id}`]: false })}>থাক</button>
                        </span>
                      ) : (
                        <button className={BTN} onClick={() => setConfirming({ ...confirming, [`memory-${m.id}`]: true })}>ভুলে যান</button>
                      )
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
