process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "test-secret-cc25";

import { SettlementsService } from "./settlements.service";

/**
 * CC25 — settlement reconciliation (CSV import). Pinned rules:
 * - headers decide the shape (SSLCommerz: Tran ID; bKash: TrxID;
 *   column order tolerated); a file matching NEITHER shape is
 *   rejected and stores NOTHING (no silent zero-row import);
 * - matching is by gateway reference + exact amount against
 *   verified_paid transactions of the same org/provider/source;
 * - verdicts: matched | amount_mismatch | missing_in_system |
 *   duplicate (the SECOND occurrence of a ref in one file);
 * - "missing in report" is COMPUTED on read (system payments
 *   the file never mentions), never stored;
 * - rows that cannot be parsed into ref + positive amount are
 *   counted as skipped, never guessed.
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

function build() {
  const tables: any = {
    settlementImport: makeTable("simp"),
    settlementRow: makeTable("srow"),
    tenantPaymentTransaction: makeTable("txn"),
  };
  tables.$transaction = async (fn: any) => fn(tables);
  const auditLogs: any[] = [];
  const audit = { log: async (entry: any) => { auditLogs.push(entry); } } as any;
  const settlements = new SettlementsService(tables as any, audit);
  return { tables, auditLogs, settlements };
}

function paidTxn(b: any, overrides: any = {}) {
  const txn = {
    id: `txn-${b.tables.tenantPaymentTransaction.rows.length + 1}`,
    organizationId: "org-1", provider: "sslcommerz", source: "own", environment: "live",
    status: "verified_paid", amountMinor: 100000n, currency: "BDT",
    providerTxnId: "TP100", valId: "VAL100", orderId: "order-1",
    ipnPayload: { validation: { bank_tran_id: "BANK100" } },
    createdAt: new Date("2026-10-05T10:00:00Z"),
    ...overrides,
  };
  b.tables.tenantPaymentTransaction.rows.push(txn);
  return txn;
}

const SSL_CSV = [
  "Store ID,Tran Date,Tran ID,Val ID,Bank Tran ID,Amount,Currency,Status",
  "mystore,2026-10-05,TP100,VAL100,BANK100,1000.00,BDT,VALID",
  "mystore,2026-10-06,TP200,VAL200,BANK200,500.00,BDT,VALID", // unknown to the system
  "mystore,2026-10-07,TP100,VAL100,BANK100,1000.00,BDT,VALID", // duplicate of row 1
].join("\n");

describe("CC25 settlement reconciliation", () => {
  it("matches SSLCommerz rows by tran_id + amount; unknown ref and duplicate get their verdicts", async () => {
    const b = build();
    paidTxn(b);
    const imp: any = await b.settlements.importSettlement("org-1", "owner-1", {
      provider: "sslcommerz", source: "own", periodLabel: "October 2026", fileName: "ssl-oct.csv", csv: SSL_CSV,
    });
    expect(imp.rowCount).toBe(3);
    expect(imp.matchedCount).toBe(1);
    expect(imp.skippedCount).toBe(0);
    const detail: any = await b.settlements.getImport("org-1", imp.id);
    expect(detail.counts).toEqual({ matched: 1, amount_mismatch: 0, missing_in_system: 1, duplicate: 1, missing_in_report: 0 });
    expect(detail.matched[0].matchedTransactionId).toBe("txn-1");
    expect(detail.missingInSystem[0].externalRef).toBe("TP200");
    expect(detail.duplicates[0].matchedTransactionId).toBe("txn-1");
  });

  it("an amount that differs is amount_mismatch (with the real transaction id), never matched", async () => {
    const b = build();
    paidTxn(b);
    const csv = ["Tran ID,Amount,Currency,Status", "TP100,999.00,BDT,VALID"].join("\n");
    const imp: any = await b.settlements.importSettlement("org-1", "owner-1", {
      provider: "sslcommerz", source: "own", periodLabel: "Oct", fileName: "x.csv", csv,
    });
    expect(imp.matchedCount).toBe(0);
    const detail: any = await b.settlements.getImport("org-1", imp.id);
    expect(detail.amountMismatch.length).toBe(1);
    expect(detail.amountMismatch[0].matchedTransactionId).toBe("txn-1");
    expect(detail.amountMismatch[0].amountMinor).toBe("99900");
  });

  it("missing_in_report: verified system payments the file never mentions — computed, period-bounded when given", async () => {
    const b = build();
    paidTxn(b); // TP100, 2026-10-05
    paidTxn(b, { providerTxnId: "TP300", valId: "VAL300", orderId: "order-3", createdAt: new Date("2026-10-20T10:00:00Z") }); // TP300
    const csv = ["Tran ID,Amount", "TP100,1000.00"].join("\n");
    const imp: any = await b.settlements.importSettlement("org-1", "owner-1", {
      provider: "sslcommerz", source: "own", periodLabel: "Oct 1-10", fileName: "x.csv", csv,
      periodFrom: "2026-10-01", periodTo: "2026-10-10",
    });
    const detail: any = await b.settlements.getImport("org-1", imp.id);
    // TP300 was paid Oct 20 — OUTSIDE the stated period, so it is not "missing" for THIS import.
    expect(detail.counts.missing_in_report).toBe(0);
    // Without a period, everything unmentioned counts.
    const imp2: any = await b.settlements.importSettlement("org-1", "owner-1", {
      provider: "sslcommerz", source: "own", periodLabel: "All", fileName: "y.csv", csv,
    });
    const detail2: any = await b.settlements.getImport("org-1", imp2.id);
    expect(detail2.counts.missing_in_report).toBe(1);
    expect(detail2.missingInReport[0].providerTxnId).toBe("TP300");
    expect(detail2.missingInReport[0].transactionId).toBeTruthy();
  });

  it("matches bKash rows by the trxID recorded in the payment evidence", async () => {
    const b = build();
    paidTxn(b, {
      provider: "bkash", providerTxnId: "PAYID9", valId: null,
      ipnPayload: { executeOrQuery: { trxID: "BKTRX9", transactionStatus: "Completed" } },
    });
    const csv = ["Date,TrxID,Amount,Status", "2026-10-05,BKTRX9,1000.00,Completed"].join("\n");
    const imp: any = await b.settlements.importSettlement("org-1", "owner-1", {
      provider: "bkash", source: "own", periodLabel: "Oct", fileName: "bkash.csv", csv,
    });
    expect(imp.matchedCount).toBe(1);
    const detail: any = await b.settlements.getImport("org-1", imp.id);
    expect(detail.matched[0].externalRef).toBe("BKTRX9");
  });

  it("rejects a file whose headers match NEITHER shape — and stores nothing", async () => {
    const b = build();
    paidTxn(b);
    const csv = ["Foo,Bar,Baz", "1,2,3"].join("\n");
    await expect(b.settlements.importSettlement("org-1", "owner-1", {
      provider: "sslcommerz", source: "own", periodLabel: "Oct", fileName: "bad.csv", csv,
    })).rejects.toThrow(/মিলছে না/);
    expect(b.tables.settlementImport.rows.length).toBe(0);
    expect(b.tables.settlementRow.rows.length).toBe(0);
  });

  it("rejects a file whose shape contradicts the declared provider", async () => {
    const b = build();
    const csv = ["TrxID,Amount", "BK1,10.00"].join("\n");
    await expect(b.settlements.importSettlement("org-1", "owner-1", {
      provider: "sslcommerz", source: "own", periodLabel: "Oct", fileName: "bad.csv", csv,
    })).rejects.toThrow(/bKash statement/);
    expect(b.tables.settlementImport.rows.length).toBe(0);
  });

  it("unparseable rows are counted as skipped, never guessed; column order is tolerated", async () => {
    const b = build();
    paidTxn(b);
    const csv = [
      "Amount,Status,Tran ID", // shuffled columns
      "1000.00,VALID,TP100", // matched
      "not-a-number,VALID,TPX", // unparseable amount → skipped
      ",VALID,", // no ref → skipped
    ].join("\n");
    const imp: any = await b.settlements.importSettlement("org-1", "owner-1", {
      provider: "sslcommerz", source: "own", periodLabel: "Oct", fileName: "x.csv", csv,
    });
    expect(imp.rowCount).toBe(1);
    expect(imp.skippedCount).toBe(2);
    expect(imp.matchedCount).toBe(1);
  });

  it("only verified_paid transactions of the SAME source can match", async () => {
    const b = build();
    paidTxn(b, { source: "platform" }); // same ref, but platform-source
    paidTxn(b, { providerTxnId: "TPX", status: "initiated" });
    const csv = ["Tran ID,Amount", "TP100,1000.00", "TPX,1000.00"].join("\n");
    const imp: any = await b.settlements.importSettlement("org-1", "owner-1", {
      provider: "sslcommerz", source: "own", periodLabel: "Oct", fileName: "x.csv", csv,
    });
    expect(imp.matchedCount).toBe(0);
    const detail: any = await b.settlements.getImport("org-1", imp.id);
    expect(detail.counts.missing_in_system).toBe(2);
  });
});
