process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "test-secret";

import { createHash } from "node:crypto";
import { ForbiddenException } from "@nestjs/common";
import { ConnectionsService } from "./connections.service";
import { TenantPaymentsService, redactSensitiveKeys } from "./tenant-payments.service";
import { WalletService, buildStatementCsv, buildStatementPdf, statementRange } from "./wallet.service";
import { isConnectionDenied, normalizeDeniedConnections } from "../common/permission-catalog";
import { InboxService } from "../inbox/inbox.service";
import { IntegrationsService } from "../integrations/integrations.service";
import { IntegrationsController } from "../integrations/integrations.controller";
import { EmailChannelService } from "../inbox/channels/email.service";

/**
 * CC17/CC18/CC19 (Advanced B8) — pinned rules:
 * - labels/groups: trimmed, ≤60 chars, empty clears; the member
 *   deny-list follows M72 (OWNER never denied; unknown ids
 *   refused at write time);
 * - a denied member's inbox send is refused BEFORE any message
 *   row exists; allowed members and OWNERs are unaffected;
 * - a paused integration's sync records a "sync_paused" skip
 *   and never touches the provider; the manual HTTP trigger
 *   refuses up-front; the email channel sync skips with a marker;
 * - the wallet statement's opening/entries/closing come from the
 *   ledger rows alone;
 * - IPN payloads shown to tenants have credential-shaped keys
 *   redacted by name;
 * - SANDBOX payments: a fully verified sandbox IPN records the
 *   test outcome on the txn row and moves NOTHING else — no
 *   order transition, no wallet credit. Production resolution
 *   always reads the LIVE gateway row.
 */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (k === "organizationId_provider_environment" && v && typeof v === "object") {
      return row.organizationId === v.organizationId && row.provider === v.provider && row.environment === v.environment;
    }
    if ((k === "organizationId_userId" || k === "userId_organizationId") && v && typeof v === "object") {
      return row.organizationId === v.organizationId && row.userId === v.userId;
    }
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      if ("in" in v) return v.in.includes(row[k]);
      if ("notIn" in v) return !v.notIn.includes(row[k]);
      if ("gte" in v || "lt" in v || "gt" in v || "lte" in v) {
        const t = row[k] instanceof Date ? row[k].getTime() : new Date(row[k]).getTime();
        if ("gte" in v && !(t >= new Date(v.gte).getTime())) return false;
        if ("lt" in v && !(t < new Date(v.lt).getTime())) return false;
        if ("gt" in v && !(t > new Date(v.gt).getTime())) return false;
        if ("lte" in v && !(t <= new Date(v.lte).getTime())) return false;
        return true;
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
    findFirst: async ({ where, orderBy }: any = {}) => {
      let out = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "desc") out = [...out].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (orderBy?.createdAt === "asc") out = [...out].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return out[0] ?? null;
    },
    findMany: async ({ where, orderBy, take }: any = {}) => {
      let out = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "desc") out = [...out].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (orderBy?.createdAt === "asc") out = [...out].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return take ? out.slice(0, take) : out;
    },
    findUnique: async ({ where }: any) => rows.filter((r) => matches(r, where ?? {}))[0] ?? null,
    create: async ({ data }: any) => { const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (row) Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const row of rows) if (matches(row, where)) { Object.assign(row, data); count++; }
      return { count };
    },
    upsert: async ({ where, create, update }: any) => {
      const existing = rows.find((r) => matches(r, where));
      if (existing) { Object.assign(existing, update, { updatedAt: new Date() }); return existing; }
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      rows.push(row); return row;
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => matches(r, where));
      if (idx < 0) throw new Error("Record to delete does not exist.");
      return rows.splice(idx, 1)[0];
    },
    deleteMany: async () => ({ count: 0 }),
  };
}

const auditStub = () => {
  const logs: any[] = [];
  return { logs, log: async (e: any) => { logs.push(e); } } as any;
};

