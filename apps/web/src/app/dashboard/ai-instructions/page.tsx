"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { knowledgeBodyFromDraft } from "@/lib/inbox-in7";

interface DeskState {
  published: string | null;
  replyLanguage: string | null;
  draft: string | null;
  hasUnpublishedChanges: boolean;
  latestVersion: number | null;
}
interface VersionRow {
  id: string; version: number; instructions: string; replyLanguage: string | null;
  note: string | null; publishedById: string; createdAt: string;
}
interface UnansweredRow {
  id: string; conversationId: string | null; channel: string; questionText: string;
  reason: string; status: string; count: number; lastSeenAt: string | null; createdAt: string;
}
interface TestResult {
  answer: string | null; noAnswer: boolean; intent: string; confidence: number;
  evidence: any; model: string | null;
}
/** IN7e: a display-only draft proposal for an unanswered
 * question — nothing is saved until a human routes it through
 * the knowledge / draft paths. */
interface DraftProposalResult {
  proposal: { kind: "knowledge" | "instruction"; title: string; content: string; reason: string } | null;
  provider: string | null;
  reason?: string;
}

const REASON_LABEL: Record<string, { label: string; cls: string }> = {
  no_answer: { label: "উত্তর মেলেনি", cls: "badge-red" },
  knowledge_gap: { label: "তথ্য নেই", cls: "badge-amber" },
  low_confidence: { label: "আত্মবিশ্বাস কম", cls: "badge-slate" },
};
const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  open: { label: "খোলা আছে", cls: "badge-amber" },
  resolved: { label: "সমাধান হয়েছে", cls: "badge-green" },
  ignored: { label: "উপেক্ষা করা", cls: "badge-slate" },
};

