process.env.ENCRYPTION_KEY = Buffer.alloc(32, 17).toString("base64");
import { Reflector } from "@nestjs/core";
import { AdminService } from "./admin.service";
import { AdminController } from "./admin.controller";
import { ADMIN_TIER_KEY } from "../common/super-admin.guard";
import {
  effectiveCloudflareSaasConfig,
  setPlatformConfigSnapshot,
} from "../common/platform-config";

/**
 * OU2 — Cloudflare for SaaS platform config.
 *
 * Proven here (fetch stubbed at the Cloudflare boundary; the
 * response fixtures model the adapter's envelope):
 *  - the area follows the EXACT M33 pattern: sealed token in the
 *    SystemSetting row, the safe view reports only
 *    secretConfigured (the token value never appears anywhere);
 *  - verify-before-save: a complete config (zone id + token)
 *    must pass the adapter's zone read or NOTHING is written and
 *    the failure is audited (Meta/bKash discipline);
 *  - an incomplete config saves unverified (no fetch) — the same
 *    as a Meta save without a secret;
 *  - effective resolution is enabled-AND-complete, admin-only:
 *    a disabled-but-saved config resolves to null, which is what
 *    makes merchant HTTPS read "not_configured" downstream;
 *  - the test endpoint answers honestly when unconfigured and
 *    never persists anything.
 * Live Cloudflare proof is NOT claimed here (TD D3 owed).
 */

const actor: any = { id: "admin-1" };
const TOKEN = "cf-api-token-canary";

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

function resetSnapshot() {
  setPlatformConfigSnapshot({ llm: null, metaApp: null, smtp: null, sms: null, loadedAt: 0 } as any);
}
beforeEach(() => resetSnapshot());
afterEach(() => { (global as any).fetch = realFetch; });
afterAll(() => resetSnapshot());

const zoneOk = async () => jsonRes({ success: true, errors: [], result: { id: "zone-1", name: "qosprey.com" } });