// ----------------------------------------------------------------
// CC17 — deny-list primitives (M72 semantics)
// ----------------------------------------------------------------
describe("CC17 deny-list primitives", () => {
  it("normalizeDeniedConnections keeps only clean string ids, deduped", () => {
    expect(normalizeDeniedConnections(["a", " a ", "", "a", 42, null, "b"])).toEqual(["a", "b"]);
    expect(normalizeDeniedConnections(null)).toEqual([]);
    expect(normalizeDeniedConnections("nope")).toEqual([]);
  });

  it("isConnectionDenied: member denied; OWNER never; missing list clean", () => {
    expect(isConnectionDenied({ role: "SUPPORT_AGENT", deniedConnections: ["int-1"] }, "int-1")).toBe(true);
    expect(isConnectionDenied({ role: "SUPPORT_AGENT", deniedConnections: ["int-1"] }, "int-2")).toBe(false);
    expect(isConnectionDenied({ role: "OWNER", deniedConnections: ["int-1"] }, "int-1")).toBe(false);
    expect(isConnectionDenied({ role: "ADMIN", deniedConnections: null }, "int-1")).toBe(false);
    expect(isConnectionDenied(null, "int-1")).toBe(false);
  });
});

// ----------------------------------------------------------------
// CC17 — account meta + member matrix (ConnectionsService)
// ----------------------------------------------------------------
function buildConnections() {
  const tables: any = {
    integration: makeTable("int"),
    socialAccount: makeTable("soc"),
    adAccount: makeTable("ad"),
    membership: makeTable("mem"),
    user: makeTable("user"),
    syncJob: makeTable("job"),
    tenantAppConfig: makeTable("appcfg"),
    store: makeTable("store"),
    businessProfile: makeTable("bp"),
    messagingSenderConfig: makeTable("sender"),
    orgLlmConfig: makeTable("llm"),
    tenantPaymentGateway: makeTable("gw"),
    platformPaymentEnablement: makeTable("ppe"),
  };
  tables.integration.rows.push(
    { id: "int-1", organizationId: "org-1", provider: "woocommerce", externalAccountId: "https://shop.example", status: "CONNECTED", label: null, groupName: null, syncPaused: false },
    { id: "int-2", organizationId: "org-1", provider: "facebook_page", externalAccountId: "page-9", status: "CONNECTED", label: null, groupName: null, syncPaused: false },
  );
  tables.socialAccount.rows.push({ id: "soc-1", organizationId: "org-1", platform: "facebook", name: "Page One", externalId: "pg1", status: "CONNECTED", label: null, groupName: null });
  tables.membership.rows.push(
    { id: "m-owner", organizationId: "org-1", userId: "u-owner", role: "OWNER", status: "ACTIVE", deniedConnections: null },
    { id: "m-agent", organizationId: "org-1", userId: "u-agent", role: "SUPPORT_AGENT", status: "ACTIVE", deniedConnections: null },
  );
  tables.user.rows.push(
    { id: "u-owner", name: "Owner", email: "owner@example.com" },
    { id: "u-agent", name: "Agent", email: "agent@example.com" },
  );
  const audit = auditStub();
  const svc = new ConnectionsService(tables as any, audit);
  return { svc, tables, audit };
}

