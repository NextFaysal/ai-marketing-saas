process.env.JWT_SECRET = "test-secret";
process.env.WEB_URL = "https://app.example.com";
process.env.API_PUBLIC_URL = "https://api.example.com";
process.env.DISABLE_SCHEDULER = "true";

import { MessagingService } from "./messaging.service";

/**
 * MX4 — messaging journeys: CRUD through a STUBBED workflow
 * port (incl. the honest refusal when no engine is
 * registered), messaging-side step validation, per-step
 * stats math (idx-carrying runs, legacy runs, waitingHere),
 * and the MX4 stepRef delivery stamp.
 *
 * The tracking extension (workflow open/link tokens) is
 * deliberately NOT covered here because it was NOT built:
 * ms5-composer.spec.ts pins "workflow sends are NEVER
 * rewritten" through sendToRecipient with a workflowRunId —
 * see docs/messaging-mx4-acceptance.md.
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
      if ("contains" in v && !String(row[k] ?? "").includes(String(v.contains))) return false;
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
function applyOrder(list: any[], orderBy: any): any[] {
  if (!orderBy) return list;
  const keys = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...list];
  for (let i = keys.length - 1; i >= 0; i--) {
    const [key, dir] = Object.entries(keys[i])[0] as [string, string];
    out.sort((a, b) => (dir === "desc" ? cmp(b[key], a[key]) : cmp(a[key], b[key])));
  }
  return out;
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findUnique: async ({ where }: any) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where, take, orderBy }: any = {}) => {
      const f = applyOrder(rows.filter((r) => matches(r, where ?? {})), orderBy);
      return take ? f.slice(0, take) : f;
    },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where ?? {}));
      if (row) { Object.assign(row, data); row.updatedAt = new Date(); }
      return row;
    },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); if (i >= 0) rows.splice(i, 1); return {}; },
  };
}

/** An in-memory WorkflowCreatorPort stub: the journey service
 * must do EVERYTHING through it (never the Workflow table). */
function makePort() {
  const store: any[] = [];
  const runs: any[] = [];
  const calls: any[] = [];
  let seq = 0;
  return {
    store, runs, calls,
    create: async (organizationId: string, actorId: string, dto: any) => {
      calls.push({ m: "create", dto });
      const wf = { id: `wf-${++seq}`, organizationId, createdById: actorId, enabled: true, conditions: null, createdAt: new Date(), updatedAt: new Date(), ...dto };
      store.push(wf);
      return wf;
    },
    update: async (_org: string, id: string, dto: any) => {
      calls.push({ m: "update", id, dto });
      const wf = store.find((w) => w.id === id);
      if (wf) Object.assign(wf, dto);
      return wf;
    },
    list: async (organizationId: string) => store.filter((w) => w.organizationId === organizationId),
    listRuns: async (organizationId: string, f?: any) => runs
      .filter((r) => r.organizationId === organizationId && (!f?.workflowId || r.workflowId === f.workflowId) && (!f?.status || r.status === f.status))
      .slice(0, f?.take ?? 50),
  };
}

function build(withPort = true) {
  const tables: Record<string, any> = {};
  for (const n of ["messageTemplate", "messageDelivery", "messageLinkClick", "workflowRun", "messagePreference", "messagingSetting", "messagingSenderConfig", "customer", "lead"]) {
    tables[n] = makeTable(n);
  }
  tables.organization = { findUnique: async () => ({ timezone: "Asia/Dhaka" }) };
  const auditCalls: any[] = [];
  const audit = { log: async (entry: any) => { auditCalls.push(entry); } } as any;
  const emailCalls: any[] = [];
  const email = { isConfigured: () => true, send: async (input: any) => { emailCalls.push(input); return { providerMessageId: "m1" }; } } as any;
  const sms = { isConfigured: () => true, send: async () => ({ providerMessageId: "s1" }) } as any;
  const svc = new MessagingService(tables as any, audit, email, sms);
  const port = makePort();
  if (withPort) svc.registerWorkflowCreator(port as any);
  return { tables, auditCalls, emailCalls, svc, port };
}

