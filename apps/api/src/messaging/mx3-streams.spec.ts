import { MessagingService } from "./messaging.service";
import { isQuietHoursActive, isValidHhMm, localMinutesOfDay } from "./quiet-hours";
import { OrderNotificationService } from "../order-notifications/order-notifications.service";

/**
 * MX3 — Transactional vs Marketing Stream Separation: the pure
 * quiet-hours helper (org timezone, overnight windows, boundary
 * minutes), sweep deferral with a fixture clock (zero provider
 * calls inside the window; sends resume on a later sweep outside
 * it), the per-org sweep caps, strict settings validation, the
 * read-only transactional overview, and the transactional
 * exemption (OrderNotificationService.notify still sends while
 * the marketing engine defers — the two paths share nothing but
 * the low-level providers). Fake-prisma style like mx1/mx2.
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
      if ("lte" in v && !(new Date(row[k]).getTime() <= new Date(v.lte).getTime())) return false;
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

/** Fixture clock: 2026-10-16T17:30:00Z = 23:30 in Asia/Dhaka. */
const DHAKA_2330 = new Date("2026-10-16T17:30:00.000Z");
/** 2026-10-16T06:00:00Z = 12:00 in Asia/Dhaka. */
const DHAKA_1200 = new Date("2026-10-16T06:00:00.000Z");

interface BuildOpts {
  customers?: any[];
  setting?: Record<string, unknown> | null;
  timezone?: string;
}
function build(opts: BuildOpts = {}) {
  const tables: any = {
    messageTemplate: makeTable("tpl"), broadcast: makeTable("bc"), messageDelivery: makeTable("dlv"),
    customer: makeTable("cust"), lead: makeTable("lead"), whatsAppTemplate: makeTable("wa"),
    messagePreference: makeTable("pref"), messagingSetting: makeTable("mset"),
    broadcastRecipient: makeRecipientTable(), order: makeTable("ord"),
    messageLinkClick: makeTable("click"), messagingSenderConfig: makeTable("scfg"),
    messagingSmsGatewayConfig: makeTable("gw"), integration: makeTable("int"),
    organization: makeTable("org"),
    orderNotificationLog: makeTable("onlog"), orderNotificationSetting: makeTable("onset"),
    courierShipment: makeTable("ship"), paymentVerification: makeTable("payv"),
    storefrontSetting: makeTable("sfset"),
  };
  for (const c of opts.customers ?? [C(1), C(2), C(3)]) tables.customer.rows.push({ ...c });
  tables.systemSetting = { findUnique: async () => null };
  tables.organization.rows.push({
    id: "org-1", name: "Test Shop", timezone: opts.timezone ?? "Asia/Dhaka",
    aiDailyLimitOverride: null, broadcastCapOverride: null, seatLimit: null,
  });
  if (opts.setting !== null) {
    tables.messagingSetting.rows.push({
      id: "mset-1", organizationId: "org-1", frequencyCapPerDay: 0,
      whatsappOptInRequired: false, linkTrackingEnabled: true, ...(opts.setting ?? {}),
    });
  }
  const emailCalls: any[] = [];
  const email = {
    isConfigured: () => true,
    send: async ({ to, subject, text }: any) => {
      emailCalls.push({ to, subject, text });
      return { providerMessageId: `<id-${to}>` };
    },
  } as any;
  const smsCalls: any[] = [];
  const sms = {
    isConfigured: () => true,
    send: async (input: any) => { smsCalls.push(input); return { providerMessageId: `sms-${input.to}` }; },
    sendWithGateway: async (_gateway: string, cfg: any, input: any) => {
      smsCalls.push({ senderId: cfg.senderId, to: input.to });
      return { providerMessageId: `sms-${cfg.senderId}-${input.to}` };
    },
  } as any;
  const svc = new MessagingService(tables as any, { log: async () => undefined } as any, email, sms);
  return { svc, tables, emailCalls, smsCalls };
}

