process.env.DISABLE_SCHEDULER = "true";

import { WorkflowsService } from "./workflows.service";

/**
 * Workflows W1: definitions are editable with create-grade
 * validation, clones start disabled, and a run executes
 * the steps snapshot from its start — never the edited
 * definition.
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
    delete: async ({ where }: any) => {
      const i = rows.findIndex((r) => matches(r, where ?? {}));
      if (i >= 0) rows.splice(i, 1);
      return {};
    },
  };
}
function setup() {
  const tables: Record<string, any> = {};
  for (const n of ["workflow", "workflowRun", "conversationNote", "channelConversation", "channelMessage", "leadActivity"]) tables[n] = makeTable(n);
  const notes: any[] = [];
  tables.conversationNote.create = async ({ data }: any) => { notes.push(data); return data; };
  const messagingStub = { getTemplate: async () => ({ id: "t", channel: "email" }), sendToRecipient: async () => ({ status: "sent", address: "x@y.z", providerMessageId: "p" }) } as any;
  const svc = new WorkflowsService(tables as any, { log: async () => undefined } as any, { on: () => undefined, emit: () => undefined } as any, messagingStub, undefined);
  return { tables, svc, notes };
}

describe("W1 editable workflows", () => {
  it("update validates the resulting definition like create", async () => {
    const { svc } = setup();
    const wf: any = await svc.create("org", "u1", { name: "A", trigger: "lead_created", steps: [{ type: "add_lead_activity", text: "hi" }] });
    await expect(svc.update("org", wf.id, { steps: [{ type: "wait", minutes: 0 }] })).rejects.toThrow(/wait steps/);
    await expect(svc.update("org", wf.id, { trigger: "nope" })).rejects.toThrow(/Invalid trigger/);
    const ok: any = await svc.update("org", wf.id, { steps: [{ type: "add_lead_activity", text: "v2" }], name: "A2" }, "u1");
    expect(ok.name).toBe("A2");
    expect(ok.steps[0].text).toBe("v2");
  });

  it("clone copies the definition, disabled, with its own identity", async () => {
    const { svc, tables } = setup();
    const wf: any = await svc.create("org", "u1", { name: "মূল", trigger: "lead_created", steps: [{ type: "add_lead_activity", text: "x" }] });
    const copy: any = await svc.clone("org", wf.id, "u1");
    expect(copy.id).not.toBe(wf.id);
    expect(copy.enabled).toBe(false);
    expect(copy.name).toContain("কপি");
    expect(copy.steps).toEqual(wf.steps);
    expect(tables.workflow.rows).toHaveLength(2);
  });

  it("a waiting run resumes on its SNAPSHOT steps after the workflow is edited", async () => {
    const { svc, tables, notes } = setup();
    const wf: any = await svc.create("org", "u1", {
      name: "Snap", trigger: "inbox_message_received",
      steps: [
        { type: "wait", minutes: 30 },
        { type: "add_conversation_note", text: "আসল ধাপ" },
      ],
    });
    tables.channelConversation.rows.push({ id: "c1", organizationId: "org", status: "open", unreadCount: 1, lastCustomerMessageAt: new Date() });
    await svc.handleTrigger("inbox_message_received", { organizationId: "org", context: { conversationId: "c1" } });
    const run = tables.workflowRun.rows[0];
    expect(run.status).toBe("waiting");
    expect(run.stepsSnapshot).toHaveLength(2);
    // Edit the live definition while the run sleeps.
    await svc.update("org", wf.id, { steps: [{ type: "add_conversation_note", text: "বদলানো ধাপ" }] });
    const resumed = await svc.resumeRuns(new Date(Date.now() + 31 * 60000));
    expect(resumed).toBe(1);
    expect(notes.map((n) => n.content)).toEqual(["আসল ধাপ"]);
    expect(tables.workflowRun.rows[0].status).toBe("completed");
  });
});