async function seedTemplates(b: ReturnType<typeof build>) {
  const emailTpl: any = await b.svc.createTemplate("org-1", "owner", { name: "Mail", channel: "email", subject: "S", body: "B" });
  const smsTpl: any = await b.svc.createTemplate("org-1", "owner", { name: "Text", channel: "sms", body: "B" });
  return { emailTpl, smsTpl };
}

describe("MX4 journey meta", () => {
  it("offers exactly the recipient-resolvable triggers and NO opened/clicked fields (tracking not built)", () => {
    const { svc } = build();
    const meta: any = svc.getJourneyMeta();
    expect(meta.triggers.map((t: any) => t.trigger)).toEqual([
      "order_created", "order_delivered", "order_cod_confirmed",
      "lead_created", "lead_stage_changed", "cart_abandoned", "inbox_message_received",
    ]);
    expect(meta.triggers.map((t: any) => t.trigger)).not.toContain("schedule");
    const fields = meta.conditionFields.map((f: any) => f.field);
    expect(fields).toEqual(["total", "status", "source", "stage", "purchasedSinceEntry", "customerTags"]);
    expect(fields).not.toContain("journeyOpened");
    expect(fields).not.toContain("journeyClicked");
    expect(meta.stepTypes.map((s: any) => s.type)).toEqual(["wait", "send_email", "send_sms", "condition", "branch", "add_tag"]);
  });
});

describe("MX4 journey CRUD through the port", () => {
  it("refuses honestly when no workflow engine is registered", async () => {
    const b = build(false);
    await expect(b.svc.createJourney("org-1", "owner", { name: "X", trigger: "order_created", steps: [{ type: "wait", minutes: 5 }] }))
      .rejects.toThrow("Workflow engine is not available in this deployment");
    await expect(b.svc.listJourneys("org-1")).rejects.toThrow("Workflow engine is not available in this deployment");
    await expect(b.svc.getJourney("org-1", "wf-1")).rejects.toThrow("Workflow engine is not available in this deployment");
  });

  it("create: journey meta rides the port create, then enabled:false via port update; audited", async () => {
    const b = build();
    const { smsTpl } = await seedTemplates(b);
    const res: any = await b.svc.createJourney("org-1", "owner", {
      name: "কার্ট রিকভারি নিজের মতো", trigger: "cart_abandoned", exitOnPurchase: true,
      steps: [{ type: "wait", minutes: 60 }, { type: "send_sms", templateId: smsTpl.id }],
    });
    expect(res.enabled).toBe(false);
    const createCall = b.port.calls.find((c: any) => c.m === "create");
    expect(createCall.dto.journey).toEqual({ origin: "messaging", exitOnPurchase: true });
    expect(createCall.dto.trigger).toBe("cart_abandoned");
    const updateCall = b.port.calls.find((c: any) => c.m === "update");
    expect(updateCall.dto).toEqual({ enabled: false });
    expect(b.port.store[0].enabled).toBe(false);
    expect(b.port.store[0].journey).toEqual({ origin: "messaging", exitOnPurchase: true });
    expect(b.auditCalls.some((c: any) => c.action === "messaging.journey_create" && c.metadata.exitOnPurchase === true)).toBe(true);
  });

  it("create defaults exitOnPurchase to false in the stored meta", async () => {
    const b = build();
    await b.svc.createJourney("org-1", "owner", { name: "J", trigger: "lead_created", steps: [{ type: "wait", minutes: 5 }] });
    expect(b.port.store[0].journey).toEqual({ origin: "messaging", exitOnPurchase: false });
  });

  it("update: enabled + exitOnPurchase ride the port; the response carries the stepsSnapshot note", async () => {
    const b = build();
    const created: any = await b.svc.createJourney("org-1", "owner", { name: "J", trigger: "lead_created", steps: [{ type: "wait", minutes: 5 }] });
    const id = created.workflow.id;
    const res: any = await b.svc.updateJourney("org-1", "owner", id, { enabled: true, exitOnPurchase: true });
    const upd = b.port.calls.filter((c: any) => c.m === "update").pop();
    expect(upd.dto.enabled).toBe(true);
    expect(upd.dto.journey).toEqual({ origin: "messaging", exitOnPurchase: true });
    expect(res.note).toContain("stepsSnapshot");
    expect(b.port.store[0].enabled).toBe(true);
    expect(b.auditCalls.some((c: any) => c.action === "messaging.journey_update")).toBe(true);
  });

  it("a non-journey workflow and an unknown id are both 404", async () => {
    const b = build();
    b.port.store.push({ id: "wf-plain", organizationId: "org-1", name: "Ops", trigger: "order_created", steps: [], enabled: true, journey: null });
    await expect(b.svc.getJourney("org-1", "wf-plain")).rejects.toThrow("Journey not found");
    await expect(b.svc.getJourney("org-1", "wf-nope")).rejects.toThrow("Journey not found");
    await expect(b.svc.updateJourney("org-1", "owner", "wf-plain", { enabled: true })).rejects.toThrow("Journey not found");
  });

  it("list returns only this org's journeys, each with a run summary", async () => {
    const b = build();
    const created: any = await b.svc.createJourney("org-1", "owner", { name: "J", trigger: "lead_created", steps: [{ type: "wait", minutes: 5 }] });
    b.port.store.push({ id: "wf-plain", organizationId: "org-1", name: "Ops", trigger: "order_created", steps: [], enabled: true, journey: null });
    b.port.store.push({ id: "wf-other", organizationId: "org-2", name: "Other", trigger: "order_created", steps: [], enabled: true, journey: { origin: "messaging" } });
    const id = created.workflow.id;
    b.port.runs.push(
      { id: "r1", organizationId: "org-1", workflowId: id, status: "completed" },
      { id: "r2", organizationId: "org-1", workflowId: id, status: "completed" },
      { id: "r3", organizationId: "org-1", workflowId: id, status: "waiting" },
      { id: "r4", organizationId: "org-1", workflowId: id, status: "failed" },
    );
    const list: any[] = await b.svc.listJourneys("org-1");
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
    expect(list[0].runSummary).toEqual({ total: 4, waiting: 1, completed: 2, failed: 1, skipped: 0 });
  });
});