function agoText(iso: string | null): string {
  if (!iso) return "—";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "এইমাত্র";
  if (mins < 60) return `${mins} মিনিট আগে`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} ঘণ্টা আগে`;
  return `${Math.floor(h / 24)} দিন আগে`;
}

/**
 * CX2 — AI Instructions Desk: Draft → Test → Publish.
 * The draft is a persistent working copy; customers only ever
 * see the published text. Publishing appends an immutable
 * version; rollback restores a version (as a new version).
 * The unanswered list shows the questions the autopilot could
 * not answer, captured at its no-answer exits.
 */
export default function AiInstructionsPage() {
  const [state, setState] = useState<DeskState | null>(null);
  const [draft, setDraft] = useState("");
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [unanswered, setUnanswered] = useState<UnansweredRow[]>([]);
  const [myRole, setMyRole] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [question, setQuestion] = useState("");
  const [useDraft, setUseDraft] = useState(true);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [draftProposals, setDraftProposals] = useState<Record<string, DraftProposalResult>>({});

  const canPublish = myRole === "OWNER" || myRole === "ADMIN";

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); return; }
    try {
      const [s, v, u, orgs] = await Promise.all([
        apiFetch<DeskState>(`/organizations/${orgId}/ai-instructions`),
        apiFetch<VersionRow[]>(`/organizations/${orgId}/ai-instructions/versions`).catch(() => [] as VersionRow[]),
        apiFetch<UnansweredRow[]>(`/organizations/${orgId}/ai-instructions/unanswered`).catch(() => [] as UnansweredRow[]),
        apiFetch<{ id: string; myRole: string }[]>(`/organizations`).catch(() => [] as { id: string; myRole: string }[]),
      ]);
      setState(s);
      setDraft(s.draft ?? "");
      setVersions(v);
      setUnanswered(u);
      const mine = orgs.find((o) => o.id === orgId);
      if (mine) setMyRole(mine.myRole);
    } catch (e) { setError(e instanceof Error ? e.message : "লোড করা যায়নি"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function run(key: string, fn: () => Promise<void>, okMsg?: string) {
    setBusy(key); setError(""); setNotice("");
    try {
      await fn();
      if (okMsg) setNotice(okMsg);
    } catch (e) { setError(e instanceof Error ? e.message : "কাজটি করা যায়নি"); }
    finally { setBusy(""); }
  }

  async function saveDraft() {
    const orgId = getOrganizationId(); if (!orgId) return;
    await run("draft", async () => {
      const s = await apiFetch<DeskState>(`/organizations/${orgId}/ai-instructions/draft`, {
        method: "PATCH", body: JSON.stringify({ instructions: draft }),
      });
      setState(s); setDraft(s.draft ?? "");
    }, "✅ Draft সেভ হয়েছে — এটি এখনো Live নয়, customer আগের নির্দেশনাই পাচ্ছেন।");
  }

  async function publish() {
    const orgId = getOrganizationId(); if (!orgId) return;
    await run("publish", async () => {
      await apiFetch(`/organizations/${orgId}/ai-instructions/publish`, {
        method: "POST", body: JSON.stringify({ note: note.trim() ? note.trim() : undefined }),
      });
      setNote("");
      await load();
    }, "🚀 Publish হয়েছে — এখন থেকে AI এই নির্দেশনা অনুযায়ী উত্তর দেবে।");
  }

  async function rollback(v: VersionRow) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(`v${v.version} সংস্করণে ফিরে যাবেন? বর্তমান Live নির্দেশনা বদলে ওই সংস্করণেরটা হয়ে যাবে।`)) return;
    await run(`rollback-${v.id}`, async () => {
      await apiFetch(`/organizations/${orgId}/ai-instructions/rollback`, {
        method: "POST", body: JSON.stringify({ versionId: v.id }),
      });
      await load();
    }, `↩ v${v.version} সংস্করণে ফিরে যাওয়া হয়েছে (নতুন সংস্করণ হিসেবে সংরক্ষিত)।`);
  }

  async function runTest() {
    const orgId = getOrganizationId(); if (!orgId || !question.trim()) return;
    setBusy("test"); setError(""); setNotice(""); setTestResult(null);
    try {
      const res = await apiFetch<TestResult>(`/organizations/${orgId}/ai-instructions/test`, {
        method: "POST", body: JSON.stringify({ question: question.trim(), useDraft }),
      });
      setTestResult(res);
    } catch (e) { setError(e instanceof Error ? e.message : "টেস্ট করা যায়নি"); }
    finally { setBusy(""); }
  }

  async function setUnansweredStatus(row: UnansweredRow, status: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await run(`unanswered-${row.id}`, async () => {
      await apiFetch(`/organizations/${orgId}/ai-instructions/unanswered/${row.id}`, {
        method: "PATCH", body: JSON.stringify({ status }),
      });
      setUnanswered(await apiFetch<UnansweredRow[]>(`/organizations/${orgId}/ai-instructions/unanswered`).catch(() => unanswered));
    });
  }

  function appendToDraft(row: UnansweredRow) {
    const block = `প্রশ্ন: ${row.questionText}\nউত্তর: `;
    setDraft((prev) => (prev ? `${prev}\n${block}` : block));
    setNotice("✎ প্রশ্নটি Draft-এ যোগ হয়েছে — উত্তর লিখে Draft সেভ করুন, টেস্ট করে তারপর Publish করুন।");
  }

  /** IN7e: ask the AI for a draft proposal for this unanswered
   * question. The endpoint only SHOWS a proposal — it writes
   * nothing to knowledge, draft or published instructions. */
  async function proposeDraft(row: UnansweredRow) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await run(`propose-${row.id}`, async () => {
      const res = await apiFetch<DraftProposalResult>(`/organizations/${orgId}/ai-instructions/unanswered/${row.id}/draft-proposal`, { method: "POST" });
      setDraftProposals((prev) => ({ ...prev, [row.id]: res }));
    });
  }

  /** IN7e accept (knowledge kind): send the proposal through the
   * EXISTING knowledge-documents endpoint — a human click, the
   * same create any owner could type by hand on the Knowledge
   * page. */
  async function sendProposalToKnowledge(row: UnansweredRow) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const p = draftProposals[row.id]?.proposal;
    if (!p || p.kind !== "knowledge") return;
    await run(`toknowledge-${row.id}`, async () => {
      await apiFetch(`/organizations/${orgId}/knowledge-documents`, {
        method: "POST", body: JSON.stringify(knowledgeBodyFromDraft(p)),
      });
      setDraftProposals((prev) => { const next = { ...prev }; delete next[row.id]; return next; });
    }, "📚 খসড়াটি জ্ঞানভান্ডারে যোগ হয়েছে — Knowledge পেজে যাচাই করে নিন।");
  }

  /** IN7e accept (instruction kind): put the proposed line into
   * the Desk DRAFT editor only — not saved, not published; the
   * owner still saves/tests/publishes through the normal flow. */
  function sendProposalToDraft(row: UnansweredRow) {
    const p = draftProposals[row.id]?.proposal;
    if (!p || p.kind !== "instruction") return;
    setDraft((prev) => (prev ? `${prev}\n${p.content}` : p.content));
    setDraftProposals((prev) => { const next = { ...prev }; delete next[row.id]; return next; });
    setNotice("✎ প্রস্তাবিত লাইনটি Draft সম্পাদকে বসানো হয়েছে — যাচাই করে Draft সেভ করুন, টেস্ট করে তারপর Publish করুন।");
  }

  const input = "input mt-1.5 w-full";
  const label = "block text-[13px] font-medium text-slate-600";

  return (
    <div className="space-y-4 sm:space-y-5">
      <div>
        <h1 className="text-xl font-bold">🤖 AI Instructions Desk</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
          AI-এর আচরণের নির্দেশনা এখানে Draft আকারে লিখুন, টেস্ট করুন, তারপর Publish করুন।
          Publish না করা পর্যন্ত customer-এর কাছে আগের নির্দেশনাই যায় — প্রতিটি Publish একটি সংস্করণ হিসেবে থেকে যায়, যেকোনো সময় ফিরে যাওয়া যায়।
        </p>
      </div>

      {error ? <div className="alert alert-red">{error}</div> : null}
      {notice ? <div className="alert alert-green">{notice}</div> : null}

      {!state ? (
        <div className="skeleton h-40 w-full" aria-label="লোড হচ্ছে" />
      ) : (
        <>
          <section className="card p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold">Live সংস্করণ</h2>
              <span className="badge-green">● Live</span>
              {state.latestVersion != null ? <span className="badge-brand">সর্বশেষ সংস্করণ: v{state.latestVersion}</span> : null}
              {state.hasUnpublishedChanges ? <span className="badge-amber">অপ্রকাশিত পরিবর্তন আছে</span> : null}
            </div>
            {state.published ? (
              <p className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-700 ring-1 ring-inset ring-slate-100">{state.published}</p>
            ) : (
              <p className="mt-3 text-sm text-slate-400">এখনো কোনো নির্দেশনা Publish করা হয়নি — AI শুধু যাচাইকৃত তথ্য থেকে উত্তর দেয়, আচরণের বাড়তি নির্দেশনা ছাড়া।</p>
            )}
          </section>

          <section className="card p-5 sm:p-6">
            <h2 className="text-base font-bold">✍️ Draft সম্পাদনা</h2>
            <label className={`${label} mt-3`}>AI এর জন্য নির্দেশনা
              <textarea className={input} rows={8} maxLength={2000} value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="যেমন: সবসময় সালাম দিয়ে শুরু করবেন। উত্তর ছোট রাখবেন। কোনো ছাড়ের প্রতিশ্রুতি দেবেন না…" />
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button className="btn-primary min-h-[44px]" disabled={busy === "draft"} onClick={saveDraft}>
                {busy === "draft" ? "অপেক্ষা করুন…" : "💾 Draft সেভ করুন"}
              </button>
              <span className="text-xs text-slate-400">{draft.length}/2000 অক্ষর</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              Draft সেভ হলেও customer-এর কাছে যাবে না — Publish না করা পর্যন্ত আগেরটাই live থাকবে।
            </p>
          </section>

          <section className="card p-5 sm:p-6">
            <h2 className="text-base font-bold">🧪 টেস্ট</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
              <label className={label}>customer-এর একটি প্রশ্ন লিখুন
                <input className={input} maxLength={500} value={question} onChange={(e) => setQuestion(e.target.value)}
                  placeholder="যেমন: ডেলিভারি চার্জ কত?" />
              </label>
              <label className={label}>কোন সংস্করণ দিয়ে টেস্ট?
                <select className="input mt-1.5" value={useDraft ? "draft" : "live"} onChange={(e) => setUseDraft(e.target.value === "draft")}>
                  <option value="draft">Draft</option>
                  <option value="live">Live</option>
                </select>
              </label>
              <button className="btn-primary min-h-[44px]" disabled={busy === "test" || !question.trim()} onClick={runTest}>
                {busy === "test" ? "অপেক্ষা করুন…" : "🧪 টেস্ট করুন"}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">টেস্টে আসল AI কল হতে পারে — সেটি দৈনিক AI ব্যবহারের হিসাবে যুক্ত হয়।</p>

            {testResult ? (
              testResult.noAnswer ? (
                <div className="alert alert-red mt-4">
                  <b>AI এই প্রশ্নের উত্তর দিতে পারবে না।</b>
                  <span className="block text-[13px]">instruction-এ প্রয়োজনীয় তথ্য যোগ করুন, অথবা জ্ঞানভান্ডারে (Knowledge) যোগ করুন — তারপর Draft সেভ করে আবার টেস্ট করুন। (Intent: {testResult.intent})</span>
                </div>
              ) : (
                <div className="mt-4 rounded-xl bg-emerald-50/70 px-4 py-3 ring-1 ring-inset ring-emerald-100">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{testResult.answer}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    Intent: {testResult.intent} · আত্মবিশ্বাস: {testResult.confidence}%
                    {testResult.model ? ` · মডেল: ${testResult.model}` : " · নিয়ম-ভিত্তিক উত্তর (AI কল হয়নি)"}
                    {testResult.evidence?.type ? ` · প্রমাণ: ${testResult.evidence.type}` : ""}
                  </p>
                </div>
              )
            ) : null}
          </section>

          <section className="card p-5 sm:p-6">
            <h2 className="text-base font-bold">🚀 Publish ও সংস্করণ ইতিহাস</h2>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className={`${label} flex-1`}>পরিবর্তনের নোট (ঐচ্ছিক)
                <input className={input} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="যেমন: ছাড়ের প্রতিশ্রুতি নিষেধ করা হলো" />
              </label>
              {canPublish ? (
                <button className="btn-primary min-h-[44px]" disabled={busy === "publish"} onClick={publish}>
                  {busy === "publish" ? "অপেক্ষা করুন…" : "🚀 Publish করুন"}
                </button>
              ) : (
                <p className="text-sm text-slate-400">Publish করতে OWNER বা ADMIN ভূমিকা লাগবে।</p>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-400">Publish করলে বর্তমান Draft-টাই Live হবে এবং নতুন সংস্করণ হিসেবে সংরক্ষিত থাকবে।</p>

            <div className="mt-4 space-y-2">
              {versions.length === 0 ? (
                <p className="text-sm text-slate-400">এখনো কোনো সংস্করণ নেই।</p>
              ) : versions.map((v) => (
                <div key={v.id} className="flex flex-col gap-2 rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-inset ring-slate-100 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <b>v{v.version}</b>
                      <span className="text-xs text-slate-400">{new Date(v.createdAt).toLocaleString("bn-BD")}</span>
                      {v.note ? <span className="badge-slate">{v.note}</span> : null}
                    </div>
                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-600">{v.instructions}</p>
                    <p className="mt-1 text-xs text-slate-400">Publish করেছেন: {v.publishedById}</p>
                  </div>
                  {canPublish ? (
                    <button className="btn-secondary min-h-[40px] shrink-0 px-3 text-[13px]" disabled={busy === `rollback-${v.id}`} onClick={() => rollback(v)}>
                      ↩ এই সংস্করণে ফিরে যান
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          <section className="card p-5 sm:p-6">
            <h2 className="text-base font-bold">❓ AI উত্তর দিতে পারেনি</h2>
            <p className="mt-1 text-[13px] text-slate-500">যেসব প্রশ্নে Autopilot উত্তর দিতে পারেনি — তথ্য যোগ করলেই এই তালিকা কমবে।</p>
            <div className="mt-4 space-y-2">
              {unanswered.length === 0 ? (
                <p className="text-sm text-slate-400">এখনো কোনো অউত্তরিত প্রশ্ন ধরা পড়েনি।</p>
              ) : unanswered.map((row) => {
                const reason = REASON_LABEL[row.reason] ?? { label: row.reason, cls: "badge-slate" };
                const status = STATUS_LABEL[row.status] ?? { label: row.status, cls: "badge-slate" };
                return (
                  <div key={row.id} className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-inset ring-slate-100">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-800">{row.questionText}</span>
                      <span className={reason.cls}>{reason.label}</span>
                      <span className="badge-slate">{row.channel}</span>
                      <span className="badge-slate">×{row.count} বার</span>
                      <span className={status.cls}>{status.label}</span>
                      <span className="text-xs text-slate-400">{agoText(row.lastSeenAt ?? row.createdAt)}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {row.status !== "resolved" ? (
                        <button className="btn-secondary px-3 py-1.5 text-xs" disabled={busy === `unanswered-${row.id}`} onClick={() => setUnansweredStatus(row, "resolved")}>✓ সমাধান হয়েছে</button>
                      ) : null}
                      {row.status !== "ignored" ? (
                        <button className="btn-secondary px-3 py-1.5 text-xs" disabled={busy === `unanswered-${row.id}`} onClick={() => setUnansweredStatus(row, "ignored")}>উপেক্ষা করুন</button>
                      ) : null}
                      {row.status !== "open" ? (
                        <button className="btn-secondary px-3 py-1.5 text-xs" disabled={busy === `unanswered-${row.id}`} onClick={() => setUnansweredStatus(row, "open")}>↩ আবার খুলুন</button>
                      ) : null}
                      <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => appendToDraft(row)}>✎ Instruction-এ যোগ করুন</button>
                      <button className="btn-secondary px-3 py-1.5 text-xs" disabled={busy === `propose-${row.id}`} onClick={() => proposeDraft(row)}>
                        {busy === `propose-${row.id}` ? "ভাবছে…" : "🤖 AI খসড়া প্রস্তাব"}
                      </button>
                    </div>
                    {draftProposals[row.id] ? (
                      draftProposals[row.id].proposal ? (
                        <div className="mt-2 rounded-lg bg-white px-3 py-2 ring-1 ring-inset ring-indigo-100">
                          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-700">
                            <span>{draftProposals[row.id].proposal!.kind === "knowledge" ? "📚 জ্ঞানভান্ডারের খসড়া" : "✎ Instruction লাইনের খসড়া"}</span>
                            <span className="badge-slate">{draftProposals[row.id].proposal!.title}</span>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700">{draftProposals[row.id].proposal!.content}</p>
                          {draftProposals[row.id].proposal!.reason ? (
                            <p className="mt-1 text-xs text-slate-400">কারণ: {draftProposals[row.id].proposal!.reason}</p>
                          ) : null}
                          <div className="mt-2 flex flex-wrap gap-2">
                            {draftProposals[row.id].proposal!.kind === "knowledge" ? (
                              <button className="btn-primary px-3 py-1.5 text-xs" disabled={busy === `toknowledge-${row.id}`} onClick={() => sendProposalToKnowledge(row)}>📚 জ্ঞানভান্ডারে যোগ করুন</button>
                            ) : (
                              <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => sendProposalToDraft(row)}>✎ Draft-এ বসান (Publish নয়)</button>
                            )}
                            <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setDraftProposals((prev) => { const next = { ...prev }; delete next[row.id]; return next; })}>প্রত্যাখ্যান</button>
                          </div>
                          <p className="mt-1 text-[11px] text-slate-400">এটি শুধু প্রস্তাব — আপনি না পাঠালে কোথাও কিছু সংরক্ষিত হয়নি।</p>
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-slate-400">{draftProposals[row.id].reason ?? "খসড়া প্রস্তাব তৈরি হয়নি।"}</p>
                      )
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
