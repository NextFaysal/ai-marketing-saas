import { MessagingService } from "./messaging.service";
import { TEMPLATE_VARIABLES } from "./variables";
import { appendUtm, rewriteBroadcastLinks, issueLinkToken, verifyLinkToken } from "./link-tracking";
import { composeCheck, SPAM_WORDS_EN, SPAM_WORDS_BN } from "./compose-check";
import { formatPriceMinor, productSnippetText, productSnippetHtml, couponSnippetText, couponSnippetHtml } from "./composer-blocks";
import { computeLastOrders } from "./rfm";
import { encryptJson } from "../integrations/crypto";

/**
 * MS5 — Composer v2: real snapshot personalization vars (customer
 * orders incl. the no-orders empty shape, leads, csv), HTML email
 * (+ footer in both parts, htmlBody-on-sms 400), broadcast /
 * template test sends (broadcast row untouched), UTM + signed
 * link tracking with the org toggle, the public redirect (click
 * recorded; tampered token records nothing), compose-check rules,
 * and product/coupon snippets from real Product rows.
 * Fake-prisma style like the MS1–MS4 specs.
 */
process.env.JWT_SECRET = "test-secret";
process.env.WEB_URL = "https://app.example.com";
process.env.API_PUBLIC_URL = "https://api.example.com";

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("not" in v) { const ok = v.not === null ? row[k] !== null && row[k] !== undefined : row[k] !== v.not; if (!ok) return false; }
      if ("in" in v && !v.in.includes(row[k])) return false;
      if ("lte" in v && !(new Date(row[k]).getTime() <= new Date(v.lte).getTime())) return false;
      if ("lt" in v && !(new Date(row[k]).getTime() < new Date(v.lt).getTime())) return false;
      if ("gte" in v && !(new Date(row[k]).getTime() >= new Date(v.gte).getTime())) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    return row[k] === v;
  });
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findUnique: async ({ where }: any) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where, take }: any = {}) => {
      const out = rows.filter((r) => matches(r, where ?? {}));
      return take ? out.slice(0, take) : out;
    },
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); if (row) { Object.assign(row, data); row.updatedAt = new Date(); } return row; },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); if (i >= 0) rows.splice(i, 1); return {}; },
  };
}

const CUSTOMERS = [
  { id: "c1", organizationId: "org-1", firstName: "Ayesha", lastName: "Rahman", email: "ayesha@example.com", phone: "01712345678" },
  { id: "c2", organizationId: "org-1", firstName: "Tanvir", lastName: null, email: "tanvir@example.com", phone: "01812345678" },
  { id: "c3", organizationId: "org-1", firstName: "NoMail", lastName: null, email: null, phone: "01912345678" },
];
const LEADS = [
  { id: "l1", organizationId: "org-1", name: "Lead One", email: "lead1@example.com", phone: "01912345671", stage: "qualified", source: "facebook", valueMinor: 25000n },
  { id: "l2", organizationId: "org-1", name: "Lead Two", email: null, phone: "01912345672", stage: "qualified", source: null, valueMinor: null },
];
// c1: two real orders (latest WC-1002) + one CANCELLED order that
// is newest of all — it must never surface as the "last order".
const ORDERS = [
  { id: "o1", organizationId: "org-1", customerId: "c1", status: "completed", externalNumber: "WC-1001", totalMinor: 50000n, placedAt: new Date("2026-09-01"), createdAt: new Date("2026-09-01") },
  { id: "o2", organizationId: "org-1", customerId: "c1", status: "completed", externalNumber: "WC-1002", totalMinor: 125050n, placedAt: new Date("2026-10-01"), createdAt: new Date("2026-10-01") },
  { id: "o3", organizationId: "org-1", customerId: "c1", status: "cancelled", externalNumber: "WC-CXL", totalMinor: 999999n, placedAt: new Date("2026-10-10"), createdAt: new Date("2026-10-10") },
];

