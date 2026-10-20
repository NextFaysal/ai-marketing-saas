process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "test-secret";
process.env.WEB_URL = "https://app.example.com";
process.env.API_PUBLIC_URL = "https://api.example.com";

import { MetaMessagingClient } from "./meta-messaging.client";
import { InboxService } from "./inbox.service";
import { MessagingService } from "../messaging/messaging.service";
import { encryptJson, decryptJson } from "../integrations/crypto";

/**
 * MS6 — WhatsApp Template Hub: client list/create request shapes,
 * WABA id setting, template sync (upserts, NOT_ON_META only after
 * a complete walk, nothing written on Meta error), template
 * submit (documented components payload, stored only on Meta
 * success, local validation before any fetch), rich template
 * sends (header media/text + button params pinned; legacy sends
 * byte-identical), and the messaging-side broadcast mapping.
 * Fake fetch + fake prisma, like the MS1–MS5 specs.
 */

// ---------- shared fake-prisma helpers ----------
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
      if ("not" in v) return row[k] !== v.not;
      return true;
    }
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    return row[k] === v;
  });
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where, orderBy }: any = {}) => {
      const out = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "desc") out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return out[0] ?? null;
    },
    findMany: async ({ where, take, orderBy }: any = {}) => {
      const out = rows.filter((r) => matches(r, where ?? {}));
      if (orderBy?.createdAt === "desc") out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return take ? out.slice(0, take) : out;
    },
    findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (row) Object.assign(row, data);
      return row;
    },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); if (i >= 0) rows.splice(i, 1); return {}; },
  };
}

// ---------- MetaMessagingClient ----------
describe("MS6 MetaMessagingClient template management", () => {
  it("listMessageTemplates: URL carries the documented fields + limit, paging cursor appended, Bearer auth", async () => {
    const calls: any[] = [];
    const fetchFn = async (url: string, init: any) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ data: [], paging: { cursors: {} } }) } as any;
    };
    const client = new MetaMessagingClient({ accessToken: "tok", phoneNumberId: "999" }, fetchFn as any, "v21.0");
    await client.listMessageTemplates("WABA123");
    expect(calls[0].url).toBe("https://graph.facebook.com/v21.0/WABA123/message_templates?fields=name,language,category,status,quality_score,components,id&limit=100");
    expect(calls[0].init.headers.Authorization).toBe("Bearer tok");
    await client.listMessageTemplates("WABA123", "cur123");
    expect(calls[1].url).toContain("&after=cur123");
  });

  it("listMessageTemplates: a Meta error throws Meta's message verbatim", async () => {
    const fetchFn = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "Invalid OAuth access token" } }) }) as any;
    const client = new MetaMessagingClient({ accessToken: "tok" }, fetchFn);
    await expect(client.listMessageTemplates("WABA123")).rejects.toThrow("Invalid OAuth access token");
  });

  it("createMessageTemplate: POSTs the payload as JSON and returns the parsed body; rejection is verbatim", async () => {
    const calls: any[] = [];
    const fetchFn = async (url: string, init: any) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ id: "mt-1", status: "PENDING", category: "MARKETING" }) } as any;
    };
    const client = new MetaMessagingClient({ accessToken: "tok" }, fetchFn as any, "v21.0");
    const payload = { name: "eid_offer", language: "bn", category: "MARKETING", components: [{ type: "BODY", text: "hi" }] };
    await expect(client.createMessageTemplate("WABA123", payload)).resolves.toEqual({ id: "mt-1", status: "PENDING", category: "MARKETING" });
    expect(calls[0].url).toBe("https://graph.facebook.com/v21.0/WABA123/message_templates");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body)).toEqual(payload);

    const failFn = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "Template name already exists" } }) }) as any;
    const failing = new MetaMessagingClient({ accessToken: "tok" }, failFn);
    await expect(failing.createMessageTemplate("WABA123", payload)).rejects.toThrow("Template name already exists");
  });
});

