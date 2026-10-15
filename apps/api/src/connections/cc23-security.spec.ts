process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "<MASKED_SECRET_001>";

import { createHash } from "node:crypto";
import { ForbiddenException } from "@nestjs/common";
import { StepUpService } from "./step-up.service";
import { TenantPaymentsService } from "./tenant-payments.service";
import { WalletService } from "./wallet.service";
import { ConnectionMonitorService, countIpnAnomalies, DEFAULT_ALERT_PREFERENCES } from "./connection-monitor.service";
import { encryptJson } from "../integrations/crypto";
import { generateTotpSecret, totp } from "../common/totp";
import { setPlatformConfigSnapshot } from "../common/platform-config";

/**
 * CC23 — security step-up, four-eyes payouts, IPN anomalies.
 * Pinned:
 * - step-up uses the M35 state + verifier: TOTP-enabled user
 *   MUST present a valid code for gateway disable/delete,
 *   app-config delete (service-level) and payout create;
 *   missing/invalid = 403 and NOTHING changes;
 * - a user WITHOUT TOTP proceeds, but the response carries
 *   stepUpUnavailable — never a silent pretence;
 * - re-ENABLING a gateway needs no step-up;
 * - four-eyes: with walletConfig.payoutFourEyesThresholdMinor
 *   set, the approving admin cannot mark-paid at/above the
 *   threshold; a second admin can; below-threshold and
 *   feature-off paths are unchanged; pre-CC23 rows (no
 *   recorded approver) are not blocked;
 * - approve persists approvedById;
 * - rejected IPNs are recorded on the transaction
 *   (signature_invalid / amount_mismatch) and change nothing
 *   else; a verified IPN records NO anomaly event;
 * - >= 3 anomaly events in 24h fire exactly ONE alert per org
 *   per day (recorded dedupe state); 2 do not; old events and
 *   verified traffic never count.
 */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in v) return v.in.includes(row[k]);
      if ("gte" in v) return new Date(row[k]).getTime() >= new Date(v.gte).getTime();
      if ("not" in v) return row[k] !== v.not;
      return true;
    }
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  const applyOrderTake = (list: any[], args: any) => {
    let out = [...list];
    const orderBy = args?.orderBy;
    if (orderBy) {
      const [key, dir] = Object.entries(orderBy)[0] as [string, string];
      out.sort((a, b) => {
        const av = new Date(a[key]).getTime(), bv = new Date(b[key]).getTime();
        return dir === "desc" ? bv - av : av - bv;
      });
    }
    if (typeof args?.take === "number") out = out.slice(0, args.take);
    return out;
  };
  return {
    rows,
    findFirst: async (args: any = {}) => applyOrderTake(rows.filter((r) => matches(r, args.where ?? {})), args)[0] ?? null,
    findMany: async (args: any = {}) => applyOrderTake(rows.filter((r) => matches(r, args.where ?? {})), args),
    findUnique: async (args: any) => rows.filter((r) => matches(r, args.where ?? {}))[0] ?? null,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
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
  };
}

const SECRET = generateTotpSecret();
const validCode = () => totp(SECRET);
function wrongCode(): string {
  const now = Date.now();
  const valid = new Set([0, -1, 1].map((d) => totp(SECRET, new Date(now + d * 30_000))));
  let candidate = "000000";
  while (valid.has(candidate)) candidate = String(Number(candidate) + 1).padStart(6, "0");
  return candidate;
}

function baseTables() {
  return {
    user: makeTable("user"), tenantPaymentGateway: makeTable("gw"),
    tenantPaymentTransaction: makeTable("txn"), order: makeTable("order"),
    organization: makeTable("org"), walletAccount: makeTable("wallet"),
    walletTransaction: makeTable("ledger"), payoutRequest: makeTable("payout"),
    connectionAlert: makeTable("alert"), connectionAlertState: makeTable("astate"),
    membership: makeTable("member"), agentNotification: makeTable("notif"),
    auditLog: makeTable("audit"),
  };
}

const auditStub: any = { log: async () => undefined };

