process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "<redacted>";

import { ConnectionsService } from "./connections.service";
import { ConnectionMonitorService, deriveFieldState, webhookSummary } from "./connection-monitor.service";
import { ConnectionTimelineService } from "./connection-timeline.service";
import { encryptJson } from "../integrations/crypto";

/**
 * CC12 — the sweep alerts on STATE CHANGES only: first breakage
 * alerts, the identical broken state never alerts twice, a new
 * error (hash change) alerts again, recovery notifies once,
 * expiry thresholds 7/3/1 each alert once. Email is counted ONLY
 * by real provider message ids. Snooze freezes a target;
 * preferences can silence a category without losing state.
 *
 * CC13 — the timeline aggregates real records only, newest
 * first, with an error filter and cursor pagination; a target
 * with no records gets an empty timeline.
 */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
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
      if (row) Object.assign(row, data);
      return row;
    },
    deleteMany: async ({ where }: any) => ({ count: rows.filter((r) => matches(r, where ?? {})).length }),
  };
}

const DAY = 24 * 60 * 60 * 1000;

function build(emailImpl?: (input: any) => Promise<any>) {
  const tables: any = {
    integration: makeTable("int"), integrationCredential: makeTable("cred"),
    socialAccount: makeTable("soc"), adAccount: makeTable("ad"), store: makeTable("store"),
    messagingSenderConfig: makeTable("sender"), businessProfile: makeTable("profile"),
    tenantAppConfig: makeTable("appcfg"), orgLlmConfig: makeTable("llm"),
    tenantPaymentGateway: makeTable("gw"), platformPaymentEnablement: makeTable("en"),
    connectionHealthCheck: makeTable("check"), connectionAlert: makeTable("alert"),
    connectionAlertState: makeTable("state"), connectionAlertPreference: makeTable("pref"),
    membership: makeTable("member"), user: makeTable("user"),
    agentNotification: makeTable("notif"), auditLog: makeTable("audit"),
    syncJob: makeTable("sync"), webhookEvent: makeTable("hook"),
    tenantPaymentTransaction: makeTable("txn"), systemSetting: makeTable("setting"),
  };
  const audit = { log: async () => undefined } as any;
  const connections = new ConnectionsService(tables as any, audit);
  const email = { send: emailImpl ?? (async () => ({ providerMessageId: "msg-1" })) } as any;
  const doctorStub: any = {
    findTarget: async (_org: string, targetType: string, targetId: string) => {
      const overview = await connections.getOverview("org-1");
      for (const c of overview.categories) {
        const a = (c.accounts ?? []).find((x: any) => x.source === targetType && x.id === targetId);
        if (a) return { targetType, targetId, provider: a.provider, category: a.category, displayName: a.displayName };
      }
      throw new Error("not found");
    },
    diagnoseTarget: async () => ({ overall: "pass", steps: [] }),
  };
  const monitor = new ConnectionMonitorService(tables as any, audit, connections, doctorStub, email);
  const timeline = new ConnectionTimelineService(tables as any);
  return { tables, connections, monitor, timeline, doctorStub };
}

async function seedOrg(tables: any) {
  const owner = await tables.user.create({ data: { email: "owner@example.com", name: "Owner" } });
  const admin = await tables.user.create({ data: { email: "admin@example.com", name: "Admin" } });
  const agent = await tables.user.create({ data: { email: "agent@example.com", name: "Agent" } });
  const m1 = await tables.membership.create({ data: { organizationId: "org-1", userId: owner.id, role: "OWNER", status: "ACTIVE" } });
  m1.user = owner;
  const m2 = await tables.membership.create({ data: { organizationId: "org-1", userId: admin.id, role: "ADMIN", status: "ACTIVE" } });
  m2.user = admin;
  const m3 = await tables.membership.create({ data: { organizationId: "org-1", userId: agent.id, role: "SUPPORT_AGENT", status: "ACTIVE" } });
  m3.user = agent;
  const integration = await tables.integration.create({
    data: { organizationId: "org-1", provider: "whatsapp", status: "CONNECTED", externalAccountId: "8801", appSource: "platform", lastError: null, tokenExpiresAt: null },
  });
  await tables.integrationCredential.create({
    data: { integrationId: integration.id, encryptedData: encryptJson({ accessToken: "tok", phoneNumberId: "8801" }) },
  });
  return { integration };
}

