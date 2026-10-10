import { createHmac } from "crypto";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.DISABLE_SCHEDULER = "true";

import { InboxService } from "./inbox.service";
import { classifyIntent, parseCodReply } from "./intent";
import { encryptJson } from "../integrations/crypto";
import { DevTemplateProvider } from "../ai/llm/dev.provider";
import { WorkflowsService } from "../workflows/workflows.service";

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
const TABLE_NAMES = ["integration", "channelConversation", "channelMessage", "conversationNote", "quickReply", "whatsAppTemplate", "lead", "leadActivity", "customer", "order", "membership", "messageDraft", "inboxSetting", "businessPolicy", "product", "workflow", "workflowRun"];
function fakePrisma() {
  const tables: Record<string, any> = {};
  for (const name of TABLE_NAMES) tables[name] = makeTable(name, tables);
  tables.businessProfile = { findUnique: async () => ({ industry: "fashion", description: "Clothing store", brandVoice: "friendly" }) };
  const secrets = encryptJson({ accessToken: "tok", appSecret: "appsecret", verifyToken: "vtok", phoneNumberId: "999" });
  tables.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: "whatsapp", status: "CONNECTED", credential: { encryptedData: secrets } });
  tables.product.rows.push({ id: "p1", organizationId: "org-1", status: "ACTIVE", name: "Cotton Panjabi", priceMinor: 150000n, currency: "BDT", stockQuantity: 12 });
  tables.businessPolicy.rows.push({ id: "pol-1", organizationId: "org-1", type: "shipping", title: "Shipping", content: "ঢাকার ভিতরে ডেলিভারি চার্জ ৬০ টাকা, বাইরে ১২০ টাকা। সময় ২-৩ দিন।" });
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

describe("M13 intent classifier", () => {
  it("classifies Bengali + English intents with confidence", () => {
    expect(classifyIntent("Cotton Panjabi এর দাম কত?").intent).toBe("price");
    expect(classifyIntent("Cotton Panjabi এর দাম কত?").confidence).toBeGreaterThanOrEqual(85);
    expect(classifyIntent("এটা স্টকে আছে?").intent).toBe("stock");
    expect(classifyIntent("ডেলিভারি চার্জ কত?").intent).toBe("delivery");
    expect(classifyIntent("আমার অর্ডার কোথায়? ডেলিভারি পাইনি").intent).toBe("order_status");
    expect(classifyIntent("আসসালামু আলাইকুম").intent).toBe("greeting");
    expect(classifyIntent("আজ আবহাওয়া কেমন").intent).toBe("other");
  });
  it("flags negative sentiment and escalates to complaint", () => {
    const c = classifyIntent("এত বাজে সার্ভিস! দাম কত সেটাও বলতে পারছেন না, প্রতারণা!");
    expect(c.sentiment).toBe("negative");
    expect(c.intent).toBe("complaint");
  });
  it("parseCodReply only accepts short clear answers", () => {
    expect(parseCodReply("হ্যাঁ")).toBe("confirmed");
    expect(parseCodReply("না")).toBe("declined");
    expect(parseCodReply("yes")).toBe("confirmed");
    expect(parseCodReply("আমি আসলে জানি না কি করব, পরে জানাবো, এখন ব্যস্ত আছি অনেক")).toBeNull();
    expect(parseCodReply("হ্যাঁ কিন্তু ডেলিভারি চার্জ বেশি মনে হচ্ছে আমার কাছে অনেক")).toBeNull();
  });
});

describe("M13 settings", () => {
  it("returns defaults and validates updates", async () => {
    const svc = new InboxService(fakePrisma() as any, auditStub, llmStub);
    const def = await svc.getSettings("org-1");
    expect(def.autoReplyMode).toBe("off");
    expect(def.confidenceThreshold).toBe(70);
    await svc.updateSettings("org-1", "owner", { autoReplyMode: "draft", confidenceThreshold: 80 });
    expect((await svc.getSettings("org-1")).autoReplyMode).toBe("draft");
    await expect(svc.updateSettings("org-1", "owner", { autoReplyMode: "yolo" as any })).rejects.toThrow("off | draft | auto");
    await expect(svc.updateSettings("org-1", "owner", { perIntent: { price: "turbo" as any } })).rejects.toThrow("Invalid mode");
  });
});

