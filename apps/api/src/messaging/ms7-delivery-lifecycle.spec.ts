import { createHmac } from "crypto";

process.env.JWT_SECRET = "test-secret";
process.env.WEB_URL = "https://app.example.com";
process.env.API_PUBLIC_URL = "https://api.example.com";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { MessagingService } from "./messaging.service";
import { InboxService } from "../inbox/inbox.service";
import { parseMetaWebhook } from "../inbox/webhook.parser";
import { encryptJson } from "../integrations/crypto";
import { normalizeFailureReason, groupFailureReasons, abSuggestion, deliveryRecipientKey } from "./delivery-report";
import { issueOpenToken } from "./open-token";

/**
 * MS7 — delivery lifecycle: WhatsApp webhook statuses updating
 * broadcast deliveries monotonically through the REAL
 * handleWebhook path (ChannelMessage path first + unchanged),
 * the signed email open pixel (first hit only; bad token writes
 * nothing), the per-broadcast report (funnel arithmetic with
 * honest per-channel nulls, failure normalization, A/B
 * suggestion rules, labelled revenue + replies), deliveries
 * cursor pagination and the audited CSV export.
 * Fake-prisma style like the MS1–MS5 specs, with a richer
 * matcher (OR / gt / contains / multi-key orderBy).
 */
const cmp = (a: any, b: any) => {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  return av < bv ? -1 : av > bv ? 1 : 0;
};
function matches(row: any, where: any, tables: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (k === "OR") return (v as any[]).some((sub) => matches(row, sub, tables));
    if (k === "conversation") {
      const conv = tables.channelConversation.rows.find((c: any) => c.id === row.conversationId);
      return Boolean(conv) && matches(conv, v, tables);
    }
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
function makeTable(name: string, tables: any) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where ?? {}, tables)) ?? null,
    findUnique: async ({ where }: any) => rows.find((r) => matches(r, where ?? {}, tables)) ?? null,
    findMany: async ({ where, take, orderBy }: any = {}) => {
      const f = applyOrder(rows.filter((r) => matches(r, where ?? {}, tables)), orderBy);
      return take ? f.slice(0, take) : f;
    },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (row) { Object.assign(row, data); row.updatedAt = new Date(); }
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const r of rows) if (matches(r, where ?? {}, tables)) { Object.assign(r, data); count++; }
      return { count };
    },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); if (i >= 0) rows.splice(i, 1); return {}; },
  };
}

const TABLE_NAMES = [
  "messageTemplate", "broadcast", "messageDelivery", "customer", "lead", "whatsAppTemplate",
  "messagePreference", "messagingSetting", "messagingSavedAudience", "messagingSenderConfig",
  "messageLinkClick", "product", "integration", "order", "channelConversation", "channelMessage",
];
function build() {
  const tables: Record<string, any> = {};
  for (const n of TABLE_NAMES) tables[n] = makeTable(n, tables);
  tables.systemSetting = { findUnique: async () => null };
  tables.organization = { findUnique: async () => ({ aiDailyLimitOverride: null, broadcastCapOverride: null, seatLimit: null }) };
  const auditCalls: any[] = [];
  const audit = { log: async (entry: any) => { auditCalls.push(entry); } } as any;
  const emailCalls: any[] = [];
  const email = {
    isConfigured: () => true,
    send: async (input: any) => { emailCalls.push(input); return { providerMessageId: `<id-${input.to}>` }; },
  } as any;
  const smsCalls: any[] = [];
  const sms = {
    isConfigured: () => true,
    send: async (input: any) => { smsCalls.push(input); return { providerMessageId: `sms-${input.to}` }; },
  } as any;
  const svc = new MessagingService(tables as any, audit, email, sms);
  return { svc, tables, auditCalls, emailCalls, smsCalls };
}

function seedDelivery(tables: any, over: any) {
  const row = {
    id: `dlv-${tables.messageDelivery.rows.length + 1}`,
    organizationId: "org-1", broadcastId: "bc-1", workflowRunId: null, channel: "whatsapp",
    recipientType: "customer", recipientId: "c1", address: "8801712345678",
    status: "sent", providerMessageId: null, error: null,
    deliveryStatus: null, deliveredAt: null, readAt: null, openedAt: null,
    createdAt: new Date(), ...over,
  };
  tables.messageDelivery.rows.push(row);
  return row;
}

