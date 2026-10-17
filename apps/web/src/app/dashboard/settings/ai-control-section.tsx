"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import {
  ADMIN_CONSOLE_DECISION_LABEL,
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
    if (!id) { setError("কোনো Organization নির্বাচিত নেই।"); setLoaded(true); return; }
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
    if (!cat || !aut || !pend || !rec) setError("AI নিয়ন্ত্রণের তথ্য লোড করা যায়নি।");
    setCatalog(cat ?? []);
    setAutonomy(aut ?? []);
    setPending(pend ?? []);
    setRecent(rec ?? []);
    // The new blocks fail independently — their errors stay local.
    if (usageRes) { setUsage(usageRes); setUsageError(""); } else setUsageError("AI ব্যবহারের তথ্য লোড করা যায়নি।");
    if (feedRes) { setFeed(feedRes); setFeedError(""); } else setFeedError("AI কার্যকলাপ লোড করা যায়নি।");
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
      setUsageError("AI ব্যবহারের তথ্য লোড করা যায়নি।");
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
      setFeedError("AI কার্যকলাপ লোড করা যায়নি।");
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
      setFeedError("আরও কার্যকলাপ লোড করা যায়নি।");
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
      const text = proposalOutcomeText(row);
      if (row.status === "failed") setError(text);
      else setNotice(text);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "সিদ্ধান্তটি দেওয়া যায়নি");
      await load();
    } finally { setBusy(""); }
  }

  async function changeAutonomy(row: AutonomyRow, level: number) {
    if (!orgId) return;
    setBusy(`autonomy-${row.actionId}`); setError(""); setNotice("");
    try {
      await apiFetch(`/organizations/${orgId}/ai/actions/autonomy/${row.actionId}`, { method: "PUT", body: JSON.stringify({ level }) });
      setNotice(`“${row.title.bn}”-এর মাত্রা বদলানো হয়েছে: ${autonomyLevelLabel(level)}।`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "মাত্রা বদলানো যায়নি");
      await load();
    } finally { setBusy(""); }
  }

  function actionTitle(p: ActionProposal): string {
    return (p.actionId ? catalogById.get(p.actionId)?.title.bn : null) ?? p.title;
  }

  const decided = recent.filter((p) => p.status !== "proposed");
  const summary = activitySummary(recent);

  return (
    <section id="hub-ai-control" className="card scroll-mt-24 p-5 sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <span className="stat-icon stat-icon-brand !h-10 !w-10 text-lg">🎛️</span>
        <div className="min-w-0">
          <h2 className="font-semibold leading-tight text-slate-900">AI নিয়ন্ত্রণ</h2>
          <p className="mt-0.5 text-[13px] leading-snug text-slate-500">AI শুধু কথা বলে না — কাজও করে। কোন কাজ AI নিজে করতে পারবে, কোনটায় আপনার অনুমোদন লাগবে, তা এখান থেকে ঠিক করা যায়। ডিফল্টে প্রতিটি কাজের প্রস্তাব আগে এখানে আসে; আপনি অনুমোদন না দিলে কিছুই হয় না। আর টাকা-সংক্রান্ত কাজ AI কখনোই নিজে করে না — সেগুলো শুধু প্রস্তাব পর্যন্তই।</p>
        </div>
      </div>

      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {notice ? <p className="mb-3 text-sm text-green-600">{notice}</p> : null}
      {!loaded ? <p className="text-sm text-slate-500">লোড হচ্ছে…</p> : null}

      {loaded ? (
        <div className="space-y-8">
          {/* ---- অপেক্ষমাণ প্রস্তাব ---- */}
          <div>
            <div className="font-semibold">কাজের প্রস্তাব — আপনার সিদ্ধান্তের অপেক্ষায়</div>
            {pending.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">এখন কোনো প্রস্তাব অপেক্ষায় নেই। AI বা টিম কোনো কাজের প্রস্তাব দিলে তা এখানে আসবে।</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {pending.map((p) => (
                  <li key={p.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                    <div>
                      <span className="font-medium">{p.title}</span>{" "}
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">{surfaceLabel(p.surface)}</span>{" "}
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">{actionTitle(p)}</span>{" "}
                      <span className="text-slate-400">{proposedByLabel(p.proposedBy)} · {ageText(p.createdAt)}</span>
                    </div>
                    <div className="mt-1 text-slate-600">{p.preview}</div>
                    {canDecide ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button className={BTN} disabled={busy === `decide-${p.id}`} onClick={() => decide(p, "approve")}>অনুমোদন করুন</button>
                        <button className={BTN} disabled={busy === `decide-${p.id}`} onClick={() => decide(p, "reject")}>বাতিল করুন</button>
                      </div>
                    ) : (
                      <p className="mt-1 text-[13px] text-slate-400">সিদ্ধান্ত দেওয়ার অধিকার আপনার ভূমিকায় নেই (মালিক/অ্যাডমিন/মার্কেটিং ম্যানেজার দরকার)।</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ---- সাম্প্রতিক কার্যকলাপ ---- */}
          <div className="border-t border-slate-100 pt-6">
            <div className="font-semibold">সাম্প্রতিক কার্যকলাপ</div>
            {recent.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">এখনো কোনো প্রস্তাবের ইতিহাস নেই।</p>
            ) : (
              <>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="text-xl font-bold">{summary.executed}</div>
                    <div className="text-[13px] text-slate-500">কার্যকর হয়েছে (যাচাইকৃত)</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="text-xl font-bold">{summary.failed}</div>
                    <div className="text-[13px] text-slate-500">ব্যর্থ হয়েছে</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <div className="text-xl font-bold">{summary.pending}</div>
                    <div className="text-[13px] text-slate-500">অপেক্ষমাণ</div>
                  </div>
                </div>
                <p className="mt-2 text-[13px] text-slate-400">এই হিসাব দেখানো সর্বশেষ ৫০টি প্রস্তাবের ওপর ভিত্তি করে — সব সময়ের মোট নয়।</p>
                {decided.length > 0 ? (
                  <ul className="mt-3 space-y-2">
                    {decided.slice(0, 10).map((p) => (
                      <li key={p.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                        <div>
                          <span className="font-medium">{p.title}</span>{" "}
                          <span className={`rounded px-1.5 py-0.5 text-xs ${p.status === "executed" ? "bg-green-100 text-green-700" : p.status === "failed" ? "bg-red-100 text-red-700" : isProposalOnly(p) ? "bg-amber-100 text-amber-700" : "bg-slate-200 text-slate-600"}`}>{isProposalOnly(p) ? "অনুমোদিত (শুধু প্রস্তাব)" : proposalStatusLabel(p.status)}</span>{" "}
                          <span className="text-slate-400">{formatDateTime(p.executedAt ?? p.decidedAt ?? p.updatedAt)}</span>
                        </div>
                        <div className="mt-1 text-slate-600">{proposalOutcomeText(p)}</div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </div>

          {/* ---- AI ব্যবহার (SA-B25 T4) ---- */}
          <div className="border-t border-slate-100 pt-6">
            <div className="font-semibold">AI ব্যবহার</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className={BTN} disabled={usageDays === 7} onClick={() => loadUsage(7)}>গত ৭ দিন</button>
              <button className={BTN} disabled={usageDays === 30} onClick={() => loadUsage(30)}>গত ৩০ দিন</button>
            </div>
            {usageError ? <p className="mt-2 text-sm text-red-600">{usageError}</p> : null}
            {usage?.totals ? (
              usage.totals.calls === 0 ? (
                <p className="mt-2 text-sm text-slate-500">এই সময়ে কোনো AI কল হয়নি।</p>
              ) : (
                <>
                  <p className="mt-2 text-sm text-slate-600">
                    মোট AI কল: {usage.totals.calls.toLocaleString("bn-BD")}
                    {usage.totals.estimatedCalls > 0 ? (
                      <> — এর মধ্যে {usage.totals.estimatedCalls.toLocaleString("bn-BD")}টি আনুমানিক হিসাবে (ডেভ অ্যাডাপ্টার)</>
                    ) : null}
                  </p>
                  {(usage.features ?? []).length > 0 ? (
                    <ul className="mt-3 space-y-2">
                      {usage.features.map((f) => (
                        <li key={f.feature} className="rounded-lg bg-slate-50 p-3 text-sm">
                          <span className="font-medium">{usageFeatureLabel(f.feature)}</span>{" "}
                          <span className="text-slate-600">{f.calls.toLocaleString("bn-BD")}টি কল</span>{" "}
                          <span className="text-slate-400">ইনপুট টোকেন: {f.inputTokens.toLocaleString("bn-BD")} · আউটপুট টোকেন: {f.outputTokens.toLocaleString("bn-BD")}</span>
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
            <div className="font-semibold">AI কার্যকলাপ</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {([null, "proposal", "learned", "answer", "content"] as (string | null)[]).map((k) => (
                <button key={k ?? "all"} className={BTN} disabled={feedBusy || feedKind === k} onClick={() => loadFeed(k, feedDays)}>
                  {k === null ? "সব" : activityKindLabel(k)}
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {[7, 30, 90].map((d) => (
                <button key={d} className={BTN} disabled={feedBusy || feedDays === d} onClick={() => loadFeed(feedKind, d)}>
                  শেষ {d.toLocaleString("bn-BD")} দিন
                </button>
              ))}
            </div>
            {feedError ? <p className="mt-2 text-sm text-red-600">{feedError}</p> : null}
            {feed ? (
              <>
                <p className="mt-2 text-[13px] text-slate-400">মোট {feed.total.toLocaleString("bn-BD")}টি ঘটনা (গত {feed.days.toLocaleString("bn-BD")} দিনে)</p>
                {(feed.items ?? []).length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">এই সময়ে কোনো কার্যকলাপ নেই।</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {feed.items.map((ev: ActivityEvent) => (
                      <li key={ev.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                        <div>
                          <span className="font-medium">{activityEventText(ev)}</span>{" "}
                          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">{activityKindLabel(ev.kind)}</span>{" "}
                          {activitySourceLabel(ev) ? (
                            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">{activitySourceLabel(ev)}</span>
                          ) : null}{" "}
                          <span className="text-slate-400">{formatDateTime(ev.at)}</span>
                          {isAdminConsoleDecision(ev) ? (
                            <> <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-700">{ADMIN_CONSOLE_DECISION_LABEL}</span></>
                          ) : null}
                        </div>
                        {ev.title ? <div className="mt-1 text-slate-600">{ev.title}</div> : null}
                        {ev.detail ? <div className="mt-1 text-red-600">কারণ: {ev.detail}</div> : null}
                      </li>
                    ))}
                  </ul>
                )}
                {feed.items.length < feed.total ? (
                  <div className="mt-3">
                    <button className={BTN} disabled={feedBusy} onClick={() => loadMoreFeed()}>আরও দেখুন</button>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          {/* ---- স্বায়ত্তশাসনের মাত্রা ---- */}
          <div className="border-t border-slate-100 pt-6">
            <div className="font-semibold">কোন কাজে AI কতটা নিজে করতে পারবে</div>
            <p className="mt-1 text-[13px] text-slate-500">প্রতিটি কাজের জন্য মাত্রা আলাদা করে ঠিক করা যায়। <b>বন্ধ</b> মানে ওই কাজের প্রস্তাবই আসবে না; <b>প্রস্তাব</b> মানে অনুমোদন ছাড়া কিছু হবে না (ডিফল্ট); <b>সীমিত নিজে</b> মানে শুধু কম ঝুঁকির কাজ অনুমোদন ছাড়া কার্যকর হবে — তাও ফলাফল যাচাই করেই। স্তর ৩ (তত্ত্বাবধানে নিজে) এই সংস্করণে চালু করা যায় না — এর জন্য মালিকের আলাদা সিদ্ধান্ত দরকার।</p>
            {autonomy.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">কাজের তালিকা লোড করা যায়নি।</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {autonomy.map((row) => (
                  <li key={row.actionId} className="rounded-lg bg-slate-50 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0">
                        <span className="font-medium">{row.title.bn}</span>{" "}
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">{surfaceLabel(row.surface)}</span>{" "}
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">{riskLabel(row.riskClass)}</span>
                        {row.moneyAdjacent ? (
                          <> <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">শুধু প্রস্তাব — AI নিজে করবে না</span></>
                        ) : null}
                      </span>
                      {canSetAutonomy ? (
                        <select
                          className="rounded-lg border px-2 py-1.5 text-[13px]"
                          value={row.level}
                          disabled={busy === `autonomy-${row.actionId}`}
                          onChange={(e) => changeAutonomy(row, Number(e.target.value))}
                          aria-label={`${row.title.bn}-এর মাত্রা`}
                        >
                          <option value={0}>বন্ধ</option>
                          <option value={1}>প্রস্তাব — মানুষ অনুমোদন দেবে</option>
                          <option value={2}>সীমিত নিজে — শুধু কম ঝুঁকির কাজ</option>
                          <option value={3} disabled>স্তর ৩ — তত্ত্বাবধানে নিজে (চালু করা যায় না)</option>
                        </select>
                      ) : (
                        <span className="rounded bg-slate-200 px-2 py-1 text-xs text-slate-600">{autonomyLevelLabel(row.level)}{row.levelIsDefault ? " (ডিফল্ট)" : ""}</span>
                      )}
                    </div>
                    {row.moneyAdjacent ? (
                      <p className="mt-1 text-[13px] text-slate-500">টাকা-সংক্রান্ত কাজ: যেকোনো মাত্রাতেই AI এটি নিজে কার্যকর করে না। অনুমোদন মানে শুধু সিদ্ধান্তটি রেকর্ড হওয়া — কাজটি টিমকে প্রচলিত পথে নিজে করতে হয়।</p>
                    ) : row.level === 2 && row.riskClass === "low" ? (
                      <p className="mt-1 text-[13px] text-slate-500">এই মাত্রায় এই কাজের প্রস্তাব অনুমোদন ছাড়াই কার্যকর হবে — তবে প্রতিবারই ফলাফল যাচাই করে রেকর্ড করা হবে।</p>
                    ) : row.level === 2 ? (
                      <p className="mt-1 text-[13px] text-slate-500">এই মাত্রায় শুধু কম ঝুঁকির কাজ নিজে থেকে কার্যকর হয় — এই কাজটি মাঝারি/বেশি ঝুঁকির, তাই এর প্রস্তাব অনুমোদনের জন্যই আসবে।</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {!canSetAutonomy ? (
              <p className="mt-2 text-[13px] text-slate-400">মাত্রা বদলানোর অধিকার শুধু মালিক/অ্যাডমিনের।</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
