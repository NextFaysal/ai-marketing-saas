/**
 * IN6 — message lifecycle: delivery/read status, quote, reactions, pin.
 *
 * Covers: the monotonic delivery patch (a late "delivered" never
 * overwrites "read"; "failed" never resurrects; unknown statuses
 * are dropped); the parser (WhatsApp statuses with timestamps,
 * WhatsApp reaction messages NOT landing as chat messages,
 * Messenger reaction events, Messenger read watermarks, quote
 * context on inbound); webhook application end-to-end (statuses
 * land in deliveryStatus + deliveredAt/readAt, reactions stored,
 * watermark marks only that conversation's older outbound rows);
 * quote validation (same-conversation only, cross-thread = 400);
 * pin org-scope + audit; agent reaction (Messenger-only, stored
 * ONLY after Meta confirms — a Meta failure stores nothing);
 * webchat visitor read (listMessages is the real read path).
 */
import { createHash, createHmac } from "crypto";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { InboxService } from "./inbox.service";
import { WebchatService } from "./webchat.service";
import { parseMetaWebhook } from "./webhook.parser";
import { MetaMessagingClient } from "./meta-messaging.client";
import { applyReaction, nextDeliveryPatch, parseReactions, reactionEmoji } from "./message-lifecycle";
import { encryptJson } from "../integrations/crypto";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

const llmStub = { getProvider: () => new DevTemplateProvider() } as any;

// ---------- pure helpers ----------

describe("IN6 nextDeliveryPatch (monotonic)", () => {
  const at = new Date("2026-10-12T10:00:00Z");
  it("applies forward steps and stamps times", () => {
    expect(nextDeliveryPatch({ deliveryStatus: null, status: "sent" }, "delivered", at))
      .toEqual({ deliveryStatus: "delivered", status: "delivered", deliveredAt: at });
    expect(nextDeliveryPatch({ deliveryStatus: "delivered" }, "read", at))
      .toEqual({ deliveryStatus: "read", status: "read", deliveredAt: at, readAt: at });
    // sent → read directly (Meta can skip delivered): both stamps.
    expect(nextDeliveryPatch({ deliveryStatus: "sent" }, "read", at))
      .toEqual({ deliveryStatus: "read", status: "read", deliveredAt: at, readAt: at });
  });
  it("never regresses: delivered after read, duplicate sent, read after read", () => {
    expect(nextDeliveryPatch({ deliveryStatus: "read" }, "delivered", at)).toBeNull();
    expect(nextDeliveryPatch({ deliveryStatus: "read" }, "sent", at)).toBeNull();
    expect(nextDeliveryPatch({ deliveryStatus: "sent" }, "sent", at)).toBeNull();
    expect(nextDeliveryPatch({ deliveryStatus: "delivered" }, "delivered", at)).toBeNull();
  });
  it("failed applies from non-read states, never overwrites read, never resurrects", () => {
    expect(nextDeliveryPatch({ deliveryStatus: "sent" }, "failed", at)?.deliveryStatus).toBe("failed");
    expect(nextDeliveryPatch({ deliveryStatus: "delivered" }, "failed", at)?.deliveryStatus).toBe("failed");
    expect(nextDeliveryPatch({ deliveryStatus: "read" }, "failed", at)).toBeNull();
    expect(nextDeliveryPatch({ deliveryStatus: "failed" }, "delivered", at)).toBeNull();
    expect(nextDeliveryPatch({ deliveryStatus: "failed" }, "failed", at)).toBeNull();
  });
  it("drops unknown statuses", () => {
    expect(nextDeliveryPatch({ deliveryStatus: null }, "exploded", at)).toBeNull();
    expect(nextDeliveryPatch({ deliveryStatus: null }, "", at)).toBeNull();
  });
});