describe("MS7 parser: WhatsApp failed status carries Meta's error", () => {
  it("extracts errors[0] title + details; other statuses carry no error field", () => {
    const parsed = parseMetaWebhook({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { statuses: [
        { id: "wamid.F1", status: "failed", errors: [{ code: 131047, title: "Re-engagement message", error_data: { details: "More than 24 hours have passed" } }] },
        { id: "wamid.D1", status: "delivered" },
        { id: "wamid.F2", status: "failed" },
      ] } }] }],
    });
    expect(parsed.statuses[0]).toEqual({
      channel: "whatsapp", externalId: "wamid.F1", status: "failed",
      error: "Re-engagement message — More than 24 hours have passed",
    });
    expect(parsed.statuses[1]).toEqual({ channel: "whatsapp", externalId: "wamid.D1", status: "delivered" });
    expect(parsed.statuses[2].error).toBeUndefined();
  });
});

describe("MS7 webhook → broadcast delivery lifecycle (real handleWebhook)", () => {
  const sign = (body: string) => "sha256=" + createHmac("sha256", "appsecret").update(body, "utf8").digest("hex");
  function setup() {
    const built = build();
    const { tables } = built;
    const secrets = encryptJson({ accessToken: "tok", appSecret: "appsecret", verifyToken: "vtok", phoneNumberId: "999" });
    tables.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: "whatsapp", status: "CONNECTED", credential: { encryptedData: secrets } });
    const llmStub = { getProvider: () => { throw new Error("no llm in this spec"); } } as any;
    const inbox = new InboxService(
      tables as any, { log: async () => undefined } as any, llmStub,
      // Integration: the merged InboxService constructor carries
      // IN2's customers at slot 11 and MS2's messagingPrefs at
      // slot 12 (Nest DI resolves by type in production; only this
      // positional test construction needs the extra undefined).
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      built.svc as any,
    );
    const sendStatuses = async (statuses: any[]) => {
      const body = JSON.stringify({
        object: "whatsapp_business_account",
        entry: [{ changes: [{ field: "messages", value: { statuses } }] }],
      });
      return inbox.handleWebhook("int-1", body, sign(body));
    };
    return { ...built, inbox, sendStatuses };
  }

  it("delivered → read advance monotonically; a later failed never erases them; statusesApplied stays the inbox counter", async () => {
    const { tables, sendStatuses } = setup();
    const d = seedDelivery(tables, { id: "dlv-A", providerMessageId: "wamid.B1" });
    const r1 = await sendStatuses([{ id: "wamid.B1", status: "delivered" }]);
    expect(r1.statusesApplied).toBe(0); // broadcast matches do not inflate the inbox counter
    expect(d.deliveryStatus).toBe("delivered");
    expect(d.deliveredAt).toBeInstanceOf(Date);
    await sendStatuses([{ id: "wamid.B1", status: "read" }]);
    expect(d.deliveryStatus).toBe("read");
    expect(d.readAt).toBeInstanceOf(Date);
    const deliveredAt = d.deliveredAt; const readAt = d.readAt;
    await sendStatuses([{ id: "wamid.B1", status: "failed", errors: [{ title: "Late failure", error_data: { details: "arrived after read" } }] }]);
    expect(d.deliveryStatus).toBe("read"); // failed after read is ignored
    expect(d.deliveredAt).toBe(deliveredAt);
    expect(d.readAt).toBe(readAt);
    await sendStatuses([{ id: "wamid.B1", status: "delivered" }]); // weaker repeat: no-op
    expect(d.deliveryStatus).toBe("read");
    expect(d.status).toBe("sent"); // the MS1 send outcome is never touched
  });

  it("failed from the untouched state applies (with the webhook error) and is terminal; unknown ids are ignored", async () => {
    const { tables, sendStatuses } = setup();
    const d = seedDelivery(tables, { id: "dlv-B", providerMessageId: "wamid.B2" });
    await sendStatuses([{ id: "wamid.B2", status: "failed", errors: [{ title: "Template not found", error_data: { details: "132001" } }] }]);
    expect(d.deliveryStatus).toBe("failed");
    expect(d.error).toBe("Template not found — 132001");
    await sendStatuses([{ id: "wamid.B2", status: "delivered" }]);
    expect(d.deliveryStatus).toBe("failed"); // terminal
    const res = await sendStatuses([{ id: "wamid.UNKNOWN", status: "delivered" }]);
    expect(res.received).toBe(0); // no crash, nothing applied
  });

  it("ChannelMessage match wins: an inbox message with the same id is updated and the broadcast delivery is NOT touched", async () => {
    const { tables, sendStatuses } = setup();
    tables.channelConversation.rows.push({
      id: "conv-1", organizationId: "org-1", integrationId: "int-1", channel: "whatsapp",
      externalContactId: "8801712345678", status: "open", unreadCount: 0,
    });
    const msg = { id: "msg-1", conversationId: "conv-1", direction: "out", externalId: "wamid.SHARED", status: "sent", type: "text", content: "hi" };
    tables.channelMessage.rows.push(msg);
    const d = seedDelivery(tables, { id: "dlv-C", providerMessageId: "wamid.SHARED" });
    const res = await sendStatuses([{ id: "wamid.SHARED", status: "delivered" }]);
    expect(res.statusesApplied).toBe(1);
    expect((msg as any).status).toBe("delivered");
    expect(d.deliveryStatus).toBeNull(); // fallback only fires on NO ChannelMessage match
  });

  it("applyWhatsAppDeliveryStatus swallows storage errors and ignores 'sent'", async () => {
    const { svc, tables } = build();
    seedDelivery(tables, { id: "dlv-D", providerMessageId: "wamid.B9" });
    expect(await svc.applyWhatsAppDeliveryStatus("org-1", "wamid.B9", "sent")).toEqual({ applied: false });
    expect(await svc.applyWhatsAppDeliveryStatus("org-1", "wamid.MISSING", "delivered")).toEqual({ applied: false });
    tables.messageDelivery.findFirst = async () => { throw new Error("column does not exist (pre-migration)"); };
    expect(await svc.applyWhatsAppDeliveryStatus("org-1", "wamid.B9", "delivered")).toEqual({ applied: false });
  });
});

