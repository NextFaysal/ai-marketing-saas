import { createHmac } from "crypto";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

import { InboxService, normalizeTags, renderTemplatePreview } from "./inbox.service";
import { parseMetaWebhook } from "./webhook.parser";
import { encryptJson } from "../integrations/crypto";
import { DevTemplateProvider } from "../ai/llm/dev.provider";

// --- Fake Prisma with a matcher rich enough for the M12 queries ---
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
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      for (const [k, v] of Object.entries(data)) {
        if (v !== null && typeof v === "object" && "increment" in (v as any)) (row as any)[k] = ((row as any)[k] ?? 0) + (v as any).increment;
        else (row as any)[k] = v;
      }
      return row;
    },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); return rows.splice(i, 1)[0]; },
  };
}
function fakePrisma() {
  const tables: Record<string, any> = {};
  for (const name of ["integration", "channelConversation", "channelMessage", "conversationNote", "quickReply", "whatsAppTemplate", "lead", "leadActivity", "customer", "order", "membership", "messageDraft"]) {
    tables[name] = makeTable(name, tables);
  }
  const secrets = encryptJson({ accessToken: "tok", appSecret: "appsecret", verifyToken: "vtok", phoneNumberId: "999" });
  tables.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: "whatsapp", status: "CONNECTED", credential: { encryptedData: secrets } });
  return tables;
}
const llmStub = { getProvider: () => new DevTemplateProvider() } as any;
const auditStub = { log: async () => undefined } as any;
const sign = (body: string) => "sha256=" + createHmac("sha256", "appsecret").update(body, "utf8").digest("hex");

function seedConversation(tables: any, over: any = {}) {
  const conv = {
    id: "conv-1", organizationId: "org-1", integrationId: "int-1", channel: "whatsapp",
    externalContactId: "8801711111111", contactName: "Karim", contactPhone: "8801711111111",
    customerId: null, leadId: null, status: "open", assignedUserId: null, tags: [],
    unreadCount: 2, lastMessageAt: new Date(), lastCustomerMessageAt: new Date(),
    lastMessagePreview: "দাম কত?", ...over,
  };
  tables.channelConversation.rows.push(conv);
  return conv;
}

describe("M12 webhook parser media", () => {
  it("captures WhatsApp media id and caption", () => {
    const parsed = parseMetaWebhook({ entry: [{ changes: [{ value: { messages: [{ from: "8801", id: "w1", timestamp: "1728000000", type: "image", image: { id: "media-9", caption: "এইটা চাই" } }] } }] }] });
    expect(parsed.messages[0].mediaId).toBe("media-9");
    expect(parsed.messages[0].content).toBe("এইটা চাই");
  });
  it("captures Messenger attachment URL", () => {
    const parsed = parseMetaWebhook({ entry: [{ messaging: [{ sender: { id: "psid-1" }, timestamp: 1728000000000, message: { mid: "m1", attachments: [{ type: "audio", payload: { url: "https://cdn.example/voice.ogg" } }] } }] }] });
    expect(parsed.messages[0].type).toBe("audio");
    expect(parsed.messages[0].mediaUrl).toBe("https://cdn.example/voice.ogg");
  });
});

describe("M12 whatsapp window", () => {
  it("is open within 24h of the last customer message and closed after", () => {
    const svc = new InboxService(fakePrisma() as any, auditStub, llmStub);
    const now = new Date("2026-10-10T12:00:00Z");
    expect(svc.whatsappWindow({ channel: "whatsapp", lastCustomerMessageAt: new Date("2026-10-10T02:00:00Z") }, now)?.open).toBe(true);
    expect(svc.whatsappWindow({ channel: "whatsapp", lastCustomerMessageAt: new Date("2026-10-09T11:00:00Z") }, now)?.open).toBe(false);
    expect(svc.whatsappWindow({ channel: "whatsapp", lastCustomerMessageAt: null }, now)?.open).toBe(false);
    expect(svc.whatsappWindow({ channel: "messenger", lastCustomerMessageAt: new Date() }, now)).toBeNull();
  });
  it("webhook stamps lastCustomerMessageAt and stores media ids", async () => {
    const tables = fakePrisma();
    const svc = new InboxService(tables as any, auditStub, llmStub);
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ value: {
      contacts: [{ profile: { name: "Karim" }, wa_id: "8801711111111" }],
      messages: [{ from: "8801711111111", id: "wamid.img1", timestamp: "1728000000", type: "image", image: { id: "media-1" } }],
    } }] }] });
    await svc.handleWebhook("int-1", body, sign(body));
    const conv = tables.channelConversation.rows[0];
    expect(conv.lastCustomerMessageAt).toEqual(new Date(1728000000 * 1000));
    expect(tables.channelMessage.rows[0].mediaId).toBe("media-1");
  });
});

