process.env.ENCRYPTION_KEY = Buffer.alloc(32, 17).toString("base64");
import { Reflector } from "@nestjs/core";
import { AdminService } from "./admin.service";
import { AdminController } from "./admin.controller";
import { ADMIN_TIER_KEY } from "../common/super-admin.guard";
import {
  effectiveStripeConfig,
  setPlatformConfigSnapshot,
} from "../common/platform-config";

/**
 * OU5 item 3(b) — the platform Stripe config area.
 * Proven here (fetch stubbed at the Stripe boundary):
 *  - the area follows the EXACT M33 pattern: both secrets
 *    sealed in the SystemSetting row; the safe view reports
 *    only configured booleans + the key mode (values never
 *    appear anywhere);
 *  - verify-before-save: a save carrying a secret key must
 *    pass the REAL balance read (and its livemode must agree
 *    with the key) or NOTHING is written and the failure is
 *    audited (Meta/bKash/Cloudflare discipline);
 *  - an incomplete config saves unverified (no fetch) and can
 *    never resolve as usable — both secrets are required;
 *  - the test endpoint answers honestly when unconfigured and
 *    persists nothing.
 * Live Stripe proof is NOT claimed here (owner checklist owed).
 */

const actor: any = { id: "admin-1" };
const SECRET = "sk_test_ou5canary";
const WHSEC = "whsec_ou5canary";

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

const balanceOk = async () => jsonRes({ object: "balance", livemode: false, available: [], pending: [] });

describe("OU5 platform Stripe config — save + safe view + sealing", () => {
  it("a verified save seals both secrets; the view never carries them; effective resolves", async () => {
    const calls = stubFetch(balanceOk);
    const prisma = prismaFake();
    const svc = new AdminService(prisma, recordingAudit() as any);
    const saved: any = await svc.updatePlatformConfig(actor, "stripe", {
      publishableKey: "pk_test_ou5canary", secretKey: SECRET, webhookSecret: WHSEC,
    });
    expect(calls[0].url).toBe("https://api.stripe.com/v1/balance");
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(saved.stripeVerification).toEqual({ ok: true, latencyMs: expect.any(Number), livemode: false });
    expect(saved.stripe).toEqual({
      source: "admin", publishableKey: "pk_test_ou5canary", mode: "test",
      secretConfigured: true, webhookSecretConfigured: true,
    });
    expect(JSON.stringify(saved)).not.toContain(SECRET);
    expect(JSON.stringify(saved)).not.toContain(WHSEC);
    const row = prisma.rows.find((r: any) => r.key === "stripeConfig");
    expect(row).toBeDefined();
    expect(row.value.secretKeyEncrypted).toBeTruthy();
    expect(row.value.secretKeyEncrypted).not.toContain(SECRET);
    expect(row.value.webhookSecretEncrypted).toBeTruthy();
    expect(row.value.webhookSecretEncrypted).not.toContain(WHSEC);
    expect(effectiveStripeConfig()).toMatchObject({ secretKey: SECRET, webhookSecret: WHSEC, source: "admin" });
  });

  it("a refused balance read refuses the save — nothing written, failure audited", async () => {
    stubFetch(async () => jsonRes({ error: { message: "Invalid API Key provided" } }, 401));
    const prisma = prismaFake();
    const audit = recordingAudit();
    const svc = new AdminService(prisma, audit as any);
    await expect(svc.updatePlatformConfig(actor, "stripe", { secretKey: "sk_test_wrong", webhookSecret: WHSEC }))
      .rejects.toMatchObject({ code: "admin.stripeVerificationFailedTheSettingWas3" });
    expect(prisma.rows.find((r: any) => r.key === "stripeConfig")).toBeUndefined();
    expect(audit.calls.some((c) => c.action === "admin.platform_config_verify_failed")).toBe(true);
  });

  it("an incomplete config (publishable only) saves WITHOUT any fetch and never resolves", async () => {
    const calls = stubFetch(async () => { throw new Error("fetch must not be called"); });
    const svc = new AdminService(prismaFake(), recordingAudit() as any);
    const saved: any = await svc.updatePlatformConfig(actor, "stripe", { publishableKey: "pk_test_ou5canary" });
    expect(calls.length).toBe(0);
    expect(saved.stripe.secretConfigured).toBe(false);
    expect(saved.stripeVerification).toBeUndefined();
    expect(effectiveStripeConfig()).toBeNull();
  });

  it("a key WITHOUT its webhook secret never resolves (half-config is unusable)", async () => {
    stubFetch(balanceOk);
    const svc = new AdminService(prismaFake(), recordingAudit() as any);
    await svc.updatePlatformConfig(actor, "stripe", { secretKey: SECRET });
    expect(effectiveStripeConfig()).toBeNull();
  });

  it("clearing the secrets drops resolution", async () => {
    stubFetch(balanceOk);
    const svc = new AdminService(prismaFake(), recordingAudit() as any);
    await svc.updatePlatformConfig(actor, "stripe", { secretKey: SECRET, webhookSecret: WHSEC });
    expect(effectiveStripeConfig()).not.toBeNull();
    const saved: any = await svc.updatePlatformConfig(actor, "stripe", { clearSecret: true });
    expect(saved.stripe.secretConfigured).toBe(false);
    expect(saved.stripe.webhookSecretConfigured).toBe(false);
    expect(effectiveStripeConfig()).toBeNull();
  });
});

describe("OU5 platform Stripe config — test endpoint honesty", () => {
  it("unconfigured answers ok:false and never fetches", async () => {
    const calls = stubFetch(async () => { throw new Error("fetch must not be called"); });
    const svc = new AdminService(prismaFake(), recordingAudit() as any);
    const out: any = await svc.testStripe();
    expect(out.ok).toBe(false);
    expect(out.detail).toContain("configure করা নেই");
    expect(calls.length).toBe(0);
  });

  it("configured verifies via the balance read and persists nothing new", async () => {
    stubFetch(balanceOk);
    const prisma = prismaFake();
    const svc = new AdminService(prisma, recordingAudit() as any);
    await svc.updatePlatformConfig(actor, "stripe", { secretKey: SECRET, webhookSecret: WHSEC });
    const rowsBefore = prisma.rows.length;
    const out: any = await svc.testStripe();
    expect(out.ok).toBe(true);
    expect(out.detail).toContain("TEST");
    expect(out.detail).toContain("প্রমাণের সীমা");
    expect(JSON.stringify(out)).not.toContain(SECRET);
    expect(prisma.rows.length).toBe(rowsBefore);
  });
});

describe("OU5 platform Stripe config — routes are SUPER-only", () => {
  it("PATCH + test routes carry @AdminTier(SUPER)", () => {
    const reflector = new Reflector();
    expect(reflector.get(ADMIN_TIER_KEY, (AdminController.prototype as any).updateStripeConfig)).toEqual(["SUPER"]);
    expect(reflector.get(ADMIN_TIER_KEY, (AdminController.prototype as any).testStripe)).toEqual(["SUPER"]);
  });
});