describe("MS7 open pixel", () => {
  it("is appended to broadcast HTML email only; the token stamps openedAt on first hit only", async () => {
    const { svc, tables, emailCalls } = build();
    tables.customer.rows.push({ id: "c1", organizationId: "org-1", firstName: "Ayesha", lastName: null, email: "ayesha@example.com", phone: "01712345678" });
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "html", channel: "email", subject: "s", body: "text part", htmlBody: "<p>hello</p>", audienceType: "customers",
    });
    await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(emailCalls).toHaveLength(1);
    const html: string = emailCalls[0].html;
    expect(html).toContain("<p>hello</p>");
    expect(html).toContain("https://api.example.com/public/messaging/open/");
    const token = html.split("/public/messaging/open/")[1].split('"')[0];
    const delivery = tables.messageDelivery.rows.find((d: any) => d.broadcastId === bc.id);
    expect(delivery.openedAt ?? null).toBeNull(); // unset (fake) == null (real DB default)
    await svc.performOpenTracking(token);
    expect(delivery.openedAt).toBeInstanceOf(Date);
    const first = delivery.openedAt;
    await svc.performOpenTracking(token);
    expect(delivery.openedAt).toBe(first); // first hit only — never moved
  });

  it("text-only broadcasts and workflow sends carry no pixel; a bad token writes nothing", async () => {
    const { svc, tables, emailCalls } = build();
    tables.customer.rows.push({ id: "c1", organizationId: "org-1", firstName: "Ayesha", lastName: null, email: "ayesha@example.com", phone: "01712345678" });
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "plain", channel: "email", subject: "s", body: "only text", audienceType: "customers",
    });
    await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(emailCalls[0].html).toBeUndefined();
    // workflow-shaped send (no broadcastId): html present but no pixel
    await svc.sendToRecipient("org-1", {
      channel: "email", recipient: { type: "customer", id: "c1", name: "Ayesha", email: "ayesha@example.com" },
      subject: "s", body: "b", htmlBody: "<p>x</p>", vars: {},
    });
    expect(emailCalls[1].html).toBe("<p>x</p>");
    await expect(svc.performOpenTracking("tampered.token")).rejects.toThrow();
    expect(tables.messageDelivery.rows.every((d: any) => !d.openedAt)).toBe(true);
  });

  it("the pixel does not depend on the link-tracking toggle (links stay verbatim when OFF, pixel still rides)", async () => {
    const { svc, tables, emailCalls } = build();
    tables.messagingSetting.rows.push({ id: "ms-1", organizationId: "org-1", linkTrackingEnabled: false });
    tables.customer.rows.push({ id: "c1", organizationId: "org-1", firstName: "Ayesha", lastName: null, email: "ayesha@example.com", phone: "01712345678" });
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "off", channel: "email", subject: "s", body: "see https://shop.example.com/p", htmlBody: '<p><a href="https://shop.example.com/p">buy</a></p>', audienceType: "customers",
    });
    await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(emailCalls[0].html).toContain('href="https://shop.example.com/p"'); // authored link verbatim (MS5 locked rule)
    expect(emailCalls[0].html).toContain("/public/messaging/open/"); // opens are lifecycle, not link rewriting
  });
});