async function seedTotpUser(tables: any, id = "owner-1") {
  await tables.user.create({ data: { id, email: `${id}@example.com`, totpEnabled: true, totpSecretEncrypted: encryptJson({ secret: SECRET }) } });
}
async function seedPlainUser(tables: any, id = "plain-1") {
  await tables.user.create({ data: { id, email: `${id}@example.com`, totpEnabled: false, totpSecretEncrypted: null } });
}

function gatewayStub(overrides: any = {}) {
  return {
    bkashGrantToken: async () => "token-1",
    bkashCreatePayment: async () => ({}),
    bkashExecutePayment: async () => ({}),
    bkashQueryPayment: async () => ({}),
    sslInitSession: async () => ({}),
    sslValidate: async () => ({ status: "VALID", tran_id: "TRAN1", amount: "100.00", currency: "BDT", store_id: "store1" }),
    ...overrides,
  };
}

describe("CC23 StepUpService (M35 verifier reuse)", () => {
  it("not_enabled when the user has no TOTP — and no code is demanded", async () => {
    const tables = baseTables();
    await seedPlainUser(tables);
    const svc = new StepUpService(tables as any);
    await expect(svc.check("plain-1")).resolves.toBe("not_enabled");
    await expect(svc.check("plain-1", "123456")).resolves.toBe("not_enabled");
  });

  it("requires a valid code when TOTP is enabled: missing/invalid = 403, valid = verified", async () => {
    const tables = baseTables();
    await seedTotpUser(tables);
    const svc = new StepUpService(tables as any);
    await expect(svc.check("owner-1")).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.check("owner-1", wrongCode())).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.check("owner-1", validCode())).resolves.toBe("verified");
  });
});

describe("CC23 step-up on tenant gateway disable/delete", () => {
  async function setup() {
    const tables = baseTables();
    await seedTotpUser(tables);
    await seedPlainUser(tables);
    const gw = await tables.tenantPaymentGateway.create({
      data: {
        organizationId: "org-1", provider: "sslcommerz", environment: "live",
        encryptedData: encryptJson({ storeId: "store1", storePass: "pass1", sandbox: false }),
        status: "configured", isEnabled: true,
      },
    });
    const svc = new TenantPaymentsService(tables as any, auditStub, gatewayStub() as any, undefined, new StepUpService(tables as any));
    return { tables, svc, gw };
  }

  it("disable without a code is refused for a TOTP user and changes nothing", async () => {
    const { tables, svc } = await setup();
    await expect(svc.setGatewayEnabled("org-1", "owner-1", "sslcommerz", false, "live")).rejects.toBeInstanceOf(ForbiddenException);
    expect(tables.tenantPaymentGateway.rows[0].isEnabled).toBe(true);
  });

  it("disable with a valid code works and carries no stepUpUnavailable marker", async () => {
    const { svc } = await setup();
    const out: any = await svc.setGatewayEnabled("org-1", "owner-1", "sslcommerz", false, "live", validCode());
    expect(out.isEnabled).toBe(false);
    expect(out.stepUpUnavailable).toBeUndefined();
  });

  it("a user without TOTP can disable, but the response honestly says step-up was unavailable", async () => {
    const { svc } = await setup();
    const out: any = await svc.setGatewayEnabled("org-1", "plain-1", "sslcommerz", false, "live");
    expect(out.isEnabled).toBe(false);
    expect(out.stepUpUnavailable).toBe(true);
  });

  it("re-enabling needs no step-up even for a TOTP user", async () => {
    const { tables, svc } = await setup();
    tables.tenantPaymentGateway.rows[0].isEnabled = false;
    const out: any = await svc.setGatewayEnabled("org-1", "owner-1", "sslcommerz", true, "live");
    expect(out.isEnabled).toBe(true);
    expect(out.stepUpUnavailable).toBeUndefined();
  });

  it("delete without a code is refused; with a code it deletes", async () => {
    const { tables, svc } = await setup();
    await expect(svc.deleteGateway("org-1", "owner-1", "sslcommerz", "live")).rejects.toBeInstanceOf(ForbiddenException);
    expect(tables.tenantPaymentGateway.rows).toHaveLength(1);
    const out: any = await svc.deleteGateway("org-1", "owner-1", "sslcommerz", "live", validCode());
    expect(out.deleted).toBe(true);
    expect(tables.tenantPaymentGateway.rows).toHaveLength(0);
  });
});