const snapEntry = (n: number) => ({
  type: "customer", id: `c${n}`, name: `User${n}`, email: `user${n}@example.com`,
  phone: `0171234567${n}`, status: "pending", attempts: 0,
});
function seedBroadcast(tables: any, id: string, extra: any = {}) {
  const row = {
    id, organizationId: "org-1", name: id, channel: "email", subject: "Offer", body: "Hello",
    status: "sending", recipientSnapshot: [snapEntry(1)], totalRecipients: 1,
    sentCount: 0, failedCount: 0, createdById: "owner",
    createdAt: new Date(Date.now() - 60 * 60 * 1000), updatedAt: new Date(Date.now() - 60 * 60 * 1000),
    ...extra,
  };
  tables.broadcast.rows.push(row);
  return row;
}

describe("MX3 pure quiet-hours helper", () => {
  const overnight = { enabled: true, start: "22:00", end: "08:00", timezone: "Asia/Dhaka" };
  it("isValidHhMm accepts strict HH:mm and rejects loose/invalid forms", () => {
    expect(isValidHhMm("00:00")).toBe(true);
    expect(isValidHhMm("22:30")).toBe(true);
    expect(isValidHhMm("9:00")).toBe(false);
    expect(isValidHhMm("24:00")).toBe(false);
    expect(isValidHhMm("22:60")).toBe(false);
    expect(isValidHhMm("9pm")).toBe(false);
    expect(isValidHhMm(null)).toBe(false);
  });

  it("localMinutesOfDay evaluates in the given timezone", () => {
    expect(localMinutesOfDay(DHAKA_2330, "Asia/Dhaka")).toBe(23 * 60 + 30);
    expect(localMinutesOfDay(DHAKA_2330, "UTC")).toBe(17 * 60 + 30);
    expect(localMinutesOfDay(DHAKA_2330, "Not/AZone")).toBeNull();
  });

  it("overnight window 22:00–08:00: active late evening AND early morning, inactive midday", () => {
    expect(isQuietHoursActive(overnight, DHAKA_2330)).toBe(true); // 23:30 Dhaka
    expect(isQuietHoursActive(overnight, new Date("2026-10-16T21:00:00.000Z"))).toBe(true); // 03:00 Dhaka
    expect(isQuietHoursActive(overnight, DHAKA_1200)).toBe(false); // 12:00 Dhaka
  });

  it("boundary minutes: start is inclusive, end is exclusive", () => {
    expect(isQuietHoursActive(overnight, new Date("2026-10-16T16:00:00.000Z"))).toBe(true); // exactly 22:00
    expect(isQuietHoursActive(overnight, new Date("2026-10-16T01:59:00.000Z"))).toBe(true); // 07:59
    expect(isQuietHoursActive(overnight, new Date("2026-10-16T02:00:00.000Z"))).toBe(false); // exactly 08:00
  });

  it("normal window, disabled setting, empty window and bad data never activate", () => {
    const day = { enabled: true, start: "09:00", end: "17:00", timezone: "Asia/Dhaka" };
    expect(isQuietHoursActive(day, DHAKA_1200)).toBe(true);
    expect(isQuietHoursActive(day, DHAKA_2330)).toBe(false);
    expect(isQuietHoursActive({ ...overnight, enabled: false }, DHAKA_2330)).toBe(false);
    expect(isQuietHoursActive({ enabled: true, start: "22:00", end: "22:00", timezone: "Asia/Dhaka" }, DHAKA_2330)).toBe(false);
    expect(isQuietHoursActive({ enabled: true, start: null, end: "08:00", timezone: "Asia/Dhaka" }, DHAKA_2330)).toBe(false);
    // The SAME instant in UTC is outside the window — the timezone is really used.
    expect(isQuietHoursActive({ ...overnight, timezone: "UTC" }, DHAKA_2330)).toBe(false);
  });
});

