import { MessagingService } from "./messaging.service";
import { issueUnsubscribeToken } from "./unsubscribe-token";
import { WorkflowsService } from "../workflows/workflows.service";

/**
 * MS2 — consent, opt-out & suppression: resolver enforcement
 * (channel-scoped suppression, rolling-24h frequency cap,
 * WhatsApp opt-in), the sendToRecipient skipped path (broadcasts
 * AND workflows), the signed unsubscribe flow, the broadcast-only
 * email footer, inbound STOP/START keywords, settings validation
 * and preference import. Fake-prisma style like the MS1 spec.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("not" in v) { const ok = v.not === null ? row[k] !== null && row[k] !== undefined : row[k] !== v.not; if (!ok) return false; }
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("lte" in v && !(new Date(row[k]).getTime() <= new Date(v.lte).getTime())) return false;
      if ("lt" in v && !(new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      if ("gte" in v && !(new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
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
      const out = rows.filter((r) => matches(r, where ?? {}));
      return take ? out.slice(0, take) : out;
    },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) { Object.assign(row, data); row.updatedAt = new Date(); } return row; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); if (i >= 0) rows.splice(i, 1); return {}; },
  };
}

const CUSTOMERS = [1, 2, 3, 4].map((n) => ({
  id: `c${n}`, organizationId: "org-1", firstName: `User${n}`, lastName: null,
  email: `user${n}@example.com`, phone: `0171234567${n}`,
}));

function build() {
  const tables: any = {
    messageTemplate: makeTable("tpl"), broadcast: makeTable("bc"), messageDelivery: makeTable("dlv"),
    customer: makeTable("cust"), lead: makeTable("lead"), whatsAppTemplate: makeTable("wa"),
    messagePreference: makeTable("pref"), messagingSetting: makeTable("mset"),
    workflowRun: makeTable("wrun"),
  };
  for (const c of CUSTOMERS) tables.customer.rows.push({ ...c });
  tables.systemSetting = { findUnique: async () => null };
  tables.organization = { findUnique: async () => ({ aiDailyLimitOverride: null, broadcastCapOverride: null, seatLimit: null }) };
  const calls: { to: string; subject: string; text: string }[] = [];
  const email = {
    isConfigured: () => true,
    send: async ({ to, subject, text }: any) => { calls.push({ to, subject, text }); return { providerMessageId: `<id-${to}>` }; },
  } as any;
  const smsCalls: { to: string; text: string }[] = [];
  const sms = {
    isConfigured: () => true,
    send: async ({ to, text }: any) => { smsCalls.push({ to, text }); return { providerMessageId: `sms-${to}` }; },
  } as any;
  const svc = new MessagingService(tables as any, { log: async () => undefined } as any, email, sms);
  return { svc, tables, calls, smsCalls };
}

describe("MS2 resolver suppression", () => {
  it("drops an opted_out recipient on the matching channel only — an email opt-out never blocks SMS", async () => {
    const { svc } = build();
    await svc.setPreference("org-1", { channel: "email", address: "User1@Example.com", status: "opted_out", source: "manual" });
    await svc.setPreference("org-1", { channel: "sms", address: "01712345672", status: "opted_out", source: "manual" });

    const emailPreview = await svc.previewBroadcast("org-1", { channel: "email", audienceType: "customers" });
    expect(emailPreview.excludedSuppressedCount).toBe(1);
    expect(emailPreview.total).toBe(3);
    expect(emailPreview.sample.map((s: any) => s.name)).not.toContain("User1");

    const smsPreview = await svc.previewBroadcast("org-1", { channel: "sms", audienceType: "customers" });
    expect(smsPreview.excludedSuppressedCount).toBe(1); // user2, via SMS — user1's email opt-out does not leak over
    expect(smsPreview.total).toBe(3);
    expect(smsPreview.sample.map((s: any) => s.name)).toContain("User1");
    expect(smsPreview.sample.map((s: any) => s.name)).not.toContain("User2");
  });

  it("an opted_in row does not suppress; flipping the same row back and forth keeps one row", async () => {
    const { svc, tables } = build();
    await svc.setPreference("org-1", { channel: "email", address: "user1@example.com", status: "opted_out", source: "manual" });
    await svc.setPreference("org-1", { channel: "email", address: "user1@example.com", status: "opted_in", source: "manual" });
    expect(tables.messagePreference.rows).toHaveLength(1);
    expect(tables.messagePreference.rows[0].status).toBe("opted_in");
    const preview = await svc.previewBroadcast("org-1", { channel: "email", audienceType: "customers" });
    expect(preview.excludedSuppressedCount).toBe(0);
    expect(preview.total).toBe(4);
  });
});

describe("MS2 frequency cap", () => {
  it("counts only confirmed BROADCAST deliveries inside the rolling 24h", async () => {
    const { svc, tables } = build();
    const now = new Date();
    const hour = 3600_000;
    // c1: confirmed broadcast delivery 1h ago → capped (default cap 1)
    tables.messageDelivery.rows.push({ id: "d1", organizationId: "org-1", broadcastId: "old-1", workflowRunId: null, channel: "email", recipientType: "customer", recipientId: "c1", address: "user1@example.com", status: "sent", createdAt: new Date(now.getTime() - hour) });
    // c2: confirmed broadcast delivery 25h ago → outside the window, kept
    tables.messageDelivery.rows.push({ id: "d2", organizationId: "org-1", broadcastId: "old-1", workflowRunId: null, channel: "email", recipientType: "customer", recipientId: "c2", address: "user2@example.com", status: "sent", createdAt: new Date(now.getTime() - 25 * hour) });
    // c3: a WORKFLOW delivery 1h ago → never counts for the broadcast cap
    tables.messageDelivery.rows.push({ id: "d3", organizationId: "org-1", broadcastId: null, workflowRunId: "run-1", channel: "email", recipientType: "customer", recipientId: "c3", address: "user3@example.com", status: "sent", createdAt: new Date(now.getTime() - hour) });
    // c4: a FAILED broadcast delivery 1h ago → never received it, kept
    tables.messageDelivery.rows.push({ id: "d4", organizationId: "org-1", broadcastId: "old-1", workflowRunId: null, channel: "email", recipientType: "customer", recipientId: "c4", address: "user4@example.com", status: "failed", createdAt: new Date(now.getTime() - hour) });

    const preview = await svc.previewBroadcast("org-1", { channel: "email", audienceType: "customers" });
    expect(preview.excludedFrequencyCount).toBe(1);
    expect(preview.sample.map((s: any) => s.name).sort()).toEqual(["User2", "User3", "User4"]);
  });

  it("cap 0 turns the frequency rule off entirely", async () => {
    const { svc, tables } = build();
    tables.messageDelivery.rows.push({ id: "d1", organizationId: "org-1", broadcastId: "old-1", workflowRunId: null, channel: "email", recipientType: "customer", recipientId: "c1", address: "user1@example.com", status: "sent", createdAt: new Date() });
    await svc.updateMessagingSetting("org-1", "owner", { frequencyCapPerDay: 0 });
    const preview = await svc.previewBroadcast("org-1", { channel: "email", audienceType: "customers" });
    expect(preview.excludedFrequencyCount).toBe(0);
    expect(preview.total).toBe(4);
  });
});

describe("MS2 WhatsApp opt-in required", () => {
  it("keeps ONLY opted_in recipients when the setting is on", async () => {
    const { svc } = build();
    await svc.updateMessagingSetting("org-1", "owner", { whatsappOptInRequired: true });
    await svc.setPreference("org-1", { channel: "whatsapp", address: "01712345671", status: "opted_in", source: "inbound_keyword" });
    const preview = await svc.previewBroadcast("org-1", { channel: "whatsapp", audienceType: "customers" });
    expect(preview.excludedNoOptInCount).toBe(3);
    expect(preview.total).toBe(1);
    expect(preview.sample[0].name).toBe("User1");
  });

  it("with the setting off (default), no opt-in filtering happens", async () => {
    const { svc } = build();
    const preview = await svc.previewBroadcast("org-1", { channel: "whatsapp", audienceType: "customers" });
    expect(preview.excludedNoOptInCount).toBe(0);
    expect(preview.total).toBe(4);
  });
});

describe("MS2 preview == send set", () => {
  it("the prepared snapshot is exactly the set the preview counted", async () => {
    const { svc, tables } = build();
    await svc.setPreference("org-1", { channel: "email", address: "user2@example.com", status: "opted_out", source: "manual" });
    tables.messageDelivery.rows.push({ id: "d1", organizationId: "org-1", broadcastId: "old-1", workflowRunId: null, channel: "email", recipientType: "customer", recipientId: "c1", address: "user1@example.com", status: "sent", createdAt: new Date() });

    const preview = await svc.previewBroadcast("org-1", { channel: "email", audienceType: "customers", excludePreviousRecipients: true });
    expect(preview.excludedPreviousCount).toBe(1);
    expect(preview.excludedSuppressedCount).toBe(1);
    expect(preview.excludedFrequencyCount).toBe(0); // c1 already left via the previous-recipient stage
    expect(preview.total).toBe(2);

    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "Mix", channel: "email", subject: "s", body: "b", audienceType: "customers", excludePreviousRecipients: true,
    });
    const prepared: any = await svc.prepareBroadcast("org-1", bc.id);
    expect(prepared.recipientSnapshot.map((e: any) => e.id).sort()).toEqual(["c3", "c4"]);
    expect(prepared.recipientSnapshot).toHaveLength(preview.total);
  });
});

describe("MS2 sendToRecipient skipped path", () => {
  it("records a skipped delivery and NEVER calls the provider — for broadcasts and workflows alike", async () => {
    const { svc, tables, calls } = build();
    await svc.setPreference("org-1", { channel: "email", address: "user1@example.com", status: "opted_out", source: "unsubscribe_link" });
    const recipient = { type: "customer" as const, id: "c1", name: "User1", email: "user1@example.com", phone: "01712345671" };

    const viaBroadcast = await svc.sendToRecipient("org-1", { channel: "email", recipient, subject: "s", body: "b", vars: {}, broadcastId: "bc-1" });
    expect(viaBroadcast.status).toBe("skipped");
    expect(viaBroadcast.error).toContain("opted out (unsubscribe_link)");

    const viaWorkflow = await svc.sendToRecipient("org-1", { channel: "email", recipient, subject: "s", body: "b", vars: {}, workflowRunId: "run-1" });
    expect(viaWorkflow.status).toBe("skipped");

    expect(calls).toHaveLength(0);
    const deliveries = tables.messageDelivery.rows;
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((d: any) => d.status === "skipped")).toBe(true);
  });

  it("a workflow run logs the step as skipped (not ok, not failed) and the run still completes", async () => {
    const { svc, tables } = build();
    const tpl = await svc.createTemplate("org-1", "owner", { name: "T", channel: "email", subject: "Hi", body: "Hello" });
    await svc.setPreference("org-1", { channel: "email", address: "user1@example.com", status: "opted_out", source: "manual" });
    const workflows = new WorkflowsService(
      tables as any, { log: async () => undefined } as any, { on: () => undefined, emit: () => undefined } as any, svc,
    );
    const workflow = {
      id: "wf-1", organizationId: "org-1", trigger: "order_created", conditions: null,
      steps: [{ type: "send_email", templateId: tpl.id }], enabled: true, createdById: "owner",
    };
    const run: any = await workflows.runWorkflow(workflow, { customerId: "c1" }, { governance: false });
    const finalRun = tables.workflowRun.rows.find((r: any) => r.id === run.id);
    expect(finalRun.status).toBe("completed");
    expect(finalRun.stepsLog).toHaveLength(1);
    expect(finalRun.stepsLog[0]).toMatchObject({ step: "send_email", status: "skipped" });
    expect(finalRun.stepsLog[0].detail).toContain("opted out");
  });

  it("a fully-suppressed snapshot finalizes as failed with every entry skipped (nothing reached anyone)", async () => {
    const { svc, tables, calls } = build();
    const bc = await svc.createBroadcast("org-1", "owner", { name: "All out", channel: "email", subject: "s", body: "b", audienceType: "customers" });
    await svc.prepareBroadcast("org-1", bc.id);
    for (const c of CUSTOMERS) {
      await svc.setPreference("org-1", { channel: "email", address: c.email, status: "opted_out", source: "import" });
    }
    const sent: any = await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(sent.status).toBe("failed");
    expect(sent.progress).toMatchObject({ total: 4, sent: 0, failed: 0, skipped: 4 });
    expect(calls).toHaveLength(0);
    expect(tables.messageDelivery.rows.filter((d: any) => d.status === "skipped")).toHaveLength(4);
  });
});

describe("MS2 unsubscribe token + footer", () => {
  const OLD_ENV = { ...process.env };
  beforeEach(() => { process.env.JWT_SECRET = "test-secret"; process.env.WEB_URL = "https://app.example.com"; });
  afterEach(() => { process.env = { ...OLD_ENV }; });

  it("token round-trip: perform writes an opted_out preference; inspect shows only a masked address", async () => {
    const { svc, tables } = build();
    const token = issueUnsubscribeToken({ orgId: "org-1", channel: "email", address: "user1@example.com" });
    const inspected = svc.inspectUnsubscribeToken(token);
    expect(inspected).toMatchObject({ valid: true, channel: "email", address: "u***@example.com" });
    const done = await svc.performUnsubscribe(token);
    expect(done.ok).toBe(true);
    expect(tables.messagePreference.rows).toHaveLength(1);
    expect(tables.messagePreference.rows[0]).toMatchObject({ channel: "email", address: "user1@example.com", status: "opted_out", source: "unsubscribe_link" });
  });

  it("a tampered token writes nothing and errors honestly", async () => {
    const { svc, tables } = build();
    const token = issueUnsubscribeToken({ orgId: "org-1", channel: "email", address: "user1@example.com" });
    const tampered = token.slice(0, -2) + (token.endsWith("aa") ? "bb" : "aa");
    await expect(svc.performUnsubscribe(tampered)).rejects.toThrow(/অবৈধ বা মেয়াদোত্তীর্ণ/);
    expect(() => svc.inspectUnsubscribeToken(tampered)).toThrow(/অবৈধ বা মেয়াদোত্তীর্ণ/);
    expect(tables.messagePreference.rows).toHaveLength(0);
  });

  it("the footer rides in BROADCAST email bodies only — workflow mail has none", async () => {
    const { svc, calls } = build();
    const bc = await svc.createBroadcast("org-1", "owner", { name: "Foot", channel: "email", subject: "s", body: "Hello {{name}}", audienceType: "customers" });
    await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(calls.length).toBe(4);
    expect(calls[0].text).toContain("https://app.example.com/unsubscribe/");
    expect(calls[0].text).toContain("আনসাবস্ক্রাইব করুন");

    calls.length = 0;
    const recipient = { type: "customer" as const, id: "c1", name: "User1", email: "user1@example.com", phone: null };
    await svc.sendToRecipient("org-1", { channel: "email", recipient, subject: "s", body: "Hello", vars: {}, workflowRunId: "run-9" });
    expect(calls).toHaveLength(1);
    expect(calls[0].text).not.toContain("/unsubscribe/");
  });
});

describe("MS2 inbound keywords (WhatsApp only)", () => {
  it("STOP flips the sender to opted_out, START flips the SAME row back", async () => {
    const { svc, tables } = build();
    const stop = await svc.handleInboundKeyword("org-1", "whatsapp", "8801712345671", "  stop ");
    expect(stop).toEqual({ matched: true, action: "opted_out" });
    expect(tables.messagePreference.rows).toHaveLength(1);
    expect(tables.messagePreference.rows[0]).toMatchObject({ channel: "whatsapp", address: "8801712345671", status: "opted_out", source: "inbound_keyword" });

    const start = await svc.handleInboundKeyword("org-1", "whatsapp", "8801712345671", "START");
    expect(start).toEqual({ matched: true, action: "opted_in" });
    expect(tables.messagePreference.rows).toHaveLength(1);
    expect(tables.messagePreference.rows[0].status).toBe("opted_in");
  });

  it("Bengali keywords match; ordinary text and other channels do not", async () => {
    const { svc, tables } = build();
    expect(await svc.handleInboundKeyword("org-1", "whatsapp", "8801712345671", "বন্ধ করুন")).toEqual({ matched: true, action: "opted_out" });
    expect(await svc.handleInboundKeyword("org-1", "whatsapp", "8801712345671", "দাম কত?")).toEqual({ matched: false });
    expect(await svc.handleInboundKeyword("org-1", "messenger", "psid-123", "STOP")).toEqual({ matched: false });
    expect(tables.messagePreference.rows).toHaveLength(1);
  });
});

describe("MS2 settings + import", () => {
  it("settings validation rejects a bad cap and accepts the boundaries", async () => {
    const { svc } = build();
    await expect(svc.updateMessagingSetting("org-1", "owner", { frequencyCapPerDay: 21 })).rejects.toThrow(/between 0 and 20/);
    await expect(svc.updateMessagingSetting("org-1", "owner", { frequencyCapPerDay: 2.5 })).rejects.toThrow(/between 0 and 20/);
    await expect(svc.updateMessagingSetting("org-1", "owner", { whatsappOptInRequired: "yes" as any })).rejects.toThrow(/boolean/);
    const at20 = await svc.updateMessagingSetting("org-1", "owner", { frequencyCapPerDay: 20 });
    expect(at20.frequencyCapPerDay).toBe(20);
    const stored = await svc.getMessagingSetting("org-1");
    expect(stored.frequencyCapPerDay).toBe(20);
  });

  it("defaults read as cap 1 / opt-in off when no setting row exists", async () => {
    const { svc } = build();
    // MS5 fixture update: getMessagingSetting now also returns
    // linkTrackingEnabled (default true) — the shape genuinely
    // grew, so this exact-equal expectation grows with it.
    expect(await svc.getMessagingSetting("org-1")).toEqual({ frequencyCapPerDay: 1, whatsappOptInRequired: false, linkTrackingEnabled: true });
  });

  it("import reports per-row errors and never fails silently", async () => {
    const { svc, tables } = build();
    const out = await svc.importPreferences("org-1", "owner", {
      channel: "email",
      addresses: ["one@example.com", "not-an-email", "two@example.com"],
    });
    expect(out.imported).toBe(2);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].address).toBe("not-an-email");
    expect(tables.messagePreference.rows).toHaveLength(2);
    expect(tables.messagePreference.rows.every((r: any) => r.source === "import" && r.status === "opted_out")).toBe(true);
    await expect(svc.importPreferences("org-1", "owner", { channel: "email", addresses: Array(1001).fill("a@b.com") })).rejects.toThrow(/capped at 1000/);
  });
});