describe("M13 grounded auto-reply", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it("draft mode creates a grounded draft and sends nothing", async () => {
    const tables = fakePrisma();
    let fetchCalls = 0;
    global.fetch = (async () => { fetchCalls++; return new Response(JSON.stringify({ messages: [{ id: "wamid.x" }] }), { status: 200 }); }) as any;
    const svc = new InboxService(tables as any, auditStub, llmStub);
    await svc.updateSettings("org-1", "owner", { autoReplyMode: "draft" });
    await inbound(svc, "8801711111111", "wamid.a1", "Cotton Panjabi এর দাম কত?");
    expect(tables.messageDraft.rows).toHaveLength(1);
    expect(tables.messageDraft.rows[0].provider).toBe("auto-reply");
    expect(tables.messageDraft.rows[0].content).toContain("BDT 1500.00");
    expect(tables.channelMessage.rows.filter((m: any) => m.direction === "out")).toHaveLength(0);
    expect(fetchCalls).toBe(0);
    const stored = tables.channelMessage.rows.find((m: any) => m.direction === "in");
    expect(stored.intent).toBe("price");
  });

  it("auto mode sends a confirmed reply with evidence and stamps first response", async () => {
    const tables = fakePrisma();
    global.fetch = (async () => new Response(JSON.stringify({ messages: [{ id: "wamid.auto1" }] }), { status: 200 })) as any;
    const svc = new InboxService(tables as any, auditStub, llmStub);
    await svc.updateSettings("org-1", "owner", { autoReplyMode: "auto" });
    await inbound(svc, "8801711111111", "wamid.a2", "Cotton Panjabi এর দাম কত?");
    const out = tables.channelMessage.rows.filter((m: any) => m.direction === "out");
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("sent");
    expect(out[0].autoReply).toBe(true);
    expect(JSON.parse(out[0].autoReplyEvidence).productId).toBe("p1");
    expect(tables.channelConversation.rows[0].firstResponseAt).toBeTruthy();
  });

  it("never auto-replies without verified data or below the confidence threshold", async () => {
    const tables = fakePrisma();
    global.fetch = (async () => new Response(JSON.stringify({ messages: [{ id: "wamid.z" }] }), { status: 200 })) as any;
    const svc = new InboxService(tables as any, auditStub, llmStub);
    await svc.updateSettings("org-1", "owner", { autoReplyMode: "auto" });
    await inbound(svc, "8801722222222", "wamid.a3", "Silk Saree এর দাম কত?"); // product not in catalog
    await inbound(svc, "8801733333333", "wamid.a4", "দাম"); // weak signal, below threshold
    expect(tables.channelMessage.rows.filter((m: any) => m.direction === "out")).toHaveLength(0);
    expect(tables.messageDraft.rows).toHaveLength(0);
  });

  it("rate-limits to one auto-reply per conversation per 10 minutes", async () => {
    const tables = fakePrisma();
    global.fetch = (async () => new Response(JSON.stringify({ messages: [{ id: "wamid.r" }] }), { status: 200 })) as any;
    const svc = new InboxService(tables as any, auditStub, llmStub);
    await svc.updateSettings("org-1", "owner", { autoReplyMode: "auto" });
    await inbound(svc, "8801744444444", "wamid.a5", "Cotton Panjabi এর দাম কত?");
    await inbound(svc, "8801744444444", "wamid.a6", "Cotton Panjabi স্টকে আছে?");
    expect(tables.channelMessage.rows.filter((m: any) => m.direction === "out" && m.autoReply)).toHaveLength(1);
  });

  it("delivery questions are answered from the business's own shipping policy", async () => {
    const tables = fakePrisma();
    const svc = new InboxService(tables as any, auditStub, llmStub);
    await svc.updateSettings("org-1", "owner", { autoReplyMode: "draft" });
    await inbound(svc, "8801755555555", "wamid.a7", "ডেলিভারি চার্জ কত?");
    expect(tables.messageDraft.rows).toHaveLength(1);
    expect(tables.messageDraft.rows[0].content).toContain("৬০ টাকা");
  });
});

describe("M13 smart assignment", () => {
  it("round-robin assigns new conversations across eligible members", async () => {
    const tables = fakePrisma();
    tables.membership.rows.push(
      { id: "m1", organizationId: "org-1", userId: "user-a", role: "OWNER", createdAt: new Date(1) },
      { id: "m2", organizationId: "org-1", userId: "user-b", role: "SUPPORT_AGENT", createdAt: new Date(2) },
      { id: "m3", organizationId: "org-1", userId: "user-c", role: "VIEWER", createdAt: new Date(3) },
    );
    const svc = new InboxService(tables as any, auditStub, llmStub);
    await svc.updateSettings("org-1", "owner", { smartAssign: "round_robin" });
    await inbound(svc, "8801761111111", "wamid.s1", "আসসালামু আলাইকুম");
    await inbound(svc, "8801762222222", "wamid.s2", "আসসালামু আলাইকুম");
    const assigned = tables.channelConversation.rows.map((c: any) => c.assignedUserId).sort();
    expect(assigned).toEqual(["user-a", "user-b"]);
  });
});