describe("MS7 failure-reason normalization (pure)", () => {
  it("strips addresses, ids and numbers so the same provider reason groups together", () => {
    expect(normalizeFailureReason("SMTP rejected recipient 01712345678")).toBe("SMTP rejected recipient <number>");
    expect(normalizeFailureReason("SMTP rejected recipient 01898765432")).toBe("SMTP rejected recipient <number>");
    expect(normalizeFailureReason("Bounce for user ayesha@example.com at relay")).toBe("Bounce for user <address> at relay");
    expect(normalizeFailureReason("Job 3f2b8c1e-1234-4abc-9def-0123456789ab failed after 3 retries")).toBe("Job <id> failed after <n> retries");
    expect(normalizeFailureReason(null)).toBe("Unknown error");
    expect(normalizeFailureReason("")).toBe("Unknown error");
    expect(normalizeFailureReason("x".repeat(200)).length).toBe(80);
  });
  it("groups with a top-10 + other bucket", () => {
    const errors = ["Mailbox full", "Mailbox full", ...Array.from({ length: 11 }, (_, i) => `Reason ${String.fromCharCode(65 + i)}`)];
    const grouped = groupFailureReasons(errors);
    expect(grouped[0]).toEqual({ reason: "Mailbox full", count: 2 });
    expect(grouped).toHaveLength(11);
    expect(grouped[10].reason).toBe("other");
    expect(grouped[10].count).toBe(2);
  });
  it("deliveryRecipientKey reuses the send-side definition", () => {
    expect(deliveryRecipientKey({ recipientType: "customer", recipientId: "c1", address: "a@x.com" })).toBe("customer:c1");
    expect(deliveryRecipientKey({ recipientType: "csv", recipientId: null, address: "a@x.com" })).toBe("csv:a@x.com");
    expect(deliveryRecipientKey({ recipientType: "test", recipientId: null, address: "a@x.com" })).toBe("test:a@x.com");
  });
});

function snapshotOf(n: number, status: string, extra: (i: number) => any = () => ({})) {
  return Array.from({ length: n }, (_, i) => ({
    type: "customer", id: `c${i + 1}`, name: `Cust ${i + 1}`, email: `c${i + 1}@x.com`, phone: "01712345678",
    status, attempts: 1, ...extra(i),
  }));
}
function seedBroadcast(tables: any, over: any) {
  const row = {
    id: "bc-1", organizationId: "org-1", name: "Camp", channel: "whatsapp",
    status: "sent", sentAt: new Date("2026-10-10T10:00:00Z"), scheduledAt: null,
    recipientSnapshot: [], totalRecipients: 0, sentCount: 0, failedCount: 0,
    htmlBody: null, abVariant: null, abGroupId: null, recurrence: null, recurrenceGroupId: null,
    ...over,
  };
  tables.broadcast.rows.push(row);
  return row;
}

