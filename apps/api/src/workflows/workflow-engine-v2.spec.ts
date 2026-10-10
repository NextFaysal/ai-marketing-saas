process.env.DISABLE_SCHEDULER = "true";

import { WorkflowsService } from "./workflows.service";

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
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
  };
}
function setup() {
  const tables: Record<string, any> = {};
  for (const n of ["workflow", "workflowRun", "conversationNote", "channelConversation", "channelMessage", "leadActivity"]) tables[n] = makeTable(n);
  const inboxCalls: any[] = [];
  const inboxStub = {
    sendAutomatedMessage: async (org: string, conv: string, text: string, tag: string) => { inboxCalls.push({ conv, text, tag }); return { id: "m-x" }; },
    sendTemplate: async () => ({ id: "m-t" }),
  } as any;
  const messagingStub = { getTemplate: async () => { throw new Error("unused"); }, sendToRecipient: async () => { throw new Error("unused"); } } as any;
  const svc = new WorkflowsService(tables as any, { log: async () => undefined } as any, { on: () => undefined, emit: () => undefined } as any, messagingStub, inboxStub);
  return { tables, svc, inboxCalls };
}

describe("M15 workflow engine v2: validation", () => {
  it("rejects invalid wait/condition/inbox steps", async () => {
    const { svc } = setup();
    await expect(svc.create("org-1", "u", { name: "x", trigger: "inbox_message_received", steps: [{ type: "wait" }] })).rejects.toThrow("minutes");
    await expect(svc.create("org-1", "u", { name: "x", trigger: "inbox_message_received", steps: [{ type: "condition" }] })).rejects.toThrow("field and an operator");
    await expect(svc.create("org-1", "u", { name: "x", trigger: "inbox_message_received", steps: [{ type: "send_inbox_message" }] })).rejects.toThrow("text or a whatsappTemplateId");
    const ok = await svc.create("org-1", "u", { name: "x", trigger: "inbox_message_received", steps: [{ type: "wait", minutes: 30 }] });
    expect(ok.id).toBeTruthy();
  });
});

describe("M15 wait + resume + branch (recovery sequence)", () => {
  function seed(tables: any, withAgentReply: boolean) {
    const hourAgo = new Date(Date.now() - 3600 * 1000);
    tables.channelConversation.rows.push({
      id: "conv-1", organizationId: "org-1", channel: "whatsapp", status: "open", unreadCount: 1,
      lastCustomerMessageAt: hourAgo, lastMessageAt: hourAgo,
    });
    if (withAgentReply) {
      tables.channelMessage.rows.push({ id: "m-out", conversationId: "conv-1", direction: "out", type: "text", content: "আছি", status: "sent", createdAt: new Date() });
    }
  }
  async function buildWorkflow(svc: WorkflowsService) {
    return svc.create("org-1", "u", {
      name: "Recovery", trigger: "inbox_message_received",
      steps: [
        { type: "wait", minutes: 60 },
        { type: "condition", field: "agentReplied", op: "eq", value: false },
        { type: "send_inbox_message", text: "আসসালামু আলাইকুম {{contactName}}, কোনো সাহায্য লাগবে?" },
      ],
    });
  }
  it("pauses on wait, resumes later and sends the follow-up when nobody replied", async () => {
    const { tables, svc, inboxCalls } = setup();
    seed(tables, false);
    await buildWorkflow(svc);
    await svc.handleTrigger("inbox_message_received", { organizationId: "org-1", context: { conversationId: "conv-1", contactName: "Karim" } });
    const run = tables.workflowRun.rows[0];
    expect(run.status).toBe("waiting");
    expect(run.nextStepIndex).toBe(1);
    expect(inboxCalls).toHaveLength(0);
    const resumed = await svc.resumeRuns(new Date(Date.now() + 61 * 60000));
    expect(resumed).toBe(1);
    expect(inboxCalls).toHaveLength(1);
    expect(inboxCalls[0].text).toContain("Karim");
    expect(tables.workflowRun.rows[0].status).toBe("completed");
  });
  it("branch stops the follow-up when an agent already replied during the wait", async () => {
    const { tables, svc, inboxCalls } = setup();
    seed(tables, true);
    await buildWorkflow(svc);
    await svc.handleTrigger("inbox_message_received", { organizationId: "org-1", context: { conversationId: "conv-1", contactName: "Karim" } });
    await svc.resumeRuns(new Date(Date.now() + 61 * 60000));
    expect(inboxCalls).toHaveLength(0);
    const run = tables.workflowRun.rows[0];
    expect(run.status).toBe("completed");
    expect(run.stepsLog.some((l: any) => l.step === "condition" && l.status === "skipped")).toBe(true);
  });
  it("does not resume before the wait elapses", async () => {
    const { tables, svc, inboxCalls } = setup();
    seed(tables, false);
    await buildWorkflow(svc);
    await svc.handleTrigger("inbox_message_received", { organizationId: "org-1", context: { conversationId: "conv-1" } });
    expect(await svc.resumeRuns(new Date(Date.now() + 30 * 60000))).toBe(0);
    expect(tables.workflowRun.rows[0].status).toBe("waiting");
    expect(inboxCalls).toHaveLength(0);
  });
});
