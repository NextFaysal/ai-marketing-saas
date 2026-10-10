import { createHmac } from "crypto";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.DISABLE_SCHEDULER = "true";

import { InboxService } from "./inbox.service";
import { MessagingService } from "../messaging/messaging.service";
import { LeadsService } from "../crm/leads.service";
import { encryptJson } from "../integrations/crypto";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

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
      if ("has" in v) return Array.isArray(row[k]) && row[k].includes(v.has);
      if ("contains" in v) {
        const hay = String(row[k] ?? "");
        return v.mode === "insensitive" ? hay.toLowerCase().includes(String(v.contains).toLowerCase()) : hay.includes(v.contains);
      }
      return true;
    }
    return row[k] === v;
  });
}
function makeTable(name: string, tables: any) {
  const rows: any[] = [];
  let seq = 0;
  const applyOrder = (list: any[], orderBy: any) => {
    if (!orderBy) return list;
    const [key, dir] = Object.entries(orderBy)[0] as [string, string];
    return [...list].sort((a, b) => {
      const av = a[key] instanceof Date ? a[key].getTime() : a[key];
      const bv = b[key] instanceof Date ? b[key].getTime() : b[key];
      return dir === "desc" ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1);
    });
  };
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where ?? {}, tables)) ?? null,
    findMany: async ({ where, take, orderBy }: any = {}) => {
      const f = applyOrder(rows.filter((r) => matches(r, where ?? {}, tables)), orderBy);
      return take ? f.slice(0, take) : f;
    },
    findUnique: async ({ where }: any) => rows.find((r) => matches(r, where ?? {}, tables)) ?? null,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where ?? {}, tables));
      if (!row) return null;
      for (const [k, v] of Object.entries(data)) {
        if (v !== null && typeof v === "object" && "increment" in (v as any)) (row as any)[k] = ((row as any)[k] ?? 0) + (v as any).increment;
        else (row as any)[k] = v;
      }
      return row;
    },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => matches(r, where ?? {}, tables)); return rows.splice(i, 1)[0]; },
  };
}
const TABLE_NAMES = ["integration", "channelConversation", "channelMessage", "conversationNote", "quickReply", "whatsAppTemplate", "lead", "leadActivity", "customer", "order", "orderItem", "membership", "messageDraft", "inboxSetting", "businessPolicy", "product", "productVariant", "broadcast", "messageDelivery", "messageTemplate", "aIUsageRecord"];
function fakePrisma() {
  const tables: Record<string, any> = {};
  for (const name of TABLE_NAMES) tables[name] = makeTable(name, tables);
  tables.businessProfile = { findUnique: async () => ({ industry: "fashion", description: "Clothing store", brandVoice: "friendly" }) };
  const waSecrets = encryptJson({ accessToken: "tok", appSecret: "appsecret", verifyToken: "vtok", phoneNumberId: "999" });
  tables.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: "whatsapp", status: "CONNECTED", credential: { encryptedData: waSecrets } });
  tables.product.rows.push({ id: "p1", organizationId: "org-1", status: "ACTIVE", name: "Cotton Panjabi", priceMinor: 150000n, currency: "BDT", stockQuantity: 12, source: "manual", externalId: null, sku: "PAN-1" });
  tables.whatsAppTemplate.rows.push({ id: "wt-1", organizationId: "org-1", name: "eid_offer", language: "bn", category: "MARKETING", bodyText: "ঈদ অফার! {{1}}" });
  return tables;
}
const llmStub = { getProvider: () => new DevTemplateProvider() } as any;
const auditStub = { log: async () => undefined } as any;
const sign = (body: string) => "sha256=" + createHmac("sha256", "appsecret").update(body, "utf8").digest("hex");
const waText = (from: string, id: string, body: string, name = "Karim") => JSON.stringify({
  object: "whatsapp_business_account",
  entry: [{ changes: [{ value: {
    contacts: [{ profile: { name }, wa_id: from }],
    messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }],
  } }] }],
});
async function inbound(svc: InboxService, from: string, id: string, body: string) {
  const raw = waText(from, id, body);
  await svc.handleWebhook("int-1", raw, sign(raw));
}

