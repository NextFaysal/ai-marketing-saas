process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "test-secret-ou11";

import { WalletService, buildPayoutInstructionCsv } from "./wallet.service";
import { setPlatformConfigSnapshot } from "../common/platform-config";

/**
 * OU11 — payout automation with the LEGAL GATE encoded.
 * Pinned rules:
 * - NO disbursement execution entry point (instruction issue,
 *   execution confirm, execution fail) runs while (a) no
 *   legal-review confirmation is recorded, or (b) a confirmation
 *   is recorded but the automation switch is off. Refusals name
 *   the gate state and create/debit nothing.
 * - Recording a confirmation is reference-required, never
 *   enables automation by itself; enabling without a recorded
 *   confirmation refuses; revoking clears confirmation AND the
 *   switch. Every gate act is audited.
 * - MANUAL mark-paid (the CC10/CC23 human chain) is NOT gated:
 *   with the gate fully closed it still pays an approved payout
 *   exactly as before — the gate governs automation only.
 * - The bank-instruction rail: instruction only from an APPROVED
 *   request; duplicate issue returns the same instruction;
 *   confirmation completes through adminMarkPaid (the ONLY
 *   ledger debit): two confirmations → exactly ONE payout_debit;
 *   four-eyes is preserved at completion (the approver cannot
 *   confirm-execute at/above the threshold); a failed execution
 *   leaves the request approved + retryable with the reason
 *   recorded and no ledger row.
 */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in v) return v.in.includes(row[k]);
      return true;
    }
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    return row[k] === v;
  });
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {}))[0] ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    findUnique: async ({ where }: any) => rows.filter((r) => matches(r, where ?? {}))[0] ?? null,
    create: async ({ data }: any) => { const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (row) Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => matches(r, where));
      if (idx < 0) throw new Error("Record to delete does not exist.");
      return rows.splice(idx, 1)[0];
    },
    deleteMany: async () => ({ count: 0 }),
  };
}

function build(balance = 100000n) {
  const tables: any = {
    walletAccount: makeTable("wallet"),
    walletTransaction: makeTable("ledger"),
    payoutRequest: makeTable("payout"),
    payoutDestination: makeTable("dest"),
    payoutSchedule: makeTable("sched"),
    payoutLegalGate: makeTable("gate"),
    payoutExecution: makeTable("exec"),
    organization: makeTable("org"),
  };
  tables.$transaction = async (fn: any) => fn(tables);
  tables.organization.rows.push({ id: "org-1", slug: "myshop", name: "My Shop" });
  tables.walletAccount.rows.push({ id: "wallet-1", organizationId: "org-1", currency: "BDT", balanceMinor: balance });
  const auditLogs: any[] = [];
  const audit = { log: async (entry: any) => { auditLogs.push(entry); } } as any;
  const wallet = new WalletService(tables as any, audit);
  return { tables, auditLogs, wallet };
}

const SUPER = { id: "super-1" };
const FINANCE = { id: "admin-2" };

function snapshot(threshold: number | null = null) {
  setPlatformConfigSnapshot({
    llm: null, metaApp: null, smtp: null, sms: null,
    wallet: { feeBps: 0, payoutFourEyesThresholdMinor: threshold },
    loadedAt: Date.now(),
  } as any);
}

/** An approved payout request made the ordinary human way. */
async function approvedRequest(w: WalletService, tables: any, amount = "40000", approver = FINANCE.id) {
  const req: any = await w.createPayoutRequest("org-1", "owner-1", {
    amountMinor: amount, method: "bank",
    destination: { accountName: "My Shop", accountNumber: "1234567890123", bankName: "DBBL" },
  });
  await w.adminDecidePayout({ id: approver }, req.id, "approve");
  return tables.payoutRequest.rows.find((r: any) => r.id === req.id);
}

async function openGate(w: WalletService) {
  await w.recordPayoutLegalConfirmation(SUPER, { reference: "Rahman & Associates — memo LR-2026-014" });
  await w.setPayoutAutomationEnabled(SUPER, true);
}