describe("MS6 rich template sends (client)", () => {
  function capturingClient(calls: any[]) {
    const fetchFn = async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid-rich" }] }) } as any;
    };
    return new MetaMessagingClient({ accessToken: "tok", phoneNumberId: "999" }, fetchFn as any);
  }

  it("maps header media + body + url/quick-reply button params into the send components, in order", async () => {
    const calls: any[] = [];
    const client = capturingClient(calls);
    await client.sendWhatsAppTemplate("8801712345678", "eid_offer", "bn", ["Ayesha"], {
      headerMedia: { kind: "image", link: "https://img.example/x.png" },
      buttonParams: [
        { index: 0, subType: "url", text: "abc123" },
        { index: 1, subType: "quick_reply", payload: "stop_promo" },
      ],
    });
    expect(calls[0].body.template.components).toEqual([
      { type: "header", parameters: [{ type: "image", image: { link: "https://img.example/x.png" } }] },
      { type: "body", parameters: [{ type: "text", text: "Ayesha" }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "abc123" }] },
      { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: "stop_promo" }] },
    ]);
  });

  it("header text params render as text parameters; a media header wins when both are given", async () => {
    const calls: any[] = [];
    const client = capturingClient(calls);
    await client.sendWhatsAppTemplate("8801", "t", "bn", [], { headerTextParams: ["ঈদ মোবারক"] });
    expect(calls[0].body.template.components).toEqual([
      { type: "header", parameters: [{ type: "text", text: "ঈদ মোবারক" }] },
    ]);
    await client.sendWhatsAppTemplate("8801", "t", "bn", [], {
      headerTextParams: ["ignored"],
      headerMedia: { kind: "video", link: "https://img.example/v.mp4" },
    });
    expect(calls[1].body.template.components).toEqual([
      { type: "header", parameters: [{ type: "video", video: { link: "https://img.example/v.mp4" } }] },
    ]);
  });

  it("LEGACY: without rich params the request body is exactly today's shape", async () => {
    const calls: any[] = [];
    const client = capturingClient(calls);
    await client.sendWhatsAppTemplate("8801", "eid_offer", "bn", ["Ayesha"]);
    expect(calls[0].body).toEqual({
      messaging_product: "whatsapp", recipient_type: "individual", to: "8801",
      type: "template",
      template: { name: "eid_offer", language: { code: "bn" }, components: [{ type: "body", parameters: [{ type: "text", text: "Ayesha" }] }] },
    });
    await client.sendWhatsAppTemplate("8801", "eid_offer", "bn");
    expect(calls[1].body.template).toEqual({ name: "eid_offer", language: { code: "bn" } });
    // An empty rich object is also byte-identical.
    await client.sendWhatsAppTemplate("8801", "eid_offer", "bn", ["Ayesha"], {});
    expect(calls[2].body).toEqual(calls[0].body);
  });
});

// ---------- InboxService: WABA + sync + submit ----------
function buildInbox(opts?: { wabaId?: string; withIntegration?: boolean }) {
  const tables: any = {
    integration: makeTable("int"),
    integrationCredential: makeTable("cred"),
    whatsAppTemplate: makeTable("wa"),
  };
  // Credential rows live in their own table; integration reads
  // with include:{credential:true} resolve them (Prisma shape).
  const baseInt = tables.integration;
  const attach = (row: any, args: any) => {
    if (!row) return row;
    if (args?.include?.credential) {
      const cred = tables.integrationCredential.rows.find((c: any) => c.integrationId === row.id) ?? row.credential ?? null;
      return { ...row, credential: cred };
    }
    return row;
  };
  tables.integration = {
    ...baseInt,
    findFirst: async (args: any) => attach(await baseInt.findFirst(args), args),
    findMany: async (args: any) => { const rows = await baseInt.findMany(args); return args?.include?.credential ? rows.map((r: any) => attach(r, args)) : rows; },
    findUnique: async (args: any) => attach(await baseInt.findUnique(args), args),
  };
  tables.integrationCredential = {
    ...tables.integrationCredential,
    update: async ({ where, data }: any) => {
      const row = tables.integrationCredential.rows.find((c: any) => c.integrationId === where.integrationId);
      if (row) Object.assign(row, data);
      return row;
    },
  };
  if (opts?.withIntegration !== false) {
    tables.integration.rows.push({ id: "int-1", organizationId: "org-1", provider: "whatsapp", status: "CONNECTED", externalAccountId: "999", createdAt: new Date() });
    const secrets: Record<string, unknown> = { accessToken: "tok-secret", appSecret: "appsecret", verifyToken: "vtok", phoneNumberId: "999" };
    if (opts?.wabaId) secrets.wabaId = opts.wabaId;
    tables.integrationCredential.rows.push({ id: "cred-1", integrationId: "int-1", encryptedData: encryptJson(secrets) });
  }
  const auditLogs: any[] = [];
  const audit = { log: async (entry: any) => { auditLogs.push(entry); } } as any;
  const svc = new InboxService(tables as any, audit, {} as any);
  return { svc, tables, auditLogs };
}