describe("MX3 quiet-hours gate (fixture clock)", () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it("inside the window: processBroadcast defers — zero provider calls, recipients stay pending, honest result", async () => {
    jest.setSystemTime(DHAKA_2330); // 23:30 Dhaka, inside 22:00–08:00
    const { svc, tables, emailCalls } = build({
      setting: { quietHoursEnabled: true, quietHoursStart: "22:00", quietHoursEnd: "08:00" },
    });
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "night", channel: "email", subject: "Offer", body: "Hello", audienceType: "customers",
    } as any);
    const sent: any = await svc.sendBroadcast("org-1", "owner", bc.id);
    // Manual send inside quiet hours DEFERS (documented MX3
    // decision): the response says so, nothing was sent.
    expect(sent.deferred).toBe("quiet_hours");
    expect(sent.status).toBe("sending");
    expect(emailCalls).toHaveLength(0);
    expect(tables.messageDelivery.rows).toHaveLength(0);
    const rows = tables.broadcastRecipient.rows.filter((r: any) => r.broadcastId === bc.id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r: any) => r.status === "pending")).toBe(true);
    // After the window the SAME broadcast sends normally.
    jest.setSystemTime(new Date("2026-10-17T03:00:00.000Z")); // 09:00 Dhaka next day
    const sent2: any = await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(sent2.deferred).toBeUndefined();
    expect(sent2.status).toBe("sent");
    expect(emailCalls.length).toBe(rows.length);
  });

  it("legacy snapshot broadcast defers too, with honest pending counts", async () => {
    jest.setSystemTime(DHAKA_2330);
    const { svc, tables, emailCalls } = build({
      setting: { quietHoursEnabled: true, quietHoursStart: "22:00", quietHoursEnd: "08:00" },
    });
    seedBroadcast(tables, "bc-legacy", { recipientSnapshot: [snapEntry(1), snapEntry(2)] });
    const r = await svc.processBroadcast("org-1", "bc-legacy");
    expect(r).toMatchObject({ deferred: "quiet_hours", processed: 0, pending: 2, finalized: false, status: "sending" });
    expect(emailCalls).toHaveLength(0);
    const row = tables.broadcast.rows.find((b: any) => b.id === "bc-legacy");
    expect(row.recipientSnapshot.every((e: any) => e.status === "pending")).toBe(true);
  });

  it("sweep defers the whole run inside the window and sends on the next sweep after it", async () => {
    jest.setSystemTime(DHAKA_2330);
    const { svc, tables, emailCalls } = build({
      setting: { quietHoursEnabled: true, quietHoursStart: "22:00", quietHoursEnd: "08:00" },
    });
    seedBroadcast(tables, "bc-due", { status: "scheduled", scheduledAt: new Date(Date.now() - 5 * 60 * 1000) });
    seedBroadcast(tables, "bc-stale", { status: "sending" }); // updatedAt 1h ago ⇒ stale
    const r1: any = await svc.runDueBroadcasts("org-1");
    expect(r1.deferred).toBe("quiet_hours");
    expect(r1.deferredBroadcasts).toBe(2);
    expect(r1.started).toBe(0);
    expect(r1.recovered).toBe(0);
    expect(emailCalls).toHaveLength(0);
    expect(tables.broadcast.rows.find((b: any) => b.id === "bc-due").status).toBe("scheduled");
    // Window over: the next sweep starts the due one and recovers the stale one.
    jest.setSystemTime(new Date("2026-10-17T03:00:00.000Z")); // 09:00 Dhaka
    const r2: any = await svc.runDueBroadcasts("org-1");
    expect(r2.deferred).toBeUndefined();
    expect(r2.started).toBe(1);
    expect(r2.recovered).toBe(1);
    expect(emailCalls).toHaveLength(2);
    expect(tables.broadcast.rows.find((b: any) => b.id === "bc-due").status).toBe("sent");
    expect(tables.broadcast.rows.find((b: any) => b.id === "bc-stale").status).toBe("sent");
  });

  it("disabled quiet hours never defer, even inside the would-be window", async () => {
    jest.setSystemTime(DHAKA_2330);
    const { svc, tables, emailCalls } = build({
      setting: { quietHoursEnabled: false, quietHoursStart: "22:00", quietHoursEnd: "08:00" },
    });
    seedBroadcast(tables, "bc-now", {});
    const r = await svc.processBroadcast("org-1", "bc-now");
    expect(r.deferred).toBeUndefined();
    expect(r.finalized).toBe(true);
    expect(emailCalls).toHaveLength(1);
  });
});

