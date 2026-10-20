process.env.DISABLE_SCHEDULER = "true";

import { WorkflowsService } from "./workflows.service";

/**
 * MB5 (ML14, CD-3) — workflow send steps apply MessageTemplate
 * per-locale variants (variant-if-exists). Harness in the MX4
 * style: fake prisma + a stub MessagingService whose
 * sendToRecipient captures exactly what the engine hands it.
 * The recipient locale chain is the REAL send-locale.ts
 * machinery (CustomerMemory.languagePref → org dashboardLocale
 * → bn) over the fake tables.
 */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v && !v.in.includes(row[k])) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where, take }: any = {}) => {
      const f = rows.filter((r) => matches(r, where));
      return take ? f.slice(0, take) : f;
    },
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (row) Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const r of rows) if (matches(r, where)) { Object.assign(r, data); count++; }
      return { count };
    },
  };
}

const TEMPLATES: Record<string, any> = {
  "tpl-plain": { id: "tpl-plain", channel: "email", subject: "Authored S", body: "Authored body", htmlBody: "<p>Authored</p>", variants: null },
  "tpl-var": {
    id: "tpl-var", channel: "email", subject: "Authored S", body: "Authored body", htmlBody: "<p>Authored</p>",
    variants: {
      en: { subject: "EN subject", body: "EN body", htmlBody: "<p>EN</p>" },
      bn: { body: "বাংলা বডি" },
    },
  },
  "tpl-coupon": {
    id: "tpl-coupon", channel: "sms", subject: null, body: "Authored coupon body", htmlBody: null,
    variants: { en: { body: "EN coupon body" } },
  },
};

function build(opts: { languagePref?: string; dashboardLocale?: string } = {}) {
  const tables: Record<string, any> = {};
  for (const n of ["workflow", "workflowRun", "order", "customer", "lead", "channelConversation", "customerMemory", "organization", "membership"]) {
    tables[n] = makeTable(n);
  }
  tables.customer.rows.push({ id: "c1", organizationId: "org", firstName: "Ayesha", lastName: null, email: "ayesha@example.com", phone: "01712345678" });
  tables.organization.rows.push({ id: "org", name: "Org", dashboardLocale: opts.dashboardLocale ?? "bn" });
  tables.channelConversation.rows.push({
    id: "conv-1", organizationId: "org", customerId: "c1", channel: "messenger", externalContactId: "ext-1", isPractice: false,
  });
  if (opts.languagePref) {
    tables.customerMemory.rows.push({
      id: "mem-1", organizationId: "org", customerKey: "messenger:ext-1", languagePref: opts.languagePref,
    });
  }
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
  const abandoned: any = {
    issueRecoveryCoupon: async () => ({ code: "SAVE10", kind: "percent", value: 10, expiryHours: 24 }),
  };
  const svc = new WorkflowsService(
    tables as any,
    { log: async () => undefined } as any,
    { on: () => undefined, emit: () => undefined } as any,
    messaging,
    undefined, // inbox
    undefined, // llmFactory
    abandoned, // abandonedCheckouts (LAST positional, AX18 precedent)
  );
  return { tables, svc, sends };
}

async function runSend(b: ReturnType<typeof build>, templateId: string, context: any = { customerId: "c1" }) {
  const workflow = await b.svc.create("org", "u1", {
    name: "Flow", trigger: "order_created",
    steps: [{ type: "send_email", templateId }],
  } as any);
  const run: any = await b.svc.runWorkflow(workflow, context);
  const row = b.tables.workflowRun.rows.find((r: any) => r.id === run.id);
  expect(row.status).toBe("completed");
  expect(b.sends).toHaveLength(1);
  return b.sends[0];
}

describe("MB5 workflow variant-if-exists (send_email)", () => {
  it("en recipient (languagePref=en): en variant subject/body/htmlBody replace the authored fields", async () => {
    const b = build({ languagePref: "en" });
    const sent = await runSend(b, "tpl-var");
    expect(sent.subject).toBe("EN subject");
    expect(sent.body).toBe("EN body");
    expect(sent.htmlBody).toBe("<p>EN</p>");
  });

  it("bn recipient: bn variant body replaces; subject/htmlBody (no bn variant) stay authored", async () => {
    const b = build({ languagePref: "bn" });
    const sent = await runSend(b, "tpl-var");
    expect(sent.subject).toBe("Authored S");
    expect(sent.body).toBe("বাংলা বডি");
    expect(sent.htmlBody).toBe("<p>Authored</p>");
  });

  it("no languagePref: falls to the ORG default locale (dashboardLocale=en → en variant)", async () => {
    const b = build({ dashboardLocale: "en" });
    const sent = await runSend(b, "tpl-var");
    expect(sent.body).toBe("EN body");
  });

  it("languagePref=mixed resolves to bn (D-MB4-7) → bn variant", async () => {
    const b = build({ languagePref: "mixed" });
    const sent = await runSend(b, "tpl-var");
    expect(sent.body).toBe("বাংলা বডি");
  });

  it("a template WITHOUT variants sends authored fields verbatim in every locale", async () => {
    const b = build({ languagePref: "en" });
    const sent = await runSend(b, "tpl-plain");
    expect(sent.subject).toBe("Authored S");
    expect(sent.body).toBe("Authored body");
    expect(sent.htmlBody).toBe("<p>Authored</p>");
  });
});

describe("MB5 workflow variant-if-exists (issue_recovery_coupon)", () => {
  it("the coupon step renders the template body — so the en variant body carries the coupon lines for an en recipient", async () => {
    const b = build({ languagePref: "en" });
    const workflow = await b.svc.create("org", "u1", {
      name: "Recovery", trigger: "cart_abandoned",
      steps: [{ type: "issue_recovery_coupon", templateId: "tpl-coupon" }],
    } as any);
    const run: any = await b.svc.runWorkflow(workflow, { customerId: "c1" });
    const row = b.tables.workflowRun.rows.find((r: any) => r.id === run.id);
    expect(row.status).toBe("completed");
    expect(b.sends).toHaveLength(1);
    expect(b.sends[0].body).toContain("EN coupon body");
    expect(b.sends[0].body).toContain("SAVE10");
    expect(b.sends[0].body).not.toContain("Authored coupon body");
  });

  it("bn recipient of the same coupon step keeps the authored body (no bn variant authored)", async () => {
    const b = build({ languagePref: "bn" });
    const workflow = await b.svc.create("org", "u1", {
      name: "Recovery", trigger: "cart_abandoned",
      steps: [{ type: "issue_recovery_coupon", templateId: "tpl-coupon" }],
    } as any);
    const run: any = await b.svc.runWorkflow(workflow, { customerId: "c1" });
    const row = b.tables.workflowRun.rows.find((r: any) => r.id === run.id);
    expect(row.status).toBe("completed");
    expect(b.sends[0].body).toContain("Authored coupon body");
    expect(b.sends[0].body).toContain("SAVE10");
  });
});