describe("OU11 legal gate — recording discipline", () => {
  it("confirmation requires a reference; recording alone never enables automation", async () => {
    snapshot();
    const { wallet } = build();
    await expect(wallet.recordPayoutLegalConfirmation(SUPER, {})).rejects.toThrow(/reference আবশ্যক/);
    await expect(wallet.recordPayoutLegalConfirmation(SUPER, { reference: "  " })).rejects.toThrow(/reference আবশ্যক/);
    const state: any = await wallet.recordPayoutLegalConfirmation(SUPER, { reference: "Rahman & Associates — memo LR-2026-014", note: "Wallet holding review" });
    expect(state.recorded).toBe(true);
    expect(state.confirmedById).toBe("super-1");
    expect(state.reference).toBe("Rahman & Associates — memo LR-2026-014");
    expect(state.automationEnabled).toBe(false);
    expect(state.automationAllowed).toBe(false);
  });

  it("enabling automation without a recorded confirmation refuses; with one it opens", async () => {
    snapshot();
    const { wallet } = build();
    await expect(wallet.setPayoutAutomationEnabled(SUPER, true)).rejects.toThrow(/LEGAL REVIEW/);
    await wallet.recordPayoutLegalConfirmation(SUPER, { reference: "Memo LR-1" });
    const on: any = await wallet.setPayoutAutomationEnabled(SUPER, true);
    expect(on.automationAllowed).toBe(true);
    const off: any = await wallet.setPayoutAutomationEnabled(SUPER, false);
    expect(off.recorded).toBe(true);
    expect(off.automationAllowed).toBe(false);
  });

  it("revoking clears the confirmation AND forces the switch off; every gate act is audited", async () => {
    snapshot();
    const { wallet, auditLogs } = build();
    await openGate(wallet);
    const revoked: any = await wallet.revokePayoutLegalConfirmation(SUPER);
    expect(revoked.recorded).toBe(false);
    expect(revoked.automationEnabled).toBe(false);
    await expect(wallet.revokePayoutLegalConfirmation(SUPER)).rejects.toThrow(/রেকর্ড করা নেই/);
    const actions = auditLogs.map((a) => a.action);
    expect(actions).toContain("admin.payout_legal_gate_confirmed");
    expect(actions).toContain("admin.payout_automation_enabled");
    expect(actions).toContain("admin.payout_legal_gate_revoked");
  });
});

describe("OU11 legal gate — enforcement on every execution entry point", () => {
  it("gate state (a) NO confirmation: issue, confirm and fail all refuse and create/debit nothing", async () => {
    snapshot();
    const { wallet, tables } = build();
    const req = await approvedRequest(wallet, tables);
    await expect(wallet.issuePayoutInstruction(FINANCE, req.id)).rejects.toThrow(/LEGAL REVIEW এখনো রেকর্ড করা হয়নি/);
    await expect(wallet.confirmPayoutExecution(FINANCE, req.id, "BANKREF1")).rejects.toThrow(/LEGAL REVIEW এখনো রেকর্ড করা হয়নি/);
    await expect(wallet.failPayoutExecution(FINANCE, req.id, "bank refused")).rejects.toThrow(/LEGAL REVIEW এখনো রেকর্ড করা হয়নি/);
    expect(tables.payoutExecution.rows).toHaveLength(0);
    expect(tables.walletTransaction.rows).toHaveLength(0);
    expect(tables.walletAccount.rows[0].balanceMinor).toBe(100000n);
    expect(tables.payoutRequest.rows[0].status).toBe("approved");
  });

  it("gate state (b) confirmation recorded but switch OFF: issue, confirm and fail all refuse", async () => {
    snapshot();
    const { wallet, tables } = build();
    const req = await approvedRequest(wallet, tables);
    await wallet.recordPayoutLegalConfirmation(SUPER, { reference: "Memo LR-2" });
    await expect(wallet.issuePayoutInstruction(FINANCE, req.id)).rejects.toThrow(/automation switch OFF/);
    await expect(wallet.confirmPayoutExecution(FINANCE, req.id, "BANKREF1")).rejects.toThrow(/automation switch OFF/);
    await expect(wallet.failPayoutExecution(FINANCE, req.id, "bank refused")).rejects.toThrow(/automation switch OFF/);
    expect(tables.payoutExecution.rows).toHaveLength(0);
    expect(tables.walletTransaction.rows).toHaveLength(0);
  });

  it("closing the gate mid-flight stops the NEXT execution attempt (DB read, not a cache)", async () => {
    snapshot();
    const { wallet, tables } = build();
    const req = await approvedRequest(wallet, tables);
    await openGate(wallet);
    const issued: any = await wallet.issuePayoutInstruction(FINANCE, req.id);
    expect(issued.status).toBe("instruction_issued");
    await wallet.setPayoutAutomationEnabled(SUPER, false);
    await expect(wallet.confirmPayoutExecution(FINANCE, req.id, "BANKREF1")).rejects.toThrow(/automation switch OFF/);
    expect(tables.walletTransaction.rows).toHaveLength(0);
    expect(tables.payoutRequest.rows[0].status).toBe("approved");
  });

  it("MANUAL mark-paid is NOT gated: with the gate fully closed it pays exactly as CC10/CC23 defined", async () => {
    snapshot();
    const { wallet, tables } = build();
    const req = await approvedRequest(wallet, tables);
    // No gate record exists at all — the human chain still runs.
    const paid: any = await wallet.adminMarkPaid(FINANCE, req.id, "MANUAL-REF-1");
    expect(paid.status).toBe("paid");
    expect(paid.payoutRef).toBe("MANUAL-REF-1");
    expect(tables.walletTransaction.rows).toHaveLength(1);
    expect(tables.walletTransaction.rows[0].type).toBe("payout_debit");
    expect(tables.walletAccount.rows[0].balanceMinor).toBe(60000n);
  });
});