describe("MX3 sweep caps", () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(DHAKA_1200); });
  afterEach(() => { jest.useRealTimers(); });

  it("broadcast cap: at most N broadcasts per sweep run; the rest stay queued and are counted", async () => {
    const { svc, tables, emailCalls } = build({ setting: { marketingMaxBroadcastsPerSweep: 2 } });
    for (const id of ["bc-a", "bc-b", "bc-c"]) {
      seedBroadcast(tables, id, { status: "scheduled", scheduledAt: new Date(Date.now() - 5 * 60 * 1000) });
    }
    const r1: any = await svc.runDueBroadcasts("org-1");
    expect(r1.started).toBe(2);
    expect(r1.skippedByLimit).toBe(1);
    expect(emailCalls).toHaveLength(2);
    const stillQueued = tables.broadcast.rows.filter((b: any) => b.status === "scheduled");
    expect(stillQueued).toHaveLength(1);
    // The next run picks up exactly the remainder.
    const r2: any = await svc.runDueBroadcasts("org-1");
    expect(r2.started).toBe(1);
    expect(r2.skippedByLimit).toBe(0);
    expect(tables.broadcast.rows.every((b: any) => b.status === "sent")).toBe(true);
  });

  it("entries cap: one broadcast processes at most N entries per sweep run and is continued by the next run", async () => {
    const { svc, tables, emailCalls } = build({ setting: { marketingMaxEntriesPerSweep: 2 } });
    seedBroadcast(tables, "bc-big", {
      status: "scheduled", scheduledAt: new Date(Date.now() - 5 * 60 * 1000),
      recipientSnapshot: [snapEntry(1), snapEntry(2), snapEntry(3)], totalRecipients: 3,
    });
    const r1: any = await svc.runDueBroadcasts("org-1");
    expect(r1.started).toBe(1);
    expect(r1.processed).toBe(2);
    expect(r1.finalized).toBe(0);
    expect(emailCalls).toHaveLength(2);
    const row = tables.broadcast.rows.find((b: any) => b.id === "bc-big");
    // Partially processed and NOT finalized: the row keeps its
    // pre-run status ("scheduled" — the snapshot engine only
    // writes a status at finalize/pause/cancel; pre-MX3
    // behaviour), so the next sweep's due phase continues it.
    expect(row.status).toBe("scheduled");
    expect(row.recipientSnapshot.filter((e: any) => e.status === "pending")).toHaveLength(1);
    // The next sweep finishes exactly the remaining one — no re-sends.
    const r2: any = await svc.runDueBroadcasts("org-1");
    expect(r2.started).toBe(1);
    expect(r2.processed).toBe(1);
    expect(r2.finalized).toBe(1);
    expect(emailCalls).toHaveLength(3);
    expect(tables.broadcast.rows.find((b: any) => b.id === "bc-big").status).toBe("sent");
  });

  it("unset caps reproduce the platform defaults in the settings view", async () => {
    const { svc } = build({ setting: {} });
    const view: any = await svc.getMessagingSettingsView("org-1");
    expect(view.marketingMaxBroadcastsPerSweep).toBeNull();
    expect(view.marketingMaxEntriesPerSweep).toBeNull();
    expect(view.effectiveMaxBroadcastsPerSweep).toBe(20);
    expect(view.effectiveMaxEntriesPerSweep).toBe(200);
    expect(view.quietHoursEnabled).toBe(false);
    expect(view.quietHoursActive).toBe(false);
    expect(view.timezone).toBe("Asia/Dhaka");
  });
});