describe("MS7 report funnel", () => {
  it("WhatsApp: delivered/read real, opened + clicked null (never 0)", async () => {
    const { svc, tables } = build();
    seedBroadcast(tables, { id: "bc-1", channel: "whatsapp", recipientSnapshot: [...snapshotOf(3, "sent"), ...snapshotOf(1, "failed", () => ({ id: "c9" }))] });
    seedDelivery(tables, { id: "d1", broadcastId: "bc-1", recipientId: "c1", deliveryStatus: "delivered", deliveredAt: new Date() });
    seedDelivery(tables, { id: "d2", broadcastId: "bc-1", recipientId: "c2", deliveryStatus: "read", deliveredAt: new Date(), readAt: new Date() });
    seedDelivery(tables, { id: "d3", broadcastId: "bc-1", recipientId: "c3" });
    seedDelivery(tables, { id: "d4", broadcastId: "bc-1", recipientId: "c9", status: "failed", error: "Recipient 01712345678 is not on WhatsApp" });
    const report: any = await svc.getBroadcastReport("org-1", "bc-1");
    expect(report.funnel.audience).toBe(4);
    expect(report.funnel.sent).toBe(3);
    expect(report.funnel.failed).toBe(1);
    expect(report.funnel.delivered).toBe(2);
    expect(report.funnel.read).toBe(1);
    expect(report.funnel.opened).toBeNull();
    expect(report.funnel.clickedRecipients).toBeNull();
    expect(report.funnel.totalClicks).toBeNull();
    expect(report.failureReasons).toEqual([{ reason: "Recipient <number> is not on WhatsApp", count: 1 }]);
  });

  it("Email (HTML): opened + clicked real, delivered/read null; text-only email reports opened null", async () => {
    const { svc, tables } = build();
    seedBroadcast(tables, { id: "bc-1", channel: "email", htmlBody: "<p>x</p>", recipientSnapshot: snapshotOf(3, "sent") });
    seedDelivery(tables, { id: "d1", broadcastId: "bc-1", channel: "email", recipientId: "c1", address: "c1@x.com", openedAt: new Date() });
    seedDelivery(tables, { id: "d2", broadcastId: "bc-1", channel: "email", recipientId: "c2", address: "c2@x.com", openedAt: new Date() });
    seedDelivery(tables, { id: "d3", broadcastId: "bc-1", channel: "email", recipientId: "c3", address: "c3@x.com" });
    tables.messageLinkClick.rows.push(
      { id: "k1", organizationId: "org-1", broadcastId: "bc-1", recipientKey: "customer:c1", url: "https://shop.example.com", createdAt: new Date() },
      { id: "k2", organizationId: "org-1", broadcastId: "bc-1", recipientKey: "customer:c1", url: "https://shop.example.com", createdAt: new Date() },
      { id: "k3", organizationId: "org-1", broadcastId: "bc-1", recipientKey: "customer:c2", url: "https://shop.example.com", createdAt: new Date() },
    );
    const report: any = await svc.getBroadcastReport("org-1", "bc-1");
    expect(report.funnel.opened).toBe(2);
    expect(report.funnel.clickedRecipients).toBe(2);
    expect(report.funnel.totalClicks).toBe(3);
    expect(report.funnel.delivered).toBeNull(); // SMTP has no delivery signal
    expect(report.funnel.read).toBeNull();

    const built2 = build();
    seedBroadcast(built2.tables, { id: "bc-1", channel: "email", htmlBody: null, recipientSnapshot: snapshotOf(1, "sent") });
    const report2: any = await built2.svc.getBroadcastReport("org-1", "bc-1");
    expect(report2.funnel.opened).toBeNull(); // no pixel exists in text-only mail
  });

  it("SMS: delivered/read/opened null (DLR verify-first outcome c), clicked real", async () => {
    const { svc, tables } = build();
    seedBroadcast(tables, { id: "bc-1", channel: "sms", recipientSnapshot: snapshotOf(2, "sent") });
    tables.messageLinkClick.rows.push({ id: "k1", organizationId: "org-1", broadcastId: "bc-1", recipientKey: "customer:c1", url: "https://x", createdAt: new Date() });
    const report: any = await svc.getBroadcastReport("org-1", "bc-1");
    expect(report.funnel.delivered).toBeNull();
    expect(report.funnel.read).toBeNull();
    expect(report.funnel.opened).toBeNull();
    expect(report.funnel.clickedRecipients).toBe(1);
  });
});

