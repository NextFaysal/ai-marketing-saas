"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { fmtDateTime, fmtMoneyMinor, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import type { UiLocale } from "@/lib/i18n/dict";
import {
  agencyCommissionRecords,
  agencyOrgChoices,
  agencySummaryError,
  bdtToMinor,
  clientOrgChoices,
  roleLabelBn,
  totalsBannerLabel,
  type AgencyCommissionView,
  type AgencyConsoleView,
} from "@/lib/agency-nf15";

// NF15 (FB5) — Agency / reseller console. There is NO agency
// entity: this page renders ONLY the signed-in user's own
// ACTIVE memberships, exactly as GET /agency/console returns
// them (built server-side from OrganizationsService.listMine
// through each org's normal per-org analytics path). Totals are
// labelled sums of the listed orgs ONLY — never consolidated
// cross-org analytics. ORG14 (cross-org team view) was never
// built and is NOT built here. Commissions are RECORDS ONLY.

const fmtM = (minor: string | null | undefined, locale: UiLocale): string => {
  if (minor == null) return "—";
  try { return fmtMoneyMinor(locale, BigInt(minor)); } catch { return minor; }
};

const inputCls = "w-full rounded-lg border px-3 py-2 text-sm";
const labelCls = "mb-1 block text-xs font-semibold text-slate-700";
const btnCls = "rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50";
const btnGhost = "rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50";

interface CreatedOrg { id: string; name: string; slug: string }

