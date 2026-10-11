process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
import { AdminService } from "./admin.service";
import { LlmFactory } from "../ai/llm/llm.factory";
import { EmailProvider } from "../messaging/email.provider";
import {
  seal, refreshPlatformConfig, setPlatformConfigSnapshot, getPlatformConfigSync, resolveMessagingAppSecret,
} from "../common/platform-config";
import { decryptJson } from "../integrations/crypto";

const audit = { log: async () => undefined } as any;
const actor: any = { id: "admin-1" };

function prismaFake() {
  const rows: any[] = [];
  return {
    systemSetting: {
      rows,
      findUnique: async ({ where }: any) => rows.find((r) => r.key === where.key) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const row = rows.find((r) => r.key === where.key);
        if (row) { Object.assign(row, update); return row; }
        const created = { ...create }; rows.push(created); return created;
      },
      deleteMany: async ({ where }: any) => {
        const i = rows.findIndex((r) => r.key === where.key);
        if (i >= 0) rows.splice(i, 1);
        return { count: 1 };
      },
    },
  } as any;
}

beforeEach(() => {
  setPlatformConfigSnapshot({ llm: null, metaApp: null, smtp: null, sms: null, sslcommerz: null, loadedAt: 0 });
  delete process.env.LLM_PROVIDER; delete process.env.LLM_API_KEY; delete process.env.LLM_MODEL;
  delete process.env.SMTP_HOST; delete process.env.SMS_API_TOKEN; delete process.env.SMS_SENDER_ID;
});
afterAll(() => setPlatformConfigSnapshot({ llm: null, metaApp: null, smtp: null, sms: null, sslcommerz: null, loadedAt: 0 }));

describe("Milestone 33 — dynamic platform config (AdminService)", () => {
  it("stores the LLM key sealed, the safe view never contains it, and the snapshot decrypts it", async () => {
    const prisma = prismaFake();
    const svc = new AdminService(prisma, audit);
    const view: any = await svc.updatePlatformConfig(actor, "llm", { provider: "openai", model: "gpt-x", apiKey: "sk-secret-123" });
    expect(view.llm.source).toBe("admin");
    expect(view.llm.provider).toBe("openai");
    expect(view.llm.secretConfigured).toBe(true);
    expect(JSON.stringify(view)).not.toContain("sk-secret-123");
    const row = prisma.systemSetting.rows.find((r: any) => r.key === "llmConfig");
    expect(row.value.apiKeyEncrypted).not.toContain("sk-secret-123");
    expect(decryptJson<any>(row.value.apiKeyEncrypted).v).toBe("sk-secret-123");
    // The live snapshot (what LlmFactory reads) carries the key in memory only.
    expect(getPlatformConfigSync().llm?.apiKey).toBe("sk-secret-123");
  });

  it("partial updates keep the stored secret; clearSecret removes it; clear deletes the row", async () => {
    const prisma = prismaFake();
    const svc = new AdminService(prisma, audit);
    await svc.updatePlatformConfig(actor, "llm", { provider: "openai", apiKey: "sk-keep-me" });
    await svc.updatePlatformConfig(actor, "llm", { model: "gpt-y" });
    let row = prisma.systemSetting.rows.find((r: any) => r.key === "llmConfig");
    expect(decryptJson<any>(row.value.apiKeyEncrypted).v).toBe("sk-keep-me");
    expect(row.value.model).toBe("gpt-y");
    await svc.updatePlatformConfig(actor, "llm", { clearSecret: true });
    row = prisma.systemSetting.rows.find((r: any) => r.key === "llmConfig");
    expect(row.value.apiKeyEncrypted).toBeUndefined();
    const view: any = await svc.updatePlatformConfig(actor, "llm", { clear: true });
    expect(prisma.systemSetting.rows.find((r: any) => r.key === "llmConfig")).toBeUndefined();
    expect(view.llm.source).toBe("none");
  });

  it("validates provider names and graph versions; meta secrets are sealed too", async () => {
    const svc = new AdminService(prismaFake(), audit);
    await expect(svc.updatePlatformConfig(actor, "llm", { provider: "grok" })).rejects.toThrow(/provider must be/);
    await expect(svc.updatePlatformConfig(actor, "meta", { graphVersion: "21" })).rejects.toThrow(/v21\.0/);
    // AA3: meta saves now verify-before-save (app-token probe) — answer it.
    (global as any).fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ access_token: "app-token" }) }));
    const view: any = await svc.updatePlatformConfig(actor, "meta", { appId: "123456", appSecret: "shh-secret", graphVersion: "v22.0" });
    expect(view.metaApp.appId).toBe("123456");
    expect(view.metaApp.appSecretConfigured).toBe(true);
    expect(JSON.stringify(view)).not.toContain("shh-secret");
    expect(getPlatformConfigSync().metaApp?.appSecret).toBe("shh-secret");
    expect(getPlatformConfigSync().metaApp?.graphVersion).toBe("v22.0");
  });

  it("testLlm refuses honestly with no real LLM, and surfaces the provider's own error with a bad key", async () => {
    const svc = new AdminService(prismaFake(), audit);
    await expect(svc.testLlm()).rejects.toThrow(/No real LLM is configured/);
    await svc.updatePlatformConfig(actor, "llm", { provider: "openai", apiKey: "sk-bad" });
    (global as any).fetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "Incorrect API key provided" } }) }));
    await expect(svc.testLlm()).rejects.toThrow(/Incorrect API key provided/);
  });

  it("refreshPlatformConfig decrypts stored rows into the snapshot", async () => {
    const prisma = prismaFake();
    prisma.systemSetting.rows.push(
      { key: "llmConfig", value: { provider: "gemini", model: "gemini-x", apiKeyEncrypted: seal("g-key") } },
      { key: "smtpConfig", value: { host: "mail.example", port: 465, user: "u@x.co", from: "u@x.co", passEncrypted: seal("pw") } },
      { key: "smsConfig", value: { senderId: "QOSPREY", apiTokenEncrypted: seal("tok") } },
    );
    const snap = await refreshPlatformConfig(prisma);
    expect(snap.llm).toEqual({ provider: "gemini", model: "gemini-x", apiKey: "g-key" });
    expect(snap.smtp?.pass).toBe("pw");
    expect(snap.sms?.apiToken).toBe("tok");
  });
});