describe("CC17 account meta + member access (ConnectionsService)", () => {
  it("setAccountMeta trims, stores and audits label + group per source", async () => {
    const { svc, tables, audit } = buildConnections();
    const view: any = await svc.setAccountMeta("org-1", "u-owner", "integration", "int-1", { label: "  মূল দোকান  ", groupName: " ঢাকা ব্রাঞ্চ " });
    expect(view).toMatchObject({ label: "মূল দোকান", groupName: "ঢাকা ব্রাঞ্চ" });
    expect(tables.integration.rows[0].label).toBe("মূল দোকান");
    expect(audit.logs.some((l: any) => l.action === "connection.meta_updated")).toBe(true);
    const cleared: any = await svc.setAccountMeta("org-1", "u-owner", "social_account", "soc-1", { label: "   " });
    expect(cleared.label).toBeNull();
  });

  it("setAccountMeta refuses >60 chars and unknown sources", async () => {
    const { svc } = buildConnections();
    await expect(svc.setAccountMeta("org-1", "u-owner", "integration", "int-1", { label: "x".repeat(61) })).rejects.toThrow(/৬০/);
    await expect(svc.setAccountMeta("org-1", "u-owner", "carrier_pigeon", "int-1", { label: "ok" })).rejects.toThrow();
  });

  it("overview carries label/groupName and prefers the label as display name", async () => {
    const { svc } = buildConnections();
    await svc.setAccountMeta("org-1", "u-owner", "integration", "int-1", { label: "মূল দোকান", groupName: "ঢাকা" });
    const overview: any = await svc.getOverview("org-1");
    const accounts = overview.categories.flatMap((c: any) => c.accounts ?? []);
    const store = accounts.find((a: any) => a.id === "int-1");
    expect(store.label).toBe("মূল দোকান");
    expect(store.groupName).toBe("ঢাকা");
    expect(store.displayName).toBe("মূল দোকান");
    const page = accounts.find((a: any) => a.id === "int-2");
    expect(page.groupName).toBeNull();
  });

  it("member matrix lists members + deniable targets; set validates ids and refuses OWNER targets", async () => {
    const { svc, tables } = buildConnections();
    const matrix: any = await svc.getMemberAccessMatrix("org-1");
    expect(matrix.members.map((m: any) => m.userId).sort()).toEqual(["u-agent", "u-owner"]);
    expect(matrix.targets.map((t: any) => t.id).sort()).toEqual(["int-1", "int-2", "soc-1"]);
    const updated: any = await svc.setMemberDeniedConnections("org-1", "u-owner", "u-agent", ["int-1", "soc-1"]);
    expect(updated.deniedConnectionIds).toEqual(["int-1", "soc-1"]);
    expect(tables.membership.rows.find((m: any) => m.userId === "u-agent").deniedConnections).toEqual(["int-1", "soc-1"]);
    await expect(svc.setMemberDeniedConnections("org-1", "u-owner", "u-agent", ["ghost-id"])).rejects.toThrow(/পাওয়া যায়নি/);
    await expect(svc.setMemberDeniedConnections("org-1", "u-owner", "u-owner", ["int-1"])).rejects.toThrow(/Owner/);
  });
});

// ----------------------------------------------------------------
// CC17 — inbox send enforcement
// ----------------------------------------------------------------
describe("CC17 inbox deny enforcement", () => {
  function buildInbox(denied: string[] | null, role = "SUPPORT_AGENT") {
    const tables: any = {
      channelConversation: makeTable("conv"),
      channelMessage: makeTable("msg"),
      membership: makeTable("mem"),
    };
    tables.channelConversation.rows.push({ id: "conv-1", organizationId: "org-1", integrationId: "int-1", channel: "messenger", status: "open" });
    tables.membership.rows.push({ id: "m-1", organizationId: "org-1", userId: "u-agent", role, status: "ACTIVE", deniedConnections: denied });
    const svc = new InboxService(tables as any, auditStub(), {} as any);
    return { svc, tables };
  }

  it("a denied member's sendReply is refused BEFORE any message row exists", async () => {
    const { svc, tables } = buildInbox(["int-1"]);
    await expect(svc.sendReply("org-1", "u-agent", "conv-1", "hello")).rejects.toBeInstanceOf(ForbiddenException);
    expect(tables.channelMessage.rows).toHaveLength(0);
  });

  it("the guard passes an allowed member and an OWNER (M72) untouched", async () => {
    const allowed = buildInbox(["int-other"]);
    await expect((allowed.svc as any).assertConnectionAccess("org-1", "u-agent", { integrationId: "int-1" })).resolves.toBeUndefined();
    const owner = buildInbox(["int-1"], "OWNER");
    await expect((owner.svc as any).assertConnectionAccess("org-1", "u-agent", { integrationId: "int-1" })).resolves.toBeUndefined();
    const noAccount = buildInbox(["int-1"]);
    await expect((noAccount.svc as any).assertConnectionAccess("org-1", "u-agent", { integrationId: null })).resolves.toBeUndefined();
  });
});

