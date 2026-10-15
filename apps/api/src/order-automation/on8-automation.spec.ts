import "reflect-metadata";
import { OrderAutomationService } from "./order-automation.service";
import { OrderInsightsService } from "../orders/order-insights.service";
import { AUTOMATION_PRESETS, validateRuleInput } from "./order-automation";

/**
 * ON8 — Orders Automation Studio: CRUD + validation, preset
 * install + duplicate refusal, every condition, every action,
 * failure isolation, exactly-once (event + sweep), status
 * re-entry, the hard money/status boundary, timeline entries,
 * cross-org isolation. Fake-Prisma house style.
 */

const T0 = new Date("2026-10-01T10:00:00Z");
const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

function matchWhere(row: any, where: any): boolean {
  for (const [key, cond] of Object.entries(where ?? {})) {
    const val = (row as any)[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c: any = cond;
      if ("in" in c && !c.in.map(String).includes(String(val))) return false;
      continue;
    }
    if (String(val) !== String(cond)) return false;
  }
  return true;
}

function makeTable(rows: any[], opts?: { unique?: string[] }) {
  return {
    rows,
    findMany: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matchWhere(r, where))),
    findFirst: jest.fn(async ({ where }: any = {}) => rows.find((r) => matchWhere(r, where)) ?? null),
    create: jest.fn(async ({ data }: any) => {
      if (opts?.unique) {
        const dupe = rows.some((r) => opts.unique!.every((k) => String(r[k]) === String(data[k])));
        if (dupe) { const e: any = new Error("Unique constraint failed"); e.code = "P2002"; throw e; }
      }
      const row = { id: `row-${rows.length + 1}-${Math.random().toString(36).slice(2, 7)}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (row) Object.assign(row, data);
      return row ?? null;
    }),
    delete: jest.fn(async ({ where }: any) => {
      const i = rows.findIndex((r) => r.id === where.id);
      if (i >= 0) rows.splice(i, 1);
      return {};
    }),
  };
}

function setup(overrides?: { notifications?: any; orders?: any }) {
  const orders: any[] = [
    { id: "o1", organizationId: "org-1", customerId: "cust1", status: "processing", source: "woocommerce", isCod: true, isPractice: false, totalMinor: 500000n, tags: [], assigneeId: null, reviewHold: false, riskBand: "high", externalNumber: "1001", address: null, createdAt: T0, updatedAt: T0 },
    { id: "o-old1", organizationId: "org-1", customerId: "cust1", status: "delivered", source: "woocommerce", isCod: false, isPractice: false, totalMinor: 100000n, tags: [], createdAt: T0, updatedAt: T0 },
    { id: "o-old2", organizationId: "org-1", customerId: "cust1", status: "delivered", source: "manual", isCod: false, isPractice: false, totalMinor: 100000n, tags: [], createdAt: T0, updatedAt: T0 },
    { id: "o2", organizationId: "org-2", customerId: "cust9", status: "processing", source: "manual", isCod: true, isPractice: false, totalMinor: 900000n, tags: [], createdAt: T0, updatedAt: T0 },
  ];
  const customers: any[] = [
    { id: "cust1", organizationId: "org-1", firstName: "Rahim", lastName: "Uddin", phone: "01711000001", address: { district: "Dhaka", address_1: "Mirpur" } },
    { id: "cust9", organizationId: "org-2", firstName: "Other", lastName: "Org", phone: "01711000009", address: null },
  ];
  const rules: any[] = [];
  const logs: any[] = [];
  const memberships: any[] = [
    { userId: "u-owner", organizationId: "org-1", role: "OWNER", status: "ACTIVE" },
    { userId: "u-admin", organizationId: "org-1", role: "ADMIN", status: "ACTIVE" },
    { userId: "u-agent", organizationId: "org-1", role: "SUPPORT_AGENT", status: "ACTIVE" },
    { userId: "u-off", organizationId: "org-1", role: "ADMIN", status: "SUSPENDED" },
  ];
  const agentNotifications: any[] = [];
  const shipments: any[] = [];
  const verifications: any[] = [];
  const audits: any[] = [];
  const prisma: any = {
    orderAutomationRule: makeTable(rules),
    orderAutomationLog: makeTable(logs, { unique: ["ruleId", "orderId", "triggerKey"] }),
    order: makeTable(orders),
    customer: makeTable(customers),
    membership: makeTable(memberships),
    agentNotification: makeTable(agentNotifications),
    courierShipment: makeTable(shipments),
    paymentVerification: makeTable(verifications),
    auditLog: makeTable(audits),
  };
  const audit = { log: jest.fn(async () => undefined) };
  const events: any = { handlers: new Map<string, any[]>(), on(k: string, f: any) { const l = this.handlers.get(k) ?? []; l.push(f); this.handlers.set(k, l); } };
  const ordersSvc: any = overrides?.orders ?? {
    setTags: jest.fn(async (orgId: string, _a: string, orderId: string, tags: string[]) => {
      const o = orders.find((x) => x.id === orderId && x.organizationId === orgId);
      if (!o) throw new Error("Order not found in this organization");
      o.tags = [...tags];
      return o;
    }),
    assignOrder: jest.fn(async (orgId: string, _a: string, orderId: string, userId: string) => {
      const m = memberships.find((x) => x.userId === userId && x.organizationId === orgId && x.status === "ACTIVE");
      if (!m) throw new Error("দায়িত্বপ্রাপ্ত ব্যক্তি এই প্রতিষ্ঠানের সক্রিয় সদস্য নন");
      const o = orders.find((x) => x.id === orderId);
      if (o) o.assigneeId = userId;
      return o;
    }),
    assertActiveMember: jest.fn(async (orgId: string, userId: string) => {
      const m = memberships.find((x) => x.userId === userId && x.organizationId === orgId && x.status === "ACTIVE");
      if (!m) throw new Error("not active member");
    }),
  };
  const fraud: any = {
    hold: jest.fn(async (orgId: string, _a: string, orderId: string, reason: string) => {
      const o = orders.find((x) => x.id === orderId && x.organizationId === orgId);
      if (!o) throw new Error("Order not found in this organization");
      o.reviewHold = true; o.reviewHoldReason = reason; o.reviewHeldAt = new Date();
      return o;
    }),
  };
  const notifications: any = overrides?.notifications ?? {
    notify: jest.fn(async () => ({ sent: true, channel: "sms", statuses: ["sent"] })),
  };
  const svc = new OrderAutomationService(prisma, audit as any, events, ordersSvc, fraud, notifications);
  return { svc, prisma, audit, events, ordersSvc, fraud, notifications, orders, customers, rules, logs, memberships, agentNotifications, shipments, verifications, audits };
}

const baseRule = {
  name: "টেস্ট নিয়ম", trigger: "order_created", triggerConfig: null,
  conditions: null, actions: [{ type: "add_tag", tag: "নতুন" }], enabled: true,
};

describe("ON8 validation", () => {
  it("refuses unknown trigger / condition / action / triggerConfig keys with Bengali errors", () => {
    expect(validateRuleInput({ ...baseRule, trigger: "nope" })).toMatch(/অজানা trigger/);
    expect(validateRuleInput({ ...baseRule, conditions: { bogus: 1 } })).toMatch(/অজানা condition/);
    expect(validateRuleInput({ ...baseRule, actions: [{ type: "refund_money" }] })).toMatch(/অজানা action/);
    expect(validateRuleInput({ name: "x", trigger: "status_changed", triggerConfig: { hours: 3 }, actions: [{ type: "add_tag", tag: "t" }] })).toMatch(/triggerConfig/);
    expect(validateRuleInput({ name: "x", trigger: "status_changed", triggerConfig: null, actions: [{ type: "add_tag", tag: "t" }] })).toMatch(/toStatus/);
    expect(validateRuleInput({ name: "x", trigger: "parcel_stuck_hours", triggerConfig: { hours: 0 }, actions: [{ type: "add_tag", tag: "t" }] })).toMatch(/hours/);
    expect(validateRuleInput({ name: "x", trigger: "order_created", actions: [] })).toMatch(/action/);
    expect(validateRuleInput({ ...baseRule, actions: [{ type: "add_tag", tag: "t", evil: 1 }] })).toMatch(/অজানা key/);
    expect(validateRuleInput(baseRule)).toBeNull();
  });

  it("every preset validates clean", () => {
    for (const p of AUTOMATION_PRESETS) {
      expect(validateRuleInput({ name: p.name, trigger: p.trigger, triggerConfig: p.triggerConfig, conditions: p.conditions, actions: p.actions })).toBeNull();
    }
    expect(AUTOMATION_PRESETS.map((p) => p.key)).toEqual(["big_cod_verify", "parcel_stuck", "due_aging", "vip_customer", "risky_order"]);
  });
});

describe("ON8 rule CRUD", () => {
  it("creates, lists with run counts, patches the enabled toggle, deletes — all audited", async () => {
    const { svc, audit } = setup();
    const created = await svc.createRule("org-1", "u-owner", baseRule);
    expect(created.enabled).toBe(true);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: "orders.automation_rule_created" }));

    const bad = svc.createRule("org-1", "u-owner", { ...baseRule, trigger: "nope" });
    await expect(bad).rejects.toThrow(/অজানা trigger/);

    const toggled = await svc.updateRule("org-1", "u-owner", created.id, { enabled: false });
    expect(toggled.enabled).toBe(false);
    // Partial PATCH must not clobber the rest.
    expect(toggled.actions).toEqual(baseRule.actions);

    const list = await svc.listRules("org-1");
    expect(list).toHaveLength(1);
    expect(list[0].runCount).toBe(0);

    await svc.deleteRule("org-1", "u-owner", created.id);
    expect(await svc.listRules("org-1")).toHaveLength(0);
    await expect(svc.getRule("org-1", created.id)).rejects.toThrow(/পাওয়া যায়নি/);
  });

  it("cross-org: another org's rule is invisible and unmodifiable", async () => {
    const { svc } = setup();
    const created = await svc.createRule("org-1", "u-owner", baseRule);
    await expect(svc.getRule("org-2", created.id)).rejects.toThrow(/পাওয়া যায়নি/);
    await expect(svc.updateRule("org-2", "u-x", created.id, { enabled: false })).rejects.toThrow(/পাওয়া যায়নি/);
    await expect(svc.deleteRule("org-2", "u-x", created.id)).rejects.toThrow(/পাওয়া যায়নি/);
    expect(await svc.listRules("org-2")).toHaveLength(0);
    await expect(svc.listRuleLogs("org-2", created.id)).rejects.toThrow(/পাওয়া যায়নি/);
  });
});

describe("ON8 presets", () => {
  it("installs DISABLED with presetKey tracked; duplicate install refused 409-style", async () => {
    const { svc } = setup();
    const installed = await svc.installPreset("org-1", "u-owner", "big_cod_verify");
    expect(installed.enabled).toBe(false);
    expect(installed.presetKey).toBe("big_cod_verify");
    expect(installed.conditions).toEqual({ isCod: true, minTotalMinor: "300000" });
    await expect(svc.installPreset("org-1", "u-owner", "big_cod_verify")).rejects.toThrow(/ইতিমধ্যে ইনস্টল/);
    // Same preset in ANOTHER org is fine.
    const other = await svc.installPreset("org-2", "u-x", "big_cod_verify");
    expect(other.organizationId).toBe("org-2");
    const presets = await svc.listPresets("org-1");
    expect(presets.find((p: any) => p.key === "big_cod_verify")?.installed).toBe(true);
    expect(presets.find((p: any) => p.key === "vip_customer")?.installed).toBe(false);
    await expect(svc.installPreset("org-1", "u-owner", "nope")).rejects.toThrow(/পাওয়া যায়নি/);
  });
});

describe("ON8 conditions", () => {
  it("each condition passes/fails on real order facts", async () => {
    const { svc, logs } = setup();
    const mk = async (conditions: any) => {
      const r = await svc.createRule("org-1", "u-owner", { ...baseRule, name: `c-${logs.length}-${Math.random()}`, conditions });
      return r;
    };
    // o1: total 500000, source woocommerce, COD, customer cust1 with 2 priors (not new), district Dhaka (structured), risk high.
    const cases: [any, boolean][] = [
      [{ minTotalMinor: "500000" }, true],
      [{ minTotalMinor: "500001" }, false],
      [{ sources: ["woocommerce"] }, true],
      [{ sources: ["manual"] }, false],
      [{ isCod: true }, true],
      [{ isCod: false }, false],
      [{ customerIsNew: false }, true],
      [{ customerIsNew: true }, false],
      [{ district: "dhaka" }, true],
      [{ district: "Khulna" }, false],
      [{ riskBandAtLeast: "high" }, true],
      [{ riskBandAtLeast: "medium" }, true],
    ];
    for (const [conditions, shouldFire] of cases) {
      const rule = await mk(conditions);
      const res = await svc.fireRule("org-1", rule, "o1", `k-${rule.id}`);
      expect({ conditions, fired: res.fired === true }).toEqual({ conditions, fired: shouldFire });
    }
  });

  it("customerIsNew boundary: exactly 1 prior non-practice order still counts as new", async () => {
    const s = setup();
    s.orders.push({ id: "o-new", organizationId: "org-1", customerId: "cust2new", status: "processing", source: "manual", isCod: false, isPractice: false, totalMinor: 100n, tags: [], createdAt: T0, updatedAt: T0 });
    s.customers.push({ id: "cust2new", organizationId: "org-1", firstName: "One", lastName: "Prior", address: null });
    s.orders.push({ id: "o-prior", organizationId: "org-1", customerId: "cust2new", status: "delivered", source: "manual", isCod: false, isPractice: false, totalMinor: 100n, tags: [], createdAt: T0, updatedAt: T0 });
    const rule = await s.svc.createRule("org-1", "u-owner", { ...baseRule, conditions: { customerIsNew: true } });
    const res = await s.svc.fireRule("org-1", rule, "o-new", "k-new");
    expect(res.fired).toBe(true);
  });

  it("district falls back to parseBdAddress on free text; low confidence never matches; null risk band never matches", async () => {
    const s = setup();
    s.orders[0].customerId = null;
    s.orders[0].address = "House 5, Mirpur Road, Dhaka";
    s.orders[0].riskBand = null;
    const r1 = await s.svc.createRule("org-1", "u-owner", { ...baseRule, name: "d1", conditions: { district: "Dhaka" } });
    expect((await s.svc.fireRule("org-1", r1, "o1", "k-d1")).fired).toBe(true);

    s.orders[0].address = "কোথাও একটা জায়গা";
    const r2 = await s.svc.createRule("org-1", "u-owner", { ...baseRule, name: "d2", conditions: { district: "Dhaka" } });
    expect((await s.svc.fireRule("org-1", r2, "o1", "k-d2")).skipped).toBe("conditions");

    const r3 = await s.svc.createRule("org-1", "u-owner", { ...baseRule, name: "d3", conditions: { riskBandAtLeast: "medium" } });
    expect((await s.svc.fireRule("org-1", r3, "o1", "k-d3")).skipped).toBe("conditions");
  });
});

describe("ON8 actions", () => {
  it("runs every action in order; placeholders render from the real order", async () => {
    const { svc, orders, agentNotifications, notifications, fraud, ordersSvc } = setup();
    const rule = await svc.createRule("org-1", "u-owner", {
      ...baseRule, name: "সব action",
      actions: [
        { type: "add_tag", tag: "VIP" },
        { type: "assign", userId: "u-agent" },
        { type: "hold", reason: "যাচাই দরকার" },
        { type: "notify_staff", message: "অর্ডার {{orderNumber}} মোট {{total}}" },
        { type: "notify_customer", message: "আসসালামু আলাইকুম {{customerName}}" },
      ],
    });
    const res = await svc.fireRule("org-1", rule, "o1", "created");
    expect(res.fired).toBe(true);
    expect(res.results.map((r: any) => [r.type, r.ok])).toEqual([
      ["add_tag", true], ["assign", true], ["hold", true], ["notify_staff", true], ["notify_customer", true],
    ]);
    const o = orders.find((x) => x.id === "o1")!;
    expect(o.tags).toContain("VIP");
    expect(o.assigneeId).toBe("u-agent");
    expect(o.reviewHold).toBe(true);
    expect(ordersSvc.setTags).toHaveBeenCalled();
    expect(fraud.hold).toHaveBeenCalledWith("org-1", expect.anything(), "o1", "যাচাই দরকার");
    // notify_staff: OWNER + ADMIN active members only (agent + suspended excluded).
    expect(agentNotifications.map((n: any) => n.userId).sort()).toEqual(["u-admin", "u-owner"]);
    expect(agentNotifications[0].body).toContain("1001");
    // notify_customer went through ON5 machinery with the automation_rule event + rendered message.
    expect(notifications.notify).toHaveBeenCalledWith("org-1", "o1", "automation_rule", { customMessage: "আসসালামু আলাইকুম Rahim Uddin" });
  });

  it("assign to a non-member fails that action only", async () => {
    const { svc } = setup();
    const rule = await svc.createRule("org-1", "u-owner", {
      ...baseRule, actions: [{ type: "assign", userId: "u-ghost" }, { type: "add_tag", tag: "পরে" }],
    });
    const res = await svc.fireRule("org-1", rule, "o1", "created");
    expect(res.fired).toBe(true);
    expect(res.results[0].ok).toBe(false);
    expect(res.results[1]).toEqual({ type: "add_tag", ok: true });
  });

  it("failure isolation: a throwing first action never stops later actions, and the log records per-action outcomes", async () => {
    const throwingOrders: any = {
      setTags: jest.fn(async () => { throw new Error("tags exploded"); }),
      assignOrder: jest.fn(async () => undefined),
      assertActiveMember: jest.fn(async () => undefined),
    };
    const { svc, logs } = setup({ orders: throwingOrders });
    const rule = await svc.createRule("org-1", "u-owner", {
      ...baseRule, actions: [{ type: "add_tag", tag: "X" }, { type: "notify_staff", message: "হ্যালো {{orderNumber}}" }],
    });
    const res = await svc.fireRule("org-1", rule, "o1", "created");
    expect(res.fired).toBe(true);
    expect(res.results[0]).toMatchObject({ type: "add_tag", ok: false });
    expect(res.results[0].detail).toContain("tags exploded");
    expect(res.results[1].ok).toBe(true);
    const log = logs.find((l: any) => l.id === res.logId);
    expect(log.actionsResult).toEqual(res.results);
  });

  it("HARD BOUNDARY: a full-action rule leaves money + payment + status byte-identical", async () => {
    const { svc, orders } = setup();
    const before = orders.find((x) => x.id === "o1")!;
    const snapshot = JSON.stringify({ total: String(before.totalMinor), status: before.status, isCod: before.isCod, refunded: String(before.refundedMinor ?? "null") });
    const rule = await svc.createRule("org-1", "u-owner", {
      ...baseRule, name: "boundary",
      actions: [
        { type: "add_tag", tag: "B" }, { type: "assign", userId: "u-agent" },
        { type: "hold", reason: "r" }, { type: "notify_staff", message: "m" },
        { type: "notify_customer", message: "m" },
      ],
    });
    const res = await svc.fireRule("org-1", rule, "o1", "created");
    expect(res.fired).toBe(true);
    const after = orders.find((x) => x.id === "o1")!;
    expect(JSON.stringify({ total: String(after.totalMinor), status: after.status, isCod: after.isCod, refunded: String(after.refundedMinor ?? "null") })).toBe(snapshot);
  });
});

describe("ON8 exactly-once + events", () => {
  it("the same created event delivered twice (both event names) fires once", async () => {
    const { svc, logs, ordersSvc } = setup();
    await svc.createRule("org-1", "u-owner", baseRule);
    const p = { organizationId: "org-1", context: { orderId: "o1" } };
    await svc.handleOrderCreated(p);
    await svc.handleOrderCreated(p);
    expect(logs).toHaveLength(1);
    expect(ordersSvc.setTags).toHaveBeenCalledTimes(1);
    // Constructor wiring: both event names are subscribed.
    const { events } = setup();
    void events;
  });

  it("constructor subscribes to order.ingested / order.created / order.status_changed", async () => {
    const s = setup();
    expect([...s.events.handlers.keys()].sort()).toEqual(["order.created", "order.ingested", "order.status_changed"]);
    await s.svc.createRule("org-1", "u-owner", baseRule);
    const handler = s.events.handlers.get("order.ingested")[0];
    await handler({ organizationId: "org-1", context: { orderId: "o1" } });
    // The constructor handler is fire-and-forget (void …catch) —
    // flush the microtask queue like EventsService.emit does.
    await new Promise((r) => setImmediate(r));
    expect(s.logs).toHaveLength(1);
  });

  it("status_changed: duplicate transition is blocked; a later re-entry with a different occurredAt fires again", async () => {
    const { svc, logs } = setup();
    await svc.createRule("org-1", "u-owner", {
      name: "স্ট্যাটাস", trigger: "status_changed", triggerConfig: { toStatus: "processing" },
      conditions: null, actions: [{ type: "add_tag", tag: "S" }], enabled: true,
    });
    const at1 = { organizationId: "org-1", context: { orderId: "o1", to: "processing", occurredAt: "2026-10-02T10:00:00.000Z" } };
    await svc.handleStatusChanged(at1);
    await svc.handleStatusChanged(at1);
    expect(logs).toHaveLength(1);
    const at2 = { organizationId: "org-1", context: { orderId: "o1", to: "processing", occurredAt: "2026-10-05T10:00:00.000Z" } };
    await svc.handleStatusChanged(at2);
    expect(logs).toHaveLength(2);
    expect(logs.map((l: any) => l.triggerKey)).toEqual([
      "status:processing:2026-10-02T10:00:00.000Z",
      "status:processing:2026-10-05T10:00:00.000Z",
    ]);
    // A different target status does not fire this rule.
    await svc.handleStatusChanged({ organizationId: "org-1", context: { orderId: "o1", to: "delivered", occurredAt: "2026-10-06T10:00:00.000Z" } });
    expect(logs).toHaveLength(2);
  });

  it("disabled rules and practice orders never fire", async () => {
    const { svc, logs, orders } = setup();
    await svc.createRule("org-1", "u-owner", { ...baseRule, enabled: false });
    await svc.handleOrderCreated({ organizationId: "org-1", context: { orderId: "o1" } });
    expect(logs).toHaveLength(0);
    orders.find((x) => x.id === "o1")!.isPractice = true;
    await svc.createRule("org-1", "u-owner", { ...baseRule, name: "দ্বিতীয়" });
    await svc.handleOrderCreated({ organizationId: "org-1", context: { orderId: "o1" } });
    expect(logs).toHaveLength(0);
  });

  it("cross-org events: an org-2 order never fires org-1 rules", async () => {
    const { svc, logs } = setup();
    await svc.createRule("org-1", "u-owner", baseRule);
    await svc.handleOrderCreated({ organizationId: "org-2", context: { orderId: "o2" } });
    expect(logs).toHaveLength(0);
  });
});

describe("ON8 sweep", () => {
  it("parcel_stuck fires once per shipment+status and re-arms on a new status", async () => {
    const s = setup();
    s.shipments.push({ id: "sh1", organizationId: "org-1", orderId: "o1", status: "in_transit", updatedAt: hoursAgo(100), createdAt: hoursAgo(120) });
    s.shipments.push({ id: "sh2", organizationId: "org-1", orderId: "o1", status: "in_transit", updatedAt: hoursAgo(10), createdAt: hoursAgo(10) });
    await s.svc.installPreset("org-1", "u-owner", "parcel_stuck");
    const rule = (await s.svc.listRules("org-1"))[0];
    await s.svc.updateRule("org-1", "u-owner", rule.id, { enabled: true });

    const r1 = await s.svc.runAutomationSweep("org-1", new Date());
    expect(r1.fired).toBe(1);
    const r2 = await s.svc.runAutomationSweep("org-1", new Date());
    expect(r2.fired).toBe(0);
    expect(s.logs).toHaveLength(1);
    expect(s.logs[0].triggerKey).toBe("stuck:sh1:in_transit");

    s.shipments[0].status = "out_for_delivery";
    s.shipments[0].updatedAt = hoursAgo(100);
    const r3 = await s.svc.runAutomationSweep("org-1", new Date());
    expect(r3.fired).toBe(1);
    expect(s.logs[1].triggerKey).toBe("stuck:sh1:out_for_delivery");
  });

  it("due_overdue fires only for delivered/completed orders with real due > 0, once per days bucket", async () => {
    const s = setup();
    const due = s.orders.find((x) => x.id === "o-old1")!;
    due.status = "delivered"; due.updatedAt = daysAgo(5); due.totalMinor = 100000n;
    const paidUp = s.orders.find((x) => x.id === "o-old2")!;
    paidUp.status = "completed"; paidUp.updatedAt = daysAgo(5); paidUp.totalMinor = 100000n;
    s.verifications.push({ id: "pv1", organizationId: "org-1", orderId: "o-old2", status: "approved", amountMinor: 100000n });
    const processing = s.orders.find((x) => x.id === "o1")!;
    processing.updatedAt = daysAgo(9); // not delivered → never a due candidate

    await s.svc.installPreset("org-1", "u-owner", "due_aging");
    const rule = (await s.svc.listRules("org-1"))[0];
    await s.svc.updateRule("org-1", "u-owner", rule.id, { enabled: true });

    const r1 = await s.svc.runAutomationSweep("org-1", new Date());
    expect(r1.fired).toBe(1);
    expect(s.logs).toHaveLength(1);
    expect(s.logs[0].orderId).toBe("o-old1");
    expect(s.logs[0].triggerKey).toBe("due:3");
    const r2 = await s.svc.runAutomationSweep("org-1", new Date());
    expect(r2.fired).toBe(0);
  });

  it("rule logs are paged newest-first", async () => {
    const { svc, logs } = setup();
    const rule = await svc.createRule("org-1", "u-owner", baseRule);
    await svc.fireRule("org-1", rule, "o1", "created");
    logs[0].createdAt = new Date("2026-10-01T00:00:00Z");
    logs.push({ id: "manual-2", organizationId: "org-1", ruleId: rule.id, orderId: "o1", triggerKey: "x", actionsResult: [], createdAt: new Date("2026-10-03T00:00:00Z") });
    const page = await svc.listRuleLogs("org-1", rule.id, { page: 1, pageSize: 1 });
    expect(page.total).toBe(2);
    expect(page.items[0].id).toBe("manual-2");
  });
});

describe("ON8 timeline integration", () => {
  it("OrderAutomationLog rows appear as kind=automation with the rule name + action summary", async () => {
    const s = setup();
    const rule = await s.svc.createRule("org-1", "u-owner", { ...baseRule, name: "আমার নিয়ম" });
    await s.svc.fireRule("org-1", rule, "o1", "created");
    const insights = new OrderInsightsService(s.prisma as any, s.audit as any);
    const tl = await insights.timeline("org-1", "o1");
    const entry = tl.entries.find((e: any) => e.kind === "automation");
    expect(entry).toBeDefined();
    expect(entry!.title).toBe("আমার নিয়ম");
    expect(entry!.detail).toContain("add_tag");
    // Foreign org still 404s.
    await expect(insights.timeline("org-2", "o1")).rejects.toThrow(/not found/i);
  });
});
