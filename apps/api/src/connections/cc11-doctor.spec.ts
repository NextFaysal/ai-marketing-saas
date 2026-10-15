process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "<redacted>";

import { ConnectionsService } from "./connections.service";
import { ConnectionDoctorService, overallFromSteps, type DoctorProbes } from "./connection-doctor.service";
import { encryptJson } from "../integrations/crypto";

/**
 * CC11 — Connection Doctor honesty: a step reports ONLY what a
 * stubbed provider boundary returned — a provider failure is a
 * fail carrying the provider's own message; a kind with no real
 * check is not_checkable and can NEVER produce an overall pass.
 */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
      if ("not" in v) return row[k] !== v.not;
      return true;
    }
    if (v instanceof Date) return new Date(row[k]).getTime() === v.getTime();
    if (v === null) return row[k] === null || row[k] === undefined;
    return row[k] === v;
  });
}

function makeTable(name: string) {
  const rows: any[] = [];
  let seq = 0;
  const applyOrderTake = (list: any[], args: any) => {
    let out = [...list];
    const orderBy = args?.orderBy;
    if (orderBy) {
      const [key, dir] = Object.entries(orderBy)[0] as [string, string];
      out.sort((a, b) => {
        const av = new Date(a[key]).getTime(), bv = new Date(b[key]).getTime();
        return dir === "desc" ? bv - av : av - bv;
      });
    }
    if (typeof args?.take === "number") out = out.slice(0, args.take);
    return out;
  };
  return {
    rows,
    findFirst: async (args: any = {}) => applyOrderTake(rows.filter((r) => matches(r, args.where ?? {})), args)[0] ?? null,
    findMany: async (args: any = {}) => applyOrderTake(rows.filter((r) => matches(r, args.where ?? {})), args),
    findUnique: async (args: any) => rows.filter((r) => matches(r, args.where ?? {}))[0] ?? null,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (row) Object.assign(row, data);
      return row;
    },
    deleteMany: async ({ where }: any) => ({ count: rows.filter((r) => matches(r, where ?? {})).length }),
  };
}

function makeProbes(overrides: Partial<DoctorProbes> = {}): DoctorProbes {
  return {
    metaVerifyToken: async () => ({ id: "111", name: "Biz Page" }),
    graphGet: async () => ({ display_phone_number: "+8801700000000", verified_name: "Shop", name: "Page" }),
    telegramGetMe: async () => ({ id: 42, username: "shopbot" }),
    wooTest: async () => ({ storeName: "My Shop", version: "8.0" }),
    shopifyTest: async () => ({ id: 1, name: "Shop", currency: "BDT", domain: "shop.myshopify.com" }),
    steadfastBalance: async () => ({ current_balance: 500 }),
    pathaoVerify: async () => ({ stores: 2 }),
    redxVerify: async () => ({ areas: 12 }),
    emailImapLogin: async () => undefined,
    emailSmtpVerify: async () => undefined,
    smtpVerify: async () => ({ ok: true as const }),
    llmVerify: async () => ({ model: "gpt-test" }),
    bkashGrant: async () => "token-123",
    tiktokUserInfo: async () => ({ openId: "o1", displayName: "Creator" }),
    youtubeChannels: async () => [{ id: "ch1", title: "Channel" }],
    linkedinOrgs: async () => [{ id: "123", name: "Acme Page" }],
    ...overrides,
  };
}

function build(probes: DoctorProbes) {
  const tables: any = {
    integration: makeTable("int"), integrationCredential: makeTable("cred"),
    socialAccount: makeTable("soc"), adAccount: makeTable("ad"), store: makeTable("store"),
    messagingSenderConfig: makeTable("sender"), businessProfile: makeTable("profile"),
    tenantAppConfig: makeTable("appcfg"), orgLlmConfig: makeTable("llm"),
    tenantPaymentGateway: makeTable("gw"), platformPaymentEnablement: makeTable("en"),
    connectionHealthCheck: makeTable("check"), connectionAlert: makeTable("alert"),
    systemSetting: makeTable("setting"),
  };
  const audit = { log: async () => undefined } as any;
  const connections = new ConnectionsService(tables as any, audit);
  const doctor = new ConnectionDoctorService(tables as any, audit, connections, probes);
  return { tables, connections, doctor };
}