function makeOrderTable(rows: any[]) {
  return {
    rows,
    groupBy: async ({ by, where }: any) => {
      const filtered = rows.filter((r) => {
        if (r.organizationId !== where.organizationId) return false;
        if (where.status?.not && r.status === where.status.not) return false;
        if (where.customerId?.not === null && (r.customerId === null || r.customerId === undefined)) return false;
        if (where.placedAt?.not === null && (r.placedAt === null || r.placedAt === undefined)) return false;
        if (where.placedAt === null && r.placedAt !== null && r.placedAt !== undefined) return false;
        return true;
      });
      const groups = new Map<string, any>();
      for (const r of filtered) {
        const key = r[by[0]];
        const g = groups.get(key) ?? { customerId: key, count: 0, sum: 0n, maxPlaced: null, maxCreated: null };
        g.count += 1; g.sum += BigInt(r.totalMinor ?? 0);
        if (r.placedAt && (!g.maxPlaced || r.placedAt > g.maxPlaced)) g.maxPlaced = r.placedAt;
        if (r.createdAt && (!g.maxCreated || r.createdAt > g.maxCreated)) g.maxCreated = r.createdAt;
        groups.set(key, g);
      }
      return [...groups.values()].map((g) => ({
        customerId: g.customerId, _count: { _all: g.count },
        _sum: { totalMinor: g.sum }, _max: { placedAt: g.maxPlaced, createdAt: g.maxCreated },
      }));
    },
    findFirst: async ({ where }: any) => {
      const filtered = rows.filter((r) => matches(r, where ?? {}));
      filtered.sort((a, b) => {
        const pa = a.placedAt ? new Date(a.placedAt).getTime() : 0;
        const pb = b.placedAt ? new Date(b.placedAt).getTime() : 0;
        if (pb !== pa) return pb - pa;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      return filtered[0] ?? null;
    },
  };
}

function build(opts?: { failEmailFor?: Set<string> }) {
  const tables: any = {
    messageTemplate: makeTable("tpl"), broadcast: makeTable("bc"), messageDelivery: makeTable("dlv"),
    customer: makeTable("cust"), lead: makeTable("lead"), whatsAppTemplate: makeTable("wa"),
    messagePreference: makeTable("pref"), messagingSetting: makeTable("mset"),
    messagingSavedAudience: makeTable("saud"), messagingSenderConfig: makeTable("scfg"),
    messageLinkClick: makeTable("click"), product: makeTable("prod"), integration: makeTable("int"),
    order: makeOrderTable(ORDERS.map((o) => ({ ...o }))),
  };
  for (const c of CUSTOMERS) tables.customer.rows.push({ ...c });
  for (const l of LEADS) tables.lead.rows.push({ ...l });
  tables.systemSetting = { findUnique: async () => null };
  tables.organization = { findUnique: async () => ({ aiDailyLimitOverride: null, broadcastCapOverride: null, seatLimit: null }) };
  const emailCalls: any[] = [];
  const email = {
    isConfigured: () => true,
    send: async (input: any) => {
      emailCalls.push(input);
      if (opts?.failEmailFor?.has(input.to)) throw new Error("SMTP rejected recipient");
      return { providerMessageId: `<id-${input.to}>` };
    },
  } as any;
  const smsCalls: any[] = [];
  const sms = {
    isConfigured: () => true,
    send: async (input: any) => { smsCalls.push(input); return { providerMessageId: `sms-${input.to}` }; },
  } as any;
  const svc = new MessagingService(tables as any, { log: async () => undefined } as any, email, sms);
  return { svc, tables, emailCalls, smsCalls };
}

describe("MS5 snapshot vars from real rows", () => {
  it("customer WITH orders: lastOrder* from the latest non-cancelled order; ordersCount is real", async () => {
    const { svc } = build();
    const bc = await svc.createBroadcast("org-1", "owner", { name: "m", channel: "email", subject: "s", body: "b", audienceType: "customers" });
    const prepared: any = await svc.prepareBroadcast("org-1", bc.id);
    const c1 = prepared.recipientSnapshot.find((e: any) => e.id === "c1");
    expect(c1.vars).toEqual({
      name: "Ayesha Rahman", firstName: "Ayesha", lastName: "Rahman",
      email: "ayesha@example.com", phone: "01712345678",
      lastOrderNumber: "WC-1002", lastOrderTotal: "1250.50", ordersCount: 2,
    });
  });

  it("customer WITHOUT orders: ordersCount 0 and EMPTY lastOrder* — never invented", async () => {
    const { svc } = build();
    const bc = await svc.createBroadcast("org-1", "owner", { name: "m", channel: "email", subject: "s", body: "b", audienceType: "customers" });
    const prepared: any = await svc.prepareBroadcast("org-1", bc.id);
    const c2 = prepared.recipientSnapshot.find((e: any) => e.id === "c2");
    expect(c2.vars).toMatchObject({ firstName: "Tanvir", lastName: "", ordersCount: 0, lastOrderNumber: "", lastOrderTotal: "" });
  });

  it("computeLastOrders: cancelled newest order is skipped; a customer with none is absent", async () => {
    const { tables } = build();
    const map = await computeLastOrders(tables as any, "org-1", ["c1", "c2"]);
    expect(map.get("c1")).toEqual({ externalNumber: "WC-1002", totalMinor: "125050" });
    expect(map.has("c2")).toBe(false);
  });

  it("lead vars come from the lead row (value in taka, nulls as empty)", async () => {
    const { svc } = build();
    const bc = await svc.createBroadcast("org-1", "owner", { name: "m", channel: "sms", body: "b", audienceType: "leads_stage", audienceStage: "qualified" });
    const prepared: any = await svc.prepareBroadcast("org-1", bc.id);
    const l1 = prepared.recipientSnapshot.find((e: any) => e.id === "l1");
    expect(l1.vars).toEqual({ name: "Lead One", email: "lead1@example.com", phone: "01912345671", stage: "qualified", source: "facebook", value: "250.00" });
    const l2 = prepared.recipientSnapshot.find((e: any) => e.id === "l2");
    expect(l2.vars).toMatchObject({ stage: "qualified", source: "", value: "" });
  });

  it("csv (unmatched) vars: name empty, address is the address id", async () => {
    const { svc } = build();
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "m", channel: "email", subject: "s", body: "b", audienceType: "csv", audienceCsv: "newperson@example.com",
    });
    const prepared: any = await svc.prepareBroadcast("org-1", bc.id);
    expect(prepared.recipientSnapshot).toHaveLength(1);
    expect(prepared.recipientSnapshot[0].vars).toEqual({ name: "", address: "newperson@example.com" });
  });

  it("prepare → process renders the vars into the provider body", async () => {
    const { svc, emailCalls } = build();
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "m", channel: "email", subject: "s",
      body: "Order {{lastOrderNumber}} total {{lastOrderTotal}} count {{ordersCount}} for {{firstName}}",
      audienceType: "customers",
    });
    await svc.sendBroadcast("org-1", "owner", bc.id);
    const toAyesha = emailCalls.find((c) => c.to === "ayesha@example.com");
    expect(toAyesha.text).toContain("Order WC-1002 total 1250.50 count 2 for Ayesha");
    const toTanvir = emailCalls.find((c) => c.to === "tanvir@example.com");
    expect(toTanvir.text).toContain("Order  total  count 0 for Tanvir");
  });

  it("a pre-MS5 snapshot entry WITHOUT vars still sends (defensive {})", async () => {
    const { svc, tables, emailCalls } = build();
    tables.broadcast.rows.push({
      id: "bc-old", organizationId: "org-1", channel: "email", subject: "s", body: "Hi {{name}}",
      status: "sending", totalRecipients: 1, sentCount: 0, failedCount: 0,
      recipientSnapshot: [{ type: "customer", id: "c1", name: "Ayesha Rahman", email: "ayesha@example.com", phone: null, status: "pending", attempts: 0 }],
    });
    const result = await svc.processBroadcast("org-1", "bc-old");
    expect(result.sent).toBe(1);
    expect(emailCalls[0].text).toContain("Hi Ayesha Rahman");
  });

  it("TEMPLATE_VARIABLES lists exactly the keys prepare builds, per entity", () => {
    expect(TEMPLATE_VARIABLES.customer.map((v) => v.key)).toEqual(["name", "firstName", "lastName", "email", "phone", "lastOrderNumber", "lastOrderTotal", "ordersCount"]);
    expect(TEMPLATE_VARIABLES.lead.map((v) => v.key)).toEqual(["name", "email", "phone", "stage", "source", "value"]);
    expect(TEMPLATE_VARIABLES.csv.map((v) => v.key)).toEqual(["name", "address"]);
  });
});

