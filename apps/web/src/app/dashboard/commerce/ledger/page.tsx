"use client";
import React, { useCallback, useEffect, useState } from "react";
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
    const orgId = getOrganizationId(); if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); return; }
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
    } catch (e) { setError(e instanceof Error ? e.message : "লোড ব্যর্থ"); }
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
      setSyncMsg(`✅ জার্নাল তৈরি হয়েছে — অর্ডার ${r.ordersCreated}টি, পেমেন্ট ${r.paymentsCreated}টি, খরচ ${r.expensesCreated}টি, কুরিয়ার ${r.courierCreated}টি${r.cogsMissingOrders ? ` · COGS অনুপস্থিত অর্ডার ${r.cogsMissingOrders}টি` : ""}`);
      await loadReports();
    } catch (e) { setError(e instanceof Error ? e.message : "সিঙ্ক ব্যর্থ"); }
    finally { setBusy(false); }
  }

  async function downloadPdf(kind: "pnl" | "vat") {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      const res = await fetch(`${API_URL}/organizations/${orgId}/accounting/reports/${kind}/pdf?month=${encodeURIComponent(month)}`, {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
      });
      if (!res.ok) throw new Error(`ডাউনলোড ব্যর্থ (HTTP ${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${kind}-${month}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { setError(e instanceof Error ? e.message : "ডাউনলোড ব্যর্থ"); }
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
      setImportMsg(`✅ ${r.counts.rowCount}টি লাইন import হয়েছে — প্রস্তাবিত মিল ${r.counts.suggested}টি, অমিল ${r.counts.unmatched}টি। কোনো মিলই স্বয়ংক্রিয়ভাবে নিশ্চিত হয়নি — নিচে নিজে যাচাই করে নিশ্চিত করুন।`);
      setCsvText("");
      await loadReports();
    } catch (err) { setImportMsg(`ত্রুটি: ${err instanceof Error ? err.message : "import ব্যর্থ"}`); }
    finally { setImportBusy(false); }
  }

  async function resolveLine(line: StatementLine, action: "confirm" | "reject") {
    const orgId = getOrganizationId(); if (!orgId) return;
    try {
      await apiFetch(`/organizations/${orgId}/accounting/statements/lines/${line.id}`, {
        method: "PATCH", body: JSON.stringify({ action }),
      });
      await loadLines();
    } catch (e) { setError(e instanceof Error ? e.message : "অ্যাকশন ব্যর্থ"); }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <div>
        <h1 className="page-title">📒 হিসাব ও জার্নাল (Accounting)</h1>
        <p className="text-sm text-slate-500">চার্ট অব অ্যাকাউন্টস, ডাবল-এন্ট্রি জার্নাল, মাসিক লাভ-ক্ষতি ও VAT সারাংশ, ব্যাংক/মোবাইল-ব্যাংকিং স্টেটমেন্ট মেলানো।</p>
        <p className="mt-1 text-xs text-slate-400"><Link href="/dashboard/commerce/finance" className="font-semibold text-indigo-600 hover:underline">💰 ফাইন্যান্স ও লেজার পেজে ফিরুন</Link></p>
      </div>

      <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">{ACCOUNTING_DISCLAIMER}</p>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

      {/* Reports */}
      <div className="card space-y-4 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div><label className={labelCls}>মাস</label><input className={inputCls} type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
          <button type="button" className="btn-secondary" onClick={() => setMonth((m) => shiftMonth(m, -1))}>← আগের মাস</button>
          <button type="button" className="btn-secondary" onClick={() => setMonth((m) => shiftMonth(m, 1))}>পরের মাস →</button>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void runSync()}>{busy ? "চলছে…" : "🔄 জার্নাল তৈরি/সিঙ্ক করুন"}</button>
        </div>
        {syncMsg ? <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{syncMsg}</p> : null}
        <p className="text-xs text-slate-500">{formatMonthLabel(month)} — সব হিসাব শুধু জার্নাল থেকে; রিপোর্ট খুললেই অটো-এন্ট্রি সিঙ্ক হয়ে যায় (একই রেকর্ডে দ্বিতীয়বার এন্ট্রি হয় না)।</p>

        {pnl ? (
          <div className="space-y-3">
            <h2 className="font-semibold">লাভ-ক্ষতি (Profit &amp; Loss)</h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">মোট আয়</div><div className="text-lg font-bold">{fmtM(pnl.totals.totalIncomeMinor)}</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">COGS</div><div className="text-lg font-bold">{fmtM(pnl.totals.cogsMinor)}</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">মোট মুনাফা (Gross)</div><div className="text-lg font-bold">{fmtM(pnl.totals.grossProfitMinor)}</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">অন্যান্য খরচ</div><div className="text-lg font-bold">{fmtM(pnl.totals.totalExpensesMinor)}</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">নিট লাভ</div><div className="text-lg font-bold">{fmtM(pnl.totals.netProfitMinor)}</div></div>
            </div>
            {pnl.cogsNote ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{pnl.cogsNote}</p> : null}
            <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>কোড</th><th className={thCls}>অ্যাকাউন্ট</th><th className={thCls}>ধরন</th><th className={thCls}>পরিমাণ</th></tr></thead><tbody>
              {pnl.rows.filter((r) => r.amountMinor !== "0").map((r) => (
                <tr key={r.accountId} className="border-b last:border-0"><td className={tdCls}>{r.code}</td><td className={tdCls}>{r.name}</td><td className={tdCls}>{accountTypeLabel(r.type)}</td><td className={tdCls}>{fmtM(r.amountMinor)}</td></tr>
              ))}
            </tbody></table></div>
            <button type="button" className="btn-secondary" onClick={() => void downloadPdf("pnl")}>📄 P&L PDF ডাউনলোড</button>
          </div>
        ) : <p className="text-sm text-slate-400">লোড হচ্ছে…</p>}

        {vat ? (
          <div className="space-y-2 border-t pt-4">
            <h2 className="font-semibold">VAT সারাংশ</h2>
            <p className="text-xs text-slate-500">ব্যবহৃত খাত: {vat.accountsUsed.join(", ")} · {vat.rateNote}</p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">সংগৃহীত VAT (এই মাস)</div><div className="text-lg font-bold">{fmtM(vat.collectedMinor)}</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">পরিশোধিত VAT (এই মাস)</div><div className="text-lg font-bold">{fmtM(vat.paidMinor)}</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">মাসের নিট</div><div className="text-lg font-bold">{fmtM(vat.monthNetMinor)}</div></div>
              <div className="rounded-xl bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">মোট বকেয়া ব্যালান্স</div><div className="text-lg font-bold">{fmtM(vat.balanceMinor)}</div></div>
            </div>
            <button type="button" className="btn-secondary" onClick={() => void downloadPdf("vat")}>📄 VAT PDF ডাউনলোড</button>
          </div>
        ) : null}
        <p className="text-xs font-semibold text-amber-700">{ACCOUNTING_DISCLAIMER}</p>
      </div>

      {/* Accounts + journal */}
      <div className="card space-y-4 p-5">
        <h2 className="font-semibold">চার্ট অব অ্যাকাউন্টস ({accounts.length}টি)</h2>
        <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>কোড</th><th className={thCls}>নাম</th><th className={thCls}>ধরন</th><th className={thCls}>ব্যালান্স (ডেবিট − ক্রেডিট)</th><th className={thCls}>উৎস</th></tr></thead><tbody>
          {accounts.map((a) => (
            <tr key={a.id} className="border-b last:border-0"><td className={tdCls}>{a.code}</td><td className={tdCls}>{a.name}</td><td className={tdCls}>{accountTypeLabel(a.type)}</td><td className={tdCls}>{fmtM(a.balanceMinor)}</td><td className={tdCls}>{a.isSystem ? "সিস্টেম" : "নিজের তৈরি"}</td></tr>
          ))}
        </tbody></table></div>
        <p className="text-xs text-slate-500">সিস্টেম অ্যাকাউন্টের নাম বদলানো যায়, কিন্তু মোছা বা ধরন বদলানো যায় না (API দিয়ে) — অটো-এন্ট্রি এগুলোর উপর নির্ভর করে।</p>

        <h2 className="border-t pt-4 font-semibold">সাম্প্রতিক জার্নাল এন্ট্রি ({entries.length}টি)</h2>
        {entries.length === 0 ? <p className="text-sm text-slate-400">এখনো কোনো জার্নাল এন্ট্রি নেই — উপরে সিঙ্ক বোতাম চাপুন।</p> : (
          <div className="space-y-3">
            {entries.map((e) => (
              <div key={e.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap justify-between gap-2 text-sm">
                  <span className="font-semibold">{e.date} · {sourceTypeLabel(e.sourceType)}</span>
                  <span>মোট {fmtM(e.totalDebitMinor)}</span>
                </div>
                {e.memo ? <p className="text-xs text-slate-500">{e.memo}</p> : null}
                <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                  {e.lines.map((l) => (
                    <li key={l.id} className="flex justify-between gap-3"><span>{l.accountCode} {l.accountName}</span><span>{l.debitMinor !== "0" ? `ডেবিট ${fmtM(l.debitMinor)}` : `ক্রেডিট ${fmtM(l.creditMinor)}`}</span></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Statement reconciliation */}
      <div className="card space-y-4 p-5">
        <h2 className="font-semibold">ব্যাংক / মোবাইল-ব্যাংকিং স্টেটমেন্ট মেলানো</h2>
        <p className="text-sm text-slate-500">স্টেটমেন্ট CSV import করুন — সিস্টেম পরিমাণ + তারিখ মিলিয়ে মিলের <b>প্রস্তাব</b> দেবে, কিন্তু কোনো মিলই স্বয়ংক্রিয়ভাবে নিশ্চিত হবে না; প্রতিটি লাইন নিজে যাচাই করে নিশ্চিত/বাতিল করুন।</p>
        <form onSubmit={importStatement} className="space-y-3 rounded-lg bg-slate-50 p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div><label className={labelCls}>অ্যাকাউন্টের লেবেল</label><input className={inputCls} value={accountLabel} onChange={(e) => setAccountLabel(e.target.value)} placeholder="যেমন: bKash 017…" /></div>
            <div><label className={labelCls}>তারিখ কলাম</label><input className={inputCls} value={dateCol} onChange={(e) => setDateCol(e.target.value)} /></div>
            <div><label className={labelCls}>পরিমাণ কলাম</label><input className={inputCls} value={amountCol} onChange={(e) => setAmountCol(e.target.value)} /></div>
            <div><label className={labelCls}>বিবরণ কলাম (ঐচ্ছিক)</label><input className={inputCls} value={descCol} onChange={(e) => setDescCol(e.target.value)} /></div>
            <div><label className={labelCls}>দিক কলাম (ঐচ্ছিক — credit/debit)</label><input className={inputCls} value={dirCol} onChange={(e) => setDirCol(e.target.value)} placeholder="খালি = চিহ্ন দিয়ে বোঝা হবে" /></div>
          </div>
          <div><label className={labelCls}>CSV কনটেন্ট</label><textarea className={`${inputCls} min-h-[120px] font-mono text-xs`} value={csvText} onChange={(e) => setCsvText(e.target.value)} placeholder={STATEMENT_CSV_TEMPLATE} /></div>
          {importMsg ? <p className="rounded-lg bg-slate-100 p-3 text-sm">{importMsg}</p> : null}
          <button type="submit" className="btn-primary" disabled={importBusy || !csvText.trim()}>{importBusy ? "import হচ্ছে…" : "স্টেটমেন্ট import করুন"}</button>
        </form>

        <div className="flex flex-wrap items-end gap-3">
          <div><label className={labelCls}>Import বেছে নিন</label>
            <select className={inputCls} value={selectedImport} onChange={(e) => setSelectedImport(e.target.value)}>
              <option value="">— বেছে নিন —</option>
              {imports.map((i) => <option key={i.id} value={i.id}>{i.accountLabel ?? i.fileName ?? i.id} · {i.rowCount}টি লাইন</option>)}
            </select>
          </div>
        </div>
        {selectedImport && lines.length === 0 ? <p className="text-sm text-slate-400">এই import-এ কোনো লাইন নেই।</p> : null}
        {lines.length > 0 ? (
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>তারিখ</th><th className={thCls}>বিবরণ</th><th className={thCls}>দিক</th><th className={thCls}>পরিমাণ</th><th className={thCls}>মিলের অবস্থা</th><th className={thCls}>প্রস্তাবিত রেকর্ড</th><th className={thCls}>অ্যাকশন</th></tr></thead><tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b last:border-0">
                <td className={tdCls}>{l.statementDate}</td><td className={tdCls}>{l.description ?? "—"}</td>
                <td className={tdCls}>{directionLabel(l.direction)}</td><td className={tdCls}>{fmtM(l.amountMinor)}</td>
                <td className={tdCls}>{matchStateLabel(l.matchState)}</td>
                <td className={tdCls}>{l.suggestedRefType ? `${l.suggestedRefType === "journal_entry" ? "জার্নাল এন্ট্রি" : "পেমেন্ট"} · ${l.suggestedRefId?.slice(0, 8)}…` : "—"}</td>
                <td className={tdCls}>
                  {l.matchState === "suggested" || l.matchState === "unmatched" ? (
                    <span className="flex gap-2">
                      <button type="button" className="btn-secondary" disabled={!l.suggestedRefId && l.matchState === "unmatched"} onClick={() => void resolveLine(l, "confirm")}>নিশ্চিত করুন</button>
                      <button type="button" className="btn-secondary text-red-600" onClick={() => void resolveLine(l, "reject")}>বাতিল</button>
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