async function seedWhatsApp(tables: any) {
  const integration = await tables.integration.create({
    data: { organizationId: "org-1", provider: "whatsapp", status: "CONNECTED", externalAccountId: "8801700000000", appSource: "platform" },
  });
  await tables.integrationCredential.create({
    data: { integrationId: integration.id, encryptedData: encryptJson({ accessToken: "tok", phoneNumberId: "8801700000000" }) },
  });
  return integration;
}

describe("CC11 Connection Doctor — step honesty", () => {
  it("overallFromSteps: not_checkable alone is never a pass", () => {
    expect(overallFromSteps([{ key: "a", label: "A", status: "not_checkable", message: "n/a" }])).toBe("partial");
    expect(overallFromSteps([{ key: "a", label: "A", status: "pass", message: "ok" }])).toBe("pass");
    expect(overallFromSteps([{ key: "a", label: "A", status: "fail", message: "x" }])).toBe("fail");
    expect(overallFromSteps([
      { key: "a", label: "A", status: "pass", message: "ok" },
      { key: "b", label: "B", status: "fail", message: "x" },
    ])).toBe("fail");
    expect(overallFromSteps([
      { key: "a", label: "A", status: "pass", message: "ok" },
      { key: "b", label: "B", status: "not_checkable", message: "n/a" },
    ])).toBe("partial");
  });

  it("a stubbed provider failure yields a fail step with the provider's own message, and the run is persisted", async () => {
    const probes = makeProbes({
      metaVerifyToken: async () => { throw new Error("Meta token verification failed (401): Error validating access token"); },
    });
    const { tables, doctor } = build(probes);
    const integration = await seedWhatsApp(tables);
    const run = await doctor.diagnoseOne("org-1", "user-1", "integration", integration.id);
    expect(run.overall).toBe("fail");
    const tokenStep = run.steps.find((s: any) => s.key === "token");
    expect(tokenStep.status).toBe("fail");
    expect(tokenStep.message).toContain("Error validating access token");
    expect(tables.connectionHealthCheck.rows).toHaveLength(1);
    expect(tables.connectionHealthCheck.rows[0]).toMatchObject({ trigger: "manual", runById: "user-1", overall: "fail" });
  });

  it("whatsapp passes when Meta confirms both the token and the phone number", async () => {
    const { tables, doctor } = build(makeProbes());
    const integration = await seedWhatsApp(tables);
    const run = await doctor.diagnoseOne("org-1", "user-1", "integration", integration.id);
    expect(run.overall).toBe("pass");
    expect(run.steps.every((s: any) => s.status === "pass")).toBe(true);
    // the overview surfaces the run as lastCheck
    const overview = await doctor["connections"].getOverview("org-1");
    const account = overview.categories.flatMap((c: any) => c.accounts).find((a: any) => a.id === integration.id);
    expect(account.lastCheck).toMatchObject({ overall: "pass", trigger: "manual" });
  });

  it("SMS sender config has no real check → not_checkable, overall is not a pass", async () => {
    const { tables, doctor } = build(makeProbes());
    const row = await tables.messagingSenderConfig.create({
      data: { organizationId: "org-1", smsGateway: "sslwireless", smsSenderId: "SHOP" },
    });
    const run = await doctor.diagnoseOne("org-1", "user-1", "sender_config", `${row.id}:sms`);
    expect(run.steps[0].status).toBe("not_checkable");
    expect(run.overall).not.toBe("pass");
  });

  it("SMTP sender config runs the real handshake probe", async () => {
    const { tables, doctor } = build(makeProbes());
    const row = await tables.messagingSenderConfig.create({
      data: { organizationId: "org-1", smtpHost: "mail.example.com", smtpPort: 587, smtpUser: "u", fromAddress: "a@example.com" },
    });
    const run = await doctor.diagnoseOne("org-1", "user-1", "sender_config", `${row.id}:smtp`);
    expect(run.steps[0].status).toBe("pass");
    expect(run.overall).toBe("pass");
  });

  it("SSLCommerz is honestly not_checkable (no pre-transaction check exists); bKash grant is a real check", async () => {
    const { tables, doctor } = build(makeProbes());
    const ssl = await tables.tenantPaymentGateway.create({
      data: { organizationId: "org-1", provider: "sslcommerz", status: "configured", isEnabled: true, encryptedData: encryptJson({ storeId: "s", storePass: "p" }) },
    });
    const sslRun = await doctor.diagnoseOne("org-1", "user-1", "tenant_payment_gateway", ssl.id);
    expect(sslRun.steps[0].status).toBe("not_checkable");
    expect(sslRun.overall).not.toBe("pass");

    const bkash = await tables.tenantPaymentGateway.create({
      data: { organizationId: "org-1", provider: "bkash", status: "verified", isEnabled: true, encryptedData: encryptJson({ username: "u", password: "p", appKey: "k", appSecret: "s" }) },
    });
    const bkashRun = await doctor.diagnoseOne("org-1", "user-1", "tenant_payment_gateway", bkash.id);
    expect(bkashRun.steps[0].status).toBe("pass");
    expect(bkashRun.overall).toBe("pass");
  });

  it("bKash grant failure is a fail with bKash's message", async () => {
    const probes = makeProbes({ bkashGrant: async () => { throw new Error("bKash token grant failed: Invalid credentials"); } });
    const { tables, doctor } = build(probes);
    const bkash = await tables.tenantPaymentGateway.create({
      data: { organizationId: "org-1", provider: "bkash", status: "verified", isEnabled: true, encryptedData: encryptJson({ username: "u", password: "p", appKey: "k", appSecret: "s" }) },
    });
    const run = await doctor.diagnoseOne("org-1", "user-1", "tenant_payment_gateway", bkash.id);
    expect(run.overall).toBe("fail");
    expect(run.steps[0].message).toContain("Invalid credentials");
  });

  it("platform payment enablement is not_checkable — platform credentials are not the tenant's to verify", async () => {
    const { tables, doctor } = build(makeProbes());
    const en = await tables.platformPaymentEnablement.create({
      data: { organizationId: "org-1", provider: "bkash", isEnabled: true },
    });
    const run = await doctor.diagnoseOne("org-1", "user-1", "platform_payment_enablement", en.id);
    expect(run.steps[0].status).toBe("not_checkable");
  });

  it("diagnose-all is capped and reports what it skipped", async () => {
    const { tables, doctor } = build(makeProbes());
    for (let i = 0; i < 30; i++) {
      await tables.integration.create({
        data: { organizationId: "org-1", provider: "webchat", status: "CONNECTED", externalAccountId: `site-${i}` },
      });
    }
    const result = await doctor.diagnoseAll("org-1", "user-1");
    expect(result.totalTargets).toBe(30);
    expect(result.ranTargets).toBe(25);
    expect(result.skippedBeyondCap).toBe(5);
    expect(tables.connectionHealthCheck.rows).toHaveLength(25);
  });

  it("a DISCONNECTED integration is not_checkable, not failed against the provider", async () => {
    const { tables, doctor } = build(makeProbes());
    const integration = await tables.integration.create({
      data: { organizationId: "org-1", provider: "whatsapp", status: "DISCONNECTED", externalAccountId: "8801" },
    });
    const run = await doctor.diagnoseOne("org-1", "user-1", "integration", integration.id);
    expect(run.steps[0].status).toBe("not_checkable");
    expect(run.overall).not.toBe("fail");
  });

  it("history lists prior runs newest first", async () => {
    const { tables, doctor } = build(makeProbes());
    const integration = await seedWhatsApp(tables);
    await doctor.diagnoseOne("org-1", "user-1", "integration", integration.id);
    await doctor.diagnoseOne("org-1", "user-1", "integration", integration.id);
    const { runs } = await doctor.listHistory("org-1", "integration", integration.id);
    expect(runs).toHaveLength(2);
  });
});
