process.env.DISABLE_SCHEDULER = "true";

import { WorkflowsService } from "./workflows.service";

/**
 * MX4 — journey engine changes: stepsLog idx/ref stamping,
 * stepRef + htmlBody on send steps, the resume-time journey
 * fact refresh (journeys ONLY), and exit-on-purchase
 * finalization. Fake-prisma style like the W-specs.
 */
const cmp = (a: any, b: any) => {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  return av < bv ? -1 : av > bv ? 1 : 0;
};
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (k === "OR") return (v as any[]).some((sub) => matches(row, sub));
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("not" in v) {
        if (v.not === null) { if (row[k] === null || row[k] === undefined) return false; }
        else if (row[k] === v.not) return false;
      }
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("gt" in v && !(cmp(row[k], v.gt) > 0)) return false;
      if ("gte" in v && !(cmp(row[k], v.gte) >= 0)) return false;
      if ("lt" in v && !(cmp(row[k], v.lt) < 0)) return false;
      if ("lte" in v && !(cmp(row[k], v.lte) <= 0)) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v instanceof Date) return cmp(row[k], v) === 0;
    return row[k] === v;
  });
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findUnique: async ({ where }: any) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where, take }: any = {}) => {
      const f = rows.filter((r) => matches(r, where ?? {}));
      return take ? f.slice(0, take) : f;
    },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where ?? {}));
      if (row) { Object.assign(row, data); row.updatedAt = new Date(); }
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const r of rows) if (matches(r, where ?? {})) { Object.assign(r, data); count++; }
      return { count };
    },
  };
}

const TEMPLATES: Record<string, any> = {
  "tpl-email": { id: "tpl-email", channel: "email", subject: "S", body: "Body", htmlBody: "<p>HTML</p>" },
  "tpl-sms": { id: "tpl-sms", channel: "sms", subject: null, body: "SMS body", htmlBody: null },
};

function build() {
  const tables: Record<string, any> = {};
  for (const n of ["workflow", "workflowRun", "order", "customer", "lead", "messageDelivery", "messageLinkClick", "channelConversation", "channelMessage", "membership"]) {
    tables[n] = makeTable(n);
  }
  tables.customer.rows.push({ id: "c1", organizationId: "org", firstName: "Ayesha", lastName: null, email: "ayesha@example.com", phone: "01712345678", tags: ["vip", "regular"] });
  tables.lead.rows.push({ id: "l1", organizationId: "org", name: "Lead One", email: "lead@example.com", phone: "01812345678", stage: "new", tags: ["new-lead", "hot"] });
  const sends: any[] = [];
  const messaging: any = {
    getTemplate: async (_org: string, id: string) => {
      const t = TEMPLATES[id];
      if (!t) throw new Error("Template not found");
      return t;
    },
    sendToRecipient: async (_org: string, input: any) => {
      sends.push(input);
      return { status: "sent", address: input.recipient.email ?? input.recipient.phone, providerMessageId: "p1" };
    },
    registerWorkflowCreator: () => undefined,
  };
  const svc = new WorkflowsService(
    tables as any,
    { log: async () => undefined } as any,
    { on: () => undefined, emit: () => undefined } as any,
    messaging,
    undefined,
  );
  return { tables, svc, sends };
}

/** Start a journey run that parks on its first wait step. */
async function parkedRun(b: ReturnType<typeof build>, steps: any[], context: any, journey?: any) {
  const workflow = await b.svc.create("org", "u1", {
    name: "J", trigger: "order_created", steps,
    ...(journey !== undefined ? { journey } : {}),
  } as any);
  const run: any = await b.svc.runWorkflow(workflow, context);
  const row = b.tables.workflowRun.rows.find((r: any) => r.id === run.id);
  expect(row.status).toBe("waiting");
  row.resumeAt = new Date(Date.now() - 1000);
  return { workflow, row };
}

