"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { ConfirmModal, EmptyState, ErrorState, PageHead, toast } from "@/components/ui";
import { API_URL, apiFetch, formatMinorStr, getAdminToken } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";

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
 *
 * ADX7 (DB2): queue layout on the SAME data and endpoints —
 * pending first (client-side sort: status rank, then newest),
 * step states shown side by side, wallet statement (AN2)
 * reachable per row, and the action prompts moved to the v3
 * ConfirmModal. Four-eyes flag: the payout payload carries no
 * threshold, so the threshold is read from the EXISTING
 * GET /admin/platform-config (wallet.payoutFourEyesThresholdMinor);
 * rows at/above it are flagged. If the threshold is unset or the
 * config cannot be loaded, NO flag is shown — never a guessed one.
 */

interface PayoutRow {
  id: string; organizationId: string; organizationName?: string | null;
  amountMinor: string; method: string; destination: Record<string, unknown> | null;
  status: string; adminNote: string | null; payoutRef: string | null;
  requestedById: string; decidedById: string | null; approvedById?: string | null; createdAt: string; updatedAt: string;
}

interface PlatformConfigView { wallet: { source: string; feeBps: number; payoutFourEyesThresholdMinor: number | null } }

const STATUSES = ["", "pending", "approved", "paid", "rejected", "cancelled"];
const STATUS_LABEL: Record<string, string> = {
  pending: "অপেক্ষমাণ", approved: "অনুমোদিত", paid: "পাঠানো হয়েছে", rejected: "প্রত্যাখ্যাত", cancelled: "Tenant বাতিল করেছে",
};
/** Queue order: work needing a decision first, then work awaiting
 *  payment, then terminal states. Newest first inside a rank. */
const STATUS_RANK: Record<string, number> = { pending: 0, approved: 1, paid: 2, rejected: 3, cancelled: 4 };

function destText(d: Record<string, unknown> | null): string {
  if (!d) return "—";
  if (d.number) return `bKash: ${String(d.number)}`;
  return [d.bankName, d.accountNumber, d.branch].filter(Boolean).map(String).join(" · ") || "—";
}

/** The three money steps of a payout, shown side by side. */
function StepStates({ row }: { row: PayoutRow }) {
  if (row.status === "rejected") return <span className="abadge-red">প্রত্যাখ্যাত — শেষ</span>;
  if (row.status === "cancelled") return <span className="abadge-slate">Tenant বাতিল করেছে — শেষ</span>;
  const steps = ["অনুরোধ", "Approve", "Mark Paid"];
  const doneCount = row.status === "paid" ? 3 : row.status === "approved" ? 2 : 1;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {steps.map((s, i) => (
        <span key={s} className="inline-flex items-center gap-1">
          {i > 0 ? <span className="text-slate-600">→</span> : null}
          <span className={i < doneCount ? "abadge-green" : i === doneCount ? "abadge-amber" : "abadge-slate"}>
            {i < doneCount ? "✓ " : ""}{s}
          </span>
        </span>
      ))}
    </span>
  );
}

type ActionKind = "approve" | "reject" | "mark-paid";

