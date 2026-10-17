"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { formatMinor } from "@repo/contracts";
import { takaToMinor } from "@/lib/finance-gb8";

// OU7 (One-Umbrella) — accounting-lite section of the finance hub:
// chart of accounts, derived journal + posting status, manual
// entries, trial balance / balance sheet, bank reconciliation.
// Every figure here comes from the OU7 API (journal lines derived
// from real source records); nothing is computed in the browser.

const fmtM = (minor?: string | null): string => {
  if (minor == null) return "—";
  try { return formatMinor(BigInt(minor)); } catch { return minor; }
};
const inputCls = "w-full rounded-lg border px-3 py-2 text-sm";
const labelCls = "mb-1 block text-xs font-semibold text-slate-700";
const thCls = "py-2 pr-2 font-semibold";
const tdCls = "py-2 pr-2";

interface Account { code: string; name: string; type: string; normalSide: string }
interface PostingItem { sourceType: string; sourceId: string; date: string; amountMinor: string; label: string; posted: boolean; reason: string | null }
interface JournalEntry { id: string; entryDate: string; sourceType: string; memo: string | null; isManual: boolean; lines: { accountCode: string; debitMinor: string; creditMinor: string }[] }
interface TbRow { accountCode: string; accountName: string; debitMinor: string; creditMinor: string }
interface BankLine { id: string; date: string; description: string; amountMinor: string; reference: string | null; status: string; matchedSourceType: string | null; matchedSourceId: string | null; suggestions: { sourceType: string; sourceId: string; date: string; amountMinor: string; label: string; daysApart: number }[] }

const SOURCE_LABEL: Record<string, string> = {
  sale: "বিক্রি", payment_gateway: "গেটওয়ে পেমেন্ট", payment_manual: "ম্যানুয়াল advance",
  courier_settlement: "কুরিয়ার সেটেলমেন্ট", gateway_fee: "গেটওয়ে ফি", refund: "রিফান্ড", expense: "খরচ", manual: "ম্যানুয়াল",
};

