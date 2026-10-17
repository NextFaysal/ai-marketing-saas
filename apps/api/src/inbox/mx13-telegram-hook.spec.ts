process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.DISABLE_SCHEDULER = "true";

import { InboxService } from "./inbox.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";
import { TelegramClient, TelegramService } from "./channels/telegram.service";
import { encryptJson } from "../integrations/crypto";

/**
 * MX13 — the telegram side of the channel:
 *  1. the inbox inbound dispatch calls the MS2 preference hook
 *     for TELEGRAM conversations too (channel "telegram",
 *     address = chat id), best-effort — a throwing hook never
 *     breaks ingest, and keyword campaigns (WhatsApp-only) are
 *     never invoked for telegram;
 *  2. TelegramService registers the TelegramSendPort Messaging
 *     consumes and sendForMessaging returns Telegram's real
 *     outcomes (sent only with a message_id; blocked/chat-not-
 *     found failures verbatim; no connected bot = honest
 *     failure);
 *  3. TelegramClient.sendMessage carries reply_markup
 *     inline URL buttons only when asked.
 */
function matches(row: any, where: any, tables: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (k === "OR") return (v as any[]).some((sub) => matches(row, sub, tables));
    if (k === "conversation") {
      const conv = tables.channelConversation.rows.find((c: any) => c.id === row.conversationId);
      return Boolean(conv) && matches(conv, v, tables);
    }
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("not" in v) return row[k] !== v.not;
      if ("in" in v) return v.in.includes(row[k]);
      if ("gt" in v) return row[k] > v.gt;
      if ("gte" in v) return row[k] >= v.gte;
      if ("lt" in v) return row[k] < v.lt;
      if ("lte" in v) return row[k] <= v.lte;
      if ("has" in v) return Array.isArray(row[k]) && row[k].includes(v.has);
      return true;
    }
    return row[k] === v;
  });
}

function makeTable(name: string, tables: any) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {}, tables)) ?? null,
    findMany: async ({ where, take }: any = {}) => {
      const filtered = rows.filter((r) => matches(r, where ?? {}, tables));
      return take ? filtered.slice(0, take) : filtered;
    },
    findUnique: async ({ where }: any = {}) => rows.find((r) => matches(r, where ?? {}, tables)) ?? null,
    create: async ({ data }: any) => {
      const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where ?? {}, tables));
      if (!row) return null;
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    updateMany: async () => ({ count: 0 }),
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => matches(r, where ?? {}, tables));
      return idx >= 0 ? rows.splice(idx, 1)[0] : null;
    },
    deleteMany: async () => ({ count: 0 }),
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {}, tables)).length,
  };
}

describe("MX13 inbox dispatch — telegram STOP/START hook", () => {
  const auditStub = { log: jest.fn(async () => undefined) } as any;
  const llmStub = { getProvider: () => new DevTemplateProvider() } as any;

  function build(prefs: any) {
    const tables: Record<string, any> = {};
    for (const t of ["inboxSetting", "botSession", "channelConversation", "channelMessage", "conversationNote", "integration", "product"]) {
      tables[t] = makeTable(t, tables);
    }
    tables.inboxSetting.rows.push({
      id: "s1", organizationId: "org-1", botEnabled: false, autoReplyMode: "off", smartAssign: "off",
    });
    const conv: any = {
      id: "conv-tg", organizationId: "org-1", channel: "telegram", status: "open",
      externalContactId: "555555", contactName: "Tanvir T",
      customerId: "cust-1", leadId: null, assignedUserId: "agent-1", tags: [],
    };
    tables.channelConversation.rows.push(conv);
    const svc = new InboxService(
      tables as any, auditStub, llmStub,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      prefs, undefined,
    );
    return { svc, tables, conv };
  }

  async function dispatch(svc: InboxService, conv: any, tables: any, text: string) {
    const msg: any = { id: `msg-${Math.random().toString(36).slice(2, 8)}`, conversationId: conv.id, direction: "in", type: "text", content: text };
    tables.channelMessage.rows.push(msg);
    await (svc as any).processInboundIntelligence("org-1", conv, msg, { content: text });
    return msg;
  }

  it("a telegram message calls the preference hook with channel telegram + the chat id; campaign matching is never invoked", async () => {
    const keywordCalls: any[] = [];
    const campaignCalls: any[] = [];
    const prefs = {
      handleInboundKeyword: async (...args: any[]) => { keywordCalls.push(args); return { matched: true, action: "opted_out" }; },
      handleKeywordReply: async (...args: any[]) => { campaignCalls.push(args); return { matched: false }; },
    };
    const { svc, tables, conv } = build(prefs);
    await dispatch(svc, conv, tables, "STOP");
    expect(keywordCalls).toEqual([["org-1", "telegram", "555555", "STOP"]]);
    expect(campaignCalls).toHaveLength(0);
  });

  it("a throwing telegram hook never breaks ingest (the message still gets classified)", async () => {
    const prefs = {
      handleInboundKeyword: async () => { throw new Error("preference store down"); },
      handleKeywordReply: async () => ({ matched: false }),
    };
    const { svc, tables, conv } = build(prefs);
    const msg = await dispatch(svc, conv, tables, "STOP");
    const stored = tables.channelMessage.rows.find((m: any) => m.id === msg.id);
    expect(stored.intent).toBeDefined();
  });
});

