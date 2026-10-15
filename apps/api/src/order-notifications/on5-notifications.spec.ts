import "reflect-metadata";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { OrderNotificationService } from "./order-notifications.service";
import {
  DEFAULT_CONFIG,
  extractVariables,
  formatTakaMinor,
  mergeConfig,
  renderTemplate,
  validateConfig,
} from "./order-notifications";

/**
 * ON5 — Transactional Notification Engine. Pure helpers pinned
 * exactly; the service runs on a fake-Prisma harness in the
 * on4-fraud style (matcher + in-memory tables), with channel
 * senders as spies — no real SMS / WhatsApp / SMTP ever fires.
 */

// ---------- fake prisma ----------

function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (k === "OR") {
      if (!(v as any[]).some((sub) => matchWhere(row, sub))) return false;
      continue;
    }
    if (v !== null && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const c: any = v;
      if ("in" in c) { if (!c.in.map(String).includes(String(row[k]))) return false; continue; }
      if ("notIn" in c) { if (c.notIn.map(String).includes(String(row[k]))) return false; continue; }
      if ("not" in c) { if (String(row[k]) === String(c.not)) return false; continue; }
      continue;
    }
    if (v === null) { if (row[k] !== null && row[k] !== undefined) return false; continue; }
    if (String(row[k]) !== String(v)) return false;
  }
  return true;
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  const findFirst = async ({ where }: any = {}) => rows.find((r) => matchWhere(r, where)) ?? null;
  return {
    rows,
    findFirst,
    findUnique: findFirst,
    findMany: async ({ where, orderBy, take, skip }: any = {}) => {
      let out = rows.filter((r) => matchWhere(r, where));
      if (orderBy) {
        const [field, dir] = Object.entries(orderBy)[0] as [string, string];
        out = [...out].sort((a, b) => {
          const cmp = new Date(a[field] ?? 0).getTime() - new Date(b[field] ?? 0).getTime();
          return dir === "desc" ? -cmp : cmp;
        });
      }
      if (skip) out = out.slice(skip);
      if (take !== undefined) out = out.slice(0, take);
      return out;
    },
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return row;
    },
    upsert: async ({ where, create, update }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (row) { Object.assign(row, update); return row; }
      const created = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      rows.push(created);
      return created;
    },
  };
}

function makeHarness(opts: {
  smsResult?: any; emailConfigured?: boolean; whatsappFails?: boolean;
} = {}) {
  const tables = {
    order: makeTable("order"),
    customer: makeTable("customer"),
    orderNotificationSetting: makeTable("setting"),
    orderNotificationLog: makeTable("log"),
    courierShipment: makeTable("shipment"),
    storefrontSetting: makeTable("storefrontSetting"),
    organization: makeTable("organization"),
    integration: makeTable("integration"),
    paymentVerification: makeTable("paymentVerification"),
  };
  const prisma: any = { ...tables };
  const auditCalls: any[] = [];
  const audit: any = { log: async (x: any) => { auditCalls.push(x); } };
  const smsCalls: any[] = [];
  const shopAccount: any = {
    sendShopSms: async (orgId: string, phone: string, text: string, reference: string) => {
      smsCalls.push({ orgId, phone, text, reference });
      return opts.smsResult ?? { sent: true };
    },
  };
  const emailCalls: any[] = [];
  const emailProvider: any = {
    isConfigured: () => opts.emailConfigured ?? true,
    send: async (input: any) => { emailCalls.push(input); return { providerMessageId: "em-1" }; },
  };
  const whatsappCalls: any[] = [];
  const inbox: any = {
    sendAutomatedMessage: async (orgId: string, conversationId: string, content: string, tag: string) => {
      whatsappCalls.push({ orgId, conversationId, content, tag });
      if (opts.whatsappFails) throw new Error("meta delivery failed");
      return { id: "msg-1", externalId: "wa-ext-1" };
    },
  };
  const events: any = { on: () => undefined, emit: () => undefined };
  const svc = new OrderNotificationService(prisma, audit, shopAccount, emailProvider, inbox, events);
  return { tables, svc, auditCalls, smsCalls, emailCalls, whatsappCalls };
}

const ORG = "org-1";