describe("MX3 settings validation + round-trip", () => {
  it("rejects bad HH:mm, an empty window, enabling without both bounds, and out-of-range caps", async () => {
    const { svc } = build({ setting: {} });
    await expect(svc.updateMessagingSetting("org-1", "owner", { quietHoursStart: "9pm" })).rejects.toThrow(/HH:mm/);
    await expect(svc.updateMessagingSetting("org-1", "owner", { quietHoursEnd: "24:00" })).rejects.toThrow(/HH:mm/);
    await expect(svc.updateMessagingSetting("org-1", "owner", { quietHoursEnabled: true, quietHoursStart: "22:00" })).rejects.toMatchObject({ code: "messaging.quietHoursStartAndQuietHoursEndAreBothRequired" });
    await expect(svc.updateMessagingSetting("org-1", "owner", { quietHoursEnabled: true, quietHoursStart: "22:00", quietHoursEnd: "22:00" })).rejects.toMatchObject({ code: "messaging.quietHoursStartAndQuietHoursEndMustDifferAn" });
    await expect(svc.updateMessagingSetting("org-1", "owner", { marketingMaxBroadcastsPerSweep: 0 })).rejects.toMatchObject({ code: "messaging.marketingMaxBroadcastsPerSweepMustBeNullPlatformDefa" });
    await expect(svc.updateMessagingSetting("org-1", "owner", { marketingMaxBroadcastsPerSweep: 51 })).rejects.toMatchObject({ code: "messaging.marketingMaxBroadcastsPerSweepMustBeNullPlatformDefa" });
    await expect(svc.updateMessagingSetting("org-1", "owner", { marketingMaxEntriesPerSweep: 5001 })).rejects.toMatchObject({ code: "messaging.marketingMaxEntriesPerSweepMustBeNullPlatformDefault" });
    await expect(svc.updateMessagingSetting("org-1", "owner", { marketingMaxEntriesPerSweep: 2.5 })).rejects.toMatchObject({ code: "messaging.marketingMaxEntriesPerSweepMustBeNullPlatformDefault" });
  });

  it("round-trips caps + quiet hours through PATCH → GET; null clears a cap back to the default", async () => {
    const { svc } = build({ setting: {} });
    const updated: any = await svc.updateMessagingSetting("org-1", "owner", {
      marketingMaxBroadcastsPerSweep: 3, marketingMaxEntriesPerSweep: 40,
      quietHoursEnabled: true, quietHoursStart: "22:00", quietHoursEnd: "08:00",
    });
    expect(updated).toMatchObject({
      marketingMaxBroadcastsPerSweep: 3, marketingMaxEntriesPerSweep: 40,
      quietHoursEnabled: true, quietHoursStart: "22:00", quietHoursEnd: "08:00",
    });
    const view: any = await svc.getMessagingSettingsView("org-1");
    expect(view).toMatchObject({
      marketingMaxBroadcastsPerSweep: 3, effectiveMaxBroadcastsPerSweep: 3,
      marketingMaxEntriesPerSweep: 40, effectiveMaxEntriesPerSweep: 40,
      quietHoursEnabled: true, quietHoursStart: "22:00", quietHoursEnd: "08:00", timezone: "Asia/Dhaka",
    });
    // The pre-MX3 internal shape is untouched.
    expect(await svc.getMessagingSetting("org-1")).toEqual({
      frequencyCapPerDay: 0, whatsappOptInRequired: false, linkTrackingEnabled: true,
    });
    await svc.updateMessagingSetting("org-1", "owner", { marketingMaxBroadcastsPerSweep: null });
    const view2: any = await svc.getMessagingSettingsView("org-1");
    expect(view2.marketingMaxBroadcastsPerSweep).toBeNull();
    expect(view2.effectiveMaxBroadcastsPerSweep).toBe(20);
  });
});