describe("MS5 WhatsApp vars substitution", () => {
  const realFetch = global.fetch;
  afterEach(() => { (global as any).fetch = realFetch; });

  function seedWhatsApp(tables: any, fetchCalls: any[]) {
    tables.whatsAppTemplate.rows.push({ id: "wa-1", organizationId: "org-1", name: "eid_offer", language: "bn", bodyText: "template body" });
    tables.integration.rows.push({
      id: "int-1", organizationId: "org-1", provider: "whatsapp", status: "CONNECTED",
      credential: { encryptedData: encryptJson({ accessToken: "tok", phoneNumberId: "999" }) },
    });
    (global as any).fetch = async (url: string, init: any) => {
      fetchCalls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid-1" }] }) };
    };
  }

  it("template params substitute {name} AND any {key} from the entry vars", async () => {
    const { svc, tables } = build();
    const fetchCalls: any[] = [];
    seedWhatsApp(tables, fetchCalls);
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "wa", channel: "whatsapp", whatsappTemplateId: "wa-1",
      templateParams: ["Hello {name}, last order {lastOrderNumber}"], audienceType: "customers",
    });
    await svc.sendBroadcast("org-1", "owner", bc.id);
    const ayeshaCall = fetchCalls.find((c) => c.body.to === "8801712345678");
    expect(ayeshaCall.body.template.components[0].parameters[0].text).toBe("Hello Ayesha Rahman, last order WC-1002");
  });

  it("WhatsApp test send goes to ONE number, records a 'test' delivery, touches nothing else", async () => {
    const { svc, tables } = build();
    const fetchCalls: any[] = [];
    seedWhatsApp(tables, fetchCalls);
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "wa", channel: "whatsapp", whatsappTemplateId: "wa-1",
      templateParams: ["Hello {name}"], audienceType: "customers",
    });
    const before = JSON.stringify(tables.broadcast.rows[0]);
    const result: any = await svc.testSendBroadcast("org-1", "owner", bc.id, "01799999999");
    expect(result.status).toBe("sent");
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].body.to).toBe("8801799999999");
    expect(fetchCalls[0].body.template.components[0].parameters[0].text).toBe("Hello Test");
    expect(JSON.stringify(tables.broadcast.rows[0])).toBe(before);
    const deliveries = tables.messageDelivery.rows;
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ broadcastId: bc.id, recipientType: "test", recipientId: null, status: "sent", channel: "whatsapp" });
  });
});