describe("MX4 stepsLog idx/ref + send stepRef/htmlBody", () => {
  it("stamps idx on top-level entries and idx+ref on branch sub-steps; sends carry stepRef and the email htmlBody", async () => {
    const b = build();
    const workflow = await b.svc.create("org", "u1", {
      name: "Flow", trigger: "order_created",
      steps: [
        { type: "send_email", templateId: "tpl-email" },
        {
          type: "branch", field: "total", op: "gte", value: 100,
          then: [{ type: "send_sms", templateId: "tpl-sms" }],
          else: [{ type: "send_email", templateId: "tpl-email" }],
        },
      ],
    });
    const run: any = await b.svc.runWorkflow(workflow, { customerId: "c1", total: 500 });
    const row = b.tables.workflowRun.rows.find((r: any) => r.id === run.id);
    expect(row.status).toBe("completed");
    expect(row.stepsLog).toHaveLength(3);
    expect(row.stepsLog[0]).toMatchObject({ step: "send_email", status: "ok", idx: 0 });
    expect(row.stepsLog[1]).toMatchObject({ step: "branch", status: "ok", idx: 1 });
    expect(row.stepsLog[2]).toMatchObject({ step: "send_sms", status: "ok", idx: 1, ref: "1.then.0", branch: "then" });
    // The pre-MX4 fields are all still there.
    expect(typeof row.stepsLog[0].detail).toBe("string");
    // stepRef + htmlBody on the send inputs.
    expect(b.sends).toHaveLength(2);
    expect(b.sends[0].stepRef).toBe("0");
    expect(b.sends[0].htmlBody).toBe("<p>HTML</p>");
    expect(b.sends[1].stepRef).toBe("1.then.0");
    expect(b.sends[1].htmlBody).toBeUndefined(); // SMS steps never gain an html part
  });

  it("wait + condition entries also carry idx", async () => {
    const b = build();
    const { row } = await parkedRun(b, [
      { type: "wait", minutes: 30 },
      { type: "condition", field: "total", op: "gte", value: 10 },
      { type: "send_sms", templateId: "tpl-sms" },
    ], { customerId: "c1", total: 50 });
    expect(row.stepsLog[0]).toMatchObject({ step: "wait", status: "ok", idx: 0 });
    await b.svc.resumeRuns();
    expect(row.status).toBe("completed");
    expect(row.stepsLog[1]).toMatchObject({ step: "condition", status: "ok", idx: 1 });
    expect(row.stepsLog[2]).toMatchObject({ step: "send_sms", status: "ok", idx: 2 });
  });
});