describe("M13 COD confirmation flow", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });
  function setup() {
    const tables = fakePrisma();
    tables.customer.rows.push({ id: "cust-1", organizationId: "org-1", name: "Karim", phone: "8801711111111", email: null, createdAt: new Date() });
    tables.order.rows.push({ id: "o1", organizationId: "org-1", customerId: "cust-1", externalNumber: "1007", status: "processing", isCod: true, currency: "BDT", totalMinor: 150000n, source: "woocommerce", createdAt: new Date(), codConfirmationStatus: null });
    tables.channelConversation.rows.push({
      id: "conv-1", organizationId: "org-1", integrationId: "int-1", channel: "whatsapp", externalContactId: "8801711111111",
      contactName: "Karim", contactPhone: "8801711111111", customerId: "cust-1", leadId: null, status: "open", assignedUserId: null,
      tags: [], unreadCount: 0, lastMessageAt: new Date(), lastCustomerMessageAt: new Date(), lastMessagePreview: "", firstResponseAt: new Date(),
    });
    global.fetch = (async () => new Response(JSON.stringify({ messages: [{ id: "wamid.cod" }] }), { status: 200 })) as any;
    return { tables, svc: new InboxService(tables as any, auditStub, llmStub) };
  }
  it("sends the confirmation first, then marks the order awaiting", async () => {
    const { tables, svc } = setup();
    const order = await svc.requestCodConfirmation("org-1", "agent-1", "conv-1", "o1");
    expect(order.codConfirmationStatus).toBe("awaiting");
    expect(tables.channelMessage.rows.filter((m: any) => m.direction === "out")).toHaveLength(1);
    await expect(svc.requestCodConfirmation("org-1", "agent-1", "conv-1", "o1")).rejects.toThrow("already awaiting");
  });
  it("a customer's হ্যাঁ confirms the order, writes a note, and no auto-reply fires", async () => {
    const { tables, svc } = setup();
    await svc.updateSettings("org-1", "owner", { autoReplyMode: "auto" });
    await svc.requestCodConfirmation("org-1", "agent-1", "conv-1", "o1");
    const outsBefore = tables.channelMessage.rows.filter((m: any) => m.direction === "out").length;
    await inbound(svc, "8801711111111", "wamid.cod-reply", "হ্যাঁ");
    expect(tables.order.rows[0].codConfirmationStatus).toBe("confirmed");
    expect(tables.conversationNote.rows.some((n: any) => n.content.includes("কনফার্ম"))).toBe(true);
    expect(tables.channelMessage.rows.filter((m: any) => m.direction === "out").length).toBe(outsBefore);
  });
  it("a customer's না declines the order", async () => {
    const { tables, svc } = setup();
    await svc.requestCodConfirmation("org-1", "agent-1", "conv-1", "o1");
    await inbound(svc, "8801711111111", "wamid.cod-no", "না");
    expect(tables.order.rows[0].codConfirmationStatus).toBe("declined");
  });
});