describe("IN6 reactions helpers", () => {
  const at = new Date("2026-10-12T10:00:00Z");
  it("one reaction per actor: a new emoji replaces, unreact removes", () => {
    let list = applyReaction(null, { emoji: "❤️", actor: "customer", action: "react", at });
    expect(list).toHaveLength(1);
    list = applyReaction(list, { emoji: "👍", actor: "customer", action: "react", at });
    expect(list).toEqual([{ emoji: "👍", actor: "customer", at: at.toISOString() }]);
    list = applyReaction(list, { emoji: "😆", actor: "page", action: "react", at });
    expect(list).toHaveLength(2);
    list = applyReaction(list, { emoji: null, actor: "customer", action: "unreact", at });
    expect(list).toEqual([{ emoji: "😆", actor: "page", at: at.toISOString() }]);
  });
  it("parses stored JSON defensively", () => {
    expect(parseReactions('[{"emoji":"❤️","actor":"customer"}]')).toHaveLength(1);
    expect(parseReactions("junk")).toEqual([]);
    expect(parseReactions([{ emoji: 1, actor: "customer" }])).toEqual([]);
  });
  it("normalizes named Messenger reactions, prefers literal emoji", () => {
    expect(reactionEmoji(null, "love")).toBe("❤️");
    expect(reactionEmoji("🎉", "love")).toBe("🎉");
    expect(reactionEmoji(null, "other")).toBeNull();
    expect(reactionEmoji(null, null)).toBeNull();
  });
});

// ---------- parser ----------

describe("IN6 parseMetaWebhook", () => {
  it("WhatsApp: statuses carry their timestamp; a reaction message is NOT a chat message", () => {
    const parsed = parseMetaWebhook({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ value: {
        messages: [
          { from: "8801", id: "wamid.r1", timestamp: "1728000000", type: "reaction", reaction: { message_id: "wamid.out1", emoji: "❤️" } },
          { from: "8801", id: "wamid.t1", timestamp: "1728000001", type: "text", text: { body: "হাই" }, context: { id: "wamid.out0" } },
        ],
        statuses: [{ id: "wamid.out1", status: "read", timestamp: "1728000100" }],
      } }] }],
    });
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0].replyToExternalId).toBe("wamid.out0");
    expect(parsed.reactions).toEqual([expect.objectContaining({ channel: "whatsapp", externalId: "wamid.out1", emoji: "❤️", action: "react" })]);
    expect(parsed.statuses[0]).toMatchObject({ externalId: "wamid.out1", status: "read" });
    expect(parsed.statuses[0].at?.getTime()).toBe(1728000100_000);
  });
  it("WhatsApp: an empty-emoji reaction is an unreact", () => {
    const parsed = parseMetaWebhook({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ value: { messages: [{ from: "8801", id: "wamid.r2", timestamp: "1728000000", type: "reaction", reaction: { message_id: "wamid.out1", emoji: "" } }] } }] }],
    });
    expect(parsed.reactions[0].action).toBe("unreact");
    expect(parsed.messages).toHaveLength(0);
  });
  it("Messenger: reaction event, delivery mids, read watermark", () => {
    const parsed = parseMetaWebhook({
      object: "page",
      entry: [{ messaging: [
        { sender: { id: "psid-1" }, timestamp: 1728000000000, reaction: { reaction: "love", emoji: "❤️", action: "react", mid: "mid.1" } },
        { sender: { id: "psid-1" }, timestamp: 1728000001000, delivery: { mids: ["mid.2"], watermark: 1728000001000 } },
        { sender: { id: "psid-1" }, timestamp: 1728000002000, read: { watermark: 1728000002000 } },
        { sender: { id: "psid-1" }, timestamp: 1728000003000, message: { mid: "mid.3", text: "ok", reply_to: { mid: "mid.0" } } },
      ] }],
    });
    expect(parsed.reactions).toEqual([expect.objectContaining({ externalId: "mid.1", emoji: "❤️", named: "love", action: "react" })]);
    expect(parsed.statuses).toEqual([expect.objectContaining({ externalId: "mid.2", status: "delivered" })]);
    expect(parsed.readWatermarks).toEqual([expect.objectContaining({ externalContactId: "psid-1" })]);
    expect(parsed.readWatermarks[0].watermark.getTime()).toBe(1728000002000);
    expect(parsed.messages[0].replyToExternalId).toBe("mid.0");
  });
});

