process.env.DISABLE_SCHEDULER = "true";

import { WorkflowsService } from "./workflows.service";

/**
 * Workflows W5: dry-run stores/sends NOTHING, manual run
 * executes (even disabled), retry replays a failed run,
 * stats count honestly, and a failure notifies the
 * creator at most once per hour.
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
    findUnique: async ({ where }: any) => rows.find((r) => matches(r, where ?? {})) ?? null,
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
  for (const n of ["workflow", "workflowRun", "conversationNote", "channelConversation", "channelMessage", "leadActivity", "lead", "membership", "agentNotification", "auditLog", "customer", "order"]) tables[n] = makeTable(n);
  const sends: any[] = [];
  const messagingStub = {
    getTemplate: async () => ({ id: "t1", channel: "email", name: "ধন্যবাদ টেমপ্লেট" }),
    sendToRecipient: async (_o: string, a: any) => { sends.push(a); return { status: "sent", address: a.recipient.email, providerMessageId: "p" }; },
  } as any;
  const auditStub = { log: async (e: any) => { tables.auditLog.rows.push({ ...e, id: `a-${tables.auditLog.rows.length}`, createdAt: new Date() }); } } as any;
  const svc = new WorkflowsService(tables as any, auditStub, { on: () => undefined, emit: () => undefined } as any, messagingStub, undefined);
  tables.lead.rows.push({ id: "lead-1", organizationId: "org", name: "Lead One", stage: "new", tags: [], email: "l@x.com", phone: "01700000000" });
  tables.membership.rows.push({ id: "m1", organizationId: "org", userId: "owner-1", role: "OWNER", status: "ACTIVE" });
  return { tables, svc, sends };
}

describe("W5 insights", () => {
  it("dry-run traces sends and branch arms, storing and sending NOTHING", async () => {
    const { tables, svc, sends } = setup();
    const wf: any = await svc.create("org", "owner-1", {
      name: "Preview", trigger: "lead_created",
      steps: [
        { type: "send_email", templateId: "t1" },
        { type: "branch", field: "stage", op: "eq", value: "new", then: [{ type: "change_lead_stage", stage: "contacted" }], else: [{ type: "notify_team", text: "পুরনো lead" }] },
        { type: "wait", minutes: 60 },
      ],
    });
    const out = await svc.dryRun("org", wf.id, { leadId: "lead-1" });
    expect(out.conditionsPassed).toBe(true);
    expect(out.trace.map((t: any) => t.step)).toEqual(["send_email", "branch", "change_lead_stage", "wait"]);
    expect(out.trace[0].detail).toContain("Lead One");
    expect(out.trace[0].detail).toContain("ধন্যবাদ টেমপ্লেট");
    expect(tables.workflowRun.rows).toHaveLength(0);
    expect(sends).toHaveLength(0);
    expect(tables.lead.rows[0].stage).toBe("new"); // untouched
  });

  it("dry-run reports unmet workflow conditions honestly", async () => {
    const { svc } = setup();
    const wf: any = await svc.create("org", "owner-1", {
      name: "Gated", trigger: "order_created",
      conditions: [{ field: "total", op: "gte", value: 5000 }],
      steps: [{ type: "add_lead_activity", text: "x" }],
    });
    const out = await svc.dryRun("org", wf.id, { total: 100 });
    expect(out.conditionsPassed).toBe(false);
    expect(out.trace).toHaveLength(0);
  });

  it("manual run executes even a disabled workflow, with enrichment", async () => {
    const { tables, svc } = setup();
    const wf: any = await svc.create("org", "owner-1", { name: "Manual", trigger: "lead_created", steps: [{ type: "change_lead_stage", stage: "qualified" }] });
    await svc.update("org", wf.id, { enabled: false });
    const run: any = await svc.manualRun("org", wf.id, "owner-1", { leadId: "lead-1" });
    expect(run.status).toBe("completed");
    expect(run.context.contactName).toBe("Lead One");
    expect(tables.lead.rows[0].stage).toBe("qualified");
  });

  it("retry replays a failed run; the failure notified the creator once per hour", async () => {
    const { tables, svc } = setup();
    const wf: any = await svc.create("org", "owner-1", { name: "Fragile", trigger: "inbox_message_received", steps: [{ type: "assign_conversation", userId: "agent-9" }] });
    tables.channelConversation.rows.push({ id: "conv-1", organizationId: "org", status: "open", assignedUserId: null, tags: [] });
    await svc.handleTrigger("inbox_message_received", { organizationId: "org", context: { conversationId: "conv-1" } });
    const failed = tables.workflowRun.rows[0];
    expect(failed.status).toBe("failed");
    const notifs = () => tables.agentNotification.rows.filter((n: any) => n.type === "workflow_failed");
    expect(notifs()).toHaveLength(1);
    expect(notifs()[0].userId).toBe("owner-1");
    // Second failure within the hour: no new notification.
    await svc.handleTrigger("inbox_message_received", { organizationId: "org", context: { conversationId: "conv-1" } });
    expect(notifs()).toHaveLength(1);
    // Fix the world, then retry: completes.
    tables.membership.rows.push({ id: "m9", organizationId: "org", userId: "agent-9", role: "SUPPORT_AGENT", status: "ACTIVE" });
    const retried: any = await svc.retryRun("org", failed.id, "owner-1");
    expect(retried.status).toBe("completed");
    expect(retried.context._retryOf).toBe(failed.id);
    expect(tables.channelConversation.rows[0].assignedUserId).toBe("agent-9");
    await expect(svc.retryRun("org", retried.id, "owner-1")).rejects.toThrow(/Only failed runs/);
  });

  it("stats count the last 30 days with an honest success rate", async () => {
    const { tables, svc } = setup();
    const wf: any = await svc.create("org", "owner-1", { name: "Counted", trigger: "lead_created", steps: [{ type: "add_lead_activity", text: "x" }] });
    for (const status of ["completed", "completed", "failed", "skipped"]) {
      tables.workflowRun.rows.push({ id: `r-${status}-${Math.random()}`, organizationId: "org", workflowId: wf.id, trigger: "lead_created", status, context: {}, stepsLog: [], createdAt: new Date() });
    }
    tables.workflowRun.rows.push({ id: "r-old", organizationId: "org", workflowId: wf.id, trigger: "lead_created", status: "completed", context: {}, stepsLog: [], createdAt: new Date(Date.now() - 40 * 24 * 3600 * 1000) });
    const out = await svc.stats("org");
    const mine = out.find((s: any) => s.workflowId === wf.id) as any;
    expect(mine.runs30d).toBe(4);
    expect(mine.successRate).toBe(66.7);
    expect(mine.lastRunAt).toBeInstanceOf(Date);
  });
});
