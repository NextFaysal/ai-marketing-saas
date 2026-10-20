import { MessagingService } from "./messaging.service";
import { EmailProvider } from "./email.provider";
import { SmsProvider, normalizeBdPhone, normalizePhoneGeneric } from "./sms.provider";
import { smsSegments } from "./sms-segments";
import { seal } from "../common/platform-config";

/**
 * MS4 — Per-tenant senders & providers: verify-before-save tenant
 * SMTP (a failed handshake stores NOTHING), tenant-over-platform
 * resolution on the real send path, the secret-free safe view,
 * the three SMS gateway adapters behind fake fetch (success AND
 * failure envelopes), generic phone normalization (BD unchanged),
 * SPF/DKIM domain health via the injectable resolver, the pure
 * sms-segments helper, and rate-based preview cost estimates.
 * Fake-prisma style like the MS1–MS3 specs.
 */
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("not" in v) { const ok = v.not === null ? row[k] !== null && row[k] !== undefined : row[k] !== v.not; if (!ok) return false; }
      if ("in" in v && !v.in.includes(row[k])) return false;
      return true;
    }
    if (v === null) return row[k] === null || row[k] === undefined;
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
    upsert: async ({ where, update, create }: any) => {
      const row = rows.find((r) => matches(r, where ?? {}));
      if (row) { Object.assign(row, update); row.updatedAt = new Date(); return row; }
      const created = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...create };
      rows.push(created); return created;
    },
    delete: async ({ where }: any) => { const i = rows.findIndex((r) => r.id === where.id); if (i >= 0) rows.splice(i, 1); return {}; },
  };
}

const CUSTOMERS = [1, 2, 3].map((n) => ({
  id: `c${n}`, organizationId: "org-1", firstName: `User${n}`, lastName: null,
  email: `user${n}@example.com`, phone: `0171234567${n}`, source: "website",
  createdAt: new Date(), customFields: {}, address: null,
}));

interface BuiltOpts {
  platformEmail?: boolean;
  platformSms?: boolean;
  verifyError?: string | null;
}

function build(opts: BuiltOpts = {}) {
  const tables: any = {
    messageTemplate: makeTable("tpl"), broadcast: makeTable("bc"), messageDelivery: makeTable("dlv"),
    customer: makeTable("cust"), lead: makeTable("lead"), whatsAppTemplate: makeTable("wa"),
    messagePreference: makeTable("pref"), messagingSetting: makeTable("mset"),
    messagingSavedAudience: makeTable("saud"), messagingSenderConfig: makeTable("scfg"),
  };
  for (const c of CUSTOMERS) tables.customer.rows.push({ ...c });
  tables.systemSetting = { findUnique: async () => null };
  tables.organization = { findUnique: async () => ({ aiDailyLimitOverride: null, broadcastCapOverride: null, seatLimit: null }) };
  const platformCalls: any[] = [];
  const tenantCalls: any[] = [];
  const verifyCalls: any[] = [];
  const email = {
    isConfigured: () => opts.platformEmail ?? true,
    send: async (input: any) => { platformCalls.push(input); return { providerMessageId: `<platform-${input.to}>` }; },
    verifyTenantSmtp: async (cfg: any) => {
      verifyCalls.push(cfg);
      if (opts.verifyError) throw new Error(opts.verifyError);
      return { ok: true };
    },
    sendTenant: async (orgId: string, cfg: any, input: any) => {
      tenantCalls.push({ orgId, cfg, input });
      return { providerMessageId: `<tenant-${input.to}>` };
    },
  } as any;
  const smsPlatformCalls: any[] = [];
  const smsTenantCalls: any[] = [];
  const sms = {
    isConfigured: () => opts.platformSms ?? true,
    send: async (input: any) => { smsPlatformCalls.push(input); return { providerMessageId: `platform-${input.to}` }; },
    sendWithGateway: async (gateway: string, cfg: any, input: any) => {
      smsTenantCalls.push({ gateway, cfg, input });
      return { providerMessageId: `tenant-${input.to}` };
    },
  } as any;
  const svc = new MessagingService(tables as any, { log: async () => undefined } as any, email, sms);
  return { svc, tables, platformCalls, tenantCalls, verifyCalls, smsPlatformCalls, smsTenantCalls };
}

