process.env.DISABLE_SCHEDULER = "true";

import { WorkflowsService } from "./workflows.service";

/**
 * Workflows W4: the branch step runs exactly one arm,
 * logs which, and refuses nesting / waits in arms at
 * validation time.
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
  for (const n of ["workflow", "workflowRun", "conversationNote", "channelConversation", "channelMessage", "leadActivity", "lead"]) tables[n] = makeTable(n);
  const notes: any[] = [];
  tables.conversationNote.create = async ({ data }: any) => { notes.push(data); return data; };
  tables.lead.rows.push({ id: "lead-1", organizationId: "org", stage: "new", tags: [] });
  const messagingStub = { getTemplate: async () => ({ id: "t", channel: "email" }), sendToRecipient: async () => ({ status: "sent", address: "x", providerMessageId: "p" }) } as any;
  const svc = new WorkflowsService(tables as any, { log: async () => undefined } as any, { on: () => undefined, emit: () => undefined } as any, messagingStub, undefined);
  return { tables, svc, notes };
}

describe("W4 branch", () => {
  it("runs the THEN arm when the condition holds", async () => {
    const { svc, notes, tables } = setup();
    await svc.create("org", "u1", {
      name: "Big order", trigger: "order_created",
      steps: [{
        type: "branch", field: "total", op: "gte", value: 1000,
        then: [{ type: "add_conversation_note", text: "বড় অর্ডার" }],
        else: [{ type: "add_conversation_note", text: "ছোট অর্ডার" }],
      }, { type: "change_lead_stage", stage: "contacted" }],
    });
    await svc.handleTrigger("order_created", { organizationId: "org", context: { conversationId: "c1", leadId: "lead-1", total: 1500 } });
    expect(notes.map((n) => n.content)).toEqual(["বড় অর্ডার"]);
    const run = tables.workflowRun.rows[0];
    expect(run.status).toBe("completed");
    expect(run.stepsLog[0].detail).toContain("(then: 1 steps)");
    expect(run.stepsLog[1].branch).toBe("then");
    // Steps after the branch still run.
    expect(tables.lead.rows[0].stage).toBe("contacted");
  });

  it("runs the ELSE arm when it does not", async () => {
    const { svc, notes, tables } = setup();
    await svc.create("org", "u1", {
      name: "Big order", trigger: "order_created",
      steps: [{
        type: "branch", field: "total", op: "gte", value: 1000,
        then: [{ type: "add_conversation_note", text: "বড় অর্ডার" }],
        else: [{ type: "add_conversation_note", text: "ছোট অর্ডার" }],
      }],
    });
    await svc.handleTrigger("order_created", { organizationId: "org", context: { conversationId: "c1", total: 500 } });
    expect(notes.map((n) => n.content)).toEqual(["ছোট অর্ডার"]);
    expect(tables.workflowRun.rows[0].stepsLog[1].branch).toBe("else");
  });

  it("a failing sub-step fails the run but the other arm stays untouched", async () => {
    const { svc, tables } = setup();
    await svc.create("org", "u1", {
      name: "Fragile", trigger: "order_created",
      steps: [{
        type: "branch", field: "total", op: "gte", value: 1000,
        then: [{ type: "assign_conversation", userId: "nobody" }],
        else: [],
      }],
    });
    await svc.handleTrigger("order_created", { organizationId: "org", context: { conversationId: "c1", total: 5000 } });
    // assign needs a membership table the fake lacks ->
    // the step throws, the run is honestly failed.
    expect(tables.workflowRun.rows[0].status).toBe("failed");
  });

  it("validation refuses nesting, waits in arms, and empty branches", async () => {
    const { svc } = setup();
    await expect(svc.create("org", "u1", {
      name: "N", trigger: "lead_created",
      steps: [{ type: "branch", field: "x", op: "eq", value: 1, then: [{ type: "branch", field: "y", op: "eq", value: 2, then: [{ type: "add_lead_activity", text: "z" }], else: [] }], else: [] }],
    })).rejects.toThrow(/nest/);
    await expect(svc.create("org", "u1", {
      name: "W", trigger: "lead_created",
      steps: [{ type: "branch", field: "x", op: "eq", value: 1, then: [{ type: "wait", minutes: 5 }], else: [] }],
    })).rejects.toThrow(/wait steps are not allowed/);
    await expect(svc.create("org", "u1", {
      name: "E", trigger: "lead_created",
      steps: [{ type: "branch", field: "x", op: "eq", value: 1, then: [], else: [] }],
    })).rejects.toThrow(/at least one sub-step/);
  });
});