export default function AgencyConsolePage() {
  const { dict, t, locale } = useLocale();
  const D = dict.agency;
  const fmtML = (minor?: string | null): string => fmtM(minor, locale);
  const [consoleData, setConsoleData] = useState<AgencyConsoleView | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // create client org
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [createdOrg, setCreatedOrg] = useState<CreatedOrg | null>(null);
  const [inviteRole, setInviteRole] = useState("VIEWER");
  const [inviteUrl, setInviteUrl] = useState("");

  // commissions
  const [agencyOrgId, setAgencyOrgId] = useState("");
  const [clientOrgId, setClientOrgId] = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  const [amountBdt, setAmountBdt] = useState("");
  const [note, setNote] = useState("");
  const [entries, setEntries] = useState<AgencyCommissionView[]>([]);

  const loadConsole = useCallback(async () => {
    try {
      const data = await apiFetch<AgencyConsoleView>("/agency/console");
      setConsoleData(data);
      setAgencyOrgId((prev) => prev || agencyOrgChoices(data.orgs)[0]?.organization.id || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : D.agLoadFailed);
    }
  }, []);

  useEffect(() => { void loadConsole(); }, [loadConsole]);

  const loadEntries = useCallback(async (agencyId: string) => {
    if (!agencyId) { setEntries([]); return; }
    try {
      setEntries(await apiFetch<AgencyCommissionView[]>(`/organizations/${agencyId}/agency-commissions`));
    } catch { setEntries([]); }
  }, []);

  useEffect(() => { void loadEntries(agencyOrgId); }, [agencyOrgId, loadEntries]);

  async function createClientOrg() {
    setBusy(true); setError(""); setMsg(""); setInviteUrl("");
    try {
      const created = await apiFetch<CreatedOrg>("/agency/client-orgs", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim(), slug: newSlug.trim() }),
      });
      setCreatedOrg(created);
      setMsg(t("agency.agCreatedMsg", { name: created.name, slug: created.slug }));
      setNewName(""); setNewSlug("");
      await loadConsole();
    } catch (e) {
      setError(e instanceof Error ? e.message : D.agCreateFailed);
    } finally { setBusy(false); }
  }

  async function createInviteLink() {
    if (!createdOrg) return;
    setBusy(true); setError("");
    try {
      const out = await apiFetch<{ inviteUrl: string }>(`/organizations/${createdOrg.id}/invite-links`, {
        method: "POST",
        body: JSON.stringify({ role: inviteRole, maxUses: 10, expiresInDays: 7 }),
      });
      // ORG9 behaviour: the raw link is shown ONCE (server stores only its hash).
      setInviteUrl(out.inviteUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : D.agInviteFailed);
    } finally { setBusy(false); }
  }

  async function recordCommission() {
    setBusy(true); setError(""); setMsg("");
    try {
      const amountMinor = bdtToMinor(amountBdt);
      if (!amountMinor) throw new Error(D.agAmountInvalid);
      if (!clientOrgId) throw new Error(D.agClientRequired);
      if (!periodLabel.trim()) throw new Error(D.agPeriodRequired);
      await apiFetch(`/organizations/${agencyOrgId}/agency-commissions`, {
        method: "POST",
        body: JSON.stringify({
          clientOrganizationId: clientOrgId,
          periodLabel: periodLabel.trim(),
          amountMinor,
          note: note.trim() || undefined,
        }),
      });
      setMsg(D.agCommissionSaved);
      setPeriodLabel(""); setAmountBdt(""); setNote("");
      await loadEntries(agencyOrgId);
    } catch (e) {
      setError(e instanceof Error ? e.message : D.agCommissionFailed);
    } finally { setBusy(false); }
  }

  const orgs = consoleData?.orgs ?? [];
  const totals = consoleData?.totals;
  const agencyChoices = agencyOrgChoices(orgs);
  const clientChoices = clientOrgChoices(orgs, agencyOrgId);

  return (
    <div className="space-y-5">
      <section className="hero-panel p-5 sm:p-7">
        <div className="text-sm font-medium text-white/80">{D.agEyebrow}</div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{D.agTitle}</h1>
        <p className="mt-1 max-w-2xl text-sm text-white/75">{D.agSubtitle}</p>
      </section>

      {error ? <div className="alert alert-red"><span>⚠️</span><span>{error}</span></div> : null}
      {msg ? <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-inset ring-emerald-200">{msg}</div> : null}

      {/* Totals banner — labelled sums of the listed orgs only */}
      {totals ? (
        <div className="card p-5">
          <div className="section-title">{totalsBannerLabel(totals.orgCount, locale)}</div>
          {totals.summariesFailed > 0 ? (
            <p className="mt-1 text-xs text-amber-700">{t("agency.agSummariesFailed", { count: fmtNumber(locale, totals.summariesFailed) })}</p>
          ) : null}
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div><div className="stat-label">{D.agOrdersToday}</div><div className="stat-value">{fmtNumber(locale, totals.ordersToday)}</div></div>
            <div><div className="stat-label">{D.agRevenueToday}</div><div className="stat-value">{fmtML(totals.revenueTodayMinor)}</div></div>
            <div><div className="stat-label">{D.agOrdersMonth}</div><div className="stat-value">{fmtNumber(locale, totals.ordersMonth)}</div></div>
            <div><div className="stat-label">{D.agRevenueMonth}</div><div className="stat-value">{fmtML(totals.revenueMonthMinor)}</div></div>
            <div><div className="stat-label">{D.agPendingOrders}</div><div className="stat-value">{fmtNumber(locale, totals.pendingOrders)}</div></div>
            <div><div className="stat-label">{D.agUnreadInbox}</div><div className="stat-value">{fmtNumber(locale, totals.unreadInbox)}</div></div>
          </div>
        </div>
      ) : !error ? <p className="py-6 text-center text-sm text-slate-400">{dict.common.loading}</p> : null}

      {/* Per-org cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {orgs.map((card) => (
          <div key={card.organization.id} className="card p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-semibold text-slate-900">{card.organization.name}</div>
                <div className="text-xs text-slate-400">{card.organization.slug}</div>
              </div>
              <span className="badge-slate shrink-0">{roleLabelBn(card.myRole, locale)}</span>
            </div>
            <div className="mt-1 text-xs text-slate-500">{t("agency.agMyRole", { role: roleLabelBn(card.myRole, locale) })}</div>
            {card.summary ? (
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-slate-500">{D.agOrdersToday}</dt><dd className="font-medium">{t("agency.agCountSuffix", { count: fmtNumber(locale, card.summary.ordersToday) })}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">{D.agRevenueToday}</dt><dd className="font-medium">{fmtML(card.summary.revenueTodayMinor)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">{D.agOrdersMonth}</dt><dd className="font-medium">{t("agency.agCountSuffix", { count: fmtNumber(locale, card.summary.ordersMonth) })}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">{D.agRevenueMonth}</dt><dd className="font-medium">{fmtML(card.summary.revenueMonthMinor)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">{D.agPendingOrders}</dt><dd className="font-medium">{t("agency.agCountSuffix", { count: fmtNumber(locale, card.summary.pendingOrders) })}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">{D.agUnreadInbox}</dt><dd className="font-medium">{t("agency.agCountSuffix", { count: fmtNumber(locale, card.summary.unreadInbox) })}</dd></div>
              </dl>
            ) : (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{agencySummaryError(locale)}{D.agSummaryMissingSuffix}</p>
            )}
          </div>
        ))}
      </div>
      {consoleData && orgs.length === 0 ? (
        <p className="card p-5 text-sm text-slate-500">{D.agNoMemberships}</p>
      ) : null}

      {/* Create client org */}
      <div className="card p-5">
        <div className="section-title">{D.agCreateTitle}</div>
        <p className="mt-1 text-sm text-slate-500">{D.agCreateDesc}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700" htmlFor="agency-new-name">{dict.common.name}</label>
            <input id="agency-new-name" className={inputCls} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={D.agClientShopNamePh} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700" htmlFor="agency-new-slug">{D.agSlugLabel}</label>
            <input id="agency-new-slug" className={inputCls} value={newSlug} onChange={(e) => setNewSlug(e.target.value)} placeholder="client-shop" />
          </div>
        </div>
        <button className={btnCls + " mt-3"} disabled={busy || !newName.trim() || !newSlug.trim()} onClick={createClientOrg}>
          {D.agCreateBtn}
        </button>
        {createdOrg ? (
          <div className="mt-4 rounded-xl bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-800">{t("agency.agCreatedLabel", { name: createdOrg.name })} <span className="font-normal text-slate-400">({createdOrg.slug})</span></div>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div>
                <label className={labelCls} htmlFor="agency-invite-role">{D.agInviteRoleLabel}</label>
                <select id="agency-invite-role" className={inputCls} value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                  <option value="VIEWER">{D.agRoleViewer}</option>
                  <option value="SUPPORT_AGENT">{D.agRoleSupport}</option>
                  <option value="MARKETING_MANAGER">{D.agRoleMarketing}</option>
                  <option value="ADVERTISER">{D.agRoleAdvertiser}</option>
                  <option value="ANALYST">{D.agRoleAnalyst}</option>
                  <option value="ADMIN">{D.agRoleAdmin}</option>
                </select>
              </div>
              <button className={btnGhost} disabled={busy} onClick={createInviteLink}>
                {D.agInviteBtn}
              </button>
            </div>
            {inviteUrl ? (
              <div className="mt-3">
                <p className="text-xs text-amber-700">{D.agInviteNote}</p>
                <code className="mt-1 block break-all rounded-lg bg-white px-3 py-2 text-xs ring-1 ring-slate-200">{inviteUrl}</code>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Commissions — records only */}
      <div className="card p-5">
        <div className="section-title">{D.agCommissionTitle}</div>
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          {agencyCommissionRecords(locale)}
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="agency-comm-agency">{D.agCommAgencyLabel}</label>
            <select id="agency-comm-agency" className={inputCls} value={agencyOrgId} onChange={(e) => { setAgencyOrgId(e.target.value); setClientOrgId(""); }}>
              <option value="">{D.agChooseEllipsis}</option>
              {agencyChoices.map((o) => (
                <option key={o.organization.id} value={o.organization.id}>{o.organization.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="agency-comm-client">{D.agCommClientLabel}</label>
            <select id="agency-comm-client" className={inputCls} value={clientOrgId} onChange={(e) => setClientOrgId(e.target.value)}>
              <option value="">{D.agChooseEllipsis}</option>
              {clientChoices.map((o) => (
                <option key={o.organization.id} value={o.organization.id}>{o.organization.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="agency-comm-period">{D.agPeriodLabel}</label>
            <input id="agency-comm-period" className={inputCls} value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} placeholder={D.agPeriodPh} maxLength={40} />
          </div>
          <div>
            <label className={labelCls} htmlFor="agency-comm-amount">{D.agAmountLabel}</label>
            <input id="agency-comm-amount" className={inputCls} value={amountBdt} onChange={(e) => setAmountBdt(e.target.value)} placeholder="1500" inputMode="decimal" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls} htmlFor="agency-comm-note">{D.agNoteLabel}</label>
            <input id="agency-comm-note" className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder={D.agNotePh} />
          </div>
        </div>
        <button className={btnCls + " mt-3"} disabled={busy || !agencyOrgId} onClick={recordCommission}>
          {D.agRecordBtn}
        </button>

        <div className="mt-5">
          <div className="text-sm font-semibold text-slate-800">{D.agRecordsTitle} {agencyOrgId ? "" : D.agRecordsPickFirst}</div>
          {entries.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">{D.agNoRecords}</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {entries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
                  <span className="font-medium text-slate-800">{e.periodLabel}</span>
                  <span className="text-slate-500">{t("agency.agClientPrefix", { name: e.clientOrganizationName ?? e.clientOrganizationId })}</span>
                  <span className="text-slate-500">{D.agAmountWord} <b className="text-slate-800">{fmtML(e.amountMinor)}</b></span>
                  {e.note ? <span className="text-slate-400">{e.note}</span> : null}
                  <span className="text-xs text-slate-400">{fmtDateTime(locale, e.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
