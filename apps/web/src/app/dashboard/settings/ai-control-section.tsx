"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { useLocale } from "@/lib/i18n/provider";
import { fmtNumber } from "@repo/contracts";
import {
  ADMIN_CONSOLE_DECISION_LABEL,
  ADMIN_CONSOLE_DECISION_LABEL_EN,
  ActionProposal,
  ActivityEvent,
  ActivityFeed,
  AiUsageOverview,
  AutonomyRow,
  CatalogAction,
  activityEventText,
  activityKindLabel,
  activityQuery,
  activitySourceLabel,
  activitySummary,
  ageText,
  autonomyLevelLabel,
  canDecideControl,
  canSetControlAutonomy,
  formatDateTime,
  isAdminConsoleDecision,
  isProposalOnly,
  proposalOutcomeText,
  proposalStatusLabel,
  proposedByLabel,
  riskLabel,
  surfaceLabel,
  usageFeatureLabel,
} from "@/lib/ai-control";

const BTN = "rounded-lg border px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50";

/**
 * SA-B13 (Smart AI Phase 2, W4) — AI Control Center (basic,
 * tenant): Organization Settings → "🤖 AI নিয়ন্ত্রণ". The
 * human side of the Action Engine (SA-B10–B12): the proposal
 * queue (approve/reject — nothing executes at the default
 * level without a human decision), the per-action autonomy
 * matrix (plan D5: levels 0–2 settable; level 3 shown disabled
 * with its reason; money-adjacent actions are proposal-only at
 * EVERY level, law L5), and the recent activity computed from
 * the proposals the API actually returned. Roles mirror the
 * engine API: decisions OWNER/ADMIN/MARKETING_MANAGER,
 * autonomy OWNER/ADMIN. The FULL Control Center (activity
 * page, error log → learning queue) is Phase 6 (T4); this is
 * the W4 foundation the plan asks for.
 */