describe("CC23 step-up on payout create + four-eyes mark-paid", () => {
  function snapshot(threshold: number | null) {
    setPlatformConfigSnapshot({
      llm: null, metaApp: null, smtp: null, sms: null, sslcommerz: null, bkash: null,
      wallet: { feeBps: 0, payoutFourEyesThresholdMinor: threshold },
      loadedAt: Date.now(),
    } as any);
  }

  async function setupWallet(balance = 100000n) {
    const tables = baseTables();
    await seedTotpUser(tables);
    await seedPlainUser(tables);
    const wallet = await tables.walletAccount.create({
      data: { organizationId: "org-1", currency: "BDT", balanceMinor: balance },
    });
    const svc = new WalletService(tables as any, auditStub, new StepUpService(tables as any));
    return { tables, svc, wallet };
  }

  it("payout create: TOTP user without a code creates NOTHING; with a code it succeeds", async () => {
    snapshot(null);
    const { tables, svc, wallet } = await setupWallet();
    const dto = { amountMinor: "5000", method: "bkash", destination: { number: "01700000000" } };
    await expect(svc.createPayoutRequest("org-1", "owner-1", dto)).rejects.toBeInstanceOf(ForbiddenException);
    expect(tables.payoutRequest.rows).toHaveLength(0);
    const created: any = await svc.createPayoutRequest("org-1", "owner-1", { ...dto, totpCode: validCode() });
    expect(created.status).toBe("pending");
    expect(created.walletId ?? wallet.id).toBeTruthy();
    expect(created.stepUpUnavailable).toBeUndefined();
    const plain: any = await svc.createPayoutRequest("org-1", "plain-1", { amountMinor: "1000", method: "bkash", destination: { number: "01700000000" } });
    expect(plain.stepUpUnavailable).toBe(true);
  });

  it("four-eyes: approver cannot mark-paid at/above threshold; a second admin can; approver is persisted", async () => {
    snapshot(50000);
    const { tables, svc, wallet } = await setupWallet();
    const req = await tables.payoutRequest.create({
      data: { organizationId: "org-1", walletId: wallet.id, amountMinor: 60000n, method: "bkash", destination: { number: "017" }, status: "pending", requestedById: "owner-1" },
    });
    const approved: any = await svc.adminDecidePayout({ id: "admin-a" }, req.id, "approve");
    expect(approved.status).toBe("approved");
    expect(approved.approvedById).toBe("admin-a");
    await expect(svc.adminMarkPaid({ id: "admin-a" }, req.id, "REF-1")).rejects.toThrow(/চার-চোখের নিয়ম/);
    expect(tables.payoutRequest.rows[0].status).toBe("approved");
    expect(tables.walletTransaction.rows).toHaveLength(0);
    const paid: any = await svc.adminMarkPaid({ id: "admin-b" }, req.id, "REF-1");
    expect(paid.status).toBe("paid");
    const debits = tables.walletTransaction.rows.filter((r: any) => r.type === "payout_debit");
    expect(debits).toHaveLength(1);
    expect(String(debits[0].amountMinor)).toBe("-60000");
    expect(String(tables.walletAccount.rows[0].balanceMinor)).toBe("40000");
  });

  it("four-eyes does not block below the threshold, nor when the feature is off", async () => {
    snapshot(50000);
    const below = await setupWallet();
    const reqBelow = await below.tables.payoutRequest.create({
      data: { organizationId: "org-1", walletId: below.wallet.id, amountMinor: 40000n, method: "bkash", destination: { number: "017" }, status: "pending", requestedById: "owner-1" },
    });
    await below.svc.adminDecidePayout({ id: "admin-a" }, reqBelow.id, "approve");
    await expect(below.svc.adminMarkPaid({ id: "admin-a" }, reqBelow.id, "REF-2")).resolves.toMatchObject({ status: "paid" });

    snapshot(null); // feature off
    const off = await setupWallet();
    const reqOff = await off.tables.payoutRequest.create({
      data: { organizationId: "org-1", walletId: off.wallet.id, amountMinor: 90000n, method: "bkash", destination: { number: "017" }, status: "pending", requestedById: "owner-1" },
    });
    await off.svc.adminDecidePayout({ id: "admin-a" }, reqOff.id, "approve");
    await expect(off.svc.adminMarkPaid({ id: "admin-a" }, reqOff.id, "REF-3")).resolves.toMatchObject({ status: "paid" });
  });

  it("a pre-CC23 approved row (no recorded approver) is not blocked by four-eyes", async () => {
    snapshot(50000);
    const { tables, svc, wallet } = await setupWallet();
    await tables.payoutRequest.create({
      data: { organizationId: "org-1", walletId: wallet.id, amountMinor: 90000n, method: "bkash", destination: { number: "017" }, status: "approved", requestedById: "owner-1", approvedById: null, decidedById: "admin-a" },
    });
    const row = tables.payoutRequest.rows[0];
    await expect(svc.adminMarkPaid({ id: "admin-a" }, row.id, "REF-4")).resolves.toMatchObject({ status: "paid" });
  });
});

