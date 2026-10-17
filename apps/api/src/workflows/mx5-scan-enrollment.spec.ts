process.env.JWT_SECRET = "test-secret";
process.env.WEB_URL = "https://app.example.com";
process.env.API_PUBLIC_URL = "https://api.example.com";
process.env.DISABLE_SCHEDULER = "true";

import { MessagingService } from "../messaging/messaging.service";
import { WorkflowsService } from "./workflows.service";
import { EventsService } from "../common/events.service";
import { deriveBrowseAbandoned } from "../tracking/abandoned-carts";

/**
 * MX5 — scan enrollment (winback_due / anniversary_due /
 * browse_abandoned) through the REAL WorkflowsService +
 * MessagingService against fake-prisma tables (ms8-bridge
 * style). The fixed `now` makes the Asia/Dhaka month/day and
 * inactivity math deterministic.
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
  "trackingEvent", "visitor",
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

const DAY = 24 * 3600 * 1000;
// 2026-10-16 10:00 in Asia/Dhaka.
const NOW = new Date("2026-10-16T04:00:00Z");

function seedEmailTemplate(tables: any, id = "tpl-wb") {
  tables.messageTemplate.rows.push({
    id, organizationId: "org-1", name: "Win-back (ইমেইল)", channel: "email",
    subject: "মিস করছি, {{name}}", body: "আসসালামু আলাইকুম {{name}}, {{inactiveDays}} দিন হলো আপনার অর্ডার পাইনি।",
  });
}
function seedCustomer(tables: any, id: string, createdDaysAgo: number, extra: any = {}) {
  tables.customer.rows.push({
    id, organizationId: "org-1", firstName: `Cust${id}`, lastName: null,
    email: `${id}@example.com`, phone: "01712345678",
    createdAt: new Date(NOW.getTime() - createdDaysAgo * DAY), tags: [], ...extra,
  });
}
function seedOrder(tables: any, id: string, customerId: string, daysAgo: number) {
  tables.order.rows.push({
    id, organizationId: "org-1", customerId, externalId: id, externalNumber: id,
    totalMinor: 10000n, currency: "BDT", status: "completed", source: "manual",
    createdAt: new Date(NOW.getTime() - daysAgo * DAY),
  });
}
function seedWinbackWorkflow(tables: any, extra: any = {}) {
  tables.workflow.rows.push({
    id: "wf-winback", organizationId: "org-1", name: "Win-back", trigger: "winback_due",
    conditions: [{ field: "inactiveDays", op: "gte", value: 60 }],
    steps: [{ type: "send_email", templateId: "tpl-wb" }],
    enabled: true, journey: { origin: "messaging", preset: "win_back", exitOnPurchase: true },
    createdById: "owner", ...extra,
  });
}

describe("MX5 scan enrollment — winback_due", () => {
  it("enrolls only customers whose LATEST order is >= threshold, sends via the bare {customerId} context, and dedupes for 90 days", async () => {
    const b = build();
    seedEmailTemplate(b.tables);
    seedWinbackWorkflow(b.tables);
    // Inactive 90 days: qualifies. Inactive 10 days: no. No orders: no.
    seedCustomer(b.tables, "c-old", 400); seedOrder(b.tables, "o-old", "c-old", 90);
    seedCustomer(b.tables, "c-recent", 400); seedOrder(b.tables, "o-recent", "c-recent", 10);
    seedCustomer(b.tables, "c-none", 400);
    // An OLD order must not qualify a customer who also ordered recently.
    seedCustomer(b.tables, "c-mixed", 400); seedOrder(b.tables, "o-mixed-old", "c-mixed", 120); seedOrder(b.tables, "o-mixed-new", "c-mixed", 5);

    const fired = await b.workflows.scanJourneyEnrollment(NOW);
    expect(fired).toBe(1);
    const runs = b.tables.workflowRun.rows.filter((r: any) => r.workflowId === "wf-winback");
    expect(runs).toHaveLength(1);
    expect(runs[0].context.customerId).toBe("c-old");
    expect(runs[0].context.inactiveDays).toBe(90);
    // End-to-end recipient resolution: the run COMPLETED and an
    // email actually went to the resolved customer — never a
    // silent dead run.
    expect(runs[0].status).toBe("completed");
    expect(b.emailCalls).toHaveLength(1);
    expect(b.emailCalls[0].to).toBe("c-old@example.com");
    expect(b.emailCalls[0].text).toContain("90 দিন");
    const deliveries = b.tables.messageDelivery.rows.filter((d: any) => d.workflowRunId === runs[0].id);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe("sent");
    expect(deliveries[0].stepRef).toBe("0");

    // Dedupe: a second scan inside the 90-day window enrolls nobody new.
    const fired2 = await b.workflows.scanJourneyEnrollment(NOW);
    expect(fired2).toBe(0);
    expect(b.tables.workflowRun.rows.filter((r: any) => r.workflowId === "wf-winback")).toHaveLength(1);
  });

  it("respects a custom threshold from the workflow conditions (clamped) and never enrolls for a DISABLED workflow", async () => {
    const b = build();
    seedEmailTemplate(b.tables);
    seedWinbackWorkflow(b.tables, { conditions: [{ field: "inactiveDays", op: "gte", value: 30 }] });
    seedCustomer(b.tables, "c-45", 400); seedOrder(b.tables, "o-45", "c-45", 45);
    expect(await b.workflows.scanJourneyEnrollment(NOW)).toBe(1);

    const b2 = build();
    seedEmailTemplate(b2.tables);
    seedWinbackWorkflow(b2.tables, { enabled: false });
    seedCustomer(b2.tables, "c-old", 400); seedOrder(b2.tables, "o-old", "c-old", 90);
    expect(await b2.workflows.scanJourneyEnrollment(NOW)).toBe(0);
    expect(b2.tables.workflowRun.rows).toHaveLength(0);
    expect(b2.emailCalls).toHaveLength(0);
  });

  it("caps enrollments at 50 per workflow per scan", async () => {
    const b = build();
    seedEmailTemplate(b.tables);
    seedWinbackWorkflow(b.tables);
    for (let i = 0; i < 55; i++) {
      seedCustomer(b.tables, `cap-${i}`, 400);
      seedOrder(b.tables, `o-cap-${i}`, `cap-${i}`, 90);
    }
    const fired = await b.workflows.scanJourneyEnrollment(NOW);
    expect(fired).toBe(50);
    expect(b.tables.workflowRun.rows.filter((r: any) => r.workflowId === "wf-winback")).toHaveLength(50);
  });
});

describe("MX5 scan enrollment — anniversary_due", () => {
  function seedAnniversaryWorkflow(tables: any, extra: any = {}) {
    tables.workflow.rows.push({
      id: "wf-anniv", organizationId: "org-1", name: "Anniversary", trigger: "anniversary_due",
      steps: [{ type: "send_email", templateId: "tpl-wb" }],
      enabled: true, journey: { origin: "messaging", preset: "anniversary", exitOnPurchase: false },
      createdById: "owner", ...extra,
    });
  }

  it("enrolls only month/day matches (Asia/Dhaka) that are at least 300 days old; dedupes for 300 days", async () => {
    const b = build();
    seedEmailTemplate(b.tables);
    seedAnniversaryWorkflow(b.tables);
    // Created 2023-10-16 04:00Z = Oct 16 in Dhaka, ~3 years old: match.
    b.tables.customer.rows.push({
      id: "c-anniv", organizationId: "org-1", firstName: "Old", lastName: null,
      email: "c-anniv@example.com", phone: "01712345678", tags: [],
      createdAt: new Date("2023-10-16T04:00:00Z"),
    });
    // Same month/day TODAY (age 0 < 300 days): no.
    b.tables.customer.rows.push({
      id: "c-new", organizationId: "org-1", firstName: "New", lastName: null,
      email: "c-new@example.com", phone: "01712345678", tags: [],
      createdAt: new Date("2026-10-16T00:00:00Z"),
    });
    // Old enough but a different month/day: no.
    b.tables.customer.rows.push({
      id: "c-other", organizationId: "org-1", firstName: "Other", lastName: null,
      email: "c-other@example.com", phone: "01712345678", tags: [],
      createdAt: new Date("2023-10-15T04:00:00Z"),
    });

    const fired = await b.workflows.scanJourneyEnrollment(NOW);
    expect(fired).toBe(1);
    const runs = b.tables.workflowRun.rows.filter((r: any) => r.workflowId === "wf-anniv");
    expect(runs).toHaveLength(1);
    expect(runs[0].context.customerId).toBe("c-anniv");
    expect(runs[0].status).toBe("completed");
    expect(b.emailCalls.map((c: any) => c.to)).toEqual(["c-anniv@example.com"]);

    // Dedupe window: an immediate rescan enrolls nobody.
    expect(await b.workflows.scanJourneyEnrollment(NOW)).toBe(0);
  });

  it("never enrolls for a disabled anniversary workflow", async () => {
    const b = build();
    seedEmailTemplate(b.tables);
    seedAnniversaryWorkflow(b.tables, { enabled: false });
    b.tables.customer.rows.push({
      id: "c-anniv", organizationId: "org-1", firstName: "Old", lastName: null,
      email: "c-anniv@example.com", phone: "01712345678", tags: [],
      createdAt: new Date("2023-10-16T04:00:00Z"),
    });
    expect(await b.workflows.scanJourneyEnrollment(NOW)).toBe(0);
    expect(b.tables.workflowRun.rows).toHaveLength(0);
  });
});

describe("MX5 browse_abandoned — derivation + scan", () => {
  const ev = (visitorId: string, type: string, daysAgo: number, properties?: any, sessionKey = `s-${visitorId}`) => ({
    organizationId: "org-1", visitorId, sessionKey, storeId: "store-1", type,
    properties, occurredAt: new Date(NOW.getTime() - daysAgo * DAY),
  });

  it("deriveBrowseAbandoned: viewed-only qualifies; carted / purchased / too-recent do not", () => {
    const rows = deriveBrowseAbandoned([
      ev("v-view", "product_view", 3, { productId: "p1", name: "শার্ট" }),
      ev("v-view", "product_view", 2, { productId: "p2", name: "প্যান্ট" }),
      ev("v-cart", "product_view", 3, { productId: "p1", name: "শার্ট" }),
      ev("v-cart", "add_to_cart", 2, { productId: "p1" }),
      ev("v-buy", "product_view", 3, { productId: "p1", name: "শার্ট" }),
      ev("v-buy", "purchase", 1),
      ev("v-fresh", "product_view", 0.5, { productId: "p1", name: "শার্ট" }),
    ], NOW);
    expect(rows.map((r) => r.visitorId)).toEqual(["v-view"]);
    expect(rows[0].items.map((i) => i.name)).toEqual(["শার্ট", "প্যান্ট"]);
  });

  it("scan enrolls an identified viewer end-to-end; an unidentified viewer is skipped (no dead run)", async () => {
    const b = build();
    b.tables.messageTemplate.rows.push({
      id: "tpl-browse", organizationId: "org-1", name: "Browse (ইমেইল)", channel: "email",
      subject: "দেখা পণ্য", body: "আসসালামু আলাইকুম {{name}}, আপনি দেখেছিলেন: {{itemsSummary}}",
    });
    b.tables.workflow.rows.push({
      id: "wf-browse", organizationId: "org-1", name: "Browse", trigger: "browse_abandoned",
      steps: [{ type: "send_email", templateId: "tpl-browse" }],
      enabled: true, journey: { origin: "messaging", preset: "browse_abandoned", exitOnPurchase: false },
      createdById: "owner",
    });
    b.tables.visitor.rows.push({ id: "v-view", organizationId: "org-1", anonymousId: "a1", email: "viewer@example.com", phone: null });
    b.tables.visitor.rows.push({ id: "v-anon", organizationId: "org-1", anonymousId: "a2", email: null, phone: null });
    b.tables.trackingEvent.rows.push(
      ev("v-view", "product_view", 2, { productId: "p1", name: "শার্ট" }),
      ev("v-anon", "product_view", 2, { productId: "p1", name: "শার্ট" }),
    );
    const fired = await b.workflows.scanBrowseAbandoned(NOW);
    expect(fired).toBe(1);
    const runs = b.tables.workflowRun.rows.filter((r: any) => r.workflowId === "wf-browse");
    expect(runs).toHaveLength(1);
    expect(runs[0].context.visitorId).toBe("v-view");
    expect(runs[0].status).toBe("completed");
    expect(b.emailCalls).toHaveLength(1);
    expect(b.emailCalls[0].to).toBe("viewer@example.com");
    expect(b.emailCalls[0].text).toContain("শার্ট");
    // 24h dedupe like carts.
    expect(await b.workflows.scanBrowseAbandoned(NOW)).toBe(0);
  });
});