describe("MS5 HTML email", () => {
  it("html passes to the provider rendered, with the unsubscribe footer in BOTH parts", async () => {
    const { svc, emailCalls } = build();
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "m", channel: "email", subject: "s", body: "Hi {{name}}",
      htmlBody: "<p>Hi {{name}}, order {{lastOrderNumber}}</p>", audienceType: "customers",
    });
    expect(bc.htmlBody).toContain("{{lastOrderNumber}}");
    await svc.sendBroadcast("org-1", "owner", bc.id);
    const call = emailCalls.find((c) => c.to === "ayesha@example.com");
    expect(call.html).toContain("<p>Hi Ayesha Rahman, order WC-1002</p>");
    expect(call.html).toContain('<p>—<br>এই ইমেইলটি পেতে না চাইলে <a href="https://app.example.com/unsubscribe/');
    expect(call.text).toContain("আনসাবস্ক্রাইব করুন: https://app.example.com/unsubscribe/");
  });

  it("without htmlBody the send is exactly the old text-only shape (no html key)", async () => {
    const { svc, emailCalls } = build();
    const bc = await svc.createBroadcast("org-1", "owner", { name: "m", channel: "email", subject: "s", body: "Hi", audienceType: "customers" });
    await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(emailCalls[0].html).toBeUndefined();
  });

  it("a template's htmlBody flows into a broadcast built from it", async () => {
    const { svc } = build();
    const tpl = await svc.createTemplate("org-1", "owner", { name: "t", channel: "email", subject: "Subj", body: "B", htmlBody: "<b>B</b>" });
    const bc = await svc.createBroadcast("org-1", "owner", { name: "m", channel: "email", templateId: tpl.id, audienceType: "customers" });
    expect(bc.subject).toBe("Subj");
    expect(bc.body).toBe("B");
    expect(bc.htmlBody).toBe("<b>B</b>");
  });

  it("A/B: htmlBody lands on variant A only; variant B stays null", async () => {
    const { svc } = build();
    const created: any = await svc.createBroadcast("org-1", "owner", {
      name: "ab", channel: "email", subject: "s", body: "A body", htmlBody: "<p>A</p>",
      audienceType: "customers", abTest: true, abBody: "B body",
    });
    expect(created.variants[0].htmlBody).toBe("<p>A</p>");
    expect(created.variants[1].htmlBody).toBeNull();
  });

  it("htmlBody on an sms template / sms broadcast / template update = honest 400", async () => {
    const { svc } = build();
    await expect(svc.createTemplate("org-1", "owner", { name: "t", channel: "sms", body: "b", htmlBody: "<p>x</p>" }))
      .rejects.toThrow(/htmlBody is only allowed for email/);
    const smsTpl = await svc.createTemplate("org-1", "owner", { name: "t2", channel: "sms", body: "b" });
    await expect(svc.updateTemplate("org-1", smsTpl.id, { htmlBody: "<p>x</p>" }))
      .rejects.toThrow(/htmlBody is only allowed for email/);
    await expect(svc.createBroadcast("org-1", "owner", { name: "m", channel: "sms", body: "b", htmlBody: "<p>x</p>", audienceType: "customers" }))
      .rejects.toThrow(/htmlBody is only allowed for email/);
    await expect(svc.createBroadcast("org-1", "owner", { name: "m", channel: "whatsapp", whatsappTemplateId: "wa-x", htmlBody: "<p>x</p>", audienceType: "customers" }))
      .rejects.toThrow(/htmlBody is only allowed for email/);
  });
});

