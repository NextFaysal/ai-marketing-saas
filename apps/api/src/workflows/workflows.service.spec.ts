import { WorkflowsService } from "./workflows.service";
import { MessagingService } from "../messaging/messaging.service";
import { EventsService } from "../common/events.service";

function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) return true;
    return row[k] === v;
  });
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); Object.assign(row, data); return row; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); rows.splice(i, 1); return {}; },
  };
}

function build() {
  const tables: any = {
    workflow: makeTable("wf"), workflowRun: makeTable("run"), messageTemplate: makeTable("tpl"),
    broadcast: makeTable("bc"), messageDelivery: makeTable("dlv"), customer: makeTable("cust"),
    lead: makeTable("lead"), leadActivity: makeTable("act"),
  };
  tables.messageTemplate.rows.push(
    { id: "tpl-email", organizationId: "org-1", name: "Thanks", channel: "email", subject: "Thank you {{name}}", body: "Order {{orderNumber}} confirmed, total {{total}}" },
    { id: "tpl-sms", organizationId: "org-1", name: "Qualified", channel: "sms", subject: null, body: "Hi {{name}}, our team will call you." },
  );
  tables.customer.rows.push({ id: "cust-1", organizationId: "org-1", firstName: "Ayesha", lastName: null, email: "ayesha@example.com", phone: "01712345678" });
  tables.lead.rows.push({ id: "lead-1", organizationId: "org-1", name: "Tanvir Hasan", email: null, phone: "01812345678", stage: "qualified" });
  const sentMail: any[] = []; const sentSms: any[] = [];
  const email = { isConfigured: () => true, send: async (m: any) => { sentMail.push(m); return { providerMessageId: "<m1>" }; } } as any;
  const sms = { isConfigured: () => true, send: async (m: any) => { sentSms.push(m); return { providerMessageId: "sms-1" }; } } as any;
  const messaging = new MessagingService(tables as any, { log: async () => undefined } as any, email, sms);
  const events = new EventsService();
  const workflows = new WorkflowsService(tables as any, { log: async () => undefined } as any, events, messaging);
  return { tables, workflows, messaging, sentMail, sentSms };
}

describe("WorkflowsService engine", () => {
  it("order_created with passing condition sends the email with real order data", async () => {
    const { tables, workflows, sentMail } = build();
    await workflows.create("org-1", "owner", {
      name: "Big order thanks", trigger: "order_created",
      conditions: [{ field: "total", op: "gte", value: 1000 }],
      steps: [{ type: "send_email", templateId: "tpl-email" }],
    });
    await workflows.handleTrigger("order_created", {
      organizationId: "org-1",
      context: { orderId: "ord-1", orderNumber: "1001", customerId: "cust-1", total: 1760, currency: "BDT" },
    });
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0].to).toBe("ayesha@example.com");
    expect(sentMail[0].text).toContain("Order 1001 confirmed, total 1760");
    const run = tables.workflowRun.rows[0];
    expect(run.status).toBe("completed");
    expect(tables.messageDelivery.rows[0].status).toBe("sent");
    expect(tables.messageDelivery.rows[0].workflowRunId).toBe(run.id);
  });

  it("failing condition records a skipped run and sends nothing", async () => {
    const { tables, workflows, sentMail } = build();
    await workflows.create("org-1", "owner", {
      name: "Big order thanks", trigger: "order_created",
      conditions: [{ field: "total", op: "gte", value: 1000 }],
      steps: [{ type: "send_email", templateId: "tpl-email" }],
    });
    await workflows.handleTrigger("order_created", {
      organizationId: "org-1",
      context: { orderId: "ord-2", orderNumber: "1002", customerId: "cust-1", total: 300, currency: "BDT" },
    });
    expect(sentMail).toHaveLength(0);
    expect(tables.workflowRun.rows[0].status).toBe("skipped");
  });

  it("lead_stage_changed fires an SMS to the lead's normalized phone", async () => {
    const { tables, workflows, sentSms } = build();
    await workflows.create("org-1", "owner", {
      name: "Qualified SMS", trigger: "lead_stage_changed",
      conditions: [{ field: "stage", op: "eq", value: "qualified" }],
      steps: [{ type: "send_sms", templateId: "tpl-sms" }, { type: "add_lead_activity", text: "Qualified SMS sent by workflow" }],
    });
    await workflows.handleTrigger("lead_stage_changed", {
      organizationId: "org-1",
      context: { leadId: "lead-1", stage: "qualified", previousStage: "contacted" },
    });
    expect(sentSms).toHaveLength(1);
    expect(sentSms[0].to).toBe("8801812345678");
    expect(tables.leadActivity.rows).toHaveLength(1);
    expect(tables.workflowRun.rows[0].status).toBe("completed");
  });

  it("workflows cannot be created with mismatched or missing templates", async () => {
    const { workflows } = build();
    await expect(workflows.create("org-1", "owner", { name: "x", trigger: "order_created", steps: [{ type: "send_email" }] }))
      .rejects.toThrow("templateId");
    await expect(workflows.create("org-1", "owner", { name: "x", trigger: "order_created", steps: [{ type: "send_email", templateId: "nope" }] }))
      .rejects.toThrow("Template not found");
  });
});