describe("MS7 A/B suggestion", () => {
  it("abSuggestion: read basis preferred; small samples and ties give leader null", () => {
    expect(abSuggestion({ A: { sent: 100, read: 40, clickedRecipients: null }, B: { sent: 100, read: 20, clickedRecipients: null } }))
      .toMatchObject({ basis: "readRate", leader: "A" });
    expect(abSuggestion({ A: { sent: 10, read: 9, clickedRecipients: null }, B: { sent: 10, read: 1, clickedRecipients: null } }).leader).toBeNull();
    expect(abSuggestion({ A: { sent: 50, read: 10, clickedRecipients: null }, B: { sent: 50, read: 10, clickedRecipients: null } }).leader).toBeNull();
    expect(abSuggestion({ A: { sent: 50, read: null, clickedRecipients: null }, B: { sent: 50, read: null, clickedRecipients: null } }))
      .toMatchObject({ basis: null, leader: null });
  });

  it("through the report: both variants' funnels + a click-based suggestion; nothing is auto-sent", async () => {
    const { svc, tables } = build();
    const mk = (id: string, variant: string) => seedBroadcast(tables, {
      id, channel: "email", abVariant: variant, abGroupId: "grp-1",
      recipientSnapshot: snapshotOf(40, "sent"),
    });
    mk("bc-A", "A"); mk("bc-B", "B");
    for (let i = 1; i <= 10; i++) tables.messageLinkClick.rows.push({ id: `ka${i}`, organizationId: "org-1", broadcastId: "bc-A", recipientKey: `customer:c${i}`, url: "https://x", createdAt: new Date() });
    for (let i = 1; i <= 4; i++) tables.messageLinkClick.rows.push({ id: `kb${i}`, organizationId: "org-1", broadcastId: "bc-B", recipientKey: `customer:c${i}`, url: "https://x", createdAt: new Date() });
    const report: any = await svc.getBroadcastReport("org-1", "bc-A");
    expect(report.ab.groupId).toBe("grp-1");
    expect(report.ab.variants.A.clickedRecipients).toBe(10);
    expect(report.ab.variants.B.clickedRecipients).toBe(4);
    expect(report.ab.suggestion).toMatchObject({ basis: "clickRate", leader: "A" });
    expect(report.ab.suggestion.note).toContain("শুধু পরামর্শ");
    expect(tables.broadcast.rows.every((b: any) => b.status === "sent")).toBe(true); // report mutated nothing
  });
});

