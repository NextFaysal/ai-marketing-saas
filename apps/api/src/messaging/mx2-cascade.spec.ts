import { MessagingService } from "./messaging.service";
import {
  preferredChannel, cheapestFirstOrder, engagementStats, cascadeBreakdown,
  SMS_CIRCUIT_BREAKER_THRESHOLD,
} from "./cascade";
import { seal } from "../common/platform-config";
import { encryptJson } from "../integrations/crypto";

/**
 * MX2 — Smart Channel Routing & Fallback Cascade: pure routing
 * functions (preferred channel / cheapest-first), per-recipient
 * fallback with linked delivery attempts on the recipient-table
 * engine, honest skips (no address / no WhatsApp template),
 * SMS gateway failover + the run circuit breaker, smart-routing
 * reorder, and the legacy single-channel path staying
 * byte-identical. Fake-prisma style like mx1-recipient-table.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("not" in v) { const ok = v.not === null ? row[k] !== null && row[k] !== undefined : row[k] !== v.not; if (!ok) return false; }
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("gt" in v && !(row[k] > v.gt)) return false;
      if ("gte" in v && !(new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      if ("lt" in v && !(new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    return row[k] === v;
  });
}
function sortRows(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...rows];
  out.sort((a, b) => {
    for (const spec of specs) for (const [key, dir] of Object.entries(spec)) {
      const av = a[key]; const bv = b[key];
      if (av === bv) continue;
      const cmp = av < bv ? -1 : 1;
      return dir === "desc" ? -cmp : cmp;
    }
    return 0;
  });
  return out;
}
function project(row: any, select: any): any {
  if (!select) return row;
  const out: any = {};
  for (const k of Object.keys(select)) if (select[k]) out[k] = row[k];
  return out;
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where, select }: any = {}) => {
      const row = rows.find((r) => matches(r, where ?? {})) ?? null;
      return row ? project(row, select) : null;
    },
    findUnique: async ({ where, select }: any = {}) => {
      const row = rows.find((r) => matches(r, where ?? {})) ?? null;
      return row ? project(row, select) : null;
    },
    findMany: async ({ where, take, orderBy, cursor, skip, select }: any = {}) => {
      let out = sortRows(rows.filter((r) => matches(r, where ?? {})), orderBy);
      if (cursor?.id) { const pos = out.findIndex((r) => r.id === cursor.id); if (pos >= 0) out = out.slice(pos + (skip ?? 0)); }
      else if (skip) out = out.slice(skip);
      if (take) out = out.slice(0, take);
      return out.map((r) => project(r, select));
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) { Object.assign(row, data); row.updatedAt = new Date(); } return row; },
    updateMany: async ({ where, data }: any) => { let n = 0; for (const row of rows) if (matches(row, where ?? {})) { Object.assign(row, data); n++; } return { count: n }; },
    upsert: async ({ where, update, create }: any) => {
      const row = rows.find((r) => matches(r, where ?? {}));
      if (row) { Object.assign(row, update); return row; }
      const created = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      rows.push(created); return created;
    },
    deleteMany: async ({ where }: any) => { let n = 0; for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where ?? {})) { rows.splice(i, 1); n++; } return { count: n }; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); if (i >= 0) rows.splice(i, 1); return {}; },
  };
}
function makeRecipientTable() {
  const table: any = makeTable("bcr");
  table.createMany = async ({ data, skipDuplicates }: any) => {
    let count = 0;
    for (const d of data) {
      const dupe = table.rows.some((r: any) => r.broadcastId === d.broadcastId && r.dedupeKey === d.dedupeKey);
      if (dupe) { if (skipDuplicates) continue; throw new Error("Unique constraint failed"); }
      table.rows.push({ id: `bcr-${table.rows.length + 1}-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date(), updatedAt: new Date(), ...d });
      count++;
    }
    return { count };
  };
  return table;
}

const C = (n: number, extra: any = {}) => ({
  id: `c${n}`, organizationId: "org-1", firstName: `User${n}`, lastName: null,
  email: `user${n}@example.com`, phone: `0171234567${n}`, ...extra,
});

interface BuildOpts {
  customers?: any[];
  failEmailFor?: Set<string>;
  failSmsSenderIds?: Set<string>;
  rates?: { smsCostPerPartMinor?: number | null; whatsappCostPerMessageMinor?: number | null; emailCostPerMessageMinor?: number | null };
  primarySms?: { gateway: string; senderId: string; priority?: number } | null;
  extraGateways?: any[];
  frequencyCapPerDay?: number;
}
function build(opts: BuildOpts = {}) {
  const tables: any = {
    messageTemplate: makeTable("tpl"), broadcast: makeTable("bc"), messageDelivery: makeTable("dlv"),
    customer: makeTable("cust"), lead: makeTable("lead"), whatsAppTemplate: makeTable("wa"),
    messagePreference: makeTable("pref"), messagingSetting: makeTable("mset"),
    broadcastRecipient: makeRecipientTable(), order: makeTable("ord"),
    messageLinkClick: makeTable("click"), messagingSenderConfig: makeTable("scfg"),
    messagingSmsGatewayConfig: makeTable("gw"), integration: makeTable("int"),
  };
  for (const c of opts.customers ?? [C(1), C(2), C(3)]) tables.customer.rows.push({ ...c });
  tables.systemSetting = { findUnique: async () => null };
  tables.organization = { findUnique: async () => ({ aiDailyLimitOverride: null, broadcastCapOverride: null, seatLimit: null }) };
  if (opts.frequencyCapPerDay !== undefined) {
    tables.messagingSetting.rows.push({ id: "mset-1", organizationId: "org-1", frequencyCapPerDay: opts.frequencyCapPerDay, whatsappOptInRequired: false, linkTrackingEnabled: true });
  }
  if (opts.rates || opts.primarySms) {
    tables.messagingSenderConfig.rows.push({
      id: "scfg-1", organizationId: "org-1",
      ...(opts.rates ?? {}),
      ...(opts.primarySms ? {
        smsGateway: opts.primarySms.gateway, smsApiKeyEncrypted: seal(`key-${opts.primarySms.senderId}`),
        smsSenderId: opts.primarySms.senderId, smsPriority: opts.primarySms.priority ?? 0,
      } : {}),
    });
  }
  for (const g of opts.extraGateways ?? []) tables.messagingSmsGatewayConfig.rows.push({ ...g });
  const emailCalls: any[] = [];
  const email = {
    isConfigured: () => true,
    send: async ({ to, subject, text }: any) => {
      emailCalls.push({ to, subject, text });
      if (opts.failEmailFor?.has(to)) throw new Error("SMTP rejected recipient");
      return { providerMessageId: `<id-${to}>` };
    },
  } as any;
  const smsCalls: any[] = [];
  const platformSmsCalls: any[] = [];
  const sms = {
    isConfigured: () => true,
    send: async (input: any) => { platformSmsCalls.push(input); return { providerMessageId: `platform-${input.to}` }; },
    sendWithGateway: async (gateway: string, cfg: any, input: any) => {
      smsCalls.push({ gateway, senderId: cfg.senderId, gatewayKey: cfg.gatewayKey, to: input.to });
      if (opts.failSmsSenderIds?.has(cfg.senderId)) throw new Error(`gateway ${cfg.senderId} is down`);
      return { providerMessageId: `sms-${cfg.senderId}-${input.to}` };
    },
  } as any;
  const svc = new MessagingService(tables as any, { log: async () => undefined } as any, email, sms);
  return { svc, tables, emailCalls, smsCalls, platformSmsCalls };
}

const deliveriesFor = (tables: any, broadcastId: string, recipientId?: string) =>
  tables.messageDelivery.rows.filter((d: any) => d.broadcastId === broadcastId && (!recipientId || d.recipientId === recipientId));
const rowsFor = (tables: any, broadcastId: string) =>
  tables.broadcastRecipient.rows.filter((r: any) => r.broadcastId === broadcastId);

describe("MX2 pure routing functions", () => {
  it("preferredChannel: most-engaged wins, ties break by org order, no history → null", () => {
    const order = ["sms", "email", "whatsapp"] as const;
    expect(preferredChannel([
      { channel: "sms", sent: 5, engaged: 1 }, { channel: "email", sent: 2, engaged: 3 },
    ], [...order])).toBe("email");
    expect(preferredChannel([
      { channel: "email", sent: 1, engaged: 2 }, { channel: "sms", sent: 9, engaged: 2 },
    ], [...order])).toBe("sms"); // tie → sms comes first in org order
    expect(preferredChannel([{ channel: "email", sent: 3, engaged: 0 }], [...order])).toBeNull();
    expect(preferredChannel([], [...order])).toBeNull();
  });

  it("engagementStats counts only confirmed-sent deliveries, engaged via open/read/click", () => {
    const stats = engagementStats([
      { channel: "email", status: "sent", broadcastId: "b1", openedAt: new Date() },
      { channel: "email", status: "failed", broadcastId: "b2", openedAt: new Date() },
      { channel: "sms", status: "sent", broadcastId: "b3" },
      { channel: "sms", status: "sent", broadcastId: "b4" },
    ], new Set(["b4"]));
    expect(stats).toEqual([
      { channel: "email", sent: 1, engaged: 1 },
      { channel: "sms", sent: 2, engaged: 1 },
    ]);
  });

  it("cheapestFirstOrder: sorts by org-entered rates; a missing rate keeps org order and names the channel", () => {
    const ok = cheapestFirstOrder(["email", "sms", "whatsapp"], { email: 500, sms: 100, whatsapp: 300 });
    expect(ok.order).toEqual(["sms", "whatsapp", "email"]);
    expect(ok.missingRates).toEqual([]);
    const missing = cheapestFirstOrder(["email", "sms"], { email: 500, sms: null });
    expect(missing.order).toEqual(["email", "sms"]);
    expect(missing.missingRates).toEqual(["sms"]);
  });

  it("cascadeBreakdown: final success counts land on the channel of the LAST attempt", () => {
    const bd = cascadeBreakdown([
      { channel: "email", status: "failed", recipientType: "customer", recipientId: "c1", address: "a@x", recipientRowId: "r1", attemptIndex: 0, error: "x" },
      { channel: "sms", status: "sent", recipientType: "customer", recipientId: "c1", address: "880", recipientRowId: "r1", attemptIndex: 1 },
    ]);
    expect(bd.channels.find((c) => c.channel === "sms")?.finalSuccesses).toBe(1);
    expect(bd.chains[0]).toMatchObject({ finalChannel: "sms", finalStatus: "sent" });
  });
});

describe("MX2 cascade engine (recipient-table path)", () => {
  it("fallback: email fails → SMS attempt succeeds; attempts linked, recipient final sent, report chain correct", async () => {
    const { svc, tables } = build({ failEmailFor: new Set(["user1@example.com"]) });
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "cascade", channel: "email", subject: "Offer", body: "Hello {{name}}", audienceType: "customers",
      cascade: { enabled: true, channels: ["email", "sms"], smsBody: "SMS hello {{name}}" },
    } as any);
    const sent = await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(sent.status).toBe("sent"); // every recipient row ended sent (c1 via fallback)
    const c1Rows = rowsFor(tables, bc.id).find((r: any) => r.recipientId === "c1");
    expect(c1Rows.status).toBe("sent");
    const c1Deliveries = deliveriesFor(tables, bc.id, "c1");
    expect(c1Deliveries).toHaveLength(2);
    expect(c1Deliveries[0]).toMatchObject({ channel: "email", status: "failed", attemptIndex: 0, recipientRowId: c1Rows.id, cascadeGroupId: c1Rows.id });
    expect(c1Deliveries[1]).toMatchObject({ channel: "sms", status: "sent", attemptIndex: 1, recipientRowId: c1Rows.id });
    // A recipient whose primary attempt succeeded gets exactly one attempt.
    expect(deliveriesFor(tables, bc.id, "c2")).toHaveLength(1);
    const report: any = await svc.getBroadcastReport("org-1", bc.id);
    expect(report.cascade).not.toBeNull();
    const smsBreak = report.cascade.channels.find((c: any) => c.channel === "sms");
    expect(smsBreak).toMatchObject({ attempts: 1, sent: 1, finalSuccesses: 1 });
    const chain = report.cascade.chains.find((c: any) => c.key === `row:${c1Rows.id}`);
    expect(chain.finalChannel).toBe("sms");
    expect(chain.attempts.map((a: any) => a.channel)).toEqual(["email", "sms"]);
  });

  it("all channels fail → recipient final failed with the full linked chain", async () => {
    const { svc, tables } = build({
      customers: [C(1)],
      failEmailFor: new Set(["user1@example.com"]),
      primarySms: { gateway: "bulksmsbd", senderId: "S-FAIL" },
      failSmsSenderIds: new Set(["S-FAIL"]),
    });
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "allfail", channel: "email", subject: "Offer", body: "Hello", audienceType: "customers",
      cascade: { enabled: true, channels: ["email", "sms"], smsBody: "SMS hello" },
    } as any);
    const sent = await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(sent.status).toBe("failed");
    const row = rowsFor(tables, bc.id)[0];
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(2);
    const ds = deliveriesFor(tables, bc.id, "c1");
    expect(ds.map((d: any) => [d.channel, d.status, d.attemptIndex])).toEqual([["email", "failed", 0], ["sms", "failed", 1]]);
  });

  it("suppressed recipient (resolve-time) gets zero attempts and zero provider calls on every channel", async () => {
    const { svc, tables, emailCalls, smsCalls } = build({});
    tables.messagePreference.rows.push({
      id: "pref-1", organizationId: "org-1", channel: "email", address: "user1@example.com", status: "opted_out", source: "manual",
    });
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "supp", channel: "email", subject: "Offer", body: "Hello", audienceType: "customers",
      cascade: { enabled: true, channels: ["email", "sms"], smsBody: "SMS hello" },
    } as any);
    await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(rowsFor(tables, bc.id).map((r: any) => r.recipientId)).toEqual(["c2", "c3"]);
    expect(deliveriesFor(tables, bc.id, "c1")).toHaveLength(0);
    expect(emailCalls.map((c: any) => c.to)).not.toContain("user1@example.com");
    expect(smsCalls).toHaveLength(0);
  });

  it("recipient without a phone: the SMS attempt is an honest recorded skip, never a provider call", async () => {
    const { svc, tables, smsCalls } = build({
      customers: [C(1, { phone: null })],
      failEmailFor: new Set(["user1@example.com"]),
    });
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "nophone", channel: "email", subject: "Offer", body: "Hello", audienceType: "customers",
      cascade: { enabled: true, channels: ["email", "sms"], smsBody: "SMS hello" },
    } as any);
    await svc.sendBroadcast("org-1", "owner", bc.id);
    const ds = deliveriesFor(tables, bc.id, "c1");
    expect(ds).toHaveLength(2);
    expect(ds[1]).toMatchObject({ channel: "sms", status: "skipped", attemptIndex: 1 });
    expect(ds[1].error).toContain("no phone number");
    expect(smsCalls).toHaveLength(0);
    expect(rowsFor(tables, bc.id)[0].status).toBe("failed"); // email failed, sms skipped → final failed
  });

  it("cascade into WhatsApp without a template: channel skipped once with the reason recorded, no WhatsApp delivery rows", async () => {
    const { svc, tables } = build({ customers: [C(1)], failEmailFor: new Set(["user1@example.com"]) });
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "wanotpl", channel: "email", subject: "Offer", body: "Hello", audienceType: "customers",
      cascade: { enabled: true, channels: ["email", "whatsapp"] },
    } as any);
    await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(deliveriesFor(tables, bc.id).filter((d: any) => d.channel === "whatsapp")).toHaveLength(0);
    const bcRow = tables.broadcast.rows.find((r: any) => r.id === bc.id);
    expect(bcRow.cascadeReport.skippedChannels).toEqual([
      expect.objectContaining({ channel: "whatsapp", reason: expect.stringContaining("approved template") }),
    ]);
    const report: any = await svc.getBroadcastReport("org-1", bc.id);
    expect(report.cascade.skippedChannels[0].channel).toBe("whatsapp");
  });

  it("cascade into WhatsApp WITH a template sends through Meta only", async () => {
    const realFetch = global.fetch;
    const fetchCalls: any[] = [];
    (global as any).fetch = async (url: string, init: any) => {
      fetchCalls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid-x" }] }) };
    };
    try {
      const { svc, tables } = build({ customers: [C(1)], failEmailFor: new Set(["user1@example.com"]) });
      tables.whatsAppTemplate.rows.push({ id: "wa-1", organizationId: "org-1", name: "eid_offer", language: "bn", bodyText: "tpl" });
      tables.integration.rows.push({
        id: "int-1", organizationId: "org-1", provider: "whatsapp", status: "CONNECTED",
        credential: { encryptedData: encryptJson({ accessToken: "tok", phoneNumberId: "999" }) },
      });
      const bc = await svc.createBroadcast("org-1", "owner", {
        name: "watpl", channel: "email", subject: "Offer", body: "Hello", audienceType: "customers",
        cascade: { enabled: true, channels: ["email", "whatsapp"], whatsappTemplateId: "wa-1" },
      } as any);
      await svc.sendBroadcast("org-1", "owner", bc.id);
      expect(fetchCalls).toHaveLength(1);
      const ds = deliveriesFor(tables, bc.id, "c1");
      expect(ds.map((d: any) => [d.channel, d.status])).toEqual([["email", "failed"], ["whatsapp", "sent"]]);
      expect(rowsFor(tables, bc.id)[0].status).toBe("sent");
    } finally { (global as any).fetch = realFetch; }
  });

  it("create validation: cascade must include the primary channel, and a bogus cascade WhatsApp template 404s", async () => {
    const { svc } = build({});
    await expect(svc.createBroadcast("org-1", "owner", {
      name: "bad", channel: "email", subject: "s", body: "b", audienceType: "customers",
      cascade: { enabled: true, channels: ["sms", "whatsapp"] },
    } as any)).rejects.toThrow(/primary channel/);
    await expect(svc.createBroadcast("org-1", "owner", {
      name: "bad2", channel: "email", subject: "s", body: "b", audienceType: "customers",
      cascade: { enabled: true, channels: ["email", "whatsapp"], whatsappTemplateId: "nope" },
    } as any)).rejects.toMatchObject({ code: "messaging.cascadeWhatsAppTemplateNotFoundIn" });
  });
});

describe("MX2 SMS gateway failover + circuit breaker", () => {
  const gw2 = () => ({
    id: "gw-2", organizationId: "org-1", smsGateway: "alphasms",
    smsApiKeyEncrypted: seal("key-S-OK"), smsSenderId: "S-OK", priority: 10, isEnabled: true,
  });

  it("failover: primary gateway failure moves to the next configured gateway, which confirms the send", async () => {
    const { svc, tables, smsCalls, platformSmsCalls: failoverPlatformCalls } = build({
      customers: [C(1)],
      primarySms: { gateway: "bulksmsbd", senderId: "S-FAIL" },
      failSmsSenderIds: new Set(["S-FAIL"]),
      extraGateways: [gw2()],
    });
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "fo", channel: "sms", body: "Hello {{name}}", audienceType: "customers",
    });
    const sent = await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(sent.status).toBe("sent");
    expect(failoverPlatformCalls).toHaveLength(0);
    expect(smsCalls.map((c: any) => c.senderId)).toEqual(["S-FAIL", "S-OK"]);
    const ds = deliveriesFor(tables, bc.id, "c1");
    expect(ds).toHaveLength(1); // ONE delivery row for the channel attempt — gateway failover is inside it
    expect(ds[0].status).toBe("sent");
  });

  it(`circuit breaker: after ${SMS_CIRCUIT_BREAKER_THRESHOLD} consecutive failures the gateway is skipped for the rest of the run and the event is surfaced`, async () => {
    const customers = [1, 2, 3, 4, 5, 6].map((n) => C(n));
    const { svc, tables, smsCalls } = build({
      customers,
      primarySms: { gateway: "bulksmsbd", senderId: "S-FAIL" },
      failSmsSenderIds: new Set(["S-FAIL"]),
      extraGateways: [gw2()],
    });
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "cb", channel: "sms", body: "Hello", audienceType: "customers",
      cascade: { enabled: true, channels: ["sms", "email"], emailSubject: "FB", emailBody: "Fallback mail" },
    } as any);
    await svc.sendBroadcast("org-1", "owner", bc.id);
    // Primary tried exactly THRESHOLD times, then broken; the backup carried all 6 sends.
    expect(smsCalls.filter((c: any) => c.senderId === "S-FAIL")).toHaveLength(SMS_CIRCUIT_BREAKER_THRESHOLD);
    expect(smsCalls.filter((c: any) => c.senderId === "S-OK")).toHaveLength(6);
    const bcRow = tables.broadcast.rows.find((r: any) => r.id === bc.id);
    expect(bcRow.cascadeReport.breakerEvents).toHaveLength(1);
    expect(bcRow.cascadeReport.breakerEvents[0]).toMatchObject({ gatewayKey: "bulksmsbd:S-FAIL", failures: SMS_CIRCUIT_BREAKER_THRESHOLD });
    const report: any = await svc.getBroadcastReport("org-1", bc.id);
    expect(report.cascade.breakerEvents).toHaveLength(1);
  });
});

describe("MX2 ordering: cheapest-first + smart routing", () => {
  it("cheapest-first with org rates present orders by rate (SMS attempt first, email never attempted)", async () => {
    const { svc, tables, emailCalls } = build({
      customers: [C(1)],
      rates: { emailCostPerMessageMinor: 500, smsCostPerPartMinor: 100, whatsappCostPerMessageMinor: 300 },
      primarySms: { gateway: "bulksmsbd", senderId: "S-OK" },
    });
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "cheap", channel: "email", subject: "Offer", body: "Hello", audienceType: "customers",
      cascade: { enabled: true, channels: ["email", "sms"], smsBody: "SMS hello", ordering: "cheapest" },
    } as any);
    await svc.sendBroadcast("org-1", "owner", bc.id);
    const ds = deliveriesFor(tables, bc.id, "c1");
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ channel: "sms", status: "sent", attemptIndex: 0 });
    expect(emailCalls).toHaveLength(0);
  });

  it("cheapest-first with a rate missing keeps org order and the report says rates were missing", async () => {
    const { svc, tables } = build({ customers: [C(1)] }); // no sender-config row at all → no rates
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "cheapmiss", channel: "email", subject: "Offer", body: "Hello", audienceType: "customers",
      cascade: { enabled: true, channels: ["email", "sms"], smsBody: "SMS hello", ordering: "cheapest" },
    } as any);
    await svc.sendBroadcast("org-1", "owner", bc.id);
    const ds = deliveriesFor(tables, bc.id, "c1");
    expect(ds).toHaveLength(1);
    expect(ds[0].channel).toBe("email"); // org order kept
    const report: any = await svc.getBroadcastReport("org-1", bc.id);
    expect(report.cascade.ratesMissing).toEqual(expect.arrayContaining(["email", "sms"]));
    expect(report.cascade.ratesNote).toContain("rate নেই");
  });

  it("smart routing: a recipient's attempt order starts with their most-engaged channel; disabled → org order", async () => {
    const mk = async (smart: boolean) => {
      const built = build({
        customers: [C(1), C(2)],
        frequencyCapPerDay: 0,
        primarySms: { gateway: "bulksmsbd", senderId: "S-OK" },
      });
      // c1's history: an OPENED email from an earlier broadcast.
      built.tables.messageDelivery.rows.push({
        id: "old-1", organizationId: "org-1", broadcastId: "old-bc", channel: "email",
        recipientType: "customer", recipientId: "c1", address: "user1@example.com",
        status: "sent", openedAt: new Date(), createdAt: new Date(),
      });
      const bc = await built.svc.createBroadcast("org-1", "owner", {
        name: smart ? "smart" : "nosmart", channel: "sms", body: "SMS hi", audienceType: "customers",
        cascade: { enabled: true, channels: ["sms", "email"], smartRouting: smart, emailSubject: "Mail", emailBody: "Mail body" },
      } as any);
      await built.svc.sendBroadcast("org-1", "owner", bc.id);
      return { ...built, bc };
    };
    const on = await mk(true);
    // c1: email (preferred) attempted first and succeeds → no SMS attempt.
    expect(deliveriesFor(on.tables, on.bc.id, "c1").map((d: any) => d.channel)).toEqual(["email"]);
    // c2: no history → org order → SMS first, succeeds.
    expect(deliveriesFor(on.tables, on.bc.id, "c2").map((d: any) => d.channel)).toEqual(["sms"]);
    const off = await mk(false);
    expect(deliveriesFor(off.tables, off.bc.id, "c1").map((d: any) => d.channel)).toEqual(["sms"]);
  });
});

describe("MX2 legacy behaviour unchanged", () => {
  it("a pre-MX2 snapshot broadcast sends single-channel, deliveries carry no cascade links, report.cascade is null", async () => {
    const { svc, tables } = build({});
    tables.broadcast.rows.push({
      id: "bc-old", organizationId: "org-1", channel: "email", subject: "s", body: "Hi {{name}}",
      status: "sending", totalRecipients: 1, sentCount: 0, failedCount: 0,
      recipientSnapshot: [{ type: "customer", id: "c1", name: "User1", email: "user1@example.com", phone: "01712345671", status: "pending", attempts: 0 }],
    });
    const result = await svc.processBroadcast("org-1", "bc-old");
    expect(result.sent).toBe(1);
    const ds = deliveriesFor(tables, "bc-old", "c1");
    expect(ds).toHaveLength(1);
    expect(ds[0].attemptIndex ?? null).toBeNull();
    expect(ds[0].recipientRowId ?? null).toBeNull();
    const report: any = await svc.getBroadcastReport("org-1", "bc-old");
    expect(report.cascade).toBeNull();
  });
});
