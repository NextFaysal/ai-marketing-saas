"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { useLocale } from "@/lib/i18n/provider";
import { fmtNumber } from "@repo/contracts";
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
// Future learning sources copy lives in the settings dictionary
// (settings.futureSources) — rendered at the sources list below.

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
  const { dict, t, locale } = useLocale();
  const D = dict.settings;
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
    if (!id) { setError(dict.settings.noOrgSelected); setLoaded(true); return; }
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
    if (!ov) setError(D.aiLearningLoadFailed);
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
      setError(e instanceof Error ? e.message : D.actionFailed);
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
        ? (value ? D.answerStoreOnMsg : D.answerStoreOffMsg)
        : (value ? D.learningOnMsg : D.learningOffMsg));
  }

  function toggleDocVisibility(doc: KnowledgeDoc) {
    if (!orgId) return;
    const next = doc.visibility === "internal" ? "public" : "internal";
    act(`doc-${doc.id}`, () => apiFetch(`/organizations/${orgId}/knowledge-documents/${doc.id}`, { method: "PATCH", body: JSON.stringify({ visibility: next }) }),
      next === "internal" ? D.docInternalMsg : D.docPublicMsg);
  }

  function approveItem(item: LearnedItem) {
    if (!orgId) return;
    const body: Record<string, unknown> = {};
    if (approvalAllowsVisibilityChoice(item)) body.visibility = visChoice[item.id] ?? defaultApprovalVisibility(item);
    act(`approve-${item.id}`, () => apiFetch(`/organizations/${orgId}/learning-items/${item.id}/approve`, { method: "POST", body: JSON.stringify(body) }),
      D.suggestionApprovedMsg);
  }

  function rejectItem(item: LearnedItem) {
    if (!orgId) return;
    act(`reject-${item.id}`, () => apiFetch(`/organizations/${orgId}/learning-items/${item.id}/reject`, { method: "POST", body: JSON.stringify({}) }),
      D.suggestionRejectedMsg);
  }

  function changeAnswerStatus(a: StoredAnswer, status: "active" | "disabled") {
    if (!orgId) return;
    act(`answer-${a.id}`, () => apiFetch(`/organizations/${orgId}/answer-store/${a.id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
      status === "disabled" ? D.answerDisabledMsg : D.answerEnabledMsg);
  }

  function deleteAnswer(a: StoredAnswer) {
    if (!orgId) return;
    act(`answer-del-${a.id}`, () => apiFetch(`/organizations/${orgId}/answer-store/${a.id}`, { method: "DELETE" }), D.answerDeletedMsg);
  }

  function forgetMemory(m: Memory) {
    if (!orgId) return;
    act(`memory-del-${m.id}`, () => apiFetch(`/organizations/${orgId}/customer-memories/${m.id}`, { method: "DELETE" }), D.memoryForgottenMsg);
  }

  function triageUnanswered(q: Unanswered, status: "resolved" | "ignored") {
    if (!orgId) return;
    act(`unanswered-${q.id}`, () => apiFetch(`/organizations/${orgId}/ai-instructions/unanswered/${q.id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
      status === "resolved" ? D.questionResolvedMsg : D.questionIgnoredMsg);
  }

  const toggles = overview?.learning.toggles;

  return (
    <section id="hub-ai-learning" className="card scroll-mt-24 p-5 sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <span className="stat-icon stat-icon-brand !h-10 !w-10 text-lg">🧠</span>
        <div className="min-w-0">
          <h2 className="font-semibold leading-tight text-slate-900">{D.aiLearningTitle}</h2>
          <p className="mt-0.5 text-[13px] leading-snug text-slate-500">{D.aiLearningIntro}</p>
        </div>
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {notice ? <p className="mb-3 text-sm text-green-600">{notice}</p> : null}
      {!loaded ? <p className="text-sm text-slate-500">{dict.common.loading}</p> : null}

      {loaded && overview ? (
        <div className="space-y-8">
          {/* ---- কী জানে: overview + coverage ---- */}
          <div>
            <div className="font-semibold">{D.whatAiKnows}</div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-xl font-bold">{fmtNumber(locale, overview.knowledge.total)}</div>
                <div className="text-[13px] text-slate-500">{t("settings.knowDocsLabel", { pub: fmtNumber(locale, overview.knowledge.public), internal: fmtNumber(locale, overview.knowledge.internal) })}</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-xl font-bold">{fmtNumber(locale, overview.embeddings.indexedChunks)}</div>
                <div className="text-[13px] text-slate-500">{t("settings.knowChunksLabel", { mode: overview.embeddings.available ? D.knowChunksModeOn : D.knowChunksModeOff, products: fmtNumber(locale, overview.embeddings.indexedProducts) })}</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-xl font-bold">{fmtNumber(locale, overview.answers.active)}</div>
                <div className="text-[13px] text-slate-500">{t("settings.knowAnswersLabel", { hits: fmtNumber(locale, overview.answers.totalHits) })}</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-xl font-bold">{fmtNumber(locale, overview.learning.pendingSuggestions)}</div>
                <div className="text-[13px] text-slate-500">{D.knowPendingLabel}</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-xl font-bold">{fmtNumber(locale, overview.unanswered.open)}</div>
                <div className="text-[13px] text-slate-500">{D.knowUnansweredLabel}</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-xl font-bold">{fmtNumber(locale, overview.customerMemories.count)}</div>
                <div className="text-[13px] text-slate-500">{D.knowMemoriesLabel}</div>
              </div>
            </div>
            <div className="mt-3 rounded-lg bg-slate-50 p-3">
              <div className="text-sm"><span className="font-semibold">{t("settings.coverageTitle", { percent: fmtNumber(locale, overview.coverage.percent) })}</span> <span className="text-slate-500">— {D.coverageNote}</span></div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {overview.coverage.areas.map((a) => (
                  <span key={a.key} className={`rounded px-2 py-0.5 text-xs ${a.present ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-500"}`}>
                    {a.present ? "✓" : "✗"} {coverageAreaLabel(a.key, locale)}
                  </span>
                ))}
              </div>
              {overview.coverage.gaps.length > 0 ? (
                <p className="mt-2 text-[13px] text-slate-500">{D.coverageGapsPrefix} {overview.coverage.gaps.map((g) => coverageAreaLabel(g, locale)).join(", ")}।</p>
              ) : null}
            </div>
          </div>

          {/* ---- শেখার উৎস ---- */}
          <div className="border-t border-slate-100 pt-6">
            <div className="font-semibold">{D.sourcesTitle}</div>
            <ul className="mt-3 space-y-3 text-sm">
              <li className="rounded-lg bg-slate-50 p-3">
                <span className="font-medium">{D.sourceProfileName}</span>{" "}
                <span className="text-slate-500">— {D.sourceProfileTextBefore} <a href="#hub-identity" className="font-medium text-indigo-600 underline">{D.sourceProfileIdentity}</a> {D.sourceProfileAnd} <a href="#hub-knowledge" className="font-medium text-indigo-600 underline">Business Knowledge</a> {D.sourceProfileTextAfter}</span>
              </li>
              <li className="rounded-lg bg-slate-50 p-3">
                <span className="font-medium">{D.sourceCatalogName}</span>{" "}
                <span className="text-slate-500">— {t("settings.sourceCatalogText", { count: fmtNumber(locale, overview.embeddings.indexedProducts) })}</span>
              </li>
              <li className="rounded-lg bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{D.sourceWebsiteName}</span>
                  {canWrite && toggles ? (
                    <button className={BTN} disabled={busy === "toggle-websiteLearningEnabled"} onClick={() => toggleProfileFlag("websiteLearningEnabled", !toggles.websiteLearningEnabled)}>
                      {toggles.websiteLearningEnabled ? D.turnOff : D.turnOn}
                    </button>
                  ) : null}
                </div>
                <p className="mt-1 text-slate-500">
                  {toggles?.websiteLearningEnabled ? D.stateOn : D.stateOff}
                  {toggles?.websiteUrl ? <> — {toggles.websiteUrl}</> : ` — ${D.sourceWebsiteNoUrl}`}
                  {" · "}{learningStateText(overview.learning.sources.website, locale)}
                </p>
              </li>
              <li className="rounded-lg bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{D.sourceConversationName}</span>
                  {canWrite && toggles ? (
                    <button className={BTN} disabled={busy === "toggle-conversationLearningEnabled"} onClick={() => toggleProfileFlag("conversationLearningEnabled", !toggles.conversationLearningEnabled)}>
                      {toggles.conversationLearningEnabled ? D.turnOff : D.turnOn}
                    </button>
                  ) : null}
                </div>
                <p className="mt-1 text-slate-500">
                  {toggles?.conversationLearningEnabled ? D.stateOn : `${D.stateOff} ${D.sourceConversationOffSuffix}`}
                  {" · "}{learningStateText(overview.learning.sources.conversation, locale)}
                </p>
                <p className="mt-1 text-[13px] text-slate-500">{D.sourceConversationNote}</p>
              </li>
              <li className="rounded-lg bg-slate-50 p-3">
                <span className="font-medium">{D.sourcePerformanceName}</span>{" "}
                <span className="text-slate-500">— {D.sourcePerformanceText} {overview.performance ? t("settings.sourcePerformanceLast", { date: formatDate(overview.performance.lastSnapshotAt, locale) }) : D.sourcePerformanceNever}। {D.sourcePerformanceNote}</span>
              </li>
              <li className="rounded-lg bg-slate-50 p-3">
                <span className="font-medium">{D.sourceVoiceName}</span>{" "}
                <span className="text-slate-500">— {brandVoiceStatusText(overview.brandVoice.status, overview.brandVoice.hasPendingSuggestion, locale)} {D.sourceVoiceDetailSuffix}</span>
              </li>
            </ul>
            <p className="mt-2 text-[13px] text-slate-400">{D.sourcesComingPrefix} {D.futureSources} — {D.sourcesComingSuffix}</p>
          </div>

          {/* ---- জ্ঞান ডকুমেন্টের ধরন ---- */}
          <div className="border-t border-slate-100 pt-6">
            <div className="font-semibold">{D.docsVisibilityTitle}</div>
            <p className="mt-1 text-[13px] text-slate-500">{D.docsVisibilityNote}</p>
            {docs.length === 0 ? <p className="mt-2 text-sm text-slate-500">{D.noDocumentsYet}</p> : (
              <ul className="mt-3 space-y-2">
                {docs.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium">{d.title}</span>{" "}
                      <span className="text-slate-400">({d.kind})</span>{" "}
                      {d.visibility === "internal"
                        ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">{D.badgeInternal}</span>
                        : <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700">{D.badgePublic}</span>}
                    </span>
                    {canWrite ? (
                      <button className={BTN} disabled={busy === `doc-${d.id}`} onClick={() => toggleDocVisibility(d)}>
                        {d.visibility === "internal" ? D.makePublic : D.makeInternal}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ---- শেখার প্রস্তাব ---- */}
          <div className="border-t border-slate-100 pt-6">
            <div className="font-semibold">{D.suggestionsTitle}</div>
            {suggestions.length === 0 ? <p className="mt-2 text-sm text-slate-500">{D.noSuggestions}</p> : (
              <ul className="mt-3 space-y-2">
                {suggestions.map((item) => (
                  <li key={item.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                    <div>
                      <span className="font-medium">{item.title}</span>{" "}
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">{learnedKindLabel(item.kind, locale)}</span>{" "}
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">{learnedSourceLabel(item.sourceType, locale)}</span>
                    </div>
                    {item.kind === "faq_pair" ? (
                      <div className="mt-1 text-slate-600">
                        <div>{D.faqQuestionPrefix} {String(item.content?.question ?? "")}</div>
                        <div>{D.faqAnswerPrefix} {previewText(String(item.content?.answer ?? ""))}</div>
                      </div>
                    ) : (
                      <div className="mt-1 text-slate-600">{previewText(String(item.content?.text ?? ""))}</div>
                    )}
                    <div className="mt-1 text-[13px] text-slate-400">{approvalTargetText(item, locale)}</div>
                    {canWrite ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {approvalAllowsVisibilityChoice(item) ? (
                          <select
                            className="rounded-lg border px-2 py-1.5 text-[13px]"
                            value={visChoice[item.id] ?? defaultApprovalVisibility(item)}
                            onChange={(e) => setVisChoice({ ...visChoice, [item.id]: e.target.value })}
                            aria-label={D.visibilityAria}
                          >
                            <option value="public">{D.visPublicOption}</option>
                            <option value="internal">{D.visInternalOption}</option>
                          </select>
                        ) : null}
                        <button className={BTN} disabled={busy === `approve-${item.id}`} onClick={() => approveItem(item)}>{D.approve}</button>
                        <button className={BTN} disabled={busy === `reject-${item.id}`} onClick={() => rejectItem(item)}>{D.rejectSuggestion}</button>
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
              <div className="font-semibold">{D.answerStoreTitle}</div>
              {canWrite ? (
                <button className={BTN} disabled={busy === "toggle-answerStoreEnabled"} onClick={() => toggleProfileFlag("answerStoreEnabled", overview.answers.storeEnabled === false)}>
                  {overview.answers.storeEnabled === false ? D.answerStoreOnBtn : D.answerStoreOffBtn}
                </button>
              ) : null}
            </div>
            <p className="mt-1 text-[13px] text-slate-500">{D.answerStoreNote}</p>
            {overview.answers.storeEnabled === false ? (
              <p className="mt-2 rounded-lg bg-amber-50 p-3 text-[13px] text-amber-800">{D.answerStoreOffBannerBefore} <b>{D.answerStoreOffBannerBold}</b> {D.answerStoreOffBannerAfter}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                className="rounded-lg border px-3 py-2 text-sm"
                placeholder={D.answerSearchPlaceholder}
                value={answerSearch}
                onChange={(e) => setAnswerSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") reloadAnswers(answerStatus, answerSearch); }}
              />
              <select className="rounded-lg border px-2 py-2 text-sm" value={answerStatus} onChange={(e) => { setAnswerStatus(e.target.value); reloadAnswers(e.target.value, answerSearch); }} aria-label={D.answerStatusAria}>
                <option value="">{D.answerStatusAll}</option>
                <option value="active">{D.answerStatusActiveOpt}</option>
                <option value="disabled">{D.answerStatusDisabledOpt}</option>
                <option value="invalidated">{D.answerStatusInvalidatedOpt}</option>
              </select>
              <button className={BTN} onClick={() => reloadAnswers(answerStatus, answerSearch)}>{dict.common.search}</button>
            </div>
            {answers.length === 0 ? <p className="mt-2 text-sm text-slate-500">{D.noAnswersInList}</p> : (
              <ul className="mt-3 space-y-2">
                {answers.map((a) => (
                  <li key={a.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                    <div>
                      <span className="font-medium">{a.question}</span>{" "}
                      <span className={`rounded px-1.5 py-0.5 text-xs ${a.status === "active" ? "bg-green-100 text-green-700" : a.status === "disabled" ? "bg-slate-200 text-slate-600" : "bg-red-100 text-red-700"}`}>{answerStatusLabel(a.status, locale)}</span>{" "}
                      <span className="text-slate-400">{answerOriginLabel(a.origin, locale)} · {t("settings.answerUsedTimes", { count: fmtNumber(locale, a.hitCount) })}</span>
                    </div>
                    <div className="mt-1 text-slate-600">{a.answerPreview}</div>
                    {a.status === "invalidated" ? (
                      <div className="mt-1 text-[13px] text-red-600">{D.invalidReasonPrefix} {invalidReasonLabel(a.invalidReason, locale)}। {D.invalidReasonSuffix}</div>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {canWrite && a.status === "active" ? (
                        <button className={BTN} disabled={busy === `answer-${a.id}`} onClick={() => changeAnswerStatus(a, "disabled")}>{D.turnOff}</button>
                      ) : null}
                      {canWrite && a.status === "disabled" ? (
                        <button className={BTN} disabled={busy === `answer-${a.id}`} onClick={() => changeAnswerStatus(a, "active")}>{D.turnOn}</button>
                      ) : null}
                      {canDelete ? (
                        confirming[`answer-${a.id}`] ? (
                          <>
                            <button className={`${BTN} !border-red-300 text-red-700`} disabled={busy === `answer-del-${a.id}`} onClick={() => deleteAnswer(a)}>{D.confirmDelete}</button>
                            <button className={BTN} onClick={() => setConfirming({ ...confirming, [`answer-${a.id}`]: false })}>{D.keepIt}</button>
                          </>
                        ) : (
                          <button className={BTN} onClick={() => setConfirming({ ...confirming, [`answer-${a.id}`]: true })}>{D.deleteIt}</button>
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
            <div className="font-semibold">{D.voiceTitle}</div>
            {!voice ? (
              <p className="mt-2 text-sm text-slate-500">{D.voiceNone}</p>
            ) : (
              <div className="mt-2 text-sm">
                <p className="text-slate-600">{D.voiceStatusPrefix} <span className="font-medium">{brandVoiceStatusText(voice.status, !!voice.pendingTraits, locale)}</span></p>
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
                    <div className="font-medium text-amber-800">{D.voiceNewSuggestion}</div>
                    <ul className="mt-1 list-inside list-disc text-slate-600">
                      {voiceTraitLines(voice.pendingTraits).map((l) => <li key={l}>{l}</li>)}
                    </ul>
                  </div>
                ) : null}
                {canWrite && (voice.status === "suggested" || voice.pendingTraits) ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button className={BTN} disabled={busy === "voice-activate"} onClick={() => act("voice-activate", () => apiFetch(`/organizations/${orgId}/brand-voice/activate`, { method: "POST", body: JSON.stringify({}) }), D.voiceActivatedMsg)}>{D.turnOn}</button>
                    <button className={BTN} disabled={busy === "voice-dismiss"} onClick={() => act("voice-dismiss", () => apiFetch(`/organizations/${orgId}/brand-voice/dismiss`, { method: "POST", body: JSON.stringify({}) }), D.voiceDismissedMsg)}>{D.rejectSuggestion}</button>
                  </div>
                ) : null}
                <p className="mt-2 text-[13px] text-slate-400">{D.voiceNote}</p>
              </div>
            )}
          </div>

          {/* ---- উত্তর-না-পাওয়া প্রশ্ন ---- */}
          <div className="border-t border-slate-100 pt-6">
            <div className="font-semibold">{D.unansweredTitle}</div>
            <p className="mt-1 text-[13px] text-slate-500">{D.unansweredNote}</p>
            {unanswered.length === 0 ? <p className="mt-2 text-sm text-slate-500">{D.noUnanswered}</p> : (
              <ul className="mt-3 space-y-2">
                {unanswered.map((q) => (
                  <li key={q.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                    <div>
                      <span className="font-medium">{q.questionText}</span>{" "}
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">{unansweredReasonLabel(q.reason, locale)}</span>{" "}
                      {q.count > 1 ? <span className="text-slate-400">{t("settings.questionTimesSuffix", { count: fmtNumber(locale, q.count) })}</span> : null}
                    </div>
                    {canWrite ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button className={BTN} disabled={busy === `unanswered-${q.id}`} onClick={() => triageUnanswered(q, "resolved")}>{D.markResolved}</button>
                        <button className={BTN} disabled={busy === `unanswered-${q.id}`} onClick={() => triageUnanswered(q, "ignored")}>{D.ignoreIt}</button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ---- কাস্টমার স্মৃতি ---- */}
          <div className="border-t border-slate-100 pt-6">
            <div className="font-semibold">{D.memoriesTitle}</div>
            <p className="mt-1 text-[13px] text-slate-500">{D.memoriesNote}</p>
            {memories.length === 0 ? <p className="mt-2 text-sm text-slate-500">{D.noMemories}</p> : (
              <ul className="mt-3 space-y-2">
                {memories.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 text-sm">
                    <span>
                      <span className="font-medium">{m.displayName ?? m.customerKey}</span>{" "}
                      <span className="text-slate-500">· {t("settings.memoryMetaLine", { language: languagePrefLabel(m.languagePref, locale), orders: fmtNumber(locale, m.orderCount), date: formatDate(m.lastInteractionAt, locale) })}</span>
                    </span>
                    {canDelete ? (
                      confirming[`memory-${m.id}`] ? (
                        <span className="flex gap-2">
                          <button className={`${BTN} !border-red-300 text-red-700`} disabled={busy === `memory-del-${m.id}`} onClick={() => forgetMemory(m)}>{D.confirmForget}</button>
                          <button className={BTN} onClick={() => setConfirming({ ...confirming, [`memory-${m.id}`]: false })}>{D.keepIt}</button>
                        </span>
                      ) : (
                        <button className={BTN} onClick={() => setConfirming({ ...confirming, [`memory-${m.id}`]: true })}>{D.forget}</button>
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
