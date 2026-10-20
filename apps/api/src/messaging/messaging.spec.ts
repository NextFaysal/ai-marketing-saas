import { renderTemplate, evaluateConditions } from "./render";
import { normalizeBdPhone, SmsProvider } from "./sms.provider";
import { MessagingService } from "./messaging.service";

describe("renderTemplate", () => {
  it("substitutes known variables and blanks unknown ones (never invents)", () => {
    expect(renderTemplate("Hi {{name}}, order {{orderNumber}} total {{total}} {{missing}}", { name: "Ayesha", orderNumber: "1001", total: 1760 }))
      .toBe("Hi Ayesha, order 1001 total 1760 ");
  });
});

describe("evaluateConditions", () => {
  it("all conditions must pass; numeric ops compare as numbers", () => {
    const ctx = { total: 1500, stage: "qualified", source: "whatsapp" };
    expect(evaluateConditions(ctx, [{ field: "total", op: "gte", value: 1000 }, { field: "stage", op: "eq", value: "qualified" }])).toBe(true);
    expect(evaluateConditions(ctx, [{ field: "total", op: "gt", value: 2000 }])).toBe(false);
    expect(evaluateConditions(ctx, [])).toBe(true);
    expect(evaluateConditions(ctx, undefined)).toBe(true);
  });
});

describe("normalizeBdPhone", () => {
  it("normalizes common BD formats and rejects junk", () => {
    expect(normalizeBdPhone("01712345678")).toBe("8801712345678");
    expect(normalizeBdPhone("+880 1712-345678")).toBe("8801712345678");
    expect(normalizeBdPhone("1712345678")).toBe("8801712345678");
    expect(normalizeBdPhone("123")).toBeNull();
  });
});

describe("SmsProvider (SSL Wireless)", () => {
  const OLD = { ...process.env };
  beforeEach(() => { process.env.SMS_API_TOKEN = "tok"; process.env.SMS_SENDER_ID = "QOSPREY"; });
  afterEach(() => { process.env = { ...OLD }; });
  it("SUCCESS envelope counts as sent with the csms reference", async () => {
    const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ status: "SUCCESS", csms_id: "ref-1" }) }) as any;
    const provider = new SmsProvider(fetchFn as any);
    await expect(provider.send({ to: "8801712345678", text: "hello", reference: "ref-1" })).resolves.toEqual({ providerMessageId: "ref-1" });
  });
  it("FAILED envelope is an error, never a send", async () => {
    const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ status: "FAILED", error_message: "Insufficient balance" }) }) as any;
    const provider = new SmsProvider(fetchFn as any);
    await expect(provider.send({ to: "8801712345678", text: "hello", reference: "r" })).rejects.toThrow("Insufficient balance");
  });
  it("missing configuration is an explicit error", async () => {
    delete process.env.SMS_API_TOKEN;
    const provider = new SmsProvider((async () => { throw new Error("must not be called"); }) as any);
    await expect(provider.send({ to: "8801712345678", text: "x", reference: "r" })).rejects.toThrow("not configured");
  });
});

function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) return true;
    return row[k] === v;
  });
}
function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findFirst: async ({ where }: any) => rows.find((r) => matches(r, where ?? {})) ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => { const row = rows.find((r) => r.id === where.id); Object.assign(row, data); return row; },
  };
}

describe("MessagingService broadcasts", () => {
  function build(emailBehavior: (to: string) => Promise<any>) {
    const tables: any = { messageTemplate: makeTable("tpl"), broadcast: makeTable("bc"), messageDelivery: makeTable("dlv"), customer: makeTable("cust"), lead: makeTable("lead") };
    tables.customer.rows.push(
      { id: "c1", organizationId: "org-1", firstName: "Ayesha", lastName: "Rahman", email: "ayesha@example.com", phone: "01712345678" },
      { id: "c2", organizationId: "org-1", firstName: "Tanvir", lastName: null, email: "bad@example.com", phone: null },
      { id: "c3", organizationId: "org-1", firstName: "NoMail", lastName: null, email: null, phone: "01812345678" },
    );
    const email = { isConfigured: () => true, send: async ({ to }: any) => emailBehavior(to) } as any;
    const sms = { isConfigured: () => false, send: async () => { throw new Error("SMS is not configured"); } } as any;
    const svc = new MessagingService(tables as any, { log: async () => undefined } as any, email, sms);
    return { svc, tables };
  }

  it("partial broadcast: successes and failures counted separately, failures carry the provider error", async () => {
    const { svc, tables } = build(async (to) => {
      if (to === "bad@example.com") throw new Error("SMTP rejected recipient");
      return { providerMessageId: `<id-${to}>` };
    });
    const bc = await svc.createBroadcast("org-1", "owner", { name: "Eid mail", channel: "email", subject: "Eid offer", body: "Hello {{name}}", audienceType: "customers" });
    const sent = await svc.sendBroadcast("org-1", "owner", bc.id);
    // Only 2 of 3 customers have emails; 1 of those fails at the provider.
    expect(sent.totalRecipients).toBe(2);
    expect(sent.sentCount).toBe(1);
    expect(sent.failedCount).toBe(1);
    expect(sent.status).toBe("partial");
    const deliveries = tables.messageDelivery.rows;
    expect(deliveries.filter((d: any) => d.status === "sent")[0].providerMessageId).toContain("ayesha@example.com");
    expect(deliveries.filter((d: any) => d.status === "failed")[0].error).toContain("SMTP rejected");
  });

  it("an unconfigured channel ends as failed, never as sent", async () => {
    const { svc } = build(async () => ({ providerMessageId: "x" }));
    const bc = await svc.createBroadcast("org-1", "owner", { name: "SMS blast", channel: "sms", body: "Hello", audienceType: "customers" });
    const sent = await svc.sendBroadcast("org-1", "owner", bc.id);
    expect(sent.status).toBe("failed");
    expect(sent.sentCount).toBe(0);
  });

  it("a sent broadcast cannot be sent twice", async () => {
    const { svc } = build(async () => ({ providerMessageId: "ok" }));
    const bc = await svc.createBroadcast("org-1", "owner", { name: "Once", channel: "email", subject: "s", body: "b", audienceType: "customers" });
    await svc.sendBroadcast("org-1", "owner", bc.id);
    await expect(svc.sendBroadcast("org-1", "owner", bc.id)).rejects.toMatchObject({ code: "messaging.thisBroadcastWasAlreadySentOr" });
  });
});
