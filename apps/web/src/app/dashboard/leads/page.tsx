"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor, fmtDateTime, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import { crmBn, crmEn } from "@/lib/i18n/crm";
import { EmptyState, KpiCard } from "@repo/ui";
import {
  CustomFieldsEditor, CustomFieldsManager, buildCustomFieldsPayload, customFieldsToRaw, fetchCustomFieldDefs,
  type CustomFieldDef,
} from "@/components/custom-fields";

const STAGES = ["new", "contacted", "qualified", "proposal", "won", "lost"] as const;
const STAGE_LABEL: Record<string, string> = { new: crmBn.stageNew, contacted: crmBn.stageContacted, qualified: crmBn.stageQualified, proposal: crmBn.stageProposal, won: crmBn.stageWon, lost: crmBn.stageLost };
const stageLabelFor = (locale?: string): Record<string, string> => {
  const dd = locale === "en" ? crmEn : crmBn;
  return { new: dd.stageNew, contacted: dd.stageContacted, qualified: dd.stageQualified, proposal: dd.stageProposal, won: dd.stageWon, lost: dd.stageLost };
};
const sourceLabelFor = (locale?: string): Record<string, string> => {
  const dd = locale === "en" ? crmEn : crmBn;
  return { manual: dd.sourceManual, whatsapp: "WhatsApp", messenger: "Messenger", instagram: "Instagram", telegram: "Telegram", email: "Email", website: dd.sourceWebsite, webchat: dd.sourceWebchat, woocommerce: "WooCommerce", facebook_lead_ads: "Facebook Lead Ads", total: dd.sourceTotal };
};

interface LeadScore { score: number; band: "hot" | "warm" | "cold"; reasons: string[]; thinData: boolean }
interface Lead { id: string; name: string; phone?: string | null; email?: string | null; source: string; stage: string; valueMinor?: string | null; currency: string; customerId?: string | null; ownerUserId?: string | null; nextFollowUpAt?: string | null; score?: LeadScore | null; updatedAt: string }

function ScoreBadge({ score }: { score?: LeadScore | null }) {
  const { t, locale } = useLocale();
  if (!score) return null;
  const cls = score.band === "hot" ? "bg-red-100 text-red-700" : score.band === "warm" ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-600";
  const icon = score.band === "hot" ? "🔥" : score.band === "warm" ? "🌤️" : "❄️";
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${cls}`} title={score.reasons.join("\n")}>{icon} {t("crm.scoreWord")} {fmtNumber(locale, score.score)}</span>;
}
interface FollowUpLead extends Lead { ownerName?: string | null; due: { bucket: string; daysOverdue: number; label: string } }
// CRM C6: funnel row shape from GET organizations/:id/crm/funnel.
interface FunnelRow { source: string; created: number; byStage: Record<string, number>; won: number; wonRate: number | null; converted: number; conversionRate: number | null; wonValueMinor: string }
const SOURCE_LABEL: Record<string, string> = sourceLabelFor("bn");
const STAGE_COLOR: Record<string, string> = { new: "bg-slate-400", contacted: "bg-sky-400", qualified: "bg-indigo-400", proposal: "bg-amber-400", won: "bg-green-500", lost: "bg-red-400" };
const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 1000) / 10}%`);
interface LeadDetail extends Lead {
  activities: { id: string; type: string; content: string; createdAt: string }[];
  customFields?: Record<string, unknown> | null;
}
interface LeadImportResult {
  id: string; totalRows: number; successRows: number; failedRows: number; skippedRows: number;
  errors?: { row: number; message: string }[] | null;
  details?: { created: { row: number; leadId: string }[]; skipped: { row: number; leadId: string; phone: string }[] };
}