describe("M12 conversation list filters", () => {
  function seeded() {
    const tables = fakePrisma();
    seedConversation(tables, { id: "c1", contactName: "Karim", unreadCount: 3, tags: ["vip"], assignedUserId: null });
    seedConversation(tables, { id: "c2", contactName: "Selina", unreadCount: 0, tags: [], assignedUserId: "user-9", channel: "messenger", externalContactId: "psid-2" });
    seedConversation(tables, { id: "c3", contactName: "karim Uddin", unreadCount: 1, tags: ["cod"], assignedUserId: "user-9" });
    return tables;
  }
  it("searches by contact name (case-insensitive)", async () => {
    const svc = new InboxService(seeded() as any, auditStub, llmStub);
    const rows = await svc.listConversations("org-1", { q: "KARIM" });
    expect(rows.map((r: any) => r.id).sort()).toEqual(["c1", "c3"]);
  });
  it("filters by tag, assignee and unread", async () => {
    const svc = new InboxService(seeded() as any, auditStub, llmStub);
    expect((await svc.listConversations("org-1", { tag: "vip" })).map((r: any) => r.id)).toEqual(["c1"]);
    expect((await svc.listConversations("org-1", { assignee: "unassigned" })).map((r: any) => r.id)).toEqual(["c1"]);
    expect((await svc.listConversations("org-1", { assignee: "me" }, "user-9")).map((r: any) => r.id).sort()).toEqual(["c2", "c3"]);
    expect((await svc.listConversations("org-1", { unreadOnly: true })).map((r: any) => r.id).sort()).toEqual(["c1", "c3"]);
  });
  it("sorts unread first when asked", async () => {
    const svc = new InboxService(seeded() as any, auditStub, llmStub);
    const rows = await svc.listConversations("org-1", { sort: "unread" });
    expect(rows[0].id).toBe("c1");
  });
  it("annotates whatsapp rows with window state and messenger rows with null", async () => {
    const svc = new InboxService(seeded() as any, auditStub, llmStub);
    const rows = await svc.listConversations("org-1", {});
    expect(rows.find((r: any) => r.id === "c1").whatsappWindow.open).toBe(true);
    expect(rows.find((r: any) => r.id === "c2").whatsappWindow).toBeNull();
  });
});

describe("M12 notes, quick replies, tags", () => {
  it("notes are stored internally and listed per conversation; other orgs are refused", async () => {
    const tables = fakePrisma(); seedConversation(tables);
    const svc = new InboxService(tables as any, auditStub, llmStub);
    const note = await svc.addNote("org-1", "agent-1", "conv-1", "গ্রাহক COD চান, ঠিকানা যাচাই বাকি");
    expect(note.content).toContain("COD");
    expect(await svc.listNotes("org-1", "conv-1")).toHaveLength(1);
    await expect(svc.listNotes("org-2", "conv-1")).rejects.toMatchObject({ code: "inbox.conversationNotFoundInThisOrganization" });
  });
  it("quick replies CRUD with tenant isolation on delete", async () => {
    const tables = fakePrisma();
    const svc = new InboxService(tables as any, auditStub, llmStub);
    const qr = await svc.createQuickReply("org-1", "agent-1", { title: "দাম", content: "স্যার, দাম {{productPrice}}" });
    expect(await svc.listQuickReplies("org-1")).toHaveLength(1);
    await expect(svc.deleteQuickReply("org-2", qr.id)).rejects.toMatchObject({ code: "inbox.quickReplyNotFoundInThis" });
    await svc.deleteQuickReply("org-1", qr.id);
    expect(await svc.listQuickReplies("org-1")).toHaveLength(0);
  });
  it("normalizeTags trims, dedupes and caps", () => {
    expect(normalizeTags([" vip ", "vip", "", "cod"])).toEqual(["vip", "cod"]);
    expect(normalizeTags(Array.from({ length: 15 }, (_, i) => `t${i}`))).toHaveLength(10);
  });
  it("updateConversation stores normalized tags", async () => {
    const tables = fakePrisma(); seedConversation(tables);
    const svc = new InboxService(tables as any, auditStub, llmStub);
    const updated = await svc.updateConversation("org-1", "agent-1", "conv-1", { tags: [" VIP ", "vip", "cod"] });
    expect(updated.tags).toEqual(["VIP", "cod"]);
  });
});

