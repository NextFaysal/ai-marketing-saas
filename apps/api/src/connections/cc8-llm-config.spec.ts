process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.JWT_SECRET = "cc8-test-secret";

import { ConnectionsService } from "./connections.service";
import { decryptJson, encryptJson } from "../integrations/crypto";
import { LlmFactory } from "../ai/llm/llm.factory";
import { resolveOrgLlmConfig } from "../ai/llm/org-llm-config";

/**
 * CC8 — the tenant's OWN LLM key.
 * - Verify-before-save: a REAL minimal completion through the
 *   provider client (stubbed at the injectable boundary) must
 *   succeed; failure saves NOTHING and surfaces the provider's
 *   own message.
 * - The key is sealed at rest and never appears in any response
 *   (neither plaintext nor ciphertext).
 * - LlmFactory.forOrg: the tenant's provider wins for that org;
 *   no config / disabled config falls back to the platform
 *   resolution unchanged.
 */

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (v === undefined) return true;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(row[k]);
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
    findFirst: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {}))[0] ?? null,
    findMany: async ({ where }: any = {}) => rows.filter((r) => matches(r, where ?? {})),
    findUnique: async ({ where }: any) => rows.filter((r) => matches(r, where ?? {}))[0] ?? null,
    create: async ({ data }: any) => { const row = { id: `${name}-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...data }; rows.push(row); return row; },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (row) Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    delete: async ({ where }: any) => {
      const idx = rows.findIndex((r) => matches(r, where));
      if (idx < 0) throw new Error("Record to delete does not exist.");
      return rows.splice(idx, 1)[0];
    },
    deleteMany: async ({ where }: any) => ({ count: 0 }),
  };
}

function buildService(llmStub?: any) {
  const tables: any = {
    integration: makeTable("int"), integrationCredential: makeTable("cred"),
    socialAccount: makeTable("soc"), adAccount: makeTable("ad"), store: makeTable("store"),
    messagingSenderConfig: makeTable("sender"), businessProfile: makeTable("profile"),
    systemSetting: makeTable("setting"), tenantAppConfig: makeTable("appcfg"),
    orgLlmConfig: makeTable("llm"), tenantPaymentGateway: makeTable("gw"),
  };
  const auditLogs: any[] = [];
  const audit = { log: async (entry: any) => { auditLogs.push(entry); } } as any;
  const svc = new ConnectionsService(tables as any, audit, undefined, llmStub);
  return { svc, tables, auditLogs };
}

const okVerifier = { verifyKey: async () => ({ model: "gpt-test" }) };

describe("CC8 OrgLlmConfig — verify-before-save", () => {
  it("verified save: sealed at rest, key never in the response", async () => {
    const { svc, tables } = buildService(okVerifier);
    const view: any = await svc.putLlmConfig("org-1", "owner", { provider: "openai", apiKey: "sk-secret-123", model: "gpt-x" });
    expect(view.status).toBe("verified");
    expect(view.provider).toBe("openai");
    const raw = JSON.stringify(view);
    expect(raw).not.toContain("sk-secret-123");
    const row = tables.orgLlmConfig.rows[0];
    expect(row.encryptedData).not.toContain("sk-secret-123");
    expect(decryptJson(row.encryptedData)).toEqual({ apiKey: "sk-secret-123" });
    expect(raw).not.toContain(row.encryptedData);
  });

  it("verify failure saves nothing and surfaces the provider error", async () => {
    const failing = { verifyKey: async () => { throw new Error("401 Incorrect API key provided"); } };
    const { svc, tables } = buildService(failing);
    await expect(svc.putLlmConfig("org-1", "owner", { provider: "openai", apiKey: "sk-bad" }))
      .rejects.toThrow("401 Incorrect API key provided");
    expect(tables.orgLlmConfig.rows).toHaveLength(0);
  });

  it("unknown provider refused before any verify call", async () => {
    let called = false;
    const spy = { verifyKey: async () => { called = true; return { model: "x" }; } };
    const { svc, tables } = buildService(spy);
    await expect(svc.putLlmConfig("org-1", "owner", { provider: "dev", apiKey: "k" })).rejects.toThrow();
    expect(called).toBe(false);
    expect(tables.orgLlmConfig.rows).toHaveLength(0);
  });

  it("get + delete round-trip; overview shows the own-LLM account", async () => {
    const { svc } = buildService(okVerifier);
    await svc.putLlmConfig("org-1", "owner", { provider: "gemini", apiKey: "g-key" });
    const got: any = await svc.getLlmConfig("org-1");
    expect(got.config.provider).toBe("gemini");
    const overview: any = await svc.getOverview("org-1");
    const ai = overview.categories.find((c: any) => c.key === "ai");
    expect(ai.status).toBe("connected");
    expect(ai.accounts[0].provider).toBe("gemini");
    await svc.deleteLlmConfig("org-1", "owner");
    const after: any = await svc.getLlmConfig("org-1");
    expect(after.config).toBeNull();
  });
});

describe("CC8 LlmFactory.forOrg — tenant key wins, platform fallback", () => {
  function factoryWith(row: any | null) {
    const prisma: any = {
      orgLlmConfig: { findUnique: async () => row },
    };
    return new LlmFactory(prisma);
  }

  it("resolves the tenant provider when a config exists", async () => {
    const row = { provider: "openai", model: "gpt-x", encryptedData: encryptJson({ apiKey: "sk-tenant" }), isEnabled: true, status: "verified" };
    const provider = await factoryWith(row).forOrg("org-1");
    expect(provider.name).toBe("openai");
    expect(provider.isRealLlm).toBe(true);
  });

  it("falls back to the platform provider when no config exists", async () => {
    const provider = await factoryWith(null).forOrg("org-1");
    expect(provider.name).toBe("dev-template");
  });

  it("disabled config falls back; resolver reads null", async () => {
    const row = { provider: "openai", encryptedData: encryptJson({ apiKey: "sk-tenant" }), isEnabled: false, status: "verified" };
    expect(await resolveOrgLlmConfig({ orgLlmConfig: { findUnique: async () => row } }, "org-1")).toBeNull();
    const provider = await factoryWith(row).forOrg("org-1");
    expect(provider.name).toBe("dev-template");
  });

  it("no-prisma factory (spec construction) still serves the platform provider", async () => {
    const provider = await new LlmFactory().forOrg("org-1");
    expect(provider.name).toBe("dev-template");
  });
});
