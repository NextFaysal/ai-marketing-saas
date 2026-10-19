"use client";
import React, { useCallback, useEffect, useState } from "react";
import { fmtDate, fmtDateTime, fmtMoneyMinor, fmtNumber } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { ResponsiveTable } from "@repo/ui";
import { getOrganizationId } from "@/lib/org";

// EC26 — Courier COD Reconciliation: কুরিয়ারের settlement শিট (CSV)
// import করে কোন shipment-এর COD আসলে সংগৃহীত হয়েছে তা মেলানো হয়।
// শিটই টাকার একমাত্র সত্য — Delivered status কখনো টাকা পাওয়ার প্রমাণ নয়।
//
// API shape notes (service-verified):
// - GET profile returns { courierIntegrationId, provider, mapping }
//   — mapping is TOP-LEVEL (no `profile` wrapper); null when unsaved.
// - POST import returns the import row + counts:
//   { ..., counts: { rowCount, matched, amount_mismatch, not_found,
//     duplicate, already_collected, row_error } }.

interface Integration {
  id: string;
  provider: string;
  status: string;
  externalAccountId?: string | null;
  label?: string | null;
}

interface ColumnMapping {
  trackingColumn: string;
  amountColumn: string;
  chargeColumn?: string;
  orderRefColumn?: string;
  statusColumn?: string;
}

interface ProfileResponse {
  courierIntegrationId: string;
  provider: string;
  mapping: ColumnMapping | null;
}

interface ImportCounts {
  rowCount: number;
  matched: number;
  amount_mismatch: number;
  not_found: number;
  duplicate: number;
  already_collected: number;
  row_error: number;
}

interface ImportRow {
  id: string;
  courierIntegrationId: string;
  fileName: string | null;
  rowCount: number;
  matchedCount: number;
  mismatchCount: number;
  notFoundCount: number;
  duplicateCount: number;
  status: string;
  createdAt: string;
  counts?: ImportCounts;
}

