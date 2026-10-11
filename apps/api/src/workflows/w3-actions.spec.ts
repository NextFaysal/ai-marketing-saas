process.env.DISABLE_SCHEDULER = "true";

import { WorkflowsService, isBlockedWebhookHost } from "./workflows.service";

/**
 * Workflows W3: the six new action steps. The stage step
 * must NEVER emit lead.stage_changed (loop-proof), the
 * webhook guard refuses non-https + private targets at
 * validation AND at send time.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (k === "OR" && Array.isArray(v)) return v.some((sub) => matches(row, sub));
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
      if ("gt" in v) return row[k] > v.gt;
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
  for (const n of ["workflow", "workflowRun", "conversationNote", "channelConversation", "channelMessage", "leadActivity", "lead", "membership", "agentNotification"]) tables[n] = makeTable(n);
  const emitted: any[] = [];
  const events = { on: () => undefined, emit: (...a: any[]) => { emitted.push(a); } } as any;
  const messagingStub = { getTemplate: async () => ({ id: "t", channel: "email" }), sendToRecipient: async () => ({ status: "sent", address: "x", providerMessageId: "p" }) } as any;
  const svc = new WorkflowsService(tables as any, { log: async () => undefined } as any, events, messagingStub, undefined);
  tables.lead.rows.push({ id: "lead-1", organizationId: "org", name: "Lead One", stage: "new", tags: ["old"], nextFollowUpAt: null });
  tables.channelConversation.rows.push({ id: "conv-1", organizationId: "org", status: "open", assignedUserId: null, tags: [] });
  tables.membership.rows.push(
    { id: "m1", organizationId: "org", userId: "owner-1", role: "OWNER", status: "ACTIVE" },
    { id: "m2", organizationId: "org", userId: "agent-1", role: "SUPPORT_AGENT", status: "ACTIVE" },
    { id: "m3", organizationId: "org", userId: "ghost-1", role: "SUPPORT_AGENT", status: "SUSPENDED" },
  );
  return { tables, svc, emitted };
}

describe("W3 actions", () => {
  it("change_lead_stage moves the lead, logs it, and emits NOTHING (loop-proof)", async () => {
    const { tables, svc, emitted } = setup();
    await svc.create("org", "u1", { name: "Qualify", trigger: "lead_created", steps: [{ type: "change_lead_stage", stage: "qualified" }] });
    await svc.handleTrigger("lead_created", { organizationId: "org", context: { leadId: "lead-1" } });
    expect(tables.lead.rows[0].stage).toBe("qualified");
    expect(tables.leadActivity.rows.some((a: any) => a.type === "stage")).toBe(true);
    expect(emitted).toHaveLength(0);
  });

  it("add_tag + follow-up + assign + notify run in one flow", async () => {
    const { tables, svc } = setup();
    await svc.create("org", "u1", {
      name: "Combo", trigger: "inbox_message_received",
      steps: [
        { type: "add_tag", tag: "আগ্রহী", target: "lead" },
        { type: "create_follow_up", days: 3 },
        { type: "assign_conversation", userId: "agent-1" },
        { type: "notify_team", role: "OWNER", title: "দেখুন", text: "{{contactName}} কে assign হয়েছে" },
      ],
    });
    await svc.handleTrigger("inbox_message_received", { organizationId: "org", context: { leadId: "lead-1", conversationId: "conv-1", contactName: "Rahim" } });
    expect(tables.lead.rows[0].tags).toContain("আগ্রহী");
    expect(tables.lead.rows[0].nextFollowUpAt).toBeInstanceOf(Date);
    expect(tables.channelConversation.rows[0].assignedUserId).toBe("agent-1");
    const notes = tables.agentNotification.rows;
    expect(notes).toHaveLength(1);
    expect(notes[0].userId).toBe("owner-1");
    expect(notes[0].body).toContain("Rahim");
    expect(tables.workflowRun.rows[0].status).toBe("completed");
  });

  it("assign to a suspended member fails the step honestly", async () => {
    const { tables, svc } = setup();
    await svc.create("org", "u1", { name: "Bad assign", trigger: "inbox_message_received", steps: [{ type: "assign_conversation", userId: "ghost-1" }] });
    await svc.handleTrigger("inbox_message_received", { organizationId: "org", context: { conversationId: "conv-1" } });
    expect(tables.workflowRun.rows[0].status).toBe("failed");
    expect(tables.channelConversation.rows[0].assignedUserId).toBeNull();
  });

  it("webhook guard: validation + host rules", async () => {
    const { svc } = setup();
    await expect(svc.create("org", "u1", { name: "W", trigger: "lead_created", steps: [{ type: "http_webhook", url: "http://example.com/h" }] })).rejects.toThrow(/https/);
    await expect(svc.create("org", "u1", { name: "W", trigger: "lead_created", steps: [{ type: "http_webhook", url: "https://192.168.1.5/h" }] })).rejects.toThrow(/https/);
    expect(isBlockedWebhookHost("10.0.0.9")).toBe(true);
    expect(isBlockedWebhookHost("172.20.1.1")).toBe(true);
    expect(isBlockedWebhookHost("hooks.example.com")).toBe(false);
    await expect(svc.create("org", "u1", { name: "W", trigger: "lead_created", steps: [{ type: "http_webhook", url: "https://hooks.example.com/h", secret: "s" }] })).resolves.toBeTruthy();
  });

  it("webhook delivery: non-2xx fails the step; 2xx passes with the HMAC header", async () => {
    const { tables, svc } = setup();
    const calls: any[] = [];
    const orig = global.fetch;
    global.fetch = (async (url: any, init: any) => { calls.push({ url: String(url), init }); return { status: calls.length === 1 ? 500 : 200 }; }) as any;
    try {
      await svc.create("org", "u1", { name: "Hook", trigger: "lead_created", steps: [{ type: "http_webhook", url: "https://hooks.example.com/h", secret: "topsecret" }] });
      await svc.handleTrigger("lead_created", { organizationId: "org", context: { leadId: "lead-1" } });
      expect(tables.workflowRun.rows[0].status).toBe("failed");
      await svc.handleTrigger("lead_created", { organizationId: "org", context: { leadId: "lead-1" } });
      expect(tables.workflowRun.rows[1].status).toBe("completed");
      expect(calls[0].init.headers["x-workflow-signature"]).toMatch(/^[a-f0-9]{64}$/);
    } finally { global.fetch = orig; }
  });
});
