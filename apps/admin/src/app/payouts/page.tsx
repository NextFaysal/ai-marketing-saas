"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { apiFetch, formatMinorStr } from "@/lib/api";

/**
 * CC10 — Tenant Wallet payouts (platform payment).
 *
 * The admin side of the wallet: tenants request payouts from
 * their Connect Center; money leaves ONLY here, in two steps —
 * approve (available balance is re-validated server-side at
 * decision time) then mark-paid with the REAL payout reference
 * (the debit happens exactly once, inside the mark-paid
 * transaction). Reject needs a note the tenant will see. The
 * adjustment form is the manual correction path: a note is
 * mandatory and the acting admin is recorded on the ledger row.
 */

interface PayoutRow {
  id: string; organizationId: string; organizationName?: string | null;
  amountMinor: string; method: string; destination: Record<string, unknown> | null;
  status: string; adminNote: string | null; payoutRef: string | null;
  requestedById: string; decidedById: string | null; createdAt: string; updatedAt: string;
}

const STATUSES = ["", "pending", "approved", "paid", "rejected", "cancelled"];
const STATUS_LABEL: Record<string, string> = {
  pending: "অপেক্ষমাণ", approved: "অনুমোদিত", paid: "পাঠানো হয়েছে", rejected: "প্রত্যাখ্যাত", cancelled: "Tenant বাতিল করেছে",
};

function destText(d: Record<string, unknown> | null): string {
  if (!d) return "—";
  if (d.number) return `bKash: ${String(d.number)}`;
  return [d.bankName, d.accountNumber, d.branch].filter(Boolean).map(String).join(" · ") || "—";
}

