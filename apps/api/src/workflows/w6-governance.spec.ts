process.env.DISABLE_SCHEDULER = "true";

import { WorkflowsService, WORKFLOW_PRESETS } from "./workflows.service";

/**
 * Workflows W6: per-entity cooldown + daily cap govern
 * AUTOMATED firings only (manual runs bypass), skips are
 * recorded without self-perpetuating, and presets
 * install disabled.
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
  for (const n of ["workflow", "workflowRun", "conversationNote", "channelConversation", "channelMessage", "leadActivity", "lead"]) tables[n] = makeTable(n);
  const notes: any[] = [];
  tables.conversationNote.create = async ({ data }: any) => { notes.push(data); return data; };
  const messagingStub = { getTemplate: async () => ({ id: "t", channel: "email" }), sendToRecipient: async () => ({ status: "sent", address: "x", providerMessageId: "p" }) } as any;
  const svc = new WorkflowsService(tables as any, { log: async () => undefined } as any, { on: () => undefined, emit: () => undefined } as any, messagingStub, undefined);
  return { tables, svc, notes };
}

describe("W6 governance", () => {
  it("cooldown skips a second automated run for the same entity — and the skip does not extend it", async () => {
    const { tables, svc, notes } = setup();
    const wf: any = await svc.create("org", "u1", {
      name: "Cool", trigger: "inbox_message_received", cooldownMinutes: 60,
      steps: [{ type: "add_conversation_note", text: "নোট" }],
    });
    expect(wf.cooldownMinutes).toBe(60);
    const ctx = { conversationId: "c1" };
    await svc.handleTrigger("inbox_message_received", { organizationId: "org", context: ctx });
    await svc.handleTrigger("inbox_message_received", { organizationId: "org", context: ctx });
    await svc.handleTrigger("inbox_message_received", { organizationId: "org", context: ctx });
    const runs = tables.workflowRun.rows;
    expect(runs.map((r: any) => r.status)).toEqual(["completed", "skipped", "skipped"]);
    expect(runs[1].error).toContain("cooldown:");
    expect(notes).toHaveLength(1);
    // A different entity is unaffected.
    await svc.handleTrigger("inbox_message_received", { organizationId: "org", context: { conversationId: "c2" } });
    expect(notes).toHaveLength(2);
    void wf;
  });

  it("daily cap stops automated runs; a manual run bypasses governance", async () => {
    const { tables, svc } = setup();
    const wf: any = await svc.create("org", "u1", {
      name: "Capped", trigger: "lead_created", dailyRunCap: 1,
      steps: [{ type: "add_lead_activity", text: "x" }],
    });
    tables.lead.rows.push({ id: "lead-1", organizationId: "org", stage: "new", tags: [] });
    await svc.handleTrigger("lead_created", { organizationId: "org", context: { leadId: "lead-1" } });
    await svc.handleTrigger("lead_created", { organizationId: "org", context: { leadId: "lead-1" } });
    const runs = tables.workflowRun.rows;
    expect(runs[0].status).toBe("completed");
    expect(runs[1].status).toBe("skipped");
    expect(runs[1].error).toContain("daily_cap:");
    const manual: any = await svc.manualRun("org", wf.id, "u1", { leadId: "lead-1" });
    expect(manual.status).toBe("completed");
  });

  it("governance fields validate on update", async () => {
    const { svc } = setup();
    const wf: any = await svc.create("org", "u1", { name: "V", trigger: "lead_created", steps: [{ type: "add_lead_activity", text: "x" }] });
    await expect(svc.update("org", wf.id, { cooldownMinutes: 99999 })).rejects.toThrow(/cooldownMinutes/);
    await expect(svc.update("org", wf.id, { dailyRunCap: 0 })).rejects.toThrow(/dailyRunCap/);
    const ok: any = await svc.update("org", wf.id, { cooldownMinutes: 30, dailyRunCap: null });
    expect(ok.cooldownMinutes).toBe(30);
    expect(ok.dailyRunCap).toBeNull();
  });

  it("presets install disabled with the catalog definition; unknown keys 404", async () => {
    const { svc, tables } = setup();
    expect(WORKFLOW_PRESETS.length).toBe(11); // 6 classics + A1 refund_team_alert + A2 shipment_return_alert + W7 cart_recovery_alert/vip_order_channel_alert/ai_inbox_reply_assist (owner series d39f02a, merged d851b40)
    const installed: any = await svc.installPreset("org", "u1", "delivered_review");
    expect(installed.enabled).toBe(false);
    expect(installed.trigger).toBe("order_delivered");
    expect(installed.steps).toEqual(WORKFLOW_PRESETS.find((p) => p.key === "delivered_review")!.steps);
    expect(tables.workflow.rows).toHaveLength(1);
    await expect(svc.installPreset("org", "u1", "nope")).rejects.toMatchObject({ code: "workflows.presetNotFound" });
  });
});