function seedTenantEmail(tables: any) {
  tables.messagingSenderConfig.rows.push({
    id: "scfg-1", organizationId: "org-1",
    smtpHost: "mail.shop.example", smtpPort: 587, smtpUser: "shop@example.com",
    smtpPassEncrypted: seal("tenant-secret-pass"), fromAddress: "hello@shop.example", fromName: "My Shop",
    dkimSelector: null, smsGateway: null, smsApiKeyEncrypted: null, smsSenderId: null, smsApiUrl: null,
    smsCostPerPartMinor: null, whatsappCostPerMessageMinor: null, emailCostPerMessageMinor: null,
    createdAt: new Date(), updatedAt: new Date(),
  });
}
function seedTenantSms(tables: any, gateway = "bulksmsbd") {
  tables.messagingSenderConfig.rows.push({
    id: "scfg-1", organizationId: "org-1",
    smtpHost: null, smtpPort: null, smtpUser: null, smtpPassEncrypted: null, fromAddress: null, fromName: null,
    dkimSelector: null, smsGateway: gateway, smsApiKeyEncrypted: seal("tenant-sms-key-123"),
    smsSenderId: "MyShop", smsApiUrl: null,
    smsCostPerPartMinor: null, whatsappCostPerMessageMinor: null, emailCostPerMessageMinor: null,
    createdAt: new Date(), updatedAt: new Date(),
  });
}

describe("MS4 tenant SMTP verify-before-save", () => {
  it("a failed handshake stores NOTHING and surfaces the server error verbatim", async () => {
    const { svc, tables } = build({ verifyError: "535 5.7.8 Authentication failed" });
    await expect(svc.updateTenantEmail("org-1", "owner", {
      smtpHost: "mail.shop.example", smtpPort: 587, smtpUser: "shop@example.com",
      smtpPass: "wrong-pass", fromAddress: "hello@shop.example",
    })).rejects.toMatchObject({ code: "messaging.sMTPVerificationFailedNothingWasSaved" });
    expect(tables.messagingSenderConfig.rows).toHaveLength(0);
  });

  it("a successful verify persists with the password SEALED (never plaintext at rest)", async () => {
    const { svc, tables, verifyCalls } = build();
    const view: any = await svc.updateTenantEmail("org-1", "owner", {
      smtpHost: "mail.shop.example", smtpPort: 587, smtpUser: "shop@example.com",
      smtpPass: "tenant-secret-pass", fromAddress: "hello@shop.example", fromName: "My Shop",
    });
    expect(verifyCalls).toHaveLength(1);
    expect(verifyCalls[0]).toMatchObject({ host: "mail.shop.example", from: "hello@shop.example" });
    const row = tables.messagingSenderConfig.rows[0];
    expect(row.smtpPassEncrypted).toBeTruthy();
    expect(row.smtpPassEncrypted).not.toContain("tenant-secret-pass");
    expect(view.email.tenantConfigured).toBe(true);
    expect(view.email.smtpPassConfigured).toBe(true);
  });

  it("an update omitting the password keeps the stored one; clear wipes the tenant email", async () => {
    const { svc, tables, verifyCalls } = build();
    seedTenantEmail(tables);
    await svc.updateTenantEmail("org-1", "owner", { smtpHost: "mail2.shop.example" });
    expect(verifyCalls[0]).toMatchObject({ host: "mail2.shop.example", pass: "tenant-secret-pass" }); // kept, decrypted for verify
    const cleared: any = await svc.updateTenantEmail("org-1", "owner", { clear: true });
    expect(cleared.email.tenantConfigured).toBe(false);
    expect(tables.messagingSenderConfig.rows[0].smtpHost).toBeNull();
  });
});