describe("M12 template + image sends (honesty discipline)", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });
  function setup(fetchImpl: any) {
    const tables = fakePrisma(); seedConversation(tables);
    global.fetch = fetchImpl;
    return { tables, svc: new InboxService(tables as any, auditStub, llmStub) };
  }
  it("registers templates, rejects duplicates, and sends with Meta confirmation", async () => {
    const { tables, svc } = setup(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.tpl1" }] }), { status: 200 }));
    const tpl = await svc.createWhatsAppTemplate("org-1", { name: "order_confirmation", language: "bn", bodyText: "আপনার অর্ডার {{1}} কনফার্ম হয়েছে" });
    await expect(svc.createWhatsAppTemplate("org-1", { name: "order_confirmation", language: "bn" })).rejects.toMatchObject({ code: "inbox.thisTemplateNameLanguageIsAlready" });
    const sent = await svc.sendTemplate("org-1", "agent-1", "conv-1", tpl.id, ["#1023"]);
    expect(sent.status).toBe("sent");
    expect(sent.externalId).toBe("wamid.tpl1");
    expect(sent.content).toContain("#1023");
    expect(tables.channelMessage.rows).toHaveLength(1);
  });
  it("template send failure marks the row failed and throws - never claims success", async () => {
    const { tables, svc } = setup(async () => new Response(JSON.stringify({ error: { message: "Template does not exist" } }), { status: 400 }));
    const tpl = await svc.createWhatsAppTemplate("org-1", { name: "ghost_template", language: "bn" });
    await expect(svc.sendTemplate("org-1", "agent-1", "conv-1", tpl.id)).rejects.toMatchObject({ code: "inbox.templateMessageWasNotSent" });
    expect(tables.channelMessage.rows[0].status).toBe("failed");
    expect(tables.channelMessage.rows[0].error).toContain("Template does not exist");
  });
  it("image reply requires an https URL and confirms with a message id", async () => {
    const { svc } = setup(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.img9" }] }), { status: 200 }));
    await expect(svc.sendImageReply("org-1", "agent-1", "conv-1", "http://insecure.example/x.jpg")).rejects.toThrow("https");
    const sent = await svc.sendImageReply("org-1", "agent-1", "conv-1", "https://cdn.example/panjabi.jpg", "এই ডিজাইনটা দেখুন");
    expect(sent.status).toBe("sent");
    expect(sent.mediaUrl).toContain("panjabi.jpg");
  });
  it("renderTemplatePreview fills numbered variables", () => {
    expect(renderTemplatePreview({ name: "t", bodyText: "অর্ডার {{1}} মোট {{2}}" }, ["#5", "৳900"])).toBe("অর্ডার #5 মোট ৳900");
    expect(renderTemplatePreview({ name: "t", bodyText: null }, [])).toBe("[Template: t]");
  });
});

describe("M12 customer context + media proxy", () => {
  it("computes lifetime spend excluding cancelled orders and includes lead stage", async () => {
    const tables = fakePrisma();
    tables.customer.rows.push({ id: "cust-1", organizationId: "org-1", name: "Karim", phone: "8801711111111", email: null, createdAt: new Date() });
    tables.lead.rows.push({ id: "lead-1", organizationId: "org-1", name: "Karim", stage: "qualified", valueMinor: 50000n, source: "whatsapp", tags: ["vip"] });
    seedConversation(tables, { customerId: "cust-1", leadId: "lead-1" });
    tables.order.rows.push(
      { id: "o1", organizationId: "org-1", customerId: "cust-1", externalNumber: "1001", status: "completed", source: "woocommerce", isCod: true, currency: "BDT", totalMinor: 150000n, createdAt: new Date("2026-10-01") },
      { id: "o2", organizationId: "org-1", customerId: "cust-1", externalNumber: "1002", status: "cancelled", source: "woocommerce", isCod: false, currency: "BDT", totalMinor: 99900n, createdAt: new Date("2026-10-02") },
      { id: "o3", organizationId: "org-1", customerId: "cust-1", externalNumber: "1003", status: "processing", source: "woocommerce", isCod: true, currency: "BDT", totalMinor: 50000n, createdAt: new Date("2026-10-03") },
    );
    const svc = new InboxService(tables as any, auditStub, llmStub);
    const detail = await svc.getConversation("org-1", "conv-1");
    expect(detail.context.lifetime.orderCount).toBe(2);
    expect(detail.context.lifetime.totalSpentMinor).toBe("200000");
    expect(detail.context.lead.stage).toBe("qualified");
    expect(detail.context.orders).toHaveLength(3);
  });
  it("resolves WhatsApp media bytes through the Graph API", async () => {
    const tables = fakePrisma(); seedConversation(tables);
    tables.channelMessage.rows.push({ id: "m1", conversationId: "conv-1", direction: "in", type: "image", mediaId: "media-77", status: "received", createdAt: new Date() });
    const realFetch = global.fetch;
    global.fetch = (async (url: string) => {
      if (String(url).includes("/media-77?")) return new Response(JSON.stringify({ url: "https://lookaside.example/file.bin", mime_type: "image/jpeg" }), { status: 200 });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
    }) as any;
    try {
      const svc = new InboxService(tables as any, auditStub, llmStub);
      const media = await svc.getMessageMedia("org-1", "conv-1", "m1");
      expect(media.contentType).toBe("image/jpeg");
      expect(media.bytes.length).toBe(3);
      await expect(svc.getMessageMedia("org-2", "conv-1", "m1")).rejects.toMatchObject({ code: "inbox.conversationNotFoundInThisOrganization" });
    } finally { global.fetch = realFetch; }
  });
});
