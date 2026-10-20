process.env.JWT_SECRET = "test-secret";
process.env.WEB_URL = "https://app.example.com";
process.env.API_PUBLIC_URL = "https://api.example.com";
process.env.DISABLE_SCHEDULER = "true";

import { MessagingService } from "./messaging.service";
import { WorkflowsService } from "../workflows/workflows.service";
import { EventsService } from "../common/events.service";
import { parseRecurrence, nextOccurrence, dhakaWeekday } from "./recurrence";
import { JOURNEY_PRESETS } from "./journey-presets";

/**
 * MS8 — automation bridge: recurrence math + validation
 * (pure), the finalize-chain through the REAL sweep / manual
 * send (exactly one pending instance per group; paused /
 * cancelled end the chain), and journey presets installed
 * through the REAL WorkflowsService.create + validator via the
 * registration port — including one full journey run whose
 * send step is skipped by MS2 suppression.
 * Fake-prisma style like the MS1–MS7 specs.
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
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const r of rows) if (matches(r, where ?? {})) { Object.assign(r, data); count++; }
      return { count };
    },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); if (i >= 0) rows.splice(i, 1); return {}; },
  };
}

const TABLE_NAMES = [
  "messageTemplate", "broadcast", "messageDelivery", "customer", "lead", "whatsAppTemplate",
  "messagePreference", "messagingSetting", "messagingSavedAudience", "messagingSenderConfig",
  "messageLinkClick", "product", "integration", "order", "channelConversation", "channelMessage",
  "workflow", "workflowRun", "agentNotification", "membership", "conversationNote", "leadActivity",
];
function build() {
  const tables: Record<string, any> = {};
  for (const n of TABLE_NAMES) tables[n] = makeTable(n);
  tables.systemSetting = { findUnique: async () => null };
  tables.organization = { findUnique: async () => ({ aiDailyLimitOverride: null, broadcastCapOverride: null, seatLimit: null }) };
  const auditCalls: any[] = [];
  const audit = { log: async (entry: any) => { auditCalls.push(entry); } } as any;
  const emailCalls: any[] = [];
  const email = { isConfigured: () => true, send: async (input: any) => { emailCalls.push(input); return { providerMessageId: `<id-${input.to}>` }; } } as any;
  const smsCalls: any[] = [];
  const sms = { isConfigured: () => true, send: async (input: any) => { smsCalls.push(input); return { providerMessageId: `sms-${input.to}` }; } } as any;
  const messaging = new MessagingService(tables as any, audit, email, sms);
  const events = new EventsService();
  const workflows = new WorkflowsService(tables as any, audit, events as any, messaging, undefined);
  return { tables, auditCalls, emailCalls, smsCalls, messaging, events, workflows };
}
async function flush() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
}
const DAY = 24 * 3600 * 1000;

describe("MS8 recurrence math + validation (pure)", () => {
  const wed = new Date("2026-10-14T04:00:00Z"); // Wednesday 10:00 in Dhaka
  it("knows the Dhaka weekday", () => {
    expect(dhakaWeekday(wed)).toBe(3);
    expect(dhakaWeekday(new Date("2026-10-13T19:30:00Z"))).toBe(3); // 01:30 Dhaka next day
  });
  it("daily / weekly stepping preserves the time of day", () => {
    expect(nextOccurrence({ freq: "daily", interval: 1 }, wed)?.getTime()).toBe(wed.getTime() + DAY);
    expect(nextOccurrence({ freq: "daily", interval: 3 }, wed)?.getTime()).toBe(wed.getTime() + 3 * DAY);
    expect(nextOccurrence({ freq: "weekly", interval: 2 }, wed)?.getTime()).toBe(wed.getTime() + 14 * DAY);
  });
  it("weekly with weekdays picks the first listed Dhaka weekday strictly after the anchor", () => {
    expect(nextOccurrence({ freq: "weekly", interval: 1, weekdays: [5] }, wed)?.toISOString()).toBe("2026-10-16T04:00:00.000Z"); // Friday
    expect(nextOccurrence({ freq: "weekly", interval: 1, weekdays: [3] }, wed)?.toISOString()).toBe("2026-10-21T04:00:00.000Z"); // next Wednesday
    expect(nextOccurrence({ freq: "weekly", interval: 1, weekdays: [1, 5] }, wed)?.toISOString()).toBe("2026-10-16T04:00:00.000Z"); // Friday before Monday
    expect(nextOccurrence({ freq: "weekly", interval: 2, weekdays: [5] }, wed)?.toISOString()).toBe("2026-10-16T04:00:00.000Z"); // anchor week is an occurrence week
  });
  it("endsAt bounds the chain; an occurrence exactly ON endsAt still fires", () => {
    expect(nextOccurrence({ freq: "daily", interval: 1, endsAt: "2026-10-15T04:00:00.000Z" }, wed)?.toISOString()).toBe("2026-10-15T04:00:00.000Z");
    expect(nextOccurrence({ freq: "daily", interval: 1, endsAt: "2026-10-15T03:59:00.000Z" }, wed)).toBeNull();
  });
  it("parseRecurrence rejects bad shapes and normalizes good ones", () => {
    expect(() => parseRecurrence({ freq: "monthly", interval: 1 })).toThrow();
    expect(() => parseRecurrence({ freq: "daily", interval: 0 })).toThrow();
    expect(() => parseRecurrence({ freq: "daily", interval: 1.5 })).toThrow();
    expect(() => parseRecurrence({ freq: "weekly", interval: 1, weekdays: [7] })).toThrow();
    expect(() => parseRecurrence({ freq: "daily", interval: 1, weekdays: [1] })).toThrow();
    expect(() => parseRecurrence({ freq: "daily", interval: 1, bogus: true })).toThrow();
    expect(() => parseRecurrence({ freq: "daily", interval: 1, endsAt: "not-a-date" })).toThrow();
    expect(parseRecurrence({ freq: "weekly", weekdays: [5, 1, 5] })).toEqual({ freq: "weekly", interval: 1, weekdays: [1, 5] });
  });
});

describe("MS8 recurrence chaining through the sweep", () => {
  function seedCustomer(tables: any) {
    tables.customer.rows.push({ id: "c1", organizationId: "org-1", firstName: "Ayesha", lastName: null, email: "ayesha@example.com", phone: "01712345678" });
  }
  async function recurringBroadcast(b: ReturnType<typeof build>, recurrence: any) {
    const future = new Date(Date.now() + 3600 * 1000).toISOString();
    const bc: any = await b.messaging.createBroadcast("org-1", "owner", {
      name: "Weekly Offer", channel: "sms", body: "অফার!", audienceType: "customers",
      scheduledAt: future, recurrence,
    });
    const row = b.tables.broadcast.rows.find((r: any) => r.id === bc.id);
    row.scheduledAt = new Date(Date.now() - 60 * 1000); // due now (fixture time travel)
    return row;
  }

  it("finalize creates exactly one next instance: recurrence moved, group kept, anchor = original scheduledAt", async () => {
    const b = build(); seedCustomer(b.tables);
    // The fixture compresses days into seconds, so the MS2
    // rolling-24h frequency cap (default 1/day) would honestly
    // exclude the only recipient from the second instance
    // (prepare refuses an empty audience and the sweep reports
    // it). Disable the cap through the REAL org setting for
    // this chain test; the cap itself is pinned by MS2 specs.
    await b.messaging.updateMessagingSetting("org-1", "owner", { frequencyCapPerDay: 0 });
    const row = await recurringBroadcast(b, { freq: "daily", interval: 1 });
    const anchor = row.scheduledAt.getTime();
    const groupId = row.recurrenceGroupId;
    expect(groupId).toBeTruthy();
    const sweep = await b.messaging.runDueBroadcasts("org-1");
    expect(sweep.started).toBe(1);
    expect(row.status).toBe("sent");
    expect(row.recurrence).toBeNull(); // moved off the finalized instance
    const next = b.tables.broadcast.rows.filter((r: any) => r.id !== row.id);
    expect(next).toHaveLength(1);
    expect(next[0].status).toBe("scheduled");
    expect(next[0].scheduledAt.getTime()).toBe(anchor + DAY); // from the ORIGINAL scheduledAt, not processing time
    expect(next[0].recurrence).toEqual({ freq: "daily", interval: 1 });
    expect(next[0].recurrenceGroupId).toBe(groupId);
    expect(next[0].name).toBe("Weekly Offer"); // no suffix
    expect(next[0].recipientSnapshot ?? null).toBeNull(); // fresh instance — audience re-resolves at its own prepare
    // A second sweep does nothing (the next instance is not due)
    await b.messaging.runDueBroadcasts("org-1");
    expect(b.tables.broadcast.rows).toHaveLength(2);
    // Time passes: the second instance finalizes and chains a third, same group
    const due2 = new Date(Date.now() - 1000);
    next[0].scheduledAt = due2;
    await b.messaging.runDueBroadcasts("org-1");
    const all = b.tables.broadcast.rows.filter((r: any) => r.recurrenceGroupId === groupId);
    expect(all).toHaveLength(3);
    expect(all.filter((r: any) => r.recurrence)).toHaveLength(1); // exactly one pending holder
    // The third anchors on the second instance's OWN scheduledAt.
    expect(all.find((r: any) => r.recurrence).scheduledAt.getTime()).toBe(due2.getTime() + DAY);
  });

  it("endsAt ends the chain: no next instance, recurrence cleared", async () => {
    const b = build(); seedCustomer(b.tables);
    const bc: any = await b.messaging.createBroadcast("org-1", "owner", {
      name: "Short Run", channel: "sms", body: "অফার!", audienceType: "customers",
      scheduledAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    });
    const row = b.tables.broadcast.rows.find((r: any) => r.id === bc.id);
    const dueAt = new Date(Date.now() - 60 * 1000);
    row.scheduledAt = dueAt;
    // recurrence attached directly: next occurrence (+1d) is past endsAt (+12h)
    row.recurrence = { freq: "daily", interval: 1, endsAt: new Date(dueAt.getTime() + 12 * 3600 * 1000).toISOString() };
    row.recurrenceGroupId = "grp-end";
    await b.messaging.runDueBroadcasts("org-1");
    expect(row.status).toBe("sent");
    expect(row.recurrence).toBeNull();
    expect(b.tables.broadcast.rows).toHaveLength(1);
  });

  it("a PAUSED or CANCELLED instance ends the chain (the sweep never finalizes it)", async () => {
    const b = build(); seedCustomer(b.tables);
    const paused = await recurringBroadcast(b, { freq: "daily", interval: 1 });
    await b.messaging.pauseBroadcast("org-1", "owner", paused.id);
    await b.messaging.runDueBroadcasts("org-1");
    expect(paused.status).toBe("paused");
    expect(b.tables.broadcast.rows).toHaveLength(1);

    const b2 = build(); seedCustomer(b2.tables);
    const cancelled = await recurringBroadcast(b2, { freq: "daily", interval: 1 });
    await b2.messaging.cancelBroadcast("org-1", "owner", cancelled.id);
    await b2.messaging.runDueBroadcasts("org-1");
    expect(cancelled.status).toBe("cancelled");
    expect(b2.tables.broadcast.rows).toHaveLength(1);
  });

  it("a manual one-off send of a draft anchors the chain on sentAt", async () => {
    const b = build(); seedCustomer(b.tables);
    const bc: any = await b.messaging.createBroadcast("org-1", "owner", {
      name: "Manual Weekly", channel: "sms", body: "অফার!", audienceType: "customers",
      recurrence: { freq: "weekly", interval: 1 },
    });
    expect(bc.status).toBe("draft");
    await b.messaging.sendBroadcast("org-1", "owner", bc.id);
    const row = b.tables.broadcast.rows.find((r: any) => r.id === bc.id);
    expect(row.status).toBe("sent");
    const next = b.tables.broadcast.rows.filter((r: any) => r.id !== bc.id);
    expect(next).toHaveLength(1);
    expect(next[0].scheduledAt.getTime() - new Date(row.sentAt).getTime()).toBe(7 * DAY);
  });

  it("create + schedule validate recurrence strictly; A/B variants share one group id", async () => {
    const b = build(); seedCustomer(b.tables);
    await expect(b.messaging.createBroadcast("org-1", "owner", {
      name: "Bad", channel: "sms", body: "x", audienceType: "customers", recurrence: { freq: "monthly", interval: 1 },
    })).rejects.toThrow(/freq/);
    const ab: any = await b.messaging.createBroadcast("org-1", "owner", {
      name: "AB", channel: "email", subject: "s", body: "A body", abBody: "B body", abTest: true,
      audienceType: "customers", recurrence: { freq: "weekly", interval: 1, weekdays: [6] },
    });
    expect(ab.variants[0].recurrenceGroupId).toBeTruthy();
    expect(ab.variants[0].recurrenceGroupId).toBe(ab.variants[1].recurrenceGroupId);
    expect(ab.variants[1].recurrence).toEqual({ freq: "weekly", interval: 1, weekdays: [6] });

    const draft: any = await b.messaging.createBroadcast("org-1", "owner", {
      name: "Sched", channel: "sms", body: "x", audienceType: "customers",
    });
    const future = new Date(Date.now() + 3600 * 1000).toISOString();
    const scheduled: any = await b.messaging.scheduleBroadcast("org-1", "owner", draft.id, future, { freq: "daily", interval: 2 });
    expect(scheduled.recurrence).toEqual({ freq: "daily", interval: 2 });
    expect(scheduled.recurrenceGroupId).toBeTruthy();
    const cleared: any = await b.messaging.scheduleBroadcast("org-1", "owner", draft.id, future, null);
    expect(cleared.recurrence).toBeNull();
    expect(cleared.recurrenceGroupId).toBeNull();
  });
});

describe("MS8 journey presets through the real WorkflowsService", () => {
  it("the catalogue holds the audited presets — winback_sweep was dropped (schedule context has no recipient); AX18 added cart_recovery_3step", () => {
    expect(JOURNEY_PRESETS.map((p) => p.key)).toEqual([
      "post_purchase_thanks", "post_purchase_thanks_sms", "delivered_review_ask", "cart_recovery", "lead_followup", "cart_recovery_3step",
    ]);
    const b = build();
    expect(b.messaging.listJourneyPresets().map((p: any) => p.key)).not.toContain("winback_sweep");
  });

  it("install refuses honestly when no workflow engine is registered", async () => {
    const b = build();
    await expect(b.messaging.installJourneyPreset("org-1", "owner", "cart_recovery")).rejects.toMatchObject({ code: "messaging.workflowEngineIsNotAvailableIn" });
    await expect(b.messaging.installJourneyPreset("org-1", "owner", "nope")).rejects.toMatchObject({ code: "messaging.journeyPresetNotFound" });
  });

  it("install creates a real template + a validator-checked workflow, then disables it; twice = two sets, no dedupe", async () => {
    const b = build();
    b.workflows.onModuleInit(); // registers the real engine into messaging
    const res: any = await b.messaging.installJourneyPreset("org-1", "owner", "post_purchase_thanks_sms");
    expect(res.enabled).toBe(false);
    const template = b.tables.messageTemplate.rows.find((t: any) => t.id === res.template.id);
    expect(template).toMatchObject({ name: "Journey: অর্ডারের ধন্যবাদ (SMS)", channel: "sms" });
    const workflow = b.tables.workflow.rows.find((w: any) => w.id === res.workflow.id);
    expect(workflow).toMatchObject({ trigger: "order_created", enabled: false });
    expect(workflow.steps).toEqual([
      { type: "wait", minutes: 30 },
      { type: "send_sms", templateId: template.id },
    ]);
    expect(b.auditCalls.some((c: any) => c.action === "messaging.journey_preset_install" && c.metadata.preset === "post_purchase_thanks_sms")).toBe(true);
    const res2: any = await b.messaging.installJourneyPreset("org-1", "owner", "post_purchase_thanks_sms");
    expect(res2.workflow.id).not.toBe(res.workflow.id);
    expect(b.tables.workflow.rows).toHaveLength(2);
    expect(b.tables.messageTemplate.rows).toHaveLength(2);
  });

  it("EVERY preset installs through the real validator (the audit proof)", async () => {
    const b = build();
    b.workflows.onModuleInit();
    for (const preset of JOURNEY_PRESETS) {
      const res: any = await b.messaging.installJourneyPreset("org-1", "owner", preset.key);
      expect(res.workflow.enabled).toBe(false);
      expect(res.workflow.trigger).toBe(preset.trigger);
      expect(res.template.channel).toBe(preset.channel);
    }
    expect(b.tables.workflow.rows).toHaveLength(6);
    expect(b.tables.messageTemplate.rows).toHaveLength(6);
  });

  it("end-to-end: an installed journey's send step is SKIPPED for an opted-out recipient (MS2 suppression via sendToRecipient)", async () => {
    const b = build();
    b.workflows.onModuleInit();
    const res: any = await b.messaging.installJourneyPreset("org-1", "owner", "post_purchase_thanks_sms");
    // A human reviews, then enables — the installPreset discipline.
    await b.workflows.update("org-1", res.workflow.id, { enabled: true }, "owner");
    b.tables.customer.rows.push({ id: "c1", organizationId: "org-1", firstName: "Ayesha", lastName: null, email: "ayesha@example.com", phone: "01712345678" });
    b.tables.order.rows.push({ id: "ord-1", organizationId: "org-1", customerId: "c1", externalNumber: "ORD-1001", totalMinor: 50000n, currency: "BDT", status: "processing", source: "manual" });
    await b.messaging.addPreference("org-1", "owner", { channel: "sms", address: "01712345678", status: "opted_out" });
    b.events.emit("order.created", { organizationId: "org-1", context: { orderId: "ord-1" } });
    await flush();
    const run = b.tables.workflowRun.rows.find((r: any) => r.workflowId === res.workflow.id);
    expect(run).toBeTruthy();
    expect(run.status).toBe("waiting"); // parked on the wait step
    run.resumeAt = new Date(Date.now() - 1000); // the wait elapses (fixture time travel)
    await b.workflows.resumeRuns();
    expect(run.status).toBe("completed"); // a skip completes the run — it is not a failure
    expect(run.stepsLog.some((l: any) => l.status === "skipped")).toBe(true);
    const deliveries = b.tables.messageDelivery.rows.filter((d: any) => d.workflowRunId === run.id);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe("skipped");
    expect(deliveries[0].error).toContain("opted out");
    expect(b.smsCalls).toHaveLength(0); // the provider was never called
  });
});
