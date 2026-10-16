process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "gb9-test-secret";

import { TenantPaymentsService } from "./tenant-payments.service";
import { encryptJson } from "../integrations/crypto";

/**
 * GB9 (GC23) — payment failure alerts + the order.paid bus event.
 * Pinned rules:
 * (a) a failure conclusion notifies the org's ACTIVE OWNER/ADMIN
 *     memberships EXACTLY ONCE per transaction — the
 *     failureNotifiedAt claim (conditional updateMany) means even
 *     a conclusion that runs twice alerts once;
 * (b) the alert is a "billing"-type AgentNotification naming the
 *     provider, the amount and the order reference (order NUMBER
 *     when resolvable);
 * (c) a cancelled conclusion does NOT alert;
 * (d) the verified_paid transition emits bus "order.paid" exactly
 *     once (a re-delivered confirmation is a no-op);
 * (e) notification plumbing can fail without the payment path
 *     noticing (failure isolation).
 */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in v) return v.in.includes(row[k]);
      // compound unique keys (userId_organizationId): compare fields
      const keys = Object.keys(v);
      if (keys.length && keys.every((k2) => typeof v[k2] === "string")) {
        return keys.every((k2) => row[k2] === v[k2]);
      }
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
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (row) Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const row of rows) {
        if (matches(row, where)) { Object.assign(row, data); count++; }
      }
      return { count };
    },
  };
}

const AAMAR_CREDS = { storeId: "aamar-store", signatureKey: "sig-key", sandbox: true };

function build(gatewayOverrides: any = {}) {
  const tables: any = {
    tenantPaymentGateway: makeTable("gw"),
    tenantPaymentTransaction: makeTable("txn"),
    order: makeTable("order"),
    organization: makeTable("org"),
    membership: makeTable("membership"),
    notificationPreference: makeTable("pref"),
    agentNotification: makeTable("notif"),
  };
  tables.organization.rows.push({ id: "org-1", slug: "testshop", name: "Test Shop" });
  tables.order.rows.push({
    id: "order-1", organizationId: "org-1", externalNumber: "WC-2001",
    totalMinor: 15000n, currency: "BDT", internalNote: "",
  });
  tables.tenantPaymentGateway.rows.push({
    id: "gw-1", organizationId: "org-1", provider: "aamarpay",
    encryptedData: encryptJson(AAMAR_CREDS), isEnabled: true,
    feeBps: null, feeFixedMinor: null,
  });
  tables.membership.rows.push(
    { id: "m-1", organizationId: "org-1", userId: "owner-1", role: "OWNER", status: "ACTIVE" },
    { id: "m-2", organizationId: "org-1", userId: "admin-1", role: "ADMIN", status: "ACTIVE" },
    { id: "m-3", organizationId: "org-1", userId: "viewer-1", role: "VIEWER", status: "ACTIVE" },
    { id: "m-4", organizationId: "org-1", userId: "gone-1", role: "ADMIN", status: "INVITED" },
  );
  const prisma: any = { ...tables };
  const audit = { log: jest.fn(async () => undefined) };
  const gateway = {
    aamarTrxCheck: async () => ({ pay_status: "Successful", amount: "150.00", currency: "BDT" }),
    ...gatewayOverrides,
  };
  const events = { emit: jest.fn(), on: jest.fn() };
  const svc = new TenantPaymentsService(prisma, audit as any, gateway as any, undefined, events as any);
  return { svc, tables, events };
}

async function seedTxn(tables: any, over: any = {}) {
  return tables.tenantPaymentTransaction.create({
    data: {
      id: "txn-1", organizationId: "org-1", gatewayId: "gw-1", orderId: "order-1",
      provider: "aamarpay", source: "own", amountMinor: 15000n, currency: "BDT",
      status: "initiated", providerTxnId: "TRAN-1", failureNotifiedAt: null,
      ...over,
    },
  });
}

describe("GB9 payment failure alert", () => {
  it("a fail conclusion notifies ACTIVE OWNER/ADMIN exactly once — even when the conclusion runs twice", async () => {
    const { svc, tables } = build();
    await seedTxn(tables);
    await svc.handleAamarResult("fail", { tran_id: "TRAN-1" });
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("failed");
    expect(tables.tenantPaymentTransaction.rows[0].failureNotifiedAt).toBeInstanceOf(Date);

    const notifs = tables.agentNotification.rows;
    expect(notifs).toHaveLength(2); // OWNER + ADMIN, not VIEWER / INVITED
    expect(notifs.map((n: any) => n.userId).sort()).toEqual(["admin-1", "owner-1"]);
    for (const n of notifs) {
      expect(n.type).toBe("billing");
      expect(n.title).toBe("💳 পেমেন্ট ব্যর্থ হয়েছে");
      expect(n.body).toContain("aamarpay");
      expect(n.body).toContain("150.00");
      expect(n.body).toContain("WC-2001"); // order NUMBER, not the raw id
    }

    // Running the same conclusion again changes nothing.
    await svc.handleAamarResult("fail", { tran_id: "TRAN-1" });
    expect(tables.agentNotification.rows).toHaveLength(2);
  });

  it("the claim itself dedupes: notifyPaymentFailure twice → one alert round", async () => {
    const { svc, tables } = build();
    const txn = await seedTxn(tables);
    await (svc as any).notifyPaymentFailure(txn);
    await (svc as any).notifyPaymentFailure(txn);
    await (svc as any).notifyPaymentFailure({ ...txn });
    expect(tables.agentNotification.rows).toHaveLength(2);
  });

  it("a cancel conclusion does NOT alert", async () => {
    const { svc, tables } = build();
    await seedTxn(tables);
    await svc.handleAamarResult("cancel", { tran_id: "TRAN-1" });
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("cancelled");
    expect(tables.agentNotification.rows).toHaveLength(0);
    expect(tables.tenantPaymentTransaction.rows[0].failureNotifiedAt).toBeNull();
  });

  it("notification plumbing failure never reaches the payment path", async () => {
    const { svc, tables } = build();
    await seedTxn(tables);
    tables.agentNotification.create = async () => { throw new Error("notification table down"); };
    await expect(svc.handleAamarResult("fail", { tran_id: "TRAN-1" })).resolves.toContain("payment=failed");
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("failed");
  });
});

describe("GB9 order.paid bus event", () => {
  it("a verified confirmation emits order.paid exactly once; re-delivery is a no-op", async () => {
    const { svc, tables, events } = build();
    await seedTxn(tables);
    const res1: any = await svc.handleAamarIpn({ tran_id: "TRAN-1" });
    expect(res1.ok).toBe(true);
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("verified_paid");
    const paidEmits = events.emit.mock.calls.filter((c: any[]) => c[0] === "order.paid");
    expect(paidEmits).toHaveLength(1);
    expect(paidEmits[0][1]).toEqual({
      organizationId: "org-1",
      // AB4 (AX5a): the emit context also carries the payment
      // purpose + settlement facts.
      context: {
        orderId: "order-1", transactionId: "txn-1", provider: "aamarpay", amountMinor: "15000",
        purpose: "full", fullySettled: true, orderTotalMinor: "15000",
      },
    });
    const res2: any = await svc.handleAamarIpn({ tran_id: "TRAN-1" });
    expect(res2.alreadyProcessed).toBe(true);
    expect(events.emit.mock.calls.filter((c: any[]) => c[0] === "order.paid")).toHaveLength(1);
  });
});
