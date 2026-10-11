process.env.ENCRYPTION_KEY = Buffer.alloc(32, 17).toString("base64");
import { Reflector } from "@nestjs/core";
import { AdminService } from "./admin.service";
import { AdminController } from "./admin.controller";
import { ADMIN_TIER_KEY } from "../common/super-admin.guard";
import { setPlatformConfigSnapshot } from "../common/platform-config";

/**
 * Admin Advanced AA3 — verify for the five blind-save blocks.
 *
 * Proven here (stubbed fetch at the provider boundary; fixtures
 * model each provider's documented response shapes):
 *  - unconfigured blocks answer honest ok:false, fetch untouched;
 *  - Meta + bKash probes are true credential proofs and ALSO run
 *    as verify-before-save (bad secret -> save refused, nothing
 *    written, platform_config_verify_failed audited);
 *  - SSLCommerz init distinguishes gateway acceptance / store
 *    credential rejection / inconclusive failure;
 *  - TikTok + Google probes rest on the documented
 *    invalid_client (client rejected) vs code/token-error
 *    (client accepted) distinction, and say so in the detail;
 *  - test calls never persist anything; provider secrets are
 *    transmitted to the provider but never echoed in results.
 */

const actor: any = { id: "admin-1" };

function recordingAudit() {
  const calls: any[] = [];
  return { calls, log: async (x: any) => { calls.push(x); } };
}