describe("OU2 CfS config — save + safe view + sealing", () => {
  it("a verified save seals the token; the view never carries it; effective resolves when enabled", async () => {
    const calls = stubFetch(zoneOk);
    const prisma = prismaFake();
    const svc = new AdminService(prisma, recordingAudit() as any);
    const saved: any = await svc.updatePlatformConfig(actor, "cloudflare", {
      enabled: true, zoneId: "zone-1", fallbackOrigin: "fallback.qosprey.com", apiToken: TOKEN,
    });
    // Verify-before-save really read the zone through the adapter.
    expect(calls[0].url).toBe("https://api.cloudflare.com/client/v4/zones/zone-1");
    expect(calls[0].init.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(saved.cloudflareVerification).toEqual({ ok: true, latencyMs: expect.any(Number), zoneName: "qosprey.com" });
    // Safe view: shape + secretConfigured only.
    expect(saved.cloudflareSaas).toEqual({
      source: "admin", enabled: true, zoneId: "zone-1", fallbackOrigin: "fallback.qosprey.com", secretConfigured: true,
    });
    expect(JSON.stringify(saved)).not.toContain(TOKEN);
    // Stored row: sealed, not plaintext.
    const row = prisma.rows.find((r: any) => r.key === "cloudflareSaasConfig");
    expect(row).toBeDefined();
    expect(row.value.apiTokenEncrypted).toBeTruthy();
    expect(row.value.apiTokenEncrypted).not.toContain(TOKEN);
    // Snapshot/effective: enabled + complete resolves.
    expect(effectiveCloudflareSaasConfig()).toMatchObject({ zoneId: "zone-1", apiToken: TOKEN, enabled: true, source: "admin" });
  });

  it("a refused zone read refuses the save — nothing written, failure audited", async () => {
    stubFetch(async () => jsonRes({ success: false, errors: [{ code: 9109, message: "Invalid access token" }], result: null }, 403));
    const prisma = prismaFake();
    const audit = recordingAudit();
    const svc = new AdminService(prisma, audit as any);
    await expect(svc.updatePlatformConfig(actor, "cloudflare", { enabled: true, zoneId: "zone-1", apiToken: "wrong" }))
      .rejects.toThrow(/NOT saved: Invalid access token/);
    expect(prisma.rows.find((r: any) => r.key === "cloudflareSaasConfig")).toBeUndefined();
    expect(audit.calls.some((c) => c.action === "admin.platform_config_verify_failed")).toBe(true);
  });

  it("an incomplete config (zone only, no token) saves WITHOUT any fetch", async () => {
    const calls = stubFetch(async () => { throw new Error("fetch must not be called"); });
    const svc = new AdminService(prismaFake(), recordingAudit() as any);
    const saved: any = await svc.updatePlatformConfig(actor, "cloudflare", { zoneId: "zone-1" });
    expect(calls.length).toBe(0);
    expect(saved.cloudflareSaas.secretConfigured).toBe(false);
    expect(saved.cloudflareVerification).toBeUndefined();
    // Half-config never resolves as usable.
    expect(effectiveCloudflareSaasConfig()).toBeNull();
  });

  it("a saved-but-DISABLED config resolves to null (not_configured downstream)", async () => {
    stubFetch(zoneOk);
    const svc = new AdminService(prismaFake(), recordingAudit() as any);
    await svc.updatePlatformConfig(actor, "cloudflare", { enabled: false, zoneId: "zone-1", apiToken: TOKEN });
    expect(effectiveCloudflareSaasConfig()).toBeNull();
  });

  it("clearing the secret keeps the row but drops resolution", async () => {
    stubFetch(zoneOk);
    const svc = new AdminService(prismaFake(), recordingAudit() as any);
    await svc.updatePlatformConfig(actor, "cloudflare", { enabled: true, zoneId: "zone-1", apiToken: TOKEN });
    expect(effectiveCloudflareSaasConfig()).not.toBeNull();
    const saved: any = await svc.updatePlatformConfig(actor, "cloudflare", { clearSecret: true });
    expect(saved.cloudflareSaas.secretConfigured).toBe(false);
    expect(effectiveCloudflareSaasConfig()).toBeNull();
  });
});

describe("OU2 CfS config — test endpoint honesty", () => {
  it("unconfigured answers ok:false and never fetches", async () => {
    const calls = stubFetch(async () => { throw new Error("fetch must not be called"); });
    const svc = new AdminService(prismaFake(), recordingAudit() as any);
    const out: any = await svc.testCloudflareSaas();
    expect(out.ok).toBe(false);
    expect(out.detail).toContain("configure/চালু করা নেই");
    expect(calls.length).toBe(0);
  });

  it("configured + enabled verifies via the zone read and persists nothing new", async () => {
    stubFetch(zoneOk);
    const prisma = prismaFake();
    const svc = new AdminService(prisma, recordingAudit() as any);
    await svc.updatePlatformConfig(actor, "cloudflare", { enabled: true, zoneId: "zone-1", apiToken: TOKEN });
    const rowsBefore = prisma.rows.length;
    const out: any = await svc.testCloudflareSaas();
    expect(out.ok).toBe(true);
    expect(out.detail).toContain("qosprey.com");
    expect(out.detail).toContain("প্রমাণের সীমা");
    expect(JSON.stringify(out)).not.toContain(TOKEN);
    expect(prisma.rows.length).toBe(rowsBefore);
  });
});

describe("OU2 CfS config — routes are SUPER-only", () => {
  it("PATCH + test routes carry @AdminTier(SUPER)", () => {
    const reflector = new Reflector();
    expect(reflector.get(ADMIN_TIER_KEY, (AdminController.prototype as any).updateCloudflareConfig)).toEqual(["SUPER"]);
    expect(reflector.get(ADMIN_TIER_KEY, (AdminController.prototype as any).testCloudflare)).toEqual(["SUPER"]);
  });
});