// ---------- Meta client ----------

describe("IN6 MetaMessagingClient", () => {
  function capturing(response: any) {
    const calls: any[] = [];
    const fetchFn = async (url: string, init?: any) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      return { ok: true, status: 200, json: async () => response } as any;
    };
    return { calls, client: new MetaMessagingClient({ accessToken: "tok", phoneNumberId: "999" }, fetchFn as any) };
  }
  it("WhatsApp quote rides context.message_id; no quote = no context key", async () => {
    const { calls, client } = capturing({ messages: [{ id: "wamid.x" }] });
    await client.sendWhatsAppText("8801", "উত্তর", "wamid.q");
    expect(calls[0].body.context).toEqual({ message_id: "wamid.q" });
    await client.sendWhatsAppText("8801", "উত্তর");
    expect("context" in calls[1].body).toBe(false);
  });
  it("Messenger quote rides reply_to.mid", async () => {
    const { calls, client } = capturing({ message_id: "mid.x", recipient_id: "psid-1" });
    await client.sendMessengerText("psid-1", "উত্তর", "mid.q");
    expect(calls[0].body.reply_to).toEqual({ mid: "mid.q" });
  });
  it("reaction send uses sender_action react/unreact with the target mid", async () => {
    const { calls, client } = capturing({ recipient_id: "psid-1" });
    await client.sendMessengerReaction("psid-1", "mid.1", "❤️");
    expect(calls[0].body).toEqual({ recipient: { id: "psid-1" }, sender_action: "react", payload: { message_id: "mid.1", reaction: "❤️" } });
    await client.sendMessengerReaction("psid-1", "mid.1", null);
    expect(calls[1].body).toEqual({ recipient: { id: "psid-1" }, sender_action: "unreact", payload: { message_id: "mid.1" } });
  });
  it("reaction send throws Meta's verbatim error and on a missing recipient_id", async () => {
    const failing = new MetaMessagingClient({ accessToken: "tok" }, (async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "Invalid message_id" } }) })) as any);
    await expect(failing.sendMessengerReaction("psid-1", "mid.x", "❤️")).rejects.toThrow("Invalid message_id");
    const silent = new MetaMessagingClient({ accessToken: "tok" }, (async () => ({ ok: true, status: 200, json: async () => ({}) })) as any);
    await expect(silent.sendMessengerReaction("psid-1", "mid.x", "❤️")).rejects.toThrow("NOT applied");
  });
});

// ---------- service (fake prisma) ----------