describe("MX4 messaging-side step validation", () => {
  it("refuses a bad trigger, an empty name and empty steps", async () => {
    const b = build();
    await expect(b.svc.createJourney("org-1", "owner", { name: "J", trigger: "schedule", steps: [{ type: "wait", minutes: 5 }] }))
      .rejects.toThrow(/cannot start a messaging journey/);
    await expect(b.svc.createJourney("org-1", "owner", { name: "J", trigger: "order_status_changed", steps: [{ type: "wait", minutes: 5 }] }))
      .rejects.toThrow(/cannot start a messaging journey/);
    await expect(b.svc.createJourney("org-1", "owner", { name: "J", trigger: "order_created", steps: [] }))
      .rejects.toThrow(/at least one step/);
  });

  it("refuses step types outside the journey allowlist", async () => {
    const b = build();
    await expect(b.svc.createJourney("org-1", "owner", { name: "J", trigger: "order_created", steps: [{ type: "http_webhook", url: "https://x.example" }] }))
      .rejects.toThrow(/may only use/);
    await expect(b.svc.createJourney("org-1", "owner", { name: "J", trigger: "order_created", steps: [{ type: "send_whatsapp" }] }))
      .rejects.toThrow(/may only use/);
  });

  it("refuses wait / condition / nested branch inside a branch arm; allows send+tag arms", async () => {
    const b = build();
    const { smsTpl } = await seedTemplates(b);
    const branch = (arm: any[]) => [{ type: "branch", field: "total", op: "gte", value: 100, then: arm, else: [] }];
    await expect(b.svc.createJourney("org-1", "owner", { name: "J", trigger: "order_created", steps: branch([{ type: "wait", minutes: 5 }]) }))
      .rejects.toThrow(/Branch arms/);
    await expect(b.svc.createJourney("org-1", "owner", { name: "J", trigger: "order_created", steps: branch([{ type: "condition", field: "total", op: "eq", value: 1 }]) }))
      .rejects.toThrow(/Branch arms/);
    await expect(b.svc.createJourney("org-1", "owner", { name: "J", trigger: "order_created", steps: branch([{ type: "branch", field: "x", op: "eq", value: 1, then: [{ type: "add_tag", tag: "t" }], else: [] }]) }))
      .rejects.toThrow(/Branch arms/);
    await expect(b.svc.createJourney("org-1", "owner", { name: "J", trigger: "order_created", steps: [{ type: "branch", field: "total", op: "gte", value: 100, then: [], else: [] }] }))
      .rejects.toThrow(/at least one sub-step/);
    // A legal arm passes validation (send + add_tag).
    const ok: any = await b.svc.createJourney("org-1", "owner", {
      name: "J", trigger: "order_created",
      steps: branch([{ type: "send_sms", templateId: smsTpl.id }, { type: "add_tag", tag: "big", target: "lead" }]),
    });
    expect(ok.workflow.id).toBeTruthy();
  });

  it("refuses a send step whose template channel does not match, and a send without a templateId", async () => {
    const b = build();
    const { emailTpl } = await seedTemplates(b);
    await expect(b.svc.createJourney("org-1", "owner", { name: "J", trigger: "order_created", steps: [{ type: "send_sms", templateId: emailTpl.id }] }))
      .rejects.toThrow(/Template channel \(email\) does not match step \(sms\)/);
    await expect(b.svc.createJourney("org-1", "owner", { name: "J", trigger: "order_created", steps: [{ type: "send_email" }] }))
      .rejects.toThrow(/need a templateId/);
    await expect(b.svc.createJourney("org-1", "owner", { name: "J", trigger: "order_created", steps: [{ type: "wait", minutes: 99999 }] }))
      .rejects.toThrow(/minutes between 1 and 43200/);
  });

  it("update re-validates steps with the same rules before touching the port", async () => {
    const b = build();
    const created: any = await b.svc.createJourney("org-1", "owner", { name: "J", trigger: "lead_created", steps: [{ type: "wait", minutes: 5 }] });
    const updatesBefore = b.port.calls.filter((c: any) => c.m === "update").length;
    await expect(b.svc.updateJourney("org-1", "owner", created.workflow.id, {
      steps: [{ type: "branch", field: "total", op: "gte", value: 1, then: [{ type: "wait", minutes: 5 }], else: [] }],
    })).rejects.toThrow(/Branch arms/);
    expect(b.port.calls.filter((c: any) => c.m === "update")).toHaveLength(updatesBefore); // nothing was written
  });
});