// ----------------------------------------------------------------
// CC18 — sync pause
// ----------------------------------------------------------------
describe("CC18 sync pause", () => {
  it("Woo sync on a paused integration records a sync_paused skip and never builds a client", async () => {
    const tables: any = { integration: makeTable("int"), syncJob: makeTable("job") };
    tables.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: "woocommerce", status: "CONNECTED", syncPaused: true, storeId: "store-1" });
    const svc = new IntegrationsService(tables as any, auditStub());
    const result: any = await svc.syncProducts("org-1", "u-1", "int-1");
    expect(result).toMatchObject({ skipped: true, reason: "sync_paused" });
    expect(tables.syncJob.rows).toHaveLength(1);
    expect(tables.syncJob.rows[0]).toMatchObject({ kind: "products", status: "COMPLETED", error: "sync_paused", fetched: 0 });
  });

  it("the manual HTTP trigger refuses a paused integration with a clear message", async () => {
    const integrationsStub: any = {
      getIntegration: async () => ({ id: "int-1", provider: "woocommerce", syncPaused: true }),
      syncProducts: async () => { throw new Error("must not be reached"); },
    };
    const controller = new IntegrationsController(integrationsStub, {} as any, {} as any, {} as any);
    await expect(controller.syncProducts({ userId: "u-1" } as any, "org-1", "int-1", {})).rejects.toThrow(/বিরতি \(pause\)/);
  });

  it("the scheduled email sync skips a paused mailbox with a marker, without connecting", async () => {
    const tables: any = { integration: makeTable("int") };
    tables.integration.rows.push({
      id: "int-mail", organizationId: "org-1", provider: "email", status: "CONNECTED", syncPaused: true,
      credential: { encryptedData: "irrelevant-because-paused" },
    });
    const svc = new EmailChannelService(tables as any, auditStub(), {} as any);
    const result: any = await svc.syncOrganization("org-1");
    expect(result).toMatchObject({ skipped: true, reason: "sync_paused", integrationId: "int-mail" });
  });

  it("setSyncPaused flips the flag and audits (ConnectionsService)", async () => {
    const { svc, tables, audit } = buildConnections();
    const view: any = await svc.setSyncPaused("org-1", "u-owner", "int-1", true);
    expect(view.syncPaused).toBe(true);
    expect(tables.integration.rows[0].syncPaused).toBe(true);
    expect(audit.logs.some((l: any) => l.action === "integration.sync_paused")).toBe(true);
    const history: any = await svc.listSyncHistory("org-1", "int-1", 5);
    expect(history.integrationId).toBe("int-1");
  });
});