function matches(row: any, where: any, tables: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (k === "conversation") {
      const conv = tables.channelConversation.rows.find((c: any) => c.id === row.conversationId);
      return Boolean(conv) && matches(conv, v, tables);
    }
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("not" in v) return row[k] !== v.not;
      if ("in" in v) return v.in.includes(row[k]);
      if ("lte" in v) return new Date(row[k]).getTime() <= new Date(v.lte).getTime();
      if ("gte" in v) return new Date(row[k]).getTime() >= new Date(v.gte).getTime();
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
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where, tables)) ?? null,
    findMany: async ({ where, take, orderBy }: any = {}) => {
      let f = rows.filter((r) => matches(r, where, tables));
      if (orderBy?.createdAt === "desc") f = [...f].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return take ? f.slice(0, take) : f;
    },
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
    count: async ({ where }: any = {}) => rows.filter((r) => matches(r, where, tables)).length,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      for (const [k, v] of Object.entries(data)) {
        if (v !== null && typeof v === "object" && "increment" in (v as any)) (row as any)[k] = ((row as any)[k] ?? 0) + (v as any).increment;
        else (row as any)[k] = v;
      }
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      const hit = rows.filter((r) => matches(r, where, tables));
      for (const r of hit) Object.assign(r, data);
      return { count: hit.length };
    },
  };
}
function fakePrisma() {
  const tables: Record<string, any> = {};
  for (const name of ["integration", "channelConversation", "channelMessage", "lead", "leadActivity", "customer", "membership", "businessPolicy", "product", "messageDraft", "aIUsageRecord", "inboxSetting", "organization"]) {
    tables[name] = makeTable(name, tables);
  }
  tables.businessProfile = { findUnique: async () => ({ industry: "fashion", description: "Clothing", brandVoice: "friendly" }) };
  const waSecrets = encryptJson({ accessToken: "tok", appSecret: "appsecret", verifyToken: "vtok", phoneNumberId: "999" });
  const msSecrets = encryptJson({ accessToken: "tok", appSecret: "appsecret", verifyToken: "vtok", pageId: "pg1" });
  tables.integration.rows.push(
    { id: "int-wa", organizationId: "org-1", provider: "whatsapp", status: "CONNECTED", credential: { encryptedData: waSecrets } },
    { id: "int-ms", organizationId: "org-1", provider: "messenger", status: "CONNECTED", credential: { encryptedData: msSecrets } },
  );
  return tables;
}
const auditCalls: any[] = [];
const auditStub = { log: async (input: any) => { auditCalls.push(input); } } as any;
const sign = (body: string) => "sha256=" + createHmac("sha256", "appsecret").update(body, "utf8").digest("hex");

function seedOutbound(tables: any, over: any = {}) {
  const conv = { id: "c-wa", organizationId: "org-1", integrationId: "int-wa", channel: "whatsapp", externalContactId: "8801", status: "open", unreadCount: 0, ...over.conv };
  tables.channelConversation.rows.push(conv);
  const msg = {
    id: "m-out", conversationId: conv.id, direction: "out", type: "text", content: "হ্যালো",
    status: "sent", externalId: "wamid.out1", deliveryStatus: null, deliveredAt: null, readAt: null,
    reactions: null, pinnedAt: null, pinnedBy: null, createdAt: new Date("2026-10-12T09:00:00Z"), ...over.msg,
  };
  tables.channelMessage.rows.push(msg);
  return { conv, msg };
}

describe("IN6 handleWebhook delivery statuses", () => {
  const waStatus = (status: string, tsSec = 1728000100) => JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: { statuses: [{ id: "wamid.out1", status, timestamp: String(tsSec) }] } }] }],
  });
  it("delivered then read land with stamps; a late delivered does NOT regress read", async () => {
    const tables = fakePrisma();
    const { msg } = seedOutbound(tables);
    const svc = new InboxService(tables as any, auditStub, llmStub);
    let res = await svc.handleWebhook("int-wa", waStatus("delivered"), sign(waStatus("delivered")));
    expect(res.statusesApplied).toBe(1);
    expect(msg.deliveryStatus).toBe("delivered");
    expect(msg.deliveredAt?.getTime()).toBe(1728000100_000);
    res = await svc.handleWebhook("int-wa", waStatus("read", 1728000200), sign(waStatus("read", 1728000200)));
    expect(res.statusesApplied).toBe(1);
    expect(msg.deliveryStatus).toBe("read");
    expect(msg.readAt?.getTime()).toBe(1728000200_000);
    expect(msg.deliveredAt?.getTime()).toBe(1728000100_000); // first stamp kept
    res = await svc.handleWebhook("int-wa", waStatus("delivered", 1728000300), sign(waStatus("delivered", 1728000300)));
    expect(res.statusesApplied).toBe(0);
    expect(msg.deliveryStatus).toBe("read");
  });
  it("failed applies, then a positive status never resurrects it", async () => {
    const tables = fakePrisma();
    const { msg } = seedOutbound(tables);
    const svc = new InboxService(tables as any, auditStub, llmStub);
    await svc.handleWebhook("int-wa", waStatus("failed"), sign(waStatus("failed")));
    expect(msg.deliveryStatus).toBe("failed");
    expect(msg.status).toBe("failed");
    const res = await svc.handleWebhook("int-wa", waStatus("delivered"), sign(waStatus("delivered")));
    expect(res.statusesApplied).toBe(0);
    expect(msg.deliveryStatus).toBe("failed");
  });
  it("a status for another org's message is not applied", async () => {
    const tables = fakePrisma();
    const { msg } = seedOutbound(tables, { conv: { organizationId: "org-2" } });
    const svc = new InboxService(tables as any, auditStub, llmStub);
    const res = await svc.handleWebhook("int-wa", waStatus("read"), sign(waStatus("read")));
    expect(res.statusesApplied).toBe(0);
    expect(msg.deliveryStatus).toBeNull();
  });
});