describe("MS5 test sends", () => {
  it("broadcast test send: markers + footer + test delivery; broadcast row/counters/snapshot untouched", async () => {
    const { svc, tables, emailCalls } = build();
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "m", channel: "email", subject: "Sale", body: "Hi {{name}}", htmlBody: "<p>Hi</p>", audienceType: "customers",
    });
    const before = JSON.stringify(tables.broadcast.rows[0]);
    const result: any = await svc.testSendBroadcast("org-1", "owner", bc.id, "owner@example.com");
    expect(result.status).toBe("sent");
    expect(JSON.stringify(tables.broadcast.rows[0])).toBe(before);
    expect(tables.broadcast.rows[0].recipientSnapshot ?? null).toBeNull();
    expect(emailCalls).toHaveLength(1);
    expect(emailCalls[0].to).toBe("owner@example.com");
    expect(emailCalls[0].subject).toBe("[TEST] Sale");
    expect(emailCalls[0].text.startsWith("🧪 এটি একটি টেস্ট বার্তা — আসল গ্রাহকদের কাছে যায়নি।\n\nHi Test")).toBe(true);
    expect(emailCalls[0].html.startsWith("<p>🧪 এটি একটি টেস্ট বার্তা — আসল গ্রাহকদের কাছে যায়নি।</p><p>Hi</p>")).toBe(true);
    // BroadcastId is set on the send, so the footer renders as in a real broadcast.
    expect(emailCalls[0].text).toContain("আনসাবস্ক্রাইব করুন:");
    const deliveries = tables.messageDelivery.rows;
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ broadcastId: bc.id, recipientType: "test", recipientId: null, status: "sent" });
  });

  it("a failed broadcast test send returns the provider error and records a failed test delivery", async () => {
    const { svc, tables } = build({ failEmailFor: new Set(["bad@example.com"]) });
    const bc = await svc.createBroadcast("org-1", "owner", { name: "m", channel: "email", subject: "s", body: "b", audienceType: "customers" });
    const result: any = await svc.testSendBroadcast("org-1", "owner", bc.id, "bad@example.com");
    expect(result.status).toBe("failed");
    expect(result.error).toContain("SMTP rejected");
    expect(tables.messageDelivery.rows[0]).toMatchObject({ recipientType: "test", status: "failed" });
    expect(tables.broadcast.rows[0].status).toBe("draft");
  });

  it("template test send: template content, NO broadcast footer, delivery carries no broadcastId", async () => {
    const { svc, tables, emailCalls } = build();
    const tpl = await svc.createTemplate("org-1", "owner", { name: "t", channel: "email", subject: "Hello", body: "Body for {{name}}", htmlBody: "<p>B</p>" });
    const result: any = await svc.testSendTemplate("org-1", "owner", tpl.id, "owner@example.com");
    expect(result.status).toBe("sent");
    expect(emailCalls[0].text).toBe("Body for Test");
    expect(emailCalls[0].text).not.toContain("আনসাবস্ক্রাইব");
    expect(tables.messageDelivery.rows[0]).toMatchObject({ broadcastId: null, recipientType: "test", recipientId: null, status: "sent" });
  });

  it("test sends 404 honestly for a missing broadcast/template and 400 without an address", async () => {
    const { svc } = build();
    await expect(svc.testSendBroadcast("org-1", "owner", "nope", "x@example.com")).rejects.toThrow(/Broadcast not found/);
    await expect(svc.testSendTemplate("org-1", "owner", "nope", "x@example.com")).rejects.toThrow(/Template not found/);
    const bc = await svc.createBroadcast("org-1", "owner", { name: "m", channel: "email", subject: "s", body: "b", audienceType: "customers" });
    await expect(svc.testSendBroadcast("org-1", "owner", bc.id, "  ")).rejects.toThrow(/test recipient address is required/);
  });
});