const realFetch = global.fetch;
afterEach(() => { (global as any).fetch = realFetch; });
function stubFetch(handler: (url: string, init: any) => any) {
  const calls: any[] = [];
  (global as any).fetch = async (url: string, init: any) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return calls;
}
const okJson = (body: any) => ({ ok: true, status: 200, json: async () => body });
const errJson = (message: string) => ({ ok: false, status: 400, json: async () => ({ error: { message } }) });

describe("MS6 WABA id setting", () => {
  it("updateWhatsAppWabaId stores the id in the encrypted credential and audits only { set }", async () => {
    const { svc, tables, auditLogs } = buildInbox();
    const out = await svc.updateWhatsAppWabaId("org-1", "owner", "WABA777");
    expect(out).toEqual({ integrationId: "int-1", wabaId: "WABA777" });
    const secrets = decryptJson<any>(tables.integrationCredential.rows[0].encryptedData);
    expect(secrets.wabaId).toBe("WABA777");
    expect(secrets.accessToken).toBe("tok-secret"); // the rest of the credential is preserved
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].action).toBe("integration.whatsapp.waba_updated");
    expect(auditLogs[0].metadata).toEqual({ set: true });
    expect(JSON.stringify(auditLogs)).not.toContain("tok-secret");

    const cleared = await svc.updateWhatsAppWabaId("org-1", "owner", null);
    expect(cleared.wabaId).toBeNull();
    expect(decryptJson<any>(tables.integrationCredential.rows[0].encryptedData).wabaId).toBeUndefined();
    expect(auditLogs[1].metadata).toEqual({ set: false });
  });

  it("updateWhatsAppWabaId 404s honestly when no WhatsApp integration is connected", async () => {
    const { svc } = buildInbox({ withIntegration: false });
    await expect(svc.updateWhatsAppWabaId("org-1", "owner", "WABA1")).rejects.toMatchObject({ code: "inbox.noConnectedWhatsappIntegrationForThis" });
  });

  it("connectMessaging stores wabaId for whatsapp only; listMessagingIntegrations exposes it (never the token)", async () => {
    const { svc, tables } = buildInbox({ wabaId: "WABA123" });
    // list: wabaId flows from the decrypted credential.
    const list = await svc.listMessagingIntegrations("org-1");
    expect(list[0].wabaId).toBe("WABA123");
    expect(JSON.stringify(list)).not.toContain("tok-secret");
    // connect: a messenger connect must NOT store a wabaId.
    stubFetch(async () => okJson({ id: "page-1", name: "Page" }));
    tables.integration.rows.length = 0; tables.integrationCredential.rows.length = 0;
    // Rebuild create-capable tables (makeTable create is on the spread base).
    const created = await svc.connectMessaging("org-1", "owner", {
      channel: "whatsapp", accessToken: "tok2", appSecret: "s", verifyToken: "v", phoneNumberId: "555", wabaId: "WABA999",
    });
    expect(created.provider).toBe("whatsapp");
    const credRow = tables.integrationCredential.rows.find((c: any) => c.integrationId === created.id);
    expect(decryptJson<any>(credRow.encryptedData).wabaId).toBe("WABA999");
  });
});

