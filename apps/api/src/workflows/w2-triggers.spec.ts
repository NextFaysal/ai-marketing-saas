process.env.DISABLE_SCHEDULER = "true";

import { WorkflowsService } from "./workflows.service";

/**
 * Workflows W2: order_delivered fires with an ENRICHED
 * context (the raw event carries only an orderId), and
 * schedule workflows fire once per Dhaka day at their
 * configured time.
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
function setup() {
  const tables: Record<string, any> = {};
  for (const n of ["workflow", "workflowRun", "conversationNote", "channelConversation", "channelMessage", "leadActivity", "order", "customer", "lead"]) tables[n] = makeTable(n);
  const sent: any[] = [];
  const messagingStub = {
    getTemplate: async () => ({ id: "t1", channel: "email", subject: "ধন্যবাদ", body: "অর্ডার {{orderNumber}}" }),
    sendToRecipient: async (_org: string, args: any) => { sent.push(args); return { status: "sent", address: args.recipient.email, providerMessageId: "p1" }; },
  } as any;
  const svc = new WorkflowsService(tables as any, { log: async () => undefined } as any, { on: () => undefined, emit: () => undefined } as any, messagingStub, undefined);
  return { tables, svc, sent };
}

describe("W2 triggers", () => {
  it("order_delivered enriches the bare orderId context and emails the customer", async () => {
    const { tables, svc, sent } = setup();
    tables.customer.rows.push({ id: "cust-1", organizationId: "org", firstName: "Karim", lastName: "", email: "k@x.com", phone: null });
    tables.order.rows.push({ id: "ord-1", organizationId: "org", customerId: "cust-1", totalMinor: 250000, currency: "BDT", status: "delivered", source: "woocommerce", externalNumber: "WC-9", externalId: "9" });
    await svc.create("org", "u1", {
      name: "Delivered thanks", trigger: "order_delivered",
      conditions: [{ field: "total", op: "gte", value: 1000 }],
      steps: [{ type: "send_email", templateId: "t1" }],
    });
    await svc.handleTrigger("order_delivered", { organizationId: "org", context: { orderId: "ord-1" } });
    expect(sent).toHaveLength(1);
    expect(sent[0].recipient.id).toBe("cust-1");
    expect(sent[0].vars.total).toBe(2500);
    expect(tables.workflowRun.rows[0].status).toBe("completed");
  });

  it("schedule: needs a scheduleTime, fires once per Dhaka day after the slot", async () => {
    const { tables, svc } = setup();
    await expect(svc.create("org", "u1", {
      name: "Daily", trigger: "schedule", steps: [{ type: "add_lead_activity", text: "x" }],
    })).rejects.toThrow(/scheduleTime/);
    await svc.create("org", "u1", {
      name: "Daily", trigger: "schedule",
      conditions: [{ field: "scheduleTime", op: "eq", value: "09:30" }],
      steps: [{ type: "add_conversation_note", text: "daily" }],
    });
    // 2026-10-11 is a Sunday; 10:00 +06 = 04:00Z.
    const at = new Date("2026-10-11T04:00:00Z");
    expect(await svc.scanScheduled(at)).toBe(1);
    expect(await svc.scanScheduled(at)).toBe(0); // same Dhaka day: no refire
    const run = tables.workflowRun.rows.find((r: any) => r.trigger === "schedule");
    expect(run.context.date).toBe("2026-10-11");
    expect(run.context.scheduledFor).toBe("09:30");
  });

  it("schedule respects scheduleDays (0 = Sunday)", async () => {
    const { svc } = setup();
    await svc.create("org", "u1", {
      name: "Mon only", trigger: "schedule",
      conditions: [
        { field: "scheduleTime", op: "eq", value: "09:30" },
        { field: "scheduleDays", op: "eq", value: "1" },
      ],
      steps: [{ type: "add_conversation_note", text: "weekly" }],
    });
    // Sunday 2026-10-11: not an allowed day.
    expect(await svc.scanScheduled(new Date("2026-10-11T04:00:00Z"))).toBe(0);
    // Monday 2026-10-12: allowed.
    expect(await svc.scanScheduled(new Date("2026-10-12T04:00:00Z"))).toBe(1);
  });
});