export default function AccountingLite({ from, to }: { from: string; to: string }) {
  const qs = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [status, setStatus] = useState<{ totals: { sources: number; posted: number; unposted: number }; items: PostingItem[] } | null>(null);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [tb, setTb] = useState<{ rows: TbRow[]; totalDebitMinor: string; totalCreditMinor: string; balanced: boolean; periodNote: string } | null>(null);
  const [bs, setBs] = useState<any>(null);
  const [bankLines, setBankLines] = useState<BankLine[]>([]);
  const [csv, setCsv] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Manual entry form
  const [mDate, setMDate] = useState(to);
  const [mMemo, setMMemo] = useState("");
  const [mLines, setMLines] = useState<{ accountCode: string; side: "debit" | "credit"; amount: string }[]>([
    { accountCode: "1000", side: "debit", amount: "" },
    { accountCode: "3000", side: "credit", amount: "" },
  ]);

  const load = useCallback(async () => {
    const orgId = getOrganizationId(); if (!orgId) { setError("কোনো Organization নির্বাচিত নেই।"); return; }
    setBusy(true); setError("");
    try {
      const [a, s, j, t, b, bl] = await Promise.all([
        apiFetch<{ accounts: Account[] }>(`/organizations/${orgId}/finance/accounting/accounts`),
        apiFetch<any>(`/organizations/${orgId}/finance/accounting/posting-status?${qs}`),
        apiFetch<{ items: JournalEntry[] }>(`/organizations/${orgId}/finance/accounting/journal?${qs}&pageSize=50`),
        apiFetch<any>(`/organizations/${orgId}/finance/accounting/trial-balance?${qs}`),
        apiFetch<any>(`/organizations/${orgId}/finance/accounting/balance-sheet?to=${encodeURIComponent(to)}`),
        apiFetch<{ items: BankLine[] }>(`/organizations/${orgId}/finance/accounting/bank-lines`),
      ]);
      setAccounts(a.accounts ?? []);
      setStatus(s); setJournal(j.items ?? []); setTb(t); setBs(b); setBankLines(bl.items ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "হিসাব লোড ব্যর্থ"); }
    finally { setBusy(false); }
  }, [qs, to]);
  useEffect(() => { void load(); }, [load]);

  const accountName = (code: string) => accounts.find((a) => a.code === code)?.name ?? code;

  async function runPost() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setBusy(true); setMsg(""); setError("");
    try {
      const r = await apiFetch<{ posted: number; alreadyPosted: number; unposted: unknown[] }>(`/organizations/${orgId}/finance/accounting/post?${qs}`, { method: "POST" });
      setMsg(`✅ পোস্ট হয়েছে ${r.posted}টি · আগেই পোস্ট ছিল ${r.alreadyPosted}টি · পোস্ট হয়নি ${r.unposted.length}টি (কারণ পোস্টিং অবস্থায়)`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "পোস্ট ব্যর্থ"); }
    finally { setBusy(false); }
  }

  async function submitManual() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError(""); setMsg("");
    const lines = mLines.map((l) => {
      const minor = takaToMinor(l.amount);
      return { accountCode: l.accountCode, debitMinor: l.side === "debit" ? (minor ?? "0") : "0", creditMinor: l.side === "credit" ? (minor ?? "0") : "0" };
    });
    try {
      await apiFetch(`/organizations/${orgId}/finance/accounting/journal/manual`, { method: "POST", body: JSON.stringify({ date: mDate, memo: mMemo || null, lines }) });
      setMsg("✅ ম্যানুয়াল এন্ট্রি যোগ হয়েছে (audit log-এ রেকর্ড হয়েছে)");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "ম্যানুয়াল এন্ট্রি ব্যর্থ"); }
  }

  async function importCsv() {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError(""); setMsg("");
    try {
      const r = await apiFetch<{ created: number; errors: unknown[]; note: string }>(`/organizations/${orgId}/finance/accounting/bank-statement/import`, { method: "POST", body: JSON.stringify({ csv }) });
      setMsg(`✅ ${r.created}টি সারি import হয়েছে — সব unmatched। ${r.note}`);
      setCsv("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "import ব্যর্থ"); }
  }

  async function confirmMatch(line: BankLine, s: BankLine["suggestions"][number]) {
    const orgId = getOrganizationId(); if (!orgId) return;
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/finance/accounting/bank-lines/${line.id}/confirm-match`, { method: "POST", body: JSON.stringify({ sourceType: s.sourceType, sourceId: s.sourceId }) });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "মিল নিশ্চিত করা যায়নি"); }
  }

  async function unmatch(line: BankLine) {
    const orgId = getOrganizationId(); if (!orgId) return;
    try { await apiFetch(`/organizations/${orgId}/finance/accounting/bank-lines/${line.id}/unmatch`, { method: "POST" }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "মিল বাতিল ব্যর্থ"); }
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-slate-500">
        জার্নালটি আসল রেকর্ড (বিক্রীত অর্ডার, যাচাইকৃত পেমেন্ট, কুরিয়ার সেটেলমেন্ট, রিফান্ড, খরচ) থেকে তৈরি derived হিসাব — দ্বিতীয় কোনো হাতে-রাখা খাতা নয়।
        হিসাবরক্ষকের জন্য সাধারণ GL এক্সপোর্ট আগের মতোই আছে (এটি Tally/QuickBooks-এর native ফাইল নয়)। পিরিয়ড <strong>খোলা (reporting-only)</strong> — কোনো পিরিয়ড-লক নেই।
      </p>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {msg ? <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{msg}</p> : null}
      {busy ? <p className="text-sm text-slate-400">লোড হচ্ছে…</p> : null}

      <section className="space-y-2">
        <h3 className="font-semibold">পোস্টিং অবস্থা — উৎস {status?.totals.sources ?? 0}টি · পোস্ট হয়েছে {status?.totals.posted ?? 0}টি · হয়নি {status?.totals.unposted ?? 0}টি</h3>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void runPost()}>জার্নালে পোস্ট করুন (এই সময়সীমা)</button>
        {status && status.items.filter((i) => !i.posted).length ? (
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>তারিখ</th><th className={thCls}>উৎস</th><th className={thCls}>বিবরণ</th><th className={thCls}>পরিমাণ</th><th className={thCls}>কেন পোস্ট হয়নি</th></tr></thead><tbody>
            {status.items.filter((i) => !i.posted).slice(0, 50).map((i) => (<tr key={`${i.sourceType}-${i.sourceId}`} className="border-b last:border-0"><td className={tdCls}>{i.date}</td><td className={tdCls}>{SOURCE_LABEL[i.sourceType] ?? i.sourceType}</td><td className={tdCls}>{i.label}</td><td className={tdCls}>{fmtM(i.amountMinor)}</td><td className={tdCls}>{i.reason}</td></tr>))}
          </tbody></table></div>
        ) : <p className="text-sm text-slate-400">সব উৎস পোস্ট হয়েছে।</p>}
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">জার্নাল ({journal.length}টি এন্ট্রি)</h3>
        {journal.length === 0 ? <p className="text-sm text-slate-400">এই সময়ে কোনো এন্ট্রি নেই — প্রথমে পোস্ট করুন।</p> : (
          <div className="space-y-2">{journal.map((e) => (
            <div key={e.id} className="rounded-xl border p-3">
              <div className="flex flex-wrap justify-between gap-2 text-sm"><span>{e.entryDate} · {SOURCE_LABEL[e.sourceType] ?? e.sourceType}{e.isManual ? " · ✍️ ম্যানুয়াল" : ""}</span><span className="text-slate-500">{e.memo}</span></div>
              <table className="mt-1 w-full text-sm"><tbody>
                {e.lines.map((l, i) => (<tr key={i}><td className={tdCls}>{accountName(l.accountCode)} ({l.accountCode})</td><td className={tdCls}>ডেবিট {l.debitMinor !== "0" ? fmtM(l.debitMinor) : "—"}</td><td className={tdCls}>ক্রেডিট {l.creditMinor !== "0" ? fmtM(l.creditMinor) : "—"}</td></tr>))}
              </tbody></table>
            </div>))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">✍️ ম্যানুয়াল জার্নাল এন্ট্রি (শুধু OWNER/ADMIN · audit-log হয়)</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div><label className={labelCls}>তারিখ</label><input className={inputCls} type="date" value={mDate} onChange={(e) => setMDate(e.target.value)} /></div>
          <div><label className={labelCls}>মেমো</label><input className={inputCls} value={mMemo} onChange={(e) => setMMemo(e.target.value)} placeholder="যেমন: শুরুর মূলধন" /></div>
        </div>
        {mLines.map((l, i) => (
          <div key={i} className="grid grid-cols-3 gap-2">
            <select className={inputCls} value={l.accountCode} onChange={(e) => setMLines((xs) => xs.map((x, j) => j === i ? { ...x, accountCode: e.target.value } : x))}>
              {accounts.map((a) => (<option key={a.code} value={a.code}>{a.code} · {a.name}</option>))}
            </select>
            <select className={inputCls} value={l.side} onChange={(e) => setMLines((xs) => xs.map((x, j) => j === i ? { ...x, side: e.target.value as "debit" | "credit" } : x))}>
              <option value="debit">ডেবিট</option><option value="credit">ক্রেডিট</option>
            </select>
            <input className={inputCls} inputMode="decimal" placeholder="টাকা" value={l.amount} onChange={(e) => setMLines((xs) => xs.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
          </div>
        ))}
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={() => setMLines((xs) => [...xs, { accountCode: "1000", side: "debit", amount: "" }])}>+ সারি</button>
          <button type="button" className="btn-primary" onClick={() => void submitManual()}>এন্ট্রি যোগ করুন</button>
        </div>
        <p className="text-xs text-slate-400">ডেবিট ও ক্রেডিট সমান না হলে সার্ভার এন্ট্রিটি নেবে না।</p>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-2">
          <h3 className="font-semibold">ট্রায়াল ব্যালান্স</h3>
          {tb ? (<>
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>অ্যাকাউন্ট</th><th className={thCls}>ডেবিট</th><th className={thCls}>ক্রেডিট</th></tr></thead><tbody>
              {tb.rows.map((r) => (<tr key={r.accountCode} className="border-b last:border-0"><td className={tdCls}>{r.accountName} ({r.accountCode})</td><td className={tdCls}>{fmtM(r.debitMinor)}</td><td className={tdCls}>{fmtM(r.creditMinor)}</td></tr>))}
              <tr className="bg-slate-50 font-semibold"><td className={tdCls}>মোট</td><td className={tdCls}>{fmtM(tb.totalDebitMinor)}</td><td className={tdCls}>{fmtM(tb.totalCreditMinor)}</td></tr>
            </tbody></table></div>
            <p className="text-xs text-slate-500">{tb.balanced ? "✅ ডেবিট = ক্রেডিট" : "⚠️ মিলছে না"} · {tb.periodNote}</p>
          </>) : <p className="text-sm text-slate-400">—</p>}
        </div>
        <div className="space-y-2">
          <h3 className="font-semibold">ব্যালান্স শিট ({bs?.asOf ?? ""})</h3>
          {bs ? (<div className="space-y-1 text-sm">
            <div className="flex justify-between"><span>সম্পদ (Assets)</span><strong>{fmtM(bs.assets.totalMinor)}</strong></div>
            <div className="flex justify-between"><span>দায় (Liabilities)</span><strong>{fmtM(bs.liabilities.totalMinor)}</strong></div>
            <div className="flex justify-between"><span>মূলধন + retained earnings</span><strong>{fmtM(bs.equity.totalMinor)}</strong></div>
            <div className="flex justify-between border-t pt-1"><span>মোট দায় + মূলধন</span><strong>{fmtM(bs.totalLiabilitiesAndEquityMinor)}</strong></div>
            <p className="text-xs text-slate-500">{bs.balanced ? "✅ ব্যালান্স মিলেছে" : "⚠️ মিলছে না"} · retained earnings: {fmtM(bs.equity.retainedEarningsMinor)} · {bs.periodNote}</p>
            <p className="text-xs text-slate-500">লাভ-ক্ষতির বিস্তারিত (P&L): বিদ্যমান profit রিপোর্টে (নির্ধারিত রিপোর্ট / রিপোর্ট পেজ)।</p>
          </div>) : <p className="text-sm text-slate-400">—</p>}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">খাতা তালিকা (Chart of Accounts)</h3>
        <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead><tr className="border-b text-left text-xs text-slate-500"><th className={thCls}>কোড</th><th className={thCls}>নাম</th><th className={thCls}>ধরন</th><th className={thCls}>স্বাভাবিক দিক</th></tr></thead><tbody>
          {accounts.map((a) => (<tr key={a.code} className="border-b last:border-0"><td className={tdCls}>{a.code}</td><td className={tdCls}>{a.name}</td><td className={tdCls}>{a.type}</td><td className={tdCls}>{a.normalSide === "debit" ? "ডেবিট" : "ক্রেডিট"}</td></tr>))}
        </tbody></table></div>
        <p className="text-xs text-slate-400">নামগুলো GL এক্সপোর্টের ম্যাপিং অনুযায়ী — দ্বিতীয় কোনো ম্যাপিং নেই।</p>
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold">🏦 ব্যাংক স্টেটমেন্ট মিলকরণ</h3>
        <p className="text-xs text-slate-500">CSV হেডার: date, description, amount, reference (amount টাকায়; টাকা এলে +, গেলে −)। মিল শুধু <strong>প্রস্তাব</strong> — প্রতিটি নিজে নিশ্চিত করতে হয়, স্বয়ংক্রিয় মিল হয় না।</p>
        <textarea className={inputCls} rows={4} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"date,description,amount,reference\n2026-10-05,bKash settlement,101.00,TRX1"} />
        <button type="button" className="btn-primary" disabled={!csv.trim()} onClick={() => void importCsv()}>স্টেটমেন্ট import করুন</button>
        {bankLines.length === 0 ? <p className="text-sm text-slate-400">কোনো স্টেটমেন্ট সারি নেই।</p> : (
          <div className="space-y-2">{bankLines.map((l) => (
            <div key={l.id} className="rounded-xl border p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2"><span>{l.date} · {l.description}</span><strong>{fmtM(l.amountMinor)}</strong></div>
              {l.status === "matched" ? (
                <p className="mt-1 text-emerald-700">✅ মেলানো হয়েছে: {l.matchedSourceType} · {l.matchedSourceId} <button type="button" className="ml-2 font-semibold text-indigo-600 hover:underline" onClick={() => void unmatch(l)}>মিল বাতিল</button></p>
              ) : (
                <div className="mt-1 space-y-1">
                  <span className="text-amber-700">⏳ unmatched</span>
                  {l.suggestions.length === 0 ? <span className="text-slate-400"> · কোনো প্রস্তাবিত মিল নেই</span> : l.suggestions.map((s) => (
                    <div key={`${s.sourceType}-${s.sourceId}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1">
                      <span>প্রস্তাব: {s.label} · {s.date} · {fmtM(s.amountMinor)} · {s.daysApart} দিন ব্যবধান</span>
                      <button type="button" className="font-semibold text-indigo-600 hover:underline" onClick={() => void confirmMatch(l, s)}>নিশ্চিত করুন</button>
                    </div>
                  ))}
                </div>
              )}
            </div>))}
          </div>
        )}
      </section>
    </div>
  );
}