export default function PayoutsPage() {
  const [rows, setRows] = React.useState<PayoutRow[]>([]);
  const [status, setStatus] = React.useState("");
  // ADNX9: all payout feedback goes through the toast system;
  // the adjustment form keeps its validation error with the form.
  const [adjError, setAdjError] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [adj, setAdj] = React.useState({ organizationId: "", amountTaka: "", note: "" });
  const [threshold, setThreshold] = React.useState<number | null>(null);
  const [pendingAction, setPendingAction] = React.useState<{ row: PayoutRow; kind: ActionKind } | null>(null);

  // ADX12: loading + load-error states — before, the queue's empty
  // state flashed during the first load and a failed load looked
  // like an empty queue.
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");
  const load = React.useCallback(async () => {
    setLoading(true); setLoadError("");
    const out = await apiFetch<{ requests: PayoutRow[] }>(`/admin/payout-requests${status ? `?status=${status}` : ""}`)
      .catch((e) => { setLoadError(e instanceof Error ? e.message : "Payout তালিকা লোড ব্যর্থ হয়েছে"); return { requests: [] as PayoutRow[] }; });
    setRows(out.requests ?? []);
    setLoading(false);
  }, [status]);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    // Four-eyes threshold from the existing platform-config read.
    apiFetch<PlatformConfigView>("/admin/platform-config")
      .then((cfg) => setThreshold(cfg.wallet?.payoutFourEyesThresholdMinor ?? null))
      .catch(() => setThreshold(null));
  }, []);

  const sorted = [...rows].sort((a, b) =>
    ((STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9)) || (+new Date(b.createdAt) - +new Date(a.createdAt)));
  const fourEyes = (r: PayoutRow) => {
    if (threshold === null) return false;
    try { return BigInt(r.amountMinor) >= BigInt(threshold); } catch { return false; }
  };

  async function doAct(id: string, kind: ActionKind, value: string) {
    let body: Record<string, unknown> = {};
    if (kind === "reject") body = { note: value };
    if (kind === "approve") body = value ? { note: value } : {};
    if (kind === "mark-paid") body = { payoutRef: value };
    setBusy(id + kind);
    try {
      await apiFetch(`/admin/payout-requests/${id}/${kind}`, { method: "POST", body: JSON.stringify(body) });
      toast(kind === "mark-paid" ? "Payout paid হিসেবে রেকর্ড হয়েছে — Wallet থেকে একবারই debit হয়েছে।" : kind === "approve" ? "অনুমোদিত হয়েছে।" : "প্রত্যাখ্যাত হয়েছে — hold মুক্ত হয়েছে।");
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : "ব্যর্থ হয়েছে", "error"); }
    finally { setBusy(""); setPendingAction(null); }
  }

  async function downloadStatement(organizationId: string, kind: "csv" | "pdf") {
    // Stage feedback by toast: preparing -> downloaded / failed.
    // (The endpoint returns one blob — there is no byte stream to
    // report a percentage from, so no % progress is claimed.)
    toast("Statement তৈরি হচ্ছে…", "info");
    try {
      const token = getAdminToken();
      const res = await fetch(`${API_URL}/admin/wallets/${organizationId}/statement.${kind}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) { toast(`Statement খুলতে ব্যর্থ: ${res.status}`, "error"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `wallet-statement-${organizationId}.${kind}`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast("Statement ডাউনলোড হয়েছে।");
    } catch (e) { toast(e instanceof Error ? e.message : "Statement ডাউনলোড ব্যর্থ হয়েছে", "error"); }
  }

  async function adjust(e: React.FormEvent) {
    e.preventDefault();
    const taka = Number(adj.amountTaka);
    if (!adj.organizationId.trim() || !Number.isFinite(taka) || taka === 0 || !adj.note.trim()) {
      setAdjError("Organization ID, শূন্য-ছাড়া পরিমাণ (টাকা, ঋণাত্মক হলে -) এবং Note — তিনটিই আবশ্যক।");
      return;
    }
    setAdjError("");
    setBusy("adjust");
    try {
      const out = await apiFetch<any>(`/admin/wallets/${adj.organizationId.trim()}/adjust`, {
        method: "POST",
        body: JSON.stringify({ amountMinor: String(Math.round(taka * 100)), note: adj.note.trim() }),
      });
      toast(`Adjustment রেকর্ড হয়েছে — নতুন ব্যালেন্স ৳ ${formatMinorStr(out.balanceAfterMinor)}।`);
      setAdj({ organizationId: "", amountTaka: "", note: "" });
    } catch (err) { toast(err instanceof Error ? err.message : "Adjustment ব্যর্থ", "error"); }
    finally { setBusy(""); }
  }

  const modal = pendingAction ? {
    approve: { title: "Payout Approve করুন", description: `${pendingAction.row.organizationName ?? pendingAction.row.organizationId} — ৳ ${formatMinorStr(pendingAction.row.amountMinor)}`, inputLabel: "অনুমোদনের নোট", inputOptional: true, inputRequired: false, confirmLabel: "Approve", danger: false },
    reject: { title: "Payout Reject করুন", description: "কারণটি Tenant দেখতে পাবে এবং hold মুক্ত হবে।", inputLabel: "Reject-এর কারণ (Tenant দেখতে পাবে)", inputOptional: false, inputRequired: true, confirmLabel: "Reject", danger: true },
    "mark-paid": { title: "Payout Mark Paid করুন", description: "আসল payout পাঠানোর পরেই এটি করুন — এই ধাপেই Wallet থেকে একবার debit হবে।", inputLabel: "আসল Payout-এর Reference (bKash TrxID / Bank Ref)", inputOptional: false, inputRequired: true, confirmLabel: "Mark Paid", danger: false },
  }[pendingAction.kind] : null;

  return (
    <AdminShell title="🏦 Wallet Payouts">
      <PageHead sub="Tenant Wallet-এর Payout অনুরোধ — Approve ও Mark Paid-এর queue।">
        {status === "" && sorted.filter((r) => r.status === "pending").length > 0 ? (
          <span className="abadge-amber">{sorted.filter((r) => r.status === "pending").length}টি সিদ্ধান্ত বাকি</span>
        ) : null}
      </PageHead>
      <div className="acard space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">Tenant Payout অনুরোধসমূহ</span>
          <select className="ainput w-full sm:!w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s === "" ? "সব status" : STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <p className="text-xs text-slate-400">
          Approve করার সময় সার্ভার বর্তমান উপলব্ধ ব্যালেন্স আবার যাচাই করে। Mark-paid-ই একমাত্র ধাপ যেখানে
          Wallet থেকে টাকা কাটে — আসল payout পাঠিয়ে তার reference দিলেই এটি করুন।
          তালিকা queue অনুযায়ী সাজানো: অপেক্ষমাণ আগে, তারপর অনুমোদিত, শেষে সম্পন্ন/বাতিল (প্রতিটিতে নতুন আগে)।
          {threshold !== null ? <> Four-eyes সীমা ৳ {formatMinorStr(threshold)} — এই পরিমাণ বা তার বেশি হলে নিচে পতাকা দেখানো হচ্ছে।</> : null}
        </p>
        {loading && rows.length === 0 ? <div className="askel-table" /> : loadError && rows.length === 0 ? <ErrorState message={`Payout লোড হয়নি: ${loadError}`} onRetry={load} /> : sorted.length === 0 ? <EmptyState title="কোনো অনুরোধ নেই।" sub="এই status-এ কোনো Payout অনুরোধ জমা নেই — অন্য status বেছে দেখুন।" /> : (
          <div className="overflow-x-auto">
            <table className="atable atable-sticky atable-cards atable-v3">
              <thead>
                <tr>
                  <th className="ath">Organization</th><th className="ath">পরিমাণ</th><th className="ath">মাধ্যম / গন্তব্য</th>
                  <th className="ath">Status</th><th className="ath">ধাপ</th><th className="ath">তৈরি</th><th className="ath">Ref / নোট</th><th className="ath">পদক্ষেপ</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.id} className="border-t border-slate-800">
                    <td data-label="Organization" className="atd">{r.organizationName ?? r.organizationId}<span className="block text-[11px] text-slate-400">{r.organizationId}</span></td>
                    <td data-label="পরিমাণ" className="atd">৳ {formatMinorStr(r.amountMinor)}
                      {fourEyes(r) ? <span className="abadge-amber mt-1 block w-fit" title="Four-eyes: এই পরিমাণ সেট করা সীমার সমান বা বেশি। Approved অবস্থায় যিনি Approve করেছেন তিনি Mark Paid করতে পারবেন না — অন্য Admin লাগবে।">⚖ Four-eyes সীমার ওপরে</span> : null}
                    </td>
                    <td data-label="মাধ্যম / গন্তব্য" className="atd">{r.method}<span className="block text-[11px] text-slate-400">{destText(r.destination)}</span></td>
                    <td data-label="Status" className="atd">{STATUS_LABEL[r.status] ?? r.status}</td>
                    <td data-label="ধাপ" className="atd"><StepStates row={r} /></td>
                    <td data-label="তৈরি" className="atd text-slate-400">{fmtDateTime(r.createdAt)}</td>
                    <td data-label="Ref / নোট" className="atd text-slate-400">{r.payoutRef ?? "—"}{r.adminNote ? <span className="block text-[11px]">{r.adminNote}</span> : null}</td>
                    <td data-label="পদক্ষেপ" className="atd">
                      <div className="flex flex-wrap gap-1.5">
                        {r.status === "pending" ? <>
                          <button className="abtn !px-2 !py-1 text-xs" disabled={busy !== ""} onClick={() => setPendingAction({ row: r, kind: "approve" })}>Approve</button>
                          <button className="abtn-danger !px-2 !py-1 text-xs" disabled={busy !== ""} onClick={() => setPendingAction({ row: r, kind: "reject" })}>Reject</button>
                        </> : null}
                        {r.status === "approved" ? <>
                          <button className="abtn !px-2 !py-1 text-xs" disabled={busy !== ""} onClick={() => setPendingAction({ row: r, kind: "mark-paid" })}>Mark Paid</button>
                          <button className="abtn-danger !px-2 !py-1 text-xs" disabled={busy !== ""} onClick={() => setPendingAction({ row: r, kind: "reject" })}>Reject</button>
                        </> : null}
                        <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => void downloadStatement(r.organizationId, "csv")}>Statement CSV</button>
                        <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => void downloadStatement(r.organizationId, "pdf")}>Statement PDF</button>
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
        {adjError ? <p className="text-sm text-red-300" role="alert">{adjError}</p> : null}
        <button className="abtn w-full sm:w-auto" disabled={busy !== ""} type="submit">{busy === "adjust" ? "হচ্ছে…" : "Adjustment প্রয়োগ করুন"}</button>
      </form>

      {pendingAction && modal ? (
        <ConfirmModal
          open
          title={modal.title}
          description={modal.description}
          inputLabel={modal.inputLabel}
          inputOptional={modal.inputOptional}
          inputRequired={modal.inputRequired}
          confirmLabel={modal.confirmLabel}
          danger={modal.danger}
          busy={busy !== ""}
          onCancel={() => setPendingAction(null)}
          onConfirm={(value) => void doAct(pendingAction.row.id, pendingAction.kind, value)}
        />
      ) : null}
    </AdminShell>
  );
}