describe("M14 WhatsApp template broadcast", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });
  function setup(tables: any) {
    tables.customer.rows.push(
      { id: "cu-1", organizationId: "org-1", firstName: "Rahim", lastName: null, phone: "01711111111", email: null },
      { id: "cu-2", organizationId: "org-1", firstName: "Bad", lastName: null, phone: "123", email: null },
    );
    const messaging = new MessagingService(tables as any, auditStub, { send: async () => ({ providerMessageId: "x" }) } as any, { send: async () => ({ providerMessageId: "y" }) } as any);
    return messaging;
  }
  it("requires a registered template and snapshots its body", async () => {
    const tables = fakePrisma();
    const messaging = setup(tables);
    await expect(messaging.createBroadcast("org-1", "owner", { name: "B", channel: "whatsapp", audienceType: "customers" })).rejects.toThrow("registered template");
    const b = await messaging.createBroadcast("org-1", "owner", { name: "ঈদ", channel: "whatsapp", whatsappTemplateId: "wt-1", templateParams: ["{name}"], audienceType: "customers" });
    expect(b.body).toContain("ঈদ অফার");
  });
  it("sends per recipient with Meta ids; bad phone fails honestly (partial)", async () => {
    const tables = fakePrisma();
    const messaging = setup(tables);
    global.fetch = (async () => new Response(JSON.stringify({ messages: [{ id: "wamid.bc1" }] }), { status: 200 })) as any;
    const b = await messaging.createBroadcast("org-1", "owner", { name: "ঈদ", channel: "whatsapp", whatsappTemplateId: "wt-1", templateParams: ["{name}"], audienceType: "customers" });
    const sent = await messaging.sendBroadcast("org-1", "owner", b.id);
    expect(sent.status).toBe("partial");
    expect(sent.sentCount).toBe(1);
    expect(sent.failedCount).toBe(1);
    const ok = tables.messageDelivery.rows.find((d: any) => d.status === "sent");
    expect(ok.providerMessageId).toBe("wamid.bc1");
    expect(ok.channel).toBe("whatsapp");
  });
});

describe("M14 spam suspicion", () => {
  it("flags 3 identical messages in 10 minutes, and promo-link first contact", async () => {
    const tables = fakePrisma();
    const svc = new InboxService(tables as any, auditStub, llmStub);
    for (let i = 0; i < 3; i++) await inbound(svc, "8801777777777", `wamid.sp${i}`, "একই অফার বারবার");
    expect(tables.channelConversation.rows[0].spamFlag).toBe(true);
    await inbound(svc, "8801788888888", "wamid.sp9", "অভিনন্দন! আপনি জিতেছেন ফ্রি পুরস্কার, ক্লিক করুন https://scam.example.com");
    const promo = tables.channelConversation.rows.find((c: any) => c.externalContactId === "8801788888888");
    expect(promo.spamFlag).toBe(true);
    expect(promo.spamReason).toContain("লিংক");
  });
  it("does not flag normal conversation", async () => {
    const tables = fakePrisma();
    const svc = new InboxService(tables as any, auditStub, llmStub);
    await inbound(svc, "8801799999999", "wamid.ok1", "আসসালামু আলাইকুম, দাম জানতে চাই");
    expect(tables.channelConversation.rows[0].spamFlag).toBeFalsy();
  });
});