interface ReconLine {
  id: string;
  rowNumber: number;
  rawTrackingId: string | null;
  rawOrderRef: string | null;
  sheetAmountMinor: string | null;
  sheetChargeMinor: string | null;
  sheetStatus: string | null;
  matchedOrderId: string | null;
  matchedShipmentId: string | null;
  expectedMinor: string | null;
  outcome: string;
  note: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

const COURIER_PROVIDERS = ["steadfast", "pathao", "redx"];
const PROVIDER_LABEL: Record<string, string> = {
  steadfast: "Steadfast",
  pathao: "Pathao",
  redx: "RedX",
};

const OUTCOME_LABEL: Record<string, string> = {
  matched: "matched",
  amount_mismatch: "quantityMismatch",
  not_found: "notFound",
  duplicate: "duplicate",
  already_collected: "alreadyCollected",
  row_error: "rowError",
};
const OUTCOME_ORDER = ["matched", "amount_mismatch", "not_found", "duplicate", "already_collected", "row_error"];

function outcomeCls(outcome: string): string {
  switch (outcome) {
    case "matched": return "bg-green-100 text-green-700";
    case "amount_mismatch": return "bg-amber-100 text-amber-700";
    case "not_found": return "bg-red-100 text-red-700";
    case "duplicate": return "bg-slate-200 text-slate-600";
    case "already_collected": return "bg-blue-100 text-blue-700";
    case "row_error": return "bg-red-100 text-red-700";
    default: return "bg-slate-200 text-slate-600";
  }
}

/** minor string → "৳1,250.50"; null → "—". */
function taka(minor: string | null | undefined, locale: "bn" | "en" = "bn"): string {
  if (minor === null || minor === undefined || minor === "") return "—";
  return fmtMoneyMinor(locale, BigInt(minor));
}

const inputCls = "w-full rounded-lg border px-3 py-2 text-sm";
const labelCls = "mb-1 block text-xs font-semibold text-slate-700";

export default function ReconciliationPage() {
  const { dict, t, locale } = useLocale();
  const [couriers, setCouriers] = useState<Integration[]>([]);
  const [courierId, setCourierId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Import flow
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [headersBusy, setHeadersBusy] = useState(false);
  const [savedMapping, setSavedMapping] = useState<ColumnMapping | null>(null);
  const [profileNote, setProfileNote] = useState("");
  const [trackingColumn, setTrackingColumn] = useState("");
  const [amountColumn, setAmountColumn] = useState("");
  const [chargeColumn, setChargeColumn] = useState("");
  const [orderRefColumn, setOrderRefColumn] = useState("");
  const [statusColumn, setStatusColumn] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [showForce, setShowForce] = useState(false);
  const [force, setForce] = useState(false);
  const [lastResult, setLastResult] = useState<ImportRow | null>(null);
  const [profileMsg, setProfileMsg] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);

  // History + detail
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [selectedImport, setSelectedImport] = useState<ImportRow | null>(null);
  const [lines, setLines] = useState<ReconLine[]>([]);
  const [outcomeFilter, setOutcomeFilter] = useState("");
  const [linesBusy, setLinesBusy] = useState(false);
  const [lineNote, setLineNote] = useState("");
  const [busyLine, setBusyLine] = useState("");
  const [detailError, setDetailError] = useState("");

  const base = useCallback(() => {
    const orgId = getOrganizationId();
    return orgId ? `/organizations/${orgId}/commerce/reconciliation` : null;
  }, []);

  const loadImports = useCallback(async (courier: string) => {
    const b = base();
    if (!b) return;
    try {
      const q = courier ? `?courierIntegrationId=${encodeURIComponent(courier)}` : "";
      const res = await apiFetch<{ items: ImportRow[] }>(`${b}/imports${q}`);
      setImports(res.items ?? []);
    } catch {
      // History is secondary — a failure here must not block import.
      setImports([]);
    }
  }, [base]);

  // Saved-profile preselection: a saved value that is NOT among the
  // current sheet's headers stays unselected and is called out.
  const applySavedMapping = useCallback((mapping: ColumnMapping | null, hdrs: string[]) => {
    if (!mapping || hdrs.length === 0) { setProfileNote(""); return; }
    const pick = (v?: string) => (v && hdrs.includes(v) ? v : "");
    setTrackingColumn(pick(mapping.trackingColumn));
    setAmountColumn(pick(mapping.amountColumn));
    setChargeColumn(pick(mapping.chargeColumn));
    setOrderRefColumn(pick(mapping.orderRefColumn));
    setStatusColumn(pick(mapping.statusColumn));
    const missing = [
      mapping.trackingColumn, mapping.amountColumn, mapping.chargeColumn,
      mapping.orderRefColumn, mapping.statusColumn,
    ].filter((v): v is string => !!v && !hdrs.includes(v));
    setProfileNote(missing.length > 0
      ? t("commerce.theseColumnsOfTheSaved", { missing: missing.join(", ") })
      : dict.commerce.columnsHaveBeenPreSelected);
  }, []);

  const loadProfile = useCallback(async (courier: string, hdrs: string[]) => {
    const b = base();
    if (!b || !courier) { setSavedMapping(null); return; }
    try {
      const res = await apiFetch<ProfileResponse>(`${b}/profile?courierIntegrationId=${encodeURIComponent(courier)}`);
      setSavedMapping(res.mapping ?? null);
      applySavedMapping(res.mapping ?? null, hdrs);
    } catch {
      setSavedMapping(null);
    }
  }, [base, applySavedMapping]);

  useEffect(() => {
    (async () => {
      const orgId = getOrganizationId();
      if (!orgId) { setLoadError(dict.commerce.noOrganizationSelected); setLoading(false); return; }
      try {
        const all = await apiFetch<Integration[]>(`/organizations/${orgId}/integrations`);
        setCouriers((all ?? []).filter((i) => COURIER_PROVIDERS.includes(i.provider)));
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : dict.commerce.couldNotLoadCourierAccounts);
      } finally { setLoading(false); }
      void loadImports("");
    })();
  }, [loadImports]);

  async function onCourierChange(id: string) {
    setCourierId(id);
    setLastResult(null);
    setImportError("");
    setShowForce(false);
    setForce(false);
    setSelectedImport(null);
    setLines([]);
    void loadImports(id);
    void loadProfile(id, headers);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const b = base();
    if (!b) return;
    setImportError(""); setLastResult(null); setShowForce(false); setForce(false);
    setHeadersBusy(true);
    try {
      const text = await file.text();
      setCsvText(text);
      setFileName(file.name);
      const res = await apiFetch<{ headers: string[] }>(`${b}/headers`, {
        method: "POST",
        body: JSON.stringify({ csvText: text }),
      });
      const hdrs = res.headers ?? [];
      setHeaders(hdrs);
      // Preselect from the saved profile against THESE headers.
      if (courierId) void loadProfile(courierId, hdrs);
    } catch (err) {
      setHeaders([]);
      setImportError(err instanceof Error ? err.message : dict.commerce.couldNotReadTheFile);
    } finally { setHeadersBusy(false); }
  }