describe("MS4 send-path resolution (tenant → platform)", () => {
  it("email sends go through the TENANT transport when configured; the platform spy stays silent", async () => {
    const { svc, tables, platformCalls, tenantCalls } = build();
    seedTenantEmail(tables);
    const result: any = await svc.sendToRecipient("org-1", {
      channel: "email",
      recipient: { type: "customer", id: "c1", name: "User1", email: "user1@example.com", phone: null },
      subject: "Hi", body: "Hello {{name}}", vars: {},
    });
    expect(result.status).toBe("sent");
    expect(tenantCalls).toHaveLength(1);
    expect(tenantCalls[0].cfg).toMatchObject({ host: "mail.shop.example", from: "hello@shop.example", pass: "tenant-secret-pass" });
    expect(platformCalls).toHaveLength(0);
  });

  it("without tenant config the platform path is used exactly as before", async () => {
    const { svc, platformCalls, tenantCalls } = build();
    const result: any = await svc.sendToRecipient("org-1", {
      channel: "email",
      recipient: { type: "customer", id: "c1", name: "User1", email: "user1@example.com", phone: null },
      subject: "Hi", body: "Hello", vars: {},
    });
    expect(result.status).toBe("sent");
    expect(platformCalls).toHaveLength(1);
    expect(tenantCalls).toHaveLength(0);
  });

  it("SMS sends go through the tenant gateway; providerStatus reports the per-org view", async () => {
    const { svc, tables, smsPlatformCalls, smsTenantCalls } = build();
    seedTenantSms(tables, "alphasms");
    const result: any = await svc.sendToRecipient("org-1", {
      channel: "sms",
      recipient: { type: "customer", id: "c1", name: "User1", email: null, phone: "01712345671" },
      body: "Hello", vars: {},
    });
    expect(result.status).toBe("sent");
    expect(result.address).toBe("8801712345671");
    expect(smsTenantCalls).toHaveLength(1);
    expect(smsTenantCalls[0].gateway).toBe("alphasms");
    expect(smsTenantCalls[0].cfg.apiKey).toBe("tenant-sms-key-123");
    expect(smsPlatformCalls).toHaveLength(0);
    const status: any = await svc.providerStatus("org-1");
    expect(status.sms).toMatchObject({ path: "tenant", gateway: "alphasms", tenantConfigured: true });
    expect(status.sms.provider).toBe("Alpha SMS (sms.net.bd)");
    expect(status.email.path).toBe("platform"); // platform email configured, no tenant SMTP
  });

  it("providerStatus without any config is honest: path none", async () => {
    const { svc } = build({ platformEmail: false, platformSms: false });
    const status: any = await svc.providerStatus("org-1");
    expect(status.email).toMatchObject({ configured: false, path: "none" });
    expect(status.sms).toMatchObject({ configured: false, path: "none", gateway: null });
  });
});