describe("MX13 TelegramService — the registered send port", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  function buildTelegram(opts?: { connected?: boolean; fetchImpl?: (url: string, init: any) => Promise<any> }) {
    const integrationRow: any = {
      id: "int-tg-1", organizationId: "org-1", provider: "telegram", status: "CONNECTED",
      externalAccountId: "424242", createdAt: new Date(),
      credential: { encryptedData: encryptJson({ botToken: "TESTTOKEN", webhookSecret: "s3cret" }) },
    };
    const prisma: any = {
      integration: {
        findFirst: async () => (opts?.connected === false ? null : integrationRow),
      },
    };
    const calls: { url: string; body: any }[] = [];
    global.fetch = (async (url: string, init: any) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
      if (opts?.fetchImpl) return opts.fetchImpl(String(url), init);
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 9001 } }) };
    }) as any;
    const messaging: any = { registerTelegramSendPort: jest.fn() };
    const svc = new TelegramService(prisma, { log: async () => undefined } as any, {} as any, messaging);
    return { svc, calls, messaging };
  }

  it("onModuleInit registers a port on MessagingService", async () => {
    const { svc, messaging } = buildTelegram();
    svc.onModuleInit();
    expect(messaging.registerTelegramSendPort).toHaveBeenCalledTimes(1);
    const port = messaging.registerTelegramSendPort.mock.calls[0][0];
    expect(typeof port.sendTelegram).toBe("function");
  });

  it("sent: returns the real message_id and posts text + inline_keyboard buttons to the Bot API", async () => {
    const { svc, calls } = buildTelegram();
    const out = await svc.sendForMessaging("org-1", {
      chatId: "555555", text: "ঈদ অফার!",
      buttons: [{ label: "কিনুন", url: "https://shop.example.com/sale" }],
    });
    expect(out).toEqual({ outcome: "sent", messageId: "9001" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.telegram.org/botTESTTOKEN/sendMessage");
    expect(calls[0].body.chat_id).toBe("555555");
    expect(calls[0].body.text).toBe("ঈদ অফার!");
    expect(calls[0].body.reply_markup).toEqual({ inline_keyboard: [[{ text: "কিনুন", url: "https://shop.example.com/sale" }]] });
  });

  it("no buttons: the request carries no reply_markup", async () => {
    const { svc, calls } = buildTelegram();
    await svc.sendForMessaging("org-1", { chatId: "555555", text: "শুধু লেখা" });
    expect(calls[0].body.reply_markup).toBeUndefined();
  });

  it("blocked bot: Telegram's real 403 description comes back as the failure, verbatim", async () => {
    const { svc } = buildTelegram({
      fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ ok: false, description: "Forbidden: bot was blocked by the user" }) }),
    });
    const out = await svc.sendForMessaging("org-1", { chatId: "555555", text: "hi" });
    expect(out.outcome).toBe("failed");
    expect(out.error).toBe("Telegram: Forbidden: bot was blocked by the user");
  });

  it("no connected bot: an honest failure, and no HTTP call is made", async () => {
    const { svc, calls } = buildTelegram({ connected: false });
    const out = await svc.sendForMessaging("org-1", { chatId: "555555", text: "hi" });
    expect(out.outcome).toBe("failed");
    expect(out.error).toMatch(/No connected Telegram bot/);
    expect(calls).toHaveLength(0);
  });
});

describe("MX13 TelegramClient — reply_markup is optional", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it("sendMessage without markup posts exactly chat_id + text (pre-MX13 shape)", async () => {
    const bodies: any[] = [];
    global.fetch = (async (_url: string, init: any) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 7 } }) };
    }) as any;
    const sent = await new TelegramClient("tok").sendMessage("123", "hello");
    expect(sent.message_id).toBe(7);
    expect(bodies[0]).toEqual({ chat_id: "123", text: "hello" });
  });
});
