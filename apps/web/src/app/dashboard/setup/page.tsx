"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { useLocale } from "@/lib/i18n/provider";
import { fmtNumber } from "@repo/contracts";

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
  const { dict, t, locale } = useLocale();
  const D = dict.settings;
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
      setNotice(enabled ? D.setupPracticeOnMsg : D.setupPracticeOffMsg);
    } catch (e) { setError(e instanceof Error ? e.message : D.setupFailed); }
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
        ? t("settings.setupDemoLoadedMsg", { count: fmtNumber(locale, out.count) })
        : t("settings.setupDemoAlreadyMsg", { count: fmtNumber(locale, out.count) }));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : D.setupFailed); }
    finally { setBusy(false); }
  }

  async function startConversation() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusy(true); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/practice/conversation`, { method: "POST", body: JSON.stringify({}) });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : D.setupFailed); }
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
    } catch (e) { setError(e instanceof Error ? e.message : D.setupFailed); }
    finally { setBusy(false); }
  }

  async function cleanup() {
    const orgId = getOrganizationId();
    if (!orgId) return;
    if (!window.confirm(D.setupCleanupConfirm)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await apiFetch<{ conversations: number; messages: number; orders: number }>(
        `/organizations/${orgId}/practice/cleanup`, { method: "POST", body: JSON.stringify({}) },
      );
      setMessages([]);
      setDemoScenarios([]);
      setNotice(t("settings.setupCleanupDone", { conversations: fmtNumber(locale, r.conversations), messages: fmtNumber(locale, r.messages), orders: fmtNumber(locale, r.orders) }));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : D.setupFailed); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">{D.setupTitle}</h1>
        <p className="mt-1 text-sm text-slate-500">{D.setupIntro}</p>
      </div>

      {error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</p> : null}

      <section className="card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="font-semibold">{D.setupProgress}</div>
          {guide ? <span className="badge-brand">{t("settings.setupProgressBadge", { completed: fmtNumber(locale, guide.completed), total: fmtNumber(locale, guide.total), percent: fmtNumber(locale, guide.percent) })}</span> : null}
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
                    ? <span className="text-xs font-semibold text-emerald-600">{D.setupStepDone}</span>
                    : <a href={s.href} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white">{D.setupStepDoNow}</a>}
                </li>
              ))}
            </ul>
            {guide.allDone ? <p className="mt-3 text-sm font-medium text-emerald-700">{D.setupAllDone}</p> : null}
          </>
        ) : <p className="mt-3 text-sm text-slate-400">{dict.common.loading}</p>}
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="font-semibold">🧪 Practice Mode</div>
          {practice?.practiceMode
            ? <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800">{D.stateOn}</span>
            : <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-500">{dict.common.disabled}</span>}
          {practice && practice.practiceMode ? (
            <span className="text-xs text-slate-500">{t("settings.setupPracticeCounts", { conversations: fmtNumber(locale, practice.practiceConversations), orders: fmtNumber(locale, practice.practiceOrders) })}</span>
          ) : null}
          <div className="ml-auto flex gap-2">
            {practice?.practiceMode
              ? <button onClick={() => togglePractice(false)} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-50">{dict.common.disable}</button>
              : <button onClick={() => togglePractice(true)} disabled={busy} className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{dict.common.enable}</button>}
            {practice?.practiceMode ? (
              <button onClick={cleanup} disabled={busy} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{D.setupPracticeEndBtn}</button>
            ) : null}
          </div>
        </div>
        <p className="mt-2 text-sm text-slate-500">
          {D.setupPracticeIntroBefore} <b>{D.setupPracticeIntroBold}</b>{D.setupPracticeIntroAfter}
        </p>

        <div className="mt-5 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm font-semibold">🎬 Demo Chat Pack</div>
            {practice?.demoPackLoaded ? (
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                {t("settings.setupDemoLoadedBadge", { count: fmtNumber(locale, practice.demoConversations ?? demoScenarios.length) })}
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-slate-500">
            {D.setupDemoIntroBefore} <b>{D.setupDemoIntroBold}</b>{D.setupDemoIntroAfter}
          </p>
          {!practice?.practiceMode ? (
            <>
              <button disabled className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{D.setupDemoLoadBtn}</button>
              <p className="mt-2 text-xs font-medium text-amber-700">{D.setupDemoNeedPractice}</p>
            </>
          ) : practice.demoPackLoaded ? (
            <p className="mt-3 text-sm font-medium text-emerald-700">{t("settings.setupDemoLoadedLine", { count: fmtNumber(locale, practice.demoConversations ?? demoScenarios.length) })}</p>
          ) : (
            <button onClick={loadDemoPack} disabled={busy} className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{D.setupDemoLoadBtn}</button>
          )}
          {demoScenarios.length > 0 ? (
            <ul className="mt-4 divide-y divide-slate-200 rounded-xl bg-white ring-1 ring-slate-200">
              {demoScenarios.map((s) => (
                <li key={s.slug} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-800">{s.title}</div>
                    <div className="text-xs text-slate-500">{s.feature}</div>
                  </div>
                  <a href="/dashboard/inbox" className="shrink-0 text-xs font-semibold text-brand-600 hover:underline">{D.setupViewInInbox}</a>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-3 text-xs text-slate-400">{D.setupDemoRedoNote}</p>
        </div>

        {practice?.practiceMode ? (
          <div className="mt-4 space-y-3">
            {!practice.practiceConversationId ? (
              <button onClick={startConversation} disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{D.setupStartConversation}</button>
            ) : (
              <>
                <div className="max-h-80 space-y-2 overflow-y-auto rounded-xl bg-slate-50 p-3">
                  {messages.length === 0 ? (
                    <p className="text-sm text-slate-400">{D.setupNoMessages}</p>
                  ) : messages.map((m) => (
                    <div key={m.id} className={`flex ${m.direction === "in" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.direction === "in" ? "bg-blue-600 text-white" : "bg-white text-slate-800 ring-1 ring-slate-200"}`}>
                        <div className="whitespace-pre-wrap">{m.content ?? ""}</div>
                        <div className={`mt-1 text-[10px] ${m.direction === "in" ? "text-blue-100" : "text-slate-400"}`}>
                          {m.direction === "in" ? D.setupYouAsCustomer : m.autoReply ? "🤖 AI" : D.setupTeamLabel}
                          {m.status === "practice" ? ` · ${D.setupPracticeSavedSuffix}` : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <form onSubmit={simulate} className="flex gap-2">
                  <input className="input flex-1" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={D.setupDraftPlaceholder} maxLength={2000} />
                  <button disabled={busy || !draft.trim()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{D.setupSendBtn}</button>
                </form>
                <p className="text-xs text-slate-400">{D.setupTips}</p>
                <a href="/dashboard/inbox" className="inline-block text-xs font-semibold text-brand-600 hover:underline">{D.setupOpenInInbox}</a>
              </>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