describe("MS4 safe view never leaks secrets", () => {
  it("the serialized settings view contains neither plaintext nor sealed secret values", async () => {
    const { svc, tables } = build();
    seedTenantEmail(tables);
    const row = tables.messagingSenderConfig.rows[0];
    row.smsGateway = "bulksmsbd";
    row.smsApiKeyEncrypted = seal("tenant-sms-key-123");
    row.smsSenderId = "MyShop";
    const view: any = await svc.getSenderSettings("org-1");
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("tenant-secret-pass");
    expect(serialized).not.toContain("tenant-sms-key-123");
    expect(serialized).not.toContain(row.smtpPassEncrypted);
    expect(serialized).not.toContain(row.smsApiKeyEncrypted);
    expect(view.email).toMatchObject({ tenantConfigured: true, smtpPassConfigured: true, smtpHost: "mail.shop.example", fromAddress: "hello@shop.example" });
    expect(view.sms).toMatchObject({ tenantConfigured: true, smsApiKeyConfigured: true, gateway: "bulksmsbd", smsSenderId: "MyShop" });
  });

  it("updateTenantSms validates the gateway and stores the key sealed", async () => {
    const { svc, tables } = build();
    await expect(svc.updateTenantSms("org-1", "owner", { smsGateway: "carrier-pigeon", smsApiKey: "k", smsSenderId: "S" }))
      .rejects.toMatchObject({ code: "messaging.smsGatewayMustBeSslwirelessBulksmsbdOr" });
    const view: any = await svc.updateTenantSms("org-1", "owner", { smsGateway: "bulksmsbd", smsApiKey: "tenant-sms-key-123", smsSenderId: "MyShop" });
    expect(view.sms.tenantConfigured).toBe(true);
    expect(tables.messagingSenderConfig.rows[0].smsApiKeyEncrypted).not.toContain("tenant-sms-key-123");
    expect(view.note).toMatch(/first real send is the proof/);
  });
});

describe("MS4 test send", () => {
  it("reports the tenant path when tenant SMTP is configured", async () => {
    const { svc, tables, tenantCalls } = build();
    seedTenantEmail(tables);
    const result: any = await svc.sendSenderTestEmail("org-1", "owner", "owner@example.com");
    expect(result).toMatchObject({ sent: true, path: "tenant" });
    expect(tenantCalls).toHaveLength(1);
  });

  it("falls back to platform and says so; unconfigured is an honest 400", async () => {
    const a = build();
    const result: any = await a.svc.sendSenderTestEmail("org-1", "owner", "owner@example.com");
    expect(result.path).toBe("platform");
    const b = build({ platformEmail: false });
    await expect(b.svc.sendSenderTestEmail("org-1", "owner", "owner@example.com")).rejects.toMatchObject({ code: "messaging.noEmailPathIsConfiguredFor" });
    await expect(a.svc.sendSenderTestEmail("org-1", "owner", "not-an-email")).rejects.toMatchObject({ code: "messaging.aValidTestRecipientEmailAddress" });
  });
});

function fakeFetch(handler: (url: string, init: any) => { status: number; json?: any; text?: string }) {
  const calls: { url: string; init: any }[] = [];
  const fn = async (url: string, init: any) => {
    calls.push({ url, init });
    const r = handler(url, init);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => { if (r.json === undefined) throw new Error("not json"); return r.json; },
      text: async () => r.text ?? JSON.stringify(r.json ?? {}),
    };
  };
  return { fn: fn as any, calls };
}

