process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "test-secret-cc26a";

import { WalletService } from "./wallet.service";

/**
 * CC26(a) — payout destinations + schedule + the
 * wallet_payout_sweep. Pinned rules:
 * - destinations validate per method exactly like free-form
 *   requests; the FIRST destination becomes default; list
 *   views mask account identifiers beyond the last 4 while
 *   the owner's single-read returns the stored value;
 * - a payout request made against a saved destination
 *   SNAPSHOTS its method + details (later edits never rewrite
 *   the request) and records destinationId;
 * - the sweep creates at most ONE pending request per slot
 *   (Asia/Dhaka day), for the FULL available balance, only
 *   when available ≥ threshold, respecting CC10 holds — and
 *   it NEVER approves, pays, or writes a ledger row;
 * - every skip is a named reason and creates nothing.
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

// 2026-10-15 is a Thursday; 04:00Z = 10:00 Asia/Dhaka, same day.
const THURSDAY = new Date("2026-10-15T04:00:00Z");

async function bkashDestination(w: WalletService) {
  return w.createDestination("org-1", "owner-1", {
    label: "মূল বিকাশ", method: "bkash", details: { number: "01712345678" },
  });
}

describe("CC26 destinations", () => {
  it("first destination becomes default; lists mask beyond last 4; single read is unmasked", async () => {
    const b = build();
    const d1: any = await bkashDestination(b.wallet);
    expect(d1.isDefault).toBe(true);
    expect(d1.details.number).toBe("01712345678"); // create response = owner's own view
    const d2: any = await b.wallet.createDestination("org-1", "owner-1", {
      label: "ব্যাংক", method: "bank",
      details: { accountName: "Shop", accountNumber: "1234567890123", bankName: "DBBL" },
    });
    expect(d2.isDefault).toBe(false);
    const list: any = await b.wallet.listDestinations("org-1");
    const maskedBkash = list.destinations.find((d: any) => d.id === d1.id);
    expect(maskedBkash.details.number).not.toBe("01712345678");
    expect(maskedBkash.details.number.endsWith("5678")).toBe(true);
    const maskedBank = list.destinations.find((d: any) => d.id === d2.id);
    expect(maskedBank.details.accountNumber.endsWith("0123")).toBe(true);
    expect(maskedBank.details.accountNumber).not.toContain("123456789");
    const single: any = await b.wallet.getDestination("org-1", d2.id);
    expect(single.details.accountNumber).toBe("1234567890123");
  });

  it("set-default switches exactly one; invalid details refuse", async () => {
    const b = build();
    const d1: any = await bkashDestination(b.wallet);
    const d2: any = await b.wallet.createDestination("org-1", "owner-1", {
      label: "ব্যাংক", method: "bank", details: { accountName: "S", accountNumber: "9999", bankName: "DBBL" },
    });
    await b.wallet.updateDestination("org-1", "owner-1", d2.id, { isDefault: true });
    const list: any = await b.wallet.listDestinations("org-1");
    expect(list.destinations.filter((d: any) => d.isDefault).map((d: any) => d.id)).toEqual([d2.id]);
    await expect(b.wallet.createDestination("org-1", "owner-1", {
      label: "bad", method: "bank", details: { accountName: "S" },
    })).rejects.toThrow(/অ্যাকাউন্ট নম্বর/);
    await expect(b.wallet.updateDestination("org-1", "owner-1", d1.id, {
      details: { number: "" },
    })).rejects.toThrow(/নম্বর প্রয়োজন/);
  });

  it("deleting the schedule's destination clears the schedule pointer", async () => {
    const b = build();
    const d1: any = await bkashDestination(b.wallet);
    await b.wallet.putSchedule("org-1", "owner-1", {
      enabled: true, cadence: "weekly", dayOfWeek: 4, thresholdMinor: "1000", destinationId: d1.id,
    });
    await b.wallet.deleteDestination("org-1", "owner-1", d1.id);
    const sched: any = await b.wallet.getSchedule("org-1");
    expect(sched.schedule.destinationId).toBeNull();
  });

  it("a request against a saved destination snapshots details — later edits never rewrite it", async () => {
    const b = build();
    const d1: any = await bkashDestination(b.wallet);
    const req: any = await b.wallet.createPayoutRequest("org-1", "owner-1", {
      amountMinor: "5000", destinationId: d1.id,
    });
    expect(req.method).toBe("bkash");
    expect(req.destination).toEqual({ number: "01712345678" });
    expect(req.destinationId).toBe(d1.id);
    expect(req.createdBySystem).toBe(false);
    await b.wallet.updateDestination("org-1", "owner-1", d1.id, { details: { number: "01999999999" } });
    const stored = b.tables.payoutRequest.rows.find((r: any) => r.id === req.id);
    expect(stored.destination).toEqual({ number: "01712345678" });
    // The free-form CC10 path is unchanged.
    const free: any = await b.wallet.createPayoutRequest("org-1", "owner-1", {
      amountMinor: "1000", method: "bkash", destination: { number: "01811111111" },
    });
    expect(free.destinationId).toBeNull();
    expect(free.destination).toEqual({ number: "01811111111" });
  });
});

describe("CC26 payout schedule + sweep", () => {
  it("schedule validation: weekly needs dayOfWeek, monthly needs dayOfMonth 1..28", async () => {
    const b = build();
    await expect(b.wallet.putSchedule("org-1", "owner-1", {
      enabled: true, cadence: "weekly", thresholdMinor: "0",
    })).rejects.toThrow(/dayOfWeek/);
    await expect(b.wallet.putSchedule("org-1", "owner-1", {
      enabled: true, cadence: "monthly", dayOfMonth: 29, thresholdMinor: "0",
    })).rejects.toThrow(/dayOfMonth/);
  });

  it("skips honestly: no schedule, disabled, wrong day, below threshold — creating nothing", async () => {
    const b = build();
    await bkashDestination(b.wallet);
    expect((await b.wallet.runPayoutSweep("org-1", THURSDAY)).reason).toBe("no_schedule");
    await b.wallet.putSchedule("org-1", "owner-1", {
      enabled: false, cadence: "weekly", dayOfWeek: 4, thresholdMinor: "1000",
    });
    expect((await b.wallet.runPayoutSweep("org-1", THURSDAY)).reason).toBe("schedule_disabled");
    await b.wallet.putSchedule("org-1", "owner-1", {
      enabled: true, cadence: "weekly", dayOfWeek: 5, thresholdMinor: "1000", // Friday — today is Thursday
    });
    expect((await b.wallet.runPayoutSweep("org-1", THURSDAY)).reason).toBe("not_scheduled_day");
    await b.wallet.putSchedule("org-1", "owner-1", {
      enabled: true, cadence: "weekly", dayOfWeek: 4, thresholdMinor: "200000", // balance is 100000
    });
    const below: any = await b.wallet.runPayoutSweep("org-1", THURSDAY);
    expect(below.reason).toBe("below_threshold");
    expect(b.tables.payoutRequest.rows.length).toBe(0);
  });

  it("on the slot day it creates ONE pending system request for the full available balance — never approving or paying", async () => {
    const b = build();
    const d1: any = await bkashDestination(b.wallet);
    await b.wallet.putSchedule("org-1", "owner-1", {
      enabled: true, cadence: "weekly", dayOfWeek: 4, thresholdMinor: "50000",
    });
    const out: any = await b.wallet.runPayoutSweep("org-1", THURSDAY);
    expect(out.created).toBe(true);
    expect(out.amountMinor).toBe("100000");
    const req = b.tables.payoutRequest.rows[0];
    expect(req.status).toBe("pending");
    expect(req.createdBySystem).toBe(true);
    expect(req.requestedById).toBe("system");
    expect(req.destinationId).toBe(d1.id);
    expect(req.destination).toEqual({ number: "01712345678" });
    // Nothing was approved, paid, or debited.
    expect(b.tables.walletAccount.rows[0].balanceMinor).toBe(100000n);
    expect(b.tables.walletTransaction.rows.length).toBe(0);
    // Same slot again — idempotent.
    const again: any = await b.wallet.runPayoutSweep("org-1", THURSDAY);
    expect(again.reason).toBe("already_created_for_slot");
    expect(b.tables.payoutRequest.rows.length).toBe(1);
  });

  it("holds count against availability: a pending manual request shrinks what the sweep may request", async () => {
    const b = build();
    await bkashDestination(b.wallet);
    await b.wallet.createPayoutRequest("org-1", "owner-1", {
      amountMinor: "60000", method: "bkash", destination: { number: "01811111111" },
    });
    await b.wallet.putSchedule("org-1", "owner-1", {
      enabled: true, cadence: "weekly", dayOfWeek: 4, thresholdMinor: "50000",
    });
    // Available = 100000 − 60000 held = 40000 < 50000 threshold.
    const out: any = await b.wallet.runPayoutSweep("org-1", THURSDAY);
    expect(out.reason).toBe("below_threshold");
    expect(out.availableMinor).toBe("40000");
    await b.wallet.putSchedule("org-1", "owner-1", {
      enabled: true, cadence: "weekly", dayOfWeek: 4, thresholdMinor: "30000",
    });
    const created: any = await b.wallet.runPayoutSweep("org-1", THURSDAY);
    expect(created.created).toBe(true);
    expect(created.amountMinor).toBe("40000");
  });

  it("monthly cadence fires on the Dhaka day-of-month only", async () => {
    const b = build();
    await bkashDestination(b.wallet);
    await b.wallet.putSchedule("org-1", "owner-1", {
      enabled: true, cadence: "monthly", dayOfMonth: 16, thresholdMinor: "1000",
    });
    expect((await b.wallet.runPayoutSweep("org-1", THURSDAY)).reason).toBe("not_scheduled_day"); // 15th
    await b.wallet.putSchedule("org-1", "owner-1", {
      enabled: true, cadence: "monthly", dayOfMonth: 15, thresholdMinor: "1000",
    });
    const out: any = await b.wallet.runPayoutSweep("org-1", THURSDAY);
    expect(out.created).toBe(true);
  });
});