describe("MS7 revenue association + replies", () => {
  it("counts only snapshot customers' non-cancelled, non-practice orders inside the 7-day window, with the method label", async () => {
    const { svc, tables } = build();
    const sentAt = new Date("2026-10-10T10:00:00Z");
    seedBroadcast(tables, {
      id: "bc-1", channel: "email", sentAt,
      recipientSnapshot: [
        { type: "customer", id: "c1", name: "A", email: "a@x.com", phone: null, status: "sent", attempts: 1 },
        { type: "customer", id: "c2", name: "B", email: "b@x.com", phone: null, status: "sent", attempts: 1 },
        { type: "lead", id: "l1", name: "L", email: "l@x.com", phone: null, status: "sent", attempts: 1 },
        { type: "csv", id: "csv@x.com", name: "", email: "csv@x.com", phone: null, status: "sent", attempts: 1 },
      ],
    });
    const order = (over: any) => tables.order.rows.push({ id: `o${tables.order.rows.length + 1}`, organizationId: "org-1", status: "completed", isPractice: false, ...over });
    order({ customerId: "c1", totalMinor: 10000n, createdAt: new Date("2026-10-12T10:00:00Z") }); // in window ✓
    order({ customerId: "c1", totalMinor: 99000n, createdAt: new Date("2026-10-18T10:00:00Z") }); // after window ✗
    order({ customerId: "c2", totalMinor: 25050n, createdAt: new Date("2026-10-13T10:00:00Z") }); // in window ✓
    order({ customerId: "c2", totalMinor: 77000n, createdAt: new Date("2026-10-13T11:00:00Z"), status: "cancelled" }); // ✗
    order({ customerId: "c2", totalMinor: 55000n, createdAt: new Date("2026-10-13T12:00:00Z"), isPractice: true }); // ✗
    order({ customerId: "c9", totalMinor: 12300n, createdAt: new Date("2026-10-12T10:00:00Z") }); // not a recipient ✗
    const report: any = await svc.getBroadcastReport("org-1", "bc-1");
    expect(report.revenue).toEqual({
      windowDays: 7, orders: 2, totalMinor: "35050", customerRecipients: 2,
      method: "প্রাপক কাস্টমারদের পাঠানোর পর ৭ দিনের অর্ডার (সম্পর্ক, কারণের প্রমাণ নয়)",
    });
    expect(report.replies).toBeNull(); // email broadcast — no fabricated reply count

    const built2 = build();
    seedBroadcast(built2.tables, { id: "bc-1", channel: "email", sentAt: null, status: "draft", recipientSnapshot: [] });
    const draftReport: any = await built2.svc.getBroadcastReport("org-1", "bc-1");
    expect(draftReport.revenue).toBeNull(); // never sent — no window exists
  });

  it("WhatsApp replies: conversations of recipients with an inbound message after sentAt", async () => {
    const { svc, tables } = build();
    const sentAt = new Date("2026-10-10T10:00:00Z");
    seedBroadcast(tables, {
      id: "bc-1", channel: "whatsapp", sentAt,
      recipientSnapshot: [
        { type: "customer", id: "c1", name: "A", email: null, phone: "01712345678", status: "sent", attempts: 1 },
        { type: "customer", id: "c2", name: "B", email: null, phone: "01812345678", status: "sent", attempts: 1 },
      ],
    });
    tables.channelConversation.rows.push(
      { id: "conv-1", organizationId: "org-1", channel: "whatsapp", externalContactId: "8801712345678" },
      { id: "conv-2", organizationId: "org-1", channel: "whatsapp", externalContactId: "8801812345678" },
      { id: "conv-3", organizationId: "org-1", channel: "whatsapp", externalContactId: "8801999999999" },
    );
    tables.channelMessage.rows.push(
      { id: "m1", conversationId: "conv-1", direction: "in", createdAt: new Date("2026-10-10T11:00:00Z") }, // after ✓
      { id: "m2", conversationId: "conv-1", direction: "in", createdAt: new Date("2026-10-10T09:00:00Z") }, // before ✗
      { id: "m3", conversationId: "conv-2", direction: "out", createdAt: new Date("2026-10-10T12:00:00Z") }, // outbound ✗
      { id: "m4", conversationId: "conv-3", direction: "in", createdAt: new Date("2026-10-10T12:00:00Z") }, // not a recipient ✗
    );
    const report: any = await svc.getBroadcastReport("org-1", "bc-1");
    expect(report.replies).toBe(1);
    expect(report.repliesMethod).toContain("externalContactId");
  });
});