describe("CC12 sweep — pure state derivation", () => {
  it("webhookSummary flags failed topic statuses only from a real record", () => {
    expect(webhookSummary(null)).toEqual({ bad: false, summary: null });
    expect(webhookSummary({ provider: "woocommerce", topics: { "order.created": { status: "registered" } } }).bad).toBe(false);
    expect(webhookSummary({ provider: "woocommerce", topics: { "order.created": { status: "failed" } } }).bad).toBe(true);
  });

  it("deriveFieldState prioritises disconnected > error > expiring thresholds", () => {
    const now = new Date();
    const extras = { syncStreak: 0, webhookBad: false, webhookSummary: null };
    expect(deriveFieldState({ status: "DISCONNECTED" }, extras, now).state).toBe("disconnected");
    expect(deriveFieldState({ status: "CONNECTED", lastError: "boom" }, extras, now).state).toBe("error");
    expect(deriveFieldState({ status: "CONNECTED", expiringSoon: true, tokenExpiresAt: new Date(now.getTime() + 5 * DAY) }, extras, now).state).toBe("expiring_7");
    expect(deriveFieldState({ status: "CONNECTED", expiringSoon: true, tokenExpiresAt: new Date(now.getTime() + 2 * DAY) }, extras, now).state).toBe("expiring_3");
    expect(deriveFieldState({ status: "CONNECTED", expiringSoon: true, tokenExpiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1000) }, extras, now).state).toBe("expiring_1");
    expect(deriveFieldState({ status: "CONNECTED" }, extras, now).state).toBe("ok");
  });
});