describe("MX4 per-step stats", () => {
  async function seedJourneyWithRuns(b: ReturnType<typeof build>) {
    const { emailTpl, smsTpl } = await seedTemplates(b);
    const steps = [
      { type: "wait", minutes: 60 },
      { type: "send_email", templateId: emailTpl.id },
      { type: "branch", field: "total", op: "gte", value: 100, then: [{ type: "send_sms", templateId: smsTpl.id }], else: [] },
    ];
    const created: any = await b.svc.createJourney("org-1", "owner", { name: "Stats", trigger: "order_created", steps });
    const wfId = created.workflow.id;
    // Port runs feed recentRuns; prisma runs feed the stats.
    b.port.runs.push(
      { id: "run-1", organizationId: "org-1", workflowId: wfId, status: "completed" },
      { id: "run-2", organizationId: "org-1", workflowId: wfId, status: "waiting" },
      { id: "run-3", organizationId: "org-1", workflowId: wfId, status: "completed" },
    );
    b.tables.workflowRun.rows.push(
      {
        id: "run-1", organizationId: "org-1", workflowId: wfId, status: "completed", nextStepIndex: 3,
        stepsLog: [
          { step: "wait", status: "ok", idx: 0 },
          { step: "send_email", status: "ok", idx: 1 },
          { step: "branch", status: "ok", idx: 2 },
          { step: "send_sms", status: "ok", idx: 2, ref: "2.then.0", branch: "then" },
        ],
      },
      {
        id: "run-2", organizationId: "org-1", workflowId: wfId, status: "waiting", nextStepIndex: 1,
        stepsLog: [{ step: "wait", status: "ok", idx: 0 }],
      },
      {
        // Legacy (pre-MX4) run: entries carry no idx at all.
        id: "run-3", organizationId: "org-1", workflowId: wfId, status: "completed", nextStepIndex: 3,
        stepsLog: [{ step: "send_email", status: "ok" }],
      },
    );
    b.tables.messageDelivery.rows.push(
      { id: "d1", organizationId: "org-1", workflowRunId: "run-1", stepRef: "1", status: "sent", openedAt: new Date() },
      { id: "d2", organizationId: "org-1", workflowRunId: "run-1", stepRef: "1", status: "failed", openedAt: null },
      { id: "d3", organizationId: "org-1", workflowRunId: "run-1", stepRef: "2.then.0", status: "sent", openedAt: null },
      { id: "d4", organizationId: "org-1", workflowRunId: "run-3", stepRef: null, status: "sent", openedAt: null },
    );
    b.tables.messageLinkClick.rows.push(
      { id: "k1", organizationId: "org-1", workflowRunId: "run-1", broadcastId: null },
      { id: "k2", organizationId: "org-1", workflowRunId: "run-1", broadcastId: null },
    );
    return wfId;
  }

  it("counts entries by idx, waitingHere from waiting runs, deliveries by stepRef (branch via arm refs), legacy runs disclosed", async () => {
    const b = build();
    const wfId = await seedJourneyWithRuns(b);
    const res: any = await b.svc.getJourney("org-1", wfId);
    expect(res.runSummary).toEqual({ total: 3, waiting: 1, completed: 2, failed: 0, skipped: 0 });
    expect(res.legacyRunCount).toBe(1);
    expect(res.totalClicks).toBe(2); // journey level only
    expect(res.recentRuns).toHaveLength(3);
    const [s0, s1, s2] = res.stepStats;
    expect(s0).toMatchObject({ idx: 0, type: "wait", entered: 2, ok: 2, skipped: 0, failed: 0, waitingHere: 1, delivery: null });
    expect(s1).toMatchObject({ idx: 1, type: "send_email", entered: 1, ok: 1, waitingHere: null });
    expect(s1.delivery).toEqual({ sent: 1, failed: 1, skipped: 0, opened: 1 });
    // The branch row counts its own line + the arm sub-step line;
    // its delivery aggregate comes from the arm ref "2.then.0".
    expect(s2).toMatchObject({ idx: 2, type: "branch", entered: 2, ok: 2 });
    expect(s2.delivery).toEqual({ sent: 1, failed: 0, skipped: 0, opened: 0 });
  });
});

describe("MX4 stepRef delivery stamp", () => {
  it("sendToRecipient stamps stepRef on the delivery row; absent stepRef stays null", async () => {
    const b = build();
    b.tables.customer.rows.push({ id: "c1", organizationId: "org-1", firstName: "Ayesha", lastName: null, email: "ayesha@example.com", phone: "01712345678" });
    const recipient = { type: "customer" as const, id: "c1", name: "Ayesha", email: "ayesha@example.com", phone: "01712345678" };
    const r1 = await b.svc.sendToRecipient("org-1", {
      channel: "email", recipient, subject: "s", body: "b", vars: {}, workflowRunId: "run-9", stepRef: "2.then.0",
    });
    expect(r1.status).toBe("sent");
    const r2 = await b.svc.sendToRecipient("org-1", {
      channel: "email", recipient, subject: "s", body: "b", vars: {}, workflowRunId: "run-9",
    });
    expect(r2.status).toBe("sent");
    const rows = b.tables.messageDelivery.rows;
    expect(rows).toHaveLength(2);
    expect(rows[0].stepRef).toBe("2.then.0");
    expect(rows[1].stepRef).toBeNull();
  });
});