describe("MS4 SMS gateway adapters (fake fetch)", () => {
  const CFG = { apiKey: "KEY-1", senderId: "MyShop" };
  const INPUT = { to: "8801712345671", text: "Hello", reference: "ref123" };

  it("sslwireless: SUCCESS counts as sent; a failure envelope throws verbatim", async () => {
    const ok = fakeFetch(() => ({ status: 200, json: { status: "SUCCESS", csms_id: "csms-9" } }));
    const provider = new SmsProvider(ok.fn);
    await expect(provider.sendWithGateway("sslwireless", CFG, INPUT)).resolves.toEqual({ providerMessageId: "csms-9" });
    expect(ok.calls[0].url).toBe("https://smsplus.sslwireless.com/api/v3/send-sms");
    const bad = fakeFetch(() => ({ status: 200, json: { status: "FAILED", error_message: "Invalid MSISDN" } }));
    await expect(new SmsProvider(bad.fn).sendWithGateway("sslwireless", CFG, INPUT)).rejects.toThrow(/Invalid MSISDN/);
  });

  it("bulksmsbd: JSON 202 and bare-text 202 count as sent; failure codes throw with their meaning", async () => {
    const jsonOk = fakeFetch(() => ({ status: 200, json: { response_code: 202, message_id: undefined, success_message: "SMS Submitted Successfully" } }));
    await expect(new SmsProvider(jsonOk.fn).sendWithGateway("bulksmsbd", CFG, INPUT))
      .resolves.toEqual({ providerMessageId: "ref123" }); // no documented message id → the reference
    const form = new URLSearchParams(jsonOk.calls[0].init.body);
    expect(form.get("type")).toBe("text");
    expect(form.get("senderid")).toBe("MyShop");
    expect(form.get("number")).toBe("8801712345671");

    const textOk = fakeFetch(() => ({ status: 200, text: "202" }));
    await expect(new SmsProvider(textOk.fn).sendWithGateway("bulksmsbd", CFG, INPUT)).resolves.toEqual({ providerMessageId: "ref123" });

    const balance = fakeFetch(() => ({ status: 200, json: { response_code: 1007, error_message: "Balance Insufficient" } }));
    await expect(new SmsProvider(balance.fn).sendWithGateway("bulksmsbd", CFG, INPUT)).rejects.toThrow(/1007 — Balance Insufficient/);
    const badSender = fakeFetch(() => ({ status: 200, text: "1002" }));
    await expect(new SmsProvider(badSender.fn).sendWithGateway("bulksmsbd", CFG, INPUT)).rejects.toThrow(/Sender ID not correct/);
  });

  it("alphasms: error 0 with request_id counts as sent; error 417 throws the gateway msg verbatim", async () => {
    const ok = fakeFetch(() => ({ status: 200, json: { error: 0, msg: "Request successfully submitted", data: { request_id: 8841, to: "8801712345671" } } }));
    const provider = new SmsProvider(ok.fn);
    await expect(provider.sendWithGateway("alphasms", CFG, INPUT)).resolves.toEqual({ providerMessageId: "8841" });
    expect(ok.calls[0].url).toBe("https://api.sms.net.bd/sendsms");
    const body = JSON.parse(ok.calls[0].init.body);
    expect(body).toMatchObject({ api_key: "KEY-1", to: "8801712345671", sender_id: "MyShop", msg: "Hello" });
    const bad = fakeFetch(() => ({ status: 200, json: { error: 417, msg: "Insufficient balance" } }));
    await expect(new SmsProvider(bad.fn).sendWithGateway("alphasms", CFG, INPUT)).rejects.toThrow(/Insufficient balance/);
  });

  it("an unconfigured gateway config refuses before any HTTP call", async () => {
    const f = fakeFetch(() => ({ status: 200, json: {} }));
    await expect(new SmsProvider(f.fn).sendWithGateway("bulksmsbd", { apiKey: "", senderId: "" }, INPUT))
      .rejects.toThrow(/not configured for this organization/);
    expect(f.calls).toHaveLength(0);
  });
});

describe("MS4 EmailProvider tenant transport (real provider, fake transport seam)", () => {
  it("verifyTenantSmtp runs the handshake and a failure propagates verbatim", async () => {
    const provider = new EmailProvider();
    provider.tenantTransportFactory = () => ({ verify: async () => { throw new Error("535 Authentication failed"); }, sendMail: async () => ({}) });
    await expect(provider.verifyTenantSmtp({ host: "h", port: 587, from: "a@b.co" })).rejects.toThrow(/535 Authentication failed/);
  });

  it("sendTenant uses the tenant From (with name) and counts sent only on a message id", async () => {
    const provider = new EmailProvider();
    const sent: any[] = [];
    provider.tenantTransportFactory = () => ({
      verify: async () => true,
      sendMail: async (mail: any) => { sent.push(mail); return { messageId: "<tenant-1>" }; },
    });
    const result = await provider.sendTenant("org-1", { host: "h", port: 587, from: "hello@shop.example", fromName: "My Shop" }, { to: "x@y.co", subject: "s", text: "t" });
    expect(result.providerMessageId).toBe("<tenant-1>");
    expect(sent[0].from).toBe('"My Shop" <hello@shop.example>');

    const noId = new EmailProvider();
    noId.tenantTransportFactory = () => ({ verify: async () => true, sendMail: async () => ({}) });
    await expect(noId.sendTenant("org-1", { host: "h", port: 587, from: "a@b.co" }, { to: "x@y.co", subject: "s", text: "t" }))
      .rejects.toThrow(/did not return a message id/);
  });
});

