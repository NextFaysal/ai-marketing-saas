"use client";
import React from "react";
import AdminShell from "@/components/AdminShell";
import { ConfirmModal, EmptyState, ErrorState, PageHead, SavedViewsBar, toast, useLastFilters } from "@/components/ui";
import { API_URL, apiFetch, formatMinorStr, getAdminToken } from "@/lib/api";
import { fmtDateTime } from "@/lib/dates";
import { fmtNumber } from "@repo/contracts";
import { useAdminLocale } from "@/components/AdminLocale";

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
  const { dict } = useAdminLocale();
  if (row.status === "rejected") return <span className="abadge-red">{dict.payouts.rejectedFinal}</span>;
  if (row.status === "cancelled") return <span className="abadge-slate">{dict.payouts.cancelledFinal}</span>;
  const steps = [dict.payouts.stepRequest, dict.payouts.stepApprove, dict.payouts.stepMarkPaid];
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

type ActionKind = "approve" | "reject" | "mark-paid" | "exec-confirm" | "exec-fail";

/** OU11 — the legal gate for payout AUTOMATION. This card only
 * RECORDS a SUPER admin's confirmation that the wallet legal
 * review (holding tenant funds) has been completed — it does
 * not perform or replace the review. Automation additionally
 * needs the separate switch ON. Manual approve + mark-paid
 * above are NOT gated and work exactly as before. The API
 * enforces SUPER-only for every write here; this card renders
 * for FINANCE too, whose attempts the API refuses (the refusal
 * surfaces verbatim as a toast). */
interface LegalGateView {
  recorded: boolean; confirmedById: string | null; confirmedAt: string | null;
  reference: string | null; note: string | null;
  automationEnabled: boolean; automationEnabledById: string | null; automationEnabledAt: string | null;
  automationAllowed: boolean;
}