// ----------------------------------------------------------------
// CC19 — wallet statement math
// ----------------------------------------------------------------
describe("CC19 wallet statement (ledger-derived)", () => {
  function buildWallet() {
    const tables: any = {
      walletAccount: makeTable("acct"),
      walletTransaction: makeTable("wtxn"),
      payoutRequest: makeTable("payout"),
    };
    tables.walletAccount.rows.push({ id: "acct-1", organizationId: "org-1", balanceMinor: 75000n, heldMinor: 0n, currency: "BDT" });
    const at = (iso: string) => new Date(iso);
    tables.walletTransaction.rows.push(
      { id: "w1", organizationId: "org-1", type: "payment_credit", amountMinor: 100000n, balanceAfterMinor: 100000n, refType: "tenant_payment_transaction", refId: "txn-1", note: "payment", createdAt: at("2026-01-05T10:00:00Z") },
      { id: "w2", organizationId: "org-1", type: "payout_hold", amountMinor: -30000n, balanceAfterMinor: 70000n, refType: "payout_request", refId: "po-1", note: null, createdAt: at("2026-01-10T10:00:00Z") },
      { id: "w3", organizationId: "org-1", type: "payment_credit", amountMinor: 5000n, balanceAfterMinor: 75000n, refType: "tenant_payment_transaction", refId: "txn-2", note: "payment 2", createdAt: at("2026-02-02T10:00:00Z") },
    );
    const svc = new WalletService(tables as any, auditStub());
    return { svc, tables };
  }

  it("opening = last balanceAfter before the range; closing = last inside it", async () => {
    const { svc } = buildWallet();
    const jan = await svc.getStatement("org-1", statementRange("2026-01-01", "2026-01-31"));
    expect(jan.openingMinor).toBe("0");
    expect(jan.entries.map((e: any) => e.id)).toEqual(["w1", "w2"]);
    expect(jan.closingMinor).toBe("70000");
    const feb = await svc.getStatement("org-1", statementRange("2026-02-01", "2026-02-28"));
    expect(feb.openingMinor).toBe("70000");
    expect(feb.entries.map((e: any) => e.id)).toEqual(["w3"]);
    expect(feb.closingMinor).toBe("75000");
    const empty = await svc.getStatement("org-1", statementRange("2026-03-01", "2026-03-31"));
    expect(empty.openingMinor).toBe("75000");
    expect(empty.closingMinor).toBe("75000");
    expect(empty.entries).toHaveLength(0);
  });

  it("CSV carries the exact ledger figures; PDF is a real PDF buffer", async () => {
    const { svc } = buildWallet();
    const statement = await svc.getStatement("org-1", statementRange("2026-01-01", "2026-01-31"));
    const csv = buildStatementCsv(statement);
    expect(csv).toContain("Opening Balance (minor),0");
    expect(csv).toContain("Closing Balance (minor),70000");
    expect(csv).toContain("payment_credit,100000,100000");
    const pdf = buildStatementPdf(statement);
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});

// ----------------------------------------------------------------
// CC19 — IPN redaction
// ----------------------------------------------------------------
describe("CC19 IPN payload redaction", () => {
  it("credential-shaped keys are redacted at any depth; business fields stay verbatim", () => {
    const payload = {
      tran_id: "T1", amount: "100.00", status: "VALID",
      store_passwd: "super-secret", verify_sign: "deadbeef",
      nested: { app_secret: "shh", password: "pw", keep: "yes" },
      list: [{ token: "tok", note: "fine" }],
    };
    const out: any = redactSensitiveKeys(payload);
    expect(out.store_passwd).toBe("***");
    expect(out.verify_sign).toBe("***");
    expect(out.nested.app_secret).toBe("***");
    expect(out.nested.password).toBe("***");
    expect(out.list[0].token).toBe("***");
    expect(out.amount).toBe("100.00");
    expect(out.nested.keep).toBe("yes");
    expect(out.list[0].note).toBe("fine");
    expect(JSON.stringify(out)).not.toContain("super-secret");
  });
});

// ----------------------------------------------------------------
// CC19 — gateway environments + sandbox safety
// ----------------------------------------------------------------
const SSL_LIVE = { storeId: "livestore", storePass: "live-pass-secret", sandbox: false };
const SSL_SANDBOX = { storeId: "teststore", storePass: "sandbox-pass-secret", sandbox: true };

function gatewayStub(overrides: any = {}) {
  return {
    bkashGrantToken: async () => "token-1",
    bkashCreatePayment: async () => ({ statusCode: "0000", bkashURL: "https://bkash.example/pay", paymentID: "PAY123" }),
    bkashExecutePayment: async () => ({ statusCode: "0000", transactionStatus: "Completed", amount: "100.00", currency: "BDT", trxID: "TRX1" }),
    bkashQueryPayment: async () => ({ statusCode: "0000", transactionStatus: "Completed", amount: "100.00", currency: "BDT", trxID: "TRX1" }),
    sslInitSession: async () => ({ status: "SUCCESS", GatewayPageURL: "https://ssl.example/pay", sessionkey: "SK1" }),
    sslValidate: async () => ({ status: "VALID", tran_id: "", amount: "100.00", currency: "BDT", store_id: SSL_SANDBOX.storeId }),
    ...overrides,
  };
}

function buildPayments(stub: any = gatewayStub(), wallet?: any) {
  const tables: any = {
    tenantPaymentGateway: makeTable("gw"),
    tenantPaymentTransaction: makeTable("txn"),
    order: makeTable("order"),
    organization: makeTable("org"),
    customer: makeTable("cust"),
  };
  tables.organization.rows.push({ id: "org-1", slug: "myshop", name: "My Shop" });
  tables.order.rows.push({
    id: "order-1", organizationId: "org-1", totalMinor: 10000n, currency: "BDT",
    isCod: true, paymentMethod: "cod", paymentStatus: "unpaid", internalNote: null, externalNumber: "ORD-1", isPractice: false,
  });
  const audit = auditStub();
  const svc = new TenantPaymentsService(tables as any, audit, stub, wallet);
  return { svc, tables, audit };
}

function signIpn(storePass: string, body: Record<string, any>): string {
  let acc = createHash("md5").update(storePass).digest("hex");
  for (const field of String(body.verify_key).split(",").map((s) => s.trim()).filter(Boolean)) {
    acc += String(body[field] ?? "");
  }
  return createHash("md5").update(acc).digest("hex");
}

describe("CC19 gateway environments", () => {
  it("live and sandbox credential sets coexist (sandbox set only via an explicit environment)", async () => {
    const { svc, tables } = buildPayments();
    await svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL_LIVE });
    await svc.putGateway("org-1", "owner", "sslcommerz", { storeId: SSL_SANDBOX.storeId, storePass: SSL_SANDBOX.storePass, environment: "sandbox" });
    expect(tables.tenantPaymentGateway.rows).toHaveLength(2);
    expect(tables.tenantPaymentGateway.rows.map((r: any) => r.environment).sort()).toEqual(["live", "sandbox"]);
    const list: any = await svc.listGateways("org-1");
    expect(list.gateways.map((g: any) => `${g.provider}:${g.environment}`).sort()).toEqual(["sslcommerz:live", "sslcommerz:sandbox"]);
  });

  it("CC9 semantics preserved: the sandbox checkbox alone stays on the LIVE row, as a creds flag", async () => {
    const { svc, tables } = buildPayments();
    // Exactly the CC9-era save shape: sandbox:true, no environment.
    await svc.putGateway("org-1", "owner", "sslcommerz", { storeId: "teststore", storePass: "sandbox-pass-secret", sandbox: true });
    expect(tables.tenantPaymentGateway.rows).toHaveLength(1);
    expect(tables.tenantPaymentGateway.rows[0].environment).toBe("live");
    // …and production initiation still resolves it (CC9 behaviour:
    // a tenant whose only creds are sandbox-mode creds can check
    // out with them; the initiation result says sandbox:true).
    const initiated: any = await svc.initiateOrderPayment("org-1", "order-1", "sslcommerz");
    expect(initiated.environment).toBe("live");
    expect(initiated.sandbox).toBe(true);
  });

  it("production initiation always binds the LIVE gateway row, never the sandbox one", async () => {
    const { svc, tables } = buildPayments();
    const live: any = await svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL_LIVE });
    await svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL_SANDBOX, environment: "sandbox" });
    const initiated: any = await svc.initiateOrderPayment("org-1", "order-1", "sslcommerz");
    expect(initiated.environment).toBe("live");
    const liveRow = tables.tenantPaymentGateway.rows.find((r: any) => r.environment === "live");
    expect(live.id).toBeUndefined(); // putGateway returns a secret-free VIEW (no row id) by design
    const txn = tables.tenantPaymentTransaction.rows.find((r: any) => r.id === initiated.transactionId);
    expect(txn.gatewayId).toBe(liveRow.id);
    expect(txn.environment).toBe("live");
  });

  it("test initiation requires a sandbox set and records environment=sandbox on a sentinel order", async () => {
    const { svc, tables } = buildPayments();
    await expect(svc.initiateTestPayment("org-1", "owner", "sslcommerz")).rejects.toThrow(/sandbox/);
    await svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL_SANDBOX, environment: "sandbox" });
    const test: any = await svc.initiateTestPayment("org-1", "owner", "sslcommerz");
    expect(test.test).toBe(true);
    expect(test.environment).toBe("sandbox");
    expect(test.redirectUrl).toBe("https://ssl.example/pay");
    const txn = tables.tenantPaymentTransaction.rows.find((r: any) => r.id === test.transactionId);
    expect(txn.environment).toBe("sandbox");
    expect(txn.orderId).toBe(TenantPaymentsService.SANDBOX_TEST_ORDER_ID);
  });

  it("a VERIFIED sandbox IPN records the test outcome but moves NOTHING: order untouched, wallet untouched", async () => {
    const walletCalls: any[] = [];
    const walletStub: any = { creditPlatformPayment: async (...args: any[]) => { walletCalls.push(args); return { credited: true }; } };
    const stub = gatewayStub();
    const { svc, tables } = buildPayments(stub, walletStub);
    await svc.putGateway("org-1", "owner", "sslcommerz", { ...SSL_SANDBOX, environment: "sandbox" });
    const test: any = await svc.initiateTestPayment("org-1", "owner", "sslcommerz");
    // The real validation API echoes the validated tran_id back;
    // the stub does the same once the test's tran_id exists.
    stub.sslValidate = async () => ({ status: "VALID", tran_id: test.providerTxnId, amount: "100.00", currency: "BDT", store_id: SSL_SANDBOX.storeId });
    const body: Record<string, any> = {
      tran_id: test.providerTxnId, val_id: "VAL-TEST", status: "VALID", amount: "100.00", currency: "BDT",
      verify_key: "tran_id,val_id,status,amount,currency",
    };
    body.verify_sign = signIpn(SSL_SANDBOX.storePass, body);
    const bigIntSafe = (rows: any[]) => JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    const orderBefore = bigIntSafe(tables.order.rows);
    const result: any = await svc.handleSslIpn(body);
    expect(result).toMatchObject({ ok: true, test: true });
    // The txn row itself records the verified test outcome…
    expect(tables.tenantPaymentTransaction.rows[0].status).toBe("verified_paid");
    // …but the real order is byte-identical and no wallet credit ran.
    expect(bigIntSafe(tables.order.rows)).toBe(orderBefore);
    expect(tables.order.rows[0].paymentStatus).toBe("unpaid");
    expect(walletCalls).toHaveLength(0);
  });

  it("transaction history filters by environment/status; the IPN viewer redacts secrets", async () => {
    const { svc, tables } = buildPayments();
    tables.tenantPaymentTransaction.rows.push(
      { id: "txn-live", organizationId: "org-1", gatewayId: "g1", orderId: "order-1", provider: "sslcommerz", source: "own", environment: "live", amountMinor: 10000n, currency: "BDT", status: "verified_paid", valId: "V1", providerTxnId: null, ipnPayload: { amount: "100.00", store_passwd: "never-show-this" }, createdAt: new Date() },
      { id: "txn-test", organizationId: "org-1", gatewayId: "g2", orderId: "sandbox-test", provider: "sslcommerz", source: "own", environment: "sandbox", amountMinor: 10000n, currency: "BDT", status: "initiated", valId: null, providerTxnId: null, ipnPayload: null, createdAt: new Date() },
    );
    const all: any = await svc.listTransactions("org-1", {});
    expect(all.transactions.map((t: any) => t.id).sort()).toEqual(["txn-live", "txn-test"]);
    const sandboxOnly: any = await svc.listTransactions("org-1", { environment: "sandbox" });
    expect(sandboxOnly.transactions.map((t: any) => t.id)).toEqual(["txn-test"]);
    const ipn: any = await svc.getTransactionIpn("org-1", "txn-live");
    expect(ipn.ipnPayload.amount).toBe("100.00");
    expect(ipn.ipnPayload.store_passwd).toBe("***");
    expect(JSON.stringify(ipn)).not.toContain("never-show-this");
  });
});
