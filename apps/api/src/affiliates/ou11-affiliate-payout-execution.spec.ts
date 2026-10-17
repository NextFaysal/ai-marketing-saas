import "reflect-metadata";
import { AffiliatesService } from "./affiliates.service";

/**
 * OU11 — affiliate payouts ride the SAME bank-instruction rail
 * and the SAME legal gate as wallet payouts. Pinned rules:
 * - issue / confirm / fail all refuse while (a) no legal-review
 *   confirmation is recorded, or (b) confirmation recorded but
 *   the automation switch is off — creating nothing;
 * - an execution may only draw on APPROVED outstanding
 *   commissions (pending entries never count), and open
 *   instructions reserve their amounts (no joint overdraw);
 * - confirmation creates exactly ONE AffiliatePayout through
 *   the EC32 bookkeeping (same FIFO flip): duplicate confirm
 *   returns the stored payout and creates nothing;
 * - a failed execution records its reason, creates no payout,
 *   flips nothing, and leaves the outstanding fully retryable;
 * - the EC32 manual recordPayout path is NOT gated.
 */

type Row = Record<string, any>;

function matches(row: Row, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]) => {
    if (v === undefined) return true;
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v as any).in.includes(row[k]);
      return true;
    }
    return row[k] === v;
  });
}

function setup() {
  let seq = 0;
  let clock = 0;
  const nextDate = () => new Date(1_700_000_000_000 + ++clock * 1000);
  const table = (rows: Row[], prefix: string) => ({
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where, orderBy }: any = {}) => {
      const out = rows.filter((r) => matches(r, where));
      if (orderBy?.createdAt === "desc") out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return out;
    },
    create: async ({ data }: any) => {
      const row: Row = { id: `${prefix}-${++seq}`, createdAt: nextDate(), updatedAt: nextDate(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (row) Object.assign(row, data, { updatedAt: nextDate() });
      return row;
    },
  });

  const partners: Row[] = [{
    id: "partner-1", organizationId: "org-1", name: "Rafi Partner",
    phone: "01711111111", email: null, code: "AFFXYZ12",
    commissionPercent: 15, status: "active", note: null,
    createdAt: nextDate(), updatedAt: nextDate(),
  }];
  // Two APPROVED entries (30000 + 20000 = 50000 outstanding)
  // and one PENDING entry (99999 — must never be executable).
  const entries: Row[] = [
    { id: "entry-1", organizationId: "org-1", partnerId: "partner-1", orderId: "order-1", status: "approved", commissionMinor: 30000n, createdAt: nextDate(), updatedAt: nextDate() },
    { id: "entry-2", organizationId: "org-1", partnerId: "partner-1", orderId: "order-2", status: "approved", commissionMinor: 20000n, createdAt: nextDate(), updatedAt: nextDate() },
    { id: "entry-3", organizationId: "org-1", partnerId: "partner-1", orderId: "order-3", status: "pending", commissionMinor: 99999n, createdAt: nextDate(), updatedAt: nextDate() },
  ];
  const payouts: Row[] = [];
  const executions: Row[] = [];
  const gateRows: Row[] = [];
  const auditLogs: any[] = [];

  const prisma: any = {
    affiliatePartner: table(partners, "partner"),
    commissionEntry: table(entries, "entry"),
    affiliatePayout: table(payouts, "payout"),
    payoutExecution: table(executions, "exec"),
    payoutLegalGate: table(gateRows, "gate"),
  };
  const audit = { log: async (e: any) => { auditLogs.push(e); } } as any;
  const svc = new AffiliatesService(prisma, audit, undefined);
  return { svc, prisma, entries, payouts, executions, gateRows, auditLogs };
}

async function openGate(gateRows: Row[]) {
  gateRows.push({
    id: "gate-1", scope: "platform",
    legalConfirmedById: "super-1", legalConfirmedAt: new Date(),
    legalReference: "Memo LR-1", legalNote: null,
    automationEnabled: true, automationEnabledById: "super-1", automationEnabledAt: new Date(),
    createdAt: new Date(), updatedAt: new Date(),
  });
}

const BKASH_DEST = { number: "01712345678" };