function prismaFake() {
  const rows: any[] = [];
  return {
    rows,
    systemSetting: {
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

const jsonRes = (body: any, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const realFetch = global.fetch;
function stubFetch(impl: (url: string, init?: any) => Promise<any>) {
  const calls: { url: string; init?: any }[] = [];
  (global as any).fetch = jest.fn(async (url: any, init?: any) => {
    calls.push({ url: String(url), init });
    return impl(String(url), init);
  });
  return calls;
}

const ENV_KEYS = [
  "BKASH_APP_KEY", "BKASH_APP_SECRET", "BKASH_USERNAME", "BKASH_PASSWORD", "BKASH_SANDBOX",
  "SSLCOMMERZ_STORE_ID", "SSLCOMMERZ_STORE_PASS", "SSLCOMMERZ_SANDBOX",
  "TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
  "META_GRAPH_VERSION",
];
let savedEnv: Record<string, string | undefined> = {};
function resetSnapshot() {
  setPlatformConfigSnapshot({ llm: null, metaApp: null, smtp: null, sms: null, sslcommerz: null, bkash: null, image: null, tiktokApp: null, googleApp: null, loadedAt: 0 } as any);
}
beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  resetSnapshot();
});
afterEach(() => {
  (global as any).fetch = realFetch;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
});
afterAll(() => resetSnapshot());

describe("AA3 — unconfigured blocks answer honestly, fetch untouched", () => {
  it("all five return ok:false with a not-configured detail", async () => {
    const calls = stubFetch(async () => { throw new Error("fetch must not be called"); });
    const svc = new AdminService(prismaFake(), recordingAudit() as any);
    for (const m of ["testMeta", "testSslcommerz", "testBkash", "testTiktok", "testGoogle"] as const) {
      const out: any = await (svc as any)[m]();
      expect(out.ok).toBe(false);
      expect(out.detail).toContain("configure করা নেই");
    }
    expect(calls.length).toBe(0);
  });
});

describe("AA3 — Meta probe (true credential proof)", () => {
  const tokenOk = async () => jsonRes({ access_token: "app-token", token_type: "bearer" });

  it("save verifies before persisting; testMeta passes; provider error surfaces verbatim", async () => {
    const calls = stubFetch(tokenOk);
    const svc = new AdminService(prismaFake(), recordingAudit() as any);
    const saved: any = await svc.updatePlatformConfig(actor, "meta", { appId: "123456", appSecret: "meta-secret" });
    expect(saved.metaVerification).toEqual({ ok: true, latencyMs: expect.any(Number) });
    expect(calls[0].url).toContain("https://graph.facebook.com/v21.0/oauth/access_token");
    expect(calls[0].url).toContain("grant_type=client_credentials");

    stubFetch(async () => jsonRes({ error: { message: "Invalid Client Secret", type: "OAuthException", code: 101 } }, 400));
    const out: any = await svc.testMeta();
    expect(out.ok).toBe(false);
    expect(out.detail).toBe("Invalid Client Secret");
  });

  it("a bad secret refuses the save — nothing written, verify failure audited", async () => {
    stubFetch(async () => jsonRes({ error: { message: "Invalid Client Secret", type: "OAuthException", code: 101 } }, 400));
    const prisma = prismaFake();
    const audit = recordingAudit();
    const svc = new AdminService(prisma, audit as any);
    await expect(svc.updatePlatformConfig(actor, "meta", { appId: "123456", appSecret: "wrong" }))
      .rejects.toThrow(/NOT saved: Invalid Client Secret/);
    expect(prisma.rows.find((r: any) => r.key === "metaAppConfig")).toBeUndefined();
    expect(audit.calls.some((c) => c.action === "admin.platform_config_verify_failed")).toBe(true);
  });
});

describe("AA3 — bKash probe (true credential proof)", () => {
  const grantOk = async () => jsonRes({ id_token: "grant-token", expires_in: 3600 });

  it("save verifies via a real grant (token discarded); testBkash passes; secret never echoed", async () => {
    const CANARY = "canary-bkash-password";
    const calls = stubFetch(grantOk);
    const svc = new AdminService(prismaFake(), recordingAudit() as any);
    const saved: any = await svc.updatePlatformConfig(actor, "bkash", {
      appKey: "app-key", username: "merchant", appSecret: "app-secret", password: CANARY, sandbox: true,
    });
    expect(saved.bkashVerification?.ok).toBe(true);
    // The probe really transmits the credentials to bKash…
    expect(calls[0].url).toBe("https://tokenized.sandbox.bka.sh/v1.2.0-beta/token/grant");
    expect(calls[0].init.headers.password).toBe(CANARY);
    const out: any = await svc.testBkash();
    expect(out.ok).toBe(true);
    // …but neither the grant token nor the password is ever echoed back.
    expect(JSON.stringify(out)).not.toContain(CANARY);
    expect(JSON.stringify(out)).not.toContain("grant-token");
    expect(JSON.stringify(saved)).not.toContain(CANARY);
  });

  it("a refused grant refuses the save — nothing written, verify failure audited", async () => {
    stubFetch(async () => jsonRes({ statusMessage: "Invalid merchant credential" }, 401));
    const prisma = prismaFake();
    const audit = recordingAudit();
    const svc = new AdminService(prisma, audit as any);
    await expect(svc.updatePlatformConfig(actor, "bkash", {
      appKey: "k", username: "u", appSecret: "bad", password: "bad", sandbox: true,
    })).rejects.toThrow(/NOT saved: Invalid merchant credential/);
    expect(prisma.rows.find((r: any) => r.key === "bkashConfig")).toBeUndefined();
    expect(audit.calls.some((c) => c.action === "admin.platform_config_verify_failed")).toBe(true);
    const out: any = await svc.testBkash();
    expect(out.ok).toBe(false);
  });

  it("test calls persist nothing (env-sourced config verifies with an empty settings store)", async () => {
    process.env.BKASH_APP_KEY = "env-key"; process.env.BKASH_APP_SECRET = "env-secret";
    process.env.BKASH_USERNAME = "env-user"; process.env.BKASH_PASSWORD = "env-pass";
    stubFetch(grantOk);
    const prisma = prismaFake();
    const svc = new AdminService(prisma, recordingAudit() as any);
    const out: any = await svc.testBkash();
    expect(out.ok).toBe(true);
    expect(out.source).toBe("env");
    expect(prisma.rows.length).toBe(0);
  });
});

describe("AA3 — SSLCommerz init probe (test-only, no verify-before-save)", () => {
  async function svcWithSsl() {
    const svc = new AdminService(prismaFake(), recordingAudit() as any);
    await svc.updatePlatformConfig(actor, "sslcommerz", { storeId: "store1", storePass: "store-pass", sandbox: true });
    return svc;
  }

  it("gateway acceptance passes and the probe request is a labelled throwaway", async () => {
    const svc = await svcWithSsl();
    const calls = stubFetch(async () => jsonRes({ status: "SUCCESS", sessionkey: "SK1", GatewayPageURL: "https://sandbox.sslcommerz.com/gwprocess/v4/gw.php?Q=pay&SESSIONKEY=SK1" }));
    const out: any = await svc.testSslcommerz();
    expect(out.ok).toBe(true);
    expect(out.detail).toContain("কোনো টাকা কাটা হয়নি");
    expect(calls[0].url).toBe("https://sandbox.sslcommerz.com/gwprocess/v4/api.php");
    const body = String(calls[0].init.body);
    expect(body).toContain("store_id=store1");
    expect(body).toContain("tran_id=ADMIN-VERIFY-");
  });

  it("a store-credential rejection is named as such, verbatim", async () => {
    const svc = await svcWithSsl();
    stubFetch(async () => jsonRes({ status: "FAILED", failed_reason: "Invalid Store Password" }));
    const out: any = await svc.testSslcommerz();
    expect(out.ok).toBe(false);
    expect(out.detail).toContain("Invalid Store Password");
    expect(out.detail).toContain("প্রত্যাখ্যান");
  });

  it("a non-credential failure stays honestly inconclusive", async () => {
    const svc = await svcWithSsl();
    stubFetch(async () => jsonRes({ status: "FAILED", failed_reason: "Invalid Amount" }));
    const out: any = await svc.testSslcommerz();
    expect(out.ok).toBe(false);
    expect(out.detail).toContain("Invalid Amount");
    expect(out.detail).toContain("নিশ্চিত বলা যায় না");
  });
});

describe("AA3 — TikTok + Google dummy-grant probes (client-auth proof, labelled limits)", () => {
  it("TikTok: invalid_client rejects verbatim; a code error means the client was accepted", async () => {
    const svc = new AdminService(prismaFake(), recordingAudit() as any);
    await svc.updatePlatformConfig(actor, "tiktok", { clientKey: "ck", clientSecret: "cs" });
    stubFetch(async () => jsonRes({ error: "invalid_client", error_description: "Client authentication failed. The client_key or client_secret is incorrect." }, 401));
    let out: any = await svc.testTiktok();
    expect(out.ok).toBe(false);
    expect(out.detail).toBe("Client authentication failed. The client_key or client_secret is incorrect.");

    stubFetch(async () => jsonRes({ error: "invalid_grant", error_description: "The authorization code is invalid or has expired." }, 400));
    out = await svc.testTiktok();
    expect(out.ok).toBe(true);
    expect(out.detail).toContain("প্রমাণের সীমা");
    expect(out.detail).toContain("invalid_grant");
  });

  it("Google: invalid_client rejects verbatim; invalid_grant means the client authenticated", async () => {
    const svc = new AdminService(prismaFake(), recordingAudit() as any);
    await svc.updatePlatformConfig(actor, "google", { clientId: "gid", clientSecret: "gs" });
    stubFetch(async () => jsonRes({ error: "invalid_client", error_description: "The OAuth client was not found." }, 401));
    let out: any = await svc.testGoogle();
    expect(out.ok).toBe(false);
    expect(out.detail).toBe("The OAuth client was not found.");

    stubFetch(async () => jsonRes({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400));
    out = await svc.testGoogle();
    expect(out.ok).toBe(true);
    expect(out.detail).toContain("প্রমাণের সীমা");
    expect(out.detail).toContain("invalid_grant");
  });
});

describe("AA3 — routes are SUPER-only, like the existing test endpoints", () => {
  it("all five new test routes carry @AdminTier(SUPER)", () => {
    const reflector = new Reflector();
    for (const h of ["testMeta", "testSslcommerz", "testBkash", "testTiktok", "testGoogle"] as const) {
      expect(reflector.get(ADMIN_TIER_KEY, (AdminController.prototype as any)[h])).toEqual(["SUPER"]);
    }
  });
});