  function buildMapping(): ColumnMapping | undefined {
    if (!trackingColumn || !amountColumn) return undefined;
    const m: ColumnMapping = { trackingColumn, amountColumn };
    if (chargeColumn) m.chargeColumn = chargeColumn;
    if (orderRefColumn) m.orderRefColumn = orderRefColumn;
    if (statusColumn) m.statusColumn = statusColumn;
    return m;
  }

  async function saveProfileOnly() {
    const b = base();
    if (!b || !courierId) return;
    const mapping = buildMapping();
    if (!mapping) { setImportError(dict.commerce.bothTheTrackingAmountColumns); return; }
    setProfileBusy(true); setProfileMsg(""); setImportError("");
    try {
      const res = await apiFetch<ProfileResponse>(`${b}/profile`, {
        method: "PUT",
        body: JSON.stringify({ courierIntegrationId: courierId, mapping }),
      });
      setSavedMapping(res.mapping ?? mapping);
      setProfileMsg(dict.commerce.mappingSavedItWillBe);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : dict.commerce.mappingSaveFailed);
    } finally { setProfileBusy(false); }
  }

  async function doImport() {
    const b = base();
    if (!b || !courierId || !csvText) return;
    setImporting(true); setImportError("");
    try {
      const mapping = buildMapping();
      const res = await apiFetch<ImportRow>(`${b}/import`, {
        method: "POST",
        body: JSON.stringify({
          courierIntegrationId: courierId,
          csvText,
          fileName: fileName || undefined,
          mapping,
          force: force || undefined,
        }),
      });
      setLastResult(res);
      setShowForce(false);
      setForce(false);
      if (mapping) setSavedMapping(mapping);
      void loadImports(courierId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : dict.commerce.importFailed2;
      setImportError(msg);
      if (msg.includes(dict.commerce.alreadyImported)) setShowForce(true);
    } finally { setImporting(false); }
  }

  const loadLines = useCallback(async (importId: string, outcome: string) => {
    const b = base();
    if (!b) return;
    setLinesBusy(true); setDetailError("");
    try {
      const q = outcome ? `?outcome=${encodeURIComponent(outcome)}` : "";
      const res = await apiFetch<{ items: ReconLine[] }>(`${b}/imports/${importId}/lines${q}`);
      setLines(res.items ?? []);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : dict.commerce.couldNotLoadTheRows);
      setLines([]);
    } finally { setLinesBusy(false); }
  }, [base]);

  function openImport(row: ImportRow) {
    setSelectedImport(row);
    setOutcomeFilter("");
    setLineNote("");
    void loadLines(row.id, "");
  }

  function onOutcomeFilter(outcome: string) {
    setOutcomeFilter(outcome);
    if (selectedImport) void loadLines(selectedImport.id, outcome);
  }

  async function resolveLine(line: ReconLine, action: "accept_sheet" | "mark_reviewed") {
    const b = base();
    if (!b) return;
    setBusyLine(line.id); setDetailError("");
    try {
      await apiFetch<ReconLine>(`${b}/lines/${line.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action, note: lineNote.trim() || undefined }),
      });
      if (selectedImport) await loadLines(selectedImport.id, outcomeFilter);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : dict.commerce.actionFailed2);
    } finally { setBusyLine(""); }
  }

  const headerSelect = (
    label: string,
    value: string,
    set: (v: string) => void,
    required: boolean,
  ) => (
    <div>
      <label className={labelCls}>{label}{required ? " *" : dict.commerce.optional2}</label>
      <select className={inputCls} value={value} onChange={(e) => set(e.target.value)}>
        <option value="">{required ? dict.commerce.select : dict.commerce.none}</option>
        {headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    </div>
  );

  // EB6/ED13: line actions shared verbatim by the desktop table
  // cell and the ResponsiveTable mobile card — same handlers.
  const renderLineActions = (line: ReconLine) => (
    <div className="flex flex-col gap-1">
      {line.matchedShipmentId && line.sheetAmountMinor ? (
        <button
          type="button"
          className="inline-flex min-h-[44px] items-center text-left text-xs font-semibold text-blue-700 disabled:opacity-50"
          disabled={busyLine !== ""}
          onClick={() => void resolveLine(line, "accept_sheet")}
        >{dict.commerce.acceptTheSheetQuantity}</button>
      ) : null}
      {!line.reviewedAt ? (
        <button
          type="button"
          className="inline-flex min-h-[44px] items-center text-left text-xs font-semibold text-slate-700 disabled:opacity-50"
          disabled={busyLine !== ""}
          onClick={() => void resolveLine(line, "mark_reviewed")}
        >{dict.commerce.reviewed2}</button>
      ) : null}
    </div>
  );

  const counts = lastResult?.counts;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <div>
        <h1 className="page-title">{dict.commerce.courierCODReconciliation}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {dict.commerce.importTheCourierSSettlement}</p>
      </div>

      {loading ? <p className="text-sm text-slate-500">{dict.common.loading}</p> : null}
      {loadError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{loadError}</p> : null}

      <div className="card space-y-4 p-5">
        <h2 className="font-semibold">{dict.commerce.courierAccount}</h2>
        {!loading && couriers.length === 0 ? (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
            {dict.commerce.noCourierAccountConnectedFirst}{" "}
            <Link href="/dashboard/integrations" className="font-semibold underline">{dict.commerce.integrationsPage}</Link>{" "}
            {dict.commerce.connectSteadfastPathaoOrRedX}</p>
        ) : (
          <div className="max-w-md">
            <label className={labelCls}>{dict.commerce.selectACourier}</label>
            <select className={inputCls} value={courierId} onChange={(e) => void onCourierChange(e.target.value)}>
              <option value="">{dict.commerce.select}</option>
              {couriers.map((c) => (
                <option key={c.id} value={c.id}>
                  {(PROVIDER_LABEL[c.provider] ?? c.provider)}
                  {c.label ? ` — ${c.label}` : c.externalAccountId ? ` — ${c.externalAccountId}` : ""}
                  {` (${c.status})`}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="card space-y-4 p-5">
        <h2 className="font-semibold">{dict.commerce.importSheet}</h2>
        <div>
          <label className={labelCls}>{dict.commerce.settlementSheetCSVFile}</label>
          <input type="file" accept=".csv,text/csv" className={inputCls} onChange={(e) => void onFile(e)} />
          {fileName ? <p className="mt-1 text-xs text-slate-500">{dict.commerce.file2}{fileName}{headersBusy ? dict.commerce.readingTheHeader : headers.length ? t("commerce.columnsFound", { length: headers.length }) : ""}</p> : null}
        </div>

        {headers.length > 0 ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">{dict.commerce.columnMappingWhichSheetColumn}</p>
            {profileNote ? <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700">{profileNote}</p> : null}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {headerSelect(dict.commerce.trackingConsignmentColumn, trackingColumn, setTrackingColumn, true)}
              {headerSelect(dict.commerce.collectedAmountColumn, amountColumn, setAmountColumn, true)}
              {headerSelect(dict.commerce.courierChargeColumn, chargeColumn, setChargeColumn, false)}
              {headerSelect(dict.commerce.orderReferenceColumn, orderRefColumn, setOrderRefColumn, false)}
              {headerSelect(dict.commerce.statusColumn, statusColumn, setStatusColumn, false)}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" disabled={profileBusy || !courierId} onClick={() => void saveProfileOnly()}>
                {profileBusy ? dict.commerce.saving : dict.commerce.saveMapping}
              </button>
            </div>
            {profileMsg ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{profileMsg}</p> : null}
          </div>
        ) : null}

        {showForce ? (
          <label className="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            {dict.commerce.forceReImportRunThe}</label>
        ) : null}

        {importError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{importError}</p> : null}

        <button
          type="button" className="btn-primary"
          disabled={importing || !courierId || !csvText}
          onClick={() => void doImport()}
        >
          {importing ? dict.commerce.importing2 : dict.commerce.import2}
        </button>
        {!courierId ? <p className="text-xs text-slate-500">{dict.commerce.selectACourierFirstTo}</p> : null}

        {counts ? (
          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-semibold">{dict.commerce.lastImportSummary}{lastResult?.fileName ? ` — ${lastResult.fileName}` : ""}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {[
                [dict.commerce.totalRows, counts.rowCount],
                [dict.commerce.matched, counts.matched],
                [dict.commerce.mismatch, counts.amount_mismatch],
                [dict.commerce.notFound, counts.not_found],
                [dict.commerce.duplicate, counts.duplicate],
                [dict.commerce.alreadyCollected, counts.already_collected],
                [dict.commerce.errors, counts.row_error],
              ].map(([label, v]) => (
                <div key={label as string} className="rounded-lg bg-slate-50 p-3 text-center">
                  <div className="text-xl font-bold">{v as number}</div>
                  <div className="text-[11px] text-slate-500">{label as string}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="card space-y-3 p-5">
        <h2 className="font-semibold">{dict.commerce.importHistory}</h2>
        {imports.length === 0 ? (
          <p className="text-sm text-slate-500">{dict.commerce.noSheetsImportedYet}</p>
        ) : (
          <ResponsiveTable table={<div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-slate-500">
                  <th className="py-2 pr-3">{dict.commerce.date}</th>
                  <th className="py-2 pr-3">{dict.commerce.file}</th>
                  <th className="py-2 pr-3">{dict.commerce.row}</th>
                  <th className="py-2 pr-3">{dict.commerce.matched}</th>
                  <th className="py-2 pr-3">{dict.commerce.mismatch}</th>
                  <th className="py-2 pr-3">{dict.commerce.notFound}</th>
                  <th className="py-2">{dict.commerce.duplicate}</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((row) => (
                  <tr
                    key={row.id}
                    className={`cursor-pointer border-b last:border-0 hover:bg-slate-50 ${selectedImport?.id === row.id ? "bg-blue-50" : ""}`}
                    onClick={() => openImport(row)}
                  >
                    <td className="py-2 pr-3">{fmtDateTime(locale, new Date(row.createdAt))}</td>
                    <td className="py-2 pr-3 font-medium">{row.fileName ?? "—"}</td>
                    <td className="py-2 pr-3">{row.rowCount}</td>
                    <td className="py-2 pr-3">{row.matchedCount}</td>
                    <td className="py-2 pr-3">{row.mismatchCount}</td>
                    <td className="py-2 pr-3">{row.notFoundCount}</td>
                    <td className="py-2">{row.duplicateCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>} cards={imports.map((row) => (
  <div
    key={row.id}
    className={`cursor-pointer rounded-xl border bg-white p-3 shadow-sm ${selectedImport?.id === row.id ? "bg-blue-50" : ""}`}
    onClick={() => openImport(row)}
  >
    <dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.date}</dt><dd className="text-right">{fmtDateTime(locale, new Date(row.createdAt))}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.file}</dt><dd className="text-right">{row.fileName ?? "—"}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.row}</dt><dd className="text-right">{row.rowCount}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.matched}</dt><dd className="text-right">{row.matchedCount}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.mismatch}</dt><dd className="text-right">{row.mismatchCount}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.notFound}</dt><dd className="text-right">{row.notFoundCount}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.duplicate}</dt><dd className="text-right">{row.duplicateCount}</dd></div></dl>
  </div>
))} />
        )}
        <p className="text-xs text-slate-500">{dict.commerce.clickingAnyRowWillShow}</p>
      </div>

      {selectedImport ? (
        <div className="card space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{dict.commerce.details2}{selectedImport.fileName ?? dict.commerce.sheet} ({fmtDate(locale, new Date(selectedImport.createdAt))})</h2>
            <button type="button" className="btn-ghost btn-sm" onClick={() => { setSelectedImport(null); setLines([]); }}>{dict.commerce.close}</button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onOutcomeFilter("")}
              className={`inline-flex min-h-[44px] items-center rounded-lg px-3 py-1.5 text-sm font-semibold ${outcomeFilter === "" ? "bg-slate-900 text-white" : "border bg-white"}`}
            >{dict.commerce.all}</button>
            {OUTCOME_ORDER.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => onOutcomeFilter(o)}
                className={`inline-flex min-h-[44px] items-center rounded-lg px-3 py-1.5 text-sm font-semibold ${outcomeFilter === o ? "bg-slate-900 text-white" : "border bg-white"}`}
              >{dict.commerce[OUTCOME_LABEL[o] as keyof typeof dict.commerce]}</button>
            ))}
          </div>

          <div>
            <label className={labelCls}>{dict.commerce.actionNoteOptionalThisNote}</label>
            <input className={inputCls} value={lineNote} onChange={(e) => setLineNote(e.target.value)} placeholder={dict.commerce.eGCheckedMatchedAfter} />
          </div>

          {detailError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{detailError}</p> : null}
          {linesBusy ? <p className="text-sm text-slate-500">{dict.common.loading}</p> : null}

          {!linesBusy && lines.length === 0 ? (
            <p className="text-sm text-slate-500">{dict.commerce.noRowsInThisFilter}</p>
          ) : (
            <ResponsiveTable table={<div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-slate-500">
                    <th className="py-2 pr-3">{dict.commerce.row}</th>
                    <th className="py-2 pr-3">Tracking</th>
                    <th className="py-2 pr-3">Order Ref</th>
                    <th className="py-2 pr-3">{dict.commerce.sheetQuantity}</th>
                    <th className="py-2 pr-3">{dict.commerce.expected}</th>
                    <th className="py-2 pr-3">{dict.commerce.charge}</th>
                    <th className="py-2 pr-3">{dict.commerce.sheetStatus}</th>
                    <th className="py-2 pr-3">{dict.commerce.result}</th>
                    <th className="py-2 pr-3">{dict.commerce.note}</th>
                    <th className="py-2">{dict.commerce.action}</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id} className="border-b align-top last:border-0">
                      <td className="py-2 pr-3">{line.rowNumber}</td>
                      <td className="py-2 pr-3 font-medium">{line.rawTrackingId ?? "—"}</td>
                      <td className="py-2 pr-3">{line.rawOrderRef ?? "—"}</td>
                      <td className="py-2 pr-3">{taka(line.sheetAmountMinor, locale)}</td>
                      <td className="py-2 pr-3">{taka(line.expectedMinor, locale)}</td>
                      <td className="py-2 pr-3">{taka(line.sheetChargeMinor, locale)}</td>
                      <td className="py-2 pr-3">{line.sheetStatus ?? "—"}</td>
                      <td className="py-2 pr-3">
                        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${outcomeCls(line.outcome)}`}>
                          {OUTCOME_LABEL[line.outcome] ? dict.commerce[OUTCOME_LABEL[line.outcome] as keyof typeof dict.commerce] : line.outcome}
                        </span>
                        {line.reviewedAt ? <span className="ml-1 text-green-600" title={t("commerce.reviewed", { p0: fmtDateTime(locale, new Date(line.reviewedAt)) })}>✓</span> : null}
                      </td>
                      <td className="py-2 pr-3 text-xs text-slate-500">{line.note ?? "—"}</td>
                      <td className="py-2">{renderLineActions(line)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>} cards={lines.map((line) => (<div key={line.id} className="rounded-xl border bg-white p-3 shadow-sm"><dl className="space-y-1 text-sm"><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.row}</dt><dd className="text-right">{line.rowNumber}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">Tracking</dt><dd className="text-right">{line.rawTrackingId ?? "—"}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">Order Ref</dt><dd className="text-right">{line.rawOrderRef ?? "—"}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.sheetQuantity}</dt><dd className="text-right">{taka(line.sheetAmountMinor, locale)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.expected}</dt><dd className="text-right">{taka(line.expectedMinor, locale)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.charge}</dt><dd className="text-right">{taka(line.sheetChargeMinor, locale)}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.sheetStatus}</dt><dd className="text-right">{line.sheetStatus ?? "—"}</dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.result}</dt><dd className="text-right"><><span className={`rounded px-2 py-0.5 text-xs font-semibold ${outcomeCls(line.outcome)}`}>{OUTCOME_LABEL[line.outcome] ? dict.commerce[OUTCOME_LABEL[line.outcome] as keyof typeof dict.commerce] : line.outcome}</span>{line.reviewedAt ? <span className="ml-1 text-green-600" title={t("commerce.reviewed", { p0: fmtDateTime(locale, new Date(line.reviewedAt)) })}>✓</span> : null}</></dd></div><div className="flex justify-between gap-3"><dt className="text-xs font-semibold text-slate-500">{dict.commerce.note}</dt><dd className="text-right">{line.note ?? "—"}</dd></div></dl><div className="mt-2">{renderLineActions(line)}</div></div>))} />
          )}
        </div>
      ) : null}
    </div>
  );
}