describe("CC23 rejected-IPN recording + anomaly alerts", () => {
  function signFor(storePass: string, body: Record<string, any>): string {
    const fields = String(body.verify_key).split(",").map((s) => s.trim()).filter(Boolean);
    let acc = createHash("md5").update(storePass).digest("hex");
    for (const f of fields) acc += String(body[f] ?? "");
    return createHash("md5").update(acc).digest("hex");
  }

  async function setupIpn(validateImpl?: () => any) {
    const tables = baseTables();
    const gw = await tables.tenantPaymentGateway.create({
      data: {
        organizationId: "org-1", provider: "sslcommerz", environment: "live",
        encryptedData: encryptJson({ storeId: "store1", storePass: "pass1", sandbox: false }),
        status: "configured", isEnabled: true,
      },
    });
    await tables.order.create({ data: { id: "order-1", organizationId: "org-1", totalMinor: 10000n, currency: "BDT", internalNote: "" } });
    const txn = await tables.tenantPaymentTransaction.create({
      data: {
        organizationId: "org-1", gatewayId: gw.id, orderId: "order-1", provider: "sslcommerz",
        source: "own", environment: "live", amountMinor: 10000n, currency: "BDT",
        status: "initiated", providerTxnId: "TRAN1", ipnEvents: null,
      },
    });
    const svc = new TenantPaymentsService(tables as any, auditStub, gatewayStub(validateImpl ? { sslValidate: validateImpl } : {}) as any);
    return { tables, svc, txn };
  }

  it("a forged-signature IPN is recorded as signature_invalid and changes nothing else", async () => {
    const { tables, svc } = await setupIpn();
    const out: any = await svc.handleSslIpn({ tran_id: "TRAN1", status: "VALID", verify_key: "amount", verify_sign: "deadbeefdeadbeefdeadbeefdeadbeef", amount: "100.00" });
    expect(out.ok).toBe(false);
    const row = tables.tenantPaymentTransaction.rows[0];
    expect(row.status).toBe("initiated");
    expect(row.ipnEvents).toHaveLength(1);
    expect(row.ipnEvents[0].kind).toBe("signature_invalid");
  });

  it("a validated amount mismatch is recorded as amount_mismatch and never pays", async () => {
    const { tables, svc } = await setupIpn(() => ({ status: "VALID", tran_id: "TRAN1", amount: "999.00", currency: "BDT", store_id: "store1" }));
    const body: Record<string, any> = { tran_id: "TRAN1", status: "VALID", val_id: "V1", amount: "999.00", verify_key: "amount,tran_id" };
    body.verify_sign = signFor("pass1", body);
    const out: any = await svc.handleSslIpn(body);
    expect(out.ok).toBe(false);
    const row = tables.tenantPaymentTransaction.rows[0];
    expect(row.status).toBe("initiated");
    expect(row.ipnEvents.map((e: any) => e.kind)).toEqual(["amount_mismatch"]);
  });

  it("a fully verified IPN pays and records NO anomaly event", async () => {
    const { tables, svc } = await setupIpn();
    const body: Record<string, any> = { tran_id: "TRAN1", status: "VALID", val_id: "V1", amount: "100.00", verify_key: "amount,tran_id" };
    body.verify_sign = signFor("pass1", body);
    const out: any = await svc.handleSslIpn(body);
    expect(out.ok).toBe(true);
    const row = tables.tenantPaymentTransaction.rows[0];
    expect(row.status).toBe("verified_paid");
    expect(row.ipnEvents ?? null).toBeNull();
  });

  function buildMonitor() {
    const tables = baseTables();
    const email: any = { send: async () => ({ providerMessageId: "m-1" }) };
    const monitor = new ConnectionMonitorService(tables as any, auditStub, {} as any, undefined, email);
    return { tables, monitor };
  }

  async function seedOwner(tables: any) {
    const owner = await tables.user.create({ data: { email: "owner@example.com", name: "Owner" } });
    const m = await tables.membership.create({ data: { organizationId: "org-1", userId: owner.id, role: "OWNER", status: "ACTIVE" } });
    m.user = owner;
  }

  function txnWithEvents(events: any[]) {
    return {
      organizationId: "org-1", provider: "sslcommerz", status: "initiated",
      amountMinor: 10000n, currency: "BDT", ipnEvents: events,
    };
  }
  const ev = (kind: string, at: Date) => ({ kind, at: at.toISOString() });

  it("countIpnAnomalies counts only the two kinds inside the window", () => {
    const now = Date.now();
    const txns = [
      txnWithEvents([ev("signature_invalid", new Date(now - 1000)), ev("amount_mismatch", new Date(now - 2000)), ev("other_kind", new Date(now - 500))]),
      txnWithEvents([ev("signature_invalid", new Date(now - 25 * 60 * 60 * 1000))]),
      { organizationId: "org-1", ipnPayload: { status: "VALID" }, ipnEvents: null },
    ];
    const { count, byKind } = countIpnAnomalies(txns as any, now - 24 * 60 * 60 * 1000);
    expect(count).toBe(2);
    expect(byKind).toEqual({ signature_invalid: 1, amount_mismatch: 1 });
  });

  it("fires exactly one alert per org per day at >= 3, none at 2", async () => {
    const { tables, monitor } = buildMonitor();
    await seedOwner(tables);
    const now = new Date();
    await tables.tenantPaymentTransaction.create({
      data: txnWithEvents([ev("signature_invalid", now), ev("signature_invalid", now), ev("amount_mismatch", now)]),
    });
    const prefs = { ...DEFAULT_ALERT_PREFERENCES, emailEnabled: false };
    const first = await monitor.checkIpnAnomalies("org-1", prefs, now);
    expect(first.count).toBe(3);
    expect(first.alerted).toBe(true);
    expect(tables.connectionAlert.rows.filter((r: any) => r.state === "ipn_anomaly")).toHaveLength(1);
    const second = await monitor.checkIpnAnomalies("org-1", prefs, now);
    expect(second.alerted).toBe(false);
    expect(tables.connectionAlert.rows.filter((r: any) => r.state === "ipn_anomaly")).toHaveLength(1);

    // A second org with only 2 events: no alert.
    await tables.tenantPaymentTransaction.create({
      data: { ...txnWithEvents([ev("signature_invalid", now), ev("amount_mismatch", now)]), organizationId: "org-2" },
    });
    const few = await monitor.checkIpnAnomalies("org-2", prefs, now);
    expect(few.count).toBe(2);
    expect(few.alerted).toBe(false);
  });
});
