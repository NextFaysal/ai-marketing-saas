import "reflect-metadata";
import { FulfillmentExcellenceService } from "./fulfillment-excellence.service";
import { computeSlaStage } from "./sla";
import { QUEUE_KEYS, QUEUE_LABELS } from "../orders/order-queues";

/**
 * ON6 — Fulfillment Excellence. Fake-Prisma harness in the
 * on4/on5 style. The sla_breach queue is asserted at the
 * constants level here (QUEUE_KEYS / label) plus thorough
 * computeSlaStage coverage — OrdersService itself is too heavy
 * to construct in this spec (its resolver wiring is verified by
 * the on1-queues spec's count==list run, which now includes the
 * new key).
 */

function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
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
    findMany: async ({ where, take }: any = {}) => {
      const out = rows.filter((r) => matchWhere(r, where));
      return take !== undefined ? out.slice(0, take) : out;
    },
    create: async ({ data }: any) => {
      const row = { id: data.id ?? `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("record not found");
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => matchWhere(r, where));
      if (idx >= 0) rows.splice(idx, 1);
      return {};
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

function setup(opts: { remaining?: Map<string, Map<string, number>> } = {}) {
  const tables = {
    fulfillmentSetting: makeTable("setting"),
    pickWave: makeTable("wave"),
    pickWaveOrder: makeTable("waveOrder"),
    deliveryAttempt: makeTable("attempt"),
    courierShipment: makeTable("shipment"),
    order: makeTable("order"),
    fulfillment: makeTable("fulfillment"),
    membership: makeTable("membership"),
    agentNotification: makeTable("agentNotification"),
  };
  const prisma: any = { ...tables };
  const audit = { log: jest.fn(async () => undefined) };
  const remaining = opts.remaining ?? new Map<string, Map<string, number>>();
  const fulfillmentsStub: any = {
    remainingFor: jest.fn(async (_org: string, order: any) => remaining.get(order.id) ?? new Map()),
    loadOrder: jest.fn(async (_org: string, orderId: string) => {
      const order = tables.order.rows.find((o) => o.id === orderId);
      if (!order) throw new Error("Order not found in this organization");
      return order;
    }),
    create: jest.fn(async () => ({ id: "f-new" })),
    update: jest.fn(async () => ({ id: "f-new", status: "packed" })),
  };
  const ordersStub: any = { resolveQueueOrderIds: jest.fn(async () => []) };
  const courierRulesStub: any = {
    factsForOrder: jest.fn(async (_org: string, order: any) => ({ orderId: order.id })),
    evaluate: jest.fn(async () => null),
  };
  const notificationsStub: any = { notify: jest.fn(async () => ({ sent: false })) };
  const svc = new FulfillmentExcellenceService(
    prisma, fulfillmentsStub, ordersStub, courierRulesStub, audit as any, notificationsStub,
  );
  return { svc, tables, prisma, audit, fulfillmentsStub, ordersStub, courierRulesStub, notificationsStub };
}

const NOW = new Date("2026-10-14T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86400_000);
const SETTING = { confirmToPackHours: 24, packToHandoverHours: 24, stuckDays: 5 };

describe("ON6 computeSlaStage (pure)", () => {
  it("awaiting_pack: breach only strictly past confirmToPackHours", () => {
    const atBoundary = computeSlaStage({ status: "processing", placedAt: hoursAgo(24) }, [], [], SETTING, NOW);
    expect(atBoundary.stage).toBe("awaiting_pack");
    expect(atBoundary.ageHours).toBe(24);
    expect(atBoundary.breached).toBe(false);
    const past = computeSlaStage({ status: "processing", placedAt: hoursAgo(25) }, [], [], SETTING, NOW);
    expect(past.breached).toBe(true);
    expect(past.stageSince?.toISOString()).toBe(hoursAgo(25).toISOString());
    const fresh = computeSlaStage({ status: "pending", placedAt: hoursAgo(2) }, [], [], SETTING, NOW);
    expect(fresh.breached).toBe(false);
    // placedAt falls back to createdAt
    const fallback = computeSlaStage({ status: "processing", placedAt: null, createdAt: hoursAgo(30) }, [], [], SETTING, NOW);
    expect(fallback.breached).toBe(true);
  });

  it("awaiting_handover: packed (updatedAt approximation), no shipment", () => {
    const packed = [{ status: "packed", updatedAt: hoursAgo(25), createdAt: hoursAgo(30) }];
    const out = computeSlaStage({ status: "processing", placedAt: hoursAgo(72) }, packed, [], SETTING, NOW);
    expect(out.stage).toBe("awaiting_handover");
    expect(out.stageSince?.toISOString()).toBe(hoursAgo(25).toISOString());
    expect(out.breached).toBe(true);
    const within = computeSlaStage({ status: "processing", placedAt: hoursAgo(72) },
      [{ status: "handed_over", updatedAt: hoursAgo(3), createdAt: hoursAgo(4) }], [], SETTING, NOW);
    expect(within.stage).toBe("awaiting_handover");
    expect(within.breached).toBe(false);
    // a merely pending fulfilment does NOT start the handover stage
    const pendingOnly = computeSlaStage({ status: "processing", placedAt: hoursAgo(1) },
      [{ status: "pending", updatedAt: hoursAgo(1), createdAt: hoursAgo(1) }], [], SETTING, NOW);
    expect(pendingOnly.stage).toBe("awaiting_pack");
  });

  it("shipped / not_applicable for done orders and shipped orders", () => {
    const packed = [{ status: "packed", updatedAt: hoursAgo(100), createdAt: hoursAgo(100) }];
    expect(computeSlaStage({ status: "processing", placedAt: hoursAgo(100) }, packed, [{ id: "s1" }], SETTING, NOW))
      .toEqual({ stage: "shipped", stageSince: null, ageHours: null, breached: false });
    expect(computeSlaStage({ status: "delivered", placedAt: hoursAgo(100) }, [], [], SETTING, NOW).stage).toBe("not_applicable");
    expect(computeSlaStage({ status: "completed", placedAt: hoursAgo(100) }, [], [{ id: "s1" }], SETTING, NOW).stage).toBe("shipped");
    expect(computeSlaStage({ status: "cancelled", placedAt: hoursAgo(100) }, [], [], SETTING, NOW).breached).toBe(false);
    expect(computeSlaStage({ status: "refunded", placedAt: hoursAgo(100) }, [], [{ id: "s1" }], SETTING, NOW).stage).toBe("shipped");
  });

  it("held orders still compute (the SLA clock runs during a hold — v1 choice)", () => {
    const out = computeSlaStage({ status: "processing", reviewHold: true, placedAt: hoursAgo(30) }, [], [], SETTING, NOW);
    expect(out.stage).toBe("awaiting_pack");
    expect(out.breached).toBe(true);
  });

  it("sla_breach queue key + label are registered", () => {
    expect(QUEUE_KEYS).toContain("sla_breach");
    expect(QUEUE_LABELS.sla_breach).toBe("SLA ভঙ্গ হয়েছে");
  });
});

describe("ON6 settings", () => {
  it("lazy defaults, then PUT validates 1..720 and audits changed keys only", async () => {
    const { svc, audit } = setup();
    const before = await svc.getSettings("org-1");
    expect(before).toMatchObject({ confirmToPackHours: 24, packToHandoverHours: 24, stuckDays: 5 });
    await expect(svc.updateSettings("org-1", "actor", { confirmToPackHours: 0 })).rejects.toThrow(/১–৭২০/);
    await expect(svc.updateSettings("org-1", "actor", { stuckDays: 721 })).rejects.toThrow(/১–৭২০/);
    const after = await svc.updateSettings("org-1", "actor", { confirmToPackHours: 12, stuckDays: 5 });
    expect(after.confirmToPackHours).toBe(12);
    const call = (audit.log as jest.Mock).mock.calls.find((c) => c[0].action === "fulfillment.settings_updated");
    expect(call[0].metadata.changedKeys).toEqual(["confirmToPackHours"]);
  });
});

describe("ON6 pick waves", () => {
  function waveSetup() {
    const ctx = setup({ remaining: new Map([["o-good", new Map([["oi-g", 1]])]]) });
    const { tables } = ctx;
    tables.order.rows.push(
      { id: "o-good", organizationId: "org-1", status: "processing", reviewHold: false, externalNumber: "ORD-G", items: [{ id: "oi-g", quantity: 1 }] },
      { id: "o-held", organizationId: "org-1", status: "processing", reviewHold: true, externalNumber: "ORD-H", items: [{ id: "oi-h", quantity: 1 }] },
      { id: "o-terminal", organizationId: "org-1", status: "delivered", reviewHold: false, externalNumber: "ORD-T", items: [] },
      { id: "o-inwave", organizationId: "org-1", status: "processing", reviewHold: false, externalNumber: "ORD-W", items: [{ id: "oi-w", quantity: 1 }] },
    );
    tables.pickWave.rows.push({ id: "w-open", organizationId: "org-1", status: "open", createdById: "actor", createdAt: new Date() });
    tables.pickWaveOrder.rows.push({ id: "wo-open", waveId: "w-open", orderId: "o-inwave", createdAt: new Date() });
    return ctx;
  }

  it("create rejects held + terminal + already-in-open-wave per order, adds the good one", async () => {
    const { svc, tables, audit } = waveSetup();
    const out = await svc.createWave("org-1", "actor", { orderIds: ["o-good", "o-held", "o-terminal", "o-inwave", "o-missing"] });
    expect(out.results.find((r: any) => r.orderId === "o-good")?.ok).toBe(true);
    expect(out.results.find((r: any) => r.orderId === "o-held")?.error).toMatch(/review hold/);
    expect(out.results.find((r: any) => r.orderId === "o-terminal")?.ok).toBe(false);
    expect(out.results.find((r: any) => r.orderId === "o-inwave")?.error).toMatch(/খোলা ওয়েভে/);
    expect(out.results.find((r: any) => r.orderId === "o-missing")?.error).toBe("পাওয়া যায়নি");
    const waveOrders = tables.pickWaveOrder.rows.filter((r) => r.waveId === out.wave.id);
    expect(waveOrders.map((r) => r.orderId)).toEqual(["o-good"]);
    const call = (audit.log as jest.Mock).mock.calls.find((c) => c[0].action === "fulfillment.wave_created");
    expect(call[0].metadata).toEqual({ added: 1, failed: 4 });
  });

  it("zero passing orders => 400 with the reasons", async () => {
    const { svc, tables } = waveSetup();
    await expect(svc.createWave("org-1", "actor", { orderIds: ["o-held", "o-missing"] })).rejects.toThrow(/কোনো অর্ডারই/);
    expect(tables.pickWave.rows).toHaveLength(1); // only the pre-existing open wave
  });

  it("pick packs ALL remaining via FulfillmentService and is idempotent on re-pick", async () => {
    const remaining = new Map([["o-pick", new Map([["oi1", 2], ["oi2", 1]])]]);
    const { svc, tables, fulfillmentsStub } = setup({ remaining });
    tables.order.rows.push({ id: "o-pick", organizationId: "org-1", status: "processing", reviewHold: false, items: [{ id: "oi1", quantity: 2 }, { id: "oi2", quantity: 1 }] });
    tables.pickWave.rows.push({ id: "w1", organizationId: "org-1", status: "open", createdById: "actor", createdAt: new Date() });
    tables.pickWaveOrder.rows.push({ id: "wo1", waveId: "w1", orderId: "o-pick", pickedAt: null, pickedById: null, createdAt: new Date() });

    const picked = await svc.pickWaveOrder("org-1", "actor-9", "w1", "o-pick");
    expect(fulfillmentsStub.create).toHaveBeenCalledWith("org-1", "actor-9", "o-pick", {
      items: [{ orderItemId: "oi1", quantity: 2 }, { orderItemId: "oi2", quantity: 1 }],
    });
    expect(fulfillmentsStub.update).toHaveBeenCalledWith("org-1", "actor-9", "f-new", {
      packed: [{ orderItemId: "oi1", packed: true }, { orderItemId: "oi2", packed: true }],
    });
    expect(picked.pickedById).toBe("actor-9");
    expect(picked.pickedAt).toBeTruthy();

    const again = await svc.pickWaveOrder("org-1", "actor-9", "w1", "o-pick");
    expect(again.pickedAt).toEqual(picked.pickedAt);
    expect(fulfillmentsStub.create).toHaveBeenCalledTimes(1);
    expect(fulfillmentsStub.update).toHaveBeenCalledTimes(1);
  });

  it("pick with zero remaining just stamps (no fulfilment created)", async () => {
    const { svc, tables, fulfillmentsStub } = setup({ remaining: new Map([["o-cov", new Map([["oi1", 0]])]]) });
    tables.order.rows.push({ id: "o-cov", organizationId: "org-1", status: "processing", items: [{ id: "oi1", quantity: 1 }] });
    tables.pickWave.rows.push({ id: "w1", organizationId: "org-1", status: "open", createdById: "actor", createdAt: new Date() });
    tables.pickWaveOrder.rows.push({ id: "wo1", waveId: "w1", orderId: "o-cov", pickedAt: null, createdAt: new Date() });
    const picked = await svc.pickWaveOrder("org-1", "actor", "w1", "o-cov");
    expect(fulfillmentsStub.create).not.toHaveBeenCalled();
    expect(picked.pickedAt).toBeTruthy();
  });

  it("foreign wave is a 404; suggestions group by provider, then district, then অন্যান্য, and cap at 200", async () => {
    const { svc, tables, ordersStub, courierRulesStub } = setup();
    await expect(svc.getWave("org-1", "w-foreign")).rejects.toThrow(/not found/i);
    tables.order.rows.push(
      { id: "o-a", organizationId: "org-1", status: "processing", customer: { address: { district: "Khulna" } } },
      { id: "o-b", organizationId: "org-1", status: "processing", customer: { address: { district: "Dhaka" } } },
      { id: "o-c", organizationId: "org-1", status: "processing", customer: { address: { address_1: "অজানা ঠিকানা" } } },
    );
    (ordersStub.resolveQueueOrderIds as jest.Mock).mockResolvedValue(["o-a", "o-b", "o-c"]);
    (courierRulesStub.evaluate as jest.Mock).mockImplementation(async (_org: string, facts: any) =>
      facts.orderId === "o-a" ? { provider: "steadfast" } : null);
    const out = await svc.suggestWaves("org-1");
    expect(out.capped).toBe(false);
    expect(out.groups.find((g: any) => g.key === "steadfast")?.orderIds).toEqual(["o-a"]);
    expect(out.groups.find((g: any) => g.key === "Dhaka")?.orderIds).toEqual(["o-b"]);
    expect(out.groups.find((g: any) => g.key === "অন্যান্য")?.orderIds).toEqual(["o-c"]);
    (ordersStub.resolveQueueOrderIds as jest.Mock).mockResolvedValue(Array.from({ length: 205 }, (_, i) => `o-x${i}`));
    const capped = await svc.suggestWaves("org-1");
    expect(capped.capped).toBe(true);
    expect(capped.groups.reduce((s: number, g: any) => s + g.count, 0)).toBe(200);
  });
});

describe("ON6 stuck parcel sweep", () => {
  it("escalates exactly once per (shipment, status); a status change re-escalates", async () => {
    const { svc, tables, notificationsStub } = setup();
    tables.order.rows.push({ id: "o-s1", organizationId: "org-1", status: "processing", externalNumber: "ORD-101" });
    tables.courierShipment.rows.push(
      { id: "s1", organizationId: "org-1", orderId: "o-s1", provider: "steadfast", trackingCode: "TRK-1", status: "in_transit", updatedAt: daysAgo(10), escalatedAt: null, escalatedForStatus: null },
      { id: "s-fresh", organizationId: "org-1", orderId: "o-s1", provider: "steadfast", trackingCode: "TRK-2", status: "in_transit", updatedAt: daysAgo(1), escalatedAt: null },
      { id: "s-done", organizationId: "org-1", orderId: "o-s1", provider: "steadfast", trackingCode: "TRK-3", status: "delivered", updatedAt: daysAgo(10), escalatedAt: null },
    );
    tables.membership.rows.push(
      { id: "m1", organizationId: "org-1", userId: "u-owner", role: "OWNER", status: "ACTIVE" },
      { id: "m2", organizationId: "org-1", userId: "u-admin", role: "ADMIN", status: "ACTIVE" },
      { id: "m3", organizationId: "org-1", userId: "u-sup", role: "SUPPORT_AGENT", status: "ACTIVE" },
    );
    const first = await svc.runStuckParcelSweep("org-1", NOW);
    expect(first).toEqual({ checked: 1, escalated: 1, staffNotified: 2 });
    expect(notificationsStub.notify).toHaveBeenCalledTimes(1);
    expect(notificationsStub.notify).toHaveBeenCalledWith("org-1", "o-s1", "parcel_stuck", { shipmentId: "s1" });
    const notes = tables.agentNotification.rows;
    expect(notes).toHaveLength(2);
    expect(notes[0].type).toBe("urgent");
    expect(notes[0].title).toBe("পার্সেল আটকে আছে — অর্ডার ORD-101");
    expect(notes[0].body).toContain("TRK-1");

    const second = await svc.runStuckParcelSweep("org-1", NOW);
    expect(second.escalated).toBe(0);
    expect(notificationsStub.notify).toHaveBeenCalledTimes(1);

    // Status change re-arms: same shipment, new status, idle again.
    const s1 = tables.courierShipment.rows.find((r) => r.id === "s1");
    s1.status = "out_for_delivery";
    s1.updatedAt = daysAgo(9);
    const third = await svc.runStuckParcelSweep("org-1", NOW);
    expect(third.escalated).toBe(1);
    expect(s1.escalatedForStatus).toBe("out_for_delivery");
    expect(notificationsStub.notify).toHaveBeenCalledTimes(2);
  });
});

describe("ON6 delivery attempts", () => {
  function attemptSetup() {
    const ctx = setup();
    ctx.tables.order.rows.push({ id: "o1", organizationId: "org-1", status: "processing", externalNumber: "ORD-1" });
    ctx.tables.courierShipment.rows.push(
      { id: "s-old", organizationId: "org-1", orderId: "o1", provider: "steadfast", status: "out_for_delivery", createdAt: new Date("2026-10-01T00:00:00Z"), updatedAt: new Date() },
      { id: "s-new", organizationId: "org-1", orderId: "o1", provider: "pathao", status: "out_for_delivery", createdAt: new Date("2026-10-05T00:00:00Z"), updatedAt: new Date() },
      { id: "s-other", organizationId: "org-1", orderId: "o-other", provider: "pathao", status: "in_transit", createdAt: new Date(), updatedAt: new Date() },
    );
    return ctx;
  }

  it("rescheduled without a date => 400; invalid outcome / foreign shipment => 400", async () => {
    const { svc } = attemptSetup();
    await expect(svc.recordDeliveryAttempt("org-1", "actor", "o1", { outcome: "rescheduled" })).rejects.toThrow(/rescheduleDate/);
    await expect(svc.recordDeliveryAttempt("org-1", "actor", "o1", { outcome: "rescheduled", rescheduleDate: "20-10-2026" })).rejects.toThrow(/YYYY-MM-DD/);
    await expect(svc.recordDeliveryAttempt("org-1", "actor", "o1", { outcome: "bogus" })).rejects.toThrow(/outcome/);
    await expect(svc.recordDeliveryAttempt("org-1", "actor", "o1", { outcome: "refused", shipmentId: "s-other" })).rejects.toThrow(/শিপমেন্ট নয়/);
  });

  it("rescheduled with a date records against the latest shipment and notifies with the date", async () => {
    const { svc, tables, notificationsStub, audit } = attemptSetup();
    const row = await svc.recordDeliveryAttempt("org-1", "actor", "o1", {
      outcome: "rescheduled", rescheduleDate: "2026-10-20", note: "গ্রাহক বাড়ি নেই",
    });
    expect(row.shipmentId).toBe("s-new");
    expect(row.rescheduleDate).toBe("2026-10-20");
    expect(notificationsStub.notify).toHaveBeenCalledWith("org-1", "o1", "delivery_rescheduled", {
      shipmentId: "s-new", rescheduleDate: "2026-10-20",
    });
    const call = (audit.log as jest.Mock).mock.calls.find((c) => c[0].action === "fulfillment.delivery_attempt_recorded");
    expect(call[0].metadata).toEqual({ outcome: "rescheduled" }); // note content is NOT audited
    const listed = await svc.listDeliveryAttempts("org-1", "o1");
    expect(listed).toHaveLength(1);
    expect(tables.deliveryAttempt.rows).toHaveLength(1);
  });
});
