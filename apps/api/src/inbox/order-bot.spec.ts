import { createHmac } from "crypto";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.DISABLE_SCHEDULER = "true";

import { InboxService } from "./inbox.service";
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
      if ("lte" in v) return row[k] <= v.lte;
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
    const entries = Array.isArray(orderBy) ? orderBy : [orderBy];
    let out = [...list];
    for (const ob of entries) {
      const [key, dir] = Object.entries(ob)[0] as [string, string];
      out.sort((a, b) => {
        const av = a[key] instanceof Date ? a[key].getTime() : a[key];
        const bv = b[key] instanceof Date ? b[key].getTime() : b[key];
        return dir === "desc" ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1);
      });
    }
    return out;
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
      row.updatedAt = new Date();
      return row;
    },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => matches(r, where ?? {}, tables)); return rows.splice(i, 1)[0]; },
  };
}
const TABLE_NAMES = ["integration", "channelConversation", "channelMessage", "conversationNote", "quickReply", "whatsAppTemplate", "lead", "leadActivity", "customer", "order", "orderItem", "membership", "messageDraft", "inboxSetting", "businessPolicy", "product", "productVariant", "botSession"];
function fakePrisma() {
  const tables: Record<string, any> = {};
  for (const name of TABLE_NAMES) tables[name] = makeTable(name, tables);
  tables.businessProfile = { findUnique: async () => ({ industry: "fashion", description: "Clothing", brandVoice: "friendly" }) };
  const secrets = encryptJson({ accessToken: "tok", appSecret: "appsecret", verifyToken: "vtok", phoneNumberId: "999" });
  tables.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: "whatsapp", status: "CONNECTED", credential: { encryptedData: secrets } });
  tables.product.rows.push(
    { id: "p1", organizationId: "org-1", status: "ACTIVE", name: "Cotton Panjabi", priceMinor: 150000n, currency: "BDT", stockQuantity: 12, source: "manual", externalId: null, createdAt: new Date(1) },
    { id: "p2", organizationId: "org-1", status: "ACTIVE", name: "Silk Saree", priceMinor: 450000n, currency: "BDT", stockQuantity: 5, source: "manual", externalId: null, createdAt: new Date(2) },
  );
  return tables;
}
const llmStub = { getProvider: () => new DevTemplateProvider() } as any;
const auditStub = { log: async () => undefined } as any;
const sign = (body: string) => "sha256=" + createHmac("sha256", "appsecret").update(body, "utf8").digest("hex");
let msgSeq = 0;
async function inbound(svc: InboxService, from: string, body: string) {
  const raw = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: {
      contacts: [{ profile: { name: "Karim" }, wa_id: from }],
      messages: [{ from, id: `wamid.b${++msgSeq}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body } }],
    } }] }],
  });
  await svc.handleWebhook("int-1", raw, sign(raw));
}
const outTexts = (tables: any) => tables.channelMessage.rows.filter((m: any) => m.direction === "out" && m.status === "sent").map((m: any) => m.content as string);

describe("M15 order-taking bot", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });
  async function setup() {
    const tables = fakePrisma();
    global.fetch = (async () => new Response(JSON.stringify({ messages: [{ id: `wamid.s${Math.random()}` }] }), { status: 200 })) as any;
    const svc = new InboxService(tables as any, auditStub, llmStub);
    await svc.updateSettings("org-1", "owner", { botEnabled: true, botDeliveryChargeMinor: 6000 });
    return { tables, svc };
  }

  it("walks the full script and creates a real order on confirm", async () => {
    const { tables, svc } = await setup();
    await inbound(svc, "8801711111111", "আমি অর্ডার করতে চাই");
    expect(tables.botSession.rows).toHaveLength(1);
    expect(tables.botSession.rows[0].state).toBe("ask_product");
    expect(outTexts(tables)[0]).toContain("Cotton Panjabi");
    await inbound(svc, "8801711111111", "1");
    expect(tables.botSession.rows[0].state).toBe("ask_quantity");
    await inbound(svc, "8801711111111", "২");
    expect(tables.botSession.rows[0].state).toBe("ask_name");
    await inbound(svc, "8801711111111", "Rahim Uddin");
    await inbound(svc, "8801711111111", "01711111111");
    expect(tables.botSession.rows[0].state).toBe("ask_address");
    await inbound(svc, "8801711111111", "বাসা ৫, রোড ২, মিরপুর ১০, ঢাকা");
    expect(tables.botSession.rows[0].state).toBe("confirm");
    const summary = outTexts(tables).at(-1)!;
    expect(summary).toContain("BDT 3060.00"); // 2 x 1500 + 60 delivery
    expect(summary).toContain("Rahim Uddin");
    await inbound(svc, "8801711111111", "হ্যাঁ");
    expect(tables.botSession.rows[0].status).toBe("completed");
    expect(tables.order.rows).toHaveLength(1);
    expect(String(tables.order.rows[0].totalMinor)).toBe("306000");
    expect(tables.order.rows[0].source).toBe("chat");
    const customer = tables.customer.rows[0];
    expect(customer.firstName).toBe("Rahim Uddin");
    expect(customer.phone).toBe("01711111111");
    expect(outTexts(tables).at(-1)).toContain("তৈরি হয়েছে");
    expect(tables.conversationNote.rows.some((n: any) => n.content.includes("বট অর্ডার"))).toBe(true);
  });

  it("validates phone numbers and re-asks instead of guessing", async () => {
    const { tables, svc } = await setup();
    await inbound(svc, "8801722222222", "অর্ডার করতে চাই");
    await inbound(svc, "8801722222222", "2");
    await inbound(svc, "8801722222222", "1");
    await inbound(svc, "8801722222222", "Karim Islam");
    await inbound(svc, "8801722222222", "12345");
    expect(tables.botSession.rows[0].state).toBe("ask_phone"); // did not advance
    expect(outTexts(tables).at(-1)).toContain("সঠিক মনে হচ্ছে না");
    await inbound(svc, "8801722222222", "01911111111");
    expect(tables.botSession.rows[0].state).toBe("ask_address");
  });

  it("customer can bail out to a human at any time", async () => {
    const { tables, svc } = await setup();
    await inbound(svc, "8801733333333", "অর্ডার করতে চাই");
    await inbound(svc, "8801733333333", "এজেন্ট");
    expect(tables.botSession.rows[0].status).toBe("handed_off");
    expect(tables.conversationNote.rows.some((n: any) => n.content.includes("এজেন্ট চেয়েছেন"))).toBe(true);
    expect(tables.order.rows).toHaveLength(0);
  });

  it("a human reply takes over and stops the bot", async () => {
    const { tables, svc } = await setup();
    await inbound(svc, "8801744444444", "অর্ডার করতে চাই");
    const convId = tables.channelConversation.rows[0].id;
    await svc.sendReply("org-1", "agent-1", convId, "আমি নিজে সাহায্য করছি");
    expect(tables.botSession.rows[0].status).toBe("handed_off");
  });

  it("declining at confirm creates no order", async () => {
    const { tables, svc } = await setup();
    await inbound(svc, "8801755555555", "অর্ডার করতে চাই");
    await inbound(svc, "8801755555555", "1");
    await inbound(svc, "8801755555555", "1");
    await inbound(svc, "8801755555555", "Test Name");
    await inbound(svc, "8801755555555", "01811111111");
    await inbound(svc, "8801755555555", "বাসা ১, রোড ১, ধানমন্ডি, ঢাকা");
    await inbound(svc, "8801755555555", "না");
    expect(tables.order.rows).toHaveLength(0);
    expect(tables.botSession.rows[0].status).toBe("handed_off");
  });

  it("does not start when the bot is disabled", async () => {
    const tables = fakePrisma();
    global.fetch = (async () => new Response(JSON.stringify({ messages: [{ id: "wamid.z" }] }), { status: 200 })) as any;
    const svc = new InboxService(tables as any, auditStub, llmStub);
    await inbound(svc, "8801766666666", "আমি অর্ডার করতে চাই");
    expect(tables.botSession.rows).toHaveLength(0);
  });

  it("an agent can stop the bot from the panel endpoint", async () => {
    const { tables, svc } = await setup();
    await inbound(svc, "8801777777777", "অর্ডার করতে চাই");
    const convId = tables.channelConversation.rows[0].id;
    const res = await svc.stopBot("org-1", "agent-1", convId);
    expect(res.stopped).toBe(true);
    expect(tables.botSession.rows[0].status).toBe("handed_off");
  });
});