describe("M13 SLA + team report", () => {
  it("stamps firstResponseAt on human send and resolvedAt on close", async () => {
    const tables = fakePrisma();
    tables.channelConversation.rows.push({
      id: "conv-1", organizationId: "org-1", integrationId: "int-1", channel: "whatsapp", externalContactId: "8801711111111",
      contactName: "Karim", contactPhone: "8801711111111", customerId: null, leadId: null, status: "open", assignedUserId: null,
      tags: [], unreadCount: 1, lastMessageAt: new Date(), lastCustomerMessageAt: new Date(), lastMessagePreview: "", firstResponseAt: null,
    });
    const realFetch = global.fetch;
    global.fetch = (async () => new Response(JSON.stringify({ messages: [{ id: "wamid.h1" }] }), { status: 200 })) as any;
    try {
      const svc = new InboxService(tables as any, auditStub, llmStub);
      await svc.sendReply("org-1", "agent-1", "conv-1", "জি স্যার, বলুন");
      expect(tables.channelConversation.rows[0].firstResponseAt).toBeTruthy();
      await svc.updateConversation("org-1", "agent-1", "conv-1", { status: "closed" });
      expect(tables.channelConversation.rows[0].resolvedAt).toBeTruthy();
      await svc.updateConversation("org-1", "agent-1", "conv-1", { status: "open" });
      expect(tables.channelConversation.rows[0].resolvedAt).toBeNull();
    } finally { global.fetch = realFetch; }
  });
  it("aggregates a team report with breaches and chat-linked revenue", async () => {
    const tables = fakePrisma();
    const hour = 3600 * 1000;
    const now = Date.now();
    tables.channelConversation.rows.push(
      { id: "c1", organizationId: "org-1", channel: "whatsapp", status: "closed", assignedUserId: "user-a", customerId: "cust-1", createdAt: new Date(now - 2 * hour), firstResponseAt: new Date(now - 2 * hour + 30 * 60000), resolvedAt: new Date(now - hour), tags: [], unreadCount: 0 },
      { id: "c2", organizationId: "org-1", channel: "whatsapp", status: "open", assignedUserId: null, customerId: null, createdAt: new Date(now - 5 * hour), firstResponseAt: null, resolvedAt: null, tags: [], unreadCount: 2 },
    );
    tables.order.rows.push({ id: "o1", organizationId: "org-1", customerId: "cust-1", status: "completed", totalMinor: 200000n, currency: "BDT", createdAt: new Date(now - hour) });
    const svc = new InboxService(tables as any, auditStub, llmStub);
    const report = await svc.getTeamReport("org-1", 7);
    expect(report.opened).toBe(2);
    expect(report.closed).toBe(1);
    expect(report.avgFirstResponseMinutes).toBe(30);
    expect(report.currentBreaches).toBe(1);
    expect(report.perAgent[0]).toMatchObject({ userId: "user-a", assigned: 1, closed: 1 });
    expect(report.chatLinkedOrders).toBe(1);
    expect(report.chatLinkedRevenueMinor).toBe("200000");
  });
});

describe("M13 inbox workflow triggers", () => {
  function wfSetup() {
    const tables = fakePrisma();
    const messagingStub = { getTemplate: async () => { throw new Error("unused"); }, sendToRecipient: async () => { throw new Error("unused"); } } as any;
    const eventsStub = { on: () => undefined, emit: () => undefined } as any;
    const svc = new WorkflowsService(tables as any, auditStub, eventsStub, messagingStub);
    return { tables, svc };
  }
  it("inbox_message_received with an intent condition adds a conversation note", async () => {
    const { tables, svc } = wfSetup();
    tables.workflow.rows.push({
      id: "wf-1", organizationId: "org-1", name: "Complaint watch", trigger: "inbox_message_received", enabled: true,
      conditions: [{ field: "intent", op: "eq", value: "complaint" }],
      steps: [{ type: "add_conversation_note", text: "অভিযোগ এসেছে, মালিককে জানান" }],
    });
    await svc.handleTrigger("inbox_message_received", { organizationId: "org-1", context: { conversationId: "conv-9", intent: "price" } });
    expect(tables.conversationNote.rows).toHaveLength(0); // condition not met -> skipped run
    await svc.handleTrigger("inbox_message_received", { organizationId: "org-1", context: { conversationId: "conv-9", intent: "complaint" } });
    expect(tables.conversationNote.rows).toHaveLength(1);
    expect(tables.workflowRun.rows.at(-1).status).toBe("completed");
  });
  it("inbox_unanswered scan fires once per conversation per day", async () => {
    const { tables, svc } = wfSetup();
    const threeHoursAgo = new Date(Date.now() - 3 * 3600 * 1000);
    tables.workflow.rows.push({
      id: "wf-2", organizationId: "org-1", name: "Unanswered nudge", trigger: "inbox_unanswered", enabled: true,
      conditions: [{ field: "unansweredMinutes", op: "gte", value: 120 }],
      steps: [{ type: "add_conversation_note", text: "২ ঘণ্টা ধরে উত্তর হয়নি" }],
    });
    tables.channelConversation.rows.push({
      id: "conv-7", organizationId: "org-1", channel: "whatsapp", status: "open", unreadCount: 1,
      lastCustomerMessageAt: threeHoursAgo, lastMessageAt: threeHoursAgo, tags: [],
    });
    expect(await svc.scanUnanswered()).toBe(1);
    expect(tables.conversationNote.rows).toHaveLength(1);
    expect(await svc.scanUnanswered()).toBe(0); // deduped within 24h
  });
});