export default function PayoutsPage() {
  const [rows, setRows] = React.useState<PayoutRow[]>([]);
  const [status, setStatus] = React.useState("");
  const [msg, setMsg] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [adj, setAdj] = React.useState({ organizationId: "", amountTaka: "", note: "" });

  const load = React.useCallback(async () => {
    const out = await apiFetch<{ requests: PayoutRow[] }>(`/admin/payout-requests${status ? `?status=${status}` : ""}`).catch(() => ({ requests: [] }));
    setRows(out.requests ?? []);
  }, [status]);
  React.useEffect(() => { load(); }, [load]);

  async function act(id: string, kind: "approve" | "reject" | "mark-paid") {
    let body: Record<string, unknown> = {};
    if (kind === "reject") {
      const note = window.prompt("Reject-এর কারণ (Tenant দেখতে পাবে) — আবশ্যক:");
      if (!note || !note.trim()) return;
      body = { note: note.trim() };
    }
    if (kind === "approve") {
      const note = window.prompt("অনুমোদনের নোট (ঐচ্ছিক):", "");
      if (note === null) return;
      body = note.trim() ? { note: note.trim() } : {};
    }
    if (kind === "mark-paid") {
      const ref = window.prompt("আসল Payout-এর Reference (bKash TrxID / Bank Ref) — এটি ছাড়া paid করা যাবে না:");
      if (!ref || !ref.trim()) return;
      body = { payoutRef: ref.trim() };
    }
    setBusy(id + kind);
    try {
      await apiFetch(`/admin/payout-requests/${id}/${kind}`, { method: "POST", body: JSON.stringify(body) });
      setMsg(kind === "mark-paid" ? "✅ Payout paid হিসেবে রেকর্ড হয়েছে — Wallet থেকে একবারই debit হয়েছে।" : kind === "approve" ? "অনুমোদিত হয়েছে।" : "প্রত্যাখ্যাত হয়েছে — hold মুক্ত হয়েছে।");
      await load();
    } catch (e) { setMsg(`❌ ${e instanceof Error ? e.message : "ব্যর্থ হয়েছে"}`); }
    finally { setBusy(""); }
  }

  async function adjust(e: React.FormEvent) {
    e.preventDefault();
    const taka = Number(adj.amountTaka);
    if (!adj.organizationId.trim() || !Number.isFinite(taka) || taka === 0 || !adj.note.trim()) {
      setMsg("❌ Organization ID, শূন্য-ছাড়া পরিমাণ (টাকা, ঋণাত্মক হলে -) এবং Note — তিনটিই আবশ্যক।");
      return;
    }
    setBusy("adjust");
    try {
      const out = await apiFetch<any>(`/admin/wallets/${adj.organizationId.trim()}/adjust`, {
        method: "POST",
        body: JSON.stringify({ amountMinor: String(Math.round(taka * 100)), note: adj.note.trim() }),
      });
      setMsg(`✅ Adjustment রেকর্ড হয়েছে — নতুন ব্যালেন্স ৳ ${formatMinorStr(out.balanceAfterMinor)}।`);
      setAdj({ organizationId: "", amountTaka: "", note: "" });
    } catch (err) { setMsg(`❌ ${err instanceof Error ? err.message : "Adjustment ব্যর্থ"}`); }
    finally { setBusy(""); }
  }

  return (
    <AdminShell title="🏦 Wallet Payouts">
      {msg ? <p className="mb-3 rounded-lg bg-indigo-500/10 p-3 text-sm text-indigo-200">{msg}</p> : null}
      <div className="acard space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">Tenant Payout অনুরোধসমূহ</span>
          <select className="ainput !w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s === "" ? "সব status" : STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <p className="text-xs text-slate-400">
          Approve করার সময় সার্ভার বর্তমান উপলব্ধ ব্যালেন্স আবার যাচাই করে। Mark-paid-ই একমাত্র ধাপ যেখানে
          Wallet থেকে টাকা কাটে — আসল payout পাঠিয়ে তার reference দিলেই এটি করুন।
        </p>
        {rows.length === 0 ? <p className="text-sm text-slate-400">কোনো অনুরোধ নেই।</p> : (
          <div className="overflow-x-auto">
            <table className="atable">
              <thead>
                <tr>
                  <th className="ath">Organization</th><th className="ath">পরিমাণ</th><th className="ath">মাধ্যম / গন্তব্য</th>
                  <th className="ath">Status</th><th className="ath">তৈরি</th><th className="ath">Ref / নোট</th><th className="ath">পদক্ষেপ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-800">
                    <td className="atd">{r.organizationName ?? r.organizationId}<span className="block text-[11px] text-slate-500">{r.organizationId}</span></td>
                    <td className="atd">৳ {formatMinorStr(r.amountMinor)}</td>
                    <td className="atd">{r.method}<span className="block text-[11px] text-slate-500">{destText(r.destination)}</span></td>
                    <td className="atd">{STATUS_LABEL[r.status] ?? r.status}</td>
                    <td className="atd text-slate-400">{new Date(r.createdAt).toLocaleString("bn-BD")}</td>
                    <td className="atd text-slate-400">{r.payoutRef ?? "—"}{r.adminNote ? <span className="block text-[11px]">{r.adminNote}</span> : null}</td>
                    <td className="atd">
                      <div className="flex flex-wrap gap-1.5">
                        {r.status === "pending" ? <>
                          <button className="abtn !px-2 !py-1 text-xs" disabled={busy !== ""} onClick={() => void act(r.id, "approve")}>Approve</button>
                          <button className="abtn-danger !px-2 !py-1 text-xs" disabled={busy !== ""} onClick={() => void act(r.id, "reject")}>Reject</button>
                        </> : null}
                        {r.status === "approved" ? <>
                          <button className="abtn !px-2 !py-1 text-xs" disabled={busy !== ""} onClick={() => void act(r.id, "mark-paid")}>Mark Paid</button>
                          <button className="abtn-danger !px-2 !py-1 text-xs" disabled={busy !== ""} onClick={() => void act(r.id, "reject")}>Reject</button>
                        </> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <form onSubmit={(e) => void adjust(e)} className="acard mt-4 space-y-3">
        <div className="font-semibold">⚖️ Wallet Adjustment (ম্যানুয়াল সংশোধন)</div>
        <p className="text-xs text-slate-400">
          এটিই একমাত্র ম্যানুয়াল ledger-পথ: Note আবশ্যক, আপনার Admin পরিচয় ledger row-তে রেকর্ড হয়,
          এবং ব্যালেন্স কখনো নেগেটিভ করা যায় না। ধনাত্মক = জমা, ঋণাত্মক = কাটা।
        </p>
        <label className="block text-sm">Organization ID<input className="ainput mt-1" value={adj.organizationId} onChange={(e) => setAdj({ ...adj, organizationId: e.target.value })} required /></label>
        <label className="block text-sm">পরিমাণ (টাকা; কাটতে হলে - দিন)<input className="ainput mt-1" inputMode="decimal" value={adj.amountTaka} onChange={(e) => setAdj({ ...adj, amountTaka: e.target.value })} required placeholder="যেমন: 500 বা -250" /></label>
        <label className="block text-sm">Note (আবশ্যক)<input className="ainput mt-1" value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} required placeholder="সংশোধনের কারণ" /></label>
        <button className="abtn" disabled={busy !== ""} type="submit">{busy === "adjust" ? "হচ্ছে…" : "Adjustment প্রয়োগ করুন"}</button>
      </form>
    </AdminShell>
  );
}