describe("IN6 handleWebhook reactions + watermark", () => {
  it("stores a customer reaction on the reacted row; unreact removes it", async () => {
    const tables = fakePrisma();
    const { msg } = seedOutbound(tables, { conv: { id: "c-ms", integrationId: "int-ms", channel: "messenger", externalContactId: "psid-1" }, msg: { externalId: "mid.1" } });
    const svc = new InboxService(tables as any, auditStub, llmStub);
    const react = JSON.stringify({ object: "page", entry: [{ messaging: [{ sender: { id: "psid-1" }, timestamp: 1728000000000, reaction: { reaction: "love", emoji: "❤️", action: "react", mid: "mid.1" } }] }] });
    const res = await svc.handleWebhook("int-ms", react, sign(react));
    expect(res.reactionsApplied).toBe(1);
    expect(parseReactions(msg.reactions)).toEqual([expect.objectContaining({ emoji: "❤️", actor: "customer" })]);
    const unreact = JSON.stringify({ object: "page", entry: [{ messaging: [{ sender: { id: "psid-1" }, timestamp: 1728000001000, reaction: { reaction: "love", emoji: "❤️", action: "unreact", mid: "mid.1" } }] }] });
    await svc.handleWebhook("int-ms", unreact, sign(unreact));
    expect(parseReactions(msg.reactions)).toEqual([]);
  });
  it("WhatsApp reaction lands on the row and never creates a chat message", async () => {
    const tables = fakePrisma();
    const { msg } = seedOutbound(tables);
    const svc = new InboxService(tables as any, auditStub, llmStub);
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages: [{ from: "8801", id: "wamid.r9", timestamp: "1728000000", type: "reaction", reaction: { message_id: "wamid.out1", emoji: "👍" } }] } }] }] });
    const res = await svc.handleWebhook("int-wa", body, sign(body));
    expect(res.received).toBe(0);
    expect(res.reactionsApplied).toBe(1);
    expect(parseReactions(msg.reactions)).toEqual([expect.objectContaining({ emoji: "👍", actor: "customer" })]);
    expect(tables.channelMessage.rows).toHaveLength(1);
  });
  it("read watermark marks only that conversation's outbound rows at/before it", async () => {
    const tables = fakePrisma();
    seedOutbound(tables, { conv: { id: "c-ms", integrationId: "int-ms", channel: "messenger", externalContactId: "psid-1" }, msg: { id: "m-old", externalId: "mid.old", createdAt: new Date(1728000001000) } });
    const newer = { id: "m-new", conversationId: "c-ms", direction: "out", type: "text", content: "পরে", status: "sent", externalId: "mid.new", deliveryStatus: null, deliveredAt: null, readAt: null, createdAt: new Date(1728000009000) };
    tables.channelMessage.rows.push(newer);
    const svc = new InboxService(tables as any, auditStub, llmStub);
    const body = JSON.stringify({ object: "page", entry: [{ messaging: [{ sender: { id: "psid-1" }, timestamp: 1728000002000, read: { watermark: 1728000002000 } }] }] });
    await svc.handleWebhook("int-ms", body, sign(body));
    const old = tables.channelMessage.rows.find((r: any) => r.id === "m-old");
    expect(old.deliveryStatus).toBe("read");
    expect(old.readAt?.getTime()).toBe(1728000002000);
    expect(newer.deliveryStatus).toBeNull();
  });
  it("inbound quote context resolves to our row in the same conversation", async () => {
    const tables = fakePrisma();
    seedOutbound(tables);
    const svc = new InboxService(tables as any, auditStub, llmStub);
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { contacts: [{ profile: { name: "Karim" }, wa_id: "8801" }], messages: [{ from: "8801", id: "wamid.in9", timestamp: "1728000500", type: "text", text: { body: "এটার দাম?" }, context: { id: "wamid.out1" } }] } }] }] });
    await svc.handleWebhook("int-wa", body, sign(body));
    const inbound = tables.channelMessage.rows.find((r: any) => r.externalId === "wamid.in9");
    expect(inbound.replyToMessageId).toBe("m-out");
  });
});

