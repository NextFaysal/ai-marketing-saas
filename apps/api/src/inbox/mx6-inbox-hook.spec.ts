process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.DISABLE_SCHEDULER = "true";

import { InboxService } from "./inbox.service";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

/**
 * MX6 — the inbox dispatch hook chain: the MS2 STOP/START hook
 * keeps EXCLUSIVE ownership of a matched message (campaign
 * matching must NOT run — an auto-reply after STOP would be a
 * violation); a non-keyword WhatsApp message reaches
 * handleKeywordReply best-effort with the real conversation;
 * and a campaign handler that THROWS never breaks ingest.
 * The messaging side is a recording stub at the constructor's
 * messagingPrefs slot (the same optional slot production DI
 * fills with the real MessagingService).
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

describe("MX6 inbox hook chain", () => {
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
      id: "conv-1", organizationId: "org-1", channel: "whatsapp", status: "open",
      externalContactId: "8801712345678", contactPhone: "8801712345678",
      customerId: "cust-1", leadId: null, assignedUserId: "agent-1", tags: [],
    };
    tables.channelConversation.rows.push(conv);
    // messagingPrefs sits at constructor slot 12 (after
    // customers) — every earlier optional slot stays undefined.
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

  it("STOP text: the preference hook matches and the campaign handler is NEVER called", async () => {
    const calls: any[] = [];
    const prefs = {
      handleInboundKeyword: async () => ({ matched: true, action: "opted_out" }),
      handleKeywordReply: async (...args: any[]) => { calls.push(args); return { matched: true }; },
    };
    const { svc, tables, conv } = build(prefs);
    await dispatch(svc, conv, tables, "STOP");
    expect(calls).toHaveLength(0);
  });

  it("START text: same exclusivity (opt-in bookkeeping owns it)", async () => {
    const calls: any[] = [];
    const prefs = {
      handleInboundKeyword: async () => ({ matched: true, action: "opted_in" }),
      handleKeywordReply: async (...args: any[]) => { calls.push(args); return { matched: true }; },
    };
    const { svc, tables, conv } = build(prefs);
    await dispatch(svc, conv, tables, "START");
    expect(calls).toHaveLength(0);
  });

  it("non-keyword text: the campaign handler is called once with the org, the conversation and the text", async () => {
    const calls: any[] = [];
    const prefs = {
      handleInboundKeyword: async () => ({ matched: false }),
      handleKeywordReply: async (...args: any[]) => { calls.push(args); return { matched: false }; },
    };
    const { svc, tables, conv } = build(prefs);
    await dispatch(svc, conv, tables, "OFFER");
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("org-1");
    expect(calls[0][1]).toMatchObject({ id: "conv-1", externalContactId: "8801712345678", customerId: "cust-1" });
    expect(calls[0][2]).toBe("OFFER");
  });

  it("a throwing campaign handler does not break ingest (message still classified + stored flow completes)", async () => {
    const prefs = {
      handleInboundKeyword: async () => ({ matched: false }),
      handleKeywordReply: async () => { throw new Error("campaign store exploded"); },
    };
    const { svc, tables, conv } = build(prefs);
    const msg = await dispatch(svc, conv, tables, "OFFER");
    // Ingest completed past the hook: the intent classification
    // update (which runs AFTER the keyword hooks) landed.
    const stored = tables.channelMessage.rows.find((m: any) => m.id === msg.id);
    expect(stored.intent).toBeDefined();
  });

  it("a throwing preference hook also cannot reach the campaign handler with an unknown state — and ingest survives", async () => {
    const calls: any[] = [];
    const prefs = {
      handleInboundKeyword: async () => { throw new Error("preference store down"); },
      handleKeywordReply: async (...args: any[]) => { calls.push(args); return { matched: false }; },
    };
    const { svc, tables, conv } = build(prefs);
    // The dispatch itself must not throw.
    await dispatch(svc, conv, tables, "OFFER");
    // The hook result was swallowed to undefined → treated as
    // "not matched" by the chain (the campaign handler runs, as
    // for any non-keyword message). The EXCLUSIVITY guarantee
    // does not rest on this fallback: MessagingService
    // .handleKeywordReply itself refuses reserved keywords, so
    // even here a STOP text could never produce a campaign hit
    // (pinned in the messaging MX6 spec).
    expect(calls).toHaveLength(1);
  });

  it("registration: onModuleInit registers an inbox-reply port whose send goes through the conversation path", async () => {
    let registered: any = null;
    const prefs = {
      registerInboxReplyPort: (port: any) => { registered = port; },
      handleInboundKeyword: async () => ({ matched: false }),
      handleKeywordReply: async () => ({ matched: false }),
    };
    const { svc, tables } = build(prefs);
    svc.onModuleInit();
    expect(registered).toBeTruthy();
    expect(typeof registered.sendConversationText).toBe("function");
    // A webchat conversation's deliverText needs no Meta
    // integration — the port send resolves with the synthetic
    // web id and the stored message is marked sent.
    tables.channelConversation.rows.push({
      id: "conv-web", organizationId: "org-1", channel: "webchat", status: "open",
      externalContactId: "visitor-1", tags: [],
    });
    const out = await registered.sendConversationText("org-1", "conv-web", "ধন্যবাদ!");
    expect(out.providerMessageId).toContain("web-");
    const stored = tables.channelMessage.rows.find((m: any) => m.conversationId === "conv-web" && m.direction === "out");
    expect(stored).toBeTruthy();
    expect(stored.content).toBe("ধন্যবাদ!");
    expect(stored.autoReply).toBe(true);
    expect(JSON.parse(stored.autoReplyEvidence)).toEqual({ via: "keyword_campaign" });
    expect(stored.status).toBe("sent");
  });
});