function seedOrder(tables: any, over: any = {}) {
  tables.customer.rows.push({
    id: "cust-1", organizationId: ORG, firstName: "Ayesha", lastName: "Rahman",
    phone: "01711000000", email: "ayesha@example.com", ...over.customer,
  });
  const order = {
    id: "order-1", organizationId: ORG, customerId: "cust-1",
    externalNumber: "ORD-1001", totalMinor: 125000n, isPractice: false,
    conversationId: null, status: "processing", ...over.order,
  };
  tables.order.rows.push(order);
  tables.organization.rows.push({ id: ORG, name: "Org fallback name" });
  tables.storefrontSetting.rows.push({ id: "sf-1", organizationId: ORG, shopName: "Qosprey Shop" });
  return order;
}

function seedShipment(tables: any, over: any = {}) {
  const shipment = {
    id: "ship-1", organizationId: ORG, orderId: "order-1", provider: "steadfast",
    trackingCode: "TRK9", trackingToken: "tok123", status: "delivered",
    recipientName: "Ayesha Rahman", recipientPhone: "01711000000",
    lastNotifiedStatus: null, createdAt: new Date(), ...over,
  };
  tables.courierShipment.rows.push(shipment);
  return shipment;
}

async function seedSetting(tables: any, partial: any) {
  tables.orderNotificationSetting.rows.push({
    id: "setting-1", organizationId: ORG, config: mergeConfig(partial), createdAt: new Date(), updatedAt: new Date(),
  });
}

// ---------- pure helpers ----------

describe("ON5 pure helpers", () => {
  it("defaults: order_placed + delivered enabled, all others off, channels sms/whatsapp/email", () => {
    expect(DEFAULT_CONFIG.order_placed.enabled).toBe(true);
    expect(DEFAULT_CONFIG.delivered.enabled).toBe(true);
    for (const e of ["order_packed", "handed_to_courier", "out_for_delivery", "delivery_failed", "parcel_stuck", "delivery_rescheduled"] as const) {
      expect(DEFAULT_CONFIG[e].enabled).toBe(false);
    }
    expect(DEFAULT_CONFIG.order_placed.channels).toEqual(["sms", "whatsapp", "email"]);
    expect(DEFAULT_CONFIG.order_placed.templates).toEqual({ sms: null, whatsapp: null, email: null });
  });

  it("renderTemplate replaces known tokens ({{}} and {}), missing → empty", () => {
    expect(renderTemplate("হ্যালো {{customerName}}, অর্ডার {{orderNumber}} মোট {{total}}", { customerName: "Ayesha", orderNumber: "ORD-1", total: "৳1,250" }))
      .toBe("হ্যালো Ayesha, অর্ডার ORD-1 মোট ৳1,250");
    expect(renderTemplate("x {customerName} {{due}} y", { customerName: "A" })).toBe("x A  y");
  });

  it("extractVariables + formatTakaMinor", () => {
    expect(extractVariables("{{customerName}} {{ total }} {{customerName}}")).toEqual(["customerName", "total"]);
    expect(formatTakaMinor(125000n)).toBe("৳1,250");
    expect(formatTakaMinor(125050n)).toBe("৳1,250.50");
    expect(formatTakaMinor(0n)).toBe("৳0");
  });

  it("validateConfig rejects unknown event / channel / bad types / unknown variable", () => {
    expect(validateConfig({ nope: { enabled: true } })).toContain("অজানা notification event");
    expect(validateConfig({ order_placed: { channels: ["pigeon"] } })).toContain("অজানা channel");
    expect(validateConfig({ order_placed: { channels: "sms" } })).toContain("channels একটি array");
    expect(validateConfig({ order_placed: { enabled: "yes" } })).toContain("boolean");
    expect(validateConfig({ order_placed: { templates: { sms: 42 } } })).toContain("string অথবা null");
    expect(validateConfig({ order_placed: { templates: { sms: "hi {{bogus}}" } } })).toContain("অজানা variable");
    expect(validateConfig({ order_placed: { enabled: true, channels: ["sms"], templates: { sms: "hi {{customerName}}" } } })).toBeNull();
    expect(validateConfig(null)).toBeNull();
  });

  it("mergeConfig fills defaults for partial stored config", () => {
    const merged = mergeConfig({ delivered: { enabled: false } });
    expect(merged.delivered.enabled).toBe(false);
    expect(merged.delivered.channels).toEqual(["sms", "whatsapp", "email"]);
    expect(merged.order_placed.enabled).toBe(true);
  });
});