describe("MS5 link tracking + UTM", () => {
  it("appendUtm adds the three params, preserves existing ones, never duplicates", () => {
    const out = appendUtm("https://shop.example/p?utm_source=old&x=1", "bc-9", "email");
    const url = new URL(out);
    expect(url.searchParams.get("utm_source")).toBe("old");
    expect(url.searchParams.get("x")).toBe("1");
    expect(url.searchParams.get("utm_medium")).toBe("broadcast");
    expect(url.searchParams.get("utm_campaign")).toBe("bc-9");
    expect(out.match(/utm_source=/g)).toHaveLength(1);
    const plain = new URL(appendUtm("https://shop.example/sale", "bc-9", "sms"));
    expect(plain.searchParams.get("utm_source")).toBe("sms");
    expect(appendUtm("not a url", "bc-9", "email")).toBe("not a url");
  });

  it("toggle ON (default): an email broadcast link is wrapped; the redirect records the click and returns the UTM'd URL", async () => {
    const { svc, tables, emailCalls } = build();
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "m", channel: "email", subject: "s", body: "Visit https://shop.example/sale now", audienceType: "customers",
    });
    await svc.sendBroadcast("org-1", "owner", bc.id);
    const call = emailCalls.find((c) => c.to === "ayesha@example.com");
    expect(call.text).not.toContain("https://shop.example/sale");
    const m = call.text.match(/https:\/\/api\.example\.com\/public\/messaging\/redirect\/(\S+)/);
    expect(m).toBeTruthy();
    const token = m![1];
    // Token payload is the final UTM'd URL for THIS recipient.
    const payload = verifyLinkToken(token);
    expect(payload).toMatchObject({ orgId: "org-1", broadcastId: bc.id, recipientKey: "customer:c1" });
    const out = await svc.performLinkRedirect(token);
    const target = new URL(out.url);
    expect(target.origin + target.pathname).toBe("https://shop.example/sale");
    expect(target.searchParams.get("utm_source")).toBe("email");
    expect(target.searchParams.get("utm_medium")).toBe("broadcast");
    expect(target.searchParams.get("utm_campaign")).toBe(bc.id);
    expect(tables.messageLinkClick.rows).toHaveLength(1);
    expect(tables.messageLinkClick.rows[0]).toMatchObject({ organizationId: "org-1", broadcastId: bc.id, recipientKey: "customer:c1", url: out.url });
    // The unsubscribe footer link stays DIRECT (never wrapped).
    expect(call.text).toContain("https://app.example.com/unsubscribe/");
  });

  it("tampered token: 400, NOTHING recorded, no redirect", async () => {
    const { svc, tables } = build();
    const token = issueLinkToken({ orgId: "org-1", broadcastId: "bc-1", recipientKey: "customer:c1", url: "https://shop.example/sale" });
    const tampered = token.slice(0, -2) + (token.endsWith("aa") ? "bb" : "aa");
    await expect(svc.performLinkRedirect(tampered)).rejects.toThrow(/অবৈধ বা মেয়াদোত্তীর্ণ/);
    await expect(svc.performLinkRedirect("garbage")).rejects.toThrow(/অবৈধ বা মেয়াদোত্তীর্ণ/);
    expect(tables.messageLinkClick.rows).toHaveLength(0);
  });

  it("toggle OFF: links are sent exactly as authored — no UTM, no wrap (email AND sms)", async () => {
    const { svc, emailCalls, smsCalls } = build();
    await svc.updateMessagingSetting("org-1", "owner", { linkTrackingEnabled: false });
    expect((await svc.getMessagingSetting("org-1")).linkTrackingEnabled).toBe(false);
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "m", channel: "email", subject: "s", body: "Visit https://shop.example/sale now", audienceType: "customers",
    });
    await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(emailCalls[0].text).toContain("Visit https://shop.example/sale now");
    expect(emailCalls[0].text).not.toContain("utm_");
    expect(emailCalls[0].text).not.toContain("/public/messaging/redirect/");

    const smsBc = await svc.createBroadcast("org-1", "owner", {
      name: "m2", channel: "sms", body: "Visit https://shop.example/sale now", audienceType: "customers",
    });
    await svc.sendBroadcast("org-1", "owner", smsBc.id);
    expect(smsCalls[0].text).toContain("Visit https://shop.example/sale now");
    expect(smsCalls[0].text).not.toContain("utm_");
  });

  it("toggle ON wraps SMS bodies too; workflow sends are NEVER rewritten", async () => {
    const { svc, smsCalls, emailCalls } = build();
    const bc = await svc.createBroadcast("org-1", "owner", {
      name: "m", channel: "sms", body: "Visit https://shop.example/sale now", audienceType: "customers",
    });
    await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(smsCalls[0].text).toContain("https://api.example.com/public/messaging/redirect/");
    expect(smsCalls[0].text).not.toContain("https://shop.example/sale");

    const wf: any = await svc.sendToRecipient("org-1", {
      channel: "email",
      recipient: { type: "customer", id: "c1", name: "Ayesha Rahman", email: "ayesha@example.com" },
      subject: "s", body: "Visit https://shop.example/sale now", vars: {}, workflowRunId: "run-1",
    });
    expect(wf.status).toBe("sent");
    expect(emailCalls[0].text).toContain("Visit https://shop.example/sale now");
    expect(emailCalls[0].text).not.toContain("utm_");
  });

  it("rewriteBroadcastLinks falls back to the UTM'd URL when no secret can sign", () => {
    const saved = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    try {
      const out = rewriteBroadcastLinks("Go https://shop.example/sale", { orgId: "org-1", broadcastId: "bc-1", channel: "email", recipientKey: "customer:c1" });
      expect(out).toContain("https://shop.example/sale?");
      expect(out).toContain("utm_campaign=bc-1");
      expect(out).not.toContain("/redirect/");
    } finally {
      process.env.JWT_SECRET = saved;
    }
  });

  it("settings: linkTrackingEnabled must be a real boolean", async () => {
    const { svc } = build();
    await expect(svc.updateMessagingSetting("org-1", "owner", { linkTrackingEnabled: "yes" as any })).rejects.toThrow(/linkTrackingEnabled must be a boolean/);
  });
});

