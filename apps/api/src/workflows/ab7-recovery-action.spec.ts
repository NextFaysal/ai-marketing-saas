process.env.DISABLE_SCHEDULER = "true";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { Global, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { WorkflowsService } from "./workflows.service";
import { WorkflowsModule } from "./workflows.module";
import { PrismaService } from "../prisma/prisma.service";
import { EventsModule } from "../common/events.service";
import { AbandonedCheckoutsService } from "../commerce/abandoned-checkouts.service";
import { JOURNEY_PRESETS } from "../messaging/journey-presets";

/**
 * AB7 / AX18 — the issue_recovery_coupon workflow action, the
 * cart_recovery_3step journey preset, and the DI wiring.
 *
 * Fake-prisma + stub style of the other workflow specs. The
 * messaging stub records sendToRecipient calls (the real
 * MessagingService rendering/suppression behaviour is pinned
 * by the MS specs); the abandoned stub SIMULATES the real
 * issueRecoveryCoupon — when enabled it writes the
 * StoreDiscount row (origin abandoned_recovery + the caller's
 * sourceRef) exactly like the real method, so the action's
 * wf:-keyed reuse pre-check is exercised against real-shaped
 * data.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
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
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (row) Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const r of rows) if (matches(r, where ?? {})) { Object.assign(r, data); count++; }
      return { count };
    },
  };
}

const TEMPLATE = {
  id: "tpl-sms", organizationId: "org-1", name: "Recovery SMS", channel: "sms",
  subject: null, body: "{{name}}, আপনার কার্ট অপেক্ষা করছে ({{itemsSummary}})।",
};
const CART_CONTEXT = {
  visitorId: "vis-1", sessionKey: "sess-1", storeId: "store-1",
  contactPhone: "01712345678", contactName: "Rahim", contactEmail: undefined,
  itemsSummary: "T-Shirt x1", cartValue: 500, itemsCount: 1,
};

function build(opts?: { couponEnabled?: boolean; sendStatus?: "sent" | "failed" | "skipped" }) {
  const tables: any = {
    workflow: makeTable("wf"), workflowRun: makeTable("run"), storeDiscount: makeTable("disc"),
    customer: makeTable("cust"), lead: makeTable("lead"), membership: makeTable("mem"),
    agentNotification: makeTable("note"), auditLog: makeTable("audit"),
  };
  const sends: any[] = [];
  const messaging: any = {
    getTemplate: async (_org: string, id: string) => {
      if (id !== TEMPLATE.id) throw new Error("Template not found");
      return TEMPLATE;
    },
    sendToRecipient: async (_org: string, input: any) => {
      sends.push(input);
      const status = opts?.sendStatus ?? "sent";
      if (status === "sent") return { status, providerMessageId: "sms-1", address: "8801712345678" };
      if (status === "skipped") return { status, error: "Recipient opted out (manual)", address: "8801712345678" };
      return { status, error: "provider down", address: "8801712345678" };
    },
    registerWorkflowCreator: () => undefined,
  };
  const issueCalls: string[] = [];
  const abandoned: any = {
    issueRecoveryCoupon: async (orgId: string, sourceRef: string) => {
      issueCalls.push(sourceRef);
      if (opts?.couponEnabled === false) return null;
      const coupon = { code: "RCV-TEST1234", kind: "percent", value: 10, expiryHours: 72 };
      tables.storeDiscount.rows.push({
        id: `disc-row-${issueCalls.length}`, organizationId: orgId, code: coupon.code,
        kind: "percent", value: 10, origin: "abandoned_recovery", sourceRef,
        endsAt: new Date(Date.now() + 72 * 3600_000), active: true,
      });
      return coupon;
    },
  };
  const svc = new WorkflowsService(
    tables as any,
    { log: async () => undefined } as any,
    { on: () => undefined, emit: () => undefined } as any,
    messaging,
    undefined,
    undefined,
    abandoned,
  );
  return { tables, svc, sends, issueCalls, messaging };
}

describe("AX18 issue_recovery_coupon action", () => {
  it("issues with the wf:{runId}:{stepIndex} sourceRef and sends template + coupon lines, with {{couponCode}} in vars", async () => {
    const { tables, svc, sends, issueCalls } = build();
    const workflow = await svc.create("org-1", "owner", {
      name: "Recovery", trigger: "cart_abandoned",
      steps: [{ type: "issue_recovery_coupon", templateId: "tpl-sms" }],
    });
    const run: any = await svc.runWorkflow(workflow, { ...CART_CONTEXT });
    const finalRun = tables.workflowRun.rows.find((r: any) => r.id === run.id);
    expect(finalRun.status).toBe("completed");
    expect(issueCalls).toEqual([`wf:${run.id}:0`]);
    expect(sends).toHaveLength(1);
    expect(sends[0].channel).toBe("sms");
    expect(sends[0].workflowRunId).toBe(run.id);
    expect(sends[0].recipient.phone).toBe("01712345678");
    // The composed body: template body + EC10-style coupon lines.
    expect(sends[0].body).toContain(TEMPLATE.body);
    expect(sends[0].body).toContain("আপনার জন্য একটি কুপন কোড: RCV-TEST1234 (10% ছাড়)");
    expect(sends[0].body).toContain("কোডটি 72 ঘণ্টা পর্যন্ত বৈধ");
    // ...and the code is ALSO available as a context variable.
    expect(sends[0].vars.couponCode).toBe("RCV-TEST1234");
    expect(sends[0].vars.itemsSummary).toBe("T-Shirt x1");
    expect(finalRun.stepsLog).toEqual([
      expect.objectContaining({ step: "issue_recovery_coupon", status: "ok" }),
    ]);
    // EC10 precedent: the staff-visible log carries the full code.
    expect(finalRun.stepsLog[0].detail).toContain("RCV-TEST1234");
  });

  it("reuses the already-issued coupon on re-execution of the same run+step (issuance called once)", async () => {
    const { tables, svc, sends, issueCalls } = build();
    const steps = [{ type: "issue_recovery_coupon", templateId: "tpl-sms" }];
    const workflow: any = {
      id: "wf-1", organizationId: "org-1", name: "Recovery", trigger: "cart_abandoned",
      steps, enabled: true, createdById: "owner",
    };
    tables.workflow.rows.push(workflow);
    const run: any = await tables.workflowRun.create({
      data: {
        organizationId: "org-1", workflowId: "wf-1", trigger: "cart_abandoned",
        context: { ...CART_CONTEXT }, status: "completed", stepsLog: [], stepsSnapshot: steps,
      },
    });
    // First execution issues; a crash/re-entry of the SAME
    // run+step must reuse the StoreDiscount row, not re-issue.
    await (svc as any).executeSteps(workflow, run, { ...CART_CONTEXT }, 0, [], new Date());
    const log2: any[] = [];
    await (svc as any).executeSteps(workflow, run, { ...CART_CONTEXT }, 0, log2, new Date());
    expect(issueCalls).toHaveLength(1);
    expect(tables.storeDiscount.rows).toHaveLength(1);
    expect(sends).toHaveLength(2);
    expect(sends[0].vars.couponCode).toBe("RCV-TEST1234");
    expect(sends[1].vars.couponCode).toBe("RCV-TEST1234");
    expect(log2[0]).toMatchObject({ step: "issue_recovery_coupon", status: "ok" });
    expect(log2[0].detail).toContain("reused");
  });

  it("disabled coupon setting → step skipped, NO message sent for it, and the run CONTINUES", async () => {
    const { tables, svc, sends, issueCalls } = build({ couponEnabled: false });
    const workflow = await svc.create("org-1", "owner", {
      name: "Recovery seq", trigger: "cart_abandoned",
      steps: [
        { type: "issue_recovery_coupon", templateId: "tpl-sms" },
        { type: "send_sms", templateId: "tpl-sms" },
      ],
    });
    const run: any = await svc.runWorkflow(workflow, { ...CART_CONTEXT });
    const finalRun = tables.workflowRun.rows.find((r: any) => r.id === run.id);
    expect(finalRun.status).toBe("completed");
    expect(issueCalls).toEqual([`wf:${run.id}:0`]);
    expect(finalRun.stepsLog[0]).toMatchObject({ step: "issue_recovery_coupon", status: "skipped" });
    expect(finalRun.stepsLog[0].detail).toContain("coupon setting disabled");
    expect(finalRun.stepsLog[1]).toMatchObject({ step: "send_sms", status: "ok" });
    // Exactly one send: the plain send_sms step (raw template
    // body, no coupon lines) — the skipped coupon step sent
    // nothing.
    expect(sends).toHaveLength(1);
    expect(sends[0].body).toBe(TEMPLATE.body);
  });

  it("send failure mirrors the send_sms branch: step failed, run failed", async () => {
    const { tables, svc } = build({ sendStatus: "failed" });
    const workflow = await svc.create("org-1", "owner", {
      name: "Recovery", trigger: "cart_abandoned",
      steps: [{ type: "issue_recovery_coupon", templateId: "tpl-sms" }],
    });
    const run: any = await svc.runWorkflow(workflow, { ...CART_CONTEXT });
    const finalRun = tables.workflowRun.rows.find((r: any) => r.id === run.id);
    expect(finalRun.status).toBe("failed");
    expect(finalRun.stepsLog[0]).toMatchObject({ step: "issue_recovery_coupon", status: "failed" });
    expect(finalRun.stepsLog[0].detail).toContain("provider down");
  });

  it("recipient opt-out mirrors send_sms: StepSkipped → logged skipped, run completes", async () => {
    const { tables, svc } = build({ sendStatus: "skipped" });
    const workflow = await svc.create("org-1", "owner", {
      name: "Recovery", trigger: "cart_abandoned",
      steps: [{ type: "issue_recovery_coupon", templateId: "tpl-sms" }],
    });
    const run: any = await svc.runWorkflow(workflow, { ...CART_CONTEXT });
    const finalRun = tables.workflowRun.rows.find((r: any) => r.id === run.id);
    expect(finalRun.status).toBe("completed");
    expect(finalRun.stepsLog[0]).toMatchObject({ step: "issue_recovery_coupon", status: "skipped" });
    expect(finalRun.stepsLog[0].detail).toContain("opted out");
  });

  it("validation mirrors send_sms: the coupon step requires a templateId", async () => {
    const { svc } = build();
    await expect(svc.create("org-1", "owner", {
      name: "x", trigger: "cart_abandoned", steps: [{ type: "issue_recovery_coupon" }],
    })).rejects.toThrow("templateId");
  });

  it("dry run traces the coupon step without issuing or sending", async () => {
    const { svc, sends, issueCalls } = build();
    const workflow = await svc.create("org-1", "owner", {
      name: "Recovery", trigger: "cart_abandoned",
      steps: [{ type: "issue_recovery_coupon", templateId: "tpl-sms" }],
    });
    const res: any = await svc.dryRun("org-1", workflow.id, { ...CART_CONTEXT });
    expect(res.conditionsPassed).toBe(true);
    expect(res.trace).toEqual([
      expect.objectContaining({
        step: "issue_recovery_coupon",
        detail: expect.stringContaining("would issue a recovery coupon (if enabled) and send template \"Recovery SMS\""),
      }),
    ]);
    expect(issueCalls).toHaveLength(0);
    expect(sends).toHaveLength(0);
  });
});

describe("AX18 cart_recovery_3step preset shape", () => {
  const preset = JOURNEY_PRESETS.find((p) => p.key === "cart_recovery_3step")!;

  it("exists with cart_abandoned trigger + sms channel like cart_recovery", () => {
    expect(preset).toBeDefined();
    expect(preset.trigger).toBe("cart_abandoned");
    expect(preset.channel).toBe("sms");
    expect(preset.name).toBeTruthy();
    expect(preset.descriptionBn).toBeTruthy();
  });

  it("steps are wait 60 → send → wait 1380 (23h) → coupon → wait 2880 (48h) → send; waits sum to 72h", () => {
    expect(preset.steps("tpl-9")).toEqual([
      { type: "wait", minutes: 60 },
      { type: "send_sms", templateId: "tpl-9" },
      { type: "wait", minutes: 1380 },
      { type: "issue_recovery_coupon", templateId: "tpl-9" },
      { type: "wait", minutes: 2880 },
      { type: "send_sms", templateId: "tpl-9" },
    ]);
    const waits = preset.steps("tpl-9").filter((s: any) => s.type === "wait") as any[];
    expect(waits.reduce((a, s) => a + s.minutes, 0)).toBe(4320);
  });

  it("the preset template carries NO coupon code — the coupon step composes its own", () => {
    expect(preset.template.body).not.toContain("couponCode");
    expect(preset.template.body).not.toContain("RCV-");
    expect(preset.template.body).toContain("{{itemsSummary}}");
  });
});

describe("AX18 DI wiring (real module graph)", () => {
  it("WorkflowsModule resolves and injects the real AbandonedCheckoutsService into WorkflowsService", async () => {
    // Any table a provider touches resolves to an empty fake
    // table — no database is ever reached.
    const cache: Record<string, any> = {};
    const fakePrisma: any = new Proxy({}, {
      get: (_t, p: string | symbol) => {
        if (typeof p !== "string") return undefined;
        if (!cache[p]) cache[p] = makeTable(p);
        return cache[p];
      },
    });
    @Global()
    @Module({ providers: [{ provide: PrismaService, useValue: fakePrisma }], exports: [PrismaService] })
    class FakePrismaModule {}

    @Module({ imports: [FakePrismaModule, EventsModule, WorkflowsModule] })
    class Ab7GraphRootModule {}

    const ctx = await NestFactory.createApplicationContext(Ab7GraphRootModule, { logger: false });
    try {
      const workflows = ctx.get(WorkflowsService);
      expect(workflows).toBeInstanceOf(WorkflowsService);
      expect((workflows as any).abandonedCheckouts).toBeInstanceOf(AbandonedCheckoutsService);
    } finally {
      await ctx.close();
    }
  });
});