describe("IN6 quote validation on send", () => {
  function seedWebchat(tables: any) {
    tables.channelConversation.rows.push(
      { id: "c-web", organizationId: "org-1", integrationId: "int-web", channel: "webchat", externalContactId: "visitor-1", status: "open", unreadCount: 0 },
      { id: "c-web2", organizationId: "org-1", integrationId: "int-web", channel: "webchat", externalContactId: "visitor-2", status: "open", unreadCount: 0 },
    );
    tables.channelMessage.rows.push(
      { id: "m-in", conversationId: "c-web", direction: "in", type: "text", content: "দাম কত?", status: "received", externalId: "web-in-1", createdAt: new Date() },
      { id: "m-other", conversationId: "c-web2", direction: "in", type: "text", content: "অন্য থ্রেড", status: "received", externalId: "web-in-2", createdAt: new Date() },
    );
  }
  it("stores replyToMessageId for a same-conversation quote", async () => {
    const tables = fakePrisma();
    seedWebchat(tables);
    const svc = new InboxService(tables as any, auditStub, llmStub);
    const sent = await svc.sendReply("org-1", "user-1", "c-web", "১৫০০ টাকা", { replyToMessageId: "m-in" });
    expect(sent.replyToMessageId).toBe("m-in");
  });
  it("refuses a quote from another conversation (400, nothing sent)", async () => {
    const tables = fakePrisma();
    seedWebchat(tables);
    const svc = new InboxService(tables as any, auditStub, llmStub);
    await expect(svc.sendReply("org-1", "user-1", "c-web", "উত্তর", { replyToMessageId: "m-other" })).rejects.toThrow("অন্য থ্রেডের মেসেজ quote করা যাবে না");
    await expect(svc.sendReply("org-1", "user-1", "c-web", "উত্তর", { replyToMessageId: "missing" })).rejects.toThrow();
    expect(tables.channelMessage.rows.filter((r: any) => r.direction === "out")).toHaveLength(0);
  });
});

describe("IN6 pin", () => {
  it("pins/unpins with audit; a message from another conversation is 404", async () => {
    auditCalls.length = 0;
    const tables = fakePrisma();
    seedOutbound(tables);
    tables.channelConversation.rows.push({ id: "c-other", organizationId: "org-1", integrationId: "int-wa", channel: "whatsapp", externalContactId: "999", status: "open", unreadCount: 0 });
    const svc = new InboxService(tables as any, auditStub, llmStub);
    const pinned = await svc.setMessagePinned("org-1", "user-1", "c-wa", "m-out", true);
    expect(pinned.pinnedAt).toBeInstanceOf(Date);
    expect(pinned.pinnedBy).toBe("user-1");
    expect(auditCalls.some((a) => a.action === "inbox.message.pinned")).toBe(true);
    const unpinned = await svc.setMessagePinned("org-1", "user-1", "c-wa", "m-out", false);
    expect(unpinned.pinnedAt).toBeNull();
    await expect(svc.setMessagePinned("org-1", "user-1", "c-other", "m-out", true)).rejects.toThrow("not found");
    await expect(svc.setMessagePinned("org-2", "user-1", "c-wa", "m-out", true)).rejects.toThrow();
  });
});