describe("MS5 compose-check", () => {
  const codes = (w: { code: string }[]) => w.map((x) => x.code);

  it("SPAM_WORD fires for EN and BN trigger words, case-insensitively, listing the matches", () => {
    const w = composeCheck({ channel: "email", subject: "Hi", body: "Get FREE MONEY and টাকা জিতুন today" });
    expect(codes(w)).toContain("SPAM_WORD");
    expect(w[0].message).toContain("free money");
    expect(w[0].message).toContain("টাকা জিতুন");
    expect(SPAM_WORDS_EN).toContain("free money");
    expect(SPAM_WORDS_BN).toContain("লটারি");
  });

  it("CAPS_SUBJECT fires when >60% of a ≥10-letter subject is uppercase", () => {
    expect(codes(composeCheck({ channel: "email", subject: "BIG SALE OFFER NOW", body: "b" }))).toContain("CAPS_SUBJECT");
    expect(codes(composeCheck({ channel: "email", subject: "Big Sale Offer Now", body: "b" }))).not.toContain("CAPS_SUBJECT");
    expect(codes(composeCheck({ channel: "email", subject: "SALE", body: "b" }))).not.toContain("CAPS_SUBJECT"); // too short to judge
  });

  it("MANY_LINKS fires above 3 links; MISSING_SUBJECT only for email", () => {
    const body = "a https://a.example/1 https://a.example/2 https://a.example/3 https://a.example/4";
    expect(codes(composeCheck({ channel: "sms", body }))).toContain("MANY_LINKS");
    expect(codes(composeCheck({ channel: "email", body: "b" }))).toContain("MISSING_SUBJECT");
    expect(codes(composeCheck({ channel: "sms", body: "b" }))).not.toContain("MISSING_SUBJECT");
  });

  it("SMS_PARTS names the part count when the body exceeds 3 parts", () => {
    const w = composeCheck({ channel: "sms", body: "ঢ".repeat(250) }); // 250/67 → 4 parts
    const hit = w.find((x) => x.code === "SMS_PARTS");
    expect(hit).toBeTruthy();
    expect(hit!.message).toContain("4");
    expect(codes(composeCheck({ channel: "sms", body: "ছোট বার্তা" }))).not.toContain("SMS_PARTS");
  });

  it("BODY_TOO_LONG fires above 10000 chars; a clean message warns about nothing", () => {
    expect(codes(composeCheck({ channel: "email", subject: "s", body: "x".repeat(10001) }))).toContain("BODY_TOO_LONG");
    expect(composeCheck({ channel: "email", subject: "ঈদের অফার", body: "সব পণ্যে ছাড় চলছে।" })).toEqual([]);
  });

  it("the service endpoint shape is { warnings } and validates the channel", async () => {
    const { svc } = build();
    const out: any = svc.checkCompose({ channel: "email", body: "free money" });
    expect(codes(out.warnings)).toContain("SPAM_WORD");
    expect(() => svc.checkCompose({ channel: "pigeon", body: "b" })).toThrow(/channel must be/);
  });
});