describe("OU11 bank-instruction rail", () => {
  it("instruction only from an APPROVED request: pending refuses; the snapshot carries destination + amount + ref", async () => {
    snapshot();
    const { wallet, tables } = build();
    const pending: any = await wallet.createPayoutRequest("org-1", "owner-1", {
      amountMinor: "40000", method: "bank",
      destination: { accountName: "My Shop", accountNumber: "1234567890123", bankName: "DBBL" },
    });
    await openGate(wallet);
    await expect(wallet.issuePayoutInstruction(FINANCE, pending.id)).rejects.toThrow(/শুধু approved/);
    expect(tables.payoutExecution.rows).toHaveLength(0);
    await wallet.adminDecidePayout(FINANCE, pending.id, "approve");
    const issued: any = await wallet.issuePayoutInstruction(FINANCE, pending.id);
    expect(issued.status).toBe("instruction_issued");
    expect(issued.rail).toBe("bank_instruction");
    expect(issued.amountMinor).toBe("40000");
    expect(issued.destination).toEqual({ accountName: "My Shop", accountNumber: "1234567890123", bankName: "DBBL" });
    expect(issued.instructionRef).toMatch(/^BANK-/);
    // Issuing moves NO money.
    expect(tables.walletTransaction.rows).toHaveLength(0);
    expect(tables.walletAccount.rows[0].balanceMinor).toBe(100000n);
    const csv = buildPayoutInstructionCsv(issued);
    expect(csv).toContain(issued.instructionRef);
    expect(csv).toContain("1234567890123");
    expect(csv).toContain("40000");
  });

  it("duplicate issue returns the SAME instruction — one row, one ref", async () => {
    snapshot();
    const { wallet, tables } = build();
    const req = await approvedRequest(wallet, tables);
    await openGate(wallet);
    const first: any = await wallet.issuePayoutInstruction(FINANCE, req.id);
    const second: any = await wallet.issuePayoutInstruction(FINANCE, req.id);
    expect(second.id).toBe(first.id);
    expect(second.instructionRef).toBe(first.instructionRef);
    expect(tables.payoutExecution.rows).toHaveLength(1);
  });

  it("confirmation completes through mark-paid: exactly ONE debit, bank ref becomes the payoutRef", async () => {
    snapshot();
    const { wallet, tables } = build();
    const req = await approvedRequest(wallet, tables);
    await openGate(wallet);
    await expect(wallet.confirmPayoutExecution(FINANCE, req.id, "BANKREF9")).rejects.toThrow(/কোনো bank instruction নেই/);
    await wallet.issuePayoutInstruction(FINANCE, req.id);
    await expect(wallet.confirmPayoutExecution(FINANCE, req.id, " ")).rejects.toThrow(/bankReference/);
    const done: any = await wallet.confirmPayoutExecution(FINANCE, req.id, "BANKREF9");
    expect(done.execution.status).toBe("confirmed");
    expect(done.execution.bankReference).toBe("BANKREF9");
    expect(done.payout.status).toBe("paid");
    expect(done.payout.payoutRef).toBe("BANKREF9");
    const debits = tables.walletTransaction.rows.filter((r: any) => r.type === "payout_debit");
    expect(debits).toHaveLength(1);
    expect(debits[0].amountMinor).toBe(-40000n);
    expect(tables.walletAccount.rows[0].balanceMinor).toBe(60000n);
    // Duplicate confirmation: no second debit, stored truth returned.
    const again: any = await wallet.confirmPayoutExecution(FINANCE, req.id, "BANKREF9");
    expect(again.alreadyConfirmed).toBe(true);
    expect(tables.walletTransaction.rows.filter((r: any) => r.type === "payout_debit")).toHaveLength(1);
    expect(tables.walletAccount.rows[0].balanceMinor).toBe(60000n);
    // And a paid payout can never get a new instruction.
    await expect(wallet.issuePayoutInstruction(FINANCE, req.id)).rejects.toThrow(/ইতিমধ্যে paid/);
  });

  it("four-eyes preserved at completion: the approver cannot confirm-execute at/above the threshold", async () => {
    snapshot(30000); // threshold 30000 minor; payout is 40000
    const { wallet, tables } = build();
    const req = await approvedRequest(wallet, tables, "40000", FINANCE.id); // approved BY admin-2
    await openGate(wallet);
    await wallet.issuePayoutInstruction(FINANCE, req.id);
    await expect(wallet.confirmPayoutExecution(FINANCE, req.id, "BANKREFX")).rejects.toThrow(/চার-চোখের নিয়ম/);
    // Nothing debited; the execution stays open and retryable by a second admin.
    expect(tables.walletTransaction.rows).toHaveLength(0);
    expect(tables.payoutExecution.rows[0].status).toBe("instruction_issued");
    expect(tables.payoutRequest.rows[0].status).toBe("approved");
    const done: any = await wallet.confirmPayoutExecution({ id: "admin-3" }, req.id, "BANKREFX");
    expect(done.payout.status).toBe("paid");
    expect(tables.walletTransaction.rows.filter((r: any) => r.type === "payout_debit")).toHaveLength(1);
  });

  it("failed execution: reason recorded, request stays approved, no debit, re-issue + confirm succeeds", async () => {
    snapshot();
    const { wallet, tables } = build();
    const req = await approvedRequest(wallet, tables);
    await openGate(wallet);
    const issued: any = await wallet.issuePayoutInstruction(FINANCE, req.id);
    await expect(wallet.failPayoutExecution(FINANCE, req.id, "")).rejects.toThrow(/কারণ/);
    const failed: any = await wallet.failPayoutExecution(FINANCE, req.id, "Bank rejected: account name mismatch");
    expect(failed.status).toBe("failed");
    expect(failed.failureReason).toBe("Bank rejected: account name mismatch");
    expect(tables.payoutRequest.rows[0].status).toBe("approved");
    expect(tables.walletTransaction.rows).toHaveLength(0);
    expect(tables.walletAccount.rows[0].balanceMinor).toBe(100000n);
    // A failed execution cannot be confirmed; a re-issue reuses the row and clears the failure.
    await expect(wallet.confirmPayoutExecution(FINANCE, req.id, "BANKREF2")).rejects.toThrow(/confirm করা যাবে না/);
    const reissued: any = await wallet.issuePayoutInstruction(FINANCE, req.id);
    expect(reissued.id).toBe(issued.id);
    expect(reissued.status).toBe("instruction_issued");
    expect(reissued.failureReason).toBeNull();
    expect(tables.payoutExecution.rows).toHaveLength(1);
    const done: any = await wallet.confirmPayoutExecution(FINANCE, req.id, "BANKREF2");
    expect(done.payout.status).toBe("paid");
    expect(tables.walletTransaction.rows.filter((r: any) => r.type === "payout_debit")).toHaveLength(1);
    // A confirmed execution cannot be failed afterwards.
    await expect(wallet.failPayoutExecution(FINANCE, req.id, "too late")).rejects.toThrow(/failed করা যাবে না/);
  });
});