describe("Milestone 33 — consumers honor the dynamic config", () => {
  it("LlmFactory swaps providers when the admin config changes — no restart", () => {
    const factory = new LlmFactory();
    expect(factory.getProvider().name).toBe("dev-template");
    setPlatformConfigSnapshot({ llm: { provider: "openai", apiKey: "sk-live" }, metaApp: null, smtp: null, sms: null, loadedAt: Date.now() });
    expect(factory.getProvider().name).toBe("openai");
    setPlatformConfigSnapshot({ llm: { provider: "anthropic", apiKey: "sk-ant" }, metaApp: null, smtp: null, sms: null, loadedAt: Date.now() });
    expect(factory.getProvider().name).toBe("anthropic");
    setPlatformConfigSnapshot({ llm: null, metaApp: null, smtp: null, sms: null, sslcommerz: null, loadedAt: 0 });
    expect(factory.getProvider().name).toBe("dev-template");
  });

  it("EmailProvider.isConfigured follows the snapshot, then env", () => {
    const email = new EmailProvider();
    expect(email.isConfigured()).toBe(false);
    setPlatformConfigSnapshot({ llm: null, metaApp: null, smtp: { host: "mail.example", port: 587, from: "a@b.co" }, sms: null, loadedAt: Date.now() });
    expect(email.isConfigured()).toBe(true);
  });

  it("resolveMessagingAppSecret: the integration's own secret wins, platform is the fallback", () => {
    setPlatformConfigSnapshot({ llm: null, metaApp: { appSecret: "platform-secret" }, smtp: null, sms: null, loadedAt: Date.now() });
    expect(resolveMessagingAppSecret("own-secret")).toBe("own-secret");
    expect(resolveMessagingAppSecret("")).toBe("platform-secret");
    expect(resolveMessagingAppSecret(undefined)).toBe("platform-secret");
    setPlatformConfigSnapshot({ llm: null, metaApp: null, smtp: null, sms: null, sslcommerz: null, loadedAt: 0 });
    expect(resolveMessagingAppSecret("")).toBeNull();
  });
});
