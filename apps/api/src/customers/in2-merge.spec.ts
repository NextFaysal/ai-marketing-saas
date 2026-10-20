import "reflect-metadata";
import { CustomersService } from "./customers.service";
import { AuditService } from "../audit/audit.service";
import { RiskService } from "../orders/risk.service";

/**
 * IN2 — reversible customer merge.
 *
 * Pre-IN2, CustomersService.merge moved orders + conversations
 * and kept only COUNTS in the audit metadata: a merge could
 * never be undone. IN2 writes a CustomerMergeRecord (moved row
 * ids + per-field gap-fill snapshot) and unmerge() is its exact
 * inverse:
 *  - rows move back only while they still point at the survivor;
 *  - a gap-filled field is restored only while it still holds
 *    the filled value (a later human edit survives the unmerge);
 *  - the same merge can never be reverted twice;
 *  - a pre-IN2 merge (no record) is honestly refused.
 * The CX1 courier record is checked across the merge: after the
 * rows move, the survivor's decided/delivered totals are the
 * SUM of both records' histories (computed by the real
 * RiskService over the same fake rows).
 */

type Row = Record<string, any>;

function match(row: Row, where: any = {}): boolean {
  return Object.entries(where ?? {}).every(([k, raw]) => {
    const v = raw as any;
    if (k === "OR") return (v as any[]).some((sub) => match(row, sub));
    if (k === "AND") return (v as any[]).every((sub) => match(row, sub));
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return (v.in as any[]).includes(row[k]);
      if ("not" in v) return row[k] !== v.not;
      if ("contains" in v) return String(row[k] ?? "").toLowerCase().includes(String(v.contains).toLowerCase());
      return true;
    }
    return row[k] === v;
  });
}
function table(store: Row[], opts: { includeCustomerFrom?: Row[] } = {}) {
  const api: any = {
    rows: store,
    findMany: jest.fn(async ({ where, take, orderBy }: any = {}) => {
      let rows = store.filter((r) => match(r, where));
      if (orderBy?.createdAt === "desc") rows = [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (take) rows = rows.slice(0, take);
      return rows;
    }),
    findFirst: jest.fn(async ({ where }: any = {}) => store.find((r) => match(r, where)) ?? null),
    findUnique: jest.fn(async ({ where }: any = {}) => store.find((r) => match(r, where)) ?? null),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `row-${store.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      store.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = store.find((r) => r.id === where.id || match(r, where));
      if (!row) throw new Error("nf");
      Object.assign(row, data);
      return row;
    }),
  };
  if (opts.includeCustomerFrom) {
    const orig = api.findMany;
    api.findMany = jest.fn(async (args: any = {}) => {
      const rows = await orig(args);
      if (args?.include?.customer) {
        return rows.map((r: Row) => ({ ...r, customer: opts.includeCustomerFrom!.find((c) => c.id === r.customerId) ?? null }));
      }
      return rows;
    });
  }
  return api;
}

const ORG = "org-1";

function setup() {
  const customers: Row[] = [
    { id: "c-target", organizationId: ORG, firstName: "Rahim", lastName: null, phone: null, email: null, source: "woocommerce", mergedIntoId: null, customFields: null, createdAt: new Date(1) },
    { id: "c-source", organizationId: ORG, firstName: null, lastName: "Uddin", phone: "01711111111", email: "s@x.com", source: "chat", mergedIntoId: null, customFields: null, createdAt: new Date(2) },
    { id: "c-third", organizationId: ORG, firstName: "Third", lastName: null, phone: "01822222222", email: null, source: "chat", mergedIntoId: null, customFields: null, createdAt: new Date(3) },
    { id: "c-foreign", organizationId: "org-2", firstName: "Other", lastName: null, phone: null, email: null, source: "chat", mergedIntoId: null, customFields: null, createdAt: new Date(4) },
  ];
  const orders: Row[] = [
    { id: "o1", organizationId: ORG, customerId: "c-source", status: "completed", totalMinor: 100000n, subtotalMinor: 100000n, isCod: true, conversationId: "conv-2", createdAt: new Date(10) },
    { id: "o2", organizationId: ORG, customerId: "c-target", status: "completed", totalMinor: 50000n, subtotalMinor: 50000n, isCod: true, conversationId: "conv-1", createdAt: new Date(11) },
  ];
  const conversations: Row[] = [
    { id: "conv-1", organizationId: ORG, customerId: "c-target", channel: "whatsapp", contactPhone: null, createdAt: new Date(10) },
    { id: "conv-2", organizationId: ORG, customerId: "c-source", channel: "messenger", contactPhone: null, createdAt: new Date(11) },
  ];
  const shipments: Row[] = [
    { id: "sh1", organizationId: ORG, orderId: "o1", status: "delivered", provider: "steadfast", recipientPhone: "01711111111", createdAt: new Date(12), updatedAt: new Date(13) },
    { id: "sh2", organizationId: ORG, orderId: "o2", status: "returned", provider: "pathao", recipientPhone: null, createdAt: new Date(12), updatedAt: new Date(13) },
  ];
  const mergeRecords: Row[] = [];
  const auditRows: Row[] = [];
  const db: any = {
    customer: table(customers),
    order: table(orders, { includeCustomerFrom: customers }),
    channelConversation: table(conversations),
    courierShipment: table(shipments),
    customerMergeRecord: table(mergeRecords),
    auditLog: table(auditRows),
    lead: table([]),
  };
  const audit = new AuditService(db as any);
  const risk = new RiskService(db as any);
  const service = new CustomersService(db as any, audit as any, risk as any);
  return { service, risk, db, customers, orders, conversations, mergeRecords, auditRows };
}

const byId = (rows: Row[], id: string): Row => {
  const r = rows.find((x) => x.id === id);
  if (!r) throw new Error(`missing row ${id}`);
  return r;
};

describe("IN2 merge — moves rows and writes the reversible record", () => {
  it("moves orders + conversations, gap-fills, marks the shell, records ids + snapshot, audits", async () => {
    const s = setup();
    await s.service.merge(ORG, "agent-1", { sourceId: "c-source", targetId: "c-target" });
    expect(byId(s.orders, "o1").customerId).toBe("c-target");
    expect(byId(s.conversations, "conv-2").customerId).toBe("c-target");
    expect(byId(s.customers, "c-source").mergedIntoId).toBe("c-target");
    // Gap fill: phone/email/lastName filled from source; firstName kept.
    const target = byId(s.customers, "c-target");
    expect(target.phone).toBe("01711111111");
    expect(target.email).toBe("s@x.com");
    expect(target.lastName).toBe("Uddin");
    expect(target.firstName).toBe("Rahim");
    // The reversible record: exact moved ids + fill snapshot.
    expect(s.mergeRecords).toHaveLength(1);
    const rec = s.mergeRecords[0];
    expect(rec.sourceCustomerId).toBe("c-source");
    expect(rec.targetCustomerId).toBe("c-target");
    expect(rec.movedOrderIds).toEqual(["o1"]);
    expect(rec.movedConversationIds).toEqual(["conv-2"]);
    expect(rec.filledFields.phone).toEqual({ before: null, filledWith: "01711111111" });
    expect(rec.filledFields.email).toEqual({ before: null, filledWith: "s@x.com" });
    expect(rec.filledFields.firstName).toBeUndefined();
    expect(s.auditRows.some((r) => r.action === "customer.merged")).toBe(true);
    // Nothing was deleted.
    expect(s.customers).toHaveLength(4);
    expect(s.orders).toHaveLength(2);
  });

  it("keeps the existing guards: same id, already-merged source, cross-org", async () => {
    const s = setup();
    await expect(s.service.merge(ORG, "a", { sourceId: "c-source", targetId: "c-source" })).rejects.toThrow();
    await expect(s.service.merge(ORG, "a", { sourceId: "c-source", targetId: "c-foreign" })).rejects.toThrow();
    await s.service.merge(ORG, "a", { sourceId: "c-source", targetId: "c-target" });
    await expect(s.service.merge(ORG, "a", { sourceId: "c-source", targetId: "c-third" })).rejects.toMatchObject({ code: "customers.sourceCustomerWasAlreadyMerged" });
  });
});

describe("IN2 courier record across a merge (CX1 sums both histories)", () => {
  it("before: survivor alone decided 1 / delivered 0; after merge: decided 2 / delivered 1 / 50%", async () => {
    const s = setup();
    const before = await s.risk.courierRecordForCustomer(ORG, "c-target");
    expect(before.decided).toBe(1);
    expect(before.delivered).toBe(0);
    expect(before.successRatePct).toBe(0);
    await s.service.merge(ORG, "agent-1", { sourceId: "c-source", targetId: "c-target" });
    const after = await s.risk.courierRecordForCustomer(ORG, "c-target");
    expect(after.decided).toBe(2);
    expect(after.delivered).toBe(1);
    expect(after.successRatePct).toBe(50);
    const per = Object.fromEntries(after.perCourier.map((b: any) => [b.provider, b]));
    expect(per.steadfast).toMatchObject({ decided: 1, delivered: 1, successRatePct: 100 });
    expect(per.pathao).toMatchObject({ decided: 1, delivered: 0, successRatePct: 0 });
    // And unmerge hands the history back.
    await s.service.unmerge(ORG, "agent-1", { sourceId: "c-source" });
    const restored = await s.risk.courierRecordForCustomer(ORG, "c-target");
    expect(restored.decided).toBe(1);
  });
});

describe("IN2 unmerge — the exact inverse", () => {
  it("restores rows, restores filled fields, clears the shell mark, marks the record, audits; twice is refused", async () => {
    const s = setup();
    await s.service.merge(ORG, "agent-1", { sourceId: "c-source", targetId: "c-target" });
    const out = await s.service.unmerge(ORG, "agent-2", { sourceId: "c-source" });
    expect(out).toMatchObject({ ordersRestored: 1, conversationsRestored: 1 });
    expect(out.fieldsRestored.sort()).toEqual(["email", "lastName", "phone"]);
    expect(byId(s.orders, "o1").customerId).toBe("c-source");
    expect(byId(s.conversations, "conv-2").customerId).toBe("c-source");
    expect(byId(s.customers, "c-source").mergedIntoId).toBeNull();
    const target = byId(s.customers, "c-target");
    expect(target.phone).toBeNull();
    expect(target.email).toBeNull();
    expect(target.lastName).toBeNull();
    expect(target.firstName).toBe("Rahim"); // never filled, never touched
    expect(s.mergeRecords[0].revertedAt).toBeTruthy();
    expect(s.mergeRecords[0].revertedByUserId).toBe("agent-2");
    expect(s.auditRows.some((r) => r.action === "customer.unmerged")).toBe(true);
    await expect(s.service.unmerge(ORG, "agent-2", { sourceId: "c-source" })).rejects.toThrow();
  });

  it("never steals a row a human re-pointed elsewhere after the merge", async () => {
    const s = setup();
    await s.service.merge(ORG, "agent-1", { sourceId: "c-source", targetId: "c-target" });
    byId(s.orders, "o1").customerId = "c-third"; // a human moved it since
    const out = await s.service.unmerge(ORG, "agent-1", { sourceId: "c-source" });
    expect(out.ordersRestored).toBe(0);
    expect(byId(s.orders, "o1").customerId).toBe("c-third");
  });

  it("never clobbers a survivor field a human edited after the merge", async () => {
    const s = setup();
    await s.service.merge(ORG, "agent-1", { sourceId: "c-source", targetId: "c-target" });
    byId(s.customers, "c-target").phone = "01999999999"; // corrected by hand
    const out = await s.service.unmerge(ORG, "agent-1", { sourceId: "c-source" });
    expect(out.fieldsRestored).not.toContain("phone");
    expect(byId(s.customers, "c-target").phone).toBe("01999999999");
    expect(byId(s.customers, "c-target").email).toBeNull(); // untouched fill still restored
  });

  it("a pre-IN2 merge (shell marked, no record) is honestly refused, not half-undone", async () => {
    const s = setup();
    byId(s.customers, "c-source").mergedIntoId = "c-target"; // legacy merge, no record
    await expect(s.service.unmerge(ORG, "agent-1", { sourceId: "c-source" })).rejects.toThrow(/merge record/);
    expect(byId(s.customers, "c-source").mergedIntoId).toBe("c-target"); // unchanged
  });
});