function LegalGateCard() {
  const { dict, locale, t } = useAdminLocale();
  const [gate, setGate] = React.useState<LegalGateView | null>(null);
  const [gateBusy, setGateBusy] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [note, setNote] = React.useState("");
  const loadGate = React.useCallback(async () => {
    const out = await apiFetch<LegalGateView>("/admin/payout-legal-gate").catch(() => null);
    setGate(out);
  }, []);
  React.useEffect(() => { void loadGate(); }, [loadGate]);

  async function gateAct(kind: "confirm" | "revoke" | "on" | "off") {
    setGateBusy(kind);
    try {
      if (kind === "confirm") {
        if (!reference.trim()) { toast(dict.payouts.gateReferenceRequired, "error"); return; }
        await apiFetch("/admin/payout-legal-gate/confirm", { method: "POST", body: JSON.stringify({ reference: reference.trim(), note: note.trim() || undefined }) });
        toast(dict.payouts.gateConfirmDone);
        setReference(""); setNote("");
      } else if (kind === "revoke") {
        await apiFetch("/admin/payout-legal-gate/revoke", { method: "POST", body: "{}" });
        toast(dict.payouts.gateRevokeDone);
      } else {
        await apiFetch("/admin/payout-legal-gate/automation", { method: "POST", body: JSON.stringify({ enabled: kind === "on" }) });
        toast(kind === "on" ? dict.payouts.gateOnDone : dict.payouts.gateOffDone);
      }
      await loadGate();
    } catch (e) { toast(e instanceof Error ? e.message : dict.common.failed, "error"); }
    finally { setGateBusy(""); }
  }

  return (
    <div className="acard mb-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{dict.payouts.gateTitle}</span>
        {gate === null ? <span className="abadge-slate">{dict.payouts.gateLoading}</span>
          : gate.automationAllowed ? <span className="abadge-green">{dict.payouts.gateAutomationOn}</span>
          : gate.recorded ? <span className="abadge-amber">{dict.payouts.gateRecordedOff}</span>
          : <span className="abadge-red">{dict.payouts.gateNoRecord}</span>}
      </div>
      <p className="text-xs text-slate-400">
        {dict.payouts.gateNoteA}<b>{dict.payouts.gateNoteLegal}</b>{dict.payouts.gateNoteB}<b>{dict.payouts.gateNoteSuper}</b>{dict.payouts.gateNoteC}<b>{dict.payouts.gateNoteRecord}</b>{dict.payouts.gateNoteD}
      </p>
      {gate?.recorded ? (
        <p className="text-xs text-slate-300">
          {dict.payouts.gateConfirmation} <b>{gate.reference}</b>{gate.note ? ` — ${gate.note}` : ""}<br />
          {dict.payouts.gateRecordedBy} {gate.confirmedById} · {gate.confirmedAt ? fmtDateTime(locale, gate.confirmedAt) : ""}
          {gate.automationEnabled ? <><br />{dict.payouts.gateAutomationOnBy} {gate.automationEnabledById} · {gate.automationEnabledAt ? fmtDateTime(locale, gate.automationEnabledAt) : ""}</> : null}
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-sm">{dict.payouts.gateReferenceLabel}
            <input className="ainput mt-1" value={reference} onChange={(e) => setReference(e.target.value)} placeholder={dict.payouts.gateReferencePlaceholder} /></label>
          <label className="block text-sm">{dict.payouts.gateNoteLabel}
            <input className="ainput mt-1" value={note} onChange={(e) => setNote(e.target.value)} placeholder={dict.payouts.gateNotePlaceholder} /></label>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {!gate?.recorded ? (
          <button className="abtn !px-2 !py-1 text-xs" disabled={gateBusy !== ""} onClick={() => void gateAct("confirm")}>{dict.payouts.gateConfirmButton}</button>
        ) : (<>
          {gate.automationEnabled ? (
            <button className="abtn-danger !px-2 !py-1 text-xs" disabled={gateBusy !== ""} onClick={() => void gateAct("off")}>{dict.payouts.gateOffButton}</button>
          ) : (
            <button className="abtn !px-2 !py-1 text-xs" disabled={gateBusy !== ""} onClick={() => void gateAct("on")}>{dict.payouts.gateOnButton}</button>
          )}
          <button className="abtn-danger !px-2 !py-1 text-xs" disabled={gateBusy !== ""} onClick={() => void gateAct("revoke")}>{dict.payouts.gateRevokeButton}</button>
        </>)}
      </div>
    </div>
  );
}

export default function PayoutsPage() {
  const { dict, locale, t } = useAdminLocale();
  const STATUS_LABEL: Record<string, string> = {
    pending: dict.payouts.statusPending, approved: dict.payouts.statusApproved, paid: dict.payouts.statusPaid, rejected: dict.payouts.statusRejected, cancelled: dict.payouts.statusCancelled,
  };
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
      .catch((e) => { setLoadError(e instanceof Error ? e.message : dict.payouts.loadFailedFallback); return { requests: [] as PayoutRow[] }; });
    setRows(out.requests ?? []);
    setLoading(false);
  }, [status, dict]);
  React.useEffect(() => { load(); }, [load]);
  // ADNX15: the status select is this page's one real filter —
  // it gains saved views and last-used persistence (the apply is
  // the same single-filter shape for both).
  useLastFilters("payouts", { status }, (s) => setStatus(s.status ?? ""));
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
    let path = `/admin/payout-requests/${id}/${kind}`;
    if (kind === "reject") body = { note: value };
    if (kind === "approve") body = value ? { note: value } : {};
    if (kind === "mark-paid") body = { payoutRef: value };
    // OU11: execution actions complete/fail the bank-instruction
    // execution for this request; the legal gate is re-checked
    // server-side on every call.
    if (kind === "exec-confirm") { path = `/admin/payout-requests/${id}/execution/confirm`; body = { bankReference: value }; }
    if (kind === "exec-fail") { path = `/admin/payout-requests/${id}/execution/fail`; body = { reason: value }; }
    setBusy(id + kind);
    try {
      await apiFetch(path, { method: "POST", body: JSON.stringify(body) });
      toast(kind === "mark-paid" ? dict.payouts.paidDone
        : kind === "approve" ? dict.payouts.approveDone
        : kind === "exec-confirm" ? dict.payouts.execConfirmDone
        : kind === "exec-fail" ? dict.payouts.execFailDone
        : dict.payouts.rejectedDone);
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : dict.common.failed, "error"); }
    finally { setBusy(""); setPendingAction(null); }
  }

  /** OU11: issue the bank instruction for an approved payout
   * (legal gate enforced server-side). Idempotent: issuing again
   * returns the same instruction, whose reference the toast
   * shows; the CSV is the document taken to the bank. */
  async function doIssue(row: PayoutRow) {
    setBusy(row.id + "issue");
    try {
      const out = await apiFetch<{ instructionRef: string }>(`/admin/payout-requests/${row.id}/execution/instruction`, { method: "POST", body: "{}" });
      toast(t("payouts.instructionDone", { ref: out.instructionRef }));
    } catch (e) { toast(e instanceof Error ? e.message : dict.payouts.instructionFailed, "error"); }
    finally { setBusy(""); }
  }

  async function downloadInstruction(id: string) {
    toast(dict.payouts.preparingInstruction, "info");
    try {
      const token = getAdminToken();
      const res = await fetch(`${API_URL}/admin/payout-requests/${id}/execution/instruction.csv`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) { toast(t("payouts.instructionOpenFailed", { status: fmtNumber(locale, res.status) }), "error"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `payout-instruction-${id}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast(dict.payouts.instructionDownloaded);
    } catch (e) { toast(e instanceof Error ? e.message : dict.payouts.instructionDownloadFailed, "error"); }
  }

  async function downloadStatement(organizationId: string, kind: "csv" | "pdf") {
    // Stage feedback by toast: preparing -> downloaded / failed.
    // (The endpoint returns one blob — there is no byte stream to
    // report a percentage from, so no % progress is claimed.)
    toast(dict.payouts.preparingStatement, "info");
    try {
      const token = getAdminToken();
      const res = await fetch(`${API_URL}/admin/wallets/${organizationId}/statement.${kind}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) { toast(t("payouts.statementOpenFailed", { status: fmtNumber(locale, res.status) }), "error"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `wallet-statement-${organizationId}.${kind}`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast(dict.payouts.statementDownloaded);
    } catch (e) { toast(e instanceof Error ? e.message : dict.payouts.statementDownloadFailed, "error"); }
  }

  async function adjust(e: React.FormEvent) {
    e.preventDefault();
    const taka = Number(adj.amountTaka);
    if (!adj.organizationId.trim() || !Number.isFinite(taka) || taka === 0 || !adj.note.trim()) {
      setAdjError(dict.payouts.adjustError);
      return;
    }
    setAdjError("");
    setBusy("adjust");
    try {
      const out = await apiFetch<any>(`/admin/wallets/${adj.organizationId.trim()}/adjust`, {
        method: "POST",
        body: JSON.stringify({ amountMinor: String(Math.round(taka * 100)), note: adj.note.trim() }),
      });
      toast(t("payouts.adjustDone", { balance: formatMinorStr(out.balanceAfterMinor, locale) }));
      setAdj({ organizationId: "", amountTaka: "", note: "" });
    } catch (err) { toast(err instanceof Error ? err.message : dict.payouts.adjustFailed, "error"); }
    finally { setBusy(""); }
  }

  const modal = pendingAction ? {
    approve: { title: dict.payouts.modalApproveTitle, description: t("payouts.modalApproveDesc", { org: pendingAction.row.organizationName ?? pendingAction.row.organizationId, amount: formatMinorStr(pendingAction.row.amountMinor, locale) }), inputLabel: dict.payouts.modalApproveNote, inputOptional: true, inputRequired: false, confirmLabel: dict.payouts.modalApproveConfirm, danger: false },
    reject: { title: dict.payouts.modalRejectTitle, description: dict.payouts.modalRejectDesc, inputLabel: dict.payouts.modalRejectLabel, inputOptional: false, inputRequired: true, confirmLabel: dict.payouts.modalRejectConfirm, danger: true },
    "mark-paid": { title: dict.payouts.modalMarkPaidTitle, description: dict.payouts.modalMarkPaidDesc, inputLabel: dict.payouts.modalMarkPaidLabel, inputOptional: false, inputRequired: true, confirmLabel: dict.payouts.modalMarkPaidConfirm, danger: false },
    "exec-confirm": { title: dict.payouts.modalExecConfirmTitle, description: dict.payouts.modalExecConfirmDesc, inputLabel: dict.payouts.modalExecConfirmLabel, inputOptional: false, inputRequired: true, confirmLabel: dict.payouts.modalExecConfirmConfirm, danger: false },
    "exec-fail": { title: dict.payouts.modalExecFailTitle, description: dict.payouts.modalExecFailDesc, inputLabel: dict.payouts.modalExecFailLabel, inputOptional: false, inputRequired: true, confirmLabel: dict.payouts.modalExecFailConfirm, danger: true },
  }[pendingAction.kind] : null;

  return (
    <AdminShell title={dict.payouts.title}>
      <PageHead sub={dict.payouts.sub}>
        {status === "" && sorted.filter((r) => r.status === "pending").length > 0 ? (
          <span className="abadge-amber">{t("payouts.pendingBadge", { count: fmtNumber(locale, sorted.filter((r) => r.status === "pending").length) })}</span>
        ) : null}
      </PageHead>
      <LegalGateCard />
      <div className="acard space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">{dict.payouts.listTitle}</span>
          <select className="ainput w-full sm:!w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s === "" ? dict.payouts.allStatuses : STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <div className="rounded-xl border border-slate-800">
          <SavedViewsBar page="payouts" current={{ status }} onApply={(s) => setStatus(s.status ?? "")} />
        </div>
        <p className="text-xs text-slate-400">
          {dict.payouts.listNoteA}
          {threshold !== null ? <>{t("payouts.listNoteThreshold", { threshold: formatMinorStr(threshold, locale) })}</> : null}
        </p>
        {loading && rows.length === 0 ? <div className="askel-table" /> : loadError && rows.length === 0 ? <ErrorState message={t("payouts.loadError", { message: loadError })} onRetry={load} /> : sorted.length === 0 ? <EmptyState title={dict.payouts.emptyTitle} sub={dict.payouts.emptySub} /> : (
          <div className="overflow-x-auto">
            <table className="atable atable-sticky atable-cards atable-v3">
              <thead>
                <tr>
                  <th className="ath">{dict.payouts.colOrg}</th><th className="ath">{dict.payouts.colAmount}</th><th className="ath">{dict.payouts.colMethodDest}</th>
                  <th className="ath">{dict.payouts.colStatus}</th><th className="ath">{dict.payouts.colSteps}</th><th className="ath">{dict.payouts.colCreated}</th><th className="ath">{dict.payouts.colRefNote}</th><th className="ath">{dict.payouts.colActions}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.id} className="border-t border-slate-800">
                    <td data-label={dict.payouts.colOrg} className="atd">{r.organizationName ?? r.organizationId}<span className="block text-[11px] text-slate-400">{r.organizationId}</span></td>
                    <td data-label={dict.payouts.colAmount} className="atd">{t("billing.moneyValue", { amount: formatMinorStr(r.amountMinor, locale) })}
                      {fourEyes(r) ? <span className="abadge-amber mt-1 block w-fit" title={dict.payouts.fourEyesTitle}>{dict.payouts.fourEyesBadge}</span> : null}
                    </td>
                    <td data-label={dict.payouts.colMethodDest} className="atd">{r.method}<span className="block text-[11px] text-slate-400">{destText(r.destination)}</span></td>
                    <td data-label={dict.payouts.colStatus} className="atd">{STATUS_LABEL[r.status] ?? r.status}</td>
                    <td data-label={dict.payouts.colSteps} className="atd"><StepStates row={r} /></td>
                    <td data-label={dict.payouts.colCreated} className="atd text-slate-400">{fmtDateTime(locale, r.createdAt)}</td>
                    <td data-label={dict.payouts.colRefNote} className="atd text-slate-400">{r.payoutRef ?? "—"}{r.adminNote ? <span className="block text-[11px]">{r.adminNote}</span> : null}</td>
                    <td data-label={dict.payouts.colActions} className="atd">
                      <div className="flex flex-wrap gap-1.5">
                        {r.status === "pending" ? <>
                          <button className="abtn !px-2 !py-1 text-xs" disabled={busy !== ""} onClick={() => setPendingAction({ row: r, kind: "approve" })}>{dict.payouts.approve}</button>
                          <button className="abtn-danger !px-2 !py-1 text-xs" disabled={busy !== ""} onClick={() => setPendingAction({ row: r, kind: "reject" })}>{dict.payouts.reject}</button>
                        </> : null}
                        {r.status === "approved" ? <>
                          <button className="abtn !px-2 !py-1 text-xs" disabled={busy !== ""} onClick={() => setPendingAction({ row: r, kind: "mark-paid" })}>{dict.payouts.markPaid}</button>
                          <button className="abtn-danger !px-2 !py-1 text-xs" disabled={busy !== ""} onClick={() => setPendingAction({ row: r, kind: "reject" })}>{dict.payouts.reject}</button>
                          <span className="mt-1 block w-full text-[10px] text-slate-500">{dict.payouts.automationNote}</span>
                          <button className="abtn-secondary !px-2 !py-1 text-xs" disabled={busy !== ""} onClick={() => void doIssue(r)}>{dict.payouts.bankInstruction}</button>
                          <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => void downloadInstruction(r.id)}>{dict.payouts.instructionCsv}</button>
                          <button className="abtn !px-2 !py-1 text-xs" disabled={busy !== ""} onClick={() => setPendingAction({ row: r, kind: "exec-confirm" })}>{dict.payouts.executionConfirm}</button>
                          <button className="abtn-danger !px-2 !py-1 text-xs" disabled={busy !== ""} onClick={() => setPendingAction({ row: r, kind: "exec-fail" })}>{dict.payouts.executionFail}</button>
                        </> : null}
                        <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => void downloadStatement(r.organizationId, "csv")}>{dict.payouts.statementCsv}</button>
                        <button className="abtn-secondary !px-2 !py-1 text-xs" onClick={() => void downloadStatement(r.organizationId, "pdf")}>{dict.payouts.statementPdf}</button>
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
        <div className="font-semibold">{dict.payouts.adjustTitle}</div>
        <p className="text-xs text-slate-400">
          {dict.payouts.adjustNote}
        </p>
        <label className="block text-sm">{dict.payouts.adjustOrgId}<input className="ainput mt-1" value={adj.organizationId} onChange={(e) => setAdj({ ...adj, organizationId: e.target.value })} required /></label>
        <label className="block text-sm">{dict.payouts.adjustAmount}<input className="ainput mt-1" inputMode="decimal" value={adj.amountTaka} onChange={(e) => setAdj({ ...adj, amountTaka: e.target.value })} required placeholder={dict.payouts.adjustAmountPlaceholder} /></label>
        <label className="block text-sm">{dict.payouts.adjustNoteLabel}<input className="ainput mt-1" value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} required placeholder={dict.payouts.adjustNotePlaceholder} /></label>
        {adjError ? <p className="text-sm text-red-300" role="alert">{adjError}</p> : null}
        <button className="abtn w-full sm:w-auto" disabled={busy !== ""} type="submit">{busy === "adjust" ? dict.common.busy : dict.payouts.adjustSubmit}</button>
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