describe("MS6 template sync", () => {
  const page1 = {
    data: [{
      id: 777, name: "eid_offer", language: "bn", category: "MARKETING", status: "APPROVED",
      quality_score: { score: "GREEN" },
      components: [{ type: "HEADER", format: "TEXT", text: "হেডার" }, { type: "BODY", text: "আসল বডি {{1}}" }],
    }],
    paging: { cursors: { before: "b1", after: "c2" }, next: "https://graph.example/next" },
  };
  const page2 = {
    data: [{
      id: "mt-2", name: "delivery_update", language: "en", category: "UTILITY", status: "PENDING",
      quality_score: "YELLOW",
      components: [{ type: "BODY", text: "Your order is on the way" }],
    }],
    paging: { cursors: { before: "b2" } },
  };

  it("upserts by (name, language): status/quality/components/meta id stored, bodyText from the BODY component; complete sync marks NOT_ON_META", async () => {
    const { svc, tables, auditLogs } = buildInbox({ wabaId: "WABA123" });
    tables.whatsAppTemplate.rows.push(
      { id: "wa-existing", organizationId: "org-1", name: "eid_offer", language: "bn", category: null, bodyText: "old preview", createdAt: new Date(), updatedAt: new Date() },
      { id: "wa-local", organizationId: "org-1", name: "local_only", language: "bn", category: null, bodyText: "local", status: null, createdAt: new Date(), updatedAt: new Date() },
    );
    const calls = stubFetch(async (url: string) => okJson(url.includes("after=c2") ? page2 : page1));
    const out = await svc.syncWhatsAppTemplates("org-1", "owner");
    expect(out).toEqual({ synced: 2, created: 1, updated: 1, notOnMeta: 1, truncated: false });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("/WABA123/message_templates");
    expect(calls[1].url).toContain("after=c2");

    const existing = tables.whatsAppTemplate.rows.find((r: any) => r.id === "wa-existing");
    expect(existing).toMatchObject({ metaTemplateId: "777", status: "APPROVED", qualityRating: "GREEN", category: "MARKETING", bodyText: "আসল বডি {{1}}" });
    expect(existing.components).toEqual(page1.data[0].components);
    expect(existing.lastSyncedAt).toBeInstanceOf(Date);

    const created = tables.whatsAppTemplate.rows.find((r: any) => r.name === "delivery_update");
    expect(created).toMatchObject({ metaTemplateId: "mt-2", status: "PENDING", qualityRating: "YELLOW", bodyText: "Your order is on the way" });

    const local = tables.whatsAppTemplate.rows.find((r: any) => r.id === "wa-local");
    expect(local.status).toBe("NOT_ON_META");
    expect(auditLogs.find((l: any) => l.action === "whatsapp_templates.sync")?.metadata).toEqual({ synced: 2, created: 1, updated: 1, notOnMeta: 1, truncated: false });
  });

  it("a truncated 10-page walk does NOT mark NOT_ON_META", async () => {
    const { svc, tables } = buildInbox({ wabaId: "WABA123" });
    tables.whatsAppTemplate.rows.push({ id: "wa-local", organizationId: "org-1", name: "local_only", language: "bn", status: null, createdAt: new Date(), updatedAt: new Date() });
    stubFetch(async (url: string) => {
      const m = url.match(/after=p(\d+)/);
      const page = m ? Number(m[1]) + 1 : 1;
      return okJson({
        data: [{ id: `mt-${page}`, name: `tpl_${page}`, language: "bn", category: "UTILITY", status: "APPROVED", components: [] }],
        paging: { cursors: { after: `p${page}` }, next: "https://graph.example/next" },
      });
    });
    const out = await svc.syncWhatsAppTemplates("org-1", "owner");
    expect(out.truncated).toBe(true);
    expect(out.synced).toBe(10);
    expect(out.notOnMeta).toBe(0);
    expect(tables.whatsAppTemplate.rows.find((r: any) => r.id === "wa-local").status).toBeNull();
  });

  it("a Meta error surfaces verbatim and NOTHING is written", async () => {
    const { svc, tables } = buildInbox({ wabaId: "WABA123" });
    tables.whatsAppTemplate.rows.push({ id: "wa-local", organizationId: "org-1", name: "local_only", language: "bn", status: null, createdAt: new Date(), updatedAt: new Date() });
    stubFetch(async () => errJson("(#100) Tried accessing nonexisting field"));
    await expect(svc.syncWhatsAppTemplates("org-1", "owner")).rejects.toThrow("(#100) Tried accessing nonexisting field");
    expect(tables.whatsAppTemplate.rows).toHaveLength(1);
    expect(tables.whatsAppTemplate.rows[0].status).toBeNull();
  });

  it("missing wabaId refuses with the Bengali guidance and zero fetch calls", async () => {
    const { svc } = buildInbox(); // no wabaId in the credential
    const calls = stubFetch(async () => okJson({ data: [] }));
    await expect(svc.syncWhatsAppTemplates("org-1", "owner")).rejects.toThrow(/WABA ID সেট করা নেই/);
    await expect(svc.submitWhatsAppTemplate("org-1", "owner", { name: "eid_offer", category: "MARKETING", bodyText: "hi" })).rejects.toThrow(/WABA ID সেট করা নেই/);
    expect(calls).toHaveLength(0);
  });
});