describe("CC12 sweep — state-change alerting", () => {
  it("first breakage alerts once; the same state never re-alerts; a new error does; recovery notifies once", async () => {
    const { tables, monitor } = build();
    const { integration } = await seedOrg(tables);

    // Baseline: healthy → no alerts.
    let res = await monitor.runSweep("org-1");
    expect(res.alertsCreated).toBe(0);

    // Breakage: lastError appears.
    integration.lastError = "Session expired";
    res = await monitor.runSweep("org-1");
    expect(res.alertsCreated).toBe(1);
    const alert = tables.connectionAlert.rows[0];
    expect(alert).toMatchObject({ kind: "broke", state: "error" });
    // Email counted only via the provider message id: 2 recipients
    // (OWNER + ADMIN), the SUPPORT_AGENT is never a recipient.
    expect(alert.emailSentCount).toBe(2);
    expect(tables.agentNotification.rows).toHaveLength(2);
    expect(tables.agentNotification.rows.every((r: any) => r.type === "connection_alert")).toBe(true);

    // Same broken state → silence.
    res = await monitor.runSweep("org-1");
    expect(res.alertsCreated).toBe(0);

    // A DIFFERENT error is a different broken state → alerts.
    integration.lastError = "Token revoked by user";
    res = await monitor.runSweep("org-1");
    expect(res.alertsCreated).toBe(1);

    // Recovery → exactly one recovery alert.
    integration.lastError = null;
    res = await monitor.runSweep("org-1");
    expect(res.alertsCreated).toBe(1);
    expect(tables.connectionAlert.rows.at(-1)).toMatchObject({ kind: "recovered" });
    res = await monitor.runSweep("org-1");
    expect(res.alertsCreated).toBe(0);
  });

  it("expiry thresholds 7/3/1 each alert once, in order", async () => {
    const { tables, monitor } = build();
    const { integration } = await seedOrg(tables);
    await monitor.runSweep("org-1"); // baseline ok

    integration.tokenExpiresAt = new Date(Date.now() + 5 * DAY);
    let res = await monitor.runSweep("org-1");
    expect(res.alertsCreated).toBe(1);
    expect(tables.connectionAlert.rows.at(-1)).toMatchObject({ kind: "expiring", state: "expiring_7" });

    res = await monitor.runSweep("org-1"); // same threshold, no re-alert
    expect(res.alertsCreated).toBe(0);

    integration.tokenExpiresAt = new Date(Date.now() + 2 * DAY);
    res = await monitor.runSweep("org-1");
    expect(res.alertsCreated).toBe(1);
    expect(tables.connectionAlert.rows.at(-1)).toMatchObject({ kind: "expiring", state: "expiring_3" });

    integration.tokenExpiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
    res = await monitor.runSweep("org-1");
    expect(res.alertsCreated).toBe(1);
    expect(tables.connectionAlert.rows.at(-1)).toMatchObject({ kind: "expiring", state: "expiring_1" });
  });

  it("email failure never blocks the in-app alert and is recorded verbatim; a send without a message id counts as unsent", async () => {
    const failing = build(async () => { throw new Error("SMTP server did not return a message id"); });
    const { integration } = await seedOrg(failing.tables);
    await failing.monitor.runSweep("org-1");
    integration.lastError = "boom";
    const res = await failing.monitor.runSweep("org-1");
    expect(res.alertsCreated).toBe(1);
    const alert = failing.tables.connectionAlert.rows[0];
    expect(alert.emailSentCount).toBe(0);
    expect(alert.emailError).toContain("SMTP server did not return a message id");
    expect(failing.tables.agentNotification.rows).toHaveLength(2); // in-app still delivered

    const noId = build(async () => ({}));
    const seeded = await seedOrg(noId.tables);
    await noId.monitor.runSweep("org-1");
    seeded.integration.lastError = "boom";
    await noId.monitor.runSweep("org-1");
    expect(noId.tables.connectionAlert.rows[0].emailSentCount).toBe(0);
  });

  it("category preference silences alerts but state is still tracked; email can be disabled", async () => {
    const { tables, monitor } = build();
    const { integration } = await seedOrg(tables);
    await monitor.updatePreferences("org-1", "owner-1", { categories: ["courier"], emailEnabled: false });
    await monitor.runSweep("org-1");
    integration.lastError = "boom";
    let res = await monitor.runSweep("org-1");
    expect(res.alertsCreated).toBe(0);
    const state = tables.connectionAlertState.rows.find((r: any) => r.targetId === integration.id);
    expect(state.state).toBe("error"); // tracked silently
    // Re-enable the category: the state does not change, so no
    // retro-alert fires — the machine only speaks on changes.
    await monitor.updatePreferences("org-1", "owner-1", { categories: null });
    res = await monitor.runSweep("org-1");
    expect(res.alertsCreated).toBe(0);
  });

  it("snooze freezes the target: no alert and no state update until it expires", async () => {
    const { tables, monitor } = build();
    const { integration } = await seedOrg(tables);
    await monitor.runSweep("org-1"); // baseline ok
    await monitor.snoozeTarget("org-1", "owner-1", "integration", integration.id, 24);
    integration.lastError = "boom";
    let res = await monitor.runSweep("org-1");
    expect(res.alertsCreated).toBe(0);
    const state = tables.connectionAlertState.rows.find((r: any) => r.targetId === integration.id);
    expect(state.state).toBe("ok"); // frozen
    // Expire the snooze → the still-broken target now alerts.
    state.snoozedUntil = new Date(Date.now() - 1000);
    res = await monitor.runSweep("org-1");
    expect(res.alertsCreated).toBe(1);
    expect(tables.connectionAlert.rows[0]).toMatchObject({ kind: "broke", state: "error" });
  });

  it("sweep doctor (opt-in): a fail alerts once as doctor_fail; a later pass recovers it", async () => {
    const { tables, monitor, doctorStub } = build();
    const { integration } = await seedOrg(tables);
    await monitor.updatePreferences("org-1", "owner-1", { doctorEnabled: true, doctorIntervalHours: 1 });
    doctorStub.diagnoseTarget = async () => ({ overall: "fail", steps: [{ key: "token", label: "Meta টোকেন", status: "fail", message: "bad token" }] });
    let res = await monitor.runSweep("org-1");
    expect(res.doctorRuns).toBeGreaterThan(0);
    expect(res.alertsCreated).toBe(1);
    expect(tables.connectionAlert.rows[0]).toMatchObject({ kind: "broke", state: "doctor_fail" });

    res = await monitor.runSweep("org-1"); // same doctor outcome → no re-alert
    expect(res.alertsCreated).toBe(0);

    doctorStub.diagnoseTarget = async () => ({ overall: "pass", steps: [] });
    res = await monitor.runSweep("org-1");
    expect(res.alertsCreated).toBe(1);
    expect(tables.connectionAlert.rows.at(-1)).toMatchObject({ kind: "recovered", state: "doctor_fail" });
    void integration;
  });
});