describe("MX3 transactional overview (read-only)", () => {
  it("aggregates recent logs (with order refs), the setting status and the count summary", async () => {
    const { svc, tables } = build({ setting: {} });
    tables.orderNotificationSetting.rows.push({
      id: "onset-1", organizationId: "org-1",
      config: {
        order_placed: { enabled: true, channels: ["sms", "email"], templates: { sms: null, whatsapp: null, email: null } },
        delivered: { enabled: false, channels: ["sms"], templates: { sms: null, whatsapp: null, email: null } },
      },
    });
    const order = { externalNumber: "1001", externalId: "ext-9" };
    tables.orderNotificationLog.rows.push(
      { id: "log-1", organizationId: "org-1", orderId: "ord-1", event: "order_placed", channel: "sms", status: "sent", providerMessageId: "pm-1", error: null, createdAt: new Date("2026-10-16T05:00:00Z"), order },
      { id: "log-2", organizationId: "org-1", orderId: "ord-1", event: "order_placed", channel: "email", status: "failed_error", providerMessageId: null, error: "SMTP down", createdAt: new Date("2026-10-16T04:00:00Z"), order },
      { id: "log-3", organizationId: "org-1", orderId: "ord-2", event: "delivered", channel: "sms", status: "sent", providerMessageId: null, error: null, createdAt: new Date("2026-10-16T03:00:00Z") },
    );
    const ov: any = await svc.getTransactionalOverview("org-1");
    expect(ov.setting.configured).toBe(true);
    expect(ov.setting.totalEvents).toBe(8);
    // Defaults enable order_placed + delivered; the override
    // disables delivered, so exactly ONE event stays enabled.
    expect(ov.setting.enabledEvents).toBe(1);
    expect(ov.setting.channelsInUse).toEqual(["sms", "email"]);
    expect(ov.setting.events.find((e: any) => e.event === "delivered").enabled).toBe(false);
    expect(ov.recent).toHaveLength(3);
    expect(ov.recent[0]).toMatchObject({ id: "log-1", orderRef: "1001", event: "order_placed", channel: "sms", status: "sent" });
    expect(ov.recent[2].orderRef).toBe("ord-2"); // no relation resolved ⇒ the raw orderId, never invented
    expect(ov.summary).toEqual({ total: 3, sent: 2, failed: 1 });
  });

  it("honest empty state: no setting row ⇒ configured=false with the defaults shown; no logs ⇒ empty + zero counts", async () => {
    const { svc } = build({ setting: {} });
    const ov: any = await svc.getTransactionalOverview("org-1");
    expect(ov.setting.configured).toBe(false);
    expect(ov.setting.enabledEvents).toBe(2); // ON5 defaults: order_placed + delivered
    expect(ov.recent).toEqual([]);
    expect(ov.summary).toEqual({ total: 0, sent: 0, failed: 0 });
  });

  it("missing transactional tables never break Messaging: null setting, empty recent, null counts", async () => {
    const { svc, tables } = build({ setting: {} });
    delete tables.orderNotificationLog;
    delete tables.orderNotificationSetting;
    const ov: any = await svc.getTransactionalOverview("org-1");
    expect(ov.setting).toBeNull();
    expect(ov.recent).toEqual([]);
    expect(ov.summary).toEqual({ total: null, sent: null, failed: null });
  });
});

describe("MX3 transactional exemption", () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(DHAKA_2330); });
  afterEach(() => { jest.useRealTimers(); });

  it("OrderNotificationService.notify still sends while marketing quiet hours defer the broadcast engine", async () => {
    const { svc, tables, emailCalls } = build({
      setting: { quietHoursEnabled: true, quietHoursStart: "22:00", quietHoursEnd: "08:00" },
    });
    // Marketing side: deferred, zero provider calls.
    seedBroadcast(tables, "bc-mkt", {});
    const mkt = await svc.processBroadcast("org-1", "bc-mkt");
    expect(mkt.deferred).toBe("quiet_hours");
    expect(emailCalls).toHaveLength(0);
    // Transactional side: notify() never touches MessagingService
    // — its own channel loop sends via ShopAccountService's SMS
    // path and records the log, quiet hours notwithstanding.
    tables.order.rows.push({
      id: "ord-1", organizationId: "org-1", externalNumber: "1001", totalMinor: 50000,
      customerId: "c1", isPractice: false, conversationId: null,
      customer: { firstName: "User1", lastName: null, phone: "01712345678", email: null },
    });
    const shopSmsCalls: any[] = [];
    const shopAccount = {
      sendShopSms: async (orgId: string, phone: string, text: string, ref: string) => {
        shopSmsCalls.push({ orgId, phone, text, ref });
        return { sent: true };
      },
    } as any;
    const emailProvider = { isConfigured: () => true, send: async () => ({ providerMessageId: "x" }) } as any;
    const onSvc = new OrderNotificationService(tables as any, { log: async () => undefined } as any, shopAccount, emailProvider, undefined, undefined);
    const res: any = await onSvc.notify("org-1", "ord-1", "order_placed");
    expect(res.sent).toBe(true);
    expect(res.channel).toBe("sms");
    expect(shopSmsCalls).toHaveLength(1);
    const logs = tables.orderNotificationLog.rows.filter((l: any) => l.orderId === "ord-1");
    expect(logs.some((l: any) => l.status === "sent" && l.channel === "sms")).toBe(true);
  });
});