describe("MX4 resume-time journey fact refresh", () => {
  it("purchasedSinceEntry=true (entry order excluded), customerTags from Customer.tags; a purchased-condition stops the send", async () => {
    const b = build();
    const { row } = await parkedRun(b, [
      { type: "wait", minutes: 30 },
      { type: "condition", field: "purchasedSinceEntry", op: "eq", value: false },
      { type: "send_sms", templateId: "tpl-sms" },
    ], { customerId: "c1", orderId: "ord-entry" }, { origin: "messaging", exitOnPurchase: false });
    // The entry order itself, re-dated after the run — must NOT count (id excluded).
    b.tables.order.rows.push({ id: "ord-entry", organizationId: "org", customerId: "c1", createdAt: new Date(Date.now() + 60000) });
    // A genuinely new purchase after entry.
    b.tables.order.rows.push({ id: "ord-new", organizationId: "org", customerId: "c1", createdAt: new Date(Date.now() + 60000) });
    // Another customer's order — must NOT count.
    b.tables.order.rows.push({ id: "ord-other", organizationId: "org", customerId: "c9", createdAt: new Date(Date.now() + 60000) });
    await b.svc.resumeRuns();
    expect(row.status).toBe("completed");
    expect(row.context.purchasedSinceEntry).toBe(true);
    expect(row.context.customerTags).toBe("vip,regular");
    expect(row.context.journeyOpened).toBe(false);
    expect(row.context.journeyClicked).toBe(false);
    expect(b.sends).toHaveLength(0); // the condition failed -> the send never ran
    expect(row.stepsLog.some((l: any) => l.step === "exit")).toBe(false); // exitOnPurchase off
  });

  it("no purchase -> purchasedSinceEntry=false and the journey continues; tags come from Lead.tags when only a lead is in context", async () => {
    const b = build();
    const { row } = await parkedRun(b, [
      { type: "wait", minutes: 30 },
      { type: "send_sms", templateId: "tpl-sms" },
    ], { leadId: "l1" }, { origin: "messaging", exitOnPurchase: true });
    await b.svc.resumeRuns();
    expect(row.status).toBe("completed");
    expect(row.context.purchasedSinceEntry).toBe(false);
    expect(row.context.customerTags).toBe("new-lead,hot");
    expect(b.sends).toHaveLength(1); // exitOnPurchase armed but no purchase -> the send ran
  });

  it("journeyOpened / journeyClicked refresh from the run's own delivery + click rows", async () => {
    const b = build();
    const { row } = await parkedRun(b, [
      { type: "wait", minutes: 30 },
      { type: "condition", field: "journeyOpened", op: "eq", value: true },
      { type: "condition", field: "journeyClicked", op: "eq", value: true },
      { type: "send_sms", templateId: "tpl-sms" },
    ], { customerId: "c1" }, { origin: "messaging", exitOnPurchase: false });
    b.tables.messageDelivery.rows.push({ id: "d1", organizationId: "org", workflowRunId: row.id, openedAt: new Date() });
    b.tables.messageDelivery.rows.push({ id: "d2", organizationId: "org", workflowRunId: "other-run", openedAt: new Date() });
    b.tables.messageLinkClick.rows.push({ id: "k1", organizationId: "org", workflowRunId: row.id, broadcastId: null });
    await b.svc.resumeRuns();
    expect(row.context.journeyOpened).toBe(true);
    expect(row.context.journeyClicked).toBe(true);
    expect(b.sends).toHaveLength(1); // both conditions passed on the refreshed facts
  });

  it("a NON-journey workflow gets NO refresh — its resume context is untouched", async () => {
    const b = build();
    const { row } = await parkedRun(b, [
      { type: "wait", minutes: 30 },
      { type: "send_sms", templateId: "tpl-sms" },
    ], { customerId: "c1" }); // no journey meta at all
    b.tables.order.rows.push({ id: "ord-new", organizationId: "org", customerId: "c1", createdAt: new Date(Date.now() + 60000) });
    await b.svc.resumeRuns();
    expect(row.status).toBe("completed");
    expect(b.sends).toHaveLength(1);
    expect("purchasedSinceEntry" in row.context).toBe(false);
    expect("customerTags" in row.context).toBe(false);
    expect("journeyOpened" in row.context).toBe(false);
  });
});

describe("MX4 exit-on-purchase", () => {
  it("finalizes the run WITHOUT executing the pending send; the exit entry names the order", async () => {
    const b = build();
    const { row } = await parkedRun(b, [
      { type: "wait", minutes: 30 },
      { type: "send_sms", templateId: "tpl-sms" },
    ], { customerId: "c1" }, { origin: "messaging", exitOnPurchase: true });
    b.tables.order.rows.push({ id: "ord-exit", organizationId: "org", customerId: "c1", createdAt: new Date(Date.now() + 60000) });
    const resumed = await b.svc.resumeRuns();
    expect(resumed).toBe(1);
    expect(row.status).toBe("completed");
    expect(row.resumeAt).toBeNull();
    expect(b.sends).toHaveLength(0); // the provider was never called
    const exit = row.stepsLog[row.stepsLog.length - 1];
    expect(exit).toMatchObject({ step: "exit", status: "ok", idx: 1 });
    expect(exit.detail).toContain("ord-exit");
    expect(row.context.purchasedSinceEntry).toBe(true); // the refreshed context is persisted
  });

  it("an order from BEFORE the run started does not trigger the exit", async () => {
    const b = build();
    const { row } = await parkedRun(b, [
      { type: "wait", minutes: 30 },
      { type: "send_sms", templateId: "tpl-sms" },
    ], { customerId: "c1" }, { origin: "messaging", exitOnPurchase: true });
    b.tables.order.rows.push({ id: "ord-old", organizationId: "org", customerId: "c1", createdAt: new Date(Date.now() - 3600_000) });
    await b.svc.resumeRuns();
    expect(row.context.purchasedSinceEntry).toBe(false);
    expect(b.sends).toHaveLength(1);
    expect(row.stepsLog.some((l: any) => l.step === "exit")).toBe(false);
  });
});