describe("M14 CSAT flow", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });
  it("asks once on close and records a Bengali-digit rating", async () => {
    const tables = fakePrisma();
    tables.channelConversation.rows.push({
      id: "conv-1", organizationId: "org-1", integrationId: "int-1", channel: "whatsapp", externalContactId: "8801711111111",
      contactName: "Karim", contactPhone: "8801711111111", customerId: null, leadId: null, status: "open", assignedUserId: null,
      tags: [], unreadCount: 1, lastMessageAt: new Date(), lastCustomerMessageAt: new Date(), lastMessagePreview: "", firstResponseAt: new Date(), csatSentAt: null, csatRating: null,
    });
    tables.channelMessage.rows.push({ id: "m-in", conversationId: "conv-1", direction: "in", type: "text", content: "ধন্যবাদ", status: "received", createdAt: new Date() });
    global.fetch = (async () => new Response(JSON.stringify({ messages: [{ id: "wamid.csat" }] }), { status: 200 })) as any;
    const svc = new InboxService(tables as any, auditStub, llmStub);
    await svc.updateConversation("org-1", "agent-1", "conv-1", { status: "closed" });
    expect(tables.channelConversation.rows[0].csatSentAt).toBeTruthy();
    const asked = tables.channelMessage.rows.filter((m: any) => m.direction === "out").length;
    await svc.updateConversation("org-1", "agent-1", "conv-1", { status: "open" });
    await svc.updateConversation("org-1", "agent-1", "conv-1", { status: "closed" });
    expect(tables.channelMessage.rows.filter((m: any) => m.direction === "out").length).toBe(asked); // asked only once
    await inbound(svc, "8801711111111", "wamid.rate", "৫");
    expect(tables.channelConversation.rows[0].csatRating).toBe(5);
  });
});

describe("M14 order from chat", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });
  function conv(tables: any) {
    tables.channelConversation.rows.push({
      id: "conv-1", organizationId: "org-1", integrationId: "int-1", channel: "whatsapp", externalContactId: "8801711111111",
      contactName: "Karim", contactPhone: "8801711111111", customerId: null, leadId: null, status: "open", assignedUserId: null,
      tags: [], unreadCount: 0, lastMessageAt: new Date(), lastCustomerMessageAt: new Date(), lastMessagePreview: "",
    });
  }
  it("creates a local order with real prices and a chat customer", async () => {
    const tables = fakePrisma(); conv(tables);
    const svc = new InboxService(tables as any, auditStub, llmStub);
    const order = await svc.createChatOrder("org-1", "agent-1", "conv-1", { items: [{ productId: "p1", quantity: 2 }], shippingMinor: 6000 });
    expect(order.source).toBe("chat");
    expect(order.totalMinor).toBe("306000");
    expect(order.storeSyncStatus).toBe("local_only");
    expect(order.items).toHaveLength(1);
    expect(tables.channelConversation.rows[0].customerId).toBeTruthy();
  });
  it("pushes to WooCommerce when connected and records the store id", async () => {
    const tables = fakePrisma(); conv(tables);
    tables.product.rows[0].source = "woocommerce";
    tables.product.rows[0].externalId = "501";
    const wooSecrets = encryptJson({ consumerKey: "ck", consumerSecret: "cs" });
    tables.integration.rows.push({ id: "int-woo", organizationId: "org-1", provider: "woocommerce", status: "CONNECTED", credential: { encryptedData: wooSecrets }, store: { id: "st-1", url: "https://shop.example.com" } });
    global.fetch = (async (url: any) => {
      if (String(url).includes("/wp-json/wc/v3/orders")) return new Response(JSON.stringify({ id: 9001, number: "9001" }), { status: 201 });
      return new Response("{}", { status: 200 });
    }) as any;
    const svc = new InboxService(tables as any, auditStub, llmStub);
    const order = await svc.createChatOrder("org-1", "agent-1", "conv-1", { items: [{ productId: "p1", quantity: 1 }] });
    expect(order.storeSyncStatus).toBe("synced");
    expect(order.externalId).toBe("9001");
  });
  it("records a failed push honestly and keeps the local order", async () => {
    const tables = fakePrisma(); conv(tables);
    tables.product.rows[0].source = "woocommerce";
    tables.product.rows[0].externalId = "501";
    const wooSecrets = encryptJson({ consumerKey: "ck", consumerSecret: "cs" });
    tables.integration.rows.push({ id: "int-woo", organizationId: "org-1", provider: "woocommerce", status: "CONNECTED", credential: { encryptedData: wooSecrets }, store: { id: "st-1", url: "https://shop.example.com" } });
    global.fetch = (async () => new Response("store down", { status: 500 })) as any;
    const svc = new InboxService(tables as any, auditStub, llmStub);
    const order = await svc.createChatOrder("org-1", "agent-1", "conv-1", { items: [{ productId: "p1", quantity: 1 }] });
    expect(order.storeSyncStatus).toBe("failed");
    expect(order.storeSyncError).toContain("500");
  });
});