describe("MS6 template submit", () => {
  const fullDto = {
    name: "eid_offer", category: "MARKETING",
    bodyText: "ঈদের অফার: {{1}}-এ {{2}} টাকা ছাড়",
    exampleValues: ["শাড়ি", "৫০০"],
    headerType: "text" as const, headerText: "হ্যালো {{1}}", headerExample: "Rahim",
    buttons: [
      { type: "url" as const, text: "কিনুন", url: "https://shop.example/offer" },
      { type: "quick_reply" as const, text: "বন্ধ করুন" },
    ],
  };

  it("builds the documented UPPERCASE components payload and stores the row with Meta's returned status", async () => {
    const { svc, tables, auditLogs } = buildInbox({ wabaId: "WABA123" });
    const calls = stubFetch(async () => okJson({ id: "mt-9", status: "IN_APPEAL", category: "MARKETING" }));
    const row = await svc.submitWhatsAppTemplate("org-1", "owner", fullDto);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/WABA123/message_templates");
    expect(JSON.parse(calls[0].init.body)).toEqual({
      name: "eid_offer", language: "bn", category: "MARKETING",
      components: [
        { type: "HEADER", format: "TEXT", text: "হ্যালো {{1}}", example: { header_text: ["Rahim"] } },
        { type: "BODY", text: "ঈদের অফার: {{1}}-এ {{2}} টাকা ছাড়", example: { body_text: [["শাড়ি", "৫০০"]] } },
        { type: "BUTTONS", buttons: [{ type: "URL", text: "কিনুন", url: "https://shop.example/offer" }, { type: "QUICK_REPLY", text: "বন্ধ করুন" }] },
      ],
    });
    expect(row).toMatchObject({ name: "eid_offer", language: "bn", category: "MARKETING", metaTemplateId: "mt-9", status: "IN_APPEAL" });
    expect(row.components).toEqual(JSON.parse(calls[0].init.body).components);
    expect(row.lastSyncedAt).toBeInstanceOf(Date);
    expect(auditLogs.find((l: any) => l.action === "whatsapp_templates.submit")?.metadata).toEqual({ name: "eid_offer", language: "bn", status: "IN_APPEAL" });
  });

  it("defaults the stored status to PENDING when Meta returns an id without a status; image header uses the upload handle", async () => {
    const { svc } = buildInbox({ wabaId: "WABA123" });
    const calls = stubFetch(async () => okJson({ id: "mt-10" }));
    const row = await svc.submitWhatsAppTemplate("org-1", "owner", {
      name: "pic_offer", category: "UTILITY", bodyText: "ছবিসহ অফার",
      headerType: "image", headerHandle: "handle-abc",
    });
    expect(row.status).toBe("PENDING");
    expect(JSON.parse(calls[0].init.body).components[0]).toEqual({ type: "HEADER", format: "IMAGE", example: { header_handle: ["handle-abc"] } });
  });

  it("a Meta rejection is a verbatim 400 and NOTHING is stored", async () => {
    const { svc, tables } = buildInbox({ wabaId: "WABA123" });
    stubFetch(async () => errJson("Template with name eid_offer already exists"));
    await expect(svc.submitWhatsAppTemplate("org-1", "owner", fullDto)).rejects.toThrow("Template with name eid_offer already exists");
    expect(tables.whatsAppTemplate.rows).toHaveLength(0);
  });

  it("an invalid name is rejected locally (Bengali) with zero fetch calls", async () => {
    const { svc, tables } = buildInbox({ wabaId: "WABA123" });
    const calls = stubFetch(async () => okJson({ id: "x" }));
    await expect(svc.submitWhatsAppTemplate("org-1", "owner", { ...fullDto, name: "Eid Offer!" })).rejects.toThrow(/ছোট হাতের ইংরেজি অক্ষর/);
    expect(calls).toHaveLength(0);
    expect(tables.whatsAppTemplate.rows).toHaveLength(0);
  });

  it("missing examples for a parametrized body are rejected before any fetch", async () => {
    const { svc } = buildInbox({ wabaId: "WABA123" });
    const calls = stubFetch(async () => okJson({ id: "x" }));
    await expect(svc.submitWhatsAppTemplate("org-1", "owner", { ...fullDto, exampleValues: ["শুধু একটা"] })).rejects.toThrow(/exampleValues/);
    await expect(svc.submitWhatsAppTemplate("org-1", "owner", { name: "ok_name", category: "MARKETING", bodyText: "দাম {{1}}", exampleValues: ["১০০"], headerType: "image" })).rejects.toThrow(/headerHandle/);
    await expect(svc.submitWhatsAppTemplate("org-1", "owner", { name: "ok_name", category: "WRONG", bodyText: "x" })).rejects.toThrow(/ক্যাটাগরি/);
    expect(calls).toHaveLength(0);
  });
});