describe("MS7 deliveries pagination + export", () => {
  function seedMany(tables: any, n: number) {
    const base = new Date("2026-10-10T10:00:00Z").getTime();
    for (let i = 1; i <= n; i++) {
      tables.messageDelivery.rows.push({
        id: `d${String(i).padStart(4, "0")}`, organizationId: "org-1", broadcastId: "bc-1", workflowRunId: null,
        channel: "email", recipientType: "customer", recipientId: `c${i}`, address: `user${i}@x.com`,
        status: i % 3 === 0 ? "failed" : "sent", providerMessageId: `p${i}`, error: i % 3 === 0 ? "boom" : null,
        deliveryStatus: null, deliveredAt: null, readAt: null, openedAt: null,
        // createdAt ties in blocks of 60 — the cursor must walk ties by id without losing rows
        createdAt: new Date(base + Math.floor((i - 1) / 60) * 60000),
      });
    }
  }

  it("legacy mode is the bare array; paged mode walks every row exactly once across createdAt ties", async () => {
    const { svc, tables } = build();
    seedBroadcast(tables, { id: "bc-1", channel: "email" });
    seedMany(tables, 120);
    const legacy: any = await svc.listDeliveries("org-1", "bc-1");
    expect(Array.isArray(legacy)).toBe(true);
    expect(legacy).toHaveLength(120);

    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const page: any = await svc.listDeliveries("org-1", "bc-1", { cursor });
      pages++;
      for (const item of page.items) { expect(seen.has(item.id)).toBe(false); seen.add(item.id); }
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
      expect(pages).toBeLessThan(10);
    }
    expect(seen.size).toBe(120);
    expect(pages).toBe(3); // 50 + 50 + 20

    const failed: any = await svc.listDeliveries("org-1", "bc-1", { status: "failed" });
    expect(failed.items).toHaveLength(40);
    expect(failed.items.every((d: any) => d.status === "failed")).toBe(true);
    const byQ: any = await svc.listDeliveries("org-1", "bc-1", { q: "user7@" });
    expect(byQ.items.map((d: any) => d.address)).toEqual(["user7@x.com"]);
  });

  it("export writes the audited CSV with the lifecycle columns", async () => {
    const { svc, tables, auditCalls } = build();
    seedBroadcast(tables, { id: "bc-1", channel: "email" });
    seedDelivery(tables, { id: "d1", broadcastId: "bc-1", channel: "email", recipientId: "c1", address: "a@x.com", providerMessageId: "p1", deliveryStatus: "read" });
    seedDelivery(tables, { id: "d2", broadcastId: "bc-1", channel: "email", recipientId: "c2", address: "b@x.com", status: "failed", error: 'SMTP "hard" bounce' });
    const csv = await svc.exportDeliveriesCsv("org-1", "owner", "bc-1");
    const lines = csv.split("\n");
    expect(lines[0]).toBe("address,channel,status,deliveryStatus,providerMessageId,error,createdAt");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"a@x.com","email","sent","read","p1"');
    expect(lines[2]).toContain('"SMTP ""hard"" bounce"');
    expect(auditCalls.some((c: any) => c.action === "broadcast.deliveries_export" && c.metadata.rows === 2 && c.metadata.truncated === false)).toBe(true);
  });

  it("export caps at 10000 rows with an honest truncated marker", async () => {
    const { svc, tables } = build();
    seedBroadcast(tables, { id: "bc-1", channel: "email" });
    for (let i = 1; i <= 10005; i++) {
      tables.messageDelivery.rows.push({
        id: `x${String(i).padStart(5, "0")}`, organizationId: "org-1", broadcastId: "bc-1", workflowRunId: null,
        channel: "email", recipientType: "customer", recipientId: `c${i}`, address: `u${i}@x.com`,
        status: "sent", providerMessageId: null, error: null, createdAt: new Date(),
      });
    }
    const csv = await svc.exportDeliveriesCsv("org-1", "owner", "bc-1");
    const lines = csv.split("\n");
    expect(lines[0]).toContain("# truncated");
    expect(lines[1]).toBe("address,channel,status,deliveryStatus,providerMessageId,error,createdAt");
    expect(lines).toHaveLength(10002); // marker + header + 10000 rows
  }, 30000);

  it("issueOpenToken round-trips through the pixel endpoint for a csv recipient", async () => {
    const { svc, tables } = build();
    seedBroadcast(tables, { id: "bc-1", channel: "email" });
    const d = seedDelivery(tables, { id: "d1", broadcastId: "bc-1", channel: "email", recipientType: "csv", recipientId: null, address: "csv@x.com" });
    const token = issueOpenToken({ orgId: "org-1", broadcastId: "bc-1", recipientKey: "csv:csv@x.com" });
    await svc.performOpenTracking(token);
    expect(d.openedAt).toBeInstanceOf(Date);
  });
});