describe("MS5 product + coupon snippets", () => {
  it("formatPriceMinor: BDT symbol + en-IN grouping + 2dp; other currencies keep the code", () => {
    expect(formatPriceMinor(125000n, "BDT")).toBe("৳1,250.00");
    expect(formatPriceMinor("50050", "BDT")).toBe("৳500.50");
    expect(formatPriceMinor(125000, "USD")).toBe("USD 1,250.00");
  });

  it("the composer-products endpoint builds snippets from REAL rows; no slug ⇒ no link anywhere", async () => {
    const { svc, tables } = build();
    tables.product.rows.push(
      { id: "p1", organizationId: "org-1", name: "Leather Wallet", slug: "wallet", priceMinor: 125000n, currency: "BDT", status: "ACTIVE", imageUrl: "https://img.example/w.png", createdAt: new Date("2026-10-02") },
      { id: "p2", organizationId: "org-1", name: "No Link Product", slug: null, priceMinor: 5000n, currency: "BDT", status: "ACTIVE", imageUrl: null, createdAt: new Date("2026-10-01") },
      { id: "p3", organizationId: "org-1", name: "Draft Product", slug: "draft", priceMinor: 100n, currency: "BDT", status: "DRAFT", imageUrl: null, createdAt: new Date("2026-10-03") },
    );
    const out: any[] = await svc.listComposerProducts("org-1");
    expect(out.map((p) => p.id)).toEqual(["p1", "p2"]); // ACTIVE only, newest first
    expect(out[0].priceMinor).toBe("125000");
    expect(out[0].url).toBe("https://app.example.com/checkout/wallet");
    expect(out[0].snippetText).toBe("Leather Wallet — ৳1,250.00\nhttps://app.example.com/checkout/wallet");
    expect(out[0].snippetHtml).toBe('<p><strong>Leather Wallet</strong> — ৳1,250.00</p><p><a href="https://app.example.com/checkout/wallet">কিনুন</a></p>');
    expect(out[1].url).toBeNull();
    expect(out[1].snippetText).toBe("No Link Product — ৳50.00");
    expect(out[1].snippetHtml).not.toContain("<a ");
  });

  it("product snippet helpers escape HTML in name/url", () => {
    const p = { name: 'Bag <script>"x"</script>', priceMinor: 10000n, currency: "BDT", url: "https://app.example.com/checkout/a?x=1&y=2" };
    expect(productSnippetText(p)).toContain('Bag <script>"x"</script> — ৳100.00');
    const html = productSnippetHtml(p);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("x=1&amp;y=2");
    expect(productSnippetHtml({ ...p, url: null })).not.toContain("<a ");
  });

  it("coupon snippets: code + optional label, code in <strong> for HTML", () => {
    expect(couponSnippetText({ code: "EID10" })).toBe("কুপন কোড: EID10");
    expect(couponSnippetText({ code: "EID10", label: "ঈদ অফার" })).toBe("কুপন কোড: EID10 — ঈদ অফার");
    expect(couponSnippetHtml({ code: "EID10", label: "ঈদ অফার" })).toBe("<p>কুপন কোড: <strong>EID10</strong> — ঈদ অফার</p>");
  });
});