// ---------- MessagingService: rich broadcasts ----------
function buildMessaging() {
  const tables: any = {
    messageTemplate: makeTable("tpl"), broadcast: makeTable("bc"), messageDelivery: makeTable("dlv"),
    customer: makeTable("cust"), lead: makeTable("lead"), whatsAppTemplate: makeTable("wa"),
    messagePreference: makeTable("pref"), messagingSetting: makeTable("mset"),
    messagingSavedAudience: makeTable("saud"), messagingSenderConfig: makeTable("scfg"),
    messageLinkClick: makeTable("click"), product: makeTable("prod"), integration: makeTable("int"),
    order: { rows: [], groupBy: async () => [], findFirst: async () => null, findMany: async () => [] },
  };
  tables.customer.rows.push({ id: "c1", organizationId: "org-1", firstName: "Ayesha", lastName: "Rahman", email: "ayesha@example.com", phone: "01712345678" });
  // Frequency cap OFF for this fixture: several broadcasts in one
  // test send to the same customer on purpose (the MS2 cap itself
  // is covered by the ms2 specs).
  tables.messagingSetting.rows.push({ id: "mset-1", organizationId: "org-1", frequencyCapPerDay: 0, whatsappOptInRequired: false, linkTrackingEnabled: true });
  tables.whatsAppTemplate.rows.push({ id: "wa-1", organizationId: "org-1", name: "eid_offer", language: "bn", bodyText: "template body" });
  tables.integration.rows.push({
    id: "int-1", organizationId: "org-1", provider: "whatsapp", status: "CONNECTED",
    credential: { encryptedData: encryptJson({ accessToken: "tok", phoneNumberId: "999" }) },
  });
  tables.systemSetting = { findUnique: async () => null };
  tables.organization = { findUnique: async () => ({ aiDailyLimitOverride: null, broadcastCapOverride: null, seatLimit: null }) };
  const email = { isConfigured: () => true, send: async () => ({ providerMessageId: "e-1" }) } as any;
  const sms = { isConfigured: () => true, send: async () => ({ providerMessageId: "s-1" }) } as any;
  const svc = new MessagingService(tables as any, { log: async () => undefined } as any, email, sms);
  return { svc, tables };
}

