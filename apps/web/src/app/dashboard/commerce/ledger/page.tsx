"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/provider";
import Link from "next/link";
import { apiFetch, API_URL, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor } from "@repo/contracts";
import { currentMonth, shiftMonth, formatMonthLabel } from "@/lib/finance-gb8";
import {
  ACCOUNTING_DISCLAIMER,
  STATEMENT_CSV_TEMPLATE,
  accountTypeLabel,
  directionLabel,
  matchStateLabel,
  sourceTypeLabel,
  type ChartAccount,
  type JournalEntryView,
  type PnlReport,
  type StatementImport,
  type StatementLine,
  type VatSummary,
} from "@/lib/accounting-nf10";

// NF10 (FB4) — Accounting: chart of accounts, the double-entry
// journal, monthly P&L + VAT (journal-only figures), PDF exports
// and bank/mobile-banking statement reconciliation. Every report
// surface carries the accounting-aid disclaimer verbatim.

const fmtM = (minor?: string | null): string => {
  if (minor == null) return "—";
  try { return formatMinor(BigInt(minor)); } catch { return minor; }
};

const inputCls = "w-full rounded-lg border px-3 py-2 text-sm";
const labelCls = "mb-1 block text-xs font-semibold text-slate-700";
const thCls = "py-2 pr-2 font-semibold";
const tdCls = "py-2 pr-2";

