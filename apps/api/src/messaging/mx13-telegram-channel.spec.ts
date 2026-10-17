import { MessagingService, validateTelegramButtons } from "./messaging.service";

/**
 * MX13 — Telegram as a Messaging broadcast channel.
 *
 * Fake-prisma style like mx12-push-channel.spec.ts. The
 * telegram SEND goes through a fake registered
 * TelegramSendPort — the port is the seam TelegramService
 * (inbox module) registers in production; here it records
 * calls and returns scripted real-shaped outcomes (sent with
 * a message_id / failed with Telegram's real description).
 * Resolution reads ChannelConversation rows (the subscriber
 * base — Telegram bots cannot initiate contact, so every
 * subscriber has one); the order bot's BotSession rows are
 * per-conversation state, never a registry, and no table for
 * them exists in this fixture at all.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("not" in v) { const ok = v.not === null ? row[k] !== null && row[k] !== undefined : row[k] !== v.not; if (!ok) return false; }
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("gt" in v && !(row[k] > v.gt)) return false;
      if ("gte" in v && !(new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      if ("lte" in v && !(new Date(row[k]).getTime() <= new Date(v.lte).getTime())) return false;
      if ("lt" in v && !(new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      if ("contains" in v && !String(row[k] ?? "").includes(v.contains)) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    return row[k] === v;
  });
}

function sortRows(rows: any[], orderBy: any): any[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...rows];
  out.sort((a, b) => {
    for (const spec of specs) {
      for (const [key, dir] of Object.entries(spec)) {
        const av = a[key]; const bv = b[key];
        if (av === bv) continue;
        const cmp = av < bv ? -1 : 1;
        return dir === "desc" ? -cmp : cmp;
      }
    }
    return 0;
  });
  return out;
}

function project(row: any, select: any): any {
  if (!select) return row;
  const out: any = {};
  for (const k of Object.keys(select)) if (select[k]) out[k] = row[k];
  return out;
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where, select }: any = {}) => {
      const row = rows.find((r) => matches(r, where ?? {})) ?? null;
      return row ? project(row, select) : null;
    },
    findMany: async ({ where, take, orderBy, cursor, skip, select }: any = {}) => {
      let out = sortRows(rows.filter((r) => matches(r, where ?? {})), orderBy);
      if (cursor?.id) {
        const pos = out.findIndex((r) => r.id === cursor.id);
        if (pos >= 0) out = out.slice(pos + (skip ?? 0));
      } else if (skip) {
        out = out.slice(skip);
      }
      if (take) out = out.slice(0, take);
      return out.map((r) => project(r, select));
    },
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})).length,
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (row) { Object.assign(row, data); row.updatedAt = new Date(); }
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      let n = 0;
      for (const row of rows) if (matches(row, where ?? {})) { Object.assign(row, data); row.updatedAt = new Date(); n++; }
      return { count: n };
    },
    deleteMany: async ({ where }: any) => {
      let n = 0;
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where ?? {})) { rows.splice(i, 1); n++; }
      return { count: n };
    },
    delete: async ({ where }: any) => {
      const i = rows.findIndex((r) => r.id === where.id);
      if (i >= 0) rows.splice(i, 1);
      return {};
    },
  };
}

function makeRecipientTable() {
  const table: any = makeTable("bcr");
  table.createMany = async ({ data, skipDuplicates }: any) => {
    let count = 0;
    for (const d of data) {
      const dupe = table.rows.some((r: any) => r.broadcastId === d.broadcastId && r.dedupeKey === d.dedupeKey);
      if (dupe) {
        if (skipDuplicates) continue;
        throw new Error("Unique constraint failed on the fields: (`broadcastId`,`dedupeKey`)");
      }
      table.rows.push({ id: `bcr-${table.rows.length + 1}-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date(), updatedAt: new Date(), ...d });
      count++;
    }
    return { count };
  };
  return table;
}

function build(opts?: {
  portOutcomes?: Map<string, { outcome: "sent" | "failed"; messageId?: string; error?: string }>;
  noPort?: boolean;
}) {
  const tables: any = {
    messageTemplate: makeTable("tpl"), broadcast: makeTable("bc"), messageDelivery: makeTable("dlv"),
    customer: makeTable("cust"), lead: makeTable("lead"), whatsAppTemplate: makeTable("wa"),
    messagePreference: makeTable("pref"), messagingSetting: makeTable("mset"),
    broadcastRecipient: makeRecipientTable(),
    channelConversation: makeTable("conv"),
    order: makeTable("ord"),
    messageLinkClick: makeTable("click"),
  };
  tables.customer.rows.push(
    { id: "c1", organizationId: "org-1", firstName: "Ayesha", lastName: "Rahman", email: "ayesha@example.com", phone: "01712345671" },
    { id: "c2", organizationId: "org-1", firstName: "Tanvir", lastName: null, email: "tanvir@example.com", phone: "01712345672" },
  );
  tables.lead.rows.push(
    { id: "l1", organizationId: "org-1", name: "Lead Rahim", email: "rahim@example.com", phone: "01712345673", stage: "qualified" },
    { id: "l2", organizationId: "org-1", name: "Lead New", email: null, phone: "01712345674", stage: "new" },
  );
  // The subscriber base: telegram ChannelConversation rows.
  // conv-1 + conv-1dup share chat 111111 (the schema's unique
  // [org, channel, externalContactId] prevents this in prod —
  // the resolver must still dedupe defensively). conv-5 has a
  // blank chat id (unusable). conv-6 is a WhatsApp conversation
  // (never a telegram recipient). conv-7 belongs to another org.
  tables.channelConversation.rows.push(
    { id: "conv-1", organizationId: "org-1", channel: "telegram", externalContactId: "111111", contactName: "Ayesha T", customerId: "c1", leadId: null },
    { id: "conv-1dup", organizationId: "org-1", channel: "telegram", externalContactId: "111111", contactName: "Ayesha T", customerId: "c1", leadId: null },
    { id: "conv-2", organizationId: "org-1", channel: "telegram", externalContactId: "555555", contactName: "Tanvir T", customerId: "c2", leadId: null },
    { id: "conv-3", organizationId: "org-1", channel: "telegram", externalContactId: "333333", contactName: "Rahim T", customerId: null, leadId: "l1" },
    { id: "conv-4", organizationId: "org-1", channel: "telegram", externalContactId: "444444", contactName: null, customerId: null, leadId: null },
    { id: "conv-5", organizationId: "org-1", channel: "telegram", externalContactId: "  ", contactName: "Blank", customerId: null, leadId: null },
    { id: "conv-6", organizationId: "org-1", channel: "whatsapp", externalContactId: "8801712345671", contactName: "WA", customerId: "c1", leadId: null },
    { id: "conv-7", organizationId: "org-2", channel: "telegram", externalContactId: "999999", contactName: "Other org", customerId: null, leadId: null },
  );
  tables.systemSetting = {
    findUnique: async () => null,
  };
  tables.organization = {
    findUnique: async () => ({ aiDailyLimitOverride: null, broadcastCapOverride: null, seatLimit: null }),
  };
  const email = { isConfigured: () => true, send: async () => ({ providerMessageId: "<unused>" }) } as any;
  const sms = { isConfigured: () => false, send: async () => { throw new Error("SMS is not configured"); } } as any;
  const svc = new MessagingService(tables as any, { log: async () => undefined } as any, email, sms);
  const portCalls: { chatId: string; text: string; buttons?: { label: string; url: string }[] | null }[] = [];
  if (!opts?.noPort) {
    svc.registerTelegramSendPort({
      sendTelegram: async (_orgId: string, input: any) => {
        portCalls.push({ ...input });
        return opts?.portOutcomes?.get(input.chatId) ?? { outcome: "sent", messageId: `tg-${input.chatId}` };
      },
    });
  }
  return { svc, tables, portCalls };
}

async function draftTelegram(svc: MessagingService, extra: Record<string, unknown> = {}) {
  return svc.createBroadcast("org-1", "owner", {
    name: "Eid telegram", channel: "telegram", body: "হ্যালো {{name}}, ঈদ অফার চলছে!",
    audienceType: "telegram_subscribers",
    telegramButtons: [{ label: "এখনই কিনুন", url: "https://shop.example.com/sale" }],
    ...extra,
  } as any);
}

const rowsOf = (tables: any, broadcastId: string) =>
  tables.broadcastRecipient.rows.filter((r: any) => r.broadcastId === broadcastId);
const deliveriesOf = (tables: any, broadcastId: string) =>
  tables.messageDelivery.rows.filter((r: any) => r.broadcastId === broadcastId);

describe("MX13 create validation", () => {
  it("accepts a telegram broadcast and stores body + buttons on the row (no subject)", async () => {
    const { svc } = build();
    const bc: any = await draftTelegram(svc);
    expect(bc.channel).toBe("telegram");
    expect(bc.subject).toBeNull();
    expect(bc.telegramButtons).toEqual([{ label: "এখনই কিনুন", url: "https://shop.example.com/sale" }]);
    expect(bc.status).toBe("draft");
    // Compose-check accepts the channel too.
    expect(svc.checkCompose({ channel: "telegram", body: "হ্যালো" }).warnings).toBeDefined();
  });

  it("refuses: a subject, a template, an http button URL, >4 buttons, an over-long body, a csv audience, buttons on email, an enabled cascade", async () => {
    const { svc } = build();
    const base = { name: "x", channel: "telegram", body: "b", audienceType: "telegram_subscribers" } as any;
    await expect(svc.createBroadcast("org-1", "owner", { ...base, subject: "hi" })).rejects.toThrow(/no subject/);
    await expect(svc.createBroadcast("org-1", "owner", { ...base, templateId: "tpl-1" })).rejects.toThrow(/do not use message templates/);
    await expect(svc.createBroadcast("org-1", "owner", { ...base, telegramButtons: [{ label: "x", url: "http://shop.example.com" }] })).rejects.toThrow(/https URL/);
    await expect(svc.createBroadcast("org-1", "owner", {
      ...base, telegramButtons: [1, 2, 3, 4, 5].map((n) => ({ label: `b${n}`, url: "https://shop.example.com" })),
    })).rejects.toThrow(/at most 4/);
    await expect(svc.createBroadcast("org-1", "owner", { ...base, body: "x".repeat(4097) })).rejects.toThrow(/4096/);
    await expect(svc.createBroadcast("org-1", "owner", { ...base, audienceType: "csv", audienceCsv: "a@b.com" })).rejects.toThrow(/not available for the telegram channel/);
    await expect(svc.createBroadcast("org-1", "owner", {
      name: "x", channel: "email", subject: "t", body: "b", audienceType: "customers",
      telegramButtons: [{ label: "x", url: "https://shop.example.com" }],
    } as any)).rejects.toThrow(/only allowed for telegram broadcasts/);
    await expect(svc.createBroadcast("org-1", "owner", {
      ...base, cascade: { enabled: true, channels: ["telegram", "sms"], smsBody: "fallback" },
    })).rejects.toThrow(/cascade/);
  });

  it("validateTelegramButtons: empty reads as null; label and URL rules enforced", () => {
    expect(validateTelegramButtons(undefined)).toBeNull();
    expect(validateTelegramButtons([])).toBeNull();
    expect(validateTelegramButtons([{ label: " কেনুন ", url: "https://a.example.com" }])).toEqual([{ label: "কেনুন", url: "https://a.example.com" }]);
    expect(() => validateTelegramButtons([{ label: "", url: "https://a.example.com" }])).toThrow(/label/);
    expect(() => validateTelegramButtons("nope")).toThrow(/array/);
  });
});

describe("MX13 resolution — from telegram conversations only", () => {
  it("telegram_subscribers: one recipient per chat id (deduped), linked contacts upgraded, blank/whatsapp/other-org rows never resolve", async () => {
    const { svc, tables } = build();
    const bc: any = await draftTelegram(svc);
    const prepared: any = await svc.prepareBroadcast("org-1", bc.id);
    expect(prepared.totalRecipients).toBe(4);
    const rows = rowsOf(tables, bc.id);
    expect(rows.map((r: any) => r.telegramChatId).sort()).toEqual(["111111", "333333", "444444", "555555"]);
    expect(new Set(rows.map((r: any) => r.dedupeKey))).toEqual(new Set(["telegram:111111", "telegram:333333", "telegram:444444", "telegram:555555"]));
    const cust = rows.find((r: any) => r.telegramChatId === "111111");
    expect(cust.recipientType).toBe("customer");
    expect(cust.recipientId).toBe("c1");
    // The chat id is stamped into `address` at prepare (the
    // preference-store identity for telegram).
    expect(cust.address).toBe("111111");
    const lead = rows.find((r: any) => r.telegramChatId === "333333");
    expect(lead.recipientType).toBe("lead");
    expect(lead.recipientId).toBe("l1");
    const anon = rows.find((r: any) => r.telegramChatId === "444444");
    expect(anon.recipientType).toBe("telegram");
    expect(anon.recipientId).toBe("conv-4");
    expect(anon.name).toBe("Telegram subscriber");
  });

  it("customers audience: only conversations linked to a real customer; leads_stage needs a stage and matches the linked lead's stage", async () => {
    const { svc } = build();
    const customers: any = await svc.resolveBroadcastRecipients("org-1", { channel: "telegram", audienceType: "customers" });
    expect(customers.recipients.map((r: any) => r.telegramChatId).sort()).toEqual(["111111", "555555"]);
    const leads: any = await svc.resolveBroadcastRecipients("org-1", { channel: "telegram", audienceType: "leads_stage", audienceStage: "qualified" });
    expect(leads.recipients.map((r: any) => r.telegramChatId)).toEqual(["333333"]);
    const none: any = await svc.resolveBroadcastRecipients("org-1", { channel: "telegram", audienceType: "leads_stage", audienceStage: "new" });
    expect(none.recipients).toHaveLength(0);
    await expect(svc.resolveBroadcastRecipients("org-1", { channel: "telegram", audienceType: "leads_stage" }))
      .rejects.toThrow(/audienceStage is required/);
    await expect(svc.resolveBroadcastRecipients("org-1", { channel: "telegram", audienceType: "custom", audienceDefinition: { entity: "customers", match: "all", conditions: [] } }))
      .rejects.toThrow(/cannot resolve telegram chats/);
  });

  it("preview: counts come from conversations, the sample masks chat ids, and NO cost figure is produced (no org rate exists for telegram)", async () => {
    const { svc } = build();
    const preview: any = await svc.previewBroadcast("org-1", { channel: "telegram", audienceType: "telegram_subscribers" });
    expect(preview.total).toBe(4);
    expect(preview.costEstimate).toBeNull();
    expect(JSON.stringify(preview.sample)).not.toContain("111111");
    expect(preview.sample.find((x: any) => x.type === "telegram")).toBeDefined();
  });
});

describe("MX13 STOP/START — inbound keyword → preference store → resolver → send", () => {
  it("STOP excludes the chat end-to-end (the port is never called for it); START and /start reverse it", async () => {
    const { svc, tables, portCalls } = build();
    const before: any = await svc.resolveBroadcastRecipients("org-1", { channel: "telegram", audienceType: "telegram_subscribers" });
    expect(before.recipients.map((r: any) => r.telegramChatId)).toContain("555555");

    // The inbound hook the inbox dispatch calls for telegram.
    const stop = await svc.handleInboundKeyword("org-1", "telegram", "555555", "STOP");
    expect(stop).toEqual({ matched: true, action: "opted_out" });
    const pref = tables.messagePreference.rows.find((p: any) => p.channel === "telegram" && p.address === "555555");
    expect(pref?.status).toBe("opted_out");
    expect(pref?.source).toBe("inbound_keyword");

    const after: any = await svc.resolveBroadcastRecipients("org-1", { channel: "telegram", audienceType: "telegram_subscribers" });
    expect(after.recipients.map((r: any) => r.telegramChatId)).not.toContain("555555");
    expect(after.excludedSuppressedCount).toBe(1);

    // A broadcast now sends to the other chats only.
    const bc: any = await draftTelegram(svc);
    await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(portCalls.map((c) => c.chatId).sort()).toEqual(["111111", "333333", "444444"]);
    expect(deliveriesOf(tables, bc.id).some((d: any) => d.address === "555555")).toBe(false);

    // START reverses; /start (Telegram's own command) does too.
    const start = await svc.handleInboundKeyword("org-1", "telegram", "555555", "START");
    expect(start).toEqual({ matched: true, action: "opted_in" });
    const revived: any = await svc.resolveBroadcastRecipients("org-1", { channel: "telegram", audienceType: "telegram_subscribers" });
    expect(revived.recipients.map((r: any) => r.telegramChatId)).toContain("555555");
    await svc.handleInboundKeyword("org-1", "telegram", "555555", "STOP");
    const slash = await svc.handleInboundKeyword("org-1", "telegram", "555555", "/start");
    expect(slash).toEqual({ matched: true, action: "opted_in" });
    // A non-keyword telegram message matches nothing.
    expect(await svc.handleInboundKeyword("org-1", "telegram", "555555", "দাম কত?")).toEqual({ matched: false });
    // WhatsApp behaviour is unchanged: /start is NOT a whatsapp keyword.
    expect(await svc.handleInboundKeyword("org-1", "whatsapp", "8801712345672", "/start")).toEqual({ matched: false });
  });

  it("a pending telegram preference excludes the chat too; addPreference validates chat ids", async () => {
    const { svc } = build();
    await svc.setPreference("org-1", { channel: "telegram", address: "444444", status: "pending", source: "signup_form" });
    const resolved: any = await svc.resolveBroadcastRecipients("org-1", { channel: "telegram", audienceType: "telegram_subscribers" });
    expect(resolved.recipients.map((r: any) => r.telegramChatId)).not.toContain("444444");
    expect(resolved.excludedPendingCount).toBe(1);
    const row: any = await svc.addPreference("org-1", "owner", { channel: "telegram", address: "123456", status: "opted_out" });
    expect(row.address).toBe("123456");
    await expect(svc.addPreference("org-1", "owner", { channel: "telegram", address: "not-a-chat", status: "opted_out" }))
      .rejects.toThrow(/Invalid Telegram chat id/);
  });
});

describe("MX13 send — through the registered port", () => {
  it("success: the port gets chat id + rendered text + buttons; deliveries are sent ONLY with the real message_id as providerMessageId", async () => {
    const { svc, tables, portCalls } = build();
    const bc: any = await draftTelegram(svc);
    const sent: any = await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(sent.status).toBe("sent");
    expect(portCalls).toHaveLength(4);
    const first = portCalls.find((c) => c.chatId === "111111");
    expect(first?.text).toBe("হ্যালো Ayesha Rahman, ঈদ অফার চলছে!");
    expect(first?.buttons).toEqual([{ label: "এখনই কিনুন", url: "https://shop.example.com/sale" }]);
    const deliveries = deliveriesOf(tables, bc.id);
    expect(deliveries).toHaveLength(4);
    expect(deliveries.every((d: any) => d.channel === "telegram" && d.status === "sent")).toBe(true);
    expect(deliveries.find((d: any) => d.address === "111111")?.providerMessageId).toBe("tg-111111");
    const anon = deliveries.find((d: any) => d.address === "444444");
    expect(anon?.recipientType).toBe("telegram");
    expect(anon?.providerMessageId).toBe("tg-444444");
  });

  it("blocked bot: the delivery is FAILED with Telegram's real description verbatim", async () => {
    const outcomes = new Map([["444444", { outcome: "failed" as const, error: "Telegram: Forbidden: bot was blocked by the user" }]]);
    const { svc, tables } = build({ portOutcomes: outcomes });
    const bc: any = await draftTelegram(svc);
    const sent: any = await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(sent.status).toBe("partial");
    expect(sent.sentCount).toBe(3);
    expect(sent.failedCount).toBe(1);
    const failed = deliveriesOf(tables, bc.id).find((d: any) => d.status === "failed");
    expect(failed.address).toBe("444444");
    expect(failed.error).toBe("Telegram: Forbidden: bot was blocked by the user");
    expect(failed.providerMessageId).toBeNull();
  });

  it("port absent: every send fails honestly — nothing is ever recorded sent", async () => {
    const { svc, tables } = build({ noPort: true });
    const bc: any = await draftTelegram(svc);
    const sent: any = await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(sent.status).toBe("failed");
    expect(sent.sentCount).toBe(0);
    const deliveries = deliveriesOf(tables, bc.id);
    expect(deliveries).toHaveLength(4);
    expect(deliveries.every((d: any) => d.status === "failed" && /send port is not available/.test(d.error ?? ""))).toBe(true);
  });

  it("a port that claims sent without a message_id is recorded FAILED, never sent", async () => {
    const { svc, tables } = build();
    svc.registerTelegramSendPort({ sendTelegram: async () => ({ outcome: "sent" }) as any });
    const bc: any = await draftTelegram(svc);
    const sent: any = await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(sent.sentCount).toBe(0);
    expect(deliveriesOf(tables, bc.id).every((d: any) => d.status === "failed" && /without a message_id/.test(d.error ?? ""))).toBe(true);
  });

  it("resume never re-sends a confirmed recipient: process again after a partial run only touches pending rows", async () => {
    const { svc, tables, portCalls } = build();
    const bc: any = await draftTelegram(svc);
    await svc.prepareBroadcast("org-1", bc.id);
    const first: any = await svc.processBroadcast("org-1", bc.id, { maxEntries: 2 });
    expect(first.processed).toBe(2);
    expect(portCalls).toHaveLength(2);
    const second: any = await svc.processBroadcast("org-1", bc.id);
    expect(second.processed).toBe(2);
    expect(portCalls).toHaveLength(4);
    expect(new Set(portCalls.map((c) => c.chatId)).size).toBe(4);
    expect(deliveriesOf(tables, bc.id)).toHaveLength(4);
  });

  it("quiet hours (MX3) defer a telegram broadcast exactly like other marketing channels — no port call, recipients stay pending", async () => {
    const { svc, tables, portCalls } = build();
    const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const nowParts = fmt.formatToParts(new Date());
    const nowMin = Number(nowParts.find((x) => x.type === "hour")?.value) * 60 + Number(nowParts.find((x) => x.type === "minute")?.value);
    const hhmm = (m: number) => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(((m % 1440) + 1440) % 1440 % 60).padStart(2, "0")}`;
    tables.messagingSetting.rows.push({
      id: "mset-1", organizationId: "org-1", frequencyCapPerDay: 0,
      quietHoursEnabled: true, quietHoursStart: hhmm(nowMin - 60), quietHoursEnd: hhmm(nowMin + 60),
    });
    const bc: any = await draftTelegram(svc);
    await svc.prepareBroadcast("org-1", bc.id);
    const result: any = await svc.processBroadcast("org-1", bc.id);
    expect(result.deferred).toBe("quiet_hours");
    expect(result.processed).toBe(0);
    expect(portCalls).toHaveLength(0);
    expect(rowsOf(tables, bc.id).every((r: any) => r.status === "pending")).toBe(true);
  });

  it("test-send to a typed chat id works through the port (with the broadcast's buttons) and records a test delivery", async () => {
    const { svc, tables, portCalls } = build();
    const bc: any = await draftTelegram(svc);
    const result: any = await svc.testSendBroadcast("org-1", "owner", bc.id, "777777");
    expect(result.status).toBe("sent");
    expect(result.providerMessageId).toBe("tg-777777");
    expect(portCalls).toHaveLength(1);
    expect(portCalls[0].chatId).toBe("777777");
    expect(portCalls[0].buttons).toEqual([{ label: "এখনই কিনুন", url: "https://shop.example.com/sale" }]);
    const test = tables.messageDelivery.rows.find((d: any) => d.recipientType === "test");
    expect(test?.channel).toBe("telegram");
    expect(test?.address).toBe("777777");
  });
});

describe("MX13 report funnel — honest null stages for telegram", () => {
  it("delivered/read/opened/clicked are null (never 0) while sent/failed are real; the broadcast carries its buttons", async () => {
    const outcomes = new Map([["333333", { outcome: "failed" as const, error: "Telegram: Bad Request: chat not found" }]]);
    const { svc } = build({ portOutcomes: outcomes });
    const bc: any = await draftTelegram(svc);
    await svc.sendBroadcast("org-1", "owner", bc.id);
    const report: any = await svc.getBroadcastReport("org-1", bc.id);
    expect(report.broadcast.telegramButtons).toEqual([{ label: "এখনই কিনুন", url: "https://shop.example.com/sale" }]);
    expect(report.funnel.sent).toBe(3);
    expect(report.funnel.failed).toBe(1);
    expect(report.funnel.delivered).toBeNull();
    expect(report.funnel.read).toBeNull();
    expect(report.funnel.opened).toBeNull();
    expect(report.funnel.clickedRecipients).toBeNull();
    expect(report.funnel.totalClicks).toBeNull();
  });
});