describe("MS4 phone normalization", () => {
  it("BD behaviour is byte-identical to normalizeBdPhone", () => {
    for (const raw of ["01712345678", "+8801712345678", "8801712345678", "1712345678", "01712-345 678"]) {
      expect(normalizePhoneGeneric(raw)).toBe(normalizeBdPhone(raw));
    }
    expect(normalizePhoneGeneric("01712345678")).toBe("8801712345678");
  });

  it("plausible international numbers pass in E.164 digits form; junk still refuses", () => {
    expect(normalizePhoneGeneric("+14155552671")).toBe("14155552671");
    expect(normalizePhoneGeneric("+44 20 7946 0958")).toBe("442079460958");
    expect(normalizePhoneGeneric("919876543210")).toBe("919876543210");
    expect(normalizePhoneGeneric("12345")).toBeNull();
    expect(normalizePhoneGeneric("0171234567")).toBeNull(); // 10 digits starting 0 — unplaceable
    expect(normalizePhoneGeneric("call-me-maybe")).toBeNull();
    expect(normalizePhoneGeneric("+123")).toBeNull();
  });
});

describe("MS4 domain health (fake DNS resolver)", () => {
  function buildHealth(resolver: (name: string) => Promise<string[][]>) {
    const built = build();
    seedTenantEmail(built.tables); // From hello@shop.example
    built.svc.txtResolver = resolver;
    return built;
  }

  it("SPF + DKIM found, records returned", async () => {
    const built = build();
    seedTenantEmail(built.tables);
    built.tables.messagingSenderConfig.rows[0].dkimSelector = "mail";
    built.svc.txtResolver = async (name: string) => {
      if (name === "shop.example") return [["v=spf1 include:_spf.google.com ~all"]];
      if (name === "mail._domainkey.shop.example") return [["v=DKIM1; k=rsa; p=MIGfMA0"]];
      return [];
    };
    const health: any = await built.svc.getDomainHealth("org-1");
    expect(health.domain).toBe("shop.example");
    expect(health.source).toBe("tenant");
    expect(health.spf).toMatchObject({ status: "found", record: "v=spf1 include:_spf.google.com ~all" });
    expect(health.dkim).toMatchObject({ status: "found", selector: "mail" });
  });

  it("no SPF record = missing; no DKIM selector = not_checked with the honest reason", async () => {
    const { svc } = buildHealth(async () => [["v=DMARC1; p=none"]]);
    const health: any = await svc.getDomainHealth("org-1");
    expect(health.spf.status).toBe("missing");
    expect(health.dkim.status).toBe("not_checked");
    expect(health.dkim.reason).toMatch(/No DKIM selector is set/);
  });

  it("a DNS failure reports UNKNOWN — never missing", async () => {
    const { svc, tables } = buildHealth(async () => { throw new Error("queryTxt ENOTFOUND shop.example"); });
    tables.messagingSenderConfig.rows[0].dkimSelector = "mail";
    const health: any = await svc.getDomainHealth("org-1");
    expect(health.spf.status).toBe("unknown");
    expect(health.spf.reason).toMatch(/ENOTFOUND/);
    expect(health.dkim.status).toBe("unknown");
  });

  it("no From address anywhere = no domain to check, said plainly", async () => {
    const { svc } = build({ platformEmail: false });
    const health: any = await svc.getDomainHealth("org-1");
    expect(health.domain).toBeNull();
    expect(health.spf.status).toBe("unknown");
  });
});