// ---------- service ----------

describe("ON5 OrderNotificationService", () => {
  it("THE DEDUPE SPEC: legacy notifyCustomer already sent delivered → covered_existing, zero channel sends, exactly one log row", async () => {
    const h = makeHarness();
    seedOrder(h.tables, { order: { conversationId: "conv-1" } });
    // Fixture: a shipment for the order whose legacy stamp says
    // the delivered card already went out (CourierService stamps
    // lastNotifiedStatus ONLY after a confirmed legacy send), and
    // the courier hook's determination: stamp === newStatus.
    const shipment = seedShipment(h.tables, { lastNotifiedStatus: "delivered", status: "delivered" });
    const legacyStamped = shipment.lastNotifiedStatus === shipment.status;
    expect(legacyStamped).toBe(true);

    const res = await h.svc.notify(ORG, "order-1", "delivered", { coveredExisting: legacyStamped, shipmentId: shipment.id });

    expect(res.skipped).toBe("covered_existing");
    expect(h.smsCalls).toHaveLength(0);
    expect(h.whatsappCalls).toHaveLength(0);
    expect(h.emailCalls).toHaveLength(0);
    expect(h.tables.orderNotificationLog.rows).toHaveLength(1);
    expect(h.tables.orderNotificationLog.rows[0]).toMatchObject({
      organizationId: ORG, orderId: "order-1", event: "delivered", channel: "legacy", status: "covered_existing",
    });
  });

  it("engine-first handed_to_courier: one SMS sent with real values; a second notify returns already_sent with no second send", async () => {
    const h = makeHarness();
    seedOrder(h.tables);
    seedShipment(h.tables, { status: "in_review", lastNotifiedStatus: null });
    await seedSetting(h.tables, { handed_to_courier: { enabled: true } });

    const first = await h.svc.notify(ORG, "order-1", "handed_to_courier", { shipmentId: "ship-1" });
    expect(first).toMatchObject({ sent: true, channel: "sms" });
    expect(h.smsCalls).toHaveLength(1);
    expect(h.smsCalls[0].phone).toBe("01711000000");
    expect(h.smsCalls[0].reference).toBe("order-notif-order-1-handed_to_courier");
    expect(h.smsCalls[0].text).toContain("TRK9");
    expect(h.smsCalls[0].text).toContain("/t/tok123");
    expect(h.smsCalls[0].text).toContain("ORD-1001");
    // sendShopSms returns no providerMessageId → log carries null
    expect(h.tables.orderNotificationLog.rows).toEqual([
      expect.objectContaining({ event: "handed_to_courier", channel: "sms", status: "sent", providerMessageId: null }),
    ]);

    const second = await h.svc.notify(ORG, "order-1", "handed_to_courier", { shipmentId: "ship-1" });
    expect(second.skipped).toBe("already_sent");
    expect(h.smsCalls).toHaveLength(1);
    expect(h.tables.orderNotificationLog.rows).toHaveLength(1);
  });

  it("setting-off writes exactly one skipped_setting_off row and sends nothing", async () => {
    const h = makeHarness();
    seedOrder(h.tables);
    const res = await h.svc.notify(ORG, "order-1", "order_packed");
    expect(res.skipped).toBe("setting_off");
    expect(h.tables.orderNotificationLog.rows).toEqual([
      expect.objectContaining({ event: "order_packed", channel: "none", status: "skipped_setting_off" }),
    ]);
    expect(h.smsCalls).toHaveLength(0);
  });

  it("updateSettings: unknown variable → 400; valid override renders real values (name, number, total, due, shop)", async () => {
    const h = makeHarness();
    seedOrder(h.tables);
    h.tables.paymentVerification.rows.push({ id: "pv-1", organizationId: ORG, orderId: "order-1", status: "approved", amountMinor: 25000n });
    h.tables.paymentVerification.rows.push({ id: "pv-2", organizationId: ORG, orderId: "order-1", status: "pending", amountMinor: 99900n });

    await expect(h.svc.updateSettings(ORG, "actor-1", {
      order_placed: { templates: { sms: "hi {{bogusVar}}" } },
    })).rejects.toMatchObject({ status: 400 });

    await h.svc.updateSettings(ORG, "actor-1", {
      order_placed: { templates: { sms: "হ্যালো {{customerName}} অর্ডার {{orderNumber}} মোট {{total}} বকেয়া {{due}} — {{shopName}}" } },
    });
    expect(h.auditCalls).toEqual([
      expect.objectContaining({ action: "orders.notification_settings_updated", metadata: { changedEventKeys: ["order_placed"] } }),
    ]);

    const res = await h.svc.notify(ORG, "order-1", "order_placed");
    expect(res.sent).toBe(true);
    // total ৳1,250 (125000 minor), due = 125000 − 25000 approved = ৳1,000
    expect(h.smsCalls[0].text).toBe("হ্যালো Ayesha Rahman অর্ডার ORD-1001 মোট ৳1,250 বকেয়া ৳1,000 — Qosprey Shop");
  });

  it("whatsapp without a conversation → skipped_no_channel, then falls through to email", async () => {
    const h = makeHarness();
    seedOrder(h.tables); // conversationId: null
    await seedSetting(h.tables, { order_placed: { enabled: true, channels: ["whatsapp", "email"] } });
    const res = await h.svc.notify(ORG, "order-1", "order_placed");
    expect(res).toMatchObject({ sent: true, channel: "email" });
    expect(h.whatsappCalls).toHaveLength(0);
    expect(h.emailCalls).toHaveLength(1);
    expect(h.emailCalls[0].to).toBe("ayesha@example.com");
    expect(h.emailCalls[0].subject).toBe("অর্ডার ORD-1001 — Qosprey Shop");
    expect(h.tables.orderNotificationLog.rows).toEqual([
      expect.objectContaining({ channel: "whatsapp", status: "skipped_no_channel" }),
      expect.objectContaining({ channel: "email", status: "sent", providerMessageId: "em-1" }),
    ]);
  });

  it("whatsapp WITH a conversation sends via inbox (tag order_notification, externalId as providerMessageId) and stops", async () => {
    const h = makeHarness();
    seedOrder(h.tables, { order: { conversationId: "conv-9" } });
    await seedSetting(h.tables, { order_placed: { enabled: true, channels: ["whatsapp", "sms"] } });
    const res = await h.svc.notify(ORG, "order-1", "order_placed");
    expect(res).toMatchObject({ sent: true, channel: "whatsapp" });
    expect(h.whatsappCalls).toEqual([expect.objectContaining({ conversationId: "conv-9", tag: "order_notification" })]);
    expect(h.smsCalls).toHaveLength(0); // channels after a success get NO rows / sends
    expect(h.tables.orderNotificationLog.rows).toEqual([
      expect.objectContaining({ channel: "whatsapp", status: "sent", providerMessageId: "wa-ext-1" }),
    ]);
  });

  it("SMS notConfigured → skipped_no_channel and continues; SMS refusal → failed_error and continues to email", async () => {
    const h1 = makeHarness({ smsResult: { sent: false, notConfigured: true, reason: "no SMS sender configured" } });
    seedOrder(h1.tables);
    const r1 = await h1.svc.notify(ORG, "order-1", "order_placed");
    expect(r1).toMatchObject({ sent: true, channel: "email" });
    expect(h1.tables.orderNotificationLog.rows.map((r: any) => [r.channel, r.status])).toEqual([
      ["sms", "skipped_no_channel"], ["whatsapp", "skipped_no_channel"], ["email", "sent"],
    ]);

    const h2 = makeHarness({ smsResult: { sent: false, notConfigured: false, reason: "gateway refused: insufficient balance" } });
    seedOrder(h2.tables);
    const r2 = await h2.svc.notify(ORG, "order-1", "order_placed");
    expect(r2).toMatchObject({ sent: true, channel: "email" });
    expect(h2.tables.orderNotificationLog.rows[0]).toMatchObject({ channel: "sms", status: "failed_error", error: "gateway refused: insufficient balance" });
  });

  it("no channels capable: empty channels array → exactly one failed_no_channel row", async () => {
    const h = makeHarness();
    seedOrder(h.tables);
    await seedSetting(h.tables, { order_placed: { enabled: true, channels: [] } });
    const res = await h.svc.notify(ORG, "order-1", "order_placed");
    expect(res.sent).toBe(false);
    expect(h.tables.orderNotificationLog.rows).toEqual([
      expect.objectContaining({ channel: "none", status: "failed_no_channel" }),
    ]);
    expect(h.smsCalls).toHaveLength(0);
  });

  it("practice order → skipped practice, NO log rows, no sends; missing order → order_not_found, no rows", async () => {
    const h = makeHarness();
    seedOrder(h.tables, { order: { isPractice: true } });
    const res = await h.svc.notify(ORG, "order-1", "order_placed");
    expect(res.skipped).toBe("practice");
    expect(h.tables.orderNotificationLog.rows).toHaveLength(0);
    expect(h.smsCalls).toHaveLength(0);
    const missing = await h.svc.notify(ORG, "nope", "order_placed");
    expect(missing.skipped).toBe("order_not_found");
    expect(h.tables.orderNotificationLog.rows).toHaveLength(0);
  });

  it("handleIngested: store-synced sources (woocommerce, shopify) send nothing and write nothing; manual notifies", async () => {
    const h = makeHarness();
    seedOrder(h.tables);
    for (const source of ["woocommerce", "shopify"]) {
      const res = await h.svc.handleIngested({ organizationId: ORG, context: { orderId: "order-1", source } });
      expect(res.skipped).toBe("store_synced_source");
    }
    expect(h.smsCalls).toHaveLength(0);
    expect(h.tables.orderNotificationLog.rows).toHaveLength(0);

    const manual = await h.svc.handleIngested({ organizationId: ORG, context: { orderId: "order-1", source: "manual" } });
    expect(manual.sent).toBe(true);
    expect(h.smsCalls).toHaveLength(1);
  });

  it("handleDelivered sends delivered; handleStatusChanged maps only to=delivered (completed is NOT double-fired)", async () => {
    const h = makeHarness();
    seedOrder(h.tables);
    const completed = await h.svc.handleStatusChanged({ organizationId: ORG, context: { orderId: "order-1", from: "processing", to: "completed" } });
    expect(completed.skipped).toBe("unmapped_status");
    expect(h.smsCalls).toHaveLength(0);
    const delivered = await h.svc.handleStatusChanged({ organizationId: ORG, context: { orderId: "order-1", from: "processing", to: "delivered" } });
    expect(delivered.sent).toBe(true);
    // order.delivered after a status-delivered send dedupes
    const again = await h.svc.handleDelivered({ organizationId: ORG, context: { orderId: "order-1" } });
    expect(again.skipped).toBe("already_sent");
    expect(h.smsCalls).toHaveLength(1);
  });

  it("getSettings is lazy (defaults, no row written); listLogs 404s a foreign order and returns rows for an own order", async () => {
    const h = makeHarness();
    seedOrder(h.tables);
    const settings = await h.svc.getSettings(ORG);
    expect(settings).toEqual(mergeConfig(null));
    expect(h.tables.orderNotificationSetting.rows).toHaveLength(0);

    await expect(h.svc.listLogs(ORG, "foreign-order")).rejects.toMatchObject({ status: 404 });
    await h.svc.notify(ORG, "order-1", "order_packed");
    const logs = await h.svc.listLogs(ORG, "order-1");
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe("skipped_setting_off");
  });

  it("notify NEVER throws even when a channel explodes", async () => {
    const h = makeHarness({ whatsappFails: true });
    seedOrder(h.tables, { order: { conversationId: "conv-1" } });
    await seedSetting(h.tables, { order_placed: { enabled: true, channels: ["whatsapp"] } });
    const res = await h.svc.notify(ORG, "order-1", "order_placed");
    expect(res.sent).toBe(false);
    expect(h.tables.orderNotificationLog.rows).toEqual([
      expect.objectContaining({ channel: "whatsapp", status: "failed_error", error: "meta delivery failed" }),
    ]);
  });
});