describe("CC13 timeline", () => {
  it("aggregates real records newest-first, filters problems, paginates by cursor, and invents nothing", async () => {
    const { tables, timeline } = build();
    const { integration } = await seedOrg(tables);
    const t0 = new Date(Date.now() - 5 * DAY);
    const t1 = new Date(Date.now() - 4 * DAY);
    const t2 = new Date(Date.now() - 3 * DAY);
    const t3 = new Date(Date.now() - 2 * DAY);
    const t4 = new Date(Date.now() - 1 * DAY);
    const auditRow = await tables.auditLog.create({ data: { organizationId: "org-1", action: "integration.messaging.connected", entityType: "Integration", entityId: integration.id } });
    auditRow.createdAt = t0;
    const syncOk = await tables.syncJob.create({ data: { integrationId: integration.id, kind: "orders", status: "SUCCESS", fetched: 10, created: 2, updated: 3, skipped: 0 } });
    syncOk.startedAt = t1; syncOk.completedAt = t1;
    const hookBad = await tables.webhookEvent.create({ data: { integrationId: integration.id, provider: "woocommerce", topic: "order.created", signatureValid: false, error: "bad signature" } });
    hookBad.receivedAt = t2;
    const syncBad = await tables.syncJob.create({ data: { integrationId: integration.id, kind: "products", status: "FAILED", error: "401 from store" } });
    syncBad.startedAt = t3; syncBad.completedAt = t3;
    const check = await tables.connectionHealthCheck.create({
      data: { organizationId: "org-1", targetType: "integration", targetId: integration.id, integrationId: integration.id, provider: "whatsapp", trigger: "manual", overall: "pass", steps: [{ key: "token", label: "Meta টোকেন", status: "pass", message: "ok" }] },
    });
    check.createdAt = t4;

    const all = await timeline.getTimeline("org-1", "integration", integration.id, {});
    expect(all.items.map((i) => i.kind)).toEqual(["health_check", "sync", "webhook", "sync", "audit"]);
    expect(all.items[0].at).toBe(t4.toISOString());

    const problems = await timeline.getTimeline("org-1", "integration", integration.id, { onlyProblems: true });
    expect(problems.items.map((i) => i.kind)).toEqual(["sync", "webhook"]);
    expect(problems.items.every((i) => i.severity === "error")).toBe(true);

    const page1 = await timeline.getTimeline("org-1", "integration", integration.id, { limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await timeline.getTimeline("org-1", "integration", integration.id, { limit: 2, cursor: page1.nextCursor! });
    expect(page2.items).toHaveLength(2);
    const seen = new Set([...page1.items, ...page2.items].map((i) => i.id));
    expect(seen.size).toBe(4);

    const empty = await timeline.getTimeline("org-1", "integration", "no-such-target", {});
    expect(empty.items).toEqual([]);
  });

  it("payment targets carry their transaction outcomes", async () => {
    const { tables, timeline } = build();
    await seedOrg(tables);
    const gw = await tables.tenantPaymentGateway.create({
      data: { organizationId: "org-1", provider: "bkash", status: "verified", isEnabled: true, encryptedData: encryptJson({ username: "u", password: "p", appKey: "k", appSecret: "s" }) },
    });
    await tables.tenantPaymentTransaction.create({
      data: { organizationId: "org-1", gatewayId: gw.id, orderId: "ord-1", provider: "bkash", source: "own", amountMinor: 50000n, currency: "BDT", status: "verified_paid" },
    });
    await tables.tenantPaymentTransaction.create({
      data: { organizationId: "org-1", gatewayId: gw.id, orderId: "ord-2", provider: "bkash", source: "own", amountMinor: 10000n, currency: "BDT", status: "failed" },
    });
    const res = await timeline.getTimeline("org-1", "tenant_payment_gateway", gw.id, {});
    expect(res.items).toHaveLength(2);
    expect(res.items.some((i) => i.severity === "error")).toBe(true);
  });
});