export function AiControlCenterSection() {
  const { dict, t, locale } = useLocale();
  const D = dict.settings;
  const [role, setRole] = useState("");
  const [catalog, setCatalog] = useState<CatalogAction[]>([]);
  const [autonomy, setAutonomy] = useState<AutonomyRow[]>([]);
  const [pending, setPending] = useState<ActionProposal[]>([]);
  const [recent, setRecent] = useState<ActionProposal[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [loaded, setLoaded] = useState(false);
  // SA-B25 (T4): the usage overview + unified activity feed.
  // Each new block keeps its OWN error line so a failed feed
  // fetch never takes the queue / autonomy blocks down with it.
  const [usage, setUsage] = useState<AiUsageOverview | null>(null);
  const [usageDays, setUsageDays] = useState(30);
  const [usageError, setUsageError] = useState("");
  const [feed, setFeed] = useState<ActivityFeed | null>(null);
  const [feedKind, setFeedKind] = useState<string | null>(null);
  const [feedDays, setFeedDays] = useState(30);
  const [feedError, setFeedError] = useState("");
  const [feedBusy, setFeedBusy] = useState(false);
  // The current feed/usage windows ride in refs so the shared
  // load() (also re-run after a decision) refetches the SAME
  // windows instead of silently resetting the tenant's filters.
  const usageDaysRef = useRef(30);
  const feedFilterRef = useRef<{ kind: string | null; days: number }>({ kind: null, days: 30 });

  const orgId = typeof window !== "undefined" ? getOrganizationId() : null;
  const canDecide = canDecideControl(role);
  const canSetAutonomy = canSetControlAutonomy(role);
  const catalogById = new Map(catalog.map((c) => [c.id, c]));

  const load = useCallback(async () => {
    const id = getOrganizationId();
    if (!id) { setError(dict.settings.noOrgSelected); setLoaded(true); return; }
    const base = `/organizations/${id}/ai/actions`;
    const activityBase = `/organizations/${id}/ai/activity`;
    const filter = feedFilterRef.current;
    const [mine, cat, aut, pend, rec, usageRes, feedRes] = await Promise.all([
      apiFetch<{ id: string; myRole: string }[]>(`/organizations`).catch(() => [] as { id: string; myRole: string }[]),
      apiFetch<CatalogAction[]>(`${base}/catalog`).catch(() => null),
      apiFetch<AutonomyRow[]>(`${base}/autonomy`).catch(() => null),
      apiFetch<ActionProposal[]>(`${base}/proposals?status=proposed`).catch(() => null),
      apiFetch<ActionProposal[]>(`${base}/proposals`).catch(() => null),
      apiFetch<AiUsageOverview>(`${activityBase}/usage?days=${usageDaysRef.current}`).catch(() => null),
      apiFetch<ActivityFeed>(`${activityBase}${activityQuery({ kind: filter.kind, days: filter.days, limit: 20, offset: 0 })}`).catch(() => null),
    ]);
    setRole(mine.find((x) => x.id === id)?.myRole ?? "");
    if (!cat || !aut || !pend || !rec) setError(D.ctrlLoadFailed);
    setCatalog(cat ?? []);
    setAutonomy(aut ?? []);
    setPending(pend ?? []);
    setRecent(rec ?? []);
    // The new blocks fail independently — their errors stay local.
    if (usageRes) { setUsage(usageRes); setUsageError(""); } else setUsageError(D.ctrlUsageLoadFailed);
    if (feedRes) { setFeed(feedRes); setFeedError(""); } else setFeedError(D.ctrlFeedLoadFailed);
    setLoaded(true);
  }, []);

  useEffect(() => { load(); }, [load]);

  // SA-B25 (T4): separate refetch handlers for the new blocks —
  // toggling a window/filter never reloads the queue or matrix.
  async function loadUsage(days: number) {
    if (!orgId) return;
    usageDaysRef.current = days;
    setUsageDays(days);
    setUsageError("");
    try {
      const res = await apiFetch<AiUsageOverview>(`/organizations/${orgId}/ai/activity/usage?days=${days}`);
      setUsage(res);
    } catch {
      setUsageError(D.ctrlUsageLoadFailed);
    }
  }

  async function loadFeed(kind: string | null, days: number) {
    if (!orgId) return;
    feedFilterRef.current = { kind, days };
    setFeedKind(kind);
    setFeedDays(days);
    setFeedError("");
    setFeedBusy(true);
    try {
      const res = await apiFetch<ActivityFeed>(`/organizations/${orgId}/ai/activity${activityQuery({ kind, days, limit: 20, offset: 0 })}`);
      setFeed(res);
    } catch {
      setFeedError(D.ctrlFeedLoadFailed);
    } finally { setFeedBusy(false); }
  }

  async function loadMoreFeed() {
    if (!orgId || !feed) return;
    const { kind, days } = feedFilterRef.current;
    setFeedError("");
    setFeedBusy(true);
    try {
      const res = await apiFetch<ActivityFeed>(`/organizations/${orgId}/ai/activity${activityQuery({ kind, days, limit: 20, offset: feed.items.length })}`);
      setFeed({ ...res, items: [...feed.items, ...res.items] });
    } catch {
      setFeedError(D.ctrlFeedMoreFailed);
    } finally { setFeedBusy(false); }
  }

  async function decide(p: ActionProposal, decision: "approve" | "reject") {
    if (!orgId) return;
    setBusy(`decide-${p.id}`); setError(""); setNotice("");
    try {
      const row = await apiFetch<ActionProposal>(`/organizations/${orgId}/ai/actions/proposals/${p.id}/${decision}`, { method: "POST", body: JSON.stringify({}) });
      // The approve response IS the outcome: an execution can
      // land as failed, and a money-adjacent approval records
      // the decision without executing — the message must say
      // what the row says, never assume success.
      const text = proposalOutcomeText(row, locale);
      if (row.status === "failed") setError(text);
      else setNotice(text);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : D.ctrlDecisionFailed);
      await load();
    } finally { setBusy(""); }
  }

  async function changeAutonomy(row: AutonomyRow, level: number) {
    if (!orgId) return;
    setBusy(`autonomy-${row.actionId}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/ai/actions/autonomy/${row.actionId}`, { method: "PUT", body: JSON.stringify({ level }) });
      setNotice(t("settings.ctrlLevelChanged", { title: locale === "en" ? (row.title.en ?? row.title.bn) : row.title.bn, level: autonomyLevelLabel(level, locale) }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : D.ctrlLevelChangeFailed);
      await load();
    } finally { setBusy(""); }
  }

  function actionTitle(p: ActionProposal): string {
    const title = p.actionId ? catalogById.get(p.actionId)?.title : null;
    return (title ? (locale === "en" ? (title.en ?? title.bn) : title.bn) : null) ?? p.title;
  }

  const decided = recent.filter((p) => p.status !== "proposed");
  const summary = activitySummary(recent);

  return (
    <section id="hub-ai-control" className="card scroll-mt-24 p-5 sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <span className="stat-icon stat-icon-brand !h-10 !w-10 text-lg">🎛️</span>
        <div className="min-w-0">
          <h2 className="font-semibold leading-tight text-slate-900">{D.ctrlTitle}</h2>
          <p className="mt-0.5 text-[13px] leading-snug text-slate-500">{D.ctrlIntro}</p>
        </div>
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {notice ? <p className="mb-3 text-sm text-green-600">{notice}</p> : null}
      {!loaded ? <p className="text-sm text-slate-500">{dict.common.loading}</p> : null}

      {loaded ? (
        <div className="space-y-8">
          {/* ---- অপেক্ষমাণ প্রস্তাব ---- */}
          <div>
            <div className="font-semibold">{D.ctrlPendingTitle}</div>
            {pending.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">{D.ctrlPendingEmpty}</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {pending.map((p) => (
                  <li key={p.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                    <div>
                      <span className="font-medium">{p.title}</span>{" "}
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">{surfaceLabel(p.surface, locale)}</span>{" "}
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">{actionTitle(p)}</span>{" "}
                      <span className="text-slate-400">{proposedByLabel(p.proposedBy, locale)} · {ageText(p.createdAt, new Date(), locale)}</span>
                    </div>
                    <div className="mt-1 text-slate-600">{p.preview}</div>
                    {canDecide ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button className={BTN} disabled={busy === `decide-${p.id}`} onClick={() => decide(p, "approve")}>{D.approve}</button>
                        <button className={BTN} disabled={busy === `decide-${p.id}`} onClick={() => decide(p, "reject")}>{D.rejectSuggestion}</button>
                      </div>
                    ) : (
                      <p className="mt-1 text-[13px] text-slate-400">{D.ctrlNoDecideRight}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ---- সাম্প্রতিক কার্যকলাপ ---- */}
          <div className="border-t border-slate-100 pt-6">
            <div className="font-semibold">{D.ctrlRecentTitle}</div>
            {recent.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">{D.ctrlRecentEmpty}</p>
            ) : (
              <>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="text-xl font-bold">{fmtNumber(locale, summary.executed)}</div>
                    <div className="text-[13px] text-slate-500">{D.ctrlExecutedLabel}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="text-xl font-bold">{fmtNumber(locale, summary.failed)}</div>
                    <div className="text-[13px] text-slate-500">{D.ctrlFailedLabel}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="text-xl font-bold">{fmtNumber(locale, summary.pending)}</div>
                    <div className="text-[13px] text-slate-500">{D.ctrlPendingLabel}</div>
                  </div>
                </div>
                <p className="mt-2 text-[13px] text-slate-400">{D.ctrlSummaryNote}</p>
                {decided.length > 0 ? (
                  <ul className="mt-3 space-y-2">
                    {decided.slice(0, 10).map((p) => (
                      <li key={p.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                        <div>
                          <span className="font-medium">{p.title}</span>{" "}
                          <span className={`rounded px-1.5 py-0.5 text-xs ${p.status === "executed" ? "bg-green-100 text-green-700" : p.status === "failed" ? "bg-red-100 text-red-700" : isProposalOnly(p) ? "bg-amber-100 text-amber-700" : "bg-slate-200 text-slate-600"}`}>{isProposalOnly(p) ? D.ctrlApprovedProposalOnly : proposalStatusLabel(p.status, locale)}</span>{" "}
                          <span className="text-slate-400">{formatDateTime(p.executedAt ?? p.decidedAt ?? p.updatedAt, locale)}</span>
                        </div>
                        <div className="mt-1 text-slate-600">{proposalOutcomeText(p, locale)}</div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </div>

          {/* ---- AI ব্যবহার (SA-B25 T4) ---- */}
          <div className="border-t border-slate-100 pt-6">
            <div className="font-semibold">{D.ctrlUsageTitle}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className={BTN} disabled={usageDays === 7} onClick={() => loadUsage(7)}>{D.ctrlLast7Days}</button>
              <button className={BTN} disabled={usageDays === 30} onClick={() => loadUsage(30)}>{D.ctrlLast30Days}</button>
            </div>
            {usageError ? <p className="mt-2 text-sm text-red-600">{usageError}</p> : null}
            {usage?.totals ? (
              usage.totals.calls === 0 ? (
                <p className="mt-2 text-sm text-slate-500">{D.ctrlNoCalls}</p>
              ) : (
                <>
                  <p className="mt-2 text-sm text-slate-600">
                    {t("settings.ctrlTotalCalls", { calls: fmtNumber(locale, usage.totals.calls) })}
                    {usage.totals.estimatedCalls > 0 ? (
                      <> — {t("settings.ctrlEstimatedSuffix", { count: fmtNumber(locale, usage.totals.estimatedCalls) })}</>
                    ) : null}
                  </p>
                  {(usage.features ?? []).length > 0 ? (
                    <ul className="mt-3 space-y-2">
                      {usage.features.map((f) => (
                        <li key={f.feature} className="rounded-lg bg-slate-50 p-3 text-sm">
                          <span className="font-medium">{usageFeatureLabel(f.feature, locale)}</span>{" "}
                          <span className="text-slate-600">{t("settings.ctrlCallsSuffix", { count: fmtNumber(locale, f.calls) })}</span>{" "}
                          <span className="text-slate-400">{t("settings.ctrlTokensLine", { input: fmtNumber(locale, f.inputTokens), output: fmtNumber(locale, f.outputTokens) })}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              )
            ) : null}
          </div>

          {/* ---- AI কার্যকলাপ (SA-B25 T4) ---- */}
          <div className="border-t border-slate-100 pt-6">
            <div className="font-semibold">{D.ctrlFeedTitle}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {([null, "proposal", "learned", "answer", "content"] as (string | null)[]).map((k) => (
                <button key={k ?? "all"} className={BTN} disabled={feedBusy || feedKind === k} onClick={() => loadFeed(k, feedDays)}>
                  {k === null ? dict.common.all : activityKindLabel(k, locale)}
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {[7, 30, 90].map((d) => (
                <button key={d} className={BTN} disabled={feedBusy || feedDays === d} onClick={() => loadFeed(feedKind, d)}>
                  {t("settings.ctrlLastDaysBtn", { days: fmtNumber(locale, d) })}
                </button>
              ))}
            </div>
            {feedError ? <p className="mt-2 text-sm text-red-600">{feedError}</p> : null}
            {feed ? (
              <>
                <p className="mt-2 text-[13px] text-slate-400">{t("settings.ctrlFeedTotal", { total: fmtNumber(locale, feed.total), days: fmtNumber(locale, feed.days) })}</p>
                {(feed.items ?? []).length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">{D.ctrlFeedEmpty}</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {feed.items.map((ev: ActivityEvent) => (
                      <li key={ev.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                        <div>
                          <span className="font-medium">{activityEventText(ev, locale)}</span>{" "}
                          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">{activityKindLabel(ev.kind, locale)}</span>{" "}
                          {activitySourceLabel(ev, locale) ? (
                            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">{activitySourceLabel(ev, locale)}</span>
                          ) : null}{" "}
                          <span className="text-slate-400">{formatDateTime(ev.at, locale)}</span>
                          {isAdminConsoleDecision(ev) ? (
                            <> <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-700">{locale === "en" ? ADMIN_CONSOLE_DECISION_LABEL_EN : ADMIN_CONSOLE_DECISION_LABEL}</span></>
                          ) : null}
                        </div>
                        {ev.title ? <div className="mt-1 text-slate-600">{ev.title}</div> : null}
                        {ev.detail ? <div className="mt-1 text-red-600">{D.ctrlReasonPrefix} {ev.detail}</div> : null}
                      </li>
                    ))}
                  </ul>
                )}
                {feed.items.length < feed.total ? (
                  <div className="mt-3">
                    <button className={BTN} disabled={feedBusy} onClick={() => loadMoreFeed()}>{D.ctrlSeeMore}</button>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          {/* ---- স্বায়ত্তশাসনের মাত্রা ---- */}
          <div className="border-t border-slate-100 pt-6">
            <div className="font-semibold">{D.ctrlAutonomyTitle}</div>
            <p className="mt-1 text-[13px] text-slate-500">{D.ctrlAutonomyNoteParts} <b>{D.ctrlAutonomyOffBold}</b> {D.ctrlAutonomyOffText} <b>{D.ctrlAutonomyProposalBold}</b> {D.ctrlAutonomyProposalText} <b>{D.ctrlAutonomyLimitedBold}</b> {D.ctrlAutonomyLimitedText}</p>
            {autonomy.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">{D.ctrlActionsLoadFailed}</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {autonomy.map((row) => (
                  <li key={row.actionId} className="rounded-lg bg-slate-50 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0">
                        <span className="font-medium">{locale === "en" ? (row.title.en ?? row.title.bn) : row.title.bn}</span>{" "}
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">{surfaceLabel(row.surface, locale)}</span>{" "}
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">{riskLabel(row.riskClass, locale)}</span>
                        {row.moneyAdjacent ? (
                          <> <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">{D.ctrlMoneyOnlyBadge}</span></>
                        ) : null}
                      </span>
                      {canSetAutonomy ? (
                        <select
                          className="rounded-lg border px-2 py-1.5 text-[13px]"
                          value={row.level}
                          disabled={busy === `autonomy-${row.actionId}`}
                          onChange={(e) => changeAutonomy(row, Number(e.target.value))}
                          aria-label={t("settings.ctrlLevelAria", { title: locale === "en" ? (row.title.en ?? row.title.bn) : row.title.bn })}
                        >
                          <option value={0}>{D.ctrlLevel0}</option>
                          <option value={1}>{D.ctrlLevel1}</option>
                          <option value={2}>{D.ctrlLevel2}</option>
                          <option value={3} disabled>{D.ctrlLevel3}</option>
                        </select>
                      ) : (
                        <span className="rounded bg-slate-200 px-2 py-1 text-xs text-slate-600">{autonomyLevelLabel(row.level, locale)}{row.levelIsDefault ? ` ${D.ctrlDefaultSuffix}` : ""}</span>
                      )}
                    </div>
                    {row.moneyAdjacent ? (
                      <p className="mt-1 text-[13px] text-slate-500">{D.ctrlMoneyNote}</p>
                    ) : row.level === 2 && row.riskClass === "low" ? (
                      <p className="mt-1 text-[13px] text-slate-500">{D.ctrlLevel2LowNote}</p>
                    ) : row.level === 2 ? (
                      <p className="mt-1 text-[13px] text-slate-500">{D.ctrlLevel2HighNote}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {!canSetAutonomy ? (
              <p className="mt-2 text-[13px] text-slate-400">{D.ctrlAutonomyRightNote}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