export default function LeadsPage() {
  const { t, locale } = useLocale();
  const STAGE_LABEL_L = stageLabelFor(locale);
  const SOURCE_LABEL_L = sourceLabelFor(locale);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [pipeline, setPipeline] = useState<{ byStage: Record<string, { count: number; valueMinor: string }>; totalLeads: number; openPipelineValueMinor: string } | null>(null);
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", source: "manual", value: "" });
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [dupGroups, setDupGroups] = useState<{ phoneKey: string; leads: { id: string; name: string; phone?: string | null; stage: string }[] }[]>([]);
  const [sortBy, setSortBy] = useState("recent");
  const [followUps, setFollowUps] = useState<{ dueToday: FollowUpLead[]; overdue: FollowUpLead[] }>({ dueToday: [], overdue: [] });
  const [reschedule, setReschedule] = useState<Record<string, string>>({});
  const [leadDefs, setLeadDefs] = useState<CustomFieldDef[]>([]);
  const [createCf, setCreateCf] = useState<Record<string, string>>({});
  const [detailCf, setDetailCf] = useState<Record<string, string>>({});
  const [cfBusy, setCfBusy] = useState(false);
  const [assignStrategy, setAssignStrategy] = useState("off");
  const [assignBusy, setAssignBusy] = useState(false);
  // CX10: per-stage follow-up default intervals (hours, as typed).
  const [followUpDefaults, setFollowUpDefaults] = useState<Record<string, string>>({});
  const [followUpBusy, setFollowUpBusy] = useState(false);
  const [funnelDays, setFunnelDays] = useState(30);
  const [funnel, setFunnel] = useState<{ days: number; sources: FunnelRow[]; totals: FunnelRow } | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<LeadImportResult | null>(null);
  const [importError, setImportError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const qs = new URLSearchParams();
      if (search) qs.set("search", search);
      if (sortBy === "score") qs.set("sort", "score");
      const [l, p] = await Promise.all([
        apiFetch<Lead[]>(`/organizations/${orgId}/leads${qs.size ? `?${qs}` : ""}`),
        apiFetch<any>(`/organizations/${orgId}/leads/pipeline`),
      ]);
      setLeads(l); setPipeline(p);
      apiFetch<{ phoneKey: string; leads: { id: string; name: string; phone?: string | null; stage: string }[] }[]>(`/organizations/${orgId}/leads/duplicates`).then(setDupGroups).catch(() => undefined);
      apiFetch<{ dueToday: FollowUpLead[]; overdue: FollowUpLead[] }>(`/organizations/${orgId}/leads/follow-ups`).then(setFollowUps).catch(() => undefined);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }, [search, sortBy]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetchCustomFieldDefs("lead").then(setLeadDefs).catch(() => undefined); }, []);
  useEffect(() => {
    const orgId = getOrganizationId(); if (!orgId) return;
    apiFetch<{ leadAssignStrategy: string }>(`/organizations/${orgId}/leads/assignment-setting`)
      .then((s) => setAssignStrategy(s.leadAssignStrategy)).catch(() => undefined);
  }, []);

  useEffect(() => {
    const orgId = getOrganizationId(); if (!orgId) return;
    apiFetch<{ followUpDefaultsByStage: Record<string, number> | null }>(`/organizations/${orgId}/leads/followup-setting`)
      .then((s) => {
        const raw: Record<string, string> = {};
        for (const stage of STAGES) {
          const v = s.followUpDefaultsByStage?.[stage];
          raw[stage] = v != null ? String(v) : "";
        }
        setFollowUpDefaults(raw);
      }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const orgId = getOrganizationId(); if (!orgId) return;
    apiFetch<{ days: number; sources: FunnelRow[]; totals: FunnelRow }>(`/organizations/${orgId}/crm/funnel?days=${funnelDays}`)
      .then(setFunnel).catch(() => undefined);
  }, [funnelDays]);

  // CRM C5: the org's lead auto-assignment strategy (OWNER/ADMIN
  // only — the API rejects other roles and the error shows below).
  async function saveAssignStrategy() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setAssignBusy(true); setError("");
    try {
      await apiFetch(`/organizations/${orgId}/leads/assignment-setting`, { method: "PATCH", body: JSON.stringify({ strategy: assignStrategy }) });
      setNotice(t("crm.assignSaved"));
    } catch (e) { setError(e instanceof Error ? e.message : t("crm.leadSaveFailed")); }
    finally { setAssignBusy(false); }
  }

  // CX10: save per-stage follow-up defaults. Empty input = no
  // automatic follow-up for that stage; the server validates the
  // stage keys and the 1..8760 hour range and its 400 shows below.
  async function saveFollowUpDefaults() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setFollowUpBusy(true); setError("");
    try {
      const payload: Record<string, number> = {};
      for (const stage of STAGES) {
        const raw = (followUpDefaults[stage] ?? "").trim();
        if (raw) payload[stage] = Number(raw);
      }
      await apiFetch(`/organizations/${orgId}/leads/followup-setting`, { method: "PATCH", body: JSON.stringify({ followUpDefaultsByStage: payload }) });
      setNotice(t("crm.followUpDefaultsSaved"));
    } catch (e) { setError(e instanceof Error ? e.message : t("crm.leadSaveFailed")); }
    finally { setFollowUpBusy(false); }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setError("");
    try {
      const customFields = buildCustomFieldsPayload(leadDefs, createCf, null);
      await apiFetch(`/organizations/${orgId}/leads`, {
        method: "POST",
        body: JSON.stringify({ ...form, value: form.value || undefined, ...(Object.keys(customFields).length ? { customFields } : {}) }),
      });
      setForm({ name: "", phone: "", email: "", source: "manual", value: "" });
      setCreateCf({});
      setNotice(t("crm.leadCreated"));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  async function openDetail(lead: Lead) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const d = await apiFetch<LeadDetail>(`/organizations/${orgId}/leads/${lead.id}`);
    setDetail(d);
    setDetailCf(customFieldsToRaw(leadDefs, d.customFields));
  }

  // CRM C4: save the detail panel's custom-field values (partial
  // PATCH; cleared inputs become explicit nulls server-side).
  async function saveDetailCustomFields() {
    const orgId = getOrganizationId(); if (!orgId || !detail) return;
    setCfBusy(true); setError("");
    try {
      const payload = buildCustomFieldsPayload(leadDefs, detailCf, detail.customFields);
      await apiFetch(`/organizations/${orgId}/leads/${detail.id}`, { method: "PATCH", body: JSON.stringify({ customFields: payload }) });
      setNotice(t("crm.customFieldsSaved"));
      await openDetail(detail);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : t("crm.leadSaveFailed")); }
    finally { setCfBusy(false); }
  }

  async function changeStage(lead: Lead, stage: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    await apiFetch(`/organizations/${orgId}/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ stage }) });
    await load();
    if (detail?.id === lead.id) await openDetail(lead);
  }

  // M51: drag-and-drop is a convenience over the SAME stage PATCH.
  // The card moves optimistically; if the PATCH fails it snaps back
  // and the error is shown. The select below keeps working (mobile).
  async function dropStage(leadId: string, stage: string) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stage === stage) return;
    const before = leads;
    setLeads(leads.map((l) => (l.id === leadId ? { ...l, stage } : l)));
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/leads/${leadId}`, { method: "PATCH", body: JSON.stringify({ stage }) });
      await load();
    } catch (e) {
      setLeads(before);
      setError(`${t("crm.stageChangeFailed")} ${e instanceof Error ? e.message : ""}`);
    }
  }

  // C1 follow-up board actions — existing endpoints only. "Contacted"
  // writes a note (which stamps lastContactedAt server-side)
  // and clears the follow-up date; reschedule/clear use the PATCH.
  async function followUpDone(lead: FollowUpLead) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/leads/${lead.id}/notes`, { method: "POST", body: JSON.stringify({ content: t("crm.followUpDoneNote") }) });
      await apiFetch(`/organizations/${orgId}/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ nextFollowUpAt: null }) });
      setNotice(t("crm.followUpDoneNotice", { name: lead.name }));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  async function followUpReschedule(lead: FollowUpLead) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const date = reschedule[lead.id]; if (!date) { setError(t("crm.pickDateFirst")); return; }
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ nextFollowUpAt: date }) });
      setNotice(t("crm.followUpMovedNotice", { name: lead.name }));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  async function followUpClear(lead: FollowUpLead) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ nextFollowUpAt: null }) });
      setNotice(t("crm.followUpClearedNotice", { name: lead.name }));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  }

  // CRM C3: CSV import — same flow as the orders importer (file is
  // read in the browser, posted as text, per-row summary comes back).
  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const orgId = getOrganizationId(); if (!orgId) return;
    setImportBusy(true); setImportError(""); setImportResult(null);
    try {
      const csvText = await file.text();
      const data = await apiFetch<LeadImportResult>(`/organizations/${orgId}/leads/import`, {
        method: "POST", body: JSON.stringify({ fileName: file.name, csvText }),
      });
      setImportResult(data);
      await load();
    } catch (err) { setImportError(err instanceof Error ? err.message : t("crm.importFailed")); }
    finally { setImportBusy(false); }
  }

  // CRM C3: CSV export — binary download, so fetch the blob directly
  // with the auth header (same pattern as the orders PDF downloads).
  async function downloadExport() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError("");
    try {
      const res = await fetch(`${API_URL}/organizations/${orgId}/leads/export`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
      if (!res.ok) { const body: any = await res.json().catch(() => ({})); throw new Error(body?.message ?? `HTTP ${res.status}`); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "leads-export.csv"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) { setError(err instanceof Error ? err.message : t("crm.exportFailed")); }
  }

  async function addNote() {
    const orgId = getOrganizationId(); if (!orgId || !detail || !note.trim()) return;
    setDetail(await apiFetch<LeadDetail>(`/organizations/${orgId}/leads/${detail.id}/notes`, { method: "POST", body: JSON.stringify({ content: note }) }));
    setNote("");
  }

  async function convert(lead: Lead) {
    const orgId = getOrganizationId(); if (!orgId) return;
    const res = await apiFetch<{ alreadyConverted: boolean }>(`/organizations/${orgId}/leads/${lead.id}/convert`, { method: "POST" });
    setNotice(res.alreadyConverted ? t("crm.alreadyConverted") : t("crm.convertedDone"));
    await load();
  }

  const inputCls = "input mt-1";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Leads & CRM</h1>
        {dupGroups.length > 0 ? (
          <div className="card space-y-2 border-amber-200 bg-amber-50 p-4">
            <div className="text-sm font-semibold text-amber-800">{t("crm.dupTitle")}</div>
            {dupGroups.map((g) => (
              <div key={g.phoneKey} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">📞 …{g.phoneKey.slice(-6)}:</span>
                {g.leads.map((l) => <span key={l.id} className="rounded bg-white px-2 py-0.5 ring-1 ring-amber-200">{l.name} · {l.stage}</span>)}
                <button className="btn-warning btn-sm !px-2 !py-0.5 !text-[11px]" onClick={async () => {
                  const orgId = getOrganizationId(); if (!orgId) return;
                  const [target, ...rest] = g.leads;
                  try {
                    for (const src of rest) {
                      await apiFetch(`/organizations/${orgId}/leads/${target.id}/merge`, { method: "POST", body: JSON.stringify({ sourceLeadId: src.id }) });
                    }
                    setNotice(t("crm.mergedNotice", { name: target.name }));
                    await load();
                  } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
                }}>{t("crm.mergeIntoFirst")}</button>
              </div>
            ))}
            <p className="text-[11px] text-amber-700">{t("crm.dupNote")}</p>
          </div>
        ) : null}
        <p className="text-sm text-slate-500">{t("crm.leadsIntro")}</p>
      </div>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{notice}</p> : null}

      {pipeline ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard label={t("crm.kpiTotalLeads")} value={String(pipeline.totalLeads)} />
          <KpiCard label="Open Pipeline Value" value={formatMinor(BigInt(pipeline.openPipelineValueMinor))} hint={t("crm.kpiOpenValueHint")} />
          <KpiCard label="Won" value={String(pipeline.byStage.won?.count ?? 0)} hint={formatMinor(BigInt(pipeline.byStage.won?.valueMinor ?? "0"))} />
          <KpiCard label={t("crm.kpiNewLeads")} value={String(pipeline.byStage.new?.count ?? 0)} />
        </div>
      ) : null}

      <div className="card space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="font-semibold">{t("crm.assignTitle")}</div>
          <select className="rounded-lg border bg-white px-2 py-1.5 text-sm" value={assignStrategy} onChange={(e) => setAssignStrategy(e.target.value)}>
            <option value="off">{t("crm.assignOff")}</option>
            <option value="round_robin">{t("crm.assignRoundRobin")}</option>
            <option value="least_open_leads">{t("crm.assignLeastOpen")}</option>
          </select>
          <button className="rounded-lg border px-3 py-1.5 text-sm font-semibold" disabled={assignBusy} onClick={saveAssignStrategy}>
            {assignBusy ? t("crm.saving") : t("crm.save")}
          </button>
        </div>
        <p className="text-xs text-slate-500">
{t("crm.assignIntro")}
        </p>
        <p className="text-xs text-slate-500">
          {assignStrategy === "off"
            ? t("crm.assignOffNote")
            : assignStrategy === "round_robin"
              ? t("crm.assignRoundRobinNote")
              : t("crm.assignLeastOpenNote")}
        </p>
      </div>

      <div className="card space-y-3 p-4">
        <div className="font-semibold">{t("crm.followUpTitle")}</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {([
            ["new", t("crm.stageNew")],
            ["contacted", t("crm.stageContacted")],
            ["qualified", t("crm.stageQualifiedLong")],
            ["proposal", t("crm.stageProposalLong")],
            ["won", t("crm.stageWonLong")],
            ["lost", t("crm.stageLostLong")],
          ] as const).map(([stage, label]) => (
            <label key={stage} className="block text-sm">{label} {t("crm.hoursAfterSuffix")}
              <input type="number" min={1} max={8760} step={1} className={inputCls} placeholder={t("crm.emptyMeansNone")}
                value={followUpDefaults[stage] ?? ""}
                onChange={(e) => setFollowUpDefaults({ ...followUpDefaults, [stage]: e.target.value })} />
            </label>
          ))}
        </div>
        <p className="text-xs text-slate-500">
{t("crm.followUpDefaultsNote")}
        </p>
        <div>
          <button className="rounded-lg border px-3 py-1.5 text-sm font-semibold" disabled={followUpBusy} onClick={saveFollowUpDefaults}>
            {followUpBusy ? t("crm.saving") : t("crm.save")}
          </button>
        </div>
      </div>

      <div className="card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">{t("crm.todayFollowUpTitle")}</div>
          <div className="text-xs text-slate-500">{t("crm.todayFollowUpSummary", { due: fmtNumber(locale, followUps.dueToday.length), overdue: fmtNumber(locale, followUps.overdue.length) })}</div>
        </div>
        {followUps.dueToday.length === 0 && followUps.overdue.length === 0 ? (
          <p className="text-sm text-green-700">{t("crm.noFollowUpToday")}</p>
        ) : null}
        {([["overdue", t("crm.overdueTitle"), followUps.overdue, "bg-red-100 text-red-700"], ["today", t("crm.todayDueTitle"), followUps.dueToday, "bg-amber-100 text-amber-800"]] as const).map(([key, title, rows, badgeCls]) =>
          rows.length ? (
            <div key={key} className="space-y-2">
              <div className="text-sm font-semibold">{title}</div>
              {rows.map((lead) => (
                <div key={lead.id} className="flex flex-wrap items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm">
                  <button className="font-medium hover:underline" onClick={() => openDetail(lead)}>{lead.name}</button>
                  <span className="text-xs text-slate-400">{lead.phone ?? lead.email ?? ""}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px]">{STAGE_LABEL_L[lead.stage] ?? lead.stage}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badgeCls}`}>{lead.due.label}</span>
                  {lead.ownerName ? <span className="text-[11px] text-slate-500">{t("crm.ownerLabel")}: {lead.ownerName}</span> : null}
                  <span className="ml-auto flex flex-wrap items-center gap-1.5">
                    <input type="date" className="rounded border px-1.5 py-1 text-xs" value={reschedule[lead.id] ?? ""} onChange={(e) => setReschedule({ ...reschedule, [lead.id]: e.target.value })} />
                    <button className="rounded-lg border px-2 py-1 text-xs font-semibold" onClick={() => followUpReschedule(lead)}>{t("crm.newDate")}</button>
                    <button className="rounded-lg bg-green-600 px-2 py-1 text-xs font-semibold text-white" onClick={() => followUpDone(lead)}>{t("crm.contactedBtn")}</button>
                    <button className="rounded-lg border px-2 py-1 text-xs" onClick={() => followUpClear(lead)}>{t("crm.cancelBtn")}</button>
                  </span>
                </div>
              ))}
            </div>
          ) : null,
        )}
      </div>

      {funnel ? (
        <div className="card space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">{t("crm.funnelTitle")}</div>
            <label className="flex items-center gap-2 text-sm text-slate-500">{t("crm.periodLabel")}
              <select className="rounded-lg border bg-white px-2 py-1.5 text-sm" value={funnelDays} onChange={(e) => setFunnelDays(Number(e.target.value))}>
                <option value={7}>{t("crm.last7")}</option>
                <option value={30}>{t("crm.last30")}</option>
                <option value={90}>{t("crm.last90")}</option>
              </select>
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 pr-2 font-semibold">{t("crm.colSource")}</th>
                  <th className="py-2 pr-2 font-semibold">{t("crm.colCreated")}</th>
                  <th className="py-2 pr-2 font-semibold">{t("crm.colStageDist")}</th>
                  <th className="py-2 pr-2 font-semibold">Won</th>
                  <th className="py-2 pr-2 font-semibold">{t("crm.colWonRate")}</th>
                  <th className="py-2 pr-2 font-semibold">{t("crm.colConverted")}</th>
                  <th className="py-2 pr-2 font-semibold">{t("crm.colConversionRate")}</th>
                  <th className="py-2 font-semibold">{t("crm.colWonValue")}</th>
                </tr>
              </thead>
              <tbody>
                {[...funnel.sources, funnel.totals].map((row) => {
                  const isTotal = row.source === "total";
                  return (
                    <tr key={row.source} className={isTotal ? "border-t-2 bg-slate-50 font-semibold" : "border-b last:border-0"}>
                      <td className="py-2 pr-2">{SOURCE_LABEL_L[row.source] ?? row.source}</td>
                      <td className="py-2 pr-2">{row.created}</td>
                      <td className="py-2 pr-2">
                        <div className="flex h-2.5 w-44 overflow-hidden rounded-full bg-slate-100">
                          {STAGES.map((s) => (row.created && (row.byStage[s] ?? 0) > 0 ? (
                            <div key={s} className={STAGE_COLOR[s]} style={{ width: `${((row.byStage[s] ?? 0) / row.created) * 100}%` }} title={`${STAGE_LABEL_L[s]}: ${row.byStage[s] ?? 0}`} />
                          ) : null))}
                        </div>
                        <div className="mt-1 text-[11px] font-normal text-slate-400">{STAGES.map((s) => `${STAGE_LABEL_L[s]} ${row.byStage[s] ?? 0}`).join(" · ")}</div>
                      </td>
                      <td className="py-2 pr-2">{row.won}</td>
                      <td className="py-2 pr-2">{pct(row.wonRate)}</td>
                      <td className="py-2 pr-2">{row.converted}</td>
                      <td className="py-2 pr-2">{pct(row.conversionRate)}</td>
                      <td className="py-2">{formatMinor(BigInt(row.wonValueMinor))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
            {STAGES.map((s) => (
              <span key={s} className="flex items-center gap-1"><span className={`inline-block h-2 w-2 rounded-full ${STAGE_COLOR[s]}`} />{STAGE_LABEL_L[s]}</span>
            ))}
          </div>
          <p className="text-[11px] text-slate-400">
{t("crm.funnelDefs")}
          </p>
        </div>
      ) : null}

      <div>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {STAGES.map((stage) => (
          <div key={stage} className="rounded-xl border bg-slate-50 p-3"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); if (id) void dropStage(id, stage); }}>
            <div className="flex items-center justify-between text-sm font-semibold">{STAGE_LABEL_L[stage]}<span className="rounded-full bg-white px-2 py-0.5 text-xs">{pipeline?.byStage[stage]?.count ?? 0}</span></div>
            <div className="mt-2 space-y-2">
              {leads.filter((l) => l.stage === stage).map((lead) => (
                <div key={lead.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", lead.id)} className="cursor-grab rounded-lg border bg-white p-2.5 text-sm active:cursor-grabbing">
                  <button className="font-medium hover:underline" onClick={() => openDetail(lead)}>{lead.name}</button>
                  <div className="text-xs text-slate-400">{lead.phone ?? lead.email ?? ""} · {lead.source}</div>
                  {lead.valueMinor ? <div className="text-xs font-semibold">{formatMinor(BigInt(lead.valueMinor), lead.currency)}</div> : null}
                  <div className="mt-1"><ScoreBadge score={lead.score} /></div>
                  <select className="mt-1.5 w-full rounded border px-1 py-1 text-xs" value={lead.stage} onChange={(e) => changeStage(lead, e.target.value)}>
                    {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL_L[s]}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">{t("crm.boardNote")}</p>
      {leads.length === 0 ? <EmptyState title={t("crm.noLeadsTitle")} description={t("crm.noLeadsDesc")} /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={create} className="space-y-3 card p-5">
          <div className="font-semibold">{t("crm.newLeadTitle")}</div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">{t("crm.nameLabel")}<input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <label className="block text-sm">{t("crm.phoneLabel")}<input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
            <label className="block text-sm">{t("crm.emailLabel")}<input className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label className="block text-sm">{t("crm.estValueLabel")}<input className={inputCls} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="0.00" /></label>
            <label className="block text-sm">{t("crm.sourceLabel")}
              <select className={inputCls} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                <option value="manual">Manual</option><option value="whatsapp">WhatsApp</option><option value="messenger">Messenger</option><option value="website">Website</option><option value="woocommerce">WooCommerce</option>
              </select>
            </label>
            <CustomFieldsEditor defs={leadDefs} raw={createCf} onChange={(k, v) => setCreateCf({ ...createCf, [k]: v })} />
          </div>
          <button className="btn-primary">{t("crm.addLead")}</button>
        </form>

        {detail ? (
          <div className="space-y-3 card p-5">
            <div className="flex items-center justify-between">
              <div className="font-semibold">{detail.name}</div>
              {!detail.customerId ? <button className="rounded-lg border px-3 py-1.5 text-xs font-semibold" onClick={() => convert(detail)}>{t("crm.convertToCustomer")}</button> : <span className="text-xs text-green-600">{t("crm.customerLinked")}</span>}
            </div>
            <div className="text-sm text-slate-500">{detail.phone ?? ""} {detail.email ?? ""} · {t("crm.sourceWord")}: {detail.source} · Stage: {STAGE_LABEL_L[detail.stage]}</div>
            {detail.score ? (
              <div className="space-y-1 rounded-xl border p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">{t("crm.leadScoreTitle")} <ScoreBadge score={detail.score} />
                  <span className="text-xs font-normal text-slate-500">{detail.score.band === "hot" ? t("crm.bandHot") : detail.score.band === "warm" ? t("crm.bandWarm") : t("crm.bandCold")}</span>
                </div>
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-600">
                  {detail.score.reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
                <p className="text-[11px] text-slate-400">{t("crm.scoreNote")}</p>
              </div>
            ) : null}
            {leadDefs.length ? (
              <div className="space-y-2 rounded-xl border p-3">
                <div className="text-sm font-semibold">{t("crm.customFieldsTitle")}</div>
                <div className="grid grid-cols-2 gap-3">
                  <CustomFieldsEditor defs={leadDefs} raw={detailCf} onChange={(k, v) => setDetailCf({ ...detailCf, [k]: v })} />
                </div>
                <button className="rounded-lg border px-3 py-1.5 text-xs font-semibold" disabled={cfBusy} onClick={saveDetailCustomFields}>
                  {cfBusy ? t("crm.saving") : t("crm.customFieldsSave")}
                </button>
              </div>
            ) : null}
            <div className="flex gap-2">
              <input className="flex-1 rounded-lg border px-3 py-2 text-sm" placeholder={t("crm.notePlaceholder")} value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn-primary btn-sm" onClick={addNote}>{t("crm.noteSave")}</button>
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {detail.activities.map((a) => (
                <div key={a.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span className="text-xs font-semibold text-slate-400">{a.type} · {fmtDateTime(locale, a.createdAt)}</span>
                  <div>{a.content}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="card p-5 text-sm text-slate-500">{t("crm.detailHint")}</div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input className="w-72 rounded-lg border bg-white px-3 py-2 text-sm" placeholder={t("crm.searchPlaceholder")} value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="rounded-lg border bg-white px-2 py-2 text-sm" value={sortBy} onChange={(e) => setSortBy(e.target.value)} title={t("crm.sortTitle")}>
          <option value="recent">{t("crm.sortRecent")}</option>
          <option value="score">{t("crm.sortScore")}</option>
        </select>
        <span className="ml-auto flex gap-2">
          <button className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold" onClick={() => setShowImport((v) => !v)}>{t("crm.csvImportBtn")}</button>
          <button className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold" onClick={downloadExport}>{t("crm.exportBtn")}</button>
        </span>
      </div>

      {showImport ? (
        <div className="card space-y-3 p-5">
          <div className="font-semibold">{t("crm.importTitle")}</div>
          <p className="text-sm text-slate-500">
{t("crm.importHelp")}
          </p>
          <label className="block text-sm">
            <input type="file" accept=".csv,text/csv" className="block w-full text-sm" onChange={onImportFile} disabled={importBusy} />
          </label>
          {importBusy ? <p className="text-sm text-slate-500">{t("crm.importing")}</p> : null}
          {importError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{importError}</p> : null}
          {importResult ? (
            <div className="space-y-2 text-sm">
              <p className="font-medium">
                {t("crm.importSummary", { total: fmtNumber(locale, importResult.totalRows), success: fmtNumber(locale, importResult.successRows), skipped: fmtNumber(locale, importResult.skippedRows), failed: fmtNumber(locale, importResult.failedRows) })}
              </p>
              {importResult.details?.skipped?.length ? (
                <div>
                  <div className="text-xs font-semibold text-slate-500">{t("crm.importSkippedTitle")}</div>
                  <ul className="list-disc pl-5 text-xs text-slate-600">
                    {importResult.details.skipped.slice(0, 20).map((s) => <li key={s.row}>{t("crm.importSkippedRow", { row: s.row, phone: s.phone })} ({s.leadId.slice(0, 8)}…)</li>)}
                  </ul>
                </div>
              ) : null}
              {importResult.errors?.length ? (
                <div>
                  <div className="text-xs font-semibold text-red-600">{t("crm.importFailedTitle")}</div>
                  <ul className="list-disc pl-5 text-xs text-red-600">
                    {importResult.errors.slice(0, 20).map((er, i) => <li key={i}>{t("crm.importRowWord")} {er.row}: {er.message}</li>)}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <CustomFieldsManager />
    </div>
  );
}