describe("MS4 sms-segments (pure)", () => {
  it("GSM-7 boundaries: 160 single, 153 per part after", () => {
    expect(smsSegments("Hello")).toEqual({ encoding: "gsm7", length: 5, parts: 1 });
    expect(smsSegments("a".repeat(160)).parts).toBe(1);
    expect(smsSegments("a".repeat(161)).parts).toBe(2);
    expect(smsSegments("a".repeat(306)).parts).toBe(2);
    expect(smsSegments("a".repeat(307)).parts).toBe(3);
  });

  it("extension characters cost 2 units", () => {
    const seg = smsSegments(`${"a".repeat(159)}€`);
    expect(seg).toMatchObject({ encoding: "gsm7", length: 161, parts: 2 });
    expect(smsSegments("{}").length).toBe(4);
  });

  it("Bangla (any non-GSM char) switches to unicode: 70 single, 67 per part", () => {
    expect(smsSegments("ঢাকা").encoding).toBe("unicode");
    expect(smsSegments("ঢ".repeat(70)).parts).toBe(1);
    expect(smsSegments("ঢ".repeat(71)).parts).toBe(2);
    expect(smsSegments("ঢ".repeat(134)).parts).toBe(2);
    expect(smsSegments("ঢ".repeat(135)).parts).toBe(3);
  });
});

describe("MS4 cost estimate in preview", () => {
  it("SMS: recipients × parts × the org's own rate; GSM and Bangla bodies differ honestly", async () => {
    const { svc, tables } = build();
    tables.messagingSenderConfig.rows.push({
      id: "scfg-1", organizationId: "org-1",
      smsCostPerPartMinor: 150, whatsappCostPerMessageMinor: null, emailCostPerMessageMinor: null,
    });
    const gsm = await svc.previewBroadcast("org-1", { channel: "sms", audienceType: "customers", body: "Hello" });
    expect(gsm.total).toBe(3);
    expect(gsm.costEstimate).toMatchObject({ currency: "BDT", smsParts: 1, totalMinor: 3 * 1 * 150 });
    const bangla = await svc.previewBroadcast("org-1", { channel: "sms", audienceType: "customers", body: "ঢ".repeat(71) });
    expect(bangla.costEstimate).toMatchObject({ smsParts: 2, totalMinor: 3 * 2 * 150 });
    expect(bangla.costEstimate?.basis).toMatch(/Estimate only/);
  });

  it("no rate set = costEstimate null (never an invented price); WhatsApp uses its own rate", async () => {
    const { svc, tables } = build();
    const noRate = await svc.previewBroadcast("org-1", { channel: "sms", audienceType: "customers", body: "Hello" });
    expect(noRate.costEstimate).toBeNull();
    tables.messagingSenderConfig.rows.push({
      id: "scfg-1", organizationId: "org-1",
      smsCostPerPartMinor: null, whatsappCostPerMessageMinor: 200, emailCostPerMessageMinor: null,
    });
    const wa = await svc.previewBroadcast("org-1", { channel: "whatsapp", audienceType: "customers" });
    expect(wa.costEstimate).toMatchObject({ totalMinor: 3 * 200 });
    const stillNull = await svc.previewBroadcast("org-1", { channel: "email", audienceType: "customers" });
    expect(stillNull.costEstimate).toBeNull();
  });

  it("rates endpoint validates non-negative integers", async () => {
    const { svc } = build();
    await expect(svc.updateSenderRates("org-1", "owner", { smsCostPerPartMinor: -5 })).rejects.toMatchObject({ code: "messaging.keyMustBeANonNegative" });
    const view: any = await svc.updateSenderRates("org-1", "owner", { smsCostPerPartMinor: 150 });
    expect(view.rates.smsCostPerPartMinor).toBe(150);
  });
});