describe("OU11 affiliate executions — legal gate enforcement", () => {
  it("gate state (a) no confirmation: issue refuses and creates nothing", async () => {
    const { svc, executions } = setup();
    await expect(svc.createAffiliatePayoutExecution("org-1", "staff-1", "partner-1", {
      amountMinor: "10000", method: "bkash", destination: BKASH_DEST,
    })).rejects.toThrow(/LEGAL REVIEW এখনো রেকর্ড করা হয়নি/);
    expect(executions).toHaveLength(0);
  });

  it("gate state (b) confirmation recorded but switch OFF: issue, confirm and fail all refuse", async () => {
    const { svc, gateRows, executions, payouts } = setup();
    gateRows.push({
      id: "gate-1", scope: "platform",
      legalConfirmedById: "super-1", legalConfirmedAt: new Date(),
      legalReference: "Memo LR-1", legalNote: null,
      automationEnabled: false, automationEnabledById: null, automationEnabledAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    await expect(svc.createAffiliatePayoutExecution("org-1", "staff-1", "partner-1", {
      amountMinor: "10000", method: "bkash", destination: BKASH_DEST,
    })).rejects.toThrow(/automation switch OFF/);
    // Confirm/fail check the gate BEFORE the execution lookup —
    // even a nonexistent execution id gets the gate refusal.
    await expect(svc.confirmAffiliatePayoutExecution("org-1", "staff-1", "exec-x", { bankReference: "R1" }))
      .rejects.toThrow(/automation switch OFF/);
    await expect(svc.failAffiliatePayoutExecution("org-1", "staff-1", "exec-x", { reason: "x" }))
      .rejects.toThrow(/automation switch OFF/);
    expect(executions).toHaveLength(0);
    expect(payouts).toHaveLength(0);
  });

  it("manual EC32 recordPayout is NOT gated", async () => {
    const { svc, payouts } = setup();
    const out: any = await svc.recordPayout("org-1", "staff-1", "partner-1", {
      amountMinor: "10000", method: "cash",
    } as any);
    expect(out.payout.amountMinor).toBe("10000");
    expect(payouts).toHaveLength(1);
  });
});

describe("OU11 affiliate executions — the rail", () => {
  it("only APPROVED outstanding is executable: pending commission never counts; open instructions reserve", async () => {
    const { svc, gateRows } = setup();
    await openGate(gateRows);
    // Outstanding approved = 50000 (the 99999 entry is pending).
    await expect(svc.createAffiliatePayoutExecution("org-1", "staff-1", "partner-1", {
      amountMinor: "50001", method: "bkash", destination: BKASH_DEST,
    })).rejects.toThrow(/executable বকেয়ার/);
    const first: any = await svc.createAffiliatePayoutExecution("org-1", "staff-1", "partner-1", {
      amountMinor: "40000", method: "bkash", destination: BKASH_DEST,
    });
    expect(first.status).toBe("instruction_issued");
    expect(first.rail).toBe("bank_instruction");
    expect(first.instructionRef).toMatch(/^BANK-/);
    // 40000 is now reserved — only 10000 remains executable.
    await expect(svc.createAffiliatePayoutExecution("org-1", "staff-1", "partner-1", {
      amountMinor: "10001", method: "bkash", destination: BKASH_DEST,
    })).rejects.toThrow(/executable বকেয়ার/);
    const second: any = await svc.createAffiliatePayoutExecution("org-1", "staff-1", "partner-1", {
      amountMinor: "10000", method: "bkash", destination: BKASH_DEST,
    });
    expect(second.status).toBe("instruction_issued");
  });

  it("destination contract: bkash needs a number, bank needs account + bank name", async () => {
    const { svc, gateRows } = setup();
    await openGate(gateRows);
    await expect(svc.createAffiliatePayoutExecution("org-1", "staff-1", "partner-1", {
      amountMinor: "1000", method: "bkash", destination: {},
    })).rejects.toThrow(/নম্বর/);
    await expect(svc.createAffiliatePayoutExecution("org-1", "staff-1", "partner-1", {
      amountMinor: "1000", method: "bank", destination: { accountNumber: "123" },
    })).rejects.toThrow(/অ্যাকাউন্ট নম্বর ও ব্যাংকের নাম/);
  });

  it("confirmation creates exactly ONE AffiliatePayout + the FIFO flip; duplicate confirm creates nothing", async () => {
    const { svc, gateRows, entries, payouts } = setup();
    await openGate(gateRows);
    const exec: any = await svc.createAffiliatePayoutExecution("org-1", "staff-1", "partner-1", {
      amountMinor: "40000", method: "bkash", destination: BKASH_DEST,
    });
    await expect(svc.confirmAffiliatePayoutExecution("org-1", "staff-1", exec.id, { bankReference: " " }))
      .rejects.toThrow(/bankReference/);
    const done: any = await svc.confirmAffiliatePayoutExecution("org-1", "staff-1", exec.id, { bankReference: "BKTRX-77" });
    expect(done.execution.status).toBe("confirmed");
    expect(done.execution.bankReference).toBe("BKTRX-77");
    expect(done.payout.reference).toBe("BKTRX-77");
    expect(done.payout.amountMinor).toBe("40000");
    expect(payouts).toHaveLength(1);
    // FIFO: 30000 entry fully covered → paid; 20000 entry
    // partially covered (pool 40000 < cumulative 50000) → stays
    // approved; the pending entry never flips.
    expect(entries.find((e) => e.id === "entry-1")!.status).toBe("paid");
    expect(entries.find((e) => e.id === "entry-2")!.status).toBe("approved");
    expect(entries.find((e) => e.id === "entry-3")!.status).toBe("pending");
    expect(done.balances.outstandingApprovedMinor).toBe("10000");
    // Duplicate confirmation: same payout returned, nothing new.
    const again: any = await svc.confirmAffiliatePayoutExecution("org-1", "staff-1", exec.id, { bankReference: "BKTRX-77" });
    expect(again.alreadyConfirmed).toBe(true);
    expect(again.payout.id).toBe(done.payout.id);
    expect(payouts).toHaveLength(1);
    expect(entries.filter((e) => e.status === "paid")).toHaveLength(1);
  });

  it("failed execution: reason recorded, no payout, no flip, outstanding fully retryable", async () => {
    const { svc, gateRows, entries, payouts } = setup();
    await openGate(gateRows);
    const exec: any = await svc.createAffiliatePayoutExecution("org-1", "staff-1", "partner-1", {
      amountMinor: "20000", method: "bank",
      destination: { accountNumber: "998877", bankName: "DBBL" },
    });
    const failed: any = await svc.failAffiliatePayoutExecution("org-1", "staff-1", exec.id, { reason: "Bank rejected: wrong account" });
    expect(failed.status).toBe("failed");
    expect(failed.failureReason).toBe("Bank rejected: wrong account");
    expect(payouts).toHaveLength(0);
    expect(entries.every((e) => e.status !== "paid")).toBe(true);
    // Failed executions free their reservation: the full 50000
    // is executable again, and a fresh instruction can complete.
    await expect(svc.confirmAffiliatePayoutExecution("org-1", "staff-1", exec.id, { bankReference: "R9" }))
      .rejects.toThrow(/confirm করা যাবে না/);
    const retry: any = await svc.createAffiliatePayoutExecution("org-1", "staff-1", "partner-1", {
      amountMinor: "50000", method: "bank",
      destination: { accountNumber: "998877", bankName: "DBBL" },
    });
    const done: any = await svc.confirmAffiliatePayoutExecution("org-1", "staff-1", retry.id, { bankReference: "R10" });
    expect(done.payout.amountMinor).toBe("50000");
    expect(done.balances.outstandingApprovedMinor).toBe("0");
    // A confirmed execution cannot be failed afterwards.
    await expect(svc.failAffiliatePayoutExecution("org-1", "staff-1", retry.id, { reason: "too late" }))
      .rejects.toThrow(/failed করা যাবে না/);
  });

  it("confirm re-validates outstanding: a manual payout consuming it first leaves the execution open + retryable", async () => {
    const { svc, gateRows, payouts } = setup();
    await openGate(gateRows);
    const exec: any = await svc.createAffiliatePayoutExecution("org-1", "staff-1", "partner-1", {
      amountMinor: "40000", method: "bkash", destination: BKASH_DEST,
    });
    // The merchant pays 30000 by hand in the meantime (EC32).
    await svc.recordPayout("org-1", "staff-1", "partner-1", { amountMinor: "30000", method: "cash" } as any);
    // Outstanding is now 20000 < the execution's 40000.
    await expect(svc.confirmAffiliatePayoutExecution("org-1", "staff-1", exec.id, { bankReference: "R1" }))
      .rejects.toThrow(/confirm করা যাবে না/);
    expect(payouts).toHaveLength(1); // only the manual one
    const list: any = await svc.listAffiliatePayoutExecutions("org-1", "partner-1");
    expect(list.items[0].status).toBe("instruction_issued"); // still open, truthful
  });
});
