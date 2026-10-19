"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { knowledgeBodyFromDraft } from "@/lib/inbox-in7";
import { fmtDateTime, fmtNumber, fmtRelative, type UiLocale } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";

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

const REASON_LABEL_KEY: Record<string, { labelKey: string; cls: string }> = {
  no_answer: { labelKey: "ai.insReasonNoAnswer", cls: "badge-red" },
  knowledge_gap: { labelKey: "ai.insReasonKnowledgeGap", cls: "badge-amber" },
  low_confidence: { labelKey: "ai.insReasonLowConfidence", cls: "badge-slate" },
};
const STATUS_LABEL_KEY: Record<string, { labelKey: string; cls: string }> = {
  open: { labelKey: "ai.insStatusOpen", cls: "badge-amber" },
  resolved: { labelKey: "ai.insStatusResolved", cls: "badge-green" },
  ignored: { labelKey: "ai.insStatusIgnored", cls: "badge-slate" },
};

function agoText(iso: string | null, locale: UiLocale, justNow: string): string {
  if (!iso) return "—";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return justNow;
  return fmtRelative(locale, iso);
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
  const { t, locale } = useLocale();
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
    if (!orgId) { setError(t("ai.insNoOrg")); return; }
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
    } catch (e) { setError(e instanceof Error ? e.message : t("ai.insLoadFailed")); }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  async function run(key: string, fn: () => Promise<void>, okMsg?: string) {
    setBusy(key); setError(""); setNotice("");
    try {
      await fn();
      if (okMsg) setNotice(okMsg);
    } catch (e) { setError(e instanceof Error ? e.message : t("ai.insActionFailed")); }
    finally { setBusy(""); }
  }

  async function saveDraft() {
    const orgId = getOrganizationId(); if (!orgId) return;
    await run("draft", async () => {
      const s = await apiFetch<DeskState>(`/organizations/${orgId}/ai-instructions/draft`, {
        method: "PATCH", body: JSON.stringify({ instructions: draft }),
      });
      setState(s); setDraft(s.draft ?? "");
    }, t("ai.insDraftSaved"));
  }

  async function publish() {
    const orgId = getOrganizationId(); if (!orgId) return;
    await run("publish", async () => {
      await apiFetch(`/organizations/${orgId}/ai-instructions/publish`, {
        method: "POST", body: JSON.stringify({ note: note.trim() ? note.trim() : undefined }),
      });
      setNote("");
      await load();
    }, t("ai.insPublished"));
  }

  async function rollback(v: VersionRow) {
    const orgId = getOrganizationId(); if (!orgId) return;
    if (!window.confirm(t("ai.insRollbackConfirm", { version: v.version }))) return;
    await run(`rollback-${v.id}`, async () => {
      await apiFetch(`/organizations/${orgId}/ai-instructions/rollback`, {
        method: "POST", body: JSON.stringify({ versionId: v.id }),
      });
      await load();
    }, t("ai.insRolledBack", { version: v.version }));
  }

  async function runTest() {
    const orgId = getOrganizationId(); if (!orgId || !question.trim()) return;
    setBusy("test"); setError(""); setNotice(""); setTestResult(null);
    try {
      const res = await apiFetch<TestResult>(`/organizations/${orgId}/ai-instructions/test`, {
        method: "POST", body: JSON.stringify({ question: question.trim(), useDraft }),
      });
      setTestResult(res);
    } catch (e) { setError(e instanceof Error ? e.message : t("ai.insTestFailed")); }
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
    const block = `${t("ai.insQuestionPrefix")}${row.questionText}\n${t("ai.insAnswerPrefix")}`;
    setDraft((prev) => (prev ? `${prev}\n${block}` : block));
    setNotice(t("ai.insAddedToDraft"));
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
    }, t("ai.insAddedToKnowledge"));
  }

  /** IN7e accept (instruction kind): put the proposed line into
   * the Desk DRAFT editor only — not saved, not published; the
   * owner still saves/tests/publishes through the normal flow. */
  function sendProposalToDraft(row: UnansweredRow) {
    const p = draftProposals[row.id]?.proposal;
    if (!p || p.kind !== "instruction") return;
    setDraft((prev) => (prev ? `${prev}\n${p.content}` : p.content));
    setDraftProposals((prev) => { const next = { ...prev }; delete next[row.id]; return next; });
    setNotice(t("ai.insProposalInDraft"));
  }

  const input = "input mt-1.5 w-full";
  const label = "block text-[13px] font-medium text-slate-600";

  return (
    <div className="space-y-4 sm:space-y-5">
      <div>
        <h1 className="text-xl font-bold">🤖 AI Instructions Desk</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
          {t("ai.insSubtitle1")}
          {t("ai.insSubtitle2")}
        </p>
      </div>

      {error ? <div className="alert alert-red">{error}</div> : null}
      {notice ? <div className="alert alert-green">{notice}</div> : null}

      {!state ? (
        <div className="skeleton h-40 w-full" aria-label={t("ai.insLoading")} />
      ) : (
        <>
          <section className="card p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold">{t("ai.insLiveVersion")}</h2>
              <span className="badge-green">● Live</span>
              {state.latestVersion != null ? <span className="badge-brand">{t("ai.insLatestVersion", { version: state.latestVersion })}</span> : null}
              {state.hasUnpublishedChanges ? <span className="badge-amber">{t("ai.insUnpublishedChanges")}</span> : null}
            </div>
            {state.published ? (
              <p className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-700 ring-1 ring-inset ring-slate-100">{state.published}</p>
            ) : (
              <p className="mt-3 text-sm text-slate-400">{t("ai.insNoPublished")}</p>
            )}
          </section>

          <section className="card p-5 sm:p-6">
            <h2 className="text-base font-bold">{t("ai.insDraftEdit")}</h2>
            <label className={`${label} mt-3`}>{t("ai.insInstructionsLabel")}
              <textarea className={input} rows={8} maxLength={2000} value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t("ai.insInstructionsPlaceholder")} />
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button className="btn-primary min-h-[44px]" disabled={busy === "draft"} onClick={saveDraft}>
                {busy === "draft" ? t("ai.insWait") : t("ai.insSaveDraft")}
              </button>
              <span className="text-xs text-slate-400">{t("ai.insChars", { count: fmtNumber(locale, draft.length) })}</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              {t("ai.insDraftNote")}
            </p>
          </section>

          <section className="card p-5 sm:p-6">
            <h2 className="text-base font-bold">{t("ai.insTestTitle")}</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
              <label className={label}>{t("ai.insQuestionLabel")}
                <input className={input} maxLength={500} value={question} onChange={(e) => setQuestion(e.target.value)}
                  placeholder={t("ai.insQuestionPlaceholder")} />
              </label>
              <label className={label}>{t("ai.insWhichVersion")}
                <select className="input mt-1.5" value={useDraft ? "draft" : "live"} onChange={(e) => setUseDraft(e.target.value === "draft")}>
                  <option value="draft">Draft</option>
                  <option value="live">Live</option>
                </select>
              </label>
              <button className="btn-primary min-h-[44px]" disabled={busy === "test" || !question.trim()} onClick={runTest}>
                {busy === "test" ? t("ai.insWait") : t("ai.insRunTest")}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">{t("ai.insTestNote")}</p>

            {testResult ? (
              testResult.noAnswer ? (
                <div className="alert alert-red mt-4">
                  <b>{t("ai.insNoAnswerTitle")}</b>
                  <span className="block text-[13px]">{t("ai.insNoAnswerHint")} (Intent: {testResult.intent})</span>
                </div>
              ) : (
                <div className="mt-4 rounded-xl bg-emerald-50/70 px-4 py-3 ring-1 ring-inset ring-emerald-100">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{testResult.answer}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    Intent: {testResult.intent} · {t("ai.insConfidence")} {fmtNumber(locale, testResult.confidence)}%
                    {testResult.model ? t("ai.insModelPart", { model: testResult.model }) : t("ai.insRuleBased")}
                    {testResult.evidence?.type ? t("ai.insEvidencePart", { type: String(testResult.evidence.type) }) : ""}
                  </p>
                </div>
              )
            ) : null}
          </section>

          <section className="card p-5 sm:p-6">
            <h2 className="text-base font-bold">{t("ai.insPublishTitle")}</h2>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className={`${label} flex-1`}>{t("ai.insNoteLabel")}
                <input className={input} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("ai.insNotePlaceholder")} />
              </label>
              {canPublish ? (
                <button className="btn-primary min-h-[44px]" disabled={busy === "publish"} onClick={publish}>
                  {busy === "publish" ? t("ai.insWait") : t("ai.insPublish")}
                </button>
              ) : (
                <p className="text-sm text-slate-400">{t("ai.insPublishRole")}</p>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-400">{t("ai.insPublishNote")}</p>

            <div className="mt-4 space-y-2">
              {versions.length === 0 ? (
                <p className="text-sm text-slate-400">{t("ai.insNoVersions")}</p>
              ) : versions.map((v) => (
                <div key={v.id} className="flex flex-col gap-2 rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-inset ring-slate-100 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <b>v{v.version}</b>
                      <span className="text-xs text-slate-400">{fmtDateTime(locale, v.createdAt)}</span>
                      {v.note ? <span className="badge-slate">{v.note}</span> : null}
                    </div>
                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-600">{v.instructions}</p>
                    <p className="mt-1 text-xs text-slate-400">{t("ai.insPublishedBy", { id: v.publishedById })}</p>
                  </div>
                  {canPublish ? (
                    <button className="btn-secondary min-h-[40px] shrink-0 px-3 text-[13px]" disabled={busy === `rollback-${v.id}`} onClick={() => rollback(v)}>
                      {t("ai.insRollback")}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          <section className="card p-5 sm:p-6">
            <h2 className="text-base font-bold">{t("ai.insUnansweredTitle")}</h2>
            <p className="mt-1 text-[13px] text-slate-500">{t("ai.insUnansweredDesc")}</p>
            <div className="mt-4 space-y-2">
              {unanswered.length === 0 ? (
                <p className="text-sm text-slate-400">{t("ai.insNoUnanswered")}</p>
              ) : unanswered.map((row) => {
                const reason = REASON_LABEL_KEY[row.reason];
                const status = STATUS_LABEL_KEY[row.status];
                return (
                  <div key={row.id} className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-inset ring-slate-100">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-800">{row.questionText}</span>
                      <span className={reason?.cls ?? "badge-slate"}>{reason ? t(reason.labelKey) : row.reason}</span>
                      <span className="badge-slate">{row.channel}</span>
                      <span className="badge-slate">{t("ai.insTimes", { count: fmtNumber(locale, row.count) })}</span>
                      <span className={status?.cls ?? "badge-slate"}>{status ? t(status.labelKey) : row.status}</span>
                      <span className="text-xs text-slate-400">{agoText(row.lastSeenAt ?? row.createdAt, locale, t("ai.insJustNow"))}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {row.status !== "resolved" ? (
                        <button className="btn-secondary px-3 py-1.5 text-xs" disabled={busy === `unanswered-${row.id}`} onClick={() => setUnansweredStatus(row, "resolved")}>{t("ai.insMarkResolved")}</button>
                      ) : null}
                      {row.status !== "ignored" ? (
                        <button className="btn-secondary px-3 py-1.5 text-xs" disabled={busy === `unanswered-${row.id}`} onClick={() => setUnansweredStatus(row, "ignored")}>{t("ai.insIgnore")}</button>
                      ) : null}
                      {row.status !== "open" ? (
                        <button className="btn-secondary px-3 py-1.5 text-xs" disabled={busy === `unanswered-${row.id}`} onClick={() => setUnansweredStatus(row, "open")}>{t("ai.insReopen")}</button>
                      ) : null}
                      <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => appendToDraft(row)}>{t("ai.insAppendInstruction")}</button>
                      <button className="btn-secondary px-3 py-1.5 text-xs" disabled={busy === `propose-${row.id}`} onClick={() => proposeDraft(row)}>
                        {busy === `propose-${row.id}` ? t("ai.insThinking") : t("ai.insAiProposal")}
                      </button>
                    </div>
                    {draftProposals[row.id] ? (
                      draftProposals[row.id].proposal ? (
                        <div className="mt-2 rounded-lg bg-white px-3 py-2 ring-1 ring-inset ring-indigo-100">
                          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-700">
                            <span>{draftProposals[row.id].proposal!.kind === "knowledge" ? t("ai.insProposalKnowledge") : t("ai.insProposalInstruction")}</span>
                            <span className="badge-slate">{draftProposals[row.id].proposal!.title}</span>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700">{draftProposals[row.id].proposal!.content}</p>
                          {draftProposals[row.id].proposal!.reason ? (
                            <p className="mt-1 text-xs text-slate-400">{t("ai.insReasonLabel", { reason: draftProposals[row.id].proposal!.reason })}</p>
                          ) : null}
                          <div className="mt-2 flex flex-wrap gap-2">
                            {draftProposals[row.id].proposal!.kind === "knowledge" ? (
                              <button className="btn-primary px-3 py-1.5 text-xs" disabled={busy === `toknowledge-${row.id}`} onClick={() => sendProposalToKnowledge(row)}>{t("ai.insAddToKnowledge")}</button>
                            ) : (
                              <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => sendProposalToDraft(row)}>{t("ai.insPutInDraft")}</button>
                            )}
                            <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setDraftProposals((prev) => { const next = { ...prev }; delete next[row.id]; return next; })}>{t("ai.insReject")}</button>
                          </div>
                          <p className="mt-1 text-[11px] text-slate-400">{t("ai.insProposalOnlyNote")}</p>
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-slate-400">{draftProposals[row.id].reason ?? t("ai.insProposalFailed")}</p>
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