describe("IN6 agent reaction (service)", () => {
  it("refuses WhatsApp honestly — no client call, nothing stored", async () => {
    const tables = fakePrisma();
    const { msg } = seedOutbound(tables);
    const svc = new InboxService(tables as any, auditStub, llmStub);
    await expect(svc.reactToMessage("org-1", "user-1", "c-wa", "m-out", "❤️")).rejects.toThrow("Messenger/Instagram");
    expect(msg.reactions).toBeNull();
  });
  it("Messenger: stores the page reaction only after Meta confirms", async () => {
    const tables = fakePrisma();
    const { msg } = seedOutbound(tables, { conv: { id: "c-ms", integrationId: "int-ms", channel: "messenger", externalContactId: "psid-1" }, msg: { externalId: "mid.1" } });
    const svc = new InboxService(tables as any, auditStub, llmStub);
    (global as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({ recipient_id: "psid-1" }) });
    const updated = await svc.reactToMessage("org-1", "user-1", "c-ms", "m-out", "❤️");
    expect(parseReactions(updated.reactions)).toEqual([expect.objectContaining({ emoji: "❤️", actor: "page" })]);
    // Meta failure → verbatim throw, stored state untouched.
    (global as any).fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "Invalid message_id" } }) });
    await expect(svc.reactToMessage("org-1", "user-1", "c-ms", "m-out", "👍")).rejects.toThrow("Invalid message_id");
    expect(parseReactions(msg.reactions)).toEqual([expect.objectContaining({ emoji: "❤️", actor: "page" })]);
  });
});

describe("IN6 webchat visitor read", () => {
  it("listMessages marks outbound rows read — the visitor's real read path", async () => {
    const tables: any = {
      widgetSite: makeTable("widgetSite", {}),
      liveChatSession: makeTable("liveChatSession", {}),
      channelMessage: makeTable("channelMessage", {}),
    };
    tables.widgetSite.rows.push({ id: "site-1", organizationId: "org-1", widgetKey: "wc_key", enabled: true });
    const token = "visitor-token";
    tables.liveChatSession.rows.push({ id: "sess-1", widgetSiteId: "site-1", conversationId: "c-web", visitorId: "v1", visitorTokenHash: createHash("sha256").update(token).digest("hex") });
    tables.channelMessage.rows.push(
      { id: "m-a", conversationId: "c-web", direction: "out", type: "text", content: "হ্যালো", status: "sent", deliveryStatus: null, deliveredAt: null, readAt: null, createdAt: new Date() },
      { id: "m-b", conversationId: "c-web", direction: "in", type: "text", content: "হাই", status: "received", deliveryStatus: null, createdAt: new Date() },
    );
    const inboxStub = { emitInboxEvent: () => undefined } as any;
    const svc = new WebchatService(tables as any, auditStub, inboxStub);
    const rows = await svc.listMessages("wc_key", token);
    expect(rows).toHaveLength(2);
    const out = tables.channelMessage.rows.find((r: any) => r.id === "m-a");
    expect(out.deliveryStatus).toBe("read");
    expect(out.readAt).toBeInstanceOf(Date);
    const inbound = tables.channelMessage.rows.find((r: any) => r.id === "m-b");
    expect(inbound.deliveryStatus).toBeNull();
  });
});
