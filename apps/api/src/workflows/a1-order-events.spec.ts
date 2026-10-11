process.env.DISABLE_SCHEDULER = "true";

import { EventsService } from "../common/events.service";
import { WorkflowsService, WORKFLOW_PRESETS, WORKFLOW_TRIGGERS } from "./workflows.service";

/**
 * Automations A1: order.status_changed + order.refunded become
 * workflow triggers. The S2 producer emits them through
 * OrdersService.safeEmit as { organizationId, context } — these
 * specs drive the REAL EventsService bus into a REAL
 * WorkflowsService (onModuleInit subscription included) with
 * in-memory prisma tables, exactly like the W2 specs.
 *
 * Normalization contract (handleTrigger):
 *  - status_changed: context.fromStatus = context.from,
 *    context.toStatus = context.to (raw from/to kept).
 *  - refunded: context.refundAmount = Number(amountMinor)/100,
 *    context.cumulativeRefunded = Number(cumulativeRefundedMinor)/100
 *    (taka numbers; raw minor strings kept).
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (k === "OR" && Array.isArray(v)) return v.some((sub) => matches(row, sub));
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
      if ("gt" in v) return row[k] > v.gt;
      if ("gte" in v) return row[k] >= v.gte;
      if ("lt" in v) return row[k] < v.lt;
      if ("lte" in v) return row[k] <= v.lte;
      return true;
    }
    return row[k] === v;
  });
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where, take }: any = {}) => {
      const f = rows.filter((r) => matches(r, where ?? {}));
      return take ? f.slice(0, take) : f;
    },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where ?? {}));
      if (!row) return null;
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const r of rows) if (matches(r, where ?? {})) { Object.assign(r, data); count++; }
      return { count };
    },
  };
}

async function flush() {
  // EventsService.emit is fire-and-forget (microtask chain);
  // drain it before asserting.
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
}

function setup() {
  const tables: Record<string, any> = {};
  for (const n of ["workflow", "workflowRun", "conversationNote", "channelConversation", "channelMessage", "leadActivity", "order", "customer", "lead", "membership", "agentNotification", "auditLog"]) tables[n] = makeTable(n);
  const events = new EventsService();
  const messagingStub = {
    getTemplate: async () => ({ id: "t1", channel: "email", subject: "s", body: "b" }),
    sendToRecipient: async () => ({ status: "sent", address: "x", providerMessageId: "p" }),
  } as any;
  const svc = new WorkflowsService(tables as any, { log: async () => undefined } as any, events as any, messagingStub, undefined);
  svc.onModuleInit();
  tables.order.rows.push({ id: "ord-1", organizationId: "org", customerId: null, totalMinor: 250000, currency: "BDT", status: "processing", source: "manual", externalNumber: "ORD-1001", externalId: "1001" });
  tables.membership.rows.push({ id: "m1", organizationId: "org", userId: "owner-1", role: "OWNER", status: "ACTIVE" });
  return { tables, svc, events };
}

describe("A1 order event triggers", () => {
  it("registers both triggers and maps both events", () => {
    expect(WORKFLOW_TRIGGERS).toContain("order_status_changed");
    expect(WORKFLOW_TRIGGERS).toContain("order_refunded");
  });

  it("order.status_changed (real bus) runs the workflow with normalized fromStatus/toStatus + enriched orderNumber", async () => {
    const { tables, svc, events } = setup();
    await svc.create("org", "u1", {
      name: "Cancel follow-up", trigger: "order_status_changed",
      steps: [{ type: "notify_team", title: "Status বদলেছে", text: "অর্ডার {{orderNumber}}: {{fromStatus}} → {{toStatus}}" }],
    });
    events.emit("order.status_changed", { organizationId: "org", context: { orderId: "ord-1", from: "processing", to: "cancelled" } });
    await flush();
    const runs = tables.workflowRun.rows.filter((r: any) => r.trigger === "order_status_changed");
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("completed");
    expect(runs[0].context.fromStatus).toBe("processing");
    expect(runs[0].context.toStatus).toBe("cancelled");
    expect(runs[0].context.from).toBe("processing"); // raw emit shape kept
    expect(runs[0].context.to).toBe("cancelled");
    expect(runs[0].context.orderNumber).toBe("ORD-1001"); // enrichContext ran off orderId
    const notes = tables.agentNotification.rows;
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toContain("ORD-1001");
    expect(notes[0].body).toContain("processing → cancelled");
  });

  it("condition toStatus eq cancelled filters out other statuses (no completed run)", async () => {
    const { tables, svc, events } = setup();
    await svc.create("org", "u1", {
      name: "Only cancels", trigger: "order_status_changed",
      conditions: [{ field: "toStatus", op: "eq", value: "cancelled" }],
      steps: [{ type: "notify_team", title: "বাতিল", text: "অর্ডার {{orderNumber}} বাতিল হয়েছে" }],
    });
    events.emit("order.status_changed", { organizationId: "org", context: { orderId: "ord-1", from: "pending", to: "processing" } });
    await flush();
    expect(tables.workflowRun.rows.filter((r: any) => r.status === "completed")).toHaveLength(0);
    expect(tables.workflowRun.rows.filter((r: any) => r.status === "skipped")).toHaveLength(1);
    expect(tables.agentNotification.rows).toHaveLength(0);
    events.emit("order.status_changed", { organizationId: "org", context: { orderId: "ord-1", from: "processing", to: "cancelled" } });
    await flush();
    expect(tables.workflowRun.rows.filter((r: any) => r.status === "completed")).toHaveLength(1);
    expect(tables.agentNotification.rows).toHaveLength(1);
  });

  it("order.refunded converts minor strings to taka numbers and gte filters on them", async () => {
    const { tables, svc, events } = setup();
    await svc.create("org", "u1", {
      name: "Big refunds", trigger: "order_refunded",
      conditions: [{ field: "refundAmount", op: "gte", value: 200 }],
      steps: [{ type: "notify_team", title: "Refund", text: "অর্ডার {{orderNumber}} এ {{refundAmount}} টাকা refund (মোট {{cumulativeRefunded}})" }],
    });
    // 150 taka refund: below the 200 threshold -> skipped, no notification.
    events.emit("order.refunded", { organizationId: "org", context: { orderId: "ord-1", amountMinor: "15000", cumulativeRefundedMinor: "15000" } });
    await flush();
    expect(tables.workflowRun.rows.filter((r: any) => r.status === "completed")).toHaveLength(0);
    const skipped = tables.workflowRun.rows.find((r: any) => r.status === "skipped");
    expect(skipped.context.refundAmount).toBe(150);
    expect(skipped.context.cumulativeRefunded).toBe(150);
    expect(skipped.context.amountMinor).toBe("15000"); // raw minor string kept
    // 250 taka refund (cumulative 400): passes.
    events.emit("order.refunded", { organizationId: "org", context: { orderId: "ord-1", amountMinor: "25000", cumulativeRefundedMinor: "40000" } });
    await flush();
    const done = tables.workflowRun.rows.find((r: any) => r.status === "completed");
    expect(done.context.refundAmount).toBe(250);
    expect(done.context.cumulativeRefunded).toBe(400);
    expect(tables.agentNotification.rows).toHaveLength(1);
    expect(tables.agentNotification.rows[0].body).toContain("250 টাকা refund (মোট 400)");
  });

  it("tenant isolation: another org's workflow never fires", async () => {
    const { tables, svc, events } = setup();
    await svc.create("org-b", "u9", {
      name: "Other tenant", trigger: "order_refunded",
      steps: [{ type: "notify_team", title: "Refund", text: "refund {{refundAmount}}" }],
    });
    tables.membership.rows.push({ id: "m9", organizationId: "org-b", userId: "owner-9", role: "OWNER", status: "ACTIVE" });
    events.emit("order.refunded", { organizationId: "org", context: { orderId: "ord-1", amountMinor: "5000", cumulativeRefundedMinor: "5000" } });
    events.emit("order.status_changed", { organizationId: "org", context: { orderId: "ord-1", from: "pending", to: "cancelled" } });
    await flush();
    expect(tables.workflowRun.rows).toHaveLength(0);
    expect(tables.agentNotification.rows).toHaveLength(0);
  });

  it("preset refund_team_alert installs (disabled) and alerts the team with taka amounts once enabled", async () => {
    const { tables, svc, events } = setup();
    const preset = WORKFLOW_PRESETS.find((p) => p.key === "refund_team_alert");
    expect(preset).toBeDefined();
    expect(preset!.trigger).toBe("order_refunded");
    const installed: any = await svc.installPreset("org", "u1", "refund_team_alert");
    expect(installed.enabled).toBe(false);
    expect(installed.trigger).toBe("order_refunded");
    // Installs start disabled (W6 gallery discipline): no run yet.
    events.emit("order.refunded", { organizationId: "org", context: { orderId: "ord-1", amountMinor: "9900", cumulativeRefundedMinor: "9900" } });
    await flush();
    expect(tables.workflowRun.rows).toHaveLength(0);
    tables.workflow.rows[0].enabled = true;
    events.emit("order.refunded", { organizationId: "org", context: { orderId: "ord-1", amountMinor: "9900", cumulativeRefundedMinor: "9900" } });
    await flush();
    expect(tables.workflowRun.rows.filter((r: any) => r.status === "completed")).toHaveLength(1);
    expect(tables.agentNotification.rows).toHaveLength(1);
    expect(tables.agentNotification.rows[0].body).toContain("ORD-1001");
    expect(tables.agentNotification.rows[0].body).toContain("99 টাকা");
  });
});