describe("MS6 messaging rich broadcasts", () => {
  it("createBroadcast stores templateComponents (both A/B variants via baseWa)", async () => {
    const { svc, tables } = buildMessaging();
    tables.whatsAppTemplate.rows.push({ id: "wa-2", organizationId: "org-1", name: "eid_offer_b", language: "bn", bodyText: "b body" });
    const tc = { headerMediaUrl: "https://img.example/h.png", buttonParams: [{ index: 0, subType: "url" as const, text: "x" }] };
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "wa", channel: "whatsapp", whatsappTemplateId: "wa-1", templateComponents: tc, audienceType: "customers",
    });
    expect(bc.templateComponents).toEqual(tc);
    const ab: any = await svc.createBroadcast("org-1", "owner", {
      name: "wa-ab", channel: "whatsapp", whatsappTemplateId: "wa-1", abWhatsappTemplateId: "wa-2",
      templateComponents: tc, audienceType: "customers", abTest: true,
    });
    expect(ab.variants[0].templateComponents).toEqual(tc);
    expect(ab.variants[1].templateComponents).toEqual(tc);
  });

  it("templateComponents on a non-WhatsApp channel, a non-http media URL, or a bad button = honest 400", async () => {
    const { svc } = buildMessaging();
    await expect(svc.createBroadcast("org-1", "owner", {
      name: "m", channel: "email", subject: "s", body: "b", audienceType: "customers",
      templateComponents: { headerMediaUrl: "https://img.example/h.png" },
    })).rejects.toMatchObject({ code: "messaging.templateComponentsIsOnlyAllowedForWhatsApp" });
    await expect(svc.createBroadcast("org-1", "owner", {
      name: "m", channel: "whatsapp", whatsappTemplateId: "wa-1", audienceType: "customers",
      templateComponents: { headerMediaUrl: "ftp://img.example/h.png" },
    })).rejects.toMatchObject({ code: "messaging.templateComponentsHeaderMediaUrlMustBeAnHttp" });
    await expect(svc.createBroadcast("org-1", "owner", {
      name: "m", channel: "whatsapp", whatsappTemplateId: "wa-1", audienceType: "customers",
      templateComponents: { buttonParams: [{ index: -1, subType: "url" }] },
    })).rejects.toMatchObject({ code: "messaging.templateComponentsButtonParamsIndexMustBeAn" });
    await expect(svc.createBroadcast("org-1", "owner", {
      name: "m", channel: "whatsapp", whatsappTemplateId: "wa-1", audienceType: "customers",
      templateComponents: { buttonParams: [{ index: 0, subType: "call" as any }] },
    })).rejects.toMatchObject({ code: "messaging.templateComponentsButtonParamsSubTypeMustBeUrl" });
  });

  it("the sender maps stored templateComponents per recipient ({name}/{key} substitution) into the Meta send body", async () => {
    const { svc } = buildMessaging();
    const calls: any[] = [];
    (global as any).fetch = async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid-1" }] }) };
    };
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "wa", channel: "whatsapp", whatsappTemplateId: "wa-1",
      templateParams: ["Body for {name}"],
      templateComponents: {
        headerMediaUrl: "https://img.example/h.png",
        buttonParams: [{ index: 0, subType: "url", text: "{name}-offer" }],
      },
      audienceType: "customers",
    });
    await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(calls).toHaveLength(1);
    expect(calls[0].body.template.components).toEqual([
      { type: "header", parameters: [{ type: "image", image: { link: "https://img.example/h.png" } }] },
      { type: "body", parameters: [{ type: "text", text: "Body for Ayesha Rahman" }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "Ayesha Rahman-offer" }] },
    ]);
  });

  it("header text params are substituted and sent when there is no media URL; no templateComponents = legacy body only", async () => {
    const { svc } = buildMessaging();
    const calls: any[] = [];
    (global as any).fetch = async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid-1" }] }) };
    };
    const withHeader = await svc.createBroadcast("org-1", "owner", {
      name: "wa-h", channel: "whatsapp", whatsappTemplateId: "wa-1",
      templateParams: ["B {name}"],
      templateComponents: { headerTextParams: ["হ্যালো {name}"] },
      audienceType: "customers",
    });
    await svc.sendBroadcast("org-1", "owner", withHeader.id);
    expect(calls[0].body.template.components).toEqual([
      { type: "header", parameters: [{ type: "text", text: "হ্যালো Ayesha Rahman" }] },
      { type: "body", parameters: [{ type: "text", text: "B Ayesha Rahman" }] },
    ]);

    const legacy = await svc.createBroadcast("org-1", "owner", {
      name: "wa-l", channel: "whatsapp", whatsappTemplateId: "wa-1",
      templateParams: ["B {name}"], audienceType: "customers",
    });
    expect(legacy.templateComponents).toBeNull();
    await svc.sendBroadcast("org-1", "owner", legacy.id);
    expect(calls[1].body.template.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "B Ayesha Rahman" }] },
    ]);
  });
});