export default function LedgerPage() {
  const { dict, t, locale } = useLocale();
  const [month, setMonth] = useState(() => currentMonth());
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [entries, setEntries] = useState<JournalEntryView[]>([]);
  const [pnl, setPnl] = useState<PnlReport | null>(null);
  const [vat, setVat] = useState<VatSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [syncMsg, setSyncMsg] = useState("");

  // Statement import
  const [imports, setImports] = useState<StatementImport[]>([]);
  const [selectedImport, setSelectedImport] = useState<string>("");
  const [lines, setLines] = useState<StatementLine[]>([]);
  const [csvText, setCsvText] = useState("");
  const [accountLabel, setAccountLabel] = useState("");
  const [dateCol, setDateCol] = useState("Date");
  const [descCol, setDescCol] = useState("Description");
  const [amountCol, setAmountCol] = useState("Amount");
  const [dirCol, setDirCol] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState("");

  const loadReports = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) { setError(dict.commerce.noOrganizationSelected); return; }
    setBusy(true); setError("");
    try {
      const [acc, ent, p, v, imps] = await Promise.all([
        apiFetch<{ items: ChartAccount[] }>(`/organizations/${orgId}/accounting/accounts`),
        apiFetch<{ items: JournalEntryView[] }>(`/organizations/${orgId}/accounting/journal?pageSize=25`),
        apiFetch<PnlReport>(`/organizations/${orgId}/accounting/reports/pnl?month=${encodeURIComponent(month)}`),
        apiFetch<VatSummary>(`/organizations/${orgId}/accounting/reports/vat?month=${encodeURIComponent(month)}`),
        apiFetch<{ items: StatementImport[] }>(`/organizations/${orgId}/accounting/statements`),
      ]);
      setAccounts(acc.items ?? []); setEntries(ent.items ?? []);
      setPnl(p); setVat(v); setImports(imps.items ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.loadingFailed); }
    finally { setBusy(false); }
  }, [month]);
  useEffect(() => { void loadReports(); }, [loadReports]);

  const loadLines = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId || !selectedImport) { setLines([]); return; }
    try {
      const res = await apiFetch<{ items: StatementLine[] }>(`/organizations/${orgId}/accounting/statements/${selectedImport}/lines`);
      setLines(res.items ?? []);
    } catch { setLines([]); }
  }, [selectedImport]);
  useEffect(() => { void loadLines(); }, [loadLines]);

  async function runSync() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setSyncMsg(""); setBusy(true);
    try {
      const r = await apiFetch<{ ordersCreated: number; paymentsCreated: number; expensesCreated: number; courierCreated: number; cogsMissingOrders: number }>(
        `/organizations/${orgId}/accounting/sync`, { method: "POST", body: "{}" },
      );
      setSyncMsg(t("commerce.journalCreatedOrdersPaymentsCosts", { ordersCreated: r.ordersCreated, paymentsCreated: r.paymentsCreated, expensesCreated: r.expensesCreated, courierCreated: r.courierCreated, r: r.cogsMissingOrders ? t("commerce.ordersMissingCOGS", { cogsMissingOrders: r.cogsMissingOrders }) : "" }));
      await loadReports();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.syncFailed); }
    finally { setBusy(false); }
  }

  async function downloadPdf(kind: "pnl" | "vat") {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const res = await fetch(`${API_URL}/organizations/${orgId}/accounting/reports/${kind}/pdf?month=${encodeURIComponent(month)}`, {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      if (!res.ok) throw new Error(t("commerce.downloadFailedHTTP", { status: res.status }));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${kind}-${month}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.downloadFailed2); }
  }

  async function importStatement(e: React.FormEvent) {
    e.preventDefault();
    const orgId = getOrganizationId(); if (!orgId) return;
    setImportMsg(""); setImportBusy(true);
    try {
      const mapping: Record<string, string> = { dateColumn: dateCol, amountColumn: amountCol };
      if (descCol.trim()) mapping.descriptionColumn = descCol.trim();
      if (dirCol.trim()) mapping.directionColumn = dirCol.trim();
      const r = await apiFetch<{ counts: { rowCount: number; suggested: number; unmatched: number; rowErrors: number } }>(
        `/organizations/${orgId}/accounting/statements/import`,
        { method: "POST", body: JSON.stringify({ csvText, fileName: "statement.csv", accountLabel: accountLabel.trim() || null, mapping }) },
      );
      setImportMsg(t("commerce.linesImportedSuggestedMatchesUnmatched", { rowCount: r.counts.rowCount, suggested: r.counts.suggested, unmatched: r.counts.unmatched }));
      setCsvText("");
      await loadReports();
    } catch (err) { setImportMsg(t("commerce.error3", { p0: err instanceof Error ? err.message : dict.commerce.importFailed })); }
    finally { setImportBusy(false); }
  }

  async function resolveLine(line: StatementLine, action: "confirm" | "reject") {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      await apiFetch(`/organizations/${orgId}/accounting/statements/lines/${line.id}`, {
        method: "PATCH", body: JSON.stringify({ action }),
      });
      await loadLines();
    } catch (e) { setError(e instanceof Error ? e.message : dict.commerce.actionFailed); }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <div>
        <h1 className="page-title">{dict.commerce.ledgerJournalAccounting}</h1>
        <p className="text-sm text-slate-500">{dict.commerce.chartOfAccountsDoubleEntry}</p>
        <p className="mt-1 text-xs text-slate-400"><Link href="/dashboard/commerce/finance" className="font-semibold text-indigo-600 hover:underline">{dict.commerce.backToTheFinanceLedger}</Link></p>
      </div>

      <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">{ACCOUNTING_DISCLAIMER}</p>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      {/* Reports */}
      <div className="card space-y-4 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div><label className={labelCls}>{dict.commerce.month}</label><input className={inputCls} type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
          <button type="button" className="btn-secondary" onClick={() => setMonth((m) => shiftMonth(m, -1))}>{dict.commerce.previousMonth}</button>
          <button type="button" className="btn-secondary" onClick={() => setMonth((m) => shiftMonth(m, 1))}>{dict.commerce.nextMonth}</button>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void runSync()}>{busy ? dict.commerce.running : dict.commerce.createSyncJournal}</button>
        </div>
        {syncMsg ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{syncMsg}</p> : null}
        <p className="text-xs text-slate-500">{formatMonthLabel(month)} {dict.commerce.allAccountsOnlyFromThe}</p>

        {pnl ? (
          <div className="space-y-3">
            <h2 className="font-semibold">{dict.commerce.profitLoss}</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{dict.commerce.totalRevenue}</div><div className="text-lg font-bold">{fmtM(pnl.totals.totalIncomeMinor)}</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">COGS</div><div className="text-lg font-bold">{fmtM(pnl.totals.cogsMinor)}</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{dict.commerce.grossProfit}</div><div className="text-lg font-bold">{fmtM(pnl.totals.grossProfitMinor)}</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{dict.commerce.otherCosts}</div><div className="text-lg font-bold">{fmtM(pnl.totals.totalExpensesMinor)}</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{dict.commerce.netProfit}</div><div className="text-lg font-bold">{fmtM(pnl.totals.netProfitMinor)}</div></div>
            </div>
            {pnl.cogsNote ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{pnl.cogsNote}</p> : null}
            <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>{dict.commerce.code}</th><th className={thCls}>{dict.commerce.account}</th><th className={thCls}>{dict.commerce.type}</th><th className={thCls}>{dict.commerce.quantity}</th></tr></thead><tbody>
              {pnl.rows.filter((r) => r.amountMinor !== "0").map((r) => (
                <tr key={r.accountId} className="border-b last:border-0"><td className={tdCls}>{r.code}</td><td className={tdCls}>{r.name}</td><td className={tdCls}>{accountTypeLabel(r.type)}</td><td className={tdCls}>{fmtM(r.amountMinor)}</td></tr>
              ))}
            </tbody></table></div>
            <button type="button" className="btn-secondary" onClick={() => void downloadPdf("pnl")}>{dict.commerce.downloadPLPDF}</button>
          </div>
        ) : <p className="text-sm text-slate-400">{dict.common.loading}</p>}

        {vat ? (
          <div className="space-y-2 border-t pt-4">
            <h2 className="font-semibold">{dict.commerce.vATSummary}</h2>
            <p className="text-xs text-slate-500">{dict.commerce.accountUsed}{vat.accountsUsed.join(", ")} · {vat.rateNote}</p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{dict.commerce.vATCollectedThisMonth}</div><div className="text-lg font-bold">{fmtM(vat.collectedMinor)}</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{dict.commerce.vATPaidThisMonth}</div><div className="text-lg font-bold">{fmtM(vat.paidMinor)}</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{dict.commerce.monthSNet}</div><div className="text-lg font-bold">{fmtM(vat.monthNetMinor)}</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">{dict.commerce.totalOutstandingBalance}</div><div className="text-lg font-bold">{fmtM(vat.balanceMinor)}</div></div>
            </div>
            <button type="button" className="btn-secondary" onClick={() => void downloadPdf("vat")}>{dict.commerce.downloadVATPDF}</button>
          </div>
        ) : null}
        <p className="text-xs font-semibold text-amber-700">{ACCOUNTING_DISCLAIMER}</p>
      </div>

      {/* Accounts + journal */}
      <div className="card space-y-4 p-5">
        <h2 className="font-semibold">{dict.commerce.chartOfAccounts2}{accounts.length}{dict.commerce.text1ge21}</h2>
        <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>{dict.commerce.code}</th><th className={thCls}>{dict.commerce.name}</th><th className={thCls}>{dict.commerce.type}</th><th className={thCls}>{dict.commerce.balanceDebitCredit}</th><th className={thCls}>{dict.commerce.source}</th></tr></thead><tbody>
          {accounts.map((a) => (
            <tr key={a.id} className="border-b last:border-0"><td className={tdCls}>{a.code}</td><td className={tdCls}>{a.name}</td><td className={tdCls}>{accountTypeLabel(a.type)}</td><td className={tdCls}>{fmtM(a.balanceMinor)}</td><td className={tdCls}>{a.isSystem ? dict.commerce.system : dict.commerce.createdByYou}</td></tr>
          ))}
        </tbody></table></div>
        <p className="text-xs text-slate-500">{dict.commerce.systemAccountNamesCanBe}</p>

        <h2 className="border-t pt-4 font-semibold">{dict.commerce.recentJournalEntries}{entries.length}{dict.commerce.text1ge21}</h2>
        {entries.length === 0 ? <p className="text-sm text-slate-400">{dict.commerce.noJournalEntriesYetPress}</p> : (
          <div className="space-y-3">
            {entries.map((e) => (
              <div key={e.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap justify-between gap-2 text-sm">
                  <span className="font-semibold">{e.date} · {sourceTypeLabel(e.sourceType)}</span>
                  <span>{dict.commerce.total}{fmtM(e.totalDebitMinor)}</span>
                </div>
                {e.memo ? <p className="text-xs text-slate-500">{e.memo}</p> : null}
                <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                  {e.lines.map((l) => (
                    <li key={l.id} className="flex justify-between gap-3"><span>{l.accountCode} {l.accountName}</span><span>{l.debitMinor !== "0" ? t("commerce.debit2", { fmtM: fmtM(l.debitMinor) }) : t("commerce.credit2", { fmtM: fmtM(l.creditMinor) })}</span></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Statement reconciliation */}
      <div className="card space-y-4 p-5">
        <h2 className="font-semibold">{dict.commerce.matchBankMobileBankingStatements}</h2>
        <p className="text-sm text-slate-500">{dict.commerce.importAStatementCSVThe}<b>{dict.commerce.offer}</b> {dict.commerce.butNoMatchWillBe}</p>
        <form onSubmit={importStatement} className="space-y-3 rounded-lg bg-slate-50 p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div><label className={labelCls}>{dict.commerce.accountLabel}</label><input className={inputCls} value={accountLabel} onChange={(e) => setAccountLabel(e.target.value)} placeholder={dict.commerce.eGBKash017} /></div>
            <div><label className={labelCls}>{dict.commerce.dateColumn}</label><input className={inputCls} value={dateCol} onChange={(e) => setDateCol(e.target.value)} /></div>
            <div><label className={labelCls}>{dict.commerce.amountColumn}</label><input className={inputCls} value={amountCol} onChange={(e) => setAmountCol(e.target.value)} /></div>
            <div><label className={labelCls}>{dict.commerce.descriptionColumnOptional}</label><input className={inputCls} value={descCol} onChange={(e) => setDescCol(e.target.value)} /></div>
            <div><label className={labelCls}>{dict.commerce.directionColumnOptionalCreditDebit}</label><input className={inputCls} value={dirCol} onChange={(e) => setDirCol(e.target.value)} placeholder={dict.commerce.emptyInferredFromTheSign} /></div>
          </div>
          <div><label className={labelCls}>{dict.commerce.cSVContent}</label><textarea className={`${inputCls} min-h-[120px] font-mono text-xs`} value={csvText} onChange={(e) => setCsvText(e.target.value)} placeholder={STATEMENT_CSV_TEMPLATE} /></div>
          {importMsg ? <p className="rounded-lg bg-slate-100 p-3 text-sm">{importMsg}</p> : null}
          <button type="submit" className="btn-primary" disabled={importBusy || !csvText.trim()}>{importBusy ? dict.commerce.importing : dict.commerce.importStatement}</button>
        </form>

        <div className="flex flex-wrap items-end gap-3">
          <div><label className={labelCls}>{dict.commerce.selectImport}</label>
            <select className={inputCls} value={selectedImport} onChange={(e) => setSelectedImport(e.target.value)}>
              <option value="">{dict.commerce.select}</option>
              {imports.map((i) => <option key={i.id} value={i.id}>{i.accountLabel ?? i.fileName ?? i.id} · {i.rowCount}{dict.commerce.lines}</option>)}
            </select>
          </div>
        </div>
        {selectedImport && lines.length === 0 ? <p className="text-sm text-slate-400">{dict.commerce.noLinesInThisImport}</p> : null}
        {lines.length > 0 ? (
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>{dict.commerce.date}</th><th className={thCls}>{dict.commerce.description}</th><th className={thCls}>{dict.commerce.direction}</th><th className={thCls}>{dict.commerce.quantity}</th><th className={thCls}>{dict.commerce.matchStatus}</th><th className={thCls}>{dict.commerce.suggestedRecord}</th><th className={thCls}>{dict.commerce.action}</th></tr></thead><tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b last:border-0">
                <td className={tdCls}>{l.statementDate}</td><td className={tdCls}>{l.description ?? "—"}</td>
                <td className={tdCls}>{directionLabel(l.direction)}</td><td className={tdCls}>{fmtM(l.amountMinor)}</td>
                <td className={tdCls}>{matchStateLabel(l.matchState)}</td>
                <td className={tdCls}>{l.suggestedRefType ? `${l.suggestedRefType === "journal_entry" ? dict.commerce.journalEntry : dict.commerce.payment} · ${l.suggestedRefId?.slice(0, 8)}…` : "—"}</td>
                <td className={tdCls}>
                  {l.matchState === "suggested" || l.matchState === "unmatched" ? (
                    <span className="flex gap-2">
                      <button type="button" className="btn-secondary" disabled={!l.suggestedRefId && l.matchState === "unmatched"} onClick={() => void resolveLine(l, "confirm")}>{dict.commerce.confirm}</button>
                      <button type="button" className="btn-secondary text-red-600" onClick={() => void resolveLine(l, "reject")}>{dict.common.cancel}</button>
                    </span>
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody></table></div>
        ) : null}
        <p className="text-xs font-semibold text-amber-700">{ACCOUNTING_DISCLAIMER}</p>
      </div>
    </div>
  );
}
