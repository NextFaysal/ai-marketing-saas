process.env.DISABLE_SCHEDULER = "true";

import { WorkflowsService } from "./workflows.service";

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
  };
}

function setup() {
  const tables: Record<string, any> = {};
  for (const n of ["workflow", "workflowRun", "conversationNote", "channelConversation", "leadActivity", "lead", "visitor", "trackingEvent"]) {
    tables[n] = makeTable(n);
  }
  const events = { on: () => undefined, emit: () => undefined } as any;
  const messagingStub = { getTemplate: async () => ({ id: "t", channel: "email" }) } as any;
  const llmFactoryStub = {
    getProvider: () => ({
      name: "test-llm",
      isRealLlm: false,
      complete: async (messages: any[]) => ({
        text: `AI generated response for ${messages[1]?.content?.slice(0, 20)}`,
        model: "mock-llm",
        inputTokens: 10,
        outputTokens: 10,
        tokensEstimated: false,
      }),
    }),
  } as any;

  const svc = new WorkflowsService(
    tables as any,
    { log: async () => undefined } as any,
    events,
    messagingStub,
    undefined,
    llmFactoryStub,
  );

  tables.visitor.rows.push({
    id: "vis-1",
    organizationId: "org-1",
    email: "visitor@example.com",
    name: "Rahim Shopper",
    phone: "01700000000",
  });
  tables.channelConversation.rows.push({
    id: "conv-1",
    organizationId: "org-1",
    status: "open",
    contactName: "Rahim",
  });

  return { tables, svc };
}

describe("Workflows Advanced Extensions (W7)", () => {
  it("validates and creates workflow with cart_abandoned trigger", async () => {
    const { svc } = setup();
    const wf = await svc.create("org-1", "user-1", {
      name: "Abandoned Cart Recovery",
      trigger: "cart_abandoned",
      steps: [{ type: "add_conversation_note", text: "Cart recovery" }],
    });
    expect(wf.id).toBeDefined();
    expect(wf.trigger).toBe("cart_abandoned");
  });

  it("validates and executes ai_generate step storing result in conversation note", async () => {
    const { tables, svc } = setup();
    await svc.create("org-1", "user-1", {
      name: "AI Assist",
      trigger: "inbox_message_received",
      steps: [
        {
          type: "ai_generate",
          prompt: "Summarize: {{contactName}} wants refund",
          action: "add_conversation_note",
        },
      ],
    });

    await svc.handleTrigger("inbox_message_received", {
      organizationId: "org-1",
      context: { conversationId: "conv-1", contactName: "Rahim" },
    });

    const notes = tables.conversationNote.rows;
    expect(notes.length).toBe(1);
    expect(notes[0].content).toContain("AI generated response");
    expect(notes[0].conversationId).toBe("conv-1");
  });

  it("validates notify_channel URL security and rejects non-https/private hostnames", async () => {
    const { svc } = setup();
    await expect(
      svc.create("org-1", "user-1", {
        name: "Channel Alert Insecure",
        trigger: "order_created",
        steps: [{ type: "notify_channel", url: "http://insecure.com", text: "Alert" }],
      }),
    ).rejects.toThrow("public https webhook URL");

    await expect(
      svc.create("org-1", "user-1", {
        name: "Channel Alert Private",
        trigger: "order_created",
        steps: [{ type: "notify_channel", url: "https://127.0.0.1/hook", text: "Alert" }],
      }),
    ).rejects.toThrow("public https webhook URL");
  });

  it("includes new extension presets in listPresets()", () => {
    const { svc } = setup();
    const presets = svc.listPresets();
    const keys = presets.map((p) => p.key);
    expect(keys).toContain("cart_recovery_alert");
    expect(keys).toContain("vip_order_channel_alert");
    expect(keys).toContain("ai_inbox_reply_assist");
  });
});