describe("M14 translate + summary honesty", () => {
  it("refuses translation without a real LLM instead of faking it", async () => {
    const tables = fakePrisma();
    tables.channelConversation.rows.push({ id: "conv-1", organizationId: "org-1", integrationId: "int-1", channel: "whatsapp", externalContactId: "x", status: "open", tags: [] });
    tables.channelMessage.rows.push({ id: "m1", conversationId: "conv-1", direction: "in", type: "text", content: "আমার অর্ডার কোথায়?", status: "received", createdAt: new Date() });
    const svc = new InboxService(tables as any, auditStub, llmStub);
    await expect(svc.translateMessage("org-1", "conv-1", "m1", "en")).rejects.toThrow("আসল LLM");
  });
  it("dev summary is a labeled data digest stored on the conversation", async () => {
    const tables = fakePrisma();
    tables.channelConversation.rows.push({ id: "conv-1", organizationId: "org-1", integrationId: "int-1", channel: "whatsapp", externalContactId: "x", status: "open", tags: [], csatRating: null });
    tables.channelMessage.rows.push(
      { id: "m1", conversationId: "conv-1", direction: "in", type: "text", content: "দাম কত?", status: "received", intent: "price", createdAt: new Date(1) },
      { id: "m2", conversationId: "conv-1", direction: "out", type: "text", content: "BDT 1500", status: "sent", createdAt: new Date(2) },
    );
    const svc = new InboxService(tables as any, auditStub, llmStub);
    const out = await svc.summarizeConversation("org-1", "agent-1", "conv-1");
    expect(out.summaryProvider).toBe("dev-template");
    expect(out.summaryText).toContain("ডেটা-ভিত্তিক সারসংক্ষেপ");
    expect(tables.channelConversation.rows[0].summaryText).toBeTruthy();
  });
});

describe("M14 lead merge", () => {
  function setup() {
    const tables = fakePrisma();
    tables.lead.rows.push(
      { id: "lead-a", organizationId: "org-1", name: "Karim", phone: "+880 1711-111111", stage: "qualified", source: "messenger", tags: ["vip"], valueMinor: 0n, createdAt: new Date(), updatedAt: new Date(), mergedIntoId: null },
      { id: "lead-b", organizationId: "org-1", name: "Karim Islam", phone: "01711111111", stage: "new", source: "whatsapp", tags: ["cod"], valueMinor: 0n, createdAt: new Date(), updatedAt: new Date(), mergedIntoId: null },
    );
    tables.leadActivity.rows.push({ id: "act-1", leadId: "lead-b", type: "note", content: "called" });
    tables.channelConversation.rows.push({ id: "conv-b", organizationId: "org-1", leadId: "lead-b", channel: "whatsapp", status: "open", tags: [] });
    return { tables, svc: new LeadsService(tables as any) };
  }
  it("finds duplicates by phone and merges history into the target", async () => {
    const { tables, svc } = setup();
    const dups = await svc.duplicates("org-1");
    expect(dups).toHaveLength(1);
    expect(dups[0].leads).toHaveLength(2);
    const target = await svc.merge("org-1", "owner", "lead-a", "lead-b");
    expect(target.id).toBe("lead-a");
    expect(tables.leadActivity.rows.find((a: any) => a.id === "act-1").leadId).toBe("lead-a");
    expect(tables.channelConversation.rows[0].leadId).toBe("lead-a");
    expect(tables.lead.rows.find((l: any) => l.id === "lead-b").mergedIntoId).toBe("lead-a");
    expect([...(target.tags ?? [])].sort()).toEqual(["cod", "vip"]);
    const list = await svc.list("org-1");
    expect(list.map((l: any) => l.id)).toEqual(["lead-a"]);
    await expect(svc.merge("org-1", "owner", "lead-a", "lead-b")).rejects.toThrow("already merged");
  });
});
